// event-swing's own database (data/event-swing.sqlite). The guard refuses the portfolio, demo, Strategy Lab, HXR,
// range-trend, sweep-bos, ICT Lab, research-runner and prospective-journal databases, links to them, dangling links
// and any file holding tables that are not event-swing's (es_). Source records (the EDGAR listing, the parsed filing
// indexes and the exhibit documents), the meta values and the placebo results are append-only by trigger; a run row
// may change only while it is queued or running, and never after it is done or failed; nothing is ever deleted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DB_NAME, MAX_DATE } from './config.js';

export const esDbFile = (dataDir) => path.join(dataDir, DB_NAME);

export function isRefusedName(name) {
  const n = String(name).toLowerCase();
  return n === 'signal-desk.sqlite' || n === 'demo.sqlite' || ['strategy-lab', 'hxr', 'range-trend', 'sweep-bos', 'ict-lab', 'research-runner', 'prospective-1'].some((p) => n.startsWith(p));
}

export function guardEsFile(file) {
  const abs = path.resolve(file);
  const refuse = () => { throw new Error('event-swing never opens the portfolio, demo, Strategy Lab, HXR, range-trend, sweep-bos, ICT Lab, research-runner or prospective-journal databases'); };
  if (isRefusedName(path.basename(abs))) refuse();
  let real;
  if (fs.existsSync(abs)) real = fs.realpathSync(abs);
  else {
    let isLink = false;
    try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch { /* does not exist */ }
    if (isLink) throw new Error('event-swing refuses a database path that is a dangling symlink');
    real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  }
  if (isRefusedName(path.basename(real))) refuse();
  return real;
}

const APPEND_ONLY = ['es_meta', 'es_listing', 'es_filings', 'es_documents', 'es_downloads', 'es_placebo', 'es_log'];
const SCHEMA = `
  CREATE TABLE es_schema_version (version INTEGER NOT NULL);
  CREATE TABLE es_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, at TEXT NOT NULL);
  CREATE TABLE es_listing (
    accession TEXT PRIMARY KEY, symbol TEXT NOT NULL, cik INTEGER NOT NULL, form TEXT NOT NULL, filing_date TEXT NOT NULL CHECK (filing_date <= '${MAX_DATE}'),
    items_desc TEXT, index_url TEXT NOT NULL, company_name TEXT NOT NULL, fetched_at TEXT NOT NULL
  );
  CREATE TABLE es_filings (
    accession TEXT PRIMARY KEY, symbol TEXT NOT NULL, cik INTEGER NOT NULL, form TEXT NOT NULL, filing_date TEXT,
    accepted_et TEXT, report_date TEXT, items TEXT, exhibit_type TEXT, exhibit_url TEXT, documents_json TEXT,
    status TEXT NOT NULL CHECK (status IN ('ok', 'unparsed')), problem TEXT, fetched_at TEXT NOT NULL,
    CHECK (filing_date IS NULL OR filing_date <= '${MAX_DATE}'), CHECK (accepted_et IS NULL OR substr(accepted_et, 1, 10) <= '${MAX_DATE}')
  );
  CREATE TABLE es_documents (
    accession TEXT PRIMARY KEY, url TEXT, status TEXT NOT NULL CHECK (status IN ('ok', 'missing', 'error')), http_status INTEGER,
    sha256 TEXT, bytes INTEGER, body TEXT, fetched_at TEXT NOT NULL
  );
  CREATE TABLE es_downloads (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, status TEXT NOT NULL, requests INTEGER NOT NULL, summary_json TEXT NOT NULL);
  CREATE TABLE es_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'paused', 'stopped', 'done')),
    code_revision TEXT NOT NULL, engine_version TEXT NOT NULL, prereg_commit TEXT NOT NULL, head_commit TEXT, pins_json TEXT NOT NULL,
    manifest_hash TEXT NOT NULL, inputs_hash TEXT NOT NULL, calibration_hash TEXT NOT NULL, inventory_json TEXT NOT NULL,
    created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, elapsed_ms INTEGER NOT NULL DEFAULT 0, stop_reason TEXT, holm_json TEXT,
    worker_token TEXT, worker_pid INTEGER, worker_host TEXT, heartbeat_at TEXT
  );
  CREATE TABLE es_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL REFERENCES es_campaigns(id), ordinal INTEGER NOT NULL,
    config_id TEXT NOT NULL, variant TEXT NOT NULL CHECK (variant IN ('base', 'double_costs', 'delayed')), attempt INTEGER NOT NULL DEFAULT 1,
    config_hash TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
    replacement_of INTEGER, defect_json TEXT, claimed_by TEXT, started_at TEXT, finished_at TEXT, duration_ms INTEGER,
    code_revision TEXT, summary_json TEXT, error TEXT, created_at TEXT NOT NULL,
    UNIQUE (campaign_id, config_id, variant, attempt)
  );
  CREATE TABLE es_placebo (
    campaign_id INTEGER NOT NULL, config_id TEXT NOT NULL, resamples INTEGER NOT NULL, seed INTEGER NOT NULL, t_obs REAL, count_ge INTEGER, p REAL,
    failed INTEGER NOT NULL, unclustered INTEGER NOT NULL, duration_ms INTEGER NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (campaign_id, config_id)
  );
  CREATE TABLE es_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, run_id INTEGER, dedupe_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, seen_at TEXT
  );
  CREATE TABLE es_log (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);
  CREATE TABLE es_lock (id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT NOT NULL, pid INTEGER, host TEXT, taken_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL);
  ${APPEND_ONLY.map((t) => `
  CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
  CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`).join('')}
  CREATE TRIGGER es_runs_no_delete BEFORE DELETE ON es_runs BEGIN SELECT RAISE(ABORT, 'es_runs rows are never deleted'); END;
  CREATE TRIGGER es_runs_finished BEFORE UPDATE ON es_runs WHEN OLD.status IN ('done', 'failed', 'cancelled') BEGIN SELECT RAISE(ABORT, 'a finished run is never changed'); END;
  CREATE TRIGGER es_campaigns_no_delete BEFORE DELETE ON es_campaigns BEGIN SELECT RAISE(ABORT, 'es_campaigns rows are never deleted'); END;
  CREATE TRIGGER es_notifications_seen_only BEFORE UPDATE ON es_notifications WHEN NEW.title IS NOT OLD.title OR NEW.body IS NOT OLD.body OR NEW.dedupe_key IS NOT OLD.dedupe_key BEGIN SELECT RAISE(ABORT, 'a notification changes only when it is seen'); END;
  INSERT INTO es_schema_version (version) VALUES (1);
`;

export function openEsDb(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const real = guardEsFile(file);
  if (fs.existsSync(real)) {
    const probe = new DatabaseSync(real, { readOnly: true });
    try {
      const foreign = probe.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all().map((r) => r.name).filter((n) => !/^es_/i.test(n) && !/^sqlite_/i.test(n));
      if (foreign.length) throw new Error(`event-swing refuses ${path.basename(real)}: it holds tables that are not event-swing's (${foreign.slice(0, 5).join(', ')})`);
    } finally { probe.close(); }
  }
  const db = new DatabaseSync(real);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;');
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'es_schema_version'").get();
  if (!has) db.exec(SCHEMA);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
}
const j = (v) => (v == null ? null : JSON.stringify(v));
const pj = (s) => (s == null ? null : JSON.parse(s));

// ---------- meta (write-once) ----------
export const getMeta = (db, key) => { const r = db.prepare('SELECT value_json FROM es_meta WHERE key = ?').get(key); return r ? JSON.parse(r.value_json) : null; };
export const setMeta = (db, key, value, at) => db.prepare('INSERT INTO es_meta (key, value_json, at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), at);

// ---------- source records ----------
export function insertListing(db, rows, at) {
  // Duplicates are skipped; a CHECK failure (a filing after the bound) still throws (OR IGNORE would hide it).
  const st = db.prepare('INSERT INTO es_listing (accession, symbol, cik, form, filing_date, items_desc, index_url, company_name, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(accession) DO NOTHING');
  let n = 0;
  for (const r of rows) n += Number(st.run(r.accession, r.symbol, r.cik, r.form, r.filingDate, r.itemsDesc ?? null, r.indexUrl, r.companyName, at).changes);
  return n;
}
export const listListing = (db, symbol = null) => db.prepare(`SELECT * FROM es_listing ${symbol ? 'WHERE symbol = ?' : ''} ORDER BY symbol, filing_date, accession`).all(...(symbol ? [symbol] : []));
export function insertFiling(db, f, at) {
  return db.prepare(`INSERT INTO es_filings (accession, symbol, cik, form, filing_date, accepted_et, report_date, items, exhibit_type, exhibit_url, documents_json, status, problem, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.accession, f.symbol, f.cik, f.form, f.filingDate ?? null, f.acceptedEt ?? null, f.reportDate ?? null, f.items ? f.items.join(',') : null, f.exhibitType ?? null, f.exhibitUrl ?? null, j(f.documents ?? null), f.status, f.problem ?? null, at);
}
const filingRow = (r) => ({ accession: r.accession, symbol: r.symbol, cik: r.cik, form: r.form, filingDate: r.filing_date, acceptedEt: r.accepted_et, reportDate: r.report_date, items: r.items ? r.items.split(',') : [], exhibitType: r.exhibit_type, exhibitUrl: r.exhibit_url, documents: pj(r.documents_json), status: r.status, problem: r.problem });
export const listFilings = (db, symbol = null) => db.prepare(`SELECT * FROM es_filings ${symbol ? 'WHERE symbol = ?' : ''} ORDER BY symbol, accepted_et, accession`).all(...(symbol ? [symbol] : [])).map(filingRow);
export const hasFiling = (db, accession) => !!db.prepare('SELECT 1 FROM es_filings WHERE accession = ?').get(accession);
export function insertDocument(db, d, at) {
  const sha = d.body == null ? null : crypto.createHash('sha256').update(d.body).digest('hex');
  return db.prepare('INSERT INTO es_documents (accession, url, status, http_status, sha256, bytes, body, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(d.accession, d.url ?? null, d.status, d.httpStatus ?? null, sha, d.body == null ? null : Buffer.byteLength(d.body), d.body ?? null, at);
}
export const hasDocument = (db, accession) => !!db.prepare('SELECT 1 FROM es_documents WHERE accession = ?').get(accession);
export const getDocument = (db, accession) => { const r = db.prepare('SELECT * FROM es_documents WHERE accession = ?').get(accession); return r ? { accession: r.accession, url: r.url, status: r.status, httpStatus: r.http_status, sha256: r.sha256, bytes: r.bytes, body: r.body } : null; };
export const documentDigests = (db) => db.prepare('SELECT accession, status, sha256 FROM es_documents ORDER BY accession').all();
export const insertDownload = (db, d) => db.prepare('INSERT INTO es_downloads (started_at, finished_at, status, requests, summary_json) VALUES (?, ?, ?, ?, ?)').run(d.startedAt, d.finishedAt, d.status, d.requests, JSON.stringify(d.summary));
export const listDownloads = (db) => db.prepare('SELECT * FROM es_downloads ORDER BY id').all().map((r) => ({ ...r, summary: pj(r.summary_json) }));

// ---------- campaigns and runs ----------
const campaignRow = (r) => r && ({ id: r.id, status: r.status, codeRevision: r.code_revision, engineVersion: r.engine_version, preregCommit: r.prereg_commit, headCommit: r.head_commit, pins: pj(r.pins_json), manifestHash: r.manifest_hash, inputsHash: r.inputs_hash, calibrationHash: r.calibration_hash, inventory: pj(r.inventory_json), createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, elapsedMs: r.elapsed_ms, stopReason: r.stop_reason, holm: pj(r.holm_json), worker: r.worker_token ? { token: r.worker_token, pid: r.worker_pid, host: r.worker_host, heartbeatAt: r.heartbeat_at } : null });
export function insertCampaign(db, c) {
  return Number(db.prepare(`INSERT INTO es_campaigns (status, code_revision, engine_version, prereg_commit, head_commit, pins_json, manifest_hash, inputs_hash, calibration_hash, inventory_json, created_at)
    VALUES ('planned', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.codeRevision, c.engineVersion, c.preregCommit, c.headCommit ?? null, JSON.stringify(c.pins), c.manifestHash, c.inputsHash, c.calibrationHash, JSON.stringify(c.inventory), c.createdAt).lastInsertRowid);
}
export const getCampaign = (db, id) => campaignRow(db.prepare('SELECT * FROM es_campaigns WHERE id = ?').get(id));
export const listCampaigns = (db) => db.prepare('SELECT * FROM es_campaigns ORDER BY id DESC').all().map(campaignRow);
export function updateCampaign(db, id, fields) {
  const map = { status: 'status', startedAt: 'started_at', finishedAt: 'finished_at', elapsedMs: 'elapsed_ms', stopReason: 'stop_reason', holm: 'holm_json', workerToken: 'worker_token', workerPid: 'worker_pid', workerHost: 'worker_host', heartbeatAt: 'heartbeat_at', headCommit: 'head_commit' };
  const keys = Object.keys(fields).filter((k) => map[k]);
  if (!keys.length) return;
  db.prepare(`UPDATE es_campaigns SET ${keys.map((k) => `${map[k]} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => (k === 'holm' ? j(fields[k]) : fields[k])), id);
}
const runRow = (r) => r && ({ id: r.id, campaignId: r.campaign_id, ordinal: r.ordinal, configId: r.config_id, variant: r.variant, attempt: r.attempt, configHash: r.config_hash, status: r.status, replacementOf: r.replacement_of, defect: pj(r.defect_json), claimedBy: r.claimed_by, startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms, codeRevision: r.code_revision, summary: pj(r.summary_json), error: r.error, createdAt: r.created_at });
export function enqueueRuns(db, campaignId, items, at) {
  const st = db.prepare('INSERT INTO es_runs (campaign_id, ordinal, config_id, variant, attempt, config_hash, status, replacement_of, defect_json, created_at) VALUES (?, ?, ?, ?, ?, ?, \'queued\', ?, ?, ?)');
  return items.map((x) => Number(st.run(campaignId, x.ordinal, x.configId, x.variant, x.attempt ?? 1, x.configHash, x.replacementOf ?? null, j(x.defect ?? null), at).lastInsertRowid));
}
export function claimNextRun(db, campaignId, worker, at) {
  return tx(db, () => {
    const r = db.prepare("SELECT id FROM es_runs WHERE campaign_id = ? AND status = 'queued' ORDER BY ordinal, id LIMIT 1").get(campaignId);
    if (!r) return null;
    db.prepare("UPDATE es_runs SET status = 'running', claimed_by = ?, started_at = ? WHERE id = ? AND status = 'queued'").run(worker, at, r.id);
    return runRow(db.prepare('SELECT * FROM es_runs WHERE id = ?').get(r.id));
  });
}
export function finishRun(db, id, { status, summary = null, error = null, at, durationMs, codeRevision }) {
  db.prepare("UPDATE es_runs SET status = ?, summary_json = ?, error = ?, finished_at = ?, duration_ms = ?, code_revision = ? WHERE id = ? AND status = 'running'").run(status, j(summary), error, at, durationMs, codeRevision, id);
}
export const getRun = (db, id) => runRow(db.prepare('SELECT * FROM es_runs WHERE id = ?').get(id));
export const listRuns = (db, campaignId) => db.prepare('SELECT * FROM es_runs WHERE campaign_id = ? ORDER BY ordinal, id').all(campaignId).map(runRow);
export function requeueInterrupted(db, campaignId) {
  // A run left 'running' by a dead worker is failed with its reason kept (never silently re-run: a re-run is a replacement).
  return db.prepare("UPDATE es_runs SET status = 'failed', error = 'interrupted: the worker stopped before the run finished', finished_at = COALESCE(finished_at, started_at) WHERE campaign_id = ? AND status = 'running'").run(campaignId).changes;
}
export const cancelQueued = (db, campaignId) => db.prepare("UPDATE es_runs SET status = 'cancelled' WHERE campaign_id = ? AND status = 'queued'").run(campaignId).changes;
export function insertPlacebo(db, p, at) {
  db.prepare('INSERT INTO es_placebo (campaign_id, config_id, resamples, seed, t_obs, count_ge, p, failed, unclustered, duration_ms, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(p.campaignId, p.configId, p.resamples, p.seed, p.tObs, p.countGe, p.p, p.failed, p.unclustered, p.durationMs, JSON.stringify(p.details ?? {}), at);
}
export const listPlacebo = (db, campaignId) => db.prepare('SELECT * FROM es_placebo WHERE campaign_id = ? ORDER BY config_id').all(campaignId).map((r) => ({ configId: r.config_id, resamples: r.resamples, seed: r.seed, tObs: r.t_obs, countGe: r.count_ge, p: r.p, failed: r.failed, unclustered: r.unclustered, durationMs: r.duration_ms, details: pj(r.details_json) }));
export function insertNotification(db, n) {
  return db.prepare('INSERT OR IGNORE INTO es_notifications (campaign_id, run_id, dedupe_key, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(n.campaignId, n.runId ?? null, n.key, n.title, n.body, n.at).changes;
}
export const listNotifications = (db, { limit = 100 } = {}) => db.prepare('SELECT * FROM es_notifications ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({ id: r.id, campaignId: r.campaign_id, runId: r.run_id, title: r.title, body: r.body, createdAt: r.created_at, seenAt: r.seen_at }));
export const markSeen = (db, ids, at) => { const st = db.prepare('UPDATE es_notifications SET seen_at = COALESCE(seen_at, ?) WHERE id = ?'); let n = 0; for (const id of ids) n += Number(st.run(at, id).changes); return n; };
export const logEvent = (db, { campaignId = null, level = 'info', message, at }) => db.prepare('INSERT INTO es_log (campaign_id, at, level, message) VALUES (?, ?, ?, ?)').run(campaignId, at, level, String(message).slice(0, 2000));
export const listLog = (db, campaignId, limit = 200) => db.prepare('SELECT * FROM es_log WHERE campaign_id = ? OR campaign_id IS NULL ORDER BY id DESC LIMIT ?').all(campaignId, limit);

// ---------- the lock (one worker at a time) ----------
export function takeLock(db, { token, pid = process.pid, host = os.hostname(), at, staleMs }) {
  return tx(db, () => {
    const cur = db.prepare('SELECT * FROM es_lock WHERE id = 1').get();
    if (cur && cur.token !== token && Date.parse(at) - Date.parse(cur.heartbeat_at) < staleMs) return { ok: false, holder: { token: cur.token, pid: cur.pid, host: cur.host, heartbeatAt: cur.heartbeat_at } };
    db.prepare('INSERT INTO es_lock (id, token, pid, host, taken_at, heartbeat_at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, pid = excluded.pid, host = excluded.host, taken_at = excluded.taken_at, heartbeat_at = excluded.heartbeat_at').run(token, pid, host, at, at);
    return { ok: true, takenOver: cur && cur.token !== token ? { token: cur.token, heartbeatAt: cur.heartbeat_at } : null };
  });
}
export function beatLock(db, token, at) { return tx(db, () => db.prepare('UPDATE es_lock SET heartbeat_at = ? WHERE id = 1 AND token = ?').run(at, token).changes === 1); }
export function releaseLock(db, token) { return tx(db, () => db.prepare('DELETE FROM es_lock WHERE id = 1 AND token = ?').run(token).changes === 1); }
export const lockHolder = (db) => db.prepare('SELECT * FROM es_lock WHERE id = 1').get() || null;
