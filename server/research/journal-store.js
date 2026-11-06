// Prospective journal 1's database (data/prospective-1.sqlite; strategy/research-runner/PROSPECTIVE-1.md). Its own
// file only: the guard refuses the portfolio, demo, Strategy Lab, HXR, range-trend, sweep-bos, ICT Lab and
// research-runner databases, links to them, dangling links and any file holding tables that are not the
// journal's (pj_). Every table is append-only by trigger (no UPDATE, no DELETE), so a record, its recorded_at
// and its on-time flag can never be rewritten; sessions are recorded strictly in date order (no backfill), a live
// session never before the start, a warm-up session never at or after it, and nothing live before activation.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const PJ_DB_NAME = 'prospective-1.sqlite';
export const pjDbFile = (dataDir) => path.join(dataDir, PJ_DB_NAME);
const TABLES = ['pj_meta', 'pj_bars', 'pj_actions', 'pj_updates', 'pj_sessions', 'pj_events', 'pj_state', 'pj_releases'];

export function isRefusedName(name) {
  const n = String(name).toLowerCase();
  return n === 'signal-desk.sqlite' || n === 'demo.sqlite' || ['strategy-lab', 'hxr', 'range-trend', 'sweep-bos', 'ict-lab', 'research-runner'].some((p) => n.startsWith(p));
}

export function guardPjFile(file) {
  const abs = path.resolve(file);
  const refuse = () => { throw new Error('The prospective journal never opens the portfolio, demo, Strategy Lab, HXR, range-trend, sweep-bos, ICT Lab or research-runner databases'); };
  if (isRefusedName(path.basename(abs))) refuse();
  let real;
  if (fs.existsSync(abs)) real = fs.realpathSync(abs);
  else {
    let isLink = false;
    try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch { /* does not exist */ }
    if (isLink) throw new Error('The prospective journal refuses a database path that is a dangling symlink');
    real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  }
  if (isRefusedName(path.basename(real))) refuse();
  return real;
}

const appendOnly = (t) => `
  CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only: a record is never rewritten'); END;
  CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only: a record is never deleted'); END;`;

const SCHEMA = `
  CREATE TABLE pj_schema_version (version INTEGER NOT NULL);
  CREATE TABLE pj_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, at TEXT NOT NULL);
  CREATE TABLE pj_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('activation','update','resume')), status TEXT NOT NULL,
    started_at TEXT NOT NULL, recorded_at TEXT NOT NULL, clock_offset_ms INTEGER, server_date TEXT, first_session TEXT, last_session TEXT, detail_json TEXT
  );
  CREATE TABLE pj_bars (
    symbol TEXT NOT NULL, date TEXT NOT NULL, o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL, n REAL, vw REAL,
    source TEXT NOT NULL, late INTEGER NOT NULL DEFAULT 0, update_id INTEGER NOT NULL REFERENCES pj_updates(id), received_at TEXT NOT NULL,
    PRIMARY KEY (symbol, date)
  );
  CREATE TABLE pj_actions (
    id TEXT PRIMARY KEY, symbol TEXT NOT NULL, type TEXT NOT NULL, ex_date TEXT, pay_date TEXT, ratio_old REAL, ratio_new REAL, rate REAL,
    source TEXT NOT NULL, late INTEGER NOT NULL DEFAULT 0, update_id INTEGER NOT NULL REFERENCES pj_updates(id), received_at TEXT NOT NULL
  );
  CREATE TABLE pj_sessions (
    date TEXT PRIMARY KEY, phase TEXT NOT NULL CHECK (phase IN ('warmup','live')), update_id INTEGER NOT NULL REFERENCES pj_updates(id),
    recorded_at TEXT NOT NULL, next_open TEXT, on_time INTEGER, missing_json TEXT, bars_sha256 TEXT NOT NULL
  );
  CREATE TABLE pj_releases (id INTEGER PRIMARY KEY AUTOINCREMENT, update_id INTEGER NOT NULL REFERENCES pj_updates(id), after_session TEXT NOT NULL, fill_after TEXT NOT NULL, recorded_at TEXT NOT NULL, symbols_json TEXT NOT NULL);
  CREATE TABLE pj_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, update_id INTEGER REFERENCES pj_updates(id), rule TEXT, ledger TEXT CHECK (ledger IS NULL OR ledger IN ('primary','reconstructed')),
    date TEXT, kind TEXT NOT NULL, symbol TEXT, recorded_at TEXT NOT NULL, on_time INTEGER, detail_json TEXT
  );
  CREATE TABLE pj_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT, update_id INTEGER NOT NULL REFERENCES pj_updates(id), rule TEXT NOT NULL, ledger TEXT NOT NULL CHECK (ledger IN ('primary','reconstructed')),
    through TEXT NOT NULL, snapshot_json TEXT NOT NULL, snapshot_sha256 TEXT NOT NULL
  );
  ${TABLES.map(appendOnly).join('\n')}
  CREATE TRIGGER pj_sessions_in_order BEFORE INSERT ON pj_sessions WHEN EXISTS (SELECT 1 FROM pj_sessions WHERE date >= NEW.date)
    BEGIN SELECT RAISE(ABORT, 'pj_sessions: a session is recorded only after the last recorded one (no backfill, no rewrite)'); END;
  CREATE TRIGGER pj_sessions_activated BEFORE INSERT ON pj_sessions WHEN (SELECT value_json FROM pj_meta WHERE key = 'start') IS NULL
    BEGIN SELECT RAISE(ABORT, 'pj_sessions: the journal is not activated'); END;
  CREATE TRIGGER pj_sessions_live_after_start BEFORE INSERT ON pj_sessions WHEN NEW.phase = 'live' AND NEW.date < json_extract((SELECT value_json FROM pj_meta WHERE key = 'start'), '$')
    BEGIN SELECT RAISE(ABORT, 'pj_sessions: no decision is recorded for a session before the start'); END;
  CREATE TRIGGER pj_sessions_warmup_before_start BEFORE INSERT ON pj_sessions WHEN NEW.phase = 'warmup' AND NEW.date >= json_extract((SELECT value_json FROM pj_meta WHERE key = 'start'), '$')
    BEGIN SELECT RAISE(ABORT, 'pj_sessions: a session at or after the start is live, never warm-up'); END;
  CREATE TRIGGER pj_sessions_live_flag BEFORE INSERT ON pj_sessions WHEN NEW.phase = 'live' AND (NEW.on_time IS NULL OR NEW.next_open IS NULL)
    BEGIN SELECT RAISE(ABORT, 'pj_sessions: a live session needs its next open and its on-time flag'); END;
  INSERT INTO pj_schema_version (version) VALUES (1);
`;

export function openPjDb(file, { readOnly = false } = {}) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const real = guardPjFile(file);
  if (fs.existsSync(real)) {
    const probe = new DatabaseSync(real, { readOnly: true });
    try {
      const foreign = probe.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all().map((r) => r.name).filter((n) => !/^pj_/i.test(n) && !/^sqlite_/i.test(n));
      if (foreign.length) throw new Error(`The prospective journal refuses ${path.basename(real)}: it holds tables that are not the journal's (${foreign.slice(0, 5).join(', ')})`);
    } finally { probe.close(); }
  } else if (readOnly) throw new Error(`${path.basename(real)} does not exist`);
  const db = new DatabaseSync(real, readOnly ? { readOnly: true } : {});
  if (!readOnly) {
    // Durable before the next open: every commit is synced to disk.
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pj_schema_version'").get();
    if (!has) db.exec(SCHEMA);
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
}

const j = (v) => (v == null ? null : JSON.stringify(v));
const pj = (s) => (s == null ? null : JSON.parse(s));

// ---------- meta (write-once) ----------
export const getMeta = (db, key) => { const r = db.prepare('SELECT value_json FROM pj_meta WHERE key = ?').get(key); return r ? JSON.parse(r.value_json) : null; };
export const allMeta = (db) => Object.fromEntries(db.prepare('SELECT key, value_json FROM pj_meta').all().map((r) => [r.key, JSON.parse(r.value_json)]));
export function setMeta(db, key, value, at) { db.prepare('INSERT INTO pj_meta (key, value_json, at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), at); }

// ---------- updates ----------
export function insertUpdate(db, u) {
  const r = db.prepare('INSERT INTO pj_updates (kind, status, started_at, recorded_at, clock_offset_ms, server_date, first_session, last_session, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(u.kind, u.status, u.startedAt, u.recordedAt, u.clockOffsetMs ?? null, u.serverDate ?? null, u.firstSession ?? null, u.lastSession ?? null, j(u.detail));
  return Number(r.lastInsertRowid);
}
export const listUpdates = (db) => db.prepare('SELECT * FROM pj_updates ORDER BY id').all().map((r) => ({ ...r, detail: pj(r.detail_json) }));

// ---------- bars and corporate actions (as received) ----------
export function insertBars(db, rows) {
  const st = db.prepare('INSERT INTO pj_bars (symbol, date, o, h, l, c, v, n, vw, source, late, update_id, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const b of rows) st.run(b.symbol, b.date, b.o, b.h, b.l, b.c, b.v ?? null, b.n ?? null, b.vw ?? null, b.source, b.late ? 1 : 0, b.updateId, b.receivedAt);
}
export const getBars = (db, { includeLate = false } = {}) => db.prepare(`SELECT * FROM pj_bars ${includeLate ? '' : 'WHERE late = 0'} ORDER BY date, symbol`).all();
export const lastBarDate = (db, symbol) => db.prepare('SELECT MAX(date) AS d FROM pj_bars WHERE symbol = ?').get(symbol)?.d ?? null;
export const barKeys = (db) => new Set(db.prepare('SELECT symbol || \':\' || date AS k FROM pj_bars').all().map((r) => r.k));
export function insertActions(db, rows) {
  const st = db.prepare('INSERT INTO pj_actions (id, symbol, type, ex_date, pay_date, ratio_old, ratio_new, rate, source, late, update_id, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const a of rows) st.run(a.id, a.symbol, a.type, a.ex_date ?? null, a.pay_date ?? null, a.ratio_old ?? null, a.ratio_new ?? null, a.rate ?? null, a.source, a.late ? 1 : 0, a.updateId, a.receivedAt);
}
export const getActions = (db, { includeLate = false } = {}) => db.prepare(`SELECT * FROM pj_actions ${includeLate ? '' : 'WHERE late = 0'} ORDER BY ex_date, id`).all();
export const actionById = (db, id) => db.prepare('SELECT * FROM pj_actions WHERE id = ?').get(id) ?? null;

// ---------- sessions, releases, events, state ----------
export function insertSession(db, s) {
  db.prepare('INSERT INTO pj_sessions (date, phase, update_id, recorded_at, next_open, on_time, missing_json, bars_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(s.date, s.phase, s.updateId, s.recordedAt, s.nextOpen ?? null, s.onTime == null ? null : s.onTime ? 1 : 0, j(s.missing ?? []), s.barsSha256);
}
export const listSessions = (db) => db.prepare('SELECT * FROM pj_sessions ORDER BY date').all().map((r) => ({ ...r, missing: pj(r.missing_json), onTime: r.on_time == null ? null : !!r.on_time }));
export const lastSession = (db) => db.prepare('SELECT * FROM pj_sessions ORDER BY date DESC LIMIT 1').get() ?? null;
export function insertRelease(db, r) { db.prepare('INSERT INTO pj_releases (update_id, after_session, fill_after, recorded_at, symbols_json) VALUES (?, ?, ?, ?, ?)').run(r.updateId, r.afterSession, r.fillAfter, r.recordedAt, JSON.stringify(r.symbols)); }
export const listReleases = (db) => db.prepare('SELECT * FROM pj_releases ORDER BY id').all().map((r) => ({ ...r, symbols: pj(r.symbols_json) }));
export function insertEvents(db, rows) {
  const st = db.prepare('INSERT INTO pj_events (update_id, rule, ledger, date, kind, symbol, recorded_at, on_time, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const e of rows) st.run(e.updateId ?? null, e.rule ?? null, e.ledger ?? null, e.date ?? null, e.kind, e.symbol ?? null, e.recordedAt, e.onTime == null ? null : e.onTime ? 1 : 0, j(e.detail));
}
export const listEvents = (db, { kinds = null, limit = 100000 } = {}) => db.prepare(`SELECT * FROM pj_events ${kinds ? `WHERE kind IN (${kinds.map(() => '?').join(',')})` : ''} ORDER BY id LIMIT ?`).all(...(kinds || []), limit).map((r) => ({ ...r, detail: pj(r.detail_json), onTime: r.on_time == null ? null : !!r.on_time }));
export function insertState(db, s) { db.prepare('INSERT INTO pj_state (update_id, rule, ledger, through, snapshot_json, snapshot_sha256) VALUES (?, ?, ?, ?, ?, ?)').run(s.updateId, s.rule, s.ledger, s.through, s.snapshotJson, s.sha256); }
export const latestState = (db, rule, ledger) => db.prepare('SELECT * FROM pj_state WHERE rule = ? AND ledger = ? ORDER BY id DESC LIMIT 1').get(rule, ledger) ?? null;
