import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/notification.controller.js';

const router = Router();
router.use(protect);

router.get('/', validate(ctrl.listSchema, 'query'), ctrl.list);
router.get('/unread-count', ctrl.unread);
router.patch('/read', validate(ctrl.markReadSchema), ctrl.markRead);
router.delete('/push-token', writeLimiter, ctrl.removePushToken);
router.post('/push-token', writeLimiter, validate(ctrl.pushTokenSchema), ctrl.addPushToken);
router.delete('/:id', ctrl.remove);

export default router;
