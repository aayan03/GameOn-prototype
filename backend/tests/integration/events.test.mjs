/**
 * Sports events — marathons, tournaments, morning parties.
 *
 * The part that actually needs proving is capacity. A place at an event is a
 * scarce resource claimed by strangers at the same moment, which is the same
 * shape as a booking slot and a TeamUp spot — both of which were racy in this
 * codebase before somebody wrote a test like this one.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase,
  get, post, patch, del, createUser, createVenue, setVerified,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

const soon = (hours = 72) => new Date(Date.now() + hours * 3600_000).toISOString();

/** A verified owner publishes immediately; an unverified one is reviewed. */
async function organiser({ verified = true } = {}) {
  const user = await createUser({ role: 'owner' });
  if (verified) await setVerified(user.id, true);
  return user;
}

async function createEvent(host, overrides = {}) {
  const res = await post('/api/events', {
    title: overrides.title || 'Sunday Sunrise 10K',
    type: overrides.type || 'marathon',
    startsAt: overrides.startsAt || soon(),
    capacity: overrides.capacity,
    ...overrides.rest,
  }, { token: host.token });
  if (res.status !== 201) throw new Error(`createEvent failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.event;
}

/* ── Discovery ───────────────────────────────────────────────── */

test('the events feed is public', async () => {
  const host = await organiser();
  await createEvent(host);

  const res = await get('/api/events');
  assert.equal(res.status, 200, 'no token required');
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].title, 'Sunday Sunrise 10K');
});

test('an unverified organiser is reviewed before going live', async () => {
  const host = await organiser({ verified: false });
  const event = await createEvent(host);

  // Same rule as venue listings: anyone can register as an owner, so an
  // unvetted account does not get to publish straight to discovery.
  assert.equal((await get('/api/events')).body.data.length, 0, 'not public yet');

  // But the organiser can still see their own submission.
  const mine = await get('/api/events?mine=hosting', { token: host.token });
  assert.equal(mine.body.data.length, 1);
  assert.equal(mine.body.data[0].moderationStatus, 'pending');

  const admin = await createUser({ role: 'player' });
  await mongoose.model('User').updateOne({ _id: admin.id }, { $set: { role: 'admin' } });
  const relogin = await post('/api/auth/login', { email: admin.email, password: admin.password });

  const approved = await patch(`/api/events/${event._id}/moderate`,
    { decision: 'approve' }, { token: relogin.body.data.accessToken });
  assert.equal(approved.status, 200);
  assert.equal((await get('/api/events')).body.data.length, 1, 'live after approval');
});

test('past events drop out of the public feed', async () => {
  const host = await organiser();
  const event = await createEvent(host);
  await mongoose.model('Event').updateOne(
    { _id: event._id }, { $set: { startsAt: new Date(Date.now() - 3600_000) } },
  );
  assert.equal((await get('/api/events')).body.data.length, 0);
});

test('filters narrow by type and city', async () => {
  const host = await organiser();
  await createEvent(host, { title: 'Bengaluru Half Marathon', type: 'marathon', rest: { location: { city: 'Bengaluru' } } });
  await createEvent(host, { title: 'Turf Cup Knockouts', type: 'tournament', rest: { location: { city: 'Mumbai' } } });

  assert.equal((await get('/api/events?type=marathon')).body.data.length, 1);
  assert.equal((await get('/api/events?type=tournament')).body.data.length, 1);
  assert.equal((await get('/api/events?city=Mumbai')).body.data.length, 1);
  assert.equal((await get('/api/events?q=knockouts')).body.data.length, 1);
});

/* ── Capacity is the whole game ──────────────────────────────── */

test('a full event refuses the next person', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 1 });

  const a = await createUser({ role: 'player' });
  const b = await createUser({ role: 'player' });

  assert.equal((await post(`/api/events/${event._id}/register`, {}, { token: a.token })).status, 201);
  const second = await post(`/api/events/${event._id}/register`, {}, { token: b.token });
  assert.equal(second.status, 409);
  assert.match(second.body.error.message, /full/i);
});

test('concurrent registrations cannot oversubscribe', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 3 });

  const players = await Promise.all(
    Array.from({ length: 8 }, () => createUser({ role: 'player' })),
  );

  // Eight people hit Register on the same three places at once. The check has
  // to live inside the update, or they all read "room for 3" and all get in.
  const results = await Promise.all(
    players.map((p) => post(`/api/events/${event._id}/register`, {}, { token: p.token })),
  );

  const accepted = results.filter((r) => r.status === 201).length;
  assert.equal(accepted, 3, `exactly three places exist, ${accepted} were handed out`);

  const fresh = await mongoose.model('Event').findById(event._id).lean();
  assert.equal(fresh.registeredCount, 3, 'the counter matches reality');

  const going = await mongoose.model('EventRegistration')
    .countDocuments({ event: event._id, status: 'going' });
  assert.equal(going, 3, 'and so does the registration ledger');
});

test('a multi-seat registration is all-or-nothing', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 3 });
  const a = await createUser({ role: 'player' });
  const b = await createUser({ role: 'player' });

  assert.equal((await post(`/api/events/${event._id}/register`, { seats: 2 }, { token: a.token })).status, 201);

  // Only one place left, so a request for two takes none of them rather than
  // squeezing in a partial group.
  const greedy = await post(`/api/events/${event._id}/register`, { seats: 2 }, { token: b.token });
  assert.equal(greedy.status, 409);
  assert.equal((await mongoose.model('Event').findById(event._id).lean()).registeredCount, 2);

  assert.equal((await post(`/api/events/${event._id}/register`, { seats: 1 }, { token: b.token })).status, 201);
});

test('capacity 0 means unlimited', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 0 });
  for (let i = 0; i < 5; i++) {
    const p = await createUser({ role: 'player' });
    assert.equal((await post(`/api/events/${event._id}/register`, {}, { token: p.token })).status, 201);
  }
  const fresh = await mongoose.model('Event').findById(event._id).lean();
  assert.equal(fresh.registeredCount, 5);
});

test('registering twice takes one place, not two', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 10 });
  const p = await createUser({ role: 'player' });

  assert.equal((await post(`/api/events/${event._id}/register`, {}, { token: p.token })).status, 201);
  const again = await post(`/api/events/${event._id}/register`, {}, { token: p.token });
  assert.equal(again.status, 409);

  // The seat claimed by the second attempt has to be handed back, or a
  // double-tap silently eats a place nobody holds.
  assert.equal((await mongoose.model('Event').findById(event._id).lean()).registeredCount, 1);
});

test('two simultaneous registrations from one account take one place', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 10 });
  const p = await createUser({ role: 'player' });

  const [a, b] = await Promise.all([
    post(`/api/events/${event._id}/register`, {}, { token: p.token }),
    post(`/api/events/${event._id}/register`, {}, { token: p.token }),
  ]);
  assert.equal([a, b].filter((r) => r.status === 201).length, 1, 'one wins');
  assert.equal((await mongoose.model('Event').findById(event._id).lean()).registeredCount, 1);
});

/* ── Cancelling ──────────────────────────────────────────────── */

test('cancelling releases the place', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 1 });
  const a = await createUser({ role: 'player' });
  const b = await createUser({ role: 'player' });

  await post(`/api/events/${event._id}/register`, {}, { token: a.token });
  assert.equal((await post(`/api/events/${event._id}/register`, {}, { token: b.token })).status, 409);

  assert.equal((await del(`/api/events/${event._id}/register`, { token: a.token })).status, 200);
  assert.equal((await post(`/api/events/${event._id}/register`, {}, { token: b.token })).status, 201,
    'the freed place is usable');
});

test('cancelling twice releases one place', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 5 });
  const p = await createUser({ role: 'player' });
  await post(`/api/events/${event._id}/register`, { seats: 2 }, { token: p.token });

  const [a, b] = await Promise.all([
    del(`/api/events/${event._id}/register`, { token: p.token }),
    del(`/api/events/${event._id}/register`, { token: p.token }),
  ]);
  assert.equal([a, b].filter((r) => r.status === 200).length, 1);
  assert.equal((await mongoose.model('Event').findById(event._id).lean()).registeredCount, 0);
});

test('someone who cancelled can register again', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 5 });
  const p = await createUser({ role: 'player' });

  await post(`/api/events/${event._id}/register`, {}, { token: p.token });
  await del(`/api/events/${event._id}/register`, { token: p.token });
  // The unique (event, user) index has to survive this — the row is flipped
  // to `cancelled`, not deleted.
  assert.equal((await post(`/api/events/${event._id}/register`, {}, { token: p.token })).status, 201);
  assert.equal((await mongoose.model('Event').findById(event._id).lean()).registeredCount, 1);
});

/* ── Rules around registering ────────────────────────────────── */

test('you cannot register for your own event', async () => {
  const host = await organiser();
  const event = await createEvent(host);
  const res = await post(`/api/events/${event._id}/register`, {}, { token: host.token });
  assert.equal(res.status, 400);
});

test('you cannot register for an event that has started', async () => {
  const host = await organiser();
  const event = await createEvent(host);
  await mongoose.model('Event').updateOne(
    { _id: event._id }, { $set: { startsAt: new Date(Date.now() - 60_000) } },
  );
  const p = await createUser({ role: 'player' });
  assert.equal((await post(`/api/events/${event._id}/register`, {}, { token: p.token })).status, 400);
});

test('you cannot register for an unapproved event', async () => {
  const host = await organiser({ verified: false });
  const event = await createEvent(host);
  const p = await createUser({ role: 'player' });
  const res = await post(`/api/events/${event._id}/register`, {}, { token: p.token });
  assert.equal(res.status, 400);
});

test('cancelling an event tells everyone who signed up', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 10 });
  const a = await createUser({ role: 'player' });
  const b = await createUser({ role: 'player' });
  await post(`/api/events/${event._id}/register`, {}, { token: a.token });
  await post(`/api/events/${event._id}/register`, {}, { token: b.token });

  const res = await del(`/api/events/${event._id}`, { token: host.token, body: { reason: 'Rain' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.notified, 2);

  // Deleted would leave two people with a date and no way to learn it is off.
  const fresh = await mongoose.model('Event').findById(event._id).lean();
  assert.equal(fresh.isCancelled, true);

  const notes = await mongoose.model('Notification')
    .countDocuments({ user: { $in: [a.id, b.id] }, type: 'booking_cancelled' });
  assert.equal(notes, 2);

  // And it still shows up for them, so they find out.
  const going = await get('/api/events?mine=going', { token: a.token });
  assert.equal(going.body.data.length, 1);
  assert.equal(going.body.data[0].isCancelled, true);
});

/* ── Authorisation ───────────────────────────────────────────── */

test('a player cannot create an event', async () => {
  const p = await createUser({ role: 'player' });
  const res = await post('/api/events', {
    title: 'My Unauthorised Fun Run', type: 'marathon', startsAt: soon(),
  }, { token: p.token });
  assert.equal(res.status, 403);
});

test('an organiser cannot edit or cancel somebody else’s event', async () => {
  const mine = await organiser();
  const theirs = await organiser();
  const event = await createEvent(mine);

  assert.equal((await patch(`/api/events/${event._id}`, { title: 'Hijacked Event' }, { token: theirs.token })).status, 403);
  assert.equal((await del(`/api/events/${event._id}`, { token: theirs.token })).status, 403);
});

test('an event cannot be attached to a venue you do not own', async () => {
  const a = await organiser();
  const b = await organiser();
  const venue = await createVenue(a);

  const res = await post('/api/events', {
    title: 'Party At Their Venue', type: 'party', startsAt: soon(), venueId: venue._id,
  }, { token: b.token });
  assert.equal(res.status, 403);
});

test('only the organiser sees the attendee list', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 5 });
  const p = await createUser({ role: 'player' });
  await post(`/api/events/${event._id}/register`, { note: 'Large t-shirt' }, { token: p.token });

  const stranger = await organiser();
  assert.equal((await get(`/api/events/${event._id}/attendees`, { token: stranger.token })).status, 403);
  assert.equal((await get(`/api/events/${event._id}/attendees`, { token: p.token })).status, 403);

  const list = await get(`/api/events/${event._id}/attendees`, { token: host.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.attendees[0].note, 'Large t-shirt');
});

test('the public event page does not leak the moderation trail', async () => {
  const host = await organiser();
  const event = await createEvent(host);
  const res = await get(`/api/events/${event.slug}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.moderationNote, undefined);
  assert.equal(res.body.data.moderatedBy, undefined);
});

/* ── Editing ─────────────────────────────────────────────────── */

test('capacity cannot be cut below the people already registered', async () => {
  const host = await organiser();
  const event = await createEvent(host, { capacity: 10 });
  for (let i = 0; i < 3; i++) {
    const p = await createUser({ role: 'player' });
    await post(`/api/events/${event._id}/register`, {}, { token: p.token });
  }

  // Shrinking below three would leave the event permanently over-subscribed,
  // and someone would have to be un-invited by a side effect.
  const shrink = await patch(`/api/events/${event._id}`, { capacity: 2 }, { token: host.token });
  assert.equal(shrink.status, 400);
  assert.match(shrink.body.error.message, /already registered/i);

  assert.equal((await patch(`/api/events/${event._id}`, { capacity: 3 }, { token: host.token })).status, 200);
});

test('an event in the past is refused at creation', async () => {
  const host = await organiser();
  const res = await post('/api/events', {
    title: 'Last Year Marathon', type: 'marathon',
    startsAt: new Date(Date.now() - 86400_000).toISOString(),
  }, { token: host.token });
  assert.equal(res.status, 400);
});

test('an end time before the start is refused', async () => {
  const host = await organiser();
  const res = await post('/api/events', {
    title: 'Time Travelling Fun Run', type: 'marathon',
    startsAt: soon(48), endsAt: soon(24),
  }, { token: host.token });
  assert.equal(res.status, 400);
});

test('a client-supplied price is ignored', async () => {
  const host = await organiser();
  // Paid ticketing is not built. An event that claims a price nobody collects
  // is the exact class of lie this codebase keeps removing.
  const res = await post('/api/events', {
    title: 'Definitely Free Event', type: 'party', startsAt: soon(), price: 500,
  }, { token: host.token });
  assert.equal(res.status, 400, 'unknown keys are rejected by the strict schema');
});
