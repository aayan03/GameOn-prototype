import { z } from 'zod';
import mongoose from 'mongoose';
import { Venue, Booking, User, Promo } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { BOOKING_STATUS, BOOKING_MODES, LOYALTY, ROLES } from '../config/constants.js';
import { buildAvailability, quoteBooking, refundFor, lookupPromo } from '../services/booking.service.js';
import * as wallet from '../services/wallet.service.js';
import * as loyalty from '../services/loyalty.service.js';
import * as notify from '../services/notification.service.js';
import * as payments from '../services/payment.service.js';
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
  paymentMethod: z.enum(['wallet', 'mock_upi', 'mock_card', 'pay_at_venue']).default('wallet'),
});

export const cancelSchema = z.object({
  reason: z.string().max(300).optional(),
}).strict();

export const decisionSchema = z.object({
  decision: z.enum(['confirm', 'reject']),
}).strict();

/* ── Helpers ─────────────────────────────────────────────────── */

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

  const grids = await Promise.all(courts.map(async (court) => {
    const grid = await buildAvailability(venue, court, date);
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
  const { promoDoc: _promoDoc, promoOwner: _promoOwner, ...publicQuote } = q;

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

  // Re-priced server-side at booking time with the promo re-checked, so a
  // quote taken before a code was exhausted cannot be replayed.
  const q = await quoteBooking({
    venue, court, dateKey: date, starts, promoCode,
    tierKey: req.user.loyaltyTier, userId: req.user._id,
  });

  const isInstant = venue.bookingMode === BOOKING_MODES.AUTOMATED;
  const status = isInstant ? BOOKING_STATUS.CONFIRMED : BOOKING_STATUS.PENDING;
  const groupRef = 'GRP' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

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
      confirmedAt: isInstant ? new Date() : null,
      payment: { method: paymentMethod, status: 'unpaid' },
    })));
  } catch (err) {
    // Booking.create() writes the documents one at a time, so a failure on
    // slot 3 can leave slots 1 and 2 already saved. Clear the whole group
    // before bailing out, or the user is charged nothing but the slots stay
    // locked forever.
    await Booking.deleteMany({ groupRef }).catch(() => {});

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
  if (isInstant && paymentMethod !== 'pay_at_venue' && q.total > 0) {
    try {
      await wallet.debit(req.user, q.total, {
        booking: docs[0],
        description: `${venue.name} — ${court.name}, ${q.slots.length} slot(s)`,
      });

      const txnId = 'TXN' + Date.now().toString(36).toUpperCase();
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
  await notify.notify(req.user._id, isInstant ? 'booking_confirmed' : 'booking_requested', {
    title: isInstant ? 'Booking confirmed' : 'Request sent',
    body: isInstant
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
    message: isInstant
      ? 'Booking confirmed. See you on the pitch.'
      : `Request sent. ${venue.name} usually confirms within ${venue.manualContact?.responseTimeMins || 30} minutes.`,
  });
});

/** GET /api/bookings — the signed-in user's bookings, grouped and split. */
export const myBookings = asyncHandler(async (req, res) => {
  const rows = await Booking.find({ user: req.user._id })
    .populate('venue', 'name slug address images bookingMode cancellationPolicy manualContact')
    .sort({ startsAt: -1 })
    .lean();

  const groups = groupBookings(rows);
  const now = Date.now();

  const upcoming = [];
  const past = [];
  for (const g of groups) {
    const live = g.status === BOOKING_STATUS.PENDING || g.status === BOOKING_STATUS.CONFIRMED;
    if (live && new Date(g.endsAt).getTime() > now) {
      g.refundPreview = refundFor(
        { startsAt: g.startsAt, totalAmount: g.totalAmount, payment: g.payment },
        g.venue
      );
      upcoming.push(g);
    } else {
      past.push(g);
    }
  }

  upcoming.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

  return ok(res, { upcoming, past, walletBalance: req.user.walletBalance });
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
    { startsAt: group.startsAt, totalAmount: group.totalAmount, payment: group.payment },
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
    { startsAt: live[0].startsAt, totalAmount: totalPaid, payment: live[0].payment },
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

  // Record what was actually refunded, on every row of the group, and only
  // after the true figure is known.
  await Booking.updateMany(
    { groupRef: req.params.groupRef, status: BOOKING_STATUS.CANCELLED },
    { $set: { 'cancellation.refundStatus': payable > 0 ? 'processed' : 'none' } }
  );

  const bookingUser = isOwnerOfBooking ? req.user : await User.findById(rows[0].user);

  if (payable > 0) {
    await Booking.updateOne(
      { _id: live[0]._id },
      { $set: { 'cancellation.refundAmount': payable } }
    );

    // Every payment method other than pay-at-venue settles against the wallet,
    // so every refund returns there. Refunding to "the original method" when
    // there is no gateway behind it would simply destroy the user's money.
    await wallet.credit(bookingUser, payable, {
      type: 'refund', booking: live[0],
      description: `Refund — ${venue?.name || 'venue'} (${refund.percent}%)`,
    });
  }

  await notify.notify(rows[0].user, 'booking_cancelled', {
    body: payable > 0
      ? `Your booking at ${venue?.name || 'the venue'} was cancelled. ₹${payable} is back in your wallet.`
      : `Your booking at ${venue?.name || 'the venue'} was cancelled.`,
    link: '/bookings',
  });

  return ok(res, {
    cancelled: true,
    refund: { ...refund, amount: payable, pointsAdjustment: pointsShortfallRupees },
    // The booking's owner, which is not the caller when an admin cancels.
    walletBalance: bookingUser.walletBalance,
    message: payable > 0
      ? `Booking cancelled. ₹${payable} is back in your wallet.`
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
    for (const b of pending) {
      b.status = BOOKING_STATUS.REJECTED;
      b.slotLocked = false;
      await b.save();
    }
    await notify.notify(rows[0].user, 'booking_rejected', {
      body: `${venue.name} could not take your booking. Nothing was charged.`,
      link: '/bookings',
    });
    return ok(res, { status: 'rejected', message: 'Request declined and the slot released.' });
  }

  // Confirming a manual booking is when payment is actually taken.
  const player = await User.findById(rows[0].user);
  const total = pending.reduce((s, b) => s + b.totalAmount, 0);

  const chargeable = pending[0].payment.method !== 'pay_at_venue' && total > 0;
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

  const txnId = 'TXN' + Date.now().toString(36).toUpperCase();

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
    body: `${venue.name} confirmed your booking. Tap for your ticket.`,
    link: `/bookings/${req.params.groupRef}`,
  });

  return ok(res, { status: 'confirmed', message: 'Booking confirmed. The player has been notified.' });
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
