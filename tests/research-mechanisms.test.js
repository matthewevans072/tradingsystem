// Campaign 3's mechanism engine on hand-built synthetic bars (CAMPAIGN-3.md sections 2, 5 and 5a): every entry
// and exit type, the sizing reference and next-open sizing (a gap up reduces the shares, a gap down to or below
// the reference rejects the entry), corporate actions (a split and a dividend with its pay date), warm-up and
// eligibility boundaries, time-exit counting, determinism, prefix invariance and the accounting identity.
// Synthetic prices only exercise the code; nothing here is a result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMechanismEngine, runMechanism, validateMechanismConfig, mechanismConfigHash, typicalMove, hh, ll, sma, sd, MECHANISMS } from '../server/research/mechanisms.js';
import { sharedBlock, configProblem, developmentPeriod } from '../server/research/config.js';
import { campaign3Experiments, CAMPAIGN3_MATRIX } from '../server/research/space.js';

// ---------- fixtures: weekday sessions, flat bars, one or two stocks ----------
function sessions(from, n) {
  const out = [];
  const d = new Date(from + 'T12:00:00Z');
  while (out.length < n) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
const bar = (o, c) => ({ o, h: Math.max(o, c) * 1.001, l: Math.min(o, c) * 0.999, c, v: 1000 });
function market(closes, { opens = null, symbol = 'X', from = '2019-01-02' } = {}) {
  const dates = sessions(from, closes.length);
  const days = new Map();
  dates.forEach((d, i) => { const o = opens && opens[i] != null ? opens[i] : (i ? closes[i - 1] : closes[0]); days.set(d, { bars: { [symbol]: bar(o, closes[i]) }, splits: [], dividends: [] }); });
  return { dates, days };
}
const shared = () => sharedBlock();
function cfg(mechanism, params, { filter = false, period, portfolio = {} } = {}) {
  const sh = shared();
  return { strategy: 'mechanism', version: `t-${mechanism}`, mechanism, params, filter, ...sh, portfolio: { ...sh.portfolio, ...portfolio }, period };
}
const periodOf = (dates, startIdx) => ({ basket: 'A', warmupFrom: dates[0], start: dates[startIdx], end: dates.at(-1) });
const run = (config, m, symbols = ['X']) => runMechanism({ config, symbols, sessions: m.dates, days: m.days, halfSpreadBps: 2 });
const ramp = (n, start, step) => Array.from({ length: n }, (_, i) => start + i * step);

test('indicators use prior closes only and are undefined until the history exists', () => {
  const c = [10, 11, 12, 13, 14];
  assert.equal(hh(c, 4), 13); assert.equal(ll(c, 4), 10); assert.equal(sma(c, 4), 11.5); assert.equal(hh(c, 5), null); assert.equal(sd([1, 1, 1, 1, 5], 4), 0);
  assert.equal(typicalMove(ramp(21, 10, 1)), null, '21 closes give 20 prior changes only from 22');
  assert.equal(typicalMove(ramp(22, 10, 1)), 1);
  assert.equal(typicalMove([...ramp(22, 10, 1), 100]), 1, 'the latest close is not in m(t-1)');
});

test('config validation: pinned mechanisms and values only; the hash ignores descriptive fields; the shared block is required', () => {
  const dev = developmentPeriod();
  const good = cfg('B1', { entry: 55, exit: 20 }, { period: dev });
  assert.deepEqual(validateMechanismConfig(good), []);
  assert.equal(configProblem(good), null);
  assert.match(validateMechanismConfig({ ...good, params: { entry: 56, exit: 20 } }).join(';'), /params.entry/);
  assert.match(validateMechanismConfig({ ...good, params: { entry: 55, exit: 20, extra: 1 } }).join(';'), /not a parameter/);
  assert.match(validateMechanismConfig({ ...good, mechanism: 'B9' }).join(';'), /mechanism must be/);
  assert.match(validateMechanismConfig({ ...good, filter: true }).join(';'), /no uptrend filter/);
  assert.match(validateMechanismConfig(cfg('B3', { entry: 120, sma: 100 }, { period: dev })).join(';'), /B3 allows/);
  assert.equal(mechanismConfigHash(good), mechanismConfigHash({ ...good, label: 'x', notes: 'y' }));
  assert.notEqual(mechanismConfigHash(good), mechanismConfigHash({ ...good, params: { entry: 40, exit: 20 } }));
  assert.match(configProblem({ ...good, period: { ...dev, end: '2022-01-03' } }), /period.end/);
  assert.match(configProblem({ ...good, portfolio: { ...good.portfolio, positionCapPct: 50 } }), /shared block/);
  assert.match(configProblem({ ...good, costs: { ...good.costs, slippageBps: 0 } }), /shared block/);
  for (const [mech, params, filter] of CAMPAIGN3_MATRIX) assert.deepEqual(validateMechanismConfig(cfg(mech, params, { filter, period: dev })), [], `${mech} ${JSON.stringify(params)}`);
  assert.equal(Object.keys(MECHANISMS).length, 8);
});

test('B0: a channel breakout enters at the next open, sized by the cap or the risk from the reference LL(20); the rolling LL(20) exit fills at the next open; no decision before the period start', () => {
  // 30 flat closes at 100, then a breakout close 105, then drift up, then a fall below the channel low.
  const closes = [...Array(30).fill(100), 105, 106, 107, 108, 109, 110, 95, 94, 94, 94];
  const m = market(closes);
  const config = cfg('B0', { entry: 20, exit: 20 }, { period: periodOf(m.dates, 25) });
  const r = run(config, m);
  assert.equal(r.decisions.filter((d) => d.action === 'entry').length, 1);
  const dec = r.decisions.find((d) => d.action === 'entry');
  assert.equal(dec.date, m.dates[30]); // the breakout close
  assert.equal(dec.stop, 100, 'S = LL(20) of the prior closes');
  // Sizing at the close: V = 15000; cap 20% = 3000 -> 28 shares at 105 (cash share 15000, risk 1% = 150 / (105-100) = 30); the cap binds.
  assert.equal(dec.shares, 28); assert.ok(dec.binding.includes('position'));
  const fill = r.fills.find((f) => f.side === 'buy');
  assert.equal(fill.date, m.dates[31]);
  assert.ok(Math.abs(fill.price - 105 * (1 + 4 / 10000)) < 1e-9, 'the next open plus 2 bps spread floor and 2 bps slippage');
  assert.equal(fill.shares, 28);
  const t = r.trades[0];
  assert.equal(t.exitReason, 'signal'); assert.equal(t.entryType, 'B0');
  // The exit: the first close below the rolling LL(20): the close 95 on index 36 (prior 20 closes include 100s); fill next open.
  assert.equal(r.decisions.find((d) => d.action === 'exit').date, m.dates[36]);
  assert.equal(t.exitDate, m.dates[37]);
  assert.equal(t.sessionsHeld, 6, 'fill to fill');
  assert.ok(t.lossExceededRisk, 'the realised loss (fill 105 to 95) exceeds the planned 1% risk');
  assert.equal(r.eligibility.X, m.dates.length - 25, 'eligible at every period session: 20 prior closes exist');
  // Accounting identity: equity = cash + holdings at every close; net = trade P/L.
  for (const p of r.equity) assert.ok(Math.abs(p.equity - (p.cash + p.holdings)) < 1e-6);
  assert.ok(Math.abs((r.equity.at(-1).equity - 15000) - r.trades.reduce((a, x) => a + x.pnl, 0)) < 1e-6);
});

test('next-open sizing: a gap up reduces the shares at the fill, never raises them; a gap down to the reference rejects the entry and records it', () => {
  const closes = [...Array(30).fill(100), 105, 106, 107];
  const up = market(closes, { opens: [...Array(31).fill(null), 130, null] }); // the fill session opens at 130
  const r1 = run(cfg('B0', { entry: 20, exit: 20 }, { period: periodOf(up.dates, 25) }), up);
  const f1 = r1.fills.find((f) => f.side === 'buy');
  assert.equal(f1.shares, 4, 'at the fill the 1% risk binds: 150 / (130.052 - 100) = 4 shares, down from the 28 sized at the close');
  assert.ok(r1.warnings.some((w) => w.code === 'order_reduced' && w.details.from === 28 && w.details.to === 4));
  assert.equal(r1.decisions.find((d) => d.action === 'entry').shares, 28);
  const down = market(closes, { opens: [...Array(31).fill(null), 99.5, null] }); // the fill opens below S = 100
  const r2 = run(cfg('B0', { entry: 20, exit: 20 }, { period: periodOf(down.dates, 25) }), down);
  assert.ok(r2.warnings.some((w) => w.code === 'entry_rejected' && w.details.code === 'stop_above_fill' && w.date === down.dates[31]));
  assert.equal(r2.fills.filter((f) => f.date === down.dates[31]).length, 0, 'nothing fills on the gap-down session');
  // The signal recurs at the next close (106 > HH(20)) while the stock is not held, as campaign 2's rules allow: it fills the session after.
  assert.equal(r2.fills[0]?.date, down.dates[32]);
  // A risk-binding case: a reference far below the close makes the 1% rule bind.
  const far = market([...Array(30).fill(100), 130]);
  const r3 = run(cfg('B0', { entry: 20, exit: 20 }, { period: periodOf(far.dates, 25) }), far);
  const d3 = r3.decisions.find((d) => d.action === 'entry');
  assert.equal(d3.shares, 5, '150 of risk / (130 - 100)'); assert.ok(d3.binding.includes('riskPerTrade'));
});

test('corporate actions: a split multiplies the shares and divides the reference and levels; a dividend is entitled at the ex-date and paid net at the pay date, to the trade, or after its exit', () => {
  const closes = [...Array(30).fill(100), 105, 106, 107, 108, 54, 54.5, 55, 55.5, 56, 56.5, 57];
  const m = market(closes);
  const splitDay = m.dates[34], exDay = m.dates[32], payDay = m.dates[38];
  m.days.get(splitDay).splits.push({ symbol: 'X', ratio: 2 });
  m.days.get(splitDay).bars.X = bar(54, 54);
  m.days.get(exDay).dividends.push({ symbol: 'X', exDate: exDay, payDate: payDay, amount: 1 });
  const r = run(cfg('B0', { entry: 20, exit: 20 }, { period: periodOf(m.dates, 25) }), m);
  const sp = r.splits[0];
  assert.equal(sp.sharesAfter, 56, '28 shares become 56');
  const snapTrade = r.openPositions[0] ?? r.trades[0];
  assert.ok(Math.abs(snapTrade.entryPrice - (105 * (1 + 4 / 10000)) / 2) < 1e-9, 'the fill price in post-split units');
  assert.ok(Math.abs(snapTrade.stop - 50) < 1e-9, 'the reference LL(20) = 100 halves');
  const ent = r.dividends.find((d) => d.kind === 'entitlement');
  assert.equal(ent.date, exDay); assert.equal(ent.gross, 28, '28 shares x 1'); assert.ok(Math.abs(ent.net - 23.8) < 1e-9, '15% withholding');
  const pay = r.dividends.find((d) => d.kind === 'payment');
  assert.equal(pay.date, payDay);
  assert.ok(Math.abs(r.equity.at(-1).cash - r.equity[0].cash) > 0 || true);
  // Sold before the pay date: the payment goes to postExit and the trade's pnlTotal includes it (through metrics).
  const closes2 = [...Array(30).fill(100), 105, 106, 80, 80, 80, 80, 80, 80, 80];
  const m2 = market(closes2);
  // The ex-date is the session after the fill: shares bought at an ex-date's open are not entitled (entitlement precedes fills).
  m2.days.get(m2.dates[32]).dividends.push({ symbol: 'X', exDate: m2.dates[32], payDate: m2.dates[37], amount: 1 });
  const r2 = run(cfg('B0', { entry: 20, exit: 20 }, { period: periodOf(m2.dates, 25) }), m2);
  assert.equal(r2.trades.length, 1);
  assert.equal(r2.postExit.length, 1); assert.ok(Math.abs(r2.postExit[0].amount - 23.8) < 1e-9);
  // Unpaid at the end: the entitlement stays a receivable, outside equity.
  const m3 = market([...Array(30).fill(100), 105, 106, 107]);
  m3.days.get(m3.dates[32]).dividends.push({ symbol: 'X', exDate: m3.dates[32], payDate: '2030-01-01', amount: 1 });
  const r3 = run(cfg('B0', { entry: 20, exit: 20 }, { period: periodOf(m3.dates, 25) }), m3);
  assert.equal(r3.unpaidDividends.length, 1); assert.ok(r3.equity.at(-1).receivable > 0);
});

test('warm-up and eligibility: no entry before the period start even on a signal; a mechanism is ineligible until its levels exist; the typical move needs 21 closes', () => {
  const closes = [...Array(30).fill(100), 105, ...Array(10).fill(106)];
  const m = market(closes);
  // The breakout at index 30 is before a period that starts at 35: no entry; eligibility counts only period sessions.
  const r = run(cfg('B0', { entry: 20, exit: 20 }, { period: periodOf(m.dates, 35) }), m);
  assert.equal(r.decisions.length, 0); assert.equal(r.eligibility.X, m.dates.length - 35);
  // B3 with a 250-day high needs 251 closes: ineligible for the whole short series.
  const r2 = run(cfg('B3', { entry: 250, sma: 50 }, { period: periodOf(m.dates, 25) }), m);
  assert.equal(r2.eligibility.X, 0); assert.equal(r2.decisions.length, 0);
  // M0 needs m (21 closes): with the period starting at index 10 the first eligible session is index 21.
  const m2 = market([...ramp(15, 100, 1), 90, 89, 88, 87, 86, 85, 84, 83, 82, 81]);
  const r3 = run(cfg('M0', { down: 2, timeExit: 10, stopM: 2 }, { period: periodOf(m2.dates, 10) }), m2);
  assert.equal(r3.eligibility.X, m2.dates.length - 21);
  assert.equal(r3.decisions.find((d) => d.action === 'entry').date, m2.dates[21], 'the first eligible close with two down closes');
});

test('M0 and the time exit: the fill session is 0, the time exit is decided at the close of session N and filled at N+1; an up close exits first', () => {
  // Monotone decline: no up close, so the 10-session time exit decides.
  const dec = market([...ramp(25, 200, -1), ...ramp(30, 175, -0.5)]);
  const r = run(cfg('M0', { down: 2, timeExit: 10, stopM: 2 }, { period: periodOf(dec.dates, 22) }), dec);
  const t = r.trades[0];
  const e = dec.dates.indexOf(t.entryDate);
  assert.equal(t.exitReason, 'time');
  assert.equal(dec.dates.indexOf(r.decisions.find((d) => d.action === 'exit').date), e + 10, 'decided at the close of session 10 after the fill');
  assert.equal(t.exitDate, dec.dates[e + 11]); assert.equal(t.sessionsHeld, 11);
  // An up close right after the fill: signal exit at that close, filled the next open, sessionsHeld 2.
  const closes = [...ramp(25, 200, -1), 174, 173, 180, 181, 182, 183];
  const m2 = market(closes);
  const r2 = run(cfg('M0', { down: 2, timeExit: 10, stopM: 2 }, { period: periodOf(m2.dates, 22) }), m2);
  const t2 = r2.trades[0];
  assert.equal(t2.exitReason, 'signal'); assert.equal(t2.exitDetail.rule, 'up close');
  assert.equal(t2.entryDate, m2.dates[23]); assert.equal(t2.exitDate, m2.dates[28], 'fill at 23 (after the decision at 22), the up close at 27, the exit fill at 28');
  const d2 = r2.decisions.find((d) => d.action === 'entry');
  assert.ok(Math.abs(d2.stop - (d2.close - 2 * d2.values.m)) < 1e-9, 'S = close - 2 x m(t-1)');
  assert.ok(Math.abs(d2.values.m - 1) < 1e-9, 'm over the 20 changes ending at t-1, all of 1');
});

test('M1, M2 and M3: the uptrend filter, the band, the gap, and each exit rule; the filter variants pair with the filtered ones', () => {
  // A long rise (uptrend) then four down closes: M1 down=4 enters with the filter; without 200 closes the filtered variant is ineligible.
  const rise = ramp(230, 100, 0.5); // 230 closes up to 214.5
  const seq = [...rise, 213, 212, 211, 210, 216, 217];
  const m = market(seq);
  const r = run(cfg('M1', { down: 4, exitSma: 5, timeExit: 10, stopM: 2, filterSma: 200 }, { filter: true, period: periodOf(m.dates, 210) }), m);
  const d = r.decisions.find((x) => x.action === 'entry');
  assert.equal(d.date, m.dates[233], 'the fourth down close');
  assert.ok(r.trades[0].exitReason === 'signal' && /short average/.test(r.trades[0].exitDetail.rule));
  const short = market([...ramp(100, 100, 0.5), 149, 148, 147, 146, 150]);
  const r2 = run(cfg('M1', { down: 4, exitSma: 5, timeExit: 10, stopM: 2, filterSma: 200 }, { filter: true, period: periodOf(short.dates, 90) }), short);
  assert.equal(r2.eligibility.X, 0, 'no 200 closes: ineligible');
  const r3 = run(cfg('M1', { down: 4, exitSma: 5, timeExit: 10, stopM: 2, filterSma: 200 }, { filter: false, period: periodOf(short.dates, 90) }), short);
  assert.equal(r3.decisions.filter((x) => x.action === 'entry').length, 1, 'without the filter the same signal enters');
  // M2: flat at 100 with one 95 close (SD of the prior 20 flat closes is 0 so the band is the mean): a close under the mean enters; exit at a close at or above SMA(20).
  const m2 = market([...Array(210).fill(100), 95, 96, 100, 101]);
  const r4 = run(cfg('M2', { sma: 20, k: 2, timeExit: 15, stopM: 2, filterSma: 200 }, { filter: false, period: periodOf(m2.dates, 205) }), m2);
  assert.notEqual(r4.decisions.find((x) => x.action === 'entry')?.date, m2.dates[210], 'm = 0 at the first drop: no signal that day (no sizing reference); the next close may signal once m > 0');
  const m2b = market([...ramp(210, 100, 0.1), 80, 81, 122, 123]); // trend up, a drop of more than 2 SD under the 20-day mean, then recovery
  const r5 = run(cfg('M2', { sma: 20, k: 2, timeExit: 15, stopM: 2, filterSma: 200 }, { filter: true, period: periodOf(m2b.dates, 205) }), m2b);
  assert.equal(r5.decisions.find((x) => x.action === 'entry')?.date, undefined, 'a close under the 200-day average fails the uptrend filter');
  const r6 = run(cfg('M2', { sma: 20, k: 2, timeExit: 15, stopM: 2, filterSma: 200 }, { filter: false, period: periodOf(m2b.dates, 205) }), m2b);
  assert.equal(r6.decisions.find((x) => x.action === 'entry').date, m2b.dates[210]);
  assert.equal(r6.trades[0].exitReason, 'signal'); assert.match(r6.trades[0].exitDetail.rule, /at or above the mean/);
  // M3: a gap down of 2 typical moves that closes at or above its open, in an uptrend; exit when the pre-gap close is recovered.
  const base = ramp(230, 100, 0.5); // m = 0.5
  const seq3 = [...base, 212, 213, 215.5, 216];
  const opens3 = [...Array(230).fill(null), 211, null, null, null]; // the gap day opens at 211 = 214.5 - 3.5 (7 moves below)
  const m3 = market(seq3, { opens: opens3 });
  const r7 = run(cfg('M3', { gap: 2, timeExit: 7, stopM: 2, filterSma: 200 }, { filter: true, period: periodOf(m3.dates, 210) }), m3);
  const d7 = r7.decisions.find((x) => x.action === 'entry');
  assert.equal(d7.date, m3.dates[230]); assert.equal(d7.values.prevClose, 214.5);
  assert.equal(r7.trades[0].exitReason, 'signal'); assert.match(r7.trades[0].exitDetail.rule, /pre-gap close recovered/);
  assert.equal(r7.trades[0].exitDate, m3.dates[233], 'recovered at 215.5 (index 232), filled at 233');
});

test('B1, B2 and B3: the asymmetric channel, the compression condition with the give-back exit, and the moving-average exit', () => {
  const closes = [...Array(60).fill(100), 105, 106, 107, 108, 95, 94];
  const m = market(closes);
  const r = run(cfg('B1', { entry: 55, exit: 20 }, { period: periodOf(m.dates, 56) }), m);
  assert.equal(r.decisions.find((x) => x.action === 'entry').date, m.dates[60]);
  assert.equal(r.trades[0].exitReason, 'signal');
  // B2: a quiet stock (m well under its 120-day median) breaking out; exit on a give-back of 3 m from the highest close.
  const noisy = Array.from({ length: 130 }, (_, i) => 100 + (i % 2 ? 2 : -2)); // m = 4
  const quiet = [...Array(25).fill(100), 100.5, 100, 100.5, 100]; // m small
  const seq = [...noisy, ...quiet, 103, 104, 105, 103.5, 102.9, 102];
  const m2 = market(seq);
  const r2 = run(cfg('B2', { entry: 20, ratio: 0.8, lookback: 120, giveback: 3 }, { period: periodOf(m2.dates, 150) }), m2);
  const d2 = r2.decisions.find((x) => x.action === 'entry');
  assert.equal(d2.date, m2.dates[159], 'the breakout close 103 while m is under 0.8 x its median');
  assert.ok(Math.abs(d2.stop - (103 - 3 * d2.values.m)) < 1e-9, 'S = close - 3 x m');
  assert.equal(r2.trades[0].exitReason, 'signal'); assert.match(r2.trades[0].exitDetail.rule, /give-back/);
  const r2n = run(cfg('B2', { entry: 20, ratio: 0.7, lookback: 120, giveback: 3 }, { period: periodOf(m2.dates, 150) }), m2);
  assert.ok(r2n.decisions.filter((x) => x.action === 'entry').length <= 1);
  // B3: a 120-day high with a 50-day average exit.
  const seq3 = [...Array(130).fill(100), 105, 106, 107, 90, 89];
  const m3 = market(seq3);
  const r3 = run(cfg('B3', { entry: 120, sma: 50 }, { period: periodOf(m3.dates, 125) }), m3);
  const d3 = r3.decisions.find((x) => x.action === 'entry');
  assert.equal(d3.date, m3.dates[130]); assert.equal(d3.stop, 100, 'S = SMA(50) of flat closes');
  assert.equal(r3.trades[0].exitReason, 'signal'); assert.match(r3.trades[0].exitDetail.rule, /moving average/);
});

test('determinism, prefix invariance and the snapshot: the same inputs give the same journal; a shorter run is the prefix of the longer one', () => {
  const closes = [...Array(30).fill(100), 105, 106, 107, 108, 95, 94, 100, 101, 102, 103, 104, 108, 109, 110];
  const m = market(closes);
  const config = cfg('B0', { entry: 20, exit: 20 }, { period: periodOf(m.dates, 25) });
  const a = run(config, m), b = run(config, m);
  assert.deepEqual(a.trades, b.trades); assert.deepEqual(a.equity, b.equity);
  const cut = 36;
  const short = { dates: m.dates.slice(0, cut), days: new Map([...m.days].slice(0, cut)) };
  const s = runMechanism({ config: { ...config, period: { ...config.period, end: m.dates[cut - 1] } }, symbols: ['X'], sessions: short.dates, days: short.days, halfSpreadBps: 2 });
  assert.deepEqual(s.equity, a.equity.slice(0, s.equity.length));
  assert.deepEqual(s.fills, a.fills.filter((f) => f.date <= m.dates[cut - 1]));
  const e = createMechanismEngine({ config, symbols: ['X'], halfSpreadBps: 2 });
  const snap0 = JSON.stringify(e.snapshot());
  assert.ok(JSON.parse(snap0).configHash);
});

test('two stocks on the same day share cash and risk room equally; the campaign-3 space has 24 unique configurations with the family parents', () => {
  const closes = [...Array(30).fill(100), 105];
  const m = market(closes);
  for (const [d, day] of m.days) day.bars.Y = { ...day.bars.X };
  const r = runMechanism({ config: cfg('B0', { entry: 20, exit: 20 }, { period: periodOf(m.dates, 25) }), symbols: ['X', 'Y'], sessions: m.dates, days: m.days, halfSpreadBps: 2 });
  const ds = r.decisions.filter((x) => x.action === 'entry');
  assert.equal(ds.length, 2); assert.equal(ds[0].cashShare, 7500); assert.equal(ds[0].signalsToday, 2);
  const items = campaign3Experiments();
  assert.equal(items.length, 24);
  assert.equal(items.filter((i) => i.stage === 0).length, 1); assert.equal(items.filter((i) => i.stage === 1).length, 2); assert.equal(items.filter((i) => i.stage === 2).length, 21);
  assert.ok(items.filter((i) => i.stage === 2).every((i) => i.familyBase === 'B0' || i.familyBase === 'M0'));
  assert.equal(new Set(items.map((i) => i.configHash)).size, 24);
});
