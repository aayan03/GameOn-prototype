import { useEffect, useState } from 'react';
import { teamupApi, bookingApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { SPORT_LABELS, rupees } from '../utils/format.js';
import { prettyDate, slotRangeLabel, dateKey } from '../utils/date.js';
import { IconClose, IconSparkle } from './Icons.jsx';
import SportIcon from './SportIcon.jsx';

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball', 'pickleball', 'tabletennis'];
const LEVELS = ['any', 'beginner', 'intermediate', 'advanced', 'pro'];

const TYPES = [
  { v: 'need_players', label: 'Need players', hint: "We have a game, we're short a few people" },
  { v: 'need_opponent', label: 'Need an opponent', hint: "Full team, looking for another team" },
  { v: 'looking_to_join', label: 'Looking to join', hint: "I'm free and want in on a game" },
];

/** Rounds to the next half hour, so the default time is always plausible. */
function defaultDateTime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 90, 0, 0);
  d.setMinutes(d.getMinutes() >= 30 ? 30 : 0);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export default function CreateGameModal({ onClose, onCreated }) {
  const toast = useToast();
  const dt = defaultDateTime();

  const [form, setForm] = useState({
    type: 'need_players',
    sport: 'football',
    title: '',
    description: '',
    date: dt.date,
    time: dt.time,
    durationMins: 60,
    spotsNeeded: 4,
    skillLevel: 'any',
    proposedArea: '',
    bookingRef: '',
    costEnabled: false,
    totalAmount: 0,
    autoApprove: false,
  });

  const [bookings, setBookings] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Offer the user's own upcoming bookings so a game can be attached to a
  // slot they already hold — that's the common case for "we're short".
  useEffect(() => {
    bookingApi.mine()
      .then(({ data }) => setBookings(data.upcoming || []))
      .catch(() => setBookings([]));
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, busy]);

  const pickBooking = (b) => {
    if (form.bookingRef === b.groupRef) {
      set({ bookingRef: '', totalAmount: 0, costEnabled: false });
      return;
    }
    set({
      bookingRef: b.groupRef,
      sport: b.sport,
      date: b.date,
      time: new Date(b.startsAt).toTimeString().slice(0, 5),
      proposedArea: b.venue?.address?.area || '',
      totalAmount: b.totalAmount,
      costEnabled: true,
      title: form.title || `${SPORT_LABELS[b.sport]} at ${b.venue?.name || 'our venue'}`,
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setFieldErrors({});

    /**
     * Parsed in the BROWSER's timezone, not the venue's.
     *
     * A date-time string with no offset is local time by definition, and
     * `.toISOString()` below then converts it to UTC using whatever zone the
     * phone is set to. That is correct for everyone in the country this app
     * serves, and quietly wrong for a host who sets a game while travelling —
     * they would pick 6pm and create it at 6pm wherever they are standing.
     *
     * The API is careful about this (APP_TIMEZONE, and utils/time.js runs the
     * slot grid on the venue clock); this one input is not. Worth fixing
     * alongside anything else that assumes a single timezone.
     */
    const playAt = new Date(`${form.date}T${form.time}:00`);
    if (Number.isNaN(playAt.getTime())) { setError('Enter a valid date and time'); setBusy(false); return; }
    if (playAt <= new Date()) { setError('Pick a kickoff time in the future'); setBusy(false); return; }

    const payload = {
      type: form.type,
      sport: form.sport,
      title: form.title.trim(),
      playAt: playAt.toISOString(),
      durationMins: Number(form.durationMins),
      spotsNeeded: Number(form.spotsNeeded),
      skillLevel: form.skillLevel,
      autoApprove: form.autoApprove,
    };
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.proposedArea.trim()) payload.proposedArea = form.proposedArea.trim();
    if (form.bookingRef) payload.bookingRef = form.bookingRef;
    if (form.costEnabled && form.totalAmount > 0) {
      payload.costSharing = { enabled: true, totalAmount: Number(form.totalAmount) };
    }

    try {
      await teamupApi.create(payload);
      toast.success('Game posted. Nearby players can see it now.');
      onCreated();
    } catch (err) {
      setError(err.message);
      if (err.details) setFieldErrors(err.details);
      setBusy(false);
    }
  };

  /**
   * What each joiner pays. The `+ 1` is the host, who is playing too.
   *
   * Splitting by spotsNeeded alone would divide the pitch among the guests
   * and let the host in free, which is not what "split the cost" means to
   * anybody. Rounded UP so the total collected covers the slot rather than
   * leaving the host a few rupees short — the server charges each player the
   * share they agreed to at join time, so this figure is what they are
   * agreeing to, and it must not be optimistic.
   */
  const perPerson = form.costEnabled && form.totalAmount > 0
    ? Math.ceil(form.totalAmount / (Number(form.spotsNeeded) + 1))
    : 0;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="cg-title">
        <div className="modal-head">
          <h3 id="cg-title">Post a game</h3>
          <button className="icon-btn bare" onClick={onClose} disabled={busy} aria-label="Close">
            <IconClose style={{ width: 20, height: 20 }} />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: 'contents' }}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}

            <div className="field">
              <span className="label">What do you need?</span>
              <div className="type-grid">
                {TYPES.map((t) => (
                  <button
                    key={t.v} type="button"
                    className={`role-opt${form.type === t.v ? ' active' : ''}`}
                    onClick={() => set({ type: t.v })}
                  >
                    <strong>{t.label}</strong>
                    <span>{t.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {bookings.length > 0 && (
              <div className="field">
                <span className="label">Link one of your bookings (optional)</span>
                <p className="text-faint" style={{ marginTop: -3 }}>
                  Attaching a booking fills in the venue, time and cost automatically.
                </p>
                <div className="stack gap-8">
                  {bookings.slice(0, 4).map((b) => (
                    <button
                      key={b.groupRef} type="button"
                      className={`pay-opt${form.bookingRef === b.groupRef ? ' active' : ''}`}
                      onClick={() => pickBooking(b)}
                    >
                      <span className="pay-icon"><SportIcon sport={b.sport} size={18} /></span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <strong style={{ display: 'block' }}>{b.venue?.name}</strong>
                        <span className="text-faint">
                          {prettyDate(b.date)} · {slotRangeLabel(b.slots)} · {rupees(b.totalAmount)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="cg-sport">Sport</label>
              <div className="row gap-8 wrap">
                {SPORTS.map((s) => (
                  <button
                    key={s} type="button"
                    className={`pill${form.sport === s ? ' active' : ''}`}
                    onClick={() => set({ sport: s })}
                  >
                    <SportIcon sport={s} size={16} /> {SPORT_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="cg-title-in">Title</label>
              <input
                id="cg-title-in"
                className={`input${fieldErrors.title ? ' error' : ''}`}
                placeholder="Sunday 5-a-side, need 3 more"
                value={form.title} onChange={(e) => set({ title: e.target.value })}
                maxLength={120} required
              />
              {fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}
            </div>

            <div className="grid-2">
              <div className="field">
                <label className="label" htmlFor="cg-date">Date</label>
                <input
                  id="cg-date" type="date" className="input" required
                  min={dateKey()} value={form.date} onChange={(e) => set({ date: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="cg-time">Kickoff</label>
                <input
                  id="cg-time" type="time" className="input" required
                  value={form.time} onChange={(e) => set({ time: e.target.value })}
                />
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label className="label" htmlFor="cg-spots">Players needed</label>
                <input
                  id="cg-spots" type="number" className="input" min={1} max={30} required
                  value={form.spotsNeeded}
                  onChange={(e) => set({ spotsNeeded: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="cg-dur">Duration</label>
                <select
                  id="cg-dur" className="select" value={form.durationMins}
                  onChange={(e) => set({ durationMins: Number(e.target.value) })}
                >
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                </select>
              </div>
            </div>

            <div className="field">
              <span className="label">Skill level</span>
              <div className="row gap-8 wrap">
                {LEVELS.map((l) => (
                  <button
                    key={l} type="button"
                    className={`pill${form.skillLevel === l ? ' active' : ''}`}
                    onClick={() => set({ skillLevel: l })}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {l === 'any' ? 'Any level' : l}
                  </button>
                ))}
              </div>
            </div>

            {!form.bookingRef && (
              <div className="field">
                <label className="label" htmlFor="cg-area">Area</label>
                <input
                  id="cg-area" className="input" placeholder="Gomti Nagar, Koramangala…"
                  value={form.proposedArea} onChange={(e) => set({ proposedArea: e.target.value })}
                  maxLength={120}
                />
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="cg-desc">Anything else? (optional)</label>
              <textarea
                id="cg-desc" className="textarea" maxLength={1000}
                placeholder="Bring your own bibs. We usually play two 30-minute halves."
                value={form.description} onChange={(e) => set({ description: e.target.value })}
              />
            </div>

            <div className="card card-pad card-volt">
              <label className="checkbox-row" style={{ padding: 0, border: 0 }}>
                <input
                  type="checkbox" checked={form.costEnabled}
                  onChange={(e) => set({ costEnabled: e.target.checked })}
                />
                <span><IconSparkle style={{ width: 15, height: 15 }} /> Split the cost</span>
              </label>

              {form.costEnabled && (
                <div style={{ marginTop: 14 }}>
                  <div className="field">
                    <label className="label" htmlFor="cg-total">Total slot cost</label>
                    <input
                      id="cg-total" type="number" className="input" min={0} max={100000}
                      value={form.totalAmount}
                      onChange={(e) => set({ totalAmount: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                  {perPerson > 0 && (
                    <p className="text-soft" style={{ marginTop: 10 }}>
                      That's <strong>{rupees(perPerson)}</strong> each, split {Number(form.spotsNeeded) + 1} ways
                      (you included). Collect it from the game page once everyone's in.
                    </p>
                  )}
                </div>
              )}
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox" checked={form.autoApprove}
                onChange={(e) => set({ autoApprove: e.target.checked })}
              />
              <span>Let players join instantly, without waiting for me to approve</span>
            </label>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <span className="spinner" style={{ width: 17, height: 17 }} /> : 'Post game'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
