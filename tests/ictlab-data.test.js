// ICT Lab data layer: the regular-session filter (extended hours, misaligned timestamps, early closes, DST), the
// bounded QQQ download through the project's Alpaca client against a fake server, the readiness counts, the
// read-only comparison against a sweep-bos file, and the engine inputs. Synthetic bars only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import { createHxrSource } from '../server/hxr/source.js';
import { zonedToUtc, NY } from '../server/time.js';
import * as store from '../server/ictlab/store.js';
import { sessionSlots, chunks, downloadBars, readinessCheck, loadInputs, fullCount, compareWithSweepBos } from '../server/ictlab/data.js';
import { MAX_BAR_DATE } from '../server/ictlab/config.js';
import { buildMarket, fakeAlpaca, KEY_ID, SECRET_KEY, CLOCK } from './ictlab-fake-alpaca.js';

const source = (fetchImpl, { keyId = KEY_ID, secretKey = SECRET_KEY } = {}) => createHxrSource({ keyId, secretKey, fetchImpl, sleep: async () => {}, now: CLOCK });
const openDb = () => { const dir = tempDir('il-data-'); return { db: store.openIlDb(path.join(dir, 'ict-lab-sim.sqlite')), dir }; };

test('sessionSlots keeps the 78 regular slots, drops extended hours, misaligned and bad bars, and uses 42 on an early close; the index follows the ET clock across DST', () => {
  const market = buildMarket({ from: '2019-11-27', to: '2019-11-29', misaligned: { QQQ: ['2019-11-27'] }, badOhlc: { QQQ: { '2019-11-27': 3 } } });
  const bars = [];
  for (const [d, list] of market.QQQ.sessions) for (const b of list) bars.push({ ...b, date: d });
  const { rows, dropped } = sessionSlots(bars);
  assert.equal(fullCount('2019-11-27'), 78);
  assert.equal(fullCount('2019-11-29'), 42, 'the day after Thanksgiving closes at 13:00');
  assert.equal(fullCount('2019-11-28'), 0, 'Thanksgiving');
  assert.equal(rows.filter((r) => r.session === '2019-11-27').length, 77);
  assert.equal(rows.filter((r) => r.session === '2019-11-29').length, 42);
  assert.deepEqual(dropped, { outsideSession: 8, misaligned: 1, duplicateSlot: 0, invalidOhlc: 1 });
  const first = rows.find((r) => r.session === '2019-11-27' && r.idx === 0);
  assert.equal(first.hhmm, '09:30');
  assert.equal(first.ts, zonedToUtc('2019-11-27', 9, 30, NY).getTime());
  assert.equal(rows.filter((r) => r.session === '2019-11-29').pop().hhmm, '12:55');
  const dup = sessionSlots([{ ...bars[2], date: '2019-11-27' }, { ...bars[2], date: '2019-11-27' }]);
  assert.equal(dup.rows.length, 1);
  assert.equal(dup.dropped.duplicateSlot, 1);
  const m1 = buildMarket({ from: '2019-03-11', to: '2019-03-11', extended: false }), m2 = buildMarket({ from: '2019-11-04', to: '2019-11-04', extended: false });
  const a = sessionSlots([...m1.QQQ.sessions.get('2019-03-11')].map((b) => ({ ...b, date: '2019-03-11' }))).rows;
  const b = sessionSlots([...m2.QQQ.sessions.get('2019-11-04')].map((b) => ({ ...b, date: '2019-11-04' }))).rows;
  assert.equal(new Date(a[0].ts).toISOString(), '2019-03-11T13:30:00.000Z');
  assert.equal(new Date(b[0].ts).toISOString(), '2019-11-04T14:30:00.000Z');
  assert.equal(a[17].hhmm, '10:55', 'index 17 is the 10:55 bar, the last of the window');
  assert.equal(a[18].hhmm, '11:00');
  assert.deepEqual(chunks('2018-06-01', '2018-12-31', 3), [['2018-06-01', '2018-08-31'], ['2018-09-01', '2018-11-30'], ['2018-12-01', '2018-12-31']]);
});

test('downloadBars stores QQQ only through the Alpaca client, records the version, hash and ledger row, and refuses a late end before any request', async () => {
  const { db } = openDb();
  const market = buildMarket({ from: '2022-12-12', to: '2022-12-30' });
  const { fetchImpl, calls } = fakeAlpaca({ market });
  const src = source(fetchImpl);
  await assert.rejects(downloadBars(db, src, { from: '2022-12-12', to: '2023-01-03', now: CLOCK }), store.BarBoundError);
  assert.equal(calls.length, 0, 'no request was sent');
  assert.equal(store.listDataVersions(db).length, 0);
  await assert.rejects(downloadBars(db, src, { symbols: ['QQQ', 'SPY'], from: '2022-12-12', to: '2022-12-30', now: CLOCK }), /QQQ only/);
  assert.equal(calls.length, 0);
  await assert.rejects(downloadBars(db, createHxrSource({ fetchImpl, now: CLOCK }), { from: '2022-12-12', to: '2022-12-30', now: CLOCK }), /keys are not set/);
  assert.equal(calls.length, 0);
  const lines = [];
  const r = await downloadBars(db, src, { from: '2022-12-12', to: '2022-12-30', now: CLOCK, log: (l) => lines.push(l), preregCommit: 'abc', protocolSha256: 'def', chunkMonths: 1 });
  const sessions = 14;
  assert.equal(r.bars1d, sessions);
  assert.equal(r.bars5m, sessions * 78);
  assert.match(r.dataHash, /^[0-9a-f]{64}$/);
  assert.equal(r.dropped.intraday.QQQ.outsideSession, sessions * 4);
  assert.ok(lines.every((l) => !/\d+\.\d\d\b/.test(l.replace(/hash [0-9a-f]+/, ''))), 'progress lines carry no price');
  const v = store.getDataVersion(db, r.id);
  assert.equal(v.status, 'complete');
  assert.deepEqual(v.symbols, ['QQQ']);
  assert.equal(v.preregCommit, 'abc');
  assert.equal(v.protocolSha256, 'def');
  assert.equal(v.dataHash, store.dataHashOf(db, r.id));
  assert.equal(store.listLedger(db).filter((l) => l.kind === 'data_version').length, 1);
  assert.ok(calls.every((c) => c.origin === 'https://data.alpaca.markets' && c.redirect === 'manual' && c.q.symbols === 'QQQ'));
  assert.ok(calls.every((c) => c.q.feed === 'sip' && c.q.adjustment === 'raw'));
  assert.equal(store.maxStoredDate(db), '2022-12-30');
  assert.deepEqual(store.countBarsAfterBound(db), { bars5m: 0, bars1d: 0 });
  // A source that hands back a bar past the requested end is refused and the version fails.
  const lateDaily = Object.assign([{ date: '2022-12-30', o: 1, h: 2, l: 0.5, c: 1, v: 1, n: 1, vw: 1 }, { date: '2023-01-03', o: 1, h: 2, l: 0.5, c: 1, v: 1, n: 1, vw: 1 }], { dropped: {}, pages: 1 });
  const stub = { id: 'stub', feed: 'sip', adjustment: 'raw', configured: true, dailyBars: async () => lateDaily, intradayBars: async () => Object.assign([], { dropped: {}, pages: 1 }) };
  await assert.rejects(downloadBars(db, stub, { from: '2022-12-28', to: '2022-12-30', now: CLOCK, label: 'late' }), store.BarBoundError);
  assert.equal(store.listDataVersions(db).find((x) => x.label === 'late').status, 'failed');
  assert.deepEqual(store.countBarsAfterBound(db), { bars5m: 0, bars1d: 0 });
  db.close();
});

test('readinessCheck counts complete, incomplete and missing sessions, odd bars and daily mismatches; loadInputs asserts the bound', async () => {
  const { db } = openDb();
  const market = buildMarket({ from: '2022-01-18', to: '2022-01-31', missingSlots: { QQQ: { '2022-01-24': [40, 41, 42] } }, dailyTweak: { QQQ: { '2022-01-20': { h: 0.5 } } } });
  const { fetchImpl } = fakeAlpaca({ market });
  const r = await downloadBars(db, source(fetchImpl), { from: '2022-01-18', to: '2022-01-31', now: CLOCK, chunkMonths: 1 });
  const rd = readinessCheck(db, r.id);
  assert.equal(rd.bound, MAX_BAR_DATE);
  assert.equal(rd.maxStoredDate, '2022-01-31');
  assert.deepEqual(rd.barsAfterBound, { bars5m: 0, bars1d: 0 });
  const q = rd.symbols.QQQ;
  assert.equal(q.expectedSessions, 10);
  assert.equal(q.complete, 9);
  assert.equal(q.incomplete, 1);
  assert.equal(q.missingSlots, 3);
  assert.deepEqual(q.incompleteSessionsByYear, { 2022: 1 });
  assert.equal(q.daily.highLowMismatch, 1);
  assert.equal(q.badOhlcStored, 0);
  const inputs = loadInputs(db, r.id, 'QQQ', { from: '2022-01-18', to: '2022-01-31' });
  assert.equal(inputs.sessions.length, 10);
  assert.equal(inputs.sessions[0].full, 78);
  assert.equal(inputs.sessions.find((x) => x.date === '2022-01-24').bars.length, 75);
  assert.equal(inputs.daily.length, 10);
  assert.throws(() => loadInputs(db, r.id, 'QQQ', { to: '2023-06-30' }), store.BarBoundError);
  db.close();
});

test('compareWithSweepBos reads a sweep-bos file read-only by real path, reports counts and dates only, writes nothing, and refuses other files', async () => {
  const { db, dir } = openDb();
  const market = buildMarket({ from: '2022-12-12', to: '2022-12-30', extended: false });
  const { fetchImpl } = fakeAlpaca({ market });
  const r = await downloadBars(db, source(fetchImpl), { from: '2022-12-12', to: '2022-12-30', now: CLOCK, chunkMonths: 1 });
  // A synthetic sweep-bos file with the same bars, one bar changed, one bar missing, one session extra in sweep-bos.
  const sbFile = path.join(dir, 'sweep-bos-sim.sqlite');
  const sb = new DatabaseSync(sbFile);
  sb.exec(`CREATE TABLE sb_data_versions (id INTEGER PRIMARY KEY, data_hash TEXT, from_date TEXT, to_date TEXT, status TEXT);
    CREATE TABLE sb_bars_5m (version_id INTEGER, symbol TEXT, session TEXT, idx INTEGER, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL);
    CREATE TABLE sb_bars_1d (version_id INTEGER, symbol TEXT, date TEXT, o REAL, h REAL, l REAL, c REAL, v REAL);
    INSERT INTO sb_data_versions VALUES (1, 'old', '2018-06-01', '2022-12-30', 'failed');
    INSERT INTO sb_data_versions VALUES (2, 'sbhash', '2018-06-01', '2022-12-30', 'complete');`);
  const ins5 = sb.prepare('INSERT INTO sb_bars_5m VALUES (2, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const ins1 = sb.prepare('INSERT INTO sb_bars_1d VALUES (2, ?, ?, ?, ?, ?, ?, ?)');
  for (const b of store.loadBars5m(db, r.id, 'QQQ')) {
    if (b.session === '2022-12-13' && b.idx === 5) continue; // missing in sweep-bos
    ins5.run('QQQ', b.session, b.idx, b.ts, b.o, b.h, b.l, b.session === '2022-12-14' && b.idx === 2 ? b.c + 0.01 : b.c, b.v);
  }
  ins5.run('SPY', '2022-12-13', 0, 1, 1, 2, 0.5, 1, 1);
  ins5.run('QQQ', '2022-12-09', 0, 1, 1, 2, 0.5, 1, 1); // a session only in sweep-bos (outside the lab's range: not compared)
  ins5.run('QQQ', '2022-12-15', 99, 1, 1, 2, 0.5, 1, 1); // an extra slot only in sweep-bos
  ins5.run('QQQ', '2023-01-03', 0, 1, 1, 2, 0.5, 1, 1); // after the bound: never read
  for (const d of store.loadBars1d(db, r.id, 'QQQ')) ins1.run('QQQ', d.date, d.o, d.h, d.l, d.date === '2022-12-16' ? d.c + 0.02 : d.c, d.v);
  sb.close();
  const before = fs.statSync(sbFile).mtimeMs;
  const cmp = compareWithSweepBos(db, r.id, sbFile);
  assert.equal(cmp.available, true);
  assert.equal(cmp.sweepBos.versionId, 2);
  assert.equal(cmp.sweepBos.dataHash, 'sbhash');
  assert.equal(cmp.identical, false);
  assert.equal(cmp.bars5m.lab, 14 * 78);
  assert.equal(cmp.bars5m.onlyInLab, 1);
  assert.equal(cmp.bars5m.onlyInSweepBos, 1);
  assert.equal(cmp.bars5m.differing, 1);
  assert.deepEqual(cmp.bars5m.fields, { ts: 0, o: 0, h: 0, l: 0, c: 1, v: 0 });
  assert.deepEqual(cmp.bars5m.datesOnlyInLab, { count: 1, dates: ['2022-12-13'], truncated: false });
  assert.deepEqual(cmp.bars5m.datesOnlyInSweepBos, { count: 1, dates: ['2022-12-15'], truncated: false });
  assert.deepEqual(cmp.bars5m.datesDiffering, { count: 1, dates: ['2022-12-14'], truncated: false });
  assert.equal(cmp.bars1d.differing, 1);
  assert.deepEqual(cmp.bars1d.datesDiffering.dates, ['2022-12-16']);
  assert.ok(!JSON.stringify(cmp).includes('180.'), 'no price in the comparison');
  assert.equal(fs.statSync(sbFile).mtimeMs, before, 'nothing written to the sweep-bos file');
  const sb2 = new DatabaseSync(sbFile, { readOnly: true });
  assert.equal(sb2.prepare('SELECT COUNT(*) AS n FROM sb_bars_5m').get().n, 14 * 78 - 1 + 4);
  sb2.close();
  assert.deepEqual(compareWithSweepBos(db, r.id, path.join(dir, 'missing.sqlite')), { available: false, reason: 'missing.sqlite does not exist', symbol: 'QQQ' });
  assert.throws(() => compareWithSweepBos(db, r.id, path.join(dir, 'ict-lab-sim.sqlite')), /only a sweep-bos database/);
  db.close();
});
