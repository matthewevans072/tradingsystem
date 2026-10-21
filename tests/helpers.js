import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';

process.env.SIGNAL_DESK_QUIET = '1';

export function tempDir(prefix = 'sd-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
