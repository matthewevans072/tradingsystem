// HXR simulation database, data/hxr-sim.sqlite (strategy/hxr/ENGINE-SPEC.md
// section 8). A separate file from the portfolio and the Strategy Lab:
// openHxrDb refuses signal-desk.sqlite, demo.sqlite and strategy-lab*, by name
// after resolving symlinks, and any file that already holds a table that is
// not HXR's. Schema changes are new, additive migrations; nothing here reads
// real holdings or cash, or sends anything anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  // 1: HXR schema
  `
  CREATE TABLE hxr_bars (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,              -- session date, America/New_York
    o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
    v REAL, n INTEGER, vw REAL,
    source TEXT NOT NULL DEFAULT 'alpaca',
    feed TEXT NOT NULL DEFAULT 'sip',
    adjustment TEXT NOT NULL DEFAULT 'raw',
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, date)
  ) WITHOUT ROWID;

  -- The 09:30-09:45 ET bar of each session.
  CREATE TABLE hxr_first15 (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    o REAL, h REAL, l REAL, c REAL, v REAL, vw REAL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, date)
  ) WITHOUT ROWID;

  CREATE TABLE hxr_corporate_actions (
    id TEXT PRIMARY KEY,             -- Alpaca id
    type TEXT NOT NULL,              -- forward_split | reverse_split | cash_dividend | stock_dividend | name_change | cash_merger | stock_merger | spin_off
    symbol TEXT,
    cusip TEXT,
    ex_date TEXT, pay_date TEXT, process_date TEXT,
    ratio_old REAL, ratio_new REAL, rate REAL,
    old_symbol TEXT, new_symbol TEXT,
    raw_json TEXT,
    fetched_at TEXT NOT NULL
  );
  CREATE INDEX hxr_corporate_actions_symbol ON hxr_corporate_actions(symbol, type, ex_date);

  CREATE TABLE hxr_spread_samples (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    quotes INTEGER NOT NULL,         -- quotes used
    dropped INTEGER,                 -- quotes dropped (bid <= 0, ask <= bid, spread over 5% of mid)
    median_spread_bps REAL,          -- NULL when no quote was usable
    median_half_spread_bps REAL,
    "window" TEXT,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, date)
  ) WITHOUT ROWID;

  CREATE TABLE hxr_news (
    id TEXT PRIMARY KEY,             -- Alpaca id
    created_at TEXT NOT NULL,
    updated_at TEXT,
    headline TEXT, summary TEXT, source TEXT, url TEXT,
    symbols_json TEXT,
    first_seen_at TEXT NOT NULL,     -- when Signal Desk first stored it; never changed
    backfilled INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX hxr_news_created ON hxr_news(created_at);
  CREATE TABLE hxr_news_symbols (
    news_id TEXT NOT NULL REFERENCES hxr_news(id),
    symbol TEXT NOT NULL,
    PRIMARY KEY (symbol, news_id)
  ) WITHOUT ROWID;

  CREATE TABLE hxr_versions (
    version TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    based_on TEXT,
    frozen_at TEXT NOT NULL,
    prereg TEXT NOT NULL
  );

  CREATE TABLE hxr_runs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('selection', 'evaluation', 'variant', 'prospective')),
    label TEXT,
    version TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    config_json TEXT,
    basket TEXT,
    symbols_json TEXT,
    period_json TEXT,
    fill_model TEXT,
    delay INTEGER,
    data_hash TEXT,
    calibration_hash TEXT,
    status TEXT NOT NULL DEFAULT 'running',   -- running | done | failed
    contaminated INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    metrics_json TEXT,
    details_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX hxr_runs_kind ON hxr_runs(kind, id);

  CREATE TABLE hxr_fills (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES hxr_runs(id) ON DELETE CASCADE,
    item_id TEXT,
    date TEXT, symbol TEXT, side TEXT, shares REAL, price REAL,
    detail_json TEXT NOT NULL,
    UNIQUE (run_id, item_id)
  );
  CREATE INDEX hxr_fills_run ON hxr_fills(run_id, date, id);
  CREATE TABLE hxr_decisions (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES hxr_runs(id) ON DELETE CASCADE,
    item_id TEXT,
    date TEXT, symbol TEXT, action TEXT,
    detail_json TEXT NOT NULL,
    UNIQUE (run_id, item_id)
  );
  CREATE INDEX hxr_decisions_run ON hxr_decisions(run_id, date, id);
  CREATE TABLE hxr_episodes (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES hxr_runs(id) ON DELETE CASCADE,
    item_id TEXT,
    symbol TEXT, start_date TEXT, end_date TEXT, pnl REAL,
    detail_json TEXT NOT NULL,
    UNIQUE (run_id, item_id)
  );
  CREATE INDEX hxr_episodes_run ON hxr_episodes(run_id, start_date, id);
  CREATE TABLE hxr_equity (
    run_id INTEGER NOT NULL REFERENCES hxr_runs(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    equity REAL, cash REAL, invested REAL, sleeves_out INTEGER, receivable REAL,
    detail_json TEXT,
    PRIMARY KEY (run_id, date)
  ) WITHOUT ROWID;

  -- One row per selection or evaluation event; never changed or deleted.
  CREATE TABLE hxr_ledger (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('selection', 'evaluation')),
    prereg TEXT NOT NULL,
    version TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    run_ids_json TEXT,
    contaminated INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    at TEXT NOT NULL
  );
  CREATE TRIGGER hxr_ledger_no_update BEFORE UPDATE ON hxr_ledger BEGIN SELECT RAISE(ABORT, 'hxr_ledger is append-only'); END;
  CREATE TRIGGER hxr_ledger_no_delete BEFORE DELETE ON hxr_ledger BEGIN SELECT RAISE(ABORT, 'hxr_ledger is append-only'); END;

  CREATE TABLE hxr_experiments (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    what TEXT NOT NULL,
    version TEXT,
    data_touched TEXT,
    results_seen TEXT,
    note TEXT
  );
  CREATE TRIGGER hxr_experiments_no_update BEFORE UPDATE ON hxr_experiments BEGIN SELECT RAISE(ABORT, 'hxr_experiments is append-only'); END;
  CREATE TRIGGER hxr_experiments_no_delete BEFORE DELETE ON hxr_experiments BEGIN SELECT RAISE(ABORT, 'hxr_experiments is append-only'); END;
  -- A frozen version is never changed or removed.
  CREATE TRIGGER hxr_versions_no_update BEFORE UPDATE ON hxr_versions BEGIN SELECT RAISE(ABORT, 'a frozen HXR version cannot be changed'); END;
  CREATE TRIGGER hxr_versions_no_delete BEFORE DELETE ON hxr_versions BEGIN SELECT RAISE(ABORT, 'a frozen HXR version cannot be removed'); END;

  -- The one prospective account.
  CREATE TABLE hxr_prospective (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    started_at TEXT NOT NULL,
    start_date TEXT NOT NULL,
    symbols_json TEXT NOT NULL,
    state_json TEXT,
    last_processed TEXT,
    status TEXT NOT NULL
  );
  CREATE TABLE hxr_prospective_events (
    id INTEGER PRIMARY KEY,
    event_key TEXT UNIQUE,           -- dedupe: the same event is never stored twice
    kind TEXT NOT NULL,              -- decision | fill | dividend | split | warning | news | equity | ...
    arm TEXT,                        -- hxr | hold
    date TEXT,                       -- session date
    symbol TEXT,
    recorded_at TEXT NOT NULL,
    on_time INTEGER,
    detail_json TEXT
  );
  CREATE INDEX hxr_prospective_events_date ON hxr_prospective_events(date, id);

  CREATE TABLE hxr_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
  `,
];

// 2: the validation gate (hxr-prereg-3a): 'validation' joins the run and
// ledger kinds. A CHECK constraint cannot be altered, so both tables are
// rebuilt; foreignKeysOff keeps the DROP from cascading into the child rows.
MIGRATIONS.push({
  foreignKeysOff: true,
  sql: `
  CREATE TABLE hxr_runs_v2 (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('selection', 'validation', 'evaluation', 'variant', 'prospective')),
    label TEXT,
    version TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    config_json TEXT,
    basket TEXT,
    symbols_json TEXT,
    period_json TEXT,
    fill_model TEXT,
    delay INTEGER,
    data_hash TEXT,
    calibration_hash TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    contaminated INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    metrics_json TEXT,
    details_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  INSERT INTO hxr_runs_v2 SELECT id, kind, label, version, config_hash, config_json, basket, symbols_json, period_json, fill_model, delay, data_hash,
    calibration_hash, status, contaminated, reason, metrics_json, details_json, error, created_at, finished_at FROM hxr_runs;
  DROP TABLE hxr_runs;
  ALTER TABLE hxr_runs_v2 RENAME TO hxr_runs;
  CREATE INDEX hxr_runs_kind ON hxr_runs(kind, id);

  CREATE TABLE hxr_ledger_v2 (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('selection', 'validation', 'evaluation')),
    prereg TEXT NOT NULL,
    version TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    run_ids_json TEXT,
    contaminated INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    at TEXT NOT NULL
  );
  INSERT INTO hxr_ledger_v2 SELECT id, kind, prereg, version, config_hash, run_ids_json, contaminated, reason, at FROM hxr_ledger;
  DROP TABLE hxr_ledger;
  ALTER TABLE hxr_ledger_v2 RENAME TO hxr_ledger;
  CREATE TRIGGER hxr_ledger_no_update BEFORE UPDATE ON hxr_ledger BEGIN SELECT RAISE(ABORT, 'hxr_ledger is append-only'); END;
  CREATE TRIGGER hxr_ledger_no_delete BEFORE DELETE ON hxr_ledger BEGIN SELECT RAISE(ABORT, 'hxr_ledger is append-only'); END;
  `,
});

export const MIGRATION_COUNT = MIGRATIONS.length;
export const HXR_DB_NAME = 'hxr-sim.sqlite';

export function hxrDbFile(cfg) {
  return path.join(cfg.dataDir, HXR_DB_NAME);
}

// The portfolio and Strategy Lab files, compared case-insensitively.
export function isRefusedName(name) {
  const n = String(name).toLowerCase();
  return n === 'signal-desk.sqlite' || n === 'demo.sqlite' || n.startsWith('strategy-lab');
}

// The real path a database file resolves to: the file itself when it exists,
// else its directory's real path plus the name. Throws for any refused name,
// as given or as resolved, and for a dangling symlink (opening it would create
// the target, wherever it points).
export function guardHxrFile(file) {
  const abs = path.resolve(file);
  if (isRefusedName(path.basename(abs))) throw new Error('HXR never opens the portfolio or Strategy Lab databases');
  let real;
  if (fs.existsSync(abs)) real = fs.realpathSync(abs);
  else {
    let isLink = false;
    try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch { /* does not exist */ }
    if (isLink) throw new Error('HXR refuses a database path that is a dangling symlink');
    real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  }
  if (isRefusedName(path.basename(real))) throw new Error('HXR never opens the portfolio or Strategy Lab databases');
  return real;
}

// Tables (and views) of an open database that are not HXR's.
function foreignTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all()
    .map((r) => r.name).filter((n) => !/^hxr_/i.test(n) && !/^sqlite_/i.test(n));
}

export function openHxrDb(file, { readOnly = false } = {}) {
  if (!readOnly) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const real = guardHxrFile(file);
  // An existing file is checked read-only first, so a foreign database is never written to.
  if (fs.existsSync(real)) {
    const probe = new DatabaseSync(real, { readOnly: true });
    try {
      const foreign = foreignTables(probe);
      if (foreign.length) throw new Error(`HXR refuses ${path.basename(real)}: it holds tables that are not HXR's (${foreign.slice(0, 5).join(', ')})`);
    } finally {
      probe.close();
    }
  } else if (readOnly) throw new Error(`HXR database ${path.basename(real)} does not exist`);
  const db = new DatabaseSync(real, readOnly ? { readOnly: true } : {});
  db.exec('PRAGMA busy_timeout = 5000;');
  if (readOnly) return db;
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function schemaVersion(db) {
  return db.prepare('SELECT version FROM hxr_schema_version').get()?.version ?? 0;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS hxr_schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM hxr_schema_version').get();
  let v = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO hxr_schema_version (version) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    const m = MIGRATIONS[v];
    const sql = typeof m === 'string' ? m : m.sql;
    // A table rebuild must not cascade through ON DELETE: the pragma only takes
    // effect outside a transaction, so it is set before BEGIN and restored after.
    const fkOff = typeof m === 'object' && m.foreignKeysOff;
    if (fkOff) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      v = db.prepare('SELECT version FROM hxr_schema_version').get().version;
      if (v < MIGRATIONS.length) {
        db.exec(sql);
        v += 1;
        db.prepare('UPDATE hxr_schema_version SET version = ?').run(v);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      if (fkOff) db.exec('PRAGMA foreign_keys = ON');
      throw e;
    }
    if (fkOff) {
      const bad = db.prepare('PRAGMA foreign_key_check').all();
      db.exec('PRAGMA foreign_keys = ON');
      if (bad.length) throw new Error(`HXR migration ${v} left ${bad.length} dangling foreign-key row(s)`);
    }
  }
}

export function tx(db, fn) {
  if (db.isTransaction) return fn();
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

const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
const parse = (s, d = null) => (s == null ? d : JSON.parse(s));
const nowIso = () => new Date().toISOString();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fin = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
// ISO instants are stored in one format (toISOString) so they compare as text.
const instant = (v) => {
  const ms = typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(v);
  if (!Number.isFinite(ms)) throw new Error(`Invalid time ${JSON.stringify(v)}`);
  return new Date(ms).toISOString();
};
const dateRange = (where, args, col, from, to) => {
  if (from) { where.push(`${col} >= ?`); args.push(from); }
  if (to) { where.push(`${col} <= ?`); args.push(to); }
};
const whereSql = (where) => (where.length ? `WHERE ${where.join(' AND ')}` : '');

// ---------- settings ----------

export function getSetting(db, key, fallback = null) {
  const r = db.prepare('SELECT value_json FROM hxr_settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value_json) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO hxr_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').run(key, JSON.stringify(value));
  return value;
}

// ---------- daily bars (raw, SIP, from Alpaca) ----------

function checkBar(symbol, b) {
  if (!DATE.test(b?.date || '')) throw new Error(`${symbol}: a bar needs a YYYY-MM-DD date`);
  for (const k of ['o', 'h', 'l', 'c']) if (fin(b[k]) == null) throw new Error(`${symbol} ${b.date}: ${k} must be a number`);
}

// bars: [{ date, o, h, l, c, v, n, vw }]. A bar already stored for the same
// date is replaced. Returns { inserted, updated }.
export function upsertBars(db, symbol, bars, { fetchedAt = nowIso() } = {}) {
  const has = db.prepare('SELECT 1 FROM hxr_bars WHERE symbol = ? AND date = ?');
  const put = db.prepare(`INSERT INTO hxr_bars (symbol, date, o, h, l, c, v, n, vw, source, feed, adjustment, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,'alpaca','sip','raw',?)
    ON CONFLICT(symbol, date) DO UPDATE SET o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v, n = excluded.n, vw = excluded.vw, fetched_at = excluded.fetched_at`);
  return tx(db, () => {
    let inserted = 0, updated = 0;
    for (const b of bars) {
      checkBar(symbol, b);
      if (has.get(symbol, b.date)) updated++; else inserted++;
      put.run(symbol, b.date, Number(b.o), Number(b.h), Number(b.l), Number(b.c), fin(b.v), fin(b.n), fin(b.vw), fetchedAt);
    }
    return { inserted, updated };
  });
}

// [{ date, o, h, l, c, v, n, vw }] sorted by date; from/to inclusive dates.
export function getBars(db, symbol, { from = null, to = null } = {}) {
  const where = ['symbol = ?'], args = [symbol];
  dateRange(where, args, 'date', from, to);
  return db.prepare(`SELECT date, o, h, l, c, v, n, vw FROM hxr_bars ${whereSql(where)} ORDER BY date`).all(...args).map((r) => ({ ...r }));
}

// [{ symbol, bars, first, last, fetchedAt }] per stored symbol.
export function barSummary(db) {
  return db.prepare('SELECT symbol, COUNT(*) AS bars, MIN(date) AS first, MAX(date) AS last, MAX(fetched_at) AS fetchedAt FROM hxr_bars GROUP BY symbol ORDER BY symbol').all().map((r) => ({ ...r }));
}

export function lastBarDate(db, symbol) {
  return db.prepare('SELECT MAX(date) AS d FROM hxr_bars WHERE symbol = ?').get(symbol)?.d ?? null;
}

// ---------- first 15-minute bar ----------

export function upsertFirst15(db, symbol, rows, { fetchedAt = nowIso() } = {}) {
  const has = db.prepare('SELECT 1 FROM hxr_first15 WHERE symbol = ? AND date = ?');
  const put = db.prepare(`INSERT INTO hxr_first15 (symbol, date, o, h, l, c, v, vw, fetched_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(symbol, date) DO UPDATE SET o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v, vw = excluded.vw, fetched_at = excluded.fetched_at`);
  return tx(db, () => {
    let inserted = 0, updated = 0;
    for (const r of rows) {
      if (!DATE.test(r?.date || '')) throw new Error(`${symbol}: a first-15-minute bar needs a YYYY-MM-DD date`);
      if (has.get(symbol, r.date)) updated++; else inserted++;
      put.run(symbol, r.date, fin(r.o), fin(r.h), fin(r.l), fin(r.c), fin(r.v), fin(r.vw), fetchedAt);
    }
    return { inserted, updated };
  });
}

export function getFirst15(db, symbol, { from = null, to = null } = {}) {
  const where = ['symbol = ?'], args = [symbol];
  dateRange(where, args, 'date', from, to);
  return db.prepare(`SELECT date, o, h, l, c, v, vw FROM hxr_first15 ${whereSql(where)} ORDER BY date`).all(...args).map((r) => ({ ...r }));
}

// ---------- corporate actions ----------

// rows: source.corporateActions() output. Upserted by Alpaca id.
export function upsertCorporateActions(db, rows, { fetchedAt = nowIso() } = {}) {
  const has = db.prepare('SELECT 1 FROM hxr_corporate_actions WHERE id = ?');
  const put = db.prepare(`INSERT INTO hxr_corporate_actions (id, type, symbol, cusip, ex_date, pay_date, process_date, ratio_old, ratio_new, rate, old_symbol, new_symbol, raw_json, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, symbol = excluded.symbol, cusip = excluded.cusip, ex_date = excluded.ex_date,
    pay_date = excluded.pay_date, process_date = excluded.process_date, ratio_old = excluded.ratio_old, ratio_new = excluded.ratio_new, rate = excluded.rate,
    old_symbol = excluded.old_symbol, new_symbol = excluded.new_symbol, raw_json = excluded.raw_json, fetched_at = excluded.fetched_at`);
  return tx(db, () => {
    let inserted = 0, updated = 0;
    for (const r of rows) {
      if (!r?.id || !r.type) throw new Error('A corporate action needs an id and a type');
      if (has.get(String(r.id))) updated++; else inserted++;
      put.run(String(r.id), r.type, r.symbol ?? null, r.cusip ?? null, r.ex_date ?? null, r.pay_date ?? null, r.process_date ?? null,
        fin(r.ratio_old), fin(r.ratio_new), fin(r.rate), r.old_symbol ?? null, r.new_symbol ?? null, json(r.raw), fetchedAt);
    }
    return { inserted, updated };
  });
}

const actionRow = (r) => ({
  id: r.id, type: r.type, symbol: r.symbol, cusip: r.cusip, ex_date: r.ex_date, pay_date: r.pay_date, process_date: r.process_date,
  ratio_old: r.ratio_old, ratio_new: r.ratio_new, rate: r.rate, old_symbol: r.old_symbol, new_symbol: r.new_symbol, raw: parse(r.raw_json), fetched_at: r.fetched_at,
});

// Actions touching a symbol (as symbol, old_symbol or new_symbol), of the
// given types, ordered by ex-date (or process date) and id.
export function listCorporateActions(db, { symbol = null, types = null } = {}) {
  const where = [], args = [];
  if (symbol) { where.push('(symbol = ? OR old_symbol = ? OR new_symbol = ?)'); args.push(symbol, symbol, symbol); }
  if (types?.length) { where.push(`type IN (${types.map(() => '?').join(',')})`); args.push(...types); }
  return db.prepare(`SELECT * FROM hxr_corporate_actions ${whereSql(where)} ORDER BY COALESCE(ex_date, process_date), id`).all(...args).map(actionRow);
}

// ---------- spread samples ----------

// rows: [{ symbol, date, quotes, dropped, medianSpreadBps, medianHalfSpreadBps, window }]
export function upsertSpreadSamples(db, rows, { fetchedAt = nowIso() } = {}) {
  const put = db.prepare(`INSERT INTO hxr_spread_samples (symbol, date, quotes, dropped, median_spread_bps, median_half_spread_bps, "window", fetched_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(symbol, date) DO UPDATE SET quotes = excluded.quotes, dropped = excluded.dropped, median_spread_bps = excluded.median_spread_bps,
    median_half_spread_bps = excluded.median_half_spread_bps, "window" = excluded."window", fetched_at = excluded.fetched_at`);
  return tx(db, () => {
    for (const r of rows) {
      if (!r?.symbol || !DATE.test(r.date || '')) throw new Error('A spread sample needs a symbol and a YYYY-MM-DD date');
      put.run(r.symbol, r.date, Number(r.quotes) || 0, fin(r.dropped), fin(r.medianSpreadBps), fin(r.medianHalfSpreadBps), r.window ?? null, fetchedAt);
    }
    return rows.length;
  });
}

export function listSpreadSamples(db, symbol = null) {
  const rows = symbol
    ? db.prepare('SELECT * FROM hxr_spread_samples WHERE symbol = ? ORDER BY date').all(symbol)
    : db.prepare('SELECT * FROM hxr_spread_samples ORDER BY symbol, date').all();
  return rows.map((r) => ({
    symbol: r.symbol, date: r.date, quotes: r.quotes, dropped: r.dropped, medianSpreadBps: r.median_spread_bps,
    medianHalfSpreadBps: r.median_half_spread_bps, window: r.window, fetchedAt: r.fetched_at,
  }));
}

// ---------- news (untrusted text: rendered with h() text nodes only) ----------

export const BACKFILL_AFTER_MIN = 30;

// items: source.news() output. A stored id is never touched again, so
// first_seen_at and backfilled keep their first values. An item first seen
// more than 30 minutes after its created_at is backfilled. Returns the number
// of items inserted.
export function insertNews(db, items, { seenAt = nowIso() } = {}) {
  const seen = instant(seenAt);
  const put = db.prepare(`INSERT INTO hxr_news (id, created_at, updated_at, headline, summary, source, url, symbols_json, first_seen_at, backfilled)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);
  const link = db.prepare('INSERT INTO hxr_news_symbols (news_id, symbol) VALUES (?, ?) ON CONFLICT DO NOTHING');
  return tx(db, () => {
    let inserted = 0;
    for (const n of items) {
      if (n?.id == null || n.id === '') throw new Error('A news item needs an id');
      const created = instant(n.created_at);
      const symbols = [...new Set((n.symbols || []).map((s) => String(s).toUpperCase()))];
      const backfilled = Date.parse(seen) - Date.parse(created) > BACKFILL_AFTER_MIN * 60000 ? 1 : 0;
      const r = put.run(String(n.id), created, n.updated_at ? instant(n.updated_at) : null, n.headline ?? null, n.summary ?? null, n.source ?? null,
        n.url ?? null, JSON.stringify(symbols), seen, backfilled);
      if (!r.changes) continue;
      inserted++;
      for (const s of symbols) link.run(String(n.id), s);
    }
    return inserted;
  });
}

const newsRow = (r) => ({
  id: r.id, created_at: r.created_at, updated_at: r.updated_at, headline: r.headline, summary: r.summary, source: r.source, url: r.url,
  symbols: parse(r.symbols_json, []), first_seen_at: r.first_seen_at, backfilled: !!r.backfilled,
});

// News for a symbol (or all) with created_at in [createdFrom, createdTo] and,
// with seenBy, first seen at or before that instant. Newest first.
export function newsFor(db, { symbol = null, createdFrom = null, createdTo = null, seenBy = null, limit = 200 } = {}) {
  const where = [], args = [];
  if (symbol) { where.push('n.id IN (SELECT news_id FROM hxr_news_symbols WHERE symbol = ?)'); args.push(symbol); }
  if (createdFrom) { where.push('n.created_at >= ?'); args.push(instant(createdFrom)); }
  if (createdTo) { where.push('n.created_at <= ?'); args.push(instant(createdTo)); }
  if (seenBy) { where.push('n.first_seen_at <= ?'); args.push(instant(seenBy)); }
  return db.prepare(`SELECT n.* FROM hxr_news n ${whereSql(where)} ORDER BY n.created_at DESC, n.id DESC LIMIT ?`)
    .all(...args, Math.max(1, Math.min(Number(limit) || 200, 5000))).map(newsRow);
}

export function lastNewsUpdate(db) {
  return db.prepare('SELECT MAX(updated_at) AS u, MAX(first_seen_at) AS s FROM hxr_news').get();
}

// ---------- experiments (append-only) ----------

export function appendExperiment(db, e) {
  if (!e?.what) throw new Error('An experiment entry needs "what"');
  const r = db.prepare('INSERT INTO hxr_experiments (at, what, version, data_touched, results_seen, note) VALUES (?,?,?,?,?,?)')
    .run(e.at || nowIso(), e.what, e.version ?? null, e.dataTouched ?? null, e.resultsSeen ?? null, e.note ?? null);
  return Number(r.lastInsertRowid);
}

export function listExperiments(db) {
  return db.prepare('SELECT * FROM hxr_experiments ORDER BY id').all().map((r) => ({
    id: r.id, at: r.at, what: r.what, version: r.version, dataTouched: r.data_touched, resultsSeen: r.results_seen, note: r.note,
  }));
}

// ---------- selection / evaluation ledger (append-only) ----------

export function appendLedger(db, e) {
  for (const k of ['kind', 'prereg', 'version', 'configHash']) if (!e?.[k]) throw new Error(`A ledger entry needs ${k}`);
  const r = db.prepare('INSERT INTO hxr_ledger (kind, prereg, version, config_hash, run_ids_json, contaminated, reason, at) VALUES (?,?,?,?,?,?,?,?)')
    .run(e.kind, e.prereg, e.version, e.configHash, json(e.runIds ?? []), e.contaminated ? 1 : 0, e.reason ?? null, e.at || nowIso());
  return Number(r.lastInsertRowid);
}

export function listLedger(db, { kind = null } = {}) {
  const rows = kind ? db.prepare('SELECT * FROM hxr_ledger WHERE kind = ? ORDER BY id').all(kind) : db.prepare('SELECT * FROM hxr_ledger ORDER BY id').all();
  return rows.map((r) => ({
    id: r.id, kind: r.kind, prereg: r.prereg, version: r.version, configHash: r.config_hash, runIds: parse(r.run_ids_json, []),
    contaminated: !!r.contaminated, reason: r.reason, at: r.at,
  }));
}

export function countLedger(db, kind, prereg, version, configHash) {
  return db.prepare('SELECT COUNT(*) AS n FROM hxr_ledger WHERE kind = ? AND prereg = ? AND version = ? AND config_hash = ?').get(kind, prereg, version, configHash).n;
}

// ---------- frozen versions ----------

// Saving the same version with the same hash again returns the stored one;
// a different config under a frozen version name is refused.
export function saveVersion(db, v) {
  for (const k of ['version', 'config', 'configHash', 'prereg']) if (!v?.[k]) throw new Error(`A version needs ${k}`);
  return tx(db, () => {
    const old = getVersion(db, v.version);
    if (old) {
      if (old.configHash !== v.configHash) throw new Error(`HXR version ${v.version} is already frozen with another config`);
      return old;
    }
    db.prepare('INSERT INTO hxr_versions (version, config_json, config_hash, based_on, frozen_at, prereg) VALUES (?,?,?,?,?,?)')
      .run(v.version, typeof v.config === 'string' ? v.config : JSON.stringify(v.config), v.configHash, v.basedOn ?? null, v.frozenAt || nowIso(), v.prereg);
    return getVersion(db, v.version);
  });
}

const versionRow = (r) => (r ? { version: r.version, config: parse(r.config_json), configHash: r.config_hash, basedOn: r.based_on, frozenAt: r.frozen_at, prereg: r.prereg } : null);

export function getVersion(db, version) {
  return versionRow(db.prepare('SELECT * FROM hxr_versions WHERE version = ?').get(version));
}

export function listVersions(db) {
  return db.prepare('SELECT * FROM hxr_versions ORDER BY frozen_at, version').all().map(versionRow);
}

// ---------- runs ----------

export function createRun(db, r) {
  for (const k of ['kind', 'version', 'configHash']) if (!r?.[k]) throw new Error(`A run needs ${k}`);
  const res = db.prepare(`INSERT INTO hxr_runs (kind, label, version, config_hash, config_json, basket, symbols_json, period_json, fill_model, delay, data_hash,
      calibration_hash, status, contaminated, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    r.kind, r.label ?? null, r.version, r.configHash, r.config == null ? null : typeof r.config === 'string' ? r.config : JSON.stringify(r.config),
    r.basket ?? null, json(r.symbols), json(r.period), r.fillModel ?? null, r.delay ?? null, r.dataHash ?? null, r.calibrationHash ?? null,
    r.status || 'running', r.contaminated ? 1 : 0, r.reason ?? null, r.createdAt || nowIso());
  return Number(res.lastInsertRowid);
}

const RUN_FIELDS = {
  label: 'label', dataHash: 'data_hash', calibrationHash: 'calibration_hash', status: 'status', contaminated: 'contaminated', reason: 'reason',
  metrics: 'metrics_json', details: 'details_json', error: 'error', finishedAt: 'finished_at',
};
const RUN_JSON = new Set(['metrics', 'details']);

export function updateRun(db, id, patch) {
  const sets = [], args = [];
  for (const [k, v] of Object.entries(patch || {})) {
    const col = RUN_FIELDS[k];
    if (!col || v === undefined) continue;
    sets.push(`${col} = ?`);
    args.push(RUN_JSON.has(k) ? json(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  if (sets.length) db.prepare(`UPDATE hxr_runs SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
}

function runRow(r, full) {
  if (!r) return null;
  const out = {
    id: r.id, kind: r.kind, label: r.label, version: r.version, configHash: r.config_hash, basket: r.basket, symbols: parse(r.symbols_json, []),
    period: parse(r.period_json), fillModel: r.fill_model, delay: r.delay, dataHash: r.data_hash, calibrationHash: r.calibration_hash,
    status: r.status, contaminated: !!r.contaminated, reason: r.reason, error: r.error, createdAt: r.created_at, finishedAt: r.finished_at,
    metrics: parse(r.metrics_json),
  };
  if (full) {
    out.config = parse(r.config_json);
    out.details = parse(r.details_json);
  }
  return out;
}

export function getRun(db, id, { full = true } = {}) {
  return runRow(db.prepare('SELECT * FROM hxr_runs WHERE id = ?').get(id), full);
}

export function listRuns(db, { kind = null, version = null, configHash = null, status = null, limit = 100 } = {}) {
  const where = [], args = [];
  for (const [col, v] of [['kind', kind], ['version', version], ['config_hash', configHash], ['status', status]]) {
    if (v != null) { where.push(`${col} = ?`); args.push(v); }
  }
  return db.prepare(`SELECT * FROM hxr_runs ${whereSql(where)} ORDER BY id DESC LIMIT ?`).all(...args, Math.max(1, Math.min(Number(limit) || 100, 1000))).map((r) => runRow(r, false));
}

// Runs left 'running' by a closed app are marked failed (never shown as results).
export function failInterruptedRuns(db, at = nowIso()) {
  return Number(db.prepare("UPDATE hxr_runs SET status = 'failed', error = 'Interrupted (the app was closed while it ran)', finished_at = ? WHERE status = 'running'").run(at).changes);
}

// ---------- fills, decisions, episodes, equity ----------

// Each item is stored whole (detail_json) beside a few indexed columns; an
// item id already stored for the run is not stored twice.
function insertItems(db, table, cols, runId, items, pick) {
  const st = db.prepare(`INSERT INTO ${table} (run_id, item_id, ${cols.join(', ')}, detail_json) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?) ON CONFLICT(run_id, item_id) DO NOTHING`);
  return tx(db, () => {
    let inserted = 0, duplicates = 0;
    for (const it of items || []) {
      const r = st.run(runId, it?.id == null ? null : String(it.id), ...pick(it), JSON.stringify(it));
      if (r.changes) inserted++; else duplicates++;
    }
    return { inserted, duplicates };
  });
}

function listItems(db, table, runId, { symbol = null, from = null, to = null, dateCol = 'date', limit = null } = {}) {
  const where = ['run_id = ?'], args = [runId];
  if (symbol) { where.push('symbol = ?'); args.push(symbol); }
  dateRange(where, args, dateCol, from, to);
  const lim = limit ? ` LIMIT ${Math.max(1, Math.floor(limit))}` : '';
  return db.prepare(`SELECT detail_json FROM ${table} ${whereSql(where)} ORDER BY ${dateCol}, id${lim}`).all(...args).map((r) => JSON.parse(r.detail_json));
}

const str = (v) => (v == null ? null : String(v));

export const insertFills = (db, runId, fills) => insertItems(db, 'hxr_fills', ['date', 'symbol', 'side', 'shares', 'price'], runId, fills,
  (f) => [str(f.date), str(f.symbol), str(f.side), fin(f.shares), fin(f.price)]);
export const listFills = (db, runId, opts = {}) => listItems(db, 'hxr_fills', runId, opts);

export const insertDecisions = (db, runId, decisions) => insertItems(db, 'hxr_decisions', ['date', 'symbol', 'action'], runId, decisions,
  (d) => [str(d.date ?? d.decisionDate), str(d.symbol), str(d.action ?? d.side)]);
export const listDecisions = (db, runId, opts = {}) => listItems(db, 'hxr_decisions', runId, opts);

export const insertEpisodes = (db, runId, episodes) => insertItems(db, 'hxr_episodes', ['symbol', 'start_date', 'end_date', 'pnl'], runId, episodes,
  (e) => [str(e.symbol), str(e.startDate ?? e.start), str(e.endDate ?? e.end), fin(e.pnl ?? e.netPnl)]);
export const listEpisodes = (db, runId, opts = {}) => listItems(db, 'hxr_episodes', runId, { ...opts, dateCol: 'start_date' });

// points: [{ date, equity, cash, invested, sleevesOut, receivable, ... }]
export function insertEquity(db, runId, points) {
  const st = db.prepare(`INSERT OR REPLACE INTO hxr_equity (run_id, date, equity, cash, invested, sleeves_out, receivable, detail_json) VALUES (?,?,?,?,?,?,?,?)`);
  return tx(db, () => {
    for (const p of points || []) st.run(runId, p.date, fin(p.equity), fin(p.cash), fin(p.invested), fin(p.sleevesOut), fin(p.receivable), JSON.stringify(p));
    return (points || []).length;
  });
}

export function listEquity(db, runId, { from = null, to = null } = {}) {
  const where = ['run_id = ?'], args = [runId];
  dateRange(where, args, 'date', from, to);
  return db.prepare(`SELECT detail_json FROM hxr_equity ${whereSql(where)} ORDER BY date`).all(...args).map((r) => JSON.parse(r.detail_json));
}

// ---------- prospective account ----------

export function getProspective(db) {
  const r = db.prepare('SELECT * FROM hxr_prospective WHERE id = 1').get();
  return r ? {
    version: r.version, configHash: r.config_hash, startedAt: r.started_at, startDate: r.start_date, symbols: parse(r.symbols_json, []),
    state: parse(r.state_json), lastProcessed: r.last_processed, status: r.status,
  } : null;
}

// Creates or updates the one account. With create: true an existing account is refused.
export function saveProspective(db, p, { create = false } = {}) {
  for (const k of ['version', 'configHash', 'startedAt', 'startDate', 'symbols', 'status']) if (p?.[k] == null) throw new Error(`The prospective account needs ${k}`);
  return tx(db, () => {
    if (create && getProspective(db)) throw new Error('A prospective account already exists');
    db.prepare(`INSERT INTO hxr_prospective (id, version, config_hash, started_at, start_date, symbols_json, state_json, last_processed, status) VALUES (1,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version, config_hash = excluded.config_hash, started_at = excluded.started_at, start_date = excluded.start_date,
      symbols_json = excluded.symbols_json, state_json = excluded.state_json, last_processed = excluded.last_processed, status = excluded.status`).run(
      p.version, p.configHash, p.startedAt, p.startDate, JSON.stringify(p.symbols), json(p.state), p.lastProcessed ?? null, p.status);
    return getProspective(db);
  });
}

// events: [{ key, kind, arm, date, symbol, recordedAt, onTime, detail }]. An
// event whose key is already stored is skipped. Returns { inserted, duplicates }.
export function insertProspectiveEvents(db, events) {
  const st = db.prepare(`INSERT INTO hxr_prospective_events (event_key, kind, arm, date, symbol, recorded_at, on_time, detail_json) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(event_key) DO NOTHING`);
  return tx(db, () => {
    let inserted = 0, duplicates = 0;
    for (const e of events || []) {
      if (!e?.kind || !e.recordedAt) throw new Error('A prospective event needs a kind and recordedAt');
      const r = st.run(e.key ?? null, e.kind, e.arm ?? null, e.date ?? null, e.symbol ?? null, instant(e.recordedAt), e.onTime == null ? null : e.onTime ? 1 : 0, json(e.detail ?? null));
      if (r.changes) inserted++; else duplicates++;
    }
    return { inserted, duplicates };
  });
}

export function listProspectiveEvents(db, { kind = null, kinds = null, arm = null, symbol = null, from = null, to = null, limit = 1000 } = {}) {
  const where = [], args = [];
  if (kind) { where.push('kind = ?'); args.push(kind); }
  if (kinds?.length) { where.push(`kind IN (${kinds.map(() => '?').join(',')})`); args.push(...kinds); }
  if (arm) { where.push('arm = ?'); args.push(arm); }
  if (symbol) { where.push('symbol = ?'); args.push(symbol); }
  dateRange(where, args, 'date', from, to);
  return db.prepare(`SELECT * FROM hxr_prospective_events ${whereSql(where)} ORDER BY date, id LIMIT ?`).all(...args, Math.max(1, Math.min(Number(limit) || 1000, 100000)))
    .map((r) => ({ id: r.id, key: r.event_key, kind: r.kind, arm: r.arm, date: r.date, symbol: r.symbol, recordedAt: r.recorded_at, onTime: r.on_time == null ? null : !!r.on_time, detail: parse(r.detail_json) }));
}
