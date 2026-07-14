import React from 'react';
import type { EpssPoint } from '../models/kev';
import { epssTrendDelta, epssTrendDirection } from '../utils/epss';

interface SparklineProps {
  points: EpssPoint[];
  width?: number;
  height?: number;
}

/**
 * Inline EPSS trend sparkline. The Y-axis auto-scales to the series' own
 * min/max so the *shape* of the trend is visible even for tiny probabilities;
 * the absolute value is shown as a number elsewhere in the cell. Stroke color
 * reflects 30-day direction (rising = red, falling = green, flat = neutral).
 */
export const Sparkline: React.FC<SparklineProps> = ({ points, width = 72, height = 20 }) => {
  if (!points || points.length < 2) return null;

  const pad = 2; // keep the stroke off the edges
  const scores = points.map((p) => p.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min;

  const x = (i: number) => pad + (i / (points.length - 1)) * (width - 2 * pad);
  // Flat series (span 0) sits on the vertical midline. Higher score → lower y.
  const y = (s: number) =>
    span === 0 ? height / 2 : pad + (1 - (s - min) / span) * (height - 2 * pad);

  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');

  const delta = epssTrendDelta(points);
  const dir = epssTrendDirection(delta);
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1].score);

  return (
    <svg
      className={`epss-sparkline epss-trend-${dir}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`EPSS trend ${dir}`}
    >
      <polyline points={path} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="1.8" />
    </svg>
  );
};
