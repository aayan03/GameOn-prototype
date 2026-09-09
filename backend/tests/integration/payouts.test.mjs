/**
 * What a payout is allowed to contain.
 *
 * A payout row is an instruction to send an owner real money, so the only
 * figure that may reach it is money the platform is actually holding. The
 * aggregation used to disagree on two counts:
 *
 *   - `earned` fell back to `totalAmount` whenever `amountPaid` was zero, so
 *     an unpaid CONFIRMED booking paid the owner its full quoted price.
 *   - Nothing filtered on payment method, so cash the owner had already
 *     collected at the gate was paid to them a second time by the platform.
 *
 * Both were invisible to the old suite, which only ever checked period
 * boundaries. These tests put three bookings of the same price through one
 * run and assert that exactly one of them is worth anything.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, resetDatabase,
  post, patch, createUser, createVenue, fundWallet, makeAdmin,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

const PRICE = 1000;

/**
 * A booking that has already been played, inside the week the payout run
 * settles.
 *
 * Written straight to the collection: the point of these tests is the shape
 * of a row at payout time, and driving each variant through the booking flow
 * would test the flow rather than the aggregation.
 */
async function playedBooking(venue, user, { method, paymentStatus, amountPaid, startMinutes }) {
  const { Booking } = await import('../../src/models/index.js');
  const { lastWeekBoundary } = await import('../../src/controllers/admin.controller.js');

  // Mid-period, so it cannot land on a boundary and drop out of the window.
  const periodEnd = lastWeekBoundary();
  const endsAt = new Date(periodEnd.getTime() - 3 * 86400000);
  const startsAt = new Date(endsAt.getTime() - 3600000);

  return Booking.create({
    user: user.id,
    venue: venue._id,
    court: venue.courts[0]._id,
    courtName: venue.courts[0].name,
    sport: 'football',
    groupRef: `grp_${Math.random().toString(36).slice(2, 10)}`,
    date: startsAt.toISOString().slice(0, 10),
    startMinutes,
    endMinutes: startMinutes + 60,
    startsAt,
    endsAt,
    mode: 'automated',
    status: 'confirmed',
    slotLocked: true,
    amount: PRICE,
    totalAmount: PRICE,
    payment: {
      method,
      status: paymentStatus,
      amountPaid,
      transactionId: paymentStatus === 'paid' ? 'pay_stub' : '',
    },
  });
}

async function runPayouts(admin) {
  const res = await post('/api/admin/payouts/run', {}, { token: admin.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

async function stage() {
  const admin = await createUser({ role: 'player' });
  await makeAdmin(admin.id);
  const owner = await createUser({ role: 'owner' });
  const player = await createUser({ role: 'player' });
  await fundWallet(player.id, 100000);
  const venue = await createVenue(owner, { acceptsPayAtVenue: true });
  return { admin, owner, player, venue };
}

/* ── The three-booking case ──────────────────────────────────── */

test('a payout counts money we took, and nothing else', async () => {
  const { admin, owner, player, venue } = await stage();

  // 1. Paid from the wallet — the platform is holding this ₹1000.
  await playedBooking(venue, player, {
    method: 'wallet', paymentStatus: 'paid', amountPaid: PRICE, startMinutes: 600,
  });
  // 2. Confirmed but never paid — an abandoned checkout, or a manual venue
  //    that confirmed ahead of payment. Worth nothing.
  await playedBooking(venue, player, {
    method: 'gateway', paymentStatus: 'unpaid', amountPaid: 0, startMinutes: 660,
  });
  // 3. Cash at the gate, settled. The owner already has these notes.
  await playedBooking(venue, player, {
    method: 'pay_at_venue', paymentStatus: 'paid', amountPaid: PRICE, startMinutes: 720,
  });

  const data = await runPayouts(admin);
  assert.equal(data.count, 1, 'one owner');

  const { Payout } = await import('../../src/models/index.js');
  const payout = await Payout.findOne({ owner: owner.id }).lean();

  assert.equal(payout.grossAmount, PRICE, 'only the wallet booking counts');
  assert.equal(payout.bookingCount, 1);
  // Default commission is 10%.
  assert.equal(payout.commissionAmount, 100);
  assert.equal(payout.netAmount, 900);
});

test('an unpaid booking alone produces no payout at all', async () => {
  const { admin, player, venue } = await stage();
  await playedBooking(venue, player, {
    method: 'gateway', paymentStatus: 'unpaid', amountPaid: 0, startMinutes: 600,
  });

  const data = await runPayouts(admin);
  assert.equal(data.count, 0, 'nothing was collected, so nothing is owed');

  const { Payout } = await import('../../src/models/index.js');
  assert.equal(await Payout.countDocuments(), 0);
});

test('gate cash never becomes a platform debt', async () => {
  const { admin, player, venue } = await stage();
  for (const startMinutes of [600, 660, 720]) {
    await playedBooking(venue, player, {
      method: 'pay_at_venue', paymentStatus: 'paid', amountPaid: PRICE, startMinutes,
    });
  }

  const data = await runPayouts(admin);
  assert.equal(data.totalNet, 0);
  assert.equal(data.count, 0, 'the venue kept those notes at the gate');
});

test('a partial payment pays out what was actually taken', async () => {
  // `amountPaid` is the authority, not the quoted price.
  const { admin, owner, player, venue } = await stage();
  await playedBooking(venue, player, {
    method: 'gateway', paymentStatus: 'paid', amountPaid: 400, startMinutes: 600,
  });

  await runPayouts(admin);
  const { Payout } = await import('../../src/models/index.js');
  const payout = await Payout.findOne({ owner: owner.id }).lean();

  assert.equal(payout.grossAmount, 400, 'not the ₹1000 on the booking');
  assert.equal(payout.netAmount, 360);
});

/* ── Still true after the rewrite ────────────────────────────── */

test('rerunning the same week updates rather than duplicates', async () => {
  const { admin, owner, player, venue } = await stage();
  await playedBooking(venue, player, {
    method: 'wallet', paymentStatus: 'paid', amountPaid: PRICE, startMinutes: 600,
  });

  await runPayouts(admin);
  await runPayouts(admin);

  const { Payout } = await import('../../src/models/index.js');
  assert.equal(await Payout.countDocuments({ owner: owner.id }), 1,
    'one row for the period, however many times the job runs');
});

test('a settled period is never rewritten', async () => {
  const { admin, owner, player, venue } = await stage();
  await playedBooking(venue, player, {
    method: 'wallet', paymentStatus: 'paid', amountPaid: PRICE, startMinutes: 600,
  });
  await runPayouts(admin);

  const { Payout } = await import('../../src/models/index.js');
  const payout = await Payout.findOne({ owner: owner.id });
  await patch(`/api/admin/payouts/${payout._id}`, { reference: 'UTR123' }, { token: admin.token });

  // Another booking lands in the same, already-settled week.
  await playedBooking(venue, player, {
    method: 'wallet', paymentStatus: 'paid', amountPaid: PRICE, startMinutes: 660,
  });
  const data = await runPayouts(admin);

  assert.equal(data.skipped, 1);
  const after = await Payout.findById(payout._id).lean();
  assert.equal(after.status, 'paid');
  assert.equal(after.grossAmount, PRICE, 'a paid payout is not reopened');
});

test('only an admin can run payouts', async () => {
  const { owner } = await stage();
  const res = await post('/api/admin/payouts/run', {}, { token: owner.token });
  assert.equal(res.status, 403);
});
