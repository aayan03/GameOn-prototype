import { z } from 'zod';
import mongoose from 'mongoose';
import { Venue, Booking, Promo, Payout } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { cleanText } from '../utils/sanitize.js';
import { isValidDateKey, todayKey, toLabel } from '../utils/time.js';
import { BOOKING_STATUS } from '../config/constants.js';
import * as analytics from '../services/analytics.service.js';
import { buildAvailability } from '../services/booking.service.js';
import env from '../config/env.js';

/* ── Helpers ─────────────────────────────────────────────────── */

/**
 * Every endpoint in this file scopes to venues the signed-in user owns.
 * A venue id from the client is only ever used to NARROW this list, never to
 * widen it — that is what stops one owner reading another's revenue.
 */
async function ownedVenueIds(user, venueId) {
  // Deliberately NOT a wildcard for admins. These routes return customer
  // data, and an unscoped admin call would dump every player's spend history
  // across the platform in one request. Admins use /api/admin for
  // platform-wide views, or name a specific venue here.
  const ids = await Venue.find({ owner: user._id }).distinct('_id');

  if (venueId) {
    if (!mongoose.isValidObjectId(venueId)) throw ApiError.badRequest('Invalid venue id');
    const match = ids.find((id) => String(id) === String(venueId));
    // An admin may inspect a specific venue they do not own; a plain owner
    // may not.
    if (!match) {
      if (user.role !== 'admin') throw ApiError.forbidden('That venue is not yours');
      if (!(await Venue.exists({ _id: venueId }))) throw ApiError.notFound('Venue not found');
      return [new mongoose.Types.ObjectId(String(venueId))];
    }
    return [match];
  }
  return ids;
}

async function ownedVenue(user, venueId) {
  if (!mongoose.isValidObjectId(venueId)) throw ApiError.badRequest('Invalid venue id');
  const venue = await Venue.findById(venueId);
  if (!venue) throw ApiError.notFound('Venue not found');
  if (String(venue.owner) !== String(user._id) && user.role !== 'admin') {
    throw ApiError.forbidden('That venue is not yours');
  }
  return venue;
}

/* ── Validation ──────────────────────────────────────────────── */

const days = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : Number(v)),
  z.number().int().min(1).max(365).optional()
);

export const rangeSchema = z.object({
  days,
  venueId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
});

export const calendarSchema = z.object({
  venueId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  date: z.string().refine(isValidDateKey, 'date must be YYYY-MM-DD').optional(),
});

export const blackoutSchema = z.object({
  venueId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  date: z.string().refine(isValidDateKey, 'date must be YYYY-MM-DD'),
  courtId: z.string().regex(/^[0-9a-fA4-F]{24}$/).optional(),
  startMinutes: z.number().int().min(0).max(1439).optional(),
  endMinutes: z.number().int().min(1).max(1440).optional(),
  reason: z.string().trim().max(120).optional(),
}).strict()
  // Both bounds or neither. One alone used to produce a blackout that either
  // did nothing at all or silently swallowed the whole day.
  .refine((v) => (v.startMinutes === undefined) === (v.endMinutes === undefined),
    { message: 'Give both a start and an end time, or neither to block the whole day' })
  .refine((v) => v.startMinutes === undefined || v.endMinutes > v.startMinutes,
    { message: 'The end time must be after the start time' });

// NOTE: keep this a plain ZodObject. `.refine()` returns a ZodEffects, which
// has no `.partial()` — deriving the update schema from a refined one throws
// at import time and takes the entire API down with it.
const promoBase = z.object({
  code: z.string().trim().toUpperCase().min(4).max(20).regex(/^[A-Z0-9]+$/, 'Letters and numbers only'),
  type: z.enum(['flat', 'percent']),
  value: z.number().min(1),
  maxDiscount: z.number().min(1).nullable().optional(),
  minAmount: z.number().min(0).optional(),
  maxUsesPerUser: z.number().int().min(1).max(50).optional(),
  totalUseLimit: z.number().int().min(1).nullable().optional(),
  venues: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).max(30).optional(),
  validFrom: z.string().optional(),
  validTo: z.string().nullable().optional(),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
}).strict();

const percentCap = (v) => v.type !== 'percent' || v.value == null || v.value <= 100;
const percentMsg = { message: 'A percentage discount cannot exceed 100' };

export const promoSchema = promoBase.refine(percentCap, percentMsg);
export const updatePromoSchema = promoBase.partial().refine(percentCap, percentMsg);

export const venueSettingsSchema = z.object({
  operatingHours: z.array(z.object({
    day: z.number().int().min(0).max(6),
    open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    isClosed: z.boolean().optional(),
  })).length(7).optional(),
  slotDurationMins: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)]).optional(),
  advanceBookingDays: z.number().int().min(1).max(90).optional(),
  cancellationPolicy: z.object({
    freeCancellationHours: z.number().min(0).max(168),
    partialRefundHours: z.number().min(0).max(168),
    partialRefundPercent: z.number().min(0).max(100),
  }).optional(),
}).strict();

/* ── Dashboard ───────────────────────────────────────────────── */

/** GET /api/owner/overview */
export const overview = asyncHandler(async (req, res) => {
  const { days: d = 30, venueId } = req.validatedQuery || {};
  const ids = await ownedVenueIds(req.user, venueId);

  const [stats, series, breakdown, reviews, venues] = await Promise.all([
    analytics.overview(ids, d),
    analytics.revenueSeries(ids, d),
    analytics.revenueBreakdown(ids, d),
    analytics.reviewSummary(ids),
    Venue.find({ _id: { $in: ids } })
      .select('name slug address bookingMode isActive moderationStatus rating reviewCount courts')
      .lean(),
  ]);

  return ok(res, {
    days: d,
    stats,
    series,
    breakdown,
    reviews,
    venues: venues.map((v) => ({
      ...v,
      courtCount: v.courts?.length || 0,
      startingPrice: v.courts?.length ? Math.min(...v.courts.map((c) => c.pricePerHour)) : 0,
      courts: undefined,
    })),
  });
});

/** GET /api/owner/peak-hours */
export const peakHours = asyncHandler(async (req, res) => {
  const { days: d = 60, venueId } = req.validatedQuery || {};
  const ids = await ownedVenueIds(req.user, venueId);
  const rows = await analytics.peakHours(ids, d);
  return ok(res, rows.map((r) => ({ ...r, label: toLabel(r.hour * 60) })));
});

/** GET /api/owner/customers */
export const customers = asyncHandler(async (req, res) => {
  const { days: d = 180, venueId } = req.validatedQuery || {};
  const ids = await ownedVenueIds(req.user, venueId);
  return ok(res, await analytics.customers(ids, { days: d, limit: 50 }));
});

/* ── Calendar ────────────────────────────────────────────────── */

/**
 * GET /api/owner/calendar — one day, every court, with who booked what.
 * This is the owner's view of the same grid players see.
 */
export const calendar = asyncHandler(async (req, res) => {
  const { venueId, date = todayKey() } = req.validatedQuery || {};
  const venue = await ownedVenue(req.user, venueId);

  const bookings = await Booking.find({
    venue: venue._id,
    date,
    status: { $nin: [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.REJECTED] },
  }).populate('user', 'name phone loyaltyTier').lean();

  const byCourtStart = new Map(
    bookings.map((b) => [`${b.court}-${b.startMinutes}`, b])
  );

  const courts = venue.courts.filter((c) => c.isActive !== false);
  const grids = await Promise.all(courts.map(async (court) => {
    const grid = await buildAvailability(venue, court, date);

    const blocked = (venue.blackouts || []).filter((b) =>
      b.date === date && (!b.court || String(b.court) === String(court._id)));

    return {
      courtId: court._id,
      courtName: court.name,
      sport: court.sport,
      pricePerHour: court.pricePerHour,
      closed: grid.closed,
      opens: grid.opens,
      closes: grid.closes,
      slots: grid.slots.map((s) => {
        const booking = byCourtStart.get(`${court._id}-${s.start}`);
        const isBlocked = blocked.some((b) =>
          b.startMinutes == null || (s.start >= b.startMinutes && s.start < b.endMinutes));

        return {
          ...s,
          status: isBlocked ? 'blocked' : s.status,
          booking: booking ? {
            groupRef: booking.groupRef,
            bookingRef: booking.bookingRef,
            status: booking.status,
            player: booking.user?.name || 'Player',
            phone: booking.user?.phone || '',
            players: booking.players,
            amount: booking.totalAmount,
            paid: booking.payment?.status === 'paid',
          } : null,
        };
      }),
    };
  }));

  return ok(res, {
    date,
    venue: { id: venue._id, name: venue.name, slotDurationMins: venue.slotDurationMins },
    courts: grids,
    blackouts: (venue.blackouts || []).filter((b) => b.date === date),
  });
});

/** POST /api/owner/blackouts — take a slot or a day out of service. */
export const addBlackout = asyncHandler(async (req, res) => {
  const { venueId, date, courtId, startMinutes, endMinutes, reason } = req.body;
  const venue = await ownedVenue(req.user, venueId);

  if (courtId && !venue.courts.id(courtId)) throw ApiError.notFound('Court not found at this venue');

  // Refuse to block a window that already has live bookings in it — silently
  // stranding a paying customer is worse than making the owner cancel first.
  // Overlap, not equality: a 17:00–18:00 booking clashes with a 17:30–19:00
  // blackout even though their start minutes differ.
  const clash = await Booking.countDocuments({
    venue: venue._id,
    date,
    slotLocked: true,
    ...(courtId ? { court: courtId } : {}),
    ...(startMinutes != null
      ? { startMinutes: { $lt: endMinutes }, endMinutes: { $gt: startMinutes } }
      : {}),
  });
  if (clash > 0) {
    throw ApiError.conflict(
      `There ${clash === 1 ? 'is' : 'are'} ${clash} live booking${clash === 1 ? '' : 's'} in that window. Cancel ${clash === 1 ? 'it' : 'them'} first.`
    );
  }

  venue.blackouts.push({
    date,
    court: courtId || null,
    startMinutes: startMinutes ?? null,
    endMinutes: endMinutes ?? null,
    reason: cleanText(reason || '', 120),
  });
  await venue.save();

  return created(res, {
    blackouts: venue.blackouts.filter((b) => b.date === date),
    message: 'Those slots are now blocked.',
  });
});

/** DELETE /api/owner/blackouts/:venueId/:blackoutId */
export const removeBlackout = asyncHandler(async (req, res) => {
  const venue = await ownedVenue(req.user, req.params.venueId);
  const entry = venue.blackouts.id(req.params.blackoutId);
  if (!entry) throw ApiError.notFound('Block not found');
  entry.deleteOne();
  await venue.save();
  return ok(res, { removed: true, message: 'Those slots are open again.' });
});

/** PATCH /api/owner/venues/:venueId/settings */
export const updateSettings = asyncHandler(async (req, res) => {
  const venue = await ownedVenue(req.user, req.params.venueId);
  const { operatingHours, cancellationPolicy, ...rest } = req.body;

  // Availability matches taken slots by exact start minute, and so does the
  // unique index. Changing the slot length or opening time re-phases the grid,
  // which makes an existing booking invisible to the new one — two live
  // bookings, overlapping, with no index violation. Refuse while any remain.
  const rephases = rest.slotDurationMins !== undefined || operatingHours !== undefined;
  if (rephases) {
    const upcoming = await Booking.countDocuments({
      venue: venue._id, slotLocked: true, endsAt: { $gte: new Date() },
    });
    if (upcoming > 0) {
      throw ApiError.conflict(
        `You have ${upcoming} upcoming booking${upcoming === 1 ? '' : 's'}. Changing slot length or opening hours would re-shape the grid underneath them — wait until they are played or cancelled.`
      );
    }
  }

  Object.assign(venue, rest);
  if (operatingHours) venue.operatingHours = operatingHours;
  if (cancellationPolicy) {
    if (cancellationPolicy.partialRefundHours > cancellationPolicy.freeCancellationHours) {
      throw ApiError.badRequest('The partial-refund window must be shorter than the free-cancellation window');
    }
    // A nested path returns a plain object, not a subdocument — calling
    // .toObject() on it throws.
    venue.cancellationPolicy = { ...(venue.cancellationPolicy || {}), ...cancellationPolicy };
  }

  await venue.save();
  return ok(res, { venue, message: 'Settings saved.' });
});

/* ── Promo codes ─────────────────────────────────────────────── */

/** GET /api/owner/promos */
export const listPromos = asyncHandler(async (req, res) => {
  const promos = await Promo.find({ owner: req.user._id })
    .populate('venues', 'name')
    .sort({ createdAt: -1 })
    .lean();
  return ok(res, promos.map((p) => ({
    ...p,
    isLive: p.isActive
      && (!p.validTo || new Date(p.validTo) >= new Date())
      && (p.totalUseLimit === null || p.usedCount < p.totalUseLimit),
  })));
});

/** POST /api/owner/promos */
export const createPromo = asyncHandler(async (req, res) => {
  const body = req.body;

  const count = await Promo.countDocuments({ owner: req.user._id });
  if (count >= 50) throw ApiError.badRequest('You can run at most 50 promo codes');

  if (body.venues?.length) {
    const mine = await ownedVenueIds(req.user);
    const allowed = new Set(mine.map(String));
    if (body.venues.some((v) => !allowed.has(String(v)))) {
      throw ApiError.forbidden('One of those venues is not yours');
    }
  }

  if (await Promo.exists({ owner: req.user._id, code: body.code })) {
    throw ApiError.conflict('You already have a promo with that code');
  }

  const promo = await Promo.create({
    ...body,
    owner: req.user._id,
    description: cleanText(body.description || '', 200),
    validFrom: body.validFrom ? new Date(body.validFrom) : new Date(),
    validTo: body.validTo ? new Date(body.validTo) : null,
  });

  return created(res, promo);
});

/** PATCH /api/owner/promos/:id */
export const updatePromo = asyncHandler(async (req, res) => {
  const promo = await Promo.findById(req.params.id);
  if (!promo) throw ApiError.notFound('Promo not found');
  if (String(promo.owner) !== String(req.user._id)) throw ApiError.forbidden('That promo is not yours');

  const { code, venues, validFrom, validTo, ...rest } = req.body;

  if (venues?.length) {
    const mine = await ownedVenueIds(req.user);
    const allowed = new Set(mine.map(String));
    if (venues.some((v) => !allowed.has(String(v)))) throw ApiError.forbidden('One of those venues is not yours');
    promo.venues = venues;
  }

  // The code is the identity people have already been given — changing it
  // would silently break every share of it. Deactivate and make a new one.
  if (code && code !== promo.code) {
    throw ApiError.badRequest('A promo code cannot be renamed. Deactivate this one and create another.');
  }

  Object.assign(promo, rest);
  if (validFrom) promo.validFrom = new Date(validFrom);
  if (validTo !== undefined) promo.validTo = validTo ? new Date(validTo) : null;

  await promo.save();
  return ok(res, promo);
});

/** DELETE /api/owner/promos/:id — deactivates, so history stays intact. */
export const deletePromo = asyncHandler(async (req, res) => {
  const promo = await Promo.findById(req.params.id);
  if (!promo) throw ApiError.notFound('Promo not found');
  if (String(promo.owner) !== String(req.user._id)) throw ApiError.forbidden('That promo is not yours');

  promo.isActive = false;
  await promo.save();
  return ok(res, { deactivated: true, message: 'Promo deactivated.' });
});

/* ── Payouts ─────────────────────────────────────────────────── */

/** GET /api/owner/payouts — history plus what is currently owed. */
export const payouts = asyncHandler(async (req, res) => {
  const ids = await ownedVenueIds(req.user);

  const history = await Payout.find({ owner: req.user._id })
    .sort({ periodEnd: -1 }).limit(24).lean();

  // Everything earned since the last settled period.
  const lastEnd = history.find((p) => p.status === 'paid')?.periodEnd || new Date(0);

  // Pay-at-venue bookings earn the venue money even though nothing was
  // collected through us, so they belong in the gross figure.
  const [pending] = ids.length ? await Booking.aggregate([
    {
      $match: {
        venue: { $in: ids },
        status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED] },
        endsAt: { $gt: lastEnd, $lte: new Date() },
      },
    },
    {
      $group: {
        _id: null,
        gross: {
          $sum: {
            $cond: [{ $gt: ['$payment.amountPaid', 0] }, '$payment.amountPaid', '$totalAmount'],
          },
        },
        slots: { $sum: 1 },
      },
    },
  ]) : [];

  const gross = pending?.gross || 0;
  const commissionPercent = env.PLATFORM_COMMISSION_PERCENT;
  const commission = Math.round((gross * commissionPercent) / 100);

  return ok(res, {
    history,
    upcoming: {
      periodStart: lastEnd,
      periodEnd: new Date(),
      slots: pending?.slots || 0,
      grossAmount: gross,
      commissionPercent,
      commissionAmount: commission,
      netAmount: gross - commission,
    },
  });
});
