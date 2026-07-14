import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { useHunting } from '../hooks/useHunting';
import { extractToc, extractQueries, splitIntro, splitSections, type QueryRow } from '../utils/toc';
import { useStickyOffset } from '../hooks/useStickyOffset';
import { PreWithCopy } from '../components/CodeBlock';
import { remarkLinkCves, MarkdownLink } from '../components/MarkdownLinks';
import { fetchHunting } from '../api/hunting';
import { exportHuntingQueriesToCsv } from '../utils/exportCsv';

const REMARK_PLUGINS = [remarkGfm, remarkLinkCves];
const MARKDOWN_COMPONENTS = { pre: PreWithCopy, a: MarkdownLink };

export const HuntingPage: React.FC = () => {
  const { hunting, dates, selectedDate, loading, error, selectDate } = useHunting();
  const { headerRef, tableTop } = useStickyOffset();
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState(false);

  // Default the export range to the full archive once it loads (dates is newest-first),
  // without clobbering a range the analyst has already picked.
  useEffect(() => {
    if (dates.length === 0) return;
    setExportFrom((f) => f || dates[dates.length - 1]);
    setExportTo((t) => t || dates[0]);
  }, [dates]);

  const handleExportCsv = async () => {
    if (!exportFrom || !exportTo) return;
    setExporting(true);
    try {
      const targetDates = dates.filter((d) => d >= exportFrom && d <= exportTo);
      const results = await Promise.allSettled(targetDates.map((d) => fetchHunting(d)));
      const rows: QueryRow[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') rows.push(...extractQueries(r.value.content, r.value.date));
      }
      exportHuntingQueriesToCsv(rows, `hunting-queries_${exportFrom}_to_${exportTo}.csv`);
    } finally {
      setExporting(false);
    }
  };

  const { intro, body } = hunting ? splitIntro(hunting.content) : { intro: '', body: '' };
  const toc = hunting ? extractToc(body) : [];
  const platformSections = hunting ? splitSections(body) : [];

  return (
    <div className="app-root" style={{ '--toc-top': `${tableTop + 16}px` } as React.CSSProperties}>
      <header className="app-header" ref={headerRef as React.Ref<HTMLDivElement>}>
        <div className="header-row">
          <div>
            <h1>Hunting Queries</h1>
            <p className="app-subtitle">Ready-to-adapt detection queries for Sentinel, Cortex XDR, and Splunk</p>
          </div>
          <div className="header-actions">
            {dates.length > 0 && (
              <>
                <label className="doc-date-select">
                  <span>Query date</span>
                  <select
                    value={selectedDate ?? ''}
                    onChange={(e) => selectDate(e.target.value)}
                    aria-label="Select hunting queries date"
                  >
                    {dates.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </label>
                <label className="doc-date-select">
                  <span>Export from</span>
                  <input
                    type="date"
                    className="filter-date"
                    value={exportFrom}
                    max={exportTo || undefined}
                    onChange={(e) => setExportFrom(e.target.value)}
                    aria-label="Export range start date"
                  />
                </label>
                <label className="doc-date-select">
                  <span>to</span>
                  <input
                    type="date"
                    className="filter-date"
                    value={exportTo}
                    min={exportFrom || undefined}
                    onChange={(e) => setExportTo(e.target.value)}
                    aria-label="Export range end date"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-refresh"
                  onClick={handleExportCsv}
                  disabled={exporting || !exportFrom || !exportTo}
                  title="Export every query archived within this date range as a CSV"
                >
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        {loading ? (
          <div className="loading-state" aria-busy="true">
            <p>Loading hunting queries…</p>
          </div>
        ) : error ? (
          <div className="banner banner-error" role="alert">
            <div>
              <p>{error}</p>
              <p className="app-subtitle">
                Hunting queries are generated alongside the daily Analysts Briefing — check back after the next scheduled run.
              </p>
            </div>
          </div>
        ) : hunting ? (
          <>
            <div className="doc-layout">
              <article className="doc-content">
                {intro && <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{intro}</ReactMarkdown>}
                {platformSections.map((section) => (
                  <section key={section.heading} className="hunting-platform">
                    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={[rehypeSlug]} components={MARKDOWN_COMPONENTS}>
                      {section.content}
                    </ReactMarkdown>
                  </section>
                ))}
              </article>
              {toc.length > 0 && (
                <nav className="doc-toc" aria-label="Hunting query platforms">
                  <span className="doc-toc-label">Platforms</span>
                  <ul>
                    {toc.map((t) => (
                      <li key={t.id}>
                        <a href={`#${t.id}`}>{t.text}</a>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>
            <footer className="doc-meta">
              Generated {new Date(hunting.generatedAt).toLocaleString()}
              {hunting.model ? ` · ${hunting.model}` : ''}
            </footer>
          </>
        ) : (
          <div className="loading-state">No hunting queries available yet.</div>
        )}
      </main>
    </div>
  );
};
