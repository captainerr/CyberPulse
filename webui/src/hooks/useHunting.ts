import { useState, useEffect, useCallback } from 'react';
import { fetchHunting, fetchHuntingDates, type HuntingQueries } from '../api/hunting';

export function useHunting() {
  const [hunting, setHunting] = useState<HuntingQueries | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (date: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const h = await fetchHunting(date ?? undefined);
      setHunting(h);
      setSelectedDate(h.date);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load hunting queries');
      setHunting(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(null);
    fetchHuntingDates().then(setDates).catch(() => {});
  }, [load]);

  const selectDate = useCallback((date: string) => { load(date); }, [load]);
  const reload = useCallback(() => { load(selectedDate); }, [load, selectedDate]);

  return { hunting, dates, selectedDate, loading, error, selectDate, reload };
}
