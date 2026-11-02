// The gated range-trend practice-run launcher (PLAN-DRAFT.md section 8 step 5). Simulation only: no broker,
// no order, no network; market data is read only through the service's read-only HXR path; no secret is
// printed. One config per invocation.
//
//   node scripts/rangetrend-run.mjs --config <rt-*-0.2.0.json>              check mode (the default): print
//                                                                            every gate condition and exit
//   node scripts/rangetrend-run.mjs --config <file> --run --confirm-run     run that one config, if every
//                                                                            condition holds
//
// After a run the exact log row (returned by runPractice) is appended to strategy/range-trend/EXPERIMENT-LOG.md
// and printed; if the append fails the row is printed and the gate refuses further runs until it is pasted.
// The reserve is never exposed here (it needs a separate instruction). The practice-runs-authorized row is the
// owner's: this script never writes it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRangeTrend, RtError } from '../server/rangetrend/service.js';
import { PLANNED_CONFIGS, CODE_REVISION, LOG_PATH } from '../server/rangetrend/config.js';

export function parseArgs(argv) {
  const o = { config: [], check: false, run: false, confirmRun: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') o.config.push(argv[++i]);
    else if (a.startsWith('--config=')) o.config.push(a.slice('--config='.length));
    else if (a === '--check') o.check = true;
    else if (a === '--run') o.run = true;
    else if (a === '--confirm-run') o.confirmRun = true;
    else o.unknown.push(a);
  }
  return o;
}

// overrides (tests only): { dataDir, protocolPath, logPath, holdConfigFile }, passed with testOverrides: true.
export async function launch({ argv = [], io = { log: console.log, error: console.error }, overrides = null, clock = undefined, appendFile = (file, text) => fs.appendFileSync(file, text) } = {}) {
  const args = parseArgs(argv);
  const out = { mode: args.run ? 'run' : 'check', configFile: null, conditions: [], ran: false, appended: null, logRow: null, refusedBy: null, exitCode: 0 };
  if (args.unknown.length) { io.error(`Unknown argument(s): ${args.unknown.join(' ')}. Usage: --config <file> [--check | --run --confirm-run]. The reserve is not available here.`); out.exitCode = 2; return out; }
  if (args.config.length !== 1 || !args.config[0]) { io.error(`One config per invocation: --config <file> (one of ${PLANNED_CONFIGS.join(', ')}).`); out.exitCode = 2; return out; }
  const configFile = path.basename(String(args.config[0]));
  out.configFile = configFile;
  if (!PLANNED_CONFIGS.includes(configFile)) { io.error(`${configFile} is not one of the eight planned configs: ${PLANNED_CONFIGS.join(', ')}.`); out.exitCode = 2; return out; }
  if (args.run && !args.confirmRun) { io.error('Running needs both --run and --confirm-run. Nothing was run.'); out.exitCode = 2; return out; }
  const rt = createRangeTrend({ ...(overrides || {}), ...(clock ? { clock } : {}), testOverrides: !!overrides });
  const logPath = overrides?.logPath ?? LOG_PATH;
  try {
    io.log(`Range-trend practice run, ${out.mode} mode: ${configFile} (code revision ${CODE_REVISION}). Simulation only; nothing is sent anywhere.`);
    const conds = rt.gateStatus({ configFile });
    let allOk = conds.every((c) => c.ok);
    const hxr = allOk ? rt.hxrStatus({ configFile }) : { name: 'HXR data: readiness and spread calibration for the development period (read-only)', ok: false, detail: 'not checked: an earlier condition fails (the HXR database was not opened)' };
    conds.push(hxr);
    allOk = allOk && hxr.ok;
    out.conditions = conds;
    for (const c of conds) io.log(`  [${c.ok ? 'ok' : '--'}] ${c.name}: ${c.detail}`);
    const authorized = conds.find((c) => c.name.includes('practice-runs-authorized'))?.ok === true;
    if (!args.run) {
      io.log(allOk ? 'Every condition holds. Nothing was run (check mode): add --run --confirm-run to run this one config.' : `Practice runs are ${authorized ? 'authorized but not runnable yet' : 'NOT authorized'}: nothing was run.`);
      return out;
    }
    if (!allOk) {
      out.refusedBy = 'launcher';
      io.error(`Refused by the launcher: ${conds.filter((c) => !c.ok).map((c) => c.name).join('; ')}. Nothing was run.`);
      out.exitCode = 1;
      return out;
    }
    const r = await rt.runPractice({ configFile, confirm: true });
    out.ran = true;
    out.logRow = r.logRow;
    io.log(`Run ${r.id} done (${r.version}); ${r.errors.length ? `with errors: ${r.errors.join('; ')}` : 'no errors'}.`);
    try {
      appendFile(logPath, `${r.logRow}\n`);
      out.appended = true;
      io.log(`Appended to ${path.basename(logPath)}:`);
      io.log(r.logRow);
    } catch (e) {
      out.appended = false;
      out.exitCode = 1;
      io.error(`The log row could not be appended to ${logPath} (${e.message}). Paste it yourself; the gate refuses further runs until it is there:`);
      io.log(r.logRow);
    }
    return out;
  } catch (e) {
    if (e instanceof RtError) {
      out.refusedBy = 'service';
      out.exitCode = 1;
      io.error(`Refused by the gate (${e.status}): ${e.message}`);
      if (e.logRow) { out.logRow = e.logRow; io.log('Log row to paste:'); io.log(e.logRow); }
      return out;
    }
    throw e;
  } finally {
    rt.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch({ argv: process.argv.slice(2) }).then((o) => process.exit(o.exitCode), (e) => { console.error(e.message); process.exit(1); });
}
