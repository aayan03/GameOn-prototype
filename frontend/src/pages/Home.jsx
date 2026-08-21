import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { venueApi } from '../api/endpoints.js';
import useGeolocation from '../hooks/useGeolocation.js';
import useReveal from '../hooks/useReveal.js';
import useCountUp from '../hooks/useCountUp.js';
import VenueCard, { VenueCardSkeleton } from '../components/VenueCard.jsx';
import { SPORT_ICONS, SPORT_LABELS } from '../utils/format.js';
import {
  IconSearch, IconLocate, IconBolt, IconPhone, IconUsers,
  IconChevron, IconArrowRight, IconSparkle,
} from '../components/Icons.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball'];

const MARQUEE = [
  'Instant booking', '15,000+ turfs', 'Free cancellation', 'Split the cost',
  'Find players nearby', 'No phone tag', 'Live availability', 'Weekend leagues',
];

const STEPS = [
  { n: 1, title: 'Pick your sport', body: 'Football, cricket, badminton — whatever the squad is playing this week.' },
  { n: 2, title: 'Find a venue', body: 'See turfs near you on the map, with real prices and real ratings.' },
  { n: 3, title: 'Choose your slot', body: 'A live grid of open hours. Tap the ones you want, stack them back to back.' },
  { n: 4, title: 'Pay and play', body: 'Instant confirmation at most venues, assisted confirmation everywhere else.' },
];

function Stat({ value, suffix, label }) {
  const [n, ref] = useCountUp(value);
  return (
    <div className="hero-stat" ref={ref}>
      <strong>{n.toLocaleString('en-IN')}{suffix}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const { coords, request, isLoading: locating } = useGeolocation();
  const navigate = useNavigate();

  const nearRef = useReveal();
  const edgeRef = useReveal();
  const stepRef = useReveal();
  const ctaRef  = useReveal();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    venueApi
      .list({ limit: 6, sort: coords ? 'distance' : 'rating', lat: coords?.lat, lng: coords?.lng, radiusKm: 30 })
      .then(({ data }) => { if (!cancelled) setVenues(data); })
      .catch(() => { if (!cancelled) setVenues([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [coords]);

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(`/venues${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  };

  const useMyLocation = async () => {
    const c = await request();
    if (c) navigate(`/venues?lat=${c.lat}&lng=${c.lng}&sort=distance`);
  };

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero-deco" aria-hidden="true">
          <span className="hero-blob">⚽</span>
          <span className="hero-blob">🏏</span>
          <span className="hero-blob">🏸</span>
        </div>

        <div className="container hero-inner">
          <span className="hero-eyebrow">Find. Book. Play.</span>

          <h1 className="hero-title">
            Your next game is<br />
            <span className="hero-accent">two taps away</span>
          </h1>

          <p className="hero-sub">
            Discover turfs and courts near you, see live availability, and lock your
            slot in seconds. Short on players? TeamUp finds them for you.
          </p>

          <form className="hero-search" onSubmit={submitSearch}>
            <IconSearch style={{ width: 21, height: 21, color: 'var(--text-faint)', flexShrink: 0 }} />
            <input
              className="hero-input"
              placeholder="Search turfs, areas or cities…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search venues"
            />
            <button
              type="button" className="hero-locate" onClick={useMyLocation}
              disabled={locating} title="Use my location" aria-label="Use my location"
            >
              {locating ? <span className="spinner spinner-light" style={{ width: 17, height: 17 }} />
                        : <IconLocate style={{ width: 19, height: 19 }} />}
            </button>
            <button type="submit" className="btn btn-primary">Search</button>
          </form>

          <div className="hero-sports">
            {SPORTS.map((s) => (
              <Link key={s} to={`/venues?sport=${s}`} className="hero-sport">
                <span className="hero-sport-icon">{SPORT_ICONS[s]}</span>
                {SPORT_LABELS[s]}
              </Link>
            ))}
          </div>

          <div className="hero-stats">
            <Stat value={15} suffix="K+" label="turfs & courts" />
            <Stat value={100} suffix="M+" label="players in India" />
            <Stat value={2} suffix=" min" label="average booking" />
          </div>
        </div>
      </section>

      {/* ── Marquee ──────────────────────────────────────────── */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[...MARQUEE, ...MARQUEE].map((item, i) => (
            <span className="marquee-item" key={i}>{item}</span>
          ))}
        </div>
      </div>

      {/* ── Nearby venues ────────────────────────────────────── */}
      <section className="container section">
        <div className="between gap-16 wrap" style={{ marginBottom: 24 }}>
          <div>
            <span className="eyebrow">{coords ? 'Near you' : 'Top rated'}</span>
            <h2 style={{ marginTop: 8 }}>
              {coords ? 'Closest to you' : 'Turfs people love'}
            </h2>
            <p className="text-soft" style={{ marginTop: 6 }}>
              {coords
                ? 'Sorted by distance from where you are right now.'
                : 'Turn on location and we’ll show you what’s nearest instead.'}
            </p>
          </div>
          <Link to="/venues" className="btn btn-ghost">
            See all venues <IconChevron style={{ width: 16, height: 16 }} />
          </Link>
        </div>

        <div className="venue-grid" ref={nearRef}>
          {loading
            ? Array.from({ length: 6 }, (_, i) => <VenueCardSkeleton key={i} />)
            : venues.length
              ? venues.map((v, i) => (
                  <div key={v._id} className="will-reveal" style={{ '--i': i }}>
                    <VenueCard venue={v} />
                  </div>
                ))
              : (
                <div className="card card-pad empty" style={{ gridColumn: '1 / -1' }}>
                  <div className="empty-icon">🏟️</div>
                  <h3>No venues loaded yet</h3>
                  <p className="text-soft" style={{ marginTop: 8 }}>
                    Make sure the backend is running on port 5000 — it seeds demo venues automatically.
                  </p>
                </div>
              )}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="container section-sm">
        <div className="center" style={{ marginBottom: 30 }}>
          <span className="eyebrow" style={{ justifyContent: 'center' }}>How it works</span>
          <h2 style={{ marginTop: 10 }}>Kickoff in four taps</h2>
        </div>
        <div className="steps" ref={stepRef}>
          {STEPS.map((s, i) => (
            <div key={s.n} className="step will-reveal" style={{ '--i': i }}>
              <span className="step-num">{s.n}</span>
              <h3 style={{ marginBottom: 7 }}>{s.title}</h3>
              <p className="text-soft">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── The hybrid pitch (deck slide 4) ──────────────────── */}
      <section className="container section">
        <div className="center" style={{ marginBottom: 30 }}>
          <span className="eyebrow" style={{ justifyContent: 'center' }}>Our edge</span>
          <h2 style={{ marginTop: 10 }}>Nobody else plays both sides</h2>
          <p className="text-soft" style={{ marginTop: 10, maxWidth: '56ch', marginInline: 'auto' }}>
            Automation-only apps abandon offline venues. Call-centre services can't scale.
            GameOn runs both, so every turf in the city is bookable from day one.
          </p>
        </div>

        <div className="edge-grid" ref={edgeRef}>
          <div className="edge-card will-reveal" style={{ '--i': 0 }}>
            <span className="edge-num">01</span>
            <span className="edge-icon" style={{ background: 'var(--volt)' }}>
              <IconBolt style={{ width: 26, height: 26 }} />
            </span>
            <h3>Instant booking</h3>
            <p className="text-soft">
              Digitally-ready venues sync their calendar with us. Pick a slot, pay,
              and it's confirmed before you close the app.
            </p>
          </div>

          <div className="edge-card will-reveal" style={{ '--i': 1 }}>
            <span className="edge-num">02</span>
            <span className="edge-icon" style={{ background: 'var(--orange)' }}>
              <IconPhone style={{ width: 26, height: 26 }} />
            </span>
            <h3>Assisted booking</h3>
            <p className="text-soft">
              Local turfs that still run on phone calls stay bookable. We route your
              request and confirm on the owner's behalf — usually within 30 minutes.
            </p>
          </div>

          <div className="edge-card will-reveal" style={{ '--i': 2 }}>
            <span className="edge-num">03</span>
            <span className="edge-icon" style={{ background: 'var(--violet)', color: '#fff' }}>
              <IconUsers style={{ width: 26, height: 26 }} />
            </span>
            <h3>TeamUp</h3>
            <p className="text-soft">
              Four players and need six? Post the game, and nearby players with the
              right skill level ask to join. Costs split automatically.
            </p>
          </div>
        </div>
      </section>

      {/* ── Loyalty teaser ───────────────────────────────────── */}
      <section className="container section-sm">
        <div className="loyalty-strip">
          <div>
            <span className="eyebrow" style={{ color: 'var(--volt)' }}>Rewards</span>
            <h2 style={{ color: '#fff', marginTop: 10 }}>The more you play, the less you pay</h2>
            <p style={{ color: 'rgba(255,255,255,.8)', marginTop: 10, maxWidth: '50ch' }}>
              Every booking earns points. Points cut your platform fee, unlock earlier
              access to slots, and convert straight into wallet credit.
            </p>
            <div className="row gap-10 wrap" style={{ marginTop: 20 }}>
              {[
                { icon: '🥉', label: 'Rookie' },
                { icon: '🥈', label: 'Pro' },
                { icon: '🥇', label: 'Elite' },
                { icon: '👑', label: 'Legend' },
              ].map((t) => (
                <span key={t.label} className="tier-pill">{t.icon} {t.label}</span>
              ))}
            </div>
          </div>
          <Link to="/loyalty" className="btn btn-primary btn-lg">
            See the rewards <IconArrowRight style={{ width: 18, height: 18 }} />
          </Link>
        </div>
      </section>

      {/* ── Owner CTA ────────────────────────────────────────── */}
      <section className="container" style={{ paddingBottom: 56 }}>
        <div className="owner-cta will-reveal" ref={ctaRef}>
          <div>
            <span className="sticker" style={{ background: 'var(--volt)', color: 'var(--ink)', marginBottom: 14 }}>
              <span className="row gap-6"><IconSparkle style={{ width: 13, height: 13 }} /> Free to list</span>
            </span>
            <h2 style={{ color: '#fff', marginTop: 6 }}>Run a turf or court?</h2>
            <p style={{ color: 'rgba(255,255,255,.82)', marginTop: 10, maxWidth: '48ch' }}>
              List your venue free. Take instant bookings if you're set up for it, or let
              our team handle confirmations while you keep working the way you always have.
            </p>
          </div>
          <Link to="/register?role=owner" className="btn btn-primary btn-lg">
            List your venue <IconArrowRight style={{ width: 18, height: 18 }} />
          </Link>
        </div>
      </section>
    </div>
  );
}
