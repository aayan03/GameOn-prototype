import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import { authLimiter, registerLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/auth.controller.js';

const router = Router();

router.post('/register', registerLimiter, validate(ctrl.registerSchema), ctrl.register);
router.post('/login', authLimiter, validate(ctrl.loginSchema), ctrl.login);
router.post('/refresh', authLimiter, ctrl.refresh);

router.get('/me', protect, ctrl.me);
router.patch('/me', protect, validate(ctrl.updateMeSchema), ctrl.updateMe);
router.post('/change-password', protect, authLimiter, validate(ctrl.changePasswordSchema), ctrl.changePassword);

export default router;
