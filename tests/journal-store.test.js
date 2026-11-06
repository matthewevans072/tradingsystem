// The prospective journal's database (server/research/journal-store.js): the file guard, append-only tables,
// sessions in strict date order (no backfill, no rewrite), no live session before the start, no warm-up session at
// or after it, nothing live before activation, write-once meta. Synthetic rows only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import * as store from '../server/research/journal-store.js';

const AT = '2026-11-06T22:00:00.000Z';
function fresh() { const dir = tempDir('pj-'); return store.openPjDb(path.join(dir, 'prospective-1.sqlite')); }
const upd = (db) => store.insertUpdate(db, { kind: 'update', status: 'recorded', startedAt: AT, recordedAt: AT });

test('the guard refuses every other programme\'s database, links to them and foreign tables', () => {
  const dir = tempDir('pj-');
  for (const n of ['signal-desk.sqlite', 'demo.sqlite', 'strategy-lab.sqlite', 'hxr-sim.sqlite', 'range-trend-sim.sqlite', 'sweep-bos-sim.sqlite', 'ict-lab-sim.sqlite', 'research-runner.sqlite']) assert.throws(() => store.openPjDb(path.join(dir, n)), /never opens/, n);
  const foreign = path.join(dir, 'x.sqlite'); const f = new DatabaseSync(foreign); f.exec('CREATE TABLE rr_campaigns (id INTEGER)'); f.close();
  assert.throws(() => store.openPjDb(foreign), /not the journal's/);
  const db = store.openPjDb(path.join(dir, 'prospective-1.sqlite'));
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 2, 'synchronous FULL: a commit is on disk before it returns');
  db.close();
});

test('nothing live before activation; after it, sessions only in strict date order, live never before the start, warm-up never at or after it', () => {
  const db = fresh();
  const u = upd(db);
  const s = (date, phase, extra = {}) => store.insertSession(db, { date, phase, updateId: u, recordedAt: AT, nextOpen: phase === 'live' ? '2026-11-09T14:30:00.000Z' : null, onTime: phase === 'live' ? true : null, barsSha256: 'x', ...extra });
  assert.throws(() => s('2026-11-06', 'live'), /not activated/);
  store.setMeta(db, 'start', '2026-11-06', AT);
  assert.throws(() => store.setMeta(db, 'start', '2026-11-09', AT), /UNIQUE|constraint/i, 'meta is write-once');
  s('2026-11-04', 'warmup'); s('2026-11-05', 'warmup');
  assert.throws(() => s('2026-11-05', 'live'), /no backfill|before the start/);
  assert.throws(() => s('2026-11-04', 'warmup'), /no backfill/);
  assert.throws(() => s('2026-11-06', 'warmup'), /live, never warm-up/);
  assert.throws(() => s('2026-11-06', 'live', { onTime: null }), /on-time flag/);
  s('2026-11-06', 'live');
  assert.throws(() => s('2026-11-06', 'live'), /no backfill|UNIQUE/);
  assert.throws(() => s('2026-11-03', 'warmup'), /no backfill/);
  s('2026-11-09', 'live', { onTime: false });
  assert.deepEqual(store.listSessions(db).map((x) => [x.date, x.phase, x.onTime]), [['2026-11-04', 'warmup', null], ['2026-11-05', 'warmup', null], ['2026-11-06', 'live', true], ['2026-11-09', 'live', false]]);
  db.close();
});

test('every table is append-only: an on-time flag, a recorded_at, a bar, an event or a state can never be rewritten or deleted', () => {
  const db = fresh();
  const u = upd(db);
  store.setMeta(db, 'start', '2026-11-06', AT);
  store.insertSession(db, { date: '2026-11-06', phase: 'live', updateId: u, recordedAt: AT, nextOpen: '2026-11-09T14:30:00.000Z', onTime: false, barsSha256: 'x' });
  store.insertBars(db, [{ symbol: 'MU', date: '2026-11-06', o: 1, h: 1, l: 1, c: 1, source: 'test', updateId: u, receivedAt: AT }]);
  store.insertActions(db, [{ id: 'a1', symbol: 'MU', type: 'cash_dividend', ex_date: '2026-11-06', rate: 0.1, source: 'test', updateId: u, receivedAt: AT }]);
  store.insertEvents(db, [{ updateId: u, kind: 'decision_entry', recordedAt: AT, onTime: false }]);
  store.insertState(db, { updateId: u, rule: 'M1', ledger: 'primary', through: '2026-11-06', snapshotJson: '{}', sha256: 'x' });
  store.insertRelease(db, { updateId: u, afterSession: '2026-11-06', fillAfter: '2026-11-06', recordedAt: AT, symbols: [] });
  const attempts = [
    "UPDATE pj_sessions SET on_time = 1", "UPDATE pj_sessions SET recorded_at = '2026-11-06T20:00:00Z'", 'DELETE FROM pj_sessions',
    'UPDATE pj_bars SET c = 2', 'DELETE FROM pj_bars', 'UPDATE pj_actions SET rate = 9', 'UPDATE pj_events SET on_time = 1', 'DELETE FROM pj_events',
    "UPDATE pj_state SET snapshot_json = '[]'", 'DELETE FROM pj_state', "UPDATE pj_meta SET value_json = '\"2026-11-09\"'", 'DELETE FROM pj_meta',
    "UPDATE pj_updates SET status = 'x'", 'DELETE FROM pj_updates', "UPDATE pj_releases SET fill_after = 'x'",
  ];
  for (const sql of attempts) assert.throws(() => db.exec(sql), /append-only/, sql);
  assert.throws(() => store.insertBars(db, [{ symbol: 'MU', date: '2026-11-06', o: 2, h: 2, l: 2, c: 2, source: 'test', updateId: u, receivedAt: AT }]), /UNIQUE/, 'a bar as received is never replaced');
  assert.equal(store.listSessions(db)[0].onTime, false);
  db.close();
});
