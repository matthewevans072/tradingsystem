// Backtest report (JSON + Markdown) for the Strategy Lab. Plain, factual
// wording: figures, sample sizes and the pre-registered criteria, never a
// claim that the strategy works. Synthetic inputs get a banner on top.
import { etDate } from './metrics.js';
import { evaluateAcceptance, OUTCOME_NOTE } from './validation.js';

export const SYNTHETIC_BANNER = 'SYNTHETIC DATA — tests the code, says nothing about the strategy';
export const SMALL_SAMPLE = 30;
const SPLITS = ['development', 'validation', 'holdout'];
const MODES = ['intraday', 'swing'];

// ---------- formatting ----------

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const num = (x, dp = 2) => (fin(x) ? x.toFixed(dp) : '—');
const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (x) => (fin(x) ? `${x < 0 ? '−' : ''}US$${usdFmt.format(Math.abs(x))}` : '—');
const pct = (x, dp = 2) => (fin(x) ? `${x.toFixed(dp)} %` : '—'); // already a percentage
const rate = (x, dp = 1) => (fin(x) ? `${(x * 100).toFixed(dp)} %` : '—'); // a fraction
const rr = (x) => (fin(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(3)} R` : '—');
const cell = (s) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function table(head, rows) {
  if (!rows.length) return '_No rows._\n';
  return `| ${head.map(cell).join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')}\n`;
}

function pf(m) {
  if (!m) return '—';
  if (m.profitFactor == null) return m.trades ? (m.grossProfit > 0 ? 'no losing trades' : '—') : '—';
  return num(m.profitFactor, 2);
}

const sample = (n) => (n == null ? '—' : n < SMALL_SAMPLE ? `${n} (small sample)` : String(n));

function ci(m) {
  const c = m?.meanRCI;
  return c && fin(c.lower) ? `${rr(c.lower)} to ${rr(c.upper)}` : '—';
}

function valueText(v) {
  if (v == null) return '—';
  if (typeof v !== 'object') return fin(v) ? num(v, 3) : String(v);
  return Object.entries(v).filter(([, x]) => x != null && typeof x !== 'object').map(([k, x]) => `${k}: ${fin(x) ? (Number.isInteger(x) ? x : x.toFixed(3)) : x}`).join('; ')
    + (v.largestSymbol ? `; largest symbol: ${v.largestSymbol.symbol} ${fin(v.largestSymbol.shareOfNet) ? rate(v.largestSymbol.shareOfNet) : '(no net profit)'}` : '');
}

// JSON-safe copy: non-finite numbers become null.
function clean(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (Array.isArray(x)) return x.map(clean);
  if (x && typeof x === 'object') {
    if (x instanceof Map) return clean(Object.fromEntries(x));
    return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined && typeof v !== 'function').map(([k, v]) => [k, clean(v)]));
  }
  return x;
}

function dailyEquity(curve = []) {
  const out = [];
  for (const p of curve) {
    const d = etDate(p.t);
    if (out.length && out[out.length - 1].date === d) out[out.length - 1] = { date: d, equity: p.equity, positions: p.positions };
    else out.push({ date: d, equity: p.equity, positions: p.positions });
  }
  return out;
}

// Any `synthetic: true` in the run metadata, a split, stress test, fold or the
// data-quality report marks the whole report (trade lists are not searched).
function isSynthetic(...xs) {
  const seen = new Set();
  const walk = (x, depth) => {
    if (!x || typeof x !== 'object' || depth > 6 || seen.has(x)) return false;
    seen.add(x);
    if (x.synthetic === true) return true;
    for (const [k, v] of Object.entries(x)) {
      if (k === 'trades' || k === 'events' || k === 'equityCurve' || k === 'equityDaily') continue;
      if (walk(v, depth + 1)) return true;
    }
    return false;
  };
  return xs.some((x) => walk(x, 0));
}

// ---------- sections ----------

const COLS = (mode) => [
  ...SPLITS.filter((s) => mode[s]).map((s) => ({ key: s, title: s === 'holdout' && mode.holdout.contaminated ? 'Holdout (contaminated)' : s[0].toUpperCase() + s.slice(1), m: mode[s].metrics })),
  ...(mode.walkForward ? [
    { key: 'wf', title: 'Walk-forward OOS', m: mode.walkForward.oos.metrics },
    { key: 'wfb', title: 'Fixed baseline, same quarters', m: mode.walkForward.baseline.metrics },
  ] : []),
];

function metricsTable(cols) {
  const row = (label, f) => [label, ...cols.map((c) => f(c.m))];
  return table(['', ...cols.map((c) => c.title)], [
    row('Test dates', (m) => `${m.from} to ${m.to}`),
    row('Closed trades', (m) => sample(m.trades)),
    row('Forced closes at end of data (not in trade statistics)', (m) => `${m.endOfData.trades} (${usd(m.endOfData.net)})`),
    row('Net P/L (simulated)', (m) => usd(m.netPnl)),
    row('Return on simulated equity', (m) => pct(m.returnPct)),
    row('Maximum drawdown', (m) => `${pct(m.maxDrawdownPct)} (${usd(m.maxDrawdownUsd)})`),
    row('Win rate', (m) => rate(m.winRate)),
    row('Average win / average loss', (m) => `${rr(m.avgWinR)} / ${rr(m.avgLossR)}`),
    row('Mean R per trade (expectancy)', (m) => rr(m.meanR)),
    row('95 % bootstrap interval of mean R', ci),
    row('Expectancy per trade (US$)', (m) => usd(m.expectancyUsd)),
    row('Profit factor', pf),
    row('Longest losing streak', (m) => m.longestLosingStreak),
    row('Time with a position', (m) => pct(m.exposure.pctTimeInMarket, 1)),
    row('Average open positions', (m) => num(m.exposure.avgPositions, 2)),
    row('Average gross exposure (% of equity)', (m) => pct(m.exposure.avgGrossExposurePct, 1)),
    row('Turnover (traded value / average equity)', (m) => `${num(m.turnover.turnover, 1)}× (${num(m.turnover.annualised, 1)}× a year)`),
    row('Commissions', (m) => usd(m.costs.commission)),
    row('Spread and slippage', (m) => usd(m.costs.spreadSlippage)),
    row('Currency conversion', (m) => usd(m.costs.fx)),
    row('Total costs', (m) => usd(m.costs.total)),
    row('Losses beyond −1R', (m) => `${m.tail.beyondMinus1R} (${rate(m.tail.beyondMinus1RRate)}); worst ${rr(m.tail.worstR)}`),
    row('Exits that gapped through the stop or target', (m) => `${m.tail.gapThroughs} (stop: ${m.tail.gapThroughStops})`),
    row('Exits on bars touching stop and target', (m) => `${m.ambiguous.count}${m.ambiguous.count ? ` (${Object.entries(m.ambiguous.byResolution).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`),
    row('Intrabar limit entries (TradingView parity)', (m) => m.intrabarLimitEntries),
  ]);
}

function outlierTable(cols) {
  const row = (label, f) => [label, ...cols.map((c) => f(c.m.outliers, c.m))];
  return table(['', ...cols.map((c) => c.title)], [
    row('Mean R without the best trade', (o) => rr(o.meanRWithoutBest)),
    row('Net P/L without the best trade', (o) => usd(o.netWithoutBest)),
    row('Mean R without the best 5 % of trades', (o) => `${rr(o.meanRWithoutBest5Pct)} (${o.best5PctCount} removed)`),
    row('Net P/L without the best 5 %', (o) => usd(o.netWithoutBest5Pct)),
    row('Share of gross profit from the top 10 % of trades', (o) => `${rate(o.top10PctShareOfGrossProfit)} (${o.top10PctCount} trades)`),
    row('Largest single-symbol share of net profit', (o) => (o.largestSymbol ? `${o.largestSymbol.symbol}: ${fin(o.largestSymbol.shareOfNet) ? rate(o.largestSymbol.shareOfNet) : 'undefined (net profit not positive)'}` : '—')),
  ]);
}

function stressTable(stress) {
  const rows = [['Baseline', 'as configured', ...stats(stress.baseline.metrics)]];
  for (const t of stress.tests) rows.push([t.group === 'neighbours' ? 'neighbouring setting' : `${t.group}: ${t.name}`, t.description, ...stats(t.metrics)]);
  return table(['Test', 'Change', 'Trades', 'Mean R', 'Profit factor', 'Max drawdown', 'Net P/L'], rows);
  function stats(m) { return [sample(m.trades), rr(m.meanR), pf(m), pct(m.maxDrawdownPct), usd(m.netPnl)]; }
}

function walkForwardSection(wf) {
  let s = `Range ${wf.range.from} to ${wf.range.to}; ${wf.inSampleQuarters} in-sample quarter(s), ${wf.outOfSampleQuarters} out-of-sample; grid ${Object.entries(wf.grid).map(([k, v]) => `${k} ∈ {${v.join(', ')}}`).join(' × ')}; a grid point needs at least ${wf.minInSampleTrades} in-sample trades, otherwise the baseline is used.\n\n`;
  s += table(['Out-of-sample', 'In-sample window', 'Chosen setting', 'In-sample trades', 'In-sample mean R', 'OOS trades', 'OOS mean R', 'OOS net P/L'],
    wf.folds.map((f) => [f.label, `${f.inSample.from} to ${f.inSample.to}`, f.chosen.baseline ? `baseline (${f.chosen.reason})` : f.chosen.label,
      f.chosen.baseline ? '—' : f.chosen.inSampleTrades, f.chosen.baseline ? '—' : rr(f.chosen.inSampleMeanR), sample(f.oos.trades), rr(f.oos.meanR), usd(f.oos.net)]));
  s += `\nConcatenated out-of-sample: ${wf.oos.metrics.trades} trades, mean R ${rr(wf.oos.metrics.meanR)}, profit factor ${pf(wf.oos.metrics)}. Fixed baseline over the same quarters: ${wf.baseline.metrics.trades} trades, mean R ${rr(wf.baseline.metrics.meanR)}, profit factor ${pf(wf.baseline.metrics)}.\n\nMethod: ${wf.method}\n`;
  return s;
}

const GROUPS = [
  ['symbol', 'By symbol'], ['cluster', 'By cluster'], ['sector', 'By sector'], ['regime', 'By SPY regime (trend/volatility, previous session)'], ['regimeTrend', 'By SPY trend (previous session vs 50-day average)'],
  ['regimeVolatility', 'By SPY 20-day volatility (previous session)'], ['year', 'By year of entry'], ['hour', 'By hour of the signal bar (ET)'],
];

function groupSections(mode) {
  const splits = SPLITS.filter((s) => mode[s]?.metrics?.groups);
  if (!splits.length) return '';
  let s = '';
  for (const [g, title] of GROUPS) {
    const keys = [...new Set(splits.flatMap((sp) => (mode[sp].metrics.groups[g] || []).map((r) => r.key)))].sort();
    if (!keys.length) continue;
    const rows = keys.map((k) => [k, ...splits.flatMap((sp) => {
      const r = (mode[sp].metrics.groups[g] || []).find((x) => x.key === k);
      return r ? [sample(r.trades), rr(r.meanR), usd(r.net)] : ['0', '—', '—'];
    })]);
    s += `\n#### ${title}\n\n${table(['', ...splits.flatMap((sp) => [`${sp} trades`, `${sp} mean R`, `${sp} net`])], rows)}`;
  }
  const ex = splits.filter((sp) => mode[sp].metrics.groups.excludingCluster);
  if (ex.length) {
    const clusters = [...new Set(ex.flatMap((sp) => Object.keys(mode[sp].metrics.groups.excludingCluster)))];
    s += `\n#### Excluding a cluster\n\n${table(['Excluded', ...ex.flatMap((sp) => [`${sp} trades`, `${sp} mean R`])],
      clusters.map((c) => [c, ...ex.flatMap((sp) => { const r = mode[sp].metrics.groups.excludingCluster[c]; return r ? [sample(r.trades), rr(r.meanR)] : ['—', '—']; })]))}`;
  }
  return s;
}

function buyHoldTable(mode) {
  const rows = [];
  for (const sp of SPLITS) {
    const r = mode[sp];
    if (!r?.buyAndHold) continue;
    const m = r.metrics, b = r.buyAndHold;
    const sRet = m.returnPct, sDd = m.maxDrawdownPct;
    rows.push([sp, `${m.from} to ${m.to}`, pct(sRet), pct(sDd), num(sDd > 0 ? sRet / sDd : null, 2),
      pct(b.equalWeight?.returnPct), pct(b.equalWeight?.maxDrawdownPct), num(b.equalWeight?.returnPerDrawdown, 2),
      pct(b.spy?.returnPct), pct(b.spy?.maxDrawdownPct), num(b.spy?.returnPerDrawdown, 2)]);
  }
  if (!rows.length) return '';
  const missing = [...new Set(SPLITS.flatMap((sp) => mode[sp]?.buyAndHold?.equalWeightMissing || []))];
  return `${table(['Split', 'Dates', 'Strategy return', 'Strategy max DD', 'Return / DD', 'Equal-weight return', 'EW max DD', 'EW return / DD', 'SPY return', 'SPY max DD', 'SPY return / DD'], rows)}
Buy-and-hold: ${SPLITS.map((sp) => mode[sp]?.buyAndHold?.basis).find(Boolean)}. Informational only; the strategy is mostly in cash, so this is not a pass/fail comparison.${missing.length ? ` No bars in range for: ${missing.join(', ')}.` : ''}\n`;
}

function ambiguitySection(mode, config) {
  const base = config?.simulation?.ambiguity ?? 'stop_first';
  const st = mode.stress;
  const pick = (name) => st?.tests.find((t) => t.name === name)?.metrics;
  const val = { [base]: st?.baseline.metrics, target_first: pick('target-first ambiguity'), tv_path: pick('TradingView path ambiguity') };
  const hv = mode.holdout?.variants;
  const hold = hv ? { stop_first: hv.stopFirst?.metrics, target_first: hv.targetFirst?.metrics, tv_path: hv.tvPath?.metrics } : {};
  const rows = ['stop_first', 'target_first', 'tv_path'].map((k) => [
    k + (k === base ? ' (configured)' : ''),
    val[k] ? sample(val[k].trades) : '—', val[k] ? rr(val[k].meanR) : '—', val[k] ? val[k].ambiguous.count : '—',
    hold[k] ? sample(hold[k].trades) : '—', hold[k] ? rr(hold[k].meanR) : '—', hold[k] ? hold[k].ambiguous.count : '—',
  ]);
  if (!st && !hv) return '';
  return `${table(['Bars touching stop and target resolved by', 'Validation trades', 'Validation mean R', 'Ambiguous exits', 'Holdout trades', 'Holdout mean R', 'Ambiguous exits'], rows)}
Stop-first is the conservative assumption used for the criteria; target-first is an optimistic bound reported as sensitivity only.\n`;
}

const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);

function acceptanceSection(ev) {
  return `Outcome: **${ev.outcome.replace(/_/g, ' ')}** (backtest criteria: ${ev.stages.backtest.replace(/_/g, ' ')}; forward criteria: ${ev.stages.forward.replace(/_/g, ' ')}).${ev.outcomeMeaning ? ` ${cap(ev.outcomeMeaning).replace(/\.$/, '')}.` : ''}\n\n`
    + `${ev.synthetic ? 'The inputs are synthetic, so no criterion is evaluated (the status the code computed is kept in report.json as computedStatus, for testing the evaluator only).\n\n' : ''}${OUTCOME_NOTE}${ev.holdoutContaminated ? ' The holdout result is contaminated (not the first run for this version and config), so the criteria that use it cannot be evaluated.' : ''}\n\n`
    + table(['ID', 'Criterion', 'Status', 'Value', 'Rule', 'Note'], ev.criteria.map((c) => [c.id, c.name, c.status.replace(/_/g, ' '), valueText(c.value), c.rule, c.note || '']));
}

// data.js qualityReport fields worth a column (the full report is in report.json).
const DQ_COLUMNS = ['firstBar', 'lastBar', 'bars', 'sessions', 'missingSessions', 'expectedBars', 'missingBars', 'incompleteSessions', 'duplicates',
  'nonPositivePrices', 'highBelowLow', 'ohlcOutsideRange', 'missingVolume', 'bigMoves', 'dropped_outsideSession', 'dropped_incompleteBuckets', 'rejectedRows', 'ok'];

function dataQualitySection(dq) {
  if (!dq) return '_No data-quality report was supplied._\n';
  const scalars = Object.entries(dq).filter(([, v]) => v == null || typeof v !== 'object');
  let s = scalars.length ? `${scalars.map(([k, v]) => `- ${k}: ${v ?? '—'}`).join('\n')}\n\n` : '';
  const nested = dq.symbols && typeof dq.symbols === 'object' ? dq.symbols : Object.fromEntries(Object.entries(dq).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)));
  const entries = Array.isArray(nested) ? nested.map((v) => [v.symbol ?? '', v]) : Object.entries(nested);
  if (entries.length) {
    const have = new Set(entries.flatMap(([, v]) => Object.entries(v || {}).filter(([k, x]) => k !== 'symbol' && (x == null || typeof x !== 'object')).map(([k]) => k)));
    const known = DQ_COLUMNS.filter((c) => have.has(c));
    const cols = known.length >= 4 ? known : [...have].slice(0, 12);
    s += table(['', ...cols], entries.map(([k, v]) => [k, ...cols.map((c) => (fin(v?.[c]) ? (Number.isInteger(v[c]) ? v[c] : v[c].toFixed(3)) : v?.[c] ?? '—'))]));
  }
  return s || '_Empty data-quality report._\n';
}

function coverageNotes(mode) {
  const lines = [];
  for (const sp of SPLITS) {
    const c = mode[sp]?.dataCoverage;
    if (!c) continue;
    const have = c.symbols.filter((r) => r.bars);
    lines.push(`- ${sp}: ${have.length} of ${c.symbols.length} symbols have bars between ${c.from} and ${c.to}${c.symbolsWithoutBars.length ? ` (none for ${c.symbolsWithoutBars.join(', ')})` : ''}.`);
  }
  return lines.length ? `Data coverage:\n${lines.join('\n')}\n` : '';
}

function splitJson(r) {
  if (!r) return null;
  const { trades, events, equityCurve, ...rest } = r;
  return { ...rest, trades, equityDaily: dailyEquity(equityCurve), eventCounts: (events || []).reduce((a, e) => ({ ...a, [e.type]: (a[e.type] || 0) + 1 }), {}) };
}

// runs: { meta: { synthetic, seed, dataHash, configHash, version, dataSource, generatedAt, command },
//         modes: { intraday|swing: { development, validation, holdout, stress, walkForward, acceptance? } } }
export function buildReport({ runs, acceptance, universe, splits, config, dataQuality = null }) {
  const synthetic = isSynthetic(runs, dataQuality);
  const meta = runs?.meta || {};
  const modes = MODES.filter((m) => runs?.modes?.[m]);
  const evals = {};
  for (const m of modes) {
    const md = runs.modes[m];
    evals[m] = md.acceptance || (acceptance ? evaluateAcceptance({ results: md, acceptance, mode: m, universe }) : null);
  }
  const startEq = config?.risk?.hypotheticalStartingEquity;
  const title = `Strategy Lab backtest — ${config?.label || config?.strategy || 'strategy'} (version ${config?.version ?? meta.version ?? '?'})`;

  const json = clean({
    title, synthetic, banner: synthetic ? SYNTHETIC_BANNER : null,
    simulationOnly: `Simulated, hypothetical account (US$${usdFmt.format(startEq ?? 0)} starting equity). No orders were placed and the real portfolio was not read or changed.`,
    reproducibility: {
      version: config?.version ?? meta.version ?? null, configHash: meta.configHash ?? null, dataHash: meta.dataHash ?? null, lowerTfHash: meta.lowerTfHash ?? null,
      seed: meta.seed ?? null, dataSource: meta.dataSource ?? null, command: meta.command ?? null, generatedAt: meta.generatedAt ?? null,
      universe: universe?.name ?? null, splits: splits?.name ?? null, criteria: acceptance?.name ?? null,
    },
    dataQuality,
    modes: Object.fromEntries(modes.map((m) => {
      const md = runs.modes[m];
      return [m, {
        development: splitJson(md.development), validation: splitJson(md.validation),
        holdout: md.holdout ? { ...splitJson(md.holdout), variants: md.holdout.variants } : null,
        stress: md.stress || null,
        walkForward: md.walkForward ? { ...md.walkForward, oos: { ...md.walkForward.oos, trades: md.walkForward.oos.trades } } : null,
        acceptance: evals[m],
      }];
    })),
  });

  let md = `# ${title}\n\n`;
  if (synthetic) md += `> **${SYNTHETIC_BANNER}.**\n> Every figure below comes from generated prices${meta.seed != null ? ` (seed ${meta.seed})` : ''}. It checks that the code runs; it is not a result for the strategy.\n\n`;
  md += `Simulated, hypothetical account (US$${usdFmt.format(startEq ?? 0)} starting equity, ${config?.costs?.accountCurrency || 'USD'}). No orders were placed and the real portfolio was not read or changed. `
    + 'Figures describe what these rules did on this data under the stated cost and fill assumptions; they are not a forecast and not a recommendation. Sample sizes are given with every figure; small samples say little.\n\n';
  md += '## Reproduce\n\n' + table(['', ''], [
    ['Strategy version', config?.version ?? meta.version], ['Config hash', meta.configHash], ['Data hash', meta.dataHash],
    ...(meta.lowerTfHash ? [['1-minute data hash (stop/target resolution)', meta.lowerTfHash]] : []),
    ['Data', meta.dataSource], ['Synthetic seed', meta.seed ?? '—'], ['Universe / splits / criteria', `${universe?.name ?? '—'} / ${splits?.name ?? '—'} / ${acceptance?.name ?? '—'}`],
    ...((splits?.excludedSessions?.sessions || []).length ? [['Excluded sessions (every symbol)', `${splits.excludedSessions.sessions.map((x) => x.date).join(', ')} (${splits.name}; their bars are removed before the run)`]] : []),
    ['Command', meta.command ? `\`${meta.command}\`` : '—'],
  ]);
  md += `\n## Data quality\n\n${dataQualitySection(dataQuality)}`;

  for (const m of modes) {
    const mode = runs.modes[m];
    const cols = COLS(mode);
    md += `\n## ${m === 'intraday' ? 'Intraday' : 'Swing'} configuration\n\n`;
    if (evals[m]) md += `### Acceptance criteria (${acceptance.name})\n\n${acceptanceSection(evals[m])}\n`;
    if (cols.length) {
      md += `### Results by period\n\n${metricsTable(cols)}\n`;
      md += 'R is net profit after costs divided by the planned risk at entry. Forced closes at the end of the data count in P/L but not in per-trade statistics.\n';
      if (mode.holdout?.contaminated) md += `\nThe holdout column is contaminated: it is holdout run number ${mode.holdout.priorRuns + 1} for this version and config (reason given: "${mode.holdout.reason}"), so it cannot satisfy the acceptance criteria.\n`;
      const cov = coverageNotes(mode);
      if (cov) md += `\n${cov}`;
      md += `\n### Outlier dependence\n\n${outlierTable(cols)}`;
    }
    const amb = ambiguitySection(mode, config);
    if (amb) md += `\n### Ambiguous bars (stop and target in the same bar)\n\n${amb}`;
    if (mode.stress) md += `\n### Stress tests and neighbouring settings (validation ${mode.stress.from} to ${mode.stress.to})\n\n${stressTable(mode.stress)}`;
    if (mode.walkForward) md += `\n### Walk-forward\n\n${walkForwardSection(mode.walkForward)}`;
    const bh = buyHoldTable(mode);
    if (bh) md += `\n### Buy-and-hold comparison\n\n${bh}`;
    const gs = groupSections(mode);
    if (gs) md += `\n### Breakdowns\n\nRegimes use SPY daily closes up to the previous session only. Rows with fewer than ${SMALL_SAMPLE} trades are marked small sample.\n${gs}`;
  }
  if (!modes.length) md += '\n_No runs._\n';
  if (synthetic) md += `\n---\n\n**${SYNTHETIC_BANNER}.**\n`;
  return { json, markdown: md };
}
