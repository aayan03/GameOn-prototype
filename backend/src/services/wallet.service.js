// @ts-check
import { Transaction, User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * Wallet ledger.
 *
 * Every movement is a row, so a balance is always explainable.
 *
 * SAFETY: balances are changed with a single atomic `findOneAndUpdate` that
 * carries the sufficiency check in its filter. The obvious implementation —
 * read the balance, compare, subtract, save — is a race: two requests firing
 * at once both read ₹1000, both pass a ₹800 check, and the user spends ₹1600
 * they never had. Doing the check inside the update means the database
 * arbitrates, and the second request simply finds no matching document.
 */

/** Rounds to paise so floating point can't drift a balance over time. */
const money = (n) => Math.round(Number(n) * 100) / 100;

export async function debit(userOrId, amount, {
  type = 'booking_payment', booking = null, description = '', reference = '',
} = {}) {
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;

  const userId = userOrId?._id || userOrId;

  const updated = await User.findOneAndUpdate(
    { _id: userId, walletBalance: { $gte: amt } },   // the check IS the filter
    { $inc: { walletBalance: -amt } },
    { new: true }
  );

  if (!updated) {
    const current = await User.findById(userId).select('walletBalance').lean();
    throw ApiError.badRequest(
      `Not enough wallet balance. You have ₹${current?.walletBalance ?? 0}, this costs ₹${amt}.`
    );
  }

  // Keep an in-memory user document in step with what the database now holds.
  if (userOrId && typeof userOrId === 'object' && 'walletBalance' in userOrId) {
    userOrId.walletBalance = updated.walletBalance;
  }

  await Transaction.create({
    user: userId, type, direction: 'debit', amount: amt,
    balanceAfter: updated.walletBalance,
    booking: booking?._id || null,
    reference: reference || booking?.bookingRef || '',
    description: description || 'Booking payment',
    status: 'success',
  });

  return updated.walletBalance;
}

export async function credit(userOrId, amount, {
  type = 'refund', booking = null, description = '', reference = '',
} = {}) {
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;

  const userId = userOrId?._id || userOrId;

  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc: { walletBalance: amt } },
    { new: true }
  );
  if (!updated) throw ApiError.notFound('Account not found');

  if (userOrId && typeof userOrId === 'object' && 'walletBalance' in userOrId) {
    userOrId.walletBalance = updated.walletBalance;
  }

  await Transaction.create({
    user: userId, type, direction: 'credit', amount: amt,
    balanceAfter: updated.walletBalance,
    booking: booking?._id || null,
    reference: reference || booking?.bookingRef || '',
    description: description || 'Refund',
    status: 'success',
  });

  return updated.walletBalance;
}

/**
 * Moves money between two users in the ledger — used when a TeamUp cost split
 * settles up with the host who paid for the slot.
 */
export async function transfer(fromUser, toUser, amount, { description = '', reference = '' } = {}) {
  const amt = money(amount);
  if (amt <= 0) return null;

  await debit(fromUser, amt, { type: 'booking_payment', description, reference });
  try {
    await credit(toUser, amt, { type: 'adjustment', description, reference });
  } catch (err) {
    // The credit failed after the debit succeeded — put the money back rather
    // than silently losing it.
    await credit(fromUser, amt, { type: 'adjustment', description: 'Reversal — transfer failed' });
    throw err;
  }
  return true;
}

export function ledger(userId, limit = 30) {
  return Transaction.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean();
}
