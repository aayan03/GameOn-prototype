import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { eventApi, venueApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { EVENT_TYPES, EVENT_TYPE_ICONS, EVENT_TYPE_LABELS, eventWhen, SPORT_LABELS } from '../utils/format.js';
import { IconUsers, IconChevron } from '../components/Icons.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball', 'pickleball', 'tabletennis'];

/** A datetime-local value for `n` days out, rounded to the hour. */
function defaultStart(days = 7) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setMinutes(0, 0, 0);
  // `toISOString` is UTC and datetime-local wants local wall-clock, so build
  // the string by hand rather than slicing an ISO string and being an hour out.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

const EMPTY = {
  title: '', type: 'marathon', sport: '', description: '',
  startsAt: defaultStart(), endsAt: '', capacity: '',
  venueId: '', locationName: '', address: '', area: '', city: '',
  externalUrl: '',
};

export default function OwnerEvents() {
  const toast = useToast();

  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [attendeesFor, setAttendeesFor] = useState(null);

  const load = () => {
    setLoading(true);
    eventApi.list({ mine: 'hosting', limit: 36 })
      .then(({ data }) => setEvents(data))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    venueApi.mine().then(({ data }) => setVenues(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setFieldErrors({});
    try {
      const payload = {
        title: form.title,
        type: form.type,
        startsAt: new Date(form.startsAt).toISOString(),
        ...(form.endsAt ? { endsAt: new Date(form.endsAt).toISOString() } : {}),
        ...(form.sport ? { sport: form.sport } : {}),
        ...(form.description ? { description: form.description } : {}),
        // Empty means unlimited, which the API expresses as 0.
        capacity: form.capacity === '' ? 0 : Number(form.capacity),
        ...(form.venueId ? { venueId: form.venueId } : {}),
        ...(form.externalUrl ? { externalUrl: form.externalUrl } : {}),
        location: {
          name: form.locationName, address: form.address,
          area: form.area, city: form.city,
        },
      };
      const { data } = await eventApi.create(payload);
      toast.success(data.message);
      setForm(EMPTY);
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.message);
      if (err.details) setFieldErrors(err.details);
    } finally { setBusy(false); }
  };

  const cancelEvent = async (event) => {
    const reason = window.prompt(
      `Cancel "${event.title}"?\n\nEveryone registered is told immediately. Add a reason if you like:`,
    );
    // `null` is the Cancel button; an empty string is "yes, no reason given".
    if (reason === null) return;
    try {
      const { data } = await eventApi.cancel(event._id, reason);
      toast.info(data.message);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const viewAttendees = async (event) => {
    try {
      const { data } = await eventApi.attendees(event._id);
      setAttendeesFor(data);
    } catch (err) { toast.error(err.message); }
  };

  const statusOf = (e) => {
    if (e.isCancelled) return { label: 'Cancelled', cls: 'cancelled' };
    if (e.moderationStatus === 'pending') return { label: 'In review', cls: 'pending' };
    if (e.moderationStatus === 'rejected') return { label: 'Not approved', cls: 'cancelled' };
    if (new Date(e.startsAt) < new Date()) return { label: 'Finished', cls: 'done' };
    return { label: 'Live', cls: 'live' };
  };

  return (
    <div className="container section">
      <div className="between gap-16 wrap" style={{ marginBottom: 24 }}>
        <div>
          <span className="eyebrow">Organising</span>
          <h1 style={{ marginTop: 8 }}>Your events</h1>
          <p className="text-soft" style={{ marginTop: 6, maxWidth: '56ch' }}>
            Marathons, tournaments, morning sessions — anything people turn up
            to. Free to list and free to join.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Close' : 'New event'}
        </button>
      </div>

      {/* ── Create ──────────────────────────────────────────── */}
      {showForm && (
        <form className="card card-pad stack gap-14 fade-in" onSubmit={submit} style={{ marginBottom: 26 }}>
          <h3>New event</h3>

          <div className="field">
            <label htmlFor="ev-title">Title</label>
            <input id="ev-title" value={form.title} onChange={set('title')} required
              placeholder="Sunday Sunrise 10K" maxLength={120} />
            {fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}
          </div>

          <div className="row gap-14 wrap">
            <div className="field grow">
              <label htmlFor="ev-type">Type</label>
              <select id="ev-type" value={form.type} onChange={set('type')}>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>{EVENT_TYPE_ICONS[t]} {EVENT_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="field grow">
              <label htmlFor="ev-sport">Sport (optional)</label>
              <select id="ev-sport" value={form.sport} onChange={set('sport')}>
                <option value="">Not sport-specific</option>
                {SPORTS.map((s) => <option key={s} value={s}>{SPORT_LABELS[s]}</option>)}
              </select>
            </div>
          </div>

          <div className="row gap-14 wrap">
            <div className="field grow">
              <label htmlFor="ev-start">Starts</label>
              <input id="ev-start" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} required />
              {fieldErrors.startsAt && <span className="field-error">{fieldErrors.startsAt}</span>}
            </div>
            <div className="field grow">
              <label htmlFor="ev-end">Ends (optional)</label>
              <input id="ev-end" type="datetime-local" value={form.endsAt} onChange={set('endsAt')} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="ev-cap">Places (leave blank for unlimited)</label>
            <input id="ev-cap" type="number" min="0" max="100000" value={form.capacity}
              onChange={set('capacity')} placeholder="e.g. 200" />
            <span className="field-hint">
              Registration closes automatically once this many people have signed up.
            </span>
          </div>

          {venues.length > 0 && (
            <div className="field">
              <label htmlFor="ev-venue">At one of your venues? (optional)</label>
              <select id="ev-venue" value={form.venueId} onChange={set('venueId')}>
                <option value="">Somewhere else</option>
                {venues.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
              </select>
              <span className="field-hint">
                Picking a venue fills in the address and links the two together.
              </span>
            </div>
          )}

          {!form.venueId && (
            <>
              <div className="field">
                <label htmlFor="ev-loc">Where</label>
                <input id="ev-loc" value={form.locationName} onChange={set('locationName')}
                  placeholder="Cubbon Park, Bandstand Gate" maxLength={160} />
              </div>
              <div className="row gap-14 wrap">
                <div className="field grow">
                  <label htmlFor="ev-area">Area</label>
                  <input id="ev-area" value={form.area} onChange={set('area')} maxLength={60} />
                </div>
                <div className="field grow">
                  <label htmlFor="ev-city">City</label>
                  <input id="ev-city" value={form.city} onChange={set('city')} maxLength={60} />
                </div>
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="ev-desc">Details</label>
            <textarea id="ev-desc" rows={5} value={form.description} onChange={set('description')}
              maxLength={4000} placeholder="Route, what to bring, where to meet, timings…" />
          </div>

          <div className="row gap-10 wrap">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Publishing…' : 'Publish event'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ── The list ────────────────────────────────────────── */}
      {loading ? (
        <div className="center" style={{ padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : events.length ? (
        <div className="stack gap-12">
          {events.map((e) => {
            const s = statusOf(e);
            return (
              <div key={e._id} className="card card-pad owner-event-row">
                <div className="grow">
                  <div className="row gap-10 wrap" style={{ alignItems: 'center' }}>
                    <span className={`event-flag ${s.cls}`}>{s.label}</span>
                    <span className="text-faint" style={{ fontSize: '.85rem' }}>
                      {EVENT_TYPE_ICONS[e.type]} {EVENT_TYPE_LABELS[e.type]}
                    </span>
                  </div>
                  <h3 style={{ marginTop: 8 }}>
                    <Link to={`/events/${e.slug || e._id}`}>{e.title}</Link>
                  </h3>
                  <p className="text-soft" style={{ fontSize: '.92rem', marginTop: 4 }}>
                    {eventWhen(e.startsAt)}
                    {e.location?.city ? ` · ${e.location.city}` : ''}
                  </p>
                </div>

                <div className="row gap-10 wrap" style={{ alignItems: 'center' }}>
                  <span className="event-count">
                    <IconUsers style={{ width: 15, height: 15 }} />
                    {e.registeredCount || 0}{e.capacity ? ` / ${e.capacity}` : ''}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => viewAttendees(e)}>
                    Who&rsquo;s coming
                  </button>
                  {!e.isCancelled && (
                    <button className="btn btn-danger btn-sm" onClick={() => cancelEvent(e)}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card card-pad empty">
          <div className="empty-icon">📅</div>
          <h3>No events yet</h3>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 18 }}>
            Run a marathon, a tournament or a weekly session? Put it up here and
            people can reserve a place.
          </p>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>Create your first event</button>
        </div>
      )}

      {/* ── Attendees ───────────────────────────────────────── */}
      {attendeesFor && (
        <div className="modal-backdrop" onClick={() => setAttendeesFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>{attendeesFor.event.title}</h3>
            <p className="text-soft" style={{ marginTop: 4 }}>
              {attendeesFor.total} {attendeesFor.total === 1 ? 'place' : 'places'} taken
              {attendeesFor.event.capacity ? ` of ${attendeesFor.event.capacity}` : ''}
            </p>

            <div className="attendee-list">
              {attendeesFor.attendees.length ? attendeesFor.attendees.map((a, i) => (
                <div key={i} className="attendee-row">
                  <div>
                    <strong>{a.name}</strong>
                    {a.seats > 1 && <span className="text-faint"> · {a.seats} places</span>}
                    {a.note && <span className="text-soft" style={{ display: 'block', fontSize: '.86rem' }}>{a.note}</span>}
                  </div>
                  <span className="text-faint" style={{ fontSize: '.84rem' }}>{a.phone || a.email}</span>
                </div>
              )) : <p className="text-soft">Nobody has signed up yet.</p>}
            </div>

            <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => setAttendeesFor(null)}>
              Close <IconChevron style={{ width: 15, height: 15 }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
