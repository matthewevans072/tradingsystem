// prop-sim (strategy/prop-sim/CAMPAIGN-1.md): synthetic data only. The store's guard and bound; the levels and the
// 5-minute bars; the market structure shift and the mirror for shorts; every family on built sessions; fills and exits
// (strictly through, slippage, stop before target, time exit); no look-ahead; the account rules at their exact limits
// (end-of-day trailing and lock, the breach at the worst point, consistency, LucidPro's daily loss limit, both payout
// rules); sizing; determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { tradingDays } from '../server/strategy/sessions.js';
import * as store from '../server/propsim/store.js';
import { buildMarket } from '../server/propsim/market.js';
import { runSignals, randomTwin, execute, isShift, mirrorBars } from '../server/propsim/signals.js';
import { contractsFor, applyTrade, runAttempts } from '../server/propsim/account.js';
import { bosAt, downwardBosAt } from '../server/ictlab/rules.js';
import { mulberry32 } from '../server/research/runner.js';
import { loadMatrix } from '../server/propsim/config.js';

const M = loadMatrix();
const sessions = tradingDays('2019-03-04', '2019-03-29', 'NYSE');
// One session from 5-minute bar specs {o,h,l,c}: the first minute carries the bar's range, the other four sit at the close.
function rowsFor(date, bars5) {
  const rows = [];
  for (let k = 0; k < 78; k++) {
    const b = bars5[k] ?? bars5.flat ?? { o: 1000, h: 1000, l: 1000, c: 1000 };
    const base = 570 + k * 5;
    rows.push({ date, minute: base, o: b.o, h: b.h, l: b.l, c: b.c, v: 100 });
    for (let j = 1; j < 5; j++) rows.push({ date, minute: base + j, o: b.c, h: b.c, l: b.c, c: b.c, v: 100 });
  }
  return rows;
}
const flatDay = (date, o = 1000, h = 1010, l = 990) => rowsFor(date, { flat: { o, h, l, c: o } });
const mk = (rows) => buildMarket(rows, { ratio: 1, tickPoints: 1 });
const run = (rows, family) => runSignals(mk(rows), family, M);
const MIN = 60000;

test('prop-sim store: only its own file, a bar outside 2018-06-01 to 2022-12-30 refused, append-only rows', () => {
  const dir = tempDir('ps-store-');
  assert.throws(() => store.openPsDb(path.join(dir, 'ict-lab-sim.sqlite')), /refuses/);
  const db = store.openPsDb(store.psDbFile(dir));
  assert.throws(() => store.insertBars(db, 'QQQ', [{ date: '2023-01-03', minute: 570, o: 1, h: 1, l: 1, c: 1 }]), /CHECK/);
  assert.throws(() => store.insertBars(db, 'QQQ', [{ date: '2018-05-31', minute: 570, o: 1, h: 1, l: 1, c: 1 }]), /CHECK/);
  store.insertBars(db, 'QQQ', [{ date: '2019-03-04', minute: 570, o: 1, h: 1, l: 1, c: 1 }]);
  assert.throws(() => db.prepare('UPDATE ps_bars1m SET c = 2').run(), /append-only/);
  db.close();
});

test('levels and bars: the previous session high and low, the previous calendar week, 5-minute bars from 09:30, the ATR', () => {
  const rows = [...flatDay(sessions[0], 1000, 1020, 980), ...flatDay(sessions[1], 1000, 1030, 970), ...flatDay(sessions[5], 1000, 1001, 999)];
  const m = mk(rows);
  const s1 = m.sessions[1], s2 = m.sessions[2];
  assert.deepEqual([s1.levels.PDH, s1.levels.PDL, s1.levels.PWH], [1020, 980, null]);
  assert.deepEqual([s2.levels.PWH, s2.levels.PWL], [1030, 970], 'the next week sees the previous week high and low');
  assert.equal(s1.m5.length, 78);
  assert.deepEqual([s1.m5[0].o, s1.m5[0].h, s1.m5[0].l, s1.m5[0].c], [1000, 1030, 970, 1000]);
  assert.equal(s1.m5[0].atr, (13 * 40 + 60) / 14, 'the mean range of the last 14 completed 5-minute bars, across sessions');
});

test('the market structure shift; the mirror turns every short setup into the long setup', () => {
  const br = { up: [false, false, true, false, true], down: [false, true, false, false, false] };
  assert.equal(isShift(br, 2), true, 'an upward break after a downward one');
  assert.equal(isShift(br, 4), false, 'an upward break after an upward one is not a shift');
  assert.equal(isShift({ up: [true], down: [false] }, 0), false, 'no earlier break: not a shift');
  const bars = [{ o: 5, h: 6, l: 4, c: 5 }, { o: 5, h: 8, l: 5, c: 7 }, { o: 7, h: 7, l: 3, c: 3.5 }, { o: 3.5, h: 4, l: 1, c: 2 }, { o: 2, h: 9, l: 2, c: 8.5 }, { o: 8, h: 8.5, l: 6, c: 7 }];
  const mirror = mirrorBars(bars), sw = { leftBars: 1, rightBars: 1, confirmBarOffset: 1 };
  for (let k = 0; k < bars.length; k++) assert.equal(bosAt(mirror, k, sw).ok, downwardBosAt(bars, k, sw).ok, `bar ${k}`);
});

const F1_DAY = { 0: { o: 1000, h: 1005, l: 995, c: 1000 }, 1: { o: 1000, h: 1002, l: 992, c: 994 }, 2: { o: 994, h: 996, l: 985, c: 988 }, 3: { o: 988, h: 995, l: 987, c: 993 }, 4: { o: 993, h: 994, l: 986, c: 987 }, 5: { o: 987, h: 988, l: 980, c: 982 }, 6: { o: 982, h: 995, l: 975, c: 992 }, 7: { o: 992, h: 996, l: 990, c: 994 }, 8: { o: 994, h: 995, l: 991, c: 993 }, 9: { o: 997, h: 1003, l: 997, c: 1002 }, 10: { o: 1002, h: 1003, l: 995, c: 998 }, 11: { o: 998, h: 1045, l: 997, c: 1040 }, flat: { o: 1040, h: 1040, l: 1040, c: 1040 } };
test('F1: a sweep of the previous low, a structure shift, the fair value gap; the short is the same trade on the mirror', () => {
  const rows = [...flatDay(sessions[0], 1000, 1010, 990), ...rowsFor(sessions[1], F1_DAY)];
  const { trades } = run(rows, 'F1');
  assert.equal(trades.length, 1);
  const t = trades[0];
  assert.deepEqual([t.d, t.ref, t.fill, t.stop, t.target, t.exit, t.kind, t.resultTicks], [1, 996, 997, 974, 1040, 1040, 'target', 43]);
  assert.match(t.why, /sweep of PDL at bar 3, shift at 9, gap 7/, 'bar 3 (low 987, close 993) is the earliest armed sweep; the extreme is still bar 6');
  const flip = (r) => ({ ...r, o: 2000 - r.o, h: 2000 - r.l, l: 2000 - r.h, c: 2000 - r.c });
  const mt = run(rows.map(flip), 'F1').trades;
  assert.equal(mt.length, 1);
  assert.deepEqual([mt[0].d, mt[0].ref, mt[0].fill, mt[0].stop, mt[0].target, mt[0].resultTicks], [-1, 1004, 1003, 1026, 960, 43]);
});

test('F2, F3 and LB: the inverse fair value gap after a break; the order block after a level break; the plain level break', () => {
  const F2 = { 0: { o: 1000, h: 1004, l: 998, c: 1003 }, 1: { o: 1003, h: 1005, l: 1001, c: 1004 }, 2: { o: 1004, h: 1004, l: 994, c: 995 }, 3: { o: 995, h: 996, l: 990, c: 991 }, 4: { o: 991, h: 1000, l: 990, c: 999 }, 5: { o: 999, h: 1007, l: 998, c: 1006 }, 6: { o: 1006, h: 1006, l: 997, c: 1000 }, 7: { o: 1000, h: 1010, l: 1000, c: 1008 }, flat: { o: 1008, h: 1008, l: 1008, c: 1008 } };
  const t2 = run([...flatDay(sessions[0], 1000, 1001, 999), ...rowsFor(sessions[1], F2)], 'F2').trades;
  assert.deepEqual([t2[0].ref, t2[0].fill, t2[0].stop, t2[0].target, t2[0].exit, t2[0].resultTicks], [998, 999, 995, 1004, 1004, 5]);
  const BRK = { 5: { o: 1001, h: 1001, l: 999, c: 1000 }, 6: { o: 1000, h: 1005, l: 1000, c: 1004 }, 7: { o: 1004, h: 1004, l: 999, c: 1001 }, 8: { o: 1001, h: 1006, l: 1001, c: 1005 }, flat: { o: 1000, h: 1000, l: 1000, c: 1000 } };
  for (let k = 9; k < 78; k++) BRK[k] = { o: 1005, h: 1005, l: 1005, c: 1005 };
  const rows = [...flatDay(sessions[0], 1000, 1001, 999), ...rowsFor(sessions[1], BRK)];
  const t3 = run(rows, 'F3').trades;
  assert.deepEqual([t3[0].ref, t3[0].fill, t3[0].stop, t3[0].target, t3[0].exit, t3[0].kind, t3[0].resultTicks], [1000, 1001, 998, 1004, 1004, 'target', 3]);
  const tl = run(rows, 'LB').trades;
  assert.deepEqual([tl[0].ref, tl[0].fill, tl[0].stop, tl[0].fillMs - tl[0].setupMs], [1004, 1005, 999, 0], 'market entry at the next 1-minute open after the break close, stop under the break bar');
});

test('fills and exits: a limit fills only strictly through; the stop is tested before the target in one bar; slippage; the time exit', () => {
  const open = Date.UTC(2019, 2, 5, 14, 30);
  const bar = (i, o, h, l, c) => ({ s: open + i * MIN, e: open + (i + 1) * MIN, o, h, l, c });
  const sig = { rMultiple: 2, minStopTicks: 1 }, exec = M.execution;
  const m1 = [bar(0, 105, 106, 100, 104), bar(1, 104, 104, 99, 101), bar(2, 101, 130, 88, 120), bar(3, 120, 121, 119, 120)];
  const t = execute({ m1, d: 1, entryType: 'limit', entry: 100, stop: 90, t0: open, fillUntil: open + 10 * MIN, flatBy: open + 100 * MIN, sig, exec });
  assert.equal(t.fillMs, open + MIN, 'the low equal to the limit does not fill');
  assert.deepEqual([t.fill, t.kind, t.exit, t.maeTicks], [101, 'stop', 89, 13], 'both touched in one bar: the stop, less 1 tick');
  const s = execute({ m1, d: -1, entryType: 'market', entry: null, stop: 130, t0: open + 3 * MIN, fillUntil: open + 4 * MIN, flatBy: open + 100 * MIN, sig, exec });
  assert.deepEqual([s.fill, s.kind, s.exit], [119, 'session_end', 120]);
  const w = execute({ m1, d: 1, entryType: 'market', entry: null, stop: 119, t0: open + 3 * MIN, fillUntil: open + 4 * MIN, flatBy: open + 100 * MIN, sig: { rMultiple: 2, minStopTicks: 3 }, exec });
  assert.deepEqual([w.ref, w.stop, w.riskTicks, w.target], [120, 117, 3, 126], 'a stop 1 tick from the entry, closer than the minimum of 3, is widened to it');
  const m2 = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 100, 101, 99, 100)];
  const tt = execute({ m1: m2, d: 1, entryType: 'market', entry: null, stop: 90, t0: open, fillUntil: open + MIN, flatBy: open + 2 * MIN, sig, exec });
  assert.deepEqual([tt.kind, tt.exit, tt.resultTicks], ['time', 100, -1]);
});

test('no look-ahead: bars after a trade change no earlier trade; runs and random twins are deterministic', () => {
  const rows = [...flatDay(sessions[0], 1000, 1010, 990), ...rowsFor(sessions[1], F1_DAY), ...flatDay(sessions[2], 1040, 1041, 1039)];
  const a = run(rows, 'F1').trades;
  const later = rows.map((r) => (r.date === sessions[2] ? { ...r, h: r.h + 50, l: r.l - 50 } : r));
  assert.deepEqual(run(later, 'F1').trades.filter((t) => t.date <= sessions[1]), a.filter((t) => t.date <= sessions[1]));
  assert.deepEqual(run(rows, 'F1'), run(rows, 'F1'));
  const m = mk(rows);
  assert.deepEqual(randomTwin(m, a, M, mulberry32(7)), randomTwin(m, a, M, mulberry32(7)));
  const r1 = randomTwin(m, a, M, mulberry32(1));
  assert.equal(r1.length, a.length);
  assert.equal(r1[0].riskTicks, a[0].riskTicks, 'the same stop distance');
});

// Accounts: trades sized to one contract (risk 300 ticks at US$1 a tick), so P/L = result - US$1 of commission.
const exec = M.execution;
const T = (date, resultTicks, maeTicks = 0) => ({ date, riskTicks: 300, resultTicks, maeTicks });
const flex = { ...M.accounts.primary }, pro = { ...M.accounts.secondary };
const H = { evaluationSessions: 10, fundedSessions: 20 };
const D = tradingDays('2019-03-04', '2019-05-31', 'NYSE');
const attempt0 = (plan, trades) => runAttempts({ dates: D, trades, plan, tickValue: 1, exec, horizons: H })[0];

test('sizing: 25% of the room up to US$400, the stop-out loss with slippage and commissions, whole contracts, the cap', () => {
  assert.equal(contractsFor({ room: 2000, riskTicks: 20, tickValue: 0.5, exec, cap: 40 }), 33);
  assert.equal(contractsFor({ room: 2000, riskTicks: 20, tickValue: 0.5, exec, cap: 20 }), 20);
  assert.equal(contractsFor({ room: 400, riskTicks: 20, tickValue: 0.5, exec, cap: 40 }), 8);
  assert.equal(contractsFor({ room: 2000, riskTicks: 300, tickValue: 1, exec, cap: 40 }), 1);
  assert.equal(applyTrade({ bal: 50000, mll: 49000, dayPnl: 0, dll: null, trade: T('x', 1000), tickValue: 1, exec, cap: 40 }).skipped, 'unfunded', 'room 1,000: US$250 cannot cover one contract');
});

test('end-of-day trailing drawdown and its lock; the breach at the worst point of a trade (the stricter reading)', () => {
  // +1,000 on day 1: the MLL trails to 49,000; on day 2 a trade whose worst point reaches 49,000 breaches.
  assert.equal(attempt0(flex, [T(D[0], 1001), T(D[1], 0, 1999)]).eval, 'breached');
  assert.notEqual(attempt0(flex, [T(D[0], 1001), T(D[1], 0, 1998)]).eval, 'breached');
  // Without a close above 50,000 the MLL stays at 48,000 (day 1 closes at 49,999 after the commission).
  assert.equal(attempt0(flex, [T(D[0], 0, 0), T(D[1], 0, 1998)]).eval, 'breached', '49,999 - 1,999 = 48,000');
  assert.notEqual(attempt0(flex, [T(D[0], 0, 0), T(D[1], 0, 1997)]).eval, 'breached');
  // The lock: closes of 51,000 then 52,100 lock the MLL at 50,100 (profit 2,100, below the target); a worst point at 50,100 breaches.
  assert.equal(attempt0(flex, [T(D[0], 1001), T(D[1], 1101), T(D[2], 0, 1999)]).eval, 'breached');
  assert.notEqual(attempt0(flex, [T(D[0], 1001), T(D[1], 1101), T(D[2], 0, 1998)]).eval, 'breached');
  assert.notEqual(attempt0(flex, [T(D[0], 1001), T(D[1], 1101), T(D[2], 0, 1998), T(D[3], 501), T(D[4], 0, 2497)]).eval, 'breached', 'once locked the MLL stays at 50,100: a close of 52,599, then a worst point of 50,101 (an unlocked trail would sit at 50,599)');
});

test('consistency (LucidFlex 40%) holds a pass until the largest day is at most 40% of the profit; LucidPro has none', () => {
  const tr = [T(D[0], 2001), T(D[1], 1101), T(D[2], 1001), T(D[3], 1001)];
  const f = attempt0(flex, tr), p = attempt0(pro, tr);
  assert.deepEqual([f.eval, f.daysToPass], ['passed', 4], '2,000 of 5,100 = 39.2% on day 4');
  assert.deepEqual([p.eval, p.daysToPass], ['passed', 2]);
  assert.equal(attempt0(flex, [T(D[0], 1201), T(D[1], 1201), T(D[2], 601)]).eval === 'passed', true, '1,200 of 3,000 = exactly 40% passes');
});

test('LucidPro daily loss limit: realized plus open at the worst point, closed at the limit less 1 tick, a soft breach', () => {
  const a = attempt0(pro, [T(D[0], -500, 1300), T(D[0], 2000), T(D[1], 0)]);
  assert.equal(a.eval, 'timeout', 'not failed');
  assert.equal(a.dllDays, 1);
  const b = applyTrade({ bal: 50000, mll: 48000, dayPnl: -200, dll: 1200, trade: T('x', -500, 1100), tickValue: 1, exec, cap: 40 });
  assert.deepEqual([b.dllHit, b.pnl], [true, -1001], 'the day reaches -1,200 at the worst point: closed at -1,000 more, less 1 tick');
});

test('payouts: LucidFlex 5 days of at least US$150 and 50% of the profit up to US$2,000; LucidPro the cycle profit, 40% and the buffer', () => {
  const pass = [T(D[0], 1001), T(D[1], 1001), T(D[2], 1001)];
  const fd = (days, res) => days.map((i) => T(D[i], res));
  const f = attempt0(flex, [...pass, ...fd([3, 4, 5, 6, 7], 301)]);
  assert.deepEqual([f.eval, f.funded, f.payout, f.traderPayout], ['passed', 'payout', 750, 675], '5 days of US$300: half of 1,500 = 750, 90% to the trader');
  const f4 = attempt0(flex, [...pass, ...fd([3, 4, 5, 6], 301)]);
  assert.notEqual(f4.funded, 'payout', 'four qualifying days are not enough');
  const p = attempt0(pro, [...pass, ...fd([3, 4, 5, 6, 7, 8, 9, 10], 401)]);
  assert.deepEqual([p.funded, p.payout], ['payout', 700], 'US$400 a day: the balance first reaches 52,600 or more on day 7 (52,800): min(52,800 - 52,100, 2,000) = 700, with 400 / 2,800 under 40%');
});
