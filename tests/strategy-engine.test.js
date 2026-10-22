// Strategy Lab engine (strategy/ENGINE-SPEC.md). Small handcrafted bar
// sequences on real NYSE dates with exact expected numbers (computed by hand
// from the spec), plus look-ahead, snapshot and determinism checks on
// synthetic data. Synthetic data only tests code; it is not performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadStrategyConfig, validateConfig, configHash, applyOverrides, diffConfigs, loadUniverse, loadSplits, loadAcceptance, ENGINE_VERSION,
} from '../server/strategy/config.js';
import { trueRange, wilderAtr } from '../server/strategy/indicators.js';
import {
  barInfo, sessionBarStarts, nextBarStartMs, addSessions, sessionsBetween, isLastBarOfSession, minutesToClose, endsWithinMinutesOfClose,
} from '../server/strategy/sessions.js';
import { commission, slipFactor, fillCost } from '../server/strategy/costs.js';
import { detectBox, countTouches } from '../server/strategy/boxes.js';
import { createEngine, runBacktest } from '../server/strategy/engine.js';
import { generateSyntheticBars } from '../server/strategy/synthetic.js';
import { whySetupQualifies, whySignal, whyRejectedOrSkipped, whatEnded } from '../server/strategy/explain.js';
import { nextTradingDay } from '../server/calendar.js';

const BASE = loadStrategyConfig();
// Small windows so every number can be checked by hand.
const SMALL = { 'box.lookbackBars': 6, 'box.atrLength': 3, 'box.minBarsBetweenTouches': 1, 'box.setupExpiryBars': 3, 'entry.volumeLookbackBars': 4 };
const CFG = applyOverrides(BASE, { set: SMALL });
const cfgWith = (set) => applyOverrides(BASE, { set: { ...SMALL, ...set } });

const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

// A box over bars 0-5 (ceiling 101.0, floor 99.0) and a breakout candle (bar 6).
const BOX = [
  [100.0, 101.0, 99.4, 100.6, 1000],
  [100.6, 100.7, 99.0, 99.4, 1000],
  [99.4, 100.9, 99.3, 100.7, 1000],
  [100.7, 100.8, 99.1, 99.3, 1000],
  [99.3, 100.5, 99.2, 100.2, 1000],
  [100.2, 100.6, 99.6, 100.4, 1000],
];
const BREAKOUT = [100.4, 101.2, 100.35, 101.1, 2000];
const FLAT = [101.2, 101.3, 101.0, 101.2, 1000];
// Hand-computed (ENGINE-SPEC §2, §4, §6) for BOX + BREAKOUT:
const ATR = [null, null, 4.9 / 3, 1.6555555555555558, 1.5370370370370374, 1.3580246913580247, 1.1886831275720193];
const A6 = ATR[6];
const STOP = 100.23; // 100.35 - 0.1 × ATR = 100.23113…, rounded down to the tick
const K = 0.0004;
const L = 101.11; // min(gap limit 101.6943, reward/risk limit 101.1129) rounded down to the tick
const SHARES = 257;
const E = 101.1 * (1 + K); // entry at the next open 101.10 plus spread and slippage
const PLANNED = SHARES * (E - STOP * (1 - K)) + 1.285 + 1.285;
const EST = '2024-03-05'; // a Tuesday in EST: 09:30 ET = 14:30Z

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

function run(rows, { config = CFG, mode = 'intraday', date = EST, start = 0, overrides, lowerTf, symbol = 'TEST' } = {}) {
  return runBacktest({
    config, mode, overrides, lowerTf,
    bars: new Map([[symbol, rowsToBars(date, rows, start)]]), symbols: [{ symbol, exchange: 'NYSE' }],
  });
}
const ofType = (r, type) => r.events.filter((e) => e.type === type);
const fillUntil = (rows, n, row = FLAT) => [...rows, ...Array(Math.max(0, n - rows.length)).fill(row)];

// ---------- config ----------

test('config loads deep-frozen, validates types, ranges and enums', () => {
  assert.ok(Object.isFrozen(BASE) && Object.isFrozen(BASE.box) && Object.isFrozen(BASE.costs));
  assert.deepEqual(validateConfig(BASE), []);
  const bad = JSON.parse(JSON.stringify(BASE));
  bad.simulation.ambiguity = 'random';
  bad.simulation.entryFill = 'market';
  bad.box.lookbackBars = 2.5;
  bad.risk.maxPositions = 0;
  bad.costs.tickSize = 0;
  delete bad.entry.volumeMultiple;
  bad.risk.allowMargin = true;
  const errs = validateConfig(bad);
  for (const p of ['simulation.ambiguity', 'simulation.entryFill', 'box.lookbackBars', 'risk.maxPositions', 'costs.tickSize', 'entry.volumeMultiple', 'risk.allowMargin']) {
    assert.ok(errs.some((e) => e.startsWith(p)), `${p} flagged: ${errs.join(' | ')}`);
  }
  assert.ok(validateConfig({ ...BASE, box: { ...BASE.box, minHeightAtr: 4 } }).some((e) => e.includes('minHeightAtr')));
  assert.equal(ENGINE_VERSION, 'engine-1.1.0'); // cb-1.1.0's target rule; cb-1.0.0 behaviour is unchanged (this file's hand-checked numbers)
});

test('config hash ignores descriptive fields and follows rule changes', () => {
  const h = configHash(BASE);
  assert.match(h, /^[0-9a-f]{64}$/);
  const described = JSON.parse(JSON.stringify(BASE));
  described.label = 'renamed'; described.status = 'x'; described.createdAt = '2030-01-01';
  described.costs.notes = 'different'; described.stop.interpretation = 'other words';
  assert.equal(configHash(described), h);
  // key order does not matter
  const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(BASE))).reverse());
  assert.equal(configHash(reordered), h);
  assert.notEqual(configHash(applyOverrides(BASE, { set: { 'box.lookbackBars': 25 } })), h);
});

test('applyOverrides (multiply, add, set incl. stress.entryWorseAtr) and diffConfigs', () => {
  const c = applyOverrides(BASE, { multiply: { 'costs.halfSpreadBps': 2, 'costs.commissionMinPerOrder': 3 }, add: { 'costs.slippageBps': 5, 'stress.entryWorseAtr': 0.1 }, set: { 'simulation.ambiguity': 'tv_path' } });
  assert.equal(c.costs.halfSpreadBps, 4);
  assert.equal(c.costs.commissionMinPerOrder, 3);
  assert.equal(c.costs.slippageBps, 7);
  assert.equal(c.stress.entryWorseAtr, 0.1);
  assert.equal(c.simulation.ambiguity, 'tv_path');
  assert.ok(Object.isFrozen(c));
  assert.equal(BASE.costs.halfSpreadBps, 2, 'original untouched');
  assert.throws(() => applyOverrides(BASE, { set: { 'box.nope': 1 } }), /Unknown setting/);
  assert.throws(() => applyOverrides(BASE, { set: { 'simulation.entryFill': 'market' } }), /invalid/);
  const d = diffConfigs(BASE, c);
  assert.deepEqual(d.map((x) => x.path), ['costs.commissionMinPerOrder', 'costs.halfSpreadBps', 'costs.slippageBps', 'simulation.ambiguity', 'stress.entryWorseAtr']);
  assert.deepEqual(d.find((x) => x.path === 'costs.slippageBps'), { path: 'costs.slippageBps', from: 2, to: 7 });
  assert.deepEqual(d.find((x) => x.path === 'stress.entryWorseAtr'), { path: 'stress.entryWorseAtr', from: null, to: 0.1 });
});

test('universe, splits and acceptance files load', () => {
  const u = loadUniverse();
  assert.equal(u.symbols.length, 17);
  assert.equal(u.symbols.filter((s) => s.cluster === 'ai_tech').length, 5);
  assert.equal(loadSplits().holdout.from, '2025-01-01');
  assert.equal(loadAcceptance().stressTests.neighbours.length, 12);
});

// ---------- indicators, sessions, costs ----------

test('Wilder ATR matches the hand computation (first value is the simple mean)', () => {
  const bars = rowsToBars(EST, [...BOX, BREAKOUT]);
  const atr = wilderAtr(bars, 3);
  assert.equal(atr[0], null);
  assert.equal(atr[1], null);
  for (let i = 2; i < 7; i++) near(atr[i], ATR[i], `ATR[${i}]`);
  // overnight gaps are part of the true range
  assert.equal(trueRange({ h: 105, l: 104, c: 104.5 }, 100), 5);
  assert.equal(trueRange({ h: 105, l: 104 }, null), 1);
});

test('sessions come from the calendar: early closes, holidays, next bar', () => {
  const ec = barInfo('2024-11-29T17:45:00.000Z'); // 12:45 ET on the day after Thanksgiving
  assert.equal(ec.inSession, true);
  assert.equal(ec.isLast, true);
  assert.equal(ec.earlyClose, true);
  assert.equal(minutesToClose('2024-11-29T17:30:00.000Z'), 15);
  assert.equal(endsWithinMinutesOfClose('2024-11-29T17:30:00.000Z', 15), true); // the 12:30 bar ends at 12:45
  assert.equal(endsWithinMinutesOfClose('2024-11-29T17:15:00.000Z', 15), false);
  assert.equal(sessionBarStarts('2024-11-29').length, 14);
  assert.equal(sessionBarStarts('2024-11-28').length, 0); // Thanksgiving
  assert.equal(barInfo('2024-11-29T18:00:00.000Z').inSession, false);
  assert.equal(isLastBarOfSession('2024-03-05T20:45:00.000Z'), true);
  assert.equal(isLastBarOfSession('2024-03-05T20:30:00.000Z'), false);
  // Thursday before Good Friday: the next bar is Monday's open (EDT)
  assert.equal(new Date(nextBarStartMs('2024-03-28T19:45:00.000Z')).toISOString(), '2024-04-01T13:30:00.000Z');
  assert.equal(addSessions('2024-03-28', 1), '2024-04-01');
  assert.equal(sessionsBetween('2024-03-28', '2024-04-01'), 2);
  assert.equal(barInfo('2024-03-05T14:00:00.000Z').inSession, false); // 09:00 ET pre-market
});

test('costs: commission minimum, per share, cap; spread+slippage; fx', () => {
  const c = BASE.costs;
  assert.equal(slipFactor(c), 0.0004);
  assert.equal(commission(c, 100, 50), 1); // minimum
  assert.equal(commission(c, 1000, 50), 5); // per share
  assert.equal(commission(c, 10, 5), 0.5); // capped at 1% of 50
  assert.equal(commission(c, 0, 50), 0);
  const buy = fillCost({ costs: c, side: 'buy', kind: 'market', raw: 100, shares: 10 });
  near(buy.price, 100.04);
  near(buy.spreadSlippage, 0.4);
  near(buy.cash, -(1000.4 + 1));
  const lim = fillCost({ costs: c, side: 'sell', kind: 'limit', raw: 100, shares: 10 });
  assert.equal(lim.price, 100);
  assert.equal(lim.spreadSlippage, 0);
  const cad = { ...c, accountCurrency: 'CAD', fxConversionPct: 1.5 };
  near(fillCost({ costs: cad, side: 'sell', kind: 'limit', raw: 100, shares: 10, currency: 'USD' }).fx, 15);
  assert.equal(fillCost({ costs: cad, side: 'sell', kind: 'limit', raw: 100, shares: 10, currency: 'CAD' }).fx, 0);
});

// ---------- boxes ----------

function hist(rows) {
  return rowsToBars(EST, rows).map((b) => ({ ...b, date: EST }));
}

test('box qualification: height, tolerance, touch separation, warm-up and reset', () => {
  const p = { lookbackBars: 6, atrLength: 3, maxHeightAtr: 3, minHeightAtr: 0, touchToleranceAtr: 0.2, minTouchesEach: 2, minBarsBetweenTouches: 1, setupExpiryBars: 3, invalidateOnCloseBelowSupport: true, allowWindowAcrossSessions: true };
  const h = hist(BOX);
  const b = detectBox(h, 5, ATR[5], p, 0);
  assert.ok(b);
  assert.equal(b.resistance, 101.0);
  assert.equal(b.support, 99.0);
  near(b.height, 2.0);
  near(b.tolerance, 0.2 * ATR[5]);
  assert.equal(b.windowStartIndex, 0);
  assert.equal(b.windowEndIndex, 5);
  // ceiling touches at bars 0 and 2 (bar 3 at 100.8 is within tolerance but only 1 bar after bar 2)
  assert.deepEqual(b.upperTouchTimes, [h[0].t, h[2].t]);
  assert.deepEqual(b.lowerTouchTimes, [h[1].t, h[3].t]);
  assert.equal(b.touchesUpper, 2);
  assert.equal(b.touchesLower, 2);
  // separation of 2 bars: the greedy count moves to bars 0 and 3, 1 and 4
  const b2 = detectBox(h, 5, ATR[5], { ...p, minBarsBetweenTouches: 2 }, 0);
  assert.deepEqual(b2.upperTouchTimes, [h[0].t, h[3].t]);
  assert.deepEqual(b2.lowerTouchTimes, [h[1].t, h[4].t]);
  assert.equal(detectBox(h, 5, ATR[5], { ...p, minTouchesEach: 3 }, 0), null);
  // tighter tolerance: 100.9 is no longer a ceiling touch (101 - 0.05*1.358 = 100.932)
  assert.equal(detectBox(h, 5, ATR[5], { ...p, touchToleranceAtr: 0.05 }, 0), null);
  // too tall: 2.0 > 1.4 x 1.358
  assert.equal(detectBox(h, 5, ATR[5], { ...p, maxHeightAtr: 1.4 }, 0), null);
  // warm-up and the reset rule
  assert.equal(detectBox(h.slice(0, 5), 4, ATR[4], p, 0), null);
  assert.equal(detectBox(h, 5, ATR[5], p, 1), null);
  assert.deepEqual(countTouches([{ x: 1 }, { x: 1 }, { x: 1 }, { x: 1 }], 10, (r) => r.x === 1, 1), [10, 12]);
});

test('the setup is frozen at eligibility and the breakout candle is never in its own window', () => {
  // bar 6 trades above the ceiling without closing above it: the frozen ceiling stays 101.0
  const r = run([...BOX, [100.4, 101.5, 100.3, 100.9, 1000], [100.9, 101.3, 100.8, 101.2, 2000], [101.2, 101.3, 101.1, 101.2]]);
  const elig = ofType(r, 'setup_eligible');
  assert.equal(elig.length, 1);
  assert.equal(elig[0].at, '2024-03-05T15:45:00.000Z'); // the 10:45 ET bar (bar 5)
  const sig = ofType(r, 'signal');
  assert.equal(sig.length, 1);
  assert.equal(sig[0].at, '2024-03-05T16:15:00.000Z'); // bar 7 closes at 101.2 > frozen 101.0 (not > 101.5)
  assert.equal(sig[0].details.box.resistance, 101.0);
  assert.ok(sig[0].details.box.windowEnd < sig[0].at);
});

test('expiry and invalidation', () => {
  const inside = [100.4, 100.8, 100.1, 100.5, 1000];
  const r = run([...BOX, inside, inside, inside]);
  const ex = ofType(r, 'setup_expired');
  assert.equal(ex.length, 1);
  assert.equal(ex[0].at, '2024-03-05T16:30:00.000Z'); // bar 8: 3 bars after eligibility
  assert.equal(ex[0].details.barsSinceEligible, 3);
  const r2 = run([...BOX, [100.4, 100.5, 98.8, 98.9, 1000]]);
  const inv = ofType(r2, 'setup_invalidated');
  assert.equal(inv.length, 1);
  assert.equal(inv[0].at, '2024-03-05T16:00:00.000Z');
  assert.match(whyRejectedOrSkipped(inv[0]).text, /98\.90, below the floor of 99\.00/);
  const r3 = run([...BOX, [100.4, 100.5, 98.8, 98.9, 1000]], { config: cfgWith({ 'box.invalidateOnCloseBelowSupport': false }) });
  assert.equal(ofType(r3, 'setup_invalidated').length, 0);
});

test('one decision per box: a rejected breakout consumes the box', () => {
  const r = run([...BOX, [...BREAKOUT.slice(0, 4), 1000], [101.1, 101.6, 101.0, 101.5, 5000], FLAT]);
  const rej = ofType(r, 'signal_rejected');
  assert.equal(rej.length, 1);
  assert.equal(rej[0].details.code, 'volume_below_threshold');
  assert.equal(rej[0].reason, 'breakout volume 1.00× average (needs more than 1.5×)');
  assert.equal(ofType(r, 'signal').length, 0, 'bar 7 closes higher on big volume but the box is gone');
  assert.equal(r.trades.length, 0);
});

test('volume rule: strictly more than the multiple; missing or zero volume skips', () => {
  const eq = run([...BOX, [...BREAKOUT.slice(0, 4), 1500]]);
  assert.equal(ofType(eq, 'signal_rejected')[0].reason, 'breakout volume 1.50× average (needs more than 1.5×)');
  const missing = BOX.map((r, i) => (i === 3 ? [...r.slice(0, 4), null] : r));
  const m = run([...missing, BREAKOUT]);
  const e = ofType(m, 'signal_rejected')[0];
  assert.equal(e.details.code, 'volume_unavailable');
  assert.equal(e.reason, 'volume unavailable');
  assert.equal(e.details.missing, 1);
  assert.match(whyRejectedOrSkipped(e).text, /volume was missing for 1 of the 5 bars/);
  const zero = BOX.map((r, i) => (i === 2 ? [...r.slice(0, 4), 0] : r));
  assert.equal(ofType(run([...zero, BREAKOUT]), 'signal_rejected')[0].details.code, 'volume_unavailable');
  // bar 1's missing volume is outside the 4-bar lookback (bars 2-6): fine
  const old = BOX.map((r, i) => (i === 1 ? [...r.slice(0, 4), null] : r));
  assert.equal(ofType(run([...old, BREAKOUT]), 'signal').length, 1);
});

// ---------- signal, entry ----------

test('signal plan, sizing by risk and entry at the next open with spread and slippage', () => {
  const r = run([...BOX, BREAKOUT, [101.1, 101.3, 100.9, 101.2, 1000], FLAT]);
  const sig = ofType(r, 'signal')[0];
  const p = sig.details.plan;
  near(sig.details.signal.atr, A6, 'ATR at the breakout');
  near(sig.details.signal.volumeRatio, 2);
  near(p.stop, STOP, 'stop');
  near(p.target, 103, 'target');
  near(p.gapLimit, 101.1 + 0.5 * A6, 'gap limit');
  near(p.rrLimit, ((103 + 2 * STOP) / 3) / (1 + K), 'reward/risk limit');
  assert.equal(p.maxEntry, L);
  assert.equal(p.binding, 'reward_risk');
  assert.equal(p.shares, SHARES);
  near(p.plannedRiskWorstCase, SHARES * (L * (1 + K) - STOP * (1 - K)) + 2 * 1.285, 'worst-case risk');
  assert.equal(p.sizing.sizedBy, 'risk');
  const fill = ofType(r, 'entry_filled')[0];
  assert.equal(fill.at, '2024-03-05T16:15:00.000Z');
  assert.equal(fill.details.raw, 101.1);
  near(fill.details.price, E, 'entry price');
  near(fill.details.commission, 1.285);
  near(fill.details.spreadSlippage, SHARES * 101.1 * K);
  near(fill.details.plannedRisk, PLANNED, 'planned risk at the fill');
  near(fill.details.rewardRisk, (103 - E) / (E - STOP));
  const acct = r.account; // end of data closed the position
  assert.equal(acct.positions.length, 0);
  const t = r.trades[0];
  assert.equal(t.id, 'intraday-TEST-2024-03-05T16:00:00.000Z');
  assert.equal(t.exit.reason, 'end_of_data');
  assert.equal(t.exit.raw, 101.2);
  near(t.exit.price, 101.2 * (1 - K));
  assert.deepEqual(t.exit.flags, ['end_of_data']);
  assert.equal(r.summary.endOfData, 1);
  assert.match(whySignal(t).text, /Maximum entry 101\.11: .*the reward\/risk limit binds/);
  assert.match(whySignal(t).text, /Size 257 shares, limited by the per-trade risk budget \(\$250\.00\)/);
  assert.match(whatEnded(t).text, /still open when the data ended/);
});

test('skips: gap limit, reward/risk limit, opened at or below the stop; reject beyond the target', () => {
  const rr = run([...BOX, BREAKOUT, [101.2, 101.3, 101.0, 101.2]]);
  const s1 = ofType(rr, 'entry_skipped')[0];
  assert.equal(s1.details.code, 'above_max_entry');
  assert.match(s1.reason, /^opened at 101\.2, above the maximum entry 101\.11 \(reward\/risk limit 101\.1129 binding\)$/);
  const gapCfg = cfgWith({ 'entry.maxGapAtr': 0 });
  const gp = run([...BOX, BREAKOUT, [101.11, 101.3, 101.0, 101.2]], { config: gapCfg });
  const s2 = ofType(gp, 'entry_skipped')[0];
  assert.equal(ofType(gp, 'signal')[0].details.plan.maxEntry, 101.1);
  assert.equal(s2.details.binding, 'gap');
  assert.match(s2.reason, /gap limit 101\.1000 binding/);
  const below = run([...BOX, BREAKOUT, [100.2, 100.5, 100.0, 100.3]]);
  const s3 = ofType(below, 'entry_skipped')[0];
  assert.equal(s3.details.code, 'at_or_below_stop');
  assert.equal(below.trades.length, 0);
  const beyond = run([...BOX, [100.4, 103.3, 100.35, 103.2, 2000]]);
  const rj = ofType(beyond, 'signal_rejected')[0];
  assert.equal(rj.details.code, 'beyond_target');
  assert.match(rj.reason, /closed at 103\.2, at or beyond the target 103\.00/);
  assert.deepEqual(beyond.summary.rejectedByReason, { beyond_target: 1 });
  // data gap: the symbol has no bar at the next timestamp
  const bars = rowsToBars(EST, [...BOX, BREAKOUT, FLAT, FLAT]);
  const other = rowsToBars(EST, [...BOX, BREAKOUT, FLAT, FLAT]).map((b) => ({ ...b, h: b.h + 50, o: b.o + 50, l: b.l + 50, c: b.c + 50 }));
  bars.splice(7, 1); // TEST has no 11:15 bar
  const gap = runBacktest({ config: CFG, mode: 'intraday', bars: new Map([['TEST', bars], ['ZZZ', other]]), symbols: ['TEST', 'ZZZ'] });
  const s4 = gap.events.find((e) => e.type === 'entry_skipped' && e.symbol === 'TEST');
  assert.equal(s4.details.code, 'no_next_bar');
  assert.equal(s4.at, '2024-03-05T16:15:00.000Z');
});

// ---------- exits ----------

const ENTERED = [...BOX, BREAKOUT, [101.1, 101.3, 100.9, 101.2, 1000]];

test('stop fill; gap through the stop fills at the open (loss beyond 1R)', () => {
  const r = run([...ENTERED, [101.2, 101.3, 100.1, 100.3], FLAT]);
  const t = r.trades[0];
  assert.equal(t.exit.reason, 'stop');
  assert.equal(t.exit.gapThrough, false);
  near(t.exit.raw, STOP);
  near(t.exit.price, STOP * (1 - K));
  near(t.pnl.net, -PLANNED, 'net', 1e-7);
  near(t.pnl.r, -1, 'a normal stop loses exactly the planned risk', 1e-9);
  assert.equal(t.exit.at, '2024-03-05T16:30:00.000Z');
  assert.equal(t.holdBars, 2);
  const g = run([...ENTERED, [99.9, 100.0, 99.5, 99.8], FLAT]);
  const tg = g.trades[0];
  assert.equal(tg.exit.reason, 'stop');
  assert.equal(tg.exit.gapThrough, true);
  assert.equal(tg.exit.raw, 99.9);
  near(tg.exit.price, 99.9 * (1 - K));
  near(tg.pnl.net, SHARES * (99.9 * (1 - K) - E) - 2.57, 'net', 1e-7); // -331.6328
  near(tg.pnl.r, (SHARES * (99.9 * (1 - K) - E) - 2.57) / PLANNED, 'R', 1e-9); // -1.3434
  assert.equal(g.summary.gapThroughStops, 1);
  assert.match(whatEnded(tg).text, /opened at 99\.90, below the stop of 100\.2300: .*The loss of 1\.34R is 0\.34R more than the planned risk/);
});

test('target needs one tick through; gap through the target fills at the open; exits on the entry bar', () => {
  const r = run([...ENTERED, [101.2, 103.0, 101.1, 102.8], [102.8, 103.01, 102.7, 102.9], FLAT]);
  const t = r.trades[0];
  assert.equal(t.exit.reason, 'target');
  assert.equal(t.exit.at, '2024-03-05T16:45:00.000Z', 'the 103.00 high is not enough; 103.01 is');
  assert.equal(t.exit.price, 103);
  assert.equal(t.exit.spreadSlippage, 0);
  near(t.pnl.net, SHARES * (103 - E) - 2.57, 'net', 1e-7); // 475.3369
  near(t.pnl.r, (SHARES * (103 - E) - 2.57) / PLANNED); // 1.9256
  const g = run([...ENTERED, [103.2, 103.5, 103.1, 103.3], FLAT]);
  assert.equal(g.trades[0].exit.gapThrough, true);
  assert.equal(g.trades[0].exit.raw, 103.2);
  assert.equal(g.trades[0].exit.price, 103.2);
  // the stop is checked on the entry bar after the fill
  const same = run([...BOX, BREAKOUT, [101.1, 101.3, 100.2, 100.5], FLAT]);
  assert.equal(same.trades[0].exit.reason, 'stop');
  assert.equal(same.trades[0].exit.at, same.trades[0].entry.at);
  assert.equal(same.trades[0].holdBars, 1);
});

test('bars touching both stop and target: the four resolutions incl. lower-timeframe bars', () => {
  const both = [101.5, 103.05, 100.2, 101.0]; // open nearer the low (1.30 vs 1.55)
  const rows = [...ENTERED, both, FLAT];
  const stopFirst = run(rows).trades[0];
  assert.equal(stopFirst.exit.reason, 'stop');
  assert.equal(stopFirst.exit.ambiguous, true);
  assert.equal(stopFirst.exit.resolvedBy, 'stop_first');
  const targetFirst = run(rows, { overrides: { ambiguity: 'target_first' } }).trades[0];
  assert.equal(targetFirst.exit.reason, 'target');
  assert.equal(targetFirst.exit.resolvedBy, 'target_first');
  const tvLow = run(rows, { overrides: { ambiguity: 'tv_path' } }).trades[0];
  assert.equal(tvLow.exit.reason, 'stop');
  assert.equal(tvLow.exit.resolvedBy, 'tv_path');
  const tvHigh = run([...ENTERED, [102.5, 103.05, 100.2, 101.0], FLAT], { overrides: { ambiguity: 'tv_path' } }).trades[0];
  assert.equal(tvHigh.exit.reason, 'target');
  assert.match(whatEnded(tvHigh).text, /TradingView's assumed path: the open 102\.50 was nearer the high/);
  const barT = '2024-03-05T16:30:00.000Z';
  const minute = (m, o, h, l, c) => ({ t: new Date(Date.parse(barT) + m * 60000).toISOString(), o, h, l, c, v: 100 });
  const subs = [minute(0, 101.5, 101.8, 101.4, 101.7), minute(1, 101.7, 103.05, 101.6, 102.9), minute(2, 102.9, 102.9, 100.2, 100.4)];
  const lt = run(rows, { lowerTf: new Map([['TEST', new Map([[barT, subs]])]]) }).trades[0];
  assert.equal(lt.exit.reason, 'target', 'the 1-minute bars show the target first even with stop_first');
  assert.equal(lt.exit.resolvedBy, 'lower_timeframe');
  assert.equal(lt.exit.ambiguous, true);
  const subsBoth = [minute(0, 101.5, 103.05, 100.2, 101.0), minute(1, 101, 101.2, 100.9, 101)];
  const lb = run(rows, { lowerTf: new Map([['TEST', new Map([[barT, subsBoth]])]]), overrides: { ambiguity: 'target_first' } }).trades[0];
  assert.equal(lb.exit.reason, 'stop');
  assert.equal(lb.exit.resolvedBy, 'lower_timeframe_stop_first');
  assert.equal(run(rows).summary.ambiguousExits, 1);
});

// ---------- time exits ----------

test('intraday: flatten at the 15:45 open, and at 12:45 on an early close (2024-11-29)', () => {
  const r = run(fillUntil(ENTERED, 26));
  const t = r.trades[0];
  assert.equal(t.exit.reason, 'flatten');
  assert.equal(t.exit.at, '2024-03-05T20:45:00.000Z'); // 15:45 ET open
  assert.equal(t.exit.orderPlacedAt, '2024-03-05T20:30:00.000Z');
  near(t.exit.price, 101.2 * (1 - K));
  assert.equal(ofType(r, 'exit_order')[0].at, '2024-03-05T20:30:00.000Z');
  assert.match(whatEnded(t).text, /market order placed at the close of the 2024-03-05 15:30 ET bar filled at the next bar's open of 101\.20/);
  const ec = run(fillUntil(ENTERED, 14), { date: '2024-11-29' });
  assert.equal(ec.trades[0].exit.reason, 'flatten');
  assert.equal(ec.trades[0].exit.at, '2024-11-29T17:45:00.000Z'); // 12:45 ET
  assert.equal(ec.trades[0].holdSessions, 1);
});

test('intraday: no entries from signals in the last 60 minutes; never overnight', () => {
  // breakout candle 15:00-15:15 ET: closes 45 minutes before the close
  const late = run([...BOX, BREAKOUT, FLAT, FLAT, FLAT], { start: 16 });
  const rj = ofType(late, 'signal_rejected')[0];
  assert.equal(rj.at, '2024-03-05T20:00:00.000Z');
  assert.equal(rj.details.code, 'too_close_to_close');
  // breakout candle 14:45-15:00 ET is allowed; the entry is the 15:00 open
  const ok = run([...BOX, BREAKOUT, [101.1, 101.3, 100.9, 101.2], FLAT, FLAT, FLAT], { start: 15 });
  assert.equal(ok.trades.length, 1);
  assert.equal(ok.trades[0].entry.at, '2024-03-05T20:00:00.000Z');
  assert.equal(ok.trades[0].exit.reason, 'flatten');
  // swing mode takes the same late signal
  assert.equal(ofType(run([...BOX, BREAKOUT, FLAT, FLAT, FLAT], { start: 16, mode: 'swing' }), 'order_placed').length, 1);
  // flatten bars missing: closed at the last close before the session ends, flagged
  const bars = rowsToBars(EST, fillUntil(ENTERED, 26)).slice(0, 24); // no 15:30 or 15:45 bar
  const next = rowsToBars('2024-03-06', [FLAT, FLAT]);
  const fb = runBacktest({ config: CFG, mode: 'intraday', bars: new Map([['TEST', [...bars, ...next]]]), symbols: ['TEST'] });
  const t = fb.trades[0];
  assert.equal(t.exit.reason, 'session_end_fallback');
  assert.equal(t.exit.raw, 101.2);
  assert.equal(t.exit.at, '2024-03-05T21:00:00.000Z', 'detected at the next session start, dated at the session close');
  assert.equal(fb.events.find((e) => e.type === 'exit_filled').at, '2024-03-05T21:00:00.000Z');
  assert.equal(t.exit.flags[0], 'session_end_fallback');
});

test('swing: overnight gap through the stop and the maximum holding period across a holiday', () => {
  const swingCfg = cfgWith({ 'modes.swing.maxHoldSessions': 2 });
  // entry Thursday 2024-03-28; Good Friday is closed; session 2 is Monday 2024-04-01
  const day1 = fillUntil(ENTERED, 26);
  const held = run(fillUntil(day1, 52), { mode: 'swing', config: swingCfg, date: '2024-03-28' });
  const t = held.trades[0];
  assert.equal(t.exit.reason, 'max_hold');
  assert.equal(t.exit.at, '2024-04-01T19:45:00.000Z'); // 15:45 EDT on session 2
  assert.equal(t.holdSessions, 2);
  near(t.exit.price, 101.2 * (1 - K));
  const intraday = run(fillUntil(day1, 52), { mode: 'intraday', config: swingCfg, date: '2024-03-28' });
  assert.equal(intraday.trades[0].exit.at, '2024-03-28T19:45:00.000Z', 'the intraday version flattens the same day');
  const gap = run([...day1, [99.9, 100.0, 99.5, 99.8], FLAT], { mode: 'swing', config: swingCfg, date: '2024-03-28' });
  const g = gap.trades[0];
  assert.equal(g.exit.reason, 'stop');
  assert.equal(g.exit.gapThrough, true);
  assert.equal(g.exit.at, '2024-04-01T13:30:00.000Z');
  assert.ok(g.pnl.r < -1);
  assert.equal(g.holdSessions, 2);
});

// ---------- sizing and portfolio limits ----------

test('sizing by cash and by the minimum commission', () => {
  const cash = run([...ENTERED, FLAT], { config: cfgWith({ 'risk.riskPerTradePct': 100, 'risk.maxOpenRiskPct': 100 }) });
  const pc = ofType(cash, 'signal')[0].details.plan;
  assert.equal(pc.shares, 988);
  assert.equal(pc.sizing.sizedBy, 'cash');
  const small = run([...ENTERED, FLAT], { config: cfgWith({ 'risk.hypotheticalStartingEquity': 4000 }) });
  const ps = ofType(small, 'signal')[0].details.plan;
  assert.equal(ps.shares, 8, 'budget $10: 10 shares by risk alone, 8 after two $1 minimum commissions');
  assert.equal(ps.sizing.commissionLimited, true);
  const tiny = run([...ENTERED, FLAT], { config: cfgWith({ 'risk.hypotheticalStartingEquity': 500 }) });
  const rj = ofType(tiny, 'signal_rejected')[0];
  assert.equal(rj.details.code, 'size_below_one_share');
});

function multi(symbolsRows, config, mode = 'intraday') {
  const bars = new Map(symbolsRows.map(([s, rows, start = 0]) => [s, rowsToBars(EST, rows, start)]));
  return runBacktest({ config, mode, bars, symbols: [...bars.keys()].map((symbol) => ({ symbol, exchange: 'NYSE' })) });
}

test('max positions across symbols with alphabetical tie-breaking', () => {
  const rows = [...ENTERED, FLAT];
  const r = multi([['DDD', rows], ['BBB', rows], ['CCC', rows], ['AAA', rows]], CFG);
  const placed = ofType(r, 'order_placed').map((e) => e.symbol);
  assert.deepEqual(placed, ['AAA', 'BBB', 'CCC']);
  const rj = ofType(r, 'signal_rejected');
  assert.deepEqual(rj.map((e) => [e.symbol, e.details.code]), [['DDD', 'max_positions']]);
  assert.match(whyRejectedOrSkipped(rj[0]).text, /3 simulated positions and pending orders were already open \(maximum 3\)/);
  assert.equal(r.trades.length, 3);
  assert.ok(r.trades.every((t) => t.entry.shares === SHARES));
});

test('open-risk limit across symbols: the room left sizes the next signal; none left rejects', () => {
  const rows = [...ENTERED, FLAT];
  const r = multi([['BBB', rows], ['AAA', rows]], cfgWith({ 'risk.riskPerTradePct': 0.5, 'risk.maxOpenRiskPct': 0.75 }));
  const plans = Object.fromEntries(ofType(r, 'signal').map((e) => [e.symbol, e.details.plan]));
  assert.equal(plans.AAA.shares, 515);
  const AAA_WORST = 515 * (L * (1 + K) - STOP * (1 - K)) + 2 * 2.575; // 499.8260
  near(plans.AAA.plannedRiskWorstCase, AAA_WORST, 'AAA worst case', 1e-7);
  assert.equal(plans.BBB.sizing.sizedBy, 'open_risk');
  near(plans.BBB.sizing.budget, 750 - AAA_WORST, 'BBB budget', 1e-7);
  assert.equal(plans.BBB.shares, 257, '258 shares would need 250.40 of a 250.17 budget');
  // BBB and CCC fill at their limit (101.11) and drift lower; DDD's later signal finds no room left
  const filledAtLimit = [...BOX, BREAKOUT, [101.11, 101.2, 100.4, 100.4], [100.4, 100.5, 100.35, 100.4], [100.4, 100.5, 100.35, 100.4], FLAT];
  const r2 = multi([['BBB', filledAtLimit], ['CCC', filledAtLimit], ['DDD', [...BOX, BREAKOUT, FLAT], 3]], cfgWith({ 'risk.maxOpenRiskPct': 0.5 }));
  const d = r2.events.find((e) => e.symbol === 'DDD' && e.type === 'signal_rejected');
  assert.equal(d.details.code, 'open_risk_limit');
  assert.equal(d.at, '2024-03-05T16:45:00.000Z');
  assert.ok(d.details.plan.sizing.openRoom < 0);
});

test('cash reconciles: final cash = start + sum of net P/L once flat', () => {
  for (const r of [run([...ENTERED, [101.2, 101.3, 100.1, 100.3], FLAT]), multi([['AAA', [...ENTERED, [102.5, 103.05, 100.2, 101]]], ['BBB', [...ENTERED, [99.9, 100, 99.5, 99.8]]], ['CCC', fillUntil(ENTERED, 26)]], CFG)]) {
    assert.equal(r.account.positions.length, 0);
    const sum = r.trades.reduce((a, t) => a + t.pnl.net, 0);
    near(r.account.cash, 100000 + sum, 'cash', 1e-6);
    near(r.equityCurve[r.equityCurve.length - 1].equity, r.account.cash, 'last equity point', 1e-6);
    for (const t of r.trades) near(t.pnl.net, t.pnl.gross - t.pnl.costs, 'net = gross - costs', 1e-9);
  }
});

test('limit_intrabar entry (TradingView parity) and the stress entry', () => {
  const rows = [...BOX, BREAKOUT, [101.2, 101.3, 101.05, 101.2], FLAT];
  assert.equal(run(rows).trades.length, 0, 'open_only skips an open above the limit');
  const r = run(rows, { overrides: { entryFill: 'limit_intrabar' } });
  const t = r.trades[0];
  assert.equal(t.entry.raw, L);
  assert.equal(t.entry.price, L, 'a limit fill pays no spread or slippage');
  assert.deepEqual(t.entry.flags, ['intrabar_limit_entry']);
  near(t.entry.plannedRisk, SHARES * (L - STOP * (1 - K)) + 2.57, 'planned risk', 1e-7); // 239.0336
  // As TradingView's limit verification: a low exactly at the limit is not a fill; one tick through is.
  assert.equal(run([...BOX, BREAKOUT, [101.2, 101.3, 101.11, 101.2], FLAT], { overrides: { entryFill: 'limit_intrabar' } }).trades.length, 0);
  assert.equal(run([...BOX, BREAKOUT, [101.2, 101.3, 101.10, 101.2], FLAT], { overrides: { entryFill: 'limit_intrabar' } }).trades.length, 1);
  const s = run([...ENTERED, FLAT], { overrides: { entryWorseAtr: 0.1 } }).trades[0];
  near(s.entry.price, E + 0.1 * A6, 'entry 0.1 ATR worse');
  assert.ok(s.entry.flags.includes('stress_entry_worse'));
  const viaConfig = run([...ENTERED, FLAT], { config: applyOverrides(CFG, { add: { 'stress.entryWorseAtr': 0.1 } }) }).trades[0];
  near(viaConfig.entry.price, s.entry.price);
});

test('intrabar limit entry bar: the target counts only when the high follows the fill', () => {
  const ov = { overrides: { entryFill: 'limit_intrabar' } };
  // open 102.90 is nearer the high: the high came before the dip that filled the order at 101.11
  const highFirst = run([...BOX, BREAKOUT, [102.9, 103.05, 101.05, 101.5], FLAT], ov);
  assert.equal(highFirst.trades[0].exit.reason, 'end_of_data');
  // open 101.20 is nearer the low: filled on the way down, then the high reached the target
  const lowFirst = run([...BOX, BREAKOUT, [101.2, 103.05, 101.05, 102.0], FLAT], ov);
  assert.equal(lowFirst.trades[0].exit.reason, 'target');
  assert.equal(lowFirst.trades[0].exit.ambiguous, false);
});

test('equity at a signal uses every close at that bar; account and active setups', () => {
  const zzz = [...ENTERED, [101.2, 101.3, 101.0, 101.25], [101.25, 101.6, 101.2, 101.5], FLAT];
  const r = multi([['ZZZ', zzz], ['AAA', [...BOX, BREAKOUT, FLAT], 3]], CFG);
  const sig = r.events.find((e) => e.symbol === 'AAA' && e.type === 'signal');
  assert.equal(sig.at, '2024-03-05T16:45:00.000Z');
  const point = r.equityCurve.find((p) => p.t === sig.at);
  const zzzEntry = r.trades.find((t) => t.symbol === 'ZZZ').entry;
  near(point.equity, 100000 - SHARES * zzzEntry.price - zzzEntry.commission + SHARES * 101.5, 'equity point at the signal bar', 1e-6);
  near(sig.details.plan.sizing.equity, point.equity, 'sizing equity uses ZZZ\'s close at the same bar', 1e-9);

  const eng = createEngine({ config: CFG, mode: 'intraday', symbols: [{ symbol: 'TEST', exchange: 'NYSE' }] });
  const bars = rowsToBars(EST, [...BOX, BREAKOUT, [101.1, 101.3, 100.9, 101.2]]);
  for (const b of bars.slice(0, 6)) eng.processTimestamp(b.t, new Map([['TEST', b]]));
  const act = eng.activeSetups();
  assert.equal(act.length, 1);
  assert.equal(act[0].barsLeft, 3);
  assert.equal(act[0].box.resistance, 101);
  eng.processTimestamp(bars[6].t, { TEST: bars[6] });
  const pend = eng.account();
  assert.equal(pend.pendingOrders.length, 1);
  assert.equal(pend.pendingOrders[0].maxEntry, L);
  assert.equal(pend.pendingOrders[0].validFor, '2024-03-05T16:15:00.000Z');
  assert.equal(pend.simulated, true);
  eng.processTimestamp(bars[7].t, { TEST: bars[7] });
  const acct = eng.account();
  assert.equal(acct.positions.length, 1);
  assert.equal(acct.positions[0].shares, SHARES);
  near(acct.openRisk, PLANNED);
  near(acct.equity, 100000 - SHARES * E - 1.285 + SHARES * 101.2, 'equity', 1e-6);
  assert.equal(acct.positions[0].exitBy, EST);
  // the forward test can cancel a stale pending order and journal operational problems
  const eng2 = createEngine({ config: CFG, mode: 'intraday', symbols: ['TEST'] });
  for (const b of bars.slice(0, 7)) eng2.processTimestamp(b.t, { TEST: b });
  const c = eng2.cancelOrder('TEST', { reason: 'bar processed 9 minutes after its close' });
  assert.deepEqual(c.events.map((e) => [e.type, e.details.code, e.at]), [['entry_skipped', 'stale_signal', '2024-03-05T16:00:00.000Z']]);
  assert.equal(eng2.account().pendingOrders.length, 0);
  assert.equal(eng2.processTimestamp(bars[7].t, { TEST: bars[7] }).events.filter((e) => e.type === 'entry_filled').length, 0);
  assert.equal(eng2.journal({ type: 'operational_error', reason: 'provider timeout' }).events[0].type, 'operational_error');
  assert.throws(() => eng2.journal({ type: 'entry_filled', reason: 'x' }), /data_warning or operational_error/);
  // a pre-market bar is ignored with a data warning, never traded on
  const w = eng.processTimestamp('2024-03-06T14:00:00.000Z', { TEST: { t: '2024-03-06T14:00:00.000Z', o: 1, h: 1, l: 1, c: 1, v: 1 } });
  assert.equal(w.events[0].type, 'data_warning');
  assert.match(w.events[0].reason, /outside the regular session/);
  assert.throws(() => eng.processTimestamp('2024-03-06T13:00:00.000Z', {}), /not after the last processed bar/);
});

test('explanations carry the numbers', () => {
  const r = run([...ENTERED, [101.2, 101.3, 100.1, 100.3]]);
  const t = r.trades[0];
  const q = whySetupQualifies(t.box);
  assert.match(q.text, /box 2\.00 high, 1\.47× the ATR\(3\) of 1\.3580, within the 3 × ATR maximum of 4\.07/);
  assert.match(q.text, /ceiling was touched 2 times \(03-05 09:30 ET, 03-05 10:00 ET\) and the floor 2 times \(03-05 09:45 ET, 03-05 10:15 ET\)/);
  assert.match(whySignal(t).text, /closed at 101\.10, 0\.10 above the frozen ceiling of 101\.00/);
  assert.match(whySignal(t).text, /volume of 2,000 shares was 2\.00× the average of the previous 4 bars \(1,000\)/);
  assert.match(whatEnded(t).text, /The stop at 100\.2300 was hit \(the bar's low was 100\.10\); it filled at 100\.1899/);
  assert.match(whatEnded(t).text, /-1\.00R on a planned risk of \$246\.86/);
  const amb = run([...ENTERED, [101.5, 103.05, 100.2, 101.0]]).trades[0];
  assert.match(whatEnded(amb).text, /reached both the stop \(low 100\.20 at or below 100\.2300\) and the target \(high 103\.05 at or above 103\.01\).*conservative stop-first assumption/);
});

// ---------- whole-engine properties (synthetic data: code checks only) ----------

const UNIVERSE = loadUniverse();
// Looser settings and two position slots so the synthetic data exercises more paths, portfolio limits included.
const LOOSE = applyOverrides(BASE, { set: { 'entry.minRewardRisk': 1.2, 'stop.maxCostToRiskPct': 60, 'entry.volumeMultiple': 1.3, 'risk.maxPositions': 2 } });
const PROP_SYMBOLS = UNIVERSE.symbols.slice(0, 10);
const SYN = generateSyntheticBars({ symbols: PROP_SYMBOLS, from: '2024-01-01', to: '2024-05-31', seed: 11 });

function timeline(barsMap) {
  const byT = new Map();
  for (const [sym, list] of barsMap) for (const b of list) {
    if (!byT.has(b.t)) byT.set(b.t, new Map());
    byT.get(b.t).set(sym, b);
  }
  return [...byT.keys()].sort().map((t) => [t, byT.get(t)]);
}

test('look-ahead / repaint: decisions up to T are identical with data only up to T', () => {
  for (const mode of ['intraday', 'swing']) {
    const tl = timeline(SYN.bars);
    const full = createEngine({ config: LOOSE, mode, symbols: PROP_SYMBOLS });
    for (const [t, m] of tl) full.processTimestamp(t, m);
    assert.ok(full.trades.length >= 15, `enough synthetic trades to compare (${full.trades.length})`);
    assert.ok(full.events.some((e) => e.details?.code === 'max_positions'), 'portfolio limits are exercised');
    for (const frac of [0.2, 0.45, 0.7, 0.93]) {
      const cut = tl[Math.floor(tl.length * frac)][0];
      const part = createEngine({ config: LOOSE, mode, symbols: PROP_SYMBOLS });
      for (const [t, m] of tl) { if (t > cut) break; part.processTimestamp(t, m); }
      assert.deepEqual(part.events, full.events.filter((e) => e.at <= cut), `${mode} events up to ${cut}`);
      assert.deepEqual(part.trades, full.trades.filter((x) => x.exit.at <= cut), `${mode} trades up to ${cut}`);
      assert.deepEqual(part.equityCurve, full.equityCurve.filter((p) => p.t <= cut));
      // the same through runBacktest with `to`, leaving out what end of data forces
      const rb = runBacktest({ config: LOOSE, mode, bars: SYN.bars, symbols: PROP_SYMBOLS, to: cut });
      const notEod = (e) => !(e.details?.code === 'end_of_data' || e.details?.reason === 'end_of_data');
      assert.deepEqual(rb.events.filter(notEod), full.events.filter((e) => e.at <= cut));
    }
  }
});

test('snapshot: run to T, JSON round-trip, restore, continue = uninterrupted run', () => {
  const tl = timeline(SYN.bars);
  const syms = PROP_SYMBOLS;
  for (const mode of ['intraday', 'swing']) {
    const one = createEngine({ config: LOOSE, mode, symbols: syms, tradeFrom: '2024-01-10' });
    for (const [t, m] of tl) one.processTimestamp(t, m);
    one.finish();
    for (const frac of [0.33, 0.61]) {
      const cut = Math.floor(tl.length * frac);
      const a = createEngine({ config: LOOSE, mode, symbols: syms, tradeFrom: '2024-01-10' });
      const events = [], trades = [];
      for (const [t, m] of tl.slice(0, cut)) { const o = a.processTimestamp(t, m); events.push(...o.events); trades.push(...o.closedTrades); }
      const saved = JSON.parse(JSON.stringify(a.snapshot()));
      const b = createEngine({ config: LOOSE, mode, symbols: syms, state: saved });
      for (const [t, m] of tl.slice(cut)) { const o = b.processTimestamp(t, m); events.push(...o.events); trades.push(...o.closedTrades); }
      const f = b.finish();
      events.push(...f.events); trades.push(...f.closedTrades);
      assert.deepEqual(events, one.events, `${mode} events`);
      assert.deepEqual(trades, one.trades, `${mode} trades`);
      assert.deepEqual(b.account(), one.account(), `${mode} account`);
      assert.deepEqual(b.summary(), one.summary(), `${mode} summary`);
      assert.deepEqual(b.activeSetups(), one.activeSetups(), `${mode} active setups`);
      assert.deepEqual([...a.equityCurve, ...b.equityCurve], one.equityCurve, `${mode} equity curve`);
      // with history the restored engine carries the whole journal
      const c = createEngine({ config: LOOSE, mode, symbols: syms, state: JSON.parse(JSON.stringify(a.snapshot({ history: true }))) });
      for (const [t, m] of tl.slice(cut)) c.processTimestamp(t, m);
      c.finish();
      assert.deepEqual(c.trades, one.trades);
    }
  }
  const e = createEngine({ config: LOOSE, mode: 'swing', symbols: syms });
  assert.throws(() => createEngine({ config: BASE, mode: 'swing', symbols: syms, state: e.snapshot() }), /config hash differs/);
  assert.throws(() => createEngine({ config: LOOSE, mode: 'intraday', symbols: syms, state: e.snapshot() }), /swing mode/);
  e.processTimestamp(tl[5][0], tl[5][1]);
  assert.throws(() => e.processTimestamp(tl[5][0], tl[5][1]), /not after the last processed bar/);
});

test('determinism, unique trade ids, no overlapping boxes, intraday never overnight', () => {
  const opts = { config: LOOSE, bars: SYN.bars, symbols: PROP_SYMBOLS, from: '2024-01-01', to: '2024-05-31', tradeFrom: '2024-01-15' };
  for (const mode of ['intraday', 'swing']) {
    const a = runBacktest({ ...opts, mode }), b = runBacktest({ ...opts, mode });
    assert.deepEqual(a, b);
    assert.equal(a.meta.synthetic, true);
    assert.equal(a.meta.configHash, configHash(LOOSE));
    assert.equal(a.meta.engineVersion, ENGINE_VERSION);
    assert.match(a.meta.dataHash, /^[0-9a-f]{64}$/);
    assert.equal(new Set(a.trades.map((t) => t.id)).size, a.trades.length);
    assert.ok(a.events.every((e) => e.at >= '2024-01-15'), 'nothing journalled before tradeFrom');
    const sigs = a.events.filter((e) => e.type === 'signal' || e.type === 'signal_rejected');
    const bySym = new Map();
    for (const e of sigs) {
      const box = e.details.box;
      if (!box) continue;
      const prev = bySym.get(e.symbol);
      if (prev?.signalAt === e.at) continue; // the same breakout: a signal and its rejection
      if (prev) assert.ok(box.windowStart > prev.signalAt, `${e.symbol}: a box never reuses the previous breakout candle or window`);
      bySym.set(e.symbol, { signalAt: e.at });
    }
    if (mode === 'intraday') {
      for (const t of a.trades) assert.equal(t.exit.at.slice(0, 10), t.entry.at.slice(0, 10), 'intraday trades close the same session');
    }
    near(a.account.cash, 100000 + a.trades.reduce((x, t) => x + t.pnl.net, 0), 'cash', 1e-6);
  }
});

test('performance: 17 synthetic symbols x 1 year well under 5 seconds', () => {
  const syn = generateSyntheticBars({ symbols: UNIVERSE.symbols, from: '2024-01-01', to: '2024-12-31', seed: 5 });
  const t0 = performance.now();
  const r = runBacktest({ config: BASE, mode: 'swing', bars: syn.bars, symbols: UNIVERSE.symbols });
  const ms = performance.now() - t0;
  console.log(`# engine: ${r.meta.bars} bars, 17 symbols, 1 year (synthetic) in ${ms.toFixed(0)} ms`);
  assert.equal(r.meta.bars, 17 * 6516);
  assert.ok(ms < 5000, `took ${ms} ms`);
});
