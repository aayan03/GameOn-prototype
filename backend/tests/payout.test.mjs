/**
 * Payout period boundaries.
 *
 * A payout row is a promise to send somebody money, and the unique index on
 * (owner, periodStart, periodEnd) is the only thing stopping the same
 * bookings being settled twice. That index is worthless if the boundaries
 * move — which they did: the period END was "today at midnight", so every day
 * the job ran produced a different, overlapping week.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_TIMEZONE = 'Asia/Kolkata';
const { lastWeekBoundary } = await import('../src/controllers/admin.controller.js');

const iso = (d) => d.toISOString();

test('the boundary is the same for every day of one week', () => {
  // Mon 2026-08-31 through Sun 2026-09-06 all settle the week ending Mon 31st.
  const week = [
    '2026-08-31T00:00:00Z', '2026-08-31T23:59:59Z',
    '2026-09-01T09:00:00Z', '2026-09-02T18:30:00Z', '2026-09-03T04:00:00Z',
    '2026-09-04T12:00:00Z', '2026-09-05T23:00:00Z', '2026-09-06T13:37:00Z',
  ];
  const boundaries = new Set(week.map((t) => iso(lastWeekBoundary(new Date(t)))));
  assert.equal(boundaries.size, 1, `all of one week share a boundary, got ${[...boundaries]}`);
  assert.equal([...boundaries][0], '2026-08-31T00:00:00.000Z');
});

test('the boundary advances by exactly one week, never a partial one', () => {
  const a = lastWeekBoundary(new Date('2026-09-06T23:00:00Z'));  // Sunday
  const b = lastWeekBoundary(new Date('2026-09-07T00:00:01Z'));  // the next Monday
  assert.equal(b.getTime() - a.getTime(), 7 * 86400000);
});

test('periods tile the calendar without overlapping', () => {
  // Walk a year of daily runs and collect every distinct period.
  const periods = new Set();
  for (let i = 0; i < 365; i++) {
    const end = lastWeekBoundary(new Date(Date.UTC(2026, 0, 1 + i, 11, 0, 0)));
    periods.add(`${end.getTime() - 7 * 86400000}:${end.getTime()}`);
  }

  const sorted = [...periods]
    .map((p) => p.split(':').map(Number))
    .sort((x, y) => x[0] - y[0]);

  for (let i = 1; i < sorted.length; i++) {
    const [prevStart, prevEnd] = sorted[i - 1];
    const [start] = sorted[i];
    assert.equal(start, prevEnd,
      `period ${i} starts where the last ended — no gap, no double-payment overlap`);
    assert.equal(prevEnd - prevStart, 7 * 86400000, 'every period is a whole week');
  }
});

test('the boundary always lands on a Monday at UTC midnight', () => {
  for (let i = 0; i < 60; i++) {
    const d = lastWeekBoundary(new Date(Date.UTC(2026, 5, 1 + i, 17, 45, 12)));
    assert.equal(d.getUTCDay(), 1, 'Monday');
    assert.equal(d.getUTCHours(), 0);
    assert.equal(d.getUTCMinutes(), 0);
    assert.equal(d.getUTCSeconds(), 0);
    assert.equal(d.getUTCMilliseconds(), 0);
  }
});

test('the boundary is never in the future', () => {
  const now = new Date();
  assert.ok(lastWeekBoundary(now).getTime() <= now.getTime());
});
