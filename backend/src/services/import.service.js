import {
  User, Venue, Booking, Review, TeamUpPost, Team, Transaction, Notification,
} from '../models/index.js';
import { lucknowVenues, lucknowOwner } from '../seed/lucknow.js';
import logger from '../utils/logger.js';

/**
 * Swapping the demo data for real Lucknow listings, on a live database.
 *
 * This exists as a service rather than only as a script because the script
 * cannot reach production: seeding runs from a laptop, and a network whose
 * DNS refuses SRV lookups cannot resolve an Atlas `mongodb+srv://` host at
 * all — while this server, already connected to that cluster, can. Same
 * reasoning as routes/cron.routes.js.
 *
 * ── What these listings are, and are not ──────────────────────────────
 *
 * The venue NAMES and LOCALITIES are real businesses taken from public
 * directory listings. The PRICES, opening hours, court layouts and exact
 * coordinates are NOT. See the header of seed/lucknow.js.
 *
 * Three things make publishing them defensible rather than reckless, and all
 * three have to stay true:
 *
 *   1. `isClaimed: false` — the venue page shows an "Unclaimed listing"
 *      notice saying details are unconfirmed. Never set this true here; only
 *      the venue claiming it should flip it.
 *   2. `bookingMode: 'manual'` — an assisted booking takes NO money until
 *      somebody confirms it. A request against a venue that has never heard
 *      of us simply expires unanswered, which costs the player nothing.
 *      Instant booking would charge a card for a slot nobody can honour.
 *   3. `rating: 0` and no reviews. Inventing an endorsement a business never
 *      gave is different in kind from estimating a price, and worse.
 *
 * It is still on you to contact these venues. This gets a real city onto the
 * map so there is something to show them; it is not a substitute for the
 * conversation.
 */

const LUCKNOW_OWNER_EMAIL = lucknowOwner.email;

/** Demo accounts, EXCLUDING the Lucknow operations account. */
const DEMO_USER_FILTER = {
  email: { $regex: /@gameon\.app$/i, $ne: LUCKNOW_OWNER_EMAIL },
};

/**
 * Clears the fictional venues and the accounts that own them.
 *
 * The Lucknow ops account shares the @gameon.app domain, so a naive sweep by
 * email takes the real listings out with the fake ones — which is exactly
 * what scripts/purge-demo-data.mjs does if you run it before importing.
 * Hence the explicit exclusion above.
 *
 * Anything a real person has actually booked is left alone and reported.
 * Deleting those would take a paying customer's history with them.
 */
export async function purgeDemoData({ apply = false } = {}) {
  const demoUsers = await User.find(DEMO_USER_FILTER).select('_id email').lean();
  const demoIds = demoUsers.map((u) => u._id);
  const demoVenueIds = await Venue.find({ owner: { $in: demoIds } }).distinct('_id');

  // A booking made by somebody who is not themselves a demo account.
  const realBookings = await Booking.countDocuments({
    venue: { $in: demoVenueIds },
    user: { $nin: demoIds },
  });

  const report = {
    demoUsers: demoUsers.length,
    demoVenues: demoVenueIds.length,
    realBookingsAtDemoVenues: realBookings,
    deleted: false,
  };

  if (realBookings > 0) {
    report.refused = `${realBookings} real booking(s) exist at demo venues — nothing was deleted. `
      + 'Those are somebody\'s paid fixtures and their history goes with the venue.';
    return report;
  }

  if (!apply) return report;

  await Promise.all([
    Booking.deleteMany({ user: { $in: demoIds } }),
    Review.deleteMany({ user: { $in: demoIds } }),
    TeamUpPost.deleteMany({ host: { $in: demoIds } }),
    Team.deleteMany({ captain: { $in: demoIds } }),
    Transaction.deleteMany({ user: { $in: demoIds } }),
    Notification.deleteMany({ user: { $in: demoIds } }),
  ]);
  await Venue.deleteMany({ owner: { $in: demoIds } });
  await User.deleteMany({ _id: { $in: demoIds } });

  report.deleted = true;
  return report;
}

/**
 * Publishes the first `limit` Lucknow listings.
 *
 * Idempotent: matched on (name, city), so re-running updates rather than
 * duplicating. A venue somebody has already claimed is skipped entirely —
 * once a real owner is behind a listing, an import must never overwrite what
 * they have set.
 */
export async function importLucknow({ limit = 10, apply = false } = {}) {
  const chosen = lucknowVenues.slice(0, limit);

  const report = {
    considered: chosen.length,
    created: 0,
    updated: 0,
    skippedClaimed: [],
    applied: apply,
    names: chosen.map((v) => v.name),
  };

  if (!apply) return report;

  // One shared account owns the unclaimed listings until each venue claims
  // its own. It cannot be logged into — no password is set on it.
  let owner = await User.findOne({ email: LUCKNOW_OWNER_EMAIL });
  if (!owner) owner = await User.create({ ...lucknowOwner, isVerified: true });

  for (const v of chosen) {
    const { ownerEmail: _o, lat, lng, ...rest } = v;
    const existing = await Venue.findOne({ name: v.name, 'address.city': 'Lucknow' });

    if (existing?.isClaimed) {
      report.skippedClaimed.push(v.name);
      continue;
    }

    const doc = {
      ...rest,
      owner: owner._id,
      location: { type: 'Point', coordinates: [lng, lat] },
      // Restated rather than inherited, because every one of these is load
      // bearing — see the note at the top of this file.
      isClaimed: false,
      isVerified: false,
      rating: 0,
      reviewCount: 0,
      moderationStatus: 'approved',
      isActive: true,
    };

    if (existing) {
      Object.assign(existing, doc);
      await existing.save();
      report.updated += 1;
    } else {
      await Venue.create(doc);
      report.created += 1;
    }
  }

  logger.warn('imported unclaimed Lucknow listings - contact each venue before relying on them', {
    created: report.created, updated: report.updated,
  });

  return report;
}
