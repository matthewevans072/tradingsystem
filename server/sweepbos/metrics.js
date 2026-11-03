// sweep-bos statistics (PRE-REGISTRATION.md sections 5 and 6): the report figures, the bootstrap interval, the
// random-direction null, the best-5% removal, the monthly share of gross gains, the criteria C1-C6, the
// candidate test and the pick rule. Pure arithmetic on trade lists; deterministic (fixed seeds, mulberry32).
export const SEEDS = Object.freeze({ bootstrap: 20261103, null: 20261104 });
export const BOOTSTRAP_N = 10000;
export const NULL_N = 1000;
export const MIN_TRADES = 100;
export const MAX_MONTH_SHARE = 0.40;
export const TIE_R = 0.02;
export const P_MAX = 0.05;
export const BEST_FRACTION = 0.05;

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

// 6.5: n, win rate, mean, median, profit factor, gross gain and loss, maximum drawdown of the cumulative sum (exit order).
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

// 6.1: the percentile bootstrap interval of the mean (index 249 and 9749 of the sorted resample means).
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

// 6.2: the random-direction null. Each simulation keeps every trade's R (u < 0.5) or takes its mirror's R
// (u >= 0.5); p = (1 + simulations with mean >= the actual mean) / (1 + n), one-sided.
export function nullTest(rs, mirrors, { n = NULL_N, seed = SEEDS.null } = {}) {
  const k = rs.length;
  if (!k || mirrors.length !== k) return { p: null, actualMean: mean(rs), nullMean: null, percentiles: null, atOrAbove: null, simulations: n, seed };
  const actual = mean(rs);
  const rand = mulberry32(seed);
  const sims = new Array(n);
  let atOrAbove = 0;
  for (let s = 0; s < n; s++) {
    let sum = 0;
    for (let i = 0; i < k; i++) sum += rand() < 0.5 ? rs[i] : mirrors[i];
    sims[s] = sum / k;
    if (sims[s] >= actual) atOrAbove++;
  }
  const sorted = [...sims].sort((a, b) => a - b);
  return { p: (1 + atOrAbove) / (1 + n), actualMean: actual, nullMean: mean(sims), percentiles: { p5: nearestRank(sorted, 5), p50: nearestRank(sorted, 50), p95: nearestRank(sorted, 95), p99: nearestRank(sorted, 99) }, atOrAbove, simulations: n, seed };
}

// 6.3: K = ceil(0.05 n), at least 1, removed from the top (ties: the earlier trade first); the mean of the rest.
export function bestRemoved(rs) {
  const n = rs.length;
  if (!n) return { K: 0, mean: null };
  const K = Math.max(1, Math.ceil(BEST_FRACTION * n));
  const order = rs.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i);
  const removed = new Set(order.slice(0, K).map((x) => x.i));
  const rest = rs.filter((_, i) => !removed.has(i));
  return { K, mean: mean(rest), removed: order.slice(0, K).map((x) => x.r) };
}

// 6.4: shares of the gross gains by calendar month of the entry session; the largest compared after rounding to 1e-6.
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

// 5: C1-C6 for one instrument's metrics object.
export function criteriaOf(m) {
  const c = {
    C1: { name: 'at least 100 completed trades', value: m.trades, pass: m.trades >= MIN_TRADES },
    C2: { name: 'mean R > 0 and bootstrap 95% lower bound > 0', value: { meanR: m.meanR, lower: m.bootstrap.lower }, pass: m.meanR != null && m.meanR > 0 && m.bootstrap.lower != null && m.bootstrap.lower > 0 },
    C3: { name: 'mean R at 2x costs > 0', value: m.meanR2x, pass: m.meanR2x != null && m.meanR2x > 0 },
    C4: { name: 'random-direction null, one-sided p < 0.05', value: m.nullTest.p, pass: m.nullTest.p != null && m.nullTest.p < P_MAX },
    C5: { name: 'mean R > 0 without the best 5% of trades', value: m.bestRemoved.mean, pass: m.bestRemoved.mean != null && m.bestRemoved.mean > 0 },
    C6: { name: 'no month holds more than 40% of the gross gains', value: m.monthShares.maxShare, pass: m.monthShares.maxShare != null && m.monthShares.maxShare <= MAX_MONTH_SHARE },
  };
  return { ...c, pass: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].every((k) => c[k].pass) };
}

// The figures of 6.5, the statistics of 6.1-6.4 and the criteria for one runSymbol result.
export function instrumentMetrics(result) {
  const trades = result.trades;
  const rs = trades.map((t) => t.R), rs2 = trades.map((t) => t.R2x), mirrors = trades.map((t) => t.mirror.R);
  const stats = basicStats(rs);
  const m = {
    symbol: result.symbol, sessionsInWindow: result.sessionsInWindow, trades: stats.n, winRate: stats.winRate, meanR: stats.mean, medianR: stats.median, profitFactor: stats.profitFactor,
    grossGainR: stats.grossGain, grossLossR: stats.grossLoss, sumR: stats.sum, maxDrawdownR: stats.maxDrawdown,
    meanR2x: stats.n ? mean(rs2) : null, avgHoldingMinutes: stats.n ? mean(trades.map((t) => t.holdingMinutes)) : null,
    exposureByHour: exposureByHour(trades),
    costPerTrade: { dollarsPerShareRoundTrip: 2 * result.costPerSide, meanR: stats.n ? mean(trades.map((t) => (2 * result.costPerSide) / t.risk)) : null },
    bootstrap: bootstrapInterval(rs), nullTest: nullTest(rs, mirrors), bestRemoved: bestRemoved(rs), monthShares: monthShares(trades),
    byDirection: { long: basicStats(trades.filter((t) => t.dir === 'long').map((t) => t.R)), short: basicStats(trades.filter((t) => t.dir === 'short').map((t) => t.R)) },
    stageCounts: result.stageCounts, outcomeCounts: result.outcomeCounts, account: result.account,
  };
  m.criteria = criteriaOf(m);
  return m;
}

// Pooled figures over both instruments, trades in exit order (session date, then symbol).
export function pooledMetrics(results) {
  const trades = results.flatMap((r) => r.trades).sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  const stats = basicStats(trades.map((t) => t.R));
  return { trades: stats.n, meanR: stats.mean, maxDrawdownR: stats.maxDrawdown, medianR: stats.median, winRate: stats.winRate, profitFactor: stats.profitFactor };
}

// A candidate passes C1-C6 on every instrument separately.
export const isCandidate = (perInstrument) => Object.values(perInstrument).length > 0 && Object.values(perInstrument).every((m) => m.criteria.pass);

// 5: the pick among candidates on pooled mean R; a tie within 0.02 R (rounded to 1e-6) goes to the smaller pooled
// maximum drawdown; still tied: NONE. No candidate: NONE. Report only.
export function pickRule(variants) {
  const candidates = variants.filter((v) => v.candidate);
  const ranking = [...variants].sort((a, b) => (b.pooled?.meanR ?? -Infinity) - (a.pooled?.meanR ?? -Infinity)).map((v) => ({ name: v.name, candidate: !!v.candidate, meanR: v.pooled?.meanR ?? null, maxDrawdownR: v.pooled?.maxDrawdownR ?? null }));
  if (!candidates.length) return { pick: null, reason: 'no variant qualifies on both instruments: NONE advances', ranking };
  // Values rounded to 1e-6 and compared as whole micro-units, so a difference of exactly 0.02 R is a tie.
  const u = (x) => Math.round(x * 1e6);
  const top = Math.max(...candidates.map((v) => u(v.pooled.meanR)));
  const tied = candidates.filter((v) => top - u(v.pooled.meanR) <= u(TIE_R));
  if (tied.length === 1) return { pick: tied[0].name, reason: `highest pooled mean R among ${candidates.length} candidate(s)`, ranking };
  const minDD = Math.min(...tied.map((v) => u(v.pooled.maxDrawdownR)));
  const best = tied.filter((v) => u(v.pooled.maxDrawdownR) === minDD);
  if (best.length === 1) return { pick: best[0].name, reason: `${tied.length} candidates within ${TIE_R} R of the top; the smaller pooled maximum drawdown`, ranking };
  return { pick: null, reason: `${best.length} candidates tied on pooled mean R (within ${TIE_R} R) and on pooled maximum drawdown: NONE advances`, ranking };
}
