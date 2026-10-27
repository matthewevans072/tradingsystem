// Range-trend fix pass 1 (strategy/range-trend/EXPERIMENT-LOG.md entry 3): one regression test per engine
// defect a-h. Each fails on the code of b6007e3 and passes after the fix. Synthetic prices only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/rangetrend/config.js';
import { rangeState, isBreakout, isDip, zoneVisits } from '../server/rangetrend/levels.js';
import { runBacktest } from '../server/rangetrend/engine.js';
import * as M from '../server/rangetrend/metrics.js';

const { computeMetrics } = M;
// tradePnls is new in this fix pass; the fallback lets this file load (and fail test by test) on the older code.
const tradePnls = M.tradePnls ?? ((r) => r.trades.map((t) => ({ ...t, pnlTotal: t.pnl })));
import { periodSessions } from '../server/hxr/engine.js';

const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const PAT = [100, 102, 104, 106, 108, 110, 108, 106, 104, 102];
const BASE = Array.from({ length: 6 }, () => PAT).flat();
const SESS = periodSessions({ warmupFrom: '2024-01-02', end: '2027-12-31' });
const L = loadConfig('rt-range-dip-nolimit-0.1.0.json').levels;

function run(file, paths, { portfolio = {}, splits = {}, dividends = {}, hs = 2 } = {}) {
  const syms = Object.keys(paths);
  const n = Math.max(...Object.values(paths).map((r) => r.length));
  const days = new Map();
  for (let i = 0; i < n; i++) {
    const bars = {};
    for (const s of syms) {
      const row = paths[s][i];
      if (row == null) continue;
      const prev = paths[s][i - 1];
      const [o, c] = Array.isArray(row) ? row : [i ? (Array.isArray(prev) ? prev[1] : prev) : row, row];
      bars[s] = { o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 };
    }
    days.set(SESS[i], { bars, splits: splits[i] || [], dividends: (dividends[i] || []).map((d) => ({ ...d, exDate: SESS[i] })) });
  }
  const c = JSON.parse(JSON.stringify(loadConfig(file)));
  c.portfolio = { ...c.portfolio, ...portfolio };
  c.period = { ...c.period, warmupFrom: SESS[0], start: SESS[60], end: SESS[n - 1] };
  const r = runBacktest({ config: c, symbols: syms.map((s) => ({ symbol: s })), sessions: SESS.slice(0, n), days, halfSpreadBps: hs });
  return { ...r, at: (i) => SESS[i], idx: (d) => SESS.indexOf(d) };
}
const dec = (r, action) => r.decisions.filter((d) => d.action === action);
const B = [...BASE, 100, 102, 104, 106, 108, 111.5];
const D = [...BASE, 101, 103, 105, 107, 108, 109, 107.2, 106.2, 106];

test('a: the pullback watch advances while the stock is held: a close back at or below the old high ends it', () => {
  // A pullback entry (decided at 67), held through a second range (120-126), a second breakout (127, while
  // held), a close back at 125.5 (ends that watch), a giveback sale (120.5), then closes near the old high
  // 126 (126.5, 127): no pullback entry from the ended watch.
  const P2 = [120, 121, 122, 123, 124, 125, 126, 125, 124, 123, 122, 121];
  const ramp = [112, 113, 114, 115, 116, 117, 118, 119, 120];
  const closes = [...B, 110.8, 111.4, ...ramp, ...Array.from({ length: 5 }, () => P2).flat(), 127, 125.5, 120.5, 120.6, 126.5, 127, 127.5];
  const r = run('rt-trend-pullback-nolimit-0.1.0.json', { AAA: closes });
  const entries = dec(r, 'entry');
  assert.deepEqual(entries.map((d) => r.idx(d.date)), [67], 'one pullback entry only');
  const ended = r.watches.find((w) => w.reason === 'a close at or below the old high');
  assert.ok(ended, 'the watch of the second breakout ended');
  assert.equal(r.idx(ended.date), 137, 'started at the breakout while held');
  assert.equal(r.idx(ended.endedOn), 138, 'ended at the close back at 125.5, while held');
  assert.equal(r.trades[0].exitReason, 'giveback');
});

test('b: an up close is close(t) > close(t-1); a pullback signal that cannot be entered does not re-fire on later down closes', () => {
  // A position cap of US$15 gives 0 shares: the signal at 111.4 is skipped once; 111.2 and 111.0 are down closes.
  const r = run('rt-trend-pullback-nolimit-0.1.0.json', { AAA: [...B, 110.8, 111.4, 111.2, 111.0] }, { portfolio: { positionCapPct: 0.1 } });
  assert.deepEqual(r.skips.map((k) => [r.idx(k.date), k.code]), [[67, 'no_whole_share']]);
  // 110.8 (pullback close), 110.5 (down, a new pullback close), 110.6 (up against 110.5): a signal at 110.6.
  const u = run('rt-trend-pullback-nolimit-0.1.0.json', { AAA: [...B, 110.8, 110.5, 110.6, 111] });
  assert.deepEqual(dec(u, 'entry').map((d) => [u.idx(d.date), d.values.pullbackClose]), [[68, 110.5]]);
});

test('c: a split that leaves no whole share closes the position; its cash in lieu belongs to that trade', () => {
  // 29 shares, then a 1-for-50 reverse split (ratio 0.02) at index 63: 0.58 of a share, no whole share.
  const x50 = [[5250, 5250], ...[107, 108, 107, 106].map((c) => c * 50)];
  const r = run('rt-range-dip-nolimit-0.1.0.json', { AAA: [...BASE, 101, 103, 105, ...x50] }, { splits: { 63: [{ symbol: 'AAA', ratio: 0.02 }] } });
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.deepEqual([t.exitReason, r.idx(t.exitDate), t.shares], ['split_no_whole_share', 63, 29]);
  assert.equal(r.openPositions.length, 0, 'no 0-share open position');
  assert.ok(!r.fills.some((f) => f.side === 'sell'), 'no 0-share sell');
  assert.ok(r.equity.filter((p) => p.date >= r.at(63)).every((p) => p.entryRisk === 0 && p.positions === 0), 'no entry risk held for it');
  const cil = r.postExit.filter((x) => x.kind === 'cash_in_lieu');
  assert.equal(cil.length, 1);
  assert.equal(cil[0].tradeId, t.tradeId);
  near(cil[0].amount, 29 * 0.02 * 105 * 50 * (1 - 2 / 10000), 'cash in lieu at the open less the half-spread', 1e-6);
  near(tradePnls(r)[0].pnlTotal, t.pnl + cil[0].amount);
});

test('d: a dividend belongs to the trade holding the shares on the ex-date, even when paid during a later trade', () => {
  // Trade 1 holds 29 shares on the ex-date (index 63); it is sold at 68; trade 2 starts at 72; the dividend is paid at 73.
  const closes = [...D, 107, 104, 102, 101, 101.5, 102];
  const r = run('rt-range-dip-nolimit-0.1.0.json', { AAA: closes }, { dividends: { 63: [{ symbol: 'AAA', amount: 0.5, payDate: SESS[73] }] } });
  assert.equal(r.trades.length, 1);
  assert.equal(r.openPositions.length, 1, 'trade 2 is open');
  const t1 = r.trades[0];
  const post = r.postExit.filter((x) => x.kind === 'dividend');
  assert.deepEqual(post.map((x) => [x.tradeId, r.idx(x.date)]), [[t1.tradeId, 73]]);
  near(post[0].amount, 29 * 0.5 * 0.85);
  assert.equal(r.openPositions[0].pnl, r.openPositions[0].value - r.openPositions[0].cost, 'never credited to the later trade');
  near(tradePnls(r)[0].pnlTotal, t1.pnl + 29 * 0.5 * 0.85);
  assert.equal(t1.dividends, 0, 'the closed trade record is not edited');
});

test('e: one EPS convention at the plan\'s exact edges (a close equal to hi + 0.5m is not a breakout)', () => {
  const base = Array.from({ length: 6 }, () => PAT.map((x) => x * 0.1)).flat();
  const st = rangeState(base, L);
  assert.equal(isBreakout(st, 111 * 0.1, L), false, 'equal to the threshold within EPS: not above it');
  assert.equal(isBreakout(st, 11.11, L), true);
  assert.equal(isDip(st, st.lo), false, 'a close equal to lo is not above lo');
  assert.equal(isDip(st, st.bottom[1]), true, 'a close equal to the zone edge is inside the zone');
  assert.equal(zoneVisits([100, 104, 104, 104, 104, 104, 100], 100, 102.5, 5).length, 2, 'exactly 5 closes outside: separate visits');
  assert.equal(zoneVisits([100, 104, 104, 104, 104, 100], 100, 102.5, 5).length, 1, '4 closes outside: one visit');
  const r = run('rt-trend-immediate-nolimit-0.1.0.json', { AAA: [...base, ...[100, 102, 104, 106, 108].map((x) => x * 0.1), 111 * 0.1] });
  assert.equal(dec(r, 'entry').length, 0);
});

test('f: a watch replaced by a new breakout is recorded with its end date and counted in the H4 measures', () => {
  const P3 = [114, 115, 116, 117, 118, 119, 120, 119, 118, 117, 116, 115];
  const r = run('rt-trend-pullback-nolimit-0.1.0.json', { AAA: [...B, 113.5, ...Array.from({ length: 5 }, () => P3).flat(), 121, 123] });
  // 113.5 is itself a breakout of the window that now holds 111.5: the first watch is replaced there.
  const rep = r.watches.filter((w) => w.reason === 'replaced');
  assert.ok(rep.length >= 1, 'a watch is recorded as replaced');
  assert.deepEqual([r.idx(rep[0].date), r.idx(rep[0].endedOn)], [65, 66], 'with its end date');
  const never = r.watches.filter((w) => !w.entered && w.endedOn != null).length;
  assert.ok(never >= 1);
  assert.equal(computeMetrics(r).hypotheses.H3H4.breakoutsNeverEntered, never, 'replaced watches are counted in H4');
});

test('g: H5 counts the P/L of trades entering within 20 sessions of a sale of the same stock', () => {
  // Trade 1 is sold at 68; trade 2 is decided at 71 (4 sessions from the sale, the sale session included), fills
  // at 72 and exits on a breakdown.
  const r = run('rt-range-dip-nolimit-0.1.0.json', { AAA: [...D, 107, 104, 102, 101, 98, 97.5, 97] });
  assert.equal(r.trades.length, 2);
  assert.equal(r.trades[1].afterSaleOf.sessionsSinceSale, 4);
  const h5 = computeMetrics(r).hypotheses.H5;
  assert.deepEqual([h5.withinSessions, h5.tradesWithinOfASale], [20, 1]);
  near(h5.pnlOfTradesWithinOfASale, tradePnls(r)[1].pnlTotal);
});

test('h: Tier 2 checks include positions open at the end; per-stock signals, skips by code and 1-share entries', () => {
  const S29 = BASE.map((c) => c * 29);
  const r = run('rt-range-dip-nolimit-0.1.0.json', { AAA: D, BBB: [...S29, 2929, 2935, 2990, 3050, 3100, 3150, 3190, 3190, 3190] });
  const m = computeMetrics(r);
  assert.deepEqual([m.tier2.outcomes.completed, m.tier2.outcomes.openAtEnd], [1, 1]);
  assert.equal(m.tier2.topStock.symbol, 'BBB', 'the open position is in the concentration check');
  near(m.tier2.outcomes.pnl, tradePnls(r)[0].pnlTotal + r.openPositions[0].pnl);
  assert.equal(m.oneShareEntries, 1);
  assert.deepEqual([m.perStock.BBB.entries, m.perStock.BBB.oneShareEntries, m.perStock.AAA.signals >= 1], [1, 1, true]);
  assert.equal(typeof m.skipsByCode, 'object');
});
