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
  const history = await Transaction.find({
    user: req.user._id,
    description: { $regex: 'points' },
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
