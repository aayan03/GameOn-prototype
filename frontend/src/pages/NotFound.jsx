import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container section fade-in">
      <div className="card card-pad empty">
        <div className="empty-icon">🧭</div>
        <h1 style={{ fontSize: '1.7rem' }}>Page not found</h1>
        <p className="text-soft" style={{ marginTop: 8, marginBottom: 20 }}>
          That link doesn't lead anywhere. Let's get you back to the game.
        </p>
        <Link to="/" className="btn btn-primary">Back to home</Link>
      </div>
    </div>
  );
}
