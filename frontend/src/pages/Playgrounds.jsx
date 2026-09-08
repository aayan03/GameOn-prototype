import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { playgroundApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import useGeolocation from '../hooks/useGeolocation.js';
import useDebounce from '../hooks/useDebounce.js';
import VenueMap from '../components/VenueMap.jsx';
import SportIcon from '../components/SportIcon.jsx';
import {
  SPORT_LABELS, accessLabel, distanceLabel,
} from '../utils/format.js';
import { IconSearch, IconLocate, IconPin, IconChevron, IconSparkle } from '../components/Icons.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball'];

function PlaygroundCard({ pg }) {
  return (
    <Link to={`/playgrounds/${pg.slug || pg._id}`} className="pg-card">
      <div className="pg-card-head">
        <h3>{pg.name}</h3>
        <span className="badge badge-free">Free</span>
      </div>

      <p className="pg-where">
        <IconPin style={{ width: 13, height: 13 }} />
        {[pg.address?.area, pg.address?.city].filter(Boolean).join(', ') || 'Location on map'}
        {pg.distanceKm != null && <span className="text-faint"> · {distanceLabel(pg.distanceKm)}</span>}
      </p>

      <div className="row gap-6 wrap" style={{ marginTop: 10 }}>
        {pg.sports?.slice(0, 4).map((s) => (
          <span key={s} className="game-chip">
            <SportIcon sport={s} size={13} /> {SPORT_LABELS[s] || s}
          </span>
        ))}
      </div>

      <div className="pg-card-foot">
        <span className="text-soft">{accessLabel(pg.access)}</span>
        {pg.facilities?.length > 0 && (
          <span className="text-faint">{pg.facilities.length} facilities</span>
        )}
      </div>
    </Link>
  );
}

export default function Playgrounds() {
  const [params, setParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const { coords, request, isLoading: locating } = useGeolocation();

  const [rows, setRows] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounce(search, 350);

  const sport = params.get('sport') || '';
  const city = params.get('city') || '';

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (debounced === (params.get('q') || '')) return;
    setFilter('q', debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    playgroundApi
      .list({
        sport: sport || undefined,
        city: city || undefined,
        q: params.get('q') || undefined,
        lat: coords?.lat, lng: coords?.lng,
        radiusKm: coords ? 25 : undefined,
        limit: 40,
      })
      .then(({ data }) => { if (!cancelled) setRows(data); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sport, city, params, coords]);

  useEffect(() => {
    playgroundApi.cities().then(({ data }) => setCities(data)).catch(() => {});
  }, []);

  const pins = useMemo(() => rows
    .filter((p) => p.location?.coordinates)
    .map((p) => ({
      id: p._id, name: p.name, slug: p.slug,
      lat: p.location.coordinates[1], lng: p.location.coordinates[0],
      area: p.address?.area || '', city: p.address?.city || '',
      sports: p.sports || [], startingPrice: 0, rating: 0,
    })), [rows]);

  return (
    <div className="container section">
      <div className="between gap-16 wrap" style={{ marginBottom: 18 }}>
        <div>
          <span className="eyebrow">Free to play</span>
          <h1 style={{ marginTop: 8 }}>Public grounds near you</h1>
          <p className="text-soft" style={{ marginTop: 8, maxWidth: '60ch' }}>
            Parks, maidans and community grounds that cost nothing to use — found and
            added by players. {/* Said plainly: everything else on this site is
            bookable, so people will reasonably assume these are too. */}
            Nothing here is booked or reserved. Turn up and play.
          </p>
        </div>

        <div className="row gap-8 wrap">
          <button className={`pill${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>List</button>
          <button className={`pill${view === 'map' ? ' active' : ''}`} onClick={() => setView('map')}>Map</button>
        </div>
      </div>

      {/* The contribution prompt is the feature, so it is not buried. */}
      <div className="pg-cta">
        <div>
          <strong>Know a ground that isn&rsquo;t here?</strong>
          <p className="text-soft" style={{ marginTop: 4, fontSize: '.92rem' }}>
            Add it and we&rsquo;ll check it out. Once it&rsquo;s live, everyone can find it.
          </p>
        </div>
        <Link to={isAuthenticated ? '/playgrounds/new' : '/login?next=/playgrounds/new'} className="btn btn-primary">
          <IconSparkle style={{ width: 16, height: 16 }} /> Add a ground
        </Link>
      </div>

      <div className="event-filters">
        <div className="search-box">
          <IconSearch style={{ width: 19, height: 19, color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search grounds or areas…"
            aria-label="Search public grounds"
          />
        </div>

        <select value={city} onChange={(e) => setFilter('city', e.target.value)} aria-label="City">
          <option value="">All cities</option>
          {cities.map((c) => <option key={c.city} value={c.city}>{c.city} ({c.playgrounds})</option>)}
        </select>

        <button className={`btn btn-ghost${coords ? ' active' : ''}`} onClick={request} disabled={locating}>
          {locating
            ? <span className="spinner" style={{ width: 15, height: 15 }} />
            : <IconLocate style={{ width: 16, height: 16 }} />}
          {coords ? 'Near me' : 'Use my location'}
        </button>
      </div>

      <div className="chip-row" role="group" aria-label="Sports">
        <button className={`pill${!sport ? ' active' : ''}`} onClick={() => setFilter('sport', '')}>All sports</button>
        {SPORTS.map((s) => (
          <button
            key={s}
            className={`pill${sport === s ? ' active' : ''}`}
            onClick={() => setFilter('sport', sport === s ? '' : s)}
          >
            <SportIcon sport={s} size={15} /> {SPORT_LABELS[s]}
          </button>
        ))}
      </div>

      {!loading && rows.length > 0 && (
        <p className="text-faint" style={{ marginTop: 14, fontSize: '.9rem' }}>
          {rows.length} free {rows.length === 1 ? 'ground' : 'grounds'}
        </p>
      )}

      {loading ? (
        <div className="center" style={{ padding: 50 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : !rows.length ? (
        <div className="card card-pad empty" style={{ marginTop: 20 }}>
          <div className="empty-icon">🌳</div>
          <h3>No free grounds listed here yet</h3>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 18, maxWidth: '46ch', marginInline: 'auto' }}>
            This map is built by players. If you know a park or maidan people can
            use for nothing, you can be the first to put it on here.
          </p>
          <Link to={isAuthenticated ? '/playgrounds/new' : '/login?next=/playgrounds/new'} className="btn btn-primary">
            Add the first one
          </Link>
        </div>
      ) : view === 'map' ? (
        <div className="parlor-map" style={{ marginTop: 18 }}>
          <VenueMap pins={pins} userCoords={coords} fitPins radiusKm={coords ? 25 : null} height="min(70vh, 620px)" />
        </div>
      ) : (
        <div className="pg-grid" style={{ marginTop: 18 }}>
          {rows.map((p) => <PlaygroundCard key={p._id} pg={p} />)}
        </div>
      )}

      {isAuthenticated && (
        <p className="text-faint" style={{ marginTop: 26, fontSize: '.9rem' }}>
          <Link to="/playgrounds/mine" className="link-btn">
            See what you&rsquo;ve added <IconChevron style={{ width: 13, height: 13 }} />
          </Link>
        </p>
      )}

      {/* Facilities legend is only useful once something is on screen. */}
      {rows.length > 0 && (
        <p className="text-faint" style={{ marginTop: 10, fontSize: '.82rem' }}>
          Details are contributed by players and checked by us before they go live,
          but a public ground can change without notice — floodlit one week and
          locked the next. Take it as a good lead, not a guarantee.
        </p>
      )}
    </div>
  );
}
