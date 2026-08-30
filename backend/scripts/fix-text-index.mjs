/**
 * Replaces a legacy single-field text index with the compound search index.
 *
 *   node scripts/fix-text-index.mjs           # show what would change
 *   node scripts/fix-text-index.mjs --apply   # actually change it
 *
 * MongoDB allows exactly one text index per collection and will not alter one
 * in place. An older build of this app declared `index: 'text'` on Venue.name,
 * which created `name_text`; the current schema wants a weighted index across
 * name, description, area and city. On any database created before that
 * change, the new index cannot build and every startup logs an
 * IndexOptionsConflict.
 *
 * Dropping a text index is safe — it is derived data, rebuilt from the
 * documents, and this collection holds tens of venues, not millions. Nothing
 * currently queries with `$text` (discovery uses an escaped regex), so even
 * the seconds while it is absent change nothing user-facing.
 *
 * Deliberately a script rather than something the server does on boot: an app
 * that silently drops indexes at startup is a much worse idea than a one-line
 * command run on purpose.
 */

import mongoose from 'mongoose';
import env from '../src/config/env.js';
import { Venue } from '../src/models/index.js';

const apply = process.argv.includes('--apply');

if (!env.MONGO_URI) {
  console.error('\nMONGO_URI is not set. Point it at the database you want to fix:\n');
  console.error('  MONGO_URI="mongodb+srv://..." node scripts/fix-text-index.mjs\n');
  process.exit(1);
}

await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
console.log(`\nConnected to ${mongoose.connection.name}\n`);

const collection = Venue.collection;
const indexes = await collection.indexes();

const textIndexes = indexes.filter((i) => Object.values(i.key || {}).includes('text') || i.key?._fts === 'text');

console.log('Text indexes currently on `venues`:');
if (!textIndexes.length) console.log('  (none)');
for (const i of textIndexes) {
  console.log(`  ${i.name}  weights: ${JSON.stringify(i.weights || {})}`);
}

const WANTED = 'venue_search';
const stale = textIndexes.filter((i) => i.name !== WANTED);
const alreadyRight = textIndexes.some((i) => i.name === WANTED);

console.log('');

if (alreadyRight && !stale.length) {
  console.log(`Nothing to do — "${WANTED}" is present and is the only text index.\n`);
  await mongoose.disconnect();
  process.exit(0);
}

if (!stale.length && !alreadyRight) {
  console.log(`No text index at all. Creating "${WANTED}".`);
}

for (const i of stale) {
  console.log(`Would drop:   ${i.name}`);
}
if (!alreadyRight) console.log(`Would create: ${WANTED} (name, description, address.area, address.city)`);

if (!apply) {
  console.log('\nNothing changed. Re-run with --apply to do it.\n');
  await mongoose.disconnect();
  process.exit(0);
}

console.log('');
for (const i of stale) {
  await collection.dropIndex(i.name);
  console.log(`  dropped ${i.name}`);
}

if (!alreadyRight) {
  await collection.createIndex(
    { name: 'text', description: 'text', 'address.area': 'text', 'address.city': 'text' },
    { weights: { name: 10, 'address.area': 5, 'address.city': 5, description: 1 }, name: WANTED },
  );
  console.log(`  created ${WANTED}`);
}

const after = (await collection.indexes())
  .filter((i) => Object.values(i.key || {}).includes('text') || i.key?._fts === 'text')
  .map((i) => i.name);

console.log(`\nDone. Text indexes now: ${after.join(', ') || '(none)'}\n`);

await mongoose.disconnect();
