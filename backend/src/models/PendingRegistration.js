import mongoose from 'mongoose';

/**
 * A signup that has been started but not yet proved.
 *
 * The account does NOT exist until someone with access to the inbox clicks
 * the link. That ordering is the whole point, and it is what makes
 * registration stop being an account-existence oracle.
 *
 * The obvious design — create the user, mark them unverified, email a link —
 * does not close the leak. Registration would still have to answer
 * differently for an address that is taken, and even if it did not, the
 * attacker chose the password: they register with victim@example.com, then
 * try to log in with the password they just picked. It works if the account
 * was created (the address was free) and fails if it was not (the address was
 * taken). Same oracle, one step further along.
 *
 * Holding the signup here instead means the answer is identical in both
 * cases, and stays identical however hard the attacker pokes at it: no
 * account is created either way, so no password they chose ever works.
 *
 * The password arrives already hashed — a pending row is not a place to keep
 * a plaintext credential, and it means the User can be created with the hash
 * intact rather than re-hashing on the way out.
 */
const pendingRegistrationSchema = new mongoose.Schema(
  {
    // One pending signup per address. A second attempt replaces the first,
    // which is also what invalidates a link someone mistyped their way into.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Already bcrypt-hashed by the controller. Never plaintext, not even here.
    passwordHash: { type: String, required: true },
    phone: { type: String, trim: true, default: '' },
    role: { type: String, enum: ['player', 'owner'], default: 'player' },
    city: { type: String, trim: true, default: '' },
    favoriteSports: [{ type: String }],

    /**
     * Only the SHA-256 of the token, never the token itself — same reasoning
     * as User.resetTokenHash. A database dump would otherwise be a list of
     * working "create this account" links.
     */
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },

    // Throttles resends per address, independent of the per-IP limiter, so a
    // botnet cannot use this to flood one person's inbox.
    lastSentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// MongoDB drops the row the moment it expires, so an abandoned signup does
// not sit around holding an email address hostage.
pendingRegistrationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('PendingRegistration', pendingRegistrationSchema);
