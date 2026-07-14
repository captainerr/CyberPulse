import React, { useState, useRef, useEffect } from 'react';
import type { KevFiltersState } from '../hooks/useKevFilters';
import type { DateRangeDays } from '../hooks/useKevData';

interface FilterBarProps {
  filters: KevFiltersState;
  onSearchChange: (v: string) => void;
  onToggleSeverity: (v: string) => void;
  onToggleVendor: (v: string) => void;
  onRansomwareChange: (v: string) => void;
  onMinScoreChange: (v: number) => void;
  onMinEpssChange: (v: number) => void;
  onMonthChange: (v: string) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onDueChange: (v: string) => void;
  dateRangeDays: DateRangeDays;
  onDateRangeChange: (days: DateRangeDays) => void;
  onReset: () => void;
  vendorOptions: string[];
}

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
const RANSOMWARE_OPTIONS = ['', 'Known', 'Unknown', 'No'];
const DATE_RANGE_OPTIONS: { value: DateRangeDays; label: string }[] = [
  { value: 1,   label: 'Last 24 hours' },
  { value: 7,   label: 'Last 7 days' },
  { value: 14,  label: 'Last 14 days' },
  { value: 30,  label: 'Last 30 days' },
  { value: 60,  label: 'Last 60 days' },
  { value: 90,  label: 'Last 90 days' },
  { value: 365, label: 'Last year' },
  { value: 0,   label: 'All time' },
];

const SeverityDropdown: React.FC<{
  selected: string[];
  onToggle: (s: string) => void;
}> = ({ selected, onToggle }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const label = selected.length === 0
    ? 'All'
    : selected.map((s) => s.charAt(0) + s.slice(1).toLowerCase()).join(', ');

  return (
    <div className="sev-dropdown" ref={ref}>
      <button
        type="button"
        className="sev-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="sev-dropdown-label">{label}</span>
        <span className="sev-dropdown-arrow">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="sev-dropdown-menu" role="listbox" aria-multiselectable="true">
          {SEVERITIES.map((sev) => (
            <label key={sev} className="sev-dropdown-item">
              <input
                type="checkbox"
                checked={selected.includes(sev)}
                onChange={() => onToggle(sev)}
              />
              {sev.charAt(0) + sev.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

const VendorDropdown: React.FC<{
  selected: string[];
  options: string[];
  onToggle: (v: string) => void;
}> = ({ selected, options, onToggle }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const label = selected.length === 0 ? 'All' : selected.length === 1 ? selected[0] : `${selected.length} selected`;
  const filtered = options.filter((v) => v.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="sev-dropdown" ref={ref}>
      <button
        type="button"
        className="sev-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="sev-dropdown-label">{label}</span>
        <span className="sev-dropdown-arrow">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="sev-dropdown-menu sev-dropdown-menu--vendor" role="listbox" aria-multiselectable="true">
          <input
            type="search"
            className="sev-dropdown-search"
            placeholder="Search vendors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          {filtered.map((v) => (
            <label key={v} className="sev-dropdown-item">
              <input
                type="checkbox"
                checked={selected.includes(v)}
                onChange={() => onToggle(v)}
              />
              {v}
            </label>
          ))}
          {filtered.length === 0 && <div className="sev-dropdown-item" style={{ color: 'var(--muted)' }}>No matches</div>}
        </div>
      )}
    </div>
  );
};

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** "2026-06" -> "Jun 2026" */
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' });
}

/** "2026-06-15" -> "Jun 15, 2026" */
function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const CUSTOM_RANGE = 'custom';
const DUE_LABELS: Record<string, string> = { overdue: 'Overdue', soon: 'Due within 7 days' };

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onSearchChange,
  onToggleSeverity,
  onToggleVendor,
  onRansomwareChange,
  onMinScoreChange,
  onMinEpssChange,
  onMonthChange,
  onDateFromChange,
  onDateToChange,
  onDueChange,
  dateRangeDays,
  onDateRangeChange,
  onReset,
  vendorOptions,
}) => {
  const customActive = !!(filters.dateFrom || filters.dateTo);
  // "Custom" stays selected in the dropdown once chosen, even before either date is
  // filled in — that intent can't be derived from the filters alone, so track it locally.
  const [customMode, setCustomMode] = useState(customActive);

  const handleRangeSelect = (value: string) => {
    if (value === CUSTOM_RANGE) {
      setCustomMode(true);
      // Arbitrary dates can fall outside any preset window, so always widen the
      // underlying fetch to all-time the moment custom mode is chosen.
      if (dateRangeDays !== 0) onDateRangeChange(0);
    } else {
      setCustomMode(false);
      if (filters.dateFrom) onDateFromChange('');
      if (filters.dateTo) onDateToChange('');
      onDateRangeChange(Number(value) as DateRangeDays);
    }
  };

  // Date range only counts as "active" when it differs from the default (30d) —
  // custom mode has its own chip below instead of the preset-range chip.
  const rangeActive = !customMode && dateRangeDays !== 30;
  const rangeLabel = DATE_RANGE_OPTIONS.find((o) => o.value === dateRangeDays)?.label ?? '';

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.search) chips.push({ key: 'search', label: `“${filters.search}”`, onRemove: () => onSearchChange('') });
  if (rangeActive) chips.push({ key: 'range', label: rangeLabel, onRemove: () => onDateRangeChange(30) });
  if (customMode) {
    const removeCustom = () => {
      setCustomMode(false);
      onDateFromChange('');
      onDateToChange('');
      onDateRangeChange(30);
    };
    const label = filters.dateFrom && filters.dateTo
      ? `${dateLabel(filters.dateFrom)} – ${dateLabel(filters.dateTo)}`
      : filters.dateFrom
        ? `From ${dateLabel(filters.dateFrom)}`
        : filters.dateTo
          ? `Through ${dateLabel(filters.dateTo)}`
          : 'Custom range';
    chips.push({ key: 'customRange', label, onRemove: removeCustom });
  }
  filters.severities.forEach((s) =>
    chips.push({ key: `sev-${s}`, label: titleCase(s), onRemove: () => onToggleSeverity(s) }));
  if (filters.minScore > 0)
    chips.push({ key: 'minScore', label: `CVSS ≥ ${filters.minScore}`, onRemove: () => onMinScoreChange(0) });
  if (filters.minEpss > 0)
    chips.push({ key: 'minEpss', label: `EPSS ≥ ${filters.minEpss}%`, onRemove: () => onMinEpssChange(0) });
  if (filters.month)
    chips.push({ key: 'month', label: monthLabel(filters.month), onRemove: () => onMonthChange('') });
  if (filters.due)
    chips.push({ key: 'due', label: DUE_LABELS[filters.due] ?? filters.due, onRemove: () => onDueChange('') });
  filters.vendors.forEach((v) =>
    chips.push({ key: `ven-${v}`, label: v, onRemove: () => onToggleVendor(v) }));
  if (filters.ransomware)
    chips.push({ key: 'ransomware', label: `Ransomware: ${filters.ransomware}`, onRemove: () => onRansomwareChange('') });

  const hasActive = chips.length > 0;
  const clearAll = () => {
    onReset();
    setCustomMode(false);
    if (dateRangeDays !== 30) onDateRangeChange(30);
  };

  return (
    <div className="filter-bar">
      <label className="filter-search-label">
        <span className="visually-hidden">Search</span>
        <input
          type="search"
          placeholder="Search CVE, vendor, product, description…"
          value={filters.search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="filter-search"
          aria-label="Search KEVs"
        />
      </label>
      <div className="filter-row">
        <label>
          Date range
          <select
            value={customMode ? CUSTOM_RANGE : dateRangeDays}
            onChange={(e) => handleRangeSelect(e.target.value)}
            aria-label="Show KEVs from"
          >
            {DATE_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            <option value={CUSTOM_RANGE}>Custom range…</option>
          </select>
        </label>

        {customMode && (
          <>
            <label>
              From
              <input
                type="date"
                value={filters.dateFrom}
                max={filters.dateTo || undefined}
                onChange={(e) => onDateFromChange(e.target.value)}
                className="filter-date"
                aria-label="Custom range start date"
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                onChange={(e) => onDateToChange(e.target.value)}
                className="filter-date"
                aria-label="Custom range end date"
              />
            </label>
          </>
        )}

        <label>
          Severity
          <SeverityDropdown selected={filters.severities} onToggle={onToggleSeverity} />
        </label>

        <label>
          Min CVSS
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={filters.minScore > 0 ? filters.minScore : ''}
            placeholder="0.0"
            onChange={(e) =>
              onMinScoreChange(e.target.value === '' ? 0 : Math.min(10, Math.max(0, Number(e.target.value))))
            }
            className="filter-score"
            aria-label="Minimum CVSS score"
          />
        </label>
        <label>
          Min EPSS %
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={filters.minEpss > 0 ? filters.minEpss : ''}
            placeholder="0"
            onChange={(e) =>
              onMinEpssChange(e.target.value === '' ? 0 : Math.min(100, Math.max(0, Number(e.target.value))))
            }
            className="filter-score"
            aria-label="Minimum EPSS percentage"
          />
        </label>
        <label>
          Due date
          <select
            value={filters.due}
            onChange={(e) => onDueChange(e.target.value)}
            aria-label="Filter by CISA due-date status"
          >
            <option value="">All</option>
            <option value="overdue">Overdue</option>
            <option value="soon">Due within 7 days</option>
          </select>
        </label>
        <label>
          Vendor
          <VendorDropdown selected={filters.vendors} options={vendorOptions} onToggle={onToggleVendor} />
        </label>
        <label>
          Ransomware
          <select
            value={filters.ransomware}
            onChange={(e) => onRansomwareChange(e.target.value)}
            aria-label="Filter by ransomware use"
          >
            <option value="">All</option>
            {RANSOMWARE_OPTIONS.filter(Boolean).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={clearAll}
          className="btn-reset"
          disabled={!hasActive}
        >
          Reset filters
        </button>
      </div>

      {hasActive && (
        <div className="filter-chips" aria-label="Active filters">
          <span className="filter-chips-label">Active:</span>
          {chips.map((chip) => (
            <span key={chip.key} className="filter-chip">
              {chip.label}
              <button
                type="button"
                className="filter-chip-x"
                onClick={chip.onRemove}
                aria-label={`Remove filter ${chip.label}`}
              >
                ✕
              </button>
            </span>
          ))}
          <button type="button" className="filter-chips-clear" onClick={clearAll}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
};
