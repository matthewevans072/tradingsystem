// Range-trend Tier 1 tests that catch planted bugs (strategy/range-trend/EXPERIMENT-LOG.md entry 5): each
// test was checked against a scratch copy of the code with one bug planted. Holdings are recomputed here
// independently: shares from the fills and splits, valued at that session's input close. Synthetic prices only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/rangetrend/config.js';
import { rangeState } from '../server/rangetrend/levels.js';
import { runBacktest } from '../server/rangetrend/engine.js';
import { periodSessions } from '../server/hxr/engine.js';

const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const K = 0.0004;
const PAT = [100, 102, 104, 106, 108, 110, 108, 106, 104, 102];
const BASE = Array.from({ length: 6 }, () => PAT).flat();
const SESS = periodSessions({ warmupFrom: '2024-01-02', end: '2027-12-31' });
const L = loadConfig('rt-range-dip-nolimit-0.2.0.json').levels;

function run(file, paths, { portfolio = {}, splits = {}, dividends = {} } = {}) {
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
  const r = runBacktest({ config: c, symbols: syms.map((s) => ({ symbol: s })), sessions: SESS.slice(0, n), days, halfSpreadBps: 2 });
  return { ...r, days, syms, at: (i) => SESS[i], idx: (d) => SESS.indexOf(d) };
}
const dec = (r, action) => r.decisions.filter((d) => d.action === action);

// Shares from the fills and splits; holdings = sum of shares x that session's input close (the last close
// when a stock has no bar). Checked against every stored equity point.
function checkHoldings(r) {
  const shares = Object.fromEntries(r.syms.map((s) => [s, 0])), last = {};
  const fillsOn = new Map(), closedAtSplit = new Set(r.trades.filter((t) => t.exitReason === 'split_no_whole_share').map((t) => `${t.symbol}:${t.exitDate}`));
  for (const f of r.fills) fillsOn.set(f.date, [...(fillsOn.get(f.date) || []), f]);
  for (const [d, day] of r.days) {
    for (const sp of day.splits) {
      shares[sp.symbol] = Math.floor(shares[sp.symbol] * sp.ratio + 1e-9);
      if (closedAtSplit.has(`${sp.symbol}:${d}`)) shares[sp.symbol] = 0;
      if (last[sp.symbol] != null) last[sp.symbol] /= sp.ratio;
    }
    for (const f of fillsOn.get(d) || []) shares[f.symbol] = f.side === 'buy' ? shares[f.symbol] + f.shares : 0;
    for (const s of r.syms) if (day.bars[s]) last[s] = day.bars[s].c;
    const p = r.equity.find((x) => x.date === d);
    if (!p) continue;
    const h = r.syms.reduce((a, s) => a + shares[s] * (last[s] ?? 0), 0);
    near(p.holdings, h, `holdings on ${d}`, 1e-6);
    near(p.equity, p.cash + h, `equity on ${d}`, 1e-6);
  }
}
const D = [...BASE, 101, 103, 105, 107, 108, 109, 107.2, 106.2, 106];
const B = [...BASE, 100, 102, 104, 106, 108, 111.5];

test('holdings at that session\'s close (independently recomputed), and V = cash + holdings at the decision close', () => {
  // AAA is bought at 61 and rises; BBB (a different price path) dips later: its sizing uses V with AAA's holdings.
  const r = run('rt-range-dip-nolimit-0.2.0.json', { AAA: D, BBB: [...BASE.map((x) => x * 1.5), 160, 160, 160, 159, 158, 157, 156, 153, 151.5] });
  checkHoldings(r);
  const e = dec(r, 'entry').find((d) => d.symbol === 'BBB');
  assert.ok(e, 'BBB enters later');
  const p = r.equity.find((x) => x.date === e.date);
  assert.ok(p.holdings > 0, 'AAA is held at that close');
  near(e.V, p.cash + p.holdings, 'V includes the holdings');
  near(e.capUsd, 0.2 * (p.cash + p.holdings));
});

test('hand-pinned buy cost and sell proceeds including fees; the exit fills at the next open, gap included', () => {
  const r = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...D.slice(0, -1), [104, 104]] });
  const buy = r.fills.find((f) => f.side === 'buy'), sell = r.fills.find((f) => f.side === 'sell');
  near(buy.cost, 29 * 101 * 1.0004, 'buy: 29 x 101 x (1 + 4 bps), no commission');
  const px = 104 * 0.9996; // the next open after the decision at 106.2, not the decision close
  near(sell.price, px);
  near(sell.proceeds, 29 * px - 0.0000206 * 29 * px - 29 * 0.000166, 'sell: gross less the SEC fee and FINRA TAF');
  near(r.cash, 15000 - buy.cost + sell.proceeds);
  checkHoldings(r);
});

test('split paths: history in the window, a pending buy across a split, trend levels, the last sale price, the pullback watch, cash in lieu on a 3-for-2', () => {
  // History inside the window: a 2-for-1 split at 30; closes after it are in post-split units.
  const halfPat = BASE.map((x, i) => (i >= 30 ? x / 2 : x));
  const h = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...halfPat, 50.5] }, { splits: { 30: [{ symbol: 'AAA', ratio: 2 }] } });
  const he = dec(h, 'entry')[0];
  assert.deepEqual([he.values.lo, he.values.hi, he.values.H], [50, 55, 5], 'the whole window in post-split units');
  // A pending buy across a split: decided at 101 (29 shares), 2-for-1 on the fill session.
  const pb = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, [50.5, 51], 51.5] }, { splits: { 61: [{ symbol: 'AAA', ratio: 2 }] } });
  const pf = pb.fills[0];
  assert.deepEqual([pf.shares, pf.stop], [58, 49.5]);
  checkHoldings(pb);
  // Trend levels: entered at the breakout 111.5 (old high 110); a 2-for-1 split at 67; closes stay near 56 (112).
  const tr = run('rt-trend-immediate-nolimit-0.2.0.json', { AAA: [...B, 112, [56, 56.2], 56.1, 56.3, 56.2] }, { splits: { 67: [{ symbol: 'AAA', ratio: 2 }] } });
  assert.equal(dec(tr, 'exit').length, 0, 'old high, highest and m follow the split: no spurious exit');
  checkHoldings(tr);
  // The last sale price: sold at 106.16 (68), 2-for-1 at 69 (P becomes 53.08); the dip at 51 is decided, and its
  // fill at 53.5 x (1 + K), at or above the split-adjusted P, is cancelled (it would fill against 106.16).
  const ls = run('rt-range-dip-limit-0.2.0.json', { AAA: [...D, [53.3, 51], [53.5, 53.2]] }, { splits: { 69: [{ symbol: 'AAA', ratio: 2 }] } });
  assert.equal(ls.idx(dec(ls, 'entry').at(-1).date), 69);
  const lsc = ls.warnings.find((w) => w.code === 'order_cancelled' && w.details.code === 'reentry_limit');
  assert.deepEqual([ls.idx(lsc?.date), +lsc?.details.lastSalePrice.toFixed(6)], [70, +(106.2 * (1 - K) / 2).toFixed(6)]);
  // The pullback watch: breakout at 65, 2-for-1 at 66; 55.4 is a pullback close (old high 55), 55.7 an up close.
  const pw = run('rt-trend-pullback-nolimit-0.2.0.json', { AAA: [...B, [55.6, 55.4], 55.7, 55.9] }, { splits: { 66: [{ symbol: 'AAA', ratio: 2 }] } });
  assert.deepEqual(dec(pw, 'entry').map((d) => [pw.idx(d.date), d.values.oldHi]), [[67, 55]]);
  // Cash in lieu on a 3-for-2: 29 shares become 43 and half a share is paid at the split session's open.
  const cl = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, 103, 105, [70, 70.5], 71] }, { splits: { 63: [{ symbol: 'AAA', ratio: 1.5 }] } });
  assert.equal(cl.openPositions[0].shares, 43);
  const cil = cl.dividends.find((d) => d.kind === 'cash_in_lieu');
  near(cil.amount, 0.5 * 70 * (1 - 2 / 10000), 'half a share at the open less the half-spread');
  checkHoldings(cl);
});

test('the total-risk room subtracts the entry risk of open positions, measured at entry and not from current value', () => {
  // Cap and risk per trade lifted, total risk 1%. AAA enters at 61 and rises; BBB dips at 66.
  const r = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, 103, 105, 107, 108, 109, 109.5], BBB: [...BASE.map((x) => x * 1.5), 160, 160, 160, 159, 158, 157, 151.5, 152] }, { portfolio: { positionCapPct: 100, riskPerTradePct: 100, totalEntryRiskPct: 1 } });
  const a = r.fills.find((f) => f.symbol === 'AAA'), e = dec(r, 'entry').find((d) => d.symbol === 'BBB');
  assert.ok(a && e);
  near(e.roomShare, 0.01 * e.V - a.entryRisk, 'room = 1% of V minus the entry risk of AAA (fixed at its entry)');
  const p = r.equity.find((x) => x.date === e.date);
  near(p.entryRisk, a.entryRisk, 'the equity point carries entry risk, not current-value risk');
});

test('cash sizing includes costs: three dips at 101 with US$15,150 give 49 shares each, and cash stays at or above zero', () => {
  const three = { AAA: [...BASE, 101, 101.5], BBB: [...BASE, 101, 101.5], CCC: [...BASE, 101, 101.5] };
  const r = run('rt-range-dip-nolimit-0.2.0.json', three, { portfolio: { startingCash: 15150, positionCapPct: 100, riskPerTradePct: 100 } });
  assert.deepEqual(dec(r, 'entry').map((d) => d.shares), [49, 49, 49], 'floor(5050 / (101 x 1.0004)) = 49, not floor(5050 / 101) = 50');
  assert.ok(r.equity.every((p) => p.cash >= 0));
});

test('a range with H below 4 x m is not established: no entry', () => {
  // Bottom and top visits are present, but the moves are large: m = 52 / 12 = 4.33 and 4m = 17.3 > H = 10.
  const P = [100, 108, 104, 108, 104, 108, 110, 102, 106, 102, 106, 102];
  const w = Array.from({ length: 5 }, () => P).flat();
  const st = rangeState(w, L);
  assert.ok(st.bottomVisits.length >= 2 && st.topVisits.length >= 2 && st.H === 10 && st.m > 2.5);
  assert.equal(st.established, false);
  const r = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...w, 101, 101] });
  assert.equal(dec(r, 'entry').length, 0);
});

test('trend exit: only consecutive closes below the old high count', () => {
  const r = run('rt-trend-immediate-nolimit-0.2.0.json', { AAA: [...B, 109.5, 110.5, 109.5, 110.5] });
  assert.equal(dec(r, 'exit').length, 0);
});

test('pullback: a close more than 1 x m above the old high is not a pullback close', () => {
  const r = run('rt-trend-pullback-nolimit-0.2.0.json', { AAA: [...B, 114, 114.5, 114.8] });
  assert.equal(dec(r, 'entry').length, 0);
});

test('conversion to a trend uses the frozen range top, not the rolling one', () => {
  // Frozen hi 110 and m 2: 111.3 > 111 converts, although the rolling window's top is then 110.8.
  const r = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, 103, 105, 107, 109, 110.8, 111.3, 111.5] });
  assert.deepEqual(dec(r, 'convert_to_trend').map((d) => r.idx(d.date)), [66]);
});

test('edges: a dip close equal to the last sale price P is refused with the limit (>=) and entered without it; a close equal to lo is not a dip (>)', () => {
  // The rejection exit decided at 67 sells at the next open, 101: P = 101 x (1 - K); the close that session is P itself.
  const P = 101 * (1 - K);
  const r = run('rt-range-dip-limit-0.2.0.json', { AAA: [...D.slice(0, -1), [101, P], 100.5] });
  near(r.fills.find((f) => f.side === 'sell').price, P);
  assert.deepEqual(r.skips.map((k) => [r.idx(k.date), k.code]), [[68, 'reentry_limit']], 'equal to P: refused');
  assert.deepEqual(dec(r, 'entry').map((d) => r.idx(d.date)), [60, 69], 'the next dip below P is entered');
  const free = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...D.slice(0, -1), [101, P], 100.5] });
  assert.deepEqual(dec(free, 'entry').map((d) => free.idx(d.date)), [60, 68], 'without the limit, entered at P');
  const lo = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 100, 104] });
  assert.equal(dec(lo, 'entry').length, 0, 'a close at lo is not above it');
});
