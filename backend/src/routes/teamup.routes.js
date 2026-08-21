import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { createLimiter, writeLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/teamup.controller.js';

const router = Router();

// The feed is readable without an account so people can see the value first.
// optionalAuth still attaches req.user when a token is present, which is what
// lets `present()` show "you have already asked to join".
router.get('/', optionalAuth, validate(ctrl.listPostsSchema, 'query'), ctrl.listPosts);

router.post('/', protect, createLimiter, validate(ctrl.createPostSchema), ctrl.createPost);

router.get('/:id', optionalAuth, ctrl.getPost);
router.delete('/:id', protect, ctrl.cancelPost);

router.post('/:id/join', protect, writeLimiter, validate(ctrl.joinSchema), ctrl.requestToJoin);
router.delete('/:id/join', protect, ctrl.withdrawJoin);

router.patch('/:id/requests/:requestId', protect, validate(ctrl.decideSchema), ctrl.decideRequest);
router.post('/:id/settle', protect, writeLimiter, ctrl.settleCosts);

export default router;
