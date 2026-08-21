const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "YYYY-MM-DD" for today, plus an optional day offset. */
export function dateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** The next `count` days, ready to render as the date strip. */
export function dateStrip(count = 14) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      key: d.toISOString().slice(0, 10),
      dow: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : DOW[d.getDay()],
      day: d.getDate(),
      month: MON[d.getMonth()],
      isToday: i === 0,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  });
}

/** "Sat, 22 Aug" */
export function prettyDate(key) {
  if (!key) return '';
  const d = new Date(`${key}T00:00:00`);
  return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
}

/** "Sat, 22 Aug 2026" */
export function prettyDateLong(key) {
  if (!key) return '';
  const d = new Date(`${key}T00:00:00`);
  return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

/** 1110 → "6:30 PM" */
export function minuteLabel(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${suffix}`;
}

/** "in 3 hours" / "in 2 days" / "started" */
export function relativeTime(iso) {
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return 'started';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** Turns [1080, 1140, 1200] into "6 PM – 9 PM" when contiguous. */
export function slotRangeLabel(slots) {
  if (!slots?.length) return '';
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  return `${minuteLabel(sorted[0].start)} – ${minuteLabel(sorted[sorted.length - 1].end)}`;
}
