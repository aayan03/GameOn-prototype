/**
 * Where a post-login redirect is allowed to send somebody.
 *
 * `/login?next=…` is the only place in this app where a navigation target
 * comes from a URL, which makes it the only place an open redirect could
 * live. react-router carries an open advisory for exactly this shape — a
 * backslash inside `to` slipping past a naive "starts with /" check — so the
 * rule here is an allowlist rather than a list of things to strip.
 *
 * Allowed: a single leading slash, then anything that is not a backslash.
 *   /bookings            ✓
 *   /venues/turf-1?x=2   ✓
 *
 * Refused: protocol-relative and scheme-bearing values, and anything carrying
 * a backslash, which browsers normalise to a forward slash.
 *   //evil.com           ✗   protocol-relative
 *   /\evil.com           ✗   normalised to //evil.com
 *   https://evil.com     ✗   absolute
 *   javascript:alert(1)  ✗   not a path at all
 */
const INTERNAL_PATH = /^\/(?![/\\])[^\\]*$/;

export function safeRedirect(value, fallback = '/') {
  return typeof value === 'string' && INTERNAL_PATH.test(value) ? value : fallback;
}

export default safeRedirect;
