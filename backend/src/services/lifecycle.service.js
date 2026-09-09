import { randomUUID } from 'node:crypto';
import { Booking, TeamUpPost, User, Venue, Review } from '../models/index.js';
import { BOOKING_STATUS, BOOKING_MODES } from '../config/constants.js';
import * as notify from './notification.service.js';
import * as refunds from './refund.service.js';
import * as loyalty from './loyalty.service.js';
import logger from '../utils/logger.js';

/**
 * Scheduled housekeeping.
 *
 * This closes three gaps that were live through Phases 2–4:
 *
 *  1. Nothing ever set `COMPLETED`. Every query that filtered on it — promo
 *     first-booking checks, payouts, revenue — was quietly working off
 *     `CONFIRMED` alone, and `gamesPlayed` never moved.
 *  2. A manual venue that never answered left a booking `pending` forever,
 *     holding the slot and blocking anyone else from taking it.
 *  3. `reliabilityScore` existed on the user model and nothing ever changed
 *     it, so the number TeamUp shows people was decorative.
 *
 * Every step is idempotent, so running it twice is harmless. It runs on an
 * interval in-process and can also be triggered from the admin API.
 */

/** How recently a game must have ended for a review prompt to still be welcome. */
const REVIEW_PROMPT_WINDOW_MS = 48 * 3600 * 1000;

/**
 * Bookings whose end time has passed become COMPLETED.
 *
 * Claim first, read second. Finding rows and then updating them meant two API
 * instances could each see the same booking as unfinished, and each increment
 * `gamesPlayed` and each send a review prompt. Stamping a run id inside the
 * same update makes the database pick a winner, and reading back by that id
 * returns exactly the rows this run owns.
 */
const COMPLETE_BATCH = 500;

async function completeFinishedBookings(now, runId) {
  // Bounded. `updateMany` takes no limit, so pick the batch by id first — the
  // first run against an existing database would otherwise complete every
  // booking ever made in one statement and load them all into memory.
  const batch = await Booking.find({ status: BOOKING_STATUS.CONFIRMED, endsAt: { $lte: now } })
    .select('_id')
    .sort({ endsAt: 1 })
    .limit(COMPLETE_BATCH)
    .lean();
  if (!batch.length) return { completed: 0, players: 0 };

  const claim = await Booking.updateMany(
    {
      _id: { $in: batch.map((b) => b._id) },
      status: BOOKING_STATUS.CONFIRMED,          // still conditional: another
    },                                           // instance may have taken it
    { $set: { status: BOOKING_STATUS.COMPLETED, slotLocked: false, lifecycleRun: runId } }
  );
  if (!claim.modifiedCount) return { completed: 0, players: 0 };

  const finished = await Booking.find({ lifecycleRun: runId })
    .select('_id user groupRef venue endsAt')
    .lean();
  if (!finished.length) return { completed: 0, players: 0 };

  // One game played per booking group, not per slot — a 3-hour booking is
  // still one game.
  const groups = new Map();
  for (const b of finished) {
    const key = `${b.user}-${b.groupRef}`;
    if (!groups.has(key)) groups.set(key, b);
  }

  const perUser = new Map();
  for (const b of groups.values()) {
    perUser.set(String(b.user), (perUser.get(String(b.user)) || 0) + 1);
  }

  await Promise.all(
    [...perUser].map(([userId, count]) =>
      User.updateOne({ _id: userId }, { $inc: { gamesPlayed: count } })
    )
  );

  // Ask for a review — but only for games that finished recently. On the first
  // run against an existing database every past booking completes at once, and
  // without this window every user would be handed a wall of review prompts
  // for games they played months ago.
  const fresh = [...groups.values()].filter(
    (b) => now.getTime() - new Date(b.endsAt).getTime() <= REVIEW_PROMPT_WINDOW_MS
  );

  // Wrapped: a failure fetching venues or reviews must not abort the step.
  // Everything durable (status, gamesPlayed) is already written by this
  // point, and an aborted step cannot be retried — the rows are no longer
  // CONFIRMED, so no later run would ever select them again.
  try {
  if (fresh.length) {
    // Two batched queries instead of two per booking.
    const venueIds = [...new Set(fresh.map((b) => String(b.venue)))];
    const venues = await Venue.find({ _id: { $in: venueIds } }).select('name').lean();
    const venueName = new Map(venues.map((v) => [String(v._id), v.name]));

    const existing = await Review.find({
      user: { $in: [...new Set(fresh.map((b) => String(b.user)))] },
      venue: { $in: venueIds },
    }).select('user venue').lean();
    const reviewed = new Set(existing.map((r) => `${r.user}-${r.venue}`));

    for (const b of fresh) {
      if (reviewed.has(`${b.user}-${b.venue}`)) continue;
      const name = venueName.get(String(b.venue));
      if (!name) continue;
      await notify.notify(b.user, 'review_request', {
        body: `How was your game at ${name}? A quick rating helps other players.`,
        link: `/bookings/${b.groupRef}`,
      });
    }
  }

  } catch (err) {
    logger.error('lifecycle: review prompts failed', { err });
  }

  // Release the claim so the marker never accumulates across runs.
  await Booking.updateMany({ lifecycleRun: runId }, { $set: { lifecycleRun: '' } });

  return { completed: finished.length, players: perUser.size };
}

/**
 * A manual venue that never responded should not hold a slot indefinitely.
 * Expire the request and release the slot.
 *
 * Two rules keep this from doing damage:
 *
 *  - A request must have had a fair chance. Expiring purely on "starts within
 *    two hours" killed same-evening bookings within minutes of being made —
 *    someone booking a 7pm pitch at 6pm had the request cancelled by the next
 *    lifecycle tick, before the owner's phone had finished buzzing.
 *  - Some manual bookings are paid up front. Flipping those to EXPIRED while
 *    saying "nothing was charged" stranded real money, with no refund and no
 *    record that one was owed. Anything with `amountPaid > 0` is refunded in
 *    full — the venue failed to answer, so no policy deduction applies.
 */
const MIN_REQUEST_AGE_MS = 45 * 60 * 1000;

/**
 * How long a checkout may hold a slot.
 *
 * An INSTANT venue paid by gateway is written PENDING with `slotLocked: true`
 * and `payment.status: 'unpaid'`, then the player is sent to Razorpay. Close
 * that tab and the row stayed exactly as it was — expireStaleRequests only
 * looks at bookings starting within two hours, so an abandoned checkout for
 * next Saturday held that pitch for a week and nobody else could book it.
 *
 * Ten minutes is generous for a card payment and short enough that a slot is
 * not lost for an evening. It is NOT applied to manual venues: those sit
 * pending because an owner has not answered yet, which is a different thing
 * and needs hours, not minutes.
 */
const HOLD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Release slots held by a checkout nobody finished.
 *
 * Nothing is refunded here because nothing was paid — `payment.status` is
 * part of the filter. If a payment DOES land after this runs, the verify
 * endpoint refunds it rather than failing with the money captured; see
 * payment.controller.
 */
async function expireUnpaidHolds(now) {
  const cutoff = new Date(now.getTime() - HOLD_TIMEOUT_MS);

  const stale = await Booking.find({
    status: BOOKING_STATUS.PENDING,
    mode: BOOKING_MODES.AUTOMATED,
    'payment.status': 'unpaid',
    'payment.method': 'gateway',
    slotLocked: true,
    createdAt: { $lte: cutoff },
  })
    .select('_id user groupRef bookingRef venue')
    .limit(500)
    .lean();

  if (!stale.length) return { holdsReleased: 0 };

  const groups = [...new Set(stale.map((b) => b.groupRef))];
  let released = 0;

  for (const groupRef of groups) {
    /**
     * Conditional on the status AND on still being unpaid, so a payment that
     * landed between the read above and this write wins. Losing that race
     * would cancel a booking somebody had just successfully paid for.
     */
    const result = await Booking.updateMany(
      {
        groupRef,
        status: BOOKING_STATUS.PENDING,
        'payment.status': 'unpaid',
      },
      { $set: { status: BOOKING_STATUS.EXPIRED, slotLocked: false } }
    );
    if (!result.modifiedCount) continue;
    released += result.modifiedCount;

    const first = stale.find((b) => b.groupRef === groupRef);
    await notify.notify(first.user, 'booking_cancelled', {
      title: 'Your slot was released',
      body: 'The payment was not completed in time, so the slot has gone back to '
        + 'the venue. Nothing was charged — book again if it is still free.',
      link: '/bookings',
    }).catch(() => {});
  }

  return { holdsReleased: released };
}

/**
 * How long before kickoff an unsettled cash booking gives the slot back.
 *
 * Cash at the gate is the one method where a booking can sit confirmed with
 * nothing paid, indefinitely — `expireUnpaidHolds` above only ever looked at
 * abandoned gateway checkouts, so these were never released at all. That made
 * a free, permanent hold on any court: book every slot at every venue as
 * pay-at-venue and the catalogue reads as sold out while no money has moved.
 *
 * An hour is late enough that a genuine player who intends to pay at the gate
 * keeps their slot right up to the point they would be setting off, and early
 * enough that a released slot can still be taken by somebody else.
 */
const GATE_CASH_GRACE_MS = 60 * 60 * 1000;

/**
 * Release cash bookings nobody settled, shortly before they were due to play.
 *
 * Deliberately NOT scoped to a booking mode. Automated venues write these
 * CONFIRMED and manual venues leave them PENDING, and both hold the slot the
 * same way — filtering on mode is how the original hold reaper missed this
 * entire class in the first place.
 *
 * Nothing is refunded, because `payment.status: 'unpaid'` is in the filter. A
 * booking the owner already settled has moved to 'paid' and is never matched.
 */
async function expireUnsettledGateCash(now) {
  const cutoff = new Date(now.getTime() + GATE_CASH_GRACE_MS);

  const stale = await Booking.find({
    status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED] },
    'payment.method': 'pay_at_venue',
    'payment.status': 'unpaid',
    slotLocked: true,
    startsAt: { $lte: cutoff },
  })
    .select('_id user groupRef venue')
    .limit(500)
    .lean();

  if (!stale.length) return { gateCashReleased: 0 };

  const groups = [...new Set(stale.map((b) => b.groupRef))];
  let released = 0;

  for (const groupRef of groups) {
    // Conditional on still being unpaid, so an owner tapping Settle in the
    // same moment wins and their customer keeps the slot.
    const result = await Booking.updateMany(
      {
        groupRef,
        status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED] },
        'payment.status': 'unpaid',
      },
      { $set: { status: BOOKING_STATUS.EXPIRED, slotLocked: false } }
    );
    if (!result.modifiedCount) continue;
    released += result.modifiedCount;

    const first = stale.find((b) => b.groupRef === groupRef);
    const venue = await Venue.findById(first.venue).select('name').lean();
    await notify.notify(first.user, 'booking_cancelled', {
      title: 'Your slot was released',
      body: `${venue?.name || 'The venue'} had not recorded your payment, so the slot has gone `
        + 'back to them. Nothing was charged. Book again if it is still free, or pay online next time.',
      link: '/bookings',
    }).catch(() => {});
  }

  return { gateCashReleased: released };
}

async function expireStaleRequests(now) {
  const cutoff = new Date(now.getTime() + 2 * 3600 * 1000);
  const oldEnough = new Date(now.getTime() - MIN_REQUEST_AGE_MS);

  const stale = await Booking.find({
    status: BOOKING_STATUS.PENDING,
    // Manual venues only. An automated venue confirms instantly and never had
    // a request to answer, so expiring one here told the player "Venue did
    // not confirm in time" about a venue that was never asked. Those are
    // handled by the two sweeps above, which name the real reason.
    mode: BOOKING_MODES.MANUAL,
    startsAt: { $lte: cutoff },
    createdAt: { $lte: oldEnough },
  })
    .select('_id user groupRef venue payment pointsAwarded bookingRef')
    .limit(500)
    .lean();

  if (!stale.length) return { expired: 0, refunded: 0 };

  // Group first, then flip each group with its own conditional update. One
  // bulk updateMany could expire a request the owner confirmed a millisecond
  // ago, and gave no way to tell which groups this run actually claimed — so
  // a second instance of the job would refund the same money again.
  const groups = new Map();
  for (const b of stale) {
    if (!groups.has(b.groupRef)) groups.set(b.groupRef, []);
    groups.get(b.groupRef).push(b);
  }

  let expired = 0;
  let refunded = 0;

  for (const [groupRef, rows] of groups) {
    const flip = await Booking.updateMany(
      { groupRef, status: BOOKING_STATUS.PENDING },
      {
        $set: {
          status: BOOKING_STATUS.EXPIRED,
          slotLocked: false,
          'cancellation.cancelledAt': now,
          'cancellation.reason': 'Venue did not confirm in time',
        },
      }
    );
    // Someone else got there first — the owner confirming, the player
    // cancelling, another instance of this job. Touch no money.
    if (!flip.modifiedCount) continue;
    expired += 1;

    // Re-read the WHOLE group after the flip. `stale` only held the rows whose
    // own start time fell inside the two-hour window, but the flip expires
    // every pending row of the group — so an 8–11pm request seen at 6:30pm
    // had its refund computed from two of its three slots.
    const all = await Booking.find({ groupRef, status: BOOKING_STATUS.EXPIRED })
      .select('_id user payment pointsAwarded bookingRef venue')
      .lean();
    const group = all.length ? all : rows;

    const paid = group.reduce((sum, b) => sum + (b.payment?.amountPaid || 0), 0);
    const venue = await Venue.findById(rows[0].venue).select('name').lean();

    let issued = { refunded: 0, method: 'none' };
    if (paid > 0) {
      // Through the shared refund service, so a card payment goes back to the
      // card here too. The service claims the refund on the document before
      // moving anything, which is also what stops this job — which can run on
      // several instances at once — paying the same expiry twice.
      const player = await User.findById(rows[0].user);
      issued = await refunds.issueRefund({
        groupRef,
        rows: group,
        amount: paid,
        user: player,
        description: `Refund — ${venue?.name || 'venue'} did not confirm`,
        reference: rows[0].bookingRef || '',
      });
      refunded += issued.refunded;
    }

    // A pending booking should never have earned points, but if any path ever
    // awards them before confirmation, do not leave them banked against a
    // game that never happened.
    const earned = group.reduce((sum, b) => sum + (b.pointsAwarded || 0), 0);
    if (earned > 0) {
      await loyalty.revoke(rows[0].user, earned, { reason: 'Request expired' });
      await Booking.updateMany({ groupRef }, { $set: { pointsAwarded: 0 } });
    }

    await notify.notify(rows[0].user, 'booking_rejected', {
      title: 'Request expired',
      body: issued.refunded > 0
        ? `${venue?.name || 'The venue'} did not confirm in time. Your slot was released and ₹${issued.refunded} is `
          + `${issued.method === 'gateway' ? 'on its way back to the card or UPI account you paid with' : 'back in your wallet'}.`
        : `${venue?.name || 'The venue'} did not confirm in time, so your slot was released. Nothing was charged.`,
      link: '/bookings',
    });
  }

  return { expired, refunded };
}

/**
 * Reminder the evening before a confirmed game.
 *
 * `reminderSentAt` is stamped in the claiming update, before any notification
 * is sent. Sending first and stamping afterwards meant a crash — or a second
 * instance — in between sent the same reminder twice. A reminder lost to a
 * crash is a far smaller problem than one delivered three times at midnight.
 */
async function sendReminders(now, runId) {
  const from = new Date(now.getTime() + 22 * 3600 * 1000);
  const to = new Date(now.getTime() + 26 * 3600 * 1000);

  const claim = await Booking.updateMany(
    {
      status: BOOKING_STATUS.CONFIRMED,
      reminderSentAt: null,
      startsAt: { $gte: from, $lte: to },
    },
    { $set: { reminderSentAt: now, lifecycleRun: `r:${runId}` } }
  );
  if (!claim.modifiedCount) return { reminders: 0 };

  const upcoming = await Booking.find({ lifecycleRun: `r:${runId}` })
    .select('_id user groupRef venue startsAt')
    .lean();

  const byGroup = new Map();
  for (const b of upcoming) if (!byGroup.has(b.groupRef)) byGroup.set(b.groupRef, b);

  const venues = await Venue.find({
    _id: { $in: [...new Set(upcoming.map((b) => String(b.venue)))] },
  }).select('name').lean();
  const venueName = new Map(venues.map((v) => [String(v._id), v.name]));

  for (const b of byGroup.values()) {
    await notify.notify(b.user, 'booking_reminder', {
      body: `Your game at ${venueName.get(String(b.venue)) || 'the venue'} is tomorrow. Tap for your ticket.`,
      link: `/bookings/${b.groupRef}`,
    });
  }

  await Booking.updateMany({ lifecycleRun: `r:${runId}` }, { $set: { lifecycleRun: '' } });

  return { reminders: byGroup.size };
}

/**
 * Reliability. A TeamUp game that has been played counts as a kept commitment
 * for everyone who stayed in it; withdrawing after being accepted, close to
 * kickoff, counts against you.
 *
 * The score is a bounded walk rather than a ratio, so one bad week does not
 * erase a year of turning up, and a new account cannot look perfect forever.
 */
async function settleReliability(now) {
  // `expired` is in this list deliberately. The feed marks any past-kickoff
  // open post expired on every page load, which used to happen long before
  // this job ran — so the score it fed never moved for anybody. A game that
  // kicked off and was never cancelled counts, whatever the feed labelled it.
  const candidates = await TeamUpPost.find({
    status: { $in: ['open', 'filled', 'expired'] },
    playAt: { $lt: now },
    reliabilitySettled: { $ne: true },
  })
    .select('_id')
    .limit(200)
    .lean();

  if (!candidates.length) return { settled: 0 };

  let settled = 0;

  for (const { _id } of candidates) {
    // Claim the post before touching a single score. `find` then bulk-update
    // let two instances both settle the same game and each award +2.
    const post = await TeamUpPost.findOneAndUpdate(
      { _id, reliabilitySettled: { $ne: true } },
      { $set: { reliabilitySettled: true, status: 'completed' } },
      { new: false, projection: 'host confirmedPlayers joinRequests playAt' }
    ).lean();
    if (!post) continue;
    settled += 1;

    const kept = [String(post.host), ...(post.confirmedPlayers || []).map(String)];
    await Promise.all(
      [...new Set(kept)].map((userId) =>
        User.updateOne(
          { _id: userId, reliabilityScore: { $lt: 100 } },
          { $inc: { reliabilityScore: 2 } }
        )
      )
    );

    // Late withdrawals — pulled out within 12 hours of kickoff, and only by
    // someone who had actually been given a spot. Penalising a player whose
    // request the host never answered punished them for the host's silence.
    const lateCutoff = new Date(new Date(post.playAt).getTime() - 12 * 3600 * 1000);
    const bailed = (post.joinRequests || []).filter(
      (r) => r.status === 'withdrawn'
        && r.wasAccepted
        && r.respondedAt
        && new Date(r.respondedAt) > lateCutoff
    );
    await Promise.all(
      bailed.map((r) =>
        User.updateOne(
          { _id: r.user, reliabilityScore: { $gt: 0 } },
          { $inc: { reliabilityScore: -8 } }
        )
      )
    );
  }

  // Clamp, in case a concurrent update pushed a score past a bound.
  await User.updateMany({ reliabilityScore: { $gt: 100 } }, { $set: { reliabilityScore: 100 } });
  await User.updateMany({ reliabilityScore: { $lt: 0 } }, { $set: { reliabilityScore: 0 } });

  return { settled };
}

let timer = null;
let bootTimer = null;
let inFlight = null;

/**
 * Runs every step. Safe to call repeatedly, and safe to run on more than one
 * instance at once — each step claims its rows before acting on them.
 */
export async function runLifecycle() {
  // Only one pass at a time in this process. A slow run overlapping the next
  // tick meant two passes racing each other for no benefit.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const now = new Date();
    const started = Date.now();
    const runId = randomUUID();

    // Each step is isolated: one failing must not stop the others.
    const results = { runId };
    for (const [name, fn] of Object.entries({
      complete: completeFinishedBookings,
      expire: expireStaleRequests,
      holds: expireUnpaidHolds,
      gateCash: expireUnsettledGateCash,
      remind: sendReminders,
      reliability: settleReliability,
    })) {
      try {
        Object.assign(results, await fn(now, runId));
      } catch (err) {
        logger.error('lifecycle step failed', { err, step: name });
        results[`${name}Error`] = err.message;
      }
    }

    results.ms = Date.now() - started;
    return results;
  })();

  try { return await inFlight; }
  finally { inFlight = null; }
}

/** Starts the in-process scheduler. */
export function startLifecycleScheduler(intervalMinutes = 15) {
  if (timer) return timer;

  const tick = async () => {
    try {
      const r = await runLifecycle();
      if (r.completed || r.expired || r.reminders || r.settled
        || r.holdsReleased || r.gateCashReleased) {
        logger.info('lifecycle run', r);
      }
    } catch (err) {
      // A rejection from an unawaited timer callback would take the process
      // down as an unhandled rejection.
      logger.error('lifecycle tick failed', { err });
    }
  };

  // A short delay on boot so the first run does not fight startup.
  bootTimer = setTimeout(tick, 20_000);
  if (bootTimer.unref) bootTimer.unref();
  timer = setInterval(tick, intervalMinutes * 60_000);
  // Do not hold the process open on shutdown.
  if (timer.unref) timer.unref();
  return timer;
}

/**
 * Stops the scheduler and waits for any pass already running.
 *
 * Clearing the interval alone left the boot timeout armed — a shutdown inside
 * the first 20 seconds still fired a lifecycle pass at a closing database —
 * and returned while a pass was mid-refund.
 */
export async function stopLifecycleScheduler() {
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  if (timer) { clearInterval(timer); timer = null; }
  if (inFlight) { try { await inFlight; } catch { /* already logged */ } }
}
