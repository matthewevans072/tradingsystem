// Price-history statistics computed only from stored provider bars.
export function dailyBars(db, instrumentId, limit = 260) {
  return db.prepare(`SELECT ts, o, h, l, c, v FROM bars WHERE instrument_id = ? AND interval = '1day' ORDER BY ts DESC LIMIT ?`)
    .all(instrumentId, limit).reverse();
}

export function intradayBars(db, instrumentId, date) {
  return db.prepare(`SELECT ts, o, h, l, c, v, session FROM bars WHERE instrument_id = ? AND interval = '5min' AND ts >= ? AND ts < ? ORDER BY ts`)
    .all(instrumentId, `${date}T00:00:00Z`, `${date}T23:59:59Z`);
}

function sma(values, n) {
  if (values.length < n) return null;
  const s = values.slice(-n);
  return s.reduce((a, b) => a + b, 0) / n;
}

export function indicators(bars) {
  if (!bars.length) return { bars: 0 };
  const closes = bars.map((b) => b.c);
  const last = bars[bars.length - 1];
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].c;
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)));
  }
  const atr14 = trs.length >= 14 ? trs.slice(-14).reduce((a, b) => a + b, 0) / 14 : null;
  const last20 = bars.slice(-20);
  const last252 = bars.slice(-252);
  const sma20 = sma(closes, 20), sma50 = sma(closes, 50), sma200 = sma(closes, 200);
  const sma20Prev = closes.length >= 25 ? sma(closes.slice(0, -5), 20) : null;
  const vols = bars.map((b) => b.v).filter((v) => v != null);
  return {
    bars: bars.length,
    lastDate: last.ts,
    lastClose: last.c,
    prevDay: bars.length >= 1 ? { date: last.ts, high: last.h, low: last.l, close: last.c } : null,
    sma20, sma50, sma200,
    sma20Slope: sma20 != null && sma20Prev != null ? (sma20 > sma20Prev ? 'rising' : sma20 < sma20Prev ? 'falling' : 'flat') : null,
    atr14,
    atrPct: atr14 && last.c ? (atr14 / last.c) * 100 : null,
    high20: last20.length === 20 ? Math.max(...last20.map((b) => b.h)) : null,
    low20: last20.length === 20 ? Math.min(...last20.map((b) => b.l)) : null,
    high52: last252.length >= 200 ? Math.max(...last252.map((b) => b.h)) : null,
    low52: last252.length >= 200 ? Math.min(...last252.map((b) => b.l)) : null,
    avgVol50: vols.length >= 50 ? vols.slice(-50).reduce((a, b) => a + b, 0) / 50 : null,
  };
}

export function trendState(ind, price) {
  if (!ind || ind.sma50 == null || price == null) return 'unknown';
  const above50 = price > ind.sma50;
  const above20 = ind.sma20 != null && price > ind.sma20;
  if (above50 && above20 && ind.sma20Slope === 'rising') return 'uptrend';
  if (!above50 && !above20 && ind.sma20Slope === 'falling') return 'downtrend';
  return 'mixed';
}

// Opening range and regular-session range from intraday bars that the
// provider supplied. Never reconstructed from a handful of scheduled checks.
export function sessionStats(bars, { openingMinutes = 30 } = {}) {
  const reg = bars.filter((b) => b.session === 'regular');
  const pre = bars.filter((b) => b.session === 'pre');
  const post = bars.filter((b) => b.session === 'post');
  const range = (xs) => (xs.length ? { high: Math.max(...xs.map((b) => b.h)), low: Math.min(...xs.map((b) => b.l)), bars: xs.length, from: xs[0].ts, to: xs[xs.length - 1].ts } : null);
  const or = reg.length ? reg.filter((b) => new Date(b.ts) - new Date(reg[0].ts) < openingMinutes * 60000) : [];
  return {
    regular: range(reg),
    openingRange: or.length ? { ...range(or), minutes: openingMinutes } : null,
    premarket: range(pre),
    afterHours: range(post),
    regularVolume: reg.length ? reg.reduce((s, b) => s + (b.v || 0), 0) : null,
  };
}
