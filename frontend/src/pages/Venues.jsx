import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { venueApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import useGeolocation from '../hooks/useGeolocation.js';
import useDebounce from '../hooks/useDebounce.js';
import VenueCard, { VenueCardSkeleton } from '../components/VenueCard.jsx';
import { SPORT_LABELS, rupees } from '../utils/format.js';
import { IconSearch, IconLocate, IconFilter, IconClose, IconBolt, IconPhone } from '../components/Icons.jsx';
import SportIcon from '../components/SportIcon.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball', 'pickleball', 'tabletennis'];
const AMENITIES = ['parking', 'floodlights', 'washroom', 'changing_room', 'cafeteria', 'equipment_rental', 'shower', 'wifi'];
const AMENITY_LABELS = {
  parking: 'Parking', floodlights: 'Floodlights', washroom: 'Washroom',
  changing_room: 'Changing room', cafeteria: 'Cafeteria',
  equipment_rental: 'Equipment', shower: 'Shower', wifi: 'Wi-Fi',
};

export default function Venues() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const { coords, request, isLoading: locating, error: geoError } = useGeolocation();

  const [searchInput, setSearchInput] = useState(params.get('q') || '');
  const debouncedSearch = useDebounce(searchInput, 400);

  const [venues, setVenues] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  // Bumped by the retry button, so a failed load can be repeated without
  // making the user change a filter to trigger the effect.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((n) => n + 1);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // URL is the single source of truth for filters — links stay shareable
  // and the back button behaves the way people expect.
  const filters = useMemo(() => ({
    q: params.get('q') || '',
    sport: params.get('sport') || '',
    city: params.get('city') || '',
    bookingMode: params.get('bookingMode') || '',
    amenities: params.get('amenities') ? params.get('amenities').split(',') : [],
    maxPrice: params.get('maxPrice') || '',
    minRating: params.get('minRating') || '',
    sort: params.get('sort') || '',
    lat: params.get('lat') || '',
    lng: params.get('lng') || '',
    radiusKm: params.get('radiusKm') || '',
    page: Number(params.get('page') || 1),
  }), [params]);

  const setFilter = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length)) next.delete(k);
        else next.set(k, Array.isArray(v) ? v.join(',') : String(v));
      });
      if (!('page' in patch)) next.delete('page'); // any filter change resets pagination
      return next;
    }, { replace: true });
  }, [setParams]);

  // Push the debounced search box value into the URL.
  useEffect(() => {
    if (debouncedSearch !== filters.q) setFilter({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => { venueApi.cities().then(({ data }) => setCities(data)).catch(() => {}); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    venueApi.list({ ...filters, limit: 12 })
      .then(({ data, meta: m }) => {
        if (cancelled) return;
        setVenues(data);
        setMeta(m);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, reloadKey]);

  const applyNearMe = async () => {
    const c = coords || (await request());
    if (c) setFilter({ lat: c.lat, lng: c.lng, radiusKm: filters.radiusKm || 25, sort: 'distance' });
  };

  const clearNearMe = () => setFilter({ lat: '', lng: '', radiusKm: '', sort: '' });

  const toggleAmenity = (a) => {
    const next = filters.amenities.includes(a)
      ? filters.amenities.filter((x) => x !== a)
      : [...filters.amenities, a];
    setFilter({ amenities: next });
  };

  const toggleFavorite = async (venueId) => {
    if (!user) { navigate('/login'); return; }
    try {
      const { data } = await venueApi.toggleFav(venueId);
      setUser({ ...user, favorites: data.favorites });
    } catch { /* ignore — the heart just won't fill */ }
  };

  const activeCount =
    (filters.sport ? 1 : 0) + (filters.city ? 1 : 0) + (filters.bookingMode ? 1 : 0) +
    filters.amenities.length + (filters.maxPrice ? 1 : 0) + (filters.minRating ? 1 : 0);

  const clearAll = () => { setSearchInput(''); setParams(new URLSearchParams(), { replace: true }); };

  return (
    <div className="container section fade-in">
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: '2rem' }}>Find a venue</h1>
        <p className="text-soft">
          {/* Never report a confident "0 venues available" for a request that
              FAILED. On a free tier that sleeps, the first load after an idle
              spell is exactly when this happens, and telling somebody the
              catalogue is empty is how they conclude the product is dead. */}
          {loading ? 'Searching…'
            : error ? 'Could not load venues'
            : `${meta.total} venue${meta.total === 1 ? '' : 's'} available`}
          {filters.lat && ' near you'}
        </p>
      </div>

      {/* Search + near-me */}
      <div className="search-bar">
        <IconSearch style={{ width: 19, height: 19, color: 'var(--text-faint)', flexShrink: 0 }} />
        <input
          className="hero-input" placeholder="Search by name, area or city…"
          value={searchInput} onChange={(e) => setSearchInput(e.target.value)} aria-label="Search venues"
        />
        {searchInput && (
          <button className="icon-btn" onClick={() => setSearchInput('')} aria-label="Clear search">
            <IconClose style={{ width: 16, height: 16 }} />
          </button>
        )}
        <button
          className={`btn btn-sm ${filters.lat ? 'btn-dark' : 'btn-ghost'}`}
          onClick={filters.lat ? clearNearMe : applyNearMe}
          disabled={locating}
        >
          {locating ? <span className="spinner" style={{ width: 14, height: 14 }} />
                    : <IconLocate style={{ width: 15, height: 15 }} />}
          {filters.lat ? 'Near me · on' : 'Near me'}
        </button>
        <button className="btn btn-sm btn-ghost mobile-filter-btn" onClick={() => setShowFilters(true)}>
          <IconFilter style={{ width: 15, height: 15 }} />
          Filters{activeCount > 0 && ` (${activeCount})`}
        </button>
      </div>

      {geoError && <div className="alert alert-info" style={{ marginTop: 12 }}>{geoError}</div>}

      {/* Sport chips */}
      <div className="chip-row" style={{ marginTop: 16 }}>
        <button className={`pill${!filters.sport ? ' active' : ''}`} onClick={() => setFilter({ sport: '' })}>
          All sports
        </button>
        {SPORTS.map((s) => (
          <button
            key={s}
            className={`pill${filters.sport === s ? ' active' : ''}`}
            onClick={() => setFilter({ sport: filters.sport === s ? '' : s })}
          >
            <span className="pill-icon"><SportIcon sport={s} size={16} /></span> {SPORT_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="venues-layout">
        {/* ── Filter sidebar ─────────────────────────────────── */}
        <aside className={`filters${showFilters ? ' open' : ''}`}>
          <div className="filters-head">
            <strong>Filters</strong>
            <div className="row gap-8">
              {activeCount > 0 && <button className="link-btn" onClick={clearAll}>Clear all</button>}
              <button className="icon-btn filters-close" onClick={() => setShowFilters(false)} aria-label="Close filters">
                <IconClose style={{ width: 18, height: 18 }} />
              </button>
            </div>
          </div>

          <div className="filters-body">
            <div className="filter-group">
              <span className="label">Sort by</span>
              <select
                className="select" aria-label="Sort venues by"
                value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value })}
              >
                <option value="">Recommended</option>
                {filters.lat && <option value="distance">Nearest first</option>}
                <option value="rating">Highest rated</option>
                <option value="price_low">Price: low to high</option>
                <option value="price_high">Price: high to low</option>
                <option value="popular">Most booked</option>
              </select>
            </div>

            <div className="filter-group">
              <span className="label">City</span>
              <select
                className="select" aria-label="Filter by city"
                value={filters.city} onChange={(e) => setFilter({ city: e.target.value })}
              >
                <option value="">All cities</option>
                {cities.map((c) => <option key={c.city} value={c.city}>{c.city} ({c.venues})</option>)}
              </select>
            </div>

            {filters.lat && (
              <div className="filter-group">
                <span className="label">Within {filters.radiusKm || 25} km</span>
                <input
                  type="range" min="1" max="50" step="1"
                  aria-label="Search radius in kilometres"
                  value={filters.radiusKm || 25}
                  onChange={(e) => setFilter({ radiusKm: e.target.value })}
                  className="range"
                />
              </div>
            )}

            <div className="filter-group">
              <span className="label">Booking type</span>
              <div className="stack gap-8">
                {[
                  { v: '', label: 'Any', icon: null },
                  { v: 'automated', label: 'Instant booking', icon: <IconBolt style={{ width: 14, height: 14 }} /> },
                  { v: 'manual', label: 'Assisted / on request', icon: <IconPhone style={{ width: 14, height: 14 }} /> },
                ].map((o) => (
                  <label key={o.v} className="radio-row">
                    <input
                      type="radio" name="bookingMode" checked={filters.bookingMode === o.v}
                      onChange={() => setFilter({ bookingMode: o.v })}
                    />
                    <span>{o.icon} {o.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <span className="label">Max price per hour: {filters.maxPrice ? rupees(filters.maxPrice) : 'Any'}</span>
              <input
                type="range" min="200" max="3000" step="100"
                aria-label="Maximum price per hour"
                value={filters.maxPrice || 3000}
                onChange={(e) => setFilter({ maxPrice: e.target.value === '3000' ? '' : e.target.value })}
                className="range"
              />
            </div>

            <div className="filter-group">
              <span className="label">Minimum rating</span>
              <div className="row gap-8 wrap">
                {['', '3', '4', '4.5'].map((r) => (
                  <button
                    key={r}
                    className={`pill${filters.minRating === r ? ' active' : ''}`}
                    onClick={() => setFilter({ minRating: r })}
                  >
                    {r ? `${r}+ ⭐` : 'Any'}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <span className="label">Amenities</span>
              <div className="row gap-8 wrap">
                {AMENITIES.map((a) => (
                  <button
                    key={a}
                    className={`pill${filters.amenities.includes(a) ? ' active' : ''}`}
                    onClick={() => toggleAmenity(a)}
                  >
                    {AMENITY_LABELS[a]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="filters-foot">
            <button className="btn btn-primary btn-block" onClick={() => setShowFilters(false)}>
              {/* This button applies filters and closes the drawer; it does not
                  retry. Saying "Try again" here would be a second control that
                  looks like the one in the error, and does something else. */}
              {error ? 'Show results' : `Show ${meta.total} results`}
            </button>
          </div>
        </aside>

        {showFilters && <div className="filters-backdrop" onClick={() => setShowFilters(false)} />}

        {/* ── Results ────────────────────────────────────────── */}
        <div className="results">
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16, display: 'block' }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>We could not load venues</strong>
              <p style={{ fontSize: '.92rem', marginBottom: 12 }}>{error}</p>
              <button className="btn btn-sm btn-primary" onClick={reload}>Try again</button>
            </div>
          )}

          <div className="venue-grid">
            {loading
              ? Array.from({ length: 6 }, (_, i) => <VenueCardSkeleton key={i} />)
              : venues.map((v) => (
                  <VenueCard
                    key={v._id} venue={v}
                    onToggleFavorite={toggleFavorite}
                    isFavorite={user?.favorites?.some((f) => String(f) === String(v._id))}
                  />
                ))}
          </div>

          {!loading && !venues.length && !error && (
            <div className="card card-pad empty">
              <div className="empty-icon">🔍</div>
              <h2>No venues match those filters</h2>
              <p className="text-soft" style={{ marginTop: 6, marginBottom: 18 }}>
                Try widening your radius, clearing a filter, or searching a different area.
              </p>
              <button className="btn btn-primary" onClick={clearAll}>Clear all filters</button>
            </div>
          )}

          {meta.pages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-ghost btn-sm" disabled={filters.page <= 1}
                onClick={() => setFilter({ page: filters.page - 1 })}
              >
                Previous
              </button>
              <span className="text-soft">Page {meta.page} of {meta.pages}</span>
              <button
                className="btn btn-ghost btn-sm" disabled={filters.page >= meta.pages}
                onClick={() => setFilter({ page: filters.page + 1 })}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
