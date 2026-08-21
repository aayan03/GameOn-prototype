import mongoose from 'mongoose';

/**
 * Owner-managed promo codes. Phase 2 shipped a hardcoded table in the booking
 * service; this replaces it with real records so venue owners can run their
 * own offers. The hardcoded platform codes still work as a fallback.
 */
const promoSchema = new mongoose.Schema(
  {
    code: {
      type: String, required: true, uppercase: true, trim: true,
      minlength: 4, maxlength: 20, index: true,
    },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Empty = applies to every venue this owner runs.
    venues: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Venue' }],

    type: { type: String, enum: ['flat', 'percent'], required: true },
    value: { type: Number, required: true, min: 1 },
    maxDiscount: { type: Number, default: null },   // caps a percent offer
    minAmount: { type: Number, default: 0 },

    maxUsesPerUser: { type: Number, default: 1, min: 1 },
    totalUseLimit: { type: Number, default: null },  // null = unlimited
    usedCount: { type: Number, default: 0 },

    validFrom: { type: Date, default: Date.now },
    validTo: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },

    description: { type: String, maxlength: 200, default: '' },
  },
  { timestamps: true }
);

// One code per owner. Two owners may both run "SUMMER20" without clashing.
promoSchema.index({ code: 1, owner: 1 }, { unique: true });

promoSchema.methods.isLive = function isLive() {
  const now = new Date();
  if (!this.isActive) return false;
  if (this.validFrom && this.validFrom > now) return false;
  if (this.validTo && this.validTo < now) return false;
  if (this.totalUseLimit !== null && this.usedCount >= this.totalUseLimit) return false;
  return true;
};

export default mongoose.model('Promo', promoSchema);
