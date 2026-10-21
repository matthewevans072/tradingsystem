import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMetrics, bootstrapMeanCI, mulberry32, maxDrawdown, outlierDependence, groupTables, buyAndHold, etDate, etHour, dailyBars,
} from '../server/strategy/metrics.js';
import { buildRegimes, volatilityBand } from '../server/strategy/regimes.js';
import { isTradingDay } from '../server/calendar.js';
import { addDays } from '../server/time.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// Handcrafted trades in the ENGINE-SPEC §7 shape (only the fields metrics read).
function trade(id, symbol, day, { net, r, reason = net > 0 ? 'target' : 'stop', gap = false, ambiguous = false, resolvedBy = null, shares = 100, entryRaw = 50, exitRaw = 52 }) {
  return {
    id, symbol, mode: 'intraday', version: '1.0.0', configHash: 'h',
    signal: { at: `${day}T15:15:00Z` },
    entry: { at: `${day}T15:30:00Z`, raw: entryRaw, price: entryRaw, shares, commission: 1, spreadSlippage: 2, fx: 0, flags: [] },
    exit: { at: `${day}T19:00:00Z`, reason, raw: exitRaw, price: exitRaw, commission: 1, spreadSlippage: 2, fx: 0, gapThrough: gap, ambiguous, resolvedBy },
    pnl: { gross: net + 6, costs: 6, net, r },
    holdBars: 14, holdSessions: 1,
  };
}

// Exit order W L L L W L W, plus one position force-closed at the end of data.
const TRADES = [
  trade(1, 'AAA', '2024-03-04', { net: 200, r: 2 }),
  trade(2, 'BBB', '2024-03-05', { net: -100, r: -1 }),
  trade(3, 'AAA', '2024-03-05', { net: -100, r: -1 }),
  trade(4, 'CCC', '2024-03-06', { net: -150, r: -1.5, gap: true }),
  trade(5, 'AAA', '2024-03-07', { net: 300, r: 3 }),
  trade(6, 'BBB', '2024-03-07', { net: -100, r: -1, ambiguous: true, resolvedBy: 'stop_first' }),
  trade(7, 'CCC', '2024-03-08', { net: 50, r: 0.5, reason: 'flatten' }),
  trade(8, 'DDD', '2024-03-08', { net: 40, r: 0.4, reason: 'end_of_data' }),
];
// Same-session ties sort by entry time, then symbol: AAA before BBB.
TRADES[1].exit.at = '2024-03-05T18:00:00Z';
TRADES[5].exit.at = '2024-03-07T19:30:00Z';

const CURVE = [
  { t: '2024-03-04T14:45:00Z', equity: 100000, cash: 100000, positions: 0, openRisk: 0, grossExposure: 0 },
  { t: '2024-03-04T19:45:00Z', equity: 100200, cash: 90200, positions: 1, openRisk: 250, grossExposure: 10000 },
  { t: '2024-03-05T19:45:00Z', equity: 100100, cash: 90100, positions: 1, openRisk: 250, grossExposure: 10000 },
  { t: '2024-03-06T19:45:00Z', equity: 99850, cash: 79850, positions: 2, openRisk: 500, grossExposure: 20000 },
  { t: '2024-03-07T15:00:00Z', equity: 100150, cash: 100150, positions: 0, openRisk: 0, grossExposure: 0 },
  { t: '2024-03-07T19:45:00Z', equity: 101000, cash: 96000, positions: 1, openRisk: 250, grossExposure: 5000 },
  { t: '2024-03-08T20:45:00Z', equity: 100140, cash: 100140, positions: 0, openRisk: 0, grossExposure: 0 },
];

test('computeMetrics: exact figures on handcrafted trades and equity curve', () => {
  const m = computeMetrics({ trades: TRADES, equityCurve: CURVE, startingEquity: 100000, from: '2024-03-04', to: '2024-03-08' });
  assert.equal(m.from, '2024-03-04');
  assert.equal(m.to, '2024-03-08');
  assert.equal(m.trades, 7, 'end-of-data close is not a closed trade');
  assert.equal(m.allTrades, 8);
  assert.deepEqual(m.endOfData, { trades: 1, net: 40, excludedFromTradeStats: true });
  assert.equal(m.netPnl, 140, 'P/L includes the forced close');
  assert.equal(m.endEquity, 100140);
  close(m.returnPct, 0.14);
  assert.equal(m.wins, 3);
  assert.equal(m.losses, 4);
  close(m.winRate, 3 / 7);
  close(m.avgWinR, 5.5 / 3);
  close(m.avgLossR, -1.125);
  close(m.meanR, 1 / 7);
  close(m.expectancyR, 1 / 7);
  close(m.expectancyUsd, 100 / 7);
  assert.equal(m.grossProfit, 550);
  assert.equal(m.grossLoss, 450);
  close(m.profitFactor, 550 / 450);
  assert.equal(m.longestLosingStreak, 3);
  assert.equal(m.longestWinningStreak, 1);
  // Drawdown: 100200 -> 99850 is 0.349 %; 101000 -> 100140 is larger.
  assert.equal(m.maxDrawdownUsd, 860);
  close(m.maxDrawdownPct, (860 / 101000) * 100);
  assert.equal(m.maxDrawdownPeakAt, '2024-03-07T19:45:00Z');
  assert.equal(m.maxDrawdownTroughAt, '2024-03-08T20:45:00Z');
  // Exposure over the 7 curve points.
  close(m.exposure.pctTimeInMarket, (4 / 7) * 100);
  close(m.exposure.avgPositions, 5 / 7);
  close(m.exposure.avgGrossExposurePct, ((10000 / 100200 + 10000 / 100100 + 20000 / 99850 + 5000 / 101000) / 7) * 100);
  // Turnover: 8 trades x 100 shares x (50 + 52).
  const avgEq = CURVE.reduce((a, p) => a + p.equity, 0) / 7;
  assert.equal(m.turnover.notional, 81600);
  close(m.turnover.turnover, 81600 / avgEq);
  close(m.turnover.years, 5 / 365.25);
  close(m.turnover.annualised, 81600 / avgEq / (5 / 365.25));
  assert.deepEqual(m.costs, { commission: 16, spreadSlippage: 32, fx: 0, total: 48, perTrade: 6 });
  assert.equal(m.tail.beyondMinus1R, 1);
  assert.equal(m.tail.gapThroughs, 1);
  assert.equal(m.tail.gapThroughStops, 1);
  assert.equal(m.tail.worstR, -1.5);
  assert.equal(m.tail.bestR, 3);
  assert.deepEqual(m.ambiguous, { count: 1, byResolution: { stop_first: 1 } });
  assert.deepEqual(m.exitReasons, { end_of_data: 1, flatten: 1, stop: 4, target: 2 });
  assert.equal(m.meanRCI.n, 7);
  assert.ok(m.meanRCI.lower <= m.meanR && m.meanR <= m.meanRCI.upper);
});

test('computeMetrics: end-of-data trades can be included on request; empty input is safe', () => {
  const m = computeMetrics({ trades: TRADES, equityCurve: CURVE, startingEquity: 100000, excludeEndOfData: false, bootstrap: false });
  assert.equal(m.trades, 8);
  close(m.meanR, 1.4 / 8);
  assert.equal(m.meanRCI, null);
  const e = computeMetrics({ trades: [], equityCurve: [], startingEquity: 100000, from: '2024-01-01', to: '2024-12-31' });
  assert.equal(e.trades, 0);
  assert.equal(e.meanR, null);
  assert.equal(e.profitFactor, null);
  assert.equal(e.profitFactorNote, 'no trades');
  assert.equal(e.winRate, null);
  assert.equal(e.maxDrawdownPct, null);
  assert.equal(e.returnPct, 0);
  assert.equal(e.longestLosingStreak, 0);
  assert.equal(e.outliers.largestSymbol, null);
});

test('profit factor with no losing trades is reported as such, not as infinity', () => {
  const m = computeMetrics({ trades: [TRADES[0], TRADES[4]], equityCurve: [], startingEquity: 100000, bootstrap: false });
  assert.equal(m.profitFactor, null);
  assert.equal(m.profitFactorNote, 'no losing trades');
  assert.equal(m.grossProfit, 500);
});

test('equity curve is restricted to the test dates; drawdown peak starts at the starting equity', () => {
  const m = computeMetrics({ trades: [], equityCurve: CURVE, startingEquity: 100000, from: '2024-03-06', to: '2024-03-06', bootstrap: false });
  assert.equal(m.exposure.points, 1);
  assert.equal(m.maxDrawdownUsd, 150, 'peak is the starting equity, not the excluded 100200');
  close(m.maxDrawdownPct, 0.15);
  const d = maxDrawdown([{ t: 'a', equity: 95000 }, { t: 'b', equity: 97000 }], 100000);
  assert.equal(d.maxDrawdownUsd, 5000);
  close(d.maxDrawdownPct, 5);
});

test('outlier dependence: without the best trade / best 5 %, top-decile share, largest symbol share', () => {
  const closed = TRADES.filter((t) => t.exit.reason !== 'end_of_data');
  const o = outlierDependence(closed);
  close(o.meanRWithoutBest, -2 / 6);
  assert.equal(o.netWithoutBest, -200);
  assert.equal(o.best5PctCount, 1, 'ceil(5 % of 7) = 1');
  close(o.meanRWithoutBest5Pct, -2 / 6);
  assert.equal(o.top10PctCount, 1);
  close(o.top10PctShareOfGrossProfit, 300 / 550);
  assert.equal(o.largestSymbol.symbol, 'AAA');
  assert.equal(o.largestSymbol.net, 400);
  close(o.largestSymbol.shareOfNet, 4, 1e-9);
  // 40 trades: the best 5 % is 2 trades.
  const many = Array.from({ length: 40 }, (_, i) => trade(i, i % 2 ? 'X' : 'Y', '2024-05-01', { net: i - 10, r: (i - 10) / 10 }));
  const o2 = outlierDependence(many);
  assert.equal(o2.best5PctCount, 2);
  close(o2.meanRWithoutBest5Pct, many.slice(0, 38).reduce((a, t) => a + t.pnl.r, 0) / 38);
  // Net profit not positive: symbol shares are undefined, not negative percentages.
  const o3 = outlierDependence([TRADES[1], TRADES[2]]);
  assert.equal(o3.largestSymbol.shareOfNet, null);
});

test('bootstrap interval is reproducible with the seed and changes with another seed', () => {
  const rs = TRADES.map((t) => t.pnl.r);
  const a = bootstrapMeanCI(rs, { resamples: 10000, seed: 12345, level: 0.95 });
  const b = bootstrapMeanCI(rs, { resamples: 10000, seed: 12345, level: 0.95 });
  assert.deepEqual(a, b);
  const c = bootstrapMeanCI(rs, { resamples: 10000, seed: 999 });
  assert.notEqual(a.lower, c.lower);
  assert.equal(a.n, 8);
  assert.equal(a.resamples, 10000);
  assert.equal(a.seed, 12345);
  assert.ok(a.lower < a.mean && a.mean < a.upper);
  // Defaults are the pre-registered 10,000 resamples and seed 12345.
  assert.deepEqual(bootstrapMeanCI(rs), a);
  // Regression pin for seed 12345 (any change to the PRNG or resampling shows here).
  const pin = bootstrapMeanCI([1.13, -0.97, 2.41, -1.02, 0.55, -0.31, 0.07], { resamples: 2000, seed: 12345 });
  assert.equal(pin.lower.toFixed(6), PIN.lower);
  assert.equal(pin.upper.toFixed(6), PIN.upper);
  // Constant values: the interval collapses to the value.
  const k = bootstrapMeanCI([0.3, 0.3, 0.3], { resamples: 500 });
  close(k.lower, 0.3);
  close(k.upper, 0.3);
  assert.equal(bootstrapMeanCI([1]).lower, null);
});
const PIN = { lower: '-0.491429', upper: '1.207143' };

test('mulberry32 is deterministic and in [0, 1)', () => {
  const r1 = mulberry32(42), r2 = mulberry32(42);
  const xs = Array.from({ length: 1000 }, () => r1());
  assert.deepEqual(xs, Array.from({ length: 1000 }, () => r2()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, mulberry32(43)));
});

test('ET dates and hours across daylight-saving time', () => {
  assert.equal(etDate('2024-03-08T20:45:00Z'), '2024-03-08');
  assert.equal(etDate('2024-03-08T02:00:00Z'), '2024-03-07', 'evening ET is the previous date');
  assert.equal(etDate('2024-03-08'), '2024-03-08');
  assert.equal(etHour('2024-01-10T14:30:00Z'), 9, 'EST');
  assert.equal(etHour('2024-07-10T14:30:00Z'), 10, 'EDT');
});

test('group tables by symbol, cluster, sector, year, hour and regime', () => {
  const universe = { symbols: [{ symbol: 'AAA', sector: 'Tech', cluster: 'ai_tech' }, { symbol: 'BBB', sector: 'Energy', cluster: null }, { symbol: 'CCC', sector: 'Energy', cluster: null }] };
  const regimeAt = (d) => (d < '2024-03-06' ? { trend: 'up', volatility: 'calm', label: 'up/calm' } : { trend: 'down', volatility: 'stressed', label: 'down/stressed' });
  const closed = TRADES.filter((t) => t.exit.reason !== 'end_of_data');
  const g = groupTables(closed, { universe, regimeAt });
  const aaa = g.symbol.find((r) => r.key === 'AAA');
  assert.equal(aaa.trades, 3);
  assert.equal(aaa.net, 400);
  close(aaa.meanR, 4 / 3);
  assert.deepEqual(g.cluster.map((r) => [r.key, r.trades]), [['ai_tech', 3], ['none', 4]]);
  assert.deepEqual(g.sector.map((r) => [r.key, r.trades]), [['Energy', 4], ['Tech', 3]]);
  assert.deepEqual(g.year.map((r) => [r.key, r.trades]), [['2024', 7]]);
  assert.deepEqual(g.hour.map((r) => [r.key, r.trades]), [['10:00 ET', 7]], '15:15 UTC in March 2024 before DST = 10:15 ET');
  assert.deepEqual(g.regimeTrend.map((r) => [r.key, r.trades]), [['down', 4], ['up', 3]]);
  assert.deepEqual(g.regime.map((r) => [r.key, r.trades]), [['down/stressed', 4], ['up/calm', 3]]);
  assert.equal(g.excludingCluster.ai_tech.trades, 4);
  close(g.excludingCluster.ai_tech.meanR, -3 / 4);
});

// ---------- buy and hold ----------

function sessions(from, n) {
  const out = [];
  for (let d = from; out.length < n; d = addDays(d, 1)) if (isTradingDay(d)) out.push(d);
  return out;
}

function dayBars(days, closes, open0) {
  // Two bars per session; the session close is the second bar's close.
  return days.flatMap((d, i) => [
    { t: `${d}T15:00:00Z`, o: i === 0 ? open0 : closes[i - 1], h: 1e9, l: 0, c: (closes[i] + (i ? closes[i - 1] : open0)) / 2, v: 1000 },
    { t: `${d}T19:45:00Z`, o: 0, h: 1e9, l: 0, c: closes[i], v: 1000 },
  ]);
}

test('buy and hold: equal-weight universe and SPY from daily closes', () => {
  const days = sessions('2024-01-02', 4);
  const bars = new Map([
    ['SPY', dayBars(days, [101, 99, 104, 110], 100)],
    ['AAA', dayBars(days, [50, 40, 45, 60], 50)],
  ]);
  const b = buyAndHold({ bars, symbols: ['SPY', 'AAA', 'ZZZ'], from: days[0], to: days[3], startingEquity: 100000 });
  assert.deepEqual(b.equalWeightMissing, ['ZZZ']);
  close(b.spy.returnPct, 10);
  close(b.spy.maxDrawdownPct, (2 / 101) * 100);
  close(b.spy.returnPerDrawdown, 10 / ((2 / 101) * 100));
  // 50,000 each: SPY 500 shares, AAA 1,000 shares.
  const eq = [500 * 101 + 1000 * 50, 500 * 99 + 1000 * 40, 500 * 104 + 1000 * 45, 500 * 110 + 1000 * 60];
  close(b.equalWeight.returnPct, ((eq[3] - 100000) / 100000) * 100);
  close(b.equalWeight.maxDrawdownPct, ((eq[0] - eq[1]) / eq[0]) * 100);
  assert.equal(b.equalWeight.sessions, 4);
  assert.deepEqual(dailyBars(bars.get('SPY'), days[1], days[2]).map((r) => r.close), [99, 104]);
});

// ---------- regimes ----------

function spySeries(n, step = (i) => (i % 2 ? -0.005 : 0.006)) {
  const days = sessions('2024-01-02', n);
  const closes = [400];
  for (let i = 1; i < n; i++) closes.push(closes[i - 1] * (1 + step(i)));
  return { days, closes, bars: days.map((d, i) => ({ t: `${d}T20:45:00Z`, o: closes[i], h: closes[i], l: closes[i], c: closes[i], v: 1 })) };
}

function realisedVol(closes, i) {
  const rets = [];
  for (let k = i - 19; k <= i; k++) rets.push(closes[k] / closes[k - 1] - 1);
  const m = rets.reduce((a, b) => a + b, 0) / 20;
  return Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / 19) * Math.sqrt(252) * 100;
}

test('regimes: previous session only, unknown during warm-up', () => {
  const { days, closes, bars } = spySeries(70);
  const { regimeAt } = buildRegimes(bars);
  // Session k uses daily rows 0..k-1: 50 closes are needed for the trend, 21 for 20 returns.
  assert.equal(regimeAt(days[49]).trend, 'unknown');
  assert.equal(regimeAt(days[50]).trend !== 'unknown', true);
  assert.equal(regimeAt(days[20]).volatility, 'unknown');
  assert.notEqual(regimeAt(days[21]).volatility, 'unknown');
  const r = regimeAt(days[60]);
  assert.equal(r.asOf, days[59]);
  const sma = closes.slice(10, 60).reduce((a, b) => a + b, 0) / 50;
  close(r.sma50, sma);
  assert.equal(r.trend, closes[59] > sma ? 'up' : 'down');
  close(r.vol20, realisedVol(closes, 59));
  assert.equal(r.volatility, volatilityBand(realisedVol(closes, 59)));
  assert.equal(regimeAt('2023-12-29').trend, 'unknown', 'before the data');
  assert.deepEqual(buildRegimes([]).regimeAt(days[60]).label, 'unknown/unknown', 'no SPY data');
});

test('regimes: no look-ahead — changing a session never changes its own label', () => {
  const base = spySeries(70);
  const crashed = base.bars.map((b, i) => (i === 60 ? { ...b, c: b.c * 0.7 } : b));
  const a = buildRegimes(base.bars).regimeAt, b = buildRegimes(crashed).regimeAt;
  assert.deepEqual(a(base.days[60]), b(base.days[60]), 'the crash day itself is labelled from the day before');
  assert.notDeepEqual(a(base.days[61]), b(base.days[61]), 'the next session sees it');
  assert.equal(b(base.days[61]).trend, 'down');
  // Truncating the data after session k gives the same label for k.
  const trunc = buildRegimes(base.bars.slice(0, 61)).regimeAt;
  assert.deepEqual(trunc(base.days[60]), a(base.days[60]));
});

test('regimes: volatility bands and gaps in SPY data', () => {
  assert.equal(volatilityBand(14.99), 'calm');
  assert.equal(volatilityBand(15), 'normal');
  assert.equal(volatilityBand(25), 'normal');
  assert.equal(volatilityBand(25.01), 'stressed');
  assert.equal(volatilityBand(null), 'unknown');
  const calm = spySeries(30, (i) => (i % 2 ? -0.004 : 0.004));
  assert.equal(buildRegimes(calm.bars).regimeAt(calm.days[25]).volatility, 'calm');
  const wild = spySeries(30, (i) => (i % 2 ? -0.03 : 0.03));
  assert.equal(buildRegimes(wild.bars).regimeAt(wild.days[25]).volatility, 'stressed');
  // A missing previous session leaves the label unknown instead of reusing an older one.
  const gap = wild.bars.filter((_, i) => i !== 24);
  assert.equal(buildRegimes(gap).regimeAt(wild.days[25]).volatility, 'unknown');
  // After a holiday the previous NYSE session is used (2024-07-04 closed).
  const july = spySeries(140);
  const iJul5 = july.days.indexOf('2024-07-05');
  assert.ok(iJul5 > 0);
  assert.equal(buildRegimes(july.bars).regimeAt('2024-07-05').asOf, '2024-07-03');
});
