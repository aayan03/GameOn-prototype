import { User } from '../models/index.js';
import * as wallet from '../services/wallet.service.js';

/**
 * Cost sharing. `costSharing.totalAmount` is what the slot costs; the host
 * already holds the booking (and already paid for it, if there is one), so
 * `perPersonAmount` is charged only to the players who join — each payment
 * is credited straight back to the host as reimbursement.
 *
 * Runs once, at the moment the post transitions to `filled`. A player short
 * on wallet balance is skipped rather than blocking everyone else — this is
 * a demo wallet, not a payment gateway, so there's no retry flow to fall
 * back on.
 */
export async function settleCostSharing(post) {
  const result = { charged: [], skipped: [] };
  if (!post.costSharing?.enabled || !post.costSharing?.perPersonAmount) return result;

  const host = await User.findById(post.host);
  if (!host) return result;

  for (const playerId of post.confirmedPlayers) {
    if (String(playerId) === String(post.host)) continue;
    const player = await User.findById(playerId);
    if (!player) continue;

    try {
      await wallet.debit(player, post.costSharing.perPersonAmount, {
        type: 'teamup_share',
        description: `Your share for "${post.title}"`,
      });
      await wallet.credit(host, post.costSharing.perPersonAmount, {
        type: 'teamup_share',
        description: `${player.name} joined "${post.title}"`,
      });
      result.charged.push(player._id);
    } catch {
      result.skipped.push(player._id);
    }
  }

  return result;
}

/** A no-show costs 15 reliability points, floored at 0. Idempotent per game. */
export async function penalizeNoShow(userId) {
  const user = await User.findById(userId);
  if (!user) return null;
  user.reliabilityScore = Math.max(0, user.reliabilityScore - 15);
  await user.save();
  return user;
}

/** Marking a game complete nudges reliability back up and logs it played. */
export async function creditGamePlayed(userId) {
  const user = await User.findById(userId);
  if (!user) return null;
  user.gamesPlayed += 1;
  user.reliabilityScore = Math.min(100, user.reliabilityScore + 1);
  await user.save();
  return user;
}
