import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { useBriefing } from '../hooks/useBriefing';
import { extractToc, splitIntro } from '../utils/toc';
import { useStickyOffset } from '../hooks/useStickyOffset';
import { remarkLinkCves, MarkdownLink } from '../components/MarkdownLinks';

const REMARK_PLUGINS = [remarkGfm, remarkLinkCves];
const MARKDOWN_COMPONENTS = { a: MarkdownLink };

export const BriefingPage: React.FC = () => {
  const { briefing, dates, selectedDate, loading, error, selectDate } = useBriefing();
  const { headerRef, tableTop } = useStickyOffset();

  const { intro, body } = briefing ? splitIntro(briefing.content) : { intro: '', body: '' };
  const toc = briefing ? extractToc(body) : [];

  const handleExportPdf = () => {
    if (!briefing) return;
    // Browsers name the "Save as PDF" file after document.title — set it to
    // something sensible for the duration of the print dialog, then restore it.
    const prevTitle = document.title;
    document.title = `Analysts Briefing - ${briefing.date}`;
    const restoreTitle = () => {
      document.title = prevTitle;
      window.removeEventListener('afterprint', restoreTitle);
    };
    window.addEventListener('afterprint', restoreTitle);
    window.print();
  };

  return (
    <div className="app-root" style={{ '--toc-top': `${tableTop + 16}px` } as React.CSSProperties}>
      <header className="app-header" ref={headerRef as React.Ref<HTMLDivElement>}>
        <div className="header-row">
          <div>
            <h1>Analysts Briefing</h1>
            <p className="app-subtitle">Daily cybersecurity intelligence summary</p>
          </div>
          <div className="header-actions">
            {dates.length > 0 && (
              <label className="doc-date-select">
                <span>Briefing date</span>
                <select
                  value={selectedDate ?? ''}
                  onChange={(e) => selectDate(e.target.value)}
                  aria-label="Select briefing date"
                >
                  {dates.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={!briefing}
              className="btn btn-refresh"
              title="Opens the print dialog — choose &quot;Save as PDF&quot; as the destination"
            >
              Export PDF
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        {loading ? (
          <div className="loading-state" aria-busy="true">
            <p>Loading briefing…</p>
          </div>
        ) : error ? (
          <div className="banner banner-error" role="alert">
            <div>
              <p>{error}</p>
              <p className="app-subtitle">
                Set <code>GROQ_API_KEY</code> on the backend, then restart it to generate the daily briefing.
              </p>
            </div>
          </div>
        ) : briefing ? (
          <>
            <div className="print-masthead">
              <span className="print-masthead-brand">KEVMap</span>
              <span className="print-masthead-title">Cybersecurity Analysts Briefing — {briefing.date}</span>
            </div>

            <div className="doc-layout">
              <article className="doc-content">
                {intro && <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{intro}</ReactMarkdown>}
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={[rehypeSlug]} components={MARKDOWN_COMPONENTS}>
                  {body}
                </ReactMarkdown>
              </article>
              {toc.length > 0 && (
                <nav className="doc-toc" aria-label="Briefing contents">
                  <span className="doc-toc-label">Contents</span>
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
              Generated {new Date(briefing.generatedAt).toLocaleString()}
              {briefing.model ? ` · ${briefing.model}` : ''}
            </footer>
            <div className="print-footer">Confidential — for authorized use only</div>
          </>
        ) : (
          <div className="loading-state">No briefing available yet.</div>
        )}
      </main>
    </div>
  );
};
