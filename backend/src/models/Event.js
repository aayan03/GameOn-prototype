import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { EVENT_TYPE_KEYS, SPORT_KEYS } from '../config/constants.js';

/**
 * A sports event — a marathon, a tournament, a sunrise party, a coaching
 * clinic. Something that happens at a time and place, that people turn up to.
 *
 * Not a Booking. A booking is one court for one hour and its whole identity is
 * the double-booking index; an event is one gathering with a capacity. Sharing
 * the collection would have meant half its rows carrying null for `court`,
 * `startMinutes` and `slotLocked`, and the unique index that stops two teams
 * arriving at the same pitch would have had to learn about events to keep
 * working.
 *
 * `registeredCount` is denormalised on purpose. The authoritative record of
 * who is going is EventRegistration, but capacity has to be enforced in a
 * single atomic update or two people take the last place — and you cannot
 * count another collection inside an update filter.
 */
/** GeoJSON point. Both halves required, so a partial one cannot be stored. */
const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2
          && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90,
        message: 'coordinates must be [longitude, latitude]',
      },
    },
  },
  { _id: false },
);

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, unique: true, index: true },
    description: { type: String, default: '', maxlength: 4000 },

    type: { type: String, enum: EVENT_TYPE_KEYS, required: true, index: true },
    // Optional: a morning party or a fun run is not "a football event".
    sport: { type: String, enum: [...SPORT_KEYS, null], default: null, index: true },

    organiser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Optional link to a venue on the platform. A marathon starts on a road.
    venue: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', default: null, index: true },

    // Free text, because an event location is often not a venue we list.
    location: {
      name: { type: String, default: '', maxlength: 160 },
      address: { type: String, default: '', maxlength: 240 },
      area: { type: String, default: '', index: true },
      city: { type: String, default: '', index: true },
    },
    /**
     * Optional, and genuinely absent when not supplied.
     *
     * Declared inline first, which does not work: Mongoose materialises a
     * nested path even when nothing sets it, so every event without a map pin
     * was saved carrying `{ type: 'Point' }` with no coordinates array. A
     * 2dsphere index refuses that outright — "Point must be an array or
     * object, instead got type missing" — so creating any event at all failed
     * with a 500. `sparse` does not help, because the field is present; it is
     * just malformed.
     *
     * A sub-schema with `default: undefined` leaves the path off the document
     * entirely, which is what sparse actually needs.
     */
    coordinates: { type: pointSchema, default: undefined },

    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, default: null },

    /**
     * 0 means unlimited. Chosen over null because the capacity check runs
     * inside an aggregation-pipeline filter, and `$lt` against null there is
     * a silent no-match rather than an error — a limit that quietly refuses
     * everybody is worse than one that quietly allows everybody.
     */
    capacity: { type: Number, default: 0, min: 0 },
    registeredCount: { type: Number, default: 0, min: 0 },

    /**
     * Reserved, and enforced as zero.
     *
     * Paid ticketing is a real feature with real consequences — gateway
     * capture, refunds to source, organiser payouts, the lot. Half-building it
     * by letting an organiser type a number nobody collects would produce
     * events that claim a price and take no money, which is exactly the class
     * of lie this codebase has spent its life removing.
     */
    price: { type: Number, default: 0, min: 0, max: 0 },

    banner: { type: String, default: '', maxlength: 500 },
    // Where to go for the organiser's own signup, if they run one elsewhere.
    externalUrl: { type: String, default: '', maxlength: 500 },

    // Same moderation flow as venues: an unverified organiser is reviewed
    // before their event reaches public discovery.
    moderationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    moderationNote: { type: String, maxlength: 300, default: '' },
    moderatedAt: { type: Date, default: null },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    isCancelled: { type: Boolean, default: false },
    cancelledReason: { type: String, maxlength: 300, default: '' },
    isActive: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

eventSchema.index({ coordinates: '2dsphere' }, { sparse: true });
// The listing query: live events, soonest first.
eventSchema.index({ isActive: 1, moderationStatus: 1, startsAt: 1 });
eventSchema.index({ organiser: 1, startsAt: -1 });

eventSchema.virtual('spotsRemaining').get(function spotsRemaining() {
  if (!this.capacity) return null;          // unlimited
  return Math.max(0, this.capacity - this.registeredCount);
});

eventSchema.virtual('isFull').get(function isFull() {
  return Boolean(this.capacity) && this.registeredCount >= this.capacity;
});

/**
 * Slug from the title plus random suffix.
 *
 * The suffix is crypto-random rather than `Math.random()` — the same reasoning
 * as bookingRef. Two events called "Sunday Morning Run" created in the same
 * second must not collide on a unique index and fail the second organiser's
 * submission with a duplicate-key error they cannot act on.
 */
eventSchema.pre('validate', function makeSlug(next) {
  if (!this.slug && this.title) {
    const base = this.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    this.slug = `${base || 'event'}-${crypto.randomBytes(3).toString('hex')}`;
  }
  next();
});

export default mongoose.model('Event', eventSchema);
