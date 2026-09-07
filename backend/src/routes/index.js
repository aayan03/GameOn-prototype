import { Router } from 'express';
import authRoutes from './auth.routes.js';
import venueRoutes from './venue.routes.js';
import bookingRoutes from './booking.routes.js';
import teamupRoutes from './teamup.routes.js';
import teamRoutes from './team.routes.js';
import loyaltyRoutes from './loyalty.routes.js';
import ownerRoutes from './owner.routes.js';
import adminRoutes from './admin.routes.js';
import paymentRoutes from './payment.routes.js';
import notificationRoutes from './notification.routes.js';
import reviewRoutes from './review.routes.js';
import eventRoutes from './event.routes.js';
import parlorRoutes from './parlor.routes.js';
import cronRoutes from './cron.routes.js';
import {
  SPORTS, AMENITIES, BOOKING_MODES, SKILL_LEVELS, LOYALTY_TIERS, EVENT_TYPES,
  PARLOR_GAMES, PARLOR_AMENITIES,
} from '../config/constants.js';
import { ok } from '../utils/response.js';

const router = Router();

import mongoose from 'mongoose';

/** Liveness: the process is running. Never touches the database. */
router.get('/health', (req, res) => ok(res, {
  status: 'up',
  time: new Date().toISOString(),
  uptime: Math.round(process.uptime()),
}));

/**
 * Readiness: we can actually serve traffic.
 *
 * Separate from /health on purpose. A liveness probe that checks the database
 * will restart a healthy process during a brief database blip, which turns a
 * short outage into a long one.
 */
router.get('/ready', async (req, res) => {
  const state = mongoose.connection.readyState;   // 1 = connected
  if (state !== 1) {
    return res.status(503).json({
      success: false,
      error: { message: 'Database not connected' },
      data: { db: state },
    });
  }
  return ok(res, { status: 'ready', db: 'connected' });
});

/** One call the frontend makes on boot to get sports, amenities and enums. */
router.get('/config', (req, res) => ok(res, {
  sports: SPORTS,
  amenities: AMENITIES,
  bookingModes: BOOKING_MODES,
  skillLevels: SKILL_LEVELS,
  eventTypes: EVENT_TYPES,
  parlorGames: PARLOR_GAMES,
  parlorAmenities: PARLOR_AMENITIES,
  loyaltyTiers: LOYALTY_TIERS,
  phases: {
    1: { name: 'Foundation, auth & discovery', status: 'live' },
    2: { name: 'Slot booking & cancellations', status: 'live' },
    3: { name: 'TeamUp social matching & loyalty', status: 'live' },
    4: { name: 'Owner dashboard, analytics, payments & moderation', status: 'live' },
    5: { name: 'Mobile app, PWA, notifications & deployment', status: 'live' },
  },
}));

router.use('/auth', authRoutes);
router.use('/venues', venueRoutes);
router.use('/bookings', bookingRoutes);
router.use('/teamup', teamupRoutes);
router.use('/teams', teamRoutes);
router.use('/loyalty', loyaltyRoutes);
router.use('/owner', ownerRoutes);
router.use('/admin', adminRoutes);
router.use('/payments', paymentRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reviews', reviewRoutes);
router.use('/events', eventRoutes);
router.use('/parlors', parlorRoutes);
router.use('/cron', cronRoutes);

export default router;
