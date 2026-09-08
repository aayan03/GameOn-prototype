/**
 * Swapping demo venues for the real Lucknow listings, on a live database.
 *
 * Two things are being protected here. One is the customer: a demo venue
 * somebody actually booked must not be deleted out from under them. The other
 * is the venue owner whose trading name is about to appear on a site they have
 * never heard of — so the flags that keep those listings honest (unclaimed,
 * unverified, no invented ratings, no instant booking) are asserted, not
 * assumed.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, resetDatabase, post, createUser,
} from '../helpers/harness.mjs';

const SECRET = 'test-cron-secret';

before(() => startTestServer({ env: { CRON_SECRET: SECRET } }));
after(stopTestServer);
beforeEach(resetDatabase);

const auth = { headers: { 'x-cron-secret': SECRET } };

/** Puts the demo venues in place, the way autoSeed would. */
async function seedDemo() {
  const { User, Venue } = await import('../../src/models/index.js');
  const owner = await User.create({
    name: 'Demo Owner', email: 'demo.owner@gameon.app', password: 'Password123', role: 'owner', isVerified: true,
  });
  await Venue.create({
    name: 'Fictional Turf', owner: owner._id, sports: ['football'],
    courts: [{ name: 'A', sport: 'football', pricePerHour: 900, capacity: 10 }],
    address: { line1: '1 Road', area: 'Koramangala', city: 'Bengaluru', pincode: '560034' },
    location: { type: 'Point', coordinates: [77.6, 12.93] },
    openingHours: Array.from({ length: 7 }, (_, day) => ({ day, open: '06:00', close: '22:00', isClosed: false })),
    moderationStatus: 'approved', isActive: true,
  });
  return owner;
}

/* ── Access ───────────────────────────────────────────────────── */

test('the import needs the cron secret', async () => {
  assert.equal((await post('/api/cron/lucknow')).status, 401);
  assert.equal(
    (await post('/api/cron/lucknow', undefined, { headers: { 'x-cron-secret': 'wrong' } })).status,
    401
  );
});

/* ── Dry run is the default ──────────────────────────────────── */

test('without ?apply it changes nothing', async () => {
  await seedDemo();
  const { Venue } = await import('../../src/models/index.js');

  const res = await post('/api/cron/lucknow', undefined, auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.applied, false);
  assert.match(res.body.data.message, /Dry run/);

  // Reported what it would do…
  assert.equal(res.body.data.purged.demoVenues, 1);
  assert.equal(res.body.data.imported.considered, 10);
  assert.equal(res.body.data.imported.names.length, 10);

  // …and did none of it.
  assert.equal(await Venue.countDocuments({}), 1);
  assert.equal((await Venue.findOne({}).lean()).name, 'Fictional Turf');
});

/* ── Applying ─────────────────────────────────────────────────── */

test('?apply=true removes the demo venues and lists ten real ones', async () => {
  await seedDemo();
  const { Venue, User } = await import('../../src/models/index.js');

  const res = await post('/api/cron/lucknow?apply=true', undefined, auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.applied, true);
  assert.equal(res.body.data.imported.created, 10);

  assert.equal(await Venue.countDocuments({ name: 'Fictional Turf' }), 0, 'demo turf gone');
  assert.equal(await Venue.countDocuments({ 'address.city': 'Lucknow' }), 10);
  assert.equal(await User.countDocuments({ email: 'demo.owner@gameon.app' }), 0, 'demo account gone');
});

test('the Lucknow ops account survives the purge that shares its domain', async () => {
  // lucknow.ops@gameon.app matches the demo email pattern. Sweeping by domain
  // alone deletes the listings this import just created.
  await seedDemo();
  await post('/api/cron/lucknow?apply=true', undefined, auth);

  const { User } = await import('../../src/models/index.js');
  assert.ok(await User.findOne({ email: 'lucknow.ops@gameon.app' }), 'ops account kept');
});

test('limit picks how many go up', async () => {
  const res = await post('/api/cron/lucknow?apply=true&limit=3', undefined, auth);
  assert.equal(res.body.data.imported.created, 3);

  const { Venue } = await import('../../src/models/index.js');
  assert.equal(await Venue.countDocuments({ 'address.city': 'Lucknow' }), 3);
});

test('running it twice does not duplicate anything', async () => {
  await post('/api/cron/lucknow?apply=true', undefined, auth);
  const second = await post('/api/cron/lucknow?apply=true', undefined, auth);

  assert.equal(second.body.data.imported.created, 0);
  assert.equal(second.body.data.imported.updated, 10, 'refreshed in place');

  const { Venue } = await import('../../src/models/index.js');
  assert.equal(await Venue.countDocuments({ 'address.city': 'Lucknow' }), 10);
});

/* ── What the listings must look like ────────────────────────── */

test('every imported listing is unclaimed, unverified and unrated', async () => {
  await post('/api/cron/lucknow?apply=true', undefined, auth);
  const { Venue } = await import('../../src/models/index.js');

  for (const v of await Venue.find({ 'address.city': 'Lucknow' }).lean()) {
    assert.equal(v.isClaimed, false, `${v.name} must show the unclaimed notice`);
    assert.equal(v.isVerified, false, `${v.name} must not carry a verified badge`);
    // Inventing an endorsement a business never gave is worse than estimating
    // a price, so these carry no score at all.
    assert.equal(v.rating, 0, `${v.name} must have no invented rating`);
    assert.equal(v.reviewCount, 0);
  }
});

test('none of them can take money before a human confirms', async () => {
  // Assisted booking charges nothing until somebody accepts. A request against
  // a venue that has never heard of us expires unanswered and costs the player
  // nothing — instant booking would charge a card for a slot nobody can honour.
  await post('/api/cron/lucknow?apply=true', undefined, auth);
  const { Venue } = await import('../../src/models/index.js');

  const modes = await Venue.find({ 'address.city': 'Lucknow' }).distinct('bookingMode');
  assert.deepEqual(modes, ['manual']);
});

test('no reviews are invented for them', async () => {
  await post('/api/cron/lucknow?apply=true', undefined, auth);
  const { Review } = await import('../../src/models/index.js');
  assert.equal(await Review.countDocuments({}), 0);
});

/* ── Protecting real customers ───────────────────────────────── */

test('refuses to delete a demo venue a real person has booked', async () => {
  const owner = await seedDemo();
  const { Venue, Booking } = await import('../../src/models/index.js');
  const venue = await Venue.findOne({ owner: owner._id });
  const player = await createUser({ email: 'realplayer@test.local' });

  const starts = new Date(Date.now() + 2 * 864e5);
  await Booking.create({
    user: player.id, venue: venue._id, court: venue.courts[0]._id,
    sport: 'football', mode: 'automated',
    date: starts.toISOString().slice(0, 10),
    startMinutes: 600, endMinutes: 660,
    startsAt: starts, endsAt: new Date(starts.getTime() + 36e5),
    amount: 900, totalAmount: 927, status: 'confirmed', slotLocked: true,
  });

  const res = await post('/api/cron/lucknow?apply=true', undefined, auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.applied, false);
  assert.match(res.body.data.purged.refused, /real booking/i);

  assert.ok(await Venue.findById(venue._id), 'the booked venue is still there');
  assert.equal(await Booking.countDocuments({ user: player.id }), 1);
});

test('purge=false imports without touching the demo data', async () => {
  await seedDemo();
  const res = await post('/api/cron/lucknow?apply=true&purge=false&limit=2', undefined, auth);

  assert.equal(res.body.data.purged.skipped, true);
  const { Venue } = await import('../../src/models/index.js');
  assert.equal(await Venue.countDocuments({ name: 'Fictional Turf' }), 1, 'demo left alone');
  assert.equal(await Venue.countDocuments({ 'address.city': 'Lucknow' }), 2);
});

test('a listing a venue has already claimed is never overwritten', async () => {
  await post('/api/cron/lucknow?apply=true&limit=1', undefined, auth);
  const { Venue } = await import('../../src/models/index.js');

  // The venue got in touch and took ownership.
  const v = await Venue.findOne({ 'address.city': 'Lucknow' });
  v.isClaimed = true;
  await v.save();
  const realPrice = 1750;
  v.courts[0].pricePerHour = realPrice;
  await v.save();

  const res = await post('/api/cron/lucknow?apply=true&limit=1', undefined, auth);
  assert.deepEqual(res.body.data.imported.skippedClaimed, [v.name]);

  const after = await Venue.findById(v._id).lean();
  assert.equal(after.isClaimed, true, 'still theirs');
  assert.equal(after.courts[0].pricePerHour, realPrice, 'their price was not reset to our guess');
});
