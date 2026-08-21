import jwt from 'jsonwebtoken';
import env from '../config/env.js';

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

export function signRefreshToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), type: 'refresh', tv: user.tokenVersion ?? 0 },
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
