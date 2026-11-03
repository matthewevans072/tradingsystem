// Test hygiene (tests/helpers.js): every database a test process opens, by any path, is closed at exit so the
// temp directories can be removed on Windows; closeOpenDbs and removeTempDirs are exercised directly here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir, tempDb, closeOpenDbs, removeTempDirs } from './helpers.js';
import { openSbDb } from '../server/sweepbos/store.js';

test('databases opened by the test, by a store or by the app are closed at cleanup and their directories removed', () => {
  const { db, dir } = tempDb(); // opened through server/db.js, never closed by this test
  assert.ok(db.prepare('SELECT version FROM schema_version').get().version > 0);
  const dir2 = tempDir('sd-hygiene-');
  const raw = new DatabaseSync(path.join(dir2, 'raw.sqlite'));
  raw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
  const dir3 = tempDir('sd-hygiene-');
  const sb = openSbDb(path.join(dir3, 'sweep-bos-sim.sqlite'));
  sb.prepare("INSERT INTO sb_settings (key, value) VALUES ('k', 'v')").run();
  const dir4 = tempDir('sd-hygiene-');
  const closedByTest = new DatabaseSync(path.join(dir4, 'c.sqlite'));
  closedByTest.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
  closedByTest.close();
  const closed = closeOpenDbs();
  assert.equal(closed, 3, 'the three still-open databases were closed; the one the test closed was skipped');
  assert.throws(() => db.prepare('SELECT 1'), /closed|not open/i, 'the portfolio-style database is closed');
  assert.throws(() => raw.exec('SELECT 1'), /closed|not open/i);
  assert.throws(() => sb.exec('SELECT 1'), /closed|not open/i);
  const left = removeTempDirs();
  assert.deepEqual(left, [], 'every directory was removed');
  for (const d of [dir, dir2, dir3, dir4]) assert.ok(!fs.existsSync(d), `${d} removed`);
  assert.equal(closeOpenDbs(), 0, 'nothing left to close');
});
