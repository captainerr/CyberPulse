import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const LINKS = [
  { to: '/', label: 'Command Center', end: true },
  { to: '/catalog', label: 'KEV Catalog', end: false },
  { to: '/breaches', label: 'Breaches', end: false },
  { to: '/briefing', label: 'Analysts Briefing', end: false },
  { to: '/hunting', label: 'Hunting Queries', end: false },
];

export const NavBar: React.FC = () => {
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
      <NavLink to="/" className="nav-brand" aria-label="CyberPulse home">
        root@cyberpulse:~$<span className="nav-brand-cursor" aria-hidden="true" />
      </NavLink>
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
    </nav>
  );
};
