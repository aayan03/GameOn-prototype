/**
 * Drops the text indexes on `venues`, which nothing queries.
 *
 *   node scripts/fix-text-index.mjs           # show what would change
 *   node scripts/fix-text-index.mjs --apply   # actually change it
 *
 * This script used to CREATE a weighted `venue_search` index, on the
 * assumption that discovery would eventually use it. It never did, and it
 * turns out it never can: `$text` and `$geoNear` are rejected in the same
 * query, `$match: { $text }` is only legal as the first pipeline stage, and
 * `$text` matches whole stemmed words rather than the prefixes a
 * search-as-you-type box sends. See the long note in models/Venue.js.
 *
 * So the index was pure overhead — MongoDB tokenising and stemming four
 * fields on every venue write to maintain something no read path touches —
 * and on databases carrying a legacy `name_text` from an older schema it also
 * produced an IndexOptionsConflict on every startup.
 *
 * Mongoose only ever CREATES indexes, never removes them, so dropping this
 * from the schema does not drop it from a database that already has it. That
 * is what this script is for. It is safe: a text index is derived data, and
 * nothing reads it.
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

const textIndexes = indexes.filter(
  (i) => Object.values(i.key || {}).includes('text') || i.key?._fts === 'text'
);

console.log('Text indexes currently on `venues`:');
if (!textIndexes.length) console.log('  (none)');
for (const i of textIndexes) {
  console.log(`  ${i.name}  weights: ${JSON.stringify(i.weights || {})}`);
}
console.log('');

if (!textIndexes.length) {
  console.log('Nothing to do — this collection carries no text index, which is what the schema wants.\n');
  await mongoose.disconnect();
  process.exit(0);
}

for (const i of textIndexes) console.log(`Would drop: ${i.name}`);

if (!apply) {
  console.log('\nNothing changed. Re-run with --apply to do it.\n');
  await mongoose.disconnect();
  process.exit(0);
}

console.log('');
for (const i of textIndexes) {
  await collection.dropIndex(i.name);
  console.log(`  dropped ${i.name}`);
}

const after = (await collection.indexes())
  .filter((i) => Object.values(i.key || {}).includes('text') || i.key?._fts === 'text')
  .map((i) => i.name);

console.log(`\nDone. Text indexes now: ${after.join(', ') || '(none)'}\n`);

await mongoose.disconnect();
