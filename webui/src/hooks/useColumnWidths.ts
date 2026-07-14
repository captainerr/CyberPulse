import { useCallback, useRef, useState } from 'react';

/**
 * Resizable table columns with localStorage persistence.
 * Returns the current per-column widths and a `startResize` handler to wire to
 * a drag handle on each column header. Widths persist under `storageKey`.
 */
export function useColumnWidths(storageKey: string, defaults: Record<string, number>) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return { ...defaults, ...(JSON.parse(raw) as Record<string, number>) };
    } catch {
      /* ignore malformed storage */
    }
    return { ...defaults };
  });

  // Active drag state lives in a ref so the document listeners stay stable.
  const drag = useRef<{ id: string; startX: number; startW: number } | null>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    const next = Math.max(60, d.startW + (e.clientX - d.startX));
    setWidths((w) => ({ ...w, [d.id]: next }));
  }, []);

  const onMouseUp = useCallback(() => {
    drag.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    // Persist the final widths.
    setWidths((w) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(w));
      } catch {
        /* ignore quota/availability errors */
      }
      return w;
    });
  }, [onMouseMove, storageKey]);

  const startResize = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation(); // don't trigger column sort
      drag.current = { id, startX: e.clientX, startW: widths[id] ?? defaults[id] ?? 120 };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    },
    [widths, defaults, onMouseMove, onMouseUp]
  );

  const totalWidth = Object.keys(defaults).reduce((sum, id) => sum + (widths[id] ?? defaults[id]), 0);

  return { widths, startResize, totalWidth };
}
