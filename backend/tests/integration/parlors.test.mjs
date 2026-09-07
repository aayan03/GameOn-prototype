/**
 * Game parlours — snooker halls, arcades, bowling alleys.
 *
 * A LOCATOR. Nothing here is bookable, which is the point: the assertions
 * below are about finding a place, knowing whether it is open, and getting a
 * phone number. If a booking endpoint ever appears on this model, it should
 * be because somebody decided to add one, not because it arrived by
 * inheritance from Venue.
 *
 * "Open now" is the part with real logic in it — a parlour that closes at 2am
 * is open at 1am on the following calendar day, on the VENUE's clock rather
 * than the server's.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase,
  get, post, patch, del, createUser, setVerified,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

const allWeek = (open, close) =>
  Array.from({ length: 7 }, (_, day) => ({ day, open, close, isClosed: false }));

async function lister({ verified = true } = {}) {
  const user = await createUser({ role: 'owner' });
  if (verified) await setVerified(user.id, true);
  return user;
}

async function createParlor(user, overrides = {}) {
  const res = await post('/api/parlors', {
    name: overrides.name || 'Blue Moon Snooker',
    games: overrides.games || ['snooker', 'pool'],
    lat: overrides.lat ?? 12.9716,
    lng: overrides.lng ?? 77.5946,
    address: { area: 'Indiranagar', city: 'Bengaluru', ...overrides.address },
    contact: { phone: '9810011001', ...overrides.contact },
    ...(overrides.openingHours ? { openingHours: overrides.openingHours } : {}),
    ...(overrides.rest || {}),
  }, { token: user.token });
  if (res.status !== 201) throw new Error(`createParlor failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.parlor;
}

/* ── It is a locator, and it is public ───────────────────────── */

test('anyone can find a parlor without an account', async () => {
  const owner = await lister();
  await createParlor(owner);

  const res = await get('/api/parlors');
  assert.equal(res.status, 200, 'no token required');
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].name, 'Blue Moon Snooker');
  // The whole call to action, since nothing is bookable.
  assert.equal(res.body.data[0].contact.phone, '9810011001');
});

test('there is no way to book one', async () => {
  const owner = await lister();
  const parlor = await createParlor(owner);
  const player = await createUser({ role: 'player' });

  // Deliberately absent. A parlour is a directory entry, not inventory —
  // no slot grid, no capacity, no payment, no refund.
  for (const path of [
    `/api/parlors/${parlor._id}/book`,
    `/api/parlors/${parlor._id}/register`,
    `/api/parlors/${parlor._id}/availability`,
  ]) {
    const res = await post(path, {}, { token: player.token });
    assert.equal(res.status, 404, `${path} should not exist`);
  }
});

test('a parlor page does not leak the moderation trail', async () => {
  const owner = await lister();
  const parlor = await createParlor(owner);
  const res = await get(`/api/parlors/${parlor.slug}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.moderationNote, undefined);
  assert.equal(res.body.data.moderatedBy, undefined);
});

/* ── Open now ────────────────────────────────────────────────── */

test('open status is computed live, not stored', async () => {
  const owner = await lister();
  // Open the entire day, so this is not flaky whenever the suite runs.
  const parlor = await createParlor(owner, { openingHours: allWeek('00:00', '23:59') });

  const res = await get(`/api/parlors/${parlor.slug}`);
  assert.equal(res.body.data.openNow, true);
  assert.equal(res.body.data.closesAt, '23:59');
  // Not a stored field — it is derived per request, because "open" is a fact
  // about right now and a cached one is wrong within the hour.
  const raw = await mongoose.model('Parlor').findById(parlor._id).lean();
  assert.equal(raw.openNow, undefined);
});

test('a closed day reads as closed', async () => {
  const owner = await lister();
  const hours = allWeek('11:00', '23:00').map((h) => ({ ...h, isClosed: true }));
  const parlor = await createParlor(owner, { openingHours: hours });

  const res = await get(`/api/parlors/${parlor.slug}`);
  assert.equal(res.body.data.openNow, false);
  assert.equal(res.body.data.todayHours, null);
});

test('openNow=true filters the list', async () => {
  const owner = await lister();
  await createParlor(owner, { name: 'Always Open Arcade', openingHours: allWeek('00:00', '23:59') });
  await createParlor(owner, {
    name: 'Permanently Shut Hall',
    openingHours: allWeek('11:00', '23:00').map((h) => ({ ...h, isClosed: true })),
  });

  const all = await get('/api/parlors');
  assert.equal(all.body.data.length, 2);

  const open = await get('/api/parlors?openNow=true');
  assert.equal(open.body.data.length, 1);
  assert.equal(open.body.data[0].name, 'Always Open Arcade');
});

/* ── Finding one ─────────────────────────────────────────────── */

test('filters by game, city and search', async () => {
  const owner = await lister();
  await createParlor(owner, { name: 'Strike Lanes', games: ['bowling'], address: { city: 'Mumbai' } });
  await createParlor(owner, { name: 'Cue Club', games: ['snooker', 'pool'], address: { city: 'Bengaluru' } });

  assert.equal((await get('/api/parlors?game=bowling')).body.data.length, 1);
  assert.equal((await get('/api/parlors?game=snooker')).body.data.length, 1);
  assert.equal((await get('/api/parlors?city=Mumbai')).body.data.length, 1);
  assert.equal((await get('/api/parlors?q=cue')).body.data.length, 1);
  assert.equal((await get('/api/parlors?game=vr')).body.data.length, 0);
});

test('a regex-special search string is treated as literal text', async () => {
  const owner = await lister();
  await createParlor(owner, { name: 'Cue Club' });
  // `(a+)+$` is a catastrophic-backtracking ReDoS if interpolated raw.
  const res = await get('/api/parlors?q=' + encodeURIComponent('(a+)+$'));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 0);
});

test('near-me sorts by distance and returns it', async () => {
  const owner = await lister();
  // Roughly Indiranagar, then ~8km away in Koramangala.
  await createParlor(owner, { name: 'Far Hall', lat: 12.9352, lng: 77.6245 });
  await createParlor(owner, { name: 'Near Hall', lat: 12.9716, lng: 77.5946 });

  const res = await get('/api/parlors?lat=12.9716&lng=77.5946&radiusKm=25');
  assert.equal(res.status, 200);
  assert.equal(res.body.data[0].name, 'Near Hall', 'closest first');
  assert.ok(res.body.data[0].distanceKm < res.body.data[1].distanceKm);
  assert.ok(res.body.data[0].distanceKm < 1);
});

test('the radius actually excludes things', async () => {
  const owner = await lister();
  await createParlor(owner, { name: 'Mumbai Hall', lat: 19.076, lng: 72.8777 });
  const res = await get('/api/parlors?lat=12.9716&lng=77.5946&radiusKm=25');
  assert.equal(res.body.data.length, 0, 'Mumbai is not within 25km of Bengaluru');
});

test('the map endpoint returns pins with open state', async () => {
  const owner = await lister();
  await createParlor(owner, { openingHours: allWeek('00:00', '23:59') });

  const res = await get('/api/parlors/map');
  assert.equal(res.status, 200);
  const pin = res.body.data[0];
  assert.equal(typeof pin.lat, 'number');
  assert.equal(typeof pin.lng, 'number');
  assert.equal(pin.openNow, true);
  assert.ok(pin.phone, 'the pin carries the number, so the map is useful on its own');
});

test('cities are listed for the filter', async () => {
  const owner = await lister();
  await createParlor(owner, { name: 'A Hall', address: { city: 'Bengaluru' } });
  await createParlor(owner, { name: 'B Hall', address: { city: 'Bengaluru' } });
  await createParlor(owner, { name: 'C Hall', address: { city: 'Mumbai' } });

  const res = await get('/api/parlors/meta/cities');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data[0], { city: 'Bengaluru', parlors: 2 });
});

/* ── Listing management ──────────────────────────────────────── */

test('an unverified lister is reviewed before going live', async () => {
  const owner = await lister({ verified: false });
  const parlor = await createParlor(owner);

  assert.equal((await get('/api/parlors')).body.data.length, 0, 'not public yet');
  const mine = await get('/api/parlors/mine/list', { token: owner.token });
  assert.equal(mine.body.data[0].moderationStatus, 'pending');

  const admin = await createUser({ role: 'player' });
  await mongoose.model('User').updateOne({ _id: admin.id }, { $set: { role: 'admin' } });
  const t = (await post('/api/auth/login', { email: admin.email, password: admin.password }))
    .body.data.accessToken;

  assert.equal((await patch(`/api/parlors/${parlor._id}/moderate`, { decision: 'approve' }, { token: t })).status, 200);
  assert.equal((await get('/api/parlors')).body.data.length, 1);
});

test('a player cannot add a listing', async () => {
  const p = await createUser({ role: 'player' });
  const res = await post('/api/parlors', {
    name: 'Unauthorised Hall', games: ['pool'], lat: 12.97, lng: 77.59,
  }, { token: p.token });
  assert.equal(res.status, 403);
});

test('you cannot edit or remove somebody else’s listing', async () => {
  const mine = await lister();
  const theirs = await lister();
  const parlor = await createParlor(mine);

  assert.equal((await patch(`/api/parlors/${parlor._id}`, { name: 'Hijacked' }, { token: theirs.token })).status, 403);
  assert.equal((await del(`/api/parlors/${parlor._id}`, { token: theirs.token })).status, 403);
});

test('coordinates are required — a locator without them is not one', async () => {
  const owner = await lister();
  const res = await post('/api/parlors', {
    name: 'Nowhere Hall', games: ['pool'], address: { city: 'Bengaluru' },
  }, { token: owner.token });
  assert.equal(res.status, 400);
});

test('at least one game is required', async () => {
  const owner = await lister();
  const res = await post('/api/parlors', {
    name: 'Empty Hall', games: [], lat: 12.97, lng: 77.59,
  }, { token: owner.token });
  assert.equal(res.status, 400);
});

test('an inverted price range is refused', async () => {
  const owner = await lister();
  const res = await post('/api/parlors', {
    name: 'Backwards Hall', games: ['pool'], lat: 12.97, lng: 77.59,
    priceFrom: 500, priceTo: 100,
  }, { token: owner.token });
  assert.equal(res.status, 400);
});

test('a permanently closed parlor drops out of the locator but keeps its page', async () => {
  const owner = await lister();
  const parlor = await createParlor(owner);

  await patch(`/api/parlors/${parlor._id}`, { isPermanentlyClosed: true }, { token: owner.token });

  assert.equal((await get('/api/parlors')).body.data.length, 0, 'not in results');
  // The page still resolves, so an old link or a search result does not 404.
  const page = await get(`/api/parlors/${parlor.slug}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.data.isPermanentlyClosed, true);
});

test('removing a listing hides it rather than destroying it', async () => {
  const owner = await lister();
  const parlor = await createParlor(owner);
  assert.equal((await del(`/api/parlors/${parlor._id}`, { token: owner.token })).status, 200);

  assert.equal((await get('/api/parlors')).body.data.length, 0);
  // Still in the database, so it can be restored and its history survives.
  assert.ok(await mongoose.model('Parlor').findById(parlor._id));
});
