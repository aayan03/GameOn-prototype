/**
 * Slot maths.
 *
 * Everything works in "minutes from midnight" on a `YYYY-MM-DD` date key.
 * Integers never have a timezone bug, which is exactly the class of problem
 * that produces double bookings and off-by-one-day errors.
 *
 * ── Which clock? ─────────────────────────────────────────────────
 *
 * The integers are safe; converting to and from them is not, and that is what
 * this file got wrong for its whole life. `new Date('2026-09-04T00:00:00')`
 * and `date.getHours()` both read the SERVER's timezone. Render, Railway, Fly
 * and node:*-alpine all run UTC. The venues are in India. So on a real
 * deployment every one of these was 5½ hours out:
 *
 *   - `minutesNow()` returned UTC minutes, so a 1 PM slot still read
 *     "available" at 6 PM and could be booked hours after it had passed.
 *   - `toDate()` wrote `startsAt` 5½ hours late, which moved the free-
 *     cancellation window, the day-before reminder and the lifecycle
 *     completion sweep with it.
 *   - `todayKey()` flipped to tomorrow at 5:30 AM local, so the grid showed
 *     the wrong day every morning.
 *
 * Setting TZ on the host fixes it too, and this project does that as well —
 * but a correctness guarantee that lives in a hosting dashboard is one
 * redeploy away from being lost, and it silently breaks the moment anyone
 * runs the code anywhere else. So the timezone is explicit here instead, and
 * TZ is belt and braces rather than the mechanism.
 *
 * Set APP_TIMEZONE to any IANA name to run the platform in another region.
 */

const ZONE = (process.env.APP_TIMEZONE || '').trim() || 'Asia/Kolkata';

/**
 * Formats an instant as wall-clock parts in the venue's timezone.
 *
 * `hourCycle: 'h23'` rather than `hour12: false` — the latter renders
 * midnight as "24" on some ICU builds, which turns into hour 24 of the
 * previous day and is a genuinely painful off-by-one to chase down.
 */
function buildFormatter(zone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/**
 * Fail at import, not at the first booking.
 *
 * A Node build without full ICU — or an Alpine image without `tzdata` —
 * rejects a named zone here with a RangeError. Left uncaught that surfaces
 * hours later as a 500 on one endpoint; caught and shrugged off, it silently
 * reverts every slot to UTC, which is the exact bug this file exists to stop.
 * So it is checked once, loudly, with the fix in the message.
 */
let partsFormatter;
try {
  partsFormatter = buildFormatter(ZONE);
  // formatToParts is what actually resolves the zone on some builds.
  partsFormatter.formatToParts(new Date());
} catch (err) {
  throw new Error(
    `APP_TIMEZONE "${ZONE}" is not a timezone this Node build can resolve (${err.message}). `
    + 'Either the name is wrong, or this runtime has no timezone database — on Alpine, '
    + 'install it with `apk add --no-cache tzdata`. Booking times would silently fall back '
    + 'to UTC, so this refuses to start instead.'
  );
}

function zonedParts(date = new Date()) {
  const out = {};
  for (const { type, value } of partsFormatter.formatToParts(date)) {
    if (type !== 'literal') out[type] = Number(value);
  }
  return out;
}

/**
 * How far ahead of UTC the zone is at this instant, in milliseconds.
 * Derived by asking what wall-clock time the zone shows for a known instant,
 * so it needs no offset table and follows DST wherever the zone has it.
 */
function offsetMsAt(date) {
  const p = zonedParts(date);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The real instant at which a wall-clock time occurs in the venue's timezone.
 *
 * Two passes: the first guess uses the offset at the naive instant, which is
 * wrong only when the guess lands on the far side of a DST transition; the
 * second re-reads the offset at the corrected instant and settles it. India
 * has no DST so one pass would do, but a timezone helper that quietly breaks
 * for the first operator outside IST is not worth the six lines it saves.
 */
function instantFromZoned(year, month, day, minutes = 0) {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0) + minutes * 60_000;
  let ts = naive - offsetMsAt(new Date(naive));
  ts = naive - offsetMsAt(new Date(ts));
  return new Date(ts);
}

/** The timezone every date key and minute offset in this app is expressed in. */
export const timezone = () => ZONE;

/** "18:30" → 1110 */
export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/** 1110 → "18:30" */
export function toHHMM(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 1110 → "6:30 PM" — what users actually read */
export function toLabel(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${suffix}`;
}

/**
 * Formats an instant as "YYYY-MM-DD" in the VENUE's timezone.
 *
 * Not `toISOString().slice(0,10)`, which converts to UTC first and therefore
 * reports the previous day for anything before 05:30 IST — and not
 * `getFullYear()/getMonth()/getDate()` either, which read whatever timezone
 * the server happens to run in.
 */
export function localKey(date = new Date()) {
  const p = zonedParts(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Steps a date key by whole calendar days.
 *
 * Done on the key itself, in UTC, rather than by adding 86,400,000 ms to an
 * instant — which lands on the same day again, or skips one, either side of a
 * DST change. Callers building a run of consecutive days want the calendar,
 * not elapsed time.
 */
export function addDays(dateKey, days = 0) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const stepped = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n) => String(n).padStart(2, '0');
  return `${stepped.getUTCFullYear()}-${pad(stepped.getUTCMonth() + 1)}-${pad(stepped.getUTCDate())}`;
}

/** Today in the venue's local terms, as "YYYY-MM-DD". */
export function todayKey(offsetDays = 0) {
  return offsetDays ? addDays(localKey(), offsetDays) : localKey();
}

export function isValidDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  // Date.parse accepts "2026-02-31" and rolls it into March, so a round-trip
  // is the only way to reject a day that does not exist.
  const [y, m, d] = key.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * 0 = Sunday, matching Venue.operatingHours[].day
 *
 * Parsed as UTC. A date key is a calendar date, not an instant, and its day
 * of the week is the same everywhere — but `new Date('2026-09-04T00:00:00')`
 * parses in server-local time, so a server west of UTC would name the
 * previous day and read the wrong row of the opening hours.
 */
export function dayOfWeek(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Combine a date key and minute offset into the real instant it names. */
export function toDate(dateKey, minutes) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return instantFromZoned(y, m, d, minutes);
}

/** Whole calendar days from today to `dateKey`, in the venue's timezone. */
export function daysBetween(dateKey) {
  const [ty, tm, td] = todayKey().split('-').map(Number);
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const a = Date.UTC(ty, tm - 1, td);
  const b = Date.UTC(y, m - 1, d);
  return Math.round((b - a) / 86400000);
}

/**
 * Peak hours: weekday evenings from 17:00, and all day on the weekend.
 * This is where a venue's `peakPricePerHour` kicks in.
 */
export function isPeak(dateKey, startMinutes) {
  const dow = dayOfWeek(dateKey);
  const isWeekend = dow === 0 || dow === 6;
  if (isWeekend) return startMinutes >= 8 * 60;
  return startMinutes >= 17 * 60;
}

/** Minutes elapsed today in the venue's timezone — greys out slots that have passed. */
export function minutesNow() {
  const p = zonedParts();
  return p.hour * 60 + p.minute;
}

/**
 * Start and end instants of the last `days` calendar days, inclusive of today.
 *
 * Lives here rather than in the analytics service so it uses the same clock as
 * everything else: the reports bucket by `Booking.date`, which is a venue-local
 * key, while their range filter runs against `startsAt`, which is an instant.
 * Deriving the two from different timezones put the boundary days in the wrong
 * bucket — or dropped them.
 */
export function rangeFor(days = 30) {
  const endKey = todayKey();
  const startKey = addDays(endKey, -(days - 1));
  const [y, m, d] = endKey.split('-').map(Number);

  // 23:59:59.999 of today, in venue time.
  const end = new Date(instantFromZoned(y, m, d, 24 * 60).getTime() - 1);

  // The keys come back too: reports group by `Booking.date`, which IS a key,
  // so a caller zero-filling a chart should step keys rather than re-deriving
  // them from the instants and risking a different answer.
  return { start: toDate(startKey, 0), end, startKey, endKey };
}
