import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import NavIcon from './NavIcon.jsx';
import { IconChevron } from './Icons.jsx';

/**
 * One heading in the desktop bar, with its links a click below.
 *
 * Click, not hover. A hover menu opens when you merely pass over it on the
 * way somewhere else, cannot be opened from a keyboard without extra work,
 * and does not exist on a touchscreen at all — and this same bar is shown on
 * tablets down to 900px.
 */
export default function NavMenu({ menu }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const location = useLocation();

  // Any of its links being the current page marks the heading, so you can see
  // where you are without opening anything.
  const isActive = menu.links.some((l) => location.pathname === l.to
    || location.pathname.startsWith(`${l.to}/`));

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="nav-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        className={`nav-link nav-link-btn${isActive ? ' active' : ''}${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {menu.label}
        <IconChevron
          className="nav-caret"
          style={{ width: 13, height: 13, transform: open ? 'rotate(-90deg)' : 'rotate(90deg)' }}
        />
      </button>

      {open && (
        <div className="nav-dropdown" role="menu" aria-label={menu.label}>
          {menu.links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              role="menuitem"
              className={({ isActive: on }) => `nav-drop-item${on ? ' active' : ''}`}
            >
              <span className="nav-drop-ico"><NavIcon name={l.icon} size={16} /></span>
              <span className="nav-drop-text">
                <span className="nav-drop-label">{l.label}</span>
                {/* A line of explanation each, because "Requests" and "Promo
                    codes" mean nothing until you have opened them once. */}
                {l.hint && <span className="nav-drop-hint">{l.hint}</span>}
              </span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
