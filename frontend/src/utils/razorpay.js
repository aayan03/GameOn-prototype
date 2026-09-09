/**
 * Razorpay Checkout.
 *
 * The API has always been able to create orders, verify signatures and handle
 * webhooks — but nothing in the UI ever called it, so the card and UPI path
 * was unreachable. This is the missing half.
 *
 * The script is loaded on demand rather than in index.html: it is a
 * third-party bundle that most visitors never need, and pulling it into the
 * initial page load would slow down every booking that pays from the wallet.
 */

import { paymentApi } from '../api/endpoints.js';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Confirms a capture with the API, retrying a transient failure.
 *
 * Only ever called after Razorpay has taken the money, which is what makes
 * the retry worth having: a single unguarded verify meant one dropped
 * connection ended in a red error toast for a payment that had succeeded —
 * and, because the booking stayed unpaid, the hold sweep released the slot
 * ten minutes later and told the player nothing had been charged.
 *
 * A 4xx is NOT retried. "This booking is no longer active", "the amount does
 * not match" are settled answers, and hammering them only delays the honest
 * message. Network failures, timeouts and 5xx are the ones that clear on
 * their own.
 *
 * Returns `{ ok, error }`. `ok: true` means the API has acknowledged the
 * payment — including the case where the webhook got there first, which is a
 * success however it reads on the wire.
 */
export async function verifyPayment(groupRef, payload, { attempts = 3 } = {}) {
  let last = null;

  for (let i = 0; i < attempts; i++) {
    try {
      await paymentApi.verify({ groupRef, ...payload });
      return { ok: true, error: null };
    } catch (err) {
      last = err;
      if (err?.status >= 400 && err.status < 500) {
        // Already settled by the webhook, or by an earlier attempt whose
        // response never came back to us.
        if (/already paid/i.test(err.message || '')) return { ok: true, error: null };
        return { ok: false, error: err };
      }
      if (i < attempts - 1) await wait(1200 * (i + 1));
    }
  }

  return { ok: false, error: last };
}

let loader = null;

/** Loads checkout.js once, and hands back the same promise to later callers. */
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(true);
  if (loader) return loader;

  loader = new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => { loader = null; resolve(false); });
      return;
    }

    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      // Reset so a later attempt can retry — an ad blocker or a dropped
      // connection should not permanently disable card payments for the
      // rest of the session.
      loader = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });

  return loader;
}

/**
 * Opens Checkout and resolves with what the user did.
 *
 * Resolves rather than rejects on dismissal: closing the modal is an ordinary
 * choice, not an error, and the caller needs to tell it apart from a genuine
 * failure so it can say the right thing.
 *
 *   { status: 'paid',      payload }   signature returned, ready to verify
 *   { status: 'dismissed' }            the user closed the modal
 *   { status: 'failed',    message }   Razorpay reported a problem
 *   { status: 'unavailable' }          the script could not load
 */
export async function openCheckout({ order, keyId, user, venueName }) {
  const ready = await loadRazorpay();
  if (!ready) return { status: 'unavailable' };

  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };

    const rzp = new window.Razorpay({
      key: keyId,
      // Paise, straight from the order the server created. Never recomputed
      // here — a client-side amount is the oldest bug in online payments.
      amount: order.amount,
      currency: order.currency || 'INR',
      order_id: order.orderId,
      name: 'GameOn',
      description: venueName ? `Booking at ${venueName}` : 'Slot booking',
      prefill: { name: user?.name || '', email: user?.email || '', contact: user?.phone || '' },
      theme: { color: '#6C3CE9' },
      handler: (response) => done({
        status: 'paid',
        payload: {
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        },
      }),
      modal: { ondismiss: () => done({ status: 'dismissed' }) },
    });

    rzp.on('payment.failed', (response) => {
      done({ status: 'failed', message: response?.error?.description || 'The payment did not go through.' });
    });

    rzp.open();
  });
}

/** Test-mode cards, shown in the UI so nobody has to go hunting for them. */
export const TEST_CARDS = [
  { label: 'Success', number: '4111 1111 1111 1111', note: 'any future expiry, any CVV' },
  { label: 'Failure', number: '4000 0000 0000 0002', note: 'declines, to test the error path' },
];
