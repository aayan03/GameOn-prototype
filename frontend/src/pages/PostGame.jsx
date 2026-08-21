import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { teamUpApi, bookingApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import useGeolocation from '../hooks/useGeolocation.js';
import { SPORT_ICONS, SPORT_LABELS } from '../utils/format.js';
import { prettyDate, slotRangeLabel } from '../utils/date.js';
import { IconArrowLeft, IconLocate, IconCheck } from '../components/Icons.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball', 'pickleball', 'tabletennis'];
const TYPES = [
  { v: 'need_players', label: 'Need players', hint: "We've got a slot, short on people" },
  { v: 'need_opponent', label: 'Need opponent', hint: 'Full team, need someone to play against' },
  { v: 'looking_to_join', label: 'Looking to join', hint: 'Solo player, free to play' },
];
const LEVELS = ['any', 'beginner', 'intermediate', 'advanced', 'pro'];

export default function PostGame() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const { coords, request, isLoading: locating } = useGeolocation();

  const groupRefParam = params.get('groupRef') || '';
  const [mode, setMode] = useState(groupRefParam ? 'booking' : 'standalone');

  const [bookings, setBookings] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [groupRef, setGroupRef] = useState(groupRefParam);

  const [form, setForm] = useState({
    type: 'need_players',
    sport: params.get('sport') || user?.favoriteSports?.[0] || 'football',
    title: '', description: '', spotsNeeded: 3, skillLevel: 'any',
    genderPreference: 'any', autoApprove: false,
    costSharingEnabled: true, costTotalAmount: '',
    proposedArea: user?.city || '', playAt: '', durationMins: 60,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    bookingApi.mine()
      .then(({ data }) => {
        const upcoming = (data.upcoming || []).filter((b) => new Date(b.startsAt) > new Date());
        setBookings(upcoming);
        if (!groupRefParam && upcoming.length) setGroupRef((g) => g || upcoming[0].groupRef);
      })
      .catch(() => {})
      .finally(() => setBookingsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedBooking = useMemo(() => bookings.find((b) => b.groupRef === groupRef), [bookings, groupRef]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const payload = {
        type: form.type,
        title: form.title.trim(),
        description: form.description.trim(),
        spotsNeeded: Number(form.spotsNeeded),
        skillLevel: form.skillLevel,
        genderPreference: form.genderPreference,
        autoApprove: form.autoApprove,
        costSharingEnabled: form.costSharingEnabled,
      };
      if (form.costTotalAmount) payload.costTotalAmount = Number(form.costTotalAmount);

      if (mode === 'booking') {
        if (!groupRef) throw new Error('Pick a booking to link this game to');
        payload.groupRef = groupRef;
        payload.sport = selectedBooking?.sport;
      } else {
        if (!form.playAt) throw new Error('Pick a date and time');
        payload.sport = form.sport;
        payload.proposedArea = form.proposedArea;
        payload.playAt = new Date(form.playAt).toISOString();
        payload.durationMins = Number(form.durationMins);
        const c = coords || (await request());
        if (!c) throw new Error('Share your location, or link a booking instead');
        payload.lat = c.lat;
        payload.lng = c.lng;
      }

      const { data } = await teamUpApi.create(payload);
      toast.success('Posted! Nearby players will see it.');
      navigate(`/teamup/${data._id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container section fade-in" style={{ maxWidth: 720 }}>
      <Link to="/teamup" className="link-btn row gap-6" style={{ marginBottom: 18 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> TeamUp
      </Link>

      <div className="page-head">
        <h1>Post a game</h1>
        <p className="text-soft">Link it to a booking you already hold, or start from scratch.</p>
      </div>

      <form onSubmit={submit} className="card card-pad stack gap-18">
        <div className="field">
          <span className="label">What are you posting?</span>
          <div className="row gap-8 wrap">
            {TYPES.map((t) => (
              <button
                key={t.v} type="button" title={t.hint}
                className={`pill${form.type === t.v ? ' active' : ''}`}
                onClick={() => set({ type: t.v })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Source</span>
          <div className="row gap-8">
            <button type="button" className={`pill${mode === 'booking' ? ' active' : ''}`} onClick={() => setMode('booking')}>
              From a booking
            </button>
            <button type="button" className={`pill${mode === 'standalone' ? ' active' : ''}`} onClick={() => setMode('standalone')}>
              Standalone
            </button>
          </div>
        </div>

        {mode === 'booking' ? (
          bookingsLoading ? (
            <div className="skeleton" style={{ height: 52 }} />
          ) : bookings.length ? (
            <div className="field">
              <label className="label" htmlFor="pg-booking">Which booking?</label>
              <select id="pg-booking" className="select" value={groupRef} onChange={(e) => setGroupRef(e.target.value)}>
                {bookings.map((b) => (
                  <option key={b.groupRef} value={b.groupRef}>
                    {b.venue?.name} · {prettyDate(b.date)} · {slotRangeLabel(b.slots)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="alert alert-info">
              You don't have an upcoming booking to link. Book a slot first, or switch to Standalone.
            </div>
          )
        ) : (
          <>
            <div className="field">
              <span className="label">Sport</span>
              <div className="row gap-8 wrap">
                {SPORTS.map((s) => (
                  <button
                    key={s} type="button"
                    className={`pill${form.sport === s ? ' active' : ''}`}
                    onClick={() => set({ sport: s })}
                  >
                    {SPORT_ICONS[s]} {SPORT_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label className="label" htmlFor="pg-area">Area</label>
                <input
                  id="pg-area" className="input" placeholder="Koramangala, Bengaluru"
                  value={form.proposedArea} onChange={(e) => set({ proposedArea: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="pg-when">Date & time</label>
                <input
                  id="pg-when" type="datetime-local" className="input"
                  value={form.playAt} onChange={(e) => set({ playAt: e.target.value })} required
                />
              </div>
            </div>

            <div className="field">
              <span className="label">Location</span>
              <button type="button" className={`btn btn-sm ${coords ? 'btn-dark' : 'btn-ghost'}`} onClick={request} disabled={locating}>
                {locating ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <IconLocate style={{ width: 15, height: 15 }} />}
                {coords ? 'Location set' : 'Use my location'}
              </button>
            </div>
          </>
        )}

        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="pg-title">Title</label>
            <input
              id="pg-title" className="input" maxLength={120} placeholder="Need 4 for 7-a-side"
              value={form.title} onChange={(e) => set({ title: e.target.value })} required
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="pg-spots">Spots needed</label>
            <input
              id="pg-spots" type="number" min={1} max={30} className="input"
              value={form.spotsNeeded} onChange={(e) => set({ spotsNeeded: e.target.value })} required
            />
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="pg-desc">Description (optional)</label>
          <textarea
            id="pg-desc" className="textarea" maxLength={1000}
            placeholder="Skill level, what to bring, anything else players should know…"
            value={form.description} onChange={(e) => set({ description: e.target.value })}
          />
        </div>

        <div className="grid-2">
          <div className="field">
            <span className="label">Skill level</span>
            <select className="select" value={form.skillLevel} onChange={(e) => set({ skillLevel: e.target.value })}>
              {LEVELS.map((l) => <option key={l} value={l}>{l === 'any' ? 'Any level' : l[0].toUpperCase() + l.slice(1)}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="label">Gender preference</span>
            <select className="select" value={form.genderPreference} onChange={(e) => set({ genderPreference: e.target.value })}>
              <option value="any">Anyone</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label className="checkbox-row">
            <input type="checkbox" checked={form.costSharingEnabled} onChange={(e) => set({ costSharingEnabled: e.target.checked })} />
            <span>Split the cost across everyone who joins</span>
          </label>
          {form.costSharingEnabled && (
            <input
              className="input" type="number" min={0}
              placeholder={mode === 'booking' && selectedBooking ? `Defaults to ₹${selectedBooking.totalAmount}` : 'Total cost (optional)'}
              value={form.costTotalAmount} onChange={(e) => set({ costTotalAmount: e.target.value })}
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={form.autoApprove} onChange={(e) => set({ autoApprove: e.target.checked })} />
          <span>Auto-approve join requests (first come, first in)</span>
        </label>

        {error && <div className="alert alert-error">{error}</div>}

        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <><IconCheck style={{ width: 17, height: 17 }} /> Post game</>}
        </button>
      </form>
    </div>
  );
}
