import { Router } from 'express';
import validate from '../middleware/validate.js';
import { protect, optionalAuth, restrictTo } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';
import * as ctrl from '../controllers/venue.controller.js';
import * as bookingCtrl from '../controllers/booking.controller.js';

const router = Router();

// Public discovery
router.get('/', validate(ctrl.listVenuesSchema, 'query'), ctrl.listVenues);
router.get('/map', validate(ctrl.listVenuesSchema, 'query'), ctrl.mapVenues);
router.get('/meta/cities', ctrl.cities);

// Slot availability — public, so people can see the grid before signing up.
router.get(
  '/:venueId/availability',
  validate(bookingCtrl.availabilitySchema, 'query'),
  bookingCtrl.getAvailability
);

// Owner workspace (must be declared before the /:idOrSlug catch-all)
router.get('/owner/mine', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), ctrl.myVenues);

router.post('/', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), validate(ctrl.createVenueSchema), ctrl.createVenue);
router.patch('/:id', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), validate(ctrl.updateVenueSchema), ctrl.updateVenue);
router.delete('/:id', protect, restrictTo(ROLES.OWNER, ROLES.ADMIN), ctrl.deleteVenue);
router.post('/:id/favorite', protect, ctrl.toggleFavorite);

router.get('/:idOrSlug', optionalAuth, ctrl.getVenue);

export default router;
