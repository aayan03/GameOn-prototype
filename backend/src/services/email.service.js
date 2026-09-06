/**
 * Transactional email.
 *
 * Three transports, picked automatically by whichever credentials are present:
 *
 *   brevo   — HTTPS POST to Brevo's API        (BREVO_API_KEY)
 *   resend  — HTTPS POST to Resend's API       (RESEND_API_KEY)
 *   smtp    — a real SMTP conversation         (SMTP_HOST + SMTP_USER)
 *   console — prints the message, development only
 *
 * The HTTP transports exist because of a concrete deployment problem, not for
 * variety. Render's free tier — and most other free hosts — block outbound
 * connections on the SMTP ports (25, 465, 587) to stop the platform being used
 * for spam. The symptom is distinctive: `ETIMEDOUT` while connecting, rather
 * than a `535` rejection, because the packets never leave the network. The
 * same credentials work perfectly from a laptop, which makes it look like a
 * code problem when it is a firewall.
 *
 * Both HTTP APIs are a single authenticated POST over 443, which nothing
 * blocks. No SDK, for the same reason the Razorpay integration has none: it
 * would be a dependency wrapping one `fetch`.
 */

import nodemailer from 'nodemailer';
import env, { isProd } from '../config/env.js';
import logger from '../utils/logger.js';

/* ── Which transport? ────────────────────────────────────────── */

export function transport() {
  if (env.BREVO_API_KEY) return 'brevo';
  if (env.RESEND_API_KEY) return 'resend';
  if (env.SMTP_HOST && env.SMTP_USER) return 'smtp';
  return 'console';
}

export const isConfigured = () => transport() !== 'console';

let verified = null;
export const isVerified = () => verified;

/* ── Sender identity ─────────────────────────────────────────── */

/**
 * Splits `GameOn <no-reply@x.com>` into its parts. The HTTP APIs want the
 * name and address separately; SMTP takes the combined string.
 */
function parseFrom() {
  const raw = env.SMTP_FROM || 'GameOn <no-reply@gameon.app>';
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: (m[1] || 'GameOn').replace(/^"|"$/g, ''), email: m[2].trim() };
  return { name: 'GameOn', email: raw.trim() };
}

/* ── SMTP ────────────────────────────────────────────────────── */

let smtpTransport = null;

function getSmtp() {
  if (smtpTransport) return smtpTransport;
  smtpTransport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is implicit TLS; 587 and 25 start plaintext and upgrade via
    // STARTTLS. Getting this backwards is the usual cause of a hang.
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    pool: true,
    maxConnections: 3,
  });
  return smtpTransport;
}

/* ── HTTP providers ──────────────────────────────────────────── */

async function postJson(url, headers, body, provider) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(`${provider} unreachable: ${err.message}`);
  }

  const text = await res.text();
  if (!res.ok) {
    // Providers return a JSON error with a useful message; fall back to the
    // raw body if it is not JSON.
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j.message || j.error?.message || j.code || detail;
    } catch { /* keep the raw text */ }
    throw new Error(`${provider} rejected the message (${res.status}): ${detail}`);
  }

  try { return JSON.parse(text); } catch { return {}; }
}

async function sendViaBrevo({ to, subject, text, html }) {
  const from = parseFrom();
  const json = await postJson(
    'https://api.brevo.com/v3/smtp/email',
    { 'api-key': env.BREVO_API_KEY },
    {
      sender: { name: from.name, email: from.email },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    },
    'Brevo',
  );
  return json.messageId || 'sent';
}

async function sendViaResend({ to, subject, text, html }) {
  const from = parseFrom();
  const json = await postJson(
    'https://api.resend.com/emails',
    { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    { from: `${from.name} <${from.email}>`, to: [to], subject, text, html },
    'Resend',
  );
  return json.id || 'sent';
}

/* ── Boot check ──────────────────────────────────────────────── */

/**
 * Confirms email can actually go out, at boot rather than at the moment a
 * locked-out user depends on it.
 *
 * For the HTTP providers this only checks that a key is present — sending a
 * real message to prove it would mean emailing somebody on every deploy.
 * SMTP gets a genuine connection test, because that is the transport that
 * silently fails on a blocked port.
 */
export async function verifyConnection() {
  const mode = transport();

  if (mode === 'console') {
    if (isProd()) {
      logger.warn('No email transport configured — password reset cannot be delivered. Set BREVO_API_KEY, RESEND_API_KEY, or the SMTP_ variables.');
    }
    verified = false;
    return false;
  }

  if (mode !== 'smtp') {
    logger.info('Email ready', { transport: mode, from: parseFrom().email });
    verified = true;
    return true;
  }

  try {
    await getSmtp().verify();
    verified = true;
    logger.info('Email ready', { transport: 'smtp', host: env.SMTP_HOST, port: env.SMTP_PORT });
    return true;
  } catch (err) {
    verified = false;
    const blocked = err.code === 'ETIMEDOUT' || /timeout/i.test(err.message || '');
    if (blocked) {
      // The single most useful line this log can carry. Without it the stack
      // trace sends people off re-checking a password that was never wrong.
      logger.error(
        'SMTP timed out — this host almost certainly blocks outbound SMTP ports. '
        + 'Free tiers on Render, Railway and Fly all do. The credentials are probably fine; '
        + 'switch to an HTTP provider by setting BREVO_API_KEY or RESEND_API_KEY, which send over 443.',
        { host: env.SMTP_HOST, port: env.SMTP_PORT },
      );
    } else {
      logger.error('SMTP verification failed — email will not be delivered', { err });
    }
    return false;
  }
}

/* ── Send ────────────────────────────────────────────────────── */

/**
 * Sends one message.
 *
 * Returns `{ delivered, mode }` rather than throwing, so a caller can decide
 * whether email is essential to its flow. Password reset treats a failure as
 * fatal; a booking receipt does not.
 */
export async function deliver({ to, subject, text, html }) {
  if (!to || !subject) return { delivered: false, mode: 'invalid' };

  const mode = transport();

  if (mode === 'console') {
    // Development: print it. A reset link you can click out of the terminal
    // beats a silent no-op, and this cannot run in production — validateEnv
    // refuses to boot without a transport.
    logger.info('email (not sent — no transport configured)', { to, subject, preview: text?.slice(0, 400) });
    return { delivered: false, mode: 'console' };
  }

  try {
    let id;
    if (mode === 'brevo') id = await sendViaBrevo({ to, subject, text, html });
    else if (mode === 'resend') id = await sendViaResend({ to, subject, text, html });
    else {
      const info = await getSmtp().sendMail({ from: env.SMTP_FROM || `GameOn <${env.SMTP_USER}>`, to, subject, text, html });
      id = info.messageId;
    }
    logger.info('email sent', { to, subject, transport: mode, messageId: id });
    return { delivered: true, mode };
  } catch (err) {
    logger.error('email delivery failed', { err, to, subject, transport: mode });
    return { delivered: false, mode: 'error', error: err.message };
  }
}

/* ── Templates ───────────────────────────────────────────────── */

const wrap = (title, body) => `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F7F5EF;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#16162B">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:2px solid #16162B;border-radius:18px;overflow:hidden">
    <div style="background:#16162B;padding:20px 26px">
      <span style="color:#D6FF3F;font-size:20px;font-weight:800;letter-spacing:-.02em">GameOn</span>
    </div>
    <div style="padding:26px">
      <h1 style="margin:0 0 14px;font-size:20px">${title}</h1>
      ${body}
    </div>
    <div style="padding:16px 26px;border-top:1px solid #E8E4DA;font-size:12px;color:#78748A">
      You received this because someone used this address on GameOn.
    </div>
  </div>
</body></html>`;

const button = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:#D6FF3F;color:#16162B;text-decoration:none;font-weight:700;padding:13px 22px;border:2px solid #16162B;border-radius:12px">${label}</a>`;

export function passwordResetEmail({ name, url, expiresMinutes }) {
  return {
    subject: 'Reset your GameOn password',
    text:
      `Hi ${name},\n\n`
      + `Someone asked to reset the password on your GameOn account.\n\n`
      + `Open this link to choose a new one:\n${url}\n\n`
      + `The link works once and expires in ${expiresMinutes} minutes.\n\n`
      + `If this wasn't you, ignore this email — your password has not changed.\n`,
    html: wrap('Reset your password', `
      <p style="margin:0 0 16px;line-height:1.6">Hi ${escapeHtml(name)}, someone asked to reset the password on your GameOn account.</p>
      <p style="margin:0 0 20px">${button(url, 'Choose a new password')}</p>
      <p style="margin:0 0 10px;font-size:13px;color:#4A4658;line-height:1.6">
        The link works once and expires in ${expiresMinutes} minutes.
      </p>
      <p style="margin:0;font-size:13px;color:#4A4658;line-height:1.6">
        If this wasn't you, ignore this email — your password has not changed.
      </p>`),
  };
}

export function verifyEmail({ name, url, expiresMinutes }) {
  return {
    subject: 'Confirm your email to finish signing up',
    text:
      `Hi ${name},

`
      + `Confirm this address to finish creating your GameOn account:
${url}

`
      + `The link works once and expires in ${expiresMinutes} minutes.

`
      + `Your account is not created until you open it. If you did not sign up, `
      + `ignore this email — nothing has been created and you will not hear from us again.
`,
    html: wrap('Confirm your email', `
      <p style="margin:0 0 16px;line-height:1.6">Hi ${escapeHtml(name)}, confirm this address to finish creating your GameOn account.</p>
      <p style="margin:0 0 20px">${button(url, 'Confirm my email')}</p>
      <p style="margin:0 0 10px;font-size:13px;color:#4A4658;line-height:1.6">
        The link works once and expires in ${expiresMinutes} minutes.
      </p>
      <p style="margin:0;font-size:13px;color:#4A4658;line-height:1.6">
        Your account is not created until you open it. If you did not sign up, ignore this
        email — nothing has been created and you will not hear from us again.
      </p>`),
  };
}

/**
 * Sent when somebody tries to register with an address that ALREADY has an
 * account.
 *
 * The API answers that attempt exactly as it answers a real signup, so this
 * email is the only place the difference is visible — and it goes to the
 * person who owns the inbox rather than to whoever typed the address. If it
 * was not them, it tells them someone is poking at their account; if it was,
 * it saves them working out why the confirmation link never arrived.
 */
export function alreadyRegisteredEmail({ name, resetUrl }) {
  return {
    subject: 'You already have a GameOn account',
    text:
      `Hi ${name},

`
      + `Someone just tried to sign up with this email address, but you already have `
      + `a GameOn account.

`
      + `If that was you, just log in — no need to sign up again. Forgotten your `
      + `password? Reset it here:
${resetUrl}

`
      + `If it was not you, you can safely ignore this. Nothing has changed and no new `
      + `account was created.
`,
    html: wrap('You already have an account', `
      <p style="margin:0 0 16px;line-height:1.6">Hi ${escapeHtml(name)}, someone just tried to sign up with this email address — but you already have a GameOn account.</p>
      <p style="margin:0 0 16px;line-height:1.6">If that was you, just log in. No need to sign up again.</p>
      <p style="margin:0 0 20px">${button(resetUrl, 'Reset my password')}</p>
      <p style="margin:0;font-size:13px;color:#4A4658;line-height:1.6">
        If it was not you, you can ignore this. Nothing has changed and no new account was created.
      </p>`),
  };
}

export function passwordChangedEmail({ name }) {
  return {
    subject: 'Your GameOn password was changed',
    text:
      `Hi ${name},\n\n`
      + `Your GameOn password was just changed, and you have been signed out on every other device.\n\n`
      + `If this wasn't you, reset your password immediately and contact support.\n`,
    html: wrap('Your password was changed', `
      <p style="margin:0 0 14px;line-height:1.6">Hi ${escapeHtml(name)}, your GameOn password was just changed and you have been signed out on every other device.</p>
      <p style="margin:0;font-size:13px;color:#4A4658;line-height:1.6">
        If this wasn't you, reset your password immediately and get in touch.
      </p>`),
  };
}

/** Escapes a user-supplied name before it goes into an HTML email body. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
