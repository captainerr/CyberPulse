import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

const LINKS = [
  { to: '/', label: 'Command Center', end: true },
  { to: '/catalog', label: 'KEV Catalog', end: false },
  { to: '/breaches', label: 'Breaches', end: false },
  { to: '/briefing', label: 'Analysts Briefing', end: false },
  { to: '/hunting', label: 'Hunting Queries', end: false },
];

export const NavBar: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Collapse the mobile menu whenever the route changes.
  React.useEffect(() => setOpen(false), [location.pathname]);

  return (
    <nav className="app-nav" aria-label="Main navigation">
      <button
        type="button"
        className="nav-toggle"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={open}
        aria-controls="nav-links"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '✕' : '☰'}
      </button>
      <div id="nav-links" className={`nav-links${open ? ' nav-links-open' : ''}`}>
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`}
          >
            {l.label}
          </NavLink>
        ))}
      </div>
      <button
        onClick={toggleTheme}
        className="theme-toggle"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
    </nav>
  );
};
