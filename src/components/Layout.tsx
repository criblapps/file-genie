import { NavLink, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">LKP</span>
          <span className="sidebar__title">File Genie</span>
        </div>
        <ul className="sidebar__nav">
          <li>
            <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>
              <InventoryIcon />
              Inventory
            </NavLink>
          </li>
          <li>
            <NavLink to="/drift" className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>
              <DriftIcon />
              Drift Dashboard
            </NavLink>
          </li>
        </ul>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

function InventoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="2" width="14" height="3" rx="1" fill="currentColor" opacity="0.8" />
      <rect x="1" y="7" width="14" height="3" rx="1" fill="currentColor" opacity="0.8" />
      <rect x="1" y="12" width="14" height="3" rx="1" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

function DriftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v3.5l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

