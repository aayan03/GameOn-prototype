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

    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },

    // Brute-force protection. Rate limiting is per-IP; this is per-account,
    // so a distributed attempt against one inbox still gets stopped.
    failedLogins: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },

    // Bumping this invalidates every token issued before the change, which is
    // what makes "log out everywhere" and post-compromise recovery possible.
    tokenVersion: { type: Number, default: 0 },

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
