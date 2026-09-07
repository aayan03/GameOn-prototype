import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect, optionalAuth, restrictTo } from '../middleware/auth.js';
import { writeLimiter, createLimiter } from '../middleware/rateLimit.js';
import { ROLES } from '../config/constants.js';
import * as ctrl from '../controllers/parlor.controller.js';

const router = Router();

/**
 * A locator, so the whole point is that it works without an account. There
 * is nothing to reserve here — the call to action is a phone number and a
 * set of directions.
 */
router.get('/', validate(ctrl.listParlorsSchema, 'query'), ctrl.listParlors);
router.get('/map', validate(ctrl.listParlorsSchema, 'query'), ctrl.mapParlors);
router.get('/meta/cities', ctrl.parlorCities);

// Static paths before the /:idOrSlug catch-all.
router.get('/mine/list', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), ctrl.myParlors);
router.get('/admin/queue', protect, restrictTo(ROLES.ADMIN), ctrl.parlorQueue);

router.post('/', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), createLimiter, validate(ctrl.createParlorSchema), ctrl.createParlor);
router.patch('/:id', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), writeLimiter, validate(ctrl.updateParlorSchema), ctrl.updateParlor);
router.delete('/:id', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), writeLimiter, ctrl.removeParlor);
router.patch('/:id/moderate', protect, restrictTo(ROLES.ADMIN), writeLimiter, validate(ctrl.moderateParlorSchema), ctrl.moderateParlor);

router.get('/:idOrSlug', optionalAuth, ctrl.getParlor);

export default router;
