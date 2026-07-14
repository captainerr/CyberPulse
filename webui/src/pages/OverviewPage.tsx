import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useOverview, EPSS_CRITICAL, CVSS_CRITICAL, computeEpssPressureTrend,
  type MonthBucket, type DayBucket, type VendorCount,
} from '../hooks/useOverview';
import { useBackendStatus } from '../hooks/useBackendStatus';
import { SeverityBadge } from '../components/SeverityBadge';
import { SocialPulse } from '../components/SocialPulse';
import { Skeleton } from '../components/Skeleton';
import type { KevEntry } from '../models/kev';

const NVD_BASE = 'https://nvd.nist.gov/vuln/detail/';
// Nominal window of the Critical EPSS pressure chart. The chart itself may trim a
// trailing day or two whose EPSS refresh hasn't finished (see useOverview), but the
// catalog's date-range dropdown only has fixed presets, so link to the intended 30d.
const EPSS_PRESSURE_RANGE_DAYS = 30;

/** Build a `/catalog?...` link with correctly URL-encoded params. */
function catalogLink(params: Record<string, string>): string {
  return `/catalog?${new URLSearchParams(params).toString()}`;
}

/** "2026-06" -> "June 2026" */
function monthFullLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

/** Fire `cb` on Enter/Space — keyboard-activation twin for onClick on non-button elements. */
function onActivateKey(cb: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      cb();
    }
  };
}

function timeAgo(ms?: number | null): string {
  if (!ms) return '—';
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

function StatTile({ label, value, sub, tone, to }: {
  label: string;
  value: number | string;
  sub: string;
  tone?: 'accent' | 'danger' | 'warn';
  to?: string;
}) {
  const className = `stat-tile${tone ? ` stat-tile-${tone}` : ''}${to ? ' stat-tile-link' : ''}`;
  const body = (
    <>
      <span className="stat-tile-value">{value}</span>
      <span className="stat-tile-label">{label}</span>
      <span className="stat-tile-sub">{sub}</span>
      {to && <span className="stat-tile-cta">View in catalog →</span>}
    </>
  );
  return to ? <Link to={to} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

function AdditionsChart({ data, onSelectMonth }: { data: MonthBucket[]; onSelectMonth: (key: string) => void }) {
  const W = 520, H = 150, padX = 8, padTop = 14, padBottom = 24;
  const max = Math.max(1, ...data.map((d) => d.count));
  const slot = (W - padX * 2) / data.length;
  const barW = slot * 0.62;
  const plotH = H - padTop - padBottom;

  return (
    <svg className="additions-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label="KEV additions per month over the last 12 months. Months with additions are selectable to view them in the catalog.">
      {data.map((d, i) => {
        const h = (d.count / max) * plotH;
        const x = padX + i * slot + (slot - barW) / 2;
        const y = padTop + (plotH - h);
        const clickable = d.count > 0;
        const activate = () => onSelectMonth(d.key);
        return (
          <g
            key={d.key}
            className={clickable ? 'chart-bar-group' : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-label={clickable ? `View ${d.count} KEV${d.count === 1 ? '' : 's'} added in ${monthFullLabel(d.key)}` : undefined}
            onClick={clickable ? activate : undefined}
            onKeyDown={clickable ? onActivateKey(activate) : undefined}
          >
            <rect x={x} y={y} width={barW} height={Math.max(h, d.count > 0 ? 2 : 0)} rx="2"
              className="additions-bar">
              <title>{`${d.label}: ${d.count} added${clickable ? ' — click to view' : ''}`}</title>
            </rect>
            {d.count > 0 && (
              <text x={x + barW / 2} y={y - 3} className="additions-count" textAnchor="middle">{d.count}</text>
            )}
            <text x={x + barW / 2} y={H - 8} className="additions-label" textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function EpssTrendChart({ data, trendDir }: { data: DayBucket[]; trendDir: 'up' | 'down' | 'flat' }) {
  const W = 520, H = 130, padX = 6, padTop = 14, padBottom = 20;
  const counts = data.map((d) => d.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const span = max - min;
  const plotW = W - padX * 2;
  const plotH = H - padTop - padBottom;
  const x = (i: number) => padX + (data.length === 1 ? 0 : (i / (data.length - 1)) * plotW);
  // Auto-scale to the window's own min/max (not zero) so the real swing reads
  // clearly, matching the per-CVE sparkline convention.
  const y = (v: number) => (span === 0 ? padTop + plotH / 2 : padTop + (1 - (v - min) / span) * plotH);

  const linePoints = data.map((d, i) => `${x(i).toFixed(1)},${y(d.count).toFixed(1)}`).join(' ');
  const areaPoints = `${padX},${padTop + plotH} ${linePoints} ${x(data.length - 1).toFixed(1)},${padTop + plotH}`;
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const last = data[data.length - 1];

  return (
    <svg className={`epss-trend-chart epss-pressure-${trendDir}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label={`Count of catalog CVEs at or above the critical EPSS threshold, last ${data.length} days, trending ${trendDir}`}>
      <defs>
        <linearGradient id="epssTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="epss-trend-stop-start" />
          <stop offset="100%" className="epss-trend-stop-end" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} className="epss-trend-area" />
      <polyline points={linePoints} className="epss-trend-line" fill="none" />
      {data.map((d, i) => (
        (i % labelEvery === 0 || i === data.length - 1) && (
          <text key={d.date} x={x(i)} y={H - 5} textAnchor="middle" className="epss-trend-label">{d.label}</text>
        )
      ))}
      {last && <circle cx={x(data.length - 1)} cy={y(last.count)} r="2.6" className="epss-trend-dot" />}
    </svg>
  );
}

function VendorLeaderboard({ vendors, onSelectVendor }: { vendors: VendorCount[]; onSelectVendor: (vendor: string) => void }) {
  const max = Math.max(1, ...vendors.map((v) => v.count));
  return (
    <ol className="vendor-list">
      {vendors.map((v, i) => {
        const activate = () => onSelectVendor(v.vendor);
        return (
          <li
            key={v.vendor}
            className="vendor-row vendor-row-clickable"
            role="button"
            tabIndex={0}
            aria-label={`View ${v.count} KEV${v.count === 1 ? '' : 's'} from ${v.vendor}`}
            onClick={activate}
            onKeyDown={onActivateKey(activate)}
          >
            <span className="vendor-rank">{i + 1}</span>
            <span className="vendor-name">{v.vendor}</span>
            <div className="vendor-bar-track">
              <div className="vendor-bar-fill" style={{ width: `${(v.count / max) * 100}%` }} />
            </div>
            <span className="vendor-count">{v.count}</span>
            <span className="vendor-pct">{v.pctOfCatalog.toFixed(1)}%</span>
          </li>
        );
      })}
    </ol>
  );
}

function TopRow({ entry, rank, today }: { entry: KevEntry; rank: number; today: string }) {
  const epss = entry.cve?.epssScore;
  const overdue = !!entry.dueDate && entry.dueDate < today;
  const ransomware = entry.knownRansomwareCampaignUse === 'Known';
  return (
    <li className="top-row">
      <span className="top-rank">{rank}</span>
      <div className="top-main">
        <div className="top-line1">
          <Link to={catalogLink({ q: entry.cveID, range: '0' })} className="top-cve">
            {entry.cveID}
          </Link>
          <a href={`${NVD_BASE}${entry.cveID}`} target="_blank" rel="noopener noreferrer" className="top-cve-nvd" title="View on NVD">
            NVD↗
          </a>
          <SeverityBadge cve={entry.cve} />
          {ransomware && <span className="pill pill-danger" title="Known ransomware campaign use">Ransomware</span>}
          {overdue && <span className="pill pill-warn" title={`CISA due date passed (${entry.dueDate})`}>Overdue</span>}
        </div>
        <div className="top-line2">{entry.vendorProject} · {entry.product}</div>
      </div>
      <div className="top-epss">
        <span className="top-epss-val">{epss != null ? `${(epss * 100).toFixed(1)}%` : '—'}</span>
        <span className="top-epss-cap">EPSS</span>
      </div>
    </li>
  );
}

export const OverviewPage: React.FC = () => {
  const { data, loading, error, fetchedAt } = useOverview();
  const { status, backendUnreachable } = useBackendStatus();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const pressureTrend = data ? computeEpssPressureTrend(data.epssTrend) : null;

  // Month drill-in needs the full all-time dataset (the clicked month can fall
  // outside the catalog's default 30-day window), so always pair it with range=0.
  const handleSelectMonth = (key: string) => navigate(catalogLink({ month: key, range: '0' }));
  const handleSelectVendor = (vendor: string) => navigate(catalogLink({ vendor, range: '0' }));
  const handleSelectEpssPressure = () =>
    navigate(catalogLink({ sort: 'epssTrend', range: String(EPSS_PRESSURE_RANGE_DAYS) }));

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="header-row">
          <div>
            <h1>Command Center</h1>
            <p className="app-subtitle">Known Exploited Vulnerabilities — live situational overview</p>
          </div>
          <Link to="/catalog" className="btn btn-refresh">View full catalog →</Link>
        </div>
        <div className="freshness-strip" aria-label="Data freshness">
          <span>KEV <strong>{data?.catalogVersion ?? '—'}</strong></span>
          <span>{data ? data.stats.total.toLocaleString() : '—'} CVEs</span>
          <span>NVD enrichment <strong>{status?.db.coverage ?? '—'}</strong></span>
          <span>EPSS updated <strong>{timeAgo(status?.db.lastEpssAt)}</strong></span>
          <span>Data updated <strong>{timeAgo(fetchedAt)}</strong></span>
        </div>
      </header>

      <main className="app-main">
        {backendUnreachable && data && (
          <div className="banner banner-error" role="alert">
            Backend unreachable — showing data from {timeAgo(fetchedAt)}. Retrying automatically…
          </div>
        )}
        {error ? (
          <div className="banner banner-error" role="alert">{error}</div>
        ) : loading || !data ? (
          <div role="status" aria-busy="true" aria-label="Loading overview">
            <section className="stat-tiles">
              {Array.from({ length: 4 }).map((_, i) => (
                <div className="stat-tile" key={i}>
                  <Skeleton h={30} w="55%" style={{ marginBottom: 6 }} />
                  <Skeleton h={13} w="75%" style={{ marginBottom: 5 }} />
                  <Skeleton h={10} w="50%" />
                </div>
              ))}
            </section>
            <div className="overview-grid">
              <section className="overview-card">
                <Skeleton h={18} w="45%" style={{ marginBottom: 16 }} />
                <Skeleton h={150} />
              </section>
              <section className="overview-card">
                <Skeleton h={18} w="55%" style={{ marginBottom: 16 }} />
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} h={20} style={{ marginBottom: 12 }} />
                ))}
              </section>
            </div>
          </div>
        ) : (
          <>
            <section className="stat-tiles">
              <StatTile tone="accent" value={data.stats.addedThisWeek} label="Added this week" sub="new KEV entries (7d)" to="/catalog?range=7" />
              <StatTile tone="danger" value={data.stats.criticalSeverity} label="Critical severity" sub={`CVSS ≥ ${CVSS_CRITICAL.toFixed(1)}`} to="/catalog?severity=CRITICAL&range=0" />
              <StatTile tone="danger" value={data.stats.ransomwareLinked} label="Ransomware-linked" sub="known campaign use" to="/catalog?ransomware=Known&range=0" />
              <StatTile tone="warn" value={data.stats.criticalEpss} label="Critical EPSS" sub={`≥ ${EPSS_CRITICAL * 100}% exploit probability`} to={`/catalog?minEpss=${EPSS_CRITICAL * 100}&range=0`} />
              <StatTile tone="danger" value={data.stats.overdue} label="Overdue (CISA due date)" sub={`+${data.stats.dueSoon} due within 7 days`} to="/catalog?due=overdue&range=0" />
            </section>

            <div className="overview-grid">
              <section className="overview-card">
                <h2 className="overview-card-title">KEV additions — last 12 months</h2>
                <AdditionsChart data={data.monthly} onSelectMonth={handleSelectMonth} />

                <div className="overview-divider" />

                <div
                  className="epss-pressure-clickable"
                  role="button"
                  tabIndex={0}
                  aria-label="View catalog sorted by 30-day EPSS trend"
                  onClick={handleSelectEpssPressure}
                  onKeyDown={onActivateKey(handleSelectEpssPressure)}
                >
                  <h3 className="overview-subcard-title">Critical EPSS pressure — last {data.epssTrend.length} days</h3>
                  <p className="overview-card-sub">
                    CVEs scoring ≥ {EPSS_CRITICAL * 100}% exploit probability, by day
                    {pressureTrend && pressureTrend.dir !== 'flat' && (
                      <span className={`pressure-label pressure-label-${pressureTrend.dir}`}>
                        {' '}· {pressureTrend.dir === 'up' ? '▲' : '▼'}{' '}
                        {pressureTrend.delta > 0 ? '+' : ''}{pressureTrend.delta} vs {data.epssTrend.length}d ago
                      </span>
                    )}
                  </p>
                  <EpssTrendChart data={data.epssTrend} trendDir={pressureTrend?.dir ?? 'flat'} />
                  <span className="epss-pressure-cta">View in catalog, sorted by EPSS trend →</span>
                </div>
              </section>

              <section className="overview-card">
                <h2 className="overview-card-title">Top 10 most dangerous right now</h2>
                <p className="overview-card-sub">Ranked by EPSS — modelled probability of exploitation</p>
                <ol className="top-list">
                  {data.top.map((e, i) => (
                    <TopRow key={e.cveID} entry={e} rank={i + 1} today={today} />
                  ))}
                </ol>
              </section>
            </div>

            <section className="overview-card vendor-card">
              <h2 className="overview-card-title">Top vendors by KEV count</h2>
              <p className="overview-card-sub">Where exploited-vulnerability exposure concentrates, all-time</p>
              <VendorLeaderboard vendors={data.topVendors} onSelectVendor={handleSelectVendor} />
            </section>

            <SocialPulse />
          </>
        )}
      </main>
    </div>
  );
};
