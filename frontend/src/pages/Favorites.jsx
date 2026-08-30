import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { venueApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import VenueCard, { VenueCardSkeleton } from '../components/VenueCard.jsx';

export default function Favorites() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);

  /**
   * A stable key for the saved set.
   *
   * `user.favorites` is a fresh array on every `setUser`, so keying the effect
   * on the array itself re-ran it after each heart tap — refetching every
   * saved venue to reflect one removal. A joined string only changes when the
   * set actually changes.
   */
  const favoriteIds = useMemo(() => (user?.favorites || []).map(String), [user?.favorites]);
  const idsKey = favoriteIds.join(',');

  useEffect(() => {
    let cancelled = false;

    if (!idsKey) { setVenues([]); setLoading(false); return undefined; }

    setLoading(true);
    // One request for the whole set, rather than one per venue.
    venueApi.list({ ids: idsKey, limit: 50 })
      .then(({ data }) => { if (!cancelled) setVenues(data); })
      .catch(() => { if (!cancelled) setVenues([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [idsKey]);

  const toggleFavorite = async (venueId) => {
    // Drop it from the list straight away, then reconcile with the server.
    // Waiting for the round trip left the card sitting there looking unsaved.
    const previous = venues;
    setVenues((list) => list.filter((v) => String(v._id) !== String(venueId)));
    try {
      const { data } = await venueApi.toggleFav(venueId);
      setUser({ ...user, favorites: data.favorites });
    } catch (err) {
      setVenues(previous);
      toast.error(err.message || 'Could not update your saved venues.');
    }
  };

  return (
    <div className="container section fade-in">
      <h1 style={{ fontSize: '2rem' }}>Saved venues</h1>
      <p className="text-soft" style={{ marginBottom: 22 }}>
        {loading ? 'Loading…' : `${venues.length} venue${venues.length === 1 ? '' : 's'} saved`}
      </p>

      {loading ? (
        <div className="venue-grid">
          {Array.from({ length: 3 }, (_, i) => <VenueCardSkeleton key={i} />)}
        </div>
      ) : venues.length ? (
        <div className="venue-grid">
          {venues.map((v) => (
            <VenueCard key={v._id} venue={v} onToggleFavorite={toggleFavorite} isFavorite />
          ))}
        </div>
      ) : (
        <div className="card card-pad empty">
          <div className="empty-icon">💚</div>
          <h3>Nothing saved yet</h3>
          <p className="text-soft" style={{ marginTop: 6, marginBottom: 18 }}>
            Tap the heart on any venue to keep it here for quick booking.
          </p>
          <Link to="/venues" className="btn btn-primary">Browse venues</Link>
        </div>
      )}
    </div>
  );
}
