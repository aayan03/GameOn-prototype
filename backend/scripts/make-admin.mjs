/**
 * Promotes an existing account to admin.
 *
 * The `admin` role is deliberately not assignable through any API — not at
 * registration, not through the profile endpoint, not by another admin. A bug
 * in a signup path can therefore never mint one. The flip side is that a
 * fresh deployment has NO admin at all, so nobody can moderate venue
 * submissions, suspend an abusive account or run a payout until someone sets
 * the first one directly in the database.
 *
 * This is that step, without needing a mongosh session or the exact field
 * names in your head.
 *
 * Usage:
 *   node scripts/make-admin.mjs you@example.com            # dry run
 *   node scripts/make-admin.mjs you@example.com --apply
 *   node scripts/make-admin.mjs you@example.com --apply --demote
 *
 * Register the account through the normal signup flow first — this promotes,
 * it does not create, so the password is one you chose and never one this
 * script knows.
 */

import mongoose from 'mongoose';
import env from '../src/config/env.js';
import { User } from '../src/models/index.js';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
const APPLY = args.includes('--apply');
const DEMOTE = args.includes('--demote');

async function main() {
  if (!email) {
    console.error('\nUsage: node scripts/make-admin.mjs <email> [--apply] [--demote]\n');
    process.exit(1);
  }
  if (!env.MONGO_URI) {
    console.error('\nMONGO_URI is not set. Point it at the database you want to change.\n');
    process.exit(1);
  }

  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`\nConnected to "${mongoose.connection.name}"`);

  const user = await User.findOne({ email }).select('name email role isActive').lean();
  if (!user) {
    console.error(
      `\nNo account with the email ${email}.\n`
      + 'Sign up through the app first, then run this again — this promotes an\n'
      + 'existing account rather than creating one, so the password stays yours.\n'
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const target = DEMOTE ? 'player' : 'admin';
  console.log(`\n  ${user.name} <${user.email}>`);
  console.log(`  role: ${user.role}  →  ${target}`);
  if (!user.isActive) console.log('  ⚠️  this account is currently suspended');

  if (user.role === target) {
    console.log(`\nAlready ${target}. Nothing to do.\n`);
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    console.log('\nDry run. Add --apply to make the change.\n');
    await mongoose.disconnect();
    return;
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: { role: target },
      // Retire existing sessions so the new role is picked up on the next
      // login rather than whenever their current token happens to expire —
      // the role is baked into the access token when it is signed.
      $inc: { tokenVersion: 1 },
    }
  );

  console.log(
    `\n✅ ${user.email} is now ${target}.\n`
    + '   They have been signed out everywhere; the new role applies on their next login.\n'
    + (target === 'admin' ? '   The admin console is at /admin.\n' : '')
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nFailed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
