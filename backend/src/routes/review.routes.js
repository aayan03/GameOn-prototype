import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import { createLimiter, writeLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/review.controller.js';

const router = Router();

// Public: anyone can read reviews.
router.get('/venue/:venueId', ctrl.listForVenue);

router.get('/mine/:venueId', protect, ctrl.mine);
router.post('/', protect, createLimiter, validate(ctrl.createReviewSchema), ctrl.create);
router.post('/:id/reply', protect, writeLimiter, validate(ctrl.replySchema), ctrl.reply);
// Rate-limited like every other write: delete-and-repost was the shape of
// the points-farming loop, and an unlimited delete is also a cheap way to
// hammer the rating recount.
router.delete('/:id', protect, writeLimiter, ctrl.remove);

export default router;
