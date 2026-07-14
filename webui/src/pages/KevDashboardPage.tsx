import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useKevData } from '../hooks/useKevData';
import { useKevFilters } from '../hooks/useKevFilters';
import { useNewsLinks } from '../hooks/useNewsLinks';
import { useBackendStatus } from '../hooks/useBackendStatus';
import { FilterBar } from '../components/FilterBar';
import { KevTable } from '../components/KevTable';
import { TableSkeleton } from '../components/Skeleton';
import { ActionsMenu } from '../components/ActionsMenu';
import { PdfExportModal } from '../components/PdfExportModal';
import { exportFilteredToCsv, openPrintView } from '../utils/exportCsv';
import { generateKevPdf } from '../utils/exportPdf';
import type { PdfField } from '../utils/exportPdf';
import { useStickyOffset } from '../hooks/useStickyOffset';

export const KevDashboardPage: React.FC = () => {
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const { entries, loading, error, lastUpdated, catalogVersion, dateRangeDays, setDateRangeDays, refresh } = useKevData();
  const {
    filters,
    setSearch,
    toggleSeverity,
    toggleVendor,
    setRansomware,
    setMinScore,
    setMinEpss,
    setMonth,
    setDateFrom,
    setDateTo,
    setDue,
    resetFilters,
    sortKey,
    sortDir,
    toggleSort,
    filteredAndSorted,
    vendorOptions,
  } = useKevFilters(entries);
  const { getEntry: getNewsLinks, fetchOne, fetchBatch, batchProgress, isBatchRunning } = useNewsLinks();
  const { headerRef, tableTop } = useStickyOffset();
  const { status: backendStatus, backendUnreachable } = useBackendStatus();
  const [, setSearchParams] = useSearchParams();

  // Reflect the active filters/sort/range in the URL so views are shareable and
  // bookmarkable. Only non-default values are written, keeping the URL clean.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.search) params.set('q', filters.search);
    if (filters.severities.length) params.set('severity', filters.severities.join(','));
    if (filters.vendors.length) params.set('vendor', filters.vendors.join(','));
    if (filters.ransomware) params.set('ransomware', filters.ransomware);
    if (filters.minScore > 0) params.set('minScore', String(filters.minScore));
    if (filters.minEpss > 0) params.set('minEpss', String(filters.minEpss));
    if (filters.month) params.set('month', filters.month);
    if (filters.dateFrom) params.set('from', filters.dateFrom);
    if (filters.dateTo) params.set('to', filters.dateTo);
    if (filters.due) params.set('due', filters.due);
    if (sortKey !== 'dateAdded') params.set('sort', sortKey);
    if (sortDir !== 'desc') params.set('dir', sortDir);
    if (dateRangeDays !== 30) params.set('range', String(dateRangeDays));
    setSearchParams(params, { replace: true });
  }, [filters, sortKey, sortDir, dateRangeDays, setSearchParams]);

  const handleExportCsv = () => exportFilteredToCsv(filteredAndSorted, getNewsLinks);
  const handlePrint = () => openPrintView(filteredAndSorted, 'KEV / CVE Report', getNewsLinks);
  const handleFindLinksForVisible = () => fetchBatch(filteredAndSorted);
  const handleGeneratePdf = (fields: PdfField[]) => {
    generateKevPdf(filteredAndSorted, fields, getNewsLinks);
    setPdfModalOpen(false);
  };

  const hasNewsLinks = filteredAndSorted.some((e) => (getNewsLinks(e.cveID).links?.length ?? 0) > 0);

  const formattedDate = lastUpdated
    ? new Date(lastUpdated).toLocaleString(undefined, {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '—';

  const actionItems = [
    { label: 'Export CSV', onClick: handleExportCsv, disabled: loading || filteredAndSorted.length === 0 },
    { label: 'Generate PDF', onClick: () => setPdfModalOpen(true), disabled: loading || filteredAndSorted.length === 0 },
    { label: 'Print report', onClick: handlePrint, disabled: filteredAndSorted.length === 0 },
  ];

  const batchPct = batchProgress
    ? Math.round((batchProgress.current / batchProgress.total) * 100)
    : 0;

  const dbCoverage = backendStatus?.db.catalogTotal
    ? Math.round((backendStatus.db.total / backendStatus.db.catalogTotal) * 100)
    : null;
  const showSeedingBanner = !backendUnreachable && backendStatus && (
    backendStatus.seeder.running || (dbCoverage !== null && dbCoverage < 100)
  );

  return (
    <div className="app-root" style={{ '--table-thead-top': `${tableTop}px` } as React.CSSProperties}>
      <header className="app-header" ref={headerRef as React.Ref<HTMLDivElement>}>
        <div className="header-row">
          <div>
            <h1>KEV / CVE Dashboard</h1>
            <p className="app-subtitle">
              CISA Known Exploited Vulnerabilities with NVD CVE scores · Catalog {catalogVersion ?? '—'}
            </p>
          </div>
          <div className="header-actions">
            <span className="last-updated" aria-live="polite">
              Updated {formattedDate}
            </span>
            <button type="button" onClick={refresh} disabled={loading} className="btn btn-refresh">
              Refresh
            </button>
            <button
              type="button"
              onClick={handleFindLinksForVisible}
              disabled={loading || filteredAndSorted.length === 0 || isBatchRunning}
              className="btn btn-find-links-batch"
              title="Fetch news links for all visible rows that don't have links yet"
            >
              {isBatchRunning && batchProgress
                ? `Fetching… ${batchProgress.current}/${batchProgress.total}`
                : 'Fetch news links'}
            </button>
            <ActionsMenu items={actionItems} />
          </div>
        </div>
        {isBatchRunning && batchProgress && (
          <div
            className="batch-progress-wrap"
            role="progressbar"
            aria-valuenow={batchProgress.current}
            aria-valuemin={0}
            aria-valuemax={batchProgress.total}
            aria-label={`Fetching news links: ${batchProgress.current} of ${batchProgress.total}`}
          >
            <div className="batch-progress-bar" style={{ width: `${batchPct}%` }} />
          </div>
        )}
      </header>

      <main className="app-main">
        {error && (
          <div className="banner banner-error" role="alert">
            {error}
            <button type="button" onClick={refresh}>Retry</button>
          </div>
        )}

        {showSeedingBanner && backendStatus && (
          <div className="banner banner-info" role="status" aria-live="polite">
            <span>
              {backendStatus.seeder.running
                ? <>
                    Building CVSS score database — {backendStatus.db.total}/{backendStatus.db.catalogTotal} CVEs loaded
                    {backendStatus.seeder.progress && <> (fetching {backendStatus.seeder.progress})</>}
                    {dbCoverage !== null && <> · {dbCoverage}% complete</>}.
                    Scores showing &ldquo;—&rdquo; will fill in automatically.
                  </>
                : <>
                    CVSS database is {dbCoverage}% loaded ({backendStatus.db.total}/{backendStatus.db.catalogTotal} CVEs cached).
                    Entries showing &ldquo;—&rdquo; are still pending — the database updates hourly.
                  </>
              }
            </span>
          </div>
        )}

        <FilterBar
          filters={filters}
          onSearchChange={setSearch}
          onToggleSeverity={toggleSeverity}
          onToggleVendor={toggleVendor}
          onRansomwareChange={setRansomware}
          onMinScoreChange={setMinScore}
          onMinEpssChange={setMinEpss}
          onMonthChange={setMonth}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onDueChange={setDue}
          dateRangeDays={dateRangeDays}
          onDateRangeChange={setDateRangeDays}
          onReset={resetFilters}
          vendorOptions={vendorOptions}
        />

        {loading ? (
          <TableSkeleton />
        ) : (
          <>
            <p className="result-count">
              Showing {filteredAndSorted.length} of {entries.length} KEVs
            </p>
            <KevTable
              entries={filteredAndSorted}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
              getNewsLinks={getNewsLinks}
              onFindLinks={fetchOne}
            />
          </>
        )}
      </main>

      {pdfModalOpen && (
        <PdfExportModal
          entryCount={filteredAndSorted.length}
          hasNewsLinks={hasNewsLinks}
          onGenerate={handleGeneratePdf}
          onCancel={() => setPdfModalOpen(false)}
        />
      )}
    </div>
  );
};
