// The HXR prospective account (server/hxr/service.js, ENGINE-SPEC.md section
// 10) on a fake data.alpaca.markets and a fake clock: a pause pressed while a
// tick is in flight wins, records are stamped when they are stored (so a slow
// fetch never makes a late decision count as on time), and the report items
// and P4 comparison the page shows. The frozen version is saved directly (as
// the selection would); synthetic prices only exercise code.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { NO_HOST_KEYS } from './no-host-keys.js';
import { fakeAlpaca, buildMarket, KEY_ID, SECRET_KEY } from './hxr-fake-alpaca.js';
import { loadConfig } from '../server/config.js';
import { createHxr, FROZEN_VERSION, P4_STATEMENT } from '../server/hxr/service.js';
import { loadHxrConfig, hxrConfigHash, PREREG } from '../server/hxr/config.js';
import * as store from '../server/hxr/store.js';

const T0 = '2026-10-22T22:00:00Z'; // Thursday 18:00 ET: the account starts on Friday 2026-10-23
const MARKET = buildMarket();

function fakeClock(start) {
  let now = Date.parse(start);
  return { clock: () => new Date(now), set: (t) => { now = Date.parse(t); }, advance: (ms) => { now += ms; } };
}

// A started prospective account on frozen C2; `onCall(call)` runs before each fake Alpaca answer.
function setup() {
  const dir = tempDir('hxr-pro-');
  const t = fakeClock(T0);
  const hooks = { onCall: null };
  const fake = fakeAlpaca({ clock: t.clock, market: MARKET, handler: async (call) => { await hooks.onCall?.(call); return null; } });
  const cfg = loadConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none', ALPACA_API_KEY_ID: KEY_ID, ALPACA_API_SECRET_KEY: SECRET_KEY });
  const ctx = { cfg, mode: 'real' };
  Object.defineProperty(ctx, 'db', { get() { throw new Error('HXR touched the portfolio database'); } });
  const hxr = createHxr(ctx, { clock: t.clock, fetchImpl: fake.fetchImpl, sleep: async () => {} });
  const c2 = loadHxrConfig('hxr-c2-0.1.0.json');
  const config = { ...JSON.parse(JSON.stringify(c2)), version: FROZEN_VERSION, label: 'test freeze of C2', status: 'test fixture' };
  store.saveVersion(hxr.db, { version: FROZEN_VERSION, config, configHash: hxrConfigHash(config), basedOn: c2.version, prereg: PREREG, frozenAt: T0 });
  assert.equal(hxr.startProspective({ confirm: true }).account.startDate, '2026-10-23');
  return { t, hooks, fake, hxr, db: hxr.db };
}

test('a pause pressed while a tick is in flight wins: nothing from that tick is stored', { timeout: 60000 }, async () => {
  const { t, hooks, hxr, db } = setup();
  try {
    t.set('2026-10-23T20:30:00Z');
    assert.deepEqual((await hxr.prospectiveTick()).processed.at(-1), '2026-10-23');
    const before = store.listProspectiveEvents(db, { limit: 100000 }).length;

    // The owner presses Pause while the tick waits for Alpaca's news answer.
    t.set('2026-10-26T20:30:00Z');
    let paused = null;
    hooks.onCall = (call) => { if (call.path === '/v1beta1/news' && !paused) paused = hxr.pauseProspective(); };
    const tick = await hxr.prospectiveTick();
    hooks.onCall = null;
    assert.match(paused.note, /^Paused/);
    assert.equal(tick.skipped, true);
    assert.match(tick.reason, /paused while this update ran, so nothing it processed was stored/);
    assert.deepEqual(tick.processed, []);
    assert.deepEqual(tick.discarded, ['2026-10-26']);
    const acc = store.getProspective(db);
    assert.equal(acc.status, 'paused', 'the stored status is the owner\'s, not the copy the tick read');
    assert.equal(acc.lastProcessed, '2026-10-23');
    const events = store.listProspectiveEvents(db, { limit: 100000 });
    assert.deepEqual(events.filter((e) => e.kind === 'status').map((e) => e.detail), [{ from: 'active', to: 'paused' }], 'the audit trail matches the stored status');
    assert.equal(events.length, before + 1, 'only the status event');
    assert.equal(events.filter((e) => e.date === '2026-10-26').length, 0);

    // While paused, the next session is not processed; Resume answers "resumed", not "already active".
    t.set('2026-10-27T20:30:00Z');
    assert.equal((await hxr.prospectiveTick()).skipped, true);
    assert.equal(store.getProspective(db).lastProcessed, '2026-10-23');
    assert.match(hxr.resumeProspective().note, /^Resumed/);
    const after = await hxr.prospectiveTick();
    assert.deepEqual(after.processed, ['2026-10-26', '2026-10-27']);
    const s26 = store.listProspectiveEvents(db, { kind: 'session', arm: 'hxr', from: '2026-10-26', to: '2026-10-26' })[0];
    assert.equal(s26.onTime, false, 'processed after the next session opened');
  } finally {
    hxr.close();
  }
});

test('records are stamped when stored: a slow fetch past the next open is late, never backdated', { timeout: 60000 }, async () => {
  const { t, hooks, hxr, db } = setup();
  try {
    // 11:00 ET on the start day: the warm-up only.
    t.set('2026-10-23T15:00:00Z');
    assert.equal((await hxr.prospectiveTick()).processed.at(-1), '2026-10-22');

    // The PC was off over the weekend; it wakes at 09:29 ET on Monday, one minute before the open,
    // and every Alpaca answer takes 20 seconds.
    t.set('2026-10-26T13:29:00Z');
    let requests = 0;
    hooks.onCall = () => { requests++; t.advance(20000); };
    const tick = await hxr.prospectiveTick();
    hooks.onCall = null;
    assert.deepEqual(tick.processed, ['2026-10-23']);
    assert.ok(requests >= 10, `${requests} requests`);
    assert.equal(tick.at, '2026-10-26T13:29:00.000Z', 'the data cutoff is the tick start');
    assert.equal(tick.recordedAt, t.clock().toISOString(), 'stamped after the fetch, when stored');
    assert.ok(tick.recordedAt > '2026-10-26T13:30:00.000Z');
    const friday = store.listProspectiveEvents(db, { from: '2026-10-23', to: '2026-10-23', limit: 100000 });
    assert.ok(friday.length > 0);
    for (const e of friday) {
      assert.equal(e.recordedAt, tick.recordedAt, e.kind);
      if (e.onTime !== null) assert.equal(e.onTime, false, `${e.kind} ${e.symbol}: stored after Monday's open`);
    }
    assert.ok(friday.some((e) => e.kind === 'fill' && e.detail.initial), 'the initial allocation fills are among them');
    const ps = hxr.prospectiveStatus();
    assert.equal(ps.operational.P2.onTime, 0);
    assert.equal(ps.operational.P2.sessions, 1);
  } finally {
    hxr.close();
  }
});

test('prospective report items and P4: every metric of both arms, per-fill comparison, and the historical result beside it', { timeout: 60000 }, async () => {
  const { t, hxr, db } = setup();
  try {
    for (const at of ['2026-10-23T20:30:00Z', '2026-10-26T20:30:00Z', '2026-10-27T20:30:00Z']) { t.set(at); await hxr.prospectiveTick(); }
    let s = hxr.prospectiveStatus();
    for (const arm of ['hxr', 'hold']) {
      const m = s[arm].metrics;
      for (const k of ['maxDrawdownPct', 'peakDate', 'troughDate', 'annualisedReturnPct', 'timeInCashPct', 'episodes', 'missedRebounds', 'lossesAfterBuyBack', 'costs', 'dividends', 'perStock']) assert.ok(k in m, `${arm}.${k}`);
      assert.equal(m.sessions, 3);
      const f = s.fillComparison[arm];
      assert.ok(f.matched >= 8 && Number.isFinite(f.medianAbsDiffBps), JSON.stringify(f));
      assert.equal(f.vw15EndValue, null, 'no VWAP-fill account runs prospectively: not computed, never estimated');
    }
    const p4 = s.operational.P4;
    assert.equal(p4.note, P4_STATEMENT);
    assert.match(p4.rule, /never called proof/);
    assert.equal(p4.met, null, 'P4 is reported, never passed or failed');
    assert.equal(p4.historical, null, 'no clean evaluation recorded yet');
    for (const k of ['annualisedReturnPct', 'maxDrawdownPct', 'returnToDrawdown']) {
      assert.equal(p4.prospective[k].hxr, s.hxr.metrics[k]);
      assert.equal(p4.prospective[k].hold, s.hold.metrics[k]);
    }

    // A clean evaluation of this version is set beside it; a contaminated one never is.
    const v = store.getVersion(db, FROZEN_VERSION);
    const run = (arm, metrics, variant = 'main') => {
      const id = store.createRun(db, { kind: variant === 'main' ? 'evaluation' : 'variant', version: arm === 'hxr' ? v.version : 'hold-0.1.0', configHash: 'x', period: { start: '2023-01-03', end: '2026-10-21' }, basket: 'A' });
      store.updateRun(db, id, { status: 'done', metrics, details: { variant, arm } });
      return id;
    };
    const fig = (ann, dd, extra = {}) => ({ annualisedReturnPct: ann, maxDrawdownPct: dd, returnToDrawdown: ann / dd, totalReturnPct: ann * 4, sessions: 957, years: 3.8, firstDate: '2023-01-03', lastDate: '2026-10-21', ...extra });
    const bad = [run('hxr', fig(99, 1)), run('hold', fig(1, 99))];
    store.appendLedger(db, { kind: 'evaluation', prereg: PREREG, version: v.version, configHash: v.configHash, runIds: bad, contaminated: true, reason: 'repeat', at: '2026-10-23T00:00:00Z' });
    assert.equal(hxr.prospectiveStatus().operational.P4.historical, null, 'a contaminated evaluation is never the historical result');
    const ids = [run('hxr', fig(12, 20)), run('hold', fig(15, 40)), run('hxr', fig(1, 1), 'costs2x'), run('hold', fig(1, 1), 'costs2x')];
    store.appendLedger(db, { kind: 'evaluation', prereg: PREREG, version: v.version, configHash: v.configHash, runIds: ids, contaminated: false, at: '2026-10-22T23:00:00Z' });
    s = hxr.prospectiveStatus();
    const h = s.operational.P4.historical;
    assert.deepEqual(h.runIds, { hxr: ids[0], hold: ids[1] }, 'the judged main pair');
    assert.deepEqual(h.annualisedReturnPct, { hxr: 12, hold: 15, diff: -3 });
    assert.deepEqual(h.maxDrawdownPct, { hxr: 20, hold: 40, diff: -20 });
    assert.ok(Math.abs(h.returnToDrawdown.diff - (12 / 20 - 15 / 40)) < 1e-12);
  } finally {
    hxr.close();
  }
});

test('a split that reaches the database after its session was processed pauses the account, from the stored row', { timeout: 60000 }, async () => {
  const { t, hooks, hxr, db } = setup();
  try {
    t.set('2026-10-23T20:30:00Z');
    await hxr.prospectiveTick();
    store.upsertCorporateActions(db, [{ id: 'late-split-HOOD', type: 'forward_split', symbol: 'HOOD', ex_date: '2026-10-23', process_date: '2026-10-23', ratio_old: 1, ratio_new: 2 }]);
    const statuses = () => store.listProspectiveEvents(db, { kind: 'status', limit: 1000 }).map((e) => e.detail);
    t.set('2026-10-26T20:30:00Z');
    let tick = await hxr.prospectiveTick();
    assert.match(tick.errors.join(' '), /split reached the database after its session was processed \(HOOD 2026-10-23\); the account was paused/);
    let acc = store.getProspective(db);
    assert.deepEqual([acc.status, acc.lastProcessed], ['paused', '2026-10-23']);
    assert.deepEqual(statuses(), [{ from: 'active', to: 'paused', reason: 'late_split' }], 'the automatic pause is in the audit trail');

    // Resumed; the owner pauses again while the next tick is in flight. The owner's pause stands and is recorded once.
    hxr.resumeProspective();
    hooks.onCall = (call) => { if (call.path === '/v1beta1/news') { hooks.onCall = null; hxr.pauseProspective(); } };
    tick = await hxr.prospectiveTick();
    acc = store.getProspective(db);
    assert.deepEqual([acc.status, acc.lastProcessed], ['paused', '2026-10-23']);
    assert.deepEqual(statuses(), [{ from: 'active', to: 'paused', reason: 'late_split' }, { from: 'paused', to: 'active' }, { from: 'active', to: 'paused' }]);
    assert.equal(store.listProspectiveEvents(db, { kind: 'operational', limit: 1000 }).filter((e) => e.detail.code === 'late_split').length, 1, 'the late split is recorded once');
  } finally {
    hxr.close();
  }
});
