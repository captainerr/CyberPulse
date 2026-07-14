# KEVMap Worker

Cloudflare Worker that is the app's **data layer and web server**: it serves the JSON API under `/api/*`, serves the built React SPA (`../webui/dist`) as static assets with SPA fallback, stores everything in **D1**, and runs all background enrichment on **Cron Triggers**. No long-running process anywhere.

## Local development

```bash
npm install
npm run db:migrate:local        # one-time: apply migrations/ to the local D1
cp .dev.vars.example .dev.vars  # optional: add API keys (all optional)
npm run dev                     # http://localhost:8787 (wrangler dev --test-scheduled)
```

Build the frontend once first (`cd ../webui && npm run build`) so the assets directory exists. Cron ticks don't fire on their own in dev — trigger one:

```bash
curl "http://localhost:8787/__scheduled?cron=*%2F5+*+*+*+*"
```

## How the background work runs

Two cron triggers (`wrangler.jsonc`): a `*/5 * * * *` tick and a daily `0 6 * * *` briefing sweep. Each tick, in priority order:

1. **Catalog** — re-download the CISA KEV catalog when >1 h stale (upsert + sweep by generation marker, no delete-all window)
2. **NVD enrichment** — fetch up to 25 missing/stale CVEs (priority ids first, then newest; throttled to NVD's rate limits), written in one D1 batch
3. **EPSS** — refresh up to 300 CVEs' scores + 30-day history from FIRST.org
4. **Briefing backfill** — at most 1 Groq call per tick (3 on the daily trigger) to keep the trailing 30-day briefing archive gap-free; skipped while a big NVD backlog is draining

The per-tick budget keeps an invocation under the Workers free plan's 50-subrequest cap (fetch, D1, and Cache API calls all count).

`POST /api/nvd/prioritize` persists "fetch these first" ids (the dashboard sends the rows you're looking at) and enriches up to 8 immediately via `ctx.waitUntil`, so visible scores land in seconds.

## Layout

- `src/index.js` — fetch router, cron tick, catalog refresh, Serper links endpoint
- `src/db.js` — all D1 queries (batched writes; schema in `migrations/`)
- `src/nvd.js` — NVD fetch/parse + EPSS scoring
- `src/feeds.js`, `src/rss.js` — breach RSS aggregation (hand-rolled RSS/Atom parser) and the Mastodon feed, cached via the Cache API
- `src/briefing.js` — Groq briefing generation, grounding, backfill (D1-meta lock/cooldown)

## Secrets & config

Secrets (`wrangler secret put`, or `.dev.vars` locally): `SEARCH_API_KEY` (Serper, for `/api/links`), `GROQ_API_KEY` (briefing/hunting), `NVD_API_KEY` (optional, faster enrichment). Non-secret overrides go in `wrangler.jsonc` `vars` — see `.dev.vars.example` for the full list.

Deployment (D1 creation, CI/CD, WAF rate-limiting for `/api/links`): see [DEPLOY.md](../DEPLOY.md).
