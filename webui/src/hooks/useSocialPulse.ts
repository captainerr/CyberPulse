import { useState, useEffect } from 'react';

export interface SocialPost {
  id: string;
  url: string;
  createdAt: string;
  text: string;
  author: string;
  handle: string;
  tag: string;
}

const POLL_MS = 120_000; // refresh every 2 min for a live feel (backend caches 10 min)

export function useSocialPulse() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/social');
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || 'Feed unavailable');
        setPosts(data.items ?? []);
        setSource(data.source ?? null);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Feed unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { posts, source, loading, error };
}
