import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

const DEMOS = [
  { label: 'Demo player', email: 'aayan@gameon.app', password: 'player123' },
  { label: 'Demo venue owner', email: 'shivanshu@gameon.app', password: 'owner123' },
];

/**
 * One-tap demo logins, shown in development and on a deliberately-flagged
 * demo deployment — never on a real one by default.
 *
 * These credentials are published in this repository. Printing them on the
 * login page of a live site hands anybody who visits it a venue-owner account:
 * the owner dashboard, that venue's customer list with names and phone
 * numbers, its revenue, and the ability to confirm or reject other people's
 * bookings. Set VITE_SHOW_DEMO_LOGINS=true to bring them back for a demo
 * build, and delete or re-password the seeded accounts before going live.
 */
const SHOW_DEMOS = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_LOGINS === 'true';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname || '/';

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await login(form.email, form.password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const signInWithDemo = async (demo) => {
    setForm({ email: demo.email, password: demo.password });
    setBusy(true); setError('');
    try {
      await login(demo.email, demo.password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-card fade-in">
        <Link to="/" className="logo" style={{ color: 'var(--text)', justifyContent: 'center', marginBottom: 6 }}>
          <span className="logo-mark">GO</span> GameOn
        </Link>
        <h1 style={{ fontSize: '1.6rem', textAlign: 'center' }}>Welcome back</h1>
        <p className="text-soft center" style={{ marginBottom: 22 }}>Log in to book slots and join games.</p>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        <form onSubmit={submit} className="stack gap-16">
          <div className="field">
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email" type="email" className="input" required autoComplete="email"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">Password</label>
            <PasswordInput
              id="password" required autoComplete="current-password"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
            />
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Log in'}
          </button>

          <p className="center">
            <Link to="/forgot-password" className="link-btn">Forgot your password?</Link>
          </p>
        </form>

        {SHOW_DEMOS && (
          <>
            <div className="auth-divider"><span>or try a demo account</span></div>
            <div className="stack gap-8">
              {DEMOS.map((d) => (
                <button key={d.email} type="button" className="btn btn-ghost btn-block" onClick={() => signInWithDemo(d)} disabled={busy}>
                  {d.label}
                </button>
              ))}
            </div>
          </>
        )}

        <p className="center text-soft" style={{ marginTop: 20 }}>
          New here? <Link to="/register" style={{ color: 'var(--violet)', fontWeight: 700 }}>Create an account</Link>
        </p>
      </div>
    </div>
  );
}
