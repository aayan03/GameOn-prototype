import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { venueApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import VenueCard, { VenueCardSkeleton } from '../components/VenueCard.jsx';

export default function Favorites() {
  const { user, setUser } = useAuth();
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const ids = user?.favorites || [];
    if (!ids.length) { setVenues([]); setLoading(false); return undefined; }

    setLoading(true);
    Promise.all(ids.map((id) => venueApi.get(id).then(({ data }) => data.venue).catch(() => null)))
      .then((results) => { if (!cancelled) setVenues(results.filter(Boolean)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.favorites]);

  const toggleFavorite = async (venueId) => {
    const { data } = await venueApi.toggleFav(venueId);
    setUser({ ...user, favorites: data.favorites });
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
