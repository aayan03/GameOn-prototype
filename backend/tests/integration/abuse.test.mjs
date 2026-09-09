/**
 * Concurrency, money invariants, and the edges of the booking rules.
 *
 * Where security.test.mjs asks "can a stranger get in", this one asks "can a
 * legitimate account, using the API exactly as designed, end up with money or
 * inventory it should not have". Almost every real bug found in this codebase
 * has been of that second kind, and nearly all of them only appear when two
 * requests land at the same moment.
 *
 * `Promise.all` over N identical requests is the shape throughout: the
 * database is the only thing that can arbitrate, so a guard that lives in
 * JavaScript will let all N through and the assertion will say so.
 */
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

const Booking = () => mongoose.model('Booking');
const User = () => mongoose.model('User');

const balanceOf = async (id) => (await User().findById(id).select('walletBalance').lean()).walletBalance;
const pointsOf = async (id) => (await User().findById(id).select('loyaltyPoints').lean()).loyaltyPoints;

async function stage({ balance = 100000, venue: opts } = {}) {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser();
  const venue = await createVenue(owner, opts);
  await fundWallet(player.id, balance);
  const date = dateKey(2);
  const slot = await firstOpenSlot(venue._id, date);
  return { owner, player, venue, date, slot };
}

const book = (v, s, d, token, extra = {}) => post('/api/bookings', {
  venueId: v._id, courtId: s.courtId, date: d, starts: [s.start], ...extra,
}, { token });

/* ── Two people, one slot ────────────────────────────────────── */

test('eight players racing for one slot produce exactly one booking', async () => {
  const { venue, date, slot } = await stage();
  const players = await Promise.all(
    Array.from({ length: 8 }, () => createUser()),
  );
  await Promise.all(players.map((p) => fundWallet(p.id, 50000)));

  const results = await Promise.all(
    players.map((p) => book(venue, slot, date, p.token)),
  );

  const created = results.filter((r) => r.status === 201);
  assert.equal(created.length, 1, `${created.length} bookings for one slot`);
  assert.ok(results.every((r) => r.status === 201 || r.status === 409 || r.status === 400),
    'every loser got a clean refusal');

  const live = await Booking().countDocuments({
    court: slot.courtId, date, startMinutes: slot.start, slotLocked: true,
  });
  assert.equal(live, 1, 'the unique index holds');
});

test('the same player double-submitting books once, not twice', async () => {
  const { venue, player, date, slot } = await stage();

  const results = await Promise.all([
    book(venue, slot, date, player.token),
    book(venue, slot, date, player.token),
  ]);

  assert.equal(results.filter((r) => r.status === 201).length, 1);
  // And they were charged once.
  const spent = 100000 - await balanceOf(player.id);
  const one = results.find((r) => r.status === 201).body.data.booking.totalAmount;
  assert.equal(spent, one, 'charged exactly once');
});

/* ── Money cannot be created ─────────────────────────────────── */

test('a wallet cannot go negative however the requests are interleaved', async () => {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser();
  const venue = await createVenue(owner, {
    courts: [{ name: 'A', sport: 'football', pricePerHour: 1000 }],
  });
  await fundWallet(player.id, 2500);          // enough for two slots, not three
  const date = dateKey(2);

  const grid = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const court = grid.body.data.courts[0];
  const open = court.slots.filter((s) => s.status === 'available').slice(0, 6);

  await Promise.all(open.map((s) => post('/api/bookings', {
    venueId: venue._id, courtId: court.courtId, date, starts: [s.start],
  }, { token: player.token })));

  const after = await balanceOf(player.id);
  assert.ok(after >= 0, `wallet went to ${after}`);

  const paid = await Booking().aggregate([
    { $match: { user: new mongoose.Types.ObjectId(player.id), 'payment.status': 'paid' } },
    { $group: { _id: null, total: { $sum: '$payment.amountPaid' } } },
  ]);
  assert.equal((paid[0]?.total || 0) + after, 2500, 'every rupee is accounted for');
});

test('book then cancel, over and over, mints neither money nor points', async () => {
  const { venue, player, date, slot } = await stage();
  const startBalance = await balanceOf(player.id);

  for (let i = 0; i < 4; i++) {
    const made = await book(venue, slot, date, player.token);
    assert.equal(made.status, 201, `round ${i}`);
    const res = await patch(`/api/bookings/${made.body.data.booking.groupRef}/cancel`,
      {}, { token: player.token });
    assert.equal(res.status, 200, `round ${i}`);
  }

  assert.equal(await balanceOf(player.id), startBalance, 'the loop is not a faucet');
  assert.equal(await pointsOf(player.id), 100, 'only the signup bonus remains');
});

test('a refund can never exceed what was actually taken', async () => {
  const { venue, player, date, slot } = await stage();
  const made = await book(venue, slot, date, player.token);
  const { groupRef, totalAmount } = made.body.data.booking;

  // Pretend a partial capture: less was taken than the booking is worth.
  await Booking().updateMany({ groupRef }, { $set: { 'payment.amountPaid': 100 } });

  const before = await balanceOf(player.id);
  const res = await patch(`/api/bookings/${groupRef}/cancel`, {}, { token: player.token });

  assert.equal(res.status, 200);
  assert.ok(res.body.data.refund.amount <= 100,
    `refunded ${res.body.data.refund.amount} of a ${totalAmount} booking that took 100`);
  assert.equal(await balanceOf(player.id), before + res.body.data.refund.amount);
});

test('concurrent top-ups cannot exceed the daily cap', async () => {
  // The cap lives in the update filter, so the database has to arbitrate.
  process.env.ALLOW_SIMULATED_TOPUP = 'true';
  const player = await createUser();

  const results = await Promise.all(
    Array.from({ length: 10 }, () => post('/api/bookings/wallet/topup',
      { amount: 20000 }, { token: player.token })),
  );

  const ok = results.filter((r) => r.status === 200).length;
  const balance = await balanceOf(player.id);
  assert.equal(balance, ok * 20000, 'balance matches the number that succeeded');
  assert.ok(balance <= 25000, `daily cap breached: ${balance}`);
});

test('concurrent redemptions cannot spend the same points twice', async () => {
  const player = await createUser();
  await User().updateOne({ _id: player.id }, { $set: { loyaltyPoints: 1000 } });

  const results = await Promise.all(
    Array.from({ length: 6 }, () => post('/api/loyalty/redeem',
      { points: 1000 }, { token: player.token })),
  );

  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(await pointsOf(player.id), 0);
  assert.equal(await balanceOf(player.id), 100, '1000 points is ₹100, once');
});

test('concurrent settles record the cash once and award points once', async () => {
  const { owner, venue, player, date, slot } = await stage({
    venue: { acceptsPayAtVenue: true },
  });
  const made = await book(venue, slot, date, player.token, { paymentMethod: 'pay_at_venue' });
  const { groupRef } = made.body.data.booking;

  const results = await Promise.all(
    Array.from({ length: 5 }, () => patch(`/api/bookings/${groupRef}/settle`,
      {}, { token: owner.token })),
  );

  assert.equal(results.filter((r) => r.status === 200).length, 1, 'settled once');

  const rows = await Booking().find({ groupRef }).lean();
  const awarded = rows.reduce((s, b) => s + (b.pointsAwarded || 0), 0);
  assert.equal(await pointsOf(player.id), 100 + awarded, 'points awarded exactly once');
});

test('confirm and reject racing each other resolve to one outcome', async () => {
  const { owner, venue, player, date, slot } = await stage({
    venue: { bookingMode: 'manual' },
  });
  const made = await book(venue, slot, date, player.token);
  const { groupRef } = made.body.data.booking;

  const [a, b] = await Promise.all([
    patch(`/api/bookings/${groupRef}/decision`, { decision: 'confirm' }, { token: owner.token }),
    patch(`/api/bookings/${groupRef}/decision`, { decision: 'reject' }, { token: owner.token }),
  ]);

  assert.equal([a, b].filter((r) => r.status === 200).length, 1, 'one wins, one is told');

  const statuses = new Set((await Booking().find({ groupRef }).lean()).map((r) => r.status));
  assert.equal(statuses.size, 1, `the group is split across ${[...statuses]}`);
});

test('cancel and confirm racing each other do not both move money', async () => {
  const { owner, venue, player, date, slot } = await stage({
    venue: { bookingMode: 'manual' },
  });
  const made = await book(venue, slot, date, player.token);
  const { groupRef, totalAmount } = made.body.data.booking;
  const before = await balanceOf(player.id);

  await Promise.all([
    patch(`/api/bookings/${groupRef}/cancel`, {}, { token: player.token }),
    patch(`/api/bookings/${groupRef}/decision`, { decision: 'confirm' }, { token: owner.token }),
  ]);

  const after = await balanceOf(player.id);
  // Either the confirm won (charged) or the cancel won (untouched, nothing was
  // ever taken for a pending manual booking). Never both.
  assert.ok(after === before || after === before - totalAmount,
    `balance moved to ${after} from ${before} for a ${totalAmount} booking`);
});

test('saving the same venue from two taps stores it once', async () => {
  const { venue, player } = await stage();

  await Promise.all(Array.from({ length: 5 }, () => post(`/api/venues/${venue._id}/favorite`,
    {}, { token: player.token })));

  const fresh = await User().findById(player.id).select('favorites').lean();
  const ids = fresh.favorites.map(String);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate favourites');
  assert.ok(ids.length <= 1);
});

/* ── The rules of a booking ──────────────────────────────────── */

test('a court belonging to another venue cannot be booked', async () => {
  const a = await stage();
  const b = await stage();

  const res = await post('/api/bookings', {
    venueId: a.venue._id, courtId: b.slot.courtId, date: a.date, starts: [a.slot.start],
  }, { token: a.player.token });

  assert.equal(res.status, 404);
});

test('the past, and the far future, are both refused', async () => {
  const { venue, player, slot } = await stage();

  const past = await post('/api/bookings', {
    venueId: venue._id, courtId: slot.courtId, date: dateKey(-3), starts: [slot.start],
  }, { token: player.token });
  assert.equal(past.status, 400);

  const far = await post('/api/bookings', {
    venueId: venue._id, courtId: slot.courtId, date: dateKey(400), starts: [slot.start],
  }, { token: player.token });
  assert.equal(far.status, 400);
});

test('a slot that does not exist on the grid cannot be booked', async () => {
  const { venue, player, date, slot } = await stage();

  for (const start of [slot.start + 7, 1439, 0, 3]) {
    const res = await post('/api/bookings', {
      venueId: venue._id, courtId: slot.courtId, date, starts: [start],
    }, { token: player.token });
    assert.ok(res.status >= 400, `start ${start} produced ${res.status}`);
  }
});

test('the same slot listed twice in one request is refused', async () => {
  const { venue, player, date, slot } = await stage();

  const res = await post('/api/bookings', {
    venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start, slot.start],
  }, { token: player.token });

  assert.equal(res.status, 400);
});

test('a venue awaiting moderation cannot be booked or found', async () => {
  const { venue, player, date, slot } = await stage();
  await mongoose.model('Venue').updateOne({ _id: venue._id },
    { $set: { moderationStatus: 'pending', isActive: false } });

  assert.equal((await book(venue, slot, date, player.token)).status, 404);
  assert.equal((await get(`/api/venues/${venue._id}/availability?date=${date}`)).status, 404);

  const list = await get('/api/venues');
  const ids = (list.body.data || []).map((v) => String(v._id));
  assert.ok(!ids.includes(String(venue._id)), 'an unmoderated venue is listed publicly');
});

test('a blacked-out slot is unbookable even when the grid is asked directly', async () => {
  const { owner, venue, player, date, slot } = await stage();

  const black = await post('/api/owner/blackouts', {
    venueId: venue._id, date, reason: 'Resurfacing',
  }, { token: owner.token });
  assert.ok([200, 201].includes(black.status), JSON.stringify(black.body));

  const res = await book(venue, slot, date, player.token);
  assert.ok(res.status >= 400, `a blacked-out slot booked with ${res.status}`);
});

test('a cancelled slot really does become available again', async () => {
  const { venue, player, date, slot } = await stage();
  const made = await book(venue, slot, date, player.token);
  await patch(`/api/bookings/${made.body.data.booking.groupRef}/cancel`,
    {}, { token: player.token });

  const other = await createUser();
  await fundWallet(other.id, 50000);
  const again = await book(venue, slot, date, other.token);

  assert.equal(again.status, 201, 'the slot never came back');
});

/* ── Promos cannot be stacked or replayed ────────────────────── */

test('a first-booking promo cannot be used after a first booking', async () => {
  const { venue, player, date, slot } = await stage();
  const grid = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const open = grid.body.data.courts[0].slots.filter((s) => s.status === 'available');

  const first = await book(venue, { ...slot, start: open[0].start }, date, player.token,
    { promoCode: 'FIRST20' });
  assert.equal(first.status, 201);

  const second = await post('/api/bookings', {
    venueId: venue._id, courtId: slot.courtId, date,
    starts: [open[1].start], promoCode: 'FIRST20',
  }, { token: player.token });

  assert.equal(second.status, 400);
  assert.match(second.body.error.message, /first booking/i);
});

test('a discount can never make a booking cost less than nothing', async () => {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser();
  // A court cheap enough that a flat ₹50 promo is most of the price.
  const venue = await createVenue(owner, {
    courts: [{ name: 'A', sport: 'football', pricePerHour: 1 }],
  });
  await fundWallet(player.id, 5000);
  const date = dateKey(2);
  const slot = await firstOpenSlot(venue._id, date);

  const quote = await post('/api/bookings/quote', {
    venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start],
    promoCode: 'GAMEON50',
  }, { token: player.token });

  // The minimum-spend rule should refuse it outright; if it ever does not,
  // the total still may not go negative.
  if (quote.status === 200) {
    assert.ok(quote.body.data.total >= 0, `quoted a total of ${quote.body.data.total}`);
    assert.ok(quote.body.data.discount <= quote.body.data.subtotal);
  } else {
    assert.equal(quote.status, 400);
  }
});

/* ── Throttles still bite ────────────────────────────────────── */

test('repeated wrong passwords get slower without locking the owner out', async () => {
  const user = await createUser();

  for (let i = 0; i < 8; i++) {
    const res = await post('/api/auth/login', { email: user.email, password: 'Wrong123456' });
    assert.equal(res.status, 401);
  }

  // The person who knows the password is never shut out.
  const good = await post('/api/auth/login', { email: user.email, password: user.password });
  assert.equal(good.status, 200, 'a throttle must not become a lockout');
});

test('a booking flood from one account is rate limited, not served', async () => {
  const { venue, player, date } = await stage();
  const grid = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const court = grid.body.data.courts[0];

  const results = await Promise.all(
    Array.from({ length: 45 }, (_, i) => post('/api/bookings/quote', {
      venueId: venue._id, courtId: court.courtId, date,
      starts: [court.slots[i % court.slots.length].start],
    }, { token: player.token })),
  );

  assert.ok(results.some((r) => r.status === 429),
    'the write limiter never engaged under a 45-request burst');
});

test('a court-specific blackout blocks only that court', async () => {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser();
  const venue = await createVenue(owner, {
    courts: [
      { name: 'Turf A', sport: 'football', pricePerHour: 1000 },
      { name: 'Turf B', sport: 'football', pricePerHour: 1000 },
    ],
  });
  await fundWallet(player.id, 50000);
  const date = dateKey(2);

  const grid = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const [a, b] = grid.body.data.courts;
  const start = a.slots.find((s) => s.status === 'available').start;

  await post('/api/owner/blackouts', {
    venueId: venue._id, date, courtId: a.courtId, reason: 'Nets down',
  }, { token: owner.token });

  const blocked = await post('/api/bookings', {
    venueId: venue._id, courtId: a.courtId, date, starts: [start],
  }, { token: player.token });
  assert.equal(blocked.status, 400, 'the blacked-out court was bookable');

  const fine = await post('/api/bookings', {
    venueId: venue._id, courtId: b.courtId, date, starts: [start],
  }, { token: player.token });
  assert.equal(fine.status, 201, 'the other court was blocked too');
});

test('a partial-day blackout blocks only the hours it covers', async () => {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser();
  const venue = await createVenue(owner);
  await fundWallet(player.id, 50000);
  const date = dateKey(2);

  const grid = await get(`/api/venues/${venue._id}/availability?date=${date}`);
  const court = grid.body.data.courts[0];
  const open = court.slots.filter((s) => s.status === 'available');
  const inside = open[0];
  const outside = open[open.length - 1];

  await post('/api/owner/blackouts', {
    venueId: venue._id, date, reason: 'Kids camp',
    startMinutes: inside.start, endMinutes: inside.end,
  }, { token: owner.token });

  assert.equal((await post('/api/bookings', {
    venueId: venue._id, courtId: court.courtId, date, starts: [inside.start],
  }, { token: player.token })).status, 400);

  assert.equal((await post('/api/bookings', {
    venueId: venue._id, courtId: court.courtId, date, starts: [outside.start],
  }, { token: player.token })).status, 201, 'hours outside the window are still bookable');
});

test('the quote endpoint refuses a blacked-out slot too', async () => {
  // Quote and create must agree, or the player is shown a price for a slot
  // that will then be refused at the moment they commit to it.
  const { owner, venue, player, date, slot } = await stage();
  await post('/api/owner/blackouts', {
    venueId: venue._id, date, reason: 'Resurfacing',
  }, { token: owner.token });

  const quote = await post('/api/bookings/quote', {
    venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start],
  }, { token: player.token });

  assert.equal(quote.status, 400);
  assert.match(quote.body.error.message, /out of service/i);
});
