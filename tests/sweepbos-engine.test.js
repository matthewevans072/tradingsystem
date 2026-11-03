// sweep-bos engine: whole sessions with hand-checked numbers (tests/sweepbos-fixtures.js), the data rules, the
// cutoff, one trade per session, the time stop on full and early-close sessions, costs on every fill, the mirror
// trade, the dollar account, no look-ahead, prefix invariance and determinism. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSymbol, STAGES } from '../server/sweepbos/engine.js';
import { tradingDays } from '../server/strategy/sessions.js';
import { buildMarket } from './sweepbos-fake-alpaca.js';
import { scenario, session, variant, bar, flat, LONG_DAY, FVG_DAY, SECOND_SWING_DAY, SHORT_DAY, RISING_DAILY, FALLING_DAILY } from './sweepbos-fixtures.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const run = (sc, v, extra = {}) => runSymbol({ symbol: 'QQQ', daily: sc.daily, sessions: sc.sessions, variant: v, window: { start: sc.testDate, end: sc.testDate }, ...extra });
const OB_A_OFF = variant('order_block', 'A_sweep_buffer', 'off'), FVG_A_OFF = variant('fair_value_gap', 'A_sweep_buffer', 'off');
const OB_B_OFF = variant('order_block', 'B_second_swing', 'off'), OB_A_ON = variant('order_block', 'A_sweep_buffer', 'on');

test('LONG_DAY, order block, stop A: every number by hand (sweep, BOS, zone, stop, target, fill, target exit, R, 2x R, mirror, account)', () => {
  const sc = scenario({ overrides: LONG_DAY });
  const r = run(sc, OB_A_OFF);
  assert.equal(r.sessionsInWindow, 1);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.dir, 'long');
  assert.equal(t.sweepIdx, 0);
  assert.equal(t.sweepExtreme, 99.5);
  assert.equal(t.bosIdx, 6);
  assert.equal(t.swingIdx, 2);
  assert.equal(t.swingLevel, 103);
  assert.deepEqual(t.zone, { type: 'order_block', index: 0, lo: 99.5, hi: 101.5 });
  assert.equal(t.buffer, 0.2);
  assert.equal(t.entry, 101.5);
  assert.equal(t.stop, 99.3);
  assert.equal(t.target, 110);
  close(t.risk, 2.2);
  assert.equal(t.fillIdx, 7);
  assert.equal(t.exitIdx, 9);
  assert.equal(t.exitPrice, 110);
  assert.equal(t.exitReason, 'target');
  assert.equal(t.sameBar, false);
  close(t.R, 84600 / 22000);
  close(t.R2x, 84200 / 22000);
  assert.equal(t.mirror.dir, 'short');
  assert.equal(t.mirror.stop, 103.7);
  assert.equal(t.mirror.target, 93);
  assert.equal(t.mirror.exitIdx, 8);
  assert.equal(t.mirror.exitReason, 'stop');
  close(t.mirror.R, -22400 / 22000);
  assert.equal(t.holdingMinutes, 15);
  assert.equal(t.barsHeld, 3);
  assert.deepEqual(t.hoursHeld, { 10: 3 });
  assert.equal(t.shares, 147, 'floor(15000 / 101.52)');
  close(t.pnl, 1243.62, 1e-6);
  close(r.account.endingCash, 16243.62, 1e-6);
  assert.equal(r.account.maxDrawdown, 0);
  assert.equal(r.stageCounts.filled, 1);
  assert.deepEqual(r.outcomeCounts, { stop: 0, stop_same_bar: 0, target: 1, time: 0 });
  assert.equal(r.sessions[0].stage, 'filled');
  // Stop B on the same day: no confirmed swing low at the BOS close.
  const b = run(sc, OB_B_OFF);
  assert.equal(b.trades.length, 0);
  assert.equal(b.sessions[0].stage, 'no_second_swing');
  // The fair value gap variant: no gap in this leg.
  assert.equal(run(sc, FVG_A_OFF).sessions[0].stage, 'no_zone');
});

test('FVG_DAY: the latest gap in the displacement leg, entry at its near edge', () => {
  const r = run(scenario({ overrides: FVG_DAY }), FVG_A_OFF);
  const t = r.trades[0];
  assert.deepEqual(t.zone, { type: 'fair_value_gap', index: 4, lo: 102.4, hi: 102.6 });
  assert.equal(t.entry, 102.6);
  assert.equal(t.stop, 99.3);
  close(t.risk, 3.3);
  assert.equal(t.fillIdx, 7);
  assert.equal(t.exitReason, 'target');
  close(t.R, ((110 - 0.02) - (102.6 + 0.02)) / 3.3);
  // The order-block variant on the same day still enters at bar 0's high.
  assert.equal(run(scenario({ overrides: FVG_DAY }), OB_A_OFF).trades[0].entry, 101.5);
});

test('SECOND_SWING_DAY, stop B: one cent beyond the second confirmed swing low; the time stop at the last open with costs', () => {
  const r = run(scenario({ overrides: SECOND_SWING_DAY }), OB_B_OFF);
  const t = r.trades[0];
  assert.equal(t.bosIdx, 9);
  assert.equal(t.swingIdx, 4);
  assert.equal(t.stopSwingIdx, 2);
  assert.equal(t.entry, 101.5);
  assert.equal(t.stop, 99.79);
  close(t.risk, 1.71);
  assert.equal(t.fillIdx, 10);
  assert.equal(t.exitIdx, 77);
  assert.equal(t.exitPrice, 104);
  assert.equal(t.exitReason, 'time');
  close(t.R, ((104 - 0.02) - (101.5 + 0.02)) / 1.71);
  assert.equal(t.holdingMinutes, 68 * 5);
  assert.equal(t.barsHeld, 68);
  assert.equal(Object.values(t.hoursHeld).reduce((a, b) => a + b, 0), 68);
  assert.equal(t.hoursHeld[15], 12, 'bars 66..77 start in the 15:00 hour');
  // Stop A on the same day: the buffer stop.
  const a = run(scenario({ overrides: SECOND_SWING_DAY }), OB_A_OFF).trades[0];
  assert.equal(a.stop, 99.3);
  close(a.risk, 2.2);
});

test('SHORT_DAY: the mirror rules; bias on refuses it under a long bias and takes it under a short bias', () => {
  const off = run(scenario({ overrides: SHORT_DAY }), OB_A_OFF);
  const t = off.trades[0];
  assert.equal(t.dir, 'short');
  assert.equal(t.sweepExtreme, 110.5);
  assert.equal(t.bosIdx, 6);
  assert.equal(t.swingLevel, 107);
  assert.deepEqual(t.zone, { type: 'order_block', index: 0, lo: 108.5, hi: 110.5 });
  assert.equal(t.entry, 108.5);
  assert.equal(t.stop, 110.7);
  assert.equal(t.target, 100);
  assert.equal(t.fillIdx, 7);
  assert.equal(t.exitIdx, 9);
  assert.equal(t.exitReason, 'target');
  close(t.R, 84600 / 22000);
  assert.equal(t.mirror.dir, 'long');
  assert.equal(t.mirror.stop, 106.3);
  assert.equal(t.mirror.target, 117);
  assert.equal(t.shares, Math.floor(15000 / 108.5));
  const longBias = run(scenario({ overrides: SHORT_DAY, dailyHL: RISING_DAILY }), OB_A_ON);
  assert.equal(longBias.trades.length, 0);
  assert.equal(longBias.sessions[0].bias, 'long');
  assert.equal(longBias.sessions[0].stage, 'no_sweep', 'a short sweep under a long bias is not a setup');
  const shortBias = run(scenario({ overrides: SHORT_DAY, dailyHL: FALLING_DAILY }), OB_A_ON);
  assert.equal(shortBias.sessions[0].bias, 'short');
  assert.equal(shortBias.trades.length, 1);
  assert.equal(shortBias.trades[0].bias, 'short');
  const longDayLongBias = run(scenario({ overrides: LONG_DAY, dailyHL: RISING_DAILY }), OB_A_ON);
  assert.equal(longDayLongBias.trades.length, 1);
  // No bias (flat daily bars give no two confirmed swings): no trade.
  const none = run(scenario({ overrides: LONG_DAY }), OB_A_ON);
  assert.equal(none.sessions[0].stage, 'no_bias');
});

test('sweeps: wick-only (closed beyond) is no setup; a both-sides bar is skipped; a close back beyond the level voids the setup; the window ends at bar 5', () => {
  const noClose = run(scenario({ overrides: { ...LONG_DAY, 0: bar(101, 101.5, 99.5, 99.8) } }), OB_A_OFF);
  assert.equal(noClose.sessions[0].stage, 'no_sweep');
  assert.equal(noClose.sessions[0].ambiguousSweepBars, 0);
  const both = run(scenario({ overrides: { ...LONG_DAY, 0: bar(105, 110.5, 99.5, 105) } }), OB_A_OFF);
  assert.equal(both.sessions[0].stage, 'no_sweep');
  assert.equal(both.sessions[0].ambiguousSweepBars, 1);
  // Bar 1 closes below PDL: the setup is voided; nothing later sweeps again; no BOS can be credited to the voided setup.
  const voided = run(scenario({ overrides: { ...LONG_DAY, 1: bar(100.5, 101, 99.4, 99.8) } }), OB_A_OFF);
  assert.equal(voided.sessions[0].stage, 'sweep_invalidated');
  assert.equal(voided.trades.length, 0);
  // The sweep at bar 6 (10:00) is outside the window.
  const late = {};
  for (const [k, v] of Object.entries(LONG_DAY)) late[Number(k) + 6] = v;
  const outside = run(scenario({ overrides: late }), OB_A_OFF);
  assert.equal(outside.sessions[0].stage, 'no_sweep');
  // A sweep at bar 5 (09:55) is inside the window; its BOS at bar 11 places an order that can never fill.
  const atFive = {};
  for (const [k, v] of Object.entries(LONG_DAY)) atFive[Number(k) + 5] = v;
  const r5 = run(scenario({ overrides: atFive }), OB_A_OFF);
  assert.equal(r5.sessions[0].sweepIdx, 5);
  assert.equal(r5.sessions[0].bosIdx, 11);
  assert.equal(r5.sessions[0].stage, 'order_expired');
});

test('no trade after 10:30: a fill on the 10:25 bar is the last allowed; the 10:30 bar never fills; an order placed at 10:25 expires', () => {
  const shifted = {};
  for (const [k, v] of Object.entries(LONG_DAY)) shifted[Number(k) + 4] = v; // sweep at 4, BOS at 10, fill bar 11
  const r = run(scenario({ overrides: shifted }), OB_A_OFF);
  assert.equal(r.sessions[0].bosIdx, 10);
  assert.equal(r.trades[0].fillIdx, 11);
  // The same day but bar 11 does not trade through; bar 12 does: no fill.
  const twelve = { ...shifted, 11: bar(103.2, 103.4, 101.6, 102), 12: bar(102, 102.2, 101, 101.5) };
  const r2 = run(scenario({ overrides: twelve }), OB_A_OFF);
  assert.equal(r2.sessions[0].stage, 'order_expired');
  assert.equal(r2.trades.length, 0);
});

test('fills and exits: a touch of the limit is no fill; the stop on the fill bar; stop first; gap-through stop; the order block must be below the BOS close', () => {
  const touch = run(scenario({ overrides: { ...LONG_DAY, 7: bar(103.2, 103.4, 101.5, 102), 8: bar(102, 103, 101.6, 102.5), 9: bar(102.5, 103, 102, 102.8), 10: bar(102.8, 103, 102.2, 102.6), 11: bar(102.6, 103, 102.1, 102.7) } }), OB_A_OFF);
  assert.equal(touch.sessions[0].stage, 'order_expired');
  const sameBar = run(scenario({ overrides: { ...LONG_DAY, 7: bar(103.2, 103.4, 99.0, 102) } }), OB_A_OFF);
  assert.equal(sameBar.trades[0].exitReason, 'stop');
  assert.equal(sameBar.trades[0].sameBar, true);
  assert.equal(sameBar.trades[0].exitPrice, 99.3);
  assert.equal(sameBar.outcomeCounts.stop_same_bar, 1);
  close(sameBar.trades[0].R, -22400 / 22000);
  const ambiguous = run(scenario({ overrides: { ...LONG_DAY, 8: bar(102, 110.5, 99.2, 103.5) } }), OB_A_OFF);
  assert.equal(ambiguous.trades[0].exitReason, 'stop');
  assert.equal(ambiguous.trades[0].exitIdx, 8);
  assert.equal(ambiguous.trades[0].exitPrice, 99.3);
  const gap = run(scenario({ overrides: { ...LONG_DAY, 8: bar(99, 99.5, 98.5, 99.2) } }), OB_A_OFF);
  assert.equal(gap.trades[0].exitPrice, 99);
  close(gap.trades[0].R, ((99 - 0.02) - (101.5 + 0.02)) / 2.2);
  // A bearish bar 0 whose high is above the BOS close: the entry is not inside the close.
  const above = run(scenario({ overrides: { ...LONG_DAY, 0: bar(103.4, 103.6, 99.5, 100.5) } }), OB_A_OFF);
  assert.equal(above.sessions[0].stage, 'entry_not_inside_close');
  // Target too close: PDH only 1.5 above the entry with a 2.2 risk.
  const tight = run(scenario({ overrides: LONG_DAY, priorDaily: { h: 103, l: 100 } }), OB_A_OFF);
  assert.equal(tight.sessions[0].stage, 'target_too_close');
  // A target exactly one risk away is allowed (>=).
  const exact = run(scenario({ overrides: { ...LONG_DAY, 9: bar(103.5, 104, 103, 103.8) }, priorDaily: { h: 103.7, l: 100 } }), OB_A_OFF);
  assert.equal(exact.sessions[0].stage, 'filled');
  assert.equal(exact.trades[0].exitReason, 'target');
});

test('the data rules: an incomplete session, a missing prior session or daily bar, and fewer than 20 complete sessions for the buffer', () => {
  const sc = scenario({ overrides: LONG_DAY });
  const incomplete = structuredClone(sc);
  incomplete.sessions[incomplete.sessions.length - 1].bars.pop();
  assert.equal(run(incomplete, OB_A_OFF).sessions[0].stage, 'incomplete_session');
  const priorIncomplete = structuredClone(sc);
  priorIncomplete.sessions[priorIncomplete.sessions.length - 2].bars.splice(30, 1);
  assert.equal(run(priorIncomplete, OB_A_OFF).sessions[0].stage, 'no_prior_session');
  const noDaily = structuredClone(sc);
  noDaily.daily.pop();
  assert.equal(run(noDaily, OB_A_OFF).sessions[0].stage, 'no_prior_session');
  const few = scenario({ overrides: LONG_DAY, priorCount: 20 }); // 19 complete sessions before the prior one: 20 in total, fine
  assert.equal(run(few, OB_A_OFF).sessions[0].stage, 'filled');
  const fewer = scenario({ overrides: LONG_DAY, priorCount: 19 });
  assert.equal(run(fewer, OB_A_OFF).sessions[0].stage, 'no_buffer');
  assert.equal(run(fewer, OB_B_OFF).sessions[0].stage, 'no_second_swing', 'stop B needs no buffer');
  // An incomplete session among the 20 is skipped, not counted: 21 prior with one incomplete still gives 20.
  const skip = structuredClone(sc);
  skip.sessions[3].bars.splice(50, 1);
  assert.equal(run(skip, OB_A_OFF).sessions[0].stage, 'filled');
  const skip2 = structuredClone(scenario({ overrides: LONG_DAY, priorCount: 20 }));
  skip2.sessions[3].bars.splice(50, 1);
  assert.equal(run(skip2, OB_A_OFF).sessions[0].stage, 'no_buffer');
});

test('early close: 42 bars, the time stop at the 12:55 open; one trade per session and no re-entry', () => {
  const sc = scenario({ overrides: { ...LONG_DAY, 8: bar(102, 103, 101.6, 102.5), 9: bar(102.5, 103, 102, 102.8) }, startDate: '2019-10-30' });
  assert.equal(sc.testDate, '2019-11-29');
  assert.equal(sc.sessions[sc.sessions.length - 1].full, 42);
  const r = run(sc, OB_A_OFF);
  const t = r.trades[0];
  assert.equal(t.exitReason, 'time');
  assert.equal(t.exitIdx, 41);
  assert.equal(t.exitPrice, 104);
  // After a stop, a later dip through the order block does not re-enter: one trade per session.
  const again = run(scenario({ overrides: { ...LONG_DAY, 8: bar(102, 102.5, 99.2, 102), 9: bar(102, 103, 101, 102.5), 10: bar(102.5, 103, 101.2, 102.8), 11: bar(102.8, 103.5, 101.3, 103.2) } }), OB_A_OFF);
  assert.equal(again.trades.length, 1);
  assert.equal(again.trades[0].exitReason, 'stop');
  assert.equal(again.stageCounts.filled, 1);
});

test('costs on every fill: the 2x sensitivity is derived from the same fills, and a zero-cost run differs by exactly 2c / risk', () => {
  const sc = scenario({ overrides: LONG_DAY });
  const a = run(sc, OB_A_OFF).trades[0], z = run(sc, OB_A_OFF, { costPerSide: 0 }).trades[0];
  close(z.R - a.R, 0.04 / 2.2);
  close(a.R - a.R2x, 0.04 / 2.2);
  close(z.mirror.R - a.mirror.R, 0.04 / 2.2);
  assert.equal(z.shares, Math.floor(15000 / 101.5));
});

test('a swing confirmed at the BOS bar itself is not structure: bar 5 closing above the swing at 2 gives no BOS at 5, and breaks that swing for later bars', () => {
  // Bar 5 (high 103.6, close 103.3) closes above the swing high at 2 while that swing is confirmed only at this
  // close: no BOS at 5. From bar 6 on the swing at 2 is already broken; the new swing high at 5 (103.6) is
  // confirmed at 8, and bar 9 (close 109) is the first close above it: BOS at 9, order at 101.5, which bars 10
  // and 11 (flat around 104) never fill.
  const r = run(scenario({ overrides: { ...LONG_DAY, 5: bar(101.7, 103.6, 101.2, 103.3) } }), OB_A_OFF);
  assert.equal(r.sessions[0].bosIdx, 9);
  assert.equal(r.sessions[0].swingIdx, 5);
  assert.equal(r.sessions[0].stage, 'order_expired');
  assert.equal(r.trades.length, 0);
});

test('the sweep extreme follows the lowest low before the BOS and moves the leg start, the order block and the stop', () => {
  // Bar 3 dips to 99.2 (below the sweep bar's 99.5) and still closes above PDL: extreme 99.2, leg start 3,
  // order block = bar 3 (bearish, high 102.8), stop A = 99.2 - 0.20 = 99.00, risk 3.80, target 110 (7.2 >= 3.8).
  const r = run(scenario({ overrides: { ...LONG_DAY, 3: bar(102.5, 102.8, 99.2, 102) } }), OB_A_OFF);
  const t = r.trades[0];
  assert.equal(t.sweepExtreme, 99.2);
  assert.equal(t.legExtremeIdx, 3);
  assert.deepEqual(t.zone, { type: 'order_block', index: 3, lo: 99.2, hi: 102.8 });
  assert.equal(t.entry, 102.8);
  assert.equal(t.stop, 99);
  close(t.risk, 3.8);
  assert.equal(t.fillIdx, 7);
});

test('no look-ahead: changing bars after the decision leaves every decision up to it unchanged; later sessions never affect earlier ones', () => {
  const sc = scenario({ overrides: LONG_DAY });
  const base = run(sc, OB_A_OFF);
  // Bars after the fill bar (index 8 onwards) changed wildly: sweep, BOS, zone, stop, target and fill unchanged; only the exit moves.
  const after = structuredClone(sc);
  const last = after.sessions[after.sessions.length - 1];
  for (const b of last.bars) if (b.idx >= 8) Object.assign(b, bar(50, 400, 10, 60));
  const r = run(after, OB_A_OFF);
  const keys = ['dir', 'sweepIdx', 'sweepExtreme', 'bosIdx', 'swingIdx', 'swingLevel', 'zone', 'entry', 'stop', 'target', 'risk', 'fillIdx', 'buffer'];
  for (const k of keys) assert.deepEqual(r.trades[0][k], base.trades[0][k], k);
  assert.notEqual(r.trades[0].exitPrice, base.trades[0].exitPrice);
  // Bars after the BOS close (index 7 onwards) changed so that nothing fills: the order itself is the same.
  const unfilled = structuredClone(sc);
  for (const b of unfilled.sessions[unfilled.sessions.length - 1].bars) if (b.idx >= 7) Object.assign(b, flat(104, 0.2));
  const u = run(unfilled, OB_A_OFF);
  assert.equal(u.sessions[0].stage, 'order_expired');
  assert.equal(u.sessions[0].entry, base.trades[0].entry);
  assert.equal(u.sessions[0].stop, base.trades[0].stop);
  // A later session appended, with any content, leaves the earlier session's record identical.
  const more = structuredClone(sc);
  const days = tradingDays(sc.testDate, '2019-12-31').slice(1, 4);
  for (const d of days) { more.sessions.push(session(d, { overrides: LONG_DAY })); more.daily.push({ date: d, o: 1, h: 999, l: 0.5, c: 1 }); }
  more.daily.push({ date: sc.testDate, o: 104, h: 104.5, l: 103.5, c: 104 });
  const m = runSymbol({ symbol: 'QQQ', daily: more.daily, sessions: more.sessions, variant: OB_A_OFF, window: { start: sc.testDate, end: days[2] } });
  assert.deepEqual(m.sessions[0], base.sessions[0]);
  assert.deepEqual(m.trades[0], base.trades[0]);
});

test('prefix invariance and determinism on a synthetic market', () => {
  const market = buildMarket({ symbols: ['QQQ'], from: '2019-01-02', to: '2019-09-30', extended: false, seed: 3 });
  const sessions = [...market.QQQ.sessions].map(([date, bars]) => ({ date, full: bars.length, bars: bars.map((b, i) => ({ idx: i, o: b.o, h: b.h, l: b.l, c: b.c })) }));
  const daily = [...market.QQQ.daily].map(([date, d]) => ({ date, ...d }));
  const v = variant('order_block', 'A_sweep_buffer', 'off');
  const full = runSymbol({ symbol: 'QQQ', daily, sessions, variant: v, window: { start: '2019-02-01', end: '2019-09-30' } });
  const again = runSymbol({ symbol: 'QQQ', daily, sessions, variant: v, window: { start: '2019-02-01', end: '2019-09-30' } });
  assert.equal(JSON.stringify(again), JSON.stringify(full), 'deterministic');
  assert.equal(full.sessions.length, 167);
  assert.ok(STAGES.includes(full.sessions[0].stage));
  assert.equal(Object.values(full.stageCounts).reduce((a, b) => a + b, 0), full.sessionsInWindow);
  const cut = '2019-06-28';
  const prefix = runSymbol({ symbol: 'QQQ', daily: daily.filter((d) => d.date <= cut), sessions: sessions.filter((s) => s.date <= cut), variant: v, window: { start: '2019-02-01', end: cut } });
  assert.deepEqual(prefix.sessions, full.sessions.filter((s) => s.session <= cut));
  assert.deepEqual(prefix.trades, full.trades.filter((t) => t.session <= cut));
  // The bias variant on the same market: also deterministic and prefix-invariant.
  const vb = variant('fair_value_gap', 'B_second_swing', 'on');
  const fb = runSymbol({ symbol: 'QQQ', daily, sessions, variant: vb, window: { start: '2019-02-01', end: '2019-09-30' } });
  const pb = runSymbol({ symbol: 'QQQ', daily: daily.filter((d) => d.date <= cut), sessions: sessions.filter((s) => s.date <= cut), variant: vb, window: { start: '2019-02-01', end: cut } });
  assert.deepEqual(pb.sessions, fb.sessions.filter((s) => s.session <= cut));
});
