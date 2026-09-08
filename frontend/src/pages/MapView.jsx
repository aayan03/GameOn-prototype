import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { venueApi, playgroundApi } from '../api/endpoints.js';
import useGeolocation from '../hooks/useGeolocation.js';
import VenueMap from '../components/VenueMap.jsx';
import { SPORT_LABELS, rupees, distanceLabel } from '../utils/format.js';
import { IconLocate, IconClose, IconChevron } from '../components/Icons.jsx';
import { Link } from 'react-router-dom';
import SportIcon from '../components/SportIcon.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball'];

export default function MapView() {
  const [params, setParams] = useSearchParams();
  const { coords, request, isLoading: locating, error: geoError } = useGeolocation();
  const [pins, setPins] = useState([]);
  // Free grounds are opt-OUT: the most useful thing this map can show
  // somebody is a free option next to the paid ones.
  const [showFree, setShowFree] = useState(true);
  const [freePins, setFreePins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const sport = params.get('sport') || '';
  const radiusKm = params.get('radiusKm') || '25';
  const nearMe = Boolean(coords && params.get('near') === '1');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    venueApi.map({
      sport: sport || undefined,
      lat: nearMe ? coords?.lat : undefined,
      lng: nearMe ? coords?.lng : undefined,
      radiusKm: nearMe ? radiusKm : undefined,
    })
      .then(({ data }) => { if (!cancelled) setPins(data); })
      .catch(() => { if (!cancelled) setPins([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sport, nearMe, coords, radiusKm]);

  useEffect(() => {
    let cancelled = false;
    playgroundApi
      .list({
        sport: sport || undefined,
        lat: nearMe ? coords?.lat : undefined,
        lng: nearMe ? coords?.lng : undefined,
        radiusKm: nearMe ? radiusKm : undefined,
        limit: 50,
      })
      .then(({ data }) => {
        if (cancelled) return;
        setFreePins(data
          .filter((p) => p.location?.coordinates)
          .map((p) => ({
            id: p._id, name: p.name, slug: p.slug, kind: 'playground',
            lat: p.location.coordinates[1], lng: p.location.coordinates[0],
            area: p.address?.area || '', city: p.address?.city || '',
            sports: p.sports || [], startingPrice: 0, rating: 0,
            distanceKm: p.distanceKm,
          })));
      })
      // Silent: the venue map is the main job and must not fail with it.
      .catch(() => { if (!cancelled) setFreePins([]); });
    return () => { cancelled = true; };
  }, [sport, nearMe, coords, radiusKm]);

  const allPins = showFree ? [...pins, ...freePins] : pins;

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (!v) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };

  const goNearMe = async () => {
    const c = coords || (await request());
    if (c) setParam('near', '1');
  };

  return (
    <div className="map-page fade-in">
      <div className="map-toolbar">
        <div className="container row gap-8 wrap" style={{ padding: '12px 20px' }}>
          {/* Free grounds are on by default and can be turned off — the pin
              colour already distinguishes them, so this is for someone who
              only wants places they can actually reserve. */}
          <button
            className={`pill${showFree ? ' active' : ''}`}
            onClick={() => setShowFree((v) => !v)}
            aria-pressed={showFree}
          >
            <span className="free-dot" aria-hidden="true" /> Free grounds
          </button>
          <span className="nav-group-divider" aria-hidden="true" />
          <button className={`pill${!sport ? ' active' : ''}`} onClick={() => setParam('sport', '')}>All sports</button>
          {SPORTS.map((s) => (
            <button key={s} className={`pill${sport === s ? ' active' : ''}`} onClick={() => setParam('sport', sport === s ? '' : s)}>
              <SportIcon sport={s} size={16} /> {SPORT_LABELS[s]}
            </button>
          ))}
          <button
            className={`pill${nearMe ? ' active' : ''}`}
            onClick={nearMe ? () => setParam('near', '') : goNearMe}
            disabled={locating}
            style={{ marginLeft: 'auto' }}
          >
            {locating ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <IconLocate style={{ width: 15, height: 15 }} />}
            Near me
          </button>
        </div>
      </div>

      {geoError && <div className="container" style={{ paddingTop: 10 }}><div className="alert alert-info">{geoError}</div></div>}

      <div className="map-stage">
        <VenueMap
          pins={allPins}
          userCoords={nearMe ? coords : null}
          fitPins={!nearMe && allPins.length > 0}
          center={nearMe && coords ? [coords.lat, coords.lng] : undefined}
          zoom={nearMe ? 13 : 11}
          radiusKm={nearMe ? radiusKm : null}
          onPinClick={setSelected}
          height="100%"
        />

        <div className="map-count">
          {loading
            ? 'Loading venues…'
            : `${pins.length} venue${pins.length === 1 ? '' : 's'}`
              + (showFree && freePins.length
                ? ` · ${freePins.length} free ground${freePins.length === 1 ? '' : 's'}`
                : '')}
        </div>

        {selected && (
          <div className="map-sheet fade-in">
            <button className="icon-btn map-sheet-close" onClick={() => setSelected(null)} aria-label="Close">
              <IconClose style={{ width: 18, height: 18 }} />
            </button>
            {selected.image && <img src={selected.image} alt="" className="map-sheet-img" />}
            <div className="map-sheet-body">
              <strong style={{ fontSize: '1.05rem' }}>{selected.name}</strong>
              <div className="text-faint">{[selected.area, selected.city].filter(Boolean).join(', ')}</div>
              <div className="row gap-12" style={{ marginTop: 8, fontSize: '.88rem' }}>
                {selected.rating > 0 && <span>⭐ <strong>{selected.rating.toFixed(1)}</strong> ({selected.reviewCount})</span>}
                <span><strong>{rupees(selected.startingPrice)}</strong>/hr</span>
                {typeof selected.distanceKm === 'number' && <span className="text-faint">{distanceLabel(selected.distanceKm)}</span>}
              </div>
              <Link to={`/venues/${selected.slug || selected.id}`} className="btn btn-primary btn-block" style={{ marginTop: 12 }}>
                View venue <IconChevron style={{ width: 15, height: 15 }} />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
