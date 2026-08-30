import { describe, test, expect, afterEach, vi } from 'vitest';
import { localKey, dateKey, dateStrip, slotRangeLabel, minuteLabel } from '../utils/date.js';

/**
 * These exist because of a real bug, not for coverage.
 *
 * The date strip used `toISOString().slice(0, 10)`, which converts to UTC
 * first. In IST (UTC+05:30) a Date at 03:00 local serialises as the previous
 * day — so between midnight and 05:30 the chip labelled "Today" carried
 * yesterday's key, the grid showed yesterday's availability, and the server
 * rejected the booking with "that date has already passed".
 *
 * Booking a pitch late at night for the next morning is the normal case, so
 * this broke the core flow for five and a half hours out of every day.
 */

afterEach(() => vi.useRealTimers());

/** Pins the clock to a wall-clock instant in a chosen UTC offset. */
function atLocalTime(iso) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('localKey', () => {
  test('uses local calendar date, not the UTC one', () => {
    // 03:00 on the 30th in UTC+05:30 is 21:30 on the 29th in UTC.
    const earlyMorningIST = new Date('2026-08-30T03:00:00+05:30');

    expect(earlyMorningIST.toISOString().slice(0, 10)).toBe('2026-08-29');

    // localKey must agree with the wall clock the user is reading.
    const expected = [
      earlyMorningIST.getFullYear(),
      String(earlyMorningIST.getMonth() + 1).padStart(2, '0'),
      String(earlyMorningIST.getDate()).padStart(2, '0'),
    ].join('-');
    expect(localKey(earlyMorningIST)).toBe(expected);
  });

  test('always matches the local getters it is derived from', () => {
    for (const iso of [
      '2026-01-01T00:00:00Z', '2026-08-30T23:59:59Z',
      '2026-03-01T04:30:00Z', '2026-12-31T18:45:00Z',
    ]) {
      const d = new Date(iso);
      const [y, m, day] = localKey(d).split('-').map(Number);
      expect(y).toBe(d.getFullYear());
      expect(m).toBe(d.getMonth() + 1);
      expect(day).toBe(d.getDate());
    }
  });

  test('zero-pads single-digit months and days', () => {
    expect(localKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localKey(new Date(2026, 8, 9))).toBe('2026-09-09');
  });
});

describe('dateStrip', () => {
  test('the chip labelled Today carries today\'s local key', () => {
    atLocalTime('2026-08-30T03:00:00+05:30');
    const [today] = dateStrip(3);

    expect(today.dow).toBe('Today');
    expect(today.key).toBe(localKey(new Date()));
    // The label and the key must describe the same day. They disagreed before:
    // the label came from local getters, the key from UTC.
    expect(today.day).toBe(new Date().getDate());
  });

  test('produces the requested number of consecutive days', () => {
    atLocalTime('2026-08-30T12:00:00Z');
    const days = dateStrip(14);
    expect(days).toHaveLength(14);

    for (let i = 1; i < days.length; i++) {
      const prev = new Date(`${days[i - 1].key}T00:00:00`);
      const curr = new Date(`${days[i].key}T00:00:00`);
      expect(Math.round((curr - prev) / 86400000)).toBe(1);
    }
  });

  test('honours a longer window than the old hardcoded 14', () => {
    atLocalTime('2026-08-30T12:00:00Z');
    expect(dateStrip(30)).toHaveLength(30);
  });

  test('crosses a month boundary correctly', () => {
    atLocalTime('2026-08-30T12:00:00Z');
    const keys = dateStrip(4).map((d) => d.key);
    expect(keys[0]).toBe('2026-08-30');
    expect(keys[2]).toBe('2026-09-01');
  });
});

describe('dateKey offset', () => {
  test('counts whole local days forward', () => {
    atLocalTime('2026-08-30T12:00:00Z');
    expect(dateKey(0)).toBe(localKey(new Date()));
    expect(dateKey(1)).not.toBe(dateKey(0));
  });
});

describe('slot labels', () => {
  test('renders 12-hour times the way people read them', () => {
    expect(minuteLabel(0)).toBe('12 AM');
    expect(minuteLabel(720)).toBe('12 PM');
    expect(minuteLabel(1110)).toBe('6:30 PM');
    expect(minuteLabel(540)).toBe('9 AM');
  });

  test('collapses a contiguous booking into one range', () => {
    expect(slotRangeLabel([
      { start: 1080, end: 1140 },
      { start: 1140, end: 1200 },
    ])).toBe('6 PM – 8 PM');
  });

  test('is order-independent', () => {
    expect(slotRangeLabel([
      { start: 1140, end: 1200 },
      { start: 1080, end: 1140 },
    ])).toBe('6 PM – 8 PM');
  });

  test('survives an empty selection', () => {
    expect(slotRangeLabel([])).toBe('');
    expect(slotRangeLabel(undefined)).toBe('');
  });
});
