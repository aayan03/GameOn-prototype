import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { writeLimiter, createLimiter } from '../middleware/rateLimit.js';
import { ROLES } from '../config/constants.js';
import * as ctrl from '../controllers/owner.controller.js';

const router = Router();

// Everything here is owner-or-admin. Each handler additionally scopes its
// queries to venues the caller actually owns.
router.use(protect, restrictTo(ROLES.OWNER, ROLES.ADMIN));

router.get('/overview', validate(ctrl.rangeSchema, 'query'), ctrl.overview);
router.get('/peak-hours', validate(ctrl.rangeSchema, 'query'), ctrl.peakHours);
router.get('/customers', validate(ctrl.rangeSchema, 'query'), ctrl.customers);
router.get('/payouts', ctrl.payouts);

router.get('/calendar', validate(ctrl.calendarSchema, 'query'), ctrl.calendar);
router.post('/blackouts', writeLimiter, validate(ctrl.blackoutSchema), ctrl.addBlackout);
router.delete('/blackouts/:venueId/:blackoutId', writeLimiter, ctrl.removeBlackout);

router.patch('/venues/:venueId/settings', writeLimiter, validate(ctrl.venueSettingsSchema), ctrl.updateSettings);

router.get('/promos', ctrl.listPromos);
router.post('/promos', createLimiter, validate(ctrl.promoSchema), ctrl.createPromo);
router.patch('/promos/:id', writeLimiter, validate(ctrl.updatePromoSchema), ctrl.updatePromo);
router.delete('/promos/:id', writeLimiter, ctrl.deletePromo);

export default router;
