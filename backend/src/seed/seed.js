/**
 * Resets and repopulates the database.
 *
 *   npm run seed                  demo venues + real Lucknow listings
 *   npm run seed -- --no-lucknow  demo venues only
 *   npm run seed -- --lucknow-only
 *
 * With no MONGO_URI set this runs against a throwaway in-memory database,
 * which is almost never what you want — set MONGO_URI first.
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB, isMemoryDB } from '../config/db.js';
import { User, Venue, Review, Booking, TeamUpPost, Team, Transaction } from '../models/index.js';
import { owners, players, venues } from './data.js';
import { lucknowVenues, lucknowOwner } from './lucknow.js';
import { LOYALTY } from '../config/constants.js';
import { tierFor } from '../services/loyalty.service.js';

const args = process.argv.slice(2);

const COMMENTS = [
  'Great surface, lights are bright enough for night games.',
  'Booked last minute and it went through instantly. Will come back.',
  'Parking is a bit tight on weekends but the turf itself is excellent.',
  'Good value for the price. Changing rooms were clean.',
  'Staff were helpful and the nets were in good condition.',
  'Turf drains well — we played right after rain with no issues.',
];

async function insertVenue(v, ownerId) {
  const { ownerEmail: _ownerEmail, lat, lng, ...rest } = v;
  return Venue.create({
    ...rest,
    owner: ownerId,
    location: { type: 'Point', coordinates: [lng, lat] },
    // Stated outright rather than inherited from the schema default. Demo
    // data is meant to be visible immediately, but "visible" is now something
    // a venue has to be granted rather than something it starts with — see
    // the note on Venue.moderationStatus.
    moderationStatus: 'approved',
    isActive: true,
  });
}

/**
 * Populates the database. Exported so it can be run from somewhere other than
 * a shell — see routes/cron.routes.js, which exists because a local machine
 * whose DNS refuses SRV lookups cannot reach Atlas at all, while the deployed
 * API sitting next to it can.
 *
 * `connect: false` reuses a connection the caller already has open.
 */
export async function seedDatabase({
  noLucknow = false, lucknowOnly = false, connect = true,
} = {}) {
  if (connect) await connectDB();

  if (connect && isMemoryDB()) {
    console.log('\n⚠️  Seeding an in-memory database — this data disappears when the');
    console.log('    process exits. Set MONGO_URI in backend/.env to persist it.\n');
  }

  console.log('🧹 Clearing collections…');
  await Promise.all([
    User.deleteMany({}), Venue.deleteMany({}), Review.deleteMany({}),
    Booking.deleteMany({}), TeamUpPost.deleteMany({}), Team.deleteMany({}),
    Transaction.deleteMany({}),
  ]);

  let ownerDocs = [];
  let playerDocs = [];
  let demoCount = 0;
  let reviewCount = 0;

  if (!lucknowOnly) {
    console.log('👤 Creating users…');
    ownerDocs = await User.create(owners.map((o) => ({ ...o, isVerified: true })));
    playerDocs = await User.create(players.map((p) => {
      const lifetime = p.lifetimePoints ?? LOYALTY.SIGNUP_BONUS;
      return {
        ...p,
        loyaltyPoints: p.loyaltyPoints ?? lifetime,
        lifetimePoints: lifetime,
        loyaltyTier: tierFor(lifetime).key,
      };
    }));

    const ownerByEmail = Object.fromEntries(ownerDocs.map((o) => [o.email, o]));

    console.log('🏟️  Creating demo venues…');
    for (const v of venues) {
      const venue = await insertVenue(v, ownerByEmail[v.ownerEmail]._id);
      demoCount += 1;

      // Reviews are only seeded for the fictional demo venues.
      const reviewers = playerDocs.slice(0, 2 + Math.floor(Math.random() * 3));
      for (const user of reviewers) {
        await Review.create({
          user: user._id, venue: venue._id,
          rating: Math.min(5, Math.max(3, Math.round(venue.rating + (Math.random() - 0.5)))),
          comment: COMMENTS[Math.floor(Math.random() * COMMENTS.length)],
        });
        reviewCount += 1;
      }
    }
  }

  let lucknowCount = 0;
  if (!noLucknow) {
    console.log('📍 Creating real Lucknow listings…');
    const lkoOwner = await User.create({ ...lucknowOwner, isVerified: true });
    for (const v of lucknowVenues) {
      await insertVenue(v, lkoOwner._id);
      lucknowCount += 1;
    }
  }

  const summary = {
    owners: ownerDocs.length + (lucknowCount ? 1 : 0),
    players: playerDocs.length,
    demoVenues: demoCount,
    reviews: reviewCount,
    lucknowVenues: lucknowCount,
  };

  console.log('\n✅ Seed complete');
  console.log(`   ${summary.owners} owners, ${summary.players} players`);
  console.log(`   ${demoCount} demo venues (${reviewCount} reviews), ${lucknowCount} Lucknow listings`);

  return summary;
}

/* ── CLI ─────────────────────────────────────────────────────── */

async function run() {
  // The demo accounts share published passwords. Seeding them into a live
  // database hands anyone who has read this repository a working login on
  // accounts holding wallet balances.
  if (process.env.NODE_ENV === 'production' && !args.includes('--force')) {
    console.error('\n❌ Refusing to seed demo accounts in production.');
    console.error('   The demo logins use shared, published passwords.');
    console.error('   Use --lucknow-only for venue data, or --force if you');
    console.error('   really mean it and will change those passwords.\n');
    process.exit(1);
  }

  const summary = await seedDatabase({
    noLucknow: args.includes('--no-lucknow'),
    lucknowOnly: args.includes('--lucknow-only'),
  });

  if (summary.lucknowVenues) {
    console.log('\n   ⚠️  The Lucknow entries are real business names taken from public');
    console.log('       listings. Prices, hours and coordinates are NOT verified and no');
    console.log('       reviews were invented for them. Read src/seed/lucknow.js and');
    console.log('       confirm details with each venue before going live.');
  }

  console.log('\n   Demo logins');
  console.log('   ─────────────────────────────────────────────');
  console.log('   Player (Elite tier)  aayan@gameon.app      / player123');
  console.log('   Player (Legend tier) vaishnavi@gameon.app  / player123');
  console.log('   Venue owner          shivanshu@gameon.app  / owner123\n');

  await disconnectDB();
  await mongoose.connection.close().catch(() => {});
  process.exit(0);
}

// Only run as a CLI when invoked directly, not when imported.
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  run().catch((err) => { console.error('❌ Seed failed:', err); process.exit(1); });
}
