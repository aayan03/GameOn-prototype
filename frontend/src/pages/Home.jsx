import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { venueApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import HomeDashboard from './HomeDashboard.jsx';
import useGeolocation from '../hooks/useGeolocation.js';
import useReveal from '../hooks/useReveal.js';
import useCountUp from '../hooks/useCountUp.js';
import VenueCard, { VenueCardSkeleton } from '../components/VenueCard.jsx';
import { SPORT_ICONS, SPORT_LABELS } from '../utils/format.js';
import {
  IconSearch, IconLocate, IconBolt, IconPhone, IconUsers,
  IconChevron, IconArrowRight,
} from '../components/Icons.jsx';

// All eight the platform supports. This list used to stop at six, so
// pickleball and table tennis were bookable but undiscoverable from the
// home page — the only place a first-time visitor looks.
const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball', 'pickleball', 'tabletennis'];

/**
 * One accent per sport.
 *
 * Every pill used to hover to the same lime while five other brand colours sat
 * unused in the hero. Giving each its own turns a uniform row into something
 * that rewards a cursor, and costs one CSS variable.
 *
 * `ink` is the label colour on that fill — the two light accents need dark
 * text, the saturated ones need white.
 */
const SPORT_ACCENT = {
  football:   { bg: 'var(--volt)',    ink: 'var(--ink)' },
  cricket:    { bg: 'var(--orange)',  ink: 'var(--ink)' },
  badminton:  { bg: 'var(--sky)',     ink: 'var(--ink)' },
  // Ink, not white: white on magenta is 3.36:1, which is fine for a display
  // headline but under AA for a 14px pill label.
  basketball: { bg: 'var(--magenta)', ink: 'var(--ink)' },
  tennis:     { bg: 'var(--volt-2)',  ink: 'var(--ink)' },
  volleyball: { bg: 'var(--violet)',  ink: '#fff' },
  pickleball: { bg: 'var(--success)', ink: '#fff' },
  tabletennis:{ bg: 'var(--sky)',     ink: 'var(--ink)' },
};

/**
 * The stickers floating behind the hero copy.
 *
 * There were three, hardcoded into `nth-child` rules across three media
 * queries — so the hero advertised three of the eight sports on the platform,
 * and adding one meant editing CSS in three places.
 *
 * Positions are hand-placed rather than generated: they have to thread
 * between the headline, the search bar and the stat row, and no formula does
 * that as well as looking at it. `compact` marks the ones that survive below
 * 1080px, where there is only room for a few.
 */
const HERO_BLOBS = [
  { sport: 'football',   top: '8%',  right: '6%',  tilt: '-10deg', bg: 'var(--surface)', dur: '6s',   delay: '0s',   compact: true },
  { sport: 'basketball', top: '30%', right: '17%', tilt: '7deg',   bg: 'var(--orange)',  dur: '7.2s', delay: '.5s',  compact: true },
  { sport: 'cricket',    top: '52%', right: '4%',  tilt: '-6deg',  bg: 'var(--volt)',    dur: '6.6s', delay: '1.1s', compact: true },
  { sport: 'badminton',  top: '80%', right: '13%', tilt: '11deg',  bg: 'var(--magenta)', dur: '7.8s', delay: '.3s' },
  { sport: 'tennis',     top: '18%', right: '28%', tilt: '5deg',   bg: 'var(--sky)',     dur: '6.9s', delay: '1.6s' },
  { sport: 'pickleball', top: '86%', right: '9%',  tilt: '-13deg', bg: 'var(--success)', dur: '7.4s', delay: '.9s' },
  { sport: 'volleyball', top: '44%', right: '33%', tilt: '-4deg',  bg: 'var(--violet)',  dur: '6.3s', delay: '2s' },
  { sport: 'tabletennis',top: '24%', right: '36%', tilt: '9deg',   bg: 'var(--surface)', dur: '7.6s', delay: '1.3s' },
];

// Features, not figures. "15,000+ turfs" was in here too — a number the
// platform cannot stand behind does not belong in the furniture.
const MARQUEE = [
  'Instant booking', 'Live availability', 'Free cancellation', 'Split the cost',
  'Find players nearby', 'No phone tag', 'Assisted booking', 'Weekend leagues',
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

/**
 * The VISITOR landing page.
 *
 * Signed-in users get HomeDashboard instead — see the switch in Home.jsx's
 * default export below. Splitting them is most of the answer to "the home
 * page feels cluttered": one page was trying to sell the product AND be a
 * control panel, so everybody got both and neither was short.
 *
 * Trimmed while splitting. "How it works" (4 steps) and "Our edge" (3 cards)
 * said overlapping things in two different shapes and have been merged into
 * one three-point section; the loyalty strip and the owner CTA are now a
 * single closing block instead of two competing dark slabs in a row.
 */
function HomeLanding() {
  const [query, setQuery] = useState('');
  const [venues, setVenues] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { coords, request, isLoading: locating } = useGeolocation();
  const navigate = useNavigate();

  const nearRef = useReveal();
  const edgeRef = useReveal();
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

  // Headline figures, from the same source as the listings themselves.
  useEffect(() => {
    let cancelled = false;
    Promise.all([venueApi.list({ limit: 1 }), venueApi.cities()])
      .then(([listed, cities]) => {
        if (cancelled) return;
        const total = listed.meta?.total || 0;
        // Nothing to boast about yet — leave the panel out rather than
        // printing a proud "0 venues listed" across the hero.
        if (!total) return;
        setStats({
          venues: total,
          cities: cities.data?.length || 0,
          sports: SPORTS.length,
        });
      })
      .catch(() => { /* the hero renders fine without them */ });
    return () => { cancelled = true; };
  }, []);

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
        {/* Centre circle and halfway line — see .hero-pitch in app.css. */}
        <div className="hero-pitch" aria-hidden="true" />

        <div className="hero-deco" aria-hidden="true">
          {HERO_BLOBS.map((b) => (
            <span
              key={b.sport}
              className="hero-blob"
              data-compact={b.compact ? '' : undefined}
              style={{
                '--blob-top': b.top,
                '--blob-right': b.right,
                '--blob-tilt': b.tilt,
                '--blob-bg': b.bg,
                '--blob-dur': b.dur,
                '--blob-delay': b.delay,
              }}
            >
              {SPORT_ICONS[b.sport]}
            </span>
          ))}
        </div>

        <div className="container hero-inner">
          <span className="hero-eyebrow">Find. Book. Play.</span>

          {/*
            `.marker` draws a highlighter stroke behind the words on load —
            it was defined in app.css, specialised for this headline
            (`.hero-title .marker::before` sets it magenta), and never used.
            The markup said `.hero-accent`, which only recolours the text.
          */}
          <h1 className="hero-title">
            Your next game is<br />
            <span className="marker">two taps away</span>
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
              <Link
                key={s}
                to={`/venues?sport=${s}`}
                className="hero-sport"
                style={{
                  '--sport-accent': SPORT_ACCENT[s]?.bg,
                  '--sport-ink': SPORT_ACCENT[s]?.ink,
                }}
              >
                <span className="hero-sport-icon">{SPORT_ICONS[s]}</span>
                {SPORT_LABELS[s]}
              </Link>
            ))}
          </div>

          {/*
            Real numbers, read from the API.

            These were hardcoded to "15K+ turfs" and "100M+ players in India" —
            the first was untrue for a platform with a few dozen listings, and
            the second was a market-size figure dressed up as a platform
            metric. It is the first thing a visitor reads, and a claim you
            cannot back is the wrong place to start a booking relationship.
            The venue count now comes from the same endpoint the listings do,
            and the panel simply does not render until it has a real figure.
          */}
          {stats && (
            <div className="hero-stats">
              <Stat value={stats.venues} suffix="" label={stats.venues === 1 ? 'venue listed' : 'venues listed'} />
              <Stat value={stats.cities} suffix="" label={stats.cities === 1 ? 'city' : 'cities'} />
              <Stat value={stats.sports} suffix="" label="sports covered" />
            </div>
          )}
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
                // A customer sees this, not a developer. The old copy told
                // them to check that "the backend is running on port 5000".
                <div className="card card-pad empty" style={{ gridColumn: '1 / -1' }}>
                  <div className="empty-icon">🏟️</div>
                  <h3>{coords ? 'Nothing open near you right now' : 'No venues to show yet'}</h3>
                  <p className="text-soft" style={{ marginTop: 8, marginBottom: 18 }}>
                    {coords
                      ? 'Try widening your search, or browse every venue we cover.'
                      : 'We are still adding venues in your area. Have a look at the full list in the meantime.'}
                  </p>
                  <Link to="/venues" className="btn btn-primary">Browse all venues</Link>
                </div>
              )}
        </div>
      </section>

      {/*
        ── Why GameOn ─────────────────────────────────────────
        Was two sections: a four-step "How it works" and a three-card "Our
        edge". They said overlapping things in two different shapes, one after
        the other, which is a large part of why this page read as cluttered.
        One section, three points, each doing a distinct job.
      */}
      <section className="container section">
        <div className="center" style={{ marginBottom: 30 }}>
          <span className="eyebrow" style={{ justifyContent: 'center' }}>Why GameOn</span>
          <h2 style={{ marginTop: 10 }}>Nobody else plays both sides</h2>
          <p className="text-soft" style={{ marginTop: 10, maxWidth: '54ch', marginInline: 'auto' }}>
            Automation-only apps abandon offline venues. Call-centre services can&rsquo;t
            scale. GameOn runs both, so every turf in the city is bookable from day one.
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
              Pick a slot on a live grid, pay, and it&rsquo;s confirmed before you close
              the app. No phone tag, no waiting to hear back.
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
              request and confirm on the owner&rsquo;s behalf, usually within 30 minutes.
            </p>
          </div>

          <div className="edge-card will-reveal" style={{ '--i': 2 }}>
            <span className="edge-num">03</span>
            <span className="edge-icon" style={{ background: 'var(--violet)', color: '#fff' }}>
              <IconUsers style={{ width: 26, height: 26 }} />
            </span>
            <h3>TeamUp &amp; rewards</h3>
            <p className="text-soft">
              Short on players? Post the game and nearby players ask to join, with the
              cost split. Every booking earns points that cut your platform fee.
            </p>
          </div>
        </div>
      </section>

      {/*
        ── One closing block ──────────────────────────────────
        The loyalty strip and the owner CTA were two dark slabs stacked back to
        back, each with its own heading and button. Same visual weight, same
        colour, competing for the same attention. One block, two doors.
      */}
      <section className="container" style={{ paddingBottom: 56 }}>
        <div className="closing-cta will-reveal" ref={ctaRef}>
          <div className="closing-half">
            <span className="eyebrow" style={{ color: 'var(--volt)' }}>For players</span>
            <h2 style={{ color: '#fff', marginTop: 10 }}>The more you play, the less you pay</h2>
            <p style={{ color: 'rgba(255,255,255,.8)', marginTop: 10 }}>
              Every booking earns points. Points cut your fee and turn into wallet credit.
            </p>
            <div className="row gap-8 wrap" style={{ marginTop: 16 }}>
              {[['🥉', 'Rookie'], ['🥈', 'Pro'], ['🥇', 'Elite'], ['👑', 'Legend']].map(([icon, label]) => (
                <span key={label} className="tier-pill">{icon} {label}</span>
              ))}
            </div>
            <Link to="/register" className="btn btn-primary" style={{ marginTop: 20 }}>
              Create an account <IconArrowRight style={{ width: 17, height: 17 }} />
            </Link>
          </div>

          <div className="closing-divider" aria-hidden="true" />

          <div className="closing-half">
            <span className="eyebrow" style={{ color: 'var(--volt)' }}>For venues</span>
            <h2 style={{ color: '#fff', marginTop: 10 }}>Run a turf or court?</h2>
            <p style={{ color: 'rgba(255,255,255,.8)', marginTop: 10 }}>
              List it free. Take instant bookings, or let our team handle confirmations
              while you keep working the way you always have.
            </p>
            <Link to="/register?role=owner" className="btn btn-onlight" style={{ marginTop: 20 }}>
              List your venue <IconArrowRight style={{ width: 17, height: 17 }} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * The home page picks its audience.
 *
 * A signed-in player wants their next booking and a way to the next one; a
 * visitor wants to know what this is. One page doing both is how it ended up
 * seven sections long.
 */
export default function Home() {
  const { isAuthenticated, loading } = useAuth();

  // Render nothing rather than flashing the marketing page at somebody who is
  // about to be shown their dashboard.
  if (loading) {
    return (
      <div className="container section center" style={{ paddingTop: 80 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  return isAuthenticated ? <HomeDashboard /> : <HomeLanding />;
}
