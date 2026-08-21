import mongoose from 'mongoose';

/** Wallet ledger. Every credit/debit is a row — balances are auditable. */
const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['topup', 'booking_payment', 'refund', 'cashback', 'payout', 'adjustment'],
      required: true,
    },
    direction: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    reference: { type: String, default: '' },
    description: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'success' },
  },
  { timestamps: true }
);

export default mongoose.model('Transaction', transactionSchema);
