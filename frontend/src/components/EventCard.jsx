import { Link } from 'react-router-dom';
import { EVENT_TYPE_ICONS, EVENT_TYPE_LABELS, eventWhen } from '../utils/format.js';
import { IconUsers } from './Icons.jsx';

/**
 * Lives here rather than inside Events.jsx because the dashboard renders it
 * too, and a route file that another route statically imports is a route that
 * can never be code-split — Vite says so out loud at build time.
 */
/** One event, as a card. */
export default function EventCard({ event }) {
  const full = event.isFull;
  const going = event.myRegistration?.status === 'going';

  return (
    <Link to={`/events/${event.slug || event._id}`} className="event-card">
      <div className="event-card-top">
        <span className="event-type">
          {EVENT_TYPE_ICONS[event.type]} {EVENT_TYPE_LABELS[event.type]}
        </span>
        {event.isCancelled
          ? <span className="event-flag cancelled">Cancelled</span>
          : going
            ? <span className="event-flag going">You&rsquo;re going</span>
            : full
              ? <span className="event-flag full">Full</span>
              : null}
      </div>

      <h3 className="event-title">{event.title}</h3>

      <div className="event-meta">
        <span className="event-when">{eventWhen(event.startsAt)}</span>
        {(event.location?.name || event.location?.city) && (
          <span className="event-where">
            {[event.location.name, event.location.area, event.location.city]
              .filter(Boolean).slice(0, 2).join(' · ')}
          </span>
        )}
      </div>

      <div className="event-card-foot">
        <span className="event-count">
          <IconUsers style={{ width: 15, height: 15 }} />
          {event.registeredCount || 0} going
          {/* Only claim a limit when there is one — `capacity: 0` is unlimited,
              and "0 of 0 places" is a nonsense a visitor has to decode. */}
          {event.capacity ? ` · ${event.spotsRemaining} left` : ''}
        </span>
        <span className="event-free">Free</span>
      </div>
    </Link>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="event-card skeleton-card" aria-hidden="true">
      <div className="skeleton" style={{ height: 18, width: '45%' }} />
      <div className="skeleton" style={{ height: 26, width: '85%', marginTop: 14 }} />
      <div className="skeleton" style={{ height: 15, width: '65%', marginTop: 14 }} />
      <div className="skeleton" style={{ height: 15, width: '40%', marginTop: 20 }} />
    </div>
  );
}
