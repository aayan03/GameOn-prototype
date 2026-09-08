import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { venueApi } from '../api/endpoints.js';
import useGeolocation from '../hooks/useGeolocation.js';
import useReveal from '../hooks/useReveal.js';
import useCountUp from '../hooks/useCountUp.js';
import VenueCard, { VenueCardSkeleton } from '../components/VenueCard.jsx';
import { SPORT_LABELS } from '../utils/format.js';
import {
  IconSearch, IconLocate, IconBolt, IconPhone, IconUsers,
  IconChevron, IconArrowRight, IconSparkle,
} from '../components/Icons.jsx';
import SportIcon from '../components/SportIcon.jsx';

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
/**
 * The floating tiles beside the headline.
 *
 * They are LINKS, not decoration. Eight sports floating next to a search box
 * look clickable whether or not they are, so a visitor who reaches for one
 * and gets nothing has been told the hero is a picture. They go where the
 * chips below go.
 *
 * All one size. Varying them read as inconsistency rather than as depth, and
 * a link smaller than its neighbours is a smaller tap target for no reason a
 * user can see.
 *
 * SCATTERED, deliberately. The first pass alternated left-right down two
 * columns at even intervals, which the eye reads as a grid with a wobble
 * rather than as confetti — a pattern you notice is worse than no pattern.
 * So the vertical gaps are uneven (6, 11, 9, 15, 5, 19, 12) and no two
 * neighbours share a column. Tilts run wider for the same reason.
 *
 * `bg` is a literal, not a token. Two of the accents (violet, success) shift
 * between light and dark, and the hero gradient is dark in BOTH — so pinning
 * them keeps the corner identical either way rather than re-tinting for a
 * theme change nobody can see behind it.
 *
 * Every position still sits in the right-hand column, clear of the copy and
 * the chips — see the note on .hero-sports in app.css for why that exists.
 * Anything past about 34% starts crowding the headline at the 1200px
 * breakpoint, so that is the practical left edge.
 */
const HERO_BLOBS = [
  { sport: 'football',    top: '5%',  right: '9%',  tilt: '-12deg', bg: '#FFFFFF', dur: '7.5s', delay: '0s'   },
  { sport: 'basketball',  top: '11%', right: '27%', tilt: '8deg',   bg: '#FF9C3D', dur: '8.4s', delay: '.7s'  },
  { sport: 'tennis',      top: '22%', right: '4%',  tilt: '-6deg',  bg: '#3DC9FF', dur: '8.1s', delay: '1.9s' },
  { sport: 'badminton',   top: '31%', right: '19%', tilt: '14deg',  bg: '#FF3E7F', dur: '9s',   delay: '.4s'  },
  { sport: 'volleyball',  top: '46%', right: '31%', tilt: '-9deg',  bg: '#9B7CFF', dur: '7.2s', delay: '2.3s' },
  { sport: 'cricket',     top: '51%', right: '8%',  tilt: '5deg',   bg: '#D6FF3F', dur: '7.8s', delay: '1.3s' },
  { sport: 'pickleball',  top: '70%', right: '24%', tilt: '-15deg', bg: '#3DDC84', dur: '8.7s', delay: '1.1s' },
  { sport: 'tabletennis', top: '82%', right: '6%',  tilt: '10deg',  bg: '#FFFFFF', dur: '8.9s', delay: '1.6s' },
];

// Features, not figures. "15,000+ turfs" was in here too — a number the
// platform cannot stand behind does not belong in the furniture.
const MARQUEE = [
  'Instant booking', 'Live availability', 'Free cancellation', 'Split the cost',
  'Find players nearby', 'No phone tag', 'Assisted booking', 'Weekend leagues',
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
  const [stats, setStats] = useState(null);
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

        <div className="hero-deco">
          {HERO_BLOBS.map((b) => (
            <Link
              key={b.sport}
              to={`/venues?sport=${b.sport}`}
              className="hero-blob"
              aria-label={`${SPORT_LABELS[b.sport]} venues`}
              style={{
                '--blob-top': b.top,
                '--blob-right': b.right,
                '--blob-tilt': b.tilt,
                '--blob-bg': b.bg,
                '--blob-dur': b.dur,
                '--blob-delay': b.delay,
              }}
            >
              <SportIcon sport={b.sport} size="62%" />
            </Link>
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
                <span className="hero-sport-icon"><SportIcon sport={s} size={19} /></span>
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

      {/* ── How it works, and why it is different ───────────────
          These were two full sections — "How it works" then a pitch-deck
          slide headed "Nobody else plays both sides". Measured, the home page
          ran 4.2 screens on desktop and 8.3 on mobile, of which 2.5x more was
          marketing than product. One tighter block says the same thing to
          somebody who came here to book a badminton court. */}
      <section className="container section-sm">
        <div className="center" style={{ marginBottom: 26 }}>
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

        <div className="edge-strip" ref={edgeRef}>
          <div className="edge-mini">
            <span className="edge-icon sm" style={{ background: 'var(--volt)' }}>
              <IconBolt style={{ width: 18, height: 18 }} />
            </span>
            <div>
              <strong>Instant booking</strong>
              <p className="text-soft">Pick a slot, pay, confirmed before you close the app.</p>
            </div>
          </div>
          <div className="edge-mini">
            <span className="edge-icon sm" style={{ background: 'var(--orange)' }}>
              <IconPhone style={{ width: 18, height: 18 }} />
            </span>
            <div>
              <strong>Assisted booking</strong>
              <p className="text-soft">Turfs that still run on phone calls stay bookable — we confirm for you.</p>
            </div>
          </div>
          <div className="edge-mini">
            <span className="edge-icon sm" style={{ background: 'var(--violet)', color: '#fff' }}>
              <IconUsers style={{ width: 18, height: 18 }} />
            </span>
            <div>
              <strong>TeamUp</strong>
              <p className="text-soft">Four players and need six? Post it, split the cost automatically.</p>
            </div>
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
