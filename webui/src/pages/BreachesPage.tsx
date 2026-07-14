import React, { useState, useRef, useCallback } from 'react';
import useBreaches from '../hooks/useBreaches';
import { BreachesTable } from '../components/BreachesTable';
import { ActionsMenu } from '../components/ActionsMenu';
import { useStickyOffset } from '../hooks/useStickyOffset';
import { useNewsLinks } from '../hooks/useNewsLinks';
import { fetchSearchLinks } from '../api/newsLinks';

function escapeCsvCell(s: string): string {
  let v = s;
  // Neutralize spreadsheet formula injection. Breach titles/snippets come from
  // arbitrary third-party RSS feeds (untrusted), so a cell starting with
  // = + - @ (or tab/CR) could execute as a formula in Excel/Sheets — prefix
  // with a single quote to force literal text.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  // RFC 4180 quoting for delimiters, quotes, and newlines.
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export const BreachesPage: React.FC = () => {
  const [raw, setRaw] = useState(false);
  const { items, loading, error, lastUpdated, search, setSearch, refresh } = useBreaches(raw);
  const { headerRef, tableTop } = useStickyOffset();

  // Store the per-title exclude domain so the fetcher can forward it to the backend.
  const excludeMap = useRef<Map<string, string>>(new Map());
  const fetcher = useCallback((title: string) => {
    return fetchSearchLinks(title, excludeMap.current.get(title));
  }, []);

  const { getEntry: getNewsLinks, fetchOne: _findLinks } = useNewsLinks({
    storageKey: 'breach-news-links',
    fetcher,
  });

  const findLinks = useCallback((title: string, existingLink?: string) => {
    if (existingLink) {
      try { excludeMap.current.set(title, new URL(existingLink).hostname); } catch { /* ignore */ }
    }
    _findLinks(title);
  }, [_findLinks]);

  const handleExport = () => {
    const headers = ['Title', 'Summary', 'Source', 'Date reported', 'URL'];
    const rows = items.map((i) => [i.title, i.contentSnippet ?? '', i.source ?? '', i.pubDate ?? '', i.link]);
    const line = (arr: (string | number)[]) => arr.map((c) => escapeCsvCell(String(c ?? ''))).join(',');
    const csv = [line(headers), ...rows.map((r) => line(r))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'breaches-export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const actionItems = [
    { label: 'Export CSV', onClick: handleExport, disabled: loading || items.length === 0 },
  ];

  return (
    <div className="app-root" style={{ '--table-thead-top': `${tableTop}px` } as React.CSSProperties}>
      <header className="app-header" ref={headerRef as React.Ref<HTMLDivElement>}>
        <div className="header-row">
          <div>
            <h1>Breaches</h1>
            <p className="app-subtitle">Recent cybersecurity breaches (last 30 days)</p>
          </div>
          <div className="header-actions">
            <span className="last-updated">Updated {lastUpdated ? new Date(lastUpdated).toLocaleString() : '—'}</span>
            <button type="button" onClick={refresh} disabled={loading} className="btn btn-refresh">Refresh</button>
            <ActionsMenu items={actionItems} />
          </div>
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="banner banner-error" role="alert">
            {error}
            <button type="button" onClick={refresh}>Retry</button>
          </div>
        )}

        <div className="filter-bar">
          <input
            type="search"
            placeholder="Search title, summary, source…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-search"
            aria-label="Search breaches"
          />
          <label className="filter-raw-label">
            <input
              type="checkbox"
              checked={raw}
              onChange={(e) => setRaw(e.target.checked)}
            />
            Show all feed items (unfiltered)
          </label>
        </div>

        {loading ? (
          <div className="loading-state" aria-busy="true">
            <p>Loading breaches…</p>
          </div>
        ) : (
          <>
            <p className="result-count">Showing {items.length} breach(s)</p>
            <BreachesTable
              items={items}
              tableTop={tableTop}
              getNewsLinks={getNewsLinks}
              onFindLinks={findLinks}
            />
          </>
        )}
      </main>
    </div>
  );
};
