/**
 * ═══════════════════════════════════════════════════════════════════════
 *  REAL LUCKNOW VENUES — READ THIS BEFORE GOING LIVE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The venue NAMES and LOCALITIES below are real businesses, taken from public
 * listings on Playo, Hudle and Playspots in August 2026.
 *
 * Everything else is NOT verified:
 *
 *   • Coordinates are the centre of the stated locality, not the venue's
 *     surveyed position. They will be off by a few hundred metres.
 *   • Prices are indicative market rates for Lucknow, not quoted rates.
 *   • Court names, counts, amenities and opening hours are plausible
 *     placeholders.
 *   • Ratings are deliberately 0 and there are NO seeded reviews. Inventing
 *     review scores for real businesses would be fabricating endorsements
 *     they never gave, and users would make decisions on fiction.
 *
 * Every entry is flagged `isVerified: false` and `isClaimed: false`, and the
 * UI shows an "Unclaimed listing" badge on them.
 *
 * BEFORE LAUNCH you must either (a) contact each venue, confirm the details,
 * and have them claim the listing, or (b) remove this file from the seed.
 * Publishing unverified prices under a real business's name invites both
 * angry owners and misled players.
 *
 * `npm run seed -- --no-lucknow` skips this file entirely.
 */

// Locality centres in Lucknow — [longitude, latitude]
const AREA = {
  gomtiNagar:      [80.9990, 26.8540],
  gomtiNagarExt:   [81.0300, 26.8300],
  vibhutiKhand:    [81.0060, 26.8600],
  vineetKhand:     [81.0080, 26.8430],
  vishalKhand:     [81.0020, 26.8500],
  aliganj:         [80.9380, 26.8930],
  hazratganj:      [80.9450, 26.8500],
  indiraNagar:     [80.9950, 26.8760],
  rajajipuram:     [80.8830, 26.8380],
  jankipuram:      [80.9210, 26.9210],
  aishbagh:        [80.9060, 26.8420],
  thakurganj:      [80.8890, 26.8760],
  fazullaganj:     [80.9120, 26.9060],
  alambagh:        [80.8930, 26.8080],
  mahanagar:       [80.9560, 26.8790],
  arjunganj:       [81.0180, 26.7960],
  ashiyana:        [80.9060, 26.7930],
  sultanpurRoad:   [81.0400, 26.7800],
  chinhat:         [81.0530, 26.8830],
};

const OWNER_EMAIL = 'lucknow.ops@gameon.app';

/** Common shape so each entry below stays readable. */
const base = (name, area, coords, extra = {}) => ({
  name,
  ownerEmail: OWNER_EMAIL,
  lng: coords[0],
  lat: coords[1],
  address: { area, city: 'Lucknow', state: 'Uttar Pradesh', ...(extra.address || {}) },
  // Not verified — see the header of this file.
  rating: 0,
  reviewCount: 0,
  bookingCount: 0,
  isVerified: false,
  isClaimed: false,
  isFeatured: false,
  ...extra,
  address: { area, city: 'Lucknow', state: 'Uttar Pradesh', ...(extra.address || {}) },
});

export const lucknowVenues = [
  /* ── Football turfs ────────────────────────────────────────── */
  base('Players Town', 'Gomti Nagar', AREA.vishalKhand, {
    description: 'Multi-sport turf in Vishal Khand offering football and box cricket. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 45 },
    amenities: ['parking', 'floodlights', 'washroom', 'drinking_water', 'seating'],
    courts: [
      { name: 'Main Turf', sport: 'football', format: '7-a-side', capacity: 14, pricePerHour: 1200, peakPricePerHour: 1500 },
      { name: 'Box Cricket', sport: 'cricket', format: 'Box cricket', capacity: 12, pricePerHour: 1000 },
    ],
  }),

  base('Ballers Sports Arena', 'Gomti Nagar', AREA.gomtiNagar, {
    description: 'Floodlit football turf in Gomti Nagar. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 40 },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'drinking_water'],
    courts: [
      { name: 'Turf A', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1000, peakPricePerHour: 1400 },
      { name: 'Turf B', sport: 'football', format: '7-a-side', capacity: 14, pricePerHour: 1400, peakPricePerHour: 1800 },
    ],
  }),

  base('MatchPoint', 'Gomti Nagar Extension', AREA.gomtiNagarExt, {
    description: 'Football turf on the Gomti Nagar Extension side of the city. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 30 },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'cafeteria', 'drinking_water'],
    courts: [
      { name: 'Main Turf', sport: 'football', format: '7-a-side', capacity: 14, pricePerHour: 1300, peakPricePerHour: 1700 },
    ],
  }),

  base('Athletes Sports Arena', 'Aliganj', AREA.aliganj, {
    description: 'Multi-sport arena in Aliganj with football and badminton. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 35 },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'drinking_water', 'equipment_rental'],
    courts: [
      { name: 'Football Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1000, peakPricePerHour: 1300 },
      { name: 'Badminton Court 1', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 400 },
      { name: 'Badminton Court 2', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 400 },
    ],
  }),

  base('PlayTurf', 'Aliganj', [80.9340, 26.8960], {
    description: 'Neighbourhood football turf in Aliganj. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 45 },
    amenities: ['floodlights', 'washroom', 'drinking_water'],
    courts: [
      { name: 'Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 900, peakPricePerHour: 1200 },
    ],
  }),

  base('Techtro Football Arena', 'Aishbagh', AREA.aishbagh, {
    description: 'Football arena in the Aishbagh area. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 45 },
    amenities: ['floodlights', 'washroom', 'drinking_water', 'parking'],
    courts: [
      { name: 'Main Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 900, peakPricePerHour: 1200 },
    ],
  }),

  base('Greenfields Sports Hub', 'Rajajipuram', AREA.rajajipuram, {
    description: 'Sports hub in Rajajipuram with football and general turf facilities. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 50 },
    amenities: ['parking', 'floodlights', 'washroom', 'drinking_water'],
    courts: [
      { name: 'Turf 1', sport: 'football', format: '7-a-side', capacity: 14, pricePerHour: 1100 },
      { name: 'Turf 2', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 800 },
    ],
  }),

  base('Game On Arena', 'Fazullaganj', AREA.fazullaganj, {
    description: 'Football turf in Fazullaganj. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 45 },
    amenities: ['floodlights', 'washroom', 'drinking_water'],
    courts: [
      { name: 'Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 850, peakPricePerHour: 1100 },
    ],
  }),

  base('PrimePlay', 'Gomti Nagar Extension', [81.0250, 26.8340], {
    description: 'Turf facility on the Gomti Nagar Extension side. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 40 },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'cafeteria'],
    courts: [
      { name: 'Turf A', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1100, peakPricePerHour: 1500 },
      { name: 'Box Cricket', sport: 'cricket', format: 'Box cricket', capacity: 12, pricePerHour: 1200 },
    ],
  }),

  base('APEX ARCADE Sports Arena', 'Thakurganj', AREA.thakurganj, {
    description: 'Sports arena in Thakurganj. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 45 },
    amenities: ['parking', 'floodlights', 'washroom', 'drinking_water'],
    courts: [
      { name: 'Football Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 900 },
      { name: 'Box Cricket', sport: 'cricket', format: 'Box cricket', capacity: 12, pricePerHour: 1000 },
    ],
  }),

  base('D&C Sports Turf', 'Gomti Nagar', [80.9950, 26.8580], {
    description: 'Turf in Gomti Nagar for football and cricket. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 40 },
    amenities: ['parking', 'floodlights', 'washroom', 'drinking_water'],
    courts: [
      { name: 'Turf', sport: 'football', format: '7-a-side', capacity: 14, pricePerHour: 1200 },
    ],
  }),

  base('Courtitude Lucknow', 'Vineet Khand, Gomti Nagar', AREA.vineetKhand, {
    description: 'Multi-sport courts in Vineet Khand. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 35 },
    amenities: ['parking', 'floodlights', 'washroom', 'changing_room', 'seating', 'cafeteria'],
    courts: [
      { name: 'Football Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1100 },
      { name: 'Basketball Court', sport: 'basketball', format: 'Full court', capacity: 10, pricePerHour: 800 },
      { name: 'Pickleball Court', sport: 'pickleball', format: 'Doubles', capacity: 4, pricePerHour: 500 },
    ],
  }),

  base('Apex Turf Lucknow', 'Jankipuram', AREA.jankipuram, {
    description: 'Box cricket and football turf in Jankipuram. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 40 },
    amenities: ['parking', 'floodlights', 'washroom', 'drinking_water', 'seating'],
    courts: [
      { name: 'Box Cricket Turf', sport: 'cricket', format: 'Box cricket', capacity: 12, pricePerHour: 1100, peakPricePerHour: 1400 },
      { name: 'Football Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 1000 },
    ],
  }),

  base('Green Box Turf & Cafe', 'Lucknow', AREA.indiraNagar, {
    description: 'Box turf with an on-site cafe. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 40 },
    amenities: ['parking', 'floodlights', 'washroom', 'cafeteria', 'drinking_water'],
    courts: [
      { name: 'Box Turf', sport: 'cricket', format: 'Box cricket', capacity: 12, pricePerHour: 1000 },
      { name: 'Football Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 950 },
    ],
  }),

  base('Yolo Sports Arena — Harmony Park', 'Lucknow', AREA.chinhat, {
    description: 'Sports arena listed with football facilities. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 45 },
    amenities: ['parking', 'floodlights', 'washroom', 'drinking_water'],
    courts: [
      { name: 'Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 600, peakPricePerHour: 900 },
    ],
  }),

  base('Fitness & Fun Arena', 'Lucknow', AREA.alambagh, {
    description: 'Football turf listed at ₹500 onwards. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 45 },
    amenities: ['floodlights', 'washroom', 'drinking_water'],
    courts: [
      { name: 'Turf', sport: 'football', format: '5-a-side', capacity: 10, pricePerHour: 500, peakPricePerHour: 800 },
    ],
  }),

  /* ── Racquet & indoor ──────────────────────────────────────── */
  base('Maharana Pratap Sports Arena', 'Gomti Nagar', [81.0040, 26.8490], {
    description: 'Badminton courts in Gomti Nagar. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 35 },
    amenities: ['parking', 'washroom', 'changing_room', 'drinking_water', 'equipment_rental', 'seating'],
    courts: [
      { name: 'Court 1', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 400 },
      { name: 'Court 2', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 400 },
      { name: 'Court 3', sport: 'badminton', format: 'Singles', capacity: 2, pricePerHour: 300 },
    ],
  }),

  base('Spuddy Lucknow Sports Academy', 'Arjunganj', AREA.arjunganj, {
    description: 'Sports academy with badminton facilities. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 45 },
    amenities: ['parking', 'washroom', 'changing_room', 'drinking_water', 'equipment_rental'],
    courts: [
      { name: 'Badminton Court 1', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 350 },
      { name: 'Badminton Court 2', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 350 },
    ],
  }),

  base('The Pavilion Sports Club', 'Ashiyana', AREA.ashiyana, {
    description: 'Sports club on Bijnor Road with badminton courts. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 40 },
    amenities: ['parking', 'washroom', 'changing_room', 'shower', 'cafeteria', 'seating'],
    courts: [
      { name: 'Court 1', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 450 },
      { name: 'Court 2', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 450 },
      { name: 'Table Tennis', sport: 'tabletennis', format: 'Singles', capacity: 2, pricePerHour: 250 },
    ],
  }),

  base('Flying Feathers Badminton Club', 'Sultanpur Road', AREA.sultanpurRoad, {
    description: 'Badminton club on Sultanpur Road. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 45 },
    amenities: ['parking', 'washroom', 'drinking_water', 'equipment_rental'],
    courts: [
      { name: 'Court 1', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 350 },
      { name: 'Court 2', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 350 },
    ],
  }),

  base('Gaurav Khanna High Performance Excellence Center', 'Omaxe City', [80.9200, 26.7700], {
    description: 'Badminton training centre. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 60 },
    amenities: ['parking', 'washroom', 'changing_room', 'shower', 'drinking_water', 'first_aid'],
    courts: [
      { name: 'Court 1', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 600 },
      { name: 'Court 2', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 600 },
    ],
  }),

  base('Lucknow Bash Arena', 'Atif Vihar', [81.0600, 26.8700], {
    description: 'Badminton arena in the Atif Vihar area. Details are unverified — please confirm with the venue.',
    bookingMode: 'manual',
    manualContact: { responseTimeMins: 45 },
    amenities: ['parking', 'washroom', 'drinking_water'],
    courts: [
      { name: 'Court 1', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 300 },
      { name: 'Court 2', sport: 'badminton', format: 'Doubles', capacity: 4, pricePerHour: 300 },
    ],
  }),
];

export const lucknowOwner = {
  name: 'GameOn Lucknow Ops',
  email: OWNER_EMAIL,
  password: 'LucknowOps@2026',
  role: 'owner',
  phone: '9000000001',
  city: 'Lucknow',
};
