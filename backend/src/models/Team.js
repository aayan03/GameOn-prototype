import mongoose from 'mongoose';
import { SPORT_KEYS, SKILL_LEVELS } from '../config/constants.js';

/** A persistent squad. Teams post to TeamUp when they're short on players. */
const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, unique: true, index: true },
    logo: { type: String, default: '' },
    sport: { type: String, enum: SPORT_KEYS, required: true, index: true },
    captain: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    members: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: ['captain', 'vice_captain', 'player'], default: 'player' },
        position: { type: String, default: '' },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    invites: [
      {
        email: { type: String, default: '' },
        phone: { type: String, default: '' },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        code: { type: String, default: '' },
        status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
        invitedAt: { type: Date, default: Date.now },
      },
    ],
    city: { type: String, default: '' },
    skillLevel: { type: String, enum: SKILL_LEVELS, default: 'intermediate' },
    minPlayers: { type: Number, default: 5 },   // below this, TeamUp suggests posting
    isOpenToTeamUp: { type: Boolean, default: true },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    matchesPlayed: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

teamSchema.virtual('memberCount').get(function memberCount() {
  return this.members?.length || 0;
});

teamSchema.pre('validate', function generateSlug(next) {
  if (!this.slug && this.name) {
    this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') +
      '-' + Math.random().toString(36).slice(2, 6);
  }
  next();
});

// GET /api/teams/mine matches on the members array; POST /api/teams/join
// looks a code up across every team on the platform.
teamSchema.index({ 'members.user': 1 });
teamSchema.index({ 'invites.code': 1 });

export default mongoose.model('Team', teamSchema);
