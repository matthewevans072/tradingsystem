// ICT Lab simulation database, data/ict-lab-sim.sqlite (strategy/ict-lab/PROTOCOL.md section 10). A separate
// file: openIlDb refuses signal-desk.sqlite, demo.sqlite, strategy-lab*, hxr*, range-trend* and sweep-bos* by
// name after resolving links, a dangling link, and any file that already holds a table that is not the lab's
// (il_*). Nothing here reads real holdings or cash, places or prepares an order, or sends anything anywhere.
//
// The bar bound: no bar dated after MAX_BAR_DATE (config.js, 2022-12-30) is ever stored, and no load returns
// one; both are enforced here, at the lowest layer, in code. il_ledger is append-only and il_settings
// write-once (triggers). The lock row is taken and released inside transactions with its ownership checked.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MAX_BAR_DATE } from './config.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const MIGRATIONS = [
  // 1: the schema
  `
  CREATE TABLE il_data_versions (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    symbols_json TEXT NOT NULL,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    feed TEXT NOT NULL,
    adjustment TEXT NOT NULL,
    source TEXT NOT NULL,
    timeframes_json TEXT NOT NULL,
    downloaded_at TEXT NOT NULL,
    finished_at TEXT,
    bars_5m INTEGER,
    bars_1d INTEGER,
    dropped_json TEXT,
    readiness_json TEXT,
    comparison_json TEXT,
    data_hash TEXT,
    status TEXT NOT NULL DEFAULT 'downloading' CHECK (status IN ('downloading', 'complete', 'failed')),
    prereg_commit TEXT,
    protocol_sha256 TEXT,
    code_revision TEXT,
    error TEXT
  );
  CREATE TABLE il_bars_5m (
    version_id INTEGER NOT NULL REFERENCES il_data_versions(id),
    symbol TEXT NOT NULL,
    session TEXT NOT NULL,           -- NYSE session date, America/New_York
    idx INTEGER NOT NULL,            -- 0 = the 09:30 bar
    ts INTEGER NOT NULL,             -- bar start, ms since the epoch (UTC)
    hhmm TEXT NOT NULL,              -- bar start, ET wall clock
    o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
    v REAL, n INTEGER, vw REAL,
    PRIMARY KEY (version_id, symbol, session, idx)
  ) WITHOUT ROWID;
  CREATE TABLE il_bars_1d (
    version_id INTEGER NOT NULL REFERENCES il_data_versions(id),
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
    v REAL, n INTEGER, vw REAL,
    PRIMARY KEY (version_id, symbol, date)
  ) WITHOUT ROWID;
  CREATE TABLE il_runs (
    id INTEGER PRIMARY KEY,
    round INTEGER NOT NULL,
    spec TEXT NOT NULL,
    spec_hash TEXT NOT NULL,
    window TEXT NOT NULL CHECK (window IN ('development', 'validation')),
    repeat INTEGER NOT NULL DEFAULT 0,
    repeat_reason TEXT,
    contaminated INTEGER NOT NULL DEFAULT 0,
    data_version_id INTEGER NOT NULL REFERENCES il_data_versions(id),
    data_hash TEXT NOT NULL,
    window_json TEXT NOT NULL,
    code_revision TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    source_hash TEXT,
    head_commit TEXT,
    prereg_commit TEXT NOT NULL,
    protocol_sha256 TEXT NOT NULL,
    concepts_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
    metrics_json TEXT,
    details_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE TABLE il_trades (
    run_id INTEGER NOT NULL REFERENCES il_runs(id),
    seq INTEGER NOT NULL,
    session TEXT NOT NULL,
    trade_json TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
  ) WITHOUT ROWID;
  CREATE TABLE il_sessions (
    run_id INTEGER NOT NULL REFERENCES il_runs(id),
    session TEXT NOT NULL,
    stage TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    PRIMARY KEY (run_id, session)
  ) WITHOUT ROWID;
  CREATE TABLE il_ledger (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,              -- data_version | slot | run | note
    round INTEGER,
    spec TEXT,
    window TEXT,
    run_id INTEGER,
    data_version_id INTEGER,
    note TEXT,
    at TEXT NOT NULL
  );
  CREATE TRIGGER il_ledger_no_update BEFORE UPDATE ON il_ledger BEGIN SELECT RAISE(ABORT, 'il_ledger is append-only'); END;
  CREATE TRIGGER il_ledger_no_delete BEFORE DELETE ON il_ledger BEGIN SELECT RAISE(ABORT, 'il_ledger is append-only'); END;
  CREATE TABLE il_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL) WITHOUT ROWID;
  CREATE TRIGGER il_settings_no_update BEFORE UPDATE ON il_settings BEGIN SELECT RAISE(ABORT, 'il_settings is write-once'); END;
  CREATE TRIGGER il_settings_no_delete BEFORE DELETE ON il_settings BEGIN SELECT RAISE(ABORT, 'il_settings is write-once'); END;
  CREATE TABLE il_lock (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, token TEXT NOT NULL, host TEXT, at TEXT NOT NULL);
  `,
];

// The portfolio, demo, Strategy Lab, HXR, range-trend and sweep-bos files, compared case-insensitively.
export function isRefusedName(name) {
  const n = String(name).toLowerCase();
  return n === 'signal-desk.sqlite' || n === 'demo.sqlite' || n.startsWith('strategy-lab') || n.startsWith('hxr') || n.startsWith('range-trend') || n.startsWith('sweep-bos');
}
const REFUSED_MSG = 'the ICT Lab never opens the portfolio, demo, Strategy Lab, HXR, range-trend or sweep-bos databases';

// The real path a database file resolves to; throws for any refused name before or after resolving links, and
// for a dangling link.
export function guardIlFile(file) {
  const abs = path.resolve(file);
  if (isRefusedName(path.basename(abs))) throw new Error(REFUSED_MSG);
  let real;
  if (fs.existsSync(abs)) real = fs.realpathSync(abs);
  else {
    let isLink = false;
    try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch { /* does not exist */ }
    if (isLink) throw new Error('the ICT Lab refuses a database path that is a dangling link');
    real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  }
  if (isRefusedName(path.basename(real))) throw new Error(REFUSED_MSG);
  return real;
}

function foreignTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all()
    .map((r) => r.name).filter((n) => !/^il_/i.test(n) && !/^sqlite_/i.test(n));
}

export function openIlDb(file, { readOnly = false } = {}) {
  if (!readOnly) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const real = guardIlFile(file);
  if (fs.existsSync(real)) {
    const probe = new DatabaseSync(real, { readOnly: true });
    try {
      const foreign = foreignTables(probe);
      if (foreign.length) throw new Error(`the ICT Lab refuses ${path.basename(real)}: it holds tables that are not the lab's (${foreign.slice(0, 5).join(', ')})`);
    } finally {
      probe.close();
    }
  } else if (readOnly) throw new Error(`ICT Lab database ${path.basename(real)} does not exist`);
  const db = new DatabaseSync(real, readOnly ? { readOnly: true } : {});
  db.exec('PRAGMA busy_timeout = 5000;');
  if (readOnly) return db;
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function schemaVersion(db) {
  return db.prepare('SELECT version FROM il_schema_version').get()?.version ?? 0;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS il_schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM il_schema_version').get();
  let v = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO il_schema_version (version) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      v = db.prepare('SELECT version FROM il_schema_version').get().version;
      if (v < MIGRATIONS.length) {
        db.exec(MIGRATIONS[v]);
        v += 1;
        db.prepare('UPDATE il_schema_version SET version = ?').run(v);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- the bar bound ----------
export class BarBoundError extends Error {
  constructor(message) { super(message); this.name = 'BarBoundError'; }
}
export function withinBound(date) {
  return DATE.test(String(date || '')) && String(date) <= MAX_BAR_DATE;
}
export function assertWithinBound(date, what = 'bar') {
  if (!withinBound(date)) throw new BarBoundError(`${what} dated ${String(date).slice(0, 10)} is after the bar bound ${MAX_BAR_DATE} (PROTOCOL.md section 2; the validation window needs the owner's separate message)`);
}
const clampTo = (to) => (to && DATE.test(to) && to < MAX_BAR_DATE ? to : MAX_BAR_DATE);

// ---------- data versions and bars ----------
export function createDataVersion(db, { label, symbols, from, to, feed, adjustment, source, timeframes, downloadedAt, preregCommit = null, protocolSha256 = null, codeRevision = null }) {
  if (!DATE.test(from || '') || !DATE.test(to || '') || from > to) throw new Error('a data version needs from and to as YYYY-MM-DD, from on or before to');
  assertWithinBound(to, 'the requested range end');
  const r = db.prepare(`INSERT INTO il_data_versions (label, symbols_json, from_date, to_date, feed, adjustment, source, timeframes_json, downloaded_at, prereg_commit, protocol_sha256, code_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(label, JSON.stringify(symbols), from, to, feed, adjustment, source, JSON.stringify(timeframes), downloadedAt, preregCommit, protocolSha256, codeRevision);
  return Number(r.lastInsertRowid);
}
export function getDataVersion(db, id) {
  const r = db.prepare('SELECT * FROM il_data_versions WHERE id = ?').get(id);
  return r ? shapeVersion(r) : null;
}
export function listDataVersions(db) {
  return db.prepare('SELECT * FROM il_data_versions ORDER BY id').all().map(shapeVersion);
}
function shapeVersion(r) {
  return {
    id: r.id, label: r.label, symbols: JSON.parse(r.symbols_json), from: r.from_date, to: r.to_date, feed: r.feed, adjustment: r.adjustment, source: r.source,
    timeframes: JSON.parse(r.timeframes_json), downloadedAt: r.downloaded_at, finishedAt: r.finished_at, bars5m: r.bars_5m, bars1d: r.bars_1d,
    dropped: r.dropped_json ? JSON.parse(r.dropped_json) : null, readiness: r.readiness_json ? JSON.parse(r.readiness_json) : null, comparison: r.comparison_json ? JSON.parse(r.comparison_json) : null,
    dataHash: r.data_hash, status: r.status, preregCommit: r.prereg_commit, protocolSha256: r.protocol_sha256, codeRevision: r.code_revision, error: r.error,
  };
}

// Every row is checked against the bound before any is written; a row after it aborts the whole insert.
export function insertBars5m(db, versionId, symbol, rows) {
  for (const r of rows) assertWithinBound(r.session, `a 5-minute bar of ${symbol}`);
  const st = db.prepare('INSERT INTO il_bars_5m (version_id, symbol, session, idx, ts, hhmm, o, h, l, c, v, n, vw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  return tx(db, () => { let k = 0; for (const r of rows) { st.run(versionId, symbol, r.session, r.idx, r.ts, r.hhmm, r.o, r.h, r.l, r.c, r.v ?? null, r.n ?? null, r.vw ?? null); k++; } return k; });
}
export function insertBars1d(db, versionId, symbol, rows) {
  for (const r of rows) assertWithinBound(r.date, `a daily bar of ${symbol}`);
  const st = db.prepare('INSERT INTO il_bars_1d (version_id, symbol, date, o, h, l, c, v, n, vw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  return tx(db, () => { let k = 0; for (const r of rows) { st.run(versionId, symbol, r.date, r.o, r.h, r.l, r.c, r.v ?? null, r.n ?? null, r.vw ?? null); k++; } return k; });
}
export function completeDataVersion(db, id, { finishedAt, bars5m, bars1d, dropped, dataHash, readiness = null, comparison = null }) {
  db.prepare("UPDATE il_data_versions SET status = 'complete', finished_at = ?, bars_5m = ?, bars_1d = ?, dropped_json = ?, data_hash = ?, readiness_json = ?, comparison_json = ? WHERE id = ?")
    .run(finishedAt, bars5m, bars1d, JSON.stringify(dropped), dataHash, readiness == null ? null : JSON.stringify(readiness), comparison == null ? null : JSON.stringify(comparison), id);
}
export function failDataVersion(db, id, { finishedAt, error }) {
  db.prepare("UPDATE il_data_versions SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(finishedAt, error, id);
}
export function setReadiness(db, id, readiness) {
  db.prepare('UPDATE il_data_versions SET readiness_json = ? WHERE id = ?').run(JSON.stringify(readiness), id);
}
export function setComparison(db, id, comparison) {
  db.prepare('UPDATE il_data_versions SET comparison_json = ? WHERE id = ?').run(JSON.stringify(comparison), id);
}

// SHA-256 over every stored bar of a version in a fixed order (symbol, timeframe, date, index, OHLCV).
export function dataHashOf(db, versionId) {
  const h = crypto.createHash('sha256');
  for (const r of db.prepare('SELECT symbol, date, o, h, l, c, v FROM il_bars_1d WHERE version_id = ? ORDER BY symbol, date').iterate(versionId)) h.update(`${r.symbol}|1d|${r.date}|${r.o}|${r.h}|${r.l}|${r.c}|${r.v ?? ''}\n`);
  for (const r of db.prepare('SELECT symbol, session, idx, ts, o, h, l, c, v FROM il_bars_5m WHERE version_id = ? ORDER BY symbol, session, idx').iterate(versionId)) h.update(`${r.symbol}|5m|${r.session}|${r.idx}|${r.ts}|${r.o}|${r.h}|${r.l}|${r.c}|${r.v ?? ''}\n`);
  return h.digest('hex');
}
export function maxStoredDate(db) {
  const a = db.prepare('SELECT MAX(session) AS m FROM il_bars_5m').get()?.m ?? null;
  const b = db.prepare('SELECT MAX(date) AS m FROM il_bars_1d').get()?.m ?? null;
  return [a, b].filter(Boolean).sort().pop() ?? null;
}
export function countBarsAfterBound(db) {
  const a = db.prepare('SELECT COUNT(*) AS n FROM il_bars_5m WHERE session > ?').get(MAX_BAR_DATE).n;
  const b = db.prepare('SELECT COUNT(*) AS n FROM il_bars_1d WHERE date > ?').get(MAX_BAR_DATE).n;
  return { bars5m: a, bars1d: b };
}

// Loads: ordered, and never past the bound (the SQL itself filters on MAX_BAR_DATE).
export function loadBars5m(db, versionId, symbol, { from = '0000-01-01', to = MAX_BAR_DATE } = {}) {
  const end = clampTo(to);
  return db.prepare('SELECT session, idx, ts, hhmm, o, h, l, c, v, n, vw FROM il_bars_5m WHERE version_id = ? AND symbol = ? AND session >= ? AND session <= ? AND session <= ? ORDER BY session, idx')
    .all(versionId, symbol, from, end, MAX_BAR_DATE);
}
export function loadBars1d(db, versionId, symbol, { from = '0000-01-01', to = MAX_BAR_DATE } = {}) {
  const end = clampTo(to);
  return db.prepare('SELECT date, o, h, l, c, v, n, vw FROM il_bars_1d WHERE version_id = ? AND symbol = ? AND date >= ? AND date <= ? AND date <= ? ORDER BY date')
    .all(versionId, symbol, from, end, MAX_BAR_DATE);
}
export function sessionCounts5m(db, versionId, symbol) {
  return db.prepare('SELECT session, COUNT(*) AS n, MIN(idx) AS minIdx, MAX(idx) AS maxIdx FROM il_bars_5m WHERE version_id = ? AND symbol = ? AND session <= ? GROUP BY session ORDER BY session').all(versionId, symbol, MAX_BAR_DATE);
}

// ---------- runs, trades, sessions, ledger, settings ----------
export function createRun(db, r) {
  const res = db.prepare(`INSERT INTO il_runs (round, spec, spec_hash, window, repeat, repeat_reason, contaminated, data_version_id, data_hash, window_json, code_revision, engine_version, source_hash, head_commit, prereg_commit, protocol_sha256, concepts_sha256, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(r.round, r.spec, r.specHash, r.window, r.repeat ? 1 : 0, r.repeatReason ?? null, r.contaminated ? 1 : 0, r.dataVersionId, r.dataHash, JSON.stringify(r.windowDates), r.codeRevision, r.engineVersion, r.sourceHash ?? null, r.headCommit ?? null, r.preregCommit, r.protocolSha256, r.conceptsSha256, JSON.stringify(r.details ?? {}), r.createdAt);
  return Number(res.lastInsertRowid);
}
export function finishRun(db, id, { finishedAt, metrics, details }) {
  db.prepare("UPDATE il_runs SET status = 'done', finished_at = ?, metrics_json = ?, details_json = ? WHERE id = ?").run(finishedAt, JSON.stringify(metrics), JSON.stringify(details ?? {}), id);
}
export function failRun(db, id, { finishedAt, error, details = null }) {
  db.prepare("UPDATE il_runs SET status = 'failed', finished_at = ?, error = ?, details_json = COALESCE(?, details_json) WHERE id = ?").run(finishedAt, error, details == null ? null : JSON.stringify(details), id);
}
export function insertTrades(db, runId, trades) {
  const st = db.prepare('INSERT INTO il_trades (run_id, seq, session, trade_json) VALUES (?, ?, ?, ?)');
  tx(db, () => { trades.forEach((t, i) => st.run(runId, i, t.session, JSON.stringify(t))); });
}
export function insertSessions(db, runId, sessions) {
  const st = db.prepare('INSERT INTO il_sessions (run_id, session, stage, detail_json) VALUES (?, ?, ?, ?)');
  tx(db, () => { for (const s of sessions) st.run(runId, s.session, s.stage, JSON.stringify(s)); });
}
const shapeRun = (r) => ({
  id: r.id, round: r.round, spec: r.spec, specHash: r.spec_hash, window: r.window, repeat: !!r.repeat, repeatReason: r.repeat_reason, contaminated: !!r.contaminated,
  dataVersionId: r.data_version_id, dataHash: r.data_hash, windowDates: JSON.parse(r.window_json),
  codeRevision: r.code_revision, engineVersion: r.engine_version, sourceHash: r.source_hash, headCommit: r.head_commit, preregCommit: r.prereg_commit, protocolSha256: r.protocol_sha256, conceptsSha256: r.concepts_sha256,
  status: r.status, metrics: r.metrics_json ? JSON.parse(r.metrics_json) : null, details: r.details_json ? JSON.parse(r.details_json) : null, error: r.error, createdAt: r.created_at, finishedAt: r.finished_at,
});
export function getRun(db, id) { const r = db.prepare('SELECT * FROM il_runs WHERE id = ?').get(id); return r ? shapeRun(r) : null; }
export function listRuns(db) { return db.prepare('SELECT * FROM il_runs ORDER BY id').all().map(shapeRun); }
export function listTrades(db, runId) { return db.prepare('SELECT trade_json FROM il_trades WHERE run_id = ? ORDER BY seq').all(runId).map((r) => JSON.parse(r.trade_json)); }
export function listSessions(db, runId) { return db.prepare('SELECT detail_json FROM il_sessions WHERE run_id = ? ORDER BY session').all(runId).map((r) => JSON.parse(r.detail_json)); }

export function appendLedger(db, { kind, round = null, spec = null, window = null, runId = null, dataVersionId = null, note = null, at }) {
  const r = db.prepare('INSERT INTO il_ledger (kind, round, spec, window, run_id, data_version_id, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(kind, round, spec, window, runId, dataVersionId, note, at);
  return Number(r.lastInsertRowid);
}
export function listLedger(db) { return db.prepare('SELECT * FROM il_ledger ORDER BY id').all(); }

// Write-once: a key is set once; a second write of the same key is refused (the trigger refuses updates too).
export function getSetting(db, key) { return db.prepare('SELECT value FROM il_settings WHERE key = ?').get(key)?.value ?? null; }
export function setSettingOnce(db, key, value, at) {
  const cur = getSetting(db, key);
  if (cur != null) { if (cur === String(value)) return false; throw new Error(`il_settings.${key} is write-once (it is ${cur})`); }
  db.prepare('INSERT INTO il_settings (key, value, at) VALUES (?, ?, ?)').run(key, String(value), at);
  return true;
}

// ---------- the lock ----------
export class LockedError extends Error {
  constructor(lock) { super(`another ICT Lab run holds the lock (pid ${lock.pid} on ${lock.host || 'this machine'} since ${lock.at})`); this.name = 'LockedError'; this.code = 'IL_LOCKED'; this.lock = lock; }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function acquireLock(db, { pid = process.pid, host = null, at, token = crypto.randomBytes(8).toString('hex'), isAlive = alive } = {}) {
  return tx(db, () => {
    const cur = db.prepare('SELECT * FROM il_lock WHERE id = 1').get();
    if (cur && cur.pid !== pid && isAlive(cur.pid)) throw new LockedError(cur);
    db.prepare('INSERT INTO il_lock (id, pid, token, host, at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET pid = excluded.pid, token = excluded.token, host = excluded.host, at = excluded.at').run(pid, token, host, at);
    return { pid, token, host, at };
  });
}
export function releaseLock(db, lock) {
  if (!lock) return false;
  return tx(db, () => db.prepare('DELETE FROM il_lock WHERE id = 1 AND pid = ? AND token = ?').run(lock.pid, lock.token).changes > 0);
}
export function currentLock(db) { return db.prepare('SELECT * FROM il_lock WHERE id = 1').get() ?? null; }
