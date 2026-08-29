/**
 * Structured logging.
 *
 * Production logs are JSON, one object per line. That is not cosmetic: every
 * log platform (Render, Railway, CloudWatch, Loki, Datadog) indexes JSON
 * fields and can do nothing useful with `console.error('[error]', err)` — you
 * get a wall of text you can only grep, and a multi-line stack trace arrives
 * as a dozen unrelated entries.
 *
 * Development stays human-readable, because nobody debugs by reading JSON.
 *
 * No dependency. A logger is a `JSON.stringify` and a level check; pinning a
 * framework for that is not worth the supply-chain surface.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import env, { isProd } from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const threshold = LEVELS[env.LOG_LEVEL_APP] ?? (isProd() ? LEVELS.info : LEVELS.debug);

/**
 * Carries the current request's id through every async hop without threading
 * it manually through a dozen function signatures. A log line written deep in
 * a service can then be tied back to the request that caused it — which is
 * the whole point of having ids at all.
 */
export const requestContext = new AsyncLocalStorage();

/** Keys whose values must never reach a log line. */
const REDACT = /^(password|newPassword|currentPassword|token|accessToken|refreshToken|refreshtoken|authorization|signature|secret|otp|resetToken)$/i;

/**
 * Recursively strips secrets before anything is serialised.
 *
 * Logs get shipped to third-party platforms and read by people who are not
 * the account holder. A request body logged verbatim on a validation error is
 * how plaintext passwords end up in a log aggregator forever.
 */
function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACT.test(k)) { out[k] = '[redacted]'; continue; }
    out[k] = redact(v, depth + 1);
  }
  return out;
}

/** Errors do not survive JSON.stringify — name, message and stack are all non-enumerable. */
function serialiseError(err) {
  if (!(err instanceof Error)) return err;
  return {
    name: err.name,
    message: err.message,
    // The stack is the single most useful field when something breaks, and
    // the single most useless one when it is 60 frames of node internals.
    stack: String(err.stack || '').split('\n').slice(0, 12).join('\n'),
    ...(err.statusCode ? { statusCode: err.statusCode } : {}),
    ...(err.code ? { code: err.code } : {}),
  };
}

function emit(level, message, fields = {}) {
  if (LEVELS[level] < threshold) return;

  const ctx = requestContext.getStore();
  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.userId ? { userId: ctx.userId } : {}),
    ...redact(fields),
    ...(fields.err ? { err: serialiseError(fields.err) } : {}),
  };

  const line = isProd()
    ? JSON.stringify(entry)
    : `${level.toUpperCase().padEnd(5)} ${message}${Object.keys(fields).length ? ` ${JSON.stringify(redact(fields), (k, v) => (v instanceof Error ? serialiseError(v) : v))}` : ''}`;

  // stderr for warn and above so a platform's error stream picks them up.
  if (LEVELS[level] >= LEVELS.warn) console.error(line);
  else console.log(line);
}

const logger = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),

  /** Runs `fn` with a request id bound to every log line it produces. */
  withContext: (ctx, fn) => requestContext.run(ctx, fn),

  /** Attaches the resolved user to the current request's log context. */
  setUser(userId) {
    const store = requestContext.getStore();
    if (store) store.userId = String(userId);
  },
};

export default logger;
