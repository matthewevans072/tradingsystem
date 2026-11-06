// event-swing's engine es-engine-1 (server/eventswing/engine.js) on synthetic data: D0 equals campaign 3's M1 n=3
// (rr-mech-1) exactly; prefix invariance, insensitivity to later bars and determinism; every supported entry and exit
// rule on hand-shaped bars; guidance filters and pauses; gaps, costs, shared cash, overlapping events, splits,
// dividends and accounting; family A's estimated exits, its misses, the time-out re-entry and forced placebo spells.
// Synthetic prices only exercise the code; nothing here is a result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runConfig } from '../server/eventswing/engine.js';
import { runMechanism } from '../server/research/mechanisms.js';
import { computeMetrics } from '../server/rangetrend/metrics.js';
import { accountingCheck } from '../server/research/runner.js';
import { mulberry32 } from '../server/research/runner.js';
import { cfg, synthMarket, flatMarket, setBar, ramp, ev, MATRIX } from './eventswing-fixtures.js';

const HS = 3;
const run = (id, m, events = [], o = {}) => runConfig({ config: o.config ?? cfg(id), inputs: m, events, prewindow: o.prewindow ?? [], halfSpreadBps: o.hs ?? HS, costMultiplier: o.costMultiplier ?? 1, period: o.period ?? null, forcedSpells: o.forcedSpells ?? null, stopAt: o.stopAt ?? null });
const M1 = JSON.parse(fs.readFileSync(new URL('../strategy/research-runner/prospective-1/rules/m1.json', import.meta.url), 'utf8'));
// A market whose closes alternate base and base + 0.5 (so the typical move is 0.5), opens at the previous close.
function zig(syms = ['AAA', 'BBB'], to = '2016-12-30') {
  const m = flatMarket({ to, syms });
  for (const s of syms) m.sessions.forEach((d, i) => { const prev = i ? m.days.get(m.sessions[i - 1]).bars[s].c : 50; const c = i % 2 ? 50.5 : 50; setBar(m, s, d, { o: prev, h: Math.max(prev, c), l: Math.min(prev, c), c }); });
  return m;
}
const S = (m, i) => m.sessions[i];

test('D0 with no pause reproduces campaign 3\'s M1 n=3 (rr-mech-1) exactly, with splits and dividends, from the window start and from a later start', () => {
  for (const seed of [7, 19]) {
    const m = synthMarket({ seed, syms: ['AAA', 'BBB', 'CCC'], splits: [{ symbol: 'BBB', date: '2017-06-01', ratio: 3 }], dividends: [{ symbol: 'AAA', exDate: '2016-11-01', payDate: '2016-11-15', amount: 0.3 }, { symbol: 'CCC', exDate: '2017-08-01', payDate: '2017-08-10', amount: 0.25 }] });
    for (const start of [m.sessions[0], m.sessions[230]]) {
      const period = { warmupFrom: m.sessions[0], start, end: m.sessions.at(-1) };
      const a = run('D0', m, [], { period, hs: (s, d) => 1.5 + (d < '2017-01-01' ? 1 : 2) });
      const b = runMechanism({ config: { ...M1, period: { basket: 'A', ...period } }, symbols: m.symbols, sessions: m.sessions, days: m.days, halfSpreadBps: (s, d) => 1.5 + (d < '2017-01-01' ? 1 : 2) });
      const pick = (r) => ({ fills: r.fills.map((f) => [f.date, f.symbol, f.side, f.shares, f.price]), trades: r.trades.map((t) => [t.symbol, t.entryDate, t.exitDate, t.exitReason, t.shares, t.pnl]), equity: r.equity.map((p) => [p.date, p.equity]), skips: r.skips.map((k) => [k.date, k.symbol, k.code]), cash: r.cash });
      assert.ok(b.trades.length > 5, 'the synthetic market produces trades');
      assert.deepEqual(pick(a), pick(b), `seed ${seed} start ${start}`);
    }
  }
});

function eventsFor(m, seed) {
  const rand = mulberry32(seed), out = [];
  for (const s of m.symbols.map((x) => x.symbol)) {
    const own = m.stockSessions[s];
    for (let i = 30; i < own.length - 5; i += 55 + Math.floor(rand() * 10)) {
      const g = ['raised', 'lowered', 'reaffirmed', 'none_detected'][Math.floor(rand() * 4)];
      out.push(ev(s, { avail: own[i], pre: own[i - 1], guidance: g, id: `${s}:${own[i]}` }));
    }
  }
  return out;
}
test('prefix invariance, insensitivity to later bars, and determinism for families A to D', () => {
  const m = synthMarket({ seed: 5, syms: ['AAA', 'BBB', 'CCC'], vol: 0.07, splits: [{ symbol: 'CCC', date: '2017-04-03', ratio: 2 }] });
  const events = eventsFor(m, 11);
  const pre = [ev('AAA', { avail: null, pre: null, D: '2015-08-10', id: 'AAA:2015' }), ev('BBB', { avail: null, pre: null, D: '2015-11-02', id: 'BBB:2015' })];
  const T = m.sessions[300];
  const upTo = (r) => ({
    fills: r.fills.filter((x) => x.date <= T), decisions: r.decisions.filter((x) => x.date <= T), skips: r.skips.filter((x) => x.date <= T), equity: r.equity.filter((x) => x.date <= T),
    trades: r.trades.filter((x) => x.exitDate <= T), events: r.events.filter((x) => x.availDate <= T), watches: r.watches.filter((x) => x.date <= T), estimates: r.estimates.filter((x) => x.knownAt <= T && (x.decisionSession ?? '') <= T), spells: r.spells.filter((x) => x.reentryFill <= T),
  });
  const later = { ...m, days: new Map([...m.days].map(([d, day]) => [d, d > T ? { ...day, bars: Object.fromEntries(Object.entries(day.bars).map(([s, b]) => [s, { ...b, o: b.o * 1.3, h: b.h * 1.3, l: b.l * 1.3, c: b.c * 1.3 }])) } : day])) };
  for (const id of ['B0', 'B1', 'B3', 'BP', 'C0', 'C1', 'C2', 'CP', 'D0', 'D1', 'D2', 'D3', 'A1', 'A2']) {
    const o = id.startsWith('A') ? { config: cfg(id, { portfolio: { ...MATRIX.shared.portfolio, sleeves: 3 } }), prewindow: pre } : {};
    const full = run(id, m, events, o);
    const cut = run(id, m, events.filter((e) => e.availDate <= T), { ...o, stopAt: T });
    const changed = run(id, later, events, o);
    assert.deepEqual(upTo(cut), upTo(full), `${id}: a run cut at T decides what the full run decided up to T`);
    assert.deepEqual(upTo(changed), upTo(full), `${id}: changing every bar after T changes nothing up to T`);
    assert.deepEqual(run(id, m, events, o), full, `${id}: deterministic`);
    if (!id.startsWith('A')) assert.ok(accountingCheck(full, computeMetrics(full)).ok, `${id}: the accounting reconciles`);
  }
});

test('B0 and the availability rule: the entry is decided at the availability close, never earlier, and fills at the next open with spread and slippage; double costs double them', () => {
  const m = zig(['AAA', 'BBB']);
  setBar(m, 'AAA', S(m, 61), { o: 50, h: 50, l: 44, c: 45 }); // the availability session: -10% against the pre-event close of session 60
  setBar(m, 'AAA', S(m, 62), { o: 45, h: 46, l: 44.8, c: 45.5 }); // still -9% a session later
  const e = ev('AAA', { avail: S(m, 61), pre: S(m, 60) });
  const r = run('B0', m, [e]);
  assert.deepEqual(r.decisions.filter((d) => d.action === 'entry').map((d) => [d.date, d.symbol]), [[S(m, 61), 'AAA']]);
  const buy = r.fills.find((f) => f.side === 'buy');
  assert.equal(buy.date, S(m, 62));
  assert.ok(Math.abs(buy.price - m.days.get(S(m, 62)).bars.AAA.o * (1 + (HS + 2) / 10000)) < 1e-12);
  const r2 = run('B0', m, [e], { costMultiplier: 2 });
  assert.ok(Math.abs(r2.fills.find((f) => f.side === 'buy').price - m.days.get(S(m, 62)).bars.AAA.o * (1 + (2 * (HS + 2)) / 10000)) < 1e-12);
  const t = r.trades[0];
  assert.equal(t.exitReason, 'time'); assert.equal(t.exitDate, S(m, 62 + 21), 'a 20-session time exit decided at the close of session 20 after the fill');
  assert.equal(r.events[0].action, 'signal'); assert.ok(Math.abs(r.events[0].R - (45 / 50 - 1)) < 1e-12);
  // The same drop delivered one session later (the delay sensitivity): no decision at the original session.
  const late = run('B0', m, [{ ...e, availDate: S(m, 62) }]);
  assert.equal(late.decisions.find((d) => d.action === 'entry').date, S(m, 62));
  assert.ok(Math.abs(late.events[0].R - (45.5 / 50 - 1)) < 1e-12, 'the delayed reaction is measured at the later close');
});

test('B1: a watch opens on the negative reaction, enters on the first recovery close, and exits on a close below the post-event low (an actual exit); B2 and B3 filter by guidance', () => {
  const m = zig(['AAA', 'BBB']);
  setBar(m, 'AAA', S(m, 61), { o: 50, h: 50, l: 44, c: 45 });
  setBar(m, 'AAA', S(m, 62), { o: 45, h: 45.2, l: 43.5, c: 44.5 });
  setBar(m, 'AAA', S(m, 63), { o: 44.6, h: 46.2, l: 44.4, c: 46 }); // above the previous high and close: recovery
  for (let i = 64; i <= 69; i++) setBar(m, 'AAA', S(m, i), { o: 46.5, h: 47, l: 46, c: 46.5 });
  setBar(m, 'AAA', S(m, 70), { o: 46, h: 46, l: 42.8, c: 43 }); // below L* = 43.5
  const e = ev('AAA', { avail: S(m, 61), pre: S(m, 60), guidance: 'reaffirmed' });
  const r = run('B1', m, [e]);
  assert.deepEqual(r.watches.map((w) => [w.outcome, w.date, w.low]), [['recovery', S(m, 63), 43.5]]);
  const t = r.trades[0];
  assert.deepEqual([t.entryDecisionDate, t.entryDate, t.stop, t.exitReason, t.exitDate], [S(m, 63), S(m, 64), 43.5, 'invalidation', S(m, 71)]);
  assert.equal(run('B2', m, [e]).trades.length, 1, 'B2 takes unchanged or raised guidance');
  const b3 = run('B3', m, [e]);
  assert.equal(b3.trades.length, 0); assert.equal(b3.events[0].action, 'filtered');
  assert.equal(run('B3', m, [{ ...e, guidance: 'lowered' }]).trades.length, 1);
});

test('B1 watch fates: no recovery within 10 sessions; a new trigger restarts the watch; a trigger while held is recorded as already held', () => {
  const m = zig(['AAA', 'BBB']);
  setBar(m, 'AAA', S(m, 61), { o: 50, h: 50, l: 44, c: 45 });
  for (let i = 62; i <= 75; i++) { const c = 45 - (i - 61) * 0.3; setBar(m, 'AAA', S(m, i), { o: c + 0.3, h: c + 0.3, l: c - 0.1, c }); }
  const r = run('B1', m, [ev('AAA', { avail: S(m, 61), pre: S(m, 60) })]);
  assert.deepEqual(r.watches.map((w) => [w.outcome, w.date, w.sessions]), [['no_recovery', S(m, 71), 10]]);
  assert.equal(r.trades.length, 0);
  setBar(m, 'AAA', S(m, 65), { o: 44.1, h: 44.1, l: 40.8, c: 41 }); // a second negative reaction: 41 / C(63) = -7.7%
  const r2 = run('B1', m, [ev('AAA', { avail: S(m, 61), pre: S(m, 60) }), ev('AAA', { avail: S(m, 65), pre: S(m, 63), id: 'AAA:2' })]);
  assert.equal(r2.watches[0].outcome, 'restarted');
  const c0 = run('C0', m, [ev('AAA', { avail: S(m, 61), pre: S(m, 60) }), ev('AAA', { avail: S(m, 66), pre: S(m, 65), id: 'AAA:2' })]);
  assert.deepEqual(c0.events.map((x) => x.action), ['signal', 'already_held']);
});

test('C1: buys a positive reaction, exits when the reaction is undone (a close below the pre-event close); a gap below the sizing reference rejects the entry; CP and BP trigger on two-session moves without an event', () => {
  const m = zig(['AAA', 'BBB']);
  setBar(m, 'AAA', S(m, 61), { o: 52, h: 55.2, l: 52, c: 55 });
  setBar(m, 'AAA', S(m, 62), { o: 55, h: 55.5, l: 54.5, c: 55 });
  setBar(m, 'AAA', S(m, 63), { o: 55, h: 55, l: 49.5, c: 49.8 });
  const r = run('C1', m, [ev('AAA', { avail: S(m, 61), pre: S(m, 60), guidance: 'raised' })]);
  const t = r.trades[0];
  assert.deepEqual([t.entryDate, t.stop, t.exitReason, t.exitDate], [S(m, 62), 50, 'invalidation', S(m, 64)]);
  assert.equal(run('C2', m, [ev('AAA', { avail: S(m, 61), pre: S(m, 60), guidance: 'reaffirmed' })]).trades.length, 0, 'C2 takes raised guidance only');
  const g = zig(['AAA', 'BBB']);
  setBar(g, 'AAA', S(g, 61), { o: 52, h: 55.2, l: 52, c: 55 });
  setBar(g, 'AAA', S(g, 62), { o: 49.9, h: 50, l: 49.5, c: 49.8 }); // the next open gaps below C(p) = 50
  const rg = run('C1', g, [ev('AAA', { avail: S(g, 61), pre: S(g, 60) })]);
  assert.equal(rg.trades.length, 0);
  assert.equal(rg.warnings.find((w) => w.code === 'entry_rejected').details.code, 'stop_above_fill');
  const p = zig(['AAA', 'BBB']);
  setBar(p, 'BBB', S(p, 81), { o: 51, h: 53, l: 51, c: 53 }); // C(t) / C(t-2) = 53 / 50.5 = +4.95%: no trigger
  setBar(p, 'BBB', S(p, 91), { o: 51, h: 53.1, l: 51, c: 53.1 }); // 53.1 / 50.5 = +5.1%: trigger
  const cp = run('CP', p);
  assert.deepEqual(cp.decisions.filter((d) => d.action === 'entry').map((d) => [d.date, d.symbol, d.stop]), [[S(p, 91), 'BBB', 50.5]]);
  const q = zig(['AAA', 'BBB']);
  setBar(q, 'AAA', S(q, 91), { o: 49, h: 49, l: 47.5, c: 47.9 }); // 47.9 / 50.5 = -5.1%
  const bp = run('BP', q);
  assert.equal(bp.watches.length > 0 || bp.trades.length > 0, true, 'BP opens a watch on a two-session fall without any event');
});

test('family D: the pauses skip the underlying entry after lowered guidance (D1), a negative reaction (D2) or any event (D3), for 20 of the stock\'s sessions', () => {
  const m = flatMarket({ to: '2017-06-30', syms: ['AAA', 'BBB'] });
  ramp(m, 'AAA', 1, 228, 30, 60);
  setBar(m, 'AAA', S(m, 229), { o: 60, h: 60, l: 55.8, c: 56 }); // the event's reaction: 56 / 60 = -6.7%
  ramp(m, 'AAA', 230, 236, 56.5, 60);
  for (const [i, c] of [[237, 59.5], [238, 59], [239, 58.5]]) setBar(m, 'AAA', S(m, i), { o: c + 0.5, h: c + 0.5, l: c, c });
  const sig = S(m, 239);
  const entryAt = (r) => r.decisions.filter((d) => d.action === 'entry' && d.symbol === 'AAA').map((d) => d.date);
  assert.ok(entryAt(run('D0', m)).includes(sig), 'D0 enters on the third down close in the uptrend');
  const lowered = ev('AAA', { avail: S(m, 229), pre: S(m, 228), guidance: 'lowered' });
  const raised = { ...lowered, guidance: 'raised' };
  const d1 = run('D1', m, [lowered]);
  assert.ok(!entryAt(d1).includes(sig)); assert.equal(d1.skips.find((k) => k.date === sig).code, 'paused_after_event');
  assert.ok(entryAt(run('D1', m, [raised])).includes(sig), 'D1 pauses after lowered guidance only');
  assert.ok(!entryAt(run('D2', m, [raised])).includes(sig), 'D2 pauses after a reaction of -5% or worse, whatever the guidance');
  assert.ok(!entryAt(run('D3', m, [raised])).includes(sig), 'D3 pauses after any event');
  const early = ev('AAA', { avail: S(m, 210), pre: S(m, 209) });
  assert.ok(entryAt(run('D3', m, [early])).includes(sig), 'the pause ends 20 sessions after the event');
});

test('shared cash: signals of one close split the available cash equally; the 20% cap and the 1% risk bind at the fill', () => {
  const m = zig(['AAA', 'BBB', 'CCC']);
  for (const s of ['AAA', 'BBB']) setBar(m, s, S(m, 61), { o: 50, h: 50, l: 44, c: 45 });
  const r = run('B0', m, ['AAA', 'BBB'].map((s) => ev(s, { avail: S(m, 61), pre: S(m, 60) })));
  const ds = r.decisions.filter((d) => d.action === 'entry');
  assert.equal(ds.length, 2);
  assert.ok(ds.every((d) => d.signalsToday === 2 && Math.abs(d.cashShare - 7500) < 1e-9));
  for (const d of ds) assert.ok(d.shares * 45 <= d.capUsd + 1e-9 && d.plannedRisk <= d.riskUsd + 1e-9);
});

test('family A: sells the sleeve before the estimated date and buys back after the announcement; holds through when the announcement came earlier; buys back after 15 sessions when none comes; forced spells', () => {
  const m = flatMarket({ to: '2016-12-30', syms: ['AAA', 'BBB'] });
  ramp(m, 'AAA', 1, m.sessions.length - 1, 50, 70);
  const config = cfg('A1', { portfolio: { ...MATRIX.shared.portfolio, sleeves: 2 } });
  const pre = [ev('AAA', { avail: null, pre: null, D: '2015-07-28', id: 'AAA:2015-07-28' })];
  // The estimate is 2016-07-26 (a Tuesday): sell at the open of 2016-07-25, decided at the close of 2016-07-22.
  const actual = ev('AAA', { avail: '2016-07-27', pre: '2016-07-25', D: '2016-07-26', id: 'AAA:2016-07-26' });
  const r = run('A1', m, [actual], { config, prewindow: pre });
  assert.deepEqual(r.spells.map((s) => [s.exitDecision, s.exitFill, s.reentryDecision, s.reentryFill, s.reentryReason]), [['2016-07-22', '2016-07-25', '2016-07-27', '2016-07-28', 'event_available']]);
  assert.equal(r.fills.filter((f) => f.side === 'buy' && f.date === m.sessions[0]).length, 2, 'both sleeves bought at the first open');
  // The announcement came before the decision: held through.
  const earlier = ev('AAA', { avail: '2016-07-21', pre: '2016-07-19', D: '2016-07-20', id: 'AAA:2016-07-20' });
  const r2 = run('A1', m, [earlier], { config, prewindow: pre });
  assert.equal(r2.spells.length, 0);
  assert.equal(r2.estimates.find((x) => x.estimate === '2016-07-26').status, 'already_announced');
  // No announcement at all: back in after the 15th session.
  const r3 = run('A1', m, [], { config, prewindow: pre });
  const sp = r3.spells[0];
  assert.equal(sp.reentryReason, 'max_out');
  assert.equal(m.stockSessions.AAA.indexOf(sp.reentryDecision) - m.stockSessions.AAA.indexOf(sp.exitFill), 15);
  // A2 sells three sessions before the target.
  const r4 = run('A2', m, [actual], { config: cfg('A2', { portfolio: { ...MATRIX.shared.portfolio, sleeves: 2 } }), prewindow: pre });
  assert.equal(r4.spells[0].exitFill, '2016-07-21');
  // The hold baseline never sells; forced spells sell and buy back exactly where told.
  assert.equal(run('A0', m, [actual], { config: cfg('A0', { portfolio: { ...MATRIX.shared.portfolio, sleeves: 2 } }), prewindow: pre }).fills.filter((f) => f.side === 'sell').length, 0);
  const forced = run('A1', m, [], { config, forcedSpells: { BBB: [{ exitDecision: '2016-03-01', reentryDecision: '2016-03-10' }] } });
  assert.deepEqual(forced.spells.map((s) => [s.symbol, s.exitFill, s.reentryFill]), [['BBB', '2016-03-02', '2016-03-11']]);
  assert.equal(forced.estimates.length, 0, 'forced spells ignore estimates');
});

test('family A keeps each sleeve\'s cash: dividends are paid into it, a split while held multiplies the shares, and the sleeves never share cash', () => {
  const m = flatMarket({ to: '2016-06-30', syms: ['AAA', 'BBB'] });
  m.days.get('2016-03-01').dividends.push({ symbol: 'AAA', exDate: '2016-03-01', payDate: '2016-03-15', amount: 1, id: 'd1' });
  m.days.get('2016-04-01').splits.push({ symbol: 'BBB', ratio: 2, id: 's1' });
  for (const d of m.sessions.filter((x) => x >= '2016-04-01')) Object.assign(m.days.get(d).bars.BBB, { o: 25, h: 25, l: 25, c: 25 });
  const r = run('A0', m, [], { config: cfg('A0', { portfolio: { ...MATRIX.shared.portfolio, sleeves: 2 } }) });
  const sharesA = r.fills.find((f) => f.symbol === 'AAA').shares, sharesB = r.fills.find((f) => f.symbol === 'BBB').shares;
  const sleeveA0 = 7500 - r.fills.find((f) => f.symbol === 'AAA').cost;
  assert.ok(Math.abs(r.sleeveCash.AAA - (sleeveA0 + sharesA * 1 * 0.85)) < 1e-9, 'the net dividend went into AAA\'s sleeve');
  assert.equal(r.openPositions.find((p) => p.symbol === 'BBB').shares, sharesB * 2);
  assert.ok(Math.abs(r.sleeveCash.BBB - (7500 - r.fills.find((f) => f.symbol === 'BBB').cost)) < 1e-9);
});
