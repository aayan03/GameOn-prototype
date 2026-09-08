import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { playgroundApi } from '../api/endpoints.js';
import SportIcon from '../components/SportIcon.jsx';
import { SPORT_LABELS } from '../utils/format.js';
import { prettyDate } from '../utils/date.js';
import { IconArrowLeft, IconSparkle } from '../components/Icons.jsx';

const STATUS = {
  pending: { label: 'Being reviewed', cls: 'badge-warning' },
  approved: { label: 'Live on the map', cls: 'badge-success' },
  rejected: { label: 'Not published', cls: 'badge-danger' },
};

/**
 * What I sent in, and what happened to it.
 *
 * The notification tells a contributor the outcome once; this is where they
 * can go back and check. Without it, "we'll let you know" is the last they
 * ever hear about a thing they took the trouble to add.
 */
export default function PlaygroundsMine() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    playgroundApi.mine()
      .then(({ data }) => setRows(data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="container section center" style={{ paddingTop: 60 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  const live = rows.filter((r) => r.moderationStatus === 'approved').length;

  return (
    <div className="container section" style={{ maxWidth: 820 }}>
      <Link to="/playgrounds" className="link-btn row gap-6" style={{ marginBottom: 16 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> All free grounds
      </Link>

      <div className="between gap-16 wrap" style={{ marginBottom: 20 }}>
        <div>
          <span className="eyebrow">Community</span>
          <h1 style={{ marginTop: 8 }}>Grounds you&rsquo;ve added</h1>
          {live > 0 && (
            <p className="text-soft" style={{ marginTop: 6 }}>
              {live} of yours {live === 1 ? 'is' : 'are'} on the map for everyone to find.
            </p>
          )}
        </div>
        <Link to="/playgrounds/new" className="btn btn-primary">
          <IconSparkle style={{ width: 16, height: 16 }} /> Add another
        </Link>
      </div>

      {!rows.length ? (
        <div className="card card-pad empty">
          <div className="empty-icon">🌳</div>
          <h3>You haven&rsquo;t added one yet</h3>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 18, maxWidth: '44ch', marginInline: 'auto' }}>
            Know a park or maidan people can play at for free? Put it on the map
            and everyone nearby can find it.
          </p>
          <Link to="/playgrounds/new" className="btn btn-primary">Add a ground</Link>
        </div>
      ) : (
        <div className="stack gap-12">
          {rows.map((r) => {
            const s = STATUS[r.moderationStatus] || STATUS.pending;
            return (
              <div key={r._id} className="card card-pad owner-row">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row gap-8 wrap">
                    <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.02rem' }}>{r.name}</strong>
                    <span className={`badge ${s.cls}`}>{s.label}</span>
                  </div>
                  <div className="row gap-6 wrap" style={{ marginTop: 6 }}>
                    {r.sports?.map((sp) => (
                      <span key={sp} className="game-chip">
                        <SportIcon sport={sp} size={12} /> {SPORT_LABELS[sp] || sp}
                      </span>
                    ))}
                  </div>
                  <p className="text-faint" style={{ marginTop: 6, fontSize: '.85rem' }}>
                    {/* prettyDate takes a YYYY-MM-DD key and appends a time to it;
                        handing it a full ISO string yields an Invalid Date. */}
                    Added {prettyDate(String(r.createdAt).slice(0, 10))}
                    {[r.address?.area, r.address?.city].filter(Boolean).length > 0
                      && ` · ${[r.address?.area, r.address?.city].filter(Boolean).join(', ')}`}
                  </p>

                  {/* The reason, so a rejection is actionable rather than a dead end. */}
                  {r.moderationStatus === 'rejected' && r.moderationNote && (
                    <div className="alert alert-error" style={{ marginTop: 10 }}>
                      <span>{r.moderationNote}</span>
                    </div>
                  )}
                </div>

                <div className="row gap-8 wrap">
                  <Link to={`/playgrounds/${r.slug || r._id}`} className="btn btn-ghost btn-sm">View</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
