// Research runner results database (data/research-runner.sqlite). Its own file only: the guard refuses the
// portfolio, demo, Strategy Lab, HXR, range-trend, sweep-bos and ICT Lab databases, links to them, dangling links
// and any file holding tables that are not the runner's (rr_). The job queue lives here: experiments are claimed
// one at a time inside an immediate transaction, so two workers can never run the same experiment, and a
// (campaign, config hash) pair is unique, so a configuration is never queued twice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { RR_DB_NAME, EXPERIMENT_STATUSES, CAMPAIGN_STATUSES } from './config.js';

export const rrDbFile = (dataDir) => path.join(dataDir, RR_DB_NAME);

export function isRefusedName(name) {
  const n = String(name).toLowerCase();
  return n === 'signal-desk.sqlite' || n === 'demo.sqlite' || n.startsWith('strategy-lab') || n.startsWith('hxr') || n.startsWith('range-trend') || n.startsWith('sweep-bos') || n.startsWith('ict-lab');
}

export function guardRrFile(file) {
  const abs = path.resolve(file);
  const refuse = () => { throw new Error('The research runner never opens the portfolio, demo, Strategy Lab, HXR, range-trend, sweep-bos or ICT Lab databases'); };
  if (isRefusedName(path.basename(abs))) refuse();
  let real;
  if (fs.existsSync(abs)) real = fs.realpathSync(abs);
  else {
    let isLink = false;
    try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch { /* does not exist */ }
    if (isLink) throw new Error('The research runner refuses a database path that is a dangling symlink');
    real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  }
  if (isRefusedName(path.basename(real))) refuse();
  return real;
}

const SCHEMA = `
  CREATE TABLE rr_schema_version (version INTEGER NOT NULL);
  CREATE TABLE rr_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('planned','running','paused','cancelled','done','stopped')),
    doc_sha256 TEXT, code_revision TEXT NOT NULL, engine_version TEXT, period_json TEXT NOT NULL, limits_json TEXT NOT NULL, criteria_json TEXT NOT NULL,
    symbols_hash TEXT, data_hash TEXT, calibration_hash TEXT, baseline_file TEXT NOT NULL, baseline_experiment_id INTEGER, baseline_net REAL,
    stop_reason TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, elapsed_ms INTEGER NOT NULL DEFAULT 0, last_run_at TEXT,
    worker_pid INTEGER, worker_token TEXT, worker_host TEXT, heartbeat_at TEXT
  );
  CREATE TABLE rr_experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL REFERENCES rr_campaigns(id), stage INTEGER NOT NULL, ordinal INTEGER NOT NULL,
    name TEXT NOT NULL, hypothesis TEXT NOT NULL, parent_id INTEGER, base_file TEXT, change_json TEXT, config_hash TEXT NOT NULL, config_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')), attempts INTEGER NOT NULL DEFAULT 0,
    claimed_by TEXT, claimed_at TEXT, heartbeat_at TEXT, started_at TEXT, finished_at TEXT, duration_ms INTEGER,
    code_revision TEXT, engine_version TEXT, symbols_hash TEXT, data_hash TEXT, calibration_hash TEXT,
    metrics_json TEXT, summary_json TEXT, error TEXT, created_at TEXT NOT NULL,
    UNIQUE (campaign_id, config_hash)
  );
  CREATE INDEX rr_experiments_queue ON rr_experiments (campaign_id, status, stage, ordinal);
  CREATE TABLE rr_equity (experiment_id INTEGER NOT NULL REFERENCES rr_experiments(id), date TEXT NOT NULL, equity REAL NOT NULL, invested REAL NOT NULL, index_value REAL, PRIMARY KEY (experiment_id, date));
  CREATE TABLE rr_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL REFERENCES rr_campaigns(id), experiment_id INTEGER, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, seen_at TEXT
  );
  CREATE TABLE rr_events (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER, experiment_id INTEGER, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);
  CREATE TABLE rr_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, at TEXT NOT NULL);
  INSERT INTO rr_schema_version (version) VALUES (1);
`;

function migrate(db) {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rr_schema_version'").get();
  if (!has) db.exec(SCHEMA);
  // Migration 2 (2026-11-05): defect replacements (CAMPAIGN-3.md section 8), additive.
  const v = db.prepare('SELECT MAX(version) AS v FROM rr_schema_version').get().v;
  if (v < 2) {
    db.exec('ALTER TABLE rr_experiments ADD COLUMN replacement_of INTEGER; ALTER TABLE rr_experiments ADD COLUMN defect_json TEXT; INSERT INTO rr_schema_version (version) VALUES (2);');
  }
}

export function openRrDb(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const real = guardRrFile(file);
  if (fs.existsSync(real)) {
    const probe = new DatabaseSync(real, { readOnly: true });
    try {
      const foreign = probe.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all().map((r) => r.name).filter((n) => !/^rr_/i.test(n) && !/^sqlite_/i.test(n));
      if (foreign.length) throw new Error(`The research runner refuses ${path.basename(real)}: it holds tables that are not the runner's (${foreign.slice(0, 5).join(', ')})`);
    } finally { probe.close(); }
  }
  const db = new DatabaseSync(real);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

// An immediate transaction: the write lock is taken at BEGIN, so a claim or a status change never races.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
}

const j = (v) => (v == null ? null : JSON.stringify(v));
const pj = (s) => (s == null ? null : JSON.parse(s));

// ---------- campaigns ----------
export function insertCampaign(db, c) {
  const r = db.prepare(`INSERT INTO rr_campaigns (name, status, doc_sha256, code_revision, engine_version, period_json, limits_json, criteria_json, baseline_file, created_at)
    VALUES (?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.name, c.docSha256 ?? null, c.codeRevision, c.engineVersion ?? null, JSON.stringify(c.period), JSON.stringify(c.limits), JSON.stringify(c.criteria), c.baselineFile, c.at);
  return Number(r.lastInsertRowid);
}

export function getCampaign(db, id) {
  const r = db.prepare('SELECT * FROM rr_campaigns WHERE id = ?').get(id);
  return r ? campaignRow(r) : null;
}
export const listCampaigns = (db) => db.prepare('SELECT * FROM rr_campaigns ORDER BY id DESC').all().map(campaignRow);
function campaignRow(r) {
  return { ...r, period: pj(r.period_json), limits: pj(r.limits_json), criteria: pj(r.criteria_json) };
}
export function updateCampaign(db, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE rr_campaigns SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
}
export function setCampaignStatus(db, id, status, { reason = null, at } = {}) {
  if (!CAMPAIGN_STATUSES.includes(status)) throw new Error(`unknown campaign status ${status}`);
  const fields = { status };
  if (reason != null) fields.stop_reason = reason;
  if (status === 'running' && at) fields.started_at = db.prepare('SELECT started_at FROM rr_campaigns WHERE id = ?').get(id)?.started_at ?? at;
  if (['done', 'stopped', 'cancelled'].includes(status) && at) fields.finished_at = at;
  updateCampaign(db, id, fields);
}

// Worker ownership of a campaign: one worker at a time; a stale heartbeat (the process died) can be taken over.
export function claimWorker(db, campaignId, { pid, host = os.hostname(), at, staleMs }) {
  return tx(db, () => {
    const c = db.prepare('SELECT worker_pid, worker_token, heartbeat_at FROM rr_campaigns WHERE id = ?').get(campaignId);
    if (!c) throw new Error(`campaign ${campaignId} does not exist`);
    if (c.worker_token && c.heartbeat_at && Date.parse(at) - Date.parse(c.heartbeat_at) < staleMs) return null; // a live worker holds it
    const token = crypto.randomBytes(12).toString('hex');
    db.prepare('UPDATE rr_campaigns SET worker_pid = ?, worker_token = ?, worker_host = ?, heartbeat_at = ? WHERE id = ?').run(pid, token, host, at, campaignId);
    return { pid, token, host };
  });
}
export function heartbeat(db, campaignId, worker, at) {
  return Number(db.prepare('UPDATE rr_campaigns SET heartbeat_at = ? WHERE id = ? AND worker_token = ?').run(at, campaignId, worker.token).changes) === 1;
}
export function releaseWorker(db, campaignId, worker) {
  return Number(db.prepare('UPDATE rr_campaigns SET worker_pid = NULL, worker_token = NULL, heartbeat_at = NULL WHERE id = ? AND worker_token = ?').run(campaignId, worker.token).changes) === 1;
}
export function workerAlive(db, campaignId, { at, staleMs }) {
  const c = db.prepare('SELECT worker_pid, worker_token, heartbeat_at, worker_host FROM rr_campaigns WHERE id = ?').get(campaignId);
  if (!c?.worker_token || !c.heartbeat_at) return null;
  return Date.parse(at) - Date.parse(c.heartbeat_at) < staleMs ? { pid: c.worker_pid, host: c.worker_host, heartbeatAt: c.heartbeat_at } : null;
}

// ---------- experiments (the job queue) ----------
export function enqueue(db, campaignId, items, at) {
  // Duplicates by config hash are skipped, never re-queued: a configuration runs once per campaign.
  const ins = db.prepare(`INSERT OR IGNORE INTO rr_experiments (campaign_id, stage, ordinal, name, hypothesis, parent_id, base_file, change_json, config_hash, config_json, status, created_at, replacement_of, defect_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`);
  const nextOrd = db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM rr_experiments WHERE campaign_id = ?');
  return tx(db, () => {
    const added = [], skipped = [];
    for (const it of items) {
      const ord = nextOrd.get(campaignId).n;
      const r = ins.run(campaignId, it.stage, ord, it.name, it.hypothesis, it.parentId ?? null, it.baseFile ?? null, j(it.change ?? null), it.configHash, JSON.stringify(it.config), at, it.replacementOf ?? null, j(it.defect ?? null));
      if (Number(r.changes) === 1) added.push({ id: Number(r.lastInsertRowid), name: it.name }); else skipped.push(it.name);
    }
    return { added, skipped };
  });
}

// Claim the next queued experiment: one row, inside an immediate transaction, so concurrent workers never
// take the same one.
export function claimNext(db, campaignId, workerId, at) {
  return tx(db, () => {
    const row = db.prepare("SELECT id FROM rr_experiments WHERE campaign_id = ? AND status = 'queued' ORDER BY stage, ordinal, id LIMIT 1").get(campaignId);
    if (!row) return null;
    const r = db.prepare("UPDATE rr_experiments SET status = 'running', attempts = attempts + 1, claimed_by = ?, claimed_at = ?, heartbeat_at = ?, started_at = ? WHERE id = ? AND status = 'queued'").run(workerId, at, at, at, row.id);
    if (Number(r.changes) !== 1) return null;
    return getExperiment(db, row.id);
  });
}
export function experimentHeartbeat(db, id, at) { db.prepare('UPDATE rr_experiments SET heartbeat_at = ? WHERE id = ?').run(at, id); }
export function setParent(db, id, parentId) { db.prepare('UPDATE rr_experiments SET parent_id = ? WHERE id = ?').run(parentId, id); }
export const countReplacements = (db, campaignId) => db.prepare('SELECT COUNT(*) AS n FROM rr_experiments WHERE campaign_id = ? AND replacement_of IS NOT NULL').get(campaignId).n;

export function finishExperiment(db, id, { status, metrics = null, summary = null, error = null, at, durationMs = null, provenance = {} }) {
  if (!EXPERIMENT_STATUSES.includes(status)) throw new Error(`unknown experiment status ${status}`);
  db.prepare(`UPDATE rr_experiments SET status = ?, finished_at = ?, duration_ms = ?, metrics_json = ?, summary_json = ?, error = ?, code_revision = ?, engine_version = ?, symbols_hash = ?, data_hash = ?, calibration_hash = ? WHERE id = ?`)
    .run(status, at, durationMs, j(metrics), j(summary), error, provenance.codeRevision ?? null, provenance.engineVersion ?? null, provenance.symbolsHash ?? null, provenance.dataHash ?? null, provenance.calibrationHash ?? null, id);
}
export function updateSummary(db, id, summary) { db.prepare('UPDATE rr_experiments SET summary_json = ? WHERE id = ?').run(JSON.stringify(summary), id); }

// Interrupted experiments (left 'running' by a dead worker): re-queued once, then failed; their partial status
// is kept in rr_events.
export function recoverInterrupted(db, campaignId, { at, staleMs, maxAttempts = 2 }) {
  return tx(db, () => {
    const rows = db.prepare("SELECT id, attempts, heartbeat_at, name FROM rr_experiments WHERE campaign_id = ? AND status = 'running'").all(campaignId);
    const requeued = [], failed = [];
    for (const r of rows) {
      if (r.heartbeat_at && Date.parse(at) - Date.parse(r.heartbeat_at) < staleMs) continue; // a live worker is on it
      if (r.attempts < maxAttempts) { db.prepare("UPDATE rr_experiments SET status = 'queued', claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL WHERE id = ?").run(r.id); requeued.push(r.id); }
      else { db.prepare("UPDATE rr_experiments SET status = 'failed', error = 'interrupted twice: the worker stopped before the experiment finished', finished_at = ? WHERE id = ?").run(at, r.id); failed.push(r.id); }
    }
    return { requeued, failed };
  });
}
export function cancelQueued(db, campaignId, at) {
  return Number(db.prepare("UPDATE rr_experiments SET status = 'cancelled', finished_at = ?, error = 'cancelled with the campaign' WHERE campaign_id = ? AND status = 'queued'").run(at, campaignId).changes);
}

export function getExperiment(db, id) {
  const r = db.prepare('SELECT * FROM rr_experiments WHERE id = ?').get(id);
  return r ? experimentRow(r) : null;
}
function experimentRow(r) {
  return { ...r, config: pj(r.config_json), change: pj(r.change_json), metrics: pj(r.metrics_json), summary: pj(r.summary_json), defect: pj(r.defect_json) };
}
export function listExperiments(db, campaignId, { status = null, stage = null, limit = 500, offset = 0, withMetrics = false } = {}) {
  const cols = withMetrics ? '*' : 'id, campaign_id, stage, ordinal, name, hypothesis, parent_id, base_file, change_json, config_hash, status, attempts, started_at, finished_at, duration_ms, code_revision, engine_version, data_hash, summary_json, error, created_at, replacement_of, defect_json';
  const where = ['campaign_id = ?'], args = [campaignId];
  if (status) { where.push('status = ?'); args.push(status); }
  if (stage != null) { where.push('stage = ?'); args.push(stage); }
  return db.prepare(`SELECT ${cols} FROM rr_experiments WHERE ${where.join(' AND ')} ORDER BY stage, ordinal, id LIMIT ? OFFSET ?`).all(...args, limit, offset).map((r) => ({ ...r, change: pj(r.change_json), summary: pj(r.summary_json), defect: pj(r.defect_json), ...(withMetrics ? { config: pj(r.config_json), metrics: pj(r.metrics_json) } : {}) }));
}
export function countExperiments(db, campaignId) {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM rr_experiments WHERE campaign_id = ? GROUP BY status').all(campaignId);
  const out = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, total: 0 };
  for (const r of rows) { out[r.status] = r.n; out.total += r.n; }
  return out;
}
export const findByHash = (db, campaignId, hash) => { const r = db.prepare('SELECT id FROM rr_experiments WHERE campaign_id = ? AND config_hash = ?').get(campaignId, hash); return r ? r.id : null; };

export function insertEquity(db, experimentId, points) {
  const st = db.prepare('INSERT OR REPLACE INTO rr_equity (experiment_id, date, equity, invested, index_value) VALUES (?, ?, ?, ?, ?)');
  tx(db, () => { for (const p of points) st.run(experimentId, p.date, p.equity, p.invested, p.indexValue ?? null); });
}
export const getEquity = (db, experimentId) => db.prepare('SELECT date, equity, invested, index_value AS indexValue FROM rr_equity WHERE experiment_id = ? ORDER BY date').all(experimentId);

// ---------- notifications and events ----------
export function insertNotification(db, n) {
  const r = db.prepare('INSERT OR IGNORE INTO rr_notifications (campaign_id, experiment_id, kind, title, body, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(n.campaignId, n.experimentId ?? null, n.kind, n.title, n.body, n.dedupeKey, n.at);
  return Number(r.changes) === 1 ? Number(r.lastInsertRowid) : null;
}
export const listNotifications = (db, { campaignId = null, unseenOnly = false, limit = 100 } = {}) => {
  const where = [], args = [];
  if (campaignId != null) { where.push('campaign_id = ?'); args.push(campaignId); }
  if (unseenOnly) where.push('seen_at IS NULL');
  return db.prepare(`SELECT * FROM rr_notifications ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit);
};
export const markSeen = (db, ids, at) => { const st = db.prepare('UPDATE rr_notifications SET seen_at = COALESCE(seen_at, ?) WHERE id = ?'); let n = 0; for (const id of ids) n += Number(st.run(at, id).changes); return n; };
export function logEvent(db, { campaignId = null, experimentId = null, level = 'info', message, at }) {
  db.prepare('INSERT INTO rr_events (campaign_id, experiment_id, at, level, message) VALUES (?, ?, ?, ?, ?)').run(campaignId, experimentId, at, level, String(message).slice(0, 2000));
}
export const listEvents = (db, campaignId, limit = 200) => db.prepare('SELECT * FROM rr_events WHERE campaign_id = ? OR campaign_id IS NULL ORDER BY id DESC LIMIT ?').all(campaignId, limit);
export const getSetting = (db, key) => { const r = db.prepare('SELECT value_json FROM rr_settings WHERE key = ?').get(key); return r ? JSON.parse(r.value_json) : null; };
export const setSetting = (db, key, value, at) => db.prepare('INSERT INTO rr_settings (key, value_json, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, at = excluded.at').run(key, JSON.stringify(value), at);
