import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';

process.env.SIGNAL_DESK_QUIET = '1';

// Every temp directory a test creates is removed when the test process exits (node --test runs each file in
// its own process). A directory whose files are still open at exit (an unclosed database on Windows) is
// retried a few times and otherwise left; the test that forgot to close it should close it.
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
    process.on('exit', () => { const left = removeTempDirs(); if (left.length && process.env.SIGNAL_DESK_TEMP_REPORT) process.stderr.write(`temp directories left (files still open at exit): ${left.join(', ')}\n`); });
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
