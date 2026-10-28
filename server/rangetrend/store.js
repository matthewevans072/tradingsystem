// Range-trend results database (data/range-trend-sim.sqlite). Its own file only:
// the guard refuses the portfolio, demo, Strategy Lab and HXR databases, any file
// that resolves to one of them, a dangling symlink, and any file holding tables
// that are not range-trend's (rt_).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const RT_DB_NAME = 'range-trend-sim.sqlite';
export const rtDbFile = (dataDir) => path.join(dataDir, RT_DB_NAME);

export function isRefusedName(name) {
  const n = String(name).toLowerCase();
  return n === 'signal-desk.sqlite' || n === 'demo.sqlite' || n.startsWith('strategy-lab') || n.startsWith('hxr-sim') || n.startsWith('hxr');
}

export function guardRtFile(file) {
  const abs = path.resolve(file);
  const refuse = () => { throw new Error('Range-trend never opens the portfolio, demo, Strategy Lab or HXR databases'); };
  if (isRefusedName(path.basename(abs))) refuse();
  let real;
  if (fs.existsSync(abs)) real = fs.realpathSync(abs);
  else {
    let isLink = false;
    try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch { /* does not exist */ }
    if (isLink) throw new Error('Range-trend refuses a database path that is a dangling symlink');
    real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  }
  if (isRefusedName(path.basename(real))) refuse();
  return real;
}

const MIGRATIONS = [`
  CREATE TABLE rt_schema_version (version INTEGER NOT NULL);
  INSERT INTO rt_schema_version (version) VALUES (0);
  CREATE TABLE rt_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('practice')),
    config_file TEXT NOT NULL, version TEXT NOT NULL, config_hash TEXT NOT NULL, config_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
    reserve_json TEXT, protocol_hash TEXT NOT NULL, code_revision TEXT NOT NULL, symbols_hash TEXT,
    data_hash TEXT, calibration_hash TEXT, metrics_json TEXT, details_json TEXT, error TEXT,
    created_at TEXT NOT NULL, finished_at TEXT
  );
  CREATE TABLE rt_equity (run_id INTEGER NOT NULL REFERENCES rt_runs(id), date TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (run_id, date));
  CREATE TABLE rt_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES rt_runs(id), config_file TEXT NOT NULL, config_hash TEXT NOT NULL,
    reserve INTEGER NOT NULL DEFAULT 0, reserve_json TEXT, at TEXT NOT NULL
  );
  CREATE TRIGGER rt_ledger_no_update BEFORE UPDATE ON rt_ledger BEGIN SELECT RAISE(ABORT, 'rt_ledger is append-only'); END;
  CREATE TRIGGER rt_ledger_no_delete BEFORE DELETE ON rt_ledger BEGIN SELECT RAISE(ABORT, 'rt_ledger is append-only'); END;
`, `
  CREATE TABLE rt_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, at TEXT NOT NULL);
  CREATE TRIGGER rt_settings_no_update BEFORE UPDATE ON rt_settings BEGIN SELECT RAISE(ABORT, 'rt_settings rows are written once'); END;
  CREATE TRIGGER rt_settings_no_delete BEFORE DELETE ON rt_settings BEGIN SELECT RAISE(ABORT, 'rt_settings rows are written once'); END;
  -- Each planned config once, and one reserve run in all: the ledger slot is taken before a run starts.
  CREATE UNIQUE INDEX rt_ledger_once ON rt_ledger (config_file) WHERE reserve = 0;
  CREATE UNIQUE INDEX rt_ledger_one_reserve ON rt_ledger (reserve) WHERE reserve = 1;
`, `
  -- The service lock: one row, taken and released inside transactions (store.js acquireLock/releaseLock).
  CREATE TABLE rt_lock (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, token TEXT NOT NULL, host TEXT, at TEXT NOT NULL);
`];

function migrate(db) {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rt_schema_version'").get();
  let v = has ? db.prepare('SELECT version FROM rt_schema_version').get().version : -1;
  for (let i = v + 1; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[i]); db.prepare('UPDATE rt_schema_version SET version = ?').run(i); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

export function openRtDb(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const real = guardRtFile(file);
  if (fs.existsSync(real)) {
    const probe = new DatabaseSync(real, { readOnly: true });
    try {
      const foreign = probe.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all().map((r) => r.name).filter((n) => !/^rt_/i.test(n) && !/^sqlite_/i.test(n));
      if (foreign.length) throw new Error(`Range-trend refuses ${path.basename(real)}: it holds tables that are not range-trend's (${foreign.slice(0, 5).join(', ')})`);
    } finally { probe.close(); }
  }
  const db = new DatabaseSync(real);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

const j = (v) => (v == null ? null : JSON.stringify(v));
const p = (s) => (s == null ? null : JSON.parse(s));

// The symbols, data and calibration hashes, and the provenance known before the run (r.details), are stored
// with the row when it is created, so an interrupted or early-failed run keeps them.
export function createRun(db, r) {
  return Number(db.prepare(`INSERT INTO rt_runs (kind, config_file, version, config_hash, config_json, status, reserve_json, protocol_hash, code_revision, symbols_hash, data_hash, calibration_hash, details_json, created_at)
    VALUES ('practice', ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?)`).run(r.configFile, r.version, r.configHash, j(r.config), j(r.reserve), r.protocolHash, r.codeRevision, r.symbolsHash ?? null, r.dataHash ?? null, r.calibrationHash ?? null, j(r.details ?? null), r.at).lastInsertRowid);
}

export function finishRun(db, id, r) {
  db.prepare(`UPDATE rt_runs SET status = ?, symbols_hash = ?, data_hash = ?, calibration_hash = ?, metrics_json = ?, details_json = ?, error = ?, finished_at = ? WHERE id = ?`)
    .run(r.status, r.symbolsHash ?? null, r.dataHash ?? null, r.calibrationHash ?? null, j(r.metrics), j(r.details), r.error ?? null, r.at, id);
}

export function insertEquity(db, id, points) {
  const st = db.prepare('INSERT INTO rt_equity (run_id, date, json) VALUES (?, ?, ?)');
  for (const x of points) st.run(id, x.date, JSON.stringify(x));
}

// One transaction: the run row, its ledger slot and, at the first practice run, the protocol hash that is final
// for the practice runs. A second run of the same config (or a second reserve) fails on the unique index and
// leaves nothing behind. Returns { id, protocolFrozenAtRun }.
export function reserveSlot(db, r) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const id = createRun(db, r);
    appendLedger(db, { runId: id, configFile: r.configFile, configHash: r.configHash, reserve: !!r.reserve, reserveDetail: r.reserve, at: r.at });
    let protocolFrozenAtRun = false;
    if (r.protocolHash && !getSetting(db, 'protocolHash')) { setSettingOnce(db, 'protocolHash', { hash: r.protocolHash, firstRunId: id }, r.at); protocolFrozenAtRun = true; }
    // The first practice run's code revision: later runs under another revision need an owner-decisions row
    // naming the new one (service.js gate).
    if (r.codeRevision && !getSetting(db, 'codeRevision')) setSettingOnce(db, 'codeRevision', { revision: r.codeRevision, firstRunId: id }, r.at);
    db.exec('COMMIT');
    return { id, protocolFrozenAtRun };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// One live service instance per data directory: a single lock row in the results database (rt_lock, migration
// 2) holding the owner's pid and a random token. Taking the lock is one BEGIN IMMEDIATE transaction, so the
// liveness check and the takeover of a stale row (its process gone) are atomic: instances starting together
// cannot all hold it. A second instance refuses while the holder is alive, so a live run is never marked
// failed. Release deletes the row only when the pid and token are the caller's. If a row looks live although
// its process is gone (pid reuse), the owner deletes the row (DELETE FROM rt_lock).
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export const isAlive = alive;

export function acquireLock(db, { pid = process.pid, at, token = crypto.randomBytes(12).toString('hex') } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const held = db.prepare('SELECT pid, token, host, at FROM rt_lock WHERE id = 1').get();
    if (held && alive(held.pid)) {
      const err = new Error(`Another range-trend service instance holds the lock on this results database (pid ${held.pid} on ${held.host} since ${held.at}): a second instance never runs beside a live one, so a live run is never marked failed. If that process is gone, delete the row: DELETE FROM rt_lock.`);
      err.code = 'RT_LOCKED';
      throw err;
    }
    db.prepare('INSERT OR REPLACE INTO rt_lock (id, pid, token, host, at) VALUES (1, ?, ?, ?, ?)').run(pid, token, os.hostname(), at);
    db.exec('COMMIT');
    return { pid, token, tookOverStale: held ? { pid: held.pid, at: held.at } : null };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* not in a transaction */ }
    throw e;
  }
}

// Only the holder releases: a row written by another instance (a takeover after this one was declared gone)
// is left alone. Returns true when this call removed its own row.
export function releaseLock(db, lock) {
  if (!lock) return false;
  return Number(db.prepare('DELETE FROM rt_lock WHERE id = 1 AND pid = ? AND token = ?').run(lock.pid, lock.token).changes) === 1;
}

export const currentLock = (db) => db.prepare('SELECT pid, token, host, at FROM rt_lock WHERE id = 1').get() ?? null;

// Runs left 'running' by an interrupted process: recorded as failed with the reason; their slot stays used.
export function failInterruptedRuns(db, at) {
  return Number(db.prepare("UPDATE rt_runs SET status = 'failed', error = 'interrupted: the process stopped before the run finished; the slot stays used', finished_at = ? WHERE status = 'running'").run(at).changes);
}

export const getSetting = (db, key) => { const r = db.prepare('SELECT value_json FROM rt_settings WHERE key = ?').get(key); return r ? JSON.parse(r.value_json) : null; };
export const setSettingOnce = (db, key, value, at) => db.prepare('INSERT INTO rt_settings (key, value_json, at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), at);

export function appendLedger(db, e) {
  return Number(db.prepare('INSERT INTO rt_ledger (run_id, config_file, config_hash, reserve, reserve_json, at) VALUES (?, ?, ?, ?, ?, ?)').run(e.runId, e.configFile, e.configHash, e.reserve ? 1 : 0, j(e.reserveDetail), e.at).lastInsertRowid);
}

export const listLedger = (db) => db.prepare('SELECT * FROM rt_ledger ORDER BY id').all().map((x) => ({ ...x, reserve: !!x.reserve, reserveDetail: p(x.reserve_json) }));

export function getRun(db, id) {
  const r = db.prepare('SELECT * FROM rt_runs WHERE id = ?').get(id);
  return r ? { ...r, config: p(r.config_json), metrics: p(r.metrics_json), details: p(r.details_json), reserve: p(r.reserve_json) } : null;
}

export const listRuns = (db) => db.prepare('SELECT id, kind, config_file, version, config_hash, status, code_revision, symbols_hash, data_hash, calibration_hash, protocol_hash, created_at, finished_at, error FROM rt_runs ORDER BY id').all();
