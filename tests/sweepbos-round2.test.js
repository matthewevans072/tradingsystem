// sweep-bos round 2 (PRE-REGISTRATION-2.md): the round-1 behaviour snapshot (a variant without the switches
// runs exactly as before they existed), the three switches with hand-checked days, the combined file, the
// pinned round-2 files and their validation, and the gate by round. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runSymbol, switchesOf } from '../server/sweepbos/engine.js';
import { buildMarket } from './sweepbos-fake-alpaca.js';
import { scenario, variant, bar, LONG_DAY } from './sweepbos-fixtures.js';
import { loadVariant, validateVariant, VARIANT_SHA256, ROUND2_VARIANTS, ROUND1_VARIANTS, roundVariants, frozenTitle, textSha256, VARIANT_DIR, CODE_REVISION, logStatus, RUN_ENTRY, parseEntries } from '../server/sweepbos/config.js';
import { serviceFixture, frozenEntry, COMMIT } from './sweepbos-service-fixture.js';

const close = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-9, `${msg ? `${msg}: ` : ''}${a} vs ${b}`);
const run = (sc, v) => runSymbol({ symbol: 'QQQ', daily: sc.daily, sessions: sc.sessions, variant: v, window: { start: sc.testDate, end: sc.testDate } });
const BASE = variant('order_block', 'A_sweep_buffer', 'off');
const CUTOFF = { ...BASE, entryCutoff: { lastFillBarIndex: 17 }, bos: { lastBarIndex: 17 } };
const XSESSION = { ...BASE, swing: { scope: 'cross_session', previousSessionBars: 12 }, zones: { orderBlockSearch: 'cross_session' } };
const NOINVAL = { ...BASE, sweep: { invalidation: 'none' } };
const COMBINED = { ...CUTOFF, swing: XSESSION.swing, zones: XSESSION.zones, sweep: NOINVAL.sweep };
const hashOf = (r) => crypto.createHash('sha256').update(JSON.stringify({ trades: r.trades, sessions: r.sessions, stageCounts: r.stageCounts })).digest('hex');

test('round-1 behaviour snapshot: without the switches the engine reproduces the hashes taken before the switches existed', () => {
  const market = buildMarket({ symbols: ['QQQ'], from: '2019-01-02', to: '2019-09-30', extended: false, seed: 3 });
  const sessions = [...market.QQQ.sessions].map(([date, bars]) => ({ date, full: bars.length, bars: bars.map((b, i) => ({ idx: i, o: b.o, h: b.h, l: b.l, c: b.c })) }));
  const daily = [...market.QQQ.daily].map(([date, d]) => ({ date, ...d }));
  // Taken from the engine at commit db29047 (round 1's code) on 2026-11-03.
  const want = {
    'order_block|A_sweep_buffer|on': '20a61e107aa3532d3f24423fab49331af32f53cd233615e53a94e5e68783361d',
    'order_block|A_sweep_buffer|off': '6febf94cd579067511ae140e097035536d1d1da06c3705c04fa4f49458405bf8',
    'order_block|B_second_swing|on': 'dca5ec969eef3b0f90656372d03a9c38613afe32f0ee99e1cfa1abd888895aae',
    'order_block|B_second_swing|off': '3cb50c72a7d0528fab05da261d0274d88bf0493d06b7d88191b02a9da2b38ed3',
    'fair_value_gap|A_sweep_buffer|on': 'dd7c6d6eb140b5da7a41a811f49d1bd31960d1c3441732d1e9188123c697615f',
    'fair_value_gap|A_sweep_buffer|off': '0458755855a672581c7c0ab02f63577f6ce277c35de6a81288c28f8e945e9bec',
    'fair_value_gap|B_second_swing|on': '912f5fc837b11fed0125633f3174ed2e90a06d85b8ceb8e88530eea2dbd191b7',
    'fair_value_gap|B_second_swing|off': '79b8d0e58afb9a7609bbbbd65b7e79c49b31b333966375df014f47f7ecec75de',
  };
  for (const [key, h] of Object.entries(want)) {
    const [zone, stop, bias] = key.split('|');
    const r = runSymbol({ symbol: 'QQQ', daily, sessions, variant: { name: 'snap', zone, stop, bias }, window: { start: '2019-02-01', end: '2019-09-30' } });
    assert.equal(hashOf(r), h, key);
    assert.deepEqual(r.variant.switches, { lastFill: 11, previousBars: 0, invalidation: 'close_beyond_level' });
  }
  // The real round-1 files carry the round-1 values explicitly and give the same switches.
  for (const f of ROUND1_VARIANTS) assert.deepEqual(switchesOf(loadVariant(f)), { lastFill: 11, previousBars: 0, invalidation: 'close_beyond_level' }, f);
});

test('switchesOf: the declared switches, and refusals of inconsistent declarations', () => {
  assert.deepEqual(switchesOf(COMBINED), { lastFill: 17, previousBars: 12, invalidation: 'none' });
  assert.deepEqual(switchesOf(CUTOFF), { lastFill: 17, previousBars: 0, invalidation: 'close_beyond_level' });
  assert.throws(() => switchesOf({ ...BASE, entryCutoff: { lastFillBarIndex: 17 }, bos: { lastBarIndex: 11 } }), /bos.lastBarIndex must equal/);
  assert.throws(() => switchesOf({ ...BASE, swing: { scope: 'global' } }), /unknown swing.scope/);
  assert.throws(() => switchesOf({ ...BASE, sweep: { invalidation: 'maybe' } }), /unknown sweep.invalidation/);
  assert.throws(() => switchesOf({ ...BASE, entryCutoff: { lastFillBarIndex: 5 } }), /above 5/);
});

test('R2-1: a break at the 10:25 bar fills on the 10:30 bar; the 10:55 bar is the last fill', () => {
  const shifted = {};
  for (const [k, v] of Object.entries(LONG_DAY)) shifted[Number(k) + 5] = v; // sweep at 5, break at 11, bar 12 trades through 101.5
  const r1 = run(scenario({ overrides: shifted }), BASE);
  assert.equal(r1.sessions[0].stage, 'order_expired', 'round 1: an order placed at 10:30:00 cannot fill');
  const r2 = run(scenario({ overrides: shifted }), CUTOFF);
  const t = r2.trades[0];
  assert.equal(r2.sessions[0].stage, 'filled');
  assert.deepEqual([t.sweepIdx, t.bosIdx, t.entry, t.stop, t.fillIdx, t.exitIdx, t.exitReason], [5, 11, 101.5, 99.3, 12, 14, 'target']);
  close(t.R, 84600 / 22000);
  // Bars 12 to 16 do not trade through; bar 17 does: the last allowed fill; the time stop then exits at 15:55.
  const late = { ...shifted, 12: bar(103.2, 103.4, 101.6, 102), 13: bar(102, 103, 101.6, 102.5), 14: bar(102.5, 103, 102, 102.8), 15: bar(102.8, 103, 102.2, 102.6), 16: bar(102.8, 103, 102.2, 102.6), 17: bar(102.6, 103, 101.4, 102) };
  const r3 = run(scenario({ overrides: late }), CUTOFF);
  assert.equal(r3.trades[0].fillIdx, 17);
  assert.equal(r3.trades[0].exitReason, 'time');
  assert.equal(r3.trades[0].exitIdx, 77);
  close(r3.trades[0].R, ((104 - 0.02) - (101.5 + 0.02)) / 2.2);
  // Bar 17 does not trade through and bar 18 does: expired.
  const tooLate = { ...late, 17: bar(102.6, 103, 102.2, 102.6), 18: bar(102.6, 103, 101.4, 102) };
  assert.equal(run(scenario({ overrides: tooLate }), CUTOFF).sessions[0].stage, 'order_expired');
  // The sweep window is unchanged: a sweep at bar 6 is still outside it.
  const six = {};
  for (const [k, v] of Object.entries(LONG_DAY)) six[Number(k) + 6] = v;
  assert.equal(run(scenario({ overrides: six }), CUTOFF).sessions[0].stage, 'no_sweep');
});

test("R2-2: the previous session's last twelve bars give the structure: a swing confirmed by today's first bar, a break at bar 1, the order block from yesterday's last bar", () => {
  const today = { 0: bar(100.2, 101.5, 99.5, 100.5), 1: bar(100.5, 103.4, 100.2, 103.2), 2: bar(103.2, 103.3, 101.0, 102.5), 3: bar(102.5, 110.5, 102.0, 109.0) };
  const build = () => {
    const sc = scenario({ overrides: today });
    const prev = sc.sessions[sc.sessions.length - 2];
    const set = (i, b) => Object.assign(prev.bars[i], b);
    for (let i = 66; i <= 73; i++) set(i, bar(102, 102, 102, 102));
    set(74, bar(102, 102.6, 101.8, 102.4));
    set(75, bar(102.4, 103.0, 102.2, 102.7)); // a swing high (103.0), confirmed three bars later: by today's bar 0
    set(76, bar(102.7, 102.9, 101.5, 101.8));
    set(77, bar(101.8, 102.0, 100.4, 100.6)); // bearish: the order block
    return sc;
  };
  const r1 = run(build(), BASE);
  assert.equal(r1.sessions[0].stage, 'no_bos', "round 1: today's structure gives no usable break");
  const r2 = run(build(), XSESSION);
  assert.equal(r2.sessions[0].stage, 'filled');
  const t = r2.trades[0];
  assert.equal(t.bosIdx, 1);
  assert.equal(t.swingIdx, -3, "yesterday's bar 75 is extended index 9, three bars before today's index 0");
  assert.equal(t.swingLevel, 103);
  assert.deepEqual(t.zone, { type: 'order_block', index: -1, lo: 100.4, hi: 102 });
  assert.equal(t.legExtremeIdx, 0);
  assert.equal(t.entry, 102);
  assert.equal(t.stop, 99.3);
  close(t.risk, 2.7);
  assert.equal(t.fillIdx, 2);
  assert.equal(t.exitIdx, 3);
  assert.equal(t.exitReason, 'target');
  close(t.R, ((110 - 0.02) - (102 + 0.02)) / 2.7);
  // Stop B across the boundary: only one swing low (yesterday's bar 74) is confirmed by the break: no trade.
  const b = run(build(), { ...XSESSION, stop: 'B_second_swing' });
  assert.equal(b.sessions[0].stage, 'no_second_swing');
  // Eleven previous bars instead of twelve: yesterday's bar 75 is then extended index 8 and is still confirmed by today's bar 0, so the trade is identical.
  const eleven = run(build(), { ...XSESSION, swing: { scope: 'cross_session', previousSessionBars: 11 } });
  assert.equal(eleven.trades[0].entry, 102);
  // Three previous bars: the swing at bar 75 is outside the series; no break at bar 1, today's structure alone fails.
  const three = run(build(), { ...XSESSION, swing: { scope: 'cross_session', previousSessionBars: 3 } });
  assert.equal(three.sessions[0].stage, 'no_bos');
});

test('R2-3: a close back beyond the level no longer voids the setup; the extreme follows the lower low into the stop and the order block', () => {
  const day = { ...LONG_DAY, 1: bar(100.5, 101, 99.4, 99.8), 7: bar(103.2, 103.4, 100.9, 102) };
  assert.equal(run(scenario({ overrides: day }), BASE).sessions[0].stage, 'sweep_invalidated');
  const r = run(scenario({ overrides: day }), NOINVAL);
  const t = r.trades[0];
  assert.equal(r.sessions[0].stage, 'filled');
  assert.equal(t.sweepIdx, 0);
  assert.equal(t.sweepExtreme, 99.4);
  assert.equal(t.bosIdx, 6);
  assert.equal(t.legExtremeIdx, 1);
  assert.deepEqual(t.zone, { type: 'order_block', index: 1, lo: 99.4, hi: 101 });
  assert.equal(t.entry, 101);
  assert.equal(t.stop, 99.2);
  close(t.risk, 1.8);
  assert.equal(t.fillIdx, 7);
  assert.equal(t.exitReason, 'target');
  close(t.R, ((110 - 0.02) - (101 + 0.02)) / 1.8);
  // The both-sides and first-sweep rules are unchanged.
  const both = run(scenario({ overrides: { ...day, 0: bar(105, 110.5, 99.5, 105) } }), NOINVAL);
  assert.equal(both.sessions[0].ambiguousSweepBars, 1);
});

test('R2-4: the combined file reproduces each single change on its day', () => {
  const shifted = {};
  for (const [k, v] of Object.entries(LONG_DAY)) shifted[Number(k) + 5] = v;
  assert.deepEqual(run(scenario({ overrides: shifted }), COMBINED).trades[0], run(scenario({ overrides: shifted }), CUTOFF).trades[0]);
  const day = { ...LONG_DAY, 1: bar(100.5, 101, 99.4, 99.8), 7: bar(103.2, 103.4, 100.9, 102) };
  assert.deepEqual(run(scenario({ overrides: day }), COMBINED).trades[0], run(scenario({ overrides: day }), NOINVAL).trades[0]);
  const today = { 0: bar(100.2, 101.5, 99.5, 100.5), 1: bar(100.5, 103.4, 100.2, 103.2), 2: bar(103.2, 103.3, 101.0, 102.5), 3: bar(102.5, 110.5, 102.0, 109.0) };
  const sc = scenario({ overrides: today });
  const prev = sc.sessions[sc.sessions.length - 2];
  Object.assign(prev.bars[77], bar(101.8, 102.0, 100.4, 100.6));
  Object.assign(prev.bars[75], bar(102.4, 103.0, 102.2, 102.7));
  Object.assign(prev.bars[74], bar(102, 102.6, 101.8, 102.4));
  Object.assign(prev.bars[76], bar(102.7, 102.9, 101.5, 101.8));
  for (let i = 66; i <= 73; i++) Object.assign(prev.bars[i], bar(102, 102, 102, 102));
  const a = run(structuredClone(sc), COMBINED), b = run(structuredClone(sc), XSESSION);
  assert.deepEqual(a.trades[0], b.trades[0]);
  assert.deepEqual(a.variant.switches, { lastFill: 17, previousBars: 12, invalidation: 'none' });
});

test('the round-2 files: pinned, validated as one change each from the base, and refused with a wrong declaration', () => {
  assert.deepEqual(ROUND2_VARIANTS, ['sb-ob-a-nobias-cutoff1055-0.2.0.json', 'sb-ob-a-nobias-xsession-0.2.0.json', 'sb-ob-a-nobias-noinval-0.2.0.json', 'sb-ob-a-nobias-combined-0.2.0.json']);
  const want = { 'sb-ob-a-nobias-cutoff1055-0.2.0.json': { lastFill: 17, previousBars: 0, invalidation: 'close_beyond_level' }, 'sb-ob-a-nobias-xsession-0.2.0.json': { lastFill: 11, previousBars: 12, invalidation: 'close_beyond_level' }, 'sb-ob-a-nobias-noinval-0.2.0.json': { lastFill: 11, previousBars: 0, invalidation: 'none' }, 'sb-ob-a-nobias-combined-0.2.0.json': { lastFill: 17, previousBars: 12, invalidation: 'none' } };
  for (const f of ROUND2_VARIANTS) {
    const v = loadVariant(f);
    assert.equal(v.round, 2, f);
    assert.equal(v.hash, VARIANT_SHA256[f], f);
    assert.equal(textSha256(fs.readFileSync(path.join(VARIANT_DIR, f), 'utf8')), VARIANT_SHA256[f], f);
    assert.deepEqual(switchesOf(v), want[f], f);
    assert.deepEqual([v.zone, v.stop, v.bias, v.version, v.basedOn.file], ['order_block', 'A_sweep_buffer', 'off', '0.2.0', 'sb-ob-a-nobias-0.1.0.json']);
  }
  const base = JSON.parse(fs.readFileSync(path.join(VARIANT_DIR, 'sb-ob-a-nobias-0.1.0.json'), 'utf8'));
  assert.deepEqual(validateVariant(base), []);
  assert.ok(validateVariant({ ...base, sweep: { invalidation: 'none' } }).some((e) => /keeps the invalidation rule/.test(e)));
  assert.ok(validateVariant({ ...base, entryCutoff: { lastFillBarIndex: 17 } }).some((e) => /keeps entryCutoff.lastFillBarIndex 11/.test(e)));
  assert.ok(validateVariant({ ...base, swing: { ...base.swing, scope: 'cross_session', previousSessionBars: 12 }, zones: { ...base.zones, orderBlockSearch: 'cross_session' } }).some((e) => /keeps swing.scope/.test(e)));
  const r2 = JSON.parse(fs.readFileSync(path.join(VARIANT_DIR, 'sb-ob-a-nobias-noinval-0.2.0.json'), 'utf8'));
  assert.deepEqual(validateVariant(r2), []);
  assert.ok(validateVariant({ ...r2, basedOn: undefined }).some((e) => /basedOn/.test(e)));
  assert.ok(validateVariant({ ...r2, sweep: { invalidation: 'close_beyond_level' } }).some((e) => /must change at least one/.test(e)));
  assert.ok(validateVariant({ ...r2, entryCutoff: { lastFillBarIndex: 17 }, bos: { ...r2.bos, lastBarIndex: 11 } }).some((e) => /bos.lastBarIndex must equal/.test(e)));
  assert.ok(validateVariant({ ...r2, bias: 'on' }).some((e) => /keeps zone order_block, stop A and bias off/.test(e)));
  assert.ok(validateVariant({ ...r2, swing: { ...r2.swing, scope: 'cross_session', previousSessionBars: 12 } }).some((e) => /orderBlockSearch must be/.test(e)));
  assert.equal(roundVariants(1).length, 8);
  assert.equal(roundVariants(2).length, 4);
  assert.equal(roundVariants(3).length, 0);
  assert.equal(frozenTitle(2), 'Code frozen for round 2');
  assert.equal(CODE_REVISION, 'sb-code-2026-11-03-2');
});

test('the count-only pass: gate-checked, counts equal to the stage formula, nothing recorded, no outcome or R figure in the output', async () => {
  const { launch } = await import('../scripts/sweepbos-run.mjs');
  const { countsOf } = await import('../server/sweepbos/service.js');
  const { loadInputs } = await import('../server/sweepbos/data.js');
  const store = await import('../server/sweepbos/store.js');
  const f = serviceFixture();
  const R2 = 'sb-ob-a-nobias-combined-0.2.0.json';
  assert.throws(() => f.service.countOnly({ variantFile: R2, round: 2 }), /the run gate refuses/, 'no round-2 code-frozen entry yet');
  fs.appendFileSync(f.logPath, frozenEntry({ dataHash: f.dataHash, number: 2, round: 2 }));
  const c = f.service.countOnly({ variantFile: R2, round: 2 });
  assert.deepEqual(Object.keys(c).sort(), ['counts', 'dataHash', 'dataVersionId', 'round', 'variant', 'variantHash', 'window']);
  assert.deepEqual(Object.keys(c.counts), ['QQQ', 'SPY']);
  for (const sym of ['QQQ', 'SPY']) assert.deepEqual(Object.keys(c.counts[sym]), ['sessions', 'sweeps', 'breaks', 'orders', 'fills']);
  // The counts equal the stage formula of a direct engine run, and the stages themselves add up.
  const db = store.openSbDb(f.dbFile, { readOnly: true });
  const v = loadVariant(R2);
  for (const sym of ['QQQ', 'SPY']) {
    const inputs = loadInputs(db, f.versionId, sym);
    const r = runSymbol({ symbol: sym, daily: inputs.daily, sessions: inputs.sessions, variant: v, window: { start: '2019-01-02', end: '2022-12-30' } });
    const s = r.stageCounts;
    const expected = { sessions: r.sessionsInWindow, sweeps: r.sessionsInWindow - s.incomplete_session - s.no_prior_session - s.no_bias - s.no_sweep, breaks: s.no_zone + s.entry_not_inside_close + s.no_second_swing + s.stop_not_beyond_entry + s.target_too_close + s.order_expired + s.filled, orders: s.order_expired + s.filled, fills: s.filled };
    assert.deepEqual(c.counts[sym], expected, sym);
    assert.deepEqual(countsOf(r), expected, sym);
    assert.ok(expected.sweeps >= expected.breaks && expected.breaks >= expected.orders && expected.orders >= expected.fills);
    assert.ok(expected.sweeps > 0 && s.order_expired > 0, 'the synthetic fixture exercises every count');
  }
  assert.equal(store.listRuns(db).length, 0, 'no run row');
  assert.equal(store.listLedger(db).filter((l) => l.kind === 'run').length, 0, 'no ledger row');
  db.close();
  // The launcher's count mode prints only counts.
  const lines = [], errors = [];
  const out = await launch({ argv: ['--count', '--round', '2', '--variant', R2], io: { log: (l) => lines.push(String(l)), error: (l) => errors.push(String(l)) }, service: f.service, logPath: f.logPath });
  assert.equal(out.mode, 'count');
  assert.equal(out.ran, false);
  assert.deepEqual(out.counts.counts, c.counts);
  const printed = lines.filter((l) => /^  (QQQ|SPY): sessions/.test(l));
  assert.equal(printed.length, 2);
  assert.ok(!lines.some((l) => /mean R|win rate|drawdown|ending cash|R2x|profit factor|bootstrap|null p|candidate|pooled/i.test(l)), `no outcome or R figure printed: ${lines.join(' | ')}`);
  assert.ok(lines.some((l) => l.startsWith('Nothing was recorded; no return or R figure exists in this output.')));
  assert.equal(f.service.listRuns().length, 0);
  // A closed gate refuses the count pass too.
  const closed = serviceFixture({ frozen: false });
  const o2 = await launch({ argv: ['--count', '--round', '2', '--variant', R2], io: { log: () => {}, error: () => {} }, service: closed.service, logPath: closed.logPath });
  assert.equal(o2.refusedBy, 'launcher');
});

test('the gate by round: round 2 needs its own code-frozen entry; a round-1 file is refused in round 2 and a round-2 file in round 1; a round-2 run is recorded with its round', () => {
  const f = serviceFixture();
  const R2 = 'sb-ob-a-nobias-cutoff1055-0.2.0.json', R1 = 'sb-ob-a-nobias-0.1.0.json';
  const failed = (g) => g.conditions.filter((c) => !c.ok).map((c) => c.name);
  const detail = (g, name) => g.conditions.find((c) => c.name === name).detail;
  const g0 = f.service.gateStatus({ variantFile: R2, round: 2 });
  assert.deepEqual(failed(g0), ['code-frozen-entry'], 'the round-1 entry does not open round 2');
  assert.match(detail(g0, 'code-frozen-entry'), /no entry titled "\*\*Code frozen for round 2\*\*"/);
  assert.equal(logStatus(f.logPath, { preregCommit: COMMIT, round: 2 }).frozen, null);
  assert.ok(logStatus(f.logPath, { preregCommit: COMMIT, round: 1 }).frozen);
  fs.appendFileSync(f.logPath, frozenEntry({ dataHash: f.dataHash, number: 2, round: 2 }));
  assert.deepEqual(failed(f.service.gateStatus({ variantFile: R2, round: 2 })), []);
  const wrong = f.service.gateStatus({ variantFile: R1, round: 2 });
  assert.deepEqual(failed(wrong), ['variant']);
  assert.match(detail(wrong, 'variant'), /not one of round 2's 4 pre-registered variants/);
  const wrong1 = f.service.gateStatus({ variantFile: R2, round: 1 });
  assert.deepEqual(failed(wrong1), ['variant']);
  assert.match(detail(wrong1, 'variant'), /not one of round 1's 8 pre-registered variants/);
  const r = f.service.run({ variantFile: R2, round: 2, confirm: true });
  assert.equal(r.run.status, 'done');
  assert.equal(r.run.round, 2);
  assert.equal(r.run.details.variant.file, R2);
  const e = parseEntries(r.entry)[0];
  assert.match(e.title, RUN_ENTRY);
  assert.match(e.body, /Round 2 development run/);
  fs.appendFileSync(f.logPath, r.entry);
  assert.deepEqual(failed(f.service.gateStatus({ variantFile: R2, round: 2 })), ['variant-not-run']);
  assert.deepEqual(failed(f.service.gateStatus({ variantFile: 'sb-ob-a-nobias-noinval-0.2.0.json', round: 2 })), []);
  const p = f.service.pickReport({ round: 2 });
  assert.equal(p.expected, 4);
  assert.equal(p.recorded, 1);
  assert.equal(p.pick, null);
  assert.equal(f.service.pickReport({ round: 1 }).expected, 8);
});
