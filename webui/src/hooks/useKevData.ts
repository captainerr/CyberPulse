import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchKevEntries, prioritizeCves } from '../api/kev';
import type { KevEntry } from '../models/kev';

export type DateRangeDays = 0 | 1 | 7 | 14 | 30 | 60 | 90 | 365;

const VALID_RANGES: DateRangeDays[] = [0, 1, 7, 14, 30, 60, 90, 365];
const DEFAULT_RANGE: DateRangeDays = 30;

/** Initial date range from the `range` query param (deep links), else default. */
function initialRange(): DateRangeDays {
  if (typeof window === 'undefined') return DEFAULT_RANGE;
  const params = new URLSearchParams(window.location.search);
  const rawParam = params.get('range');
  // Number(null) is 0, and 0 ("all time") is itself a valid range — so checking
  // the parsed number alone can't tell "range=0 was explicitly requested" apart
  // from "no range param at all". Bail out on absence first, or a bare /catalog
  // visit silently loads the entire all-time catalog instead of the 30-day default.
  if (rawParam !== null) {
    const raw = Number(rawParam);
    if (VALID_RANGES.includes(raw as DateRangeDays)) return raw as DateRangeDays;
  }
  // No explicit range: if a filter that can reference data older than 30 days is
  // present (month/custom-range drill-in, an overdue/due-soon SLA filter, or a
  // direct CVE search pivot), default to "all time" instead of the normal 30-day
  // window, or the filter would silently show zero results for anything older.
  const hasPreciseDateFilter = !!(
    params.get('month') || params.get('from') || params.get('to') || params.get('due') || params.get('q')
  );
  return hasPreciseDateFilter ? 0 : DEFAULT_RANGE;
}

// While scores are still being fetched, re-pull the joined data on this cadence.
const REVALIDATE_MS = 15_000;

export function useKevData() {
  const [entries, setEntries] = useState<KevEntry[]>([]);
  const [dateRangeDays, setDateRangeDays] = useState<DateRangeDays>(initialRange);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [catalogVersion, setCatalogVersion] = useState<string | null>(null);

  const rangeRef = useRef<DateRangeDays>(dateRangeDays);
  const revalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRevalidate = useCallback(() => {
    if (revalidateTimer.current) {
      clearTimeout(revalidateTimer.current);
      revalidateTimer.current = null;
    }
  }, []);

  const loadRange = useCallback(
    async (days: DateRangeDays, opts: { showLoading?: boolean } = {}) => {
      const { showLoading = true } = opts;
      if (showLoading) setLoading(true);
      setError(null);
      try {
        const { catalogVersion: version, entries: rows } = await fetchKevEntries(days);
        // Ignore stale responses if the user switched ranges mid-flight.
        if (rangeRef.current !== days) return;

        setCatalogVersion(version);
        setEntries(rows);
        setLastUpdated(new Date().toISOString());

        // #4 + #2: nudge unfetched scores to the front, then revalidate until filled.
        const pending = rows.filter((e) => e.cve === null).map((e) => e.cveID);
        clearRevalidate();
        if (pending.length > 0) {
          prioritizeCves(pending).catch(() => {});
          revalidateTimer.current = setTimeout(() => {
            if (rangeRef.current === days) loadRange(days, { showLoading: false });
          }, REVALIDATE_MS);
        }
      } catch (e) {
        // Don't surface background-revalidation failures over data already on screen.
        if (showLoading && rangeRef.current === days) {
          setError(e instanceof Error ? e.message : 'Failed to load KEV data');
        }
      } finally {
        if (showLoading && rangeRef.current === days) setLoading(false);
      }
    },
    [clearRevalidate]
  );

  useEffect(() => {
    rangeRef.current = dateRangeDays;
    loadRange(dateRangeDays);
    return clearRevalidate;
  }, [dateRangeDays, loadRange, clearRevalidate]);

  const refresh = useCallback(() => loadRange(rangeRef.current), [loadRange]);

  return {
    entries,
    loading,
    error,
    lastUpdated,
    catalogVersion,
    dateRangeDays,
    setDateRangeDays,
    refresh,
    fetchProgress: null,
  };
}
