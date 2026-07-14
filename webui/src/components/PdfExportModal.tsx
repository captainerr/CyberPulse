import React, { useState } from 'react';
import { PDF_FIELD_LABELS, DEFAULT_PDF_FIELDS } from '../utils/exportPdf';
import type { PdfField } from '../utils/exportPdf';

const ALL_FIELDS: PdfField[] = [
  'cveID',
  'vendorProject',
  'product',
  'vulnerabilityName',
  'shortDescription',
  'baseScore',
  'severity',
  'dateAdded',
  'dueDate',
  'ransomware',
  'newsLinks',
];

interface Props {
  entryCount: number;
  hasNewsLinks: boolean;
  onGenerate: (fields: PdfField[]) => void;
  onCancel: () => void;
}

export const PdfExportModal: React.FC<Props> = ({ entryCount, hasNewsLinks, onGenerate, onCancel }) => {
  const [selected, setSelected] = useState<Set<PdfField>>(new Set(DEFAULT_PDF_FIELDS));

  const toggle = (field: PdfField) => {
    if (field === 'cveID') return; // always required
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(field) ? next.delete(field) : next.add(field);
      return next;
    });
  };

  const orderedSelected = ALL_FIELDS.filter((f) => selected.has(f));

  return (
    <div className="pdf-modal-overlay" onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="pdf-modal-title">
      <div className="pdf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-modal-header">
          <div className="pdf-modal-logo">
            <span className="pdf-logo-brand">&gt; CyberPulse</span>
          </div>
          <h2 id="pdf-modal-title" className="pdf-modal-title">Generate PDF Report</h2>
          <p className="pdf-modal-subtitle">
            Select the columns to include in your <em>CyberPulse KEV Intelligence Report</em>.
            Exporting {entryCount} {entryCount === 1 ? 'entry' : 'entries'}.
          </p>
        </div>

        <div className="pdf-modal-fields">
          {ALL_FIELDS.map((field) => {
            const isRequired = field === 'cveID';
            const isNewsLinks = field === 'newsLinks';
            const isChecked = selected.has(field);
            return (
              <label
                key={field}
                className={`pdf-field-item${isRequired ? ' pdf-field-item--required' : ''}${isChecked ? ' pdf-field-item--checked' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isRequired}
                  onChange={() => toggle(field)}
                />
                <span className="pdf-field-label">{PDF_FIELD_LABELS[field]}</span>
                {isRequired && <span className="pdf-field-badge">required</span>}
                {isNewsLinks && !hasNewsLinks && (
                  <span className="pdf-field-badge pdf-field-badge--warn">no links fetched</span>
                )}
              </label>
            );
          })}
        </div>

        <div className="pdf-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onGenerate(orderedSelected)}
            disabled={orderedSelected.length === 0}
          >
            Generate PDF
          </button>
        </div>
      </div>
    </div>
  );
};
