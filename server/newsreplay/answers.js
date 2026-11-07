// The four plain-English answers (master work order version 3, section 7; CAMPAIGN-1.md section 8) and the selection
// conditions of CAMPAIGN-1.md section 10, written from stored run reports only. Net profit, costs, drawdown, exposure,
// turnover and trades are measured from the simulation; the equal-weight hold, the exposure-matched hold and T are
// derived benchmarks. A run with positive net profit made money even if it fails qualification, and the text says
// both. Nothing here is evidence of future profit.
export const usd = (n) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const [i, f] = Math.abs(n).toFixed(2).split('.');
  return `${n <= -0.005 ? '-' : ''}US$${i.replace(/\B(?=(\d{3})+$)/g, ',')}.${f}`;
};
const pct = (n) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(2)}%`);
const SENS = ['costs_x2', 'delay_bar', 'delay_session'];
const SENS_TEXT = { costs_x2: 'with costs doubled', delay_bar: 'one bar later', delay_session: 'one session later' };
// The matched control of each configuration: the price-only control for the event arms, the content-blind twin for DC.
export const CONTROL_OF = Object.freeze({ 'D-A': 'P-A', 'D-B': 'P-B', 'D-C': 'P-C', 'DC-A': 'D-A', 'P-A': 'D-A', 'P-B': 'D-B', 'P-C': 'D-C' });

// by: Map `${configId}|${variant}` -> report; holm: campaign.holm(); matrix: matrix-v1.json.
export function selection(id, by, holm, matrix) {
  const sel = matrix.selection;
  const r = by.get(`${id}|base`);
  if (!r) return { candidate: false, problems: ['not run yet'], comparisons: [] };
  const firstOf = matrix.comparisons.filter((c) => c.pairs.some(([x]) => x === id));
  const sig = firstOf.filter((c) => holm[c.id]?.significant && holm[c.id].statistic > 0);
  const problems = [];
  if (!firstOf.length) problems.push('it is only ever the control arm of a comparison, so it cannot be a candidate');
  else if (!sig.length) problems.push(firstOf.some((c) => holm[c.id]?.status === 'tested') ? 'no comparison with it as the first arm is positive and Holm-significant' : 'the placebo test of its comparisons has not finished');
  if (!(r.T > 0)) problems.push('T (net minus the exposure-matched hold) is not above zero');
  for (const v of SENS) { const x = by.get(`${id}|${v}`); if (!x) problems.push(`the run ${SENS_TEXT[v]} has not run yet`); else if (!(x.T > 0)) problems.push(`T is not above zero ${SENS_TEXT[v]}`); }
  if (r.completedTrades < sel.minCompletedTrades) problems.push(`${r.completedTrades} completed trades, fewer than ${sel.minCompletedTrades}`);
  if (r.maxDrawdownPct > sel.maxDrawdownPct) problems.push(`maximum drawdown ${pct(r.maxDrawdownPct)} is above ${sel.maxDrawdownPct}%`);
  const top = r.concentration?.topShare;
  if (top == null) problems.push('there is no gross gain to judge concentration on');
  else if (top > sel.maxTopStockShare) problems.push(`${r.concentration.topStock} holds ${(top * 100).toFixed(1)}% of the gross gain, above ${sel.maxTopStockShare * 100}%`);
  return { candidate: problems.length === 0, problems, comparisons: sig.map((c) => c.id) };
}

function versus(a, b, what) {
  const d = a - b;
  return `${Math.abs(d) < 0.005 ? 'level with' : d > 0 ? `ahead by ${usd(d)}` : `behind by ${usd(-d)}`} ${what}`;
}

export function fourAnswers(id, by, holm, matrix) {
  const r = by.get(`${id}|base`);
  if (!r) return null;
  const start = matrix.portfolio.startingCash;
  const sel = selection(id, by, holm, matrix);
  const made = r.net > 0;
  const money = `${made ? 'Yes' : 'No'}. ${id} ${made ? 'made' : r.net < 0 ? 'lost' : 'made'} ${usd(Math.abs(r.net))} after ${usd(r.costs)} of modelled costs on ${usd(start)} (${pct(r.totalReturnPct)} in total, ${pct(r.annualisedReturnPct)} a year), with ${r.completedTrades} completed trades${r.openAtEnd ? ` and ${r.openAtEnd} position(s) open at the end, valued at the last close` : ''}. Qualification (CAMPAIGN-1.md section 10): ${sel.candidate ? 'met: a development candidate on a heavily used period, never validated' : `not met (${sel.problems.join('; ')})`}.${made && !sel.candidate ? ' It made money in this simulation and it does not qualify; both are true.' : ''}`;

  const parts = [];
  const ctl = CONTROL_OF[id], c = ctl ? by.get(`${ctl}|base`) : null;
  const role = id.startsWith('P-') ? `It is the price-only control of ${ctl}` : id === 'DC-A' ? `Against its content-blind twin ${ctl} (the same plans without the headline rule)` : `Against its price-only control ${ctl} (the same rules on sessions without news)`;
  if (!c) parts.push(`${role}: ${ctl} has not run yet.`);
  else if (id.startsWith('P-')) parts.push(`${role}; against ${ctl} (net ${usd(c.net)}) it is ${versus(r.net, c.net, 'in net profit')} and ${versus(r.T, c.T, 'on T')}.`);
  else parts.push(`${role}, net ${usd(c.net)}: ${id} is ${versus(r.net, c.net, 'in net profit')} and ${versus(r.T, c.T, 'on T, which removes the effect of being more or less invested')}; it ${r.T > c.T ? 'beat' : 'did not beat'} its matched control.`);
  parts.push(`Against the equal-weight buy-and-hold of basket A (net ${usd(r.index.net)}, always fully invested): ${versus(r.net, r.index.net, '')}`.trim() + `; it ${r.net > r.index.net ? 'beat' : 'did not beat'} holding the basket.`);
  parts.push(`Against its exposure-matched hold (net ${usd(r.exposureMatched.net)}: the basket's daily return scaled to the share of the account this run had invested): T = ${usd(r.T)}, so it ${r.T > 0 ? 'beat' : 'did not beat'} it.`);
  if (/-C$/.test(id)) {
    const b = by.get(`${id[0]}-B|base`);
    parts.push(b ? `Volume-profile entry against the price-only pullback ${id[0]}-B (net ${usd(b.net)}): ${versus(r.net, b.net, 'in net profit')} and ${versus(r.T, b.T, 'on T')}; the volume-profile entry ${r.T > b.T ? 'beat' : 'did not beat'} the price-only pullback.` : `Volume-profile entry against the price-only pullback ${id[0]}-B: ${id[0]}-B has not run yet.`);
    if (id === 'D-C') parts.push('AMT exits are a separate experiment (CAMPAIGN-2.md, Phase B2); this run uses the existing exits.');
  }
  const controls = parts.join(' ');

  const risk = `Maximum drawdown ${pct(r.maxDrawdownPct)} (the equal-weight hold's ${pct(r.index.maxDrawdownPct)}, the exposure-matched hold's ${pct(r.exposureMatched.maxDrawdownPct)}). On average ${pct(r.avgInvestedPct)} of the account was invested and ${pct(r.timeInCashPct)} sat in cash. Turnover ${r.turnoverPerYear ?? '—'} times the average account value a year; costs ${usd(r.costs)}; holding period median ${r.holdingSessions?.median ?? '—'} sessions, longest ${r.holdingSessions?.longest ?? '—'}.`;

  const cmps = matrix.comparisons.filter((x) => x.pairs.some((pr) => pr.includes(id)));
  const tests = cmps.map((x) => {
    const h = holm[x.id];
    if (!h) return `${x.id} (${x.name}): not recorded`;
    if (h.status === 'tested' && h.p != null) return `${x.id} (${x.name}): statistic ${usd(h.statistic)}, placebo p ${h.p.toFixed(4)}, Holm-adjusted ${h.holmP == null ? '—' : h.holmP.toFixed(4)}, ${h.significant ? 'significant after Holm' : 'not significant after Holm'}`;
    return `${x.id} (${x.name}): ${h.status}`;
  });
  const sens = SENS.map((v) => { const x = by.get(`${id}|${v}`); return `${x ? usd(x.T) : 'not run yet'} ${SENS_TEXT[v]}`; }).join(', ');
  const runnable = matrix.configurations.filter((x) => !x.status).length;
  const evidence = `${r.completedTrades} completed trades (the selection needs at least ${matrix.selection.minCompletedTrades})${r.completedTrades < matrix.selection.minCompletedTrades ? ', too few to judge' : ''}. The pre-registered test (date-clustered event-time placebo, ${matrix.inference.resamples.toLocaleString('en-US')} resamples, seed ${matrix.inference.seed}, Holm over ${matrix.inference.holmFamily.length} comparisons): ${tests.length ? tests.join('; ') : 'none involves this configuration'}. T under the sensitivities: ${sens}. Repeated testing: this campaign runs ${runnable} configurations, each with ${SENS.length} sensitivities, and tests up to ${matrix.inference.holmFamily.length} comparisons (the AI comparisons are not run: no API spending authorised); 2020 to 2021 is the heavily used development period of HXR, range-trend, the research runner and event-swing, so even a small p here is a development result, never evidence of future profit.`;

  return { money, controls, risk, evidence, madeMoney: made, qualified: sel.candidate, problems: sel.problems };
}

export const QUESTIONS = Object.freeze({
  money: 'Did it make money after costs?',
  controls: 'Did it beat its matched control and holding?',
  risk: 'How much risk and exposure?',
  evidence: 'How strong is the evidence?',
});

// ---------- campaign 2 (CAMPAIGN-2.md): the AMT exits on D-C ----------
const EXIT_NAME = Object.freeze({ X1: 'the existing exits (the control)', X2: 'the AMT acceptance exit', X3: 'the AMT target exit', X4: 'the price-only matched exit' });
export function selection2(id, by, holm, m2) {
  const sel = m2.selection;
  const r = by.get(`${id}|base`);
  if (!r) return { candidate: false, problems: ['not run yet'], comparisons: [] };
  const firstOf = m2.comparisons.filter((c) => c.pair[0] === id);
  const sig = firstOf.filter((c) => holm[c.id]?.significant && holm[c.id].statistic > 0);
  const problems = [];
  if (!firstOf.length) problems.push('it is only ever the second arm of a comparison, so it cannot be a candidate');
  else if (!sig.length) problems.push(firstOf.some((c) => holm[c.id]?.status === 'tested') ? 'no comparison with it as the first arm is positive and Holm-significant' : 'the placebo test of its comparisons has not finished');
  if (!(r.T > 0)) problems.push('T (net minus the exposure-matched hold) is not above zero');
  for (const v of SENS) { const x = by.get(`${id}|${v}`); if (!x) problems.push(`the run ${SENS_TEXT[v]} has not run yet`); else if (!(x.T > 0)) problems.push(`T is not above zero ${SENS_TEXT[v]}`); }
  if (r.completedTrades < sel.minCompletedTrades) problems.push(`${r.completedTrades} completed trades, fewer than ${sel.minCompletedTrades}`);
  if (r.maxDrawdownPct > sel.maxDrawdownPct) problems.push(`maximum drawdown ${pct(r.maxDrawdownPct)} is above ${sel.maxDrawdownPct}%`);
  const top = r.concentration?.topShare;
  if (top == null) problems.push('there is no gross gain to judge concentration on');
  else if (top > sel.maxTopStockShare) problems.push(`${r.concentration.topStock} holds ${(top * 100).toFixed(1)}% of the gross gain, above ${sel.maxTopStockShare * 100}%`);
  return { candidate: problems.length === 0, problems, comparisons: sig.map((c) => c.id) };
}

export function fourAnswers2(id, by, holm, m2, startingCash) {
  const r = by.get(`${id}|base`);
  if (!r) return null;
  const sel = selection2(id, by, holm, m2);
  const made = r.net > 0;
  const money = `${made ? 'Yes' : 'No'}. ${id} (${EXIT_NAME[id]}) ${made ? 'made' : r.net < 0 ? 'lost' : 'made'} ${usd(Math.abs(r.net))} after ${usd(r.costs)} of modelled costs on ${usd(startingCash)} (${pct(r.totalReturnPct)} in total, ${pct(r.annualisedReturnPct)} a year), with ${r.completedTrades} completed trades${r.openAtEnd ? ` and ${r.openAtEnd} position(s) open at the end` : ''}. Qualification (CAMPAIGN-2.md section 10): ${sel.candidate ? 'met: a development candidate on a heavily used period, never validated' : `not met (${sel.problems.join('; ')})`}.${made && !sel.candidate ? ' It made money in this simulation and it does not qualify; both are true.' : ''}`;
  const x1 = by.get('X1|base'), x4 = by.get('X4|base');
  const parts = [];
  if (id === 'X1') parts.push('X1 is the control: campaign 1\'s D-C with its existing exits, reproduced to the cent.');
  else parts.push(x1 ? `Against the existing exits X1 (net ${usd(x1.net)}): ${id} is ${versus(r.net, x1.net, 'in net profit')} and ${versus(r.T, x1.T, 'on T')}; it ${r.T > x1.T ? 'beat' : 'did not beat'} the existing exits.` : 'X1 has not run yet.');
  if (id === 'X2') parts.push(x4 ? `Against the price-only matched exit X4 (net ${usd(x4.net)}): ${versus(r.net, x4.net, 'in net profit')} and ${versus(r.T, x4.T, 'on T')}; the volume-profile level ${r.T > x4.T ? 'added something over' : 'added nothing over'} the price-only level.` : 'X4 has not run yet.');
  parts.push(`Against the equal-weight buy-and-hold of basket A (net ${usd(r.index.net)}): ${versus(r.net, r.index.net, '')}`.trim() + `; it ${r.net > r.index.net ? 'beat' : 'did not beat'} holding the basket.`);
  parts.push(`Against its exposure-matched hold (net ${usd(r.exposureMatched.net)}): T = ${usd(r.T)}, so it ${r.T > 0 ? 'beat' : 'did not beat'} it.`);
  const ex = r.exitSummary;
  if (ex) parts.push(`Exits: ${Object.entries(ex.sells || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}${Object.keys(ex.targetsSet || {}).length ? `; targets set at the fill: ${Object.entries(ex.targetsSet).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}.`);
  const controls = parts.join(' ');
  const risk = `Maximum drawdown ${pct(r.maxDrawdownPct)} (the equal-weight hold's ${pct(r.index.maxDrawdownPct)}, the exposure-matched hold's ${pct(r.exposureMatched.maxDrawdownPct)}). On average ${pct(r.avgInvestedPct)} of the account was invested and ${pct(r.timeInCashPct)} sat in cash. Turnover ${r.turnoverPerYear ?? '—'} times the average account value a year; costs ${usd(r.costs)}; holding period median ${r.holdingSessions?.median ?? '—'} sessions, longest ${r.holdingSessions?.longest ?? '—'}.`;
  const tests = m2.comparisons.filter((c) => c.pair.includes(id)).map((c) => {
    const h = holm[c.id];
    if (h?.status === 'tested' && h.p != null) return `${c.id} (${c.name}): statistic ${usd(h.statistic)}, placebo p ${h.p.toFixed(4)}, Holm-adjusted ${h.holmP == null ? '—' : h.holmP.toFixed(4)}, ${h.significant ? 'significant after Holm' : 'not significant after Holm'}`;
    return `${c.id} (${c.name}): ${h?.status ?? 'not recorded'}`;
  });
  const sens = SENS.map((v) => { const x = by.get(`${id}|${v}`); return `${x ? usd(x.T) : 'not run yet'} ${SENS_TEXT[v]}`; }).join(', ');
  const evidence = `${r.completedTrades} completed trades (the selection needs at least ${m2.selection.minCompletedTrades})${r.completedTrades < m2.selection.minCompletedTrades ? ', too few to judge' : ''}. The pre-registered test (date-clustered event-time placebo, ${m2.inference.resamples.toLocaleString('en-US')} resamples, seed ${m2.inference.seed}, Holm over ${m2.inference.holmFamily.length}): ${tests.join('; ')}. T under the sensitivities: ${sens}. Repeated testing: four exits on one entry, after campaign 1's seven configurations on the same news and the same heavily used period (HXR, range-trend, the research runner, event-swing); a small p here is a development result, never evidence of future profit.`;
  return { money, controls, risk, evidence, madeMoney: made, qualified: sel.candidate, problems: sel.problems };
}
