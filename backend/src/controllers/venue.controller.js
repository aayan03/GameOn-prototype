import { z } from 'zod';
import mongoose from 'mongoose';
import { Venue, Review, Booking } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { haversineKm } from '../utils/geo.js';
import { safeRegex, escapeRegex } from '../utils/sanitize.js';
import { SPORT_KEYS, AMENITIES, BOOKING_MODES } from '../config/constants.js';

const numeric = (schema) => z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : Number(v)), schema
);
const csv = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.string()).optional()
);

export const listVenuesSchema = z.object({
  q: z.string().optional(),
  // Fetch a specific set in one call. The saved-venues screen used to request
  // each favourite individually, so thirty saved turfs meant thirty round
  // trips fired in parallel every time the list rendered.
  ids: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v),
    z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).max(60).optional()
  ),
  sport: z.string().optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  amenities: csv,
  bookingMode: z.enum([BOOKING_MODES.AUTOMATED, BOOKING_MODES.MANUAL]).optional(),
  lat: numeric(z.number().min(-90).max(90).optional()),
  lng: numeric(z.number().min(-180).max(180).optional()),
  radiusKm: numeric(z.number().min(0.5).max(100).optional()),
  minPrice: numeric(z.number().min(0).optional()),
  maxPrice: numeric(z.number().min(0).optional()),
  minRating: numeric(z.number().min(0).max(5).optional()),
  sort: z.enum(['distance', 'rating', 'price_low', 'price_high', 'popular']).optional(),
  page: numeric(z.number().int().min(1).optional()),
  limit: numeric(z.number().int().min(1).max(50).optional()),
});

const courtInput = z.object({
  name: z.string().min(1),
  sport: z.enum(SPORT_KEYS),
  surface: z.string().optional(),
  format: z.string().optional(),
  capacity: z.number().int().min(1).optional(),
  pricePerHour: z.number().min(0),
  peakPricePerHour: z.number().min(0).nullable().optional(),
});

export const createVenueSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(2000).optional(),
  bookingMode: z.enum([BOOKING_MODES.AUTOMATED, BOOKING_MODES.MANUAL]).optional(),
  manualContact: z.object({
    phone: z.string().optional(),
    whatsapp: z.string().optional(),
    responseTimeMins: z.number().int().min(1).optional(),
  }).optional(),
  courts: z.array(courtInput).min(1, 'Add at least one court or turf'),
  amenities: z.array(z.enum(AMENITIES)).optional(),
  images: z.array(z.string()).optional(),
  address: z.object({
    line1: z.string().optional(), area: z.string().optional(), city: z.string().optional(),
    state: z.string().optional(), pincode: z.string().optional(),
  }).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  slotDurationMins: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)]).optional(),
  cancellationPolicy: z.object({
    freeCancellationHours: z.number().min(0).optional(),
    partialRefundHours: z.number().min(0).optional(),
    partialRefundPercent: z.number().min(0).max(100).optional(),
  }).optional(),
});

export const updateVenueSchema = createVenueSchema.partial().omit({ lat: true, lng: true }).extend({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/venues
 * Supports geo "near me" (via $geoNear), text search, and every filter chip
 * on the discovery page. Returns distanceKm when coordinates are supplied.
 */
export const listVenues = asyncHandler(async (req, res) => {
  const f = req.validatedQuery || {};
  const page = f.page || 1;
  const limit = f.limit || 12;
  const skip = (page - 1) * limit;

  // `isActive` alone is not the whole gate. Both flags are set together
  // today — createVenue leaves an unverified listing inactive, moderateVenue
  // flips them in step — but public discovery is exactly the place where a
  // single future path that sets one without the other becomes a stranger's
  // fake venue collecting real bookings. /map and /meta/cities already filter
  // on both; this is the one that did not.
  const match = { isActive: true, moderationStatus: { $nin: ['pending', 'rejected'] } };
  if (f.ids?.length) match._id = { $in: f.ids.map((id) => new mongoose.Types.ObjectId(id)) };
  if (f.sport) match.sports = f.sport;
  // Every regex below is built from escaped input — see utils/sanitize.js.
  // Interpolating raw user text here would be both a ReDoS and a filter bypass.
  if (f.city) match['address.city'] = new RegExp(`^${escapeRegex(f.city)}$`, 'i');
  if (f.area) match['address.area'] = safeRegex(f.area);
  if (f.bookingMode) match.bookingMode = f.bookingMode;
  if (f.minRating) match.rating = { $gte: f.minRating };
  if (f.amenities?.length) match.amenities = { $all: f.amenities };
  if (f.q) {
    const q = safeRegex(f.q);
    match.$or = [{ name: q }, { 'address.area': q }, { 'address.city': q }];
  }

  const hasGeo = typeof f.lat === 'number' && typeof f.lng === 'number';
  const pipeline = [];

  if (hasGeo) {
    // $geoNear must be the first stage; it sorts by distance automatically.
    pipeline.push({
      $geoNear: {
        near: { type: 'Point', coordinates: [f.lng, f.lat] },
        distanceField: 'distanceMeters',
        maxDistance: (f.radiusKm || 25) * 1000,
        spherical: true,
        query: match,
      },
    });
  } else {
    pipeline.push({ $match: match });
  }

  // Compute the cheapest active court so we can filter and sort on price.
  pipeline.push({
    $addFields: {
      startingPrice: {
        $ifNull: [{ $min: {
          $map: {
            input: { $filter: { input: '$courts', as: 'c', cond: { $eq: ['$$c.isActive', true] } } },
            as: 'c', in: '$$c.pricePerHour',
          },
        } }, 0],
      },
      distanceKm: hasGeo ? { $round: [{ $divide: ['$distanceMeters', 1000] }, 2] } : null,
    },
  });

  const priceMatch = {};
  if (typeof f.minPrice === 'number') priceMatch.$gte = f.minPrice;
  if (typeof f.maxPrice === 'number') priceMatch.$lte = f.maxPrice;
  if (Object.keys(priceMatch).length) pipeline.push({ $match: { startingPrice: priceMatch } });

  const sortMap = {
    rating: { isFeatured: -1, rating: -1, reviewCount: -1 },
    price_low: { startingPrice: 1 },
    price_high: { startingPrice: -1 },
    popular: { bookingCount: -1, rating: -1 },
    distance: hasGeo ? { distanceMeters: 1 } : { rating: -1 },
  };
  const sort = sortMap[f.sort || (hasGeo ? 'distance' : 'rating')];
  // Featured venues (paid listings) surface first unless the user sorts by price/distance.
  pipeline.push({ $sort: sort });

  pipeline.push({
    $facet: {
      items: [
        { $skip: skip }, { $limit: limit },
        { $project: { __v: 0, 'courts.createdAt': 0, distanceMeters: 0 } },
      ],
      total: [{ $count: 'count' }],
    },
  });

  const [result] = await Venue.aggregate(pipeline);
  const items = result?.items || [];
  const total = result?.total?.[0]?.count || 0;

  return ok(res, items, { page, limit, total, pages: Math.ceil(total / limit) || 1, hasGeo });
});

/** GET /api/venues/map — lightweight payload for plotting pins on Leaflet. */
export const mapVenues = asyncHandler(async (req, res) => {
  const f = req.validatedQuery || {};
  const match = { isActive: true, moderationStatus: { $nin: ['pending', 'rejected'] } };
  if (f.ids?.length) match._id = { $in: f.ids.map((id) => new mongoose.Types.ObjectId(id)) };
  if (f.sport) match.sports = f.sport;
  if (f.city) match['address.city'] = new RegExp(`^${escapeRegex(f.city)}$`, 'i');

  let venues;
  if (typeof f.lat === 'number' && typeof f.lng === 'number') {
    venues = await Venue.find({
      ...match,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
          $maxDistance: (f.radiusKm || 25) * 1000,
        },
      },
    }).select('name slug location address rating reviewCount sports courts bookingMode images').limit(300).lean();
  } else {
    venues = await Venue.find(match)
      .select('name slug location address rating reviewCount sports courts bookingMode images')
      .limit(300).lean();
  }

  const origin = typeof f.lat === 'number' ? [f.lng, f.lat] : null;
  const pins = venues.map((v) => ({
    id: v._id,
    name: v.name,
    slug: v.slug,
    lat: v.location.coordinates[1],
    lng: v.location.coordinates[0],
    area: v.address?.area || '',
    city: v.address?.city || '',
    rating: v.rating,
    reviewCount: v.reviewCount,
    sports: v.sports,
    bookingMode: v.bookingMode,
    image: v.images?.[0] || '',
    startingPrice: v.courts?.length ? Math.min(...v.courts.map((c) => c.pricePerHour)) : 0,
    distanceKm: origin ? Number(haversineKm(origin, v.location.coordinates).toFixed(2)) : null,
  }));

  return ok(res, pins, { count: pins.length });
});

/** GET /api/venues/:idOrSlug */
export const getVenue = asyncHandler(async (req, res) => {
  const { idOrSlug } = req.params;
  // Only ever match on an exact id or an exact slug string — never a regex,
  // and never an object the caller could shape into an operator.
  const query = /^[0-9a-fA-F]{24}$/.test(idOrSlug)
    ? { _id: idOrSlug }
    : { slug: String(idOrSlug).slice(0, 120) };
  // Only the owner's display name — their registration email and phone are
  // personal data, and this route is reachable without a token. The venue's
  // business contact lives in `manualContact` and is shown separately.
  const venue = await Venue.findOne(query).populate('owner', 'name avatar');
  // An unapproved venue is visible to its own owner (so they can see what
  // they submitted) but to nobody else.
  const viewerOwns = req.user && String(venue?.owner?._id || venue?.owner) === String(req.user._id);
  const visible = venue && venue.isActive && venue.moderationStatus !== 'pending' && venue.moderationStatus !== 'rejected';
  if (!venue || (!visible && !viewerOwns && req.user?.role !== 'admin')) {
    throw ApiError.notFound('Venue not found');
  }

  /**
   * Strip the venue's private side before it leaves the server.
   *
   * This route is reachable without a token and returned the raw document,
   * which carries several things a visitor has no business seeing:
   *
   *   commissionPercent  what this venue pays the platform — a competitor's
   *                      first question, and the owner's own commercial terms
   *   blackouts          exactly when the pitch is out of service, with the
   *                      free-text reason the owner typed for themselves
   *   moderationNote /   the internal review trail, including which admin
   *   moderatedBy        made the call
   *
   * The owner and admins still see everything; the note is for them.
   */
  const isInsider = viewerOwns || req.user?.role === 'admin';
  const venueOut = venue.toObject();
  if (!isInsider) {
    delete venueOut.commissionPercent;
    delete venueOut.blackouts;
    delete venueOut.moderationNote;
    delete venueOut.moderatedBy;
    delete venueOut.moderatedAt;
    delete venueOut.__v;
  }

  const reviews = await Review.find({ venue: venue._id, isVisible: true })
    .populate('user', 'name avatar').sort({ createdAt: -1 }).limit(10).lean();

  const isFavorite = req.user
    ? req.user.favorites.some((f) => f.toString() === venue._id.toString())
    : false;

  return ok(res, { venue: venueOut, reviews, isFavorite });
});

/** POST /api/venues — owners only. */
export const createVenue = asyncHandler(async (req, res) => {
  const { lat, lng, ...rest } = req.body;

  const owned = await Venue.countDocuments({ owner: req.user._id });
  if (owned >= 25) throw ApiError.badRequest('You can list at most 25 venues');

  // Anyone can sign up as an "owner", so an unverified account's listing does
  // not go live on its own — otherwise a stranger can publish a fake venue and
  // collect real bookings. Verified owners publish immediately.
  const autoApprove = req.user.isVerified || req.user.role === 'admin';

  const venue = await Venue.create({
    ...rest,
    owner: req.user._id,
    location: { type: 'Point', coordinates: [lng, lat] },
    moderationStatus: autoApprove ? 'approved' : 'pending',
    isActive: autoApprove,
    // A brand-new listing is never featured, whatever the request said.
    isFeatured: false,
    isVerified: false,
  });

  return created(res, {
    venue,
    message: autoApprove
      ? 'Venue published.'
      : 'Venue submitted. It goes live once our team has reviewed it — usually within a day.',
  });
});

export const updateVenue = asyncHandler(async (req, res) => {
  const venue = await Venue.findById(req.params.id);
  if (!venue) throw ApiError.notFound('Venue not found');
  if (venue.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('You can only edit your own venues');
  }
  const { lat, lng, isActive, courts, ...rest } = req.body;

  /**
   * Replacing the courts array is the one edit that can silently break a
   * booking that already exists.
   *
   * A Booking stores `court` as the subdocument's ObjectId, and both the
   * availability grid and the unique double-booking index key off it.
   * Assigning a fresh array mints new ids, so every live booking points at a
   * court that no longer exists: its slot reads as free, someone else books
   * it, and two teams turn up for the same pitch — with no index violation to
   * catch it, because the two rows have different `court` values.
   *
   * The same reasoning as updateSettings, which already refuses to re-phase
   * the slot grid underneath live bookings.
   */
  if (courts !== undefined) {
    const upcoming = await Booking.countDocuments({
      venue: venue._id, slotLocked: true, endsAt: { $gte: new Date() },
    });
    if (upcoming > 0) {
      throw ApiError.conflict(
        `You have ${upcoming} upcoming booking${upcoming === 1 ? '' : 's'} at this venue. `
        + 'Changing the court list would detach them from their court — wait until they are '
        + 'played or cancelled, or deactivate a single court instead.'
      );
    }
    venue.courts = courts;
  }

  Object.assign(venue, rest);

  // An owner may deactivate their own venue, but may not activate one that
  // has not been approved, and can never set moderationStatus / isVerified /
  // isFeatured — those are ours to set.
  if (typeof isActive === 'boolean') {
    venue.isActive = isActive && venue.moderationStatus === 'approved';
  }

  if (typeof lat === 'number' && typeof lng === 'number') {
    venue.location = { type: 'Point', coordinates: [lng, lat] };
  }
  await venue.save();
  return ok(res, venue);
});

/**
 * DELETE /api/venues/:id — unlists rather than destroys.
 *
 * The row stays. Bookings reference this venue, reviews hang off it, and
 * payouts are settled against it; deleting it for real would leave every one
 * of those pointing at nothing, and a player who paid last week would lose
 * the record of what they paid for.
 *
 * Unlisting is NOT a cancellation, and the two are easy to confuse. It hides
 * the venue from search and from the public page; it does not refund anybody
 * or tell anybody. Bookings already made still stand, and the booking screens
 * keep working because they carry their own copy of the venue (they populate
 * name, address, contact and the cancellation policy rather than re-fetching
 * it). So the count goes back in the response: the owner is still on the hook
 * for those fixtures and the UI has to be able to say so.
 *
 * Deliberately not blocked when bookings exist. Refusing would trap an owner
 * whose turf is closing next month with no way to stop taking new bookings
 * for it — which is the exact situation this endpoint is for.
 *
 * Reversible: PATCH the venue with `isActive: true` to relist, subject to the
 * same moderation gate as any other activation.
 */
export const deleteVenue = asyncHandler(async (req, res) => {
  const venue = await Venue.findById(req.params.id);
  if (!venue) throw ApiError.notFound('Venue not found');
  if (venue.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('You can only remove your own venues');
  }

  // Same condition updateVenue uses for its court guard: `slotLocked` is what
  // a cancellation clears, so it means "still occupies the slot".
  const upcomingBookings = await Booking.countDocuments({
    venue: venue._id, slotLocked: true, endsAt: { $gte: new Date() },
  });

  venue.isActive = false;
  await venue.save();
  return ok(res, { id: venue._id, deactivated: true, upcomingBookings });
});

/** GET /api/venues/owner/mine */
export const myVenues = asyncHandler(async (req, res) => {
  const venues = await Venue.find({ owner: req.user._id }).sort({ createdAt: -1 });
  return ok(res, venues);
});

/** POST /api/venues/:id/favorite — toggles. */
export const toggleFavorite = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!await Venue.exists({ _id: id })) throw ApiError.notFound('Venue not found');
  const idx = req.user.favorites.findIndex((f) => f.toString() === id);
  if (idx >= 0) req.user.favorites.splice(idx, 1);
  else req.user.favorites.push(id);
  await req.user.save();
  return ok(res, { isFavorite: idx < 0, favorites: req.user.favorites });
});

/** GET /api/venues/meta/cities — powers the city dropdown. */
export const cities = asyncHandler(async (req, res) => {
  const rows = await Venue.aggregate([
    { $match: {
      isActive: true,
      moderationStatus: { $nin: ['pending', 'rejected'] },
      'address.city': { $ne: '' },
    } },
    { $group: { _id: '$address.city', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return ok(res, rows.map((r) => ({ city: r._id, venues: r.count })));
});
