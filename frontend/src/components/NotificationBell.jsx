import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { notificationApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { IconClose, IconCheck } from './Icons.jsx';

const POLL_MS = 60_000;

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

export default function NotificationBell() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  const poll = useCallback(() => {
    if (!isAuthenticated) return;
    notificationApi.unreadCount()
      .then(({ data }) => setUnread(data.unread))
      .catch(() => {});   // a failed poll is not worth a toast
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) { setUnread(0); setItems([]); return undefined; }
    poll();
    const t = setInterval(poll, POLL_MS);
    // Catch up immediately when the tab comes back to the foreground.
    const onVisible = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [isAuthenticated, poll]);

  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    notificationApi.list({ page: 1 })
      .then(({ data, meta }) => { setItems(data); setUnread(meta.unread ?? 0); })
      .catch(() => {})
      .finally(() => setLoading(false));

    const onDown = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openItem = async (n) => {
    setOpen(false);
    if (!n.readAt) {
      notificationApi.markRead([n._id]).then(({ data }) => setUnread(data.unread)).catch(() => {});
    }
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    try {
      const { data } = await notificationApi.markRead();
      setUnread(data.unread);
      setItems((list) => list.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    } catch { /* noop */ }
  };

  if (!isAuthenticated) return null;

  return (
    <div className="bell-wrap" ref={panelRef}>
      <button
        className="bell" onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
             strokeLinecap="round" strokeLinejoin="round" style={{ width: 21, height: 21 }}>
          <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
          <path d="M10.5 20a2 2 0 0 0 3 0" />
        </svg>
        {unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="menu-panel bell-panel" role="dialog" aria-label="Notifications">
          <div className="menu-head between">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="link-btn" onClick={markAll}>
                <IconCheck style={{ width: 13, height: 13 }} /> Mark all read
              </button>
            )}
          </div>

          <div className="bell-list">
            {loading ? (
              <div className="bell-empty"><span className="spinner" /></div>
            ) : items.length ? (
              items.map((n) => (
                <button
                  key={n._id}
                  className={`bell-item${n.readAt ? '' : ' unread'}`}
                  onClick={() => openItem(n)}
                >
                  <span className="bell-icon" aria-hidden="true">{n.icon}</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <strong>{n.title}</strong>
                    <span className="bell-body">{n.body}</span>
                    <span className="text-faint">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="bell-empty">
                <span style={{ fontSize: '2rem' }}>🔔</span>
                <p className="text-soft" style={{ marginTop: 8 }}>Nothing yet. We'll tell you when something happens.</p>
              </div>
            )}
          </div>

          <Link to="/notifications" className="menu-item" onClick={() => setOpen(false)}>
            See all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
