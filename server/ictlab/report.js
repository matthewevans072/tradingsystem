// ICT Lab run report (strategy/ict-lab/PROTOCOL.md section 11, in full). Built from recorded runs; every figure is
// labelled measured (read from the stored run) or derived (computed from measured figures). No bar, price or
// per-fill price list. The words "profitable" and "edge" never appear (section 1); a test greps the output.
import { MIN_TRADES, ALPHA, TEST_BUDGET, MAX_MONTH_SHARE, SEEDS, BOOTSTRAP_N, NULL_N, funnelOf, worstStage } from './metrics.js';
import { INSTRUMENT, STAND_IN_FOR, WINDOWS, MAX_BAR_DATE, PREREG, roundSpecs } from './config.js';
import { STAGES } from './engine.js';

const f4 = (x) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(4));
const f2 = (x) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(2));
const f3 = (x) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(3));
const f6 = (x) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(6));
const pct = (x) => (x == null || Number.isNaN(x) ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const yn = (b) => (b ? 'yes' : 'no');

export const FORBIDDEN_WORDS = Object.freeze(['profitable', 'edge']);
// The forbidden words, as whole words, case-insensitively; [] when the text is clean.
export function forbiddenWords(text) {
  return FORBIDDEN_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
}

// runs: the window's done runs (store.listRuns shape, metrics included); failedRuns: the others; version: the data
// version; bound: { maxStoredDate, after }.
export function buildReport({ round = 1, window = 'development', runs, failedRuns = [], version, bound, generatedAt }) {
  const L = [];
  const win = WINDOWS[window];
  L.push(`# ICT Lab round ${round}: ${window} runs on ${INSTRUMENT} (stand-in for ${STAND_IN_FOR})`, '');
  L.push(`Generated ${generatedAt} from the recorded runs of \`data/ict-lab-sim.sqlite\` by \`scripts/ictlab-report.mjs\`. **Measured** = read from a stored run; **derived** = computed from measured figures. Rules: PROTOCOL.md and CONCEPTS.md as pinned by the pre-registration commit ${PREREG.commit.slice(0, 12)}; criteria: PROTOCOL.md section 7${window === 'validation' ? ' with section 8 (C1 of 40)' : ''}. Window: ${window.toUpperCase()} ${win.start} to ${win.end}; bar bound ${MAX_BAR_DATE}; latest stored date ${bound.maxStoredDate ?? 'none'}; bars after the bound: ${bound.after.bars5m} five-minute, ${bound.after.bars1d} daily. Data version ${version?.id ?? 'n/a'} (${version?.label ?? ''}), hash ${version?.dataHash ?? 'n/a'}, ${version?.feed ?? ''} ${version?.adjustment ?? ''}.`, '');
  L.push(`These are ${window === 'development' ? 'in-sample development results with disclosed prior exposure (PROTOCOL.md section 2)' : 'validation results, once per candidate'} on data the owner has watched. Nothing here is evidence about NQ or about the discretionary original; QQQ's regular session and the prior session's daily low stand in for the original's instrument and session levels. A negative, NONE or inconclusive result is a valid outcome. No bar, price or per-fill list appears in this file.`, '');

  L.push('## 1. Runs recorded (measured)', '');
  L.push('| Run | Spec | Window | Status | Repeat | Code revision | Engine | HEAD | Source hash | Spec hash | Started | Finished |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of [...runs, ...failedRuns].sort((a, b) => a.id - b.id)) L.push(`| ${r.id} | ${r.spec} | ${r.window} | ${r.status}${r.error ? ` (${r.error})` : ''} | ${r.repeat ? `yes${r.contaminated ? ', contaminated' : ''}${r.repeatReason ? ` (${r.repeatReason})` : ''}` : 'no'} | ${r.codeRevision} | ${r.engineVersion} | ${(r.headCommit || '').slice(0, 12)} | ${(r.sourceHash || '').slice(0, 12)} | ${(r.specHash || '').slice(0, 12)} | ${r.createdAt} | ${r.finishedAt} |`);
  const missing = roundSpecs(round).filter((v) => !runs.some((r) => r.spec === v));
  L.push('', `${runs.length} of ${roundSpecs(round).length} pre-registered specs have a completed ${window} run${missing.length ? `; not yet run: ${missing.join(', ')}` : ''}.`, '');

  L.push('## 2. Trades (PROTOCOL.md 9.5)', '');
  L.push(`| Figure | ${runs.map((r) => r.spec.replace('-0.1.0.json', '')).join(' | ')} | Label |`, `|---|${runs.map(() => '---').join('|')}|---|`);
  const row = (name, fn, lab = 'measured') => L.push(`| ${name} | ${runs.map((r) => fn(r.metrics)).join(' | ')} | ${lab} |`);
  row('sessions in the window', (m) => m.sessionsInWindow);
  row('completed trades (fills with a recorded exit)', (m) => m.trades);
  row('win rate', (m) => pct(m.winRate), 'derived');
  row('mean R after costs', (m) => f4(m.meanR), 'derived');
  row('median R', (m) => f4(m.medianR), 'derived');
  row('profit factor', (m) => f3(m.profitFactor), 'derived');
  row('maximum drawdown (R, exit order)', (m) => f2(m.maxDrawdownR), 'derived');
  row('average holding time (minutes)', (m) => f2(m.avgHoldingMinutes), 'derived');
  row('exposure by hour (share of held bars)', (m) => Object.entries(m.exposureByHour.byHour).map(([h, v]) => `${h}h ${pct(v.share)}`).join(', ') || 'n/a', 'derived');
  row('cost per trade: $ per share round trip', (m) => f2(m.costPerTrade.dollarsPerShareRoundTrip));
  row('cost per trade: mean in R', (m) => f4(m.costPerTrade.meanR), 'derived');
  row('mean R at 2x costs', (m) => f4(m.meanR2x), 'derived');
  row('gross gain / gross loss (R)', (m) => `${f2(m.grossGainR)} / ${f2(m.grossLossR)}`, 'derived');
  row('exits: stop / same-bar stop / target / time', (m) => `${m.exitCounts.stop} / ${m.exitCounts.stop_same_bar} / ${m.exitCounts.target} / ${m.exitCounts.time}`);
  L.push('');

  L.push(`## 3. Statistics (PROTOCOL.md 9.1 to 9.4; derived from measured trades)`, '');
  L.push(`| Figure | ${runs.map((r) => r.spec.replace('-0.1.0.json', '')).join(' | ')} |`, `|---|${runs.map(() => '---').join('|')}|`);
  const srow = (name, fn) => L.push(`| ${name} | ${runs.map((r) => fn(r.metrics)).join(' | ')} |`);
  srow(`bootstrap 95% interval of the mean R (${BOOTSTRAP_N.toLocaleString('en-US')} resamples, seed ${SEEDS.bootstrap})`, (m) => `[${f4(m.bootstrap.lower)}, ${f4(m.bootstrap.upper)}]`);
  srow(`random-entry null: mean of the ${NULL_N.toLocaleString('en-US')} resampled means (seed ${SEEDS.null}; complete sessions drawn from)`, (m) => `${f4(m.nullTest.nullMean)} (${m.nullTest.sessions ?? 'n/a'} sessions)`);
  srow('null: 5th / 50th / 95th / 99th percentile (nearest rank)', (m) => (m.nullTest.percentiles ? `${f4(m.nullTest.percentiles.p5)} / ${f4(m.nullTest.percentiles.p50)} / ${f4(m.nullTest.percentiles.p95)} / ${f4(m.nullTest.percentiles.p99)}` : 'n/a'));
  srow('null: one-sided p (resampled means at or above the actual mean)', (m) => `${f6(m.nullTest.p)} (${m.nullTest.atOrAbove ?? 'n/a'} at or above)`);
  srow('mean R without the best 5% (K removed)', (m) => `${f4(m.bestRemoved.mean)} (K = ${m.bestRemoved.K})`);
  srow('largest monthly share of gross gains (month)', (m) => `${f3(m.monthShares.maxShare)} (${m.monthShares.maxMonth ?? 'n/a'})`);
  L.push('');

  L.push(`## 4. The dollar account (PROTOCOL.md 6; US$${runs[0]?.metrics.account.startingCash ?? ''} per spec, whole shares, no leverage; the ${pct(runs[0]?.metrics.account.maxPlannedRiskFraction ?? 0.01)} rule is a maximum, not the risk taken)`, '');
  L.push(`| Figure | ${runs.map((r) => r.spec.replace('-0.1.0.json', '')).join(' | ')} | Label |`, `|---|${runs.map(() => '---').join('|')}|---|`);
  row('starting cash ($)', (m) => f2(m.account.startingCash));
  row('ending cash ($)', (m) => f2(m.account.endingCash));
  row('maximum drawdown ($)', (m) => f2(m.account.maxDrawdown));
  row('lowest cash ($)', (m) => f2(m.account.lowestCash));
  row('mean actual planned risk ($)', (m) => f2(m.sizing.meanPlannedRiskActual), 'derived');
  row('mean actual planned risk (share of equity at the confirmation close)', (m) => pct(m.sizing.meanPlannedRiskShareOfEquity), 'derived');
  row('trades cash_capped (count, share of fills)', (m) => `${m.sizing.cashCapped} (${pct(m.sizing.cashCappedShare)})`, 'measured, derived');
  row('unfunded skips (confirmations the account could not fund)', (m) => m.sizing.unfunded);
  row('trades whose loss exceeded the planned risk (gaps and costs)', (m) => m.sizing.lossExceededRisk);
  L.push('');

  L.push('## 5. The funnel (PROTOCOL.md section 11; measured counts, derived shares lost)', '');
  for (const r of runs) {
    const m = r.metrics;
    L.push(`### ${r.spec}, run ${r.id}`, '');
    L.push('| Stage | Count | Lost from the stage before | Share lost |', '|---|---|---|---|');
    for (const s of funnelOf(m.funnel)) L.push(`| ${s.stage} | ${s.count} | ${s.lost == null ? '' : s.lost} | ${s.lostShare == null ? '' : pct(s.lostShare)} |`);
    L.push('', `Sessions by final stage (measured): ${STAGES.map((st) => `${st} ${m.stageCounts[st] || 0}`).join(', ')}. Refused confirmations in total (re-armed sessions count each refusal): ${m.counts.refusedConfirmations}. Exit split: stop ${m.exitCounts.stop}, same-bar stop ${m.exitCounts.stop_same_bar}, target ${m.exitCounts.target}, time ${m.exitCounts.time}.`, '');
  }

  L.push('## 6. The flaw section (the stage that loses the most, with its measured share)', '');
  for (const r of runs) {
    const m = r.metrics;
    const w = worstStage(funnelOf(m.funnel));
    L.push(w ? `- **${r.spec}**: the largest loss of sessions is at "${w.stage}": ${w.lost} sessions lost of the ${w.count + w.lost} that reached the stage before it (${pct(w.lostShare)}, measured count, derived share). Of ${m.funnel.sessions} sessions in the window, ${m.funnel.fills} filled.` : `- **${r.spec}**: no sessions.`);
  }
  L.push('');

  L.push(`## 7. Criteria C1 to C6 (PROTOCOL.md section 7${window === 'validation' ? ', C1 per section 8' : ''}; derived from measured figures)`, '');
  L.push(`C1 at least ${MIN_TRADES[window]} completed trades; C2 mean R after costs > 0 and bootstrap 95% lower bound > 0; C3 mean R at 2x costs > 0; C4 random-entry null p < ${ALPHA.toFixed(7)} (0.05 / ${TEST_BUDGET}, the fixed denominator); C5 mean R > 0 without the best 5%; C6 largest monthly share of gross gains <= ${MAX_MONTH_SHARE}. ${window === 'development' ? 'A spec is a CANDIDATE only when all six pass on QQQ on the development window; every candidate is validated once (section 8); there is no pick among candidates.' : 'The outcome is NOT REJECTED ON VALIDATION when all six pass, else REJECTED; a repeat is contaminated and can never be "not rejected".'}`, '');
  L.push('| Spec | C1 | C2 | C3 | C4 | C5 | C6 | Outcome |', '|---|---|---|---|---|---|---|---|');
  for (const r of runs) {
    const c = r.metrics.criteria;
    const cells = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((k) => (c[k].pass ? 'pass' : 'FAIL')).join(' | ');
    const outcome = window === 'development' ? (c.pass ? '**CANDIDATE**' : 'not a candidate') : r.contaminated ? 'contaminated (never "not rejected")' : c.pass ? '**NOT REJECTED ON VALIDATION**' : 'REJECTED';
    L.push(`| ${r.spec} | ${cells} | ${outcome} |`);
  }
  L.push('');

  L.push('## 8. The plain outcome', '');
  const candidates = runs.filter((r) => r.metrics.criteria.pass && !r.contaminated).map((r) => r.spec);
  if (window === 'development') {
    L.push(candidates.length ? `Candidates: ${candidates.join(', ')}. Each is eligible for one validation run after the owner's separate message (PROTOCOL.md section 8); nothing else follows from a candidate.` : `Candidates: none. NONE advances; no spec passes C1 to C6 on the development window, which is a valid, expected outcome. ${runs.length < roundSpecs(round).length ? `The round is not complete (${runs.length} of ${roundSpecs(round).length} runs recorded).` : 'The round is complete.'}`);
  } else {
    L.push(candidates.length ? `Not rejected on validation: ${candidates.join(', ')}. This means only that the candidate was not rejected on data it was not tuned on, nothing more.` : 'Every validated candidate is REJECTED (or contaminated).');
  }
  L.push('', 'The ending value of the dollar account never makes a candidate (PROTOCOL.md section 7).', '');
  return L.join('\n');
}
