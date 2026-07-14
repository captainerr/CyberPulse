import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchKevEntries } from '../api/kev';
import type { KevEntry } from '../models/kev';

// "Critical EPSS" threshold: ≥ 50% modelled probability of exploitation in the next 30 days.
export const EPSS_CRITICAL = 0.5;
// "Critical severity" threshold: CVSS base score ≥ 9.0.
export const CVSS_CRITICAL = 9.0;
const CHART_MONTHS = 12;
const TOP_N = 10;
const VENDOR_TOP_N = 10;
// FIRST's EPSS API caps time-series history at 30 days (verified — extra params
// like days= are ignored), so this is the real ceiling, not an arbitrary choice.
const EPSS_TREND_DAYS = 30;
// Keep the Command Center honest on a screen a 24/7 floor leaves open all shift —
// matches the backend's own EPSS refresh cadence, so a poll is never wasted.
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const DUE_SOON_DAYS = 7;

export interface OverviewStats {
  total: number;
  addedThisWeek: number;
  criticalSeverity: number;
  ransomwareLinked: number;
  criticalEpss: number;
  overdue: number;
  dueSoon: number; // due within DUE_SOON_DAYS, not yet overdue
}

export interface MonthBucket {
  key: string;   // YYYY-MM
  label: string; // e.g. "Jun"
  count: number;
}

export interface DayBucket {
  date: string;   // YYYY-MM-DD
  label: string;  // e.g. "Jun 28"
  count: number;
}

export interface PressureTrend {
  delta: number;
  dir: 'up' | 'down' | 'flat';
}

/**
 * Direction of the critical-EPSS pressure trend across the window (first vs. last
 * day). A small dead zone (±1% of the peak, min 3) avoids flip-flopping color on
 * day-to-day noise when the portfolio is genuinely flat.
 */
export function computeEpssPressureTrend(data: DayBucket[]): PressureTrend {
  if (data.length < 2) return { delta: 0, dir: 'flat' };
  const max = Math.max(1, ...data.map((d) => d.count));
  const delta = data[data.length - 1].count - data[0].count;
  const threshold = Math.max(3, Math.round(max * 0.01));
  const dir: PressureTrend['dir'] = Math.abs(delta) <= threshold ? 'flat' : delta > 0 ? 'up' : 'down';
  return { delta, dir };
}

export interface VendorCount {
  vendor: string;
  count: number;
  pctOfCatalog: number; // 0–100
}

export interface OverviewData {
  stats: OverviewStats;
  monthly: MonthBucket[];
  epssTrend: DayBucket[];
  top: KevEntry[];
  topVendors: VendorCount[];
  catalogVersion: string | null;
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Portfolio-wide "critical EPSS pressure" trend: how many catalog CVEs sat at/above
 * EPSS_CRITICAL on each of the last `days` days. Built entirely from the per-CVE
 * epssHistory already returned with each entry — no extra API calls.
 */
function buildEpssTrend(entries: KevEntry[], days: number): DayBucket[] {
  const map = new Map<string, DayBucket & { tracked: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    map.set(key, {
      date: key,
      label: d.toLocaleString(undefined, { month: 'short', day: 'numeric' }),
      count: 0,
      tracked: 0,
    });
  }
  for (const e of entries) {
    const history = e.cve?.epssHistory;
    if (!history) continue;
    for (const point of history) {
      const bucket = map.get(point.date);
      if (!bucket) continue;
      bucket.tracked++;
      if (point.score >= EPSS_CRITICAL) bucket.count++;
    }
  }

  const buckets = Array.from(map.values());
  // Drop trailing days that haven't finished the daily EPSS refresh yet — without
  // this, "today" reads as a misleading cliff to 0 rather than real data.
  const maxTracked = Math.max(1, ...buckets.map((b) => b.tracked));
  while (buckets.length && buckets[buckets.length - 1].tracked < maxTracked * 0.5) {
    buckets.pop();
  }
  return buckets.map(({ date, label, count }) => ({ date, label, count }));
}

/** All-time KEV count per vendor — where exploited-vulnerability exposure concentrates. */
function buildTopVendors(entries: KevEntry[], topN: number): VendorCount[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const vendor = (e.vendorProject || 'Unknown').trim();
    counts.set(vendor, (counts.get(vendor) ?? 0) + 1);
  }
  const total = entries.length || 1;
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([vendor, count]) => ({ vendor, count, pctOfCatalog: (count / total) * 100 }));
}

function buildMonthly(entries: KevEntry[], months: number): MonthBucket[] {
  const now = new Date();
  const map = new Map<string, MonthBucket>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, { key, label: d.toLocaleString(undefined, { month: 'short' }), count: 0 });
  }
  for (const e of entries) {
    const bucket = map.get((e.dateAdded || '').slice(0, 7));
    if (bucket) bucket.count++;
  }
  return Array.from(map.values());
}

export function useOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const cancelledRef = useRef(false);

  const load = useCallback(async (opts: { showLoading?: boolean } = {}) => {
    const { showLoading = true } = opts;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const { catalogVersion, entries } = await fetchKevEntries(0); // all time
      if (cancelledRef.current) return;

      const weekAgo = isoDaysAgo(7);
      const today = new Date().toISOString().slice(0, 10);
      const dueSoonCutoff = new Date(Date.now() + DUE_SOON_DAYS * 86_400_000).toISOString().slice(0, 10);

      const stats: OverviewStats = {
        total: entries.length,
        addedThisWeek: entries.filter((e) => e.dateAdded >= weekAgo).length,
        criticalSeverity: entries.filter((e) => (e.cve?.baseScore ?? 0) >= CVSS_CRITICAL).length,
        ransomwareLinked: entries.filter((e) => e.knownRansomwareCampaignUse === 'Known').length,
        criticalEpss: entries.filter((e) => (e.cve?.epssScore ?? 0) >= EPSS_CRITICAL).length,
        overdue: entries.filter((e) => e.dueDate && e.dueDate < today).length,
        dueSoon: entries.filter((e) => e.dueDate && e.dueDate >= today && e.dueDate <= dueSoonCutoff).length,
      };

      const top = [...entries]
        .sort((a, b) => {
          const ea = a.cve?.epssScore ?? -1;
          const eb = b.cve?.epssScore ?? -1;
          if (eb !== ea) return eb - ea;
          return (b.cve?.baseScore ?? -1) - (a.cve?.baseScore ?? -1);
        })
        .slice(0, TOP_N);

      setData({
        stats,
        monthly: buildMonthly(entries, CHART_MONTHS),
        epssTrend: buildEpssTrend(entries, EPSS_TREND_DAYS),
        top,
        topVendors: buildTopVendors(entries, VENDOR_TOP_N),
        catalogVersion,
      });
      setFetchedAt(Date.now());
    } catch (e) {
      // Don't blow away good data already on screen with a background-refresh
      // failure — only the initial load surfaces an error banner.
      if (!cancelledRef.current && showLoading) {
        setError(e instanceof Error ? e.message : 'Failed to load overview');
      }
    } finally {
      if (!cancelledRef.current && showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    load();

    // Poll on the same cadence as the backend's own EPSS refresh, so a page left
    // open all shift doesn't quietly go stale — but never while the tab is hidden
    // (no point burning a fetch nobody's looking at), and immediately on refocus
    // so switching back to the tab always shows current data.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load({ showLoading: false });
    }, AUTO_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load({ showLoading: false });
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { data, loading, error, fetchedAt, refresh: () => load({ showLoading: false }) };
}
