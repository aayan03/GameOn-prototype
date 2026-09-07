import { Router } from 'express';
import validate from '../middleware/validate.js';
import { searchLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/search.controller.js';

const router = Router();

/**
 * Public on purpose. Everything it can return is already public — it queries
 * each collection with that collection's own visibility filter — and a search
 * box that only works once you have signed in is a search box nobody uses.
 */
router.get('/', searchLimiter, validate(ctrl.searchSchema, 'query'), ctrl.search);

export default router;
