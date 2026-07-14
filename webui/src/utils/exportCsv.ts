import type { KevEntry } from '../models/kev';
import type { NewsLinksEntry } from '../hooks/useNewsLinks';
import { epssTrendDelta } from './epss';
import type { QueryRow } from './toc';

export function escapeCsvCell(s: string): string {
  let v = s;
  // Neutralize spreadsheet formula injection: a cell beginning with = + - @ (or
  // tab/CR) is executed as a formula by Excel/Sheets. Prefix with a single quote
  // so it's treated as literal text. KEV descriptions and untrusted RSS-sourced
  // fields can otherwise smuggle in active formulas.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  // RFC 4180 quoting for delimiters, quotes, and newlines.
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function formatNewsLinksForExport(entry: NewsLinksEntry): string {
  if (!entry.links?.length) return '';
  return entry.links.map((l) => `${l.title} (${l.url})`).join(' ');
}

/** Build an RFC-4180 CSV from headers + rows and trigger a browser download. */
export function downloadCsv(headers: string[], rows: (string | number)[][], filename: string): void {
  const line = (arr: (string | number)[]) =>
    arr.map((c) => escapeCsvCell(String(c ?? ''))).join(',');
  const csv = [line(headers), ...rows.map((r) => line(r))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportFilteredToCsv(
  entries: KevEntry[],
  getNewsLinks?: (cveId: string) => NewsLinksEntry,
  filename = 'kev-cve-export.csv'
): void {
  const headers = [
    'CVE ID',
    'Vendor/Project',
    'Product',
    'Vulnerability Name',
    'Short Description',
    'CVSS Base Score',
    'Severity',
    'EPSS Score',
    'EPSS Percentile',
    'EPSS 30d Change (pp)',
    'Date Added',
    'Due Date',
    'Known Ransomware Use',
    'NVD URL',
    'News / links',
  ];
  const rows = entries.map((e) => [
    e.cveID,
    e.vendorProject,
    e.product,
    e.vulnerabilityName,
    e.shortDescription,
    e.cve?.baseScore ?? '',
    e.cve?.severity ?? '',
    e.cve?.epssScore != null ? (e.cve.epssScore * 100).toFixed(2) + '%' : '',
    e.cve?.epssPercentile != null ? (e.cve.epssPercentile * 100).toFixed(1) + '%' : '',
    (() => {
      const d = epssTrendDelta(e.cve?.epssHistory);
      return d != null ? (d * 100 > 0 ? '+' : '') + (d * 100).toFixed(2) : '';
    })(),
    e.dateAdded,
    e.dueDate,
    e.knownRansomwareCampaignUse,
    e.cve?.nvdUrl ?? '',
    getNewsLinks ? formatNewsLinksForExport(getNewsLinks(e.cveID)) : '',
  ]);
  downloadCsv(headers, rows, filename);
}

/** Export a set of hunting queries (already flattened across whatever date range was picked) to CSV. */
export function exportHuntingQueriesToCsv(rows: QueryRow[], filename = 'hunting-queries-export.csv'): void {
  const headers = ['Date', 'Platform', 'Language', 'Query #', 'Query', 'Validate Before Use'];
  const csvRows = rows.map((r) => [r.date, r.platform, r.language, r.index, r.query, r.validate]);
  downloadCsv(headers, csvRows, filename);
}

export function openPrintView(
  entries: KevEntry[],
  title: string,
  getNewsLinks?: (cveId: string) => NewsLinksEntry
): void {
  const w = window.open('', '_blank');
  if (!w) {
    alert('Please allow pop-ups to open the print view.');
    return;
  }
  const rows = entries
    .map((e) => {
      const newsCell = getNewsLinks
        ? formatNewsLinksForExport(getNewsLinks(e.cveID))
        : '';
      return `<tr>
          <td>${escapeHtml(e.cveID)}</td>
          <td>${escapeHtml(e.vendorProject)}</td>
          <td>${escapeHtml(e.product)}</td>
          <td>${escapeHtml(e.vulnerabilityName)}</td>
          <td>${e.cve?.baseScore ?? '—'}</td>
          <td>${e.cve?.severity ?? '—'}</td>
          <td>${escapeHtml(e.dateAdded)}</td>
          <td>${escapeHtml(e.dueDate)}</td>
          <td>${escapeHtml(e.knownRansomwareCampaignUse)}</td>
          <td>${escapeHtml(newsCell)}</td>
        </tr>`;
    })
    .join('');
  w.document.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; font-size: 12px; padding: 16px; color: #111; }
    h1 { font-size: 16px; margin-bottom: 8px; }
    .meta { color: #666; margin-bottom: 12px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #f0f0f0; }
    tr:nth-child(even) { background: #f9f9f9; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Generated ${new Date().toISOString()} · ${entries.length} KEV(s)</p>
  <table>
    <thead>
      <tr>
        <th>CVE ID</th><th>Vendor</th><th>Product</th><th>Vulnerability</th><th>CVSS</th><th>Severity</th><th>Date Added</th><th>Due Date</th><th>Ransomware</th><th>News / links</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
  `);
  w.document.close();
  w.focus();
  w.print();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
