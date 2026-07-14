import React from 'react';
import type { BreachItem } from '../hooks/useBreaches';
import type { NewsLinksEntry } from '../hooks/useNewsLinks';
import { useColumnWidths } from '../hooks/useColumnWidths';

interface Props {
  items: BreachItem[];
  tableTop?: number;
  getNewsLinks?: (key: string) => NewsLinksEntry;
  onFindLinks?: (key: string, existingLink?: string) => void;
}

// Column definitions (module-level for stable identity). The "More links"
// column only exists when news-link lookup is wired in.
const BREACH_COLS_BASE = [
  { id: 'exploited', label: 'What was exploited' },
  { id: 'summary', label: 'Summary' },
  { id: 'source', label: 'Source' },
  { id: 'date', label: 'Date reported' },
  { id: 'link', label: 'Link' },
];
const BREACH_COL_MORE = { id: 'more', label: 'More links' };
const BREACH_DEFAULTS_BASE: Record<string, number> = {
  exploited: 240, summary: 340, source: 140, date: 120, link: 100,
};
const BREACH_DEFAULTS_MORE: Record<string, number> = { ...BREACH_DEFAULTS_BASE, more: 240 };

function formatPubDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toLocaleDateString();
}


export const BreachesTable: React.FC<Props> = ({ items, tableTop, getNewsLinks, onFindLinks }) => {
  const hasNews = !!getNewsLinks;
  const cols = hasNews ? [...BREACH_COLS_BASE, BREACH_COL_MORE] : BREACH_COLS_BASE;
  const defaults = hasNews ? BREACH_DEFAULTS_MORE : BREACH_DEFAULTS_BASE;
  const { widths, startResize, totalWidth } = useColumnWidths('breach-col-widths', defaults);

  return (
    <div className="table-wrap">
      <table className="kev-table" role="grid" style={{ tableLayout: 'fixed', width: '100%', minWidth: totalWidth }}>
        <colgroup>
          {cols.map((c) => (
            <col key={c.id} style={{ width: widths[c.id] }} />
          ))}
        </colgroup>
        <thead style={tableTop != null ? { top: tableTop } : undefined}>
          <tr>
            {cols.map((c) => (
              <th key={c.id} className="th-resizable">
                {c.label}
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
          {items.length === 0 ? (
            <tr>
              <td colSpan={getNewsLinks ? 6 : 5} className="empty-cell">No recent breaches.</td>
            </tr>
          ) : (
            items.map((it, idx) => {
              const sourceShort = it.source
                ? it.source.length > 22 ? `${it.source.slice(0, 22)}…` : it.source
                : '';
              const news = getNewsLinks ? getNewsLinks(it.title) : null;
              return (
                <tr key={idx}>
                  <td>{it.title}</td>
                  <td>
                    {it.contentSnippet
                      ? it.contentSnippet.length > 140
                        ? `${it.contentSnippet.slice(0, 140)}…`
                        : it.contentSnippet
                      : '—'}
                  </td>
                  <td>{it.source ?? '—'}</td>
                  <td>{formatPubDate(it.pubDate)}</td>
                  <td>
                    {it.link ? (
                      <a
                        href={it.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Read: ${it.title}`}
                      >
                        {sourceShort ? `${sourceShort} →` : 'Read →'}
                      </a>
                    ) : '—'}
                  </td>
                  {getNewsLinks && onFindLinks && (
                    <td className="news-links-cell">
                      {news?.loading ? (
                        <span className="news-links-loading">Searching…</span>
                      ) : news?.error ? (
                        <span className="news-links-error" title={news.error}>
                          {news.error.slice(0, 40)}{news.error.length > 40 ? '…' : ''}
                          <button type="button" className="btn-link-inline" onClick={() => onFindLinks(it.title, it.link)}>Retry</button>
                        </span>
                      ) : news && news.links.length > 0 ? (
                        <span className="news-links-list">
                          {news.links.map((link, i) => (
                            <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="link-cve" title={link.url}>
                              {link.title.length > 50 ? link.title.slice(0, 50) + '…' : link.title}
                            </a>
                          ))}
                          <button type="button" className="btn-link-inline" onClick={() => onFindLinks(it.title, it.link)}>Refresh</button>
                        </span>
                      ) : (
                        <button type="button" className="btn btn-find-links" onClick={() => onFindLinks(it.title, it.link)}>
                          Find links
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default BreachesTable;
