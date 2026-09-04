// Pin the venue clock before importing anything that reads it, so this file
// asserts the same thing whatever timezone the machine running it is in.
process.env.APP_TIMEZONE = 'Asia/Kolkata';

const { toMinutes, toHHMM, toLabel, isPeak, dayOfWeek, toDate, daysBetween, todayKey, localKey }
  = await import('../src/utils/time.js');
import { priceFor, refundFor, lookupPromo } from '../src/services/booking.service.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};

console.log('\n── time utilities ──');
eq('toMinutes 18:30', toMinutes('18:30'), 1110);
eq('toMinutes 06:00', toMinutes('06:00'), 360);
eq('toHHMM 1110', toHHMM(1110), '18:30');
eq('toHHMM roundtrip', toHHMM(toMinutes('23:00')), '23:00');
eq('toLabel 1110', toLabel(1110), '6:30 PM');
eq('toLabel noon', toLabel(720), '12 PM');
eq('toLabel midnight', toLabel(0), '12 AM');
eq('toLabel 9am', toLabel(540), '9 AM');

// 2026-08-22 is a Saturday, 2026-08-20 a Thursday
eq('dayOfWeek Saturday', dayOfWeek('2026-08-22'), 6);
eq('dayOfWeek Thursday', dayOfWeek('2026-08-20'), 4);

console.log('\n── peak pricing ──');
eq('weekday 10am is off-peak', isPeak('2026-08-20', 600), false);
eq('weekday 6pm is peak',      isPeak('2026-08-20', 1080), true);
eq('weekday 4:59pm off-peak',  isPeak('2026-08-20', 1019), false);
eq('saturday 10am is peak',    isPeak('2026-08-22', 600), true);
eq('saturday 7am off-peak',    isPeak('2026-08-22', 420), false);

console.log('\n── slot pricing ──');
const court = { pricePerHour: 1200, peakPricePerHour: 1600 };
eq('off-peak 60min', priceFor(court, '2026-08-20', 600, 60).amount, 1200);
eq('peak 60min',     priceFor(court, '2026-08-20', 1080, 60).amount, 1600);
eq('peak flagged',   priceFor(court, '2026-08-20', 1080, 60).isPeak, true);
eq('off-peak 30min', priceFor(court, '2026-08-20', 600, 30).amount, 600);
eq('90min peak',     priceFor(court, '2026-08-20', 1080, 90).amount, 2400);
const noPeak = { pricePerHour: 500, peakPricePerHour: null };
eq('no peak price falls back', priceFor(noPeak, '2026-08-22', 1080, 60).amount, 500);

console.log('\n── promo codes ──');
eq('unknown code', lookupPromo('NOPE'), null);
eq('empty code', lookupPromo(''), null);
eq('case insensitive', lookupPromo('gameon50').value, 50);
eq('percent promo', lookupPromo('FIRST20').type, 'percent');

console.log('\n── refund policy ──');
const venue = { cancellationPolicy: { freeCancellationHours: 24, partialRefundHours: 6, partialRefundPercent: 50 } };
const H = (h) => new Date(Date.now() + h * 3600000);
const paid = (h, amt = 1000) => ({ startsAt: H(h), totalAmount: amt, payment: { status: 'paid' } });

eq('48h out → full refund',    refundFor(paid(48), venue).amount, 1000);
eq('48h tier',                 refundFor(paid(48), venue).tier, 'full');
eq('25h out → full refund',    refundFor(paid(25), venue).amount, 1000);
eq('12h out → 50% refund',     refundFor(paid(12), venue).amount, 500);
eq('12h tier',                 refundFor(paid(12), venue).tier, 'partial');
eq('6.5h out → still partial', refundFor(paid(6.5), venue).tier, 'partial');
eq('3h out → no refund',       refundFor(paid(3), venue).amount, 0);
eq('3h tier',                  refundFor(paid(3), venue).tier, 'none');
eq('unpaid booking',           refundFor({ startsAt: H(48), totalAmount: 800, payment: { status: 'unpaid' } }, venue).tier, 'unpaid');
eq('missing policy defaults',  refundFor(paid(48), {}).amount, 1000);

console.log('\n── date maths ──');
eq('today is 0 days out', daysBetween(todayKey()), 0);
/**
 * Read the instant back on the VENUE's clock, not the server's.
 *
 * These two assertions used to call `d.getHours()`, which reads whatever
 * timezone the process happens to run in. That passed on a laptop set to IST
 * and failed on every real host — and because it was the test, it was quietly
 * asserting that the bug was the correct behaviour.
 */
const d = toDate('2026-08-20', 1110);
eq('toDate lands on the right venue day', localKey(d), '2026-08-20');
eq('toDate is 18:30 venue time', new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
}).format(d), '18:30');
eq('toDate is the matching UTC instant', d.toISOString(), '2026-08-20T13:00:00.000Z');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
