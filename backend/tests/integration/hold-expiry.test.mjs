/**
 * Checkout holds, and letting them go.
 *
 * An instant venue paid by gateway is written PENDING with the slot locked
 * and nothing paid, then the player is sent to Razorpay. Close that tab and
 * the row used to stay exactly as it was — the existing sweep only looks at
 * bookings starting within two hours, so an abandoned checkout for next
 * Saturday held that pitch for a week.
 *
 * The dangerous half is the race the timeout creates: the hold expires while
 * the player is still on the payment page, and the money is captured a moment
 * later. That must end in a refund, not an error with the money kept.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, resetDatabase, createUser, setVerified,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

/** A gateway checkout that was started and never finished. */
async function unpaidHold({ minutesAgo = 15, mode = 'automated', method = 'gateway' } = {}) {
  const { Booking, Venue, User } = await import('../../src/models/index.js');
  const owner = await createUser({ role: 'owner', email: `o${Math.random()}@test.local` });
  await setVerified(owner.id);
  const player = await createUser({ email: `p${Math.random()}@test.local` });

  const venue = await Venue.create({
    name: 'Hold Turf', owner: owner.id, sports: ['football'],
    courts: [{ name: 'A', sport: 'football', pricePerHour: 900, capacity: 10 }],
    address: { line1: '1 Rd', area: 'Koramangala', city: 'Bengaluru', pincode: '560034' },
    location: { type: 'Point', coordinates: [77.6, 12.93] },
    openingHours: Array.from({ length: 7 }, (_, day) => ({ day, open: '06:00', close: '23:00', isClosed: false })),
    bookingMode: mode, moderationStatus: 'approved', isActive: true,
  });

  // Far enough ahead that the existing two-hour sweep cannot claim it — this
  // is the case that used to be held indefinitely.
  const starts = new Date(Date.now() + 6 * 864e5);
  const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000);

  const booking = await Booking.create({
    user: player.id, venue: venue._id, court: venue.courts[0]._id,
    sport: 'football', mode,
    date: starts.toISOString().slice(0, 10),
    startMinutes: 600, endMinutes: 660,
    startsAt: starts, endsAt: new Date(starts.getTime() + 36e5),
    amount: 900, totalAmount: 927,
    status: 'pending', slotLocked: true,
    payment: { method, status: 'unpaid', orderId: 'order_test123' },
    groupRef: `grp_${Math.random().toString(36).slice(2, 10)}`,
  });
  /**
   * Straight to the driver: Mongoose marks `createdAt` immutable when
   * `timestamps` is on, so a normal updateOne drops this silently and every
   * fixture stays zero minutes old.
   */
  await Booking.collection.updateOne({ _id: booking._id }, { $set: { createdAt } });

  return { booking, player, venue, User };
}

const runLifecycle = async () => {
  const { runLifecycle: run } = await import('../../src/services/lifecycle.service.js');
  return run();
};

/* ── Releasing the slot ───────────────────────────────────────── */

test('an unpaid gateway hold older than ten minutes is released', async () => {
  const { booking } = await unpaidHold({ minutesAgo: 15 });
  const { Booking } = await import('../../src/models/index.js');

  const res = await runLifecycle();
  assert.equal(res.holdsReleased, 1);

  const after = await Booking.findById(booking._id).lean();
  assert.equal(after.status, 'expired');
  assert.equal(after.slotLocked, false, 'the slot goes back to the venue');
});

test('a hold inside the ten minutes is left alone', async () => {
  const { booking } = await unpaidHold({ minutesAgo: 4 });
  const { Booking } = await import('../../src/models/index.js');

  const res = await runLifecycle();
  assert.equal(res.holdsReleased || 0, 0);
  assert.equal((await Booking.findById(booking._id).lean()).status, 'pending');
});

test('the released slot can be booked by somebody else', async () => {
  // The whole point: the unique index keys off slotLocked, so until it is
  // cleared nobody else can take that court at that time.
  const { booking } = await unpaidHold({ minutesAgo: 15 });
  const { Booking } = await import('../../src/models/index.js');
  await runLifecycle();

  const held = await Booking.findById(booking._id).lean();
  const other = await createUser({ email: 'other@test.local' });
  const second = await Booking.create({
    user: other.id, venue: held.venue, court: held.court,
    sport: 'football', mode: 'automated',
    date: held.date, startMinutes: held.startMinutes, endMinutes: held.endMinutes,
    startsAt: held.startsAt, endsAt: held.endsAt,
    amount: 900, totalAmount: 927, status: 'confirmed', slotLocked: true,
  });
  assert.ok(second._id, 'the same slot is bookable again');
});

test('the player is told, and told nothing was charged', async () => {
  const { booking } = await unpaidHold({ minutesAgo: 15 });
  await runLifecycle();

  const { Notification } = await import('../../src/models/index.js');
  const n = await Notification.findOne({ user: booking.user }).sort({ createdAt: -1 }).lean();
  assert.match(n.body, /not completed in time/i);
  assert.match(n.body, /Nothing was charged/i);
});

/* ── What must NOT be swept ───────────────────────────────────── */

test('a manual venue awaiting the owner is not touched', async () => {
  // Those sit pending because a human has not answered, which needs hours.
  const { booking } = await unpaidHold({ minutesAgo: 60, mode: 'manual' });
  const { Booking } = await import('../../src/models/index.js');

  const res = await runLifecycle();
  assert.equal(res.holdsReleased || 0, 0);
  assert.equal((await Booking.findById(booking._id).lean()).status, 'pending');
});

test('a wallet booking is not swept as an abandoned checkout', async () => {
  const { booking } = await unpaidHold({ minutesAgo: 60, method: 'wallet' });
  const { Booking } = await import('../../src/models/index.js');

  await runLifecycle();
  assert.equal((await Booking.findById(booking._id).lean()).status, 'pending');
});

test('a hold that got paid in the meantime is not expired', async () => {
  // The write is conditional on still being unpaid, so a payment landing
  // between the read and the write wins the race.
  const { booking } = await unpaidHold({ minutesAgo: 20 });
  const { Booking } = await import('../../src/models/index.js');
  await Booking.updateOne({ _id: booking._id }, { $set: { 'payment.status': 'paid' } });

  await runLifecycle();
  const after = await Booking.findById(booking._id).lean();
  assert.equal(after.status, 'pending', 'a paid booking survives the sweep');
  assert.equal(after.slotLocked, true);
});

test('sweeping twice releases nothing the second time', async () => {
  await unpaidHold({ minutesAgo: 15 });
  assert.equal((await runLifecycle()).holdsReleased, 1);
  assert.equal((await runLifecycle()).holdsReleased || 0, 0);
});
