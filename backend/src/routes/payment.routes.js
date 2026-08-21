import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/payment.controller.js';

const router = Router();

router.get('/config', ctrl.config);
router.post('/order', protect, writeLimiter, validate(ctrl.orderSchema), ctrl.createOrder);
router.post('/verify', protect, writeLimiter, validate(ctrl.verifySchema), ctrl.verify);

// NOTE: the webhook is mounted separately in app.js, BEFORE the JSON body
// parser, because its signature must be checked against the raw bytes.

export default router;
