// HXR Alpaca client against a fake fetch (no network): request parameters,
// paging, 429 back-off with a fake sleep, unfinished sessions dropped with a
// fake clock, the first 15-minute bar across daylight-saving changes,
// corporate actions, quotes, news, keys never in errors, and refusal of any
// host other than data.alpaca.markets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHxrSource, assertAlpacaDataUrl, flattenAction, newsItem, ALPACA_DATA_ORIGIN, CORPORATE_ACTION_TYPES } from '../server/hxr/source.js';
import { zonedToUtc, NY } from '../server/time.js';

const KEY_ID = 'PKTESTKEYID1234567890';
const SECRET_KEY = 'hxr-secret-abcdefghijklmnopqrstuvwxyz';
const zulu = (d) => d.toISOString().replace(/\.000Z$/, 'Z');
const et = (date, h, m) => zulu(zonedToUtc(date, h, m, NY));
const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

// A fake data.alpaca.markets: handler(call) returns a response; every call is recorded.
function fake(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const call = { url, origin: u.origin, path: u.pathname, q: Object.fromEntries(u.searchParams), headers: init.headers };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { fetchImpl, calls };
}

const src = (fetchImpl, now, extra = {}) => createHxrSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl, now: () => new Date(now), sleep: async () => {}, ...extra });
const daily = (date, c, extra = {}) => ({ t: et(date, 0, 0), o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000, n: 10, vw: c, ...extra });

test('daily bars: request parameters, keys only in headers, paging', async () => {
  const pages = [
    { bars: { MU: [daily('2024-03-04', 50), daily('2024-03-05', 51)] }, next_page_token: 'p2' },
    { bars: { MU: [daily('2024-03-06', 52)] }, next_page_token: null },
  ];
  const f = fake((call, n) => res(200, pages[n - 1]));
  const s = src(f.fetchImpl, '2026-10-22T12:00:00Z');
  const bars = await s.dailyBars('mu', { from: '2024-03-04', to: '2024-03-08' });
  assert.deepEqual(bars.map((b) => [b.date, b.c, b.n, b.vw]), [['2024-03-04', 50, 10, 50], ['2024-03-05', 51, 10, 51], ['2024-03-06', 52, 10, 52]]);
  assert.equal(bars.pages, 2);
  assert.equal(f.calls.length, 2);
  assert.equal(`${f.calls[0].origin}${f.calls[0].path}`, 'https://data.alpaca.markets/v2/stocks/bars');
  assert.deepEqual(f.calls[0].q, { symbols: 'MU', timeframe: '1Day', start: '2024-03-04T05:00:00Z', end: '2024-03-09T04:59:59Z', adjustment: 'raw', feed: 'sip', limit: '10000', sort: 'asc' });
  assert.equal(f.calls[1].q.page_token, 'p2');
  assert.deepEqual(f.calls[0].headers, { 'APCA-API-KEY-ID': KEY_ID, 'APCA-API-SECRET-KEY': SECRET_KEY, Accept: 'application/json' });
  assert.ok(f.calls.every((c) => !c.url.includes(KEY_ID) && !c.url.includes(SECRET_KEY) && c.url.startsWith(`${ALPACA_DATA_ORIGIN}/`)));
  assert.deepEqual(s.stats(), { requests: 2, pages: 2, retries: 0, rateLimited: 0 });

  // The same token twice is a loop.
  const loop = fake(() => res(200, { bars: { MU: [] }, next_page_token: 'same' }));
  await assert.rejects(src(loop.fetchImpl, '2026-10-22T12:00:00Z').dailyBars('MU', { from: '2024-03-04', to: '2024-03-08' }), /same next_page_token/);
  // Keys missing: refused before any request.
  const none = fake(() => res(200, {}));
  await assert.rejects(createHxrSource({ fetchImpl: none.fetchImpl }).dailyBars('MU', { from: '2024-03-04', to: '2024-03-08' }), (e) => e.kind === 'auth' && /not configured/.test(e.message));
  assert.equal(none.calls.length, 0);
  await assert.rejects(s.dailyBars('MU;DROP', { from: '2024-03-04', to: '2024-03-08' }), /invalid symbol/);
  await assert.rejects(s.dailyBars('MU', { from: '2024-03-08', to: '2024-03-04' }), /from on or before to/);
});

test('daily bars: the end is never later than 16 minutes ago, and an unfinished session is dropped by date', async () => {
  // Alpaca returns the current session's partial bar even with an earlier end.
  const bars = [daily('2024-03-13', 50), daily('2024-03-14', 51), daily('2024-03-15', 52), daily('2024-03-16', 53)];
  const f = fake(() => res(200, { bars: { MU: bars }, next_page_token: null }));
  // 15:00 ET on 2024-03-15 (EDT): the session is still open.
  const during = await src(f.fetchImpl, '2024-03-15T19:00:00Z').dailyBars('MU', { from: '2024-03-13', to: '2024-03-15' });
  assert.equal(f.calls[0].q.end, '2024-03-15T18:44:00Z');
  assert.deepEqual(during.map((b) => b.date), ['2024-03-13', '2024-03-14']);
  assert.equal(during.dropped.incomplete, 1);
  assert.equal(during.dropped.outOfRange, 1, 'the Saturday bar is outside the requested dates');
  // 16:19:59 ET: closed, but not yet 20 minutes after the close.
  const early = await src(f.fetchImpl, '2024-03-15T20:19:59Z').dailyBars('MU', { from: '2024-03-13', to: '2024-03-15' });
  assert.deepEqual(early.map((b) => b.date), ['2024-03-13', '2024-03-14']);
  const after = await src(f.fetchImpl, '2024-03-15T20:20:00Z').dailyBars('MU', { from: '2024-03-13', to: '2024-03-15' });
  assert.deepEqual(after.map((b) => b.date), ['2024-03-13', '2024-03-14', '2024-03-15']);

  // Early close (13:00 ET on 2024-11-29): final from 13:20 ET.
  const g = fake(() => res(200, { bars: { MU: [daily('2024-11-29', 90)] } }));
  assert.equal((await src(g.fetchImpl, et('2024-11-29', 13, 19)).dailyBars('MU', { from: '2024-11-29', to: '2024-11-29' })).length, 0);
  assert.equal((await src(g.fetchImpl, et('2024-11-29', 13, 20)).dailyBars('MU', { from: '2024-11-29', to: '2024-11-29' })).length, 1);

  // Nothing is requested when the whole range is less than 16 minutes old.
  const h = fake(() => res(200, { bars: {} }));
  assert.deepEqual([...await src(h.fetchImpl, et('2024-03-15', 0, 10)).dailyBars('MU', { from: '2024-03-15', to: '2024-03-15' })], []);
  assert.equal(h.calls.length, 0);

  // Bars on a closed day (the 2018-12-05 closure), invalid prices and duplicates are dropped and counted.
  const k = fake(() => res(200, { bars: { MU: [daily('2018-12-04', 40), daily('2018-12-05', 41), daily('2018-12-06', 0), daily('2018-12-07', 42), daily('2018-12-07', 43), { t: '2018-12-10 00:00', o: 1, h: 1, l: 1, c: 1 }] } }));
  const odd = await src(k.fetchImpl, '2026-10-22T12:00:00Z').dailyBars('MU', { from: '2018-12-03', to: '2018-12-10' });
  assert.deepEqual(odd.map((b) => [b.date, b.c]), [['2018-12-04', 40], ['2018-12-07', 42]]);
  assert.deepEqual(odd.dropped, { unreadable: 1, outOfRange: 0, nonTradingDay: 1, incomplete: 0, invalid: 1, duplicates: 1 });
});

test('HTTP 429 backs off on X-Ratelimit-Reset or exponentially, at most 6 retries', async () => {
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };
  const nowMs = Date.parse('2026-10-22T16:51:36Z');
  const script = [res(429, { message: 'too many requests' }, { 'x-ratelimit-reset': String(nowMs / 1000 + 5) }), res(429, {}), res(200, { bars: { MU: [daily('2024-03-04', 50)] } })];
  const f = fake((call, n) => script[n - 1]);
  const s = createHxrSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: f.fetchImpl, sleep, now: () => new Date(nowMs), backoffMs: 1000 });
  const bars = await s.dailyBars('MU', { from: '2024-03-04', to: '2024-03-04' });
  assert.equal(bars.length, 1);
  assert.deepEqual(slept, [5000, 2000], 'until the reset time, then exponential');
  assert.deepEqual(s.stats(), { requests: 3, pages: 1, retries: 2, rateLimited: 2 });

  slept.length = 0;
  const always = fake(() => res(429, { message: `slow down ${KEY_ID}` }));
  const s2 = createHxrSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: always.fetchImpl, sleep, now: () => new Date(nowMs), backoffMs: 1000, maxBackoffMs: 60000 });
  await assert.rejects(s2.dailyBars('MU', { from: '2024-03-04', to: '2024-03-04' }), (e) => e.kind === 'rate_limit' && /after 6 retries/.test(e.message) && !e.message.includes(KEY_ID));
  assert.equal(always.calls.length, 7, 'one request and 6 retries');
  assert.deepEqual(slept, [1000, 2000, 4000, 8000, 16000, 32000]);
});

test('errors never carry the keys, URLs or headers', async () => {
  const echo = (status) => fake(() => res(status, { message: `key ${KEY_ID} with secret ${SECRET_KEY} is not entitled` }));
  for (const [status, kind] of [[401, 'auth'], [403, 'auth'], [422, 'bad_response'], [400, 'bad_response'], [404, 'not_found']]) {
    const f = echo(status);
    await assert.rejects(src(f.fetchImpl, '2026-10-22T12:00:00Z').dailyBars('MU', { from: '2024-03-04', to: '2024-03-04' }), (e) => {
      assert.equal(e.kind, kind);
      assert.ok(e.message.includes(`HTTP ${status}`));
      assert.ok(e.message.includes('[REDACTED]'), e.message);
      assert.ok(!e.message.includes(KEY_ID) && !e.message.includes(SECRET_KEY) && !e.message.includes('data.alpaca.markets'), e.message);
      return true;
    });
  }
  const down = fake(() => res(503, { message: SECRET_KEY }));
  await assert.rejects(src(down.fetchImpl, '2026-10-22T12:00:00Z').dailyBars('MU', { from: '2024-03-04', to: '2024-03-04' }), (e) => e.kind === 'server' && !e.message.includes(SECRET_KEY));
  assert.equal(down.calls.length, 3, 'two retries on a server error');
  const net = createHxrSource({ keyId: KEY_ID, secretKey: SECRET_KEY, sleep: async () => {}, now: () => new Date('2026-10-22T12:00:00Z'), fetchImpl: async () => { const e = new Error(`connect failed ${SECRET_KEY}`); e.cause = { code: `ECONNREFUSED ${KEY_ID}` }; throw e; } });
  await assert.rejects(net.dailyBars('MU', { from: '2024-03-04', to: '2024-03-04' }), (e) => e.kind === 'network' && !e.message.includes(KEY_ID) && !e.message.includes(SECRET_KEY));
  const notJson = fake(() => res(200, '<html>'));
  await assert.rejects(src(notJson.fetchImpl, '2026-10-22T12:00:00Z').dailyBars('MU', { from: '2024-03-04', to: '2024-03-04' }), /not valid JSON/);
});

test('a redirect is never followed, so the keys never reach another host (HXR and Strategy Lab clients)', async () => {
  // A fake that answers 302: one request, redirect: 'manual', a bad_response error without the keys.
  const moved = fake(() => ({ ...res(302, ''), headers: { get: (k) => (k.toLowerCase() === 'location' ? 'https://collector.invalid/x' : null) } }));
  const inits = [];
  const spy = async (url, init) => { inits.push(init); return moved.fetchImpl(url, init); };
  await assert.rejects(src(spy, '2026-10-22T12:00:00Z').dailyBars('MU', { from: '2024-03-04', to: '2024-03-04' }), (e) => {
    assert.equal(e.kind, 'bad_response');
    assert.match(e.message, /unexpected redirect \(HTTP 302\).*not followed/);
    assert.ok(!e.message.includes(KEY_ID) && !e.message.includes(SECRET_KEY) && !e.message.includes('collector'), e.message);
    return true;
  });
  assert.equal(moved.calls.length, 1, 'no retry and no second request');
  assert.equal(inits[0].redirect, 'manual');

  // Node's own fetch against two loopback origins: the data host answers 302 to the other one.
  const http = await import('node:http');
  const { createAlpacaSource } = await import('../server/strategy/sources/alpaca.js');
  const seen = [];
  const collector = http.createServer((req, r) => { seen.push({ url: req.url, headers: req.headers }); r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"bars":{}}'); });
  await new Promise((r) => collector.listen(0, '127.0.0.1', r));
  const target = `http://127.0.0.1:${collector.address().port}/collect`;
  const data = http.createServer((req, r) => { r.writeHead(302, { location: `${target}${req.url}` }); r.end(); });
  await new Promise((r) => data.listen(0, '127.0.0.1', r));
  const loopback = (url, init) => globalThis.fetch(url.replace(ALPACA_DATA_ORIGIN, `http://127.0.0.1:${data.address().port}`), init);
  try {
    await assert.rejects(src(loopback, '2026-10-22T12:00:00Z').dailyBars('MU', { from: '2024-03-04', to: '2024-03-04' }), (e) => e.kind === 'bad_response' && /redirect/.test(e.message));
    const lab = createAlpacaSource({ keyId: KEY_ID, secretKey: SECRET_KEY, sleep: async () => {}, now: () => new Date('2026-10-22T12:00:00Z'), fetchImpl: loopback });
    await assert.rejects(lab.getIntradayRange({ symbol: 'MU', exchange: 'NASDAQ' }, '2024-03-04', '2024-03-04'), (e) => e.kind === 'bad_response' && /redirect/.test(e.message));
    assert.deepEqual(seen, [], 'the other origin received no request, so neither key left the data host');
  } finally {
    await new Promise((r) => data.close(r));
    await new Promise((r) => collector.close(r));
  }
});

test('only https://data.alpaca.markets is ever called', () => {
  for (const url of ['https://example.com/v2/stocks/bars', 'http://data.alpaca.markets/v2/stocks/bars', 'https://data.alpaca.markets.example.com/v2/stocks/bars', 'https://data.alpaca.markets@example.com/', 'https://data.alpaca.markets', '//data.alpaca.markets/v2']) {
    assert.throws(() => assertAlpacaDataUrl(url), /only calls https:\/\/data.alpaca.markets/, url);
  }
  assert.equal(assertAlpacaDataUrl('https://data.alpaca.markets/v2/stocks/bars?x=1'), 'https://data.alpaca.markets/v2/stocks/bars?x=1');
  for (const baseUrl of ['https://example.com', 'http://data.alpaca.markets', 'https://data.alpaca.markets.example.com']) {
    assert.throws(() => createHxrSource({ keyId: KEY_ID, secretKey: SECRET_KEY, baseUrl }), /only calls/, baseUrl);
  }
});

test('first 15-minute bar: the bar starting at 09:30 ET, across both daylight-saving changes', async () => {
  // 2024-03-08 is EST (09:30 = 14:30Z); 2024-03-11 is EDT (09:30 = 13:30Z).
  // 2024-11-01 is EDT; 2024-11-04 is EST. Extended-hours bars are returned too.
  const bar = (iso, c) => ({ t: iso, o: c, h: c + 0.2, l: c - 0.2, c, v: 500, n: 5, vw: c + 0.05 });
  const list = [
    bar('2024-03-08T13:30:00Z', 1), bar('2024-03-08T14:15:00Z', 2), bar('2024-03-08T14:30:00Z', 3), bar('2024-03-08T14:45:00Z', 4),
    bar('2024-03-11T13:15:00Z', 5), bar('2024-03-11T13:30:00Z', 6), bar('2024-03-11T14:30:00Z', 7),
    bar('2024-11-01T13:30:00Z', 8), bar('2024-11-01T14:30:00Z', 9),
    bar('2024-11-04T13:30:00Z', 10), bar('2024-11-04T14:30:00Z', 11),
  ];
  const f = fake(() => res(200, { bars: { MU: list } }));
  const rows = await src(f.fetchImpl, '2026-10-22T12:00:00Z').first15('MU', { from: '2024-03-08', to: '2024-11-04' });
  assert.equal(f.calls[0].q.timeframe, '15Min');
  assert.equal(f.calls[0].q.feed, 'sip');
  assert.equal(f.calls[0].q.adjustment, 'raw');
  assert.deepEqual(rows.map((r) => [r.date, r.o, r.vw]), [['2024-03-08', 3, 3.05], ['2024-03-11', 6, 6.05], ['2024-11-01', 8, 8.05], ['2024-11-04', 11, 11.05]]);
  assert.deepEqual(Object.keys(rows[0]), ['date', 'o', 'h', 'l', 'c', 'v', 'vw']);

  // The session in progress is not kept.
  const g = fake(() => res(200, { bars: { MU: [bar('2024-03-15T13:30:00Z', 1)] } }));
  assert.deepEqual([...await src(g.fetchImpl, '2024-03-15T15:00:00Z').first15('MU', { from: '2024-03-15', to: '2024-03-15' })], []);
});

test('corporate actions: every type, 2015-01-01 to a year after today, flattened and de-duplicated', async () => {
  const pages = [
    {
      corporate_actions: {
        forward_splits: [{ id: 'fs1', symbol: 'AMZN', cusip: '023135106', ex_date: '2022-06-06', payable_date: '2022-06-03', process_date: '2022-06-06', old_rate: 1, new_rate: 20 }],
        reverse_splits: [{ id: 'rs1', symbol: 'XYZ', old_cusip: 'o', new_cusip: 'n', ex_date: '2023-01-10', old_rate: 10, new_rate: 1 }],
        cash_dividends: [{ id: 'cd1', symbol: 'META', ex_date: '2024-02-21', payable_date: '2024-03-26', process_date: '2024-03-26', rate: 0.5, special: false }],
        name_changes: [{ id: 'nc1', old_symbol: 'FB', new_symbol: 'META', old_cusip: '30303M102', new_cusip: '30303M102', process_date: '2022-06-09' }],
      },
      next_page_token: 'n2',
    },
    {
      corporate_actions: {
        cash_mergers: [{ id: 'cm1', acquiree_symbol: 'ENGH', acquirer_symbol: 'VST', effective_date: '2024-03-04', process_date: '2024-03-04', rate: 86.49 }],
        cash_dividends: [{ id: 'cd1', symbol: 'META', ex_date: '2024-02-21', payable_date: '2024-03-26', rate: 0.5 }],
        spin_offs: [{ id: 'so1', source_symbol: 'AAA', new_symbol: 'BBB', source_rate: 1, new_rate: 0.5, ex_date: '2025-01-02' }],
      },
      next_page_token: null,
    },
  ];
  const f = fake((call, n) => res(200, pages[n - 1]));
  const rows = await src(f.fetchImpl, '2026-10-22T12:00:00Z').corporateActions(['amzn', 'META', 'VST', 'META']);
  assert.equal(`${f.calls[0].origin}${f.calls[0].path}`, 'https://data.alpaca.markets/v1/corporate-actions');
  assert.deepEqual(f.calls[0].q, { symbols: 'AMZN,META,VST', types: CORPORATE_ACTION_TYPES.join(','), start: '2015-01-01', end: '2027-10-22', limit: '1000', sort: 'asc' });
  assert.equal(f.calls[0].q.types, 'forward_split,reverse_split,cash_dividend,stock_dividend,name_change,cash_merger,stock_merger,spin_off');
  assert.equal(f.calls[1].q.page_token, 'n2');
  assert.deepEqual(rows.map((r) => r.id), ['fs1', 'nc1', 'rs1', 'cd1', 'cm1', 'so1']);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual({ ...by.fs1, raw: undefined }, { id: 'fs1', type: 'forward_split', symbol: 'AMZN', cusip: '023135106', ex_date: '2022-06-06', pay_date: '2022-06-03', process_date: '2022-06-06', ratio_old: 1, ratio_new: 20, rate: null, old_symbol: null, new_symbol: null, raw: undefined });
  assert.equal(by.fs1.raw.new_rate, 20);
  assert.deepEqual([by.rs1.type, by.rs1.ratio_old, by.rs1.ratio_new, by.rs1.cusip], ['reverse_split', 10, 1, 'n']);
  assert.deepEqual([by.cd1.type, by.cd1.rate, by.cd1.pay_date, by.cd1.ex_date], ['cash_dividend', 0.5, '2024-03-26', '2024-02-21']);
  assert.deepEqual([by.nc1.type, by.nc1.symbol, by.nc1.old_symbol, by.nc1.new_symbol, by.nc1.ex_date, by.nc1.process_date], ['name_change', 'META', 'FB', 'META', null, '2022-06-09']);
  assert.deepEqual([by.cm1.type, by.cm1.symbol, by.cm1.new_symbol, by.cm1.ex_date], ['cash_merger', 'ENGH', 'VST', '2024-03-04']);
  assert.deepEqual([by.so1.type, by.so1.symbol, by.so1.new_symbol, by.so1.ratio_new], ['spin_off', 'AAA', 'BBB', 0.5]);
  assert.equal(flattenAction('cash_dividends', { symbol: 'X' }), null, 'no id: skipped');
});

test('quotes: SIP quotes from the open to one minute later; refused until the window is old enough', async () => {
  const q = (t, bp, ap) => ({ t, bp, ap, as: 1, bs: 1, ax: 'Q', bx: 'Q', c: ['R'], z: 'C' });
  const pages = [
    { quotes: { MU: [q('2024-03-08T14:30:00.275Z', 14.37, 14.44), q('2024-03-08T14:30:30.123456789Z', 14.4, 14.42)] }, next_page_token: 'q2' },
    { quotes: { MU: [q('2024-03-08T14:31:00Z', 14.41, 14.43), q('2024-03-08T14:31:00.5Z', 1, 2)] }, next_page_token: null },
  ];
  const f = fake((call, n) => res(200, pages[n - 1]));
  const quotes = await src(f.fetchImpl, '2026-10-22T12:00:00Z').quotesWindow('MU', '2024-03-08');
  assert.equal(`${f.calls[0].origin}${f.calls[0].path}`, 'https://data.alpaca.markets/v2/stocks/quotes');
  assert.deepEqual(f.calls[0].q, { symbols: 'MU', start: '2024-03-08T14:30:00Z', end: '2024-03-08T14:31:00Z', feed: 'sip', limit: '10000', sort: 'asc' });
  assert.equal(f.calls[1].q.page_token, 'q2');
  assert.deepEqual(quotes, [
    { t: '2024-03-08T14:30:00.275Z', ap: 14.44, bp: 14.37 },
    { t: '2024-03-08T14:30:30.123456789Z', ap: 14.42, bp: 14.4 },
    { t: '2024-03-08T14:31:00Z', ap: 14.43, bp: 14.41 },
  ]);
  // EDT: 09:30 = 13:30Z.
  const g = fake(() => res(200, { quotes: {} }));
  await src(g.fetchImpl, '2026-10-22T12:00:00Z').quotesWindow('MU', '2024-07-01');
  assert.equal(g.calls[0].q.start, '2024-07-01T13:30:00Z');
  await assert.rejects(src(g.fetchImpl, '2026-10-22T12:00:00Z').quotesWindow('MU', '2024-07-04'), /not an NYSE session/);
  await assert.rejects(src(g.fetchImpl, et('2024-07-02', 9, 40)).quotesWindow('MU', '2024-07-02'), (e) => e.kind === 'not_available');
});

test('news: symbols, paging, untrusted text cleaned, created_at filtered locally', async () => {
  const pages = [
    {
      news: [
        { id: 6103508, author: 'Benzinga', content: '', created_at: '2026-10-21T13:00:41Z', updated_at: '2026-10-21T13:00:41Z', headline: 'Micron\u0000<b>news</b>', images: [], source: '', summary: 'line\nbreak', symbols: ['MU'], url: 'https://www.benzinga.com/node/6103508' },
        { id: 6057395, author: 'Benzinga', created_at: '2026-10-01T15:44:51Z', updated_at: '2026-10-21T13:52:26Z', headline: 'Old item updated', source: 'benzinga', summary: '', symbols: ['MU', 'AMZN'], url: 'javascript:alert(1)' },
      ],
      next_page_token: 'n2',
    },
    { news: [{ id: 6103508, created_at: '2026-10-21T13:00:41Z', headline: 'dup' }, { id: 7, created_at: 'not a time' }], next_page_token: null },
  ];
  const f = fake((call, n) => res(200, pages[n - 1]));
  const items = await src(f.fetchImpl, '2026-10-22T12:00:00Z').news(['MU', 'AMZN'], { start: '2026-10-21T00:00:00Z' });
  assert.equal(`${f.calls[0].origin}${f.calls[0].path}`, 'https://data.alpaca.markets/v1beta1/news');
  assert.deepEqual(f.calls[0].q, { symbols: 'MU,AMZN', limit: '50', sort: 'asc', include_content: 'false', start: '2026-10-21T00:00:00Z' });
  assert.equal(f.calls[1].q.page_token, 'n2');
  assert.deepEqual(items.map((n) => n.id), ['6103508', '6057395']);
  assert.deepEqual(items[0], { id: '6103508', created_at: '2026-10-21T13:00:41.000Z', updated_at: '2026-10-21T13:00:41.000Z', headline: 'Micron <b>news</b>', summary: 'line break', source: 'Benzinga', url: 'https://www.benzinga.com/node/6103508', symbols: ['MU'] });
  assert.equal(items[1].url, null, 'only http(s) links are kept');
  assert.equal(items[1].source, 'benzinga');
  // Alpaca's start filters updated_at: an old item comes back; createdFrom drops it.
  const g = fake((call, n) => res(200, pages[n - 1]));
  const recent = await src(g.fetchImpl, '2026-10-22T12:00:00Z').news('MU', { start: '2026-10-21T00:00:00Z', createdFrom: '2026-10-21T00:00:00Z' });
  assert.deepEqual(recent.map((n) => n.id), ['6103508']);
  assert.equal(newsItem({ id: '', created_at: '2026-10-21T13:00:41Z' }), null);
});
