// Range-trend Tier 1 tests for the owner's decisions D1-D4 and the pullback-watch rule (EXPERIMENT-LOG.md
// entry 7; PLAN-DRAFT.md v0.5 sections 2.4, 3, 4 and 7c). Made-up closes only test code; nothing here is
// market data or a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, validateConfig, PLANNED_CONFIGS, SUPERSEDED_CONFIGS, RT_CONFIG_DIR } from '../server/rangetrend/config.js';
import { createEngine, runBacktest } from '../server/rangetrend/engine.js';
import { computeMetrics, exposureMatched, tradeOff } from '../server/rangetrend/metrics.js';
import { holdIndex } from '../server/rangetrend/benchmark.js';
import { periodSessions } from '../server/hxr/engine.js';

const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const K = 0.0004; // 2 bps half-spread (the floor) + 2 bps slippage
const PAT = [100, 102, 104, 106, 108, 110, 108, 106, 104, 102];
const BASE = Array.from({ length: 6 }, () => PAT).flat(); // 60 closes ending at 102 (section 3)
const P9 = Array.from({ length: 6 }, () => PAT.map((x) => x * 0.9)).flat(); // a new range of 90-99, 60 closes
const SESS = periodSessions({ warmupFrom: '2024-01-02', end: '2027-12-31' });
const CFG = (family, entry, limit) => PLANNED_CONFIGS.find((f) => f === `rt-${family}-${entry}-${limit ? 'limit' : 'nolimit'}-0.2.0.json`);
const DIP = CFG('range', 'dip', false), DIP_LIMIT = CFG('range', 'dip', true), RECOVERY = CFG('range', 'recovery', false);
const IMMEDIATE = CFG('trend', 'immediate', false), PULLBACK = CFG('trend', 'pullback', false);

// paths: { SYM: [close | [open, close] | null, ...] } (index 0 = SESS[0]); a bare close opens at the stock's
// previous close; null = no bar that session. Trading starts at SESS[startIndex].
function build(paths, { splits = {}, dividends = {} } = {}) {
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
  return { syms, n, days };
}
function config(file, { portfolio = {}, n, startIndex = 60 }) {
  const c = JSON.parse(JSON.stringify(loadConfig(file)));
  c.portfolio = { ...c.portfolio, ...portfolio };
  c.period = { ...c.period, warmupFrom: SESS[0], start: SESS[startIndex], end: SESS[n - 1] };
  return c;
}
function run(file, paths, { portfolio = {}, splits = {}, dividends = {}, startIndex = 60 } = {}) {
  const { syms, n, days } = build(paths, { splits, dividends });
  const cfg = config(file, { portfolio, n, startIndex });
  const r = runBacktest({ config: cfg, symbols: syms.map((s) => ({ symbol: s })), sessions: SESS.slice(0, n), days, halfSpreadBps: 2 });
  return { ...r, config: cfg, days, at: (i) => SESS[i], idx: (d) => SESS.indexOf(d) };
}
const dec = (r, action, symbol = null) => r.decisions.filter((d) => d.action === action && (!symbol || d.symbol === symbol));
const idxs = (r, items) => items.map((x) => r.idx(x.date));
const SKIP0 = { positionCapPct: 0.1 }; // a US$15 cap: every signal is a 0-share skip, so the stock stays unheld
const D = [...BASE, 101, 103, 105, 107, 108, 109, 107.2, 106.2, 106];
const B = [...BASE, 100, 102, 104, 106, 108, 111.5];

// ---------- D1: re-entry (never retire; the limit refuses at or above P) ----------

test('D1: with the limit a signal at a close equal to P or above is refused, a fill at or above P is cancelled, a later signal below P enters, the stock is never retired, and a never-sold stock is unrestricted', () => {
  // AAA: trade 1 (dip at 101) exits on the rejection decided at 67 and sells at the 68 open, 101: P = 101 x (1 - K).
  // 68: close = P exactly (refused); 69: 100.5 (entered); 70: the fill gaps to 101.5, at or above P (cancelled),
  // close 100.8 (entered again); 71: the fill at 100.6 is below P. BBB is never sold and dips at 68 too.
  const P = 101 * (1 - K);
  const AAA = [...D.slice(0, -1), [101, P], 100.5, [101.5, 100.8], [100.6, 100.9]];
  const BBB = [...BASE, 104, 104, 104, 104, 104, 104, 104, 104, 101, 101.5, 102, 102];
  const r = run(DIP_LIMIT, { AAA, BBB });
  near(r.fills.find((f) => f.side === 'sell' && f.symbol === 'AAA').price, P);
  assert.deepEqual(r.skips.map((k) => [r.idx(k.date), k.symbol, k.code]), [[68, 'AAA', 'reentry_limit']]);
  near(r.skips[0].lastSale.price, P);
  assert.deepEqual(idxs(r, dec(r, 'entry', 'AAA')), [60, 69, 70]);
  assert.deepEqual(idxs(r, dec(r, 'entry', 'BBB')), [68], 'a never-sold stock enters at once');
  assert.deepEqual(r.warnings.filter((w) => w.code === 'order_cancelled').map((w) => [r.idx(w.date), w.symbol, w.details.code, w.details.lastSalePrice]), [[70, 'AAA', 'reentry_limit', P]]);
  assert.deepEqual(r.fills.filter((f) => f.symbol === 'AAA').map((f) => [r.idx(f.date), f.side]), [[61, 'buy'], [68, 'sell'], [71, 'buy']]);
  assert.ok(!r.warnings.some((w) => w.code === 'retired'), 'no stock is ever retired');
  assert.deepEqual(Object.keys(r.lastSales), ['AAA']);
  assert.deepEqual([r.openPositions.map((o) => o.symbol).sort(), r.fills.at(-1).afterSaleOf.above], [['AAA', 'BBB'], false]);
  const m = computeMetrics(r);
  assert.deepEqual([m.hypotheses.H5.reentriesAboveLastSale, m.hypotheses.H5.reentryLimitSkips, m.hypotheses.H5.reentryLimitCancellations, m.perStock.AAA.skips, m.perStock.AAA.cancellations], [0, 1, 1, { reentry_limit: 1 }, { reentry_limit: 1 }]);
  // A fill price exactly equal to P (half-spread and slippage included) is cancelled too: the sale at the 68
  // open 106.2 gives P = 106.2 x (1 - K); the dip at 102 (70) fills at the open P / (1 + K), so the fill is P.
  const P2 = 106.2 * (1 - K);
  const eq = run(DIP_LIMIT, { AAA: [...D, 104, [104, 102], [P2 / (1 + K), 103]] });
  const eqc = eq.warnings.filter((w) => w.code === 'order_cancelled');
  assert.deepEqual(eqc.map((w) => [eq.idx(w.date), w.details.code]), [[71, 'reentry_limit']]);
  near(eqc[0].details.price, P2, 'the fill price is P');
  assert.equal(eq.fills.filter((f) => f.side === 'buy').length, 1, 'no second buy');
});

test('D1: without the limit the stock re-enters at or above P, and the re-entries above the last sale are reported', () => {
  const P = 101 * (1 - K);
  const r = run(DIP, { AAA: [...D.slice(0, -1), [101, P], 100.5, [101.5, 100.8], [100.6, 100.9]] });
  assert.deepEqual(idxs(r, dec(r, 'entry')), [60, 68]);
  assert.equal(r.skips.length, 0);
  assert.deepEqual([r.fills.at(-1).side, r.idx(r.fills.at(-1).date), r.fills.at(-1).afterSaleOf.above], ['buy', 69, true]);
  const h5 = computeMetrics(r).hypotheses.H5;
  assert.deepEqual([h5.reentriesAboveLastSale, h5.completedTradesAboveLastSale, h5.reentryLimitSkips], [1, 0, 0], 'open positions count as re-entries; P is only reported');
  assert.ok(r.lastSales.AAA, 'P is still tracked');
});

test('D1: a position closed by a split that leaves no whole share is not a sale: P is unchanged (split-adjusted)', () => {
  // Sold at 68 (P = 106.2 x (1 - K)); re-entered at the dip 101.5 (69, filled 70); a 1-for-50 reverse split at 72
  // leaves 0.58 of a share: the position closes at the split, and P stays the 68 sale, now in post-split units.
  const r = run(DIP_LIMIT, { AAA: [...D, 101.5, 102, 103, [5150, 5150], 5200] }, { splits: { 72: [{ symbol: 'AAA', ratio: 0.02 }] } });
  assert.deepEqual(r.trades.map((t) => [r.idx(t.exitDate), t.exitReason]), [[68, 'rejection'], [72, 'split_no_whole_share']]);
  near(r.lastSales.AAA.price, 106.2 * (1 - K) / 0.02, 'the sale of 68, split-adjusted');
  assert.equal(r.idx(r.lastSales.AAA.date), 68);
  // The decision-time copy of P reported with a fill and a trade is split-adjusted too: the dip decided at 69
  // fills at 70, on the session of a 2-for-1 split, and reports P in post-split units beside its fill price.
  const sp = run(DIP, { AAA: [...D, 101.5, [50.75, 51], 51.5, 49, 48.5, 48] }, { splits: { 70: [{ symbol: 'AAA', ratio: 2 }] } });
  const fill = sp.fills.find((f) => f.side === 'buy' && sp.idx(f.date) === 70);
  near(fill.afterSaleOf.price, 106.2 * (1 - K) / 2);
  near(fill.price, 50.75 * (1 + K));
  near(sp.trades.at(-1).afterSaleOf.price, 106.2 * (1 - K) / 2, 'and in the trade record');
  near(sp.trades.at(-1).entryPrice, 50.75 * (1 + K));
});

test('D1 with the pullback family: a refused pullback signal counts as used; a pullback fill cancelled by the re-entry limit leaves the watch running', () => {
  // The first trade: a pullback entry (decided 67, filled 68) exits on two closes below 110 (68, 69) and sells at
  // the 70 open. Then a new range 95-104.5 (PAT x 0.95) for 60 closes (71..130), entirely after the break at 65,
  // breaks out at 131 (106 > 104.5 + 0.95): a new watch (old hi 104.5). 132: 105.5 is a pullback close; 133:
  // 106.2 is an up close, the signal.
  const LIMIT = CFG('trend', 'pullback', true);
  const P95 = Array.from({ length: 6 }, () => PAT.map((x) => x * 0.95)).flat();
  const first = [...B, 110.8, 111.4, 109.5, 109];
  // (a) Sold at 109: P = 108.96. The signal at 133 (106.2 < P) is entered; its fill gaps to 109.5, at or above P,
  // and is cancelled; the watch continues: 105.8 (134) is a new pullback close, 106.5 (135) an up close, a new
  // signal, filled at 136 (open 106.3 < P), which ends the watch.
  const a = run(LIMIT, { AAA: [...first, [109, 109], ...P95, 106, 105.5, 106.2, [109.5, 105.8], 106.5, [106.3, 107], 107.5] });
  const P = 109 * (1 - K);
  near(a.lastSales.AAA.price, P);
  assert.deepEqual(a.breaks.map((b) => [a.idx(b.date), b.kind]), [[65, 'breakout'], [131, 'breakout']]);
  assert.deepEqual(idxs(a, dec(a, 'entry')), [67, 133, 135]);
  assert.deepEqual(a.warnings.filter((w) => w.code === 'order_cancelled').map((w) => [a.idx(w.date), w.details.code, w.details.entryType]), [[134, 'reentry_limit', 'pullback']]);
  assert.deepEqual(a.watches.map((w) => [a.idx(w.date), a.idx(w.endedOn), w.reason, w.entered]), [[65, 68, 'pullback entry filled', true], [131, 136, 'pullback entry filled', true]]);
  assert.deepEqual(a.fills.map((f) => [a.idx(f.date), f.side]), [[68, 'buy'], [70, 'sell'], [136, 'buy']]);
  assert.equal(a.skips.length, 0);
  // (b) Sold at 105: P = 104.96. The signal at 133 (106.2 >= P) is refused and counts as used: 106.4 (134) is an
  // up close but gives no signal without a new pullback close (it is one itself); 106.6 (135) is then refused too.
  const b = run(LIMIT, { AAA: [...first, [105, 105], ...P95, 106, 105.5, 106.2, 106.4, 106.6, 106.8] });
  near(b.lastSales.AAA.price, 105 * (1 - K));
  assert.deepEqual(b.skips.map((k) => [b.idx(k.date), k.code, k.entryType]), [[133, 'reentry_limit', 'pullback'], [135, 'reentry_limit', 'pullback']]);
  assert.deepEqual(idxs(b, dec(b, 'entry')), [67]);
  assert.deepEqual(b.watches.map((w) => b.idx(w.date)), [65], 'the second watch is still running');
});

test('D3: a pending breakdown watch (the frozen lo) is split-adjusted; the conversion close is a confirming close', () => {
  // 98.5 (60) is a first breaking close (lo 100 frozen); a 2-for-1 split at 61 halves the frozen lo to 50 and
  // m to 1.0375: 49.6 is not below 50 - 0.519 = 49.48, so the watch is dropped (unscaled, 49.6 < 100 - 0.52
  // would confirm a breakdown); 49.4 would confirm it.
  const dropped = run(DIP, { AAA: [...BASE, 98.5, [49.2, 49.6], 49.5, 49.4] }, { splits: { 61: [{ symbol: 'AAA', ratio: 2 }] } });
  assert.deepEqual(dropped.breaks, []);
  const confirmed = run(DIP, { AAA: [...BASE, 98.5, [49.2, 49.4], 49.5, 49.4] }, { splits: { 61: [{ symbol: 'AAA', ratio: 2 }] } });
  assert.deepEqual(confirmed.breaks.map((x) => [confirmed.idx(x.date), x.kind, x.values.frozenLo, confirmed.idx(x.values.firstBreakingClose)]), [[61, 'breakdown', 50, 60]]);
  // A range trade converts at 66 (111.3 > the frozen 110 + 1, while the rolling top 110.8 + 0.5 x m is not
  // exceeded, so no untraded breakout coincides): that close is a confirming close, so after the trend exit
  // (two closes below 110, sold at 69) the old range's dips at 70-72 give no entry.
  const conv = run(DIP, { AAA: [...BASE, 101, 103, 105, 107, 109, 110.8, 111.3, 109.5, 109, 108, 101, 102, 101.5] });
  assert.deepEqual(conv.breaks.map((x) => [conv.idx(x.date), x.kind]), [[66, 'conversion']]);
  assert.deepEqual(conv.trades.map((t) => [conv.idx(t.exitDate), t.exitReason, t.convertedToTrend]), [[69, 'below_old_high', true]]);
  assert.deepEqual(idxs(conv, dec(conv, 'entry')), [60]);
});

test('D4: a split on a session without a bar moves the last close to post-split units; D5 lists every basket stock and the orders pending at the end', () => {
  const days = new Map();
  days.set(SESS[0], { bars: { AAA: { o: 100, c: 102 } }, splits: [], dividends: [] });
  days.set(SESS[1], { bars: {}, splits: [{ symbol: 'AAA', ratio: 2 }], dividends: [] });
  days.set(SESS[2], { bars: { AAA: { o: 51, c: 52 } }, splits: [], dividends: [] });
  const idx = holdIndex({ symbols: ['AAA'], sessions: SESS.slice(0, 3), days, start: SESS[0], startingCash: 7500, withholdingPct: 15 });
  assert.deepEqual(idx.map((p) => p.value), [75 * 102, 150 * 51, 150 * 52]);
  // A dip decided on the last session leaves a buy order pending at the end; a stock with no activity has a row of zeros.
  const r = run(DIP, { AAA: [...BASE, 101], BBB: [...BASE.map((x) => x * 2), 210] });
  assert.deepEqual(r.pendingOrders.map((o) => [o.symbol, o.side, r.idx(o.decisionDate), o.entryType]), [['AAA', 'buy', 60, 'dip']]);
  const m = computeMetrics(r);
  assert.deepEqual([m.pendingAtEnd, m.perStock.AAA.pendingAtEnd, m.perStock.BBB], [1, 1, { signals: 0, entries: 0, oneShareEntries: 0, skips: {}, cancellations: {}, rejections: {}, pendingAtEnd: 0, unpaidDividends: { count: 0, net: 0 }, pnl: 0 }]);
});

test('validateConfig refuses each superseded 0.1.0 file for the missing D1-D4 and watch declarations', () => {
  for (const f of SUPERSEDED_CONFIGS) {
    const c = JSON.parse(fs.readFileSync(path.join(RT_CONFIG_DIR, f), 'utf8'));
    const errors = validateConfig(c);
    for (const re of [/reentryRetire must be false/, /recoveryUpClose must be true/, /recoveryNoTopSinceBottom must be true/, /brokenRange must be "post_break_window"/, /pullbackWatchEndsAt must be "fill"/, /benchmark\.buyAndHold must be/]) assert.ok(errors.some((e) => re.test(e)), `${f}: ${re}`);
    assert.throws(() => loadConfig(f), /reentryRetire must be false/);
  }
});

// ---------- D2: the recovery entry ----------

test('D2: no recovery on a down close, nor on a close equal to the previous close; entry on the up close', () => {
  // 61: 105.5 is above the lower half; 62: 103.5 is a down close; 63: 103.5 equals the previous close;
  // 64: 104 is an up close with the thresholds met (visit low 101 + m 1.975 = 102.975 <= 104 <= 105).
  const r = run(RECOVERY, { AAA: [...BASE, 101, 105.5, 103.5, 103.5, 104] }, { portfolio: SKIP0 });
  assert.deepEqual(r.skips.map((k) => [r.idx(k.date), k.code, k.values.prevClose]), [[64, 'no_whole_share', 103.5]]);
  assert.equal(dec(r, 'entry').length, 0);
});

test('D2: no recovery after a top-zone close since the bottom visit; a top-zone close inside a merged visit does not count; example A enters', () => {
  // Blocked: 61 (108) is in the top zone after the visit at 60; the up close 104.5 at 63 meets every other threshold.
  const blocked = run(RECOVERY, { AAA: [...BASE, 101, 108, 104, 104.5] }, { portfolio: SKIP0 });
  assert.equal(blocked.skips.length, 0, 'no signal after a top-zone close since the bottom visit');
  // Merged: 60 (101) and 64 (101.5) are one visit (three closes outside, fewer than five), so the 108s at 61-63 lie
  // inside the visit, not after its last close: 103.5 at 65 is a recovery (101 + 2.225 = 103.225 <= 103.5).
  const merged = run(RECOVERY, { AAA: [...BASE, 101, 108, 108, 108, 101.5, 103.5] }, { portfolio: SKIP0 });
  assert.deepEqual(merged.skips.map((k) => [r2i(merged, k.date), k.code]), [[65, 'no_whole_share']]);
  near(merged.skips[0].values.visitLow, 101);
  // Example A: 103 after 101 is an up close with no top-zone close since the visit.
  const a = run(RECOVERY, { AAA: [...BASE, 101, 103, 104] });
  assert.deepEqual(dec(a, 'entry').map((d) => [a.idx(d.date), d.values.prevClose]), [[61, 101]]);
});
const r2i = (r, d) => r.idx(d);

// ---------- D3: the broken range ----------

test("D3: PLAN example C with 98.9: the breakdown's confirming close gives no dip; no entry until a range forms entirely after it; the 60th close after gives none, the 61st enters", () => {
  // 60: 98.5 (first breaking close, lo 100 frozen); 61: 98.9 < 100 - 0.5 x 2.075 confirms the breakdown although
  // it lies in the rolling window's bottom zone [98.5, 101.375]. Then P9, a 90-99 range, for 60 closes (62..121):
  // its 91.8 closes are dips of the rolling window but the window still holds the confirming close until 122.
  // 121 (91.8) is the 60th close after 61: no entry; 122 (91.5) is the 61st: the window 62..121 is entirely after.
  const r = run(DIP, { AAA: [...BASE, 98.5, 98.9, ...P9, 91.5] });
  assert.deepEqual(r.breaks.map((b) => [r.idx(b.date), b.kind, b.ordinal, r.idx(b.values.firstBreakingClose)]), [[61, 'breakdown', 62, 60]]);
  assert.deepEqual(idxs(r, dec(r, 'entry')), [122]);
  assert.equal(r.skips.length, 0);
  near(dec(r, 'entry')[0].values.lo, 90);
  // With one close fewer before the dip, the dip falls on the 60th close after the confirming close: no entry.
  const sixty = run(DIP, { AAA: [...BASE, 98.5, 98.9, ...P9.slice(0, 59), 91.5] });
  assert.equal(dec(sixty, 'entry').length, 0);
});

test('D3: PLAN example B followed by 113 and 114.5 gives at most one immediate decision, and the watch keeps the old high 110', () => {
  // 113 and 114.5 are above the rolling top (111.5 + 0.5 x 2.075) but the range is broken by the breakout at 65.
  const im = run(IMMEDIATE, { AAA: [...B, 113, 114.5] }, { portfolio: SKIP0 });
  assert.deepEqual(im.skips.map((k) => [im.idx(k.date), k.entryType]), [[65, 'immediate']]);
  assert.deepEqual(im.breaks.map((b) => [im.idx(b.date), b.kind]), [[65, 'breakout']], 'no new confirming close while not qualified');
  const { syms, n, days } = build({ AAA: [...B, 113, 114.5] });
  const e = createEngine({ config: config(PULLBACK, { n }), symbols: syms.map((s) => ({ symbol: s })), halfSpreadBps: 2 });
  for (const d of SESS.slice(0, n)) e.processSession(d, days.get(d));
  const st = e.snapshot().stocks.AAA;
  assert.deepEqual([st.watch.oldHi, e.output().watches], [110, []], 'the watch is neither replaced nor ended');
});

test("D3: a range trade sold on its own breakdown exit gets no new entry from the old range; the stock enters again on the 61st close after the exit decision", () => {
  // Entry at 60, fill 61; 98.5 and 98 (61, 62) are the breakdown: the exit is decided at 62 (the confirming close),
  // sold at 63. Then P9 for 60 closes (63..122) and 91.5 at 123, the 61st close after 62.
  const r = run(DIP, { AAA: [...BASE, 101, 98.5, 98, ...P9, 91.5] });
  assert.deepEqual(r.trades.map((t) => [r.idx(t.exitDate), t.exitReason]), [[63, 'breakdown']]);
  assert.deepEqual(r.breaks.filter((b) => r.idx(b.date) === 62).map((b) => b.kind), ['breakdown', 'trade_breakdown']);
  assert.deepEqual(idxs(r, dec(r, 'entry')), [60, 123]);
  const sixty = run(DIP, { AAA: [...BASE, 101, 98.5, 98, ...P9.slice(0, 59), 91.5] });
  assert.deepEqual(idxs(sixty, dec(sixty, 'entry')), [60]);
});

test("D3: a break during the warm-up blocks entries in the period's first closes; a stock with a missing bar counts its own closes", () => {
  // Trading starts at 100. The breakdown confirmed at 61 (warm-up) blocks the dips of P9 (91.8 at 101, 111, 121)
  // until the 61st close after it, 122. Without the break the first dip of the period, at 101, is entered.
  const broken = run(DIP, { AAA: [...BASE, 98.5, 98, ...P9, 91.5] }, { startIndex: 100 });
  assert.deepEqual(idxs(broken, dec(broken, 'entry')), [122]);
  assert.deepEqual(broken.breaks.map((b) => [broken.idx(b.date), b.kind]), [[61, 'breakdown']], 'checked during the warm-up');
  // Without a break (the range stays at 100-110; a fall to P9 would itself be a breakdown), the first dip of the
  // period, 102 at 101, is entered: it is the warm-up break that blocks, not the period's start.
  const control = run(DIP, { AAA: [...BASE, 100, 102, ...BASE, 101] }, { startIndex: 100 });
  assert.equal(idxs(control, dec(control, 'entry'))[0], 101, 'the first dip of the period is entered');
  assert.equal(control.breaks.length, 0);
  // A missing bar at 90 is not a close: the 61st own close after the confirming close is one session later, 123.
  const gap = [...BASE, 98.5, 98, ...P9, 91.5];
  gap.splice(90, 0, null);
  const g = run(DIP, { AAA: gap }, { startIndex: 100 });
  assert.deepEqual(idxs(g, dec(g, 'entry')), [123]);
  assert.equal(dec(g, 'entry')[0].values.close, 91.5);
});

// ---------- the pullback watch ----------

test('watch: a pullback entry rejected or cancelled at the fill leaves the watch running (a new pullback close and up close are needed); a filled one ends it', () => {
  // Rejected: the signal at 67 (111.4 after 110.8) fills at 68 with the open 108.5, below the sizing stop 108.995.
  // 111 (68) is a new pullback close and 111.5 (69) an up close: a new signal; the fill at 70 ends the watch.
  const rej = run(PULLBACK, { AAA: [...B, 110.8, 111.4, [108.5, 111], 111.5, 112] });
  assert.deepEqual(rej.warnings.filter((w) => w.code === 'entry_rejected').map((w) => [rej.idx(w.date), w.details.code, w.details.entryType]), [[68, 'stop_above_fill', 'pullback']]);
  assert.deepEqual(idxs(rej, dec(rej, 'entry')), [67, 69]);
  assert.deepEqual(rej.watches.map((w) => [rej.idx(w.date), rej.idx(w.endedOn), w.reason, w.entered, w.heldAtStart]), [[65, 70, 'pullback entry filled', true, false]]);
  assert.deepEqual(rej.fills.map((f) => [rej.idx(f.date), f.side]), [[70, 'buy']]);
  // Cancelled: no bar on the fill session 68; 111.2 (69) is a pullback close, 111.6 (70) an up close.
  const can = run(PULLBACK, { AAA: [...B, 110.8, 111.4, null, 111.2, 111.6, 112] });
  assert.deepEqual(can.warnings.filter((w) => w.code === 'order_cancelled').map((w) => [can.idx(w.date), w.details.code, w.details.entryType]), [[68, 'no_bar', 'pullback']]);
  assert.deepEqual(idxs(can, dec(can, 'entry')), [67, 70]);
  assert.deepEqual(can.watches.map((w) => [can.idx(w.endedOn), w.reason, w.entered]), [[71, 'pullback entry filled', true]]);
  // An up close alone, without a new pullback close, gives no new signal after a used one.
  const used = run(PULLBACK, { AAA: [...B, 110.8, 111.4, [108.5, 112.5], 113] });
  assert.deepEqual(idxs(used, dec(used, 'entry')), [67]);
  assert.equal(used.watches.length, 0, 'the watch is still running');
});

test('H4 counts only watches on stocks not held, with no buy waiting to fill, at the breakout', () => {
  // The fixture of fix-pass test a: a pullback entry at 67 is held through a second breakout at 137 (while held),
  // whose watch ends at 138; the first watch ended at its fill.
  const P2 = [120, 121, 122, 123, 124, 125, 126, 125, 124, 123, 122, 121];
  const ramp = [112, 113, 114, 115, 116, 117, 118, 119, 120];
  const r = run(PULLBACK, { AAA: [...B, 110.8, 111.4, ...ramp, ...Array.from({ length: 5 }, () => P2).flat(), 127, 125.5, 120.5, 120.6, 126.5, 127, 127.5] });
  assert.deepEqual(r.watches.map((w) => [r.idx(w.date), r.idx(w.endedOn), w.entered, w.heldAtStart]), [[65, 68, true, false], [137, 138, false, true]]);
  const h = computeMetrics(r).hypotheses.H3H4;
  assert.deepEqual([h.breakoutsNeverEntered, h.watchesEnded, h.watchesWhileHeld], [0, 2, 1]);
});

// ---------- D4: benchmark (a) and the exposure-matched hold ----------

test('D4: the equal-weight index on two stocks with a split and a dividend, hand-checked; a stock without a bar at the first open is bought at its first later open', () => {
  // US$15,000: US$7,500 into each at the first open. AAA 75 shares at 100, BBB 150 at 50.
  const days = new Map();
  const day = (i, bars, extra = {}) => days.set(SESS[i], { bars, splits: [], dividends: [], ...extra });
  day(0, { AAA: { o: 100, c: 102 }, BBB: { o: 50, c: 51 } });
  day(1, { AAA: { o: 102, c: 120 } }); // BBB keeps its last close
  day(2, { AAA: { o: 61, c: 65 }, BBB: { o: 51, c: 52 } }, { splits: [{ symbol: 'AAA', ratio: 2 }] }); // 150 AAA shares, no fraction paid out
  day(3, { AAA: { o: 65, c: 66 }, BBB: { o: 52, c: 50 } }, { dividends: [{ symbol: 'BBB', amount: 1, exDate: SESS[3], payDate: SESS[5] }] }); // 150 x 1 x 0.85 = 127.5 on day 5
  day(4, { AAA: { o: 66, c: 70 }, BBB: { o: 50, c: 51 } });
  day(5, { AAA: { o: 70, c: 72 } }); // pay date, BBB has no bar: credited as cash, reinvested at its next close
  day(6, { AAA: { o: 72, c: 72 }, BBB: { o: 51, c: 50 } }); // 127.5 / 50 = 2.55 more BBB shares
  day(7, { AAA: { o: 72, c: 72 }, BBB: { o: 50, c: 52 } });
  const idx = holdIndex({ symbols: ['AAA', 'BBB'], sessions: SESS.slice(0, 8), days, start: SESS[0], startingCash: 15000, withholdingPct: 15 });
  const expected = [75 * 102 + 150 * 51, 75 * 120 + 150 * 51, 150 * 65 + 150 * 52, 150 * 66 + 150 * 50, 150 * 70 + 150 * 51, 150 * 72 + 150 * 51 + 127.5, 150 * 72 + 152.55 * 50, 150 * 72 + 152.55 * 52];
  assert.deepEqual(expected, [15300, 16650, 17550, 17400, 18150, 18577.5, 18427.5, 18732.6]);
  idx.forEach((p, i) => near(p.value, expected[i], `I(${i})`, 1e-9));
  assert.deepEqual(idx.map((p) => p.date), SESS.slice(0, 8));
  near(idx[5].cash, 127.5, 'the dividend waits as cash until the next close');
  near(idx[6].cash, 0);
  // Never rebalanced: after day 1 AAA holds 9,000 of 16,650 and BBB 7,650; a daily rebalance would give 8,325 each.
  near(idx[1].holdings, 16650);
  // A stock without a bar at the first open: its share waits as cash at 0% and is bought at its first later open.
  const late = new Map(days);
  late.set(SESS[0], { bars: { AAA: { o: 100, c: 102 } }, splits: [], dividends: [] });
  late.set(SESS[1], { bars: { AAA: { o: 102, c: 120 }, BBB: { o: 50, c: 51 } }, splits: [], dividends: [] });
  const li = holdIndex({ symbols: ['AAA', 'BBB'], sessions: SESS.slice(0, 3), days: late, start: SESS[0], startingCash: 15000, withholdingPct: 15 });
  near(li[0].value, 75 * 102 + 7500);
  near(li[0].cash, 7500);
  near(li[1].value, 75 * 120 + 150 * 51);
  near(li[2].value, 150 * 65 + 150 * 52);
});

test('D4: the exposure-matched hold B(t) hand-checked with invested > 0, and the trade-off rule on hand-made summaries', () => {
  const I = [15300, 16650, 17550, 17400, 18150];
  const f = [0, 0.5, 0.5, 1, 0];
  const runEq = I.map((_, i) => ({ date: SESS[i], value: 15000, invested: f[i] }));
  const B = exposureMatched(runEq, I.map((v, i) => ({ date: SESS[i], value: v })), 15000);
  // B(t) = B(t-1) x (1 + f(t-1) x (I(t) / I(t-1) - 1)), B(0) = 15,000.
  const b1 = 15000 * (1 + 0 * (16650 / 15300 - 1));
  const b2 = b1 * (1 + 0.5 * (17550 / 16650 - 1));
  const b3 = b2 * (1 + 0.5 * (17400 / 17550 - 1));
  const b4 = b3 * (1 + 1 * (18150 / 17400 - 1));
  [15000, b1, b2, b3, b4].forEach((v, i) => near(B[i].value, v, `B(${i})`));
  near(b2, 15405.405405405405);
  assert.ok(b4 > b3 && b3 < b2, 'invested days move B');
  assert.throws(() => exposureMatched([{ date: SESS[9], value: 1, invested: 0 }], [], 15000), /no index value/);
  // The trade-off rule (PLAN 7c), reported only.
  const c = { annualisedReturnPct: 8, maxDrawdownPct: 5, returnToDrawdown: 1.6 };
  assert.deepEqual(tradeOff({ annualisedReturnPct: 10, maxDrawdownPct: 5, returnToDrawdown: 2 }, c), { beatsReturnWithoutDeeperDrawdown: true, beatsReturnPerDrawdown: true, addsValueBeyondCash: true });
  assert.deepEqual(tradeOff({ annualisedReturnPct: 10, maxDrawdownPct: 6, returnToDrawdown: 10 / 6 }, c), { beatsReturnWithoutDeeperDrawdown: false, beatsReturnPerDrawdown: true, addsValueBeyondCash: true });
  assert.deepEqual(tradeOff({ annualisedReturnPct: 7, maxDrawdownPct: 4, returnToDrawdown: 1.75 }, c), { beatsReturnWithoutDeeperDrawdown: false, beatsReturnPerDrawdown: true, addsValueBeyondCash: true });
  assert.deepEqual(tradeOff({ annualisedReturnPct: 7, maxDrawdownPct: 5, returnToDrawdown: 1.4 }, c), { beatsReturnWithoutDeeperDrawdown: false, beatsReturnPerDrawdown: false, addsValueBeyondCash: false }, 'a smaller drawdown alone earns no credit');
  assert.deepEqual(tradeOff({ annualisedReturnPct: null, maxDrawdownPct: 0, returnToDrawdown: null }, c).addsValueBeyondCash, false);
  assert.equal(tradeOff(null, c), null);
});

test('D4 through the metrics: the index is benchmark (a), (c) derives from it, and the HXR hold arm is reported beside them', () => {
  const r = run(DIP, { AAA: D, BBB: [...BASE, 104, 104, 104, 104, 104, 104, 104, 104, 104] });
  const sessions = SESS.slice(60, r.equity.length + 60);
  const index = holdIndex({ symbols: ['AAA', 'BBB'], sessions, days: r.days, start: SESS[60], startingCash: 15000, withholdingPct: 15 });
  const hold = { equity: r.equity.map((p) => ({ date: p.date, equity: 15000 })) };
  const m = computeMetrics(r, { hold, index });
  assert.deepEqual(Object.keys(m.benchmarks).sort(), ['buyAndHold', 'cash', 'exposureMatched', 'hxrHoldArm']);
  near(m.benchmarks.buyAndHold.endValue, index.at(-1).value);
  assert.match(m.benchmarks.buyAndHold.label, /^derived: benchmark \(a\)/);
  assert.match(m.benchmarks.hxrHoldArm.label, /not the benchmark/);
  near(m.benchmarks.hxrHoldArm.endValue, 15000);
  const c = exposureMatched(r.equity.map((p) => ({ date: p.date, value: p.equity, invested: p.invested })), index, 15000);
  near(m.benchmarks.exposureMatched.endValue, c.at(-1).value);
  assert.equal(typeof m.tradeOffVsExposureMatched.addsValueBeyondCash, 'boolean');
  assert.equal(computeMetrics(r).benchmarks, undefined, 'no benchmarks without the index');
  assert.deepEqual(Object.keys(computeMetrics(r, { hold }).benchmarks).sort(), ['cash', 'hxrHoldArm']);
});
