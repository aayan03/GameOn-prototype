import { Router } from 'express';
import crypto from 'crypto';
import { runLifecycle } from '../services/lifecycle.service.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

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

export default router;
