export const SPORT_ICONS = {
  football: '⚽', cricket: '🏏', badminton: '🏸', basketball: '🏀',
  tennis: '🎾', volleyball: '🏐', pickleball: '🥒', tabletennis: '🏓',
};

export const SPORT_LABELS = {
  football: 'Football', cricket: 'Cricket', badminton: 'Badminton',
  basketball: 'Basketball', tennis: 'Tennis', volleyball: 'Volleyball',
  pickleball: 'Pickleball', tabletennis: 'Table Tennis',
};

export const AMENITY_LABELS = {
  parking: 'Parking', floodlights: 'Floodlights', washroom: 'Washroom',
  changing_room: 'Changing room', drinking_water: 'Drinking water',
  first_aid: 'First aid', seating: 'Seating', cafeteria: 'Cafeteria',
  equipment_rental: 'Equipment rental', cctv: 'CCTV', shower: 'Shower', wifi: 'Wi-Fi',
};

export const AMENITY_ICONS = {
  parking: '🅿️', floodlights: '💡', washroom: '🚻', changing_room: '🚪',
  drinking_water: '🚰', first_aid: '🩹', seating: '💺', cafeteria: '☕',
  equipment_rental: '🎒', cctv: '📹', shower: '🚿', wifi: '📶',
};

export const rupees = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const distanceLabel = (km) => {
  if (km === null || km === undefined) return '';
  return km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`;
};

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export const ratingLabel = (r) => {
  if (r >= 4.5) return 'Excellent';
  if (r >= 4) return 'Very good';
  if (r >= 3.5) return 'Good';
  if (r > 0) return 'Fair';
  return 'New';
};

/**
 * Event types, mirroring EVENT_TYPES in the backend's config/constants.js.
 *
 * Duplicated rather than fetched: these label a filter row that renders before
 * the first API call returns, and a filter bar that pops in half a second late
 * is worse than one that is occasionally a release behind. /api/config serves
 * the same list if you ever need it dynamic.
 */
export const EVENT_TYPE_ICONS = {
  marathon: '🏃', tournament: '🏆', party: '🌅', meetup: '🤝',
  workshop: '🎯', league: '📅', fitness: '💪', other: '✨',
};

export const EVENT_TYPE_LABELS = {
  marathon: 'Marathon & runs', tournament: 'Tournament', party: 'Morning party',
  meetup: 'Meetup', workshop: 'Coaching & clinic', league: 'League',
  fitness: 'Fitness session', other: 'Other',
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS);

/** "Sat 12 Oct, 6:30 AM" — one line, no year unless it is not this one. */
export function eventWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric', minute: '2-digit',
  });
}
