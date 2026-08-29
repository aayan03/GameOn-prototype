/**
 * Web Push delivery.
 *
 * Before this existed, `registerPushToken` stored subscriptions and nothing
 * ever sent to them — the client asked for notification permission, the user
 * granted it, and no push was ever delivered. Collecting a permission you do
 * not use is worse than not asking.
 *
 * The `web-push` library is used rather than hand-rolled HTTP because the
 * payload has to be encrypted with ECDH + HKDF + AES-128-GCM per RFC 8291 and
 * the request signed as a VAPID JWT per RFC 8292. That is exactly the kind of
 * cryptography not to reimplement — unlike the Razorpay REST calls elsewhere,
 * which really are just `fetch` and an HMAC.
 */

import webpush from 'web-push';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { User } from '../models/index.js';

export const isConfigured = () => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

let ready = false;

function configure() {
  if (ready || !isConfigured()) return ready;
  try {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    ready = true;
  } catch (err) {
    // A malformed key pair is a configuration error, not a runtime one — say
    // so once at boot instead of on every notification.
    logger.error('VAPID keys are invalid — push is disabled', { err });
    ready = false;
  }
  return ready;
}

configure();

/** The public key the browser needs to create a subscription. */
export const publicKey = () => (isConfigured() ? env.VAPID_PUBLIC_KEY : null);

/**
 * Hosts that are allowed to receive a push delivery.
 *
 * This list is load-bearing, not hygiene. A PushSubscription arrives from the
 * client as an opaque JSON blob, and `web-push` will POST to whatever
 * `endpoint` it contains — the library checks only that the string is
 * non-empty. Without this check, any signed-in user could register a
 * "subscription" pointing at `http://169.254.169.254/...`, an internal
 * admin service, or any host they liked, then trigger a notification to
 * themselves (making a booking is enough) and have the server issue an
 * authenticated-from-inside-the-network POST on their behalf.
 *
 * That is server-side request forgery with full control of host AND scheme,
 * which is the dangerous shape of it.
 *
 * These are the real Web Push services. Anything else is not a subscription.
 */
const ALLOWED_PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                       // Chrome / Chromium
  /^android\.googleapis\.com$/,                   // legacy GCM
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,   // Firefox
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,           // Edge / WNS
  /^web\.push\.apple\.com$/,                      // Safari
];

/**
 * Is this a plausible push endpoint, or is someone pointing us at their
 * choice of host?
 */
export function isAllowedPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(String(endpoint));
  } catch {
    return false;
  }
  // https only. http would allow plaintext to an internal address, and
  // anything else (file:, gopher:) has no business here at all.
  if (url.protocol !== 'https:') return false;
  return ALLOWED_PUSH_HOSTS.some((pattern) => pattern.test(url.hostname));
}

/**
 * A stored subscription is either a real PushSubscription (web) or an opaque
 * device token (a future native build via FCM/APNs). Only the first can be
 * delivered to from here; the rest are skipped rather than failed.
 *
 * The endpoint is re-checked here as well as at registration, deliberately:
 * this is the last gate before an outbound request, and it also covers any
 * row written before the check existed.
 */
function toSubscription(entry) {
  if (entry.platform !== 'web') return null;
  try {
    const parsed = JSON.parse(entry.token);
    if (!parsed?.endpoint || !parsed?.keys?.p256dh || !parsed?.keys?.auth) return null;
    if (!isAllowedPushEndpoint(parsed.endpoint)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Sends one notification to every device a user has registered.
 *
 * Fire-and-forget from the caller's perspective: a push that fails must never
 * take down the booking that triggered it. Dead subscriptions are pruned as
 * they are discovered, which is the only reliable way to know — a browser
 * that has revoked permission answers 404 or 410 and never tells you
 * otherwise.
 */
export async function sendToUser(userId, payload) {
  if (!configure()) return { sent: 0, skipped: true };

  const user = await User.findById(userId).select('pushTokens').lean();
  const entries = user?.pushTokens || [];
  if (!entries.length) return { sent: 0 };

  const body = JSON.stringify({
    title: payload.title || 'GameOn',
    body: payload.body || '',
    link: payload.link || '/',
    tag: payload.tag || 'gameon',
  });

  let sent = 0;
  const stale = [];

  await Promise.all(entries.map(async (entry) => {
    const subscription = toSubscription(entry);
    if (!subscription) return;

    try {
      await webpush.sendNotification(subscription, body, { TTL: 12 * 3600 });
      sent += 1;
    } catch (err) {
      // 404/410 mean the subscription is permanently gone — the user cleared
      // site data, revoked permission, or the browser rotated it. Anything
      // else (a 500 from the push service, a timeout) is transient and the
      // subscription is kept.
      if (err.statusCode === 404 || err.statusCode === 410) {
        stale.push(entry.token);
      } else {
        logger.warn('push delivery failed', { userId: String(userId), status: err.statusCode });
      }
    }
  }));

  if (stale.length) {
    await User.updateOne(
      { _id: userId },
      { $pull: { pushTokens: { token: { $in: stale } } } },
    ).catch(() => { /* pruning is housekeeping; never fail the caller for it */ });
    logger.debug('pruned dead push subscriptions', { userId: String(userId), count: stale.length });
  }

  return { sent, pruned: stale.length };
}

/** Same notification to several people. Used by the TeamUp fan-outs. */
export async function sendToMany(userIds, payload) {
  if (!configure()) return { sent: 0, skipped: true };
  const ids = [...new Set((userIds || []).map(String))].filter(Boolean);
  const results = await Promise.all(ids.map((id) => sendToUser(id, payload).catch(() => ({ sent: 0 }))));
  return { sent: results.reduce((n, r) => n + (r.sent || 0), 0) };
}
