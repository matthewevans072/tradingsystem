// ICT Lab run report (strategy/ict-lab/PROTOCOL.md section 11). Run manually:
//
//   node scripts/ictlab-report.mjs [--round 1] [--window development|validation] [--out strategy/ict-lab/reports/round-1.md]
//
// Reads the recorded runs of the round and window from data/ict-lab-sim.sqlite (read-only) and writes the report
// of section 11, every figure labelled measured or derived. No bar, price or per-fill list is written; the words
// "profitable" and "edge" never appear (the script refuses to write a report that contains them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { openIlDb, listRuns, getDataVersion, maxStoredDate, countBarsAfterBound } from '../server/ictlab/store.js';
import { buildReport, forbiddenWords } from '../server/ictlab/report.js';
import { ROOT, DB_NAME, REPORT_DIR, RUNNABLE_WINDOWS } from '../server/ictlab/config.js';

export function parseArgs(argv) {
  const o = { round: 1, window: 'development', out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--round') o.round = Number(argv[++i]);
    else if (a === '--window') { o.window = argv[++i]; if (!RUNNABLE_WINDOWS.includes(o.window)) throw new Error(`--window must be ${RUNNABLE_WINDOWS.join(' or ')}`); }
    else if (a === '--out') o.out = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

export async function main({ argv = [], io = { log: console.log }, dbFile = null, now = () => new Date() } = {}) {
  const o = parseArgs(argv);
  const file = dbFile || path.join(loadConfig().dataDir, DB_NAME);
  const db = openIlDb(file, { readOnly: true });
  let text;
  try {
    const all = listRuns(db).filter((r) => r.round === o.round && r.window === o.window);
    const runs = all.filter((r) => r.status === 'done'), failedRuns = all.filter((r) => r.status !== 'done');
    const version = runs.length ? getDataVersion(db, runs[0].dataVersionId) : null;
    text = buildReport({ round: o.round, window: o.window, runs, failedRuns, version, bound: { maxStoredDate: maxStoredDate(db), after: countBarsAfterBound(db) }, generatedAt: now().toISOString() });
  } finally {
    db.close();
  }
  const bad = forbiddenWords(text);
  if (bad.length) throw new Error(`the report contains a forbidden word (${bad.join(', ')}); nothing written`);
  const out = o.out ? path.resolve(o.out) : path.join(REPORT_DIR, `round-${o.round}${o.window === 'development' ? '' : `-${o.window}`}.md`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${text}\n`);
  io.log(`report written to ${path.relative(ROOT, out)}`);
  return { out, text };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({ argv: process.argv.slice(2) }).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
}
