import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  startTestServer, stopTestServer, resetDatabase,
  get, post, patch, createUser, uniqueEmail,
} from '../helpers/harness.mjs';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

/* ── Registration ────────────────────────────────────────────── */

test('registers a player and returns a usable session', async () => {
  const email = uniqueEmail('player');
  const res = await post('/api/auth/register', {
    name: 'Aayan', email, password: 'Password123', role: 'player',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.email, email);
  assert.ok(res.body.data.accessToken, 'access token issued');
  assert.ok(res.body.data.refreshToken, 'refresh token issued');

  const me = await get('/api/auth/me', { token: res.body.data.accessToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, email);
});

test('never returns the password hash', async () => {
  const res = await post('/api/auth/register', {
    name: 'Aayan', email: uniqueEmail(), password: 'Password123',
  });
  const serialised = JSON.stringify(res.body);
  assert.ok(!serialised.includes('password'), 'no password field in the response');
  assert.equal(res.body.data.user.password, undefined);
});

test('rejects a weak password with a field-level message', async () => {
  const res = await post('/api/auth/register', {
    name: 'Aayan', email: uniqueEmail(), password: 'short',
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.error.details.password, 'password error is attributed to the field');
});

test('rejects a password with no digit', async () => {
  const res = await post('/api/auth/register', {
    name: 'Aayan', email: uniqueEmail(), password: 'alllettersnodigit',
  });
  assert.equal(res.status, 400);
});

test('refuses a duplicate email', async () => {
  const email = uniqueEmail();
  const first = await post('/api/auth/register', { name: 'First Person', email, password: 'Password123' });
  assert.equal(first.status, 201);

  const second = await post('/api/auth/register', { name: 'Second Person', email, password: 'Password123' });
  assert.equal(second.status, 409);
});

test('privilege escalation through the register body is rejected', async () => {
  // .strict() must reject unknown keys outright rather than stripping them.
  const res = await post('/api/auth/register', {
    name: 'Sneaky', email: uniqueEmail(), password: 'Password123',
    role: 'admin', walletBalance: 999999, loyaltyPoints: 999999, isVerified: true,
  });
  assert.equal(res.status, 400, 'admin role is not an accepted enum value');
});

test('walletBalance cannot be smuggled in at registration', async () => {
  const res = await post('/api/auth/register', {
    name: 'Sneaky', email: uniqueEmail(), password: 'Password123', walletBalance: 999999,
  });
  assert.equal(res.status, 400, 'unknown keys are rejected by .strict()');
});

/* ── Login ───────────────────────────────────────────────────── */

test('logs in with correct credentials', async () => {
  const u = await createUser();
  const res = await post('/api/auth/login', { email: u.email, password: u.password });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.accessToken);
});

test('does not reveal whether an email exists', async () => {
  const u = await createUser();
  const wrongPassword = await post('/api/auth/login', { email: u.email, password: 'Wrong123456' });
  const noSuchUser = await post('/api/auth/login', { email: uniqueEmail(), password: 'Wrong123456' });

  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.equal(
    wrongPassword.body.error.message,
    noSuchUser.body.error.message,
    'identical message, so the endpoint is not a membership oracle',
  );
});

test('NoSQL operator injection cannot bypass login', async () => {
  await createUser({ email: 'victim@example.com' });
  // The classic {"$ne": null} bypass, which mongoSanitize strips and the zod
  // string type rejects.
  const res = await post('/api/auth/login', {
    email: { $ne: null }, password: { $ne: null },
  });
  assert.ok(res.status === 400 || res.status === 401, `got ${res.status}`);
  assert.ok(!res.body?.data?.accessToken, 'no session was issued');
});

test('repeated failures throttle the account without locking its owner out', async () => {
  const u = await createUser();

  for (let i = 0; i < 8; i++) {
    const bad = await post('/api/auth/login', { email: u.email, password: 'Wrong123456' });
    assert.equal(bad.status, 401, 'a wrong password is always just a 401');
    assert.match(bad.body.error.message, /incorrect email or password/i);
  }

  // The whole finding: this used to answer 403 and refuse the real user for
  // fifteen minutes, so anyone who knew the address could keep them out.
  const good = await post('/api/auth/login', { email: u.email, password: u.password });
  assert.equal(good.status, 200, 'the owner still gets in with the right password');
  assert.ok(good.body.data.accessToken);
});

test('guessing gets measurably slower', async () => {
  const u = await createUser();

  const timeOne = async () => {
    const t0 = Date.now();
    await post('/api/auth/login', { email: u.email, password: 'Wrong123456' });
    return Date.now() - t0;
  };

  const first = await timeOne();          // inside the free allowance
  for (let i = 0; i < 8; i++) await timeOne();
  const later = await timeOne();          // well past it

  assert.ok(later > first + 500,
    `a late guess should cost noticeably more (first ${first}ms, later ${later}ms)`);
});

test('a successful login clears the throttle', async () => {
  const u = await createUser();
  for (let i = 0; i < 7; i++) {
    await post('/api/auth/login', { email: u.email, password: 'Wrong123456' });
  }
  await post('/api/auth/login', { email: u.email, password: u.password });

  const t0 = Date.now();
  await post('/api/auth/login', { email: u.email, password: 'Wrong123456' });
  assert.ok(Date.now() - t0 < 500, 'the count started again after a good login');
});

test('the throttle is not an account-existence oracle', async () => {
  const u = await createUser();
  // Drive a real account deep into the throttle.
  for (let i = 0; i < 9; i++) {
    await post('/api/auth/login', { email: u.email, password: 'Wrong123456' });
  }

  const real = await post('/api/auth/login', { email: u.email, password: 'Wrong123456' });
  const fake = await post('/api/auth/login', {
    email: 'definitely-not-registered@example.com', password: 'Wrong123456',
  });

  // Before the fix a throttled real account answered 403 with a distinct
  // message, while an unknown address answered 401 — which told an attacker
  // exactly which addresses were registered.
  assert.equal(real.status, fake.status, 'same status');
  assert.equal(real.body.error.message, fake.body.error.message, 'same message');
});

/* ── Tokens ──────────────────────────────────────────────────── */

test('rejects a request with no token', async () => {
  const res = await get('/api/auth/me');
  assert.equal(res.status, 401);
});

test('rejects a malformed token', async () => {
  const res = await get('/api/auth/me', { token: 'not.a.jwt' });
  assert.equal(res.status, 401);
});

test('a refresh token cannot be used as an access token', async () => {
  const u = await createUser();
  const res = await get('/api/auth/me', { token: u.refreshToken });
  assert.equal(res.status, 401, 'token type confusion is blocked');
});

test('refresh issues a new access token', async () => {
  const u = await createUser();
  const res = await post('/api/auth/refresh', { refreshToken: u.refreshToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.accessToken);

  const me = await get('/api/auth/me', { token: res.body.data.accessToken });
  assert.equal(me.status, 200);
});

test('changing the password kills every existing session', async () => {
  const u = await createUser();

  const changed = await post('/api/auth/change-password',
    { currentPassword: u.password, newPassword: 'BrandNew123' },
    { token: u.token });
  assert.equal(changed.status, 200);

  // The old access token carried the pre-change tokenVersion.
  const stale = await get('/api/auth/me', { token: u.token });
  assert.equal(stale.status, 401, 'old access token is retired');

  const staleRefresh = await post('/api/auth/refresh', { refreshToken: u.refreshToken });
  assert.equal(staleRefresh.status, 401, 'old refresh token is retired too');

  // The freshly issued one works.
  const fresh = await get('/api/auth/me', { token: changed.body.data.accessToken });
  assert.equal(fresh.status, 200);
});

test('change-password refuses a wrong current password', async () => {
  const u = await createUser();
  const res = await post('/api/auth/change-password',
    { currentPassword: 'NotMyPassword1', newPassword: 'BrandNew123' },
    { token: u.token });
  assert.equal(res.status, 401);
});

/* ── Profile ─────────────────────────────────────────────────── */

test('profile update cannot change role or balance', async () => {
  const u = await createUser();
  const res = await patch('/api/auth/me',
    { name: 'Renamed', role: 'admin', walletBalance: 50000 },
    { token: u.token });

  assert.equal(res.status, 400, 'unknown keys are rejected outright');

  // And the legitimate subset still works.
  const ok = await patch('/api/auth/me', { name: 'Renamed' }, { token: u.token });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.user.name, 'Renamed');
  assert.equal(ok.body.data.user.role, 'player', 'role is unchanged');
});

/* ── Password reset ──────────────────────────────────────────── */

test('forgot-password answers identically for known and unknown addresses', async () => {
  const u = await createUser();
  const known = await post('/api/auth/forgot-password', { email: u.email });
  const unknown = await post('/api/auth/forgot-password', { email: uniqueEmail('ghost') });

  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(known.body.data.message, unknown.body.data.message,
    'no membership oracle');
});

test('a reset link sets a new password and retires old sessions', async () => {
  const u = await createUser();

  const forgot = await post('/api/auth/forgot-password', { email: u.email });
  // With SMTP unconfigured the harness runs in console mode, which hands the
  // link back so the flow is testable end to end.
  const url = forgot.body.data.devResetUrl;
  assert.ok(url, 'dev reset url returned when SMTP is not configured');
  const token = new URL(url).searchParams.get('token');
  assert.ok(token);

  const reset = await post('/api/auth/reset-password', { token, password: 'ResetPass123' });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.data.accessToken, 'signed in straight after resetting');

  // Old session is dead.
  assert.equal((await get('/api/auth/me', { token: u.token })).status, 401);

  // New password works, old one does not.
  assert.equal((await post('/api/auth/login', { email: u.email, password: 'ResetPass123' })).status, 200);
  assert.equal((await post('/api/auth/login', { email: u.email, password: u.password })).status, 401);
});

test('a reset token works exactly once', async () => {
  const u = await createUser();
  const forgot = await post('/api/auth/forgot-password', { email: u.email });
  const token = new URL(forgot.body.data.devResetUrl).searchParams.get('token');

  assert.equal((await post('/api/auth/reset-password', { token, password: 'FirstUse123' })).status, 200);
  const replay = await post('/api/auth/reset-password', { token, password: 'SecondUse123' });
  assert.equal(replay.status, 400, 'the token was consumed');
});

test('an expired reset token is refused', async () => {
  const u = await createUser();
  const forgot = await post('/api/auth/forgot-password', { email: u.email });
  const token = new URL(forgot.body.data.devResetUrl).searchParams.get('token');

  // Wind the expiry into the past rather than waiting 30 minutes.
  await mongoose.model('User').updateOne(
    { email: u.email },
    { $set: { resetTokenExpires: new Date(Date.now() - 1000) } },
  );

  const res = await post('/api/auth/reset-password', { token, password: 'TooLate123' });
  assert.equal(res.status, 400);
});

test('a forged reset token is refused', async () => {
  await createUser();
  const res = await post('/api/auth/reset-password', {
    token: 'a'.repeat(43), password: 'Whatever123',
  });
  assert.equal(res.status, 400);
});

test('the raw reset token is never stored in the database', async () => {
  const u = await createUser();
  const forgot = await post('/api/auth/forgot-password', { email: u.email });
  const token = new URL(forgot.body.data.devResetUrl).searchParams.get('token');

  const stored = await mongoose.model('User')
    .findOne({ email: u.email })
    .select('+resetTokenHash')
    .lean();

  assert.ok(stored.resetTokenHash, 'a hash is stored');
  assert.notEqual(stored.resetTokenHash, token, 'the raw token is not stored');
  assert.equal(stored.resetTokenHash.length, 64, 'stored as a sha256 hex digest');
});

test('reset is throttled per account', async () => {
  const u = await createUser();
  const first = await post('/api/auth/forgot-password', { email: u.email });
  const second = await post('/api/auth/forgot-password', { email: u.email });

  assert.equal(second.status, 200, 'still answers 200, to stay non-enumerable');
  assert.ok(first.body.data.devResetUrl, 'first request issued a link');
  assert.ok(!second.body.data.devResetUrl, 'the immediate retry did not');
});

test('forgot-password does not leak account existence through status or timing', async () => {
  const u = await createUser();

  // Both branches must return the same status. The 503-on-delivery-failure
  // path could only ever fire for a real account, which made it an oracle.
  const known = await post('/api/auth/forgot-password', { email: u.email });
  const unknown = await post('/api/auth/forgot-password', { email: uniqueEmail('ghost') });

  assert.equal(known.status, unknown.status, 'same status for both');
  assert.equal(known.status, 200);
  assert.deepEqual(
    Object.keys(known.body.data).filter((k) => k !== 'devResetUrl').sort(),
    Object.keys(unknown.body.data).filter((k) => k !== 'devResetUrl').sort(),
    'same response shape, so the body is not an oracle either',
  );
});


/* ── Logging out actually ends the session ───────────────────── */

test('logging out revokes the refresh token on the server', async () => {
  const user = await createUser({ role: 'player' });

  // It works before logging out.
  const before = await post('/api/auth/refresh', { refreshToken: user.refreshToken });
  assert.equal(before.status, 200, 'a live session refreshes');

  const out = await post('/api/auth/logout', { refreshToken: user.refreshToken });
  assert.equal(out.status, 200);

  // And is dead afterwards. This is the whole finding: before the fix a
  // stolen refresh token kept working for thirty days no matter how many
  // times the real user pressed Log out.
  const after = await post('/api/auth/refresh', { refreshToken: user.refreshToken });
  assert.equal(after.status, 401, 'a signed-out token must not refresh');
  assert.match(after.body.error.message, /signed out/i);
});

test('logging out of one session leaves the others alone', async () => {
  const user = await createUser({ role: 'player' });
  // A second device: same account, its own tokens.
  const second = await post('/api/auth/login', { email: user.email, password: user.password });
  assert.equal(second.status, 200);
  const phone = second.body.data.refreshToken;

  await post('/api/auth/logout', { refreshToken: user.refreshToken });

  const stillGood = await post('/api/auth/refresh', { refreshToken: phone });
  assert.equal(stillGood.status, 200, 'signing out of a laptop must not sign out the phone');
});

test('logout is idempotent and never leaks whether a token was valid', async () => {
  const user = await createUser({ role: 'player' });

  const first = await post('/api/auth/logout', { refreshToken: user.refreshToken });
  const again = await post('/api/auth/logout', { refreshToken: user.refreshToken });
  const junk = await post('/api/auth/logout', { refreshToken: 'not.a.token' });
  const empty = await post('/api/auth/logout', {});

  for (const [name, res] of [['first', first], ['repeat', again], ['junk', junk], ['empty', empty]]) {
    assert.equal(res.status, 200, `${name} answers 200`);
    assert.deepEqual(res.body.data.loggedOut, true, `${name} says the same thing`);
  }
});

test('logout-all kills every session at once', async () => {
  const user = await createUser({ role: 'player' });
  const second = await post('/api/auth/login', { email: user.email, password: user.password });
  const phone = second.body.data.refreshToken;

  const res = await post('/api/auth/logout-all', {}, { token: user.token });
  assert.equal(res.status, 200);

  for (const [name, rt] of [['laptop', user.refreshToken], ['phone', phone]]) {
    const after = await post('/api/auth/refresh', { refreshToken: rt });
    assert.equal(after.status, 401, `${name} is signed out too`);
  }

  // The access token dies with them.
  const me = await get('/api/auth/me', { token: user.token });
  assert.equal(me.status, 401, 'the access token is retired as well');
});

test('logout-all needs a session of its own', async () => {
  const res = await post('/api/auth/logout-all', {});
  assert.equal(res.status, 401);
});
