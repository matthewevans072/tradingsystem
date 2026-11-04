// ICT Lab launcher: one spec per invocation; check mode prints every condition with its rule and runs nothing;
// --count prints counts only; --run needs --confirm-run and an open gate; a run appends its exact entry; a failed
// append prints the entry and the gate refuses until it is pasted; mark-failed; the window argument. Synthetic
// data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseArgs, launch } from '../scripts/ictlab-run.mjs';
import { RUN_ENTRY, parseEntries } from '../server/ictlab/config.js';
import { serviceFixture } from './ictlab-service-fixture.js';

const V = 'ict-sweep-bos-fvg-0.1.0.json';
const io = () => { const lines = [], errors = []; return { log: (l) => lines.push(String(l)), error: (l) => errors.push(String(l)), lines, errors }; };

test('parseArgs: one spec, the modes, the windows, and refused combinations', () => {
  assert.deepEqual(parseArgs(['--spec', V]), { spec: V, mode: 'check', confirm: false, runId: null, reason: null, round: 1, window: 'development', repeatReason: null });
  assert.equal(parseArgs(['--spec', V, '--run', '--confirm-run']).mode, 'run');
  assert.equal(parseArgs(['--spec', V, '--run']).confirm, false);
  assert.equal(parseArgs(['--spec', V, '--count']).mode, 'count');
  assert.equal(parseArgs(['--spec', V, '--window', 'validation']).window, 'validation');
  assert.equal(parseArgs(['--spec', V, '--repeat-reason', 'why']).repeatReason, 'why');
  assert.deepEqual(parseArgs(['--mark-failed', '3', '--reason', 'killed']).mode, 'mark-failed');
  assert.throws(() => parseArgs(['--run']), /--spec/);
  assert.throws(() => parseArgs(['--mark-failed', '3']), /--reason/);
  assert.throws(() => parseArgs(['--spec', V, '--window', 'reserved']), /no code path/);
  assert.throws(() => parseArgs(['--spec', V, '--round', '2']), /--round must be 1/);
  assert.throws(() => parseArgs(['--spec', V, '--bogus']), /unknown argument/);
});

test('check mode prints every condition and runs nothing; count mode prints counts only; --run without --confirm-run and a closed gate are refused by the launcher', async () => {
  const f = serviceFixture();
  const o1 = io();
  const r1 = await launch({ argv: ['--spec', V], io: o1, service: f.service, logPath: f.logPath });
  assert.equal(r1.ran, false);
  assert.equal(r1.exitCode, 0);
  assert.equal(o1.lines.filter((l) => /^\[ok\] .* \(rule \d\)/.test(l)).length, 13);
  assert.ok(o1.lines.some((l) => l.startsWith('Gate: open')));
  assert.ok(o1.lines.some((l) => l.startsWith('Check mode: nothing was run')));
  assert.equal(f.service.listRuns().length, 0);
  const o2 = io();
  const r2 = await launch({ argv: ['--spec', V, '--count'], io: o2, service: f.service, logPath: f.logPath });
  assert.equal(r2.ran, false);
  assert.equal(r2.exitCode, 0);
  assert.ok(o2.lines.some((l) => /sessions \d+, tradeable \d+, sweeps \d+, confirmations \d+, usable zones \d+, orders placed \d+, fills \d+/.test(l)));
  assert.ok(o2.lines.every((l) => !/mean R|outcome|target|exit|win rate|drawdown/i.test(l)), 'no R or outcome figure');
  assert.equal(f.service.listRuns().length, 0);
  const o3 = io();
  const r3 = await launch({ argv: ['--spec', V, '--run'], io: o3, service: f.service, logPath: f.logPath });
  assert.equal(r3.refusedBy, 'launcher');
  assert.equal(r3.exitCode, 2);
  assert.equal(f.service.listRuns().length, 0);
  const closed = serviceFixture({ frozen: false });
  const o4 = io();
  const r4 = await launch({ argv: ['--spec', V, '--run', '--confirm-run'], io: o4, service: closed.service, logPath: closed.logPath });
  assert.equal(r4.refusedBy, 'launcher');
  assert.equal(r4.exitCode, 2);
  assert.ok(o4.lines.some((l) => l.startsWith('[--] code-frozen-entry (rule 3)')));
  assert.ok(o4.lines.some((l) => l.startsWith(`Gate: CLOSED for ${V} on the development window; nothing runs.`)));
  const o5 = io();
  const r5 = await launch({ argv: ['--spec', V, '--count'], io: o5, service: closed.service, logPath: closed.logPath });
  assert.equal(r5.refusedBy, 'launcher');
  assert.ok(o5.lines.some((l) => l.includes('nothing was counted')));
  assert.equal(closed.service.listRuns().length, 0);
  // The validation window from the launcher: refused (no row, no data under the bound), nothing runs.
  const o6 = io();
  const r6 = await launch({ argv: ['--spec', V, '--window', 'validation', '--run', '--confirm-run'], io: o6, service: f.service, logPath: f.logPath });
  assert.equal(r6.refusedBy, 'launcher');
  assert.ok(o6.lines.some((l) => l.startsWith('[--] validation-authorized (rule 7)')));
  assert.equal(f.service.listRuns().length, 0);
});

test('a confirmed run appends its exact entry; a failed append prints it and the next run is refused until it is pasted; mark-failed', async () => {
  const f = serviceFixture();
  const o1 = io();
  const r1 = await launch({ argv: ['--spec', V, '--run', '--confirm-run'], io: o1, service: f.service, logPath: f.logPath });
  assert.equal(r1.ran, true);
  assert.equal(r1.appended, true);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.run.status, 'done');
  const log = fs.readFileSync(f.logPath, 'utf8');
  assert.ok(log.endsWith(r1.entry));
  const entries = parseEntries(log);
  assert.equal(entries.length, 2);
  assert.match(entries[1].title, RUN_ENTRY);
  const o2 = io();
  const r2 = await launch({ argv: ['--spec', 'ict-ifvg-0.1.0.json', '--run', '--confirm-run'], io: o2, service: f.service, logPath: f.logPath, appendFile: () => { throw new Error('disk full (synthetic)'); } });
  assert.equal(r2.ran, true);
  assert.equal(r2.appended, false);
  assert.ok(o2.errors.some((l) => l.includes('could not be appended') && l.includes(r2.entry.trim())));
  const o3 = io();
  const r3 = await launch({ argv: ['--spec', 'ict-breaker-0.1.0.json', '--run', '--confirm-run'], io: o3, service: f.service, logPath: f.logPath });
  assert.equal(r3.refusedBy, 'launcher');
  assert.ok(o3.lines.some((l) => l.startsWith('[--] log-well-formed') && l.includes('has no log entry')));
  assert.equal(f.service.listRuns().length, 2);
  fs.appendFileSync(f.logPath, r2.entry);
  const r4 = await launch({ argv: ['--spec', 'ict-breaker-0.1.0.json', '--run', '--confirm-run'], io: io(), service: f.service, logPath: f.logPath });
  assert.equal(r4.ran, true);
  const r5 = await launch({ argv: ['--spec', V, '--run', '--confirm-run'], io: io(), service: f.service, logPath: f.logPath });
  assert.equal(r5.refusedBy, 'launcher', 'a spec that already ran is refused before the service');
  assert.equal(f.service.listRuns().length, 3);
  const o6 = io();
  const r6 = await launch({ argv: ['--spec', V, '--run', '--confirm-run', '--repeat-reason', 'verified defect (synthetic)'], io: o6, service: f.service, logPath: f.logPath });
  assert.equal(r6.ran, true);
  assert.equal(r6.run.repeat, true);
  assert.ok(o6.lines.some((l) => l.includes('REPEAT')));
  await assert.rejects(launch({ argv: ['--mark-failed', '1', '--reason', 'x'], io: io(), service: f.service, logPath: f.logPath }), /is done, not running/);
});
