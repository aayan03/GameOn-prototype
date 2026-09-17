/**
 * TeamUp, where money moves between two players rather than through a booking.
 *
 * Settlement pulls each player's agreed share into the host's wallet, and
 * leaving a settled game pushes it back. Both are wallet-to-wallet transfers
 * on one person's say-so, and neither is covered by a concurrency test — the
 * existing ones stop at over-filling a game and double cancels. These drive
 * the pairs that can run at the same time in real use: a double-tap on Leave,
 * a player leaving while the host settles, and a settle racing a cancel.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase,
  post, del, get, createUser, fundWallet,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

const soon = (hours = 48) => new Date(Date.now() + hours * 3600_000).toISOString();

const walletOf = async (userId) => {
  const u = await mongoose.model('User').findById(userId).select('walletBalance').lean();
  return u.walletBalance;
};

async function kickOff(postId, hoursAgo = 1) {
  await mongoose.model('TeamUpPost').updateOne(
    { _id: postId },
    { $set: { playAt: new Date(Date.now() - hoursAgo * 3600_000) } }
  );
}

/**
 * A played game with one player in it, already settled.
 *
 * `share` is what the player paid the host, so the host is holding it when
 * these tests start pulling at the refund path.
 */
async function settledGame({ share = 600, hostFloat = 0, playerFloat = 5000 } = {}) {
  const host = await createUser({ role: 'player' });
  const player = await createUser({ role: 'player' });
  await fundWallet(host.id, hostFloat);
  await fundWallet(player.id, playerFloat);

  const created = await post('/api/teamup', {
    type: 'need_players', sport: 'football', title: 'Sunday five-a-side',
    playAt: soon(), spotsNeeded: 2, autoApprove: true,
    costSharing: { enabled: true, totalAmount: share * 2 },
  }, { token: host.token });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const postId = created.body.data._id;

  const joined = await post(`/api/teamup/${postId}/join`, { spots: 1 }, { token: player.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));

  await kickOff(postId);
  const settled = await post(`/api/teamup/${postId}/settle`, {}, { token: host.token });
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.ok(settled.body.data.collected > 0, 'the fixture must actually collect something');

  return { host, player, postId, collected: settled.body.data.collected };
}

test('a double-tap on Leave refunds the share once, not twice', async () => {
  const { host, player, postId, collected } = await settledGame();
  const hostBefore = await walletOf(host.id);
  const playerBefore = await walletOf(player.id);

  // Two withdrawals in flight at once — one thumb, two taps.
  const results = await Promise.all([
    del(`/api/teamup/${postId}/join`, { token: player.token }),
    del(`/api/teamup/${postId}/join`, { token: player.token }),
  ]);

  const refunded = results
    .filter((r) => r.status === 200)
    .reduce((sum, r) => sum + (r.body.data.refunded || 0), 0);

  assert.equal(refunded, collected, `the share is returned once, not ${refunded / collected} times`);
  assert.equal(
    await walletOf(player.id), playerBefore + collected,
    'the player gets their share back exactly once'
  );
  assert.equal(
    await walletOf(host.id), hostBefore - collected,
    'and the host pays it back exactly once'
  );
});

test('leaving a settled game moves the same money the host collected', async () => {
  // The single-threaded case, as the baseline the race above is measured from.
  const { host, player, postId, collected } = await settledGame();
  const hostBefore = await walletOf(host.id);
  const playerBefore = await walletOf(player.id);

  const res = await del(`/api/teamup/${postId}/join`, { token: player.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.refunded, collected);
  assert.equal(await walletOf(player.id), playerBefore + collected);
  assert.equal(await walletOf(host.id), hostBefore - collected);
});

test('a player who leaves as the host settles is not left paying for a game they left', async () => {
  const host = await createUser({ role: 'player' });
  const player = await createUser({ role: 'player' });
  await fundWallet(player.id, 5000);

  const created = await post('/api/teamup', {
    type: 'need_players', sport: 'football', title: 'Race the settle',
    playAt: soon(), spotsNeeded: 2, autoApprove: true,
    costSharing: { enabled: true, totalAmount: 1200 },
  }, { token: host.token });
  const postId = created.body.data._id;
  await post(`/api/teamup/${postId}/join`, { spots: 1 }, { token: player.token });
  await kickOff(postId);

  const playerBefore = await walletOf(player.id);

  const [settle, withdraw] = await Promise.all([
    post(`/api/teamup/${postId}/settle`, {}, { token: host.token }),
    del(`/api/teamup/${postId}/join`, { token: player.token }),
  ]);

  const charged = playerBefore - (await walletOf(player.id));
  const refunded = withdraw.status === 200 ? (withdraw.body.data.refunded || 0) : 0;

  // Either outcome is defensible — charged and refunded, or never charged —
  // but the player must not end up out of pocket for a game they left.
  assert.ok(
    charged === 0,
    `the player is down ₹${charged} after leaving (settle=${settle.status}, refunded ₹${refunded})`
  );
});

test('spots freed by a player leaving are not lost when someone joins at the same time', async () => {
  const host = await createUser({ role: 'player' });
  const leaver = await createUser({ role: 'player' });
  const joiner = await createUser({ role: 'player' });

  const created = await post('/api/teamup', {
    type: 'need_players', sport: 'football', title: 'Two spots',
    playAt: soon(), spotsNeeded: 2, autoApprove: true,
  }, { token: host.token });
  const postId = created.body.data._id;

  await post(`/api/teamup/${postId}/join`, { spots: 1 }, { token: leaver.token });

  // One leaves while another joins. Whatever the order, the count on the post
  // has to match who is actually in it.
  await Promise.all([
    del(`/api/teamup/${postId}/join`, { token: leaver.token }),
    post(`/api/teamup/${postId}/join`, { spots: 1 }, { token: joiner.token }),
  ]);

  const after = await mongoose.model('TeamUpPost').findById(postId).lean();
  const accepted = (after.joinRequests || []).filter((r) => r.status === 'accepted');
  const claimedSpots = accepted.reduce((sum, r) => sum + (r.spots || 0), 0);

  assert.equal(
    after.spotsFilled, claimedSpots,
    `spotsFilled says ${after.spotsFilled} but ${claimedSpots} spot(s) are actually held`
  );
  assert.equal(
    after.confirmedPlayers.length, accepted.length,
    'the confirmed player list matches the accepted requests'
  );
  assert.ok(after.spotsFilled >= 0 && after.spotsFilled <= after.spotsNeeded, 'the count stays in range');
});

test('two hosts settling the same game at once collect it once', async () => {
  // Same host, two taps: the money may only leave the player's wallet once.
  const host = await createUser({ role: 'player' });
  const player = await createUser({ role: 'player' });
  await fundWallet(player.id, 5000);

  const created = await post('/api/teamup', {
    type: 'need_players', sport: 'football', title: 'Double settle',
    playAt: soon(), spotsNeeded: 2, autoApprove: true,
    costSharing: { enabled: true, totalAmount: 1000 },
  }, { token: host.token });
  const postId = created.body.data._id;
  await post(`/api/teamup/${postId}/join`, { spots: 1 }, { token: player.token });
  await kickOff(postId);

  // The share is the total split across the spots and the host, so it is
  // whatever the API says it is — not a number worth hard-coding here.
  const share = (await get(`/api/teamup/${postId}`)).body.data.costSharing.perPersonAmount;
  const playerBefore = await walletOf(player.id);
  const results = await Promise.all([
    post(`/api/teamup/${postId}/settle`, {}, { token: host.token }),
    post(`/api/teamup/${postId}/settle`, {}, { token: host.token }),
  ]);

  const collected = results
    .filter((r) => r.status === 200)
    .reduce((sum, r) => sum + (r.body.data.collected || 0), 0);
  assert.equal(playerBefore - (await walletOf(player.id)), collected, 'charged exactly what was reported');
  assert.equal(collected, share, 'the share is collected once, not once per tap');
});

test('leaving repeatedly cannot pull more than the share out of the host', async () => {
  // Six taps on Leave, which is one impatient thumb on a slow connection.
  const { host, player, postId, collected } = await settledGame({ hostFloat: 5000 });
  const hostBefore = await walletOf(host.id);
  const playerBefore = await walletOf(player.id);

  const taps = await Promise.all(
    Array.from({ length: 6 }, () => del(`/api/teamup/${postId}/join`, { token: player.token }))
  );

  const gained = (await walletOf(player.id)) - playerBefore;
  assert.equal(
    gained, collected,
    `the player took ₹${gained} back out of a ₹${collected} share `
    + `(statuses: ${taps.map((r) => r.status).join(',')})`
  );
  assert.equal(await walletOf(host.id), hostBefore - collected, 'the host paid it back once');
  assert.equal(
    taps.filter((r) => r.status >= 500).length, 0,
    'and no request fell over with a server error'
  );
});

test('a share is never collected from a player who never had the balance', async () => {
  // A host must not be able to push a wallet negative by settling.
  const host = await createUser({ role: 'player' });
  const player = await createUser({ role: 'player' });
  await fundWallet(player.id, 100); // less than the share

  const created = await post('/api/teamup', {
    type: 'need_players', sport: 'football', title: 'Short wallet',
    playAt: soon(), spotsNeeded: 2, autoApprove: true,
    costSharing: { enabled: true, totalAmount: 2000 },
  }, { token: host.token });
  const postId = created.body.data._id;
  await post(`/api/teamup/${postId}/join`, { spots: 1 }, { token: player.token });
  await kickOff(postId);

  const res = await post(`/api/teamup/${postId}/settle`, {}, { token: host.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.failedCount, 1, 'the short player is reported, not silently skipped');
  assert.equal(await walletOf(player.id), 100, 'and their wallet is untouched');
  assert.ok((await walletOf(host.id)) >= 0);
});

test('a player leaving as the host calls it off gets the share back once, not twice', async () => {
  // Cancelling refunds every settled share, and so does leaving. Both read
  // the amount from their own copy of the post, so the pair that overlaps
  // here — the host calling it off as the last player walks — paid the same
  // share back twice, out of the host's wallet. The host is funded well
  // above the share so a second refund would succeed rather than bounce.
  const { host, player, postId, collected } = await settledGame({ hostFloat: 5000 });
  const hostBefore = await walletOf(host.id);
  const playerBefore = await walletOf(player.id);

  const [cancelled, left] = await Promise.all([
    del(`/api/teamup/${postId}`, { token: host.token }),
    del(`/api/teamup/${postId}/join`, { token: player.token }),
  ]);

  assert.equal(
    (await walletOf(player.id)) - playerBefore, collected,
    'the player is given their share back exactly once'
  );
  assert.equal(
    await walletOf(host.id), hostBefore - collected,
    'and the host pays it back exactly once'
  );
  assert.equal(
    [cancelled, left].filter((r) => r.status >= 500).length, 0,
    'and neither request fell over with a server error'
  );
});
