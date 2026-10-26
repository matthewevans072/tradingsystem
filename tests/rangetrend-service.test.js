// Range-trend service: the file guard, the protocol gate, the planned-runs-only rule, the reserve, and one
// practice run end to end on a synthetic HXR database (tests/hxr-fake-alpaca.js, read through HXR's data
// layer, read-only). Synthetic prices only exercise code; nothing here is a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import { NO_HOST_KEYS } from './no-host-keys.js';
import { fakeAlpaca, buildMarket, KEY_ID, SECRET_KEY } from './hxr-fake-alpaca.js';
import { loadConfig as loadAppConfig } from '../server/config.js';
import { createHxr } from '../server/hxr/service.js';
import { createRangeTrend } from '../server/rangetrend/service.js';
import { openRtDb, guardRtFile } from '../server/rangetrend/store.js';
import { protocolStatus, PROTOCOL_PATH, CODE_REVISION, PLANNED_CONFIGS } from '../server/rangetrend/config.js';

const rejectsWith = async (p, status, re) => assert.rejects(p, (e) => (e.status === status && (!re || re.test(e.message))) || assert.fail(`${e.status} ${e.message}`));
const PROTO_FILLED = '# Evaluation protocol (test copy)\n\n**Pick rule:** a test rule, used only in this test\n';

test('file guard: never the portfolio, demo, Strategy Lab or HXR databases, nor a file with foreign tables', () => {
  const dir = tempDir('rt-guard-');
  for (const name of ['signal-desk.sqlite', 'demo.sqlite', 'strategy-lab.sqlite', 'strategy-lab-demo.sqlite', 'hxr-sim.sqlite', 'HXR-SIM.sqlite']) {
    assert.throws(() => guardRtFile(path.join(dir, name)), /never opens/, name);
  }
  const foreign = path.join(dir, 'other.sqlite');
  const d = new DatabaseSync(foreign);
  d.exec('CREATE TABLE holdings (x)');
  d.close();
  assert.throws(() => openRtDb(foreign), /not range-trend's/);
  const db = openRtDb(path.join(dir, 'range-trend-sim.sqlite'));
  assert.throws(() => db.exec("INSERT INTO rt_runs (kind, config_file, version, config_hash, config_json, status, protocol_hash, code_revision, created_at) VALUES ('holdout', 'x', 'v', 'h', '{}', 'done', 'p', 'c', 't')"), /CHECK constraint/);
  db.close();
});

test('the protocol gate: no file, a placeholder pick rule, a filled-in pick rule; the repository file is a placeholder', () => {
  const dir = tempDir('rt-proto-');
  const f = path.join(dir, 'EVALUATION-PROTOCOL.md');
  assert.deepEqual([protocolStatus(f).exists, protocolStatus(f).ready], [false, false]);
  fs.writeFileSync(f, '**Pick rule:** [OWNER TO SET]\n');
  assert.deepEqual([protocolStatus(f).exists, protocolStatus(f).ready], [true, false]);
  fs.writeFileSync(f, PROTO_FILLED);
  assert.equal(protocolStatus(f).ready, true);
  assert.equal(protocolStatus(f).pickRule, 'a test rule, used only in this test');
  const repo = protocolStatus(PROTOCOL_PATH);
  assert.deepEqual([repo.exists, repo.ready], [true, false], 'EVALUATION-PROTOCOL.md exists with the pick rule still [OWNER TO SET]');
});

test('refusals: confirm, the repository protocol (no pick rule), unplanned configs, missing HXR data', async () => {
  const dir = tempDir('rt-svc-');
  const rt = createRangeTrend({ dataDir: dir });
  await rejectsWith(rt.runPractice({ configFile: PLANNED_CONFIGS[0] }), 400, /confirm: true/);
  await rejectsWith(rt.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), 409, /Practice runs are refused: .*no pick rule yet/);
  rt.close();
  const p = path.join(dir, 'proto.md');
  fs.writeFileSync(p, PROTO_FILLED);
  const rt2 = createRangeTrend({ dataDir: dir, protocolPath: p });
  await rejectsWith(rt2.runPractice({ configFile: 'rt-range-dip-nolimit-0.2.0.json', confirm: true }), 400, /Only the planned configs/);
  await rejectsWith(rt2.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), 409, /No HXR market data/);
  assert.equal(rt2.ledger().length, 0, 'nothing recorded by a refusal');
  rt2.close();
  assert.ok(!fs.readdirSync(dir).some((f) => /^(signal-desk|demo|strategy-lab|hxr)/i.test(f)), 'no other database created');
});

test('one practice run end to end on a synthetic HXR database: provenance, tags, benchmarks, ledger, once only, the reserve', { timeout: 240000 }, async () => {
  const dir = tempDir('rt-run-');
  let now = Date.parse('2026-10-22T22:00:00Z');
  const clock = () => new Date(now);
  const fake = fakeAlpaca({ clock, market: buildMarket(), news: [] });
  const cfg = loadAppConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none', ALPACA_API_KEY_ID: KEY_ID, ALPACA_API_SECRET_KEY: SECRET_KEY });
  const hxr = createHxr({ cfg, mode: 'real' }, { clock, fetchImpl: fake.fetchImpl, sleep: async () => {} });
  hxr.fetchData();
  await hxr.fetchDone;
  const hxrCounts = () => ['hxr_runs', 'hxr_ledger', 'hxr_experiments'].map((t) => hxr.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
  const before = hxrCounts();
  const proto = path.join(dir, 'proto.md');
  fs.writeFileSync(proto, PROTO_FILLED);
  const rt = createRangeTrend({ dataDir: dir, protocolPath: proto, clock });
  const file = 'rt-range-dip-nolimit-0.1.0.json';
  const r = await rt.runPractice({ configFile: file, confirm: true });
  assert.equal(r.status, 'done');
  assert.equal(r.simulated, true);
  const run = rt.getRun(r.id);
  assert.equal(run.status, 'done');
  assert.equal(run.code_revision, CODE_REVISION);
  assert.equal(run.details.codeRevision, CODE_REVISION);
  assert.match(run.details.symbolsHash, /^[0-9a-f]{64}$/);
  assert.equal(run.symbols_hash, run.details.symbolsHash);
  assert.match(run.data_hash, /^[0-9a-f]{64}$/);
  assert.equal(run.protocol_hash, protocolStatus(proto).hash);
  assert.deepEqual(run.details.meta.symbols.filter((s) => !s.techAi).map((s) => s.symbol), ['VST'], 'the universe tags reach the run');
  const m = run.metrics;
  for (const k of ['buyAndHold', 'cash', 'exposureMatched']) assert.ok(m.benchmarks[k], k);
  assert.match(m.benchmarks.exposureMatched.label, /derived/);
  assert.equal(typeof m.tradeOffVsExposureMatched.addsValueBeyondCash, 'boolean');
  assert.equal(m.tier2.thresholds.status, '[OWNER TO CONFIRM]');
  assert.ok('enoughTradesToCompare' in m.tier2 && 'withoutBestFivePct' in m.tier2);
  const eq = rt.db.prepare('SELECT json FROM rt_equity WHERE run_id = ?').all(r.id).map((x) => JSON.parse(x.json));
  assert.ok(eq.length > 1000);
  for (const p of eq) { assert.ok(Math.abs(p.equity - (p.cash + p.holdings)) < 1e-6); assert.ok(p.cash >= -1e-9); }
  assert.equal(eq[0].date, '2017-10-02');
  assert.deepEqual(hxrCounts(), before, 'the HXR database was only read');
  // Once only; the reserve needs the defect, its verification and the correction, and is used once.
  await rejectsWith(rt.runPractice({ configFile: file, confirm: true }), 409, /already run/);
  await rejectsWith(rt.runPractice({ configFile: file, confirm: true, reserve: { invalidatedRunId: r.id, defect: 'x' } }), 400, /defect, how it was verified and the correction/);
  const reserve = { invalidatedRunId: r.id, defect: 'test defect', verification: 'test verification', correction: 'test correction' };
  const r2 = await rt.runPractice({ configFile: file, confirm: true, reserve });
  assert.equal(r2.status, 'done');
  assert.deepEqual(rt.ledger().map((e) => [e.run_id, e.reserve]), [[r.id, false], [r2.id, true]]);
  assert.equal(rt.getRun(r.id).status, 'done', 'the earlier result is kept');
  await rejectsWith(rt.runPractice({ configFile: file, confirm: true, reserve }), 409, /reserve run has already been used/);
  assert.throws(() => rt.db.exec('DELETE FROM rt_ledger'), /append-only/);
  rt.close();
  hxr.close();
});
