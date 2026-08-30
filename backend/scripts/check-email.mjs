/**
 * Checks your email setup before you put it anywhere near Render.
 *
 *   node scripts/check-email.mjs                 # test the configuration
 *   node scripts/check-email.mjs you@gmail.com   # ...and send a real message
 *
 * Reads backend/.env. The point is finding out that something is wrong here,
 * on your machine, in ten seconds — rather than at the moment a locked-out
 * customer is waiting for a reset link.
 */

import 'dotenv/config';
import { transport, verifyConnection, deliver } from '../src/services/email.service.js';
import env from '../src/config/env.js';

const red = (t) => `\x1b[31m${t}\x1b[0m`;
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const dim = (t) => `\x1b[2m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

console.log(bold('\nChecking email settings in backend/.env\n'));

const mode = transport();

if (mode === 'console') {
  console.log(red('  No email transport configured.\n'));
  console.log('  Set ONE of these:\n');
  console.log(`  ${bold('BREVO_API_KEY')}   ${dim('recommended - free 300/day, sends over HTTPS')}`);
  console.log(`  ${bold('RESEND_API_KEY')}  ${dim('also HTTPS; needs a verified domain to reach any address')}`);
  console.log(`  ${bold('SMTP_HOST + SMTP_USER + SMTP_PASSWORD')}  ${dim('blocked on most free hosts')}\n`);
  console.log(dim('  The HTTPS providers are the safe choice: Render, Railway and Fly all'));
  console.log(dim('  block outbound SMTP ports on their free tiers.\n'));
  process.exit(1);
}

/* ── What is about to be used ────────────────────────────────── */

const mask = (v) => (v
  ? '•'.repeat(Math.min(String(v).length, 24)) + dim(` (${String(v).length} chars)`)
  : dim('(not set)'));

console.log(`  transport  ${bold(mode)}`);
if (mode === 'brevo') console.log(`  api key    ${mask(env.BREVO_API_KEY)}`);
if (mode === 'resend') console.log(`  api key    ${mask(env.RESEND_API_KEY)}`);
if (mode === 'smtp') {
  console.log(`  host       ${env.SMTP_HOST}`);
  console.log(`  port       ${env.SMTP_PORT} ${dim(env.SMTP_PORT === 465 ? '(implicit TLS)' : '(STARTTLS)')}`);
  console.log(`  user       ${env.SMTP_USER}`);
  console.log(`  password   ${mask(env.SMTP_PASSWORD)}`);
}
console.log(`  from       ${env.SMTP_FROM || dim('(default)')}\n`);

/* ── Example values pasted in unchanged ──────────────────────── */

const placeholder = /REPLACE_ME|your-provider|your-username|your-password|yourdomain/i;
const suspect = Object.entries({
  BREVO_API_KEY: env.BREVO_API_KEY,
  RESEND_API_KEY: env.RESEND_API_KEY,
  SMTP_HOST: env.SMTP_HOST,
  SMTP_USER: env.SMTP_USER,
  SMTP_PASSWORD: env.SMTP_PASSWORD,
  SMTP_FROM: env.SMTP_FROM,
}).filter(([, v]) => v && placeholder.test(v));

if (suspect.length) {
  console.log(red(`  Still the example text: ${suspect.map(([k]) => k).join(', ')}`));
  console.log(dim('  Replace these with the real values from your provider.\n'));
  process.exit(1);
}

/* ── Verify ──────────────────────────────────────────────────── */

const ok = await verifyConnection();

if (mode === 'smtp' && !ok) {
  console.log(red('  x Could not reach the mail server.\n'));
  console.log('  If that was a timeout, the port is blocked - the password is probably fine.');
  console.log(dim('  Free hosting tiers block outbound SMTP. Set BREVO_API_KEY instead:'));
  console.log(dim('  same idea, sent over HTTPS, which nothing blocks.\n'));
  process.exit(1);
}

console.log(green(`  OK  ${mode === 'smtp' ? 'Connected and signed in.' : 'Credentials present, transport ready.'}`));
console.log(mode === 'smtp' ? '' : dim('      An API key is only really proven by sending, so do that next.\n'));

/* ── Optionally prove it end to end ──────────────────────────── */

const to = process.argv[2];
if (!to) {
  console.log(dim('  Send a real test message:'));
  console.log(dim('    node scripts/check-email.mjs you@example.com\n'));
  process.exit(0);
}

console.log(`  Sending a test message to ${to} ...`);

const result = await deliver({
  to,
  subject: 'GameOn - email is working',
  text: 'If you are reading this, your email settings are correct.\n\n'
      + 'Password reset emails will reach your customers.\n',
  html: '<p>If you are reading this, your email settings are correct.</p>'
      + '<p>Password reset emails will reach your customers.</p>',
});

if (result.delivered) {
  console.log(green('  OK  Sent.\n'));
  console.log(dim('  Check the inbox - and the spam folder, which is where a brand new'));
  console.log(dim('  sender usually lands until it builds a reputation.\n'));
  process.exit(0);
}

console.log(red('  x The send was refused.\n'));
console.log(`  ${dim(result.error || 'no detail returned')}\n`);

if (/sender|from|not verified|unauthorized|403/i.test(result.error || '')) {
  console.log('  The From address is not one this account may send as.');
  console.log(dim('  Verify that address with your provider, then set SMTP_FROM to it.\n'));
}
process.exit(1);
