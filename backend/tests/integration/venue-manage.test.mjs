/**
 * Editing and unlisting a venue from an owner account.
 *
 * The endpoints existed before the UI did, so most of what matters here is
 * whether they behave when a real owner drives them: can you edit one field
 * without the request being refused for an unrelated reason, and does
 * "remove" tell the truth about what it did to people who already paid.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, resetDatabase,
  get, post, patch, del, createUser, setVerified,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

const openingHours = Array.from({ length: 7 }, (_, day) => ({
  day, open: '06:00', close: '23:00', isClosed: false,
}));

async function ownerWithVenue({ verified = true, ...overrides } = {}) {
  const owner = await createUser({ role: 'owner', email: `o${Date.now()}${Math.random()}@test.local` });
  // A verified owner publishes immediately; an unverified one lands in the
  // moderation queue, which is what the permission tests below need.
  if (verified) await setVerified(owner.id);

  const res = await post('/api/venues', {
    name: 'Original Turf Name',
    lat: 12.93, lng: 77.62,
    courts: [{ name: 'Court A', sport: 'football', pricePerHour: 1000, capacity: 10 }],
    address: { line1: '1 Road', area: 'Koramangala', city: 'Bengaluru', pincode: '560034' },
    openingHours,
    ...overrides,
  }, { token: owner.token });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  // created() wraps the row alongside its message.
  return { owner, venue: res.body.data.venue };
}

/** Approves and publishes a venue the way a moderator would. */
// eslint-disable-next-line no-unused-vars
async function publish(venueId) {
  const { Venue } = await import('../../src/models/index.js');
  await Venue.findByIdAndUpdate(venueId, { moderationStatus: 'approved', isActive: true });
}

/**
 * A paid, slot-holding booking in the future.
 *
 * `slot` shifts the start time, because the unique partial index on
 * (court, date, startMinutes) is real — two fixtures at 10:00 on the same
 * court is a double booking, and the database is right to refuse it.
 */
async function bookFuture(venueId, courtId, slot = 0) {
  const { Booking } = await import('../../src/models/index.js');
  const starts = new Date(Date.now() + 3 * 864e5);
  const player = await createUser({ email: `p${Date.now()}${Math.random()}@test.local` });
  await Booking.create({
    user: player.id, venue: venueId, court: courtId,
    date: starts.toISOString().slice(0, 10),
    startMinutes: 600 + slot * 60, endMinutes: 660 + slot * 60,
    startsAt: starts, endsAt: new Date(starts.getTime() + 36e5),
    sport: 'football', mode: 'automated',
    amount: 1000, totalAmount: 1030,
    status: 'confirmed', slotLocked: true,
  });
  return player;
}

/* ── Editing ──────────────────────────────────────────────────── */

test('an owner can rename their venue', async () => {
  const { owner, venue } = await ownerWithVenue();

  const res = await patch(`/api/venues/${venue._id}`, { name: 'Renamed Turf' }, { token: owner.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, 'Renamed Turf');

  // getVenue wraps the row alongside its reviews.
  const fresh = await get(`/api/venues/${venue._id}`, { token: owner.token });
  assert.equal(fresh.body.data.venue.name, 'Renamed Turf');
});

test('an owner can edit price, address, amenities and booking mode', async () => {
  const { owner, venue } = await ownerWithVenue();

  const res = await patch(`/api/venues/${venue._id}`, {
    description: 'Now with floodlights',
    amenities: ['parking', 'washroom'],
    bookingMode: 'manual',
    manualContact: { phone: '9999000011', responseTimeMins: 20 },
    address: { line1: '2 New Road', area: 'Indiranagar', city: 'Bengaluru', pincode: '560038' },
    cancellationPolicy: { freeCancellationHours: 48, partialRefundHours: 12, partialRefundPercent: 40 },
  }, { token: owner.token });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const v = res.body.data;
  assert.equal(v.description, 'Now with floodlights');
  assert.deepEqual(v.amenities, ['parking', 'washroom']);
  assert.equal(v.bookingMode, 'manual');
  assert.equal(v.address.area, 'Indiranagar');
  assert.equal(v.cancellationPolicy.freeCancellationHours, 48);
});

test('editing one field does not require resending the courts', async () => {
  // The edit form loads everything and could easily post it all back. The
  // court list is the one array that is refused while bookings exist, so a
  // rename must not carry it along by accident.
  const { owner, venue } = await ownerWithVenue();
  await publish(venue._id);
  await bookFuture(venue._id, venue.courts[0]._id);

  const res = await patch(`/api/venues/${venue._id}`, { name: 'Renamed Despite Bookings' }, { token: owner.token });
  assert.equal(res.status, 200, 'a rename is unaffected by live bookings');
  assert.equal(res.body.data.name, 'Renamed Despite Bookings');
  assert.equal(res.body.data.courts.length, 1, 'and the courts are untouched');
});

test('replacing the courts IS refused while bookings are live', async () => {
  const { owner, venue } = await ownerWithVenue();
  await publish(venue._id);
  await bookFuture(venue._id, venue.courts[0]._id);

  const res = await patch(`/api/venues/${venue._id}`, {
    courts: [{ name: 'Court B', sport: 'cricket', pricePerHour: 1500, capacity: 12 }],
  }, { token: owner.token });

  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /upcoming booking/i);
});

test('an owner cannot edit somebody else’s venue', async () => {
  const { venue } = await ownerWithVenue();
  const intruder = await createUser({ role: 'owner', email: 'intruder@test.local' });

  const res = await patch(`/api/venues/${venue._id}`, { name: 'Hijacked' }, { token: intruder.token });
  assert.equal(res.status, 403);
});

test('an owner cannot approve or feature their own venue by editing it', async () => {
  // Unverified, so the listing starts in the queue and has something to gain.
  const { owner, venue } = await ownerWithVenue({ verified: false });

  await patch(`/api/venues/${venue._id}`, {
    moderationStatus: 'approved', isVerified: true, isFeatured: true, isActive: true,
  }, { token: owner.token });

  const { Venue } = await import('../../src/models/index.js');
  const fresh = await Venue.findById(venue._id).lean();
  assert.notEqual(fresh.moderationStatus, 'approved', 'moderation is not the owner’s to set');
  assert.equal(fresh.isVerified, false);
  assert.equal(fresh.isFeatured, false);
  assert.equal(fresh.isActive, false, 'and activation is gated on approval');
});

/* ── Unlisting ────────────────────────────────────────────────── */

test('an owner can unlist their venue, and it leaves public search', async () => {
  const { owner, venue } = await ownerWithVenue();
  await publish(venue._id);

  assert.equal((await get('/api/venues?q=Original')).body.data.length, 1);

  const res = await del(`/api/venues/${venue._id}`, { token: owner.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.deactivated, true);

  assert.equal((await get('/api/venues?q=Original')).body.data.length, 0, 'gone from search');
  assert.equal((await get(`/api/venues/${venue._id}`)).status, 404, 'and from the public page');
});

test('the owner can still see and relist an unlisted venue', async () => {
  const { owner, venue } = await ownerWithVenue();
  await publish(venue._id);
  await del(`/api/venues/${venue._id}`, { token: owner.token });

  const mine = await get('/api/venues/owner/mine', { token: owner.token });
  assert.equal(mine.body.data.length, 1, 'it did not vanish from the owner’s own list');

  const relist = await patch(`/api/venues/${venue._id}`, { isActive: true }, { token: owner.token });
  assert.equal(relist.status, 200);
  assert.equal(relist.body.data.isActive, true);
  assert.equal((await get('/api/venues?q=Original')).body.data.length, 1, 'back in search');
});

test('unlisting reports how many paid fixtures the owner still owes', async () => {
  // Unlisting is not a cancellation. Nobody is refunded and nobody is told,
  // so the owner has to be shown what they are still on the hook for.
  const { owner, venue } = await ownerWithVenue();
  await publish(venue._id);
  await bookFuture(venue._id, venue.courts[0]._id, 0);
  await bookFuture(venue._id, venue.courts[0]._id, 1);

  const res = await del(`/api/venues/${venue._id}`, { token: owner.token });
  assert.equal(res.body.data.upcomingBookings, 2);
});

test('unlisting does not cancel the bookings already made', async () => {
  const { owner, venue } = await ownerWithVenue();
  await publish(venue._id);
  const player = await bookFuture(venue._id, venue.courts[0]._id);

  await del(`/api/venues/${venue._id}`, { token: owner.token });

  // /api/bookings splits upcoming from past.
  const { upcoming } = (await get('/api/bookings', { token: player.token })).body.data;
  assert.equal(upcoming.length, 1, 'the player still has their booking');
  assert.equal(upcoming[0].status, 'confirmed');
  // This is the reason unlisting is safe: the booking carries its own copy of
  // the venue, so the player's screens do not depend on the listing being
  // publicly visible.
  assert.ok(upcoming[0].venue?.name, 'and can still see which venue it is for');
});

test('an owner cannot unlist somebody else’s venue', async () => {
  const { venue } = await ownerWithVenue();
  const intruder = await createUser({ role: 'owner', email: 'intruder2@test.local' });

  const res = await del(`/api/venues/${venue._id}`, { token: intruder.token });
  assert.equal(res.status, 403);
});

test('a signed-out visitor cannot unlist anything', async () => {
  const { venue } = await ownerWithVenue();
  assert.equal((await del(`/api/venues/${venue._id}`)).status, 401);
});

/* ── The dashboard number the UI warns with ──────────────────── */

test('the owner overview reports upcoming bookings per venue', async () => {
  const { owner, venue } = await ownerWithVenue();
  await publish(venue._id);
  await bookFuture(venue._id, venue.courts[0]._id);

  const res = await get('/api/owner/overview', { token: owner.token });
  assert.equal(res.status, 200);
  const row = res.body.data.venues.find((v) => String(v._id) === String(venue._id));
  assert.equal(row.upcomingBookings, 1);
});

test('a venue with nothing booked reports zero, not undefined', async () => {
  const { owner, venue } = await ownerWithVenue();
  await publish(venue._id);

  const res = await get('/api/owner/overview', { token: owner.token });
  const row = res.body.data.venues.find((v) => String(v._id) === String(venue._id));
  assert.equal(row.upcomingBookings, 0);
});
