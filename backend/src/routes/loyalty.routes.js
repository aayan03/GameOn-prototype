import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/loyalty.controller.js';

const router = Router();

router.get('/tiers', ctrl.tiers);                 // public — advertises the perks
router.get('/', protect, ctrl.summary);
router.post('/redeem', protect, writeLimiter, validate(ctrl.redeemSchema), ctrl.redeem);

export default router;
