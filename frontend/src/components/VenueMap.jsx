import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from 'react-router-dom';
import { rupees, distanceLabel, srcSetFor, directionsUrl } from '../utils/format.js';
import { sportIconMarkup } from './SportIcon.jsx';

/**
 * Leaflet + OpenStreetMap. Free, no API key, no billing account.
 *
 * Switching to Google Maps later means replacing the <TileLayer> url below
 * with a Google tile endpoint (or swapping in @react-google-maps/api) — the
 * rest of this component, and every page that uses it, stays as-is.
 */
const TILES = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  // A softer basemap that suits the brand better; also free.
  carto: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
};

/** Custom pin so markers carry the sport and the brand colour. */
/**
 * `kind` picks the colour before booking mode does: a free public ground is
 * a different KIND of thing from a venue, not a venue with different terms,
 * and somebody scanning the map should be able to see that at a glance
 * without reading a single popup.
 */
function makeIcon(sport, isManual, kind) {
  const bg = kind === 'playground' ? '#1FA85C' : isManual ? '#FF9C3D' : '#1A1A2E';
  const glyph = sportIconMarkup(sport, 19);
  return L.divIcon({
    className: 'gameon-pin-wrap',
    html: `<div class="gameon-pin" style="--pin-bg:${bg}"><span>${glyph}</span></div>`,
    iconSize: [38, 46],
    iconAnchor: [19, 44],
    popupAnchor: [0, -42],
  });
}

const userIcon = L.divIcon({
  className: 'gameon-pin-wrap',
  html: '<div class="gameon-userpin"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** Keeps the viewport in sync when filters or the user's location change. */
function ViewController({ center, zoom, pins, fitPins }) {
  const map = useMap();
  const lastCenter = useRef(null);

  useEffect(() => {
    if (fitPins && pins?.length) {
      const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      return;
    }
    const key = center ? `${center[0]},${center[1]}` : null;
    if (key && key !== lastCenter.current) {
      lastCenter.current = key;
      map.flyTo(center, zoom, { duration: 0.8 });
    }
  }, [center, zoom, pins, fitPins, map]);

  // Leaflet mis-measures its container if the map mounts inside a element
  // that resizes (tab switch, drawer open). This forces a recalculation.
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 220);
    return () => clearTimeout(t);
  }, [map]);

  return null;
}

export default function VenueMap({
  pins = [],
  userCoords = null,
  center,
  zoom = 12,
  fitPins = false,
  radiusKm = null,
  onPinClick,
  height = '100%',
}) {
  const provider = import.meta.env.VITE_MAP_PROVIDER === 'carto' ? 'carto' : 'osm';
  const tile = TILES[provider];

  const resolvedCenter = useMemo(() => {
    if (center) return center;
    if (userCoords) return [userCoords.lat, userCoords.lng];
    if (pins.length) return [pins[0].lat, pins[0].lng];
    return [12.9716, 77.5946]; // Bengaluru
  }, [center, userCoords, pins]);

  return (
    <div className="map-wrap" style={{ height }}>
      <MapContainer
        center={resolvedCenter}
        zoom={zoom}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <TileLayer url={tile.url} attribution={tile.attribution} maxZoom={19} />
        <ViewController center={resolvedCenter} zoom={zoom} pins={pins} fitPins={fitPins} />

        {userCoords && (
          <>
            <Marker position={[userCoords.lat, userCoords.lng]} icon={userIcon} />
            {radiusKm && (
              <Circle
                center={[userCoords.lat, userCoords.lng]}
                radius={Number(radiusKm) * 1000}
                pathOptions={{ color: '#6C3CE9', fillColor: '#6C3CE9', fillOpacity: 0.06, weight: 1.5 }}
              />
            )}
          </>
        )}

        {pins.map((pin) => (
          <Marker
            key={pin.id}
            position={[pin.lat, pin.lng]}
            icon={makeIcon(pin.sports?.[0], pin.bookingMode === 'manual', pin.kind)}
            eventHandlers={onPinClick ? { click: () => onPinClick(pin) } : undefined}
          >
            <Popup>
              <div className="map-pop">
                {pin.image && (
                  <img
                    src={pin.image} srcSet={srcSetFor(pin.image, [400, 600]) || undefined}
                    sizes="240px" alt="" loading="lazy" decoding="async"
                    className="map-pop-img"
                  />
                )}
                <div className="map-pop-body">
                  <strong>{pin.name}</strong>
                  <div className="text-faint">{[pin.area, pin.city].filter(Boolean).join(', ')}</div>
                  <div className="map-pop-row">
                    {pin.rating > 0 && <span>⭐ {pin.rating.toFixed(1)}</span>}
                    {/* "₹0/hr" would be an odd way to say free, and a price of
                        any kind on public land is the wrong idea entirely. */}
                    {pin.kind === 'playground'
                      ? <span className="badge badge-free">Free</span>
                      : <span>{rupees(pin.startingPrice)}/hr</span>}
                  </div>
                  {typeof pin.distanceKm === 'number' && (
                    <div className="text-faint">{distanceLabel(pin.distanceKm)}</div>
                  )}
                  {/* Somebody reading a pin is deciding whether to travel, so
                      the way to get there belongs here rather than one page
                      deeper. Free — this is a Maps URL, not the Maps API. */}
                  <a
                    href={directionsUrl({ name: pin.name, area: pin.area, city: pin.city, lat: pin.lat, lng: pin.lng })}
                    target="_blank" rel="noreferrer"
                    className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 8 }}
                  >
                    Directions
                  </a>
                  <Link
                    to={`${pin.kind === 'playground' ? '/playgrounds' : '/venues'}/${pin.slug || pin.id}`}
                    className="btn btn-primary btn-sm btn-block" style={{ marginTop: 6 }}
                  >
                    {pin.kind === 'playground' ? 'View ground' : 'View venue'}
                  </Link>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
