import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { ROLES } from '../config/constants.js';
import * as ctrl from '../controllers/booking.controller.js';

const router = Router();

// Everything below needs a signed-in user.
router.use(protect);

// Wallet & promos — declared before /:groupRef so they aren't swallowed by it.
router.get('/wallet', ctrl.walletSummary);
router.post('/wallet/topup', writeLimiter, validate(ctrl.topUpSchema), ctrl.topUpWallet);
router.get('/promos', ctrl.listPromos);

// Owner queue for assisted bookings
router.get('/owner/requests', restrictTo(ROLES.OWNER, ROLES.ADMIN), ctrl.ownerRequests);

// Player flow
router.post('/quote', writeLimiter, validate(ctrl.quoteSchema), ctrl.quote);
router.post('/', writeLimiter, validate(ctrl.createBookingSchema), ctrl.createBooking);
router.get('/', ctrl.myBookings);

router.get('/:groupRef', ctrl.getBooking);
router.patch('/:groupRef/cancel', writeLimiter, validate(ctrl.cancelSchema), ctrl.cancelBooking);
router.patch('/:groupRef/settle', writeLimiter, restrictTo(ROLES.OWNER, ROLES.ADMIN), ctrl.settleCash);
router.patch('/:groupRef/decision', writeLimiter, restrictTo(ROLES.OWNER, ROLES.ADMIN), validate(ctrl.decisionSchema), ctrl.decideBooking);

export default router;
