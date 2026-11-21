// Redirect Tracker: podąża za linkiem z reklamy (HTTP 3xx, meta refresh, proste przekierowania JS),
// bez wykonywania JavaScriptu i bez pobierania plików. Ochrona przed SSRF: tylko http/https,
// blokada adresów prywatnych/lokalnych, limit kroków, czasu i rozmiaru odpowiedzi.
// Wykrywa cloaking porównując ścieżkę dla przeglądarki mobilnej i dla bota.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { sha256 } from './db.js';
import { extractContacts } from './scanner.js';

const MAX_STEPS = 10;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8000;
export const UA_BROWSER = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
export const UA_BOT = 'InvestTraceBot/0.1 (+research; facebookexternalhit compatible)';

function isPrivateIp(ip) {
  if (ip.includes(':')) {
    const l = ip.toLowerCase();
    return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l === '::' || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`Niedozwolony protokół: ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.test|.*\.example|.*\.invalid)$/i.test(host)) throw new Error(`Host niedozwolony: ${host}`);
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error(`Adres prywatny zablokowany: ${a.address}`);
  return { url: u, ip: addrs[0]?.address };
}

async function readLimited(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { await reader.cancel(); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function analyzeHtml(html, baseUrl) {
  const title = (html.match(/<title[^>]*>([^<]{0,200})/i) || [])[1]?.trim() || null;
  const trackers = new Set();
  for (const m of html.matchAll(/\b(G-[A-Z0-9]{6,12}|UA-\d{4,10}-\d{1,3}|GTM-[A-Z0-9]{4,10})\b/g)) trackers.add(m[1]);
  for (const m of html.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,20})['"]/g)) trackers.add(`FBPIXEL-${m[1]}`);
  const forms = [];
  for (const f of html.matchAll(/<form[\s\S]*?<\/form>/gi)) {
    const fields = [...f[0].matchAll(/<input[^>]*name=["']([^"']+)["'][^>]*>/gi)].map((x) => x[1]);
    const action = (f[0].match(/action=["']([^"']+)["']/i) || [])[1] || null;
    forms.push({ action, fields });
  }
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const contacts = extractContacts(text).filter((c) => c.kind !== 'url');
  let next = null, via = null;
  const meta = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/i);
  if (meta) { next = meta[1]; via = 'meta_refresh'; }
  const js = !next && html.match(/(?:window\.|document\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.replace\(\s*["']([^"']+)["']\s*\)/i);
  if (js) { next = js[1] || js[2]; via = 'js'; }
  if (next) { try { next = new URL(next, baseUrl).href; } catch { next = null; } }
  return { title, trackers: [...trackers], forms, contacts, next, via, text: text.slice(0, 5000) };
}

async function follow(startUrl, userAgent) {
  const steps = [];
  let url = startUrl, via = 'start';
  for (let i = 0; i < MAX_STEPS; i++) {
    const { ip } = await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': userAgent, accept: 'text/html,*/*;q=0.5', 'accept-language': 'pl-PL,pl;q=0.9' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const step = { position: i, url, via, http_status: res.status, ip, headers: Object.fromEntries(res.headers) };
    steps.push(step);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      url = new URL(res.headers.get('location'), url).href; via = `http_${res.status}`; continue;
    }
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('html')) { await res.body?.cancel(); step.note = `pominięto treść typu ${ctype}`; break; }
    const html = await readLimited(res);
    const a = analyzeHtml(html, url);
    Object.assign(step, { title: a.title, trackers: a.trackers, forms: a.forms, contacts: a.contacts, html_sha256: sha256(html), text: a.text });
    if (a.next && a.next !== url) { url = a.next; via = a.via; continue; }
    break;
  }
  return steps;
}

/** Śledzi ścieżkę dwukrotnie (przeglądarka vs bot) i porównuje wynik, aby wykryć cloaking. */
export async function trackRedirects(startUrl) {
  const browser = await follow(startUrl, UA_BROWSER);
  let bot = [];
  try { bot = await follow(startUrl, UA_BOT); } catch { /* ignoruj */ }
  const finalB = browser.at(-1)?.url, finalBot = bot.at(-1)?.url;
  const cloaking = Boolean(finalBot && finalB && new URL(finalB).hostname !== new URL(finalBot).hostname);
  return {
    steps: browser,
    cloaking,
    cloaking_note: cloaking ? `Bot trafia na ${new URL(finalBot).hostname}, przeglądarka na ${new URL(finalB).hostname}` : null,
  };
}
