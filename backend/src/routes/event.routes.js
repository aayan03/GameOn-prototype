import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect, optionalAuth, restrictTo } from '../middleware/auth.js';
import { writeLimiter, createLimiter } from '../middleware/rateLimit.js';
import { ROLES } from '../config/constants.js';
import * as ctrl from '../controllers/event.controller.js';

const router = Router();

/**
 * Discovery is public — someone should be able to find a Sunday morning run
 * before deciding whether this platform is worth an account.
 *
 * `optionalAuth` rather than no auth at all, so a signed-in visitor sees
 * "You're going" on the cards they have already registered for.
 */
router.get('/', optionalAuth, validate(ctrl.listEventsSchema, 'query'), ctrl.listEvents);
router.get('/meta/cities', ctrl.eventCities);

// Static paths before the /:idOrSlug catch-all, or they get swallowed by it.
router.get('/admin/queue', protect, restrictTo(ROLES.ADMIN), ctrl.moderationQueue);
router.get('/mine/stats', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), ctrl.myEventStats);

/* ── Organising ──────────────────────────────────────────────── */

router.post('/', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), createLimiter, validate(ctrl.createEventSchema), ctrl.createEvent);
router.patch('/:id', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), writeLimiter, validate(ctrl.updateEventSchema), ctrl.updateEvent);
router.delete('/:id', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), writeLimiter, validate(ctrl.cancelEventSchema), ctrl.cancelEvent);
router.get('/:id/attendees', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), ctrl.listAttendees);

// Admin moderation, mirroring the venue queue.
router.patch('/:id/moderate', protect, restrictTo(ROLES.ADMIN), writeLimiter, validate(ctrl.moderateEventSchema), ctrl.moderateEvent);

/* ── Taking part ─────────────────────────────────────────────── */

router.post('/:id/register', protect, writeLimiter, validate(ctrl.registerSchema), ctrl.registerForEvent);
router.delete('/:id/register', protect, writeLimiter, ctrl.cancelRegistration);

// Last, so it cannot shadow anything above.
router.get('/:idOrSlug', optionalAuth, ctrl.getEvent);

export default router;
