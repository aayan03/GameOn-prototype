/**
 * Integration test harness.
 *
 * Boots the real Express app against a real (in-memory) MongoDB and drives it
 * over real HTTP. Nothing is stubbed, so these tests exercise the middleware
 * chain, the validators, the Mongoose indexes and the controllers together —
 * which is where every bug this project has actually shipped was hiding.
 *
 * No test framework and no supertest: `node:test` has been stable since Node
 * 18 and `fetch` is built in. One fewer dependency tree to trust, and the
 * tests run with plain `node --test`.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let memoryServer = null;
let server = null;
let baseUrl = null;

/**
 * Environment has to be set BEFORE anything imports config/env.js, because
 * that module snapshots process.env at import time. Hence the dynamic
 * imports further down — a static `import app from '../src/app.js'` at the
 * top of this file would read the env before we had a chance to set it.
 */
function prepareEnv(uri) {
  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = uri;
  process.env.JWT_SECRET = 'test_secret_that_is_definitely_long_enough_32';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_also_long_enough_here_32';
  process.env.PORT = '0';                 // ask the OS for a free port
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  process.env.LOG_LEVEL_APP = 'silent';   // keep the test output readable
  // Pin the VENUE clock. The suite is deliberately run under a different
  // server TZ in CI, and a fixture that derived its dates from the server's
  // clock while the app used the venue's would disagree by a day for part of
  // every evening — a suite that fails only between 6:30pm and midnight is
  // worse than no suite at all.
  process.env.APP_TIMEZONE = 'Asia/Kolkata';
  // Rate limiters skip only in 'development'; NODE_ENV is 'test' here, so the
  // limits are live. That is deliberate — the lockout and throttle tests
  // depend on them, and a limiter that is bypassed in tests is a limiter
  // nobody has ever verified.

  /**
   * Blanked, not deleted — and the difference matters.
   *
   * `config/env.js` calls dotenv at import, and dotenv fills any variable
   * that is ABSENT from the real .env file. Deleting these therefore handed
   * the suite whatever the developer happened to have configured locally: the
   * moment real SMTP credentials were added to .env, the password-reset tests
   * started talking to Gmail and failing. An empty string is defined, so
   * dotenv leaves it alone and the environment is genuinely controlled.
   */
  for (const key of [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM',
    'BREVO_API_KEY', 'RESEND_API_KEY',
    'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY',
    'SENTRY_DSN', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
    'APP_URL', 'CRON_SECRET', 'ALLOW_SIMULATED_TOPUP',
  ]) {
    process.env[key] = '';
  }
}

/**
 * Boots Mongo + the app once for a whole test file.
 *
 * `env` overrides are applied AFTER the defaults and BEFORE config/env.js is
 * imported, which is the only window in which they take effect — that module
 * snapshots process.env at import time. `node --test` runs each file in its
 * own process, so a file that sets Razorpay credentials this way does not
 * leak them into any other.
 */
export async function startTestServer({ env = {} } = {}) {
  if (baseUrl) return baseUrl;

  memoryServer = await MongoMemoryServer.create();
  prepareEnv(memoryServer.getUri('gameon_test'));
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  const { default: app } = await import('../../src/app.js');
  timeUtil = await import('../../src/utils/time.js');
  await mongoose.connect(process.env.MONGO_URI);
  // Indexes are what enforce the double-booking guard and the unique
  // constraints. Mongoose builds them lazily, so a fast test can beat them to
  // it and get a false pass on exactly the guarantee it meant to check.
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  return baseUrl;
}

export async function stopTestServer() {
  if (server) await new Promise((r) => { server.close(r); });
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  server = null;
  memoryServer = null;
  baseUrl = null;
}

/**
 * Wipes every collection AND clears the rate-limit buckets between tests, so
 * one test cannot leak state into the next.
 *
 * The limiters stay switched on for the run (see middleware/rateLimit.js) —
 * they are reset, not disabled, so the tests that assert on lockout and
 * throttling are exercising the real thing.
 */
export async function resetDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  const { resetRateLimits } = await import('../../src/middleware/rateLimit.js');
  resetRateLimits();
}

/* ── HTTP ────────────────────────────────────────────────────── */

/**
 * One request. Returns `{ status, body, headers }` rather than throwing on a
 * non-2xx, because most of what these tests assert IS the error response.
 */
export async function api(method, path, { body, token, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  return { status: res.status, body: parsed, headers: res.headers };
}

export const get = (p, opts) => api('GET', p, opts);
export const post = (p, body, opts) => api('POST', p, { ...opts, body });
export const patch = (p, body, opts) => api('PATCH', p, { ...opts, body });
export const del = (p, opts) => api('DELETE', p, opts);

/* ── Fixtures ────────────────────────────────────────────────── */

let seq = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${++seq}.${Date.now()}@example.com`;

/** Pulls the one-time token out of a verification or reset URL. */
export function tokenFromUrl(url) {
  if (!url) return null;
  return new URL(url, 'http://localhost').searchParams.get('token');
}

/**
 * Registers an account AND confirms the email, returning a usable session.
 *
 * Signing up no longer creates an account on its own — it emails a link, and
 * the account is created when that link is opened. With no email transport
 * configured (which is how the suite runs) the API hands the link straight
 * back as `devVerifyUrl`, so this walks the real two-step flow rather than
 * reaching into the database behind it.
 *
 * Tests that care about the halfway state should call `/api/auth/register`
 * themselves; this helper exists for the hundred tests that just need a user.
 */
export async function createUser({ role = 'player', password = 'Password123', ...rest } = {}) {
  const email = rest.email || uniqueEmail(role);

  const started = await post('/api/auth/register', {
    name: rest.name || 'Test User',
    email,
    password,
    role,
    ...(rest.city ? { city: rest.city } : {}),
  });
  if (started.status !== 200) {
    throw new Error(`register failed (${started.status}): ${JSON.stringify(started.body)}`);
  }

  const token = tokenFromUrl(started.body?.data?.devVerifyUrl);
  if (!token) {
    throw new Error(
      `no devVerifyUrl in the register response — is an email transport configured? ${JSON.stringify(started.body)}`
    );
  }

  const res = await post('/api/auth/verify-email', { token });
  if (res.status !== 201) {
    throw new Error(`verify-email failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return {
    email,
    password,
    token: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
    user: res.body.data.user,
    id: res.body.data.user._id,
  };
}

/** Promotes a user directly in the database — admin is not API-assignable. */
export async function makeAdmin(userId) {
  await mongoose.model('User').updateOne({ _id: userId }, { $set: { role: 'admin' } });
}

export async function setVerified(userId, verified = true) {
  await mongoose.model('User').updateOne({ _id: userId }, { $set: { isVerified: verified } });
}

/** Credits a wallet without going through the (gated) top-up endpoint. */
export async function fundWallet(userId, amount) {
  await mongoose.model('User').updateOne({ _id: userId }, { $set: { walletBalance: amount } });
}

/** A minimal automated venue owned by `owner`, approved and bookable. */
export async function createVenue(owner, overrides = {}) {
  await setVerified(owner.id, true);
  const res = await post('/api/venues', {
    name: overrides.name || `Test Arena ${++seq}`,
    bookingMode: overrides.bookingMode || 'automated',
    lat: 12.9716,
    lng: 77.5946,
    slotDurationMins: 60,
    courts: overrides.courts || [
      { name: 'Turf A', sport: 'football', pricePerHour: 1000, capacity: 10 },
    ],
    address: { city: 'Bengaluru', area: 'Koramangala' },
    ...(overrides.cancellationPolicy ? { cancellationPolicy: overrides.cancellationPolicy } : {}),
    ...(overrides.manualContact ? { manualContact: overrides.manualContact } : {}),
  }, { token: owner.token });

  if (res.status !== 201) {
    throw new Error(`createVenue failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data.venue;
}

/**
 * A YYYY-MM-DD key `offset` days from today, on the VENUE's clock.
 *
 * Delegates to the app's own helper rather than reimplementing it. The old
 * hand-rolled copy read the server timezone, so under CI's deliberately
 * mismatched TZ it asked for a different day than the app would have served.
 */
export async function dateKeyAsync(offset = 1) {
  const { todayKey } = await import('../../src/utils/time.js');
  return todayKey(offset);
}

let timeUtil = null;
export function dateKey(offset = 1) {
  if (!timeUtil) throw new Error('call startTestServer() before dateKey()');
  return timeUtil.todayKey(offset);
}

/** First bookable slot on a venue's court for a given date. */
export async function firstOpenSlot(venueId, date) {
  const res = await get(`/api/venues/${venueId}/availability?date=${date}`);
  if (res.status !== 200) throw new Error(`availability failed: ${JSON.stringify(res.body)}`);
  const court = res.body.data.courts[0];
  const slot = court.slots.find((s) => s.status === 'available');
  if (!slot) throw new Error('no available slot on that date');
  return { courtId: court.courtId, start: slot.start, price: slot.price };
}
