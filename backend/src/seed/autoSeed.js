/**
 * Populates an empty development database so the app is usable immediately.
 * Never runs against a database that already has users in it.
 */
import { User, Venue, Review } from '../models/index.js';
import { owners, players, venues } from './data.js';
import { lucknowVenues, lucknowOwner } from './lucknow.js';
import { LOYALTY } from '../config/constants.js';
import { tierFor } from '../services/loyalty.service.js';

const COMMENTS = [
  'Great surface, lights are bright enough for night games.',
  'Booked last minute and it went through instantly. Will come back.',
  'Parking is a bit tight on weekends but the turf itself is excellent.',
  'Good value for the price. Changing rooms were clean.',
  'Staff were helpful and the nets were in good condition.',
];

async function insertVenue(v, ownerId) {
  const { ownerEmail: _ownerEmail, lat, lng, ...rest } = v;
  return Venue.create({
    ...rest,
    owner: ownerId,
    location: { type: 'Point', coordinates: [lng, lat] },
  });
}

export default async function autoSeed({ includeLucknow = true } = {}) {
  // Only ever runs against a throwaway development database — server.js gates
  // this on isMemoryDB(), and this is the second line of defence.
  if (process.env.NODE_ENV === 'production') return false;
  if (await User.exists({})) return false;

  const ownerDocs = await User.create(owners.map((o) => ({ ...o, isVerified: true })));

  const playerDocs = await User.create(players.map((p) => {
    const lifetime = p.lifetimePoints ?? LOYALTY.SIGNUP_BONUS;
    return {
      ...p,
      loyaltyPoints: p.loyaltyPoints ?? lifetime,
      lifetimePoints: lifetime,
      loyaltyTier: tierFor(lifetime).key,
    };
  }));

  const ownerByEmail = Object.fromEntries(ownerDocs.map((o) => [o.email, o]));

  // Demo venues — these are fictional, so seeded reviews are fine here.
  for (const v of venues) {
    const venue = await insertVenue(v, ownerByEmail[v.ownerEmail]._id);
    for (const user of playerDocs.slice(0, 3)) {
      await Review.create({
        user: user._id, venue: venue._id,
        rating: Math.min(5, Math.max(3, Math.round(venue.rating))),
        comment: COMMENTS[Math.floor(Math.random() * COMMENTS.length)],
      });
    }
  }

  // Real Lucknow venues — no reviews are seeded for these on purpose.
  // See the header of seed/lucknow.js.
  let lucknowCount = 0;
  if (includeLucknow) {
    const lkoOwner = await User.create({ ...lucknowOwner, isVerified: true });
    for (const v of lucknowVenues) {
      await insertVenue(v, lkoOwner._id);
      lucknowCount += 1;
    }
  }

  console.log(`🌱 Auto-seeded ${venues.length} demo venues + ${lucknowCount} real Lucknow listings.`);
  if (lucknowCount) {
    console.log('   ⚠️  Lucknow entries are unverified public listings — read src/seed/lucknow.js before launch.');
  }
  console.log('   Demo login → aayan@gameon.app / player123');
  return true;
}
