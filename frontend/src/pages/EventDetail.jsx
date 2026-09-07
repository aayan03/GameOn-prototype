import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { eventApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { EVENT_TYPE_ICONS, EVENT_TYPE_LABELS, eventWhen, SPORT_ICONS, SPORT_LABELS } from '../utils/format.js';
import { IconUsers, IconChevron, IconCheck } from '../components/Icons.jsx';

export default function EventDetail() {
  const { idOrSlug } = useParams();
  const { isAuthenticated, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [seats, setSeats] = useState(1);

  const load = () => {
    setLoading(true);
    eventApi.get(idOrSlug)
      .then(({ data }) => { setEvent(data); setError(''); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [idOrSlug]);

  const going = event?.myRegistration?.status === 'going';
  const isOrganiser = user && event && String(event.organiser?._id || event.organiser) === String(user._id);
  const started = event && new Date(event.startsAt) < new Date();

  const register = async () => {
    if (!isAuthenticated) {
      // Come back here after logging in, rather than dumping them on the home
      // page having forgotten what they were doing.
      navigate('/login', { state: { from: { pathname: `/events/${idOrSlug}` } } });
      return;
    }
    setBusy(true);
    try {
      const { data } = await eventApi.register(event._id, { seats });
      toast.success(data.message);
      load();
    } catch (err) {
      toast.error(err.message);
      // A 409 means somebody took the last place while this page was open —
      // reload so the button stops offering something that is gone.
      if (err.status === 409) load();
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const { data } = await eventApi.unregister(event._id);
      toast.info(data.message);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <div className="container section center" style={{ paddingTop: 60 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">📅</div>
          <h3>{error || 'Event not found'}</h3>
          <Link to="/events" className="btn btn-primary" style={{ marginTop: 20 }}>
            Browse events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container section" style={{ maxWidth: 880 }}>
      <Link to="/events" className="back-link">
        <IconChevron style={{ width: 16, height: 16, transform: 'rotate(180deg)' }} /> All events
      </Link>

      {event.isCancelled && (
        <div className="alert alert-error" style={{ marginTop: 16 }}>
          <span>
            <strong>This event was cancelled.</strong>
            {event.cancelledReason ? ` ${event.cancelledReason}` : ''}
          </span>
        </div>
      )}

      {/* An organiser viewing their own unapproved submission gets told where
          it stands, rather than wondering why nobody can see it. */}
      {isOrganiser && event.moderationStatus && event.moderationStatus !== 'approved' && (
        <div className={`alert ${event.moderationStatus === 'rejected' ? 'alert-error' : 'alert-warn'}`} style={{ marginTop: 16 }}>
          <span>
            {event.moderationStatus === 'pending'
              ? 'Waiting for review. It goes live once our team has looked at it — usually within a day.'
              : `Not approved. ${event.moderationNote || 'Get in touch if you think this is wrong.'}`}
          </span>
        </div>
      )}

      <div className="event-hero">
        <span className="event-type big">
          {EVENT_TYPE_ICONS[event.type]} {EVENT_TYPE_LABELS[event.type]}
        </span>
        <h1 style={{ marginTop: 14 }}>{event.title}</h1>

        <div className="event-facts">
          <div>
            <span className="fact-label">When</span>
            <strong>{eventWhen(event.startsAt)}</strong>
            {event.endsAt && <span className="text-faint"> → {eventWhen(event.endsAt)}</span>}
          </div>

          {(event.location?.name || event.location?.city) && (
            <div>
              <span className="fact-label">Where</span>
              <strong>{event.location.name || event.location.city}</strong>
              {event.location.address && (
                <span className="text-soft" style={{ display: 'block', fontSize: '.9rem' }}>
                  {event.location.address}
                  {event.location.area ? `, ${event.location.area}` : ''}
                  {event.location.city ? `, ${event.location.city}` : ''}
                </span>
              )}
            </div>
          )}

          {event.sport && (
            <div>
              <span className="fact-label">Sport</span>
              <strong>{SPORT_ICONS[event.sport]} {SPORT_LABELS[event.sport]}</strong>
            </div>
          )}

          <div>
            <span className="fact-label">Going</span>
            <strong>
              <IconUsers style={{ width: 16, height: 16, verticalAlign: '-2px' }} />{' '}
              {event.registeredCount || 0}
              {event.capacity ? ` of ${event.capacity}` : ''}
            </strong>
            {event.capacity > 0 && (
              <span className="text-faint" style={{ display: 'block', fontSize: '.88rem' }}>
                {event.spotsRemaining > 0
                  ? `${event.spotsRemaining} ${event.spotsRemaining === 1 ? 'place' : 'places'} left`
                  : 'No places left'}
              </span>
            )}
          </div>
        </div>
      </div>

      {event.description && (
        <div className="card card-pad" style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 10 }}>About this event</h3>
          {/* Plain text, split into paragraphs. Deliberately NOT rendered as
              HTML or markdown: this is organiser-supplied copy, and an
              innerHTML here would be a stored-XSS hole on a public page. */}
          {event.description.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="text-soft" style={{ marginTop: i ? 12 : 0, whiteSpace: 'pre-wrap' }}>
              {para}
            </p>
          ))}
        </div>
      )}

      {event.venue && (
        <div className="card card-pad row between gap-14 wrap" style={{ marginTop: 20 }}>
          <div>
            <span className="fact-label">At a GameOn venue</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{event.venue.name}</strong>
          </div>
          <Link to={`/venues/${event.venue.slug || event.venue._id}`} className="btn btn-ghost btn-sm">
            See the venue <IconChevron style={{ width: 15, height: 15 }} />
          </Link>
        </div>
      )}

      {/* ── The action ──────────────────────────────────────── */}
      <div className="event-cta">
        <div>
          <strong style={{ fontSize: '1.15rem' }}>Free to join</strong>
          <p className="text-soft" style={{ fontSize: '.92rem', marginTop: 2 }}>
            Organised by {event.organiser?.name || 'a GameOn host'}
          </p>
        </div>

        {isOrganiser ? (
          <Link to="/owner/events" className="btn btn-ghost">Manage this event</Link>
        ) : event.isCancelled || started ? (
          <button className="btn btn-ghost" disabled>
            {event.isCancelled ? 'Cancelled' : 'Already started'}
          </button>
        ) : going ? (
          <div className="row gap-10 wrap">
            <span className="event-flag going big">
              <IconCheck style={{ width: 16, height: 16 }} /> You&rsquo;re going
              {event.myRegistration.seats > 1 ? ` (${event.myRegistration.seats} places)` : ''}
            </span>
            <button className="btn btn-ghost" onClick={cancel} disabled={busy}>
              {busy ? 'Working…' : 'Cancel my place'}
            </button>
          </div>
        ) : event.isFull ? (
          <button className="btn btn-ghost" disabled>Full</button>
        ) : (
          <div className="row gap-10 wrap">
            {/* Only offer a group size when there is room for one. */}
            {(!event.capacity || event.spotsRemaining > 1) && (
              <select
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value))}
                aria-label="How many places"
                style={{ maxWidth: 130 }}
              >
                {Array.from(
                  { length: Math.min(10, event.capacity ? event.spotsRemaining : 10) },
                  (_, i) => i + 1,
                ).map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? 'place' : 'places'}</option>
                ))}
              </select>
            )}
            <button className="btn btn-primary btn-lg" onClick={register} disabled={busy}>
              {busy ? 'Working…' : isAuthenticated ? 'Reserve my place' : 'Log in to join'}
            </button>
          </div>
        )}
      </div>

      {event.externalUrl && (
        <p className="text-faint" style={{ marginTop: 16, fontSize: '.9rem' }}>
          The organiser also runs their own signup:{' '}
          {/* noreferrer as well as noopener — this is a URL a third party
              typed, and it should not learn where its traffic came from. */}
          <a href={event.externalUrl} target="_blank" rel="noreferrer nofollow" className="underline">
            {event.externalUrl}
          </a>
        </p>
      )}
    </div>
  );
}
