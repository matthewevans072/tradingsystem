// Time-zone helpers built on Intl, so daylight-saving transitions follow the
// IANA database shipped with Node rather than hand-written offsets.
export const NY = 'America/New_York';
export const TORONTO = 'America/Toronto';

const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return fmtCache.get(tz);
}

// Wall-clock parts of an instant in a zone.
export function zonedParts(date, tz = NY) {
  const p = {};
  for (const { type, value } of fmt(tz).formatToParts(date)) p[type] = value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour, minute: +p.minute, second: +p.second,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: +p.hour * 60 + +p.minute,
  };
}

function offsetMinutes(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// Convert a wall-clock time in a zone ("2026-03-09", 9, 15) to a UTC Date.
// Handles DST by re-checking the offset at the candidate instant.
export function zonedToUtc(dateStr, hour, minute, tz = NY) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let off = offsetMinutes(new Date(guess), tz);
  let utc = guess - off * 60000;
  const off2 = offsetMinutes(new Date(utc), tz);
  if (off2 !== off) utc = guess - off2 * 60000;
  return new Date(utc);
}

export function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function todayIn(tz = NY, now = new Date()) {
  return zonedParts(now, tz).date;
}

export function formatNy(date) {
  if (!date) return '';
  const p = zonedParts(new Date(date), NY);
  return `${p.date} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} ET`;
}
