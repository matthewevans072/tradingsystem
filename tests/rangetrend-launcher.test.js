// The gated practice-run launcher (scripts/rangetrend-run.mjs) and the practice-runs-authorized row: refusals
// without the row, check mode (prints every condition, runs nothing), the real repository files (not
// authorized), the log-row append and a failed append, one config per call, and the row read outside fences
// and exactly once. Synthetic HXR data only; the repository's own protocol and log are never written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { LOG, LOG_HEADER, OWNER_ROW, AUTH_ROW, LOG_OWNER_ONLY, files, cfgFile, marketWithTslaBreakout, hxrData } from './rangetrend-fixtures.js';
import { launch, parseArgs } from '../scripts/rangetrend-run.mjs';
import { logStatus, CODE_REVISION, PLANNED_CONFIGS, PROTOCOL_PATH, LOG_PATH, AUTHORIZED_TITLE } from '../server/rangetrend/config.js';
import * as store from '../server/rangetrend/store.js';

const capture = () => { const lines = []; return { lines, io: { log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(`ERROR ${a.join(' ')}`) } }; };
const CONDITION_NAMES = ['config: one of the eight', 'config: matches its pinned', 'EVALUATION-PROTOCOL.md: pick rule', 'protocol hash', 'owner-decisions row', 'code revision', 'practice-runs-authorized row', 'no malformed', 'every practice run it lists', 'database: every run', 'ledger: this config', 'disk:', 'lock:', 'HXR data:'];

test('the authorization row is read outside code fences and HTML comments, exactly once, naming the code revision, every config and the owner\'s message', () => {
  const dir = tempDir('rt-auth-');
  const f = path.join(dir, 'log.md');
  const check = (text) => { fs.writeFileSync(f, text); const s = logStatus(f); return [s.practiceAuthorized, s.practiceAuthorizedProblem]; };
  assert.deepEqual(check(LOG), [true, null]);
  assert.deepEqual(check(LOG_OWNER_ONLY), [false, `no row beginning "**${AUTHORIZED_TITLE}**"`]);
  assert.deepEqual(check(`${LOG_OWNER_ONLY}\`\`\`\n${AUTH_ROW}\`\`\`\n`), [false, `no row beginning "**${AUTHORIZED_TITLE}**"`], 'inside a code fence it is not a row');
  assert.deepEqual(check(`${LOG_OWNER_ONLY}<!--\n${AUTH_ROW}-->\n`)[0], false, 'inside an HTML comment it is not a row');
  assert.match(check(`${LOG}${AUTH_ROW}`)[1], /2 rows beginning .* \(exactly one is read\)/);
  assert.match(check(`${LOG_OWNER_ONLY}${AUTH_ROW.replace(CODE_REVISION, 'rt-code-2026-01-01-1')}`)[1], /does not name the current code revision/);
  assert.match(check(`${LOG_OWNER_ONLY}${AUTH_ROW.replace(PLANNED_CONFIGS[3], 'rt-missing-0.2.0.json')}`)[1], new RegExp(`does not name ${PLANNED_CONFIGS[3]}`));
  assert.match(check(`${LOG_OWNER_ONLY}${AUTH_ROW.replace('"run the eight practice runs"', 'run the eight practice runs')}`)[1], /does not quote the owner's message/);
  assert.deepEqual(check(`${LOG_HEADER}${AUTH_ROW}${OWNER_ROW}`)[0], true, 'row order does not matter');
  // The authorization row is not a practice-run record although its title mentions practice runs.
  fs.writeFileSync(f, LOG);
  assert.deepEqual([logStatus(f).malformed, logStatus(f).practiceRuns], [[], []]);
  // The repository's own log holds the owner's authorization row 17 (2026-11-04, typed by the assistant on the
  // owner's reaffirmed instruction) exactly once, so the real log reads as authorized.
  assert.equal(logStatus().practiceAuthorized, true);
});

test('arguments: one config per invocation, --run needs --confirm-run, unknown flags (the reserve included) are refused, nothing is run', async () => {
  const dir = tempDir('rt-launch-args-');
  const f = files(dir);
  const overrides = { dataDir: dir, ...f };
  assert.deepEqual(parseArgs(['--config', 'a', '--config', 'b', '--reserve']).config, ['a', 'b']);
  assert.deepEqual(parseArgs(['--config=a', '--run']).unknown, []);
  for (const argv of [[], ['--config', PLANNED_CONFIGS[0], '--config', PLANNED_CONFIGS[1]], ['--config', 'rt-range-dip-nolimit-9.9.9.json'], ['--config', PLANNED_CONFIGS[0], '--run'], ['--config', PLANNED_CONFIGS[0], '--reserve', '1'], ['--config', PLANNED_CONFIGS[0], '--run', '--confirm-run', '--invalidated-run', '1']]) {
    const { lines, io } = capture();
    const out = await launch({ argv, io, overrides });
    assert.deepEqual([out.exitCode, out.ran, out.conditions.length], [2, false, 0], argv.join(' '));
    assert.ok(lines.some((l) => l.startsWith('ERROR')), argv.join(' '));
  }
  const db = store.openRtDb(store.rtDbFile(dir));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rt_runs').get().n, 0);
  db.close();
});

test('check mode prints every condition and runs nothing; without the authorization row --run is refused by the launcher itself', async () => {
  const dir = tempDir('rt-launch-check-');
  const f = files(dir, { log: LOG_OWNER_ONLY });
  const overrides = { dataDir: dir, ...f };
  const { lines, io } = capture();
  const out = await launch({ argv: ['--config', PLANNED_CONFIGS[0]], io, overrides });
  assert.deepEqual([out.mode, out.exitCode, out.ran, out.refusedBy], ['check', 0, false, null]);
  for (const name of CONDITION_NAMES) assert.ok(lines.some((l) => l.includes(name)), `prints ${name}`);
  const auth = out.conditions.find((c) => c.name.includes('practice-runs-authorized'));
  assert.deepEqual([auth.ok, /no row beginning/.test(auth.detail)], [false, true]);
  assert.ok(lines.at(-1).includes('NOT authorized'));
  assert.match(out.conditions.find((c) => c.name.startsWith('HXR data')).detail, /not checked/, 'the HXR database is not opened while an earlier condition fails');
  const { lines: l2, io: io2 } = capture();
  const run = await launch({ argv: ['--config', PLANNED_CONFIGS[0], '--run', '--confirm-run'], io: io2, overrides });
  assert.deepEqual([run.exitCode, run.ran, run.refusedBy], [1, false, 'launcher']);
  assert.ok(l2.some((l) => /Refused by the launcher/.test(l)));
  const db = store.openRtDb(store.rtDbFile(dir));
  assert.deepEqual([db.prepare('SELECT COUNT(*) n FROM rt_runs').get().n, db.prepare('SELECT COUNT(*) n FROM rt_lock').get().n], [0, 0], 'nothing recorded, the lock released');
  db.close();
});

test('on the real repository files (authorized since 2026-11-04; eight runs logged) the launcher against an empty data directory refuses because the logged runs are not in that database, and runs nothing', async () => {
  const dir = tempDir('rt-launch-real-');
  const { lines, io } = capture();
  const out = await launch({ argv: ['--config', PLANNED_CONFIGS[0]], io, overrides: { dataDir: dir, protocolPath: PROTOCOL_PATH, logPath: LOG_PATH } });
  assert.deepEqual([out.ran, out.exitCode], [false, 0]);
  assert.equal(out.conditions.find((c) => c.name.includes('practice-runs-authorized')).ok, true);
  assert.equal(out.conditions.find((c) => c.name.includes('every practice run it lists is in this database')).ok, false);
  assert.ok(lines.at(-1).includes('authorized but not runnable yet: nothing was run'));
  assert.match(out.conditions.find((c) => c.name.startsWith('HXR data')).detail, /not checked/);
});

test('with the authorization row and synthetic HXR data: a run appends its exact log row; a failed append prints the row and the gate refuses further runs; one config per call', { timeout: 300000 }, async () => {
  const dir = tempDir('rt-launch-run-');
  const { hxr, clock } = await hxrData(dir, marketWithTslaBreakout());
  const f = files(dir, { log: LOG_OWNER_ONLY });
  const overrides = { dataDir: dir, ...f };
  // Without the row: refused by the launcher before the gate, with every other condition holding (HXR data included).
  const { io: io0 } = capture();
  const refused = await launch({ argv: ['--config', cfgFile('trend', 'immediate', false), '--run', '--confirm-run'], io: io0, overrides, clock });
  assert.deepEqual([refused.ran, refused.refusedBy, refused.conditions.filter((c) => !c.ok && !c.name.startsWith('HXR data')).map((c) => c.name.slice(0, 40))], [false, 'launcher', ['EXPERIMENT-LOG.md: practice-runs-authori']]);
  assert.match(refused.conditions.find((c) => c.name.startsWith('HXR data')).detail, /not checked/, 'the HXR database is not opened while the authorization is missing');
  // With the row: the run, and its row appended to the log copy.
  fs.writeFileSync(f.logPath, LOG);
  const { lines, io } = capture();
  const out = await launch({ argv: ['--config', cfgFile('trend', 'immediate', false), '--run', '--confirm-run'], io, overrides, clock });
  assert.deepEqual([out.exitCode, out.ran, out.appended, out.refusedBy], [0, true, true, null]);
  assert.ok(out.logRow && lines.includes(out.logRow), 'the row is printed');
  const listed = logStatus(f.logPath).practiceRuns;
  assert.equal(listed.length, 1);
  assert.ok(fs.readFileSync(f.logPath, 'utf8').endsWith(`${out.logRow}\n`));
  // A failed append: the row is printed, the exit code is 1, and the next run is refused until it is pasted.
  const { lines: l2, io: io2 } = capture();
  const failed = await launch({ argv: ['--config', cfgFile('range', 'dip', false), '--run', '--confirm-run'], io: io2, overrides, clock, appendFile: () => { throw new Error('disk full (test)'); } });
  assert.deepEqual([failed.exitCode, failed.ran, failed.appended], [1, true, false]);
  assert.ok(l2.some((l) => /could not be appended.*disk full/.test(l)) && l2.includes(failed.logRow));
  const { io: io3 } = capture();
  const next = await launch({ argv: ['--config', cfgFile('range', 'dip', true), '--run', '--confirm-run'], io: io3, overrides, clock });
  assert.deepEqual([next.ran, next.refusedBy], [false, 'launcher']);
  assert.equal(next.conditions.find((c) => c.name.startsWith('database: every run')).ok, false);
  fs.appendFileSync(f.logPath, `${failed.logRow}\n`);
  const { io: io4 } = capture();
  const again = await launch({ argv: ['--config', cfgFile('range', 'dip', true)], io: io4, overrides, clock });
  assert.ok(again.conditions.every((c) => c.ok), 'every condition holds once the row is pasted (check mode)');
  assert.equal(again.ran, false);
  // The service's own refusal is reported as such (a config already run; the reserve is not available here).
  const { lines: l5, io: io5 } = capture();
  const dup = await launch({ argv: ['--config', cfgFile('trend', 'immediate', false), '--run', '--confirm-run'], io: io5, overrides, clock });
  assert.deepEqual([dup.ran, dup.refusedBy], [false, 'launcher']);
  assert.ok(l5.some((l) => /this config/.test(l) || /Refused/.test(l)));
  hxr.close();
});
