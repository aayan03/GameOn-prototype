import { z } from 'zod';
import { Transaction } from '../models/index.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import * as loyalty from '../services/loyalty.service.js';
import { LOYALTY_TIERS, LOYALTY } from '../config/constants.js';

export const redeemSchema = z.object({
  points: z.number().int().min(1).max(1000000),
}).strict();

/** GET /api/loyalty — everything the loyalty screen renders. */
export const summary = asyncHandler(async (req, res) => {
  // Narrow by `type` first so the index does the work. Matching on the
  // description alone meant every one of this user's transactions — wallet
  // top-ups, booking payments, refunds — was pulled into memory and scanned
  // with a regex, then sorted in memory too. Point movements are only ever
  // written as 'cashback' (awards, redemptions) or 'adjustment' (revocations),
  // and the description check stays to exclude the non-points adjustments a
  // TeamUp cost split writes under the same type.
  const history = await Transaction.find({
    user: req.user._id,
    type: { $in: ['cashback', 'adjustment'] },
    description: /points/,
  }).sort({ createdAt: -1 }).limit(25).lean();

  return ok(res, { ...loyalty.summarise(req.user), history });
});

/** GET /api/loyalty/tiers — public, so the perks can be advertised. */
export const tiers = asyncHandler(async (req, res) => ok(res, {
  tiers: LOYALTY_TIERS,
  pointsPer100: LOYALTY.POINTS_PER_100,
  pointsPerRupee: LOYALTY.POINTS_PER_RUPEE,
  minRedeemPoints: LOYALTY.MIN_REDEEM_POINTS,
  signupBonus: LOYALTY.SIGNUP_BONUS,
}));

/** POST /api/loyalty/redeem — points to wallet credit. */
export const redeem = asyncHandler(async (req, res) => {
  const result = await loyalty.redeem(req.user, req.body.points);
  return ok(res, {
    ...result,
    loyalty: loyalty.summarise(req.user),
    message: `${result.pointsRedeemed} points redeemed for ₹${result.rupeesCredited}.`,
  });
});
