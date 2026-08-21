import { z } from 'zod';
import { User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../services/token.service.js';
import { ROLES, SPORT_KEYS, SKILL_LEVELS, LOYALTY } from '../config/constants.js';
import * as loyalty from '../services/loyalty.service.js';
import { cleanText } from '../utils/sanitize.js';

// Account lockout: after this many consecutive failures the account is frozen
// for LOCK_MINUTES. Rate limiting is per-IP; this is per-account, so a
// distributed guess against one inbox still hits a wall.
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

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

export const register = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const user = await User.create({
    ...req.body,
    // Welcome points, so the loyalty screen isn't empty on day one.
    loyaltyPoints: LOYALTY.SIGNUP_BONUS,
    lifetimePoints: LOYALTY.SIGNUP_BONUS,
  });

  return created(res, authPayload(user));
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password +failedLogins +lockedUntil');

  // Same message and roughly the same work whether the account exists or not,
  // so this endpoint can't be used to enumerate registered emails.
  if (!user) {
    await new Promise((r) => setTimeout(r, 120));
    throw ApiError.unauthorized('Incorrect email or password');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    throw ApiError.forbidden(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }

  if (!(await user.comparePassword(password))) {
    const failed = (user.failedLogins || 0) + 1;
    const update = { failedLogins: failed };
    if (failed >= MAX_FAILED_LOGINS) {
      update.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      update.failedLogins = 0;
    }
    await User.updateOne({ _id: user._id }, { $set: update });
    throw ApiError.unauthorized('Incorrect email or password');
  }

  if (!user.isActive) throw ApiError.forbidden('This account has been disabled');

  // Successful login clears the counter.
  if (user.failedLogins || user.lockedUntil) {
    await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null } });
  }

  return ok(res, authPayload(user));
});

export const refresh = asyncHandler(async (req, res) => {
  const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  if (!refreshToken) throw ApiError.badRequest('refreshToken is required');

  const decoded = verifyRefreshToken(refreshToken);
  const user = await User.findById(decoded.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found');

  // A password change or forced logout bumps tokenVersion, which retires every
  // refresh token minted before it.
  if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
    throw ApiError.unauthorized('This session has expired. Please log in again.');
  }

  return ok(res, { accessToken: signAccessToken(user) });
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
