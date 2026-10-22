// cb-1.1.0 (PARAMETER-LOG.md, 2026-10-22): cb-1.0.0 with only the target rule
// changed. Target = effective entry + minRewardRisk x (effective entry - stop),
// set at the simulated fill from the actual fill price; the maximum entry is
// the gap limit alone. Hand-checked numbers on the engine tests' fixture box,
// no look-ahead (the target depends on nothing after the fill price), prefix
// invariance and snapshot round-trips on synthetic data. Synthetic prices only
// test code; nothing here is market data or performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  loadStrategyConfig, applyOverrides, configHash, diffConfigs, validateConfig, loadUniverse, STRATEGY_DIR, DESCRIPTIVE_KEYS, ENGINE_VERSION,
} from '../server/strategy/config.js';
import { createEngine, runBacktest } from '../server/strategy/engine.js';
import { generateSyntheticBars } from '../server/strategy/synthetic.js';
import { whySignal } from '../server/strategy/explain.js';
import { sessionBarStarts } from '../server/strategy/sessions.js';
import { nextTradingDay } from '../server/calendar.js';

const V100 = loadStrategyConfig(path.join(STRATEGY_DIR, 'configs', 'cb-1.0.0.json'));
const V110 = loadStrategyConfig(path.join(STRATEGY_DIR, 'configs', 'cb-1.1.0.json'));
const SMALL = { 'box.lookbackBars': 6, 'box.atrLength': 3, 'box.minBarsBetweenTouches': 1, 'box.setupExpiryBars': 3, 'entry.volumeLookbackBars': 4 };
const C100 = applyOverrides(V100, { set: SMALL });
const C110 = applyOverrides(V110, { set: SMALL });

// The engine tests' hand-checked box: ceiling 101.0, floor 99.0, height 2.0; breakout candle bar 6.
const BOX = [
  [100.0, 101.0, 99.4, 100.6, 1000], [100.6, 100.7, 99.0, 99.4, 1000], [99.4, 100.9, 99.3, 100.7, 1000],
  [100.7, 100.8, 99.1, 99.3, 1000], [99.3, 100.5, 99.2, 100.2, 1000], [100.2, 100.6, 99.6, 100.4, 1000],
];
const BREAKOUT = [100.4, 101.2, 100.35, 101.1, 2000];
const A6 = 1.1886831275720193; // ATR at the breakout candle (engine tests)
const STOP = 100.23; // 100.35 - 0.1 x ATR, rounded down to the tick (unchanged from cb-1.0.0)
const K = 0.0004;
const EST = '2024-03-05';

function rowsToBars(date, rows, start = 0) {
  const out = [];
  let d = date, idx = start, starts = sessionBarStarts(d);
  for (const r of rows) {
    if (idx >= starts.length) { d = nextTradingDay(d); starts = sessionBarStarts(d); idx = 0; }
    out.push({ t: new Date(starts[idx]).toISOString(), o: r[0], h: r[1], l: r[2], c: r[3], v: r.length > 4 ? r[4] : 1000 });
    idx++;
  }
  return out;
}
const run = (rows, { config = C110, mode = 'swing', overrides } = {}) => runBacktest({ config, mode, overrides, bars: new Map([['TEST', rowsToBars(EST, rows)]]), symbols: [{ symbol: 'TEST', exchange: 'NYSE' }] });
const ofType = (r, type) => r.events.filter((e) => e.type === type);
const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const ceilTick = (x) => Number((Math.ceil(x / 0.01 - 1e-9) * 0.01).toFixed(10));

test('cb-1.1.0 differs from cb-1.0.0 only in the target rule; cb-1.0.0 is untouched', () => {
  assert.equal(configHash(V100), '5167db4c4278a5556a53c69f4335594c2fe55c2984e9bb9a42af57263fb3e2b6', 'cb-1.0.0 hash unchanged');
  assert.equal(V110.version, '1.1.0');
  assert.equal(V110.target.mode, 'risk_multiple');
  assert.deepEqual(validateConfig(V110), []);
  const rules = diffConfigs(V100, V110).filter((d) => !DESCRIPTIVE_KEYS.includes(d.path.split('.').pop()) && d.path !== 'version');
  assert.deepEqual(rules.map((d) => d.path), ['target.boxHeightMultiple', 'target.mode']);
  assert.equal(ENGINE_VERSION, 'engine-1.1.0');
  // A box-height target needs its multiple; a risk-multiple target must not carry one.
  assert.match(validateConfig({ ...V100, target: {} }).join(';'), /target.boxHeightMultiple is required/);
  assert.match(validateConfig({ ...V110, target: { mode: 'risk_multiple', boxHeightMultiple: 1 } }).join(';'), /not used/);
  assert.match(validateConfig({ ...V110, target: { mode: 'trailing' } }).join(';'), /target.mode must be/);
});

test('signal: no target yet, the gap limit alone caps the entry, sizing uses it', () => {
  const r = run([...BOX, BREAKOUT, [101.1, 101.3, 100.9, 101.2]]);
  const sig = ofType(r, 'signal')[0].details.plan;
  assert.equal(sig.target, null);
  assert.equal(sig.targetMode, 'risk_multiple');
  assert.equal(sig.rrLimit, null);
  assert.equal(sig.binding, 'gap');
  near(sig.gapLimit, 101.1 + 0.5 * A6, 'gap limit');
  assert.equal(sig.maxEntry, 101.69, 'gap limit rounded down to the tick (cb-1.0.0: 101.11, reward/risk binding)');
  assert.equal(sig.stop, STOP, 'stop rule unchanged');
  // Risk sizing at the worst acceptable entry 101.69: 160 shares fit the 250 budget, 161 do not.
  const wl = 101.69 * (1 + K) - STOP * (1 - K);
  assert.ok(160 * wl + 2 <= 250 && 161 * wl + 2 > 250);
  assert.equal(sig.shares, 160);
  assert.match(ofType(r, 'order_placed')[0].reason, /target set at the fill \(2:1\)/);
  assert.equal(ofType(r, 'order_placed')[0].details.target, null);
});

test('fill: the target comes from the actual fill price, rounded up to the tick, giving at least 2:1', () => {
  const r = run([...BOX, BREAKOUT, [101.1, 101.3, 100.9, 101.2]]);
  const t = r.events.find((e) => e.type === 'entry_filled').details;
  const E = 101.1 * (1 + K);
  near(t.price, E, 'effective entry');
  const want = ceilTick(E + 2 * (E - STOP));
  assert.equal(want, 102.97);
  assert.equal(t.target, 102.97);
  near(t.rewardRisk, (102.97 - E) / (E - STOP), 'reward/risk at the fill');
  assert.ok(t.rewardRisk >= 2);
  // An open above cb-1.0.0's reward/risk cap (101.11) now fills; its target is set from that open.
  const hi = run([...BOX, BREAKOUT, [101.5, 101.6, 101.4, 101.5]]);
  const f = hi.events.find((e) => e.type === 'entry_filled').details;
  const E2 = 101.5 * (1 + K);
  assert.equal(f.target, ceilTick(E2 + 2 * (E2 - STOP)));
  assert.equal(f.target, 104.17);
  assert.equal(ofType(run([...BOX, BREAKOUT, [101.5, 101.6, 101.4, 101.5]], { config: C100 }), 'entry_skipped')[0].details.code, 'above_max_entry', 'cb-1.0.0 skipped it');
  // Above the gap limit: still skipped, with the gap limit binding.
  const sk = ofType(run([...BOX, BREAKOUT, [101.75, 101.8, 101.7, 101.75]]), 'entry_skipped')[0];
  assert.equal(sk.details.code, 'above_max_entry');
  assert.equal(sk.details.binding, 'gap');
  // The stress entry (0.1 ATR worse) is part of the actual fill, so the target follows it.
  const w = run([...BOX, BREAKOUT, [101.1, 101.3, 100.9, 101.2]], { overrides: { entryWorseAtr: 0.1 } }).events.find((e) => e.type === 'entry_filled').details;
  near(w.price, E + 0.1 * A6, 'worse fill');
  assert.equal(w.target, ceilTick(w.price + 2 * (w.price - STOP)));
});

test('exits: the target fills one tick through as before; the trade record and explanation carry it', () => {
  // entry 101.10 (target 102.97); next bar's high 102.98 is one tick through.
  const r = run([...BOX, BREAKOUT, [101.1, 101.3, 100.9, 101.2], [101.3, 102.98, 101.2, 102.9]]);
  const t = r.trades[0];
  assert.equal(t.exit.reason, 'target');
  assert.equal(t.exit.raw, 102.97);
  assert.equal(t.plan.target, 102.97);
  assert.equal(t.plan.targetMode, 'risk_multiple');
  // Exactly at the target is not enough (one tick through is required).
  assert.equal(run([...BOX, BREAKOUT, [101.1, 101.3, 100.9, 101.2], [101.3, 102.97, 101.2, 102.9]]).trades[0].exit.reason, 'end_of_data');
  const text = whySignal(t).points.join(' ');
  assert.match(text, /Target 102\.97: set at the fill, 2 × the risk above the entry/);
  assert.match(text, /There is no separate reward\/risk limit/);
});

test('beyond the old box target: cb-1.0.0 rejects the signal; cb-1.1.0 places the order', () => {
  // ceiling 101 + height 2 = cb-1.0.0 target 103.00; the breakout closes at 103.10.
  const big = [100.4, 103.3, 100.35, 103.1, 2000];
  const old = run([...BOX, big, [103.1, 103.2, 103.0, 103.1]], { config: C100 });
  assert.equal(ofType(old, 'signal_rejected')[0].details.code, 'beyond_target');
  const now = run([...BOX, big, [103.1, 103.2, 103.0, 103.1]]);
  assert.equal(ofType(now, 'signal_rejected').length, 0);
  assert.equal(ofType(now, 'order_placed').length, 1);
});

test('no look-ahead: the target depends only on the fill; nothing after the open changes it', () => {
  const base = [...BOX, BREAKOUT, [101.1, 101.3, 100.9, 101.2], [101.2, 101.4, 101.0, 101.3], [101.3, 101.5, 101.1, 101.4]];
  const t0 = run(base).events.find((e) => e.type === 'entry_filled').details.target;
  // Change the entry bar after its open, and every later bar: same target.
  for (const k of [0.97, 1.01]) {
    const alt = base.map((r, i) => (i < 7 ? r : i === 7 ? [r[0], r[0] + (r[1] - r[0]) * k, r[0] - (r[0] - r[2]) * k, r[0] + (r[3] - r[0]) * k, 5000] : r.map((x, j) => (j < 4 ? x * k : x))));
    assert.equal(run(alt).events.find((e) => e.type === 'entry_filled').details.target, t0, `bars after the open x${k}`);
  }
  // A different open gives a different target: it is the fill that sets it.
  assert.notEqual(run([...BOX, BREAKOUT, [101.0, 101.3, 100.9, 101.2]]).events.find((e) => e.type === 'entry_filled').details.target, t0);
});

// ---------- prefix invariance and snapshots on synthetic data ----------

const UNIVERSE = loadUniverse();
const LOOSE = applyOverrides(V110, { set: { 'stop.maxCostToRiskPct': 60, 'entry.volumeMultiple': 1.3, 'risk.maxPositions': 2 } });
const SYMS = UNIVERSE.symbols.slice(0, 10);
const SYN = generateSyntheticBars({ symbols: SYMS, from: '2024-01-01', to: '2024-05-31', seed: 11 });
function timeline(barsMap) {
  const byT = new Map();
  for (const [sym, list] of barsMap) for (const b of list) {
    if (!byT.has(b.t)) byT.set(b.t, new Map());
    byT.get(b.t).set(sym, b);
  }
  return [...byT].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

test('cb-1.1.0 prefix invariance: decisions up to T are identical with data only up to T', () => {
  const tl = timeline(SYN.bars);
  for (const mode of ['swing', 'intraday']) {
    const full = createEngine({ config: LOOSE, mode, symbols: SYMS });
    for (const [t, m] of tl) full.processTimestamp(t, m);
    assert.ok(full.trades.length >= 15, `enough synthetic trades to compare (${full.trades.length})`);
    assert.ok(full.trades.every((t) => t.plan.targetMode === 'risk_multiple' && t.entry.rewardRisk >= 2 - 1e-9), 'every fill has at least 2:1');
    assert.ok(full.trades.every((t) => t.plan.target === ceilTick(t.entry.price + 2 * (t.entry.price - t.plan.stop))), 'every target comes from its own fill');
    for (const frac of [0.2, 0.45, 0.7, 0.93]) {
      const cut = tl[Math.floor(tl.length * frac)][0];
      const part = createEngine({ config: LOOSE, mode, symbols: SYMS });
      for (const [t, m] of tl) { if (t > cut) break; part.processTimestamp(t, m); }
      assert.deepEqual(part.events, full.events.filter((e) => e.at <= cut), `${mode} events up to ${cut}`);
      assert.deepEqual(part.trades, full.trades.filter((x) => x.exit.at <= cut), `${mode} trades up to ${cut}`);
      assert.deepEqual(part.equityCurve, full.equityCurve.filter((p) => p.t <= cut));
    }
  }
});

test('cb-1.1.0 snapshot: run to T, JSON round-trip, restore, continue = uninterrupted run; deterministic', () => {
  const tl = timeline(SYN.bars);
  const one = createEngine({ config: LOOSE, mode: 'swing', symbols: SYMS, tradeFrom: '2024-01-10' });
  for (const [t, m] of tl) one.processTimestamp(t, m);
  one.finish();
  for (const frac of [0.33, 0.61]) {
    const cut = Math.floor(tl.length * frac);
    const a = createEngine({ config: LOOSE, mode: 'swing', symbols: SYMS, tradeFrom: '2024-01-10' });
    const events = [], trades = [];
    for (const [t, m] of tl.slice(0, cut)) { const o = a.processTimestamp(t, m); events.push(...o.events); trades.push(...o.closedTrades); }
    const b = createEngine({ config: LOOSE, mode: 'swing', symbols: SYMS, state: JSON.parse(JSON.stringify(a.snapshot())) });
    for (const [t, m] of tl.slice(cut)) { const o = b.processTimestamp(t, m); events.push(...o.events); trades.push(...o.closedTrades); }
    const f = b.finish();
    events.push(...f.events); trades.push(...f.closedTrades);
    assert.deepEqual(events, one.events);
    assert.deepEqual(trades, one.trades);
  }
  const again = runBacktest({ config: LOOSE, mode: 'swing', bars: SYN.bars, symbols: SYMS, tradeFrom: '2024-01-10' });
  assert.deepEqual(again.trades, one.trades, 'deterministic');
  // A saved cb-1.1.0 state cannot be continued under cb-1.0.0 rules.
  const s = createEngine({ config: LOOSE, mode: 'swing', symbols: SYMS }).snapshot();
  assert.throws(() => createEngine({ config: applyOverrides(V100, { set: { 'stop.maxCostToRiskPct': 60, 'entry.volumeMultiple': 1.3, 'risk.maxPositions': 2 } }), mode: 'swing', symbols: SYMS, state: s }), /different strategy config/);
});
