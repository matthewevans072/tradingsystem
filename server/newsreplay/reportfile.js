// The news-replay report (CAMPAIGN-1.md sections 8 and 10): every configuration against both benchmarks, the
// sensitivities, the four plain-English answers (master work order version 3, section 7), plan fates and event
// categories, annual and per-stock results, signal fates (missed and expired opportunities), the pre-registered
// comparisons with raw and Holm-adjusted placebo p, and the outcome. Figures are measured from the simulation; the
// index and the exposure-matched hold are derived benchmarks. Nothing here ranks on ending balance alone.
import fs from 'node:fs';
import path from 'node:path';
import { REPORT_DIR, CODE_REVISION, ENGINE_VERSION } from './config.js';
import { doneReports } from './store.js';
import { fourAnswers, selection, QUESTIONS } from './answers.js';

export function writeReport(nr, { file = path.join(REPORT_DIR, 'campaign-1.md') } = {}) {
  const by = doneReports(nr.db);
  const holm = nr.holm();
  const L = [];
  L.push('# news-replay campaign 1: results (exploratory: 2020-01-02 to 2021-12-31 is a heavily used development period; simulation only)', '');
  L.push(`Code revision \`${CODE_REVISION}\`, engine \`${ENGINE_VERSION}\`. Every figure is measured from the simulation; the equal-weight buy-and-hold of basket A and each run's exposure-matched hold are derived benchmarks. T = net profit minus the run's exposure-matched hold. Nothing here is evidence of future profit, and no result from this period is called proven profitable.`, '');
  L.push('## Configurations against the benchmarks (base case)', '', '| Config | Net US$ | Ann. % | Max DD % | Invested % | Trades | Costs | Index net | Exposure-matched net | T | T, costs x2 | T, +1 bar | T, +1 session |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of nr.matrix.configurations) {
    const r = by.get(`${c.id}|base`);
    if (!r) { L.push(`| ${c.id} | ${c.status || 'not run yet'} | | | | | | | | | | | |`); continue; }
    L.push(`| ${c.id} | ${r.net} | ${r.annualisedReturnPct} | ${r.maxDrawdownPct} | ${r.avgInvestedPct} | ${r.completedTrades} | ${r.costs} | ${r.index.net} | ${r.exposureMatched.net} | ${r.T} | ${by.get(`${c.id}|costs_x2`)?.T ?? '—'} | ${by.get(`${c.id}|delay_bar`)?.T ?? '—'} | ${by.get(`${c.id}|delay_session`)?.T ?? '—'} |`);
  }
  L.push('', '## Pre-registered comparisons (placebo p raw and Holm-adjusted over six)', '', '| Comparison | Statistic (sum of T differences) | Raw p | Holm p | Status |', '|---|---|---|---|---|');
  for (const cmp of nr.matrix.comparisons) { const h = holm[cmp.id]; L.push(`| ${cmp.id} ${cmp.name} | ${h.statistic ?? '—'} | ${h.p == null ? '—' : h.p.toFixed(4)} | ${h.holmP == null ? '—' : h.holmP.toFixed(4)} | ${h.status}${h.significant ? ', Holm-significant' : ''} |`); }
  const ran = nr.matrix.configurations.filter((c) => by.get(`${c.id}|base`));
  const candidates = ran.map((c) => ({ id: c.id, s: selection(c.id, by, holm, nr.matrix) })).filter((x) => x.s.candidate).map((x) => `${x.id} (${x.s.comparisons.join(', ')})`);
  const allRun = nr.matrix.configurations.filter((c) => !c.status).every((c) => by.get(`${c.id}|base`));
  const placeboDone = Object.values(holm).every((h) => !/^pending|^incomplete/.test(h.status));
  L.push('', `**Outcome:** ${candidates.length ? `development candidate(s): ${candidates.join(', ')}; exploratory, never validated` : allRun && placeboDone ? 'NONE: no configuration passes a pre-registered comparison and the conditions of CAMPAIGN-1.md section 10.' : 'not decided yet: some runs or the placebo have not finished.'}`, '');
  L.push('## Per configuration', '');
  for (const c of ran) {
    const r = by.get(`${c.id}|base`);
    const a = fourAnswers(c.id, by, holm, nr.matrix);
    L.push(`### ${c.id}`, '', ...Object.entries(QUESTIONS).flatMap(([k, q]) => [`**${q}** ${a[k]}`, '']));
    if (r.planFates) L.push(`Plan fates (entry plans): ${Object.entries(r.planFates.fates).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join('; ')}. By event category: ${Object.entries(r.planFates.byCategory).map(([k, v]) => `${k}: ${v.plans} plans, ${v.trades} trades, ${v.wins} wins, P/L ${v.pnl}`).join('; ')}.`, '');
    L.push(`Annual (net / exposure-matched / index, US$): ${Object.entries(r.annual).map(([y, v]) => `${y} ${v.net} / ${v.exposureMatchedNet} / ${v.indexNet}`).join('; ')}. Per stock: ${Object.entries(r.perStock).map(([s, v]) => `${s} ${v}`).join('; ')}. Top stock ${r.concentration.topStock ?? '—'} ${r.concentration.topShare != null ? `${(r.concentration.topShare * 100).toFixed(1)}%` : ''} of the gross gain. Exits ${JSON.stringify(r.exits)}. Holding sessions median ${r.holdingSessions?.median ?? '—'}, longest ${r.holdingSessions?.longest ?? '—'}. Turnover per year ${r.turnoverPerYear}; time in cash ${r.timeInCashPct}%. Signal fates ${JSON.stringify(r.signalFates)}. Plans ${JSON.stringify(r.plans)}. Accounting ${r.accounting.ok ? 'reconciles' : `does not reconcile: ${r.accounting.problems.join('; ')}`}.`, '');
  }
  L.push('## Limitations', '', 'A hand-picked basket of ten survivors chosen in 2026; a two-year period that every earlier programme examined; news from one aggregator with created times and no expectations or earnings calendars; acceptance times as upper bounds for filings; the volume profile approximated from 1-minute bars; modelled costs; the placebo samples item-free sessions with replacement, and news-heavy stocks have few of them; the AI arms are not run (no API spending authorised).', '');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${L.join('\n')}\n`, 'utf8');
  return file;
}
