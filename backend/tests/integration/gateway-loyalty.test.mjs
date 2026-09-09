/**
 * Points earned on a CARD booking must be clawed back exactly once.
 *
 * `pointsAwarded` is stored per booking row, and cancellation sums it across
 * the group — so it has to be written to ONE row, whatever settled the
 * payment. `createBooking` has always done that, with a comment explaining
 * why. The two gateway settlement paths did not: both wrote the group total
 * onto every slot with `updateMany`, so a three-slot booking that earned 90
 * points reported 270 at cancellation.
 *
 * That failed in two directions, depending on what the customer's balance
 * could absorb. With points banked from other bookings, `revoke` took all 270
 * — deleting points earned elsewhere and dropping them a loyalty tier. With
 * only this booking's points, the unrecoverable remainder was converted to
 * rupees and subtracted from their CASH REFUND.
 *
 * This drives the webhook, which is the settlement path that can be exercised
 * without a live gateway: `/payments/verify` cross-checks the capture against
 * Razorpay over the network, so it cannot run offline. It carries the
 * identical single-row write, and the invariant asserted here — at most one
 * row of a group ever holds points — is the one both paths have to keep.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase,
  post, patch, get, createUser, createVenue,
  dateKey, serverUrl,
} from '../helpers/harness.mjs';

/**
 * A webhook secret, and deliberately no API keys.
 *
 * `verifyWebhookSignature` needs only the webhook secret, so the captured
 * path runs in full. Leaving RAZORPAY_KEY_ID unset keeps `payments.isLive()`
 * false, which means nothing in this file reaches for api.razorpay.com — the
 * refund lands in the wallet instead of on a card, and the amount, which is
 * what this test is about, is identical either way.
 */
const WEBHOOK_SECRET = 'test_webhook_secret_for_signature_checks';

before(() => startTestServer({ env: { RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET } }));
after(stopTestServer);
beforeEach(resetDatabase);

const SLOT_COUNT = 3;

/** Consecutive available slots on one court, so the booking spans several rows. */
async function openSlots(venueId, date, count) {
  const res = await get(`/api/venues/${venueId}/availability?date=${date}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const court = res.body.data.courts[0];

  const free = court.slots.filter((s) => s.status === 'available');
  for (let i = 0; i + count <= free.length; i++) {
    const run = free.slice(i, i + count);
    const contiguous = run.every((s, n) => n === 0 || s.start === run[n - 1].end);
    if (contiguous) return { courtId: court.courtId, starts: run.map((s) => s.start) };
  }
  throw new Error(`no run of ${count} consecutive open slots on ${date}`);
}

/** A player holding a multi-slot gateway booking that is created but unpaid. */
async function pendingCardBooking() {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser({ role: 'player' });
  const venue = await createVenue(owner);
  // Far enough out to sit inside the 24-hour free-cancellation window, so the
  // refund below is the full amount and any shortfall shows up undiluted.
  const date = dateKey(3);
  const { courtId, starts } = await openSlots(venue._id, date, SLOT_COUNT);

  const res = await post('/api/bookings', {
    venueId: venue._id, courtId, date, starts, paymentMethod: 'gateway',
  }, { token: player.token });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const { groupRef, totalAmount } = res.body.data.booking;

  // What POST /api/payments/order would have stamped. That endpoint is 501
  // without live keys, and the webhook finds the booking by this field.
  const orderId = `order_${crypto.randomBytes(6).toString('hex')}`;
  await mongoose.model('Booking').updateMany({ groupRef }, { $set: { 'payment.orderId': orderId } });

  return { player, venue, groupRef, orderId, totalAmount };
}

/** Delivers a signed payment.captured, the way Razorpay does. */
async function deliverCapture({ orderId, amountPaise }) {
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: `pay_${crypto.randomBytes(6).toString('hex')}`,
          order_id: orderId,
          amount: amountPaise,
          status: 'captured',
        },
      },
    },
  });

  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

  const res = await fetch(`${serverUrl()}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature },
    body,
  });
  assert.equal(res.status, 200, `webhook rejected: ${await res.text()}`);
}

const rowsOf = (groupRef) =>
  mongoose.model('Booking').find({ groupRef }).select('pointsAwarded totalAmount status payment').lean();

const userOf = (id) =>
  mongoose.model('User').findById(id).select('loyaltyPoints lifetimePoints loyaltyTier walletBalance').lean();

test('a card payment records its points on exactly one row of the group', async () => {
  const { player, groupRef, totalAmount } = await pendingCardBooking();

  // Every account opens with a signup bonus, so measure what the booking
  // moved rather than the balance it landed on.
  const before = await userOf(player.id);
  await deliverCapture({ orderId: (await rowsOf(groupRef))[0].payment.orderId, amountPaise: totalAmount * 100 });
  const earned = (await userOf(player.id)).loyaltyPoints - before.loyaltyPoints;
  assert.ok(earned > 0, 'the payment should have awarded points');

  const rows = await rowsOf(groupRef);
  assert.equal(rows.length, SLOT_COUNT, 'the booking should span one row per slot');
  assert.ok(rows.every((r) => r.payment.status === 'paid'), 'every row should be marked paid');

  const carrying = rows.filter((r) => r.pointsAwarded > 0);
  assert.equal(
    carrying.length, 1,
    `points must sit on one row, found ${carrying.length} of ${rows.length} carrying them`
  );

  // The stored total is what cancellation reads back, so it has to equal what
  // the customer was actually given — not a multiple of it.
  const stored = rows.reduce((sum, r) => sum + (r.pointsAwarded || 0), 0);
  assert.equal(stored, earned, 'stored points must match the points actually awarded');
});

test('cancelling a multi-slot card booking refunds in full and takes back only what was given', async () => {
  const { player, groupRef, totalAmount } = await pendingCardBooking();

  const before = await userOf(player.id);
  await deliverCapture({ orderId: (await rowsOf(groupRef))[0].payment.orderId, amountPaise: totalAmount * 100 });
  const paid = await userOf(player.id);
  const earned = paid.loyaltyPoints - before.loyaltyPoints;
  assert.ok(earned > 0, 'the booking should have earned points to claw back');

  const res = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: player.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const { refund } = res.body.data;
  assert.equal(refund.percent, 100, 'cancelling three days out is inside the free window');
  assert.equal(
    refund.pointsAdjustment, 0,
    'nothing should be withheld: every point awarded was still there to take back'
  );
  assert.equal(
    refund.amount, totalAmount,
    `refund must be the full ${totalAmount}, not reduced by a phantom points shortfall`
  );

  // The clawback took the points this booking earned and nothing more, which
  // puts the account back exactly where it started.
  const after = await userOf(player.id);
  assert.equal(after.loyaltyPoints, before.loyaltyPoints, 'exactly the awarded points should be revoked');
  assert.equal(
    after.lifetimePoints, before.lifetimePoints,
    'lifetime points drive the tier, so they must not over-drop'
  );
});

test('points banked from other bookings survive a card cancellation', async () => {
  const { player, groupRef, totalAmount } = await pendingCardBooking();

  const before = await userOf(player.id);
  await deliverCapture({ orderId: (await rowsOf(groupRef))[0].payment.orderId, amountPaise: totalAmount * 100 });
  const earned = (await userOf(player.id)).loyaltyPoints - before.loyaltyPoints;

  // Points earned elsewhere — a previous game, a review bonus. `revoke`
  // subtracts from the single balance, so an over-counted clawback eats these
  // rather than stopping at what this booking was worth.
  const BANKED = 500;
  await mongoose.model('User').updateOne(
    { _id: player.id },
    { $inc: { loyaltyPoints: BANKED, lifetimePoints: BANKED } }
  );

  const res = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: player.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const after = await userOf(player.id);
  const expected = before.loyaltyPoints + BANKED;
  assert.equal(
    after.loyaltyPoints, expected,
    `only this booking's ${earned} points should go; the banked balance is untouched`
  );
  assert.equal(
    after.lifetimePoints, before.lifetimePoints + BANKED,
    'lifetime points must not be over-deducted either'
  );
  assert.equal(res.body.data.refund.amount, totalAmount, 'and the cash refund stays whole');

  // Guard against this passing because nothing was revoked at all.
  assert.ok(earned > 0, 'the booking must have earned points for the clawback to be meaningful');
});

test('the webhook finds its booking through the payment.orderId index', async () => {
  const { groupRef, totalAmount } = await pendingCardBooking();
  const orderId = (await rowsOf(groupRef))[0].payment.orderId;

  const explain = await mongoose.connection.db.collection('bookings')
    .find({ 'payment.orderId': orderId })
    .explain('executionStats');

  assert.match(
    JSON.stringify(explain.queryPlanner.winningPlan), /IXSCAN/,
    'the webhook lookup must not fall back to a collection scan - Razorpay retries '
    + 'anything it does not get a prompt 200 from, so a slow scan buys more scans'
  );
  assert.equal(
    explain.executionStats.totalDocsExamined, SLOT_COUNT,
    'it should examine only the rows of this booking group'
  );

  // And the index must still be there for a settlement to use.
  await deliverCapture({ orderId, amountPaise: totalAmount * 100 });
  assert.ok((await rowsOf(groupRef)).every((r) => r.payment.status === 'paid'));
});
