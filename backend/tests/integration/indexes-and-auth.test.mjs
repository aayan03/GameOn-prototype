/**
 * The index set on `bookings`, and what auth loads on every request.
 *
 * Both are the sort of thing that degrades silently. An index nobody queries
 * costs a write on every booking insert and shows up nowhere; a field-level
 * `index: true` added next to an existing compound index looks harmless in
 * review. So the intended set is written down here and compared, rather than
 * left to be rediscovered by explaining a slow query in six months.
 *
 * The auth half guards the opposite risk: `protect` no longer loads the whole
 * user document, and the two arrays it drops must stay droppable — nothing may
 * start reading them off `req.user`, and saving a projected document must not
 * wipe them.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase,
  get, patch, post, createUser, createVenue, fundWallet,
  dateKey, firstOpenSlot,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

/* ── The index set ────────────────────────────────────────────── */

/**
 * Every index `bookings` is meant to carry.
 *
 * `user`, `venue`, `date`, `startsAt`, `status` and `promoCode` are absent on
 * purpose: each was a standalone index that duplicated the prefix of a
 * compound one below it. Measured against 20,000 rows over every query shape
 * in the codebase, dropping all six introduced no collection scan and changed
 * no query's documents-examined count.
 */
const EXPECTED = [
  '_id_',
  'bookingRef_1',                     // unique, from `unique: true` alone
  'court_1_date_1_startMinutes_1',    // the double-booking guard
  'groupRef_1',
  'lifecycleRun_1',
  'payment.orderId_1',                // the Razorpay webhook's lookup
  'payment.transactionId_1',          // /payments/verify's replay guard
  'status_1_endsAt_1',
  'status_1_startsAt_1_createdAt_1',
  'user_1_startsAt_-1',
  'venue_1_date_1_status_1',
  'venue_1_startsAt_1_status_1',
];

test('bookings carries exactly the indexes it is meant to', async () => {
  const names = (await mongoose.model('Booking').collection.indexes())
    .map((i) => i.name).sort();

  const extra = names.filter((n) => !EXPECTED.includes(n));
  const missing = EXPECTED.filter((n) => !names.includes(n));

  assert.deepEqual(
    extra, [],
    'an index nobody asked for is a write cost on every booking insert - if this is '
    + 'deliberate, measure it with explain() and add it to EXPECTED above'
  );
  assert.deepEqual(missing, [], 'an index the query paths depend on has gone');
});

test('a duplicate index declaration is not reintroduced', async () => {
  // `unique: true` builds the index by itself. Adding `index: true` beside it
  // declares the same index twice, which Mongoose warns about at boot.
  for (const model of ['Booking', 'Venue', 'Event', 'Playground', 'Team', 'RevokedToken']) {
    const paths = mongoose.model(model).schema.paths;
    for (const [name, path] of Object.entries(paths)) {
      const opts = path.options || {};
      assert.ok(
        !(opts.unique && opts.index),
        `${model}.${name} declares both unique and index - drop the \`index: true\``
      );
    }
  }
});

test('the payment replay guard does not scan the collection', async () => {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser();
  const venue = await createVenue(owner);
  await fundWallet(player.id, 20000);
  const date = dateKey(2);
  const slot = await firstOpenSlot(venue._id, date);

  const made = await post('/api/bookings', {
    venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start],
  }, { token: player.token });
  assert.equal(made.status, 201, JSON.stringify(made.body));

  await mongoose.model('Booking').updateMany(
    { groupRef: made.body.data.booking.groupRef },
    { $set: { 'payment.transactionId': 'pay_indexed_lookup' } }
  );

  /**
   * `/payments/verify` runs this twice per call, to refuse a captured payment
   * being replayed against a second booking. Without an index the planner fell
   * back to `groupRef_1`, where `{ $ne }` selects nearly everything — measured
   * at 19,998 of 20,000 rows examined, while a customer waits at checkout.
   */
  const explain = await mongoose.connection.db.collection('bookings')
    .find({ 'payment.transactionId': 'pay_indexed_lookup', groupRef: { $ne: 'GRPother' } })
    .explain('executionStats');

  assert.match(
    JSON.stringify(explain.queryPlanner.winningPlan), /IXSCAN/,
    'the replay guard must not fall back to a scan'
  );
  assert.match(
    JSON.stringify(explain.queryPlanner.winningPlan), /payment\.transactionId/,
    'and it must be the transactionId index doing the work, not groupRef'
  );
});

/* ── What auth loads ──────────────────────────────────────────── */

test('the signed-in user still carries everything the client renders', async () => {
  const player = await createUser();
  const owner = await createUser({ role: 'owner' });
  const venue = await createVenue(owner);

  // Save a venue, which is what `favorites` exists for.
  const fav = await post(`/api/venues/${venue._id}/favorite`, {}, { token: player.token });
  assert.equal(fav.status, 200, JSON.stringify(fav.body));

  const me = await get('/api/auth/me', { token: player.token });
  assert.equal(me.status, 200);
  const user = me.body.data.user;

  // `favorites` is read off req.user by four routes and drawn by the client,
  // so it must survive the projection.
  assert.ok(Array.isArray(user.favorites), 'favorites must reach the client');
  assert.equal(user.favorites.length, 1);
  assert.equal(typeof user.walletBalance, 'number');
  assert.equal(typeof user.loyaltyTier, 'string');

  // Never sent to a browser, projection or not.
  for (const field of ['password', 'pushTokens', 'resetTokenHash', 'failedLogins']) {
    assert.equal(user[field], undefined, `${field} must never reach a client`);
  }
});

test('editing a profile does not wipe the arrays auth no longer loads', async () => {
  const player = await createUser();
  const { User } = await import('../../src/models/index.js');
  const venueId = new mongoose.Types.ObjectId();

  // Two things `protect` deliberately stops loading. A `save()` on a document
  // with unselected paths must leave them alone, or a profile edit silently
  // unregisters every device the account has.
  await User.updateOne({ _id: player.id }, {
    $set: {
      pushTokens: [{ token: 'a'.repeat(900), platform: 'web' }],
      reviewBonusVenues: [venueId],
    },
  });

  const res = await patch('/api/auth/me', { name: 'Renamed Player', city: 'Bengaluru' }, { token: player.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.user.name, 'Renamed Player');

  const after = await User.findById(player.id).lean();
  assert.equal(after.name, 'Renamed Player', 'the edit itself must apply');
  assert.equal(after.pushTokens.length, 1, 'a profile edit must not unregister the device');
  assert.equal(after.reviewBonusVenues.length, 1, 'nor drop the review-bonus claims');
});

test('a device can still register for push after the projection', async () => {
  const player = await createUser();
  const { User } = await import('../../src/models/index.js');

  const sub = JSON.stringify({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'k'.repeat(80), auth: 'a'.repeat(20) } });
  const res = await post('/api/notifications/push-token', { token: sub, platform: 'web' }, { token: player.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const after = await User.findById(player.id).lean();
  assert.equal(
    after.pushTokens.length, 1,
    'registerPushToken writes through the database rather than through req.user, '
    + 'which is why the field can be left out of the auth query'
  );
});
