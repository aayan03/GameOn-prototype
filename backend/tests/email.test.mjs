/**
 * Email transport selection.
 *
 * These exist because getting this wrong is invisible until a customer is
 * locked out: the server boots, the log looks healthy, and nothing is ever
 * delivered. The Render deployment failed in exactly that way — SMTP
 * configured, port blocked by the host, timeout only at send time.
 *
 * Each case runs in its own process. `config/env.js` snapshots the
 * environment once at import, and dotenv fills any gap from the real .env, so
 * re-importing inside one process would keep handing back the first result.
 * A subprocess is the only way to genuinely control what the module sees.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let pass = 0;
let fail = 0;

const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
};

/**
 * Runs one expression against a controlled environment.
 *
 * Empty strings rather than deletions: dotenv only fills variables that are
 * absent, so deleting one lets the real .env put it straight back.
 */
function evaluate(expression, vars = {}) {
  const blank = {
    BREVO_API_KEY: '', RESEND_API_KEY: '',
    SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: '',
  };
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e',
      `import * as email from './src/services/email.service.js';
       console.log(String(${expression}));`],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...blank, ...vars, LOG_LEVEL_APP: 'silent' },
    },
  );
  return out.trim().split('\n').pop().trim();
}

console.log('\n── transport selection ──');

ok('nothing configured falls back to console',
  evaluate('email.transport()') === 'console');

ok('and reports itself unconfigured',
  evaluate('email.isConfigured()') === 'false');

ok('SMTP variables select smtp',
  evaluate('email.transport()', {
    SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'a@b.com', SMTP_PASSWORD: 'x',
  }) === 'smtp');

ok('a Resend key selects resend',
  evaluate('email.transport()', { RESEND_API_KEY: 're_test' }) === 'resend');

ok('a Brevo key selects brevo',
  evaluate('email.transport()', { BREVO_API_KEY: 'xkeysib-test' }) === 'brevo');

// The whole reason the HTTP transports exist: they must win, because SMTP is
// the one that silently fails on a host that blocks the port.
ok('HTTP wins when both are configured',
  evaluate('email.transport()', {
    BREVO_API_KEY: 'xkeysib-test',
    SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'a@b.com', SMTP_PASSWORD: 'x',
  }) === 'brevo');

ok('a half-configured SMTP is not mistaken for a working one',
  evaluate('email.transport()', { SMTP_HOST: 'smtp.gmail.com' }) === 'console');

console.log('\n── production refuses to boot without a transport ──');

/** Does validateEnv() accept this production configuration? */
function boots(vars) {
  const base = {
    NODE_ENV: 'production',
    MONGO_URI: 'mongodb+srv://u:p@cluster0.abc.mongodb.net/gameon',
    JWT_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    CORS_ORIGINS: 'https://example.com',
    BREVO_API_KEY: '', RESEND_API_KEY: '',
    SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '',
  };
  try {
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e',
        "import { validateEnv } from './src/config/env.js'; validateEnv();"],
      { cwd: root, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...base, ...vars } },
    );
    return true;
  } catch {
    return false;
  }
}

ok('refuses with no email transport at all', !boots({}));
ok('accepts a Brevo key alone', boots({ BREVO_API_KEY: 'xkeysib-test' }));
ok('accepts a Resend key alone', boots({ RESEND_API_KEY: 're_test' }));
ok('accepts full SMTP alone', boots({
  SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'a@b.com', SMTP_PASSWORD: 'x',
}));
ok('still refuses a half-configured SMTP', !boots({ SMTP_HOST: 'smtp.gmail.com' }));

console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0, `${fail} email transport test(s) failed`);
