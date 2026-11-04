// ICT Lab service: every gate condition (PROTOCOL.md section 10 rules 1 to 9) refuses for its reason and nothing
// runs; a run records the slot, the row with every hash, the trades, the ledger and the exact log entry in one
// transaction; a repeat is marked; the validation window is refused until the owner's row exists; the reserved
// window has no code path; the count-only pass returns counts only. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../server/ictlab/store.js';
import { RUN_ENTRY, ROUND1_SPECS, CODE_REVISION, ENGINE_VERSION, logStatus, parseEntries } from '../server/ictlab/config.js';
import { GateError, tempLeftovers, TEMP_PREFIXES } from '../server/ictlab/service.js';
import { serviceFixture, frozenEntry, validationEntry, COMMIT } from './ictlab-service-fixture.js';
import { tempDir } from './helpers.js';

const V = 'ict-sweep-bos-ob-0.1.0.json';
const failed = (gate) => gate.conditions.filter((c) => !c.ok).map((c) => c.name);
const detail = (gate, name) => gate.conditions.find((c) => c.name === name).detail;
const NAMES = ['free-space', 'temp-clean', 'pins', 'pre-registration-commit', 'code-committed', 'window', 'data-version', 'bar-bound', 'code-frozen-entry', 'log-well-formed', 'lock', 'spec', 'spec-not-run'];

test('the gate is open with everything in order and names every condition with its rule', () => {
  const f = serviceFixture();
  const g = f.service.gateStatus({ specFile: V });
  assert.deepEqual(failed(g), [], JSON.stringify(g.conditions.filter((c) => !c.ok)));
  assert.deepEqual(g.conditions.map((c) => c.name), NAMES);
  assert.deepEqual(g.conditions.map((c) => c.rule), [9, 9, 1, 1, 8, 7, 2, 2, 3, 3, 6, 4, 4]);
  assert.match(detail(g, 'data-version'), /hash [0-9a-f]{64}/);
  assert.match(detail(g, 'bar-bound'), /bars after 2022-12-30: 0 five-minute, 0 daily/);
  assert.match(detail(g, 'code-frozen-entry'), new RegExp(CODE_REVISION));
  assert.match(detail(g, 'spec'), /shared block is identical across its 4 files/);
  assert.equal(g.version.dataHash, f.dataHash);
});

test('rule 9: free space and the temp folder; rule 1: the pins and the commit; rule 8: committed code', () => {
  const f = serviceFixture();
  const dirty = f.make({ tempDirs: ['il-planted-abc', 'sd-test-xyz'] });
  const tg = dirty.gateStatus({ specFile: V });
  assert.deepEqual(failed(tg), ['temp-clean']);
  assert.match(detail(tg, 'temp-clean'), /2 test or harness directories left/);
  const td = tempDir('il-svc-probe-');
  fs.mkdirSync(path.join(td, 'sb-planted-1')); fs.mkdirSync(path.join(td, 'other'));
  assert.deepEqual(tempLeftovers(td), ['sb-planted-1']);
  assert.ok(TEMP_PREFIXES.includes('il-'));
  const a = serviceFixture();
  fs.appendFileSync(a.protocolPath, 'a changed rule\n');
  const ag = a.service.gateStatus({ specFile: V });
  assert.deepEqual(failed(ag), ['pins']);
  assert.match(detail(ag, 'pins'), /PROTOCOL.md differs/);
  const b = serviceFixture();
  const text = fs.readFileSync(path.join(b.specDir, V), 'utf8');
  fs.writeFileSync(path.join(b.specDir, V), text.replace('"bufferDollars": 0.01', '"bufferDollars": 0.02'));
  const bg = b.service.gateStatus({ specFile: V });
  assert.ok(failed(bg).includes('pins') && failed(bg).includes('spec'));
  assert.match(detail(bg, 'spec'), /differs from its pinned SHA-256/);
  const noCommit = serviceFixture({ overrides: { prereg: { ok: false, detail: 'commit x is not an ancestor of HEAD', committedAt: null } } });
  assert.deepEqual(failed(noCommit.service.gateStatus({ specFile: V })), ['pre-registration-commit']);
  const uncommitted = serviceFixture({ overrides: { uncommitted: [' M server/ictlab/engine.js'] } });
  const ug = uncommitted.service.gateStatus({ specFile: V });
  assert.deepEqual(failed(ug), ['code-committed']);
  assert.match(detail(ug, 'code-committed'), /engine.js/);
});

test('rule 2: the data version (hash, commit, download time, coverage) and the bound; rule 3: the code-frozen entry and the well-formed log', () => {
  const early = serviceFixture({ downloadedAt: '2026-11-04T10:00:00Z' });
  assert.match(detail(early.service.gateStatus({ specFile: V }), 'data-version'), /not after the pre-registration commit/);
  const short = serviceFixture({ versionTo: '2022-06-30' });
  assert.match(detail(short.service.gateStatus({ specFile: V }), 'data-version'), /covers 2018-06-01 to 2022-06-30, not the development window/);
  const late = serviceFixture();
  const db = store.openIlDb(late.dbFile);
  db.prepare('INSERT INTO il_bars_1d (version_id, symbol, date, o, h, l, c) VALUES (1, ?, ?, 1, 2, 0.5, 1)').run('QQQ', '2023-01-03');
  db.close();
  const lg = late.service.gateStatus({ specFile: V });
  assert.ok(failed(lg).includes('bar-bound'));
  assert.match(detail(lg, 'bar-bound'), /0 five-minute, 1 daily/);
  assert.ok(failed(lg).includes('data-version'), 'the stored hash no longer recomputes either');
  const none = serviceFixture();
  fs.rmSync(none.dbFile);
  for (const x of fs.readdirSync(none.dir)) if (x.startsWith('ict-lab-sim.sqlite')) fs.rmSync(path.join(none.dir, x), { force: true });
  assert.match(detail(none.service.gateStatus({ specFile: V }), 'data-version'), /no data version/);
  assert.deepEqual(failed(serviceFixture({ frozen: false }).service.gateStatus({ specFile: V })), ['code-frozen-entry']);
  const fenced = serviceFixture({ frozen: false });
  fs.appendFileSync(fenced.logPath, `\n\`\`\`\n${frozenEntry({ dataHash: fenced.dataHash }).trim()}\n\`\`\`\n`);
  assert.match(detail(fenced.service.gateStatus({ specFile: V }), 'code-frozen-entry'), /no entry titled/);
  const other = serviceFixture({ frozenRevision: 'il-code-2000-01-01-1' });
  assert.match(detail(other.service.gateStatus({ specFile: V }), 'code-frozen-entry'), /does not name the current code revision/);
  const wrongHash = serviceFixture({ frozenHash: 'f'.repeat(64) });
  assert.match(detail(wrongHash.service.gateStatus({ specFile: V }), 'code-frozen-entry'), /names data hash f{64}, not the data version's/);
  const malformed = serviceFixture({ extraLog: '\n## 2 | 2026-11-04 | **Run** run id: 7 without the rest\n\ntext\n' });
  const mg = malformed.service.gateStatus({ specFile: V });
  assert.deepEqual(failed(mg), ['log-well-formed']);
  assert.match(detail(mg, 'log-well-formed'), /malformed run entries: #2/);
  const phantom = serviceFixture({ extraLog: `\n## 2 | 2026-11-04 | **Run** run id: 9, spec: ${V}, spec hash: ${'a'.repeat(64)}, window: development, status: done\n\ntext\n` });
  assert.match(detail(phantom.service.gateStatus({ specFile: V }), 'log-well-formed'), /names run 9, which the database does not hold/);
});

test('rule 4: one spec per call, a pre-registered spec only, once per window; rule 6: the lock; rule 7: the windows', () => {
  const vf = serviceFixture();
  fs.copyFileSync(path.join(vf.specDir, V), path.join(vf.specDir, 'ict-x-0.1.0.json'));
  const vg = vf.service.gateStatus({ specFile: 'ict-x-0.1.0.json' });
  assert.deepEqual(failed(vg), ['spec']);
  assert.match(detail(vg, 'spec'), /not one of round 1's 4 pre-registered specs/);
  const locked = serviceFixture();
  const ldb = store.openIlDb(locked.dbFile);
  const lock = store.acquireLock(ldb, { at: 't' });
  assert.deepEqual(failed(locked.service.gateStatus({ specFile: V })), ['lock']);
  store.releaseLock(ldb, lock);
  ldb.close();
  assert.deepEqual(failed(locked.service.gateStatus({ specFile: V })), []);
  // The reserved window has no code path: the condition fails, the run and the count refuse, nothing is written.
  const f = serviceFixture();
  const rg = f.service.gateStatus({ specFile: V, window: 'reserved' });
  assert.ok(failed(rg).includes('window'));
  assert.match(detail(rg, 'window'), /no code path/);
  assert.throws(() => f.service.run({ specFile: V, window: 'reserved', confirm: true }), GateError);
  assert.throws(() => f.service.countOnly({ specFile: V, window: 'reserved' }), GateError);
  assert.equal(f.service.listRuns().length, 0);
  // The validation window: refused without the owner's row, and the data version cannot cover it under the bound.
  const vwin = f.service.gateStatus({ specFile: V, window: 'validation' });
  assert.ok(vwin.conditions.some((c) => c.name === 'validation-authorized' && !c.ok && /only the owner writes/.test(c.detail)));
  assert.match(detail(vwin, 'data-version'), /not the validation window .*beyond the bar bound/);
  assert.throws(() => f.service.run({ specFile: V, window: 'validation', confirm: true }), GateError);
  fs.appendFileSync(f.logPath, validationEntry({ specs: [V] }));
  const vauth = f.service.gateStatus({ specFile: V, window: 'validation' });
  assert.ok(vauth.conditions.some((c) => c.name === 'validation-authorized' && c.ok), 'the owner\'s row is read');
  assert.ok(failed(vauth).includes('data-version'), 'still refused: no validation data exists under the bound');
  assert.equal(f.service.validationStatus({ specFile: V }).authorized, true);
  assert.equal(f.service.validationStatus({ specFile: 'ict-ifvg-0.1.0.json' }).authorized, false);
  assert.equal(f.service.listRuns().length, 0);
});

test('a run records the slot, the row with every hash, the trades, the sessions, the write-once settings, the ledger and the exact log entry; once per window; a repeat needs a reason and is marked', () => {
  const f = serviceFixture();
  assert.throws(() => f.service.run({ specFile: V }), /confirm/);
  assert.equal(f.service.listRuns().length, 0);
  const r = f.service.run({ specFile: V, confirm: true });
  assert.equal(r.run.status, 'done');
  assert.deepEqual([r.run.round, r.run.spec, r.run.window, r.run.repeat, r.run.contaminated], [1, V, 'development', false, false]);
  assert.equal(r.run.codeRevision, CODE_REVISION);
  assert.equal(r.run.engineVersion, ENGINE_VERSION);
  assert.equal(r.run.headCommit, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(r.run.preregCommit, COMMIT);
  assert.equal(r.run.dataHash, f.dataHash);
  assert.equal(r.run.protocolSha256, f.pins['PROTOCOL.md']);
  assert.equal(r.run.conceptsSha256, f.pins['CONCEPTS.md']);
  assert.match(r.run.sourceHash, /^[0-9a-f]{64}$/);
  assert.match(r.run.specHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.run.windowDates, { start: '2018-06-01', end: '2022-12-30' });
  assert.deepEqual(Object.keys(r.run.details).filter((k) => /Hash|Sha256|Revision|Version|Commit/.test(k)).sort(), ['codeRevision', 'conceptsSha256', 'dataHash', 'dataVersion', 'engineVersion', 'headCommit', 'preregCommit', 'protocolSha256', 'sourceHash', 'specHash']);
  const m = r.run.metrics;
  assert.equal(m.sessionsInWindow, 61, 'the synthetic sessions (2019-01-02 to 2019-03-29)');
  assert.equal(Object.values(m.stageCounts).reduce((a, b) => a + b, 0), 61);
  assert.equal(typeof m.candidate, 'boolean');
  assert.equal(m.criteria.minTrades, 100);
  assert.ok(!('completeSessions' in m));
  const db = store.openIlDb(f.dbFile, { readOnly: true });
  assert.equal(store.listSessions(db, r.run.id).length, 61);
  assert.equal(store.listTrades(db, r.run.id).length, m.trades);
  const ledger = store.listLedger(db);
  assert.deepEqual(ledger.map((l) => l.kind), ['slot', 'run']);
  assert.match(ledger[0].note, /protocol [0-9a-f]{64}, concepts [0-9a-f]{64}/);
  assert.equal(store.getSetting(db, 'first_run_protocol_sha256'), f.pins['PROTOCOL.md']);
  assert.equal(store.getSetting(db, 'first_run_code_revision'), CODE_REVISION);
  assert.equal(store.currentLock(db), null);
  db.close();
  const entries = parseEntries(r.entry);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].number, 2);
  const mm = entries[0].title.match(RUN_ENTRY);
  assert.deepEqual([Number(mm[1]), mm[2], mm[3], mm[4], mm[5]], [r.run.id, V, r.run.specHash, 'development', 'done']);
  assert.match(entries[0].body, /Measured: sessions 61, tradeable \d+, sweeps \d+/);
  assert.match(entries[0].body, /Candidate by the pre-registered criteria: (YES|no)/);
  assert.match(entries[0].body, /cash_capped \d+ of \d+, unfunded \d+/);
  // Until the entry is in the log, the gate refuses every run.
  const g = f.service.gateStatus({ specFile: 'ict-ifvg-0.1.0.json' });
  assert.deepEqual(failed(g), ['log-well-formed']);
  fs.appendFileSync(f.logPath, r.entry);
  assert.deepEqual(failed(f.service.gateStatus({ specFile: 'ict-ifvg-0.1.0.json' })), []);
  const again = f.service.gateStatus({ specFile: V });
  assert.deepEqual(failed(again), ['spec-not-run']);
  assert.match(detail(again, 'spec-not-run'), /already ran on the development window \(run 1\)/);
  assert.throws(() => f.service.run({ specFile: V, confirm: true }), GateError);
  assert.equal(f.service.listRuns().length, 1);
  // A repeat with a stated reason runs and is marked repeat (never contaminated on development).
  const rg = f.service.gateStatus({ specFile: V, repeatReason: 'verified defect: synthetic test' });
  assert.deepEqual(failed(rg), []);
  assert.equal(rg.conditions.find((c) => c.name === 'spec-not-run').rule, 5);
  const rep = f.service.run({ specFile: V, confirm: true, repeatReason: 'verified defect: synthetic test' });
  assert.equal(rep.run.repeat, true);
  assert.equal(rep.run.repeatReason, 'verified defect: synthetic test');
  assert.equal(rep.run.contaminated, false);
  assert.match(rep.entry, /REPEAT \(verified defect: synthetic test\)/);
  assert.throws(() => f.service.run({ specFile: V, confirm: true, repeatReason: '   ' }), GateError, 'a blank reason is no reason');
  assert.equal(logStatus(f.logPath, { preregCommit: COMMIT }).runs.length, 1);
});

test('a failed run is recorded and allows a retry; a crashed run is marked failed; the whole round runs once each', () => {
  const f = serviceFixture();
  const bad = f.make({ failWith: 'synthetic failure' });
  const r = bad.run({ specFile: V, confirm: true });
  assert.equal(r.run.status, 'failed');
  assert.equal(r.run.error, 'synthetic failure');
  assert.match(r.entry, /status: failed/);
  fs.appendFileSync(f.logPath, r.entry);
  const g = f.service.gateStatus({ specFile: V });
  assert.deepEqual(failed(g), []);
  assert.match(detail(g, 'spec-not-run'), /1 failed attempt\(s\) logged/);
  const db = store.openIlDb(f.dbFile);
  const crashed = store.createRun(db, { round: 1, spec: V, specHash: 'a'.repeat(64), window: 'development', dataVersionId: 1, dataHash: f.dataHash, windowDates: { start: '2018-06-01', end: '2022-12-30' }, codeRevision: CODE_REVISION, engineVersion: ENGINE_VERSION, preregCommit: COMMIT, protocolSha256: 'b'.repeat(64), conceptsSha256: 'c'.repeat(64), createdAt: 't' });
  db.close();
  assert.match(detail(f.service.gateStatus({ specFile: V }), 'log-well-formed'), new RegExp(`run ${crashed} is still marked running`));
  assert.throws(() => f.service.markFailed(999, 'x'), /does not exist/);
  assert.throws(() => f.service.markFailed(crashed, ''), /needs a reason/);
  const mf = f.service.markFailed(crashed, 'the process was killed');
  assert.equal(mf.run.status, 'failed');
  fs.appendFileSync(f.logPath, mf.entry);
  assert.throws(() => f.service.markFailed(crashed, 'again'), /is failed, not running/);
  assert.deepEqual(failed(f.service.gateStatus({ specFile: V })), []);
  for (const v of ROUND1_SPECS) {
    const rr = f.service.run({ specFile: v, confirm: true });
    assert.equal(rr.run.status, 'done', rr.run.error || '');
    fs.appendFileSync(f.logPath, rr.entry);
  }
  assert.equal(f.service.listRuns().filter((x) => x.status === 'done').length, 4);
  assert.equal(logStatus(f.logPath, { preregCommit: COMMIT }).runs.filter((x) => x.status === 'done').length, 4);
  for (const v of ROUND1_SPECS) assert.deepEqual(failed(f.service.gateStatus({ specFile: v })), ['spec-not-run']);
});

test('the count-only pass: the gate holds, counts only come back, nothing is recorded', () => {
  const f = serviceFixture();
  const c = f.service.countOnly({ specFile: V });
  assert.deepEqual(Object.keys(c).sort(), ['counts', 'dataHash', 'dataVersionId', 'round', 'spec', 'specHash', 'window', 'windowDates']);
  assert.deepEqual(Object.keys(c.counts), ['sessions', 'tradeable', 'sweeps', 'confirmations', 'zones', 'orders', 'fills']);
  assert.equal(c.counts.sessions, 61);
  assert.ok(c.counts.fills <= c.counts.orders && c.counts.orders <= c.counts.zones);
  assert.ok(!/meanR|"R"|outcome|exit|pnl|cash/.test(JSON.stringify(c)), 'no R, outcome or exit figure');
  assert.equal(f.service.listRuns().length, 0);
  const db = store.openIlDb(f.dbFile, { readOnly: true });
  assert.equal(store.listLedger(db).length, 0);
  db.close();
  const closed = serviceFixture({ frozen: false });
  assert.throws(() => closed.service.countOnly({ specFile: V }), GateError);
});
