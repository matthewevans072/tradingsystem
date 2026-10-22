// Strategy Lab backend (strategy/LAB-ARCHITECTURE.md): the separate lab
// database, the service on synthetic data, CSV import, the simulated forward
// test with a fake provider and clock, the TradingView alert receiver, the
// /api/lab routes through the real HTTP server, backups and the scheduler
// hook. Synthetic prices only test code; nothing here is strategy performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import { loadConfig, redact, publicConfigStatus } from '../server/config.js';
import { createServer, lazyContexts } from '../server/index.js';
import { createContext } from '../server/context.js';
import { createBackup, listBackups, validateBackupFile, labBackupDir } from '../server/backup.js';
import { createScheduler } from '../server/scheduler.js';
import { createTwelveData } from '../server/providers/twelvedata.js';
import { ProviderError } from '../server/providers/http.js';
import * as store from '../server/strategy/store.js';
import { createLab, SYNTHETIC_LABEL, parseParameterLog } from '../server/strategy/lab.js';
import { advanceForward, latestCompletedBar, forwardResults } from '../server/strategy/forward.js';
import { createWebhookServer, handleAlert, startLabWebhook } from '../server/strategy/webhook.js';
import { loadStrategyConfig, loadUniverse } from '../server/strategy/config.js';
import { generateSyntheticBars } from '../server/strategy/synthetic.js';
import { zonedToUtc, NY } from '../server/time.js';

const CONFIG = loadStrategyConfig();
const UNIVERSE = loadUniverse();
const SYMS = UNIVERSE.symbols.map((s) => s.symbol);
const MIN = 60000;
const ZONE = NY;

const cfgFor = (dir, extra = {}) => loadConfig({ ENV_FILE: path.join(dir, 'none.env'), SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none', ...extra });
// A context without a portfolio database: any access to ctx.db fails the test.
function labCtx(dir, mode = 'real', market = null) {
  const ctx = { cfg: cfgFor(dir), mode, providers: { market } };
  Object.defineProperty(ctx, 'db', { get() { throw new Error('the Strategy Lab touched the portfolio database'); } });
  return ctx;
}
const etIso = (date, hh, mm) => zonedToUtc(date, hh, mm, NY).toISOString();
const tvCsv = (bars) => `time,open,high,low,close,Volume\n${bars.map((b) => `${Date.parse(b.t) / 1000},${b.o},${b.h},${b.l},${b.c},${b.v ?? ''}`).join('\n')}\n`;
const waitFor = async (fn, ms = 60000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
};

// ---------- store ----------

test('store: separate lab database, additive migrations, never a portfolio file', () => {
  const dir = tempDir();
  const cfg = cfgFor(dir);
  assert.equal(path.basename(store.labDbFile(cfg, 'real')), 'strategy-lab.sqlite');
  assert.equal(path.basename(store.labDbFile(cfg, 'demo')), 'strategy-lab-demo.sqlite');
  const file = store.labDbFile(cfg, 'real');
  let db = store.openLabDb(file);
  assert.equal(store.schemaVersion(db), store.MIGRATION_COUNT);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  for (const t of ['lab_bars', 'lab_runs', 'lab_trades', 'lab_events', 'lab_equity', 'lab_forward', 'lab_webhook_alerts', 'lab_holdout_runs', 'lab_param_changes', 'lab_settings']) assert.ok(tables.has(t), t);
  assert.ok(!tables.has('transactions'), 'no portfolio tables');
  store.upsertBars(db, 'NVDA', [{ t: '2024-03-05T14:30:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }], { source: 'csv' });
  db.close();
  db = store.openLabDb(file); // reopening keeps data and does not re-run migrations
  assert.equal(store.schemaVersion(db), store.MIGRATION_COUNT);
  assert.equal(store.getBars(db, 'NVDA').length, 1);
  const r = store.upsertBars(db, 'NVDA', [{ t: '2024-03-05T14:30:00Z', o: 1, h: 2, l: 0.5, c: 1.6, v: 10 }, { t: '2024-03-05T14:45:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }], { source: 'csv' });
  assert.deepEqual(r, { inserted: 1, replaced: 1 });
  db.close();
  for (const f of ['signal-desk.sqlite', 'demo.sqlite']) assert.throws(() => store.openLabDb(path.join(dir, f)), /never opens the portfolio database/);
  assert.ok(!fs.existsSync(path.join(dir, 'signal-desk.sqlite')));
});

test('store: holdout ledger and alerts keep their records; duplicates never overwrite', () => {
  const db = store.openLabDb(path.join(tempDir(), 'strategy-lab.sqlite'));
  const l = store.holdoutLedger(db, 7);
  assert.equal(l.count('1.0.0', 'h', 'swing'), 0);
  l.record({ version: '1.0.0', configHash: 'h', mode: 'swing', at: '2026-10-21T00:00:00Z', reason: null, contaminated: false });
  assert.equal(l.count('1.0.0', 'h', 'swing'), 1);
  assert.equal(l.count('1.0.0', 'h', 'intraday'), 0);
  const a = { receivedAt: 'x', status: 'accepted', dedupeKey: 'k1', symbol: 'NVDA', event: 'order_placed', barTime: 't' };
  assert.equal(store.insertAlert(db, a).status, 'accepted');
  assert.equal(store.insertAlert(db, a).status, 'duplicate');
  assert.deepEqual(store.listAlerts(db).map((x) => x.status), ['duplicate', 'accepted']);
  db.close();
});

// ---------- versions ----------

test('versions: configs, parameter log and a diff between versions', () => {
  const dir = tempDir();
  const configs = path.join(dir, 'configs');
  fs.mkdirSync(configs);
  const base = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../strategy/configs/cb-1.0.0.json'), 'utf8'));
  fs.writeFileSync(path.join(configs, 'cb-1.0.0.json'), JSON.stringify(base));
  fs.writeFileSync(path.join(configs, 'cb-1.1.0.json'), JSON.stringify({ ...base, version: '1.1.0', box: { ...base.box, maxHeightAtr: 3.5 } }));
  const log = path.join(dir, 'PARAMETER-LOG.md');
  fs.writeFileSync(log, '| Date | Version | Change | Reason | Data seen before the change |\n|---|---|---|---|---|\n| 2026-10-21 | cb-1.0.0 | Initial | First version | none |\n| 2026-11-01 | cb-1.1.0 | box.maxHeightAtr 3.5 | test reason | development |\n');
  assert.equal(parseParameterLog(fs.readFileSync(log, 'utf8')).length, 2);
  const lab = createLab(labCtx(dir), { configsDir: configs, parameterLog: log });
  const v = lab.versions();
  assert.equal(v.simulated, true);
  assert.equal(v.active.version, '1.1.0', 'the newest version is active');
  assert.deepEqual(v.configs.map((c) => [c.version, c.valid, c.active]), [['1.0.0', true, false], ['1.1.0', true, true]]);
  const changed = v.labChanges.filter((c) => c.toVersion === '1.1.0').map((c) => c.path);
  assert.ok(changed.includes('box.maxHeightAtr') && changed.includes('version'));
  assert.equal(v.labChanges.find((c) => c.path === 'box.maxHeightAtr').reason, 'test reason');
  assert.equal(v.labChanges.find((c) => c.path === 'box.maxHeightAtr').dataSeen, 'development');
  const d = lab.diffVersions('cb-1.0.0', '1.1.0');
  assert.equal(d.sameRules, false);
  assert.deepEqual(d.changes.find((c) => c.path === 'box.maxHeightAtr'), { path: 'box.maxHeightAtr', from: 3, to: 3.5, descriptive: false });
  assert.deepEqual(d.parameterLog.map((l) => l.version), ['1.1.0']);
  assert.equal(lab.diffVersions('1.0.0', '1.0.0').changes.length, 0);
  assert.throws(() => lab.diffVersions('1.0.0', '9.9.9'), (e) => e.status === 404);
  // Editing a config without a new version is recorded, not hidden.
  fs.writeFileSync(path.join(configs, 'cb-1.1.0.json'), JSON.stringify({ ...base, version: '1.1.0', box: { ...base.box, maxHeightAtr: 3.4 } }));
  lab.close();
  const lab2 = createLab(labCtx(dir), { configsDir: configs, parameterLog: log });
  assert.ok(lab2.versions().labChanges.some((c) => c.fromVersion === '1.1.0' && c.toVersion === '1.1.0' && /changed without a new version/.test(c.reason)));
  lab2.close();
});

// ---------- the service on synthetic data (demo workspace) ----------

test('demo workspace: synthetic seeding, runs, trades with explanations, holdout guard', { timeout: 240000 }, async () => {
  const dir = tempDir();
  const lab = createLab(labCtx(dir, 'demo'), { demo: { symbols: ['NVDA', 'JPM', 'SPY', 'XOM', 'CAT'], to: '2025-03-31' } });
  const early = lab.overview({ mode: 'swing' });
  assert.equal(early.status, 'preparing', 'startup is not blocked; the overview says preparing');
  assert.equal(early.synthetic, true);
  assert.equal(early.syntheticLabel, SYNTHETIC_LABEL);
  assert.equal(early.simulated, true);
  assert.match(early.realPortfolio, /\$0/);
  assert.match(early.realPortfolio, /not buying power/);
  assert.throws(() => lab.startBacktest({ mode: 'swing', split: 'development' }), (e) => e.status === 409, 'busy while preparing');
  await lab.ready;

  const ov = lab.overview({ mode: 'swing' });
  assert.equal(ov.status, 'ready');
  assert.equal(ov.synthetic, true);
  const runs = lab.listRuns({}).runs;
  const backtests = runs.filter((r) => r.kind === 'backtest');
  assert.deepEqual(backtests.map((r) => `${r.mode}/${r.split}`).sort(), ['intraday/development', 'intraday/validation', 'swing/development', 'swing/validation']);
  assert.ok(runs.every((r) => r.synthetic && r.status === 'done'), 'every demo run is flagged synthetic');
  assert.ok(backtests.every((r) => r.label.startsWith(SYNTHETIC_LABEL)));
  const fwdRuns = runs.filter((r) => r.kind === 'forward');
  assert.equal(fwdRuns.length, 2, 'a synthetic forward replay per mode');
  assert.equal(ov.forward.status, 'replay');
  assert.equal(ov.forward.canRun, false);
  assert.ok(ov.recentDecisions.length > 0, 'the replay leaves a journal');
  assert.ok(ov.data.symbols.filter((s) => s.bars > 0).every((s) => s.synthetic));
  assert.equal(ov.acceptance.synthetic, true);
  assert.ok(ov.acceptance.criteria.every((c) => c.status === 'not_evaluable'), 'synthetic data can neither pass nor fail a criterion');

  const dev = lab.getRun(backtests.find((r) => r.mode === 'swing' && r.split === 'development').id);
  assert.equal(dev.run.synthetic, true);
  assert.ok(dev.run.metrics.trades > 0);
  assert.ok(dev.run.equity.length > 100, 'downsampled daily equity');
  assert.ok(dev.run.equity.every((p, i, a) => i === 0 || p.date > a[i - 1].date));
  assert.ok(dev.run.groups.symbol && dev.run.groups.cluster && dev.run.groups.regime, 'by-symbol, cluster and regime tables');
  assert.match(dev.run.report, /SYNTHETIC DATA/);
  assert.ok(dev.run.acceptance?.criteria?.length, 'acceptance stored with the run');

  const trades = lab.listTrades({ source: 'backtest', runId: dev.run.id, limit: 500 });
  assert.equal(trades.total, dev.run.tradeCount);
  const t = lab.getTrade(trades.trades[0].id);
  assert.equal(t.simulated, true);
  assert.equal(t.synthetic, true);
  assert.match(t.explanation.setup.text, /window is the 20 completed bars/);
  assert.match(t.explanation.signal.text, /above the frozen ceiling/);
  assert.ok(t.explanation.exit.text.length > 20);
  assert.ok(t.events.some((e) => e.type === 'entry_filled'));
  assert.throws(() => lab.getTrade(999999), (e) => e.status === 404);

  const j = lab.journal({ source: 'backtest', mode: 'swing', type: 'skips', limit: 20 });
  assert.ok(j.items.length > 0);
  assert.ok(j.items.every((i) => ['signal_rejected', 'entry_skipped'].includes(i.type) && i.explanation));
  const setups = lab.journal({ source: 'backtest', mode: 'swing', type: 'setup_eligible', limit: 3 });
  assert.match(setups.items[0].explanation, /ATR/);

  const chart = lab.bars({ symbol: 'NVDA', from: '2023-03-01', to: '2023-03-31', mode: 'swing' });
  assert.ok(chart.bars.length > 300);
  assert.equal(chart.run.kind, 'backtest');
  assert.ok(chart.boxes.length > 0);
  assert.ok(chart.boxes.every((b) => ['open', 'expired', 'invalidated', 'breakout'].includes(b.outcome) && b.why));

  // Holdout: refused without confirmation, once clean, then only with a reason (contaminated).
  assert.throws(() => lab.startHoldout({ mode: 'swing' }), (e) => e.status === 400 && /Confirm/.test(e.message));
  assert.throws(() => lab.startBacktest({ mode: 'swing', split: 'holdout' }), (e) => e.status === 400);
  const h1 = await lab.runHoldout({ mode: 'swing', confirm: true });
  assert.equal(h1.run.status, 'done');
  assert.equal(h1.run.contaminated, false);
  assert.ok(h1.run.details.variants.costs2x && h1.run.details.variants.tvPath);
  assert.throws(() => lab.startHoldout({ mode: 'swing', confirm: true }), (e) => e.status === 409 && /written reason/.test(e.message));
  const h2 = await lab.runHoldout({ mode: 'swing', confirm: true, reason: 'checking the report layout after a code fix' });
  assert.equal(h2.run.contaminated, true);
  assert.equal(h2.run.reason, 'checking the report layout after a code fix');
  const ledger = lab.versions().holdoutRuns;
  assert.deepEqual(ledger.map((x) => [x.mode, x.contaminated, x.run_id]), [['swing', false, h1.run.id], ['swing', true, h2.run.id]]);
  const ev = lab.evaluation({ mode: 'swing' });
  assert.equal(ev.basedOn.holdoutRunId, h1.run.id, 'the clean holdout is the evaluation');
  assert.equal(ev.evaluation.holdoutContaminated, false);
  // The demo never runs a live forward test or takes real data.
  assert.throws(() => lab.setForward({ mode: 'swing', enabled: true }), (e) => e.status === 400);
  assert.throws(() => lab.importCsv({ symbol: 'NVDA', text: 'time,open,high,low,close\n' }), (e) => e.status === 400 && /synthetic data only/.test(e.message));
  lab.close();
});

// ---------- real workspace ----------

test('real workspace: no synthetic data, says exactly what data is needed', { timeout: 120000 }, async () => {
  const dir = tempDir();
  // A demo lab in the same data folder must not leak into the real one.
  const demo = createLab(labCtx(dir, 'demo'), { demo: { symbols: ['NVDA', 'SPY'], to: '2022-03-31' } });
  await demo.ready;
  demo.close();
  const lab = createLab(labCtx(dir, 'real'));
  const ov = lab.overview({ mode: 'intraday' });
  assert.equal(ov.status, 'needs_data');
  assert.equal(ov.synthetic, false);
  assert.equal(ov.syntheticLabel, undefined);
  assert.equal(ov.simulated, true);
  assert.equal(ov.needs.universe.length, 17);
  assert.equal(ov.needs.dateRange.from, '2021-07-01');
  assert.equal(ov.needs.dateRange.to, '2026-06-30');
  assert.ok(ov.needs.dataSources.some((s) => /TradingView/.test(s)));
  assert.equal(ov.forward.canRun, false);
  assert.match(ov.forward.reason, /none/);
  assert.equal(lab.listRuns({}).runs.length, 0);
  assert.equal(lab.bars({ symbol: 'NVDA' }).bars.length, 0);
  assert.ok(!store.hasSyntheticBars(lab.db));
  assert.throws(() => lab.startBacktest({ mode: 'intraday', split: 'development' }), (e) => e.status === 400 && /No bars/.test(e.message));
  assert.throws(() => lab.setForward({ mode: 'intraday', enabled: true }), (e) => e.status === 400 && /provider/.test(e.message));
  assert.throws(() => lab.fetchHistory({}), (e) => e.status === 400 && /MARKET_DATA_PROVIDER/.test(e.message));
  lab.close();
  assert.ok(!fs.existsSync(path.join(dir, 'signal-desk.sqlite')), 'the lab never creates or opens the portfolio database');
});

test('CSV import: normalised, stored and returned with a quality report', () => {
  const dir = tempDir();
  const lab = createLab(labCtx(dir));
  const day = (d, list) => list.map(([hh, mm, o, h, l, c, v]) => ({ t: etIso(d, hh, mm), o, h, l, c, v }));
  const bars = [
    ...day('2024-03-05', [[9, 15, 10, 10.5, 9.9, 10.2, 100]]), // pre-market: dropped
    ...day('2024-03-05', Array.from({ length: 26 }, (_, i) => [9 + Math.floor((30 + 15 * i) / 60), (30 + 15 * i) % 60, 10, 10.5, 9.9, 10.2, 1000]).filter((_, i) => i !== 5)), // one bar missing
    ...day('2024-03-06', Array.from({ length: 26 }, (_, i) => [9 + Math.floor((30 + 15 * i) / 60), (30 + 15 * i) % 60, 10, 10.5, 9.9, 10.2, i === 3 ? '' : 1000])),
  ];
  const r = lab.importCsv({ symbol: 'nvda', text: tvCsv(bars) });
  assert.equal(r.simulated, true);
  assert.equal(r.symbol, 'NVDA');
  assert.equal(r.format, 'tradingview');
  assert.equal(r.dropped.outsideSession, 1);
  assert.deepEqual(r.stored, { inserted: 51, replaced: 0 });
  assert.equal(r.quality.missingBars, 1);
  assert.equal(r.quality.missingVolume, 1);
  assert.equal(r.quality.ok, false);
  assert.match(r.dataHash, /^[0-9a-f]{64}$/);
  assert.ok(r.notes.some((n) => /pre-registered data start/.test(n)));
  assert.deepEqual(lab.importCsv({ symbol: 'NVDA', text: tvCsv(bars) }).stored, { inserted: 0, replaced: 51 });
  const stored = store.getBars(lab.db, 'NVDA');
  assert.equal(stored.length, 51);
  assert.equal(stored[0].t, '2024-03-05T14:30:00.000Z');
  assert.equal(lab.overview({ mode: 'swing' }).status, 'ready');
  assert.throws(() => lab.importCsv({ symbol: 'AAPL', text: tvCsv(bars) }), (e) => e.status === 400 && /not in universe-v1/.test(e.message));
  assert.throws(() => lab.importCsv({ symbol: 'NVDA', text: 'x'.repeat(20 * 1024 * 1024 + 1) }), (e) => e.status === 413);
  assert.throws(() => lab.importCsv({ symbol: 'NVDA', text: 'a,b\n1,2\n' }), (e) => e.status === 400);
  assert.throws(() => lab.importCsv({ symbol: 'NVDA', exchange: 'NYSE', text: tvCsv(bars) }), (e) => e.status === 400 && /NASDAQ/.test(e.message));
  lab.close();
});

// ---------- forward test ----------

const SYN = generateSyntheticBars({ symbols: SYMS, from: '2024-01-02', to: '2024-03-28', seed: 11 });
const at = (T) => (typeof T === 'number' ? T : Date.parse(T));

test('forward core: each bar time once, snapshot restart is identical, late signals expire', () => {
  const symbols = UNIVERSE.symbols;
  const tradeFrom = '2024-01-10';
  const onTime = (T) => T + 15 * MIN + MIN;
  const full = advanceForward({ config: CONFIG, mode: 'swing', symbols, tradeFrom, bars: SYN.bars, now: onTime });
  const all = full.engine.events;
  const order = all.find((e) => e.type === 'order_placed');
  assert.ok(order, 'the synthetic data produce at least one order');

  // Restart from a snapshot halfway: the same decisions, nothing processed twice.
  const cut = Date.parse('2024-02-15T15:00:00Z');
  let state = null;
  const first = advanceForward({ config: CONFIG, mode: 'swing', symbols, tradeFrom, bars: SYN.bars, now: (T) => (T <= cut ? onTime(T) : T), onStep: (s) => { state = s.state; } });
  assert.equal(first.processedThrough, new Date(cut).toISOString());
  const events = [...first.engine.events];
  const second = advanceForward({ config: CONFIG, mode: 'swing', symbols, state, bars: SYN.bars, now: onTime, onStep: (s) => events.push(...s.events) });
  assert.ok(second.steps.length > 0 && Date.parse(second.steps[0].t) > cut, 'only bars after the snapshot are processed');
  assert.deepEqual(events.map((e) => `${e.at}|${e.symbol}|${e.type}`), all.map((e) => `${e.at}|${e.symbol}|${e.type}`));
  const again = advanceForward({ config: CONFIG, mode: 'swing', symbols, state: second.engine.snapshot(), bars: SYN.bars, now: onTime });
  assert.equal(again.steps.length, 0, 'a processed bar time is never processed again');

  // The same order's bar processed 10 minutes after its close (limit 5): expired.
  const T0 = Date.parse(order.at);
  const late = advanceForward({ config: CONFIG, mode: 'swing', symbols, tradeFrom, bars: SYN.bars, now: (T) => (T === T0 ? T + 25 * MIN : onTime(T)), maxSignalDelayMin: 5 });
  const lev = late.engine.events;
  const skip = lev.find((e) => e.type === 'entry_skipped' && e.details.orderId === order.details.orderId);
  assert.equal(skip.details.code, 'expired');
  assert.match(skip.reason, /10 minutes after its close \(limit 5\)/);
  assert.ok(!lev.some((e) => e.type === 'entry_filled' && e.details.tradeId === order.details.orderId), 'an expired signal is never filled');
  assert.ok(lev.some((e) => e.type === 'data_warning' && e.details.code === 'late_bars' && e.at === order.at));
  // Within the limit the same signal stands.
  const ok = advanceForward({ config: CONFIG, mode: 'swing', symbols, tradeFrom, bars: SYN.bars, now: (T) => (T === T0 ? T + 19 * MIN : onTime(T)) });
  assert.ok(!ok.engine.events.some((e) => e.details?.code === 'expired'));
  // An unfinished bar is never decided on.
  const partial = advanceForward({ config: CONFIG, mode: 'swing', symbols, tradeFrom, bars: SYN.bars, now: Date.parse('2024-01-03T15:10:00Z') });
  assert.equal(partial.processedThrough, '2024-01-03T14:45:00.000Z');
});

test('latestCompletedBar follows the exchange calendar', () => {
  assert.equal(new Date(latestCompletedBar(Date.parse('2024-03-06T15:16:00Z'))).toISOString(), '2024-03-06T15:00:00.000Z');
  assert.equal(new Date(latestCompletedBar(Date.parse('2024-03-06T14:40:00Z'))).toISOString(), '2024-03-05T20:45:00.000Z', 'before the first bar closes: the previous session');
  assert.equal(new Date(latestCompletedBar(Date.parse('2024-03-09T15:00:00Z'))).toISOString(), '2024-03-08T20:45:00.000Z', 'weekend');
  assert.equal(new Date(latestCompletedBar(Date.parse('2024-11-29T19:00:00Z'))).toISOString(), '2024-11-29T17:45:00.000Z', 'early close');
});

// Serves the synthetic series as a market-data provider would: only bars that
// have started by the clock (the in-progress bar too), and failures on request.
function fakeProvider(clock) {
  const p = {
    id: 'fake', name: 'Fake provider', capabilities: { intradayBars: true }, calls: 0, fail: new Set(),
    rows(inst, from, to) {
      if (p.fail.has(inst.symbol)) throw new ProviderError('server', 'Fake provider: provider error (HTTP 500)');
      const now = clock().getTime();
      return (SYN.bars.get(inst.symbol) || []).filter((b) => b.t.slice(0, 10) >= from && b.t.slice(0, 10) <= to && Date.parse(b.t) <= now)
        .map((b) => ({ ts: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, session: 'regular' }));
    },
    async getIntradayBars(inst, date) { p.calls++; return p.rows(inst, date, date); },
    async getIntradayRange(inst, from, to) { p.calls++; return p.rows(inst, from, to); },
  };
  return p;
}

test('forward tick: fake provider and clock, provider errors, sleep catch-up, restart, never the portfolio DB', async () => {
  const dir = tempDir();
  let now = new Date(etIso('2024-03-06', 10, 7));
  const clock = () => now;
  const provider = fakeProvider(clock);
  const ctx = labCtx(dir, 'real', provider);
  let lab = createLab(ctx, { clock });
  const on = lab.setForward({ mode: 'swing', enabled: true });
  assert.equal(on.forward.status, 'running');
  assert.equal(on.forward.version, CONFIG.version);
  assert.equal(on.simulated, true);
  const runId = on.forward.runId;

  now = new Date(etIso('2024-03-06', 10, 16));
  let r = await lab.tick({ now });
  assert.equal(r.forward[0].errors.length, 0);
  let f = store.getForward(lab.db, 'swing');
  assert.equal(f.processedThrough, etIso('2024-03-06', 10, 0), 'warm-up through the last completed bar; the in-progress bar is not used');
  assert.equal(store.listEquity(lab.db, runId).length, 0, 'warm-up bars before the start are not journalled');
  assert.ok(!store.getBars(lab.db, 'NVDA').some((b) => b.t === etIso('2024-03-06', 10, 15)), 'the unfinished bar is not stored');

  // Next bar: one provider request per symbol, one new bar time processed.
  provider.fail.add('JPM');
  now = new Date(etIso('2024-03-06', 10, 31));
  const calls = provider.calls;
  r = await lab.tick({ now });
  assert.equal(provider.calls - calls, 17);
  f = store.getForward(lab.db, 'swing');
  assert.equal(f.processedThrough, etIso('2024-03-06', 10, 15));
  assert.deepEqual(store.listEquity(lab.db, runId).map((p) => p.t), [etIso('2024-03-06', 10, 15)]);
  const errs = lab.journal({ source: 'forward', mode: 'swing', type: 'errors', limit: 100 }).items;
  assert.ok(errs.some((e) => e.type === 'operational_error' && e.symbol === 'JPM' && e.code === 'provider_error'), 'provider errors are journalled');
  assert.ok(errs.some((e) => e.type === 'data_warning' && e.symbol === 'JPM' && e.code === 'missing_bar'), 'the missing bar is journalled');
  // Same clock again: nothing new is fetched or processed.
  const before = store.listEvents(lab.db, { runId, limit: 10000 }).length;
  r = await lab.tick({ now });
  assert.equal(r.forward[0].upToDate, true);
  assert.equal(store.listEvents(lab.db, { runId, limit: 10000 }).length, before);

  // The app sleeps for two and a half hours, then restarts: the snapshot resumes and late bars are flagged.
  provider.fail.clear();
  lab.close();
  now = new Date(etIso('2024-03-06', 13, 2));
  lab = createLab(ctx, { clock });
  r = await lab.tick({ now });
  f = store.getForward(lab.db, 'swing');
  assert.equal(f.processedThrough, etIso('2024-03-06', 12, 45));
  const eq = store.listEquity(lab.db, runId).map((p) => p.t);
  assert.equal(new Set(eq).size, eq.length, 'every bar time once');
  assert.equal(eq.length, 11, '10:15 through 12:45');
  const warn = lab.journal({ source: 'forward', mode: 'swing', type: 'data_warning', limit: 500 }).items;
  assert.ok(warn.some((e) => e.code === 'late_bars'), 'catch-up after sleep is journalled');
  const expired = store.listEvents(lab.db, { runId, types: ['entry_skipped'], limit: 500 }).map((e) => JSON.parse(e.details_json).code);
  const placed = store.listEvents(lab.db, { runId, types: ['order_placed'], limit: 500 }).filter((e) => e.at > etIso('2024-03-06', 10, 15));
  assert.equal(expired.filter((c) => c === 'expired').length, placed.length, 'every order from a late bar expired');

  // Several days of ticks every 15 minutes, then the overview and evaluation inputs.
  for (let d of ['2024-03-07', '2024-03-08']) {
    for (let m = 9 * 60 + 46; m <= 16 * 60 + 1; m += 15) {
      now = new Date(etIso(d, Math.floor(m / 60), m % 60));
      await lab.tick({ now });
    }
  }
  f = store.getForward(lab.db, 'swing');
  assert.equal(f.processedThrough, etIso('2024-03-08', 15, 45));
  const eq2 = store.listEquity(lab.db, runId).map((p) => p.t);
  assert.equal(new Set(eq2).size, eq2.length);
  const ov = lab.overview({ mode: 'swing' });
  assert.equal(ov.forward.enabled, true);
  assert.equal(ov.synthetic, false, 'bars from the provider are not synthetic');
  assert.equal(ov.account.simulated, true);
  const fr = forwardResults(lab.db, 'swing', { now });
  assert.equal(fr.startedAt, etIso('2024-03-06', 10, 7));
  assert.ok(fr.signals.total >= fr.signals.staleOrError);
  assert.equal(fr.duplicates, 0);
  const evaluation = lab.evaluation({ mode: 'swing' });
  assert.equal(evaluation.basedOn.forwardRunId, runId);
  assert.ok(evaluation.evaluation.criteria.some((c) => c.id === 'F2' && c.status === 'pass'), 'one version and config hash');

  // Switching off and on starts a new forward run (the count restarts).
  lab.setForward({ mode: 'swing', enabled: false });
  assert.equal(store.getForward(lab.db, 'swing').status, 'stopped');
  const again = lab.setForward({ mode: 'swing', enabled: true });
  assert.notEqual(again.forward.runId, runId);
  lab.close();
  assert.ok(!fs.existsSync(path.join(dir, 'signal-desk.sqlite')), 'the portfolio database was never created or opened');
});

// ---------- TradingView alert receiver ----------

const SECRET = 'tv-secret-0123456789-abcdefghij';
const payload = (over = {}) => ({
  source: 'tradingview', strategy: 'consolidation-breakout', version: '1.0.0', mode: 'intraday', event: 'order_placed', symbol: 'NVDA', exchange: 'NASDAQ', timeframe: '15',
  barTime: Date.parse('2026-10-21T14:30:00Z'), barCloseTime: Date.parse('2026-10-21T14:45:00Z'), timenow: Date.parse('2026-10-21T14:45:01Z'),
  setupId: 'B1', orderId: 'CB1', prices: { close: 100.5, stop: 99, target: 103, maxEntry: 100.9 }, qty: 10, volume: 5000, avgVolume: 2000, reason: null, secret: SECRET, ...over,
});

function post(port, pathName, body, { method = 'POST', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: pathName, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? resolve({ status: 'reset' }) : reject(e)));
    req.end(method === 'GET' ? undefined : data);
  });
}

test('webhook: secret, size, payload, age and duplicate checks; everything recorded, the secret never', async () => {
  const db = store.openLabDb(path.join(tempDir(), 'strategy-lab.sqlite'));
  const now = Date.parse('2026-10-21T14:46:00Z');
  const server = createWebhookServer({ getDb: () => db, secret: SECRET, clock: () => now });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    assert.equal((await post(port, '/tradingview', payload({ secret: 'wrong-secret-wrong-secret-wrong' }))).status, 401);
    assert.equal((await post(port, '/tradingview', payload({ secret: undefined }))).status, 401);
    assert.equal((await post(port, '/tradingview', payload({ reason: 'x'.repeat(9000) }))).status, 413);
    assert.equal((await post(port, '/tradingview', '{not json')).status, 400);
    const bad = await post(port, '/tradingview', payload({ mode: 'scalp', barTime: 'yesterday' }));
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /mode/);
    const ok = await post(port, '/tradingview', payload());
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'accepted');
    const dup = await post(port, '/tradingview', payload());
    assert.equal(dup.status, 200);
    assert.equal(dup.body.status, 'duplicate');
    const old = await post(port, '/tradingview', payload({ barTime: Date.parse('2026-10-21T13:00:00Z'), barCloseTime: Date.parse('2026-10-21T13:15:00Z') }));
    assert.equal(old.status, 422);
    const future = await post(port, '/tradingview', payload({ barTime: Date.parse('2026-10-21T15:30:00Z'), barCloseTime: Date.parse('2026-10-21T15:45:00Z') }));
    assert.equal(future.status, 422);
    // Fill alerts carry the earlier order bar (here the previous session): still accepted.
    const fill = await post(port, '/tradingview', payload({ event: 'exit_filled', orderId: 'CB1x', barTime: Date.parse('2026-10-20T19:45:00Z'), barCloseTime: Date.parse('2026-10-20T20:00:00Z') }));
    assert.equal(fill.status, 200);
    assert.equal((await post(port, '/tradingview', '', { method: 'GET' })).status, 405);
    assert.equal((await post(port, '/other', payload())).status, 404);
  } finally {
    server.close();
  }
  const rows = store.listAlerts(db, { limit: 100 });
  const by = (s) => rows.filter((r) => r.status === s).length;
  assert.equal(by('accepted'), 2);
  assert.equal(by('duplicate'), 1);
  assert.ok(rows.some((r) => r.status === 'rejected' && /expired/.test(r.reason)));
  assert.ok(rows.some((r) => r.status === 'rejected' && /future/.test(r.reason)));
  assert.ok(rows.some((r) => r.status === 'rejected' && /over 8192 bytes/.test(r.reason)));
  assert.ok(rows.some((r) => r.status === 'rejected' && /secret/.test(r.reason)));
  assert.ok(rows.some((r) => r.status === 'rejected' && /invalid JSON/.test(r.reason)));
  assert.ok(rows.some((r) => r.status === 'rejected' && /GET/.test(r.reason)));
  const dump = JSON.stringify(db.prepare('SELECT * FROM lab_webhook_alerts').all());
  assert.ok(!dump.includes(SECRET), 'the secret is never stored');
  assert.ok(!dump.includes('wrong-secret-wrong-secret-wrong'), 'nor a wrong one');
  assert.ok(!/"secret"/.test(dump));
  // The receiver never touches the simulated account or runs.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_runs').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lab_forward').get().n, 0);
  db.close();
});

test('webhook: rate limit and a secret embedded elsewhere in the payload', async () => {
  const db = store.openLabDb(path.join(tempDir(), 'strategy-lab.sqlite'));
  const now = Date.parse('2026-10-21T14:46:00Z');
  const r = handleAlert({ db, secret: SECRET, body: JSON.stringify(payload({ reason: `copy ${SECRET}` })), now });
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(store.listAlerts(db)).includes(SECRET));
  // The alert's server-side copy numbers orders differently: same event and bar is still a duplicate.
  const resent = handleAlert({ db, secret: SECRET, body: JSON.stringify(payload({ orderId: 'CB77' })), now });
  assert.equal(resent.body.status, 'duplicate');
  assert.equal(handleAlert({ db, secret: SECRET, body: JSON.stringify(payload({ mode: 'swing' })), now }).body.status, 'accepted', 'another mode is another alert');
  const server = createWebhookServer({ getDb: () => db, secret: SECRET, clock: () => now, perMinute: 2 });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await post(port, '/tradingview', payload({ orderId: `CB${i + 10}` }))).status);
  server.close();
  assert.deepEqual(codes, [200, 200, 429, 429]);
  assert.equal(store.listAlerts(db, { limit: 100 }).filter((a) => /rate limit/.test(a.reason || '')).length, 1, 'a flood is recorded once a minute');
  assert.throws(() => createWebhookServer({ getDb: () => db, secret: 'short' }), /24/);
  db.close();
});

test('forward tick: switching off while the provider answers ends cleanly, without an error entry', async () => {
  const dir = tempDir();
  let now = new Date(etIso('2024-03-06', 10, 7));
  const clock = () => now;
  const provider = fakeProvider(clock);
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = { ...provider, getIntradayRange: async (...a) => { await gate; return provider.getIntradayRange(...a); } };
  const lab = createLab(labCtx(dir, 'real', slow), { clock });
  lab.setForward({ mode: 'swing', enabled: true });
  now = new Date(etIso('2024-03-06', 10, 16));
  const pending = lab.tick({ now });
  await new Promise((r) => setTimeout(r, 30));
  lab.setForward({ mode: 'swing', enabled: false });
  release();
  const r = await pending;
  assert.equal(r.forward[0].skipped, 'stopped');
  const f = store.getForward(lab.db, 'swing');
  assert.equal(f.status, 'stopped');
  assert.equal(f.lastError, null);
  assert.equal(f.processedThrough, null, 'nothing was processed after the stop');
  assert.equal(store.listEvents(lab.db, { types: ['operational_error'], limit: 10 }).length, 0);
  lab.close();
});

test('forward tick: lateness is judged when a bar is processed, not when the tick started', async () => {
  const dir = tempDir();
  let now = new Date(etIso('2024-03-06', 10, 7));
  const clock = () => now;
  const provider = fakeProvider(clock);
  let slowBy = 0;
  const slow = { ...provider, getIntradayBars: async (...a) => { const r = await provider.getIntradayBars(...a); now = new Date(now.getTime() + slowBy); return r; } };
  const lab = createLab(labCtx(dir, 'real', slow), { clock });
  lab.setForward({ mode: 'swing', enabled: true });
  now = new Date(etIso('2024-03-06', 10, 16));
  await lab.tick({ now });
  slowBy = 40000; // 17 symbols at 40 s each: the 10:15 bar is processed about 12 minutes after its close
  now = new Date(etIso('2024-03-06', 10, 31));
  await lab.tick({ now });
  const late = lab.journal({ source: 'forward', mode: 'swing', type: 'data_warning', limit: 50 }).items.find((e) => e.code === 'late_bars');
  assert.ok(late, 'the slow fetch made the bar late');
  assert.equal(late.at, etIso('2024-03-06', 10, 15));
  assert.ok(late.details.lateMinutes >= 11);
  lab.close();
});

test('history download: background job by quarter, per-symbol progress and errors, pause and resume after restart', async () => {
  const dir = tempDir();
  let now = new Date('2024-04-01T16:00:00Z');
  const clock = () => now;
  const provider = fakeProvider(clock);
  let limitAfter = Infinity;
  const ranged = { ...provider, async getIntradayRange(inst, from, to) {
    if (provider.calls >= limitAfter) throw new ProviderError('rate_limit', 'Daily request allowance (800) used up; data will resume tomorrow');
    if (inst.symbol === 'XOM') { provider.calls++; throw new ProviderError('not_found', 'Fake provider: not found (HTTP 404)'); }
    return provider.getIntradayRange(inst, from, to);
  } };
  let lab = createLab(labCtx(dir, 'real', ranged), { clock });
  assert.throws(() => lab.fetchHistory({ symbols: ['AAPL'] }), (e) => e.status === 400);
  assert.throws(() => lab.fetchHistory({ from: '2024-03-01', to: '2024-02-01' }), (e) => e.status === 400);
  const started = lab.fetchHistory({ symbols: ['NVDA', 'XOM', 'SPY'], from: '2023-10-01', to: '2024-03-28' });
  assert.equal(started.simulated, true);
  assert.equal(started.job.status, 'running');
  await lab.fetchDone;
  let job = lab.overview({ mode: 'swing' }).fetchJob;
  assert.equal(job.status, 'done_with_errors');
  const by = Object.fromEntries(job.symbols.map((x) => [x.symbol, x]));
  assert.equal(by.NVDA.status, 'done');
  assert.equal(by.NVDA.fetchedThrough, '2024-03-28');
  assert.equal(by.NVDA.bars, SYN.bars.get('NVDA').filter((b) => b.t >= '2023-10-01').length);
  assert.equal(by.XOM.status, 'error');
  assert.match(by.XOM.error, /not found/);
  assert.equal(store.getBars(lab.db, 'SPY').length, SYN.bars.get('SPY').length);
  assert.equal(provider.calls, 5, 'one request per symbol per quarter (Q4 2023, Q1 2024); XOM stops at its first, not-found answer');

  // The daily allowance runs out part-way: the job pauses with its progress saved...
  limitAfter = provider.calls + 1;
  lab.fetchHistory({ symbols: ['JPM', 'CAT'], from: '2023-10-01', to: '2024-03-28' });
  await lab.fetchDone;
  job = lab.fetchStatus().job;
  assert.equal(job.status, 'paused');
  assert.match(job.error, /Daily request allowance/);
  assert.ok(job.resumeAfter > now.toISOString());
  assert.equal(job.symbols.find((x) => x.symbol === 'JPM').fetchedThrough, '2023-12-31');
  assert.ok(lab.overview({ mode: 'swing' }).warnings.some((w) => /paused/.test(w)));
  // ...and resumes where it stopped after a restart, once the allowance is back.
  lab.close();
  limitAfter = Infinity;
  now = new Date('2024-04-02T16:00:00Z');
  lab = createLab(labCtx(dir, 'real', ranged), { clock });
  const callsBefore = provider.calls;
  await lab.tick({ now });
  await lab.fetchDone;
  await waitFor(() => lab.fetchStatus().job.status === 'done', 5000);
  assert.equal(provider.calls - callsBefore, 3, 'JPM Q1 2024 and both CAT quarters only');
  assert.equal(store.getBars(lab.db, 'JPM').length, SYN.bars.get('JPM').length);
  lab.close();
});

test('webhook start-up: off unless both settings are set, never with a short secret; loopback only', async () => {
  const dir = tempDir();
  assert.equal(startLabWebhook(cfgFor(dir), () => null), null);
  assert.equal(startLabWebhook(cfgFor(dir, { LAB_WEBHOOK_PORT: '4999' }), () => null), null);
  assert.equal(startLabWebhook(cfgFor(dir, { LAB_WEBHOOK_SECRET: 'short', LAB_WEBHOOK_PORT: '4999' }), () => null), null);
  assert.equal(startLabWebhook(cfgFor(dir, { LAB_WEBHOOK_SECRET: SECRET, LAB_WEBHOOK_PORT: 'abc' }), () => null), null);
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const lab = createLab(labCtx(dir));
  const server = startLabWebhook(cfgFor(dir, { LAB_WEBHOOK_SECRET: SECRET, LAB_WEBHOOK_PORT: String(port) }), () => lab);
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  assert.equal(server.address().address, '127.0.0.1');
  const res = await post(port, '/tradingview', payload({ barTime: Date.now() - 16 * MIN, barCloseTime: Date.now() - MIN }));
  assert.equal(res.status, 200);
  assert.equal(store.listAlerts(lab.db).length, 1, 'recorded in the real workspace lab database');
  await new Promise((r) => server.close(r));
  lab.close();
});

// ---------- HTTP API ----------

async function startServer(dir, extra = {}) {
  const cfg = cfgFor(dir, { SIGNAL_DESK_PORT: '0', ...extra });
  const contexts = lazyContexts(cfg);
  const probe = createServer(cfg, { contexts, scheduler: null, version: 'test' });
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  cfg.port = probe.address().port;
  probe.close();
  const server = createServer(cfg, { contexts, scheduler: null, version: 'test' });
  await new Promise((r) => server.listen(cfg.port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${cfg.port}`;
  const api = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Signal-Desk': '1', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { server, api, cfg, contexts };
}

test('API: /api/lab routes through the real server, with the CSRF header required', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const s = await startServer(dir);
  try {
    let r = await s.api('GET', '/api/lab/overview?mode=intraday');
    assert.equal(r.status, 200);
    assert.equal(r.body.simulated, true);
    assert.equal(r.body.status, 'needs_data');
    assert.equal(r.body.synthetic, false);
    assert.match(r.body.label, /hypothetical/);
    assert.equal((await s.api('GET', '/api/lab/overview?mode=scalp')).status, 400);

    // Import two symbols (synthetic prices used as test input through the real import path).
    const g = generateSyntheticBars({ symbols: ['NVDA', 'SPY'], from: '2021-07-01', to: '2023-12-31', seed: 5 });
    r = await s.api('POST', '/api/lab/import', { symbol: 'NVDA', text: tvCsv(g.bars.get('NVDA')) }, { 'X-Signal-Desk': '' });
    assert.equal(r.status, 403, 'state-changing lab requests need the CSRF header');
    r = await s.api('POST', '/api/lab/import', { symbol: 'NVDA', text: tvCsv(g.bars.get('NVDA')) }, { Origin: 'https://evil.example.com' });
    assert.equal(r.status, 403, 'foreign origin rejected');
    for (const sym of ['NVDA', 'SPY']) {
      r = await s.api('POST', '/api/lab/import', { symbol: sym, text: tvCsv(g.bars.get(sym)) });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.stored.inserted, g.bars.get(sym).length);
      assert.ok(r.body.quality);
    }
    r = await s.api('POST', '/api/lab/runs', { mode: 'intraday', split: 'holdout' });
    assert.equal(r.status, 400);
    r = await s.api('POST', '/api/lab/runs', { mode: 'intraday', split: 'development' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.run.status, 'running');
    const id = r.body.run.id;
    assert.equal((await s.api('POST', '/api/lab/runs', { mode: 'swing', split: 'validation' })).status, 409, 'one job at a time');
    const done = await waitFor(async () => { const x = await s.api('GET', `/api/lab/runs/${id}`); return x.body.run.status !== 'running' && x; });
    assert.equal(done.body.run.status, 'done', done.body.run.error);
    assert.equal(done.body.run.synthetic, false);
    assert.ok(Array.isArray(done.body.run.equity));
    assert.ok(done.body.run.report.includes('Strategy Lab backtest'));
    r = await s.api('GET', `/api/lab/runs?mode=intraday`);
    assert.equal(r.body.runs[0].id, id);
    r = await s.api('GET', `/api/lab/trades?source=backtest&runId=${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, done.body.run.tradeCount);
    if (r.body.trades.length) {
      const t = await s.api('GET', `/api/lab/trades/${r.body.trades[0].id}`);
      assert.equal(t.status, 200);
      assert.ok(t.body.explanation.setup.text && t.body.explanation.exit.text);
    }
    assert.equal((await s.api('GET', '/api/lab/trades/abc')).status, 400);
    assert.equal((await s.api('GET', '/api/lab/runs/999999')).status, 404);
    r = await s.api('GET', `/api/lab/journal?source=backtest&mode=intraday&type=signals&limit=5`);
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length <= 5);
    assert.equal((await s.api('GET', '/api/lab/journal?type=nonsense')).status, 400);
    r = await s.api('GET', '/api/lab/bars?symbol=NVDA&from=2022-03-01&to=2022-03-04&mode=intraday');
    assert.equal(r.status, 200);
    assert.equal(r.body.bars.length, 4 * 26);
    assert.equal(r.body.run.id, id);
    r = await s.api('GET', '/api/lab/versions');
    assert.equal(r.body.active.version, '1.0.0');
    r = await s.api('GET', '/api/lab/versions/diff?from=1.0.0&to=cb-1.0.0');
    assert.equal(r.body.sameRules, true);
    r = await s.api('GET', '/api/lab/evaluation?mode=intraday');
    assert.equal(r.status, 200);
    assert.ok(r.body.evaluation.criteria.length >= 14);
    r = await s.api('POST', '/api/lab/holdout', { mode: 'intraday' });
    assert.equal(r.status, 400, 'the holdout needs confirmation');
    r = await s.api('POST', '/api/lab/holdout', { mode: 'intraday', confirm: true });
    assert.equal(r.status, 400, 'no holdout data: the clean run is not used up');
    assert.match(r.body.error, /holdout period/);
    r = await s.api('POST', '/api/lab/forward', { mode: 'intraday', enabled: true }, { 'X-Signal-Desk': '' });
    assert.equal(r.status, 403);
    r = await s.api('POST', '/api/lab/forward', { mode: 'intraday', enabled: true });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /provider/);
    r = await s.api('POST', '/api/lab/fetch', {});
    assert.equal(r.status, 400);
    const big = await s.api('POST', '/api/lab/import', { symbol: 'NVDA', text: 'x'.repeat(20 * 1024 * 1024 + 10) });
    assert.equal(big.status, 413);
    // Demo workspace: synthetic and labelled; preparing does not block the request.
    r = await s.api('GET', '/api/lab/overview?mode=swing', null, { 'X-SD-Workspace': 'demo' });
    assert.equal(r.status, 200);
    assert.equal(r.body.synthetic, true);
    assert.equal(r.body.syntheticLabel, SYNTHETIC_LABEL);
    assert.equal(r.body.status, 'preparing');
    r = await s.api('POST', '/api/lab/import', { symbol: 'NVDA', text: 'time,open\n' }, { 'X-SD-Workspace': 'demo' });
    assert.equal(r.status, 400);
    // The real workspace still has no synthetic data.
    r = await s.api('GET', '/api/lab/overview?mode=intraday');
    assert.equal(r.body.synthetic, false);
    assert.ok(r.body.latestRuns.every((x) => !x.synthetic));
  } finally {
    s.contexts.get('demo').labIfOpen?.close();
    s.contexts.get('real').labIfOpen?.close();
    s.server.close();
  }
});

// ---------- backup, scheduler, config, provider ----------

test('backup copies the lab database separately; the portfolio backup list and restore are unaffected', () => {
  const dir = tempDir();
  const ctx = createContext(cfgFor(dir), 'real');
  const lab = ctx.lab;
  store.upsertBars(lab.db, 'NVDA', [{ t: '2024-03-05T14:30:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }], { source: 'csv' });
  const b = createBackup(ctx, { reason: 'manual' });
  assert.match(b.lab.name, /^strategy-lab-real-.*-manual\.sqlite$/);
  const copy = path.join(labBackupDir(ctx.cfg), b.lab.name);
  const c = new DatabaseSync(copy, { readOnly: true });
  assert.equal(c.prepare('SELECT COUNT(*) n FROM lab_bars').get().n, 1);
  c.close();
  assert.deepEqual(listBackups(ctx.cfg).map((x) => x.name), [b.name], 'only the portfolio backup is listed for restore');
  assert.doesNotThrow(() => validateBackupFile(path.join(dir, 'backups', b.name)));
  assert.throws(() => validateBackupFile(copy), /Not a Signal Desk backup/, 'a lab copy can never be restored over the portfolio');
  lab.close();
  ctx.db.close();
});

test('scheduler starts the lab tick without waiting for it', async () => {
  const dir = tempDir();
  const ctx = createContext(cfgFor(dir), 'real');
  let calls = 0, pausedCheck = null;
  Object.defineProperty(ctx, 'lab', { value: { tick: (o) => { calls++; pausedCheck = o.shouldPause; return new Promise(() => {}); } } });
  const sch = createScheduler(ctx, { clock: () => new Date('2026-10-22T18:00:00Z') });
  await sch.tick(); // would hang if the lab tick were awaited
  assert.equal(calls, 1);
  assert.equal(pausedCheck(), false);
  sch.state.running.add('briefing:pre_close:2026-10-22');
  assert.equal(pausedCheck(), true, 'provider requests pause while a briefing runs');
  ctx.db.close();
});

test('config: LAB_* settings; the webhook secret is redacted and never exposed', () => {
  const dir = tempDir();
  const secret = 'lab-secret-abcdefghijklmnopqrstuvwxyz';
  const cfg = cfgFor(dir, { LAB_WEBHOOK_SECRET: secret, LAB_WEBHOOK_PORT: '4318', LAB_MAX_SIGNAL_DELAY_MIN: '7' });
  assert.equal(cfg.lab.webhookPort, 4318);
  assert.equal(cfg.lab.maxSignalDelayMin, 7);
  assert.equal(redact(`failed with ${secret}`, cfg), 'failed with [REDACTED]');
  const pub = JSON.stringify(publicConfigStatus(cfg));
  assert.ok(!pub.includes(secret));
  assert.equal(publicConfigStatus(cfg).configured.labWebhook, true);
  const d = cfgFor(dir);
  assert.equal(d.lab.webhookPort, null);
  assert.equal(d.lab.maxSignalDelayMin, 5);
});

test('Twelve Data getIntradayRange: ranged time_series pages through the 5,000-bar cap', async () => {
  const urls = [];
  // 5,100 bars over 200 sessions; the API returns the latest 5,000 of a range.
  const all = [];
  for (let d = 0; d < 200; d++) {
    const day = new Date(Date.UTC(2023, 0, 2 + d)).toISOString().slice(0, 10);
    for (let i = 0; i < 26 && all.length < 5100; i++) all.push(`${day} ${String(9 + Math.floor((30 + 15 * i) / 60)).padStart(2, '0')}:${String((30 + 15 * i) % 60).padStart(2, '0')}:00`);
  }
  const fetchImpl = async (url) => {
    urls.push(url);
    const q = new URL(url).searchParams;
    const inRange = all.filter((t) => t >= q.get('start_date') && t <= q.get('end_date'));
    const page = inRange.slice(-Number(q.get('outputsize')));
    const values = page.map((t) => ({ datetime: t, open: '10', high: '11', low: '9', close: '10.5', volume: '100' }));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ meta: { exchange_timezone: ZONE }, values, status: 'ok' }) };
  };
  const td = createTwelveData({ apiKey: 'k-123456', plan: { perMinute: 100, perDay: 100 }, fetchImpl });
  const bars = await td.getIntradayRange({ symbol: 'NVDA', exchange: 'NASDAQ' }, '2023-01-01', '2023-12-31', '15min');
  assert.equal(bars.length, all.length);
  assert.ok(bars.every((b, i) => i === 0 || b.ts > bars[i - 1].ts));
  assert.ok(urls.length >= 2 && urls.length <= 3, `pages: ${urls.length}`);
  const q = new URL(urls[0]).searchParams;
  assert.equal(q.get('interval'), '15min');
  assert.equal(q.get('outputsize'), '5000');
  assert.equal(q.get('start_date'), '2023-01-01 00:00:00');
  assert.equal(q.get('end_date'), '2023-12-31 23:59:59');
  assert.equal(td.usage().today, urls.length, 'each page goes through the rate limiter');
});
