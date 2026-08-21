/**
 * Slot maths.
 *
 * Everything works in "minutes from midnight" on a `YYYY-MM-DD` date key.
 * Integers never have a timezone bug, which is exactly the class of problem
 * that produces double bookings and off-by-one-day errors.
 */

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
 * Formats a Date as a LOCAL "YYYY-MM-DD".
 *
 * `toISOString().slice(0,10)` converts to UTC first, so a Date at local
 * midnight in IST (UTC+5:30) serialises as the PREVIOUS day. Booking.date is
 * a local key, so mixing the two silently drops today's data from every
 * report and reads the wrong day's opening hours.
 */
export function localKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today in the venue's local terms, as "YYYY-MM-DD". */
export function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return localKey(d);
}

export function isValidDateKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(Date.parse(key));
}

/** 0 = Sunday, matching Venue.operatingHours[].day */
export function dayOfWeek(dateKey) {
  return new Date(`${dateKey}T00:00:00`).getDay();
}

/** Combine a date key and minute offset into a real Date. */
export function toDate(dateKey, minutes) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

export function daysBetween(dateKey) {
  const a = new Date(`${todayKey()}T00:00:00`);
  const b = new Date(`${dateKey}T00:00:00`);
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

/** Minutes elapsed today — used to grey out slots that have already passed. */
export function minutesNow() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
