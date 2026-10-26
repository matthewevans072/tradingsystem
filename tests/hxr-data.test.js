// HXR data layer on synthetic rows (no network, no real data): the sampled
// spread days and the spread table (carry-forward and floor), engine inputs
// (listing cut-off for an NBIS-like symbol, dividends before the listing
// ignored, split ratios and dates, excluded sessions, the data hash) and the
// readiness verdicts with a planted unexplained split and a missing session.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from './helpers.js';
import * as store from '../server/hxr/store.js';
import { sampledSpreadDays, spreadSampleFromQuotes, buildSpreadTable, halfSpreadFn, buildInputs, readiness, median } from '../server/hxr/data.js';
import { validateHxrUniverse, validateHxrPeriods } from '../server/hxr/config.js';
import { tradingDays } from '../server/strategy/sessions.js';

const openDb = () => store.openHxrDb(path.join(tempDir('hxr-data-'), 'hxr-sim.sqlite'));
const r4 = (x) => Math.round(x * 10000) / 10000;

const UNIVERSE = {
  symbols: [
    { symbol: 'AAA', exchange: 'NASDAQ', listedFrom: '2024-01-02', baskets: ['A', 'B'], techAi: true },
    { symbol: 'BBB', exchange: 'NYSE', listedFrom: '2024-01-02', baskets: ['A'] },
    { symbol: 'NB', exchange: 'NASDAQ', listedFrom: '2024-03-01', baskets: ['B'], note: 'History before 2024-03-01 is another company (Yandex-like) and is never used.' },
    { symbol: 'CCC', exchange: 'NASDAQ', listedFrom: '2024-01-02', baskets: [] },
    { symbol: 'SPX2', exchange: 'NASDAQ', listedFrom: '2024-06-03', baskets: ['prospective'], identity: 'pending_owner_confirmation' },
  ],
  baskets: {
    A: { symbols: ['AAA', 'BBB'] },
    B: { symbols: ['AAA', 'NB'] },
    prospective: { symbols: ['AAA', 'NB'], addWhenConfirmed: ['SPX2'] },
  },
};
const PERIODS = {
  dataFrom: '2024-01-02',
  warmupSessions: 20,
  periods: {
    development: { basket: 'A', warmupFrom: '2024-01-02', start: '2024-02-01', end: '2024-03-28' },
    validation: { basket: 'A', warmupFrom: '2024-01-02', start: '2024-04-01', end: '2024-06-28' },
    final: { basket: 'A', warmupFrom: '2024-01-02', start: '2024-04-01', end: '2024-06-28' },
    fullList: { basket: 'B', warmupFrom: '2024-01-02', start: '2024-05-01', end: '2024-06-28' },
    prospective: { basket: 'prospective', start: 'the first session after the account is started' },
  },
  excludedSessions: [{ date: '2024-02-07', reason: 'synthetic data gap' }],
};
const ALL = tradingDays('2024-01-02', '2024-06-28');

// Raw daily bars with small overnight moves. splits: { date: ratio } divides
// prices from that date (raw, unadjusted); shocks: { date: multiplier } is a
// real overnight move of the price itself.
function makeBars(dates, { start = 100, splits = {}, shocks = {}, volume = 1e6 } = {}) {
  let p = start, factor = 1;
  return dates.map((d, i) => {
    if (splits[d]) factor *= splits[d];
    if (shocks[d]) p *= shocks[d];
    const o = p * (1 + 0.002 * Math.cos(i)), c = o * (1 + 0.003 * Math.sin(i));
    p = c;
    const ro = o / factor, rc = c / factor;
    return { date: d, o: r4(ro), h: r4(Math.max(ro, rc) * 1.01), l: r4(Math.min(ro, rc) * 0.99), c: r4(rc), v: volume, n: 100, vw: r4((ro + rc) / 2) };
  });
}

function seed(db) {
  store.upsertBars(db, 'AAA', makeBars(ALL, { start: 100, splits: { '2024-03-15': 2 } }));
  // BBB: a missing session (2024-05-15) and an unexplained overnight fall to a third (2024-02-20).
  store.upsertBars(db, 'BBB', makeBars(ALL, { start: 60, shocks: { '2024-02-20': 1 / 3 } }).filter((b) => b.date !== '2024-05-15'));
  // NB: zero-volume bars of the previous company before the listing, then the listed company at twice the price.
  const before = ALL.filter((d) => d < '2024-03-01'), after = ALL.filter((d) => d >= '2024-03-01');
  store.upsertBars(db, 'NB', [...makeBars(before, { start: 20, volume: 0 }), ...makeBars(after, { start: 40 })]);
  // CCC: a recorded 1-for-10 reverse split the prices do not show, a zero-volume bar and a bar with high below low.
  store.upsertBars(db, 'CCC', makeBars(ALL, { start: 10 }).map((b) => (b.date === '2024-05-06' ? { ...b, v: 0 } : b.date === '2024-05-07' ? { ...b, h: b.l - 0.1 } : b)));
  store.upsertCorporateActions(db, [
    { id: 'aaa-s1', type: 'forward_split', symbol: 'AAA', ex_date: '2024-03-15', process_date: '2024-03-15', ratio_old: 1, ratio_new: 2 },
    { id: 'aaa-d1', type: 'cash_dividend', symbol: 'AAA', ex_date: '2024-05-10', pay_date: '2024-05-31', rate: 0.25 },
    { id: 'aaa-d2', type: 'cash_dividend', symbol: 'AAA', ex_date: '2024-06-14', pay_date: null, rate: 0.3 },
    { id: 'nb-old', type: 'cash_dividend', symbol: 'NB', ex_date: '2024-02-15', pay_date: '2024-02-28', rate: 9 },
    { id: 'nb-d1', type: 'cash_dividend', symbol: 'NB', ex_date: '2024-06-03', pay_date: '2024-06-20', rate: 0.1 },
    { id: 'nb-name', type: 'name_change', symbol: 'NB', process_date: '2024-02-20', old_symbol: 'YNDX', new_symbol: 'NB' },
    { id: 'ccc-rs', type: 'reverse_split', symbol: 'CCC', ex_date: '2024-04-15', ratio_old: 10, ratio_new: 1 },
    { id: 'spx-old', type: 'cash_dividend', symbol: 'SPX2', ex_date: '2023-12-19', pay_date: '2023-12-21', rate: 0.5 },
  ]);
  store.upsertFirst15(db, 'AAA', [{ date: '2024-05-01', o: 1, h: 1, l: 1, c: 1, v: 1, vw: 55.5 }]);
  store.upsertSpreadSamples(db, ['2024-01-02', '2024-03-01', '2024-05-01'].map((date) => ({ symbol: 'AAA', date, quotes: 50, dropped: 0, medianSpreadBps: 6, medianHalfSpreadBps: 3 })));
}

test('the synthetic universe and periods are valid HXR files', () => {
  assert.deepEqual(validateHxrUniverse(UNIVERSE), []);
  assert.deepEqual(validateHxrPeriods(PERIODS, UNIVERSE), []);
});

test('sampled spread days: the first NYSE session of Jan, Mar, May, Jul, Sep and Nov from the listing', () => {
  assert.deepEqual(sampledSpreadDays('2024-10-10', '2025-05-01'), ['2024-11-01', '2025-01-02', '2025-03-03', '2025-05-01']);
  assert.deepEqual(sampledSpreadDays('2016-01-04', '2016-12-31'), ['2016-01-04', '2016-03-01', '2016-05-02', '2016-07-01', '2016-09-01', '2016-11-01']);
  assert.deepEqual(sampledSpreadDays('2024-11-02', '2025-01-01'), [], 'listed after the November sample day; January\'s has not happened');
});

test('a spread sample drops bad quotes and takes the median half-spread in bps of mid', () => {
  const s = spreadSampleFromQuotes([
    { bp: 99.99, ap: 100.01 }, // 2 bps spread
    { bp: 99.98, ap: 100.02 }, // 4 bps
    { bp: 99.97, ap: 100.03 }, // 6 bps
    { bp: 0, ap: 100 }, // bid <= 0
    { bp: 100, ap: 100 }, // ask <= bid
    { bp: 101, ap: 100 }, // crossed
    { bp: 90, ap: 110 }, // spread 20% of mid
    { bp: null, ap: 100 },
  ]);
  assert.deepEqual(s, { quotes: 3, dropped: 5, medianSpreadBps: 4, medianHalfSpreadBps: 2 });
  assert.deepEqual(spreadSampleFromQuotes([{ bp: 0, ap: 1 }]), { quotes: 0, dropped: 1, medianSpreadBps: null, medianHalfSpreadBps: null });
  // Exactly 5% of mid is kept.
  assert.equal(spreadSampleFromQuotes([{ bp: 97.5, ap: 102.5 }]).quotes, 1);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('spread table: yearly medians, carried forward to years without a sample, floor before the first sample', () => {
  const db = openDb();
  const u = {
    symbols: [
      { symbol: 'X', exchange: 'NASDAQ', listedFrom: '2020-01-02', baskets: [] },
      { symbol: 'Y', exchange: 'NASDAQ', listedFrom: '2022-06-01', baskets: [] },
      { symbol: 'Z', exchange: 'NASDAQ', listedFrom: '2023-01-03', baskets: [] },
    ],
    baskets: {},
  };
  const sample = (symbol, date, half) => ({ symbol, date, quotes: 10, dropped: 0, medianSpreadBps: half * 2, medianHalfSpreadBps: half });
  store.upsertSpreadSamples(db, [
    sample('X', '2020-01-02', 4), sample('X', '2020-03-02', 6), sample('X', '2020-05-01', 9),
    sample('X', '2022-01-03', 1), sample('X', '2023-03-01', 10),
    sample('Y', '2022-03-01', 50), sample('Y', '2022-07-01', 8),
    { symbol: 'X', date: '2021-01-04', quotes: 0, dropped: 4, medianSpreadBps: null, medianHalfSpreadBps: null },
  ]);
  const t = buildSpreadTable(db, u, { floorBps: 2, toYear: 2024 });
  assert.deepEqual(t.table, {
    X: { 2020: 6, 2021: 6, 2022: 2, 2023: 10, 2024: 10 },
    Y: { 2022: 8, 2023: 8, 2024: 8 },
    Z: { 2023: 2, 2024: 2 },
  });
  assert.deepEqual(t.firstSampled, { X: '2020-01-02', Y: '2022-07-01', Z: null }, 'Y\'s sample before its listing is ignored');
  assert.match(t.hash, /^[0-9a-f]{64}$/);
  assert.equal(buildSpreadTable(db, u, { floorBps: 2, toYear: 2024 }).hash, t.hash);
  assert.notEqual(buildSpreadTable(db, u, { floorBps: 3, toYear: 2024 }).hash, t.hash);
  assert.throws(() => buildSpreadTable(db, u, {}), /floorBps/);

  const f = halfSpreadFn(t);
  // A fill uses only the year's samples dated on or before it (no look-ahead).
  assert.equal(f('X', '2020-01-02'), 4, 'the January sample only');
  assert.equal(f('X', '2020-04-30'), 5, 'January and March');
  assert.equal(f('X', '2020-05-01'), 6, 'every 2020 sample');
  assert.equal(f('X', '2021-06-30'), 6, 'no usable sample in 2021: 2020 carried');
  assert.equal(f('X', '2022-12-30'), 2, 'below the floor');
  assert.equal(f('X', '2023-02-28'), 2, 'before 2023\'s first sample: 2022\'s value carried');
  assert.equal(f('X', '2023-03-01'), 10);
  assert.equal(f('X', '2026-10-21'), 10, 'after the table: the last year carried');
  assert.equal(f('Y', '2022-06-15'), 2, 'before the first sampled day: the floor');
  assert.equal(f('Y', '2022-07-01'), 8);
  assert.equal(f('Z', '2024-05-01'), 2, 'never sampled: the floor');
  assert.throws(() => f('Q', '2024-05-01'), /No half-spread calibration for Q/);
  // A bare table (no first-sampled dates) uses the years only.
  assert.equal(halfSpreadFn(t.table, 2)('Y', '2022-06-15'), 8);
  assert.equal(halfSpreadFn(t.table, 2)('Y', '2021-06-15'), 2);

  // A sample dated after a fill never changes that fill's half-spread (ENGINE-SPEC.md section 6).
  store.upsertSpreadSamples(db, [sample('X', '2020-11-02', 400)]);
  const later = halfSpreadFn(buildSpreadTable(db, u, { floorBps: 2, toYear: 2024 }));
  for (const d of ['2020-01-02', '2020-04-30', '2020-05-01', '2020-10-30']) assert.equal(later('X', d), f('X', d), d);
  assert.equal(later('X', '2020-11-02'), 7.5, 'from its own date on');
});

test('engine inputs: listing cut-off, dividends before the listing ignored, split ratios and dates, excluded sessions', () => {
  const db = openDb();
  seed(db);
  const inp = buildInputs(db, { universe: UNIVERSE, symbols: ['AAA', 'NB', 'CCC'], warmupFrom: '2024-01-02', end: '2024-06-28', excludedSessions: PERIODS.excludedSessions, start: '2024-05-01' });
  assert.deepEqual(inp.symbols.map((s) => s.symbol), ['AAA', 'NB', 'CCC']);
  // The universe's tech/AI tags reach the engine (EXPERIMENT-LOG entry 18); the data hash covers market data and
  // listings only, so an untagged copy of the universe gives the same hash.
  assert.deepEqual(inp.symbols.map((s) => [s.symbol, s.techAi]), [['AAA', true], ['NB', false], ['CCC', false]]);
  const untagged = { ...UNIVERSE, symbols: UNIVERSE.symbols.map(({ techAi, ...s }) => s) };
  assert.equal(buildInputs(db, { universe: untagged, symbols: ['AAA', 'NB', 'CCC'], warmupFrom: '2024-01-02', end: '2024-06-28', excludedSessions: PERIODS.excludedSessions, start: '2024-05-01' }).dataHash, inp.dataHash);
  assert.equal(inp.sessions.length, ALL.length - 1);
  assert.ok(!inp.sessions.includes('2024-02-07') && !inp.days.has('2024-02-07'), 'the excluded session is skipped');
  assert.equal(inp.coverage.AAA.excludedSessions, 1);
  assert.deepEqual(Object.keys(inp.days.get('2024-02-29').bars), ['AAA', 'CCC'], 'no NB bar before its listing');
  assert.deepEqual(Object.keys(inp.days.get('2024-03-01').bars), ['AAA', 'NB', 'CCC']);
  assert.equal(inp.coverage.NB.beforeListing, ALL.filter((d) => d < '2024-03-01').length);
  assert.equal(inp.coverage.NB.missing, 0);
  const aaa = inp.days.get('2024-05-01').bars.AAA;
  assert.deepEqual(Object.keys(aaa), ['o', 'h', 'l', 'c', 'v', 'vw15']);
  assert.equal(aaa.vw15, 55.5);
  assert.equal(inp.days.get('2024-05-02').bars.AAA.vw15, null);
  assert.equal(inp.coverage.AAA.vw15, 1);

  assert.deepEqual(inp.days.get('2024-03-15').splits, [{ symbol: 'AAA', ratio: 2, id: 'aaa-s1' }]);
  assert.deepEqual(inp.days.get('2024-04-15').splits, [{ symbol: 'CCC', ratio: 0.1, id: 'ccc-rs' }], 'a 1-for-10 reverse split is 0.1 new shares per old');
  const divs = [...inp.days.values()].flatMap((d) => d.dividends);
  assert.deepEqual(divs, [
    { symbol: 'AAA', exDate: '2024-05-10', payDate: '2024-05-31', amount: 0.25, id: 'aaa-d1' },
    { symbol: 'NB', exDate: '2024-06-03', payDate: '2024-06-20', amount: 0.1, id: 'nb-d1' },
    { symbol: 'AAA', exDate: '2024-06-14', payDate: '2024-06-14', amount: 0.3, id: 'aaa-d2' },
  ], 'the previous company\'s dividend is ignored; no pay date means the ex-date');
  assert.deepEqual(inp.days.get('2024-06-03').dividends.map((d) => d.id), ['nb-d1']);
  assert.equal(inp.halfSpreadBps, null);
  assert.deepEqual(inp.warnings, []);

  // A period that starts before a member's listing is a definition error.
  assert.throws(() => buildInputs(db, { universe: UNIVERSE, symbols: ['AAA', 'NB'], warmupFrom: '2024-01-02', end: '2024-06-28', start: '2024-02-01' }), /NB is listed from 2024-03-01, after the period start 2024-02-01/);
  assert.throws(() => buildInputs(db, { universe: UNIVERSE, symbols: ['AAA', 'QQQ'], warmupFrom: '2024-01-02', end: '2024-06-28' }), /QQQ is not in the HXR universe/);
  // A symbol whose identity is pending is never priced until the owner confirms it.
  assert.throws(() => buildInputs(db, { universe: UNIVERSE, symbols: ['AAA', 'SPX2'], warmupFrom: '2024-06-03', end: '2024-06-28' }), /SPX2's identity is pending the owner's confirmation/);
  const spx = buildInputs(db, { universe: UNIVERSE, symbols: ['AAA', 'SPX2'], warmupFrom: '2024-06-03', end: '2024-06-28', confirmed: ['SPX2'] });
  assert.deepEqual(spx.days.get('2024-06-03').dividends.filter((d) => d.symbol === 'SPX2'), [], 'the previous security\'s dividend is ignored');
});

test('engine inputs: the half-spread follows the config (fixed or calibrated, floor, variant multiplier)', async () => {
  const { loadHxrConfig, variantConfig } = await import('../server/hxr/config.js');
  const db = openDb();
  seed(db);
  const base = loadHxrConfig('hxr-c1-0.1.0.json');
  const spreadTable = buildSpreadTable(db, UNIVERSE, { floorBps: 2 });
  const args = { universe: UNIVERSE, symbols: ['AAA', 'NB'], warmupFrom: '2024-01-02', end: '2024-06-28', spreadTable };
  assert.equal(buildInputs(db, { ...args, config: base }).halfSpreadBps('AAA', '2024-05-01'), 3);
  assert.equal(buildInputs(db, { ...args, config: base }).halfSpreadBps('NB', '2024-05-01'), 2, 'never sampled: the floor');
  const costs2x = variantConfig(base, { spreadSlippageMultiplier: 2 });
  assert.equal(buildInputs(db, { ...args, config: costs2x }).halfSpreadBps('AAA', '2024-05-01'), 6);
  assert.throws(() => buildInputs(db, { ...args, spreadTable: null, config: base }), /calibration table is needed/);
});

test('engine inputs: an action on an excluded session applies at the next one; conflicting splits throw', () => {
  const db = openDb();
  store.upsertBars(db, 'AAA', makeBars(ALL, { start: 100 }));
  store.upsertCorporateActions(db, [
    { id: 's-ex', type: 'forward_split', symbol: 'AAA', ex_date: '2024-02-07', ratio_old: 1, ratio_new: 3 },
    { id: 'd-ex', type: 'cash_dividend', symbol: 'AAA', ex_date: '2024-02-07', pay_date: '2024-02-20', rate: 1 },
    { id: 's-dup', type: 'forward_split', symbol: 'AAA', ex_date: '2024-02-07', ratio_old: 2, ratio_new: 6 },
  ]);
  const inp = buildInputs(db, { universe: UNIVERSE, symbols: ['AAA'], warmupFrom: '2024-01-02', end: '2024-06-28', excludedSessions: ['2024-02-07'] });
  assert.deepEqual(inp.days.get('2024-02-08').splits, [{ symbol: 'AAA', ratio: 3, id: 's-dup', declaredExDate: '2024-02-07' }]);
  assert.deepEqual(inp.days.get('2024-02-08').dividends, [{ symbol: 'AAA', exDate: '2024-02-08', payDate: '2024-02-20', amount: 1, id: 'd-ex', declaredExDate: '2024-02-07' }]);
  assert.equal(inp.warnings.length, 1, 'the duplicate split record is reported once');
  store.upsertCorporateActions(db, [{ id: 's-dup', type: 'forward_split', symbol: 'AAA', ex_date: '2024-02-07', ratio_old: 1, ratio_new: 4 }]);
  assert.throws(() => buildInputs(db, { universe: UNIVERSE, symbols: ['AAA'], warmupFrom: '2024-01-02', end: '2024-06-28' }), /two different splits on 2024-02-07/);
});

test('the data hash covers every input value and is deterministic', () => {
  const db = openDb();
  seed(db);
  const args = { universe: UNIVERSE, symbols: ['AAA', 'BBB'], warmupFrom: '2024-01-02', end: '2024-06-28', excludedSessions: PERIODS.excludedSessions };
  const h = buildInputs(db, args).dataHash;
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(buildInputs(db, args).dataHash, h);
  assert.notEqual(buildInputs(db, { ...args, excludedSessions: [] }).dataHash, h);
  assert.notEqual(buildInputs(db, { ...args, symbols: ['BBB', 'AAA'] }).dataHash, h, 'the sleeve order is an input');
  assert.notEqual(buildInputs(db, { ...args, end: '2024-06-27' }).dataHash, h);
  const spread = buildSpreadTable(db, UNIVERSE, { floorBps: 2 });
  const withSpread = buildInputs(db, { ...args, spreadTable: spread });
  assert.notEqual(withSpread.dataHash, h);
  assert.equal(withSpread.calibrationHash, spread.hash);
  assert.equal(withSpread.halfSpreadBps('AAA', '2024-03-04'), 3);
  // One changed value anywhere changes the hash: a close, a vw15, a dividend.
  const bar = store.getBars(db, 'BBB', { from: '2024-04-02', to: '2024-04-02' })[0];
  store.upsertBars(db, 'BBB', [{ ...bar, c: bar.c + 0.0001 }]);
  const h2 = buildInputs(db, args).dataHash;
  assert.notEqual(h2, h);
  store.upsertFirst15(db, 'AAA', [{ date: '2024-05-02', o: 1, h: 1, l: 1, c: 1, v: 1, vw: 56 }]);
  const h3 = buildInputs(db, args).dataHash;
  assert.notEqual(h3, h2);
  store.upsertCorporateActions(db, [{ id: 'aaa-d1', type: 'cash_dividend', symbol: 'AAA', ex_date: '2024-05-10', pay_date: '2024-05-31', rate: 0.26 }]);
  assert.notEqual(buildInputs(db, args).dataHash, h3);
});

test('readiness: a planted unexplained split and a planted missing session make their periods unusable', () => {
  const db = openDb();
  seed(db);
  const r = readiness(db, { universe: UNIVERSE, periods: PERIODS, today: '2024-07-01' });
  assert.equal(r.lastCompleteSession, '2024-06-28');
  assert.deepEqual(r.excludedSessions, [{ date: '2024-02-07', reason: 'synthetic data gap' }]);
  const sym = Object.fromEntries(r.symbols.map((s) => [s.symbol, s]));

  // AAA: complete; its raw split overnight ratio is about 1/2.
  assert.equal(sym.AAA.status, 'complete');
  assert.equal(sym.AAA.sessions.expected, ALL.length - 1);
  assert.equal(sym.AAA.sessions.missing, 0);
  assert.equal(sym.AAA.splits.length, 1);
  assert.deepEqual([sym.AAA.splits[0].session, sym.AAA.splits[0].ratio, sym.AAA.splits[0].expectedOvernight, sym.AAA.splits[0].status], ['2024-03-15', 2, 0.5, 'pass']);
  assert.ok(Math.abs(sym.AAA.splits[0].overnight.ratio - 0.5) < 0.01);
  assert.deepEqual(sym.AAA.splitScan.candidates, [], 'the known split is not a candidate');
  assert.deepEqual(sym.AAA.dividends, { count: 2, ignoredBeforeListing: 0, withoutPayDate: 1 });
  assert.ok(sym.AAA.notes.includes('1 cash dividend(s) have no pay date and are credited on their ex-date.'));
  assert.deepEqual([sym.AAA.first15.present, sym.AAA.spreads.expectedDays, sym.AAA.spreads.sampled, sym.AAA.spreads.missing], [1, 3, 3, 0]);

  // BBB: the planted gap and the planted 3-for-1-like fall.
  assert.equal(sym.BBB.status, 'issues');
  assert.deepEqual(sym.BBB.sessions.missingSample, ['2024-05-15']);
  assert.deepEqual(sym.BBB.splitScan.candidates.map((c) => [c.date, c.looksLike]), [['2024-02-20', 'a 3-for-1 split']]);
  assert.deepEqual(sym.BBB.spreads.missingSample, ['2024-01-02', '2024-03-01', '2024-05-01']);

  // NB: the previous company's zero-volume bars, dividend and name change are outside its listing.
  assert.equal(sym.NB.status, 'complete');
  assert.equal(sym.NB.bars.beforeListing, ALL.filter((d) => d < '2024-03-01').length);
  assert.equal(sym.NB.bars.firstFromListing, '2024-03-01');
  assert.equal(sym.NB.zeroVolume.count, 0);
  assert.deepEqual(sym.NB.splitScan.candidates, [], 'the jump at the listing is not compared with the previous company');
  assert.deepEqual(sym.NB.dividends, { count: 1, ignoredBeforeListing: 1, withoutPayDate: 0 });
  assert.deepEqual(sym.NB.nameChanges.map((n) => [n.from, n.to, n.beforeListing]), [['YNDX', 'NB', true]]);
  assert.ok(sym.NB.notes.some((n) => /before the listing date 2024-03-01 are ignored/.test(n)));
  assert.ok(sym.NB.notes.some((n) => /Yandex-like/.test(n)));

  // CCC: a recorded reverse split the bars do not show, a zero-volume bar and an inconsistent bar.
  assert.equal(sym.CCC.status, 'issues');
  assert.deepEqual([sym.CCC.splits[0].ratio, sym.CCC.splits[0].expectedOvernight, sym.CCC.splits[0].status], [0.1, 10, 'fail']);
  assert.deepEqual(sym.CCC.zeroVolume.sample, ['2024-05-06']);
  assert.deepEqual(sym.CCC.invalidOhlc.sample, ['2024-05-07']);

  // SPX2: identity pending, prospective only, no bars; the old security's dividend is ignored.
  assert.equal(sym.SPX2.status, 'no data');
  assert.ok(sym.SPX2.notes.some((n) => /Identity pending the owner's confirmation/.test(n)));
  assert.ok(sym.SPX2.notes.some((n) => /Prospective account only/.test(n)));
  assert.deepEqual(sym.SPX2.dividends, { count: 0, ignoredBeforeListing: 1, withoutPayDate: 0 });

  // Periods: development is blocked by BBB's unexplained move, validation by BBB's missing session.
  const { development: selection, validation: evaluation, fullList } = r.periods;
  assert.equal(selection.usable, false);
  assert.deepEqual(selection.members.map((m) => [m.symbol, m.ok]), [['AAA', true], ['BBB', false]]);
  assert.equal(selection.members[0].historyBeforeStart, 21);
  assert.equal(selection.members[0].requiredFrom, '2024-01-03');
  assert.equal(selection.reasons.length, 1);
  assert.match(selection.reasons[0], /^BBB: unexplained overnight move on 2024-02-20 .* looks like a 3-for-1 split/);
  assert.equal(evaluation.usable, false);
  assert.deepEqual(evaluation.reasons, [`BBB: 1 of ${evaluation.members[1].sessionsChecked} session(s) missing from ${evaluation.members[1].requiredFrom} to 2024-06-28 (first 2024-05-15)`]);
  assert.ok(evaluation.members[1].requiredFrom > '2024-02-20', 'the earlier move is outside the evaluation\'s warm-up needs');
  assert.equal(fullList.usable, true, 'NB has 42 sessions of its own history before 2024-05-01');
  assert.equal(fullList.members[1].historyBeforeStart, 42);
  assert.equal(fullList.costsCalibrated, false, 'NB has no spread samples');

  // The owner records the move as reviewed: development becomes usable.
  const reviewed = readiness(db, { universe: UNIVERSE, periods: PERIODS, today: '2024-07-01', reviewed: [{ symbol: 'BBB', date: '2024-02-20', reason: 'a real fall, not a split' }] });
  assert.equal(reviewed.periods.development.usable, true);
  assert.equal(reviewed.periods.validation.usable, false);

  // Warm-up needs count only sessions from the listing.
  const longer = readiness(db, { universe: UNIVERSE, periods: { ...PERIODS, warmupSessions: 60 }, today: '2024-07-01' });
  assert.equal(longer.periods.fullList.usable, false);
  assert.ok(longer.periods.fullList.reasons.includes('NB: only 42 session(s) of its own history before 2024-05-01; 60 needed'));

  // Before the period has ended, it cannot be complete.
  const early = readiness(db, { universe: UNIVERSE, periods: PERIODS, today: '2024-06-20' });
  assert.equal(early.periods.fullList.usable, false);
  assert.ok(early.periods.fullList.reasons.some((x) => /ends 2024-06-28, after the last completed session 2024-06-18/.test(x)));
});

test('readiness: a corporate action the engine does not model blocks the periods it falls in', () => {
  const db = openDb();
  seed(db);
  store.upsertCorporateActions(db, [{ id: 'nb-spin', type: 'spin_off', symbol: 'NB', ex_date: '2024-06-10', old_symbol: 'NB', new_symbol: 'NBX', ratio_old: 1, ratio_new: 0.2 }]);
  const r = readiness(db, { universe: UNIVERSE, periods: PERIODS, today: '2024-07-01' });
  assert.equal(r.periods.fullList.usable, false);
  assert.ok(r.periods.fullList.reasons.includes('NB: spin off on 2024-06-10 is not modelled by the engine'));
  assert.deepEqual(r.symbols.find((s) => s.symbol === 'NB').unhandledActions.map((a) => a.type), ['spin_off']);
});

test('readiness: actions under more than one CUSIP since the listing are flagged for review', () => {
  const db = openDb();
  seed(db);
  store.upsertCorporateActions(db, [
    { id: 'aaa-c1', type: 'cash_dividend', symbol: 'AAA', cusip: '000000AA1', ex_date: '2024-04-10', pay_date: '2024-04-20', rate: 0.1 },
    { id: 'aaa-c2', type: 'cash_dividend', symbol: 'AAA', cusip: '999999ZZ9', ex_date: '2024-04-11', pay_date: '2024-04-20', rate: 0.1 },
  ]);
  const aaa = readiness(db, { universe: UNIVERSE, periods: PERIODS, today: '2024-07-01' }).symbols.find((s) => s.symbol === 'AAA');
  assert.deepEqual(aaa.cusips, ['000000AA1', '999999ZZ9']);
  assert.ok(aaa.notes.some((n) => /carry 2 CUSIPs \(000000AA1, 999999ZZ9\): check that they are one security/.test(n)));
});
