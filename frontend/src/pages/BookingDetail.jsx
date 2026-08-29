import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { bookingApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Confetti from '../components/Confetti.jsx';
import CancelModal from '../components/CancelModal.jsx';
import { prettyDateLong, slotRangeLabel, relativeTime } from '../utils/date.js';
import { rupees, SPORT_ICONS, SPORT_LABELS } from '../utils/format.js';
import { IconPin, IconPhone, IconArrowLeft, IconCheck, IconClock } from '../components/Icons.jsx';

/** Deterministic pseudo-QR built from the booking reference. No library needed. */
function QrBlock({ text, size = 21 }) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };

  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inFinder = (fx, fy) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7;
      const finder = inFinder(0, 0) || inFinder(size - 7, 0) || inFinder(0, size - 7);
      let on;
      if (finder) {
        const lx = x % (size - 7 || 1), ly = y % (size - 7 || 1);
        const rx = Math.min(x, Math.abs(x - (size - 7))), ry = Math.min(y, Math.abs(y - (size - 7)));
        const ring = Math.max(Math.min(rx, 6), Math.min(ry, 6));
        on = ring === 0 || ring === 6 || (rx >= 2 && rx <= 4 && ry >= 2 && ry <= 4);
        void lx; void ly;
      } else {
        on = rand() > 0.52;
      }
      if (on) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
    }
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" shapeRendering="crispEdges" role="img" aria-label={`QR code for booking ${text}`}>
      <rect width={size} height={size} fill="#fff" />
      <g fill="#16162B">{cells}</g>
    </svg>
  );
}

export default function BookingDetail() {
  const { groupRef } = useParams();
  const [params, setParams] = useSearchParams();
  const { user, setUser } = useAuth();
  const toast = useToast();

  const isNew = params.get('new') === '1';
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    bookingApi.get(groupRef)
      .then(({ data }) => {
        if (cancelled) return;
        setBooking(data);
        if (isNew) {
          setCelebrate(true);
          // Drop the flag so a refresh doesn't replay the celebration.
          const next = new URLSearchParams(params);
          next.delete('new');
          setParams(next, { replace: true });
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupRef]);

  const onCancelled = (res) => {
    setBooking((b) => ({ ...b, status: 'cancelled' }));
    if (typeof res.walletBalance === 'number') setUser({ ...user, walletBalance: res.walletBalance });
    toast.success(res.message);
    setShowCancel(false);
  };

  if (loading) {
    return (
      <div className="container section">
        <div className="skeleton" style={{ height: 460, maxWidth: 480, margin: '0 auto' }} />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">🎟️</div>
          <h3>{error || 'Booking not found'}</h3>
          <Link to="/bookings" className="btn btn-primary" style={{ marginTop: 20 }}>My bookings</Link>
        </div>
      </div>
    );
  }

  const isPending   = booking.status === 'pending';
  const isConfirmed = booking.status === 'confirmed';
  const isCancelled = booking.status === 'cancelled' || booking.status === 'rejected';
  const upcoming = new Date(booking.endsAt) > new Date();
  const venue = booking.venue || {};

  const statusBadge = isConfirmed ? { cls: 'badge-instant', text: '✓ Confirmed' }
    : isPending ? { cls: 'badge-manual', text: '⏳ Awaiting venue' }
    : booking.status === 'rejected' ? { cls: 'badge-danger', text: 'Declined by venue' }
    : booking.status === 'cancelled' ? { cls: 'badge-danger', text: 'Cancelled' }
    : { cls: 'badge-soft', text: 'Completed' };

  return (
    <div className="container section fade-in">
      <Confetti active={celebrate && !isCancelled} />

      <Link to="/bookings" className="link-btn row gap-6" style={{ marginBottom: 20 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> All bookings
      </Link>

      {celebrate && (
        <div className="center" style={{ marginBottom: 26 }}>
          <div className="success-check">
            <svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7" /></svg>
          </div>
          <h1 style={{ marginBottom: 6 }}>
            {isPending ? 'Request sent!' : "You're booked!"}
          </h1>
          <p className="text-soft">
            {isPending
              ? `${venue.name} will confirm shortly. We'll let you know.`
              : 'See you on the pitch. Show this at the gate.'}
          </p>
        </div>
      )}

      {/* Ticket */}
      <div className="ticket pop-in">
        <div className="ticket-top">
          <span className={`badge ${statusBadge.cls}`}>{statusBadge.text}</span>
          <h2 style={{ marginTop: 12 }}>{venue.name}</h2>
          <p className="row gap-4" style={{ justifyContent: 'center', marginTop: 6, fontWeight: 600 }}>
            <IconPin style={{ width: 15, height: 15 }} />
            {[venue.address?.area, venue.address?.city].filter(Boolean).join(', ')}
          </p>
          <span className="ticket-notch left" style={{ bottom: -17 }} />
          <span className="ticket-notch right" style={{ bottom: -17 }} />
        </div>

        <div className="ticket-body">
          <div className="ticket-grid">
            <div className="ticket-field">
              <span>Date</span>
              <strong>{prettyDateLong(booking.date)}</strong>
            </div>
            <div className="ticket-field">
              <span>Time</span>
              <strong>{slotRangeLabel(booking.slots)}</strong>
            </div>
            <div className="ticket-field">
              <span>Court</span>
              <strong>{SPORT_ICONS[booking.sport]} {booking.courtName}</strong>
            </div>
            <div className="ticket-field">
              <span>Sport</span>
              <strong>{SPORT_LABELS[booking.sport] || booking.sport}</strong>
            </div>
            <div className="ticket-field">
              <span>Players</span>
              <strong>{booking.players}</strong>
            </div>
            <div className="ticket-field">
              <span>Paid</span>
              <strong>
                {rupees(booking.totalAmount)}
                <span className="text-faint" style={{ fontWeight: 500, fontSize: '.8rem' }}>
                  {' '}· {booking.payment?.status === 'paid' ? 'paid' : booking.payment?.method === 'pay_at_venue' ? 'at venue' : 'unpaid'}
                </span>
              </strong>
            </div>
          </div>

          <div className="divider-dash" />

          <div>
            <span className="text-faint" style={{ display: 'block', marginBottom: 6, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', fontSize: '.72rem' }}>
              Booking reference
            </span>
            <div className="ticket-ref">{booking.bookingRef}</div>
          </div>

          {!isCancelled && (
            <div className="qr-box"><QrBlock text={booking.bookingRef} /></div>
          )}

          {isPending && (
            <div className="alert alert-warn">
              <IconPhone style={{ width: 18, height: 18, flexShrink: 0 }} />
              <span>
                Awaiting confirmation from {venue.name}
                {venue.manualContact?.responseTimeMins && ` — usually within ${venue.manualContact.responseTimeMins} minutes`}.
                Nothing has been charged yet.
              </span>
            </div>
          )}

          {isConfirmed && upcoming && (
            <div className="alert alert-success">
              <IconClock style={{ width: 18, height: 18, flexShrink: 0 }} />
              <span>Your game starts {relativeTime(booking.startsAt)}.</span>
            </div>
          )}

          {isCancelled && booking.cancellation?.refundAmount > 0 && (
            <div className="alert alert-info">
              <IconCheck style={{ width: 18, height: 18, flexShrink: 0 }} />
              <span>{rupees(booking.cancellation.refundAmount)} was refunded to your wallet.</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="row gap-12 wrap" style={{ maxWidth: 480, margin: '24px auto 0' }}>
        <Link to={`/venues/${venue.slug || venue._id}`} className="btn btn-ghost grow">View venue</Link>
        {venue.address && (
          <a
            className="btn btn-ghost grow"
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
              [venue.name, venue.address.area, venue.address.city].filter(Boolean).join(', ')
            )}`}
            target="_blank" rel="noreferrer"
          >
            Directions
          </a>
        )}
        {!isCancelled && upcoming && (
          <button className="btn btn-danger btn-block" onClick={() => setShowCancel(true)}>
            Cancel booking
          </button>
        )}
      </div>

      {showCancel && (
        <CancelModal
          booking={booking}
          onClose={() => setShowCancel(false)}
          onCancelled={onCancelled}
        />
      )}
    </div>
  );
}
