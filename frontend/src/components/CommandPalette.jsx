import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { searchApi } from '../api/endpoints.js';
import useDebounce from '../hooks/useDebounce.js';
import { actionsFor, matchActions, defaultActions } from '../utils/actions.js';
import {
  IconSearch, IconClose, IconMap, IconCalendar, IconSparkle, IconUsers,
  IconTicket, IconWallet, IconHeart, IconUser, IconHome, IconBolt,
  IconShield, IconInfo, IconPin, IconChevron,
} from './Icons.jsx';

const ICONS = {
  search: IconSearch, map: IconMap, calendar: IconCalendar, sparkle: IconSparkle,
  users: IconUsers, ticket: IconTicket, wallet: IconWallet, heart: IconHeart,
  user: IconUser, home: IconHome, bolt: IconBolt, shield: IconShield, info: IconInfo,
};

/** What each kind of remote result looks like in the list. */
const RESULT_KIND = {
  venue: { label: 'Venues', Icon: IconPin },
  event: { label: 'Events', Icon: IconCalendar },
  parlor: { label: 'Game parlours', Icon: IconSparkle },
  game: { label: 'Games to join', Icon: IconUsers },
};

const GROUP_ORDER = ['venue', 'parlor', 'event', 'game'];

/**
 * One box for the whole site: jump to any page, or find any venue, parlour,
 * event or open game.
 *
 * Two sources, deliberately. Actions match in the browser and appear the
 * instant you type — nobody should wait on a network round trip to reach
 * their own wallet. Listings come from /api/search, debounced, and arrive a
 * moment later underneath. The list is one flat sequence of options no matter
 * which source filled it, so the arrow keys and Enter behave the same way
 * throughout.
 */
export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { isAuthenticated, isOwner, user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Where focus was before the dialog opened, so it can be handed back.
  const restoreTo = useRef(null);

  const debounced = useDebounce(query, 250);
  const actions = useMemo(
    () => actionsFor({ isAuthenticated, isOwner, isAdmin }),
    [isAuthenticated, isOwner, isAdmin]
  );

  /* ── Open / close ─────────────────────────────────────────── */

  useEffect(() => {
    if (!open) return undefined;
    restoreTo.current = document.activeElement;
    // A fresh box every time. Reopening onto a stale query and stale results
    // makes the shortcut feel like it did not fire.
    setQuery('');
    setRemote(null);
    setCursor(0);

    // The dialog scrolls; the page behind it must not.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => inputRef.current?.focus(), 20);

    return () => {
      clearTimeout(t);
      document.body.style.overflow = overflow;
      restoreTo.current?.focus?.();
    };
  }, [open]);

  /* ── Remote search ────────────────────────────────────────── */

  useEffect(() => {
    const q = debounced.trim();
    if (!open || q.length < 2) { setRemote(null); setLoading(false); return undefined; }

    let cancelled = false;
    setLoading(true);
    searchApi.all({ q, limit: 4 })
      .then(({ data }) => { if (!cancelled) setRemote(data); })
      // Silent on failure. The action list still works, so a dead network
      // degrades the palette rather than breaking it.
      .catch(() => { if (!cancelled) setRemote(null); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [debounced, open]);

  /* ── The flat list ────────────────────────────────────────── */

  const groups = useMemo(() => {
    const out = [];
    const matched = query.trim()
      ? matchActions(actions, query)
      : defaultActions(actions);

    if (matched.length) {
      out.push({
        key: 'actions',
        label: query.trim() ? 'Go to' : 'Jump to',
        items: matched.map((a) => ({
          id: `action:${a.id}`,
          title: a.label,
          subtitle: a.group,
          to: a.to,
          Icon: ICONS[a.icon] || IconChevron,
        })),
      });
    }

    for (const kind of GROUP_ORDER) {
      const rows = remote?.results?.[kind];
      if (!rows?.length) continue;
      const { label, Icon } = RESULT_KIND[kind];
      out.push({
        key: kind,
        label,
        items: rows.map((r) => ({
          id: `${kind}:${r.id}`,
          title: r.title,
          subtitle: r.subtitle,
          meta: r.meta,
          to: r.to,
          Icon,
        })),
      });
    }
    return out;
  }, [actions, query, remote]);

  // One sequence across every group — the cursor does not care about headings.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Results arrive after the list has been drawn, so the cursor can end up
  // past the end of a list that just shrank.
  useEffect(() => { setCursor((c) => (c >= flat.length ? 0 : c)); }, [flat.length]);

  const go = useCallback((to) => {
    if (!to) return;
    onClose();
    navigate(to);
  }, [navigate, onClose]);

  /* ── Keyboard ─────────────────────────────────────────────── */

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') { e.preventDefault(); go(flat[cursor]?.to); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

    e.preventDefault();
    if (!flat.length) return;
    // Wraps, so holding one arrow key never dead-ends.
    const next = e.key === 'ArrowDown'
      ? (cursor + 1) % flat.length
      : (cursor - 1 + flat.length) % flat.length;
    setCursor(next);
    listRef.current
      ?.querySelector(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  if (!open) return null;

  const typed = query.trim().length >= 2;
  const empty = !flat.length && !loading;

  let index = -1;

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search GameOn"
        // The backdrop closes on click; clicks inside the panel must not
        // bubble up to it.
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-input">
          <IconSearch style={{ width: 20, height: 20, color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            placeholder="Search venues, parlours, events — or jump to a page"
            aria-label="Search"
            aria-autocomplete="list"
            aria-controls="palette-list"
            autoComplete="off"
            spellCheck="false"
          />
          {loading && <span className="spinner" style={{ width: 16, height: 16 }} />}
          <button className="palette-x" onClick={onClose} aria-label="Close search">
            <IconClose style={{ width: 16, height: 16 }} />
          </button>
        </div>

        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {groups.map((group) => (
            <div key={group.key} className="palette-group">
              <div className="palette-group-label">{group.label}</div>
              {group.items.map((item) => {
                index += 1;
                const i = index;
                const { Icon } = item;
                return (
                  <button
                    key={item.id}
                    data-index={i}
                    role="option"
                    aria-selected={i === cursor}
                    className={`palette-row${i === cursor ? ' active' : ''}`}
                    // Highlight follows the pointer, so mouse and keyboard
                    // never disagree about what Enter would open.
                    onMouseMove={() => setCursor(i)}
                    onClick={() => go(item.to)}
                  >
                    <span className="palette-row-icon"><Icon style={{ width: 16, height: 16 }} /></span>
                    <span className="palette-row-text">
                      <strong>{item.title}</strong>
                      {item.subtitle && <span className="palette-row-sub">{item.subtitle}</span>}
                    </span>
                    {item.meta && <span className="palette-row-meta">{item.meta}</span>}
                  </button>
                );
              })}
            </div>
          ))}

          {empty && (
            <div className="palette-empty">
              {typed
                ? <>Nothing matches <strong>{query.trim()}</strong>.</>
                : 'Type to search venues, parlours, events and pages.'}
            </div>
          )}
        </div>

        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>↵</kbd> to open</span>
          <span><kbd>esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
