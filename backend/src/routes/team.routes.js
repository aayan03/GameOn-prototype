import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import { createLimiter, writeLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/team.controller.js';

const router = Router();

// Teams are private to their members, so everything here needs a session.
router.use(protect);

// Static paths before the /:id catch-all.
router.get('/mine', ctrl.myTeams);
router.post('/join', writeLimiter, validate(ctrl.joinByCodeSchema), ctrl.joinByCode);

router.post('/', createLimiter, validate(ctrl.createTeamSchema), ctrl.createTeam);
router.get('/:id', ctrl.getTeam);
router.patch('/:id', validate(ctrl.updateTeamSchema), ctrl.updateTeam);
router.delete('/:id', ctrl.deleteTeam);

router.post('/:id/invite', writeLimiter, validate(ctrl.inviteSchema), ctrl.invite);
router.delete('/:id/members/:userId', ctrl.removeMember);
router.patch('/:id/captain', writeLimiter, validate(ctrl.transferSchema), ctrl.transferCaptaincy);

export default router;
