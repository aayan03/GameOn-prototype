import { z } from 'zod';
import mongoose from 'mongoose';
import { Venue, Booking, User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { BOOKING_STATUS } from '../config/constants.js';
import { buildAvailability, quoteBooking, refundFor, lookupPromo, takenSlotsFor } from '../services/booking.service.js';
import * as flow from '../services/bookingFlow.service.js';
import { loadVenueAndCourt, groupBookings } from '../services/bookingFlow.service.js';
import * as wallet from '../services/wallet.service.js';
import * as loyalty from '../services/loyalty.service.js';
import * as payments from '../services/payment.service.js';
import env, { isProd } from '../config/env.js';
import { isValidDateKey, todayKey } from '../utils/time.js';

/* ── Validation ──────────────────────────────────────────────── */

export const availabilitySchema = z.object({
  date: z.string().refine(isValidDateKey, 'date must be YYYY-MM-DD').optional(),
  courtId: z.string().optional(),
});

export const quoteSchema = z.object({
  venueId: z.string().min(1),
  courtId: z.string().min(1),
  date: z.string().refine(isValidDateKey, 'date must be YYYY-MM-DD'),
  starts: z.array(z.number().int().min(0).max(1439)).min(1).max(6),
  promoCode: z.string().max(24).optional(),
});

export const createBookingSchema = quoteSchema.extend({
  players: z.number().int().min(1).max(40).optional(),
  notes: z.string().max(500).optional(),
  /**
   * Three honest ways to pay, and no fourth.
   *
   * 'mock_upi' and 'mock_card' are gone. They presented themselves as UPI and
   * card payments and silently debited the wallet instead - the player picked
   * "UPI", was never asked to authorise anything, and the booking came back
   * paid. A button that names one payment method and quietly uses another is
   * not a simulation, it is a lie in the interface.
   *
   * 'gateway' is the real thing: the booking is created unpaid, Razorpay
   * collects, and /payments/verify marks it paid only once the signature
   * checks out. The Booking model still accepts the old values so existing
   * rows keep reading correctly; they just cannot be created any more.
   */
  paymentMethod: z.enum(['wallet', 'pay_at_venue', 'gateway']).default('wallet'),
});

export const cancelSchema = z.object({
  reason: z.string().max(300).optional(),
}).strict();

export const decisionSchema = z.object({
  decision: z.enum(['confirm', 'reject']),
}).strict();

/* ── Endpoints ───────────────────────────────────────────────── */

/**
 * GET /api/venues/:venueId/availability?date=YYYY-MM-DD&courtId=
 * The slot grid. Without courtId it returns the grid for every court.
 */
export const getAvailability = asyncHandler(async (req, res) => {
  const { venueId } = req.params;
  const { date = todayKey(), courtId } = req.validatedQuery || {};

  if (!mongoose.isValidObjectId(venueId)) throw ApiError.badRequest('Invalid venue id');
  const venue = await Venue.findById(venueId);
  if (!venue || !venue.isActive || ['pending', 'rejected'].includes(venue.moderationStatus)) {
    throw ApiError.notFound('Venue not found');
  }

  const courts = venue.courts.filter((c) => c.isActive !== false && (!courtId || String(c._id) === courtId));
  if (!courts.length) throw ApiError.notFound('No bookable courts found');

  // One query for the whole venue, shared by every court's grid below.
  const taken = await takenSlotsFor(venue, date);

  const grids = await Promise.all(courts.map(async (court) => {
    const grid = await buildAvailability(venue, court, date, taken);
    return {
      courtId: court._id,
      courtName: court.name,
      sport: court.sport,
      format: court.format,
      capacity: court.capacity,
      pricePerHour: court.pricePerHour,
      peakPricePerHour: court.peakPricePerHour,
      ...grid,
    };
  }));

  return ok(res, {
    date,
    venue: {
      id: venue._id, name: venue.name, slug: venue.slug,
      bookingMode: venue.bookingMode,
      slotDurationMins: venue.slotDurationMins,
      advanceBookingDays: venue.advanceBookingDays,
      cancellationPolicy: venue.cancellationPolicy,
      manualContact: venue.manualContact,
      address: venue.address,
      // The booking screen offers "pay at the venue" only where the venue
      // actually collects it; the API rejects it everywhere else.
      acceptsPayAtVenue: Boolean(venue.acceptsPayAtVenue),
    },
    courts: grids,
  });
});

/** POST /api/bookings/quote — price a selection before committing to it. */
export const quote = asyncHandler(async (req, res) => {
  const { venueId, courtId, date, starts, promoCode } = req.body;
  const { venue, court } = await loadVenueAndCourt(venueId, courtId);
  const q = await quoteBooking({
    venue, court, dateKey: date, starts, promoCode,
    tierKey: req.user.loyaltyTier, userId: req.user._id,
  });

  // `promoDoc` is the whole Promo record — the owner's id, its running
  // `usedCount`, its global cap. That is internal bookkeeping the quote
  // endpoint has no business handing to a browser.
  const { promoDoc: _promoDoc, promoOwner: _promoOwner, promoResolved: _promoResolved, ...publicQuote } = q;

  return ok(res, {
    ...publicQuote,
    courtName: court.name,
    sport: court.sport,
    venueName: venue.name,
    bookingMode: venue.bookingMode,
    walletBalance: req.user.walletBalance,
  });
});

export const createBooking = asyncHandler(async (req, res) => (
  created(res, await flow.createBooking(req.user, req.body))
));

/** GET /api/bookings — the signed-in user's bookings, grouped and split. */
/**
 * The history is bounded.
 *
 * This loaded EVERY row this user has ever created and grouped them in
 * memory. One slot is one document, so a regular player who books three
 * hours a week reaches four figures inside a year, and the response grows
 * without limit for as long as the account exists. The index makes the query
 * fast; nothing made the result small.
 *
 * Generous enough that a normal account never notices — and `hasMore` says so
 * honestly when one does, rather than silently truncating.
 */
const MY_BOOKINGS_LIMIT = 400;

export const myBookings = asyncHandler(async (req, res) => {
  const rows = await Booking.find({ user: req.user._id })
    .populate('venue', 'name slug address images bookingMode cancellationPolicy manualContact')
    .sort({ startsAt: -1 })
    .limit(MY_BOOKINGS_LIMIT + 1)
    .lean();

  const hasMore = rows.length > MY_BOOKINGS_LIMIT;
  if (hasMore) rows.length = MY_BOOKINGS_LIMIT;

  const groups = groupBookings(rows);
  const now = Date.now();

  const upcoming = [];
  const past = [];
  for (const g of groups) {
    const live = g.status === BOOKING_STATUS.PENDING || g.status === BOOKING_STATUS.CONFIRMED;
    if (live && new Date(g.endsAt).getTime() > now) {
      g.refundPreview = refundFor(
        {
          startsAt: g.startsAt,
          totalAmount: g.totalAmount,
          payment: g.payment,
          policySnapshot: g.policySnapshot,
        },
        g.venue
      );
      upcoming.push(g);
    } else {
      past.push(g);
    }
  }

  upcoming.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

  return ok(res, {
    upcoming,
    past,
    // True when older bookings exist beyond the window. The UI can say so
    // instead of quietly presenting a partial history as a complete one.
    hasMore,
    walletBalance: req.user.walletBalance,
  });
});

/** GET /api/bookings/:groupRef */
export const getBooking = asyncHandler(async (req, res) => {
  const rows = await Booking.find({ groupRef: req.params.groupRef })
    .populate('venue', 'name slug address images bookingMode cancellationPolicy manualContact')
    .lean();

  if (!rows.length) throw ApiError.notFound('Booking not found');
  if (String(rows[0].user) !== String(req.user._id) && req.user.role !== 'admin') {
    throw ApiError.forbidden('This booking belongs to someone else');
  }

  const [group] = groupBookings(rows);
  group.refundPreview = refundFor(
    {
      startsAt: group.startsAt,
      totalAmount: group.totalAmount,
      payment: group.payment,
      policySnapshot: group.policySnapshot,
    },
    group.venue
  );
  return ok(res, group);
});

export const cancelBooking = asyncHandler(async (req, res) => (
  ok(res, await flow.cancelBooking(req.user, req.params.groupRef, req.body))
));

/* ── Owner side: the assisted-booking queue ──────────────────── */

/** GET /api/bookings/owner/requests */
export const ownerRequests = asyncHandler(async (req, res) => {
  const venueIds = await Venue.find({ owner: req.user._id }).distinct('_id');

  const rows = await Booking.find({ venue: { $in: venueIds } })
    .populate('venue', 'name slug address')
    .populate('user', 'name email phone avatar reliabilityScore')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const groups = groupBookings(rows);
  // groupBookings drops the populated user, so re-attach it by groupRef.
  const userByGroup = new Map(rows.map((r) => [r.groupRef || r.bookingRef, r.user]));
  groups.forEach((g) => { g.player = userByGroup.get(g.groupRef); });

  return ok(res, {
    pending: groups.filter((g) => g.status === BOOKING_STATUS.PENDING),
    confirmed: groups.filter((g) => g.status === BOOKING_STATUS.CONFIRMED),
    other: groups.filter((g) => ![BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED].includes(g.status)),
  });
});

export const decideBooking = asyncHandler(async (req, res) => (
  ok(res, await flow.decideBooking(req.user, req.params.groupRef, req.body.decision))
));

export const settleCash = asyncHandler(async (req, res) => (
  ok(res, await flow.settleCash(req.user, req.params.groupRef))
));

/** GET /api/bookings/wallet — balance plus the ledger behind it. */
export const walletSummary = asyncHandler(async (req, res) => {
  const transactions = await wallet.ledger(req.user._id, 30);
  return ok(res, {
    balance: req.user.walletBalance,
    loyalty: loyalty.summarise(req.user),
    transactions,
  });
});

export const topUpSchema = z.object({
  amount: z.number().int().min(100, 'Minimum top-up is ₹100').max(20000, 'Maximum top-up is ₹20,000'),
}).strict();

const DAILY_TOPUP_CAP = 25000;

/**
 * POST /api/bookings/wallet/topup
 *
 * Simulated top-up standing in for a payment gateway. Because it mints
 * spendable balance with no external settlement, it is validated,
 * rate-limited, and capped per day — otherwise it is simply a faucet.
 * Replace this with a Razorpay order + webhook before taking real money.
 */
export const topUpWallet = asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const now = new Date();

  /**
   * The gate that stops this being a money printer.
   *
   * This endpoint creates spendable balance with nothing behind it — no card
   * charged, no settlement, no reconciliation. That is fine for a demo and
   * catastrophic on a live site: any account could grant itself unlimited
   * credit and spend it on real slots at real venues, and the venue would
   * still be owed real money at payout time.
   *
   * So in production it is closed unless someone deliberately opened it, and
   * `validateEnv` refuses to boot if it is open while a real gateway is
   * configured. With Razorpay live, the supported path is
   * POST /api/payments/order → checkout → POST /api/payments/verify.
   */
  if (isProd() && !env.ALLOW_SIMULATED_TOPUP) {
    throw new ApiError(
      501,
      payments.isLive()
        ? 'Top up by paying for a booking directly — card and UPI are enabled on this server.'
        : 'Wallet top-up is not available on this server.'
    );
  }

  // Roll the window over first if it has expired. Conditional, so a
  // concurrent request cannot reset it twice.
  await User.updateOne(
    { _id: req.user._id, $or: [{ 'topupWindow.resetAt': null }, { 'topupWindow.resetAt': { $lte: now } }] },
    { $set: { 'topupWindow.total': 0, 'topupWindow.resetAt': new Date(Date.now() + 24 * 3600 * 1000) } }
  );

  // Claim the headroom atomically — the cap lives in the filter, so parallel
  // requests cannot each see the same remaining allowance.
  const claimed = await User.findOneAndUpdate(
    { _id: req.user._id, 'topupWindow.total': { $lte: DAILY_TOPUP_CAP - amount } },
    { $inc: { 'topupWindow.total': amount } },
    { new: true }
  );

  if (!claimed) {
    const current = await User.findById(req.user._id).select('topupWindow').lean();
    const used = current?.topupWindow?.total || 0;
    throw ApiError.badRequest(
      `Daily top-up limit is ₹${DAILY_TOPUP_CAP.toLocaleString('en-IN')}. ` +
      `You have added ₹${used.toLocaleString('en-IN')} in the last 24 hours.`
    );
  }

  try {
    await wallet.credit(req.user, amount, { type: 'topup', description: 'Wallet top-up (demo)' });
  } catch (err) {
    // Give the headroom back if the credit failed.
    await User.updateOne({ _id: req.user._id }, { $inc: { 'topupWindow.total': -amount } });
    throw err;
  }

  return ok(res, { balance: req.user.walletBalance, message: `₹${amount} added to your wallet.` });
});

/** GET /api/bookings/promos — the codes a user can actually try. */
export const listPromos = asyncHandler(async (req, res) => {
  const codes = ['GAMEON50', 'FIRST20', 'WEEKEND15', 'SQUAD100'];
  return ok(res, codes.map((code) => ({ code, ...lookupPromo(code) })));
});
