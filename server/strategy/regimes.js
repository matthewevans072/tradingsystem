// Market regime labels from SPY, for reporting results by regime. A session's
// regime uses only daily closes up to the PREVIOUS session, so a label never
// depends on the day it describes. Not a trading filter.
import { previousTradingDay } from '../calendar.js';
import { dailyBars } from './metrics.js';

export const TREND_DAYS = 50;
export const VOL_DAYS = 20;
export const VOL_BANDS = { calm: 15, stressed: 25 }; // annualised %, calm < 15 <= normal <= 25 < stressed

const UNKNOWN = Object.freeze({ trend: 'unknown', volatility: 'unknown', label: 'unknown/unknown', asOf: null });

function std(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function volatilityBand(vol) {
  if (vol == null) return 'unknown';
  return vol < VOL_BANDS.calm ? 'calm' : vol > VOL_BANDS.stressed ? 'stressed' : 'normal';
}

// state[i]: what is known after the close of daily row i.
function stateAfter(closes, i) {
  let trend = 'unknown', sma = null, vol = null;
  if (i + 1 >= TREND_DAYS) {
    let s = 0;
    for (let k = i - TREND_DAYS + 1; k <= i; k++) s += closes[k];
    sma = s / TREND_DAYS;
    trend = closes[i] > sma ? 'up' : 'down'; // at or below the average counts as down
  }
  if (i >= VOL_DAYS) {
    const rets = [];
    for (let k = i - VOL_DAYS + 1; k <= i; k++) rets.push(closes[k] / closes[k - 1] - 1);
    vol = std(rets) * Math.sqrt(252) * 100;
  }
  return { trend, volatility: volatilityBand(vol), sma50: sma, vol20: vol, close: closes[i] };
}

export function buildRegimes(spyBars) {
  const days = spyBars?.length ? dailyBars(spyBars, null, null) : [];
  const dates = days.map((d) => d.date);
  const closes = days.map((d) => d.close);
  const states = days.map((_, i) => stateAfter(closes, i));
  const cache = new Map();

  function regimeAt(sessionDate) {
    if (!sessionDate || !dates.length) return UNKNOWN;
    if (cache.has(sessionDate)) return cache.get(sessionDate);
    let lo = 0, hi = dates.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < sessionDate) lo = mid + 1; else hi = mid; }
    const i = lo - 1;
    // Only the immediately preceding NYSE session counts; a gap in SPY data
    // leaves the regime unknown rather than carrying an old label forward.
    let r = UNKNOWN;
    if (i >= 0 && dates[i] === previousTradingDay(sessionDate)) {
      const s = states[i];
      r = { trend: s.trend, volatility: s.volatility, label: `${s.trend}/${s.volatility}`, asOf: dates[i], close: s.close, sma50: s.sma50, vol20: s.vol20 };
    }
    cache.set(sessionDate, r);
    return r;
  }

  return { regimeAt, sessions: dates.length, available: dates.length > 0, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
}
