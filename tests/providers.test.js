// Provider adapters tested against fixture responses shaped like each
// provider's documented format. These do NOT prove live connectivity; the
// in-app "Test connection" button does that once keys are configured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempDb } from './helpers.js';
import { createTwelveData } from '../server/providers/twelvedata.js';
import { createFinnhub } from '../server/providers/finnhub.js';
import { createBankOfCanada } from '../server/providers/boc.js';
import { createSec } from '../server/providers/sec.js';
import { refreshQuotes } from '../server/marketdata.js';
import { ensureInstrument, computePortfolio, addTransaction, findInstrument, updateInstrument } from '../server/portfolio.js';
import { redact } from '../server/config.js';

const KEY = 'sk_live_SECRET123456';

function fakeFetch(routes, calls = []) {
  return async (url, opts) => {
    calls.push({ url, opts });
    for (const [pattern, resp] of routes) {
      if (url.includes(pattern)) {
        const r = typeof resp === 'function' ? resp(url) : resp;
        return {
          ok: (r.status || 200) < 400, status: r.status || 200,
          headers: { get: () => null },
          json: async () => r.body,
        };
      }
    }
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  };
}

const TD_QUOTE = {
  symbol: 'VRT', name: 'Vertiv Holdings Co', exchange: 'NYSE', mic_code: 'XNYS', currency: 'USD',
  datetime: '2026-10-21', timestamp: 1792605600, open: '120.10', high: '124.00', low: '119.50', close: '123.40',
  volume: '5300000', previous_close: '120.00', change: '3.40', percent_change: '2.83333', average_volume: '6100000',
  is_market_open: true,
};

test('Twelve Data quote parsing keeps provider, timestamp and delay', async () => {
  const td = createTwelveData({ apiKey: KEY, plan: { perMinute: 100, delayMinutesUS: 15 }, fetchImpl: fakeFetch([['/quote', { body: TD_QUOTE }]]) });
  const [r] = await td.getQuotes([{ id: 1, symbol: 'VRT', exchange: 'NYSE', currency: 'USD' }], new Date('2026-10-21T18:00:00Z'));
  assert.equal(r.ok, true);
  assert.equal(r.quote.price, 123.4);
  assert.equal(r.quote.prev_close, 120);
  assert.equal(r.quote.provider, 'Twelve Data');
  assert.equal(r.quote.timeliness, 'delayed');
  assert.equal(r.quote.delay_minutes, 15);
  assert.equal(r.quote.quote_time, new Date(1792605600 * 1000).toISOString());
});

test('currency mismatch from provider is treated as a mapping error', async () => {
  const td = createTwelveData({ apiKey: KEY, plan: { perMinute: 100 }, fetchImpl: fakeFetch([['/quote', { body: { ...TD_QUOTE, currency: 'CAD' } }]]) });
  const [r] = await td.getQuotes([{ id: 1, symbol: 'VRT', exchange: 'NYSE', currency: 'USD' }]);
  assert.equal(r.ok, false);
  assert.match(r.error.message, /mapping may be wrong/);
});

test('Twelve Data error payloads are classified and never echo the key', async () => {
  const calls = [];
  const td = createTwelveData({ apiKey: KEY, plan: { perMinute: 100 }, fetchImpl: fakeFetch([['/quote', { body: { code: 401, message: 'Invalid apikey', status: 'error' } }]], calls) });
  const res = await td.getQuotes([{ id: 1, symbol: 'A', exchange: 'NYSE', currency: 'USD' }, { id: 2, symbol: 'B', exchange: 'NYSE', currency: 'USD' }]);
  assert.equal(res.length, 1, 'stops after auth failure');
  assert.equal(res[0].error.kind, 'auth');
  assert.ok(!res[0].error.message.includes(KEY));
  assert.ok(calls[0].url.includes(KEY), 'key is sent to the provider (server side)');
});

test('Finnhub zero-quote for unknown symbol becomes not_found, not a $0 price', async () => {
  const fh = createFinnhub({ apiKey: KEY, fetchImpl: fakeFetch([['/quote', { body: { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 } }]]) });
  const [r] = await fh.getQuotes([{ id: 1, symbol: 'ZZZZ', exchange: 'NASDAQ', currency: 'USD' }]);
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'not_found');
});

test('network failure keeps the last valid quote and marks the error', async () => {
  const { db } = tempDb();
  addTransaction(db, { type: 'BUY', trade_date: '2026-01-05', symbol: 'VRT', exchange: 'NYSE', currency: 'USD', quantity: 1, price: 100 });
  const inst = findInstrument(db, 'VRT', 'NYSE');
  updateInstrument(db, inst.id, { identity_status: 'confirmed' });
  const ok = createTwelveData({ apiKey: KEY, plan: { perMinute: 100 }, fetchImpl: fakeFetch([['/quote', { body: TD_QUOTE }]]) });
  const ctx = { db, mode: 'real', providers: { market: ok } };
  await refreshQuotes(ctx, { now: new Date('2026-10-21T18:00:00Z') });
  ctx.providers.market = createTwelveData({ apiKey: KEY, plan: { perMinute: 100 }, fetchImpl: fakeFetch([]) });
  const r = await refreshQuotes(ctx, { now: new Date('2026-10-21T19:00:00Z') });
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].kind, 'network');
  const q = db.prepare('SELECT * FROM quotes WHERE instrument_id = ?').get(inst.id);
  assert.equal(q.price, 123.4, 'last valid price preserved');
  assert.match(q.last_error, /could not connect/);
  const pos = computePortfolio(db, { now: new Date('2026-10-21T19:00:00Z') }).positions[0];
  assert.equal(pos.quote.freshness, 'stale', 'an hour-old quote in an open session is stale');
  assert.ok(pos.quote.lastError);
});

test('unconfirmed instruments are never priced', async () => {
  const { db } = tempDb();
  addTransaction(db, { type: 'BASELINE', trade_date: '2026-09-30', symbol: 'SPCX', exchange: 'NASDAQ', currency: 'USD', quantity: 3, price: 20 });
  const calls = [];
  const td = createTwelveData({ apiKey: KEY, plan: { perMinute: 100 }, fetchImpl: fakeFetch([['/quote', { body: TD_QUOTE }]], calls) });
  const r = await refreshQuotes({ db, mode: 'real', providers: { market: td } });
  assert.equal(calls.length, 0);
  assert.deepEqual(r.unconfirmed, ['SPCX']);
  assert.equal(computePortfolio(db).positions[0].marketValue, null);
});

test('rate limiter waits rather than exceeding the per-minute allowance', async () => {
  const { RateLimiter } = await import('../server/providers/http.js');
  const rl = new RateLimiter({ perMinute: 2, perDay: 3 });
  await rl.take(); await rl.take();
  await assert.rejects(() => rl.take(1, { wait: false }), /Per-minute/);
  rl.minute = []; // simulate a minute passing
  await rl.take();
  await assert.rejects(() => rl.take(), /Daily request allowance/);
});

test('Bank of Canada rate is dated and sanity-checked', async () => {
  const boc = createBankOfCanada({ fetchImpl: fakeFetch([['valet', { body: { observations: [{ d: '2026-10-19', FXUSDCAD: { v: '1.3801' } }, { d: '2026-10-20', FXUSDCAD: { v: '1.3795' } }] } }]]) });
  const r = await boc.getUsdCad();
  assert.deepEqual(r, { pair: 'USDCAD', rate: 1.3795, as_of: '2026-10-20', source: 'Bank of Canada daily rate' });
  const bad = createBankOfCanada({ fetchImpl: fakeFetch([['valet', { body: { observations: [{ d: '2026-10-20', FXUSDCAD: { v: '137.95' } }] } }]]) });
  await assert.rejects(() => bad.getUsdCad(), /Implausible/);
});

test('SEC filings parsed with item labels and importance; User-Agent required', async () => {
  const sub = {
    name: 'Vertiv Holdings Co',
    filings: { recent: {
      accessionNumber: ['0001674101-26-000010', '0001674101-26-000009'], filingDate: ['2026-10-20', '2026-07-01'],
      reportDate: ['2026-10-20', ''], acceptanceDateTime: ['2026-10-20T16:05:00.000Z', '2026-07-01T12:00:00.000Z'],
      form: ['8-K', '8-K'], primaryDocument: ['a.htm', 'b.htm'], primaryDocDescription: ['', ''], items: ['2.02,9.01', '5.02'],
    } },
  };
  const calls = [];
  const sec = createSec({ contactEmail: 'me@example.com', fetchImpl: fakeFetch([
    ['company_tickers', { body: { 0: { cik_str: 1674101, ticker: 'VRT', title: 'Vertiv' } } }],
    ['submissions', { body: sub }],
  ], calls) });
  const f = await sec.getFilings('VRT', '2026-09-01');
  assert.equal(f.length, 1);
  assert.match(f[0].title, /Results of operations/);
  assert.equal(f[0].importance, 3);
  assert.equal(f[0].url, 'https://www.sec.gov/Archives/edgar/data/1674101/000167410126000010/a.htm');
  assert.match(calls[0].opts.headers['User-Agent'], /me@example.com/);
  await assert.rejects(() => createSec({}).getFilings('VRT', '2026-01-01'), /contact email/);
});

test('redact removes secrets and key query params from any text', () => {
  const cfg = { secrets: { A: KEY, B: '' } };
  const s = redact(`GET https://x/quote?symbol=A&apikey=${KEY}&token=abc failed with ${KEY}`, cfg);
  assert.ok(!s.includes(KEY));
  assert.ok(!s.includes('token=abc'));
});
