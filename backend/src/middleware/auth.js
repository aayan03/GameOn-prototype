import ApiError from '../utils/ApiError.js';
import { User } from '../models/index.js';
import { verifyAccessToken } from '../services/token.service.js';

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  // A JWT is three dot-separated segments; anything else is not worth verifying.
  if (!token || token.split('.').length !== 3 || token.length > 4096) return null;
  return token;
}

/** Hard gate — 401s if there is no valid token. */
export async function protect(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized('Please log in to continue');

    const decoded = verifyAccessToken(token);
    // A refresh token presented as a bearer token must be rejected.
    if (decoded.type === 'refresh') throw ApiError.unauthorized('Invalid token');

    const user = await User.findById(decoded.sub);
    if (!user || !user.isActive) throw ApiError.unauthorized('Account not found or disabled');

    // Retired by a password change or a forced logout.
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      throw ApiError.unauthorized('This session has expired. Please log in again.');
    }

    req.user = user;
    next();
  } catch (err) { next(err); }
}

/** Soft gate — attaches req.user when a token is present, never blocks. */
export async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      const decoded = verifyAccessToken(token);
      // Same rule as `protect`. The two token families are signed with
      // different secrets so this cannot currently pass, but the check being
      // in one function and not the other reads as a disagreement about
      // whether it matters.
      if (decoded.type === 'refresh') return next();
      const user = await User.findById(decoded.sub);
      if (user?.isActive && (decoded.tv ?? 0) === (user.tokenVersion ?? 0)) req.user = user;
    }
  } catch { /* ignore — treat as an anonymous request */ }
  next();
}

/** Role gate. Usage: router.post('/', protect, restrictTo('owner','admin'), handler) */
export function restrictTo(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`This action requires the ${roles.join(' or ')} role`));
    }
    next();
  };
}
