// KEVMap Cloudflare Worker: JSON API under /api/*, static SPA via the assets
// binding (SPA fallback is configured in wrangler.jsonc), and all background
// work (catalog refresh, NVD/EPSS enrichment, briefing backfill) in scheduled().

import {
  setMeta, getMeta, getCatalogCount, getCatalogEntries, replaceCatalog,
  countIdsNeedingFetch, filterIdsNeedingFetch, addPriority, getDbStats,
  getBriefing, getBriefingDates, getHuntingQueries, getHuntingQueryDates,
} from './db.js';
import { processNvdBatch, refreshEpss, REFRESH_INTERVAL_MS, NO_SCORE_REFRESH_INTERVAL_MS } from './nvd.js';
import { getBreachItems, makeIsBreachRelated, getSocialItems } from './feeds.js';
import { backfillMissingBriefings, ensureTodayBriefing, cutoffDate } from './briefing.js';

const DEFAULT_KEV_CATALOG_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const DEFAULT_SERPER_URL = 'https://google.serper.dev/search';
const MAX_LINKS = 3;
const SERPER_REQUEST_RESULTS = 10; // ask Serper for more so we still have 3 after filtering

const CATALOG_REFRESH_MS = 60 * 60 * 1000; // hourly, matching the old seeder cadence

// Per-cron-tick work budget, sized for the Workers free plan (50 subrequests per
// invocation, where fetch(), D1 and Cache API calls all count). Paid plans allow
// 1000, so these are simply conservative there.
const NVD_BATCH_PER_TICK = 25;
const EPSS_BATCHES_PER_TICK = 3;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

// ─── Catalog ──────────────────────────────────────────────────────────

/** Download the CISA catalog and replace the persisted copy. Returns the entry count. */
async function refreshCatalog(env) {
  const url = env.KEV_CATALOG_URL || DEFAULT_KEV_CATALOG_URL;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`KEV catalog fetch failed: ${res.status}`);
  const catalog = await res.json();
  const vulns = catalog.vulnerabilities ?? [];
  await replaceCatalog(env.DB, vulns);
  if (catalog.catalogVersion) await setMeta(env.DB, 'catalogVersion', catalog.catalogVersion);
  await setMeta(env.DB, 'catalog_refreshed_at', Date.now());
  return vulns.length;
}

/** Cold-start guard for /api/kev: make sure the catalog table is populated. */
async function ensureCatalog(env) {
  if ((await getCatalogCount(env.DB)) > 0) return;
  await refreshCatalog(env);
}

// ─── Serper news links ────────────────────────────────────────────────

// Best-effort per-isolate throttle for the paid Serper API. Real rate limiting
// belongs in a Cloudflare WAF rate-limiting rule on /api/links (see DEPLOY.md);
// this just stops a single hot isolate from burning quota in a tight loop.
const serperCallTimes = [];
function serperAllowed() {
  const now = Date.now();
  while (serperCallTimes.length && serperCallTimes[0] < now - 60_000) serperCallTimes.shift();
  if (serperCallTimes.length >= 20) return false;
  serperCallTimes.push(now);
  return true;
}

/** Fetch 1-3 organic search results for a CVE (or free-text query) via Serper. */
async function fetchLinksForCve(env, searchQuery, excludeDomain) {
  const apiKey = env.SEARCH_API_KEY?.trim();
  if (!apiKey) throw new Error('SEARCH_API_KEY is not set');

  // Append "vulnerability" only when the query looks like a CVE ID
  const isCveId = /^CVE-\d{4}-\d+$/i.test(searchQuery.trim());
  const query = isCveId ? `${searchQuery} vulnerability` : searchQuery;
  const res = await fetch(env.SEARCH_API_URL || DEFAULT_SERPER_URL, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: SERPER_REQUEST_RESULTS }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Search API error: ${res.status} ${text || res.statusText}`);
  }

  const data = await res.json();
  let organic = data.organic || [];
  // Filter out reference domains already shown in the CVE ID column (NIST, CVE.org,
  // CWE/MITRE), plus any per-request excluded domain (e.g. the breach article's own source).
  const BLOCKED_DOMAINS = ['nvd.nist.gov', 'nist.gov', 'cve.org', 'cwe.mitre.org', 'mitre.org'];
  organic = organic.filter((item) => {
    try {
      const host = new URL(item.link || '').hostname;
      if (BLOCKED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return false;
      if (excludeDomain && (host === excludeDomain || host.endsWith(`.${excludeDomain}`))) return false;
      return true;
    } catch {
      return true;
    }
  });
  return organic.slice(0, MAX_LINKS).map((item) => ({
    title: item.title || item.link || 'Link',
    url: item.link || '',
  }));
}

// ─── API routes ───────────────────────────────────────────────────────

async function handleApi(request, env, ctx, url) {
  const { pathname } = url;
  const method = request.method;

  if (method === 'GET' && pathname === '/api/kev') {
    try {
      await ensureCatalog(env);
      const days = Number(url.searchParams.get('days'));
      const since = Number.isFinite(days) && days > 0 ? cutoffDate(days) : null;
      return json({
        catalogVersion: await getMeta(env.DB, 'catalogVersion'),
        entries: await getCatalogEntries(env.DB, since),
      });
    } catch (err) {
      console.error('[/api/kev]', err.message);
      return json({ error: err.message, entries: [] }, 502);
    }
  }

  if (method === 'POST' && pathname === '/api/nvd/prioritize') {
    const body = await request.json().catch(() => null);
    const cveIds = body?.cveIds;
    if (!Array.isArray(cveIds)) return json({ error: 'cveIds must be an array' }, 400);
    // Bound the work per request: each id triggers DB lookups, so an unbounded
    // array would be a cheap DoS. The dashboard never prioritizes more at once.
    if (cveIds.length > 500) return json({ error: 'cveIds exceeds maximum of 500' }, 400);
    const valid = cveIds.filter((id) => typeof id === 'string' && /^CVE-\d{4}-\d+$/i.test(id));
    const needed = await filterIdsNeedingFetch(env.DB, valid, REFRESH_INTERVAL_MS, NO_SCORE_REFRESH_INTERVAL_MS);
    await addPriority(env.DB, needed);
    // Start filling the most urgent ones right now (bounded); the cron tick
    // drains the rest of the priority table on its normal cadence.
    if (needed.length) ctx.waitUntil(processNvdBatch(env, 8).catch(() => {}));
    return json({ queued: needed.length });
  }

  if (method === 'GET' && pathname === '/api/status') {
    const db = await getDbStats(env.DB);
    const catalogTotal = await getCatalogCount(env.DB);
    const pending = await countIdsNeedingFetch(env.DB, REFRESH_INTERVAL_MS, NO_SCORE_REFRESH_INTERVAL_MS);
    return json({
      seeder: {
        running: pending > 0,
        progress: pending > 0 ? `${pending} queued` : null,
        pending,
        lastRun: await getMeta(env.DB, 'last_tick_at'),
        lastError: await getMeta(env.DB, 'nvd_last_error'),
      },
      db: {
        total: db.total,
        withScore: db.with_score,
        noScore: db.no_score,
        withEpss: db.with_epss,
        lastEpssAt: db.last_epss_at ?? null,
        catalogTotal,
        coverage: catalogTotal ? `${Math.round((db.total / catalogTotal) * 100)}%` : null,
        epssCoverage: catalogTotal ? `${Math.round((db.with_epss / catalogTotal) * 100)}%` : null,
      },
    });
  }

  if (method === 'GET' && pathname === '/api/links') {
    const query = (url.searchParams.get('q') || url.searchParams.get('cveId'))?.trim();
    if (!query) return json({ error: 'Missing cveId or q query parameter' }, 400);
    if (!serperAllowed()) {
      return json({ error: 'Too many search requests; please wait a minute.', links: [] }, 429);
    }
    try {
      const excludeDomain = url.searchParams.get('excludeDomain')?.trim() || undefined;
      return json({ links: await fetchLinksForCve(env, query, excludeDomain) });
    } catch (err) {
      console.error('[/api/links]', err.message);
      return json({ error: err.message || 'Failed to fetch links', links: [] }, 500);
    }
  }

  if (method === 'GET' && pathname === '/api/breaches') {
    try {
      const all = await getBreachItems(env);
      const items = url.searchParams.get('raw') === 'true' ? all : all.filter(makeIsBreachRelated(env));
      return json({ items });
    } catch (err) {
      console.error('[/api/breaches]', err?.message ?? err);
      return json({ items: [], error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  if (method === 'GET' && pathname === '/api/social') {
    try {
      return json(await getSocialItems(env));
    } catch (err) {
      console.error('[/api/social]', err?.message ?? err);
      return json({ items: [], error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  if (method === 'GET' && pathname === '/api/briefing') {
    try {
      const date = url.searchParams.get('date') || null;
      // Latest requested and today's missing → one bounded lazy generation.
      if (!date) await ensureTodayBriefing(env).catch(() => {});
      const briefing = await getBriefing(env.DB, date);
      if (!briefing) {
        const hint = env.GROQ_API_KEY?.trim()
          ? 'No briefing has been generated yet.'
          : 'No briefing available — GROQ_API_KEY is not configured on the backend.';
        return json({ error: hint, briefing: null }, 404);
      }
      return json({ briefing });
    } catch (err) {
      console.error('[/api/briefing]', err.message);
      return json({ error: err.message, briefing: null }, 500);
    }
  }

  if (method === 'GET' && pathname === '/api/briefing/dates') {
    return json({ dates: await getBriefingDates(env.DB) });
  }

  if (method === 'GET' && pathname === '/api/hunting') {
    const date = url.searchParams.get('date') || null;
    const hunting = await getHuntingQueries(env.DB, date);
    if (!hunting) {
      const hint = env.GROQ_API_KEY?.trim()
        ? 'No hunting queries have been generated yet.'
        : 'No hunting queries available — GROQ_API_KEY is not configured on the backend.';
      return json({ error: hint, hunting: null }, 404);
    }
    return json({ hunting });
  }

  if (method === 'GET' && pathname === '/api/hunting/dates') {
    return json({ dates: await getHuntingQueryDates(env.DB) });
  }

  return json({ error: 'Not found' }, 404);
}

// ─── Cron tick ────────────────────────────────────────────────────────

/**
 * One scheduled tick. Stages run in priority order and each is individually
 * fault-isolated; the whole tick is budgeted to stay under the free-plan
 * subrequest cap, so during a large NVD backlog the briefing backfill simply
 * waits a few ticks for the enrichment stage to quiet down.
 */
async function tick(env, { groqBudget }) {
  await setMeta(env.DB, 'last_tick_at', new Date().toISOString());

  // 1. Catalog: refresh hourly (or on first run).
  try {
    const refreshedAt = Number(await getMeta(env.DB, 'catalog_refreshed_at')) || 0;
    if (Date.now() - refreshedAt > CATALOG_REFRESH_MS || (await getCatalogCount(env.DB)) === 0) {
      const count = await refreshCatalog(env);
      console.log(`[seeder] catalog refreshed: ${count} entries`);
    }
  } catch (err) {
    console.error('[seeder] catalog refresh failed:', err.message);
    await setMeta(env.DB, 'nvd_last_error', `catalog: ${err.message}`);
  }

  // 2. NVD enrichment batch (priority ids first, then newest).
  let processed = 0;
  try {
    processed = await processNvdBatch(env, NVD_BATCH_PER_TICK);
    if (processed) console.log(`[seeder] enriched ${processed} CVEs from NVD`);
  } catch (err) {
    console.error('[seeder] NVD batch failed:', err.message);
  }

  // 3. EPSS refresh for enriched CVEs with missing/stale scores.
  try {
    await refreshEpss(env, EPSS_BATCHES_PER_TICK);
  } catch (err) {
    console.error('[epss] failed:', err.message);
  }

  // 4. Briefing backfill — skipped while a big NVD backlog is draining so the
  // tick stays within budget; it catches up within a few ticks either way.
  if (processed < NVD_BATCH_PER_TICK && groqBudget > 0) {
    try {
      await backfillMissingBriefings(env, groqBudget);
    } catch (err) {
      console.error('[briefing] backfill failed:', err.message);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api')) {
      return handleApi(request, env, ctx, url);
    }
    // Static assets + SPA fallback (only reached when the platform routes a
    // non-asset request here; normally assets are served before the Worker).
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    // The daily trigger gets a bigger Groq budget so a multi-day gap (e.g. after
    // the free-tier quota reset) closes promptly; the 5-minute tick tops up one
    // briefing at a time.
    const groqBudget = event.cron === '0 6 * * *' ? 3 : 1;
    ctx.waitUntil(tick(env, { groqBudget }));
  },
};
