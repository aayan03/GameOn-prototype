import mongoose from 'mongoose';
import { SPORT_KEYS, AMENITIES, BOOKING_MODES } from '../config/constants.js';

/** A bookable surface inside a venue (Turf A, Court 2, Net 3...). */
const courtSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sport: { type: String, enum: SPORT_KEYS, required: true },
    surface: { type: String, default: 'artificial_turf' },
    format: { type: String, default: '' },        // "5-a-side", "7-a-side", "singles"
    capacity: { type: Number, default: 10 },      // players the surface comfortably holds
    pricePerHour: { type: Number, required: true, min: 0 },
    // Optional premium pricing for evening/weekend slots
    peakPricePerHour: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
  },
  { _id: true, timestamps: false }
);

/** Weekly opening hours. day 0 = Sunday. Times are "HH:mm" in venue local time. */
const operatingHourSchema = new mongoose.Schema(
  {
    day: { type: Number, min: 0, max: 6, required: true },
    open: { type: String, default: '06:00' },
    close: { type: String, default: '23:00' },
    isClosed: { type: Boolean, default: false },
  },
  { _id: false }
);

const venueSchema = new mongoose.Schema(
  {
    // No `index: 'text'` here, and none anywhere else in this file either —
    // see the note above the index declarations at the bottom for why this
    // collection deliberately carries no text index at all.
    name: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, index: true },
    description: { type: String, default: '', maxlength: 2000 },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Slide 4 — the hybrid engine. Automated venues confirm instantly;
    // manual venues create a pending request routed to the owner/ops team.
    bookingMode: {
      type: String,
      enum: Object.values(BOOKING_MODES),
      default: BOOKING_MODES.AUTOMATED,
      index: true,
    },
    manualContact: {
      phone: { type: String, default: '' },
      whatsapp: { type: String, default: '' },
      responseTimeMins: { type: Number, default: 30 },
    },

    sports: [{ type: String, enum: SPORT_KEYS, index: true }],
    courts: [courtSchema],
    amenities: [{ type: String, enum: AMENITIES }],
    images: [{ type: String }],

    address: {
      line1: { type: String, default: '' },
      area: { type: String, default: '', index: true },
      city: { type: String, default: '', index: true },
      state: { type: String, default: '' },
      pincode: { type: String, default: '' },
    },

    // GeoJSON — drives the Leaflet map and "near me" search.
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
        validate: {
          validator: (v) =>
            Array.isArray(v) && v.length === 2 &&
            v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90,
          message: 'coordinates must be [longitude, latitude]',
        },
      },
    },

    operatingHours: {
      type: [operatingHourSchema],
      default: () => Array.from({ length: 7 }, (_, day) => ({ day, open: '06:00', close: '23:00' })),
    },
    slotDurationMins: { type: Number, default: 60, enum: [30, 60, 90, 120] },

    /**
     * Does this venue take cash at the gate?
     *
     * Off by default, and that default is the whole point. A pay-at-venue
     * booking reserves a slot without any money moving, so while it was
     * accepted at every venue unconditionally, anyone could confirm slots for
     * free — and nothing released them, because the hold reaper only looked at
     * abandoned gateway checkouts. One account could lock every court in the
     * city and keep them locked.
     *
     * An owner who genuinely collects cash turns this on and accepts the
     * trade: those bookings expire an hour before kickoff unless settled.
     */
    acceptsPayAtVenue: { type: Boolean, default: false },

    // Cancellation policy — enforced by the booking service in Phase 2.
    cancellationPolicy: {
      freeCancellationHours: { type: Number, default: 24 },  // full refund before this
      partialRefundHours: { type: Number, default: 6 },      // partial refund before this
      partialRefundPercent: { type: Number, default: 50 },
    },
    advanceBookingDays: { type: Number, default: 14 },

    // Slots taken out of service. A blackout with no courtId blocks the whole
    // venue for that window; with no start/end it blocks the entire day.
    blackouts: [{
      date: { type: String, required: true },              // YYYY-MM-DD
      court: { type: mongoose.Schema.Types.ObjectId, default: null },
      startMinutes: { type: Number, default: null },
      endMinutes: { type: Number, default: null },
      reason: { type: String, maxlength: 120, default: '' },
      createdAt: { type: Date, default: Date.now },
    }],

    // Platform cut on each booking at this venue, used for payouts.
    commissionPercent: { type: Number, default: 10, min: 0, max: 40 },

    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    bookingCount: { type: Number, default: 0 },

    isFeatured: { type: Boolean, default: false, index: true }, // paid listings (slide 8)
    isVerified: { type: Boolean, default: false },

    // False = listed from public data, the owner has not confirmed anything.
    // The UI shows an "Unclaimed" badge and hides instant booking for these,
    // because we have no agreement with the venue yet.
    isClaimed: { type: Boolean, default: true },

    /**
     * Anyone can register as an "owner", so a listing from an unverified
     * account is held for review before it appears in public discovery.
     *
     * The default is 'pending' — the SAFE end. It used to be 'approved',
     * which was fine only because every path that creates a venue happened to
     * set the field explicitly. That is not a property the schema enforced,
     * it was a coincidence maintained by hand, and the failure mode of
     * getting it wrong is a stranger's unreviewed listing taking real
     * bookings and real money.
     *
     * Approve with:  db.venues.updateOne({_id}, {$set:{moderationStatus:'approved', isActive:true}})
     */
    moderationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    moderationNote: { type: String, maxlength: 300, default: '' },
    moderatedAt: { type: Date, default: null },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Same reasoning as moderationStatus: a listing is live only once
    // something says so, never by default.
    isActive: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

venueSchema.index({ location: '2dsphere' });

/**
 * There is deliberately NO text index here, and it is worth saying why,
 * because a weighted `venue_search` index used to sit on this line and it
 * looked like the obviously right thing.
 *
 * Nothing ever queried it with `$text` — discovery has always used an escaped
 * regex — so it was pure write cost: MongoDB tokenises and stems four fields
 * on every venue insert and every venue edit, to maintain an index no read
 * path touches. On top of that it was the source of the IndexOptionsConflict
 * that legacy databases logged on every startup.
 *
 * Switching discovery over to `$text` to make use of it does not work, and
 * these are hard constraints rather than tuning problems:
 *
 *  - `$text` and `$geoNear` cannot appear in the same query. MongoDB rejects
 *    it outright ("text and geoNear not allowed in same query"), and
 *    `$match: { $text }` is only legal as the FIRST pipeline stage, so it
 *    cannot be moved after the geo stage either. "Near me" plus a search term
 *    is a combination the discovery page offers today.
 *  - `$text` matches whole words, stemmed. The search box is debounced and
 *    queries as you type, so "kora" would return nothing at all until
 *    somebody finished typing "koramangala". It also tokenises on word
 *    boundaries, so a search for "turf" does not find "Turfside".
 *
 * The regex the controller uses is narrowed by `isActive` first (verified by
 * explain: an IXSCAN on isActive_1, not a collection scan) and gives the
 * substring behaviour the UI is built around. If search ever outgrows that,
 * the answer is Atlas Search, which does prefixes and geo together — not a
 * `$text` index this schema cannot actually use.
 */

venueSchema.virtual('startingPrice').get(function startingPrice() {
  if (!this.courts?.length) return 0;
  return Math.min(...this.courts.filter((c) => c.isActive).map((c) => c.pricePerHour));
});

venueSchema.pre('validate', function generateSlug(next) {
  if (!this.slug && this.name) {
    this.slug =
      this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') +
      '-' + Math.random().toString(36).slice(2, 7);
  }
  // Keep the sports array in sync with the courts actually offered.
  if (this.courts?.length) {
    this.sports = [...new Set(this.courts.map((c) => c.sport))];
  }
  next();
});

export default mongoose.model('Venue', venueSchema);
