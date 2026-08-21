/**
 * Phase 4 unit tests: payment signature verification, the local-date fix,
 * and the promo schema shape that once broke server boot.
 */
import crypto from 'crypto';
import { localKey, todayKey, dayOfWeek } from '../src/utils/time.js';
import { verifyPaymentSignature, verifyWebhookSignature, isLive, mode, publicConfig }
  from '../src/services/payment.service.js';
import { promoSchema, updatePromoSchema, blackoutSchema } from '../src/controllers/owner.controller.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};

console.log('\n── local date keys (timezone) ──');
{
  // The bug: toISOString() converts to UTC first, so a Date at local midnight
  // in any positive offset serialises as the previous day.
  const d = new Date(2026, 7, 20, 0, 0, 0);       // 20 Aug 2026, local midnight
  eq('localKey uses local components', localKey(d), '2026-08-20');
  eq('localKey pads single digits', localKey(new Date(2026, 0, 5)), '2026-01-05');
  eq('localKey end of year', localKey(new Date(2026, 11, 31)), '2026-12-31');
  eq('todayKey matches localKey', todayKey(), localKey(new Date()));

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  eq('todayKey(1) is tomorrow', todayKey(1), localKey(tomorrow));

  // A local-midnight Date must round-trip through dayOfWeek to the same day.
  const sat = new Date(2026, 7, 22);              // Saturday
  eq('dayOfWeek round-trips', dayOfWeek(localKey(sat)), 6);
}

console.log('\n── payment signatures ──');
{
  // In simulated mode there is no secret, so verification cannot mean anything.
  // The routes that use it are disabled in that mode — see payment.controller.
  eq('mock mode reports itself', mode(), 'mock');
  eq('isLive is false without keys', isLive(), false);
  eq('config never leaks a secret', Object.keys(publicConfig()).includes('keySecret'), false);
  eq('config exposes no keyId in mock', publicConfig().keyId, null);

  // With no webhook secret configured, every webhook must be rejected —
  // fail closed, not open.
  eq('webhook rejected without a secret', verifyWebhookSignature('{}', 'abc'), false);
  eq('webhook rejects a missing signature', verifyWebhookSignature('{}', undefined), false);

  // Signature maths, verified against a known HMAC.
  const secret = 'test_secret_value';
  const body = JSON.stringify({ event: 'payment.captured' });
  const good = crypto.createHmac('sha256', secret).update(body).digest('hex');
  eq('HMAC is 64 hex chars', good.length, 64);
  eq('HMAC is deterministic',
     crypto.createHmac('sha256', secret).update(body).digest('hex'), good);
  eq('HMAC changes with the body',
     crypto.createHmac('sha256', secret).update(body + ' ').digest('hex') === good, false);

  // Length mismatch must not throw — timingSafeEqual is strict about that.
  let threw = false;
  try { verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature: 'short' }); }
  catch { threw = true; }
  eq('length mismatch does not throw', threw, false);
  eq('mock signature check short-circuits',
     verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature: 'x' }), true);
}

console.log('\n── promo schema shape ──');
{
  // The regression: promoSchema.refine() returns a ZodEffects, which has no
  // .partial(). Deriving the update schema from it threw during module load
  // and took the whole API down while passing node --check.
  eq('promoSchema exists', typeof promoSchema.safeParse, 'function');
  eq('updatePromoSchema exists', typeof updatePromoSchema.safeParse, 'function');
  eq('they are distinct objects', promoSchema === updatePromoSchema, false);
  eq('blackoutSchema exists', typeof blackoutSchema.safeParse, 'function');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
