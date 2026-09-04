import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import env from '../config/env.js';
import { RevokedToken } from '../models/index.js';

const ISSUER = 'gameon';

/**
 * `tv` is the user's tokenVersion. Bumping it on the user document retires
 * every token minted before that point — which is what makes changing a
 * password actually sign other devices out, rather than just feeling like it.
 */
export function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, tv: user.tokenVersion ?? 0 },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN, issuer: ISSUER, audience: ISSUER }
  );
}

/**
 * `jti` is what makes a single session revocable.
 *
 * Without one, the only handle on a live session is `tokenVersion`, which
 * retires every token the account has — so "log out" on a shared computer
 * either did nothing on the server at all (what it used to do) or would have
 * signed the user out of their phone too. An id per token lets one session be
 * ended and the rest left alone.
 */
export function signRefreshToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      type: 'refresh',
      tv: user.tokenVersion ?? 0,
      jti: crypto.randomUUID(),
    },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN, issuer: ISSUER, audience: ISSUER }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: ISSUER, audience: ISSUER, algorithms: ['HS256'],
  });
}

export function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: ISSUER, audience: ISSUER, algorithms: ['HS256'],
  });
  // A refresh token must not be usable as an access token, and vice versa.
  if (decoded.type !== 'refresh') {
    const err = new Error('Wrong token type');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return decoded;
}

/** Has this session been signed out? */
export async function isRefreshRevoked(decoded) {
  if (!decoded?.jti) return false;   // minted before jti existed
  return Boolean(await RevokedToken.exists({ jti: decoded.jti }));
}

/**
 * Ends one session. Idempotent — signing out twice is not an error, and the
 * unique index would otherwise turn a double-tap on Log out into a 409.
 */
export async function revokeRefreshToken(decoded) {
  if (!decoded?.jti) return false;
  await RevokedToken.updateOne(
    { jti: decoded.jti },
    {
      $setOnInsert: {
        user: decoded.sub,
        // The row is only useful until the token would have expired anyway.
        // `exp` is in seconds.
        expiresAt: new Date((decoded.exp || Math.floor(Date.now() / 1000) + 86400) * 1000),
      },
    },
    { upsert: true }
  );
  return true;
}
