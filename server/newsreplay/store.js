// news-replay's own database (data/news-replay.sqlite). The guard refuses every other programme's database (the
// portfolio, demo, Strategy Lab, HXR, range-trend, sweep-bos, ICT Lab, research runner, prospective journal and
// event-swing), links to them and any file holding tables that are not news-replay's (nr_). Source records carry
// CHECK constraints at the bound (2021-12-31, Eastern dates); source records, plans, actions, AI responses,
// evaluations and placebo results are append-only by trigger; plans and actions are hash-chained (each row stores
// the hash of its input packet or content and the chain hash of the previous row of its stream); a finished run is
// never changed; nothing is deleted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_NAME, MAX_DATE, sha256 } from './config.js';

export const nrDbFile = (dataDir) => path.join(dataDir, DB_NAME);
export function isRefusedName(name) {
  const n = String(name).toLowerCase();
  return n === 'signal-desk.sqlite' || n === 'demo.sqlite' || ['strategy-lab', 'hxr', 'range-trend', 'sweep-bos', 'ict-lab', 'research-runner', 'prospective-1', 'event-swing'].some((p) => n.startsWith(p));
}
export function guardNrFile(file) {
  const abs = path.resolve(file);
  const refuse = () => { throw new Error('news-replay never opens another programme\'s database (portfolio, demo, Strategy Lab, HXR, range-trend, sweep-bos, ICT Lab, research runner, prospective journal, event-swing)'); };
  if (isRefusedName(path.basename(abs))) refuse();
  let real;
  if (fs.existsSync(abs)) real = fs.realpathSync(abs);
  else {
    let isLink = false;
    try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch { /* none */ }
    if (isLink) throw new Error('news-replay refuses a database path that is a dangling symlink');
    real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  }
  if (isRefusedName(path.basename(real))) refuse();
  return real;
}

const APPEND_ONLY = ['nr_meta', 'nr_bars1m', 'nr_news', 'nr_news_symbols', 'nr_filings', 'nr_fomc', 'nr_downloads', 'nr_plans', 'nr_actions', 'nr_ai_cache', 'nr_evaluations', 'nr_placebo', 'nr_log'];
const SCHEMA = `
  CREATE TABLE nr_schema_version (version INTEGER NOT NULL);
  CREATE TABLE nr_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, at TEXT NOT NULL);
  CREATE TABLE nr_bars1m (
    symbol TEXT NOT NULL, date TEXT NOT NULL CHECK (date <= '${MAX_DATE}'), minute INTEGER NOT NULL,
    o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL, n INTEGER, vw REAL,
    PRIMARY KEY (symbol, date, minute)
  ) WITHOUT ROWID;
  CREATE TABLE nr_news (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_et_date TEXT NOT NULL CHECK (created_et_date <= '${MAX_DATE}'), updated_at TEXT,
    headline TEXT, summary TEXT, source TEXT, url TEXT, symbols_json TEXT NOT NULL, fetched_at TEXT NOT NULL
  );
  CREATE TABLE nr_news_symbols (news_id TEXT NOT NULL, symbol TEXT NOT NULL, PRIMARY KEY (symbol, news_id)) WITHOUT ROWID;
  CREATE TABLE nr_filings (
    accession TEXT PRIMARY KEY, symbol TEXT NOT NULL, cik INTEGER NOT NULL, form TEXT NOT NULL, filing_date TEXT NOT NULL CHECK (filing_date <= '${MAX_DATE}'),
    accepted_et TEXT NOT NULL CHECK (substr(accepted_et, 1, 10) <= '${MAX_DATE}'), report_date TEXT, items TEXT, index_url TEXT NOT NULL, fetched_at TEXT NOT NULL
  );
  CREATE TABLE nr_fomc (id TEXT PRIMARY KEY, kind TEXT NOT NULL, release_et TEXT NOT NULL CHECK (substr(release_et, 1, 10) <= '${MAX_DATE}'), time_known INTEGER NOT NULL, title TEXT, url TEXT NOT NULL, fetched_at TEXT NOT NULL);
  CREATE TABLE nr_downloads (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, symbol TEXT, from_date TEXT, to_date TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, status TEXT NOT NULL, requests INTEGER, summary_json TEXT NOT NULL);
  CREATE TABLE nr_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, planner TEXT NOT NULL, stock TEXT NOT NULL, session TEXT NOT NULL, eligible_ms INTEGER NOT NULL,
    packet_hash TEXT NOT NULL, plan_json TEXT NOT NULL, prev_hash TEXT NOT NULL, chain_hash TEXT NOT NULL, code_revision TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE (planner, stock, session, eligible_ms)
  );
  CREATE TABLE nr_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, config_id TEXT NOT NULL, variant TEXT NOT NULL, config_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')), attempt INTEGER NOT NULL DEFAULT 1, replacement_of INTEGER, defect_json TEXT,
    code_revision TEXT NOT NULL, manifest_hash TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER, summary_json TEXT, error TEXT,
    UNIQUE (config_id, variant, attempt)
  );
  CREATE TABLE nr_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES nr_runs(id), seq INTEGER NOT NULL, ms INTEGER NOT NULL, stock TEXT, kind TEXT NOT NULL,
    detail_json TEXT NOT NULL, prev_hash TEXT NOT NULL, chain_hash TEXT NOT NULL, UNIQUE (run_id, seq)
  );
  CREATE TABLE nr_ai_cache (packet_hash TEXT NOT NULL, variant TEXT NOT NULL, model TEXT NOT NULL, prompt_sha TEXT NOT NULL, response_json TEXT NOT NULL, usage_json TEXT, created_at TEXT NOT NULL, PRIMARY KEY (packet_hash, variant, model, prompt_sha));
  CREATE TABLE nr_evaluations (run_id INTEGER PRIMARY KEY, outcomes_json TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE nr_placebo (comparison TEXT PRIMARY KEY, resamples INTEGER NOT NULL, seed INTEGER NOT NULL, t_obs REAL, count_ge INTEGER, p REAL, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE nr_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);
  CREATE TABLE nr_lock (id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT NOT NULL, pid INTEGER, taken_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL);
  ${APPEND_ONLY.map((t) => `
  CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
  CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`).join('')}
  CREATE TRIGGER nr_runs_no_delete BEFORE DELETE ON nr_runs BEGIN SELECT RAISE(ABORT, 'nr_runs rows are never deleted'); END;
  CREATE TRIGGER nr_runs_finished BEFORE UPDATE ON nr_runs WHEN OLD.status IN ('done', 'failed') BEGIN SELECT RAISE(ABORT, 'a finished run is never changed'); END;
  INSERT INTO nr_schema_version (version) VALUES (1);
`;

export function openNrDb(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const real = guardNrFile(file);
  if (fs.existsSync(real)) {
    const probe = new DatabaseSync(real, { readOnly: true });
    try {
      const foreign = probe.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all().map((r) => r.name).filter((n) => !/^nr_/i.test(n) && !/^sqlite_/i.test(n));
      if (foreign.length) throw new Error(`news-replay refuses ${path.basename(real)}: it holds tables that are not news-replay's (${foreign.slice(0, 5).join(', ')})`);
    } finally { probe.close(); }
  }
  const db = new DatabaseSync(real);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;');
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nr_schema_version'").get()) db.exec(SCHEMA);
  migrate(db);
  return db;
}
// Migration 2 (2026-11-06, before any plan existed): a plan is unique per planner, stock, session and eligible time
// (a later item in the session gets its own follow-up check). Applied only while nr_plans is empty.
function migrate(db) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'nr_plans'").get()?.sql ?? '';
  if (sql.includes('eligible_ms)')) return;
  tx(db, () => {
    if (db.prepare('SELECT COUNT(*) AS n FROM nr_plans').get().n) throw new Error('nr_plans holds rows under the old key: migration 2 refused');
    db.exec(`DROP TRIGGER nr_plans_no_update; DROP TRIGGER nr_plans_no_delete; DROP TABLE nr_plans;
      CREATE TABLE nr_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT, planner TEXT NOT NULL, stock TEXT NOT NULL, session TEXT NOT NULL, eligible_ms INTEGER NOT NULL,
        packet_hash TEXT NOT NULL, plan_json TEXT NOT NULL, prev_hash TEXT NOT NULL, chain_hash TEXT NOT NULL, code_revision TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE (planner, stock, session, eligible_ms)
      );
      CREATE TRIGGER nr_plans_no_update BEFORE UPDATE ON nr_plans BEGIN SELECT RAISE(ABORT, 'nr_plans is append-only'); END;
      CREATE TRIGGER nr_plans_no_delete BEFORE DELETE ON nr_plans BEGIN SELECT RAISE(ABORT, 'nr_plans is append-only'); END;
      INSERT INTO nr_schema_version (version) VALUES (2);`);
  });
}
export function tx(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const o = fn(); db.exec('COMMIT'); return o; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; } }
const pj = (s) => (s == null ? null : JSON.parse(s));

export const getMeta = (db, key) => { const r = db.prepare('SELECT value_json FROM nr_meta WHERE key = ?').get(key); return r ? JSON.parse(r.value_json) : null; };
export const setMeta = (db, key, value, at) => db.prepare('INSERT INTO nr_meta (key, value_json, at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), at);

// ---------- source records ----------
export function insertBars(db, symbol, bars) {
  const st = db.prepare('INSERT INTO nr_bars1m (symbol, date, minute, o, h, l, c, v, n, vw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
  let n = 0;
  tx(db, () => { for (const b of bars) n += Number(st.run(symbol, b.date, b.minute, b.o, b.h, b.l, b.c, b.v, b.n ?? null, b.vw ?? null).changes); });
  return n;
}
export function barsFor(db, symbol, { from, to }) {
  return db.prepare('SELECT date, minute, o, h, l, c, v FROM nr_bars1m WHERE symbol = ? AND date >= ? AND date <= ? AND date <= ? ORDER BY date, minute').all(symbol, from, to, MAX_DATE);
}
export const barCoverage = (db) => db.prepare('SELECT symbol, MIN(date) AS first, MAX(date) AS last, COUNT(DISTINCT date) AS sessions, COUNT(*) AS bars FROM nr_bars1m WHERE date <= ? GROUP BY symbol ORDER BY symbol').all(MAX_DATE);
export function insertNews(db, items, at) {
  const st = db.prepare('INSERT INTO nr_news (id, created_at, created_et_date, updated_at, headline, summary, source, url, symbols_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');
  const ss = db.prepare('INSERT INTO nr_news_symbols (news_id, symbol) VALUES (?, ?) ON CONFLICT DO NOTHING');
  let n = 0;
  tx(db, () => { for (const x of items) { n += Number(st.run(x.id, x.created_at, x.createdEtDate, x.updated_at ?? null, x.headline ?? null, x.summary ?? null, x.source ?? null, x.url ?? null, JSON.stringify(x.symbols), at).changes); for (const s of x.basketSymbols) ss.run(x.id, s); } });
  return n;
}
export function newsFor(db, { to = MAX_DATE } = {}) {
  return db.prepare('SELECT id, created_at, created_et_date, updated_at, headline, summary, source, symbols_json FROM nr_news WHERE created_et_date <= ? AND created_et_date <= ? ORDER BY created_at, id').all(to, MAX_DATE)
    .map((r) => ({ id: r.id, createdAt: r.created_at, createdEtDate: r.created_et_date, updatedAt: r.updated_at, headline: r.headline, summary: r.summary, source: r.source, symbols: JSON.parse(r.symbols_json) }));
}
export const newsSymbols = (db) => db.prepare('SELECT news_id, symbol FROM nr_news_symbols ORDER BY news_id, symbol').all();
export function insertFilings(db, rows, at) {
  const st = db.prepare('INSERT INTO nr_filings (accession, symbol, cik, form, filing_date, accepted_et, report_date, items, index_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(accession) DO NOTHING');
  let n = 0;
  tx(db, () => { for (const f of rows) n += Number(st.run(f.accession, f.symbol, f.cik, f.form, f.filingDate, f.acceptedEt, f.reportDate ?? null, (f.items || []).join(','), f.indexUrl, at).changes); });
  return n;
}
export const hasFiling = (db, accession) => !!db.prepare('SELECT 1 FROM nr_filings WHERE accession = ?').get(accession);
export const filingsFor = (db) => db.prepare('SELECT * FROM nr_filings WHERE substr(accepted_et, 1, 10) <= ? ORDER BY accepted_et, accession').all(MAX_DATE).map((r) => ({ accession: r.accession, symbol: r.symbol, form: r.form, filingDate: r.filing_date, acceptedEt: r.accepted_et, reportDate: r.report_date, items: r.items ? r.items.split(',').filter(Boolean) : [] }));
export function insertFomc(db, rows, at) {
  const st = db.prepare('INSERT INTO nr_fomc (id, kind, release_et, time_known, title, url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');
  let n = 0;
  tx(db, () => { for (const f of rows) n += Number(st.run(f.id, f.kind, f.releaseEt, f.timeKnown ? 1 : 0, f.title ?? null, f.url, at).changes); });
  return n;
}
export const fomcFor = (db) => db.prepare('SELECT * FROM nr_fomc WHERE substr(release_et, 1, 10) <= ? ORDER BY release_et').all(MAX_DATE).map((r) => ({ id: r.id, kind: r.kind, releaseEt: r.release_et, timeKnown: !!r.time_known, title: r.title, url: r.url }));
export const insertDownload = (db, d) => db.prepare('INSERT INTO nr_downloads (kind, symbol, from_date, to_date, started_at, finished_at, status, requests, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(d.kind, d.symbol ?? null, d.from ?? null, d.to ?? null, d.startedAt, d.finishedAt, d.status, d.requests ?? null, JSON.stringify(d.summary ?? {}));
export const listDownloads = (db) => db.prepare('SELECT * FROM nr_downloads ORDER BY id').all().map((r) => ({ ...r, summary: pj(r.summary_json) }));

// ---------- plans and actions: append-only, hash-chained ----------
export const GENESIS = '0'.repeat(64);
export function insertPlan(db, { planner, stock, session, eligibleMs, packetHash, plan, at, codeRevision }) {
  const prev = db.prepare('SELECT chain_hash FROM nr_plans WHERE planner = ? ORDER BY id DESC LIMIT 1').get(planner)?.chain_hash ?? GENESIS;
  const planJson = JSON.stringify(plan);
  const chain = sha256(`${prev}|${packetHash}|${sha256(planJson)}`);
  db.prepare('INSERT INTO nr_plans (planner, stock, session, eligible_ms, packet_hash, plan_json, prev_hash, chain_hash, code_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(planner, stock, session, eligibleMs, packetHash, planJson, prev, chain, codeRevision, at);
  return chain;
}
export const listPlans = (db, planner) => db.prepare('SELECT * FROM nr_plans WHERE planner = ? ORDER BY id').all(planner).map((r) => ({ id: r.id, planner: r.planner, stock: r.stock, session: r.session, eligibleMs: r.eligible_ms, packetHash: r.packet_hash, plan: JSON.parse(r.plan_json), prevHash: r.prev_hash, chainHash: r.chain_hash }));
export function verifyChain(rows, contentHash) {
  let prev = GENESIS;
  for (const r of rows) { if (r.prevHash !== prev || r.chainHash !== sha256(`${prev}|${contentHash(r)}`)) return { ok: false, at: r.id }; prev = r.chainHash; }
  return { ok: true, last: prev };
}
export function insertActions(db, runId, actions) {
  const st = db.prepare('INSERT INTO nr_actions (run_id, seq, ms, stock, kind, detail_json, prev_hash, chain_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  let prev = GENESIS;
  tx(db, () => { actions.forEach((a, i) => { const d = JSON.stringify(a.detail ?? {}); const chain = sha256(`${prev}|${a.ms}|${a.stock ?? ''}|${a.kind}|${sha256(d)}`); st.run(runId, i, a.ms, a.stock ?? null, a.kind, d, prev, chain); prev = chain; }); });
  return prev;
}
export const listActions = (db, runId, { limit = 100000, offset = 0 } = {}) => db.prepare('SELECT * FROM nr_actions WHERE run_id = ? ORDER BY seq LIMIT ? OFFSET ?').all(runId, limit, offset).map((r) => ({ seq: r.seq, ms: r.ms, stock: r.stock, kind: r.kind, detail: JSON.parse(r.detail_json), prevHash: r.prev_hash, chainHash: r.chain_hash }));

// ---------- runs, evaluations, placebo, AI cache, log, lock ----------
export function startRun(db, r) { return Number(db.prepare("INSERT INTO nr_runs (config_id, variant, config_hash, status, attempt, replacement_of, defect_json, code_revision, manifest_hash, started_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)").run(r.configId, r.variant, r.configHash, r.attempt ?? 1, r.replacementOf ?? null, r.defect ? JSON.stringify(r.defect) : null, r.codeRevision, r.manifestHash, r.startedAt).lastInsertRowid); }
export function finishRun(db, id, { status, summary = null, error = null, at, durationMs }) { db.prepare("UPDATE nr_runs SET status = ?, summary_json = ?, error = ?, finished_at = ?, duration_ms = ? WHERE id = ? AND status = 'running'").run(status, summary ? JSON.stringify(summary) : null, error, at, durationMs, id); }
const runRow = (r) => r && ({ id: r.id, configId: r.config_id, variant: r.variant, configHash: r.config_hash, status: r.status, attempt: r.attempt, replacementOf: r.replacement_of, defect: pj(r.defect_json), codeRevision: r.code_revision, manifestHash: r.manifest_hash, startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms, summary: pj(r.summary_json), error: r.error });
export const listRuns = (db) => db.prepare('SELECT * FROM nr_runs ORDER BY id').all().map(runRow);
export const getRun = (db, id) => runRow(db.prepare('SELECT * FROM nr_runs WHERE id = ?').get(id));
export const insertEvaluation = (db, runId, outcomes, at) => db.prepare('INSERT INTO nr_evaluations (run_id, outcomes_json, created_at) VALUES (?, ?, ?)').run(runId, JSON.stringify(outcomes), at);
export const getEvaluation = (db, runId) => { const r = db.prepare('SELECT outcomes_json FROM nr_evaluations WHERE run_id = ?').get(runId); return r ? JSON.parse(r.outcomes_json) : null; };
export const insertPlacebo = (db, p, at) => db.prepare('INSERT INTO nr_placebo (comparison, resamples, seed, t_obs, count_ge, p, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(p.comparison, p.resamples, p.seed, p.tObs, p.countGe, p.p, JSON.stringify(p.details ?? {}), at);
export const listPlacebo = (db) => db.prepare('SELECT * FROM nr_placebo ORDER BY comparison').all().map((r) => ({ comparison: r.comparison, resamples: r.resamples, seed: r.seed, tObs: r.t_obs, countGe: r.count_ge, p: r.p, details: pj(r.details_json) }));
export const getAiCache = (db, k) => { const r = db.prepare('SELECT response_json, usage_json FROM nr_ai_cache WHERE packet_hash = ? AND variant = ? AND model = ? AND prompt_sha = ?').get(k.packetHash, k.variant, k.model, k.promptSha); return r ? { response: JSON.parse(r.response_json), usage: pj(r.usage_json) } : null; };
export const putAiCache = (db, k, response, usage, at) => db.prepare('INSERT INTO nr_ai_cache (packet_hash, variant, model, prompt_sha, response_json, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(k.packetHash, k.variant, k.model, k.promptSha, JSON.stringify(response), usage ? JSON.stringify(usage) : null, at);
export const logEvent = (db, { level = 'info', message, at }) => db.prepare('INSERT INTO nr_log (at, level, message) VALUES (?, ?, ?)').run(at, level, String(message).slice(0, 2000));
export function takeLock(db, { token, at, staleMs }) {
  return tx(db, () => {
    const cur = db.prepare('SELECT * FROM nr_lock WHERE id = 1').get();
    if (cur && cur.token !== token && Date.parse(at) - Date.parse(cur.heartbeat_at) < staleMs) return { ok: false, holder: cur };
    db.prepare('INSERT INTO nr_lock (id, token, pid, taken_at, heartbeat_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, pid = excluded.pid, taken_at = excluded.taken_at, heartbeat_at = excluded.heartbeat_at').run(token, process.pid, at, at);
    return { ok: true };
  });
}
export const releaseLock = (db, token) => tx(db, () => db.prepare('DELETE FROM nr_lock WHERE id = 1 AND token = ?').run(token).changes === 1);
export const lockHolder = (db) => db.prepare('SELECT * FROM nr_lock WHERE id = 1').get() || null;
void os;

// ---------- read-only views for the Research page's plan inspector ----------
const actionRow = (r) => ({ seq: r.seq, ms: r.ms, stock: r.stock, kind: r.kind, detail: JSON.parse(r.detail_json) });
export function plansPage(db, { planner, stock = null, session = null, entryOnly = true, limit = 50, offset = 0 }) {
  const where = ['planner = ?'], args = [planner];
  if (stock) { where.push('stock = ?'); args.push(stock); }
  if (session) { where.push('session = ?'); args.push(session); }
  if (entryOnly) where.push("json_extract(plan_json, '$.followUp') = 0");
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT count(*) AS n FROM nr_plans WHERE ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT id, stock, session, eligible_ms, json_extract(plan_json, '$.category') AS category, json_extract(plan_json, '$.status') AS status, json_extract(plan_json, '$.followUp') AS follow_up FROM nr_plans WHERE ${w} ORDER BY eligible_ms, stock, id LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { total, rows: rows.map((r) => ({ id: r.id, stock: r.stock, session: r.session, T: r.eligible_ms, category: r.category, status: r.status, followUp: !!r.follow_up })) };
}
export function planRow(db, id) {
  const r = db.prepare('SELECT * FROM nr_plans WHERE id = ?').get(id);
  return r ? { id: r.id, planner: r.planner, stock: r.stock, session: r.session, eligibleMs: r.eligible_ms, packetHash: r.packet_hash, chainHash: r.chain_hash, codeRevision: r.code_revision, createdAt: r.created_at, plan: JSON.parse(r.plan_json) } : null;
}
export function itemTexts(db, ids) {
  const qn = db.prepare('SELECT id, created_at, updated_at, headline, source FROM nr_news WHERE id = ?');
  const qf = db.prepare('SELECT accession, symbol, form, accepted_et, items FROM nr_filings WHERE accession = ?');
  const qo = db.prepare('SELECT id, kind, release_et, title FROM nr_fomc WHERE id = ?');
  return ids.map((id) => {
    const i = id.indexOf(':'), kind = id.slice(0, i), key = id.slice(i + 1);
    if (kind === 'news') { const r = qn.get(key); return r ? { id, kind, published: r.created_at, updated: r.updated_at, headline: r.headline, source: r.source } : { id, kind, missing: true }; }
    if (kind === 'filing') { const r = qf.get(key); return r ? { id, kind, published: r.accepted_et, headline: `${r.symbol} filed ${r.form}${r.items ? ` (items ${r.items.split(',').filter(Boolean).join(', ')})` : ''}`, source: 'SEC EDGAR' } : { id, kind, missing: true }; }
    if (kind === 'fomc') { const r = qo.get(key); return r ? { id, kind, published: r.release_et, headline: r.title || 'FOMC statement', source: 'federalreserve.gov' } : { id, kind, missing: true }; }
    return { id, kind, missing: true };
  });
}
export function baseRunOf(db, configId) {
  const r = db.prepare("SELECT id FROM nr_runs WHERE config_id = ? AND variant = 'base' AND status = 'done' ORDER BY id DESC LIMIT 1").get(configId);
  return r ? r.id : null;
}
// The decision records of one plan in one run (activation, signal, buy), then the trade's later records (exits,
// splits, dividends): the outcome, which the page shows in a separate panel.
export function actionsForPlan(db, runId, planId) {
  const decision = db.prepare("SELECT * FROM nr_actions WHERE run_id = ? AND json_extract(detail_json, '$.planId') = ? ORDER BY seq").all(runId, planId).map(actionRow);
  const tradeId = decision.find((a) => a.kind === 'buy')?.detail.tradeId ?? null;
  const outcome = tradeId == null ? [] : db.prepare("SELECT * FROM nr_actions WHERE run_id = ? AND kind != 'buy' AND json_extract(detail_json, '$.tradeId') = ? ORDER BY seq").all(runId, tradeId).map(actionRow);
  return { decision, outcome, tradeId };
}
// Every finished run's report; a later attempt of the same configuration and variant replaces an earlier one.
export function doneReports(db) {
  const by = new Map();
  for (const r of db.prepare("SELECT config_id, variant, summary_json FROM nr_runs WHERE status = 'done' ORDER BY id").all()) by.set(`${r.config_id}|${r.variant}`, JSON.parse(r.summary_json).report);
  return by;
}
