import { z } from 'zod';
import mongoose from 'mongoose';
import { TeamUpPost, Booking, Venue } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { SPORT_KEYS, SKILL_LEVELS, LOYALTY } from '../config/constants.js';
import { cleanText, safeRegex } from '../utils/sanitize.js';
import * as loyalty from '../services/loyalty.service.js';
import * as wallet from '../services/wallet.service.js';
import * as notify from '../services/notification.service.js';
import logger from '../utils/logger.js';

/* ── Validation ──────────────────────────────────────────────── */

// A host's declared cost becomes a debit on other people's wallets, so it is
// capped regardless of what the client sends.
const MAX_SHARE_PER_PERSON = 3000;

const numeric = (schema) => z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : Number(v)), schema
);

export const listPostsSchema = z.object({
  q: z.string().max(80).optional(),
  sport: z.enum(SPORT_KEYS).optional(),
  type: z.enum(['need_players', 'need_opponent', 'looking_to_join']).optional(),
  skillLevel: z.enum([...SKILL_LEVELS, 'any']).optional(),
  city: z.string().max(60).optional(),
  lat: numeric(z.number().min(-90).max(90).optional()),
  lng: numeric(z.number().min(-180).max(180).optional()),
  radiusKm: numeric(z.number().min(1).max(100).optional()),
  when: z.enum(['today', 'tomorrow', 'week', 'all']).optional(),
  mine: z.enum(['hosting', 'joined']).optional(),
  page: numeric(z.number().int().min(1).optional()),
  limit: numeric(z.number().int().min(1).max(30).optional()),
});

export const createPostSchema = z.object({
  type: z.enum(['need_players', 'need_opponent', 'looking_to_join']),
  sport: z.enum(SPORT_KEYS),
  title: z.string().trim().min(4, 'Give your game a short title').max(120),
  description: z.string().trim().max(1000).optional(),
  bookingRef: z.string().trim().max(40).optional(),   // link an existing booking
  venueId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  proposedArea: z.string().trim().max(120).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  playAt: z.string().datetime({ offset: true }).or(z.string().min(10)),
  durationMins: z.number().int().min(30).max(300).optional(),
  spotsNeeded: z.number().int().min(1, 'You need at least one spot').max(30),
  skillLevel: z.enum([...SKILL_LEVELS, 'any']).optional(),
  genderPreference: z.enum(['any', 'male', 'female', 'mixed']).optional(),
  costSharing: z.object({
    enabled: z.boolean(),
    totalAmount: z.number().min(0).max(100000),
  }).optional(),
  autoApprove: z.boolean().optional(),
}).strict();

export const joinSchema = z.object({
  message: z.string().trim().max(300).optional(),
  spots: z.number().int().min(1).max(10).optional(),
}).strict();

export const decideSchema = z.object({
  decision: z.enum(['accept', 'decline']),
}).strict();

/* ── Helpers ─────────────────────────────────────────────────── */

/** Shapes a post for the feed — never leaks other players' contact details. */
function present(post, viewerId) {
  const isHost = viewerId && String(post.host?._id || post.host) === String(viewerId);

  const myRequest = viewerId
    ? post.joinRequests?.find((r) => String(r.user?._id || r.user) === String(viewerId))
    : null;

  return {
    _id: post._id,
    type: post.type,
    sport: post.sport,
    title: post.title,
    description: post.description,
    host: post.host,
    venue: post.venue,
    booking: post.booking,
    proposedArea: post.proposedArea,
    location: post.location,
    playAt: post.playAt,
    durationMins: post.durationMins,
    spotsNeeded: post.spotsNeeded,
    spotsFilled: post.spotsFilled,
    spotsRemaining: Math.max(0, post.spotsNeeded - post.spotsFilled),
    skillLevel: post.skillLevel,
    genderPreference: post.genderPreference,
    costSharing: post.costSharing,
    status: post.status,
    autoApprove: post.autoApprove,
    confirmedPlayers: post.confirmedPlayers,
    createdAt: post.createdAt,
    distanceKm: post.distanceKm ?? null,
    isHost,
    // Only the host sees the full request list; everyone else sees just theirs.
    joinRequests: isHost ? post.joinRequests : undefined,
    pendingCount: isHost
      ? (post.joinRequests || []).filter((r) => r.status === 'pending').length
      : undefined,
    myRequest: myRequest
      ? { _id: myRequest._id, status: myRequest.status, spots: myRequest.spots, message: myRequest.message }
      : null,
  };
}

/**
 * Grants the host bonus at most once per post, and only once a real player
 * has joined. The flag is set inside the update filter so two simultaneous
 * joins cannot both award it.
 */
const HOST_BONUS_DAILY_CAP = 3;

async function awardHostBonusOnce(post) {
  const claimed = await TeamUpPost.findOneAndUpdate(
    { _id: post._id, hostBonusAwarded: { $ne: true } },
    { $set: { hostBonusAwarded: true } }
  );
  if (!claimed) return;

  // Once per post is not a bound on its own, because posting is unlimited.
  // Cap how many host bonuses one account can earn in a day, or post-join-
  // withdraw-repeat becomes a points faucet.
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const todayCount = await TeamUpPost.countDocuments({
    host: post.host,
    hostBonusAwarded: true,
    updatedAt: { $gte: since },
  });
  if (todayCount > HOST_BONUS_DAILY_CAP) return;

  await loyalty.award(post.host, LOYALTY.TEAMUP_HOST_BONUS, { reason: 'Hosted a TeamUp game' });
}

/**
 * Marks posts whose kickoff has passed, so the feed stays honest.
 *
 * Throttled, and deliberately not awaited by the caller. This ran as a
 * blocking, collection-wide `updateMany` on EVERY load of the feed — so a
 * page that ten people open at once issued ten identical full write passes
 * and each of them waited for it before the first query even started. The
 * sweep is housekeeping: a post that stays "open" for another minute is
 * cosmetic, and the lifecycle job settles the same rows properly anyway.
 */
const EXPIRY_SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;
let sweepInFlight = null;

function expireStalePosts() {
  const now = Date.now();
  if (sweepInFlight || now - lastSweepAt < EXPIRY_SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  sweepInFlight = TeamUpPost.updateMany(
    { status: 'open', playAt: { $lt: new Date() } },
    { $set: { status: 'expired' } }
  )
    // Never let a housekeeping failure surface as a failed feed request.
    .catch((err) => logger.error('teamup expiry sweep failed', { err }))
    .finally(() => { sweepInFlight = null; });
}

/* ── Endpoints ───────────────────────────────────────────────── */

/** GET /api/teamup — the feed. */
export const listPosts = asyncHandler(async (req, res) => {
  // Fire and forget — see the note on the function.
  expireStalePosts();

  const f = req.validatedQuery || {};
  const page = f.page || 1;
  const limit = f.limit || 12;
  const skip = (page - 1) * limit;

  const match = {};

  // "mine" views require a session — without one the filter value would be
  // undefined, which Mongoose strips, leaving an unfiltered query that also
  // skipped the status/date floor below.
  if (f.mine && !req.user) {
    throw ApiError.unauthorized('Log in to see your own games');
  }

  if (f.mine === 'hosting') {
    match.host = req.user._id;
  } else if (f.mine === 'joined') {
    match['joinRequests.user'] = req.user._id;
  } else {
    match.status = 'open';
    match.playAt = { $gte: new Date() };
  }

  if (f.sport) match.sport = f.sport;
  if (f.type) match.type = f.type;
  if (f.skillLevel && f.skillLevel !== 'any') match.skillLevel = { $in: [f.skillLevel, 'any'] };
  if (f.q) match.title = safeRegex(f.q);

  if (f.when && f.when !== 'all' && !f.mine) {
    const start = new Date();
    const end = new Date();
    if (f.when === 'today') end.setHours(23, 59, 59, 999);
    else if (f.when === 'tomorrow') {
      start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + 1); end.setHours(23, 59, 59, 999);
    } else { end.setDate(end.getDate() + 7); }
    match.playAt = { $gte: start, $lte: end };
  }

  const hasGeo = typeof f.lat === 'number' && typeof f.lng === 'number';
  let posts;
  let total;

  if (hasGeo) {
    const pipeline = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [f.lng, f.lat] },
          distanceField: 'distanceMeters',
          maxDistance: (f.radiusKm || 25) * 1000,
          spherical: true,
          query: match,
        },
      },
      { $addFields: { distanceKm: { $round: [{ $divide: ['$distanceMeters', 1000] }, 2] } } },
      { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'c' }] } },
    ];
    const [agg] = await TeamUpPost.aggregate(pipeline);
    posts = await TeamUpPost.populate(agg?.items || [], [
      { path: 'host', select: 'name avatar skillLevel reliabilityScore gamesPlayed loyaltyTier city' },
      { path: 'venue', select: 'name slug address images' },
    ]);
    total = agg?.total?.[0]?.c || 0;
  } else {
    [posts, total] = await Promise.all([
      TeamUpPost.find(match)
        .populate('host', 'name avatar skillLevel reliabilityScore gamesPlayed loyaltyTier city')
        .populate('venue', 'name slug address images')
        .sort({ playAt: 1 })
        .skip(skip).limit(limit)
        .lean(),
      TeamUpPost.countDocuments(match),
    ]);
  }

  return ok(
    res,
    posts.map((p) => present(p, req.user?._id)),
    { page, limit, total, pages: Math.ceil(total / limit) || 1 }
  );
});

/** GET /api/teamup/:id */
export const getPost = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid post id');

  const post = await TeamUpPost.findById(req.params.id)
    .populate('host', 'name avatar skillLevel reliabilityScore gamesPlayed loyaltyTier city position')
    .populate('venue', 'name slug address images location')
    .populate('joinRequests.user', 'name avatar skillLevel reliabilityScore gamesPlayed loyaltyTier position')
    .populate('confirmedPlayers', 'name avatar skillLevel position loyaltyTier')
    .lean();

  if (!post) throw ApiError.notFound('That game is no longer listed');
  return ok(res, present(post, req.user?._id));
});

/** POST /api/teamup — publish an open game. */
export const createPost = asyncHandler(async (req, res) => {
  const body = req.body;

  const playAt = new Date(body.playAt);
  if (Number.isNaN(playAt.getTime())) throw ApiError.badRequest('Enter a valid date and time');
  if (playAt < new Date()) throw ApiError.badRequest('Pick a time in the future');
  if (playAt > new Date(Date.now() + 60 * 86400000)) {
    throw ApiError.badRequest('Games can be posted up to 60 days ahead');
  }

  let venue = null;
  let booking = null;
  let coordinates = [body.lng ?? 77.5946, body.lat ?? 12.9716];

  // If the host already holds a booking, verify they actually own it before
  // attaching it — otherwise anyone could advertise someone else's slot.
  if (body.bookingRef) {
    const rows = await Booking.find({ groupRef: body.bookingRef }).limit(1);
    if (!rows.length) throw ApiError.notFound('That booking was not found');
    if (String(rows[0].user) !== String(req.user._id)) {
      throw ApiError.forbidden('You can only link your own bookings');
    }
    if (!['pending', 'confirmed'].includes(rows[0].status)) {
      throw ApiError.badRequest('That booking is no longer active');
    }
    booking = rows[0];
    venue = await Venue.findById(booking.venue).select('name location address');
  } else if (body.venueId) {
    venue = await Venue.findById(body.venueId).select('name location address isActive');
    if (!venue || !venue.isActive) throw ApiError.notFound('Venue not found');
  }

  if (venue?.location?.coordinates) coordinates = venue.location.coordinates;

  const spotsNeeded = body.spotsNeeded;

  // A host declares the cost, and joiners are later debited their share, so
  // this figure is bounded. When a real booking is linked, it cannot exceed
  // what that booking actually cost.
  let totalAmount = body.costSharing?.enabled ? body.costSharing.totalAmount : 0;
  if (booking) {
    const groupTotal = await Booking.aggregate([
      { $match: { groupRef: booking.groupRef } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]);
    totalAmount = Math.min(totalAmount, groupTotal?.[0]?.total || totalAmount);
  }
  const perPerson = totalAmount ? Math.ceil(totalAmount / (spotsNeeded + 1)) : 0;
  if (perPerson > MAX_SHARE_PER_PERSON) {
    throw ApiError.badRequest(`A player's share cannot exceed ₹${MAX_SHARE_PER_PERSON}`);
  }

  const post = await TeamUpPost.create({
    host: req.user._id,
    type: body.type,
    sport: body.sport,
    title: cleanText(body.title, 120),
    description: cleanText(body.description || '', 1000),
    booking: booking?._id || null,
    venue: venue?._id || null,
    proposedArea: cleanText(body.proposedArea || venue?.address?.area || '', 120),
    location: { type: 'Point', coordinates },
    playAt,
    durationMins: body.durationMins || 60,
    spotsNeeded,
    skillLevel: body.skillLevel || 'any',
    genderPreference: body.genderPreference || 'any',
    autoApprove: Boolean(body.autoApprove),
    costSharing: {
      enabled: Boolean(body.costSharing?.enabled),
      totalAmount,
      perPersonAmount: perPerson,   // +1 in the divisor because the host plays too
    },
    status: 'open',
  });

  // No points for merely creating a post. The host bonus is granted once a
  // real player joins (see decideRequest / requestToJoin), otherwise posting
  // and deleting in a loop is a points faucet.

  const populated = await TeamUpPost.findById(post._id)
    .populate('host', 'name avatar skillLevel reliabilityScore gamesPlayed loyaltyTier city')
    .populate('venue', 'name slug address images')
    .lean();

  return created(res, present(populated, req.user._id));
});

/** DELETE /api/teamup/:id — the host cancels their game. */
export const cancelPost = asyncHandler(async (req, res) => {
  const post = await TeamUpPost.findById(req.params.id);
  if (!post) throw ApiError.notFound('Post not found');
  if (String(post.host) !== String(req.user._id) && req.user.role !== 'admin') {
    throw ApiError.forbidden('Only the host can cancel this game');
  }
  if (post.status === 'cancelled') throw ApiError.badRequest('This game is already cancelled');

  // Capture the audience BEFORE emptying the game. Reading
  // `post.confirmedPlayers` after clearing it meant the notification went to
  // the join-request list only — the people who had actually been given a
  // spot, and who most needed telling, were never notified.
  const audience = [
    ...(post.confirmedPlayers || []),
    // Only people still waiting on an answer. Someone declined three weeks
    // ago, or who withdrew themselves, does not need telling that a game they
    // were never in is off.
    ...post.joinRequests.filter((r) => ['pending', 'accepted'].includes(r.status)).map((r) => r.user),
  ];

  post.status = 'cancelled';
  post.joinRequests.forEach((r) => { if (r.status === 'pending') r.status = 'declined'; });
  // Nobody is playing this game any more, so nobody can be charged for it.
  post.confirmedPlayers = [];
  post.spotsFilled = 0;
  await post.save();

  // Take the host bonus back — cancelling should not be profitable.
  if (post.hostBonusAwarded) {
    await loyalty.revoke(post.host, LOYALTY.TEAMUP_HOST_BONUS, { reason: 'TeamUp game cancelled' });
    await TeamUpPost.updateOne({ _id: post._id }, { $set: { hostBonusAwarded: false } });
  }

  await notify.notifyMany(
    audience,
    'teamup_declined',
    { title: 'Game cancelled', body: `"${post.title}" was cancelled by the host.`, link: '/teamup' }
  );

  return ok(res, { cancelled: true, message: 'Game cancelled. Everyone who asked to join has been told.' });
});

/**
 * POST /api/teamup/:id/join
 * Atomic: the spot count is checked and incremented in the same update when
 * auto-approve is on, so a popular game can't be over-filled by a race.
 */
export const requestToJoin = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid post id');

  const spots = req.body.spots || 1;
  const message = cleanText(req.body.message || '', 300);

  const post = await TeamUpPost.findById(req.params.id);
  if (!post) throw ApiError.notFound('That game is no longer listed');
  if (post.status !== 'open') throw ApiError.badRequest('This game is not open for new players');
  if (new Date(post.playAt) < new Date()) throw ApiError.badRequest('This game has already started');
  if (String(post.host) === String(req.user._id)) {
    throw ApiError.badRequest("You're hosting this game — you're already in");
  }

  const existing = post.joinRequests.find((r) => String(r.user) === String(req.user._id));
  if (existing && existing.status === 'pending') throw ApiError.conflict('You have already asked to join');
  if (existing && existing.status === 'accepted') throw ApiError.conflict("You're already in this game");

  const remaining = post.spotsNeeded - post.spotsFilled;
  if (spots > remaining) {
    throw ApiError.badRequest(`Only ${remaining} spot${remaining === 1 ? '' : 's'} left`);
  }

  const entry = {
    user: req.user._id,
    message,
    spots,
    status: post.autoApprove ? 'accepted' : 'pending',
    wasAccepted: Boolean(post.autoApprove),
    // Freeze the share at the moment the spot is taken, exactly as
    // decideRequest does when a host accepts by hand.
    //
    // This was missing, and auto-approve is the path where it matters most:
    // the entry was written with the schema default of 0, settleCosts read
    // `r.agreedShare ?? perPersonAmount` — which does NOT fall back on zero —
    // and every auto-approved player was skipped as owing nothing. A host
    // running an auto-approve game with cost sharing on collected nothing
    // from anybody, and no error was raised anywhere.
    agreedShare: post.autoApprove ? (post.costSharing?.perPersonAmount || 0) : 0,
    requestedAt: new Date(),
    respondedAt: post.autoApprove ? new Date() : null,
  };

  if (post.autoApprove) {
    // Claim the spots in a single conditional update. The check-then-save
    // version let concurrent joins both pass and over-fill the game.
    const claimed = await TeamUpPost.findOneAndUpdate(
      {
        _id: post._id,
        status: 'open',
        $expr: { $lte: [{ $add: ['$spotsFilled', spots] }, '$spotsNeeded'] },
      },
      {
        $inc: { spotsFilled: spots },
        $addToSet: { confirmedPlayers: req.user._id },
      },
      { new: true }
    );

    if (!claimed) throw ApiError.conflict('Those spots were just taken. Try again.');

    // Record the request entry. Update-then-insert, both conditional, so two
    // concurrent joins from the same account cannot end up with two entries
    // (which would occupy two spots but only ever release one).
    const updated = await TeamUpPost.updateOne(
      { _id: post._id, 'joinRequests.user': req.user._id },
      { $set: {
        'joinRequests.$.status': 'accepted',
        'joinRequests.$.spots': spots,
        'joinRequests.$.message': message,
        'joinRequests.$.respondedAt': new Date(),
        'joinRequests.$.wasAccepted': true,
        'joinRequests.$.agreedShare': post.costSharing?.perPersonAmount || 0,
      } }
    );
    if (!updated.matchedCount) {
      await TeamUpPost.updateOne(
        { _id: post._id, 'joinRequests.user': { $ne: req.user._id } },
        { $push: { joinRequests: entry } }
      );
    }

    if (claimed.spotsFilled >= claimed.spotsNeeded) {
      await TeamUpPost.updateOne({ _id: post._id }, { $set: { status: 'filled' } });
    }

    await awardHostBonusOnce(post);

    return ok(res, {
      status: 'accepted',
      spotsRemaining: Math.max(0, claimed.spotsNeeded - claimed.spotsFilled),
      message: "You're in. See you on the pitch.",
    });
  }

  // Not auto-approve: nothing is claimed yet, so a plain save is safe.
  // `wasAccepted` is deliberately preserved across a re-request: withdrawing
  // the night before and immediately asking to join again used to reset it to
  // false, which erased the late-withdrawal penalty entirely.
  if (existing) Object.assign(existing, { ...entry, wasAccepted: existing.wasAccepted || entry.wasAccepted });
  else post.joinRequests.push(entry);
  await post.save();

  await notify.notify(post.host, 'teamup_request', {
    body: `${req.user.name} wants to join "${post.title}".`,
    link: `/teamup/${post._id}`,
  });

  return ok(res, {
    status: 'pending',
    spotsRemaining: Math.max(0, post.spotsNeeded - post.spotsFilled),
    message: 'Request sent. The host will confirm shortly.',
  });
});

/** DELETE /api/teamup/:id/join — withdraw. */
export const withdrawJoin = asyncHandler(async (req, res) => {
  const post = await TeamUpPost.findById(req.params.id);
  if (!post) throw ApiError.notFound('Post not found');

  const request = post.joinRequests.find((r) => String(r.user) === String(req.user._id));
  if (!request || ['withdrawn', 'declined'].includes(request.status)) {
    throw ApiError.badRequest('You have not asked to join this game');
  }

  if (request.status === 'accepted') {
    post.spotsFilled = Math.max(0, post.spotsFilled - request.spots);
    post.confirmedPlayers = post.confirmedPlayers.filter((p) => String(p) !== String(req.user._id));
    if (post.status === 'filled') post.status = 'open';
  }

  request.status = 'withdrawn';
  request.respondedAt = new Date();
  await post.save();

  // If the last player has left, the host bonus is no longer earned.
  if (post.hostBonusAwarded && post.confirmedPlayers.length === 0) {
    await loyalty.revoke(post.host, LOYALTY.TEAMUP_HOST_BONUS, { reason: 'TeamUp game emptied' });
    await TeamUpPost.updateOne({ _id: post._id }, { $set: { hostBonusAwarded: false } });
  }

  return ok(res, { withdrawn: true, message: 'You have left this game.' });
});

/** PATCH /api/teamup/:id/requests/:requestId — host accepts or declines. */
export const decideRequest = asyncHandler(async (req, res) => {
  const { decision } = req.body;

  const post = await TeamUpPost.findById(req.params.id);
  if (!post) throw ApiError.notFound('Post not found');
  if (String(post.host) !== String(req.user._id)) {
    throw ApiError.forbidden('Only the host can respond to join requests');
  }

  const request = post.joinRequests.id(req.params.requestId);
  if (!request) throw ApiError.notFound('Request not found');
  if (request.status !== 'pending') throw ApiError.badRequest('This request has already been handled');

  if (decision === 'decline') {
    request.status = 'declined';
    request.respondedAt = new Date();
    await post.save();
    await notify.notify(request.user, 'teamup_declined', {
      body: `The host could not fit you into "${post.title}" this time.`,
      link: `/teamup/${post._id}`,
    });
    return ok(res, { status: 'declined', message: 'Request declined.' });
  }

  // Claim the spots atomically, exactly as requestToJoin does.
  // $elemMatch binds both conditions to the SAME request. Without it, an
  // unrelated pending request keeps the filter satisfied and this request
  // can be accepted twice, incrementing spotsFilled each time.
  const claimed = await TeamUpPost.findOneAndUpdate(
    {
      _id: post._id,
      joinRequests: { $elemMatch: { _id: request._id, status: 'pending' } },
      $expr: { $lte: [{ $add: ['$spotsFilled', request.spots] }, '$spotsNeeded'] },
    },
    {
      $inc: { spotsFilled: request.spots },
      $addToSet: { confirmedPlayers: request.user },
      $set: {
        'joinRequests.$[req].status': 'accepted',
        'joinRequests.$[req].respondedAt': new Date(),
        'joinRequests.$[req].wasAccepted': true,
        // Freeze the share this player agreed to, so the host cannot
        // change the cost afterwards and charge more than was shown.
        'joinRequests.$[req].agreedShare': post.costSharing?.perPersonAmount || 0,
      },
    },
    { new: true, arrayFilters: [{ 'req._id': request._id }] }
  );

  if (!claimed) {
    const remaining = post.spotsNeeded - post.spotsFilled;
    throw ApiError.conflict(
      remaining > 0
        ? 'That request was already handled.'
        : 'The game is full — decline this one or free a spot first.'
    );
  }

  if (claimed.spotsFilled >= claimed.spotsNeeded) {
    await TeamUpPost.updateOne({ _id: post._id }, { $set: { status: 'filled' } });
  }

  await awardHostBonusOnce(post);

  await notify.notify(request.user, 'teamup_accepted', {
    body: `You're in for "${post.title}". See you there.`,
    link: `/teamup/${post._id}`,
  });
  if (claimed.spotsFilled >= claimed.spotsNeeded) {
    await notify.notify(post.host, 'teamup_filled', {
      body: `"${post.title}" is full. Time to play.`,
      link: `/teamup/${post._id}`,
    });
  }

  return ok(res, {
    status: 'accepted',
    spotsRemaining: Math.max(0, claimed.spotsNeeded - claimed.spotsFilled),
    message: 'Player added to the game.',
  });
});

/**
 * POST /api/teamup/:id/settle — collect each player's share.
 *
 * Only the host can run it, only once, and only when cost sharing is on.
 * Anyone whose wallet is short is reported back rather than silently skipped.
 */
export const settleCosts = asyncHandler(async (req, res) => {
  const post = await TeamUpPost.findById(req.params.id).populate('venue', 'name');
  if (!post) throw ApiError.notFound('Post not found');
  if (String(post.host) !== String(req.user._id)) {
    throw ApiError.forbidden('Only the host can settle the cost');
  }
  if (!post.costSharing?.enabled || !post.costSharing.perPersonAmount) {
    throw ApiError.badRequest('Cost sharing is not enabled for this game');
  }
  // The status check lives INSIDE the atomic claim. Testing it beforehand
  // leaves a window where a cancel lands between the read and the write and
  // the settle still goes through.
  const claimed = await TeamUpPost.findOneAndUpdate(
    { _id: post._id, costSettledAt: null, status: { $in: ['open', 'filled'] } },
    { $set: { costSettledAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    throw ApiError.badRequest(
      ['cancelled', 'expired'].includes(post.status)
        ? 'This game was cancelled — there is nothing to collect'
        : 'This game has already been settled'
    );
  }

  // Charge each player the share THEY agreed to when they joined, not the
  // current figure. Otherwise a host could raise the cost after people join.
  const agreedBy = new Map(
    (post.joinRequests || [])
      .filter((r) => r.status === 'accepted')
      // `||`, not `??`. A stored 0 means "never recorded" here, not "agreed to
      // pay nothing" — a genuinely free game is caught by the `share <= 0`
      // guard below either way. Rows written before agreedShare was set on
      // the auto-approve path still carry that 0.
      .map((r) => [String(r.user), r.agreedShare || post.costSharing.perPersonAmount])
  );

  const paid = [];
  const failed = [];
  let collected = 0;

  for (const playerId of post.confirmedPlayers) {
    if (String(playerId) === String(req.user._id)) continue;
    const share = agreedBy.get(String(playerId)) || post.costSharing.perPersonAmount;
    if (!share || share <= 0) continue;
    try {
      await wallet.transfer(playerId, req.user._id, share, {
        description: `TeamUp share — ${post.title}`,
        reference: String(post._id),
      });
      paid.push(playerId);
      collected += share;
    } catch {
      failed.push(playerId);
    }
  }

  return ok(res, {
    collected,
    paidCount: paid.length,
    failedCount: failed.length,
    message: failed.length
      ? `Collected ₹${collected}. ${failed.length} player(s) did not have enough balance.`
      : `Collected ₹${collected} from ${paid.length} player(s).`,
  });
});
