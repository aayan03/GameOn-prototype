import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { navSections } from '../config/nav.js';
import { IconClose, IconChevron } from './Icons.jsx';

/**
 * The nav, for screens that cannot show the nav.
 *
 * `.nav-links` is hidden below 900px, and the bottom tab bar only has room
 * for six destinations — so everything else was reachable on a phone by
 * typing the URL. Map and Events were footer-only; an owner could not get to
 * their calendar, promos, customers or payouts at all, and an admin could
 * not reach the moderation queue.
 *
 * A sheet rather than a dropdown: there are up to eleven links here with
 * headings, which is more than a 250px panel hanging off a button can hold
 * on a 320px screen.
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

  // Following a link inside the sheet should close it. Keyed on the location
  // rather than an onClick per link, so a link added later cannot forget to.
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
    // The sheet scrolls; the page behind it must not.
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
        className="nav-more"
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
              <strong>Menu</strong>
              <button className="palette-x" onClick={() => setOpen(false)} aria-label="Close menu">
                <IconClose style={{ width: 16, height: 16 }} />
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
                      <span>{l.label}</span>
                      <IconChevron style={{ width: 15, height: 15, opacity: .5 }} />
                    </NavLink>
                  ))}
                </div>
              ))}

              {!isAuthenticated && (
                <div className="sheet-group">
                  <div className="sheet-label">Account</div>
                  <NavLink to="/login" role="menuitem" className="sheet-item"><span>Log in</span></NavLink>
                  <NavLink to="/register" role="menuitem" className="sheet-item"><span>Sign up</span></NavLink>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
