import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { parlorApi } from '../api/endpoints.js';
import VenueMap from '../components/VenueMap.jsx';
import OpenBadge from '../components/OpenBadge.jsx';
import {
  PARLOR_GAME_ICONS, PARLOR_GAME_LABELS, AMENITY_LABELS, clockLabel, DAY_NAMES,
} from '../utils/format.js';
import { IconPhone, IconChevron, IconLocate } from '../components/Icons.jsx';

/** Today first, so the row someone actually needs is at the top. */
function hoursFromToday(hours = []) {
  const today = new Date().getDay();
  return Array.from({ length: 7 }, (_, i) => {
    const day = (today + i) % 7;
    return { day, isToday: i === 0, row: hours.find((h) => h.day === day) };
  });
}

export default function ParlorDetail() {
  const { idOrSlug } = useParams();
  const [parlor, setParlor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    parlorApi.get(idOrSlug)
      .then(({ data }) => { setParlor(data); setError(''); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [idOrSlug]);

  if (loading) {
    return (
      <div className="container section center" style={{ paddingTop: 60 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  if (error || !parlor) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">🎱</div>
          <h3>{error || 'Parlour not found'}</h3>
          <Link to="/parlors" className="btn btn-primary" style={{ marginTop: 20 }}>
            Find another
          </Link>
        </div>
      </div>
    );
  }

  const [lng, lat] = parlor.location?.coordinates || [];
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  // Opens the platform's own maps app on a phone, Google Maps on a desktop.
  const directionsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : null;

  const address = [
    parlor.address?.line1, parlor.address?.area,
    parlor.address?.city, parlor.address?.pincode,
  ].filter(Boolean).join(', ');

  return (
    <div className="container section" style={{ maxWidth: 940 }}>
      <Link to="/parlors" className="back-link">
        <IconChevron style={{ width: 16, height: 16, transform: 'rotate(180deg)' }} /> All parlours
      </Link>

      {parlor.isPermanentlyClosed && (
        <div className="alert alert-error" style={{ marginTop: 16 }}>
          <span><strong>This parlour has permanently closed.</strong> The page is kept so old links still work.</span>
        </div>
      )}

      {!parlor.isClaimed && (
        <div className="alert alert-warn" style={{ marginTop: 16 }}>
          <span>
            <strong>Unclaimed listing.</strong> Details here came from public sources and
            have not been confirmed by the venue. Call ahead before you travel.
          </span>
        </div>
      )}

      <div className="parlor-hero">
        <div className="between gap-14 wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1>{parlor.name}</h1>
            <p className="text-soft" style={{ marginTop: 6 }}>{address}</p>
          </div>
          <OpenBadge parlor={parlor} />
        </div>

        {parlor.description && (
          <p className="text-soft" style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>
            {parlor.description}
          </p>
        )}

        <div className="parlor-games" style={{ marginTop: 18 }}>
          {parlor.games?.map((g) => (
            <span key={g} className="game-chip big">
              {PARLOR_GAME_ICONS[g]} {PARLOR_GAME_LABELS[g]}
            </span>
          ))}
        </div>

        {/*
          The call to action, and it is a phone call.
          Nothing on this page is bookable — say so once, plainly, rather than
          letting somebody hunt for a button that does not exist.
        */}
        <div className="parlor-actions">
          {parlor.contact?.phone && (
            <a href={`tel:${parlor.contact.phone}`} className="btn btn-primary btn-lg">
              <IconPhone style={{ width: 17, height: 17 }} /> Call {parlor.contact.phone}
            </a>
          )}
          {directionsUrl && (
            <a href={directionsUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-lg">
              <IconLocate style={{ width: 17, height: 17 }} /> Directions
            </a>
          )}
          {parlor.contact?.website && (
            <a href={parlor.contact.website} target="_blank" rel="noreferrer nofollow" className="btn btn-ghost btn-lg">
              Website
            </a>
          )}
        </div>
        <p className="text-faint" style={{ marginTop: 12, fontSize: '.88rem' }}>
          Tables are booked with the parlour directly — GameOn lists them, it does not reserve them.
        </p>
      </div>

      <div className="parlor-detail-grid">
        {/* ── Hours ───────────────────────────────────────── */}
        <div className="card card-pad">
          <h3 style={{ marginBottom: 12 }}>Opening hours</h3>
          <div className="hours-list">
            {hoursFromToday(parlor.openingHours).map(({ day, isToday, row }) => (
              <div key={day} className={`hours-row${isToday ? ' today' : ''}`}>
                <span>{isToday ? 'Today' : DAY_NAMES[day]}</span>
                <strong>
                  {!row || row.isClosed
                    ? 'Closed'
                    : `${clockLabel(row.open)} – ${clockLabel(row.close)}`}
                </strong>
              </div>
            ))}
          </div>
          {parlor.priceFrom > 0 && (
            <p className="text-soft" style={{ marginTop: 14, fontSize: '.92rem' }}>
              Indicative rate: ₹{parlor.priceFrom}
              {parlor.priceTo ? `–₹${parlor.priceTo}` : ''} per hour. Confirm when you call.
            </p>
          )}
        </div>

        {/* ── Where ───────────────────────────────────────── */}
        {hasCoords && (
          <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
            <VenueMap
              pins={[{
                id: parlor._id, name: parlor.name, slug: parlor.slug,
                lat, lng, area: parlor.address?.area || '', city: parlor.address?.city || '',
                sports: parlor.games || [], startingPrice: parlor.priceFrom || 0, rating: 0,
              }]}
              center={[lat, lng]}
              zoom={15}
              height="320px"
            />
          </div>
        )}
      </div>

      {parlor.amenities?.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 18 }}>
          <h3 style={{ marginBottom: 12 }}>What&rsquo;s there</h3>
          <div className="row gap-8 wrap">
            {parlor.amenities.map((a) => (
              <span key={a} className="badge badge-soft">
                {AMENITY_LABELS[a] || a.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
