import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { playgroundApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import useGeolocation from '../hooks/useGeolocation.js';
import SportIcon from '../components/SportIcon.jsx';
import {
  SPORT_LABELS, PLAYGROUND_FACILITY_LABELS, SURFACE_LABELS,
} from '../utils/format.js';
import { IconArrowLeft, IconLocate, IconCheck, IconInfo } from '../components/Icons.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball', 'tabletennis'];
const FACILITIES = Object.keys(PLAYGROUND_FACILITY_LABELS);
const SURFACES = Object.keys(SURFACE_LABELS);

/**
 * Adding a free public ground.
 *
 * Kept deliberately short. The contributor is most likely standing at the
 * gate on a phone, and every extra field is a reason to give up — so the
 * only hard requirements are a name, a sport and a location, and the button
 * that fills the location in is the one they will actually use.
 */
export default function PlaygroundNew() {
  const navigate = useNavigate();
  const toast = useToast();
  const { request: requestLocation, isLoading: locating } = useGeolocation();

  const [form, setForm] = useState({
    name: '', description: '',
    area: '', city: '', line1: '', pincode: '',
    lat: '', lng: '',
    alwaysOpen: false, opensAt: '06:00', closesAt: '20:00', notes: '',
    surface: 'other',
  });
  const [sports, setSports] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  /**
   * Updater form, not the captured array. Reading `list` from the closure
   * means two toggles in one render both start from the same stale value and
   * the first one is lost — which is exactly what happens when the sports are
   * set programmatically, and what a fast double-tap can do by hand.
   */
  const toggle = (setList, v) =>
    setList((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  const useMyLocation = async () => {
    const c = await requestLocation();
    if (c) {
      set({ lat: String(c.lat), lng: String(c.lng) });
      toast.success('Location captured.');
    } else {
      toast.error('Could not get your location. You can paste coordinates instead.');
    }
  };

  const validate = () => {
    const e = {};
    if (form.name.trim().length < 3) e.name = 'Give it a name people would recognise';
    if (!sports.length) e.sports = 'Pick at least one sport';
    const lat = Number(form.lat); const lng = Number(form.lng);
    if (form.lat === '' || form.lng === '' || Number.isNaN(lat) || Number.isNaN(lng)) {
      e.location = 'Set the location — stand at the ground and tap the button, or paste coordinates';
    } else if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      e.location = 'Those coordinates are out of range';
    }
    if (!form.alwaysOpen && form.opensAt && form.closesAt && form.opensAt === form.closesAt) {
      e.access = 'Opening and closing time cannot be the same';
    }
    return e;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    setError('');
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) { setError('Please fix the highlighted fields.'); return; }

    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        sports,
        lat: Number(form.lat),
        lng: Number(form.lng),
        surface: form.surface,
        access: {
          alwaysOpen: form.alwaysOpen,
          // Blank rather than a leftover time, or a 24-hour ground shows hours.
          opensAt: form.alwaysOpen ? '' : form.opensAt,
          closesAt: form.alwaysOpen ? '' : form.closesAt,
          notes: form.notes.trim(),
        },
      };
      if (form.description.trim()) payload.description = form.description.trim();
      if (facilities.length) payload.facilities = facilities;

      const address = {
        line1: form.line1.trim(), area: form.area.trim(),
        city: form.city.trim(), pincode: form.pincode.trim(),
      };
      if (Object.values(address).some(Boolean)) payload.address = address;

      const { data } = await playgroundApi.create(payload);
      toast.success(data.message);
      navigate('/playgrounds/mine', { replace: true });
    } catch (err) {
      // The duplicate and quota refusals are the useful ones, and they read
      // as sentences — show them as-is rather than a generic failure.
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container section fade-in" style={{ maxWidth: 760 }}>
      <Link to="/playgrounds" className="link-btn row gap-6" style={{ marginBottom: 16 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> Back to free grounds
      </Link>

      <div className="page-head">
        <span className="eyebrow">Community</span>
        <h1 style={{ marginTop: 8 }}>Add a free ground</h1>
        <p className="text-soft">
          A park, maidan or community ground that anyone can use for nothing. We check
          each one before it goes on the map, and you&rsquo;ll get a notification either way.
        </p>
      </div>

      <div className="alert alert-info" style={{ marginBottom: 20 }}>
        <IconInfo style={{ width: 16, height: 16, flexShrink: 0 }} />
        <span>
          Only add places that are genuinely free and open to the public. If a
          ground charges, has an owner or needs membership, list it as a venue
          instead so it can take bookings.
        </span>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 18 }}><span>{error}</span></div>}

      <form onSubmit={submit} className="stack gap-18">
        <section className="card card-pad stack gap-14">
          <h3>The basics</h3>

          <div className="field">
            <label className="label" htmlFor="pg-name">What is it called?</label>
            <input
              id="pg-name" className="input" value={form.name} maxLength={120}
              placeholder="Nehru Community Ground"
              onChange={(e) => set({ name: e.target.value })}
            />
            {errors.name && <span className="field-error">{errors.name}</span>}
          </div>

          <div className="field">
            <span className="label">What can you play there?</span>
            <div className="chip-row" style={{ marginTop: 6 }}>
              {SPORTS.map((s) => (
                <button
                  type="button" key={s}
                  className={`pill${sports.includes(s) ? ' active' : ''}`}
                  onClick={() => toggle(setSports, s)}
                >
                  <SportIcon sport={s} size={15} /> {SPORT_LABELS[s]}
                </button>
              ))}
            </div>
            {errors.sports && <span className="field-error">{errors.sports}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="pg-desc">Anything worth knowing? (optional)</label>
            <textarea
              id="pg-desc" className="input" rows={3} maxLength={1500}
              placeholder="Concrete cricket strip, no nets. Gets busy after 6pm."
              value={form.description} onChange={(e) => set({ description: e.target.value })}
            />
          </div>
        </section>

        <section className="card card-pad stack gap-14">
          <h3>Where is it?</h3>

          <button type="button" className="btn btn-primary" onClick={useMyLocation} disabled={locating}>
            {locating
              ? <span className="spinner" style={{ width: 16, height: 16 }} />
              : <IconLocate style={{ width: 16, height: 16 }} />}
            {form.lat ? 'Update to where I am' : 'I am standing here'}
          </button>

          {form.lat && (
            <p className="text-soft" style={{ fontSize: '.9rem' }}>
              <IconCheck style={{ width: 14, height: 14, verticalAlign: '-2px', color: 'var(--success)' }} />{' '}
              Pinned at {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}
            </p>
          )}

          <div className="grid-2 gap-12">
            <div className="field">
              <label className="label" htmlFor="pg-lat">Latitude</label>
              <input id="pg-lat" className="input" value={form.lat} onChange={(e) => set({ lat: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="pg-lng">Longitude</label>
              <input id="pg-lng" className="input" value={form.lng} onChange={(e) => set({ lng: e.target.value })} />
            </div>
          </div>
          {errors.location && <span className="field-error">{errors.location}</span>}

          <div className="grid-2 gap-12">
            <div className="field">
              <label className="label" htmlFor="pg-area">Area / locality</label>
              <input id="pg-area" className="input" value={form.area} onChange={(e) => set({ area: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="pg-city">City</label>
              <input id="pg-city" className="input" value={form.city} onChange={(e) => set({ city: e.target.value })} />
            </div>
          </div>
        </section>

        <section className="card card-pad stack gap-14">
          <h3>When can you get in?</h3>
          <p className="text-soft" style={{ fontSize: '.92rem', marginTop: -6 }}>
            Free does not always mean open — park gates shut, school grounds are
            locked in term time. Saying so saves somebody a wasted trip.
          </p>

          <label className="check-row">
            <input
              type="checkbox" checked={form.alwaysOpen}
              onChange={(e) => set({ alwaysOpen: e.target.checked })}
            />
            <span>Open all hours — no gate, no closing time</span>
          </label>

          {!form.alwaysOpen && (
            <div className="grid-2 gap-12">
              <div className="field">
                <label className="label" htmlFor="pg-open">Opens</label>
                <input id="pg-open" type="time" className="input" value={form.opensAt}
                  onChange={(e) => set({ opensAt: e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="pg-close">Closes</label>
                <input id="pg-close" type="time" className="input" value={form.closesAt}
                  onChange={(e) => set({ closesAt: e.target.value })} />
              </div>
            </div>
          )}
          {errors.access && <span className="field-error">{errors.access}</span>}

          <div className="field">
            <label className="label" htmlFor="pg-notes">Access notes (optional)</label>
            <input
              id="pg-notes" className="input" maxLength={300}
              placeholder="Enter from the east gate; the main one is usually locked."
              value={form.notes} onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
        </section>

        <section className="card card-pad stack gap-14">
          <h3>What is there?</h3>

          <div className="field">
            <label className="label" htmlFor="pg-surface">Surface</label>
            <select
              id="pg-surface" className="select" value={form.surface}
              onChange={(e) => set({ surface: e.target.value })}
            >
              {SURFACES.map((s) => <option key={s} value={s}>{SURFACE_LABELS[s]}</option>)}
            </select>
          </div>

          <div className="field">
            <span className="label">Facilities (optional)</span>
            <div className="chip-row" style={{ marginTop: 6 }}>
              {FACILITIES.map((f) => (
                <button
                  type="button" key={f}
                  className={`pill${facilities.includes(f) ? ' active' : ''}`}
                  onClick={() => toggle(setFacilities, f)}
                >
                  {PLAYGROUND_FACILITY_LABELS[f]}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="row gap-12 wrap">
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 17, height: 17 }} /> : 'Send for review'}
          </button>
          <Link to="/playgrounds" className="btn btn-ghost btn-lg">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
