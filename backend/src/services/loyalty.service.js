// @ts-check
import { User, Transaction } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import { LOYALTY, LOYALTY_TIERS } from '../config/constants.js';

/**
 * Loyalty programme.
 *
 * Design notes:
 *  - `lifetimePoints` never decreases, so redeeming points cannot demote a
 *    user. `loyaltyPoints` is the spendable balance.
 *  - Every mutation is an atomic `$inc`, for the same reason wallet balances
 *    are: two bookings confirming at once must not lose an award.
 *  - Awards are reversed proportionally on cancellation, so a book-cancel
 *    loop cannot farm points.
 */

/** The tier a lifetime score qualifies for. */
export function tierFor(lifetimePoints = 0) {
  let current = LOYALTY_TIERS[0];
  for (const tier of LOYALTY_TIERS) {
    if (lifetimePoints >= tier.minLifetimePoints) current = tier;
  }
  return current;
}

/** The next tier up, and how far away it is. Null once at the top. */
export function nextTierFor(lifetimePoints = 0) {
  const next = LOYALTY_TIERS.find((t) => t.minLifetimePoints > lifetimePoints);
  if (!next) return null;
  const current = tierFor(lifetimePoints);
  const span = next.minLifetimePoints - current.minLifetimePoints;
  const done = lifetimePoints - current.minLifetimePoints;
  return {
    ...next,
    pointsNeeded: next.minLifetimePoints - lifetimePoints,
    progressPercent: span > 0 ? Math.min(100, Math.round((done / span) * 100)) : 0,
  };
}

/** Points earned by spending `amount`, at this user's tier multiplier. */
export function pointsForSpend(amount, tierKey = 'rookie') {
  const tier = LOYALTY_TIERS.find((t) => t.key === tierKey) || LOYALTY_TIERS[0];
  const base = (Number(amount) / 100) * LOYALTY.POINTS_PER_100;
  return Math.max(0, Math.floor(base * tier.earnMultiplier));
}

/** The platform fee this tier actually pays, after its discount. */
export function discountedFee(fee, tierKey = 'rookie') {
  const tier = LOYALTY_TIERS.find((t) => t.key === tierKey) || LOYALTY_TIERS[0];
  const off = Math.round((fee * tier.feeDiscountPercent) / 100);
  return { fee: Math.max(0, fee - off), saved: off, tier };
}

/** How many extra days ahead this tier may book. */
export function bonusBookingDays(tierKey = 'rookie') {
  const tier = LOYALTY_TIERS.find((t) => t.key === tierKey) || LOYALTY_TIERS[0];
  return tier.advanceBookingBonusDays;
}

/**
 * Grants points and re-evaluates the tier in one atomic update.
 * Returns `{ points, tier, promoted }` so the caller can celebrate a promotion.
 */
export async function award(userOrId, points, { reason = '', booking = null } = {}) {
  const amount = Math.floor(Number(points));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const userId = userOrId?._id || userOrId;

  const before = await User.findById(userId).select('loyaltyTier lifetimePoints').lean();
  if (!before) return null;

  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { loyaltyPoints: amount, lifetimePoints: amount } },
    { new: true }
  );

  const newTier = tierFor(updated.lifetimePoints);
  const promoted = newTier.key !== before.loyaltyTier;

  if (promoted) {
    await User.updateOne(
      { _id: userId },
      { $set: { loyaltyTier: newTier.key, tierAchievedAt: new Date() } }
    );
    updated.loyaltyTier = newTier.key;
  }

  if (userOrId && typeof userOrId === 'object' && 'loyaltyPoints' in userOrId) {
    userOrId.loyaltyPoints = updated.loyaltyPoints;
    userOrId.lifetimePoints = updated.lifetimePoints;
    userOrId.loyaltyTier = updated.loyaltyTier;
  }

  await Transaction.create({
    user: userId, type: 'cashback', direction: 'credit',
    amount: 0,                                   // points, not rupees
    balanceAfter: updated.walletBalance,
    booking: booking?._id || null,
    reference: booking?.bookingRef || '',
    description: `+${amount} points — ${reason || 'booking'}`,
    status: 'success',
  });

  return { points: amount, tier: newTier, promoted, balance: updated.loyaltyPoints };
}

/**
 * Takes points back — used when a booking that earned them is cancelled.
 * Both counters drop, and the tier is recalculated downward if needed, so
 * book-and-cancel cannot be used to farm status.
 */
export async function revoke(userOrId, points, { reason = 'Booking cancelled' } = {}) {
  const amount = Math.floor(Number(points));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const userId = userOrId?._id || userOrId;
  const before = await User.findById(userId).select('loyaltyPoints lifetimePoints loyaltyTier');
  if (!before) return null;

  // Clamp inside the database, not in JavaScript. Reading the balance, taking
  // min() against it and then $inc'ing let two overlapping revokes each read
  // 100 and each subtract 100, leaving lifetimePoints at -100 — which made
  // tierFor() match rookie against itself and the Loyalty page render
  // "100 points to Rookie".
  const updated = await User.findByIdAndUpdate(
    userId,
    [{
      $set: {
        loyaltyPoints: { $max: [0, { $subtract: ['$loyaltyPoints', amount] }] },
        lifetimePoints: { $max: [0, { $subtract: ['$lifetimePoints', amount] }] },
      },
    }],
    { new: true }
  );
  if (!updated) return null;

  const takeSpendable = Math.max(0, before.loyaltyPoints - updated.loyaltyPoints);

  const newTier = tierFor(updated.lifetimePoints);
  if (newTier.key !== updated.loyaltyTier) {
    await User.updateOne({ _id: userId }, { $set: { loyaltyTier: newTier.key } });
    updated.loyaltyTier = newTier.key;
  }

  if (userOrId && typeof userOrId === 'object' && 'loyaltyPoints' in userOrId) {
    userOrId.loyaltyPoints = updated.loyaltyPoints;
    userOrId.lifetimePoints = updated.lifetimePoints;
    userOrId.loyaltyTier = updated.loyaltyTier;
  }

  await Transaction.create({
    user: userId, type: 'adjustment', direction: 'debit',
    amount: 0,
    balanceAfter: updated.walletBalance,
    description: `−${takeSpendable} points — ${reason}`,
    status: 'success',
  });

  return { revoked: takeSpendable, tier: newTier };
}

/**
 * Converts points into wallet credit.
 * The points are removed and the wallet credited in a single atomic filter,
 * so a double-submit can't redeem the same points twice.
 */
export async function redeem(userOrId, points) {
  const amount = Math.floor(Number(points));
  const userId = userOrId?._id || userOrId;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw ApiError.badRequest('Enter how many points you want to redeem');
  }
  if (amount < LOYALTY.MIN_REDEEM_POINTS) {
    throw ApiError.badRequest(`You need at least ${LOYALTY.MIN_REDEEM_POINTS} points to redeem`);
  }
  if (amount % LOYALTY.POINTS_PER_RUPEE !== 0) {
    throw ApiError.badRequest(`Redeem in multiples of ${LOYALTY.POINTS_PER_RUPEE} points`);
  }

  const rupees = Math.floor(amount / LOYALTY.POINTS_PER_RUPEE);

  // Points check and wallet credit in one operation — no window to double-spend.
  const updated = await User.findOneAndUpdate(
    { _id: userId, loyaltyPoints: { $gte: amount } },
    { $inc: { loyaltyPoints: -amount, walletBalance: rupees } },
    { new: true }
  );

  if (!updated) {
    const current = await User.findById(userId).select('loyaltyPoints').lean();
    throw ApiError.badRequest(
      `Not enough points. You have ${current?.loyaltyPoints ?? 0}, this needs ${amount}.`
    );
  }

  if (userOrId && typeof userOrId === 'object' && 'loyaltyPoints' in userOrId) {
    userOrId.loyaltyPoints = updated.loyaltyPoints;
    userOrId.walletBalance = updated.walletBalance;
  }

  await Transaction.create({
    user: userId, type: 'cashback', direction: 'credit', amount: rupees,
    balanceAfter: updated.walletBalance,
    description: `Redeemed ${amount} points for ₹${rupees}`,
    status: 'success',
  });

  return {
    pointsRedeemed: amount,
    rupeesCredited: rupees,
    loyaltyPoints: updated.loyaltyPoints,
    walletBalance: updated.walletBalance,
  };
}

/** Everything the loyalty screen needs, in one object. */
export function summarise(user) {
  const lifetime = user.lifetimePoints || 0;
  const tier = tierFor(lifetime);
  const next = nextTierFor(lifetime);
  return {
    points: user.loyaltyPoints || 0,
    lifetimePoints: lifetime,
    tier,
    nextTier: next,
    redeemableRupees: Math.floor((user.loyaltyPoints || 0) / LOYALTY.POINTS_PER_RUPEE),
    minRedeemPoints: LOYALTY.MIN_REDEEM_POINTS,
    pointsPerRupee: LOYALTY.POINTS_PER_RUPEE,
    pointsPer100: LOYALTY.POINTS_PER_100,
    allTiers: LOYALTY_TIERS,
  };
}
