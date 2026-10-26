// Range-trend results database (data/range-trend-sim.sqlite). Its own file only:
// the guard refuses the portfolio, demo, Strategy Lab and HXR databases, any file
// that resolves to one of them, a dangling symlink, and any file holding tables
// that are not range-trend's (rt_).
import fs from 'node:fs';
import path from 'node:path';
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

export function createRun(db, r) {
  return Number(db.prepare(`INSERT INTO rt_runs (kind, config_file, version, config_hash, config_json, status, reserve_json, protocol_hash, code_revision, created_at)
    VALUES ('practice', ?, ?, ?, ?, 'running', ?, ?, ?, ?)`).run(r.configFile, r.version, r.configHash, j(r.config), j(r.reserve), r.protocolHash, r.codeRevision, r.at).lastInsertRowid);
}

export function finishRun(db, id, r) {
  db.prepare(`UPDATE rt_runs SET status = ?, symbols_hash = ?, data_hash = ?, calibration_hash = ?, metrics_json = ?, details_json = ?, error = ?, finished_at = ? WHERE id = ?`)
    .run(r.status, r.symbolsHash ?? null, r.dataHash ?? null, r.calibrationHash ?? null, j(r.metrics), j(r.details), r.error ?? null, r.at, id);
}

export function insertEquity(db, id, points) {
  const st = db.prepare('INSERT INTO rt_equity (run_id, date, json) VALUES (?, ?, ?)');
  for (const x of points) st.run(id, x.date, JSON.stringify(x));
}

export function appendLedger(db, e) {
  return Number(db.prepare('INSERT INTO rt_ledger (run_id, config_file, config_hash, reserve, reserve_json, at) VALUES (?, ?, ?, ?, ?, ?)').run(e.runId, e.configFile, e.configHash, e.reserve ? 1 : 0, j(e.reserveDetail), e.at).lastInsertRowid);
}

export const listLedger = (db) => db.prepare('SELECT * FROM rt_ledger ORDER BY id').all().map((x) => ({ ...x, reserve: !!x.reserve, reserveDetail: p(x.reserve_json) }));

export function getRun(db, id) {
  const r = db.prepare('SELECT * FROM rt_runs WHERE id = ?').get(id);
  return r ? { ...r, config: p(r.config_json), metrics: p(r.metrics_json), details: p(r.details_json), reserve: p(r.reserve_json) } : null;
}

export const listRuns = (db) => db.prepare('SELECT id, kind, config_file, version, config_hash, status, code_revision, symbols_hash, data_hash, created_at, finished_at, error FROM rt_runs ORDER BY id').all();
