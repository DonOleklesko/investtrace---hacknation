// Risk Score (wyjaśnialny), wykrywanie duplikatów, kampanie i propagacja ryzyka w grafie.
import { openDb, now, weights, levelFor, json, addEdge } from './db.js';
import { adFootprint } from './pipeline.js';

const SHAREABLE = new Set(['phone', 'email', 'tracker']);
const CLUSTER_TYPES = new Set(['domain', 'phone', 'email', 'tracker']);
const HIGH_RISK = 50;
const DECAY = 0.5;

/**
 * Suma wag sygnałów → wynik 0–100 z nasyceniem: 100·(1 − e^(−punkty/60)).
 * Dzięki temu kolejne sygnały wciąż podnoszą wynik (ranking się różnicuje), ale nigdy nie przekracza 100.
 * Przykłady: 15 pkt → 22, 30 → 39, 50 → 57, 100 → 81, 150 → 92.
 */
export const pointsToScore = (points) => (points <= 0 ? 0 : Math.round(100 * (1 - Math.exp(-points / 60))));

const daysBetween =(a, b) => (new Date(b) - new Date(a)) / 86400000;

function shingles(text) {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const s = new Set();
  for (let i = 0; i + 2 < words.length; i++) s.add(words.slice(i, i + 3).join(' '));
  return s;
}
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Wykrywa podobne reklamy publikowane przez RÓŻNE konta (krawędź SIMILAR_TO). */
export function detectDuplicates(threshold = 0.4) {
  const ads = openDb().prepare('SELECT id, advertiser_id, text, detected_at FROM ads').all();
  const sh = ads.map((a) => shingles(a.text));
  let n = 0;
  for (let i = 0; i < ads.length; i++) for (let j = i + 1; j < ads.length; j++) {
    if (ads[i].advertiser_id === ads[j].advertiser_id) continue;
    const sim = jaccard(sh[i], sh[j]);
    if (sim >= threshold) {
      addEdge(`ad:${ads[i].id}`, `ad:${ads[j].id}`, 'SIMILAR_TO', { source: 'similarity:shingles', confidence: Math.round(sim * 100) / 100, ts: ads[j].detected_at });
      n++;
    }
  }
  return n;
}

/** Sygnały bazowe jednej reklamy (bez sygnałów zależnych od innych reklam). */
export function baseSignals(ad, footprint, W, ts = now()) {
  const sig = [];
  const add = (code, detail, evidence_id = null) => { const w = W[code]; if (w) sig.push({ code, label: w.label, weight: w.weight, detail, evidence_id }); };
  const scan = json(ad.scan_json, null);
  if (scan) {
    const q = (arr) => arr.slice(0, 2).map((x) => `„${x.quote}”`).join(' · ');
    if (scan.profit_promises?.length) add('PROFIT_PROMISE', q(scan.profit_promises));
    if (scan.urgency_pressure?.length) add('URGENCY', q(scan.urgency_pressure));
    if (scan.authority_abuse?.length) add('AUTHORITY_ABUSE', q(scan.authority_abuse));
    if (scan.fake_social_proof?.length) add('FAKE_SOCIAL_PROOF', q(scan.fake_social_proof));
    if (scan.crypto_or_forex_keywords?.length) add('CRYPTO_FOREX', q(scan.crypto_or_forex_keywords));
    const msg = scan.contact_data?.filter((c) => c.kind === 'whatsapp' || c.kind === 'telegram');
    if (msg?.length) add('MESSENGER_CONTACT', msg.map((c) => c.value).join(', '));
  }
  const db = openDb();
  const chain = db.prepare('SELECT * FROM redirect_chains WHERE ad_id=? ORDER BY id DESC LIMIT 1').get(ad.id);
  if (chain) {
    if (chain.cloaking) add('CLOAKING', chain.cloaking_note || 'Różna ścieżka dla bota i przeglądarki');
    const pages = db.prepare('SELECT p.* FROM redirect_steps s JOIN pages p ON p.id=s.page_id WHERE s.chain_id=? ORDER BY s.position').all(chain.id);
    const leadForm = pages.find((p) => json(p.forms, []).some((f) => f.fields.some((x) => /phone|tel|telefon/i.test(x))));
    if (leadForm) add('LEAD_FORM', `Formularz na ${leadForm.domain} zbiera: ${json(leadForm.forms, [])[0].fields.join(', ')}`);
  }
  const domains = [...footprint].filter(([, v]) => v.type === 'domain');
  const young = domains.find(([, v]) => v.meta.registered_at && daysBetween(v.meta.registered_at, ad.detected_at) < 30);
  if (young) add('YOUNG_DOMAIN', `${young[0].slice(7)} zarejestrowana ${Math.max(0, Math.round(daysBetween(young[1].meta.registered_at, ad.detected_at)))} dni przed wykryciem reklamy`);
  const hidden = domains.find(([, v]) => v.meta.whois_hidden && v.meta.offshore);
  if (hidden) add('HIDDEN_WHOIS', `${hidden[0].slice(7)}: WHOIS ukryty, hosting ${hidden[1].meta.hosting || 'offshore'}`);
  const warned = domains.find(([, v]) => v.meta.warning_list);
  if (warned) add('WARNING_LIST', `${warned[0].slice(7)} – ${warned[1].meta.warning_list} („${warned[1].meta.warning_name}”)`);
  const platform = domains.find(([, v]) => v.meta.role === 'platform');
  const licensed = domains.find(([, v]) => v.meta.licensed);
  if (licensed) add('LICENSED', `${licensed[0].slice(7)}: ${licensed[1].meta.licensed}`);
  else if (platform && scan && (scan.profit_promises?.length || scan.crypto_or_forex_keywords?.length)) add('UNLICENSED', `Platforma docelowa ${platform[0].slice(7)} nie figuruje w rejestrze licencji`);
  return sig;
}

/** Przelicza wszystko: duplikaty → sygnały bazowe → sygnały sieciowe → propagacja → kampanie. */
export function recomputeAll() {
  const db = openDb();
  const ts = now();
  const W = weights();
  detectDuplicates();
  const ads = db.prepare('SELECT * FROM ads').all();
  const fp = new Map(ads.map((a) => [a.id, adFootprint(a.id)]));

  // 1) sygnały bazowe
  const signals = new Map();
  const base = new Map();
  for (const ad of ads) {
    const s = baseSignals(ad, fp.get(ad.id), W, ts);
    signals.set(ad.id, s);
    base.set(ad.id, pointsToScore(s.reduce((t, x) => t + x.weight, 0)));
  }

  // indeks: encja → reklamy, które ją „dotykają”
  const byEntity = new Map();
  for (const [adId, f] of fp) for (const [eid, v] of f) {
    if (!CLUSTER_TYPES.has(v.type) || v.meta.licensed || v.meta.generic) continue;
    if (!byEntity.has(eid)) byEntity.set(eid, new Set());
    byEntity.get(eid).add(adId);
  }
  const similar = db.prepare(`SELECT src,dst,confidence FROM edges WHERE rel='SIMILAR_TO'`).all();
  const reportsByEntity = new Map();
  for (const r of db.prepare(`SELECT e.src, e.dst FROM edges e WHERE e.rel='REPORTED_IN' AND e.src LIKE 'report:user:%'`).all()) {
    if (!reportsByEntity.has(r.dst)) reportsByEntity.set(r.dst, new Set());
    reportsByEntity.get(r.dst).add(r.src);
  }

  // 2) sygnały sieciowe
  for (const ad of ads) {
    const s = signals.get(ad.id);
    const add = (code, detail) => { const w = W[code]; if (w) s.push({ code, label: w.label, weight: w.weight, detail, evidence_id: null }); };
    const shared = [];
    for (const [eid, v] of fp.get(ad.id)) {
      if (!SHAREABLE.has(v.type)) continue;
      const others = [...(byEntity.get(eid) || [])].filter((o) => o !== ad.id && base.get(o) >= HIGH_RISK);
      if (others.length) shared.push(`${eid.split(':')[0]} ${eid.slice(eid.indexOf(':') + 1)} → ${others.length} reklam(y) wysokiego ryzyka`);
    }
    if (shared.length) add('SHARED_IDENTIFIER', shared.slice(0, 3).join('; '));
    const dup = similar.filter((e) => e.src === `ad:${ad.id}` || e.dst === `ad:${ad.id}`);
    if (dup.length) add('DUPLICATE_AD', `${dup.length} podobnych reklam z innych kont (max podobieństwo ${Math.max(...dup.map((d) => d.confidence))})`);
    const reports = new Set();
    for (const [eid] of fp.get(ad.id)) for (const r of reportsByEntity.get(eid) || []) reports.add(r);
    for (const r of reportsByEntity.get(`ad:${ad.id}`) || []) reports.add(r);
    if (reports.size) add('USER_REPORTS', `${reports.size} zgłoszeń użytkowników dot. danych z tej ścieżki`);
  }

  const pointsOf = (id) => signals.get(id).reduce((t, x) => t + x.weight, 0);
  const scoreOf = (id) => pointsToScore(pointsOf(id));

  // 3) graf reklama–reklama (wspólna encja lub podobieństwo) do propagacji i kampanii
  const adj = new Map(ads.map((a) => [a.id, new Set()]));
  for (const set of byEntity.values()) for (const a of set) for (const b of set) if (a !== b) adj.get(a).add(b);
  for (const e of similar) { const a = +e.src.slice(3), b = +e.dst.slice(3); adj.get(a)?.add(b); adj.get(b)?.add(a); }

  // 4) propagacja z wygaszaniem DECAY^hops
  const insScore = db.prepare(`INSERT INTO risk_scores(ad_id,points,base_score,propagated,propagated_from,score,level,computed_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(ad_id) DO UPDATE SET points=excluded.points, base_score=excluded.base_score, propagated=excluded.propagated, propagated_from=excluded.propagated_from,
    score=excluded.score, level=excluded.level, computed_at=excluded.computed_at`);
  db.exec('DELETE FROM risk_signals');
  const insSig = db.prepare('INSERT INTO risk_signals(ad_id,code,label,weight,detail,evidence_id) VALUES (?,?,?,?,?,?)');
  for (const ad of ads) {
    const own = scoreOf(ad.id);
    let best = 0, from = null;
    const seen = new Set([ad.id]); let frontier = [ad.id];
    for (let hop = 1; hop <= 3 && frontier.length; hop++) {
      const next = [];
      for (const f of frontier) for (const n of adj.get(f)) if (!seen.has(n)) {
        seen.add(n); next.push(n);
        const p = Math.round(scoreOf(n) * DECAY ** hop);
        if (p > best) { best = p; from = n; }
      }
      frontier = next;
    }
    const propagated = best > own ? best : 0;
    const final = Math.max(own, propagated);
    for (const s of signals.get(ad.id)) insSig.run(ad.id, s.code, s.label, s.weight, s.detail, s.evidence_id);
    if (propagated) insSig.run(ad.id, 'PROPAGATED', 'Ryzyko przeniesione z powiązanej reklamy', 0, `Reklama #${from} (${scoreOf(from)} × wygaszanie) → ${propagated}`, null);
    insScore.run(ad.id, pointsOf(ad.id), own, propagated, propagated ? from : null, final, levelFor(final), ts);
  }

  // 5) kampanie = spójne składowe grafu reklama–reklama (min. 2 reklamy)
  db.exec('UPDATE ads SET campaign_id=NULL; DELETE FROM campaigns;');
  const visited = new Set();
  for (const ad of ads) {
    if (visited.has(ad.id)) continue;
    const comp = []; const stack = [ad.id]; visited.add(ad.id);
    while (stack.length) { const c = stack.pop(); comp.push(c); for (const n of adj.get(c)) if (!visited.has(n)) { visited.add(n); stack.push(n); } }
    if (comp.length < 2) continue;
    const counts = new Map();
    for (const id of comp) for (const [eid, v] of fp.get(id)) if (v.type === 'domain' && v.meta.role === 'platform') counts.set(eid, (counts.get(eid) || 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]?.slice(7) || `reklama #${comp[0]}`;
    const c = db.prepare('INSERT INTO campaigns(name,created_at) VALUES (?,?)').run(`Kampania → ${top}`, ts);
    const cid = Number(c.lastInsertRowid);
    const upd = db.prepare('UPDATE ads SET campaign_id=? WHERE id=?');
    for (const id of comp) upd.run(cid, id);
  }
}
