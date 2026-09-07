/**
 * Demo game parlours.
 *
 * These are INVENTED. Plausible names, real neighbourhoods, made-up phone
 * numbers in the 9999xxxxxx range that no operator issues. Unlike
 * seed/lucknow.js — which carries real business names and is opt-in for
 * exactly that reason — nothing here belongs to anybody, so there is no
 * trading name to misrepresent and no phone to ring by accident.
 *
 * They exist because a locator with an empty database looks broken rather
 * than new: the whole feature is a list, and a list with nothing in it says
 * nothing about whether the list works.
 *
 * The opening hours are deliberately varied, including two places that close
 * after midnight, so "open now" is exercised by the demo data rather than
 * only by the tests.
 */

const week = (open, close) =>
  Array.from({ length: 7 }, (_, day) => ({ day, open, close, isClosed: false }));

/** Same as `week`, but shut on one day — most parlours have a quiet Monday. */
const weekExcept = (open, close, closedDay) =>
  week(open, close).map((h) => (h.day === closedDay ? { ...h, isClosed: true } : h));

export const parlors = [
  {
    name: 'Blue Moon Snooker & Pool',
    description: 'Eight full-size snooker tables and four pool tables on the first floor. '
      + 'Coaching on weekday mornings, league nights on Thursdays.',
    games: ['snooker', 'pool', 'carrom'],
    amenities: ['parking', 'ac', 'cafe', 'washroom', 'card_payment', 'seating'],
    address: { line1: '2nd Floor, 100 Feet Road', area: 'Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560038' },
    lat: 12.9784, lng: 77.6408,
    contact: { phone: '9999010101' },
    openingHours: week('11:00', '23:30'),
    priceFrom: 250, priceTo: 400,
  },
  {
    name: 'Pixel Play Gaming Cafe',
    description: 'PS5, Xbox Series X and gaming PCs by the hour, plus a wall of board games. '
      + 'Student rates before 5pm.',
    games: ['console', 'boardgames', 'vr'],
    amenities: ['ac', 'cafe', 'wifi', 'washroom', 'card_payment'],
    address: { line1: '27th Main', area: 'HSR Layout', city: 'Bengaluru', state: 'Karnataka', pincode: '560102' },
    lat: 12.9279, lng: 77.6271,
    contact: { phone: '9999020202' },
    openingHours: week('11:00', '23:00'),
    priceFrom: 150, priceTo: 300,
  },
  {
    // Closes at 2am — the case that makes `openStatus` more than a comparison.
    name: 'Cue Masters Club',
    description: 'Late-night snooker and pool. Open until 2am every night, kitchen till 1am.',
    games: ['snooker', 'pool', 'darts'],
    amenities: ['parking', 'ac', 'cafe', 'washroom', 'seating', 'card_payment'],
    address: { line1: 'ITPL Main Road', area: 'Whitefield', city: 'Bengaluru', state: 'Karnataka', pincode: '560066' },
    lat: 12.9698, lng: 77.7500,
    contact: { phone: '9999030303' },
    openingHours: week('12:00', '02:00'),
    priceFrom: 200, priceTo: 350,
  },
  {
    name: 'Strike Lanes Bowling',
    description: 'Twelve lanes, bumper rails for kids, and an arcade floor upstairs.',
    games: ['bowling', 'arcade', 'foosball', 'darts'],
    amenities: ['parking', 'ac', 'cafe', 'washroom', 'card_payment', 'group_bookings', 'lockers'],
    address: { line1: 'Tumkur Road', area: 'Yeshwanthpur', city: 'Bengaluru', state: 'Karnataka', pincode: '560022' },
    lat: 12.9915, lng: 77.5560,
    contact: { phone: '9999040404' },
    openingHours: week('11:00', '23:00'),
    priceFrom: 400, priceTo: 600,
  },
  {
    name: 'Turbo Kart Arena',
    description: 'Outdoor 600m track, twin-engine karts, and laser tag in the shed. '
      + 'Closed on Mondays for track maintenance.',
    games: ['karting', 'arcade', 'lasertag'],
    amenities: ['parking', 'cafe', 'washroom', 'card_payment', 'group_bookings', 'lockers'],
    address: { line1: 'Hosur Road', area: 'Bommanahalli', city: 'Bengaluru', state: 'Karnataka', pincode: '560068' },
    lat: 12.9100, lng: 77.6400,
    contact: { phone: '9999050505' },
    openingHours: weekExcept('10:00', '22:00', 1),
    priceFrom: 500, priceTo: 800,
  },
  {
    name: 'The Board Room',
    description: 'Four hundred board games, carrom boards and a quiet upstairs room. '
      + 'Per-head hourly rate, no minimum.',
    games: ['boardgames', 'carrom', 'darts'],
    amenities: ['ac', 'cafe', 'wifi', 'washroom', 'seating'],
    address: { line1: 'Veera Desai Road', area: 'Andheri West', city: 'Mumbai', state: 'Maharashtra', pincode: '400053' },
    lat: 19.1136, lng: 72.8697,
    contact: { phone: '9999060606' },
    openingHours: week('12:00', '23:00'),
    priceFrom: 180, priceTo: 250,
  },
  {
    // Also overnight, and in a second city so the city filter has something.
    name: 'Rack & Roll',
    description: 'Six American pool tables and two snooker tables. Happy hour 4–7pm.',
    games: ['pool', 'snooker'],
    amenities: ['ac', 'cafe', 'washroom', 'card_payment', 'seating'],
    address: { line1: 'Senapati Bapat Marg', area: 'Lower Parel', city: 'Mumbai', state: 'Maharashtra', pincode: '400013' },
    lat: 19.0760, lng: 72.8777,
    contact: { phone: '9999070707' },
    openingHours: week('11:00', '01:00'),
    priceFrom: 300, priceTo: 450,
  },
  {
    name: 'Zone VR & Arcade',
    description: 'Free-roam VR arena, racing rigs and a token arcade. Birthday packages available.',
    games: ['vr', 'arcade', 'console'],
    amenities: ['parking', 'ac', 'cafe', 'washroom', 'card_payment', 'group_bookings', 'wheelchair_access'],
    address: { line1: 'Baner Road', area: 'Baner', city: 'Pune', state: 'Maharashtra', pincode: '411045' },
    lat: 18.5590, lng: 73.7868,
    contact: { phone: '9999080808' },
    openingHours: week('11:00', '22:30'),
    priceFrom: 350, priceTo: 900,
  },
];

export default parlors;
