// ICT Lab gated launcher (strategy/ict-lab/PROTOCOL.md section 10). Run manually, one spec per invocation:
//
//   node scripts/ictlab-run.mjs --spec ict-sweep-bos-fvg-0.1.0.json                 (check mode: every gate condition printed, nothing runs)
//   node scripts/ictlab-run.mjs --spec <file> --count                                  (counts only: sessions, sweeps, confirmations, zones, orders, fills)
//   node scripts/ictlab-run.mjs --spec <file> --run --confirm-run [--repeat-reason "<why>"]
//   node scripts/ictlab-run.mjs --spec <file> --window validation --run --confirm-run   (refused until the owner's **Validation authorized** row exists)
//   node scripts/ictlab-run.mjs --mark-failed <run id> --reason "<why>"               (a run left "running" by a crash)
//
// A run starts only when every condition of service.js gateStatus holds. After a run the exact log entry is
// appended to strategy/ict-lab/EXPERIMENT-LOG.md and printed; if the append fails the entry is printed to paste,
// and the gate refuses further runs until it is in the log. No network, no order, no account.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIctLab, GateError } from '../server/ictlab/service.js';
import { LOG_PATH, RUNNABLE_WINDOWS } from '../server/ictlab/config.js';

export function parseArgs(argv) {
  const o = { spec: null, mode: 'check', confirm: false, runId: null, reason: null, round: 1, window: 'development', repeatReason: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--spec') o.spec = argv[++i];
    else if (a === '--round') { o.round = Number(argv[++i]); if (o.round !== 1) throw new Error('--round must be 1 (the only pre-registered round)'); }
    else if (a === '--window') { o.window = argv[++i]; if (!RUNNABLE_WINDOWS.includes(o.window)) throw new Error(`--window must be ${RUNNABLE_WINDOWS.join(' or ')} (the reserved window has no code path)`); }
    else if (a === '--check') o.mode = 'check';
    else if (a === '--count') o.mode = 'count';
    else if (a === '--run') o.mode = 'run';
    else if (a === '--confirm-run') o.confirm = true;
    else if (a === '--repeat-reason') o.repeatReason = argv[++i];
    else if (a === '--mark-failed') { o.mode = 'mark-failed'; o.runId = Number(argv[++i]); }
    else if (a === '--reason') o.reason = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if ((o.mode === 'check' || o.mode === 'run' || o.mode === 'count') && !o.spec) throw new Error('--spec <file> is required (one spec per invocation)');
  if (o.mode === 'mark-failed' && (!Number.isInteger(o.runId) || !o.reason)) throw new Error('--mark-failed <run id> needs --reason "<why>"');
  return o;
}

const line = (c) => `[${c.ok ? 'ok' : '--'}] ${c.name} (rule ${c.rule}): ${c.detail}`;

export async function launch({ argv = [], io = { log: console.log, error: console.error }, service = null, logPath = LOG_PATH, appendFile = (file, text) => fs.appendFileSync(file, text) } = {}) {
  const o = parseArgs(argv);
  const svc = service || createIctLab();
  const out = { mode: o.mode, spec: o.spec, window: o.window, round: o.round, conditions: [], ran: false, appended: false, entry: null, run: null, refusedBy: null, exitCode: 0 };
  if (o.mode === 'mark-failed') {
    const r = svc.markFailed(o.runId, o.reason);
    out.entry = r.entry; out.run = r.run;
    try { appendFile(logPath, r.entry); out.appended = true; io.log(`run ${o.runId} marked failed; log entry appended to ${path.relative(process.cwd(), logPath)}`); } catch (e) { io.error(`run ${o.runId} marked failed, but the log entry could not be appended (${e.message}); paste this entry into EXPERIMENT-LOG.md:\n${r.entry}`); out.exitCode = 3; }
    return out;
  }
  const gate = svc.gateStatus({ specFile: o.spec, window: o.window, round: o.round, repeatReason: o.repeatReason });
  out.conditions = gate.conditions;
  for (const c of gate.conditions) io.log(line(c));
  io.log(gate.ok ? `Gate: open (every condition holds) for ${o.spec} on the ${o.window} window.` : `Gate: CLOSED for ${o.spec} on the ${o.window} window; nothing runs.`);
  if (o.mode === 'check') { io.log('Check mode: nothing was run. Use --run --confirm-run to run this spec once.'); return out; }
  if (o.mode === 'count') {
    if (!gate.ok) { io.log('Refused by the launcher: the gate is closed; nothing was counted.'); out.refusedBy = 'launcher'; out.exitCode = 2; return out; }
    let c;
    try { c = svc.countOnly({ specFile: o.spec, window: o.window, round: o.round }); } catch (e) { if (e instanceof GateError) { io.log(`Refused by the service: ${e.message}`); out.refusedBy = 'service'; out.exitCode = 2; return out; } throw e; }
    out.counts = c;
    io.log(`count-only pass, round ${c.round}, ${c.spec} (hash ${c.specHash}), ${c.window} window ${c.windowDates.start} to ${c.windowDates.end}, data version ${c.dataVersionId} (hash ${c.dataHash}):`);
    io.log(`  sessions ${c.counts.sessions}, tradeable ${c.counts.tradeable}, sweeps ${c.counts.sweeps}, confirmations ${c.counts.confirmations}, usable zones ${c.counts.zones}, orders placed ${c.counts.orders}, fills ${c.counts.fills}`);
    io.log('Nothing was recorded; this output holds counts only, nothing about returns.');
    return out;
  }
  if (!o.confirm) { io.log('--run without --confirm-run: refused by the launcher; nothing was run.'); out.refusedBy = 'launcher'; out.exitCode = 2; return out; }
  if (!gate.ok) { io.log('Refused by the launcher: the gate is closed; nothing was run.'); out.refusedBy = 'launcher'; out.exitCode = 2; return out; }
  let r;
  try {
    r = svc.run({ specFile: o.spec, window: o.window, round: o.round, confirm: true, repeatReason: o.repeatReason });
  } catch (e) {
    if (e instanceof GateError) { io.log(`Refused by the service: ${e.message}`); out.refusedBy = 'service'; out.exitCode = 2; return out; }
    throw e;
  }
  out.ran = true; out.run = r.run; out.entry = r.entry;
  io.log(`run ${r.run.id}: ${r.run.status}${r.run.status === 'done' ? `; ${r.run.window === 'development' ? `candidate ${r.run.metrics.candidate ? 'YES' : 'no'}` : `validation ${r.run.contaminated ? 'contaminated' : r.run.metrics.candidate ? 'NOT REJECTED' : 'REJECTED'}`}; ${r.run.metrics.trades} trades, mean R ${r.run.metrics.meanR == null ? 'n/a' : r.run.metrics.meanR.toFixed(4)}` : `: ${r.run.error}`}`);
  try {
    appendFile(logPath, r.entry);
    out.appended = true;
    io.log(`log entry appended to ${path.relative(process.cwd(), logPath)}:${r.entry}`);
  } catch (e) {
    io.error(`the run is recorded, but its log entry could not be appended (${e.message}). Paste this entry into EXPERIMENT-LOG.md; the gate refuses further runs until it is there:${r.entry}`);
  }
  out.exitCode = r.run.status === 'done' ? 0 : 3;
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch({ argv: process.argv.slice(2) }).then((o) => process.exit(o.exitCode), (e) => { console.error(e.message); process.exit(1); });
}
