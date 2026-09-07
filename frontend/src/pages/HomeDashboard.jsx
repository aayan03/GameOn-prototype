import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bookingApi, venueApi, eventApi, parlorApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import useGeolocation from '../hooks/useGeolocation.js';
import VenueCard, { VenueCardSkeleton } from '../components/VenueCard.jsx';
import EventCard from '../components/EventCard.jsx';
import OpenBadge from '../components/OpenBadge.jsx';
import { rupees, SPORT_ICONS } from '../utils/format.js';
import { prettyDateLong, minuteLabel } from '../utils/date.js';
import {
  IconSearch, IconLocate, IconChevron, IconArrowRight, IconTicket,
  IconUsers, IconSparkle, IconWallet,
} from '../components/Icons.jsx';

/**
 * The signed-in home page.
 *
 * A different job from the visitor landing page, which is why they are now
 * two files. Somebody with an account does not need to be told what GameOn is
 * or persuaded to sign up — they came here to find out when their next game
 * is and to get to the next one. So this leads with their booking and their
 * shortcuts, and the marketing sections are gone entirely.
 *
 * That split is most of the answer to "the home page feels cluttered": one
 * page was trying to sell the product AND be a control panel, so every
 * visitor got both and neither was short.
 */

/** The next thing this person is doing, in one strip. */
function NextUp({ booking }) {
  if (!booking) return null;
  const venue = booking.venue || {};
  const start = booking.slots?.[0]?.start;

  return (
    <Link to={`/bookings/${booking.groupRef}`} className="next-up">
      <div className="next-up-when">
        <span className="next-up-label">Your next game</span>
        <strong>{prettyDateLong(booking.date)}</strong>
        {start != null && <span className="next-up-time">{minuteLabel(start)}</span>}
      </div>

      <div className="next-up-where">
        <strong>{venue.name || 'Your booking'}</strong>
        <span className="text-soft">
          {booking.sport && SPORT_ICONS[booking.sport]} {booking.courtName}
          {venue.address?.area ? ` · ${venue.address.area}` : ''}
        </span>
      </div>

      <span className="next-up-go">
        Ticket <IconChevron style={{ width: 16, height: 16 }} />
      </span>
    </Link>
  );
}

const QUICK = [
  { to: '/venues', label: 'Book a slot', Icon: IconSearch, accent: 'var(--volt)' },
  { to: '/events', label: 'Events', Icon: IconTicket, accent: 'var(--orange)' },
  { to: '/teamup', label: 'Find players', Icon: IconUsers, accent: 'var(--magenta)' },
  { to: '/parlors', label: 'Game parlours', Icon: IconLocate, accent: 'var(--sky)' },
];

export default function HomeDashboard() {
  const { user, loyalty } = useAuth();
  const { coords, request, isLoading: locating } = useGeolocation();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [next, setNext] = useState(null);
  const [venues, setVenues] = useState([]);
  const [events, setEvents] = useState([]);
  const [openParlors, setOpenParlors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    bookingApi.mine()
      .then(({ data }) => { if (!cancelled) setNext(data.upcoming?.[0] || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      venueApi.list({
        limit: 6, sort: coords ? 'distance' : 'rating',
        lat: coords?.lat, lng: coords?.lng, radiusKm: 30,
      }).catch(() => ({ data: [] })),
      eventApi.list({ limit: 3, when: 'month' }).catch(() => ({ data: [] })),
      parlorApi.list({
        limit: 3, openNow: 'true',
        lat: coords?.lat, lng: coords?.lng, radiusKm: coords ? 25 : undefined,
      }).catch(() => ({ data: [] })),
    ]).then(([v, e, p]) => {
      if (cancelled) return;
      setVenues(v.data); setEvents(e.data); setOpenParlors(p.data);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [coords]);

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(`/venues${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  };

  const firstName = (user?.name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="dash">
      <div className="container">
        {/* ── Greeting + search ───────────────────────────── */}
        <div className="dash-top">
          <div>
            <span className="eyebrow">{greeting}</span>
            <h1 className="dash-title">{firstName || 'Ready to play'}</h1>
          </div>

          <div className="dash-stats">
            <Link to="/wallet" className="dash-stat">
              <IconWallet style={{ width: 17, height: 17 }} />
              <span>{rupees(user?.walletBalance || 0)}</span>
            </Link>
            <Link to="/loyalty" className="dash-stat">
              <IconSparkle style={{ width: 17, height: 17 }} />
              <span>{loyalty?.points ?? user?.loyaltyPoints ?? 0} pts</span>
            </Link>
          </div>
        </div>

        <form className="dash-search" onSubmit={submitSearch}>
          <IconSearch style={{ width: 20, height: 20, color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search turfs, areas or cities…"
            aria-label="Search venues"
          />
          <button
            type="button" className="dash-locate" onClick={request}
            disabled={locating} aria-label="Use my location" title="Use my location"
          >
            {locating
              ? <span className="spinner spinner-light" style={{ width: 16, height: 16 }} />
              : <IconLocate style={{ width: 18, height: 18 }} />}
          </button>
          <button type="submit" className="btn btn-primary">Search</button>
        </form>

        <NextUp booking={next} />

        {/* ── Quick actions ───────────────────────────────── */}
        <div className="quick-grid">
          {QUICK.map(({ to, label, Icon, accent }) => (
            <Link key={to} to={to} className="quick-card" style={{ '--quick-accent': accent }}>
              <span className="quick-icon"><Icon style={{ width: 20, height: 20 }} /></span>
              {label}
            </Link>
          ))}
        </div>

        {/* ── Near you ────────────────────────────────────── */}
        <section className="dash-section">
          <div className="between gap-14 wrap">
            <h2>{coords ? 'Closest to you' : 'Turfs people love'}</h2>
            <Link to="/venues" className="btn btn-ghost btn-sm">
              See all <IconChevron style={{ width: 15, height: 15 }} />
            </Link>
          </div>

          <div className="venue-grid" style={{ marginTop: 16 }}>
            {loading
              ? Array.from({ length: 3 }, (_, i) => <VenueCardSkeleton key={i} />)
              : venues.length
                ? venues.slice(0, 6).map((v) => <VenueCard key={v._id} venue={v} />)
                : (
                  <div className="card card-pad empty" style={{ gridColumn: '1 / -1' }}>
                    <p className="text-soft">No venues to show yet. Browse the full list.</p>
                    <Link to="/venues" className="btn btn-primary" style={{ marginTop: 14 }}>All venues</Link>
                  </div>
                )}
          </div>
        </section>

        {/* ── Happening soon ──────────────────────────────── */}
        {events.length > 0 && (
          <section className="dash-section">
            <div className="between gap-14 wrap">
              <h2>Happening soon</h2>
              <Link to="/events" className="btn btn-ghost btn-sm">
                All events <IconChevron style={{ width: 15, height: 15 }} />
              </Link>
            </div>
            <div className="event-grid" style={{ marginTop: 16 }}>
              {events.map((e) => <EventCard key={e._id} event={e} />)}
            </div>
          </section>
        )}

        {/* ── Open right now ──────────────────────────────── */}
        {openParlors.length > 0 && (
          <section className="dash-section">
            <div className="between gap-14 wrap">
              <h2>Open right now</h2>
              <Link to="/parlors" className="btn btn-ghost btn-sm">
                All parlours <IconChevron style={{ width: 15, height: 15 }} />
              </Link>
            </div>
            <div className="parlor-grid" style={{ marginTop: 16 }}>
              {openParlors.map((p) => (
                <Link key={p._id} to={`/parlors/${p.slug}`} className="parlor-card">
                  <div className="parlor-card-head">
                    <h3>{p.name}</h3>
                    <OpenBadge parlor={p} compact />
                  </div>
                  <p className="parlor-where">
                    {[p.address?.area, p.address?.city].filter(Boolean).join(' · ')}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* One promotional line, for the one thing a player might not know
            they can do. The rest of the marketing lives on the landing page,
            where it belongs. */}
        <Link to="/teamup" className="dash-promo">
          <div>
            <strong>Short on players?</strong>
            <span className="text-soft"> Post your game on TeamUp and nearby players ask to join.</span>
          </div>
          <IconArrowRight style={{ width: 18, height: 18, flexShrink: 0 }} />
        </Link>
      </div>
    </div>
  );
}
