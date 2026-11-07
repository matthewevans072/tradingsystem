// news-forward (Phase C1): synthetic data only. The store's guard and bound, plans recorded before the market can
// trigger them (a plan recorded after T looks only at later bars; a plan recorded after its window is late), the
// worker's schedule and control, and the whole update against a fake Alpaca source with the free plan's delay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { tradingDays } from '../server/strategy/sessions.js';
import { regularSessionBounds } from '../server/calendar.js';
import { etMs } from '../server/newsreplay/items.js';
import { activationOf } from '../server/newsreplay/sim.js';
import { BASKET } from '../server/newsreplay/config.js';
import * as store from '../server/newsforward/store.js';
import { createForward } from '../server/newsforward/forward.js';
import { schedule, runWorker } from '../server/newsforward/worker.js';

const PIPE = { planner: 'D', entry: 'A', exit: 'existing', portfolio: { startingCash: 15000, positionCapPct: 20, riskPerTradePct: 1, totalEntryRiskPct: 5 }, costs: { commissionPerOrder: 0, commissionPerShare: 0, secFeeRate: 0.0000206, tafPerShare: 0.000166, tafMaxPerTrade: 8.3, halfSpreadFloorBps: 2, slippageBps: 2, withholdingPct: 15 } };
const SPREAD = { floorBps: 2, steps: Object.fromEntries(BASKET.map((s) => [s, [['2016-01-01', 3]]])) };
const et = (d, hh, mm) => etMs(`${d} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
const openMs = (d) => new Date(regularSessionBounds(d).open).getTime();
const closeMs = (d) => new Date(regularSessionBounds(d).close).getTime();

test('news-forward store: only its own file, append-only rows, nothing dated before 2026-10-22', () => {
  const dir = tempDir('nf-store-');
  assert.throws(() => store.openNfDb(path.join(dir, 'news-replay.sqlite')), /refuses/);
  assert.throws(() => store.openNfDb(path.join(dir, 'signal-desk.sqlite')), /refuses/);
  const db = store.openNfDb(store.nfDbFile(dir));
  assert.throws(() => store.insertDaily(db, 'MU', [{ date: '2026-10-21', o: 1, h: 1, l: 1, c: 1 }], 'now'), /CHECK/);
  store.insertDaily(db, 'MU', [{ date: '2026-10-22', o: 1, h: 1, l: 1, c: 1 }], 'now');
  assert.throws(() => db.prepare("UPDATE nf_daily SET c = 2 WHERE symbol = 'MU'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM nf_daily').run(), /append-only/);
  db.close();
});

test('a plan recorded after T looks only at bars that close after it was recorded; recorded after its window, it cannot activate', () => {
  const d = '2026-11-23', o = openMs(d);
  const arr = Array.from({ length: 78 }, (_, k) => ({ s: o + k * 300000, e: o + (k + 1) * 300000, o: 50, h: 50, l: 50, c: 50, date: d, di: 0 }));
  arr[8].c = 51; // the bar closing at 10:15
  const mk = { flat: new Map([['MU', arr]]) };
  const plan = { status: 'armed', stock: 'MU', session: d, T: et(d, 10, 10), bullish: { activation: { level: 50.75 } }, bearish: { activation: { level: 49.25 } } };
  assert.equal(activationOf(plan, mk).bar.e, et(d, 10, 15), 'recorded at T');
  assert.equal(activationOf({ ...plan, notBeforeMs: et(d, 10, 16) }, mk), null, 'recorded after the 10:15 close: that bar no longer counts');
  arr[10].c = 51; // 10:25
  assert.equal(activationOf({ ...plan, notBeforeMs: et(d, 10, 16) }, mk).bar.e, et(d, 10, 25));
  assert.equal(activationOf({ ...plan, notBeforeMs: et(d, 10, 41) }, mk), null, 'recorded after the window');
});

test('the worker: its schedule in New York time; pause and stop requests; one worker at a time; it resumes from the stored updates', async () => {
  const d = '2026-11-23';
  assert.equal(schedule(et(d, 9, 0)).kind, 'idle');
  const first = schedule(et(d, 9, 35) + 30000);
  assert.deepEqual([first.due, first.kind], [true, 'session']);
  assert.equal(schedule(et(d, 9, 37), { lastUpdateMs: et(d, 9, 35) + 30000 }).due, false, 'within the same 5-minute slot');
  assert.equal(schedule(et(d, 9, 40) + 31000, { lastUpdateMs: et(d, 9, 35) + 30000 }).due, true);
  assert.deepEqual(Object.values(schedule(closeMs(d) + 26 * 60000)).slice(0, 2), [true, 'final']);
  assert.equal(schedule(closeMs(d) + 26 * 60000, { finalDoneFor: d }).kind, 'idle');
  assert.equal(schedule(et('2026-11-26', 11, 0)).kind, 'idle', 'Thanksgiving: no session');
  const dir = tempDir('nf-worker-');
  const db = store.openNfDb(store.nfDbFile(dir));
  let t = et(d, 10, 0);
  const calls = [];
  const fwd = { update: async ({ kind }) => { calls.push(kind); return { detail: { today: d } }; } };
  const sleep = async (ms) => { t += ms; };
  const loop = runWorker({ db, forward: fwd, clock: () => new Date(t), sleep, token: 'a', pid: 1, maxLoops: 3 });
  await assert.rejects(runWorker({ db, forward: fwd, clock: () => new Date(t), sleep, token: 'b', pid: 2, maxLoops: 1 }), /another news-forward worker is alive/);
  assert.equal((await loop).exit, 'loop limit');
  assert.ok(calls.length >= 1 && calls.every((k) => k === 'session'));
  store.setDesired(db, 'paused', 'x');
  const before = calls.length;
  await runWorker({ db, forward: fwd, clock: () => new Date(t), sleep, token: 'c', pid: 3, maxLoops: 3 });
  assert.equal(calls.length, before, 'paused: no update');
  store.setDesired(db, 'stopped', 'x');
  assert.equal((await runWorker({ db, forward: fwd, clock: () => new Date(t), sleep, token: 'd', pid: 4, maxLoops: 3 })).exit, 'stopped');
  db.close();
});

// A fake Alpaca source: every basket stock flat at 50 / 50.5 by day, MU's 10:15-10:20 bar on 2026-11-23 closes at 52,
// one news item at 10:02 and one at 11:00; bars appear 16 minutes after they end, daily bars 20 minutes after the close.
function fakeSource(clock) {
  const sessions = tradingDays('2026-10-22', '2026-12-31', 'NYSE');
  const px = (d) => (sessions.indexOf(d) % 2 ? 50.5 : 50);
  const prev = (d) => { const i = sessions.indexOf(d); return i ? px(sessions[i - 1]) : 50; };
  const news = [
    { id: '1', created_at: new Date(et('2026-11-23', 10, 2)).toISOString(), updated_at: null, headline: 'MU item', summary: null, source: 'test', symbols: ['MU'] },
    { id: '2', created_at: new Date(et('2026-11-23', 11, 0)).toISOString(), updated_at: null, headline: 'MU item 2', summary: null, source: 'test', symbols: ['MU'] },
  ];
  return {
    async dailyBars(sym, { from, to }) { return sessions.filter((d) => d >= from && d <= to && clock().getTime() >= closeMs(d) + 20 * 60000).map((d) => ({ date: d, o: prev(d), h: Math.max(prev(d), px(d)), l: Math.min(prev(d), px(d)), c: px(d), v: 1e6 })); },
    async intradayBars(sym, tf, { from, to }) {
      const out = [];
      for (const d of sessions.filter((x) => x >= from && x <= to)) {
        const o = openMs(d), n = Math.round((closeMs(d) - o) / 60000);
        for (let k = 0; k < n; k++) {
          const ms = o + k * 60000;
          if (ms + 60000 > clock().getTime() - 16 * 60000) break;
          const c = sym === 'MU' && d === '2026-11-23' && k >= 45 && k < 50 ? 52 : prev(d);
          out.push({ date: d, minutes: 570 + k, ms, o: k === 45 && c === 52 ? prev(d) : c, h: c, l: Math.min(c, prev(d)), c, v: 100, vw: c });
        }
      }
      return out;
    },
    async news(tags, { start }) { if (start && Date.parse(start) > clock().getTime()) throw new Error('Alpaca: request refused (HTTP 400): start should not be before end'); return news.filter((x) => tags.some((t) => x.symbols.includes(t)) && x.created_at >= start && Date.parse(x.created_at) <= clock().getTime()); },
    async corporateActions() { return []; },
  };
}

test('the forward account: plans recorded on time or late, a fill only after the plan was recorded, the running report, and every plan re-derived', async () => {
  const dir = tempDir('nf-fwd-');
  const db = store.openNfDb(store.nfDbFile(dir));
  let t = et('2026-10-23', 20, 0);
  const clock = () => new Date(t);
  const fwd = createForward({ db, clock, source: fakeSource(clock), pipeline: PIPE });
  const act = fwd.activate({ spreadTable: SPREAD });
  assert.equal(act.startSession, '2026-10-26');
  await assert.rejects(Promise.resolve().then(() => fwd.activate({ spreadTable: SPREAD })), /already activated/);
  t = et('2026-10-24', 12, 0); // a Saturday, before the start session: nothing to plan, and no request starts in the future
  assert.deepEqual((await fwd.update({ kind: 'idle', withFilings: false })).detail.plans, { recorded: 0, late: 0 });
  t = et('2026-11-23', 10, 12);
  let r = await fwd.update({ kind: 'session', withFilings: false });
  assert.deepEqual(r.detail.plans, { recorded: 1, late: 0 });
  const p1 = store.listPlans(db, 'fixed-rule')[0];
  assert.equal(p1.plan.notBeforeMs, et('2026-11-23', 10, 12));
  assert.equal(p1.plan.status, 'armed', 'at least 21 earlier closes exist');
  t = et('2026-11-23', 12, 0);
  r = await fwd.update({ kind: 'session', withFilings: false });
  assert.deepEqual(r.detail.plans, { recorded: 1, late: 1 }, 'the 11:00 item is planned after its window: late');
  t = et('2026-11-24', 16, 30);
  r = await fwd.update({ kind: 'final', withFilings: false });
  const acc = fwd.account(fwd.assemble(), { startSession: act.startSession });
  const buy = acc.actions.find((a) => a.kind === 'buy');
  assert.ok(buy && buy.stock === 'MU' && buy.ms === et('2026-11-23', 10, 20), 'filled at the open after the 10:20 close, after the plan was recorded');
  assert.equal(acc.report.accounting.ok, true);
  assert.equal(acc.asOf, '2026-11-24');
  assert.ok(r.detail.account.net != null);
  assert.equal(store.listSnapshots(db, 'fixed-rule').at(-1).date, '2026-11-24', 'one snapshot per session the account is valued at');
  const v = fwd.verify();
  assert.deepEqual([v.plans, v.chain.ok, v.packetMismatches.length], [2, true, 0]);
  assert.ok(!fs.readdirSync(dir).some((f) => /hxr|news-replay/.test(f)), 'no other programme database is created');
  db.close();
});
