// rr-mech-2 (server/research/mechanisms-2.js) on synthetic data: (1) with no veto it reproduces rr-mech-1 exactly,
// for every campaign-3 mechanism config, continuous and restored from a snapshot; (2) a late session skips the
// entry in this account and later signals and sizes come from its actual state; (3) a late exit is held, keeps
// its cash, risk, split and dividend, blocks another entry in the stock, and fills at the first open after its
// release; (4) the engine is deterministic. Synthetic prices only exercise the code; nothing here is a result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMechanism } from '../server/research/mechanisms.js';
import { createMechanismEngine2, runMechanism2, withoutEngineLabels, MECHANISM_ENGINE_VERSION_2 } from '../server/research/mechanisms-2.js';
import { mulberry32 } from '../server/research/runner.js';
import { campaign3Experiments } from '../server/research/space.js';
import { sharedBlock } from '../server/research/config.js';

function sessionsFrom(from, n) {
  const out = [];
  const d = new Date(from + 'T12:00:00Z');
  while (out.length < n) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
// A random market: four symbols, multiplicative random walks with mild mean reversion, a 3-for-1 split and
// dividends, opens near the previous close. Deterministic for a seed.
function randomMarket(seed, n = 480) {
  const dates = sessionsFrom('2019-01-02', n);
  const rand = mulberry32(seed);
  const syms = ['AAA', 'BBB', 'CCC', 'DDD'];
  const days = new Map(dates.map((d) => [d, { bars: {}, splits: [], dividends: [] }]));
  const splitAt = dates[330];
  for (const [j, s] of syms.entries()) {
    let c = 40 + 30 * j, factor = 1;
    for (let i = 0; i < n; i++) {
      const d = dates[i];
      if (s === 'BBB' && d === splitAt) { factor = 3; days.get(d).splits.push({ symbol: s, ratio: 3, id: 'split-BBB' }); }
      const o = c * (1 + (rand() - 0.5) * 0.01);
      c = c * (1 + (rand() - 0.5) * 0.05 + 0.0004);
      days.get(d).bars[s] = { o: o / factor, h: Math.max(o, c) / factor * 1.002, l: Math.min(o, c) / factor * 0.998, c: c / factor, v: 1000 };
      if (i % 63 === 40) days.get(d).dividends.push({ symbol: s, exDate: d, payDate: dates[Math.min(n - 1, i + 7)], amount: 0.2 / factor, id: `div-${s}-${i}` });
    }
  }
  return { dates, days, syms };
}
const withPeriod = (config, m, startIdx = 230) => ({ ...config, period: { basket: 'A', warmupFrom: m.dates[0], start: m.dates[startIdx], end: m.dates.at(-1) } });

test('rr-mech-2 with no veto reproduces rr-mech-1 exactly for every campaign-3 mechanism config, continuous and restored from a mid-run snapshot', () => {
  const configs = campaign3Experiments().filter((e) => e.config.strategy === 'mechanism').map((e) => e.config);
  assert.equal(configs.length, 23);
  for (const seed of [7, 19]) {
    const m = randomMarket(seed);
    for (const base of configs) {
      const config = withPeriod(base, m);
      const args = { config, symbols: m.syms, sessions: m.dates, days: m.days, halfSpreadBps: (s, d) => 1.5 + (d < '2019-06-01' ? 1 : 2) };
      const a = runMechanism(args), b = runMechanism2(args), c = runMechanism2({ ...args, restoreAt: m.dates[300] });
      assert.deepEqual(withoutEngineLabels(b), withoutEngineLabels(a), `${config.version} seed ${seed}`);
      assert.deepEqual(withoutEngineLabels(c), withoutEngineLabels(a), `${config.version} seed ${seed} restored`);
      assert.equal(b.engineVersion, MECHANISM_ENGINE_VERSION_2); assert.equal(b.meta.engineVersion, MECHANISM_ENGINE_VERSION_2);
    }
  }
});

test('state restore refuses another config, another symbol list or a non rr-mech-2 state; a warm-up session cannot be late; determinism', () => {
  const m = randomMarket(3);
  const [b0] = campaign3Experiments().filter((e) => e.name === 'B0').map((e) => withPeriod(e.config, m));
  const e = createMechanismEngine2({ config: b0, symbols: m.syms, halfSpreadBps: 2 });
  for (const d of m.dates.slice(0, 260)) e.processSession(d, m.days.get(d));
  const snap = e.snapshot();
  assert.throws(() => createMechanismEngine2({ config: { ...b0, params: { entry: 40, exit: 20 }, mechanism: 'B1' }, symbols: m.syms, halfSpreadBps: 2, state: snap }), /different config/);
  assert.throws(() => createMechanismEngine2({ config: b0, symbols: ['AAA', 'BBB'], halfSpreadBps: 2, state: snap }), /different symbol list/);
  assert.throws(() => createMechanismEngine2({ config: b0, symbols: m.syms, halfSpreadBps: 2, state: { ...snap, engine: 'rr-mech-1' } }), /not an rr-mech-2 state/);
  const w = createMechanismEngine2({ config: b0, symbols: m.syms, halfSpreadBps: 2 });
  assert.throws(() => w.processSession(m.dates[0], m.days.get(m.dates[0]), { late: true }), /warm-up session/);
  const x = runMechanism2({ config: b0, symbols: m.syms, sessions: m.dates, days: m.days, halfSpreadBps: 2 });
  const y = runMechanism2({ config: b0, symbols: m.syms, sessions: m.dates, days: m.days, halfSpreadBps: 2 });
  assert.deepEqual(x, y);
  assert.throws(() => e.processSession(m.dates[100], m.days.get(m.dates[100])), /out of order/);
});

// ---------- a hand-built M0 market: X and Y ----------
// Closes in pre-split units; X has a 2-for-1 split effective at session 30 (raw prices halve from then) and a
// dividend with its ex-date at session 30, paid at session 32.
function m0Market() {
  const alt = [100]; for (let i = 1; i <= 24; i++) alt.push(alt[i - 1] + (i % 2 === 0 ? 1 : -0.5)); // single down closes only; index 24 is an up close
  const X = [...alt, 105.5, 105, 104.5, 105.2, 104.8, 104.4, 104.6, 105, 104.5, 104, 104.8, 105.5];
  const Y = [...alt, 105.5, 106.5, 106, 107, 106.5, 106, 106.4, 107, 106.6, 107.2, 107.6, 108];
  const dates = sessionsFrom('2020-01-02', X.length);
  const days = new Map(dates.map((d) => [d, { bars: {}, splits: [], dividends: [] }]));
  const splitIdx = 30;
  for (const [sym, closes] of [['X', X], ['Y', Y]]) {
    closes.forEach((c, i) => {
      const f = sym === 'X' && i >= splitIdx ? 2 : 1;
      const o = (i ? closes[i - 1] : c) / f, cc = c / f;
      days.get(dates[i]).bars[sym] = { o, h: Math.max(o, cc) * 1.001, l: Math.min(o, cc) * 0.999, c: cc, v: 1 };
    });
  }
  days.get(dates[splitIdx]).splits.push({ symbol: 'X', ratio: 2, id: 'split-X' });
  days.get(dates[splitIdx]).dividends.push({ symbol: 'X', exDate: dates[splitIdx], payDate: dates[32], amount: 0.5, id: 'div-X' });
  return { dates, days, syms: ['X', 'Y'] };
}
function m0Config(m) {
  const sh = sharedBlock();
  return { strategy: 'mechanism', version: 'test-M0', mechanism: 'M0', params: { down: 2, timeExit: 10, stopM: 2 }, filter: false, ...sh, period: { basket: 'A', warmupFrom: m.dates[0], start: m.dates[22], end: m.dates.at(-1) } };
}
// Runs the engine with `late` sessions (by index) and releases held exits after `releaseAfter` (index) with the
// fill session `fillAfter` (index), as the journal does after a catch-up recorded before the next open.
function runWith(m, { late = [], releaseAfter = null, fillAfter = null } = {}) {
  const config = m0Config(m);
  const e = createMechanismEngine2({ config, symbols: m.syms, halfSpreadBps: 2 });
  m.dates.forEach((d, i) => {
    e.processSession(d, m.days.get(d), { late: late.includes(i) });
    if (releaseAfter === i) e.releaseHeld({ fillAfter: m.dates[fillAfter], at: `${m.dates[i]}T22:00:00.000Z` });
  });
  return e.output();
}
const at = (m, i) => m.dates[i];

test('a late entry is skipped in this account (late_veto), and the next signal is taken from the account\'s actual state while the all-on-time account is blocked by its own position', () => {
  const m = m0Market();
  const shadow = runWith(m);
  const primary = runWith(m, { late: [26] });
  const entry = (out, i, sym) => out.decisions.find((d) => d.action === 'entry' && d.date === at(m, i) && d.symbol === sym);
  // All on time: X enters at the close of 26 (two down closes), fills at 27, and is held at 27, so its third down close gives no entry.
  assert.ok(entry(shadow, 26, 'X')); assert.equal(entry(shadow, 27, 'X'), undefined);
  assert.equal(shadow.fills.find((f) => f.side === 'buy' && f.symbol === 'X').date, at(m, 27));
  // Late 26: the signal is recorded as a late_veto skip and no order exists; at 27 the account is flat in X, so it enters there.
  assert.equal(entry(primary, 26, 'X'), undefined);
  const veto = primary.skips.find((s) => s.code === 'late_veto' && s.date === at(m, 26));
  assert.equal(veto.symbol, 'X'); assert.ok(veto.stop < veto.close);
  assert.ok(entry(primary, 27, 'X'), 'the later signal comes from the account\'s actual (flat) state');
  assert.equal(primary.fills.find((f) => f.side === 'buy' && f.symbol === 'X').date, at(m, 28));
  // Sizes come from the account's own cash: the late account's first X entry was sized on its own value at 27.
  assert.ok(Math.abs(entry(primary, 27, 'X').V - primary.equity.find((p) => p.date === at(m, 27)).equity) < 1e-9);
});

test('a late exit is held until its release: it keeps its cash, its split and its dividend, blocks another entry in the stock, and fills at the first open after the release', () => {
  const m = m0Market();
  const shadow = runWith(m);
  // Sessions 28 and 29 recorded late (one catch-up after the close of 30, before the next open): 30 is on time;
  // the held exit is released with fillAfter = 30, so it fills at the open of 31.
  const primary = runWith(m, { late: [28, 29], releaseAfter: 30, fillAfter: 30 });
  const exitDec = (out) => out.decisions.find((d) => d.action === 'exit' && d.symbol === 'X');
  assert.equal(exitDec(shadow).date, at(m, 28)); assert.equal(exitDec(shadow).late, undefined);
  assert.equal(exitDec(primary).date, at(m, 28)); assert.equal(exitDec(primary).late, true); assert.equal(exitDec(primary).held, true);
  const sellX = (out) => out.fills.filter((f) => f.side === 'sell' && f.symbol === 'X');
  assert.equal(sellX(shadow)[0].date, at(m, 29));
  assert.equal(sellX(primary)[0].date, at(m, 31)); assert.equal(sellX(primary)[0].lateExit, true);
  assert.equal(sellX(primary).filter((f) => f.date <= at(m, 30)).length, 0, 'no sale of X while the exit is held');
  // While held it blocks another entry in X: the all-on-time account (flat after 29) enters X at 30; the held account does not.
  assert.ok(shadow.decisions.find((d) => d.action === 'entry' && d.symbol === 'X' && d.date === at(m, 30)));
  assert.equal(primary.decisions.find((d) => d.action === 'entry' && d.symbol === 'X' && d.date === at(m, 30)), undefined);
  // The split at 30 doubles the held shares; the dividend entitled at 30 belongs to the held trade and is paid after its sale.
  const firstBuy = primary.fills.find((f) => f.side === 'buy' && f.symbol === 'X');
  assert.equal(primary.splits.find((s) => s.symbol === 'X').sharesAfter, firstBuy.shares * 2);
  assert.equal(shadow.splits.find((s) => s.symbol === 'X').sharesAfter, 0, 'the on-time account had sold before the split');
  const ent = primary.dividends.find((d) => d.kind === 'entitlement' && d.symbol === 'X');
  assert.equal(ent.date, at(m, 30)); assert.equal(ent.gross, firstBuy.shares * 2 * 0.5);
  assert.equal(shadow.dividends.find((d) => d.kind === 'entitlement' && d.symbol === 'X' && d.date === at(m, 30) && d.tradeId === `X:${at(m, 27)}`), undefined);
  const t = primary.trades.find((x) => x.symbol === 'X');
  assert.equal(t.lateExit, true); assert.equal(t.exitDecisionDate, at(m, 28)); assert.equal(t.exitDate, at(m, 31)); assert.equal(t.shares, firstBuy.shares * 2);
  assert.ok(primary.postExit.find((x) => x.tradeId === t.tradeId && x.kind === 'dividend' && x.date === at(m, 32)));
  // Its cash stays tied up: at 30 the cash available to the day's entries (share x signals) is smaller in the held
  // account, by about the held position's cost. (The on-time account shares its larger cash between two signals,
  // X and Y; the held account has only Y's, X being blocked.)
  const yDec = (out) => out.decisions.find((d) => d.action === 'entry' && d.symbol === 'Y' && d.date === at(m, 30));
  assert.ok(yDec(primary) && yDec(shadow));
  const avail = (d) => d.cashShare * d.signalsToday;
  assert.equal(yDec(primary).signalsToday, 1); assert.equal(yDec(shadow).signalsToday, 2);
  assert.ok(avail(yDec(primary)) < avail(yDec(shadow)) - 0.9 * firstBuy.cost, `available cash ${avail(yDec(primary))} held vs ${avail(yDec(shadow))} on time`);
  // The held position is marked to market at every close while held.
  for (const i of [28, 29, 30]) assert.equal(primary.equity.find((p) => p.date === at(m, i)).positions >= 1, true);
  // A release cannot predate the decision or the last processed session.
  const config = m0Config(m);
  const e = createMechanismEngine2({ config, symbols: m.syms, halfSpreadBps: 2 });
  m.dates.slice(0, 29).forEach((d, i) => e.processSession(d, m.days.get(d), { late: i === 28 }));
  assert.equal(e.held().length, 1);
  assert.throws(() => e.releaseHeld({ fillAfter: at(m, 27) }), /before the last processed session/);
  assert.throws(() => e.releaseHeld({ fillAfter: 'soon' }), /YYYY-MM-DD/);
  const rel = e.releaseHeld({ fillAfter: at(m, 28), at: 'x' });
  assert.deepEqual(rel.map((r) => r.symbol), ['X']); assert.equal(e.held().length, 0);
});

test('an unreleased held exit never fills, and the output marks it held; a late session with no position and no signal changes nothing', () => {
  const m = m0Market();
  const held = runWith(m, { late: [28] });
  assert.equal(held.fills.filter((f) => f.side === 'sell' && f.symbol === 'X').length, 0);
  assert.equal(held.pendingOrders.find((o) => o.symbol === 'X').held, true);
  const quiet = runWith(m, { late: [23] });
  assert.deepEqual(withoutEngineLabels(quiet), withoutEngineLabels(runWith(m)), 'session 23 has no position and no signal');
});
