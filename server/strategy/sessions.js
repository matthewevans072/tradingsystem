// Session facts for 15-minute bars, taken from the exchange calendar
// (server/calendar.js: holidays, early closes, DST) and never from the data:
// whether the next bar is in a new session is known at a bar's close without
// looking at the next bar.
import { regularSessionBounds, exchangeGroup, nextTradingDay, isTradingDay } from '../calendar.js';
import { zonedParts, zonedToUtc, addDays, NY, TORONTO } from '../time.js';

export const BAR_MINUTES = 15;
const MIN = 60000;

const tzOf = (exchange) => (exchangeGroup(exchange) === 'TSX' ? TORONTO : NY);

// Exchange-local date of an instant. New York and Toronto are UTC-4/-5, so any
// instant at or after 05:00 UTC has the same date there as in UTC.
export function localDate(t, exchange = 'NYSE') {
  const ms = typeof t === 'number' ? t : Date.parse(t);
  const d = new Date(ms);
  return d.getUTCHours() >= 5 ? d.toISOString().slice(0, 10) : zonedParts(d, tzOf(exchange)).date;
}

const boundsCache = new Map();
// { date, openMs, closeMs, earlyClose } for a trading day, or null.
export function sessionBounds(date, exchange = 'NYSE') {
  const k = `${exchangeGroup(exchange)}|${date}`;
  let b = boundsCache.get(k);
  if (b === undefined) {
    const r = regularSessionBounds(date, exchange);
    b = r ? Object.freeze({ date, openMs: r.open.getTime(), closeMs: r.close.getTime(), earlyClose: r.earlyClose }) : null;
    boundsCache.set(k, b);
  }
  return b;
}

const infoCache = new Map();
// Facts about the bar that starts at t: its session date (exchange-local), the
// session's open and close, where the bar ends, minutes from the bar's end to
// the close, whether it is the session's last bar (so the next bar is in a new
// session), and whether it lies inside the regular session on the bar grid.
export function barInfo(t, exchange = 'NYSE', intervalMinutes = BAR_MINUTES) {
  const ms = typeof t === 'number' ? t : Date.parse(t);
  const k = `${exchangeGroup(exchange)}|${intervalMinutes}|${ms}`;
  let r = infoCache.get(k);
  if (r) return r;
  const date = localDate(ms, exchange);
  const s = sessionBounds(date, exchange);
  const endMs = ms + intervalMinutes * MIN;
  if (!s) r = { startMs: ms, endMs, date, inSession: false, reason: 'no session that day' };
  else {
    const inSession = ms >= s.openMs && endMs <= s.closeMs;
    const aligned = (ms - s.openMs) % (intervalMinutes * MIN) === 0;
    r = {
      startMs: ms, endMs, date, openMs: s.openMs, closeMs: s.closeMs, earlyClose: s.earlyClose,
      inSession, aligned, index: Math.floor((ms - s.openMs) / (intervalMinutes * MIN)),
      isLast: endMs >= s.closeMs, minutesToClose: (s.closeMs - endMs) / MIN,
      reason: inSession ? null : ms < s.openMs ? 'before the open' : 'after the close',
    };
  }
  if (infoCache.size > 200000) infoCache.clear();
  infoCache.set(k, Object.freeze(r));
  return r;
}

export const sessionDate = (t, exchange = 'NYSE') => localDate(t, exchange);
export const isLastBarOfSession = (t, exchange = 'NYSE', intervalMinutes = BAR_MINUTES) => !!barInfo(t, exchange, intervalMinutes).isLast;
export const minutesToClose = (t, exchange = 'NYSE', intervalMinutes = BAR_MINUTES) => barInfo(t, exchange, intervalMinutes).minutesToClose ?? null;
// The next bar of this exchange starts in another session (it is the next
// trading day's first bar).
export const nextBarInNewSession = isLastBarOfSession;

// True when the bar ends at or after (session close - minutes).
export function endsWithinMinutesOfClose(t, minutes, exchange = 'NYSE', intervalMinutes = BAR_MINUTES) {
  const b = barInfo(t, exchange, intervalMinutes);
  return b.inSession ? b.endMs >= b.closeMs - minutes * MIN : false;
}

// Start (ms) of the bar that follows the bar starting at t, per the calendar.
export function nextBarStartMs(t, exchange = 'NYSE', intervalMinutes = BAR_MINUTES) {
  const b = barInfo(t, exchange, intervalMinutes);
  if (b.inSession && !b.isLast) return b.endMs;
  const d = b.inSession ? b.date : (isTradingDay(b.date, exchange) && b.startMs < b.openMs ? addDays(b.date, -1) : b.date);
  return sessionBounds(nextTradingDay(d, exchange), exchange).openMs;
}

// The date n trading sessions after `date` (n = 0 returns date itself).
export function addSessions(date, n, exchange = 'NYSE') {
  let d = date;
  for (let i = 0; i < n; i++) d = nextTradingDay(d, exchange);
  return d;
}

// Trading sessions from `from` to `to` inclusive (0 if to < from).
export function sessionsBetween(from, to, exchange = 'NYSE') {
  if (to < from) return 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isTradingDay(d, exchange)) n++;
  return n;
}

// Every regular-session bar start (ms) of a trading day, in order.
export function sessionBarStarts(date, exchange = 'NYSE', intervalMinutes = BAR_MINUTES) {
  const s = sessionBounds(date, exchange);
  if (!s) return [];
  const out = [];
  for (let t = s.openMs; t + intervalMinutes * MIN <= s.closeMs; t += intervalMinutes * MIN) out.push(t);
  return out;
}

export function expectedBarsInSession(date, exchange = 'NYSE', intervalMinutes = BAR_MINUTES) {
  const s = sessionBounds(date, exchange);
  return s ? Math.floor((s.closeMs - s.openMs) / (intervalMinutes * MIN)) : 0;
}

// Trading days between two dates inclusive.
export function tradingDays(from, to, exchange = 'NYSE') {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isTradingDay(d, exchange)) out.push(d);
  return out;
}

// Start of a calendar date in the exchange's zone (ms): bounds for date-only
// from/to arguments.
export function dayStartMs(date, exchange = 'NYSE') {
  return zonedToUtc(date, 0, 0, tzOf(exchange)).getTime();
}

export function etClock(t, exchange = 'NYSE') {
  const p = zonedParts(new Date(typeof t === 'number' ? t : Date.parse(t)), tzOf(exchange));
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
