// HXR metrics, comparisons, criteria and selection (strategy/hxr/ENGINE-SPEC.md
// section 7, criteria-hxr-v1.json, PREREGISTRATION.md sections 8 and 10).
// Hand-made equity curves and hand-computed engine paths only; no market data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBacktest, periodSessions } from '../server/hxr/engine.js';
import {
  computeRunMetrics, compareArms, fillComparison, evaluateCriteria, selectCandidate, maxDrawdown, timesHoldThreshold, PASS_MEANING,
} from '../server/hxr/metrics.js';

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const C3 = json('../strategy/hxr/configs/hxr-c3-0.1.0.json');
const CRITERIA = json('../strategy/hxr/criteria-hxr-v1.json');
const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const K = 0.0004;

// A minimal engine result: equity rows [date, equity, cash, sleevesOut].
function fake(rows, extra = {}, { basket = ['A'], start = 100 } = {}) {
  return {
    meta: { startingCash: start, basket },
    equity: rows.map(([date, equity, cash = 0, out = 0]) => ({
      date, equity, cash, invested: equity - cash, sleevesOut: out, receivable: 0,
      sleeves: Object.fromEntries(basket.map((s) => [s, { cash: cash / basket.length, value: (equity - cash) / basket.length, equity: equity / basket.length, out: out > 0 }])),
    })),
    fills: [], decisions: [], episodes: [], roundTrips: [], openExits: [], dividends: [], splits: [], warnings: [], pendingAtEnd: [], receivables: [],
    sleeves: basket.map((s) => ({ symbol: s, startCash: start / basket.length })),
    ...extra,
  };
}

function path(config, paths, { start = '2024-03-04' } = {}) {
  const n = Math.max(...Object.values(paths).map((r) => r.length));
  const dates = periodSessions({ warmupFrom: start, end: '2024-12-31' }).slice(0, n);
  const days = new Map(dates.map((d, i) => [d, {
    bars: Object.fromEntries(Object.entries(paths).filter(([, rows]) => rows[i] != null).map(([s, rows]) => {
      const r = rows[i];
      const [o, c, vw15] = Array.isArray(r) ? r : [r.o, r.c, r.vw15];
      return [s, { o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1, vw15: vw15 ?? null }];
    })),
  }]));
  return runBacktest({ config, symbols: Object.keys(paths).map((s) => ({ symbol: s, listedFrom: '2016-01-04' })), period: { warmupFrom: start, start, end: dates.at(-1) }, inputs: { sessions: dates, days, halfSpreadBps: () => 2 } });
}

// ---------- returns and declines ----------

test('largest decline: peak from the start value, peak/trough/recovery dates', () => {
  const pts = [['2020-01-02', 110], ['2020-01-03', 99], ['2020-01-06', 88], ['2020-01-07', 120], ['2020-01-08', 90], ['2020-01-09', 121]].map(([date, equity]) => ({ date, equity }));
  const d = maxDrawdown(pts, 100);
  near(d.maxDrawdownPct, 25); // 120 -> 90, larger than 110 -> 88 (20%)
  assert.deepEqual([d.peakDate, d.troughDate, d.recoveryDate, d.peakIsStartValue], ['2020-01-07', '2020-01-08', '2020-01-09', false]);
  near(d.maxDrawdownUsd, 30);
  const noRecovery = maxDrawdown(pts.slice(0, 5), 100);
  assert.equal(noRecovery.recoveryDate, null);
  // a fall from the first open counts: the peak is the starting value
  const s = maxDrawdown([['2020-01-02', 90], ['2020-01-03', 95], ['2020-01-06', 101]].map(([date, equity]) => ({ date, equity })), 100);
  near(s.maxDrawdownPct, 10);
  assert.deepEqual([s.peakDate, s.troughDate, s.recoveryDate, s.peakIsStartValue], ['2020-01-02', '2020-01-02', '2020-01-06', true]);
  assert.equal(maxDrawdown([{ date: '2020-01-02', equity: 101 }, { date: '2020-01-03', equity: 102 }], 100).maxDrawdownPct, 0);
});

test('annualised return over exactly 4 years, return-to-drawdown, totals', () => {
  const m = computeRunMetrics(fake([['2020-01-01', 100], ['2022-01-03', 80], ['2024-01-01', 146.41]]), { startValue: 100 });
  assert.equal(m.years, 4); // 1461 days / 365.25
  near(m.totalReturnPct, 46.41);
  near(m.annualisedReturnPct, 10, 'annualised', 1e-9);
  near(m.maxDrawdownPct, 20);
  near(m.returnToDrawdown, 0.5, 'return to drawdown', 1e-9);
  assert.deepEqual([m.sessions, m.firstDate, m.lastDate, m.endValue, m.startValue], [3, '2020-01-01', '2024-01-01', 146.41, 100]);
  const flat = computeRunMetrics(fake([['2020-01-01', 101], ['2021-01-01', 102]]));
  assert.equal(flat.maxDrawdownPct, 0);
  assert.equal(flat.returnToDrawdown, null); // undefined without a decline
});

test('time in cash is weighted by money; sleeve time out counts sleeve-sessions', () => {
  const m = computeRunMetrics(fake([['2024-03-04', 100, 50, 1], ['2024-03-05', 200, 0, 0]], {}, { basket: ['A', 'B'] }));
  near(m.timeInCashPct, (50 / 300) * 100); // not the 25% a plain average of 50% and 0% would give
  near(m.sleeveTimeOutPct, 25); // 1 of 4 sleeve-sessions
  assert.deepEqual(m.perStock.map((s) => [s.symbol, s.timeOutPct]), [['A', 50], ['B', 50]]);
});

// ---------- missed rebounds, declines avoided, losses after buying back ----------

test('missed rebounds and declines avoided from round trips; open exits valued at the last close', () => {
  const m = computeRunMetrics(fake([['2024-03-04', 100]], {
    roundTrips: [
      { symbol: 'A', exitDate: '2024-01-02', changePct: 5, dollars: 50, largestRiseWhileOutPct: 12 },
      { symbol: 'A', exitDate: '2024-02-02', changePct: -3, dollars: -30, largestRiseWhileOutPct: 2 },
      { symbol: 'A', exitDate: '2024-02-20', changePct: 0, dollars: 0, largestRiseWhileOutPct: 0 },
    ],
    openExits: [{ symbol: 'A', exitDate: '2024-03-01', changePct: 1, dollars: 7, largestRiseWhileOutPct: 20 }],
  }));
  assert.deepEqual(m.missedRebounds.reboundsMissed, { count: 1, dollars: 50 });
  assert.deepEqual(m.missedRebounds.declinesAvoided, { count: 2, dollars: -30, saved: 30 }, 'dollars as ENGINE-SPEC defines it (buy-back minus exit); saved is the same amount, positive');
  assert.deepEqual(m.missedRebounds.openExits, { count: 1, dollars: 7 });
  assert.equal(m.missedRebounds.largestRiseWhileOut.pct, 20);
  assert.equal(m.missedRebounds.largestRiseWhileOut.exitDate, '2024-03-01');
  assert.deepEqual([m.roundTrips, m.exitsWithoutBuyBack], [3, 1]);
});

test('engine path: a decline avoided, a loss after buying back, an open exit, costs and episodes', () => {
  // C3: exit 03-07 (96 <= 120 x 0.8) filled 03-08 at 95; buy back 03-13 (92 >= 80 x 1.15)
  // filled 03-14 at 93; exit 03-18 (75 <= 94 x 0.8) filled 03-19 at 74, below the buy-back.
  const r = path(C3, { A: [[100, 100], [110, 120], [100, 97], [97, 96], [95, 90], [85, 80], [81, 91.9], [92, 92], [93, 94], [90, 76], [76, 75], [74, 74]] });
  const m = computeRunMetrics(r);
  assert.deepEqual([m.buys, m.sells, m.initialBuys, m.roundTrips, m.exitsWithoutBuyBack, m.pendingAtEnd], [1, 2, 1, 1, 1, 0]);
  const exit1 = 95 * (1 - K), bb = 93 * (1 + K), exit2 = 74 * (1 - K);
  assert.equal(m.missedRebounds.declinesAvoided.count, 1);
  near(m.missedRebounds.declinesAvoided.dollars, 149 * (bb - exit1), 'decline avoided', 1e-9);
  assert.equal(m.missedRebounds.reboundsMissed.count, 0);
  near(m.missedRebounds.openExits.dollars, 153 * (74 - exit2), 'open exit at the last close', 1e-9);
  const fees2 = 2.06e-5 * 153 * exit2 + 153 * 0.000166;
  const pnl2 = 153 * exit2 - fees2 - 153 * bb;
  assert.equal(m.lossesAfterBuyBack.count, 1);
  near(m.lossesAfterBuyBack.dollars, pnl2, 'loss after buying back', 1e-9);
  near(m.lossesAfterBuyBack.priceLoss, 153 * (exit2 - bb), 'price loss', 1e-9);
  // costs: spread and slippage on all four sides, SEC + TAF on two sells
  const fees1 = 2.06e-5 * 149 * exit1 + 149 * 0.000166;
  near(m.costs.spreadSlippage, 149 * 100 * K + 149 * 95 * K + 153 * 93 * K + 153 * 74 * K, 'spread', 1e-9);
  near(m.costs.fees, fees1 + fees2, 'fees', 1e-12);
  near(m.costs.total, m.costs.spreadSlippage + m.costs.fees);
  // two holdings, both losers; nothing open at the end (the sleeve is in cash)
  assert.deepEqual([m.episodes.count, m.episodes.closed, m.episodes.open, m.episodes.winners, m.episodes.losers], [2, 2, 0, 0, 2]);
  const pnl1 = 149 * exit1 - fees1 - 149 * 100 * (1 + K);
  near(m.episodes.avgLoss, (pnl1 + pnl2) / 2, 'avg loss', 1e-9);
  near(m.episodes.avgLossPct, ((pnl1 / (149 * 100 * (1 + K))) * 100 + (pnl2 / (153 * bb)) * 100) / 2, 'avg loss %', 1e-9);
  assert.equal(m.episodes.avgGain, null);
  assert.deepEqual([m.episodes.openPnl, m.episodes.openWinners, m.episodes.openLosers], [0, 0, 0]);
  near(m.episodes.closedPnl, pnl1 + pnl2, 'closed P/L', 1e-9);
  const ps = m.perStock[0];
  near(ps.endValue, m.endValue); near(ps.pnl, m.endValue - 15000);
  assert.deepEqual([ps.roundTrips, ps.exitsWithoutBuyBack, ps.buys, ps.sells], [1, 1, 1, 2]);
});

test('average gains and losses count completed holdings only; open ones are reported apart', () => {
  // The hold never sells: both holdings are open at the end, one up and one down.
  const hold = json('../strategy/hxr/configs/hxr-hold-0.1.0.json');
  const r = path(hold, { A: [[100, 100], [110, 120], [120, 130]], B: [[50, 50], [48, 45], [44, 40]] });
  const m = computeRunMetrics(r);
  assert.deepEqual([m.episodes.count, m.episodes.closed, m.episodes.open], [2, 0, 2]);
  assert.deepEqual([m.episodes.winners, m.episodes.losers, m.episodes.flat, m.episodes.avgGain, m.episodes.avgLoss], [0, 0, 0, null, null], 'nothing completed: no average');
  assert.deepEqual([m.episodes.openWinners, m.episodes.openLosers], [1, 1]);
  const open = r.episodes.filter((e) => e.open);
  near(m.episodes.openPnl, open[0].pnl + open[1].pnl, 'open P/L');
  near(m.episodes.totalPnl, m.episodes.openPnl + m.episodes.closedPnl, 'total');
  assert.equal(m.episodes.closedPnl, 0);
});

test('compareArms: HXR minus hold and the ratios the criteria use', () => {
  const hxr = { endValue: 120, annualisedReturnPct: 8, maxDrawdownPct: 15, returnToDrawdown: 8 / 15, costs: { total: 30 }, dividends: { net: 5 }, perStock: [{ symbol: 'A', pnl: 20 }] };
  const hold = { endValue: 130, annualisedReturnPct: 10, maxDrawdownPct: 30, returnToDrawdown: 1 / 3, costs: { total: 4 }, dividends: { net: 9 }, perStock: [{ symbol: 'A', pnl: 30 }] };
  const c = compareArms(hxr, hold);
  assert.deepEqual(c.endValue, { hxr: 120, hold: 130, diff: -10 });
  assert.equal(c.annualisedReturnPct.diff, -2);
  near(c.ratios.maxDrawdown, 0.5); near(c.ratios.returnToDrawdown, 1.6);
  assert.deepEqual(c.costs, { hxr: 30, hold: 4, diff: 26 });
  assert.deepEqual(c.perStock, [{ symbol: 'A', hxrPnl: 20, holdPnl: 30, diff: -10 }]);
});

// ---------- fill comparison ----------

test('fill comparison: assumed open fills vs first-15-minute VWAP fills, matched by id', () => {
  const paths = {
    A: [{ o: 100, c: 100, vw15: 101 }, [100, 80], { o: 82, c: 80, vw15: null }],
    B: [{ o: 50, c: 50, vw15: 49.9 }, [50, 40], { o: 41, c: 40, vw15: 40.8 }],
  };
  const open = path(C3, paths);
  const vw = path({ ...C3, execution: { ...C3.execution, fillModel: 'vw15' } }, paths);
  const f = fillComparison(open, vw);
  const d = [
    (Math.abs(101 * 1.0002 - 100 * (1 + K)) / (100 * (1 + K))) * 1e4,
    (Math.abs(49.9 * 1.0002 - 50 * (1 + K)) / (50 * (1 + K))) * 1e4,
    (Math.abs(40.8 * 0.9998 - 41 * (1 - K)) / (41 * (1 - K))) * 1e4,
  ];
  assert.deepEqual([f.matched, f.unmatched, f.fillsWithoutVw15], [3, 0, 1]); // A's sell had no VWAP: counted, not averaged
  near(f.medianAbsDiffBps, [...d].sort((a, b) => a - b)[1]);
  near(f.meanAbsDiffBps, (d[0] + d[1] + d[2]) / 3);
  near(f.endValueDiff, vw.equity.at(-1).equity - open.equity.at(-1).equity);
  assert.equal(computeRunMetrics(vw).vw15Missing, 1);
});

// ---------- criteria G1-G6 ----------

const M = (o) => ({ sessions: 960, roundTrips: 25, maxDrawdownPct: 20, returnToDrawdown: 0.6, annualisedReturnPct: 12, perStock: Array(5).fill({}), ...o });
const HOLDM = (o) => ({ sessions: 960, roundTrips: 0, maxDrawdownPct: 40, returnToDrawdown: 0.4, annualisedReturnPct: 16, perStock: Array(5).fill({}), ...o });
const LOO = (fails = 1) => ['MU', 'AMZN', 'META', 'TSLA', 'VST'].map((left, i) => ({ left, hxr: M({ returnToDrawdown: i < fails ? 0.43 : 0.5 }), hold: HOLDM() }));
function runs(o = {}) {
  return {
    main: { hxr: M(o.hxr), hold: HOLDM(o.hold) },
    costs2x: { hxr: M({ maxDrawdownPct: 22, returnToDrawdown: 0.5, ...o.costs2x }), hold: HOLDM() },
    delay2: { hxr: M({ maxDrawdownPct: 25, returnToDrawdown: 0.45, ...o.delay2 }), hold: HOLDM() },
    leaveOneOut: LOO(o.looFails ?? 1),
    contaminated: o.contaminated ?? false,
  };
}
const statuses = (e) => Object.fromEntries(e.criteria.map((c) => [c.id, c.status]));

test('criteria: every gate passes -> PASS, which means review only, never permission to trade', () => {
  const e = evaluateCriteria(CRITERIA, runs());
  assert.deepEqual(statuses(e), { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass', G5: 'pass', G6: 'pass' });
  assert.equal(e.outcome, 'PASS');
  assert.equal(e.meaning, PASS_MEANING);
  assert.match(e.meaning, /never permission to trade/);
  assert.equal(e.contaminated, false);
  const g2 = e.criteria.find((c) => c.id === 'G2');
  near(g2.value.limit, 30); // 0.75 x 40
  near(e.criteria.find((c) => c.id === 'G3').value.limit, 0.44); // 1.1 x 0.4
  near(e.criteria.find((c) => c.id === 'G4').value.limit, 11); // 16 - 5
  assert.deepEqual(e.criteria.find((c) => c.id === 'G6').value.passing, 4);
});

test('criteria: each single failing gate makes the outcome FAIL', () => {
  const cases = {
    G2: runs({ hxr: { maxDrawdownPct: 31 } }), // > 0.75 x 40
    G3: runs({ hxr: { returnToDrawdown: 0.43 } }), // < 1.1 x 0.4
    G4: runs({ hxr: { annualisedReturnPct: 10.9 } }), // < 16 - 5
    G5: runs({ costs2x: { returnToDrawdown: 0.43 } }), // G3 fails with costs doubled
    G6: runs({ looFails: 2 }), // G3 passes in 3 of 5
  };
  for (const [gate, r] of Object.entries(cases)) {
    const e = evaluateCriteria(CRITERIA, r);
    const s = statuses(e);
    assert.equal(s[gate], 'fail', gate);
    assert.deepEqual(Object.entries(s).filter(([, v]) => v !== 'pass').map(([k]) => k), [gate], `${gate} is the only failure`);
    assert.equal(e.outcome, 'FAIL', gate);
    assert.match(e.meaning, /never permission to trade/);
  }
  const delay = evaluateCriteria(CRITERIA, runs({ delay2: { maxDrawdownPct: 31 } }));
  assert.equal(statuses(delay).G5, 'fail');
  assert.deepEqual(delay.criteria.find((c) => c.id === 'G5').value.delay2.G2, 'fail');
});

test('criteria: G1 not met -> INSUFFICIENT_EVIDENCE, whatever the other gates say', () => {
  for (const r of [runs({ hxr: { sessions: 499 } }), runs({ hxr: { roundTrips: 19 } }), runs({ hold: { maxDrawdownPct: 19.9, returnToDrawdown: 0.8 } })]) {
    const e = evaluateCriteria(CRITERIA, r);
    assert.equal(statuses(e).G1, 'fail');
    assert.equal(e.outcome, 'INSUFFICIENT_EVIDENCE');
  }
  // G1 not met and another gate failing: still insufficient evidence
  assert.equal(evaluateCriteria(CRITERIA, runs({ hxr: { sessions: 400, maxDrawdownPct: 39 } })).outcome, 'INSUFFICIENT_EVIDENCE');
  // a gate that cannot be evaluated (no delay run) cannot pass
  const missing = runs();
  delete missing.delay2;
  const e = evaluateCriteria(CRITERIA, missing);
  assert.equal(statuses(e).G5, 'not_evaluable');
  assert.equal(e.outcome, 'INSUFFICIENT_EVIDENCE');
  const noLoo = runs();
  noLoo.leaveOneOut = LOO(0).slice(0, 3); // 3 of 5 runs, all passing: not yet 4
  assert.equal(statuses(evaluateCriteria(CRITERIA, noLoo)).G6, 'not_evaluable');
});

test('criteria: a contaminated evaluation can never PASS', () => {
  const e = evaluateCriteria(CRITERIA, runs({ contaminated: true }));
  assert.deepEqual(Object.values(statuses(e)), Array(6).fill('pass'));
  assert.equal(e.outcome, 'NOT_COUNTED_CONTAMINATED');
  assert.equal(e.contaminated, true);
  assert.notEqual(e.meaning, PASS_MEANING);
  assert.equal(evaluateCriteria(CRITERIA, runs({ contaminated: true, hxr: { maxDrawdownPct: 35 } })).outcome, 'FAIL');
  assert.equal(evaluateCriteria(CRITERIA, runs({ contaminated: true, hxr: { sessions: 10 } })).outcome, 'INSUFFICIENT_EVIDENCE');
});

test('criteria: "1.10 x the hold" with a negative hold ratio is read conservatively', () => {
  near(timesHoldThreshold(0.4, 1.1), 0.44);
  near(timesHoldThreshold(-0.5, 1.1), -0.45); // not -0.55, which would be easier than the hold itself
  const worse = evaluateCriteria(CRITERIA, runs({ hold: { returnToDrawdown: -0.5 }, hxr: { returnToDrawdown: -0.52 } }));
  assert.equal(statuses(worse).G3, 'fail');
  const better = evaluateCriteria(CRITERIA, runs({ hold: { returnToDrawdown: -0.5 }, hxr: { returnToDrawdown: -0.44 } }));
  assert.equal(statuses(better).G3, 'pass');
});

// ---------- selection (PREREGISTRATION.md section 8) ----------

test('selection: qualification by round trips, highest return-to-drawdown, tie to the smaller decline, stop rule', () => {
  const sel = CRITERIA.selection;
  const hold = { returnToDrawdown: 0.5 };
  const c = (name, roundTrips, returnToDrawdown, maxDrawdownPct) => ({ name, metrics: { roundTrips, returnToDrawdown, maxDrawdownPct, annualisedReturnPct: returnToDrawdown * maxDrawdownPct } });
  // C2 has the best ratio but only 9 round trips; C1 and C3 tie, C3 declined less
  const s = selectCandidate(sel, { hold, candidates: [c('C1', 12, 0.7, 30), c('C2', 9, 0.9, 20), c('C3', 15, 0.7, 25)] });
  assert.equal(s.chosen, 'C3');
  assert.match(s.reason, /tie broken by the smaller largest decline/);
  near(s.threshold, 0.55);
  assert.deepEqual(s.table.map((r) => [r.name, r.qualifies, r.rank]), [['C1', true, 2], ['C2', false, null], ['C3', true, 1]]);
  assert.match(s.table[1].note, /9 round trips \(needs 10\)/);
  // exactly 1.10 x the hold's ratio is enough; just below stops HXR
  assert.equal(selectCandidate(sel, { hold, candidates: [c('C1', 10, 0.55, 30)] }).chosen, 'C1');
  const stop = selectCandidate(sel, { hold, candidates: [c('C1', 12, 0.54, 30), c('C3', 15, 0.2, 10)] });
  assert.equal(stop.chosen, null);
  assert.equal(stop.best, 'C1');
  assert.match(stop.reason, /^stop: .*evaluation period is not used/);
  // nobody qualifies
  const none = selectCandidate(sel, { hold, candidates: [c('C1', 9, 2, 30), c('C2', 3, 3, 20)] });
  assert.equal(none.chosen, null);
  assert.match(none.reason, /no candidate completed at least 10 round trips/);
  // a candidate without a decline has no ratio and is not ranked; a hold without one stops selection
  assert.equal(selectCandidate(sel, { hold, candidates: [c('C1', 12, null, 0)] }).chosen, null);
  assert.equal(selectCandidate(sel, { hold: { returnToDrawdown: null }, candidates: [c('C1', 12, 0.9, 10)] }).chosen, null);
});
