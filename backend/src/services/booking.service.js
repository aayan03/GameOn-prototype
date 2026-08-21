import { Booking, Promo } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import {
  toMinutes, toHHMM, toLabel, dayOfWeek, toDate, isPeak,
  todayKey, minutesNow, daysBetween,
} from '../utils/time.js';
import { BOOKING_STATUS } from '../config/constants.js';
import { discountedFee, bonusBookingDays, pointsForSpend } from './loyalty.service.js';

export const PLATFORM_FEE_PERCENT = 3;

/**
 * Promo codes. In Phase 4 these move to a collection owners manage; the
 * shape is kept identical so the swap is a lookup change, nothing more.
 */
const PROMOS = {
  GAMEON50:  { type: 'flat',    value: 50,  minAmount: 300,  maxUses: 5, label: '₹50 off your booking' },
  // firstBookingOnly is enforced against the user's booking history, not just
  // named — an offer called "FIRST" that works forever is just a discount.
  FIRST20:   { type: 'percent', value: 20,  maxDiscount: 200, minAmount: 0, firstBookingOnly: true, label: '20% off your first booking' },
  WEEKEND15: { type: 'percent', value: 15,  maxDiscount: 300, minAmount: 500, maxUses: 4, label: '15% off weekend games' },
  SQUAD100:  { type: 'flat',    value: 100, minAmount: 800,  maxUses: 3, label: '₹100 off for big squads' },
};

export function lookupPromo(code) {
  if (!code) return null;
  return PROMOS[String(code).trim().toUpperCase()] || null;
}

/**
 * Resolves a code to either a platform promo or one this venue's owner runs.
 * Owner promos win, so an owner can override a platform code at their venue.
 */
export async function resolvePromo(code, venue) {
  if (!code) return null;
  const upper = String(code).trim().toUpperCase();

  const owned = await Promo.findOne({ code: upper, owner: venue.owner, isActive: true });
  if (owned) {
    if (!owned.isLive()) throw ApiError.badRequest('That code is no longer available');
    if (owned.venues?.length && !owned.venues.some((v) => String(v) === String(venue._id))) {
      throw ApiError.badRequest('That code does not apply at this venue');
    }
    return {
      source: 'owner',
      doc: owned,
      type: owned.type,
      value: owned.value,
      maxDiscount: owned.maxDiscount ?? Infinity,
      minAmount: owned.minAmount || 0,
      maxUses: owned.maxUsesPerUser,
      label: owned.description || `${owned.type === 'flat' ? '₹' + owned.value : owned.value + '%'} off`,
    };
  }

  const platform = PROMOS[upper];
  return platform ? { source: 'platform', ...platform } : null;
}

/** Blackout windows make a slot unbookable without cancelling anything. */
function isBlackedOut(venue, court, dateKey, start) {
  return (venue.blackouts || []).some((b) => {
    if (b.date !== dateKey) return false;
    if (b.court && String(b.court) !== String(court._id)) return false;
    if (b.startMinutes == null) return true;           // whole day
    return start >= b.startMinutes && start < b.endMinutes;
  });
}

/** What a single slot costs on this court, at this time. */
export function priceFor(court, dateKey, startMinutes, slotMins) {
  const peak = isPeak(dateKey, startMinutes) && court.peakPricePerHour;
  const hourly = peak ? court.peakPricePerHour : court.pricePerHour;
  return {
    amount: Math.round((hourly * slotMins) / 60),
    isPeak: Boolean(peak),
    hourly,
  };
}

/**
 * Builds the slot grid for one court on one date.
 *
 * Generates every slot the venue's operating hours allow, then marks the ones
 * already taken. A slot is `available` only if nothing holds it and it hasn't
 * already passed.
 */
export async function buildAvailability(venue, court, dateKey) {
  const dow = dayOfWeek(dateKey);
  const hours = venue.operatingHours?.find((h) => h.day === dow);
  const slotMins = venue.slotDurationMins || 60;

  if (!hours || hours.isClosed) {
    return { slots: [], closed: true, slotDurationMins: slotMins };
  }

  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);

  // Every live booking for this court on this date, in one query.
  const taken = await Booking.find({
    court: court._id,
    date: dateKey,
    slotLocked: true,
  }).select('startMinutes endMinutes status').lean();

  const takenStarts = new Map(taken.map((b) => [b.startMinutes, b.status]));

  const isToday = dateKey === todayKey();
  const nowMins = minutesNow();

  const slots = [];
  for (let start = open; start + slotMins <= close; start += slotMins) {
    const { amount, isPeak: peak } = priceFor(court, dateKey, start, slotMins);
    const heldBy = takenStarts.get(start);
    // A 15-minute grace period stops a slot vanishing the second it starts.
    const isPast = isToday && start < nowMins - 15;

    const blocked = isBlackedOut(venue, court, dateKey, start);

    slots.push({
      start,
      end: start + slotMins,
      time: toHHMM(start),
      label: toLabel(start),
      endLabel: toLabel(start + slotMins),
      price: amount,
      isPeak: peak,
      status: heldBy ? (heldBy === BOOKING_STATUS.PENDING ? 'held' : 'booked')
             : blocked ? 'blocked'
             : isPast ? 'past'
             : 'available',
    });
  }

  return { slots, closed: false, slotDurationMins: slotMins, opens: hours.open, closes: hours.close };
}

/**
 * Validates a set of requested slots and prices the whole booking.
 * Throws before anything is written if the request doesn't hold up.
 */
/**
 * Checks a promo code against this user's history.
 * Runs at quote time AND at booking time, so a stale quote cannot be replayed.
 */
async function assertPromoUsable(promo, code, userId) {
  if (!userId) return;

  // Note: cancelled and rejected bookings deliberately COUNT here. Excluding
  // them means book-then-cancel resets the offer, and a 100% refund makes
  // that free — which turns a one-time code into an unlimited discount.
  if (promo.firstBookingOnly) {
    const hasBooked = await Booking.exists({ user: userId });
    if (hasBooked) {
      throw ApiError.badRequest('That code is for your first booking only');
    }
  }

  if (promo.maxUses) {
    // Scope by the promo's owner as well as the code. Codes are unique per
    // owner, so matching the bare string let one owner's "SUMMER20" exhaust
    // a different owner's identically-named offer for every user.
    const used = await Booking.distinct('groupRef', {
      user: userId,
      promoCode: code.toUpperCase(),
      ...(promo.doc ? { promoOwner: promo.doc.owner } : { promoOwner: null }),
    });
    if (used.length >= promo.maxUses) {
      throw ApiError.badRequest(`You have already used ${code.toUpperCase()} the maximum number of times`);
    }
  }

  // Owner promos also carry a global cap.
  if (promo.doc && promo.doc.totalUseLimit !== null && promo.doc.usedCount >= promo.doc.totalUseLimit) {
    throw ApiError.badRequest('That code has been fully claimed');
  }
}

export async function quoteBooking({ venue, court, dateKey, starts, promoCode, tierKey = 'rookie', userId = null }) {
  const slotMins = venue.slotDurationMins || 60;

  if (!starts?.length) throw ApiError.badRequest('Pick at least one slot');
  if (starts.length > 6) throw ApiError.badRequest('You can book at most 6 slots at once');

  // Reject duplicates before they reach the unique index.
  if (new Set(starts).size !== starts.length) {
    throw ApiError.badRequest('The same slot was selected more than once');
  }

  const daysAhead = daysBetween(dateKey);
  const maxDays = (venue.advanceBookingDays || 14) + bonusBookingDays(tierKey);
  if (daysAhead < 0) throw ApiError.badRequest('That date has already passed');
  if (daysAhead > maxDays) {
    throw ApiError.badRequest(`This venue takes bookings up to ${maxDays} days ahead`);
  }

  const { slots, closed } = await buildAvailability(venue, court, dateKey);
  if (closed) throw ApiError.badRequest('The venue is closed on this date');

  const byStart = new Map(slots.map((s) => [s.start, s]));
  const chosen = [];

  for (const start of starts) {
    const slot = byStart.get(start);
    if (!slot) throw ApiError.badRequest(`${toLabel(start)} is not a valid slot at this venue`);
    if (slot.status === 'booked' || slot.status === 'held') {
      throw ApiError.conflict(`${slot.label} has just been taken. Please pick another time.`);
    }
    if (slot.status === 'past') throw ApiError.badRequest(`${slot.label} has already passed`);
    chosen.push(slot);
  }

  chosen.sort((a, b) => a.start - b.start);

  const subtotal = chosen.reduce((sum, s) => sum + s.price, 0);

  let discount = 0;
  let promoLabel = '';
  const promo = await resolvePromo(promoCode, venue);
  if (promoCode && !promo) throw ApiError.badRequest('That promo code is not valid');
  if (promo) {
    if (subtotal < (promo.minAmount || 0)) {
      throw ApiError.badRequest(`This code needs a minimum booking of ₹${promo.minAmount}`);
    }
    await assertPromoUsable(promo, promoCode, userId);
    discount = promo.type === 'flat'
      ? promo.value
      : Math.min(Math.round((subtotal * promo.value) / 100), promo.maxDiscount || Infinity);
    discount = Math.min(discount, subtotal);
    promoLabel = promo.label;
  }

  const grossFee = Math.round(((subtotal - discount) * PLATFORM_FEE_PERCENT) / 100);
  const { fee: platformFee, saved: tierFeeSaved, tier } = discountedFee(grossFee, tierKey);
  const total = Math.max(0, subtotal - discount + platformFee);

  return {
    slots: chosen,
    slotDurationMins: slotMins,
    subtotal,
    discount,
    promoLabel,
    grossFee,
    platformFee,
    tierFeeSaved,
    tier: { key: tier.key, label: tier.label, icon: tier.icon },
    pointsToEarn: pointsForSpend(total, tierKey),
    total,
    startsAt: toDate(dateKey, chosen[0].start),
    endsAt: toDate(dateKey, chosen[chosen.length - 1].end),
  };
}

/**
 * Refund owed if this booking were cancelled right now, per the venue policy.
 * Returned to the UI before the user commits, so there are no surprises.
 */
export function refundFor(booking, venue) {
  const policy = venue?.cancellationPolicy || {
    freeCancellationHours: 24, partialRefundHours: 6, partialRefundPercent: 50,
  };

  const hoursUntil = (new Date(booking.startsAt) - Date.now()) / 3600000;

  // Cash handed over at the gate never entered the platform. Refunding it as
  // wallet credit would mint money the platform never received: the venue
  // keeps the notes, the player keeps the balance. Once an owner marks such a
  // booking settled, a cancellation is between the player and the venue.
  if (booking.payment?.method === 'pay_at_venue' && booking.payment?.status === 'paid') {
    return {
      amount: 0, percent: 0, tier: 'at_venue', hoursUntil,
      message: 'You paid this venue directly, so any refund is arranged with them. Your booking will be cancelled and the slot released.',
    };
  }

  const paid = booking.payment?.status === 'paid' ? booking.totalAmount : 0;

  // Nothing was charged yet (an unconfirmed manual request), so nothing to refund.
  if (!paid) {
    return { amount: 0, percent: 0, tier: 'unpaid', hoursUntil,
      message: 'No payment was taken for this booking, so there is nothing to refund.' };
  }

  if (hoursUntil >= policy.freeCancellationHours) {
    return { amount: paid, percent: 100, tier: 'full', hoursUntil,
      message: `Full refund of ₹${paid} back to your wallet.` };
  }

  if (hoursUntil >= policy.partialRefundHours) {
    const amount = Math.round((paid * policy.partialRefundPercent) / 100);
    return { amount, percent: policy.partialRefundPercent, tier: 'partial', hoursUntil,
      message: `${policy.partialRefundPercent}% refund — ₹${amount} back to your wallet.` };
  }

  return { amount: 0, percent: 0, tier: 'none', hoursUntil,
    message: `Cancellations inside ${policy.partialRefundHours} hours are not refundable, since the slot is unlikely to be re-sold.` };
}
