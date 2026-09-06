import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import { authLimiter, registerLimiter, passwordResetLimiter, verifyLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/auth.controller.js';

const router = Router();

/**
 * Registration does not create an account any more — it emails a link, and
 * the account is created when that link is opened. `passwordResetLimiter`
 * rather than `registerLimiter` on the two email-sending routes: both answer
 * 200 whatever happens, so a limiter that skips successful requests would
 * never count anything.
 */
router.post('/register', registerLimiter, validate(ctrl.registerSchema), ctrl.register);
router.post('/verify-email', verifyLimiter, validate(ctrl.verifyEmailSchema), ctrl.verifyEmail);
router.post('/resend-verification', passwordResetLimiter, validate(ctrl.resendVerificationSchema), ctrl.resendVerification);
router.post('/login', authLimiter, validate(ctrl.loginSchema), ctrl.login);
router.post('/refresh', authLimiter, ctrl.refresh);

// Unauthenticated on purpose — see the note on the controller. Someone whose
// access token has already expired still needs their refresh token revoked,
// and a logout that 401s leaves the session alive.
router.post('/logout', authLimiter, ctrl.logout);

// Reset is unauthenticated by definition, so both halves are rate limited.
// `authLimiter` skips successful requests, which is wrong here — forgot-password
// answers 200 whether or not the address exists, so every attempt must count.
router.post('/forgot-password', passwordResetLimiter, validate(ctrl.forgotPasswordSchema), ctrl.forgotPassword);
router.post('/reset-password', passwordResetLimiter, validate(ctrl.resetPasswordSchema), ctrl.resetPassword);

router.get('/me', protect, ctrl.me);
router.patch('/me', protect, validate(ctrl.updateMeSchema), ctrl.updateMe);
router.post('/change-password', protect, authLimiter, validate(ctrl.changePasswordSchema), ctrl.changePassword);
router.post('/logout-all', protect, authLimiter, ctrl.logoutAll);

export default router;
