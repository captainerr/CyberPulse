import { useCallback, useMemo, useState } from 'react';
import type { NewsLinkItem, StoredNewsLinks } from '../models/kev';
import type { KevEntry } from '../models/kev';
import { fetchNewsLinks } from '../api/newsLinks';

const STORAGE_KEY = 'kev-news-links';

interface UseNewsLinksOptions {
  storageKey?: string;
  fetcher?: (id: string) => Promise<NewsLinkItem[]>;
}

function loadFromStorage(key: string): Record<string, StoredNewsLinks> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { links: NewsLinkItem[]; fetchedAt?: number }>;
    return parsed;
  } catch {
    return {};
  }
}

function saveToStorage(key: string, data: Record<string, StoredNewsLinks>): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export interface NewsLinksEntry {
  links: NewsLinkItem[];
  loading?: boolean;
  error?: string;
}

export function useNewsLinks({ storageKey = STORAGE_KEY, fetcher = fetchNewsLinks }: UseNewsLinksOptions = {}) {
  const [storage, setStorage] = useState<Record<string, StoredNewsLinks>>(() => loadFromStorage(storageKey));
  const [loading, setLoading] = useState<Record<string, true>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const getEntry = useCallback(
    (id: string): NewsLinksEntry => {
      const stored = storage[id];
      const links = stored?.links ?? [];
      return {
        links,
        loading: loading[id],
        error: errors[id],
      };
    },
    [storage, loading, errors]
  );

  const setLinks = useCallback((id: string, links: NewsLinkItem[]) => {
    setStorage((prev) => {
      const next: Record<string, StoredNewsLinks> = {
        ...prev,
        [id]: { links, fetchedAt: Date.now() },
      };
      saveToStorage(storageKey, next);
      return next;
    });
    setLoading((prev) => {
      const u = { ...prev };
      delete u[id];
      return u;
    });
    setErrors((prev) => {
      const u = { ...prev };
      delete u[id];
      return u;
    });
  }, [storageKey]);

  const setError = useCallback((id: string, error: string) => {
    setLoading((prev) => {
      const u = { ...prev };
      delete u[id];
      return u;
    });
    setErrors((prev) => ({ ...prev, [id]: error }));
  }, []);

  const fetchOne = useCallback(
    async (id: string) => {
      setLoading((prev) => ({ ...prev, [id]: true }));
      setErrors((prev) => ({ ...prev, [id]: '' }));
      try {
        const links = await fetcher(id);
        setLinks(id, links);
      } catch (err) {
        setError(id, err instanceof Error ? err.message : 'Failed to fetch links');
      }
    },
    [fetcher, setLinks, setError]
  );

  const fetchBatch = useCallback(
    async (entries: KevEntry[], delayMs = 400) => {
      const toFetch = entries.filter((e) => {
        const stored = storage[e.cveID];
        return !stored?.links?.length;
      });
      const total = toFetch.length;
      if (total === 0) return;
      setBatchProgress({ current: 0, total });
      for (let i = 0; i < toFetch.length; i++) {
        await fetchOne(toFetch[i].cveID);
        setBatchProgress({ current: i + 1, total });
        if (i < toFetch.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      setBatchProgress(null);
    },
    [storage, fetchOne]
  );

  const linksMap = useMemo(() => {
    const map = new Map<string, NewsLinksEntry>();
    const allIds = new Set<string>(Object.keys(storage));
    Object.keys(loading).forEach((id) => allIds.add(id));
    Object.keys(errors).forEach((id) => allIds.add(id));
    allIds.forEach((id) => map.set(id, getEntry(id)));
    return map;
  }, [storage, loading, errors, getEntry]);

  return {
    getEntry,
    fetchOne,
    fetchBatch,
    linksMap,
    batchProgress,
    isBatchRunning: batchProgress !== null || Object.keys(loading).length > 0,
  };
}
