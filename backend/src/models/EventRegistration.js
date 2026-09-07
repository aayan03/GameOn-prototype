import mongoose from 'mongoose';

/**
 * One person's place at one event.
 *
 * The authoritative record of who is going — `Event.registeredCount` is a
 * denormalised counter that exists only so capacity can be enforced inside a
 * single atomic update.
 *
 * A row is never deleted on cancellation, only flipped to `cancelled`. Two
 * reasons: the unique index below is what stops one account taking two places,
 * and it has to keep working across a cancel-then-rejoin; and an organiser
 * looking at a half-empty marathon wants to know whether nobody signed up or
 * forty people dropped out, which a deleted row cannot tell them.
 */
const eventRegistrationSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    status: { type: String, enum: ['going', 'cancelled'], default: 'going', index: true },
    // How many places this registration holds — someone signing up with a
    // friend takes two, and capacity has to account for both.
    seats: { type: Number, default: 1, min: 1, max: 10 },

    registeredAt: { type: Date, default: Date.now },
    cancelledAt: { type: Date, default: null },
    // Free text the organiser asked for — a t-shirt size, a running club.
    note: { type: String, maxlength: 300, default: '' },
  },
  { timestamps: true }
);

// One row per person per event, whatever state it is in. This is the guard
// that makes a double-submit idempotent rather than a double booking.
eventRegistrationSchema.index({ event: 1, user: 1 }, { unique: true });
// "Events I am going to", newest first.
eventRegistrationSchema.index({ user: 1, status: 1, createdAt: -1 });

export default mongoose.model('EventRegistration', eventRegistrationSchema);
