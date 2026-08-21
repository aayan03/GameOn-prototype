import mongoose from 'mongoose';
import { BOOKING_STATUS, BOOKING_MODES } from '../config/constants.js';

/**
 * One confirmed or requested slot. The unique index at the bottom is what makes
 * double-booking impossible (deck slide 2's core problem).
 */
const bookingSchema = new mongoose.Schema(
  {
    bookingRef: { type: String, unique: true, index: true },

    // A multi-hour booking is stored as ONE DOCUMENT PER SLOT, all sharing a
    // groupRef. That is what lets the unique index below protect every hour
    // of the booking, not just the first one. The UI groups them back together.
    groupRef: { type: String, index: true },
    groupSize: { type: Number, default: 1 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    venue: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
    court: { type: mongoose.Schema.Types.ObjectId, required: true },
    courtName: { type: String, default: '' },
    sport: { type: String, required: true },

    // Stored as a plain date key + minute offsets so slot maths never fights timezones.
    date: { type: String, required: true, index: true },  // "YYYY-MM-DD"
    startMinutes: { type: Number, required: true },       // minutes from midnight, e.g. 18:30 → 1110
    endMinutes: { type: Number, required: true },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },

    mode: { type: String, enum: Object.values(BOOKING_MODES), required: true },
    status: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.PENDING,
      index: true,
    },

    players: { type: Number, default: 1, min: 1 },
    amount: { type: Number, required: true, min: 0 },
    platformFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    promoCode: { type: String, default: '', index: true },
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

    cancellation: {
      cancelledAt: { type: Date, default: null },
      cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reason: { type: String, default: '' },
      refundAmount: { type: Number, default: 0 },
      refundStatus: { type: String, enum: ['none', 'pending', 'processed'], default: 'none' },
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

// The double-booking guard: one court cannot hold two live bookings on the
// same date + start time. Partial index so cancelled slots free up again.
bookingSchema.index(
  { court: 1, date: 1, startMinutes: 1 },
  { unique: true, partialFilterExpression: { slotLocked: true } }
);
bookingSchema.index({ venue: 1, date: 1, status: 1 });

// Keep slotLocked in step with status so the index frees cancelled slots.
const RELEASING = ['cancelled', 'rejected', 'expired'];
bookingSchema.pre('save', function syncSlotLock(next) {
  if (this.isModified('status')) {
    this.slotLocked = !RELEASING.includes(this.status);
  }
  next();
});

bookingSchema.pre('validate', function makeRef(next) {
  if (!this.bookingRef) {
    this.bookingRef = 'GO' + Date.now().toString(36).toUpperCase() +
      Math.random().toString(36).slice(2, 5).toUpperCase();
  }
  next();
});

export default mongoose.model('Booking', bookingSchema);
