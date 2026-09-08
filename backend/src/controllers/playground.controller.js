import { z } from 'zod';
import mongoose from 'mongoose';
import { Playground, User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { safeRegex, escapeRegex } from '../utils/sanitize.js';
import { SPORT_KEYS, PLAYGROUND_FACILITIES } from '../config/constants.js';
import * as notify from '../services/notification.service.js';
import * as email from '../services/email.service.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Community-submitted free public grounds.
 *
 * Nothing here is bookable and nothing takes money — see the note on
 * models/Playground.js. What this file is mostly about is the two ways a
 * community map goes wrong: the same park submitted nine times, and somebody
 * using it to publish an address for reasons of their own. Hence the
 * proximity check and the moderation queue.
 */

const numeric = (schema) => z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : Number(v)), schema
);

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM').or(z.literal(''));

export const listPlaygroundsSchema = z.object({
  q: z.string().max(80).optional(),
  sport: z.enum(SPORT_KEYS).optional(),
  city: z.string().max(60).optional(),
  facilities: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(z.enum(PLAYGROUND_FACILITIES)).optional()
  ),
  lat: numeric(z.number().min(-90).max(90).optional()),
  lng: numeric(z.number().min(-180).max(180).optional()),
  radiusKm: numeric(z.number().min(0.5).max(100).optional()),
  page: numeric(z.number().int().min(1).optional()),
  limit: numeric(z.number().int().min(1).max(50).optional()),
});

export const createPlaygroundSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1500).optional(),
  sports: z.array(z.enum(SPORT_KEYS)).min(1, 'Pick at least one sport').max(8),
  facilities: z.array(z.enum(PLAYGROUND_FACILITIES)).max(10).optional(),
  address: z.object({
    line1: z.string().max(200).optional(),
    area: z.string().max(80).optional(),
    city: z.string().max(60).optional(),
    state: z.string().max(60).optional(),
    pincode: z.string().max(10).optional(),
  }).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  access: z.object({
    alwaysOpen: z.boolean().optional(),
    opensAt: timeString.optional(),
    closesAt: timeString.optional(),
    notes: z.string().max(300).optional(),
  }).optional(),
  surface: z.enum(['grass', 'mud', 'concrete', 'asphalt', 'sand', 'synthetic', 'mixed', 'other']).optional(),
});

export const updatePlaygroundSchema = createPlaygroundSchema.partial();

export const moderatePlaygroundSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(300).optional(),
});

export const unpublishSchema = z.object({ note: z.string().max(300).optional() });
export const correctionSchema = z.object({ text: z.string().trim().min(10).max(500) });

/** Live and reviewed. Everything public goes through this. */
const PUBLIC_MATCH = { isActive: true, moderationStatus: 'approved' };

/**
 * How close counts as "the same place".
 *
 * 120m is about the width of a park. Tighter and the same ground submitted
 * from opposite gates reads as two; looser and two genuinely separate courts
 * in one sports complex collapse into one.
 */
const DUPLICATE_RADIUS_M = 120;

/** Pending submissions one account may have open at once. */
const MAX_PENDING_PER_USER = 5;

/** Strips the moderation trail from anything a stranger reads. */
function present(doc) {
  const p = doc.toObject ? doc.toObject() : doc;
  delete p.moderationNote;
  delete p.moderatedBy;
  delete p.reportCount;
  delete p.reportedBy;
  return p;
}

/* ── Public ───────────────────────────────────────────────────── */

export const listPlaygrounds = asyncHandler(async (req, res) => {
  const f = req.validatedQuery || {};
  const limit = f.limit || 24;
  const page = f.page || 1;

  const match = { ...PUBLIC_MATCH };
  if (f.sport) match.sports = f.sport;
  // Escaped — a raw string here is both a ReDoS and a filter bypass.
  if (f.city) match['address.city'] = new RegExp(`^${escapeRegex(f.city)}$`, 'i');
  if (f.facilities?.length) match.facilities = { $all: f.facilities };
  if (f.q) {
    const rx = safeRegex(f.q);
    match.$or = [{ name: rx }, { 'address.area': rx }, { 'address.city': rx }];
  }

  const hasGeo = typeof f.lat === 'number' && typeof f.lng === 'number';
  const pipeline = [];

  if (hasGeo) {
    pipeline.push({
      $geoNear: {
        near: { type: 'Point', coordinates: [f.lng, f.lat] },
        distanceField: 'distanceM',
        maxDistance: (f.radiusKm || 25) * 1000,
        query: match,
        spherical: true,
      },
    });
  } else {
    pipeline.push({ $match: match }, { $sort: { createdAt: -1 } });
  }

  pipeline.push(
    { $skip: (page - 1) * limit },
    { $limit: limit },
    { $project: { moderationNote: 0, moderatedBy: 0, reportCount: 0, reportedBy: 0 } },
  );

  const [rows, total] = await Promise.all([
    Playground.aggregate(pipeline),
    Playground.countDocuments(match),
  ]);

  return ok(res, rows.map((r) => ({
    ...r,
    distanceKm: r.distanceM != null ? +(r.distanceM / 1000).toFixed(2) : undefined,
  })), { page, limit, total, pages: Math.ceil(total / limit) });
});

export const getPlayground = asyncHandler(async (req, res) => {
  const { idOrSlug } = req.params;
  const query = /^[0-9a-fA-F]{24}$/.test(idOrSlug)
    ? { _id: idOrSlug }
    : { slug: String(idOrSlug).slice(0, 140) };

  const pg = await Playground.findOne(query).populate('submittedBy', 'name avatar');
  // The person who submitted it can see their own while it waits, so they
  // can check what they sent. Nobody else can.
  const mine = req.user && String(pg?.submittedBy?._id || pg?.submittedBy) === String(req.user._id);
  const visible = pg && pg.isActive && pg.moderationStatus === 'approved';
  if (!pg || (!visible && !mine && req.user?.role !== 'admin')) {
    throw ApiError.notFound('Playground not found');
  }

  const body = present(pg);
  if (mine || req.user?.role === 'admin') {
    body.moderationStatus = pg.moderationStatus;
    body.moderationNote = pg.moderationNote;
  }
  return ok(res, body);
});

export const playgroundCities = asyncHandler(async (req, res) => {
  const rows = await Playground.aggregate([
    { $match: { ...PUBLIC_MATCH, 'address.city': { $ne: '' } } },
    { $group: { _id: '$address.city', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 40 },
  ]);
  return ok(res, rows.map((r) => ({ city: r._id, playgrounds: r.count })));
});

/* ── Contributing ─────────────────────────────────────────────── */

export const createPlayground = asyncHandler(async (req, res) => {
  const { lat, lng, ...rest } = req.body;

  /**
   * One account, five open submissions. Not a spam limit — the rate limiter
   * does that — but a queue limit: somebody who has sent five and had none
   * reviewed should hear back before sending a sixth, or the queue fills
   * with one person's guesses.
   */
  const pending = await Playground.countDocuments({
    submittedBy: req.user._id, moderationStatus: 'pending',
  });
  if (pending >= MAX_PENDING_PER_USER) {
    throw ApiError.badRequest(
      `You have ${pending} submissions still being reviewed. `
      + 'Once we have looked at those you can add more.'
    );
  }

  /**
   * Is this already on the map?
   *
   * Checked against pending rows too, not just live ones — two people
   * submitting the same new park within an hour of each other is the common
   * case, and catching it here saves an admin reviewing the same ground
   * twice. Matched on distance ALONE rather than distance-and-name: the same
   * ground gets called "Nehru Park", "nehru park ground" and "the park near
   * the school", and none of those match as strings.
   */
  const near = await Playground.findOne({
    moderationStatus: { $in: ['pending', 'approved'] },
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: DUPLICATE_RADIUS_M,
      },
    },
  }).select('name slug moderationStatus').lean();

  if (near) {
    throw ApiError.conflict(
      near.moderationStatus === 'approved'
        ? `"${near.name}" is already listed within ${DUPLICATE_RADIUS_M}m of that spot. `
          + 'If something about it is wrong, tell us on its page rather than adding it again.'
        : `Somebody has already submitted a ground within ${DUPLICATE_RADIUS_M}m of that spot `
          + 'and it is waiting to be reviewed. Thanks — no need to send it twice.'
    );
  }

  const pg = await Playground.create({
    ...rest,
    location: { type: 'Point', coordinates: [lng, lat] },
    submittedBy: req.user._id,
    // Stated rather than inherited. Nothing a stranger submits goes live on
    // its own, whatever the request body said.
    moderationStatus: 'pending',
    isActive: false,
  });

  /**
   * Tell the admins there is something to look at.
   *
   * Without this the queue is a page somebody has to remember to visit, and
   * a contributor who was promised "usually within a day" waits a week. Fanned
   * out to every admin rather than one, because whoever gets to it first
   * should be able to.
   *
   * Deliberately after the row is written and NOT awaited into the response
   * path's success: a notification that fails must not lose the submission.
   */
  const admins = await User.find({ role: 'admin' }).select('_id name email').lean();
  notify.notifyMany(admins.map((a) => a._id), 'playground_submitted', {
    title: 'New ground to review',
    body: `${pg.name}${pg.address?.city ? ` in ${pg.address.city}` : ''} was submitted by ${req.user.name}.`,
    link: '/admin',
  }).catch(() => { /* logged inside the service */ });

  // And by email, because an in-app notification only reaches an admin who
  // opens the app. Fire and forget: a mail failure must not lose the row.
  const reviewUrl = `${(env.APP_URL || '').replace(/\/$/, '')}/admin`;
  for (const a of admins) {
    if (!a.email) continue;
    email.deliver({
      to: a.email,
      ...email.playgroundSubmittedEmail({
        name: a.name,
        ground: pg.name,
        city: pg.address?.city,
        submitter: req.user.name,
        url: reviewUrl,
      }),
    }).catch((err) => logger.warn('playground review email failed', { err: err.message }));
  }

  return created(res, {
    playground: present(pg),
    message: 'Thanks — sent for review. We will let you know once it is live, usually within a day.',
  });
});

/** GET /api/playgrounds/mine — what I have sent in, and where it got to. */
export const mySubmissions = asyncHandler(async (req, res) => {
  const rows = await Playground.find({ submittedBy: req.user._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return ok(res, rows);
});

/**
 * Corrections, while it is still in the queue.
 *
 * Once a listing is live it is no longer the submitter's to rewrite — see
 * the note on models/Playground.js. Changes to a published ground go to an
 * admin, which is also what stops a listing being approved as a park and
 * quietly edited into something else afterwards.
 */
export const updatePlayground = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const pg = await Playground.findById(req.params.id);
  if (!pg) throw ApiError.notFound('Playground not found');

  const isAdmin = req.user.role === 'admin';
  const isSubmitter = String(pg.submittedBy) === String(req.user._id);
  if (!isAdmin && !isSubmitter) throw ApiError.forbidden('That is not your submission');
  if (!isAdmin && pg.moderationStatus !== 'pending') {
    throw ApiError.forbidden(
      'This one has already been reviewed. Tell us what needs fixing and we will update it.'
    );
  }

  const { lat, lng, ...rest } = req.body;
  Object.assign(pg, rest);
  if (typeof lat === 'number' && typeof lng === 'number') {
    pg.location = { type: 'Point', coordinates: [lng, lat] };
  }
  await pg.save();
  return ok(res, present(pg));
});

/** Somebody says this is wrong, gone, or not actually public. */
/**
 * Reports needed before the admins are pulled in.
 *
 * One is noise — somebody found the gate shut on a bank holiday. Three
 * separate people is a pattern worth a human looking at. It still does not
 * unpublish anything on its own: a listing that disappears on a vote is a
 * listing anybody can delete with three accounts.
 */
const REPORTS_BEFORE_ALERT = 3;

export const reportPlayground = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  /**
   * The filter carries the guard: the count only moves for someone who has
   * not reported this ground before. Incrementing first and de-duplicating
   * afterwards would let one person reach the alert threshold alone by
   * tapping three times.
   */
  const pg = await Playground.findOneAndUpdate(
    { _id: req.params.id, reportedBy: { $ne: req.user._id } },
    { $inc: { reportCount: 1 }, $addToSet: { reportedBy: req.user._id } },
    { new: true }
  );

  if (!pg) {
    // Either it does not exist, or this person already told us. Both get the
    // same friendly answer — "you already reported this" is not worth a
    // different screen, and it does not confirm the row exists to a stranger.
    const exists = await Playground.exists({ _id: req.params.id });
    if (!exists) throw ApiError.notFound('Playground not found');
    return ok(res, { reported: true, message: 'Thanks — you have already reported this one.' });
  }

  // Exactly at the threshold, so the admins are told once rather than on
  // every report after it.
  if (pg.reportCount === REPORTS_BEFORE_ALERT) {
    const admins = await User.find({ role: 'admin' }).select('_id').lean();
    notify.notifyMany(admins.map((a) => a._id), 'playground_submitted', {
      title: 'A listed ground is being reported',
      body: `${pg.name} has been reported ${pg.reportCount} times. It is still live.`,
      link: '/admin',
    }).catch(() => {});
  }

  return ok(res, { reported: true, message: 'Thanks — we will take a look.' });
});

/**
 * PATCH /api/playgrounds/:id/unpublish — take a live ground off the map.
 *
 * Separate from `moderate` on purpose. Rejecting is a decision about a
 * submission; this is about a ground that WAS fine and is not any more — it
 * closed, it turned out to be private, it got built on. Reversible by
 * approving it again, and the moderation trail records both.
 */
export const unpublishPlayground = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const pg = await Playground.findById(req.params.id);
  if (!pg) throw ApiError.notFound('Playground not found');

  pg.isActive = false;
  pg.moderationStatus = 'rejected';
  pg.moderationNote = req.body?.note || 'Taken off the map after review.';
  pg.moderatedAt = new Date();
  pg.moderatedBy = req.user._id;
  await pg.save();

  // The contributor put it there; they should hear that it came down.
  await notify.notify(pg.submittedBy, 'playground_rejected', {
    title: 'A ground you added was taken down',
    body: `${pg.name} is no longer on the map. ${pg.moderationNote}`,
    link: '/playgrounds/mine',
  });

  return ok(res, { playground: pg, message: `${pg.name} is no longer listed.` });
});

/**
 * POST /api/playgrounds/:id/correction — "this is wrong, here is what changed".
 *
 * A live listing is not the submitter's to rewrite, but a ground that has
 * gained floodlights or lost its nets should not stay wrong until somebody
 * notices. This routes a description to the admins rather than editing
 * anything, so the published row still only ever changes by a human decision.
 */
export const suggestCorrection = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const pg = await Playground.findById(req.params.id).select('name');
  if (!pg) throw ApiError.notFound('Playground not found');

  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (text.length < 10) throw ApiError.badRequest('Tell us a little more about what is wrong.');

  const admins = await User.find({ role: 'admin' }).select('_id').lean();
  await notify.notifyMany(admins.map((a) => a._id), 'playground_submitted', {
    title: `Correction suggested: ${pg.name}`,
    body: `${req.user.name}: ${text}`,
    link: '/admin',
  });

  return ok(res, { sent: true, message: 'Thanks — we will check it.' });
});

/* ── Admin ────────────────────────────────────────────────────── */

export const playgroundQueue = asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  const match = status === 'all' ? {} : { moderationStatus: status };
  const rows = await Playground.find(match)
    .populate('submittedBy', 'name email')
    .sort({ reportCount: -1, createdAt: 1 })
    .limit(100)
    .lean();
  return ok(res, rows);
});

export const moderatePlayground = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid id');

  const pg = await Playground.findById(req.params.id);
  if (!pg) throw ApiError.notFound('Playground not found');

  const approve = decision === 'approve';
  pg.moderationStatus = approve ? 'approved' : 'rejected';
  pg.isActive = approve;
  pg.moderationNote = note || '';
  pg.moderatedAt = new Date();
  pg.moderatedBy = req.user._id;
  await pg.save();

  // The confirmation the contributor was promised when they submitted it.
  await notify.notify(pg.submittedBy, approve ? 'playground_approved' : 'playground_rejected', {
    title: approve ? 'Your playground is live' : 'Your playground needs a change',
    body: approve
      ? `${pg.name} is on the map — thanks for adding it.`
      : `${pg.name} was not published.${pg.moderationNote ? ` ${pg.moderationNote}` : ''}`,
    link: approve ? `/playgrounds/${pg.slug}` : '/playgrounds/mine',
  });

  return ok(res, {
    playground: pg,
    message: approve ? `${pg.name} is now live.` : `${pg.name} was rejected.`,
  });
});
