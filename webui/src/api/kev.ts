import type { KevEntry } from '../models/kev';

export interface KevResponse {
  catalogVersion: string | null;
  entries: KevEntry[];
}

/** Fetch catalog entries (joined with cached NVD scores) for a date range. days=0 → all time. */
export async function fetchKevEntries(days: number): Promise<KevResponse> {
  const res = await fetch(`/api/kev?days=${days}`);
  if (!res.ok) throw new Error(`KEV fetch error: ${res.status} ${res.statusText}`);
  return res.json();
}

/** Ask the backend to prioritize NVD enrichment for these CVE IDs (fire-and-forget). */
export async function prioritizeCves(cveIds: string[]): Promise<void> {
  if (!cveIds.length) return;
  await fetch('/api/nvd/prioritize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cveIds }),
  });
}
