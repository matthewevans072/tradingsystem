// prop-sim's own database (data/prop-sim.sqlite). The guard refuses every other programme's file, links to them and
// any file with foreign tables. Bars, downloads, runs once finished, trades, attempts, random results, inference rows
// and the log are append-only; CHECK constraints refuse a bar outside 2018-06-01 to 2022-12-30. The lock row is the
// only mutable table (the worker's ownership and heartbeat).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_NAME, FROM, MAX_DATE, PsError } from './config.js';

export const psDbFile = (dataDir) => path.join(dataDir, DB_NAME);
const REFUSED = ['signal-desk', 'demo', 'strategy-lab', 'hxr', 'range-trend', 'sweep-bos', 'ict-lab', 'research-runner', 'prospective-1', 'event-swing', 'news-replay', 'news-forward'];

export function openPsDb(file) {
  let real = file;
  try { real = fs.realpathSync(file); } catch { /* new file */ }
  const base = path.basename(real).toLowerCase();
  if (base !== DB_NAME || REFUSED.some((p) => base.startsWith(p))) throw new PsError(409, `prop-sim refuses ${path.basename(real)}: only ${DB_NAME}`);
  const db = new DatabaseSync(real);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  const foreign = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'ps\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all();
  if (foreign.length) { db.close(); throw new PsError(409, `prop-sim refuses a database with other tables (${foreign.map((r) => r.name).join(', ')})`); }
  migrate(db);
  return db;
}

const APPEND_ONLY = ['ps_bars1m', 'ps_downloads', 'ps_trades', 'ps_attempts', 'ps_random', 'ps_inference', 'ps_log'];
function migrate(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name = 'ps_schema'").get()) migrate1(db);
  migrate2(db);
}
// Migration 2 (ps-code-2026-11-09-2, defect replacement 1): random results and test rows keyed by code revision, so a
// replacement's rows sit beside the defective revision's, which stay in ps_random and ps_inference unchanged.
function migrate2(db) {
  if (db.prepare('SELECT max(version) AS v FROM ps_schema').get().v >= 2) return;
  const trig = (t) => `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
  CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`;
  db.exec(`BEGIN;
  CREATE TABLE ps_random_v (config_id TEXT NOT NULL, code_revision TEXT NOT NULL, seed INTEGER NOT NULL, pass_rate REAL NOT NULL, months_json TEXT NOT NULL, trades INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (config_id, code_revision, seed)) WITHOUT ROWID;
  CREATE TABLE ps_inference_v (config_id TEXT NOT NULL, code_revision TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (config_id, code_revision)) WITHOUT ROWID;
  ${trig('ps_random_v')}
  ${trig('ps_inference_v')}
  INSERT INTO ps_schema (version) VALUES (2);
  COMMIT;`);
}
function migrate1(db) {
  db.exec(`BEGIN;
  CREATE TABLE ps_schema (version INTEGER NOT NULL);
  CREATE TABLE ps_bars1m (symbol TEXT NOT NULL, date TEXT NOT NULL CHECK (date >= '${FROM}' AND date <= '${MAX_DATE}'), minute INTEGER NOT NULL, o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL, PRIMARY KEY (symbol, date, minute)) WITHOUT ROWID;
  CREATE TABLE ps_downloads (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, from_date TEXT NOT NULL, to_date TEXT NOT NULL CHECK (to_date <= '${MAX_DATE}'), started_at TEXT NOT NULL, finished_at TEXT NOT NULL, status TEXT NOT NULL, summary_json TEXT NOT NULL);
  CREATE TABLE ps_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, config_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')), code_revision TEXT NOT NULL, data_hash TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, summary_json TEXT, error TEXT);
  CREATE TABLE ps_trades (run_id INTEGER NOT NULL REFERENCES ps_runs(id), seq INTEGER NOT NULL, trade_json TEXT NOT NULL, PRIMARY KEY (run_id, seq)) WITHOUT ROWID;
  CREATE TABLE ps_attempts (run_id INTEGER NOT NULL REFERENCES ps_runs(id), plan TEXT NOT NULL, start TEXT NOT NULL, attempt_json TEXT NOT NULL, PRIMARY KEY (run_id, plan, start)) WITHOUT ROWID;
  CREATE TABLE ps_random (config_id TEXT NOT NULL, seed INTEGER NOT NULL, pass_rate REAL NOT NULL, months_json TEXT NOT NULL, trades INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (config_id, seed)) WITHOUT ROWID;
  CREATE TABLE ps_inference (config_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE ps_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, message TEXT NOT NULL);
  CREATE TABLE ps_lock (id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT, pid INTEGER, heartbeat_at TEXT, desired TEXT NOT NULL DEFAULT 'running');
  ${APPEND_ONLY.map((t) => `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
  CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`).join('\n  ')}
  CREATE TRIGGER ps_runs_finished BEFORE UPDATE ON ps_runs WHEN OLD.status != 'running' BEGIN SELECT RAISE(ABORT, 'a finished run is never changed'); END;
  CREATE TRIGGER ps_runs_no_delete BEFORE DELETE ON ps_runs BEGIN SELECT RAISE(ABORT, 'runs are never deleted'); END;
  INSERT INTO ps_schema (version) VALUES (1);
  COMMIT;`);
}
export function tx(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const o = fn(); db.exec('COMMIT'); return o; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; } }

export function insertBars(db, symbol, rows) {
  const st = db.prepare('INSERT INTO ps_bars1m (symbol, date, minute, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
  let n = 0;
  tx(db, () => { for (const r of rows) n += Number(st.run(symbol, r.date, r.minute, r.o, r.h, r.l, r.c, r.v ?? null).changes); });
  return n;
}
export const barsFor = (db, symbol) => db.prepare('SELECT date, minute, o, h, l, c, v FROM ps_bars1m WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date, minute').all(symbol, FROM, MAX_DATE);
export const barDates = (db, symbol) => db.prepare('SELECT DISTINCT date FROM ps_bars1m WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date').all(symbol, FROM, MAX_DATE).map((r) => r.date);
export const countAfterBound = (db) => db.prepare('SELECT count(*) AS n FROM ps_bars1m WHERE date > ?').get(MAX_DATE).n;
export const insertDownload = (db, d) => db.prepare('INSERT INTO ps_downloads (symbol, from_date, to_date, started_at, finished_at, status, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(d.symbol, d.from, d.to, d.startedAt, d.finishedAt, d.status, JSON.stringify(d.summary ?? {}));
export const listDownloads = (db) => db.prepare('SELECT * FROM ps_downloads ORDER BY id').all().map((r) => ({ ...r, summary: JSON.parse(r.summary_json) }));

export const startRun = (db, r) => Number(db.prepare("INSERT INTO ps_runs (config_id, kind, status, code_revision, data_hash, started_at) VALUES (?, ?, 'running', ?, ?, ?)").run(r.configId, r.kind, r.codeRevision, r.dataHash, r.startedAt).lastInsertRowid);
export const finishRun = (db, id, { status, summary = null, error = null, at }) => db.prepare("UPDATE ps_runs SET status = ?, summary_json = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(status, summary ? JSON.stringify(summary) : null, error, at, id);
const runRow = (r) => r && ({ id: r.id, configId: r.config_id, kind: r.kind, status: r.status, codeRevision: r.code_revision, dataHash: r.data_hash, startedAt: r.started_at, finishedAt: r.finished_at, summary: r.summary_json ? JSON.parse(r.summary_json) : null, error: r.error });
export const listRuns = (db) => db.prepare('SELECT * FROM ps_runs ORDER BY id').all().map(runRow);
export const getRun = (db, id) => runRow(db.prepare('SELECT * FROM ps_runs WHERE id = ?').get(id));
export function insertTrades(db, runId, trades) { const st = db.prepare('INSERT INTO ps_trades (run_id, seq, trade_json) VALUES (?, ?, ?)'); tx(db, () => trades.forEach((t, i) => st.run(runId, i, JSON.stringify(t)))); }
export const listTrades = (db, runId) => db.prepare('SELECT trade_json FROM ps_trades WHERE run_id = ? ORDER BY seq').all(runId).map((r) => JSON.parse(r.trade_json));
export function insertAttempts(db, runId, plan, attempts) { const st = db.prepare('INSERT INTO ps_attempts (run_id, plan, start, attempt_json) VALUES (?, ?, ?, ?)'); tx(db, () => { for (const a of attempts) st.run(runId, plan, a.start, JSON.stringify(a)); }); }
export const listAttempts = (db, runId, plan) => db.prepare('SELECT attempt_json FROM ps_attempts WHERE run_id = ? AND plan = ? ORDER BY start').all(runId, plan).map((r) => JSON.parse(r.attempt_json));
export const insertRandom = (db, r) => db.prepare('INSERT INTO ps_random_v (config_id, code_revision, seed, pass_rate, months_json, trades, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').run(r.configId, r.revision, r.seed, r.passRate, JSON.stringify(r.months), r.trades, r.at);
export const randomSeedsDone = (db, configId, revision) => db.prepare('SELECT seed FROM ps_random_v WHERE config_id = ? AND code_revision = ? ORDER BY seed').all(configId, revision).map((r) => r.seed);
export const listRandom = (db, configId, revision) => db.prepare('SELECT seed, pass_rate, months_json, trades FROM ps_random_v WHERE config_id = ? AND code_revision = ? ORDER BY seed').all(configId, revision).map((r) => ({ seed: r.seed, passRate: r.pass_rate, months: JSON.parse(r.months_json), trades: r.trades }));
export const insertInference = (db, configId, revision, result, at) => db.prepare('INSERT INTO ps_inference_v (config_id, code_revision, result_json, created_at) VALUES (?, ?, ?, ?)').run(configId, revision, JSON.stringify(result), at);
export const listInference = (db, revision) => db.prepare('SELECT config_id, result_json, created_at FROM ps_inference_v WHERE code_revision = ? ORDER BY config_id').all(revision).map((r) => ({ configId: r.config_id, ...JSON.parse(r.result_json), createdAt: r.created_at }));
// The defective revision's rows (ps-code-2026-11-09-1), kept as they were.
export const listRandomRev1 = (db, configId) => db.prepare('SELECT seed, pass_rate, trades FROM ps_random WHERE config_id = ? ORDER BY seed').all(configId).map((r) => ({ seed: r.seed, passRate: r.pass_rate, trades: r.trades }));
export const logLine = (db, at, message) => db.prepare('INSERT INTO ps_log (at, message) VALUES (?, ?)').run(at, String(message).slice(0, 2000));
export const listLog = (db, limit = 50) => db.prepare('SELECT at, message FROM ps_log ORDER BY id DESC LIMIT ?').all(limit);

// The lock: one worker at a time; a heartbeat older than staleMs can be taken over.
export function takeLock(db, { token, pid, at, staleMs }) {
  return tx(db, () => {
    const r = db.prepare('SELECT * FROM ps_lock WHERE id = 1').get();
    if (r?.token && r.token !== token && r.heartbeat_at && Date.parse(at) - Date.parse(r.heartbeat_at) < staleMs) return { ok: false, holder: r };
    db.prepare("INSERT INTO ps_lock (id, token, pid, heartbeat_at, desired) VALUES (1, ?, ?, ?, 'running') ON CONFLICT(id) DO UPDATE SET token = excluded.token, pid = excluded.pid, heartbeat_at = excluded.heartbeat_at").run(token, pid, at);
    return { ok: true };
  });
}
export const heartbeat = (db, token, at) => Number(db.prepare('UPDATE ps_lock SET heartbeat_at = ? WHERE id = 1 AND token = ?').run(at, token).changes);
export const releaseLock = (db, token) => db.prepare('UPDATE ps_lock SET token = NULL, pid = NULL WHERE id = 1 AND token = ?').run(token);
export const lockRow = (db) => db.prepare('SELECT * FROM ps_lock WHERE id = 1').get() ?? null;
export const setDesired = (db, desired) => db.prepare("INSERT INTO ps_lock (id, desired) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET desired = excluded.desired").run(desired);
