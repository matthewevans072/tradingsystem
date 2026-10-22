// Data-readiness checklist (strategy/DATA-READINESS.md): synthetic bar sets
// with planted defects must produce exactly the expected checklist; the
// Alpaca history source against a fake fetch (pagination, 429 back-off, auth
// errors, timestamps, regular-session filtering, keys never leaked); the
// source-mixing rule; the forward report kept apart from historical runs; and
// the /api/lab/readiness route through the real server. Synthetic prices only
// exercise code: nothing here is market data or strategy performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { loadConfig, redact, publicConfigStatus } from '../server/config.js';
import { createServer, lazyContexts } from '../server/index.js';
import { ProviderError } from '../server/providers/http.js';
import * as store from '../server/strategy/store.js';
import { createLab } from '../server/strategy/lab.js';
import { startForward } from '../server/strategy/forward.js';
import { loadStrategyConfig, loadUniverse, loadSplits } from '../server/strategy/config.js';
import { checkSymbolBars, loadCorporateActions, dstChanges, periodTable, READY, NOT_READY, NO_DATA } from '../server/strategy/readiness.js';
import { createAlpacaSource, ALPACA_BARS_URL } from '../server/strategy/sources/alpaca.js';
import { tradingDays, sessionBarStarts } from '../server/strategy/sessions.js';
import { zonedToUtc, NY } from '../server/time.js';

const CA = loadCorporateActions();
const UNIVERSE = loadUniverse();
const SPLITS = loadSplits();
const KEY_ID = 'PKTESTKEYID0123456789';
const SECRET_KEY = 'alpaca-secret-abcdefghijklmnopqrstuvwxyz';
const MIN = 60000;

const cfgFor = (dir, extra = {}) => loadConfig({ ENV_FILE: path.join(dir, 'none.env'), SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none', ...extra });
function labCtx(dir, extra = {}, market = null) {
  const ctx = { cfg: cfgFor(dir, extra), mode: 'real', providers: { market } };
  Object.defineProperty(ctx, 'db', { get() { throw new Error('the Strategy Lab touched the portfolio database'); } });
  return ctx;
}
const et = (date, hh, mm) => zonedToUtc(date, hh, mm, NY).toISOString();
const waitFor = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

// Seeded regular-session bars: a gentle random walk, consistent OHLC, positive volume.
function sessionBars(from, to, { seed = 7, start = 100, volume = () => 1000, scale = () => 1 } = {}) {
  let x = seed >>> 0, p = start;
  const rand = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const out = [];
  for (const d of tradingDays(from, to)) {
    for (const t of sessionBarStarts(d)) {
      p *= 1 + (rand() - 0.5) * 0.002;
      const k = scale(d);
      out.push({ t: new Date(t).toISOString(), o: p * k, h: p * 1.002 * k, l: p * 0.998 * k, c: p * 1.001 * k, v: volume(d) });
    }
  }
  return out;
}
const small = (spec) => Object.fromEntries(Object.entries(spec).map(([k, [from, to]]) => [k, { from, to }]));

// ---------- the checklist on synthetic bar sets ----------

test('clean bars: READY in every period, on the exchange calendar', () => {
  const periods = small({ warmup: ['2024-06-24', '2024-06-28'], development: ['2024-07-01', '2024-07-05'], validation: ['2024-07-08', '2024-07-12'], holdout: ['2024-07-15', '2024-07-19'] });
  const bars = sessionBars('2024-06-24', '2024-07-19');
  const r = checkSymbolBars(bars, { symbol: 'SPY', exchange: 'NYSE ARCA', periods, actions: CA.symbols.SPY, listing: CA.listings.symbols.SPY, keys: [{ source: 'alpaca', adjustment: 'split', feed: 'sip', bars: bars.length }] });
  assert.equal(r.status, READY);
  assert.deepEqual(r.blocking, []);
  for (const k of ['warmup', 'development', 'validation', 'holdout']) assert.equal(r.periods[k].status, READY, k);
  // 2024-07-03 is a 1 p.m. early close (14 bars) and 2024-07-04 a holiday.
  assert.deepEqual(r.checks.coverage.development, {
    from: '2024-07-01', to: '2024-07-05', expectedSessions: 4, sessionsWithBars: 4, earlyCloses: 1, missingSessions: 0, missingSessionRanges: [],
    partialSessions: 0, partialSample: [], expectedBars: 26 * 3 + 14, presentBars: 92, missingBars: 0, pctComplete: 100, status: 'pass',
  });
  assert.deepEqual(r.checks.timestamps.lastBarTimes.earlyCloses, { '12:45': 1 });
  assert.deepEqual(r.checks.timestamps.earlyCloses.problems, []);
  assert.equal(r.checks.instrument.status, 'verified by research');
  assert.equal(r.checks.adjustment.dividends.status, 'declared by source, not independently verified');
  assert.equal(r.checks.adjustment.unknownSplitScan.candidates.length, 0);
});

test('planted defects: missing session, off-grid and pre-market bars, zero volume, duplicates give the exact checklist', () => {
  const periods = small({ warmup: ['2024-03-04', '2024-03-05'], development: ['2024-03-06', '2024-03-07'], validation: ['2024-03-08', '2024-03-12'], holdout: ['2024-03-13', '2024-03-15'] });
  let bars = sessionBars('2024-03-04', '2024-03-15', { seed: 3 }).filter((b) => !b.t.startsWith('2024-03-07')); // a missing session
  const at = (date, hh, mm) => bars.find((b) => b.t === et(date, hh, mm));
  bars.push({ ...at('2024-03-08', 10, 0), t: et('2024-03-08', 10, 7) });       // off the 15-minute grid
  bars.push({ ...at('2024-03-11', 9, 30), t: et('2024-03-11', 8, 0) });        // pre-market
  at('2024-03-13', 10, 0).v = 0;                                                  // zero volume
  bars.push({ ...at('2024-03-14', 11, 0) });                                      // identical duplicate
  bars.push({ ...at('2024-03-15', 11, 0), c: at('2024-03-15', 11, 0).c * 1.0005 }); // conflicting duplicate
  bars = bars.reverse(); // order does not matter
  const r = checkSymbolBars(bars, { symbol: 'XOM', exchange: 'NYSE', periods, actions: CA.symbols.XOM, listing: CA.listings.symbols.XOM, keys: [{ source: 'alpaca', adjustment: 'split', feed: 'sip', bars: bars.length }] });
  const reasons = {
    zero: 'ohlcv: 1 bar with zero volume (first 2024-03-13)',
    dup: 'ohlcv: 1 bar with a conflicting duplicate (two different bars for the same time) (first 2024-03-15)',
    grid: 'timestamps: 1 bar with a time off the 15-minute grid from 09:30 ET (first 2024-03-08)',
    pre: 'timestamps: 1 bar with a time outside the regular session (pre-market, after-hours or a closed day) (first 2024-03-11)',
    gap: 'coverage: Development: 26 of 52 bars (50%); 1 of 2 sessions missing (first 2024-03-07)',
  };
  assert.equal(r.status, NOT_READY);
  assert.deepEqual(Object.fromEntries(Object.entries(r.periods).map(([k, v]) => [k, [v.status, v.reasons]])), {
    warmup: [READY, []],
    development: [NOT_READY, [reasons.gap]],
    validation: [NOT_READY, [reasons.grid, reasons.pre]],
    holdout: [NOT_READY, [reasons.dup, reasons.zero]],
  });
  assert.deepEqual(r.blocking, [reasons.dup, reasons.grid, reasons.pre, reasons.gap, reasons.zero]);
  const ck = r.checks;
  assert.deepEqual(ck.coverage.development.missingSessionRanges, [{ from: '2024-03-07', to: '2024-03-07', sessions: 1 }]);
  assert.equal(ck.timestamps.status, 'fail');
  assert.equal(ck.timestamps.offGrid.count, 1);
  assert.deepEqual(ck.timestamps.offGrid.sample, [{ t: et('2024-03-08', 10, 7), et: '2024-03-08 10:07' }]);
  assert.deepEqual({ pre: ck.timestamps.outsideSession.preMarket, after: ck.timestamps.outsideSession.afterHours, closed: ck.timestamps.outsideSession.nonTradingDay }, { pre: 1, after: 0, closed: 0 });
  assert.equal(ck.timestamps.unsorted > 0, true);
  // The daylight-saving change on Sunday 2024-03-10: both neighbouring sessions start at 09:30 ET.
  assert.deepEqual(ck.timestamps.dst.map((x) => [x.change, x.before.session, x.before.firstBar, x.after.session, x.after.firstBar, x.after.firstBarUtc, x.status]),
    [['2024-03-10', '2024-03-08', '09:30', '2024-03-11', '09:30', '2024-03-11T13:30:00.000Z', 'pass']]);
  assert.equal(ck.ohlcv.status, 'fail');
  assert.deepEqual({ z: ck.ohlcv.zeroVolume, m: ck.ohlcv.missingVolume, i: ck.ohlcv.duplicates.identical, c: ck.ohlcv.duplicates.conflicting }, { z: 1, m: 0, i: 1, c: 1 });
  assert.equal(ck.adjustment.status, 'pass');
  assert.equal(ck.instrument.status, 'likely, not verified');
  assert.ok(r.openItems.includes('listing exchange likely, not verified'));
});

test('known split: an unadjusted NVDA 10-for-1 blocks every period whose run includes 2024-06-10', () => {
  const periods = small({ warmup: ['2024-05-28', '2024-05-31'], development: ['2024-06-03', '2024-06-05'], validation: ['2024-06-06', '2024-06-12'], holdout: ['2024-06-13', '2024-06-21'] });
  // Raw (as-traded) series: before 2024-06-10 prices are 10x and volume a tenth.
  const raw = sessionBars('2024-05-28', '2024-06-21', { start: 120, scale: (d) => (d < '2024-06-10' ? 10 : 1), volume: (d) => (d < '2024-06-10' ? 100 : 1000) });
  const r = checkSymbolBars(raw, { symbol: 'NVDA', exchange: 'NASDAQ', periods, actions: CA.symbols.NVDA, listing: CA.listings.symbols.NVDA, keys: [{ source: 'csv', adjustment: 'unknown', feed: 'unknown', bars: raw.length }] });
  const split = r.checks.adjustment.knownSplits;
  assert.deepEqual(split.map((s) => [s.label, s.firstAdjustedSession, s.status]), [['4-for-1 forward split (stock dividend)', '2021-07-20', 'outside the window'], ['10-for-1 forward split', '2024-06-10', 'fail']]);
  assert.equal(split[1].price, 'not adjusted');
  assert.equal(split[1].volume.verdict, 'not adjusted');
  assert.equal(split[1].volume.ratio, 10);
  assert.equal(split[1].overnight.prevSession, '2024-06-07');
  assert.ok(Math.abs(split[1].overnight.ratio - 0.1) < 0.002);
  const why = r.periods.validation.reasons;
  assert.equal(why.length, 1);
  assert.match(why[0], /^adjustment: 10-for-1 forward split on 2024-06-10: prices are not split-adjusted \(open\/previous close 0\.\d+, about 1\/10\)$/);
  assert.deepEqual([r.periods.warmup.status, r.periods.development.status, r.periods.validation.status, r.periods.holdout.status], [READY, READY, NOT_READY, NOT_READY]);
  assert.deepEqual(r.periods.holdout.reasons, why);
  assert.equal(r.checks.adjustment.unknownSplitScan.candidates.length, 0, 'the known split is not reported twice');
  assert.equal(r.checks.adjustment.dividends.status, 'not verified');
  assert.equal(r.checks.instrument.status, 'unverified');

  // Split-adjusted prices but raw volume: still not ready.
  const half = sessionBars('2024-05-28', '2024-06-21', { start: 120, volume: (d) => (d < '2024-06-10' ? 100 : 1000) });
  const h = checkSymbolBars(half, { symbol: 'NVDA', exchange: 'NASDAQ', periods, actions: CA.symbols.NVDA, keys: [] });
  assert.equal(h.checks.adjustment.knownSplits[1].price, 'adjusted');
  assert.equal(h.checks.adjustment.knownSplits[1].volume.verdict, 'not adjusted');
  assert.match(h.periods.validation.reasons[0], /prices look adjusted but volume does not \(volume ratio 10, about 10\)/);

  // Fully adjusted: the split check passes.
  const adj = sessionBars('2024-05-28', '2024-06-21', { start: 120 });
  const a = checkSymbolBars(adj, { symbol: 'NVDA', exchange: 'NASDAQ', periods, actions: CA.symbols.NVDA, keys: [{ source: 'alpaca', adjustment: 'split', feed: 'sip', bars: adj.length }] });
  assert.equal(a.status, READY);
  assert.equal(a.checks.adjustment.knownSplits[1].status, 'pass');
});

test('unknown-split scan: a split-like overnight move is listed and blocks until reviewed', () => {
  const periods = small({ warmup: ['2024-03-04', '2024-03-05'], development: ['2024-03-06', '2024-03-08'], validation: ['2024-03-11', '2024-03-13'], holdout: ['2024-03-14', '2024-03-15'] });
  const bars = sessionBars('2024-03-04', '2024-03-15', { scale: (d) => (d < '2024-03-12' ? 2 : 1) }); // an unadjusted 2-for-1 on 2024-03-12
  const r = checkSymbolBars(bars, { symbol: 'PG', exchange: 'NYSE', periods, actions: CA.symbols.PG, keys: [] });
  const c = r.checks.adjustment.unknownSplitScan.candidates;
  assert.equal(c.length, 1);
  assert.equal(c[0].date, '2024-03-12');
  assert.equal(c[0].looksLike, 'an unadjusted 2-for-1 split');
  assert.deepEqual([r.periods.warmup.status, r.periods.development.status, r.periods.validation.status, r.periods.holdout.status], [READY, READY, NOT_READY, NOT_READY]);
  assert.match(r.periods.validation.reasons[0], /^adjustment: overnight move on 2024-03-12 \(open\/previous close 0\.49\d*\) looks like an unadjusted 2-for-1 split/);
  const reviewed = checkSymbolBars(bars, { symbol: 'PG', exchange: 'NYSE', periods, actions: CA.symbols.PG, keys: [], reviewed: [{ date: '2024-03-12', reason: 'test: reviewed', reviewedBy: 'test' }] });
  assert.equal(reviewed.status, READY);
  assert.equal(reviewed.checks.adjustment.unknownSplitScan.candidates[0].reviewed.reason, 'test: reviewed');
});

test('timestamps: wrong timezone across a DST change, bar-end labels and bars after an early close are caught', () => {
  const periods = small({ warmup: ['2024-03-05', '2024-03-06'], development: ['2024-03-07', '2024-03-08'], validation: ['2024-03-11', '2024-03-12'], holdout: ['2024-03-13', '2024-03-14'] });
  // A source that converts with a fixed UTC-5 all year: after 2024-03-10 every bar is an hour late.
  const good = sessionBars('2024-03-05', '2024-03-14');
  const shifted = good.map((b) => (b.t >= '2024-03-11' ? { ...b, t: new Date(Date.parse(b.t) + 60 * MIN).toISOString() } : b));
  const r = checkSymbolBars(shifted, { symbol: 'JPM', exchange: 'NYSE', periods, keys: [] });
  const dst = r.checks.timestamps.dst[0];
  assert.deepEqual([dst.change, dst.before.status, dst.after.session, dst.after.firstBar, dst.after.bars, dst.status], ['2024-03-10', 'pass', '2024-03-11', '10:30', 22, 'fail']);
  assert.equal(r.checks.timestamps.outsideSession.afterHours, 16, 'the 16:00 to 16:45 bars of four sessions');
  assert.deepEqual([r.periods.warmup.status, r.periods.development.status, r.periods.validation.status, r.periods.holdout.status], [READY, READY, NOT_READY, NOT_READY]);
  assert.ok(r.periods.validation.reasons.some((x) => x.startsWith('timestamps: around the 2024-03-10 daylight-saving change')));

  // Bars labelled by their END: every session seems to begin at 09:45.
  const ends = good.map((b) => ({ ...b, t: new Date(Date.parse(b.t) + 15 * MIN).toISOString() }));
  const e = checkSymbolBars(ends, { symbol: 'JPM', exchange: 'NYSE', periods, keys: [] });
  assert.match(e.checks.timestamps.labelling, /^not bar start: only 0% of sessions begin at 09:30 ET \(most begin at 09:45\)/);
  assert.ok(e.blocking.some((x) => x.startsWith('timestamps: bar timestamps: not bar start')));
  assert.deepEqual(e.checks.timestamps.firstBarTimes, { '09:45': 8 });

  // An early close (2024-07-03, 13:00 ET) delivered as a full day.
  const ep = small({ warmup: ['2024-07-01', '2024-07-01'], development: ['2024-07-02', '2024-07-02'], validation: ['2024-07-03', '2024-07-03'], holdout: ['2024-07-05', '2024-07-05'] });
  const full = sessionBars('2024-07-01', '2024-07-05');
  for (let t = Date.parse(et('2024-07-03', 13, 0)); t < Date.parse(et('2024-07-03', 16, 0)); t += 15 * MIN) full.push({ t: new Date(t).toISOString(), o: 100, h: 100.2, l: 99.8, c: 100.1, v: 500 });
  const x = checkSymbolBars(full, { symbol: 'JPM', exchange: 'NYSE', periods: ep, keys: [] });
  assert.deepEqual([x.checks.timestamps.outsideSession.afterHours, x.checks.timestamps.outsideSession.afterEarlyClose], [12, 12]);
  assert.deepEqual([x.periods.validation.status, x.periods.holdout.status], [NOT_READY, READY]);
  assert.equal(x.checks.coverage.validation.presentBars, 14);
});

test('instrument and sources: an exchange mismatch and mixed sources block; dstChanges and periods follow the calendar', () => {
  const periods = small({ warmup: ['2024-06-24', '2024-06-24'], development: ['2024-06-25', '2024-06-25'], validation: ['2024-06-26', '2024-06-26'], holdout: ['2024-06-27', '2024-06-27'] });
  const bars = sessionBars('2024-06-24', '2024-06-27');
  const m = checkSymbolBars(bars, { symbol: 'NVDA', exchange: 'NASDAQ', periods, listing: CA.listings.symbols.NVDA, sourceReportedExchange: 'NYSE', keys: [] });
  assert.equal(m.checks.instrument.status, 'mismatch');
  assert.ok(m.blocking.includes('instrument: universe-v1 says NASDAQ; the source reports NYSE'));
  const mixed = checkSymbolBars(bars, { symbol: 'SPY', exchange: 'NYSE ARCA', periods, keys: [{ source: 'alpaca', adjustment: 'split', feed: 'sip', bars: 52 }, { source: 'csv', adjustment: 'unknown', feed: 'unknown', bars: 52 }] });
  assert.equal(mixed.checks.sources.status, 'fail');
  assert.ok(Object.values(mixed.periods).every((p) => p.status === NOT_READY));
  assert.equal(checkSymbolBars([], { symbol: 'SPY', exchange: 'NYSE ARCA', periods, keys: [] }).status, NO_DATA);
  assert.deepEqual(dstChanges('2021-07-01', '2026-06-30').map((x) => x.change), ['2021-11-07', '2022-03-13', '2022-11-06', '2023-03-12', '2023-11-05', '2024-03-10', '2024-11-03', '2025-03-09', '2025-11-02', '2026-03-08']);
  assert.deepEqual(periodTable(SPLITS).map((p) => [p.key, p.sessions, p.expectedBars, p.earlyCloses]),
    [['warmup', 128, 3316, 1], ['development', 501, 12990, 3], ['validation', 252, 6516, 3], ['holdout', 373, 9662, 3]]);
});

// ---------- the checklist over the Lab database ----------

test('Lab readiness over the real window: an empty database is NO DATA everywhere; full SPY is READY; raw NVDA is NOT READY from 2024-06-10', { timeout: 120000 }, () => {
  const dir = tempDir();
  const lab = createLab(labCtx(dir));
  let r = lab.readiness();
  assert.equal(r.simulated, true);
  assert.equal(r.symbols.length, 17);
  assert.ok(r.symbols.every((s) => s.status === NO_DATA));
  assert.deepEqual(r.summary, { symbols: 17, ready: 0, notReady: 0, noData: 17, usablePeriods: [] });
  assert.deepEqual(r.symbols[0].checks.coverage.warmup.missingSessionRanges, [{ from: '2021-07-01', to: '2021-12-31', sessions: 128 }]);
  assert.ok(r.symbols.every((s) => Object.values(s.periods).every((p) => p.status === NO_DATA)));
  assert.equal(r.sources.sources.find((x) => x.id === 'twelvedata').facts.find((f) => f.item === 'History depth').status, 'unverified (conflicting official pages)');

  const w = SPLITS;
  const spy = sessionBars(w.warmup.from, w.holdout.to, { seed: 11, start: 430 });
  assert.equal(spy.length, 3316 + 12990 + 6516 + 9662);
  store.storeBarSet(lab.db, 'SPY', spy, { source: 'alpaca', adjustment: 'split', feed: 'sip' });
  // NVDA as traded: 4-for-1 already adjusted, the 2024 10-for-1 not.
  const nvda = sessionBars(w.warmup.from, w.holdout.to, { seed: 5, start: 20, scale: (d) => (d < '2024-06-10' ? 10 : 1), volume: (d) => (d < '2024-06-10' ? 1000 : 10000) });
  store.storeBarSet(lab.db, 'NVDA', nvda, { source: 'csv', adjustment: 'unknown', feed: 'unknown' });
  r = lab.readiness();
  const by = Object.fromEntries(r.symbols.map((s) => [s.symbol, s]));
  assert.equal(by.SPY.status, READY);
  assert.deepEqual(by.SPY.blocking, []);
  assert.equal(by.SPY.checks.timestamps.dst.length, 10);
  assert.ok(by.SPY.checks.timestamps.dst.every((x) => x.status === 'pass'));
  assert.deepEqual([by.SPY.checks.timestamps.earlyCloses.sessionsWithBars, by.SPY.checks.timestamps.earlyCloses.ok], [10, 10]);
  assert.equal(by.SPY.checks.instrument.status, 'verified by research');
  assert.equal(by.NVDA.status, NOT_READY);
  assert.deepEqual(['warmup', 'development', 'validation', 'holdout'].map((k) => by.NVDA.periods[k].status), [READY, READY, NOT_READY, NOT_READY]);
  assert.equal(by.NVDA.checks.adjustment.knownSplits[0].status, 'pass', 'the 4-for-1 is adjusted');
  assert.equal(by.NVDA.checks.adjustment.knownSplits[1].price, 'not adjusted');
  assert.deepEqual(r.summary, { symbols: 17, ready: 1, notReady: 1, noData: 15, usablePeriods: [] });
  assert.deepEqual(r.usable.warmup.ready, ['NVDA', 'SPY']);
  assert.equal(r.usable.warmup.usable, false, 'a period is usable only when all 17 are READY');
  assert.equal(lab.readiness().symbols, lab.readiness().symbols, 'cached until the bars or the corporate-actions file change');
  lab.close();
});

// ---------- Alpaca source ----------

const alpacaRes = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const zulu = (iso) => iso.replace(/\.000Z$/, 'Z');

// A fake data.alpaca.markets that serves `bars` (Alpaca shape) between start
// and end, pageSize per page, with an optional script of responses first.
function fakeAlpaca(bars, { pageSize = 500, script = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (script.length) return script.shift();
    const q = new URL(url).searchParams;
    const inRange = bars.filter((b) => b.t >= q.get('start') && b.t <= q.get('end'));
    const off = Number(q.get('page_token') || 0);
    const page = inRange.slice(off, off + pageSize);
    return alpacaRes(200, { bars: { [q.get('symbols')]: page }, symbol: null, next_page_token: off + pageSize < inRange.length ? String(off + pageSize) : null });
  };
  return { fetchImpl, calls };
}

// Regular-session bars plus pre-market (08:00-09:15) and after-hours (16:00-19:45) bars, as Alpaca might send them.
function alpacaBars(from, to, opts) {
  const reg = sessionBars(from, to, opts).map((b) => ({ ...b, t: zulu(b.t), n: 10, vw: b.c }));
  const ext = [];
  for (const d of tradingDays(from, to)) {
    for (let t = Date.parse(et(d, 8, 0)); t < Date.parse(et(d, 9, 30)); t += 15 * MIN) ext.push({ t: zulu(new Date(t).toISOString()), o: 50, h: 50.1, l: 49.9, c: 50, v: 5 });
    for (let t = Date.parse(et(d, 16, 0)); t < Date.parse(et(d, 20, 0)); t += 15 * MIN) ext.push({ t: zulu(new Date(t).toISOString()), o: 50, h: 50.1, l: 49.9, c: 50, v: 5 });
  }
  return [...reg, ...ext].sort((a, b) => (a.t < b.t ? -1 : 1));
}

test('Alpaca source: request shape, pagination, regular-session filtering and timestamp checks', async () => {
  const bars = alpacaBars('2024-03-04', '2024-03-15');
  bars.push({ t: '2024-03-13 14:30:00', o: 1, h: 1, l: 1, c: 1, v: 1 }); // not RFC-3339: dropped and counted
  const f = fakeAlpaca(bars, { pageSize: 100 });
  const src = createAlpacaSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: f.fetchImpl, now: () => new Date('2026-10-22T12:00:00Z') });
  const r = await src.getHistory({ symbol: 'NVDA', exchange: 'NASDAQ' }, '2024-03-04', '2024-03-15');
  const regular = 10 * 26;
  assert.equal(r.bars.length, regular);
  assert.ok(r.bars.every((b, i) => i === 0 || b.t > r.bars[i - 1].t));
  assert.deepEqual(r.session, { regular, preMarket: 10 * 6, afterHours: 10 * 16, nonTradingDay: 0, offGrid: 0 });
  assert.equal(r.dropped.outsideSession, 10 * 22);
  assert.equal(r.timestamps.unreadable, 1);
  assert.equal(r.timestamps.utc, bars.length - 1);
  assert.equal(r.rawBars, bars.length - 1);
  assert.equal(r.pages, Math.ceil(bars.length / 100), 'the fake pages every bar it holds, the unreadable one included');
  assert.equal(f.calls.length, r.pages);
  const first = new URL(f.calls[0].url);
  assert.equal(`${first.origin}${first.pathname}`, ALPACA_BARS_URL);
  const q = Object.fromEntries(first.searchParams);
  assert.deepEqual(q, { symbols: 'NVDA', timeframe: '15Min', start: '2024-03-04T05:00:00Z', end: '2024-03-16T03:59:59Z', adjustment: 'split', feed: 'sip', limit: '10000', sort: 'asc' });
  assert.equal(new URL(f.calls[1].url).searchParams.get('page_token'), '100');
  assert.deepEqual(f.calls[0].headers, { 'APCA-API-KEY-ID': KEY_ID, 'APCA-API-SECRET-KEY': SECRET_KEY, Accept: 'application/json' });
  assert.ok(f.calls.every((c) => !c.url.includes(KEY_ID) && !c.url.includes(SECRET_KEY)), 'keys only in headers');
  assert.equal(r.request.endClampedForFreePlan, false);

  // The free plan refuses SIP data from the last 15 minutes: the end is clamped.
  const g = fakeAlpaca([]);
  const now = new Date('2024-03-15T18:00:00Z');
  const s2 = createAlpacaSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: g.fetchImpl, now: () => now });
  const r2 = await s2.getHistory({ symbol: 'NVDA', exchange: 'NASDAQ' }, '2024-03-15', '2024-03-15');
  assert.equal(new URL(g.calls[0].url).searchParams.get('end'), '2024-03-15T17:44:00Z');
  assert.equal(r2.request.endClampedForFreePlan, true);
  assert.deepEqual(r2.bars, []);
});

test('Alpaca source: 429 backs off and retries; auth errors and bad responses never carry the keys', async () => {
  const bars = alpacaBars('2024-03-04', '2024-03-05');
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };
  const f = fakeAlpaca(bars, { script: [alpacaRes(429, { message: 'too many requests' }, { 'retry-after': '3' }), alpacaRes(429, { message: 'too many requests' })] });
  const src = createAlpacaSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: f.fetchImpl, sleep, backoffMs: 500, now: () => new Date('2026-10-22T12:00:00Z') });
  const r = await src.getHistory({ symbol: 'SPY', exchange: 'NYSE ARCA' }, '2024-03-04', '2024-03-05');
  assert.equal(r.bars.length, 52);
  assert.deepEqual(slept, [3000, 1000], 'Retry-After first, then exponential back-off');
  assert.deepEqual(src.stats(), { requests: 3, pages: 1, retries: 2, rateLimited: 2 });

  const always = fakeAlpaca([], { script: Array.from({ length: 10 }, () => alpacaRes(429, {})) });
  const s2 = createAlpacaSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: always.fetchImpl, sleep, maxRetries: 2 });
  await assert.rejects(s2.getHistory({ symbol: 'SPY', exchange: 'NYSE ARCA' }, '2024-03-04', '2024-03-05'), (e) => e instanceof ProviderError && e.kind === 'rate_limit' && /after 2 retries/.test(e.message));
  assert.equal(always.calls.length, 3);

  for (const status of [401, 403]) {
    const a = fakeAlpaca([], { script: [alpacaRes(status, { message: 'forbidden.' })] });
    const s3 = createAlpacaSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: a.fetchImpl, sleep });
    await assert.rejects(s3.getHistory({ symbol: 'SPY', exchange: 'NYSE ARCA' }, '2024-03-04', '2024-03-05'), (e) => {
      assert.equal(e.kind, 'auth');
      assert.match(e.message, new RegExp(`HTTP ${status}: forbidden\\.\\)`));
      assert.ok(!e.message.includes(KEY_ID) && !e.message.includes(SECRET_KEY));
      return true;
    });
  }
  const bad = fakeAlpaca([], { script: [alpacaRes(422, { message: 'invalid timeframe' })] });
  await assert.rejects(createAlpacaSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: bad.fetchImpl, sleep }).getHistory({ symbol: 'SPY', exchange: 'NYSE ARCA' }, '2024-03-04', '2024-03-05'), (e) => e.kind === 'bad_response' && /invalid timeframe/.test(e.message));
  const loop = fakeAlpaca([], { script: [alpacaRes(200, { bars: {}, next_page_token: 'x' }), alpacaRes(200, { bars: {}, next_page_token: 'x' })] });
  await assert.rejects(createAlpacaSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: loop.fetchImpl, sleep }).getHistory({ symbol: 'SPY', exchange: 'NYSE ARCA' }, '2024-03-04', '2024-03-05'), /same next_page_token/);
  await assert.rejects(createAlpacaSource({ fetchImpl: bad.fetchImpl }).getHistory({ symbol: 'SPY', exchange: 'NYSE ARCA' }, '2024-03-04', '2024-03-05'), (e) => e.kind === 'auth' && /not configured/.test(e.message));
});

// ---------- the Lab with Alpaca: sources recorded, never mixed ----------

test('Lab history download through Alpaca: preferred when keys are set, source recorded, mixing refused unless re-downloaded, keys redacted', async () => {
  const dir = tempDir();
  const clock = () => new Date('2026-10-22T16:00:00Z');
  const bars = alpacaBars('2024-04-01', '2024-06-28', { start: 900 });
  const f = fakeAlpaca(bars, { pageSize: 1000 });
  const extra = { ALPACA_API_KEY_ID: KEY_ID, ALPACA_API_SECRET_KEY: SECRET_KEY };
  const lab = createLab(labCtx(dir, extra), { clock, alpacaFetch: f.fetchImpl, alpacaSleep: async () => {} });
  const ov = lab.overview({ mode: 'intraday' });
  assert.deepEqual(ov.settings.historySources.map((s) => [s.id, s.adjustment, s.feed, s.preferred]), [['alpaca', 'split', 'sip', true]]);
  assert.equal(ov.settings.historySource, 'alpaca');
  assert.ok(!JSON.stringify(ov).includes(KEY_ID) && !JSON.stringify(ov).includes(SECRET_KEY));
  assert.ok(ov.needs.dataSources.some((s) => /through Alpaca/.test(s)));

  const started = lab.fetchHistory({ symbols: ['NVDA'], from: '2024-04-01', to: '2024-06-28' });
  assert.deepEqual([started.job.source, started.job.adjustment, started.job.feed, started.job.replace], ['alpaca', 'split', 'sip', false]);
  await lab.fetchDone;
  const job = lab.fetchStatus().job;
  assert.equal(job.status, 'done');
  const regular = tradingDays('2024-04-01', '2024-06-28').reduce((n, d) => n + sessionBarStarts(d).length, 0);
  assert.equal(job.symbols[0].bars, regular);
  assert.equal(store.getBars(lab.db, 'NVDA').length, regular, 'extended-hours bars are not stored');
  assert.deepEqual(store.barSourceKeys(lab.db, 'NVDA').map((k) => [k.source, k.adjustment, k.feed, k.bars]), [['alpaca', 'split', 'sip', regular]]);
  const sets = store.listBarSets(lab.db, { symbol: 'NVDA' });
  assert.equal(sets.length, 1, 'one quarter, one bar set');
  assert.equal(sets[0].details.dropped.outsideSession, tradingDays('2024-04-01', '2024-06-28').length * 22);
  assert.equal(sets[0].details.request.feed, 'sip');
  const rd = lab.readiness().symbols.find((s) => s.symbol === 'NVDA');
  assert.deepEqual(rd.checks.sources.keys.map((k) => k.source), ['alpaca']);
  assert.equal(rd.checks.timestamps.ingestion.dropped.outsideSession, sets[0].details.dropped.outsideSession);
  assert.equal(rd.checks.adjustment.knownSplits[1].status, 'pass', 'the fake serves split-adjusted bars');

  // A CSV for the same symbol would mix sources: refused, unless it replaces them.
  const csv = `time,open,high,low,close,Volume\n${sessionBars('2023-01-03', '2023-01-04').map((b) => `${Date.parse(b.t) / 1000},${b.o},${b.h},${b.l},${b.c},${b.v}`).join('\n')}\n`;
  assert.throws(() => lab.importCsv({ symbol: 'NVDA', text: csv }), (e) => e.status === 409 && /mixing sources within a symbol is refused/.test(e.message) && /alpaca \(adjustment split, feed sip\)/.test(e.message));
  const imp = lab.importCsv({ symbol: 'NVDA', text: csv, replace: true });
  assert.deepEqual(imp.sourceCheck, { source: 'csv', adjustment: 'unknown', feed: 'unknown', keptExisting: 0, deletedOther: regular });
  assert.deepEqual(store.barSourceKeys(lab.db, 'NVDA').map((k) => [k.source, k.bars]), [['csv', 52]]);
  // ...and so would Alpaca now, unless the owner re-downloads.
  assert.throws(() => lab.fetchHistory({ symbols: ['NVDA'], from: '2024-04-01', to: '2024-06-28' }), (e) => e.status === 409 && /NVDA holds 52 bars from csv/.test(e.message));
  const again = lab.fetchHistory({ symbols: ['NVDA'], from: '2024-04-01', to: '2024-06-28', replace: true });
  assert.deepEqual(again.replacing, [{ symbol: 'NVDA', bars: 52, sources: ['csv (adjustment unknown, feed unknown)'] }]);
  await lab.fetchDone;
  assert.deepEqual(store.barSourceKeys(lab.db, 'NVDA').map((k) => [k.source, k.bars]), [['alpaca', regular]]);
  assert.equal(lab.fetchStatus().job.symbols[0].deletedOther, 52);
  assert.throws(() => lab.fetchHistory({ symbols: ['NVDA'], source: 'twelvedata' }), (e) => e.status === 400 && /not configured/.test(e.message));

  // An Alpaca error that echoed a key is redacted before it is stored or shown.
  const leaky = fakeAlpaca([], { script: [alpacaRes(403, { message: `key ${KEY_ID} is not entitled` })] });
  const lab2 = createLab(labCtx(tempDir(), extra), { clock, alpacaFetch: leaky.fetchImpl, alpacaSleep: async () => {} });
  lab2.fetchHistory({ symbols: ['SPY'], from: '2024-04-01', to: '2024-04-30' });
  await lab2.fetchDone;
  const j2 = lab2.fetchStatus().job;
  assert.equal(j2.status, 'failed');
  assert.ok(j2.error.includes('[REDACTED]') && !j2.error.includes(KEY_ID));
  assert.ok(!JSON.stringify(store.getSetting(lab2.db, 'fetchJob')).includes(KEY_ID));
  lab2.close();
  lab.close();
});

test('config: ALPACA_* keys are secrets (redacted, never exposed); LAB_HISTORY_SOURCE', () => {
  const dir = tempDir();
  const cfg = cfgFor(dir, { ALPACA_API_KEY_ID: KEY_ID, ALPACA_API_SECRET_KEY: SECRET_KEY, LAB_HISTORY_SOURCE: 'twelvedata' });
  assert.equal(redact(`failed for ${KEY_ID} / ${SECRET_KEY}`, cfg), 'failed for [REDACTED] / [REDACTED]');
  const pub = publicConfigStatus(cfg);
  assert.equal(pub.configured.alpaca, true);
  assert.ok(!JSON.stringify(pub).includes(KEY_ID) && !JSON.stringify(pub).includes(SECRET_KEY));
  assert.equal(cfg.lab.historySource, 'twelvedata');
  assert.equal(cfgFor(dir, { LAB_HISTORY_SOURCE: 'nonsense' }).lab.historySource, 'auto');
  assert.equal(publicConfigStatus(cfgFor(dir)).configured.alpaca, false);
});

// ---------- the forward report ----------

test('forward report: not started means zeros; counters and simulated costs come only from the stored journal', () => {
  const dir = tempDir();
  const lab = createLab(labCtx(dir));
  let rep = lab.forwardReport({ mode: 'swing' }).report;
  assert.equal(rep.status, 'not started');
  assert.equal(rep.recordStatus, 'SIMULATED');
  assert.equal(rep.counters.signals, 0);
  assert.equal(rep.counters.closedTrades, 0);
  assert.deepEqual(rep.costs.trades, []);
  assert.match(rep.feed.warning, /at least 15 minutes old, so every forward signal would expire/);
  assert.match(rep.feed.warning, /about 5% of US volume/);
  assert.deepEqual(rep.feed.options.map((o) => [o.name, o.price]).slice(0, 2), [['Alpaca Basic (free)', 'free'], ['Alpaca Algo Trader Plus', 'US$99/month']]);
  assert.equal(lab.overview({ mode: 'swing' }).forwardReport.status, 'not started');
  assert.equal(lab.evaluation({ mode: 'swing' }).forwardReport.status, 'not started');

  const config = loadStrategyConfig();
  const runId = startForward(lab.db, { mode: 'swing', config, symbols: UNIVERSE.symbols.map((s) => ({ symbol: s.symbol, exchange: s.exchange })), now: new Date('2026-10-23T14:00:00Z') });
  const ev = (type, code, extra = {}) => ({ at: '2026-10-23T15:00:00.000Z', symbol: 'NVDA', type, reason: type, details: { code, ...extra } });
  store.insertEvents(lab.db, runId, 'forward', [
    ev('signal'), ev('signal'), ev('signal'), ev('signal'),
    ev('order_placed'), ev('order_placed'),
    ev('signal_rejected', 'costs_too_high'), ev('signal_rejected', 'max_positions'),
    ev('entry_skipped', 'expired'), ev('entry_skipped', 'no_next_bar'), ev('entry_skipped', 'above_max_entry'),
    ev('setup_expired'), ev('setup_invalidated'),
    ev('data_warning', 'late_bars', { bars: 4 }), ev('data_warning', 'late_bar', { bars: ['a', 'b'] }), ev('data_warning', 'missing_bar'), ev('data_warning', 'missing_bar'),
    ev('operational_error', 'provider_error'),
    ev('entry_filled', null, { tradeId: 'swing-NVDA-1', shares: 10, commission: 1, spreadSlippage: 0.5, fx: 0 }),
    ev('entry_filled', null, { tradeId: 'swing-NVDA-2', shares: 5, commission: 1, spreadSlippage: 0.25, fx: 0 }),
  ]);
  store.insertTrades(lab.db, runId, [{ id: 'swing-NVDA-1', symbol: 'NVDA', entry: { at: '2026-10-23T15:00:00.000Z', shares: 10, commission: 1, spreadSlippage: 0.5, fx: 0 }, exit: { at: '2026-10-24T15:00:00.000Z', reason: 'target', commission: 1, spreadSlippage: 0.5, fx: 0 }, pnl: { gross: 20, costs: 3, net: 17, r: 0.85 } }]);
  rep = lab.forwardReport({ mode: 'swing' }).report;
  assert.equal(rep.status, 'running');
  assert.deepEqual(rep.counters, {
    signals: 4, ordersPlaced: 2, entriesFilled: 2, closedTrades: 1, openPositions: 1,
    rejectedSetups: 2, rejectedByReason: { costs_too_high: 1, max_positions: 1 }, setupsExpired: 1, setupsCancelled: 1,
    entrySkips: 3, skippedByReason: { above_max_entry: 1, expired: 1, no_next_bar: 1 },
    missedSignals: { expired: 1, noNextBar: 1, total: 2 },
    lateData: { lateBarTimes: 4, lateBarWarnings: 1, barsArrivedAfterProcessing: 2, missingBars: 2, timeExitsWhileAsleep: 0 },
    operational: { providerErrors: 1, noProvider: 0, processingErrors: 0, duplicateTrades: 0, ruleChanged: 0 },
  });
  assert.deepEqual(rep.costs.trades.map((t) => [t.tradeId, t.status, t.open, t.total]), [['swing-NVDA-1', 'SIMULATED', false, 3], ['swing-NVDA-2', 'SIMULATED', true, 1.25]]);
  assert.deepEqual(rep.costs.totals, { commission: 3, spreadSlippage: 1.25, fx: 0, total: 4.25 });
  // Nothing from the forward run appears among historical runs, and the other mode stays empty.
  assert.equal(lab.listRuns({ kind: 'backtest' }).runs.length, 0);
  assert.equal(lab.forwardReport({ mode: 'intraday' }).report.status, 'not started');
  lab.close();
});

// ---------- API ----------

test('API: /api/lab/readiness and /api/lab/forward-report through the real server; keys never in a response', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const cfg = cfgFor(dir, { SIGNAL_DESK_PORT: '0', ALPACA_API_KEY_ID: KEY_ID, ALPACA_API_SECRET_KEY: SECRET_KEY });
  const contexts = lazyContexts(cfg);
  // The Host check uses the configured port, so find a free one first.
  const probe = createServer(cfg, { contexts, scheduler: null, version: 'test' });
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  cfg.port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const server = createServer(cfg, { contexts, scheduler: null, version: 'test' });
  await new Promise((r) => server.listen(cfg.port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${cfg.port}`;
  const api = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Signal-Desk': '1', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    assert.ok(!text.includes(KEY_ID) && !text.includes(SECRET_KEY), `${p} leaked a key`);
    return { status: res.status, body: JSON.parse(text) };
  };
  try {
    let r = await api('GET', '/api/lab/readiness');
    assert.equal(r.status, 200);
    assert.equal(r.body.simulated, true);
    assert.equal(r.body.symbols.length, 17);
    assert.deepEqual(r.body.summary.usablePeriods, []);
    assert.ok(r.body.symbols.every((s) => s.status === 'NO DATA'));
    assert.deepEqual(r.body.historySources.map((s) => s.id), ['alpaca']);
    assert.equal(r.body.periods.length, 4);
    r = await api('GET', '/api/lab/forward-report?mode=swing');
    assert.equal(r.status, 200);
    assert.equal(r.body.report.status, 'not started');
    assert.equal((await api('GET', '/api/lab/forward-report?mode=scalp')).status, 400);
    r = await api('GET', '/api/lab/overview?mode=intraday');
    assert.deepEqual(r.body.settings.historySources.map((s) => [s.id, s.preferred]), [['alpaca', true]]);
    assert.equal(r.body.forwardReport.status, 'not started');
    assert.equal((await api('POST', '/api/lab/fetch', { source: 'alpaca', symbols: ['NVDA'] }, { 'X-Signal-Desk': '' })).status, 403, 'state-changing requests need the CSRF header');
    assert.equal((await api('POST', '/api/lab/fetch', { source: 'twelvedata' })).status, 400);
    assert.equal((await api('POST', '/api/lab/fetch', { source: 7 })).status, 400);
    assert.equal((await api('POST', '/api/lab/fetch', { replace: 'yes' })).status, 400);
    assert.equal((await api('POST', '/api/lab/import', { symbol: 'NVDA', text: 'x', replace: 'yes' })).status, 400);
  } finally {
    await new Promise((r) => server.close(r));
    if (contexts.has('real')) contexts.get('real').labIfOpen?.close();
  }
});
