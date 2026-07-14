import React from 'react';

/** Shimmering placeholder block used while data loads. Purely decorative. */
export const Skeleton: React.FC<{
  w?: number | string;
  h?: number | string;
  style?: React.CSSProperties;
}> = ({ w = '100%', h = 14, style }) => (
  <span
    className="skeleton"
    aria-hidden="true"
    style={{
      display: 'block',
      width: typeof w === 'number' ? `${w}px` : w,
      height: typeof h === 'number' ? `${h}px` : h,
      ...style,
    }}
  />
);

/** Full-width placeholder standing in for the KEV table while it loads. */
export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <div className="skeleton-table" role="status" aria-busy="true" aria-label="Loading KEV data">
    <div className="skeleton-row">
      <Skeleton h={10} w="40%" />
      <Skeleton h={10} w="50%" />
      <Skeleton h={10} w="60%" />
      <Skeleton h={10} w="55%" />
      <Skeleton h={10} w="45%" />
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <div className="skeleton-row" key={i}>
        <Skeleton h={16} w="85%" />
        <Skeleton h={16} w="70%" />
        <Skeleton h={16} w="50%" />
        <Skeleton h={16} w="60%" />
        <Skeleton h={16} w="75%" />
      </div>
    ))}
  </div>
);
