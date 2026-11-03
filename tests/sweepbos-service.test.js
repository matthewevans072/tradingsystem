// sweep-bos service: every gate condition refuses for its reason and nothing runs; a run records the row, the
// trades, the ledger and the exact log entry; a failed run is recorded; a crashed run is marked failed; the
// pick report waits for the whole round. Synthetic data only (tests/sweepbos-service-fixture.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../server/sweepbos/store.js';
import { RUN_ENTRY, ROUND1_VARIANTS, CODE_REVISION, logStatus, parseEntries } from '../server/sweepbos/config.js';
import { GateError } from '../server/sweepbos/service.js';
import { serviceFixture, frozenEntry, COMMIT } from './sweepbos-service-fixture.js';

const V = 'sb-ob-a-nobias-0.1.0.json';
const failed = (gate) => gate.conditions.filter((c) => !c.ok).map((c) => c.name);
const detail = (gate, name) => gate.conditions.find((c) => c.name === name).detail;

test('the gate is open with everything in order, and names every condition', () => {
  const f = serviceFixture();
  const g = f.service.gateStatus({ variantFile: V });
  assert.deepEqual(failed(g), [], JSON.stringify(g.conditions.filter((c) => !c.ok)));
  assert.deepEqual(g.conditions.map((c) => c.name), ['free-space', 'rule-sheet-pins', 'pre-registration-commit', 'code-committed', 'window', 'data-version', 'bar-bound', 'code-frozen-entry', 'log-well-formed', 'lock', 'variant', 'variant-not-run']);
  assert.match(detail(g, 'data-version'), /hash [0-9a-f]{64}/);
  assert.match(detail(g, 'bar-bound'), /bars after 2022-12-30: 0 five-minute, 0 daily/);
  assert.match(detail(g, 'code-frozen-entry'), new RegExp(CODE_REVISION));
  assert.equal(g.version.dataHash, f.dataHash);
});

test('each gate condition refuses for its own reason', () => {
  // The rule sheet edited after pinning.
  const a = serviceFixture();
  fs.appendFileSync(a.preregPath, 'a changed rule\n');
  assert.deepEqual(failed(a.service.gateStatus({ variantFile: V })), ['rule-sheet-pins']);
  // No code-frozen entry; an entry only inside a code fence; an entry for another code revision; an entry with the wrong data hash.
  assert.deepEqual(failed(serviceFixture({ frozen: false }).service.gateStatus({ variantFile: V })), ['code-frozen-entry']);
  const fencedOnly = serviceFixture({ frozen: false });
  fs.appendFileSync(fencedOnly.logPath, `\n\`\`\`\n${frozenEntry({ dataHash: fencedOnly.dataHash }).trim()}\n\`\`\`\n`);
  const fg = fencedOnly.service.gateStatus({ variantFile: V });
  assert.deepEqual(failed(fg), ['code-frozen-entry'], 'an entry inside a code fence is not an entry');
  assert.match(detail(fg, 'code-frozen-entry'), /no entry titled/);
  const commentOnly = serviceFixture({ frozen: false });
  fs.appendFileSync(commentOnly.logPath, `\n<!--${frozenEntry({ dataHash: commentOnly.dataHash })}-->\n`);
  const cg = commentOnly.service.gateStatus({ variantFile: V });
  assert.deepEqual(failed(cg), ['code-frozen-entry'], 'an entry inside an HTML comment is not an entry');
  assert.match(detail(cg, 'code-frozen-entry'), /no entry titled/);
  const other = serviceFixture({ frozenRevision: 'sb-code-2026-01-01-1' });
  const og = other.service.gateStatus({ variantFile: V });
  assert.deepEqual(failed(og), ['code-frozen-entry']);
  assert.match(detail(og, 'code-frozen-entry'), /does not name the current code revision/);
  const wrongHash = serviceFixture({ frozenHash: 'f'.repeat(64) });
  assert.match(detail(wrongHash.service.gateStatus({ variantFile: V }), 'code-frozen-entry'), /names data hash f{64}, not the data version's/);
  // The pre-registration commit missing, or the code not committed.
  const noCommit = serviceFixture({ overrides: { prereg: { ok: false, detail: 'commit x is not in this repository', committedAt: null } } });
  assert.ok(failed(noCommit.service.gateStatus({ variantFile: V })).includes('pre-registration-commit'));
  const dirty = serviceFixture({ overrides: { uncommitted: [' M server/sweepbos/engine.js'] } });
  assert.deepEqual(failed(dirty.service.gateStatus({ variantFile: V })), ['code-committed']);
  // A data version downloaded before the pre-registration commit.
  const early = serviceFixture({ downloadedAt: '2026-11-03T16:00:00Z' });
  assert.match(detail(early.service.gateStatus({ variantFile: V }), 'data-version'), /not after the pre-registration commit/);
  // A stray bar after the bound.
  const late = serviceFixture();
  const db = store.openSbDb(late.dbFile);
  db.prepare('INSERT INTO sb_bars_1d (version_id, symbol, date, o, h, l, c) VALUES (1, ?, ?, 1, 2, 0.5, 1)').run('QQQ', '2023-01-03');
  db.close();
  const lg = late.service.gateStatus({ variantFile: V });
  assert.ok(failed(lg).includes('bar-bound'));
  assert.match(detail(lg, 'bar-bound'), /0 five-minute, 1 daily/);
  assert.ok(failed(lg).includes('data-version'), 'the stored hash no longer recomputes either');
  // A malformed run entry in the log.
  const malformed = serviceFixture({ extraLog: '\n## 2 | 2026-11-03 | **Run** run id: 7 without the rest\n\ntext\n' });
  const mg = malformed.service.gateStatus({ variantFile: V });
  assert.deepEqual(failed(mg), ['log-well-formed']);
  assert.match(detail(mg, 'log-well-formed'), /malformed run entries: #2/);
  // A log entry naming a run the database does not hold.
  const phantom = serviceFixture({ extraLog: `\n## 2 | 2026-11-03 | **Run** run id: 9, variant: ${V}, variant hash: ${'a'.repeat(64)}, status: done\n\ntext\n` });
  assert.match(detail(phantom.service.gateStatus({ variantFile: V }), 'log-well-formed'), /names run 9, which the database does not hold/);
  // The variant: not pre-registered, edited, or a file of another round.
  const vf = serviceFixture();
  fs.copyFileSync(path.join(vf.variantDir, V), path.join(vf.variantDir, 'sb-x-0.1.0.json'));
  const vg = vf.service.gateStatus({ variantFile: 'sb-x-0.1.0.json' });
  assert.deepEqual(failed(vg), ['variant']);
  assert.match(detail(vg, 'variant'), /not one of round 1's 8 pre-registered variants/);
  const text = fs.readFileSync(path.join(vf.variantDir, V), 'utf8');
  fs.writeFileSync(path.join(vf.variantDir, V), text.replace('"beyondBy": 0.01', '"beyondBy": 0.02'));
  assert.match(detail(vf.service.gateStatus({ variantFile: V }), 'variant'), /differs from its pinned SHA-256/);
  // The lock held by a live process.
  const locked = serviceFixture();
  const ldb = store.openSbDb(locked.dbFile);
  const lock = store.acquireLock(ldb, { at: 't' });
  assert.deepEqual(failed(locked.service.gateStatus({ variantFile: V })), ['lock']);
  store.releaseLock(ldb, lock);
  ldb.close();
  assert.deepEqual(failed(locked.service.gateStatus({ variantFile: V })), []);
  // No database at all.
  const none = serviceFixture();
  fs.rmSync(none.dbFile);
  for (const f of fs.readdirSync(none.dir)) if (f.startsWith('sweep-bos-sim.sqlite')) fs.rmSync(path.join(none.dir, f), { force: true });
  assert.match(detail(none.service.gateStatus({ variantFile: V }), 'data-version'), /does not exist/);
});

test('a run records the row, trades, sessions, ledger and the exact log entry; the variant cannot run twice; the entry must be in the log', () => {
  const f = serviceFixture();
  assert.throws(() => f.service.run({ variantFile: V }), /confirm/);
  assert.equal(f.service.listRuns().length, 0);
  const r = f.service.run({ variantFile: V, confirm: true });
  assert.equal(r.run.status, 'done');
  assert.equal(r.run.round, 1);
  assert.equal(r.run.variant, V);
  assert.equal(r.run.codeRevision, CODE_REVISION);
  assert.equal(r.run.headCommit, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(r.run.preregCommit, COMMIT);
  assert.equal(r.run.dataHash, f.dataHash);
  assert.deepEqual(r.run.window, { start: '2019-01-02', end: '2022-12-30' });
  assert.match(r.run.sourceHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(r.run.metrics.perInstrument), ['QQQ', 'SPY']);
  const q = r.run.metrics.perInstrument.QQQ;
  assert.equal(q.sessionsInWindow, 61, 'the synthetic sessions inside the development window (2019-01-02 to 2019-03-29)');
  assert.equal(Object.values(q.stageCounts).reduce((a, b) => a + b, 0), 61);
  assert.equal(typeof r.run.metrics.candidate, 'boolean');
  assert.deepEqual(r.run.details.testOverrides.sort(), ['committedAt', 'head', 'pins', 'prereg', 'preregCommit', 'revision', 'uncommitted']);
  const db = store.openSbDb(f.dbFile, { readOnly: true });
  assert.equal(store.listSessions(db, r.run.id, 'QQQ').length, 61);
  assert.equal(store.listTrades(db, r.run.id, 'QQQ').length, q.trades);
  const ledger = store.listLedger(db);
  assert.equal(ledger.filter((l) => l.kind === 'run').length, 1);
  assert.equal(store.currentLock(db), null, 'the lock is released');
  db.close();
  // The entry: the exact form the gate reads.
  const entries = parseEntries(r.entry);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].number, 2);
  assert.match(entries[0].title, RUN_ENTRY);
  const m = entries[0].title.match(RUN_ENTRY);
  assert.deepEqual([Number(m[1]), m[2], m[3], m[4]], [r.run.id, V, r.run.variantHash, 'done']);
  assert.match(entries[0].body, /Measured: QQQ: sessions 61, trades \d+/);
  assert.match(entries[0].body, /Candidate by the pre-registered criteria: (YES|no)/);
  assert.ok(!/\b\d{2,3}\.\d{2}\b.*\b\d{2,3}\.\d{2}\b.*\b\d{2,3}\.\d{2}\b.*\b\d{2,3}\.\d{2}\b.*\b\d{2,3}\.\d{2}\b/.test(entries[0].body.replace(/ending cash [\d.]+, max drawdown [\d.]+/g, '')), 'no price list in the entry');
  // Until the entry is in the log, the gate refuses every run (the recorded run is not logged).
  const g = f.service.gateStatus({ variantFile: 'sb-ob-b-nobias-0.1.0.json' });
  assert.deepEqual(failed(g), ['log-well-formed']);
  assert.match(detail(g, 'log-well-formed'), /run 1 \(sb-ob-a-nobias-0.1.0.json, done\) has no log entry/);
  fs.appendFileSync(f.logPath, r.entry);
  assert.deepEqual(failed(f.service.gateStatus({ variantFile: 'sb-ob-b-nobias-0.1.0.json' })), []);
  const again = f.service.gateStatus({ variantFile: V });
  assert.deepEqual(failed(again), ['variant-not-run']);
  assert.match(detail(again, 'variant-not-run'), /already ran in round 1 \(run 1\)/);
  assert.throws(() => f.service.run({ variantFile: V, confirm: true }), GateError);
  assert.equal(f.service.listRuns().length, 1, 'the refused run left no row');
  assert.equal(logStatus(f.logPath, { preregCommit: COMMIT }).runs.length, 1);
  // Inside the lock the run re-checks: a run recorded between the check and the lock is refused.
  const ls = logStatus(f.logPath, { preregCommit: COMMIT });
  assert.equal(ls.nextNumber, 3);
});

test('a failed run is recorded with its reason and allows a retry; a crashed run is marked failed; the pick report waits for the round', () => {
  const f = serviceFixture();
  const bad = f.make({ failWith: 'synthetic failure' });
  const r = bad.run({ variantFile: V, confirm: true });
  assert.equal(r.run.status, 'failed');
  assert.equal(r.run.error, 'synthetic failure');
  assert.match(r.entry, /status: failed/);
  assert.match(r.entry, /FAILED: synthetic failure/);
  fs.appendFileSync(f.logPath, r.entry);
  const g = f.service.gateStatus({ variantFile: V });
  assert.deepEqual(failed(g), []);
  assert.match(detail(g, 'variant-not-run'), /1 failed attempt\(s\) logged/);
  // A crash: a row left "running".
  const db = store.openSbDb(f.dbFile);
  const crashed = store.createRun(db, { round: 1, variant: V, variantHash: 'a'.repeat(64), dataVersionId: 1, dataHash: f.dataHash, window: { start: '2019-01-02', end: '2022-12-30' }, codeRevision: CODE_REVISION, engineVersion: 'sb-engine-1', preregCommit: COMMIT, preregSha256: 'b'.repeat(64), createdAt: 't' });
  db.close();
  const cg = f.service.gateStatus({ variantFile: V });
  assert.match(detail(cg, 'log-well-formed'), new RegExp(`run ${crashed} is still marked running`));
  assert.throws(() => f.service.markFailed(999, 'x'), /does not exist/);
  const mf = f.service.markFailed(crashed, 'the process was killed');
  assert.equal(mf.run.status, 'failed');
  assert.match(mf.entry, /status: failed/);
  fs.appendFileSync(f.logPath, mf.entry);
  assert.throws(() => f.service.markFailed(crashed, 'again'), /is failed, not running/);
  assert.deepEqual(failed(f.service.gateStatus({ variantFile: V })), []);
  // The pick report before the round is complete.
  const p0 = f.service.pickReport();
  assert.equal(p0.recorded, 0);
  assert.equal(p0.pick, null);
  assert.match(p0.reason, /not all 8 runs are recorded \(0 of 8\)/);
  // The whole round on the synthetic data: eight runs, each logged, then a report-only pick.
  for (const v of ROUND1_VARIANTS) {
    const rr = f.service.run({ variantFile: v, confirm: true });
    assert.equal(rr.run.status, 'done', rr.run.error || '');
    fs.appendFileSync(f.logPath, rr.entry);
  }
  const p = f.service.pickReport();
  assert.equal(p.recorded, 8);
  assert.equal(p.complete, true);
  assert.equal(p.ranking.length, 8);
  assert.ok(p.pick === null || typeof p.pick === 'string');
  if (!p.candidates.length) assert.match(p.reason, /NONE advances/);
  assert.equal(logStatus(f.logPath, { preregCommit: COMMIT }).runs.filter((x) => x.status === 'done').length, 8);
  assert.equal(frozenEntry({ dataHash: 'x' }).includes(COMMIT), true);
});
