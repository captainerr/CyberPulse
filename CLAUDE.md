# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KEV-CVE-Mapper-Ranker is a security dashboard that maps CISA's Known Exploited Vulnerabilities (KEV) catalog against NVD CVE enrichment and EPSS exploit-probability data, plus breach news, AI-generated daily briefings, and hunting queries. Deployed as a **single Cloudflare Worker** ("kevmap"): the Worker serves the JSON API (`/api/*`) and the built React SPA (static assets with SPA fallback), stores everything in **D1**, and runs background work on **Cron Triggers**. Sized to fit the Workers free plan.

## Commands

### Frontend (`webui/`)
```bash
npm install       # Install dependencies
npm run dev       # Vite dev server on port 5173 (proxies /api → localhost:8787)
npm run build     # TypeScript compile + Vite bundle to dist/ (Worker serves this)
npm run preview   # Preview built output locally
```

### Worker (`worker/`)
```bash
npm install
npm run db:migrate:local   # one-time: apply migrations/ to the local D1 (.wrangler/state)
npm run dev                # wrangler dev --test-scheduled on port 8787
npm run deploy             # wrangler deploy (build webui first)
npm run db:migrate:remote  # apply migrations to the production D1
npm run tail               # live production logs
```

Trigger a cron tick in local dev: `curl "http://localhost:8787/__scheduled?cron=*%2F5+*+*+*+*"` — crons never fire on their own under `wrangler dev`, so a fresh local DB stays empty until you do this (or hit `/api/kev`, which cold-start-loads the catalog).

No test or lint scripts exist. TypeScript strict mode is the primary correctness check — run `npm run build` in `webui/` to catch type errors. The worker is plain ESM JavaScript (no build step; wrangler bundles it).

## Architecture

### Worker (`worker/src/`)

The Worker is the **data layer**: all external data (CISA KEV catalog, NVD enrichment, EPSS scores, briefings) is fetched server-side and persisted in D1. The frontend never calls CISA/NVD/FIRST directly, and no API keys reach the client.

- `index.js` — fetch router for `/api/*` (plain URL matching, no framework), the `scheduled()` cron tick, catalog refresh, and the Serper links endpoint. Non-API requests fall through to the assets binding.
- `db.js` — every D1 query. All functions take the binding (`env.DB`) as their first arg; multi-row writes go through `db.batch()` so a write set costs one subrequest. Schema lives in `migrations/0001_init.sql`.
- `nvd.js` — NVD fetch/parse (CVSS 3.1→3.0→2.0 fallback, patch/advisory references) and EPSS (FIRST.org, batched 100/request, `scope=time-series` for ~30-day history).
- `feeds.js` + `rss.js` — breach-news RSS aggregation with a small hand-rolled RSS/Atom parser (rss-parser needs Node's http stack, which Workers lack), plus the Mastodon Community Pulse feed. Both cache aggregated JSON in the Cache API (30 min / 10 min).
- `briefing.js` — Groq generation, grounding context, `splitDetectionQueries`, and the backfill sweep. Single-flight lock and failure cooldown live in the D1 `meta` table (Workers have no shared process state).

**Background work** replaces the old long-running loops with two Cron Triggers (`wrangler.jsonc`): a `*/5 * * * *` tick and a daily `0 6 * * *` sweep (the briefing hour — edit the cron to change it). Each tick runs, in order: catalog refresh (when >1 h stale), an NVD enrichment batch (25 CVEs, priority ids first then newest; 700 ms spacing with an API key, much smaller/slower without), an EPSS refresh (up to 300 CVEs), and a briefing backfill (1 Groq call per tick, 3 on the daily trigger; skipped while an NVD backlog is draining). The budget keeps a tick under the free plan's 50-subrequests-per-invocation cap — fetch, D1, and Cache API calls all count toward it, which is why writes are batched.

**The NVD "queue"** is the `nvd_priority` D1 table plus a query that orders missing/stale CVEs priority-first, newest-first. `POST /api/nvd/prioritize` inserts priority rows and immediately enriches up to 8 via `ctx.waitUntil`, so rows the user is looking at fill in within seconds; the cron drains the rest.

**Endpoints** (same contract the frontend always used):
- `GET /api/kev?days=N` — catalog joined with NVD + EPSS in D1; `days=0`/omitted → all time; cold-start-loads the catalog if D1 is empty.
- `GET /api/status` — enrichment progress + DB coverage stats (UI polls this).
- `POST /api/nvd/prioritize` — `{ cveIds: string[] }` (max 500).
- `GET /api/links?q=...|cveId=...` — Serper search, ≤3 results, NVD/MITRE domains filtered. Requires `SEARCH_API_KEY`. Best-effort in-isolate throttle; real rate limiting is a Cloudflare WAF rule (see DEPLOY.md).
- `GET /api/breaches` — aggregated RSS, trusted-source allowlist + keyword filters.
- `GET /api/briefing[?date=]`, `GET /api/briefing/dates` — daily Groq briefing archive; the trailing 30 days stay gap-free via the backfill; a backfilled past date is grounded only in data that existed as of that date. Requesting the latest may lazily generate today's (bounded to one Groq call). Requires `GROQ_API_KEY`.
- `GET /api/hunting[?date=]`, `GET /api/hunting/dates` — detection queries (KQL/XQL/SPL) split from the same Groq call as the briefing; never generates on its own.
- `GET /api/social` — Mastodon hashtag posts for Community Pulse.

**Security**: CSP and friends for the SPA come from `webui/public/_headers` (Vite copies it into `dist/`, Workers static assets serve it); API responses set `nosniff`/`no-store` in the `json()` helper.

### Frontend (`webui/src/`)

React 18 + TypeScript + Vite. No state management library — state lives in custom hooks. No env vars or keys; all data goes through same-origin `/api` (dev: Vite proxies to `wrangler dev` on 8787).

**KEV Dashboard data flow:**
1. `hooks/useKevData.ts` fetches `/api/kev?days=N` (default 30-day range; `range` URL param for deep links), re-polls every 15 s while enrichment is incomplete, and calls `/api/nvd/prioritize` so visible un-scored CVEs fill in fast
2. `hooks/useKevFilters.ts` applies search (CVE ID, vendor, product, description), severity/vendor/ransomware filters, and sorting
3. `hooks/useNewsLinks.ts` fetches 1–3 articles per CVE via `/api/links`, stored in localStorage

**Other data flows:** `useOverview.ts` computes Command Center stats/charts client-side from `/api/kev` (5-min auto-refresh); `useBackendStatus.ts` polls `/api/status` every 15 s; `useBreaches.ts` → `/api/breaches`; `useBriefing.ts` / `useHunting.ts` → `/api/briefing` / `/api/hunting` with archive date selectors, markdown via `react-markdown` + `remark-gfm`, shared `.doc-*` CSS.

**Routing** (`App.tsx`): `/` → `OverviewPage` (Command Center), `/catalog` → `KevDashboardPage`, `/breaches` → `BreachesPage`, `/briefing` → `BriefingPage`, `/hunting` → `HuntingPage`

**Key models** (`models/kev.ts`): `KevEntry` (CISA data), `CveEnrichment` (NVD additions, EPSS score/history, patch/advisory references). Exports: CSV (`utils/exportCsv.ts`) and PDF via jspdf (`utils/exportPdf.ts` + `PdfExportModal`).

## Environment Variables / Secrets

All server-side, on the Worker. Local dev: `worker/.dev.vars` (copy from `.dev.vars.example`). Production: `wrangler secret put <NAME>`.

```
SEARCH_API_KEY   # Serper key — required for /api/links
GROQ_API_KEY     # Required for /api/briefing and /api/hunting generation
NVD_API_KEY      # Optional — much faster NVD enrichment
GROQ_MODEL       # Optional var (wrangler.jsonc), default llama-3.3-70b-versatile
```

Optional overrides (vars or .dev.vars): `KEV_CATALOG_URL`, `NVD_API_URL`, `SEARCH_API_URL`, `BREACHES_FEEDS`/`BREACHES_FILTER`/`BREACHES_EXCLUDE`/`TRUSTED_BREACH_SOURCES`, `MASTODON_INSTANCE`/`SOCIAL_TAGS`. The frontend needs no `.env` (the `VITE_*` declarations in `vite-env.d.ts` are vestigial).

## Deployment

`.github/workflows/deploy.yml` on push to `main`: builds `webui/`, applies D1 migrations, `wrangler deploy`. Needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets. One-time setup (D1 creation, `database_id` in `wrangler.jsonc`, secrets) is in `DEPLOY.md`.
