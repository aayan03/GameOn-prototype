import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * The other end of the signup link.
 *
 * This is where the account is actually created — everything before it is a
 * pending row on the server that expires on its own. Landing here with a good
 * token creates the user, signs them in, and drops them into the app.
 *
 * Note that the emailed link points at THIS page, not at the API. That is
 * deliberate: corporate mail gateways and link scanners routinely fetch every
 * URL in an incoming email to check it, and a scanner hitting an API endpoint
 * would burn the one-time token before the recipient ever clicked. A scanner
 * fetching this page just gets the app shell — it does not run the POST below
 * — so the token survives until a human arrives.
 */
export default function VerifyEmail() {
  const { verifyEmail } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [state, setState] = useState(token ? 'working' : 'missing');
  const [error, setError] = useState('');

  /**
   * React 18 runs effects twice in development StrictMode. The token is
   * single-use, so the second run would always fail and show an error on a
   * signup that had in fact just succeeded.
   */
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    (async () => {
      try {
        const user = await verifyEmail(token);
        setState('done');
        // Straight into the app — they are signed in at this point.
        setTimeout(() => {
          navigate(user.role === 'owner' ? '/owner' : '/', { replace: true });
        }, 1200);
      } catch (err) {
        setError(err.message);
        setState('failed');
      }
    })();
  }, [token, verifyEmail, navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card fade-in center">
        <Link to="/" className="logo" style={{ color: 'var(--text)', justifyContent: 'center', marginBottom: 6 }}>
          <span className="logo-mark">GO</span> GameOn
        </Link>

        {state === 'working' && (
          <>
            <div className="spinner" style={{ margin: '22px auto 0' }} />
            <h1 style={{ fontSize: '1.4rem', marginTop: 16 }}>Confirming your email…</h1>
            <p className="text-soft" style={{ marginTop: 6 }}>One moment.</p>
          </>
        )}

        {state === 'done' && (
          <>
            <div style={{ fontSize: '2.6rem', marginTop: 10 }}>🎉</div>
            <h1 style={{ fontSize: '1.5rem' }}>You&rsquo;re in</h1>
            <p className="text-soft" style={{ marginTop: 8 }}>
              Account created. Taking you to the app…
            </p>
          </>
        )}

        {(state === 'failed' || state === 'missing') && (
          <>
            <div style={{ fontSize: '2.6rem', marginTop: 10 }}>🔗</div>
            <h1 style={{ fontSize: '1.5rem' }}>That link didn&rsquo;t work</h1>
            <p className="text-soft" style={{ marginTop: 8 }}>
              {state === 'missing'
                ? 'This page needs the link from your signup email.'
                : error}
            </p>
            <p className="text-faint" style={{ marginTop: 12, fontSize: '.9rem' }}>
              Links expire after an hour and work only once. Signing up again
              sends a fresh one.
            </p>
            <Link to="/register" className="btn btn-primary" style={{ marginTop: 18 }}>
              Sign up again
            </Link>
            <p className="text-faint" style={{ marginTop: 16, fontSize: '.9rem' }}>
              Already have an account? <Link to="/login">Log in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
