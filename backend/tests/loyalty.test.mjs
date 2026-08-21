/**
 * Unit tests for the loyalty engine and the input-safety helpers.
 * These are pure functions, so they run without a database.
 */
import { tierFor, nextTierFor, pointsForSpend, discountedFee, bonusBookingDays }
  from '../src/services/loyalty.service.js';
import { escapeRegex, stripOperators, cleanText } from '../src/utils/sanitize.js';
import { LOYALTY_TIERS, LOYALTY } from '../src/config/constants.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};
const truthy = (name, got) => eq(name, Boolean(got), true);

console.log('\n── tier thresholds ──');
eq('0 points → rookie',      tierFor(0).key, 'rookie');
eq('499 → rookie',           tierFor(499).key, 'rookie');
eq('500 → pro',              tierFor(500).key, 'pro');
eq('1999 → pro',             tierFor(1999).key, 'pro');
eq('2000 → elite',           tierFor(2000).key, 'elite');
eq('4999 → elite',           tierFor(4999).key, 'elite');
eq('5000 → legend',          tierFor(5000).key, 'legend');
eq('999999 → legend',        tierFor(999999).key, 'legend');
eq('negative is safe',       tierFor(-50).key, 'rookie');
eq('undefined is safe',      tierFor().key, 'rookie');

console.log('\n── next tier & progress ──');
eq('rookie next is pro',     nextTierFor(0).key, 'pro');
eq('needs 500 from zero',    nextTierFor(0).pointsNeeded, 500);
eq('halfway to pro',         nextTierFor(250).progressPercent, 50);
eq('needs 100 at 400',       nextTierFor(400).pointsNeeded, 100);
eq('legend has no next',     nextTierFor(5000), null);
eq('progress never over 100',nextTierFor(1999).progressPercent <= 100, true);

console.log('\n── points earned ──');
eq('₹1000 as rookie',        pointsForSpend(1000, 'rookie'), 50);
eq('₹1000 as pro (1.25x)',   pointsForSpend(1000, 'pro'), 62);
eq('₹1000 as elite (1.5x)',  pointsForSpend(1000, 'elite'), 75);
eq('₹1000 as legend (2x)',   pointsForSpend(1000, 'legend'), 100);
eq('₹0 earns nothing',       pointsForSpend(0, 'legend'), 0);
eq('unknown tier → rookie',  pointsForSpend(1000, 'bogus'), 50);
eq('rounds down',            pointsForSpend(199, 'rookie'), 9);

console.log('\n── tier fee discount ──');
eq('rookie pays full fee',   discountedFee(100, 'rookie').fee, 100);
eq('pro saves 25%',          discountedFee(100, 'pro').fee, 75);
eq('elite saves 50%',        discountedFee(100, 'elite').fee, 50);
eq('legend pays nothing',    discountedFee(100, 'legend').fee, 0);
eq('legend saved amount',    discountedFee(100, 'legend').saved, 100);
eq('fee never negative',     discountedFee(0, 'legend').fee, 0);

console.log('\n── advance booking bonus ──');
eq('rookie no bonus',        bonusBookingDays('rookie'), 0);
eq('pro +3 days',            bonusBookingDays('pro'), 3);
eq('elite +7 days',          bonusBookingDays('elite'), 7);
eq('legend +14 days',        bonusBookingDays('legend'), 14);

console.log('\n── tier table integrity ──');
eq('four tiers', LOYALTY_TIERS.length, 4);
truthy('thresholds ascend', LOYALTY_TIERS.every((t, i) =>
  i === 0 || t.minLifetimePoints > LOYALTY_TIERS[i - 1].minLifetimePoints));
truthy('multipliers ascend', LOYALTY_TIERS.every((t, i) =>
  i === 0 || t.earnMultiplier >= LOYALTY_TIERS[i - 1].earnMultiplier));
truthy('every tier lists perks', LOYALTY_TIERS.every((t) => t.perks.length > 0));
eq('redeem rate is sane', LOYALTY.POINTS_PER_RUPEE > 0, true);

console.log('\n── regex escaping (ReDoS / injection) ──');
eq('escapes dot',            escapeRegex('a.b'), 'a\\.b');
eq('escapes star',           escapeRegex('.*'), '\\.\\*');
eq('escapes nested quantifier', escapeRegex('(a+)+'), '\\(a\\+\\)\\+');
eq('escapes anchors',        escapeRegex('^x$'), '\\^x\\$');
eq('plain text untouched',   escapeRegex('Koramangala'), 'Koramangala');
// The catastrophic-backtracking case: must complete instantly, not hang.
{
  const evil = '(a+)+$';
  const started = Date.now();
  const re = new RegExp(escapeRegex(evil), 'i');
  re.test('a'.repeat(2000) + 'b');
  eq('ReDoS payload is inert', Date.now() - started < 200, true);
}

console.log('\n── Mongo operator stripping ──');
eq('strips $ne',             stripOperators({ email: { $ne: null } }), { email: {} });
eq('strips $gt',             stripOperators({ age: { $gt: 0 } }), { age: {} });
eq('strips $where',          stripOperators({ $where: 'sleep(5000)' }), {});
eq('strips dotted keys',     stripOperators({ 'a.b': 1, c: 2 }), { c: 2 });
eq('strips __proto__',       stripOperators({ __proto__: { x: 1 }, ok: 1 }), { ok: 1 });
eq('keeps normal fields',    stripOperators({ email: 'a@b.com', n: 3 }), { email: 'a@b.com', n: 3 });
eq('recurses into arrays',   stripOperators({ xs: [{ $ne: 1 }, { ok: 2 }] }), { xs: [{}, { ok: 2 }] });
eq('passes through strings', stripOperators('hello'), 'hello');
eq('passes through null',    stripOperators(null), null);
// The classic NoSQL auth bypass must not survive.
{
  const bypass = stripOperators({ email: { $ne: null }, password: { $ne: null } });
  eq('auth bypass neutralised', JSON.stringify(bypass), '{"email":{},"password":{}}');
}

console.log('\n── text cleaning ──');
eq('trims',                  cleanText('  hi  '), 'hi');
eq('caps length',            cleanText('x'.repeat(900), 100).length, 100);
eq('non-string → empty',     cleanText({ a: 1 }), '');
eq('null → empty',           cleanText(null), '');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
