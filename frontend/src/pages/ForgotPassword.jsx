import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/endpoints.js';
import { IconArrowLeft } from '../components/Icons.jsx';

/**
 * "I forgot my password."
 *
 * Before this existed there was no way back into an account — no reset route
 * on the API and no screen here — so forgetting a password meant losing the
 * account, its wallet balance and its booking history permanently.
 *
 * The confirmation deliberately does not say whether the address had an
 * account, matching the API. Telling the user "no account with that email"
 * would be friendlier and would also let anyone test a list of addresses
 * against the site.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Development only: with no SMTP configured the API hands the link back so
  // the flow is usable without a mail server.
  const [devLink, setDevLink] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await authApi.forgotPassword(email.trim());
      setSent(true);
      if (data.devResetUrl) setDevLink(data.devResetUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card fade-in">
        <Link to="/" className="logo" style={{ color: 'var(--text)', justifyContent: 'center', marginBottom: 6 }}>
          <span className="logo-mark">GO</span> GameOn
        </Link>

        {sent ? (
          <>
            <div className="center" style={{ margin: '10px 0 4px' }}>
              <div className="success-check" style={{ margin: '0 auto' }}>
                <svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7" /></svg>
              </div>
            </div>
            <h1 style={{ fontSize: '1.5rem', textAlign: 'center' }}>Check your inbox</h1>
            <p className="text-soft center" style={{ marginBottom: 18 }}>
              If <strong>{email}</strong> has a GameOn account, a reset link is on its way.
              It expires in 30 minutes.
            </p>
            <p className="text-faint center" style={{ marginBottom: 20 }}>
              Nothing after a minute or two? Check your spam folder, then try again.
            </p>

            {devLink && (
              <div className="alert alert-info" style={{ marginBottom: 18 }}>
                <span>
                  <strong>Development mode.</strong> No mail server is configured, so here is
                  the link:{' '}
                  <a href={devLink} style={{ textDecoration: 'underline', wordBreak: 'break-all' }}>
                    open reset page
                  </a>
                </span>
              </div>
            )}

            <Link to="/login" className="btn btn-primary btn-block">Back to log in</Link>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '1.5rem', textAlign: 'center' }}>Forgot your password?</h1>
            <p className="text-soft center" style={{ marginBottom: 22 }}>
              Enter your email and we&apos;ll send you a link to set a new one.
            </p>

            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

            <form onSubmit={submit} className="stack gap-16">
              <div className="field">
                <label className="label" htmlFor="fp-email">Email</label>
                <input
                  id="fp-email" type="email" className="input" required autoComplete="email" autoFocus
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <button className="btn btn-primary btn-block btn-lg" disabled={busy || !email.trim()}>
                {busy ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Send reset link'}
              </button>
            </form>

            <p className="center" style={{ marginTop: 20 }}>
              <Link to="/login" className="link-btn row gap-6" style={{ justifyContent: 'center' }}>
                <IconArrowLeft style={{ width: 14, height: 14 }} /> Back to log in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
