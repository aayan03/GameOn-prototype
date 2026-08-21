import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import useGeolocation from '../hooks/useGeolocation.js';
import { initials, rupees, SPORT_ICONS, SPORT_LABELS } from '../utils/format.js';
import { IconLocate, IconCheck } from '../components/Icons.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball', 'pickleball', 'tabletennis'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'pro'];

export default function Profile() {
  const { user, updateProfile, logout } = useAuth();
  const { request, isLoading: locating } = useGeolocation();
  const [form, setForm] = useState({
    name: user.name, phone: user.phone || '', city: user.city || '',
    bio: user.bio || '', position: user.position || '',
    skillLevel: user.skillLevel || 'beginner',
    favoriteSports: user.favoriteSports || [],
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggleSport = (s) => setForm((f) => ({
    ...f,
    favoriteSports: f.favoriteSports.includes(s)
      ? f.favoriteSports.filter((x) => x !== s) : [...f.favoriteSports, s],
  }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setSaved(false);
    try {
      const payload = { ...form };
      if (!payload.phone) delete payload.phone;
      await updateProfile(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2600);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const saveLocation = async () => {
    const c = await request();
    if (!c) return;
    try {
      await updateProfile({ lastLocation: { lat: c.lat, lng: c.lng } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2600);
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="container section fade-in" style={{ maxWidth: 780 }}>
      <div className="profile-head">
        <div className="avatar" style={{ width: 68, height: 68, fontSize: '1.4rem' }}>{initials(user.name)}</div>
        <div className="grow">
          <h1 style={{ fontSize: '1.7rem' }}>{user.name}</h1>
          <p className="text-soft">{user.email}</p>
          <div className="row gap-8 wrap" style={{ marginTop: 8 }}>
            <span className="badge badge-violet">{user.role === 'owner' ? 'Venue owner' : 'Player'}</span>
            {user.city && <span className="badge badge-soft">{user.city}</span>}
          </div>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat"><strong>{rupees(user.walletBalance)}</strong><span>Wallet</span></div>
        <div className="stat"><strong>{user.loyaltyPoints}</strong><span>Points</span></div>
        <div className="stat"><strong>{user.gamesPlayed}</strong><span>Games played</span></div>
        <div className="stat"><strong>{user.reliabilityScore}%</strong><span>Reliability</span></div>
      </div>

      {saved && <div className="alert alert-success" style={{ marginTop: 18 }}><IconCheck style={{ width: 17, height: 17 }} /> Saved</div>}
      {error && <div className="alert alert-error" style={{ marginTop: 18 }}>{error}</div>}

      <form onSubmit={save} className="card card-pad stack gap-16" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: '1.15rem' }}>Your details</h2>

        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="p-name">Name</label>
            <input id="p-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-phone">Phone</label>
            <input
              id="p-phone" className="input" inputMode="numeric" maxLength={10} value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="p-city">City</label>
            <input id="p-city" className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-pos">Preferred position</label>
            <input
              id="p-pos" className="input" placeholder="Goalkeeper, opening batter…"
              value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <span className="label">Skill level</span>
          <div className="row gap-8 wrap">
            {LEVELS.map((l) => (
              <button
                key={l} type="button"
                className={`pill${form.skillLevel === l ? ' active' : ''}`}
                onClick={() => setForm({ ...form, skillLevel: l })}
                style={{ textTransform: 'capitalize' }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Sports you play</span>
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

        <div className="field">
          <label className="label" htmlFor="p-bio">Short bio</label>
          <textarea
            id="p-bio" className="textarea" maxLength={300} placeholder="Weekend footballer, play mostly in Koramangala…"
            value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
          <span className="text-faint">{form.bio.length}/300</span>
        </div>

        <div className="row gap-12 wrap">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 15, height: 15 }} /> : 'Save changes'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={saveLocation} disabled={locating}>
            <IconLocate style={{ width: 15, height: 15 }} />
            {locating ? 'Getting location…' : 'Update my location'}
          </button>
        </div>
      </form>

      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div className="between gap-16 wrap">
          <div>
            <strong>Log out</strong>
            <p className="text-soft">You'll need to sign in again to book slots.</p>
          </div>
          <button className="btn btn-ghost" onClick={logout} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
            Log out
          </button>
        </div>
      </div>

      {user.role === 'owner' && (
        <Link to="/owner" className="btn btn-dark btn-block btn-lg" style={{ marginTop: 18 }}>
          Go to venue dashboard
        </Link>
      )}
    </div>
  );
}
