/** The day's detection/hunting queries, split from the same generation as the briefing. */
export interface HuntingQueries {
  date: string;        // YYYY-MM-DD
  content: string;     // markdown
  model: string | null;
  generatedAt: number; // epoch ms
}

/** Fetch hunting queries by date, or the most recent when date is omitted. */
export async function fetchHunting(date?: string): Promise<HuntingQueries> {
  const url = date ? `/api/hunting?date=${encodeURIComponent(date)}` : '/api/hunting';
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.hunting) {
    throw new Error(data.error || 'No hunting queries available');
  }
  return data.hunting as HuntingQueries;
}

/** List available hunting-query dates, newest first. */
export async function fetchHuntingDates(): Promise<string[]> {
  const res = await fetch('/api/hunting/dates');
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ dates: [] }));
  return data.dates ?? [];
}
