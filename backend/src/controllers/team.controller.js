import { z } from 'zod';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Team, User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { SPORT_KEYS, SKILL_LEVELS } from '../config/constants.js';
import { cleanText } from '../utils/sanitize.js';

const MEMBER_FIELDS = 'name avatar skillLevel position loyaltyTier reliabilityScore gamesPlayed';

export const createTeamSchema = z.object({
  name: z.string().trim().min(3, 'Team name must be at least 3 characters').max(60),
  sport: z.enum(SPORT_KEYS),
  city: z.string().trim().max(60).optional(),
  skillLevel: z.enum(SKILL_LEVELS).optional(),
  minPlayers: z.number().int().min(2).max(30).optional(),
  logo: z.string().max(500).optional(),
  isOpenToTeamUp: z.boolean().optional(),
}).strict();

export const updateTeamSchema = createTeamSchema.partial().strict();

/**
 * Both fields are optional, and that is deliberate.
 *
 * The captain's primary flow is "generate a code and paste it in the group
 * chat" — there is no address to send it to. Requiring one made the UI invent
 * a placeholder (`invite-1724...@placeholder.local`), which then bound the
 * code to an email nobody owns, and `joinByCode` rejected every single
 * redemption with "this invite was sent to a different email address". The
 * whole invite feature was unusable end to end.
 *
 * An address is now what it should always have been: an optional restriction
 * on who may redeem the code, not a precondition for making one.
 */
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(160).optional(),
  phone: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile number').optional(),
}).strict();

export const joinByCodeSchema = z.object({
  code: z.string().trim().min(6).max(12),
}).strict();

export const transferSchema = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Pick a valid player'),
}).strict();

/** A random, unguessable invite code — not a sequential or derivable one. */
function makeInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function isCaptain(team, userId) {
  return String(team.captain) === String(userId);
}

/** GET /api/teams/mine */
export const myTeams = asyncHandler(async (req, res) => {
  const teams = await Team.find({ 'members.user': req.user._id })
    .populate('captain', MEMBER_FIELDS)
    .populate('members.user', MEMBER_FIELDS)
    .sort({ createdAt: -1 })
    .lean();

  return ok(res, teams.map((t) => ({
    ...t,
    memberCount: t.members?.length || 0,
    isCaptain: String(t.captain?._id || t.captain) === String(req.user._id),
    isShort: (t.members?.length || 0) < (t.minPlayers || 5),
    // The invite code is only useful to the captain, so only they see it.
    invites: String(t.captain?._id || t.captain) === String(req.user._id) ? t.invites : undefined,
  })));
});

/** GET /api/teams/:id */
export const getTeam = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid team id');

  const team = await Team.findById(req.params.id)
    .populate('captain', MEMBER_FIELDS)
    .populate('members.user', MEMBER_FIELDS)
    .lean();
  if (!team) throw ApiError.notFound('Team not found');

  const isMember = team.members.some((m) => String(m.user?._id || m.user) === String(req.user._id));
  if (!isMember) throw ApiError.forbidden('This team is private to its members');

  return ok(res, {
    ...team,
    memberCount: team.members.length,
    isCaptain: isCaptain(team, req.user._id),
    isShort: team.members.length < (team.minPlayers || 5),
    invites: isCaptain(team, req.user._id) ? team.invites : undefined,
  });
});

/** POST /api/teams */
export const createTeam = asyncHandler(async (req, res) => {
  const owned = await Team.countDocuments({ captain: req.user._id });
  if (owned >= 10) throw ApiError.badRequest('You can captain at most 10 teams');

  const team = await Team.create({
    ...req.body,
    name: cleanText(req.body.name, 60),
    city: cleanText(req.body.city || req.user.city || '', 60),
    captain: req.user._id,
    members: [{ user: req.user._id, role: 'captain', position: req.user.position || '' }],
  });

  const populated = await Team.findById(team._id)
    .populate('captain', MEMBER_FIELDS)
    .populate('members.user', MEMBER_FIELDS)
    .lean();

  return created(res, { ...populated, memberCount: 1, isCaptain: true, isShort: true });
});

/** PATCH /api/teams/:id */
export const updateTeam = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team) throw ApiError.notFound('Team not found');
  if (!isCaptain(team, req.user._id)) throw ApiError.forbidden('Only the captain can edit the team');

  const { name, city, ...rest } = req.body;
  Object.assign(team, rest);
  if (name !== undefined) team.name = cleanText(name, 60);
  if (city !== undefined) team.city = cleanText(city, 60);
  await team.save();

  return ok(res, team);
});

/** DELETE /api/teams/:id */
export const deleteTeam = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team) throw ApiError.notFound('Team not found');
  if (!isCaptain(team, req.user._id)) throw ApiError.forbidden('Only the captain can delete the team');

  await team.deleteOne();
  return ok(res, { deleted: true });
});

/** POST /api/teams/:id/invite — generates a code, or invites a known user. */
export const invite = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team) throw ApiError.notFound('Team not found');
  if (!isCaptain(team, req.user._id)) throw ApiError.forbidden('Only the captain can invite players');
  if (team.members.length >= 30) throw ApiError.badRequest('This team is full');

  const { email, phone } = req.body;

  // Deliberately NOT reporting whether this email has an account, and never
  // echoing the account holder's name. Doing either turns this endpoint into
  // a user-enumeration oracle, which undoes the care taken in the login flow.
  const existingUser = email ? await User.findOne({ email }).select('_id') : null;

  if (existingUser && team.members.some((m) => String(m.user) === String(existingUser._id))) {
    throw ApiError.conflict('That player is already in the team');
  }

  // Only reuse a pending invite when it was addressed to the same person.
  // An open, unaddressed code is single-use by design, so handing the same
  // one back would mean the captain can never invite a second player.
  const pending = (email || phone) && team.invites.find(
    (i) => i.status === 'pending' && ((email && i.email === email) || (phone && i.phone === phone))
  );
  if (pending) return ok(res, { code: pending.code, message: 'An invite is already pending for them.' });

  // Cap the outstanding codes. Each one is a way into a private team, and an
  // unbounded array on a document is its own problem.
  const open = team.invites.filter((i) => i.status === 'pending').length;
  if (open >= 30) {
    throw ApiError.badRequest('You have 30 unused invite codes already. Have your players redeem those first.');
  }

  const code = makeInviteCode();
  team.invites.push({
    email: email || '', phone: phone || '',
    user: existingUser?._id || null, code, status: 'pending', invitedAt: new Date(),
  });
  await team.save();

  return created(res, {
    code,
    message: email || phone
      ? 'Invite created. Share this code with your player.'
      : 'Invite code created. Anyone with this code can join once.',
  });
});

/** POST /api/teams/join — redeem an invite code. */
export const joinByCode = asyncHandler(async (req, res) => {
  const code = req.body.code.toUpperCase();

  // $elemMatch binds both conditions to the SAME invite. Querying
  // 'invites.code' and 'invites.status' separately lets them match different
  // array entries, which returned a team whose matching code was already used
  // and then dereferenced undefined.
  const team = await Team.findOne({
    invites: { $elemMatch: { code, status: 'pending' } },
  });
  if (!team) throw ApiError.notFound('That invite code is not valid or has already been used');

  if (team.members.some((m) => String(m.user) === String(req.user._id))) {
    throw ApiError.conflict("You're already in this team");
  }
  if (team.members.length >= 30) throw ApiError.badRequest('This team is full');

  const inviteEntry = team.invites.find((i) => i.code === code && i.status === 'pending');
  if (!inviteEntry) throw ApiError.notFound('That invite code is not valid or has already been used');

  // An invite addressed to a specific email may only be redeemed by that email.
  if (inviteEntry.email && inviteEntry.email !== req.user.email) {
    throw ApiError.forbidden('This invite was sent to a different email address');
  }

  inviteEntry.status = 'accepted';
  inviteEntry.user = req.user._id;
  team.members.push({ user: req.user._id, role: 'player', position: req.user.position || '' });
  await team.save();

  return ok(res, { joined: true, teamId: team._id, teamName: team.name, message: `You joined ${team.name}.` });
});

/** DELETE /api/teams/:id/members/:userId — leave, or captain removes someone. */
export const removeMember = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team) throw ApiError.notFound('Team not found');

  const targetId = req.params.userId;
  const isSelf = String(targetId) === String(req.user._id);

  if (!isSelf && !isCaptain(team, req.user._id)) {
    throw ApiError.forbidden('Only the captain can remove other players');
  }
  if (isCaptain(team, targetId)) {
    throw ApiError.badRequest('The captain cannot be removed. Transfer captaincy or delete the team.');
  }

  const before = team.members.length;
  team.members = team.members.filter((m) => String(m.user) !== String(targetId));
  if (team.members.length === before) throw ApiError.notFound('That player is not in this team');

  await team.save();
  return ok(res, { removed: true, message: isSelf ? 'You left the team.' : 'Player removed.' });
});

/** PATCH /api/teams/:id/captain — hand over captaincy. */
export const transferCaptaincy = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team) throw ApiError.notFound('Team not found');
  if (!isCaptain(team, req.user._id)) throw ApiError.forbidden('Only the captain can transfer captaincy');

  const newCaptainId = req.body.userId;

  const member = team.members.find((m) => String(m.user) === String(newCaptainId));
  if (!member) throw ApiError.badRequest('That player is not in this team');

  team.members.forEach((m) => {
    if (m.role === 'captain') m.role = 'player';
  });
  member.role = 'captain';
  team.captain = newCaptainId;
  await team.save();

  return ok(res, { transferred: true, message: 'Captaincy transferred.' });
});
