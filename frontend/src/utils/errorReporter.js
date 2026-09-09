/**
 * Client-side error reporting.
 *
 * Sentry was wired on the API and absent here, so a React crash in a real
 * user's browser was invisible — you would hear about it from a support
 * message, if at all. Worse, ErrorBoundary already tells people "We have
 * logged it", which was not true in production.
 *
 * Opt-in: with no VITE_SENTRY_DSN set, every call is a no-op and nothing
 * leaves the browser. That keeps development quiet and makes reporting a
 * deployment decision rather than something baked into the bundle.
 *
 * No SDK, mirroring services/errorReporter.service.js on the API for the same
 * reasons. `@sentry/browser` is a large dependency that monkey-patches fetch,
 * history and the console to auto-instrument; for reporting handled errors
 * from two known places, a `fetch` is the whole job — and every kilobyte here
 * is one a player on a phone has to download before they can book anything.
 */

const DSN = import.meta.env.VITE_SENTRY_DSN || '';
const RELEASE = import.meta.env.VITE_RELEASE || '';

/** https://<publicKey>@o123.ingest.sentry.io/456 → the store endpoint. */
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

const parsed = DSN ? parseDsn(DSN) : null;

if (DSN && !parsed) {
  // Loud, because a DSN that is set and unparseable looks exactly like
  // reporting working right up until you go looking for a report.
  console.warn('[GameOn] VITE_SENTRY_DSN is set but could not be parsed — error reporting is off.');
}

export const isEnabled = () => Boolean(parsed);

/**
 * A URL with its query string stripped.
 *
 * `?next=`, `?token=` and the reset link's own token all travel in query
 * strings, and a crash report is not the place for any of them. The path is
 * what identifies the screen; the parameters are the part that can carry a
 * credential.
 */
function safeUrl(href) {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(unparseable)';
  }
}

const REDACT = /(password|token|secret|signature|authorization|otp)/i;

/** Drops anything whose key looks like a credential, then bounds the rest. */
function scrub(obj, depth = 0) {
  if (depth > 4 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACT.test(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

/**
 * Browser stacks are newest-first; Sentry wants newest last.
 *
 * Frame lines differ between engines — Chrome gives `at fn (url:1:2)`, Firefox
 * gives `fn@url:1:2` — so both shapes are matched and anything else is
 * dropped rather than guessed at.
 */
function parseStack(stack) {
  if (!stack) return [];
  return String(stack)
    .split('\n')
    .slice(0, 25)
    .map((line) => {
      const chrome = line.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
      const firefox = line.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
      const m = chrome || firefox;
      if (!m) return null;
      return {
        function: m[1] || '<anonymous>',
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
        in_app: !m[2].includes('/assets/vendor'),
      };
    })
    .filter(Boolean)
    .reverse();
}

/**
 * The same error, over and over, is one report.
 *
 * A render loop or a broken interval can throw hundreds of times a minute.
 * Without this the first user to hit one exhausts the project's quota and
 * every other error that day is dropped on the floor.
 */
const seen = new Map();
const DEDUPE_MS = 60_000;

function alreadyReported(key) {
  const now = Date.now();
  for (const [k, at] of seen) if (now - at > DEDUPE_MS) seen.delete(k);
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

/**
 * Reports an error. Never throws, never blocks, never awaited.
 *
 * A failure inside the reporter must not become a second error — which, in an
 * error handler, is how a page ends up in a loop reporting its own reporting.
 */
export function report(error, context = {}) {
  if (!parsed) return;

  try {
    const message = String(error?.message || error).slice(0, 1000);
    const key = `${error?.name || 'Error'}:${message}`;
    if (alreadyReported(key)) return;

    const body = {
      event_id: crypto.randomUUID().replace(/-/g, ''),
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: 'error',
      environment: import.meta.env.MODE,
      release: RELEASE || undefined,
      logger: 'gameon-web',
      exception: {
        values: [{
          type: error?.name || 'Error',
          value: message,
          stacktrace: { frames: parseStack(error?.stack) },
        }],
      },
      tags: scrub({ ...context.tags }),
      extra: scrub({ ...context.extra }),
      request: {
        url: safeUrl(window.location.href),
        headers: { 'User-Agent': navigator.userAgent },
      },
      // The account id only, never the email or name. It is enough to tell
      // whether one person is hitting this or everybody is.
      user: context.userId ? { id: String(context.userId) } : undefined,
    };

    fetch(parsed.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=gameon-web/1.0, sentry_key=${parsed.publicKey}`,
      },
      body: JSON.stringify(body),
      // Survives the page being closed, which is exactly when a fatal error
      // tends to be reported.
      keepalive: true,
    }).catch(() => { /* a monitoring hiccup is not the user's problem */ });
  } catch {
    /* reporting must never be the thing that breaks */
  }
}

/**
 * Catches what never reaches a React boundary.
 *
 * An ErrorBoundary only sees errors thrown during render. An exception in an
 * event handler, a timer, or a rejected promise goes straight past it — and
 * those are most of what actually breaks in production.
 */
export function installGlobalHandlers() {
  if (!parsed) return;

  window.addEventListener('error', (event) => {
    // A failed <img> or <script> also fires this, with no error object on it.
    if (!event.error) return;
    report(event.error, { tags: { kind: 'window.onerror' } });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error
      ? event.reason
      : new Error(String(event.reason));
    report(reason, { tags: { kind: 'unhandledRejection' } });
  });
}

export default { report, isEnabled, installGlobalHandlers };
