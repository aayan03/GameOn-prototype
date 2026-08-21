import { Notification, User } from '../models/index.js';

/**
 * Notifications.
 *
 * Every call is fire-and-forget: a notification failing must never take down
 * the booking that triggered it. Callers do not await the result for
 * correctness, only for ordering in tests.
 */

const TEMPLATES = {
  booking_confirmed:  { icon: '✅', title: 'Booking confirmed' },
  booking_rejected:   { icon: '❌', title: 'Booking declined' },
  booking_cancelled:  { icon: '🚫', title: 'Booking cancelled' },
  booking_reminder:   { icon: '⏰', title: 'Game coming up' },
  booking_requested:  { icon: '📨', title: 'Request sent' },
  booking_completed:  { icon: '🏁', title: 'Hope the game went well' },
  payment_received:   { icon: '💳', title: 'Payment received' },
  refund_processed:   { icon: '💰', title: 'Refund processed' },
  teamup_request:     { icon: '🙋', title: 'Someone wants to join' },
  teamup_accepted:    { icon: '🤝', title: "You're in" },
  teamup_declined:    { icon: '🙁', title: 'Request declined' },
  teamup_filled:      { icon: '🎉', title: 'Your game is full' },
  team_invite:        { icon: '👥', title: 'Team invite' },
  venue_approved:     { icon: '🏟️', title: 'Venue approved' },
  venue_rejected:     { icon: '📋', title: 'Venue needs changes' },
  payout_ready:       { icon: '💸', title: 'Payout ready' },
  tier_upgraded:      { icon: '🏆', title: 'Tier unlocked' },
  review_request:     { icon: '⭐', title: 'How was it?' },
};

/**
 * Creates one notification. Swallows its own errors on purpose — see above.
 */
export async function notify(userId, type, { title, body, link = '', icon } = {}) {
  if (!userId || !type) return null;
  const t = TEMPLATES[type] || {};
  try {
    return await Notification.create({
      user: userId,
      type,
      title: (title || t.title || 'GameOn').slice(0, 120),
      body: String(body || '').slice(0, 400),
      link: String(link).slice(0, 200),
      icon: icon || t.icon || '🔔',
    });
  } catch (err) {
    console.error('[notify] failed', type, err.message);
    return null;
  }
}

/** Same notification to several people, in one write. */
export async function notifyMany(userIds, type, payload = {}) {
  const ids = [...new Set((userIds || []).map(String))].filter(Boolean);
  if (!ids.length) return [];
  const t = TEMPLATES[type] || {};
  try {
    return await Notification.insertMany(
      ids.map((user) => ({
        user,
        type,
        title: (payload.title || t.title || 'GameOn').slice(0, 120),
        body: String(payload.body || '').slice(0, 400),
        link: String(payload.link || '').slice(0, 200),
        icon: payload.icon || t.icon || '🔔',
      })),
      { ordered: false }
    );
  } catch (err) {
    console.error('[notifyMany] failed', type, err.message);
    return [];
  }
}

export function unreadCount(userId) {
  return Notification.countDocuments({ user: userId, readAt: null });
}

export async function markRead(userId, ids) {
  const filter = { user: userId, readAt: null };
  if (ids?.length) filter._id = { $in: ids };
  const res = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return res.modifiedCount;
}

/**
 * Devices registered for push. Kept on the user so a logout can drop them,
 * and so a token that stops working can be pruned without another collection.
 */
export async function registerPushToken(user, token, platform = 'web') {
  if (!token || typeof token !== 'string' || token.length > 512) return false;

  // A single conditional push, with no destructive pull in front of it. The
  // old pull-then-push left the device unregistered for the length of a round
  // trip, and lost the token permanently if the process died in between — the
  // client registers only once per session and would never retry.
  const added = await User.updateOne(
    { _id: user._id, 'pushTokens.token': { $ne: token } },
    {
      $push: {
        pushTokens: {
          $each: [{ token, platform, registeredAt: new Date() }],
          // Keep only the five most recent devices, so an old phone that is
          // never logged out cannot accumulate forever.
          $slice: -5,
        },
      },
    }
  );

  // Already registered — refresh when it was last seen rather than re-adding.
  if (!added.modifiedCount) {
    await User.updateOne(
      { _id: user._id, 'pushTokens.token': token },
      { $set: { 'pushTokens.$.registeredAt': new Date(), 'pushTokens.$.platform': platform } }
    );
  }

  return true;
}

export async function removePushToken(user, token) {
  await User.updateOne({ _id: user._id }, { $pull: { pushTokens: { token } } });
  return true;
}
