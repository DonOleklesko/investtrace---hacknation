// Zapytania do panelu analityka (read-model)
import { openDb, json, levelFor, STATUSES, now } from './db.js';
import { adFootprint } from './pipeline.js';

const db = () => openDb();

export const maskPhone = (p) => (p ? p.replace(/(\+\d{2})(\d{3})(\d{3})(\d+)/, '$1 $2 *** $4') : p);

export function stats() {
  const d = db();
  const one = (sql) => d.prepare(sql).get().c;
  return {
    ads: one('SELECT count(*) c FROM ads'),
    critical: one(`SELECT count(*) c FROM risk_scores WHERE level='Krytyczny'`),
    high: one(`SELECT count(*) c FROM risk_scores WHERE level='Wysoki'`),
    campaigns: one('SELECT count(*) c FROM campaigns'),
    domains: one(`SELECT count(*) c FROM entities WHERE type='domain'`),
    open_cases: one(`SELECT count(*) c FROM cases WHERE status IN ('Nowe','W analizie')`),
    reports: one('SELECT count(*) c FROM user_reports'),
    by_level: d.prepare('SELECT level, count(*) n FROM risk_scores GROUP BY level').all(),
    by_platform: d.prepare('SELECT platform, count(*) n FROM ads GROUP BY platform ORDER BY n DESC').all(),
  };
}

const AD_ROW = `SELECT a.id, a.platform, a.text, a.target_url, a.detected_at, a.campaign_id, a.source,
  r.score, r.level, r.points, r.base_score, r.propagated, r.propagated_from,
  adv.name advertiser, adv.is_influencer, c.id case_id, c.status, c.assignee, cp.name campaign
  FROM ads a LEFT JOIN risk_scores r ON r.ad_id=a.id LEFT JOIN advertisers adv ON adv.id=a.advertiser_id
  LEFT JOIN cases c ON c.ad_id=a.id LEFT JOIN campaigns cp ON cp.id=a.campaign_id`;

function topFlags(adId, n = 3) {
  return db().prepare('SELECT code,label,weight FROM risk_signals WHERE ad_id=? AND weight>0 ORDER BY weight DESC LIMIT ?').all(adId, n);
}

export function feed(limit = 50) {
  return db().prepare(`${AD_ROW} ORDER BY a.detected_at DESC LIMIT ?`).all(limit).map((r) => ({ ...r, flags: topFlags(r.id) }));
}

export function queue() {
  const conn = db().prepare(`SELECT count(*) c FROM edges WHERE src=? OR dst=?`);
  return db().prepare(`${AD_ROW} WHERE c.status IN ('Nowe','W analizie') ORDER BY r.score DESC, r.points DESC, a.detected_at DESC`).all()
    .map((r) => ({ ...r, connections: conn.get(`ad:${r.id}`, `ad:${r.id}`).c + adFootprint(r.id).size, flags: topFlags(r.id) }));
}

export function journey(adId) {
  const chain = db().prepare('SELECT * FROM redirect_chains WHERE ad_id=? ORDER BY id DESC LIMIT 1').get(adId);
  if (!chain) return null;
  const steps = db().prepare(`SELECT s.position, s.url, s.via, s.http_status, p.domain, p.title, p.kind, p.forms, p.trackers, p.contacts, p.html_sha256
    FROM redirect_steps s LEFT JOIN pages p ON p.id=s.page_id WHERE s.chain_id=? ORDER BY s.position`).all(chain.id)
    .map((s) => {
      const ent = db().prepare('SELECT meta FROM entities WHERE id=?').get(`domain:${s.domain}`);
      return { ...s, forms: json(s.forms, []), trackers: json(s.trackers, []), contacts: json(s.contacts, []), domain_meta: json(ent?.meta, {}) };
    });
  return { chain_id: chain.id, cloaking: !!chain.cloaking, cloaking_note: chain.cloaking_note, created_at: chain.created_at, steps };
}

export function adDetail(id) {
  const ad = db().prepare(`${AD_ROW} WHERE a.id=?`).get(id);
  if (!ad) return null;
  const raw = db().prepare('SELECT scan_json FROM ads WHERE id=?').get(id);
  return {
    ...ad,
    scan: json(raw.scan_json, null),
    signals: db().prepare('SELECT code,label,weight,detail,evidence_id FROM risk_signals WHERE ad_id=? ORDER BY weight DESC').all(id),
    evidence: db().prepare('SELECT id,kind,url,source,reason,sha256,created_by,created_at FROM evidence WHERE ad_id=? ORDER BY created_at').all(id),
    case: db().prepare('SELECT * FROM cases WHERE ad_id=?').get(id),
    actions: db().prepare('SELECT a.* FROM analyst_actions a JOIN cases c ON c.id=a.case_id WHERE c.ad_id=? ORDER BY a.created_at DESC').all(id),
    journey: journey(id),
    footprint: [...adFootprint(id)].map(([eid, v]) => ({ id: eid, type: v.type })),
  };
}

/** Graf: cały lub podgraf wokół `center` (BFS nieskierowany do głębokości `depth`). */
export function graph({ center = null, depth = 2, minRisk = 0, campaign = null } = {}) {
  const d = db();
  const entities = d.prepare('SELECT id,type,label,meta FROM entities').all();
  const edges = d.prepare('SELECT id,src,dst,rel,confidence,source FROM edges').all();
  const scores = new Map(d.prepare('SELECT ad_id, score FROM risk_scores').all().map((r) => [`ad:${r.ad_id}`, r.score]));
  const adCampaign = new Map(d.prepare('SELECT id, campaign_id FROM ads').all().map((r) => [`ad:${r.id}`, r.campaign_id]));
  // ryzyko encji = max ryzyka reklam, w których „odcisku” występuje
  const risk = new Map(scores);
  const camp = new Map(adCampaign);
  for (const [adNode, s] of scores) {
    for (const [eid] of adFootprint(+adNode.slice(3))) {
      if (s > (risk.get(eid) ?? -1)) risk.set(eid, s);
      if (adCampaign.get(adNode) && !camp.has(eid)) camp.set(eid, adCampaign.get(adNode));
    }
  }
  for (const e of edges) if (e.rel === 'PROMOTES') {
    risk.set(e.src, Math.max(risk.get(e.src) ?? 0, scores.get(e.dst) ?? 0));
    if (!camp.has(e.src) && adCampaign.get(e.dst)) camp.set(e.src, adCampaign.get(e.dst));
  }
  const deg = new Map();
  for (const e of edges) { deg.set(e.src, (deg.get(e.src) || 0) + 1); deg.set(e.dst, (deg.get(e.dst) || 0) + 1); }

  let keep = new Set(entities.map((e) => e.id));
  if (center) {
    const adjL = new Map();
    for (const e of edges) { (adjL.get(e.src) || adjL.set(e.src, []).get(e.src)).push(e.dst); (adjL.get(e.dst) || adjL.set(e.dst, []).get(e.dst)).push(e.src); }
    keep = new Set([center]); let frontier = [center];
    for (let i = 0; i < depth; i++) { const nx = []; for (const f of frontier) for (const n of adjL.get(f) || []) if (!keep.has(n)) { keep.add(n); nx.push(n); } frontier = nx; }
  }
  const nodes = entities.filter((e) => keep.has(e.id))
    .map((e) => ({ id: e.id, type: e.type, label: e.label, risk: risk.get(e.id) ?? 0, level: levelFor(risk.get(e.id) ?? 0), degree: deg.get(e.id) || 0, campaign: camp.get(e.id) ?? null, meta: json(e.meta, {}) }))
    .filter((n) => n.risk >= minRisk || n.id === center)
    .filter((n) => !campaign || n.campaign === +campaign);
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edges.filter((e) => ids.has(e.src) && ids.has(e.dst)).map((e) => ({ id: e.id, source: e.src, target: e.dst, rel: e.rel, confidence: e.confidence, via: e.source })) };
}

export function entityDetail(id) {
  const e = db().prepare('SELECT * FROM entities WHERE id=?').get(id);
  if (!e) return null;
  const rel = db().prepare(`SELECT e.rel, e.src, e.dst, e.source, e.confidence, e.first_seen, e.last_seen, e.evidence_id FROM edges e WHERE e.src=? OR e.dst=?`).all(id, id);
  const ads = db().prepare('SELECT id FROM ads').all().filter((a) => adFootprint(a.id).has(id)).map((a) => a.id);
  return { ...e, meta: json(e.meta, {}), relations: rel, ads_using: ads, snapshots: db().prepare('SELECT * FROM snapshots WHERE entity_id=? ORDER BY captured_at DESC').all(id) };
}

export function campaigns() {
  return db().prepare(`SELECT c.id, c.name, count(a.id) ads, count(DISTINCT a.advertiser_id) accounts,
      min(a.detected_at) first_seen, max(a.detected_at) last_seen, max(r.score) max_score, round(avg(r.score)) avg_score
    FROM campaigns c JOIN ads a ON a.campaign_id=c.id LEFT JOIN risk_scores r ON r.ad_id=a.id GROUP BY c.id ORDER BY max_score DESC`).all()
    .map((c) => {
      const ids = db().prepare('SELECT id FROM ads WHERE campaign_id=?').all(c.id).map((r) => r.id);
      const ents = new Map();
      for (const id of ids) for (const [eid, v] of adFootprint(id)) ents.set(eid, v.type);
      const count = (t) => [...ents.values()].filter((x) => x === t).length;
      return { ...c, domains: count('domain'), phones: count('phone'), trackers: count('tracker'), platforms: [...new Set(ids.map((id) => [...adFootprint(id)].find(([, v]) => v.meta.role === 'platform')?.[0]?.slice(7)).filter(Boolean))] };
    });
}

export function campaignDetail(id) {
  const c = campaigns().find((x) => x.id === +id);
  if (!c) return null;
  return { ...c, ads: db().prepare(`${AD_ROW} WHERE a.campaign_id=? ORDER BY r.score DESC`).all(id).map((r) => ({ ...r, flags: topFlags(r.id) })) };
}

export function timeline(limit = 100) {
  const snaps = db().prepare(`SELECT 'snapshot' kind, entity_id ref, captured_at ts, summary, change_type, before_value, after_value FROM snapshots`).all();
  const ads = db().prepare(`SELECT 'ad' kind, 'ad:'||id ref, detected_at ts, 'Wykryto reklamę: '||substr(text,1,80) summary, platform change_type, NULL before_value, NULL after_value FROM ads`).all();
  const reps = db().prepare(`SELECT 'report' kind, 'report:user:'||id ref, created_at ts, 'Zgłoszenie użytkownika: '||substr(description,1,80) summary, 'user_report' change_type, NULL before_value, NULL after_value FROM user_reports`).all();
  const acts = db().prepare(`SELECT 'action' kind, 'ad:'||c.ad_id ref, a.created_at ts, a.actor||': '||coalesce(a.from_status,'')||' → '||coalesce(a.to_status,'')||coalesce(' – '||a.note,'') summary, a.action change_type, NULL before_value, NULL after_value FROM analyst_actions a JOIN cases c ON c.id=a.case_id`).all();
  return [...snaps, ...ads, ...reps, ...acts].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
}

export function search(q) {
  const like = `%${q}%`;
  return {
    entities: db().prepare(`SELECT id,type,label FROM entities WHERE type!='ad' AND (value LIKE ? OR label LIKE ?) LIMIT 30`).all(like, like),
    ads: db().prepare(`${AD_ROW} WHERE a.text LIKE ? OR a.target_url LIKE ? OR adv.name LIKE ? ORDER BY r.score DESC LIMIT 30`).all(like, like, like),
  };
}

export function updateCase(caseId, { status, notes, assignee, tags }, actor = 'analityk') {
  const c = db().prepare('SELECT * FROM cases WHERE id=?').get(caseId);
  if (!c) return null;
  if (status && !STATUSES.includes(status)) throw new Error(`Nieznany status: ${status}`);
  const ts = now();
  db().prepare('UPDATE cases SET status=coalesce(?,status), notes=coalesce(?,notes), assignee=coalesce(?,assignee), tags=coalesce(?,tags), updated_at=? WHERE id=?')
    .run(status ?? null, notes ?? null, assignee ?? null, tags ? JSON.stringify(tags) : null, ts, caseId);
  db().prepare('INSERT INTO analyst_actions(case_id,actor,action,from_status,to_status,note,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(caseId, actor, status && status !== c.status ? 'status_change' : 'update', c.status, status ?? c.status, notes ?? null, ts);
  return db().prepare('SELECT * FROM cases WHERE id=?').get(caseId);
}

export function evidenceManifest(caseId) {
  const c = db().prepare('SELECT * FROM cases WHERE id=?').get(caseId);
  if (!c) return null;
  const detail = adDetail(c.ad_id);
  const evidence = db().prepare('SELECT * FROM evidence WHERE ad_id=? ORDER BY id').all(c.ad_id).map((e) => ({ ...e, content: json(e.content, e.content) }));
  return {
    generated_at: now(),
    disclaimer: 'Raport wskazuje sygnały ryzyka i nie stanowi stwierdzenia popełnienia przestępstwa.',
    case: c, ad: { id: detail.id, platform: detail.platform, advertiser: detail.advertiser, text: detail.text, target_url: detail.target_url, detected_at: detail.detected_at },
    risk: { score: detail.score, level: detail.level, points: detail.points, signals: detail.signals },
    journey: detail.journey, actions: detail.actions, evidence,
  };
}

export function listWeights() { return db().prepare('SELECT * FROM signal_weights ORDER BY weight DESC').all(); }
export function setWeights(list) {
  const st = db().prepare('UPDATE signal_weights SET weight=? WHERE code=?');
  for (const w of list) if (Number.isFinite(+w.weight) && Math.abs(+w.weight) <= 100) st.run(Math.round(+w.weight), w.code);
}

export function userReports() {
  return db().prepare('SELECT * FROM user_reports ORDER BY created_at DESC').all().map((r) => ({ ...r, phone: maskPhone(r.phone) }));
}
