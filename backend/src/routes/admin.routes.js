import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { ROLES } from '../config/constants.js';
import * as ctrl from '../controllers/admin.controller.js';

const router = Router();

// The admin role cannot be self-assigned anywhere in the API — it is set
// directly in the database. See controllers/admin.controller.js.
router.use(protect, restrictTo(ROLES.ADMIN));

router.get('/stats', ctrl.stats);
router.get('/venues', validate(ctrl.listVenuesSchema, 'query'), ctrl.listVenues);
router.patch('/venues/:id/moderate', writeLimiter, validate(ctrl.moderateSchema), ctrl.moderateVenue);

router.get('/users', validate(ctrl.listUsersSchema, 'query'), ctrl.listUsers);
router.patch('/users/:id/verify', writeLimiter, validate(ctrl.verifyUserSchema), ctrl.verifyUser);
router.patch('/users/:id/status', writeLimiter, validate(ctrl.userStatusSchema), ctrl.setUserStatus);

router.get('/ledger', ctrl.ledger);
router.post('/payouts/run', writeLimiter, ctrl.runPayouts);
router.post('/lifecycle', writeLimiter, ctrl.lifecycle);
router.patch('/payouts/:id', writeLimiter, ctrl.markPayoutPaid);

export default router;
