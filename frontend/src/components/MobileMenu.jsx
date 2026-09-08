import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { navSections } from '../config/nav.js';
import NavIcon from './NavIcon.jsx';
import { IconClose, IconUser } from './Icons.jsx';
import { initials } from '../utils/format.js';

/**
 * The nav, for screens that cannot show the nav.
 *
 * `.nav-links` is hidden below 900px and the bottom tab bar only holds six
 * destinations, so everything else was reachable on a phone by typing the
 * URL. Map and Events were footer-only; an owner could not reach their
 * calendar, promos, customers or payouts at all.
 *
 * ── Shaped like a native menu, not a list of links ───────────────────
 * Every row is a capsule of the same height with an icon in a tinted chip,
 * because that is what a menu row looks like on both platforms and because
 * equal-sized targets are easier to hit without looking. The sheet slides
 * from the right — the edge the button is on — and carries a header with
 * who you are signed in as, which is where a phone menu puts it.
 */
export default function MobileMenu() {
  const { isAuthenticated, isOwner, user } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  const sections = navSections({
    isAuthenticated, isOwner, isAdmin: user?.role === 'admin',
  });

  // Following a link closes it. Keyed on the location rather than an onClick
  // per link, so a link added later cannot forget to.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)
        && !buttonRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        className={`nav-more${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menu"
      >
        <span className="nav-more-bars" aria-hidden="true"><span /><span /><span /></span>
      </button>

      {open && (
        <div className="sheet-backdrop" role="presentation">
          <div className="sheet" role="menu" aria-label="Menu" ref={panelRef}>
            <div className="sheet-head">
              {isAuthenticated ? (
                <div className="sheet-who">
                  <span className="sheet-avatar">{initials(user.name)}</span>
                  <div style={{ minWidth: 0 }}>
                    <strong>{user.name}</strong>
                    <span className="sheet-role">
                      {user.role === 'admin' ? 'Admin' : user.role === 'owner' ? 'Venue owner' : 'Player'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="sheet-who">
                  <span className="sheet-avatar guest"><IconUser style={{ width: 18, height: 18 }} /></span>
                  <div><strong>Welcome</strong><span className="sheet-role">Not signed in</span></div>
                </div>
              )}
              <button className="sheet-x" onClick={() => setOpen(false)} aria-label="Close menu">
                <IconClose style={{ width: 17, height: 17 }} />
              </button>
            </div>

            <div className="sheet-body">
              {sections.map((section) => (
                <div key={section.key} className="sheet-group">
                  <div className="sheet-label">{section.label}</div>
                  {section.links.map((l) => (
                    <NavLink
                      key={l.to}
                      to={l.to}
                      role="menuitem"
                      className={({ isActive }) => `sheet-item${isActive ? ' active' : ''}`}
                    >
                      <span className="sheet-ico"><NavIcon name={l.icon} size={16} /></span>
                      <span className="sheet-text">{l.label}</span>
                    </NavLink>
                  ))}
                </div>
              ))}

              {!isAuthenticated && (
                <div className="sheet-group">
                  <div className="sheet-label">Account</div>
                  <NavLink to="/login" role="menuitem" className="sheet-item">
                    <span className="sheet-ico"><IconUser style={{ width: 16, height: 16 }} /></span>
                    <span className="sheet-text">Log in</span>
                  </NavLink>
                  <NavLink to="/register" role="menuitem" className="sheet-item primary">
                    <span className="sheet-ico"><IconUser style={{ width: 16, height: 16 }} /></span>
                    <span className="sheet-text">Sign up</span>
                  </NavLink>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
