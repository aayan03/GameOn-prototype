/**
 * The lifecycle job's batched writes.
 *
 * Two of its steps used to do their work one row at a time: a
 * `User.updateOne` per player for `gamesPlayed`, and an awaited
 * `notify.notify` per booking for review prompts and day-before reminders.
 * Both now write once for the whole pass — a `bulkWrite` and a
 * `notifyEach` — and both were completely uncovered when that changed, which
 * is the only reason this file exists.
 *
 * The assertions are about OUTCOMES, not about how many queries were issued:
 * every player's count, every notification's own body and link. A batch that
 * writes the same payload to everyone, or credits one player twice, fails
 * here.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, resetDatabase, createUser, setVerified,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

const runLifecycle = async () => {
  const { runLifecycle: run } = await import('../../src/services/lifecycle.service.js');
  return run();
};

const models = () => import('../../src/models/index.js');

let seq = 0;

/** A venue with a known name, so a notification body can be checked against it. */
async function venueNamed(name) {
  const { Venue } = await models();
  const owner = await createUser({ role: 'owner', email: `o${++seq}.${Date.now()}@test.local` });
  await setVerified(owner.id);
  return Venue.create({
    name, owner: owner.id, sports: ['football'],
    courts: [{ name: 'A', sport: 'football', pricePerHour: 900, capacity: 10 }],
    address: { line1: '1 Rd', area: 'Koramangala', city: 'Bengaluru', pincode: '560034' },
    location: { type: 'Point', coordinates: [77.6, 12.93] },
    bookingMode: 'automated', moderationStatus: 'approved', isActive: true,
  });
}

/**
 * A confirmed booking, positioned in time by the caller.
 *
 * `slots` writes that many rows sharing a groupRef, which is how a multi-hour
 * booking is stored — the completion step has to count that as ONE game.
 */
async function confirmedBooking({ venue, player, startsAt, slots = 1 }) {
  const { Booking } = await models();
  const groupRef = `grp_${++seq}_${Math.random().toString(36).slice(2, 8)}`;
  const rows = [];
  for (let s = 0; s < slots; s++) {
    rows.push({
      user: player.id, venue: venue._id, court: venue.courts[0]._id,
      sport: 'football', mode: 'automated', groupRef, groupSize: slots,
      date: startsAt.toISOString().slice(0, 10),
      startMinutes: 600 + s * 60, endMinutes: 660 + s * 60,
      startsAt: new Date(startsAt.getTime() + s * 36e5),
      endsAt: new Date(startsAt.getTime() + (s + 1) * 36e5),
      amount: 900, totalAmount: 927,
      status: 'confirmed', slotLocked: true,
      payment: { method: 'wallet', status: 'paid', amountPaid: 927 },
    });
  }
  return { groupRef, docs: await Booking.insertMany(rows) };
}

const notificationsFor = async (userId, type) => {
  const { Notification } = await models();
  return Notification.find({ user: userId, type }).lean();
};

/* ── gamesPlayed, written in one bulkWrite ────────────────────── */

test('every player gets their own games-played count from one batch', async () => {
  const { User } = await models();
  const ended = new Date(Date.now() - 3 * 36e5);   // finished three hours ago

  const players = [];
  for (let i = 0; i < 4; i++) {
    players.push(await createUser({ email: `p${++seq}.${Date.now()}@test.local` }));
  }

  /**
   * A venue per booking group, because the double-booking index is real: one
   * court cannot hold two live bookings at the same date and start minute,
   * and a fixture that puts four players on one court at 10am is refused by
   * the database rather than by the code under test.
   */
  const onItsOwnCourt = async (player, startsAt, slots = 1) =>
    confirmedBooking({ venue: await venueNamed(`Batch Turf ${++seq}`), player, startsAt, slots });

  // Player 0 played three separate games, player 1 played one three-hour
  // booking (still one game), players 2 and 3 one each.
  for (let g = 0; g < 3; g++) {
    await onItsOwnCourt(players[0], new Date(ended.getTime() - g * 12 * 36e5));
  }
  await onItsOwnCourt(players[1], ended, 3);
  await onItsOwnCourt(players[2], ended);
  await onItsOwnCourt(players[3], ended);

  const res = await runLifecycle();
  assert.equal(res.players, 4, 'all four players should have been credited');

  const counts = [];
  for (const p of players) counts.push((await User.findById(p.id).lean()).gamesPlayed);

  assert.deepEqual(
    counts, [3, 1, 1, 1],
    'a three-slot booking is one game, and three bookings are three - the batch must not '
    + 'collapse players together or count slots'
  );
});

test('a second pass does not credit the same games again', async () => {
  const { User } = await models();
  const venue = await venueNamed('Idempotent Turf');
  const player = await createUser({ email: `p${++seq}.${Date.now()}@test.local` });
  await confirmedBooking({ venue, player, startsAt: new Date(Date.now() - 3 * 36e5), slots: 2 });

  await runLifecycle();
  const first = (await User.findById(player.id).lean()).gamesPlayed;
  await runLifecycle();
  const second = (await User.findById(player.id).lean()).gamesPlayed;

  assert.equal(first, 1);
  assert.equal(second, 1, 'the rows are no longer CONFIRMED, so a re-run must find nothing');
});

/* ── Review prompts, written in one notifyEach ────────────────── */

test('each review prompt names its own venue and links to its own booking', async () => {
  const venue1 = await venueNamed('Koramangala Turf');
  const venue2 = await venueNamed('Indiranagar Arena');
  const ended = new Date(Date.now() - 2 * 36e5);   // inside the 48h prompt window

  const alice = await createUser({ email: `a${++seq}.${Date.now()}@test.local` });
  const bob = await createUser({ email: `b${++seq}.${Date.now()}@test.local` });

  const a = await confirmedBooking({ venue: venue1, player: alice, startsAt: ended });
  const b = await confirmedBooking({ venue: venue2, player: bob, startsAt: ended });

  await runLifecycle();

  const [forAlice] = await notificationsFor(alice.id, 'review_request');
  const [forBob] = await notificationsFor(bob.id, 'review_request');

  assert.ok(forAlice, 'Alice should have been asked for a review');
  assert.ok(forBob, 'Bob should have been asked for a review');

  // The whole risk of batching: one payload sent to everybody.
  assert.match(forAlice.body, /Koramangala Turf/);
  assert.match(forBob.body, /Indiranagar Arena/);
  assert.equal(forAlice.link, `/bookings/${a.groupRef}`);
  assert.equal(forBob.link, `/bookings/${b.groupRef}`);
  assert.notEqual(forAlice.body, forBob.body, 'the two prompts must not share a body');
});

test('a game finished long ago completes without a review prompt', async () => {
  const venue = await venueNamed('Stale Turf');
  const player = await createUser({ email: `p${++seq}.${Date.now()}@test.local` });
  // Outside the 48-hour window: the first run against an existing database
  // must not hand somebody a wall of prompts for last season.
  await confirmedBooking({ venue, player, startsAt: new Date(Date.now() - 30 * 864e5) });

  const res = await runLifecycle();
  assert.equal(res.completed, 1, 'it should still be marked complete');
  assert.equal((await notificationsFor(player.id, 'review_request')).length, 0);
});

/* ── Reminders, written in one notifyEach ─────────────────────── */

test('each day-before reminder names its own venue and booking', async () => {
  const { Booking } = await models();
  const venue1 = await venueNamed('Whitefield Ground');
  const venue2 = await venueNamed('Sarjapur Courts');
  // Inside the 22-26 hour reminder window.
  const tomorrow = new Date(Date.now() + 24 * 36e5);

  const alice = await createUser({ email: `a${++seq}.${Date.now()}@test.local` });
  const bob = await createUser({ email: `b${++seq}.${Date.now()}@test.local` });

  const a = await confirmedBooking({ venue: venue1, player: alice, startsAt: tomorrow });
  const b = await confirmedBooking({ venue: venue2, player: bob, startsAt: tomorrow, slots: 2 });

  const res = await runLifecycle();
  assert.equal(res.reminders, 2, 'one reminder per booking group, not per slot');

  const [forAlice] = await notificationsFor(alice.id, 'booking_reminder');
  const [forBob] = await notificationsFor(bob.id, 'booking_reminder');

  assert.match(forAlice.body, /Whitefield Ground/);
  assert.match(forBob.body, /Sarjapur Courts/);
  assert.equal(forAlice.link, `/bookings/${a.groupRef}`);
  assert.equal(forBob.link, `/bookings/${b.groupRef}`);

  // Bob's two slots share a group, so he gets exactly one reminder.
  assert.equal((await notificationsFor(bob.id, 'booking_reminder')).length, 1);

  // And the claim marker is cleared, so the next pass finds nothing.
  assert.equal((await runLifecycle()).reminders || 0, 0, 'a reminder must not go out twice');
  assert.equal(
    await Booking.countDocuments({ lifecycleRun: { $ne: '' } }), 0,
    'the run marker should be released after the pass'
  );
});
