// news-replay on synthetic data (server/newsreplay/*): eligibility and revisions; the loader's boundary and prefix
// invariance; the volume profile and its refusal of a developing or same-session profile; bullish, bearish, no-trade,
// content-disarmed and conflicting plans; every entry rule, cancellation, delays, gaps, exits, shared cash, splits,
// dividends and the accounting identity; the append-only hash chains; the AI validator and a cached replay with zero
// calls. Synthetic prices only exercise the code; nothing here is a result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { tradingDays } from '../server/strategy/sessions.js';
import { regularSessionBounds } from '../server/calendar.js';
import { eligibleOf, newsItems, etMs } from '../server/newsreplay/items.js';
import { createLoader } from '../server/newsreplay/loader.js';
import { sessionProfile, compositeTarget } from '../server/newsreplay/profile.js';
import { thirtyMinuteBars } from '../server/newsreplay/exits.js';
import { deterministicPlan, classifyHeadline } from '../server/newsreplay/planner.js';
import { prepareMarket, runReplay, activationOf } from '../server/newsreplay/sim.js';
import { evaluateActions, report, planFates } from '../server/newsreplay/evaluate.js';
import { holdIndex } from '../server/rangetrend/benchmark.js';
import * as store from '../server/newsreplay/store.js';
import { validateAiPlan, createAiPlanner, maskPacket, loadAiSpec } from '../server/newsreplay/ai.js';
import { hashOf, sha256 } from '../server/newsreplay/config.js';
import { fourAnswers } from '../server/newsreplay/answers.js';
import { createNewsReplayService } from '../server/newsreplay/service.js';
import fs from 'node:fs';

const WORDS = JSON.parse(fs.readFileSync(new URL('../strategy/news-replay/headline-words-v1.json', import.meta.url), 'utf8'));
const SPEC = loadAiSpec();
const COSTS = { commissionPerOrder: 0, commissionPerShare: 0, secFeeRate: 0.0000206, tafPerShare: 0.000166, tafMaxPerTrade: 8.3, halfSpreadFloorBps: 2, slippageBps: 2, withholdingPct: 15 };
const PORT = { startingCash: 15000, positionCapPct: 20, riskPerTradePct: 1, totalEntryRiskPct: 5 };
const et = (d, hh, mm) => etMs(`${d} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
const open = (d) => new Date(regularSessionBounds(d).open).getTime();
const close = (d) => new Date(regularSessionBounds(d).close).getTime();

// A flat synthetic market: daily closes alternate 50 and 50.5 (m = 0.5), every 5-minute and 1-minute bar at the day's
// previous close unless a test shapes it.
function market({ from = '2020-01-02', to = '2020-03-31', syms = ['AAA', 'BBB'] } = {}) {
  const sessions = tradingDays(from, to, 'NYSE');
  const sessionIndex = new Map(sessions.map((d, i) => [d, i]));
  const daily = new Map(), dailyArr = new Map(), bars5 = new Map(), bars1 = new Map();
  for (const s of syms) {
    const d1 = new Map(), arr = [], b5 = new Map(), b1 = new Map();
    sessions.forEach((d, i) => {
      const c = i % 2 ? 50.5 : 50, prev = i ? (i - 1) % 2 ? 50.5 : 50 : 50;
      d1.set(d, { o: prev, h: Math.max(prev, c), l: Math.min(prev, c), c }); arr.push({ date: d, c });
      const o0 = open(d), n = Math.round((close(d) - o0) / 300000);
      b5.set(d, Array.from({ length: n }, (_, k) => ({ s: o0 + k * 300000, e: o0 + (k + 1) * 300000, o: prev, h: prev, l: prev, c: prev, v: 1000 })));
      b1.set(d, Array.from({ length: n * 5 }, (_, k) => ({ minute: 570 + k, o: prev, h: prev, l: prev, c: prev, v: 200, vw: prev })));
    });
    daily.set(s, d1); dailyArr.set(s, arr); bars5.set(s, b5); bars1.set(s, b1);
  }
  return { sessions, sessionIndex, daily, dailyArr, bars5, bars1, syms };
}
const bar = (m, s, d, hh, mm) => m.bars5.get(s).get(d).find((b) => b.e === et(d, hh, mm));
const shape = (m, s, d, hh, mm, x) => { const b = bar(m, s, d, hh, mm); Object.assign(b, x); b.h = Math.max(b.h, b.o, b.c); b.l = Math.min(b.l, b.o, b.c); return b; };
const mk = (m, extra = {}) => prepareMarket({ sessions: m.sessions, sessionIndex: m.sessionIndex, bars5: m.bars5, daily: m.daily, profiles: (s, prior, asOf) => sessionProfile(m.bars1.get(s).get(prior), { session: prior, asOfSession: asOf }), splits: [], dividends: [], halfSpread: () => 3, openMs: open, closeMs: close, ...extra });
const loaderOf = (m, items = []) => createLoader({ items, daily: m.dailyArr, bars5: m.bars5, bars1: m.bars1, splits: [], sessions: m.sessions });
const item = (stock, d, hh, mm, extra = {}) => { const p = et(d, hh, mm); const e = eligibleOf(p); return { id: `news:${stock}:${d}:${hh}${mm}`, kind: 'news', stocks: [stock], allSymbols: [stock], publishedMs: p, eligibleMs: e.ms, session: e.session, outsideHours: e.outsideHours, revised: false, headline: 'Something happened', summary: null, ...extra }; };
const planAt = (m, stock, d, hh, mm, extra = {}) => { const it = item(stock, d, hh, mm, extra); const L = loaderOf(m, [it]); const p = deterministicPlan(L.packetAt({ stock, T: it.eligibleMs, session: it.session }), { variant: extra.variant ?? 'D', words: WORDS, followUp: extra.followUp }); return { ...p, id: extra.id ?? 1 }; };
const run = (m, plans, treatment = 'A', o = {}) => runReplay({ plans, treatment, market: mk(m, o.market), costs: COSTS, portfolio: PORT, from: m.sessions[0], to: m.sessions.at(-1), costMultiplier: o.costMultiplier ?? 1, delay: o.delay ?? null });
const evaluate = (m, r) => evaluateActions(r.actions, mk(m), { from: m.sessions[0], to: m.sessions.at(-1), startingCash: 15000, symbols: m.syms });

test('eligibility: 5 minutes then the next 5-minute bar close; outside hours, past the close, weekends and early closes go to the next first bar close; revisions', () => {
  const at = (d, hh, mm) => eligibleOf(et(d, hh, mm));
  assert.equal(at('2020-03-10', 10, 2).ms, et('2020-03-10', 10, 10));
  assert.equal(at('2020-03-10', 10, 5).ms, et('2020-03-10', 10, 10), '10:05 + 5 min = 10:10, a boundary itself');
  assert.equal(at('2020-03-10', 8, 0).ms, et('2020-03-10', 9, 35));
  assert.equal(at('2020-03-10', 16, 5).ms, et('2020-03-11', 9, 35));
  assert.equal(at('2020-03-10', 15, 57).ms, et('2020-03-11', 9, 35), 'the boundary reaches the close');
  assert.equal(at('2020-03-14', 12, 0).ms, et('2020-03-16', 9, 35), 'Saturday');
  assert.equal(at('2020-11-27', 12, 56).ms, et('2020-11-30', 9, 35), 'the day after Thanksgiving closes at 13:00');
  const created = '2020-03-10T15:00:00.000Z';
  const rows = [{ id: '1', createdAt: created, updatedAt: '2020-03-10T15:20:00.000Z', headline: 'h', summary: 's', symbols: ['AAA'] }, { id: '2', createdAt: created, updatedAt: '2020-03-10T15:10:00.000Z', headline: 'h', summary: 's', symbols: ['AAA'] }, { id: '3', createdAt: created, updatedAt: null, headline: 'h', summary: 's', symbols: ['AAA', 'B', 'C', 'D'] }];
  rows.forEach((r) => { r.basketSymbols = ['MU']; r.symbols = r.symbols.map((x) => (x === 'AAA' ? 'MU' : x)); });
  const it = newsItems(rows);
  assert.deepEqual([it[0].revised, it[0].summary, it[1].revised, it[1].summary], [true, null, false, 's'], 'updated 20 minutes later: possibly revised, headline and created time only');
  assert.deepEqual(it[2].stocks, [], 'four symbols: not about any one stock');
});

test('the loader admits nothing later than T, and a packet is unchanged when later data changes (prefix invariance)', () => {
  const m = market();
  const d = '2020-02-10';
  const a = item('AAA', d, 10, 2), b = item('AAA', d, 10, 7);
  const L = loaderOf(m, [a, b]);
  const p = L.packetAt({ stock: 'AAA', T: a.eligibleMs, session: d });
  assert.deepEqual(p.items.map((x) => x.id), [a.id]);
  assert.ok(p.prices.bars.every((x) => x.e <= a.eligibleMs) && p.prices.bars.length > 0);
  assert.ok(p.prices.daily.every((x) => x.date < d));
  assert.throws(() => L.packetAt({ stock: 'AAA', T: a.eligibleMs, session: d, earlierPlans: [{ T: a.eligibleMs + 1 }] }), /predate/);
  const h0 = hashOf(p);
  shape(m, 'AAA', d, 15, 0, { c: 99 });
  m.daily.get('AAA').get(d).c = 77;
  const later = item('AAA', '2020-02-11', 10, 2);
  assert.equal(hashOf(loaderOf(m, [a, b, later]).packetAt({ stock: 'AAA', T: a.eligibleMs, session: d })), h0);
});

test('the volume profile uses a prior completed session only, and builds the POC and the 70% value area as written', () => {
  const bars = [{ h: 10.0, l: 10.0, c: 10, v: 100, vw: 10 }, { h: 10.05, l: 10.05, c: 10.05, v: 300, vw: 10.05 }, { h: 10.1, l: 10.1, c: 10.1, v: 100, vw: 10.1 }, { h: 9.95, l: 9.95, c: 10, v: 50, vw: 9.95 }];
  assert.throws(() => sessionProfile(bars, { session: '2020-02-10', asOfSession: '2020-02-10' }), /prior completed session/);
  assert.throws(() => sessionProfile(bars, { session: '2020-02-11', asOfSession: '2020-02-10' }), /prior completed session/);
  const p = sessionProfile(bars, { session: '2020-02-07', asOfSession: '2020-02-10' });
  assert.ok(Math.abs(p.binSize - 0.01) < 1e-12);
  assert.ok(Math.abs(p.poc - (Math.floor(10.05 / 0.01) + 0.5) * 0.01) < 1e-9, 'the highest-volume bin');
  assert.ok(p.valueShare >= 0.7);
  assert.ok(p.vah >= 10.05 && p.val <= 10.05);
  const tie = sessionProfile([{ h: 10, l: 10, c: 10, v: 100, vw: 10.2 }, { h: 10.2, l: 10.2, c: 10.2, v: 100, vw: 10.2 }], { session: '2020-02-07', asOfSession: '2020-02-10' });
  assert.ok(Math.abs(tie.poc - (Math.floor(10.2 / tie.binSize) + 0.5) * tie.binSize) < 1e-9, 'a tie goes to the bin nearest the VWAP');
});

test('plans: bullish and bearish levels from R and m, no trade without 21 closes, DC disarmed by a negative headline, categories; wording never buys', () => {
  const m = market();
  const p = planAt(m, 'AAA', '2020-02-10', 10, 2);
  assert.equal(p.status, 'armed');
  assert.ok(Math.abs(p.m - 0.5) < 1e-12);
  assert.ok(Math.abs(p.bullish.activation.level - (p.reference.R + 0.25)) < 1e-12 && Math.abs(p.bearish.activation.level - (p.reference.R - 0.25)) < 1e-12 && Math.abs(p.invalidation.level - (p.reference.R - 0.5)) < 1e-12);
  assert.equal(planAt(m, 'AAA', '2020-01-15', 10, 2).status, 'no_trade', 'fewer than 21 earlier closes');
  assert.equal(planAt(m, 'AAA', '2020-02-10', 10, 2, { variant: 'DC', headline: 'Analyst downgrades AAA' }).bullish.armed, false);
  assert.equal(planAt(m, 'AAA', '2020-02-10', 10, 2, { variant: 'DC', headline: 'AAA soars on record results' }).bullish.armed, true);
  assert.equal(planAt(m, 'AAA', '2020-02-10', 10, 2, { headline: 'Analyst downgrades AAA' }).bullish.armed, true, 'D ignores wording');
  assert.equal(classifyHeadline('Company lowers its outlook', WORDS), 'negative');
  assert.equal(planAt(m, 'AAA', '2020-02-10', 10, 2, { kind: 'filing', form: '8-K', items: ['2.02', '9.01'] }).category, 'earnings_8k');
  assert.equal(p.category, 'news');
});

test('entry A: a bullish activation fills at the next bar open with costs; double costs and the bar and session delays move or price the fill as written', () => {
  const m = market();
  const d = '2020-02-10';
  const p = planAt(m, 'AAA', d, 10, 2);
  shape(m, 'AAA', d, 10, 20, { c: p.bullish.activation.level + 0.01 });
  shape(m, 'AAA', d, 10, 25, { o: 50.6 });
  const r = run(m, [p]);
  const buy = r.actions.find((a) => a.kind === 'buy');
  assert.equal(buy.ms, et(d, 10, 20));
  assert.ok(Math.abs(buy.detail.price - 50.6 * (1 + 5 / 10000)) < 1e-12);
  assert.ok(Math.abs(run(m, [p], 'A', { costMultiplier: 2 }).actions.find((a) => a.kind === 'buy').detail.price - 50.6 * (1 + 10 / 10000)) < 1e-12);
  assert.equal(run(m, [p], 'A', { delay: 'bar' }).actions.find((a) => a.kind === 'buy').ms, et(d, 10, 25));
  assert.equal(run(m, [p], 'A', { delay: 'session' }).actions.find((a) => a.kind === 'buy').ms, open('2020-02-11'));
  const none = planAt(m, 'AAA', '2020-02-12', 10, 2);
  assert.equal(activationOf(none, mk(m)), null, 'no level reached within 30 minutes: no trade');
});

test('a bearish activation exits a holding at the next bar open and cancels a pending entry; a gap is filled at the open', () => {
  const m = market();
  const d = '2020-02-10';
  const p = planAt(m, 'AAA', d, 10, 2, { id: 1 });
  shape(m, 'AAA', d, 10, 20, { c: p.bullish.activation.level + 0.01 });
  const q = planAt(m, 'AAA', '2020-02-11', 10, 2, { id: 2 });
  shape(m, 'AAA', '2020-02-11', 10, 15, { c: q.bearish.activation.level - 0.01 });
  shape(m, 'AAA', '2020-02-11', 10, 20, { o: 49.0 });
  const r = run(m, [p, q]);
  const sell = r.actions.find((a) => a.kind === 'sell');
  assert.deepEqual([sell.ms, sell.detail.reason], [et('2020-02-11', 10, 15), 'bearish_activation']);
  assert.ok(Math.abs(sell.detail.raw - 49.0) < 1e-12, 'filled at the gapped open');
  // B: the entry waits for a pullback; a later bearish activation before the fill cancels it.
  const m2 = market();
  const p2 = planAt(m2, 'AAA', d, 10, 2, { id: 1 });
  shape(m2, 'AAA', d, 10, 20, { c: p2.bullish.activation.level + 0.01 });
  const q2 = planAt(m2, 'AAA', d, 11, 2, { id: 2, followUp: true });
  shape(m2, 'AAA', d, 11, 15, { c: q2.bearish.activation.level - 0.01 });
  shape(m2, 'AAA', d, 11, 30, { l: 49.0, c: 49.5, h: 49.6 });
  shape(m2, 'AAA', d, 11, 40, { c: 50.0 });
  const r2 = run(m2, [p2, q2], 'B');
  assert.equal(r2.signals[0].fate, 'cancelled');
});

test('entry B and C: a touch of the level, then a later close above the touching bar\'s high, fills at the next bar; C needs the activation above the prior value-area high', () => {
  const m = market();
  const d = '2020-02-10';
  const p = planAt(m, 'AAA', d, 10, 2);
  const R = p.reference.R; // equals the prior session's close in this market
  assert.equal(R, m.daily.get('AAA').get('2020-02-07').c);
  shape(m, 'AAA', d, 10, 20, { o: R, l: R, c: p.bullish.activation.level + 0.01 });
  for (const mm of [25, 30, 35]) shape(m, 'AAA', d, 10, mm, { o: R + 0.5, h: R + 0.5, l: R + 0.5, c: R + 0.5 });
  shape(m, 'AAA', d, 10, 40, { o: R + 0.1, h: R + 0.2, l: R - 0.1, c: R + 0.1 }); // the touch
  shape(m, 'AAA', d, 10, 45, { o: R + 0.15, h: R + 0.15, l: R + 0.15, c: R + 0.15 }); // no touch, not above the touch's high
  shape(m, 'AAA', d, 10, 50, { o: R + 0.15, h: R + 0.3, l: R + 0.15, c: R + 0.3 }); // the recovery close
  shape(m, 'AAA', d, 10, 55, { o: R + 0.4, h: R + 0.4, l: R + 0.4, c: R + 0.4 });
  const r = run(m, [p], 'B');
  assert.equal(r.signals[0].fate, 'filled');
  const buyB = r.actions.find((a) => a.kind === 'buy');
  assert.equal(buyB.ms, et(d, 10, 50), 'filled at the open of the bar after the recovery close (the 10:50-10:55 bar)');
  assert.ok(Math.abs(buyB.detail.raw - (R + 0.4)) < 1e-12);
  // A bar that touches and closes above its own high is impossible, so a touch and a recovery are separate bars.
  const c = run(m, [p], 'C');
  assert.match(c.signals[0].fate, /filled|no_setup|expired/);
  const prior = mk(m).profiles('AAA', '2020-02-07', d);
  assert.ok(prior && prior.vah > 0);
  const hi = market();
  for (const b of hi.bars1.get('AAA').get('2020-02-07')) { b.h = 60; b.c = 60; b.o = 60; b.l = 60; }
  const ph = planAt(hi, 'AAA', d, 10, 2);
  shape(hi, 'AAA', d, 10, 20, { c: ph.bullish.activation.level + 0.01 });
  assert.equal(run(hi, [ph], 'C').signals[0].fate, 'no_setup', 'activation not above the prior value-area high');
});

test('plan fates: every activated bullish plan has one signal record, dated when its fate is known (no setup and disarmed at the activation, expiry at the end of the setup window)', () => {
  const d = '2020-02-10';
  const hi = market();
  for (const b of hi.bars1.get('AAA').get('2020-02-07')) { b.h = 60; b.c = 60; b.o = 60; b.l = 60; }
  const ph = planAt(hi, 'AAA', d, 10, 2);
  shape(hi, 'AAA', d, 10, 20, { c: ph.bullish.activation.level + 0.01 });
  const rc = run(hi, [ph], 'C');
  const sc = rc.actions.filter((a) => a.kind === 'signal');
  assert.equal(sc.length, 1);
  assert.deepEqual([sc[0].detail.fate, sc[0].ms], ['no_setup', et(d, 10, 20)]);
  assert.equal(planFates(rc.actions, [], []).fates.no_setup, 1);
  // B without a touch of the prior close: expired, recorded at the close of the second session after the activation.
  const m = market();
  const p = planAt(m, 'AAA', d, 10, 2);
  const R = p.reference.R;
  shape(m, 'AAA', d, 10, 20, { c: p.bullish.activation.level + 0.01 });
  const di = m.sessionIndex.get(d);
  for (const dd of m.sessions.slice(di, di + 3)) for (const b of m.bars5.get('AAA').get(dd)) if (b.e > et(d, 10, 20)) Object.assign(b, { o: R + 1, h: R + 1, l: R + 1, c: R + 1 });
  const rb = run(m, [p], 'B');
  const sb = rb.actions.filter((a) => a.kind === 'signal');
  assert.equal(sb.length, 1);
  assert.deepEqual([sb[0].detail.fate, sb[0].ms], ['expired', close(m.sessions[di + 2])]);
  assert.equal(planFates(rb.actions, [], []).fates.expired, 1);
  // DC: a negative headline disarms the bullish scenario; the record is dated at the activation and nothing is bought.
  const m2 = market();
  const q = planAt(m2, 'AAA', d, 10, 2, { variant: 'DC', headline: 'Analyst downgrades AAA' });
  shape(m2, 'AAA', d, 10, 20, { c: q.bullish.activation.level + 0.01 });
  const rq = run(m2, [q]);
  assert.deepEqual(rq.actions.filter((a) => a.kind === 'signal').map((a) => [a.detail.fate, a.ms]), [['disarmed', et(d, 10, 20)]]);
  assert.equal(rq.actions.some((a) => a.kind === 'buy'), false);
  assert.equal(planFates(rq.actions, [], []).fates.disarmed, 1);
});

test('exits: the invalidation close exits at the next session\'s first bar open; the time stop sells at the 10th session\'s close; same-time fills share the cash', () => {
  const m = market();
  const d = '2020-02-10';
  const p = planAt(m, 'AAA', d, 10, 2);
  shape(m, 'AAA', d, 10, 20, { c: p.bullish.activation.level + 0.01 });
  m.daily.get('AAA').get('2020-02-12').c = p.invalidation.level - 0.01;
  const r = run(m, [p]);
  const sell = r.actions.find((a) => a.kind === 'sell');
  assert.deepEqual([sell.detail.reason, sell.ms], ['invalidation', open('2020-02-13')]);
  const m2 = market();
  const p2 = planAt(m2, 'AAA', d, 10, 2);
  shape(m2, 'AAA', d, 10, 20, { c: p2.bullish.activation.level + 0.01 });
  const s2 = run(m2, [p2]).actions.find((a) => a.kind === 'sell');
  assert.deepEqual([s2.detail.reason, s2.detail.date], ['time_stop', m2.sessions[m2.sessionIndex.get(d) + 10]]);
  const m3 = market();
  const a = planAt(m3, 'AAA', d, 10, 2, { id: 1 }), b = planAt(m3, 'BBB', d, 10, 2, { id: 2 });
  shape(m3, 'AAA', d, 10, 20, { c: a.bullish.activation.level + 0.01 });
  shape(m3, 'BBB', d, 10, 20, { c: b.bullish.activation.level + 0.01 });
  const buys = run(m3, [a, b]).actions.filter((x) => x.kind === 'buy');
  assert.equal(buys.length, 2);
  for (const x of buys) assert.ok(x.detail.caps.cash <= Math.floor(7500 / x.detail.price) + 1e-9 && x.detail.cost <= 0.2 * 15000 + 1e-6);
});

test('splits and dividends reach a holding; the evaluation pass reconciles net profit with the trades and the open position; plan fates', () => {
  const m = market();
  const d = '2020-02-10';
  const p = planAt(m, 'AAA', d, 10, 2);
  shape(m, 'AAA', d, 10, 20, { c: p.bullish.activation.level + 0.01 });
  const extra = { splits: [{ symbol: 'AAA', date: '2020-02-12', ratio: 2 }], dividends: [{ symbol: 'AAA', exDate: '2020-02-13', payDate: '2020-02-14', amount: 0.1 }] };
  for (const dd of m.sessions.filter((x) => x >= '2020-02-12')) { const x = m.daily.get('AAA').get(dd); x.c /= 2; x.o /= 2; x.h /= 2; x.l /= 2; for (const b of m.bars5.get('AAA').get(dd)) { b.o /= 2; b.h /= 2; b.l /= 2; b.c /= 2; } }
  const r = runReplay({ plans: [p], treatment: 'A', market: mk(m, extra), costs: COSTS, portfolio: PORT, from: m.sessions[0], to: m.sessions.at(-1) });
  const buy = r.actions.find((a) => a.kind === 'buy'), split = r.actions.find((a) => a.kind === 'split');
  assert.equal(split.detail.sharesAfter, buy.detail.shares * 2);
  assert.ok(r.actions.some((a) => a.kind === 'dividend_paid' && Math.abs(a.detail.amount - buy.detail.shares * 2 * 0.1 * 0.85) < 1e-9));
  const res = evaluateActions(r.actions, mk(m, extra), { from: m.sessions[0], to: m.sessions.at(-1), startingCash: 15000, symbols: m.syms });
  const days = new Map(m.sessions.map((dd) => [dd, { bars: Object.fromEntries(m.syms.map((s) => [s, m.daily.get(s).get(dd)])), splits: [], dividends: [] }]));
  const index = holdIndex({ symbols: m.syms, sessions: m.sessions, days, start: m.sessions[0], startingCash: 15000 });
  const rep = report(res, { index, startingCash: 15000, signals: r.signals });
  assert.equal(rep.accounting.ok, true, rep.accounting.problems.join('; '));
  assert.equal(planFates(r.actions, res.trades, res.openPositions, new Map([[1, 'news']])).fates.activated_then_gain + (planFates(r.actions, res.trades, res.openPositions).fates.activated_then_loss_at_exit || 0) || 1, 1);
});

test('the executor is deterministic and prefix-invariant: changing bars after a time changes no earlier action', () => {
  const m = market();
  const plans = ['2020-02-10', '2020-02-18', '2020-03-02'].map((dd, i) => { const p = planAt(m, 'AAA', dd, 10, 2, { id: i + 1 }); shape(m, 'AAA', dd, 10, 20, { c: p.bullish.activation.level + 0.01 }); return p; });
  const r1 = run(m, plans);
  assert.deepEqual(run(m, plans), r1);
  const cut = open('2020-02-25');
  for (const dd of m.sessions.filter((x) => x >= '2020-02-25')) { for (const b of m.bars5.get('AAA').get(dd)) { b.o += 3; b.c += 3; b.h += 3; b.l += 3; } m.daily.get('AAA').get(dd).c += 3; }
  const r2 = run(m, plans.slice(0, 2));
  const before = (r) => r.actions.filter((a) => a.ms < cut).map((a) => JSON.stringify(a));
  assert.deepEqual(before(r2), before(r1).filter((x) => !x.includes('"planId":3')));
});

test('plans and actions are append-only and hash-chained; a changed record breaks the chain; the guard refuses other programmes\' files', () => {
  const dir = tempDir('nr-');
  const db = store.openNrDb(path.join(dir, 'news-replay.sqlite'));
  for (let i = 0; i < 3; i++) store.insertPlan(db, { planner: 'D', stock: 'AAA', session: `2020-02-1${i}`, eligibleMs: i, packetHash: sha256(String(i)), plan: { i }, at: 'now', codeRevision: 'x' });
  const rows = store.listPlans(db, 'D');
  const content = (r) => `${r.packetHash}|${sha256(JSON.stringify(r.plan))}`;
  assert.equal(store.verifyChain(rows, content).ok, true);
  rows[1].plan = { i: 99 };
  assert.equal(store.verifyChain(rows, content).ok, false);
  store.putAiCache(db, { packetHash: 'p', variant: 'AI', model: 'm', promptSha: 's' }, { stance: 'no_trade' }, null, 'now');
  for (const sql of ["UPDATE nr_plans SET plan_json = '{}'", 'DELETE FROM nr_plans', "UPDATE nr_ai_cache SET response_json = '{}'", 'DELETE FROM nr_ai_cache']) assert.throws(() => db.exec(sql), /append-only/);
  const runId = store.startRun(db, { configId: 'D-A', variant: 'base', configHash: 'h', codeRevision: 'x', manifestHash: 'm', startedAt: 'now' });
  store.insertActions(db, runId, [{ ms: 1, stock: 'AAA', kind: 'buy', detail: { a: 1 } }]);
  assert.throws(() => db.exec('UPDATE nr_actions SET kind = \'sell\''), /append-only/);
  store.finishRun(db, runId, { status: 'done', summary: {}, at: 'now', durationMs: 1 });
  assert.throws(() => db.exec('UPDATE nr_runs SET status = \'failed\''), /never changed/);
  for (const n of ['hxr-sim.sqlite', 'event-swing.sqlite', 'prospective-1.sqlite', 'signal-desk.sqlite']) assert.throws(() => store.openNrDb(path.join(dir, n)), /never opens/);
  db.close();
});

test('the AI planner: the validator rejects a fact without a source, a date or year after T and a later event; a cached replay makes zero calls; masking hides names and shifts dates', async () => {
  const m = market();
  const it = item('AAA', '2020-02-10', 10, 2, { headline: 'AAA (Micron) news' });
  const packet = loaderOf(m, [it]).packetAt({ stock: 'AAA', T: it.eligibleMs, session: '2020-02-10' });
  const good = { stance: 'plan', facts: [{ text: 'a report was published', source_ids: [it.id] }], uncertainties: [], affected_why: 'x', bullish_activation_m: 0.5, bearish_activation_m: 1.0, bearish_action: 'exit', invalidation_m: 1.0, holding_sessions: 5, contradiction_rule: 'cancel' };
  assert.equal(validateAiPlan(good, packet, SPEC).ok, true);
  assert.match(validateAiPlan({ ...good, facts: [{ text: 'x', source_ids: [] }] }, packet, SPEC).problems.join(' '), /no source id/);
  assert.match(validateAiPlan({ ...good, facts: [{ text: 'x', source_ids: ['news:other'] }] }, packet, SPEC).problems.join(' '), /not in the packet/);
  assert.match(validateAiPlan({ ...good, contradiction_rule: 'as happened on 2020-03-16' }, packet, SPEC).problems.join(' '), /after T/);
  assert.match(validateAiPlan({ ...good, uncertainties: ['the 2021 recovery'] }, packet, SPEC).problems.join(' '), /year 2021/);
  assert.match(validateAiPlan({ ...good, uncertainties: ['the pandemic'] }, packet, SPEC).problems.join(' '), /later event/);
  const db = store.openNrDb(path.join(tempDir('nr-'), 'news-replay.sqlite'));
  let calls = 0;
  const backend = async () => { calls++; return { json: good, usage: { input_tokens: 1 } }; };
  const live = createAiPlanner({ db, spec: SPEC, backend, allowCalls: true });
  const first = await live.plan(packet, 'AI');
  assert.equal(first.plan.status, 'armed'); assert.equal(calls, 1);
  const replay = createAiPlanner({ db, spec: SPEC, backend: null, allowCalls: false });
  const again = await replay.plan(packet, 'AI');
  assert.deepEqual(again.plan, first.plan); assert.equal(calls, 1); assert.equal(replay.calls, 0);
  await assert.rejects(replay.plan(packet, 'AIM'), /not cached and calls are not allowed/);
  const masked = maskPacket({ ...packet, stock: 'MU', items: packet.items.map((x) => ({ ...x, headline: 'Micron Technology (MU) on 2020-02-10' })) }, SPEC);
  assert.equal(masked.stock, 'STOCK_A');
  assert.ok(!/Micron|\bMU\b|2020-02-10/.test(masked.items[0].headline));
  assert.match(masked.items[0].headline, /COMPANY_A|STOCK_A/);
  db.close();
});

test('the four plain-English answers say both "made money" and "does not qualify"; the page service is read-only and its inspector shows the plan, the action and the outcome separately', () => {
  const matrix = JSON.parse(fs.readFileSync(new URL('../strategy/news-replay/matrix-v1.json', import.meta.url), 'utf8'));
  const rep = (net, T, extra = {}) => ({ net, T, costs: 120.5, totalReturnPct: net / 150, annualisedReturnPct: net / 300, maxDrawdownPct: 6, avgInvestedPct: 40, timeInCashPct: 60, turnoverPerYear: 3.2, completedTrades: 12, openAtEnd: 0, index: { net: 9000, maxDrawdownPct: 35 }, exposureMatched: { net: net - T, maxDrawdownPct: 15 }, holdingSessions: { median: 4, longest: 10 }, concentration: { topStock: 'MU', topShare: 0.3 }, ...extra });
  const by = new Map([['D-A|base', rep(800, -50)], ['P-A|base', rep(300, 20)]]);
  const pending = Object.fromEntries(matrix.inference.holmFamily.map((id) => [id, { statistic: null, p: null, holmP: null, significant: false, status: 'pending: the placebo has not run yet' }]));
  const a = fourAnswers('D-A', by, pending, matrix);
  assert.match(a.money, /^Yes\. D-A made US\$800\.00 after US\$120\.50 of modelled costs/);
  assert.match(a.money, /not met \(.*the placebo test of its comparisons has not finished.*fewer than 30.*\)/);
  assert.match(a.money, /It made money in this simulation and it does not qualify; both are true\./);
  assert.match(a.controls, /Against its price-only control P-A .*ahead by US\$500\.00 in net profit .*behind by US\$70\.00 on T.*did not beat its matched control/);
  assert.match(a.controls, /did not beat holding the basket/);
  assert.match(a.controls, /T = -US\$50\.00, so it did not beat it/);
  assert.match(a.risk, /Maximum drawdown 6\.00%/);
  assert.match(a.evidence, /12 completed trades .*too few to judge/);
  assert.match(fourAnswers('P-A', by, pending, matrix).money, /only ever the control arm/);
  // The service: a temporary database with one plan, one run and its records.
  const dir = tempDir('nr-svc-');
  const db = store.openNrDb(store.nrDbFile(dir));
  store.insertNews(db, [{ id: '42', created_at: '2020-02-10T15:00:00Z', createdEtDate: '2020-02-10', headline: 'AAA reports results', source: 'test', symbols: ['MU'], basketSymbols: ['MU'] }], 'now');
  const T = et('2020-02-10', 10, 10);
  const plan = { planner: 'D', stock: 'MU', session: '2020-02-10', T, followUp: false, category: 'news', status: 'armed', facts: [{ text: 'news item', sourceIds: ['news:42'] }], reference: { R: 50, source: 'x' }, m: 1, bullish: { armed: true, activation: { level: 50.5, windowEndMs: T + 1800000 }, action: 'enter long' }, bearish: { activation: { level: 49.5, windowEndMs: T + 1800000 }, action: 'exit' }, noTrade: 'neither', invalidation: { level: 49 }, exit: { rule: 'time stop' }, expirySession: '2020-02-12', uncertainties: [] };
  store.insertPlan(db, { planner: 'D', stock: 'MU', session: '2020-02-10', eligibleMs: T, packetHash: 'p'.repeat(64), plan, at: '2026-11-06T00:00:00Z', codeRevision: 'test' });
  const planId = store.plansPage(db, { planner: 'D' }).rows[0].id;
  const runId = store.startRun(db, { configId: 'D-A', variant: 'base', configHash: 'c'.repeat(64), codeRevision: 'test', manifestHash: 'm'.repeat(64), startedAt: 'now' });
  store.insertActions(db, runId, [
    { ms: T + 600000, stock: 'MU', kind: 'activation', detail: { planId, followUp: false, dir: 'bull', barEnd: T + 600000, close: 50.6 } },
    { ms: T + 600000, stock: 'MU', kind: 'buy', detail: { shares: 10, price: 50.7, raw: 50.68, cost: 507, inv: 49, tradeId: 1, planId } },
    { ms: T + 600000, stock: 'MU', kind: 'signal', detail: { planId, fate: 'filled', why: null } },
    { ms: T + 86400000, stock: 'MU', kind: 'sell', detail: { shares: 10, price: 52, raw: 52.02, proceeds: 519.9, reason: 'time_stop', tradeId: 1 } },
  ]);
  store.finishRun(db, runId, { status: 'done', summary: { report: rep(12.9, 3) }, at: 'now', durationMs: 1 });
  db.close();
  const svc = createNewsReplayService({ mode: 'real', cfg: { dataDir: dir } });
  const before = fs.statSync(store.nrDbFile(dir)).mtimeMs;
  const o = svc.overview();
  assert.equal(o.configs.find((c) => c.id === 'D-A').report.net, 12.9);
  assert.match(o.configs.find((c) => c.id === 'AI-A').notRun, /no API spending authorised/);
  assert.equal(o.comparisons.find((c) => c.id === 'C3').status, 'not run: no API spending authorised');
  const d = svc.plan(planId, 'D-A');
  assert.deepEqual([d.inputs.items[0].headline, d.activation.detail.dir, d.action.detail.fate, d.nextFill.shares], ['AAA reports results', 'bull', 'filled', 10]);
  assert.equal(d.outcome.pnlFromRecords, 12.9);
  assert.throws(() => svc.plan(planId, 'P-A'), /belongs to planner D/);
  assert.throws(() => svc.plans({ config: 'AI-A' }), /no API spending authorised/);
  svc.close();
  assert.equal(fs.statSync(store.nrDbFile(dir)).mtimeMs, before, 'reading changes nothing');
  assert.equal(createNewsReplayService({ mode: 'demo', cfg: {} }).overview().demo, true);
});

// ---------- campaign 2: the AMT exits (CAMPAIGN-2.md sections 3 to 7) ----------
const runX = (m, plans, exit, o = {}) => runReplay({ plans, treatment: 'A', market: mk(m, o.market), costs: COSTS, portfolio: PORT, from: m.sessions[0], to: m.sessions.at(-1), delay: o.delay ?? null, exit });
const sellOf = (r) => r.actions.find((a) => a.kind === 'sell');
const armedAt = (m, d = '2020-02-10') => { const p = planAt(m, 'AAA', d, 10, 2); shape(m, 'AAA', d, 10, 20, { c: p.bullish.activation.level + 0.01 }); return p; };

test('campaign 2: 30-minute bars from 5-minute bars (early closes included); the composite target; X1 is campaign 1 unchanged', () => {
  const m = market({ from: '2020-11-20', to: '2020-12-04' });
  const M = mk(m), arr = M.flat.get('AAA');
  const day = (d) => { const i = arr.findIndex((b) => b.date === d); let j = i; while (j + 1 < arr.length && arr[j + 1].date === d) j++; return thirtyMinuteBars(arr, i, j, open, close); };
  assert.equal(day('2020-11-23').length, 13);
  const early = day('2020-11-27');
  assert.equal(early.length, 7, 'the early close at 13:00 gives seven windows');
  assert.equal(early.at(-1).e, close('2020-11-27'));
  assert.deepEqual([early[0].s, early[0].e, early[0].lastI - arr.findIndex((b) => b.date === '2020-11-27')], [open('2020-11-27'), open('2020-11-27') + 1800000, 5]);
  const sess = (d, prices) => ({ session: d, bars: prices.map(([p, v]) => ({ h: p, l: p, c: p, v })) });
  const c = compositeTarget([sess('2020-02-06', [[51, 100], [52, 300]]), sess('2020-02-07', [[52.5, 300], [50, 10]])], { fillSession: '2020-02-10', fillPrice: 50.2 });
  assert.ok(c.target > 51.94 && c.target <= 52, `ties go to the lower price (${c.target})`);
  assert.equal(compositeTarget([sess('2020-02-07', [[50, 10]])], { fillSession: '2020-02-10', fillPrice: 60 }), null);
  assert.throws(() => compositeTarget([sess('2020-02-10', [[50, 10]])], { fillSession: '2020-02-10', fillPrice: 40 }), /completed before the fill session/);
  const m1 = market(); const p1 = armedAt(m1);
  assert.deepEqual(runX(m1, [p1], 'existing').actions, run(m1, [p1]).actions, 'exit "existing" is nr-engine-1');
  const buy1 = runX(m1, [p1], 'existing').actions.find((x) => x.kind === 'buy');
  assert.deepEqual(Object.keys(buy1.detail).sort(), ['T', 'caps', 'cost', 'date', 'inv', 'planId', 'price', 'raw', 'shares', 'tradeId'], 'the campaign 1 buy record has no exit plan');
});

test('campaign 2 X2: a counted 30-minute close with VAL <= close < POC sells at the next 5-minute open; the window holding the fill is not counted; POC itself does not exit', () => {
  const prof = { profiles: () => ({ val: 49.0, poc: 49.5, vah: 49.9 }) };
  const d = '2020-02-10';
  const m = market(); const p = armedAt(m);
  shape(m, 'AAA', d, 10, 30, { c: 49.2 }); // inside value, but in the window that holds the fill (10:00-10:30)
  shape(m, 'AAA', d, 11, 30, { c: 49.2 }); // the window 11:00-11:30 closes inside value, below the POC
  const s = sellOf(runX(m, [p], 'acceptance', { market: prof }));
  assert.deepEqual([s.detail.reason, s.ms], ['acceptance', et(d, 11, 30)]);
  const mDelay = market(); const pD = armedAt(mDelay); shape(mDelay, 'AAA', d, 11, 30, { c: 49.2 });
  assert.equal(sellOf(runX(mDelay, [pD], 'acceptance', { market: prof, delay: 'bar' })).ms, et(d, 11, 35), 'one bar later');
  const m2 = market(); const p2 = armedAt(m2); shape(m2, 'AAA', d, 11, 30, { c: 49.5 });
  assert.notEqual(sellOf(runX(m2, [p2], 'acceptance', { market: prof })).detail.reason, 'acceptance', 'a close at the POC is not below it');
  const m3 = market(); const p3 = armedAt(m3); shape(m3, 'AAA', d, 11, 30, { c: 49.0 });
  assert.equal(sellOf(runX(m3, [p3], 'acceptance', { market: prof })).detail.reason, 'acceptance', 'a close at the value-area low is inside');
  // Prefix invariance: changing bars after the exit changes no earlier action.
  const m4 = market(); const p4 = armedAt(m4); shape(m4, 'AAA', d, 11, 30, { c: 49.2 });
  const a4 = runX(m4, [p4], 'acceptance', { market: prof }).actions;
  shape(m4, 'AAA', '2020-02-12', 12, 0, { c: 40 });
  const b4 = runX(m4, [p4], 'acceptance', { market: prof }).actions;
  const cut = et(d, 11, 30);
  assert.deepEqual(b4.filter((x) => x.ms <= cut), a4.filter((x) => x.ms <= cut));
});

test('campaign 2 X3 and X4: the target (primary, composite, one-cent touch, gap at the open, from the bar after the fill); the activation bar low; precedence', () => {
  const d = '2020-02-10';
  const prof = { profiles: () => ({ val: 49.0, poc: 49.5, vah: 50.0 }) }; // primary target 51.0
  const m = market(); const p = armedAt(m);
  shape(m, 'AAA', d, 10, 25, { h: 51.5 }); // the fill bar itself: not active yet
  shape(m, 'AAA', d, 11, 0, { h: 51.005 }); // less than one cent beyond: no fill
  shape(m, 'AAA', d, 11, 30, { h: 51.02 });
  const r = runX(m, [p], 'target', { market: prof });
  const s = sellOf(r);
  assert.deepEqual([s.detail.reason, s.ms, s.detail.raw], ['target', et(d, 11, 25), 51.0]);
  assert.equal(r.actions.find((a) => a.kind === 'buy').detail.exitPlan.source, 'primary');
  const g = market(); const pg = armedAt(g); shape(g, 'AAA', d, 11, 30, { o: 51.3, h: 51.3, c: 51.3 });
  assert.equal(sellOf(runX(g, [pg], 'target', { market: prof })).detail.raw, 51.3, 'a gap through the target fills at the open');
  const cm = market(); const pc = armedAt(cm);
  const rc = runX(cm, [pc], 'target', { market: { profiles: () => ({ val: 48, poc: 48.5, vah: 49 }), composite: () => ({ target: 52 }) } });
  const plan = rc.actions.find((a) => a.kind === 'buy').detail.exitPlan;
  assert.deepEqual([plan.source, plan.target], ['composite', 52], 'entered at or above the primary target: the composite');
  // A bearish exit scheduled for a bar's open fills before a touch in the same bar.
  const b = market(); const pb = armedAt(b);
  const q = planAt(b, 'AAA', d, 11, 2, { id: 2, followUp: true });
  shape(b, 'AAA', d, 11, 15, { c: q.bearish.activation.level - 0.01 });
  shape(b, 'AAA', d, 11, 20, { h: 51.5 });
  assert.equal(sellOf(runX(b, [pb, q], 'target', { market: prof })).detail.reason, 'bearish_activation');
  // X4: a 30-minute close strictly below the activation bar's low.
  const x = market(); const px4 = planAt(x, 'AAA', d, 10, 2); shape(x, 'AAA', d, 10, 20, { c: px4.bullish.activation.level + 0.01, l: 50.3 });
  const s4 = sellOf(runX(x, [px4], 'price_only'));
  assert.deepEqual([s4.detail.reason, s4.ms], ['price_only', et('2020-02-11', 10, 0)], 'the next session first window closes at 50, below 50.3');
  const y = market(); const py = planAt(y, 'AAA', d, 10, 2); shape(y, 'AAA', d, 10, 20, { c: py.bullish.activation.level + 0.01, l: 50.0 });
  assert.notEqual(sellOf(runX(y, [py], 'price_only')).detail.reason, 'price_only', 'a close equal to the level does not exit');
});
