/**
 * The API must be able to LOAD in production.
 *
 * This exists because of a real outage. A guard was added to seed/data.js that
 * refuses to create demo accounts in production without SEED_PASSWORD — a
 * correct rule, placed at module scope. `server.js` statically imports
 * `seed/autoSeed.js`, which imports `seed/data.js`, so the throw happened at
 * IMPORT time: the deploy died with "Exited with status 1" before the server
 * had bound a port, and the message talked about seeding while the actual
 * symptom was a dead API.
 *
 * Nothing caught it. `tests/load.test.mjs` imports every module — but it
 * skips `seed/` by design (those files used to open a database connection on
 * import), and it runs under the test environment rather than production. The
 * one directory that was exempt is the one that broke, in the one environment
 * that was never exercised.
 *
 * So this file does two things that file cannot:
 *   - imports the real entry graph with NODE_ENV=production
 *   - checks the guards still fire where they are SUPPOSED to
 *
 * Each case runs in its own child process, because NODE_ENV has to be set
 * before any module reads it and config/env.js snapshots it at import.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = (rel) => pathToFileURL(resolve(backend, rel)).href;

/** Runs a snippet in a fresh process with a controlled environment. */
function inProcess(code, env = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: backend,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // Enough config for env.js to consider itself valid, so a failure here
      // is about module loading rather than about missing variables.
      MONGO_URI: 'mongodb://127.0.0.1:27017/boot_check',
      JWT_SECRET: 'boot_check_secret_that_is_long_enough_here',
      JWT_REFRESH_SECRET: 'boot_check_refresh_secret_long_enough_x',
      CORS_ORIGINS: 'https://example.com',
      APP_URL: 'https://example.com',
      BREVO_API_KEY: 'boot-check-key',
      SMTP_FROM: 'GameOn <no-reply@example.com>',
      SEED_PASSWORD: '',
      SEED_LUCKNOW: '',
      ...env,
    },
  });
}

/* ── The entry graph loads ───────────────────────────────────── */

for (const [name, rel] of [
  ['the Express app', 'src/app.js'],
  ['the auto-seeder server.js imports at boot', 'src/seed/autoSeed.js'],
  ['the seed fixtures', 'src/seed/data.js'],
  ['the seed entry point', 'src/seed/seed.js'],
  ['the route table', 'src/routes/index.js'],
]) {
  test(`${name} imports cleanly in production`, () => {
    const r = inProcess(`await import(${JSON.stringify(url(rel))});`);
    assert.equal(
      r.status, 0,
      `importing ${rel} with NODE_ENV=production failed:\n${r.stderr || r.stdout}`,
    );
  });
}

test('every seed module imports without a database', () => {
  // load.test.mjs skips this directory. Import-safety is exactly the property
  // that mattered, so check it here instead of leaving the gap open.
  const code = [
    'src/seed/data.js', 'src/seed/autoSeed.js', 'src/seed/seed.js', 'src/seed/lucknow.js',
  ].map((f) => `await import(${JSON.stringify(url(f))});`).join('\n');

  const r = inProcess(code);
  assert.equal(r.status, 0, `a seed module threw on import:\n${r.stderr}`);
});

/* ── The guards still fire, just later ───────────────────────── */

test('demoPassword() still refuses to run in production without SEED_PASSWORD', () => {
  // The rule was right; only its timing was wrong. It has to fail when
  // somebody seeds, not when somebody imports.
  const r = inProcess(`
    const { demoPassword } = await import(${JSON.stringify(url('src/seed/data.js'))});
    try { demoPassword(); console.log('NO_THROW'); }
    catch (e) { console.log('THREW:' + e.message); }
  `);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /THREW:Refusing to seed demo accounts in production/, r.stdout);
});

test('demoPassword() returns the configured value when one is set', () => {
  const r = inProcess(`
    const { demoPassword } = await import(${JSON.stringify(url('src/seed/data.js'))});
    console.log('VALUE:' + demoPassword());
  `, { SEED_PASSWORD: 'a-real-one-99' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /VALUE:a-real-one-99/);
});

test('the fixtures carry no baked-in password', () => {
  // The password is injected by whichever seeder runs. If it ever creeps back
  // into the data file, the lazy guard stops being lazy.
  const r = inProcess(`
    const d = await import(${JSON.stringify(url('src/seed/data.js'))});
    const all = [...d.owners, ...d.players];
    console.log('WITHPW:' + all.filter((u) => u.password !== undefined).length);
  `);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WITHPW:0/, 'a fixture still hardcodes a password');
});

/* ── And a genuinely bad config is still refused ─────────────── */

test('a production config with a default secret still refuses to start', () => {
  // The point of the exercise is that misconfiguration fails loudly. Make
  // sure moving the seed guard did not soften anything else.
  const r = inProcess(
    `const { validateEnv } = await import(${JSON.stringify(url('src/config/env.js'))});
     try { validateEnv(); console.log('NO_THROW'); } catch (e) { console.log('THREW'); }`,
    { JWT_SECRET: 'secret' },
  );
  assert.match(r.stdout, /THREW/, 'validateEnv accepted a known-bad secret');
});

/* ── A live gateway needs its webhook secret (GO-03) ─────────── */

/**
 * The browser confirms a capture by calling /payments/verify. When that call
 * never arrives — a dropped connection, a backgrounded tab, a cold start —
 * the webhook is the only thing that reconciles the payment, because Razorpay
 * retries it until we answer. Booting with keys but no webhook secret means
 * silently losing exactly those payments, so it is fatal rather than a
 * warning nobody reads.
 */
const withGateway = (extra = {}) => ({
  RAZORPAY_KEY_ID: 'rzp_live_bootcheck',
  RAZORPAY_KEY_SECRET: 'bootcheck_secret_value',
  ...extra,
});

const validates = (env) => inProcess(
  `const { validateEnv } = await import(${JSON.stringify(url('src/config/env.js'))});
   try { validateEnv(); console.log('NO_THROW'); } catch (e) { console.log('THREW'); }`,
  env,
);

test('a live gateway without a webhook secret refuses to start', () => {
  const r = validates(withGateway());
  assert.match(r.stdout, /THREW/, 'booted with a gateway it cannot reconcile');
  assert.match(r.stderr + r.stdout, /RAZORPAY_WEBHOOK_SECRET/,
    'the operator is told which variable is missing');
});

test('a live gateway with a webhook secret starts', () => {
  const r = validates(withGateway({ RAZORPAY_WEBHOOK_SECRET: 'whsec_bootcheck_value' }));
  assert.match(r.stdout, /NO_THROW/, r.stderr);
});

test('the wallet simulation still needs no webhook secret', () => {
  // No Razorpay keys at all: there is no gateway to reconcile, so the secret
  // is meaningless and demanding it would block every demo deployment.
  const r = validates({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' });
  assert.match(r.stdout, /NO_THROW/, r.stderr);
});
