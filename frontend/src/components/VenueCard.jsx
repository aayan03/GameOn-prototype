import { Link } from 'react-router-dom';
import { rupees, distanceLabel, SPORT_LABELS } from '../utils/format.js';
import { IconStar, IconPin, IconBolt, IconPhone, IconHeart } from './Icons.jsx';
import SportIcon from './SportIcon.jsx';

export default function VenueCard({ venue, onToggleFavorite, isFavorite }) {
  const image = venue.images?.[0];
  const price = venue.startingPrice ?? (venue.courts?.length ? Math.min(...venue.courts.map((c) => c.pricePerHour)) : 0);
  const isInstant = venue.bookingMode === 'automated';

  return (
    <article className="venue-card fade-in">
      <Link to={`/venues/${venue.slug || venue._id}`} className="vc-media" aria-label={venue.name}>
        {image
          ? <img src={image} alt="" loading="lazy" />
          : <div className="vc-media-fallback"><SportIcon sport={venue.sports?.[0]} size={44} /></div>}

        <div className="vc-badges">
          {venue.isFeatured && <span className="badge badge-featured">Featured</span>}
          {venue.isClaimed === false && (
            <span className="badge badge-unclaimed" title="Listed from public information — details not yet confirmed by the venue">
              Unclaimed
            </span>
          )}
          <span className={`badge ${isInstant ? 'badge-instant' : 'badge-manual'}`}>
            {isInstant ? <><IconBolt style={{ width: 12, height: 12 }} /> Instant</> 
                       : <><IconPhone style={{ width: 12, height: 12 }} /> On request</>}
          </span>
        </div>

        {typeof venue.distanceKm === 'number' && (
          <span className="vc-distance">{distanceLabel(venue.distanceKm)}</span>
        )}
      </Link>

      <div className="vc-body">
        <div className="between gap-8" style={{ alignItems: 'flex-start' }}>
          <Link to={`/venues/${venue.slug || venue._id}`} className="vc-title">{venue.name}</Link>
          {onToggleFavorite && (
            <button
              className={`vc-fav${isFavorite ? ' on' : ''}`}
              onClick={() => onToggleFavorite(venue._id)}
              aria-label={isFavorite ? 'Remove from saved' : 'Save venue'}
              aria-pressed={Boolean(isFavorite)}
            >
              <IconHeart filled={isFavorite} style={{ width: 18, height: 18 }} />
            </button>
          )}
        </div>

        <div className="vc-meta">
          <IconPin style={{ width: 14, height: 14, flexShrink: 0 }} />
          <span>{[venue.address?.area, venue.address?.city].filter(Boolean).join(', ') || 'Location not set'}</span>
        </div>

        <div className="vc-sports">
          {(venue.sports || []).slice(0, 4).map((s) => (
            <span key={s} className="vc-sport" title={SPORT_LABELS[s]}>
              <SportIcon sport={s} size={14} /> {SPORT_LABELS[s]}
            </span>
          ))}
          {venue.sports?.length > 4 && <span className="vc-sport">+{venue.sports.length - 4}</span>}
        </div>

        <div className="vc-foot">
          <div className="vc-rating">
            {venue.rating > 0 ? (
              <>
                <IconStar filled style={{ width: 14, height: 14, color: 'var(--orange)' }} />
                <strong>{venue.rating.toFixed(1)}</strong>
                <span className="text-faint">({venue.reviewCount})</span>
              </>
            ) : <span className="badge badge-soft">New venue</span>}
          </div>
          <div className="vc-price">
            <strong>{rupees(price)}</strong>
            <span className="text-faint">/hour</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function VenueCardSkeleton() {
  return (
    <div className="venue-card">
      <div className="skeleton" style={{ height: 168, borderRadius: 0 }} />
      <div className="vc-body stack gap-8">
        <div className="skeleton" style={{ height: 20, width: '75%' }} />
        <div className="skeleton" style={{ height: 14, width: '55%' }} />
        <div className="skeleton" style={{ height: 24, width: '85%' }} />
        <div className="skeleton" style={{ height: 18, width: '45%' }} />
      </div>
    </div>
  );
}
