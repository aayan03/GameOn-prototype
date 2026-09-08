import mongoose from 'mongoose';
import crypto from 'crypto';
import { SPORT_KEYS, PLAYGROUND_FACILITIES } from '../config/constants.js';

/**
 * A free, public place to play, put on the map by whoever found it.
 *
 * Deliberately NOT a Venue, and the difference is the point. A Venue is
 * owned, priced, bookable and settled against; this is a municipal park with
 * a concrete cricket strip that half the neighbourhood does not know exists.
 * Nothing here can be reserved and nothing here takes money — there are no
 * courts, no rates and no booking mode, so there is no code path that could
 * accidentally charge somebody for public land.
 *
 * `submittedBy` is a CREDIT, not an ownership claim. The contributor found
 * the place; they do not control it, cannot price it, and cannot take it
 * down once it is live. Public land is not theirs to gate, and a listing
 * people rely on should not vanish because the person who added it fell out
 * with us. Corrections go through the same moderation queue as the original.
 *
 * Everything is `pending` until an admin looks at it. This is user-generated
 * content carrying a physical location, and an unmoderated one of those
 * sends strangers to an address chosen by an anonymous account.
 */

const pointSchema = new mongoose.Schema({
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number], required: true },
}, { _id: false });

const playgroundSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, unique: true, index: true },
    description: { type: String, default: '', maxlength: 1500 },

    sports: {
      type: [{ type: String, enum: SPORT_KEYS }],
      validate: [(v) => v.length > 0, 'Pick at least one sport'],
    },
    facilities: [{ type: String, enum: PLAYGROUND_FACILITIES }],

    address: {
      line1: { type: String, default: '', maxlength: 200 },
      area: { type: String, default: '', index: true },
      city: { type: String, default: '', index: true },
      state: { type: String, default: '' },
      pincode: { type: String, default: '' },
    },
    // Required, and the whole value of the listing. A free ground nobody can
    // find is not findable just because it is free.
    location: { type: pointSchema, required: true },

    /**
     * When you can actually get in.
     *
     * Free does not mean open — school grounds are locked in term time, park
     * gates shut at dusk, and a listing that ignores that sends somebody on a
     * wasted trip. `alwaysOpen` covers the genuinely unfenced ones rather
     * than making people invent 00:00–23:59.
     */
    access: {
      alwaysOpen: { type: Boolean, default: false },
      opensAt: { type: String, default: '' },   // "06:00"
      closesAt: { type: String, default: '' },  // "21:00"
      notes: { type: String, default: '', maxlength: 300 },
    },

    surface: {
      type: String,
      enum: ['grass', 'mud', 'concrete', 'asphalt', 'sand', 'synthetic', 'mixed', 'other'],
      default: 'other',
    },

    /**
     * Reserved. There is no upload path yet, so nothing writes to this — it
     * is here so adding photos later is a form change rather than a
     * migration on a collection that by then has real rows in it.
     */
    images: [{ type: String }],

    // A credit, not a claim — see the note at the top of this file.
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    moderationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    moderationNote: { type: String, default: '', maxlength: 300 },
    moderatedAt: { type: Date, default: null },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * False until approved, and false again if an admin takes it down. Kept
     * separate from moderationStatus so a live listing can be pulled quickly
     * without erasing the fact that it was once reviewed and by whom.
     */
    isActive: { type: Boolean, default: false, index: true },

    // Somebody said this is wrong, gone, or not actually public. A count
    // rather than a boolean, so one annoyed user cannot bury a good listing.
    reportCount: { type: Number, default: 0 },
    // Who, so one person cannot raise the count on their own by tapping twice.
    reportedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

playgroundSchema.index({ location: '2dsphere' });
// The public list: live rows, newest first.
playgroundSchema.index({ isActive: 1, moderationStatus: 1, createdAt: -1 });
// The moderation queue, and "my submissions".
playgroundSchema.index({ submittedBy: 1, createdAt: -1 });

playgroundSchema.pre('validate', function slugify(next) {
  if (!this.slug && this.name) {
    const base = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Random suffix rather than a counter: two parks genuinely are called
    // "Community Ground", and a counter needs a read-then-write that two
    // simultaneous submissions can both win.
    this.slug = `${base || 'playground'}-${crypto.randomBytes(3).toString('hex')}`;
  }
  next();
});

export default mongoose.model('Playground', playgroundSchema);
