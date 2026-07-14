import React from 'react';
import type { CveEnrichment } from '../models/kev';

interface SeverityBadgeProps {
  cve: CveEnrichment | null;
  showScore?: boolean;
}

const SEVERITY_CLASS: Record<string, string> = {
  CRITICAL: 'severity-critical',
  HIGH: 'severity-high',
  MEDIUM: 'severity-medium',
  LOW: 'severity-low',
  NONE: 'severity-none',
};

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ cve, showScore = true }) => {
  if (!cve) {
    return <span className="severity-badge severity-unknown">—</span>;
  }
  const label = cve.severity ?? 'NONE';
  const cls = SEVERITY_CLASS[label] ?? 'severity-unknown';
  return (
    <span className={`severity-badge ${cls}`} title={cve.vectorString ?? undefined}>
      {showScore && cve.baseScore != null ? `${cve.baseScore} ` : ''}
      {label}
    </span>
  );
};
