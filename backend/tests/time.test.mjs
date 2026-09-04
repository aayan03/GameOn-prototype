/**
 * The time layer, checked against a hostile server clock.
 *
 * Every one of these passed before the fix when the process happened to run
 * in IST, and every one of them failed under UTC — which is what Render,
 * Railway, Fly and node:*-alpine all actually run. That is why this file
 * exists: the bug was invisible on the machine it was written on.
 *
 * Run the whole suite under several TZ values (see the loop at the bottom of
 * package.json's test:unit, and CI) so a regression cannot hide behind a
 * developer's local timezone again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_TIMEZONE = 'Asia/Kolkata';
const t = await import('../src/utils/time.js');

const serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

test(`the venue clock is independent of the server clock (running under ${serverZone})`, () => {
  assert.equal(t.timezone(), 'Asia/Kolkata');
});

/* ── Wall-clock ⇄ instant ────────────────────────────────────── */

test('toDate maps a venue wall-clock time to the right instant', () => {
  // 19:00 IST is 13:30 UTC. Before the fix this produced 19:00 UTC on a UTC
  // host — a booking stored 5½ hours late, which moved its free-cancellation
  // window, its reminder and its completion sweep with it.
  assert.equal(t.toDate('2026-09-04', 19 * 60).toISOString(), '2026-09-04T13:30:00.000Z');
});

test('toDate is correct across the UTC date line', () => {
  // 00:30 IST on the 5th is 19:00 UTC on the 4th — a different calendar day.
  assert.equal(t.toDate('2026-09-05', 30).toISOString(), '2026-09-04T19:00:00.000Z');
});

test('localKey reports the venue day, not the UTC day', () => {
  assert.equal(t.localKey(new Date('2026-09-04T19:00:00Z')), '2026-09-05', 'past venue midnight');
  assert.equal(t.localKey(new Date('2026-09-04T18:29:00Z')), '2026-09-04', 'just before it');
});

test('toDate and localKey round-trip', () => {
  for (const key of ['2026-01-01', '2026-06-15', '2026-12-31']) {
    for (const mins of [0, 30, 6 * 60, 23 * 60 + 59]) {
      assert.equal(t.localKey(t.toDate(key, mins)), key, `${key} +${mins}m`);
    }
  }
});

/* ── Calendar arithmetic ─────────────────────────────────────── */

test('dayOfWeek reads the calendar date, whatever the server timezone', () => {
  assert.equal(t.dayOfWeek('2026-09-04'), 5, 'a Friday');
  assert.equal(t.dayOfWeek('2026-09-06'), 0, 'a Sunday, index 0 like operatingHours');
});

test('addDays steps the calendar, not 24-hour blocks', () => {
  assert.equal(t.addDays('2026-02-28', 1), '2026-03-01', 'a non-leap February');
  assert.equal(t.addDays('2028-02-28', 1), '2028-02-29', 'a leap one');
  assert.equal(t.addDays('2026-12-31', 1), '2027-01-01', 'a year end');
  assert.equal(t.addDays('2026-01-01', -1), '2025-12-31', 'backwards over one');
  assert.equal(t.addDays('2026-09-04', 0), '2026-09-04');
});

test('todayKey and daysBetween agree with each other', () => {
  assert.equal(t.daysBetween(t.todayKey()), 0);
  assert.equal(t.daysBetween(t.todayKey(1)), 1);
  assert.equal(t.daysBetween(t.todayKey(14)), 14, 'the advance-booking limit');
  assert.equal(t.daysBetween(t.todayKey(-1)), -1, 'yesterday is in the past');
});

test('isValidDateKey rejects a day that does not exist', () => {
  // Date.parse happily rolls 2026-02-31 into March, which let a booking be
  // made for a date the calendar does not contain.
  assert.equal(t.isValidDateKey('2026-02-31'), false);
  assert.equal(t.isValidDateKey('2026-13-01'), false);
  assert.equal(t.isValidDateKey('2026-00-10'), false);
  assert.equal(t.isValidDateKey('2026-2-01'), false, 'must be zero-padded');
  assert.equal(t.isValidDateKey('not-a-date'), false);
  assert.equal(t.isValidDateKey('2026-02-28'), true);
  assert.equal(t.isValidDateKey('2028-02-29'), true, 'a real leap day');
});

/* ── minutesNow ──────────────────────────────────────────────── */

test('minutesNow is the venue clock, not the server clock', () => {
  const now = t.minutesNow();
  assert.ok(Number.isInteger(now) && now >= 0 && now < 1440, `in range: ${now}`);

  // Derive it independently and compare. This is the assertion that fails on
  // a UTC host without the fix: a 330-minute gap greys out the wrong slots,
  // so an hour that has already passed still reads "available".
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const h = Number(p.find((x) => x.type === 'hour').value);
  const m = Number(p.find((x) => x.type === 'minute').value);
  assert.ok(Math.abs(now - (h * 60 + m)) <= 1, `venue clock agrees (${now} vs ${h * 60 + m})`);
});

/* ── Reporting ranges ────────────────────────────────────────── */

test('rangeFor spans exactly N calendar days in venue time', () => {
  const r = t.rangeFor(7);
  assert.equal(r.startKey, t.addDays(r.endKey, -6), 'seven days inclusive');
  assert.equal(r.endKey, t.todayKey(), 'ends today');
  assert.equal(t.localKey(r.start), r.startKey, 'starts at venue midnight of the first day');
  assert.equal(t.localKey(r.end), r.endKey, 'ends inside the last day, not after it');
  assert.ok(r.end.getTime() > r.start.getTime());
});

test('rangeFor(1) is just today', () => {
  const r = t.rangeFor(1);
  assert.equal(r.startKey, r.endKey);
  assert.equal(r.startKey, t.todayKey());
});

/* ── Pricing ─────────────────────────────────────────────────── */

test('peak pricing keys off the venue calendar', () => {
  assert.equal(t.isPeak('2026-09-04', 18 * 60), true, 'Friday evening');
  assert.equal(t.isPeak('2026-09-04', 11 * 60), false, 'Friday late morning');
  assert.equal(t.isPeak('2026-09-05', 11 * 60), true, 'Saturday from 8am');
  assert.equal(t.isPeak('2026-09-05', 7 * 60), false, 'Saturday, too early');
});

/* ── Another zone, with DST, to prove the conversion is general ── */

test('a zone with daylight saving resolves on both sides of the jump', async () => {
  process.env.APP_TIMEZONE = 'America/New_York';
  const ny = await import('../src/utils/time.js?zone=ny');

  // 2026-03-08 is the US spring-forward. Noon is EDT (-4) after it, EST (-5)
  // the day before. A single-pass offset lookup gets one of these wrong.
  assert.equal(ny.toDate('2026-03-08', 12 * 60).toISOString(), '2026-03-08T16:00:00.000Z');
  assert.equal(ny.toDate('2026-03-07', 12 * 60).toISOString(), '2026-03-07T17:00:00.000Z');
  assert.equal(ny.localKey(new Date('2026-03-08T16:00:00Z')), '2026-03-08');

  process.env.APP_TIMEZONE = 'Asia/Kolkata';
});

test('an unresolvable timezone refuses to load rather than falling back to UTC', async () => {
  process.env.APP_TIMEZONE = 'Mars/Olympus_Mons';
  await assert.rejects(
    () => import('../src/utils/time.js?zone=bogus'),
    /not a timezone this Node build can resolve/,
  );
  process.env.APP_TIMEZONE = 'Asia/Kolkata';
});
