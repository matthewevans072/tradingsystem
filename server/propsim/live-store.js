// The live account's own database (data/prop-sim-live.sqlite; LIVE-1.md section 8). The guard refuses every other
// programme's file (Phase 1's prop-sim.sqlite included), links to them and any file with foreign tables. Bars, polls,
// decisions (5-minute bucket records, hash-chained), session reports, attempts and the log are append-only by trigger;
// CHECK constraints refuse anything dated before 2026-11-10. The worker control row is the only mutable table.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { PsError } from './config.js';
import { LIVE_DB_NAME, LIVE_DATA_FROM } from './live-config.js';

export const plDbFile = (dataDir) => path.join(dataDir, LIVE_DB_NAME);
const REFUSED = ['signal-desk', 'demo', 'strategy-lab', 'hxr', 'range-trend', 'sweep-bos', 'ict-lab', 'research-runner', 'prospective-1', 'event-swing', 'news-replay', 'news-forward'];
export const GENESIS = '0'.repeat(64);
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const MIN = 60000;

export function openPlDb(file) {
  let real = file;
  try { real = fs.realpathSync(file); } catch { /* new file */ }
  if (fs.existsSync(file) && real !== file && !fs.existsSync(real)) throw new PsError(409, 'prop-sim live refuses a dangling link');
  const base = path.basename(real).toLowerCase();
  if (base !== LIVE_DB_NAME || REFUSED.some((p) => base.startsWith(p))) throw new PsError(409, `prop-sim live refuses ${path.basename(real)}: only ${LIVE_DB_NAME}`);
  const db = new DatabaseSync(real);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  const foreign = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'pl\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all();
  if (foreign.length) { db.close(); throw new PsError(409, `prop-sim live refuses a database with other tables (${foreign.map((r) => r.name).join(', ')})`); }
  migrate(db);
  return db;
}

const APPEND_ONLY = ['pl_meta', 'pl_bars', 'pl_polls', 'pl_buckets', 'pl_sessions', 'pl_log'];
function migrate(db) {
  if (db.prepare("SELECT name FROM sqlite_master WHERE name = 'pl_schema'").get()) return;
  const F = LIVE_DATA_FROM;
  db.exec(`BEGIN;
  CREATE TABLE pl_schema (version INTEGER NOT NULL);
  CREATE TABLE pl_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, at TEXT NOT NULL);
  CREATE TABLE pl_bars (symbol TEXT NOT NULL, date TEXT NOT NULL CHECK (date >= '${F}'), minute INTEGER NOT NULL, o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL, fetched_at TEXT NOT NULL, fetched_ms INTEGER NOT NULL, live INTEGER NOT NULL CHECK (live IN (0, 1)), kind TEXT NOT NULL CHECK (kind IN ('live', 'reference')), PRIMARY KEY (symbol, date, minute)) WITHOUT ROWID;
  CREATE TABLE pl_polls (id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL CHECK (session >= '${F}'), at TEXT NOT NULL, at_ms INTEGER NOT NULL, ok INTEGER NOT NULL CHECK (ok IN (0, 1)), detail_json TEXT NOT NULL);
  CREATE TABLE pl_buckets (seq INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL CHECK (session >= '${F}'), k INTEGER NOT NULL, end_ms INTEGER NOT NULL, recorded_at TEXT NOT NULL, recorded_ms INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('on_time', 'late', 'gap')), evaluation_json TEXT NOT NULL, prev_hash TEXT NOT NULL, chain_hash TEXT NOT NULL, code_revision TEXT NOT NULL, UNIQUE (session, k));
  CREATE TABLE pl_sessions (session TEXT PRIMARY KEY CHECK (session >= '${F}'), finalized_at TEXT NOT NULL, report_json TEXT NOT NULL, code_revision TEXT NOT NULL);
  CREATE TABLE pl_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);
  CREATE TABLE pl_worker (id INTEGER PRIMARY KEY CHECK (id = 1), desired TEXT NOT NULL CHECK (desired IN ('running', 'paused', 'stopped')), token TEXT, pid INTEGER, heartbeat_at TEXT, state TEXT, updated_at TEXT NOT NULL);
  ${APPEND_ONLY.map((t) => `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
  CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`).join('\n  ')}
  INSERT INTO pl_schema (version) VALUES (1);
  COMMIT;`);
}
export function tx(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const o = fn(); db.exec('COMMIT'); return o; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; } }

export const getMeta = (db, key) => { const r = db.prepare('SELECT value_json FROM pl_meta WHERE key = ?').get(key); return r ? JSON.parse(r.value_json) : null; };
export const setMeta = (db, key, value, at) => db.prepare('INSERT INTO pl_meta (key, value_json, at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), at);

// Bars, first seen kept. rows: [{ date, minute, s (start ms), o, h, l, c, v }] in time order. A live bar (LIVE-1.md
// section 4) arrived within graceMs after its minute ended, before any bar of a later minute of its session and before
// its 5-minute bucket was decided; every other bar is stored with live = 0 and is never used for a decision or a fill.
export function insertBars(db, symbol, rows, { fetchedMs, kind, graceMs }) {
  const at = new Date(fetchedMs).toISOString();
  const ins = db.prepare('INSERT INTO pl_bars (symbol, date, minute, o, h, l, c, v, fetched_at, fetched_ms, live, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
  const later = db.prepare('SELECT 1 FROM pl_bars WHERE symbol = ? AND date = ? AND minute > ? LIMIT 1');
  const decided = db.prepare('SELECT 1 FROM pl_buckets WHERE session = ? AND k = ?');
  let stored = 0, live = 0;
  tx(db, () => {
    for (const r of rows) {
      const isLive = kind === 'live' && fetchedMs - (r.s + MIN) <= graceMs && fetchedMs >= r.s + MIN
        && !later.get(symbol, r.date, r.minute) && !decided.get(r.date, Math.floor((r.minute - 570) / 5));
      const n = Number(ins.run(symbol, r.date, r.minute, r.o, r.h, r.l, r.c, r.v ?? null, at, fetchedMs, isLive ? 1 : 0, kind).changes);
      stored += n; if (n && isLive) live++;
    }
  });
  return { stored, live };
}
const barRow = (r) => ({ date: r.date, minute: r.minute, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, live: !!r.live, kind: r.kind, fetchedMs: r.fetched_ms });
export const barsBetween = (db, symbol, from, to) => db.prepare('SELECT * FROM pl_bars WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date, minute').all(symbol, from, to).map(barRow);
export const lastMinute = (db, symbol, date) => db.prepare('SELECT max(minute) AS m FROM pl_bars WHERE symbol = ? AND date = ?').get(symbol, date)?.m ?? null;
export const hasBar = (db, symbol, date, minute) => !!db.prepare('SELECT 1 FROM pl_bars WHERE symbol = ? AND date = ? AND minute = ?').get(symbol, date, minute);
export const countBefore = (db, date) => db.prepare('SELECT count(*) AS n FROM pl_bars WHERE date < ?').get(date).n;

export const insertPoll = (db, p) => db.prepare('INSERT INTO pl_polls (session, at, at_ms, ok, detail_json) VALUES (?, ?, ?, ?, ?)').run(p.session, new Date(p.atMs).toISOString(), p.atMs, p.ok ? 1 : 0, JSON.stringify(p.detail ?? {}));
export const okPolls = (db, session) => db.prepare('SELECT at_ms FROM pl_polls WHERE session = ? AND ok = 1 ORDER BY at_ms').all(session).map((r) => r.at_ms);
export const lastPolls = (db, limit = 5) => db.prepare('SELECT session, at, ok, detail_json FROM pl_polls ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({ session: r.session, at: r.at, ok: !!r.ok, detail: JSON.parse(r.detail_json) }));

// Bucket records (the decisions), hash-chained over every record in insertion order.
export const bucketHash = (prev, b) => sha256(`${prev}|${b.session}|${b.k}|${b.endMs}|${b.recordedMs}|${b.status}|${sha256(JSON.stringify(b.evaluation))}`);
export function insertBucket(db, b) {
  return tx(db, () => {
    const prev = db.prepare('SELECT chain_hash FROM pl_buckets ORDER BY seq DESC LIMIT 1').get()?.chain_hash ?? GENESIS;
    const chain = bucketHash(prev, b);
    db.prepare('INSERT INTO pl_buckets (session, k, end_ms, recorded_at, recorded_ms, status, evaluation_json, prev_hash, chain_hash, code_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(b.session, b.k, b.endMs, new Date(b.recordedMs).toISOString(), b.recordedMs, b.status, JSON.stringify(b.evaluation), prev, chain, b.codeRevision);
    return chain;
  });
}
const bucketRow = (r) => ({ seq: r.seq, session: r.session, k: r.k, endMs: r.end_ms, recordedMs: r.recorded_ms, status: r.status, evaluation: JSON.parse(r.evaluation_json), prevHash: r.prev_hash, chainHash: r.chain_hash, codeRevision: r.code_revision });
export const bucketsFor = (db, session) => db.prepare('SELECT * FROM pl_buckets WHERE session = ? ORDER BY k').all(session).map(bucketRow);
export const allBuckets = (db) => db.prepare('SELECT * FROM pl_buckets ORDER BY seq').all().map(bucketRow);
export function verifyChain(rows) {
  let prev = GENESIS;
  for (const r of rows) { if (r.prevHash !== prev || r.chainHash !== bucketHash(prev, r)) return { ok: false, at: r.seq }; prev = r.chainHash; }
  return { ok: true };
}

export const insertSession = (db, session, at, report, codeRevision) => Number(db.prepare('INSERT INTO pl_sessions (session, finalized_at, report_json, code_revision) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(session, at, JSON.stringify(report), codeRevision).changes);
export const sessionReports = (db) => db.prepare('SELECT session, finalized_at, report_json, code_revision FROM pl_sessions ORDER BY session').all().map((r) => ({ session: r.session, finalizedAt: r.finalized_at, report: JSON.parse(r.report_json), codeRevision: r.code_revision }));
export const logLine = (db, at, level, message) => db.prepare('INSERT INTO pl_log (at, level, message) VALUES (?, ?, ?)').run(at, level, String(message).slice(0, 2000));
export const listLog = (db, limit = 30) => db.prepare('SELECT at, level, message FROM pl_log ORDER BY id DESC LIMIT ?').all(limit);

// The control row: the owner's request (running, paused, stopped) and the worker's heartbeat.
export const worker = (db) => db.prepare('SELECT * FROM pl_worker WHERE id = 1').get() ?? null;
export function setDesired(db, desired, at) {
  if (!['running', 'paused', 'stopped'].includes(desired)) throw new PsError(400, `unknown worker request ${desired}`);
  db.prepare('INSERT INTO pl_worker (id, desired, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET desired = excluded.desired, updated_at = excluded.updated_at').run(desired, at);
}
export function claimWorker(db, { token, pid, at, staleMs }) {
  return tx(db, () => {
    const w = worker(db);
    if (w?.token && w.token !== token && w.heartbeat_at && Date.parse(at) - Date.parse(w.heartbeat_at) < staleMs) return { ok: false, holder: w };
    db.prepare("INSERT INTO pl_worker (id, desired, token, pid, heartbeat_at, state, updated_at) VALUES (1, 'running', ?, ?, ?, 'starting', ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, pid = excluded.pid, heartbeat_at = excluded.heartbeat_at, state = 'starting'").run(token, pid, at, at);
    return { ok: true };
  });
}
export const heartbeat = (db, token, at, state) => Number(db.prepare('UPDATE pl_worker SET heartbeat_at = ?, state = ? WHERE id = 1 AND token = ?').run(at, state, token).changes);
export const releaseWorker = (db, token, at) => db.prepare("UPDATE pl_worker SET token = NULL, pid = NULL, state = 'stopped', heartbeat_at = ? WHERE id = 1 AND token = ?").run(at, token);
