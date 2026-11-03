// sweep-bos statistics (PRE-REGISTRATION.md sections 5 and 6) with hand-checked examples: the figures, the
// bootstrap, the random-direction null, the best-5% removal, the monthly share, the criteria and the pick rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, basicStats, bootstrapInterval, nullTest, bestRemoved, monthShares, exposureByHour, criteriaOf, instrumentMetrics, pooledMetrics, isCandidate, pickRule, SEEDS, TIE_R } from '../server/sweepbos/metrics.js';

const close = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-9, `${msg ? `${msg}: ` : ''}${a} vs ${b}`);
const trade = (session, R, extra = {}) => ({ session, R, R2x: R - 0.02, risk: 2, holdingMinutes: 15, hoursHeld: { 10: 3 }, mirror: { R: -R }, dir: 'long', symbol: 'QQQ', ...extra });

test('basic figures by hand: win rate, mean, median, profit factor, maximum drawdown in exit order', () => {
  const s = basicStats([1, -1, 2, -0.5, 0.5]);
  assert.equal(s.n, 5);
  close(s.winRate, 0.6);
  close(s.mean, 0.4);
  close(s.median, 0.5);
  close(s.grossGain, 3.5);
  close(s.grossLoss, 1.5);
  close(s.profitFactor, 3.5 / 1.5);
  close(s.maxDrawdown, 1, 'cumulative 1, 0, 2, 1.5, 2: the fall from 1 to 0');
  close(basicStats([1, 2, 3, 4]).median, 2.5);
  assert.equal(basicStats([1, 2]).profitFactor, null, 'no loss: undefined');
  assert.equal(basicStats([]).mean, null);
  close(basicStats([-1, -1, 3]).maxDrawdown, 2);
});

test('mulberry32 is the documented generator and the bootstrap is deterministic with its seed', () => {
  // The exact outputs of the generator defined in PRE-REGISTRATION.md section 6 (a = seed; a += 0x6D2B79F5; ...).
  const r = mulberry32(1);
  assert.deepEqual([r(), r(), r(), r(), r()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849]);
  const s = mulberry32(SEEDS.bootstrap);
  assert.deepEqual([s(), s(), s()], [0.24271581135690212, 0.5461220773868263, 0.7796479605603963]);
  assert.notEqual(mulberry32(2)(), 0.6270739405881613);
  const one = bootstrapInterval([0.7]);
  assert.deepEqual([one.lower, one.upper, one.resamples, one.seed], [0.7, 0.7, 10000, SEEDS.bootstrap]);
  const vals = [1, -1, 2, -0.5, 0.5, 0.3, -0.2, 1.5, -1, 0.1];
  const a = bootstrapInterval(vals), b = bootstrapInterval(vals);
  assert.deepEqual(a, b);
  // The exact interval the seeded generator gives for these ten values (the 250th and 9,750th resample means).
  close(a.lower, -0.3, 'lower bound with seed 20261103');
  close(a.upper, 0.87, 'upper bound with seed 20261103');
  const m = basicStats(vals).mean;
  assert.ok(a.lower <= m && m <= a.upper);
  assert.ok(a.lower < a.upper);
  assert.notDeepEqual(bootstrapInterval(vals, { seed: 1 }), a, 'another seed gives another interval');
  // Fewer resamples: the documented indices (floor(0.025 n) and ceil(0.975 n) - 1).
  const small = bootstrapInterval([1, 2, 3], { n: 40 });
  assert.ok(small.lower >= 1 && small.upper <= 3);
});

test('random-direction null: p from simulations at or above the actual mean; all-mirror-equal gives p = 1; deterministic', () => {
  const same = nullTest([1, 1, 1], [1, 1, 1]);
  assert.equal(same.p, 1);
  assert.equal(same.atOrAbove, 1000);
  const flip = nullTest([1], [-1]);
  assert.ok(flip.p > 0.4 && flip.p < 0.6, `one trade, R 1 or -1 at random: p about 0.5 (${flip.p})`);
  assert.deepEqual(nullTest([1], [-1]), flip);
  const good = nullTest(Array(60).fill(1), Array(60).fill(-1));
  assert.ok(good.p < 0.05, `sixty wins whose mirrors all lose: p ${good.p}`);
  assert.equal(good.atOrAbove, 0, 'no random assignment reaches a mean of 1');
  close(good.p, 1 / 1001);
  assert.ok(good.percentiles.p99 < 1 && good.percentiles.p5 > -1);
  assert.equal(nullTest([], []).p, null);
  assert.equal(nullTest([1, 2], [1]).p, null, 'mirrors must match the trades');
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
  const tie = bestRemoved([2, 2, 2, -1]);
  assert.equal(tie.K, 1);
  close(tie.mean, 1);
  assert.equal(bestRemoved([]).mean, null);
});

test('monthly share of gross gains: positive R only, by the entry session month, largest compared at 1e-6', () => {
  const trades = [trade('2019-01-03', 1), trade('2019-01-10', -5), trade('2019-02-05', 0.5), trade('2019-02-20', 1), trade('2019-03-11', 0.5)];
  const m = monthShares(trades);
  close(m.grossGain, 3);
  assert.equal(m.maxMonth, '2019-02');
  close(m.maxShare, 0.5);
  assert.deepEqual(m.shares.map((s) => [s.month, s.gain]), [['2019-01', 1], ['2019-02', 1.5], ['2019-03', 0.5]]);
  assert.equal(monthShares([trade('2019-01-03', -1)]).maxShare, null);
  const e = exposureByHour([trade('2019-01-03', 1, { hoursHeld: { 10: 3, 11: 1 } }), trade('2019-01-04', 1, { hoursHeld: { 10: 1 } })]);
  assert.deepEqual(e.byHour, { 10: { bars: 4, share: 0.8 }, 11: { bars: 1, share: 0.2 } });
});

test('criteria C1-C6 on a synthetic instrument result, the candidate test and the pick rule', () => {
  const mk = (rs, mirrors, months) => ({ symbol: 'QQQ', sessionsInWindow: rs.length, costPerSide: 0.02, stageCounts: {}, outcomeCounts: {}, account: {}, trades: rs.map((R, i) => trade(`${months[i % months.length]}-${String((i % 20) + 1).padStart(2, '0')}`, R, { mirror: { R: mirrors[i] } })) });
  // 120 trades, 80 wins of 1 R and 40 losses of -1 R, mirrors the opposite, spread over 12 months: every criterion passes.
  const months = Array.from({ length: 12 }, (_, i) => `2019-${String(i + 1).padStart(2, '0')}`);
  const rs = Array.from({ length: 120 }, (_, i) => (i % 3 === 2 ? -1 : 1));
  const good = instrumentMetrics(mk(rs, rs.map((r) => -r), months));
  assert.equal(good.trades, 120);
  close(good.meanR, 1 / 3);
  close(good.winRate, 2 / 3);
  assert.equal(good.criteria.pass, true, JSON.stringify(good.criteria));
  assert.equal(good.criteria.C1.pass && good.criteria.C2.pass && good.criteria.C3.pass && good.criteria.C4.pass && good.criteria.C5.pass && good.criteria.C6.pass, true);
  // C1: 99 trades fail.
  assert.equal(instrumentMetrics(mk(rs.slice(0, 99), rs.slice(0, 99).map((r) => -r), months)).criteria.C1.pass, false);
  // C6: every win in one month.
  const oneMonth = instrumentMetrics(mk(rs, rs.map((r) => -r), ['2019-05']));
  assert.equal(oneMonth.criteria.C6.pass, false);
  close(oneMonth.monthShares.maxShare, 1);
  // C4: mirrors equal to the trades give p = 1.
  assert.equal(instrumentMetrics(mk(rs, rs, months)).criteria.C4.pass, false);
  // C5: one huge win carrying a losing book.
  const skew = rs.map((r, i) => (i === 0 ? 60 : -0.4));
  const sk = instrumentMetrics(mk(skew, skew.map((r) => -r), months));
  assert.ok(sk.meanR > 0);
  assert.equal(sk.criteria.C5.pass, false);
  // C3: a thin edge that 2x costs erases (R2x = R - 0.02 in the fixture).
  const thin = mk(rs.map((r) => (r > 0 ? 0.52 : -1)), rs.map((r) => -r), months);
  for (const t of thin.trades) t.R2x = t.R - 0.05;
  const th = instrumentMetrics(thin);
  assert.ok(th.meanR > 0 && th.meanR2x < 0);
  assert.equal(th.criteria.C3.pass, false);
  assert.equal(criteriaOf(good).pass, true);
  assert.equal(isCandidate({ QQQ: good, SPY: good }), true);
  assert.equal(isCandidate({ QQQ: good, SPY: oneMonth }), false, 'both instruments must pass');
  // Pooled figures in exit order across instruments.
  const pooled = pooledMetrics([{ trades: [trade('2019-01-03', 1, { symbol: 'SPY' })] }, { trades: [trade('2019-01-03', -2, { symbol: 'QQQ' }), trade('2019-01-04', 0.5, { symbol: 'QQQ' })] }]);
  assert.equal(pooled.trades, 3);
  close(pooled.meanR, -0.5 / 3);
  close(pooled.maxDrawdownR, 2, 'QQQ -2 comes before SPY +1 on the same session');
  // The pick rule.
  const v = (name, candidate, meanR, dd) => ({ name, candidate, pooled: { meanR, maxDrawdownR: dd } });
  assert.equal(pickRule([v('a', false, 0.5, 1), v('b', false, 0.4, 1)]).pick, null);
  assert.equal(pickRule([v('a', true, 0.30, 5), v('b', true, 0.27, 1)]).pick, 'a');
  assert.equal(pickRule([v('a', true, 0.30, 5), v('b', true, 0.29, 3)]).pick, 'b', 'within 0.02 R: the smaller drawdown');
  assert.equal(pickRule([v('a', true, 0.30, 5), v('b', true, 0.28, 3)]).pick, 'b', 'exactly 0.02 apart is a tie');
  assert.equal(pickRule([v('a', true, 0.30, 5), v('b', true, 0.2799, 3)]).pick, 'a');
  assert.equal(pickRule([v('a', true, 0.30, 3), v('b', true, 0.30, 3), v('c', false, 0.9, 0)]).pick, null, 'tied on both: NONE; a non-candidate never wins');
  assert.equal(pickRule([v('a', true, 0.30, 3), v('b', true, 0.29, 3), v('c', true, 0.27, 1)]).pick, null, 'a and b tie at the minimum drawdown of the tied set; c is outside the tie');
  assert.equal(TIE_R, 0.02);
  assert.equal(pickRule([]).reason, 'no variant qualifies on both instruments: NONE advances');
});
