// Portfolio maths, market data and model backend fixes: daily P/L on a
// split's effective date and its denominator, earnings by listing (symbol +
// exchange), every Bank of Canada observation stored, and the spend record
// (partial usage of a dropped stream, rejected options, a corrupt file).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tempDb, tempDir, putQuote } from './helpers.js';
import { makeCtx } from './agent-helpers.js';
import { addTransaction, addSplit, computePortfolio, findInstrument, updateInstrument, latestFx } from '../server/portfolio.js';
import { refreshEarnings, refreshFx } from '../server/marketdata.js';
import { createFinnhub } from '../server/providers/finnhub.js';
import { createTwelveData } from '../server/providers/twelvedata.js';
import { createBankOfCanada } from '../server/providers/boc.js';
import { createToolbox } from '../server/agent/tools.js';
import { Ledger } from '../server/agent/ledger.js';
import { loadConfig } from '../server/config.js';
import { createBackend, budgetCheck, spentToday, recordUsage } from '../server/agent/backend.js';
import { toolsForApi } from '../server/agent/tools.js';
import { getSetting } from '../server/db.js';
import { zonedToUtc, todayIn, addDays, NY } from '../server/time.js';

// ---------- daily P/L ----------

function holding(db, { symbol = 'NBIS', exchange = 'NASDAQ', quantity = 10, price = 90, date = '2026-10-01' } = {}) {
  addTransaction(db, { type: 'BUY', trade_date: date, symbol, exchange, currency: 'USD', quantity, price, fees: 0 });
  return findInstrument(db, symbol, exchange);
}

test('daily P/L on a split\'s effective date counts the start shares in post-split units', () => {
  const { db } = tempDb();
  const i = holding(db);
  addSplit(db, i.id, '2026-10-20', 1, 2);
  // The feed's previous close is split-adjusted on the ex-date: 51 vs 50, +2%.
  putQuote(db, i.id, { price: 51, prev_close: 50, change_pct: 2, quote_time: zonedToUtc('2026-10-20', 11, 0).toISOString() });
  let p = computePortfolio(db, { now: zonedToUtc('2026-10-20', 11, 5) });
  let pos = p.positions[0];
  assert.equal(pos.shares, 20);
  assert.equal(pos.dailyPL, 20, '20 x (51 - 50), not 20 x 51 - 10 x 50');
  assert.equal(pos.dailyPct, 2);
  assert.equal(p.totals.USD.dailyPct, 2);
  // Shares bought on the ex-date count from their price; the start is still post-split.
  addTransaction(db, { type: 'BUY', trade_date: '2026-10-20', symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', quantity: 4, price: 50.5, fees: 0 });
  pos = computePortfolio(db, { now: zonedToUtc('2026-10-20', 11, 5) }).positions[0];
  assert.equal(pos.dailyPL, 22); // 24 x 51 - 20 x 50 - 4 x 50.5
  assert.equal(pos.dailyPct, 1.83); // 22 / (1000 + 202)
  // The next session is unaffected.
  putQuote(db, i.id, { price: 52, prev_close: 51, quote_time: zonedToUtc('2026-10-21', 11, 0).toISOString() });
  pos = computePortfolio(db, { now: zonedToUtc('2026-10-21', 11, 5) }).positions[0];
  assert.deepEqual([pos.dailyPL, pos.dailyPct], [24, 1.96]);
});

test('a reverse split on the session date is converted the same way', () => {
  const { db } = tempDb();
  const i = holding(db);
  addSplit(db, i.id, '2026-10-20', 2, 1);
  putQuote(db, i.id, { price: 102, prev_close: 100, quote_time: zonedToUtc('2026-10-20', 11, 0).toISOString() });
  const pos = computePortfolio(db, { now: zonedToUtc('2026-10-20', 11, 5) }).positions[0];
  assert.deepEqual([pos.shares, pos.dailyPL, pos.dailyPct], [5, 10, 2]);
});

test('a quote from before a split values the post-split shares at the converted price', () => {
  const { db } = tempDb();
  const i = holding(db);
  addSplit(db, i.id, '2026-10-21', 1, 2);
  // Before Wednesday's open the stored quote is still Tuesday's close, in pre-split units.
  putQuote(db, i.id, { price: 102, prev_close: 100, change_pct: 2, high: 103, quote_time: zonedToUtc('2026-10-20', 16, 0).toISOString() });
  let p = computePortfolio(db, { now: zonedToUtc('2026-10-21', 8, 30) });
  let pos = p.positions[0];
  assert.equal(pos.shares, 20);
  assert.deepEqual([pos.price, pos.marketValue, pos.unrealizedPL], [51, 1020, 120], '20 x 51, not 20 x 102');
  assert.equal(p.totals.USD.marketValue, 1020);
  assert.deepEqual([pos.quote.price, pos.quote.prevClose, pos.quote.high, pos.quote.preSplit.price], [51, 50, 51.5, 102]);
  assert.match(pos.priceNote, /before the split effective 2026-10-21 \(1:2\)/);
  assert.deepEqual([pos.dailyPL, pos.dailyPct, pos.dailyPLNote], [20, 2, undefined], 'Tuesday\'s P/L in Tuesday\'s units, and no trade note for a split');
  // A quote from the split's first session is already post-split.
  putQuote(db, i.id, { price: 51.5, prev_close: 51, quote_time: zonedToUtc('2026-10-21', 10, 0).toISOString() });
  pos = computePortfolio(db, { now: zonedToUtc('2026-10-21', 10, 5) }).positions[0];
  assert.deepEqual([pos.price, pos.marketValue, pos.priceNote, pos.quote.preSplit], [51.5, 1030, undefined, undefined]);
});

test('position daily % uses the same denominator as the totals, including same-day buys', () => {
  const { db } = tempDb();
  const i = holding(db, { quantity: 100 });
  addTransaction(db, { type: 'BUY', trade_date: '2026-10-21', symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', quantity: 100, price: 100, fees: 0 });
  const now = zonedToUtc('2026-10-21', 14, 0);
  putQuote(db, i.id, { price: 101, prev_close: 98, change_pct: 3.06, quote_time: now.toISOString() });
  const p = computePortfolio(db, { now });
  const pos = p.positions[0];
  assert.equal(pos.dailyPL, 400);
  assert.equal(pos.dailyPct, 2.02, '400 / (100 x 98 + 100 x 100), not 400 / (100 x 98)');
  assert.equal(pos.dailyPct, p.totals.USD.dailyPct);
});

test('a position bought on the session date measures its % from the price paid, not the stock\'s change', () => {
  const { db } = tempDb();
  const i = holding(db, { quantity: 10, price: 100, date: '2026-10-21' });
  const now = zonedToUtc('2026-10-21', 14, 0);
  putQuote(db, i.id, { price: 101, prev_close: 98, change_pct: 3.06, quote_time: now.toISOString() });
  const pos = computePortfolio(db, { now }).positions[0];
  assert.deepEqual([pos.dailyPL, pos.dailyPct], [10, 1]);
});

test('a position not held during the quote\'s session has no daily change rather than the stock\'s', () => {
  const { db } = tempDb();
  // Bought Wednesday before the open; the stored quote is still Tuesday's close (+10.53%).
  const i = holding(db, { quantity: 10, price: 105, date: '2026-10-21' });
  putQuote(db, i.id, { price: 105, prev_close: 95, change_pct: 10.53, quote_time: zonedToUtc('2026-10-20', 16, 0).toISOString() });
  const p = computePortfolio(db, { now: zonedToUtc('2026-10-21', 8, 30) });
  const pos = p.positions[0];
  assert.equal(pos.dailyPL, null);
  assert.equal(pos.dailyPct, null);
  assert.match(pos.dailyPLNote, /Not held during the 2026-10-20 session/);
  assert.equal(p.totals.USD.dailyPLPositions, 0);
  assert.equal(p.totals.USD.dailyPct, null);
  assert.equal(pos.marketValue, 1050, 'the position is still valued');
});

// ---------- earnings by listing ----------

const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
const today = todayIn(NY);

function listingCtx() {
  const ctx = makeCtx();
  ctx.db.prepare('DELETE FROM watchlist').run();
  const own = (symbol, exchange, currency) => {
    addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-01', account: 'TFSA', symbol, exchange, currency, quantity: 10, price: 20, fees: 0 });
    const i = findInstrument(ctx.db, symbol, exchange);
    updateInstrument(ctx.db, i.id, { identity_status: 'confirmed', identity_note: 't' });
    return i;
  };
  const watch = (symbol, exchange) => ctx.db.prepare("INSERT INTO watchlist (symbol, exchange, category, added_at) VALUES (?, ?, 'x', ?)").run(symbol, exchange, new Date().toISOString());
  return { ctx, own, watch };
}

const earningsRows = (ctx, cols = 'symbol, instrument_id') => ctx.db.prepare(`SELECT ${cols} FROM events WHERE type = 'earnings' ORDER BY date`).all().map((x) => ({ ...x }));

async function eventsTool(ctx, symbols) {
  const h = createToolbox(ctx, { ledger: new Ledger(), turn: { conversationId: 1, userText: 'x', now: new Date(), scenarios: [], priorScenarioCount: 0, proposals: [] } });
  return h.get_events({ symbols, days_ahead: 60, days_back: 7, refresh: false });
}

test('Finnhub earnings: TSX listings are not covered and never get a US company\'s date', async () => {
  const { ctx, own, watch } = listingCtx();
  const telus = own('T', 'TSX', 'CAD');
  const nbis = own('NBIS', 'NASDAQ', 'USD');
  watch('HPS.A', 'TSX');
  // A stale date stored earlier by the bare-ticker query (AT&T's, linked to TELUS).
  ctx.db.prepare("INSERT INTO events (instrument_id, symbol, type, date, title, source, fetched_at) VALUES (?, 'T', 'earnings', ?, 'T earnings', 'Finnhub earnings calendar', ?)").run(telus.id, addDays(today, 1), new Date().toISOString());
  const asked = [];
  const cal = { T: [{ symbol: 'T', date: addDays(today, 1), hour: 'bmo' }], NBIS: [{ symbol: 'NBIS', date: addDays(today, 20), hour: 'amc' }] };
  ctx.providers.earnings = createFinnhub({ apiKey: 'k', plan: { perMinute: 1000 }, fetchImpl: async (url) => {
    const s = new URL(url).searchParams.get('symbol');
    asked.push(s);
    return ok({ earningsCalendar: cal[s] || [] });
  } });
  const r = await refreshEarnings(ctx);
  assert.deepEqual(asked, ['NBIS'], 'TSX listings are not sent as bare tickers');
  assert.deepEqual(r.notCovered.map((n) => [n.symbol, n.reason]).sort(), [['HPS.A', 'non-US listing not covered by Finnhub'], ['T', 'non-US listing not covered by Finnhub']]);
  assert.deepEqual(earningsRows(ctx), [{ symbol: 'NBIS', instrument_id: nbis.id }], 'the stale AT&T date is dropped from TELUS');
  const cov = getSetting(ctx.db, 'earningsCoverage');
  assert.ok(cov.bySymbol.NBIS && !cov.bySymbol.T && !cov.bySymbol['HPS.A']);
  assert.equal(cov.notCovered.T.reason, 'non-US listing not covered by Finnhub');
  const ev = await eventsTool(ctx, ['T', 'HPS.A', 'NBIS']);
  const c = Object.fromEntries(ev.coverage.map((x) => [x.symbol, x]));
  assert.equal(c.T.earningsCalendarChecked, false);
  assert.equal(c['HPS.A'].earningsCalendarChecked, false);
  assert.equal(c['HPS.A'].noEventsRef, null, 'no citable "checked, no date" for a listing that was not checked');
  assert.equal(c.NBIS.earningsCalendarChecked, true);
  // A refresh of one ticker keeps the others' record and does not mark the TSX one checked.
  await refreshEarnings(ctx, { symbols: ['HPS.A'] });
  const cov2 = getSetting(ctx.db, 'earningsCoverage');
  assert.ok(cov2.bySymbol.NBIS && !cov2.bySymbol['HPS.A'] && cov2.notCovered['HPS.A'] && cov2.notCovered.T);
});

test('Finnhub earnings: with T held on both exchanges, the date goes to the NYSE listing and T is not "checked"', async () => {
  const { ctx, own } = listingCtx();
  own('T', 'TSX', 'CAD');
  const att = own('T', 'NYSE', 'USD');
  ctx.providers.earnings = createFinnhub({ apiKey: 'k', plan: { perMinute: 1000 }, fetchImpl: async (url) => ok({ earningsCalendar: new URL(url).searchParams.get('symbol') === 'T' ? [{ symbol: 'T', date: addDays(today, 1), hour: 'bmo' }] : [] }) });
  await refreshEarnings(ctx);
  assert.deepEqual(earningsRows(ctx), [{ symbol: 'T', instrument_id: att.id }]);
  assert.equal(getSetting(ctx.db, 'earningsCoverage').bySymbol.T, undefined, 'one listing of T was not checked');
});

test('Twelve Data earnings: rows match by exchange, and TSX listings are not covered when the calendar has no Canadian rows', async () => {
  const { ctx, own, watch } = listingCtx();
  own('T', 'TSX', 'CAD');
  const nbis = own('NBIS', 'NASDAQ', 'USD');
  watch('HPS.A', 'TSX');
  const usOnly = { earnings: {
    [addDays(today, 1)]: [{ symbol: 'T', exchange: 'NYSE', country: 'United States', time: 'Pre Market' }],
    [addDays(today, 20)]: [{ symbol: 'NBIS', exchange: 'NASDAQ', time: 'After Hours' }, { symbol: 'NBIS', exchange: 'LSE', time: '' }],
  } };
  ctx.providers.earnings = createTwelveData({ apiKey: 'k', plan: { perMinute: 1000, perDay: 100000 }, fetchImpl: async () => ok(usOnly) });
  const r = await refreshEarnings(ctx);
  assert.deepEqual(r.notCovered.map((n) => [n.symbol, n.reason]).sort(), [['HPS.A', 'non-US listing not covered by Twelve Data'], ['T', 'non-US listing not covered by Twelve Data']]);
  assert.deepEqual(earningsRows(ctx, 'symbol, date, instrument_id'), [{ symbol: 'NBIS', date: addDays(today, 20), instrument_id: nbis.id }]);
});

test('Twelve Data earnings: with Canadian rows, a TSX ticker gets its own row and not the US one', async () => {
  const { ctx, own } = listingCtx();
  const telus = own('T', 'TSX', 'CAD');
  own('MG', 'TSX', 'CAD');
  const withCanada = { earnings: {
    [addDays(today, 1)]: [{ symbol: 'T', exchange: 'NYSE', time: 'Pre Market' }, { symbol: 'MG', exchange: 'NYSE', time: 'Pre Market' }],
    [addDays(today, 15)]: [{ symbol: 'T', exchange: 'TSX', country: 'Canada', time: 'Pre Market' }],
  } };
  ctx.providers.earnings = createTwelveData({ apiKey: 'k', plan: { perMinute: 1000, perDay: 100000 }, fetchImpl: async () => ok(withCanada) });
  const r = await refreshEarnings(ctx);
  assert.deepEqual(r.notCovered, []);
  assert.deepEqual(earningsRows(ctx, 'symbol, date, instrument_id'), [{ symbol: 'T', date: addDays(today, 15), instrument_id: telus.id }],
    'Magna (MG, TSX) does not get Mistras\'s NYSE date');
  assert.ok(getSetting(ctx.db, 'earningsCoverage').bySymbol.MG, 'Canada is covered, so MG was checked');
});

test('earnings by listing: one row per ticker and date, moved dates stay with their listing, uncovered dates go', async () => {
  const td = (ctx, get) => { ctx.providers.earnings = createTwelveData({ apiKey: 'k', plan: { perMinute: 1000, perDay: 100000 }, fetchImpl: async () => ok(get()) }); };
  // Both SHOP listings report the same date: one row, linked to the first listing, with no flip-flopping history.
  {
    const { ctx, own } = listingCtx();
    const ny = own('SHOP', 'NYSE', 'USD');
    own('SHOP', 'TSX', 'CAD');
    const D = addDays(today, 10);
    td(ctx, () => ({ earnings: { [D]: [{ symbol: 'SHOP', exchange: 'NYSE', country: 'United States', time: 'Pre Market', eps_estimate: 0.3 }, { symbol: 'SHOP', exchange: 'TSX', country: 'Canada', time: '', eps_estimate: 0.41 }] } }));
    for (let n = 0; n < 3; n++) await refreshEarnings(ctx);
    const rows = earningsRows(ctx, 'symbol, instrument_id, time_hint, details_json');
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].instrument_id, rows[0].time_hint], [ny.id, 'bmo']);
    assert.equal(JSON.parse(rows[0].details_json).changes, undefined, 'no timing or estimate changes recorded');
  }
  // AT&T (T, NYSE) moves its date; TELUS (T, TSX) keeps its own: only AT&T's new row remembers the old date.
  {
    const { ctx, own } = listingCtx();
    const att = own('T', 'NYSE', 'USD');
    const telus = own('T', 'TSX', 'CAD');
    const D1 = addDays(today, 5), D2 = addDays(today, 7), D3 = addDays(today, 30);
    let cal = { earnings: { [D1]: [{ symbol: 'T', exchange: 'NYSE', time: 'Pre Market' }], [D2]: [{ symbol: 'T', exchange: 'TSX', country: 'Canada', time: 'Pre Market' }] } };
    td(ctx, () => cal);
    await refreshEarnings(ctx);
    cal = { earnings: { [D3]: [{ symbol: 'T', exchange: 'NYSE', time: 'Pre Market' }], [D2]: [{ symbol: 'T', exchange: 'TSX', country: 'Canada', time: 'Pre Market' }] } };
    await refreshEarnings(ctx);
    const rows = earningsRows(ctx, 'instrument_id, date, details_json').map((r) => [r.instrument_id, r.date, JSON.parse(r.details_json).previousDate ?? null]);
    assert.deepEqual(rows, [[telus.id, D2, null], [att.id, D3, D1]]);
  }
  // TELUS is the only holding and Finnhub cannot check it: the stale AT&T date stored earlier goes, though nothing came back.
  {
    const { ctx, own } = listingCtx();
    const telus = own('T', 'TSX', 'CAD');
    ctx.db.prepare("INSERT INTO events (instrument_id, symbol, type, date, title, source, fetched_at) VALUES (?, 'T', 'earnings', ?, 'T earnings', 'Finnhub earnings calendar', ?)").run(telus.id, addDays(today, 1), new Date().toISOString());
    ctx.db.prepare("INSERT INTO events (symbol, type, date, title, source, fetched_at) VALUES ('T', 'earnings', ?, 'T earnings', 'Entered manually', ?)").run(addDays(today, 2), new Date().toISOString());
    ctx.providers.earnings = createFinnhub({ apiKey: 'k', plan: { perMinute: 1000 }, fetchImpl: async () => ok({ earningsCalendar: [] }) });
    const r = await refreshEarnings(ctx);
    assert.deepEqual(r.notCovered.map((n) => n.symbol), ['T']);
    assert.deepEqual(earningsRows(ctx, 'symbol, source'), [{ symbol: 'T', source: 'Entered manually' }], 'only the user\'s own entry is kept');
    assert.deepEqual((await eventsTool(ctx, ['T'])).events.map((e) => e.date), [addDays(today, 2)]);
  }
  // One US ticker under two exchange names is asked about once and keeps the held listing's link.
  {
    const { ctx, own, watch } = listingCtx();
    const spy = own('SPY', 'NYSE Arca', 'USD');
    watch('SPY', 'NYSE');
    const asked = [];
    ctx.providers.earnings = createFinnhub({ apiKey: 'k', plan: { perMinute: 1000 }, fetchImpl: async (url) => { asked.push(new URL(url).searchParams.get('symbol')); return ok({ earningsCalendar: [{ symbol: 'SPY', date: addDays(today, 3), hour: 'bmo' }] }); } });
    await refreshEarnings(ctx);
    assert.deepEqual(asked, ['SPY']);
    assert.deepEqual(earningsRows(ctx), [{ symbol: 'SPY', instrument_id: spy.id }]);
  }
});

// ---------- Bank of Canada ----------

test('every Bank of Canada observation returned is stored, so a gap in refreshes leaves no hole', async () => {
  const ctx = makeCtx();
  let obs = [['2026-10-14', '1.3790'], ['2026-10-15', '1.3802'], ['2026-10-16', '1.3810']];
  ctx.providers.fx = createBankOfCanada({ fetchImpl: async () => ok({ observations: obs.map(([d, v]) => ({ d, FXUSDCAD: { v } })) }) });
  const stored = () => ctx.db.prepare("SELECT as_of, rate FROM fx_rates WHERE pair = 'USDCAD' ORDER BY as_of").all().map((x) => [x.as_of, x.rate]);
  assert.equal((await refreshFx(ctx)).as_of, '2026-10-16');
  // The app was off Monday and Tuesday; Wednesday's response holds the days in between.
  obs = [['2026-10-15', '1.3802'], ['2026-10-16', '1.3810'], ['2026-10-19', '1.3850'], ['2026-10-20', '1.3895'], ['2026-10-21', '1.3880']];
  await refreshFx(ctx);
  await refreshFx(ctx);
  assert.deepEqual(stored(), [['2026-10-14', 1.379], ['2026-10-15', 1.3802], ['2026-10-16', 1.381], ['2026-10-19', 1.385], ['2026-10-20', 1.3895], ['2026-10-21', 1.388]], 'one row per date');
  assert.equal(latestFx(ctx.db).as_of, '2026-10-21');
  // An implausible observation anywhere in the response stores nothing.
  obs = [['2026-10-22', '138.9'], ['2026-10-23', '1.3900']];
  assert.equal(await refreshFx(ctx), null);
  assert.equal(stored().length, 6);
});

// ---------- model backend ----------

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const start = { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2000, output_tokens: 1 } } };
const okStream = sse([start,
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fine.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
  { type: 'message_stop' }]);

async function mockApi(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { const b = JSON.parse(body); seen.push(b); handler(b, res); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, seen, url: `http://127.0.0.1:${server.address().port}` };
}

function backendFor(url) {
  process.env.ANTHROPIC_BASE_URL = url;
  const dir = tempDir();
  return createBackend(loadConfig({ ENV_FILE: path.join(dir, 'none.env'), SIGNAL_DESK_DATA_DIR: dir, ANTHROPIC_API_KEY: 'sk-ant-test-key-123' }));
}

const call = (b, signal) => b.create({ system: 's', tools: toolsForApi(), messages: [{ role: 'user', content: 'x' }], signal });

test('backend: a dropped or aborted stream charges an estimate of the output already generated', async () => {
  let mode;
  const text = 'x'.repeat(4001);
  const api = await mockApi((body, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const ev = [start];
    if (mode === 'thinking') ev.push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
    else {
      ev.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      for (let i = 0; i < text.length; i += 1000) ev.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 1000) } });
      if (mode === 'final') ev.push({ type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 900 } });
    }
    res.write(sse(ev));
    if (mode !== 'hang') setTimeout(() => res.socket.destroy(), 100);
  });
  try {
    const b = backendFor(api.url);
    mode = 'text';
    await assert.rejects(call(b), (e) => e.kind === 'network' && e.partial.usage.input_tokens === 2000 && e.partial.usage.output_tokens === 1001);
    mode = 'thinking';
    await assert.rejects(call(b), (e) => e.partial.usage.output_tokens === 16000, 'hidden thinking is charged max_tokens');
    mode = 'final';
    await assert.rejects(call(b), (e) => e.partial.usage.output_tokens === 900, 'a reported count is used as is');
    mode = 'hang';
    const ac = new AbortController();
    const p = call(b, ac.signal);
    setTimeout(() => ac.abort(), 150);
    await assert.rejects(p, (e) => e.kind === 'aborted' && e.partial.usage.output_tokens === 1001);
  } finally {
    api.server.closeAllConnections?.();
    api.server.close();
  }
});

test('backend: the output estimate is priced when the interrupted message carries per-attempt iterations', async () => {
  const api = await mockApi((body, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const st = { ...start, message: { ...start.message, usage: { input_tokens: 2000, output_tokens: 1, iterations: [{ type: 'message', model: 'claude-opus-5-5', input_tokens: 2000, output_tokens: 1 }] } } };
    res.write(sse([st, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x'.repeat(8000) } }]));
    setTimeout(() => res.socket.destroy(), 100);
  });
  try {
    const b = backendFor(api.url);
    const e = await call(b).catch((x) => x);
    assert.equal(e.kind, 'network');
    assert.equal(e.partial.usage.output_tokens, 2000);
    assert.equal(e.partial.usage.iterations.at(-1).output_tokens, 2000, 'the attempt in progress carries the estimate');
    const rec = recordUsage(makeCtx(), e.partial, 'claude-opus-5-5');
    assert.equal(rec.tokens.output_tokens, 2000);
    assert.ok(Math.abs(rec.cost - (2000 * 4 + 2000 * 20) / 1e6) < 1e-9, 'the streamed output is charged');
  } finally {
    api.server.closeAllConnections?.();
    api.server.close();
  }
});

test('backend: every rejected request option is turned off within one call', async () => {
  let reject = [];
  const msg = { fallbacks: 'fallbacks: Extra inputs are not permitted', effort: 'output_config.effort: This model does not support the effort parameter.', strict: 'tools.0.strict: Extra inputs are not permitted' };
  const has = (b) => ({ fallbacks: 'fallbacks' in b, effort: !!b.output_config?.effort, strict: (b.tools || []).some((t) => t.strict) });
  const api = await mockApi((body, res) => {
    const bad = reject.find((k) => k === 'always' || has(body)[k]);
    if (bad) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: msg[bad] || msg.strict } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(okStream);
  });
  try {
    reject = ['fallbacks', 'effort'];
    let b = backendFor(api.url);
    assert.equal((await call(b)).content[0].text, 'Fine.');
    assert.deepEqual(api.seen.map((x) => Object.keys(has(x)).filter((k) => has(x)[k]).join('+')), ['fallbacks+effort+strict', 'effort+strict', 'strict']);
    reject = ['fallbacks', 'effort', 'strict'];
    api.seen.length = 0;
    b = backendFor(api.url);
    assert.equal((await call(b)).content[0].text, 'Fine.');
    assert.equal(api.seen.length, 4);
    // A rejection naming an option already off is not retried.
    reject = ['always'];
    api.seen.length = 0;
    await assert.rejects(call(b), (e) => e.kind === 'bad_request');
    assert.equal(api.seen.length, 1);
  } finally {
    api.server.close();
  }
});

test('backend: deleting or repairing an unreadable spend record unpauses chat without a restart', () => {
  const cc = { dailyBudgetUsd: 5, model: 'claude-opus-5-5', priceOverride: null };
  const dir = tempDir();
  const cfg = { dataDir: dir };
  const file = path.join(dir, 'chat-usage.json');
  fs.writeFileSync(file, '{not json');
  assert.match(budgetCheck(cfg, cc).reason, /could not be read/);
  assert.match(budgetCheck(cfg, cc).reason, /could not be read/, 'still paused while the file is unreadable');
  fs.unlinkSync(file);
  assert.equal(budgetCheck(cfg, cc).ok, true);
  // Repairing the file instead: its content is read, not reset to zero.
  const dir2 = tempDir();
  const cfg2 = { dataDir: dir2 };
  fs.writeFileSync(path.join(dir2, 'chat-usage.json'), '{"days": {"x": {"cost_usd": 1');
  assert.match(budgetCheck(cfg2, cc).reason, /could not be read/);
  fs.writeFileSync(path.join(dir2, 'chat-usage.json'), JSON.stringify({ days: { [todayIn(NY)]: { cost_usd: 6, calls: 3 } } }));
  assert.match(budgetCheck(cfg2, cc).reason, /cap \(US\$5\) has been reached/);
  assert.equal(spentToday(cfg2).usd, 6);
});

test('a BASELINE dated the quote session counts as held at the start, not as a same-session buy', () => {
  const { db } = tempDb();
  addTransaction(db, { account: 'TFSA', symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', type: 'BASELINE', trade_date: '2026-10-21', quantity: 100, price: 50 });
  const i = findInstrument(db, 'NBIS', 'NASDAQ');
  updateInstrument(db, i.id, { identity_status: 'confirmed' });
  putQuote(db, i.id, { price: 101, prev_close: 100, change_pct: 1, quote_time: zonedToUtc('2026-10-21', 15, 0).toISOString() });
  const pos = computePortfolio(db, { now: zonedToUtc('2026-10-21', 15, 5) }).positions.find((x) => x.symbol === 'NBIS');
  assert.equal(pos.dailyPL, 100, 'one dollar on 100 shares held from the start, not the whole unrealized gain');
  assert.equal(pos.dailyPct, 1);
  assert.equal(pos.unrealizedPL, 5100);
});

test('the currency effect is not hidden after Easter Monday (no Bank of Canada rate that day)', async () => {
  const { dailyAttribution } = await import('../server/agent/calc.js');
  const portfolio = { positions: [], cash: [{ currency: 'USD', amount: 1000 }], totals: { USD: { dailyPct: null }, CAD: { dailyPct: null } }, combined: { fxRate: 1.38, fxAsOf: '2026-04-07' }, fx: { rate: 1.38, as_of: '2026-04-07', source: 'Bank of Canada' } };
  const a = dailyAttribution(portfolio, { fxPrev: { rate: 1.37, as_of: '2026-04-02' }, sessionDate: '2026-04-07' });
  assert.ok(a.fx && a.fx.from, JSON.stringify(a.fx));
  assert.equal(a.fx.from.asOf, '2026-04-02');
});
