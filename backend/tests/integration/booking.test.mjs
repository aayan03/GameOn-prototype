import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase,
  get, post, patch, createUser, createVenue, fundWallet,
  dateKey, firstOpenSlot,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

/** A player with money, an owner, and an instant-book venue. */
async function scenario({ balance = 50000, venue: venueOpts } = {}) {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser({ role: 'player' });
  const venue = await createVenue(owner, venueOpts);
  await fundWallet(player.id, balance);
  const date = dateKey(2);
  const slot = await firstOpenSlot(venue._id, date);
  return { owner, player, venue, date, slot };
}

const bookBody = (venue, slot, date, extra = {}) => ({
  venueId: venue._id,
  courtId: slot.courtId,
  date,
  starts: [slot.start],
  paymentMethod: 'wallet',
  ...extra,
});

/* ── Availability ────────────────────────────────────────────── */

test('availability is public and marks past slots', async () => {
  const { venue } = await scenario();
  const res = await get(`/api/venues/${venue._id}/availability?date=${dateKey(0)}`);
  assert.equal(res.status, 200, 'no token required');
  const slots = res.body.data.courts[0].slots;
  assert.ok(slots.length > 0);
  assert.ok(slots.every((s) => ['available', 'past', 'booked', 'held', 'blocked'].includes(s.status)));
});

test('a booked slot is no longer offered as available', async () => {
  const { player, venue, date, slot } = await scenario();
  await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });

  const after = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const same = after.body.data.courts[0].slots.find((s) => s.start === slot.start);
  assert.equal(same.status, 'booked');
});

/* ── Quote & pricing ─────────────────────────────────────────── */

test('quote prices a slot and does not leak internal promo state', async () => {
  const { player, venue, date, slot } = await scenario();
  const res = await post('/api/bookings/quote', {
    venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start],
  }, { token: player.token });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.subtotal, slot.price);
  assert.ok(res.body.data.total >= slot.price, 'platform fee is added on top');
  assert.equal(res.body.data.promoDoc, undefined, 'internal Promo document is not exposed');
  assert.equal(res.body.data.promoOwner, undefined);
});

test('quoting requires a session', async () => {
  const { venue, date, slot } = await scenario();
  const res = await post('/api/bookings/quote', {
    venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start],
  });
  assert.equal(res.status, 401);
});

test('a date in the past is refused', async () => {
  const { player, venue, slot } = await scenario();
  const res = await post('/api/bookings/quote', {
    venueId: venue._id, courtId: slot.courtId, date: dateKey(-3), starts: [slot.start],
  }, { token: player.token });
  assert.equal(res.status, 400);
});

test('a date beyond the venue window is refused', async () => {
  const { player, venue, slot } = await scenario();
  const res = await post('/api/bookings/quote', {
    venueId: venue._id, courtId: slot.courtId, date: dateKey(90), starts: [slot.start],
  }, { token: player.token });
  assert.equal(res.status, 400);
});

test('the same slot cannot be selected twice in one booking', async () => {
  const { player, venue, date, slot } = await scenario();
  const res = await post('/api/bookings/quote', {
    venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start, slot.start],
  }, { token: player.token });
  assert.equal(res.status, 400);
});

/* ── Creating a booking ──────────────────────────────────────── */

test('an instant venue confirms and debits the wallet', async () => {
  const { player, venue, date, slot } = await scenario({ balance: 5000 });

  const res = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.booking.status, 'confirmed');
  assert.equal(res.body.data.booking.payment.status, 'paid');

  const charged = res.body.data.booking.totalAmount;
  assert.equal(res.body.data.walletBalance, 5000 - charged, 'wallet debited by exactly the total');

  const wallet = await get('/api/bookings/wallet', { token: player.token });
  assert.equal(wallet.body.data.balance, 5000 - charged);
});

test('booking with an empty wallet fails and releases the slot', async () => {
  const { player, venue, date, slot } = await scenario({ balance: 0 });

  const res = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /balance/i);

  // The critical part: a failed payment must not leave the slot held.
  const after = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const same = after.body.data.courts[0].slots.find((s) => s.start === slot.start);
  assert.equal(same.status, 'available', 'slot was released after the failed payment');
});

test('two players cannot book the same slot', async () => {
  const { venue, date, slot } = await scenario();
  const a = await createUser({ role: 'player' });
  const b = await createUser({ role: 'player' });
  await fundWallet(a.id, 50000);
  await fundWallet(b.id, 50000);

  const first = await post('/api/bookings', bookBody(venue, slot, date), { token: a.token });
  assert.equal(first.status, 201);

  const second = await post('/api/bookings', bookBody(venue, slot, date), { token: b.token });
  assert.equal(second.status, 409, 'the unique index rejects the second booking');
});

test('concurrent bookings of one slot: exactly one wins', async () => {
  const { venue, date, slot } = await scenario();

  const players = await Promise.all([1, 2, 3, 4, 5].map(() => createUser({ role: 'player' })));
  await Promise.all(players.map((p) => fundWallet(p.id, 50000)));

  // Fired together, so they genuinely race inside the database.
  const results = await Promise.all(
    players.map((p) => post('/api/bookings', bookBody(venue, slot, date), { token: p.token })),
  );

  const won = results.filter((r) => r.status === 201);
  const lost = results.filter((r) => r.status === 409);

  assert.equal(won.length, 1, `exactly one booking should succeed, got ${won.length}`);
  assert.equal(lost.length, 4, 'the rest are rejected as conflicts');

  const rows = await mongoose.model('Booking').countDocuments({ slotLocked: true });
  assert.equal(rows, 1, 'only one live booking row exists for the slot');
});

test('a booking cannot be made against another venue\'s court', async () => {
  const { player, venue, date } = await scenario();
  const otherOwner = await createUser({ role: 'owner' });
  const otherVenue = await createVenue(otherOwner);
  const otherSlot = await firstOpenSlot(otherVenue._id, date);

  const res = await post('/api/bookings', {
    venueId: venue._id, courtId: otherSlot.courtId, date,
    starts: [otherSlot.start], paymentMethod: 'wallet',
  }, { token: player.token });

  assert.equal(res.status, 404, 'the court does not belong to that venue');
});

test('the client cannot dictate the price', async () => {
  const { player, venue, date, slot } = await scenario({ balance: 100000 });
  const res = await post('/api/bookings',
    bookBody(venue, slot, date, { totalAmount: 1, amount: 1, platformFee: 0 }),
    { token: player.token });

  // Unknown keys are not in createBookingSchema; whatever the outcome, the
  // stored total must be the server's figure.
  if (res.status === 201) {
    assert.equal(res.body.data.booking.amount, slot.price, 'server-side price wins');
    assert.ok(res.body.data.booking.totalAmount > 1);
  } else {
    assert.equal(res.status, 400);
  }
});

/* ── Manual venues ───────────────────────────────────────────── */

test('a manual venue creates a pending request and charges nothing', async () => {
  const { player, venue, date, slot } = await scenario({
    balance: 5000,
    venue: { bookingMode: 'manual', manualContact: { phone: '9876543210', responseTimeMins: 20 } },
  });

  const res = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.booking.status, 'pending');
  assert.equal(res.body.data.booking.payment.status, 'unpaid');

  const wallet = await get('/api/bookings/wallet', { token: player.token });
  assert.equal(wallet.body.data.balance, 5000, 'nothing charged before confirmation');
});

test('the owner confirming a manual booking is when payment is taken', async () => {
  const { owner, player, venue, date, slot } = await scenario({
    balance: 5000,
    venue: { bookingMode: 'manual', manualContact: { phone: '9876543210' } },
  });

  const created = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  const { groupRef } = created.body.data.booking;

  const decided = await patch(`/api/bookings/${groupRef}/decision`, { decision: 'confirm' }, { token: owner.token });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.data.status, 'confirmed');

  const wallet = await get('/api/bookings/wallet', { token: player.token });
  assert.ok(wallet.body.data.balance < 5000, 'charged on confirmation');
});

test('an unrelated owner cannot decide someone else\'s booking', async () => {
  const { player, venue, date, slot } = await scenario({
    venue: { bookingMode: 'manual', manualContact: { phone: '9876543210' } },
  });
  const intruder = await createUser({ role: 'owner' });

  const created = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  const { groupRef } = created.body.data.booking;

  const res = await patch(`/api/bookings/${groupRef}/decision`, { decision: 'confirm' }, { token: intruder.token });
  assert.equal(res.status, 403);
});

test('rejecting a request releases the slot', async () => {
  const { owner, player, venue, date, slot } = await scenario({
    venue: { bookingMode: 'manual', manualContact: { phone: '9876543210' } },
  });

  const created = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  await patch(`/api/bookings/${created.body.data.booking.groupRef}/decision`,
    { decision: 'reject' }, { token: owner.token });

  const after = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const same = after.body.data.courts[0].slots.find((s) => s.start === slot.start);
  assert.equal(same.status, 'available');
});

/* ── Ownership & visibility ──────────────────────────────────── */

test('a booking is not readable by another player', async () => {
  const { player, venue, date, slot } = await scenario();
  const stranger = await createUser({ role: 'player' });

  const created = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  const { groupRef } = created.body.data.booking;

  const res = await get(`/api/bookings/${groupRef}`, { token: stranger.token });
  assert.equal(res.status, 403);
});

test('my bookings only ever returns my own', async () => {
  const { player, venue, date, slot } = await scenario();
  const other = await createUser({ role: 'player' });

  await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });

  const mine = await get('/api/bookings', { token: other.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.upcoming.length, 0);
  assert.equal(mine.body.data.past.length, 0);
});

/* ── Cancellation & refunds ──────────────────────────────────── */

test('cancelling well ahead of time gives a full refund', async () => {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser({ role: 'player' });
  const venue = await createVenue(owner, {
    cancellationPolicy: { freeCancellationHours: 24, partialRefundHours: 6, partialRefundPercent: 50 },
  });
  await fundWallet(player.id, 10000);

  const date = dateKey(5);            // comfortably outside the free window
  const slot = await firstOpenSlot(venue._id, date);
  const created = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  const charged = created.body.data.booking.totalAmount;
  const { groupRef } = created.body.data.booking;

  const cancelled = await patch(`/api/bookings/${groupRef}/cancel`, { reason: 'Weather' }, { token: player.token });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.refund.amount, charged, 'full refund');
  assert.equal(cancelled.body.data.walletBalance, 10000, 'balance restored exactly');
});

test('a cancelled slot becomes bookable again', async () => {
  const { player, venue, date, slot } = await scenario();
  const created = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  await patch(`/api/bookings/${created.body.data.booking.groupRef}/cancel`, {}, { token: player.token });

  const after = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const same = after.body.data.courts[0].slots.find((s) => s.start === slot.start);
  assert.equal(same.status, 'available');
});

test('cancelling twice does not refund twice', async () => {
  const { player, venue, date, slot } = await scenario({ balance: 10000 });
  const created = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  const { groupRef } = created.body.data.booking;

  const first = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: player.token });
  assert.equal(first.status, 200);

  const second = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: player.token });
  assert.equal(second.status, 400, 'already cancelled');

  const wallet = await get('/api/bookings/wallet', { token: player.token });
  assert.equal(wallet.body.data.balance, 10000, 'refunded once, not twice');
});

test('concurrent cancellations refund exactly once', async () => {
  const { player, venue, date, slot } = await scenario({ balance: 10000 });
  const created = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  const { groupRef } = created.body.data.booking;

  const results = await Promise.all([1, 2, 3].map(
    () => patch(`/api/bookings/${groupRef}/cancel`, {}, { token: player.token }),
  ));

  assert.equal(results.filter((r) => r.status === 200).length, 1, 'one cancellation wins');

  const wallet = await get('/api/bookings/wallet', { token: player.token });
  assert.equal(wallet.body.data.balance, 10000, 'the money came back exactly once');
});

test('a stranger cannot cancel someone else\'s booking', async () => {
  const { player, venue, date, slot } = await scenario();
  const stranger = await createUser({ role: 'player' });

  const created = await post('/api/bookings', bookBody(venue, slot, date), { token: player.token });
  const res = await patch(`/api/bookings/${created.body.data.booking.groupRef}/cancel`,
    {}, { token: stranger.token });

  assert.equal(res.status, 403);
});

/* ── Wallet ──────────────────────────────────────────────────── */

test('the wallet cannot be overdrawn by concurrent bookings', async () => {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser({ role: 'player' });
  const venue = await createVenue(owner, {
    courts: [
      { name: 'A', sport: 'football', pricePerHour: 1000 },
      { name: 'B', sport: 'football', pricePerHour: 1000 },
      { name: 'C', sport: 'football', pricePerHour: 1000 },
    ],
  });

  // Enough for roughly one booking, not three.
  await fundWallet(player.id, 1100);

  const date = dateKey(3);
  const avail = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const courts = avail.body.data.courts;
  const start = courts[0].slots.find((s) => s.status === 'available').start;

  const results = await Promise.all(courts.map((c) => post('/api/bookings', {
    venueId: venue._id, courtId: c.courtId, date, starts: [start], paymentMethod: 'wallet',
  }, { token: player.token })));

  const paid = results.filter((r) => r.status === 201);
  assert.equal(paid.length, 1, `only one booking is affordable, got ${paid.length}`);

  const wallet = await get('/api/bookings/wallet', { token: player.token });
  assert.ok(wallet.body.data.balance >= 0, 'balance never goes negative');
});

test('simulated top-up is blocked when the server is in production mode', async () => {
  // The endpoint mints balance from nothing, so production must refuse it
  // unless deliberately enabled.
  //
  // config/env.js snapshots process.env at import time — by design, so a
  // stray runtime mutation cannot flip the server into a different mode
  // halfway through serving a request. That means this test has to mutate the
  // resolved config object, which is what isProd() actually reads.
  const { default: env } = await import('../../src/config/env.js');
  const player = await createUser({ role: 'player' });

  const original = env.NODE_ENV;
  try {
    env.NODE_ENV = 'production';
    const res = await post('/api/bookings/wallet/topup', { amount: 1000 }, { token: player.token });
    assert.equal(res.status, 501, 'the money printer is off in production');

    // ...and stays off for every amount, not just this one.
    const small = await post('/api/bookings/wallet/topup', { amount: 100 }, { token: player.token });
    assert.equal(small.status, 501);
  } finally {
    env.NODE_ENV = original;
  }

  // Outside production it still works, so the demo flow is intact.
  const allowed = await post('/api/bookings/wallet/topup', { amount: 1000 }, { token: player.token });
  assert.equal(allowed.status, 200);
});

test('top-up rejects a negative or absurd amount', async () => {
  const player = await createUser({ role: 'player' });
  assert.equal((await post('/api/bookings/wallet/topup', { amount: -500 }, { token: player.token })).status, 400);
  assert.equal((await post('/api/bookings/wallet/topup', { amount: 10_000_000 }, { token: player.token })).status, 400);
});

/* ── Promos ──────────────────────────────────────────────────── */

test('an owner promo enforces its per-user limit', async () => {
  const { owner, player, venue, date } = await scenario({ balance: 100000 });

  const created = await post('/api/owner/promos', {
    code: 'ONCEONLY', type: 'flat', value: 50, minAmount: 0, maxUsesPerUser: 1,
  }, { token: owner.token });
  assert.equal(created.status, 201);

  const avail = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const open = avail.body.data.courts[0].slots.filter((s) => s.status === 'available');

  const one = await post('/api/bookings', {
    venueId: venue._id, courtId: avail.body.data.courts[0].courtId, date,
    starts: [open[0].start], promoCode: 'ONCEONLY', paymentMethod: 'wallet',
  }, { token: player.token });
  assert.equal(one.status, 201);

  const two = await post('/api/bookings', {
    venueId: venue._id, courtId: avail.body.data.courts[0].courtId, date,
    starts: [open[1].start], promoCode: 'ONCEONLY', paymentMethod: 'wallet',
  }, { token: player.token });
  assert.equal(two.status, 400, 'the per-user cap is enforced');

  const promos = await get('/api/owner/promos', { token: owner.token });
  assert.equal(promos.body.data.find((p) => p.code === 'ONCEONLY').usedCount, 1);
});

test('an unknown promo code is rejected', async () => {
  const { player, venue, date, slot } = await scenario();
  const res = await post('/api/bookings/quote', {
    venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start], promoCode: 'NOTREAL',
  }, { token: player.token });
  assert.equal(res.status, 400);
});

/* ── Gateway (card / UPI) ────────────────────────────────────── */

test('a gateway booking holds the slot without touching the wallet', async () => {
  const { player, venue, date, slot } = await scenario({ balance: 5000 });

  const res = await post('/api/bookings',
    bookBody(venue, slot, date, { paymentMethod: 'gateway' }),
    { token: player.token });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.booking.payment.status, 'unpaid',
    'Razorpay has not collected anything yet');

  // Charging here as well as at the gateway would take the money twice.
  const wallet = await get('/api/bookings/wallet', { token: player.token });
  assert.equal(wallet.body.data.balance, 5000, 'wallet untouched');

  // The slot is still held, so nobody can take it while checkout is open.
  const after = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const same = after.body.data.courts[0].slots.find((s) => s.start === slot.start);
  assert.ok(['booked', 'held'].includes(same.status), `slot should be held, was ${same.status}`);
});

test('gateway endpoints are closed when no real gateway is configured', async () => {
  const { player, venue, date, slot } = await scenario();
  const created = await post('/api/bookings',
    bookBody(venue, slot, date, { paymentMethod: 'gateway' }),
    { token: player.token });

  // Without keys there is no secret to verify a signature against, so the
  // server must refuse rather than accept anything the client claims.
  const order = await post('/api/payments/order',
    { groupRef: created.body.data.booking.groupRef }, { token: player.token });
  assert.equal(order.status, 501);

  const verify = await post('/api/payments/verify', {
    groupRef: created.body.data.booking.groupRef,
    orderId: 'order_fake', paymentId: 'pay_fake', signature: 'x'.repeat(64),
  }, { token: player.token });
  assert.equal(verify.status, 501, 'a forged signature must never be accepted');
});

test('an unknown payment method is rejected', async () => {
  const { player, venue, date, slot } = await scenario();
  const res = await post('/api/bookings',
    bookBody(venue, slot, date, { paymentMethod: 'free_please' }),
    { token: player.token });
  assert.equal(res.status, 400);
});

test('the fake UPI and card methods can no longer be used', async () => {
  const { player, venue, date, slot } = await scenario({ balance: 50000 });

  // These presented as UPI and card payments and silently debited the wallet.
  // A booking must not be creatable through a method that names one thing and
  // does another.
  for (const paymentMethod of ['mock_upi', 'mock_card']) {
    const res = await post('/api/bookings',
      bookBody(venue, slot, date, { paymentMethod }),
      { token: player.token });
    assert.equal(res.status, 400, `${paymentMethod} should be rejected`);
  }

  // The three honest ones still work.
  const ok = await post('/api/bookings',
    bookBody(venue, slot, date, { paymentMethod: 'wallet' }),
    { token: player.token });
  assert.equal(ok.status, 201);
});
