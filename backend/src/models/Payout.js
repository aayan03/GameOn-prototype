import mongoose from 'mongoose';

/**
 * A settlement run for one venue owner over one period.
 * Gross is what players paid; commission is the platform's cut; net is owed.
 */
const payoutSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    bookingCount: { type: Number, default: 0 },
    grossAmount: { type: Number, default: 0 },
    commissionPercent: { type: Number, default: 10 },
    commissionAmount: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed'],
      default: 'pending',
      index: true,
    },
    reference: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    notes: { type: String, maxlength: 300, default: '' },
  },
  { timestamps: true }
);

// One payout per owner per period — reruns update rather than duplicate.
payoutSchema.index({ owner: 1, periodStart: 1, periodEnd: 1 }, { unique: true });

export default mongoose.model('Payout', payoutSchema);
