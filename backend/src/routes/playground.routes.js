import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect, optionalAuth, restrictTo } from '../middleware/auth.js';
import { writeLimiter, createLimiter } from '../middleware/rateLimit.js';
import { ROLES } from '../config/constants.js';
import * as ctrl from '../controllers/playground.controller.js';

const router = Router();

/**
 * Free public grounds, added by whoever found them.
 *
 * Browsing is open — the whole point is that these are places anybody can
 * turn up and play at, so requiring an account to see them would defeat it.
 * Contributing needs one, because a submission that cannot be traced to an
 * account is a submission nobody can be accountable for.
 */
router.get('/', validate(ctrl.listPlaygroundsSchema, 'query'), ctrl.listPlaygrounds);
router.get('/meta/cities', ctrl.playgroundCities);

// Static paths before the /:idOrSlug catch-all, or "mine" reads as a slug.
router.get('/mine', protect, ctrl.mySubmissions);
router.get('/admin/queue', protect, restrictTo(ROLES.ADMIN), ctrl.playgroundQueue);

router.post('/', protect, createLimiter, validate(ctrl.createPlaygroundSchema), ctrl.createPlayground);
router.patch('/:id', protect, writeLimiter, validate(ctrl.updatePlaygroundSchema), ctrl.updatePlayground);
router.post('/:id/report', protect, writeLimiter, ctrl.reportPlayground);
router.post('/:id/correction', protect, writeLimiter, validate(ctrl.correctionSchema), ctrl.suggestCorrection);

router.patch(
  '/:id/moderate',
  protect, restrictTo(ROLES.ADMIN), writeLimiter,
  validate(ctrl.moderatePlaygroundSchema), ctrl.moderatePlayground
);

router.patch(
  '/:id/unpublish',
  protect, restrictTo(ROLES.ADMIN), writeLimiter,
  validate(ctrl.unpublishSchema), ctrl.unpublishPlayground
);

router.get('/:idOrSlug', optionalAuth, ctrl.getPlayground);

export default router;
