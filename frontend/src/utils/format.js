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

/** Free public grounds — a shorter list than AMENITIES; a park has no café. */
export const PLAYGROUND_FACILITY_LABELS = {
  lit: 'Floodlit',
  fenced: 'Fenced',
  washroom: 'Washroom',
  drinking_water: 'Drinking water',
  seating: 'Seating',
  parking: 'Parking',
  marked_pitch: 'Marked pitch',
  nets: 'Nets',
  hoops: 'Hoops',
  shade: 'Shade',
};
export const PLAYGROUND_FACILITIES = Object.keys(PLAYGROUND_FACILITY_LABELS);

export const SURFACE_LABELS = {
  grass: 'Grass', mud: 'Mud', concrete: 'Concrete', asphalt: 'Asphalt',
  sand: 'Sand', synthetic: 'Synthetic', mixed: 'Mixed', other: 'Other',
};

/** "06:00" -> "6:00 AM". Grounds are posted in 24h; people read 12h. */
export function clockLabel(hhmm = '') {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m ?? 0).padStart(2, '0')} ${suffix}`;
}

/** "Open all hours", "6:00 AM – 8:00 PM", or nothing useful to say. */
export function accessLabel(access = {}) {
  if (access.alwaysOpen) return 'Open all hours';
  if (access.opensAt && access.closesAt) return `${clockLabel(access.opensAt)} – ${clockLabel(access.closesAt)}`;
  return 'Hours not known';
}

/**
 * A `srcset` for image hosts that resize from the URL.
 *
 * Venue photos are arbitrary URLs, so there is no general way to ask for a
 * smaller one — but the seed and most pasted links are Unsplash, which takes
 * a `w=` query parameter. Where that is present we can offer the browser a
 * range and let it pick; where it is not, we return null and the plain `src`
 * stands. Measured before this: cards rendering at 289px were downloading
 * `w=1200`, about 56KB each for roughly four times the pixels needed.
 *
 * Deliberately narrow. Rewriting arbitrary third-party URLs on a guess is how
 * you end up with broken images on somebody else's CDN.
 */
const RESIZABLE = /^https:\/\/images\.unsplash\.com\//;

export function srcSetFor(url, widths = [400, 600, 900, 1200]) {
  if (!url || !RESIZABLE.test(url)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!u.searchParams.has('w')) return null;

  return widths
    .map((w) => {
      const next = new URL(u);
      next.searchParams.set('w', String(w));
      return `${next.toString()} ${w}w`;
    })
    .join(', ');
}
