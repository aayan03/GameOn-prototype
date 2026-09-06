// Realistic seed data across four Indian cities so discovery, filters,
// geo-search and the map all have something to show immediately.

/**
 * The demo-account password, resolved on demand.
 *
 * A FUNCTION, not a constant, and that distinction is the whole point. The
 * first version of this ran the check at module scope — so importing the file
 * threw, and `server.js` statically imports `seed/autoSeed.js`, which imports
 * this. The result was that a production API refused to BOOT rather than
 * refusing to SEED. The guard was right; where it fired was not.
 *
 * `owner123` and `player123` were literal strings in a public repository, on
 * accounts that can manage venues and hold wallet balance. Anyone who read the
 * repo could sign into any deployment that had ever been seeded — and the
 * seeder printed the credentials on success, so it read as intended rather
 * than as a hole.
 *
 * The dev default is kept, because a local database that needs a password
 * hunt to log into is a worse experience for no security benefit — nothing on
 * a throwaway in-memory Mongo is worth protecting. Anywhere else, set
 * SEED_PASSWORD to something of your own, and delete these accounts once the
 * real ones exist.
 */
export function demoPassword() {
  const value = process.env.SEED_PASSWORD
    || (process.env.NODE_ENV === 'production' ? null : 'player123');

  if (!value) {
    throw new Error(
      'Refusing to seed demo accounts in production without SEED_PASSWORD. '
      + 'These accounts can manage venues and hold balance, and their old default '
      + 'passwords are published in this repository. Set SEED_PASSWORD to a value '
      + 'of your own, or do not seed a production database.'
    );
  }
  return value;
}

/**
 * No `password` field on these. It is injected by whichever seeder runs, so
 * that resolving it — and failing on it — happens at seed time rather than at
 * import time.
 */
export const owners = [
  { name: 'Shivanshu Rathore', email: 'shivanshu@gameon.app', role: 'owner', phone: '9810011001', city: 'Bengaluru' },
  { name: 'Meera Iyer',        email: 'meera@gameon.app',     role: 'owner', phone: '9810011002', city: 'Mumbai' },
  { name: 'Rajat Khanna',      email: 'rajat@gameon.app',     role: 'owner', phone: '9810011003', city: 'Delhi' },
  { name: 'Farhan Qureshi',    email: 'farhan@gameon.app',    role: 'owner', phone: '9810011004', city: 'Pune' },
];

export const players = [
  // lifetimePoints is set so the demo shows every loyalty tier at once.
  { name: 'Aayan Ahmed',    email: 'aayan@gameon.app',    role: 'player', phone: '9820022001', city: 'Bengaluru', favoriteSports: ['football', 'cricket'], skillLevel: 'advanced',     position: 'Midfielder',  walletBalance: 2500, lifetimePoints: 2400, loyaltyPoints: 1850, gamesPlayed: 34 },
  { name: 'Adeem Sheikh',   email: 'adeem@gameon.app',    role: 'player', phone: '9820022002', city: 'Bengaluru', favoriteSports: ['badminton'],           skillLevel: 'intermediate', position: 'Singles',     walletBalance: 1200, lifetimePoints: 720,  loyaltyPoints: 720,  gamesPlayed: 11 },
  { name: 'Veer Malhotra',  email: 'veer@gameon.app',     role: 'player', phone: '9820022003', city: 'Mumbai',    favoriteSports: ['football'],            skillLevel: 'intermediate', position: 'Goalkeeper',  walletBalance: 800,  lifetimePoints: 150,  loyaltyPoints: 150,  gamesPlayed: 3 },
  { name: 'Vaishnavi Rao',  email: 'vaishnavi@gameon.app',role: 'player', phone: '9820022004', city: 'Pune',      favoriteSports: ['basketball','tennis'], skillLevel: 'advanced',     position: 'Point Guard', walletBalance: 3000, lifetimePoints: 5600, loyaltyPoints: 3100, gamesPlayed: 71 },
  { name: 'Anushka Desai',  email: 'anushka@gameon.app',  role: 'player', phone: '9820022005', city: 'Delhi',     favoriteSports: ['cricket'],             skillLevel: 'beginner',     position: 'All-rounder', walletBalance: 500,  lifetimePoints: 100,  loyaltyPoints: 100,  gamesPlayed: 1 },
];

const img = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=70`;
const TURF_IMAGES = [
  img('1459865264687-595d652de67e'), img('1551958219-acbc608c6377'),
  img('1431324155629-1a6deb1dec8d'), img('1517649763962-0c623066013b'),
  img('1546519638-68e109498ffc'),   img('1626224583764-f87db24ac4ea'),
];

export const venues = [
  // ── Bengaluru ──────────────────────────────────────────────────────────
  {
    name: 'Turf Nation Koramangala', ownerEmail: 'shivanshu@gameon.app',
    description: 'FIFA-standard artificial turf in the heart of Koramangala. Floodlit until midnight, covered seating and a small cafe. The go-to for 5-a-side after work.',
    bookingMode: 'automated', lat: 12.9352, lng: 77.6245, isFeatured: true, isVerified: true,
    address: { line1: '80 Feet Road, 4th Block', area: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', pincode: '560034' },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'drinking_water', 'cafeteria', 'cctv', 'first_aid'],
    courts: [
      { name: 'Turf A (5-a-side)', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1200, peakPricePerHour: 1600 },
      { name: 'Turf B (7-a-side)', sport: 'football', format: '7-a-side', capacity: 14, pricePerHour: 1800, peakPricePerHour: 2400 },
      { name: 'Cricket Net 1', sport: 'cricket', format: 'Practice net', capacity: 6, pricePerHour: 700 },
    ],
    rating: 4.7, reviewCount: 214, bookingCount: 1890, images: [TURF_IMAGES[0], TURF_IMAGES[1]],
  },
  {
    name: 'PlayArena Sarjapur', ownerEmail: 'shivanshu@gameon.app',
    description: 'Multi-sport complex with badminton courts, a rooftop turf and a full-size basketball court. Equipment rental available at reception.',
    bookingMode: 'automated', lat: 12.9010, lng: 77.6874, isVerified: true,
    address: { line1: 'Sarjapur Main Road', area: 'Sarjapur', city: 'Bengaluru', state: 'Karnataka', pincode: '560035' },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'shower', 'equipment_rental', 'cafeteria', 'wifi'],
    courts: [
      { name: 'Badminton Court 1', sport: 'badminton', format: 'Singles/Doubles', capacity: 4, pricePerHour: 500 },
      { name: 'Badminton Court 2', sport: 'badminton', format: 'Singles/Doubles', capacity: 4, pricePerHour: 500 },
      { name: 'Rooftop Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1400 },
      { name: 'Indoor Basketball', sport: 'basketball', format: 'Full court', capacity: 10, pricePerHour: 900 },
    ],
    rating: 4.5, reviewCount: 168, bookingCount: 1420, images: [TURF_IMAGES[2], TURF_IMAGES[3]],
  },
  {
    name: 'Green Field Whitefield', ownerEmail: 'shivanshu@gameon.app',
    description: 'Neighbourhood turf run by a local family. Booking is confirmed over a quick call — our ops team handles it for you.',
    bookingMode: 'manual', lat: 12.9698, lng: 77.7500,
    manualContact: { phone: '9845012345', whatsapp: '9845012345', responseTimeMins: 20 },
    address: { line1: 'Varthur Road', area: 'Whitefield', city: 'Bengaluru', state: 'Karnataka', pincode: '560066' },
    amenities: ['parking', 'floodlights', 'washroom', 'drinking_water'],
    courts: [
      { name: 'Main Turf', sport: 'football', format: '7-a-side', capacity: 14, pricePerHour: 1100 },
      { name: 'Volleyball Court', sport: 'volleyball', format: '6-a-side', capacity: 12, pricePerHour: 600 },
    ],
    rating: 4.2, reviewCount: 47, bookingCount: 310, images: [TURF_IMAGES[4]],
  },
  {
    name: 'Ace Tennis Academy Indiranagar', ownerEmail: 'shivanshu@gameon.app',
    description: 'Four clay and hard courts with coaching available. Early morning slots go fast.',
    bookingMode: 'automated', lat: 12.9784, lng: 77.6408, isVerified: true,
    address: { line1: '12th Main, HAL 2nd Stage', area: 'Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560038' },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'shower', 'equipment_rental', 'seating'],
    courts: [
      { name: 'Hard Court 1', sport: 'tennis', format: 'Singles/Doubles', capacity: 4, pricePerHour: 800 },
      { name: 'Hard Court 2', sport: 'tennis', format: 'Singles/Doubles', capacity: 4, pricePerHour: 800 },
      { name: 'Pickleball Court', sport: 'pickleball', format: 'Doubles', capacity: 4, pricePerHour: 450 },
    ],
    rating: 4.8, reviewCount: 96, bookingCount: 720, images: [TURF_IMAGES[5]],
  },

  // ── Mumbai ─────────────────────────────────────────────────────────────
  {
    name: 'Andheri Sports Arena', ownerEmail: 'meera@gameon.app',
    description: 'Two floodlit turfs beside the metro station. Popular with corporate leagues on weeknights.',
    bookingMode: 'automated', lat: 19.1197, lng: 72.8464, isFeatured: true, isVerified: true,
    address: { line1: 'Andheri East, near Metro Stn', area: 'Andheri', city: 'Mumbai', state: 'Maharashtra', pincode: '400069' },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'drinking_water', 'cafeteria', 'first_aid', 'cctv'],
    courts: [
      { name: 'Turf 1', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1600, peakPricePerHour: 2200 },
      { name: 'Turf 2', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1600, peakPricePerHour: 2200 },
      { name: 'Box Cricket', sport: 'cricket', format: 'Box cricket', capacity: 12, pricePerHour: 1400 },
    ],
    rating: 4.6, reviewCount: 302, bookingCount: 2450, images: [TURF_IMAGES[1], TURF_IMAGES[0]],
  },
  {
    name: 'Bandra Smash Court', ownerEmail: 'meera@gameon.app',
    description: 'Air-conditioned indoor badminton and table tennis. Wooden flooring, shuttle rental included.',
    bookingMode: 'automated', lat: 19.0596, lng: 72.8295,
    address: { line1: 'Linking Road', area: 'Bandra West', city: 'Mumbai', state: 'Maharashtra', pincode: '400050' },
    amenities: ['washroom', 'changing_room', 'drinking_water', 'equipment_rental', 'wifi', 'seating'],
    courts: [
      { name: 'Court 1', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 700 },
      { name: 'Court 2', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 700 },
      { name: 'TT Table 1', sport: 'tabletennis', format: 'Singles', capacity: 2, pricePerHour: 300 },
    ],
    rating: 4.4, reviewCount: 121, bookingCount: 980, images: [TURF_IMAGES[3]],
  },
  {
    name: 'Chembur Community Ground', ownerEmail: 'meera@gameon.app',
    description: 'Old-school open ground managed by the local association. Slots confirmed manually by the caretaker.',
    bookingMode: 'manual', lat: 19.0522, lng: 72.9005,
    manualContact: { phone: '9820098200', whatsapp: '9820098200', responseTimeMins: 45 },
    address: { line1: 'Diamond Garden Road', area: 'Chembur', city: 'Mumbai', state: 'Maharashtra', pincode: '400071' },
    amenities: ['washroom', 'drinking_water', 'seating'],
    courts: [
      { name: 'Main Ground', sport: 'cricket', format: '11-a-side', capacity: 22, pricePerHour: 2000 },
      { name: 'Side Turf', sport: 'football', format: '7-a-side', capacity: 14, pricePerHour: 900 },
    ],
    rating: 3.9, reviewCount: 33, bookingCount: 190, images: [TURF_IMAGES[2]],
  },

  // ── Delhi ──────────────────────────────────────────────────────────────
  {
    name: 'Dwarka Kickoff Turf', ownerEmail: 'rajat@gameon.app',
    description: 'Large 7-a-side turf with a spectator gallery. Hosts a weekend amateur league every Sunday.',
    bookingMode: 'automated', lat: 28.5921, lng: 77.0460, isVerified: true,
    address: { line1: 'Sector 12', area: 'Dwarka', city: 'Delhi', state: 'Delhi', pincode: '110078' },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'drinking_water', 'seating', 'first_aid'],
    courts: [
      { name: 'Turf A', sport: 'football', format: '7-a-side', capacity: 14, pricePerHour: 1500, peakPricePerHour: 2000 },
      { name: 'Turf B', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1000 },
    ],
    rating: 4.3, reviewCount: 88, bookingCount: 640, images: [TURF_IMAGES[0]],
  },
  {
    name: 'Saket Hoops Centre', ownerEmail: 'rajat@gameon.app',
    description: 'Two full basketball courts, wooden indoor and outdoor synthetic. Coaching camps in the mornings.',
    bookingMode: 'automated', lat: 28.5245, lng: 77.2066,
    address: { line1: 'Press Enclave Road', area: 'Saket', city: 'Delhi', state: 'Delhi', pincode: '110017' },
    amenities: ['parking', 'floodlights', 'washroom', 'shower', 'drinking_water', 'equipment_rental'],
    courts: [
      { name: 'Indoor Court', sport: 'basketball', format: 'Full court', capacity: 10, pricePerHour: 1100 },
      { name: 'Outdoor Court', sport: 'basketball', format: 'Half court', capacity: 6, pricePerHour: 600 },
    ],
    rating: 4.1, reviewCount: 57, bookingCount: 415, images: [TURF_IMAGES[5]],
  },
  {
    name: 'Rohini Cricket Nets', ownerEmail: 'rajat@gameon.app',
    description: 'Six practice nets with bowling machines available on request. Booking handled over WhatsApp.',
    bookingMode: 'manual', lat: 28.7365, lng: 77.1152,
    manualContact: { phone: '9811122334', whatsapp: '9811122334', responseTimeMins: 30 },
    address: { line1: 'Sector 7', area: 'Rohini', city: 'Delhi', state: 'Delhi', pincode: '110085' },
    amenities: ['parking', 'floodlights', 'washroom', 'drinking_water', 'equipment_rental'],
    courts: [
      { name: 'Net 1', sport: 'cricket', format: 'Practice net', capacity: 4, pricePerHour: 500 },
      { name: 'Net 2', sport: 'cricket', format: 'Practice net', capacity: 4, pricePerHour: 500 },
      { name: 'Net 3 (bowling machine)', sport: 'cricket', format: 'Practice net', capacity: 4, pricePerHour: 800 },
    ],
    rating: 4.0, reviewCount: 41, bookingCount: 275, images: [TURF_IMAGES[4]],
  },

  // ── Pune ───────────────────────────────────────────────────────────────
  {
    name: 'Baner Playfield', ownerEmail: 'farhan@gameon.app',
    description: 'Newly laid turf with excellent drainage — plays fine even in monsoon. Cafe on site.',
    bookingMode: 'automated', lat: 18.5590, lng: 73.7868, isFeatured: true,
    address: { line1: 'Baner Road', area: 'Baner', city: 'Pune', state: 'Maharashtra', pincode: '411045' },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'cafeteria', 'drinking_water', 'wifi'],
    courts: [
      { name: 'Turf 1', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1000, peakPricePerHour: 1400 },
      { name: 'Turf 2', sport: 'football', format: '7-a-side', capacity: 14, pricePerHour: 1500 },
      { name: 'Pickleball 1', sport: 'pickleball', format: 'Doubles', capacity: 4, pricePerHour: 400 },
    ],
    rating: 4.6, reviewCount: 134, bookingCount: 1050, images: [TURF_IMAGES[1], TURF_IMAGES[2]],
  },
  {
    name: 'Kothrud Shuttle Zone', ownerEmail: 'farhan@gameon.app',
    description: 'Six synthetic badminton courts with a dedicated coaching wing. Student discounts on weekday mornings.',
    bookingMode: 'automated', lat: 18.5074, lng: 73.8077,
    address: { line1: 'Karve Road', area: 'Kothrud', city: 'Pune', state: 'Maharashtra', pincode: '411038' },
    amenities: ['parking', 'washroom', 'changing_room', 'drinking_water', 'equipment_rental', 'seating'],
    courts: [
      { name: 'Court 1', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 450 },
      { name: 'Court 2', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 450 },
      { name: 'Court 3', sport: 'badminton', format: 'Singles', capacity: 2, pricePerHour: 350 },
    ],
    rating: 4.4, reviewCount: 79, bookingCount: 590, images: [TURF_IMAGES[3]],
  },
];
