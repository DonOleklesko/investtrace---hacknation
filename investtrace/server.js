// InvestTrace – serwer HTTP (bez zależności zewnętrznych)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import * as api from './src/api.js';
import { createAd, scanAndTrack, addUserReport } from './src/pipeline.js';
import { recomputeAll } from './src/risk.js';
import { renderReport } from './src/report.js';
import { seed } from './src/demo.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, 'public');
const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

openDb();
if (!openDb().prepare('SELECT count(*) c FROM ads').get().c) { seed(); console.log('Baza pusta – załadowano dane demo.'); }

// prosty rate limit na zapisy: 30 żądań / minutę / IP
const hits = new Map();
function rateLimited(ip) {
  const t = Date.now(), arr = (hits.get(ip) || []).filter((x) => t - x < 60000);
  arr.push(t); hits.set(ip, arr);
  return arr.length > 30;
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 1_000_000) throw new Error('Za duże żądanie'); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const routes = [
  ['GET', /^\/api\/stats$/, () => api.stats()],
  ['GET', /^\/api\/ads$/, (_, q) => api.feed(+q.get('limit') || 50)],
  ['POST', /^\/api\/ads$/, async (req) => {
    const b = await readJson(req);
    if (!b.text || typeof b.text !== 'string') throw Object.assign(new Error('Pole "text" jest wymagane'), { status: 400 });
    const id = createAd({
      platform: b.platform || 'inne', text: b.text.slice(0, 5000), target_url: b.target_url || null,
      advertiser: b.advertiser_name ? { account_id: b.advertiser_id || b.advertiser_name, name: b.advertiser_name, is_influencer: !!b.is_influencer } : null,
      source: 'manual',
    });
    const result = await scanAndTrack(id);
    recomputeAll();
    return { id, errors: result.errors, detail: api.adDetail(id) };
  }],
  ['POST', /^\/api\/ads\/(\d+)\/scan$/, async (_, __, m) => { const r = await scanAndTrack(+m[1]); recomputeAll(); return { errors: r.errors, detail: api.adDetail(+m[1]) }; }],
  ['GET', /^\/api\/ads\/(\d+)$/, (_, __, m) => api.adDetail(+m[1])],
  ['GET', /^\/api\/journey\/(\d+)$/, (_, __, m) => api.journey(+m[1])],
  ['GET', /^\/api\/graph$/, (_, q) => api.graph({ center: q.get('center'), depth: +q.get('depth') || 2, minRisk: +q.get('minRisk') || 0, campaign: q.get('campaign') })],
  ['GET', /^\/api\/entities\/(.+)$/, (_, __, m) => api.entityDetail(decodeURIComponent(m[1]))],
  ['GET', /^\/api\/queue$/, () => api.queue()],
  ['GET', /^\/api\/campaigns$/, () => api.campaigns()],
  ['GET', /^\/api\/campaigns\/(\d+)$/, (_, __, m) => api.campaignDetail(+m[1])],
  ['PATCH', /^\/api\/cases\/(\d+)$/, async (req, _, m) => api.updateCase(+m[1], await readJson(req), req.headers['x-analyst'] || 'analityk')],
  ['GET', /^\/api\/cases\/(\d+)\/evidence\.json$/, (_, __, m) => api.evidenceManifest(+m[1])],
  ['GET', /^\/api\/reports\/(\d+)$/, (_, __, m) => ({ __html: renderReport(+m[1]) })],
  ['GET', /^\/api\/timeline$/, () => api.timeline()],
  ['GET', /^\/api\/search$/, (_, q) => api.search(q.get('q') || '')],
  ['GET', /^\/api\/weights$/, () => api.listWeights()],
  ['PUT', /^\/api\/weights$/, async (req) => { api.setWeights(await readJson(req)); recomputeAll(); return api.listWeights(); }],
  ['GET', /^\/api\/user-reports$/, () => api.userReports()],
  ['POST', /^\/api\/user-reports$/, async (req) => {
    const b = await readJson(req);
    if (!b.description) throw Object.assign(new Error('Opis jest wymagany'), { status: 400 });
    const id = addUserReport({ description: String(b.description).slice(0, 2000), phone: b.phone || null, url: b.url || null });
    recomputeAll(); return { id };
  }],
  ['POST', /^\/api\/demo\/reset$/, () => { seed({ reset: true }); return { ok: true }; }],
];

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && rateLimited(req.socket.remoteAddress)) return send(res, 429, { error: 'Zbyt wiele żądań' });
      for (const [method, re, fn] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) {
          const out = await fn(req, url.searchParams, m);
          if (out == null || out.__html === null) return send(res, 404, { error: 'Nie znaleziono' });
          if (out.__html) return send(res, 200, out.__html, 'text/html; charset=utf-8');
          return send(res, 200, out);
        }
      }
      return send(res, 404, { error: 'Nieznany endpoint' });
    }
    const p = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!p.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
    const data = await readFile(p).catch(() => null);
    if (!data) return send(res, 404, 'not found', 'text/plain');
    return send(res, 200, data, MIME[extname(p)] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    return send(res, e.status || 500, { error: e.message });
  }
}).listen(PORT, HOST, () => console.log(`InvestTrace działa: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
