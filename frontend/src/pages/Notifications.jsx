import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { notificationApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { IconCheck, IconTrash } from '../components/Icons.jsx';

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export default function Notifications() {
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pages: 1, unread: 0 });
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = (page = 1) => {
    setLoading(true);
    notificationApi.list({ page, unread: filter === 'unread' ? 'true' : undefined })
      .then(({ data, meta: m }) => { setItems(data); setMeta(m); })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(1); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (n) => {
    if (!n.readAt) notificationApi.markRead([n._id]).catch(() => {});
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    try { await notificationApi.markRead(); toast.success('All caught up.'); load(meta.page); }
    catch (e) { toast.error(e.message); }
  };

  const remove = async (id) => {
    try { await notificationApi.remove(id); setItems((l) => l.filter((n) => n._id !== id)); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="container section fade-in" style={{ maxWidth: 720 }}>
      <div className="between gap-16 wrap page-head">
        <div>
          <span className="eyebrow">Activity</span>
          <h1 style={{ marginTop: 8 }}>Notifications</h1>
          <p className="text-soft">Bookings, join requests and everything else worth knowing.</p>
        </div>
        {meta.unread > 0 && (
          <button className="btn btn-ghost" onClick={markAll}>
            <IconCheck style={{ width: 16, height: 16 }} /> Mark all read
          </button>
        )}
      </div>

      <div className="row gap-10 wrap" style={{ marginBottom: 20 }}>
        <button className={`pill${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>All</button>
        <button className={`pill${filter === 'unread' ? ' active' : ''}`} onClick={() => setFilter('unread')}>
          Unread {meta.unread > 0 && `(${meta.unread})`}
        </button>
      </div>

      {loading ? (
        <div className="stack gap-12">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 84 }} />)}
        </div>
      ) : items.length ? (
        <div className="stack gap-12">
          {items.map((n) => (
            <div key={n._id} className={`notif-row${n.readAt ? '' : ' unread'}`}>
              <button className="notif-main" onClick={() => open(n)}>
                <span className="bell-icon" aria-hidden="true">{n.icon}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong>{n.title}</strong>
                  <span className="bell-body">{n.body}</span>
                  <span className="text-faint">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
              <button className="icon-btn bare" onClick={() => remove(n._id)} aria-label="Delete">
                <IconTrash style={{ width: 16, height: 16 }} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card card-pad empty">
          <div className="empty-icon">🔔</div>
          <h3>{filter === 'unread' ? 'All caught up' : 'Nothing yet'}</h3>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 20 }}>
            We'll let you know when a booking is confirmed or someone asks to join your game.
          </p>
          <Link to="/venues" className="btn btn-primary">Find a venue</Link>
        </div>
      )}

      {meta.pages > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost btn-sm" disabled={meta.page <= 1} onClick={() => load(meta.page - 1)}>Previous</button>
          <span className="text-soft">Page {meta.page} of {meta.pages}</span>
          <button className="btn btn-ghost btn-sm" disabled={meta.page >= meta.pages} onClick={() => load(meta.page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
