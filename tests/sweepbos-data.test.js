// sweep-bos data layer: the regular-session filter (extended hours, misaligned timestamps, early closes, DST),
// the bounded download through the project's Alpaca client against a fake server, the readiness counts and
// the engine inputs. Synthetic bars only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { createHxrSource } from '../server/hxr/source.js';
import { zonedToUtc, NY } from '../server/time.js';
import * as store from '../server/sweepbos/store.js';
import { sessionSlots, chunks, downloadBars, readinessCheck, loadInputs, fullCount } from '../server/sweepbos/data.js';
import { MAX_BAR_DATE } from '../server/sweepbos/config.js';
import { buildMarket, fakeAlpaca, KEY_ID, SECRET_KEY, CLOCK } from './sweepbos-fake-alpaca.js';

const source = (fetchImpl, { keyId = KEY_ID, secretKey = SECRET_KEY } = {}) => createHxrSource({ keyId, secretKey, fetchImpl, sleep: async () => {}, now: CLOCK });
const openDb = () => store.openSbDb(path.join(tempDir('sb-data-'), 'sweep-bos-sim.sqlite'));
const rawBars = (market, sym) => [...market[sym].sessions.values()].flat().map((b) => ({ ms: b.ms, date: null, minutes: b.minutes, second: b.second, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));

test('sessionSlots keeps the 78 regular slots, drops extended hours, misaligned and bad bars, and uses 42 on an early close', () => {
  const market = buildMarket({ symbols: ['QQQ'], from: '2019-11-27', to: '2019-11-29', misaligned: { QQQ: ['2019-11-27'] }, badOhlc: { QQQ: { '2019-11-27': 3 } } });
  const bars = [];
  for (const [d, list] of market.QQQ.sessions) for (const b of list) bars.push({ ...b, date: d });
  const { rows, dropped } = sessionSlots(bars);
  assert.equal(fullCount('2019-11-27'), 78);
  assert.equal(fullCount('2019-11-29'), 42, 'the day after Thanksgiving closes at 13:00');
  assert.equal(fullCount('2019-11-28'), 0, 'Thanksgiving');
  assert.equal(rows.filter((r) => r.session === '2019-11-27').length, 77, '78 slots minus the bad-OHLC bar');
  assert.equal(rows.filter((r) => r.session === '2019-11-29').length, 42);
  assert.deepEqual(dropped, { outsideSession: 8, misaligned: 1, duplicateSlot: 0, invalidOhlc: 1 });
  const first = rows.find((r) => r.session === '2019-11-27' && r.idx === 0);
  assert.equal(first.hhmm, '09:30');
  assert.equal(first.ts, zonedToUtc('2019-11-27', 9, 30, NY).getTime());
  const last = rows.filter((r) => r.session === '2019-11-29').pop();
  assert.equal(last.idx, 41);
  assert.equal(last.hhmm, '12:55');
  // A duplicate slot is dropped.
  const dup = sessionSlots([{ ...bars[2], date: '2019-11-27' }, { ...bars[2], date: '2019-11-27' }]);
  assert.equal(dup.rows.length, 1);
  assert.equal(dup.dropped.duplicateSlot, 1);
});

test('daylight saving: the 09:30 ET slot is 13:30Z in March and 14:30Z in November, and the index follows the ET clock', () => {
  const market = buildMarket({ symbols: ['SPY'], from: '2019-03-11', to: '2019-03-11', extended: false });
  const m2 = buildMarket({ symbols: ['SPY'], from: '2019-11-04', to: '2019-11-04', extended: false });
  const a = sessionSlots([...market.SPY.sessions.get('2019-03-11')].map((b) => ({ ...b, date: '2019-03-11' }))).rows;
  const b = sessionSlots([...m2.SPY.sessions.get('2019-11-04')].map((b) => ({ ...b, date: '2019-11-04' }))).rows;
  assert.equal(new Date(a[0].ts).toISOString(), '2019-03-11T13:30:00.000Z');
  assert.equal(new Date(b[0].ts).toISOString(), '2019-11-04T14:30:00.000Z');
  assert.equal(a[12].hhmm, '10:30');
  assert.equal(a[77].hhmm, '15:55');
  assert.equal(b.length, 78);
});

test('chunks split a range by calendar months without overlap', () => {
  assert.deepEqual(chunks('2018-06-01', '2018-12-31', 3), [['2018-06-01', '2018-08-31'], ['2018-09-01', '2018-11-30'], ['2018-12-01', '2018-12-31']]);
  assert.deepEqual(chunks('2022-11-15', '2022-12-30', 3), [['2022-11-15', '2022-12-30']]);
  assert.deepEqual(chunks('2019-01-02', '2019-01-02', 1), [['2019-01-02', '2019-01-02']]);
});

test('downloadBars stores only session slots through the Alpaca client, records the version, hash and ledger row, and refuses a late end before any request', async () => {
  const db = openDb();
  const market = buildMarket({ from: '2022-12-12', to: '2022-12-30' });
  const { fetchImpl, calls } = fakeAlpaca({ market });
  const src = source(fetchImpl);
  // Refused before any request: a `to` after the bound.
  await assert.rejects(downloadBars(db, src, { from: '2022-12-12', to: '2023-01-03', now: CLOCK }), store.BarBoundError);
  assert.equal(calls.length, 0, 'no request was sent');
  assert.equal(store.listDataVersions(db).length, 0, 'no version was created');
  // Keys missing: refused with a plain message, no request, no version.
  await assert.rejects(downloadBars(db, createHxrSource({ fetchImpl, now: CLOCK }), { from: '2022-12-12', to: '2022-12-30', now: CLOCK }), /keys are not set/);
  assert.equal(calls.length, 0);
  const lines = [];
  const r = await downloadBars(db, src, { from: '2022-12-12', to: '2022-12-30', now: CLOCK, log: (l) => lines.push(l), preregCommit: 'abc', preregSha256: 'def', chunkMonths: 1 });
  const sessions = 14; // 2022-12-12 .. 2022-12-30 (2022-12-26 closed)
  assert.equal(r.bars1d, sessions * 2);
  assert.equal(r.bars5m, sessions * 78 * 2);
  assert.match(r.dataHash, /^[0-9a-f]{64}$/);
  assert.equal(r.dropped.intraday.QQQ.outsideSession, sessions * 4, 'the pre-market and after-hours bars were dropped');
  assert.ok(lines.every((l) => !/\d+\.\d\d\b/.test(l.replace(/hash [0-9a-f]+/, ''))), 'progress lines carry no price');
  const v = store.getDataVersion(db, r.id);
  assert.equal(v.status, 'complete');
  assert.equal(v.feed, 'sip');
  assert.equal(v.adjustment, 'raw');
  assert.equal(v.preregCommit, 'abc');
  assert.equal(v.dataHash, store.dataHashOf(db, r.id));
  assert.equal(store.listLedger(db).filter((l) => l.kind === 'data_version').length, 1);
  assert.ok(calls.every((c) => c.origin === 'https://data.alpaca.markets' && c.redirect === 'manual'), 'only the Alpaca data host, redirects not followed');
  assert.ok(calls.every((c) => c.q.feed === 'sip' && c.q.adjustment === 'raw'));
  assert.equal(store.maxStoredDate(db), '2022-12-30');
  assert.deepEqual(store.countBarsAfterBound(db), { bars5m: 0, bars1d: 0 });
  // The client itself drops bars outside the requested dates; the data layer still refuses a source that hands
  // back a bar past the requested end (defence in depth, exercised with a stub source), and the version fails.
  const lateDaily = Object.assign([{ date: '2022-12-30', o: 1, h: 2, l: 0.5, c: 1, v: 1, n: 1, vw: 1 }, { date: '2023-01-03', o: 1, h: 2, l: 0.5, c: 1, v: 1, n: 1, vw: 1 }], { dropped: {}, pages: 1 });
  const stub = { id: 'stub', feed: 'sip', adjustment: 'raw', configured: true, dailyBars: async () => lateDaily, intradayBars: async () => Object.assign([], { dropped: {}, pages: 1 }) };
  await assert.rejects(downloadBars(db, stub, { from: '2022-12-28', to: '2022-12-30', now: CLOCK, label: 'late' }), store.BarBoundError);
  const failed = store.listDataVersions(db).find((x) => x.label === 'late');
  assert.equal(failed.status, 'failed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sb_bars_1d WHERE version_id = ?').get(failed.id).n, 0);
  assert.deepEqual(store.countBarsAfterBound(db), { bars5m: 0, bars1d: 0 });
  db.close();
});

test('readinessCheck counts complete, incomplete and missing sessions, odd bars, daily mismatches and the excluded sessions, and the inputs load with the bound asserted', async () => {
  const db = openDb();
  const market = buildMarket({
    from: '2022-01-18', to: '2022-01-31',
    missingSlots: { QQQ: { '2022-01-24': [40, 41, 42] } },
    missingSessions: { SPY: ['2022-01-26'] },
    dailyTweak: { QQQ: { '2022-01-20': { h: 0.5 } } },
  });
  const { fetchImpl } = fakeAlpaca({ market });
  const r = await downloadBars(db, source(fetchImpl), { from: '2022-01-18', to: '2022-01-31', now: CLOCK, chunkMonths: 1 });
  const excluded = [{ date: '2022-01-24', reason: 'gap' }, { date: '2022-01-26', reason: 'gap' }, { date: '2021-10-25', reason: 'outside' }];
  const rd = readinessCheck(db, r.id, { excludedSessions: excluded });
  assert.equal(rd.bound, MAX_BAR_DATE);
  assert.equal(rd.maxStoredDate, '2022-01-31');
  assert.deepEqual(rd.barsAfterBound, { bars5m: 0, bars1d: 0 });
  const q = rd.symbols.QQQ, s = rd.symbols.SPY;
  assert.equal(q.expectedSessions, 10);
  assert.equal(q.complete, 9);
  assert.equal(q.incomplete, 1);
  assert.equal(q.missingSlots, 3);
  assert.equal(q.missingSessions, 0);
  assert.deepEqual(q.incompleteSessionsByYear, { 2022: 1 });
  assert.equal(q.daily.highLowMismatch, 1);
  assert.equal(q.daily.missing, 0);
  assert.equal(s.missingSessions, 1);
  assert.equal(s.missingSlots, 78);
  assert.equal(s.daily.missing, 1, 'the fake has no daily bar for a missing session');
  assert.equal(s.sessionsStored, 9);
  assert.equal(q.badOhlcStored, 0);
  assert.deepEqual(q.excludedSessions.map((x) => [x.date, x.complete]), [['2022-01-24', false], ['2022-01-26', true]]);
  assert.deepEqual(s.excludedSessions.map((x) => [x.date, x.bars]), [['2022-01-24', 78], ['2022-01-26', 0]]);
  const inputs = loadInputs(db, r.id, 'QQQ', { from: '2022-01-18', to: '2022-01-31' });
  assert.equal(inputs.sessions.length, 10);
  assert.equal(inputs.sessions[0].full, 78);
  assert.equal(inputs.sessions.find((x) => x.date === '2022-01-24').bars.length, 75);
  assert.equal(inputs.daily.length, 10);
  assert.throws(() => loadInputs(db, r.id, 'QQQ', { to: '2023-06-30' }), store.BarBoundError);
  db.close();
});
