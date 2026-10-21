// SQLite storage (Node's built-in node:sqlite, so there is nothing to compile
// on Windows). The real portfolio and the demo dataset live in separate files.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  // 1: core schema
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);

  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    broker TEXT,
    account_type TEXT,            -- TFSA, RRSP, FHSA, non-registered, margin, other
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE instruments (
    id INTEGER PRIMARY KEY,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('USD','CAD')),
    name TEXT,
    sec_type TEXT NOT NULL DEFAULT 'stock',   -- stock, etf, adr, other
    provider_symbol TEXT,                     -- symbol as the market-data provider expects it
    identity_status TEXT NOT NULL DEFAULT 'needs_confirmation', -- confirmed | needs_confirmation
    identity_note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (symbol, exchange)
  );

  CREATE TABLE symbol_history (
    id INTEGER PRIMARY KEY,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id),
    old_symbol TEXT NOT NULL,
    new_symbol TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE import_batches (
    id INTEGER PRIMARY KEY,
    filename TEXT,
    format TEXT,
    status TEXT NOT NULL,          -- previewed | applied | discarded
    rows_total INTEGER, rows_new INTEGER, rows_duplicate INTEGER, rows_error INTEGER,
    preview_json TEXT,
    created_at TEXT NOT NULL,
    applied_at TEXT
  );

  -- Ledger. Positions are always derived from these rows.
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    instrument_id INTEGER REFERENCES instruments(id),
    type TEXT NOT NULL,            -- BASELINE BUY SELL DIVIDEND FEE DEPOSIT WITHDRAWAL FX_IN FX_OUT INTEREST
    trade_date TEXT NOT NULL,
    quantity REAL,
    price REAL,
    fees REAL NOT NULL DEFAULT 0,
    amount REAL,                   -- cash amount for cash-only rows (positive)
    currency TEXT NOT NULL CHECK (currency IN ('USD','CAD')),
    fx_rate_cad REAL,              -- CAD per 1 unit of currency at trade time, if known
    note TEXT,
    source TEXT NOT NULL,          -- manual | csv | screenshot
    import_batch_id INTEGER REFERENCES import_batches(id),
    external_id TEXT,
    dedupe_hash TEXT NOT NULL UNIQUE,
    unconfirmed_fields TEXT,       -- JSON array of field names awaiting confirmation
    voided_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX tx_instr ON transactions(instrument_id, trade_date);

  CREATE TABLE corporate_actions (
    id INTEGER PRIMARY KEY,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id),
    type TEXT NOT NULL,            -- SPLIT
    effective_date TEXT NOT NULL,
    ratio_from REAL, ratio_to REAL,
    note TEXT,
    source TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (instrument_id, type, effective_date)
  );

  CREATE TABLE position_meta (
    account_id INTEGER NOT NULL,
    instrument_id INTEGER NOT NULL,
    strategy TEXT NOT NULL DEFAULT 'unclassified',  -- long_term | swing | unclassified
    thesis TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, instrument_id)
  );

  -- Cash balances as reported by the user/broker (snapshot history).
  CREATE TABLE cash_balances (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    currency TEXT NOT NULL CHECK (currency IN ('USD','CAD')),
    amount REAL NOT NULL,
    as_of TEXT NOT NULL,
    source TEXT NOT NULL,
    confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    note TEXT
  );

  CREATE TABLE quotes (
    instrument_id INTEGER PRIMARY KEY REFERENCES instruments(id),
    provider TEXT NOT NULL,
    price REAL, prev_close REAL, change REAL, change_pct REAL,
    open REAL, high REAL, low REAL, volume REAL, avg_volume REAL,
    ext_price REAL, ext_change_pct REAL, ext_session TEXT, ext_time TEXT,
    session TEXT, quote_time TEXT, fetched_at TEXT NOT NULL,
    timeliness TEXT,               -- real-time | delayed | end-of-day
    delay_minutes INTEGER,
    last_error TEXT, last_error_at TEXT
  );

  CREATE TABLE bars (
    instrument_id INTEGER NOT NULL,
    interval TEXT NOT NULL,        -- 1day | 5min | 1min
    ts TEXT NOT NULL,
    o REAL, h REAL, l REAL, c REAL, v REAL,
    session TEXT,                  -- regular | pre | post (intraday only)
    provider TEXT NOT NULL,
    PRIMARY KEY (instrument_id, interval, ts)
  );

  CREATE TABLE fx_rates (
    pair TEXT NOT NULL,            -- USDCAD = CAD per USD
    rate REAL NOT NULL,
    as_of TEXT NOT NULL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (pair, as_of, source)
  );

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    instrument_id INTEGER,
    symbol TEXT,
    type TEXT NOT NULL,            -- earnings | dividend | split | macro | other
    date TEXT NOT NULL,
    time_hint TEXT,                -- bmo | amc | dmh | unknown
    title TEXT,
    details_json TEXT,
    source TEXT NOT NULL,
    source_url TEXT,
    fetched_at TEXT NOT NULL,
    UNIQUE (symbol, type, date, source)
  );

  CREATE TABLE news (
    id INTEGER PRIMARY KEY,
    dedupe_key TEXT NOT NULL UNIQUE,
    cluster_key TEXT,
    title TEXT NOT NULL,
    url TEXT,
    source_name TEXT,
    source_type TEXT,              -- filing | ir | press_release | media | other
    published_at TEXT,
    event_at TEXT,
    fetched_at TEXT NOT NULL,
    summary TEXT,
    symbols_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reported',  -- confirmed | reported | unconfirmed | conflicting
    importance INTEGER NOT NULL DEFAULT 1,     -- 1 low .. 3 high
    reaction_json TEXT,
    analysis_json TEXT,
    provider TEXT NOT NULL
  );
  CREATE INDEX news_pub ON news(published_at);

  CREATE TABLE briefings (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,            -- premarket | first_hour | pre_close | manual
    trading_date TEXT NOT NULL,
    slot_key TEXT UNIQUE,          -- kind:date for scheduled ones; NULL for manual
    scheduled_for TEXT,
    generated_at TEXT,
    status TEXT NOT NULL,          -- running | ok | partial | failed | missed
    attempts INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    content_json TEXT,
    text TEXT,
    error TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE deliveries (
    id INTEGER PRIMARY KEY,
    ref_type TEXT NOT NULL,        -- briefing | alert | test
    ref_id INTEGER,
    channel TEXT NOT NULL,         -- email | ntfy | in_app
    status TEXT NOT NULL,          -- sent | failed | skipped
    detail TEXT,
    attempted_at TEXT NOT NULL
  );

  CREATE TABLE alert_rules (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,            -- price_above | price_below | pct_move | near_high | near_low | volume_spike | earnings_soon | news_material | concentration | drawdown
    instrument_id INTEGER,
    params_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY,
    rule_id INTEGER,
    instrument_id INTEGER,
    dedupe_key TEXT NOT NULL UNIQUE,
    triggered_at TEXT NOT NULL,
    severity TEXT NOT NULL,        -- info | warn | high
    title TEXT NOT NULL,
    message TEXT,
    data_as_of TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    delivery_status TEXT           -- pending | sent | failed | quiet_hours | not_configured
  );

  CREATE TABLE assessments (
    id INTEGER PRIMARY KEY,
    instrument_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    action TEXT NOT NULL,          -- HOLD TRIM SELL WAIT CONDITIONAL_ADD INSUFFICIENT_EVIDENCE
    horizon TEXT,
    payload_json TEXT NOT NULL,
    method TEXT NOT NULL
  );

  CREATE TABLE watchlist (
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    category TEXT,
    note TEXT,
    added_at TEXT NOT NULL,
    PRIMARY KEY (symbol, exchange)
  );

  CREATE TABLE descriptions (
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    data_json TEXT NOT NULL,       -- user-edited / reviewed description overrides
    updated_at TEXT NOT NULL,
    PRIMARY KEY (symbol, exchange)
  );

  CREATE TABLE job_runs (
    id INTEGER PRIMARY KEY,
    job TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,          -- ok | failed | partial
    detail TEXT
  );
  `,
  // 2: Ask Signal Desk chat agent
  `
  CREATE TABLE chat_conversations (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,                -- user | assistant
    text TEXT,                         -- user question, or assistant short answer
    answer_json TEXT,                  -- structured assistant answer
    ledger_json TEXT,                  -- data used: refs, sources, timestamps
    tools_json TEXT,                   -- tool calls made (name, status, ms, error)
    scenarios_json TEXT,               -- hypothetical scenarios computed this turn
    page_context_json TEXT,
    status TEXT NOT NULL DEFAULT 'ok', -- ok | partial | error | unavailable
    error TEXT,
    model TEXT,
    usage_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX chat_messages_conv ON chat_messages(conversation_id, id);

  CREATE TABLE chat_proposals (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    message_id INTEGER,
    change_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    diff_json TEXT NOT NULL,
    user_quote TEXT NOT NULL,
    status TEXT NOT NULL,              -- pending | confirmed | rejected | failed | expired
    result_json TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT
  );

  CREATE TABLE chat_usage (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    day TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
    cost_usd REAL
  );
  `,
];

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let v = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      v += 1;
      db.prepare('UPDATE schema_version SET version = ?').run(v);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function audit(db, entity, entityId, action, before, after, note) {
  db.prepare(`INSERT INTO audit_log (at, entity, entity_id, action, before_json, after_json, note)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    nowIso(), entity, entityId == null ? null : String(entityId), action,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after), note ?? null);
}

export function getSetting(db, key, fallback) {
  const r = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value_json) : fallback;
}

export function setSetting(db, key, value) {
  const before = getSetting(db, key, null);
  db.prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value), nowIso());
  audit(db, 'setting', key, 'update', before, value);
}
