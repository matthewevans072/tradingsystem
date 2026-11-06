#!/usr/bin/env node
// Prospective journal 1, the command line the owner runs by hand (strategy/research-runner/PROSPECTIVE-1.md).
// No scheduler, no notification, no order: every command runs once and exits.
//
//   npm run pj:record -- --source <40-hex commit>   write the activation record (refused once it is committed)
//   npm run pj:check                                 the activation checks, nothing written
//   npm run pj:activate -- --confirm                 activate: copy the warm-up closes, freeze the calibration
//   npm run pj:update                                the manual update after the close
//   npm run pj:status                                operational status (no P/L, value, return or drawdown)
//   npm run pj:verify                                replay every stored session and compare the stored states
//   npm run pj:resume -- --reason "<text>"           resume after a pause, with the reason recorded
//   npm run pj:review                                the review, refused before 2027-11-05 has been processed
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createJournal, buildActivationRecord, ACTIVATION_FILE, ROOT, JournalError } from '../server/research/journal.js';

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const o = { cmd: cmd || 'status', source: null, confirm: false, reason: null, json: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--source') o.source = rest[++i];
    else if (a === '--confirm') o.confirm = true;
    else if (a === '--reason') o.reason = rest[++i];
    else if (a === '--json') o.json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

export async function main(argv = process.argv.slice(2), { journal = null, log = console.log, root = ROOT, git = null, now = () => new Date() } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { log(`error: ${e.message}`); return { exitCode: 1 }; }
  const runGit = git ?? ((args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  if (o.cmd === 'record') {
    let committed = '';
    try { committed = runGit(['log', '-1', '--format=%H', '--', ACTIVATION_FILE]); } catch { /* none */ }
    if (committed) { log(`error: ${ACTIVATION_FILE} is already committed (${committed.slice(0, 12)}); an activation record is never rewritten`); return { exitCode: 1 }; }
    const rec = buildActivationRecord({ root, sourceCommit: o.source, now: now() });
    const file = path.join(root, ACTIVATION_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
    log(`written ${ACTIVATION_FILE}: source commit ${rec.sourceCommit}, expected start ${rec.period.expectedStart} (if committed on ${rec.preparedAt.slice(0, 10)} UTC, the same New York date), warm-up from ${rec.period.warmupFrom}, ${rec.files.length} files pinned; commit it to activate`);
    return { exitCode: 0, record: rec };
  }
  const j = journal ?? createJournal();
  const print = (x) => log(JSON.stringify(x, null, 2));
  try {
    if (o.cmd === 'check') { const s = j.activationStatus(); print({ ok: s.ok, problems: s.problems, activationCommit: s.activationCommit, committedAt: s.committedAt, start: s.start, warmupFrom: s.warmupFrom }); return { exitCode: s.ok ? 0 : 1 }; }
    if (o.cmd === 'activate') { print(j.activate({ confirm: o.confirm })); return { exitCode: 0 }; }
    if (o.cmd === 'update') { const r = await j.update(); print(r); return { exitCode: ['recorded', 'waiting', 'nothing to process'].includes(r.status) ? 0 : 1, report: r }; }
    if (o.cmd === 'status') { print(j.status()); return { exitCode: 0 }; }
    if (o.cmd === 'verify') { const v = j.verifyReplay(); print(v); return { exitCode: v.ok ? 0 : 1 }; }
    if (o.cmd === 'resume') { print(j.resume({ reason: o.reason })); return { exitCode: 0 }; }
    if (o.cmd === 'review') {
      const r = await j.review();
      const out = path.join(root, 'strategy', 'research-runner', 'reports', 'prospective-1-review.json');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`);
      log(`review written to ${path.relative(root, out)}: ${r.label}`);
      return { exitCode: 0 };
    }
    log(`error: unknown command ${o.cmd}`);
    return { exitCode: 1 };
  } catch (e) {
    log(`error: ${e instanceof JournalError ? e.message : e.stack || e.message}`);
    return { exitCode: 1 };
  } finally { if (!journal) j.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((r) => process.exit(r.exitCode));
