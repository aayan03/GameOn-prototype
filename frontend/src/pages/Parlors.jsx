import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { parlorApi } from '../api/endpoints.js';
import useGeolocation from '../hooks/useGeolocation.js';
import useDebounce from '../hooks/useDebounce.js';
import VenueMap from '../components/VenueMap.jsx';
import {
  PARLOR_GAMES, PARLOR_GAME_ICONS, PARLOR_GAME_LABELS, distanceLabel,
} from '../utils/format.js';
import { IconSearch, IconLocate, IconPhone, IconChevron } from '../components/Icons.jsx';
import OpenBadge from '../components/OpenBadge.jsx';

function ParlorCard({ parlor }) {
  return (
    <Link to={`/parlors/${parlor.slug || parlor._id}`} className="parlor-card">
      <div className="parlor-card-head">
        <h3>{parlor.name}</h3>
        <OpenBadge parlor={parlor} compact />
      </div>

      <p className="parlor-where">
        {[parlor.address?.area, parlor.address?.city].filter(Boolean).join(' · ')}
        {parlor.distanceKm != null && (
          <span className="parlor-distance"> · {distanceLabel(parlor.distanceKm)}</span>
        )}
      </p>

      <div className="parlor-games">
        {parlor.games?.slice(0, 4).map((g) => (
          <span key={g} className="game-chip">
            {PARLOR_GAME_ICONS[g]} {PARLOR_GAME_LABELS[g]}
          </span>
        ))}
        {parlor.games?.length > 4 && <span className="game-chip more">+{parlor.games.length - 4}</span>}
      </div>

      <div className="parlor-card-foot">
        {parlor.priceFrom ? (
          <span className="text-soft">
            From ₹{parlor.priceFrom}{parlor.priceTo ? `–${parlor.priceTo}` : ''}/hr
          </span>
        ) : <span className="text-faint">Call for rates</span>}
        {/* A phone number, not a Book button — nothing here is reservable. */}
        {parlor.contact?.phone && (
          <span className="parlor-call">
            <IconPhone style={{ width: 14, height: 14 }} /> {parlor.contact.phone}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function Parlors() {
  const [params, setParams] = useSearchParams();
  const { coords, request, isLoading: locating } = useGeolocation();

  const [parlors, setParlors] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounce(search, 350);

  const game = params.get('game') || '';
  const city = params.get('city') || '';
  const openNow = params.get('openNow') === 'true';

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
    parlorApi
      .list({
        game: game || undefined,
        city: city || undefined,
        openNow: openNow ? 'true' : undefined,
        q: params.get('q') || undefined,
        lat: coords?.lat, lng: coords?.lng,
        radiusKm: coords ? 25 : undefined,
        limit: 40,
      })
      .then(({ data }) => { if (!cancelled) setParlors(data); })
      .catch(() => { if (!cancelled) setParlors([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [game, city, openNow, params, coords]);

  useEffect(() => {
    parlorApi.cities().then(({ data }) => setCities(data)).catch(() => {});
  }, []);

  const pins = useMemo(() => parlors
    .filter((p) => p.location?.coordinates)
    .map((p) => ({
      id: p._id,
      name: p.name,
      slug: p.slug,
      lat: p.location.coordinates[1],
      lng: p.location.coordinates[0],
      area: p.address?.area || '',
      city: p.address?.city || '',
      image: p.images?.[0] || '',
      // The map popup reuses the venue shape, so it wants these names.
      startingPrice: p.priceFrom || 0,
      rating: 0,
      sports: p.games || [],
    })), [parlors]);

  const openCount = parlors.filter((p) => p.openNow).length;

  return (
    <div className="container section">
      <div className="between gap-16 wrap" style={{ marginBottom: 20 }}>
        <div>
          <span className="eyebrow">Game parlours</span>
          <h1 style={{ marginTop: 8 }}>Find a place to play indoors</h1>
          <p className="text-soft" style={{ marginTop: 8, maxWidth: '58ch' }}>
            Snooker halls, arcades, bowling alleys and gaming cafés near you.
            {/* Said plainly, because every other listing on this site IS
                bookable and people will reasonably assume these are too. */}
            {' '}Opening hours and a phone number — call ahead to reserve a table.
          </p>
        </div>

        <div className="row gap-8">
          <button
            className={`pill${view === 'list' ? ' active' : ''}`}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            className={`pill${view === 'map' ? ' active' : ''}`}
            onClick={() => setView('map')}
          >
            Map
          </button>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────── */}
      <div className="event-filters">
        <div className="search-box">
          <IconSearch style={{ width: 19, height: 19, color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parlours or areas…"
            aria-label="Search game parlours"
          />
        </div>

        <select value={city} onChange={(e) => setFilter('city', e.target.value)} aria-label="City">
          <option value="">All cities</option>
          {cities.map((c) => <option key={c.city} value={c.city}>{c.city} ({c.parlors})</option>)}
        </select>

        <button
          className={`btn btn-ghost${coords ? ' active' : ''}`}
          onClick={request}
          disabled={locating}
        >
          {locating
            ? <span className="spinner" style={{ width: 15, height: 15 }} />
            : <IconLocate style={{ width: 16, height: 16 }} />}
          {coords ? 'Near me' : 'Use my location'}
        </button>
      </div>

      <div className="chip-row" role="group" aria-label="Filters">
        <button
          className={`pill${openNow ? ' active' : ''}`}
          onClick={() => setFilter('openNow', openNow ? '' : 'true')}
        >
          <span className="open-dot" aria-hidden="true" /> Open now
        </button>
        <button className={`pill${!game ? ' active' : ''}`} onClick={() => setFilter('game', '')}>
          All games
        </button>
        {PARLOR_GAMES.map((g) => (
          <button
            key={g}
            className={`pill${game === g ? ' active' : ''}`}
            onClick={() => setFilter('game', game === g ? '' : g)}
          >
            {PARLOR_GAME_ICONS[g]} {PARLOR_GAME_LABELS[g]}
          </button>
        ))}
      </div>

      {!loading && parlors.length > 0 && (
        <p className="text-faint" style={{ marginTop: 14, fontSize: '.9rem' }}>
          {parlors.length} {parlors.length === 1 ? 'parlour' : 'parlours'}
          {openCount > 0 && ` · ${openCount} open right now`}
        </p>
      )}

      {/* ── Results ─────────────────────────────────────────── */}
      {loading ? (
        <div className="center" style={{ padding: 50 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : !parlors.length ? (
        <div className="card card-pad empty" style={{ marginTop: 20 }}>
          <div className="empty-icon">🎱</div>
          <h3>Nothing here yet</h3>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 18 }}>
            {openNow
              ? 'Nothing is open right now with those filters. Try turning off "Open now".'
              : 'No parlours match those filters. Try widening them.'}
          </p>
          <button className="btn btn-ghost" onClick={() => setParams({}, { replace: true })}>
            Clear filters <IconChevron style={{ width: 15, height: 15 }} />
          </button>
        </div>
      ) : view === 'map' ? (
        <div className="parlor-map" style={{ marginTop: 18 }}>
          <VenueMap
            pins={pins}
            userCoords={coords}
            fitPins
            radiusKm={coords ? 25 : null}
            height="min(70vh, 620px)"
          />
        </div>
      ) : (
        <div className="parlor-grid" style={{ marginTop: 18 }}>
          {parlors.map((p) => <ParlorCard key={p._id} parlor={p} />)}
        </div>
      )}
    </div>
  );
}
