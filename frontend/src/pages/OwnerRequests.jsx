import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { bookingApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { prettyDate, slotRangeLabel, relativeTime } from '../utils/date.js';
import { rupees, initials } from '../utils/format.js';
import { IconCheck, IconClose, IconPhone, IconBolt, IconRefresh } from '../components/Icons.jsx';
import SportIcon from '../components/SportIcon.jsx';

function RequestCard({ booking, onDecide, busy }) {
  const player = booking.player || {};
  return (
    <div className="card card-pad stack gap-14">
      <div className="between gap-12 wrap">
        <div className="row gap-12">
          <div className="avatar">{initials(player.name)}</div>
          <div>
            <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.02rem' }}>{player.name}</strong>
            <div className="text-faint">
              {player.phone || player.email}
              {player.reliabilityScore != null && ` · ${player.reliabilityScore}% reliable`}
            </div>
          </div>
        </div>
        <span className="badge badge-manual">Needs your confirmation</span>
      </div>

      <div className="card card-pad card-flat" style={{ background: 'var(--surface-2)' }}>
        <div className="row gap-8 wrap" style={{ marginBottom: 6 }}>
          <strong>{booking.venue?.name}</strong>
          <span className="badge badge-soft"><SportIcon sport={booking.sport} size={14} /> {booking.courtName}</span>
        </div>
        <div className="text-soft" style={{ fontWeight: 600 }}>
          {prettyDate(booking.date)} · {slotRangeLabel(booking.slots)}
          {booking.slots.length > 1 && ` (${booking.slots.length} slots)`}
        </div>
        <div className="row gap-12 wrap" style={{ marginTop: 8 }}>
          <strong className="mono">{rupees(booking.totalAmount)}</strong>
          <span className="text-faint">{booking.players} players</span>
          <span className="text-faint">Starts {relativeTime(booking.startsAt)}</span>
        </div>
        {booking.notes && <p className="text-soft" style={{ marginTop: 8, fontStyle: 'italic' }}>“{booking.notes}”</p>}
      </div>

      <div className="row gap-10">
        <button
          className="btn btn-primary grow"
          onClick={() => onDecide(booking.groupRef, 'confirm')}
          disabled={busy === booking.groupRef}
        >
          {busy === booking.groupRef ? <span className="spinner" style={{ width: 16, height: 16 }} />
            : <><IconCheck style={{ width: 17, height: 17 }} /> Confirm</>}
        </button>
        <button
          className="btn btn-ghost"
          style={{ color: 'var(--danger)' }}
          onClick={() => onDecide(booking.groupRef, 'reject')}
          disabled={busy === booking.groupRef}
        >
          <IconClose style={{ width: 16, height: 16 }} /> Decline
        </button>
      </div>
    </div>
  );
}

/**
 * A past or confirmed booking, with the cash button where it is owed.
 *
 * Pay-at-venue money is collected at the gate, so nothing in the system knows
 * it arrived until the owner says so. Until they do, the revenue figures are
 * guesswork and the player cannot leave a review — that is the whole reason
 * this button exists.
 */
function SettleRow({ booking: b, onSettle, busy }) {
  const cashOwed = b.payment?.method === 'pay_at_venue'
    && b.payment?.status !== 'paid'
    && ['confirmed', 'completed'].includes(b.status);

  return (
    <div className="booking-row">
      <div className="booking-main">
        <div className="row gap-8 wrap">
          <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.02rem' }}>
            {b.player?.name || 'Player'}
          </strong>
          <span className={`badge ${b.status === 'confirmed' ? 'badge-instant' : 'badge-soft'}`}>
            {b.status}
          </span>
          {cashOwed && <span className="badge badge-warning">Cash due</span>}
          {b.payment?.status === 'paid' && <span className="badge badge-soft">Paid</span>}
        </div>
        <div className="text-soft" style={{ fontWeight: 600 }}>
          {b.venue?.name} · <SportIcon sport={b.sport} size={14} /> {b.courtName}
        </div>
        <div className="text-faint">
          {prettyDate(b.date)} · {slotRangeLabel(b.slots)} · {rupees(b.totalAmount)}
        </div>
      </div>

      {cashOwed && (
        // .booking-actions, not a bare button — it carries the padding and
        // the ≤620px rule that turns the column into a full-width row.
        <div className="booking-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onSettle(b.groupRef)}
            disabled={busy === b.groupRef}
          >
            {busy === b.groupRef
              ? <span className="spinner" style={{ width: 14, height: 14 }} />
              : <>Mark {rupees(b.totalAmount)} collected</>}
          </button>
        </div>
      )}
    </div>
  );
}

export default function OwnerRequests() {
  const toast = useToast();
  const [data, setData] = useState({ pending: [], confirmed: [], other: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [tab, setTab] = useState('pending');

  const load = (silent) => {
    if (!silent) setLoading(true);
    bookingApi.ownerRequests()
      .then(({ data: d }) => setData(d))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const settle = async (groupRef) => {
    setBusy(groupRef);
    try {
      const { data: res } = await bookingApi.settleCash(groupRef);
      toast.success(res.message);
      load(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const decide = async (groupRef, decision) => {
    setBusy(groupRef);
    try {
      const { data: res } = await bookingApi.decide(groupRef, decision);
      toast.success(res.message);
      load(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const list = data[tab] || [];

  return (
    <div className="container section fade-in">
      <div className="between gap-16 wrap page-head">
        <div>
          <h1>Booking requests</h1>
          <p className="text-soft">
            Assisted bookings land here. Confirm one and the player is charged and notified.
          </p>
        </div>
        <div className="row gap-10">
          <button className="btn btn-ghost btn-sm" onClick={() => load()}>
            <IconRefresh style={{ width: 15, height: 15 }} /> Refresh
          </button>
          <Link to="/owner" className="btn btn-ghost btn-sm">Dashboard</Link>
        </div>
      </div>

      {/* `wrap`: three tabs plus their counts are 479px wide, so on any phone
          the row pushed the whole page into a horizontal scroll. */}
      <div className="row gap-10 wrap" style={{ marginBottom: 22 }}>
        {[
          { k: 'pending', label: 'Pending', icon: <IconPhone style={{ width: 14, height: 14 }} /> },
          { k: 'confirmed', label: 'Confirmed', icon: <IconBolt style={{ width: 14, height: 14 }} /> },
          { k: 'other', label: 'Cancelled & past', icon: null },
        ].map((t) => (
          <button key={t.k} className={`pill${tab === t.k ? ' active' : ''}`} onClick={() => setTab(t.k)}>
            {t.icon} {t.label} {data[t.k]?.length > 0 && `(${data[t.k].length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="stack gap-14">
          {Array.from({ length: 2 }, (_, i) => <div key={i} className="skeleton" style={{ height: 220 }} />)}
        </div>
      ) : list.length ? (
        <div className="stack gap-16">
          {list.map((b) => (
            tab === 'pending'
              ? <RequestCard key={b.groupRef} booking={b} onDecide={decide} busy={busy} />
              : (
                <SettleRow key={b.groupRef} booking={b} onSettle={settle} busy={busy} />
              )
          ))}
        </div>
      ) : (
        <div className="card card-pad empty">
          <div className="empty-icon">{tab === 'pending' ? '📭' : '🗂️'}</div>
          <h3>{tab === 'pending' ? 'No requests waiting' : 'Nothing here yet'}</h3>
          <p className="text-soft" style={{ marginTop: 6 }}>
            {tab === 'pending'
              ? 'When someone requests a slot at one of your assisted venues, it shows up here.'
              : 'Confirmed and past bookings will appear here.'}
          </p>
        </div>
      )}
    </div>
  );
}
