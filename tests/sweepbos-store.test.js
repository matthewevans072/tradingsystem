// sweep-bos store: the file guard, the schema, the bar bound at the lowest layer, the append-only ledger and
// the lock. Synthetic rows only; no market data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import * as store from '../server/sweepbos/store.js';
import { MAX_BAR_DATE } from '../server/sweepbos/config.js';

const bar = (session, idx, p = 100) => ({ session, idx, ts: 1, hhmm: '09:30', o: p, h: p + 1, l: p - 1, c: p, v: 10 });
const day = (date, p = 100) => ({ date, o: p, h: p + 1, l: p - 1, c: p, v: 10 });
const version = (db, to = MAX_BAR_DATE) => store.createDataVersion(db, { label: 't', symbols: ['QQQ'], from: '2018-06-01', to, feed: 'sip', adjustment: 'raw', source: 'alpaca', timeframes: ['1Day', '5Min'], downloadedAt: '2026-11-03T12:00:00Z' });

test('the guard refuses the portfolio, demo, Strategy Lab, HXR and range-trend files and any file with foreign tables', () => {
  const dir = tempDir('sb-store-');
  for (const name of ['signal-desk.sqlite', 'demo.sqlite', 'strategy-lab.sqlite', 'strategy-lab-demo.sqlite', 'hxr-sim.sqlite', 'HXR-other.sqlite', 'range-trend-sim.sqlite']) {
    assert.throws(() => store.openSbDb(path.join(dir, name)), /never opens/, name);
    assert.ok(!fs.existsSync(path.join(dir, name)), `${name} was not created`);
  }
  const foreign = path.join(dir, 'other.sqlite');
  const raw = new DatabaseSync(foreign);
  raw.exec('CREATE TABLE holdings (id INTEGER PRIMARY KEY)');
  raw.close();
  assert.throws(() => store.openSbDb(foreign), /tables that are not sweep-bos's \(holdings\)/);
  assert.throws(() => store.openSbDb(path.join(dir, 'missing.sqlite'), { readOnly: true }), /does not exist/);
  const db = store.openSbDb(path.join(dir, 'sweep-bos-sim.sqlite'));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  assert.ok(tables.includes('sb_bars_5m') && tables.includes('sb_bars_1d') && tables.includes('sb_runs') && tables.includes('sb_ledger') && tables.includes('sb_lock'));
  assert.ok(tables.every((t) => /^sb_/.test(t)));
  assert.equal(store.schemaVersion(db), 1);
  db.close();
  const ro = store.openSbDb(path.join(dir, 'sweep-bos-sim.sqlite'), { readOnly: true });
  assert.throws(() => ro.exec("INSERT INTO sb_settings (key, value) VALUES ('x', 'y')"), /readonly|read-only/i);
  ro.close();
});

test('the bar bound: no bar after MAX_BAR_DATE is stored, and none is ever returned by a load', () => {
  const dir = tempDir('sb-store-');
  const db = store.openSbDb(path.join(dir, 'sweep-bos-sim.sqlite'));
  assert.equal(MAX_BAR_DATE, '2022-12-30');
  // A version whose requested end is after the bound is refused before anything is written.
  assert.throws(() => version(db, '2023-01-03'), store.BarBoundError);
  assert.equal(store.listDataVersions(db).length, 0);
  const id = version(db);
  // An insert with one late row writes nothing (the whole batch is refused).
  assert.throws(() => store.insertBars5m(db, id, 'QQQ', [bar('2022-12-30', 0), bar('2023-01-03', 0)]), store.BarBoundError);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sb_bars_5m').get().n, 0);
  assert.throws(() => store.insertBars1d(db, id, 'QQQ', [day('2022-12-30'), day('2023-01-03')]), store.BarBoundError);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sb_bars_1d').get().n, 0);
  assert.equal(store.insertBars5m(db, id, 'QQQ', [bar('2022-12-29', 0), bar('2022-12-30', 0), bar('2022-12-30', 1)]), 3);
  assert.equal(store.insertBars1d(db, id, 'QQQ', [day('2022-12-29'), day('2022-12-30')]), 2);
  // A stray row written behind the store's back is never returned, whatever range is asked for, and is reported.
  db.prepare('INSERT INTO sb_bars_5m (version_id, symbol, session, idx, ts, hhmm, o, h, l, c) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'QQQ', '2023-01-03', 0, 1, '09:30', 1, 2, 0.5, 1);
  db.prepare('INSERT INTO sb_bars_1d (version_id, symbol, date, o, h, l, c) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'QQQ', '2024-12-31', 1, 2, 0.5, 1);
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

test('data hash, ledger append-only, lock', () => {
  const dir = tempDir('sb-store-');
  const db = store.openSbDb(path.join(dir, 'sweep-bos-sim.sqlite'));
  const id = version(db);
  store.insertBars5m(db, id, 'QQQ', [bar('2022-12-29', 0), bar('2022-12-29', 1)]);
  store.insertBars1d(db, id, 'QQQ', [day('2022-12-29')]);
  const h1 = store.dataHashOf(db, id);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(store.dataHashOf(db, id), h1, 'deterministic');
  db.prepare('UPDATE sb_bars_5m SET c = c + 0.01 WHERE idx = 1').run();
  assert.notEqual(store.dataHashOf(db, id), h1, 'a changed bar changes the hash');
  store.completeDataVersion(db, id, { finishedAt: 't', bars5m: 2, bars1d: 1, dropped: {}, dataHash: h1 });
  assert.equal(store.getDataVersion(db, id).status, 'complete');
  const lid = store.appendLedger(db, { kind: 'note', note: 'x', at: 't' });
  assert.throws(() => db.prepare('UPDATE sb_ledger SET note = ? WHERE id = ?').run('y', lid), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM sb_ledger WHERE id = ?').run(lid), /append-only/);
  assert.equal(store.listLedger(db).length, 1);
  const a = store.acquireLock(db, { pid: 1001, at: 't1', isAlive: () => true });
  assert.throws(() => store.acquireLock(db, { pid: 1002, at: 't2', isAlive: () => true }), store.LockedError);
  assert.equal(store.releaseLock(db, { pid: 1002, token: 'nope' }), false, 'only the owner releases');
  assert.equal(store.currentLock(db).pid, 1001);
  const b = store.acquireLock(db, { pid: 1003, at: 't3', isAlive: () => false });
  assert.equal(store.currentLock(db).pid, 1003, 'a dead holder is taken over');
  assert.equal(store.releaseLock(db, a), false);
  assert.equal(store.releaseLock(db, b), true);
  assert.equal(store.currentLock(db), null);
  db.close();
});
