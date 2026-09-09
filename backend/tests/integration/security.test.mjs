/**
 * Hostile input, forged tokens, and everything one account should not be able
 * to reach from another.
 *
 * The existing suites check that the app works. This one checks that it does
 * not work when it is being attacked: a token minted with the wrong secret, a
 * role edited into a payload, an operator smuggled into a query, one owner
 * reaching for another's takings.
 *
 * Every case here is written from the attacker's side and asserts the refusal,
 * not the feature. A test that passes because the endpoint 500s is not a pass,
 * so status codes are asserted exactly.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase, serverUrl,
  get, post, patch, del, createUser, createVenue, makeAdmin, fundWallet,
  dateKey, firstOpenSlot,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

/* ── Token forgery ───────────────────────────────────────────── */

const ISSUER = 'gameon';

/** Signs a payload the way the app would, so only the claim under test differs. */
const mint = (payload, secret, opts = {}) => jwt.sign(
  payload, secret, { expiresIn: '2h', issuer: ISSUER, audience: ISSUER, ...opts },
);

test('a token signed with the wrong secret is refused', async () => {
  const user = await createUser();
  const forged = mint({ sub: user.id, role: 'admin', tv: 0 }, 'not-the-real-secret');

  const res = await get('/api/auth/me', { token: forged });
  assert.equal(res.status, 401);
});

test('an alg:none token is refused', async () => {
  // The classic. jsonwebtoken will not sign `none`, so build it by hand.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const user = await createUser();
  const header = b64({ alg: 'none', typ: 'JWT' });
  const claims = b64({
    sub: user.id, role: 'admin', tv: 0, iss: ISSUER, aud: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const res = await get('/api/auth/me', { token: `${header}.${claims}.` });
  assert.equal(res.status, 401);
});

test('a role edited into the token does not grant that role', async () => {
  // The signature is checked, so this cannot be forged — but the app must also
  // not TRUST the role claim over the database, in case a token outlives a
  // demotion. `protect` re-reads the user, and restrictTo reads req.user.role.
  const player = await createUser({ role: 'player' });
  const { JWT_SECRET } = process.env;
  const escalated = mint({ sub: player.id, role: 'admin', tv: 0 }, JWT_SECRET);

  const res = await get('/api/admin/stats', { token: escalated });
  assert.equal(res.status, 403, 'the database says player, and the database wins');
});

test('a refresh token cannot be used as an access token', async () => {
  const user = await createUser();
  const res = await get('/api/auth/me', { token: user.refreshToken });
  assert.equal(res.status, 401);
});

test('an access token cannot be used to refresh', async () => {
  const user = await createUser();
  const res = await post('/api/auth/refresh', { refreshToken: user.token });
  assert.equal(res.status, 401);
});

test('an expired token is refused', async () => {
  const user = await createUser();
  const expired = mint({ sub: user.id, role: 'player', tv: 0 }, process.env.JWT_SECRET,
    { expiresIn: '-1s' });

  const res = await get('/api/auth/me', { token: expired });
  assert.equal(res.status, 401);
});

test('a token with the wrong issuer or audience is refused', async () => {
  const user = await createUser();
  for (const opts of [{ issuer: 'somebody-else' }, { audience: 'somebody-else' }]) {
    const wrong = jwt.sign({ sub: user.id, role: 'player', tv: 0 }, process.env.JWT_SECRET,
      { expiresIn: '2h', issuer: ISSUER, audience: ISSUER, ...opts });
    const res = await get('/api/auth/me', { token: wrong });
    assert.equal(res.status, 401, JSON.stringify(opts));
  }
});

test('a token for a deleted account is refused', async () => {
  const user = await createUser();
  await mongoose.model('User').deleteOne({ _id: user.id });

  const res = await get('/api/auth/me', { token: user.token });
  assert.equal(res.status, 401);
});

test('a token for a disabled account is refused', async () => {
  const user = await createUser();
  await mongoose.model('User').updateOne({ _id: user.id }, { $set: { isActive: false } });

  const res = await get('/api/auth/me', { token: user.token });
  assert.equal(res.status, 401);
});

test('every session dies when the user signs out everywhere', async () => {
  const user = await createUser();
  assert.equal((await get('/api/auth/me', { token: user.token })).status, 200);

  await post('/api/auth/logout-all', {}, { token: user.token });

  assert.equal((await get('/api/auth/me', { token: user.token })).status, 401);
  assert.equal((await post('/api/auth/refresh', { refreshToken: user.refreshToken })).status, 401);
});

test('a malformed Authorization header is refused, not crashed on', async () => {
  const shapes = [
    'Bearer',
    'Bearer ',
    'Bearer notatoken',
    'Bearer a.b',
    'Bearer a.b.c.d',
    'Basic dXNlcjpwYXNz',
    `Bearer ${'x'.repeat(9000)}`,
    'Bearer null',
    'Bearer undefined',
  ];
  for (const header of shapes) {
    const res = await get('/api/auth/me', { headers: { Authorization: header } });
    assert.equal(res.status, 401, `header: ${header.slice(0, 30)}`);
  }
});

/* ── Authorization: one account reaching for another ─────────── */

test('a player cannot reach any admin endpoint', async () => {
  const player = await createUser({ role: 'player' });
  const routes = [
    ['GET', '/api/admin/stats'],
    ['GET', '/api/admin/venues'],
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/ledger'],
    ['POST', '/api/admin/payouts/run'],
    ['POST', '/api/admin/lifecycle'],
  ];
  for (const [method, path] of routes) {
    const res = method === 'GET'
      ? await get(path, { token: player.token })
      : await post(path, {}, { token: player.token });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
});

test('a player cannot reach any owner endpoint', async () => {
  const player = await createUser({ role: 'player' });
  for (const path of ['/api/owner/overview', '/api/owner/payouts', '/api/owner/promos']) {
    assert.equal((await get(path, { token: player.token })).status, 403, path);
  }
});

test('an owner cannot read another owner\'s dashboard figures', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  const player = await createUser();
  const venueA = await createVenue(a);
  await fundWallet(player.id, 50000);

  const date = dateKey(2);
  const slot = await firstOpenSlot(venueA._id, date);
  await post('/api/bookings', {
    venueId: venueA._id, courtId: slot.courtId, date, starts: [slot.start],
  }, { token: player.token });

  // B asks for A's venue explicitly.
  const overview = await get(`/api/owner/overview?venueId=${venueA._id}`, { token: b.token });
  const seen = JSON.stringify(overview.body?.data || {});
  assert.ok(!seen.includes(String(venueA._id)), 'B must not see A\'s venue in their overview');

  const calendar = await get(`/api/owner/calendar?venueId=${venueA._id}&date=${date}`,
    { token: b.token });
  assert.ok([403, 404].includes(calendar.status),
    `expected a refusal, got ${calendar.status}`);
});

test('an owner cannot settle or decide a booking at somebody else\'s venue', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  const player = await createUser();
  const venueA = await createVenue(a, { bookingMode: 'manual' });
  await fundWallet(player.id, 50000);

  const date = dateKey(2);
  const slot = await firstOpenSlot(venueA._id, date);
  const booked = await post('/api/bookings', {
    venueId: venueA._id, courtId: slot.courtId, date, starts: [slot.start],
  }, { token: player.token });
  const { groupRef } = booked.body.data.booking;

  assert.equal((await patch(`/api/bookings/${groupRef}/decision`,
    { decision: 'confirm' }, { token: b.token })).status, 403);
  assert.equal((await patch(`/api/bookings/${groupRef}/settle`,
    {}, { token: b.token })).status, 403);
});

test('a player cannot read, cancel or pay for someone else\'s booking', async () => {
  const owner = await createUser({ role: 'owner' });
  const victim = await createUser();
  const attacker = await createUser();
  const venue = await createVenue(owner);
  await fundWallet(victim.id, 50000);

  const date = dateKey(2);
  const slot = await firstOpenSlot(venue._id, date);
  const booked = await post('/api/bookings', {
    venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start],
  }, { token: victim.token });
  const { groupRef } = booked.body.data.booking;

  assert.equal((await get(`/api/bookings/${groupRef}`, { token: attacker.token })).status, 403);
  assert.equal((await patch(`/api/bookings/${groupRef}/cancel`, {},
    { token: attacker.token })).status, 403);
  assert.equal((await post('/api/payments/order', { groupRef },
    { token: attacker.token })).status, 501, 'no gateway here, but never 200');
});

test('a signed-out request cannot reach anything that needs an account', async () => {
  const paths = [
    '/api/auth/me', '/api/bookings', '/api/bookings/wallet',
    '/api/notifications', '/api/loyalty', '/api/owner/overview', '/api/admin/stats',
  ];
  for (const p of paths) {
    assert.equal((await get(p)).status, 401, p);
  }
});

test('an owner cannot edit or delete another owner\'s promo', async () => {
  const a = await createUser({ role: 'owner' });
  const b = await createUser({ role: 'owner' });
  await createVenue(a);

  const made = await post('/api/owner/promos', {
    code: 'MINE10', type: 'percent', value: 10, description: 'ten off',
  }, { token: a.token });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.data.promo?._id || made.body.data._id;

  assert.ok([403, 404].includes((await patch(`/api/owner/promos/${id}`,
    { value: 90 }, { token: b.token })).status));
  assert.ok([403, 404].includes((await del(`/api/owner/promos/${id}`,
    { token: b.token })).status));
});

/* ── Injection and type confusion ────────────────────────────── */

test('the classic NoSQL auth bypass does not log anybody in', async () => {
  await createUser({ email: 'victim@example.com', password: 'Password123' });

  for (const payload of [
    { email: { $ne: null }, password: { $ne: null } },
    { email: { $gt: '' }, password: { $gt: '' } },
    { email: 'victim@example.com', password: { $ne: 'x' } },
    { email: { $regex: '.*' }, password: 'Password123' },
  ]) {
    const res = await post('/api/auth/login', payload);
    assert.ok(res.status === 400 || res.status === 401,
      `expected a refusal, got ${res.status} for ${JSON.stringify(payload)}`);
    assert.ok(!res.body?.data?.accessToken, 'no token may come back');
  }
});

test('operators in a query string are stripped rather than reaching Mongo', async () => {
  const owner = await createUser({ role: 'owner' });
  await createVenue(owner, { name: 'Findable Arena' });

  for (const qs of [
    'city[$ne]=x', 'q[$regex]=.*', 'limit[$gt]=0',
    'sort[$where]=1', 'minRating[$gte]=0',
  ]) {
    const res = await get(`/api/venues?${qs}`);
    assert.ok(res.status < 500, `${qs} produced ${res.status}`);
  }
});

test('a prototype-pollution payload does not reach Object.prototype', async () => {
  const user = await createUser();

  await patch('/api/auth/me', {
    __proto__: { polluted: 'yes' },
    constructor: { prototype: { polluted: 'yes' } },
    name: 'Still Me',
  }, { token: user.token });

  assert.equal({}.polluted, undefined, 'Object.prototype was polluted');
  assert.equal(Object.prototype.polluted, undefined);
});

test('unknown keys in a strict body are rejected, not silently applied', async () => {
  const user = await createUser();

  const res = await patch('/api/auth/me', {
    name: 'Escalate',
    role: 'admin',
    walletBalance: 999999,
    loyaltyPoints: 999999,
    isVerified: true,
  }, { token: user.token });

  assert.equal(res.status, 400, 'the schema is .strict() for exactly this reason');

  const fresh = await mongoose.model('User').findById(user.id).lean();
  assert.equal(fresh.role, 'player');
  assert.equal(fresh.walletBalance, 0);
});

test('type confusion in a body is a 400, never a 500', async () => {
  const user = await createUser();
  const owner = await createUser({ role: 'owner' });
  const venue = await createVenue(owner);
  const date = dateKey(2);
  const slot = await firstOpenSlot(venue._id, date);

  const bodies = [
    { venueId: [venue._id], courtId: slot.courtId, date, starts: [slot.start] },
    { venueId: venue._id, courtId: slot.courtId, date, starts: slot.start },
    { venueId: venue._id, courtId: slot.courtId, date, starts: [[slot.start]] },
    { venueId: venue._id, courtId: slot.courtId, date, starts: ['0'] },
    { venueId: venue._id, courtId: slot.courtId, date: 12345, starts: [slot.start] },
    { venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start], players: '5' },
    { venueId: venue._id, courtId: slot.courtId, date, starts: [slot.start], notes: { a: 1 } },
    { venueId: null, courtId: null, date: null, starts: null },
  ];

  for (const body of bodies) {
    const res = await post('/api/bookings', body, { token: user.token });
    assert.ok(res.status >= 400 && res.status < 500,
      `${JSON.stringify(body).slice(0, 70)} produced ${res.status}`);
  }
});

test('absurd numbers are refused rather than stored', async () => {
  const user = await createUser();

  for (const amount of [-1, 0, 0.5, 1e15, Number.MAX_SAFE_INTEGER]) {
    const res = await post('/api/bookings/wallet/topup', { amount }, { token: user.token });
    assert.ok(res.status >= 400, `topup ${amount} produced ${res.status}`);
  }
  for (const points of [-100, 0, 1.5, 1e12]) {
    const res = await post('/api/loyalty/redeem', { points }, { token: user.token });
    assert.ok(res.status >= 400, `redeem ${points} produced ${res.status}`);
  }

  const fresh = await mongoose.model('User').findById(user.id).lean();
  assert.equal(fresh.walletBalance, 0, 'nothing was credited by any of that');
});

test('a malformed or oversized body is a clean 4xx', async () => {
  const base = serverUrl();

  const bad = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email": "a@b.c", "password":',
  });
  assert.equal(bad.status, 400);

  const huge = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(2 * 1024 * 1024) }),
  });
  assert.equal(huge.status, 413);
});

test('a deeply nested body does not blow the stack', async () => {
  const user = await createUser();
  let nested = { v: 1 };
  for (let i = 0; i < 4000; i++) nested = { nested };

  const res = await post('/api/auth/me', nested, { token: user.token }).catch(() => null);
  // Any answer is fine; a hung process or a 500 stack overflow is not.
  assert.ok(res === null || res.status < 500, `produced ${res?.status}`);
});

test('a regex bomb in search is treated as literal text', async () => {
  const owner = await createUser({ role: 'owner' });
  await createVenue(owner);

  const started = Date.now();
  const res = await get(`/api/venues?q=${encodeURIComponent('(a+)+$'.repeat(20))}`);
  const ms = Date.now() - started;

  assert.ok(res.status < 500, `search produced ${res.status}`);
  assert.ok(ms < 5000, `search took ${ms}ms — input is reaching the regex engine unescaped`);
});

test('control characters and RTL text survive without breaking anything', async () => {
  const user = await createUser();
  const nasty = 'Ali ce ‮gnitset‬ 🏏 <script>alert(1)</script>';

  const res = await patch('/api/auth/me', { name: nasty }, { token: user.token });
  assert.ok(res.status < 500, `produced ${res.status}`);

  if (res.status === 200) {
    const me = await get('/api/auth/me', { token: user.token });
    // Stored as data, echoed as data — the frontend escapes on render. What
    // matters here is that it round-trips without corrupting the document.
    assert.equal(typeof me.body.data.user.name, 'string');
  }
});

test('a path-traversal id is a 400, not a lookup', async () => {
  for (const id of ['../../etc/passwd', '..%2F..%2Fetc', 'null', '0', '{}']) {
    const res = await get(`/api/venues/${encodeURIComponent(id)}`);
    assert.ok(res.status === 400 || res.status === 404, `${id} produced ${res.status}`);
  }
});

/* ── What must never come back in a response ─────────────────── */

test('no response ever carries a password hash or a reset token', async () => {
  const user = await createUser();
  const owner = await createUser({ role: 'owner' });
  const venue = await createVenue(owner);

  const bodies = [
    (await get('/api/auth/me', { token: user.token })).body,
    (await get(`/api/venues/${venue._id}`)).body,
    (await get('/api/loyalty', { token: user.token })).body,
    (await post('/api/auth/login', { email: user.email, password: user.password })).body,
  ];

  for (const body of bodies) {
    const text = JSON.stringify(body);
    for (const secret of ['password', 'resetTokenHash', 'resetTokenExpires',
      'signupNoticeAt', 'pushTokens', 'failedLogins', '$2a$', '$2b$']) {
      assert.ok(!text.includes(secret), `a response leaked ${secret}`);
    }
  }
});

test('a public venue page hides the owner\'s contact details and our terms', async () => {
  const owner = await createUser({ role: 'owner', name: 'Owner Person' });
  const venue = await createVenue(owner);

  const res = await get(`/api/venues/${venue._id}`);
  const text = JSON.stringify(res.body);

  assert.ok(!text.includes(owner.email), 'the owner email is public');
  assert.ok(!text.includes('commissionPercent'), 'our commercial terms are public');
  assert.ok(!text.includes('moderationNote'), 'the internal review trail is public');
});

test('an unexpected failure does not hand back a stack trace', async () => {
  // A CastError inside a populate path is the easiest genuine 500 to provoke.
  const res = await get('/api/reviews/venue/not-an-object-id');
  assert.ok(res.status < 500, `expected a handled 4xx, got ${res.status}`);
  const text = JSON.stringify(res.body || {});
  assert.ok(!text.includes('at Object.'), 'a stack trace reached the client');
  assert.ok(!text.includes('mongodb://'), 'a connection string reached the client');
});

test('an unknown route answers 404 without echoing script back', async () => {
  const res = await get('/api/<script>alert(1)</script>');
  assert.equal(res.status, 404);
  // Express reflects the path in its message; it must not come back as HTML.
  assert.match(res.headers.get('content-type') || '', /application\/json/);
});

/* ── The cron surface ────────────────────────────────────────── */

test('the cron routes are invisible without a configured secret', async () => {
  // CRON_SECRET is cleared by the harness, so these must 404 rather than run.
  for (const path of ['/api/cron/lifecycle', '/api/cron/seed', '/api/cron/lucknow']) {
    const res = await post(path, {});
    assert.equal(res.status, 404, path);
  }
  assert.equal((await get('/api/cron/lifecycle')).status, 404);
});

test('an admin token does not open the cron routes either', async () => {
  const admin = await createUser();
  await makeAdmin(admin.id);
  const res = await post('/api/cron/lifecycle', {}, { token: admin.token });
  assert.equal(res.status, 404, 'the shared secret is the only key to this door');
});
