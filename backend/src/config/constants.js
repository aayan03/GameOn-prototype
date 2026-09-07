// Single source of truth shared by models, validators and the frontend.

export const SPORTS = [
  { key: 'football',   label: 'Football',   icon: '⚽' },
  { key: 'cricket',    label: 'Cricket',    icon: '🏏' },
  { key: 'badminton',  label: 'Badminton',  icon: '🏸' },
  { key: 'basketball', label: 'Basketball', icon: '🏀' },
  { key: 'tennis',     label: 'Tennis',     icon: '🎾' },
  { key: 'volleyball', label: 'Volleyball', icon: '🏐' },
  { key: 'pickleball', label: 'Pickleball', icon: '🥒' },
  { key: 'tabletennis',label: 'Table Tennis', icon: '🏓' },
];

export const SPORT_KEYS = SPORTS.map((s) => s.key);

export const AMENITIES = [
  'parking', 'floodlights', 'washroom', 'changing_room', 'drinking_water',
  'first_aid', 'seating', 'cafeteria', 'equipment_rental', 'cctv', 'shower', 'wifi',
];

export const ROLES = { PLAYER: 'player', OWNER: 'owner', ADMIN: 'admin' };

// Slide 4 of the deck: GameOn's edge is supporting BOTH venue types.
export const BOOKING_MODES = { AUTOMATED: 'automated', MANUAL: 'manual' };

export const BOOKING_STATUS = {
  PENDING: 'pending',       // manual venue — awaiting owner/ops confirmation
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
};

/**
 * Sports events — the things that happen AT venues rather than bookings OF
 * them.
 *
 * Deliberately a separate concept from a Booking. A marathon has a start line,
 * not a court; a morning party has a playlist and a sunrise. They share a city
 * and a date with a slot booking and almost nothing else, so modelling them as
 * an unusual kind of booking would have meant `court`, `startMinutes` and the
 * whole double-booking index carrying nulls for half the collection.
 */
export const EVENT_TYPES = [
  { key: 'marathon',   label: 'Marathon & runs',   icon: '🏃' },
  { key: 'tournament', label: 'Tournament',        icon: '🏆' },
  { key: 'party',      label: 'Morning party',     icon: '🌅' },
  { key: 'meetup',     label: 'Meetup',            icon: '🤝' },
  { key: 'workshop',   label: 'Coaching & clinic', icon: '🎯' },
  { key: 'league',     label: 'League',            icon: '📅' },
  { key: 'fitness',    label: 'Fitness session',   icon: '💪' },
  { key: 'other',      label: 'Other',             icon: '✨' },
];

export const EVENT_TYPE_KEYS = EVENT_TYPES.map((e) => e.key);

export const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced', 'pro'];

/**
 * Loyalty programme.
 *
 * Two counters are kept per user:
 *   loyaltyPoints  — the spendable balance, goes down when redeemed
 *   lifetimePoints — only ever increases, and is what sets the tier
 *
 * Keeping them separate means redeeming points never demotes anyone, which
 * is the behaviour people expect and the opposite of what a single counter does.
 */
export const LOYALTY = {
  // 5 points per ₹100 spent, before any tier multiplier.
  POINTS_PER_100: 5,
  // 10 points = ₹1 when redeemed.
  POINTS_PER_RUPEE: 10,
  MIN_REDEEM_POINTS: 200,
  // Points for actions other than spending.
  SIGNUP_BONUS: 100,
  REVIEW_BONUS: 20,
  TEAMUP_HOST_BONUS: 15,
};

export const LOYALTY_TIERS = [
  {
    key: 'rookie', label: 'Rookie', icon: '🥉', color: '#8B85A0',
    minLifetimePoints: 0,
    earnMultiplier: 1,
    feeDiscountPercent: 0,
    advanceBookingBonusDays: 0,
    perks: ['Earn 5 points per ₹100 spent', 'Free cancellation as per venue policy'],
  },
  {
    key: 'pro', label: 'Pro', icon: '🥈', color: '#3DC9FF',
    minLifetimePoints: 500,
    earnMultiplier: 1.25,
    feeDiscountPercent: 25,
    advanceBookingBonusDays: 3,
    perks: ['25% off the platform fee', '1.25× points on every booking', 'Book 3 days further ahead'],
  },
  {
    key: 'elite', label: 'Elite', icon: '🥇', color: '#FF9C3D',
    minLifetimePoints: 2000,
    earnMultiplier: 1.5,
    feeDiscountPercent: 50,
    advanceBookingBonusDays: 7,
    perks: ['50% off the platform fee', '1.5× points on every booking', 'Book 7 days further ahead', 'Priority on assisted bookings'],
  },
  {
    key: 'legend', label: 'Legend', icon: '👑', color: '#D6FF3F',
    minLifetimePoints: 5000,
    earnMultiplier: 2,
    feeDiscountPercent: 100,
    advanceBookingBonusDays: 14,
    perks: ['No platform fee, ever', '2× points on every booking', 'Book 14 days further ahead', 'Priority on assisted bookings', 'Early access to new venues'],
  },
];

export const TIER_KEYS = LOYALTY_TIERS.map((t) => t.key);
