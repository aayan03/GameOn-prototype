import { z } from 'zod';
import mongoose from 'mongoose';
import { Event, EventRegistration, Venue } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { cleanText, safeRegex, escapeRegex } from '../utils/sanitize.js';
import { EVENT_TYPE_KEYS, SPORT_KEYS, ROLES } from '../config/constants.js';
import * as notify from '../services/notification.service.js';
import logger from '../utils/logger.js';

/* ── Validation ──────────────────────────────────────────────── */

const numeric = (schema) => z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : Number(v)), schema
);

export const listEventsSchema = z.object({
  q: z.string().max(80).optional(),
  type: z.enum(EVENT_TYPE_KEYS).optional(),
  sport: z.enum(SPORT_KEYS).optional(),
  city: z.string().max(60).optional(),
  when: z.enum(['today', 'week', 'month', 'all']).optional(),
  // 'going' needs a session; 'hosting' is the organiser's own list.
  mine: z.enum(['going', 'hosting']).optional(),
  page: numeric(z.number().int().min(1).optional()),
  limit: numeric(z.number().int().min(1).max(36).optional()),
});

export const createEventSchema = z.object({
  title: z.string().trim().min(4, 'Give the event a title').max(120),
  description: z.string().trim().max(4000).optional(),
  type: z.enum(EVENT_TYPE_KEYS),
  sport: z.enum(SPORT_KEYS).nullable().optional(),
  venueId: z.string().regex(/^[0-9a-fA-F]{24}$/).nullable().optional(),
  location: z.object({
    name: z.string().trim().max(160).optional(),
    address: z.string().trim().max(240).optional(),
    area: z.string().trim().max(60).optional(),
    city: z.string().trim().max(60).optional(),
  }).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  startsAt: z.string().min(10),
  endsAt: z.string().min(10).nullable().optional(),
  capacity: z.number().int().min(0).max(100000).optional(),
  banner: z.string().max(500).optional(),
  externalUrl: z.string().max(500).optional(),
}).strict();

export const updateEventSchema = createEventSchema.partial();

export const registerSchema = z.object({
  seats: z.number().int().min(1).max(10).optional(),
  note: z.string().trim().max(300).optional(),
}).strict();

export const moderateEventSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(300).optional(),
}).strict();

export const cancelEventSchema = z.object({
  reason: z.string().trim().max(300).optional(),
}).strict();

/* ── Helpers ─────────────────────────────────────────────────── */

/** Only approved, active, uncancelled events are publicly visible. */
const PUBLIC_MATCH = {
  isActive: true,
  isCancelled: false,
  moderationStatus: { $nin: ['pending', 'rejected'] },
};

/** Loads an event the caller is allowed to administer. */
async function ownedEvent(user, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid event id');
  const event = await Event.findById(id);
  if (!event) throw ApiError.notFound('Event not found');
  if (String(event.organiser) !== String(user._id) && user.role !== ROLES.ADMIN) {
    throw ApiError.forbidden('That event is not yours');
  }
  return event;
}

/** Shapes an event for a client, with the viewer's own registration attached. */
function present(event, registration = null) {
  const e = event.toObject ? event.toObject() : event;
  return {
    ...e,
    // Virtuals do not survive `.lean()`, so they are computed here instead of
    // being sometimes-present depending on how the caller queried.
    spotsRemaining: e.capacity ? Math.max(0, e.capacity - e.registeredCount) : null,
    isFull: Boolean(e.capacity) && e.registeredCount >= e.capacity,
    myRegistration: registration
      ? { status: registration.status, seats: registration.seats, registeredAt: registration.registeredAt }
      : null,
    // Never leak the moderation trail to a visitor.
    moderationNote: undefined,
    moderatedBy: undefined,
  };
}

/* ── Discovery ───────────────────────────────────────────────── */

/** GET /api/events */
export const listEvents = asyncHandler(async (req, res) => {
  const f = req.validatedQuery || {};
  const page = f.page || 1;
  const limit = f.limit || 12;

  const match = { ...PUBLIC_MATCH };

  if (f.mine && !req.user) throw ApiError.unauthorized('Log in to see your own events');

  if (f.mine === 'hosting') {
    // An organiser sees their drafts and rejections too — otherwise a
    // submission that needs changes simply vanishes.
    delete match.isActive;
    delete match.moderationStatus;
    delete match.isCancelled;
    match.organiser = req.user._id;
  } else if (f.mine === 'going') {
    const ids = await EventRegistration
      .find({ user: req.user._id, status: 'going' })
      .distinct('event');
    match._id = { $in: ids };

    /**
     * A cancelled event MUST still appear here.
     *
     * Somebody who signed up needs to see that it is off — hiding it is how
     * people turn up to a car park on a Sunday morning. Both visibility
     * filters have to go, not just `isCancelled`: calling an event off also
     * sets `isActive: false`, so leaving that in place hid it from exactly
     * the people it was cancelled on.
     *
     * Dropping them is safe because the `_id` filter above is the real
     * boundary: this only ever returns events this person holds a place at.
     */
    delete match.isCancelled;
    delete match.isActive;
    delete match.moderationStatus;
  } else {
    // Public browsing hides events that have already finished.
    match.startsAt = { $gte: new Date() };
  }

  if (f.type) match.type = f.type;
  if (f.sport) match.sport = f.sport;
  if (f.city) match['location.city'] = new RegExp(`^${escapeRegex(f.city)}$`, 'i');
  if (f.q) {
    const rx = safeRegex(f.q);
    match.$or = [{ title: rx }, { 'location.name': rx }, { 'location.area': rx }, { 'location.city': rx }];
  }

  if (f.when && f.when !== 'all' && !f.mine) {
    const now = new Date();
    const end = new Date(now);
    if (f.when === 'today') end.setHours(23, 59, 59, 999);
    else if (f.when === 'week') end.setDate(end.getDate() + 7);
    else end.setMonth(end.getMonth() + 1);
    match.startsAt = { $gte: now, $lte: end };
  }

  const [items, total] = await Promise.all([
    Event.find(match)
      .populate('organiser', 'name avatar')
      .populate('venue', 'name slug address')
      .sort(f.mine === 'hosting' ? { startsAt: -1 } : { startsAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Event.countDocuments(match),
  ]);

  // One query for the viewer's registrations across the whole page, rather
  // than one per card.
  let mine = new Map();
  if (req.user && items.length) {
    const regs = await EventRegistration.find({
      user: req.user._id,
      event: { $in: items.map((i) => i._id) },
    }).lean();
    mine = new Map(regs.map((r) => [String(r.event), r]));
  }

  return ok(
    res,
    items.map((e) => present(e, mine.get(String(e._id)))),
    { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  );
});

/** GET /api/events/:idOrSlug */
export const getEvent = asyncHandler(async (req, res) => {
  const { idOrSlug } = req.params;
  const query = /^[0-9a-fA-F]{24}$/.test(idOrSlug)
    ? { _id: idOrSlug }
    : { slug: String(idOrSlug).slice(0, 140) };

  const event = await Event.findOne(query)
    .populate('organiser', 'name avatar')
    .populate('venue', 'name slug address images');

  const isInsider = req.user
    && (String(event?.organiser?._id || event?.organiser) === String(req.user._id)
      || req.user.role === ROLES.ADMIN);

  const visible = event && event.isActive && !['pending', 'rejected'].includes(event.moderationStatus);
  if (!event || (!visible && !isInsider)) throw ApiError.notFound('Event not found');

  const registration = req.user
    ? await EventRegistration.findOne({ event: event._id, user: req.user._id }).lean()
    : null;

  const body = present(event, registration);
  // The organiser and admins see the review trail; nobody else does.
  if (isInsider) {
    body.moderationNote = event.moderationNote;
    body.moderationStatus = event.moderationStatus;
  }

  return ok(res, body);
});

/* ── Registering ─────────────────────────────────────────────── */

/**
 * POST /api/events/:id/register
 *
 * Capacity is claimed in ONE conditional update, with the limit inside the
 * filter. The read-then-write version is a race: two people load an event with
 * one place left, both see room, both register, and one of them turns up to a
 * marathon that has no bib for them.
 */
export const registerForEvent = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid event id');
  const seats = req.body.seats || 1;
  const note = cleanText(req.body.note || '', 300);

  const event = await Event.findById(req.params.id).select('title startsAt capacity organiser isActive isCancelled moderationStatus');
  if (!event) throw ApiError.notFound('Event not found');
  if (!event.isActive || event.moderationStatus !== 'approved') {
    throw ApiError.badRequest('This event is not open for registration yet');
  }
  if (event.isCancelled) throw ApiError.badRequest('This event has been cancelled');
  if (new Date(event.startsAt) < new Date()) throw ApiError.badRequest('This event has already started');
  if (String(event.organiser) === String(req.user._id)) {
    throw ApiError.badRequest('You are organising this event — you do not need a place');
  }

  // Claim the seats. `capacity: 0` means unlimited, hence the $or.
  const claimed = await Event.findOneAndUpdate(
    {
      _id: event._id,
      isCancelled: false,
      $or: [
        { capacity: 0 },
        { $expr: { $lte: [{ $add: ['$registeredCount', seats] }, '$capacity'] } },
      ],
    },
    { $inc: { registeredCount: seats } },
    { new: true },
  );

  if (!claimed) {
    throw ApiError.conflict(
      seats === 1 ? 'This event is full.' : `There are not ${seats} places left.`,
    );
  }

  /**
   * Record it — but only if this person was not already going.
   *
   * The filter excludes `status: 'going'`, so a second attempt matches
   * nothing, the upsert tries to insert, and the unique (event, user) index
   * rejects it. That is the signal to hand the seats straight back, rather
   * than letting a double-submit silently consume two places for one person.
   */
  let registration;
  try {
    registration = await EventRegistration.findOneAndUpdate(
      { event: event._id, user: req.user._id, status: { $ne: 'going' } },
      { $set: { status: 'going', seats, note, registeredAt: new Date(), cancelledAt: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    await Event.updateOne({ _id: event._id }, { $inc: { registeredCount: -seats } });
    if (err.code === 11000) throw ApiError.conflict('You are already registered for this event');
    throw err;
  }

  await notify.notify(req.user._id, 'booking_confirmed', {
    title: 'You are going',
    body: `${event.title} — ${new Date(event.startsAt).toLocaleString('en-IN')}. Tap for the details.`,
    link: `/events/${req.params.id}`,
    icon: '🎉',
  });

  return created(res, {
    registered: true,
    seats: registration.seats,
    spotsRemaining: claimed.capacity ? Math.max(0, claimed.capacity - claimed.registeredCount) : null,
    message: 'You are on the list. See you there.',
  });
});

/** DELETE /api/events/:id/register — give the place back. */
export const cancelRegistration = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid event id');

  // Conditional on still being 'going', so two taps release the seats once.
  const registration = await EventRegistration.findOneAndUpdate(
    { event: req.params.id, user: req.user._id, status: 'going' },
    { $set: { status: 'cancelled', cancelledAt: new Date() } },
  );
  if (!registration) throw ApiError.badRequest('You are not registered for this event');

  await Event.updateOne(
    { _id: req.params.id, registeredCount: { $gte: registration.seats } },
    { $inc: { registeredCount: -registration.seats } },
  );

  return ok(res, { cancelled: true, message: 'Your place has been released.' });
});

/** GET /api/events/:id/attendees — organiser only. */
export const listAttendees = asyncHandler(async (req, res) => {
  const event = await ownedEvent(req.user, req.params.id);

  const rows = await EventRegistration.find({ event: event._id, status: 'going' })
    .populate('user', 'name email phone avatar')
    .sort({ createdAt: 1 })
    .limit(2000)
    .lean();

  return ok(res, {
    event: { _id: event._id, title: event.title, startsAt: event.startsAt, capacity: event.capacity },
    total: rows.reduce((n, r) => n + r.seats, 0),
    attendees: rows.map((r) => ({
      name: r.user?.name || 'Guest',
      email: r.user?.email || '',
      phone: r.user?.phone || '',
      seats: r.seats,
      note: r.note,
      registeredAt: r.registeredAt,
    })),
  });
});

/* ── Organising ──────────────────────────────────────────────── */

/** POST /api/events — owners and admins. */
export const createEvent = asyncHandler(async (req, res) => {
  const { venueId, lat, lng, startsAt, endsAt, location, ...rest } = req.body;

  const starts = new Date(startsAt);
  if (Number.isNaN(starts.getTime())) throw ApiError.badRequest('Enter a valid start date and time');
  if (starts < new Date()) throw ApiError.badRequest('Pick a date in the future');
  const ends = endsAt ? new Date(endsAt) : null;
  if (ends && ends <= starts) throw ApiError.badRequest('The end time must be after the start time');

  const mine = await Event.countDocuments({ organiser: req.user._id });
  if (mine >= 100) throw ApiError.badRequest('You can run at most 100 events');

  // A venue may only be attached by whoever owns it — otherwise anyone could
  // stage an event under somebody else's name and address.
  let venue = null;
  if (venueId) {
    venue = await Venue.findById(venueId).select('owner name address location');
    if (!venue) throw ApiError.notFound('Venue not found');
    if (String(venue.owner) !== String(req.user._id) && req.user.role !== ROLES.ADMIN) {
      throw ApiError.forbidden('You can only host events at your own venues');
    }
  }

  // Same rule as venue listings: a verified organiser publishes immediately,
  // anyone else is reviewed first.
  const autoApprove = req.user.isVerified || req.user.role === ROLES.ADMIN;

  const coords = (typeof lat === 'number' && typeof lng === 'number')
    ? { type: 'Point', coordinates: [lng, lat] }
    : (venue?.location?.coordinates ? { type: 'Point', coordinates: venue.location.coordinates } : undefined);

  const event = await Event.create({
    ...rest,
    title: cleanText(rest.title, 120),
    description: cleanText(rest.description || '', 4000),
    organiser: req.user._id,
    venue: venue?._id || null,
    location: {
      name: cleanText(location?.name || venue?.name || '', 160),
      address: cleanText(location?.address || venue?.address?.line1 || '', 240),
      area: cleanText(location?.area || venue?.address?.area || '', 60),
      city: cleanText(location?.city || venue?.address?.city || '', 60),
    },
    ...(coords ? { coordinates: coords } : {}),
    startsAt: starts,
    endsAt: ends,
    // Never trust the client for these, whatever the schema let through.
    price: 0,
    registeredCount: 0,
    moderationStatus: autoApprove ? 'approved' : 'pending',
    isActive: autoApprove,
  });

  return created(res, {
    event: present(event),
    message: autoApprove
      ? 'Event published.'
      : 'Event submitted. It goes live once our team has reviewed it — usually within a day.',
  });
});

/** PATCH /api/events/:id */
export const updateEvent = asyncHandler(async (req, res) => {
  const event = await ownedEvent(req.user, req.params.id);
  const { venueId, lat, lng, startsAt, endsAt, location, ...rest } = req.body;

  if (startsAt) {
    const starts = new Date(startsAt);
    if (Number.isNaN(starts.getTime())) throw ApiError.badRequest('Enter a valid start date and time');
    event.startsAt = starts;
  }
  if (endsAt !== undefined) event.endsAt = endsAt ? new Date(endsAt) : null;
  if (event.endsAt && event.endsAt <= event.startsAt) {
    throw ApiError.badRequest('The end time must be after the start time');
  }

  /**
   * Capacity cannot be cut below the number of people already holding a
   * place. Doing so would leave `registeredCount > capacity`, which reads as
   * over-subscribed everywhere and would have to un-invite somebody — a
   * decision the organiser should make explicitly, by contacting them.
   */
  if (rest.capacity !== undefined && rest.capacity !== 0 && rest.capacity < event.registeredCount) {
    throw ApiError.badRequest(
      `${event.registeredCount} ${event.registeredCount === 1 ? 'person is' : 'people are'} already registered. `
      + 'Capacity cannot go below that — cancel some registrations first if you need to shrink the event.',
    );
  }

  if (venueId !== undefined) {
    if (venueId === null) event.venue = null;
    else {
      const venue = await Venue.findById(venueId).select('owner');
      if (!venue) throw ApiError.notFound('Venue not found');
      if (String(venue.owner) !== String(req.user._id) && req.user.role !== ROLES.ADMIN) {
        throw ApiError.forbidden('You can only host events at your own venues');
      }
      event.venue = venue._id;
    }
  }

  if (location) {
    event.location = {
      name: cleanText(location.name ?? event.location.name, 160),
      address: cleanText(location.address ?? event.location.address, 240),
      area: cleanText(location.area ?? event.location.area, 60),
      city: cleanText(location.city ?? event.location.city, 60),
    };
  }
  if (typeof lat === 'number' && typeof lng === 'number') {
    event.coordinates = { type: 'Point', coordinates: [lng, lat] };
  }

  for (const key of ['title', 'description', 'type', 'sport', 'capacity', 'banner', 'externalUrl']) {
    if (rest[key] !== undefined) event[key] = rest[key];
  }
  if (rest.title) event.title = cleanText(rest.title, 120);
  if (rest.description !== undefined) event.description = cleanText(rest.description, 4000);

  // Moderation state and the price are ours, never the caller's.
  event.price = 0;

  await event.save();
  return ok(res, { event: present(event), message: 'Event updated.' });
});

/**
 * DELETE /api/events/:id — call it off.
 *
 * Cancelled rather than deleted, and everyone registered is told. Deleting
 * would leave people with a date in their calendar and no way to find out it
 * is not happening.
 */
export const cancelEvent = asyncHandler(async (req, res) => {
  const event = await ownedEvent(req.user, req.params.id);
  if (event.isCancelled) throw ApiError.badRequest('This event is already cancelled');

  const claimed = await Event.findOneAndUpdate(
    { _id: event._id, isCancelled: false },
    {
      $set: {
        isCancelled: true,
        isActive: false,
        cancelledReason: cleanText(req.body?.reason || '', 300),
      },
    },
  );
  if (!claimed) throw ApiError.badRequest('This event is already cancelled');

  const going = await EventRegistration.find({ event: event._id, status: 'going' }).distinct('user');
  if (going.length) {
    await notify.notifyMany(going, 'booking_cancelled', {
      title: 'Event cancelled',
      body: `${event.title} has been called off by the organiser.`,
      link: '/events',
    });
  }

  logger.info('event cancelled', { eventId: String(event._id), notified: going.length });

  return ok(res, {
    cancelled: true,
    notified: going.length,
    message: going.length
      ? `Event cancelled. ${going.length} registered ${going.length === 1 ? 'person has' : 'people have'} been told.`
      : 'Event cancelled.',
  });
});

/* ── Moderation (admin) ──────────────────────────────────────── */

/** PATCH /api/events/:id/moderate */
export const moderateEvent = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid event id');
  const event = await Event.findById(req.params.id);
  if (!event) throw ApiError.notFound('Event not found');

  const approve = req.body.decision === 'approve';
  event.moderationStatus = approve ? 'approved' : 'rejected';
  event.isActive = approve && !event.isCancelled;
  event.moderationNote = cleanText(req.body.note || '', 300);
  event.moderatedAt = new Date();
  event.moderatedBy = req.user._id;
  await event.save();

  await notify.notify(event.organiser, approve ? 'venue_approved' : 'venue_rejected', {
    title: approve ? 'Event approved' : 'Event needs changes',
    body: approve
      ? `${event.title} is live and taking registrations.`
      : `${event.title} needs changes before it can go live.${event.moderationNote ? ` Note: ${event.moderationNote}` : ''}`,
    link: '/owner/events',
  });

  return ok(res, {
    event: present(event),
    message: approve ? `${event.title} is now live.` : `${event.title} was rejected and stays hidden.`,
  });
});

/** GET /api/events/admin/queue — everything awaiting review. */
export const moderationQueue = asyncHandler(async (req, res) => {
  const items = await Event.find({ moderationStatus: 'pending' })
    .populate('organiser', 'name email isVerified')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return ok(res, items);
});

/** GET /api/events/meta/cities — powers the city filter. */
export const eventCities = asyncHandler(async (req, res) => {
  const rows = await Event.aggregate([
    { $match: { ...PUBLIC_MATCH, startsAt: { $gte: new Date() }, 'location.city': { $ne: '' } } },
    { $group: { _id: '$location.city', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return ok(res, rows.map((r) => ({ city: r._id, events: r.count })));
});

// Referenced by the owner dashboard for a quick count.
export const myEventStats = asyncHandler(async (req, res) => {
  const [total, live, pending] = await Promise.all([
    Event.countDocuments({ organiser: req.user._id }),
    Event.countDocuments({ organiser: req.user._id, isActive: true, isCancelled: false }),
    Event.countDocuments({ organiser: req.user._id, moderationStatus: 'pending' }),
  ]);
  return ok(res, { total, live, pending });
});
