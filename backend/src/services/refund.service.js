import { Booking } from '../models/index.js';
import * as payments from './payment.service.js';
import * as wallet from './wallet.service.js';
import logger from '../utils/logger.js';

/**
 * Giving money back.
 *
 * Every refund in this application used to be wallet credit, whatever the
 * customer had actually paid with. Someone who paid ₹1,200 by card and
 * cancelled inside the free window received ₹1,200 of GameOn balance — money
 * that could only ever be spent here, with no withdrawal endpoint anywhere in
 * the API. That is not a refund, and it fails in three separate directions:
 *
 *   - The customer raises a chargeback instead, because from their side the
 *     merchant took their money and did not give it back. Chargebacks are
 *     expensive and enough of them costs you the gateway account.
 *   - Holding customer money as spendable balance is a prepaid payment
 *     instrument. Funded by real card payments rather than promotions, that
 *     is regulated territory rather than a product decision.
 *   - `walletLiability` on the admin dashboard was counting money owed to
 *     users that structurally could not be paid out. It only grows.
 *
 * `payment.service.js` has had `refundPayment` since the gateway was wired in.
 * Nothing ever called it. This is the caller.
 *
 * The rule: money goes back the way it came. A card payment is refunded
 * through Razorpay to the card. A wallet payment is credited back to the
 * wallet, because that IS the original method. Cash at the gate never entered
 * the platform, so there is nothing here to return.
 */

/** How was this booking group actually paid for? */
function methodOf(rows) {
  const p = rows[0]?.payment || {};
  // `/verify` and the webhook both stamp the same transactionId across every
  // row of a group, so one payment id settles the whole booking.
  if (p.method === 'gateway' && p.transactionId) return 'gateway';
  if (p.method === 'pay_at_venue') return 'at_venue';
  return 'wallet';
}

/**
 * Refunds `amount` for one booking group, to wherever the money came from.
 *
 * Claims the refund on the documents BEFORE moving any money, so a crash or a
 * concurrent caller cannot pay it twice. The claim is conditional on
 * `refundStatus` still being 'none' — the same shape as every other
 * money-moving guard in this codebase.
 *
 * Returns `{ refunded, method, reference }`. `refunded: 0` means nothing was
 * owed or the claim was already taken; it is never an error.
 */
export async function issueRefund({
  groupRef, rows, amount, user, description = 'Refund', reference = '',
}) {
  const payable = Math.round(Number(amount) || 0);
  if (payable <= 0) return { refunded: 0, method: 'none', reference: '' };

  const method = methodOf(rows);
  if (method === 'at_venue') {
    // The venue kept the notes. Refunding platform money here would mint it.
    return { refunded: 0, method: 'at_venue', reference: '' };
  }

  // Claim it. Only the caller that actually flips 'none' → 'pending' goes on
  // to move money; a retry or a second request finds nothing to claim.
  const claim = await Booking.updateOne(
    { _id: rows[0]._id, 'cancellation.refundStatus': 'none' },
    { $set: { 'cancellation.refundStatus': 'pending', 'cancellation.refundAmount': payable } }
  );
  if (!claim.modifiedCount) {
    logger.warn('refund already claimed - not paying it twice', { groupRef, amount: payable });
    return { refunded: 0, method: 'already_claimed', reference: '' };
  }

  const settle = async (finalMethod, ref) => {
    await Booking.updateMany(
      { groupRef },
      {
        $set: {
          'cancellation.refundStatus': 'processed',
          'cancellation.refundMethod': finalMethod,
          'cancellation.refundReference': ref || '',
        },
      }
    );
    return { refunded: payable, method: finalMethod, reference: ref || '' };
  };

  if (method === 'gateway' && payments.isLive()) {
    const paymentId = rows[0].payment.transactionId;
    try {
      const result = await payments.refundPayment(paymentId, payable);
      logger.info('gateway refund issued', {
        groupRef, paymentId, amount: payable, refundId: result?.id,
      });
      return settle('gateway', result?.id || '');
    } catch (err) {
      /**
       * The gateway refused or was unreachable.
       *
       * Fall back to wallet credit rather than leaving the customer with
       * nothing. This is the one case where wallet credit is the right
       * answer: the alternative is money that has left their card and
       * arrived nowhere. It is logged at error level because somebody needs
       * to go and issue the real refund from the Razorpay dashboard, and
       * the ledger row says plainly what happened.
       */
      logger.error('gateway refund FAILED - falling back to wallet credit, settle this by hand', {
        err, groupRef, paymentId, amount: payable,
      });
      await wallet.credit(user, payable, {
        type: 'refund',
        booking: rows[0],
        description: `${description} (card refund failed — credited to wallet)`,
        reference,
      });
      return settle('wallet_fallback', paymentId);
    }
  }

  /**
   * Wallet, or a gateway booking on a server with no live gateway.
   *
   * The second case matters more than it looks. With no Razorpay credentials
   * `payments.refundPayment` returns a FAKE success — a made-up refund id,
   * no request, no money moved. Routing a gateway refund through it here
   * would mark the booking refunded and quietly send the customer's money
   * nowhere at all. So the live check is part of the branch above, and
   * anything that reaches this point is credited to the wallet, which is at
   * least real balance the customer can spend.
   */
  if (method === 'gateway') {
    logger.warn('refunding a gateway booking to the wallet - no live gateway is configured', {
      groupRef, amount: payable,
    });
  }

  await wallet.credit(user, payable, {
    type: 'refund', booking: rows[0], description, reference,
  });
  return settle(method === 'gateway' ? 'wallet_fallback' : 'wallet', '');
}

/** Where a refund for this booking would land, for wording shown before the fact. */
export function refundDestination(rows) {
  const method = methodOf(rows);
  if (method === 'gateway') {
    return payments.isLive()
      ? { to: 'source', label: 'back to the card or UPI account you paid with' }
      // No live gateway means nothing can be refunded to source, so the
      // honest answer is the wallet — say that rather than promising a card
      // refund that cannot happen.
      : { to: 'wallet', label: 'to your GameOn wallet' };
  }
  if (method === 'at_venue') {
    return { to: 'venue', label: 'arranged directly with the venue' };
  }
  return { to: 'wallet', label: 'to your GameOn wallet' };
}
