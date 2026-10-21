// Strategy Lab data layer: CSV parsing (TradingView export and generic files),
// normalisation to regular-session 15-minute bars, resampling, the quality
// report, the dataset hash and the synthetic generator (test data only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTradingViewCsv, parseGenericCsv, parseTime, normalizeBars, qualityReport, datasetHash } from '../server/strategy/data.js';
import { generateSyntheticBars } from '../server/strategy/synthetic.js';
import { sessionBarStarts, barInfo } from '../server/strategy/sessions.js';
import { loadStrategyConfig } from '../server/strategy/config.js';
import { runBacktest } from '../server/strategy/engine.js';

const sec = (iso) => Date.parse(iso) / 1000;

test('TradingView export: UNIX seconds, Volume column, extra indicator columns', () => {
  const csv = [
    'time,open,high,low,close,Volume,Volume MA,Plot',
    `${sec('2024-03-05T14:30:00Z')},100.00,101.00,99.40,100.60,1000,950.5,1`,
    `${sec('2024-03-05T14:45:00Z')},100.60,100.70,99.00,99.40,,950.5,1`,
    `${sec('2024-03-05T15:00:00Z')},99.40,100.90,99.30,100.70,"1,200",NaN,`,
    'garbage,1,2,3,4,5,6,7',
  ].join('\r\n');
  const r = parseTradingViewCsv(csv);
  assert.equal(r.format, 'tradingview');
  assert.equal(r.timeFormat, 'unix');
  assert.equal(r.columns.volume, 'Volume');
  assert.deepEqual(r.bars[0], { t: '2024-03-05T14:30:00.000Z', o: 100, h: 101, l: 99.4, c: 100.6, v: 1000 });
  assert.equal(r.bars[1].v, null, 'empty volume is unavailable, not zero');
  assert.equal(r.bars[2].v, 1200);
  assert.deepEqual(r.rejected, [{ line: 5, reason: 'unreadable time' }]);
});

test('TradingView export with ISO times and different header case', () => {
  const csv = 'Time,Open,High,Low,Close\n2024-03-05T09:30:00-05:00,1,2,0.5,1.5\n2024-07-01T09:30:00-04:00,1,2,0.5,1.5\n';
  const r = parseTradingViewCsv(csv);
  assert.equal(r.timeFormat, 'iso');
  assert.deepEqual(r.bars.map((b) => b.t), ['2024-03-05T14:30:00.000Z', '2024-07-01T13:30:00.000Z']);
  assert.equal(r.bars[0].v, null);
  assert.equal(r.volumeColumn, false);
  assert.throws(() => parseTradingViewCsv('date,price\n1,2'), /missing open, high, low, close/);
});

test('generic CSV: naive times are exchange-local (DST-aware); date + time columns; offsets respected', () => {
  const csv = 'Date;Time;Open;High;Low;Close;Volume\n2024-03-08;09:30;10;11;9;10.5;100\n2024-03-11;9:30 AM;10;11;9;10.5;100\n2024-03-11;3:45 PM;10;11;9;10.5;0\n';
  const r = parseGenericCsv(csv);
  assert.equal(r.timeColumns, 'date + time');
  assert.deepEqual(r.bars.map((b) => b.t), ['2024-03-08T14:30:00.000Z', '2024-03-11T13:30:00.000Z', '2024-03-11T19:45:00.000Z']);
  assert.equal(r.bars[2].v, null, 'zero volume counts as unavailable');
  const r2 = parseGenericCsv('timestamp,open,high,low,close,volume\n2024-03-05 09:45:00,1,2,0.5,1.5,10\n2024-03-05T14:30:00Z,1,2,0.5,1.5,10\n03/05/2024 10:00,1,2,0.5,1.5,10\n');
  assert.deepEqual(r2.bars.map((b) => b.t), ['2024-03-05T14:45:00.000Z', '2024-03-05T14:30:00.000Z', '2024-03-05T15:00:00.000Z']);
  assert.equal(parseTime('1709649000'), Date.parse('2024-03-05T14:30:00Z'));
  assert.equal(parseTime('1709649000000'), Date.parse('2024-03-05T14:30:00Z'));
  assert.equal(parseTime('2024-03-05 09:30', 'America/Toronto'), Date.parse('2024-03-05T14:30:00Z'));
  assert.throws(() => parseGenericCsv('when,o,h\n1,2,3'), /missing/);
});

const bar = (t, o, h, l, c, v = 100) => ({ t, o, h, l, c, v });

test('normalisation keeps regular-session 15-minute bars only (early closes, holidays, pre/post)', () => {
  const raw = [
    bar('2024-03-05T14:00:00Z', 1, 2, 0.5, 1.5), // 09:00 pre-market
    bar('2024-03-05T14:30:00Z', 1, 2, 0.5, 1.5),
    bar('2024-03-05T14:45:00Z', 1, 2, 0.5, 1.5),
    bar('2024-03-05T14:45:00Z', 1, 2, 0.5, 1.6), // conflicting duplicate
    bar('2024-03-05T20:45:00Z', 1, 2, 0.5, 1.5), // 15:45, last regular bar
    bar('2024-03-05T21:00:00Z', 1, 2, 0.5, 1.5), // 16:00 post-market
    bar('2024-03-05T15:00:00Z', 1, 0.5, 2, 1.5), // high below low
    bar('2024-11-29T17:45:00Z', 1, 2, 0.5, 1.5), // 12:45 on an early close: kept
    bar('2024-11-29T18:00:00Z', 1, 2, 0.5, 1.5), // 13:00 on an early close: after the close
    bar('2024-11-28T15:00:00Z', 1, 2, 0.5, 1.5), // Thanksgiving
  ];
  const n = normalizeBars(raw, { exchange: 'NYSE' });
  assert.equal(n.inputIntervalMinutes, 15);
  assert.deepEqual(n.bars.map((b) => b.t), ['2024-03-05T14:30:00.000Z', '2024-03-05T14:45:00.000Z', '2024-03-05T20:45:00.000Z', '2024-11-29T17:45:00.000Z']);
  assert.equal(n.bars[1].c, 1.5, 'the first of two duplicates is kept');
  assert.deepEqual(n.dropped, { invalid: 1, duplicates: 1, conflictingDuplicates: 1, outsideSession: 4, misaligned: 0, incompleteBuckets: 0 });
});

function minutes(startIso, n, f = (i) => [100 + i, 100.5 + i, 99.5 + i, 100.2 + i, 10]) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [o, h, l, c, v] = f(i);
    out.push(bar(new Date(Date.parse(startIso) + i * 60000).toISOString(), o, h, l, c, v));
  }
  return out;
}

test('1-minute bars resample to 15 minutes; a bucket missing a minute is dropped', () => {
  const raw = [...minutes('2024-03-05T14:25:00Z', 5), ...minutes('2024-03-05T14:30:00Z', 30)];
  const n = normalizeBars(raw);
  assert.equal(n.inputIntervalMinutes, 1);
  assert.equal(n.dropped.outsideSession, 5);
  assert.deepEqual(n.bars, [
    { t: '2024-03-05T14:30:00.000Z', o: 100, h: 114.5, l: 99.5, c: 114.2, v: 150 },
    { t: '2024-03-05T14:45:00.000Z', o: 115, h: 129.5, l: 114.5, c: 129.2, v: 150 },
  ]);
  const gappy = raw.filter((b) => b.t !== '2024-03-05T14:40:00.000Z');
  const g = normalizeBars(gappy);
  assert.deepEqual(g.bars.map((b) => b.t), ['2024-03-05T14:45:00.000Z']);
  assert.equal(g.dropped.incompleteBuckets, 1);
  const noVol = raw.map((b) => (b.t === '2024-03-05T14:50:00.000Z' ? { ...b, v: null } : b));
  assert.equal(normalizeBars(noVol).bars[1].v, null, 'one missing sub-bar volume makes the bucket volume unavailable');
  // 5-minute input
  const five = [0, 5, 10, 15, 20, 25].map((m, i) => bar(new Date(Date.parse('2024-07-01T13:30:00Z') + m * 60000).toISOString(), 10 + i, 11 + i, 9 + i, 10.5 + i, 7));
  const f = normalizeBars(five);
  assert.equal(f.inputIntervalMinutes, 5);
  assert.deepEqual(f.bars, [{ t: '2024-07-01T13:30:00.000Z', o: 10, h: 13, l: 9, c: 12.5, v: 21 }, { t: '2024-07-01T13:45:00.000Z', o: 13, h: 16, l: 12, c: 15.5, v: 21 }]);
  const ten = [0, 10, 20].map((m) => bar(new Date(Date.parse('2024-07-01T13:30:00Z') + m * 60000).toISOString(), 1, 2, 0.5, 1.5));
  assert.throws(() => normalizeBars(ten), /cannot be turned into 15-minute bars/);
});

test('quality report: expected vs present per session, duplicates, bad prices, missing volume, big moves', () => {
  const day = (date) => sessionBarStarts(date).map((ms) => bar(new Date(ms).toISOString(), 100, 101, 99, 100, 1000));
  const bars = [...day('2024-11-27'), ...day('2024-11-29')];
  bars.splice(3, 1); // one missing bar on 11-27
  bars.push({ ...bars[0] }); // a duplicate (also unsorted)
  bars[5] = { ...bars[5], v: null };
  bars[6] = { ...bars[6], l: -1 };
  bars[7] = { ...bars[7], h: 98 };
  bars[10] = { ...bars[10], c: 130, h: 131 }; // +30%, then -23% back to 100
  const q = qualityReport(bars);
  assert.equal(q.sessions, 2, 'Thanksgiving is not a session');
  assert.equal(q.expectedBars, 26 + 14, 'the early close has 14 bars');
  assert.equal(q.presentBars, 39);
  assert.equal(q.missingBars, 1);
  assert.deepEqual(q.incompleteSessionList, [{ date: '2024-11-27', expected: 26, present: 25, earlyClose: false }]);
  assert.equal(q.duplicates, 1);
  assert.equal(q.unsorted, 1);
  assert.equal(q.missingVolume, 1);
  assert.equal(q.nonPositivePrices, 1);
  assert.equal(q.highBelowLow, 1);
  assert.equal(q.bigMoves, 2, '100 -> 130 and back');
  assert.ok(Math.abs(q.bigMoveList[0].pct - 30) < 1e-9);
  assert.equal(qualityReport([bar('2024-03-05T14:30:00Z', 100, 101, 99, 100), bar('2024-03-05T14:45:00Z', 100, 101, 79, 80)]).bigMoves, 0, 'exactly 20% is not over 20%');
  assert.equal(q.ok, false);
  const clean = qualityReport([...day('2024-11-27'), ...day('2024-11-29')]);
  assert.equal(clean.ok, true);
  assert.equal(clean.missingBars, 0);
});

test('dataset hash: order-independent across symbols, format-independent times, sensitive to values', () => {
  const a = [bar('2024-03-05T14:30:00Z', 1, 2, 0.5, 1.5, 10)], b = [bar('2024-03-05T14:30:00.000Z', 3, 4, 2.5, 3.5, null)];
  const h1 = datasetHash(new Map([['AAA', a], ['BBB', b]]));
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(datasetHash(new Map([['BBB', b], ['AAA', a]])), h1);
  assert.equal(datasetHash({ AAA: [{ ...a[0], t: Date.parse(a[0].t) }], BBB: [{ ...b[0], v: 0 }] }), h1);
  assert.notEqual(datasetHash(new Map([['AAA', [{ ...a[0], c: 1.51 }]], ['BBB', b]])), h1);
  assert.notEqual(datasetHash(new Map([['AAA', a]])), h1);
});

test('synthetic bars: seeded, flagged, on real NYSE sessions (holidays, early closes), sane OHLC', () => {
  const g1 = generateSyntheticBars({ symbols: ['AAA', { symbol: 'BBB' }], from: '2024-11-25', to: '2024-12-31', seed: 42 });
  const g2 = generateSyntheticBars({ symbols: ['AAA', 'BBB'], from: '2024-11-25', to: '2024-12-31', seed: 42 });
  const g3 = generateSyntheticBars({ symbols: ['AAA', 'BBB'], from: '2024-11-25', to: '2024-12-31', seed: 43 });
  assert.equal(g1.synthetic, true);
  assert.equal(g1.bars.synthetic, true);
  assert.equal(g1.bars.get('AAA').synthetic, true);
  assert.match(g1.note, /not market data and not strategy performance/);
  assert.deepEqual([...g1.bars], [...g2.bars]);
  assert.notDeepEqual(g1.bars.get('AAA'), g3.bars.get('AAA'));
  const aaa = g1.bars.get('AAA');
  assert.ok(!aaa.some((x) => x.t.startsWith('2024-11-28') || x.t.startsWith('2024-12-25')), 'no bars on holidays');
  const ec = aaa.filter((x) => x.t.startsWith('2024-11-29'));
  assert.equal(ec.length, 14);
  assert.equal(ec[13].t, '2024-11-29T17:45:00.000Z');
  assert.equal(aaa.filter((x) => x.t.startsWith('2024-12-24')).length, 14, 'Christmas Eve closes at 13:00');
  for (const x of aaa) {
    assert.ok(barInfo(x.t).inSession && barInfo(x.t).aligned);
    assert.ok(x.l > 0 && x.l <= Math.min(x.o, x.c) && x.h >= Math.max(x.o, x.c));
  }
  assert.equal(qualityReport(aaa).missingBars, 0);
  const r = runBacktest({ config: loadStrategyConfig(), mode: 'swing', bars: g1.bars, symbols: ['AAA', 'BBB'] });
  assert.equal(r.meta.synthetic, true, 'runs on synthetic bars are flagged');
  const r2 = runBacktest({ config: loadStrategyConfig(), mode: 'swing', bars: new Map([...g1.bars].map(([k, v]) => [k, [...v]])), symbols: ['AAA', 'BBB'], synthetic: true });
  assert.equal(r2.meta.synthetic, true);
});
