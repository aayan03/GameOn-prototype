import { z } from 'zod';
import mongoose from 'mongoose';
import { Review, Booking, Venue, User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { cleanText } from '../utils/sanitize.js';
import { BOOKING_STATUS, LOYALTY } from '../config/constants.js';
import * as loyalty from '../services/loyalty.service.js';
import * as notify from '../services/notification.service.js';

const star = z.number().int().min(1).max(5);

export const createReviewSchema = z.object({
  venueId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  rating: star,
  comment: z.string().trim().max(1000).optional(),
  aspects: z.object({
    surface: star.nullable().optional(),
    cleanliness: star.nullable().optional(),
    staff: star.nullable().optional(),
    value: star.nullable().optional(),
  }).optional(),
}).strict();

export const replySchema = z.object({
  text: z.string().trim().min(1).max(600),
}).strict();

/**
 * Recomputes a venue's rating from its visible reviews.
 *
 * Deliberately a full recount rather than a running average: an edited or
 * hidden review has to be able to move the number back down, which an
 * incremental average cannot do.
 */
async function recomputeRating(venueId) {
  const [row] = await Review.aggregate([
    { $match: { venue: new mongoose.Types.ObjectId(String(venueId)), isVisible: true } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  await Venue.updateOne({ _id: venueId }, {
    $set: {
      rating: row ? Math.round(row.avg * 10) / 10 : 0,
      reviewCount: row?.count || 0,
    },
  });
}

/**
 * Has this person actually played AND settled up at this venue?
 *
 * "Played" alone was not enough. A pay-at-venue booking takes no money at
 * booking time, so anyone could reserve a slot, never turn up, let the
 * lifecycle job mark it COMPLETED, and post a review — free of charge, as
 * many times as they had slots. A booking counts here only if money actually
 * moved, or the venue marked the cash as collected at the gate.
 */
async function hasSettledVisit(userId, venueId) {
  return Booking.exists({
    user: userId,
    venue: venueId,
    status: BOOKING_STATUS.COMPLETED,
    $or: [
      { 'payment.amountPaid': { $gt: 0 } },
      { 'payment.status': 'paid' },
    ],
  });
}

/**
 * POST /api/reviews
 *
 * Only someone who actually played there may review. Without that check a
 * venue's rating is worth nothing — a competitor could bury it, and an owner
 * could inflate their own.
 */
export const create = asyncHandler(async (req, res) => {
  const { venueId, rating, comment, aspects } = req.body;

  const venue = await Venue.findById(venueId).select('name owner');
  if (!venue) throw ApiError.notFound('Venue not found');
  if (String(venue.owner) === String(req.user._id)) {
    throw ApiError.forbidden('You cannot review your own venue');
  }

  const played = await hasSettledVisit(req.user._id, venueId);
  if (!played) {
    throw ApiError.forbidden(
      'You can review a venue once you have played and paid there. If you paid at the venue, ask them to mark your booking as settled.'
    );
  }

  const existing = await Review.findOne({ user: req.user._id, venue: venueId });

  if (existing) {
    existing.rating = rating;
    existing.comment = cleanText(comment || '', 1000);
    if (aspects) existing.aspects = aspects;
    await existing.save();
    await recomputeRating(venueId);
    return ok(res, { review: existing, updated: true, message: 'Your review was updated.' });
  }

  const review = await Review.create({
    user: req.user._id,
    venue: venueId,
    rating,
    comment: cleanText(comment || '', 1000),
    aspects: aspects || {},
  });

  await recomputeRating(venueId);

  // The bonus is claimed once per venue, for good. Marking the claim with a
  // conditional update means two parallel posts cannot both collect it, and
  // deleting the review does not release it — see the note on the field.
  const claim = await User.updateOne(
    { _id: req.user._id, reviewBonusVenues: { $ne: venue._id } },
    { $addToSet: { reviewBonusVenues: venue._id } }
  );

  let award = null;
  if (claim.modifiedCount) {
    award = await loyalty.award(req.user, LOYALTY.REVIEW_BONUS, { reason: `Reviewed ${venue.name}` });
    await Review.updateOne({ _id: review._id }, { $set: { pointsAwarded: LOYALTY.REVIEW_BONUS } });
  }

  await notify.notify(venue.owner, 'review_request', {
    title: 'New review',
    body: `${req.user.name} rated ${venue.name} ${rating} star${rating === 1 ? '' : 's'}.`,
    link: '/owner',
    icon: '⭐',
  });

  return created(res, { review, loyalty: award, message: 'Thanks — your review is live.' });
});

/** GET /api/reviews/venue/:venueId */
export const listForVenue = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.venueId)) throw ApiError.badRequest('Invalid venue id');

  const reviews = await Review.find({ venue: req.params.venueId, isVisible: true })
    .populate('user', 'name avatar loyaltyTier')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return ok(res, reviews);
});

/** GET /api/reviews/mine/:venueId — so the form can prefill an existing review. */
export const mine = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.venueId)) throw ApiError.badRequest('Invalid venue id');

  const [review, canReview] = await Promise.all([
    Review.findOne({ user: req.user._id, venue: req.params.venueId }).lean(),
    hasSettledVisit(req.user._id, req.params.venueId),
  ]);

  return ok(res, { review, canReview: Boolean(canReview) });
});

/** DELETE /api/reviews/:id */
export const remove = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');
  if (String(review.user) !== String(req.user._id) && req.user.role !== 'admin') {
    throw ApiError.forbidden('That review is not yours');
  }

  const venueId = review.venue;

  const gone = await Review.deleteOne({ _id: review._id });
  if (!gone.deletedCount) throw ApiError.notFound('Review not found');

  // No points are handed back, and none are given again for this venue —
  // `reviewBonusVenues` still holds the claim. Revoking on delete looked
  // fairer but was the faucet: revoke can only take back UNSPENT points, so
  // post → redeem → delete → repost paid out every single cycle.
  await recomputeRating(venueId);

  return ok(res, { deleted: true });
});

/** POST /api/reviews/:id/reply — the venue owner's public response. */
export const reply = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id).populate('venue', 'owner name');
  if (!review) throw ApiError.notFound('Review not found');
  // The venue can have been deleted out from under the review; `review.venue`
  // is then null and every field access below would throw a 500.
  if (!review.venue) throw ApiError.notFound('That venue no longer exists');
  if (String(review.venue.owner) !== String(req.user._id) && req.user.role !== 'admin') {
    throw ApiError.forbidden('Only the venue owner can reply');
  }

  review.ownerReply = { text: cleanText(req.body.text, 600), repliedAt: new Date() };
  await review.save();

  await notify.notify(review.user, 'review_request', {
    title: 'The venue replied',
    body: `${review.venue.name || 'The venue'} responded to your review.`,
    link: `/venues/${review.venue._id}`,
    icon: '💬',
  });

  return ok(res, { review, message: 'Reply posted.' });
});
