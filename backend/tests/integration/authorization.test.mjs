/**
 * Authorization boundaries.
 *
 * Every test here answers one question: can someone reach data or an action
 * that is not theirs? These are the failures that do not show up as bugs —
 * the app looks fine and quietly serves one customer's data to another.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, resetDatabase,
  get, post, patch, del, createUser, createVenue, makeAdmin, fundWallet,
  dateKey, firstOpenSlot,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

/* ── Role gates ──────────────────────────────────────────────── */

test('a player cannot reach the owner dashboard', async () => {
  const player = await createUser({ role: 'player' });
  for (const path of ['/api/owner/overview', '/api/owner/customers', '/api/owner/payouts', '/api/owner/promos']) {
    const res = await get(path, { token: player.token });
    assert.equal(res.status, 403, `${path} should be owner-only`);
  }
});

test('a player cannot reach admin routes', async () => {
  const player = await createUser({ role: 'player' });
  for (const path of ['/api/admin/stats', '/api/admin/users', '/api/admin/venues', '/api/admin/ledger']) {
    const res = await get(path, { token: player.token });
    assert.equal(res.status, 403, `${path} should be admin-only`);
  }
});

test('an owner cannot reach admin routes', async () => {
  const owner = await createUser({ role: 'owner' });
  const res = await get('/api/admin/stats', { token: owner.token });
  assert.equal(res.status, 403);
});

test('admin routes reject an anonymous caller', async () => {
  assert.equal((await get('/api/admin/stats')).status, 401);
  assert.equal((await get('/api/owner/overview')).status, 401);
});

test('an admin can reach admin routes', async () => {
  const user = await createUser({ role: 'owner' });
  await makeAdmin(user.id);
  // The role lives in the token, so a fresh session is needed after promotion.
  const login = await post('/api/auth/login', { email: user.email, password: user.password });
  const res = await get('/api/admin/stats', { token: login.body.data.accessToken });
  assert.equal(res.status, 200);
});

/* ── Cross-tenant isolation ──────────────────────────────────── */

test('one owner cannot read another owner\'s analytics', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  const venueA = await createVenue(a);

  const res = await get(`/api/owner/overview?venueId=${venueA._id}`, { token: b.token });
  assert.equal(res.status, 403, 'venue id from the client must not widen the scope');
});

test('an owner\'s overview covers only their own venues', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  await createVenue(a, { name: 'Owner A Arena' });
  await createVenue(b, { name: 'Owner B Arena' });

  const res = await get('/api/owner/overview', { token: a.token });
  assert.equal(res.status, 200);
  const names = res.body.data.venues.map((v) => v.name);
  assert.ok(names.includes('Owner A Arena'));
  assert.ok(!names.some((n) => n.includes('Owner B')), 'no sight of the other owner\'s venue');
});

test('one owner cannot edit another owner\'s venue', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  const venueA = await createVenue(a);

  const res = await patch(`/api/venues/${venueA._id}`, { name: 'Hijacked' }, { token: b.token });
  assert.equal(res.status, 403);
});

test('one owner cannot deactivate another owner\'s venue', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  const venueA = await createVenue(a);

  const res = await del(`/api/venues/${venueA._id}`, { token: b.token });
  assert.equal(res.status, 403);
});

test('one owner cannot block out slots at another owner\'s venue', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  const venueA = await createVenue(a);

  const res = await post('/api/owner/blackouts', {
    venueId: venueA._id, date: dateKey(2), reason: 'not mine',
  }, { token: b.token });
  assert.equal(res.status, 403);
});

test('one owner cannot read another owner\'s calendar, with customer phone numbers', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  const venueA = await createVenue(a);

  const res = await get(`/api/owner/calendar?venueId=${venueA._id}&date=${dateKey(1)}`, { token: b.token });
  assert.equal(res.status, 403);
});

test('an owner cannot settle cash on a booking at someone else\'s venue', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  const player = await createUser({ role: 'player' });
  const venueA = await createVenue(a, { acceptsPayAtVenue: true });
  await fundWallet(player.id, 20000);

  const date = dateKey(2);
  const slot = await firstOpenSlot(venueA._id, date);
  const booking = await post('/api/bookings', {
    venueId: venueA._id, courtId: slot.courtId, date, starts: [slot.start],
    paymentMethod: 'pay_at_venue',
  }, { token: player.token });

  const res = await patch(`/api/bookings/${booking.body.data.booking.groupRef}/settle`, {}, { token: b.token });
  assert.equal(res.status, 403);
});

/* ── Promo isolation ─────────────────────────────────────────── */

test('one owner cannot edit or delete another owner\'s promo', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  await createVenue(a);

  const promo = await post('/api/owner/promos', {
    code: 'MINEONLY', type: 'percent', value: 10,
  }, { token: a.token });
  assert.equal(promo.status, 201);

  const id = promo.body.data._id;
  assert.equal((await patch(`/api/owner/promos/${id}`, { value: 90 }, { token: b.token })).status, 403);
  assert.equal((await del(`/api/owner/promos/${id}`, { token: b.token })).status, 403);
});

test('an owner cannot scope a promo to a venue they do not own', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  const venueA = await createVenue(a);
  await createVenue(b);

  const res = await post('/api/owner/promos', {
    code: 'NOTMINE', type: 'flat', value: 100, venues: [venueA._id],
  }, { token: b.token });
  assert.equal(res.status, 403);
});

test('a percentage promo cannot exceed 100', async () => {
  const owner = await createUser({ role: 'owner' });
  await createVenue(owner);
  const res = await post('/api/owner/promos', {
    code: 'FREEBIE', type: 'percent', value: 500,
  }, { token: owner.token });
  assert.equal(res.status, 400);
});

/* ── Notifications & teams ───────────────────────────────────── */

test('notifications are scoped to the signed-in user', async () => {
  const a = await createUser({ role: 'player' });
  const b = await createUser({ role: 'player' });

  const listA = await get('/api/notifications', { token: a.token });
  const listB = await get('/api/notifications', { token: b.token });
  assert.equal(listA.status, 200);
  assert.equal(listB.status, 200);
  assert.equal(listB.body.data.length, 0, 'b sees nothing of a\'s');
});

test('a team is private to its members', async () => {
  const captain = await createUser({ role: 'player' });
  const stranger = await createUser({ role: 'player' });

  const team = await post('/api/teams', { name: 'Private Squad', sport: 'football' }, { token: captain.token });
  assert.equal(team.status, 201);

  const res = await get(`/api/teams/${team.body.data._id}`, { token: stranger.token });
  assert.equal(res.status, 403);
});

test('only the captain can invite or remove members', async () => {
  const captain = await createUser({ role: 'player' });
  const member = await createUser({ role: 'player' });

  const team = await post('/api/teams', { name: 'Squad', sport: 'football' }, { token: captain.token });
  const teamId = team.body.data._id;

  // The member joins with a code, then tries to act as captain.
  const invite = await post(`/api/teams/${teamId}/invite`, {}, { token: captain.token });
  await post('/api/teams/join', { code: invite.body.data.code }, { token: member.token });

  const res = await post(`/api/teams/${teamId}/invite`, {}, { token: member.token });
  assert.equal(res.status, 403, 'only the captain invites');
});

test('an invite code addressed to one email cannot be redeemed by another', async () => {
  const captain = await createUser({ role: 'player' });
  const intended = await createUser({ role: 'player' });
  const other = await createUser({ role: 'player' });

  const team = await post('/api/teams', { name: 'Addressed', sport: 'football' }, { token: captain.token });
  const invite = await post(`/api/teams/${team.body.data._id}/invite`,
    { email: intended.email }, { token: captain.token });

  const wrong = await post('/api/teams/join', { code: invite.body.data.code }, { token: other.token });
  assert.equal(wrong.status, 403);

  const right = await post('/api/teams/join', { code: invite.body.data.code }, { token: intended.token });
  assert.equal(right.status, 200);
});

/* ── Reviews ─────────────────────────────────────────────────── */

test('a review requires having actually played and paid', async () => {
  const owner = await createUser({ role: 'owner' });
  const player = await createUser({ role: 'player' });
  const venue = await createVenue(owner);

  const res = await post('/api/reviews', { venueId: venue._id, rating: 5 }, { token: player.token });
  assert.equal(res.status, 403, 'no completed booking, no review');
});

test('an owner cannot review their own venue', async () => {
  const owner = await createUser({ role: 'owner' });
  const venue = await createVenue(owner);

  const res = await post('/api/reviews', { venueId: venue._id, rating: 5 }, { token: owner.token });
  assert.equal(res.status, 403);
});

/* ── Venue moderation ────────────────────────────────────────── */

test('an unverified owner\'s venue is held for review and stays hidden', async () => {
  const owner = await createUser({ role: 'owner' });   // deliberately not verified

  const res = await post('/api/venues', {
    name: 'Unvetted Arena', lat: 12.9, lng: 77.6,
    courts: [{ name: 'A', sport: 'football', pricePerHour: 500 }],
  }, { token: owner.token });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.venue.moderationStatus, 'pending');
  assert.equal(res.body.data.venue.isActive, false);

  const publicList = await get('/api/venues?q=Unvetted');
  assert.equal(publicList.body.meta.total, 0, 'not in public discovery');
});

test('an owner cannot self-approve their pending venue', async () => {
  const owner = await createUser({ role: 'owner' });
  const created = await post('/api/venues', {
    name: 'Self Approve Attempt', lat: 12.9, lng: 77.6,
    courts: [{ name: 'A', sport: 'football', pricePerHour: 500 }],
  }, { token: owner.token });

  const id = created.body.data.venue._id;
  await patch(`/api/venues/${id}`, { isActive: true }, { token: owner.token });

  const check = await get('/api/venues?q=Self%20Approve');
  assert.equal(check.body.meta.total, 0, 'still hidden — approval is not the owner\'s to grant');
});

test('an owner cannot mark their own venue featured or verified', async () => {
  const owner = await createUser({ role: 'owner' });
  const venue = await createVenue(owner);

  await patch(`/api/venues/${venue._id}`,
    { isFeatured: true, isVerified: true, commissionPercent: 0 },
    { token: owner.token });

  const after = await get(`/api/venues/${venue._id}`);
  assert.equal(after.body.data.venue.isFeatured, false, 'paid placement is not self-serve');
  assert.equal(after.body.data.venue.isVerified, false);
});

/* ── Cron ────────────────────────────────────────────────────── */

test('cron routes 404 when no secret is configured', async () => {
  // CRON_SECRET is unset in the test env, so the endpoint must not exist —
  // an open endpoint that issues refunds is not something to leave on.
  const res = await post('/api/cron/lifecycle', {});
  assert.equal(res.status, 404);
});

test('the seed endpoint is not reachable without the secret', async () => {
  const res = await post('/api/cron/seed', {});
  assert.equal(res.status, 404);
});

/* ── Push subscriptions (SSRF) ───────────────────────────────── */

test('a push subscription pointing at an internal host is refused', async () => {
  const player = await createUser({ role: 'player' });

  // A stored subscription IS the URL the server later POSTs to, so an
  // unchecked endpoint turns this into a server-side request forgery
  // primitive with full control of host and scheme.
  const hostile = [
    'http://169.254.169.254/latest/meta-data/',   // cloud metadata
    'http://127.0.0.1:5000/api/admin/stats',      // loopback
    'http://localhost/internal',
    'https://attacker.example.com/collect',       // arbitrary external host
    'file:///etc/passwd',
    'http://[::1]/',
  ];

  for (const endpoint of hostile) {
    const res = await post('/api/notifications/push-token', {
      token: JSON.stringify({ endpoint, keys: { p256dh: 'x'.repeat(87), auth: 'y'.repeat(22) } }),
      platform: 'web',
    }, { token: player.token });
    assert.equal(res.status, 400, `should refuse ${endpoint}`);
  }
});

test('a genuine push endpoint is accepted', async () => {
  const player = await createUser({ role: 'player' });
  const res = await post('/api/notifications/push-token', {
    token: JSON.stringify({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: 'x'.repeat(87), auth: 'y'.repeat(22) },
    }),
    platform: 'web',
  }, { token: player.token });
  assert.equal(res.status, 200);
});
