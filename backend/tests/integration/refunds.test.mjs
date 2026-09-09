/**
 * Refunds go back the way the money came in.
 *
 * Before this, every refund was wallet credit whatever the customer had paid
 * with — so a card payment came back as store credit with no way to withdraw
 * it. `payment.service.js` had `refundPayment` the whole time and nothing
 * called it.
 *
 * This file boots the app WITH Razorpay credentials (see the `env` override
 * on startTestServer) so the live branch is genuinely exercised, and stubs
 * `fetch` so no request leaves the machine.
 */

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase,
  post, patch, createUser, createVenue, fundWallet,
  dateKey, firstOpenSlot,
} from '../helpers/harness.mjs';

before(() => startTestServer({
  env: {
    RAZORPAY_KEY_ID: 'rzp_test_fake_for_tests',
    RAZORPAY_KEY_SECRET: 'fake_secret_for_tests',
  },
}));
after(stopTestServer);
beforeEach(resetDatabase);

/* ── Razorpay, stubbed at the network boundary ───────────────── */

const realFetch = globalThis.fetch;
let calls = [];
let refundBehaviour = 'ok';
// What GET /payments/:id reports back, for the post-expiry capture path.
let capturedPaise = 0;

beforeEach(() => { calls = []; refundBehaviour = 'ok'; capturedPaise = 0; });
afterEach(() => { globalThis.fetch = realFetch; });

function stubRazorpay() {
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (!href.startsWith('https://api.razorpay.com/')) return realFetch(url, init);
    calls.push({ href, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });

    if (/\/refund$/.test(href)) {
      if (refundBehaviour === 'reject') {
        return new Response(JSON.stringify({ error: { description: 'Refund not permitted' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (refundBehaviour === 'unreachable') throw new TypeError('network down');
      return new Response(JSON.stringify({ id: 'rfnd_stub_001', status: 'processed' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // POST /orders — the order the checkout is opened against. The API binds
    // this id to the booking, so it has to be a real value.
    if (/\/v1\/orders$/.test(href)) {
      const body = init?.body ? JSON.parse(init.body) : {};
      return new Response(
        JSON.stringify({
          id: `order_stub_${Math.random().toString(36).slice(2, 10)}`,
          amount: body.amount,
          currency: 'INR',
          receipt: body.receipt,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    // GET /payments/:id — what the API asks when it will not take the
    // client's word that a payment was captured.
    if (/\/v1\/payments\/[^/]+$/.test(href)) {
      return new Response(
        JSON.stringify({ id: 'pay_late_001', status: 'captured', amount: capturedPaise }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

/* ── Fixtures ────────────────────────────────────────────────── */

async function scenario({ balance = 50000, mode = 'automated', acceptsPayAtVenue = false } = {}) {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser({ role: 'player' });
  const venue = await createVenue(owner, {
    bookingMode: mode,
    acceptsPayAtVenue,
    // The booking is 3 days (72h) out. A 24h free window means every test
    // below is a 100% refund, so the arithmetic stays about the DESTINATION
    // rather than the percentage.
    cancellationPolicy: { freeCancellationHours: 24, partialRefundHours: 6, partialRefundPercent: 50 },
  });
  await fundWallet(player.id, balance);
  const date = dateKey(3);
  const slot = await firstOpenSlot(venue._id, date);
  return { owner, player, venue, date, slot };
}

const book = ({ venue, slot, date, player }, paymentMethod) => post('/api/bookings', {
  venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start], paymentMethod,
}, { token: player.token });

/** Marks a group paid the way a settled gateway payment leaves it. */
async function settleThroughGateway(groupRef, paymentId = 'pay_stub_001') {
  await mongoose.model('Booking').updateMany({ groupRef }, [{
    $set: {
      'payment.status': 'paid',
      'payment.paidAt': '$$NOW',
      'payment.transactionId': paymentId,
      'payment.amountPaid': '$totalAmount',
    },
  }]);
}

const balanceOf = async (id) => (await mongoose.model('User').findById(id).select('walletBalance').lean()).walletBalance;
const groupRows = (groupRef) => mongoose.model('Booking').find({ groupRef }).lean();

/* ── A card payment goes back to the card ────────────────────── */

test('cancelling a card booking refunds through the gateway, not the wallet', async () => {
  stubRazorpay();
  const s = await scenario();
  const created = await book(s, 'gateway');
  assert.equal(created.status, 201);
  const { groupRef, totalAmount } = created.body.data.booking;
  await settleThroughGateway(groupRef);

  const before = await balanceOf(s.player.id);
  const res = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: s.player.token });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.refund.amount, totalAmount);
  assert.equal(res.body.data.refund.method, 'gateway', 'refunded to source');
  assert.equal(res.body.data.refund.reference, 'rfnd_stub_001');

  // The whole point: the wallet is untouched.
  assert.equal(await balanceOf(s.player.id), before,
    'a card refund must not turn into store credit');

  const refundCall = calls.find((c) => /\/refund$/.test(c.href));
  assert.ok(refundCall, 'Razorpay was actually called');
  assert.match(refundCall.href, /\/payments\/pay_stub_001\/refund$/);
  assert.equal(refundCall.body.amount, totalAmount * 100, 'amount sent in paise');

  const rows = await groupRows(groupRef);
  assert.ok(rows.every((b) => b.cancellation.refundMethod === 'gateway'));
  assert.ok(rows.every((b) => b.cancellation.refundStatus === 'processed'));
  assert.equal(rows[0].cancellation.refundReference, 'rfnd_stub_001');
});

test('a partial refund sends only the partial amount to the gateway', async () => {
  stubRazorpay();
  const owner = await createUser({ role: 'owner' });
  const player = await createUser({ role: 'player' });
  const venue = await createVenue(owner, {
    // 72h out: past the 240h free window, inside the 6h partial floor, so
    // this lands squarely in the 50% band.
    cancellationPolicy: { freeCancellationHours: 240, partialRefundHours: 6, partialRefundPercent: 50 },
  });
  await fundWallet(player.id, 50000);
  const date = dateKey(3);
  const slot = await firstOpenSlot(venue._id, date);

  const created = await book({ venue, slot, date, player }, 'gateway');
  const { groupRef, totalAmount } = created.body.data.booking;
  await settleThroughGateway(groupRef);

  const res = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: player.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.refund.percent, 50);

  const refundCall = calls.find((c) => /\/refund$/.test(c.href));
  assert.equal(refundCall.body.amount, Math.round(totalAmount / 2) * 100,
    'the gateway is asked for half, not the whole payment');
});

/* ── When the gateway will not play ──────────────────────────── */

test('a rejected gateway refund falls back to the wallet and is flagged', async () => {
  stubRazorpay();
  refundBehaviour = 'reject';
  const s = await scenario();
  const created = await book(s, 'gateway');
  const { groupRef, totalAmount } = created.body.data.booking;
  await settleThroughGateway(groupRef);

  const before = await balanceOf(s.player.id);
  const res = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: s.player.token });

  assert.equal(res.status, 200, 'the cancellation still succeeds');
  assert.equal(res.body.data.refund.method, 'wallet_fallback');
  assert.equal(await balanceOf(s.player.id), before + totalAmount,
    'the customer is not left with nothing');

  const rows = await groupRows(groupRef);
  assert.equal(rows[0].cancellation.refundMethod, 'wallet_fallback',
    'flagged, so somebody can issue the real refund by hand');
});

test('an unreachable gateway also falls back rather than losing the money', async () => {
  stubRazorpay();
  refundBehaviour = 'unreachable';
  const s = await scenario();
  const created = await book(s, 'gateway');
  const { groupRef, totalAmount } = created.body.data.booking;
  await settleThroughGateway(groupRef);

  const before = await balanceOf(s.player.id);
  const res = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: s.player.token });
  assert.equal(res.status, 200);
  assert.equal(await balanceOf(s.player.id), before + totalAmount);
});

/* ── Wallet payments still behave ────────────────────────────── */

test('a wallet booking still refunds to the wallet', async () => {
  stubRazorpay();
  const s = await scenario();
  const created = await book(s, 'wallet');
  const { groupRef, totalAmount } = created.body.data.booking;

  const afterPaying = await balanceOf(s.player.id);
  const res = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: s.player.token });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.refund.method, 'wallet');
  assert.equal(await balanceOf(s.player.id), afterPaying + totalAmount);
  assert.equal(calls.filter((c) => /\/refund$/.test(c.href)).length, 0,
    'the gateway is not involved in a wallet refund');
});

test('a pay-at-venue booking refunds nothing through us', async () => {
  stubRazorpay();
  const s = await scenario({ mode: 'manual', acceptsPayAtVenue: true });
  const created = await book(s, 'pay_at_venue');
  const { groupRef } = created.body.data.booking;

  // The owner records the cash, then the player cancels.
  await patch(`/api/bookings/${groupRef}/decision`, { decision: 'confirm' }, { token: s.owner.token });
  await patch(`/api/bookings/${groupRef}/settle`, {}, { token: s.owner.token });

  const before = await balanceOf(s.player.id);
  const res = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: s.player.token });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.refund.amount, 0, 'the venue kept the notes');
  assert.equal(await balanceOf(s.player.id), before, 'no platform money is minted');
  assert.equal(calls.filter((c) => /\/refund$/.test(c.href)).length, 0);
});

/* ── Paid once, never twice ──────────────────────────────────── */

test('two simultaneous cancels issue exactly one gateway refund', async () => {
  stubRazorpay();
  const s = await scenario();
  const created = await book(s, 'gateway');
  const { groupRef } = created.body.data.booking;
  await settleThroughGateway(groupRef);

  const [a, b] = await Promise.all([
    patch(`/api/bookings/${groupRef}/cancel`, {}, { token: s.player.token }),
    patch(`/api/bookings/${groupRef}/cancel`, {}, { token: s.player.token }),
  ]);

  assert.equal([a, b].filter((r) => r.status === 200).length, 1, 'one cancel wins');
  assert.equal(calls.filter((c) => /\/refund$/.test(c.href)).length, 1,
    'Razorpay was asked for the refund exactly once');
});

test('an expired manual request refunds a card payment to the card', async () => {
  stubRazorpay();
  const s = await scenario({ mode: 'manual' });
  const created = await book(s, 'gateway');
  const { groupRef, totalAmount } = created.body.data.booking;
  await settleThroughGateway(groupRef, 'pay_stub_expiry');

  // Age it so the lifecycle job treats it as unanswered: created long enough
  // ago to have had a fair chance, and starting soon.
  //
  // Through the driver, not the model. Mongoose marks `createdAt` immutable
  // when `timestamps: true`, so a `$set` on it through the model is silently
  // dropped — the update appears to succeed and the document does not change.
  await mongoose.connection.collection('bookings').updateMany(
    { groupRef },
    {
      $set: {
        createdAt: new Date(Date.now() - 2 * 3600_000),
        startsAt: new Date(Date.now() + 30 * 60_000),
      },
    },
  );

  const before = await balanceOf(s.player.id);
  const { runLifecycle } = await import('../../src/services/lifecycle.service.js');
  const result = await runLifecycle();

  assert.equal(result.expired, 1, JSON.stringify(result));
  assert.equal(result.refunded, totalAmount);
  assert.equal(await balanceOf(s.player.id), before, 'not credited to the wallet');

  const refundCall = calls.find((c) => /pay_stub_expiry\/refund$/.test(c.href));
  assert.ok(refundCall, 'the expiry refund went to the gateway');

  const rows = await groupRows(groupRef);
  assert.ok(rows.every((b) => b.status === 'expired'));
  assert.equal(rows[0].cancellation.refundMethod, 'gateway');
});

/* ── A capture that lands after the hold expired (GO-04) ─────── */

/**
 * The player was on Razorpay's page when the ten-minute hold ran out. The
 * slot is gone and cannot be given back — somebody else may hold it now — so
 * the money has to be. Back to the CARD: an expired booking was never marked
 * paid, so `payment.transactionId` is empty, and the refund service used to
 * read that as "wallet" and hand a real card payment back as store credit.
 */
async function expiredGatewayHold({ paise = 92700 } = {}) {
  const s = await scenario();
  const created = await post('/api/bookings', {
    venueId: s.venue._id, courtId: s.slot.courtId, date: s.date,
    starts: [s.slot.start], paymentMethod: 'gateway',
  }, { token: s.player.token });
  assert.equal(created.status, 201);

  const { groupRef } = created.body.data.booking;
  const order = await post('/api/payments/order', { groupRef }, { token: s.player.token });
  assert.equal(order.status, 200);

  // The sweep got there first.
  await mongoose.model('Booking').updateMany({ groupRef },
    { $set: { status: 'expired', slotLocked: false } });

  capturedPaise = paise;
  return { ...s, groupRef, orderId: order.body.data.orderId };
}

test('a payment captured after expiry is refunded to the card, not the wallet', async () => {
  stubRazorpay();
  const { player, groupRef, orderId } = await expiredGatewayHold();
  const before = await balanceOf(player.id);

  const verify = await post('/api/payments/verify', {
    groupRef, orderId, paymentId: 'pay_late_001', signature: 'x'.repeat(64),
  }, { token: player.token });

  assert.equal(verify.status, 400, 'the slot is gone, so this is not a success');
  assert.match(verify.body.error.message, /money is on its way back/i);

  const refundCalls = calls.filter((c) => /\/refund$/.test(c.href));
  assert.equal(refundCalls.length, 1, 'the gateway was asked to refund');
  assert.equal(refundCalls[0].body.amount, 92700, 'the full captured amount');

  assert.equal(await balanceOf(player.id), before, 'nothing was minted as wallet credit');

  const row = await mongoose.model('Booking').findOne({ groupRef }).lean();
  assert.equal(row.cancellation.refundMethod, 'gateway');
  assert.equal(row.cancellation.refundStatus, 'processed');
  assert.equal(row.payment.transactionId, 'pay_late_001', 'the capture is on the audit trail');
});

test('the post-expiry refund is issued once, not once per retry', async () => {
  stubRazorpay();
  const { player, groupRef, orderId } = await expiredGatewayHold();

  const body = { groupRef, orderId, paymentId: 'pay_late_001', signature: 'x'.repeat(64) };
  await post('/api/payments/verify', body, { token: player.token });
  await post('/api/payments/verify', body, { token: player.token });

  assert.equal(calls.filter((c) => /\/refund$/.test(c.href)).length, 1,
    'the refund claim on the document stops the second one');
});

test('an expired hold with nothing captured refunds nothing', async () => {
  stubRazorpay();
  const { player, groupRef, orderId } = await expiredGatewayHold({ paise: 0 });
  const before = await balanceOf(player.id);

  const verify = await post('/api/payments/verify', {
    groupRef, orderId, paymentId: 'pay_late_001', signature: 'x'.repeat(64),
  }, { token: player.token });

  assert.equal(verify.status, 400);
  assert.match(verify.body.error.message, /Nothing was charged/i);
  assert.equal(calls.filter((c) => /\/refund$/.test(c.href)).length, 0);
  assert.equal(await balanceOf(player.id), before);
});

test('an expired hold cannot be used to refund somebody else\'s payment', async () => {
  stubRazorpay();
  const { player, groupRef, orderId } = await expiredGatewayHold();

  // A captured payment that already settled a different booking.
  const other = await scenario();
  const theirs = await post('/api/bookings', {
    venueId: other.venue._id, courtId: other.slot.courtId, date: other.date,
    starts: [other.slot.start], paymentMethod: 'wallet',
  }, { token: other.player.token });
  await settleThroughGateway(theirs.body.data.booking.groupRef, 'pay_someone_else');

  const verify = await post('/api/payments/verify', {
    groupRef, orderId, paymentId: 'pay_someone_else', signature: 'x'.repeat(64),
  }, { token: player.token });

  assert.equal(verify.status, 400);
  assert.match(verify.body.error.message, /already been used/i);
  assert.equal(calls.filter((c) => /\/refund$/.test(c.href)).length, 0);
});

test('an expired hold cannot name an order it did not create', async () => {
  stubRazorpay();
  const { player, groupRef } = await expiredGatewayHold();

  const verify = await post('/api/payments/verify', {
    groupRef, orderId: 'order_not_ours', paymentId: 'pay_late_001', signature: 'x'.repeat(64),
  }, { token: player.token });

  assert.equal(verify.status, 400);
  assert.match(verify.body.error.message, /does not belong to this booking/i);
  assert.equal(calls.filter((c) => /\/refund$/.test(c.href)).length, 0);
});
