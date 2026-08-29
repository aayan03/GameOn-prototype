import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/endpoints.js';
import { tokenStore } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

/**
 * Sets a new password from an emailed link.
 *
 * The API signs the user straight in on success and retires every other
 * session, so this page finishes by storing the returned tokens rather than
 * bouncing someone who has just proved ownership of the account back to a
 * login form.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUser, setLoyalty } = useAuth();
  const toast = useToast();

  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Mirrors registerSchema on the API, so the rules are stated up front
  // rather than discovered through a rejected submit.
  const tooShort = password.length > 0 && password.length < 8;
  const noLetter = password.length > 0 && !/[a-zA-Z]/.test(password);
  const noDigit = password.length > 0 && !/[0-9]/.test(password);
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= 8 && !noLetter && !noDigit && password === confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await authApi.resetPassword({ token, password });
      tokenStore.set(data.accessToken, data.refreshToken);
      setUser(data.user);
      setLoyalty(data.loyalty || null);
      toast.success(data.message);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // A link with no token in it — someone opened the page directly, or an
  // email client mangled the URL.
  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card fade-in center">
          <div className="empty-icon">🔑</div>
          <h1 style={{ fontSize: '1.4rem' }}>That link is incomplete</h1>
          <p className="text-soft" style={{ margin: '10px 0 20px' }}>
            The reset link seems to have been cut short. Ask for a new one and open it
            directly from the email.
          </p>
          <Link to="/forgot-password" className="btn btn-primary btn-block">Request a new link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card fade-in">
        <Link to="/" className="logo" style={{ color: 'var(--text)', justifyContent: 'center', marginBottom: 6 }}>
          <span className="logo-mark">GO</span> GameOn
        </Link>
        <h1 style={{ fontSize: '1.5rem', textAlign: 'center' }}>Choose a new password</h1>
        <p className="text-soft center" style={{ marginBottom: 22 }}>
          You&apos;ll be signed in here and signed out everywhere else.
        </p>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <span>
              {error}
              {/^that reset link/i.test(error) && (
                <> <Link to="/forgot-password" style={{ textDecoration: 'underline' }}>Request a new one</Link>.</>
              )}
            </span>
          </div>
        )}

        <form onSubmit={submit} className="stack gap-16">
          <div className="field">
            <label className="label" htmlFor="rp-pass">New password</label>
            <input
              id="rp-pass" type="password" className={`input${tooShort || noLetter || noDigit ? ' error' : ''}`}
              required minLength={8} maxLength={128} autoComplete="new-password" autoFocus
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
            <span className={tooShort || noLetter || noDigit ? 'field-error' : 'text-faint'}>
              At least 8 characters, including a letter and a number.
            </span>
          </div>

          <div className="field">
            <label className="label" htmlFor="rp-confirm">Confirm password</label>
            <input
              id="rp-confirm" type="password" className={`input${mismatch ? ' error' : ''}`}
              required maxLength={128} autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="Type it again"
            />
            {mismatch && <span className="field-error">Those two do not match.</span>}
          </div>

          <button className="btn btn-primary btn-block btn-lg" disabled={busy || !valid}>
            {busy ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Set new password'}
          </button>
        </form>

        <p className="center text-soft" style={{ marginTop: 20 }}>
          Remembered it? <Link to="/login" style={{ color: 'var(--violet)', fontWeight: 700 }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}
