// HXR engine (strategy/hxr/ENGINE-SPEC.md sections 2-6). Hand-made price
// paths on real NYSE dates with numbers computed by hand from the spec, plus
// look-ahead, snapshot and determinism checks on seeded synthetic data.
// Synthetic data only tests code; it is never performance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createEngine, runBacktest, periodSessions, nextSession, addSessions, firstSessionOnOrAfter, sleeveCash, sellFees, ENGINE_VERSION,
} from '../server/hxr/engine.js';
import { configHash } from '../server/strategy/config.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../strategy/hxr/configs/${f}`, import.meta.url), 'utf8'));
const HOLD = load('hxr-hold-0.1.0.json'), C1 = load('hxr-c1-0.1.0.json'), C2 = load('hxr-c2-0.1.0.json'), C3 = load('hxr-c3-0.1.0.json');
const EXCLUDED = JSON.parse(readFileSync(new URL('../strategy/hxr/periods-hxr-v1.json', import.meta.url), 'utf8')).excludedSessions;

// A copy of a config with some settings changed (the files on disk are never touched).
function cfg(base, patch = {}) {
  const c = structuredClone(base);
  for (const [p, v] of Object.entries(patch)) {
    const ks = p.split('.');
    let o = c;
    for (const k of ks.slice(0, -1)) o = o[k];
    o[ks.at(-1)] = v;
  }
  return c;
}

const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const SYM = (symbol, listedFrom = '2016-01-04') => ({ symbol, exchange: 'NASDAQ', listedFrom });
const K = 0.0004; // 2 bps half-spread floor + 2 bps slippage
const FLOOR = () => 2;

function sessionsFrom(from, count, excluded = []) {
  const out = [firstSessionOnOrAfter(from, excluded)];
  while (out.length < count) out.push(nextSession(out.at(-1), excluded));
  return out;
}

// rows: [open, close], { o, c, vw15 }, a number (open = close) or null (no bar).
function build(dates, paths, { splits = {}, dividends = {} } = {}) {
  const days = new Map();
  dates.forEach((d, i) => {
    const bars = {};
    for (const [sym, rows] of Object.entries(paths)) {
      const r = rows[i];
      if (r == null) continue;
      const [o, c, vw15] = Array.isArray(r) ? r : typeof r === 'number' ? [r, r] : [r.o, r.c, r.vw15];
      bars[sym] = { o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000, vw15: vw15 ?? null };
    }
    days.set(d, { bars, splits: splits[d] || [], dividends: dividends[d] || [] });
  });
  return days;
}

// halfSpreadBps defaults to the 2 bps floor (no calibration sample yet).
function bt({ config, paths, start = '2024-03-04', warmupFrom = start, symbols, extra, halfSpreadBps = FLOOR, excluded = [] }) {
  const count = Math.max(...Object.values(paths).map((r) => r.length));
  const dates = sessionsFrom(warmupFrom, count, excluded);
  const period = { warmupFrom, start, end: dates.at(-1) };
  return runBacktest({
    config, symbols: symbols ?? Object.keys(paths).map((s) => SYM(s)), period, excludedSessions: excluded,
    inputs: { sessions: dates, days: build(dates, paths, extra), halfSpreadBps },
  });
}

const sidesAndDates = (r) => r.fills.map((f) => [f.side, f.date]);

// ---------- sessions, allocation, costs ----------

test('sessions: delays count NYSE sessions and skip holidays and excluded sessions', () => {
  assert.equal(addSessions('2024-03-08', 1), '2024-03-11'); // Friday -> Monday
  assert.equal(addSessions('2024-03-08', 2), '2024-03-12');
  assert.equal(addSessions('2024-03-28', 1), '2024-04-01'); // Good Friday closed
  assert.equal(addSessions('2024-03-28', 2), '2024-04-02');
  assert.equal(addSessions('2022-01-21', 1, EXCLUDED), '2022-01-25'); // 2022-01-24 excluded
  assert.equal(addSessions('2022-01-25', 1, EXCLUDED), '2022-01-27'); // 2022-01-26 excluded
  assert.equal(firstSessionOnOrAfter('2024-03-02'), '2024-03-04');
  const s = periodSessions({ warmupFrom: '2022-01-20', end: '2022-01-28' }, EXCLUDED);
  assert.deepEqual(s, ['2022-01-20', '2022-01-21', '2022-01-25', '2022-01-27', '2022-01-28']);
});

test('initial allocation: equal sleeves in cents, remainder to the first sleeves, whole shares only', () => {
  assert.deepEqual(sleeveCash(15000, 5), [3000, 3000, 3000, 3000, 3000]);
  assert.deepEqual(sleeveCash(15000, 8), Array(8).fill(1875));
  assert.deepEqual(sleeveCash(15000, 7), [2142.86, 2142.86, 2142.86, 2142.86, 2142.86, 2142.85, 2142.85]);
  assert.deepEqual(sleeveCash(1000, 3), [333.34, 333.33, 333.33]);
  const r = bt({ config: cfg(HOLD, { 'account.startingCash': 1000 }), paths: { A: [[10, 10.5]], B: [[30, 29]], C: [[7, 7.2]] } });
  assert.deepEqual(r.fills.map((f) => [f.symbol, f.shares, f.initial, f.reason]), [['A', 33, true, 'initial allocation'], ['B', 11, true, 'initial allocation'], ['C', 47, true, 'initial allocation']]);
  const [a, b, c] = r.fills;
  near(a.price, 10.004); near(a.cashBefore, 333.34); near(a.cashAfter, 333.34 - 33 * 10.004);
  near(b.cashBefore, 333.33); near(b.cashAfter, 333.33 - 11 * 30.012);
  near(c.cashAfter, 333.33 - 47 * 7.0028);
  near(a.spreadSlippage, 33 * 0.004);
  assert.equal(a.fees.total, 0); // zero commission, no fees on buys
  // one more share would cost more than the sleeve's cash
  assert.ok(34 * 10.004 > 333.34 && 12 * 30.012 > 333.33 && 48 * 7.0028 > 333.33);
  const p = r.equity[0];
  near(p.equity, (333.34 - 33 * 10.004) + 33 * 10.5 + (333.33 - 11 * 30.012) + 11 * 29 + (333.33 - 47 * 7.0028) + 47 * 7.2, 'equity', 1e-9);
  assert.equal(p.sleevesOut, 0);
  assert.equal(r.decisions.length, 0);
  assert.equal(r.meta.engineVersion, ENGINE_VERSION);
  assert.equal(r.meta.configHash, configHash(cfg(HOLD, { 'account.startingCash': 1000 })));
});

test('costs: half-spread + slippage on open fills; SEC fee and capped TAF on sells; zero commission', () => {
  // 149,940 shares of a $0.10 stock: the TAF (0.000166 x shares = 24.89) hits its $8.30 cap.
  const r = bt({ config: C3, paths: { TINY: [[0.1, 0.1], [0.09, 0.079], [0.08, 0.08]] } });
  assert.deepEqual(sidesAndDates(r), [['buy', '2024-03-04'], ['sell', '2024-03-06']]);
  const [b, s] = r.fills;
  near(b.price, 0.10004);
  assert.equal(b.shares, 149940);
  near(b.spreadSlippage, 149940 * 0.00004, 'buy spread', 1e-9);
  near(b.cashAfter, 15000 - 149940 * 0.10004, 'cash after buy', 1e-9);
  const p = 0.08 * (1 - K);
  near(s.price, p);
  near(s.fees.sec, 2.06e-5 * 149940 * p, 'SEC fee');
  assert.equal(s.fees.taf, 8.3);
  assert.equal(s.fees.commission, 0);
  near(s.fees.total, 2.06e-5 * 149940 * p + 8.3);
  near(s.spreadSlippage, 149940 * (0.08 - p), 'sell spread', 1e-9);
  near(s.cashAfter, b.cashAfter + 149940 * p - (2.06e-5 * 149940 * p + 8.3), 'cash after sell', 1e-9);
  // below the cap: 74 shares pay 74 x 0.000166
  const f = sellFees(C3.costs, 74, 109.956);
  near(f.taf, 74 * 0.000166);
  near(f.sec, 2.06e-5 * 74 * 109.956);
  // a calibrated half-spread is used, floored at 2 bps
  const h = bt({ config: HOLD, paths: { A: [[100, 100]], B: [[100, 100]] }, halfSpreadBps: (sym) => (sym === 'A' ? 10 : 1) });
  near(h.fills[0].price, 100 * 1.0012); assert.equal(h.fills[0].halfSpreadBps, 10);
  near(h.fills[1].price, 100 * 1.0004); assert.equal(h.fills[1].halfSpreadBps, 2);
});

test('half-spreads: a calibrated config needs a table; a variant\'s multiplier must already be applied', () => {
  const period = { warmupFrom: '2024-03-04', start: '2024-03-04', end: '2024-03-08' };
  assert.throws(() => createEngine({ config: C3, symbols: [SYM('A')], period }), /calibrated half-spreads/);
  assert.throws(() => bt({ config: C3, paths: { A: [[100, 100]] }, halfSpreadBps: () => null }), /no usable half-spread/);
  // a fixed half-spread in the config needs no table
  const fixed = bt({ config: cfg(C3, { 'costs.halfSpread': 5 }), paths: { A: [[100, 100]] }, halfSpreadBps: null });
  near(fixed.fills[0].price, 100 * 1.0007);
  // spread and slippage doubled (config.js variantConfig): 2 x max(table, floor) and 4 bps slippage
  const dbl = cfg(C3, { 'costs.halfSpreadMultiplier': 2, 'costs.slippageBps': 4 });
  const ok = bt({ config: dbl, paths: { A: [[100, 100]] }, halfSpreadBps: () => Math.max(1, 2) * 2 });
  near(ok.fills[0].price, 100 * 1.0008);
  assert.equal(ok.meta.halfSpreadMultiplier, 2);
  // the base config's table reused for the variant would understate the spread: refused
  assert.throws(() => bt({ config: dbl, paths: { A: [[100, 100]] } }), /below the floor x the variant multiplier/);
});

test('cash never goes below zero: a sell whose fees exceed its proceeds throws', () => {
  const tight = cfg(C3, { 'account.startingCash': 10, 'costs.commissionPerOrder': 5 });
  // buy floor((10 - 5) / 1.0004) = 4 shares; cash 10 - 4.0016 - 5 = 0.9984
  const ok = bt({ config: tight, paths: { A: [[1, 1]] } });
  assert.equal(ok.fills[0].shares, 4);
  near(ok.fills[0].cashAfter, 10 - 4 * 1.0004 - 5);
  assert.throws(() => bt({ config: tight, paths: { A: [[1, 1], [0.6, 0.5], [0.5, 0.5]] } }), /cash may never go below zero/);
  // a buy the sleeve cannot afford is cancelled and journalled, never overspent
  const poor = bt({ config: cfg(HOLD, { 'account.startingCash': 50 }), paths: { A: [[60, 60]] } });
  assert.equal(poor.fills.length, 0);
  assert.equal(poor.warnings.find((w) => w.code === 'insufficient_cash').symbol, 'A');
  assert.equal(poor.equity[0].cash, 50);
  for (const r of [ok, poor]) for (const p of r.equity) assert.ok(p.cash >= 0);
});

// ---------- rules ----------

test('pct_trail: exit at 20% below the high since buying (inclusive), buy back at 15% above the low since selling; anchors reset at fills', () => {
  const r = bt({
    config: C3,
    paths: { A: [[100, 100], [110, 120], [100, 97], [97, 96], [95, 90], [85, 80], [81, 91.9], [92, 92], [93, 94], [90, 76], [76, 75]] },
  });
  assert.deepEqual(r.decisions.map((d) => [d.date, d.side, d.fillDate]), [
    ['2024-03-07', 'sell', '2024-03-08'], // 96 <= 120 x 0.8
    ['2024-03-13', 'buy', '2024-03-14'], // 92 >= 80 x 1.15
    ['2024-03-18', 'sell', '2024-03-19'], // 75 <= 94 x 0.8 (the high since the buy-back, not 120)
  ]);
  const d0 = r.decisions[0];
  assert.deepEqual([d0.values.anchorHigh, d0.values.level, d0.values.close], [120, 96, 96]);
  assert.equal(r.decisions[1].values.anchorLow, 80); // reset at the sell fill: 90 on the fill day, then 80
  assert.equal(r.decisions[2].values.anchorHigh, 94); // reset at the buy fill
  assert.deepEqual(sidesAndDates(r), [['buy', '2024-03-04'], ['sell', '2024-03-08'], ['buy', '2024-03-14']]);
  // the last decision was on the period's last session: it can never fill
  assert.deepEqual(r.pendingAtEnd.map((o) => [o.side, o.decisionDate, o.fillDate]), [['sell', '2024-03-18', '2024-03-19']]);
  const rt = r.roundTrips[0];
  near(rt.exitPrice, 95 * (1 - K)); near(rt.buyBackPrice, 93 * (1 + K));
  near(rt.changePct, ((93 * (1 + K)) / (95 * (1 - K)) - 1) * 100);
  near(rt.dollars, 149 * (93 * (1 + K) - 95 * (1 - K)), 'round-trip dollars', 1e-9);
  assert.equal(rt.highestCloseWhileOut, 92);
  assert.equal(rt.sessionsOut, 4);
});

test('ma_band: the band keeps a close just under or over the average from trading', () => {
  const c = cfg(C1, { 'rule.smaSessions': 3 });
  const r = bt({
    config: c, warmupFrom: '2024-02-28', start: '2024-03-04',
    paths: { A: [100, 100, 100, [100, 100], [99, 98], [97, 95], [95, 96], [96, 98], [98, 100], [100, 100]] },
  });
  // 03-05: 98 < SMA 99.33 but not < 97.35; 03-06: 95 < 97.667 x 0.98 = 95.713
  // 03-08: 98 > SMA 96.33 but not > 98.26; 03-11: 100 > 98 x 1.02 = 99.96
  assert.deepEqual(r.decisions.map((d) => [d.date, d.side]), [['2024-03-06', 'sell'], ['2024-03-11', 'buy']]);
  const [s, b] = r.decisions;
  near(s.values.sma, (100 + 98 + 95) / 3); near(s.values.lower, ((100 + 98 + 95) / 3) * 0.98);
  near(b.values.sma, 98); near(b.values.upper, 98 * 1.02);
  assert.deepEqual(sidesAndDates(r), [['buy', '2024-03-04'], ['sell', '2024-03-07'], ['buy', '2024-03-12']]);
  // warm-up closes feed the average but make no equity points or decisions
  assert.equal(r.equity[0].date, '2024-03-04');
  // without enough history there is no signal: the same path with no warm-up never exits on 03-04/03-05
  const cold = bt({ config: cfg(C1, { 'rule.smaSessions': 5 }), paths: { A: [[100, 100], [90, 80], [80, 70], [70, 60]] } });
  assert.equal(cold.decisions.length, 0);
});

test('vol_trail: trails the high by multiple x the mean absolute close change; anchors reset at fills', () => {
  const c = cfg(C2, { 'rule.volSessions': 2, 'rule.multiple': 1 });
  const r = bt({
    config: c, warmupFrom: '2024-02-29', start: '2024-03-04',
    paths: { A: [100, 102, [101, 101], [102, 104], [103, 101.5], [101.5, 101], [100, 99], [99, 100.4], [100.4, 101], [101, 101.2], [101, 100.7]] },
  });
  assert.deepEqual(r.decisions.map((d) => [d.date, d.side]), [['2024-03-07', 'sell'], ['2024-03-12', 'buy'], ['2024-03-14', 'sell']]);
  const [s1, b1, s2] = r.decisions;
  near(s1.values.vol, 1.5); assert.equal(s1.values.anchorHigh, 104); near(s1.values.level, 102.5);
  near(b1.values.vol, 1.0); assert.equal(b1.values.anchorLow, 99); near(b1.values.level, 100);
  near(s2.values.vol, 0.35); assert.equal(s2.values.anchorHigh, 101.2); near(s2.values.level, 100.85);
  assert.deepEqual(sidesAndDates(r), [['buy', '2024-03-04'], ['sell', '2024-03-08'], ['buy', '2024-03-13']]);
});

test('hold arm: initial allocation only, never a decision or a trade', () => {
  const { days, sessions, symbols, period } = synthetic(7);
  const r = runBacktest({ config: HOLD, symbols, period, excludedSessions: EXCLUDED, inputs: { sessions, days, halfSpreadBps: FLOOR } });
  assert.equal(r.decisions.length, 0);
  assert.ok(r.fills.length === symbols.length && r.fills.every((f) => f.side === 'buy' && f.initial));
  assert.equal(r.roundTrips.length, 0);
  assert.ok(r.equity.every((p) => p.sleevesOut === 0));
});

// ---------- timing ----------

test('delays: one session by default, two in the stress version', () => {
  const paths = { A: [[100, 100], [100, 100], [100, 100], [97, 80], [81, 82], [82, 83], [83, 84]] }; // exit signal Thursday 03-07
  const one = bt({ config: C3, paths });
  assert.deepEqual(one.decisions.map((d) => [d.date, d.fillDate, d.delaySessions]), [['2024-03-07', '2024-03-08', 1]]);
  assert.equal(one.fills[1].date, '2024-03-08');
  near(one.fills[1].price, 81 * (1 - K));
  const two = bt({ config: cfg(C3, { 'execution.delaySessions': 2 }), paths });
  assert.deepEqual(two.decisions.map((d) => [d.date, d.fillDate, d.delaySessions]), [['2024-03-07', '2024-03-11', 2]]);
  assert.equal(two.fills[1].date, '2024-03-11'); // the Monday open, over the weekend
  near(two.fills[1].price, 82 * (1 - K));
  assert.equal(two.meta.delaySessions, 2);
});

test('a fill waits for the stock\'s next bar; the delay and the gap are journalled', () => {
  const r = bt({ config: C3, paths: { A: [[100, 100], [100, 100], [100, 100], [97, 80], null, [83, 84]], B: [100, 100, 100, 100, 100, 100] } });
  const sell = r.fills.find((f) => f.side === 'sell');
  assert.deepEqual([sell.date, sell.fillDate, sell.waitedSessions], ['2024-03-11', '2024-03-08', 1]);
  near(sell.price, 83 * (1 - K));
  const w = r.warnings.filter((x) => x.date === '2024-03-08').map((x) => x.code);
  assert.deepEqual(w, ['no_bar', 'order_waiting']);
  // valuation keeps the last close (80) while the bar is missing
  near(r.equity[4].sleeves.A.value, r.fills[0].shares * 80);
});

test('excluded sessions are skipped: no fills, decisions or closes; an order due then fills next session', () => {
  const ex = EXCLUDED;
  // sessions: 01-20, 01-21, 01-25, 01-27, 01-28 (01-24 and 01-26 excluded)
  const r = bt({ config: C3, start: '2022-01-20', excluded: ex, paths: { A: [[100, 100], [97, 80], [82, 83], [84, 85], [85, 86]] } });
  assert.deepEqual(r.equity.map((p) => p.date), ['2022-01-20', '2022-01-21', '2022-01-25', '2022-01-27', '2022-01-28']);
  assert.deepEqual(r.decisions.map((d) => [d.date, d.fillDate]), [['2022-01-21', '2022-01-25']]);
  assert.equal(r.fills[1].date, '2022-01-25');
  assert.deepEqual(r.meta.excludedSessions, ex.map((x) => x.date).sort());
  const e = createEngine({ config: C3, symbols: [SYM('A')], period: { warmupFrom: '2022-01-20', start: '2022-01-20', end: '2022-01-28' }, excludedSessions: ex, halfSpreadBps: FLOOR });
  e.processSession('2022-01-20', { bars: {} });
  e.processSession('2022-01-21', { bars: {} });
  assert.throws(() => e.processSession('2022-01-24', { bars: {} }), /excluded session/);
});

test('input checks: order, repeats, gaps, non-sessions and bars before the listing date throw', () => {
  const mk = () => createEngine({ config: C3, symbols: [SYM('A'), SYM('NEW', '2024-03-06')], period: { warmupFrom: '2024-03-04', start: '2024-03-04', end: '2024-03-15' }, halfSpreadBps: FLOOR });
  const e = mk();
  e.processSession('2024-03-04', { bars: { A: { o: 1, h: 1, l: 1, c: 1 } } });
  assert.throws(() => e.processSession('2024-03-04', { bars: {} }), /out of order or repeated/);
  assert.throws(() => e.processSession('2024-03-01', { bars: {} }), /out of order or repeated/);
  assert.throws(() => e.processSession('2024-03-06', { bars: {} }), /skips 2024-03-05/);
  assert.throws(() => e.processSession('2024-03-09', { bars: {} }), /not a NYSE session/);
  assert.throws(() => e.processSession('2024-03-05', { bars: { NEW: { o: 1, h: 1, l: 1, c: 1 } } }), /before its listing date/);
  const f = mk();
  const out = f.processSession('2024-03-04', { bars: { A: { o: 1, h: 1, l: 1, c: 1 } } });
  assert.deepEqual(out.warnings.map((w) => [w.symbol, w.code]), [['NEW', 'before_listing'], ['NEW', 'order_waiting']]);
  assert.throws(() => f.processSession('2024-03-05', { bars: {}, dividends: [{ symbol: 'A', exDate: '2024-03-06', amount: 1 }] }), /ex-date 2024-03-06/);
});

// ---------- dividends ----------

test('dividends: entitlement at the start of the ex-date, 15% withheld, credited on the pay date, receivable meanwhile', () => {
  // hold: 299 shares bought at 50.02; ex 03-05, paid 03-07
  const r = bt({ config: HOLD, paths: { A: [[50, 50], [50, 50], [50, 50], [50, 50]] }, extra: { dividends: { '2024-03-05': [{ symbol: 'A', exDate: '2024-03-05', payDate: '2024-03-07', amount: 1 }] } } });
  assert.equal(r.fills[0].shares, 299);
  const [ent, pay] = r.dividends;
  assert.deepEqual([ent.kind, ent.shares, ent.payDate], ['entitlement', 299, '2024-03-07']);
  near(ent.gross, 299); near(ent.withheld, 44.85); near(ent.net, 254.15);
  assert.deepEqual([pay.kind, pay.paidOn, pay.entitlementId], ['payment', '2024-03-07', ent.id]);
  const cash0 = r.equity[0].cash;
  near(r.equity[1].receivable, 254.15); near(r.equity[1].cash, cash0); // equity excludes the receivable
  near(r.equity[1].equity, cash0 + 299 * 50);
  near(r.equity[2].receivable, 254.15);
  near(r.equity[3].cash, cash0 + 254.15); assert.equal(r.equity[3].receivable, 0);
  assert.equal(r.receivables.length, 0);
  const none = bt({ config: cfg(HOLD, { 'dividends.withholdingPct': 0 }), paths: { A: [[50, 50], [50, 50]] }, extra: { dividends: { '2024-03-05': [{ symbol: 'A', exDate: '2024-03-05', payDate: '2024-03-05', amount: 1 }] } } });
  near(none.dividends[0].net, 299); near(none.equity[1].cash, none.equity[0].cash + 299);
});

test('dividends: sold at the ex-date open still earns it; bought at the ex-date open does not; unpaid at the end stays a receivable', () => {
  const r = bt({
    config: C3,
    paths: { A: [[50, 50], [48, 40], [41, 40], [42, 47], [47, 48], [48, 48], [48, 48]] },
    extra: {
      dividends: {
        '2024-03-06': [{ symbol: 'A', exDate: '2024-03-06', payDate: '2024-03-20', amount: 0.5 }],
        '2024-03-08': [{ symbol: 'A', exDate: '2024-03-08', payDate: '2024-03-12', amount: 0.5 }],
      },
    },
  });
  assert.deepEqual(sidesAndDates(r), [['buy', '2024-03-04'], ['sell', '2024-03-06'], ['buy', '2024-03-08']]);
  const [sold, bought] = r.dividends.filter((d) => d.kind === 'entitlement');
  assert.equal(sold.shares, 299); near(sold.gross, 149.5); near(sold.withheld, 22.425); near(sold.net, 127.075);
  assert.equal(bought.shares, 0); assert.equal(bought.gross, 0);
  assert.deepEqual(r.receivables.map((x) => [x.symbol, x.payDate]), [['A', '2024-03-20']]);
  near(r.receivables[0].net, 127.075);
  near(r.equity.at(-1).receivable, 127.075);
  const ep = r.episodes.find((e) => e.startDate === '2024-03-04');
  near(ep.dividendsNet, 127.075);
  near(ep.pnl, ep.proceeds + 127.075 - ep.cost);
});

// ---------- splits ----------

test('forward split: shares multiplied, history and anchors divided; round trips compared on the split-adjusted basis', () => {
  // C3: 149 shares at 100.04; 20-for-1 effective 03-06. Unadjusted, 5.0 <= 110 x 0.8 would exit.
  const r = bt({
    config: C3,
    paths: { A: [[100, 100], [105, 110], [5.3, 5.0], [5.0, 4.3], [4.2, 4.2]] },
    extra: { splits: { '2024-03-06': [{ symbol: 'A', ratio: 20 }] } },
  });
  assert.deepEqual(r.splits.map((s) => [s.kind, s.sharesBefore, s.sharesAfter, s.ratio]), [['split', 149, 2980, 20]]);
  assert.deepEqual(r.decisions.map((d) => [d.date, d.side]), [['2024-03-07', 'sell']]);
  near(r.decisions[0].values.anchorHigh, 5.5); near(r.decisions[0].values.level, 4.4);
  assert.equal(r.fills[1].shares, 2980);
  near(r.equity[2].invested, 2980 * 5.0);
  // ma_band history is rescaled too: SMA of 5, 5.5, 5.2 (not 100, 110, 5.2)
  const ma = cfg(C1, { 'rule.smaSessions': 3 });
  const e = createEngine({ config: ma, symbols: [SYM('A')], period: { warmupFrom: '2024-03-04', start: '2024-03-04', end: '2024-03-08' }, halfSpreadBps: FLOOR });
  const days = build(sessionsFrom('2024-03-04', 3), { A: [[100, 100], [105, 110], [5.3, 5.2]] }, { splits: { '2024-03-06': [{ symbol: 'A', ratio: 20 }] } });
  for (const [d, day] of days) e.processSession(d, day);
  const st = e.snapshot().sleeves[0];
  assert.deepEqual(st.history.map((x) => +x.toFixed(10)), [5, 5.5, 5.2]);
  assert.equal(st.anchorHigh, 5.5);
  assert.equal(st.shares, 2980);
  assert.equal(e.output().decisions.length, 0);
  // exit before a 2-for-1 split, buy back after it
  const rt = bt({
    config: C3,
    paths: { A: [[100, 100], [90, 80], [82, 80], [45, 46], [47, 47]] },
    extra: { splits: { '2024-03-07': [{ symbol: 'A', ratio: 2 }] } },
  });
  assert.deepEqual(rt.decisions.map((d) => [d.date, d.side]), [['2024-03-05', 'sell'], ['2024-03-07', 'buy']]); // 46 >= 40 x 1.15
  const t = rt.roundTrips[0];
  near(t.exitPrice, 82 * (1 - K)); near(t.buyBackPriceAdj, 47 * (1 + K) * 2); assert.equal(t.splitAdjustment, 2);
  near(t.changePct, ((47 * (1 + K) * 2) / (82 * (1 - K)) - 1) * 100);
  near(t.dollars, 149 * (47 * (1 + K) * 2 - 82 * (1 - K)), 'dollars', 1e-9);
  assert.equal(t.highestCloseWhileOut, 92); // 46 after the split = 92 in exit units
});

test('reverse split: the fraction of a share is paid out at the open less the half-spread', () => {
  // hold: 2142 shares at 7.0028 (cash 0.0024); 1-for-10 effective 03-06 -> 214 shares + 0.2 share in cash
  const r = bt({ config: HOLD, paths: { A: [[7, 7], [7, 7], [70, 71]] }, extra: { splits: { '2024-03-06': [{ symbol: 'A', ratio: 0.1 }] } } });
  assert.equal(r.fills[0].shares, 2142);
  const [sp, cil] = r.splits;
  assert.deepEqual([sp.kind, sp.sharesBefore, cil.kind, cil.sharesAfter], ['split', 2142, 'cash_in_lieu', 214]);
  near(cil.fraction, 0.2, 'fraction', 1e-9);
  near(cil.cash, 0.2 * 70 * (1 - 0.0002), 'cash in lieu', 1e-9);
  near(r.equity[2].cash, 15000 - 2142 * 7.0028 + 0.2 * 70 * 0.9998, 'cash', 1e-9);
  near(r.equity[2].equity, r.equity[2].cash + 214 * 71, 'equity', 1e-9);
  // no bar on the split session: the fraction waits for the next open
  const w = bt({ config: HOLD, paths: { A: [[7, 7], [7, 7], null, [72, 72]] }, extra: { splits: { '2024-03-06': [{ symbol: 'A', ratio: 0.1 }] } } });
  assert.ok(w.warnings.some((x) => x.code === 'cash_in_lieu_waiting' && x.date === '2024-03-06'));
  const c2 = w.splits.find((s) => s.kind === 'cash_in_lieu');
  assert.equal(c2.date, '2024-03-07');
  near(c2.cash, 0.2 * 72 * 0.9998, 'deferred cash in lieu', 1e-9);
  near(w.equity[2].invested, 214.2 * 70, 'valued at the last close (7) in post-split units', 1e-9);
});

// ---------- fill model ----------

test('vw15 fill model: first-15-minute VWAP plus or minus the half-spread only; falls back to the open and flags it', () => {
  const v = cfg(C3, { 'execution.fillModel': 'vw15' });
  const paths = { A: [{ o: 100, c: 100, vw15: 101 }, [100, 80], { o: 82, c: 80, vw15: null }] };
  const r = bt({ config: v, paths });
  const [b, s] = r.fills;
  assert.deepEqual([b.basis, b.rawPrice, b.slippageBps, b.flags], ['vw15', 101, 0, []]);
  near(b.price, 101 * 1.0002);
  assert.equal(b.shares, 148);
  near(b.spreadSlippage, 148 * 101 * 0.0002, 'vw15 spread', 1e-9);
  assert.deepEqual([s.basis, s.rawPrice, s.flags], ['open', 82, ['vw15_missing_open_used']]);
  near(s.price, 82 * (1 - K));
  assert.equal(r.meta.fillModel, 'vw15');
  const o = bt({ config: C3, paths });
  assert.deepEqual(o.fills.map((f) => f.id), r.fills.map((f) => f.id)); // same decisions, same ids
  near(o.fills[0].price, 100 * (1 + K));
});

// ---------- whole-engine properties (seeded synthetic data: code checks only) ----------

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Four stocks over 2021-06 to 2022-12 (the excluded sessions fall inside), with
// trending regimes, a forward and a reverse split, dividends, a missing bar,
// vw15 values and one stock listed during the warm-up.
function synthetic(seed, { bump = null } = {}) {
  const symbols = [SYM('AAA'), SYM('BBB'), SYM('CCC'), SYM('DDD', '2021-08-02')];
  const period = { warmupFrom: '2021-06-01', start: '2021-09-01', end: '2022-12-30' };
  const sessions = periodSessions(period, EXCLUDED);
  const rnd = prng(seed);
  const px = { AAA: 40, BBB: 25, CCC: 120, DDD: 60 };
  const days = new Map();
  sessions.forEach((d, i) => {
    const bars = {}, splits = [], dividends = [];
    if (d === '2022-03-15') { splits.push({ symbol: 'CCC', ratio: 4 }); px.CCC /= 4; }
    if (d === '2022-06-14') { splits.push({ symbol: 'BBB', ratio: 0.5 }); px.BBB *= 2; }
    if (i % 63 === 30) dividends.push({ symbol: 'AAA', exDate: d, payDate: sessions[Math.min(i + 8, sessions.length - 1)], amount: 0.25 });
    symbols.forEach((s, k) => {
      if (s.listedFrom && d < s.listedFrom) return;
      if (s.symbol === 'BBB' && (i === 200 || i === 201)) return; // two missing bars
      const drift = 0.006 * Math.sin(i / (18 + 7 * k));
      const o = px[s.symbol] * (1 + (rnd() - 0.5) * 0.02);
      let c = o * (1 + drift + (rnd() - 0.5) * 0.05);
      if (bump && d > bump.after) c *= bump.factor;
      bars[s.symbol] = { o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: 1000 + i, vw15: k === 2 && i % 5 === 0 ? null : (o + c) / 2 };
      px[s.symbol] = c;
    });
    days.set(d, { bars, splits, dividends });
  });
  return { symbols, period, sessions, days };
}

const RULES = {
  hold: HOLD,
  c1: cfg(C1, { 'rule.smaSessions': 20 }),
  c2: cfg(C2, { 'rule.volSessions': 10, 'rule.multiple': 2 }),
  c3: cfg(C3, { 'rule.exitDrawdownPct': 10, 'rule.reentryRisePct': 8 }),
  c3vw: cfg(C3, { 'rule.exitDrawdownPct': 10, 'rule.reentryRisePct': 8, 'execution.fillModel': 'vw15', 'execution.delaySessions': 2 }),
};
const halfSpreadBps = (sym, date) => (sym === 'BBB' ? 6 : date < '2022-01-01' ? 2 : 3);

function upTo(r, cut) {
  return {
    decisions: r.decisions.filter((x) => x.date <= cut), fills: r.fills.filter((x) => x.date <= cut), equity: r.equity.filter((x) => x.date <= cut),
    warnings: r.warnings.filter((x) => x.date <= cut), splits: r.splits.filter((x) => x.date <= cut),
    dividends: r.dividends.filter((x) => (x.session ?? x.paidOn) <= cut),
    roundTrips: r.roundTrips.filter((x) => x.buyBackDate <= cut), episodes: r.episodes.filter((x) => !x.open && x.endDate <= cut),
  };
}

const runOf = (config, syn, end = syn.period.end) => runBacktest({
  config, symbols: syn.symbols, period: { ...syn.period, end }, excludedSessions: EXCLUDED,
  inputs: { sessions: syn.sessions.filter((d) => d <= end), days: syn.days, halfSpreadBps },
});

test('prefix invariance: runs cut at 20%, 45%, 70% and 93% of the sessions match the full run up to the cut', () => {
  const syn = synthetic(11);
  for (const [name, config] of Object.entries(RULES)) {
    const full = runOf(config, syn);
    if (name !== 'hold') assert.ok(full.decisions.length >= 8, `${name}: enough decisions to compare (${full.decisions.length})`);
    for (const frac of [0.2, 0.45, 0.7, 0.93]) {
      const cut = syn.sessions[Math.floor(syn.sessions.length * frac)];
      const part = runOf(config, syn, cut);
      assert.deepEqual(upTo(part, cut), upTo(full, cut), `${name} up to ${cut}`);
    }
  }
});

test('future-change test: changing every bar after T leaves everything up to T unchanged', () => {
  const T = '2022-05-02';
  const a = synthetic(23), b = synthetic(23, { bump: { after: T, factor: 1.3 } });
  for (const [name, config] of Object.entries(RULES)) {
    const ra = runOf(config, a), rb = runOf(config, b);
    assert.deepEqual(upTo(rb, T), upTo(ra, T), `${name} up to ${T}`);
    assert.notDeepEqual(rb.equity.at(-1), ra.equity.at(-1), `${name}: the change after T does show`);
  }
});

test('snapshot: run to T, JSON round-trip, restore, continue = uninterrupted run', () => {
  const syn = synthetic(5);
  for (const [name, config] of Object.entries(RULES)) {
    const opts = { config, symbols: syn.symbols, period: syn.period, excludedSessions: EXCLUDED, halfSpreadBps };
    const one = createEngine(opts);
    for (const d of syn.sessions) one.processSession(d, syn.days.get(d));
    const whole = one.finish();
    for (const frac of [0.37, 0.81]) {
      const cut = Math.floor(syn.sessions.length * frac);
      const a = createEngine(opts);
      const steps = [];
      for (const d of syn.sessions.slice(0, cut)) steps.push(a.processSession(d, syn.days.get(d)));
      const saved = JSON.parse(JSON.stringify(a.snapshot()));
      const b = createEngine({ ...opts, state: saved });
      for (const d of syn.sessions.slice(cut)) steps.push(b.processSession(d, syn.days.get(d)));
      assert.deepEqual(b.finish(), whole, `${name} restored at ${syn.sessions[cut]}`);
      // the per-session returns add up to the journal
      assert.deepEqual(steps.flatMap((s) => s.fills), whole.fills);
      assert.deepEqual(steps.flatMap((s) => s.decisions), whole.decisions);
      assert.deepEqual(steps.map((s) => s.equity).filter(Boolean), whole.equity);
    }
  }
  const base = { symbols: syn.symbols, period: syn.period, excludedSessions: EXCLUDED, halfSpreadBps };
  const e = createEngine({ ...base, config: RULES.c1 });
  assert.throws(() => createEngine({ ...base, config: RULES.c2, state: e.snapshot() }), /config hash differs/);
  assert.throws(() => createEngine({ ...base, config: RULES.c1, symbols: syn.symbols.slice(1), state: e.snapshot() }), /different list of symbols/);
  assert.throws(() => createEngine({ ...base, config: RULES.c1, excludedSessions: [], state: e.snapshot() }), /excluded sessions/);
  e.finish();
  assert.throws(() => e.processSession(syn.sessions[0], syn.days.get(syn.sessions[0])), /finished/);
});

test('determinism: identical output and ids on repeated runs; ids unique; cash never negative', () => {
  const syn = synthetic(3);
  for (const [name, config] of Object.entries(RULES)) {
    const a = runOf(config, syn), b = runOf(config, syn);
    assert.deepEqual(a, b, name);
    for (const k of ['fills', 'decisions', 'dividends', 'warnings', 'splits', 'roundTrips', 'episodes']) {
      const ids = a[k].map((x) => x.id);
      assert.equal(new Set(ids).size, ids.length, `${name} ${k} ids unique`);
      assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
    }
    assert.ok(a.equity.every((p) => p.cash >= 0 && Object.values(p.sleeves).every((s) => s.cash >= 0)), `${name} cash never negative`);
    assert.ok(a.fills.every((f) => Number.isInteger(f.shares) && f.shares >= 1), `${name} whole shares`);
    assert.match(a.meta.dataHash, /^[0-9a-f]{64}$/);
    assert.equal(a.meta.completeToEnd, true);
    assert.equal(a.meta.simulated, true);
  }
  // the synthetic data exercised splits, dividends, missing bars and missing vw15
  const c3 = runOf(RULES.c3vw, syn);
  assert.ok(c3.splits.some((s) => s.symbol === 'CCC' && s.ratio === 4) && c3.splits.some((s) => s.symbol === 'BBB' && s.ratio === 0.5));
  assert.ok(c3.dividends.some((d) => d.kind === 'payment'));
  assert.ok(c3.warnings.some((w) => w.code === 'no_bar' && w.symbol === 'BBB'));
  assert.ok(c3.fills.some((f) => f.flags.includes('vw15_missing_open_used')));
  // DDD listed during the warm-up: no warnings before its listing date
  assert.ok(!c3.warnings.some((w) => w.symbol === 'DDD' && w.date < '2021-08-02'));
});
