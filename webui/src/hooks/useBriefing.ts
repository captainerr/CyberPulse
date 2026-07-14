import { useState, useEffect, useCallback } from 'react';
import { fetchBriefing, fetchBriefingDates, type Briefing } from '../api/briefing';

export function useBriefing() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (date: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const b = await fetchBriefing(date ?? undefined);
      setBriefing(b);
      setSelectedDate(b.date);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load briefing');
      setBriefing(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(null);
    fetchBriefingDates().then(setDates).catch(() => {});
  }, [load]);

  const selectDate = useCallback((date: string) => { load(date); }, [load]);
  const reload = useCallback(() => { load(selectedDate); }, [load, selectedDate]);

  return { briefing, dates, selectedDate, loading, error, selectDate, reload };
}
