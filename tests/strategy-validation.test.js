import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import {
  runSplit, runStress, runWalkForward, runHoldout, evaluateAcceptance, applyChange, quarters, gridPoints, stressList,
  memoryLedger, createFileLedger, HoldoutRefused, OUTCOMES, WF_MIN_TRADES,
} from '../server/strategy/validation.js';
import { buildReport, SYNTHETIC_BANNER } from '../server/strategy/report.js';
import { buildRegimes } from '../server/strategy/regimes.js';
import { parseTvTradesCsv, compareTrades, parseNumber } from '../scripts/strategy-compare-tv.js';
import { isTradingDay } from '../server/calendar.js';
import { addDays } from '../server/time.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../strategy/${f}`, import.meta.url), 'utf8'));
const CONFIG = read('configs/cb-1.0.0.json');
const SPLITS = read('splits-v1.json');
const ACCEPTANCE = read('acceptance-v1.json');
const UNIVERSE = read('universe-v1.json');

// ---------- a stub engine ----------
// Stands in for engine.js so the validation plumbing can be tested without it.
// Its trades are arbitrary test fixtures, not strategy results.

function tradingDays(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isTradingDay(d)) out.push(d);
  return out;
}

function stubEngine({ every = 'week' } = {}) {
  const calls = [];
  const fn = async ({ config, mode, symbols, from, to, tradeFrom, overrides }) => {
    calls.push({ config, mode, symbols, from, to, tradeFrom, overrides });
    const adj = (config.box.maxHeightAtr - 3) * 0.2 + (config.entry.volumeMultiple - 1.5) * 0.4;
    const days = tradingDays(tradeFrom, to).filter((d, i, a) => (every === 'week'
      ? new Date(`${d}T12:00:00Z`).getUTCDay() === 2
      : i === 0 || d.slice(0, 7) !== a[i - 1].slice(0, 7)));
    let eq = config.risk.hypotheticalStartingEquity;
    const equityCurve = [{ t: `${tradeFrom}T14:30:00Z`, equity: eq, cash: eq, positions: 0, openRisk: 0, grossExposure: 0 }];
    const trades = days.map((d, i) => {
      const r = (i % 2 ? 1.5 : -1) + adj;
      const net = r * 250;
      eq += net;
      equityCurve.push({ t: `${d}T15:30:00Z`, equity: eq - net, cash: eq - net - 10000, positions: 1, openRisk: 250, grossExposure: 10000 });
      equityCurve.push({ t: `${d}T19:00:00Z`, equity: eq, cash: eq, positions: 0, openRisk: 0, grossExposure: 0 });
      return {
        id: `${d}-${i}`, symbol: symbols[i % symbols.length], mode, version: config.version, configHash: 'stub',
        signal: { at: `${d}T15:15:00Z` },
        entry: { at: `${d}T15:30:00Z`, raw: 100, price: 100.04, shares: 100, commission: 1, spreadSlippage: 4, fx: 0, flags: [] },
        exit: { at: `${d}T19:00:00Z`, reason: r > 0 ? 'target' : 'stop', raw: 101, price: 101, commission: 1, spreadSlippage: 0, fx: 0, gapThrough: false, ambiguous: i % 7 === 0, resolvedBy: i % 7 === 0 ? overrides?.ambiguity ?? config.simulation.ambiguity : null },
        pnl: { gross: net + 6, costs: 6, net, r }, holdBars: 14, holdSessions: 1,
      };
    });
    return { meta: { configHash: `stub-${config.box.maxHeightAtr}-${config.entry.volumeMultiple}` }, trades, events: [], equityCurve };
  };
  return { fn, calls };
}

const SYMS = ['AAA', 'NVDA', 'XOM'];

// ---------- settings changes ----------

test('applyChange: stress changes and neighbours, without mutating the baseline', () => {
  const before = JSON.stringify(CONFIG);
  const c2 = applyChange(CONFIG, ACCEPTANCE.stressTests.costs[0]);
  assert.equal(c2.config.costs.commissionPerShare, 0.01);
  assert.equal(c2.config.costs.commissionMinPerOrder, 2);
  assert.equal(c2.config.costs.halfSpreadBps, 4);
  assert.equal(c2.config.costs.slippageBps, 4);
  assert.equal(applyChange(CONFIG, ACCEPTANCE.stressTests.costs[2]).config.costs.slippageBps, 7);
  assert.deepEqual(applyChange(CONFIG, ACCEPTANCE.stressTests.fills[0]).overrides, { entryWorseAtr: 0.1 });
  assert.deepEqual(applyChange(CONFIG, ACCEPTANCE.stressTests.fills[1]).overrides, { ambiguity: 'target_first' });
  assert.deepEqual(applyChange(CONFIG, ACCEPTANCE.stressTests.fills[3]).overrides, { entryFill: 'limit_intrabar' });
  assert.equal(applyChange(CONFIG, { 'box.lookbackBars': 15 }).config.box.lookbackBars, 15);
  assert.throws(() => applyChange(CONFIG, { 'box.nope': 1 }), /Unknown setting/);
  assert.equal(JSON.stringify(CONFIG), before);
  const list = stressList(CONFIG, ACCEPTANCE);
  assert.equal(list.length, 3 + 4 + 12);
  assert.equal(list.filter((t) => t.group === 'neighbours').length, 12);
});

test('quarters and the 9-point grid', () => {
  const qs = quarters('2022-01-01', '2024-12-31');
  assert.equal(qs.length, 12);
  assert.deepEqual(qs[0], { label: '2022 Q1', from: '2022-01-01', to: '2022-03-31' });
  assert.deepEqual(qs[11], { label: '2024 Q4', from: '2024-10-01', to: '2024-12-31' });
  assert.equal(qs[4].label, '2023 Q1');
  const g = gridPoints(SPLITS.walkForward.grid);
  assert.equal(g.length, 9);
  assert.deepEqual(g[4], { 'box.maxHeightAtr': 3.0, 'entry.volumeMultiple': 1.5 });
});

// ---------- runs ----------

test('runSplit warms up from the warm-up start and trades only inside the split', async () => {
  const { fn, calls } = stubEngine();
  const r = await runSplit({ config: CONFIG, mode: 'intraday', bars: new Map(), symbols: SYMS, split: 'validation', splits: SPLITS, runBacktest: fn });
  assert.deepEqual(calls.map(({ from, to, tradeFrom }) => ({ from, to, tradeFrom })), [{ from: '2021-07-01', to: '2024-12-31', tradeFrom: '2024-01-01' }]);
  assert.equal(r.split, 'validation');
  assert.equal(r.metrics.from, '2024-01-01');
  assert.equal(r.metrics.to, '2024-12-31');
  assert.ok(r.metrics.trades > 40);
  assert.equal(r.synthetic, false);
  assert.deepEqual(r.dataCoverage.symbolsWithoutBars, SYMS, 'no bars were supplied');
  await assert.rejects(runSplit({ config: CONFIG, mode: 'intraday', bars: new Map(), symbols: SYMS, split: 'holdout', splits: SPLITS, runBacktest: fn }), /runHoldout/);
  await assert.rejects(runSplit({ config: CONFIG, mode: 'intraday', bars: new Map(), symbols: SYMS, split: 'warmupx', splits: SPLITS, runBacktest: fn }), /Unknown split/);
});

test('runStress runs every stress test and neighbour on the validation split', async () => {
  const { fn, calls } = stubEngine();
  const s = await runStress({ config: CONFIG, mode: 'swing', bars: new Map(), symbols: SYMS, splits: SPLITS, acceptance: ACCEPTANCE, runBacktest: fn });
  assert.equal(s.tests.length, 19);
  assert.equal(calls.length, 20, 'baseline + 19');
  assert.ok(calls.every((c) => c.tradeFrom === '2024-01-01' && c.to === '2024-12-31' && c.mode === 'swing'));
  const by = (name) => calls[1 + s.tests.findIndex((t) => t.name === name)];
  assert.equal(by('2x costs').config.costs.halfSpreadBps, 4);
  assert.equal(by('3x costs').config.costs.commissionPerShare, 0.015);
  assert.equal(by('+5 bps slippage').config.costs.slippageBps, 7);
  assert.deepEqual(by('entry 0.1 ATR worse').overrides, { entryWorseAtr: 0.1 });
  assert.deepEqual(by('TradingView path ambiguity').overrides, { ambiguity: 'tv_path' });
  const nb = s.tests.filter((t) => t.group === 'neighbours');
  assert.equal(nb.length, 12);
  assert.ok(nb.some((t) => t.description === 'box.lookbackBars = 15 (baseline 20)'));
  assert.equal(calls[0].config, CONFIG, 'baseline runs the config as given');
  assert.equal(CONFIG.costs.halfSpreadBps, 2);
});

test('runWalkForward: 8 out-of-sample quarters, choice from in-sample trades only', async () => {
  const { fn, calls } = stubEngine();
  const wf = await runWalkForward({ config: CONFIG, mode: 'intraday', bars: new Map(), symbols: SYMS, splits: SPLITS, runBacktest: fn });
  assert.equal(calls.length, 9 + 8 + 1);
  assert.equal(wf.folds.length, 8);
  assert.deepEqual(wf.folds.map((f) => f.label), ['2023 Q1', '2023 Q2', '2023 Q3', '2023 Q4', '2024 Q1', '2024 Q2', '2024 Q3', '2024 Q4']);
  const f0 = wf.folds[0];
  assert.deepEqual(f0.inSample, { from: '2022-01-01', to: '2022-12-31' });
  assert.deepEqual(f0.outOfSample, { from: '2023-01-01', to: '2023-03-31' });
  assert.equal(f0.candidates.length, 9);
  assert.ok(f0.candidates.every((c) => c.trades >= WF_MIN_TRADES));
  // The stub rewards the largest maxHeightAtr and volumeMultiple; the choice must follow in-sample R.
  assert.deepEqual(f0.chosen.point, { 'box.maxHeightAtr': 3.5, 'entry.volumeMultiple': 1.75 });
  assert.equal(f0.chosen.baseline, false);
  // Out-of-sample runs trade only inside their quarter.
  const oosCalls = calls.slice(9, 17);
  assert.deepEqual(oosCalls.map((c) => [c.tradeFrom, c.to]).slice(0, 2), [['2023-01-01', '2023-03-31'], ['2023-04-01', '2023-06-30']]);
  assert.equal(oosCalls[0].config.box.maxHeightAtr, 3.5);
  assert.equal(wf.oos.trades.length, wf.folds.reduce((a, f) => a + f.oos.trades, 0));
  assert.ok(wf.oos.trades.every((t) => t.entry.at >= '2023-01-01' && t.entry.at <= '2024-12-31T23:59'));
  assert.equal(wf.oos.metrics.trades, wf.oos.trades.length);
  assert.equal(wf.baseline.from, '2023-01-01');
  assert.equal(calls[17].config, CONFIG, 'fixed baseline over the same quarters');
});

test('runWalkForward falls back to the baseline with fewer than 30 in-sample trades', async () => {
  const { fn } = stubEngine({ every: 'month' });
  const wf = await runWalkForward({ config: CONFIG, mode: 'intraday', bars: new Map(), symbols: SYMS, splits: SPLITS, runBacktest: fn });
  assert.ok(wf.folds.every((f) => f.chosen.baseline && /at least 30/.test(f.chosen.reason)));
  assert.ok(wf.folds.every((f) => f.candidates.every((c) => c.trades < 30)));
});

// ---------- holdout guard ----------

test('holdout: first run clean, later runs need a reason and are contaminated', async () => {
  const { fn } = stubEngine();
  const ledger = memoryLedger();
  const args = { config: CONFIG, mode: 'intraday', bars: new Map(), symbols: SYMS, splits: SPLITS, acceptance: ACCEPTANCE, ledger, runBacktest: fn, configHash: 'abc123', universe: UNIVERSE };
  const first = await runHoldout({ ...args, at: '2026-10-21T20:00:00Z' });
  assert.equal(first.contaminated, false);
  assert.equal(first.split, 'holdout');
  assert.equal(first.metrics.from, '2025-01-01');
  assert.ok(first.variants.costs2x.metrics && first.variants.targetFirst.metrics && first.variants.tvPath.metrics);
  assert.equal(first.variants.stopFirst.metrics, first.metrics, 'configured stop-first run is reused');
  await assert.rejects(runHoldout({ ...args, at: '2026-10-21T21:00:00Z' }), HoldoutRefused);
  await assert.rejects(runHoldout({ ...args, at: '2026-10-21T21:00:00Z', reason: '   ' }), HoldoutRefused);
  assert.equal(ledger.entries.length, 1, 'a refused run is not recorded');
  const second = await runHoldout({ ...args, at: '2026-10-21T22:00:00Z', reason: 'bug fix in the cost model' });
  assert.equal(second.contaminated, true);
  assert.equal(ledger.entries.length, 2);
  assert.deepEqual(ledger.entries[1], { version: '1.0.0', configHash: 'abc123', mode: 'intraday', at: '2026-10-21T22:00:00Z', reason: 'bug fix in the cost model', contaminated: true, priorRuns: 1, synthetic: false });
  // Another mode or config hash is a separate first run.
  assert.equal((await runHoldout({ ...args, mode: 'swing', at: '2026-10-21T23:00:00Z' })).contaminated, false);
  assert.equal((await runHoldout({ ...args, configHash: 'other', at: '2026-10-21T23:00:00Z' })).contaminated, false);
  await assert.rejects(runHoldout({ ...args, ledger: null, at: 'x' }), /ledger/);

  const ev = evaluateAcceptance({ results: { holdout: second, validation: first }, acceptance: ACCEPTANCE, mode: 'intraday', universe: UNIVERSE });
  for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B9']) {
    const c = ev.criteria.find((x) => x.id === id);
    assert.ok(c.status === 'not_evaluable' || (id === 'B2' && c.status === 'fail'), `${id} ${c.status}`);
  }
  assert.equal(ev.holdoutContaminated, true);
  assert.notEqual(ev.outcome, 'eligible_for_review');
});

test('file ledger persists entries and fails closed on a corrupt file', () => {
  const dir = tempDir('sd-ledger-');
  const file = path.join(dir, 'holdout-ledger.json');
  const l = createFileLedger(file);
  assert.equal(l.count('1.0.0', 'h', 'intraday'), 0);
  l.record({ version: '1.0.0', configHash: 'h', mode: 'intraday', at: 't', reason: null, contaminated: false });
  assert.equal(createFileLedger(file).count('1.0.0', 'h', 'intraday'), 1);
  assert.equal(createFileLedger(file).count('1.0.0', 'h', 'swing'), 0);
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => createFileLedger(file).count('1.0.0', 'h', 'intraday'));
  fs.writeFileSync(file, '{"entries": 3}');
  assert.throws(() => createFileLedger(file).count('1.0.0', 'h', 'intraday'), /not a holdout ledger/);
});

// ---------- acceptance ----------

function goodResults() {
  const neighbours = ACCEPTANCE.stressTests.neighbours.map((n, i) => ({ group: 'neighbours', name: `n${i}`, metrics: { trades: 70, meanR: i < 9 ? 0.05 : -0.02 } }));
  return {
    validation: { metrics: { trades: 80, meanR: 0.2 } },
    holdout: {
      contaminated: false,
      trades: [],
      metrics: {
        trades: 150, meanR: 0.25, meanRCI: { lower: 0.05, upper: 0.45, n: 150, resamples: 10000, seed: 12345 },
        profitFactor: 1.5, grossProfit: 10000, maxDrawdownPct: 6,
        outliers: { meanRWithoutBest5Pct: 0.1, best5PctCount: 8, largestSymbol: { symbol: 'XOM', net: 1000, shareOfNet: 0.2 } },
        groups: { excludingCluster: { ai_tech: { trades: 100, meanR: 0.15 } } },
      },
      variants: { costs2x: { metrics: { trades: 150, profitFactor: 1.1, grossProfit: 9000 } }, stopFirst: { metrics: { meanR: 0.25 } }, targetFirst: { metrics: { meanR: 0.4 } }, tvPath: { metrics: { meanR: 0.3 } } },
    },
    stress: { tests: [{ group: 'costs', name: '2x costs', metrics: { trades: 70, meanR: -0.5 } }, ...neighbours] },
    walkForward: { oos: { metrics: { trades: 90, meanR: 0.12 } } },
  };
}
const FORWARD = { trades: Array.from({ length: 120 }, () => ({ version: '1.0.0', configHash: 'h', exit: { reason: 'target' }, pnl: { net: 10, r: 0.2 } })), startedAt: '2026-11-02', asOf: '2027-03-01', signals: { total: 300, staleOrError: 3 }, duplicates: 0 };
const status = (ev, id) => ev.criteria.find((c) => c.id === id).status;

test('acceptance: every criterion passing gives eligible_for_review, which is not permission to trade', () => {
  const ev = evaluateAcceptance({ results: { ...goodResults(), forward: FORWARD }, acceptance: ACCEPTANCE, mode: 'intraday' });
  assert.deepEqual(ev.criteria.map((c) => [c.id, c.status]).filter(([, s]) => s !== 'pass'), []);
  assert.equal(ev.outcome, 'eligible_for_review');
  assert.ok(OUTCOMES.includes(ev.outcome));
  assert.match(ev.note, /not permission to trade/);
  assert.ok(ev.criteria.every((c) => c.rule && 'value' in c));
  assert.deepEqual(ev.criteria.find((c) => c.id === 'B8').value, { positive: 9, of: 12, share: 0.75 });
});

test('acceptance: without a forward test the backtest stage passes but the outcome is inconclusive', () => {
  const ev = evaluateAcceptance({ results: goodResults(), acceptance: ACCEPTANCE, mode: 'swing' });
  assert.equal(ev.stages.backtest, 'eligible_for_review');
  assert.equal(ev.stages.forward, 'inconclusive');
  assert.equal(ev.outcome, 'inconclusive');
});

test('acceptance: too few trades is inconclusive, never a failure', () => {
  const r = goodResults();
  r.holdout.metrics.trades = 50;
  const ev = evaluateAcceptance({ results: r, acceptance: ACCEPTANCE, mode: 'intraday' });
  assert.equal(status(ev, 'B1'), 'not_evaluable');
  assert.equal(ev.stages.backtest, 'inconclusive');
  assert.equal(ev.outcome, 'inconclusive');
  r.validation.metrics.trades = 10;
  assert.equal(status(evaluateAcceptance({ results: r, acceptance: ACCEPTANCE, mode: 'intraday' }), 'B1'), 'not_evaluable');
});

test('acceptance: any failure makes the outcome not_eligible', () => {
  const r = goodResults();
  r.holdout.metrics.meanR = 0.08;
  r.holdout.metrics.trades = 50; // also too few: a failure still wins
  const ev = evaluateAcceptance({ results: r, acceptance: ACCEPTANCE, mode: 'intraday' });
  assert.equal(status(ev, 'B2'), 'fail');
  assert.equal(ev.outcome, 'not_eligible');
  const r2 = goodResults();
  r2.holdout.metrics.maxDrawdownPct = 10.5;
  assert.equal(status(evaluateAcceptance({ results: r2, acceptance: ACCEPTANCE, mode: 'intraday' }), 'B5'), 'fail');
  const r3 = goodResults();
  r3.holdout.metrics.outliers.largestSymbol.shareOfNet = 0.45;
  assert.equal(status(evaluateAcceptance({ results: r3, acceptance: ACCEPTANCE, mode: 'intraday' }), 'B6'), 'fail');
  const r4 = goodResults();
  r4.holdout.variants.costs2x.metrics.profitFactor = 0.97;
  assert.equal(status(evaluateAcceptance({ results: r4, acceptance: ACCEPTANCE, mode: 'intraday' }), 'B4'), 'fail');
  const r5 = goodResults();
  r5.stress.tests.find((t) => t.name === 'n8').metrics.meanR = 0; // 8 of 12 = 67 %
  assert.equal(status(evaluateAcceptance({ results: r5, acceptance: ACCEPTANCE, mode: 'intraday' }), 'B8'), 'fail');
  const r6 = goodResults();
  r6.stress.tests.pop(); // only 11 neighbours ran
  assert.equal(status(evaluateAcceptance({ results: r6, acceptance: ACCEPTANCE, mode: 'intraday' }), 'B8'), 'not_evaluable');
});

test('acceptance: a contaminated holdout makes holdout criteria not evaluable', () => {
  const r = goodResults();
  r.holdout.contaminated = true;
  const ev = evaluateAcceptance({ results: r, acceptance: ACCEPTANCE, mode: 'intraday' });
  for (const id of ['B1', 'B3', 'B4', 'B5', 'B6', 'B7', 'B9']) assert.equal(status(ev, id), 'not_evaluable', id);
  assert.equal(status(ev, 'B2'), 'not_evaluable');
  assert.equal(status(ev, 'B8'), 'pass');
  assert.equal(status(ev, 'B10'), 'pass');
  assert.match(ev.criteria.find((c) => c.id === 'B5').note, /contaminated/);
  assert.equal(ev.outcome, 'inconclusive');
});

test('acceptance: synthetic results can neither pass nor fail', () => {
  const r = goodResults();
  r.validation.synthetic = true;
  r.walkForward.oos.metrics.meanR = -1;
  const ev = evaluateAcceptance({ results: { ...r, forward: FORWARD }, acceptance: ACCEPTANCE, mode: 'intraday' });
  assert.ok(ev.criteria.every((c) => c.status === 'not_evaluable' && /synthetic/.test(c.note)));
  assert.equal(ev.criteria.find((c) => c.id === 'B2').computedStatus, 'pass');
  assert.equal(ev.criteria.find((c) => c.id === 'B10').computedStatus, 'fail');
  assert.equal(ev.outcome, 'inconclusive');
  assert.equal(ev.synthetic, true);
  assert.throws(() => evaluateAcceptance({ results: r, acceptance: { name: 'acceptance-v9' }, mode: 'intraday' }), /acceptance-v1/);
});

// ---------- report ----------

async function stubRuns({ synthetic }) {
  const { fn } = stubEngine();
  const common = { config: CONFIG, mode: 'intraday', bars: new Map(), symbols: SYMS, splits: SPLITS, runBacktest: fn, synthetic, universe: UNIVERSE, regimes: buildRegimes([]) };
  return {
    meta: { synthetic, seed: synthetic ? 7 : null, configHash: 'cfg', dataHash: 'data', dataSource: 'stub', command: 'test' },
    modes: {
      intraday: {
        development: await runSplit({ ...common, split: 'development' }),
        validation: await runSplit({ ...common, split: 'validation' }),
        stress: await runStress({ ...common, acceptance: ACCEPTANCE }),
      },
    },
  };
}

test('report: synthetic banner, sample sizes, acceptance and sensitivity tables', async () => {
  const runs = await stubRuns({ synthetic: true });
  const { json, markdown } = buildReport({ runs, acceptance: ACCEPTANCE, universe: UNIVERSE, splits: SPLITS, config: CONFIG, dataQuality: { synthetic: true, seed: 7 } });
  assert.equal(json.synthetic, true);
  assert.equal(json.banner, SYNTHETIC_BANNER);
  assert.equal(SYNTHETIC_BANNER, 'SYNTHETIC DATA — tests the code, says nothing about the strategy');
  const lines = markdown.split('\n');
  assert.ok(lines.slice(0, 4).some((l) => l.includes(SYNTHETIC_BANNER)), 'banner at the top');
  assert.ok(markdown.trimEnd().endsWith(`**${SYNTHETIC_BANNER}.**`), 'and at the end');
  for (const s of ['Acceptance criteria', '| B1 |', '| B10 |', '| F4 |', 'Outlier dependence', 'Stress tests', 'Ambiguous bars', 'Buy-and-hold', 'Data quality', 'Config hash', 'Closed trades']) {
    assert.ok(markdown.includes(s), s);
  }
  assert.ok(json.modes.intraday.acceptance.criteria.every((c) => c.status === 'not_evaluable'));
  assert.doesNotMatch(markdown, /profitable|proven|guarantee/i);
  assert.ok(JSON.stringify(json).length > 1000);
});

test('report: no banner for non-synthetic inputs; small samples are labelled', async () => {
  const runs = await stubRuns({ synthetic: false });
  runs.modes.intraday.development.metrics.trades = 12;
  const { json, markdown } = buildReport({ runs, acceptance: ACCEPTANCE, universe: UNIVERSE, splits: SPLITS, config: CONFIG, dataQuality: null });
  assert.equal(json.synthetic, false);
  assert.ok(!markdown.includes(SYNTHETIC_BANNER));
  assert.ok(markdown.includes('12 (small sample)'));
  assert.ok(markdown.includes('not permission to trade'));
});

// ---------- TradingView list-of-trades comparison ----------

const TV_CSV = `﻿Trade #,Type,Signal,Date/Time,Price USD,Contracts,Profit USD,Profit %,Cumulative profit USD,Cumulative profit %,Run-up USD,Run-up %,Drawdown USD,Drawdown %
1,Exit long,Target,2024-03-05 11:15,"1,012.40",20,248.00,1.24,248.00,0.25,260.00,1.3,-40.00,-0.2
1,Entry long,CB long,2024-03-05 10:00,1000.00,20,248.00,1.24,248.00,0.25,260.00,1.3,-40.00,-0.2
2,Exit long,Stop,2024-03-07 14:30,995.10,25,-130.50,-0.52,117.50,0.12,10.00,0.04,-131.00,-0.52
2,Entry long,CB long,2024-03-07 13:45,1000.32,25,-130.50,-0.52,117.50,0.12,10.00,0.04,-131.00,-0.52
3,Exit long,Open,2024-03-12 15:45,1003.00,10,30.00,0.3,147.50,0.15,30.00,0.3,0.00,0
3,Entry long,CB long,2024-03-12 15:00,1000.00,10,30.00,0.3,147.50,0.15,30.00,0.3,0.00,0
`;

// Newer export layout, semicolon-separated with decimal commas.
const TV_CSV_EU = `Trade #;Type;Date and time;Signal;Price USD;Quantity;Net P&L USD;Net P&L %
1;Entry long;2024-03-05 10:00;CB long;1000,00;20;248,00;1,24
1;Exit long;2024-03-05 11:15;Target;1.012,40;20;248,00;1,24
`;

test('compare-tv: TradingView list-of-trades CSV parsing with flexible headers', () => {
  const tv = parseTvTradesCsv(TV_CSV, { tz: 'America/New_York' });
  assert.equal(tv.trades.length, 3);
  assert.deepEqual(tv.columns.time, 'date/time');
  const t1 = tv.trades[0];
  assert.equal(t1.n, 1);
  assert.equal(t1.side, 'long');
  assert.equal(t1.entryAt, '2024-03-05T15:00:00.000Z', '10:00 EST');
  assert.equal(t1.exitAt, '2024-03-05T16:15:00.000Z');
  assert.equal(t1.entryPrice, 1000);
  assert.equal(t1.exitPrice, 1012.4);
  assert.equal(t1.qty, 20);
  assert.equal(t1.profit, 248);
  assert.equal(t1.exitSignal, 'Target');
  assert.equal(tv.trades[2].open, true, 'an "Open" exit is a trade still open at the end of the chart');
  const eu = parseTvTradesCsv(TV_CSV_EU, { tz: 'America/New_York' });
  assert.equal(eu.trades.length, 1);
  assert.equal(eu.trades[0].exitPrice, 1012.4);
  assert.equal(eu.trades[0].entryAt, '2024-03-05T15:00:00.000Z');
  assert.equal(eu.trades[0].qty, 20);
  assert.throws(() => parseTvTradesCsv('a,b\n1,2\n'), /Trade #/);
  assert.equal(parseNumber('1,234.50'), 1234.5);
  assert.equal(parseNumber('−12.5'), -12.5);
  assert.equal(parseNumber('1.234,5', { decimalComma: true }), 1234.5);
  assert.equal(parseNumber(''), null);
});

test('compare-tv: matching engine trades, differences and unmatched trades', () => {
  const tv = parseTvTradesCsv(TV_CSV, { tz: 'America/New_York' }).trades;
  const eng = [
    { id: 'e1', symbol: 'X', entry: { at: '2024-03-05T15:00:00.000Z', raw: 1000, shares: 20, flags: [] }, exit: { at: '2024-03-05T16:15:00.000Z', raw: 1012.4, reason: 'target' }, pnl: { net: 240.1 } },
    { id: 'e2', symbol: 'X', entry: { at: '2024-03-07T18:45:00.000Z', raw: 1000.3, shares: 25, flags: ['intrabar_limit_entry'] }, exit: { at: '2024-03-07T19:45:00.000Z', raw: 995.1, reason: 'stop' }, pnl: { net: -135 } },
    { id: 'e9', symbol: 'X', entry: { at: '2024-03-20T14:00:00.000Z', raw: 990, shares: 5, flags: [] }, exit: { at: '2024-03-20T15:00:00.000Z', raw: 985, reason: 'stop' }, pnl: { net: -30 } },
  ];
  const c = compareTrades(tv, eng, { toleranceMinutes: 15 });
  assert.equal(c.matched.length, 2);
  assert.deepEqual(c.unmatchedTv.map((t) => t.n), [3]);
  assert.deepEqual(c.unmatchedEngine.map((t) => t.id), ['e9']);
  const m1 = c.matched[0];
  assert.equal(m1.entryTimeDiffMin, 0);
  assert.equal(m1.exitTimeDiffMin, 0);
  assert.equal(m1.entryPriceDiff, 0);
  assert.equal(m1.exitPriceDiff, 0);
  const m2 = c.matched[1];
  assert.equal(m2.entryTimeDiffMin, 0);
  assert.equal(m2.exitTimeDiffMin, 15);
  assert.ok(Math.abs(m2.entryPriceDiff - -0.02) < 1e-9);
  assert.equal(c.summary.tvTrades, 3);
  assert.equal(c.summary.engineTrades, 3);
  assert.equal(c.summary.matched, 2);
  assert.equal(c.summary.exactEntryTime, 2);
  assert.equal(c.summary.exactExitTime, 1);
});

// ---------- with the real engine (skipped until server/strategy/engine.js exists) ----------
// Synthetic bars test the plumbing only; their figures say nothing about the strategy.

const HAS_ENGINE = fs.existsSync(new URL('../server/strategy/engine.js', import.meta.url))
  && fs.existsSync(new URL('../server/strategy/synthetic.js', import.meta.url));
const MINI_SPLITS = {
  ...SPLITS,
  warmup: { from: '2024-01-02', to: '2024-01-31' },
  development: { from: '2024-02-01', to: '2024-08-30' },
  validation: { from: '2024-09-03', to: '2024-10-31' },
  holdout: { from: '2024-11-01', to: '2024-12-31' },
};
const MINI_SYMS = ['AAA', 'BBB', 'CCC', 'DDD', 'SPY'];

async function syntheticMini() {
  const { generateSyntheticBars } = await import('../server/strategy/synthetic.js');
  const g = await generateSyntheticBars({ symbols: MINI_SYMS, from: '2024-01-02', to: '2024-12-31', seed: 7 });
  assert.equal(g.synthetic, true);
  return g.bars;
}

test('engine: runSplit trades only inside the split and its figures reconcile', { skip: !HAS_ENGINE && 'engine.js not written yet' }, async () => {
  const bars = await syntheticMini();
  for (const mode of ['intraday', 'swing']) {
    const args = { config: CONFIG, mode, bars, symbols: MINI_SYMS, split: 'development', splits: MINI_SPLITS, synthetic: true, universe: UNIVERSE, regimes: buildRegimes(bars.get('SPY')) };
    const r = await runSplit(args);
    assert.equal(r.synthetic, true);
    assert.ok(r.trades.length > 0, `${mode}: the fixture should produce trades`);
    for (const t of r.trades) {
      assert.ok(t.entry.at.slice(0, 10) >= '2024-02-01' && t.exit.at.slice(0, 10) <= '2024-08-30', `${t.id} ${t.entry.at} ${t.exit.at}`);
    }
    const net = r.trades.reduce((a, t) => a + t.pnl.net, 0);
    assert.ok(Math.abs(r.metrics.netPnl - net) < 1e-6);
    assert.ok(Math.abs(r.metrics.endEquity - (CONFIG.risk.hypotheticalStartingEquity + net)) < 1e-6, 'equity curve ends at start + net P/L (positions closed at the split end)');
    assert.equal(r.metrics.trades + r.metrics.endOfData.trades, r.trades.length);
    assert.ok(r.equityCurve.every((p) => p.t.slice(0, 10) >= '2024-02-01'), 'no equity points before trading starts');
    const costs = r.trades.reduce((a, t) => a + t.pnl.costs, 0);
    assert.ok(Math.abs(r.metrics.costs.total - costs) < 1e-9);
    assert.ok(Math.abs(r.metrics.costs.commission + r.metrics.costs.spreadSlippage + r.metrics.costs.fx - costs) < 1e-6);
    const again = await runSplit(args);
    assert.deepEqual(again.metrics, r.metrics, 'deterministic');
  }
});

test('engine: stress tests and walk-forward run end to end on synthetic data', { skip: !HAS_ENGINE && 'engine.js not written yet' }, async () => {
  const bars = await syntheticMini();
  const wfSplits = { ...MINI_SPLITS, walkForward: { ...SPLITS.walkForward, range: { from: '2024-01-02', to: '2024-12-31' }, inSampleQuarters: 2 } };
  const common = { config: CONFIG, mode: 'swing', bars, symbols: MINI_SYMS, splits: wfSplits, synthetic: true };
  const s = await runStress({ ...common, acceptance: ACCEPTANCE });
  assert.equal(s.tests.length, 19);
  assert.equal(s.synthetic, true);
  const twice = s.tests.find((t) => t.name === '2x costs').metrics;
  if (twice.trades && s.baseline.metrics.trades) assert.ok(twice.costs.perTrade > s.baseline.metrics.costs.perTrade, 'doubling costs raises cost per trade');
  const wf = await runWalkForward(common);
  assert.equal(wf.folds.length, 2, '2024 Q3 and Q4 after two in-sample quarters');
  for (const f of wf.folds) assert.equal(f.chosen.baseline, f.candidates.every((c) => c.trades < 30), f.label);
  assert.ok(wf.oos.trades.every((t) => t.entry.at.slice(0, 10) >= '2024-07-01'));
  assert.equal(wf.synthetic, true);
});

test('engine: holdout guard and acceptance on synthetic data', { skip: !HAS_ENGINE && 'engine.js not written yet' }, async () => {
  const bars = await syntheticMini();
  const ledger = memoryLedger();
  const args = { config: CONFIG, mode: 'swing', bars, symbols: MINI_SYMS, splits: MINI_SPLITS, acceptance: ACCEPTANCE, ledger, synthetic: true, at: '2026-10-21T20:00:00Z' };
  const h1 = await runHoldout(args);
  assert.equal(h1.contaminated, false);
  await assert.rejects(runHoldout(args), HoldoutRefused);
  const h2 = await runHoldout({ ...args, reason: 'test' });
  assert.equal(h2.contaminated, true);
  const ev = evaluateAcceptance({ results: { holdout: h1 }, acceptance: ACCEPTANCE, mode: 'swing' });
  assert.ok(ev.criteria.every((c) => c.status === 'not_evaluable'));
  const { markdown } = buildReport({ runs: { meta: { synthetic: true, seed: 11 }, modes: { swing: { holdout: h2 } } }, acceptance: ACCEPTANCE, universe: UNIVERSE, splits: MINI_SPLITS, config: CONFIG });
  assert.ok(markdown.includes(SYNTHETIC_BANNER));
  assert.ok(markdown.includes('Holdout (contaminated)'));
});
