import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { BOOKING_STATUS, BOOKING_MODES } from '../config/constants.js';

/**
 * One confirmed or requested slot. The unique index at the bottom is what makes
 * double-booking impossible (deck slide 2's core problem).
 */
const bookingSchema = new mongoose.Schema(
  {
    // `unique: true` builds the index by itself; adding `index: true` next to
    // it declares the same index twice and Mongoose warns about it on boot.
    bookingRef: { type: String, unique: true },

    // A multi-hour booking is stored as ONE DOCUMENT PER SLOT, all sharing a
    // groupRef. That is what lets the unique index below protect every hour
    // of the booking, not just the first one. The UI groups them back together.
    groupRef: { type: String, index: true },
    groupSize: { type: Number, default: 1 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    venue: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true },
    court: { type: mongoose.Schema.Types.ObjectId, required: true },
    courtName: { type: String, default: '' },
    sport: { type: String, required: true },

    // Stored as a plain date key + minute offsets so slot maths never fights timezones.
    date: { type: String, required: true },  // "YYYY-MM-DD"
    startMinutes: { type: Number, required: true },       // minutes from midnight, e.g. 18:30 → 1110
    endMinutes: { type: Number, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },

    mode: { type: String, enum: Object.values(BOOKING_MODES), required: true },
    status: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.PENDING,
    },

    players: { type: Number, default: 1, min: 1 },
    amount: { type: Number, required: true, min: 0 },
    platformFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    promoCode: { type: String, default: '' },
    // Which owner's promo this was, so per-user limits are scoped correctly.
    // Null means a platform code.
    promoOwner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    payment: {
      method: {
        type: String,
        enum: ['wallet', 'mock_upi', 'mock_card', 'pay_at_venue', 'gateway'],
        default: 'wallet',
      },
      orderId: { type: String, default: '' },
      status: { type: String, enum: ['unpaid', 'paid', 'refunded', 'partially_refunded', 'failed'], default: 'unpaid' },
      transactionId: { type: String, default: '' },
      paidAt: { type: Date, default: null },
      // What was ACTUALLY debited. A refund is capped by this, never by the
      // quoted total — otherwise an unpaid booking can be refunded for money
      // that was never taken.
      amountPaid: { type: Number, default: 0, min: 0 },
    },

    /**
     * The cancellation terms as they stood when this booking was made.
     *
     * `refundFor` used to read the venue's CURRENT policy at cancellation
     * time, and an owner may edit that policy whenever they like — so setting
     * `freeCancellationHours: 0` retroactively deleted the refund every
     * already-booked customer had been shown before they paid. The terms a
     * customer agreed to have to travel with the booking.
     *
     * Null on rows written before this existed; `refundFor` falls back to the
     * venue for those.
     */
    policySnapshot: {
      freeCancellationHours: { type: Number, default: null },
      partialRefundHours: { type: Number, default: null },
      partialRefundPercent: { type: Number, default: null },
    },

    cancellation: {
      cancelledAt: { type: Date, default: null },
      cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reason: { type: String, default: '' },
      refundAmount: { type: Number, default: 0 },
      refundStatus: { type: String, enum: ['none', 'pending', 'processed'], default: 'none' },
      /**
       * WHERE the money went back to, and the gateway's id for it.
       *
       * Not cosmetic: `wallet_fallback` means a card refund was attempted,
       * failed, and the customer was given wallet credit instead — a real
       * refund still has to be issued by hand from the Razorpay dashboard.
       * Without recording it, that debt is invisible.
       */
      refundMethod: {
        type: String,
        enum: ['none', 'wallet', 'gateway', 'wallet_fallback'],
        default: 'none',
      },
      refundReference: { type: String, default: '' },
    },

    // Set when this booking was created from a TeamUp post (Phase 3).
    // Mirrors `status`: true while this booking still occupies the slot.
    // A plain boolean keeps the unique partial index below portable across
    // every MongoDB version ($in inside partialFilterExpression is not).
    slotLocked: { type: Boolean, default: true },

    // Points this slot earned, so a cancellation can take back exactly what
    // was given rather than recomputing it from a price that may have changed.
    pointsAwarded: { type: Number, default: 0 },

    teamUpPost: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamUpPost', default: null },
    notes: { type: String, maxlength: 500, default: '' },
    confirmedAt: { type: Date, default: null },
    // Set once the day-before reminder has gone out, so it is sent exactly once.
    reminderSentAt: { type: Date, default: null },

    // Claim marker for the lifecycle job. The job stamps a run id in the SAME
    // update that changes status, then reads back only what it stamped — so
    // two API instances running the job at the same time cannot both act on
    // the same booking (double review prompts, double gamesPlayed, in the
    // expiry path double refunds).
    lifecycleRun: { type: String, default: '', index: true },
  },
  { timestamps: true }
);

/**
 * Every index this collection has, and nothing else.
 *
 * `user`, `venue`, `date`, `startsAt`, `status` and `promoCode` each carried a
 * field-level `index: true` as well, and every one of them was already the
 * prefix of a compound index below. A B-tree on `{user, startsAt}` answers a
 * query on `user` alone perfectly well, so the standalone `user` index was
 * doing nothing but costing a write on the hottest write path in the product —
 * a booking insert wrote nine index entries where three would do.
 *
 * Checked rather than assumed, because dropping an index on a hunch is how you
 * find out what was using it. Every real query shape in the codebase was run
 * against 20,000 rows with and without the six: no collection scans appeared,
 * and every single query examined exactly the same number of documents. Six
 * queries simply moved to the compound index that already covered them.
 *
 * If you add a query that filters on one of these fields alone AND needs a
 * different sort, measure it before adding an index back.
 */

// The double-booking guard: one court cannot hold two live bookings on the
// same date + start time. Partial index so cancelled slots free up again.
bookingSchema.index(
  { court: 1, date: 1, startMinutes: 1 },
  { unique: true, partialFilterExpression: { slotLocked: true } }
);
bookingSchema.index({ venue: 1, date: 1, status: 1 });
// GET /api/bookings — every row for one user, newest first. The single-field
// `user` index could find the rows but not order them, so Mongo sorted the
// whole set in memory on every load of the bookings screen.
bookingSchema.index({ user: 1, startsAt: -1 });
// The analytics aggregations all match on venue + a startsAt window.
bookingSchema.index({ venue: 1, startsAt: 1, status: 1 });
// The lifecycle job's two hot scans: finished-but-not-completed bookings,
// and pending requests that have gone unanswered.
bookingSchema.index({ status: 1, endsAt: 1 });
bookingSchema.index({ status: 1, startsAt: 1, createdAt: 1 });
/**
 * The Razorpay webhook's only way in.
 *
 * `payment.captured` and `payment.failed` both find the booking by the order
 * id, and there was no index on it — so every webhook delivery scanned the
 * whole collection. That gets worse in a loop rather than linearly: Razorpay
 * retries any delivery it does not get a prompt 200 from, so a slower scan
 * buys more retries, and more retries buy more scans. A payment backlog is
 * the last thing that should degrade under its own load.
 *
 * Partial rather than sparse, and the difference is not cosmetic. `sparse`
 * only skips documents where the field is ABSENT, and `orderId` defaults to
 * '' — so every wallet and pay-at-venue row carries the key and lands in the
 * index anyway. Measured over 50,000 wallet rows and 2,000 gateway ones, a
 * sparse index came out at 256 KB, exactly the same as a plain one; the
 * partial filter below came out at 40 KB. Only gateway bookings ever hold an
 * order id, and only they belong here.
 *
 * A real order id is a non-empty string, so the equality lookup the webhook
 * does is provably inside the filter and the planner uses the index for it.
 */
bookingSchema.index(
  { 'payment.orderId': 1 },
  { partialFilterExpression: { 'payment.orderId': { $gt: '' } } }
);

/**
 * The other lookup on the payment path, and the one the audit missed.
 *
 * `/payments/verify` asks twice, on both branches, whether a gateway payment id
 * has already settled a DIFFERENT booking — the guard that stops one captured
 * payment being replayed against a second slot. With nothing on
 * `payment.transactionId` the planner fell back to the `groupRef` index and the
 * `{ $ne: groupRef }` half selected almost everything: measured at 19,998 of
 * 20,000 documents examined, on a request that is holding a customer at a
 * checkout screen. With this index it examines one, for 68 KB.
 *
 * Partial for the same reason as `payment.orderId` above: the field defaults to
 * '' so `sparse` would not exclude a single wallet booking, and only gateway
 * rows ever carry a transaction id.
 */
bookingSchema.index(
  { 'payment.transactionId': 1 },
  { partialFilterExpression: { 'payment.transactionId': { $gt: '' } } }
);

// Keep slotLocked in step with status so the index frees cancelled slots.
const RELEASING = ['cancelled', 'rejected', 'expired'];
bookingSchema.pre('save', function syncSlotLock(next) {
  if (this.isModified('status')) {
    this.slotLocked = !RELEASING.includes(this.status);
  }
  next();
});

/**
 * A booking reference, unique and not guessable.
 *
 * The old form was a millisecond timestamp plus three characters of
 * `Math.random()`. Two problems, one visible and one not:
 *
 *  - Three base-36 characters is ~46,000 values, and every booking created in
 *    the same millisecond drew from that space. The unique index caught the
 *    collisions, but `createBooking` reports a duplicate-key error as "one of
 *    those slots was just booked by someone else" — so a ref clash under load
 *    told the customer their slot had gone when it had not.
 *  - `Math.random()` is not a CSPRNG and the timestamp half is public, so a
 *    reference was substantially predictable. Nothing authorises on the ref
 *    today (every lookup checks ownership), but a printed ticket that can be
 *    guessed is not a good thing to leave lying around.
 *
 * 40 bits of crypto-grade randomness, still short enough to read down a phone.
 */
function shortRef(prefix) {
  return prefix + crypto.randomBytes(5).toString('hex').toUpperCase();
}

bookingSchema.pre('validate', function makeRef(next) {
  if (!this.bookingRef) this.bookingRef = shortRef('GO');
  next();
});

export { shortRef };

export default mongoose.model('Booking', bookingSchema);
