import { z } from 'zod';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { User, PendingRegistration } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import {
  signAccessToken, signRefreshToken, verifyRefreshToken,
  isRefreshRevoked, revokeRefreshToken,
} from '../services/token.service.js';
import { ROLES, SPORT_KEYS, SKILL_LEVELS, LOYALTY } from '../config/constants.js';
import * as loyalty from '../services/loyalty.service.js';
import { cleanText } from '../utils/sanitize.js';
import * as email from '../services/email.service.js';
import { appUrl, isProd } from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Per-account brute-force defence: a progressive delay, not a lockout.
 *
 * This used to freeze the account for fifteen minutes after eight failures,
 * and refuse the CORRECT password for the duration. Two things were wrong
 * with that:
 *
 *  - It is a denial of service against any account whose email you know.
 *    Eight wrong guesses every fifteen minutes — well inside the per-IP
 *    limiter's budget — keeps somebody permanently locked out of their own
 *    account, from one machine.
 *  - The lockout message only ever appeared for an address that HAS an
 *    account, so it was an existence oracle bolted onto the one endpoint that
 *    goes out of its way not to be one.
 *
 * Throttling instead is what NIST 800-63B actually recommends, for exactly
 * this reason. Guessing gets slower and slower; the real user, who knows
 * their password, is never shut out and never sees any of it.
 *
 * The per-IP limiter is still the first line — this is the per-account one,
 * which is what a distributed attempt against a single inbox runs into.
 */
const THROTTLE_AFTER = 5;          // free attempts before the delay starts
const THROTTLE_STEP_MS = 400;      // added per failure beyond that
const THROTTLE_MAX_MS = 4_000;     // ceiling, so this cannot hold a socket open
// A quiet spell clears the count — an old typo should not still be slowing
// somebody down a week later.
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** How long a failed attempt should take, given how many came before it. */
function throttleFor(failures) {
  if (failures <= THROTTLE_AFTER) return 0;
  return Math.min((failures - THROTTLE_AFTER) * THROTTLE_STEP_MS, THROTTLE_MAX_MS);
}

// A reset link is a bearer credential for an account, so it is short-lived.
const RESET_TOKEN_MINUTES = 30;

// A verification link creates an account, so it is short-lived too — but long
// enough to survive a slow inbox and someone finishing their coffee.
const VERIFY_TOKEN_MINUTES = 60;
// One verification email per address per minute, whoever asks for it.
const VERIFY_COOLDOWN_MS = 60_000;
// One reset email per account per minute. The per-IP limiter does not help
// here: the target is someone else's inbox, and the requests can come from
// anywhere.
const RESET_COOLDOWN_MS = 60_000;

/** Only the hash is ever stored — see the note on User.resetTokenHash. */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(160),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .refine((v) => /[a-zA-Z]/.test(v), 'Password must contain a letter')
    .refine((v) => /[0-9]/.test(v), 'Password must contain a number'),
  phone: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit Indian mobile number').optional(),
  // Deliberately excludes 'admin' — that role is only assignable in the database.
  role: z.enum([ROLES.PLAYER, ROLES.OWNER]).optional(),
  city: z.string().trim().max(60).optional(),
  favoriteSports: z.array(z.enum(SPORT_KEYS)).max(8).optional(),
}).strict();   // rejects unknown keys, so walletBalance can't be smuggled in

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(160),
  password: z.string().min(1, 'Password is required').max(128),
}).strict();

/**
 * Note the `.strict()` and the deliberately short field list. This schema is
 * the only thing standing between a PATCH body and `Object.assign` on the user
 * document, so anything not named here (role, walletBalance, loyaltyPoints,
 * isVerified) is rejected rather than silently applied.
 */
export const updateMeSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  phone: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit Indian mobile number').optional(),
  city: z.string().trim().max(60).optional(),
  bio: z.string().trim().max(300).optional(),
  position: z.string().trim().max(40).optional(),
  avatar: z.string().max(500).optional(),
  skillLevel: z.enum(SKILL_LEVELS).optional(),
  favoriteSports: z.array(z.enum(SPORT_KEYS)).max(8).optional(),
  lastLocation: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
}).strict();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(128),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters')
    .max(128)
    .refine((v) => /[a-zA-Z]/.test(v), 'Password must contain a letter')
    .refine((v) => /[0-9]/.test(v), 'Password must contain a number'),
}).strict();

function authPayload(user) {
  return {
    user: user.toPublic(),
    loyalty: loyalty.summarise(user),
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

/**
 * The one answer registration ever gives.
 *
 * Identical for a brand-new address and for one that already has an account,
 * because anything else is a membership oracle — and `login` and
 * `forgotPassword` both go out of their way not to be one.
 */
const CHECK_YOUR_INBOX = {
  sent: true,
  message: 'Check your email for a link to finish signing up. It expires in an hour — the spam folder is worth a look too.',
};

export const register = asyncHandler(async (req, res) => {
  const { email: address, password, name, phone, role, city, favoriteSports } = req.body;

  /**
   * The account is NOT created here. It is created when the link is clicked.
   *
   * Creating it now and marking it unverified does not close the enumeration
   * leak, it only moves it one step: the attacker chose the password, so they
   * register with victim@example.com and then try to log in with it. Success
   * means the address was free; failure means it was taken. Same oracle.
   *
   * Holding the signup in PendingRegistration instead means no password the
   * attacker picked ever works, in either case, so there is nothing to
   * compare. The answer below is the same object either way.
   *
   * Both branches hash a password with bcrypt before replying, so they also
   * take the same time — that hash was the reason the two used to be
   * separable even by something ignoring the status code.
   */
  const passwordHash = await bcrypt.hash(password, 10);
  const token = crypto.randomBytes(32).toString('base64url');
  const url = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;

  const existing = await User.findOne({ email: address }).select('name email').lean();

  if (existing) {
    /**
     * Tell the INBOX, not the caller.
     *
     * Whoever owns this address either forgot they had an account or is being
     * probed by somebody else. Either way they are the one who should hear
     * about it, and the API says exactly what it says below.
     */
    email.deliver({
      to: existing.email,
      ...email.alreadyRegisteredEmail({
        name: existing.name,
        resetUrl: `${appUrl()}/forgot-password`,
      }),
    }).catch((err) => logger.warn('already-registered notice failed', { err }));

    logger.info('signup attempted on an address that already has an account', {
      userId: String(existing._id),
    });
    return ok(res, CHECK_YOUR_INBOX);
  }

  // Replaces any earlier pending signup for this address, which is also what
  // retires a link that was already sent.
  await PendingRegistration.findOneAndUpdate(
    { email: address },
    {
      $set: {
        email: address,
        name: cleanText(name, 60),
        passwordHash,
        phone: phone || '',
        role: role || ROLES.PLAYER,
        city: cleanText(city || '', 60),
        favoriteSports: favoriteSports || [],
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_MINUTES * 60_000),
        lastSentAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const message = email.verifyEmail({ name, url, expiresMinutes: VERIFY_TOKEN_MINUTES });

  // In development there is no transport, so `deliver` returns synchronously
  // in console mode and the link comes straight back — there is no inbox to
  // check. That branch cannot run in production: validateEnv refuses to boot
  // without an email transport configured.
  if (!email.isConfigured()) {
    const result = await email.deliver({ to: address, ...message });
    return ok(res, {
      ...CHECK_YOUR_INBOX,
      ...(!isProd() && result.mode === 'console' ? { devVerifyUrl: url } : {}),
    });
  }

  email.deliver({ to: address, ...message })
    .then((r) => {
      if (r.delivered) return;
      // Nobody is holding a usable link, so do not leave the address locked
      // up in a pending row for an hour.
      PendingRegistration.deleteOne({ email: address }).catch(() => {});
      logger.error('verification email failed - pending signup cleared', { email: address });
    })
    .catch(() => { PendingRegistration.deleteOne({ email: address }).catch(() => {}); });

  return ok(res, CHECK_YOUR_INBOX);
});

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(20).max(200),
}).strict();

/**
 * POST /api/auth/verify-email
 *
 * Turns a pending signup into a real account. This is the ONLY path that
 * creates a user, so every account on the platform belongs to somebody who
 * could read the address they claimed.
 */
export const verifyEmail = asyncHandler(async (req, res) => {
  // Claim the pending row by deleting it. A link clicked twice — or replayed
  // by whoever intercepted it — finds nothing the second time.
  const pending = await PendingRegistration.findOneAndDelete({
    tokenHash: hashToken(req.body.token),
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!pending) {
    throw ApiError.badRequest('That link is invalid or has expired. Sign up again to get a new one.');
  }

  // Somebody registered this address by another route in the meantime.
  if (await User.exists({ email: pending.email })) {
    throw ApiError.conflict('That email already has an account. Try logging in instead.');
  }

  const user = new User({
    name: pending.name,
    email: pending.email,
    ...(pending.phone ? { phone: pending.phone } : {}),
    role: pending.role,
    city: pending.city,
    favoriteSports: pending.favoriteSports,
    emailVerifiedAt: new Date(),
    // Welcome points, so the loyalty screen isn't empty on day one.
    loyaltyPoints: LOYALTY.SIGNUP_BONUS,
    lifetimePoints: LOYALTY.SIGNUP_BONUS,
  });

  /**
   * The password is ALREADY hashed — carry it across without re-hashing.
   *
   * `User.pre('save')` hashes anything it sees as modified, and on a new
   * document every field is modified. Passing the hash in the constructor
   * therefore bcrypts the bcrypt, producing an account whose password can
   * never match anything the owner types. `unmarkModified` is what tells the
   * hook this value is already in its final form.
   */
  user.password = pending.passwordHash;
  user.unmarkModified('password');
  await user.save();

  logger.info('account created after email verification', { userId: String(user._id) });

  return created(res, {
    ...authPayload(user),
    message: `Welcome to GameOn, ${user.name.split(' ')[0]}.`,
  });
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(160),
}).strict();

/**
 * POST /api/auth/resend-verification
 *
 * The same single answer as register, for the same reason — this must not
 * become the oracle that register is not.
 */
export const resendVerification = asyncHandler(async (req, res) => {
  const pending = await PendingRegistration.findOne({ email: req.body.email });
  if (!pending) return ok(res, CHECK_YOUR_INBOX);

  // Per-address cooldown, so this cannot be used to bombard one inbox from a
  // botnet the per-IP limiter cannot see.
  if (pending.lastSentAt && Date.now() - pending.lastSentAt.getTime() < VERIFY_COOLDOWN_MS) {
    return ok(res, CHECK_YOUR_INBOX);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const url = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;

  await PendingRegistration.updateOne({ _id: pending._id }, {
    $set: {
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_MINUTES * 60_000),
      lastSentAt: new Date(),
    },
  });

  const message = email.verifyEmail({
    name: pending.name, url, expiresMinutes: VERIFY_TOKEN_MINUTES,
  });

  if (!email.isConfigured()) {
    const result = await email.deliver({ to: pending.email, ...message });
    return ok(res, {
      ...CHECK_YOUR_INBOX,
      ...(!isProd() && result.mode === 'console' ? { devVerifyUrl: url } : {}),
    });
  }

  email.deliver({ to: pending.email, ...message })
    .catch((err) => logger.warn('verification resend failed', { err }));

  return ok(res, CHECK_YOUR_INBOX);
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password +failedLogins +lockedUntil');

  // Same message and roughly the same work whether the account exists or not,
  // so this endpoint can't be used to enumerate registered emails.
  if (!user) {
    await sleep(120);
    throw ApiError.unauthorized('Incorrect email or password');
  }

  // `lockedUntil` is now the expiry of the FAILURE WINDOW, not a gate. Past
  // it, the count starts again — the field is reused rather than renamed so
  // no migration is needed for rows that still carry an old lock date.
  const windowOpen = user.lockedUntil && user.lockedUntil > new Date();
  const priorFailures = windowOpen ? (user.failedLogins || 0) : 0;

  /**
   * The password is checked FIRST, always.
   *
   * Whoever is holding the correct password is the account's owner, and
   * refusing them because somebody else has been guessing is the denial of
   * service this replaced. Guessing is slowed by the delay below; the person
   * who knows the password never waits at all.
   */
  const correct = await user.comparePassword(password);

  if (!correct) {
    const failures = priorFailures + 1;
    await User.updateOne({ _id: user._id }, {
      $set: {
        failedLogins: failures,
        lockedUntil: new Date(Date.now() + THROTTLE_WINDOW_MS),
      },
    });

    // Every wrong guess costs more than the last. The message never changes,
    // so the throttle is not an oracle either — a stranger cannot tell a
    // heavily-guessed real account from one that does not exist.
    await sleep(throttleFor(failures));
    throw ApiError.unauthorized('Incorrect email or password');
  }

  if (!user.isActive) throw ApiError.forbidden('This account has been disabled');

  // A successful login clears the count.
  if (user.failedLogins || user.lockedUntil) {
    await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null } });
  }

  return ok(res, authPayload(user));
});

export const refresh = asyncHandler(async (req, res) => {
  const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  if (!refreshToken) throw ApiError.badRequest('refreshToken is required');

  const decoded = verifyRefreshToken(refreshToken);

  // Signed out. Checked BEFORE the account lookup so a revoked token costs a
  // single indexed read and nothing else.
  if (await isRefreshRevoked(decoded)) {
    throw ApiError.unauthorized('This session has been signed out. Please log in again.');
  }

  const user = await User.findById(decoded.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found');

  // A password change or forced logout bumps tokenVersion, which retires every
  // refresh token minted before it.
  if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
    throw ApiError.unauthorized('This session has expired. Please log in again.');
  }

  return ok(res, { accessToken: signAccessToken(user) });
});

/**
 * POST /api/auth/logout
 *
 * Ends THIS session on the server, not just in the browser.
 *
 * Clearing localStorage was the entire logout, which meant the refresh token
 * carried on working for its full thirty days: anyone who had copied it — off
 * a shared machine, or through an XSS — kept the account for a month, and
 * pressing Log out did not take it back.
 *
 * Deliberately not authenticated by the access token. The common case for
 * logging out is that the access token has already expired, and a logout that
 * 401s is a logout that leaves the session alive.
 */
export const logout = asyncHandler(async (req, res) => {
  const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;

  if (refreshToken) {
    try {
      await revokeRefreshToken(verifyRefreshToken(refreshToken));
    } catch {
      // A token that will not verify is already worthless. Answering 200
      // either way also means this endpoint cannot be used to test whether a
      // token is valid.
    }
  }

  return ok(res, { loggedOut: true, message: 'Signed out.' });
});

/**
 * POST /api/auth/logout-all — the "somebody else has my password" button.
 *
 * Bumps tokenVersion, which retires every access and refresh token ever
 * issued to this account, on every device, immediately.
 */
export const logoutAll = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  logger.info('user signed out everywhere', { userId: String(req.user._id) });
  return ok(res, {
    loggedOut: true,
    message: 'Signed out on every device. Log in again to continue.',
  });
});

export const me = asyncHandler(async (req, res) => ok(res, {
  user: req.user.toPublic(),
  loyalty: loyalty.summarise(req.user),
}));

export const updateMe = asyncHandler(async (req, res) => {
  const { lastLocation, bio, position, name, city, ...rest } = req.body;

  Object.assign(req.user, rest);
  // Free-text fields get trimmed and capped even though zod already bounded
  // them, because these are the values shown to other players.
  if (name !== undefined) req.user.name = cleanText(name, 60);
  if (city !== undefined) req.user.city = cleanText(city, 60);
  if (bio !== undefined) req.user.bio = cleanText(bio, 300);
  if (position !== undefined) req.user.position = cleanText(position, 40);

  if (lastLocation) {
    req.user.lastLocation = { type: 'Point', coordinates: [lastLocation.lng, lastLocation.lat] };
  }

  await req.user.save();
  return ok(res, { user: req.user.toPublic() });
});

/** POST /api/auth/change-password — retires every existing session. */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) {
    throw ApiError.unauthorized('Your current password is not correct');
  }
  if (currentPassword === newPassword) {
    throw ApiError.badRequest('The new password must be different from the current one');
  }

  user.password = newPassword;
  user.tokenVersion = (user.tokenVersion || 0) + 1;   // invalidates old tokens
  await user.save();

  return ok(res, {
    ...authPayload(user),
    message: 'Password changed. You have been signed out of other devices.',
  });
});

/* ── Password reset ──────────────────────────────────────────── */

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(160),
}).strict();

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .refine((v) => /[a-zA-Z]/.test(v), 'Password must contain a letter')
    .refine((v) => /[0-9]/.test(v), 'Password must contain a number'),
}).strict();

/**
 * POST /api/auth/forgot-password
 *
 * Always answers the same way, whether or not the address has an account.
 * Saying "no account with that email" turns this into a membership oracle —
 * anybody could test a list of addresses against it — and undoes the care
 * taken to make login non-enumerable.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email: address } = req.body;

  const sameAnswer = {
    sent: true,
    message: 'If that email has a GameOn account, a reset link is on its way. Check your spam folder too.',
  };

  const user = await User.findOne({ email: address })
    .select('+resetRequestedAt name email isActive');

  // No account, or a disabled one: stop here, but answer identically.
  if (!user || !user.isActive) return ok(res, sameAnswer);

  // Per-account cooldown, so this cannot be used to bombard someone's inbox.
  if (user.resetRequestedAt && Date.now() - user.resetRequestedAt.getTime() < RESET_COOLDOWN_MS) {
    return ok(res, sameAnswer);
  }

  // 32 random bytes, base64url. The raw token goes in the email and is never
  // written down anywhere on our side.
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000);

  await User.updateOne({ _id: user._id }, {
    $set: {
      resetTokenHash: hashToken(token),
      resetTokenExpires: expires,
      resetRequestedAt: new Date(),
    },
  });

  const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const message = email.passwordResetEmail({
    name: user.name,
    url,
    expiresMinutes: RESET_TOKEN_MINUTES,
  });

  /**
   * Send WITHOUT blocking the response.
   *
   * The earlier version awaited delivery, which quietly undid the whole point
   * of the identical message above. An address with no account returned
   * immediately; an address with one returned only after a full SMTP
   * transaction — hundreds of milliseconds to seconds. Anyone could time the
   * two apart and enumerate which addresses are registered, which is exactly
   * what `login` goes out of its way to prevent a few functions up.
   *
   * Worse, a delivery failure threw 503, and that could only ever happen for
   * a real account: a different status code, not merely a different latency.
   *
   * So both branches now return the same body, the same status, in the same
   * time, and a failure is dealt with out of band.
   */
  const onFailure = () => {
    // Do not leave a live reset token on the account for half an hour with
    // nobody holding the link.
    User.updateOne({ _id: user._id }, {
      $set: { resetTokenHash: null, resetTokenExpires: null },
    }).catch(() => { /* it will expire on its own */ });
    logger.error('password reset email failed - token cleared', { userId: String(user._id) });
  };

  // In development there is no SMTP server, so `deliver` returns synchronously
  // in console mode and the link is handed straight back — no inbox to check.
  // That branch does no I/O, so it introduces no timing signal, and it cannot
  // run in production: validateEnv refuses to boot without SMTP.
  if (!email.isConfigured()) {
    const result = await email.deliver({ to: user.email, ...message });
    return ok(res, {
      ...sameAnswer,
      ...(!isProd() && result.mode === 'console' ? { devResetUrl: url } : {}),
    });
  }

  email.deliver({ to: user.email, ...message })
    .then((result) => {
      if (!result.delivered) onFailure();
      else logger.info('password reset sent', { userId: String(user._id) });
    })
    .catch(onFailure);

  return ok(res, sameAnswer);
});

/**
 * POST /api/auth/reset-password
 *
 * Consumes the token, sets the password, and bumps tokenVersion so every
 * session that existed before the reset is dead — which is the point, if the
 * reason for the reset is that someone else had the old password.
 */
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  // Claim the token atomically. Finding the user and then updating leaves a
  // window where the same link, clicked twice, resets twice — and the second
  // one could be an attacker replaying a link they intercepted.
  const user = await User.findOneAndUpdate(
    {
      resetTokenHash: hashToken(token),
      resetTokenExpires: { $gt: new Date() },
      isActive: true,
    },
    { $set: { resetTokenHash: null, resetTokenExpires: null } },
    { new: true },
  ).select('+password +resetTokenHash +resetTokenExpires');

  if (!user) {
    throw ApiError.badRequest('That reset link is invalid or has expired. Please request a new one.');
  }

  // Assigning to the field runs the pre-save hash hook; a direct update would
  // store the password in plaintext.
  user.password = password;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.failedLogins = 0;
  user.lockedUntil = null;
  await user.save();

  // Told, not asked. If the reset was not the account holder, this is how
  // they find out.
  email.deliver({ to: user.email, ...email.passwordChangedEmail({ name: user.name }) })
    .catch(() => { /* best effort — the reset itself already succeeded */ });

  logger.info('password reset completed', { userId: String(user._id) });

  return ok(res, {
    ...authPayload(user),
    message: 'Password updated. You are signed in, and signed out everywhere else.',
  });
});
