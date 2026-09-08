import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { venueApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import VenueMap from '../components/VenueMap.jsx';
import {
  rupees, SPORT_LABELS, AMENITY_LABELS, AMENITY_ICONS, initials, ratingLabel, directionsUrl } from '../utils/format.js';
import { IconStar, IconPin, IconBolt, IconPhone, IconHeart, IconCheck, IconChevron } from '../components/Icons.jsx';
import SportIcon from '../components/SportIcon.jsx';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function VenueDetail() {
  const { idOrSlug } = useParams();
  const navigate = useNavigate();
  const { user, setUser, isAuthenticated } = useAuth();
  const [state, setState] = useState({ loading: true, venue: null, reviews: [], error: '' });
  const [activeImage, setActiveImage] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    venueApi.get(idOrSlug)
      .then(({ data }) => {
        if (cancelled) return;
        setState({ loading: false, venue: data.venue, reviews: data.reviews, error: '' });
        setIsFavorite(data.isFavorite);
      })
      .catch((err) => { if (!cancelled) setState({ loading: false, venue: null, reviews: [], error: err.message }); });
    return () => { cancelled = true; };
  }, [idOrSlug]);

  const { loading, venue, reviews, error } = state;

  const toggleFavorite = async () => {
    if (!isAuthenticated) { navigate('/login'); return; }
    try {
      const { data } = await venueApi.toggleFav(venue._id);
      setIsFavorite(data.isFavorite);
      setUser({ ...user, favorites: data.favorites });
    } catch { /* noop */ }
  };

  if (loading) {
    return (
      <div className="container section">
        <div className="skeleton" style={{ height: 320, borderRadius: 'var(--r-lg)' }} />
        <div className="skeleton" style={{ height: 36, width: '45%', marginTop: 24 }} />
        <div className="skeleton" style={{ height: 18, width: '30%', marginTop: 12 }} />
      </div>
    );
  }

  if (error || !venue) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">🏟️</div>
          <h3>{error || 'Venue not found'}</h3>
          <Link to="/venues" className="btn btn-primary" style={{ marginTop: 18 }}>Back to venues</Link>
        </div>
      </div>
    );
  }

  const isInstant = venue.bookingMode === 'automated';
  const images = venue.images?.length ? venue.images : [];
  const [lng, lat] = venue.location.coordinates;

  return (
    <div className="fade-in">
      {/* Gallery */}
      <div className="vd-gallery">
        {images.length ? (
          <>
            <img src={images[activeImage]} alt={venue.name} className="vd-hero-img" />
            {images.length > 1 && (
              <div className="vd-thumbs">
                {images.map((img, i) => (
                  <button
                    key={img} className={`vd-thumb${i === activeImage ? ' active' : ''}`}
                    onClick={() => setActiveImage(i)} aria-label={`Photo ${i + 1}`}
                  >
                    <img src={img} alt="" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="vd-hero-img vc-media-fallback" style={{ fontSize: '4rem' }}>
            <SportIcon sport={venue.sports?.[0]} size={40} />
          </div>
        )}
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        <nav className="breadcrumb">
          <Link to="/venues">Venues</Link>
          <IconChevron style={{ width: 13, height: 13 }} />
          <span>{venue.address?.city}</span>
        </nav>

        <div className="vd-layout">
          <div className="vd-main">
            <div className="between gap-16" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="row gap-8 wrap" style={{ marginBottom: 8 }}>
                  {venue.isFeatured && <span className="badge badge-featured">Featured</span>}
                  {venue.isVerified && <span className="badge badge-instant"><IconCheck style={{ width: 12, height: 12 }} /> Verified</span>}
                  <span className={`badge ${isInstant ? 'badge-instant' : 'badge-manual'}`}>
                    {isInstant ? <><IconBolt style={{ width: 12, height: 12 }} /> Instant booking</>
                               : <><IconPhone style={{ width: 12, height: 12 }} /> Booking on request</>}
                  </span>
                </div>
                <h1 style={{ fontSize: '2.1rem' }}>{venue.name}</h1>
                <div className="row gap-8 wrap" style={{ marginTop: 10, color: 'var(--text-soft)' }}>
                  {/* The address IS the directions link — that is what people
                      reach for. Free: a Maps URL, not the Maps API. */}
                  <a
                    className="row gap-4 addr-link"
                    href={directionsUrl({
                      name: venue.name,
                      area: venue.address?.area,
                      city: venue.address?.city,
                    })}
                    target="_blank" rel="noreferrer"
                  >
                    <IconPin style={{ width: 15, height: 15 }} />
                    {[venue.address?.line1, venue.address?.area, venue.address?.city].filter(Boolean).join(', ')}
                  </a>
                  {venue.rating > 0 && (
                    <span className="row gap-4">
                      <IconStar filled style={{ width: 15, height: 15, color: 'var(--orange)' }} />
                      <strong style={{ color: 'var(--text)' }}>{venue.rating.toFixed(1)}</strong>
                      {ratingLabel(venue.rating)} · {venue.reviewCount} reviews
                    </span>
                  )}
                </div>
              </div>

              <button className={`btn btn-ghost btn-sm${isFavorite ? ' fav-on' : ''}`} onClick={toggleFavorite}>
                <IconHeart filled={isFavorite} style={{ width: 16, height: 16 }} />
                {isFavorite ? 'Saved' : 'Save'}
              </button>
            </div>

            {venue.description && <p className="text-soft" style={{ marginTop: 18 }}>{venue.description}</p>}

            {venue.isClaimed === false && (
              <div className="alert alert-warn" style={{ marginTop: 18 }}>
                <span aria-hidden="true">ℹ️</span>
                <span>
                  <strong>Unclaimed listing.</strong> We added this venue from public
                  information. Prices, hours and facilities have not been confirmed by
                  the owner yet — please check with the venue before you travel.
                </span>
              </div>
            )}

            {/* Courts & pricing */}
            <section className="vd-section">
              <h2>Courts &amp; pricing</h2>
              <div className="court-list">
                {venue.courts.filter((c) => c.isActive !== false).map((court) => (
                  <div key={court._id} className="court-row">
                    <div className="court-icon"><SportIcon sport={court.sport} size={22} /></div>
                    <div className="grow">
                      <strong>{court.name}</strong>
                      <div className="text-faint">
                        {SPORT_LABELS[court.sport]}
                        {court.format && ` · ${court.format}`}
                        {court.capacity && ` · up to ${court.capacity} players`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{rupees(court.pricePerHour)}<span className="text-faint" style={{ fontWeight: 400 }}>/hr</span></div>
                      {court.peakPricePerHour && (
                        <div className="text-faint">{rupees(court.peakPricePerHour)}/hr peak</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Amenities */}
            {venue.amenities?.length > 0 && (
              <section className="vd-section">
                <h2>Amenities</h2>
                <div className="amenity-grid">
                  {venue.amenities.map((a) => (
                    <div key={a} className="amenity">
                      <span className="amenity-icon">{AMENITY_ICONS[a] || '✓'}</span>
                      {AMENITY_LABELS[a] || a}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Location */}
            <section className="vd-section">
              <h2>Where you'll play</h2>
              <VenueMap
                pins={[{
                  id: venue._id, name: venue.name, slug: venue.slug,
                  lat, lng, area: venue.address?.area, city: venue.address?.city,
                  rating: venue.rating, sports: venue.sports, bookingMode: venue.bookingMode,
                  startingPrice: venue.startingPrice, image: images[0],
                }]}
                center={[lat, lng]}
                zoom={15}
                height="320px"
              />
              <div className="row gap-8 wrap" style={{ marginTop: 12 }}>
                <a
                  className="btn btn-ghost btn-sm"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
                  target="_blank" rel="noreferrer"
                >
                  Get directions
                </a>
                <a
                  className="btn btn-ghost btn-sm"
                  href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`}
                  target="_blank" rel="noreferrer"
                >
                  Open in OpenStreetMap
                </a>
              </div>
            </section>

            {/* Opening hours */}
            <section className="vd-section">
              <h2>Opening hours</h2>
              <div className="hours-list">
                {venue.operatingHours?.map((h) => (
                  <div key={h.day} className="hours-row">
                    <span>{DAYS[h.day]}</span>
                    <strong>{h.isClosed ? 'Closed' : `${h.open} – ${h.close}`}</strong>
                  </div>
                ))}
              </div>
            </section>

            {/* Cancellation policy */}
            <section className="vd-section">
              <h2>Cancellation policy</h2>
              <div className="card card-pad stack gap-8">
                <div className="row gap-8">
                  <IconCheck style={{ width: 17, height: 17, color: 'var(--success)', flexShrink: 0 }} />
                  <span>
                    Free cancellation up to <strong>{venue.cancellationPolicy.freeCancellationHours} hours</strong> before your slot — refunded in full, to however you paid.
                  </span>
                </div>
                <div className="row gap-8">
                  <IconCheck style={{ width: 17, height: 17, color: 'var(--warning)', flexShrink: 0 }} />
                  <span>
                    Cancel between {venue.cancellationPolicy.partialRefundHours} and {venue.cancellationPolicy.freeCancellationHours} hours before and you get <strong>{venue.cancellationPolicy.partialRefundPercent}%</strong> back.
                  </span>
                </div>
                <div className="text-faint">
                  Cancelling inside {venue.cancellationPolicy.partialRefundHours} hours is non-refundable, since the slot is unlikely to be re-sold.
                </div>
              </div>
            </section>

            {/* Reviews */}
            <section className="vd-section">
              <h2>Reviews {reviews.length > 0 && <span className="text-faint">({venue.reviewCount})</span>}</h2>
              {reviews.length ? (
                <div className="stack gap-12">
                  {reviews.map((r) => (
                    <div key={r._id} className="card card-pad">
                      <div className="row gap-12">
                        <div className="avatar" style={{ background: 'var(--ink-2)', borderColor: 'transparent' }}>
                          {initials(r.user?.name)}
                        </div>
                        <div className="grow">
                          <div className="between">
                            <strong>{r.user?.name || 'Player'}</strong>
                            <span className="row gap-4">
                              {Array.from({ length: 5 }, (_, i) => (
                                <IconStar key={i} filled={i < r.rating} style={{ width: 13, height: 13, color: 'var(--orange)' }} />
                              ))}
                            </span>
                          </div>
                          <p className="text-soft" style={{ marginTop: 5 }}>{r.comment}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-soft">No reviews yet — be the first to play here and leave one.</p>
              )}
            </section>
          </div>

          {/* ── Booking sidebar ──────────────────────────────── */}
          <aside className="vd-side">
            <div className="book-card">
              <div className="between">
                <div>
                  <span className="text-faint">Starts at</span>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-.03em' }}>
                    {rupees(venue.startingPrice)}<span className="text-faint" style={{ fontSize: '.9rem', fontWeight: 400 }}>/hour</span>
                  </div>
                </div>
                <span className={`badge ${isInstant ? 'badge-instant' : 'badge-manual'}`}>
                  {isInstant ? 'Instant' : 'On request'}
                </span>
              </div>

              <Link to={`/venues/${venue.slug || venue._id}/book`} className="btn btn-primary btn-block btn-lg" style={{ marginTop: 18 }}>
                {isInstant ? 'Check availability' : 'Request a slot'}
              </Link>

              {!isInstant && venue.manualContact?.phone && (
                <p className="text-faint center" style={{ marginTop: 10 }}>
                  Typically confirmed within {venue.manualContact.responseTimeMins} minutes
                </p>
              )}

              <div className="book-facts">
                <div className="between"><span className="text-soft">Slot length</span><strong>{venue.slotDurationMins} min</strong></div>
                <div className="between"><span className="text-soft">Book up to</span><strong>{venue.advanceBookingDays} days ahead</strong></div>
                <div className="between"><span className="text-soft">Free cancellation</span><strong>{venue.cancellationPolicy.freeCancellationHours}h before</strong></div>
              </div>


            </div>

            <div className="card card-pad" style={{ marginTop: 18 }}>
              <div className="row gap-12">
                <div className="avatar" style={{ background: 'var(--violet)' }}>{initials(venue.owner?.name)}</div>
                <div>
                  <span className="text-faint">Managed by</span>
                  <div style={{ fontWeight: 700 }}>{venue.owner?.name}</div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
