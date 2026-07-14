import type { EpssPoint } from '../models/kev';

// Below this absolute change (in raw EPSS probability) a trend is treated as flat,
// so day-to-day noise doesn't read as a meaningful rise or fall.
const FLAT_THRESHOLD = 0.005;

export type EpssTrend = 'up' | 'down' | 'flat';

/**
 * Change in raw EPSS probability over the stored window (newest − oldest).
 * Returns null when there isn't enough history to compute a trend.
 */
export function epssTrendDelta(history: EpssPoint[] | null | undefined): number | null {
  if (!history || history.length < 2) return null;
  return history[history.length - 1].score - history[0].score;
}

/** Categorize a trend delta into up / down / flat for coloring. */
export function epssTrendDirection(delta: number | null): EpssTrend {
  if (delta == null || Math.abs(delta) < FLAT_THRESHOLD) return 'flat';
  return delta > 0 ? 'up' : 'down';
}
