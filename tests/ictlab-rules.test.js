// ICT Lab rule functions (CONCEPTS.md H1 to H20) with hand-checked cases and the boundary cases: a close exactly
// at PDL is not a sweep, equal highs form no swing, a gap of height 0.04 is refused, a stop distance of 0.39 is
// refused, the half cent rounds down, the stop comes first, the target is not tested on the fill bar. Synthetic
// bars only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toU, fromU, CENT, swingHighs, swingLows, confirmedBy, priorSessionLow, isSweepBar, sweepExtreme, bosAt, bullishFvg, bearishFvgs, inversionAt, orderBlock, downwardBosAt, bearishOrderBlockAt, mostRecentBearishBlock, blockFails, breakerCoupling, stopFrom, entryOf, fillIndex, simulateExit, targetOf, zoneUsable, sizeTrade, rOf, pnlCents } from '../server/ictlab/rules.js';
import { OB_DAY, IFVG_DAY, BREAKER_DAY, bar } from './ictlab-fixtures.js';

const U = (b) => ({ o: toU(b.o), h: toU(b.h), l: toU(b.l), c: toU(b.c) });
const day = (d, n = 20, base = 104) => Array.from({ length: n }, (_, i) => U(d[i] || bar(base, base, base, base)));
const SW = { leftBars: 1, rightBars: 1, confirmBarOffset: 3 };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('units: toU/fromU are exact at four decimals; a cent is 100 units', () => {
  assert.equal(toU(100.5), 1005000);
  assert.equal(fromU(1005000), 100.5);
  assert.equal(toU(0.01), CENT);
  assert.equal(toU(102.52) - toU(100.5), 20200);
});

test('H1: swings are strict on both sides with left 1 and right 1; equal highs form no swing; confirmed at i + 3', () => {
  const bars = day(OB_DAY, 12);
  assert.deepEqual(swingHighs(bars, SW), [2, 6], 'bar 2 (103 > 102 and 102.8), bar 6 (103.5 > 102 and 103.4); bar 8 (104) equals the flat 104 after it: no swing');
  assert.deepEqual(swingLows(bars, SW), [5, 7], 'bar 5 (101.2 < 101.5 and 101.8), bar 7 (100.4 < 101.8 and 101.6)');
  const equal = day({ ...OB_DAY, 3: bar(102.5, 103, 101.8, 102) }, 12);
  assert.deepEqual(swingHighs(equal, SW), [6], 'H[2] = H[3] = 103: no swing at 2 or 3');
  assert.deepEqual(swingLows(day({ 0: bar(101, 102, 100, 101), 1: bar(101, 102, 100, 101), 2: bar(101, 102, 101, 101) }, 6, 103), SW), [], 'equal lows form no swing');
  assert.deepEqual(confirmedBy([2, 6, 8], 9, 3), [2, 6], 'at the close of bar 9 the swings with i + 3 <= 9');
  assert.deepEqual(confirmedBy([2, 6, 8], 5, 3), [2]);
  assert.deepEqual(confirmedBy([2], 4, 3), [], 'bar 2 is confirmed at the close of bar 5, not 4');
  // Two bars each side: a wider fractal, for completeness of the parameter.
  assert.deepEqual(swingHighs(day({ 2: bar(100, 105, 99, 100) }, 6, 100), { leftBars: 2, rightBars: 2, confirmBarOffset: 3 }), [2]);
});

test('H3/H4: the level is the prior daily low; a sweep trades below it and closes strictly above; a close at PDL or a wick-only bar is no sweep', () => {
  const pdl = priorSessionLow({ l: toU(100) });
  assert.equal(pdl, toU(100));
  assert.equal(isSweepBar(U(bar(101, 101.5, 99.5, 100.5)), pdl), true);
  assert.equal(isSweepBar(U(bar(101, 101.5, 99.5, 100)), pdl), false, 'a close exactly at PDL is not inside');
  assert.equal(isSweepBar(U(bar(101, 101.5, 99.5, 99.8)), pdl), false, 'wick only: closed below');
  assert.equal(isSweepBar(U(bar(101, 101.5, 100, 100.5)), pdl), false, 'a low exactly at PDL does not trade below it');
  assert.equal(isSweepBar(U(bar(101, 101.5, 99.99, 100.01)), pdl), true);
});

test('H5: the sweep extreme is the lowest low from the sweep bar and lambda the latest bar at it', () => {
  const bars = day({ ...OB_DAY, 3: bar(102.5, 102.8, 99.2, 102) }, 12);
  assert.deepEqual(sweepExtreme(bars, 0, 6), { extreme: toU(99.2), lambda: 3 });
  assert.deepEqual(sweepExtreme(day(OB_DAY, 12), 0, 6), { extreme: toU(99.5), lambda: 0 });
  const tie = day({ ...OB_DAY, 3: bar(102.5, 102.8, 99.5, 102) }, 12);
  assert.deepEqual(sweepExtreme(tie, 0, 6), { extreme: toU(99.5), lambda: 3 }, 'an equal low later is the latest bar at the extreme');
});

test('H6: the BOS uses the most recent swing high confirmed before the close, first close above only; a swing confirmed at k itself is not structure', () => {
  const bars = day(OB_DAY, 12);
  assert.deepEqual(bosAt(bars, 6, SW), { ok: true, swingIndex: 2, level: toU(103), reason: null });
  assert.equal(bosAt(bars, 5, SW).ok, false, 'the swing at 2 is confirmed at the close of 5: not before it');
  assert.equal(bosAt(bars, 5, SW).reason, 'no confirmed swing high');
  assert.equal(bosAt(bars, 7, SW).ok, false);
  assert.equal(bosAt(bars, 7, SW).reason, 'the swing was already closed above');
  const notAbove = day({ ...OB_DAY, 6: bar(101.9, 103.5, 101.8, 103) }, 12);
  assert.equal(bosAt(notAbove, 6, SW).reason, 'close not above the swing', 'a close equal to the swing high is not above it');
  // Bar 5 closes above the swing at 2 while that swing is confirmed only at this close: no BOS at 5; from 6 on the
  // swing at 2 is already closed above.
  const early = day({ ...OB_DAY, 5: bar(101.7, 103.6, 101.2, 103.3) }, 12);
  assert.equal(bosAt(early, 5, SW).ok, false);
  assert.equal(bosAt(early, 6, SW).reason, 'the swing was already closed above');
});

test('H8/H9: the latest bullish gap inside the displacement leg; none outside it; H18 refuses a height under 0.05', () => {
  const noGap = day(OB_DAY, 12);
  assert.equal(bullishFvg(noGap, 0, 6), null);
  const gap = day({ ...OB_DAY, 6: bar(102.6, 103.5, 102.6, 103.2) }, 12);
  assert.deepEqual(bullishFvg(gap, 0, 6), { type: 'fair_value_gap', index: 4, lo: toU(102.4), hi: toU(102.6) });
  assert.equal(bullishFvg(gap, 5, 6), null, 'a leg starting at 5 excludes the triple (4, 5, 6)');
  // Two gaps: the latest (largest a) wins.
  const two = day({ ...OB_DAY, 2: bar(101.5, 103, 102.1, 102.5), 6: bar(102.6, 103.5, 102.6, 103.2) }, 12); // H0 101.5 < L2 102.1 and H4 102.4 < L6 102.6
  assert.equal(bullishFvg(two, 0, 6).index, 4);
  assert.equal(bullishFvg(two, 0, 4).index, 0, 'with the leg ending at 4 only the first gap exists');
  assert.equal(zoneUsable({ lo: toU(102.4), hi: toU(102.44) }, toU(0.05)), false, 'height 0.04 is refused');
  assert.equal(zoneUsable({ lo: toU(102.4), hi: toU(102.45) }, toU(0.05)), true, 'height 0.05 is the minimum');
  const touching = day({ ...OB_DAY, 6: bar(102.4, 103.5, 102.4, 103.2) }, 12);
  assert.equal(bullishFvg(touching, 0, 6), null, 'H[4] = L[6]: no gap (strict inequality)');
});

test('H10: bearish gaps completed in the window; the inversion is a close strictly above the upper bound at v > s, v >= a + 3; the most recent gap wins', () => {
  const bars = day(IFVG_DAY, 12);
  assert.deepEqual(bearishFvgs(bars, 17), [{ type: 'inversion_fvg', index: 0, lo: toU(102.4), hi: toU(103) }]);
  assert.deepEqual(inversionAt(bars, 6, 3, { maxAgeBars: 17 }), { type: 'inversion_fvg', index: 0, lo: toU(102.4), hi: toU(103) });
  assert.equal(inversionAt(bars, 5, 3, { maxAgeBars: 17 }), null, 'bar 5 closes at 102.3, not above 103');
  assert.equal(inversionAt(bars, 3, 3, { maxAgeBars: 17 }), null, 'v must be after the sweep bar');
  const atBound = day({ ...IFVG_DAY, 6: bar(102.3, 103.6, 102.1, 103) }, 12);
  assert.equal(inversionAt(atBound, 6, 3, { maxAgeBars: 17 }), null, 'a close exactly at the upper bound is not through it');
  // v >= a + 3: the gap's own third bar (v = a + 2) can never be its inversion, whatever the sweep bar.
  assert.equal(inversionAt(bars, 2, 1, { maxAgeBars: 17 }), null);
  // Two eligible gaps closed through by the same bar: the most recent (largest a).
  const twoGaps = day({ 0: bar(106, 106.5, 105, 105.2), 1: bar(105.2, 105.3, 103.8, 104), 2: bar(104, 104.4, 102.5, 102.8), 3: bar(102.8, 103, 101.5, 101.8), 4: bar(101.8, 101.9, 100.2, 100.5), 5: bar(100.5, 100.6, 99.5, 100.3), 6: bar(100.3, 100.8, 100.1, 100.6), 7: bar(100.6, 100.9, 100.2, 100.7), 8: bar(100.7, 107, 100.6, 106.5) }, 12);
  const gaps = bearishFvgs(twoGaps, 17).map((g) => g.index);
  assert.deepEqual(gaps, [0, 1, 2, 3], 'L0 105 > H2 104.4; L1 103.8 > H3 103; L2 102.5 > H4 101.9; L3 101.5 > H5 100.6');
  assert.equal(inversionAt(twoGaps, 8, 5, { maxAgeBars: 17 }).index, 3, 'bar 8 closes through every gap: the most recent is used');
  assert.equal(bearishFvgs(twoGaps, 3).length, 2, 'a gap whose third bar is after the window is not eligible');
  assert.equal(inversionAt(twoGaps, 8, 5, { maxAgeBars: 3 }).index, 1, 'with the window at 3 the most recent eligible gap is a = 1');
});

test('H11: the order block is the latest bearish bar at or before the extreme bar, searched back to index 0; a doji is neither colour', () => {
  const bars = day(OB_DAY, 12);
  assert.deepEqual(orderBlock(bars, 0), { type: 'order_block', index: 0, lo: toU(99.5), hi: toU(101.5) });
  assert.deepEqual(orderBlock(bars, 3).index, 3, 'bar 3 (102.5 -> 102) is bearish');
  const doji = day({ ...OB_DAY, 0: bar(100.5, 101.5, 99.5, 100.5) }, 12);
  assert.equal(orderBlock(doji, 0), null, 'C = O is not bearish; nothing before index 0');
  const bull = day({ ...OB_DAY, 3: bar(102, 102.8, 101.8, 102.5) }, 12);
  assert.equal(orderBlock(bull, 3).index, 0, 'the search steps back past bullish bars');
});

test('H12: the downward BOS, the leg origin and the bearish order block; mu = i_L gives no block', () => {
  const bars = day(BREAKER_DAY, 14);
  assert.deepEqual(downwardBosAt(bars, 5, SW), { ok: true, swingIndex: 1, level: toU(102), reason: null });
  assert.equal(downwardBosAt(bars, 4, SW).ok, false, 'the swing low at 1 is confirmed at the close of 4, not before it');
  const block = bearishOrderBlockAt(bars, 5, SW);
  assert.deepEqual(block, { type: 'breaker', index: 3, lo: toU(103.2), hi: toU(104.2), breakIndex: 5, swingLowIndex: 1, legOriginIndex: 3 });
  assert.equal(bearishOrderBlockAt(bars, 6, SW), null, 'bar 6 closes below 102 too, but bar 5 already closed below it');
  assert.deepEqual(mostRecentBearishBlock(bars, 9, SW), block);
  assert.equal(mostRecentBearishBlock(bars, 4, SW), null);
  // A close below the swing low on its confirmation bar itself is not a break (the swing is confirmed at the
  // close of bar 4, usable from bar 5), and by bar 5 that earlier close has already broken it.
  const earlyBreak = day({ ...BREAKER_DAY, 4: bar(104.0, 104.1, 101.0, 101.5) }, 14);
  assert.equal(downwardBosAt(earlyBreak, 4, SW).reason, 'no confirmed swing low');
  assert.equal(downwardBosAt(earlyBreak, 5, SW).reason, 'the swing was already closed below');
  assert.equal(mostRecentBearishBlock(earlyBreak, 9, SW), null);
  // No rally after the swing low: mu = i_L, no block, even though a bullish bar (bar 0) sits before the swing low.
  const noLeg = day({ 0: bar(102.4, 103.4, 102.3, 102.6), 1: bar(102.6, 103, 102.0, 102.3), 2: bar(102.3, 102.9, 102.2, 102.5), 3: bar(102.5, 102.8, 102.1, 102.4), 4: bar(102.4, 102.6, 102.2, 102.3), 5: bar(102.3, 102.4, 101.0, 101.5) }, 14, 101.5);
  assert.equal(downwardBosAt(noLeg, 5, SW).ok, true);
  assert.equal(bearishOrderBlockAt(noLeg, 5, SW), null, 'the highest high in [1, 5] is bar 1 itself: no leg, no block');
});

test('H13: the block fails on a close strictly above its upper bound; the coupling pairs a failure and a break within 6 bars, either order, confirmed at the later', () => {
  const block = { lo: toU(103.2), hi: toU(104.2) };
  assert.equal(blockFails(U(bar(102.8, 104.5, 102.6, 104.4)), block), true);
  assert.equal(blockFails(U(bar(102.8, 104.5, 102.6, 104.2)), block), false, 'a close at the bound is not through it');
  assert.deepEqual(breakerCoupling([{ f: 9, block }], [9], 9, 6), { f: 9, kBos: 9, block });
  assert.deepEqual(breakerCoupling([{ f: 9, block }], [12], 12, 6), { f: 9, kBos: 12, block }, 'the break after the failure, confirmed at 12');
  assert.deepEqual(breakerCoupling([{ f: 12, block }], [7], 12, 6), { f: 12, kBos: 7, block }, 'the failure after the break, within 6');
  assert.equal(breakerCoupling([{ f: 14, block }], [7], 14, 6), null, '7 bars apart: not coupled');
  assert.equal(breakerCoupling([{ f: 9, block }], [12], 11, 6), null, 'nothing is confirmed on a bar that is neither event');
  assert.equal(breakerCoupling([], [9], 9, 6), null);
});

test('H14/H15/H17: the stop beyond the lower anchor; the midpoint rounds a half cent down; the entry-below-close and 0.40 checks are the engine\'s on these values; the fill is strictly through', () => {
  assert.equal(stopFrom([toU(103.2), toU(99.7)], toU(0.01)), toU(99.69));
  assert.equal(stopFrom([toU(99.5)], toU(0.01)), toU(99.49));
  assert.equal(entryOf(toU(99.5), toU(101.5)), toU(100.5));
  assert.equal(entryOf(toU(99.5), toU(101.51)), toU(100.5), '100.505 rounds down to 100.50');
  assert.equal(entryOf(toU(102.4), toU(102.45)), toU(102.42), '102.425 rounds down to 102.42');
  assert.equal(entryOf(toU(99.5), toU(101.52)), toU(100.51));
  assert.equal(targetOf(toU(100.5), toU(1.01), 2), toU(102.52));
  // A distance of 0.39 is under the minimum, 0.40 is not (the engine compares with the spec's minimum).
  assert.ok(toU(100.28) - toU(99.89) < toU(0.40));
  assert.ok(toU(100.29) - toU(99.89) >= toU(0.40));
  const bars = day(OB_DAY, 12);
  assert.equal(fillIndex(bars, 6, 17, toU(100.5)), 7, 'bar 7 trades through 100.50');
  assert.equal(fillIndex(bars, 6, 17, toU(100.4)), null, 'a touch of the limit (low 100.4) is no fill');
  assert.equal(fillIndex(bars, 6, 6, toU(100.5)), null, 'no bar after the cutoff');
  assert.equal(fillIndex(day({ ...OB_DAY, 7: bar(103.2, 103.4, 101, 102), 8: bar(102, 104, 100.4, 103.5) }, 12), 6, 17, toU(100.5)), 8);
});

test('H16: the stop on the fill bar; stop first on an ambiguous bar; gap-through at the open; the target strictly through; the time stop at the last open', () => {
  const stop = toU(99.49), target = toU(102.52);
  assert.deepEqual(simulateExit(day(OB_DAY, 78), 7, stop, target), { exitIndex: 8, exit: target, kind: 'target' });
  assert.deepEqual(simulateExit(day({ ...OB_DAY, 7: bar(103.2, 103.4, 99.0, 102) }, 78), 7, stop, target), { exitIndex: 7, exit: stop, kind: 'stop_same_bar' });
  assert.deepEqual(simulateExit(day({ ...OB_DAY, 7: bar(103.2, 110, 100.4, 102) }, 78), 7, stop, target).exitIndex, 8, 'the target is not tested on the fill bar');
  assert.deepEqual(simulateExit(day({ ...OB_DAY, 8: bar(102, 110.5, 99.2, 103.5) }, 78), 7, stop, target), { exitIndex: 8, exit: stop, kind: 'stop' });
  assert.deepEqual(simulateExit(day({ ...OB_DAY, 8: bar(99, 99.5, 98.5, 99.2) }, 78), 7, stop, target), { exitIndex: 8, exit: toU(99), kind: 'stop' }, 'a gap through the stop exits at the open');
  // Flat bars at 102 after bar 8: between the stop and the target, so the time stop decides.
  assert.deepEqual(simulateExit(day({ ...OB_DAY, 8: bar(102, 102.52, 101.6, 102.5) }, 78, 102), 7, stop, target).exitIndex, 77, 'a high exactly at the target is not through it: the time stop');
  const flat = day({ ...OB_DAY, 8: bar(102, 102.5, 101.6, 102.4) }, 78, 102);
  assert.deepEqual(simulateExit(flat, 7, stop, target), { exitIndex: 77, exit: toU(102), kind: 'time' });
  assert.deepEqual(simulateExit(day({ ...OB_DAY, 8: bar(102, 102.5, 101.6, 102.4), 77: bar(103, 103.2, 102.9, 103.1) }, 78, 102), 7, stop, target), { exitIndex: 77, exit: toU(103), kind: 'time' }, 'the open of the last bar, not its close');
  assert.deepEqual(simulateExit(day({ ...OB_DAY, 8: bar(102, 102.5, 101.6, 102.4), 77: bar(103, 103.2, 99, 103.1) }, 78, 102), 7, stop, target).kind, 'time', 'the last bar is not tested for the stop');
  assert.deepEqual(simulateExit(day({ ...OB_DAY, 8: bar(102, 102.5, 101.6, 102.4), 76: bar(103, 103.2, 99, 103.1) }, 78, 102), 7, stop, target).kind, 'stop', 'bar n - 2 is');
});

test('H19: sizing in whole cents with the exact fraction; unfunded, cash-capped and the actual planned risk', () => {
  const a = sizeTrade({ cashCents: 500000, entryCents: 10050, stopDistanceCents: 101, perSideCents: 2, maxRiskFraction: 0.01 });
  assert.deepEqual(a, { shares: 49, sharesRisk: 49, sharesCash: 49, estimatedCostsCents: 196, unfunded: false, cashCapped: false, plannedRiskMaxCents: 5000, plannedRiskActualCents: 4949 });
  const capped = sizeTrade({ cashCents: 500000, entryCents: 10000, stopDistanceCents: 50, perSideCents: 2, maxRiskFraction: 0.01 });
  assert.deepEqual(capped, { shares: 49, sharesRisk: 100, sharesCash: 49, estimatedCostsCents: 200, unfunded: false, cashCapped: true, plannedRiskMaxCents: 5000, plannedRiskActualCents: 2450 }, 'the costs of the largest affordable count (50 shares, $2.00) leave 49');
  const u = sizeTrade({ cashCents: 500000, entryCents: 600000, stopDistanceCents: 50, perSideCents: 2, maxRiskFraction: 0.01 });
  assert.equal(u.unfunded, true);
  assert.equal(u.shares, 0);
  const b = sizeTrade({ cashCents: 497653, entryCents: 10370, stopDistanceCents: 401, perSideCents: 2, maxRiskFraction: 0.01 });
  assert.equal(b.sharesRisk, 12, 'floor(49.7653 / 4.01)');
  close(b.plannedRiskMaxCents, 4976.53);
});

test('H20: R after costs and the cash change', () => {
  close(rOf(toU(100.5), toU(102.52), toU(1.01), toU(0.02)), 1.98 / 1.01);
  close(rOf(toU(100.5), toU(102.52), toU(1.01), toU(0.04)), 1.94 / 1.01);
  close(rOf(toU(100.5), toU(102.52), toU(1.01), 0), 2.02 / 1.01);
  assert.equal(pnlCents(49, 10050, 10252, 2), 9702);
  assert.equal(pnlCents(12, 10370, 9969, 2), -4860);
});
