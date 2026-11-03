// sweep-bos launcher: one variant per invocation; check mode prints every condition and runs nothing; --run
// needs --confirm-run and an open gate; a run appends its exact entry; a failed append prints the entry and the
// gate refuses until it is pasted; mark-failed and pick modes. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseArgs, launch } from '../scripts/sweepbos-run.mjs';
import { RUN_ENTRY, parseEntries } from '../server/sweepbos/config.js';
import { serviceFixture } from './sweepbos-service-fixture.js';

const V = 'sb-fvg-a-nobias-0.1.0.json';
const io = () => { const lines = [], errors = []; return { log: (l) => lines.push(String(l)), error: (l) => errors.push(String(l)), lines, errors }; };

test('parseArgs: one variant, the modes, and refused combinations', () => {
  assert.deepEqual(parseArgs(['--variant', V]), { variant: V, mode: 'check', confirm: false, runId: null, reason: null });
  assert.deepEqual(parseArgs(['--variant', V, '--run', '--confirm-run']).mode, 'run');
  assert.equal(parseArgs(['--variant', V, '--run']).confirm, false);
  assert.deepEqual(parseArgs(['--mark-failed', '3', '--reason', 'killed']), { variant: null, mode: 'mark-failed', confirm: false, runId: 3, reason: 'killed' });
  assert.equal(parseArgs(['--pick']).mode, 'pick');
  assert.throws(() => parseArgs(['--run']), /--variant/);
  assert.throws(() => parseArgs(['--mark-failed', '3']), /--reason/);
  assert.throws(() => parseArgs(['--variant', V, '--bogus']), /unknown argument/);
});

test('check mode prints every condition and runs nothing; --run without --confirm-run and a closed gate are refused by the launcher', async () => {
  const f = serviceFixture();
  const o1 = io();
  const r1 = await launch({ argv: ['--variant', V], io: o1, service: f.service, logPath: f.logPath });
  assert.equal(r1.ran, false);
  assert.equal(r1.exitCode, 0);
  assert.equal(o1.lines.filter((l) => /^\[ok\] /.test(l)).length, 12);
  assert.ok(o1.lines.some((l) => l.startsWith('Gate: open')));
  assert.ok(o1.lines.some((l) => l.startsWith('Check mode: nothing was run')));
  assert.equal(f.service.listRuns().length, 0);
  const o2 = io();
  const r2 = await launch({ argv: ['--variant', V, '--run'], io: o2, service: f.service, logPath: f.logPath });
  assert.equal(r2.refusedBy, 'launcher');
  assert.equal(r2.exitCode, 2);
  assert.equal(f.service.listRuns().length, 0);
  const closed = serviceFixture({ frozen: false });
  const o3 = io();
  const r3 = await launch({ argv: ['--variant', V, '--run', '--confirm-run'], io: o3, service: closed.service, logPath: closed.logPath });
  assert.equal(r3.refusedBy, 'launcher');
  assert.equal(r3.exitCode, 2);
  assert.ok(o3.lines.some((l) => l.startsWith('[--] code-frozen-entry')));
  assert.ok(o3.lines.some((l) => l === 'Gate: CLOSED; nothing runs.'));
  assert.equal(closed.service.listRuns().length, 0);
});

test('a confirmed run appends its exact entry; a failed append prints it and the next run is refused until it is pasted; mark-failed and pick', async () => {
  const f = serviceFixture();
  const o1 = io();
  const r1 = await launch({ argv: ['--variant', V, '--run', '--confirm-run'], io: o1, service: f.service, logPath: f.logPath });
  assert.equal(r1.ran, true);
  assert.equal(r1.appended, true);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.run.status, 'done');
  const log = fs.readFileSync(f.logPath, 'utf8');
  assert.ok(log.endsWith(r1.entry));
  const entries = parseEntries(log);
  assert.equal(entries.length, 2);
  assert.match(entries[1].title, RUN_ENTRY);
  // The second variant with an append that fails: the run is recorded, the entry printed, the gate closed.
  const o2 = io();
  const r2 = await launch({ argv: ['--variant', 'sb-fvg-b-nobias-0.1.0.json', '--run', '--confirm-run'], io: o2, service: f.service, logPath: f.logPath, appendFile: () => { throw new Error('disk full (synthetic)'); } });
  assert.equal(r2.ran, true);
  assert.equal(r2.appended, false);
  assert.equal(r2.exitCode, 0);
  assert.ok(o2.errors.some((l) => l.includes('could not be appended') && l.includes(r2.entry.trim())));
  const o3 = io();
  const r3 = await launch({ argv: ['--variant', 'sb-ob-a-bias-0.1.0.json', '--run', '--confirm-run'], io: o3, service: f.service, logPath: f.logPath });
  assert.equal(r3.refusedBy, 'launcher');
  assert.ok(o3.lines.some((l) => l.startsWith('[--] log-well-formed') && l.includes('has no log entry')));
  assert.equal(f.service.listRuns().length, 2);
  fs.appendFileSync(f.logPath, r2.entry);
  const r4 = await launch({ argv: ['--variant', 'sb-ob-a-bias-0.1.0.json', '--run', '--confirm-run'], io: io(), service: f.service, logPath: f.logPath });
  assert.equal(r4.ran, true);
  // A variant that already ran is refused by the launcher before the service.
  const r5 = await launch({ argv: ['--variant', V, '--run', '--confirm-run'], io: io(), service: f.service, logPath: f.logPath });
  assert.equal(r5.refusedBy, 'launcher');
  assert.equal(f.service.listRuns().length, 3);
  // Pick mode before the round is complete.
  const o6 = io();
  const r6 = await launch({ argv: ['--pick'], io: o6, service: f.service, logPath: f.logPath });
  assert.equal(r6.pick.recorded, 3);
  assert.equal(r6.pick.pick, null);
  assert.ok(o6.lines.some((l) => l.includes('pick (report only): NONE')));
  // Mark-failed on a run that is not running is refused.
  await assert.rejects(launch({ argv: ['--mark-failed', '1', '--reason', 'x'], io: io(), service: f.service, logPath: f.logPath }), /is done, not running/);
});
