/**
 * Checks your SMTP credentials before you put them anywhere near Render.
 *
 *   node scripts/check-email.mjs                 # just test the connection
 *   node scripts/check-email.mjs you@gmail.com   # ...and send yourself a real one
 *
 * Reads backend/.env, so fill that in first. The point is to find out that a
 * password is wrong here, on your machine, in ten seconds — rather than at the
 * moment a locked-out customer is waiting for a reset link.
 */

import 'dotenv/config';
import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

console.log(bold('\nChecking SMTP settings in backend/.env\n'));

/* ── 1. Are they even filled in? ─────────────────────────────── */

const missing = [];
if (!SMTP_HOST) missing.push('SMTP_HOST');
if (!SMTP_USER) missing.push('SMTP_USER');
if (!SMTP_PASSWORD) missing.push('SMTP_PASSWORD');

if (missing.length) {
  console.log(red(`  Missing: ${missing.join(', ')}`));
  console.log(dim('\n  These come from a mail provider — they are not values you invent.'));
  console.log(dim('  Sign up somewhere (Brevo and Resend have free tiers), find the'));
  console.log(dim('  page called "SMTP" or "SMTP & API", and copy what it shows you.\n'));
  process.exit(1);
}

// Catch the most common mistake: pasting the example straight in.
const placeholders = [/your-provider/i, /your-username/i, /your-password/i, /yourdomain/i, /example\.com$/i];
const stillPlaceholder = Object.entries({ SMTP_HOST, SMTP_USER, SMTP_PASSWORD })
  .filter(([, v]) => placeholders.some((p) => p.test(v)));

if (stillPlaceholder.length) {
  console.log(red(`  Still the example text: ${stillPlaceholder.map(([k]) => k).join(', ')}`));
  console.log(dim('\n  Replace these with the real values from your provider.\n'));
  process.exit(1);
}

const port = Number(SMTP_PORT) || 587;
console.log(`  host      ${SMTP_HOST}`);
console.log(`  port      ${port} ${dim(port === 465 ? '(implicit TLS)' : '(STARTTLS)')}`);
console.log(`  user      ${SMTP_USER}`);
console.log(`  password  ${'•'.repeat(Math.min(String(SMTP_PASSWORD).length, 24))} ${dim(`(${String(SMTP_PASSWORD).length} chars)`)}`);
console.log(`  from      ${SMTP_FROM || dim('(not set — a default will be used)')}\n`);

/* ── 2. Do they actually work? ───────────────────────────────── */

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
});

try {
  await transport.verify();
  console.log(green('  ✓ Connected and signed in successfully.\n'));
} catch (err) {
  console.log(red('  ✗ Could not sign in.\n'));
  console.log(`  ${dim(err.message)}\n`);

  // Translate the errors people actually hit into what to do about them.
  const m = String(err.message).toLowerCase();
  if (m.includes('invalid login') || m.includes('authentication') || err.code === 'EAUTH') {
    console.log('  The host was reached but the username or password was rejected.');
    console.log(dim('  Most often: the account password was used instead of the SMTP key.'));
    console.log(dim('  Providers issue a separate key for SMTP — look for "SMTP key",'));
    console.log(dim('  "Master password" or "App password" and use that.\n'));
  } else if (err.code === 'ENOTFOUND' || m.includes('getaddrinfo')) {
    console.log('  That hostname does not resolve — check SMTP_HOST for a typo.');
    console.log(dim('  It should look like smtp-relay.brevo.com, not a web address.\n'));
  } else if (err.code === 'ETIMEDOUT' || m.includes('timeout')) {
    console.log('  The connection timed out. Usually the wrong port, or a firewall.');
    console.log(dim('  Try 587 if you used 465, or the other way round.\n'));
  } else if (m.includes('self signed') || m.includes('certificate')) {
    console.log('  A TLS certificate problem — check the port matches the host.\n');
  }
  process.exit(1);
}

/* ── 3. Optionally prove it end to end ───────────────────────── */

const to = process.argv[2];
if (!to) {
  console.log(dim('  Tip: pass your email address to send a real test message —'));
  console.log(dim('       node scripts/check-email.mjs you@example.com\n'));
  process.exit(0);
}

console.log(`  Sending a test message to ${to}…`);

try {
  const info = await transport.sendMail({
    from: SMTP_FROM || `GameOn <${SMTP_USER}>`,
    to,
    subject: 'GameOn — SMTP is working',
    text: 'If you are reading this, your SMTP settings are correct.\n\n'
        + 'Password reset emails will reach your customers.\n',
  });
  console.log(green(`  ✓ Sent. Message id ${info.messageId}\n`));
  console.log(dim('  Check the inbox — and the spam folder, which is where a brand new'));
  console.log(dim('  sending domain usually lands until it builds a reputation.\n'));
} catch (err) {
  console.log(red('  ✗ Signed in, but the send was refused.\n'));
  console.log(`  ${dim(err.message)}\n`);
  if (/from|sender|not verified|unauthorized/i.test(err.message)) {
    console.log('  The From address is not one this account is allowed to send as.');
    console.log(dim('  On a free tier you usually must verify the sender address first.'));
    console.log(dim('  Set SMTP_FROM to the address you verified with the provider.\n'));
  }
  process.exit(1);
}
