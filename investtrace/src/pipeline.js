// Pipeline: import → analiza AI → przekierowania → ekstrakcja → graf → (risk.js) Risk Score
import { openDb, now, upsertEntity, addEdge, addEvidence, json } from './db.js';
import { scanAd } from './scanner.js';
import { trackRedirects } from './redirect.js';

const domainOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };

export function createAd({ platform, advertiser, text, target_url = null, language = 'pl', country = 'PL', source = 'manual', detected_at = now() }) {
  const db = openDb();
  let advId = null;
  if (advertiser) {
    db.prepare(`INSERT OR IGNORE INTO advertisers(platform,account_id,name,is_influencer,created_at) VALUES (?,?,?,?,?)`)
      .run(platform, advertiser.account_id, advertiser.name, advertiser.is_influencer ? 1 : 0, detected_at);
    advId = db.prepare('SELECT id FROM advertisers WHERE platform=? AND account_id=?').get(platform, advertiser.account_id).id;
  }
  const r = db.prepare(`INSERT INTO ads(advertiser_id,platform,text,target_url,language,country,source,detected_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(advId, platform, text, target_url, language, country, source, detected_at);
  const adId = Number(r.lastInsertRowid);
  const evId = addEvidence({ adId, kind: 'ad_text', url: target_url, content: { platform, advertiser, text, target_url }, source, reason: 'Zapis treści reklamy przy wykryciu', ts: detected_at });
  const adNode = upsertEntity('ad', String(adId), `Reklama #${adId}`, { platform, snippet: text.slice(0, 90) }, detected_at);
  if (advertiser) {
    const accType = advertiser.is_influencer ? 'influencer' : 'account';
    const acc = upsertEntity(accType, `${platform}/${advertiser.account_id}`, advertiser.name, { platform }, detected_at);
    addEdge(acc, adNode, 'PROMOTES', { evidenceId: evId, source, ts: detected_at });
  }
  db.prepare(`INSERT OR IGNORE INTO cases(ad_id,status,updated_at) VALUES (?,?,?)`).run(adId, 'Nowe', detected_at);
  return adId;
}

export function applyScan(adId, scan, ts = now()) {
  const db = openDb();
  db.prepare('UPDATE ads SET scan_json=? WHERE id=?').run(JSON.stringify(scan), adId);
  const evId = addEvidence({ adId, kind: 'ai_scan', content: scan, source: scan.engine, reason: `Wykryto ${scan.red_flags.length} sygnałów w treści`, ts });
  const adNode = `ad:${adId}`;
  for (const c of scan.contact_data) {
    if (c.kind === 'phone') addEdge(adNode, upsertEntity('phone', c.value, c.value, {}, ts), 'USES_PHONE', { evidenceId: evId, source: 'ad_text', ts });
    if (c.kind === 'email') addEdge(adNode, upsertEntity('email', c.value, c.value, {}, ts), 'USES_EMAIL', { evidenceId: evId, source: 'ad_text', ts });
  }
  return evId;
}

/** Zapisuje ścieżkę inwestora (kroki z Redirect Trackera lub z zestawu demo) i buduje krawędzie grafu. */
export function applyJourney(adId, journey, ts = now()) {
  const db = openDb();
  const chain = db.prepare('INSERT INTO redirect_chains(ad_id,cloaking,cloaking_note,created_at) VALUES (?,?,?,?)')
    .run(adId, journey.cloaking ? 1 : 0, journey.cloaking_note || null, ts);
  const chainId = Number(chain.lastInsertRowid);
  const evId = addEvidence({ adId, kind: 'redirect_chain', url: journey.steps[0]?.url, content: journey, source: journey.source || 'redirect_tracker', reason: `Ścieżka ${journey.steps.length} kroków${journey.cloaking ? ', wykryto cloaking' : ''}`, ts });
  let prevDomain = null;
  journey.steps.forEach((s, i) => {
    const domain = domainOf(s.url);
    const page = db.prepare(`INSERT INTO pages(url,domain,title,kind,http_status,html_sha256,forms,trackers,contacts,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(s.url, domain, s.title || null, s.kind || null, s.http_status ?? null, s.html_sha256 || null,
        JSON.stringify(s.forms || []), JSON.stringify(s.trackers || []), JSON.stringify(s.contacts || []), ts);
    db.prepare('INSERT INTO redirect_steps(chain_id,position,url,via,http_status,page_id) VALUES (?,?,?,?,?,?)')
      .run(chainId, i, s.url, s.via || (i === 0 ? 'start' : 'http_302'), s.http_status ?? null, Number(page.lastInsertRowid));
    if (!domain) return;
    const isLast = i === journey.steps.length - 1;
    // Skracacze linków są wspólne dla wielu niezależnych nadawców – oznaczamy je jako „generic”,
    // żeby nie łączyły kampanii.
    const dn = upsertEntity('domain', domain, domain, { ...(isLast ? { platform: true } : {}), ...(s.kind === 'shortener' ? { generic: true } : {}) }, ts);
    if (i === 0) addEdge(`ad:${adId}`, dn, 'LINKS_TO', { evidenceId: evId, source: 'redirect_tracker', ts });
    if (prevDomain && prevDomain !== dn) addEdge(prevDomain, dn, 'REDIRECTS_TO', { evidenceId: evId, source: 'redirect_tracker', ts });
    prevDomain = dn;
    for (const t of s.trackers || []) addEdge(dn, upsertEntity('tracker', t, t, {}, ts), 'USES_TRACKER', { evidenceId: evId, source: 'page_html', ts });
    for (const c of s.contacts || []) {
      if (c.kind === 'phone') addEdge(dn, upsertEntity('phone', c.value, c.value, {}, ts), 'USES_PHONE', { evidenceId: evId, source: 'page_html', ts });
      if (c.kind === 'email') addEdge(dn, upsertEntity('email', c.value, c.value, {}, ts), 'USES_EMAIL', { evidenceId: evId, source: 'page_html', ts });
    }
    if (s.ip) addEdge(dn, upsertEntity('ip', s.ip, s.ip, {}, ts), 'HOSTED_ON', { evidenceId: evId, source: 'dns', ts });
    if (s.company) addEdge(dn, upsertEntity('company', s.company, s.company, {}, ts), 'OPERATED_BY', { evidenceId: evId, source: 'page_html', ts });
  });
  return chainId;
}

/** Wzbogacenie domeny: dane WHOIS/RDAP + rejestry (lista ostrzeżeń, licencje). */
export function applyEnrichment(domain, meta, ts = now()) {
  const db = openDb();
  const dn = upsertEntity('domain', domain, domain, meta, ts);
  addEvidence({ kind: 'whois', url: `rdap:${domain}`, content: { domain, ...meta }, source: meta.source || 'rdap', reason: 'Dane rejestracyjne domeny', ts });
  const warn = db.prepare('SELECT * FROM warning_list WHERE domain=?').get(domain);
  if (warn) {
    const evId = addEvidence({ kind: 'warning_list', url: domain, content: warn, source: warn.source, reason: `Domena na liście ostrzeżeń: ${warn.source}`, ts });
    const list = upsertEntity('report', `warning:${warn.source}`, warn.source, { kind: 'warning_list' }, ts);
    addEdge(dn, list, 'MENTIONED_IN_WARNING_LIST', { evidenceId: evId, source: warn.source, ts });
    upsertEntity('domain', domain, domain, { warning_list: warn.source, warning_name: warn.name }, ts);
  }
  const lic = db.prepare('SELECT * FROM licensed_entities WHERE domain=?').get(domain);
  if (lic) {
    const co = upsertEntity('company', lic.name, lic.name, { regulator: lic.regulator, license_no: lic.license_no }, ts);
    addEdge(dn, co, 'OPERATED_BY', { source: lic.regulator, ts });
    upsertEntity('domain', domain, domain, { licensed: `${lic.regulator} ${lic.license_no}` }, ts);
  }
}

export function addUserReport({ adId = null, description, phone = null, url = null, ts = now() }) {
  const db = openDb();
  const r = db.prepare('INSERT INTO user_reports(ad_id,description,phone,url,created_at) VALUES (?,?,?,?,?)').run(adId, description, phone, url, ts);
  const id = Number(r.lastInsertRowid);
  const evId = addEvidence({ adId, kind: 'user_report', url, content: { description, phone, url }, source: 'user_report', reason: 'Zgłoszenie użytkownika', ts });
  const node = upsertEntity('report', `user:${id}`, `Zgłoszenie #${id}`, { description }, ts);
  if (phone) addEdge(node, upsertEntity('phone', phone, phone, {}, ts), 'REPORTED_IN', { evidenceId: evId, source: 'user_report', ts });
  if (url && domainOf(url)) addEdge(node, upsertEntity('domain', domainOf(url), domainOf(url), {}, ts), 'REPORTED_IN', { evidenceId: evId, source: 'user_report', ts });
  if (adId) addEdge(node, `ad:${adId}`, 'REPORTED_IN', { evidenceId: evId, source: 'user_report', ts });
  return id;
}

async function rdapLookup(domain) {
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/rdap+json' } });
    if (!res.ok) return { source: 'rdap', error: `HTTP ${res.status}` };
    const j = await res.json();
    const reg = j.events?.find((e) => e.eventAction === 'registration')?.eventDate;
    const registrar = j.entities?.find((e) => e.roles?.includes('registrar'))?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3];
    const redacted = JSON.stringify(j).toLowerCase().includes('redacted');
    return { source: 'rdap', registered_at: reg || null, registrar: registrar || null, whois_hidden: redacted };
  } catch (e) { return { source: 'rdap', error: String(e.message || e) }; }
}

/** Pełne skanowanie prawdziwej reklamy: AI + przekierowania + RDAP. */
export async function scanAndTrack(adId) {
  const db = openDb();
  const ad = db.prepare('SELECT * FROM ads WHERE id=?').get(adId);
  if (!ad) throw new Error('Nie ma takiej reklamy');
  const scan = await scanAd(ad.text);
  applyScan(adId, scan);
  const result = { scan, journey: null, errors: [] };
  if (ad.target_url) {
    try {
      const journey = await trackRedirects(ad.target_url);
      applyJourney(adId, journey);
      result.journey = journey;
      const domains = [...new Set(journey.steps.map((s) => domainOf(s.url)).filter(Boolean))];
      for (const d of domains) applyEnrichment(d, await rdapLookup(d));
    } catch (e) { result.errors.push(`Redirect Tracker: ${e.message}`); }
  }
  return result;
}

/**
 * „Odcisk” reklamy: identyfikatory z JEJ WŁASNEJ ścieżki (domeny z ostatniego łańcucha przekierowań)
 * oraz bezpośrednio powiązane z nimi telefony/e-maile/trackery/IP/firmy. Nie przechodzimy po
 * REDIRECTS_TO innych reklam, żeby wspólny skracacz czy formularz nie „doklejał” cudzych platform.
 */
export function adFootprint(adId) {
  const db = openDb();
  const out = new Map();
  const node = (id) => db.prepare('SELECT type, meta FROM entities WHERE id=?').get(id);
  const direct = db.prepare(`SELECT e.dst, e.rel FROM edges e WHERE e.src=? AND e.rel IN
    ('USES_PHONE','USES_EMAIL','USES_TRACKER','HOSTED_ON','OPERATED_BY','MENTIONED_IN_WARNING_LIST')`);
  const put = (id, extra = {}) => { const n = node(id); if (n) out.set(id, { type: n.type, meta: { ...json(n.meta, {}), ...extra } }); };
  for (const r of direct.all(`ad:${adId}`)) put(r.dst);
  const chain = db.prepare('SELECT id FROM redirect_chains WHERE ad_id=? ORDER BY id DESC LIMIT 1').get(adId);
  if (chain) {
    const steps = db.prepare('SELECT url FROM redirect_steps WHERE chain_id=? ORDER BY position').all(chain.id);
    steps.forEach((s, i) => {
      const d = domainOf(s.url);
      if (!d) return;
      const id = `domain:${d}`;
      put(id, { role: i === steps.length - 1 ? 'platform' : 'intermediate' });
      for (const r of direct.all(id)) if (!out.has(r.dst)) put(r.dst);
    });
  }
  return out;
}
