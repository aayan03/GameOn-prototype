import { z } from 'zod';
import mongoose from 'mongoose';
import { Parlor } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { cleanText, safeRegex, escapeRegex } from '../utils/sanitize.js';
import { haversineKm } from '../utils/geo.js';
import { openStatus } from '../utils/time.js';
import { PARLOR_GAME_KEYS, PARLOR_AMENITIES, ROLES } from '../config/constants.js';

/* ── Validation ──────────────────────────────────────────────── */

const numeric = (schema) => z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : Number(v)), schema
);
const csv = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.string()).optional()
);

export const listParlorsSchema = z.object({
  q: z.string().max(80).optional(),
  game: z.enum(PARLOR_GAME_KEYS).optional(),
  city: z.string().max(60).optional(),
  amenities: csv,
  // The filter people actually want at 10pm on a Friday.
  openNow: z.enum(['true', 'false']).optional(),
  lat: numeric(z.number().min(-90).max(90).optional()),
  lng: numeric(z.number().min(-180).max(180).optional()),
  radiusKm: numeric(z.number().min(0.5).max(100).optional()),
  page: numeric(z.number().int().min(1).optional()),
  limit: numeric(z.number().int().min(1).max(60).optional()),
}).strict();

const hoursInput = z.array(z.object({
  day: z.number().int().min(0).max(6),
  open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  isClosed: z.boolean().optional(),
})).length(7);

export const createParlorSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1500).optional(),
  games: z.array(z.enum(PARLOR_GAME_KEYS)).min(1, 'Pick at least one game').max(12),
  amenities: z.array(z.enum(PARLOR_AMENITIES)).optional(),
  address: z.object({
    line1: z.string().trim().max(200).optional(),
    area: z.string().trim().max(60).optional(),
    city: z.string().trim().max(60).optional(),
    state: z.string().trim().max(60).optional(),
    pincode: z.string().trim().max(10).optional(),
  }).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  contact: z.object({
    phone: z.string().trim().max(20).optional(),
    whatsapp: z.string().trim().max(20).optional(),
    website: z.string().trim().max(300).optional(),
  }).optional(),
  openingHours: hoursInput.optional(),
  images: z.array(z.string().max(500)).max(8).optional(),
  priceFrom: z.number().min(0).max(100000).optional(),
  priceTo: z.number().min(0).max(100000).optional(),
}).strict();

export const updateParlorSchema = createParlorSchema.partial().extend({
  isPermanentlyClosed: z.boolean().optional(),
});

export const moderateParlorSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(300).optional(),
}).strict();

/* ── Helpers ─────────────────────────────────────────────────── */

const PUBLIC_MATCH = { isActive: true, moderationStatus: { $nin: ['pending', 'rejected'] } };

/** Attaches live open/closed state and strips the internal review trail. */
function present(parlor, origin = null) {
  const p = parlor.toObject ? parlor.toObject() : parlor;
  const status = openStatus(p.openingHours);

  return {
    ...p,
    // Computed per request rather than stored: "open" is a fact about now,
    // and a cached one is wrong within the hour.
    openNow: status.open,
    opensAt: status.opensAt,
    closesAt: status.closesAt,
    todayHours: status.today && !status.today.isClosed
      ? { open: status.today.open, close: status.today.close }
      : null,
    distanceKm: origin && p.location?.coordinates
      ? Number(haversineKm(origin, p.location.coordinates).toFixed(2))
      : null,
    moderationNote: undefined,
    moderatedBy: undefined,
    __v: undefined,
  };
}

async function ownedParlor(user, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid parlor id');
  const parlor = await Parlor.findById(id);
  if (!parlor) throw ApiError.notFound('Parlor not found');
  if (String(parlor.addedBy) !== String(user._id) && user.role !== ROLES.ADMIN) {
    throw ApiError.forbidden('That listing is not yours');
  }
  return parlor;
}

/* ── Discovery ───────────────────────────────────────────────── */

/** GET /api/parlors — the locator. */
export const listParlors = asyncHandler(async (req, res) => {
  const f = req.validatedQuery || {};
  const page = f.page || 1;
  const limit = f.limit || 24;

  const match = { ...PUBLIC_MATCH, isPermanentlyClosed: false };
  if (f.game) match.games = f.game;
  if (f.city) match['address.city'] = new RegExp(`^${escapeRegex(f.city)}$`, 'i');
  if (f.amenities?.length) match.amenities = { $all: f.amenities };
  if (f.q) {
    const rx = safeRegex(f.q);
    match.$or = [{ name: rx }, { 'address.area': rx }, { 'address.city': rx }];
  }

  const hasGeo = typeof f.lat === 'number' && typeof f.lng === 'number';
  const origin = hasGeo ? [f.lng, f.lat] : null;

  /**
   * `openNow` is filtered in JS, after the query.
   *
   * It depends on the current wall-clock time in the venue's timezone against
   * a seven-row schedule that can span midnight — which is not something a
   * Mongo query expresses without either an aggregation nobody can read or a
   * denormalised `isOpen` flag that would need a cron job to stay true. The
   * result set here is bounded by `limit`, so the cost is trivial; over-fetch
   * a little when filtering so a full page still comes back.
   */
  const wantOpen = f.openNow === 'true';
  const fetchLimit = wantOpen ? Math.min(limit * 4, 200) : limit;

  let rows;
  let total;

  if (hasGeo) {
    rows = await Parlor.find({
      ...match,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: origin },
          $maxDistance: (f.radiusKm || 25) * 1000,
        },
      },
    }).limit(fetchLimit + (page - 1) * limit).lean();
    // $near already sorts by distance; page in memory rather than issuing a
    // second count query against a geo filter.
    total = rows.length;
    rows = rows.slice((page - 1) * limit);
  } else {
    [rows, total] = await Promise.all([
      Parlor.find(match).sort({ name: 1 }).skip((page - 1) * limit).limit(fetchLimit).lean(),
      Parlor.countDocuments(match),
    ]);
  }

  let items = rows.map((p) => present(p, origin));
  if (wantOpen) {
    items = items.filter((p) => p.openNow);
    total = items.length;
  }
  items = items.slice(0, limit);

  return ok(res, items, {
    page, limit, total, pages: Math.ceil(total / limit) || 1, hasGeo, openNow: wantOpen,
  });
});

/** GET /api/parlors/map — lightweight pins, same shape as the venue map. */
export const mapParlors = asyncHandler(async (req, res) => {
  const f = req.validatedQuery || {};
  const match = { ...PUBLIC_MATCH, isPermanentlyClosed: false };
  if (f.game) match.games = f.game;
  if (f.city) match['address.city'] = new RegExp(`^${escapeRegex(f.city)}$`, 'i');

  const hasGeo = typeof f.lat === 'number' && typeof f.lng === 'number';
  const origin = hasGeo ? [f.lng, f.lat] : null;

  const rows = await Parlor.find(
    hasGeo
      ? {
        ...match,
        location: {
          $near: {
            $geometry: { type: 'Point', coordinates: origin },
            $maxDistance: (f.radiusKm || 25) * 1000,
          },
        },
      }
      : match,
  ).select('name slug location address games openingHours images contact').limit(300).lean();

  return ok(res, rows.map((p) => {
    const status = openStatus(p.openingHours);
    return {
      id: p._id,
      name: p.name,
      slug: p.slug,
      lat: p.location.coordinates[1],
      lng: p.location.coordinates[0],
      area: p.address?.area || '',
      city: p.address?.city || '',
      games: p.games,
      image: p.images?.[0] || '',
      phone: p.contact?.phone || '',
      openNow: status.open,
      distanceKm: origin ? Number(haversineKm(origin, p.location.coordinates).toFixed(2)) : null,
    };
  }), { count: rows.length });
});

/** GET /api/parlors/:idOrSlug */
export const getParlor = asyncHandler(async (req, res) => {
  const { idOrSlug } = req.params;
  const query = /^[0-9a-fA-F]{24}$/.test(idOrSlug)
    ? { _id: idOrSlug }
    : { slug: String(idOrSlug).slice(0, 140) };

  const parlor = await Parlor.findOne(query);
  const isInsider = req.user
    && (String(parlor?.addedBy) === String(req.user._id) || req.user.role === ROLES.ADMIN);
  const visible = parlor && parlor.isActive
    && !['pending', 'rejected'].includes(parlor.moderationStatus);

  if (!parlor || (!visible && !isInsider)) throw ApiError.notFound('Parlor not found');

  const body = present(parlor);
  if (isInsider) {
    body.moderationStatus = parlor.moderationStatus;
    body.moderationNote = parlor.moderationNote;
  }
  return ok(res, body);
});

/** GET /api/parlors/meta/cities */
export const parlorCities = asyncHandler(async (req, res) => {
  const rows = await Parlor.aggregate([
    { $match: { ...PUBLIC_MATCH, isPermanentlyClosed: false, 'address.city': { $ne: '' } } },
    { $group: { _id: '$address.city', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return ok(res, rows.map((r) => ({ city: r._id, parlors: r.count })));
});

/* ── Listing management ──────────────────────────────────────── */

/** POST /api/parlors — owners and admins. */
export const createParlor = asyncHandler(async (req, res) => {
  const { lat, lng, address, contact, ...rest } = req.body;

  if (rest.priceFrom && rest.priceTo && rest.priceTo < rest.priceFrom) {
    throw ApiError.badRequest('The upper price cannot be below the lower one');
  }

  const mine = await Parlor.countDocuments({ addedBy: req.user._id });
  if (mine >= 50) throw ApiError.badRequest('You can list at most 50 parlors');

  const autoApprove = req.user.isVerified || req.user.role === ROLES.ADMIN;

  const parlor = await Parlor.create({
    ...rest,
    name: cleanText(rest.name, 120),
    description: cleanText(rest.description || '', 1500),
    addedBy: req.user._id,
    address: {
      line1: cleanText(address?.line1 || '', 200),
      area: cleanText(address?.area || '', 60),
      city: cleanText(address?.city || '', 60),
      state: cleanText(address?.state || '', 60),
      pincode: cleanText(address?.pincode || '', 10),
    },
    location: { type: 'Point', coordinates: [lng, lat] },
    contact: {
      phone: cleanText(contact?.phone || '', 20),
      whatsapp: cleanText(contact?.whatsapp || '', 20),
      website: cleanText(contact?.website || '', 300),
    },
    // Ours to set, never the caller's.
    isClaimed: req.user.role === ROLES.ADMIN ? false : true,
    moderationStatus: autoApprove ? 'approved' : 'pending',
    isActive: autoApprove,
  });

  return created(res, {
    parlor: present(parlor),
    message: autoApprove
      ? 'Listing published.'
      : 'Listing submitted. It goes live once our team has reviewed it — usually within a day.',
  });
});

/** PATCH /api/parlors/:id */
export const updateParlor = asyncHandler(async (req, res) => {
  const parlor = await ownedParlor(req.user, req.params.id);
  const { lat, lng, address, contact, ...rest } = req.body;

  for (const key of ['name', 'description', 'games', 'amenities', 'images',
    'priceFrom', 'priceTo', 'openingHours', 'isPermanentlyClosed']) {
    if (rest[key] !== undefined) parlor[key] = rest[key];
  }
  if (rest.name) parlor.name = cleanText(rest.name, 120);
  if (rest.description !== undefined) parlor.description = cleanText(rest.description, 1500);

  if (parlor.priceFrom && parlor.priceTo && parlor.priceTo < parlor.priceFrom) {
    throw ApiError.badRequest('The upper price cannot be below the lower one');
  }

  if (address) {
    parlor.address = {
      line1: cleanText(address.line1 ?? parlor.address.line1, 200),
      area: cleanText(address.area ?? parlor.address.area, 60),
      city: cleanText(address.city ?? parlor.address.city, 60),
      state: cleanText(address.state ?? parlor.address.state, 60),
      pincode: cleanText(address.pincode ?? parlor.address.pincode, 10),
    };
  }
  if (contact) {
    parlor.contact = {
      phone: cleanText(contact.phone ?? parlor.contact.phone, 20),
      whatsapp: cleanText(contact.whatsapp ?? parlor.contact.whatsapp, 20),
      website: cleanText(contact.website ?? parlor.contact.website, 300),
    };
  }
  if (typeof lat === 'number' && typeof lng === 'number') {
    parlor.location = { type: 'Point', coordinates: [lng, lat] };
  }

  await parlor.save();
  return ok(res, { parlor: present(parlor), message: 'Listing updated.' });
});

/** DELETE /api/parlors/:id — hidden, not destroyed. */
export const removeParlor = asyncHandler(async (req, res) => {
  const parlor = await ownedParlor(req.user, req.params.id);
  parlor.isActive = false;
  await parlor.save();
  return ok(res, { removed: true, message: 'Listing hidden.' });
});

/** GET /api/parlors/mine/list */
export const myParlors = asyncHandler(async (req, res) => {
  const rows = await Parlor.find({ addedBy: req.user._id }).sort({ createdAt: -1 }).lean();
  return ok(res, rows.map((p) => {
    const body = present(p);
    body.moderationStatus = p.moderationStatus;
    body.moderationNote = p.moderationNote;
    return body;
  }));
});

/* ── Moderation ──────────────────────────────────────────────── */

/** GET /api/parlors/admin/queue */
export const parlorQueue = asyncHandler(async (req, res) => {
  const rows = await Parlor.find({ moderationStatus: 'pending' })
    .populate('addedBy', 'name email isVerified')
    .sort({ createdAt: -1 }).limit(100).lean();
  return ok(res, rows);
});

/** PATCH /api/parlors/:id/moderate */
export const moderateParlor = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid parlor id');
  const parlor = await Parlor.findById(req.params.id);
  if (!parlor) throw ApiError.notFound('Parlor not found');

  const approve = req.body.decision === 'approve';
  parlor.moderationStatus = approve ? 'approved' : 'rejected';
  parlor.isActive = approve;
  parlor.moderationNote = cleanText(req.body.note || '', 300);
  parlor.moderatedAt = new Date();
  parlor.moderatedBy = req.user._id;
  await parlor.save();

  return ok(res, {
    parlor: present(parlor),
    message: approve ? `${parlor.name} is now listed.` : `${parlor.name} was rejected.`,
  });
});
