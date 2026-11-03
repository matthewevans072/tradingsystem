// sweep-bos gated launcher (strategy/sweep-bos/PLAN.md section 5). Run manually, one variant per invocation:
//
//   node scripts/sweepbos-run.mjs --variant sb-ob-a-bias-0.1.0.json            (check mode: every gate condition printed, nothing runs)
//   node scripts/sweepbos-run.mjs --variant sb-ob-a-bias-0.1.0.json --run --confirm-run
//   node scripts/sweepbos-run.mjs --mark-failed <run id> --reason "<why>"       (a run left "running" by a crash)
//   node scripts/sweepbos-run.mjs --pick                                          (the report-only pick among recorded runs)
//
// A run starts only when every condition of service.js gateStatus holds (the pinned rule sheet and its commit,
// committed code, the complete bounded data version, the code-frozen log entry, every recorded run logged, the
// pre-registered variant not yet run, the lock). After a run the exact log entry is appended to
// strategy/sweep-bos/EXPERIMENT-LOG.md and printed; if the append fails the entry is printed to paste, and the
// gate refuses further runs until it is in the log. No network, no order, no account.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSweepBos, GateError } from '../server/sweepbos/service.js';
import { LOG_PATH } from '../server/sweepbos/config.js';

export function parseArgs(argv) {
  const o = { variant: null, mode: 'check', confirm: false, runId: null, reason: null, round: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--variant') o.variant = argv[++i];
    else if (a === '--round') { o.round = Number(argv[++i]); if (![1, 2].includes(o.round)) throw new Error('--round must be 1 or 2'); }
    else if (a === '--check') o.mode = 'check';
    else if (a === '--count') o.mode = 'count';
    else if (a === '--run') o.mode = 'run';
    else if (a === '--confirm-run') o.confirm = true;
    else if (a === '--mark-failed') { o.mode = 'mark-failed'; o.runId = Number(argv[++i]); }
    else if (a === '--reason') o.reason = argv[++i];
    else if (a === '--pick') o.mode = 'pick';
    else throw new Error(`unknown argument ${a}`);
  }
  if ((o.mode === 'check' || o.mode === 'run' || o.mode === 'count') && !o.variant) throw new Error('--variant <file> is required (one variant per invocation)');
  if (o.mode === 'mark-failed' && (!Number.isInteger(o.runId) || !o.reason)) throw new Error('--mark-failed <run id> needs --reason "<why>"');
  return o;
}

const line = (c) => `[${c.ok ? 'ok' : '--'}] ${c.name}: ${c.detail}`;

export async function launch({ argv = [], io = { log: console.log, error: console.error }, service = null, logPath = LOG_PATH, appendFile = (file, text) => fs.appendFileSync(file, text) } = {}) {
  const o = parseArgs(argv);
  const svc = service || createSweepBos();
  const out = { mode: o.mode, variant: o.variant, conditions: [], ran: false, appended: false, entry: null, run: null, refusedBy: null, exitCode: 0 };
  if (o.mode === 'pick') {
    const p = svc.pickReport({ round: o.round });
    io.log(`round ${p.round}: ${p.recorded} of ${p.expected} runs recorded; candidates: ${p.candidates.length ? p.candidates.join(', ') : 'none'}`);
    for (const r of p.ranking) io.log(`  ${r.candidate ? 'candidate ' : '          '} ${r.name}: pooled mean R ${r.meanR == null ? 'n/a' : r.meanR.toFixed(4)}, pooled max drawdown ${r.maxDrawdownR == null ? 'n/a' : r.maxDrawdownR.toFixed(2)} R`);
    io.log(`pick (report only): ${p.pick ?? 'NONE'}; ${p.reason}`);
    out.pick = p;
    return out;
  }
  if (o.mode === 'mark-failed') {
    const r = svc.markFailed(o.runId, o.reason);
    out.entry = r.entry; out.run = r.run;
    try { appendFile(logPath, r.entry); out.appended = true; io.log(`run ${o.runId} marked failed; log entry appended to ${path.relative(process.cwd(), logPath)}`); } catch (e) { io.error(`run ${o.runId} marked failed, but the log entry could not be appended (${e.message}); paste this entry into EXPERIMENT-LOG.md:\n${r.entry}`); out.exitCode = 3; }
    return out;
  }
  const gate = svc.gateStatus({ variantFile: o.variant, round: o.round });
  out.conditions = gate.conditions;
  out.round = o.round;
  for (const c of gate.conditions) io.log(line(c));
  io.log(gate.ok ? `Gate: open (every condition holds) for round ${o.round}.` : `Gate: CLOSED for round ${o.round}; nothing runs.`);
  if (o.mode === 'check') { io.log('Check mode: nothing was run. Use --run --confirm-run to run this variant once.'); return out; }
  if (o.mode === 'count') {
    // The count-only pass: counts only, nothing recorded, no outcome or R figure printed.
    if (!gate.ok) { io.log('Refused by the launcher: the gate is closed; nothing was counted.'); out.refusedBy = 'launcher'; out.exitCode = 2; return out; }
    let c;
    try { c = svc.countOnly({ variantFile: o.variant, round: o.round }); } catch (e) { if (e instanceof GateError) { io.log(`Refused by the service: ${e.message}`); out.refusedBy = 'service'; out.exitCode = 2; return out; } throw e; }
    out.counts = c;
    io.log(`count-only pass, round ${c.round}, ${c.variant} (hash ${c.variantHash}), data version ${c.dataVersionId} (hash ${c.dataHash}), ${c.window.start} to ${c.window.end}:`);
    for (const [sym, x] of Object.entries(c.counts)) io.log(`  ${sym}: sessions ${x.sessions}, sweeps ${x.sweeps}, confirmed breaks ${x.breaks}, orders placed ${x.orders}, fills ${x.fills}`);
    io.log('Nothing was recorded; no return or R figure exists in this output.');
    return out;
  }
  if (!o.confirm) { io.log('--run without --confirm-run: refused by the launcher; nothing was run.'); out.refusedBy = 'launcher'; out.exitCode = 2; return out; }
  if (!gate.ok) { io.log('Refused by the launcher: the gate is closed; nothing was run.'); out.refusedBy = 'launcher'; out.exitCode = 2; return out; }
  let r;
  try {
    r = svc.run({ variantFile: o.variant, round: o.round, confirm: true });
  } catch (e) {
    if (e instanceof GateError) { io.log(`Refused by the service: ${e.message}`); out.refusedBy = 'service'; out.exitCode = 2; return out; }
    throw e;
  }
  out.ran = true; out.run = r.run; out.entry = r.entry;
  io.log(`run ${r.run.id}: ${r.run.status}${r.run.status === 'done' ? `; candidate ${r.run.metrics.candidate ? 'YES' : 'no'}; pooled mean R ${r.run.metrics.pooled.meanR == null ? 'n/a' : r.run.metrics.pooled.meanR.toFixed(4)} over ${r.run.metrics.pooled.trades} trades` : `: ${r.run.error}`}`);
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
