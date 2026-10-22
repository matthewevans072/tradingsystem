// The readiness gate (PARAMETER-LOG.md, 2026-10-22): on real data the Lab and
// the command-line runner refuse a run unless every symbol is READY for every
// period the run reads (warm-up through the run's own period). Generated
// prices stored as if downloaded only exercise the gate; nothing here is
// market data or strategy performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { loadConfig } from '../server/config.js';
import * as store from '../server/strategy/store.js';
import { createLab } from '../server/strategy/lab.js';
import { loadUniverse, loadSplits } from '../server/strategy/config.js';
import { periodsForRun, readinessBlockers, READY, NOT_READY, NO_DATA } from '../server/strategy/readiness.js';
import { main } from '../scripts/strategy-backtest.js';
import { tradingDays, sessionBarStarts } from '../server/strategy/sessions.js';
import { NO_HOST_KEYS } from './no-host-keys.js';

const UNIVERSE = loadUniverse();
const SPLITS = loadSplits();
const SYMS = UNIVERSE.symbols.map((s) => s.symbol);

function sessionBars(from, to, { seed = 7, start = 100, skip = new Set() } = {}) {
  let x = seed >>> 0, p = start;
  const rand = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const out = [];
  for (const d of tradingDays(from, to)) {
    if (skip.has(d)) continue;
    for (const t of sessionBarStarts(d)) {
      p *= 1 + (rand() - 0.5) * 0.002;
      out.push({ t: new Date(t).toISOString(), o: p, h: p * 1.002, l: p * 0.998, c: p * 1.001, v: 1000 + Math.floor(rand() * 500) });
    }
  }
  return out;
}

function realLab(dir) {
  const ctx = { cfg: loadConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none' }), mode: 'real', providers: { market: null } };
  Object.defineProperty(ctx, 'db', { get() { throw new Error('the Strategy Lab touched the portfolio database'); } });
  return createLab(ctx, { jobs: 'inline' });
}

test('periodsForRun: every run reads from the warm-up through its own period', () => {
  assert.deepEqual(periodsForRun('development'), ['warmup', 'development']);
  for (const s of ['validation', 'stress', 'walk_forward', 'walk-forward']) assert.deepEqual(periodsForRun(s), ['warmup', 'development', 'validation'], s);
  assert.deepEqual(periodsForRun('holdout'), ['warmup', 'development', 'validation', 'holdout']);
  assert.throws(() => periodsForRun('all'), /Unknown run/);
  const ready = { symbol: 'A', periods: { warmup: { status: READY }, development: { status: READY }, validation: { status: NOT_READY, reasons: ['coverage: x'] }, holdout: { status: NO_DATA } } };
  assert.deepEqual(readinessBlockers([ready], 'development'), []);
  assert.deepEqual(readinessBlockers([ready], 'validation').map((b) => [b.symbol, b.period, b.status]), [['A', 'validation', NOT_READY]]);
  assert.deepEqual(readinessBlockers([ready], 'development', ['A', 'B']).map((b) => [b.symbol, b.period]), [['B', 'warmup'], ['B', 'development']], 'a wanted symbol without a result is NO DATA');
});

test('Lab: a backtest is refused unless all 17 symbols are READY for the periods it reads; the holdout too', { timeout: 300000 }, async () => {
  const dir = tempDir();
  const lab = realLab(dir);
  const to = SPLITS.development.to;
  // 16 symbols complete through development; CAT is missing 2023-05-10.
  SYMS.forEach((s, i) => store.storeBarSet(lab.db, s, sessionBars(SPLITS.warmup.from, to, { seed: 11 + i, start: 50 + i, skip: s === 'CAT' ? new Set(['2023-05-10']) : new Set() }), { source: 'alpaca', adjustment: 'split', feed: 'sip' }));
  assert.throws(() => lab.startBacktest({ mode: 'intraday', split: 'development' }), (e) => e.status === 409 && /not every symbol is READY/i.test(e.message) && /CAT Development: NOT READY/.test(e.message));
  assert.equal(lab.listRuns({}).runs.length, 0, 'nothing was started');

  // Complete CAT: development may run; validation, stress, walk-forward and the holdout read periods with no data.
  store.storeBarSet(lab.db, 'CAT', sessionBars(SPLITS.warmup.from, to, { seed: 99, start: 70 }), { source: 'alpaca', adjustment: 'split', feed: 'sip', replace: true });
  for (const split of ['validation', 'stress', 'walk-forward']) {
    assert.throws(() => lab.startBacktest({ mode: 'swing', split }), (e) => e.status === 400 || e.status === 409, split);
  }
  store.storeBarSet(lab.db, 'SPY', sessionBars(SPLITS.validation.from, SPLITS.holdout.to, { seed: 5, start: 400 }), { source: 'alpaca', adjustment: 'split', feed: 'sip' });
  assert.throws(() => lab.startBacktest({ mode: 'swing', split: 'validation' }), (e) => e.status === 409 && /Validation: NO DATA/.test(e.message));
  assert.throws(() => lab.startHoldout({ mode: 'swing', confirm: true }), (e) => e.status === 409 && /not every symbol is READY/i.test(e.message));
  assert.equal(lab.listRuns({}).runs.length, 0);
  assert.equal(store.listHoldoutRuns(lab.db).length, 0, 'the refused holdout used nothing up');

  const run = await lab.runBacktest({ mode: 'intraday', split: 'development' });
  assert.equal(run.run?.status ?? run.status, 'done');
  lab.close();
});

test('command line: real data is refused unless every requested symbol is READY; synthetic data is not gated', { timeout: 300000 }, async () => {
  const dir = tempDir();
  const write = (name, bars) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(bars)); return f; };
  const to = SPLITS.development.to;
  const full = { SPY: sessionBars(SPLITS.warmup.from, to, { seed: 3, start: 400 }), GLD: sessionBars(SPLITS.warmup.from, to, { seed: 4, start: 170 }) };
  const gap = { ...full, GLD: sessionBars(SPLITS.warmup.from, to, { seed: 4, start: 170, skip: new Set(['2022-06-01']) }) };
  const args = (f, split) => ['--data', f, '--symbols', 'SPY,GLD', '--split', split, '--mode', 'intraday', '--out', path.join(dir, `out-${split}`)];
  const logs = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    assert.equal(await main(args(write('gap.json', gap), 'development')), 4);
    assert.ok(logs.some((l) => /Refused: not every symbol is READY/.test(l) && /GLD Development: NOT READY/.test(l)));
    assert.equal(await main(args(write('full.json', full), 'validation')), 4, 'validation reads a period with no bars');
    assert.ok(logs.some((l) => /SPY Validation: NO DATA/.test(l)));
    assert.ok(!fs.existsSync(path.join(dir, 'out-development', 'report.md')), 'a refused run writes no report');
    logs.length = 0;
    assert.equal(await main(args(write('full2.json', full), 'development')), 0);
    assert.ok(logs.some((l) => /Readiness: all 2 symbols READY for warmup, development/.test(l)));
    assert.ok(logs.some((l) => /Excluded sessions \(splits-v2, every symbol\)/.test(l)));
    assert.equal(await main(['--synthetic', '--seed', '3', '--symbols', 'SPY', '--split', 'development', '--mode', 'intraday', '--from', '2021-07-01', '--to', '2022-03-31', '--out', path.join(dir, 'syn')]), 0);
  } finally { Object.assign(console, orig); }
});
