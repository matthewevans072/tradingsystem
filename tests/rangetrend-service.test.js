// Range-trend service: the file guard, the gate (protocol fields and hash, the owner-decisions entry, the
// practice runs listed in the log, pinned configs, HXR's development period, the reserve), the atomic ledger
// slot, interrupted runs, a benchmark failure, the backup, and practice runs end to end on a synthetic HXR
// database (tests/hxr-fake-alpaca.js, read through HXR's data layer, read-only). The repository's own
// EVALUATION-PROTOCOL.md and EXPERIMENT-LOG.md are never relied on: temp copies are used. Synthetic prices
// only exercise code; nothing here is a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import { NO_HOST_KEYS } from './no-host-keys.js';
import { fakeAlpaca, buildMarket, KEY_ID, SECRET_KEY } from './hxr-fake-alpaca.js';
import { loadConfig as loadAppConfig } from '../server/config.js';
import { createContext } from '../server/context.js';
import { createBackup, rangeTrendBackupDir } from '../server/backup.js';
import { createHxr } from '../server/hxr/service.js';
import { loadHxrPeriods } from '../server/hxr/config.js';
import { createRangeTrend, periodProblem } from '../server/rangetrend/service.js';
import * as store from '../server/rangetrend/store.js';
import { protocolStatus, logStatus, loadConfig, configHash, CODE_REVISION, PLANNED_CONFIGS, RT_CONFIG_DIR, UNSET } from '../server/rangetrend/config.js';

const rejectsWith = async (p, status, re) => assert.rejects(p, (e) => (e.status === status && (!re || re.test(e.message))) || assert.fail(`${e.status} ${e.message}`));
const PROTO = '# Evaluation protocol (test copy)\n\n**Date-choice rule:** a test date rule\n\n**Pick rule:** a test pick rule\n';
const LOG = '| # | When | What | Data touched | Results seen? |\n|---|---|---|---|---|\n| 1 | 2026-10-27 | **Owner decisions D1-D8** (test copy): D1 a, D2 b, D3 c, D4 d, D5 e, D6 f, D7 g, D8 h. | none | No |\n';
function files(dir, { proto = PROTO, log = LOG } = {}) {
  const protocolPath = path.join(dir, 'proto.md'), logPath = path.join(dir, 'log.md');
  if (proto != null) fs.writeFileSync(protocolPath, proto);
  if (log != null) fs.writeFileSync(logPath, log);
  return { protocolPath, logPath };
}

test('file guard: never the portfolio, demo, Strategy Lab or HXR databases, nor a file with foreign tables', () => {
  const dir = tempDir('rt-guard-');
  for (const name of ['signal-desk.sqlite', 'demo.sqlite', 'strategy-lab.sqlite', 'strategy-lab-demo.sqlite', 'hxr-sim.sqlite', 'HXR-SIM.sqlite']) {
    assert.throws(() => store.guardRtFile(path.join(dir, name)), /never opens/, name);
  }
  const foreign = path.join(dir, 'other.sqlite');
  const d = new DatabaseSync(foreign);
  d.exec('CREATE TABLE holdings (x)');
  d.close();
  assert.throws(() => store.openRtDb(foreign), /not range-trend's/);
  const db = store.openRtDb(path.join(dir, 'range-trend-sim.sqlite'));
  assert.throws(() => db.exec("INSERT INTO rt_runs (kind, config_file, version, config_hash, config_json, status, protocol_hash, code_revision, created_at) VALUES ('holdout', 'x', 'v', 'h', '{}', 'done', 'p', 'c', 't')"), /CHECK constraint/);
  db.close();
  // The HXR market data is read only from the data directory, unless a test says otherwise.
  assert.throws(() => createRangeTrend({ dataDir: dir, hxrDbFile: path.join(tempDir('elsewhere-'), 'hxr-sim.sqlite') }), /only from the data directory/);
  createRangeTrend({ dataDir: dir, hxrDbFile: path.join(tempDir('elsewhere-'), 'hxr-sim.sqlite'), allowExternalHxrDb: true }).close();
});

test('protocol fields: dedicated lines only; empty, [OWNER, TBD, TODO and ? count as unset; the hash ignores line endings', () => {
  const dir = tempDir('rt-proto-');
  const f = path.join(dir, 'p.md');
  assert.equal(protocolStatus(f).exists, false);
  for (const [text, ready] of [
    ['**Pick rule:** x\n', false],
    ['**Pick rule:** a rule\n**Date-choice rule:** TBD\n', false],
    ['**Pick rule:** best? maybe\n**Date-choice rule:** a rule\n', false],
    ['The pick rule: chosen later. **Pick rule:** inline text does not count\n**Date-choice rule:** a rule\n', false],
    [PROTO, true],
  ]) { fs.writeFileSync(f, text); assert.equal(protocolStatus(f).ready, ready, text); }
  assert.deepEqual(['', '[OWNER TO SET]', 'TBD', 'todo', 'which?', 'a rule'].map(UNSET), [true, true, true, true, true, false]);
  fs.writeFileSync(f, PROTO.replace(/\n/g, '\r\n'));
  const crlf = protocolStatus(f).hash;
  fs.writeFileSync(f, PROTO);
  assert.equal(protocolStatus(f).hash, crlf);
});

test('the experiment log: the owner-decisions entry needs its own row naming D1-D8; listed practice runs are read', () => {
  const dir = tempDir('rt-log-');
  const f = path.join(dir, 'log.md');
  fs.writeFileSync(f, LOG);
  assert.equal(logStatus(f).ownerDecisions, true);
  fs.writeFileSync(f, LOG.replace('D8 h', 'D9 h'));
  assert.equal(logStatus(f).ownerDecisions, false, 'D8 missing');
  fs.writeFileSync(f, '| 1 | x | **Provisional readings D1-D9, pending the owner\'s decision**: D1 D2 D3 D4 D5 D6 D7 D8 | none | No |\n');
  assert.equal(logStatus(f).ownerDecisions, false, 'a provisional-readings entry is not the owner\'s decisions');
  fs.writeFileSync(f, LOG + `| 2 | x | **Practice run** run id: 7, config hash: ${'a'.repeat(64)} | none | Yes |\n`);
  assert.deepEqual(logStatus(f).practiceRuns, [{ runId: 7, configHash: 'a'.repeat(64) }]);
});

test('configs are pinned and must use HXR\'s development period', () => {
  const dir = tempDir('rt-pin-');
  const file = PLANNED_CONFIGS[0];
  const copy = path.join(dir, file);
  fs.writeFileSync(copy, fs.readFileSync(path.join(RT_CONFIG_DIR, file), 'utf8').replace('"positionCapPct": 20', '"positionCapPct": 25'));
  assert.throws(() => loadConfig(copy), /differs from its pinned SHA-256/);
  fs.writeFileSync(copy, fs.readFileSync(path.join(RT_CONFIG_DIR, file), 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(loadConfig(copy).version, loadConfig(file).version, 'line endings do not matter');
  const dev = loadHxrPeriods().periods.development;
  for (const f of PLANNED_CONFIGS) assert.equal(periodProblem(loadConfig(f), dev), null, f);
  assert.match(periodProblem({ period: { ...loadConfig(file).period, end: '2022-06-30' } }, dev), /not HXR's development period/);
});

test('refusals before anything is recorded: confirm, protocol fields, owner decisions, unplanned configs, missing HXR data', async () => {
  const dir = tempDir('rt-svc-');
  const cases = [
    [{ proto: null }, PLANNED_CONFIGS[0], true, 409, /EVALUATION-PROTOCOL.md does not exist/],
    [{ proto: '**Pick rule:** a rule\n' }, PLANNED_CONFIGS[0], true, 409, /no date-choice rule/],
    [{ log: '| 1 | x | nothing | none | No |\n' }, PLANNED_CONFIGS[0], true, 409, /no owner-decisions entry covering D1-D8/],
    [{}, 'rt-range-dip-nolimit-0.2.0.json', true, 400, /Only the planned configs/],
    [{}, PLANNED_CONFIGS[0], undefined, 400, /confirm: true/],
    [{}, PLANNED_CONFIGS[0], true, 409, /No HXR market data/],
  ];
  for (const [opts, configFile, confirm, status, re] of cases) {
    const sub = tempDir('rt-svc-case-');
    const rt = createRangeTrend({ dataDir: sub, ...files(sub, opts) });
    await rejectsWith(rt.runPractice({ configFile, confirm }), status, re);
    assert.equal(rt.ledger().length, 0, 'nothing recorded');
    rt.close();
  }
  assert.ok(!fs.readdirSync(dir).length);
});

test('the ledger slot is atomic: one row per config, one reserve in all; an interrupted run is failed and stays used', () => {
  const dir = tempDir('rt-slot-');
  const db = store.openRtDb(store.rtDbFile(dir));
  const base = { configFile: PLANNED_CONFIGS[0], version: 'v', configHash: 'h', config: {}, protocolHash: 'p', codeRevision: CODE_REVISION, at: '2026-10-27T00:00:00Z' };
  const id = store.reserveSlot(db, base);
  assert.throws(() => store.reserveSlot(db, base), /UNIQUE/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rt_runs').get().n, 1, 'the failed second slot left no run row');
  store.reserveSlot(db, { ...base, reserve: { invalidatedRunId: id } });
  assert.throws(() => store.reserveSlot(db, { ...base, configFile: PLANNED_CONFIGS[1], reserve: { invalidatedRunId: id } }), /UNIQUE/);
  db.close();
  // The process stopped while run `id` was running: the next start records it as failed; its slot stays used.
  const rt = createRangeTrend({ dataDir: dir, ...files(dir) });
  assert.deepEqual([rt.getRun(id).status, /interrupted/.test(rt.getRun(id).error)], ['failed', true]);
  assert.equal(rt.ledger().length, 2);
  rt.close();
});

// A fake market in which TSLA forms a range and breaks out just before its 5-for-1 split of 2020-08-31, then
// rises gently through it, so the immediate-breakout config holds a position across the split. Prices are
// continuous and keep the raw split factors, so HXR's readiness checks still pass.
function marketWithTslaBreakout() {
  const market = buildMarket();
  const bars = market.TSLA, dates = [...bars.keys()].sort();
  const factor = (d) => (d < '2020-08-31' ? 15 : d < '2022-08-25' ? 3 : 1);
  const ib = dates.findIndex((d) => d >= '2020-08-17');
  const adj = (d) => bars.get(d).c / factor(d);
  const s = adj(dates[ib - 66]) / 100;
  const PAT = [100, 102, 104, 106, 108, 110, 108, 106, 104, 102];
  const path0 = [...Array.from({ length: 6 }, () => PAT).flat(), 100, 102, 104, 106, 108, 111.5, ...Array.from({ length: 26 }, (_, k) => 112 + 0.5 * k)];
  let prevRaw = bars.get(dates[ib - 66]).c;
  path0.forEach((x, k) => {
    const d = dates[ib - 65 + k], c = x * s * factor(d), o = (prevRaw / factor(dates[ib - 66 + k])) * factor(d);
    bars.set(d, { ...bars.get(d), o, c, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, vw: (o + c) / 2, vw15: o });
    prevRaw = c;
  });
  const last = ib - 65 + path0.length - 1, g = adj(dates[last]) / adj(dates[last + 1]);
  for (const d of dates.slice(last + 1)) { const b = bars.get(d); bars.set(d, { ...b, o: b.o * g, h: b.h * g, l: b.l * g, c: b.c * g, vw: b.vw * g, vw15: b.vw15 * g }); }
  return market;
}
async function hxrData(dir, market) {
  let now = Date.parse('2026-10-22T22:00:00Z');
  const clock = () => new Date(now);
  const fake = fakeAlpaca({ clock, market, news: [] });
  const cfg = loadAppConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none', ALPACA_API_KEY_ID: KEY_ID, ALPACA_API_SECRET_KEY: SECRET_KEY });
  const hxr = createHxr({ cfg, mode: 'real' }, { clock, fetchImpl: fake.fetchImpl, sleep: async () => {} });
  hxr.fetchData();
  await hxr.fetchDone;
  return { hxr, cfg, clock };
}

test('practice runs end to end: a trade held across a split, provenance, both benchmarks, the gate after the first run, the reserve, a benchmark failure, the backup', { timeout: 300000 }, async () => {
  const dir = tempDir('rt-run-');
  const { hxr, cfg, clock } = await hxrData(dir, marketWithTslaBreakout());
  const hxrCounts = () => ['hxr_runs', 'hxr_ledger', 'hxr_experiments'].map((t) => hxr.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
  const before = hxrCounts();
  const f = files(dir);
  let rt = createRangeTrend({ dataDir: dir, ...f, clock });
  const file = 'rt-trend-immediate-nolimit-0.1.0.json';
  const r = await rt.runPractice({ configFile: file, confirm: true });
  assert.equal(r.status, 'done');
  assert.deepEqual(r.errors, []);
  const run = rt.getRun(r.id);
  assert.deepEqual([run.code_revision, run.details.codeRevision], [CODE_REVISION, CODE_REVISION]);
  assert.match(run.details.symbolsHash, /^[0-9a-f]{64}$/);
  assert.equal(run.symbols_hash, run.details.symbolsHash);
  assert.match(run.data_hash, /^[0-9a-f]{64}$/);
  assert.equal(run.details.benchmarkEngineVersion, 'hxr-engine-3');
  assert.deepEqual(run.details.meta.symbols.filter((s) => !s.techAi).map((s) => s.symbol), ['VST']);
  // The planted TSLA trade is held across the 5-for-1 split.
  const split = run.details.splits.find((s) => s.symbol === 'TSLA' && s.date === '2020-08-31');
  assert.ok(split && split.sharesAfter > 0, 'a TSLA position is held across its split');
  assert.equal(split.sharesAfter % 5, 0, 'shares multiplied by 5');
  assert.ok(run.details.trades.length + run.details.openPositions.length >= 1);
  const eq = rt.db.prepare('SELECT json FROM rt_equity WHERE run_id = ?').all(r.id).map((x) => JSON.parse(x.json));
  for (const p of eq) { assert.ok(Math.abs(p.equity - (p.cash + p.holdings)) < 1e-6); assert.ok(p.cash >= -1e-9); }
  assert.ok(eq.some((p) => p.invested > 0), 'invested on some days');
  const em = run.metrics.benchmarks.exposureMatched;
  assert.notEqual(em.endValue, 15000, 'the exposure-matched hold moves when the run is invested');
  assert.ok(em.endValue > 0 && Math.abs(em.endValue - 15000) < Math.abs(run.metrics.benchmarks.buyAndHold.endValue - 15000), 'it moves less than the fully invested hold');
  assert.deepEqual(hxrCounts(), before, 'the HXR database was only read');
  // Once only; the reserve needs the same config hash and the defect, verification and correction.
  await rejectsWith(rt.runPractice({ configFile: file, confirm: true }), 409, /already run/);
  await rejectsWith(rt.runPractice({ configFile: file, confirm: true, reserve: { invalidatedRunId: r.id, defect: 'x' } }), 400, /defect, how it was verified and the correction/);
  const reserve = { invalidatedRunId: r.id, defect: 'test defect', verification: 'test verification', correction: 'test correction' };
  // A benchmark failure is recorded as such and the strategy result is kept (a missing hold config, test only).
  rt.close();
  rt = createRangeTrend({ dataDir: dir, ...f, clock, holdConfigFile: 'hxr-missing-0.0.0.json' });
  const r2 = await rt.runPractice({ configFile: file, confirm: true, reserve });
  assert.equal(r2.status, 'done');
  assert.match(r2.errors.join(), /benchmark \(a\) failed/);
  const run2 = rt.getRun(r2.id);
  assert.match(run2.error, /benchmark \(a\) failed/);
  assert.ok(run2.details.trades.length + run2.details.openPositions.length >= 1, 'the strategy result is kept');
  assert.equal(run2.metrics.benchmarks, undefined);
  assert.deepEqual(rt.ledger().map((e) => [e.run_id, e.reserve]), [[r.id, false], [r2.id, true]]);
  assert.equal(rt.getRun(r.id).status, 'done', 'the earlier result is kept');
  await rejectsWith(rt.runPractice({ configFile: file, confirm: true, reserve }), 409, /reserve run has already been used/);
  assert.throws(() => rt.db.exec('DELETE FROM rt_ledger'), /append-only/);
  // The protocol is fixed at the first practice run.
  fs.writeFileSync(f.protocolPath, PROTO.replace('a test pick rule', 'another pick rule'));
  await rejectsWith(rt.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), 409, /changed since the first practice run/);
  fs.writeFileSync(f.protocolPath, PROTO);
  rt.close();
  // The backup: a consistent copy in backups/range-trend.
  const ctx = createContext(cfg, 'real');
  const b = createBackup(ctx, { reason: 'manual' });
  assert.match(b.rangeTrend.name, /^range-trend-sim-.*-manual\.sqlite$/);
  const copy = new DatabaseSync(path.join(rangeTrendBackupDir(cfg), b.rangeTrend.name), { readOnly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM rt_ledger').get().n, 2);
  copy.close();
  // A fresh database cannot reset the budget: the log lists a practice run it does not contain.
  const fresh = tempDir('rt-fresh-');
  fs.copyFileSync(path.join(dir, 'hxr-sim.sqlite'), path.join(fresh, 'hxr-sim.sqlite'));
  const logged = files(fresh, { log: LOG + `| 2 | 2026-10-27 | **Practice run** run id: ${r.id}, config hash: ${configHash(loadConfig(file))} | development | Yes |\n` });
  const rt3 = createRangeTrend({ dataDir: fresh, ...logged, clock });
  await rejectsWith(rt3.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), 409, /does not contain/);
  rt3.close();
  hxr.close();
});
