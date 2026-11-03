// sweep-bos round report (strategy/sweep-bos/PLAN.md section 7). Run manually:
//
//   node scripts/sweepbos-report.mjs [--round 1] [--out strategy/sweep-bos/reports/round-1.md]
//
// Reads the recorded runs of the round from data/sweep-bos-sim.sqlite (read-only) and writes the figures of
// PRE-REGISTRATION.md 6.5, the stage counts of section 7, the candidate table (C1-C6 per instrument) and the
// report-only pick. Every figure is labelled measured (read from a stored run) or derived (computed from
// measured figures). No bar, price or per-fill list is written. The diagnosis and the round-2 proposal
// (Part E) are appended by hand below the generated sections.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { openSbDb, listRuns, getDataVersion, maxStoredDate, countBarsAfterBound } from '../server/sweepbos/store.js';
import { pickRule, MIN_TRADES, MAX_MONTH_SHARE, P_MAX, TIE_R } from '../server/sweepbos/metrics.js';
import { ROOT, DB_NAME, REPORT_DIR, INSTRUMENTS, STAND_IN_FOR, WINDOWS, MAX_BAR_DATE, roundVariants, PREREG } from '../server/sweepbos/config.js';
import { STAGES } from '../server/sweepbos/engine.js';

const f4 = (x) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(4));
const f2 = (x) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(2));
const f3 = (x) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(3));
const pct = (x) => (x == null || Number.isNaN(x) ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const yn = (b) => (b ? 'yes' : 'no');

export function parseArgs(argv) {
  const o = { round: 1, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--round') o.round = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const label = (v) => `${v.zone === 'order_block' ? 'OB' : 'FVG'} / stop ${v.stop === 'A_sweep_buffer' ? 'A' : 'B'} / bias ${v.bias}`;

// runs: the round's done runs (store.listRuns shape); version: the data version; bound: { maxStoredDate, after }.
export function buildReport({ round, runs, failedRuns = [], version, bound, generatedAt }) {
  const L = [];
  const syms = INSTRUMENTS;
  L.push(`# sweep-bos round ${round}: development runs on ${syms.join(' and ')} (stand-ins for ${syms.map((s) => STAND_IN_FOR[s]).join(' and ')})`, '');
  L.push(`Generated ${generatedAt} from the recorded runs of \`data/sweep-bos-sim.sqlite\` by \`scripts/sweepbos-report.mjs\`. **Measured** = read from a stored run; **derived** = computed from measured figures. Rules: PRE-REGISTRATION.md version 1 (pre-registration commit ${PREREG.commit.slice(0, 12)}); criteria and pick rule: its section 5. Window: DEVELOPMENT ${WINDOWS.development.start} to ${WINDOWS.development.end} (warm-up from ${WINDOWS.warmupFrom}); bar bound ${MAX_BAR_DATE}; latest stored date ${bound.maxStoredDate ?? 'none'}; bars after the bound: ${bound.after.bars5m} five-minute, ${bound.after.bars1d} daily. Data version ${version?.id ?? 'n/a'} (${version?.label ?? ''}), hash ${version?.dataHash ?? 'n/a'}, ${version?.feed ?? ''} ${version?.adjustment ?? ''}.`, '');
  L.push('These are in-sample development results on data the owner has watched, after at most one round of eight pre-registered variants. Profit found by repeated retesting on the same data is not evidence; nothing here is evidence about ES or NQ or about the discretionary original (the prior regular session\'s high and low stand in for the session levels the original uses). No bar, price or per-fill list appears in this file.', '');

  L.push(`## 1. Runs recorded (measured)`, '');
  L.push('| Run | Variant | Rules | Status | Code revision | Engine | HEAD | Source hash | Started | Finished |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of [...runs, ...failedRuns].sort((a, b) => a.id - b.id)) L.push(`| ${r.id} | ${r.variant} | ${r.details?.variant ? label(r.details.variant) : ''} | ${r.status}${r.error ? ` (${r.error})` : ''} | ${r.codeRevision} | ${r.engineVersion} | ${(r.headCommit || '').slice(0, 12)} | ${(r.sourceHash || '').slice(0, 12)} | ${r.createdAt} | ${r.finishedAt} |`);
  const missing = roundVariants(round).filter((v) => !runs.some((r) => r.variant === v));
  L.push('', `${runs.length} of ${roundVariants(round).length} pre-registered variants have a completed run${missing.length ? `; not yet run: ${missing.join(', ')}` : ''}.`, '');

  L.push('## 2. Figures per variant and instrument (PRE-REGISTRATION.md 6.5)', '');
  for (const r of runs) {
    const m = r.metrics.perInstrument;
    L.push(`### ${r.variant} (${label(r.details.variant)}), run ${r.id}`, '');
    L.push(`| Figure | ${syms.join(' | ')} | Label |`, `|---|${syms.map(() => '---').join('|')}|---|`);
    const row = (name, fn, lab = 'measured') => L.push(`| ${name} | ${syms.map((s) => fn(m[s])).join(' | ')} | ${lab} |`);
    row('sessions in the window', (x) => x.sessionsInWindow);
    row('completed trades', (x) => x.trades);
    row('win rate', (x) => pct(x.winRate), 'derived');
    row('mean R after costs', (x) => f4(x.meanR), 'derived');
    row('median R', (x) => f4(x.medianR), 'derived');
    row('profit factor', (x) => f3(x.profitFactor), 'derived');
    row('maximum drawdown (R, exit order)', (x) => f2(x.maxDrawdownR), 'derived');
    row('average holding time (minutes)', (x) => f2(x.avgHoldingMinutes), 'derived');
    row('exposure by hour (share of held bars)', (x) => Object.entries(x.exposureByHour.byHour).map(([h, v]) => `${h}h ${pct(v.share)}`).join(', ') || 'n/a', 'derived');
    row('cost per trade: $ per share round trip', (x) => f2(x.costPerTrade.dollarsPerShareRoundTrip));
    row('cost per trade: mean in R', (x) => f4(x.costPerTrade.meanR), 'derived');
    row('mean R at 2x costs', (x) => f4(x.meanR2x), 'derived');
    row('bootstrap 95% interval of the mean R (10,000, seed 20261103)', (x) => `[${f4(x.bootstrap.lower)}, ${f4(x.bootstrap.upper)}]`, 'derived');
    row('null: mean of the 1,000 random-direction means', (x) => f4(x.nullTest.nullMean), 'derived');
    row('null: 5th / 50th / 95th / 99th percentile', (x) => (x.nullTest.percentiles ? `${f4(x.nullTest.percentiles.p5)} / ${f4(x.nullTest.percentiles.p50)} / ${f4(x.nullTest.percentiles.p95)} / ${f4(x.nullTest.percentiles.p99)}` : 'n/a'), 'derived');
    row('null: one-sided p (seed 20261104)', (x) => f4(x.nullTest.p), 'derived');
    row('mean R without the best 5% (K)', (x) => `${f4(x.bestRemoved.mean)} (K = ${x.bestRemoved.K})`, 'derived');
    row('largest monthly share of gross gains (month)', (x) => `${f3(x.monthShares.maxShare)} (${x.monthShares.maxMonth ?? 'n/a'})`, 'derived');
    row('gross gain / gross loss (R)', (x) => `${f2(x.grossGainR)} / ${f2(x.grossLossR)}`, 'derived');
    row('long trades: n, mean R', (x) => `${x.byDirection.long.n}, ${f4(x.byDirection.long.mean)}`, 'derived');
    row('short trades: n, mean R', (x) => `${x.byDirection.short.n}, ${f4(x.byDirection.short.mean)}`, 'derived');
    row('outcomes: stop (of which same bar) / target / time', (x) => `${x.outcomeCounts.stop} (${x.outcomeCounts.stop_same_bar}) / ${x.outcomeCounts.target} / ${x.outcomeCounts.time}`);
    row('dollar account, information only: ending cash, max drawdown ($)', (x) => `${f2(x.account.endingCash)}, ${f2(x.account.maxDrawdown)}`);
    L.push('', `Pooled (both instruments, exit order): ${r.metrics.pooled.trades} trades, mean R ${f4(r.metrics.pooled.meanR)}, maximum drawdown ${f2(r.metrics.pooled.maxDrawdownR)} R (derived).`, '');
  }

  L.push('## 3. Candidate table (PRE-REGISTRATION.md section 5; derived from measured figures)', '');
  L.push(`C1 at least ${MIN_TRADES} trades; C2 mean R > 0 and bootstrap lower bound > 0; C3 mean R at 2x costs > 0; C4 null p < ${P_MAX}; C5 mean R > 0 without the best 5%; C6 largest monthly share <= ${MAX_MONTH_SHARE}. A candidate passes all six on every instrument.`, '');
  L.push(`| Variant | ${syms.map((s) => `${s} C1 C2 C3 C4 C5 C6`).join(' | ')} | ${syms.map((s) => `${s} passes`).join(' | ')} | Candidate |`, `|---|${syms.map(() => '---').join('|')}|${syms.map(() => '---').join('|')}|---|`);
  for (const r of runs) {
    const m = r.metrics.perInstrument;
    const cells = syms.map((s) => ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((k) => (m[s].criteria[k].pass ? 'pass' : 'FAIL')).join(' '));
    L.push(`| ${r.variant} | ${cells.join(' | ')} | ${syms.map((s) => yn(m[s].criteria.pass)).join(' | ')} | **${r.metrics.candidate ? 'YES' : 'no'}** |`);
  }
  L.push('');

  L.push('## 4. Outcome and the pick rule (report only)', '');
  const variants = runs.map((r) => ({ name: r.variant, candidate: !!r.metrics.candidate, pooled: r.metrics.pooled }));
  const pick = pickRule(variants);
  const complete = runs.length === roundVariants(round).length;
  L.push(`Candidates: ${variants.filter((v) => v.candidate).map((v) => v.name).join(', ') || 'none'}.`);
  L.push(complete ? `Pick rule (pooled mean R, ties within ${TIE_R} R to the smaller pooled drawdown): **${pick.pick ?? 'NONE advances'}**. ${pick.reason}.` : `The round is not complete (${runs.length} of ${roundVariants(round).length} runs): no pick is reported.`);
  L.push('', '| Rank | Variant | Candidate | Pooled mean R | Pooled max drawdown (R) |', '|---|---|---|---|---|');
  pick.ranking.forEach((v, i) => L.push(`| ${i + 1} | ${v.name} | ${yn(v.candidate)} | ${f4(v.meanR)} | ${f2(v.maxDrawdownR)} |`));
  L.push('', 'The best ending value of the dollar account is never the pick. A pick here is a candidate for the owner\'s review and for the one-time evaluation run (Part F, separately authorized), nothing more.', '');

  L.push('## 5. Stages: where each session ended (PRE-REGISTRATION.md section 7; measured counts, derived shares)', '');
  L.push(`| Stage | ${runs.flatMap((r) => syms.map((s) => `${r.variant.replace('-0.1.0.json', '')} ${s}`)).join(' | ')} |`, `|---|${runs.flatMap(() => syms.map(() => '---')).join('|')}|`);
  for (const st of STAGES) L.push(`| ${st} | ${runs.flatMap((r) => syms.map((s) => { const x = r.metrics.perInstrument[s]; const n = x.stageCounts[st] || 0; return `${n} (${pct(n / x.sessionsInWindow)})`; })).join(' | ')} |`);
  L.push(`| filled, then: stop / target / time | ${runs.flatMap((r) => syms.map((s) => { const o = r.metrics.perInstrument[s].outcomeCounts; return `${o.stop} / ${o.target} / ${o.time}`; })).join(' | ')} |`);
  L.push('');

  L.push('## 6. Dollar account (information only; US$15,000 per variant and instrument, cash-limited whole shares, no leverage)', '');
  L.push(`| Variant | ${syms.map((s) => `${s} ending cash`).join(' | ')} | ${syms.map((s) => `${s} max drawdown $`).join(' | ')} |`, `|---|${syms.map(() => '---').join('|')}|${syms.map(() => '---').join('|')}|`);
  for (const r of runs) L.push(`| ${r.variant} | ${syms.map((s) => f2(r.metrics.perInstrument[s].account.endingCash)).join(' | ')} | ${syms.map((s) => f2(r.metrics.perInstrument[s].account.maxDrawdown)).join(' | ')} |`);
  L.push('', 'Never the pick; sizing is irrelevant to R.', '');
  return L.join('\n');
}

export async function main({ argv = [], io = { log: console.log } } = {}) {
  const o = parseArgs(argv);
  const file = path.join(loadConfig().dataDir, DB_NAME);
  const db = openSbDb(file, { readOnly: true });
  let text;
  try {
    const all = listRuns(db).filter((r) => r.round === o.round);
    const runs = all.filter((r) => r.status === 'done'), failedRuns = all.filter((r) => r.status !== 'done');
    const version = runs.length ? getDataVersion(db, runs[0].dataVersionId) : null;
    text = buildReport({ round: o.round, runs, failedRuns, version, bound: { maxStoredDate: maxStoredDate(db), after: countBarsAfterBound(db) }, generatedAt: new Date().toISOString() });
  } finally {
    db.close();
  }
  const out = o.out ? path.resolve(o.out) : path.join(REPORT_DIR, `round-${o.round}.md`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${text}\n`);
  io.log(`report written to ${path.relative(ROOT, out)}`);
  return { out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({ argv: process.argv.slice(2) }).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
}
