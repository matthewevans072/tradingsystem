// ICT Lab statistics (strategy/ict-lab/PROTOCOL.md sections 7 and 9, exactly): the report figures, the bootstrap
// interval, the random-entry null that keeps the long drift, the best-5% removal, the monthly share of gross
// gains and the criteria C1-C6 with the fixed-denominator alpha. Pure arithmetic on trade lists and session
// bars; deterministic (fixed seeds, mulberry32). The numbers here are PROTOCOL.md's, stated once.
import { toU, simulateExit, rOf } from './rules.js';

export const SEEDS = Object.freeze({ bootstrap: 20261104, null: 20261105 });
export const BOOTSTRAP_N = 10000;
export const NULL_N = 10000;
export const TEST_BUDGET = 24;                       // 8 specs x 3 rounds, fixed from the start (section 7)
export const ALPHA = 0.05 / TEST_BUDGET;             // 0.0020833...
export const MIN_TRADES = Object.freeze({ development: 100, validation: 40 });
export const MAX_MONTH_SHARE = 0.40;
export const BEST_FRACTION = 0.05;

// The generator of sweep-bos section 6, retained (section 9).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// 9.5: n, win rate, mean, median, profit factor, gross gain and loss, maximum drawdown of the cumulative sum (exit order).
export function basicStats(rs) {
  const n = rs.length;
  if (!n) return { n: 0, winRate: null, mean: null, median: null, profitFactor: null, grossGain: 0, grossLoss: 0, maxDrawdown: null, sum: 0 };
  const sorted = [...rs].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const grossGain = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossLoss = -rs.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  let cum = 0, peak = 0, maxDrawdown = 0;
  for (const r of rs) { cum += r; if (cum > peak) peak = cum; if (peak - cum > maxDrawdown) maxDrawdown = peak - cum; }
  return { n, winRate: rs.filter((r) => r > 0).length / n, mean: mean(rs), median, profitFactor: grossLoss > 0 ? grossGain / grossLoss : null, grossGain, grossLoss, maxDrawdown, sum: rs.reduce((a, b) => a + b, 0) };
}

// 9.1: 10,000 resamples with replacement of the R values in exit order, one generator; the sorted means' 250th
// smallest (index 249) and 9,750th (index 9749).
export function bootstrapInterval(rs, { n = BOOTSTRAP_N, seed = SEEDS.bootstrap } = {}) {
  const k = rs.length;
  if (!k) return { lower: null, upper: null, resamples: n, seed };
  const rand = mulberry32(seed);
  const means = new Array(n);
  for (let b = 0; b < n; b++) {
    let s = 0;
    for (let i = 0; i < k; i++) s += rs[Math.floor(rand() * k)];
    means[b] = s / k;
  }
  means.sort((a, b) => a - b);
  return { lower: means[Math.floor(0.025 * n)], upper: means[Math.ceil(0.975 * n) - 1], resamples: n, seed };
}

const nearestRank = (sorted, p) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];

// 9.2 (the owner's definition): for each real trade (fill bar index m, stop distance D), a pseudo-trade enters
// long at the open of bar m of a complete session drawn uniformly with replacement from the window's complete
// sessions, stop O - D, target O + rMultiple x D, exited by the same rule (H16) with the same costs:
// R_null = ((EXIT - c) - (O + c)) / D. One resample draws one session per trade, independently; its mean R_null is
// recorded. p = (1 + resampled means at or above the actual mean R) / (1 + n). Percentiles by nearest rank.
// `sessions` are the complete sessions' bars in units ([{ date, bars }]); `trades` carry fillIdx and stopDistance.
export function nullTest(trades, sessions, { n = NULL_N, seed = SEEDS.null, perSide, rMultiple } = {}) {
  const k = trades.length, S = sessions.length;
  const actual = mean(trades.map((t) => t.R));
  if (!k || !S) return { p: null, actualMean: actual, nullMean: null, percentiles: null, atOrAbove: null, resamples: n, seed, sessions: S };
  const cU = toU(perSide);
  const pre = trades.map((t) => ({ m: t.fillIdx, D: toU(t.stopDistance) }));
  const rand = mulberry32(seed);
  const sims = new Array(n);
  let atOrAbove = 0;
  for (let r = 0; r < n; r++) {
    let sum = 0;
    for (let i = 0; i < k; i++) {
      const { m, D } = pre[i];
      const bars = sessions[Math.floor(rand() * S)].bars;
      const O = bars[m].o;
      const ex = simulateExit(bars, m, O - D, O + Math.round(rMultiple * D));
      sum += rOf(O, ex.exit, D, cU);
    }
    sims[r] = sum / k;
    if (sims[r] >= actual) atOrAbove++;
  }
  const sorted = [...sims].sort((a, b) => a - b);
  return { p: (1 + atOrAbove) / (1 + n), actualMean: actual, nullMean: mean(sims), percentiles: { p5: nearestRank(sorted, 5), p50: nearestRank(sorted, 50), p95: nearestRank(sorted, 95), p99: nearestRank(sorted, 99) }, atOrAbove, resamples: n, seed, sessions: S };
}

// 9.3: K = ceil(0.05 n), at least 1, removed from the top (ties: the earlier exit first); the mean of the rest.
export function bestRemoved(rs) {
  const n = rs.length;
  if (!n) return { K: 0, mean: null, removed: [] };
  const K = Math.max(1, Math.ceil(BEST_FRACTION * n));
  const order = rs.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i);
  const removed = new Set(order.slice(0, K).map((x) => x.i));
  const rest = rs.filter((_, i) => !removed.has(i));
  return { K, mean: mean(rest), removed: order.slice(0, K).map((x) => x.r) };
}

// 9.4: shares of the gross gains by calendar month of the entry session; the largest compared after rounding to 1e-6.
export function monthShares(trades) {
  const gains = {};
  let G = 0;
  for (const t of trades) if (t.R > 0) { const m = t.session.slice(0, 7); gains[m] = (gains[m] || 0) + t.R; G += t.R; }
  const shares = Object.entries(gains).sort().map(([month, gain]) => ({ month, gain, share: G > 0 ? gain / G : null }));
  let max = null;
  for (const s of shares) if (s.share != null && (max == null || s.share > max.share)) max = s;
  return { shares, maxShare: max ? round6(max.share) : null, maxMonth: max ? max.month : null, grossGain: G };
}

export function exposureByHour(trades) {
  const bars = {};
  let total = 0;
  for (const t of trades) for (const [h, c] of Object.entries(t.hoursHeld || {})) { bars[h] = (bars[h] || 0) + c; total += c; }
  const out = {};
  for (const h of Object.keys(bars).sort()) out[h] = { bars: bars[h], share: total ? bars[h] / total : null };
  return { byHour: out, totalBars: total };
}

// Section 7 (development) and section 8 (validation: C1 of 40): C1-C6 for one spec's metrics object.
export function criteriaOf(m, { window = 'development' } = {}) {
  const minTrades = MIN_TRADES[window];
  if (minTrades == null) throw new Error(`no criteria for window ${window}`);
  const c = {
    C1: { name: `at least ${minTrades} completed trades`, value: m.trades, pass: m.trades >= minTrades },
    C2: { name: 'mean R after costs > 0 and bootstrap 95% lower bound > 0', value: { meanR: m.meanR, lower: m.bootstrap.lower }, pass: m.meanR != null && m.meanR > 0 && m.bootstrap.lower != null && m.bootstrap.lower > 0 },
    C3: { name: 'mean R at 2x costs > 0', value: m.meanR2x, pass: m.meanR2x != null && m.meanR2x > 0 },
    C4: { name: `random-entry null, one-sided p < ${ALPHA.toFixed(7)} (0.05 / ${TEST_BUDGET})`, value: m.nullTest.p, pass: m.nullTest.p != null && m.nullTest.p < ALPHA },
    C5: { name: 'mean R > 0 without the best 5% of trades', value: m.bestRemoved.mean, pass: m.bestRemoved.mean != null && m.bestRemoved.mean > 0 },
    C6: { name: `no month holds more than ${MAX_MONTH_SHARE} of the gross gains`, value: m.monthShares.maxShare, pass: m.monthShares.maxShare != null && m.monthShares.maxShare <= MAX_MONTH_SHARE },
  };
  return { ...c, window, minTrades, alpha: ALPHA, pass: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].every((k) => c[k].pass) };
}

// The figures of 9.5, the statistics of 9.1-9.4 and the criteria for one runSpec result. `sessions` default to
// the result's complete sessions (the null's population).
export function specMetrics(result, { window = 'development', sessions = result.completeSessions || [], nullN = NULL_N, bootstrapN = BOOTSTRAP_N } = {}) {
  const trades = result.trades;
  const rs = trades.map((t) => t.R), rs2 = trades.map((t) => t.R2x);
  const stats = basicStats(rs);
  const m = {
    spec: result.spec, window, sessionsInWindow: result.sessionsInWindow, trades: stats.n, winRate: stats.winRate, meanR: stats.mean, medianR: stats.median, profitFactor: stats.profitFactor,
    grossGainR: stats.grossGain, grossLossR: stats.grossLoss, sumR: stats.sum, maxDrawdownR: stats.maxDrawdown,
    meanR2x: stats.n ? mean(rs2) : null, avgHoldingMinutes: stats.n ? mean(trades.map((t) => t.holdingMinutes)) : null,
    exposureByHour: exposureByHour(trades),
    costPerTrade: { dollarsPerShareRoundTrip: 2 * result.costPerSide, meanR: stats.n ? mean(trades.map((t) => (2 * result.costPerSide) / t.stopDistance)) : null },
    bootstrap: bootstrapInterval(rs, { n: bootstrapN }), nullTest: nullTest(trades, sessions, { n: nullN, perSide: result.costPerSide, rMultiple: result.rMultiple }), bestRemoved: bestRemoved(rs), monthShares: monthShares(trades),
    stageCounts: result.stageCounts, exitCounts: result.exitCounts, funnel: result.funnel, counts: result.counts, account: result.account,
    sizing: { cashCapped: result.counts.cashCapped, cashCappedShare: stats.n ? result.counts.cashCapped / stats.n : null, unfunded: result.counts.unfunded, lossExceededRisk: result.counts.lossExceededRisk, meanPlannedRiskActual: stats.n ? mean(trades.map((t) => t.plannedRiskActual)) : null, meanPlannedRiskShareOfEquity: stats.n ? mean(trades.map((t) => t.plannedRiskActual / t.cashBefore)) : null, meanPlannedRiskMax: stats.n ? mean(trades.map((t) => t.plannedRiskMax)) : null },
  };
  m.criteria = criteriaOf(m, { window });
  m.candidate = m.criteria.pass;
  return m;
}

// The funnel with the count and share lost at each stage (section 11), from a metrics object or run result.
export function funnelOf(f) {
  const steps = [['sessions in the window', f.sessions], ['tradeable (complete, with a complete prior session)', f.tradeable], ['with a sweep', f.sweeps], ['setups confirmed', f.confirmed], ['with a usable zone', f.usableZone], ['orders placed', f.orders], ['fills', f.fills]];
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const [name, count] = steps[i];
    const prevCount = i ? steps[i - 1][1] : null;
    out.push({ stage: name, count, lost: prevCount == null ? null : prevCount - count, lostShare: prevCount ? (prevCount - count) / prevCount : null });
  }
  return out;
}
// The stage that loses the most (by count; ties to the earlier stage), for the flaw section.
export function worstStage(funnel) {
  let worst = null;
  for (const s of funnel) if (s.lost != null && (worst == null || s.lost > worst.lost)) worst = s;
  return worst;
}
