import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { bookingApi, venueApi, paymentApi } from '../api/endpoints.js';
import { openCheckout, TEST_CARDS } from '../utils/razorpay.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { dateStrip, prettyDate } from '../utils/date.js';
import { rupees, SPORT_ICONS, SPORT_LABELS } from '../utils/format.js';
import {
  IconArrowLeft, IconBolt, IconPhone, IconClock, IconPin,
  IconWallet, IconSparkle, IconClose, IconCheck, IconShield,
} from '../components/Icons.jsx';

const STEPS = ['Pick slots', 'Review', 'Confirm'];

export default function BookSlot() {
  const { idOrSlug } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, setUser } = useAuth();
  const toast = useToast();

  // Built from the venue's own window once availability has loaded, so a
  // venue that takes bookings 30 days out actually offers 30 days. The strip
  // was hardcoded to 14 and then sliced to `advanceBookingDays` — which could
  // only ever shorten it, never reach the venue's real limit. A loyalty tier's
  // bonus days are granted server-side on top of this.
  const [advanceDays, setAdvanceDays] = useState(14);
  const days = useMemo(() => dateStrip(Math.min(Math.max(advanceDays, 1), 90)), [advanceDays]);
  const [date, setDate] = useState(() => dateStrip(1)[0].key);
  const [venueId, setVenueId] = useState(null);
  const [data, setData] = useState(null);          // availability response
  const [courtId, setCourtId] = useState(null);
  const [picked, setPicked] = useState([]);        // array of slot start-minutes
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [promo, setPromo] = useState('');
  const [appliedPromo, setAppliedPromo] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [players, setPlayers] = useState(1);
  const [payMethod, setPayMethod] = useState('wallet');
  // Null until the API answers. The card/UPI option only appears when a real
  // gateway is configured — offering it otherwise leads straight to a 501,
  // because the server refuses to fake a signature it has no secret for.
  const [gateway, setGateway] = useState(null);

  useEffect(() => {
    let cancelled = false;
    paymentApi.config()
      .then(({ data }) => { if (!cancelled) setGateway(data.mode === 'razorpay' ? data : null); })
      .catch(() => { if (!cancelled) setGateway(null); });
    return () => { cancelled = true; };
  }, []);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  /* ── Resolve the slug to an id once, then load availability ── */
  useEffect(() => {
    let cancelled = false;
    venueApi.get(idOrSlug)
      .then(({ data: d }) => { if (!cancelled) setVenueId(d.venue._id); })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [idOrSlug]);

  const loadAvailability = useCallback(async (silent = false) => {
    if (!venueId) return;
    if (!silent) setLoading(true);
    try {
      const { data: d } = await bookingApi.availability(venueId, { date });
      setData(d);
      if (d.venue?.advanceBookingDays) setAdvanceDays(d.venue.advanceBookingDays);
      setCourtId((prev) => (prev && d.courts.some((c) => c.courtId === prev) ? prev : d.courts[0]?.courtId));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [venueId, date]);

  useEffect(() => { loadAvailability(); }, [loadAvailability]);

  // Changing the day or court invalidates the current selection.
  useEffect(() => { setPicked([]); setQuote(null); setStep(0); }, [date, courtId]);

  const court = data?.courts.find((c) => c.courtId === courtId);
  const venue = data?.venue;
  const isInstant = venue?.bookingMode === 'automated';

  /* ── Slot selection ─────────────────────────────────────────── */
  const toggleSlot = (slot) => {
    if (slot.status !== 'available') return;
    setPicked((prev) => {
      if (prev.includes(slot.start)) return prev.filter((s) => s !== slot.start);
      if (prev.length >= 6) { toast.info('You can book up to 6 slots at a time.'); return prev; }
      return [...prev, slot.start].sort((a, b) => a - b);
    });
  };

  /* ── Re-price whenever the selection or promo changes ───────── */
  useEffect(() => {
    if (!picked.length || !venueId || !courtId) { setQuote(null); return undefined; }
    if (!isAuthenticated) return undefined;   // quoting requires a session

    let cancelled = false;
    setQuoting(true);
    bookingApi.quote({ venueId, courtId, date, starts: picked, promoCode: appliedPromo || undefined })
      .then(({ data: q }) => { if (!cancelled) setQuote(q); })
      .catch((err) => {
        if (cancelled) return;
        setQuote(null);
        if (err.status === 409) { toast.error(err.message); loadAvailability(true); setPicked([]); }
        else if (appliedPromo) { toast.error(err.message); setAppliedPromo(''); }
      })
      .finally(() => { if (!cancelled) setQuoting(false); });
    return () => { cancelled = true; };
  }, [picked, appliedPromo, venueId, courtId, date, isAuthenticated, toast, loadAvailability]);

  const pickedSlots = useMemo(
    () => (court?.slots || []).filter((s) => picked.includes(s.start)),
    [court, picked]
  );
  const localSubtotal = pickedSlots.reduce((sum, s) => sum + s.price, 0);

  /* ── Actions ────────────────────────────────────────────────── */
  const goReview = () => {
    if (!isAuthenticated) { navigate('/login', { state: { from: { pathname: `/venues/${idOrSlug}/book` } } }); return; }
    if (!picked.length) { toast.info('Pick at least one slot first.'); return; }
    setStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const applyPromo = () => {
    if (!promo.trim()) return;
    setAppliedPromo(promo.trim().toUpperCase());
  };

  const confirm = async () => {
    setSubmitting(true);
    try {
      const { data: res } = await bookingApi.create({
        venueId, courtId, date, starts: picked,
        promoCode: appliedPromo || undefined,
        players, paymentMethod: payMethod,
      });

      /**
       * Card and UPI settle after the booking exists, not before.
       *
       * The slot is held the moment the rows are written, so nobody can take
       * it while checkout is open; the amount comes from the order the SERVER
       * built off those rows, never from anything this page calculated.
       */
      if (payMethod === 'gateway') {
        const { data: order } = await paymentApi.order(res.booking.groupRef);
        const result = await openCheckout({
          order, keyId: gateway?.keyId, user, venueName: venue?.name,
        });

        if (result.status !== 'paid') {
          // The booking stands, unpaid, and can be paid or cancelled from the
          // ticket — losing the slot because a modal was closed would be worse.
          const why = {
            dismissed: 'Payment cancelled. Your slot is held — you can pay from the booking.',
            failed: result.message,
            unavailable: 'Could not load the payment window. Check for an ad blocker, or pay from your wallet.',
          }[result.status];
          toast.info(why);
          navigate(`/bookings/${res.booking.groupRef}`, { replace: true });
          return;
        }

        await paymentApi.verify({ groupRef: res.booking.groupRef, ...result.payload });
        toast.success('Payment confirmed. See you on the pitch.');
        navigate(`/bookings/${res.booking.groupRef}?new=1`, { replace: true });
        return;
      }

      if (typeof res.walletBalance === 'number') setUser({ ...user, walletBalance: res.walletBalance });
      toast.success(res.message);
      navigate(`/bookings/${res.booking.groupRef}?new=1`, { replace: true });
    } catch (err) {
      toast.error(err.message);
      if (err.status === 409) { loadAvailability(true); setPicked([]); setStep(0); }
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Render ─────────────────────────────────────────────────── */
  if (error && !data) {
    return (
      <div className="container section">
        <div className="card card-pad empty">
          <div className="empty-icon">🏟️</div>
          <h3>{error}</h3>
          <Link to="/venues" className="btn btn-primary" style={{ marginTop: 20 }}>Back to venues</Link>
        </div>
      </div>
    );
  }

  const walletShort = payMethod === 'wallet' && quote && user && user.walletBalance < quote.total;

  return (
    <div className="container section fade-in">
      <Link to={`/venues/${idOrSlug}`} className="link-btn row gap-6" style={{ marginBottom: 16 }}>
        <IconArrowLeft style={{ width: 15, height: 15 }} /> Back to venue
      </Link>

      <div className="page-head">
        <h1>{step === 0 ? 'Pick your slot' : step === 1 ? 'Review booking' : 'Confirm'}</h1>
        {venue && (
          <p className="text-soft row gap-6 wrap">
            <strong>{venue.name}</strong>
            <span className="text-faint">·</span>
            <span className="row gap-4">
              <IconPin style={{ width: 14, height: 14 }} />
              {[venue.address?.area, venue.address?.city].filter(Boolean).join(', ')}
            </span>
          </p>
        )}
      </div>

      {/* Step rail */}
      <div className="step-rail">
        {STEPS.map((label, i) => (
          <div key={label} style={{ display: 'contents' }}>
            <div className={`rail-step${i < step ? ' done' : ''}${i === step ? ' current' : ''}`}>
              <span className="rail-dot">{i < step ? '✓' : i + 1}</span>
              <span className="rail-label">{label}</span>
            </div>
            {i < STEPS.length - 1 && <span className={`rail-line${i < step ? ' done' : ''}`} />}
          </div>
        ))}
      </div>

      <div className="booking-layout">
        <main>
          {step === 0 && (
            <>
              {/* Date strip */}
              <h3 style={{ marginBottom: 12 }}>Choose a date</h3>
              <div className="date-strip">
                {days.map((d) => (
                  <button
                    key={d.key}
                    className={`date-chip${date === d.key ? ' active' : ''}${d.isToday ? ' today' : ''}`}
                    onClick={() => setDate(d.key)}
                  >
                    <span className="date-dow">{d.dow}</span>
                    <span className="date-num">{d.day}</span>
                    <span className="date-mon">{d.month}</span>
                  </button>
                ))}
              </div>

              {/* Court tabs */}
              {data?.courts?.length > 1 && (
                <>
                  <h3 style={{ margin: '22px 0 12px' }}>Choose a court</h3>
                  <div className="court-tabs">
                    {data.courts.map((c) => (
                      <button
                        key={c.courtId}
                        className={`court-tab${courtId === c.courtId ? ' active' : ''}`}
                        onClick={() => setCourtId(c.courtId)}
                      >
                        <span style={{ fontSize: '1.3rem' }}>{SPORT_ICONS[c.sport]}</span>
                        <span>
                          <span className="court-tab-name">{c.name}</span>
                          <span className="court-tab-meta">
                            {SPORT_LABELS[c.sport]} · {rupees(c.pricePerHour)}/hr
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Slot grid */}
              <div className="between" style={{ margin: '22px 0 14px' }}>
                <h3>Available slots</h3>
                {court && !court.closed && (
                  <span className="text-faint row gap-4">
                    <IconClock style={{ width: 14, height: 14 }} />
                    Open {court.opens} – {court.closes}
                  </span>
                )}
              </div>

              {loading ? (
                <div className="slot-grid">
                  {Array.from({ length: 14 }, (_, i) => (
                    <div key={i} className="skeleton" style={{ height: 68 }} />
                  ))}
                </div>
              ) : court?.closed ? (
                <div className="card card-pad empty">
                  <div className="empty-icon">🌙</div>
                  <h3>Closed on {prettyDate(date)}</h3>
                  <p className="text-soft" style={{ marginTop: 6 }}>Try another date.</p>
                </div>
              ) : (
                <>
                  <div className="slot-grid">
                    {court?.slots.map((slot, i) => (
                      <button
                        key={slot.start}
                        className={[
                          'slot',
                          slot.status,
                          slot.isPeak ? 'peak' : '',
                          picked.includes(slot.start) ? 'selected' : '',
                        ].filter(Boolean).join(' ')}
                        style={{ animationDelay: `${Math.min(i * 18, 400)}ms` }}
                        disabled={slot.status !== 'available'}
                        onClick={() => toggleSlot(slot)}
                        aria-pressed={picked.includes(slot.start)}
                        title={slot.status === 'booked' ? 'Already booked'
                             : slot.status === 'held' ? 'Awaiting venue confirmation'
                             : slot.status === 'past' ? 'This slot has passed' : ''}
                      >
                        <span className="slot-time">{slot.label}</span>
                        <span className="slot-price">
                          {slot.status === 'booked' || slot.status === 'held' ? 'Taken' : rupees(slot.price)}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="slot-legend">
                    <span className="legend-item"><i className="legend-swatch available" /> Available</span>
                    <span className="legend-item"><i className="legend-swatch selected" /> Selected</span>
                    <span className="legend-item"><i className="legend-swatch peak" /> Peak price 🔥</span>
                    <span className="legend-item"><i className="legend-swatch booked" /> Taken</span>
                  </div>
                </>
              )}
            </>
          )}

          {step >= 1 && quote && (
            <div className="stack gap-20 fade-in">
              {/* Booking type explainer */}
              <div className={`alert ${isInstant ? 'alert-success' : 'alert-warn'}`}>
                {isInstant ? <IconBolt style={{ width: 19, height: 19, flexShrink: 0 }} />
                           : <IconPhone style={{ width: 19, height: 19, flexShrink: 0 }} />}
                <span>
                  {isInstant
                    ? 'This venue confirms instantly. Your slot is locked the moment you pay.'
                    : (
                      /* The old copy said "nothing is charged until they confirm"
                         under every payment method. That is true of the wallet and
                         of pay-at-venue, and flatly false for card/UPI: Razorpay
                         collects the moment checkout completes, long before the
                         venue has answered. Say which it is. */
                      `This venue confirms manually. We'll send your request and ${venue.name} usually replies within ${venue.manualContact?.responseTimeMins || 30} minutes. `
                      + (payMethod === 'gateway'
                        ? 'Card and UPI are charged now and refunded in full if the venue cannot take it.'
                        : 'Nothing is charged until they confirm.')
                    )}
                </span>
              </div>

              {/* Players */}
              <div className="card card-pad">
                <h3 style={{ marginBottom: 14 }}>How many playing?</h3>
                <div className="row gap-8 wrap">
                  {[2, 4, 6, 10, 12, 14, 22].filter((n) => n <= (court?.capacity || 22) + 2).map((n) => (
                    <button
                      key={n}
                      className={`pill${players === n ? ' active' : ''}`}
                      onClick={() => setPlayers(n)}
                    >
                      {n} players
                    </button>
                  ))}
                </div>
                {court?.capacity && (
                  <p className="text-faint" style={{ marginTop: 10 }}>
                    {court.name} comfortably holds about {court.capacity} players.
                  </p>
                )}
              </div>

              {/* Promo */}
              <div className="card card-pad">
                <h3 style={{ marginBottom: 6 }}>Have a promo code?</h3>
                <p className="text-faint" style={{ marginBottom: 14 }}>
                  Try <strong>FIRST20</strong> for 20% off, or <strong>GAMEON50</strong> for ₹50 off.
                </p>
                {appliedPromo ? (
                  <div className="row gap-10 wrap">
                    <span className="badge badge-volt">
                      <IconSparkle style={{ width: 13, height: 13 }} /> {appliedPromo} applied
                    </span>
                    <button className="link-btn" onClick={() => { setAppliedPromo(''); setPromo(''); }}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="row gap-10">
                    <input
                      className="input grow"
                      placeholder="Enter code"
                      value={promo}
                      onChange={(e) => setPromo(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && applyPromo()}
                    />
                    <button className="btn btn-dark" onClick={applyPromo} disabled={!promo.trim()}>Apply</button>
                  </div>
                )}
              </div>

              {/* Payment */}
              <div className="card card-pad">
                <h3 style={{ marginBottom: 14 }}>How would you like to pay?</h3>
                <div className="stack gap-10">
                  <button
                    className={`pay-opt${payMethod === 'wallet' ? ' active' : ''}`}
                    onClick={() => setPayMethod('wallet')}
                  >
                    <span className="pay-icon"><IconWallet style={{ width: 22, height: 22 }} /></span>
                    <span className="grow">
                      <strong style={{ display: 'block' }}>GameOn wallet</strong>
                      <span className="text-faint">
                        Balance {rupees(user?.walletBalance || 0)}
                        {walletShort && ' — not enough for this booking'}
                      </span>
                    </span>
                    {payMethod === 'wallet' && <IconCheck style={{ width: 20, height: 20 }} />}
                  </button>

                  {gateway && (
                    <button
                      className={`pay-opt${payMethod === 'gateway' ? ' active' : ''}`}
                      onClick={() => setPayMethod('gateway')}
                    >
                      <span className="pay-icon">💳</span>
                      <span className="grow">
                        <strong style={{ display: 'block' }}>Card, UPI or netbanking</strong>
                        <span className="text-faint">
                          {gateway.keyId?.startsWith('rzp_test_')
                            ? 'Razorpay test mode — no real money moves'
                            : 'Secure payment via Razorpay'}
                        </span>
                      </span>
                      {payMethod === 'gateway' && <IconCheck style={{ width: 20, height: 20 }} />}
                    </button>
                  )}

                  <button
                    className={`pay-opt${payMethod === 'pay_at_venue' ? ' active' : ''}`}
                    onClick={() => setPayMethod('pay_at_venue')}
                  >
                    <span className="pay-icon">💵</span>
                    <span className="grow">
                      <strong style={{ display: 'block' }}>Pay at the venue</strong>
                      <span className="text-faint">Settle directly with the venue when you arrive</span>
                    </span>
                    {payMethod === 'pay_at_venue' && <IconCheck style={{ width: 20, height: 20 }} />}
                  </button>
                </div>

                {payMethod === 'gateway' && gateway?.keyId?.startsWith('rzp_test_') && (
                  <div className="alert alert-info" style={{ marginTop: 14, display: 'block' }}>
                    <strong style={{ display: 'block', marginBottom: 6 }}>Test mode — use these cards</strong>
                    {TEST_CARDS.map((c) => (
                      <div key={c.number} style={{ fontSize: '.86rem', marginBottom: 3 }}>
                        <strong>{c.label}:</strong>{' '}
                        <span className="mono">{c.number}</span>{' '}
                        <span className="text-faint">— {c.note}</span>
                      </div>
                    ))}
                  </div>
                )}

                {walletShort && (
                  <div className="alert alert-warn" style={{ marginTop: 14 }}>
                    <span>
                      You need {rupees(quote.total - (user?.walletBalance || 0))} more.
                      Top up from your <Link to="/wallet" style={{ textDecoration: 'underline' }}>wallet</Link>,
                      or choose another payment method.
                    </span>
                  </div>
                )}
              </div>

              {/* Cancellation policy reminder */}
              <div className="card card-pad card-volt">
                <div className="row gap-12">
                  <IconShield style={{ width: 22, height: 22, flexShrink: 0 }} />
                  <div>
                    <strong>Free cancellation up to {venue.cancellationPolicy.freeCancellationHours} hours before</strong>
                    <p className="text-soft" style={{ marginTop: 4 }}>
                      Cancel between {venue.cancellationPolicy.partialRefundHours} and{' '}
                      {venue.cancellationPolicy.freeCancellationHours} hours before and you get{' '}
                      {venue.cancellationPolicy.partialRefundPercent}% back. Inside{' '}
                      {venue.cancellationPolicy.partialRefundHours} hours is non-refundable.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* ── Sticky summary ───────────────────────────────────── */}
        <aside>
          <div className="summary-card">
            <div className="summary-head">
              <div className="between">
                <strong style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.05rem' }}>Your booking</strong>
                {court && <span className="badge badge-soft">{SPORT_ICONS[court.sport]} {court.name}</span>}
              </div>
              <p style={{ fontSize: '.86rem', fontWeight: 700, marginTop: 4 }}>{prettyDate(date)}</p>
            </div>

            <div className="summary-body">
              {!picked.length ? (
                <div className="center" style={{ padding: '18px 0' }}>
                  <div style={{ fontSize: '2.2rem', marginBottom: 8 }}>👆</div>
                  <p className="text-soft">Tap the slots you want and they'll show up here.</p>
                </div>
              ) : (
                <>
                  <div className="row gap-8 wrap">
                    {pickedSlots.map((s) => (
                      <span key={s.start} className="slot-tag">
                        {s.label}
                        <button onClick={() => toggleSlot(s)} aria-label={`Remove ${s.label}`}>
                          <IconClose style={{ width: 13, height: 13 }} />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="divider-dash" />

                  <div className="summary-row">
                    <span className="text-soft">
                      {picked.length} × {data?.venue?.slotDurationMins || 60} min
                    </span>
                    <strong className="mono">{rupees(quote?.subtotal ?? localSubtotal)}</strong>
                  </div>

                  {quote?.discount > 0 && (
                    <div className="summary-row">
                      <span className="discount">{appliedPromo} discount</span>
                      <strong className="discount mono">−{rupees(quote.discount)}</strong>
                    </div>
                  )}

                  {quote?.platformFee > 0 && (
                    <div className="summary-row">
                      <span className="text-soft">Platform fee</span>
                      <span className="mono">{rupees(quote.platformFee)}</span>
                    </div>
                  )}

                  <div className="summary-row total">
                    <span>Total</span>
                    <span className="mono">
                      {quoting ? <span className="spinner" style={{ width: 17, height: 17 }} />
                               : rupees(quote?.total ?? localSubtotal)}
                    </span>
                  </div>

                  {step === 0 ? (
                    <button className="btn btn-primary btn-block btn-lg" onClick={goReview}>
                      {isAuthenticated ? 'Review booking' : 'Log in to book'}
                    </button>
                  ) : (
                    <div className="stack gap-10">
                      <button
                        className="btn btn-primary btn-block btn-lg"
                        onClick={confirm}
                        disabled={submitting || quoting || !quote || (walletShort && payMethod === 'wallet')}
                      >
                        {submitting ? <span className="spinner" style={{ width: 18, height: 18 }} />
                          : payMethod === 'gateway' ? `Pay ${rupees(quote?.total || 0)} securely`
                          : isInstant ? `Pay ${rupees(quote?.total || 0)} & confirm` : 'Send booking request'}
                      </button>
                      <button className="btn btn-ghost btn-block" onClick={() => setStep(0)} disabled={submitting}>
                        Change slots
                      </button>
                    </div>
                  )}

                  <p className="text-faint center">
                    {isInstant ? 'Instant confirmation · free cancellation applies'
                               : 'No charge until the venue confirms'}
                  </p>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
