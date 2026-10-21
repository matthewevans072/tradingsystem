// Portfolio engine. Positions are derived from the transaction ledger with
// average-cost accounting (fees on buys are added to cost, fees on sells
// reduce proceeds). Splits are applied at their effective date so the total
// cost basis never changes when a split happens.
import crypto from 'node:crypto';
import { audit, nowIso, tx } from './db.js';
import { todayIn, zonedParts, NY, TORONTO } from './time.js';
import { exchangeGroup } from './calendar.js';
import { assessFreshness } from './freshness.js';

// How position weights are measured everywhere (Positions, rules, chat scenarios).
export const WEIGHT_BASIS = 'Share of the CAD-equivalent market value of priced holdings (cash and unpriced positions excluded), the same basis as Positions and the concentration rules';

const EPS = 1e-9;
export const TRADE_TYPES = ['BASELINE', 'BUY', 'SELL'];
export const CASH_TYPES = ['DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'INTEREST', 'FEE', 'FX_IN', 'FX_OUT'];

export function round(n, dp = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

// ---------- instruments ----------

export function findInstrument(db, symbol, exchange) {
  return db.prepare('SELECT * FROM instruments WHERE symbol = ? AND exchange = ?').get(symbol.toUpperCase(), exchange);
}

export function ensureInstrument(db, { symbol, exchange, currency, name, secType, identityStatus, identityNote, providerSymbol }) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('Symbol is required');
  if (!exchange) throw new Error(`Exchange is required for ${sym} (tickers can be ambiguous across exchanges)`);
  if (!['USD', 'CAD'].includes(currency)) throw new Error(`Currency must be USD or CAD for ${sym}`);
  const existing = findInstrument(db, sym, exchange);
  if (existing) {
    if (existing.currency !== currency) {
      throw new Error(`${sym} on ${exchange} is recorded as trading in ${existing.currency}, not ${currency}. Check the instrument before continuing.`);
    }
    return existing;
  }
  const r = db.prepare(`INSERT INTO instruments (symbol, exchange, currency, name, sec_type, provider_symbol, identity_status, identity_note, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    sym, exchange, currency, name || null, secType || 'stock', providerSymbol || null,
    identityStatus || 'needs_confirmation', identityNote || null, nowIso());
  const inst = db.prepare('SELECT * FROM instruments WHERE id = ?').get(r.lastInsertRowid);
  audit(db, 'instrument', inst.id, 'create', null, inst);
  return inst;
}

export function updateInstrument(db, id, patch) {
  const before = db.prepare('SELECT * FROM instruments WHERE id = ?').get(id);
  if (!before) throw new Error('Instrument not found');
  const allowed = ['name', 'sec_type', 'provider_symbol', 'identity_status', 'identity_note'];
  const sets = [], vals = [];
  for (const k of allowed) if (k in patch) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  if (!sets.length) return before;
  db.prepare(`UPDATE instruments SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  const after = db.prepare('SELECT * FROM instruments WHERE id = ?').get(id);
  audit(db, 'instrument', id, 'update', before, after);
  return after;
}

// Symbol change keeps the same instrument row, so the ledger and cost basis
// carry over untouched.
export function changeSymbol(db, instrumentId, newSymbol, effectiveDate, note) {
  return tx(db, () => {
    const inst = db.prepare('SELECT * FROM instruments WHERE id = ?').get(instrumentId);
    if (!inst) throw new Error('Instrument not found');
    const ns = String(newSymbol).trim().toUpperCase();
    if (findInstrument(db, ns, inst.exchange)) throw new Error(`${ns} already exists on ${inst.exchange}`);
    db.prepare('INSERT INTO symbol_history (instrument_id, old_symbol, new_symbol, effective_date, note, created_at) VALUES (?,?,?,?,?,?)')
      .run(instrumentId, inst.symbol, ns, effectiveDate, note || null, nowIso());
    db.prepare('UPDATE instruments SET symbol = ?, provider_symbol = NULL WHERE id = ?').run(ns, instrumentId);
    db.prepare('UPDATE watchlist SET symbol = ? WHERE symbol = ? AND exchange = ?').run(ns, inst.symbol, inst.exchange);
    const after = db.prepare('SELECT * FROM instruments WHERE id = ?').get(instrumentId);
    audit(db, 'instrument', instrumentId, 'symbol_change', inst, after, note);
    return after;
  });
}

export function addSplit(db, instrumentId, effectiveDate, ratioFrom, ratioTo, note, source) {
  if (!(ratioFrom > 0 && ratioTo > 0)) throw new Error('Split ratio must be positive (e.g. 1 -> 4 for a 4-for-1 split)');
  const r = db.prepare(`INSERT INTO corporate_actions (instrument_id, type, effective_date, ratio_from, ratio_to, note, source, created_at)
                        VALUES (?, 'SPLIT', ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(instrument_id, type, effective_date) DO NOTHING`)
    .run(instrumentId, effectiveDate, ratioFrom, ratioTo, note || null, source || 'manual', nowIso());
  if (r.changes) audit(db, 'corporate_action', r.lastInsertRowid, 'create', null, { instrumentId, effectiveDate, ratioFrom, ratioTo });
  return r.changes > 0;
}

// ---------- accounts & transactions ----------

export function ensureAccount(db, name, broker, accountType) {
  const n = (name || 'Main').trim();
  const ex = db.prepare('SELECT * FROM accounts WHERE name = ?').get(n);
  if (ex) return ex;
  const r = db.prepare('INSERT INTO accounts (name, broker, account_type, created_at) VALUES (?,?,?,?)')
    .run(n, broker || null, accountType || null, nowIso());
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(r.lastInsertRowid);
  audit(db, 'account', acc.id, 'create', null, acc);
  return acc;
}

export function hashTransaction(t, occurrence = 0) {
  const norm = [
    t.account, t.type, t.trade_date, (t.symbol || '').toUpperCase(), t.exchange || '',
    t.quantity == null ? '' : Number(t.quantity).toFixed(6),
    t.price == null ? '' : Number(t.price).toFixed(6),
    Number(t.fees || 0).toFixed(4),
    t.amount == null ? '' : Number(t.amount).toFixed(4),
    t.currency, t.external_id || '', occurrence,
  ].join('|');
  return crypto.createHash('sha256').update(norm).digest('hex');
}

export function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validateTransaction(t) {
  const errs = [];
  if (!TRADE_TYPES.includes(t.type) && !CASH_TYPES.includes(t.type)) errs.push(`Unknown type "${t.type}"`);
  if (!isRealDate(t.trade_date)) errs.push('Date must be a real date in YYYY-MM-DD form');
  if (!['USD', 'CAD'].includes(t.currency)) errs.push('Currency must be USD or CAD');
  if (TRADE_TYPES.includes(t.type)) {
    if (!t.symbol) errs.push('Symbol required');
    if (!t.exchange) errs.push('Exchange required');
    if (!(Number(t.quantity) > 0)) errs.push('Quantity must be positive');
    if (!(Number(t.price) >= 0) || t.price === '' || t.price == null) errs.push('Price required');
  } else if (!(Number(t.amount) > 0)) {
    errs.push('Amount must be positive');
  }
  if (t.fees != null && t.fees !== '' && !(Number(t.fees) >= 0)) errs.push('Fees cannot be negative');
  return errs;
}

// Insert one transaction. Returns { inserted, duplicate, id }.
export function addTransaction(db, t, { source = 'manual', batchId = null, occurrence = 0, manualUnique = true } = {}) {
  const errs = validateTransaction(t);
  if (errs.length) throw new Error(errs.join('; '));
  const acc = ensureAccount(db, t.account || 'Main');
  let instId = null;
  if (TRADE_TYPES.includes(t.type)) {
    const inst = ensureInstrument(db, {
      symbol: t.symbol, exchange: t.exchange, currency: t.currency,
      name: t.name, secType: t.sec_type,
    });
    instId = inst.id;
  }
  // Manual entries are intentional, so identical manual rows are allowed;
  // file imports are deduplicated by content (+ occurrence within the file).
  const hash = manualUnique && source === 'manual'
    ? crypto.randomUUID()
    : hashTransaction({ ...t, account: acc.name }, occurrence);
  const r = db.prepare(`INSERT INTO transactions
      (account_id, instrument_id, type, trade_date, quantity, price, fees, amount, currency, fx_rate_cad, note, source,
       import_batch_id, external_id, dedupe_hash, unconfirmed_fields, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(dedupe_hash) DO NOTHING`).run(
    acc.id, instId, t.type, t.trade_date,
    t.quantity == null || t.quantity === '' ? null : Number(t.quantity),
    t.price == null || t.price === '' ? null : Number(t.price),
    Number(t.fees || 0),
    t.amount == null || t.amount === '' ? null : Number(t.amount),
    t.currency,
    t.fx_rate_cad ? Number(t.fx_rate_cad) : null,
    t.note || null, source, batchId, t.external_id || null, hash,
    t.unconfirmed_fields?.length ? JSON.stringify(t.unconfirmed_fields) : null,
    nowIso());
  if (!r.changes) return { inserted: false, duplicate: true };
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(r.lastInsertRowid);
  audit(db, 'transaction', row.id, 'create', null, row, source);
  if (instId && t.strategy) setStrategy(db, acc.id, instId, t.strategy);
  return { inserted: true, duplicate: false, id: row.id };
}

export function editTransaction(db, id, patch) {
  return tx(db, () => {
    const before = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!before) throw new Error('Transaction not found');
    if (before.voided_at) throw new Error('Transaction is voided');
    const allowed = { trade_date: 'trade_date', quantity: 'quantity', price: 'price', fees: 'fees', amount: 'amount', note: 'note', fx_rate_cad: 'fx_rate_cad', unconfirmed_fields: 'unconfirmed_fields' };
    const sets = [], vals = [];
    for (const [k, col] of Object.entries(allowed)) {
      if (k in patch) {
        sets.push(`${col} = ?`);
        let v = patch[k];
        if (k === 'unconfirmed_fields') v = v && v.length ? JSON.stringify(v) : null;
        else if (['quantity', 'price', 'fees', 'amount', 'fx_rate_cad'].includes(k)) v = v === '' || v == null ? null : Number(v);
        vals.push(v);
      }
    }
    if (!sets.length) return before;
    db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    const after = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    const check = validateTransaction({ ...after, symbol: 'X', exchange: 'X', fees: after.fees });
    if (check.length) throw new Error(check.join('; '));
    audit(db, 'transaction', id, 'update', before, after, patch._reason);
    return after;
  });
}

export function voidTransaction(db, id, reason) {
  const before = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!before) throw new Error('Transaction not found');
  db.prepare('UPDATE transactions SET voided_at = ? WHERE id = ?').run(nowIso(), id);
  audit(db, 'transaction', id, 'void', before, null, reason);
}

export function setStrategy(db, accountId, instrumentId, strategy, thesis) {
  if (!['long_term', 'swing', 'unclassified'].includes(strategy)) throw new Error('Strategy must be long_term, swing or unclassified');
  const before = db.prepare('SELECT * FROM position_meta WHERE account_id = ? AND instrument_id = ?').get(accountId, instrumentId);
  db.prepare(`INSERT INTO position_meta (account_id, instrument_id, strategy, thesis, updated_at) VALUES (?,?,?,?,?)
              ON CONFLICT(account_id, instrument_id) DO UPDATE SET strategy = excluded.strategy,
              thesis = COALESCE(excluded.thesis, position_meta.thesis), updated_at = excluded.updated_at`)
    .run(accountId, instrumentId, strategy, thesis ?? null, nowIso());
  audit(db, 'position_meta', `${accountId}:${instrumentId}`, 'update', before, { strategy, thesis });
}

// ---------- position derivation ----------

export function deriveLedger(db, { asOf } = {}) {
  const txs = db.prepare(`SELECT t.*, a.name AS account_name FROM transactions t JOIN accounts a ON a.id = t.account_id
                          WHERE t.voided_at IS NULL ${asOf ? 'AND t.trade_date <= ?' : ''}
                          ORDER BY t.trade_date, t.id`).all(...(asOf ? [asOf] : []));
  const splits = db.prepare(`SELECT * FROM corporate_actions WHERE type = 'SPLIT' ${asOf ? 'AND effective_date <= ?' : ''}
                             ORDER BY effective_date`).all(...(asOf ? [asOf] : []));
  const lots = new Map(); // key account:instrument
  const issues = [];
  const cashFlows = { USD: [], CAD: [] };

  const timeline = [
    ...txs.map((t) => ({ date: t.trade_date, order: 1, t })),
    // splits take effect at the start of their effective date
    ...splits.map((s) => ({ date: s.effective_date, order: 0, s })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));

  for (const ev of timeline) {
    if (ev.s) {
      const ratio = ev.s.ratio_to / ev.s.ratio_from;
      for (const p of lots.values()) {
        if (p.instrument_id === ev.s.instrument_id && p.shares > EPS) {
          p.shares *= ratio;
          p.splitsApplied.push({ date: ev.s.effective_date, ratio: `${ev.s.ratio_from}:${ev.s.ratio_to}` });
        }
      }
      continue;
    }
    const t = ev.t;
    if (!t.instrument_id) {
      cashFlows[t.currency]?.push({ type: t.type, date: t.trade_date, amount: t.amount, account: t.account_name });
      continue;
    }
    const key = `${t.account_id}:${t.instrument_id}`;
    if (!lots.has(key)) {
      lots.set(key, {
        account_id: t.account_id, account: t.account_name, instrument_id: t.instrument_id,
        shares: 0, cost: 0, realized: 0, fees: 0, firstDate: t.trade_date, lastDate: t.trade_date,
        hasBaseline: false, unconfirmed: new Set(), splitsApplied: [], txCount: 0,
        buyCostCad: 0, buyCostCadKnown: true,
      });
    }
    const p = lots.get(key);
    p.txCount += 1;
    p.lastDate = t.trade_date;
    if (t.unconfirmed_fields) for (const f of JSON.parse(t.unconfirmed_fields)) p.unconfirmed.add(f);
    if (t.type === 'BUY' || t.type === 'BASELINE') {
      if (p.shares <= EPS) { p.firstDate = t.trade_date; p.cost = 0; p.shares = 0; p.buyCostCad = 0; p.buyCostCadKnown = true; }
      const c = t.quantity * t.price + t.fees;
      p.shares += t.quantity;
      p.cost += c;
      p.fees += t.fees;
      if (t.type === 'BASELINE') p.hasBaseline = true;
      if (t.currency === 'CAD') p.buyCostCad += c;
      else if (t.fx_rate_cad) p.buyCostCad += c * t.fx_rate_cad;
      else p.buyCostCadKnown = false;
    } else if (t.type === 'SELL') {
      if (t.quantity > p.shares + EPS) {
        issues.push({ level: 'error', instrument_id: t.instrument_id, transaction_id: t.id,
          message: `Sell of ${t.quantity} on ${t.trade_date} exceeds ${round(p.shares, 6)} shares held. Short positions are not supported; check the ledger.` });
        continue;
      }
      const avg = p.shares > EPS ? p.cost / p.shares : 0;
      const frac = p.shares > EPS ? t.quantity / p.shares : 0;
      p.realized += t.quantity * t.price - t.fees - avg * t.quantity;
      p.fees += t.fees;
      p.cost -= avg * t.quantity;
      p.buyCostCad -= p.buyCostCad * frac;
      p.shares -= t.quantity;
      if (p.shares < EPS) { p.shares = 0; p.cost = 0; p.buyCostCad = 0; }
    }
  }
  return { lots: [...lots.values()], issues, cashFlows };
}

// Shares held at the end of a given date (used for daily P/L).
function sharesAt(lotsByDate, key) {
  return lotsByDate.get(key)?.shares ?? 0;
}

export function latestFx(db, pair = 'USDCAD') {
  return db.prepare('SELECT * FROM fx_rates WHERE pair = ? ORDER BY as_of DESC, fetched_at DESC LIMIT 1').get(pair) || null;
}

export function latestCash(db) {
  // Most recent balance per account+currency.
  return db.prepare(`SELECT c.*, a.name AS account FROM cash_balances c JOIN accounts a ON a.id = c.account_id
                     WHERE c.id IN (SELECT MAX(id) FROM cash_balances GROUP BY account_id, currency)
                     ORDER BY a.name, c.currency`).all();
}

export function setCash(db, { account, currency, amount, asOf, source = 'manual', confirmed = true }) {
  if (!['USD', 'CAD'].includes(currency)) throw new Error('Currency must be USD or CAD');
  if (!Number.isFinite(Number(amount))) throw new Error('Amount must be a number');
  const acc = ensureAccount(db, account || 'Main');
  const r = db.prepare('INSERT INTO cash_balances (account_id, currency, amount, as_of, source, confirmed, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(acc.id, currency, Number(amount), asOf || todayIn(NY), source, confirmed ? 1 : 0, nowIso());
  audit(db, 'cash_balance', r.lastInsertRowid, 'create', null, { account: acc.name, currency, amount, asOf, confirmed });
}

// Full valuation used by the dashboard, briefings and assessments.
export function computePortfolio(db, { now = new Date(), catalog = null } = {}) {
  const today = todayIn(NY, now);
  const { lots, issues, cashFlows } = deriveLedger(db);
  // Daily P/L is measured over the session the quote belongs to: shares held
  // at the start and end of that session date, and trades dated that day,
  // against the quote's previous close. (Outside market hours the latest quote
  // belongs to the last session, not to the calendar day, and trades dated
  // after that session are not part of its P/L.)
  const ledgerCache = new Map();
  const ledgerAsOf = (date) => {
    if (!ledgerCache.has(date)) {
      const led = deriveLedger(db, { asOf: date });
      ledgerCache.set(date, new Map(led.lots.map((l) => [`${l.account_id}:${l.instrument_id}`, l])));
    }
    return ledgerCache.get(date);
  };
  const tradesOn = db.prepare(`SELECT * FROM transactions WHERE voided_at IS NULL AND trade_date = ? AND account_id = ? AND instrument_id = ? AND type IN ('BUY','SELL','BASELINE')`);
  const instruments = new Map(db.prepare('SELECT * FROM instruments').all().map((i) => [i.id, i]));
  const quotes = new Map(db.prepare('SELECT * FROM quotes').all().map((q) => [q.instrument_id, q]));
  const meta = new Map(db.prepare('SELECT * FROM position_meta').all().map((m) => [`${m.account_id}:${m.instrument_id}`, m]));
  const fx = latestFx(db);

  const positions = [];
  const closed = [];
  for (const l of lots) {
    const inst = instruments.get(l.instrument_id);
    const key = `${l.account_id}:${l.instrument_id}`;
    const m = meta.get(key);
    const base = {
      key, account: l.account, account_id: l.account_id, instrument_id: l.instrument_id,
      symbol: inst.symbol, exchange: inst.exchange, currency: inst.currency, name: inst.name,
      secType: inst.sec_type, identityStatus: inst.identity_status, identityNote: inst.identity_note,
      strategy: m?.strategy || 'unclassified', thesis: m?.thesis || null,
      realizedPL: round(l.realized), fees: round(l.fees), hasBaseline: l.hasBaseline,
      unconfirmed: [...l.unconfirmed], splitsApplied: l.splitsApplied, firstDate: l.firstDate,
    };
    if (l.shares <= EPS) { closed.push(base); continue; }
    const q = quotes.get(l.instrument_id);
    const avgCost = l.cost / l.shares;
    const pos = { ...base, shares: round(l.shares, 6), avgCost: round(avgCost, 4), avgCostExact: avgCost, costBasis: round(l.cost) };
    if (q && q.price != null) {
      const mv = l.shares * q.price;
      pos.price = q.price;
      pos.marketValue = round(mv);
      pos.unrealizedPL = round(mv - l.cost);
      pos.unrealizedPct = l.cost > 0 ? round(((mv - l.cost) / l.cost) * 100) : null;
      if (q.prev_close != null) {
        const sessionDate = q.quote_time ? zonedParts(new Date(q.quote_time), exchangeGroup(inst.exchange) === 'TSX' ? TORONTO : NY).date : today;
        const sStart = sharesAt(ledgerAsOf(prevDate(sessionDate)), key);
        const sEnd = sessionDate >= today ? l.shares : sharesAt(ledgerAsOf(sessionDate), key);
        let flows = 0, bought = 0;
        for (const t of tradesOn.all(sessionDate, l.account_id, l.instrument_id)) {
          flows += (t.type === 'SELL' ? 1 : -1) * t.quantity * t.price;
          if (t.type !== 'SELL') bought += t.quantity * t.price;
        }
        const daily = sEnd * q.price - sStart * q.prev_close + flows;
        pos.dailyPL = round(daily);
        pos.dailyPLSession = sessionDate;
        pos.dailyPLStartValue = sStart * q.prev_close + bought;
        if (Math.abs(sEnd - l.shares) > EPS) pos.dailyPLNote = `Trades dated after the ${sessionDate} session are not part of that session's P/L.`;
        const startValue = sStart * q.prev_close;
        pos.dailyPct = startValue > 0 ? round((daily / startValue) * 100) : (q.change_pct ?? null);
      }
      pos.quote = publicQuote(q, now, inst.exchange);
    } else {
      pos.price = null; pos.marketValue = null; pos.unrealizedPL = null; pos.unrealizedPct = null; pos.dailyPL = null;
      pos.quote = q ? publicQuote(q, now, inst.exchange) : null;
    }
    // CAD-equivalent split into price vs currency effect (USD positions only).
    if (inst.currency === 'USD' && fx && pos.marketValue != null) {
      pos.cadEquivalent = round(pos.marketValue * fx.rate);
      if (l.buyCostCadKnown && l.buyCostCad > 0) {
        const avgFx = l.buyCostCad / l.cost;
        pos.fxDecomposition = {
          totalCad: round(pos.marketValue * fx.rate - l.buyCostCad),
          priceEffectCad: round((pos.marketValue - l.cost) * fx.rate),
          currencyEffectCad: round(l.cost * (fx.rate - avgFx)),
          avgPurchaseFx: round(avgFx, 4),
        };
      } else {
        pos.fxDecomposition = null;
        pos.fxNote = 'Purchase-date exchange rates are missing for some buys, so the currency effect on this position cannot be separated from the price return.';
      }
    }
    const cat = catalog?.lookup(inst.symbol, inst.exchange);
    pos.sector = cat?.category || null;
    positions.push(pos);
  }

  // Totals per currency, never mixed.
  const cash = latestCash(db);
  const totals = {};
  for (const ccy of ['USD', 'CAD']) {
    const ps = positions.filter((p) => p.currency === ccy);
    const priced = ps.filter((p) => p.marketValue != null);
    const cashAmt = cash.filter((c) => c.currency === ccy).reduce((s, c) => s + c.amount, 0);
    const cashRows = cash.filter((c) => c.currency === ccy);
    totals[ccy] = {
      positions: ps.length,
      pricedPositions: priced.length,
      marketValue: round(priced.reduce((s, p) => s + p.marketValue, 0)),
      costBasis: round(ps.reduce((s, p) => s + p.costBasis, 0)),
      costBasisPriced: round(priced.reduce((s, p) => s + p.costBasis, 0)),
      unrealizedPL: round(priced.reduce((s, p) => s + p.unrealizedPL, 0)),
      dailyPL: round(priced.filter((p) => p.dailyPL != null).reduce((s, p) => s + p.dailyPL, 0)),
      dailyPLStartValue: priced.filter((p) => p.dailyPL != null).reduce((s, p) => s + p.dailyPLStartValue, 0),
      dailyPLPositions: priced.filter((p) => p.dailyPL != null).length,
      realizedPL: round([...positions, ...closed].filter((p) => p.currency === ccy).reduce((s, p) => s + (p.realizedPL || 0), 0)),
      cash: cashRows.length ? round(cashAmt) : null,
      cashAsOf: cashRows.length ? cashRows.map((c) => c.as_of).sort().at(-1) : null,
      cashConfirmed: cashRows.length ? cashRows.every((c) => c.confirmed) : false,
      complete: priced.length === ps.length,
    };
    const t = totals[ccy];
    t.unrealizedPct = t.costBasisPriced > 0 ? round((t.unrealizedPL / t.costBasisPriced) * 100) : null;
    // Percentage over the positions that have a measurable daily change only.
    t.dailyPct = t.dailyPLStartValue > 0 ? round((t.dailyPL / t.dailyPLStartValue) * 100) : null;
    t.dailyPLStartValue = round(t.dailyPLStartValue);
  }

  // Combined view only with a timestamped FX rate.
  let combined = null;
  if (fx) {
    const r = fx.rate;
    const mvCad = (totals.CAD.marketValue || 0) + (totals.USD.marketValue || 0) * r;
    const cashCad = (totals.CAD.cash || 0) + (totals.USD.cash || 0) * r;
    combined = {
      currency: 'CAD', fxRate: r, fxAsOf: fx.as_of, fxSource: fx.source,
      marketValue: round(mvCad), cash: round(cashCad), total: round(mvCad + cashCad),
      complete: totals.USD.complete && totals.CAD.complete,
      weightBasis: WEIGHT_BASIS,
    };
    for (const p of positions) {
      if (p.marketValue == null) continue;
      p.weightPct = mvCad > 0 ? round(((p.currency === 'USD' ? p.marketValue * r : p.marketValue) / mvCad) * 100, 1) : null;
    }
  }
  for (const p of positions) {
    if (p.marketValue != null) {
      const t = totals[p.currency].marketValue;
      p.weightInCurrencyPct = t > 0 ? round((p.marketValue / t) * 100, 1) : null;
    }
  }

  const limitations = [];
  if (positions.some((p) => p.hasBaseline)) {
    limitations.push('Some positions start from a dated snapshot (baseline) rather than full trade history, so lifetime and time-weighted returns cannot be calculated. Unrealized P/L is measured from the recorded average cost.');
  }
  const depositsKnown = cashFlows.USD.length + cashFlows.CAD.length > 0;
  if (!depositsKnown) {
    limitations.push('No deposit or withdrawal history is recorded, so investment returns cannot be separated from money added or removed. Figures shown are price-based P/L on current holdings.');
  }
  if (!fx) limitations.push('No USD/CAD exchange rate is stored yet, so USD and CAD totals are shown separately and not combined.');
  if (positions.some((p) => p.currency === 'USD' && p.fxNote)) {
    limitations.push('Currency effects on USD holdings cannot be fully separated from price returns because purchase-date exchange rates are missing for some buys.');
  }
  const unpriced = positions.filter((p) => p.marketValue == null);
  if (unpriced.length) limitations.push(`${unpriced.length} position(s) have no valid quote and are excluded from market value totals: ${unpriced.map((p) => p.symbol).join(', ')}.`);

  return { asOf: now.toISOString(), today, positions, closed, totals, combined, fx, cash, issues, limitations };
}

function prevDate(d) {
  const t = new Date(d + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

// Staleness rules live in freshness.js and are documented in START-HERE.md.
export function publicQuote(q, now = new Date(), exchange = 'NYSE') {
  if (!q) return null;
  const ageMin = q.quote_time ? (now - new Date(q.quote_time)) / 60000 : null;
  const f = assessFreshness(q, now, exchange);
  return {
    provider: q.provider, price: q.price, prevClose: q.prev_close, change: q.change, changePct: q.change_pct,
    open: q.open, high: q.high, low: q.low, volume: q.volume, avgVolume: q.avg_volume,
    ext: q.ext_price != null ? { price: q.ext_price, changePct: q.ext_change_pct, session: q.ext_session, time: q.ext_time } : null,
    session: q.session, quoteTime: q.quote_time, fetchedAt: q.fetched_at,
    timeliness: q.timeliness, delayMinutes: q.delay_minutes,
    lastError: q.last_error, lastErrorAt: q.last_error_at,
    ageMinutes: ageMin == null ? null : Math.round(ageMin),
    freshness: f.freshness,
    freshnessReason: f.reason,
  };
}
