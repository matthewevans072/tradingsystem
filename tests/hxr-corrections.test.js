// HXR pre-run implementation corrections (strategy/hxr/EXPERIMENT-LOG.md entry
// 13, results seen: no). One regression test per engine correction:
// 1. the initial-loss level L0 follows a split;
// 2. a sized buy waiting to fill on a split session moves to post-split units;
// 3. open risk uses every holding's exit level at this close, whatever the
//    ticker order;
// 4. option C counts its sessions out from the sale;
// 5. a lapsed or cancelled buy-back keeps the buy-back rule.
// Synthetic prices only test code; nothing here is market data or a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHxrConfig } from '../server/hxr/config.js';
import { runBacktest, periodSessions } from '../server/hxr/engine.js';
import { computeRunMetrics } from '../server/hxr/metrics.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const near = (a, b, msg = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const K = (2 + 2) / 10000; // half-spread 2 bps (a fixed number) + 2 bps slippage
const X1A = loadHxrConfig('hxr-x1a-0.3.0.json'), X1B = loadHxrConfig('hxr-x1b-0.3.0.json'), X1C = loadHxrConfig('hxr-x1c-0.3.0.json');

// Small rule windows for hand checks; the budgets stay pre-registered unless overridden.
function small(base, { rule = {}, risk = {}, execution = {} } = {}) {
  const c = clone(base);
  c.rule = { ...c.rule, volSessions: 2, pivotSessions: 2, ...rule };
  c.risk = { ...c.risk, ...risk };
  c.execution = { ...c.execution, ...execution };
  return c;
}
// Rows of [open, close] per symbol from 2024-01-02 (null = no bar); splits as
// { sessionIndex: [{ symbol, ratio }] }. The period starts after 25 warm-up sessions.
function run(config, paths, { splits = {}, listed = {} } = {}) {
  const n = Math.max(...Object.values(paths).map((r) => r.length));
  const sessions = periodSessions({ warmupFrom: '2024-01-02', end: '2024-12-31' }).slice(0, n);
  const days = new Map(sessions.map((d, i) => [d, {
    bars: Object.fromEntries(Object.entries(paths).filter(([, rows]) => rows[i] != null).map(([s, rows]) => { const [o, c] = rows[i]; return [s, { o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 }]; })),
    splits: (splits[i] || []).map((x, k) => ({ id: `sp-${i}-${k}`, ...x })), dividends: [],
  }]));
  const symbols = Object.keys(paths).map((s) => ({ symbol: s, exchange: 'NASDAQ', listedFrom: listed[s] ?? '2016-01-04', techAi: true }));
  const r = runBacktest({ config, symbols, period: { warmupFrom: sessions[0], start: sessions[25], end: sessions.at(-1) }, inputs: { sessions, days, halfSpreadBps: 2 } });
  return { ...r, sessions, at: (i) => sessions[i] };
}
// Warm-up closes alternating 100, 101, ... so that m = 1 at the last warm-up close (100).
const WARM = Array.from({ length: 25 }, (_, i) => (i % 2 ? 101 : 100));
const flat = (closes) => closes.map((c, i) => [i ? closes[i - 1] : c, c]);
const point = (r, i) => r.equity.find((p) => p.date === r.at(i));

test('correction 1: the initial-loss level is divided by a split ratio like every other price', () => {
  // Bought 30 shares at 100 x (1 + K); L0 = 100.04 - 2.5 = 97.54. A 2-for-1 split on session 27:
  // L0 becomes 48.77, so a post-split close of 49 (above L0 / 2, far below the old L0) must not sell.
  const rows = [...flat(WARM), [100, 101], [101, 102], [51, 51.5], [51.5, 49], [49, 49.2]];
  const r = run(small(X1B), { AAA: rows }, { splits: { 27: [{ symbol: 'AAA', ratio: 2 }] } });
  const L0 = 100 * (1 + K) - 2.5;
  assert.equal(r.fills.filter((f) => f.side === 'sell').length, 0, 'no exit: 49 is above the split-adjusted level');
  assert.equal(r.decisions.filter((d) => d.side === 'sell').length, 0);
  near(point(r, 26).sleeves.AAA.level, L0, 'before the split');
  near(point(r, 27).sleeves.AAA.level, L0 / 2, 'the equity point\'s level halves');
  near(point(r, 28).sleeves.AAA.openRisk, 60 * (49 - L0 / 2), 'open risk in post-split units');
  const sl = r.sleeves.find((s) => s.symbol === 'AAA');
  near(sl.initialLossLevel, L0 / 2);
  near(sl.plannedLoss, 75, 'planned loss is dollars and stays');
  assert.equal(sl.shares, 60);
});

test('correction 2: a sized buy that fills on a split session moves to post-split shares and distance (forward and reverse)', () => {
  // Sized at the last warm-up close (100, m = 1, d = 2.5): 30 shares (the US$3,000 position cap).
  // The split takes effect on the fill session (25).
  for (const [ratio, open] of [[2, 50], [0.5, 200]]) {
    const rows = [...flat(WARM), [open, open * 1.01], [open * 1.01, open * 1.02]];
    const r = run(small(X1B), { AAA: rows }, { splits: { 25: [{ symbol: 'AAA', ratio }] } });
    const dec = r.decisions.find((d) => d.action === 'initial_allocation');
    assert.equal(dec.sizing.shares, 30, 'sized before the split');
    const buy = r.fills.find((f) => f.initial);
    assert.equal(buy.shares, Math.floor(30 * ratio), `${ratio}: shares move to post-split units`);
    near(buy.sizing.d, 2.5 / ratio, `${ratio}: d in post-split units`);
    near(buy.sizing.close, 100 / ratio);
    near(buy.initialLossLevel, open * (1 + K) - 2.5 / ratio, `${ratio}: L0 from the post-split distance`);
    near(buy.plannedLoss, Math.floor(30 * ratio) * 2.5 / ratio, `${ratio}: planned loss in dollars unchanged`);
    near(buy.sizing.reserveCash, dec.sizing.reserveCash, 'the reserved cash stays');
    assert.ok(r.warnings.some((w) => w.code === 'order_split_adjusted' && w.details.sharesBefore === 30 && w.details.sharesAfter === Math.floor(30 * ratio)));
  }
  // A reverse split that leaves no whole share cancels the order; the stock then waits as never held.
  const rows = [...flat(WARM), [1000, 1010], [1010, 1020]];
  const r = run(small(X1B, { risk: { maxPositionUsd: 150, minPositionFractionOfPlannedLoss: 0 } }), { AAA: rows }, { splits: { 25: [{ symbol: 'AAA', ratio: 0.1 }] } });
  assert.equal(r.fills.length, 0);
  assert.ok(r.warnings.some((w) => w.code === 'order_cancelled' && w.details.code === 'split'));
  assert.equal(r.sleeves[0].fresh?.afterMissedRebound, false);
});

// Correction 3: the holder's first recovery point (close 100 at session 27) is confirmed at the close
// of session 29, raising its X1 level to 100 - 0.5 x 1.5 = 99.25, above L0 = 97.54. On the same close
// the other stock (never held: no warm-up bars) gets a fresh entry and is sized against the open risk.
const HOLDER = [...flat(WARM), [100, 101], [101, 102], [102, 100], [100, 102], [102, 103], [103, 103.5]];
const BUYER = [...WARM.map(() => null), [51, 51], [51, 52], [52, 50], [50, 52], [52, 53], [53, 53.5]];
test('correction 3: open risk uses each holding\'s exit level at this close, whatever the ticker order', () => {
  const level = 100 - 0.5 * 1.5, L0 = 100 * (1 + K) - 2.5;
  const results = [['AAA', 'ZZZ'], ['ZZZ', 'AAA']].map(([buyer, holder]) => {
    const r = run(small(X1B), { [buyer]: BUYER, [holder]: HOLDER }, { listed: { [buyer]: '2024-02-07' } });
    const fresh = r.decisions.find((d) => d.symbol === buyer && d.action === 'fresh_entry');
    assert.ok(fresh, `${buyer} enters`);
    assert.equal(fresh.date, r.at(29));
    const p = point(r, 29);
    near(p.sleeves[holder].level, level, `${holder}'s level at the close it was raised`);
    near(fresh.sizing.openRiskNow, 30 * (103 - level), `${buyer} (buyer) is sized against ${holder}'s raised level, not L0 ${L0}`);
    near(p.openRisk, 30 * (103 - level), 'the equity point too');
    return { shares: fresh.sizing.shares, openRisk: fresh.sizing.openRiskNow, caps: fresh.sizing.caps, point: p.openRisk };
  });
  assert.deepEqual(results[0], results[1], 'the same numbers whichever ticker comes first');
});

test('correction 4: option C counts its sessions out from the sale (61 out = 59 since the missed rebound: enters)', () => {
  // Initial-loss sale decided at session 26 (close 97 < 97.54), filled at session 27's open; the rebound is
  // missed at session 28 (close 97.5 >= the sale price); then a steady rise and a recovery point (session 85)
  // confirmed at session 87: 61 sessions out counted from the sale, 59 since the missed rebound.
  const rise = Array.from({ length: 56 }, (_, k) => +(97.6 + 0.1 * k).toFixed(2)); // sessions 29-84
  const x = rise.at(-2); // session 83
  const closes = [...WARM, 101, 97, 96.5, 97.5, ...rise, x - 1, x + 0.5, x + 1, x + 1.2];
  // No position cap, so the minimum-position rule never decides this case.
  const r = run(small(X1C, { risk: { maxPositionUsd: 1e6 } }), { AAA: flat(closes) });
  const sale = r.fills.find((f) => f.side === 'sell');
  assert.equal(sale.date, r.at(27));
  const missed = r.warnings.find((w) => w.code === 'rebound_missed');
  assert.equal(missed.date, r.at(28));
  assert.equal(missed.details.policy, 'fresh_entry_after_sessions');
  const fresh = r.decisions.find((d) => d.action === 'fresh_entry');
  assert.ok(fresh, 'enters: 61 sessions out is at least 60');
  assert.equal(fresh.date, r.at(87));
  assert.equal(fresh.values.sessionsOut, 61);
  assert.equal(fresh.values.sessionsSinceMissedRebound, 59);
  assert.deepEqual([r.freshEntries[0].sessionsOut, r.freshEntries[0].sessionsSinceMissedRebound, r.freshEntries[0].afterMissedRebound], [61, 59, true], 'the journal reports completed sessions since the sale at the fill (the next open)');
  // One session fewer out: no entry at that recovery point.
  const shorter = run(small(X1C, { rule: { freshEntryMinSessions: 62 }, risk: { maxPositionUsd: 1e6 } }), { AAA: flat(closes) });
  assert.equal(shorter.decisions.filter((d) => d.action === 'fresh_entry').length, 0);
});

test('correction 5: a buy-back cancelled at the fill (paused, two-session delay) keeps the buy-back rule; policy A still retires', () => {
  // AAA: initial-loss sale decided at 26, filled at 28; a recovery point (94 at session 30) below the sale price
  // confirmed at 32 gives a buy-back for session 34. BBB falls at 33: the account is US$200 or more below its
  // peak, so the account is paused at that close and the buy-back is cancelled at 34. AAA then closes above the
  // sale price at 35: the rebound is missed and policy A keeps it in cash for good (no entry at any price).
  // A lower minimum position so the buy-back (31 shares at d = 1.875, the US$3,000 cap) is not skipped at the decision.
  const risk = { pauseDeclineUsd: 200, resumeDeclineUsd: 100, minPositionFractionOfPlannedLoss: 0.3 };
  const cfg = small(X1A, { risk, execution: { delaySessions: 2 } });
  const aaa = flat([...WARM, 101, 97, 96.8, 96, 95, 94, 95, 95.5, 95.6, 96.5, 97.5, 99, 97, 98, 99, 100]);
  const bbb = flat([...WARM, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 92, 92, 92, 92, 92, 92, 92, 92]);
  const r = run(cfg, { AAA: aaa, BBB: bbb });
  const sale = r.fills.find((f) => f.symbol === 'AAA' && f.side === 'sell');
  assert.equal(sale.date, r.at(28));
  const bb = r.decisions.find((d) => d.symbol === 'AAA' && d.action === 'buy_back');
  assert.equal(bb.date, r.at(32));
  assert.equal(r.warnings.find((w) => w.code === 'pause_start').date, r.at(33));
  const cancel = r.warnings.find((w) => w.symbol === 'AAA' && w.code === 'order_cancelled');
  assert.deepEqual([cancel.date, cancel.details.code], [r.at(34), 'paused']);
  const missed = r.warnings.find((w) => w.symbol === 'AAA' && w.code === 'rebound_missed');
  assert.ok(missed, 'still in buy-back mode: the missed rebound is judged');
  assert.equal(missed.date, r.at(35));
  assert.equal(missed.details.policy, 'stay_out');
  const sl = r.sleeves.find((s) => s.symbol === 'AAA');
  assert.deepEqual([sl.retired, sl.fresh], [true, null], 'policy A: retired, never switched to an entry at any price');
  assert.equal(r.fills.filter((f) => f.symbol === 'AAA' && f.side === 'buy' && !f.initial).length, 0);
  assert.equal(r.decisions.filter((d) => d.symbol === 'AAA' && d.action === 'fresh_entry').length, 0);
  // Under policy B the same cancellation also keeps the buy-back rule; the missed rebound then starts fresh-entry mode.
  const b = run(small(X1B, { risk, execution: { delaySessions: 2 } }), { AAA: aaa, BBB: bbb });
  const mb = b.warnings.find((w) => w.symbol === 'AAA' && w.code === 'rebound_missed');
  assert.deepEqual([mb?.date, mb?.details.policy], [b.at(35), 'fresh_entry_recovery_point']);
});

test('report items (correction 12): never-entered waits, buy-backs against the sale price, pause episodes', () => {
  // The never-held stock of the reverse-split case waits from the first session to the end.
  const rows = [...flat(WARM), [1000, 1010], [1010, 1020], [1020, 1030]];
  const r = run(small(X1B, { risk: { maxPositionUsd: 150, minPositionFractionOfPlannedLoss: 0 } }), { AAA: rows }, { splits: { 25: [{ symbol: 'AAA', ratio: 0.1 }] } });
  assert.deepEqual(computeRunMetrics(r).neverEnteredWaits, [{ symbol: 'AAA', waitingSince: r.at(25), sessionsWaited: 3, retired: false }]);
  // A buy-back 1.5% below the sale price; the pause of correction 5 with its dates, depth and length.
  const risk = { pauseDeclineUsd: 200, resumeDeclineUsd: 100, minPositionFractionOfPlannedLoss: 0.3 };
  const aaa = flat([...WARM, 101, 97, 96.8, 96, 95, 94, 95, 95.5, 95.6, 96.5, 97.5, 99, 97, 98, 99, 100]);
  const bbb = flat([...WARM, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 92, 92, 92, 92, 92, 92, 92, 92]);
  const p = run(small(X1A, { risk, execution: { delaySessions: 2 } }), { AAA: aaa, BBB: bbb });
  const m = computeRunMetrics(p);
  assert.equal(m.pauses.count, 1);
  const e = m.pauses.episodes[0];
  assert.deepEqual([e.from, e.to, e.sessions], [p.at(33), null, p.sessions.length - 33], 'still paused at the end');
  near(e.deepest, Math.max(...p.equity.filter((x) => x.paused).map((x) => x.peak - x.equity)));
  const b = run(small(X1B, { risk: { maxPositionUsd: 1e6 } }), { AAA: flat([...WARM, 101, 97, 96.8, 96, 95, 94, 95, 95.5, 95.6, 95.7, 95.8]) });
  const rt = b.roundTrips[0];
  assert.ok(rt, 'a completed buy-back');
  near(computeRunMetrics(b).buyBacks.avgChangeFromSalePct, rt.changePct);
  assert.ok(rt.changePct < 0, 'bought back below the sale price');
});

test('reporting (entry 19): a buy skipped because open risk is already above the budget records openRisk as binding', () => {
  // ZZZ is held from day one: asks min(40 / 2, 150) = 20 of planned loss at d = 2.5, so 8 shares; L0 = 100.04 - 2.5.
  // It rises without a recovery point, so its level stays L0 and its open risk grows: 8 x (109 - 97.54) = 91.68 > 40.
  // AAA (never held: no warm-up bars) gets a fresh-entry signal at session 29; its open-risk room is negative.
  const holder = [...flat(WARM), [100, 101], [101, 103], [103, 105], [105, 107], [107, 109], [109, 110]];
  const r = run(small(X1B, { risk: { totalOpenRiskUsd: 40 } }), { AAA: BUYER, ZZZ: holder }, { listed: { AAA: '2024-02-07' } });
  near(point(r, 29).openRisk, 8 * (109 - (100 * (1 + K) - 2.5)), 'open risk above the budget');
  const w = r.warnings.find((x) => x.symbol === 'AAA' && x.code === 'entry_skipped' && x.date === r.at(29));
  assert.ok(w, 'the fresh entry is skipped');
  assert.ok(w.details.sizing.caps.openRisk < 0, 'the stored open-risk cap is below zero');
  assert.deepEqual(w.details.sizing.binding, ['openRisk'], 'the cap below zero is recorded as binding');
  assert.match(w.message, /no whole share fits the budgets \(openRisk binding\)/);
});
