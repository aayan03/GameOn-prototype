import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { SPORT_ICONS, SPORT_LABELS } from '../utils/format.js';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball'];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [form, setForm] = useState({
    name: '', email: '', password: '', phone: '', city: '',
    role: params.get('role') === 'owner' ? 'owner' : 'player',
    favoriteSports: [],
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const toggleSport = (s) => setForm((f) => ({
    ...f,
    favoriteSports: f.favoriteSports.includes(s)
      ? f.favoriteSports.filter((x) => x !== s)
      : [...f.favoriteSports, s],
  }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setFieldErrors({});
    try {
      const payload = { ...form };
      if (!payload.phone) delete payload.phone;
      if (!payload.city) delete payload.city;
      if (!payload.favoriteSports.length) delete payload.favoriteSports;
      const user = await register(payload);
      navigate(user.role === 'owner' ? '/owner' : '/', { replace: true });
    } catch (err) {
      setError(err.message);
      if (err.details) setFieldErrors(err.details);
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-card fade-in">
        <Link to="/" className="logo" style={{ color: 'var(--text)', justifyContent: 'center', marginBottom: 6 }}>
          <span className="logo-mark">GO</span> GameOn
        </Link>
        <h1 style={{ fontSize: '1.6rem', textAlign: 'center' }}>Create your account</h1>
        <p className="text-soft center" style={{ marginBottom: 22 }}>It takes about thirty seconds.</p>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="role-toggle">
          {[
            { v: 'player', label: "I'm a player", sub: 'Book slots & join games' },
            { v: 'owner', label: 'I run a venue', sub: 'List turfs & take bookings' },
          ].map((r) => (
            <button
              key={r.v} type="button"
              className={`role-opt${form.role === r.v ? ' active' : ''}`}
              onClick={() => setForm({ ...form, role: r.v })}
            >
              <strong>{r.label}</strong>
              <span>{r.sub}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="stack gap-14" style={{ marginTop: 18 }}>
          <div className="field">
            <label className="label" htmlFor="name">Full name</label>
            <input
              id="name" className={`input${fieldErrors.name ? ' error' : ''}`} required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Aayan Ahmed"
            />
            {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="r-email">Email</label>
            <input
              id="r-email" type="email" className={`input${fieldErrors.email ? ' error' : ''}`} required
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
            />
            {fieldErrors.email && <span className="field-error">{fieldErrors.email}</span>}
          </div>

          <div className="grid-2">
            <div className="field">
              <label className="label" htmlFor="phone">Phone (optional)</label>
              <input
                id="phone" className={`input${fieldErrors.phone ? ' error' : ''}`} inputMode="numeric" maxLength={10}
                value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })}
                placeholder="9876543210"
              />
              {fieldErrors.phone && <span className="field-error">{fieldErrors.phone}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="city">City (optional)</label>
              <input
                id="city" className="input" value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Bengaluru"
              />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="r-pass">Password</label>
            {/* These rules must match auth.controller.js#registerSchema. The
                form used to advertise "at least 6 characters" while the API
                required eight plus a letter and a number, so a valid-looking
                password was accepted by the browser and then rejected by the
                server with no hint as to which rule it broke. */}
            <input
              id="r-pass" type="password" className={`input${fieldErrors.password ? ' error' : ''}`}
              required minLength={8} maxLength={128} autoComplete="new-password"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 8 characters"
              aria-describedby="pass-hint"
            />
            {fieldErrors.password
              ? <span className="field-error">{fieldErrors.password}</span>
              : <span id="pass-hint" className="text-faint">At least 8 characters, including a letter and a number.</span>}
          </div>

          {form.role === 'player' && (
            <div className="field">
              <span className="label">Sports you play (helps TeamUp match you)</span>
              <div className="row gap-8 wrap">
                {SPORTS.map((s) => (
                  <button
                    key={s} type="button"
                    className={`pill${form.favoriteSports.includes(s) ? ' active' : ''}`}
                    onClick={() => toggleSport(s)}
                  >
                    {SPORT_ICONS[s]} {SPORT_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Create account'}
          </button>
        </form>

        <p className="center text-soft" style={{ marginTop: 18 }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--violet)', fontWeight: 700 }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}
