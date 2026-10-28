// Range-trend Tier 1 tests (strategy/range-trend/PLAN-DRAFT.md v0.3 section 7a), synthetic data only:
// every worked example of sections 3 and 6a, a scenario for every entry and exit, sizing hand-checks
// including several same-day signals and next-open gaps, splits and dividends, accounting identities.
// Made-up prices only test code; nothing here is market data or a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, listConfigs, PLANNED_CONFIGS, SUPERSEDED_CONFIGS, configHash } from '../server/rangetrend/config.js';
import { typicalMove, rangeState, isDip, isRecovery, isBreakout, untradedBreakdown, zoneVisits } from '../server/rangetrend/levels.js';
import { createEngine, runBacktest, sizeEntry } from '../server/rangetrend/engine.js';
import { periodSessions } from '../server/hxr/engine.js';

const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const K = 0.0004; // 2 bps half-spread (the floor) + 2 bps slippage
const PAT = [100, 102, 104, 106, 108, 110, 108, 106, 104, 102];
const BASE = Array.from({ length: 6 }, () => PAT).flat(); // 60 closes ending at 102 (section 3)
const SESS = periodSessions({ warmupFrom: '2024-01-02', end: '2027-12-31' });
const L = loadConfig('rt-range-dip-nolimit-0.2.0.json').levels;

function cfg(file, { portfolio = {}, n } = {}) {
  const c = JSON.parse(JSON.stringify(loadConfig(file)));
  c.portfolio = { ...c.portfolio, ...portfolio };
  c.period = { ...c.period, warmupFrom: SESS[0], start: SESS[60], end: SESS[n - 1] };
  return c;
}
// paths: { SYM: [close | [open, close], ...] } (index 0 = SESS[0]); a bare close opens at the previous close.
function run(file, paths, { portfolio = {}, splits = {}, dividends = {}, hs = 2, order = null } = {}) {
  const syms = order || Object.keys(paths);
  const n = Math.max(...Object.values(paths).map((r) => r.length));
  const days = new Map();
  for (let i = 0; i < n; i++) {
    const bars = {};
    for (const s of syms) {
      const row = paths[s][i];
      if (row == null) continue;
      const [o, c] = Array.isArray(row) ? row : [i ? (Array.isArray(paths[s][i - 1]) ? paths[s][i - 1][1] : paths[s][i - 1]) : row, row];
      bars[s] = { o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 };
    }
    days.set(SESS[i], { bars, splits: splits[i] || [], dividends: (dividends[i] || []).map((d) => ({ ...d, exDate: SESS[i] })) });
  }
  const config = cfg(file, { portfolio, n });
  const r = runBacktest({ config, symbols: syms.map((s) => ({ symbol: s })), sessions: SESS.slice(0, n), days, halfSpreadBps: hs });
  return { ...r, config, at: (i) => SESS[i] };
}
const dec = (r, action, symbol = null) => r.decisions.filter((d) => d.action === action && (!symbol || d.symbol === symbol));

// ---------- section 3: the worked examples ----------

test('section 3 window: m = 2, lo 100, hi 110, zones, visits 7 apart, established', () => {
  const st = rangeState(BASE, L);
  assert.deepEqual([st.lo, st.hi, st.H, st.m, st.bottom, st.top, st.established], [100, 110, 10, 2, [100, 102.5], [107.5, 110], true]);
  assert.ok(st.bottomVisits.length >= 2 && st.topVisits.length >= 2);
  assert.deepEqual(zoneVisits([102, 100, 102, 104, 106, 108, 110, 108, 106, 104, 102, 100], 100, 102.5, 5).map((v) => [v.start, v.end, v.low]), [[0, 2, 100], [10, 11, 100]], 'separated by 7 closes outside');
  assert.equal(zoneVisits([100, 104, 100], 100, 102.5, 5).length, 1, 'fewer than 5 closes outside: one visit');
  assert.equal(rangeState(BASE.slice(1), L), null, 'too little history: no state');
});

test('example A: dip entry at 101, recovery entry at 103 (m 1.95, threshold 102.95, lower-half limit 105)', () => {
  const a = [...BASE, 101, 103];
  const s0 = rangeState(a.slice(0, 60), L);
  assert.equal(isDip(s0, 101), true);
  assert.equal(isRecovery(s0, 101, L), false, '101 is inside the bottom zone');
  const s1 = rangeState(a.slice(0, 61), L);
  near(s1.m, 1.95);
  near(s1.bottomVisits.at(-1).low, 101);
  assert.equal(isRecovery(s1, 103, L), true);
  assert.equal(isRecovery(s1, 102.9, L), false, 'below 102.95');
  assert.equal(isRecovery(s1, 105.1, L), false, 'above the lower half');
  near(typicalMove(a.slice(0, 61), 20), 1.95);
});

test('example B: breakout at 111.5 (threshold 111; hi excludes today), pullback 110.8 then up close 111.4', () => {
  const b = [...BASE, 100, 102, 104, 106, 108, 111.5, 110.8, 111.4];
  const st = rangeState(b.slice(0, 65), L);
  assert.deepEqual([st.hi, st.m, st.established], [110, 2, true]);
  assert.equal(isBreakout(st, 111.5, L), true);
  assert.equal(isBreakout(st, 111, L), false, 'not above 111');
  // Were today's close in the window, hi would be 111.5 and no close could exceed hi + 0.5m.
  assert.equal(Math.max(...b.slice(6, 66)), 111.5);
  near(typicalMove(b.slice(0, 66), 20), 2.075);
  near(typicalMove(b.slice(0, 67), 20), 2.01);
});

test('example C: untraded breakdown confirmed at the second close with lo frozen at the first breaking close', () => {
  const c = [...BASE, 98.5, 98];
  assert.equal(untradedBreakdown(c, 60, L), 61);
  const rolling = rangeState(c.slice(0, 61), L);
  assert.equal(rolling.lo, 98.5, 'a rolling lo would already be 98.5');
  near(rolling.lo - 0.5 * rolling.m, 97.4625);
  assert.ok(!(98 < rolling.lo - 0.5 * rolling.m), 'and 98 would not count');
});

// ---------- section 6a: sizing ----------

test('section 6a worked sizing at V = 15,000 (no costs): the cap binds unless the stop is more than 5% below', () => {
  const s = (price, stop) => sizeEntry({ price, stop, cashShare: 15000, roomShare: 750, capUsd: 3000, riskUsd: 150 });
  const rows = [[101, 99], [103, 99.025], [111.5, 109], [111.4, 108.995], [100, 92]].map(([p, st]) => { const x = s(p, st); return [x.shares, x.binding, +x.plannedRisk.toFixed(3)]; });
  assert.deepEqual(rows, [[29, ['position'], 58], [29, ['position'], 115.275], [26, ['position'], 65], [26, ['position'], 62.53], [18, ['riskPerTrade'], 144]]);
  assert.equal(sizeEntry({ price: 100, stop: 95, cashShare: 15000, capUsd: 3000, riskUsd: 150 }).binding.join(), 'position,riskPerTrade', 'exactly 5%: both');
  assert.equal(sizeEntry({ price: 100, stop: 100, cashShare: 15000, capUsd: 3000, riskUsd: 150 }).shares, 0, 'stop at the price: no shares');
});

// ---------- entries and exits through the engine ----------

const D = [...BASE, 101, 103, 105, 107, 108, 109, 107.2, 106.2, 106];

test('dip entry and the resistance-rejection exit (example D): 29 shares, planned risk 58, armed at 108, exit at 106.2', () => {
  const r = run('rt-range-dip-nolimit-0.2.0.json', { AAA: D });
  const e = dec(r, 'entry')[0];
  assert.deepEqual([e.date, e.entryType, e.shares, e.binding, e.stop], [r.at(60), 'dip', 29, ['position'], 99]);
  near(e.plannedRisk, 58);
  const buy = r.fills.find((f) => f.side === 'buy');
  assert.deepEqual([buy.date, buy.shares], [r.at(61), 29]);
  near(buy.price, 101 * (1 + K));
  near(buy.entryRisk, 29 * (101 * (1 + K) - 99));
  const x = dec(r, 'exit')[0];
  assert.deepEqual([x.date, x.code], [r.at(67), 'rejection']);
  const t = r.trades[0];
  assert.deepEqual([t.entryType, t.kind, t.exitReason, t.exitDate, t.shares], ['dip', 'range', 'rejection', r.at(68), 29]);
  near(t.exitPrice, 106.2 * (1 - K));
  near(t.entryPosInRange, 0.1);
  // A stock that reaches the top and stays there is not sold.
  const stay = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, 103, 105, 107, 108, 109, 108.5, 109, 108.8] });
  assert.equal(stay.trades.length, 0);
  assert.equal(stay.openPositions.length, 1);
});

test('recovery entry at 103 (stop 99.025, 29 shares, planned risk 115.275)', () => {
  const r = run('rt-range-recovery-nolimit-0.2.0.json', { AAA: [...BASE, 101, 103, 104] });
  const e = dec(r, 'entry');
  assert.equal(e.length, 1);
  assert.deepEqual([e[0].date, e[0].entryType, e[0].shares], [r.at(61), 'recovery', 29]);
  near(e[0].stop, 99.025);
  near(e[0].plannedRisk, 115.275);
});

test('breakdown exit of a range trade: two closes below the frozen support - 0.5 x m(entry) (provisional two-close rule)', () => {
  const r = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, [101, 98.5], 98, 97] });
  const x = dec(r, 'exit');
  assert.deepEqual(x.map((d) => [d.date, d.code]), [[r.at(62), 'breakdown']]);
  const one = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, [101, 98.5], 99.5, 98] });
  assert.equal(dec(one, 'exit').length, 0, 'one close below, then back above: no exit');
});

test('a range trade that breaks out is held under the trend exits, then exits on two closes below the old high', () => {
  const r = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, 103, 105, 107, 109, 111.5, 109.5, 109, 108] });
  assert.equal(dec(r, 'convert_to_trend')[0].date, r.at(65));
  const t = r.trades[0];
  assert.deepEqual([t.entryType, t.kind, t.convertedToTrend, t.exitReason], ['dip', 'trend', true, 'below_old_high']);
  assert.equal(dec(r, 'exit')[0].date, r.at(67));
});

const B = [...BASE, 100, 102, 104, 106, 108, 111.5];

test('immediate breakout entry (stop 109, 26 shares) and the trend exits: two closes below the old high; giveback of 3 x m', () => {
  const r = run('rt-trend-immediate-nolimit-0.2.0.json', { AAA: [...B, 109.5, 109, 108] });
  const e = dec(r, 'entry')[0];
  assert.deepEqual([e.date, e.entryType, e.shares, e.stop], [r.at(65), 'immediate', 26, 109]);
  near(e.plannedRisk, 65);
  assert.equal(r.trades[0].exitReason, 'below_old_high');
  const g = run('rt-trend-immediate-nolimit-0.2.0.json', { AAA: [...B, 113, 116, 119, 112.9, 112] });
  assert.deepEqual([dec(g, 'exit')[0].code, dec(g, 'exit')[0].date], ['giveback', g.at(69)], '112.9 < 119 - 3 x 2');
  const h = run('rt-trend-immediate-nolimit-0.2.0.json', { AAA: [...B, 113, 116, 119, 113, 114] });
  assert.equal(dec(h, 'exit').length, 0, '113 is not below 113');
});

test('pullback entry: breakout 111.5, pullback close 110.8, up close 111.4 (stop 108.995, 26 shares); a failed breakout ends the watch', () => {
  const r = run('rt-trend-pullback-nolimit-0.2.0.json', { AAA: [...B, 110.8, 111.4, 112] });
  const e = dec(r, 'entry');
  assert.deepEqual(e.map((d) => [d.date, d.entryType, d.shares]), [[r.at(67), 'pullback', 26]]);
  near(e[0].stop, 108.995);
  near(e[0].plannedRisk, 26 * 2.405);
  const f = run('rt-trend-pullback-nolimit-0.2.0.json', { AAA: [...B, 109.8, 111, 112] });
  assert.equal(dec(f, 'entry').length, 0);
  assert.deepEqual(f.watches.map((w) => [w.reason, w.entered]), [['a close at or below the old high', false]]);
  const im = run('rt-trend-immediate-nolimit-0.2.0.json', { AAA: [...B, 110.8, 111.4] });
  assert.equal(dec(im, 'entry')[0].date, im.at(65), 'the immediate variant enters at the breakout close');
});

// ---------- fill-time rules: gaps up and down ----------

test('next-open gaps: reduced (never above the 20% cap), rejected (stop at or above the fill), cancelled (no whole share)', () => {
  const up = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, [104, 104]] });
  const f = up.fills.find((x) => x.side === 'buy');
  assert.equal(f.shares, 28, 'floor(3000 / 104.0416)');
  assert.ok(f.shares * f.price <= 0.2 * 15000);
  assert.ok(up.warnings.some((w) => w.code === 'order_reduced' && w.details.from === 29 && w.details.to === 28));
  const down = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, [98.9, 99]] });
  assert.equal(down.fills.length, 0);
  assert.ok(down.warnings.some((w) => w.code === 'entry_rejected' && w.details.code === 'stop_above_fill'));
  const S29 = BASE.map((c) => c * 29);
  const can = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...S29, 2929, [3100, 3100]] });
  assert.equal(dec(can, 'entry')[0].shares, 1);
  assert.equal(can.fills.length, 0);
  assert.ok(can.warnings.some((w) => w.code === 'order_cancelled' && w.details.code === 'no_whole_share'));
  for (const r of [up, down, can]) assert.ok(r.equity.every((p) => p.cash >= 0));
});

// ---------- several same-day signals ----------

test('same-day signals share cash and risk room equally, whole shares rounded down, leftover unused, order irrelevant', () => {
  const three = { AAA: [...BASE, 101, 101.5], BBB: [...BASE, 101, 101.5], CCC: [...BASE, 101, 101.5] };
  // Cap and risk per trade lifted to 100%: the cash share (15,000 / 3) binds: floor(5000 / 101.0404) = 49.
  const c1 = run('rt-range-dip-nolimit-0.2.0.json', three, { portfolio: { positionCapPct: 100, riskPerTradePct: 100 } });
  assert.deepEqual(dec(c1, 'entry').map((d) => [d.symbol, d.shares, d.binding.join(), d.signalsToday]), [['AAA', 49, 'cash', 3], ['BBB', 49, 'cash', 3], ['CCC', 49, 'cash', 3]]);
  near(dec(c1, 'entry')[0].cashShare, 5000);
  near(c1.equity.at(-1).cash, 15000 - 3 * 49 * 101 * (1 + K), 'leftover cash stays in cash');
  // Total risk 1%: room 150 shared by 3 = 50 each; at distance 2 that is 25 at the close, 24 at the fill (distance 2.0404).
  const c2 = run('rt-range-dip-nolimit-0.2.0.json', three, { portfolio: { positionCapPct: 100, riskPerTradePct: 100, totalEntryRiskPct: 1 } });
  assert.deepEqual(dec(c2, 'entry').map((d) => [d.shares, d.binding.join()]), [[25, 'riskRoom'], [25, 'riskRoom'], [25, 'riskRoom']]);
  assert.deepEqual(c2.fills.map((f) => f.shares), [24, 24, 24]);
  assert.ok(c2.fills.reduce((a, f) => a + f.entryRisk, 0) <= 150 + 1e-9, 'total entry risk within 1% of V');
  // Order independence, with three different price paths dipping on the same close.
  const diff = { AAA: [...BASE, 101, 101.5], BBB: [...BASE.map((x) => x * 1.02), 101 * 1.02, 101.5 * 1.02], CCC: [...BASE.map((x) => x * 0.98), 101 * 0.98, 101.5 * 0.98] };
  const opts = { portfolio: { positionCapPct: 100, riskPerTradePct: 100, totalEntryRiskPct: 1 } };
  const fwd = run('rt-range-dip-nolimit-0.2.0.json', diff, opts), rev = run('rt-range-dip-nolimit-0.2.0.json', diff, { ...opts, order: ['CCC', 'BBB', 'AAA'] });
  const shares = (r) => Object.fromEntries(r.fills.map((f) => [f.symbol, f.shares]));
  assert.equal(new Set(Object.values(shares(fwd))).size > 1, true, 'the paths differ, so the sizes differ');
  assert.equal(dec(fwd, 'entry').length, 3, 'all three on the same close');
  assert.deepEqual(shares(rev), shares(fwd), 'the order of the signals never matters');
});

// ---------- the re-entry limit ----------

test('re-entry limit (D1): a signal at or above the last sale price P is refused, never retired; a later signal below P enters; without the limit it enters at any price', () => {
  // Trade 1 (dip at 101) exits on the rejection decided at 67 and sells at the next open, 101: P = 101 x (1 - K).
  // 68: close 101, a dip at or above P (refused with the limit); 69: close 100.5, a dip below P (entered).
  // 70: the fill gaps up to 101.5, at or above P (cancelled); close 100.8, a dip below P (entered again);
  // 71: the fill at 100.6 is below P.
  const P = 101 * (1 - K);
  const after = [...D.slice(0, -1), [101, 101], 100.5, [101.5, 100.8], [100.6, 100.9]];
  const lim = run('rt-range-dip-limit-0.2.0.json', { AAA: after });
  near(lim.fills.find((f) => f.side === 'sell').price, P);
  assert.deepEqual(lim.skips.map((k) => [SESS.indexOf(k.date), k.code]), [[68, 'reentry_limit']]);
  assert.deepEqual(dec(lim, 'entry').map((d) => SESS.indexOf(d.date)), [60, 69, 70], 'refused at 68, decided at 69 and again at 70');
  const cancelled = lim.warnings.filter((w) => w.code === 'order_cancelled' && w.details.code === 'reentry_limit');
  assert.deepEqual(cancelled.map((w) => [SESS.indexOf(w.date), w.details.lastSalePrice]), [[70, P]]);
  assert.deepEqual(lim.fills.map((f) => [SESS.indexOf(f.date), f.side]), [[61, 'buy'], [68, 'sell'], [71, 'buy']]);
  assert.ok(!lim.warnings.some((w) => w.code === 'retired'), 'no stock is ever retired');
  assert.equal(lim.openPositions.length, 1);
  assert.equal(lim.fills.at(-1).afterSaleOf.above, false);
  // Without the limit the dip at 68 (at or above P) is entered at once, and reported as a re-entry above P.
  const free = run('rt-range-dip-nolimit-0.2.0.json', { AAA: after });
  assert.deepEqual(dec(free, 'entry').map((d) => SESS.indexOf(d.date)), [60, 68]);
  assert.equal(free.skips.length, 0);
  assert.deepEqual([free.fills.at(-1).side, SESS.indexOf(free.fills.at(-1).date), free.fills.at(-1).afterSaleOf.above], ['buy', 69, true]);
  // With the limit, a fill at or above P is cancelled even when the decision close was below it (P = 106.16 here).
  const ceil = run('rt-range-dip-limit-0.2.0.json', { AAA: [...D, 104, [104, 102], [107, 107]] });
  assert.equal(dec(ceil, 'entry').at(-1).date, ceil.at(70));
  assert.ok(ceil.warnings.some((w) => w.code === 'order_cancelled' && w.details.code === 'reentry_limit'));
});

// ---------- splits and dividends; accounting identities ----------

test('a 2-for-1 split while holding: shares double, every frozen level halves, the rejection exit still works', () => {
  const half = [53.5, 54, 54.5, 53.6, 53.1, 53];
  const r = run('rt-range-dip-nolimit-0.2.0.json', { AAA: [...BASE, 101, 103, 105, ...half] }, { splits: { 63: [{ symbol: 'AAA', ratio: 2 }] } });
  const t = r.trades[0];
  assert.deepEqual([t.shares, t.exitReason, t.exitDate], [58, 'rejection', r.at(68)]);
  near(t.stop, 49.5);
});

test('accounting: account value = cash + holdings at every close, cash never below zero, cash reconciles with fills and dividends', () => {
  const r = run('rt-range-dip-nolimit-0.2.0.json', { AAA: D, BBB: [...BASE, 101, 102, 104, 106, 108, 110, 109, 108, 108] }, { dividends: { 63: [{ symbol: 'AAA', amount: 0.5, payDate: SESS[66] }] } });
  for (const p of r.equity) { near(p.equity, p.cash + p.holdings, p.date, 1e-6); assert.ok(p.cash >= -1e-9); }
  const pay = r.dividends.filter((d) => d.kind === 'payment');
  near(pay[0].amount, 29 * 0.5 * 0.85, '15% withheld');
  const buys = r.fills.filter((f) => f.side === 'buy').reduce((a, f) => a + f.cost, 0);
  const sells = r.fills.filter((f) => f.side === 'sell').reduce((a, f) => a + f.proceeds, 0);
  const divs = r.dividends.filter((d) => d.kind === 'payment' || d.kind === 'cash_in_lieu').reduce((a, d) => a + d.amount, 0);
  near(r.cash, 15000 - buys + sells + divs, 'cash reconciles', 1e-6);
  for (const f of r.fills) assert.ok(f.spreadSlippage > 0, 'every fill carries its spread and slippage');
  assert.ok(r.fills.filter((f) => f.side === 'sell').every((f) => f.fees > 0), 'sell fees');
  const t = r.trades.find((x) => x.symbol === 'AAA');
  near(t.pnl, t.proceeds + t.dividends - t.cost, 'trade P/L includes dividends received while held', 1e-9);
});

// ---------- no look-ahead, future change, determinism, snapshots ----------

function market(seed, n, bump = null) {
  const days = new Map(), syms = ['AAA', 'BBB', 'CCC', 'DDD'];
  const st = Object.fromEntries(syms.map((s, i) => [s, { x: seed + i * 7, p: 50 + i * 20 }]));
  SESS.slice(0, n).forEach((d, i) => {
    const bars = {};
    syms.forEach((s, j) => {
      const o = st[s];
      o.x = (Math.imul(o.x, 1664525) + 1013904223) >>> 0;
      const r = o.x / 2 ** 32 - 0.5;
      const prev = o.p;
      // Ranges with occasional breakouts: a sine around a level that ramps up by 12 over 25 sessions every
      // 90-150 sessions, so breakouts are followed by wiggles near the old high (pullbacks).
      const span = 90 + 20 * j, step = Math.floor(i / span), into = (i % span) - (span - 25);
      const level = 100 + 12 * step + 12 * Math.max(0, into) / 25 + j * 10;
      o.p = Math.max(5, level * (1 + 0.06 * Math.sin(i / (5 + j))) + 2.5 * r);
      const k = bump && d > bump.after ? bump.factor : 1;
      bars[s] = { o: prev * k, h: Math.max(prev, o.p) * k, l: Math.min(prev, o.p) * k, c: o.p * k, v: 1000 };
    });
    days.set(d, { bars, splits: [], dividends: [] });
  });
  return { days, sessions: SESS.slice(0, n), symbols: syms.map((s) => ({ symbol: s })) };
}
const KEYS = ['decisions', 'fills', 'trades', 'skips', 'warnings', 'equity'];
let anyTrades = 0;
for (const file of PLANNED_CONFIGS) {
  test(`${file}: prefix invariance, future-change, determinism and snapshot round-trip`, () => {
    const n = 900, m = market(11, n);
    const config = cfg(file, { n });
    const full = runBacktest({ config, ...m, halfSpreadBps: 2 });
    anyTrades += full.fills.length;
    assert.ok(full.trades.length >= 2, `${file}: the synthetic market gives this config completed trades (${full.trades.length}), so the checks are not vacuous`);
    for (const frac of [0.3, 0.55, 0.8]) {
      const cut = m.sessions[Math.floor(n * frac)];
      const e = createEngine({ config, symbols: m.symbols, halfSpreadBps: 2 });
      for (const d of m.sessions) { if (d > cut) break; e.processSession(d, m.days.get(d)); }
      const part = e.output();
      for (const k of KEYS) assert.deepEqual(part[k], full[k].filter((x) => (x.date ?? x.exitDate) <= cut), `${k} up to ${cut}`);
    }
    const T = m.sessions[500];
    for (const factor of [0.7, 1.4]) {
      const b = runBacktest({ config, ...market(11, n, { after: T, factor }), halfSpreadBps: 2 });
      for (const k of ['decisions', 'fills', 'skips', 'equity']) assert.deepEqual(b[k].filter((x) => x.date <= T), full[k].filter((x) => x.date <= T), `${k} up to ${T} (later prices x${factor})`);
    }
    assert.deepEqual(runBacktest({ config, ...m, halfSpreadBps: 2 }), full, 'deterministic');
    const a = createEngine({ config, symbols: m.symbols, halfSpreadBps: 2 });
    for (const d of m.sessions.slice(0, 200)) a.processSession(d, m.days.get(d));
    const b = createEngine({ config, symbols: m.symbols, halfSpreadBps: 2, state: JSON.parse(JSON.stringify(a.snapshot())) });
    for (const d of m.sessions.slice(200)) b.processSession(d, m.days.get(d));
    const o = b.output();
    for (const k of KEYS) assert.deepEqual(o[k], full[k], `${k} after a restore`);
    for (const p of full.equity) near(p.equity, p.cash + p.holdings, p.date, 1e-6);
  });
}
test('the synthetic market produces trades (so the invariance tests are not vacuous)', () => {
  assert.ok(anyTrades > 0, `fills across the planned configs: ${anyTrades}`);
});

test('configs: the eight planned 0.2.0 configs load, hash distinctly and carry the approved values; the 0.1.0 files are superseded and refused', () => {
  const list = listConfigs();
  assert.deepEqual(list.filter((c) => c.planned).map((c) => c.file), PLANNED_CONFIGS);
  assert.deepEqual(list.filter((c) => c.superseded).map((c) => c.file), SUPERSEDED_CONFIGS);
  assert.equal(list.length, 16);
  assert.ok(list.filter((c) => c.planned).every((c) => !c.error));
  for (const c of list.filter((x) => x.superseded)) assert.match(c.error, /reentryRetire must be false.*recoveryUpClose.*recoveryNoTopSinceBottom.*brokenRange.*pullbackWatchEndsAt.*benchmark\.buyAndHold/s, c.file);
  assert.equal(new Set(list.filter((c) => c.planned).map((c) => c.hash)).size, 8);
  for (const f of PLANNED_CONFIGS) {
    const c = loadConfig(f);
    assert.deepEqual([c.portfolio.positionCapPct, c.portfolio.riskPerTradePct, c.portfolio.totalEntryRiskPct, c.portfolio.stopM, c.portfolio.addToPositions], [20, 1, 5, 0.5, false]);
    assert.deepEqual([c.period.start, c.period.end, c.period.basket], ['2017-10-02', '2021-12-31', 'A']);
    assert.equal(c.levels.breakdownCloses, 2);
    assert.deepEqual([c.reentryRetire, c.levels.recoveryUpClose, c.levels.recoveryNoTopSinceBottom, c.levels.brokenRange, c.levels.pullbackWatchEndsAt, c.benchmark.buyAndHold], [false, true, true, 'post_break_window', 'fill', 'equal_weight_fractional_never_rebalanced']);
    assert.match(configHash(c), /^[0-9a-f]{64}$/);
    assert.match(c.version, /-0\.2\.0$/);
  }
  assert.throws(() => loadConfig('rt-range-dip-limit-0.1.0.json'), /reentryRetire must be false/);
  const meta = run('rt-range-dip-nolimit-0.2.0.json', { AAA: D }).meta;
  assert.match(meta.symbolsHash, /^[0-9a-f]{64}$/);
  assert.equal(meta.configHash.length, 64);
});
