// CSV import with a two-step flow: preview (nothing written to the ledger)
// then apply. Re-importing the same file is safe: rows are fingerprinted and
// rows already in the ledger are reported as duplicates and skipped.
import { addTransaction, hashTransaction, validateTransaction, TRADE_TYPES, ensureAccount } from './portfolio.js';
import { audit, nowIso, tx } from './db.js';

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false, i = 0;
  const s = text.replace(/^﻿/, '');
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += c; i += 1;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// Header aliases -> canonical field. Broker-specific presets can extend this.
const ALIASES = {
  date: 'trade_date', trade_date: 'trade_date', 'trade date': 'trade_date', 'transaction date': 'trade_date', 'settlement date': 'settle_date',
  type: 'type', action: 'type', activity: 'type', 'transaction type': 'type',
  symbol: 'symbol', ticker: 'symbol',
  exchange: 'exchange', market: 'exchange',
  currency: 'currency', 'trade currency': 'currency',
  quantity: 'quantity', qty: 'quantity', shares: 'quantity', units: 'quantity',
  price: 'price', 'unit price': 'price', 'price per share': 'price',
  fees: 'fees', fee: 'fees', commission: 'fees', commissions: 'fees',
  amount: 'amount', 'net amount': 'amount',
  account: 'account', 'account name': 'account',
  note: 'note', notes: 'note', description: 'note',
  name: 'name', 'security name': 'name',
  id: 'external_id', 'transaction id': 'external_id', external_id: 'external_id', 'reference id': 'external_id',
  strategy: 'strategy',
  fx_rate_cad: 'fx_rate_cad', 'fx rate': 'fx_rate_cad', 'exchange rate': 'fx_rate_cad',
  sec_type: 'sec_type', 'security type': 'sec_type',
};

const TYPE_ALIASES = {
  buy: 'BUY', bought: 'BUY', purchase: 'BUY',
  sell: 'SELL', sold: 'SELL', sale: 'SELL',
  baseline: 'BASELINE', 'opening balance': 'BASELINE', 'opening position': 'BASELINE',
  dividend: 'DIVIDEND', div: 'DIVIDEND', dist: 'DIVIDEND', distribution: 'DIVIDEND',
  deposit: 'DEPOSIT', contribution: 'DEPOSIT', cont: 'DEPOSIT',
  withdrawal: 'WITHDRAWAL', withdraw: 'WITHDRAWAL',
  fee: 'FEE', interest: 'INTEREST',
};

const EXCHANGE_ALIASES = {
  NASDAQ: 'NASDAQ', XNAS: 'NASDAQ', NYSE: 'NYSE', XNYS: 'NYSE', ARCA: 'NYSE Arca', 'NYSE ARCA': 'NYSE Arca', ARCX: 'NYSE Arca',
  BATS: 'Cboe BZX', 'CBOE BZX': 'Cboe BZX', AMEX: 'NYSE American', 'NYSE AMERICAN': 'NYSE American',
  TSX: 'TSX', XTSE: 'TSX', TSE: 'TSX', TSXV: 'TSXV', XTSX: 'TSXV', NEO: 'Cboe Canada', 'CBOE CANADA': 'Cboe Canada', CSE: 'CSE',
};

function normDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // Ambiguous formats like 03/04/2026 are rejected rather than guessed.
  return null;
}

function num(v) {
  if (v == null) return null;
  const s = String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function normalizeRows(rows) {
  if (!rows.length) return { header: [], records: [], unknownColumns: [] };
  const header = rows[0].map((h) => h.trim());
  const map = header.map((h) => ALIASES[h.toLowerCase()] || null);
  const unknownColumns = header.filter((h, i) => !map[i]);
  const records = rows.slice(1).map((r, idx) => {
    const raw = {};
    header.forEach((h, i) => { raw[h] = r[i] ?? ''; });
    const t = {};
    map.forEach((k, i) => { if (k) t[k] = (r[i] ?? '').trim(); });
    const problems = [];
    const warnings = [];
    const rec = {
      line: idx + 2,
      raw,
      type: TYPE_ALIASES[(t.type || '').toLowerCase()] || (t.type || '').toUpperCase(),
      trade_date: normDate(t.trade_date),
      symbol: (t.symbol || '').toUpperCase() || null,
      exchange: t.exchange ? (EXCHANGE_ALIASES[t.exchange.toUpperCase()] || t.exchange) : null,
      currency: (t.currency || '').toUpperCase() || null,
      quantity: num(t.quantity),
      price: num(t.price),
      fees: num(t.fees) ?? 0,
      amount: num(t.amount),
      account: t.account || 'Main',
      note: t.note || null,
      name: t.name || null,
      external_id: t.external_id || null,
      strategy: t.strategy ? t.strategy.toLowerCase().replace(/[\s-]+/g, '_') : null,
      fx_rate_cad: num(t.fx_rate_cad),
      sec_type: t.sec_type ? t.sec_type.toLowerCase() : null,
    };
    if (t.trade_date && !rec.trade_date) problems.push(`Date "${t.trade_date}" is ambiguous or unreadable; use YYYY-MM-DD`);
    // Brokers often export sells as negative quantities.
    if (rec.quantity != null && rec.quantity < 0) {
      rec.quantity = Math.abs(rec.quantity);
      if (rec.type === 'BUY') problems.push('Negative quantity on a BUY row');
    }
    if (rec.fees < 0) rec.fees = Math.abs(rec.fees);
    if (rec.amount != null && rec.amount < 0) rec.amount = Math.abs(rec.amount);
    if (rec.strategy && !['long_term', 'swing', 'unclassified'].includes(rec.strategy)) {
      warnings.push(`Unknown strategy "${t.strategy}" ignored`);
      rec.strategy = null;
    }
    for (const k of ['quantity', 'price', 'amount', 'fx_rate_cad']) if (Number.isNaN(rec[k])) problems.push(`${k} is not a number`);
    rec.problems = problems;
    rec.warnings = warnings;
    return rec;
  });
  return { header, records, unknownColumns };
}

export function previewImport(db, { filename, text }) {
  const { header, records, unknownColumns } = normalizeRows(parseCsv(text));
  const occurrences = new Map();
  const instruments = db.prepare('SELECT * FROM instruments').all();
  let rowsNew = 0, rowsDup = 0, rowsErr = 0;
  for (const r of records) {
    // Fill exchange/currency only from an instrument the user already
    // confirmed, and only when the ticker is unique in the ledger.
    if (TRADE_TYPES.includes(r.type) && r.symbol && (!r.exchange || !r.currency)) {
      const matches = instruments.filter((i) => i.symbol === r.symbol && (!r.exchange || i.exchange === r.exchange));
      if (matches.length === 1 && matches[0].identity_status === 'confirmed') {
        r.exchange = r.exchange || matches[0].exchange;
        r.currency = r.currency || matches[0].currency;
        r.warnings.push(`Exchange/currency taken from your confirmed instrument ${r.symbol} (${matches[0].exchange}, ${matches[0].currency})`);
      } else if (matches.length > 1) {
        r.problems.push(`${r.symbol} exists on several exchanges; add an Exchange column`);
      }
    }
    const errs = r.problems.length ? r.problems : validateTransaction(r);
    if (errs.length) {
      r.status = 'error';
      r.problems = errs;
      rowsErr += 1;
      continue;
    }
    const acc = r.account || 'Main';
    const baseHash = hashTransaction({ ...r, account: acc }, 0);
    const n = occurrences.get(baseHash) || 0;
    occurrences.set(baseHash, n + 1);
    r.occurrence = n;
    const hash = hashTransaction({ ...r, account: acc }, n);
    const exists = db.prepare('SELECT id FROM transactions WHERE dedupe_hash = ?').get(hash);
    if (exists) { r.status = 'duplicate'; r.duplicateOf = exists.id; rowsDup += 1; }
    else { r.status = 'new'; rowsNew += 1; }
    if (n > 0) r.warnings.push('Identical to an earlier row in this file; treated as a separate fill');
  }
  const res = db.prepare(`INSERT INTO import_batches (filename, format, status, rows_total, rows_new, rows_duplicate, rows_error, preview_json, created_at)
                          VALUES (?, 'generic-csv', 'previewed', ?, ?, ?, ?, ?, ?)`)
    .run(filename || 'upload.csv', records.length, rowsNew, rowsDup, rowsErr, JSON.stringify(records), nowIso());
  return {
    batchId: Number(res.lastInsertRowid), header, unknownColumns,
    summary: { total: records.length, new: rowsNew, duplicate: rowsDup, error: rowsErr },
    rows: records.map(({ raw, ...r }) => r),
  };
}

export function applyImport(db, batchId) {
  const b = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
  if (!b) throw new Error('Import batch not found');
  if (b.status !== 'previewed') throw new Error(`This import was already ${b.status}`);
  const rows = JSON.parse(b.preview_json);
  return tx(db, () => {
    let inserted = 0, duplicates = 0;
    for (const r of rows) {
      if (r.status !== 'new') continue;
      ensureAccount(db, r.account);
      const out = addTransaction(db, r, { source: 'csv', batchId, occurrence: r.occurrence, manualUnique: false });
      if (out.inserted) inserted += 1; else duplicates += 1;
    }
    db.prepare("UPDATE import_batches SET status = 'applied', applied_at = ? WHERE id = ?").run(nowIso(), batchId);
    audit(db, 'import_batch', batchId, 'apply', null, { inserted, duplicates, filename: b.filename });
    return { inserted, duplicates, skippedErrors: b.rows_error };
  });
}

export function discardImport(db, batchId) {
  db.prepare("UPDATE import_batches SET status = 'discarded' WHERE id = ? AND status = 'previewed'").run(batchId);
}

export const CSV_TEMPLATE = [
  'date,type,symbol,exchange,currency,quantity,price,fees,account,strategy,fx_rate_cad,note,transaction id',
  '2026-09-30,BASELINE,VFV,TSX,CAD,10,150.00,0,TFSA,long_term,,From brokerage screenshot 2026-09-30,',
  '2026-10-02,BUY,NVDA,NASDAQ,USD,2,180.00,0,TFSA,swing,1.37,,ABC123',
].join('\n') + '\n';
