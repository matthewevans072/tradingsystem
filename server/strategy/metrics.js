// Backtest metrics for the Strategy Lab. Pure functions over the engine's
// trade records (ENGINE-SPEC §7) and equity curve; nothing here reads the
// real portfolio. Randomness (bootstrap) comes from a seeded PRNG so every
// figure is reproducible.
import { zonedParts, NY } from '../time.js';

const EPS = 1e-9;

// ET session date of an instant. Regular-session bars (13:30-21:00 UTC) share
// their UTC date with New York, so Intl is only needed for early-UTC hours.
export function etDate(t) {
  if (t == null || t === '') return null;
  if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t; // already a session date
  if (typeof t === 'string' && t[10] === 'T' && t.endsWith('Z') && +t.slice(11, 13) >= 5) return t.slice(0, 10);
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCHours() >= 5 ? d.toISOString().slice(0, 10) : zonedParts(d, NY).date;
}

export function etHour(t) {
  if (t == null || t === '') return null;
  const d = t instanceof Date ? t : new Date(t);
  return Number.isNaN(d.getTime()) ? null : zonedParts(d, NY).hour;
}

// Small, well-known 32-bit PRNG (deterministic for a given seed).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);

function quantileSorted(xs, p) {
  const h = (xs.length - 1) * p;
  const lo = Math.floor(h);
  return lo + 1 < xs.length ? xs[lo] + (h - lo) * (xs[lo + 1] - xs[lo]) : xs[lo];
}

// Percentile bootstrap of the mean (resampling with replacement).
export function bootstrapMeanCI(values, { resamples = 10000, seed = 12345, level = 0.95 } = {}) {
  const v = values.filter(Number.isFinite);
  const n = v.length;
  const out = { n, mean: mean(v), lower: null, upper: null, level, resamples, seed, method: 'percentile bootstrap of the mean' };
  if (n < 2) return { ...out, note: 'needs at least 2 values' };
  const rnd = mulberry32(seed);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += v[Math.floor(rnd() * n)];
    means[r] = s / n;
  }
  means.sort();
  const a = (1 - level) / 2;
  return { ...out, lower: quantileSorted(means, a), upper: quantileSorted(means, 1 - a) };
}

export const isEndOfData = (t) => t.exit?.reason === 'end_of_data';
const rOf = (t) => t.pnl?.r;
const netOf = (t) => t.pnl?.net ?? 0;
const tradeKey = (t) => `${t.exit?.at ?? ''}|${t.entry?.at ?? ''}|${t.symbol ?? ''}|${t.id ?? ''}`;

// Chronological by exit, then entry, symbol and id (streaks follow exits).
export function sortTrades(trades) {
  return [...trades].sort((a, b) => (tradeKey(a) < tradeKey(b) ? -1 : tradeKey(a) > tradeKey(b) ? 1 : 0));
}

function longestStreak(trades, pred) {
  let best = 0, cur = 0;
  for (const t of trades) { cur = pred(t) ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
}

function profitFactorOf(nets) {
  const gp = sum(nets.filter((x) => x > 0));
  const gl = -sum(nets.filter((x) => x < 0));
  return { grossProfit: gp, grossLoss: gl, profitFactor: gl > 0 ? gp / gl : null, profitFactorNote: gl > 0 ? null : nets.length ? 'no losing trades' : 'no trades' };
}

// Peak-to-trough on equity; the peak starts at the starting equity so a loss
// from the first bar counts.
export function maxDrawdown(points, startingEquity = null) {
  let peak = startingEquity ?? -Infinity, peakAt = null, ddPct = 0, ddUsd = 0, at = null, fromAt = null;
  for (const p of points) {
    if (p.equity > peak) { peak = p.equity; peakAt = p.t; }
    if (peak > 0) {
      const dPct = ((peak - p.equity) / peak) * 100;
      if (dPct > ddPct + EPS) { ddPct = dPct; at = p.t; fromAt = peakAt; }
      ddUsd = Math.max(ddUsd, peak - p.equity);
    }
  }
  return { maxDrawdownPct: points.length ? ddPct : null, maxDrawdownUsd: points.length ? ddUsd : null, peakAt: fromAt, troughAt: at };
}

function inRange(d, from, to) {
  return d != null && (!from || d >= from) && (!to || d <= to);
}

function yearsBetween(from, to) {
  if (!from || !to) return null;
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) + 86400000) / (365.25 * 86400000);
}

const positionsOf = (p) => (Array.isArray(p.positions) ? p.positions.length : Number(p.positions) || 0);

// Outlier dependence: R statistics after removing the best trades by R; share
// of gross profit from the top decile by net; largest symbol share of net.
export function outlierDependence(trades) {
  const n = trades.length;
  const byR = [...trades].sort((a, b) => rOf(b) - rOf(a));
  const k5 = Math.ceil(n * 0.05);
  const rest1 = byR.slice(1), rest5 = byR.slice(k5);
  const byNet = [...trades].sort((a, b) => netOf(b) - netOf(a));
  const k10 = Math.ceil(n * 0.1);
  const gp = sum(trades.map(netOf).filter((x) => x > 0));
  const topGp = sum(byNet.slice(0, k10).map(netOf).filter((x) => x > 0));
  const net = sum(trades.map(netOf));
  const bySym = new Map();
  for (const t of trades) bySym.set(t.symbol, (bySym.get(t.symbol) || 0) + netOf(t));
  let top = null;
  for (const [symbol, v] of [...bySym].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (!top || v > top.net) top = { symbol, net: v };
  return {
    trades: n,
    meanRWithoutBest: mean(rest1.map(rOf)),
    netWithoutBest: n ? sum(rest1.map(netOf)) : null,
    best5PctCount: k5,
    meanRWithoutBest5Pct: mean(rest5.map(rOf)),
    netWithoutBest5Pct: n ? sum(rest5.map(netOf)) : null,
    top10PctCount: k10,
    top10PctShareOfGrossProfit: gp > 0 ? topGp / gp : null,
    largestSymbol: top && net > 0 ? { symbol: top.symbol, net: top.net, shareOfNet: top.net / net } : top ? { symbol: top.symbol, net: top.net, shareOfNet: null, note: 'net profit is not positive, so symbol shares are undefined' } : null,
  };
}

// ---------- grouping ----------

export function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it) ?? 'unknown';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

function countBy(items, keyFn) {
  return Object.fromEntries([...groupBy(items, keyFn)].map(([k, v]) => [k, v.length]).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

export function tradeStats(trades) {
  const rs = trades.map(rOf).filter(Number.isFinite);
  const nets = trades.map(netOf);
  const wins = nets.filter((x) => x > 0).length;
  const pf = profitFactorOf(nets);
  return {
    trades: trades.length, wins, winRate: trades.length ? wins / trades.length : null,
    meanR: mean(rs), sumR: sum(rs), net: sum(nets), profitFactor: pf.profitFactor,
  };
}

export function groupStats(trades, keyFn) {
  return [...groupBy(trades, keyFn)].map(([key, ts]) => ({ key: String(key), ...tradeStats(ts) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function universeIndex(universe) {
  const m = new Map();
  for (const s of universe?.symbols || []) m.set(s.symbol, s);
  return m;
}

const signalAt = (t) => t.signal?.at ?? t.entry?.at;

export function groupKeys({ universe, regimeAt } = {}) {
  const u = universeIndex(universe);
  const keys = {
    symbol: (t) => t.symbol,
    year: (t) => etDate(t.entry?.at)?.slice(0, 4),
    hour: (t) => { const h = etHour(signalAt(t)); return h == null ? null : `${String(h).padStart(2, '0')}:00 ET`; },
  };
  if (universe) {
    keys.cluster = (t) => u.get(t.symbol)?.cluster || 'none';
    keys.sector = (t) => u.get(t.symbol)?.sector || 'unknown';
  }
  if (regimeAt) {
    keys.regime = (t) => regimeAt(etDate(signalAt(t))).label;
    keys.regimeTrend = (t) => regimeAt(etDate(signalAt(t))).trend;
    keys.regimeVolatility = (t) => regimeAt(etDate(signalAt(t))).volatility;
  }
  return keys;
}

export function groupTables(trades, ctx = {}) {
  const keys = groupKeys(ctx);
  const out = {};
  for (const [name, fn] of Object.entries(keys)) out[name] = groupStats(trades, fn);
  if (ctx.universe) {
    const u = universeIndex(ctx.universe);
    const clusters = [...new Set((ctx.universe.symbols || []).map((s) => s.cluster).filter(Boolean))].sort();
    out.excludingCluster = Object.fromEntries(clusters.map((c) => [c, tradeStats(trades.filter((t) => u.get(t.symbol)?.cluster !== c))]));
  }
  return out;
}

// ---------- main ----------

export function computeMetrics({ trades = [], equityCurve = [], startingEquity, from = null, to = null, groups = null, excludeEndOfData = true, bootstrap = {} } = {}) {
  const all = sortTrades(trades);
  const eod = all.filter(isEndOfData);
  // Positions force-closed at the end of the data are not real exits: they
  // count in P/L but not in the per-trade statistics.
  const closed = excludeEndOfData ? all.filter((t) => !isEndOfData(t)) : all;
  const rs = closed.map(rOf).filter(Number.isFinite);
  const nets = closed.map(netOf);
  const winners = closed.filter((t) => netOf(t) > 0);
  const losers = closed.filter((t) => netOf(t) < 0);
  const pf = profitFactorOf(nets);
  const curve = equityCurve.filter((p) => inRange(etDate(p.t), from, to));
  const start = startingEquity ?? curve[0]?.equity ?? null;
  const netPnl = sum(all.map(netOf));
  const endEquity = curve.length ? curve[curve.length - 1].equity : start != null ? start + netPnl : null;
  const dd = maxDrawdown(curve, start);

  const avgEquity = curve.length ? mean(curve.map((p) => p.equity)) : start;
  const notional = sum(all.map((t) => {
    const sh = t.entry?.shares ?? 0;
    return sh * (t.entry?.raw ?? t.entry?.price ?? 0) + sh * (t.exit?.raw ?? t.exit?.price ?? 0);
  }));
  const dFrom = from ?? etDate(curve[0]?.t), dTo = to ?? etDate(curve[curve.length - 1]?.t);
  const years = yearsBetween(dFrom, dTo);
  const turnover = avgEquity > 0 ? notional / avgEquity : null;

  const side = (k) => sum(all.map((t) => (t.entry?.[k] ?? 0) + (t.exit?.[k] ?? 0)));
  const costTotal = sum(all.map((t) => t.pnl?.costs ?? 0));
  const ambiguous = closed.filter((t) => t.exit?.ambiguous);
  const beyond = closed.filter((t) => rOf(t) < -1 - EPS);
  const gaps = closed.filter((t) => t.exit?.gapThrough);

  const m = {
    from: dFrom, to: dTo, startingEquity: start,
    trades: closed.length, allTrades: all.length,
    endOfData: { trades: eod.length, net: sum(eod.map(netOf)), excludedFromTradeStats: excludeEndOfData },
    netPnl, endEquity,
    returnPct: start > 0 && endEquity != null ? ((endEquity - start) / start) * 100 : null,
    wins: winners.length, losses: losers.length, breakeven: closed.length - winners.length - losers.length,
    winRate: closed.length ? winners.length / closed.length : null,
    avgWinR: mean(winners.map(rOf).filter(Number.isFinite)),
    avgLossR: mean(losers.map(rOf).filter(Number.isFinite)),
    meanR: mean(rs), expectancyR: mean(rs), medianR: rs.length ? quantileSorted([...rs].sort((a, b) => a - b), 0.5) : null, sumR: sum(rs),
    expectancyUsd: mean(nets),
    ...pf,
    meanRCI: bootstrap === false ? null : bootstrapMeanCI(rs, bootstrap || {}),
    maxDrawdownPct: dd.maxDrawdownPct, maxDrawdownUsd: dd.maxDrawdownUsd, maxDrawdownPeakAt: dd.peakAt, maxDrawdownTroughAt: dd.troughAt,
    longestLosingStreak: longestStreak(closed, (t) => netOf(t) < 0),
    longestWinningStreak: longestStreak(closed, (t) => netOf(t) > 0),
    exposure: {
      points: curve.length,
      pctTimeInMarket: curve.length ? (curve.filter((p) => positionsOf(p) > 0).length / curve.length) * 100 : null,
      avgPositions: curve.length ? mean(curve.map(positionsOf)) : null,
      avgGrossExposurePct: curve.length ? mean(curve.map((p) => (p.equity > 0 ? ((p.grossExposure || 0) / p.equity) * 100 : 0))) : null,
    },
    turnover: { notional, avgEquity, turnover, years, annualised: turnover != null && years > 0 ? turnover / years : null },
    costs: {
      commission: side('commission'), spreadSlippage: side('spreadSlippage'), fx: side('fx'), total: costTotal,
      perTrade: all.length ? costTotal / all.length : null,
    },
    tail: {
      beyondMinus1R: beyond.length, beyondMinus1RRate: closed.length ? beyond.length / closed.length : null,
      gapThroughs: gaps.length, gapThroughStops: gaps.filter((t) => t.exit?.reason === 'stop').length,
      worstR: rs.length ? Math.min(...rs) : null, bestR: rs.length ? Math.max(...rs) : null,
    },
    ambiguous: {
      count: ambiguous.length,
      byResolution: countBy(ambiguous, (t) => t.exit?.resolvedBy || 'unknown'),
    },
    intrabarLimitEntries: closed.filter((t) => (t.entry?.flags || []).includes('intrabar_limit_entry')).length,
    outliers: outlierDependence(closed),
    holding: {
      avgBars: mean(closed.map((t) => t.holdBars).filter(Number.isFinite)),
      avgSessions: mean(closed.map((t) => t.holdSessions).filter(Number.isFinite)),
    },
    exitReasons: countBy(all, (t) => t.exit?.reason),
  };
  if (groups) m.groups = groupTables(closed, groups);
  return m;
}

// ---------- buy and hold ----------

const barsOf = (bars, sym) => (bars instanceof Map ? bars.get(sym) : bars?.[sym]) || [];

// One row per ET session in [from, to]: first open and last close.
export function dailyBars(list, from, to) {
  const out = [];
  for (const b of list) {
    const d = etDate(b.t);
    if (!inRange(d, from, to)) continue;
    const last = out[out.length - 1];
    if (last && last.date === d) { last.close = b.c; } else out.push({ date: d, open: b.o, close: b.c });
  }
  return out;
}

// Equal money in each symbol at its first open in the range, held without
// rebalancing or costs, valued at daily closes (cash until a symbol's first bar).
function holdPortfolio(series, startingEquity) {
  const syms = Object.keys(series);
  if (!syms.length) return null;
  const alloc = startingEquity / syms.length;
  const dates = [...new Set(syms.flatMap((s) => series[s].map((r) => r.date)))].sort();
  const st = Object.fromEntries(syms.map((s) => [s, { i: 0, shares: alloc / series[s][0].open, last: null }]));
  const points = dates.map((date) => {
    let v = 0;
    for (const s of syms) {
      const x = st[s], rows = series[s];
      while (x.i < rows.length && rows[x.i].date <= date) x.last = rows[x.i++].close;
      v += x.last == null ? alloc : x.shares * x.last;
    }
    return { t: date, equity: v };
  });
  const end = points[points.length - 1].equity;
  const dd = maxDrawdown(points, startingEquity);
  const returnPct = ((end - startingEquity) / startingEquity) * 100;
  return {
    symbols: syms, startDate: dates[0], endDate: dates[dates.length - 1], sessions: dates.length,
    endEquity: end, returnPct, maxDrawdownPct: dd.maxDrawdownPct,
    returnPerDrawdown: dd.maxDrawdownPct > 0 ? returnPct / dd.maxDrawdownPct : null,
  };
}

export function buyAndHold({ bars, symbols, from, to, startingEquity = 100000, benchmark = 'SPY' }) {
  const series = {}, missing = [];
  for (const s of symbols.map((x) => (typeof x === 'string' ? x : x.symbol))) {
    const d = dailyBars(barsOf(bars, s), from, to);
    if (d.length && d[0].open > 0) series[s] = d; else missing.push(s);
  }
  return {
    from, to, startingEquity, basis: 'bought at the first regular-session open in the range, valued at daily closes; no costs, dividends or rebalancing',
    equalWeight: holdPortfolio(series, startingEquity), equalWeightMissing: missing,
    benchmark, spy: series[benchmark] ? holdPortfolio({ [benchmark]: series[benchmark] }, startingEquity) : null,
  };
}
