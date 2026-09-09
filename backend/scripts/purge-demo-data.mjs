/**
 * Removes demo accounts and unclaimed listings from a real database.
 *
 * Two things in the seed must not survive contact with real users:
 *
 *   1. The demo accounts. They used to carry passwords published in this
 *      repository, on accounts that can manage venues and hold wallet
 *      balance. Even with SEED_PASSWORD set, they are fictional people with
 *      invented wallet balances and loyalty tiers sitting in your user table.
 *
 *   2. The unclaimed Lucknow listings. Real business names with invented
 *      prices, coordinates and opening hours — see the header of
 *      src/seed/lucknow.js. Publishing those under someone else's trading
 *      name is a problem for them and for you.
 *
 * Usage:
 *   node scripts/purge-demo-data.mjs              # dry run, changes nothing
 *   node scripts/purge-demo-data.mjs --apply      # actually delete
 *   node scripts/purge-demo-data.mjs --apply --keep-unclaimed
 *
 * Refuses to delete anything a real user has touched: an account with
 * bookings that are not themselves seeded, or a venue somebody has actually
 * booked, is reported and left alone. Deleting those would take real
 * customers' history with them.
 */

import mongoose from 'mongoose';
import env from '../src/config/env.js';
import { User, Venue, Booking, Review, TeamUpPost, Team, Transaction, Notification } from '../src/models/index.js';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const KEEP_UNCLAIMED = args.has('--keep-unclaimed');

const DEMO_EMAIL = /@gameon\.app$/i;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function main() {
  if (!env.MONGO_URI) {
    console.error('MONGO_URI is not set. Point it at the database you want to clean.');
    process.exit(1);
  }

  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`\nConnected to "${mongoose.connection.name}"`);
  console.log(APPLY ? '\n⚠️  APPLY MODE — this will delete data.\n' : '\nDry run. Nothing will be changed. Add --apply to go ahead.\n');

  /* ── Demo accounts ─────────────────────────────────────────── */

  const demoUsers = await User.find({ email: DEMO_EMAIL }).select('_id name email role').lean();
  const demoIds = demoUsers.map((u) => u._id);

  // A demo account that a REAL user has interacted with is not safe to
  // delete: their booking history, reviews and TeamUp games point at it.
  const demoVenueIds = await Venue.find({ owner: { $in: demoIds } }).distinct('_id');
  const realBookingsAtDemoVenues = await Booking.countDocuments({
    venue: { $in: demoVenueIds },
    user: { $nin: demoIds },
  });

  console.log(`Demo accounts (@gameon.app): ${demoUsers.length}`);
  for (const u of demoUsers) console.log(`   ${u.role.padEnd(6)} ${u.email}`);
  console.log(`Venues owned by them:        ${demoVenueIds.length}`);
  console.log(`Bookings on those venues by real users: ${realBookingsAtDemoVenues}`);

  if (realBookingsAtDemoVenues > 0) {
    console.log(
      '\n⚠️  Real users have booked demo venues. Deleting them would delete a real\n'
      + '   customer’s booking history too. Deactivate those venues and disable the\n'
      + '   demo accounts instead:\n'
      + '     db.venues.updateMany({owner:{$in:[...]}}, {$set:{isActive:false}})\n'
      + '     db.users.updateMany({email:/@gameon\\.app$/}, {$set:{isActive:false},$inc:{tokenVersion:1}})\n'
    );
  }

  /* ── Unclaimed listings ────────────────────────────────────── */

  const unclaimed = await Venue.find({ isClaimed: false }).select('_id name address.city').lean();
  const unclaimedIds = unclaimed.map((v) => v._id);
  const realBookingsAtUnclaimed = await Booking.countDocuments({ venue: { $in: unclaimedIds } });

  console.log(`\nUnclaimed listings:          ${unclaimed.length}`);
  for (const v of unclaimed.slice(0, 5)) console.log(`   ${v.name} (${v.address?.city || '?'})`);
  if (unclaimed.length > 5) console.log(`   …and ${unclaimed.length - 5} more`);
  console.log(`Bookings against them:       ${realBookingsAtUnclaimed}`);

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to delete.\n');
    await mongoose.disconnect();
    return;
  }

  /* ── Delete ────────────────────────────────────────────────── */

  const removed = { users: 0, venues: 0, listings: 0 };

  if (realBookingsAtDemoVenues === 0 && demoIds.length) {
    // Everything that hangs off a demo account, so nothing is left pointing
    // at a user that no longer exists.
    await Promise.all([
      Booking.deleteMany({ user: { $in: demoIds } }),
      Review.deleteMany({ user: { $in: demoIds } }),
      TeamUpPost.deleteMany({ host: { $in: demoIds } }),
      Team.deleteMany({ captain: { $in: demoIds } }),
      Transaction.deleteMany({ user: { $in: demoIds } }),
      Notification.deleteMany({ user: { $in: demoIds } }),
    ]);
    const v = await Venue.deleteMany({ owner: { $in: demoIds } });
    const u = await User.deleteMany({ _id: { $in: demoIds } });
    removed.venues = v.deletedCount;
    removed.users = u.deletedCount;
    console.log(`\nDeleted ${plural(removed.users, 'demo account')} and ${plural(removed.venues, 'venue')}.`);
  } else if (demoIds.length) {
    console.log('\nSkipped the demo accounts — real bookings depend on them (see above).');
  }

  if (!KEEP_UNCLAIMED && unclaimedIds.length) {
    if (realBookingsAtUnclaimed > 0) {
      console.log(`Skipped ${plural(unclaimedIds.length, 'unclaimed listing')} — ${realBookingsAtUnclaimed} booking(s) reference them.`);
    } else {
      const r = await Venue.deleteMany({ _id: { $in: unclaimedIds } });
      removed.listings = r.deletedCount;
      console.log(`Deleted ${plural(removed.listings, 'unclaimed listing')}.`);
    }
  }

  console.log('\nDone.\n');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nFailed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
