/** A generated daily executive briefing. */
export interface Briefing {
  date: string;        // YYYY-MM-DD
  content: string;     // markdown
  model: string | null;
  generatedAt: number; // epoch ms
}

/** Fetch a briefing by date, or the most recent one when date is omitted. */
export async function fetchBriefing(date?: string): Promise<Briefing> {
  const url = date ? `/api/briefing?date=${encodeURIComponent(date)}` : '/api/briefing';
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.briefing) {
    throw new Error(data.error || 'No briefing available');
  }
  return data.briefing as Briefing;
}

/** List available briefing dates, newest first. */
export async function fetchBriefingDates(): Promise<string[]> {
  const res = await fetch('/api/briefing/dates');
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ dates: [] }));
  return data.dates ?? [];
}
