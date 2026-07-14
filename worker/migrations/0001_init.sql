-- KEVMap D1 schema. Mirrors the original node:sqlite schema, plus:
--   kev_catalog.gen  — generation marker so catalog refreshes can upsert + sweep
--                      stale rows without a long delete-all transaction
--   nvd_priority     — replaces the old in-memory NVD priority queue (Workers have
--                      no long-lived process, so "jump the queue" is persisted)

CREATE TABLE cve_enrichment (
  cve_id          TEXT PRIMARY KEY,
  base_score      REAL,
  severity        TEXT,
  vector_string   TEXT,
  published       TEXT,
  last_modified   TEXT,
  cached_at       INTEGER NOT NULL,
  epss_score      REAL,
  epss_percentile REAL,
  epss_cached_at  INTEGER,
  epss_history    TEXT,
  references_json TEXT
);

CREATE TABLE kev_catalog (
  cve_id             TEXT PRIMARY KEY,
  vendor_project     TEXT,
  product            TEXT,
  vulnerability_name TEXT,
  date_added         TEXT,
  short_description  TEXT,
  required_action    TEXT,
  due_date           TEXT,
  known_ransomware   TEXT,
  notes              TEXT,
  cwes               TEXT,
  gen                INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_catalog_date_added ON kev_catalog(date_added);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE briefings (
  date         TEXT PRIMARY KEY,   -- YYYY-MM-DD
  content      TEXT NOT NULL,
  model        TEXT,
  generated_at INTEGER NOT NULL
);

CREATE TABLE hunting_queries (
  date         TEXT PRIMARY KEY,   -- YYYY-MM-DD
  content      TEXT NOT NULL,
  model        TEXT,
  generated_at INTEGER NOT NULL
);

CREATE TABLE nvd_priority (
  cve_id       TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL
);
