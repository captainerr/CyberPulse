import { useState, useEffect, useCallback } from 'react';

export interface BackendStatus {
  seeder: {
    running: boolean;
    progress: string | null;
    lastRun: string | null;
    lastError: string | null;
  };
  db: {
    total: number;
    withScore: number;
    noScore: number;
    withEpss?: number;
    lastEpssAt?: number | null;
    catalogTotal: number;
    coverage: string | null;
    epssCoverage?: string | null;
  };
}

const POLL_INTERVAL_MS = 15_000;

export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState(false);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) { setError(true); return; }
      setStatus(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetch_]);

  return { status, backendUnreachable: error };
}
