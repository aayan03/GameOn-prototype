import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { eventApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import useReveal from '../hooks/useReveal.js';
import useDebounce from '../hooks/useDebounce.js';
import { EVENT_TYPES, EVENT_TYPE_ICONS, EVENT_TYPE_LABELS } from '../utils/format.js';
import EventCard, { EventCardSkeleton } from '../components/EventCard.jsx';
import { IconSearch, IconChevron } from '../components/Icons.jsx';

const WHEN = [
  { key: 'all', label: 'Any time' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

export default function Events() {
  const { isAuthenticated } = useAuth();
  const [params, setParams] = useSearchParams();

  const [events, setEvents] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounce(search, 350);
  const gridRef = useReveal();

  const type = params.get('type') || '';
  const city = params.get('city') || '';
  const when = params.get('when') || 'all';
  const mine = params.get('mine') || '';

  /** Writes one filter into the URL, so a filtered view is shareable. */
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (debounced === (params.get('q') || '')) return;
    setFilter('q', debounced);
    // `params` is deliberately not a dependency — including it re-runs this on
    // every filter change and fights the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    eventApi
      .list({
        type: type || undefined,
        city: city || undefined,
        when: when !== 'all' ? when : undefined,
        mine: mine || undefined,
        q: params.get('q') || undefined,
        limit: 24,
      })
      .then(({ data }) => { if (!cancelled) setEvents(data); })
      .catch((err) => { if (!cancelled) { setEvents([]); setError(err.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, city, when, mine, params]);

  useEffect(() => {
    eventApi.cities().then(({ data }) => setCities(data)).catch(() => {});
  }, []);

  return (
    <div className="container section">
      <div className="between gap-16 wrap" style={{ marginBottom: 22 }}>
        <div>
          <span className="eyebrow">What&rsquo;s on</span>
          <h1 style={{ marginTop: 8 }}>Sports events near you</h1>
          <p className="text-soft" style={{ marginTop: 8, maxWidth: '58ch' }}>
            Marathons, tournaments, sunrise runs and coaching clinics. Free to
            join — reserve a place and turn up.
          </p>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────── */}
      <div className="event-filters">
        <div className="search-box">
          <IconSearch style={{ width: 19, height: 19, color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events, areas or cities…"
            aria-label="Search events"
          />
        </div>

        <select value={city} onChange={(e) => setFilter('city', e.target.value)} aria-label="City">
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c.city} value={c.city}>{c.city} ({c.events})</option>
          ))}
        </select>

        <select value={when} onChange={(e) => setFilter('when', e.target.value)} aria-label="When">
          {WHEN.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
        </select>
      </div>

      {/* Type chips — the primary way people browse this page. */}
      <div className="chip-row" role="group" aria-label="Event type">
        <button
          className={`pill${!type ? ' active' : ''}`}
          onClick={() => setFilter('type', '')}
        >
          All events
        </button>
        {EVENT_TYPES.map((t) => (
          <button
            key={t}
            className={`pill${type === t ? ' active' : ''}`}
            onClick={() => setFilter('type', type === t ? '' : t)}
          >
            {EVENT_TYPE_ICONS[t]} {EVENT_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {isAuthenticated && (
        <div className="chip-row" style={{ marginTop: 4 }}>
          <button
            className={`pill${mine === 'going' ? ' active' : ''}`}
            onClick={() => setFilter('mine', mine === 'going' ? '' : 'going')}
          >
            🎟️ Events I&rsquo;m going to
          </button>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────── */}
      {error && <div className="alert alert-error" style={{ marginTop: 20 }}>{error}</div>}

      <div className="event-grid" ref={gridRef} style={{ marginTop: 22 }}>
        {loading
          ? Array.from({ length: 6 }, (_, i) => <EventCardSkeleton key={i} />)
          : events.length
            ? events.map((e, i) => (
                <div key={e._id} className="will-reveal" style={{ '--i': i }}>
                  <EventCard event={e} />
                </div>
              ))
            : (
              <div className="card card-pad empty" style={{ gridColumn: '1 / -1' }}>
                <div className="empty-icon">📅</div>
                <h3>
                  {mine === 'going'
                    ? 'You have not signed up for anything yet'
                    : 'Nothing on just yet'}
                </h3>
                <p className="text-soft" style={{ marginTop: 8, marginBottom: 18 }}>
                  {mine === 'going'
                    ? 'Events you register for will show up here.'
                    : 'No events match those filters. Try widening them, or check back soon.'}
                </p>
                {mine === 'going'
                  ? <button className="btn btn-primary" onClick={() => setFilter('mine', '')}>Browse all events</button>
                  : (type || city || when !== 'all') && (
                    <button className="btn btn-ghost" onClick={() => setParams({}, { replace: true })}>
                      Clear filters <IconChevron style={{ width: 15, height: 15 }} />
                    </button>
                  )}
              </div>
            )}
      </div>
    </div>
  );
}
