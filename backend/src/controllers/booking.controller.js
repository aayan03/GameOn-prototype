import { z } from 'zod';
import mongoose from 'mongoose';
import { Venue, Booking, User, Promo } from '../models/index.js';
import { shortRef } from '../models/Booking.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { BOOKING_STATUS, BOOKING_MODES, LOYALTY, ROLES } from '../config/constants.js';
import { buildAvailability, quoteBooking, refundFor, lookupPromo, claimPromoUse, takenSlotsFor } from '../services/booking.service.js';
import * as wallet from '../services/wallet.service.js';
import * as loyalty from '../services/loyalty.service.js';
import * as notify from '../services/notification.service.js';
import * as payments from '../services/payment.service.js';
import * as refunds from '../services/refund.service.js';
import env, { isProd } from '../config/env.js';
import { isValidDateKey, todayKey, toLabel, toDate } from '../utils/time.js';
import { cleanText } from '../utils/sanitize.js';

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

/* ── Helpers ─────────────────────────────────────────────────── */

/**
 * How many slots one account may hold unpaid at any moment.
 *
 * Twelve is two full six-slot bookings, which is more than a real player ever
 * has outstanding — an unpaid slot is either a manual venue that has not
 * answered yet or a checkout in progress, and neither state lasts.
 */
const MAX_UNSETTLED_SLOTS = 12;

async function loadVenueAndCourt(venueId, courtId) {
  if (!mongoose.isValidObjectId(venueId)) throw ApiError.badRequest('Invalid venue id');
  const venue = await Venue.findById(venueId);
  if (!venue || !venue.isActive || ['pending', 'rejected'].includes(venue.moderationStatus)) {
    throw ApiError.notFound('Venue not found');
  }

  const court = venue.courts.id(courtId);
  if (!court || court.isActive === false) throw ApiError.notFound('Court not found at this venue');

  return { venue, court };
}

/** Collapses the per-slot documents of one booking back into a single object. */
function groupBookings(rows) {
  const groups = new Map();

  for (const b of rows) {
    const key = b.groupRef || b.bookingRef;
    if (!groups.has(key)) {
      groups.set(key, {
        groupRef: key,
        bookingRef: b.bookingRef,
        ids: [],
        venue: b.venue,
        courtName: b.courtName,
        sport: b.sport,
        date: b.date,
        status: b.status,
        mode: b.mode,
        players: b.players,
        payment: b.payment,
        cancellation: b.cancellation,
        // Carried through so refundFor sees the terms this booking was made
        // under, not whatever the venue publishes today.
        policySnapshot: b.policySnapshot,
        notes: b.notes,
        createdAt: b.createdAt,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        slots: [],
        amount: 0,
        platformFee: 0,
        discount: 0,
        totalAmount: 0,
      });
    }
    const g = groups.get(key);
    g.ids.push(b._id);
    g.slots.push({ start: b.startMinutes, end: b.endMinutes, label: toLabel(b.startMinutes), price: b.amount });
    g.amount += b.amount;
    g.platformFee += b.platformFee;
    g.discount += b.discount;
    g.totalAmount += b.totalAmount;
    if (new Date(b.startsAt) < new Date(g.startsAt)) g.startsAt = b.startsAt;
    if (new Date(b.endsAt) > new Date(g.endsAt)) g.endsAt = b.endsAt;
  }

  return [...groups.values()].map((g) => {
    g.slots.sort((a, b) => a.start - b.start);
    return g;
  });
}

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

/**
 * POST /api/bookings
 *
 * Automated venues confirm instantly and take payment. Manual venues create
 * a `pending` request that the owner confirms — no money moves until then,
 * which is the honest behaviour for a slot nobody has agreed to yet.
 */
export const createBooking = asyncHandler(async (req, res) => {
  const { venueId, courtId, date, starts, promoCode, players = 1, notes = '', paymentMethod } = req.body;
  const { venue, court } = await loadVenueAndCourt(venueId, courtId);

  /**
   * Cash at the gate is opt-in, per venue.
   *
   * This method reserves a slot with no money moving at all, so accepting it
   * everywhere meant a free, unlimited hold on any court in the catalogue.
   * The venue has to say it actually collects cash before anyone can book
   * that way. See the note on Venue.acceptsPayAtVenue.
   */
  if (paymentMethod === 'pay_at_venue' && !venue.acceptsPayAtVenue) {
    throw ApiError.badRequest('This venue does not take cash at the gate. Pay from your wallet, or by card or UPI.');
  }

  /**
   * A cap on how many unsettled slots one account may hold at once.
   *
   * Every individual guard below is about correctness — the right price, the
   * right promo, no double-booking. None of them bounds VOLUME, and volume is
   * the whole attack: hold every slot at every venue and the catalogue reads
   * as sold out while nobody has paid a rupee. The per-IP write limiter does
   * not help, because it is per IP and this is per account.
   *
   * Counted in slot-documents rather than groups, since that is what actually
   * occupies the grid. Generous enough that a regular player booking a few
   * fixtures ahead never meets it.
   */
  const heldSlots = await Booking.countDocuments({
    user: req.user._id,
    slotLocked: true,
    'payment.status': { $ne: 'paid' },
    endsAt: { $gte: new Date() },
  });
  if (heldSlots + starts.length > MAX_UNSETTLED_SLOTS) {
    throw ApiError.badRequest(
      `You already have ${heldSlots} unpaid slot${heldSlots === 1 ? '' : 's'} held. `
      + 'Pay for those or cancel them before booking more.'
    );
  }

  // Re-priced server-side at booking time with the promo re-checked, so a
  // quote taken before a code was exhausted cannot be replayed.
  const q = await quoteBooking({
    venue, court, dateKey: date, starts, promoCode,
    tierKey: req.user.loyaltyTier, userId: req.user._id,
  });

  const isInstant = venue.bookingMode === BOOKING_MODES.AUTOMATED;

  /**
   * A gateway booking is NOT confirmed by creating it.
   *
   * Razorpay has collected nothing at this point. Marking it confirmed here
   * meant that closing the checkout window left a booking that called itself
   * confirmed, printed a booking reference and rendered a QR code — a ticket
   * indistinguishable from a paid one, for money nobody had taken. Someone
   * could have turned up at the gate with it.
   *
   * It stays pending until /payments/verify has checked the signature, which
   * is the only moment we actually know the payment happened.
   */
  const awaitingPayment = paymentMethod === 'gateway';
  const confirmedNow = isInstant && !awaitingPayment;
  const status = confirmedNow ? BOOKING_STATUS.CONFIRMED : BOOKING_STATUS.PENDING;
  /**
   * Take the promo claim BEFORE writing any rows.
   *
   * `quoteBooking` re-checks the code, but that check is a read: two bookings
   * submitted together both saw "you have used this 0 times" and both got the
   * discount. This is the atomic half — and it runs first, so a code that is
   * exhausted costs nothing but a failed claim rather than a set of booking
   * rows that then have to be unwound.
   */
  const promoClaim = await claimPromoUse(q.promoResolved, promoCode, req.user._id);

  // Same reasoning as bookingRef — see the note on Booking.shortRef.
  const groupRef = shortRef('GRP');

  // Read once, written onto every row below. See Booking.policySnapshot.
  const policy = venue.cancellationPolicy || {
    freeCancellationHours: 24, partialRefundHours: 6, partialRefundPercent: 50,
  };

  // Spread the discount and fee proportionally across the slots so each
  // document's totalAmount sums back to the quoted total.
  const perSlot = q.slots.map((slot) => {
    const share = q.subtotal ? slot.price / q.subtotal : 1 / q.slots.length;
    const discount = Math.round(q.discount * share);
    const fee = Math.round(q.platformFee * share);
    return { slot, discount, fee, total: slot.price - discount + fee };
  });
  // Push any rounding remainder onto the first slot so the sum is exact.
  const drift = q.total - perSlot.reduce((s, p) => s + p.total, 0);
  if (perSlot.length) perSlot[0].total += drift;

  let docs;
  try {
    docs = await Booking.create(perSlot.map(({ slot, discount, fee, total }) => ({
      user: req.user._id,
      venue: venue._id,
      court: court._id,
      courtName: court.name,
      sport: court.sport,
      groupRef,
      groupSize: q.slots.length,
      date,
      startMinutes: slot.start,
      endMinutes: slot.end,
      startsAt: toDate(date, slot.start),
      endsAt: toDate(date, slot.end),
      mode: venue.bookingMode,
      status,
      slotLocked: true,
      players,
      notes,
      amount: slot.price,
      platformFee: fee,
      discount,
      totalAmount: total,
      promoCode: promoCode ? promoCode.toUpperCase() : '',
      promoOwner: q.promoOwner || null,
      confirmedAt: confirmedNow ? new Date() : null,
      // The terms this customer is agreeing to, frozen. The owner may edit
      // the venue's policy tomorrow; it does not reach back to this booking.
      policySnapshot: {
        freeCancellationHours: policy.freeCancellationHours,
        partialRefundHours: policy.partialRefundHours,
        partialRefundPercent: policy.partialRefundPercent,
      },
      payment: { method: paymentMethod, status: 'unpaid' },
    })));
  } catch (err) {
    // Booking.create() writes the documents one at a time, so a failure on
    // slot 3 can leave slots 1 and 2 already saved. Clear the whole group
    // before bailing out, or the user is charged nothing but the slots stay
    // locked forever.
    await Booking.deleteMany({ groupRef }).catch(() => {});
    // And give the promo use back, or a slot lost to a race silently burns
    // one of the customer's redemptions.
    await promoClaim.release();

    // The unique partial index fired — someone took a slot in the
    // milliseconds between the quote and the write.
    if (err.code === 11000) {
      throw ApiError.conflict('One of those slots was just booked by someone else. Please pick again.');
    }
    throw err;
  }

  // Instant venues charge immediately; manual ones wait for confirmation.
  //
  // Every method other than pay-at-venue settles against the wallet. The
  // "UPI" and "card" options are simulated gateways, but the money still has
  // to come from somewhere real — marking a booking paid without debiting
  // anything, and then refunding it as wallet credit, is a money printer.
  // Neither pay-at-venue nor gateway settles against the wallet here: the
  // first is cash at the gate, the second is money Razorpay has not collected
  // yet. Debiting for a gateway booking would charge twice.
  const settlesFromWallet = paymentMethod !== 'pay_at_venue' && paymentMethod !== 'gateway';
  if (isInstant && settlesFromWallet && q.total > 0) {
    try {
      await wallet.debit(req.user, q.total, {
        booking: docs[0],
        description: `${venue.name} — ${court.name}, ${q.slots.length} slot(s)`,
      });

      const txnId = shortRef('TXN');
      // A single aggregation-pipeline update, so `amountPaid` is written in
      // the same operation that marks the rows paid. The earlier two-phase
      // version could die between them and leave a paid booking with
      // amountPaid = 0, which is permanently unrefundable.
      await Booking.updateMany({ groupRef }, [{
        $set: {
          'payment.status': 'paid',
          'payment.paidAt': '$$NOW',
          'payment.transactionId': txnId,
          'payment.amountPaid': '$totalAmount',
        },
      }]);
      for (const d of docs) {
        d.payment.status = 'paid';
        d.payment.transactionId = txnId;
        d.payment.amountPaid = d.totalAmount;
      }
    } catch (err) {
      // Payment failed — release the slots rather than holding them hostage.
      await Booking.updateMany({ groupRef }, { $set: { status: BOOKING_STATUS.CANCELLED, slotLocked: false } });
      await promoClaim.release();
      throw ApiError.badRequest(err.message || 'Payment failed. The slots have been released.');
    }
  }

  await Venue.updateOne({ _id: venue._id }, { $inc: { bookingCount: q.slots.length } });

  // Owner promos carry a global claim limit, so a successful booking has to
  // count against it. The filter re-checks the cap, so an over-claim under
  // concurrency simply does not increment.
  if (q.promoDoc) {
    await Promo.updateOne(
      {
        _id: q.promoDoc._id,
        $or: [{ totalUseLimit: null }, { $expr: { $lt: ['$usedCount', '$totalUseLimit'] } }],
      },
      { $inc: { usedCount: 1 } }
    );
  }

  // Points are only awarded once money has actually moved. A pending request
  // at a manual venue earns nothing until the owner confirms it.
  let loyaltyResult = null;
  if (isInstant && docs[0]?.payment?.status === 'paid') {
    loyaltyResult = await loyalty.award(req.user, q.pointsToEarn, {
      reason: venue.name, booking: docs[0],
    });
    // On ONE row, not all of them. `updateMany` wrote the group total onto
    // every slot, and cancellation sums the field across rows — so a 3-slot
    // booking that earned 90 points had 270 clawed back.
    await Booking.updateOne({ _id: docs[0]._id }, { $set: { pointsAwarded: q.pointsToEarn } });
  }

  // Not `booking_reminder` — a request awaiting the venue is not a reminder,
  // and typing it as one gave it an alarm-clock icon and made it
  // indistinguishable from the day-before nudge in the notification list.
  await notify.notify(req.user._id, confirmedNow ? 'booking_confirmed' : 'booking_requested', {
    title: awaitingPayment ? 'Finish your payment'
      : confirmedNow ? 'Booking confirmed' : 'Request sent',
    body: awaitingPayment
      ? `Your slot at ${venue.name} is held until you pay. Tap to finish.`
      : confirmedNow
        ? `${venue.name} on ${date}. Tap for your ticket.`
        : `${venue.name} will confirm shortly. Nothing has been charged.`,
    link: `/bookings/${groupRef}`,
  });

  // The owner needs to know a request is waiting.
  if (!isInstant) {
    await notify.notify(venue.owner, 'teamup_request', {
      title: 'New booking request',
      body: `${req.user.name} requested ${court.name} at ${venue.name} on ${date}.`,
      link: '/owner/requests',
      icon: '📞',
    });
  }

  const [group] = groupBookings(docs.map((d) => d.toObject()));
  group.venue = {
    _id: venue._id, name: venue.name, slug: venue.slug,
    address: venue.address, images: venue.images, manualContact: venue.manualContact,
  };

  return created(res, {
    booking: group,
    walletBalance: req.user.walletBalance,
    loyalty: loyaltyResult,
    loyaltyPoints: req.user.loyaltyPoints,
    loyaltyTier: req.user.loyaltyTier,
    message: awaitingPayment
      ? 'Slot held. Complete the payment to confirm it.'
      : confirmedNow
        ? 'Booking confirmed. See you on the pitch.'
        : `Request sent. ${venue.name} usually confirms within ${venue.manualContact?.responseTimeMins || 30} minutes.`,
  });
});

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

/**
 * PATCH /api/bookings/:groupRef/cancel
 * Refund follows the venue's published policy, calculated at cancellation time.
 */
export const cancelBooking = asyncHandler(async (req, res) => {
  const rows = await Booking.find({ groupRef: req.params.groupRef });
  if (!rows.length) throw ApiError.notFound('Booking not found');

  const isOwnerOfBooking = String(rows[0].user) === String(req.user._id);
  if (!isOwnerOfBooking && req.user.role !== 'admin') {
    throw ApiError.forbidden('This booking belongs to someone else');
  }

  const live = rows.filter((b) => b.status === BOOKING_STATUS.PENDING || b.status === BOOKING_STATUS.CONFIRMED);
  if (!live.length) throw ApiError.badRequest('This booking is already cancelled or completed');

  const venue = await Venue.findById(rows[0].venue);
  // Only ever refund what was actually taken, not the quoted total.
  const totalPaid = live.reduce((s, b) => s + (b.payment?.amountPaid || 0), 0);
  const refund = refundFor(
    {
      startsAt: live[0].startsAt,
      totalAmount: totalPaid,
      payment: live[0].payment,
      // The terms as they stood when this booking was made — not whatever
      // the venue publishes now. See Booking.policySnapshot.
      policySnapshot: live[0].policySnapshot,
    },
    venue
  );

  const now = new Date();

  // Flip every live row in ONE conditional update. Two concurrent cancels
  // both used to pass the check above and both issue a full refund; now the
  // database decides, and only the request whose update actually modified
  // rows goes on to move money.
  const flip = await Booking.updateMany(
    { groupRef: req.params.groupRef, status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED] } },
    {
      $set: {
        status: BOOKING_STATUS.CANCELLED,
        slotLocked: false,                      // frees the slot for everyone else
        'cancellation.cancelledAt': now,
        'cancellation.cancelledBy': req.user._id,
        'cancellation.reason': cleanText(req.body.reason || '', 300),
      },
    }
  );

  if (!flip.modifiedCount) {
    throw ApiError.badRequest('This booking has already been cancelled');
  }

  // Take back any points this booking earned, so book-then-cancel cannot be
  // used to farm tier status.
  //
  // If those points were already spent, `revoke` can only claw back what is
  // left. The unrecoverable remainder is deducted from the refund at the
  // redemption rate — otherwise redeem-then-cancel converts a free booking
  // into free wallet credit.
  const earned = live.reduce((sum, b) => sum + (b.pointsAwarded || 0), 0);
  let pointsShortfallRupees = 0;
  if (earned > 0) {
    const rev = await loyalty.revoke(rows[0].user, earned, { reason: `Cancelled — ${venue?.name || 'venue'}` });
    const shortfall = Math.max(0, earned - (rev?.revoked || 0));
    pointsShortfallRupees = Math.floor(shortfall / LOYALTY.POINTS_PER_RUPEE);
    await Booking.updateMany({ groupRef: req.params.groupRef }, { $set: { pointsAwarded: 0 } });
  }

  const payable = Math.max(0, refund.amount - pointsShortfallRupees);

  const bookingUser = isOwnerOfBooking ? req.user : await User.findById(rows[0].user);

  // Money goes back the way it came — see services/refund.service.js. A card
  // payment is refunded through Razorpay to the card; only a wallet payment
  // returns to the wallet. This used to credit the wallet unconditionally,
  // which turned a refund into store credit the customer could never withdraw.
  const issued = await refunds.issueRefund({
    groupRef: req.params.groupRef,
    rows: live,
    amount: payable,
    user: bookingUser,
    description: `Refund — ${venue?.name || 'venue'} (${refund.percent}%)`,
    reference: live[0].bookingRef || '',
  });

  const where = issued.method === 'gateway'
    ? 'back to the card or UPI account you paid with, within 5–7 working days'
    : 'back in your wallet';

  await notify.notify(rows[0].user, 'booking_cancelled', {
    body: issued.refunded > 0
      ? `Your booking at ${venue?.name || 'the venue'} was cancelled. ₹${issued.refunded} is ${where}.`
      : `Your booking at ${venue?.name || 'the venue'} was cancelled.`,
    link: '/bookings',
  });

  return ok(res, {
    cancelled: true,
    refund: {
      ...refund,
      amount: issued.refunded,
      pointsAdjustment: pointsShortfallRupees,
      method: issued.method,
      reference: issued.reference,
    },
    // The booking's owner, which is not the caller when an admin cancels.
    walletBalance: bookingUser.walletBalance,
    message: issued.refunded > 0
      ? `Booking cancelled. ₹${issued.refunded} is ${where}.`
      : 'Booking cancelled.',
  });
});

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

/** PATCH /api/bookings/:groupRef/decision  { decision: 'confirm' | 'reject' } */
export const decideBooking = asyncHandler(async (req, res) => {
  const { decision } = req.body;

  const rows = await Booking.find({ groupRef: req.params.groupRef });
  if (!rows.length) throw ApiError.notFound('Booking not found');

  const venue = await Venue.findById(rows[0].venue);
  if (!venue) throw ApiError.notFound('Venue not found');
  if (String(venue.owner) !== String(req.user._id) && req.user.role !== 'admin') {
    throw ApiError.forbidden('You can only manage bookings at your own venues');
  }

  const pending = rows.filter((b) => b.status === BOOKING_STATUS.PENDING);
  if (!pending.length) throw ApiError.badRequest('This request has already been handled');

  if (decision === 'reject') {
    // One conditional update, not a save() per row. Two owners tapping
    // Decline at once both passed the check above and both ran the refund
    // below; now the database picks a winner and only the call that actually
    // flipped rows moves money.
    const flip = await Booking.updateMany(
      { groupRef: req.params.groupRef, status: BOOKING_STATUS.PENDING },
      { $set: { status: BOOKING_STATUS.REJECTED, slotLocked: false } }
    );
    if (!flip.modifiedCount) {
      throw ApiError.conflict('That request changed while you were declining it. Reload and try again.');
    }

    // A manual booking CAN already be paid: the player may have completed a
    // card/UPI checkout while the request sat in the queue. Declining it
    // without returning that money left the player charged for a slot the
    // venue refused, with the notification cheerfully telling them nothing
    // had been taken. Refund in full — the venue said no, so no cancellation
    // policy applies.
    //
    // Summed from the rows THIS call actually rejected, re-read after the
    // flip, rather than from the `pending` snapshot taken before it. A cancel
    // landing in between flips some of those rows to CANCELLED, and the stale
    // snapshot would still have counted their money — refunding more than was
    // rejected, on top of whatever the cancellation had already paid back.
    const rejected = await Booking.find({
      groupRef: req.params.groupRef,
      status: BOOKING_STATUS.REJECTED,
      'cancellation.refundStatus': 'none',
    }).select('_id payment pointsAwarded').lean();

    const paid = rejected.reduce((sum, b) => sum + (b.payment?.amountPaid || 0), 0);
    let issued = { refunded: 0, method: 'none' };
    if (paid > 0) {
      // Back to the card if that is where it came from — same service as a
      // cancellation, so a declined booking cannot quietly become store credit.
      const player = await User.findById(rows[0].user);
      issued = await refunds.issueRefund({
        groupRef: req.params.groupRef,
        rows: rejected,
        amount: paid,
        user: player,
        description: `Refund — ${venue.name} declined the request`,
        reference: rejected[0].bookingRef || '',
      });
    }

    // Points can only have been awarded if the payment went through. Take
    // them back with the money, or a declined booking leaves free tier
    // progress behind it. Same rows as the refund, for the same reason.
    const earned = rejected.reduce((sum, b) => sum + (b.pointsAwarded || 0), 0);
    if (earned > 0) {
      await loyalty.revoke(rows[0].user, earned, { reason: `Declined — ${venue.name}` });
      await Booking.updateMany({ groupRef: req.params.groupRef }, { $set: { pointsAwarded: 0 } });
    }

    const backTo = issued.method === 'gateway'
      ? 'back to the card or UPI account you paid with, within 5–7 working days'
      : 'back in your wallet';

    await notify.notify(rows[0].user, 'booking_rejected', {
      body: issued.refunded > 0
        ? `${venue.name} could not take your booking. ₹${issued.refunded} is ${backTo}.`
        : `${venue.name} could not take your booking. Nothing was charged.`,
      link: '/bookings',
    });
    return ok(res, {
      status: 'rejected',
      refunded: issued.refunded,
      refundMethod: issued.method,
      message: issued.refunded > 0
        ? `Request declined, the slot released, and ₹${issued.refunded} refunded to the player.`
        : 'Request declined and the slot released.',
    });
  }

  // Confirming a manual booking is when payment is actually taken.
  const player = await User.findById(rows[0].user);
  const total = pending.reduce((s, b) => s + b.totalAmount, 0);

  const method = pending[0].payment.method;
  // Already settled — through Razorpay, or by a webhook that landed before
  // the owner got to the request. Confirming must not collect it a SECOND
  // time. Asking only "which method is this?" charged the wallet again for a
  // card payment that had already gone through: the player picked UPI, paid
  // Razorpay, and the owner tapping Confirm silently took the same amount out
  // of their GameOn balance.
  const alreadyPaid = pending[0].payment.status === 'paid';

  // Cash at the gate is settled by the owner later, via /settle.
  // A gateway booking is collected by Razorpay, never from the wallet — the
  // player chose card or UPI, and debiting their balance instead is the same
  // lie the mock_upi method was removed for.
  const collectsFromWallet = method !== 'pay_at_venue' && method !== 'gateway';
  const chargeable = collectsFromWallet && !alreadyPaid && total > 0;
  let charged = false;

  if (chargeable) {
    if (player.walletBalance < total) {
      // Do not confirm a booking we cannot collect for — say so instead of
      // silently marking it paid.
      return ok(res, {
        status: 'awaiting_payment',
        message: `${player.name} does not have enough balance to cover ₹${total}. Ask them to top up, or switch the booking to pay-at-venue.`,
      });
    }
    await wallet.debit(player, total, {
      booking: pending[0], description: `${venue.name} — confirmed by venue`,
    });
    charged = true;
  }

  // An unpaid gateway booking is confirmed, but the money is still owed
  // through the gateway. Say so plainly rather than confirming it as though
  // it were settled — the player still has to finish checkout.
  const awaitingGateway = method === 'gateway' && !alreadyPaid && total > 0;

  const txnId = shortRef('TXN');

  // Conditional update rather than save(): a cancel landing between the read
  // and the write must not be overwritten, and two confirms must not both
  // apply. The filter is the guard.
  const confirmSet = {
    status: BOOKING_STATUS.CONFIRMED,
    confirmedAt: new Date(),
    slotLocked: true,
  };
  if (charged) {
    Object.assign(confirmSet, {
      'payment.status': 'paid',
      'payment.paidAt': new Date(),
      'payment.transactionId': txnId,
    });
  }

  const applied = await Booking.updateMany(
    { groupRef: req.params.groupRef, status: BOOKING_STATUS.PENDING },
    charged
      ? [{ $set: { ...confirmSet, 'payment.amountPaid': '$totalAmount' } }]
      : { $set: confirmSet }
  );

  if (!applied.modifiedCount) {
    // Someone cancelled or confirmed it while we were collecting payment.
    if (charged) {
      await wallet.credit(player, total, {
        type: 'refund', description: `${venue.name} — confirmation could not be applied`,
      });
    }
    throw ApiError.conflict('That request changed while you were confirming it. Reload and try again.');
  }

  // Now that the assisted booking is real and paid, it earns points.
  if (charged) {
    const pts = loyalty.pointsForSpend(total, player.loyaltyTier);
    await loyalty.award(player, pts, { reason: venue.name, booking: pending[0] });
    // One row only — see the note in createBooking.
    await Booking.updateOne({ _id: pending[0]._id }, { $set: { pointsAwarded: pts } });
  }

  await notify.notify(player._id, 'booking_confirmed', {
    title: awaitingGateway ? 'Confirmed — finish your payment' : undefined,
    body: awaitingGateway
      ? `${venue.name} confirmed your booking. Tap to complete the payment and get your ticket.`
      : `${venue.name} confirmed your booking. Tap for your ticket.`,
    link: `/bookings/${req.params.groupRef}`,
  });

  return ok(res, {
    status: 'confirmed',
    awaitingPayment: awaitingGateway,
    message: awaitingGateway
      ? 'Booking confirmed. The player still has to complete their card/UPI payment — they have been told.'
      : 'Booking confirmed. The player has been notified.',
  });
});

/**
 * PATCH /api/bookings/:groupRef/settle — the owner records cash taken at the gate.
 *
 * Pay-at-venue bookings were a hole in two directions. The owner's revenue
 * chart guessed at them, and because nothing recorded that money ever changed
 * hands, a player could reserve a slot, never turn up, and still post a review
 * once the lifecycle job marked the booking complete. This is the moment the
 * cash is acknowledged: it makes the revenue real and the review earned.
 */
export const settleCash = asyncHandler(async (req, res) => {
  const rows = await Booking.find({ groupRef: req.params.groupRef });
  if (!rows.length) throw ApiError.notFound('Booking not found');

  const venue = await Venue.findById(rows[0].venue).select('owner name');
  if (!venue) throw ApiError.notFound('Venue not found');
  if (String(venue.owner) !== String(req.user._id) && req.user.role !== ROLES.ADMIN) {
    throw ApiError.forbidden('That booking is not at your venue');
  }

  if (rows[0].payment?.method !== 'pay_at_venue') {
    throw ApiError.badRequest('This booking was already paid online');
  }

  const settleable = [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED];
  if (!settleable.includes(rows[0].status)) {
    throw ApiError.badRequest('Only a confirmed or completed booking can be settled');
  }

  // Conditional on still being unpaid, so two taps on the owner's phone
  // cannot record the same cash twice.
  const now = new Date();
  const flip = await Booking.updateMany(
    {
      groupRef: req.params.groupRef,
      status: { $in: settleable },
      'payment.status': { $ne: 'paid' },
    },
    [{
      $set: {
        'payment.status': 'paid',
        'payment.paidAt': now,
        // The real figure per row, not the group total on every row.
        'payment.amountPaid': '$totalAmount',
      },
    }]
  );

  if (!flip.modifiedCount) {
    throw ApiError.badRequest('This booking is already marked as paid');
  }

  // Re-read what THIS call actually settled, stamped with this call's
  // timestamp. `updateMany` is not atomic across documents, so summing the
  // pre-read rows would report — and award points on — slots a previous
  // partial run had already marked paid.
  const settled = await Booking.find({
    groupRef: req.params.groupRef,
    'payment.paidAt': now,
  }).select('_id user totalAmount endsAt pointsAwarded').lean();

  const total = settled.reduce((sum, b) => sum + (b.totalAmount || 0), 0);

  // Cash at the gate earns points exactly like a wallet payment would, but
  // only once — `pointsAwarded` is already set if some other path awarded.
  const alreadyAwarded = rows.reduce((sum, b) => sum + (b.pointsAwarded || 0), 0);
  let awarded = null;
  if (!alreadyAwarded && total > 0) {
    const player = await User.findById(rows[0].user);
    if (player) {
      const pts = loyalty.pointsForSpend(total, player.loyaltyTier);
      awarded = await loyalty.award(player, pts, { reason: venue.name, booking: rows[0] });
      // One row only — see the note in createBooking.
      await Booking.updateOne({ _id: rows[0]._id }, { $set: { pointsAwarded: pts } });
    }
  }

  // Only promise a review once the game has actually finished. Settling a
  // booking an hour before kickoff and saying "you can now leave a review"
  // sent the player into a 403 telling them to ask the venue to settle it.
  const played = new Date(rows[0].endsAt) <= now;

  await notify.notify(rows[0].user, 'booking_confirmed', {
    title: 'Payment recorded',
    body: played
      ? `${venue.name} marked ₹${total} as paid. You can now leave a review.`
      : `${venue.name} marked ₹${total} as paid. See you on the pitch.`,
    link: `/bookings/${req.params.groupRef}`,
    icon: '💸',
  });

  return ok(res, {
    settled: true,
    amount: total,
    loyalty: awarded,
    message: `₹${total} recorded as collected.`,
  });
});

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
