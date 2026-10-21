// Exchange calendars for NYSE/Nasdaq and TSX.
//
// Holidays are generated from each exchange's published holiday rules and the
// NYSE output is cross-checked in tests against NYSE's published schedule for
// 2026-2027 (see VERIFIED_NYSE below). Ad-hoc closures (e.g. national days of
// mourning) cannot be predicted by rules and are listed in SPECIAL_CLOSURES;
// add new ones when the exchange announces them.
import { ymd, addDays, weekdayOf, zonedParts, zonedToUtc, NY, TORONTO } from './time.js';

function nthWeekday(year, month, weekday, n) {
  const first = weekdayOf(ymd(year, month, 1));
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return ymd(year, month, day);
}

function lastWeekday(year, month, weekday) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWd = weekdayOf(ymd(year, month, daysInMonth));
  return ymd(year, month, daysInMonth - ((lastWd - weekday + 7) % 7));
}

// Anonymous Gregorian algorithm.
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

// NYSE rule: Saturday holidays observed Friday, Sunday holidays Monday,
// except New Year's Day on a Saturday is not observed (Dec 31 stays open).
function nyseObserved(dateStr, { skipSaturday = false } = {}) {
  const wd = weekdayOf(dateStr);
  if (wd === 6) return skipSaturday ? null : addDays(dateStr, -1);
  if (wd === 0) return addDays(dateStr, 1);
  return dateStr;
}

const SPECIAL_CLOSURES = {
  NYSE: {
    '2025-01-09': 'National Day of Mourning (President Carter)',
  },
  TSX: {},
};

export function nyseHolidays(year) {
  const h = {};
  const add = (d, name) => { if (d) h[d] = name; };
  add(nyseObserved(ymd(year, 1, 1), { skipSaturday: true }), "New Year's Day");
  add(nthWeekday(year, 1, 1, 3), 'Martin Luther King Jr. Day');
  add(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  add(addDays(easterSunday(year), -2), 'Good Friday');
  add(lastWeekday(year, 5, 1), 'Memorial Day');
  if (year >= 2022) add(nyseObserved(ymd(year, 6, 19)), 'Juneteenth');
  add(nyseObserved(ymd(year, 7, 4)), 'Independence Day');
  add(nthWeekday(year, 9, 1, 1), 'Labor Day');
  add(nthWeekday(year, 11, 4, 4), 'Thanksgiving Day');
  add(nyseObserved(ymd(year, 12, 25)), 'Christmas Day');
  for (const [d, n] of Object.entries(SPECIAL_CLOSURES.NYSE)) if (d.startsWith(String(year))) h[d] = n;
  return h;
}

// 1:00 p.m. ET early closes.
export function nyseEarlyCloses(year) {
  const e = {};
  const jul3 = ymd(year, 7, 3);
  if ([1, 2, 3, 4].includes(weekdayOf(jul3))) e[jul3] = 'Day before Independence Day';
  e[addDays(nthWeekday(year, 11, 4, 4), 1)] = 'Day after Thanksgiving';
  const dec24 = ymd(year, 12, 24);
  if ([1, 2, 3, 4].includes(weekdayOf(dec24))) e[dec24] = 'Christmas Eve';
  return e;
}

// TSX rules (Toronto). Early-close days are not modelled for TSX; the app
// labels TSX sessions for display only and briefings follow the NYSE calendar.
export function tsxHolidays(year) {
  const h = {};
  const monIfWeekend = (d) => {
    const wd = weekdayOf(d);
    return wd === 6 ? addDays(d, 2) : wd === 0 ? addDays(d, 1) : d;
  };
  h[monIfWeekend(ymd(year, 1, 1))] = "New Year's Day";
  h[nthWeekday(year, 2, 1, 3)] = 'Family Day';
  h[addDays(easterSunday(year), -2)] = 'Good Friday';
  // Victoria Day: Monday preceding May 25.
  const may25wd = weekdayOf(ymd(year, 5, 25));
  h[addDays(ymd(year, 5, 25), -((may25wd + 6) % 7 || 7))] = 'Victoria Day';
  h[monIfWeekend(ymd(year, 7, 1))] = 'Canada Day';
  h[nthWeekday(year, 8, 1, 1)] = 'Civic Holiday';
  h[nthWeekday(year, 9, 1, 1)] = 'Labour Day';
  h[nthWeekday(year, 10, 1, 2)] = 'Thanksgiving Day';
  const xmas = ymd(year, 12, 25);
  const wd = weekdayOf(xmas);
  if (wd === 6) { h[addDays(xmas, 2)] = 'Christmas Day'; h[addDays(xmas, 3)] = 'Boxing Day'; }
  else if (wd === 0) { h[addDays(xmas, 1)] = 'Christmas Day'; h[addDays(xmas, 2)] = 'Boxing Day'; }
  else if (wd === 5) { h[xmas] = 'Christmas Day'; h[addDays(xmas, 3)] = 'Boxing Day'; }
  else { h[xmas] = 'Christmas Day'; h[addDays(xmas, 1)] = 'Boxing Day'; }
  for (const [d, n] of Object.entries(SPECIAL_CLOSURES.TSX)) if (d.startsWith(String(year))) h[d] = n;
  return h;
}

const cache = new Map();
function yearData(exchange, year) {
  const k = `${exchange}:${year}`;
  if (!cache.has(k)) {
    cache.set(k, exchange === 'TSX'
      ? { holidays: tsxHolidays(year), early: {} }
      : { holidays: nyseHolidays(year), early: nyseEarlyCloses(year) });
  }
  return cache.get(k);
}

export function exchangeGroup(exchange) {
  return ['TSX', 'TSXV', 'NEO', 'CSE', 'XTSE', 'XTSX', 'Cboe Canada'].includes(exchange) ? 'TSX' : 'NYSE';
}

export function dayInfo(dateStr, exchange = 'NYSE') {
  const group = exchangeGroup(exchange);
  const year = Number(dateStr.slice(0, 4));
  const { holidays, early } = yearData(group, year);
  const wd = weekdayOf(dateStr);
  const tz = group === 'TSX' ? TORONTO : NY;
  if (wd === 0 || wd === 6) return { date: dateStr, open: false, reason: 'Weekend', tz };
  if (holidays[dateStr]) return { date: dateStr, open: false, reason: holidays[dateStr], tz };
  const earlyClose = !!early[dateStr];
  return {
    date: dateStr, open: true, tz,
    earlyClose, earlyReason: early[dateStr] || null,
    openMin: 9 * 60 + 30,
    closeMin: earlyClose ? 13 * 60 : 16 * 60,
  };
}

export function isTradingDay(dateStr, exchange = 'NYSE') {
  return dayInfo(dateStr, exchange).open;
}

export function nextTradingDay(dateStr, exchange = 'NYSE') {
  let d = addDays(dateStr, 1);
  for (let i = 0; i < 15; i++, d = addDays(d, 1)) if (isTradingDay(d, exchange)) return d;
  throw new Error('No trading day found within 15 days');
}

export function previousTradingDay(dateStr, exchange = 'NYSE') {
  let d = addDays(dateStr, -1);
  for (let i = 0; i < 15; i++, d = addDays(d, -1)) if (isTradingDay(d, exchange)) return d;
  throw new Error('No trading day found within 15 days');
}

// Market session for an instant: pre | regular | post | closed.
// Extended hours shown are the US consolidated windows (04:00-09:30, close-20:00).
export function sessionAt(date, exchange = 'NYSE') {
  const group = exchangeGroup(exchange);
  const tz = group === 'TSX' ? TORONTO : NY;
  const p = zonedParts(date, tz);
  const info = dayInfo(p.date, exchange);
  if (!info.open) return { session: 'closed', date: p.date, reason: info.reason };
  const m = p.minutes;
  if (m >= info.openMin && m < info.closeMin) return { session: 'regular', date: p.date, earlyClose: info.earlyClose };
  if (group === 'NYSE') {
    if (m >= 4 * 60 && m < info.openMin) return { session: 'pre', date: p.date };
    if (m >= info.closeMin && m < 20 * 60) return { session: 'post', date: p.date };
  }
  return { session: 'closed', date: p.date, reason: m < info.openMin ? 'Before open' : 'After close' };
}

// The three scheduled briefings for a NYSE trading date, as UTC instants.
export function briefingSlots(dateStr) {
  const info = dayInfo(dateStr, 'NYSE');
  if (!info.open) return [];
  const closeMinusHour = info.closeMin - 60;
  return [
    { kind: 'premarket', label: 'Premarket briefing', at: zonedToUtc(dateStr, 9, 15, NY) },
    { kind: 'first_hour', label: 'First-hour review', at: zonedToUtc(dateStr, 10, 30, NY) },
    {
      kind: 'pre_close', label: 'Before-close briefing',
      at: zonedToUtc(dateStr, Math.floor(closeMinusHour / 60), closeMinusHour % 60, NY),
      earlyClose: info.earlyClose,
    },
  ];
}

export function regularSessionBounds(dateStr, exchange = 'NYSE') {
  const info = dayInfo(dateStr, exchange);
  if (!info.open) return null;
  return {
    open: zonedToUtc(dateStr, 9, 30, info.tz),
    close: zonedToUtc(dateStr, Math.floor(info.closeMin / 60), info.closeMin % 60, info.tz),
    earlyClose: info.earlyClose,
  };
}

// Published NYSE schedule (nyse.com "Holidays & Trading Hours") used by tests
// to verify the rule engine. Update when NYSE publishes new years.
export const VERIFIED_NYSE = {
  2026: {
    holidays: ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'],
    early: ['2026-11-27', '2026-12-24'],
  },
  2027: {
    holidays: ['2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'],
    early: ['2027-11-26'],
  },
};
