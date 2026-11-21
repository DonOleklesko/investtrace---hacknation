import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_WEIGHTS = [
  ['PROFIT_PROMISE', 'Obietnica gwarantowanego lub wysokiego zysku', 20],
  ['URGENCY', 'Presja czasu', 10],
  ['AUTHORITY_ABUSE', 'Podszywanie się pod osobę publiczną, media lub instytucję', 25],
  ['FAKE_SOCIAL_PROOF', 'Niesprawdzalny dowód społeczny („tysiące inwestorów”)', 5],
  ['CRYPTO_FOREX', 'Słowa kluczowe: krypto / forex / CFD / „bot AI”', 5],
  ['MESSENGER_CONTACT', 'Kontakt wyłącznie przez komunikator (WhatsApp/Telegram)', 5],
  ['LEAD_FORM', 'Formularz zbierający telefon przed ujawnieniem oferty', 5],
  ['YOUNG_DOMAIN', 'Domena młodsza niż 30 dni', 15],
  ['HIDDEN_WHOIS', 'Ukryty WHOIS + hosting offshore', 5],
  ['CLOAKING', 'Cloaking wykryty w przekierowaniach', 20],
  ['WARNING_LIST', 'Podmiot na liście ostrzeżeń (KNF/IOSCO)', 30],
  ['SHARED_IDENTIFIER', 'Wspólny telefon/e-mail/tracker z materiałami wysokiego ryzyka', 15],
  ['DUPLICATE_AD', 'Bardzo podobna reklama publikowana przez inne konto', 5],
  ['USER_REPORTS', 'Zgłoszenia użytkowników dotyczące tych samych danych', 10],
  ['UNLICENSED', 'Oferta usług inwestycyjnych bez licencji regulatora', 20],
  ['LICENSED', 'Podmiot posiada ważną licencję regulatora', -20],
];

export const STATUSES = ['Nowe', 'W analizie', 'Potwierdzone ryzyko', 'Fałszywy alarm', 'Przekazane'];

export const now = () => new Date().toISOString();
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

let db;

export function openDb(file = process.env.INVESTTRACE_DB || join(here, '..', 'data', 'investtrace.db')) {
  if (db) return db;
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  const ins = db.prepare('INSERT OR IGNORE INTO signal_weights(code,label,weight) VALUES (?,?,?)');
  for (const w of DEFAULT_WEIGHTS) ins.run(...w);
  return db;
}

export function resetDb() {
  const d = openDb();
  d.exec(`
    DROP TRIGGER IF EXISTS evidence_no_update; DROP TRIGGER IF EXISTS evidence_no_delete;
    PRAGMA foreign_keys = OFF;
    DELETE FROM analyst_actions; DELETE FROM cases; DELETE FROM risk_scores; DELETE FROM risk_signals;
    DELETE FROM snapshots; DELETE FROM user_reports; DELETE FROM redirect_steps; DELETE FROM redirect_chains;
    DELETE FROM pages; DELETE FROM edges; DELETE FROM evidence; DELETE FROM entities; DELETE FROM ads;
    DELETE FROM advertisers; DELETE FROM campaigns; DELETE FROM warning_list; DELETE FROM licensed_entities;
    DELETE FROM signal_weights;
    PRAGMA foreign_keys = ON;
  `);
  d.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  const ins = d.prepare('INSERT OR IGNORE INTO signal_weights(code,label,weight) VALUES (?,?,?)');
  for (const w of DEFAULT_WEIGHTS) ins.run(...w);
}

export const json = (v, fallback = null) => { try { return JSON.parse(v); } catch { return fallback; } };

export function upsertEntity(type, value, label = value, meta = {}, ts = now()) {
  const id = `${type}:${value}`;
  const d = openDb();
  const existing = d.prepare('SELECT meta FROM entities WHERE id=?').get(id);
  if (existing) {
    const merged = { ...json(existing.meta, {}), ...meta };
    d.prepare('UPDATE entities SET last_seen=max(last_seen,?), meta=?, label=? WHERE id=?')
      .run(ts, JSON.stringify(merged), label, id);
  } else {
    d.prepare('INSERT INTO entities(id,type,value,label,meta,first_seen,last_seen) VALUES (?,?,?,?,?,?,?)')
      .run(id, type, value, label, JSON.stringify(meta), ts, ts);
  }
  return id;
}

export function addEdge(src, dst, rel, { evidenceId = null, source = 'system', confidence = 1, ts = now() } = {}) {
  if (src === dst) return;
  openDb().prepare(`INSERT INTO edges(src,dst,rel,evidence_id,source,confidence,first_seen,last_seen)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(src,dst,rel) DO UPDATE SET last_seen=max(last_seen,excluded.last_seen),
      confidence=max(confidence,excluded.confidence),
      evidence_id=coalesce(edges.evidence_id, excluded.evidence_id)`)
    .run(src, dst, rel, evidenceId, source, confidence, ts, ts);
}

export function addEvidence({ adId = null, kind, url = null, content, source = 'system', reason = null, createdBy = 'system', ts = now() }) {
  const body = typeof content === 'string' ? content : JSON.stringify(content);
  const r = openDb().prepare(`INSERT INTO evidence(ad_id,kind,url,content,sha256,source,reason,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(adId, kind, url, body, sha256(body), source, reason, createdBy, ts);
  return Number(r.lastInsertRowid);
}

export function weights() {
  const m = {};
  for (const r of openDb().prepare('SELECT * FROM signal_weights').all()) m[r.code] = r;
  return m;
}

export function levelFor(score) {
  if (score >= 75) return 'Krytyczny';
  if (score >= 50) return 'Wysoki';
  if (score >= 25) return 'Średni';
  return 'Niski';
}
