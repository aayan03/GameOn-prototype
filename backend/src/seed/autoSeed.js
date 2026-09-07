/**
 * Populates an empty development database so the app is usable immediately.
 * Never runs against a database that already has users in it.
 */
import { User, Venue, Review, Parlor } from '../models/index.js';
import { owners, players, venues, demoPassword } from './data.js';
import parlorSeed from './parlors.js';
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
    // Explicit, because the schema no longer publishes a venue by default —
    // see the note on Venue.moderationStatus. Without these two lines the
    // development database seeds itself with venues nobody can see, which
    // looks exactly like a broken search.
    moderationStatus: 'approved',
    isActive: true,
  });
}

/**
 * Game parlours. Invented listings — see the note at the top of
 * seed/parlors.js — so a fresh locator has something in it. A list feature
 * with an empty list reads as broken rather than as new.
 */
async function insertParlors(ownerId) {
  const rows = parlorSeed.map((p) => {
    const { lat, lng, ...rest } = p;
    return {
      ...rest,
      addedBy: ownerId,
      location: { type: 'Point', coordinates: [lng, lat] },
      isClaimed: true,
      moderationStatus: 'approved',
      isActive: true,
    };
  });
  await Parlor.insertMany(rows);
  return rows.length;
}

/**
 * `includeLucknow` defaults to FALSE now.
 *
 * Those entries carry real Lucknow business names with invented prices,
 * coordinates and opening hours — see the header of seed/lucknow.js.
 * Defaulting them on meant every fresh database, including anything a
 * demo or a deploy touched, published fabricated rates under other
 * people's trading names. Opting in is the right way round: set
 * SEED_LUCKNOW=true if you have actually verified them.
 */
export default async function autoSeed({
  includeLucknow = process.env.SEED_LUCKNOW === 'true',
} = {}) {
  // Only ever runs against a throwaway development database — server.js gates
  // this on isMemoryDB(), and this is the second line of defence.
  if (process.env.NODE_ENV === 'production') return false;
  if (await User.exists({})) return false;

  // Resolved here, not at import — see the note on demoPassword().
  const password = demoPassword();

  const ownerDocs = await User.create(owners.map((o) => ({ ...o, password, isVerified: true })));

  const playerDocs = await User.create(players.map((p) => {
    const lifetime = p.lifetimePoints ?? LOYALTY.SIGNUP_BONUS;
    return {
      ...p,
      password,
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

  const parlorCount = await insertParlors(ownerDocs[0]._id);

  console.log(`🌱 Auto-seeded ${venues.length} demo venues, ${parlorCount} game parlours`
    + ` + ${lucknowCount} real Lucknow listings.`);
  if (lucknowCount) {
    console.log('   ⚠️  Lucknow entries are UNVERIFIED listings for real businesses — invented prices and hours. Read src/seed/lucknow.js.');
  }
  console.log(`   Demo login → aayan@gameon.app / ${password}`);
  return true;
}
