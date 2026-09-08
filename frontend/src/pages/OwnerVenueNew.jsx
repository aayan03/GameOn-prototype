import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { venueApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import useGeolocation from '../hooks/useGeolocation.js';
import { SPORT_LABELS, AMENITY_LABELS, AMENITY_ICONS, rupees } from '../utils/format.js';
import { IconArrowLeft, IconTrash, IconLocate, IconBolt, IconPhone, IconCheck } from '../components/Icons.jsx';
import SportIcon from '../components/SportIcon.jsx';

/**
 * Listing a venue.
 *
 * This screen did not exist. `POST /api/venues` was implemented and exposed
 * through the API client, but nothing ever called it — all three "Add a
 * venue" buttons pointed at /owner/venues/new, which the router mapped back
 * to the dashboard. An owner clicked the button, watched the same empty
 * dashboard reload, and had no way through. The supply side of a two-sided
 * marketplace was unreachable from the product.
 *
 * Every field below mirrors createVenueSchema in venue.controller.js. Where
 * the two could drift — the sport list, the amenity list, the slot lengths —
 * the constants come from the same shared vocabulary the API validates
 * against.
 */

const SPORTS = ['football', 'cricket', 'badminton', 'basketball', 'tennis', 'volleyball', 'pickleball', 'tabletennis'];

const AMENITIES = [
  'parking', 'floodlights', 'washroom', 'changing_room', 'drinking_water',
  'first_aid', 'seating', 'cafeteria', 'equipment_rental', 'cctv', 'shower', 'wifi',
];

const SLOT_LENGTHS = [30, 60, 90, 120];

const blankCourt = () => ({
  name: '',
  sport: 'football',
  format: '',
  capacity: 10,
  pricePerHour: '',
  peakPricePerHour: '',
});

export default function OwnerVenueNew() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { request: requestLocation, isLoading: locating } = useGeolocation();

  /**
   * One form, two jobs. `/owner/venues/new` creates; `/owner/venues/:id/edit`
   * loads an existing venue into the same fields and PATCHes it.
   *
   * Kept as one component on purpose — the validation, the court editor and
   * the cancellation-policy preview are the parts most likely to drift apart
   * if they were duplicated, and they are exactly the parts that must agree
   * between creating and editing.
   */
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState('');
  // The courts as they arrived, so submit can tell whether they were touched.
  const [originalCourts, setOriginalCourts] = useState(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    bookingMode: 'automated',
    manualPhone: '',
    manualWhatsapp: '',
    responseTimeMins: 30,
    line1: '',
    area: '',
    city: user?.city || '',
    state: '',
    pincode: '',
    lat: '',
    lng: '',
    slotDurationMins: 60,
    freeCancellationHours: 24,
    partialRefundHours: 6,
    partialRefundPercent: 50,
  });
  const [courts, setCourts] = useState([blankCourt()]);
  const [amenities, setAmenities] = useState([]);
  const [images, setImages] = useState(['']);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!isEdit) return undefined;
    let cancelled = false;

    setLoading(true);
    venueApi.get(id)
      .then(({ data }) => {
        if (cancelled) return;
        // getVenue wraps the row alongside its reviews.
        const v = data.venue || data;
        const [lng, lat] = v.location?.coordinates || [];
        setForm({
          name: v.name || '',
          description: v.description || '',
          bookingMode: v.bookingMode || 'automated',
          manualPhone: v.manualContact?.phone || '',
          manualWhatsapp: v.manualContact?.whatsapp || '',
          responseTimeMins: v.manualContact?.responseTimeMins ?? 30,
          line1: v.address?.line1 || '',
          area: v.address?.area || '',
          city: v.address?.city || '',
          state: v.address?.state || '',
          pincode: v.address?.pincode || '',
          lat: lat != null ? String(lat) : '',
          lng: lng != null ? String(lng) : '',
          slotDurationMins: v.slotDurationMins || 60,
          freeCancellationHours: v.cancellationPolicy?.freeCancellationHours ?? 24,
          partialRefundHours: v.cancellationPolicy?.partialRefundHours ?? 6,
          partialRefundPercent: v.cancellationPolicy?.partialRefundPercent ?? 50,
        });
        const loadedCourts = (v.courts || []).map((c) => ({
          name: c.name || '',
          sport: c.sport || 'football',
          format: c.format || '',
          capacity: c.capacity ?? 10,
          pricePerHour: c.pricePerHour != null ? String(c.pricePerHour) : '',
          peakPricePerHour: c.peakPricePerHour != null ? String(c.peakPricePerHour) : '',
        }));
        setCourts(loadedCourts.length ? loadedCourts : [blankCourt()]);
        setOriginalCourts(loadedCourts);
        setAmenities(v.amenities || []);
        setImages(v.images?.length ? v.images : ['']);
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id, isEdit]);

  /**
   * Whether the court list actually changed.
   *
   * This matters more than it looks. The server REFUSES to replace the courts
   * while any booking is still ahead — replacing them mints new subdocument
   * ids and every live booking would point at a court that no longer exists.
   * An edit form that posts everything it loaded would therefore fail to
   * rename a venue purely because somebody has a game on Saturday. So the
   * courts go up only when they were edited.
   */
  const courtsChanged = useMemo(() => {
    if (!isEdit) return true;
    if (!originalCourts) return false;
    return JSON.stringify(courts) !== JSON.stringify(originalCourts);
  }, [isEdit, courts, originalCourts]);

  const setCourt = (i, patch) =>
    setCourts((list) => list.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const addCourt = () => setCourts((list) => [...list, blankCourt()]);
  const removeCourt = (i) => setCourts((list) => (list.length === 1 ? list : list.filter((_, idx) => idx !== i)));

  const toggleAmenity = (a) =>
    setAmenities((list) => (list.includes(a) ? list.filter((x) => x !== a) : [...list, a]));

  const useMyLocation = async () => {
    const c = await requestLocation();
    if (c) set({ lat: String(c.lat), lng: String(c.lng) });
  };

  /**
   * Client-side checks that mirror the server's, so the common mistakes are
   * caught before a round trip. The server remains the authority — nothing
   * here is a substitute for its validation.
   */
  const validate = () => {
    const errs = {};
    if (form.name.trim().length < 3) errs.name = 'Give the venue a name of at least 3 characters';

    const lat = Number(form.lat);
    const lng = Number(form.lng);
    if (form.lat === '' || form.lng === '' || Number.isNaN(lat) || Number.isNaN(lng)) {
      errs.location = 'Set the location — use the button, or paste coordinates from a map';
    } else if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      errs.location = 'Those coordinates are out of range. Latitude is −90 to 90, longitude −180 to 180.';
    }

    courts.forEach((c, i) => {
      if (!c.name.trim()) errs[`court${i}`] = 'Every court needs a name';
      else if (c.pricePerHour === '' || Number(c.pricePerHour) < 0) errs[`court${i}`] = 'Set an hourly price';
      else if (c.peakPricePerHour !== '' && Number(c.peakPricePerHour) < 0) errs[`court${i}`] = 'Peak price cannot be negative';
    });

    if (Number(form.partialRefundHours) > Number(form.freeCancellationHours)) {
      errs.policy = 'The partial-refund window must be shorter than the free-cancellation window';
    }

    if (form.bookingMode === 'manual' && !form.manualPhone.trim() && !form.manualWhatsapp.trim()) {
      errs.manual = 'Assisted booking needs a phone or WhatsApp number so we can reach you';
    }

    return errs;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      setError('Please fix the highlighted fields.');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        bookingMode: form.bookingMode,
        lat: Number(form.lat),
        lng: Number(form.lng),
        slotDurationMins: Number(form.slotDurationMins),
        // Left out of an edit that did not touch them — see `courtsChanged`.
        ...(courtsChanged ? {
          courts: courts.map((c) => ({
            name: c.name.trim(),
            sport: c.sport,
            capacity: Number(c.capacity) || 10,
            pricePerHour: Number(c.pricePerHour),
            // The schema takes null, not an empty string, for "no peak price".
            ...(c.format.trim() ? { format: c.format.trim() } : {}),
            ...(c.peakPricePerHour !== '' ? { peakPricePerHour: Number(c.peakPricePerHour) } : {}),
          })),
        } : {}),
        cancellationPolicy: {
          freeCancellationHours: Number(form.freeCancellationHours),
          partialRefundHours: Number(form.partialRefundHours),
          partialRefundPercent: Number(form.partialRefundPercent),
        },
      };

      /**
       * On an edit these are sent even when empty, so clearing a field
       * actually clears it. On a create an empty key is just noise, so it is
       * left out and the schema default applies.
       */
      const urls = images.map((u) => u.trim()).filter(Boolean);
      if (form.description.trim() || isEdit) payload.description = form.description.trim();
      if (amenities.length || isEdit) payload.amenities = amenities;
      if (urls.length || isEdit) payload.images = urls;

      const address = {
        line1: form.line1.trim(), area: form.area.trim(), city: form.city.trim(),
        state: form.state.trim(), pincode: form.pincode.trim(),
      };
      if (Object.values(address).some(Boolean)) payload.address = address;

      if (form.bookingMode === 'manual') {
        payload.manualContact = {
          phone: form.manualPhone.trim(),
          whatsapp: form.manualWhatsapp.trim(),
          responseTimeMins: Number(form.responseTimeMins) || 30,
        };
      }

      if (isEdit) {
        await venueApi.update(id, payload);
        toast.success('Changes saved.');
      } else {
        const { data } = await venueApi.create(payload);
        toast.success(data.message);
      }
      navigate('/owner', { replace: true });
    } catch (err) {
      setError(err.message);
      if (err.details) setFieldErrors((prev) => ({ ...prev, ...err.details }));
      setBusy(false);
    }
  };

  const isManual = form.bookingMode === 'manual';

  if (loading) {
    return (
      <div className="container section center" style={{ paddingTop: 60 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="container section" style={{ maxWidth: 860 }}>
        <div className="card card-pad empty">
          <div className="empty-icon">🏟️</div>
          <h3>{loadError}</h3>
          <p className="text-soft" style={{ marginTop: 8, marginBottom: 18 }}>
            That venue could not be loaded. It may have been removed, or it may
            not be yours to edit.
          </p>
          <Link to="/owner" className="btn btn-primary">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container section fade-in" style={{ maxWidth: 860 }}>
      <Link to="/owner" className="link-btn row gap-6" style={{ marginBottom: 16 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> Back to dashboard
      </Link>

      <div className="page-head">
        <span className="eyebrow">Owner</span>
        <h1 style={{ marginTop: 8 }}>{isEdit ? 'Edit venue' : 'List a venue'}</h1>
        <p className="text-soft">
          {isEdit
            ? 'Changes go live as soon as you save. Players who have already booked keep their slot.'
            : user?.isVerified
              ? 'Your account is verified, so this goes live as soon as you save it.'
              : 'New listings are reviewed by our team before they appear publicly — usually within a day.'}
        </p>
      </div>

      {/*
        Said before they try it, not after the server refuses. Replacing the
        court list detaches live bookings from their court, so the server will
        not allow it while any are outstanding.
      */}
      {isEdit && courtsChanged && (
        <div className="alert alert-warn" style={{ marginBottom: 18 }}>
          <span>
            You have changed the courts. If anyone still has a booking here,
            saving will be refused — cancel or play those fixtures first, or
            undo the court changes and save the rest.
          </span>
        </div>
      )}

      {error && <div className="alert alert-error" style={{ marginBottom: 18 }}>{error}</div>}

      <form onSubmit={submit} className="stack gap-18">
        {/* ── The basics ───────────────────────────────────────── */}
        <section className="card card-pad stack gap-16">
          <h2 style={{ fontSize: '1.15rem' }}>The basics</h2>

          <div className="field">
            <label className="label" htmlFor="v-name">Venue name</label>
            <input
              id="v-name" className={`input${fieldErrors.name ? ' error' : ''}`}
              maxLength={120} placeholder="Greenfield Sports Arena"
              value={form.name} onChange={(e) => set({ name: e.target.value })}
            />
            {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="v-desc">Description <span className="text-faint">(optional)</span></label>
            <textarea
              id="v-desc" className="textarea" maxLength={2000}
              placeholder="Two floodlit 5-a-side turfs, covered seating, parking for 20 cars…"
              value={form.description} onChange={(e) => set({ description: e.target.value })}
            />
            <span className="text-faint">{form.description.length}/2000</span>
          </div>
        </section>

        {/* ── How bookings arrive ──────────────────────────────── */}
        <section className="card card-pad stack gap-16">
          <div>
            <h2 style={{ fontSize: '1.15rem' }}>How do you want bookings to work?</h2>
            <p className="text-soft" style={{ marginTop: 4 }}>You can change this at any time.</p>
          </div>

          <div className="stack gap-10">
            <button
              type="button"
              className={`pay-opt${!isManual ? ' active' : ''}`}
              onClick={() => set({ bookingMode: 'automated' })}
            >
              <span className="pay-icon"><IconBolt style={{ width: 22, height: 22 }} /></span>
              <span className="grow">
                <strong style={{ display: 'block' }}>Instant booking</strong>
                <span className="text-faint">
                  Players pay and the slot is confirmed immediately. Best if your calendar is accurate.
                </span>
              </span>
              {!isManual && <IconCheck style={{ width: 20, height: 20 }} />}
            </button>

            <button
              type="button"
              className={`pay-opt${isManual ? ' active' : ''}`}
              onClick={() => set({ bookingMode: 'manual' })}
            >
              <span className="pay-icon"><IconPhone style={{ width: 22, height: 22 }} /></span>
              <span className="grow">
                <strong style={{ display: 'block' }}>Booking on request</strong>
                <span className="text-faint">
                  Requests come to you to confirm. Nothing is charged until you accept.
                </span>
              </span>
              {isManual && <IconCheck style={{ width: 20, height: 20 }} />}
            </button>
          </div>

          {isManual && (
            <>
              <div className="grid-2">
                <div className="field">
                  <label className="label" htmlFor="v-phone">Phone</label>
                  <input
                    id="v-phone" className="input" inputMode="numeric" maxLength={15}
                    placeholder="9876543210"
                    value={form.manualPhone} onChange={(e) => set({ manualPhone: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="v-wa">WhatsApp <span className="text-faint">(optional)</span></label>
                  <input
                    id="v-wa" className="input" inputMode="numeric" maxLength={15}
                    placeholder="9876543210"
                    value={form.manualWhatsapp} onChange={(e) => set({ manualWhatsapp: e.target.value })}
                  />
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="v-resp">Typical reply time (minutes)</label>
                <input
                  id="v-resp" type="number" className="input" min={1} max={1440}
                  value={form.responseTimeMins} onChange={(e) => set({ responseTimeMins: e.target.value })}
                />
                <span className="text-faint">Shown to players so they know how long to wait.</span>
              </div>
              {fieldErrors.manual && <span className="field-error">{fieldErrors.manual}</span>}
            </>
          )}
        </section>

        {/* ── Courts ───────────────────────────────────────────── */}
        <section className="card card-pad stack gap-16">
          <div className="between gap-12 wrap">
            <div>
              <h2 style={{ fontSize: '1.15rem' }}>Courts &amp; pricing</h2>
              <p className="text-soft" style={{ marginTop: 4 }}>
                One entry per bookable surface — Turf A, Court 2, Net 3.
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addCourt}>Add another</button>
          </div>

          {courts.map((court, i) => (
            <div key={i} className="card card-pad stack gap-14" style={{ background: 'var(--surface-2)' }}>
              <div className="between gap-12">
                <strong>Court {i + 1}</strong>
                {courts.length > 1 && (
                  <button
                    type="button" className="icon-btn bare" style={{ color: 'var(--danger)' }}
                    onClick={() => removeCourt(i)} aria-label={`Remove court ${i + 1}`}
                  >
                    <IconTrash style={{ width: 16, height: 16 }} />
                  </button>
                )}
              </div>

              <div className="field">
                <span className="label">Sport</span>
                <div className="row gap-8 wrap">
                  {SPORTS.map((s) => (
                    <button
                      key={s} type="button"
                      className={`pill${court.sport === s ? ' active' : ''}`}
                      onClick={() => setCourt(i, { sport: s })}
                    >
                      <SportIcon sport={s} size={16} /> {SPORT_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label className="label" htmlFor={`c-name-${i}`}>Name</label>
                  <input
                    id={`c-name-${i}`} className="input" maxLength={60} placeholder="Turf A"
                    value={court.name} onChange={(e) => setCourt(i, { name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor={`c-format-${i}`}>Format <span className="text-faint">(optional)</span></label>
                  <input
                    id={`c-format-${i}`} className="input" maxLength={40} placeholder="5-a-side"
                    value={court.format} onChange={(e) => setCourt(i, { format: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label className="label" htmlFor={`c-price-${i}`}>Price per hour (₹)</label>
                  <input
                    id={`c-price-${i}`} type="number" className="input" min={0} step={50} placeholder="1200"
                    value={court.pricePerHour} onChange={(e) => setCourt(i, { pricePerHour: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor={`c-peak-${i}`}>Peak price per hour <span className="text-faint">(optional)</span></label>
                  <input
                    id={`c-peak-${i}`} type="number" className="input" min={0} step={50} placeholder="1600"
                    value={court.peakPricePerHour} onChange={(e) => setCourt(i, { peakPricePerHour: e.target.value })}
                  />
                  <span className="text-faint">Weekday evenings from 5pm, and all weekend.</span>
                </div>
              </div>

              <div className="field" style={{ maxWidth: 220 }}>
                <label className="label" htmlFor={`c-cap-${i}`}>Comfortable capacity</label>
                <input
                  id={`c-cap-${i}`} type="number" className="input" min={1} max={200}
                  value={court.capacity} onChange={(e) => setCourt(i, { capacity: e.target.value })}
                />
              </div>

              {fieldErrors[`court${i}`] && <span className="field-error">{fieldErrors[`court${i}`]}</span>}
            </div>
          ))}
        </section>

        {/* ── Where it is ──────────────────────────────────────── */}
        <section className="card card-pad stack gap-16">
          <h2 style={{ fontSize: '1.15rem' }}>Where is it?</h2>

          <div className="field">
            <label className="label" htmlFor="v-line1">Street address</label>
            <input
              id="v-line1" className="input" maxLength={200} placeholder="12 MG Road"
              value={form.line1} onChange={(e) => set({ line1: e.target.value })}
            />
          </div>

          <div className="grid-2">
            <div className="field">
              <label className="label" htmlFor="v-area">Area</label>
              <input
                id="v-area" className="input" maxLength={80} placeholder="Koramangala"
                value={form.area} onChange={(e) => set({ area: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="v-city">City</label>
              <input
                id="v-city" className="input" maxLength={80} placeholder="Bengaluru"
                value={form.city} onChange={(e) => set({ city: e.target.value })}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label className="label" htmlFor="v-state">State</label>
              <input
                id="v-state" className="input" maxLength={80} placeholder="Karnataka"
                value={form.state} onChange={(e) => set({ state: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="v-pin">PIN code</label>
              <input
                id="v-pin" className="input" inputMode="numeric" maxLength={6} placeholder="560034"
                value={form.pincode} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '') })}
              />
            </div>
          </div>

          <div className="field">
            <span className="label">Map position</span>
            <p className="text-faint" style={{ marginTop: -2 }}>
              This is what puts you on the map and in “near me” results. Stand at the venue and tap
              the button, or copy the coordinates from Google Maps.
            </p>
            <div className="row gap-10 wrap" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={useMyLocation} disabled={locating}>
                <IconLocate style={{ width: 15, height: 15 }} />
                {locating ? 'Getting location…' : 'Use my current location'}
              </button>
            </div>
            <div className="grid-2" style={{ marginTop: 10 }}>
              <div className="field">
                <label className="label" htmlFor="v-lat">Latitude</label>
                <input
                  id="v-lat" className={`input${fieldErrors.location ? ' error' : ''}`} inputMode="decimal"
                  placeholder="12.9716"
                  value={form.lat} onChange={(e) => set({ lat: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="v-lng">Longitude</label>
                <input
                  id="v-lng" className={`input${fieldErrors.location ? ' error' : ''}`} inputMode="decimal"
                  placeholder="77.5946"
                  value={form.lng} onChange={(e) => set({ lng: e.target.value })}
                />
              </div>
            </div>
            {fieldErrors.location && <span className="field-error">{fieldErrors.location}</span>}
          </div>
        </section>

        {/* ── Facilities ───────────────────────────────────────── */}
        <section className="card card-pad stack gap-14">
          <div>
            <h2 style={{ fontSize: '1.15rem' }}>Facilities</h2>
            <p className="text-soft" style={{ marginTop: 4 }}>Players filter on these, so tick everything you have.</p>
          </div>
          <div className="row gap-8 wrap">
            {AMENITIES.map((a) => (
              <button
                key={a} type="button"
                className={`pill${amenities.includes(a) ? ' active' : ''}`}
                onClick={() => toggleAmenity(a)}
                aria-pressed={amenities.includes(a)}
              >
                {AMENITY_ICONS[a]} {AMENITY_LABELS[a]}
              </button>
            ))}
          </div>
        </section>

        {/* ── Photos ───────────────────────────────────────────── */}
        <section className="card card-pad stack gap-14">
          <div>
            <h2 style={{ fontSize: '1.15rem' }}>Photos <span className="text-faint" style={{ fontWeight: 400 }}>(optional)</span></h2>
            <p className="text-soft" style={{ marginTop: 4 }}>
              Paste image links. Listings with a photo get noticeably more bookings.
            </p>
          </div>
          {images.map((url, i) => (
            <div key={i} className="row gap-10">
              <input
                className="input grow" placeholder="https://…" value={url}
                onChange={(e) => setImages((list) => list.map((u, idx) => (idx === i ? e.target.value : u)))}
              />
              {images.length > 1 && (
                <button
                  type="button" className="icon-btn bare" style={{ color: 'var(--danger)' }}
                  onClick={() => setImages((list) => list.filter((_, idx) => idx !== i))}
                  aria-label={`Remove photo ${i + 1}`}
                >
                  <IconTrash style={{ width: 16, height: 16 }} />
                </button>
              )}
            </div>
          ))}
          {images.length < 8 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}
                    onClick={() => setImages((list) => [...list, ''])}>
              Add another photo
            </button>
          )}
        </section>

        {/* ── Slots & cancellation ─────────────────────────────── */}
        <section className="card card-pad stack gap-16">
          <h2 style={{ fontSize: '1.15rem' }}>Slots &amp; cancellation</h2>

          <div className="field">
            <span className="label">How long is one slot?</span>
            <div className="row gap-8 wrap">
              {SLOT_LENGTHS.map((m) => (
                <button
                  key={m} type="button"
                  className={`pill${Number(form.slotDurationMins) === m ? ' active' : ''}`}
                  onClick={() => set({ slotDurationMins: m })}
                >
                  {m} min
                </button>
              ))}
            </div>
            <span className="text-faint">
              Opening hours default to 6am–11pm every day. You can change both from the venue’s
              settings once it is live.
            </span>
          </div>

          <div className="grid-2">
            <div className="field">
              <label className="label" htmlFor="v-free">Free cancellation up to (hours before)</label>
              <input
                id="v-free" type="number" className="input" min={0} max={168}
                value={form.freeCancellationHours} onChange={(e) => set({ freeCancellationHours: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="v-partial">Partial refund up to (hours before)</label>
              <input
                id="v-partial" type="number" className="input" min={0} max={168}
                value={form.partialRefundHours} onChange={(e) => set({ partialRefundHours: e.target.value })}
              />
            </div>
          </div>

          <div className="field" style={{ maxWidth: 260 }}>
            <label className="label" htmlFor="v-pct">Partial refund amount (%)</label>
            <input
              id="v-pct" type="number" className="input" min={0} max={100}
              value={form.partialRefundPercent} onChange={(e) => set({ partialRefundPercent: e.target.value })}
            />
          </div>

          {fieldErrors.policy && <span className="field-error">{fieldErrors.policy}</span>}

          <div className="alert alert-info">
            <span>
              Players see this before they book: full refund more than{' '}
              <strong>{form.freeCancellationHours || 0}h</strong> ahead,{' '}
              <strong>{form.partialRefundPercent || 0}%</strong> between{' '}
              <strong>{form.partialRefundHours || 0}h</strong> and{' '}
              <strong>{form.freeCancellationHours || 0}h</strong>, nothing inside{' '}
              <strong>{form.partialRefundHours || 0}h</strong>.
            </span>
          </div>
        </section>

        <div className="row gap-12 wrap">
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy
              ? <span className="spinner" style={{ width: 17, height: 17 }} />
              : (isEdit ? 'Save changes' : 'Publish venue')}
          </button>
          <Link to="/owner" className="btn btn-ghost btn-lg">Cancel</Link>
        </div>

        <p className="text-faint">
          Starting price shown to players will be{' '}
          {rupees(Math.min(...courts.map((c) => Number(c.pricePerHour) || 0).filter((n) => n > 0), Infinity) || 0)}/hour.
        </p>
      </form>
    </div>
  );
}
