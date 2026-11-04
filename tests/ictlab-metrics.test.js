// ICT Lab statistics (PROTOCOL.md sections 7 and 9) with hand-checked examples and the exact seeded outputs of the
// bootstrap and the random-entry null. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, basicStats, bootstrapInterval, nullTest, bestRemoved, monthShares, exposureByHour, criteriaOf, specMetrics, funnelOf, worstStage, SEEDS, ALPHA, TEST_BUDGET, MIN_TRADES, NULL_N, BOOTSTRAP_N } from '../server/ictlab/metrics.js';
import { toU } from '../server/ictlab/rules.js';

const close = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-9, `${msg ? `${msg}: ` : ''}${a} vs ${b}`);
const trade = (session, R, extra = {}) => ({ session, R, R2x: R - 0.02, stopDistance: 2, fillIdx: 7, holdingMinutes: 15, hoursHeld: { 10: 3 }, plannedRiskActual: 30, plannedRiskMax: 50, cashBefore: 5000, ...extra });

test('the constants are PROTOCOL.md\'s: seeds, resamples, the fixed-denominator alpha, the minimum trades', () => {
  assert.deepEqual(SEEDS, { bootstrap: 20261104, null: 20261105 });
  assert.equal(BOOTSTRAP_N, 10000);
  assert.equal(NULL_N, 10000);
  assert.equal(TEST_BUDGET, 24);
  close(ALPHA, 0.05 / 24);
  assert.ok(ALPHA > 0.00208 && ALPHA < 0.00209);
  assert.deepEqual(MIN_TRADES, { development: 100, validation: 40 });
});

test('basic figures by hand', () => {
  const s = basicStats([1, -1, 2, -0.5, 0.5]);
  assert.equal(s.n, 5);
  close(s.winRate, 0.6);
  close(s.mean, 0.4);
  close(s.median, 0.5);
  close(s.profitFactor, 3.5 / 1.5);
  close(s.maxDrawdown, 1, 'cumulative 1, 0, 2, 1.5, 2: the fall from 1 to 0');
  assert.equal(basicStats([]).mean, null);
  assert.equal(basicStats([1, 2]).profitFactor, null);
});

test('mulberry32 is the documented generator; the bootstrap is deterministic with its seed and gives the exact interval', () => {
  const r = mulberry32(1);
  assert.deepEqual([r(), r(), r()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  const s = mulberry32(SEEDS.bootstrap);
  assert.deepEqual([s(), s(), s()], [0.6865751852747053, 0.025461189216002822, 0.6606633462943137]);
  const n = mulberry32(SEEDS.null);
  assert.deepEqual([n(), n(), n()], [0.10204124473966658, 0.6270352604333311, 0.22736229840666056]);
  const vals = [1, -1, 2, -0.5, 0.5, 0.3, -0.2, 1.5, -1, 0.1];
  const a = bootstrapInterval(vals), b = bootstrapInterval(vals);
  assert.deepEqual(a, b);
  assert.deepEqual([a.resamples, a.seed], [10000, 20261104]);
  close(a.lower, -0.31, 1e-9);
  close(a.upper, 0.87, 1e-9);
  assert.notDeepEqual(bootstrapInterval(vals, { seed: 1 }), a);
  assert.deepEqual([bootstrapInterval([0.7]).lower, bootstrapInterval([0.7]).upper], [0.7, 0.7]);
  assert.equal(bootstrapInterval([]).lower, null);
});

test('the random-entry null: same bar index on a random complete session, same D, 2R, same exits and costs; p with the +1; exact seeded output', () => {
  const U = (o, h, l, c) => ({ o: toU(o), h: toU(h), l: toU(l), c: toU(c) });
  const mk = (opens) => ({ date: 'x', bars: opens.map((o, i) => U(o, o + 0.5, o - 0.5, o + (i % 2 ? 0.2 : -0.2))) });
  const sessions = [mk(Array.from({ length: 78 }, (_, i) => 100 + i * 0.1)), mk(Array.from({ length: 78 }, (_, i) => 100 - i * 0.1)), mk(Array.from({ length: 78 }, () => 100))];
  const trades = [{ fillIdx: 7, stopDistance: 1, R: 1.5 }, { fillIdx: 10, stopDistance: 2, R: -1 }];
  const r = nullTest(trades, sessions, { n: 1000, perSide: 0.02, rMultiple: 2 });
  assert.equal(r.p, 0.5454545454545454);
  assert.equal(r.atOrAbove, 545);
  assert.equal(r.actualMean, 0.25);
  close(r.nullMean, 0.2845, 1e-9);
  assert.deepEqual(r.percentiles, { p5: -1.03, p50: 0.47, p95: 1.97, p99: 1.97 });
  assert.deepEqual([r.resamples, r.seed, r.sessions], [1000, 20261105, 3]);
  // By hand, the three possible pseudo-trades of trade 1 (m = 7, D = 1): rising session enters 100.7, target 102.7
  // reached at bar 27 (high 103.2 > 102.7): R = (102.7 - 100.7 - 0.04) / 1 = 1.96; falling session enters 99.3,
  // stop 98.3 touched at bar 13 (low 98.2): exit min(98.3, open 98.7) = 98.3: R = -1.04; flat session: the time
  // stop at the last open 100: R = (100 - 100 - 0.04) = -0.04. The percentiles above are means of such values.
  assert.deepEqual(nullTest(trades, sessions, { n: 1000, perSide: 0.02, rMultiple: 2 }), r, 'deterministic');
  assert.notEqual(nullTest(trades, sessions, { n: 1000, perSide: 0.02, rMultiple: 2, seed: 1 }).atOrAbove, 545);
  assert.equal(nullTest([], sessions, { perSide: 0.02, rMultiple: 2 }).p, null);
  assert.equal(nullTest(trades, [], { perSide: 0.02, rMultiple: 2 }).p, null);
  const all = nullTest([{ fillIdx: 7, stopDistance: 1, R: 5 }], sessions, { n: 100, perSide: 0.02, rMultiple: 2 });
  assert.equal(all.atOrAbove, 0);
  close(all.p, 1 / 101);
});

test('best 5% removed: K = ceil(0.05 n), at least 1, ties to the earlier trade', () => {
  const r = bestRemoved([1, -1, 2, -0.5, 0.5]);
  assert.equal(r.K, 1);
  close(r.mean, 0);
  assert.deepEqual(r.removed, [2]);
  assert.equal(bestRemoved(Array(20).fill(0.1)).K, 1);
  assert.equal(bestRemoved(Array(21).fill(0.1)).K, 2);
  assert.equal(bestRemoved(Array(100).fill(0.1)).K, 5);
  assert.equal(bestRemoved(Array(101).fill(0.1)).K, 6);
  assert.equal(bestRemoved([]).mean, null);
});

test('monthly share of gross gains: positive R only, by the entry session month, largest compared at 1e-6', () => {
  const trades = [trade('2019-01-03', 1), trade('2019-01-10', -5), trade('2019-02-05', 0.5), trade('2019-02-20', 1), trade('2019-03-11', 0.5)];
  const m = monthShares(trades);
  close(m.grossGain, 3);
  assert.equal(m.maxMonth, '2019-02');
  close(m.maxShare, 0.5);
  assert.equal(monthShares([trade('2019-01-03', -1)]).maxShare, null);
  const e = exposureByHour([trade('2019-01-03', 1, { hoursHeld: { 10: 3, 11: 1 } }), trade('2019-01-04', 1, { hoursHeld: { 10: 1 } })]);
  assert.deepEqual(e.byHour, { 10: { bars: 4, share: 0.8 }, 11: { bars: 1, share: 0.2 } });
});

test('criteria C1-C6 with alpha = 0.05 / 24; C1 is 100 on development and 40 on validation; the candidate statement', () => {
  const base = { trades: 120, meanR: 0.3, meanR2x: 0.25, bootstrap: { lower: 0.1, upper: 0.5 }, nullTest: { p: 0.001 }, bestRemoved: { mean: 0.1 }, monthShares: { maxShare: 0.3 } };
  assert.equal(criteriaOf(base).pass, true);
  assert.equal(criteriaOf({ ...base, nullTest: { p: 0.003 } }).C4.pass, false, '0.003 is not under 0.00208');
  assert.equal(criteriaOf({ ...base, nullTest: { p: 0.0021 } }).C4.pass, false, '0.0021 is not under 0.002083');
  assert.equal(criteriaOf({ ...base, nullTest: { p: 0.002 } }).C4.pass, true);
  assert.equal(criteriaOf({ ...base, trades: 99 }).C1.pass, false);
  assert.equal(criteriaOf({ ...base, trades: 40 }, { window: 'validation' }).C1.pass, true);
  assert.equal(criteriaOf({ ...base, trades: 39 }, { window: 'validation' }).C1.pass, false);
  assert.equal(criteriaOf({ ...base, bootstrap: { lower: 0, upper: 0.5 } }).C2.pass, false, 'the lower bound must be above zero');
  assert.equal(criteriaOf({ ...base, meanR2x: 0 }).C3.pass, false);
  assert.equal(criteriaOf({ ...base, bestRemoved: { mean: 0 } }).C5.pass, false);
  assert.equal(criteriaOf({ ...base, monthShares: { maxShare: 0.4 } }).C6.pass, true, '0.40 is the maximum');
  assert.equal(criteriaOf({ ...base, monthShares: { maxShare: 0.400001 } }).C6.pass, false);
  assert.throws(() => criteriaOf(base, { window: 'reserved' }), /no criteria/);
});

test('specMetrics computes the figures, the statistics, the sizing block and the criteria from a run result', () => {
  const U = (o, h, l, c) => ({ o: toU(o), h: toU(h), l: toU(l), c: toU(c) });
  const sess = { date: 'x', bars: Array.from({ length: 78 }, () => U(100, 100.5, 99.5, 100)) };
  const trades = Array.from({ length: 12 }, (_, i) => trade(`2019-${String((i % 3) + 1).padStart(2, '0')}-1${i % 9}`, i % 3 === 2 ? -1 : 1, { fillIdx: 7, stopDistance: 2, cashCapped: i % 2 === 0, plannedRiskActual: 20 + i, cashBefore: 5000 + i }));
  const result = { spec: { name: 't' }, costPerSide: 0.02, sensitivity: 2, rMultiple: 2, sessionsInWindow: 30, trades, sessions: [], stageCounts: {}, exitCounts: { stop: 4, stop_same_bar: 0, target: 8, time: 0 }, funnel: { sessions: 30, tradeable: 28, sweeps: 20, confirmed: 15, usableZone: 14, orders: 13, fills: 12 }, counts: { cashCapped: 6, unfunded: 1, lossExceededRisk: 2, refusedConfirmations: 3 }, account: { startingCash: 5000, endingCash: 5100, maxDrawdown: 40, lowestCash: 4990 }, completeSessions: [sess] };
  const m = specMetrics(result, { nullN: 50, bootstrapN: 50 });
  assert.equal(m.trades, 12);
  close(m.meanR, 1 / 3);
  close(m.winRate, 2 / 3);
  assert.equal(m.criteria.C1.pass, false);
  assert.equal(m.candidate, false);
  assert.equal(m.sizing.cashCapped, 6);
  close(m.sizing.cashCappedShare, 0.5);
  assert.equal(m.sizing.unfunded, 1);
  assert.equal(m.sizing.lossExceededRisk, 2);
  close(m.sizing.meanPlannedRiskActual, 25.5);
  assert.equal(m.nullTest.resamples, 50);
  assert.equal(m.nullTest.sessions, 1);
  assert.equal(m.bootstrap.resamples, 50);
  close(m.costPerTrade.meanR, 0.02);
  const f = funnelOf(m.funnel);
  assert.equal(f.length, 7);
  assert.deepEqual(f[2], { stage: 'with a sweep', count: 20, lost: 8, lostShare: 8 / 28 });
  assert.equal(worstStage(f).stage, 'with a sweep');
});
