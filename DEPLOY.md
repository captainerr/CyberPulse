# Deploying KEVMap to Cloudflare

The app deploys as a **single Cloudflare Worker**: it serves the JSON API (`/api/*`) and
the built React frontend (Workers static assets with SPA fallback). Storage is a **D1**
database; background work (catalog refresh, NVD/EPSS enrichment, the daily briefing)
runs on **Cron Triggers**. Everything fits the Workers free plan.

## One-time setup

1. **Install & authenticate**

   ```bash
   cd worker
   npm install
   npx wrangler login
   ```

2. **Create the D1 database** and wire it up:

   ```bash
   npx wrangler d1 create kevmap
   ```

   Copy the returned `database_id` into `worker/wrangler.jsonc` (replacing
   `REPLACE_WITH_D1_DATABASE_ID`), then apply the schema:

   ```bash
   npm run db:migrate:remote
   ```

3. **Set secrets** (all optional — the core KEV/CVSS/EPSS dashboard works with none):

   ```bash
   npx wrangler secret put NVD_API_KEY      # faster NVD enrichment
   npx wrangler secret put SEARCH_API_KEY   # /api/links (Serper)
   npx wrangler secret put GROQ_API_KEY     # daily briefing + hunting queries
   ```

## Deploy

```bash
cd webui && npm run build     # the Worker serves webui/dist as static assets
cd ../worker && npm run deploy
```

First deploy prints your `*.workers.dev` URL. On cold start the first cron tick (≤5 min)
downloads the CISA catalog and begins enriching CVEs from NVD in batches; the dashboard
works immediately and scores fill in over the next few hours (minutes for rows you're
actually looking at — the UI prioritizes them). Watch progress at `/api/status` or with
`npm run tail`.

## CI/CD

`.github/workflows/deploy.yml` builds and deploys on every push to `main`. Set two
repository secrets: `CLOUDFLARE_API_TOKEN` (API token with **Workers Scripts: Edit** and
**D1: Edit** permissions) and `CLOUDFLARE_ACCOUNT_ID`.

## Configuration notes

- **Briefing hour**: the daily briefing generates at 06:00 UTC — edit the second cron
  expression in `worker/wrangler.jsonc` to change it.
- **Non-secret overrides** (feeds, Mastodon instance, model, catalog URL): add them under
  `vars` in `worker/wrangler.jsonc`; see `worker/.dev.vars.example` for the full list.
- **Rate limiting**: the old app-level limits are now Cloudflare's job. If the site is
  public, add a WAF rate-limiting rule for `/api/links` (each call hits the paid Serper
  API) — e.g. 20 requests/min per IP. The Worker also has a best-effort in-process
  throttle as a backstop.
- **Custom domain**: add a route or custom domain to the Worker in the Cloudflare
  dashboard (Workers & Pages → kevmap → Settings → Domains & Routes).

## Migrating data from a previous deployment

The briefing/hunting archive is worth carrying over (everything else regenerates
automatically). From a copy of the old SQLite file:

```bash
sqlite3 kev_cache.db ".mode insert briefings" "SELECT * FROM briefings;"        > briefings.sql
sqlite3 kev_cache.db ".mode insert hunting_queries" "SELECT * FROM hunting_queries;" >> briefings.sql
npx wrangler d1 execute kevmap --remote --file=briefings.sql
```

## Local development

```bash
cd worker
npm install
npm run db:migrate:local            # one-time: apply schema to the local D1
cp .dev.vars.example .dev.vars      # optional: add API keys
npm run dev                         # Worker on http://localhost:8787

cd ../webui
npm run dev                         # Vite on http://localhost:5173, proxies /api → 8787
```

Cron ticks don't fire automatically in `wrangler dev`; trigger one manually with:

```bash
curl "http://localhost:8787/__scheduled?cron=*%2F5+*+*+*+*"
```

(`npm run dev` already passes `--test-scheduled`, which enables this endpoint).
