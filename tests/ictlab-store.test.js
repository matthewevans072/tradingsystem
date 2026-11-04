// ICT Lab store: the file guard, the schema, the bar bound at the lowest layer, the append-only ledger, the
// write-once settings and the lock. Synthetic rows only; no market data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import * as store from '../server/ictlab/store.js';
import { MAX_BAR_DATE } from '../server/ictlab/config.js';

const bar = (session, idx, p = 100) => ({ session, idx, ts: 1, hhmm: '09:30', o: p, h: p + 1, l: p - 1, c: p, v: 10 });
const day = (date, p = 100) => ({ date, o: p, h: p + 1, l: p - 1, c: p, v: 10 });
const version = (db, to = MAX_BAR_DATE) => store.createDataVersion(db, { label: 't', symbols: ['QQQ'], from: '2018-06-01', to, feed: 'sip', adjustment: 'raw', source: 'alpaca', timeframes: ['1Day', '5Min'], downloadedAt: '2026-11-04T12:00:00Z' });

test('the guard refuses the portfolio, demo, Strategy Lab, HXR, range-trend and sweep-bos files, dangling links and foreign tables', () => {
  const dir = tempDir('il-store-');
  for (const name of ['signal-desk.sqlite', 'demo.sqlite', 'strategy-lab.sqlite', 'strategy-lab-demo.sqlite', 'hxr-sim.sqlite', 'HXR-other.sqlite', 'range-trend-sim.sqlite', 'sweep-bos-sim.sqlite', 'Sweep-Bos-x.sqlite']) {
    assert.throws(() => store.openIlDb(path.join(dir, name)), /never opens/, name);
    assert.ok(!fs.existsSync(path.join(dir, name)), `${name} was not created`);
  }
  const foreign = path.join(dir, 'other.sqlite');
  const raw = new DatabaseSync(foreign);
  raw.exec('CREATE TABLE holdings (id INTEGER PRIMARY KEY)');
  raw.close();
  assert.throws(() => store.openIlDb(foreign), /tables that are not the lab's \(holdings\)/);
  const sbLike = path.join(dir, 'lab-copy.sqlite');
  const raw2 = new DatabaseSync(sbLike);
  raw2.exec('CREATE TABLE sb_bars_5m (id INTEGER PRIMARY KEY)');
  raw2.close();
  assert.throws(() => store.openIlDb(sbLike), /sb_bars_5m/);
  assert.throws(() => store.openIlDb(path.join(dir, 'missing.sqlite'), { readOnly: true }), /does not exist/);
  // A link to a refused file is refused by its real name; a dangling link is refused outright.
  let links = true;
  try { fs.symlinkSync(path.join(dir, 'signal-desk.sqlite'), path.join(dir, 'dangling.sqlite'), 'file'); } catch { links = false; }
  if (links) {
    assert.throws(() => store.openIlDb(path.join(dir, 'dangling.sqlite')), /dangling link/);
    const db0 = store.openIlDb(path.join(dir, 'ict-lab-sim.sqlite')); db0.close();
    fs.symlinkSync(path.join(dir, 'ict-lab-sim.sqlite'), path.join(dir, 'hxr-link.sqlite'), 'file');
    assert.throws(() => store.openIlDb(path.join(dir, 'hxr-link.sqlite')), /never opens/, 'refused by the link name');
    fs.symlinkSync(path.join(dir, 'ict-lab-sim.sqlite'), path.join(dir, 'alias.sqlite'), 'file');
    const viaLink = store.openIlDb(path.join(dir, 'alias.sqlite'));
    viaLink.close();
  }
  const db = store.openIlDb(path.join(dir, 'ict-lab-sim.sqlite'));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  for (const t of ['il_data_versions', 'il_bars_5m', 'il_bars_1d', 'il_sessions', 'il_runs', 'il_trades', 'il_ledger', 'il_settings', 'il_lock', 'il_schema_version']) assert.ok(tables.includes(t), t);
  assert.ok(tables.every((t) => /^il_/.test(t)));
  assert.equal(store.schemaVersion(db), 1);
  db.close();
  const ro = store.openIlDb(path.join(dir, 'ict-lab-sim.sqlite'), { readOnly: true });
  assert.throws(() => ro.exec("INSERT INTO il_settings (key, value, at) VALUES ('x', 'y', 't')"), /readonly|read-only/i);
  ro.close();
});

test('the bar bound: no bar after MAX_BAR_DATE is stored, and none is ever returned by a load, a row written behind the store\'s back included', () => {
  const dir = tempDir('il-store-');
  const db = store.openIlDb(path.join(dir, 'ict-lab-sim.sqlite'));
  assert.equal(MAX_BAR_DATE, '2022-12-30');
  assert.throws(() => version(db, '2023-01-03'), store.BarBoundError);
  assert.equal(store.listDataVersions(db).length, 0);
  const id = version(db);
  assert.throws(() => store.insertBars5m(db, id, 'QQQ', [bar('2022-12-30', 0), bar('2023-01-03', 0)]), store.BarBoundError);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM il_bars_5m').get().n, 0, 'the whole batch is refused');
  assert.throws(() => store.insertBars1d(db, id, 'QQQ', [day('2022-12-30'), day('2023-01-03')]), store.BarBoundError);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM il_bars_1d').get().n, 0);
  assert.equal(store.insertBars5m(db, id, 'QQQ', [bar('2022-12-29', 0), bar('2022-12-30', 0), bar('2022-12-30', 1)]), 3);
  assert.equal(store.insertBars1d(db, id, 'QQQ', [day('2022-12-29'), day('2022-12-30')]), 2);
  db.prepare('INSERT INTO il_bars_5m (version_id, symbol, session, idx, ts, hhmm, o, h, l, c) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'QQQ', '2023-01-03', 0, 1, '09:30', 1, 2, 0.5, 1);
  db.prepare('INSERT INTO il_bars_1d (version_id, symbol, date, o, h, l, c) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'QQQ', '2024-12-31', 1, 2, 0.5, 1);
  assert.deepEqual(store.loadBars5m(db, id, 'QQQ', { to: '2030-01-01' }).map((b) => b.session), ['2022-12-29', '2022-12-30', '2022-12-30']);
  assert.deepEqual(store.loadBars5m(db, id, 'QQQ').map((b) => b.session), ['2022-12-29', '2022-12-30', '2022-12-30']);
  assert.deepEqual(store.loadBars1d(db, id, 'QQQ', { to: '2030-01-01' }).map((b) => b.date), ['2022-12-29', '2022-12-30']);
  assert.deepEqual(store.sessionCounts5m(db, id, 'QQQ').map((c) => c.session), ['2022-12-29', '2022-12-30']);
  assert.deepEqual(store.countBarsAfterBound(db), { bars5m: 1, bars1d: 1 });
  assert.equal(store.maxStoredDate(db), '2024-12-31');
  assert.equal(store.withinBound('2022-12-30'), true);
  assert.equal(store.withinBound('2022-12-31'), false);
  assert.equal(store.withinBound('not a date'), false);
  db.close();
});

test('data hash, the append-only ledger, the write-once settings and the lock', () => {
  const dir = tempDir('il-store-');
  const db = store.openIlDb(path.join(dir, 'ict-lab-sim.sqlite'));
  const id = version(db);
  store.insertBars5m(db, id, 'QQQ', [bar('2022-12-29', 0), bar('2022-12-29', 1)]);
  store.insertBars1d(db, id, 'QQQ', [day('2022-12-29')]);
  const h1 = store.dataHashOf(db, id);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(store.dataHashOf(db, id), h1);
  db.prepare('UPDATE il_bars_5m SET c = c + 0.01 WHERE idx = 1').run();
  assert.notEqual(store.dataHashOf(db, id), h1, 'a changed bar changes the hash');
  store.completeDataVersion(db, id, { finishedAt: 't', bars5m: 2, bars1d: 1, dropped: {}, dataHash: h1, comparison: { available: false } });
  assert.equal(store.getDataVersion(db, id).status, 'complete');
  assert.deepEqual(store.getDataVersion(db, id).comparison, { available: false });
  const lid = store.appendLedger(db, { kind: 'note', note: 'x', at: 't' });
  assert.throws(() => db.prepare('UPDATE il_ledger SET note = ? WHERE id = ?').run('y', lid), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM il_ledger WHERE id = ?').run(lid), /append-only/);
  assert.equal(store.listLedger(db).length, 1);
  assert.equal(store.setSettingOnce(db, 'first_run_code_revision', 'il-code-x', 't'), true);
  assert.equal(store.setSettingOnce(db, 'first_run_code_revision', 'il-code-x', 't2'), false, 'the same value again is a no-op');
  assert.throws(() => store.setSettingOnce(db, 'first_run_code_revision', 'il-code-y', 't3'), /write-once/);
  assert.throws(() => db.prepare("UPDATE il_settings SET value = 'z' WHERE key = 'first_run_code_revision'").run(), /write-once/);
  assert.throws(() => db.prepare("DELETE FROM il_settings WHERE key = 'first_run_code_revision'").run(), /write-once/);
  assert.equal(store.getSetting(db, 'first_run_code_revision'), 'il-code-x');
  const a = store.acquireLock(db, { pid: 1001, at: 't1', isAlive: () => true });
  assert.throws(() => store.acquireLock(db, { pid: 1002, at: 't2', isAlive: () => true }), store.LockedError);
  assert.equal(store.releaseLock(db, { pid: 1002, token: 'nope' }), false, 'only the owner releases');
  assert.equal(store.releaseLock(db, { pid: 1001, token: 'wrong-token' }), false, 'the token is checked too');
  assert.equal(store.currentLock(db).pid, 1001);
  const b = store.acquireLock(db, { pid: 1003, at: 't3', isAlive: () => false });
  assert.equal(store.currentLock(db).pid, 1003, 'a dead holder is taken over');
  assert.equal(store.releaseLock(db, a), false);
  assert.equal(store.releaseLock(db, b), true);
  assert.equal(store.currentLock(db), null);
  assert.equal(db.isTransaction, false, 'the lock calls leave no transaction open');
  db.close();
});

test('runs, trades, sessions: the row carries every hash and the repeat marks; the shapes round-trip', () => {
  const dir = tempDir('il-store-');
  const db = store.openIlDb(path.join(dir, 'ict-lab-sim.sqlite'));
  const id = version(db);
  const runId = store.createRun(db, { round: 1, spec: 's.json', specHash: 'a'.repeat(64), window: 'development', repeat: true, repeatReason: 'why', contaminated: false, dataVersionId: id, dataHash: 'b'.repeat(64), windowDates: { start: '2018-06-01', end: '2022-12-30' }, codeRevision: 'il-code-x', engineVersion: 'il-engine-1', sourceHash: 'c'.repeat(64), headCommit: 'd'.repeat(40), preregCommit: 'e'.repeat(40), protocolSha256: 'f'.repeat(64), conceptsSha256: '0'.repeat(64), details: { x: 1 }, createdAt: 't' });
  const r = store.getRun(db, runId);
  assert.equal(r.status, 'running');
  assert.deepEqual([r.repeat, r.repeatReason, r.contaminated, r.window, r.protocolSha256.length, r.conceptsSha256.length], [true, 'why', false, 'development', 64, 64]);
  assert.throws(() => store.createRun(db, { round: 1, spec: 's', specHash: 'a', window: 'reserved', dataVersionId: id, dataHash: 'b', windowDates: {}, codeRevision: 'x', engineVersion: 'y', preregCommit: 'z', protocolSha256: 'p', conceptsSha256: 'c', createdAt: 't' }), /CHECK|constraint/i, 'the reserved window has no row');
  store.insertTrades(db, runId, [{ session: '2019-01-03', R: 1 }, { session: '2019-01-04', R: -1 }]);
  store.insertSessions(db, runId, [{ session: '2019-01-03', stage: 'filled' }, { session: '2019-01-04', stage: 'filled' }]);
  store.finishRun(db, runId, { finishedAt: 't2', metrics: { trades: 2 }, details: { x: 2 } });
  assert.equal(store.getRun(db, runId).status, 'done');
  assert.equal(store.listTrades(db, runId).length, 2);
  assert.equal(store.listSessions(db, runId).length, 2);
  assert.equal(store.listRuns(db).length, 1);
  db.close();
});
