// The adopted pick rule (PROPOSED-RULES.md definitions 1-9, adopted 2026-11-02): the worked examples of
// definition 4 exactly, cents-exact comparisons, the trade count, the best-5% stress calculation with K and the
// tie order, every branch of the 0.5-point rule, and pickRuleReport on constructed runs for each outcome.
// Constructed outcomes only; nothing here is a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { outcomesOf, grossGainShare, bestFiveRemoval, pickInputs, toCents, N_COMPLETED, GROSS_GAIN_MAX, TIE_POINTS, years } from '../server/rangetrend/metrics.js';
import { tieRule, pickRuleReport } from '../server/rangetrend/pick.js';

const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const O = (symbol, pnl, { entryDate = '2020-01-01', tradeId = null, kind = 'trade' } = {}) => ({ kind, symbol, tradeId: tradeId ?? `${symbol}:${entryDate}`, entryDate, pnl });
const gg = (pairs) => grossGainShare(pairs.map(([s, p]) => O(s, p)));

test('definition 4, the worked examples exactly: {A +100, B -80, C +20}, {A +40, B +35, C +30, D -50}, two winners, all losses', () => {
  const a = gg([['A', 100], ['B', -80], ['C', 20]]);
  assert.deepEqual([a.grossGainCents, a.grossGain, a.maxSymbol, a.passes, a.undefined, a.winners], [12000, 120, 'A', false, false, 2]);
  near(a.maxShare, 100 / 120, 'A 83.3%');
  near(a.maxNetShare, 100 / 40, 'the net-based 250% is information only');
  near(a.perStock.B.share, 0, 'a losing stock counts as zero');
  assert.equal(a.perStock.B.netShare, -80 / 40);
  const b = gg([['A', 40], ['B', 35], ['C', 30], ['D', -50]]);
  assert.deepEqual([b.grossGainCents, b.maxSymbol, b.passes, b.winners], [10500, 'A', true, 3]);
  near(b.maxShare, 40 / 105, 'max 38.1%');
  near(b.maxNetShare, 40 / 55, 'the net total is 40 + 35 + 30 - 50 = 55: information only');
  near(b.perStock.A.netShare, 40 / 55);
  assert.equal(gg([['A', 10], ['B', -10]]).maxNetShare, null, 'a zero net total gives no net share');
  assert.equal(gg([['A', 10], ['B', -30]]).perStock.A.netShare, null, 'a negative net total gives no net share');
  for (const two of [[['A', 60], ['B', 40]], [['A', 50], ['B', 50]], [['A', 50], ['B', 50], ['C', -30]]]) assert.equal(gg(two).passes, false, 'two winning stocks cannot pass');
  const none = gg([['A', -10], ['B', -5]]);
  assert.deepEqual([none.grossGainCents, none.undefined, none.passes, none.maxShare, none.winners], [0, true, false, null, 0]);
  assert.deepEqual([gg([]).undefined, gg([]).passes], [true, false]);
});

test('definition 4 is compared in integer cents: 0.40 exactly passes, 0.4001 fails; amounts are rounded to the cent first', () => {
  assert.equal(gg([['A', 40], ['B', 30], ['C', 30]]).passes, true, '4000 x 100 <= 40 x 10000');
  assert.equal(gg([['A', 40.01], ['B', 29.99], ['C', 30]]).passes, false, '4001 x 100 > 40 x 10000');
  assert.equal(gg([['A', 40.004], ['B', 29.996], ['C', 30]]).passes, true, 'rounded to the cent first: 4000 of 10000');
  assert.equal(gg([['A', 40.005], ['B', 29.995], ['C', 30]]).passes, false, 'rounded to the cent first: 4001 of 10001');
  assert.equal(gg([['A', 0.4], ['B', 0.3], ['C', 0.3]]).passes, true, '40 of 100 cents');
  assert.equal(gg([['A', 1 / 3], ['B', 1 / 3], ['C', 1 / 3]]).passes, true, '33 of 99 cents');
  assert.deepEqual([toCents(40.004), toCents(40.005), toCents(29.995)], [4000, 4001, 3000]);
});

test('definitions 1-3: outcomes are completed trades (pnlTotal with post-exit dividends) plus open positions; N counts completed trades only; split_no_whole_share counts', () => {
  const result = {
    trades: [
      { tradeId: 'AAA:2020-01-02', symbol: 'AAA', entryDate: '2020-01-02', exitReason: 'rejection', pnl: 10 },
      { tradeId: 'BBB:2020-02-03', symbol: 'BBB', entryDate: '2020-02-03', exitReason: 'split_no_whole_share', pnl: -3 },
    ],
    postExit: [{ tradeId: 'AAA:2020-01-02', kind: 'dividend', amount: 5 }],
    openPositions: [{ tradeId: 'CCC:2020-03-04', symbol: 'CCC', entryDate: '2020-03-04', pnl: 50 }],
  };
  const o = outcomesOf(result);
  assert.deepEqual([o.completedTrades, o.outcomes.length, o.open.length], [2, 3, 1]);
  assert.deepEqual(o.outcomes.map((x) => [x.kind, x.symbol, x.pnl]), [['trade', 'AAA', 15], ['trade', 'BBB', -3], ['open', 'CCC', 50]], 'the dividend paid after the sale belongs to its trade; the open position is one outcome');
  // A stock whose positive P/L comes only from an open position carries the gross-gain share.
  const g = grossGainShare(o.outcomes);
  assert.deepEqual([g.maxSymbol, g.grossGainCents, g.passes], ['CCC', 6500, false]);
  near(g.perStock.CCC.share, 5000 / 6500);
  // N = 29 completed trades does not qualify, 30 does; open positions do not count toward N.
  const run = { annualisedReturnPct: 10, maxDrawdownPct: 5 }, c = { annualisedReturnPct: 5, maxDrawdownPct: 5 };
  const mk = (n, open = 0) => ({
    trades: Array.from({ length: n }, (_, i) => ({ tradeId: `S${i % 7}:${i}`, symbol: `S${i % 7}`, entryDate: `2020-01-${String(1 + (i % 28)).padStart(2, '0')}`, exitReason: i === 0 ? 'split_no_whole_share' : 'breakdown', pnl: 10 })),
    postExit: [], openPositions: Array.from({ length: open }, (_, i) => ({ tradeId: `O${i}:x`, symbol: `S${i % 7}`, entryDate: '2020-12-01', pnl: 10 })),
    equity: [{ date: '2020-01-02' }, { date: '2021-01-02' }],
  });
  assert.deepEqual([pickInputs(mk(29), { run, c, startingCash: 15000 }).enoughTrades, pickInputs(mk(29, 5), { run, c, startingCash: 15000 }).enoughTrades, pickInputs(mk(30), { run, c, startingCash: 15000 }).enoughTrades], [false, false, true]);
  assert.deepEqual([pickInputs(mk(29, 5), { run, c, startingCash: 15000 }).completedTrades, pickInputs(mk(29, 5), { run, c, startingCash: 15000 }).outcomes, N_COMPLETED, GROSS_GAIN_MAX, TIE_POINTS], [29, 34, 30, 0.4, 0.005]);
});

test('definition 6, the best-5% stress calculation: K = ceil(0.05 x n) at least 1 (n = 30: 2, 41: 3, 20: 1, 3: 1), the tie order, and adjustedAnnualised by hand', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => O(`S${i % 5}`, 100 - i, { entryDate: `2020-01-${String(1 + (i % 28)).padStart(2, '0')}`, tradeId: `t${i}` }));
  assert.deepEqual([30, 41, 20, 3, 1, 0].map((n) => bestFiveRemoval(list(n), { startingCash: 15000, years: 2, holdAnnualised: 0 }).K), [2, 3, 1, 1, 1, 1]);
  // The K highest are removed: with n = 41 the three largest (100, 99, 98).
  const r41 = bestFiveRemoval(list(41), { startingCash: 15000, years: 2, holdAnnualised: 0 });
  assert.deepEqual(r41.removed.map((x) => x.pnl), [100, 99, 98]);
  near(r41.removedPL, 297);
  // Equal P/L: the earlier entry date is removed first, then the symbol, then the trade id.
  const tied = [O('ZZ', 50, { entryDate: '2020-03-01', tradeId: 'z1' }), O('AA', 50, { entryDate: '2020-05-01', tradeId: 'a1' }), O('BB', 50, { entryDate: '2020-03-01', tradeId: 'b2' }), O('BB', 50, { entryDate: '2020-03-01', tradeId: 'b1' }), O('CC', 10), O('DD', 5)];
  const t = bestFiveRemoval(tied, { startingCash: 15000, years: 1, holdAnnualised: 0 });
  assert.equal(t.K, 1);
  assert.deepEqual(t.removed.map((x) => [x.symbol, x.tradeId]), [['BB', 'b1']], 'earliest date 2020-03-01, then symbol BB before ZZ, then trade id b1 before b2');
  const t2 = bestFiveRemoval(tied.concat(Array.from({ length: 34 }, (_, i) => O('EE', -1, { tradeId: `e${i}` }))), { startingCash: 15000, years: 1, holdAnnualised: 0 });
  assert.deepEqual([t2.K, t2.removed.map((x) => x.tradeId)], [2, ['b1', 'b2']]);
  // By hand: outcomes sum 3,000; the two removed sum 1,200; adjustedNetPL 1,800; adjustedEnd 16,800; years 2:
  // adjustedAnnualised = (16,800 / 15,000)^(1/2) - 1 = sqrt(1.12) - 1 = 0.0583005...
  const hand = [O('A', 700, { tradeId: 'a' }), O('B', 500, { tradeId: 'b' }), ...Array.from({ length: 28 }, (_, i) => O(`S${i % 4}`, 1800 / 28, { tradeId: `s${i}` }))];
  const h = bestFiveRemoval(hand, { startingCash: 15000, years: 2, holdAnnualised: 0.05 });
  assert.deepEqual([h.n, h.K], [30, 2]);
  near(h.totalPL, 3000, 'total', 1e-9);
  near(h.removedPL, 1200);
  near(h.adjustedNetPL, 1800, '', 1e-9);
  near(h.adjustedEnd, 16800, '', 1e-9);
  near(h.adjustedAnnualised, Math.sqrt(1.12) - 1);
  near(h.adjustedAnnualised, 0.0583005244258363, '', 1e-12);
  assert.equal(h.holds, true, '0.0583 > the hold\'s 0.05');
  assert.equal(bestFiveRemoval(hand, { startingCash: 15000, years: 2, holdAnnualised: 0.06 }).holds, false, 'not above the hold\'s 0.06');
  assert.equal(bestFiveRemoval(hand, { startingCash: 15000, years: 2, holdAnnualised: Math.sqrt(1.12) - 1 }).holds, false, 'equal is not above');
  // adjustedNetPL must be positive even if the annualised return would pass against a negative hold.
  const neg = bestFiveRemoval([O('A', 1200, { tradeId: 'a' }), O('B', -1300, { tradeId: 'b' })], { startingCash: 15000, years: 1, holdAnnualised: -0.5 });
  assert.deepEqual([neg.adjustedNetPL, neg.holds], [-1300, false]);
  // The same years and day-count convention as the run's own annualised return.
  near(years('2020-01-02', '2021-01-02'), 366 / 365.25);
  assert.match(h.note, /not a re-simulation/);
});

test('definition 6 as a whole: the three tests against (c) and the score; return per drawdown alone never passes', () => {
  const trades = Array.from({ length: 30 }, (_, i) => ({ tradeId: `S${i % 6}:${i}`, symbol: `S${i % 6}`, entryDate: '2020-01-02', exitReason: 'breakdown', pnl: 100 }));
  const result = { trades, postExit: [], openPositions: [], equity: [{ date: '2020-01-02' }, { date: '2022-01-02' }] };
  const c = { annualisedReturnPct: 5, maxDrawdownPct: 10 };
  const p = pickInputs(result, { run: { annualisedReturnPct: 9, maxDrawdownPct: 8 }, c, startingCash: 15000 });
  assert.deepEqual([p.enoughTrades, p.grossGain.passes, p.tests.returnTest, p.tests.drawdownTest, p.tests.robustnessTest, p.passesComparison], [true, true, true, true, true, true]);
  near(p.score, 0.04);
  near(p.bestFive.adjustedNetPL, 2800);
  // Return per drawdown alone: a higher ratio with a deeper drawdown does not pass.
  const deeper = pickInputs(result, { run: { annualisedReturnPct: 20, maxDrawdownPct: 12, returnToDrawdown: 1.67 }, c: { ...c, returnToDrawdown: 0.5 }, startingCash: 15000 });
  assert.deepEqual([deeper.tests.returnTest, deeper.tests.drawdownTest, deeper.passesComparison, deeper.score], [true, false, false, null]);
  // The robustness test is judged against (c)'s annualised return, not the run's own or another benchmark:
  // 30 outcomes of 100 less the best two leave 2,800; 17,800 / 15,000 over 2.0014 years is 8.928% a year.
  near(p.bestFive.adjustedAnnualised, Math.pow(17800 / 15000, 1 / years('2020-01-02', '2022-01-02')) - 1);
  near(p.bestFive.adjustedAnnualised, 0.08928, '', 1e-4);
  const weak = pickInputs(result, { run: { annualisedReturnPct: 9, maxDrawdownPct: 8 }, c: { annualisedReturnPct: 8.93, maxDrawdownPct: 10 }, startingCash: 15000 });
  assert.deepEqual([weak.tests.returnTest, weak.tests.robustnessTest, weak.passesComparison], [true, false, false], 'the run beats the hold (9% > 8.93%) but its stressed return (8.928%) does not');
  near(weak.bestFive.holdAnnualised, 0.0893);
  const fine = pickInputs(result, { run: { annualisedReturnPct: 9, maxDrawdownPct: 8 }, c: { annualisedReturnPct: 8.92, maxDrawdownPct: 10 }, startingCash: 15000 });
  assert.deepEqual([fine.tests.robustnessTest, fine.passesComparison], [true, true]);
  const equal = pickInputs(result, { run: { annualisedReturnPct: 5, maxDrawdownPct: 8 }, c, startingCash: 15000 });
  assert.equal(equal.tests.returnTest, false, 'strictly above');
});

test('definition 8, every branch of the 0.5-point rule: unique top; T0 of two decided by drawdown; drawdowns within 0.005 decided by trade count; a final tie gives NONE; a chain 0.004 apart does not tie the third', () => {
  const v = (version, score, maxDrawdown, completedTrades = 30) => ({ version, score, maxDrawdown, completedTrades });
  const unique = tieRule([v('a', 0.03, 0.1), v('b', 0.02, 0.05)]);
  assert.deepEqual([unique.chosen.version, unique.T0.length, unique.T1], ['a', 1, null]);
  const byDrawdown = tieRule([v('a', 0.030, 0.10), v('b', 0.026, 0.08)]);
  assert.deepEqual([byDrawdown.chosen.version, byDrawdown.T0.map((r) => r.version), byDrawdown.T1.map((r) => r.version)], ['b', ['a', 'b'], ['b']]);
  const byTrades = tieRule([v('a', 0.030, 0.084, 35), v('b', 0.026, 0.080, 31)]);
  assert.deepEqual([byTrades.chosen.version, byTrades.T1.map((r) => r.version), byTrades.T2.map((r) => r.version)], ['a', ['a', 'b'], ['a']]);
  const none = tieRule([v('a', 0.030, 0.084, 31), v('b', 0.026, 0.080, 31)]);
  assert.deepEqual([none.chosen, none.T2.length], [null, 2]);
  assert.match(none.reason, /NONE advances/);
  const chain = tieRule([v('a', 0.030, 0.10), v('b', 0.026, 0.10), v('c', 0.022, 0.05)]);
  assert.deepEqual(chain.T0.map((r) => r.version), ['a', 'b'], 'c is 0.008 below the top although 0.004 below b: no chaining');
  assert.equal(chain.chosen, null, 'a and b tie on drawdown and trades: NONE');
  const edge = tieRule([v('a', 0.030, 0.10), v('b', 0.025, 0.05)]);
  assert.deepEqual([edge.T0.length, edge.chosen.version], [2, 'b'], 'exactly 0.005 below the top is within the tie');
  const dd = tieRule([v('a', 0.030, 0.085, 30), v('b', 0.028, 0.080, 30)]);
  assert.deepEqual([dd.T1.length, dd.chosen], [2, null], 'a drawdown exactly 0.005 above the smallest is within the tie; equal trades: NONE');
  assert.deepEqual([tieRule([]).chosen, tieRule([]).T0], [null, []]);
});

test('pickRuleReport on constructed runs: each outcome, including NONE with each reason; a report only', () => {
  const run = (version, { status = 'done', error = null, trades = 30, gross = true, tests = { returnTest: true, drawdownTest: true, robustnessTest: true }, score = 0.02, dd = 0.1 } = {}) => ({
    version, configFile: `${version}.json`, status, error,
    metrics: { pick: { completedTrades: trades, grossGain: { passes: gross, maxShare: 0.3, maxSymbol: 'A', undefined: false }, tests, passesComparison: Object.values(tests).every(Boolean), score: Object.values(tests).every(Boolean) ? score : null, maxDrawdown: dd, annualised: 0.05 + score, holdAnnualised: 0.05, bestFive: { K: 2, adjustedNetPL: 1, adjustedAnnualised: 0.06, holds: tests.robustnessTest } } },
  });
  const eight = (f) => Array.from({ length: 8 }, (_, i) => f(i));
  const few = pickRuleReport(eight((i) => run(`v${i}`)).slice(0, 3));
  assert.deepEqual([few.outcome.chosen, few.rows.length], [null, 3]);
  assert.match(few.outcome.reason, /not all 8 practice runs are recorded \(3 of 8\)/);
  const noneQualify = pickRuleReport(eight((i) => run(`v${i}`, { trades: 29 })));
  assert.match(noneQualify.outcome.reason, /no run qualifies/);
  assert.ok(noneQualify.rows.every((r) => !r.qualified && r.why[0] === '29 completed trades, fewer than 30'));
  const gross = pickRuleReport(eight((i) => run(`v${i}`, { gross: false })));
  assert.match(gross.outcome.reason, /no run qualifies/);
  assert.match(gross.rows[0].why[0], /gross-gain share 30.0% \(A\) above 40%/);
  const errored = pickRuleReport(eight((i) => run(`v${i}`, i === 0 ? { error: 'metrics failed: x' } : { trades: 29 })));
  assert.deepEqual([errored.rows[0].recorded, errored.rows[0].why[0]], [false, 'recorded with an error: metrics failed: x']);
  const nonePass = pickRuleReport(eight((i) => run(`v${i}`, { tests: { returnTest: true, drawdownTest: false, robustnessTest: true } })));
  assert.match(nonePass.outcome.reason, /no qualified run passes/);
  assert.deepEqual(nonePass.rows[0].why, ['maximum drawdown deeper than the exposure-matched hold']);
  const chosen = pickRuleReport(eight((i) => run(`v${i}`, { score: i === 3 ? 0.05 : 0.02 })));
  assert.deepEqual([chosen.outcome.chosen, chosen.passing.length, chosen.T0], ['v3', 8, ['v3']]);
  const tie = pickRuleReport(eight((i) => run(`v${i}`, { score: i < 2 ? 0.05 : 0.02, dd: 0.1, trades: 30 })));
  assert.deepEqual([tie.outcome.chosen, tie.T0, tie.T1, tie.T2], [null, ['v0', 'v1'], ['v0', 'v1'], ['v0', 'v1']]);
  assert.match(tie.outcome.reason, /NONE advances/);
  const byDd = pickRuleReport(eight((i) => run(`v${i}`, { score: i < 2 ? 0.05 : 0.02, dd: i === 1 ? 0.08 : 0.1 })));
  assert.deepEqual([byDd.outcome.chosen, byDd.T1], ['v1', ['v1']]);
  // Only qualified and passing variants reach the tie rule; the mixed case still picks across both families.
  const mixed = pickRuleReport(eight((i) => run(`v${i}`, i === 7 ? { score: 0.09, trades: 29 } : { score: i === 2 ? 0.04 : 0.01 })));
  assert.deepEqual([mixed.outcome.chosen, mixed.rows[7].qualified], ['v2', false], 'the best score of an unqualified run does not count');
  assert.match(chosen.note, /report only/);
  const input = eight((i) => run(`v${i}`));
  const before = JSON.stringify(input);
  pickRuleReport(input);
  assert.equal(JSON.stringify(input), before, 'the input is not mutated');
});
