// hxr-prereg-3 and 3a (strategy/hxr/PREREGISTRATION-3.md, PREREGISTRATION-3a.md,
// ENGINE-SPEC.md section 5b): pooled cash and risk sizing, the initial-loss
// rule for every exit rule, the account-decline pause, the three fresh-entry
// policies, the day-one hold benchmark, the store migration that adds the
// validation kind, the two pick rules, the criteria against both benchmarks
// and the validation gate. Hand-checked cases use small windows so every
// number can be checked by hand; prefix invariance, a future-data test and
// snapshots use the pre-registered settings on synthetic prices. Synthetic
// prices only test code; nothing here is market data or performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import { loadHxrConfig, loadHxrCriteria, validateHxrConfig, holdDayOneConfig, hxrConfigHash, CRITERIA_PATH } from '../server/hxr/config.js';
import { createEngine, runBacktest, periodSessions, ENGINE_VERSION, historyLengthFor, effectiveLevel, exitPriceNow } from '../server/hxr/engine.js';
import { computeRunMetrics, compareBenchmarks, evaluateCriteria, evaluateValidation, selectCandidate } from '../server/hxr/metrics.js';
import * as store from '../server/hxr/store.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const K = (2 + 2) / 10000; // half-spread 2 bps (passed as a fixed number) + 2 bps slippage
const X1B = loadHxrConfig('hxr-x1b-0.3.0.json'), X1A = loadHxrConfig('hxr-x1a-0.3.0.json'), X1C = loadHxrConfig('hxr-x1c-0.3.0.json'), X2B = loadHxrConfig('hxr-x2b-0.3.0.json');
const CRITERIA = loadHxrCriteria(CRITERIA_PATH);

// A config with small rule windows for hand checks; the budgets stay pre-registered unless overridden.
function small(base, { rule = {}, risk = {}, initialLoss = {} } = {}) {
  const c = clone(base);
  c.rule = { ...c.rule, volSessions: 2, pivotSessions: 2, ...rule };
  c.risk = { ...c.risk, ...risk };
  c.initialLoss = { ...c.initialLoss, ...initialLoss };
  return c;
}

// Sessions from 2024-01-02; rows of [open, close] per symbol (null = no bar). The
// period starts after `warmup` sessions.
function build(paths, { warmup = 25 } = {}) {
  const n = Math.max(...Object.values(paths).map((r) => r.length));
  const sessions = periodSessions({ warmupFrom: '2024-01-02', end: '2024-12-31' }).slice(0, n);
  const days = new Map(sessions.map((d, i) => [d, {
    bars: Object.fromEntries(Object.entries(paths).filter(([, rows]) => rows[i] != null).map(([s, rows]) => { const [o, c] = rows[i]; return [s, { o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 }]; })),
    splits: [], dividends: [],
  }]));
  return { sessions, days, start: sessions[warmup] };
}
const symbolsOf = (paths, tags = {}) => Object.keys(paths).map((s) => ({ symbol: s, exchange: 'NASDAQ', listedFrom: '2016-01-04', techAi: tags[s] ?? true }));
// One stock's rows, or { symbol: rows }.
function run(config, p, opts = {}) {
  const paths = Array.isArray(p) ? { AAA: p } : p;
  const { sessions, days, start } = build(paths, opts);
  const r = runBacktest({ config, symbols: symbolsOf(paths, opts.tags), period: { warmupFrom: sessions[0], start, end: sessions.at(-1) }, inputs: { sessions, days, halfSpreadBps: 2 } });
  return { ...r, sessions, start };
}
// Warm-up closes alternating 100, 101, 100, ... so that m = 1 exactly at the last warm-up close (100).
const WARM = Array.from({ length: 25 }, (_, i) => (i % 2 ? 101 : 100));
const flat = (closes) => closes.map((c, i) => [i ? closes[i - 1] : c, c]);
const count = (list, key) => list.reduce((a, x) => { const k = key(x); a[k] = (a[k] || 0) + 1; return a; }, {});

test('engine version, config checks: risk sections only when risk-sized, pending policy refused, fresh-entry sessions', () => {
  assert.equal(ENGINE_VERSION, 'hxr-engine-3');
  assert.equal(historyLengthFor(X1B), 21);
  const eq = clone(loadHxrConfig('hxr-x1-0.2.0.json'));
  eq.risk = X1B.risk;
  assert.match(validateHxrConfig(eq).join(';'), /risk is only used when account.allocation is risk_sized/);
  const noRisk = clone(X1B);
  delete noRisk.risk;
  assert.match(validateHxrConfig(noRisk).join(';'), /risk must be an object/);
  const resume = clone(X1B);
  resume.risk.resumeDeclineUsd = 1500;
  assert.match(validateHxrConfig(resume).join(';'), /resumeDeclineUsd must be below/);
  const c = clone(X1C);
  delete c.rule.freshEntryMinSessions;
  assert.match(validateHxrConfig(c).join(';'), /freshEntryMinSessions is required/);
  const b = clone(X1B);
  b.rule.freshEntryMinSessions = 5;
  assert.match(validateHxrConfig(b).join(';'), /only used with fresh_entry_after_sessions/);
  // A config that still carries the pending choice loads (so it can be listed and hashed) but can never run.
  const pending = clone(X1B);
  pending.rule.afterMissedRebound = 'pending_owner_choice';
  assert.deepEqual(validateHxrConfig(pending), []);
  assert.throws(() => createEngine({ config: pending, symbols: ['A'], period: { warmupFrom: '2024-01-02', start: '2024-02-01' }, halfSpreadBps: 2 }), /pending the owner's choice/);
});

test('store migration 2: the validation kind joins the run and ledger kinds, and stored results survive the table rebuild', () => {
  const dir = tempDir('hxr-mig-');
  const file = path.join(dir, 'hxr-sim.sqlite');
  // A version-1 database with one run and one fill, as the earlier code left it.
  const raw = new DatabaseSync(file);
  raw.exec(store.MIGRATIONS_V1_SQL ?? '');
  raw.close();
  if (!store.MIGRATIONS_V1_SQL) {
    // Build it through the current store, then rewind the schema version and
    // drop the rebuilt tables' marker so migration 2 runs again on real rows.
    const db = store.openHxrDb(file);
    const id = store.createRun(db, { kind: 'selection', version: 'c1-0.1.0', configHash: 'h', createdAt: '2026-10-22T00:00:00Z' });
    store.insertFills(db, id, [{ id: 'f1', date: '2024-03-04', symbol: 'MU', side: 'buy', shares: 3, price: 10 }]);
    store.appendLedger(db, { kind: 'selection', prereg: 'p', version: 'v', configHash: 'h', runIds: [id], at: '2026-10-22T00:00:00Z' });
    db.exec('UPDATE hxr_schema_version SET version = 1');
    db.close();
    const again = store.openHxrDb(file);
    assert.equal(store.schemaVersion(again), store.MIGRATION_COUNT);
    assert.equal(store.getRun(again, id).kind, 'selection', 'the run survived the rebuild');
    assert.equal(again.prepare('SELECT COUNT(*) n FROM hxr_fills WHERE run_id = ?').get(id).n, 1, 'its fill was not cascaded away');
    assert.equal(store.listLedger(again).length, 1);
    assert.ok(store.createRun(again, { kind: 'validation', version: 'v', configHash: 'h' }) > 0);
    store.appendLedger(again, { kind: 'validation', prereg: 'p', version: 'v', configHash: 'h', runIds: [], at: '2026-10-22T00:00:00Z' });
    assert.throws(() => store.appendLedger(again, { kind: 'variant', prereg: 'p', version: 'v', configHash: 'h', at: '2026-10-22T00:00:00Z' }), /CHECK constraint/);
    assert.throws(() => again.exec('DELETE FROM hxr_ledger'), /append-only/);
    assert.equal(again.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys are back on');
    again.close();
  }
});

test('hand-checked sizing: one stock, m = 1, the position cap binds; the initial-loss level is set from the fill', () => {
  // Last warm-up close 100, m = 1, d = 2.5. One stock asks for min(750 / 1, 150) = 150 of planned loss:
  // caps: planned loss 60, position 3000 / 100 = 30, open risk 300, tech/AI 105, cash 149. 30 shares, position binding.
  const cfg = small(X1B);
  const rows = [...flat(WARM), [100, 101], [101, 102], [102, 97.5], [97.5, 98]];
  const r = run(cfg, rows);
  const dec = r.decisions.find((d) => d.action === 'initial_allocation');
  assert.equal(dec.date, r.sessions[24], 'sized at the last warm-up close');
  near(dec.sizing.m, 1);
  near(dec.sizing.d, 2.5);
  assert.deepEqual([dec.sizing.shares, dec.sizing.binding, dec.sizing.plannedLossAsked], [30, ['position'], 150]);
  assert.deepEqual(dec.sizing.caps, { plannedLoss: 60, position: 30, openRisk: 300, techAi: 105, cash: 149 });
  near(dec.sizing.plannedLoss, 75);
  const buy = r.fills.find((f) => f.initial);
  assert.equal(buy.date, r.start);
  assert.equal(buy.shares, 30);
  near(buy.price, 100 * (1 + K));
  near(buy.initialLossLevel, 100 * (1 + K) - 2.5, 'L0 = E - d');
  near(buy.plannedLoss, 75);
  near(r.equity[0].cash, 15000 - 30 * 100 * (1 + K), 'pooled cash after the fill');
  // 97.5 < L0 = 97.54: an initial-loss exit (X1 has no recovery-point level yet).
  const exit = r.decisions.find((d) => d.side === 'sell');
  assert.equal(exit.date, r.sessions[27]);
  assert.equal(exit.trigger, 'initial_loss');
  near(exit.values.initialLossLevel, 100 * (1 + K) - 2.5);
  const sell = r.fills.find((f) => f.side === 'sell');
  assert.equal(sell.trigger, 'initial_loss');
  assert.equal(r.episodes[0].endTrigger, 'initial_loss');
  const m = computeRunMetrics(r);
  assert.deepEqual([m.initialLossExits, m.ruleExits, m.pooled], [1, 0, true]);
  assert.deepEqual(m.sizing.bindingCaps, { position: 1 });
  // With no position cap the planned loss binds: 60 shares.
  const loose = run(small(X1B, { risk: { maxPositionUsd: 1e6 } }), rows);
  const d2 = loose.decisions.find((d) => d.action === 'initial_allocation');
  assert.deepEqual([d2.sizing.shares, d2.sizing.binding], [60, ['plannedLoss']]);
  near(loose.fills[0].plannedLoss, 150);
});

test('the open-risk and tech/AI budgets are shared: each stock (alphabetical) sizes against the room the earlier ones reserved', () => {
  // Two stocks, each asking for min(200 / 2, 150) = 100 of planned loss: 100 / 2.5 = 40 shares at 100.
  // AAA: caps planned loss 40, position 1e6 / 100, open risk 200 / 2.5 = 80, tech/AI 10500 / 100 = 105, cash 15000 / 100.04 = 149.
  // BBB, after AAA reserved 100 of risk, 4001.6 of cash and 4000 of tech/AI exposure: open risk (200 - 100) / 2.5 = 40 (a tie with the
  // planned loss), tech/AI (10500 - 4000) / 100 = 65, cash (15000 - 4001.6) / 100.04 = 109.
  const cfg = small(X1B, { risk: { totalOpenRiskUsd: 200, maxPositionUsd: 1e6 } });
  const rows = [...flat(WARM), [100, 100.5], [100.5, 101]];
  const r = run(cfg, { AAA: rows, BBB: rows });
  const a = r.decisions.find((d) => d.symbol === 'AAA' && d.action === 'initial_allocation'), b = r.decisions.find((d) => d.symbol === 'BBB' && d.action === 'initial_allocation');
  near(a.sizing.m, 1); near(a.sizing.d, 2.5); near(a.sizing.plannedLossAsked, 100);
  assert.deepEqual([a.sizing.shares, a.sizing.binding, a.sizing.caps], [40, ['plannedLoss'], { plannedLoss: 40, position: 10000, openRisk: 80, techAi: 105, cash: 149 }]);
  assert.deepEqual([b.sizing.shares, b.sizing.binding, b.sizing.caps, b.sizing.reservedRisk, b.sizing.reservedTech], [40, ['plannedLoss', 'openRisk'], { plannedLoss: 40, position: 10000, openRisk: 40, techAi: 65, cash: 109 }, 100, 4000]);
  near(b.sizing.availableCash, 15000 - 40 * 100 * (1 + K));
  assert.deepEqual(r.fills.map((f) => [f.symbol, f.shares]), [['AAA', 40], ['BBB', 40]]);
  near(r.equity[0].openRisk, 80 * (100.5 - (100 * (1 + K) - 2.5)), 'open risk at the first close: shares x (close - L0) for both');
  // Tech/AI cap 4500: AAA (tagged) is held to 45 shares; BBB (untagged) is unaffected.
  const t = run(small(X1B, { risk: { maxTechAiExposureUsd: 4500, maxPositionUsd: 1e6 } }), { AAA: rows, BBB: rows }, { tags: { AAA: true, BBB: false } });
  const ta = t.decisions.find((d) => d.symbol === 'AAA' && d.action === 'initial_allocation'), tb = t.decisions.find((d) => d.symbol === 'BBB' && d.action === 'initial_allocation');
  assert.deepEqual([ta.sizing.plannedLossAsked, ta.sizing.shares, ta.sizing.binding], [150, 45, ['techAi']]);
  assert.deepEqual([tb.sizing.shares, tb.sizing.binding, tb.sizing.caps.techAi], [60, ['plannedLoss'], null], 'no tech/AI cap for an untagged stock (null, which survives JSON)');
  near(t.equity[0].techAi, 45 * 100.5, 'tech/AI exposure at the first close counts only the tagged stock');
  // Below the minimum (half the planned loss asked for): a position cap of 2000 allows 20 shares, a planned loss of 50 against a minimum of 75.
  const tiny = run(small(X1B, { risk: { maxPositionUsd: 2000 } }), { AAA: rows, BBB: rows });
  assert.equal(tiny.fills.length, 0);
  const w = tiny.warnings.filter((x) => x.code === 'entry_skipped');
  assert.deepEqual(w.map((x) => [x.symbol, x.details.code]), [['AAA', 'budget'], ['BBB', 'budget']]);
  assert.match(w[0].message, /planned loss 50\.00 is below the minimum 75\.00 \(position binding\)/);
  assert.deepEqual(computeRunMetrics(tiny).neverEntered, ['AAA', 'BBB']);
  assert.equal(tiny.sleeves.find((s) => s.symbol === 'BBB').fresh?.afterMissedRebound, false, 'waiting as never held');
});

test('the account-decline pause: new buys lapse while paused, exits still run, the pause ends when the decline is small again', () => {
  // Pause at a US$40 decline, resume at US$10. AAA falls through its initial-loss level (a ~US$80 loss on 30 shares),
  // which pauses the account; its buy-back signal then lapses as paused. BBB keeps rising and lifts the account back.
  const cfg = small(X1B, { risk: { pauseDeclineUsd: 40, resumeDeclineUsd: 10 } });
  const aaa = [...flat(WARM), [100, 101], [101, 97], [97, 96], [96, 95], [95, 94], [94, 95], [95, 96], [96, 97], [97, 97.5], [97.5, 98], [98, 98]];
  const bbb = [...flat(WARM), [100, 100], [100, 100], [100, 100], [100, 100], [100, 100], [100, 101], [101, 103], [103, 105], [105, 107], [107, 109], [109, 111]];
  const r = run(cfg, { AAA: aaa, BBB: bbb });
  const codes = count(r.warnings, (w) => w.code);
  assert.equal(codes.pause_start, 1);
  const start = r.warnings.find((w) => w.code === 'pause_start');
  assert.ok(start.details.decline >= 40);
  const paused = r.equity.filter((p) => p.paused).map((p) => p.date);
  assert.ok(paused.length >= 2 && paused[0] === start.date);
  // AAA's recovery point (close 94, two closes either side, then up by at least m) is confirmed while paused: the buy lapses.
  const lapsed = r.warnings.find((w) => w.code === 'entry_skipped' && w.details.code === 'paused');
  assert.ok(lapsed, 'a buy signal lapsed as paused');
  assert.ok(paused.includes(lapsed.date));
  assert.equal(codes.pause_end, 1, 'BBB lifts the account back within the resume level');
  const end = r.warnings.find((w) => w.code === 'pause_end');
  assert.ok(end.date > start.date && end.details.decline <= 10);
  assert.equal(r.fills.filter((f) => f.side === 'buy' && !f.initial && f.date >= start.date && f.date <= end.date).length, 0, 'no buy filled while paused');
  const m = computeRunMetrics(r);
  assert.deepEqual([m.pauses.count, m.pauses.sessions], [1, paused.length]);
  assert.equal(m.sizing.lapsedSignals.paused, 1);
});

// A missed rebound: buy at 100, exit at the initial-loss level, then the price closes back above the sale price.
const MISSED = [...flat(WARM), [100, 101], [101, 97.4], [97.4, 97], [97, 99], [99, 100], [100, 98.5], [98.5, 96], [96, 94], [94, 96], [96, 98], [98, 99], [99, 99.5], [99.5, 100], [100, 99], [99, 97], [97, 95], [95, 97], [97, 99], [99, 100], [100, 101]];

test('fresh-entry policy A: after a missed rebound the stock stays in cash; the later recovery points are ignored', () => {
  const r = run(small(X1A), MISSED);
  assert.equal(r.fills.filter((f) => f.side === 'sell').length, 1);
  const missed = r.warnings.find((w) => w.code === 'rebound_missed');
  assert.ok(missed && missed.details.policy === 'stay_out');
  assert.equal(r.fills.filter((f) => f.side === 'buy' && !f.initial).length, 0);
  assert.equal(r.freshEntries.length, 0);
  assert.equal(r.sleeves[0].retired, true);
  const m = computeRunMetrics(r);
  assert.deepEqual([m.reboundsMissedEvents.count, m.reboundsMissedEvents.retired, m.freshEntries.count], [1, 1, 0]);
});

test('fresh-entry policy B: a fresh entry at the next recovery point, at any price, reported apart from buy-backs', () => {
  const r = run(small(X1B), MISSED);
  const missed = r.warnings.find((w) => w.code === 'rebound_missed');
  assert.equal(missed.details.policy, 'fresh_entry_recovery_point');
  const fresh = r.decisions.find((d) => d.action === 'fresh_entry');
  assert.ok(fresh, 'a fresh-entry decision');
  assert.ok(fresh.date > missed.date, 'only a recovery point formed after the missed rebound counts');
  assert.equal(fresh.values.afterMissedRebound, true);
  const fill = r.fills.find((f) => f.fresh);
  assert.equal(fill.date, r.sessions[r.sessions.indexOf(fresh.date) + 1]);
  assert.equal(r.freshEntries.length, 1);
  const fe = r.freshEntries[0];
  assert.equal(fe.afterMissedRebound, true);
  assert.equal(fe.neverHeld, false);
  near(fe.previousExitPrice, r.fills.find((f) => f.side === 'sell').price);
  near(fe.premiumPct, (fe.price / fe.previousExitPrice - 1) * 100);
  assert.equal(r.roundTrips.length, 0, 'a fresh entry is not a round trip');
  assert.equal(r.episodes.find((e) => e.startKind === 'fresh_entry').startFillId, fill.id);
  assert.ok(Number.isFinite(fill.initialLossLevel), 'the new holding gets its own initial-loss level');
  const m = computeRunMetrics(r);
  assert.deepEqual([m.freshEntries.count, m.freshEntries.afterMissedRebound, m.buyBacks.count], [1, 1, 0]);
  near(m.freshEntries.avgPremiumPct, fe.premiumPct);
});

test('fresh-entry policy C: the same, but only after the cooling-off sessions', () => {
  const b = run(small(X1B), MISSED);
  const freshB = b.decisions.find((d) => d.action === 'fresh_entry');
  const c3 = run(small(X1C, { rule: { freshEntryMinSessions: 3 } }), MISSED);
  const freshC = c3.decisions.find((d) => d.action === 'fresh_entry');
  assert.ok(freshC, 'with a short cooling-off the same point is taken');
  assert.ok(freshC.values.sessionsOut >= 3);
  const c99 = run(small(X1C, { rule: { freshEntryMinSessions: 99 } }), MISSED);
  assert.equal(c99.decisions.filter((d) => d.action === 'fresh_entry').length, 0, 'a long cooling-off never re-enters in this path');
  assert.equal(c99.sleeves[0].fresh?.afterMissedRebound, true, 'still waiting, not retired');
  assert.ok(freshC.date >= freshB.date);
});

test('a stock never held, or whose buy lapsed, enters at the next recovery point at any price', () => {
  // The initial allocation cannot be sized without a typical move: the stock waits, then enters on a recovery point.
  const noWarm = run(small(X1B), [[100, 100], [100, 101], [101, 102], [102, 101], [101, 100], [100, 99], [99, 98], [98, 99.5], [99.5, 100.5], [100.5, 101], [101, 101.5], [101.5, 102], [102, 102.5], [102.5, 103]], { warmup: 0 });
  assert.equal(noWarm.fills.filter((f) => f.initial).length, 0);
  assert.ok(noWarm.warnings.some((w) => w.code === 'order_cancelled' && w.details.code === 'insufficient_history'));
  const fresh = noWarm.decisions.find((d) => d.action === 'fresh_entry');
  assert.ok(fresh, 'entered later as never held');
  assert.equal(fresh.values.afterMissedRebound, false);
  assert.equal(noWarm.freshEntries[0].neverHeld, true);
  assert.equal(noWarm.freshEntries[0].previousExitPrice, null);
});

test('X2 and X3 under the initial-loss rule: the exit level is the higher of L0 and the rule level; the rule exit keeps its trigger', () => {
  // X2 (allowance 1 x m): after a rise the allowance level is above L0, so the X2 exit fires first and is a rule exit.
  const x2 = small(X2B, { rule: { multiple: 1 } });
  const r = run(x2, [...flat(WARM), [100, 101], [101, 104], [104, 106], [106, 104], [104, 103]]);
  const sell = r.decisions.find((d) => d.side === 'sell');
  assert.equal(sell.trigger, 'rule');
  assert.ok(sell.values.initialLossLevel < sell.values.level, 'the rule level is above L0');
  const sl = r.sleeves[0];
  assert.equal(effectiveLevel(x2.rule, { ...sl, state: 'in', L0: 90, anchorHigh: 106, history: [104, 106, 104, 103] }), 106 - 1 * 1.5);
  assert.equal(effectiveLevel(x2.rule, { state: 'in', L0: 110, anchorHigh: 106, history: [104, 106, 104, 103] }), 110, 'L0 above the rule level');
  assert.equal(exitPriceNow({ splitFactor: 1, lastExit: null }), null);
});

test("the day-one hold: the candidate's initial allocation, never sold, a derived config with its own version", () => {
  const d1 = holdDayOneConfig(X1B);
  assert.equal(d1.version, 'x1b-0.3.0:hold-day-one');
  assert.equal(d1.rule.type, 'hold');
  assert.deepEqual(d1.benchmark, { kind: 'hold_day_one', from: 'x1b-0.3.0', baseHash: hxrConfigHash(X1B) });
  assert.equal(d1.variant, undefined, 'not a variant: the final run builds variants of it');
  assert.equal(d1.initialLoss.volSessions, 20);
  assert.throws(() => holdDayOneConfig(loadHxrConfig('hxr-x1-0.2.0.json')), /risk-sized candidate/);
  const rows = { AAA: [...flat(WARM), [100, 101], [101, 97], [97, 96], [96, 98], [98, 99]], BBB: [...flat(WARM), [100, 99], [99, 98], [98, 97], [97, 96], [96, 95]] };
  const cand = run(small(X1B), rows), bench = run(holdDayOneConfig(small(X1B)), rows);
  assert.deepEqual(bench.fills.map((f) => [f.symbol, f.shares, f.price]), cand.fills.filter((f) => f.initial).map((f) => [f.symbol, f.shares, f.price]), 'the same day-one positions');
  assert.ok(bench.fills.every((f) => f.initial) && bench.decisions.every((d) => d.action === 'initial_allocation'), 'never sells');
  assert.ok(cand.fills.some((f) => f.side === 'sell'), 'the candidate did sell');
  near(bench.equity[0].cash, cand.equity[0].cash, 'the same leftover cash on day one');
});

// ---------- pick rules, two benchmarks, the validation gate ----------

const M = (o) => ({ sessions: 960, roundTrips: 25, maxDrawdownPct: 20, returnToDrawdown: 0.6, annualisedReturnPct: 12, endValue: 20000, perStock: Array(10).fill({}), ...o });
const HOLD = (o) => M({ roundTrips: 0, maxDrawdownPct: 40, returnToDrawdown: 0.4, annualisedReturnPct: 16, endValue: 21000, ...o });
const DAY1 = (o) => M({ roundTrips: 0, maxDrawdownPct: 25, returnToDrawdown: 0.5, annualisedReturnPct: 13, endValue: 19000, ...o });

test('pick rule (a) most profit and (b) best return per unit of fall, each against both benchmarks; pending refuses', () => {
  const sel = clone(CRITERIA.selection);
  assert.equal(sel.pickRule, 'ending_value', 'amendment 3b (2026-10-23)');
  const c = (name, roundTrips, endValue, returnToDrawdown, maxDrawdownPct = 20) => ({ name, metrics: M({ roundTrips, endValue, returnToDrawdown, maxDrawdownPct }) });
  const pending = selectCandidate({ ...sel, pickRule: 'pending_owner_choice' }, { hold: HOLD(), holdDayOne: DAY1(), candidates: [c('x1a', 12, 30000, 2)] });
  assert.equal(pending.chosen, null);
  assert.match(pending.reason, /pending the owner's choice/);
  // (a): the highest ending value above both benchmarks' (21000 and 19000); a tie goes to the smaller decline; 9 round trips do not qualify.
  const a = selectCandidate({ ...sel, pickRule: 'ending_value' }, { hold: HOLD(), holdDayOne: DAY1(), candidates: [c('x1a', 12, 22000, 0.3, 30), c('x1b', 9, 40000, 3), c('x2a', 15, 22000, 0.9, 25)] });
  assert.equal(a.chosen, 'x2a');
  assert.match(a.reason, /tie broken by the smaller largest decline/);
  assert.equal(a.threshold, 21000);
  assert.deepEqual(a.table.map((r) => [r.name, r.qualifies, r.rank]), [['x1a', true, 2], ['x1b', false, null], ['x2a', true, 1]]);
  const aStop = selectCandidate({ ...sel, pickRule: 'ending_value' }, { hold: HOLD(), holdDayOne: DAY1(), candidates: [c('x1a', 12, 21000, 2)] });
  assert.equal(aStop.chosen, null, 'equal to the hold is not beating it');
  assert.match(aStop.reason, /^stop: /);
  // (b): the highest ratio, at least 1.10 x each benchmark's (0.4 -> 0.44 and 0.5 -> 0.55: the higher bar is 0.55).
  const b = selectCandidate({ ...sel, pickRule: 'return_to_drawdown' }, { hold: HOLD(), holdDayOne: DAY1(), candidates: [c('x1a', 12, 18000, 0.56), c('x2b', 15, 25000, 0.5)] });
  assert.equal(b.chosen, 'x1a', 'the ratio decides even with a lower ending value');
  near(b.threshold, 0.55);
  const bStop = selectCandidate({ ...sel, pickRule: 'return_to_drawdown' }, { hold: HOLD(), holdDayOne: DAY1(), candidates: [c('x1a', 12, 18000, 0.54)] });
  assert.equal(bStop.chosen, null);
  assert.match(bStop.reason, /validation and the final period are not used/);
  assert.equal(selectCandidate({ ...sel, pickRule: 'ending_value' }, { hold: HOLD(), candidates: [c('x1a', 12, 30000, 2)] }).chosen, null, 'a missing benchmark stops the pick');
});

test('criteria against both benchmarks: a gate passes only if it passes against each; G1 uses the fully invested hold', () => {
  const loo = (hx = {}) => ['MU', 'AMZN', 'META', 'TSLA', 'VST', 'GOOG', 'INTC', 'CSCO', 'PYPL', 'SNAP'].map((left) => ({ left, hxr: M(hx), hold: HOLD(), holdDayOne: DAY1() }));
  const runs = (o = {}) => ({
    main: { hxr: M(o.hxr), hold: HOLD(o.hold), holdDayOne: DAY1(o.day1) },
    costs2x: { hxr: M({ maxDrawdownPct: 18, returnToDrawdown: 0.58, ...o.costs2x }), hold: HOLD(), holdDayOne: DAY1() },
    delay2: { hxr: M({ maxDrawdownPct: 18, returnToDrawdown: 0.58, ...o.delay2 }), hold: HOLD(), holdDayOne: DAY1() },
    leaveOneOut: loo({ maxDrawdownPct: 18, returnToDrawdown: 0.58 }),
  });
  // Passing against both: decline 20 <= 0.75 x 25 (day-one) and <= 30 (hold); ratio 0.6 >= 0.55 and >= 0.44; return 12 >= 13 - 5 and >= 11.
  const ok = evaluateCriteria(CRITERIA, runs({ hxr: { maxDrawdownPct: 18, returnToDrawdown: 0.58 } }));
  assert.equal(ok.outcome, 'PASS');
  const g2 = ok.criteria.find((c) => c.id === 'G2');
  assert.deepEqual(Object.keys(g2.value.byBenchmark), ['hold', 'holdDayOne']);
  near(g2.value.byBenchmark.holdDayOne.value.limit, 18.75);
  assert.match(g2.note, /day-one hold/);
  // Against the hold alone G2 would pass (20 <= 30); against the day-one hold it fails (20 > 18.75): the gate fails.
  const fail = evaluateCriteria(CRITERIA, runs({ hxr: { maxDrawdownPct: 20, returnToDrawdown: 0.58 } }));
  assert.equal(fail.criteria.find((c) => c.id === 'G2').status, 'fail');
  assert.equal(fail.outcome, 'FAIL');
  // G1's 20% decline requirement is the fully invested hold's, not the day-one hold's.
  const g1 = evaluateCriteria(CRITERIA, runs({ hold: { maxDrawdownPct: 19 }, day1: { maxDrawdownPct: 30 } }));
  assert.equal(g1.outcome, 'INSUFFICIENT_EVIDENCE');
  // G6 = 9 of 10 under criteria v3a.
  const bad = runs({ hxr: { maxDrawdownPct: 18, returnToDrawdown: 0.58 } });
  bad.leaveOneOut = bad.leaveOneOut.map((r, i) => (i < 2 ? { ...r, hxr: M({ returnToDrawdown: 0.3 }) } : r));
  assert.equal(evaluateCriteria(CRITERIA, bad).criteria.find((c) => c.id === 'G6').status, 'fail');
  bad.leaveOneOut = bad.leaveOneOut.map((r, i) => (i < 1 ? { ...r, hxr: M({ returnToDrawdown: 0.3 }) } : { ...r, hxr: M({ maxDrawdownPct: 18, returnToDrawdown: 0.58 }) }));
  assert.equal(evaluateCriteria(CRITERIA, bad).criteria.find((c) => c.id === 'G6').status, 'pass');
  assert.deepEqual(Object.keys(compareBenchmarks(M(), { hold: HOLD(), holdDayOne: DAY1() })), ['hold', 'holdDayOne']);
});

test('the validation gate: V1 round trips, V2 at least 1.10 x each benchmark; outcomes and the contaminated repeat', () => {
  const v = (hx, extra) => evaluateValidation(CRITERIA, { hxr: M(hx), hold: HOLD(), holdDayOne: DAY1() }, extra);
  assert.equal(v({ returnToDrawdown: 0.56 }).outcome, 'validated');
  assert.equal(v({ returnToDrawdown: 0.5 }).outcome, 'did_not_validate', '0.5 reaches the hold bar (0.44) but not the day-one bar (0.55)');
  assert.equal(v({ roundTrips: 9, returnToDrawdown: 0.9 }).outcome, 'insufficient_evidence');
  assert.equal(v({ returnToDrawdown: null }).outcome, 'insufficient_evidence');
  const rep = v({ returnToDrawdown: 0.56 }, { contaminated: true });
  assert.equal(rep.outcome, 'not_counted_contaminated');
  assert.match(rep.meaning, /never validate/);
  assert.deepEqual(v({ returnToDrawdown: 0.56 }).criteria.map((c) => c.id), ['V1', 'V2']);
});

// ---------- prefix invariance, a future-data test and snapshots on synthetic data ----------

const SYMS = ['AAA', 'BBB', 'CCC', 'DDD'].map((s, i) => ({ symbol: s, exchange: i === 1 ? 'NYSE' : 'NASDAQ', listedFrom: '2016-01-04', techAi: i !== 3 }));
function synthetic({ end = '2024-12-31', bump = null } = {}) {
  const sessions = periodSessions({ warmupFrom: '2021-06-01', end });
  const days = new Map();
  const st = { AAA: { x: 7, p: 50 }, BBB: { x: 11, p: 80 }, CCC: { x: 5, p: 20 }, DDD: { x: 3, p: 140 } };
  sessions.forEach((d, i) => {
    const bars = {};
    for (const [sym, s] of Object.entries(st)) {
      s.x = (Math.imul(s.x, 1664525) + 1013904223) >>> 0;
      const r = s.x / 2 ** 32 - 0.5;
      const prev = s.p;
      s.p = s.p * (1 + 0.035 * r + 0.01 * Math.sin(i / (13 + Object.keys(st).indexOf(sym) * 6)));
      const k = bump && d > bump.after ? bump.factor : 1;
      bars[sym] = { o: prev * k, h: Math.max(prev, s.p) * k * 1.004, l: Math.min(prev, s.p) * k * 0.996, c: s.p * k, v: 1e6 };
    }
    days.set(d, { bars, splits: [], dividends: [] });
  });
  return { days, sessions };
}
const PERIOD = { warmupFrom: '2021-06-01', start: '2022-01-03', end: '2024-12-31' };
const runFull = (config, data) => runBacktest({ config, symbols: SYMS, period: PERIOD, inputs: { ...data, halfSpreadBps: 2 } });
const ARMS = ['x1a', 'x1b', 'x1c', 'x2a', 'x2b', 'x2c', 'x3a', 'x3b', 'x3c'].map((v) => [v, loadHxrConfig(`hxr-${v}-0.3.0.json`)]);
ARMS.push(['hold-day-one', holdDayOneConfig(ARMS[1][1])]);
const KEYS = ['decisions', 'fills', 'warnings', 'equity', 'freshEntries', 'roundTrips'];
const dateKey = (k) => (k === 'roundTrips' ? 'buyBackDate' : 'date');

for (const [name, cfg] of ARMS) {
  test(`${name}: prefix invariance, future-data test, snapshot round-trip and determinism`, () => {
    const data = synthetic();
    const full = runFull(cfg, data);
    assert.ok(full.fills.length >= 1, 'at least the initial allocation');
    for (const frac of [0.2, 0.45, 0.7, 0.93]) {
      const cut = data.sessions[Math.floor(data.sessions.length * frac)];
      const e = createEngine({ config: cfg, symbols: SYMS, period: { ...PERIOD, end: null }, halfSpreadBps: 2 });
      for (const d of data.sessions) { if (d > cut) break; e.processSession(d, data.days.get(d)); }
      const part = e.output();
      for (const k of KEYS) assert.deepEqual(part[k], full[k].filter((x) => x[dateKey(k)] <= cut), `${name} ${k} up to ${cut}`);
    }
    const T = '2023-08-15';
    for (const factor of [0.6, 1.7]) {
      const b = runFull(cfg, synthetic({ bump: { after: T, factor } }));
      for (const k of KEYS) assert.deepEqual(b[k].filter((x) => x[dateKey(k)] <= T), full[k].filter((x) => x[dateKey(k)] <= T), `${name} ${k} up to ${T} (later prices x${factor})`);
      assert.notEqual(b.meta.inputsHash, full.meta.inputsHash);
    }
    assert.deepEqual(runFull(cfg, data).fills, full.fills, 'deterministic');
    const cut = Math.floor(data.sessions.length * 0.5);
    const a = createEngine({ config: cfg, symbols: SYMS, period: PERIOD, halfSpreadBps: 2 });
    for (const d of data.sessions.slice(0, cut)) a.processSession(d, data.days.get(d));
    const b = createEngine({ config: cfg, symbols: SYMS, period: PERIOD, halfSpreadBps: 2, state: JSON.parse(JSON.stringify(a.snapshot())) });
    for (const d of data.sessions.slice(cut)) b.processSession(d, data.days.get(d));
    const out = b.finish();
    for (const k of [...KEYS, 'episodes', 'pool']) assert.deepEqual(out[k], full[k], `${name} ${k} after a restore`);
  });
}
