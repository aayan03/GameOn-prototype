import mongoose from 'mongoose';

/**
 * In-app notification. Also the payload a push message is built from, so the
 * two channels never drift apart.
 */
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: [
        'booking_confirmed', 'booking_rejected', 'booking_cancelled', 'booking_requested',
        'booking_reminder', 'booking_completed',
        'payment_received', 'refund_processed',
        'teamup_request', 'teamup_accepted', 'teamup_declined', 'teamup_filled',
        'team_invite',
        'venue_approved', 'venue_rejected',
        'playground_approved', 'playground_rejected', 'playground_submitted',
        'payout_ready', 'tier_upgraded', 'review_request',
      ],
      index: true,
    },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 400 },
    // Where tapping it should go, as an in-app path.
    link: { type: String, default: '', maxlength: 200 },
    icon: { type: String, default: '🔔', maxlength: 8 },

    readAt: { type: Date, default: null },
    // Set once a push has actually been delivered, so a retry cannot double-send.
    pushedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The feed query: this user's notifications, newest first.
notificationSchema.index({ user: 1, createdAt: -1 });
// Notifications are ephemeral — MongoDB drops them after 60 days on its own.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 86400 });

export default mongoose.model('Notification', notificationSchema);
