import { z } from 'zod';
import { Booking, Venue, User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { BOOKING_STATUS } from '../config/constants.js';
import * as payments from '../services/payment.service.js';
import * as loyalty from '../services/loyalty.service.js';

export const orderSchema = z.object({
  groupRef: z.string().trim().min(4).max(40),
}).strict();

export const verifySchema = z.object({
  groupRef: z.string().trim().min(4).max(40),
  orderId: z.string().trim().min(4).max(80),
  paymentId: z.string().trim().min(4).max(80),
  signature: z.string().trim().min(8).max(256),
}).strict();

/** GET /api/payments/config — what the checkout page needs to boot. */
export const config = asyncHandler(async (req, res) => ok(res, payments.publicConfig()));

/**
 * Gateway routes are disabled unless a real gateway is configured.
 *
 * Without this, `verifyPaymentSignature` returns true for anything (there is
 * no secret to check against) and the gateway cross-check is skipped, so any
 * caller could mark a booking paid without paying — and then cancel it for a
 * refund of money that never existed. The wallet flow is the supported path
 * in simulated mode.
 */
function requireLiveGateway() {
  if (!payments.isLive()) {
    throw new ApiError(
      501,
      'Card and UPI payments are not enabled on this server. Pay from your GameOn wallet instead.'
    );
  }
}

/**
 * POST /api/payments/order
 *
 * The amount comes from the booking rows in the database, never from the
 * request. A client-supplied amount is the oldest bug in online payments.
 */
export const createOrder = asyncHandler(async (req, res) => {
  requireLiveGateway();

  const rows = await Booking.find({ groupRef: req.body.groupRef });
  if (!rows.length) throw ApiError.notFound('Booking not found');
  if (String(rows[0].user) !== String(req.user._id)) {
    throw ApiError.forbidden('That booking belongs to someone else');
  }
  if (rows[0].payment.status === 'paid') throw ApiError.badRequest('This booking is already paid');
  if (![BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED].includes(rows[0].status)) {
    throw ApiError.badRequest('This booking is no longer active');
  }

  const amount = rows.reduce((s, b) => s + b.totalAmount, 0);
  if (amount <= 0) throw ApiError.badRequest('Nothing to pay');

  const order = await payments.createOrder({
    amount,
    receipt: rows[0].groupRef,
    notes: { groupRef: rows[0].groupRef, bookingRef: rows[0].bookingRef, userId: String(req.user._id) },
  });

  await Booking.updateMany(
    { groupRef: rows[0].groupRef },
    { $set: { 'payment.orderId': order.orderId, 'payment.method': 'gateway' } }
  );

  return ok(res, { ...order, amountRupees: amount, name: req.user.name, email: req.user.email });
});

/**
 * POST /api/payments/verify
 *
 * Marks a booking paid only after the HMAC signature checks out AND the
 * gateway confirms the payment was captured for the right amount. Trusting
 * the client's word here is how people get free bookings.
 */
export const verify = asyncHandler(async (req, res) => {
  requireLiveGateway();

  const { groupRef, orderId, paymentId, signature } = req.body;

  const rows = await Booking.find({ groupRef });
  if (!rows.length) throw ApiError.notFound('Booking not found');
  if (String(rows[0].user) !== String(req.user._id)) {
    throw ApiError.forbidden('That booking belongs to someone else');
  }
  if (rows[0].payment.status === 'paid') {
    return ok(res, { alreadyPaid: true, message: 'This booking is already paid.' });
  }

  // ── Only a live, unsettled booking may be paid for. Without this a
  //    cancelled booking could be flipped back to confirmed after its refund
  //    had already been paid out.
  if (![BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED].includes(rows[0].status)) {
    throw ApiError.badRequest('This booking is no longer active');
  }

  // ── The order must be the one THIS booking created. Previously the check
  //    was skipped when orderId was empty, so a paid receipt from one booking
  //    could be replayed against another of the same price.
  if (!rows[0].payment.orderId || rows[0].payment.orderId !== orderId) {
    throw ApiError.badRequest('That payment does not belong to this booking');
  }

  // ── A gateway payment id may settle exactly one booking, ever.
  const reused = await Booking.exists({
    'payment.transactionId': paymentId,
    groupRef: { $ne: groupRef },
  });
  if (reused) throw ApiError.badRequest('That payment has already been used for another booking');

  if (!payments.verifyPaymentSignature({ orderId, paymentId, signature })) {
    throw ApiError.badRequest('Payment could not be verified. If you were charged, it will be refunded automatically.');
  }

  const expected = rows.reduce((s, b) => s + b.totalAmount, 0);

  // Ask the gateway directly rather than believing the callback.
  if (payments.isLive()) {
    const payment = await payments.fetchPayment(paymentId);
    if (!['captured', 'authorized'].includes(payment.status)) {
      throw ApiError.badRequest(`Payment is ${payment.status}, not captured.`);
    }
    if (Math.round(payment.amount) !== Math.round(expected * 100)) {
      throw ApiError.badRequest('The amount paid does not match this booking.');
    }
  }

  // Claim the group on a single document first. Two simultaneous verifies
  // could otherwise both see "unpaid", both pass, and both award points.
  const claim = await Booking.findOneAndUpdate(
    { _id: rows[0]._id, 'payment.status': { $ne: 'paid' } },
    { $set: { 'payment.status': 'paid' } }
  );
  if (!claim) {
    return ok(res, { alreadyPaid: true, message: 'This booking is already paid.' });
  }

  await Booking.updateMany({ groupRef }, [{
    $set: {
      'payment.status': 'paid',
      'payment.paidAt': '$$NOW',
      'payment.transactionId': paymentId,
      'payment.amountPaid': '$totalAmount',
      // A pipeline update bypasses the pre('save') hook that keeps slotLocked
      // in step with status, so it has to be set explicitly here — otherwise
      // the slot stops being reserved and the double-booking index goes blind.
      slotLocked: true,
      status: {
        $cond: [{ $eq: ['$mode', 'automated'] }, BOOKING_STATUS.CONFIRMED, '$status'],
      },
    },
  }]);

  // The webhook may have got here first; pointsAwarded is the guard.
  let award = null;
  const fresh = await Booking.findById(rows[0]._id).select('pointsAwarded').lean();
  if (!fresh?.pointsAwarded) {
    const pts = loyalty.pointsForSpend(expected, req.user.loyaltyTier);
    award = await loyalty.award(req.user, pts, { reason: 'Booking payment', booking: rows[0] });
    await Booking.updateMany({ groupRef }, { $set: { pointsAwarded: pts } });
    await Venue.updateOne({ _id: rows[0].venue }, { $inc: { bookingCount: rows.length } });
  }

  return ok(res, {
    paid: true,
    groupRef,
    loyalty: award,
    message: 'Payment confirmed. See you on the pitch.',
  });
});

/**
 * POST /api/payments/webhook
 *
 * Razorpay's authoritative callback. Runs unauthenticated — the signature IS
 * the authentication — and is mounted with a raw body parser so the HMAC is
 * computed over exactly the bytes that were signed. Re-serialising parsed
 * JSON changes key order and whitespace, and the signature stops matching.
 */
export const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);

  if (!payments.verifyWebhookSignature(raw, signature)) {
    // 400, not 401 — Razorpay retries on 5xx and we do not want a retry storm
    // on a request we will never accept.
    throw ApiError.badRequest('Invalid webhook signature');
  }

  const event = JSON.parse(raw);
  const entity = event?.payload?.payment?.entity;

  if (event?.event === 'payment.captured' && entity) {
    // `notes` on a PAYMENT can be set from client-side Checkout, so it is a
    // hint about which booking to look at — never proof. The booking is found
    // by the order id WE created, and the amount is re-derived from our own
    // rows before anything is marked paid.
    const rows = entity.order_id
      ? await Booking.find({ 'payment.orderId': entity.order_id })
      : [];

    if (rows.length) {
      const groupRef = rows[0].groupRef;
      const expected = rows.reduce((s, b) => s + b.totalAmount, 0);
      const live = [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED].includes(rows[0].status);
      const amountMatches = Math.round(entity.amount) === Math.round(expected * 100);

      if (live && amountMatches && rows[0].payment.status !== 'paid') {
        await Booking.updateMany({ groupRef, 'payment.status': { $ne: 'paid' } }, [{
          $set: {
            'payment.status': 'paid',
            'payment.paidAt': '$$NOW',
            'payment.transactionId': entity.id,
            'payment.amountPaid': '$totalAmount',
            slotLocked: true,
            status: {
              $cond: [{ $eq: ['$mode', 'automated'] }, BOOKING_STATUS.CONFIRMED, '$status'],
            },
          },
        }]);

        // The webhook can land before the browser calls /verify. Awarding
        // points here too — guarded by pointsAwarded — means the player is
        // never short-changed by a race they cannot see.
        if (!rows[0].pointsAwarded) {
          const user = await User.findById(rows[0].user);
          if (user) {
            const pts = loyalty.pointsForSpend(expected, user.loyaltyTier);
            await loyalty.award(user, pts, { reason: 'Booking payment', booking: rows[0] });
            await Booking.updateMany({ groupRef }, { $set: { pointsAwarded: pts } });
          }
        }
        await Venue.updateOne({ _id: rows[0].venue }, { $inc: { bookingCount: rows.length } });
      } else if (!amountMatches) {
        console.error('[webhook] amount mismatch', { order: entity.order_id, got: entity.amount, expected: expected * 100 });
      }
    }
  }

  if (event?.event === 'payment.failed' && entity?.order_id) {
    await Booking.updateMany(
      { 'payment.orderId': entity.order_id, 'payment.status': { $ne: 'paid' } },
      { $set: { 'payment.status': 'failed' } }
    );
  }

  // Always 200 once the signature is good, or Razorpay retries indefinitely.
  return res.json({ received: true });
});
