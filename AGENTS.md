# AGENTS.md

## Cursor Cloud specific instructions

KEVMap is two independent npm packages, run as two processes in dev (no root `package.json`):

- `worker/` — Cloudflare Worker (API `/api/*` + data layer in local D1). Dev: `npm run dev` (`wrangler dev --test-scheduled`) on port **8787**.
- `webui/` — Vite + React SPA. Dev: `npm run dev` on port **5173**; it proxies `/api` → `localhost:8787`, so the worker must be running for the UI to load data.

Standard commands are documented in `CLAUDE.md`, `README.md`, and each package's `package.json`. There are **no lint or test scripts** — `cd webui && npm run build` (runs `tsc` strict + `vite build`) is the only automated correctness check. The worker is plain ESM JS with no build/typecheck step.

Non-obvious caveats:

- Run `cd worker && npm run db:migrate:local` once before the first `wrangler dev` (creates the local D1 SQLite under `worker/.wrangler/state`). The update script does not do this because it is a one-time bootstrap, not a dependency refresh.
- Crons never fire on their own under `wrangler dev`. A fresh local DB stays empty until you either hit `GET /api/kev` (cold-start-loads the CISA catalog) or force a tick: `curl "http://localhost:8787/__scheduled?cron=*%2F5+*+*+*+*"`. Each tick enriches only a small batch, so CVSS/EPSS coverage fills in slowly (much slower without `NVD_API_KEY`); the catalog itself (~1600 entries) loads immediately.
- Local dev needs no API keys — the core KEV/CVSS/EPSS dashboard, breaches, and catalog work with public endpoints. Optional keys go in `worker/.dev.vars` (copy from `worker/.dev.vars.example`): `GROQ_API_KEY` enables `/api/briefing` + `/api/hunting`, `SEARCH_API_KEY` enables `/api/links`, `NVD_API_KEY` speeds up enrichment. Missing keys just disable those features.
- `wrangler dev` serves static assets from `webui/dist`; run `cd webui && npm run build` at least once so that directory exists (also required before `wrangler deploy`).
