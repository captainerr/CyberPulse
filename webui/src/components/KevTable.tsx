import React, { useState } from 'react';
import type { KevEntry, CveEnrichment } from '../models/kev';
import type { NewsLinksEntry } from '../hooks/useNewsLinks';
import type { SortKey, SortDir } from '../hooks/useKevFilters';
import { SeverityBadge } from './SeverityBadge';
import { Sparkline } from './Sparkline';
import { epssTrendDelta, epssTrendDirection } from '../utils/epss';
import { useColumnWidths } from '../hooks/useColumnWidths';

const CVE_ORG_BASE = 'https://www.cve.org/CVERecord?id=';
const NVD_BASE = 'https://nvd.nist.gov/vuln/detail/';
const CWE_BASE = 'https://cwe.mitre.org/data/definitions/';
const DESC_PREVIEW_LEN = 120;

/** CISA due-date SLA class for the table cell: overdue (red) or due within 7 days
 * (amber), else unstyled. `today`/`soonCutoff` are ISO YYYY-MM-DD. */
function dueDateClass(dueDate: string, today: string, soonCutoff: string): string | undefined {
  if (!dueDate) return undefined;
  if (dueDate < today) return 'due-overdue';
  if (dueDate <= soonCutoff) return 'due-soon';
  return undefined;
}

// Column definitions drive both the <colgroup> and the resizable headers.
const COLS: { id: string; label: string; sort?: SortKey }[] = [
  { id: 'cve', label: 'CVE ID', sort: 'cveID' },
  { id: 'vendor', label: 'Vendor / Project', sort: 'vendorProject' },
  { id: 'product', label: 'Product' },
  { id: 'vuln', label: 'Vulnerability' },
  { id: 'cvss', label: 'CVSS / Severity', sort: 'baseScore' },
  { id: 'epss', label: 'EPSS', sort: 'epssScore' },
  { id: 'dateAdded', label: 'Date added', sort: 'dateAdded' },
  { id: 'dueDate', label: 'Due date', sort: 'dueDate' },
  { id: 'ransomware', label: 'Ransomware' },
  { id: 'news', label: 'News / links' },
];
const DEFAULT_WIDTHS: Record<string, number> = {
  cve: 150, vendor: 120, product: 120, vuln: 300, cvss: 120,
  epss: 150, dateAdded: 104, dueDate: 104, ransomware: 120, news: 220,
};

function epssOrdinal(p: number): string {
  const pct = Math.round(p * 100);
  const s = pct % 10 === 1 && pct !== 11 ? 'st'
    : pct % 10 === 2 && pct !== 12 ? 'nd'
    : pct % 10 === 3 && pct !== 13 ? 'rd' : 'th';
  return `${pct}${s}`;
}

/** Signed 30-day EPSS change in percentage points, with a direction arrow. */
function epssDeltaLabel(delta: number | null): string {
  if (delta == null) return '';
  const dir = epssTrendDirection(delta);
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
  const pp = delta * 100;
  const sign = pp > 0 ? '+' : '';
  return `${arrow} ${sign}${pp.toFixed(2)}pp`;
}

/** First http(s) URL embedded in CISA's free-text notes field, if any (usually the
 * vendor advisory). Trailing punctuation from prose is stripped. */
function extractNotesUrl(notes: string | undefined | null): string | null {
  if (!notes) return null;
  const m = notes.match(/https?:\/\/\S+/);
  return m ? m[0].replace(/[.,;)\]]+$/, '') : null;
}

/** Patch/Vendor Advisory links straight from NVD, plus any URL CISA's notes field
 * carries — the authoritative "where do I fix this" answer, shown ahead of the
 * paid, rate-limited news search below. */
function AdvisoryLinks({ cve, notes }: { cve: CveEnrichment | null; notes: string }) {
  const notesUrl = extractNotesUrl(notes);
  const refs = cve?.references ?? [];
  if (refs.length === 0 && !notesUrl) return null;
  return (
    <span className="advisory-links">
      {refs.map((r, i) => (
        <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="link-advisory" title={r.url}>
          {r.tag}
        </a>
      ))}
      {notesUrl && (
        <a href={notesUrl} target="_blank" rel="noopener noreferrer" className="link-advisory" title={notesUrl}>
          CISA notes
        </a>
      )}
    </span>
  );
}

/** EPSS column cell: current score, percentile, trend sparkline + 30-day delta. */
function EpssCell({ cve }: { cve: CveEnrichment | null }) {
  if (!cve || cve.epssScore == null) return <>—</>;
  const history = cve.epssHistory;
  const delta = epssTrendDelta(history);
  const dir = epssTrendDirection(delta);
  return (
    <>
      <span className="epss-score">{(cve.epssScore * 100).toFixed(2)}%</span>
      {cve.epssPercentile != null && (
        <span className="epss-pct">{epssOrdinal(cve.epssPercentile)} %ile</span>
      )}
      {history && history.length >= 2 && (
        <span className="epss-trend-row" title={`30-day EPSS change: ${epssDeltaLabel(delta)}`}>
          <Sparkline points={history} />
          <span className={`epss-delta epss-trend-${dir}`}>{epssDeltaLabel(delta)}</span>
        </span>
      )}
    </>
  );
}

interface KevTableProps {
  entries: KevEntry[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  getNewsLinks: (cveId: string) => NewsLinksEntry;
  onFindLinks: (cveId: string) => void;
}

function SortBtn({ label, col, sortKey, sortDir, onSort, title }: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  title?: string;
}) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      className="th-sort"
      title={title}
      onClick={() => onSort(col)}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );
}

export const KevTable: React.FC<KevTableProps> = ({ entries, sortKey, sortDir, onSort, getNewsLinks, onFindLinks }) => {
  const [expandedDescs, setExpandedDescs] = useState<Set<string>>(new Set());
  const { widths, startResize, totalWidth } = useColumnWidths('kev-col-widths', DEFAULT_WIDTHS);
  const today = new Date().toISOString().slice(0, 10);
  const soonCutoff = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const toggleDesc = (cveId: string) =>
    setExpandedDescs((prev) => {
      const next = new Set(prev);
      next.has(cveId) ? next.delete(cveId) : next.add(cveId);
      return next;
    });

  return (
    <div className="table-wrap">
      <table className="kev-table" role="grid" style={{ tableLayout: 'fixed', width: '100%', minWidth: totalWidth }}>
        <colgroup>
          {COLS.map((c) => (
            <col key={c.id} style={{ width: widths[c.id] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.id} className="th-resizable">
                {c.id === 'epss' ? (
                  <span className="th-epss-sorts">
                    <SortBtn label="EPSS" col="epssScore" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortBtn label="trend" col="epssTrend" sortKey={sortKey} sortDir={sortDir} onSort={onSort} title="Sort by 30-day EPSS trend" />
                  </span>
                ) : c.sort ? (
                  <SortBtn label={c.label} col={c.sort} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                ) : (
                  c.label
                )}
                <span
                  className="col-resizer"
                  onMouseDown={(e) => startResize(c.id, e)}
                  aria-hidden="true"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={10} className="empty-cell">No matching KEVs.</td>
            </tr>
          ) : (
            entries.map((entry) => {
              const news = getNewsLinks(entry.cveID);
              const desc = entry.shortDescription ?? '';
              const truncated = desc.length > DESC_PREVIEW_LEN;
              const expanded = expandedDescs.has(entry.cveID);

              return (
                <tr key={entry.cveID}>
                  <td>
                    {entry.cveID}
                    {' · '}
                    <a
                      href={`${NVD_BASE}${entry.cveID}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-kev"
                    >
                      NIST
                    </a>
                    {' · '}
                    <a
                      href={`${CVE_ORG_BASE}${entry.cveID}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-cve"
                    >
                      CVE
                    </a>
                    {entry.cwes && entry.cwes.length > 0 && (
                      <>
                        {' · '}
                        <a
                          href={`${CWE_BASE}${entry.cwes[0]}.html`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link-cwe"
                        >
                          CWE
                        </a>
                      </>
                    )}
                  </td>
                  <td>{entry.vendorProject}</td>
                  <td>{entry.product}</td>
                  <td>
                    <span className="vuln-name">{entry.vulnerabilityName}</span>
                    {desc && (
                      <>
                        <span className="vuln-desc">
                          {expanded || !truncated
                            ? desc
                            : `${desc.slice(0, DESC_PREVIEW_LEN)}…`}
                        </span>
                        {truncated && (
                          <button
                            type="button"
                            className="btn-expand-desc"
                            onClick={() => toggleDesc(entry.cveID)}
                            aria-expanded={expanded}
                            aria-label={expanded ? 'Collapse description' : 'Expand description'}
                          >
                            {expanded ? '▲ less' : '▼ more'}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  <td><SeverityBadge cve={entry.cve} /></td>
                  <td className="epss-cell">
                    <EpssCell cve={entry.cve} />
                  </td>
                  <td>{entry.dateAdded}</td>
                  <td className={dueDateClass(entry.dueDate, today, soonCutoff)}>{entry.dueDate}</td>
                  <td>{entry.knownRansomwareCampaignUse}</td>
                  <td className="news-links-cell">
                    <AdvisoryLinks cve={entry.cve} notes={entry.notes} />
                    {news.loading ? (
                      <span className="news-links-loading">Searching…</span>
                    ) : news.error ? (
                      <span className="news-links-error" title={news.error}>
                        {news.error.slice(0, 40)}{news.error.length > 40 ? '…' : ''}
                        <button type="button" className="btn-link-inline" onClick={() => onFindLinks(entry.cveID)}>Retry</button>
                      </span>
                    ) : news.links.length > 0 ? (
                      <span className="news-links-list">
                        {news.links.map((link, i) => (
                          <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="link-cve" title={link.url}>
                            {link.title.length > 50 ? link.title.slice(0, 50) + '…' : link.title}
                          </a>
                        ))}
                        <button type="button" className="btn-link-inline" onClick={() => onFindLinks(entry.cveID)}>Refresh</button>
                      </span>
                    ) : (
                      <button type="button" className="btn btn-find-links" onClick={() => onFindLinks(entry.cveID)}>
                        Find links
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
