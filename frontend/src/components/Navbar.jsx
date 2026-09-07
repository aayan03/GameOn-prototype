import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { initials, rupees } from '../utils/format.js';
import TierBadge from './TierBadge.jsx';
import NotificationBell from './NotificationBell.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { IconUser, IconHeart, IconLogout, IconTicket, IconWallet, IconUsers, IconSparkle } from './Icons.jsx';

export default function Navbar() {
  const { user, isAuthenticated, isOwner, logout } = useAuth();
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
          GameOn
        </Link>

        <nav className="nav-links" aria-label="Main">
          <NavLink to="/venues" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Find venues</NavLink>
          <NavLink to="/map" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Map</NavLink>
          <NavLink to="/events" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Events</NavLink>
          <NavLink to="/teamup" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>TeamUp</NavLink>
          {isAuthenticated && (
            <NavLink to="/teams" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Teams</NavLink>
          )}
          {isOwner && (
            <>
              <NavLink to="/owner" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>My venues</NavLink>
              <NavLink to="/owner/requests" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Requests</NavLink>
              <NavLink to="/owner/events" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Events</NavLink>
            </>
          )}
          {isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Admin</NavLink>
          )}
        </nav>

        <div className="nav-right">
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
