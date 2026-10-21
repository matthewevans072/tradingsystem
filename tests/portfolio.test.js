import test from 'node:test';
import assert from 'node:assert/strict';
import { tempDb, putQuote } from './helpers.js';
import {
  addTransaction, computePortfolio, addSplit, changeSymbol, findInstrument, setCash, editTransaction, ensureInstrument,
} from '../server/portfolio.js';
import { openDb } from '../server/db.js';

const NOW = new Date('2026-10-21T18:00:00Z'); // 14:00 ET, regular session

test('average cost includes buy fees; sells realize against average cost', () => {
  const { db } = tempDb();
  addTransaction(db, { type: 'BUY', trade_date: '2026-01-05', symbol: 'abc', exchange: 'NASDAQ', currency: 'USD', quantity: 10, price: 100, fees: 5 });
  addTransaction(db, { type: 'BUY', trade_date: '2026-02-05', symbol: 'ABC', exchange: 'NASDAQ', currency: 'USD', quantity: 10, price: 120, fees: 5 });
  addTransaction(db, { type: 'SELL', trade_date: '2026-03-05', symbol: 'ABC', exchange: 'NASDAQ', currency: 'USD', quantity: 5, price: 130, fees: 2 });
  const inst = findInstrument(db, 'ABC', 'NASDAQ');
  putQuote(db, inst.id, { price: 125, prev_close: 120, quote_time: NOW.toISOString() });
  const p = computePortfolio(db, { now: NOW });
  const pos = p.positions[0];
  assert.equal(pos.shares, 15);
  assert.equal(pos.avgCost, 110.5); // (1005+1205)/20
  assert.equal(pos.costBasis, 1657.5);
  assert.equal(pos.realizedPL, 95.5); // 650-2-552.5
  assert.equal(pos.marketValue, 1875);
  assert.equal(pos.unrealizedPL, 217.5);
  assert.equal(pos.dailyPL, 75);
  assert.equal(p.totals.USD.marketValue, 1875);
  assert.equal(p.totals.CAD.marketValue, 0);
  assert.equal(p.combined, null, 'no FX rate => no combined total');
  assert.ok(p.limitations.some((l) => l.includes('exchange rate')));
});

test('daily P/L accounts for shares bought today', () => {
  const { db } = tempDb();
  addTransaction(db, { type: 'BUY', trade_date: '2026-10-01', symbol: 'XYZ', exchange: 'NYSE', currency: 'USD', quantity: 10, price: 50 });
  addTransaction(db, { type: 'BUY', trade_date: '2026-10-21', symbol: 'XYZ', exchange: 'NYSE', currency: 'USD', quantity: 10, price: 52 });
  const inst = findInstrument(db, 'XYZ', 'NYSE');
  putQuote(db, inst.id, { price: 53, prev_close: 51, quote_time: NOW.toISOString() });
  const pos = computePortfolio(db, { now: NOW }).positions[0];
  // held 10 from 51 -> 53 (+20) and bought 10 at 52 -> 53 (+10)
  assert.equal(pos.dailyPL, 30);
});

test('splits change share count but not total cost basis', () => {
  const { db } = tempDb();
  addTransaction(db, { type: 'BUY', trade_date: '2026-01-05', symbol: 'SPL', exchange: 'NASDAQ', currency: 'USD', quantity: 10, price: 400 });
  const inst = findInstrument(db, 'SPL', 'NASDAQ');
  addSplit(db, inst.id, '2026-06-10', 1, 4);
  assert.equal(addSplit(db, inst.id, '2026-06-10', 1, 4), false, 'duplicate split ignored');
  addTransaction(db, { type: 'BUY', trade_date: '2026-07-01', symbol: 'SPL', exchange: 'NASDAQ', currency: 'USD', quantity: 10, price: 110 });
  const pos = computePortfolio(db, { now: NOW }).positions[0];
  assert.equal(pos.shares, 50);
  assert.equal(pos.costBasis, 5100);
  assert.equal(pos.avgCost, 102);
});

test('symbol change keeps ledger and cost basis', () => {
  const { db } = tempDb();
  addTransaction(db, { type: 'BUY', trade_date: '2026-01-05', symbol: 'OLD', exchange: 'NYSE', currency: 'USD', quantity: 3, price: 10 });
  const inst = findInstrument(db, 'OLD', 'NYSE');
  changeSymbol(db, inst.id, 'NEW', '2026-05-01', 'rename');
  addTransaction(db, { type: 'BUY', trade_date: '2026-06-05', symbol: 'NEW', exchange: 'NYSE', currency: 'USD', quantity: 1, price: 14 });
  const ps = computePortfolio(db, { now: NOW }).positions;
  assert.equal(ps.length, 1);
  assert.equal(ps[0].symbol, 'NEW');
  assert.equal(ps[0].shares, 4);
  assert.equal(ps[0].costBasis, 44);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM symbol_history').get().n, 1);
});

test('currencies are kept separate; combined total requires timestamped FX', () => {
  const { db } = tempDb();
  addTransaction(db, { type: 'BUY', trade_date: '2026-01-05', symbol: 'U', exchange: 'NYSE', currency: 'USD', quantity: 10, price: 100, fx_rate_cad: 1.30 });
  addTransaction(db, { type: 'BUY', trade_date: '2026-01-05', symbol: 'C', exchange: 'TSX', currency: 'CAD', quantity: 10, price: 50 });
  setCash(db, { currency: 'CAD', amount: 200, asOf: '2026-10-20' });
  setCash(db, { currency: 'USD', amount: 0, asOf: '2026-10-20' });
  putQuote(db, findInstrument(db, 'U', 'NYSE').id, { price: 110, prev_close: 110, quote_time: NOW.toISOString() });
  putQuote(db, findInstrument(db, 'C', 'TSX').id, { price: 60, prev_close: 60, quote_time: NOW.toISOString() });
  db.prepare("INSERT INTO fx_rates VALUES ('USDCAD', 1.40, '2026-10-20', 'Bank of Canada', ?)").run(NOW.toISOString());
  const p = computePortfolio(db, { now: NOW });
  assert.equal(p.totals.USD.marketValue, 1100);
  assert.equal(p.totals.CAD.marketValue, 600);
  assert.equal(p.totals.CAD.cash, 200);
  assert.equal(p.combined.marketValue, 2140);
  assert.equal(p.combined.fxAsOf, '2026-10-20');
  const u = p.positions.find((x) => x.symbol === 'U');
  // total CAD gain = 1100*1.4 - 1000*1.3 = 240 = price 140 + currency 100
  assert.deepEqual(
    [u.fxDecomposition.totalCad, u.fxDecomposition.priceEffectCad, u.fxDecomposition.currencyEffectCad],
    [240, 140, 100]);
});

test('missing quotes are excluded from totals and reported, never estimated', () => {
  const { db } = tempDb();
  addTransaction(db, { type: 'BUY', trade_date: '2026-01-05', symbol: 'NOQ', exchange: 'NYSE', currency: 'USD', quantity: 1, price: 10 });
  const p = computePortfolio(db, { now: NOW });
  assert.equal(p.positions[0].marketValue, null);
  assert.equal(p.totals.USD.complete, false);
  assert.ok(p.limitations.some((l) => l.includes('NOQ')));
});

test('overselling is reported as an issue and does not create a short', () => {
  const { db } = tempDb();
  addTransaction(db, { type: 'BUY', trade_date: '2026-01-05', symbol: 'S', exchange: 'NYSE', currency: 'USD', quantity: 1, price: 10 });
  addTransaction(db, { type: 'SELL', trade_date: '2026-01-06', symbol: 'S', exchange: 'NYSE', currency: 'USD', quantity: 2, price: 10 });
  const p = computePortfolio(db, { now: NOW });
  assert.equal(p.issues.length, 1);
  assert.equal(p.positions[0].shares, 1);
});

test('instrument currency mismatch is rejected rather than guessed', () => {
  const { db } = tempDb();
  ensureInstrument(db, { symbol: 'CLS', exchange: 'TSX', currency: 'CAD' });
  assert.throws(() => ensureInstrument(db, { symbol: 'CLS', exchange: 'TSX', currency: 'USD' }), /CAD/);
  // Same ticker on a different exchange is a different instrument.
  const us = ensureInstrument(db, { symbol: 'CLS', exchange: 'NYSE', currency: 'USD' });
  assert.equal(us.currency, 'USD');
});

test('edits are audited and data persists across reopen', () => {
  const { db, file } = tempDb();
  const r = addTransaction(db, { type: 'BASELINE', trade_date: '2026-09-30', symbol: 'P', exchange: 'NYSE', currency: 'USD', quantity: 5, price: 20, unconfirmed_fields: ['price'] });
  editTransaction(db, r.id, { price: 21, unconfirmed_fields: [], _reason: 'confirmed from statement' });
  db.close();
  const db2 = openDb(file);
  const t = db2.prepare('SELECT * FROM transactions WHERE id = ?').get(r.id);
  assert.equal(t.price, 21);
  assert.equal(t.unconfirmed_fields, null);
  const audits = db2.prepare("SELECT * FROM audit_log WHERE entity = 'transaction'").all();
  assert.deepEqual(audits.map((a) => a.action), ['create', 'update']);
  assert.equal(JSON.parse(audits[1].before_json).price, 20);
});
