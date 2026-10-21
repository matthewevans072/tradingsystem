// Decides whether a stored quote is current, using the exchange calendar.
//
// - During the regular session a quote is "fresh" if its timestamp is within
//   (provider delay + 15 minutes) of now; otherwise "stale".
// - Outside the regular session a quote is "fresh" if it belongs to the most
//   recent regular session (i.e. it is that session's closing/last value);
//   a quote from an earlier session is "stale".
import { sessionAt, previousTradingDay, regularSessionBounds, isTradingDay } from './calendar.js';
import { zonedParts, NY, TORONTO } from './time.js';
import { exchangeGroup } from './calendar.js';

export const LIVE_GRACE_MIN = 15;

export function lastCompletedOrCurrentSession(now, exchange) {
  const tz = exchangeGroup(exchange) === 'TSX' ? TORONTO : NY;
  const d = zonedParts(now, tz).date;
  if (isTradingDay(d, exchange)) {
    const b = regularSessionBounds(d, exchange);
    if (now >= b.open) return { date: d, ...b };
  }
  const p = previousTradingDay(d, exchange);
  return { date: p, ...regularSessionBounds(p, exchange) };
}

export function assessFreshness(q, now = new Date(), exchange = 'NYSE') {
  if (!q || q.price == null) return { freshness: 'missing', reason: 'No valid quote stored' };
  if (!q.quote_time) return { freshness: 'unknown', reason: 'Provider did not supply a quote timestamp' };
  const qt = new Date(q.quote_time);
  const ageMin = (now - qt) / 60000;
  const s = sessionAt(now, exchange);
  if (s.session === 'regular') {
    const limit = (q.delay_minutes || 0) + LIVE_GRACE_MIN;
    return ageMin <= limit
      ? { freshness: 'fresh', reason: `Updated ${Math.max(0, Math.round(ageMin))} min ago` }
      : { freshness: 'stale', reason: `Last update ${Math.round(ageMin)} min ago during an open session` };
  }
  const last = lastCompletedOrCurrentSession(now, exchange);
  if (qt >= last.open) return { freshness: 'fresh', reason: `Latest value from the ${last.date} session` };
  return { freshness: 'stale', reason: `Quote is from before the ${last.date} session` };
}
