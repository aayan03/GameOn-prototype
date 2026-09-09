import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ownerApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { dateStrip, prettyDate } from '../utils/date.js';
import { rupees } from '../utils/format.js';
import { IconArrowLeft, IconRefresh } from '../components/Icons.jsx';
import SportIcon from '../components/SportIcon.jsx';

export default function OwnerCalendar() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState(params.get('venueId') || '');
  const [date, setDate] = useState(params.get('date') || dateStrip(1)[0].key);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const days = dateStrip(14);

  // The venue list comes from the overview endpoint, which is already scoped
  // to venues this owner actually owns.
  useEffect(() => {
    ownerApi.overview({ days: 7 })
      .then(({ data: d }) => {
        setVenues(d.venues);
        if (!venueId && d.venues[0]) setVenueId(d.venues[0]._id);
        if (!d.venues.length) setLoading(false);
      })
      .catch((err) => { toast.error(err.message); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    if (!venueId) return;
    setLoading(true);
    ownerApi.calendar({ venueId, date })
      .then(({ data: d }) => setData(d))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [venueId, date, toast]);

  useEffect(load, [load]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (venueId) next.set('venueId', venueId);
    if (date) next.set('date', date);
    setParams(next, { replace: true });
  }, [venueId, date, setParams]);

  const block = async (slot, courtId) => {
    setBusy(true);
    try {
      const { data: res } = await ownerApi.addBlackout({
        venueId, date, courtId,
        startMinutes: slot.start, endMinutes: slot.end,
        reason: 'Maintenance',
      });
      toast.success(res.message);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const unblock = async (blackoutId) => {
    setBusy(true);
    try {
      const { data: res } = await ownerApi.removeBlackout(venueId, blackoutId);
      toast.success(res.message);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const findBlackout = (slot, courtId) =>
    (data?.blackouts || []).find((b) =>
      (!b.court || String(b.court) === String(courtId))
      && (b.startMinutes == null || (slot.start >= b.startMinutes && slot.start < b.endMinutes)));

  return (
    <div className="container section fade-in">
      <Link to="/owner" className="link-btn row gap-6" style={{ marginBottom: 18 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> Dashboard
      </Link>

      <div className="between gap-16 wrap page-head">
        <div>
          <span className="eyebrow">Calendar</span>
          <h1 style={{ marginTop: 8 }}>{prettyDate(date)}</h1>
          <p className="text-soft">Everything booked today, and the slots you can take out of service.</p>
        </div>
        <div className="row gap-10 wrap">
          {venues.length > 1 && (
            <select
              className="select" aria-label="Choose a venue"
              value={venueId} onChange={(e) => setVenueId(e.target.value)} style={{ maxWidth: 230 }}
            >
              {venues.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
            </select>
          )}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            <IconRefresh style={{ width: 15, height: 15 }} /> Refresh
          </button>
        </div>
      </div>

      <div className="date-strip">
        {days.map((d) => (
          <button
            key={d.key}
            className={`date-chip${date === d.key ? ' active' : ''}${d.isToday ? ' today' : ''}`}
            onClick={() => setDate(d.key)}
          >
            <span className="date-dow">{d.dow}</span>
            <span className="date-num">{d.day}</span>
            <span className="date-mon">{d.month}</span>
          </button>
        ))}
      </div>

      {!venues.length && !loading && (
        <div className="card card-pad empty" style={{ marginTop: 20 }}>
          <div className="empty-icon">🏟️</div>
          <h3>No venues yet</h3>
          <Link to="/owner/venues/new" className="btn btn-primary" style={{ marginTop: 18 }}>Add a venue</Link>
        </div>
      )}

      {loading ? (
        <div className="stack gap-16" style={{ marginTop: 20 }}>
          {Array.from({ length: 2 }, (_, i) => <div key={i} className="skeleton" style={{ height: 180 }} />)}
        </div>
      ) : data?.courts?.map((court) => (
        <section key={court.courtId} className="cal-court" style={{ marginTop: 24 }}>
          <div className="cal-head">
            <h3 className="row gap-8"><SportIcon sport={court.sport} size={18} /> {court.courtName}</h3>
            <span className="text-faint">
              {court.closed ? 'Closed today' : `Open ${court.opens} – ${court.closes} · ${rupees(court.pricePerHour)}/hr`}
            </span>
          </div>

          {court.closed ? (
            <div className="chart-empty" style={{ height: 80 }}><span>Closed on this day</span></div>
          ) : (
            <div className="cal-strip">
              {court.slots.map((slot) => {
                const b = slot.booking;
                const blackout = slot.status === 'blocked' ? findBlackout(slot, court.courtId) : null;

                return (
                  <div key={slot.start} className={`cal-slot ${slot.status}`}>
                    <span className="t">{slot.label}</span>
                    {b ? (
                      <>
                        <span className="who" title={b.player}>{b.player}</span>
                        <span className="who">
                          {rupees(b.amount)} · {b.paid ? 'paid' : b.status === 'pending' ? 'awaiting' : 'unpaid'}
                        </span>
                      </>
                    ) : blackout ? (
                      <button
                        className="link-btn" style={{ fontSize: '.72rem', textAlign: 'left' }}
                        onClick={() => unblock(blackout._id)} disabled={busy}
                      >
                        Blocked — unblock
                      </button>
                    ) : slot.status === 'available' ? (
                      <button
                        className="link-btn" style={{ fontSize: '.72rem', textAlign: 'left' }}
                        onClick={() => block(slot, court.courtId)} disabled={busy}
                      >
                        Open — block
                      </button>
                    ) : (
                      <span className="who">{slot.status === 'past' ? 'Passed' : slot.status}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}

      <div className="slot-legend" style={{ marginTop: 20 }}>
        <span className="legend-item"><i className="legend-swatch" style={{ background: 'var(--volt-soft)' }} /> Booked</span>
        <span className="legend-item"><i className="legend-swatch" style={{ background: 'var(--orange-soft)' }} /> Awaiting confirmation</span>
        <span className="legend-item"><i className="legend-swatch" style={{ background: '#fff', borderStyle: 'dashed' }} /> Open</span>
        <span className="legend-item"><i className="legend-swatch booked" /> Blocked</span>
      </div>
    </div>
  );
}
