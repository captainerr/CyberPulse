// D1 query layer. Every function takes the D1 binding (env.DB) as its first
// argument — Workers get a fresh environment per invocation, so nothing is
// module-global. Multi-row writes go through db.batch() so a whole write set
// costs one round trip (and one subrequest) instead of one per row.

// SQLite/D1 allows 100 bound parameters per statement; 12 columns → 8 rows max.
const CATALOG_INSERT_ROWS_PER_STMT = 8;
const BATCH_STMTS_PER_CALL = 50;

// ─── meta ─────────────────────────────────────────────────────────────

export async function setMeta(db, key, value) {
  await db
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value == null ? null : String(value))
    .run();
}

export async function getMeta(db, key) {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  return row?.value ?? null;
}

// ─── Enrichment (NVD scores) ──────────────────────────────────────────

const UPSERT_ENRICHMENT_SQL = `
  INSERT INTO cve_enrichment (cve_id, base_score, severity, vector_string, published, last_modified, cached_at, references_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(cve_id) DO UPDATE SET
    base_score      = excluded.base_score,
    severity        = excluded.severity,
    vector_string   = excluded.vector_string,
    published       = excluded.published,
    last_modified   = excluded.last_modified,
    cached_at       = excluded.cached_at,
    references_json = excluded.references_json
`;

function enrichmentStmt(db, enrichment) {
  return db.prepare(UPSERT_ENRICHMENT_SQL).bind(
    enrichment.cveId,
    enrichment.baseScore ?? null,
    enrichment.severity ?? null,
    enrichment.vectorString ?? null,
    enrichment.published ?? null,
    enrichment.lastModified ?? null,
    Date.now(),
    enrichment.references?.length ? JSON.stringify(enrichment.references) : null,
  );
}

/**
 * Persist a batch of NVD fetch results in one round trip. `results` is
 * [{ cveId, enrichment|null }]; a null enrichment records "fetched, no data"
 * (cached_at set, scores null) so the CVE isn't retried until the refresh window.
 * Also clears any nvd_priority rows for the processed ids.
 */
export async function saveEnrichmentBatch(db, results) {
  if (!results.length) return;
  const stmts = results.map(({ cveId, enrichment }) =>
    enrichmentStmt(db, enrichment ?? { cveId }),
  );
  const ids = results.map((r) => r.cveId);
  stmts.push(
    db.prepare(`DELETE FROM nvd_priority WHERE cve_id IN (${ids.map(() => '?').join(',')})`).bind(...ids),
  );
  await db.batch(stmts);
}

// Only UPDATEs existing NVD-enriched rows — preserves the cached_at sentinel used
// by buildCve to signal "NVD not yet fetched" (null row → cve: null on the frontend).
const UPDATE_EPSS_SQL = `
  UPDATE cve_enrichment SET
    epss_score      = ?,
    epss_percentile = ?,
    epss_cached_at  = ?,
    epss_history    = ?
  WHERE cve_id = ?
`;

export async function saveEpssBatch(db, scores) {
  if (!scores.length) return;
  const stmts = scores.map(({ cveId, epssScore, epssPercentile, epssAt, epssHistory }) =>
    db.prepare(UPDATE_EPSS_SQL).bind(
      epssScore ?? null,
      epssPercentile ?? null,
      epssAt,
      epssHistory != null ? JSON.stringify(epssHistory) : null,
      cveId,
    ),
  );
  for (let i = 0; i < stmts.length; i += BATCH_STMTS_PER_CALL) {
    await db.batch(stmts.slice(i, i + BATCH_STMTS_PER_CALL));
  }
}

/** CVE IDs with NVD data but missing/stale EPSS scores, or missing history (backfill). */
export async function getIdsNeedingEpss(db, refreshIntervalMs, limit) {
  const cutoff = Date.now() - refreshIntervalMs;
  const { results } = await db
    .prepare(`
      SELECT cve_id FROM cve_enrichment
      WHERE cached_at IS NOT NULL
        AND (epss_cached_at IS NULL OR epss_cached_at < ? OR epss_history IS NULL)
      LIMIT ?
    `)
    .bind(cutoff, limit)
    .all();
  return results.map((r) => r.cve_id);
}

// ─── Catalog (CISA KEV metadata) ──────────────────────────────────────

/**
 * Refresh the catalog from a fresh CISA download without a delete-all window:
 * upsert every entry stamped with a new generation number, then sweep rows the
 * new catalog no longer contains. Enrichment rows are untouched.
 */
export async function replaceCatalog(db, vulns) {
  const gen = Date.now();
  const cols = 12;
  const stmts = [];
  for (let i = 0; i < vulns.length; i += CATALOG_INSERT_ROWS_PER_STMT) {
    const chunk = vulns.slice(i, i + CATALOG_INSERT_ROWS_PER_STMT);
    const placeholders = chunk.map(() => `(${Array(cols).fill('?').join(',')})`).join(',');
    const params = chunk.flatMap((v) => [
      v.cveID,
      v.vendorProject ?? null,
      v.product ?? null,
      v.vulnerabilityName ?? null,
      v.dateAdded ?? null,
      v.shortDescription ?? null,
      v.requiredAction ?? null,
      v.dueDate ?? null,
      v.knownRansomwareCampaignUse ?? null,
      v.notes ?? null,
      JSON.stringify(v.cwes ?? []),
      gen,
    ]);
    stmts.push(
      db.prepare(`
        INSERT INTO kev_catalog
          (cve_id, vendor_project, product, vulnerability_name, date_added,
           short_description, required_action, due_date, known_ransomware, notes, cwes, gen)
        VALUES ${placeholders}
        ON CONFLICT(cve_id) DO UPDATE SET
          vendor_project     = excluded.vendor_project,
          product            = excluded.product,
          vulnerability_name = excluded.vulnerability_name,
          date_added         = excluded.date_added,
          short_description  = excluded.short_description,
          required_action    = excluded.required_action,
          due_date           = excluded.due_date,
          known_ransomware   = excluded.known_ransomware,
          notes              = excluded.notes,
          cwes               = excluded.cwes,
          gen                = excluded.gen
      `).bind(...params),
    );
  }
  stmts.push(db.prepare('DELETE FROM kev_catalog WHERE gen != ?').bind(gen));
  for (let i = 0; i < stmts.length; i += BATCH_STMTS_PER_CALL) {
    await db.batch(stmts.slice(i, i + BATCH_STMTS_PER_CALL));
  }
}

export async function getCatalogCount(db) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM kev_catalog').first();
  return row?.n ?? 0;
}

function buildCve(row) {
  // No enrichment row yet → not fetched (caller treats cve === null as "fetch me").
  if (row.cached_at == null) return null;
  return {
    cveId: row.cve_id,
    baseScore: row.base_score,
    severity: row.severity,
    vectorString: row.vector_string,
    published: row.published,
    lastModified: row.last_modified,
    nvdUrl: `https://nvd.nist.gov/vuln/detail/${row.cve_id}`,
    epssScore: row.epss_score ?? null,
    epssPercentile: row.epss_percentile ?? null,
    epssHistory: row.epss_history ? JSON.parse(row.epss_history) : null,
    references: row.references_json ? JSON.parse(row.references_json) : [],
  };
}

function rowToEntry(row) {
  return {
    cveID: row.cve_id,
    vendorProject: row.vendor_project,
    product: row.product,
    vulnerabilityName: row.vulnerability_name,
    dateAdded: row.date_added,
    shortDescription: row.short_description,
    requiredAction: row.required_action,
    dueDate: row.due_date,
    knownRansomwareCampaignUse: row.known_ransomware,
    notes: row.notes,
    cwes: JSON.parse(row.cwes || '[]'),
    cve: buildCve(row),
  };
}

/**
 * Catalog joined with enrichment, newest first.
 * @param {string|null} sinceDate - ISO YYYY-MM-DD cutoff (inclusive), or null for all time.
 * @param {string|null} [untilDate] - ISO YYYY-MM-DD cutoff (inclusive), or null for no upper
 *   bound. Used to ground a briefing backfilled for a past date in only the KEV data that
 *   actually existed as of that date, instead of leaking entries added since.
 */
export async function getCatalogEntries(db, sinceDate, untilDate = null) {
  const conditions = [];
  const params = [];
  if (sinceDate) { conditions.push('c.date_added >= ?'); params.push(sinceDate); }
  if (untilDate) { conditions.push('c.date_added <= ?'); params.push(untilDate); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results } = await db
    .prepare(`
      SELECT c.*, e.base_score, e.severity, e.vector_string, e.published, e.last_modified, e.cached_at,
             e.epss_score, e.epss_percentile, e.epss_history, e.references_json
      FROM kev_catalog c
      LEFT JOIN cve_enrichment e ON e.cve_id = c.cve_id
      ${where}
      ORDER BY c.date_added DESC
    `)
    .bind(...params)
    .all();
  return results.map(rowToEntry);
}

/**
 * Catalog CVE IDs missing enrichment or older than the refresh window —
 * user-prioritized ids first (see /api/nvd/prioritize), then newest first.
 */
export async function getIdsNeedingFetch(db, refreshIntervalMs, limit) {
  const cutoff = Date.now() - refreshIntervalMs;
  const { results } = await db
    .prepare(`
      SELECT c.cve_id
      FROM kev_catalog c
      LEFT JOIN cve_enrichment e ON e.cve_id = c.cve_id
      LEFT JOIN nvd_priority p ON p.cve_id = c.cve_id
      WHERE e.cve_id IS NULL OR e.cached_at < ?
      ORDER BY (p.cve_id IS NOT NULL) DESC, c.date_added DESC
      LIMIT ?
    `)
    .bind(cutoff, limit)
    .all();
  return results.map((r) => r.cve_id);
}

export async function countIdsNeedingFetch(db, refreshIntervalMs) {
  const cutoff = Date.now() - refreshIntervalMs;
  const row = await db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM kev_catalog c
      LEFT JOIN cve_enrichment e ON e.cve_id = c.cve_id
      WHERE e.cve_id IS NULL OR e.cached_at < ?
    `)
    .bind(cutoff)
    .first();
  return row?.n ?? 0;
}

/** Of the given ids, the ones with no enrichment yet or enrichment older than the window. */
export async function filterIdsNeedingFetch(db, cveIds, refreshIntervalMs) {
  const cutoff = Date.now() - refreshIntervalMs;
  const needs = [];
  for (let i = 0; i < cveIds.length; i += 90) {
    const chunk = cveIds.slice(i, i + 90);
    const { results } = await db
      .prepare(`
        SELECT cve_id FROM cve_enrichment
        WHERE cve_id IN (${chunk.map(() => '?').join(',')}) AND cached_at >= ?
      `)
      .bind(...chunk, cutoff)
      .all();
    const fresh = new Set(results.map((r) => r.cve_id));
    needs.push(...chunk.filter((id) => !fresh.has(id)));
  }
  return needs;
}

/** Persist "fetch these first" requests for the cron seeder (and immediate fills). */
export async function addPriority(db, cveIds) {
  if (!cveIds.length) return;
  const now = Date.now();
  const stmts = cveIds.map((id) =>
    db.prepare('INSERT INTO nvd_priority (cve_id, requested_at) VALUES (?, ?) ON CONFLICT(cve_id) DO NOTHING').bind(id, now),
  );
  for (let i = 0; i < stmts.length; i += BATCH_STMTS_PER_CALL) {
    await db.batch(stmts.slice(i, i + BATCH_STMTS_PER_CALL));
  }
}

export async function getDbStats(db) {
  return db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN base_score IS NOT NULL THEN 1 ELSE 0 END) AS with_score,
        SUM(CASE WHEN base_score IS NULL THEN 1 ELSE 0 END) AS no_score,
        SUM(CASE WHEN epss_score IS NOT NULL THEN 1 ELSE 0 END) AS with_epss,
        MAX(epss_cached_at) AS last_epss_at
      FROM cve_enrichment
    `)
    .first();
}

// ─── Executive briefings & hunting queries (one per day) ─────────────

async function saveDoc(db, table, { date, content, model, generatedAt }) {
  await db
    .prepare(`
      INSERT INTO ${table} (date, content, model, generated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        content      = excluded.content,
        model        = excluded.model,
        generated_at = excluded.generated_at
    `)
    .bind(date, content, model ?? null, generatedAt)
    .run();
}

async function getDoc(db, table, date) {
  const row = date
    ? await db.prepare(`SELECT date, content, model, generated_at FROM ${table} WHERE date = ?`).bind(date).first()
    : await db.prepare(`SELECT date, content, model, generated_at FROM ${table} ORDER BY date DESC LIMIT 1`).first();
  if (!row) return null;
  return { date: row.date, content: row.content, model: row.model, generatedAt: row.generated_at };
}

async function getDocDates(db, table) {
  const { results } = await db.prepare(`SELECT date FROM ${table} ORDER BY date DESC`).all();
  return results.map((r) => r.date);
}

export const saveBriefing = (db, doc) => saveDoc(db, 'briefings', doc);
export const getBriefing = (db, date) => getDoc(db, 'briefings', date);
export const getBriefingDates = (db) => getDocDates(db, 'briefings');
export async function hasBriefing(db, date) {
  return !!(await db.prepare('SELECT 1 FROM briefings WHERE date = ?').bind(date).first());
}

export const saveHuntingQueries = (db, doc) => saveDoc(db, 'hunting_queries', doc);
export const getHuntingQueries = (db, date) => getDoc(db, 'hunting_queries', date);
export const getHuntingQueryDates = (db) => getDocDates(db, 'hunting_queries');
