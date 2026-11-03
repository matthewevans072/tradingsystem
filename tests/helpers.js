import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';

process.env.SIGNAL_DESK_QUIET = '1';

// Every database a test process opens is closed when the process exits, whoever opened it (the test itself,
// a service or the app code under test): on Windows an open SQLite file cannot be deleted, which is what left
// temp directories behind after a run. The hook records a database the first time it runs a statement, so no
// test has to register anything; a database the test already closed is skipped.
const openDbs = new Set();
for (const method of ['exec', 'prepare']) {
  const original = DatabaseSync.prototype[method];
  DatabaseSync.prototype[method] = function tracked(...args) { openDbs.add(this); return original.apply(this, args); };
}
export function closeOpenDbs() {
  let closed = 0;
  for (const db of openDbs) { try { db.close(); closed++; } catch { /* already closed */ } }
  openDbs.clear();
  return closed;
}

// Every temp directory a test creates is removed when the test process exits (node --test runs each file in
// its own process), after every open database has been closed. A directory that still cannot be removed is
// retried a few times and otherwise reported (SIGNAL_DESK_TEMP_REPORT=1).
const created = [];
let hooked = false;
export function removeTempDirs() {
  const left = [];
  for (const dir of created.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* still open: retried below */ }
    if (fs.existsSync(dir)) left.push(dir);
  }
  return left;
}
export function tempDir(prefix = 'sd-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  if (!hooked) {
    hooked = true;
    process.on('exit', () => { closeOpenDbs(); const left = removeTempDirs(); if (left.length && process.env.SIGNAL_DESK_TEMP_REPORT) process.stderr.write(`temp directories left (files still open at exit): ${left.join(', ')}\n`); });
  }
  return dir;
}

export function tempDb() {
  const dir = tempDir();
  const file = path.join(dir, 'test.sqlite');
  return { db: openDb(file), file, dir };
}

export function putQuote(db, instrumentId, q) {
  db.prepare(`INSERT OR REPLACE INTO quotes (instrument_id, provider, price, prev_close, change, change_pct, open, high, low, volume,
              session, quote_time, fetched_at, timeliness, delay_minutes)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    instrumentId, q.provider || 'fixture', q.price, q.prev_close ?? null, q.change ?? null, q.change_pct ?? null,
    q.open ?? null, q.high ?? null, q.low ?? null, q.volume ?? null, q.session ?? 'regular',
    q.quote_time ?? new Date().toISOString(), new Date().toISOString(), q.timeliness ?? 'real-time', q.delay_minutes ?? 0);
}
