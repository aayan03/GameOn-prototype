import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    venue: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 1000, default: '' },
    aspects: {
      surface: { type: Number, min: 1, max: 5, default: null },
      cleanliness: { type: Number, min: 1, max: 5, default: null },
      staff: { type: Number, min: 1, max: 5, default: null },
      value: { type: Number, min: 1, max: 5, default: null },
    },
    ownerReply: { text: { type: String, default: '' }, repliedAt: { type: Date, default: null } },
    isVisible: { type: Boolean, default: true },
    // Loyalty points this review earned. Deleting the review hands them back,
    // so delete-and-post-again cannot be run in a loop to farm points.
    pointsAwarded: { type: Number, default: 0 },
  },
  { timestamps: true }
);

reviewSchema.index({ user: 1, venue: 1 }, { unique: true });

export default mongoose.model('Review', reviewSchema);
