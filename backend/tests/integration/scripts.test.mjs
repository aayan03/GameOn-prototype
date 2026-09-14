/**
 * The operational scripts, exercised against a real database.
 *
 * Both of these are run by hand against PRODUCTION data — one promotes an
 * admin, the other deletes demo accounts and unclaimed listings. A script
 * that is only ever run in anger is a script nobody has tested, so they are
 * driven here as child processes exactly the way an operator would run them.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startTestServer, stopTestServer, createUser } from '../helpers/harness.mjs';
before(startTestServer); after(stopTestServer);

const run = (script, args) => spawnSync(process.execPath, [resolve('scripts', script), ...args], {
  encoding: 'utf8', env: { ...process.env, MONGO_URI: process.env.MONGO_URI },
});

/**
 * Runs `fn` without letting it write to stdout.
 *
 * Under `node --test`, a test file's stdout is not a terminal: it is the pipe
 * the runner reads that file's results back through. The seeder narrates its
 * progress there, and text landing between results intermittently corrupts
 * the stream — the run fails with "Unable to deserialize cloned data due to
 * invalid or unsupported version" against this whole file, and the tests
 * after the corruption are reported as never having run. That was a CI
 * failure that came and went at random.
 *
 * Checked in isolation on Node 22 and 24: a file logging between tests failed
 * every run, the same output sent to stderr never did, and silenced it never
 * did. So only the stdout methods are muted; warn and error go to stderr and
 * stay visible if something genuinely goes wrong.
 */
async function quietly(fn) {
  const { log, info, debug } = console;
  console.log = console.info = console.debug = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { log, info, debug });
  }
}

test('make-admin promotes an existing account', async () => {
  const u = await createUser({ role: 'player' });
  const dry = run('make-admin.mjs', [u.email]);
  assert.match(dry.stdout, /player\s+→\s+admin/, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /Dry run/);

  const applied = run('make-admin.mjs', [u.email, '--apply']);
  assert.match(applied.stdout, /is now admin/, applied.stdout + applied.stderr);

  const { User } = await import('../../src/models/index.js');
  const after = await User.findById(u.id).lean();
  assert.equal(after.role, 'admin');
  assert.equal(after.tokenVersion, 1, 'old sessions retired so the role takes effect');
});

test('make-admin refuses an unknown address', () => {
  const r = run('make-admin.mjs', ['nobody@example.com', '--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No account with the email/);
});

test('purge-demo-data dry run reports without deleting', async () => {
  const { seedDatabase } = await import('../../src/seed/seed.js');
  await quietly(() => seedDatabase({ connect: false }));
  const { User } = await import('../../src/models/index.js');
  const before = await User.countDocuments({ email: /@gameon\.app$/ });
  assert.ok(before > 0, 'demo accounts seeded');

  const r = run('purge-demo-data.mjs', []);
  assert.match(r.stdout, /Demo accounts \(@gameon\.app\)/, r.stdout + r.stderr);
  assert.match(r.stdout, /Dry run complete/);
  assert.equal(await User.countDocuments({ email: /@gameon\.app$/ }), before, 'nothing deleted');
});

test('purge-demo-data --apply removes them', async () => {
  const { User, Venue } = await import('../../src/models/index.js');
  const r = run('purge-demo-data.mjs', ['--apply']);
  assert.match(r.stdout, /Deleted \d+ demo accounts/, r.stdout + r.stderr);
  assert.equal(await User.countDocuments({ email: /@gameon\.app$/ }), 0);
  assert.equal(await Venue.countDocuments({ isClaimed: false }), 0);
});
