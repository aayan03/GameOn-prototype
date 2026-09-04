import mongoose from 'mongoose';
import { SPORT_KEYS, SKILL_LEVELS } from '../config/constants.js';

/**
 * TeamUp — the social layer. A player or a short-handed team posts an open
 * game; others request to join. Two shapes:
 *   'need_players'  → we have a slot, we're short N people
 *   'need_opponent' → we have a full team, we need another team to play
 *   'looking_to_join' → solo player advertising availability
 */
const joinRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, maxlength: 300, default: '' },
    spots: { type: Number, default: 1, min: 1 },   // solo player, or a mini-team of N
    status: { type: String, enum: ['pending', 'accepted', 'declined', 'withdrawn'], default: 'pending' },
    // The per-person cost shown to this player when they were accepted.
    // Settlement charges this, not the host's current figure, so the cost
    // cannot be raised after people have agreed to it.
    agreedShare: { type: Number, default: 0, min: 0 },
    // True once the host has accepted this request, and it stays true after
    // a withdrawal. `status` alone cannot tell "accepted, then bailed the
    // night before" apart from "asked, was never answered, changed my mind" —
    // and only the first of those should cost anyone reliability.
    wasAccepted: { type: Boolean, default: false },
    // What was ACTUALLY taken from this player's wallet at settlement, so it
    // can be given back if the game is then cancelled. `agreedShare` is what
    // they signed up to pay; this is what left their balance. Without it a
    // host could settle, pocket everyone's share, cancel the game, and the
    // platform had no record of what it owed back to whom.
    settledAmount: { type: Number, default: 0, min: 0 },
    settledAt: { type: Date, default: null },
    requestedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null },
  },
  { _id: true }
);

const teamUpPostSchema = new mongoose.Schema(
  {
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['need_players', 'need_opponent', 'looking_to_join'],
      default: 'need_players',
      index: true,
    },
    sport: { type: String, enum: SPORT_KEYS, required: true, index: true },
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, maxlength: 1000, default: '' },

    // Either linked to a real booking, or just a proposed time+area.
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    venue: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', default: null },
    proposedArea: { type: String, default: '' },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [77.5946, 12.9716] },
    },

    playAt: { type: Date, required: true, index: true },
    durationMins: { type: Number, default: 60 },

    spotsNeeded: { type: Number, required: true, min: 1 },
    spotsFilled: { type: Number, default: 0, min: 0 },
    skillLevel: { type: String, enum: [...SKILL_LEVELS, 'any'], default: 'any' },
    genderPreference: { type: String, enum: ['any', 'male', 'female', 'mixed'], default: 'any' },
    ageRange: { min: { type: Number, default: 12 }, max: { type: Number, default: 60 } },

    // How the slot cost is shared out between everyone who joins.
    costSharing: {
      enabled: { type: Boolean, default: true },
      perPersonAmount: { type: Number, default: 0 },
      totalAmount: { type: Number, default: 0 },
    },

    // Set once the host has collected everyone's share, so settling twice
    // is impossible.
    costSettledAt: { type: Date, default: null },

    // Ensures the host loyalty bonus is granted at most once per post.
    hostBonusAwarded: { type: Boolean, default: false },
    // Reliability is settled once per game, after it has been played.
    reliabilitySettled: { type: Boolean, default: false },

    joinRequests: [joinRequestSchema],
    confirmedPlayers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    autoApprove: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['open', 'filled', 'cancelled', 'completed', 'expired'],
      default: 'open',
      index: true,
    },
    chatEnabled: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

teamUpPostSchema.index({ location: '2dsphere' });
teamUpPostSchema.index({ sport: 1, playAt: 1, status: 1 });
// The feed sweeps `status: 'open', playAt: < now` on every page load, and the
// lifecycle job scans the same two fields to settle reliability.
teamUpPostSchema.index({ status: 1, playAt: 1 });
// "Games I asked to join" — an array field, so it needs its own index.
teamUpPostSchema.index({ 'joinRequests.user': 1 });

teamUpPostSchema.virtual('spotsRemaining').get(function spotsRemaining() {
  return Math.max(0, this.spotsNeeded - this.spotsFilled);
});

export default mongoose.model('TeamUpPost', teamUpPostSchema);
