import { Router } from 'express';
import crypto from 'crypto';
import { runLifecycle } from '../services/lifecycle.service.js';
import { Venue, User, Booking } from '../models/index.js';
import { seedDatabase } from '../seed/seed.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * Shared-secret routes for an external scheduler.
 *
 * `/api/admin/lifecycle` needs an admin JWT, which expires in two hours — no
 * free cron service can hold one. This is the same job behind a static secret
 * instead, which is what a scheduler can actually present.
 *
 * The secret is compared in constant time. A plain `===` on a secret leaks its
 * length and, over enough requests, its contents through timing.
 */
function authorise(req) {
  const expected = env.CRON_SECRET;

  // No secret configured means the endpoint does not exist. It is not left
  // open "for convenience" — an open endpoint that runs refunds is a way for
  // anyone to hammer the database for free.
  if (!expected) throw ApiError.notFound('Not found');

  const given = req.get('x-cron-secret') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so hash both to a fixed size
  // first — otherwise the length check itself is the timing leak.
  const ok1 = crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a).digest(),
    crypto.createHash('sha256').update(b).digest()
  );
  if (!ok1) throw ApiError.unauthorized('Bad cron secret');
}

/**
 * POST /api/cron/lifecycle — complete finished games, expire dead requests,
 * send reminders, settle reliability.
 *
 * GET is accepted too, because several free schedulers only send GETs. The job
 * claims every row before it acts, so calling it twice at once is harmless.
 */
const handler = asyncHandler(async (req, res) => {
  authorise(req);
  const result = await runLifecycle();
  return ok(res, { ...result, message: 'Lifecycle run complete.' });
});

router.post('/lifecycle', handler);
router.get('/lifecycle', handler);

/**
 * POST /api/cron/seed — populate an EMPTY database with demo data.
 *
 * This exists for a specific, real situation: seeding normally runs from a
 * laptop, and a network whose DNS refuses SRV lookups cannot resolve an
 * Atlas `mongodb+srv://` host at all — while this server, already connected
 * to that same cluster, can. Rather than debug someone's ISP, run it here.
 *
 * Three things keep a seeding endpoint from being a liability:
 *  - it needs the cron secret, like every other route in this file
 *  - it refuses outright if the database holds ANY venue, user or booking,
 *    so it can only ever fill an empty database and can never wipe real data
 *  - it never seeds the real Lucknow business listings
 */
router.post('/seed', asyncHandler(async (req, res) => {
  authorise(req);

  const [venues, users, bookings] = await Promise.all([
    Venue.estimatedDocumentCount(),
    User.estimatedDocumentCount(),
    Booking.estimatedDocumentCount(),
  ]);

  if (venues || users || bookings) {
    throw ApiError.conflict(
      `Refusing to seed: the database is not empty (${venues} venues, ${users} users, `
      + `${bookings} bookings). Seeding clears collections, so this only ever runs once, `
      + 'on an empty database.'
    );
  }

  const summary = await seedDatabase({ noLucknow: true, connect: false });

  // Said plainly in the response, because these passwords are in a public
  // repository and anyone who has read it can now log into this deployment.
  logger.warn('seed created demo accounts with published passwords - change or delete them');

  return ok(res, {
    ...summary,
    warning: 'Demo accounts use passwords published in this repository. Change or delete them before this handles anything real.',
    logins: {
      player: 'aayan@gameon.app / player123',
      owner: 'shivanshu@gameon.app / owner123',
    },
  });
}));

export default router;
