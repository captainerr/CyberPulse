import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { KevEntry } from '../models/kev';
import type { NewsLinksEntry } from '../hooks/useNewsLinks';

// Report brand colors
const BRAND_TEAL = '#00C8B4';
const BRAND_DARK = '#1A2744';
const BRAND_LIGHT_ROW = '#F0FDFB';

const SEV_COLORS: Record<string, [number, number, number]> = {
  CRITICAL: [220, 38,  38 ],
  HIGH:     [234, 88,  12 ],
  MEDIUM:   [202, 138, 4  ],
  LOW:      [22,  163, 74 ],
  NONE:     [107, 114, 128],
};

export type PdfField =
  | 'cveID'
  | 'vendorProject'
  | 'product'
  | 'vulnerabilityName'
  | 'shortDescription'
  | 'baseScore'
  | 'severity'
  | 'dateAdded'
  | 'dueDate'
  | 'ransomware'
  | 'newsLinks';

export const PDF_FIELD_LABELS: Record<PdfField, string> = {
  cveID:             'CVE ID',
  vendorProject:     'Vendor / Project',
  product:           'Product',
  vulnerabilityName: 'Vulnerability Name',
  shortDescription:  'Description',
  baseScore:         'CVSS Score',
  severity:          'Severity',
  dateAdded:         'Date Added',
  dueDate:           'Due Date',
  ransomware:        'Ransomware Use',
  newsLinks:         'News / Links',
};

export const DEFAULT_PDF_FIELDS: PdfField[] = [
  'cveID', 'vendorProject', 'product', 'vulnerabilityName',
  'baseScore', 'severity', 'dateAdded', 'dueDate',
];

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}


export function generateKevPdf(
  entries: KevEntry[],
  fields: PdfField[],
  getNewsLinks?: (cveId: string) => NewsLinksEntry,
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const [dr, dg, db] = hexToRgb(BRAND_DARK);
  const [tr, tg, tb] = hexToRgb(BRAND_TEAL);

  const drawHeader = (pageNum: number) => {
    // Teal top bar
    doc.setFillColor(tr, tg, tb);
    doc.rect(0, 0, pageW, 18, 'F');

    // Logo in top bar (white)
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('KEVMap', 10, 12);

    // Report title
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const title = 'KEV Intelligence Report';
    const titleW = doc.getTextWidth(title);
    doc.text(title, pageW - titleW - 10, 12);

    // Dark subtitle bar
    doc.setFillColor(dr, dg, db);
    doc.rect(0, 18, pageW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    const generated = `Generated ${new Date().toLocaleString()}  ·  ${entries.length} vulnerabilities  ·  Source: CISA KEV + NVD`;
    doc.text(generated, 10, 23.5);
    if (pageNum > 1) {
      const pageLabel = `Page ${pageNum}`;
      doc.text(pageLabel, pageW - doc.getTextWidth(pageLabel) - 10, 23.5);
    }
  };

  const drawFooter = () => {
    doc.setFillColor(dr, dg, db);
    doc.rect(0, pageH - 8, pageW, 8, 'F');
    doc.setTextColor(180, 200, 210);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.text('KEVMap  |  Confidential — for authorized use only', 10, pageH - 2.5);
    const ts = 'Source: CISA KEV · NVD';
    doc.text(ts, pageW - doc.getTextWidth(ts) - 10, pageH - 2.5);
  };

  drawHeader(1);
  drawFooter();

  const columns = fields.map((f) => ({ header: PDF_FIELD_LABELS[f], dataKey: f }));

  const rows = entries.map((e) => {
    const row: Record<string, string> = {};
    fields.forEach((f) => {
      switch (f) {
        case 'cveID':             row[f] = e.cveID; break;
        case 'vendorProject':     row[f] = e.vendorProject; break;
        case 'product':           row[f] = e.product; break;
        case 'vulnerabilityName': row[f] = e.vulnerabilityName; break;
        case 'shortDescription':  row[f] = e.shortDescription; break;
        case 'baseScore':         row[f] = e.cve?.baseScore != null ? String(e.cve.baseScore) : '—'; break;
        case 'severity':          row[f] = e.cve?.severity ?? '—'; break;
        case 'dateAdded':         row[f] = e.dateAdded; break;
        case 'dueDate':           row[f] = e.dueDate; break;
        case 'ransomware':        row[f] = e.knownRansomwareCampaignUse; break;
        case 'newsLinks':
          if (getNewsLinks) {
            const nl = getNewsLinks(e.cveID);
            row[f] = nl?.links?.map((l) => l.url).join('\n') ?? '';
          } else {
            row[f] = '';
          }
          break;
      }
    });
    return row;
  });

  autoTable(doc, {
    startY: 30,
    margin: { bottom: 12 },
    columns,
    body: rows,
    styles: {
      fontSize: 7.5,
      cellPadding: 2.5,
      overflow: 'linebreak',
      font: 'helvetica',
    },
    headStyles: {
      fillColor: [dr, dg, db],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: {
      fillColor: hexToRgb(BRAND_LIGHT_ROW),
    },
    columnStyles: {
      shortDescription: { cellWidth: 50 },
      vulnerabilityName: { cellWidth: 40 },
      newsLinks: { cellWidth: 50 },
    },
    didParseCell(data) {
      if (data.section === 'body' && (data.column.dataKey === 'severity' || data.column.dataKey === 'baseScore')) {
        const sevField = fields.includes('severity') ? 'severity' : null;
        if (sevField) {
          const sev = (data.row.raw as Record<string, string>)['severity'];
          const color = SEV_COLORS[sev];
          if (color) data.cell.styles.textColor = color;
        }
      }
    },
    didDrawPage(data) {
      if (data.pageNumber > 1) {
        drawHeader(data.pageNumber);
        drawFooter();
      }
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  doc.save(`kevmap-kev-report-${date}.pdf`);
}
