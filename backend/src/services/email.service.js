/**
 * Transactional email.
 *
 * SMTP rather than a provider SDK, because every provider speaks SMTP —
 * Gmail, SES, Mailgun, Postmark, Resend, Brevo — so switching is four
 * environment variables and no code change.
 *
 * With no SMTP_HOST configured this falls back to logging the message. That
 * keeps development working with zero setup, and it is why `deliver()`
 * reports which mode it used: a password-reset endpoint that silently does
 * nothing looks identical to one that works, right up until a real user
 * needs it.
 */

import nodemailer from 'nodemailer';
import env, { isProd } from '../config/env.js';
import logger from '../utils/logger.js';

let transport = null;
let verified = null;

export const isConfigured = () => Boolean(env.SMTP_HOST && env.SMTP_USER);

function getTransport() {
  if (transport || !isConfigured()) return transport;

  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is implicit TLS; 587 and 25 start plaintext and upgrade via
    // STARTTLS. Getting this backwards is the usual cause of a connection
    // that hangs until it times out.
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    // Bounded, so a dead mail server cannot hold a request open.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    pool: true,
    maxConnections: 3,
  });

  return transport;
}

/**
 * Checks the SMTP credentials once at boot.
 *
 * Finding out that the password is wrong at the moment a locked-out user
 * asks for a reset link is the worst possible time to find out.
 */
export async function verifyConnection() {
  if (!isConfigured()) {
    if (isProd()) {
      logger.warn('SMTP is not configured — password reset emails cannot be sent. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD.');
    }
    return false;
  }
  try {
    await getTransport().verify();
    verified = true;
    logger.info('SMTP ready', { host: env.SMTP_HOST, port: env.SMTP_PORT });
    return true;
  } catch (err) {
    verified = false;
    logger.error('SMTP verification failed — email will not be delivered', { err });
    return false;
  }
}

export const isVerified = () => verified;

/**
 * Sends one message.
 *
 * Returns `{ delivered, mode }` rather than throwing on a transport failure,
 * so a caller can decide whether email is essential to its flow. Password
 * reset treats a failure as fatal; a booking receipt does not.
 */
export async function deliver({ to, subject, text, html }) {
  if (!to || !subject) return { delivered: false, mode: 'invalid' };

  if (!isConfigured()) {
    // Development: print it. A reset link you can click out of the terminal
    // is more useful than a silent no-op, and this never runs in production
    // because validateEnv() refuses to boot without SMTP configured.
    logger.info('email (not sent — SMTP unconfigured)', { to, subject, preview: text?.slice(0, 400) });
    return { delivered: false, mode: 'console' };
  }

  try {
    const info = await getTransport().sendMail({
      from: env.SMTP_FROM,
      to,
      subject,
      text,
      html,
    });
    logger.info('email sent', { to, subject, messageId: info.messageId });
    return { delivered: true, mode: 'smtp' };
  } catch (err) {
    logger.error('email delivery failed', { err, to, subject });
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
