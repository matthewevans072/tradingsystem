// sweep-bos rule functions (PRE-REGISTRATION.md section 3), each with a hand-checked example. Prices in units
// of 0.0001 (toU). Synthetic numbers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toU, fromU, swingHighs, swingLows, confirmedBy, dailyBias, sweepDirection, bosAt, legExtremeIndex, orderBlock, fairValueGap, bufferFromSessions, secondSwingStop, simulateExit, rOf, CENT } from '../server/sweepbos/rules.js';

const B = (o, h, l, c) => ({ o: toU(o), h: toU(h), l: toU(l), c: toU(c) });
const HL = (list) => list.map(([h, l]) => ({ o: toU((h + l) / 2), h: toU(h), l: toU(l), c: toU((h + l) / 2) }));

test('swings: 3-bar fractal strict on both sides; confirmed only after 3 later bars', () => {
  const bars = HL([[10, 9], [11, 9.5], [10.5, 9.2], [12, 10], [12, 10.5], [11, 9.8], [11.5, 10.2]]);
  assert.deepEqual(swingHighs(bars), [1], 'bar 3 and 4 share the high 12: equal highs form no swing');
  assert.deepEqual(swingLows(bars), [2, 5]);
  assert.deepEqual(confirmedBy([1, 2, 5], 4), [1], 'at the close of bar 4 only the swing at 1 (1 + 3 <= 4) is confirmed');
  assert.deepEqual(confirmedBy([1, 2, 5], 5), [1, 2]);
  assert.deepEqual(confirmedBy([1, 2, 5], 8), [1, 2, 5]);
  assert.deepEqual(swingHighs(HL([[10, 9], [11, 9]])), [], 'no swing with fewer than three bars');
});

test('daily bias: both rising -> long, both falling -> short, mixed or fewer than two confirmed swings -> none', () => {
  // highs: swings at 3 (109), 7 (112), 11 (114); lows: swings at 1 (99), 5 (100.5), 9 (103)
  const rising = HL([[105, 100], [104, 99], [107, 101], [109, 103], [108, 102], [106, 100.5], [110, 104], [112, 105], [111, 104.5], [110, 103], [113, 105], [114, 106], [113, 105], [115, 107], [116, 108]]);
  const r = dailyBias(rising);
  assert.equal(r.bias, 'long');
  assert.deepEqual(r.highs, [7, 11]);
  assert.deepEqual(r.lows, [5, 9]);
  // One bar fewer: the swing high at 11 is not yet confirmed (11 + 3 > 13), so the last two are 3 and 7: still rising.
  assert.deepEqual(dailyBias(rising.slice(0, 14)).highs, [3, 7]);
  // Only 5 bars: the swing at 1 is confirmed (1 + 3 <= 4) but no second one: none.
  assert.equal(dailyBias(rising.slice(0, 5)).bias, 'none');
  const falling = rising.map((b) => ({ o: b.o, h: toU(230) - b.l, l: toU(230) - b.h, c: b.c }));
  assert.equal(dailyBias(falling).bias, 'short');
  // Rising highs with falling lows: none.
  const mixed = rising.map((b, i) => (i === 9 ? { ...b, l: toU(100) } : b)); // the swing low at 9 now below the one at 5
  assert.equal(dailyBias(mixed).bias, 'none');
});

test('sweep: a bar that trades beyond the level and closes back inside; wick-only or a close beyond gives none; both sides gives "both"', () => {
  const pdh = toU(110), pdl = toU(100);
  assert.equal(sweepDirection(B(101, 101.5, 99.5, 100.5), pdh, pdl), 'long');
  assert.equal(sweepDirection(B(109, 110.5, 108.5, 109.5), pdh, pdl), 'short');
  assert.equal(sweepDirection(B(101, 101.5, 99.5, 99.8), pdh, pdl), null, 'closed below the level: not a sweep');
  assert.equal(sweepDirection(B(101, 101.5, 100, 100.5), pdh, pdl), null, 'a touch of the level is not a sweep');
  assert.equal(sweepDirection(B(101, 101.5, 99.5, 100), pdh, pdl), null, 'a close at the level is not back above it');
  assert.equal(sweepDirection(B(105, 110.5, 99.5, 105), pdh, pdl), 'both');
});

test('break of structure: the most recent swing confirmed before the close, first close beyond it; an already-broken swing gives none', () => {
  // Highs: 101.5, 102, 103, 102.8, 102.4, 102, 103.5 (LONG_DAY): swing high at 2 (103), confirmed at the close of 5.
  const bars = [B(101, 101.5, 99.5, 100.5), B(100.5, 102, 100.2, 101.5), B(101.5, 103, 101, 102.5), B(102.5, 102.8, 101.8, 102), B(102, 102.4, 101.5, 101.7), B(101.7, 102, 101.2, 101.9), B(101.9, 103.5, 101.8, 103.2)];
  assert.equal(bosAt(bars, 5, 'long').ok, false, 'at the close of 5 the swing at 2 is confirmed, but not before that close');
  // Bar 5 closing above 103: with the swing at 2 confirmed only at that very close, it is still no BOS at 5.
  const atFive = bars.map((b, i) => (i === 5 ? B(101.7, 103.6, 101.2, 103.3) : b));
  assert.equal(bosAt(atFive, 5, 'long').ok, false, 'a swing confirmed at the close of bar k is not usable for a BOS at k');
  assert.equal(bosAt(atFive, 5, 'long').reason, 'no confirmed swing');
  const r = bosAt(bars, 6, 'long');
  assert.deepEqual([r.ok, r.swingIndex, fromU(r.level)], [true, 2, 103]);
  // If bar 5 had already closed above 103, bar 6 is not the first close beyond: no BOS.
  const broken = bars.map((b, i) => (i === 5 ? B(101.7, 103.6, 101.2, 103.3) : b));
  const r2 = bosAt(broken, 6, 'long');
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /already closed beyond/);
  // Bar 6 closing exactly at the level is not beyond it.
  assert.equal(bosAt(bars.map((b, i) => (i === 6 ? B(101.9, 103.5, 101.8, 103) : b)), 6, 'long').ok, false);
  // Short mirror on lows.
  const sb = [B(109, 110.5, 108.5, 109.5), B(109.5, 109.8, 108, 108.5), B(108.5, 109, 107, 107.5), B(107.5, 108.2, 107.2, 108), B(108, 108.5, 107.6, 108.3), B(108.3, 108.8, 108, 108.1), B(108.1, 108.2, 106.5, 106.8)];
  const s = bosAt(sb, 6, 'short');
  assert.deepEqual([s.ok, s.swingIndex, fromU(s.level)], [true, 2, 107]);
  assert.equal(bosAt(sb, 5, 'short').ok, false);
  assert.equal(bosAt(bars, 3, 'long').reason, 'no confirmed swing');
});

test('zones: the leg starts at the latest bar at the extreme; order block = latest opposite-colour bar at or before it; fair value gap = the latest gap in the leg', () => {
  const bars = [B(101, 101.5, 99.5, 100.5), B(100.5, 102, 100.2, 101.5), B(101.5, 103, 101, 102.5), B(102.5, 102.8, 101.8, 102), B(102, 102.4, 101.5, 101.7), B(101.7, 102, 101.2, 101.9), B(101.9, 103.5, 101.8, 103.2)];
  assert.equal(legExtremeIndex(bars, 0, 6, 'long'), 0);
  const tie = bars.map((b, i) => (i === 4 ? B(102, 102.4, 99.5, 101.7) : b));
  assert.equal(legExtremeIndex(tie, 0, 6, 'long'), 4, 'an equal low later in the leg moves the leg start to the later bar');
  const ob = orderBlock(bars, 0, 'long');
  assert.deepEqual([ob.index, fromU(ob.lo), fromU(ob.hi), fromU(ob.entry)], [0, 99.5, 101.5, 101.5]);
  assert.equal(orderBlock(bars.map((b, i) => (i === 0 ? B(100.5, 101.5, 99.5, 100.5) : b)), 0, 'long'), null, 'a doji is not an opposite-colour bar');
  assert.equal(orderBlock(bars, 3, 'long').index, 3, 'searched back from the leg start: bar 3 is bearish');
  assert.equal(fairValueGap(bars, 0, 6, 'long'), null, 'no three-bar gap in this leg');
  const fvg = fairValueGap(bars.map((b, i) => (i === 6 ? B(102.6, 103.5, 102.6, 103.2) : b)), 0, 6, 'long');
  assert.deepEqual([fvg.index, fromU(fvg.lo), fromU(fvg.hi), fromU(fvg.entry)], [4, 102.4, 102.6, 102.6]);
  // Two gaps: the latest (largest a) is used.
  const two = bars.map((b, i) => (i === 6 ? B(102.6, 103.5, 102.6, 103.2) : i === 2 ? B(101.5, 103, 102.1, 102.5) : b)); // also H[0] 101.5 < L[2] 102.1
  assert.equal(fairValueGap(two, 0, 6, 'long').index, 4);
  assert.equal(fairValueGap(two, 0, 4, 'long').index, 0, 'with the leg ending at bar 4 only the early gap exists');
  // Short mirror: bearish gap L[a] > H[a+2].
  const sb = [B(109, 110.5, 108.5, 109.5), B(109.5, 109.8, 108, 108.5), B(108.5, 109, 107, 107.5), B(107.5, 108.2, 107.2, 108), B(108, 108.5, 107.6, 108.3), B(108.3, 108.8, 108, 108.1), B(108.1, 108.2, 106.5, 106.8)];
  assert.equal(legExtremeIndex(sb, 0, 6, 'short'), 0);
  const sob = orderBlock(sb, 0, 'short');
  assert.deepEqual([sob.index, fromU(sob.entry)], [0, 108.5]);
  const sfvg = fairValueGap(sb.map((b, i) => (i === 6 ? B(107.4, 107.5, 106.5, 106.8) : b)), 0, 6, 'short'); // L[4] 107.6 > H[6] 107.5
  assert.deepEqual([sfvg.index, fromU(sfvg.entry)], [4, 107.5]);
});

test('stop A buffer: the median first-hour range of exactly 20 sessions in cents, rounded half up; fewer than 20 -> null', () => {
  const mk = (range) => ({ bars: Array.from({ length: 78 }, (_, i) => ({ idx: i, o: toU(100), h: toU(100 + range), l: toU(100), c: toU(100) })) });
  const twenty = Array.from({ length: 20 }, (_, i) => mk(i < 10 ? 0.2 : 0.3));
  assert.equal(fromU(bufferFromSessions(twenty)), 0.25, 'even count: the mean of the two middle values');
  assert.equal(fromU(bufferFromSessions([mk(0.1), ...twenty.slice(1)])), 0.25, '1 x 0.1, 9 x 0.2, 10 x 0.3 (12 bars each): the middle pair of 240 values is 20c and 30c');
  assert.equal(fromU(bufferFromSessions(twenty.map((s, i) => (i < 11 ? mk(0.2) : s)))), 0.2, '11 x 0.2 and 9 x 0.3: both middle values are 20c');
  const odd = Array.from({ length: 20 }, (_, i) => mk(i < 7 ? 0.11 : i < 13 ? 0.12 : 0.14));
  // 7 x 11c, 6 x 12c, 7 x 14c (each session gives 12 bars): 240 values, middle pair = 12c and 12c -> 0.12
  assert.equal(fromU(bufferFromSessions(odd)), 0.12);
  const half = Array.from({ length: 20 }, (_, i) => mk(i < 10 ? 0.11 : 0.12)); // middle pair 11c, 12c -> 11.5 -> 12
  assert.equal(fromU(bufferFromSessions(half)), 0.12, 'half a cent rounds up');
  assert.equal(bufferFromSessions(twenty.slice(1)), null, '19 sessions: no buffer');
  assert.equal(fromU(bufferFromSessions([mk(9), ...twenty])), 0.25, 'only the 20 most recent sessions count');
  // Only the first hour counts: bars 12+ with a huge range do not move the median.
  const late = twenty.map((s) => ({ bars: s.bars.map((b) => (b.idx > 11 ? { ...b, h: toU(150) } : b)) }));
  assert.equal(fromU(bufferFromSessions(late)), 0.25);
});

test('stop B: one cent beyond the second most recent swing confirmed at the close; fewer than two -> null', () => {
  const bars = [B(101, 101.5, 99.5, 100.5), B(100.5, 101.2, 100, 100.8), B(100.8, 101, 99.8, 100.6), B(100.6, 101.4, 100.3, 101.2), B(101.2, 101.8, 100.9, 101.6), B(101.6, 101.7, 100.5, 100.9), B(100.9, 101.3, 100.2, 100.7), B(100.7, 101.5, 100.6, 101.3), B(101.3, 101.9, 101, 101.7), B(101.7, 102.3, 101.4, 102.1)];
  assert.deepEqual(swingLows(bars), [2, 6]);
  const s = secondSwingStop(bars, 9, 'long');
  assert.deepEqual([s.index, fromU(s.stop)], [2, 99.79]);
  assert.equal(secondSwingStop(bars, 8, 'long'), null, 'at the close of 8 the swing at 6 is not confirmed (6 + 3 > 8)');
  const sh = bars.map((b) => ({ o: b.o, h: toU(210) - b.l, l: toU(210) - b.h, c: b.c }));
  const t = secondSwingStop(sh, 9, 'short');
  assert.deepEqual([t.index, fromU(t.stop)], [2, 110.21]);
});

test('exits: stop first on an ambiguous bar, stop checked on the fill bar but not the target, gap-through stop at the open, strict target, time stop at the last open', () => {
  const n = 78;
  const base = Array.from({ length: n }, () => B(104, 104, 104, 104));
  const stop = toU(99.3), target = toU(110);
  // Ambiguous bar 8: both the stop and the target inside it -> stop.
  let bars = base.map((b, i) => (i === 7 ? B(103.2, 103.4, 101.4, 102) : i === 8 ? B(102, 110.5, 99.2, 103.5) : b));
  assert.deepEqual(simulateExit(bars, 7, 'long', stop, target), { exitIndex: 8, exit: stop, reason: 'stop', sameBar: false });
  // Gap through the stop: exit at the open, below the stop.
  bars = base.map((b, i) => (i === 7 ? B(103.2, 103.4, 101.4, 102) : i === 8 ? B(99, 99.5, 98.5, 99.2) : b));
  assert.deepEqual(simulateExit(bars, 7, 'long', stop, target), { exitIndex: 8, exit: toU(99), reason: 'stop', sameBar: false });
  // The fill bar: the stop counts (exit at the stop itself), the target does not.
  bars = base.map((b, i) => (i === 7 ? B(103.2, 110.5, 99.2, 102) : b));
  assert.deepEqual(simulateExit(bars, 7, 'long', stop, target), { exitIndex: 7, exit: stop, reason: 'stop', sameBar: true });
  bars = base.map((b, i) => (i === 7 ? B(103.2, 110.5, 101.4, 102) : i === 9 ? B(104, 110.5, 103, 109) : b));
  assert.deepEqual(simulateExit(bars, 7, 'long', stop, target), { exitIndex: 9, exit: target, reason: 'target', sameBar: false });
  // A high exactly at the target does not fill it.
  bars = base.map((b, i) => (i === 9 ? B(104, 110, 103, 109) : b));
  assert.equal(simulateExit(bars, 7, 'long', stop, target).reason, 'time');
  // The time stop: the open of the last bar (index 77), not its close, decided after bar 76.
  bars = base.map((b, i) => (i === 77 ? B(104.5, 104.6, 104.4, 104.55) : i === 76 ? B(104, 104, 104, 104) : b));
  assert.deepEqual(simulateExit(bars, 7, 'long', stop, target), { exitIndex: 77, exit: toU(104.5), reason: 'time', sameBar: false });
  // The last bar's own range is never used for a stop or target.
  bars = base.map((b, i) => (i === 77 ? B(104.5, 120, 90, 110) : b));
  assert.deepEqual(simulateExit(bars, 7, 'long', stop, target), { exitIndex: 77, exit: toU(104.5), reason: 'time', sameBar: false });
  // A low exactly at the stop is a stop (touch), unlike the target.
  bars = base.map((b, i) => (i === 8 ? B(100, 100.5, 99.3, 100) : b));
  assert.deepEqual(simulateExit(bars, 7, 'long', stop, target), { exitIndex: 8, exit: stop, reason: 'stop', sameBar: false });
  // Short mirror: a low exactly at the target is not through it; a gap above the stop exits at the open.
  const sstop = toU(110.7), starget = toU(100);
  bars = base.map((b, i) => (i === 9 ? B(104, 105, 100, 101) : b));
  assert.equal(simulateExit(bars, 7, 'short', sstop, starget).reason, 'time');
  bars = base.map((b, i) => (i === 9 ? B(111, 111.5, 110.8, 111) : b));
  assert.deepEqual(simulateExit(bars, 7, 'short', sstop, starget), { exitIndex: 9, exit: toU(111), reason: 'stop', sameBar: false });
  // An early close: 42 bars, the time stop at index 41.
  const short = base.slice(0, 42);
  assert.equal(simulateExit(short, 7, 'long', stop, target).exitIndex, 41);
});

test('R after costs: 0.02 per side on both fills, planned risk pre-cost; 2x costs', () => {
  const c = toU(0.02);
  assert.equal(rOf('long', toU(101.5), toU(110), toU(2.2), c), 84600 / 22000);
  assert.equal(rOf('long', toU(101.5), toU(110), toU(2.2), 2 * c), 84200 / 22000);
  assert.equal(rOf('long', toU(101.5), toU(99.3), toU(2.2), c), -22400 / 22000);
  assert.equal(rOf('short', toU(108.5), toU(100), toU(2.2), c), 84600 / 22000);
  assert.equal(rOf('short', toU(108.5), toU(110.7), toU(2.2), c), -22400 / 22000);
  assert.equal(CENT, 100);
});
