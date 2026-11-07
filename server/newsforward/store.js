// news-forward's own database (data/news-forward.sqlite). The guard refuses every other programme's file, links to
// them and any file with foreign tables. Source data, plans, updates, snapshots and the log are append-only by
// trigger; CHECK constraints refuse any row dated before 2026-10-22. The control row (nf_worker) is the only mutable
// table: the worker's heartbeat and the owner's start, pause and stop requests.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { DB_NAME, WARMUP_FROM, NfError } from './config.js';

export const nfDbFile = (dataDir) => path.join(dataDir, DB_NAME);
const REFUSED = ['signal-desk', 'demo', 'strategy-lab', 'hxr', 'range-trend', 'sweep-bos', 'ict-lab', 'research-runner', 'prospective-1', 'event-swing', 'news-replay'];
export const GENESIS = '0'.repeat(64);
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function openNfDb(file) {
  let real = file;
  try { real = fs.realpathSync(file); } catch { /* new file */ }
  if (fs.existsSync(file) && real !== file && !fs.existsSync(real)) throw new NfError(409, 'news-forward refuses a dangling link');
  const base = path.basename(real).toLowerCase();
  if (base !== DB_NAME || REFUSED.some((p) => base.startsWith(p))) throw new NfError(409, `news-forward refuses ${path.basename(real)}: only ${DB_NAME}`);
  const db = new DatabaseSync(real);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
  const foreign = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'nf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all();
  if (foreign.length) { db.close(); throw new NfError(409, `news-forward refuses a database with other tables (${foreign.map((r) => r.name).join(', ')})`); }
  migrate(db);
  return db;
}

const APPEND_ONLY = ['nf_meta', 'nf_daily', 'nf_bars1m', 'nf_news', 'nf_news_symbols', 'nf_filings', 'nf_corp', 'nf_plans', 'nf_updates', 'nf_snapshots', 'nf_log'];
function migrate(db) {
  if (db.prepare("SELECT name FROM sqlite_master WHERE name = 'nf_schema'").get()) return;
  db.exec(`BEGIN;
  CREATE TABLE nf_schema (version INTEGER NOT NULL);
  CREATE TABLE nf_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, at TEXT NOT NULL);
  CREATE TABLE nf_daily (symbol TEXT NOT NULL, date TEXT NOT NULL CHECK (date >= '${WARMUP_FROM}'), o REAL, h REAL, l REAL, c REAL NOT NULL, v REAL, fetched_at TEXT NOT NULL, PRIMARY KEY (symbol, date)) WITHOUT ROWID;
  CREATE TABLE nf_bars1m (symbol TEXT NOT NULL, date TEXT NOT NULL CHECK (date >= '${WARMUP_FROM}'), minute INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v REAL, vw REAL, fetched_at TEXT NOT NULL, PRIMARY KEY (symbol, date, minute)) WITHOUT ROWID;
  CREATE TABLE nf_news (id TEXT PRIMARY KEY, created_at TEXT NOT NULL CHECK (created_at >= '${WARMUP_FROM}'), updated_at TEXT, headline TEXT, summary TEXT, source TEXT, symbols_json TEXT NOT NULL, fetched_at TEXT NOT NULL);
  CREATE TABLE nf_news_symbols (news_id TEXT NOT NULL, symbol TEXT NOT NULL, PRIMARY KEY (symbol, news_id)) WITHOUT ROWID;
  CREATE TABLE nf_filings (accession TEXT PRIMARY KEY, symbol TEXT NOT NULL, form TEXT NOT NULL, filing_date TEXT NOT NULL CHECK (filing_date >= '${WARMUP_FROM}'), accepted_et TEXT NOT NULL, report_date TEXT, items TEXT, fetched_at TEXT NOT NULL);
  CREATE TABLE nf_corp (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, type TEXT NOT NULL, ex_date TEXT NOT NULL CHECK (ex_date >= '${WARMUP_FROM}'), pay_date TEXT, ratio REAL, amount REAL, fetched_at TEXT NOT NULL);
  CREATE TABLE nf_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, stock TEXT NOT NULL, session TEXT NOT NULL CHECK (session >= '${WARMUP_FROM}'), eligible_ms INTEGER NOT NULL, recorded_at TEXT NOT NULL, recorded_ms INTEGER NOT NULL, late INTEGER NOT NULL, packet_hash TEXT NOT NULL, plan_json TEXT NOT NULL, prev_hash TEXT NOT NULL, chain_hash TEXT NOT NULL, code_revision TEXT NOT NULL, UNIQUE (account, stock, session, eligible_ms));
  CREATE TABLE nf_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, detail_json TEXT NOT NULL);
  CREATE TABLE nf_snapshots (account TEXT NOT NULL, date TEXT NOT NULL, recorded_at TEXT NOT NULL, report_json TEXT NOT NULL, PRIMARY KEY (account, date)) WITHOUT ROWID;
  CREATE TABLE nf_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);
  CREATE TABLE nf_worker (id INTEGER PRIMARY KEY CHECK (id = 1), desired TEXT NOT NULL CHECK (desired IN ('running', 'paused', 'stopped')), token TEXT, pid INTEGER, heartbeat_at TEXT, state TEXT, updated_at TEXT NOT NULL);
  ${APPEND_ONLY.map((t) => `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
  CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`).join('\n  ')}
  INSERT INTO nf_schema (version) VALUES (1);
  COMMIT;`);
}
export function tx(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const o = fn(); db.exec('COMMIT'); return o; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; } }

export const getMeta = (db, key) => { const r = db.prepare('SELECT value_json FROM nf_meta WHERE key = ?').get(key); return r ? JSON.parse(r.value_json) : null; };
export const setMeta = (db, key, value, at) => db.prepare('INSERT INTO nf_meta (key, value_json, at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), at);

export function insertDaily(db, symbol, rows, at) { const st = db.prepare('INSERT INTO nf_daily (symbol, date, o, h, l, c, v, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'); let n = 0; tx(db, () => { for (const r of rows) n += Number(st.run(symbol, r.date, r.o, r.h, r.l, r.c, r.v ?? null, at).changes); }); return n; }
export function insertBars(db, symbol, rows, at) { const st = db.prepare('INSERT INTO nf_bars1m (symbol, date, minute, o, h, l, c, v, vw, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'); let n = 0; tx(db, () => { for (const r of rows) n += Number(st.run(symbol, r.date, r.minute, r.o, r.h, r.l, r.c, r.v, r.vw ?? null, at).changes); }); return n; }
export function insertNews(db, items, at) {
  const st = db.prepare('INSERT INTO nf_news (id, created_at, updated_at, headline, summary, source, symbols_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');
  const ss = db.prepare('INSERT INTO nf_news_symbols (news_id, symbol) VALUES (?, ?) ON CONFLICT DO NOTHING');
  let n = 0;
  tx(db, () => { for (const x of items) { n += Number(st.run(x.id, x.created_at, x.updated_at ?? null, x.headline ?? null, x.summary ?? null, x.source ?? null, JSON.stringify(x.symbols), at).changes); for (const s of x.basketSymbols) ss.run(x.id, s); } });
  return n;
}
export function insertFilings(db, rows, at) { const st = db.prepare('INSERT INTO nf_filings (accession, symbol, form, filing_date, accepted_et, report_date, items, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'); let n = 0; tx(db, () => { for (const r of rows) n += Number(st.run(r.accession, r.symbol, r.form, r.filingDate, r.acceptedEt, r.reportDate ?? null, (r.items || []).join(','), at).changes); }); return n; }
export function insertCorp(db, rows, at) { const st = db.prepare('INSERT INTO nf_corp (id, symbol, type, ex_date, pay_date, ratio, amount, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'); let n = 0; tx(db, () => { for (const r of rows) n += Number(st.run(r.id, r.symbol, r.type, r.exDate, r.payDate ?? null, r.ratio ?? null, r.amount ?? null, at).changes); }); return n; }
export const hasFiling = (db, accession) => !!db.prepare('SELECT 1 FROM nf_filings WHERE accession = ?').get(accession);
export const lastDaily = (db, symbol) => db.prepare('SELECT max(date) AS d FROM nf_daily WHERE symbol = ?').get(symbol)?.d ?? null;
export const lastBarDate = (db, symbol) => db.prepare('SELECT max(date) AS d FROM nf_bars1m WHERE symbol = ?').get(symbol)?.d ?? null;
export const lastNewsAt = (db) => db.prepare('SELECT max(created_at) AS t FROM nf_news').get()?.t ?? null;
export const dailyFor = (db) => db.prepare('SELECT symbol, date, o, h, l, c, v, fetched_at FROM nf_daily ORDER BY date, symbol').all();
export const barsFor = (db, symbol) => db.prepare('SELECT date, minute, o, h, l, c, v, vw, fetched_at FROM nf_bars1m WHERE symbol = ? ORDER BY date, minute').all(symbol);
export const newsFor = (db) => db.prepare('SELECT id, created_at AS createdAt, updated_at AS updatedAt, headline, summary, source, symbols_json, fetched_at FROM nf_news ORDER BY created_at, id').all().map((r) => ({ ...r, symbols: JSON.parse(r.symbols_json) }));
export const newsSymbols = (db) => db.prepare('SELECT news_id, symbol FROM nf_news_symbols').all();
export const filingsFor = (db) => db.prepare('SELECT * FROM nf_filings ORDER BY accepted_et, accession').all().map((r) => ({ accession: r.accession, symbol: r.symbol, form: r.form, filingDate: r.filing_date, acceptedEt: r.accepted_et, reportDate: r.report_date, items: r.items ? r.items.split(',').filter(Boolean) : [], fetched_at: r.fetched_at }));
export const corpFor = (db) => db.prepare('SELECT * FROM nf_corp ORDER BY ex_date, symbol').all();

export function insertPlan(db, args) { return tx(db, () => insertPlanTx(db, args)); }
function insertPlanTx(db, { account, stock, session, eligibleMs, recordedAt, recordedMs, late, packetHash, plan, codeRevision }) {
  const prev = db.prepare('SELECT chain_hash FROM nf_plans WHERE account = ? ORDER BY id DESC LIMIT 1').get(account)?.chain_hash ?? GENESIS;
  const planJson = JSON.stringify(plan);
  const chain = sha256(`${prev}|${recordedMs}|${packetHash}|${sha256(planJson)}`);
  const r = db.prepare('INSERT INTO nf_plans (account, stock, session, eligible_ms, recorded_at, recorded_ms, late, packet_hash, plan_json, prev_hash, chain_hash, code_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').run(account, stock, session, eligibleMs, recordedAt, recordedMs, late ? 1 : 0, packetHash, planJson, prev, chain, codeRevision);
  return Number(r.changes);
}
export const listPlans = (db, account) => db.prepare('SELECT * FROM nf_plans WHERE account = ? ORDER BY id').all(account).map((r) => ({ id: r.id, stock: r.stock, session: r.session, eligibleMs: r.eligible_ms, recordedAt: r.recorded_at, recordedMs: r.recorded_ms, late: !!r.late, packetHash: r.packet_hash, plan: JSON.parse(r.plan_json), prevHash: r.prev_hash, chainHash: r.chain_hash }));
export function verifyPlanChain(rows) {
  let prev = GENESIS;
  for (const r of rows) { if (r.prevHash !== prev || r.chainHash !== sha256(`${prev}|${r.recordedMs}|${r.packetHash}|${sha256(JSON.stringify(r.plan))}`)) return { ok: false, at: r.id }; prev = r.chainHash; }
  return { ok: true };
}
export const insertUpdate = (db, u) => Number(db.prepare('INSERT INTO nf_updates (started_at, finished_at, kind, status, detail_json) VALUES (?, ?, ?, ?, ?)').run(u.startedAt, u.finishedAt, u.kind, u.status, JSON.stringify(u.detail ?? {})).lastInsertRowid);
export const listUpdates = (db, limit = 50) => db.prepare('SELECT * FROM nf_updates ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, kind: r.kind, status: r.status, detail: JSON.parse(r.detail_json) }));
export const insertSnapshot = (db, account, date, at, report) => Number(db.prepare('INSERT INTO nf_snapshots (account, date, recorded_at, report_json) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(account, date, at, JSON.stringify(report)).changes);
export const listSnapshots = (db, account) => db.prepare('SELECT date, recorded_at, report_json FROM nf_snapshots WHERE account = ? ORDER BY date').all(account).map((r) => ({ date: r.date, recordedAt: r.recorded_at, report: JSON.parse(r.report_json) }));
export const logLine = (db, at, level, message) => db.prepare('INSERT INTO nf_log (at, level, message) VALUES (?, ?, ?)').run(at, level, String(message).slice(0, 2000));
export const listLog = (db, limit = 100) => db.prepare('SELECT at, level, message FROM nf_log ORDER BY id DESC LIMIT ?').all(limit);

// The control row: the owner's request (running, paused, stopped) and the worker's heartbeat.
export const worker = (db) => db.prepare('SELECT * FROM nf_worker WHERE id = 1').get() ?? null;
export function setDesired(db, desired, at) {
  if (!['running', 'paused', 'stopped'].includes(desired)) throw new NfError(400, `unknown worker request ${desired}`);
  db.prepare("INSERT INTO nf_worker (id, desired, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET desired = excluded.desired, updated_at = excluded.updated_at").run(desired, at);
}
export function claimWorker(db, { token, pid, at, staleMs }) {
  return tx(db, () => {
    const w = worker(db);
    if (w?.token && w.token !== token && w.heartbeat_at && Date.parse(at) - Date.parse(w.heartbeat_at) < staleMs) return { ok: false, holder: w };
    db.prepare("INSERT INTO nf_worker (id, desired, token, pid, heartbeat_at, state, updated_at) VALUES (1, 'running', ?, ?, ?, 'starting', ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, pid = excluded.pid, heartbeat_at = excluded.heartbeat_at, state = 'starting'").run(token, pid, at, at);
    return { ok: true };
  });
}
export function heartbeat(db, token, at, state) { return Number(db.prepare('UPDATE nf_worker SET heartbeat_at = ?, state = ? WHERE id = 1 AND token = ?').run(at, state, token).changes); }
export function releaseWorker(db, token, at) { db.prepare("UPDATE nf_worker SET token = NULL, pid = NULL, state = 'stopped', heartbeat_at = ? WHERE id = 1 AND token = ?").run(at, token); }
