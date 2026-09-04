/**
 * Money that has already been collected must never be collected again, and
 * money that was collected for a booking the venue refuses must come back.
 *
 * Both of these live in `decideBooking`, the owner's confirm/decline action
 * on a manual venue's queue — the one place in the app where somebody OTHER
 * than the payer moves their money.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase,
  post, patch, get, createUser, createVenue, fundWallet,
  dateKey, firstOpenSlot,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

/** An owner, a funded player, and a MANUAL venue whose bookings need confirming. */
async function manualScenario({ balance = 50000 } = {}) {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser({ role: 'player' });
  const venue = await createVenue(owner, { bookingMode: 'manual' });
  await fundWallet(player.id, balance);
  const date = dateKey(2);
  const slot = await firstOpenSlot(venue._id, date);
  return { owner, player, venue, date, slot };
}

async function bookGateway({ venue, slot, date, player }) {
  const res = await post('/api/bookings', {
    venueId: venue._id,
    courtId: slot.courtId,
    date,
    starts: [slot.start],
    paymentMethod: 'gateway',
  }, { token: player.token });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.booking;
}

/**
 * Marks a group paid the way a real gateway settlement does, without needing
 * live Razorpay credentials. `/payments/verify` is 501 in simulated mode, so
 * this stands in for the state it would have left behind.
 */
async function settleThroughGateway(groupRef) {
  await mongoose.model('Booking').updateMany({ groupRef }, [{
    $set: {
      'payment.status': 'paid',
      'payment.paidAt': '$$NOW',
      'payment.transactionId': 'pay_test_settled',
      'payment.amountPaid': '$totalAmount',
    },
  }]);
}

const balanceOf = async (userId) => {
  const u = await mongoose.model('User').findById(userId).select('walletBalance').lean();
  return u.walletBalance;
};

/* ── Confirming ──────────────────────────────────────────────── */

test('confirming a gateway booking that is already paid does not charge the wallet again', async () => {
  const { owner, player, venue, date, slot } = await manualScenario();
  const booking = await bookGateway({ venue, slot, date, player });

  // The player completes checkout while the request sits in the owner's queue.
  await settleThroughGateway(booking.groupRef);
  const before = await balanceOf(player.id);

  const res = await patch(`/api/bookings/${booking.groupRef}/decision`,
    { decision: 'confirm' }, { token: owner.token });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'confirmed');
  assert.equal(await balanceOf(player.id), before,
    'the wallet was debited for a booking Razorpay had already collected');
});

test('confirming an UNPAID gateway booking leaves the money to the gateway', async () => {
  const { owner, player, venue, date, slot } = await manualScenario();
  const booking = await bookGateway({ venue, slot, date, player });
  const before = await balanceOf(player.id);

  const res = await patch(`/api/bookings/${booking.groupRef}/decision`,
    { decision: 'confirm' }, { token: owner.token });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'confirmed');
  assert.equal(res.body.data.awaitingPayment, true, 'the player still owes the gateway');
  assert.equal(await balanceOf(player.id), before,
    'a card/UPI booking must never settle against the wallet');

  const rows = await mongoose.model('Booking').find({ groupRef: booking.groupRef }).lean();
  assert.ok(rows.every((b) => b.payment.status !== 'paid'), 'nothing was collected, so nothing is paid');
});

test('confirming a wallet booking still charges the wallet exactly once', async () => {
  const { owner, player, venue, date, slot } = await manualScenario();
  const res = await post('/api/bookings', {
    venueId: venue._id,
    courtId: slot.courtId,
    date,
    starts: [slot.start],
    paymentMethod: 'wallet',
  }, { token: player.token });
  assert.equal(res.status, 201);
  const { groupRef, totalAmount } = res.body.data.booking;

  const before = await balanceOf(player.id);
  const first = await patch(`/api/bookings/${groupRef}/decision`,
    { decision: 'confirm' }, { token: owner.token });
  assert.equal(first.status, 200);
  assert.equal(await balanceOf(player.id), before - totalAmount);

  // A second tap must not take the money twice.
  const second = await patch(`/api/bookings/${groupRef}/decision`,
    { decision: 'confirm' }, { token: owner.token });
  assert.equal(second.status, 400, 'already handled');
  assert.equal(await balanceOf(player.id), before - totalAmount);
});

/* ── Declining ───────────────────────────────────────────────── */

test('declining a booking the player already paid for refunds it in full', async () => {
  const { owner, player, venue, date, slot } = await manualScenario();
  const booking = await bookGateway({ venue, slot, date, player });
  await settleThroughGateway(booking.groupRef);

  const before = await balanceOf(player.id);

  const res = await patch(`/api/bookings/${booking.groupRef}/decision`,
    { decision: 'reject' }, { token: owner.token });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.refunded, booking.totalAmount);
  assert.equal(await balanceOf(player.id), before + booking.totalAmount,
    'the venue said no, so the money comes back');

  const rows = await mongoose.model('Booking').find({ groupRef: booking.groupRef }).lean();
  assert.ok(rows.every((b) => b.status === 'rejected'));
  assert.ok(rows.every((b) => b.cancellation.refundStatus === 'processed'));
});

test('declining an unpaid booking refunds nothing and says so', async () => {
  const { owner, player, venue, date, slot } = await manualScenario();
  const booking = await bookGateway({ venue, slot, date, player });
  const before = await balanceOf(player.id);

  const res = await patch(`/api/bookings/${booking.groupRef}/decision`,
    { decision: 'reject' }, { token: owner.token });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.refunded, 0);
  assert.equal(await balanceOf(player.id), before);
});

test('two simultaneous declines refund only once', async () => {
  const { owner, player, venue, date, slot } = await manualScenario();
  const booking = await bookGateway({ venue, slot, date, player });
  await settleThroughGateway(booking.groupRef);
  const before = await balanceOf(player.id);

  const [a, b] = await Promise.all([
    patch(`/api/bookings/${booking.groupRef}/decision`, { decision: 'reject' }, { token: owner.token }),
    patch(`/api/bookings/${booking.groupRef}/decision`, { decision: 'reject' }, { token: owner.token }),
  ]);

  const wins = [a, b].filter((r) => r.status === 200);
  assert.equal(wins.length, 1, 'exactly one decline may take effect');
  assert.equal(await balanceOf(player.id), before + booking.totalAmount,
    'the refund was paid once, not twice');
});

/* ── The gateway gate ────────────────────────────────────────── */

test('gateway endpoints are closed while no real gateway is configured', async () => {
  const { player, venue, date, slot } = await manualScenario();
  const booking = await bookGateway({ venue, slot, date, player });

  const order = await post('/api/payments/order', { groupRef: booking.groupRef }, { token: player.token });
  assert.equal(order.status, 501, 'no Razorpay keys, so no orders');

  const verify = await post('/api/payments/verify', {
    groupRef: booking.groupRef,
    orderId: 'order_forged',
    paymentId: 'pay_forged',
    signature: 'deadbeefdeadbeef',
  }, { token: player.token });
  assert.equal(verify.status, 501, 'a booking cannot be marked paid without a gateway behind it');
});

test('the public payment config never leaks the secret', async () => {
  const res = await get('/api/payments/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.mode, 'mock');
  assert.equal(res.body.data.keyId, null);
  assert.ok(!JSON.stringify(res.body).toLowerCase().includes('secret'));
});
