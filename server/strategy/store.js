// Strategy Lab database (strategy/LAB-ARCHITECTURE.md). Separate files from
// the portfolio: data/strategy-lab.sqlite for the real workspace and
// data/strategy-lab-demo.sqlite (synthetic data only) for the demo. Nothing
// here opens signal-desk.sqlite or demo.sqlite, reads real holdings or cash,
// or places anything anywhere. Schema changes are new, additive migrations.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  // 1: lab schema
  `
  CREATE TABLE lab_bars (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,          -- 15min
    t TEXT NOT NULL,                 -- bar start, UTC ISO
    o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL,
    source TEXT NOT NULL,            -- csv | twelvedata | synthetic | ...
    synthetic INTEGER NOT NULL DEFAULT 0,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, interval, t)
  ) WITHOUT ROWID;

  CREATE TABLE lab_runs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,              -- backtest | stress | walk_forward | holdout | forward
    mode TEXT NOT NULL,              -- intraday | swing
    split TEXT,
    version TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    config_json TEXT NOT NULL,
    data_hash TEXT,
    "from" TEXT, "to" TEXT,
    symbols_json TEXT,
    options_json TEXT,
    metrics_json TEXT,
    acceptance_json TEXT,
    report_md TEXT,
    synthetic INTEGER NOT NULL DEFAULT 0,
    contaminated INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'done', -- running | done | failed
    label TEXT,
    details_json TEXT,               -- coverage, buy-and-hold, stress tests, folds, holdout variants
    equity_json TEXT,                -- downsampled daily equity of a backtest
    error TEXT,
    finished_at TEXT
  );
  CREATE INDEX lab_runs_kind ON lab_runs(kind, mode, id);

  CREATE TABLE lab_trades (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES lab_runs(id) ON DELETE CASCADE,
    trade_id TEXT NOT NULL,          -- the engine's id: mode-symbol-signal bar
    symbol TEXT NOT NULL,
    entry_at TEXT, exit_at TEXT,
    r REAL, net REAL,
    trade_json TEXT NOT NULL,
    UNIQUE (run_id, trade_id)
  );
  CREATE INDEX lab_trades_symbol ON lab_trades(symbol, entry_at);

  CREATE TABLE lab_events (
    id INTEGER PRIMARY KEY,
    run_id INTEGER REFERENCES lab_runs(id) ON DELETE CASCADE,
    source TEXT NOT NULL,            -- backtest | forward | tradingview
    at TEXT NOT NULL,
    symbol TEXT,
    type TEXT NOT NULL,
    reason TEXT,
    details_json TEXT
  );
  CREATE INDEX lab_events_run ON lab_events(run_id, symbol, at);
  CREATE INDEX lab_events_source ON lab_events(source, id);

  CREATE TABLE lab_equity (
    run_id INTEGER NOT NULL REFERENCES lab_runs(id) ON DELETE CASCADE,
    t TEXT NOT NULL,
    equity REAL, cash REAL, positions INTEGER, open_risk REAL,
    PRIMARY KEY (run_id, t)
  );

  CREATE TABLE lab_forward (
    mode TEXT PRIMARY KEY,
    run_id INTEGER,
    version TEXT,
    config_hash TEXT,
    started_at TEXT,
    stopped_at TEXT,
    processed_through TEXT,
    state_json TEXT,
    status TEXT NOT NULL,            -- running | stopped | error | replay
    last_error TEXT
  );

  -- The webhook secret is never stored.
  CREATE TABLE lab_webhook_alerts (
    id INTEGER PRIMARY KEY,
    received_at TEXT NOT NULL,
    dedupe_key TEXT UNIQUE,          -- set on accepted alerts only
    status TEXT NOT NULL,            -- accepted | duplicate | rejected | error
    reason TEXT,
    symbol TEXT,
    event TEXT,
    bar_time TEXT,
    payload_json TEXT
  );

  CREATE TABLE lab_holdout_runs (
    id INTEGER PRIMARY KEY,
    version TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    mode TEXT NOT NULL,
    run_id INTEGER,
    at TEXT NOT NULL,
    reason TEXT,
    contaminated INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE lab_param_changes (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    from_version TEXT,
    to_version TEXT NOT NULL,
    path TEXT NOT NULL,
    from_value TEXT,
    to_value TEXT,
    reason TEXT,
    data_seen TEXT
  );

  CREATE TABLE lab_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
  `,
];

// The portfolio databases (server/context.js dbFileFor) are never opened here.
const PORTFOLIO_FILES = new Set(['signal-desk.sqlite', 'demo.sqlite']);

export function labDbFile(cfg, workspace) {
  return path.join(cfg.dataDir, workspace === 'demo' ? 'strategy-lab-demo.sqlite' : 'strategy-lab.sqlite');
}

export function openLabDb(file, { readOnly = false } = {}) {
  if (PORTFOLIO_FILES.has(path.basename(file))) throw new Error('The Strategy Lab never opens the portfolio database');
  if (!readOnly) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
  db.exec('PRAGMA busy_timeout = 5000;');
  if (readOnly) return db;
  // NORMAL is safe in WAL mode; a lost last commit only means that bar time is processed again.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function schemaVersion(db) {
  return db.prepare('SELECT version FROM lab_schema_version').get()?.version ?? 0;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS lab_schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM lab_schema_version').get();
  let v = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO lab_schema_version (version) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      // Another connection (a worker) may have migrated meanwhile.
      v = db.prepare('SELECT version FROM lab_schema_version').get().version;
      if (v < MIGRATIONS.length) {
        db.exec(MIGRATIONS[v]);
        v += 1;
        db.prepare('UPDATE lab_schema_version SET version = ?').run(v);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export const MIGRATION_COUNT = MIGRATIONS.length;

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const json = (v) => (v === undefined ? null : JSON.stringify(v));
const parse = (s, d = null) => (s == null ? d : JSON.parse(s));
const nowIso = () => new Date().toISOString();

// ---------- settings ----------

export function getSetting(db, key, fallback = null) {
  const r = db.prepare('SELECT value_json FROM lab_settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value_json) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO lab_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').run(key, JSON.stringify(value));
  return value;
}

// ---------- bars ----------

// bars: [{ t, o, h, l, c, v }] already normalised to regular-session 15-minute
// bars. Existing bars at the same time are replaced. Returns { inserted, replaced }.
export function upsertBars(db, symbol, bars, { interval = '15min', source, synthetic = false, fetchedAt = nowIso() } = {}) {
  if (!source) throw new Error('upsertBars needs a source');
  const count = db.prepare('SELECT COUNT(*) n FROM lab_bars WHERE symbol = ? AND interval = ?');
  const put = db.prepare(`INSERT INTO lab_bars (symbol, interval, t, o, h, l, c, v, source, synthetic, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(symbol, interval, t) DO UPDATE SET o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v,
      source = excluded.source, synthetic = excluded.synthetic, fetched_at = excluded.fetched_at`);
  barWrites.set(db, (barWrites.get(db) || 0) + 1);
  return tx(db, () => {
    const before = count.get(symbol, interval).n;
    const seen = new Set();
    for (const b of bars) {
      const t = new Date(typeof b.t === 'number' ? b.t : Date.parse(b.t)).toISOString();
      seen.add(t);
      put.run(symbol, interval, t, b.o, b.h, b.l, b.c, b.v ?? null, source, synthetic ? 1 : 0, fetchedAt);
    }
    const inserted = count.get(symbol, interval).n - before;
    return { inserted, replaced: seen.size - inserted };
  });
}

const barRow = (r) => ({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });

// from/to: UTC ISO instants (inclusive); either may be null.
export function getBars(db, symbol, { from = null, to = null, interval = '15min', limit = null, last = false } = {}) {
  const where = ['symbol = ?', 'interval = ?'];
  const args = [symbol, interval];
  if (from) { where.push('t >= ?'); args.push(from); }
  if (to) { where.push('t <= ?'); args.push(to); }
  const lim = limit ? ` LIMIT ${Math.max(1, Math.floor(limit))}` : '';
  const rows = db.prepare(`SELECT t, o, h, l, c, v, synthetic FROM lab_bars WHERE ${where.join(' AND ')} ORDER BY t ${last ? 'DESC' : 'ASC'}${lim}`).all(...args);
  if (last) rows.reverse();
  const out = rows.map(barRow);
  if (rows.some((r) => r.synthetic)) out.synthetic = true;
  return out;
}

// Map<symbol, Bar[]>; a symbol without bars is left out. Synthetic bars mark
// the arrays and the map so the engine and reports flag the results.
export function barsBySymbol(db, symbols, { from = null, to = null } = {}) {
  const out = new Map();
  for (const s of symbols) {
    const list = getBars(db, s, { from, to });
    if (list.length) out.set(s, list);
    if (list.synthetic) out.synthetic = true;
  }
  return out;
}

// Coverage scans every bar, so it is cached until this connection writes bars
// (or for maxAgeMs, for writes made by another connection such as a worker).
const coverageCache = new WeakMap();
const barWrites = new WeakMap();

export function barCoverage(db, { maxAgeMs = 30000 } = {}) {
  const version = barWrites.get(db) || 0;
  const hit = coverageCache.get(db);
  if (hit && hit.version === version && Date.now() - hit.at < maxAgeMs) return hit.rows;
  const rows = db.prepare(`SELECT symbol, COUNT(*) AS bars, MIN(t) AS first, MAX(t) AS last, MAX(synthetic) AS synthetic,
      GROUP_CONCAT(DISTINCT source) AS sources, MAX(fetched_at) AS updated_at
    FROM lab_bars WHERE interval = '15min' GROUP BY symbol ORDER BY symbol`).all()
    .map((r) => Object.freeze({ ...r, synthetic: !!r.synthetic, sources: Object.freeze(r.sources ? r.sources.split(',') : []) }));
  coverageCache.set(db, { version, at: Date.now(), rows });
  return rows;
}

export function invalidateCoverage(db) {
  coverageCache.delete(db);
}

export function lastBarTime(db, symbol) {
  return db.prepare("SELECT MAX(t) AS t FROM lab_bars WHERE symbol = ? AND interval = '15min'").get(symbol)?.t ?? null;
}

export function hasSyntheticBars(db) {
  return !!db.prepare('SELECT 1 FROM lab_bars WHERE synthetic = 1 LIMIT 1').get();
}

// ---------- runs ----------

export function createRun(db, r) {
  const res = db.prepare(`INSERT INTO lab_runs (kind, mode, split, version, config_hash, config_json, data_hash, "from", "to", symbols_json, options_json,
      synthetic, contaminated, reason, created_at, status, label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    r.kind, r.mode, r.split ?? null, r.version, r.configHash, typeof r.config === 'string' ? r.config : JSON.stringify(r.config),
    r.dataHash ?? null, r.from ?? null, r.to ?? null, json(r.symbols), json(r.options), r.synthetic ? 1 : 0, r.contaminated ? 1 : 0,
    r.reason ?? null, r.createdAt || nowIso(), r.status || 'running', r.label ?? null);
  return Number(res.lastInsertRowid);
}

const RUN_FIELDS = {
  dataHash: 'data_hash', from: '"from"', to: '"to"', symbols: 'symbols_json', options: 'options_json', metrics: 'metrics_json',
  acceptance: 'acceptance_json', report: 'report_md', synthetic: 'synthetic', contaminated: 'contaminated', reason: 'reason',
  status: 'status', label: 'label', details: 'details_json', equity: 'equity_json', error: 'error', finishedAt: 'finished_at',
};
const RUN_JSON = new Set(['symbols', 'options', 'metrics', 'acceptance', 'details', 'equity']);

export function updateRun(db, id, patch) {
  const sets = [], args = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = RUN_FIELDS[k];
    if (!col || v === undefined) continue;
    sets.push(`${col} = ?`);
    args.push(RUN_JSON.has(k) ? json(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  if (sets.length) db.prepare(`UPDATE lab_runs SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
}

export function runFromRow(r, { full = false } = {}) {
  if (!r) return null;
  const out = {
    id: r.id, kind: r.kind, mode: r.mode, split: r.split, version: r.version, configHash: r.config_hash, dataHash: r.data_hash,
    from: r.from, to: r.to, symbols: parse(r.symbols_json, []), options: parse(r.options_json, {}),
    synthetic: !!r.synthetic, contaminated: !!r.contaminated, reason: r.reason, status: r.status, label: r.label, error: r.error,
    createdAt: r.created_at, finishedAt: r.finished_at,
  };
  if (r.metrics_json !== undefined) out.metrics = parse(r.metrics_json);
  if (full) {
    out.config = parse(r.config_json);
    out.acceptance = parse(r.acceptance_json);
    out.report = r.report_md;
    out.details = parse(r.details_json);
    out.equity = parse(r.equity_json, []);
  }
  return out;
}

export function getRun(db, id, { full = true } = {}) {
  return runFromRow(db.prepare('SELECT * FROM lab_runs WHERE id = ?').get(id), { full });
}

export function listRuns(db, { kind = null, mode = null, split = null, status = null, configHash = null, limit = 50 } = {}) {
  const where = [], args = [];
  for (const [col, v] of [['kind', kind], ['mode', mode], ['split', split], ['status', status], ['config_hash', configHash]]) {
    if (v != null) { where.push(`${col} = ?`); args.push(v); }
  }
  return db.prepare(`SELECT id, kind, mode, split, version, config_hash, data_hash, "from", "to", symbols_json, options_json, metrics_json, synthetic,
      contaminated, reason, created_at, status, label, error, finished_at FROM lab_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT ?`).all(...args, Math.max(1, Math.min(Number(limit) || 50, 500))).map((r) => runFromRow(r));
}

// Runs left 'running' by a closed app are marked failed (never shown as results).
export function failInterruptedRuns(db) {
  return Number(db.prepare("UPDATE lab_runs SET status = 'failed', error = 'Interrupted (the app was closed while it ran)', finished_at = ? WHERE status = 'running' AND kind != 'forward'").run(nowIso()).changes);
}

// ---------- trades, events, equity ----------

// Returns { inserted, duplicates }: a trade id already stored for the run is
// never stored twice.
export function insertTrades(db, runId, trades) {
  const st = db.prepare('INSERT INTO lab_trades (run_id, trade_id, symbol, entry_at, exit_at, r, net, trade_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(run_id, trade_id) DO NOTHING');
  let inserted = 0, duplicates = 0;
  for (const t of trades) {
    const r = st.run(runId, t.id, t.symbol, t.entry?.at ?? null, t.exit?.at ?? null, t.pnl?.r ?? null, t.pnl?.net ?? null, JSON.stringify(t));
    if (r.changes) inserted++; else duplicates++;
  }
  return { inserted, duplicates };
}

const tradeFromRow = (r) => (r ? { rowId: r.id, runId: r.run_id, kind: r.kind ?? null, runMode: r.mode ?? null, trade: JSON.parse(r.trade_json) } : null);

export function getTrade(db, id) {
  return tradeFromRow(db.prepare('SELECT t.*, r.kind, r.mode FROM lab_trades t JOIN lab_runs r ON r.id = t.run_id WHERE t.id = ?').get(id));
}

export function listTrades(db, { runId = null, kinds = null, mode = null, symbol = null, limit = 100, offset = 0 } = {}) {
  const where = [], args = [];
  if (runId != null) { where.push('t.run_id = ?'); args.push(runId); }
  if (kinds?.length) { where.push(`r.kind IN (${kinds.map(() => '?').join(',')})`); args.push(...kinds); }
  if (mode) { where.push('r.mode = ?'); args.push(mode); }
  if (symbol) { where.push('t.symbol = ?'); args.push(symbol); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM lab_trades t JOIN lab_runs r ON r.id = t.run_id ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT t.*, r.kind, r.mode FROM lab_trades t JOIN lab_runs r ON r.id = t.run_id ${w} ORDER BY t.entry_at DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);
  return { total, rows: rows.map(tradeFromRow) };
}

export function runTrades(db, runId) {
  return db.prepare('SELECT trade_json FROM lab_trades WHERE run_id = ? ORDER BY entry_at, id').all(runId).map((r) => JSON.parse(r.trade_json));
}

// Box parameters repeat the run's config in every event; they are stored once
// (in the run) and put back on read.
function slimDetails(d) {
  if (!d?.box?.params) return d;
  const { params: _p, ...box } = d.box;
  return { ...d, box };
}

export function insertEvents(db, runId, source, events) {
  const st = db.prepare('INSERT INTO lab_events (run_id, source, at, symbol, type, reason, details_json) VALUES (?,?,?,?,?,?,?)');
  for (const e of events) st.run(runId, source, e.at, e.symbol ?? null, e.type, e.reason ?? null, json(slimDetails(e.details ?? {})));
  return events.length;
}

export function eventFromRow(r, boxParams = null) {
  const details = parse(r.details_json, {});
  if (boxParams && details?.box && !details.box.params) details.box.params = boxParams;
  return { id: r.id, runId: r.run_id, source: r.source, at: r.at, symbol: r.symbol, type: r.type, reason: r.reason, details };
}

export function listEvents(db, { runId = null, runIds = null, source = null, types = null, symbol = null, from = null, to = null, limit = 100, order = 'DESC' } = {}) {
  const where = [], args = [];
  if (runId != null) { where.push('run_id = ?'); args.push(runId); }
  if (runIds?.length) { where.push(`run_id IN (${runIds.map(() => '?').join(',')})`); args.push(...runIds); }
  if (source) { where.push('source = ?'); args.push(source); }
  if (types?.length) { where.push(`type IN (${types.map(() => '?').join(',')})`); args.push(...types); }
  if (symbol) { where.push('symbol = ?'); args.push(symbol); }
  if (from) { where.push('at >= ?'); args.push(from); }
  if (to) { where.push('at <= ?'); args.push(to); }
  return db.prepare(`SELECT * FROM lab_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at ${order === 'ASC' ? 'ASC' : 'DESC'}, id ${order === 'ASC' ? 'ASC' : 'DESC'} LIMIT ?`)
    .all(...args, limit);
}

export function countEvents(db, runId, type, code = null) {
  if (code == null) return db.prepare('SELECT COUNT(*) n FROM lab_events WHERE run_id = ? AND type = ?').get(runId, type).n;
  return db.prepare("SELECT COUNT(*) n FROM lab_events WHERE run_id = ? AND type = ? AND json_extract(details_json, '$.code') = ?").get(runId, type, code).n;
}

export function insertEquity(db, runId, points) {
  const st = db.prepare('INSERT OR REPLACE INTO lab_equity (run_id, t, equity, cash, positions, open_risk) VALUES (?,?,?,?,?,?)');
  for (const p of points) st.run(runId, p.t, p.equity ?? null, p.cash ?? null, p.positions ?? null, p.openRisk ?? null);
}

export function listEquity(db, runId) {
  return db.prepare('SELECT t, equity, cash, positions, open_risk AS openRisk FROM lab_equity WHERE run_id = ? ORDER BY t').all(runId);
}

// ---------- forward ----------

export function getForward(db, mode) {
  const r = db.prepare('SELECT * FROM lab_forward WHERE mode = ?').get(mode);
  return r ? {
    mode: r.mode, runId: r.run_id, version: r.version, configHash: r.config_hash, startedAt: r.started_at, stoppedAt: r.stopped_at,
    processedThrough: r.processed_through, state: parse(r.state_json), status: r.status, lastError: r.last_error,
  } : null;
}

export function saveForward(db, mode, f) {
  db.prepare(`INSERT INTO lab_forward (mode, run_id, version, config_hash, started_at, stopped_at, processed_through, state_json, status, last_error)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(mode) DO UPDATE SET run_id = excluded.run_id, version = excluded.version, config_hash = excluded.config_hash,
    started_at = excluded.started_at, stopped_at = excluded.stopped_at, processed_through = excluded.processed_through, state_json = excluded.state_json,
    status = excluded.status, last_error = excluded.last_error`).run(
    mode, f.runId ?? null, f.version ?? null, f.configHash ?? null, f.startedAt ?? null, f.stoppedAt ?? null, f.processedThrough ?? null,
    f.state == null ? null : typeof f.state === 'string' ? f.state : JSON.stringify(f.state), f.status, f.lastError ?? null);
}

export function forwardRows(db) {
  return db.prepare('SELECT mode FROM lab_forward ORDER BY mode').all().map((r) => getForward(db, r.mode));
}

// ---------- holdout ledger ----------

// The ledger validation.runHoldout expects: { count(version, configHash, mode), record(entry) }.
// Entries are never deleted; a crashed run is never recorded (runHoldout
// records only after its runs finish).
export function holdoutLedger(db, runId = null) {
  return {
    count: (version, configHash, mode) => db.prepare('SELECT COUNT(*) n FROM lab_holdout_runs WHERE version = ? AND config_hash = ? AND mode = ?').get(version, configHash, mode).n,
    record: (e) => {
      db.prepare('INSERT INTO lab_holdout_runs (version, config_hash, mode, run_id, at, reason, contaminated) VALUES (?,?,?,?,?,?,?)')
        .run(e.version, e.configHash, e.mode, runId, e.at, e.reason ?? null, e.contaminated ? 1 : 0);
      return e;
    },
  };
}

export function listHoldoutRuns(db) {
  return db.prepare('SELECT * FROM lab_holdout_runs ORDER BY id').all().map((r) => ({ ...r, contaminated: !!r.contaminated }));
}

// ---------- parameter changes ----------

export function insertParamChange(db, c) {
  db.prepare('INSERT INTO lab_param_changes (at, from_version, to_version, path, from_value, to_value, reason, data_seen) VALUES (?,?,?,?,?,?,?,?)')
    .run(c.at || nowIso(), c.fromVersion ?? null, c.toVersion, c.path, json(c.from), json(c.to), c.reason ?? null, c.dataSeen ?? null);
}

export function listParamChanges(db) {
  return db.prepare('SELECT * FROM lab_param_changes ORDER BY id').all().map((r) => ({
    id: r.id, at: r.at, fromVersion: r.from_version, toVersion: r.to_version, path: r.path,
    from: parse(r.from_value), to: parse(r.to_value), reason: r.reason, dataSeen: r.data_seen,
  }));
}

// ---------- TradingView alerts ----------

// Accepted alerts carry the dedupe key; a repeat is stored with status
// 'duplicate' and no key. TradingView's order ids differ between the chart and
// the alert's server-side copy, so the same strategy, version, mode, symbol,
// event and bar time is a duplicate whatever the order id. Returns { id, status }.
export function insertAlert(db, a) {
  const put = (status, key, reason = a.reason) => Number(db.prepare(`INSERT INTO lab_webhook_alerts (received_at, dedupe_key, status, reason, symbol, event, bar_time, payload_json)
    VALUES (?,?,?,?,?,?,?,?)`).run(a.receivedAt, key, status, reason ?? null, a.symbol ?? null, a.event ?? null, a.barTime ?? null, json(a.payload ?? null)).lastInsertRowid);
  if (a.status !== 'accepted') return { id: put(a.status, null), status: a.status };
  const same = db.prepare('SELECT id FROM lab_webhook_alerts WHERE dedupe_key = ?').get(a.dedupeKey)
    || db.prepare(`SELECT id FROM lab_webhook_alerts WHERE status = 'accepted' AND symbol = ? AND event = ? AND bar_time = ?
      AND json_extract(payload_json, '$.mode') IS ? AND json_extract(payload_json, '$.strategy') IS ? AND json_extract(payload_json, '$.version') IS ?`)
      .get(a.symbol ?? null, a.event ?? null, a.barTime ?? null, a.payload?.mode ?? null, a.payload?.strategy ?? null, a.payload?.version ?? null);
  if (same) return { id: put('duplicate', null, `same alert as #${same.id}`), status: 'duplicate' };
  return { id: put('accepted', a.dedupeKey), status: 'accepted' };
}

export function listAlerts(db, { status = null, symbol = null, limit = 100 } = {}) {
  const where = [], args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (symbol) { where.push('symbol = ?'); args.push(symbol); }
  return db.prepare(`SELECT * FROM lab_webhook_alerts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit)
    .map((r) => ({ id: r.id, receivedAt: r.received_at, status: r.status, reason: r.reason, symbol: r.symbol, event: r.event, barTime: r.bar_time, dedupeKey: r.dedupe_key, payload: parse(r.payload_json) }));
}

// ---------- backup ----------

// Consistent copy of a lab database (VACUUM INTO) without running migrations.
export function backupLabDb(file, dest) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  return dest;
}
