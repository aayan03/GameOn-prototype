import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/** Blocks a route until the user is logged in (and optionally has a role). */
export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="container section center" style={{ paddingTop: 80 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
        <p className="text-soft" style={{ marginTop: 14 }}>Checking your session…</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">🔒</div>
          <h3>Not available for your account</h3>
          <p className="text-soft" style={{ marginTop: 6 }}>
            This area is for {roles.join(' and ')} accounts.
          </p>
        </div>
      </div>
    );
  }

  return children;
}
