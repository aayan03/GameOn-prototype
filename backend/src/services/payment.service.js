// @ts-check
import crypto from 'crypto';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

/**
 * Payment gateway.
 *
 * Two modes, chosen by whether Razorpay credentials are present:
 *
 *   live  — real orders, real signature verification, real webhooks
 *   mock  — the wallet-backed simulation used through Phases 2 and 3
 *
 * Everything above this file (booking creation, refunds, the ledger) is
 * identical in both modes, so switching is a matter of setting two env vars.
 *
 * No SDK. Razorpay's order and refund endpoints are plain REST with basic
 * auth, and signature verification is an HMAC — pulling in a dependency to do
 * `fetch` and `createHmac` would add supply-chain surface for no benefit.
 */

export const isLive = () => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

export function mode() {
  return isLive() ? 'razorpay' : 'mock';
}

/** Public config the checkout page needs. Never exposes the secret. */
export function publicConfig() {
  return {
    mode: mode(),
    keyId: isLive() ? env.RAZORPAY_KEY_ID : null,
    currency: 'INR',
  };
}

function authHeader() {
  const token = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  return `Basic ${token}`;
}

/**
 * One authenticated call to Razorpay's REST API.
 *
 * @param {string} path            e.g. '/orders' or '/payments/pay_123/refund'
 * @param {object} [options]
 * @param {string} [options.method] HTTP verb; defaults to POST
 * @param {object} [options.body]   JSON body, omitted entirely for a GET
 * @returns {Promise<any>} the parsed response
 *
 * The annotation is not decoration. Without it `body` has no default, so its
 * type is inferred as absent and every caller that passes one is a type error
 * — which is exactly what the checker said when this file opted in.
 */
async function razorpay(path, { method = 'POST', body } = {}) {
  let res;
  try {
    res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(502, 'Could not reach the payment gateway. Please try again.');
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    // Gateway errors are logged in full but summarised to the caller — the
    // raw body can contain account identifiers.
    logger.error('razorpay rejected a request', { status: res.status, reason: json?.error?.description || text?.slice(0, 300) });
    throw new ApiError(502, json?.error?.description || 'The payment gateway rejected this request.');
  }
  return json;
}

/**
 * Creates an order the client can hand to Razorpay Checkout.
 * `amount` is in rupees; Razorpay works in paise.
 */
export async function createOrder({ amount, receipt, notes = {} }) {
  const paise = Math.round(Number(amount) * 100);
  if (!Number.isFinite(paise) || paise <= 0) throw ApiError.badRequest('Invalid amount');

  if (!isLive()) {
    return {
      mode: 'mock',
      orderId: 'order_mock_' + crypto.randomBytes(8).toString('hex'),
      amount: paise,
      currency: 'INR',
      receipt,
    };
  }

  const order = await razorpay('/orders', {
    body: { amount: paise, currency: 'INR', receipt, notes, payment_capture: 1 },
  });

  return {
    mode: 'razorpay',
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    receipt: order.receipt,
  };
}

/**
 * Verifies a completed checkout.
 *
 * The signature is HMAC-SHA256 of "<order_id>|<payment_id>" keyed with the
 * API secret. Comparison is timing-safe: a plain `===` on a secret-derived
 * value leaks bytes through response timing, which is a real attack on a
 * remote endpoint even if it is a slow one.
 */
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!isLive()) return true;
  if (!orderId || !paymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Verifies a webhook body against the webhook secret. */
export function verifyWebhookSignature(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;

  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Confirms with the gateway that a payment really was captured. */
export async function fetchPayment(paymentId) {
  if (!isLive()) return { id: paymentId, status: 'captured', amount: 0 };
  return razorpay(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

/** Refunds through the gateway. `amount` in rupees; omit for a full refund. */
export async function refundPayment(paymentId, amount) {
  if (!isLive()) {
    return { id: 'rfnd_mock_' + crypto.randomBytes(6).toString('hex'), status: 'processed' };
  }
  return razorpay(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    body: amount ? { amount: Math.round(amount * 100), speed: 'normal' } : { speed: 'normal' },
  });
}
