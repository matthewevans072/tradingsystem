// Range-trend service: the file guard, the gate (protocol fields read outside fences and comments, the owner
// marker anywhere, duplicates, the frozen protocol hash, the owner-decisions entry, malformed and listed
// practice-run rows, every stored run listed, pinned configs, HXR's development period, the reserve), the
// atomic ledger slot with the hashes and the protocol hash, the lock, interrupted runs, HXR's readiness and
// spread-calibration refusals, a hold-arm failure, the backup, and practice runs end to end on a synthetic HXR
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
import { loadHxrPeriods, excludedDates } from '../server/hxr/config.js';
import { periodSessions } from '../server/hxr/engine.js';
import { createRangeTrend, periodProblem, practiceLogRow } from '../server/rangetrend/service.js';
import * as store from '../server/rangetrend/store.js';
import { protocolStatus, logStatus, loadConfig, configHash, CODE_REVISION, PLANNED_CONFIGS, CONFIG_SHA256, RT_CONFIG_DIR, UNSET, PRACTICE_ROW } from '../server/rangetrend/config.js';

const rejectsWith = async (p, status, re) => { let err = null; await assert.rejects(p, (e) => { err = e; return (e.status === status && (!re || re.test(e.message))) || assert.fail(`${e.status} ${e.message}`); }); return err; };
const PROTO = '# Evaluation protocol (test copy)\n\n**Date-choice rule:** a test date rule\n\n**Pick rule:** a test pick rule\n';
const LOG = `| # | When | What | Data touched | Results seen? |\n|---|---|---|---|---|\n| 1 | 2026-10-27 | **Owner decisions D1-D8** (test copy): D1 a, D2 b, D3 c, D4 d, D5 e, D6 f, D7 g, D8 h. Code revision: ${CODE_REVISION}. | none | No |\n`;
function files(dir, { proto = PROTO, log = LOG } = {}) {
  const protocolPath = path.join(dir, 'proto.md'), logPath = path.join(dir, 'log.md');
  if (proto != null) fs.writeFileSync(protocolPath, proto);
  if (log != null) fs.writeFileSync(logPath, log);
  return { protocolPath, logPath };
}
const open = (dir, extra = {}) => createRangeTrend({ dataDir: dir, ...files(dir, extra.files), clock: extra.clock, holdConfigFile: extra.holdConfigFile ?? null, testOverrides: true });
const cfgFile = (family, entry, limit) => PLANNED_CONFIGS.find((f) => f === `rt-${family}-${entry}-${limit ? 'limit' : 'nolimit'}-0.2.0.json`);
function trySymlink(target, link) {
  try { fs.symlinkSync(target, link, 'file'); return true; } catch (e) { if (['EPERM', 'EACCES', 'ENOSYS', 'UNKNOWN'].includes(e.code)) return false; throw e; }
}
// Only range-trend's own files may exist in a case directory after a refusal: the protocol and log copies and
// the results database (with SQLite's -wal/-shm), and nothing is recorded in it.
function onlyRangeTrendFiles(dir) {
  const allowed = new Set(['proto.md', 'log.md', 'range-trend-sim.sqlite', 'range-trend-sim.sqlite-wal', 'range-trend-sim.sqlite-shm']);
  for (const f of fs.readdirSync(dir)) assert.ok(allowed.has(f), `unexpected file ${f} in ${dir}`);
  const db = new DatabaseSync(path.join(dir, 'range-trend-sim.sqlite'), { readOnly: true });
  try {
    for (const t of ['rt_runs', 'rt_ledger', 'rt_equity', 'rt_settings']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, `${t} empty`);
  } finally { db.close(); }
}

test('file guard: never the portfolio, demo, Strategy Lab or HXR databases, any hxr* name, a link to one, a dangling link, nor a file with foreign tables', (t) => {
  const dir = tempDir('rt-guard-');
  for (const name of ['signal-desk.sqlite', 'demo.sqlite', 'strategy-lab.sqlite', 'strategy-lab-demo.sqlite', 'hxr-sim.sqlite', 'HXR-SIM.sqlite', 'hxr-anything.sqlite', 'hxrdata.db', 'Hxr.sqlite']) {
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
  // Links: a range-trend name that resolves to a refused file, and a dangling link.
  const linkDir = tempDir('rt-guard-link-');
  fs.writeFileSync(path.join(linkDir, 'signal-desk.sqlite'), '');
  if (trySymlink(path.join(linkDir, 'signal-desk.sqlite'), path.join(linkDir, 'range-trend-sim.sqlite'))) {
    assert.throws(() => store.guardRtFile(path.join(linkDir, 'range-trend-sim.sqlite')), /never opens/, 'a link to the portfolio file');
    fs.symlinkSync(path.join(linkDir, 'gone.sqlite'), path.join(linkDir, 'dangling.sqlite'), 'file');
    assert.throws(() => store.guardRtFile(path.join(linkDir, 'dangling.sqlite')), /dangling/);
  } else t.diagnostic('symlinks are not permitted here: the link cases were not run');
  // The data directory, protocol, log and hold config can be changed only by tests.
  assert.throws(() => createRangeTrend({ dataDir: dir }), /testOverrides: true/);
  assert.throws(() => createRangeTrend({ logPath: path.join(dir, 'log.md') }), /testOverrides: true/);
});

test('protocol fields: dedicated lines outside fences and comments, once each; unset values; an owner marker anywhere refuses; the hash ignores line endings', () => {
  const dir = tempDir('rt-proto-');
  const f = path.join(dir, 'p.md');
  assert.equal(protocolStatus(f).exists, false);
  const cases = [
    ['**Pick rule:** x\n', false, /no date-choice rule/],
    ['**Pick rule:** a rule\n**Date-choice rule:** TBD\n', false, /no date-choice rule/],
    ['**Pick rule:** best? maybe\n**Date-choice rule:** a rule\n', false, /no pick rule/],
    ['The pick rule: chosen later. **Pick rule:** inline text does not count\n**Date-choice rule:** a rule\n', false, /no pick rule/],
    [PROTO, true, null],
    [`${PROTO}\n\`\`\`\n**Pick rule:** fenced, not read\n\`\`\`\n`, true, null],
    [`${PROTO}\n<!-- **Pick rule:** commented, not read -->\n`, true, null],
    [`${PROTO}\n**Pick rule:** a second one\n`, false, /appears 2 times/],
    [`${PROTO}\n**Date-choice rule:** again\n`, false, /date-choice rule.*appears 2 times/],
    [`${PROTO}\nSee [OWNER TO SET] elsewhere.\n`, false, /owner marker/],
    [`${PROTO}\n\`\`\`\n[OWNER TO SET]\n\`\`\`\n`, false, /owner marker/],
    [`${PROTO}\n<!-- [owner note] -->\n`, false, /owner marker/],
    ['```\n**Pick rule:** only in a fence\n```\n**Date-choice rule:** a rule\n', false, /no pick rule/],
  ];
  for (const [text, ready, re] of cases) {
    fs.writeFileSync(f, text);
    const s = protocolStatus(f);
    assert.equal(s.ready, ready, text);
    if (re) assert.match(s.reason, re, text);
    if (ready) assert.deepEqual([s.pickRule, s.dateChoiceRule], ['a test pick rule', 'a test date rule']);
  }
  assert.deepEqual(['', '[OWNER TO SET]', 'TBD', 'todo', 'which?', 'a rule'].map(UNSET), [true, true, true, true, true, false]);
  fs.writeFileSync(f, PROTO.replace(/\n/g, '\r\n'));
  const crlf = protocolStatus(f).hash;
  fs.writeFileSync(f, PROTO);
  assert.equal(protocolStatus(f).hash, crlf);
  // The repository's own protocol is not ready: D9 is the owner's to write.
  assert.equal(protocolStatus().ready, false);
});

test('the experiment log: the owner-decisions row names D1-D8 and the current code revision; practice-run rows must parse; the next number', () => {
  const dir = tempDir('rt-log-');
  const f = path.join(dir, 'log.md');
  fs.writeFileSync(f, LOG);
  assert.deepEqual([logStatus(f).ownerDecisions, logStatus(f).nextNumber, logStatus(f).malformed], [true, 2, []]);
  fs.writeFileSync(f, LOG.replace('D8 h', 'D9 h'));
  assert.equal(logStatus(f).ownerDecisions, false, 'D8 missing');
  assert.match(logStatus(f).ownerDecisionsProblem, /does not name each of D1 to D8/);
  // A row recorded against other code does not open the gate: the revision must match exactly, as a whole word.
  for (const other of [`${CODE_REVISION}0`, `x${CODE_REVISION}`, CODE_REVISION.replace(/\d+$/, (n) => String(Number(n) + 1)), 'rt-code-2026-01-01-1']) {
    fs.writeFileSync(f, LOG.replace(CODE_REVISION, other));
    assert.equal(logStatus(f).ownerDecisions, false, `revision ${other}`);
    assert.match(logStatus(f).ownerDecisionsProblem, /does not name the current code revision/);
  }
  fs.writeFileSync(f, LOG.replace(`Code revision: ${CODE_REVISION}.`, `Code revision: ${CODE_REVISION}; configs: the eight rt-*-0.2.0.json.`));
  assert.equal(logStatus(f).ownerDecisions, true, 'followed by a semicolon');
  fs.writeFileSync(f, '| 1 | x | **Provisional readings D1-D9, pending the owner\'s decision**: D1 D2 D3 D4 D5 D6 D7 D8 | none | No |\n');
  assert.equal(logStatus(f).ownerDecisions, false, 'a provisional-readings entry is not the owner\'s decisions');
  // Practice-run rows: the exact form is read; any row whose title mentions a practice run but differs refuses.
  const H = 'a'.repeat(64);
  fs.writeFileSync(f, `${LOG}| 2 | x | **Practice run** run id: 7, config hash: ${H}; rt-range-dip-limit-0.2.0.json; status done | development | Yes |\n`);
  assert.deepEqual(logStatus(f).practiceRuns, [{ runId: 7, configHash: H, number: 2 }]);
  assert.deepEqual([logStatus(f).malformed, logStatus(f).nextNumber], [[], 3]);
  for (const bad of [
    `**Practice run 3** run id 7 config hash ${H}`,
    `**Practice run** run id: 7, config hash: ${H}a`,
    '**Reserve practice run** of run 7',
    `**Practice-run** run id: 7, config hash: ${H}`,
    'Practice runs stay blocked until the owner decides',
    `**Practice run** config hash: ${H}, run id: 7`,
  ]) {
    fs.writeFileSync(f, `${LOG}| 2 | x | ${bad} | none | No |\n`);
    const s = logStatus(f);
    assert.deepEqual([s.practiceRuns.length, s.malformed.length, s.malformed[0]?.number], [0, 1, 2], bad);
  }
  fs.writeFileSync(f, `${LOG}| 2 | x | **Fix pass** practice runs are refused until the owner decides | none | No |\n`);
  assert.deepEqual([logStatus(f).practiceRuns.length, logStatus(f).malformed.length], [0, 0], 'a mention outside the title is not a practice-run row');
  // The repository's own log has the owner-decisions row for this code and no malformed row.
  assert.deepEqual([logStatus().ownerDecisions, logStatus().malformed], [true, []]);
});

test('practiceLogRow writes the form PRACTICE_ROW reads, on one line with no "|" inside a cell', () => {
  const run = { id: 3, config_hash: 'b'.repeat(64), config_file: 'rt-range-dip-limit-0.2.0.json', version: 'rt-range-dip-limit-0.2.0', code_revision: CODE_REVISION, status: 'failed', error: 'x | y\nz', reserve: { invalidatedRunId: 1, defect: 'a|b', verification: 'v', correction: 'c' }, symbols_hash: 's', data_hash: 'd', calibration_hash: 'k', protocol_hash: 'p' };
  const row = practiceLogRow(run, 9, '2026-10-28');
  assert.ok(!row.includes('\n'));
  assert.equal(row.split('|').length, 7, 'five cells');
  const cells = row.split('|').map((x) => x.trim());
  assert.deepEqual([cells[1], cells[2]], ['9', '2026-10-28']);
  const m = cells[3].match(PRACTICE_ROW);
  assert.deepEqual([Number(m[1]), m[2]], [3, 'b'.repeat(64)]);
  assert.match(cells[3], /status failed \(x \/ y z\); reserve run replacing run 1 \(defect: a\/b/);
  fs.writeFileSync(path.join(tempDir('rt-row-'), 'log.md'), `${LOG}${row}\n`);
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

test('refusals before anything is recorded: confirm, protocol, owner decisions, malformed rows, unplanned and superseded configs, reserve text, missing or linked HXR data', async (t) => {
  const link = tempDir('rt-svc-link-');
  fs.writeFileSync(path.join(link, 'elsewhere.sqlite'), '');
  const cases = [
    [{ proto: null }, PLANNED_CONFIGS[0], true, 409, /EVALUATION-PROTOCOL.md does not exist/],
    [{ proto: '**Pick rule:** a rule\n' }, PLANNED_CONFIGS[0], true, 409, /no date-choice rule/],
    [{ proto: `${PROTO}\nThe thresholds are [OWNER TO SET].\n` }, PLANNED_CONFIGS[0], true, 409, /owner marker/],
    [{ proto: `${PROTO}**Pick rule:** twice\n` }, PLANNED_CONFIGS[0], true, 409, /appears 2 times/],
    [{ log: '| 1 | x | nothing | none | No |\n' }, PLANNED_CONFIGS[0], true, 409, /no owner-decisions entry covering D1-D8/],
    [{ log: LOG.replace(CODE_REVISION, 'rt-code-2026-01-01-1') }, PLANNED_CONFIGS[0], true, 409, /does not name the current code revision/],
    [{ log: `${LOG}| 2 | x | **Practice run 1** run id 1 config hash abc | development | Yes |\n` }, PLANNED_CONFIGS[0], true, 409, /not in the form/],
    [{}, 'rt-range-dip-nolimit-9.9.9.json', true, 400, /Only the planned configs/],
    [{}, 'rt-range-dip-limit-0.1.0.json', true, 400, /Only the planned configs/],
    [{}, PLANNED_CONFIGS[0], undefined, 400, /confirm: true/],
    [{}, PLANNED_CONFIGS[0], true, 400, /non-empty text/, { invalidatedRunId: 1, defect: 5, verification: 'v', correction: 'c' }],
    [{}, PLANNED_CONFIGS[0], true, 400, /invalidatedRunId/, { invalidatedRunId: '1', defect: 'd', verification: 'v', correction: 'c' }],
    [{}, PLANNED_CONFIGS[0], true, 409, /No HXR market data/],
  ];
  for (const [opts, configFile, confirm, status, re, reserve] of cases) {
    const sub = tempDir('rt-svc-case-');
    const rt = createRangeTrend({ dataDir: sub, ...files(sub, opts), testOverrides: true });
    await rejectsWith(rt.runPractice({ configFile, confirm, reserve }), status, re);
    assert.equal(rt.ledger().length, 0, 'nothing recorded');
    rt.close();
    assert.ok(!fs.existsSync(path.join(sub, store.RT_LOCK_NAME)), 'the lock is released');
    onlyRangeTrendFiles(sub);
  }
  // hxr-sim.sqlite must be the file itself in the data directory, not a link elsewhere.
  const sub = tempDir('rt-svc-case-');
  if (trySymlink(path.join(link, 'elsewhere.sqlite'), path.join(sub, 'hxr-sim.sqlite'))) {
    const rt = createRangeTrend({ dataDir: sub, ...files(sub), testOverrides: true });
    await rejectsWith(rt.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), 409, /not a link to/);
    assert.equal(rt.ledger().length, 0);
    rt.close();
  } else t.diagnostic('symlinks are not permitted here: the linked HXR file case was not run');
});

test('the ledger slot is atomic and carries the hashes and the protocol hash; an interrupted run is failed and stays used', () => {
  const dir = tempDir('rt-slot-');
  const db = store.openRtDb(store.rtDbFile(dir));
  const base = { configFile: PLANNED_CONFIGS[0], version: 'v', configHash: 'h', config: {}, protocolHash: 'p', codeRevision: CODE_REVISION, symbolsHash: 's1', dataHash: 'd1', calibrationHash: 'c1', at: '2026-10-27T00:00:00Z' };
  const first = store.reserveSlot(db, base);
  assert.deepEqual([typeof first.id, first.protocolFrozenAtRun], ['number', true]);
  assert.deepEqual(store.getSetting(db, 'protocolHash'), { hash: 'p', firstRunId: first.id }, 'written inside the slot transaction');
  assert.throws(() => store.reserveSlot(db, { ...base, protocolHash: 'other' }), /UNIQUE/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rt_runs').get().n, 1, 'the failed second slot left no run row');
  assert.deepEqual(store.getSetting(db, 'protocolHash'), { hash: 'p', firstRunId: first.id }, 'and did not touch the frozen hash');
  const second = store.reserveSlot(db, { ...base, reserve: { invalidatedRunId: first.id, defect: 'd', verification: 'v', correction: 'c' } });
  assert.equal(second.protocolFrozenAtRun, false);
  assert.throws(() => store.reserveSlot(db, { ...base, configFile: PLANNED_CONFIGS[1], reserve: { invalidatedRunId: first.id } }), /UNIQUE/);
  const row = store.getRun(db, first.id);
  assert.deepEqual([row.symbols_hash, row.data_hash, row.calibration_hash, row.status], ['s1', 'd1', 'c1', 'running'], 'the hashes are stored with the row before the run');
  db.close();
  // The process stopped while the runs were running: the next start records them as failed, hashes kept.
  const rt = createRangeTrend({ dataDir: dir, ...files(dir), testOverrides: true });
  const r = rt.getRun(first.id);
  assert.deepEqual([r.status, /interrupted/.test(r.error), r.symbols_hash, r.data_hash, r.calibration_hash], ['failed', true, 's1', 'd1', 'c1']);
  assert.equal(rt.ledger().length, 2);
  assert.match(rt.logRowFor(first.id), /^\| \d+ \| \d{4}-\d{2}-\d{2} \| \*\*Practice run\*\* run id: \d+, config hash: h; .*status failed \(interrupted/);
  rt.close();
});

test('the lock: a second instance refuses while one is open and never marks its run failed; a stale lock is taken over', () => {
  const dir = tempDir('rt-lock-');
  const a = createRangeTrend({ dataDir: dir, ...files(dir), testOverrides: true });
  const { id } = store.reserveSlot(a.db, { configFile: PLANNED_CONFIGS[2], version: 'v', configHash: 'h', config: {}, protocolHash: 'p', codeRevision: CODE_REVISION, at: '2026-10-28T00:00:00Z' });
  assert.equal(a.getRun(id).status, 'running');
  assert.throws(() => createRangeTrend({ dataDir: dir, ...files(dir), testOverrides: true }), (e) => e.status === 423 && /holds/.test(e.message));
  assert.equal(a.getRun(id).status, 'running', 'the refused instance did not touch the live run');
  assert.ok(fs.existsSync(path.join(dir, store.RT_LOCK_NAME)));
  a.close();
  assert.ok(!fs.existsSync(path.join(dir, store.RT_LOCK_NAME)), 'released on close');
  // A lock left by a process that is gone is stale: taken over, and the interrupted run is then failed.
  fs.writeFileSync(path.join(dir, store.RT_LOCK_NAME), JSON.stringify({ pid: 2147483646, at: '2026-10-28T00:00:00Z' }));
  const b = createRangeTrend({ dataDir: dir, ...files(dir), testOverrides: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, store.RT_LOCK_NAME), 'utf8')).pid, process.pid);
  assert.equal(b.getRun(id).status, 'failed');
  b.close();
  // A closed instance refuses to run.
  assert.rejects(b.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), /closed/);
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
async function hxrData(dir, market, handler = null) {
  let now = Date.parse('2026-10-22T22:00:00Z');
  const clock = () => new Date(now);
  const fake = fakeAlpaca({ clock, market, news: [], handler });
  const cfg = loadAppConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none', ALPACA_API_KEY_ID: KEY_ID, ALPACA_API_SECRET_KEY: SECRET_KEY });
  const hxr = createHxr({ cfg, mode: 'real' }, { clock, fetchImpl: fake.fetchImpl, sleep: async () => {} });
  hxr.fetchData();
  await hxr.fetchDone;
  return { hxr, cfg, clock };
}

test('the gate refuses when HXR\'s development period is not ready or has no spread calibration; nothing is recorded', { timeout: 300000 }, async () => {
  // A missing MU bar inside the development period: HXR's readiness marks the period unusable.
  const gap = tempDir('rt-gap-');
  const market = buildMarket();
  market.MU.delete('2019-06-12');
  const g = await hxrData(gap, market);
  const rt1 = createRangeTrend({ dataDir: gap, ...files(gap), testOverrides: true });
  await rejectsWith(rt1.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), 409, /development period is not ready/);
  assert.equal(rt1.ledger().length, 0);
  rt1.close();
  g.hxr.close();
  // No usable opening quotes: no spread calibration for the development period.
  const noq = tempDir('rt-noquotes-');
  const n = await hxrData(noq, buildMarket(), async (call) => (call.path === '/v2/stocks/quotes' ? new Response(JSON.stringify({ quotes: {}, next_page_token: null }), { status: 200, headers: { 'content-type': 'application/json' } }) : null));
  const rt2 = createRangeTrend({ dataDir: noq, ...files(noq), testOverrides: true });
  await rejectsWith(rt2.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), 409, /no spread calibration/);
  assert.equal(rt2.ledger().length, 0);
  rt2.close();
  n.hxr.close();
});

test('practice runs end to end: a trade held across a split, provenance, the benchmarks, the log row, the gate after the first run, the reserve, a crash after the slot, a hold-arm failure, the backup', { timeout: 300000 }, async () => {
  const dir = tempDir('rt-run-');
  const { hxr, cfg, clock } = await hxrData(dir, marketWithTslaBreakout());
  const hxrCounts = () => ['hxr_runs', 'hxr_ledger', 'hxr_experiments'].map((t) => hxr.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
  const before = hxrCounts();
  const f = files(dir);
  let rt = createRangeTrend({ dataDir: dir, ...f, clock, testOverrides: true });
  const file = cfgFile('trend', 'immediate', false);
  const r = await rt.runPractice({ configFile: file, confirm: true });
  assert.deepEqual([r.status, r.simulated, r.errors], ['done', true, []]);
  const run = rt.getRun(r.id);
  assert.deepEqual([run.code_revision, run.details.codeRevision, run.details.engineVersion], [CODE_REVISION, CODE_REVISION, 'rt-engine-3']);
  for (const h of [run.symbols_hash, run.data_hash, run.calibration_hash]) assert.match(h, /^[0-9a-f]{64}$/);
  assert.deepEqual([run.details.symbolsHash, run.details.dataHash, run.details.calibrationHash], [run.symbols_hash, run.data_hash, run.calibration_hash]);
  assert.deepEqual([run.details.configFileSha256, run.details.protocolHash, run.details.protocolFrozenAtRun, run.details.testOverrides], [CONFIG_SHA256[file], protocolStatus(f.protocolPath).hash, true, ['dataDir', 'protocolPath', 'logPath']]);
  assert.deepEqual(store.getSetting(rt.db, 'protocolHash'), { hash: protocolStatus(f.protocolPath).hash, firstRunId: r.id });
  assert.deepEqual([run.details.benchmarkEngineVersion, run.details.holdConfigFile, typeof run.details.indexMethod], ['hxr-engine-3', 'hxr-hold-0.1.0.json', 'string']);
  assert.deepEqual(run.details.meta.symbols.filter((s) => !s.techAi).map((s) => s.symbol), ['VST']);
  assert.equal(run.details.meta.simulated, true);
  // The planted TSLA trade is held across the 5-for-1 split.
  const split = run.details.splits.find((s) => s.symbol === 'TSLA' && s.date === '2020-08-31');
  assert.ok(split && split.sharesAfter > 0, 'a TSLA position is held across its split');
  assert.equal(split.sharesAfter % 5, 0, 'shares multiplied by 5');
  assert.ok(run.details.trades.length + run.details.openPositions.length >= 1);
  const eq = rt.db.prepare('SELECT json FROM rt_equity WHERE run_id = ? ORDER BY date').all(r.id).map((x) => JSON.parse(x.json));
  for (const p of eq) { assert.ok(Math.abs(p.equity - (p.cash + p.holdings)) < 1e-6); assert.ok(p.cash >= -1e-9); }
  assert.ok(eq.some((p) => p.invested > 0), 'invested on some days');
  const periods = loadHxrPeriods(), dev = periods.periods.development;
  assert.equal(eq[0].date, '2017-10-02');
  assert.equal(eq.length, periodSessions({ warmupFrom: dev.start, end: dev.end }, excludedDates(periods)).length, 'one equity point per session of the development period');
  // Benchmarks: (a) the index, (b) cash, (c) exposure-matched, and the HXR hold arm beside them, labelled.
  const b = run.metrics.benchmarks;
  assert.deepEqual(Object.keys(b).sort(), ['buyAndHold', 'cash', 'exposureMatched', 'hxrHoldArm']);
  assert.match(b.buyAndHold.label, /^derived/);
  assert.match(b.exposureMatched.label, /^derived/);
  assert.match(b.hxrHoldArm.label, /whole-share hold arm/);
  assert.notEqual(b.exposureMatched.endValue, 15000, 'the exposure-matched hold moves when the run is invested');
  assert.ok(b.exposureMatched.endValue > 0 && Math.abs(b.exposureMatched.endValue - 15000) < Math.abs(b.buyAndHold.endValue - 15000), 'it moves less than the fully invested index');
  assert.notEqual(b.buyAndHold.endValue, b.hxrHoldArm.endValue, 'the index is not the whole-share arm');
  assert.equal(typeof run.metrics.tradeOffVsExposureMatched.addsValueBeyondCash, 'boolean');
  assert.equal(run.metrics.tier2.thresholds.status, '[OWNER TO CONFIRM]');
  assert.equal(typeof run.metrics.perStock.TSLA.signals, 'number');
  assert.deepEqual(hxrCounts(), before, 'the HXR database was only read');
  // The log row: the exact row to paste; until it is pasted, no further run starts.
  const whatCell = r.logRow.split('|').map((x) => x.trim())[3];
  assert.match(whatCell, PRACTICE_ROW);
  assert.ok(whatCell.startsWith(`**Practice run** run id: ${r.id}, config hash: ${configHash(loadConfig(file))};`));
  assert.equal(r.logRow.split('|').length, 7, 'five cells, no "|" inside');
  const refused = await rejectsWith(rt.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), 409, /not listed in EXPERIMENT-LOG.md/);
  assert.equal(refused.logRow, r.logRow);
  fs.appendFileSync(f.logPath, `${r.logRow}\n`);
  // Once only; the reserve needs the same config hash and the defect, verification and correction as text.
  await rejectsWith(rt.runPractice({ configFile: file, confirm: true }), 409, /already run/);
  await rejectsWith(rt.runPractice({ configFile: file, confirm: true, reserve: { invalidatedRunId: r.id, defect: 'x' } }), 400, /non-empty text/);
  const reserve = { invalidatedRunId: r.id, defect: 'test defect', verification: 'test verification', correction: 'test correction' };
  // A failure of the HXR hold arm (a missing hold config, test only) is recorded as such; the strategy result,
  // benchmark (a) and the exposure-matched hold are kept.
  rt.close();
  rt = createRangeTrend({ dataDir: dir, ...f, clock, holdConfigFile: 'hxr-missing-0.0.0.json', testOverrides: true });
  const r2 = await rt.runPractice({ configFile: file, confirm: true, reserve });
  assert.equal(r2.status, 'done');
  assert.match(r2.errors.join(), /HXR hold arm failed/);
  const run2 = rt.getRun(r2.id);
  assert.match(run2.error, /HXR hold arm failed/);
  assert.deepEqual(run2.details.testOverrides, ['dataDir', 'protocolPath', 'logPath', 'holdConfigFile']);
  assert.equal(run2.details.protocolFrozenAtRun, false);
  assert.ok(run2.details.trades.length + run2.details.openPositions.length >= 1, 'the strategy result is kept');
  assert.equal(run2.metrics.benchmarks.hxrHoldArm, undefined);
  assert.ok(run2.metrics.benchmarks.buyAndHold && run2.metrics.benchmarks.exposureMatched, 'benchmark (a) does not depend on the HXR engine');
  assert.deepEqual(run.metrics.benchmarks.buyAndHold, run2.metrics.benchmarks.buyAndHold, 'the same inputs give the same index');
  assert.deepEqual(rt.ledger().map((e) => [e.run_id, e.reserve]), [[r.id, false], [r2.id, true]]);
  assert.equal(rt.getRun(r.id).status, 'done', 'the earlier result is kept');
  assert.match(r2.logRow, /reserve run replacing run \d+ \(defect: test defect/);
  fs.appendFileSync(f.logPath, `${r2.logRow}\n`);
  await rejectsWith(rt.runPractice({ configFile: file, confirm: true, reserve }), 409, /reserve run has already been used/);
  assert.throws(() => rt.db.exec('DELETE FROM rt_ledger'), /append-only/);
  // The protocol frozen at the first practice run is final: a changed file refuses until restored.
  fs.writeFileSync(f.protocolPath, PROTO.replace('a test pick rule', 'another pick rule'));
  await rejectsWith(rt.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), 409, /final for the practice runs/);
  fs.writeFileSync(f.protocolPath, PROTO);
  rt.close();
  // A crash after the slot was taken: the slot stays used, the hashes stay with the row, the row must be logged.
  let calls = 0;
  // The fourth clock call is the first after the slot is taken; from then on the process "is gone".
  const crashClock = () => { if (++calls >= 4) throw new Error('simulated crash after the slot'); return clock(); };
  rt = createRangeTrend({ dataDir: dir, ...f, clock: crashClock, testOverrides: true });
  const crashed = cfgFile('range', 'dip', true);
  await rejectsWith(rt.runPractice({ configFile: crashed, confirm: true }), 500, /simulated crash/);
  rt.close();
  rt = createRangeTrend({ dataDir: dir, ...f, clock, testOverrides: true });
  const r3 = rt.runs().find((x) => x.config_file === crashed);
  assert.deepEqual([r3.status, /interrupted/.test(r3.error)], ['failed', true]);
  for (const h of [r3.symbols_hash, r3.data_hash, r3.calibration_hash]) assert.match(h, /^[0-9a-f]{64}$/);
  const refused3 = await rejectsWith(rt.runPractice({ configFile: crashed, confirm: true }), 409, /not listed in EXPERIMENT-LOG.md/);
  assert.match(refused3.logRow, /status failed \(interrupted/);
  fs.appendFileSync(f.logPath, `${refused3.logRow}\n`);
  await rejectsWith(rt.runPractice({ configFile: crashed, confirm: true }), 409, /already run/);
  assert.equal(rt.ledger().length, 3);
  rt.close();
  // The backup: a consistent copy in backups/range-trend.
  const ctx = createContext(cfg, 'real');
  const bk = createBackup(ctx, { reason: 'manual' });
  assert.match(bk.rangeTrend.name, /^range-trend-sim-.*-manual\.sqlite$/);
  const copy = new DatabaseSync(path.join(rangeTrendBackupDir(cfg), bk.rangeTrend.name), { readOnly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM rt_ledger').get().n, 3);
  copy.close();
  // A fresh database cannot reset the budget: the log lists a practice run it does not contain.
  const fresh = tempDir('rt-fresh-');
  fs.copyFileSync(path.join(dir, 'hxr-sim.sqlite'), path.join(fresh, 'hxr-sim.sqlite'));
  const logged = files(fresh, { log: `${LOG}${r.logRow}\n` });
  const rt4 = createRangeTrend({ dataDir: fresh, ...logged, clock, testOverrides: true });
  await rejectsWith(rt4.runPractice({ configFile: PLANNED_CONFIGS[0], confirm: true }), 409, /does not contain/);
  rt4.close();
  hxr.close();
  // The HXR database is opened read-only, and only there.
  const src = fs.readFileSync(new URL('../server/rangetrend/service.js', import.meta.url), 'utf8');
  assert.equal((src.match(/openHxrDb\(/g) || []).length, 1);
  assert.ok(src.includes('openHxrDb(realHxr, { readOnly: true })'));
});
