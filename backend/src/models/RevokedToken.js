import mongoose from 'mongoose';

/**
 * Refresh tokens that have been signed out.
 *
 * A JWT is valid until it expires — that is the whole point of it, and it is
 * also the problem. Logging out cleared the token from the browser and told
 * the server nothing, so a refresh token copied off a shared laptop, or
 * lifted by an XSS, kept working for its full thirty days no matter how many
 * times the real user pressed Log out.
 *
 * `tokenVersion` on the User already retires EVERY token at once, which is
 * right for a password change and much too blunt for an ordinary logout —
 * signing out of a library computer should not sign you out of your phone.
 * So one session is revoked by its own id here instead.
 *
 * Only the `jti` is stored, never the token: this collection is a list of
 * things that no longer work, so a leak of it grants nothing.
 */
const revokedTokenSchema = new mongoose.Schema(
  {
    jti: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /**
     * When the token would have expired anyway.
     *
     * MongoDB drops the row at that moment, so this collection stays the size
     * of "sessions signed out in the last 30 days" rather than growing for
     * ever. Checking a denylist is only cheap while the denylist is small.
     */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

revokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('RevokedToken', revokedTokenSchema);
