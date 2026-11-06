// event-swing's bounded data layer (server/eventswing/data.js): no bar, split or dividend after 2021-12-31 is read
// even when the store holds one; the spread table built from samples on or before the bound equals HXR's own table
// on a store without later samples, and gives every fill on or before the bound the same cost when later samples
// exist. Synthetic rows only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDir } from './helpers.js';
import { loadWindowInputs, boundedSpreadTable, halfSpreadFn } from '../server/eventswing/data.js';
import { buildSpreadTable } from '../server/hxr/data.js';
import { synthMarket, fakeHxrDb } from './eventswing-fixtures.js';

const universe = [{ symbol: 'AAA', exchange: 'NASDAQ', listedFrom: '2016-01-04' }, { symbol: 'NEW', exchange: 'NYSE', listedFrom: '2016-03-01' }];

test('the loader stops at 2021-12-31 in the query: later bars, splits and dividends in the store are never read; listings and excluded sessions are respected', () => {
  const m = synthMarket({ from: '2021-10-01', to: '2021-12-31', syms: ['AAA'] });
  const db = fakeHxrDb(tempDir('es-data-'), { inputs: m, extraBars: [{ symbol: 'AAA', date: '2022-01-03', o: 1, h: 1, l: 1, c: 1 }, { symbol: 'NEW', date: '2021-12-30', o: 5, h: 5, l: 5, c: 5 }, { symbol: 'NEW', date: '2016-02-01', o: 9, h: 9, l: 9, c: 9 }], extraActions: [{ id: 's22', type: 'forward_split', symbol: 'AAA', exDate: '2022-01-04', ratioOld: 1, ratioNew: 20 }, { id: 'd22', type: 'cash_dividend', symbol: 'AAA', exDate: '2022-01-05', payDate: '2022-01-20', rate: 1 }, { id: 'd21', type: 'cash_dividend', symbol: 'AAA', exDate: '2021-11-01', payDate: '2021-11-15', rate: 0.5 }] });
  const inp = loadWindowInputs(db, { universe, from: '2021-10-01', excluded: ['2021-10-25'] });
  assert.equal(inp.sessions.at(-1), '2021-12-31');
  assert.ok(!inp.sessions.includes('2021-10-25'));
  assert.ok(![...inp.days.values()].some((d) => d.splits.length), 'the 2022 split is never read');
  assert.deepEqual([...inp.days.values()].flatMap((d) => d.dividends.map((x) => x.exDate)), ['2021-11-01']);
  assert.deepEqual(inp.stockSessions.NEW, ['2021-12-30']);
  assert.equal(loadWindowInputs(db, { universe, from: '2021-10-01', excluded: ['2021-10-25'] }).inputsHash, inp.inputsHash);
  assert.throws(() => loadWindowInputs(db, { universe, from: '2021-10-01', to: '2022-01-31' }), /after the bound/);
  db.close();
});

test('the bounded spread table equals HXR\'s table on a store with no later sample, and every lookup on or before the bound is unchanged when later samples exist', () => {
  const m = synthMarket({ from: '2016-01-04', to: '2016-02-29', syms: ['AAA'] });
  const samples = [];
  for (const y of [2016, 2017, 2018, 2019, 2020, 2021]) for (const [mo, bps] of [['01', 3 + (y % 3)], ['05', 2.5], ['09', 4 + (y % 2)]]) samples.push({ symbol: 'AAA', date: `${y}-${mo}-04`, bps }), samples.push({ symbol: 'NEW', date: `${y}-${mo}-05`, bps: 6 });
  const dir = tempDir('es-data-');
  const only = fakeHxrDb(dir, { inputs: m, samples });
  const u = { symbols: universe };
  const hxr = buildSpreadTable(only, u, { floorBps: 2, toYear: 2021 });
  const mine = boundedSpreadTable(only, universe, { floorBps: 2 });
  assert.deepEqual([mine.table, mine.steps, mine.firstSampled, mine.hash], [hxr.table, hxr.steps, hxr.firstSampled, hxr.hash]);
  only.close();
  const later = fakeHxrDb(tempDir('es-data-'), { inputs: m, samples: [...samples, { symbol: 'AAA', date: '2022-01-04', bps: 40 }, { symbol: 'AAA', date: '2026-05-01', bps: 90 }] });
  const full = halfSpreadFn(buildSpreadTable(later, u, { floorBps: 2, toYear: 2021 })), bounded = boundedSpreadTable(later, universe, { floorBps: 2 });
  const fb = halfSpreadFn(bounded);
  for (const d of ['2016-01-04', '2016-03-01', '2018-06-30', '2020-12-31', '2021-09-04', '2021-12-31']) for (const s of ['AAA', 'NEW']) assert.equal(fb(s, d), full(s, d), `${s} ${d}`);
  assert.equal(fb('AAA', '2022-06-01'), fb('AAA', '2021-12-31'), 'no later sample is visible to the bounded table');
  later.close();
});
