import { useCallback, useEffect, useMemo, useState } from 'react';

export interface BreachItem {
  title: string;
  link: string;
  pubDate: string | null;
  contentSnippet?: string;
  source?: string;
}

const STORAGE_KEY = 'kev-breaches-cache';
const TTL_MS = 60 * 60 * 1000; // 1 hour

function loadFromStorage(): { fetchedAt: number; items: BreachItem[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToStorage(data: { fetchedAt: number; items: BreachItem[] }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function useBreaches(raw: boolean = false) {
  const [items, setItems] = useState<BreachItem[]>(() => loadFromStorage()?.items ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(() => {
    const s = loadFromStorage();
    return s?.fetchedAt ? new Date(s.fetchedAt).toISOString() : null;
  });
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchBreaches = useCallback(async (rawParam: boolean = raw) => {
    setLoading(true);
    setError(null);
    try {
      const url = rawParam ? '/api/breaches?raw=true' : '/api/breaches';
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Fetch failed: ${res.status}`);
      }
      const data = await res.json();
      const fetchedAt = Date.now();
      const items: BreachItem[] = Array.isArray(data.items) ? data.items : [];
      setItems(items);
      setLastUpdated(new Date(fetchedAt).toISOString());
      saveToStorage({ fetchedAt, items });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [raw]);

  useEffect(() => {
    const s = loadFromStorage();
    if (s && Date.now() - s.fetchedAt < TTL_MS) {
      setItems(s.items);
      setLastUpdated(new Date(s.fetchedAt).toISOString());
      return;
    }
    fetchBreaches();
  }, [fetchBreaches]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items;
    if (q) {
      list = items.filter((it) => (it.title + ' ' + (it.contentSnippet || '') + ' ' + (it.source || '')).toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      const ta = a.pubDate ? Date.parse(a.pubDate) : 0;
      const tb = b.pubDate ? Date.parse(b.pubDate) : 0;
      return sortDir === 'asc' ? ta - tb : tb - ta;
    });
    return list;
  }, [items, search, sortDir]);

  const refresh = useCallback(() => fetchBreaches(), [fetchBreaches]);

  return {
    items: filtered,
    rawItems: items,
    loading,
    error,
    lastUpdated,
    search,
    setSearch,
    sortDir,
    setSortDir,
    refresh,
  };
}

export default useBreaches;
