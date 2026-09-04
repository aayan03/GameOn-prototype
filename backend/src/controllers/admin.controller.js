import { z } from 'zod';
import mongoose from 'mongoose';
import { Venue, User, Booking, Payout, Transaction } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { cleanText, safeRegex } from '../utils/sanitize.js';
import { BOOKING_STATUS } from '../config/constants.js';
import env from '../config/env.js';
import * as notify from '../services/notification.service.js';
import { runLifecycle } from '../services/lifecycle.service.js';

/**
 * Platform administration.
 *
 * Every route here is behind `restrictTo('admin')`. The `admin` role is not
 * assignable through registration or any API — it is set directly in the
 * database, deliberately, so a bug in a signup path can never mint one.
 */

export const moderateSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(300).optional(),
}).strict();

export const listUsersSchema = z.object({
  q: z.string().max(80).optional(),
  role: z.enum(['player', 'owner', 'admin']).optional(),
  page: z.preprocess((v) => (v ? Number(v) : undefined), z.number().int().min(1).max(500).optional()),
}).strict();

// An empty PATCH body used to evaluate to `false` and silently suspend an
// account, so both of these now require an explicit boolean.
export const verifyUserSchema = z.object({ verified: z.boolean() }).strict();
export const userStatusSchema = z.object({ isActive: z.boolean() }).strict();

export const listVenuesSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  q: z.string().max(80).optional(),
  page: z.preprocess((v) => (v ? Number(v) : undefined), z.number().int().min(1).optional()),
}).strict();

/** GET /api/admin/stats — one screen that says whether the platform is healthy. */
export const stats = asyncHandler(async (req, res) => {
  const since30 = new Date(Date.now() - 30 * 86400000);

  const [
    users, owners, venues, pendingVenues, activeVenues,
    bookings30, revenue30, walletFloat,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ role: 'owner' }),
    Venue.countDocuments({}),
    Venue.countDocuments({ moderationStatus: 'pending' }),
    Venue.countDocuments({ isActive: true, moderationStatus: 'approved' }),
    Booking.countDocuments({ createdAt: { $gte: since30 } }),
    Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: since30 },
          status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED] },
        },
      },
      {
        $group: {
          _id: null,
          gross: {
            $sum: { $cond: [{ $gt: ['$payment.amountPaid', 0] }, '$payment.amountPaid', '$totalAmount'] },
          },
          fees: { $sum: '$platformFee' },
        },
      },
    ]),
    // Total unspent wallet balance across all users — the platform's liability.
    User.aggregate([{ $group: { _id: null, total: { $sum: '$walletBalance' } } }]),
  ]);

  return ok(res, {
    users, owners, venues, pendingVenues, activeVenues,
    bookings30,
    grossRevenue30: revenue30?.[0]?.gross || 0,
    platformFees30: revenue30?.[0]?.fees || 0,
    walletLiability: walletFloat?.[0]?.total || 0,
    paymentMode: env.RAZORPAY_KEY_ID ? 'razorpay' : 'simulated',
    commissionPercent: env.PLATFORM_COMMISSION_PERCENT,
  });
});

/** GET /api/admin/venues?status=pending — the moderation queue. */
export const listVenues = asyncHandler(async (req, res) => {
  const { status = 'pending', q, page = 1 } = req.validatedQuery || {};
  const limit = 20;

  const match = {};
  if (status !== 'all') match.moderationStatus = status;
  if (q) {
    const rx = safeRegex(q);
    match.$or = [{ name: rx }, { 'address.city': rx }, { 'address.area': rx }];
  }

  const [items, total] = await Promise.all([
    Venue.find(match)
      .populate('owner', 'name email phone isVerified createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Venue.countDocuments(match),
  ]);

  return ok(res, items, { page, limit, total, pages: Math.ceil(total / limit) || 1 });
});

/** PATCH /api/admin/venues/:id/moderate */
export const moderateVenue = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid venue id');

  const venue = await Venue.findById(req.params.id);
  if (!venue) throw ApiError.notFound('Venue not found');

  const approve = decision === 'approve';
  venue.moderationStatus = approve ? 'approved' : 'rejected';
  venue.isActive = approve;
  venue.moderationNote = cleanText(note || '', 300);
  venue.moderatedAt = new Date();
  venue.moderatedBy = req.user._id;
  await venue.save();

  await notify.notify(venue.owner, approve ? 'venue_approved' : 'venue_rejected', {
    body: approve
      ? `${venue.name} is live and taking bookings.`
      : `${venue.name} needs changes before it can go live.${venue.moderationNote ? ` Note: ${venue.moderationNote}` : ''}`,
    link: '/owner',
  });

  return ok(res, {
    venue,
    message: approve
      ? `${venue.name} is now live.`
      : `${venue.name} was rejected and stays hidden.`,
  });
});

/** PATCH /api/admin/users/:id/verify — verified owners publish without review. */
export const verifyUser = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid user id');

  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');

  user.isVerified = req.body.verified;
  await user.save();

  return ok(res, {
    user: user.toPublic(),
    message: user.isVerified
      ? `${user.name} is verified — their future listings go live immediately.`
      : `${user.name} is no longer verified.`,
  });
});

/**
 * PATCH /api/admin/users/:id/status — suspend or restore an account.
 * Suspending also bumps tokenVersion, which kills every live session.
 */
export const setUserStatus = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid user id');

  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (String(user._id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot suspend your own account');
  }
  if (user.role === 'admin') throw ApiError.forbidden('Admin accounts cannot be suspended through the API');

  const active = req.body.isActive;
  user.isActive = active;
  if (!active) user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  return ok(res, {
    user: user.toPublic(),
    message: active ? `${user.name} restored.` : `${user.name} suspended and signed out everywhere.`,
  });
});

/** GET /api/admin/users */
export const listUsers = asyncHandler(async (req, res) => {
  const { q, role, page = 1 } = req.validatedQuery || {};
  const limit = 25;

  const match = {};
  if (role) match.role = role;
  if (q) {
    const rx = safeRegex(q);
    match.$or = [{ name: rx }, { email: rx }];
  }

  const [items, total] = await Promise.all([
    User.find(match)
      .select('name email phone role city isActive isVerified loyaltyTier walletBalance createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(match),
  ]);

  return ok(res, items, { page, limit, total, pages: Math.ceil(total / limit) || 1 });
});

/**
 * The most recent Monday 00:00 UTC, which is where a settlement week ends.
 *
 * Exported so the tests can assert the property that matters — that the
 * boundary does not move when the job runs on a different day.
 */
export function lastWeekBoundary(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  // getUTCDay: 0 = Sunday. Step back to Monday; a Monday stays put.
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

/**
 * POST /api/admin/payouts/run — closes the last completed week for every owner.
 * Idempotent: rerunning updates the same period rather than duplicating it,
 * and periods already marked paid are never touched.
 */
export const runPayouts = asyncHandler(async (req, res) => {
  /**
   * Period boundaries must be STABLE, or the unique index never matches and
   * every run creates a fresh OVERLAPPING payout.
   *
   * The comment here used to promise "UTC midnight and whole weeks" and only
   * deliver the first half: `periodEnd` was today's midnight and
   * `periodStart` seven days before it, so a run on Tuesday covered
   * [Tue-7, Tue) and a run on Wednesday covered [Wed-7, Wed). Six of those
   * days are in both. The tuples differ, so the unique index does not collide
   * — two payouts are created, and if both are marked paid the owner is paid
   * twice for the same six days.
   *
   * Snapping the END to a fixed weekday makes the period the same whichever
   * day of the week the job runs on: an extra run updates the existing row
   * instead of minting a second overlapping one.
   */
  const periodEnd = lastWeekBoundary();
  const periodStart = new Date(periodEnd.getTime() - 7 * 86400000);
  const commissionPercent = env.PLATFORM_COMMISSION_PERCENT;

  const rows = await Booking.aggregate([
    {
      $match: {
        status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED] },
        endsAt: { $gt: periodStart, $lte: periodEnd },
      },
    },
    { $lookup: { from: 'venues', localField: 'venue', foreignField: '_id', as: 'v' } },
    {
      $set: {
        ownerId: { $arrayElemAt: ['$v.owner', 0] },
        // Each venue can carry its own rate; fall back to the platform default.
        rate: { $ifNull: [{ $arrayElemAt: ['$v.commissionPercent', 0] }, commissionPercent] },
        earned: {
          $cond: [{ $gt: ['$payment.amountPaid', 0] }, '$payment.amountPaid', '$totalAmount'],
        },
      },
    },
    {
      $group: {
        _id: '$ownerId',
        gross: { $sum: '$earned' },
        commission: { $sum: { $divide: [{ $multiply: ['$earned', '$rate'] }, 100] } },
        slots: { $sum: 1 },
      },
    },
    { $match: { _id: { $ne: null } } },
  ]);

  const results = [];
  let skipped = 0;
  for (const r of rows) {
    const commissionAmount = Math.round(r.commission);

    // `status` belongs in the UPDATE, not the filter. Putting it in the filter
    // makes an already-paid period miss, upsert tries to insert, and the
    // unique index throws mid-loop leaving the run half-finished.
    const existing = await Payout.findOne({ owner: r._id, periodStart, periodEnd });
    if (existing?.status === 'paid') { skipped += 1; continue; }

    const doc = await Payout.findOneAndUpdate(
      { owner: r._id, periodStart, periodEnd },
      {
        $set: {
          bookingCount: r.slots,
          grossAmount: r.gross,
          commissionPercent: r.gross ? Math.round((commissionAmount / r.gross) * 100) : commissionPercent,
          commissionAmount,
          netAmount: r.gross - commissionAmount,
          status: 'pending',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    results.push(doc);
  }

  return ok(res, {
    periodStart, periodEnd, count: results.length, skipped,
    totalNet: results.reduce((s, p) => s + p.netAmount, 0),
    message: `Generated ${results.length} payout${results.length === 1 ? '' : 's'}`
      + (skipped ? `, skipped ${skipped} already settled.` : '.'),
  });
});

/** PATCH /api/admin/payouts/:id — mark one settled. */
export const markPayoutPaid = asyncHandler(async (req, res) => {
  const payout = await Payout.findById(req.params.id);
  if (!payout) throw ApiError.notFound('Payout not found');
  if (payout.status === 'paid') throw ApiError.badRequest('That payout is already settled');

  payout.status = 'paid';
  payout.paidAt = new Date();
  payout.reference = cleanText(req.body?.reference || '', 100);
  await payout.save();

  await notify.notify(payout.owner, 'payout_ready', {
    title: 'Payout sent',
    body: `₹${payout.netAmount.toLocaleString('en-IN')} has been settled to your account.`,
    link: '/owner/payouts',
  });

  return ok(res, { payout, message: 'Payout marked as paid.' });
});

/** GET /api/admin/ledger — recent money movement, for reconciliation. */
export const ledger = asyncHandler(async (req, res) => {
  const rows = await Transaction.find({})
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return ok(res, rows);
});

/**
 * POST /api/admin/lifecycle — run the housekeeping job on demand.
 * It also runs on an interval; this is for verifying it, and for platforms
 * where a long-lived interval is not reliable.
 */
export const lifecycle = asyncHandler(async (req, res) => {
  const result = await runLifecycle();
  return ok(res, { ...result, message: 'Lifecycle run complete.' });
});
