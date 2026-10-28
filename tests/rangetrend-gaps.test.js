// Range-trend Tier 1 tests for the gaps the second fix pass found (EXPERIMENT-LOG.md entry 10): the dividend
// ex-date against the open's fills, cash in lieu at the next open, missing-bar paths, level edges, the EPS
// convention at every comparison, a pullback signal used once, H5's 20-session window, and the per-stock
// counts and best-5% removal. Made-up closes only test code; nothing here is market data or a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, PLANNED_CONFIGS } from '../server/rangetrend/config.js';
import { rangeState, isDip, isRecovery, isBreakout, isPullbackClose, breakStep, qualifiedRange, zoneVisits, typicalMove, EPS } from '../server/rangetrend/levels.js';
import { runBacktest } from '../server/rangetrend/engine.js';
import { computeMetrics, tradePnls } from '../server/rangetrend/metrics.js';
import { periodSessions } from '../server/hxr/engine.js';

const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const K = 0.0004;
const PAT = [100, 102, 104, 106, 108, 110, 108, 106, 104, 102];
const BASE = Array.from({ length: 6 }, () => PAT).flat();
const SESS = periodSessions({ warmupFrom: '2024-01-02', end: '2027-12-31' });
const CFG = (family, entry, limit) => PLANNED_CONFIGS.find((f) => f === `rt-${family}-${entry}-${limit ? 'limit' : 'nolimit'}-0.2.0.json`);
const DIP = CFG('range', 'dip', false), RECOVERY = CFG('range', 'recovery', false), IMMEDIATE = CFG('trend', 'immediate', false), PULLBACK = CFG('trend', 'pullback', false);
const L = loadConfig(DIP).levels;

function run(file, paths, { portfolio = {}, splits = {}, dividends = {} } = {}) {
  const syms = Object.keys(paths);
  const n = Math.max(...Object.values(paths).map((r) => r.length));
  const days = new Map();
  const last = {};
  for (let i = 0; i < n; i++) {
    const bars = {};
    for (const s of syms) {
      const row = paths[s][i];
      if (row == null) continue;
      const [o, c] = Array.isArray(row) ? row : [last[s] ?? row, row];
      bars[s] = { o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 };
      last[s] = c;
    }
    days.set(SESS[i], { bars, splits: splits[i] || [], dividends: (dividends[i] || []).map((d) => ({ ...d, exDate: SESS[i], payDate: typeof d.payDate === 'number' ? SESS[d.payDate] : d.payDate })) });
  }
  const c = JSON.parse(JSON.stringify(loadConfig(file)));
  c.portfolio = { ...c.portfolio, ...portfolio };
  c.period = { ...c.period, warmupFrom: SESS[0], start: SESS[60], end: SESS[n - 1] };
  const r = runBacktest({ config: c, symbols: syms.map((s) => ({ symbol: s })), sessions: SESS.slice(0, n), days, halfSpreadBps: 2 });
  return { ...r, days, syms, at: (i) => SESS[i], idx: (d) => SESS.indexOf(d) };
}
const dec = (r, action, symbol = null) => r.decisions.filter((d) => d.action === action && (!symbol || d.symbol === symbol));
const SKIP0 = { positionCapPct: 0.1 };
const D = [...BASE, 101, 103, 105, 107, 108, 109, 107.2, 106.2, 106];
const B = [...BASE, 100, 102, 104, 106, 108, 111.5];

test('dividends: a position bought at the ex-date open is not entitled; one sold at that open is, and its payment goes to that trade', () => {
  // The dip at 101 (60) fills at the 61 open; a dividend with ex-date 61 is not earned by it.
  const bought = run(DIP, { AAA: [...BASE, 101, 103, 105] }, { dividends: { 61: [{ symbol: 'AAA', amount: 1, payDate: 62 }] } });
  assert.equal(bought.dividends.length, 0, 'no entitlement, no payment');
  assert.equal(bought.unpaidDividends.length, 0);
  // The rejection exit decided at 67 sells at the 68 open; a dividend with ex-date 68 is earned by that trade
  // (entitled before the open's fills). Paid the same day, before the fill, it is credited to the trade itself.
  const sold = run(DIP, { AAA: D }, { dividends: { 68: [{ symbol: 'AAA', amount: 1, payDate: 68 }] } });
  const t = sold.trades[0];
  assert.deepEqual(sold.dividends.map((d) => [sold.idx(d.date), d.kind, d.tradeId]), [[68, 'entitlement', t.tradeId], [68, 'payment', t.tradeId]]);
  near(sold.dividends[1].amount, 29 * 1 * 0.85);
  near(t.dividends, 29 * 0.85);
  near(t.pnl, t.proceeds + 29 * 0.85 - t.cost);
  assert.equal(sold.postExit.length, 0);
  // Paid after the sale: recorded apart and added to the trade's P/L.
  const later = run(DIP, { AAA: D }, { dividends: { 68: [{ symbol: 'AAA', amount: 1, payDate: 68 + 0 }] } });
  assert.equal(later.postExit.length, 0);
  const after = run(DIP, { AAA: [...D, 106] }, { dividends: { 68: [{ symbol: 'AAA', amount: 1, payDate: 69 }] } });
  assert.deepEqual(after.postExit.map((x) => [x.kind, x.tradeId, after.idx(x.date)]), [['dividend', after.trades[0].tradeId, 69]]);
  near(tradePnls(after)[0].pnlTotal, after.trades[0].pnl + 29 * 0.85);
  assert.equal(after.trades[0].dividends, 0, 'the closed trade record is not edited');
  // A dividend entitled but unpaid at the end is reported.
  const unpaid = run(DIP, { AAA: [...BASE, 101, 103, 105] }, { dividends: { 62: [{ symbol: 'AAA', amount: 1, payDate: '2030-01-02' }] } });
  assert.deepEqual(unpaid.unpaidDividends.map((u) => [u.symbol, unpaid.idx(u.exDate), u.payDate, u.net]), [['AAA', 62, '2030-01-02', 29 * 0.85]]);
  assert.deepEqual(computeMetrics(unpaid).unpaidDividendsAtEnd, { count: 1, net: 29 * 0.85 });
  assert.deepEqual(computeMetrics(unpaid).perStock.AAA.unpaidDividends, { count: 1, net: 29 * 0.85 });
});

test('cash in lieu is valued at the next open, which differs from the previous close', () => {
  // 29 shares; a 3-for-2 at 63 gives 43 shares and half a share, paid at that session's open of 71 (the previous
  // close, 105 / 1.5 = 70, would give 34.99 instead of 35.49).
  const r = run(DIP, { AAA: [...BASE, 101, 103, 105, [71, 70.5], 71] }, { splits: { 63: [{ symbol: 'AAA', ratio: 1.5 }] } });
  const cil = r.dividends.find((d) => d.kind === 'cash_in_lieu');
  near(cil.amount, 0.5 * 71 * (1 - 2 / 10000));
  assert.ok(Math.abs(cil.amount - 0.5 * 70 * (1 - 2 / 10000)) > 0.4);
  near(r.openPositions[0].cashInLieu ?? r.openPositions[0].pnl - (r.openPositions[0].value - r.openPositions[0].cost), cil.amount, 'credited to the open trade');
});

test('missing bars: a sell waits for the next bar and fills at that open; a buy with no bar is cancelled and recorded', () => {
  // The exit decided at 67; no bar at 68: the sell waits (recorded) and fills at the 69 open, 105 (a gap down).
  const sell = run(DIP, { AAA: [...D.slice(0, -1), null, [105, 105.5], 106] });
  assert.deepEqual(sell.warnings.filter((w) => w.code === 'order_waiting').map((w) => sell.idx(w.date)), [68]);
  const f = sell.fills.find((x) => x.side === 'sell');
  assert.deepEqual([sell.idx(f.date), f.open], [69, 105]);
  near(f.price, 105 * (1 - K));
  assert.equal(sell.trades[0].sessionsHeld, 7, 'the session without a bar is not counted');
  // The dip at 101 (60); no bar at 61: the buy is cancelled with no_bar; the stock is checked again at 62.
  const buy = run(DIP, { AAA: [...BASE, 101, null, 101.5, 103] });
  assert.deepEqual(buy.warnings.filter((w) => w.code === 'order_cancelled').map((w) => [buy.idx(w.date), w.details.code, w.details.entryType]), [[61, 'no_bar', 'dip']]);
  assert.deepEqual(dec(buy, 'entry').map((d) => buy.idx(d.date)), [60, 62]);
  assert.deepEqual(buy.fills.map((x) => buy.idx(x.date)), [63]);
  assert.deepEqual(computeMetrics(buy).perStock.AAA, { ...computeMetrics(buy).perStock.AAA, signals: 2, entries: 1, cancellations: { no_bar: 1 } });
});

test('level edges: the recovery thresholds at their exact values; the rejection exit uses m(entry), not m(t-1)', () => {
  // After 101 at 60 (visit low 101, m(t-1) = 1.95 at 61): the recovery needs c >= 102.95, c > 102.5, c <= 105 and an up close.
  const rec = (c) => dec(run(RECOVERY, { AAA: [...BASE, 101, c, c - 0.5] }), 'entry').map((d) => d.values.close);
  assert.deepEqual(rec(102.95), [102.95], 'exactly visit low + m counts (>=)');
  assert.deepEqual(rec(102.95 - 1e-6), [], 'just below does not');
  assert.deepEqual(rec(105), [105], 'exactly lo + 0.5H counts (<=)');
  assert.deepEqual(rec(105 + 1e-6), [], 'just above does not');
  const s1 = rangeState([...BASE, 101], L);
  assert.equal(isRecovery(s1, 102.5, L), false, 'exactly the bottom zone edge is not above it (>)');
  assert.equal(isRecovery(s1, 102.95 - EPS / 2, L), true, 'within EPS of the threshold counts');
  assert.equal(isRecovery(s1, 101, L), false, 'equal to the previous close is not an up close');
  // The rejection exit: armed at 107.5 (62); the level is 107.5 - 0.5 x m(entry) = 106.5 with m(entry) = 2, while
  // m(t-1) at 65 is 1.91 (level 106.545). 106.52 is held with m(entry) and would exit with m(t-1); 106.45 exits.
  const held = run(DIP, { AAA: [...BASE, 101, 103, 107.5, 108, 107.8, 106.52, 108] });
  near(typicalMove([...BASE, 101, 103, 107.5, 108, 107.8], 20), 1.91);
  assert.equal(dec(held, 'exit').length, 0);
  const exit = run(DIP, { AAA: [...BASE, 101, 103, 107.5, 108, 107.8, 106.45, 108] });
  assert.deepEqual(dec(exit, 'exit').map((d) => [exit.idx(d.date), d.code, d.values.m]), [[65, 'rejection', 2]]);
});

test('the EPS convention at every level comparison, not only the breakout', () => {
  const st = rangeState(BASE, L); // lo 100, hi 110, H 10, m 2
  assert.deepEqual([isDip(st, 100), isDip(st, 100 + EPS / 2), isDip(st, 100.000001), isDip(st, 102.5), isDip(st, 102.5 + EPS / 2), isDip(st, 102.500001)], [false, false, true, true, true, false]);
  assert.deepEqual([isBreakout(st, 111, L), isBreakout(st, 111 + EPS / 2, L), isBreakout(st, 111.000001, L)], [false, false, true]);
  assert.deepEqual([isPullbackClose(110, 110, 2, L), isPullbackClose(110.000001, 110, 2, L), isPullbackClose(112, 110, 2, L), isPullbackClose(112.000001, 110, 2, L)], [false, true, true, false]);
  // The first breaking close: below lo - 0.5m = 99 (<), exactly 99 is not below.
  assert.equal(breakStep(null, 99, st, true, L, 'd').bw, null);
  assert.equal(breakStep(null, 99 - EPS / 2, st, true, L, 'd').bw, null);
  assert.deepEqual(breakStep(null, 98.999999, st, true, L, 'd').bw, { frozenLo: 100, m: 2, count: 1, since: 'd' });
  // The confirming close against the frozen lo with that close's m(t-1).
  const bw = { frozenLo: 100, m: 2, count: 1, since: 'd' };
  assert.equal(breakStep(bw, 99, { m: 2 }, false, L, 'e').kind, null, 'exactly the level does not count');
  assert.equal(breakStep(bw, 98.999999, { m: 2 }, false, L, 'e').kind, 'breakdown');
  assert.equal(breakStep(bw, 99, { m: 2 }, false, L, 'e').bw, null, 'a close that does not count drops the watch');
  // Established: H exactly 4m counts (>=), just below does not; visits exactly 5 closes apart are separate.
  const exact = Array.from({ length: 6 }, () => [100, 101, 102, 103, 104, 103, 102, 101, 100, 101]).flat(); // m 1, H 4
  assert.deepEqual([rangeState(exact, L).H, rangeState(exact, L).m, rangeState(exact, L).established], [4, 1, true]);
  const below = Array.from({ length: 6 }, () => [100, 101, 102, 103, 103.999999, 103, 102, 101, 100, 101]).flat(); // H 3.999999 < 4m
  assert.ok(rangeState(below, L).H < 4 * rangeState(below, L).m - 1e-7);
  assert.equal(rangeState(below, L).established, false);
  const wide = Array.from({ length: 6 }, () => [100, 102, 100, 102, 100, 102, 104, 102, 104, 102]).flat(); // m 2, H 4 < 8
  assert.equal(rangeState(wide, L).established, false);
  assert.equal(zoneVisits([100, 104, 104, 104, 104, 104, 100], 100, 102.5, 5).length, 2);
  // Qualified: the 61st close after the confirming close, not the 60th.
  assert.deepEqual([qualifiedRange(st, 122, 62, L), qualifiedRange(st, 123, 62, L), qualifiedRange(st, 200, null, L)], [false, true, true]);
  // Trade exits at their exact levels: armed exactly at the top zone's lower edge (>=); the rejection exactly at
  // the level is held (<); the trend exit exactly at the old high is not below (<); the giveback exactly at
  // highest - 3m is held (<); a conversion exactly at hi + 0.5m does not convert (>).
  const armed = run(DIP, { AAA: [...BASE, 101, 103, 107.5, 106.4, 108] });
  assert.deepEqual(dec(armed, 'exit').map((d) => [armed.idx(d.date), d.code]), [[63, 'rejection']], 'armed exactly at 107.5, exits at 106.4 < 106.5');
  const level = run(DIP, { AAA: [...BASE, 101, 103, 107.5, 106.5, 108] });
  assert.equal(dec(level, 'exit').length, 0, 'exactly 106.5 is not below the level');
  const conv = run(DIP, { AAA: [...BASE, 101, 103, 105, 107, 109, 111, 111.000001] });
  assert.deepEqual(dec(conv, 'convert_to_trend').map((d) => conv.idx(d.date)), [66], 'exactly 111 does not convert; above it does');
  const trend = run(IMMEDIATE, { AAA: [...B, 110, 110, 110.5] });
  assert.equal(dec(trend, 'exit').length, 0, 'closes exactly at the old high are not below it');
  const give = run(IMMEDIATE, { AAA: [...B, 113, 116, 119, 113, 113] });
  assert.equal(dec(give, 'exit').length, 0, 'exactly highest - 3m (119 - 6) is held');
  const give2 = run(IMMEDIATE, { AAA: [...B, 113, 116, 119, 112.999999, 113] });
  assert.deepEqual(dec(give2, 'exit').map((d) => d.code), ['giveback']);
});

test('a pullback signal is used once: a new pullback close followed by an up close gives a new signal; an up close alone does not', () => {
  // The signal at 67 (111.4 after 110.8) is skipped (0 shares); 111.2 (68) and 111.0 (69) are new pullback closes
  // (down closes, within 1 x m of 110); 111.3 (70) is an up close: a new signal.
  const again = run(PULLBACK, { AAA: [...B, 110.8, 111.4, 111.2, 111.0, 111.3] }, { portfolio: SKIP0 });
  assert.deepEqual(again.skips.map((k) => [again.idx(k.date), k.values.pullbackClose]), [[67, 110.8], [70, 111.0]]);
  // Up closes without a new pullback close: no second signal.
  const once = run(PULLBACK, { AAA: [...B, 110.8, 111.4, 112.5, 113, 113.5] }, { portfolio: SKIP0 });
  assert.deepEqual(once.skips.map((k) => once.idx(k.date)), [67]);
});

test('H5: a trade whose entry is decided 20 sessions after the sale (fill 20 sessions after it) counts; 21 does not', () => {
  // Trade 1 sells at the 68 open. With n closes of 104 after D, the next dip at 101 is decided at 69 + n, so
  // sessionsSinceSale = n + 2 (the sale session included): n = 18 gives 20, n = 19 gives 21. The trade then
  // exits on a breakdown so that it is completed.
  const path = (n) => [...D, ...Array.from({ length: n }, () => 104), 101, [101, 98.5], 98, 97];
  const twenty = run(DIP, { AAA: path(18) });
  assert.equal(twenty.trades.length, 2);
  assert.equal(twenty.trades[1].afterSaleOf.sessionsSinceSale, 20);
  const h20 = computeMetrics(twenty).hypotheses.H5;
  assert.deepEqual([h20.withinSessions, h20.tradesWithinOfASale], [20, 1]);
  near(h20.pnlOfTradesWithinOfASale, tradePnls(twenty)[1].pnlTotal);
  const twentyOne = run(DIP, { AAA: path(19) });
  assert.equal(twentyOne.trades[1].afterSaleOf.sessionsSinceSale, 21);
  assert.deepEqual([computeMetrics(twentyOne).hypotheses.H5.tradesWithinOfASale, computeMetrics(twentyOne).hypotheses.H5.pnlOfTradesWithinOfASale], [0, 0]);
});

test('per-stock counts are exact, and the best-5% removal drops the single best outcome of three', () => {
  const S29 = BASE.map((c) => c * 29), S50 = BASE.map((c) => c * 50);
  const r = run(DIP, {
    AAA: [...D, 107, 104, 102, 101, 98, 97.5, 97, 97, 97, 97], // two completed trades (rejection, then breakdown)
    BBB: [...S29, 2929, 2935, 2990, 3050, 3100, 3150, 3190, 3190, 3190, 3190, 3190, 3190, 3190, 3190, 3190, 3190, 3190, 3190], // one 1-share position, open at the end
    CCC: [...S50, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050, 5050], // every dip is a 0-share skip
    DDD: [...S29, 2929, [3100, 3100], 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100, 3100], // the fill is cancelled
  }, { dividends: { 70: [{ symbol: 'BBB', amount: 2, payDate: '2030-01-02' }] } });
  assert.deepEqual([r.trades.map((t) => t.symbol), r.openPositions.map((o) => o.symbol)], [['AAA', 'AAA'], ['BBB']]);
  const m = computeMetrics(r);
  const ps = m.perStock;
  assert.deepEqual([ps.AAA.signals, ps.AAA.entries, ps.AAA.skips, ps.AAA.cancellations, ps.AAA.pendingAtEnd], [2, 2, {}, {}, 0]);
  assert.deepEqual([ps.BBB.signals, ps.BBB.entries, ps.BBB.oneShareEntries, ps.BBB.unpaidDividends], [1, 1, 1, { count: 1, net: 1 * 2 * 0.85 }]);
  assert.deepEqual([ps.CCC.entries, ps.CCC.signals, ps.CCC.skips], [0, 18, { no_whole_share: 18 }]);
  assert.deepEqual([ps.DDD.signals, ps.DDD.entries, ps.DDD.cancellations], [1, 0, { no_whole_share: 1 }]);
  assert.deepEqual([m.skipsByCode, m.cancellationsByCode, m.oneShareEntries, m.pendingAtEnd], [{ no_whole_share: 18 }, { no_whole_share: 1 }, 1, 0]);
  near(ps.AAA.pnl, tradePnls(r).reduce((a, t) => a + t.pnlTotal, 0));
  near(ps.BBB.pnl, r.openPositions[0].pnl);
  // Three outcomes: ceil(0.15) = 1 is removed, the best of the two trades and the open position.
  const outcomes = [...tradePnls(r).map((t) => t.pnlTotal), r.openPositions[0].pnl];
  assert.deepEqual([m.tier2.outcomes.completed, m.tier2.outcomes.openAtEnd, m.tier2.withoutBestFivePct.outcomesRemoved], [2, 1, 1]);
  near(m.tier2.outcomes.pnl, outcomes.reduce((a, b) => a + b, 0));
  near(m.tier2.withoutBestFivePct.pnl, outcomes.reduce((a, b) => a + b, 0) - Math.max(...outcomes));
  assert.equal(m.tier2.topStock.symbol, outcomes.indexOf(Math.max(...outcomes)) === 2 ? 'BBB' : 'AAA');
});
