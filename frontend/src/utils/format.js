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
