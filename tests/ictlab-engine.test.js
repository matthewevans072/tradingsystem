// ICT Lab engine: whole sessions with hand-checked numbers (tests/ictlab-fixtures.js), the boundary cases, the
// decision order, the re-arm, one filled trade per session, the 11:00 cutoff, the time stop on full and early-close
// sessions, the sizing, the dollar account, no look-ahead, prefix invariance, determinism and the snapshot
// round-trip. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSpec, createEngine, countsOf, STAGES, setupKindOf } from '../server/ictlab/engine.js';
import { tradingDays } from '../server/strategy/sessions.js';
import { buildMarket, inputsOf } from './ictlab-fake-alpaca.js';
import { scenario, session, bar, flat, shifted, OB_DAY, FVG_DAY, IFVG_DAY, BREAKER_DAY, OB_SPEC, FVG_SPEC, IFVG_SPEC, BREAKER_SPEC, SPECS } from './ictlab-fixtures.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const run = (sc, spec, extra = {}) => runSpec({ spec, daily: sc.daily, sessions: sc.sessions, window: { start: sc.testDate, end: sc.testDate }, ...extra });
const one = (day, spec, opts = {}, extra = {}) => run(scenario({ overrides: day, ...opts }), spec, extra);

test('the four specs map to their confirmation kinds', () => {
  assert.equal(setupKindOf(FVG_SPEC), 'bos');
  assert.equal(setupKindOf(OB_SPEC), 'bos');
  assert.equal(setupKindOf(IFVG_SPEC), 'inversion');
  assert.equal(setupKindOf(BREAKER_SPEC), 'breaker');
  assert.throws(() => setupKindOf({ setup: { requires: ['x'] } }), /unknown setup.requires/);
});

test('OB_DAY, spec 2: every number by hand (sweep, BOS, zone, midpoint entry, stop, target, sizing, fill, target exit, R, 2x R, P/L)', () => {
  const r = one(OB_DAY, OB_SPEC);
  assert.equal(r.sessionsInWindow, 1);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.pdl, 100);
  assert.equal(t.sweepIdx, 0);
  assert.equal(t.sweepExtreme, 99.5);
  assert.equal(t.legExtremeIdx, 0);
  assert.equal(t.confirmKind, 'bos');
  assert.equal(t.confirmIdx, 6);
  assert.equal(t.bosIdx, 6);
  assert.equal(t.swingIdx, 2);
  assert.equal(t.swingLevel, 103);
  assert.deepEqual(t.zone, { type: 'order_block', index: 0, lo: 99.5, hi: 101.5, height: 2 });
  assert.equal(t.entry, 100.5);
  assert.equal(t.anchor, 99.5);
  assert.equal(t.stop, 99.49);
  close(t.stopDistance, 1.01);
  assert.equal(t.target, 102.52);
  assert.deepEqual([t.shares, t.sharesRisk, t.sharesCash, t.cashCapped], [49, 49, 49, false]);
  assert.equal(t.plannedRiskMax, 50);
  close(t.plannedRiskActual, 49.49);
  assert.equal(t.cashBefore, 5000);
  assert.equal(t.fillIdx, 7);
  assert.equal(t.exitIdx, 8);
  assert.equal(t.exitPrice, 102.52);
  assert.equal(t.exitKind, 'target');
  assert.equal(t.sameBar, false);
  close(t.R, 1.98 / 1.01);
  close(t.R2x, 1.94 / 1.01);
  close(t.pnl, 97.02);
  close(t.cashAfter, 5097.02);
  assert.equal(t.lossExceededRisk, false);
  assert.equal(t.holdingMinutes, 10);
  assert.equal(t.barsHeld, 2);
  assert.deepEqual(t.hoursHeld, { 10: 2 });
  assert.equal(t.refusalsBefore, 0);
  close(r.account.endingCash, 5097.02);
  assert.equal(r.account.maxDrawdown, 0);
  assert.deepEqual(r.exitCounts, { stop: 0, stop_same_bar: 0, target: 1, time: 0 });
  assert.deepEqual(r.funnel, { sessions: 1, tradeable: 1, sweeps: 1, confirmed: 1, usableZone: 1, orders: 1, fills: 1 });
  assert.deepEqual(countsOf(r), { sessions: 1, tradeable: 1, sweeps: 1, confirmations: 1, zones: 1, orders: 1, fills: 1 });
  assert.equal(r.sessions[0].stage, 'filled');
  assert.equal(r.sessions[0].confirmations, 1);
  // Spec 1 on the same day: no gap in the leg.
  const f = one(OB_DAY, FVG_SPEC);
  assert.equal(f.sessions[0].stage, 'no_zone');
  assert.equal(f.sessions[0].confirmations, 1);
  assert.deepEqual(f.funnel, { sessions: 1, tradeable: 1, sweeps: 1, confirmed: 1, usableZone: 0, orders: 0, fills: 0 });
  // Specs 3 and 4 on the same day: no inversion, no breaker.
  assert.equal(one(OB_DAY, IFVG_SPEC).sessions[0].stage, 'no_confirmation');
  assert.equal(one(OB_DAY, BREAKER_SPEC).sessions[0].stage, 'no_confirmation');
});

test('FVG_DAY, spec 1: the latest gap in the leg, the midpoint, the 2R target', () => {
  const t = one(FVG_DAY, FVG_SPEC).trades[0];
  assert.deepEqual(t.zone, { type: 'fair_value_gap', index: 4, lo: 102.4, hi: 102.6, height: 0.2 });
  assert.equal(t.entry, 102.5);
  assert.equal(t.stop, 99.49);
  close(t.stopDistance, 3.01);
  assert.equal(t.target, 108.52);
  assert.deepEqual([t.shares, t.sharesRisk, t.sharesCash], [16, 16, 48]);
  assert.equal(t.fillIdx, 7);
  assert.equal(t.exitIdx, 9);
  assert.equal(t.exitKind, 'target');
  close(t.R, 5.98 / 3.01);
  close(t.pnl, 16 * 5.98);
  // Spec 2 on the same day still enters at bar 0's midpoint.
  assert.equal(one(FVG_DAY, OB_SPEC).trades[0].entry, 100.5);
});

test('IFVG_DAY, spec 3: the bearish gap, the inversion close, the lower-bound stop, the time stop at the last open', () => {
  const r = one(IFVG_DAY, IFVG_SPEC);
  const t = r.trades[0];
  assert.equal(t.sweepIdx, 3);
  assert.equal(t.sweepExtreme, 99.6);
  assert.equal(t.confirmKind, 'inversion');
  assert.equal(t.inversionIdx, 6);
  assert.deepEqual(t.zone, { type: 'inversion_fvg', index: 0, lo: 102.4, hi: 103, height: 0.6 });
  assert.equal(t.entry, 102.7);
  assert.equal(t.anchor, 99.6);
  assert.deepEqual(t.anchorNames, ['inverted_gap_lower_bound', 'sweep_extreme']);
  assert.equal(t.stop, 99.59);
  close(t.stopDistance, 3.11);
  assert.equal(t.target, 108.92);
  assert.equal(t.fillIdx, 7);
  assert.equal(t.exitIdx, 77);
  assert.equal(t.exitPrice, 104);
  assert.equal(t.exitKind, 'time');
  close(t.R, 1.26 / 3.11);
  assert.equal(t.shares, 16);
  close(t.pnl, 20.16);
  assert.equal(t.holdingMinutes, 71 * 5);
  assert.equal(t.hoursHeld[15], 12, 'bars 66..77 start in the 15:00 hour');
  // The inverted gap's lower bound as the farther anchor: a sweep extreme above it.
  const higherSweep = { ...IFVG_DAY, 3: bar(100.8, 101.9, 99.95, 100.4) };
  const t2 = one(higherSweep, IFVG_SPEC, { priorDaily: { h: 110, l: 100 } }).trades[0];
  assert.equal(t2.sweepExtreme, 99.95);
  assert.equal(t2.anchor, 99.95, 'still the sweep extreme: it is below the gap');
  // A close through the gap before the sweep does not count: bar 3 closes at 103.5 (through the gap), the sweep
  // comes at bar 4, and no bar after it closes above 103 (flat bars at 102).
  const before = { 0: bar(104, 104.5, 103, 103.2), 1: bar(103.2, 103.3, 101.8, 102), 2: bar(102, 102.4, 100.5, 100.8), 3: bar(100.8, 103.6, 100.7, 103.5), 4: bar(103.5, 103.6, 99.6, 100.4), 5: bar(100.4, 101.5, 100.2, 101.2) };
  const b = one(before, IFVG_SPEC, { base: 102 });
  assert.equal(b.sessions[0].sweepIdx, 4);
  assert.equal(b.sessions[0].stage, 'no_confirmation', 'no close through the gap after the sweep');
});

test('BREAKER_DAY, spec 4: the downward break, the bearish block, the failure with the upward break, the stop beyond the sweep extreme, a loss beyond the planned risk', () => {
  const r = one(BREAKER_DAY, BREAKER_SPEC);
  const t = r.trades[0];
  assert.equal(t.sweepIdx, 6);
  assert.equal(t.sweepExtreme, 99.7);
  assert.equal(t.confirmKind, 'breaker');
  assert.equal(t.confirmIdx, 9);
  assert.equal(t.failIdx, 9);
  assert.equal(t.bosIdx, 9);
  assert.deepEqual(t.zone, { type: 'breaker', index: 3, lo: 103.2, hi: 104.2, height: 1 });
  assert.equal(t.entry, 103.7);
  assert.equal(t.anchor, 99.7);
  assert.equal(t.stop, 99.69);
  close(t.stopDistance, 4.01);
  assert.equal(t.target, 111.72);
  assert.deepEqual([t.shares, t.sharesRisk, t.sharesCash], [12, 12, 48]);
  assert.equal(t.fillIdx, 10);
  assert.equal(t.exitIdx, 11);
  assert.equal(t.exitPrice, 99.69);
  assert.equal(t.exitKind, 'stop');
  close(t.R, -4.05 / 4.01);
  close(t.pnl, -48.6);
  close(t.plannedRiskActual, 48.12);
  assert.equal(t.lossExceededRisk, true, 'costs took the loss beyond the planned risk');
  assert.equal(r.counts.lossExceededRisk, 1);
  close(r.account.endingCash, 4951.4);
  close(r.account.maxDrawdown, 48.6);
  close(r.account.lowestCash, 4951.4);
  // The break at the sweep bar itself (k_bos = s) is refused: bar 9 becomes the sweep bar (it also closes above
  // the swing high and the block); bar 10 closes above the block (the failure, one bar later), but the only
  // break is the sweep bar's own, so nothing is confirmed.
  const atSweep = { ...BREAKER_DAY, 6: bar(101.5, 101.7, 100.5, 100.6), 9: bar(102.8, 104.5, 99.5, 104.4), 10: bar(104.4, 104.6, 103.5, 104.3) };
  const s = one(atSweep, BREAKER_SPEC);
  assert.equal(s.sessions[0].sweepIdx, 9);
  assert.equal(s.sessions[0].stage, 'no_confirmation');
  // The failure and the break 7 bars apart: not coupled. Bar 3 is made bearish (high 104.2 stays the swing high
  // and the leg origin), so the block is bar 2 (zone [102.2, 103.8]); bar 9 closes at 104.0: above the block
  // (the failure, f = 9, recorded once) but under the swing high; bars 10 to 15 stay at 104; bar 16 closes at
  // 104.9, the first close above the swing high at 9 (104.1, confirmed at 12): a break at 16, 7 bars after.
  const apart = { ...BREAKER_DAY, 3: bar(103.6, 104.2, 103.2, 103.5), 9: bar(102.8, 104.1, 102.6, 104.0), 10: bar(104.0, 104.05, 103.9, 104.0), 11: bar(104.0, 104.05, 103.9, 104.0), 16: bar(103.0, 105, 102.9, 104.9) };
  const a = one(apart, BREAKER_SPEC);
  assert.equal(a.sessions[0].stage, 'no_confirmation');
  assert.equal(a.sessions[0].sweepIdx, 6);
  // Six bars apart couples: the same day with the break at 15.
  const six = { ...apart, 15: bar(104.0, 105, 103.9, 104.9), 16: bar(104.9, 105, 104.8, 104.9) };
  const s6 = one(six, BREAKER_SPEC);
  assert.equal(s6.sessions[0].confirmations, 1);
  assert.equal(s6.sessions[0].confirmIdx ?? s6.sessions[0].refusals[0]?.k, 15);
});

test('the boundary cases: a close at PDL is no sweep; a gap of 0.04 is refused and 0.05 accepted with the half cent rounded down; a stop distance of 0.39 is refused; an entry equal to the close is refused', () => {
  assert.equal(one({ ...OB_DAY, 0: bar(101, 101.5, 99.5, 100) }, OB_SPEC).sessions[0].stage, 'no_sweep');
  assert.equal(one({ ...OB_DAY, 0: bar(101, 101.5, 99.5, 99.8) }, OB_SPEC).sessions[0].stage, 'no_sweep', 'wick only');
  const small = one({ ...FVG_DAY, 6: bar(102.44, 103.5, 102.44, 103.2) }, FVG_SPEC);
  assert.equal(small.sessions[0].stage, 'zone_too_small');
  close(small.sessions[0].refusals[0].height, 0.04);
  const exact = one({ ...FVG_DAY, 6: bar(102.45, 103.5, 102.45, 103.2) }, FVG_SPEC);
  assert.equal(exact.sessions[0].stage, 'filled');
  assert.equal(exact.trades[0].entry, 102.42, '102.425 rounded down');
  const tight = one({ ...OB_DAY, 0: bar(100.66, 100.66, 99.9, 100.05) }, OB_SPEC);
  assert.equal(tight.sessions[0].stage, 'stop_too_close');
  close(tight.sessions[0].refusals[0].stopDistance, 0.39);
  const okDist = one({ ...OB_DAY, 0: bar(100.68, 100.68, 99.9, 100.05) }, OB_SPEC);
  assert.notEqual(okDist.sessions[0].stage, 'stop_too_close');
  assert.equal(okDist.sessions[0].entry, 100.29);
  close(okDist.sessions[0].stopDistance, 0.40);
  const equalClose = one({ ...OB_DAY, 0: bar(103.4, 106.9, 99.5, 100.5) }, OB_SPEC);
  assert.equal(equalClose.sessions[0].stage, 'entry_not_below_close');
  assert.equal(equalClose.sessions[0].refusals[0].entry, 103.2);
  const belowClose = one({ ...OB_DAY, 0: bar(103.4, 106.88, 99.5, 100.5) }, OB_SPEC);
  assert.notEqual(belowClose.sessions[0].stage, 'entry_not_below_close');
  assert.equal(belowClose.sessions[0].entry, 103.19);
  // A break on the sweep bar itself is no confirmation (H6: k > s): bars 1..5 build the swing high at 2, bar 6
  // sweeps PDL and closes above it; from bar 7 on the swing is already closed above, so nothing confirms.
  const breakOnSweep = { 1: OB_DAY[1], 2: OB_DAY[2], 3: OB_DAY[3], 4: OB_DAY[4], 5: OB_DAY[5], 6: bar(101.9, 103.6, 99.5, 103.4), 7: OB_DAY[7], 8: OB_DAY[8] };
  const bs = one(breakOnSweep, OB_SPEC);
  assert.equal(bs.sessions[0].sweepIdx, 6);
  assert.equal(bs.sessions[0].stage, 'no_confirmation');
  // The same for the inversion (H10: v > s): the sweep bar closes through the gap; the inversion is bar 6's close.
  const inversionOnSweep = { ...IFVG_DAY, 3: bar(100.8, 103.6, 99.6, 103.4) };
  const is = one(inversionOnSweep, IFVG_SPEC);
  assert.equal(is.sessions[0].sweepIdx, 3);
  assert.equal(is.trades[0].inversionIdx, 6);
});

test('the window: sweeps through bar 17, decisions through bar 17, fills through bar 17 and never on bar 18', () => {
  const at10 = one(shifted(OB_DAY, 10), OB_SPEC);
  assert.equal(at10.trades[0].fillIdx, 17, 'the 10:55 bar fills');
  const at11 = one(shifted(OB_DAY, 11), OB_SPEC);
  assert.equal(at11.sessions[0].confirmIdx, 17);
  assert.equal(at11.sessions[0].stage, 'order_expired', 'an order placed at the close of bar 17 can never fill');
  assert.deepEqual(countsOf(at11), { sessions: 1, tradeable: 1, sweeps: 1, confirmations: 1, zones: 1, orders: 1, fills: 0 }, 'an expired order is no fill');
  const at12 = one(shifted(OB_DAY, 12), OB_SPEC);
  assert.equal(at12.sessions[0].stage, 'no_confirmation', 'a break on bar 18 is outside the window');
  assert.equal(one(shifted(OB_DAY, 17), OB_SPEC).sessions[0].sweepIdx, 17, 'a sweep on bar 17 opens a setup');
  assert.equal(one(shifted(OB_DAY, 18), OB_SPEC).sessions[0].stage, 'no_sweep', 'a sweep on bar 18 is outside the window');
  // A fill that would come on bar 18 does not happen: bar 17 does not trade through, bar 18 does.
  const late = { ...shifted(OB_DAY, 10), 17: bar(103.2, 103.4, 101.6, 102), 18: bar(102, 102.2, 100.4, 101.5) };
  assert.equal(one(late, OB_SPEC).sessions[0].stage, 'order_expired');
});

test('the re-arm: a refused confirmation does not end the session; a later confirmation with a usable zone trades; a session has one filled trade', () => {
  const rearm = { ...OB_DAY, 8: bar(102, 103.3, 101.6, 103.0), 9: bar(103.0, 103.2, 102.6, 102.8), 10: bar(103.5, 103.9, 103.5, 103.8), 11: bar(103.8, 104, 103.3, 103.6) };
  const r = one(rearm, FVG_SPEC);
  const s = r.sessions[0];
  assert.equal(s.stage, 'filled');
  assert.equal(s.confirmations, 2);
  assert.deepEqual(s.refusals, [{ k: 6, stage: 'no_zone' }]);
  const t = r.trades[0];
  assert.equal(t.confirmIdx, 10);
  assert.equal(t.swingIdx, 6);
  assert.deepEqual(t.zone, { type: 'fair_value_gap', index: 8, lo: 103.3, hi: 103.5, height: 0.2 });
  assert.equal(t.entry, 103.4);
  assert.equal(t.fillIdx, 11);
  assert.equal(t.exitKind, 'time');
  assert.equal(t.refusalsBefore, 1);
  assert.equal(r.counts.refusedConfirmations, 1);
  assert.deepEqual(r.funnel, { sessions: 1, tradeable: 1, sweeps: 1, confirmed: 1, usableZone: 1, orders: 1, fills: 1 });
  // One filled trade per session: a second full pattern later in the window never trades.
  const twice = { ...OB_DAY, ...shifted(OB_DAY, 9) };
  const r2 = one(twice, OB_SPEC);
  assert.equal(r2.trades.length, 1);
  assert.equal(r2.trades[0].fillIdx, 7, 'the first order is final: the later pattern replaces nothing');
  assert.equal(r2.trades[0].confirmIdx, 6);
  assert.equal(r2.stageCounts.filled, 1);
  assert.equal(r2.funnel.orders, 1);
  // After a stop, no re-entry either.
  const stopped = { ...OB_DAY, 8: bar(102, 102.5, 99.2, 102), ...shifted(OB_DAY, 9) };
  const r3 = one(stopped, OB_SPEC);
  assert.equal(r3.trades.length, 1);
  assert.equal(r3.trades[0].exitKind, 'stop');
});

test('fills and exits: a touch is no fill; the stop on the fill bar; the target not on the fill bar; stop first; the gap-through price; the last refusal is the stage', () => {
  const touch = one({ ...OB_DAY, 7: bar(103.2, 103.4, 100.5, 102), 8: bar(102, 102.4, 101.6, 102.2), 9: bar(102.2, 102.5, 101.9, 102.3), 10: bar(102.3, 102.5, 102, 102.4) }, OB_SPEC);
  assert.equal(touch.sessions[0].stage, 'order_expired');
  const sameBar = one({ ...OB_DAY, 7: bar(103.2, 103.4, 99.0, 102) }, OB_SPEC);
  assert.equal(sameBar.trades[0].exitKind, 'stop_same_bar');
  assert.equal(sameBar.trades[0].exitPrice, 99.49);
  assert.equal(sameBar.exitCounts.stop_same_bar, 1);
  close(sameBar.trades[0].R, -1.05 / 1.01);
  const targetOnFill = one({ ...OB_DAY, 7: bar(103.2, 110, 100.4, 102) }, OB_SPEC);
  assert.equal(targetOnFill.trades[0].exitIdx, 8, 'the target is not tested on the fill bar');
  const ambiguous = one({ ...OB_DAY, 8: bar(102, 110.5, 99.2, 103.5) }, OB_SPEC);
  assert.equal(ambiguous.trades[0].exitKind, 'stop');
  assert.equal(ambiguous.trades[0].exitPrice, 99.49);
  const gap = one({ ...OB_DAY, 8: bar(99, 99.5, 98.5, 99.2) }, OB_SPEC);
  assert.equal(gap.trades[0].exitPrice, 99);
  close(gap.trades[0].R, (99 - 100.5 - 0.04) / 1.01);
  assert.ok(STAGES.includes('order_expired') && STAGES.includes('no_confirmation'));
});

test('the data rules: an incomplete session, an incomplete or missing prior session, a missing daily bar; no warm-up is needed', () => {
  const sc = scenario({ overrides: OB_DAY });
  const incomplete = structuredClone(sc);
  incomplete.sessions[incomplete.sessions.length - 1].bars.pop();
  assert.equal(run(incomplete, OB_SPEC).sessions[0].stage, 'incomplete');
  const priorIncomplete = structuredClone(sc);
  priorIncomplete.sessions[priorIncomplete.sessions.length - 2].bars.splice(30, 1);
  assert.equal(run(priorIncomplete, OB_SPEC).sessions[0].stage, 'no_prior_session');
  const noDaily = structuredClone(sc);
  noDaily.daily.pop();
  assert.equal(run(noDaily, OB_SPEC).sessions[0].stage, 'no_prior_session');
  const noPrior = structuredClone(sc);
  noPrior.sessions.splice(noPrior.sessions.length - 2, 1);
  assert.equal(run(noPrior, OB_SPEC).sessions[0].stage, 'no_prior_session');
  assert.equal(run(scenario({ overrides: OB_DAY, priorCount: 1 }), OB_SPEC).sessions[0].stage, 'filled', 'one complete prior session with its daily bar is enough');
});

test('early close: 42 bars, the time stop at the 12:55 open; the window is the same', () => {
  const sc = scenario({ overrides: IFVG_DAY, startDate: '2019-11-26' });
  assert.equal(sc.testDate, '2019-11-29');
  assert.equal(sc.sessions[sc.sessions.length - 1].full, 42);
  const t = run(sc, IFVG_SPEC).trades[0];
  assert.equal(t.exitKind, 'time');
  assert.equal(t.exitIdx, 41);
  assert.equal(t.exitPrice, 104);
});

test('sizing in the engine: cash_capped with the actual risk recorded, unfunded recorded and skipped, the cash follows every exit', () => {
  const capped = one({ ...OB_DAY, 0: bar(100.7, 100.7, 99.5, 100.05), 7: bar(103.2, 103.4, 100.0, 102) }, OB_SPEC);
  const t = capped.trades[0];
  assert.equal(t.entry, 100.1);
  close(t.stopDistance, 0.61);
  assert.deepEqual([t.shares, t.sharesRisk, t.sharesCash, t.cashCapped], [49, 81, 49, true]);
  close(t.plannedRiskActual, 29.89);
  assert.equal(t.plannedRiskMax, 50);
  close(t.pnl, 49 * 1.18);
  assert.equal(capped.counts.cashCapped, 1);
  assert.equal(capped.account.cashCapped, 1);
  const unfunded = one(OB_DAY, OB_SPEC, {}, { startingCash: 50 });
  assert.equal(unfunded.sessions[0].stage, 'unfunded');
  assert.equal(unfunded.trades.length, 0);
  assert.equal(unfunded.counts.unfunded, 1);
  assert.deepEqual(unfunded.funnel, { sessions: 1, tradeable: 1, sweeps: 1, confirmed: 1, usableZone: 1, orders: 0, fills: 0 });
  // Two sessions: the second is sized on the cash after the first.
  const sc = scenario({ overrides: OB_DAY, priorCount: 2 });
  const d2 = tradingDays(sc.testDate, '2020-12-31')[1];
  sc.sessions.push(session(d2, { overrides: OB_DAY }));
  sc.daily.push({ date: sc.testDate, o: 104, h: 110, l: 100, c: 104 });
  const r = runSpec({ spec: OB_SPEC, daily: sc.daily, sessions: sc.sessions, window: { start: sc.testDate, end: d2 } });
  assert.equal(r.trades.length, 2);
  close(r.trades[1].cashBefore, 5097.02);
  assert.equal(r.trades[1].sharesRisk, 50, 'floor(50.9702 / 1.01)');
  assert.equal(r.trades[1].sharesCash, 50, 'floor((5097.02 - 0.04 x 50) / 100.5)');
  close(r.account.endingCash, 5097.02 + 50 * 1.98);
});

test('costs on every fill: the 2x sensitivity is derived from the same fills; the R without costs differs by exactly 0.04 / distance', () => {
  const t = one(OB_DAY, OB_SPEC).trades[0];
  close(t.R - t.R2x, 0.04 / 1.01);
  close(2.02 / 1.01 - t.R, 0.04 / 1.01);
});

test('no look-ahead: bars after the decision leave every decision up to it unchanged; later sessions never affect earlier ones', () => {
  const sc = scenario({ overrides: OB_DAY });
  const base = run(sc, OB_SPEC);
  const after = structuredClone(sc);
  const last = after.sessions[after.sessions.length - 1];
  for (const b of last.bars) if (b.idx >= 8) Object.assign(b, bar(50, 400, 10, 60));
  const r = run(after, OB_SPEC);
  const keys = ['sweepIdx', 'sweepExtreme', 'confirmIdx', 'swingIdx', 'swingLevel', 'zone', 'entry', 'stop', 'target', 'stopDistance', 'shares', 'fillIdx'];
  for (const k of keys) assert.deepEqual(r.trades[0][k], base.trades[0][k], k);
  assert.notEqual(r.trades[0].exitPrice, base.trades[0].exitPrice);
  const unfilled = structuredClone(sc);
  for (const b of unfilled.sessions[unfilled.sessions.length - 1].bars) if (b.idx >= 7) Object.assign(b, flat(104, 0.2));
  const u = run(unfilled, OB_SPEC);
  assert.equal(u.sessions[0].stage, 'order_expired');
  assert.equal(u.sessions[0].entry, base.trades[0].entry);
  assert.equal(u.sessions[0].stop, base.trades[0].stop);
  const more = structuredClone(sc);
  const days = tradingDays(sc.testDate, '2019-12-31').slice(1, 4);
  for (const d of days) { more.sessions.push(session(d, { overrides: OB_DAY })); more.daily.push({ date: d, o: 1, h: 999, l: 0.5, c: 1 }); }
  more.daily.push({ date: sc.testDate, o: 104, h: 104.5, l: 103.5, c: 104 });
  const m = runSpec({ spec: OB_SPEC, daily: more.daily, sessions: more.sessions, window: { start: sc.testDate, end: days[2] } });
  assert.deepEqual(m.sessions[0], base.sessions[0]);
  assert.deepEqual(m.trades[0], base.trades[0]);
});

test('prefix invariance, determinism and the snapshot round-trip on a synthetic market, for every spec', () => {
  const market = buildMarket({ from: '2019-01-02', to: '2019-09-30', extended: false, seed: 3, volatility: 0.02 });
  const { daily, sessions } = inputsOf(market);
  const win = { start: '2019-02-01', end: '2019-09-30' }, cut = '2019-06-28';
  for (const spec of Object.values(SPECS)) {
    const full = runSpec({ spec, daily, sessions, window: win });
    const again = runSpec({ spec, daily, sessions, window: win });
    assert.equal(JSON.stringify(again), JSON.stringify(full), `deterministic: ${spec.name}`);
    assert.equal(full.sessions.length, 167);
    assert.equal(Object.values(full.stageCounts).reduce((a, b) => a + b, 0), full.sessionsInWindow);
    assert.ok(full.sessions.every((s) => STAGES.includes(s.stage)));
    const prefix = runSpec({ spec, daily: daily.filter((d) => d.date <= cut), sessions: sessions.filter((s) => s.date <= cut), window: { start: win.start, end: cut } });
    assert.deepEqual(prefix.sessions, full.sessions.filter((s) => s.session <= cut), `prefix: ${spec.name}`);
    assert.deepEqual(prefix.trades, full.trades.filter((t) => t.session <= cut));
    // Snapshot: feed to the cut, snapshot (plain JSON), restore into a new engine, feed the rest.
    const dailyByDate = new Map(daily.map((d) => [d.date, d]));
    const S = [...sessions].sort((a, b) => (a.date < b.date ? -1 : 1));
    const e1 = createEngine({ spec });
    for (const s of S.filter((x) => x.date <= cut)) e1.feed({ date: s.date, full: s.full, bars: s.bars, daily: dailyByDate.get(s.date) ?? null, inWindow: s.date >= win.start });
    const snap = e1.snapshot();
    assert.equal(typeof JSON.stringify(snap), 'string');
    assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap, 'plain JSON');
    const e2 = createEngine({ spec, restore: snap });
    for (const s of S.filter((x) => x.date > cut)) e2.feed({ date: s.date, full: s.full, bars: s.bars, daily: dailyByDate.get(s.date) ?? null, inWindow: s.date <= win.end });
    assert.deepEqual({ ...e2.result(), window: full.window }, full, `snapshot round-trip: ${spec.name}`);
  }
  const counts = Object.values(SPECS).map((spec) => countsOf(runSpec({ spec, daily, sessions, window: win })));
  assert.ok(counts.every((c) => c.sessions === 167 && c.sweeps <= c.tradeable && c.confirmations <= c.sweeps && c.zones <= c.confirmations && c.orders <= c.zones && c.fills <= c.orders));
});
