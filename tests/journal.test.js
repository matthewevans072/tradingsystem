// Prospective journal 1 end to end on synthetic data (server/research/journal.js): activation from a committed
// record (fake git; the start derived from the commit's New York date), the warm-up copy with its exposure labels,
// the bounded download through HXR's Alpaca client against the fake Alpaca (whose market runs to 2026-11-20), on-time
// and late sessions, a catch-up, an update that crosses the next open, the release of held exits, the replay check,
// missing and late-arriving bars, the operational status without performance, and the date-gated review.
// Synthetic prices only exercise the code; nothing here is a result.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { buildMarket, fakeAlpaca, KEY_ID, SECRET_KEY } from './hxr-fake-alpaca.js';
import { hxrData } from './rangetrend-fixtures.js';
import * as hxrStore from '../server/hxr/store.js';
import { loadHxrUniverse, loadHxrPeriods, excludedDates } from '../server/hxr/config.js';
import { buildSpreadTable, buildInputs } from '../server/hxr/data.js';
import { createHxrSource } from '../server/hxr/source.js';
import { createJournal, buildActivationRecord, buildDays, startFromCommitDate, sessionsBack, latestCompleteSession, firstSessionOpenAfter, ROOT, PINNED_FILES, REVIEW_DATE } from '../server/research/journal.js';
import { createJournalDownloader, DownloadRefused } from '../server/research/journal-download.js';
import { main as cli } from '../scripts/journal.mjs';

const SRC = 'b'.repeat(40), ACT = 'a'.repeat(40);
const COMMITTED_AT = '2026-11-05T21:00:00-06:00'; // 22:00 ET on 2026-11-05: the start is 2026-11-06
let hxrDir, hxrFile, calibrationSha;
const market = buildMarket();
before(async () => {
  hxrDir = tempDir('pj-hxr-');
  ({} = await hxrData(hxrDir, market));
  hxrFile = path.join(hxrDir, 'hxr-sim.sqlite');
  const hdb = hxrStore.openHxrDb(hxrFile, { readOnly: true });
  calibrationSha = buildSpreadTable(hdb, loadHxrUniverse(), { floorBps: 2, toYear: 2021 }).hash;
  hdb.close();
});

const fakeGit = ({ committedAt = COMMITTED_AT, status = '', ancestor = true, show = null } = {}) => (args) => {
  if (args[0] === 'log') return `${ACT}\t${committedAt}`;
  if (args[0] === 'status') return status;
  if (args[0] === 'merge-base') { if (!ancestor) throw new Error('not an ancestor'); return ''; }
  if (args[0] === 'show') { const p = args[1].slice(41); return show ? show(p) : fs.readFileSync(path.join(ROOT, p), 'utf8').trimEnd(); }
  throw new Error(`unexpected git ${args.join(' ')}`);
};
// A journal with its own database and record, the shared fake HXR database, a fake Alpaca on `clock`, and an
// optional filter that drops bars as they arrive (to simulate late data).
function setup({ reviewDate = '2026-11-13', committedAt = COMMITTED_AT, gitOpts = {}, clockRef = null, drop = null, pinned = PINNED_FILES, recordPatch = null } = {}) {
  const dir = tempDir('pj-');
  const activationFile = path.join(dir, 'ACTIVATION.json');
  const rec = buildActivationRecord({ root: ROOT, sourceCommit: SRC, now: new Date(committedAt), reviewDate, calibrationSha, pinned });
  if (recordPatch) recordPatch(rec);
  fs.writeFileSync(activationFile, JSON.stringify(rec, null, 2));
  const ref = clockRef ?? { now: new Date('2026-11-05T23:00:00Z'), step: 0 };
  const clock = () => { const t = new Date(ref.now.getTime()); ref.now = new Date(ref.now.getTime() + (ref.step || 0)); return t; };
  const fake = fakeAlpaca({ clock, market });
  const sourceFactory = (wrap) => {
    const base = createHxrSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: wrap(fake.fetchImpl), now: clock, sleep: async () => {} });
    return { ...base, dailyBars: async (s, o) => { const rows = await base.dailyBars(s, o); return drop ? rows.filter((b) => !drop(s, b.date)) : rows; } };
  };
  const j = createJournal({ dbFile: path.join(dir, 'prospective-1.sqlite'), hxrFile, clock, git: fakeGit({ committedAt, ...gitOpts }), sourceFactory, testOverrides: true, overrides: { reviewDate, activationFile, calibrationSha, pinned } });
  return { j, ref, dir, rec, fake };
}
const setNow = (ref, iso, step = 0) => { ref.now = new Date(iso); ref.step = step; };

test('calendar helpers: the start from the commit\'s New York date, the warm-up start, the latest final bar, the first open after an instant', () => {
  assert.equal(startFromCommitDate('2026-11-05T21:00:00-06:00'), '2026-11-06', '22:00 ET on 5 November');
  assert.equal(startFromCommitDate('2026-11-06T05:30:00Z'), '2026-11-09', '00:30 ET on 6 November gives the next session after it');
  assert.equal(startFromCommitDate('2026-11-06T22:00:00Z'), '2026-11-09');
  assert.equal(sessionsBack('2026-11-06', 200), '2026-01-22'); assert.equal(sessionsBack('2026-11-09', 200), '2026-01-23');
  assert.equal(latestCompleteSession(new Date('2026-11-06T21:15:00Z')), '2026-11-05', '16:15 ET: the bar is final only 20 minutes after the close');
  assert.equal(latestCompleteSession(new Date('2026-11-06T21:21:00Z')), '2026-11-06');
  assert.equal(firstSessionOpenAfter(new Date('2026-11-06T22:00:00Z')), '2026-11-09');
  assert.equal(firstSessionOpenAfter(new Date('2026-11-10T15:00:00Z')), '2026-11-11');
  assert.equal(REVIEW_DATE, '2027-11-05');
});

test('the day builder follows buildInputs exactly (bars, splits on the session on or after the ex-date, dividends) on the fake HXR data', () => {
  const hdb = hxrStore.openHxrDb(hxrFile, { readOnly: true });
  const universe = loadHxrUniverse();
  const syms = ['MU', 'AMZN', 'META', 'TSLA', 'VST', 'GOOG', 'INTC', 'CSCO', 'PYPL', 'SNAP'];
  const inp = buildInputs(hdb, { universe, symbols: syms, warmupFrom: '2020-01-02', end: '2022-12-30', excludedSessions: excludedDates(loadHxrPeriods()) });
  const bars = syms.flatMap((s) => hxrStore.getBars(hdb, s, { from: '2020-01-02', to: '2022-12-30' }).map((b) => ({ ...b, symbol: s })));
  const actions = syms.flatMap((s) => hxrStore.listCorporateActions(hdb, { symbol: s, types: ['forward_split', 'reverse_split', 'cash_dividend'] }).filter((a) => a.symbol === s));
  const days = buildDays({ sessions: inp.sessions, symbols: inp.symbols, bars, actions });
  let splits = 0;
  for (const d of inp.sessions) { const a = inp.days.get(d), b = days.get(d); splits += a.splits.length; for (const s of syms) assert.deepEqual(b.bars[s] ?? null, a.bars[s] ? { ...a.bars[s], vw15: null } : null, `${d} ${s}`); assert.deepEqual(b.splits, a.splits, d); assert.deepEqual(b.dividends, a.dividends, d); }
  assert.ok(splits >= 2, 'the fixture holds splits in the window');
  hdb.close();
});

test('the downloader refuses any other symbol and any date before 2026-10-23 before a request, and keeps only splits and cash dividends', async () => {
  const ref = { now: new Date('2026-11-10T23:00:00Z') };
  const clock = () => ref.now;
  const fake = fakeAlpaca({ clock, market });
  const source = createHxrSource({ keyId: KEY_ID, secretKey: SECRET_KEY, fetchImpl: fake.fetchImpl, now: clock, sleep: async () => {} });
  const dl = createJournalDownloader({ source, symbols: ['MU', 'CSCO'], forwardFrom: '2026-10-23' });
  await assert.rejects(dl.dailyBars('NVDA', { from: '2026-10-23', to: '2026-11-06' }), DownloadRefused);
  await assert.rejects(dl.dailyBars('MU', { from: '2026-10-22', to: '2026-11-06' }), /forward only/);
  await assert.rejects(dl.dailyBars('MU', { from: '2024-06-03', to: '2026-11-06' }), /forward only/);
  const before = fake.calls.length;
  await assert.rejects(dl.dailyBars('HOOD', { from: '2026-10-23', to: '2026-11-06' }), /basket A only/);
  assert.equal(fake.calls.length, before, 'refused before any request');
  const rows = await dl.dailyBars('MU', { from: '2026-10-23', to: '2026-11-06' });
  assert.ok(rows.length >= 10 && rows.every((b) => b.date >= '2026-10-23' && b.date <= '2026-11-06'));
  const acts = await dl.corporateActions();
  assert.ok([...acts.handled, ...acts.unhandled].every((a) => a.ex_date >= '2026-10-23' && ['MU', 'CSCO'].includes(a.symbol)));
  assert.ok(acts.handled.every((a) => ['forward_split', 'reverse_split', 'cash_dividend'].includes(a.type)));
});

test('activation: refused while the record is uncommitted, modified, from a non-ancestor source, with a start that does not match its commit, or with a changed pinned file', () => {
  assert.match(setup({ gitOpts: { status: ' M ACTIVATION.json' } }).j.activationStatus().problems.join('; '), /uncommitted changes/);
  assert.match(setup({ gitOpts: { ancestor: false } }).j.activationStatus().problems.join('; '), /not an ancestor/);
  // A record prepared on 5 November but committed after midnight in New York: the derived start (9 November) differs.
  const late = setup();
  const lateJ = createJournal({ dbFile: path.join(late.dir, 'other.sqlite'), hxrFile, clock: () => new Date('2026-11-05T23:00:00Z'), git: fakeGit({ committedAt: '2026-11-06T05:30:00Z' }), testOverrides: true, overrides: { reviewDate: '2026-11-13', activationFile: path.join(late.dir, 'ACTIVATION.json'), calibrationSha } });
  assert.match(lateJ.activationStatus().problems.join('; '), /differs from the record's expectedStart/);
  // A pinned file that changes after the record was written.
  const d = tempDir('pj-pin-'); const pf = path.join(d, 'pinned.js'); fs.writeFileSync(pf, 'one\n');
  const pinned = [...PINNED_FILES, { path: pf, role: 'test' }];
  const s = setup({ pinned, gitOpts: { show: (p) => (p === pf ? 'one' : fs.readFileSync(path.join(ROOT, p), 'utf8').trimEnd()) } });
  assert.equal(s.j.activationStatus().ok, true, s.j.activationStatus().problems.join('; '));
  fs.writeFileSync(pf, 'two\n');
  assert.match(s.j.activationStatus().problems.join('; '), /differs from its pinned SHA-256/);
  assert.throws(() => s.j.activate({ confirm: true }), /not valid/);
  assert.match(setup({ recordPatch: (r) => { r.rules[0].configHash = 'f'.repeat(64); } }).j.activationStatus().problems.join('; '), /M1: the record's rule or config hash differs/);
  assert.throws(() => setup().j.activate({}), /confirm/);
});

test('the journal end to end: activation and the warm-up copy, a warm-up-only update, an on-time session, a late session with vetoed entries and held exits, a catch-up, the replay, the status without performance, and the gated review', async () => {
  const { j, ref } = setup();
  const act = j.activate({ confirm: true });
  assert.equal(act.start, '2026-11-06'); assert.equal(act.warmupFrom, '2026-01-22');
  assert.equal(act.copied.to, '2026-10-22');
  assert.equal(act.exposure.MU.windows.labMU.count, 110, 'MU closes from the Strategy Lab holdout, 2026-01-22 to 2026-06-30');
  assert.equal(act.exposure.AMZN.windows.final.count, 189); assert.equal(act.exposure.AMZN.windows.labMU, undefined);
  const metaBars = j.db.prepare("SELECT source, COUNT(*) AS n FROM pj_bars GROUP BY source").all();
  assert.ok(metaBars.some((r) => /closed window .*indicator warm-up only/.test(r.source)) && metaBars.some((r) => /after the closed windows/.test(r.source)));
  assert.throws(() => j.activate({ confirm: true }), /already activated/);

  // 18:00 ET on 5 November: warm-up only (the forward bars 2026-10-23 to 11-05 are downloaded).
  const u1 = await j.update();
  assert.equal(u1.status, 'recorded');
  assert.ok(u1.processed.every((p) => p.phase === 'warmup')); assert.equal(u1.processed.at(-1).session, '2026-11-05');
  assert.equal(u1.processed.length, 200);
  assert.ok(Object.values(u1.fetched).every((n) => n === 10), 'ten forward sessions per stock');
  // 16:45 ET on 6 November: the start session, on time.
  setNow(ref, '2026-11-06T21:45:00Z');
  const u2 = await j.update();
  assert.deepEqual(u2.processed.map((p) => [p.session, p.phase, p.onTime]), [['2026-11-06', 'live', true]]);
  // 10:00 ET on 10 November: 9 November is processed after its next open: late.
  setNow(ref, '2026-11-10T15:00:00Z');
  const u3 = await j.update();
  assert.deepEqual(u3.processed.map((p) => [p.session, p.onTime]), [['2026-11-09', false]]);
  const evs = j.db.prepare("SELECT * FROM pj_events WHERE date = '2026-11-09'").all().map((e) => ({ ...e, detail: JSON.parse(e.detail_json) }));
  for (const rule of ['M1', 'B0', 'M0']) {
    const recon = evs.filter((e) => e.rule === rule && e.ledger === 'reconstructed' && e.kind === 'decision_entry').map((e) => e.symbol).sort();
    const vetoed = evs.filter((e) => e.rule === rule && e.ledger === 'primary' && e.kind === 'skip' && e.detail.code === 'late_veto').map((e) => e.symbol).sort();
    assert.deepEqual(vetoed, recon, `${rule}: every entry the on-time account takes on the late session is vetoed in the primary account`);
    assert.equal(evs.filter((e) => e.rule === rule && e.ledger === 'primary' && e.kind === 'decision_entry').length, 0);
    assert.ok(evs.filter((e) => e.ledger === 'primary' && e.rule === rule && e.kind.startsWith('decision_')).every((e) => e.on_time === 0));
  }
  const heldExits = evs.filter((e) => e.ledger === 'primary' && e.kind === 'decision_exit');
  if (heldExits.length) {
    assert.ok(heldExits.every((e) => e.detail.held === true && e.detail.late === true));
    const rel = j.db.prepare('SELECT * FROM pj_releases').all();
    assert.equal(rel.length, 1); assert.equal(rel[0].fill_after, '2026-11-10', 'recorded during the 10 November session: the first open after it is 11 November');
  }
  // 17:00 ET on Friday 13 November: a catch-up of 10 to 13 November; only 13 November is on time.
  setNow(ref, '2026-11-13T22:00:00Z');
  const u4 = await j.update();
  assert.deepEqual(u4.processed.map((p) => [p.session, p.onTime]), [['2026-11-10', false], ['2026-11-11', false], ['2026-11-12', false], ['2026-11-13', true]]);
  if (heldExits.length) {
    const fillsOn11 = j.db.prepare("SELECT * FROM pj_events WHERE ledger = 'primary' AND kind = 'fill_sell' AND date = '2026-11-11'").all().map((e) => JSON.parse(e.detail_json));
    for (const h of heldExits) assert.ok(fillsOn11.some((f) => f.symbol === h.symbol && f.lateExit === true), `${h.rule} ${h.symbol}: the held exit fills at the open of 11 November`);
  }
  assert.deepEqual(j.verifyReplay().ok, true);
  // The status shows operational information only.
  const st = j.status();
  assert.equal(st.status, 'complete', 'the review date of this test (13 November) has been processed');
  assert.equal(st.sessions.live, 6, '6, 9, 10, 11, 12 and 13 November'); assert.equal(st.sessions.late, 4, '9 to 12 November');
  const text = JSON.stringify(st);
  assert.doesNotMatch(text, /"(pnl|equity|net|value|cash|proceeds|cost|costs|totalReturnPct|maxDrawdownPct|annualisedReturnPct|holdings)"/);
  assert.ok(Number.isInteger(st.completedOnTimeM1PrimaryTrades));
  // The journal is complete: no further update; the review runs and labels the sample.
  await assert.rejects(j.update(), /complete/);
  const r = await j.review();
  assert.equal(r.label, r.completedOnTimeM1PrimaryTrades < 30 ? 'insufficient sample' : 'sample reached');
  assert.equal(r.rules.M1.primary.nullTest.resamples, 20000); assert.equal(r.rules.M1.primary.nullTest.seed, 20271105);
  assert.match(r.rules.M1.reconstructed.label, /never counted/);
  assert.ok('B0' in r.m1VsControls && 'M0' in r.m1VsControls);
  j.close();
});

test('before the review date the review is refused and performance stays hidden; an update that crosses the next open records nothing; a later run records the session as late', async () => {
  const { j, ref } = setup({ reviewDate: '2026-11-20' });
  j.activate({ confirm: true });
  setNow(ref, '2026-11-06T21:45:00Z');
  await j.update();
  await assert.rejects(j.review(), /performance stays hidden/);
  // Friday 13 November: the update for 9 to 13 November starts at 09:29:59 ET on Monday 16 November, and its stamp
  // lands after the 09:30 open: nothing is recorded.
  setNow(ref, '2026-11-16T14:29:59Z', 3000);
  const a = await j.update();
  assert.equal(a.status, 'aborted');
  assert.equal(j.db.prepare("SELECT COUNT(*) AS n FROM pj_sessions WHERE date > '2026-11-06'").get().n, 0);
  setNow(ref, '2026-11-16T15:00:00Z');
  const b = await j.update();
  assert.equal(b.processed.at(-1).session, '2026-11-13'); assert.equal(b.processed.at(-1).onTime, false);
  assert.equal(j.verifyReplay().ok, true);
  j.close();
});

test('missing bars: the session waits before its next open, is processed with what has arrived after it (late), and a bar arriving later is kept but never used', async () => {
  let dropping = true;
  const { j, ref } = setup({ reviewDate: '2026-11-20', drop: (s, d) => dropping && s === 'CSCO' && d === '2026-11-06' });
  j.activate({ confirm: true });
  setNow(ref, '2026-11-06T21:45:00Z');
  const w = await j.update();
  assert.equal(w.waiting.session, '2026-11-06'); assert.deepEqual(w.waiting.missing, ['CSCO']);
  assert.equal(j.db.prepare("SELECT COUNT(*) AS n FROM pj_sessions WHERE phase = 'live'").get().n, 0);
  setNow(ref, '2026-11-09T15:00:00Z');
  const p = await j.update();
  assert.deepEqual(p.processed.map((x) => [x.session, x.onTime, x.missing]), [['2026-11-06', false, ['CSCO']]]);
  dropping = false;
  setNow(ref, '2026-11-09T22:00:00Z');
  const q = await j.update();
  assert.ok(q.processed.some((x) => x.session === '2026-11-09'));
  const late = j.db.prepare("SELECT * FROM pj_bars WHERE symbol = 'CSCO' AND date = '2026-11-06'").get();
  assert.equal(late.late, 1, 'the CSCO bar of 6 November arrived after its session was processed');
  assert.equal(j.status().data.lateBars, 1);
  assert.equal(j.verifyReplay().ok, true, 'the late bar never enters the replay');
  j.close();
});

test('the replay detects a stored state that does not match, and an update then refuses to run', async () => {
  const { j, ref } = setup({ reviewDate: '2026-11-20' });
  j.activate({ confirm: true });
  setNow(ref, '2026-11-06T21:45:00Z');
  await j.update();
  const last = j.db.prepare("SELECT * FROM pj_state WHERE rule = 'M1' AND ledger = 'primary' ORDER BY id DESC LIMIT 1").get();
  const bad = JSON.parse(last.snapshot_json); bad.cash += 1;
  j.db.prepare('INSERT INTO pj_state (update_id, rule, ledger, through, snapshot_json, snapshot_sha256) VALUES (?, ?, ?, ?, ?, ?)').run(last.update_id, 'M1', 'primary', last.through, JSON.stringify(bad), 'x');
  assert.equal(j.verifyReplay().ok, false);
  setNow(ref, '2026-11-09T22:00:00Z');
  await assert.rejects(j.update(), /integrity check failed/);
  j.close();
});

test('the command line: status and check print, record refuses a committed record, unknown commands fail; the journal modules import no delivery, alerts, scheduler or order code', async () => {
  const { j } = setup();
  const logs = [];
  assert.equal((await cli(['status'], { journal: j, log: (m) => logs.push(m) })).exitCode, 0);
  assert.match(logs.at(-1), /not activated/);
  assert.equal((await cli(['check'], { journal: j, log: (m) => logs.push(m) })).exitCode, 0);
  assert.equal((await cli(['record', '--source', SRC], { log: (m) => logs.push(m), git: () => ACT })).exitCode, 1);
  assert.match(logs.at(-1), /already committed/);
  assert.equal((await cli(['bogus'], { journal: j, log: () => {} })).exitCode, 1);
  j.close();
  for (const f of ['server/research/journal.js', 'server/research/journal-store.js', 'server/research/journal-download.js', 'server/research/mechanisms-2.js', 'scripts/journal.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /delivery\.js|alerts\.js|scheduler\.js|portfolio\.js|setInterval\(|cron/i, f);
  }
});

test('a late exit through the journal: held at its late session, released when the record is stamped, filled at the first open after the record, while the reconstructed ledger fills it at the next open', async () => {
  const sessions = ['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];
  // Journal A, every session on time: find the first exit decision on a position entered on an earlier session.
  const A = setup({ reviewDate: '2026-11-20' });
  A.j.activate({ confirm: true });
  for (const d of sessions) { setNow(A.ref, `${d}T21:45:00Z`); await A.j.update(); }
  const exitsA = A.j.db.prepare("SELECT * FROM pj_events WHERE ledger = 'primary' AND kind = 'decision_exit' AND date >= '2026-11-09' ORDER BY date, id").all();
  assert.ok(exitsA.length > 0, 'the fake market gives at least one exit in these sessions');
  const E = exitsA[0].date, rule = exitsA[0].rule, sym = exitsA[0].symbol;
  const after = (d) => sessions[sessions.indexOf(d) + 1], after2 = (d) => sessions[sessions.indexOf(d) + 2];
  const fillA = A.j.db.prepare("SELECT date FROM pj_events WHERE ledger = 'primary' AND kind = 'fill_sell' AND rule = ? AND symbol = ? AND date > ? ORDER BY date LIMIT 1").get(rule, sym, E);
  assert.equal(fillA.date, after(E), 'on time, the exit fills at the next open');
  A.j.close();
  // Journal B: the same sessions on time up to the one before E; E itself recorded at 10:00 ET of the next session.
  const B = setup({ reviewDate: '2026-11-20' });
  B.j.activate({ confirm: true });
  for (const d of sessions.slice(0, sessions.indexOf(E))) { setNow(B.ref, `${d}T21:45:00Z`); await B.j.update(); }
  setNow(B.ref, `${after(E)}T15:00:00Z`);
  const u = await B.j.update();
  assert.deepEqual(u.processed.map((p) => [p.session, p.onTime]), [[E, false]]);
  const dec = B.j.db.prepare("SELECT * FROM pj_events WHERE ledger = 'primary' AND kind = 'decision_exit' AND rule = ? AND symbol = ? AND date = ?").get(rule, sym, E);
  assert.ok(dec, `the exit decision of ${rule} ${sym} at ${E} is recorded`);
  assert.equal(JSON.parse(dec.detail_json).held, true); assert.equal(dec.on_time, 0);
  const rel = B.j.db.prepare('SELECT * FROM pj_releases').all();
  assert.equal(rel.length, 1); assert.equal(rel[0].fill_after, after(E), 'stamped during the next session: the first open after it is the session after that');
  assert.ok(JSON.parse(rel[0].symbols_json).some((x) => x.rule === rule && x.symbol === sym));
  const st = B.j.status();
  assert.ok(st.rules[rule].positions.some((p) => p.symbol === sym), 'still held');
  for (const d of [after(E), after2(E)]) { setNow(B.ref, `${d}T21:45:00Z`); await B.j.update(); }
  const fillB = B.j.db.prepare("SELECT * FROM pj_events WHERE ledger = 'primary' AND kind = 'fill_sell' AND rule = ? AND symbol = ? AND date > ? ORDER BY date LIMIT 1").get(rule, sym, E);
  assert.equal(fillB.date, after2(E), 'the late exit fills at the first open after its record');
  assert.equal(JSON.parse(fillB.detail_json).lateExit, true);
  const recon = B.j.db.prepare("SELECT date FROM pj_events WHERE ledger = 'reconstructed' AND kind = 'fill_sell' AND rule = ? AND symbol = ? AND date > ? ORDER BY date LIMIT 1").get(rule, sym, E);
  assert.equal(recon.date, after(E), 'the reconstructed ledger fills it at the next open, as if recorded on time');
  assert.equal(B.j.db.prepare("SELECT COUNT(*) AS n FROM pj_events WHERE ledger = 'primary' AND kind = 'decision_entry' AND rule = ? AND symbol = ? AND date > ? AND date < ?").get(rule, sym, E, after2(E)).n, 0, 'the held position blocks a new entry in the stock');
  assert.equal(B.j.verifyReplay().ok, true);
  B.j.close();
});
