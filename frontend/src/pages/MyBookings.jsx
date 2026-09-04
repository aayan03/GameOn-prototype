import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { bookingApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import CancelModal from '../components/CancelModal.jsx';
import ReviewModal from '../components/ReviewModal.jsx';
import { prettyDate, slotRangeLabel, relativeTime } from '../utils/date.js';
import { rupees, SPORT_ICONS } from '../utils/format.js';
import { IconPin, IconWallet, IconTicket, IconChevron } from '../components/Icons.jsx';

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function BookingRow({ booking, onCancel, onReview }) {
  const d = new Date(`${booking.date}T00:00:00`);
  const venue = booking.venue || {};
  const isPending = booking.status === 'pending';
  const isCancelled = ['cancelled', 'rejected'].includes(booking.status);

  const statusBadge = booking.status === 'confirmed' ? { cls: 'badge-instant', text: 'Confirmed' }
    : isPending ? { cls: 'badge-manual', text: 'Awaiting venue' }
    : booking.status === 'rejected' ? { cls: 'badge-danger', text: 'Declined' }
    : booking.status === 'cancelled' ? { cls: 'badge-danger', text: 'Cancelled' }
    : { cls: 'badge-soft', text: 'Completed' };

  return (
    <div className={`booking-row${isCancelled ? ' cancelled' : ''}${isPending ? ' pending' : ''}`}>
      <div className="booking-date">
        <span style={{ fontSize: '.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {MON[d.getMonth()]}
        </span>
        <span style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.9rem', fontWeight: 900, lineHeight: 1 }}>
          {d.getDate()}
        </span>
        <span style={{ fontSize: '.7rem', fontWeight: 700 }}>{prettyDate(booking.date).split(',')[0]}</span>
      </div>

      <div className="booking-main">
        <div className="row gap-8 wrap">
          <Link to={`/bookings/${booking.groupRef}`} style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '1.05rem' }}>
            {venue.name}
          </Link>
          <span className={`badge ${statusBadge.cls}`}>{statusBadge.text}</span>
        </div>

        <div className="text-soft" style={{ fontSize: '.89rem', fontWeight: 600 }}>
          {SPORT_ICONS[booking.sport]} {booking.courtName} · {slotRangeLabel(booking.slots)}
          {booking.slots.length > 1 && ` · ${booking.slots.length} slots`}
        </div>

        <div className="row gap-4 text-faint">
          <IconPin style={{ width: 13, height: 13 }} />
          {[venue.address?.area, venue.address?.city].filter(Boolean).join(', ')}
        </div>

        <div className="row gap-12 wrap" style={{ marginTop: 2 }}>
          <strong className="mono">{rupees(booking.totalAmount)}</strong>
          {!isCancelled && new Date(booking.startsAt) > new Date() && (
            <span className="badge badge-soft">Starts {relativeTime(booking.startsAt)}</span>
          )}
          {isCancelled && booking.cancellation?.refundAmount > 0 && (
            <span className="badge badge-success">{rupees(booking.cancellation.refundAmount)} refunded</span>
          )}
        </div>
      </div>

      <div className="booking-actions">
        <Link to={`/bookings/${booking.groupRef}`} className="btn btn-ghost btn-sm">
          View ticket <IconChevron style={{ width: 14, height: 14 }} />
        </Link>
        {onCancel && (
          <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => onCancel(booking)}>
            Cancel
          </button>
        )}
        {onReview && booking.status === 'completed' && (
          <button className="btn btn-sm btn-primary" onClick={() => onReview(booking)}>
            Rate venue
          </button>
        )}
      </div>
    </div>
  );
}

export default function MyBookings() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('upcoming');
  const [data, setData] = useState({ upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);

  const load = () => {
    setLoading(true);
    bookingApi.mine()
      .then(({ data: d }) => {
        setData(d);
        if (typeof d.walletBalance === 'number' && user) setUser({ ...user, walletBalance: d.walletBalance });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onCancelled = (res) => {
    toast.success(res.message);
    if (typeof res.walletBalance === 'number') setUser({ ...user, walletBalance: res.walletBalance });
    setCancelTarget(null);
    load();
  };

  const list = tab === 'upcoming' ? data.upcoming : data.past;

  return (
    <div className="container section fade-in">
      <div className="between gap-16 wrap page-head">
        <div>
          <h1>My bookings</h1>
          <p className="text-soft">Your games, tickets and refunds in one place.</p>
        </div>
        <Link to="/wallet" className="btn btn-ghost">
          <IconWallet style={{ width: 17, height: 17 }} />
          Wallet · {rupees(user?.walletBalance || 0)}
        </Link>
      </div>

      <div className="row gap-10 wrap" style={{ marginBottom: 22 }}>
        <button className={`pill${tab === 'upcoming' ? ' active' : ''}`} onClick={() => setTab('upcoming')}>
          Upcoming {data.upcoming.length > 0 && `(${data.upcoming.length})`}
        </button>
        <button className={`pill${tab === 'past' ? ' active' : ''}`} onClick={() => setTab('past')}>
          Past {data.past.length > 0 && `(${data.past.length})`}
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 18 }}>{error}</div>}

      {loading ? (
        <div className="stack gap-14">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 128 }} />)}
        </div>
      ) : list.length ? (
        <div className="stack gap-14">
          {list.map((b) => (
            <BookingRow
              key={b.groupRef}
              booking={b}
              onCancel={tab === 'upcoming' ? setCancelTarget : null}
              onReview={tab === 'past' ? setReviewTarget : null}
            />
          ))}
          {/* The API caps how far back it reads. Say so, rather than showing a
              partial history as though it were the whole thing. */}
          {tab === 'past' && data.hasMore && (
            <p className="text-faint" style={{ textAlign: 'center', padding: '8px 0' }}>
              Showing your most recent games. Older bookings are not listed here.
            </p>
          )}
        </div>
      ) : (
        <div className="card card-pad empty">
          <div className="empty-icon">{tab === 'upcoming' ? '🎟️' : '📼'}</div>
          <h3>{tab === 'upcoming' ? 'No games coming up' : 'Nothing in your history yet'}</h3>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 22 }}>
            {tab === 'upcoming'
              ? 'Find a turf near you and lock in a slot — it takes about a minute.'
              : 'Once you play a game it will show up here.'}
          </p>
          <Link to="/venues" className="btn btn-primary btn-lg">
            <IconTicket style={{ width: 18, height: 18 }} /> Book a slot
          </Link>
        </div>
      )}

      {cancelTarget && (
        <CancelModal
          booking={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={onCancelled}
        />
      )}

      {reviewTarget && (
        <ReviewModal
          venueId={reviewTarget.venue?._id}
          venueName={reviewTarget.venue?.name}
          onClose={() => setReviewTarget(null)}
          onSaved={() => { setReviewTarget(null); load(); }}
        />
      )}
    </div>
  );
}
