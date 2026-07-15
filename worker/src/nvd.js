// NVD enrichment and EPSS scoring. The old Express server ran a long-lived
// in-memory queue; on Workers the same work happens in bounded batches — a cron
// tick (or an on-demand prioritize call) fetches up to N CVEs, writes them in one
// D1 batch, and leaves the rest for the next tick.

import {
  saveEnrichmentBatch, saveEpssBatch, getIdsNeedingFetch, getIdsNeedingEpss, setMeta,
} from './db.js';

const DEFAULT_NVD_API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
// Re-fetch a cached score once it's older than this (NVD re-analyzes scores over time).
export const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
// A newly-published CVE is often fetched before NVD analysts have scored it
// (vulnStatus "Received", no CVSS yet). That's cheap and valuable to retry much
// sooner than the general 7-day window — a few hours usually closes the gap.
export const NO_SCORE_REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000;
// EPSS scores update daily; refresh once per day is sufficient.
export const EPSS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const EPSS_API_URL = 'https://api.first.org/data/v1/epss';
const EPSS_BATCH_SIZE = 100; // FIRST API accepts up to 100 CVE IDs per request

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchFromNvd(env, cveId) {
  const url = `${env.NVD_API_URL || DEFAULT_NVD_API_URL}?cveId=${encodeURIComponent(cveId)}`;
  const headers = { Accept: 'application/json' };
  const key = env.NVD_API_KEY?.trim();
  if (key) headers['apiKey'] = key;

  const res = await fetch(url, { headers });
  if (res.status === 404 || res.status === 400) return null;
  if (res.status === 503 || res.status === 429) {
    throw Object.assign(new Error(`NVD API error: ${res.status} ${res.statusText}`), { retryable: true });
  }
  if (!res.ok) throw new Error(`NVD API error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const vulns = data.vulnerabilities;
  if (!vulns?.length) return null;

  const cve = vulns[0].cve;
  const metrics = cve.metrics ?? {};

  function pickPrimary(arr) {
    if (!arr?.length) return undefined;
    return arr.find((m) => m.type === 'Primary') ?? arr[0];
  }

  const v31 = pickPrimary(metrics.cvssMetricV31)?.cvssData;
  const v30 = pickPrimary(metrics.cvssMetricV30)?.cvssData;
  const v2  = pickPrimary(metrics.cvssMetricV2)?.cvssData;
  const src = v31 ?? v30 ?? v2 ?? null;

  // NVD tags each reference (Patch, Vendor Advisory, Exploit, ...); keep only the
  // ones an analyst actually wants one click away, patch/advisory first, capped
  // small since this rides in every /api/kev response for every entry.
  const WANTED_TAGS = ['Patch', 'Vendor Advisory'];
  const references = (cve.references ?? [])
    .filter((r) => r.tags?.some((t) => WANTED_TAGS.includes(t)))
    .sort((a, b) => WANTED_TAGS.indexOf(a.tags.find((t) => WANTED_TAGS.includes(t)))
                  - WANTED_TAGS.indexOf(b.tags.find((t) => WANTED_TAGS.includes(t))))
    .slice(0, 3)
    .map((r) => ({ url: r.url, tag: r.tags.find((t) => WANTED_TAGS.includes(t)) }));

  return {
    cveId,
    baseScore:    src?.baseScore    ?? null,
    severity:     src?.baseSeverity ?? null,
    vectorString: src?.vectorString ?? null,
    published:    cve.published     ?? null,
    lastModified: cve.lastModified  ?? null,
    nvdUrl:       `https://nvd.nist.gov/vuln/detail/${cveId}`,
    references,
  };
}

/**
 * Enrich up to `limit` CVEs that are missing or stale, priority ids first.
 * Sequential with a spacing delay to respect NVD's rate limit (50 req/30s with an
 * API key, 5 req/30s without). All results land in one D1 batch at the end.
 * Returns the number of CVEs processed.
 */
export async function processNvdBatch(env, limit) {
  const key = env.NVD_API_KEY?.trim();
  const spacing = key ? 700 : 6500;
  const cap = key ? limit : Math.min(limit, 4);

  const ids = await getIdsNeedingFetch(env.DB, REFRESH_INTERVAL_MS, NO_SCORE_REFRESH_INTERVAL_MS, cap);
  if (!ids.length) return 0;

  const results = [];
  for (const cveId of ids) {
    try {
      const enrichment = await fetchFromNvd(env, cveId);
      results.push({ cveId, enrichment });
    } catch (err) {
      // Retryable (429/503) → stop the batch and cool off until the next tick;
      // anything else is recorded and the id is retried next tick too.
      console.error(`[nvd] ${cveId}: ${err.message}`);
      await setMeta(env.DB, 'nvd_last_error', `${cveId}: ${err.message}`);
      if (err.retryable) break;
    }
    if (results.length < ids.length) await delay(spacing);
  }

  if (results.length) await saveEnrichmentBatch(env.DB, results);
  return results.length;
}

/**
 * Fetch EPSS scores from FIRST for the given CVE IDs (batched at EPSS_BATCH_SIZE).
 * Returns raw data array: [{ cve, epss, percentile, date }, ...]
 */
async function fetchEpssScores(cveIds) {
  const results = [];
  for (let i = 0; i < cveIds.length; i += EPSS_BATCH_SIZE) {
    const batch = cveIds.slice(i, i + EPSS_BATCH_SIZE);
    // scope=time-series returns ~30 days of daily history per CVE in the same response.
    const url = `${EPSS_API_URL}?cve=${batch.join(',')}&scope=time-series`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        console.error(`[epss] batch ${Math.floor(i / EPSS_BATCH_SIZE) + 1} failed: ${res.status}`);
        continue;
      }
      const data = await res.json();
      results.push(...(data.data ?? []));
    } catch (err) {
      console.error(`[epss] batch fetch error: ${err.message}`);
    }
  }
  return results;
}

/**
 * Build a chronological (oldest→newest) EPSS history from a FIRST API record.
 * Combines the top-level current point with its time-series array; scores are
 * 0–1 floats. Returns [{ date, score }, ...] sorted ascending by date.
 */
function buildEpssHistory(s) {
  const points = [{ date: s.date, score: parseFloat(s.epss) }];
  for (const p of s['time-series'] ?? []) {
    points.push({ date: p.date, score: parseFloat(p.epss) });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

/**
 * Fetch and persist EPSS scores for up to `maxBatches`×100 NVD-enriched CVEs
 * with missing or stale EPSS data. Returns the number of scores saved.
 */
export async function refreshEpss(env, maxBatches) {
  const ids = await getIdsNeedingEpss(env.DB, EPSS_REFRESH_INTERVAL_MS, maxBatches * EPSS_BATCH_SIZE);
  if (!ids.length) return 0;
  const scores = await fetchEpssScores(ids);
  const now = Date.now();
  await saveEpssBatch(env.DB, scores.map((s) => ({
    cveId: s.cve,
    epssScore: parseFloat(s.epss),
    epssPercentile: parseFloat(s.percentile),
    epssAt: now,
    epssHistory: buildEpssHistory(s),
  })));
  if (scores.length) console.log(`[epss] saved ${scores.length} scores`);
  return scores.length;
}
