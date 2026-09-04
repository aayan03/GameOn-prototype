import mongoose from 'mongoose';

/**
 * How many times one account has redeemed one promo code.
 *
 * The per-user cap used to be enforced by counting bookings: read how many
 * groups already carried the code, compare against `maxUses`, then write the
 * booking. Two requests firing together both read the same count, both pass,
 * and both get the discount — the classic check-then-act race, on a field
 * whose entire job is to be a limit.
 *
 * Making the count its own document turns the check into a conditional
 * update, so the database arbitrates and the second request simply matches
 * nothing. Exactly the pattern the owner promo's global `totalUseLimit`
 * already used; this is the per-user half that was missed.
 *
 * `promoOwner` is part of the identity because codes are unique per owner:
 * two venue owners may both run "SUMMER20", and one must not exhaust the
 * other. Null means a platform code.
 */
const promoRedemptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    promoOwner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// One row per (user, code, owner). The unique index is what makes the upsert
// below safe under concurrency: two parallel first-uses cannot both insert.
promoRedemptionSchema.index({ user: 1, code: 1, promoOwner: 1 }, { unique: true });

export default mongoose.model('PromoRedemption', promoRedemptionSchema);
