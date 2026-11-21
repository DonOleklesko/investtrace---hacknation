-- InvestTrace – schemat bazy (SQLite; przenośny do PostgreSQL)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS advertisers (
  id          INTEGER PRIMARY KEY,
  platform    TEXT NOT NULL,
  account_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  is_influencer INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (platform, account_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ads (
  id            INTEGER PRIMARY KEY,
  advertiser_id INTEGER REFERENCES advertisers(id),
  platform      TEXT NOT NULL,
  text          TEXT NOT NULL,
  target_url    TEXT,
  language      TEXT DEFAULT 'pl',
  country       TEXT DEFAULT 'PL',
  source        TEXT NOT NULL DEFAULT 'manual',   -- manual | csv | demo | user_report | adapter:*
  detected_at   TEXT NOT NULL,
  campaign_id   INTEGER REFERENCES campaigns(id),
  scan_json     TEXT                              -- wynik AI Ad Scannera
);

-- Węzły grafu: każda reklama, konto, domena, telefon, e-mail, IP, tracker, firma, platforma
CREATE TABLE IF NOT EXISTS entities (
  id          TEXT PRIMARY KEY,                  -- np. 'domain:zysk-dzis24.test', 'phone:+48000000101', 'ad:12'
  type        TEXT NOT NULL,                     -- ad|account|influencer|domain|page|ip|phone|email|tracker|company|platform|report
  value       TEXT NOT NULL,
  label       TEXT NOT NULL,
  meta        TEXT NOT NULL DEFAULT '{}',        -- JSON (WHOIS, wiek domeny, licencja…)
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

CREATE TABLE IF NOT EXISTS edges (
  id          INTEGER PRIMARY KEY,
  src         TEXT NOT NULL REFERENCES entities(id),
  dst         TEXT NOT NULL REFERENCES entities(id),
  rel         TEXT NOT NULL,                     -- PROMOTES|LINKS_TO|REDIRECTS_TO|HOSTED_ON|USES_PHONE|USES_EMAIL|USES_TRACKER|SIMILAR_TO|OPERATED_BY|MENTIONED_IN_WARNING_LIST|REPORTED_IN
  evidence_id INTEGER REFERENCES evidence(id),
  source      TEXT NOT NULL,
  confidence  REAL NOT NULL DEFAULT 1.0,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  UNIQUE (src, dst, rel)
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);

CREATE TABLE IF NOT EXISTS pages (
  id          INTEGER PRIMARY KEY,
  url         TEXT NOT NULL,
  domain      TEXT NOT NULL,
  title       TEXT,
  kind        TEXT,                              -- shortener|news_fake|landing|form|platform|other
  http_status INTEGER,
  html_sha256 TEXT,
  forms       TEXT NOT NULL DEFAULT '[]',        -- JSON: pola formularzy
  trackers    TEXT NOT NULL DEFAULT '[]',        -- JSON: GA/GTM/Pixel ID
  contacts    TEXT NOT NULL DEFAULT '[]',        -- JSON: telefony/e-maile
  fetched_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redirect_chains (
  id          INTEGER PRIMARY KEY,
  ad_id       INTEGER NOT NULL REFERENCES ads(id),
  cloaking    INTEGER NOT NULL DEFAULT 0,
  cloaking_note TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redirect_steps (
  id          INTEGER PRIMARY KEY,
  chain_id    INTEGER NOT NULL REFERENCES redirect_chains(id),
  position    INTEGER NOT NULL,
  url         TEXT NOT NULL,
  via         TEXT NOT NULL,                     -- start|http_301|http_302|meta_refresh|js|form_submit
  http_status INTEGER,
  page_id     INTEGER REFERENCES pages(id)
);

-- Dowody: append-only (patrz triggery niżej)
CREATE TABLE IF NOT EXISTS evidence (
  id          INTEGER PRIMARY KEY,
  ad_id       INTEGER REFERENCES ads(id),
  kind        TEXT NOT NULL,                     -- ad_text|ai_scan|redirect_chain|page_html|whois|warning_list|user_report|analyst_note
  url         TEXT,
  content     TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  source      TEXT NOT NULL,
  reason      TEXT,
  created_by  TEXT NOT NULL DEFAULT 'system',
  created_at  TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS evidence_no_update BEFORE UPDATE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;
CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;

CREATE TABLE IF NOT EXISTS signal_weights (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  weight      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_signals (
  id          INTEGER PRIMARY KEY,
  ad_id       INTEGER NOT NULL REFERENCES ads(id),
  code        TEXT NOT NULL,
  label       TEXT NOT NULL,
  weight      INTEGER NOT NULL,
  detail      TEXT,                              -- cytat / wyjaśnienie
  evidence_id INTEGER REFERENCES evidence(id)
);
CREATE INDEX IF NOT EXISTS idx_signals_ad ON risk_signals(ad_id);

CREATE TABLE IF NOT EXISTS risk_scores (
  ad_id       INTEGER PRIMARY KEY REFERENCES ads(id),
  points      INTEGER NOT NULL DEFAULT 0,        -- suma wag sygnałów
  base_score  INTEGER NOT NULL,                  -- 100·(1−e^(−points/60))
  propagated  INTEGER NOT NULL DEFAULT 0,
  propagated_from INTEGER,
  score       INTEGER NOT NULL,
  level       TEXT NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id          INTEGER PRIMARY KEY,
  ad_id       INTEGER NOT NULL UNIQUE REFERENCES ads(id),
  status      TEXT NOT NULL DEFAULT 'Nowe',      -- Nowe|W analizie|Potwierdzone ryzyko|Fałszywy alarm|Przekazane
  assignee    TEXT,
  notes       TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyst_actions (
  id          INTEGER PRIMARY KEY,
  case_id     INTEGER NOT NULL REFERENCES cases(id),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL
);

-- Historia zmian stron / reklam
CREATE TABLE IF NOT EXISTS snapshots (
  id           INTEGER PRIMARY KEY,
  entity_id    TEXT NOT NULL REFERENCES entities(id),
  captured_at  TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  summary      TEXT NOT NULL,
  change_type  TEXT,                             -- initial|content|phone|redirect|domain|offline
  before_value TEXT,
  after_value  TEXT
);

CREATE TABLE IF NOT EXISTS user_reports (
  id          INTEGER PRIMARY KEY,
  ad_id       INTEGER REFERENCES ads(id),
  description TEXT NOT NULL,
  phone       TEXT,
  url         TEXT,
  created_at  TEXT NOT NULL
);

-- Rejestry referencyjne (w demo fikcyjne; w produkcji import z KNF / IOSCO I-SCAN / ESMA)
CREATE TABLE IF NOT EXISTS warning_list (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  domain      TEXT,
  source      TEXT NOT NULL,
  added_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS licensed_entities (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  domain      TEXT,
  regulator   TEXT NOT NULL,
  license_no  TEXT NOT NULL
);
