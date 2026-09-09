// @ts-check
/**
 * Input safety helpers.
 *
 * These exist because two classes of bug are easy to introduce and hard to
 * spot in review: MongoDB operator injection, and regular expressions built
 * from user input.
 */

/**
 * Escapes every regex metacharacter so a user-supplied string can be used
 * inside `new RegExp()` safely.
 *
 * Without this, a search for `(a+)+$` is a catastrophic-backtracking ReDoS
 * that pins a CPU core, and `.*` silently matches everything.
 */
export function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a bounded, anchored-free case-insensitive regex from user input.
 * Length is capped so a huge string can't blow up the query planner.
 */
export function safeRegex(input, { max = 80 } = {}) {
  return new RegExp(escapeRegex(String(input).slice(0, max)), 'i');
}

/**
 * Strips MongoDB operators from anything that will reach a query.
 *
 * A JSON body of `{"email": {"$ne": null}, "password": {"$ne": null}}` is the
 * classic NoSQL auth bypass. Zod schemas already reject most of it by typing
 * fields as strings, but this runs on every request as defence in depth —
 * one forgotten schema shouldn't equal one authentication bypass.
 */
export function stripOperators(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((v) => stripOperators(v, depth + 1));

  const clean = {};
  for (const [key, val] of Object.entries(value)) {
    // Reject Mongo operators ($gt, $ne, $where…) and dotted paths ("a.b")
    // which can be used to reach into nested documents.
    if (key.startsWith('$') || key.includes('.')) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    clean[key] = stripOperators(val, depth + 1);
  }
  return clean;
}

/** Express middleware form of stripOperators. */
export function mongoSanitize(req, res, next) {
  if (req.body && typeof req.body === 'object') req.body = stripOperators(req.body);
  if (req.params && typeof req.params === 'object') req.params = stripOperators(req.params);

  // req.query is a getter on some Express versions — mutate in place instead
  // of reassigning, so this works on both Express 4 and 5.
  if (req.query && typeof req.query === 'object') {
    for (const key of Object.keys(req.query)) {
      if (key.startsWith('$') || key.includes('.')) { delete req.query[key]; continue; }
      const val = req.query[key];
      if (val && typeof val === 'object') req.query[key] = stripOperators(val);
    }
  }
  next();
}

/**
 * Collapses repeated query parameters (`?sort=a&sort=b` arrives as an array)
 * down to the last value. Stops a filter being smuggled past a string schema.
 */
export function preventParamPollution(req, res, next) {
  if (req.query && typeof req.query === 'object') {
    for (const key of Object.keys(req.query)) {
      if (Array.isArray(req.query[key])) {
        req.query[key] = req.query[key][req.query[key].length - 1];
      }
    }
  }
  next();
}

/** Trims and hard-caps a free-text field before it is stored or echoed back. */
export function cleanText(input, max = 500) {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, max);
}
