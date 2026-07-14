import { useMemo, useState, useCallback } from 'react';
import type { KevEntry } from '../models/kev';
import { epssTrendDelta } from '../utils/epss';

export type SortKey = 'dateAdded' | 'dueDate' | 'baseScore' | 'epssScore' | 'epssTrend' | 'vendorProject' | 'cveID';
export type SortDir = 'asc' | 'desc';

export interface KevFiltersState {
  search: string;
  severities: string[];
  vendors: string[];
  ransomware: string;
  minScore: number;
  minEpss: number; // EPSS as a percent, 0–100; 0 = no filter
  month: string; // YYYY-MM, '' = no filter. A precise calendar month, independent of
                  // the date-range dropdown — used by the Command Center's additions
                  // chart to drill into one month regardless of the fetched window.
  dateFrom: string; // YYYY-MM-DD, '' = unbounded. Backs the "Custom range" date picker —
  dateTo: string;   // like `month`, independent of the date-range dropdown's presets.
  due: string; // '', 'overdue', or 'soon' (due within 7 days) — CISA due-date SLA filter.
}

const DEFAULT_FILTERS: KevFiltersState = {
  search: '',
  severities: [],
  vendors: [],
  ransomware: '',
  minScore: 0,
  minEpss: 0,
  month: '',
  dateFrom: '',
  dateTo: '',
  due: '',
};

const VALID_DUE = ['overdue', 'soon'];

const VALID_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
const VALID_RANSOMWARE = ['Known', 'Unknown', 'No'];
const VALID_SORT_KEYS: SortKey[] = [
  'dateAdded', 'dueDate', 'baseScore', 'epssScore', 'epssTrend', 'vendorProject', 'cveID',
];

/** Parse deep-link / shared-URL query params into initial filter + sort state. */
export function readFiltersFromSearch(search: string): {
  filters: KevFiltersState;
  sortKey: SortKey;
  sortDir: SortDir;
} {
  const p = new URLSearchParams(search);
  const severities = (p.get('severity') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => VALID_SEVERITIES.includes(s));
  const vendors = (p.get('vendor') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const ransomwareRaw = p.get('ransomware') ?? '';
  const ransomware = VALID_RANSOMWARE.includes(ransomwareRaw) ? ransomwareRaw : '';
  const minScoreRaw = Number(p.get('minScore'));
  const minScore = Number.isFinite(minScoreRaw) ? Math.min(10, Math.max(0, minScoreRaw)) : 0;
  const minEpssRaw = Number(p.get('minEpss'));
  const minEpss = Number.isFinite(minEpssRaw) ? Math.min(100, Math.max(0, minEpssRaw)) : 0;
  const monthRaw = p.get('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : '';
  const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const fromRaw = p.get('from') ?? '';
  const dateFrom = isIsoDate(fromRaw) ? fromRaw : '';
  const toRaw = p.get('to') ?? '';
  const dateTo = isIsoDate(toRaw) ? toRaw : '';
  const dueRaw = p.get('due') ?? '';
  const due = VALID_DUE.includes(dueRaw) ? dueRaw : '';
  const sortRaw = p.get('sort') as SortKey | null;
  const sortKey = sortRaw && VALID_SORT_KEYS.includes(sortRaw) ? sortRaw : 'dateAdded';
  const dirRaw = p.get('dir');
  const sortDir: SortDir = dirRaw === 'asc' ? 'asc' : 'desc';
  return {
    filters: { search: p.get('q') ?? '', severities, vendors, ransomware, minScore, minEpss, month, dateFrom, dateTo, due },
    sortKey,
    sortDir,
  };
}

function matchesSearch(entry: KevEntry, q: string): boolean {
  if (!q.trim()) return true;
  const lower = q.toLowerCase();
  const searchable = [
    entry.cveID,
    entry.vendorProject,
    entry.product,
    entry.vulnerabilityName,
    entry.shortDescription,
  ].join(' ');
  return searchable.toLowerCase().includes(lower);
}

function matchesSeverity(entry: KevEntry, severities: string[]): boolean {
  if (severities.length === 0) return true;
  const s = entry.cve?.severity ?? 'NONE';
  return severities.includes(s);
}

function matchesVendor(entry: KevEntry, vendors: string[]): boolean {
  if (vendors.length === 0) return true;
  return vendors.includes(entry.vendorProject);
}

function matchesRansomware(entry: KevEntry, ransomware: string): boolean {
  if (!ransomware) return true;
  return entry.knownRansomwareCampaignUse === ransomware;
}

function matchesMinScore(entry: KevEntry, minScore: number): boolean {
  if (minScore <= 0) return true;
  const score = entry.cve?.baseScore ?? null;
  if (score === null) return false;
  return score >= minScore;
}

function matchesMinEpss(entry: KevEntry, minEpss: number): boolean {
  if (minEpss <= 0) return true;
  const epss = entry.cve?.epssScore ?? null;
  if (epss === null) return false;
  return epss * 100 >= minEpss;
}

function matchesMonth(entry: KevEntry, month: string): boolean {
  if (!month) return true;
  return (entry.dateAdded || '').slice(0, 7) === month;
}

/** Inclusive [dateFrom, dateTo] window; either bound may be open-ended ('').
 * ISO YYYY-MM-DD strings compare lexicographically in chronological order. */
function matchesDateRange(entry: KevEntry, dateFrom: string, dateTo: string): boolean {
  if (!dateFrom && !dateTo) return true;
  const added = entry.dateAdded || '';
  if (dateFrom && added < dateFrom) return false;
  if (dateTo && added > dateTo) return false;
  return true;
}

/** CISA due-date SLA: 'overdue' (past due_date) or 'soon' (due within the next 7
 * days, not yet overdue). `today`/`soonCutoff` are ISO YYYY-MM-DD, compared
 * lexicographically like the rest of this file's date logic. */
function matchesDue(entry: KevEntry, due: string, today: string, soonCutoff: string): boolean {
  if (!due) return true;
  if (!entry.dueDate) return false;
  if (due === 'overdue') return entry.dueDate < today;
  if (due === 'soon') return entry.dueDate >= today && entry.dueDate <= soonCutoff;
  return true;
}

export function useKevFilters(entries: KevEntry[]) {
  // Seed initial state from the URL so deep links and shared/bookmarked
  // filtered views restore on load. Read once — the page owns write-back sync.
  const initial = readFiltersFromSearch(
    typeof window !== 'undefined' ? window.location.search : ''
  );
  const [filters, setFilters] = useState<KevFiltersState>(initial.filters);
  const [sortKey, setSortKey] = useState<SortKey>(initial.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initial.sortDir);

  const setSearch = useCallback((search: string) => setFilters((f) => ({ ...f, search })), []);
  const toggleSeverity = useCallback((sev: string) =>
    setFilters((f) => ({
      ...f,
      severities: f.severities.includes(sev)
        ? f.severities.filter((s) => s !== sev)
        : [...f.severities, sev],
    })), []);
  const toggleVendor = useCallback((vendor: string) =>
    setFilters((f) => ({
      ...f,
      vendors: f.vendors.includes(vendor)
        ? f.vendors.filter((v) => v !== vendor)
        : [...f.vendors, vendor],
    })), []);
  const setRansomware = useCallback((ransomware: string) => setFilters((f) => ({ ...f, ransomware })), []);
  const setMinScore = useCallback((minScore: number) => setFilters((f) => ({ ...f, minScore })), []);
  const setMinEpss = useCallback((minEpss: number) => setFilters((f) => ({ ...f, minEpss })), []);
  const setMonth = useCallback((month: string) => setFilters((f) => ({ ...f, month })), []);
  const setDateFrom = useCallback((dateFrom: string) => setFilters((f) => ({ ...f, dateFrom })), []);
  const setDateTo = useCallback((dateTo: string) => setFilters((f) => ({ ...f, dateTo })), []);
  const setDue = useCallback((due: string) => setFilters((f) => ({ ...f, due })), []);
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey(key);
    setSortDir((d) => (sortKey === key && d === 'desc' ? 'asc' : 'desc'));
  }, [sortKey]);

  const filteredAndSorted = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const soonCutoff = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    let list = entries.filter(
      (e) =>
        matchesSearch(e, filters.search) &&
        matchesSeverity(e, filters.severities) &&
        matchesVendor(e, filters.vendors) &&
        matchesRansomware(e, filters.ransomware) &&
        matchesMinScore(e, filters.minScore) &&
        matchesMinEpss(e, filters.minEpss) &&
        matchesMonth(e, filters.month) &&
        matchesDateRange(e, filters.dateFrom, filters.dateTo) &&
        matchesDue(e, filters.due, today, soonCutoff)
    );

    const cmp = (a: KevEntry, b: KevEntry): number => {
      let va: string | number | undefined;
      let vb: string | number | undefined;
      switch (sortKey) {
        case 'dateAdded':
          va = new Date(a.dateAdded).getTime();
          vb = new Date(b.dateAdded).getTime();
          break;
        case 'dueDate':
          va = new Date(a.dueDate).getTime();
          vb = new Date(b.dueDate).getTime();
          break;
        case 'baseScore':
          va = a.cve?.baseScore ?? -1;
          vb = b.cve?.baseScore ?? -1;
          break;
        case 'epssScore':
          va = a.cve?.epssScore ?? -1;
          vb = b.cve?.epssScore ?? -1;
          break;
        case 'epssTrend':
          // Missing history sinks to the bottom on desc (biggest riser first).
          va = epssTrendDelta(a.cve?.epssHistory) ?? -Infinity;
          vb = epssTrendDelta(b.cve?.epssHistory) ?? -Infinity;
          break;
        case 'vendorProject':
          va = a.vendorProject;
          vb = b.vendorProject;
          break;
        case 'cveID':
          va = a.cveID;
          vb = b.cveID;
          break;
        default:
          return 0;
      }
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va ?? '');
      const sb = String(vb ?? '');
      const r = sa.localeCompare(sb);
      return sortDir === 'asc' ? r : -r;
    };

    list = [...list].sort(cmp);
    return list;
  }, [entries, filters, sortKey, sortDir]);

  const vendorOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.vendorProject));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  return {
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
    setSortKey,
    setSortDir,
    toggleSort,
    filteredAndSorted,
    vendorOptions,
  };
}
