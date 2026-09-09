import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES, SPORT_KEYS, SKILL_LEVELS, TIER_KEYS } from '../config/constants.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: {
      type: String, required: true, unique: true, lowercase: true, trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    phone: { type: String, trim: true, match: [/^[0-9]{10}$/, 'Phone must be 10 digits'] },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.PLAYER, index: true },
    avatar: { type: String, default: '' },
    city: { type: String, trim: true, default: '' },

    // Player profile — powers the TeamUp matching engine (Phase 3)
    favoriteSports: [{ type: String, enum: SPORT_KEYS }],
    skillLevel: { type: String, enum: SKILL_LEVELS, default: 'beginner' },
    position: { type: String, default: '' }, // e.g. "Goalkeeper", "Opening batter"
    bio: { type: String, maxlength: 300, default: '' },

    // Last known location — used for "turfs near me" without re-prompting GPS
    lastLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [77.5946, 12.9716] }, // [lng, lat]
    },

    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Venue' }],

    // Wallet & loyalty (deck slides 7 & 8)
    walletBalance: { type: Number, default: 0, min: 0 },

    // Rolling 24h top-up window, enforced atomically. A read-then-write cap
    // is not a cap — parallel requests all read the same total and all pass.
    topupWindow: {
      total: { type: Number, default: 0 },
      resetAt: { type: Date, default: null },
    },

    // Spendable balance — decreases when points are redeemed.
    loyaltyPoints: { type: Number, default: 0, min: 0 },
    // Only ever increases. This is what determines the tier, so redeeming
    // points can never demote someone.
    lifetimePoints: { type: Number, default: 0, min: 0, index: true },
    // Venues whose first-review bonus this account has already collected.
    // Kept even after the review is deleted, because the alternative — award
    // on create, hand back on delete — is a faucet the moment the points have
    // already been redeemed for wallet credit: revoke can only claw back what
    // is still unspent, so post/redeem/delete/repost paid out every cycle.
    reviewBonusVenues: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Venue' }],
    loyaltyTier: { type: String, enum: TIER_KEYS, default: 'rookie', index: true },
    tierAchievedAt: { type: Date, default: Date.now },

    // TeamUp reputation
    reliabilityScore: { type: Number, default: 100, min: 0, max: 100 },
    gamesPlayed: { type: Number, default: 0 },

    /**
     * Set by an ADMIN, and nothing to do with email.
     *
     * This is "we have vetted this owner", and it is what lets their venues
     * publish without moderation (see venue.controller.js#createVenue).
     * Deliberately NOT reused for email verification: every account that
     * confirmed an inbox would then auto-publish venues nobody had reviewed.
     */
    isVerified: { type: Boolean, default: false },

    /**
     * When this person proved they can read the address they signed up with.
     *
     * Null on accounts created before email verification existed. They are
     * treated as verified — an account somebody has been using for months is
     * not suddenly untrustworthy because a feature shipped — so nothing
     * enforces on this field. It exists because every account created from
     * now on genuinely has it, which makes it worth showing to an admin.
     */
    emailVerifiedAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },

    // Brute-force protection. Rate limiting is per-IP; this is per-account,
    // so a distributed attempt against one inbox still gets stopped.
    failedLogins: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },

    // Bumping this invalidates every token issued before the change, which is
    // what makes "log out everywhere" and post-compromise recovery possible.
    tokenVersion: { type: Number, default: 0 },

    /**
     * Password reset.
     *
     * Only the SHA-256 of the token is stored, never the token itself. A
     * database dump — or a stray log line, or a backup on someone's laptop —
     * would otherwise be a list of working "log in as this person" links for
     * every account with a reset in flight.
     *
     * `select: false` so the hash cannot leak through a routine user query.
     */
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpires: { type: Date, default: null, select: false },
    // Throttles reset requests per account, independent of the per-IP limiter,
    // so one inbox cannot be flooded from a botnet.
    resetRequestedAt: { type: Date, default: null, select: false },

    /**
     * When this address was last told "you already have an account".
     *
     * /auth/register answers identically whether or not the address is taken,
     * and tells the INBOX rather than the caller — which means anyone can
     * make us send mail to an address they do not own. `resendVerification`
     * and `forgotPassword` both throttle that per address; register wrote a
     * timestamp and never read one, so it was the flood that got through.
     */
    signupNoticeAt: { type: Date, default: null, select: false },

    // Devices registered for push. Capped at five most-recent by the
    // notification service so an old phone cannot accumulate tokens forever.
    pushTokens: [{
      token: { type: String, required: true },
      platform: { type: String, enum: ['web', 'android', 'ios'], default: 'web' },
      registeredAt: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.index({ lastLocation: '2dsphere' });
// Reset lookups are by token hash. Sparse, because almost every user has none.
userSchema.index({ resetTokenHash: 1 }, { sparse: true });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toPublic = function toPublic() {
  const o = this.toObject();
  delete o.password;
  delete o.__v;
  delete o.failedLogins;
  delete o.lockedUntil;
  delete o.pushTokens;      // device tokens are never sent to a client
  delete o.resetTokenHash;  // never leaves the server, under any circumstance
  delete o.resetTokenExpires;
  delete o.resetRequestedAt;
  delete o.signupNoticeAt;
  return o;
};

/** The minimum another player is allowed to see — used across TeamUp. */
userSchema.methods.toCard = function toCard() {
  return {
    _id: this._id,
    name: this.name,
    avatar: this.avatar,
    city: this.city,
    skillLevel: this.skillLevel,
    position: this.position,
    favoriteSports: this.favoriteSports,
    gamesPlayed: this.gamesPlayed,
    reliabilityScore: this.reliabilityScore,
    loyaltyTier: this.loyaltyTier,
  };
};

userSchema.virtual('isLocked').get(function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
});

export default mongoose.model('User', userSchema);
