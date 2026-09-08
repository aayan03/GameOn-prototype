import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import usePWA from '../hooks/usePWA.js';
import { initials, rupees } from '../utils/format.js';
import TierBadge from './TierBadge.jsx';
import NotificationBell from './NotificationBell.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import MobileMenu from './MobileMenu.jsx';
import NavMenu from './NavMenu.jsx';
import { navMenus } from '../config/nav.js';
import { IconUser, IconHeart, IconLogout, IconTicket, IconWallet, IconUsers, IconSparkle, IconDownload } from './Icons.jsx';

export default function Navbar() {
  const { user, isAuthenticated, isOwner, logout } = useAuth();
  const { canInstall, install } = usePWA();
  const isAdmin = user?.role === 'admin';
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  // Close the dropdown on any outside click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const handleLogout = () => { logout(); setOpen(false); navigate('/'); };

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link to="/" className="logo" aria-label="GameOn home">
          <span className="logo-mark">GO</span>
          <span className="logo-word">GameOn</span>
        </Link>

        {/*
          Grouped headings with the detail one click down, rendered from
          config/nav.js — which the mobile sheet also reads, so the two
          cannot drift. Flat, an owner read nine links across one line:
          Find venues / Map / Events / Free grounds / TeamUp / Teams /
          My venues / Requests / My events.
        */}
        <nav className="nav-links" aria-label="Main">
          {navMenus({ isAuthenticated, isOwner, isAdmin }).map((m) => (
            m.to
              ? (
                <NavLink
                  key={m.key}
                  to={m.to}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  {m.label}
                </NavLink>
              )
              : <NavMenu key={m.key} menu={m} />
          ))}
        </nav>

        <div className="nav-right">
          {/* Below 900px this is the ONLY way to most of the site. */}
          <MobileMenu />

          {/*
            A standing way in, not just the banner.

            The install prompt appears once, a few seconds after load, and is
            dismissible — so anyone who closed it, or was scrolling when it
            slid past, had no route back and no reason to think the app could
            be installed at all. `canInstall` is only true where the browser
            has actually offered (Chrome and Edge, desktop and Android), so
            this shows up exactly when pressing it will work.
          */}
          {canInstall && (
            <button className="nav-install" onClick={install} title="Install GameOn as an app">
              <IconDownload style={{ width: 15, height: 15 }} />
              <span className="nav-install-text">Install</span>
            </button>
          )}
          {/* Before the bell, so it does not move when a notification badge
              appears and changes the bell's width. */}
          <ThemeToggle />
          <NotificationBell />
          {isAuthenticated ? (
            <div className="user-menu" ref={menuRef}>
              <button
                className="avatar" onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu" aria-expanded={open} aria-label="Account menu"
              >
                {initials(user.name)}
              </button>
              {open && (
                <div className="menu-panel" role="menu">
                  <div className="menu-head">
                    <div style={{ fontWeight: 700 }}>{user.name}</div>
                    <div className="text-faint" style={{ wordBreak: 'break-all' }}>{user.email}</div>
                    <div className="row gap-6 wrap" style={{ marginTop: 8 }}>
                      <span className="badge badge-violet">
                        {user.role === 'owner' ? 'Venue owner' : 'Player'}
                      </span>
                      <span className="badge badge-soft">{rupees(user.walletBalance || 0)}</span>
                      <TierBadge tier={user.loyaltyTier} />
                    </div>
                  </div>
                  <Link to="/profile" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                    <IconUser style={{ width: 17, height: 17 }} /> Profile
                  </Link>
                  <Link to="/favorites" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                    <IconHeart style={{ width: 17, height: 17 }} /> Saved venues
                  </Link>
                  <Link to="/bookings" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                    <IconTicket style={{ width: 17, height: 17 }} /> My bookings
                  </Link>
                  <Link to="/wallet" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                    <IconWallet style={{ width: 17, height: 17 }} /> Wallet
                  </Link>
                  <Link to="/loyalty" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                    <IconSparkle style={{ width: 17, height: 17 }} /> Loyalty &amp; rewards
                  </Link>
                  <Link to="/teams" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                    <IconUsers style={{ width: 17, height: 17 }} /> My teams
                  </Link>
                  <button className="menu-item danger" role="menuitem" onClick={handleLogout}>
                    <IconLogout style={{ width: 17, height: 17 }} /> Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to="/login" className="btn btn-onlight btn-sm">Log in</Link>
              <Link to="/register" className="btn btn-primary btn-sm">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
