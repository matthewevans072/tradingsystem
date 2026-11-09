// prop-sim Phase 2, the live simulated account (strategy/prop-sim/LIVE-1.md): synthetic live streams only. Determinism
// against the Phase 1 engine on the same bars (the pure engine and a full stream through the store, the fake feed and
// the worker's step); decisions recorded before fills; the rules at their exact limits (the open position's worst point
// at the Max Loss Limit, the live grace, the decision grace, the flat-by time); gaps (flat across, nothing decided or
// backfilled); late bars; restart from the checkpoint; the worker control row; the IEX client's host and date guards;
// the read-only overview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { tradingDays } from '../server/strategy/sessions.js';
import { buildMarket } from '../server/propsim/market.js';
import { runSignals } from '../server/propsim/signals.js';
import { runAttempts } from '../server/propsim/account.js';
import { loadMatrix } from '../server/propsim/config.js';
import { mulberry32 } from '../server/research/runner.js';
import * as ls from '../server/propsim/live-store.js';
import { sessionMarket, runLiveSession, observation, liveAccount, dayDetail, bounds, bucketCount, bucketEnd, ceilMinute } from '../server/propsim/live.js';
import { createLive, runLiveWorker, nextWake } from '../server/propsim/live-worker.js';
import { createIexSource } from '../server/propsim/live-source.js';
import { loadLiveConfig, liveFileHashes, LIVE_PREREG } from '../server/propsim/live-config.js';

const M = loadMatrix();
const CFG = loadLiveConfig();
const MIN = 60000;
const KEYS = ['date', 'window', 'setupMs', 'why', 'd', 'entryType', 'ref', 'fill', 'stop', 'target', 'riskTicks', 'fillMs', 'exitMs', 'exit', 'kind', 'resultTicks', 'maeTicks'];
const pick = (t) => JSON.stringify(KEYS.map((k) => t[k]));
const DATES = tradingDays('2026-11-10', '2026-12-11', 'NYSE');

// A random walk of 1-minute QQQ-like bars (dollars) over the given sessions; rows carry their start (s).
function walk(dates, seed = 7) {
  const rng = mulberry32(seed);
  let p = 500;
  const rows = [];
  for (const d of dates) {
    const b = bounds(d);
    p += (rng() - 0.5) * 6;
    for (let i = 0; i < Math.round((b.close - b.open) / MIN); i++) {
      const o = p; p = Math.max(1, p + (rng() - 0.5) * 0.5 + (rng() < 0.02 ? (rng() - 0.5) * 3 : 0));
      rows.push({ date: d, minute: 570 + i, s: b.open + i * MIN, o, h: Math.max(o, p) + rng() * 0.15, l: Math.min(o, p) - rng() * 0.15, c: p, v: 100 });
    }
  }
  return rows;
}
// One session from 5-minute specs in ticks (ratio 1, tick 1): the first minute carries the bar's range.
function dayRows(date, spec) {
  const b = bounds(date), rows = [];
  for (let k = 0; k < bucketCount(b); k++) {
    const x = spec(k);
    for (let j = 0; j < 5; j++) { const s = b.open + (k * 5 + j) * MIN; if (s >= b.close) break; rows.push({ date, minute: 570 + k * 5 + j, s, ...(j === 0 ? x : { o: x.c, h: x.c, l: x.c, c: x.c }), v: 100 }); }
  }
  return rows;
}
const M1 = { ...M, dataSource: { ...M.dataSource, ratio: { NQ: 1, ES: 1 }, tickPoints: 1 } };

// A fake IEX feed over `rows`: a bar is served once its minute has ended plus `delayMs`, unless dropped.
function fakeFeed(rows, clock, { delayMs = 0, drop = () => false, fail = () => false } = {}) {
  const calls = [];
  return {
    calls,
    async bars1m(sym, startMs, endMs) {
      calls.push({ sym, startMs, endMs, at: clock.t });
      if (fail(clock.t)) throw new Error('feed down');
      return rows.filter((r) => r.s >= startMs && r.s < endMs && r.s + MIN + delayMs <= clock.t && !drop(r, clock.t)).map((r) => ({ ms: r.s, date: r.date, minutes: r.minute, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
    },
  };
}
function liveFor(dir, rows, clock, { matrix = M, feedOpts = {}, cfg = CFG } = {}) {
  const db = ls.openPlDb(ls.plDbFile(dir));
  const feed = fakeFeed(rows, clock, feedOpts);
  const live = createLive({ db, source: feed, cfg, matrix, clock: () => new Date(clock.t), checks: false });
  return { db, feed, live };
}
// Drive the step at the given instants of each session (fn(b) -> list of ms), then finalize every session.
async function stream(live, clock, dates, at) {
  for (const d of dates) {
    const b = bounds(d);
    for (const t of at(b, d)) { clock.t = t; await live.step(); }
    clock.t = b.close + 25 * MIN; await live.step();
  }
}
const everyMinute = (offsetMs) => (b) => { const out = []; for (let t = b.open + MIN + offsetMs; t <= b.close + 2 * MIN; t += MIN) out.push(t); return out; };
const activateAt = (live, clock, date) => { clock.t = bounds(date).open - 24 * 3600000; const r = live.activate(); assert.equal(r.startSession, date); return r; };

test('the live document and configuration match their pins; the configuration is a Phase 1 configuration on the IEX feed', () => {
  assert.match(LIVE_PREREG.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(liveFileHashes(), { ...LIVE_PREREG.sha256 });
  assert.equal(CFG.traded, 'LB-NQ'); assert.equal(CFG.feed.feed, 'iex'); assert.equal(CFG.feed.origin, 'https://data.alpaca.markets');
});

test('prop-sim live store: only its own file (Phase 1 refused), nothing before 2026-11-10, append-only, the bar admission rule', () => {
  const dir = tempDir('psl-store-');
  for (const f of ['prop-sim.sqlite', 'news-forward.sqlite', 'hxr-sim.sqlite']) assert.throws(() => ls.openPlDb(path.join(dir, f)), /refuses/);
  const db = ls.openPlDb(ls.plDbFile(dir));
  const b = bounds('2026-11-10');
  assert.throws(() => ls.insertBars(db, 'QQQ', [{ date: '2026-11-09', minute: 570, s: 0, o: 1, h: 1, l: 1, c: 1 }], { fetchedMs: 1, kind: 'live', graceMs: 90000 }), /CHECK/);
  const row = (m, extra = {}) => ({ date: '2026-11-10', minute: m, s: b.open + (m - 570) * MIN, o: 1, h: 1, l: 1, c: 1, ...extra });
  // Exactly at the grace: live; one millisecond after: not live.
  assert.equal(ls.insertBars(db, 'QQQ', [row(570)], { fetchedMs: b.open + MIN + 90000, kind: 'live', graceMs: 90000 }).live, 1);
  assert.equal(ls.insertBars(db, 'QQQ', [row(571)], { fetchedMs: b.open + 2 * MIN + 90001, kind: 'live', graceMs: 90000 }).live, 0);
  // A bar of an earlier minute after a later one is stored: not live. A bar of a decided bucket: not live.
  ls.insertBars(db, 'QQQ', [row(574)], { fetchedMs: b.open + 5 * MIN, kind: 'live', graceMs: 90000 });
  assert.equal(ls.insertBars(db, 'QQQ', [row(573)], { fetchedMs: b.open + 5 * MIN + 1, kind: 'live', graceMs: 90000 }).live, 0);
  ls.insertBucket(db, { session: '2026-11-10', k: 1, endMs: b.open + 10 * MIN, recordedMs: b.open + 10 * MIN, status: 'on_time', evaluation: {}, codeRevision: 'x' });
  assert.equal(ls.insertBars(db, 'QQQ', [row(579)], { fetchedMs: b.open + 10 * MIN + 1000, kind: 'live', graceMs: 90000 }).live, 0);
  assert.equal(ls.insertBars(db, 'QQQ', [row(580)], { fetchedMs: b.open + 11 * MIN + 1000, kind: 'reference', graceMs: 90000 }).live, 0, 'reference bars are never live');
  ls.insertPoll(db, { session: '2026-11-10', atMs: b.open + MIN, ok: true });
  ls.insertSession(db, '2026-11-10', '2026-11-10T21:20:00Z', {}, 'x');
  assert.throws(() => ls.insertPoll(db, { session: '2026-11-09', atMs: 1, ok: true }), /CHECK/);
  for (const sql of ['UPDATE pl_bars SET c = 2', 'DELETE FROM pl_buckets', 'UPDATE pl_polls SET ok = 0', 'DELETE FROM pl_sessions']) assert.throws(() => db.prepare(sql).run(), /append-only/);
  // The control row: a live heartbeat refuses a second worker; a stale one is taken over.
  assert.equal(ls.claimWorker(db, { token: 'a', pid: 1, at: '2026-11-10T15:00:00Z', staleMs: 600000 }).ok, true);
  assert.equal(ls.claimWorker(db, { token: 'b', pid: 2, at: '2026-11-10T15:05:00Z', staleMs: 600000 }).ok, false);
  assert.equal(ls.claimWorker(db, { token: 'b', pid: 2, at: '2026-11-10T15:11:00Z', staleMs: 600000 }).ok, true);
  db.close();
});

test('determinism against Phase 1: with every decision recorded at its bar close and every minute observed, the live engine gives runSignals trades for F1, F2, F3 and LB', () => {
  const rows = walk(DATES).map((r) => ({ ...r, live: true, fetchedMs: 0 }));
  const opts = { ratio: 41, tickPoints: 0.25 };
  const market = buildMarket(rows, opts);
  for (const fam of ['F1', 'F2', 'F3', 'LB']) {
    const p1 = runSignals(market, fam, M).trades;
    const live = [];
    for (const d of DATES) {
      const b = bounds(d), records = new Map();
      for (let k = 0; k < bucketCount(b); k++) records.set(k, { recordedMs: bucketEnd(b, k), status: 'on_time' });
      live.push(...runLiveSession({ s: sessionMarket(rows, d, opts), family: fam, matrix: M, records, nowMs: b.close + 3600000, graceMs: 90000 }).trades.filter((t) => t.status === 'closed'));
    }
    assert.ok(p1.length > 0, `${fam} has trades on the synthetic walk`);
    assert.deepEqual(live.map(pick), p1.map(pick), `${fam}: the live trades are Phase 1's`);
  }
});

test('a full stream through the store, the fake feed and the step, decided at each bar close, reproduces Phase 1 (LB-NQ) and its account', async () => {
  const dates = DATES.slice(0, 5);
  const rows = walk(dates, 11);
  const clock = { t: 0 };
  const { db, live } = liveFor(tempDir('psl-stream-'), rows, clock);
  activateAt(live, clock, dates[0]);
  // A step exactly at every minute end: the bar is in at once, so each decision is recorded at its bar's close.
  await stream(live, clock, dates, (b) => { const out = []; for (let t = b.open + MIN; t <= b.close; t += MIN) out.push(t); return out; });
  const buckets = ls.allBuckets(db);
  assert.ok(buckets.every((x) => x.status === 'on_time' && x.recordedMs === x.endMs));
  const p1 = runSignals(buildMarket(rows, { ratio: 41, tickPoints: 0.25 }), 'LB', M).trades;
  const reps = ls.sessionReports(db);
  assert.equal(reps.length, dates.length, 'every session finalized');
  const liveTrades = reps.flatMap((r) => r.report.trades.filter((t) => t.status === 'closed'));
  assert.ok(p1.length > 0);
  assert.deepEqual(liveTrades.map(pick), p1.map(pick));
  const v = live.verify();
  assert.equal(v.chain.ok, true); assert.deepEqual(v.mismatches, []);
  // The account: the first attempt is Phase 1's attempt from the first session (here, short horizons to see several).
  const horizons = { evaluationSessions: 2, fundedSessions: 2 };
  const byDate = new Map(dates.map((d) => [d, p1.filter((t) => t.date === d)]));
  const acc = liveAccount({ dates, finalCount: dates.length, tradesByDate: byDate, plan: M.accounts.primary, tickValue: 0.5, exec: M.execution, horizons });
  const ref = runAttempts({ dates, trades: p1, plan: M.accounts.primary, tickValue: 0.5, exec: M.execution, horizons });
  for (const a of acc.attempts) {
    const r = ref.find((x) => x.start === a.start);
    assert.ok(r, `Phase 1 has an attempt from ${a.start}`);
    assert.equal(a.eval, r.eval); assert.equal(a.evalSessions, r.evalSessions); assert.equal(a.funded, r.funded);
  }
  assert.ok(acc.attempts.length >= 2, 'several attempts, one after another');
  for (let i = 1; i < acc.attempts.length; i++) assert.ok(acc.attempts[i].start > acc.attempts[i - 1].end, 'each attempt starts after the previous one ended');
  db.close();
});

test('decisions before fills: a decision recorded seconds after the close fills only from the next minute; every fill starts after its record', async () => {
  const dates = DATES.slice(0, 4);
  const rows = walk(dates, 11);
  const clock = { t: 0 };
  const { db, live } = liveFor(tempDir('psl-delay-'), rows, clock, { feedOpts: { delayMs: 3000 } });
  activateAt(live, clock, dates[0]);
  // The worker's own timing: 5 seconds after each minute.
  await stream(live, clock, dates, everyMinute(5000));
  const trades = ls.sessionReports(db).flatMap((r) => r.report.trades.filter((t) => t.status === 'closed'));
  assert.ok(trades.length > 0);
  for (const t of trades) {
    assert.ok(t.recordedMs > t.setupMs && t.recordedMs - t.setupMs <= 45000, 'recorded within seconds of the close');
    assert.equal(t.t0, ceilMinute(t.recordedMs));
    assert.ok(t.fillMs >= t.recordedMs, 'the fill bar starts after the decision was recorded');
  }
  assert.ok(ls.allBuckets(db).every((x) => x.status === 'on_time'));
  // Phase 1 on the same bars fills one minute earlier: the live trades differ only by that delay.
  const p1 = runSignals(buildMarket(rows, { ratio: 41, tickPoints: 0.25 }), 'LB', M).trades;
  assert.ok(p1.some((x) => x.fillMs === x.setupMs) && trades.every((x) => x.fillMs > x.setupMs));
  assert.deepEqual(live.verify().mismatches, []);
  db.close();
});

test('a limit touched only in the minute the decision was being recorded does not fill', () => {
  const d = '2026-11-12', b = bounds(d);
  const prev = dayRows('2026-11-11', () => ({ o: 1000, h: 1010, l: 990, c: 1000 }));
  // A break of PDH 1010 at the 10:00 close; the market entry is the open of the first bar at or after t0.
  const today = dayRows(d, (k) => (k === 5 ? { o: 1000, h: 1016, l: 999, c: 1015 } : k > 5 ? { o: 1015, h: 1016, l: 1014, c: 1015 } : { o: 1000, h: 1001, l: 999, c: 1000 }));
  const rows = [...prev, ...today].map((r) => ({ ...r, live: true, fetchedMs: 0 }));
  // The first bar after the close opens at 1000 by construction of dayRows (k = 6 starts at 1015): set the 10:00 bar's
  // open apart from the 10:01 bar's to see which one fills.
  const at = rows.find((r) => r.date === d && r.minute === 600); at.o = 1020; at.h = Math.max(at.h, 1020);
  const s = sessionMarket(rows, d, { ratio: 1, tickPoints: 1 });
  const rec = (recMs) => { const m = new Map(); for (let k = 0; k < bucketCount(b); k++) m.set(k, { recordedMs: k === 5 ? recMs : bucketEnd(b, k), status: 'on_time' }); return m; };
  const t = bucketEnd(b, 5);
  const atClose = runLiveSession({ s, family: 'LB', matrix: M1, records: rec(t), nowMs: b.close + 3600000, graceMs: 90000 }).trades[0];
  const later = runLiveSession({ s, family: 'LB', matrix: M1, records: rec(t + 7000), nowMs: b.close + 3600000, graceMs: 90000 }).trades[0];
  assert.equal(atClose.fillMs, t); assert.equal(atClose.ref, 1020);
  assert.equal(later.fillMs, t + MIN, 'recorded 7 seconds after the close: the 10:00 bar has started, so the fill is the 10:01 bar');
  assert.equal(later.ref, 1015);
});

test('gaps: an unobserved minute starts a gap; the open position is closed at the last live close less 1 tick; nothing after it is decided or backfilled', async () => {
  const d0 = '2026-11-11', d = '2026-11-12', b = bounds(d);
  // A long break of PDH 1010 at 10:00; after the gap, a short break of PDL 990 at 11:00 (in the window, never taken).
  const rows = [...dayRows(d0, () => ({ o: 1000, h: 1010, l: 990, c: 1000 })), ...dayRows(d, (k) => (k === 5 ? { o: 1000, h: 1016, l: 999, c: 1015 } : k === 17 ? { o: 1015, h: 1015, l: 984, c: 985 } : k > 17 ? { o: 985, h: 986, l: 984, c: 985 } : k > 5 ? { o: 1015, h: 1016, l: 1013, c: 1015 } : { o: 1000, h: 1001, l: 999, c: 1000 }))];
  const clock = { t: 0 };
  const { db, live } = liveFor(tempDir('psl-gap-'), rows, clock, { matrix: M1 });
  activateAt(live, clock, d0);
  await stream(live, clock, [d0], (bb) => { const o = []; for (let t = bb.open + MIN; t <= bb.close; t += MIN) o.push(t); return o; });
  const gapAt = b.open + 60 * MIN; // 10:30
  // Steps at every minute end until 10:30, then nothing until 10:45 (the PC was asleep), then every minute again.
  await stream(live, clock, [d], (bb) => { const o = []; for (let t = bb.open + MIN; t <= bb.close; t += MIN) if (t <= gapAt || t >= gapAt + 15 * MIN) o.push(t); return o; });
  const rep = ls.sessionReports(db).find((r) => r.session === d).report;
  const [tr] = rep.trades;
  assert.equal(tr.kind, 'gap'); assert.equal(tr.exitMs, gapAt); assert.equal(tr.exit, 1015 - 1, 'the last live close (10:29) less 1 tick');
  // The request at 10:45 also observes the minutes that ended within 90 s before it (10:44 and 10:45), so the gap is
  // the 13 minutes from 10:30 to 10:43.
  assert.equal(rep.gaps.length, 1); assert.equal(Date.parse(rep.gaps[0].from), gapAt); assert.equal(Date.parse(rep.gaps[0].to), gapAt + 13 * MIN);
  const after = ls.bucketsFor(db, d).filter((x) => x.endMs > gapAt);
  assert.ok(after.length > 0 && after.every((x) => x.status === 'gap'), 'every later bucket of the session is a gap');
  const afterGap = rep.decisions.filter((x) => x.t > gapAt);
  assert.ok(afterGap.some((x) => x.d < 0 && x.action === 'missed'), 'the short setup after the gap is seen and missed');
  assert.ok(afterGap.every((x) => x.action !== 'taken'));
  assert.equal(rep.trades.length, 1, 'nothing taken after the gap');
  // The gap's bars came later: stored, never live (the reference fetch after the close completes the next day's levels).
  const gapBars = ls.barsBetween(db, 'QQQ', d, d).filter((r) => r.minute >= 630 && r.minute < 643);
  assert.ok(gapBars.length > 0 && gapBars.every((r) => !r.live));
  // The account counts the gap exit like any closed trade.
  const acc = live.account(b.close + 30 * MIN);
  assert.equal(acc.day.items.length, 1); assert.equal(acc.day.items[0].counted, true);
  db.close();
});

test('the live grace, the decision grace and the flat-by time at their exact limits', () => {
  const b = bounds('2026-11-12');
  const end0 = b.open + MIN;
  assert.equal(observation({ open: b.open, close: b.close, polls: [end0 + 90000], nowMs: end0 + 200000, graceMs: 90000 }).minutes[0], 'observed');
  assert.equal(observation({ open: b.open, close: b.close, polls: [end0 + 90001], nowMs: end0 + 200000, graceMs: 90000 }).minutes[0], 'gap');
  assert.equal(observation({ open: b.open, close: b.close, polls: [], nowMs: end0 + 90000, graceMs: 90000 }).minutes[0], 'open', 'not judged until its grace has passed');
  // The flat-by: a position still open at 15:55 leaves at the open of the 15:55 bar.
  const d0 = '2026-11-11', d = '2026-11-12';
  const rows = [...dayRows(d0, () => ({ o: 1000, h: 1010, l: 990, c: 1000 })), ...dayRows(d, (k) => (k === 51 ? { o: 1000, h: 1016, l: 999, c: 1015 } : k > 51 ? { o: 1015, h: 1016, l: 1013, c: 1015 } : { o: 1000, h: 1001, l: 999, c: 1000 }))].map((r) => ({ ...r, live: true, fetchedMs: 0 }));
  rows.find((r) => r.date === d && r.minute === 955).o = 1014;
  const s = sessionMarket(rows, d, { ratio: 1, tickPoints: 1 });
  const recs = new Map(); for (let k = 0; k < bucketCount(b); k++) recs.set(k, { recordedMs: bucketEnd(b, k), status: 'on_time' });
  const tr = runLiveSession({ s, family: 'LB', matrix: M1, records: recs, nowMs: b.close + 3600000, graceMs: 90000 }).trades[0];
  assert.equal(tr.kind, 'time'); assert.equal(tr.exitMs, b.open + (955 - 570) * MIN); assert.equal(tr.exit, 1014);
  // The decision grace: recorded 120 s after the close is on time; 1 ms more is late, and a late setup is not taken.
  recs.set(51, { recordedMs: bucketEnd(b, 51) + 120001, status: 'late' });
  const late = runLiveSession({ s, family: 'LB', matrix: M1, records: recs, nowMs: b.close + 3600000, graceMs: 90000 });
  assert.equal(late.trades.length, 0); assert.equal(late.decisions.find((x) => x.bucket === 51).action, 'missed');
});

test('the worker records a bucket on time up to 120 seconds after its end, late after that, with every minute observed', () => {
  const d = '2026-11-12', b = bounds(d);
  const clock = { t: b.open - 3600000 };
  const { db, live } = liveFor(tempDir('psl-late-'), [], clock);
  live.activate();
  for (let i = 1; i <= 15; i++) ls.insertPoll(db, { session: d, atMs: b.open + i * MIN + 5000, ok: true });
  assert.equal(live.recordDue(d, b.open + 5 * MIN + 120000), 1);
  assert.equal(live.recordDue(d, b.open + 10 * MIN + 120001), 1);
  assert.deepEqual(ls.bucketsFor(db, d).map((x) => x.status), ['on_time', 'late']);
  db.close();
});

test('the open position at its exact limit: a worst point reaching the Max Loss Limit fails the attempt now; one tick less does not', () => {
  const plan = M.accounts.primary;
  const open = (mae) => ({ riskTicks: 16, maeTicks: mae, resultTicks: -50 });
  // 40 contracts (the cap): the stop-out loss per contract is (16 + 2) x US$0.50 + US$1.00 = US$10, and US$400 / 10 = 40.
  const at = dayDetail({ plan, kind: 'eval', days: [], trades: [], open: open(98), tickValue: 0.5, exec: M.execution });
  assert.equal(at.open.contracts, 40); assert.equal(at.open.breached, true); assert.equal(at.ended, 'breached'); assert.equal(at.balance, 48000);
  const less = dayDetail({ plan, kind: 'eval', days: [], trades: [], open: open(97), tickValue: 0.5, exec: M.execution });
  assert.equal(less.ended, null); assert.equal(less.open.worst, -1980); assert.equal(less.openPnl, -1040); assert.equal(less.drawdownLeft, 960);
  assert.equal(less.dailyLimitLeft, null, 'LucidFlex has no daily loss limit');
  // The end-of-day trailing limit carried into the day: after a +US$1,000 day the limit is US$49,000.
  const next = dayDetail({ plan, kind: 'eval', days: [1000], trades: [], tickValue: 0.5, exec: M.execution });
  assert.equal(next.mll, 49000); assert.equal(next.drawdownLeft, 2000);
});

test('restart from the checkpoint: stopping mid-session and resuming from the database gives the same records and trades', async () => {
  const dates = DATES.slice(0, 2);
  const rows = walk(dates, 23);
  const at = everyMinute(5000);
  const clockA = { t: 0 };
  const A = liveFor(tempDir('psl-once-'), rows, clockA, { feedOpts: { delayMs: 2000 } });
  activateAt(A.live, clockA, dates[0]);
  await stream(A.live, clockA, dates, at);
  const dirB = tempDir('psl-restart-');
  const clockB = { t: 0 };
  let B = liveFor(dirB, rows, clockB, { feedOpts: { delayMs: 2000 } });
  activateAt(B.live, clockB, dates[0]);
  // Day 2 is cut at 11:00: the process ends, the database is reopened by a new instance that carries on.
  let first = true;
  for (const d of dates) {
    const b = bounds(d);
    for (const t of at(b)) {
      if (d === dates[1] && first && t > b.open + 90 * MIN) { B.db.close(); B = liveFor(dirB, rows, clockB, { feedOpts: { delayMs: 2000 } }); first = false; }
      clockB.t = t; await B.live.step();
    }
    clockB.t = b.close + 25 * MIN; await B.live.step();
  }
  const strip = (x) => ({ session: x.session, k: x.k, status: x.status, recordedMs: x.recordedMs, evaluation: x.evaluation });
  assert.deepEqual(ls.allBuckets(B.db).map(strip), ls.allBuckets(A.db).map(strip));
  assert.deepEqual(ls.sessionReports(B.db).map((r) => r.report.trades), ls.sessionReports(A.db).map((r) => r.report.trades));
  assert.equal(ls.allBuckets(A.db).length, dates.reduce((n, d) => n + bucketCount(bounds(d)), 0));
  A.db.close(); B.db.close();
});

test('the feed down: failed requests leave minutes unobserved, which become a gap; late and out-of-order bars are never live', async () => {
  const dates = DATES.slice(0, 2);
  const rows = walk(dates, 5);
  const b1 = bounds(dates[1]);
  const clock = { t: 0 };
  const downFrom = b1.open + 120 * MIN, downTo = b1.open + 125 * MIN;
  const { db, live } = liveFor(tempDir('psl-down-'), rows, clock, { feedOpts: { delayMs: 2000, fail: (t) => t >= downFrom && t < downTo } });
  activateAt(live, clock, dates[0]);
  await stream(live, clock, dates, everyMinute(5000));
  const rep = ls.sessionReports(db).find((r) => r.session === dates[1]).report;
  assert.equal(rep.gaps.length, 1);
  assert.ok(Date.parse(rep.gaps[0].from) >= downFrom - 2 * MIN && Date.parse(rep.gaps[0].from) <= downFrom);
  assert.ok(ls.bucketsFor(db, dates[1]).filter((x) => x.endMs > Date.parse(rep.gaps[0].from)).every((x) => x.status === 'gap'));
  const notLive = ls.barsBetween(db, 'QQQ', dates[1], dates[1]).filter((r) => !r.live);
  assert.ok(notLive.length > 0 && notLive.every((r) => r.minute >= Math.floor((downFrom - b1.open) / MIN) + 570 - 2));
  db.close();
});

test('the worker: the schedule polls 5 seconds after each minute and retries while the bar is missing; pause, stop and the control row', async () => {
  const T = { pollAfterMs: 5000, retryMs: 5000, graceMs: 90000, bucketWaitMs: 45000 };
  const b = bounds('2026-11-12');
  assert.equal(nextWake(b.open + 10 * MIN + 1000, { timing: T, lastMinuteIn: true }), b.open + 10 * MIN + 5000);
  assert.equal(nextWake(b.open + 10 * MIN + 5000, { timing: T, lastMinuteIn: false }), b.open + 10 * MIN + 10000);
  assert.equal(nextWake(b.open + 10 * MIN + 5000, { timing: T, lastMinuteIn: true }), b.open + 11 * MIN + 5000);
  assert.equal(nextWake(b.open + 10 * MIN + 46000, { timing: T, lastMinuteIn: false }), b.open + 11 * MIN + 5000, 'no retry after the bucket wait');
  const dir = tempDir('psl-worker-');
  const clock = { t: b.open + 30 * MIN };
  const { db, live } = liveFor(dir, walk(['2026-11-11', '2026-11-12']), clock);
  clock.t = bounds('2026-11-11').open - 3600000; live.activate();
  clock.t = b.open + 30 * MIN;
  ls.setDesired(db, 'running', new Date(clock.t).toISOString());
  let n = 0;
  const r = await runLiveWorker({ db, live, clock: () => new Date(clock.t), sleep: async (ms) => { clock.t += ms; if (++n === 3) ls.setDesired(db, 'stopped', new Date(clock.t).toISOString()); }, token: 'w1', pid: 7 });
  assert.equal(r.exit, 'stopped');
  assert.equal(ls.worker(db).token, null, 'the control row is released');
  assert.ok(ls.lastPolls(db, 10).length >= 2);
  db.close();
});

test('the IEX client: only data.alpaca.markets with feed=iex, no redirect followed, nothing before 2026-11-10 requested, keys never in an error', async () => {
  const urls = [];
  const ok = (body) => ({ status: 200, text: async () => JSON.stringify(body), headers: { get: () => null } });
  const src = createIexSource({ keyId: 'KEYID123', secretKey: 'SECRET456', fetchImpl: async (u) => { urls.push(String(u)); return ok({ bars: { QQQ: [{ t: '2026-11-10T14:31:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] }, next_page_token: null }); } });
  const bars = await src.bars1m('QQQ', Date.parse('2026-11-10T14:30:00Z'), Date.parse('2026-11-10T14:40:00Z'));
  assert.equal(bars.length, 1); assert.equal(bars[0].date, '2026-11-10'); assert.equal(bars[0].minutes, 571);
  assert.ok(urls[0].startsWith('https://data.alpaca.markets/v2/stocks/bars?') && urls[0].includes('feed=iex'));
  await assert.rejects(src.bars1m('QQQ', Date.parse('2026-11-09T14:30:00Z'), Date.parse('2026-11-10T14:40:00Z')), /before 2026-11-10/);
  assert.equal(urls.length, 1, 'refused before any request');
  const redir = createIexSource({ keyId: 'KEYID123', secretKey: 'SECRET456', fetchImpl: async () => ({ status: 302, text: async () => '', headers: { get: () => 'https://elsewhere.example' } }) });
  await assert.rejects(redir.bars1m('QQQ', Date.parse('2026-11-10T14:30:00Z'), Date.parse('2026-11-10T14:40:00Z')), (e) => /redirect/.test(e.message) && !/KEYID123|SECRET456/.test(e.message));
  const denied = createIexSource({ keyId: 'KEYID123', secretKey: 'SECRET456', fetchImpl: async () => ({ status: 403, text: async () => '{"message":"KEYID123 forbidden"}', headers: { get: () => null } }) });
  await assert.rejects(denied.bars1m('QQQ', Date.parse('2026-11-10T14:30:00Z'), Date.parse('2026-11-10T14:40:00Z')), (e) => !/KEYID123|SECRET456/.test(e.message));
});

test('the overview is read-only and labelled; the shown ICT families are seen, never traded', async () => {
  const dates = DATES.slice(0, 3);
  const rows = walk(dates, 7);
  const clock = { t: 0 };
  const { db, live } = liveFor(tempDir('psl-view-'), rows, clock, { feedOpts: { delayMs: 2000 } });
  activateAt(live, clock, dates[0]);
  await stream(live, clock, dates.slice(0, 2), everyMinute(5000));
  const b = bounds(dates[2]);
  for (let t = b.open + MIN + 5000; t <= b.open + 120 * MIN; t += MIN) { clock.t = t; await live.step(); }
  const count = () => ['pl_bars', 'pl_polls', 'pl_buckets', 'pl_sessions', 'pl_log', 'pl_meta'].map((t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n).join(',');
  const before = count();
  const o = live.overview();
  assert.equal(count(), before, 'the overview writes nothing');
  assert.match(o.label, /not affiliated with or endorsed by Lucid/); assert.equal(o.running, 'running simulated result, not validated'); assert.match(o.standIn, /not futures/);
  assert.equal(o.session.date, dates[2]); assert.ok(o.session.bars.length >= 20);
  assert.equal(o.account.status.attempt, 1); assert.equal(o.account.status.stage, 'evaluation');
  for (const list of Object.values(o.session.shown)) assert.ok(list.every((x) => x.action === 'seen' || x.action === 'none'));
  assert.equal(JSON.stringify(o).includes('order_id'), false);
  db.close();
});
