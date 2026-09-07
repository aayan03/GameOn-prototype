import { z } from 'zod';
import { Venue, Event, Parlor, TeamUpPost } from '../models/index.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { safeRegex } from '../utils/sanitize.js';

/**
 * One search box for the whole site.
 *
 * Four collections, one shape out. The palette on the front end renders every
 * result with the same card, so normalising here — rather than teaching the
 * client four different response shapes — keeps the display code honest.
 *
 * Each collection is queried with EXACTLY the visibility filter its own list
 * endpoint uses. A search that surfaced a pending venue would be a moderation
 * bypass: the row is hidden from /api/venues precisely so nobody can send
 * money to a listing that has not been reviewed, and a second door into the
 * same row is still a door.
 */

export const searchSchema = z.object({
  // Two characters is the floor: a single letter matches most of the database
  // and tells the searcher nothing.
  q: z.string().trim().min(2).max(80),
  // Per group, not overall — the palette shows a few of each rather than
  // twenty venues and nothing else.
  limit: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(10).optional()
  ),
  types: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
    z.array(z.enum(['venue', 'event', 'parlor', 'game'])).optional()
  ),
});

const VENUE_MATCH = { isActive: true, moderationStatus: { $nin: ['pending', 'rejected'] } };

const where = (...parts) => parts.filter(Boolean).join(' · ');

/* ── Per-collection searches ──────────────────────────────────────
   Each returns already-normalised rows. `.lean()` throughout: nothing
   here needs a document, and search runs on every keystroke.

   Every one of them matches the SPORT or GAME as well as the name, because
   that is what people type. Searching "snooker" against names alone found
   one parlour out of the three that actually have a snooker table — the
   other two are called Cue Masters Club and Rack & Roll. A regex against an
   array field matches if any element matches, which is exactly the
   behaviour wanted here. */

async function searchVenues(rx, limit) {
  const rows = await Venue.find({
    ...VENUE_MATCH,
    $or: [{ name: rx }, { 'address.area': rx }, { 'address.city': rx }, { sports: rx }],
  })
    .select('name slug address sports startingPrice rating images')
    .sort({ rating: -1 })
    .limit(limit)
    .lean();

  return rows.map((v) => ({
    id: String(v._id),
    type: 'venue',
    title: v.name,
    subtitle: where(v.address?.area, v.address?.city),
    meta: v.startingPrice ? `From ₹${v.startingPrice}` : '',
    to: `/venues/${v.slug || v._id}`,
    sports: v.sports || [],
  }));
}

async function searchEvents(rx, limit) {
  const rows = await Event.find({
    isActive: true,
    moderationStatus: { $nin: ['pending', 'rejected'] },
    isCancelled: { $ne: true },
    // Past events are not something anyone is searching for. They stay
    // reachable by direct link; they just do not clutter the palette.
    startsAt: { $gte: new Date() },
    $or: [{ title: rx }, { 'location.name': rx }, { 'location.city': rx }, { sport: rx }, { type: rx }],
  })
    .select('title slug startsAt location type')
    .sort({ startsAt: 1 })
    .limit(limit)
    .lean();

  return rows.map((e) => ({
    id: String(e._id),
    type: 'event',
    title: e.title,
    subtitle: where(e.location?.name, e.location?.city),
    meta: new Date(e.startsAt).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short',
    }),
    to: `/events/${e.slug || e._id}`,
  }));
}

async function searchParlors(rx, limit) {
  const rows = await Parlor.find({
    isActive: true,
    moderationStatus: { $nin: ['pending', 'rejected'] },
    isPermanentlyClosed: false,
    $or: [{ name: rx }, { 'address.area': rx }, { 'address.city': rx }, { games: rx }],
  })
    .select('name slug address games priceFrom')
    .limit(limit)
    .lean();

  return rows.map((p) => ({
    id: String(p._id),
    type: 'parlor',
    title: p.name,
    subtitle: where(p.address?.area, p.address?.city),
    meta: p.priceFrom ? `From ₹${p.priceFrom}/hr` : '',
    to: `/parlors/${p.slug || p._id}`,
    games: p.games || [],
  }));
}

async function searchGames(rx, limit) {
  const rows = await TeamUpPost.find({
    status: 'open',
    playAt: { $gte: new Date() },
    $or: [{ title: rx }, { proposedArea: rx }, { sport: rx }],
  })
    .select('title sport playAt proposedArea spotsNeeded spotsFilled')
    .sort({ playAt: 1 })
    .limit(limit)
    .lean();

  return rows.map((g) => ({
    id: String(g._id),
    type: 'game',
    title: g.title,
    subtitle: where(g.sport, g.proposedArea),
    meta: `${Math.max(0, g.spotsNeeded - g.spotsFilled)} spots left`,
    to: `/teamup/${g._id}`,
  }));
}

const SEARCHERS = {
  venue: searchVenues,
  event: searchEvents,
  parlor: searchParlors,
  game: searchGames,
};

export const search = asyncHandler(async (req, res) => {
  const { q, limit = 5, types } = req.validatedQuery || {};
  // Escaped and length-capped before it reaches Mongo — see utils/sanitize.js.
  // A raw user string compiled into a RegExp is a ReDoS waiting to happen, and
  // this endpoint is unauthenticated and fires on every keystroke.
  const rx = safeRegex(q);

  const wanted = types?.length ? types : Object.keys(SEARCHERS);

  // In parallel: four independent indexed lookups, and the slowest one is the
  // response time either way.
  const settled = await Promise.all(
    wanted.map((type) => SEARCHERS[type](rx, limit))
  );

  const results = Object.fromEntries(wanted.map((type, i) => [type, settled[i]]));
  const total = settled.reduce((sum, rows) => sum + rows.length, 0);

  return ok(res, { query: q, total, results });
});
