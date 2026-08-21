import rateLimit from 'express-rate-limit';
import env from '../config/env.js';

const message = (text) => ({ success: false, error: { message: text } });

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  // In development one machine generates all the traffic, so limits that are
  // sensible in production make the app unusable locally.
  skip: () => env.NODE_ENV === 'development',
};

/** Broad ceiling so a single client can't flood the API. */
export const globalLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: message('Too many requests. Please slow down.'),
});

/** Credential endpoints — tight, because this is where guessing happens. */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,   // only failures count toward the limit
  message: message('Too many attempts. Try again in a few minutes.'),
});

/** Account creation — stops automated signup floods. */
export const registerLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: message('Too many accounts created from this network. Try again later.'),
});

/** Anything that moves money or creates a booking. */
export const writeLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 30,
  message: message('You are doing that too quickly. Wait a moment and try again.'),
});

/** Content creation (TeamUp posts, teams) — spam control. */
export const createLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: message('You have created a lot of posts recently. Try again later.'),
});

/**
 * The payment webhook is mounted before the global limiter (it needs the raw
 * body), so it carries its own. Generous, because a real gateway retries.
 */
export const webhookLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 120,
  message: message('Too many webhook deliveries.'),
});
