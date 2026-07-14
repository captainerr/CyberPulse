# KEVMap Frontend

React 18 + TypeScript + Vite SPA for the KEVMap dashboard. All data comes from the Worker's `/api` (proxied to `localhost:8787` in dev) — the browser never calls CISA, NVD, or FIRST directly, and **no environment variables or API keys are needed here**.

## Pages

- **Command Center** (`/`) — headline stats (added this week, critical severity, critical EPSS, ransomware-linked, overdue / due-soon SLA), 12-month trend chart, top vendors, EPSS movers with sparklines, backend enrichment status, and the Mastodon "Community Pulse" feed. Auto-refreshes every 5 minutes.
- **KEV Catalog** (`/catalog`) — the main table:
  - **Date range** presets (1/7/14/30/60/90/365 days or all time; default 30), deep-linkable via URL params (`range`, `q`, `month`, `due`, ...)
  - **Search** across CVE ID, vendor, product, and description
  - **Filters** by severity, vendor, and ransomware use; **sortable** columns
  - **CVSS + EPSS** scores from the backend cache; visible un-scored rows are automatically prioritized in the backend's NVD queue and appear within seconds
  - **News/links** column: "Find links" per row (or for all visible rows) fetches 1–3 relevant articles via the backend; persisted in `localStorage`
  - **Exports**: CSV of the filtered rows, PDF report (jspdf), and a print-friendly view
- **Breaches** (`/breaches`) — curated breach/incident news from trusted RSS sources
- **Briefing** (`/briefing`) — daily AI-generated executive briefing with a table of contents and a date-picker archive
- **Hunting** (`/hunting`) — the briefing's detection queries (KQL / XQL / SPL) with copy-ready code blocks, archived per day

## Setup

```bash
cd webui
npm install
npm run dev
```

Open the URL shown (e.g. `http://localhost:5173`). The Vite dev server proxies `/api` to the Worker on port 8787 — start it first (see [worker/README.md](../worker/README.md)) or every page will show connection errors.

## Build

```bash
npm run build     # tsc + vite build → dist/
npm run preview   # serve the built output locally
```

There are no test or lint scripts; TypeScript strict mode (via `npm run build`) is the correctness check. In production the built `dist/` is served by the Worker as static assets (security headers come from `public/_headers`) — see [DEPLOY.md](../DEPLOY.md).

## Structure

- `src/pages/` — one component per route
- `src/hooks/` — all state lives in custom hooks (`useKevData`, `useKevFilters`, `useOverview`, `useBriefing`, ...); no state-management library
- `src/api/` — thin fetch wrappers over the backend endpoints
- `src/models/kev.ts` — `KevEntry` (CISA data) and `CveEnrichment` (NVD + EPSS additions)
- `src/utils/` — CSV/PDF export, EPSS helpers, briefing table-of-contents extraction
