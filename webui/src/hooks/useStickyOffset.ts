import { useEffect, useRef, useState } from 'react';

/** Height of the persistent NavBar, must match --nav-h in styles.css */
export const NAV_HEIGHT = 48;

/**
 * Measures a header element's rendered height and returns the total sticky
 * offset that a table thead should use to avoid being obscured by sticky chrome.
 */
export function useStickyOffset() {
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setHeaderHeight(el.offsetHeight);
    });
    observer.observe(el);
    setHeaderHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  return { headerRef, tableTop: NAV_HEIGHT + headerHeight };
}
