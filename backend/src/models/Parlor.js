import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { PARLOR_GAME_KEYS, PARLOR_AMENITIES } from '../config/constants.js';

/**
 * A game parlour — snooker hall, arcade, bowling alley, gaming café.
 *
 * A LOCATOR ONLY. Deliberately not bookable.
 *
 * That is the whole design constraint and it is worth being explicit about,
 * because the temptation to reuse the Venue machinery here is strong: a pool
 * table by the hour looks exactly like a court by the hour. But nothing on
 * this model is reservable, so there is no slot grid, no capacity, no payment,
 * no refund and no payout — and none of the money-path complexity that comes
 * with them. What this answers is "where is one, is it open, what is the
 * number". Adding booking later means adding it deliberately, not discovering
 * that half of it arrived by inheritance.
 *
 * The one thing shared with Venue is the opening-hours shape, so the same
 * `openStatus()` helper reads both.
 */
const openingHourSchema = new mongoose.Schema(
  {
    day: { type: Number, min: 0, max: 6, required: true },
    open: { type: String, default: '11:00' },
    // Later than the open time means it runs past midnight, which parlours
    // routinely do. `utils/time.js#openStatus` handles that span.
    close: { type: String, default: '23:00' },
    isClosed: { type: Boolean, default: false },
  },
  { _id: false }
);

const parlorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, unique: true, index: true },
    description: { type: String, default: '', maxlength: 1500 },

    // What you can actually play there. Drives the filter chips.
    games: [{ type: String, enum: PARLOR_GAME_KEYS, index: true }],
    amenities: [{ type: String, enum: PARLOR_AMENITIES }],

    address: {
      line1: { type: String, default: '', maxlength: 200 },
      area: { type: String, default: '', index: true },
      city: { type: String, default: '', index: true },
      state: { type: String, default: '' },
      pincode: { type: String, default: '' },
    },

    // Required: a locator with no coordinates is not a locator.
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: {
        type: [Number],                       // [longitude, latitude]
        required: true,
        validate: {
          validator: (v) => Array.isArray(v) && v.length === 2
            && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90,
          message: 'coordinates must be [longitude, latitude]',
        },
      },
    },

    // How you reach them. This IS the call to action — there is nothing to book.
    contact: {
      phone: { type: String, default: '', maxlength: 20 },
      whatsapp: { type: String, default: '', maxlength: 20 },
      website: { type: String, default: '', maxlength: 300 },
    },

    openingHours: {
      type: [openingHourSchema],
      default: () => Array.from({ length: 7 }, (_, day) => ({ day, open: '11:00', close: '23:00' })),
    },

    images: [{ type: String, maxlength: 500 }],

    /**
     * Indicative, and a range rather than a number.
     *
     * Nothing is charged through the platform, so a precise price would be a
     * figure nobody can hold the parlour to — and this codebase has form for
     * removing numbers it cannot stand behind. A band sets expectations
     * without pretending to be a quote.
     */
    priceFrom: { type: Number, default: 0, min: 0 },
    priceTo: { type: Number, default: 0, min: 0 },

    // Listed from public data, nobody has confirmed it. Shown as "Unclaimed".
    isClaimed: { type: Boolean, default: false },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    // Same review flow as venues and events.
    moderationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    moderationNote: { type: String, maxlength: 300, default: '' },
    moderatedAt: { type: Date, default: null },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // A parlour that has shut down, kept so its links do not 404.
    isPermanentlyClosed: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

parlorSchema.index({ location: '2dsphere' });
parlorSchema.index({ isActive: 1, moderationStatus: 1, 'address.city': 1 });

parlorSchema.pre('validate', function makeSlug(next) {
  if (!this.slug && this.name) {
    const base = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    this.slug = `${base || 'parlor'}-${crypto.randomBytes(3).toString('hex')}`;
  }
  next();
});

export default mongoose.model('Parlor', parlorSchema);
