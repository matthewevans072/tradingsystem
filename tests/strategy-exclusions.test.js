// splits-v2: sessions excluded for every symbol (strategy/PARAMETER-LOG.md,
// owner decision 2026-10-22, option C). The periods are splits-v1's; the four
// excluded NYSE sessions are removed from every run's bars, not expected by the
// readiness checklist, and named in every report. The reviewed VRT move is
// recorded in corporate-actions-v1.json. Synthetic prices only exercise code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSplits, excludedSessionDates, loadStrategyConfig, applyOverrides, STRATEGY_DIR, DEFAULT_SPLITS_PATH } from '../server/strategy/config.js';
import { runBacktest } from '../server/strategy/engine.js';
import { dropExcludedSessions, qualityReport, datasetHash } from '../server/strategy/data.js';
import { checkSymbolBars, loadCorporateActions, periodTable, READY, NOT_READY } from '../server/strategy/readiness.js';
import { buildReport } from '../server/strategy/report.js';
import { withoutExcludedSessions } from '../scripts/strategy-backtest.js';
import { tradingDays, sessionBarStarts } from '../server/strategy/sessions.js';
import { tempDir } from './helpers.js';

const EXCLUDED = ['2021-10-25', '2022-01-24', '2022-01-26', '2022-03-08'];
const read = (f) => JSON.parse(fs.readFileSync(path.join(STRATEGY_DIR, f), 'utf8'));

function sessionBars(from, to, { start = 100, skip = new Set(), partial = new Map(), jump = new Map() } = {}) {
  let p = start, i = 0;
  const out = [];
  for (const d of tradingDays(from, to)) {
    if (skip.has(d)) continue;
    if (jump.has(d)) p *= jump.get(d);
    const starts = sessionBarStarts(d).slice(0, partial.get(d) ?? Infinity);
    for (const t of starts) {
      p *= 1 + ((i++ % 7) - 3) * 0.0003;
      out.push({ t: new Date(t).toISOString(), o: p, h: p * 1.002, l: p * 0.998, c: p * 1.001, v: 1000 });
    }
  }
  return out;
}
const small = (spec) => Object.fromEntries(Object.entries(spec).map(([k, [from, to]]) => [k, { from, to }]));
const keys = (n) => [{ source: 'alpaca', adjustment: 'split', feed: 'sip', bars: n }];

test('splits-v2 is the default: splits-v1 periods unchanged, four excluded sessions with reasons; splits-v1 left as it was', () => {
  const v1 = read('splits-v1.json'), v2 = loadSplits();
  assert.equal(path.basename(DEFAULT_SPLITS_PATH), 'splits-v2.json');
  assert.equal(v2.name, 'splits-v2');
  assert.equal(v2.supersedes, 'splits-v1');
  for (const k of ['timezone', 'warmup', 'development', 'validation', 'holdout', 'forward', 'walkForward']) assert.deepEqual(v2[k], v1[k], k);
  assert.deepEqual(excludedSessionDates(v2), EXCLUDED);
  assert.ok(v2.excludedSessions.sessions.every((x) => x.reason && x.period));
  assert.equal(v1.excludedSessions, undefined);
  assert.deepEqual(excludedSessionDates(loadSplits(path.join(STRATEGY_DIR, 'splits-v1.json'))), []);
});

test('loadSplits refuses malformed, duplicate or out-of-window excluded sessions', () => {
  const dir = tempDir();
  const base = read('splits-v2.json');
  let n = 0;
  const write = (ex) => { const f = path.join(dir, `s${n++}.json`); fs.writeFileSync(f, JSON.stringify({ ...base, excludedSessions: ex })); return f; };
  assert.throws(() => loadSplits(write({ sessions: 'x' })), /sessions list/);
  assert.throws(() => loadSplits(write({ sessions: [{ date: '2022-3-8', reason: 'r' }] })), /YYYY-MM-DD/);
  assert.throws(() => loadSplits(write({ sessions: [{ date: '2022-03-08' }] })), /needs a reason/);
  assert.throws(() => loadSplits(write({ sessions: [{ date: '2020-03-09', reason: 'r' }] })), /outside/);
  assert.throws(() => loadSplits(write({ sessions: [{ date: '2022-03-08', reason: 'r' }, { date: '2022-03-08', reason: 'r' }] })), /twice/);
});

test('dropExcludedSessions removes those sessions for every symbol, keeps flags, changes the hash, and leaves the input alone', () => {
  const a = sessionBars('2022-03-07', '2022-03-09'), b = sessionBars('2022-03-07', '2022-03-09', { start: 50 });
  const input = new Map([['SPY', a], ['CAT', b]]);
  a.synthetic = true; input.synthetic = true;
  const r = dropExcludedSessions(input, EXCLUDED, { exchangeOf: (s) => (s === 'SPY' ? 'NYSE ARCA' : 'NYSE') });
  assert.deepEqual(r.removed, { SPY: 26, CAT: 26 });
  assert.equal(r.bars.get('SPY').length, 52);
  assert.ok(r.bars.get('SPY').every((x) => !x.t.startsWith('2022-03-08')));
  assert.equal(r.bars.synthetic, true);
  assert.equal(r.bars.get('SPY').synthetic, true);
  assert.equal(a.length, 78, 'input untouched');
  assert.notEqual(datasetHash(r.bars), datasetHash(input));
  // Nothing excluded: same bars, same hash.
  assert.equal(datasetHash(dropExcludedSessions(input, []).bars), datasetHash(input));
  // A symbol with bars only on an excluded day drops out, like an empty symbol.
  assert.equal(dropExcludedSessions(new Map([['JNJ', sessionBars('2022-03-08', '2022-03-08')]]), EXCLUDED).bars.has('JNJ'), false);
});

test('quality report: an excluded session is not counted as missing', () => {
  const bars = sessionBars('2022-03-07', '2022-03-09', { skip: new Set(['2022-03-08']) });
  assert.equal(qualityReport(bars).missingSessions, 1);
  const q = qualityReport(bars, { excludedDates: EXCLUDED });
  assert.equal(q.missingSessions, 0);
  assert.equal(q.ok, true);
  assert.deepEqual(q.excludedSessions, ['2022-03-08']);
});

test('readiness: excluded sessions are not expected; their bars are set aside; overnight checks skip them as the engine does', () => {
  const periods = small({ warmup: ['2022-02-28', '2022-03-04'], development: ['2022-03-07', '2022-03-11'], validation: ['2022-03-14', '2022-03-18'], holdout: ['2022-03-21', '2022-03-25'] });
  // The NYSE gap as stored: one auction print on 2022-03-08.
  const bars = sessionBars('2022-02-28', '2022-03-25', { partial: new Map([['2022-03-08', 1]]) });
  const opts = { symbol: 'XOM', exchange: 'NYSE', periods, keys: keys(bars.length) };
  const before = checkSymbolBars(bars, opts);
  assert.equal(before.status, NOT_READY);
  assert.equal(before.checks.coverage.development.partialSessions, 1);

  const r = checkSymbolBars(bars, { ...opts, excluded: EXCLUDED });
  assert.equal(r.status, READY, r.blocking.join('; '));
  assert.deepEqual(r.checks.coverage.development.excludedSessions, [{ date: '2022-03-08', barsSetAside: 1 }]);
  assert.equal(r.checks.coverage.development.expectedSessions, 4);
  assert.equal(r.checks.coverage.development.expectedBars, 4 * 26);
  assert.deepEqual(r.bars.excludedSessions, { '2022-03-08': 1 });
  assert.equal(r.checks.ohlcv.bars, bars.length - 1);

  // A split-like jump across the excluded session is still found (03-09 open vs 03-07 close).
  const jumped = sessionBars('2022-02-28', '2022-03-25', { skip: new Set(['2022-03-08']), jump: new Map([['2022-03-09', 0.5]]) });
  const j = checkSymbolBars(jumped, { ...opts, keys: keys(jumped.length), excluded: EXCLUDED });
  assert.equal(j.status, NOT_READY);
  assert.deepEqual(j.checks.adjustment.unknownSplitScan.candidates.map((c) => [c.date, c.prevSession]), [['2022-03-09', '2022-03-07']]);
});

test('period table under splits-v2: 1 warm-up and 3 development sessions excluded; validation and holdout unchanged', () => {
  const s = loadSplits();
  const t = Object.fromEntries(periodTable(Object.fromEntries(['warmup', 'development', 'validation', 'holdout'].map((k) => [k, s[k]])), 'NYSE', excludedSessionDates(s)).map((p) => [p.key, p]));
  assert.deepEqual([t.warmup.sessions, t.warmup.expectedBars, t.warmup.excludedSessions], [127, 3290, ['2021-10-25']]);
  assert.deepEqual([t.development.sessions, t.development.expectedBars, t.development.excludedSessions], [498, 12912, ['2022-01-24', '2022-01-26', '2022-03-08']]);
  assert.deepEqual([t.validation.sessions, t.validation.expectedBars, t.validation.excludedSessions], [252, 6516, []]);
  assert.deepEqual([t.holdout.sessions, t.holdout.expectedBars, t.holdout.excludedSessions], [373, 9662, []]);
});

test('VRT 2022-02-23 is recorded as a reviewed overnight move (not a split) and the scan lists it as reviewed, not blocking', () => {
  const ca = loadCorporateActions();
  const rv = ca.reviewedOvernightMoves.symbols.VRT;
  assert.equal(rv.length, 1);
  assert.equal(rv[0].date, '2022-02-23');
  assert.ok(rv[0].reason && rv[0].reviewedBy && rv[0].reviewedAt);
  assert.deepEqual(Object.keys(ca.reviewedOvernightMoves.symbols), ['VRT']);
  const periods = small({ warmup: ['2022-02-14', '2022-02-18'], development: ['2022-02-22', '2022-02-25'], validation: ['2022-02-28', '2022-03-04'], holdout: ['2022-03-14', '2022-03-18'] });
  const bars = sessionBars('2022-02-14', '2022-03-18', { skip: new Set(['2022-03-08']), jump: new Map([['2022-02-23', 0.6193]]) });
  const opts = { symbol: 'VRT', exchange: 'NYSE', periods, keys: keys(bars.length), excluded: EXCLUDED };
  assert.equal(checkSymbolBars(bars, opts).status, NOT_READY);
  const r = checkSymbolBars(bars, { ...opts, reviewed: rv });
  assert.equal(r.status, READY, r.blocking.join('; '));
  assert.equal(r.checks.adjustment.unknownSplitScan.candidates[0].reviewed.date, '2022-02-23');
});

test('reports and the command-line runner name the excluded sessions and drop their bars', async () => {
  const splits = loadSplits();
  const md = buildReport({ runs: { meta: { dataHash: 'h', configHash: 'c', version: '1.0.0' }, modes: {} }, acceptance: { name: 'acceptance-v1', backtest: [] }, universe: { name: 'universe-v1', symbols: [] }, splits, config: null }).markdown;
  assert.match(md, /Excluded sessions \(every symbol\) \| 2021-10-25, 2022-01-24, 2022-01-26, 2022-03-08 \(splits-v2/);
  const loaded = { bars: new Map([['PG', sessionBars('2022-01-21', '2022-01-27')]]), quality: { PG: { file: 'PG.csv' } }, dataHash: 'x', synthetic: false, skipped: [], source: 'test' };
  const d = await withoutExcludedSessions(loaded, splits, new Map([['PG', 'NYSE']]));
  assert.deepEqual(d.excluded, { splits: 'splits-v2', sessions: EXCLUDED, barsRemoved: { PG: 52 } });
  assert.equal(d.bars.get('PG').length, 3 * 26);
  assert.equal(d.quality.PG.file, 'PG.csv');
  assert.equal(d.quality.PG.missingSessions, 0);
  assert.equal(d.dataHash, datasetHash(d.bars));
});

// ---------- the engine on a series with an excluded session ----------
// The same hand-checked box as tests/strategy-engine.test.js: a box over bars
// 0-5 (ceiling 101.0, floor 99.0), the breakout candle (bar 6), stop 100.23.
const SMALL = { 'box.lookbackBars': 6, 'box.atrLength': 3, 'box.minBarsBetweenTouches': 1, 'box.setupExpiryBars': 3, 'entry.volumeLookbackBars': 4 };
const cfgWith = (set = {}) => applyOverrides(loadStrategyConfig(), { set: { ...SMALL, ...set } });
const BOX = [
  [100.0, 101.0, 99.4, 100.6, 1000], [100.6, 100.7, 99.0, 99.4, 1000], [99.4, 100.9, 99.3, 100.7, 1000],
  [100.7, 100.8, 99.1, 99.3, 1000], [99.3, 100.5, 99.2, 100.2, 1000], [100.2, 100.6, 99.6, 100.4, 1000],
];
const BREAKOUT = [100.4, 101.2, 100.35, 101.1, 2000];
const ENTRY = [101.1, 101.3, 100.9, 101.2, 1000];
const FLAT = [101.2, 101.3, 101.0, 101.2, 1000];
const day = (date, rows, start = 0) => rows.map((r, i) => ({ t: new Date(sessionBarStarts(date)[start + i]).toISOString(), o: r[0], h: r[1], l: r[2], c: r[3], v: r[4] }));
const fill = (rows, n, row = FLAT) => [...rows, ...Array(Math.max(0, n - rows.length)).fill(row)];
// 2022-03-07 (Mon), excluded 2022-03-08 (bars stored, as for SPY), 2022-03-09 (Wed); EST, so 16:00 ET = 21:00Z.
function swingRun(day1, day3, set = {}) {
  const stored = [...day1, ...day('2022-03-08', fill([], 26)), ...day3];
  const bars = dropExcludedSessions(new Map([['TEST', stored]]), EXCLUDED).bars;
  assert.equal(bars.get('TEST').length, stored.length - 26);
  return runBacktest({ config: cfgWith(set), mode: 'swing', bars, symbols: [{ symbol: 'TEST', exchange: 'NYSE' }] });
}

test('engine: an entry due in an excluded session lapses as "no next bar" and is never filled on the next session', () => {
  // The breakout candle is the 15:45 bar of 2022-03-07, so the entry is due at the 2022-03-08 open.
  const r = swingRun(day('2022-03-07', [...BOX, BREAKOUT], 19), day('2022-03-09', fill([], 26)));
  const placed = r.events.filter((e) => e.type === 'order_placed');
  assert.equal(placed.length, 1);
  assert.equal(placed[0].details.validFor, '2022-03-08T14:30:00.000Z');
  const skip = r.events.find((e) => e.type === 'entry_skipped');
  assert.equal(skip.details.code, 'no_next_bar');
  assert.equal(skip.at, '2022-03-09T14:30:00.000Z');
  assert.equal(r.trades.length, 0);
});

test('engine: a swing time exit that falls on an excluded session closes at the last close before it, flagged', () => {
  const r = swingRun(day('2022-03-07', fill([...BOX, BREAKOUT, ENTRY], 26)), day('2022-03-09', fill([], 26)), { 'modes.swing.maxHoldSessions': 2 });
  const t = r.trades[0];
  assert.equal(t.entry.at, '2022-03-07T16:15:00.000Z');
  assert.equal(t.exit.reason, 'session_end_fallback');
  assert.equal(t.exit.raw, 101.2, "2022-03-07's last close");
  assert.equal(t.exit.at, '2022-03-08T21:00:00.000Z');
  assert.deepEqual(t.exit.flags, ['session_end_fallback']);
  // No future data: changing every bar after the excluded session (a crash, then a spike, with heavy
  // volume) leaves this exit, its price and its P/L exactly as they were.
  for (const k of [0.5, 1.6]) {
    const later = day('2022-03-09', fill([], 26)).map((b) => ({ ...b, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k, v: b.v * 7 }));
    const alt = swingRun(day('2022-03-07', fill([...BOX, BREAKOUT, ENTRY], 26)), later, { 'modes.swing.maxHoldSessions': 2 });
    assert.deepEqual(alt.trades[0].exit, t.exit, `prices x${k} after the excluded session`);
    assert.deepEqual(alt.trades[0].pnl, t.pnl);
  }
});

test('engine: an open swing position is carried over an excluded session; a gap through the stop fills at the next open', () => {
  const r = swingRun(day('2022-03-07', fill([...BOX, BREAKOUT, ENTRY], 26)), day('2022-03-09', fill([[99.0, 99.5, 98.8, 99.2, 1000]], 26)));
  const t = r.trades[0];
  assert.equal(t.plan.stop, 100.23);
  assert.equal(t.exit.reason, 'stop');
  assert.equal(t.exit.gapThrough, true);
  assert.equal(t.exit.raw, 99.0);
  assert.equal(t.exit.at, '2022-03-09T14:30:00.000Z');
});
