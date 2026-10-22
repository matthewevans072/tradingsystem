// hxr-prereg-2 rules (strategy/hxr/PREREGISTRATION-2.md section 3, ENGINE-SPEC.md
// section 5a): the recovery point, X1 (break below a recovery point, judged at
// the close), X2 (normal-movement allowance below the highest close), X3 (give
// back 10% of the peak gain, comparison only) and the one buy-back rule (a
// confirmed recovery point, filling only below the exit price; stay in cash after
// a missed rebound). Hand-checked cases use small windows so every number can be
// checked by hand; prefix invariance, a future-data test and snapshots use the
// pre-registered settings on synthetic prices. Synthetic prices only test code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHxrConfig } from '../server/hxr/config.js';
import {
  createEngine, runBacktest, periodSessions, recoveryPoint, evaluateRule, updateRuleState, exitPriceNow, historyLength, ENGINE_VERSION,
} from '../server/hxr/engine.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const X1 = loadHxrConfig('hxr-x1-0.2.0.json'), X2 = loadHxrConfig('hxr-x2-0.2.0.json'), X3 = loadHxrConfig('hxr-x3-0.2.0.json');
const K = (2 + 2) / 10000; // half-spread 2 bps (the floor, passed as a fixed number) + 2 bps slippage
const START = '2024-03-04';
const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

// A config with the pre-registered costs and small rule windows for hand checks.
function small(base, rule) {
  const c = clone(base);
  c.rule = { ...c.rule, ...rule };
  return c;
}

// Bars from rows of [open, close] (high/low enclose both); one symbol.
function daysOf(rows, { sym = 'TEST', splits = {} } = {}) {
  const sessions = periodSessions({ warmupFrom: START, end: '2024-12-31' }).slice(0, rows.length);
  const days = new Map();
  rows.forEach(([o, c], i) => {
    days.set(sessions[i], { bars: { [sym]: { o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 } }, splits: splits[i] ? [{ symbol: sym, ratio: splits[i] }] : [], dividends: [] });
  });
  return { days, sessions };
}

function run(config, rows, opts = {}) {
  const { days, sessions } = daysOf(rows, opts);
  const r = runBacktest({
    config, symbols: [{ symbol: 'TEST', exchange: 'NASDAQ', listedFrom: '2016-01-04' }],
    period: { warmupFrom: START, start: START, end: sessions.at(-1) }, inputs: { days, sessions, halfSpreadBps: 2 },
  });
  return { ...r, sessions };
}

const flat = (closes) => closes.map((c, i) => [i ? closes[i - 1] : c, c]); // open = previous close

test('the engine version and history length for the new rule types', () => {
  assert.equal(ENGINE_VERSION, 'hxr-engine-3');
  assert.equal(historyLength(X1.rule), 21, 'max(20 + 1, 2 x 5 + 1)');
  assert.equal(historyLength({ ...X1.rule, pivotSessions: 15 }), 31);
});

test('recovery point: strictly lower than k closes on each side, and a rebound of at least rebound x m; only closes up to today', () => {
  //            i-2  i-1   i   i+1  i+2 (today)
  const c = [102, 104, 101, 103, 106];
  assert.deepEqual(recoveryPoint(c, 2, 1, 2.5), { close: 101, highestAfter: 106, sessionsAgo: 2, m: 2.5 });
  assert.equal(recoveryPoint(c, 2, 1, 5.1), null, 'rebound 5 is below 1 x 5.1');
  assert.equal(recoveryPoint(c, 2, 2, 2.5).close, 101, '106 >= 101 + 2 x 2.5 exactly');
  assert.equal(recoveryPoint([102, 101, 101, 103, 106], 2, 1, 1), null, 'an equal close before it: not strictly lower');
  assert.equal(recoveryPoint([102, 104, 101, 101, 106], 2, 1, 1), null, 'an equal close after it: not strictly lower');
  assert.equal(recoveryPoint([104, 101, 103, 106], 2, 1, 1), null, 'needs 2k + 1 closes');
  // Not known until k closes after it exist: the same low one close earlier is not yet a recovery point.
  assert.equal(recoveryPoint([102, 104, 101, 103], 2, 1, 1), null);
});

test('X1 hand-checked: level from a confirmed recovery point, exit at the close below it, buy back below the exit price', () => {
  const cfg = small(X1, { volSessions: 2, pivotSessions: 2, reboundMultiple: 1, bufferMultiple: 0.5 });
  // idx: 0     1     2     3     4     5     6     7    8 (open 98)  9    10    11    12   13 (open 96)
  const rows = [...flat([100, 102, 104, 101, 103, 106, 108, 99]), [98, 97], [97, 96], [96, 94], [94, 95], [95, 97], [96, 97], [97, 98]];
  const r = run(cfg, rows);
  const s = r.sessions;
  // Recovery point idx 3 (close 101) confirmed at the close of idx 5: m = (|106-103| + |103-101|) / 2 = 2.5,
  // highest after 106 >= 101 + 2.5; level = 101 - 0.5 x 2.5 = 99.75. Close 99 at idx 7 < 99.75: exit.
  const exit = r.decisions.find((d) => d.side === 'sell');
  assert.equal(exit.date, s[7]);
  near(exit.values.level, 99.75, 'X1 level');
  near(exit.values.m, 0.5 * (Math.abs(99 - 108) + Math.abs(108 - 106)), 'm at the exit close');
  const sell = r.fills.find((f) => f.side === 'sell');
  assert.equal(sell.date, s[8], 'fills at the next open');
  near(sell.price, 98 * (1 - K), 'sell at the open less half-spread and slippage');
  // Buy-back: recovery point idx 10 (close 94; 97 and 96 before, 95 and 97 after) confirmed at idx 12:
  // m = (|97-95| + |95-94|) / 2 = 1.5; 97 >= 94 + 1.5; close 97 < exit price 97.9608.
  const bb = r.decisions.find((d) => d.side === 'buy');
  assert.equal(bb.date, s[12]);
  near(bb.values.exitPrice, 98 * (1 - K));
  assert.equal(bb.values.recoveryClose, 94);
  near(bb.values.m, 1.5);
  const buy = r.fills.find((f) => f.side === 'buy' && !f.initial);
  assert.equal(buy.date, s[13]);
  near(buy.price, 96 * (1 + K), 'bought back below the exit price');
  assert.equal(r.roundTrips.length, 1);
  assert.ok(r.roundTrips[0].changePct < 0);
  assert.equal(r.warnings.filter((w) => ['rebound_missed', 'buy_back_cancelled'].includes(w.code)).length, 0);
  // No exit before the first recovery point after buying: the same fall without a confirmed point is held.
  const early = run(cfg, flat([100, 98, 96, 94, 92]));
  assert.equal(early.decisions.length, 0);
});

test('buy-back: a gap up to or above the exit price cancels the order and the sleeve keeps waiting; a close at or above it means stay in cash', () => {
  const cfg = small(X1, { volSessions: 2, pivotSessions: 2, reboundMultiple: 1, bufferMultiple: 0.5 });
  const head = [...flat([100, 102, 104, 101, 103, 106, 108, 99]), [98, 97], [97, 96], [96, 94], [94, 95], [95, 97]];
  // idx 13 opens at 98.5: 98.5 x (1 + K) = 98.539 is not below 97.9608: cancelled, still out.
  const gap = run(cfg, [...head, [98.5, 96.5], [96.5, 96]]);
  const w = gap.warnings.find((x) => x.code === 'buy_back_cancelled');
  assert.equal(w.date, gap.sessions[13]);
  near(w.details.price, 98.5 * (1 + K));
  assert.equal(gap.fills.filter((f) => f.side === 'buy' && !f.initial).length, 0);
  assert.equal(gap.sleeves[0].state, 'out');
  assert.equal(gap.roundTrips.length, 0);
  // Missed rebound: after the exit the close returns to 98.2 >= 97.9608 before any recovery point.
  const missed = run(cfg, [...flat([100, 102, 104, 101, 103, 106, 108, 99]), [98, 97], [97, 98.2], [98.2, 94], [94, 92], [92, 91], [91, 93], [93, 96]]);
  const m = missed.warnings.filter((x) => x.code === 'rebound_missed');
  assert.equal(m.length, 1);
  assert.equal(m[0].date, missed.sessions[9]);
  near(m[0].details.exitPrice, 98 * (1 - K));
  assert.equal(missed.decisions.filter((d) => d.side === 'buy').length, 0, 'never buys back, even after the later recovery point at 91');
  assert.equal(missed.sleeves[0].state, 'out');
  assert.equal(missed.openExits.length, 1, 'reported as an exit not bought back');
});

test('X2 hand-checked: exit when the close is below the highest close since buying less multiple x m', () => {
  const cfg = small(X2, { volSessions: 2, multiple: 1, pivotSessions: 2, reboundMultiple: 1 });
  // Highest close 104 at idx 4; idx 5 close 101: m = (|101-104| + |104-103|) / 2 = 2, level 104 - 2 = 102 > 101.
  const r = run(cfg, flat([100, 101, 102, 103, 104, 101, 100]));
  const d = r.decisions.find((x) => x.side === 'sell');
  assert.equal(d.date, r.sessions[5]);
  assert.equal(d.values.anchorHigh, 104);
  near(d.values.m, 2);
  near(d.values.level, 102);
  // The pre-registered X2 exit is prereg-1 C2's exit: 3 x m below the highest close.
  assert.equal(X2.rule.multiple, 3);
});

test('X3 hand-checked: active only after the gain reaches activation x m, then exit at 10% given back', () => {
  const cfg = small(X3, { volSessions: 2, activationMultiple: 1, pivotSessions: 2, reboundMultiple: 1 });
  // E = 100 x (1 + K) = 100.04. idx 2 close 106: m = (2 + 4) / 2 = 3, 106 >= 100.04 + 3: active.
  // Level = 100.04 + 0.9 x (106 - 100.04) = 105.404. idx 3 close 105.4 <= 105.404: exit.
  const r = run(cfg, flat([100, 102, 106, 105.4, 104]));
  const d = r.decisions.find((x) => x.side === 'sell');
  assert.equal(d.date, r.sessions[3]);
  near(d.values.entryPrice, 100 * (1 + K));
  near(d.values.level, 100 * (1 + K) + 0.9 * (106 - 100 * (1 + K)));
  // Not active: a gain below activation x m never exits, even on a large fall afterwards.
  const quiet = run(small(X3, { volSessions: 2, activationMultiple: 10, pivotSessions: 2, reboundMultiple: 1 }), flat([100, 102, 106, 105.4, 104, 95]));
  assert.equal(quiet.decisions.length, 0);
  assert.equal(X3.rule.givebackPct, 10);
});

test('a split while holding divides the X1 level, the buy price and the exit price, so signals stay in one unit', () => {
  const cfg = small(X1, { volSessions: 2, pivotSessions: 2, reboundMultiple: 1, bufferMultiple: 0.5 });
  // As the X1 case, then a 2-for-1 split effective at idx 7: closes halve. Level 99.75 becomes 49.875.
  const closes = [100, 102, 104, 101, 103, 106, 108];
  const rows = [...flat(closes), [54, 49.5]]; // idx 7 in post-split units: 49.5 < 49.875
  const r = run(cfg, rows, { splits: { 7: 2 } });
  const d = r.decisions.find((x) => x.side === 'sell');
  assert.equal(d.date, r.sessions[7]);
  near(d.values.level, 99.75 / 2);
  // exitPriceNow converts the stored exit price to the current share units.
  assert.equal(exitPriceNow({ splitFactor: 6, lastExit: { price: 90, splitFactor: 2 } }), 30);
  assert.equal(exitPriceNow({ splitFactor: 1, lastExit: null }), null);
});

test('updateRuleState and evaluateRule read only the sleeve: X1 level only rises, X3 activation is sticky', () => {
  const rule = { type: 'recovery_break', volSessions: 2, pivotSessions: 2, reboundMultiple: 1, bufferMultiple: 0.5, afterMissedRebound: 'stay_out' };
  const sl = { state: 'in', history: [100, 102, 104, 101, 103, 106], sinceFill: 6, level: 100.5, anchorHigh: 106 };
  const u = updateRuleState(rule, sl);
  assert.equal(u.raised, false, 'a lower recovery-point level never lowers the exit level');
  assert.equal(sl.level, 100.5);
  sl.level = null;
  updateRuleState(rule, sl);
  near(sl.level, 99.75);
  // A recovery point before the buy fill does not count: sinceFill < k + 1.
  const before = { state: 'in', history: [100, 102, 104, 101, 103, 106], sinceFill: 2, level: null };
  assert.equal(updateRuleState(rule, before), null);
  assert.equal(before.level, null);
  const g = { type: 'giveback', volSessions: 2, givebackPct: 10, activationMultiple: 1, pivotSessions: 2, reboundMultiple: 1, afterMissedRebound: 'stay_out' };
  const sg = { state: 'in', history: [100, 102, 106], entryPrice: 100, anchorHigh: 106, gbActive: false };
  updateRuleState(g, sg);
  assert.equal(sg.gbActive, true);
  sg.history = [100, 102, 106, 106.5]; // a calmer day: still active
  updateRuleState(g, sg);
  assert.equal(sg.gbActive, true);
  assert.equal(evaluateRule(g, { ...sg, history: [100, 102, 106, 105] }).side, 'sell');
});

// ---------- prefix invariance, future data and snapshots (pre-registered settings) ----------

const SYMS = [{ symbol: 'AAA', exchange: 'NASDAQ', listedFrom: '2016-01-04' }, { symbol: 'BBB', exchange: 'NYSE', listedFrom: '2016-01-04' }];
function synthetic({ end = '2024-12-31', bump = null } = {}) {
  const sessions = periodSessions({ warmupFrom: '2022-01-03', end });
  const days = new Map();
  const st = { AAA: { x: 7, p: 50 }, BBB: { x: 11, p: 80 } };
  sessions.forEach((d, i) => {
    const bars = {};
    for (const [sym, s] of Object.entries(st)) {
      s.x = (Math.imul(s.x, 1664525) + 1013904223) >>> 0;
      const r = s.x / 2 ** 32 - 0.5;
      const prev = s.p;
      s.p = s.p * (1 + 0.03 * r + 0.012 * Math.sin(i / (sym === 'AAA' ? 17 : 23)));
      const k = bump && d > bump.after ? bump.factor : 1;
      const o = prev * k, c = s.p * k;
      bars[sym] = { o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 1e6 };
    }
    days.set(d, { bars, splits: [], dividends: [] });
  });
  return { days, sessions };
}
const PERIOD = { warmupFrom: '2022-01-03', start: '2022-03-01', end: '2024-12-31' };
const runFull = (config, data) => runBacktest({ config, symbols: SYMS, period: PERIOD, inputs: { ...data, halfSpreadBps: 2 } });

for (const [name, cfg] of [['X1', X1], ['X2', X2], ['X3', X3]]) {
  test(`${name} prefix invariance: decisions, fills, warnings and equity up to a cut are identical with data only up to the cut`, () => {
    const data = synthetic();
    const full = runFull(cfg, data);
    assert.ok(full.fills.some((f) => f.side === 'sell'), `at least one exit to compare (${full.fills.length} fills)`);
    for (const frac of [0.2, 0.45, 0.7, 0.93]) {
      const cut = data.sessions[Math.floor(data.sessions.length * frac)];
      const e = createEngine({ config: cfg, symbols: SYMS, period: { ...PERIOD, end: null }, halfSpreadBps: 2 });
      for (const d of data.sessions) { if (d > cut) break; e.processSession(d, data.days.get(d)); }
      const part = e.output();
      const upTo = (list, key = 'date') => list.filter((x) => x[key] <= cut);
      assert.deepEqual(part.decisions, upTo(full.decisions), `${name} decisions up to ${cut}`);
      assert.deepEqual(part.fills, upTo(full.fills), `${name} fills up to ${cut}`);
      assert.deepEqual(part.warnings, upTo(full.warnings), `${name} warnings up to ${cut}`);
      assert.deepEqual(part.equity, upTo(full.equity), `${name} equity up to ${cut}`);
    }
  });

  test(`${name} future-data test: changing every bar after T leaves everything up to T unchanged`, () => {
    const T = '2023-08-15';
    const a = runFull(cfg, synthetic());
    for (const factor of [0.6, 1.7]) {
      const b = runFull(cfg, synthetic({ bump: { after: T, factor } }));
      for (const k of ['decisions', 'fills', 'warnings', 'equity', 'roundTrips']) {
        const key = k === 'roundTrips' ? 'buyBackDate' : 'date';
        assert.deepEqual(b[k].filter((x) => x[key] <= T), a[k].filter((x) => x[key] <= T), `${name} ${k} up to ${T} (later prices x${factor})`);
      }
      assert.notEqual(b.meta.inputsHash, a.meta.inputsHash, 'the changed later bars did reach the engine');
    }
  });

  test(`${name} snapshot round-trip and determinism`, () => {
    const data = synthetic();
    const full = runFull(cfg, data);
    const again = runFull(cfg, data);
    assert.deepEqual(again.decisions, full.decisions, 'deterministic, ids included');
    assert.deepEqual(again.fills, full.fills);
    for (const frac of [0.33, 0.61]) {
      const cut = Math.floor(data.sessions.length * frac);
      const a = createEngine({ config: cfg, symbols: SYMS, period: PERIOD, halfSpreadBps: 2 });
      for (const d of data.sessions.slice(0, cut)) a.processSession(d, data.days.get(d));
      const b = createEngine({ config: cfg, symbols: SYMS, period: PERIOD, halfSpreadBps: 2, state: JSON.parse(JSON.stringify(a.snapshot())) });
      for (const d of data.sessions.slice(cut)) b.processSession(d, data.days.get(d));
      const out = b.finish();
      for (const k of ['decisions', 'fills', 'warnings', 'equity', 'roundTrips', 'episodes']) assert.deepEqual(out[k], full[k], `${name} ${k} after a restore at ${frac}`);
    }
  });
}
