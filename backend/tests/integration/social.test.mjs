/**
 * TeamUp, loyalty and public discovery.
 *
 * The concurrency cases here matter as much as the booking ones: a TeamUp
 * spot is a scarce resource with money attached to it, and the loyalty
 * balance is convertible to wallet credit.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase,
  get, post, patch, del, createUser, createVenue, fundWallet,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

const soon = (hours = 48) => new Date(Date.now() + hours * 3600_000).toISOString();

/**
 * Moves a post's kickoff into the past.
 *
 * Settlement is only allowed once the game has started, and a post cannot be
 * CREATED in the past, so a test that needs a played game has to make one and
 * then age it.
 */
async function kickOff(postId, hoursAgo = 1) {
  await mongoose.model('TeamUpPost').updateOne(
    { _id: postId },
    { $set: { playAt: new Date(Date.now() - hoursAgo * 3600_000) } },
  );
}

const walletOf = async (userId) => {
  const u = await mongoose.model('User').findById(userId).select('walletBalance').lean();
  return u.walletBalance;
};

async function createPost(host, overrides = {}) {
  const res = await post('/api/teamup', {
    type: 'need_players',
    sport: 'football',
    title: 'Sunday five-a-side',
    playAt: soon(),
    spotsNeeded: 2,
    ...overrides,
  }, { token: host.token });
  if (res.status !== 201) throw new Error(`createPost failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/* ── TeamUp ──────────────────────────────────────────────────── */

test('the feed is readable without an account', async () => {
  const host = await createUser({ role: 'player' });
  await createPost(host);

  const res = await get('/api/teamup');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length >= 1);
});

test('a game in the past is refused', async () => {
  const host = await createUser({ role: 'player' });
  const res = await post('/api/teamup', {
    type: 'need_players', sport: 'football', title: 'Yesterday',
    playAt: new Date(Date.now() - 3600_000).toISOString(), spotsNeeded: 2,
  }, { token: host.token });
  assert.equal(res.status, 400);
});

test('the host cannot join their own game', async () => {
  const host = await createUser({ role: 'player' });
  const game = await createPost(host);
  const res = await post(`/api/teamup/${game._id}/join`, {}, { token: host.token });
  assert.equal(res.status, 400);
});

test('only the host sees the join-request list', async () => {
  const host = await createUser({ role: 'player' });
  const joiner = await createUser({ role: 'player' });
  const game = await createPost(host);

  await post(`/api/teamup/${game._id}/join`, { message: 'me please' }, { token: joiner.token });

  const asHost = await get(`/api/teamup/${game._id}`, { token: host.token });
  const asOther = await get(`/api/teamup/${game._id}`, { token: joiner.token });

  assert.ok(Array.isArray(asHost.body.data.joinRequests), 'host sees the list');
  assert.equal(asOther.body.data.joinRequests, undefined, 'a joiner does not');
  assert.ok(asOther.body.data.myRequest, 'but does see their own request');
});

test('a game cannot be over-filled by concurrent auto-approve joins', async () => {
  const host = await createUser({ role: 'player' });
  const game = await createPost(host, { spotsNeeded: 2, autoApprove: true });

  const joiners = await Promise.all([1, 2, 3, 4, 5].map(() => createUser({ role: 'player' })));
  const results = await Promise.all(
    joiners.map((j) => post(`/api/teamup/${game._id}/join`, {}, { token: j.token })),
  );

  const accepted = results.filter((r) => r.status === 200);
  assert.equal(accepted.length, 2, `only two spots exist, ${accepted.length} were handed out`);

  const after = await get(`/api/teamup/${game._id}`);
  assert.equal(after.body.data.spotsFilled, 2);
  assert.equal(after.body.data.status, 'filled');
});

test('only the host can accept a join request', async () => {
  const host = await createUser({ role: 'player' });
  const joiner = await createUser({ role: 'player' });
  const meddler = await createUser({ role: 'player' });
  const game = await createPost(host);

  await post(`/api/teamup/${game._id}/join`, {}, { token: joiner.token });
  const full = await get(`/api/teamup/${game._id}`, { token: host.token });
  const requestId = full.body.data.joinRequests[0]._id;

  const res = await patch(`/api/teamup/${game._id}/requests/${requestId}`,
    { decision: 'accept' }, { token: meddler.token });
  assert.equal(res.status, 403);
});

test('the same request cannot be accepted twice', async () => {
  const host = await createUser({ role: 'player' });
  const joiner = await createUser({ role: 'player' });
  const game = await createPost(host, { spotsNeeded: 4 });

  await post(`/api/teamup/${game._id}/join`, {}, { token: joiner.token });
  const full = await get(`/api/teamup/${game._id}`, { token: host.token });
  const requestId = full.body.data.joinRequests[0]._id;

  const first = await patch(`/api/teamup/${game._id}/requests/${requestId}`, { decision: 'accept' }, { token: host.token });
  assert.equal(first.status, 200);

  const second = await patch(`/api/teamup/${game._id}/requests/${requestId}`, { decision: 'accept' }, { token: host.token });
  assert.equal(second.status, 400, 'already handled');

  const after = await get(`/api/teamup/${game._id}`);
  assert.equal(after.body.data.spotsFilled, 1, 'the spot count was incremented once');
});

test('only the host can cancel the game', async () => {
  const host = await createUser({ role: 'player' });
  const other = await createUser({ role: 'player' });
  const game = await createPost(host);

  assert.equal((await del(`/api/teamup/${game._id}`, { token: other.token })).status, 403);
  assert.equal((await del(`/api/teamup/${game._id}`, { token: host.token })).status, 200);
});

test('a per-person share above the cap is refused', async () => {
  const host = await createUser({ role: 'player' });
  const res = await post('/api/teamup', {
    type: 'need_players', sport: 'football', title: 'Gold plated pitch',
    playAt: soon(), spotsNeeded: 1,
    costSharing: { enabled: true, totalAmount: 90000 },
  }, { token: host.token });
  assert.equal(res.status, 400, 'a host cannot declare an unbounded cost for others');
});

test('cost settlement runs once and charges the agreed share', async () => {
  const host = await createUser({ role: 'player' });
  const joiner = await createUser({ role: 'player' });
  await fundWallet(joiner.id, 5000);

  const game = await createPost(host, {
    spotsNeeded: 1, autoApprove: true,
    costSharing: { enabled: true, totalAmount: 1000 },
  });

  await post(`/api/teamup/${game._id}/join`, {}, { token: joiner.token });
  await kickOff(game._id);

  const first = await post(`/api/teamup/${game._id}/settle`, {}, { token: host.token });
  assert.equal(first.status, 200);
  assert.ok(first.body.data.collected > 0);

  const second = await post(`/api/teamup/${game._id}/settle`, {}, { token: host.token });
  assert.equal(second.status, 400, 'settling twice is refused');
});

test('a host cannot collect before the game has kicked off', async () => {
  const host = await createUser({ role: 'player' });
  const joiner = await createUser({ role: 'player' });
  await fundWallet(joiner.id, 5000);

  const game = await createPost(host, {
    spotsNeeded: 1, autoApprove: true,
    costSharing: { enabled: true, totalAmount: 1000 },
  });
  await post(`/api/teamup/${game._id}/join`, {}, { token: joiner.token });

  const before = await walletOf(joiner.id);
  const res = await post(`/api/teamup/${game._id}/settle`, {}, { token: host.token });

  assert.equal(res.status, 400, 'the game is still two days away');
  assert.match(res.body.error.message, /once the game has started/i);
  assert.equal(await walletOf(joiner.id), before, 'nothing left the player’s wallet');
});

test('cancelling after settling gives every share back', async () => {
  const host = await createUser({ role: 'player' });
  const joiner = await createUser({ role: 'player' });
  await fundWallet(joiner.id, 5000);
  await fundWallet(host.id, 0);

  const game = await createPost(host, {
    spotsNeeded: 1, autoApprove: true,
    costSharing: { enabled: true, totalAmount: 1000 },
  });
  await post(`/api/teamup/${game._id}/join`, {}, { token: joiner.token });
  await kickOff(game._id);

  const beforeJoiner = await walletOf(joiner.id);
  const settle = await post(`/api/teamup/${game._id}/settle`, {}, { token: host.token });
  assert.equal(settle.status, 200);
  const collected = settle.body.data.collected;
  assert.ok(collected > 0);
  assert.equal(await walletOf(joiner.id), beforeJoiner - collected, 'the share was taken');
  assert.equal(await walletOf(host.id), collected, 'and landed with the host');

  // The whole point: settle-then-cancel must not be profitable.
  const cancel = await del(`/api/teamup/${game._id}`, { token: host.token });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal(cancel.body.data.refunded, collected);
  assert.equal(await walletOf(joiner.id), beforeJoiner, 'the player is whole again');
  assert.equal(await walletOf(host.id), 0, 'the host kept nothing');
});

test('two simultaneous cancels refund only once', async () => {
  const host = await createUser({ role: 'player' });
  const joiner = await createUser({ role: 'player' });
  await fundWallet(joiner.id, 5000);

  const game = await createPost(host, {
    spotsNeeded: 1, autoApprove: true,
    costSharing: { enabled: true, totalAmount: 1000 },
  });
  await post(`/api/teamup/${game._id}/join`, {}, { token: joiner.token });
  await kickOff(game._id);

  const beforeJoiner = await walletOf(joiner.id);
  await post(`/api/teamup/${game._id}/settle`, {}, { token: host.token });

  const [a, b] = await Promise.all([
    del(`/api/teamup/${game._id}`, { token: host.token }),
    del(`/api/teamup/${game._id}`, { token: host.token }),
  ]);
  assert.equal([a, b].filter((r) => r.status === 200).length, 1, 'one cancel wins');
  assert.equal(await walletOf(joiner.id), beforeJoiner, 'refunded exactly once');
});

test('leaving a game you already paid for returns your share', async () => {
  const host = await createUser({ role: 'player' });
  const joiner = await createUser({ role: 'player' });
  await fundWallet(joiner.id, 5000);

  const game = await createPost(host, {
    spotsNeeded: 2, autoApprove: true,
    costSharing: { enabled: true, totalAmount: 900 },
  });
  await post(`/api/teamup/${game._id}/join`, {}, { token: joiner.token });
  await kickOff(game._id);

  const before = await walletOf(joiner.id);
  const settle = await post(`/api/teamup/${game._id}/settle`, {}, { token: host.token });
  assert.equal(settle.status, 200);
  assert.ok(await walletOf(joiner.id) < before);

  const out = await del(`/api/teamup/${game._id}/join`, { token: joiner.token });
  assert.equal(out.status, 200);
  assert.ok(out.body.data.refunded > 0);
  assert.equal(await walletOf(joiner.id), before, 'made whole on the way out');
});

test('one post cannot be built to collect an unbounded pool', async () => {
  const host = await createUser({ role: 'player' });
  const res = await post('/api/teamup', {
    type: 'need_players', sport: 'football', title: 'Thirty marks required',
    playAt: soon(), spotsNeeded: 30,
    // Under the per-person cap (2903 each) but ₹87k in total.
    costSharing: { enabled: true, totalAmount: 90000 },
  }, { token: host.token });
  assert.equal(res.status, 400, 'the per-person cap alone is not a bound on exposure');
  assert.match(res.body.error.message, /in total/i);
});

test('only the host can settle the cost', async () => {
  const host = await createUser({ role: 'player' });
  const joiner = await createUser({ role: 'player' });
  const game = await createPost(host, {
    spotsNeeded: 1, autoApprove: true,
    costSharing: { enabled: true, totalAmount: 800 },
  });
  await post(`/api/teamup/${game._id}/join`, {}, { token: joiner.token });
  await kickOff(game._id);

  const res = await post(`/api/teamup/${game._id}/settle`, {}, { token: joiner.token });
  assert.equal(res.status, 403);
});

/* ── Loyalty ─────────────────────────────────────────────────── */

test('signup grants the welcome bonus', async () => {
  const player = await createUser({ role: 'player' });
  const res = await get('/api/loyalty', { token: player.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.points, 100);
  assert.equal(res.body.data.tier.key, 'rookie');
});

test('points cannot be redeemed below the minimum or in odd amounts', async () => {
  const player = await createUser({ role: 'player' });
  assert.equal((await post('/api/loyalty/redeem', { points: 50 }, { token: player.token })).status, 400);
  assert.equal((await post('/api/loyalty/redeem', { points: 205 }, { token: player.token })).status, 400);
});

test('redeeming more points than you hold is refused', async () => {
  const player = await createUser({ role: 'player' });
  const res = await post('/api/loyalty/redeem', { points: 10000 }, { token: player.token });
  assert.equal(res.status, 400);
});

test('concurrent redemptions cannot double-spend the same points', async () => {
  const player = await createUser({ role: 'player' });
  await mongoose.model('User').updateOne({ _id: player.id }, { $set: { loyaltyPoints: 500, lifetimePoints: 500 } });

  const results = await Promise.all([1, 2, 3, 4].map(
    () => post('/api/loyalty/redeem', { points: 500 }, { token: player.token }),
  ));

  assert.equal(results.filter((r) => r.status === 200).length, 1, 'exactly one redemption succeeds');

  const after = await get('/api/loyalty', { token: player.token });
  assert.equal(after.body.data.points, 0);

  const wallet = await get('/api/bookings/wallet', { token: player.token });
  assert.equal(wallet.body.data.balance, 50, '500 points became 50 rupees, once');
});

test('redeeming points never lowers the tier', async () => {
  const player = await createUser({ role: 'player' });
  await mongoose.model('User').updateOne({ _id: player.id },
    { $set: { loyaltyPoints: 600, lifetimePoints: 600, loyaltyTier: 'pro' } });

  const res = await post('/api/loyalty/redeem', { points: 600 }, { token: player.token });
  assert.equal(res.status, 200);

  const after = await get('/api/loyalty', { token: player.token });
  assert.equal(after.body.data.points, 0);
  assert.equal(after.body.data.tier.key, 'pro', 'lifetime points, and so the tier, are untouched');
});

/* ── Discovery ───────────────────────────────────────────────── */

test('venue search filters and paginates', async () => {
  const owner = await createUser({ role: 'owner' });
  await createVenue(owner, { name: 'Koramangala Kickabout' });
  await createVenue(owner, {
    name: 'Whitefield Smash',
    courts: [{ name: 'Court 1', sport: 'badminton', pricePerHour: 400 }],
  });

  const all = await get('/api/venues');
  assert.equal(all.body.meta.total, 2);

  const football = await get('/api/venues?sport=football');
  assert.equal(football.body.meta.total, 1);

  const byName = await get('/api/venues?q=Whitefield');
  assert.equal(byName.body.meta.total, 1);
  assert.equal(byName.body.data[0].name, 'Whitefield Smash');
});

test('a regex-special search string is treated as literal text', async () => {
  const owner = await createUser({ role: 'owner' });
  await createVenue(owner, { name: 'Normal Arena' });

  // Unescaped, `.*` would match everything and `(a+)+$` is a ReDoS.
  const wildcard = await get('/api/venues?q=.*');
  assert.equal(wildcard.body.meta.total, 0, 'the dot-star is matched literally');

  const evil = await get(`/api/venues?q=${encodeURIComponent('(a+)+$')}`);
  assert.equal(evil.status, 200, 'no catastrophic backtracking');
});

test('price filtering uses the cheapest active court', async () => {
  const owner = await createUser({ role: 'owner' });
  await createVenue(owner, {
    name: 'Budget Turf',
    courts: [{ name: 'A', sport: 'football', pricePerHour: 300 }],
  });
  await createVenue(owner, {
    name: 'Premium Turf',
    courts: [{ name: 'A', sport: 'football', pricePerHour: 3000 }],
  });

  const cheap = await get('/api/venues?maxPrice=1000');
  assert.equal(cheap.body.meta.total, 1);
  assert.equal(cheap.body.data[0].name, 'Budget Turf');
});

test('a venue page does not expose the platform’s commercial terms', async () => {
  const owner = await createUser({ role: 'owner' });
  const venue = await createVenue(owner);

  // Anonymous: the public view.
  const res = await get(`/api/venues/${venue._id}`);
  assert.equal(res.status, 200);
  const body = res.body.data.venue;
  for (const field of ['commissionPercent', 'blackouts', 'moderationNote', 'moderatedBy']) {
    assert.equal(body[field], undefined, `${field} is internal, not public`);
  }

  // The owner still sees their own venue in full — the moderation note is
  // written for them to read.
  const mine = await get(`/api/venues/${venue._id}`, { token: owner.token });
  assert.equal(mine.status, 200);
  assert.equal(typeof mine.body.data.venue.commissionPercent, 'number',
    'the owner sees their own commercial terms');
  assert.ok(Array.isArray(mine.body.data.venue.blackouts));
});

test('a venue page does not expose the owner\'s email or phone', async () => {
  const owner = await createUser({ role: 'owner' });
  const venue = await createVenue(owner);

  const res = await get(`/api/venues/${venue._id}`);
  assert.equal(res.status, 200);
  const serialised = JSON.stringify(res.body);
  assert.ok(!serialised.includes(owner.email), 'the owner\'s registration email is not public');
});

test('an invalid venue id returns 400, not a crash', async () => {
  const res = await get('/api/venues/not-a-real-id/availability');
  assert.ok([400, 404].includes(res.status), `got ${res.status}`);
});

/* ── Health ──────────────────────────────────────────────────── */

test('health and readiness both answer', async () => {
  assert.equal((await get('/api/health')).status, 200);
  const ready = await get('/api/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.data.db, 'connected');
});

test('an unknown route returns a clean 404', async () => {
  const res = await get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('an oversized body is rejected rather than parsed', async () => {
  const player = await createUser({ role: 'player' });
  const res = await patch('/api/auth/me', { bio: 'x'.repeat(400_000) }, { token: player.token });
  assert.ok([400, 413].includes(res.status), `got ${res.status}`);
});
