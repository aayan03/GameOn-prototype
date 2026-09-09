// @ts-check
/**
 * Error reporting.
 *
 * Sends unexpected failures to Sentry so production problems surface without
 * anyone tailing logs. Opt-in: with no SENTRY_DSN set, every call here is a
 * no-op and nothing leaves the process.
 *
 * No SDK. Sentry's store endpoint takes a plain JSON POST with the key in a
 * header — the same reasoning as payment.service.js. `@sentry/node` pulls in
 * a large dependency tree and monkey-patches the runtime to auto-instrument;
 * for reporting handled errors from one place, a `fetch` is the whole job.
 */

import crypto from 'node:crypto';
import env, { isProd } from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * A DSN looks like https://<publicKey>@o123.ingest.sentry.io/456
 * The store endpoint is derived from it.
 */
function parseDsn(dsn) {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    if (!url.username || !projectId) return null;
    return {
      publicKey: url.username,
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/store/`,
    };
  } catch {
    return null;
  }
}

const parsed = env.SENTRY_DSN ? parseDsn(env.SENTRY_DSN) : null;

if (env.SENTRY_DSN && !parsed) {
  logger.warn('SENTRY_DSN is set but could not be parsed — error reporting is off');
}

export const isEnabled = () => Boolean(parsed);

/** Same redaction rules as the logger — a report is just a log with a URL. */
const REDACT = /^(password|newPassword|currentPassword|token|accessToken|refreshToken|authorization|signature|secret|otp|resetToken)$/i;

function scrub(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACT.test(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

/**
 * Reports an error. Never throws and never blocks the caller — a failure in
 * the reporter must not turn a handled 500 into a crashed process, and the
 * user's response must not wait on a third-party HTTP call.
 */
export function report(err, context = {}) {
  if (!parsed) return;

  const body = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    environment: env.NODE_ENV,
    server_name: env.SERVICE_NAME,
    release: env.RELEASE || undefined,
    logger: 'gameon-api',
    exception: {
      values: [{
        type: err?.name || 'Error',
        value: String(err?.message || err).slice(0, 1000),
        stacktrace: { frames: parseStack(err?.stack) },
      }],
    },
    tags: scrub(context.tags || {}),
    extra: scrub(context.extra || {}),
    request: context.request ? scrub(context.request) : undefined,
    user: context.userId ? { id: String(context.userId) } : undefined,
  };

  // Deliberately not awaited.
  fetch(parsed.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=gameon/1.0, sentry_key=${parsed.publicKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).catch((sendErr) => {
    // Log, do not rethrow. An unhandled rejection here would take the process
    // down over a monitoring hiccup, which is worse than the missing report.
    logger.warn('error report failed to send', { reason: sendErr.message });
  });
}

/** Sentry wants newest frame last; Node gives newest first. */
function parseStack(stack) {
  if (!stack) return [];
  return String(stack)
    .split('\n')
    .slice(1, 25)
    .map((line) => {
      const m = line.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
      if (!m) return null;
      return {
        function: m[1] || '<anonymous>',
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
        in_app: !m[2].includes('node_modules') && !m[2].startsWith('node:'),
      };
    })
    .filter(Boolean)
    .reverse();
}

/**
 * Wires the last-resort process handlers.
 *
 * An uncaught exception leaves the process in an unknown state, so it still
 * exits — but not before the report is on its way. Without the delay the
 * process dies with the fetch still queued and the one error that actually
 * took production down is the one you never hear about.
 */
export function installProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
    report(reason instanceof Error ? reason : new Error(String(reason)), { tags: { kind: 'unhandledRejection' } });
  });

  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception — exiting', { err });
    report(err, { tags: { kind: 'uncaughtException' } });
    const delay = isEnabled() ? 1200 : 0;
    setTimeout(() => process.exit(1), delay).unref?.();
    // Belt and braces: if the timer is unref'd and nothing else keeps the
    // loop alive, the process exits on its own, which is the same outcome.
    if (!isProd()) setTimeout(() => process.exit(1), delay);
  });
}
