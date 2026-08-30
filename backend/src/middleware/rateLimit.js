import rateLimit, { MemoryStore } from 'express-rate-limit';
import env from '../config/env.js';

const message = (text) => ({ success: false, error: { message: text } });

/**
 * Every limiter gets its own store, held here so the whole set can be reset.
 *
 * The integration suite runs with the limiters LIVE — a rate limit that is
 * switched off in tests is a rate limit nobody has ever actually verified,
 * and two of the tests exist specifically to prove the lockout and throttle
 * work. But every test drives traffic from one address, so without a way to
 * clear the buckets between tests the suite would spend most of its run
 * getting 429s from its own fixtures.
 */
const stores = [];

function makeLimiter(options) {
  const store = new MemoryStore();
  stores.push(store);
  return rateLimit({ ...options, store });
}

/** Clears every bucket. Test-only — nothing in the app calls this. */
export function resetRateLimits() {
  for (const store of stores) store.resetAll?.();
}

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  // In development one machine generates all the traffic, so limits that are
  // sensible in production make the app unusable locally. Note this checks
  // for 'development' exactly: under NODE_ENV=test the limiters stay on.
  skip: () => env.NODE_ENV === 'development',
};

/** Broad ceiling so a single client can't flood the API. */
export const globalLimiter = makeLimiter({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: message('Too many requests. Please slow down.'),
});

/** Credential endpoints — tight, because this is where guessing happens. */
export const authLimiter = makeLimiter({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,   // only failures count toward the limit
  message: message('Too many attempts. Try again in a few minutes.'),
});

/**
 * Password reset — tighter than login, and counts every attempt.
 *
 * `authLimiter` sets skipSuccessfulRequests, which is right for login (only
 * wrong guesses are suspicious) and wrong here: forgot-password deliberately
 * returns 200 for an address with no account, so under that rule an attacker
 * enumerating addresses would never consume any of their quota.
 */
export const passwordResetLimiter = makeLimiter({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 12,
  message: message('Too many password reset attempts. Try again in an hour.'),
});

/** Account creation — stops automated signup floods. */
export const registerLimiter = makeLimiter({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: message('Too many accounts created from this network. Try again later.'),
});

/** Anything that moves money or creates a booking. */
export const writeLimiter = makeLimiter({
  ...base,
  windowMs: 60 * 1000,
  max: 30,
  message: message('You are doing that too quickly. Wait a moment and try again.'),
});

/** Content creation (TeamUp posts, teams) — spam control. */
export const createLimiter = makeLimiter({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: message('You have created a lot of posts recently. Try again later.'),
});

/**
 * The payment webhook is mounted before the global limiter (it needs the raw
 * body), so it carries its own. Generous, because a real gateway retries.
 */
export const webhookLimiter = makeLimiter({
  ...base,
  windowMs: 60 * 1000,
  max: 120,
  message: message('Too many webhook deliveries.'),
});
