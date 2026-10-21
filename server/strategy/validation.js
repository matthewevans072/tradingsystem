// Pre-registered validation for the Strategy Lab (strategy/VALIDATION-PLAN.md):
// chronological splits, stress tests, walk-forward, the holdout guard and the
// acceptance criteria. Simulation only: nothing here places orders or reads
// the real portfolio. The engine is loaded lazily (or injected) so the pure
// parts work and can be tested on their own.
import fs from 'node:fs';
import path from 'node:path';
import { computeMetrics, buyAndHold, etDate, tradeStats, isEndOfData } from './metrics.js';
import { applyOverrides, getPath, configHash as hashConfig } from './config.js';

export const WF_MIN_TRADES = 30; // splits-v1 walkForward.selection
export const OUTCOMES = ['not_eligible', 'inconclusive', 'eligible_for_review'];
export const OUTCOME_NOTE = '"Eligible for review" only means the owner may look at the evidence. It is not permission to trade and does not enable anything.';
// acceptance-v1 B4 "twice the base costs and slippage"; the stress list's own entry is used when present.
const TWICE_COSTS = { name: '2x costs', multiply: { 'costs.commissionPerShare': 2, 'costs.commissionMinPerOrder': 2, 'costs.halfSpreadBps': 2, 'costs.slippageBps': 2 } };

async function engineOf(runBacktest) {
  return runBacktest || (await import('./engine.js')).runBacktest;
}

function hashOf(config, configHash) {
  if (typeof configHash === 'string') return configHash;
  return (configHash || hashConfig)(config);
}

// ---------- settings changes ----------

export { getPath };

// Settings the engine takes as run overrides rather than config (its
// runBacktest overrides); the config hash then stays the baseline's.
const OVERRIDE_PATHS = { 'stress.entryWorseAtr': 'entryWorseAtr', 'simulation.ambiguity': 'ambiguity', 'simulation.entryFill': 'entryFill' };

// change: { set|add|multiply: { 'a.b': v } } (a stress test) or { 'a.b': v } (a neighbour).
// Config changes go through config.js applyOverrides, so they are validated.
export function applyChange(config, change = {}, overrides = {}) {
  const ov = { ...overrides };
  const ops = ['set', 'add', 'multiply'].some((k) => change[k]) ? change : { set: change };
  const cfgOps = {};
  for (const op of ['set', 'add', 'multiply']) {
    for (const [p, v] of Object.entries(ops[op] || {})) {
      const ok = OVERRIDE_PATHS[p];
      if (!ok) { (cfgOps[op] ||= {})[p] = v; continue; }
      const cur = ov[ok] ?? (ok === 'entryWorseAtr' ? getPath(config, p) ?? 0 : getPath(config, p));
      if (op !== 'set' && typeof cur !== 'number') throw new Error(`${p} is not numeric`);
      ov[ok] = op === 'set' ? v : op === 'add' ? cur + v : cur * v;
    }
  }
  return { config: Object.keys(cfgOps).length ? applyOverrides(config, cfgOps) : config, overrides: ov };
}

function describeChange(config, change) {
  const ops = ['set', 'add', 'multiply'].some((k) => change[k]) ? change : { set: change };
  const parts = [];
  for (const [p, v] of Object.entries(ops.set || {})) parts.push(`${p} = ${v}${getPath(config, p) !== undefined ? ` (baseline ${getPath(config, p)})` : ''}`);
  for (const [p, v] of Object.entries(ops.add || {})) parts.push(`${p} + ${v}`);
  for (const [p, v] of Object.entries(ops.multiply || {})) parts.push(`${p} × ${v}`);
  return parts.join(', ');
}

// ---------- runs ----------

export function splitRange(splits, split) {
  const r = splits?.[split];
  if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.from) || !/^\d{4}-\d{2}-\d{2}$/.test(r.to)) throw new Error(`Unknown split "${split}"`);
  return { from: r.from, to: r.to };
}

const startingEquityOf = (config) => config?.risk?.hypotheticalStartingEquity;
const barsOf = (bars, sym) => (bars instanceof Map ? bars.get(sym) : bars?.[sym]) || [];

// Options passed through to every engine run of a split, stress test or fold.
const passOpts = ({ runBacktest, lowerTf, warmupFrom, synthetic } = {}) => ({ runBacktest, lowerTf, warmupFrom, synthetic });

// Bars per symbol inside [from, to] (ET session dates), so a report can say
// when a period is not covered by the data instead of showing zero trades.
export function dataCoverage(bars, symbols, from, to) {
  const rows = symbols.map((symbol) => {
    let n = 0, first = null, last = null;
    for (const b of barsOf(bars, symbol)) {
      const d = etDate(b.t);
      if (d < from || d > to) continue;
      n++; first ??= d; last = d;
    }
    return { symbol, bars: n, from: first, to: last };
  });
  return { from, to, symbols: rows, symbolsWithoutBars: rows.filter((r) => !r.bars).map((r) => r.symbol) };
}

// One engine run that warms up from the start of the warm-up period, only
// opens trades from tradeFrom and stops at `to` (open positions close there).
async function runRange({ config, mode, bars, symbols, from, to, tradeFrom, overrides = {}, lowerTf, runBacktest, universe, regimes, synthetic = false, extras = true }) {
  const engine = await engineOf(runBacktest);
  const run = await engine({ config, mode, bars, symbols, from, to, tradeFrom, overrides, lowerTf, synthetic });
  const trades = run.trades || [];
  const equityCurve = run.equityCurve || [];
  const startingEquity = startingEquityOf(config);
  const metrics = computeMetrics({
    trades, equityCurve, startingEquity, from: tradeFrom, to,
    groups: extras && (universe || regimes) ? { universe, regimeAt: regimes?.regimeAt } : null,
    bootstrap: extras ? {} : false, // variant runs (stress, grid, folds) show no interval
  });
  const out = {
    mode, from: tradeFrom, to, warmupFrom: from, overrides,
    meta: run.meta || {}, configHash: run.meta?.configHash ?? null, synthetic: !!(synthetic || run.meta?.synthetic),
    trades, events: run.events || [], equityCurve, metrics,
  };
  if (extras) {
    out.dataCoverage = dataCoverage(bars, symbols, tradeFrom, to);
    out.buyAndHold = buyAndHold({ bars, symbols, from: tradeFrom, to, startingEquity });
  }
  return out;
}

// Warm-up starts at splits.warmup.from (or warmupFrom) so every split sees the
// same indicator history; trades are opened only from the split's start.
export async function runSplit({ config, mode, bars, symbols, split, splits, overrides = {}, ...rest }) {
  if (split === 'holdout' && !rest.holdoutGuarded) throw new Error('The holdout is run only through runHoldout (one clean run per version).');
  const range = splitRange(splits, split);
  const { holdoutGuarded, warmupFrom, ...opts } = rest;
  const wf = warmupFrom ?? splits.warmup?.from ?? range.from;
  const r = await runRange({ config, mode, bars, symbols, from: wf < range.from ? wf : range.from, to: range.to, tradeFrom: range.from, overrides, ...opts });
  return { split, ...r };
}

function slim(r) {
  return { configHash: r.configHash, overrides: r.overrides, synthetic: r.synthetic, metrics: r.metrics };
}

export function stressList(config, acceptance) {
  const st = acceptance?.stressTests;
  if (!st) throw new Error('acceptance has no stressTests');
  return [
    ...(st.costs || []).map((c) => ({ group: 'costs', name: c.name, change: c })),
    ...(st.fills || []).map((c) => ({ group: 'fills', name: c.name, change: c })),
    ...(st.neighbours || []).map((n) => ({ group: 'neighbours', name: describeChange(config, n), change: n })),
  ].map((t) => ({ ...t, description: describeChange(config, t.change) }));
}

// Every stress test and neighbour of acceptance-v1, on the validation split.
export async function runStress({ config, mode, bars, symbols, splits, acceptance, overrides = {}, baseline = null, ...rest }) {
  const opts = { ...passOpts(rest), extras: false };
  const range = splitRange(splits, 'validation');
  const base = baseline || await runSplit({ config, mode, bars, symbols, split: 'validation', splits, overrides, ...opts });
  const tests = [];
  for (const t of stressList(config, acceptance)) {
    const ch = applyChange(config, t.change, overrides);
    const r = await runSplit({ config: ch.config, mode, bars, symbols, split: 'validation', splits, overrides: ch.overrides, ...opts });
    tests.push({ group: t.group, name: t.name, description: t.description, ...slim(r) });
  }
  return { split: 'validation', mode, from: range.from, to: range.to, baseline: slim(base), tests, synthetic: base.synthetic || tests.some((t) => t.synthetic) };
}

// ---------- walk-forward ----------

export function quarters(from, to) {
  const out = [];
  let y = +from.slice(0, 4), q = Math.floor((+from.slice(5, 7) - 1) / 3);
  for (;;) {
    const qFrom = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
    if (qFrom > to) break;
    const em = q * 3 + 3;
    const qTo = `${y}-${String(em).padStart(2, '0')}-${String(new Date(Date.UTC(y, em, 0)).getUTCDate()).padStart(2, '0')}`;
    out.push({ label: `${y} Q${q + 1}`, from: qFrom < from ? from : qFrom, to: qTo > to ? to : qTo });
    if (++q === 4) { q = 0; y++; }
  }
  return out;
}

export function gridPoints(grid) {
  let pts = [{}];
  for (const [p, vals] of Object.entries(grid || {})) pts = pts.flatMap((pt) => vals.map((v) => ({ ...pt, [p]: v })));
  return pts;
}

const pointLabel = (pt) => Object.entries(pt).map(([k, v]) => `${k}=${v}`).join(', ');

// Out-of-sample quarters with the grid point chosen on the previous in-sample
// quarters. In-sample expectancy comes from one continuous run per grid point
// over the walk-forward range, counting trades entered in the in-sample
// quarters that also exited before the out-of-sample quarter began, so the
// choice uses no later data. Each out-of-sample quarter is a separate run of
// the chosen setting (fresh simulated account, positions closed at quarter end).
export async function runWalkForward({ config, mode, bars, symbols, splits, overrides = {}, ...rest }) {
  const wf = splits?.walkForward;
  if (!wf) throw new Error('splits has no walkForward section');
  const nIn = wf.inSampleQuarters, nOut = wf.outOfSampleQuarters;
  const qs = quarters(wf.range.from, wf.range.to);
  const { warmupFrom: w0, ...opts } = passOpts(rest);
  const w = w0 ?? splits.warmup?.from ?? wf.range.from;
  const warmupFrom = w < wf.range.from ? w : wf.range.from;
  const base = { mode, bars, symbols, overrides, ...opts, extras: false };
  const startingEquity = startingEquityOf(config);

  const gridRuns = [];
  for (const point of gridPoints(wf.grid)) {
    const cfg = applyChange(config, { set: point }).config;
    const r = await runRange({ ...base, config: cfg, from: warmupFrom, to: wf.range.to, tradeFrom: wf.range.from });
    gridRuns.push({ point, config: cfg, trades: r.trades.filter((t) => !isEndOfData(t)) });
  }

  const folds = [];
  for (let i = nIn; i + nOut <= qs.length; i += nOut) {
    const isFrom = qs[i - nIn].from, isTo = qs[i - 1].to;
    const oos = { from: qs[i].from, to: qs[i + nOut - 1].to };
    const candidates = gridRuns.map((g) => {
      const ts = g.trades.filter((t) => { const e = etDate(t.entry?.at), x = etDate(t.exit?.at); return e >= isFrom && e <= isTo && x < oos.from; });
      return { point: g.point, label: pointLabel(g.point), ...tradeStats(ts), config: g.config };
    });
    const eligible = candidates.filter((c) => c.trades >= WF_MIN_TRADES && c.meanR != null);
    // Highest in-sample mean R; ties keep grid order.
    const best = eligible.reduce((b, c) => (!b || c.meanR > b.meanR ? c : b), null);
    const cfg = best ? best.config : config;
    const r = await runRange({ ...base, config: cfg, from: warmupFrom, to: oos.to, tradeFrom: oos.from });
    folds.push({
      label: qs[i].label + (nOut > 1 ? `–${qs[i + nOut - 1].label}` : ''),
      inSample: { from: isFrom, to: isTo }, outOfSample: oos,
      candidates: candidates.map(({ config: _c, ...c }) => c),
      chosen: best ? { point: best.point, label: best.label, baseline: false, inSampleTrades: best.trades, inSampleMeanR: best.meanR }
        : { point: null, label: 'baseline', baseline: true, reason: `no grid point had at least ${WF_MIN_TRADES} in-sample trades` },
      configHash: r.configHash,
      oosRun: r,
    });
  }
  if (!folds.length) throw new Error('walk-forward range is too short for one out-of-sample fold');

  // Concatenate out-of-sample quarters; equity is chained so each quarter's
  // percentage moves compound from where the previous quarter ended.
  const chained = [];
  let level = startingEquity;
  for (const f of folds) {
    const pts = f.oosRun.equityCurve.filter((p) => { const d = etDate(p.t); return d >= f.outOfSample.from && d <= f.outOfSample.to; });
    const k = level / startingEquity;
    for (const p of pts) chained.push({ ...p, equity: p.equity * k, cash: p.cash != null ? p.cash * k : p.cash, grossExposure: p.grossExposure != null ? p.grossExposure * k : p.grossExposure });
    if (pts.length) level = pts[pts.length - 1].equity * k;
  }
  const oosTrades = folds.flatMap((f) => f.oosRun.trades);
  const oosFrom = folds[0].outOfSample.from, oosTo = folds[folds.length - 1].outOfSample.to;
  const oosMetrics = computeMetrics({ trades: oosTrades, equityCurve: chained, startingEquity, from: oosFrom, to: oosTo });
  const baseline = await runRange({ ...base, config, from: warmupFrom, to: oosTo, tradeFrom: oosFrom });

  return {
    mode, range: wf.range, inSampleQuarters: nIn, outOfSampleQuarters: nOut, grid: wf.grid, minInSampleTrades: WF_MIN_TRADES,
    folds: folds.map(({ oosRun, ...f }) => ({ ...f, oos: { ...tradeStats(oosRun.trades.filter((t) => !isEndOfData(t))), returnPct: oosRun.metrics.returnPct } })),
    oos: { from: oosFrom, to: oosTo, trades: oosTrades, metrics: oosMetrics },
    baseline: { from: oosFrom, to: oosTo, configHash: baseline.configHash, metrics: baseline.metrics },
    synthetic: folds.some((f) => f.oosRun.synthetic) || baseline.synthetic,
    method: 'In-sample expectancy per fold from one continuous run per grid point (trades entered in the in-sample quarters and closed before the out-of-sample quarter); each out-of-sample quarter is a separate run of the chosen setting with a fresh simulated account.',
  };
}

// ---------- holdout ----------

export class HoldoutRefused extends Error {}

export function memoryLedger(entries = []) {
  return {
    entries,
    count: (version, configHash, mode) => entries.filter((e) => e.version === version && e.configHash === configHash && e.mode === mode).length,
    record: (e) => { entries.push(e); return e; },
  };
}

// File-based ledger for the command-line runner. An unreadable ledger is an
// error (fail closed), never treated as empty.
export function createFileLedger(file) {
  const read = () => {
    if (!fs.existsSync(file)) return { name: 'holdout-ledger', entries: [] };
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(j?.entries)) throw new Error(`${file} is not a holdout ledger`);
    return j;
  };
  return {
    file,
    entries: () => read().entries,
    count: (version, configHash, mode) => read().entries.filter((e) => e.version === version && e.configHash === configHash && e.mode === mode).length,
    record: (e) => {
      const j = read();
      j.entries.push(e);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(j, null, 2)}\n`);
      fs.renameSync(`${file}.tmp`, file);
      return e;
    },
  };
}

// One clean holdout evaluation per version, config hash and mode. Later runs
// need a written reason and are marked contaminated. The base run plus the
// variants the criteria need (2x costs; ambiguity sensitivity) are one
// evaluation and one ledger record, written once the runs have finished.
export async function runHoldout({ config, mode, bars, symbols, splits, acceptance, ledger, reason = '', at, configHash, universe, regimes, ...rest }) {
  if (!ledger || typeof ledger.count !== 'function' || typeof ledger.record !== 'function') throw new Error('runHoldout needs a holdout ledger');
  if (!at) throw new Error('runHoldout needs the run time (at) for the ledger');
  const version = config.version;
  const hash = hashOf(config, configHash);
  const prior = await ledger.count(version, hash, mode);
  const why = String(reason || '').trim();
  if (prior > 0 && !why) {
    throw new HoldoutRefused(`The holdout has already been run ${prior} time${prior > 1 ? 's' : ''} for version ${version} (config ${hash.slice(0, 12)}) in ${mode} mode. Another run needs a written reason and its result will be marked contaminated: it cannot satisfy the acceptance criteria.`);
  }
  const contaminated = prior > 0;
  const common = { mode, bars, symbols, split: 'holdout', splits, ...passOpts(rest), holdoutGuarded: true };
  const base = await runSplit({ ...common, config, universe, regimes });
  const variant = async (change) => {
    const ch = applyChange(config, change);
    return slim(await runSplit({ ...common, config: ch.config, overrides: ch.overrides, extras: false }));
  };
  const twice = acceptance?.stressTests?.costs?.find((c) => c.name === TWICE_COSTS.name) || TWICE_COSTS;
  const amb = config.simulation?.ambiguity ?? 'stop_first';
  const variants = {
    costs2x: await variant(twice),
    stopFirst: amb === 'stop_first' ? slim(base) : await variant({ set: { 'simulation.ambiguity': 'stop_first' } }),
    targetFirst: amb === 'target_first' ? slim(base) : await variant({ set: { 'simulation.ambiguity': 'target_first' } }),
    tvPath: amb === 'tv_path' ? slim(base) : await variant({ set: { 'simulation.ambiguity': 'tv_path' } }),
  };
  const entry = { version, configHash: hash, mode, at, reason: why || null, contaminated, priorRuns: prior, synthetic: base.synthetic };
  await ledger.record(entry);
  return { ...base, version, contaminated, priorRuns: prior, reason: why || null, ledgerEntry: entry, variants };
}

// ---------- acceptance ----------

const P = 'pass', F = 'fail', NE = 'not_evaluable';
const all3 = (...ss) => (ss.includes(F) ? F : ss.includes(NE) ? NE : P);
const check = (v, ok) => (v == null || Number.isNaN(v) ? NE : ok(v) ? P : F);

function pfCheck(m, min) {
  if (!m || !m.trades) return NE;
  if (m.profitFactor == null) return m.grossProfit > 0 ? P : NE; // no losing trades: unbounded
  return m.profitFactor >= min ? P : F;
}

function outcomeOf(criteria) {
  const s = criteria.map((c) => c.status);
  return s.includes(F) ? 'not_eligible' : s.includes(NE) ? 'inconclusive' : 'eligible_for_review';
}

function addMonths(date, n) {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, d));
  return t.toISOString().slice(0, 10);
}

// results: { validation, holdout, stress, walkForward, forward } as returned by
// runSplit / runHoldout / runStress / runWalkForward (forward: { trades,
// startedAt, asOf, signals: { total, staleOrError }, duplicates }).
export function evaluateAcceptance({ results = {}, acceptance, mode, universe = null }) {
  if (acceptance?.name !== 'acceptance-v1') throw new Error(`No evaluator for criteria "${acceptance?.name}"; this code implements acceptance-v1`);
  const val = results.validation?.metrics || null;
  const h = results.holdout || null;
  const hNote = !h ? 'holdout not run' : h.contaminated ? 'holdout result is contaminated (not the first run for this version and config), so it cannot satisfy the criteria' : null;
  const hold = h && !h.contaminated ? h : null;
  const hm = hold?.metrics || null;
  const missing = (what) => `${what} not available`;

  const exCluster = (() => {
    const g = hm?.groups?.excludingCluster?.ai_tech;
    if (g) return g;
    if (!hold?.trades || !universe) return null;
    const ai = new Set(universe.symbols.filter((s) => s.cluster === 'ai_tech').map((s) => s.symbol));
    return tradeStats(hold.trades.filter((t) => !isEndOfData(t) && !ai.has(t.symbol)));
  })();
  const neighbours = (results.stress?.tests || []).filter((t) => t.group === 'neighbours');
  const nExpected = acceptance.stressTests?.neighbours?.length || 0;
  const nPositive = neighbours.filter((t) => t.metrics?.meanR > 0).length;
  const stopFirst = hold?.variants?.stopFirst?.metrics || null;
  const twice = hold?.variants?.costs2x?.metrics || null;
  const wf = results.walkForward?.oos?.metrics || null;
  const share = hm?.outliers?.largestSymbol?.shareOfNet;

  const ev = {
    B1: () => {
      const v = { holdoutTrades: hm?.trades ?? null, validationTrades: val?.trades ?? null };
      const st = hm && val ? (v.holdoutTrades >= 100 && v.validationTrades >= 60 ? P : NE) : NE;
      return { status: st, value: v, note: st === NE ? hNote || (!val ? missing('validation') : 'too few trades to judge: inconclusive') : null };
    },
    B2: () => ({
      status: all3(check(val?.meanR, (x) => x > 0.1), check(hm?.meanR, (x) => x > 0.1)),
      value: { validationMeanR: val?.meanR ?? null, holdoutMeanR: hm?.meanR ?? null }, note: hNote,
    }),
    B3: () => ({ status: check(hm?.meanRCI?.lower, (x) => x > 0), value: hm?.meanRCI ? { lower: hm.meanRCI.lower, upper: hm.meanRCI.upper, n: hm.meanRCI.n, resamples: hm.meanRCI.resamples, seed: hm.meanRCI.seed } : null, note: hNote || (hm && hm.meanRCI?.lower == null ? 'needs at least 2 trades' : null) }),
    B4: () => ({
      status: all3(pfCheck(hm, 1.2), pfCheck(twice, 1.0)),
      value: { profitFactor: hm?.profitFactor ?? null, profitFactor2xCosts: twice?.profitFactor ?? null }, note: hNote || (hm && !twice ? missing('2x-cost holdout run') : null),
    }),
    B5: () => ({ status: check(hm?.maxDrawdownPct, (x) => x <= 10), value: { maxDrawdownPct: hm?.maxDrawdownPct ?? null }, note: hNote }),
    B6: () => ({
      status: all3(check(hm?.outliers?.meanRWithoutBest5Pct, (x) => x >= 0), check(share, (x) => x <= 0.4)),
      value: { meanRWithoutBest5Pct: hm?.outliers?.meanRWithoutBest5Pct ?? null, removed: hm?.outliers?.best5PctCount ?? null, largestSymbol: hm?.outliers?.largestSymbol ?? null },
      note: hNote || (hm && share == null ? 'symbol shares are undefined when net profit is not positive' : null),
    }),
    B7: () => ({ status: check(exCluster?.trades ? exCluster.meanR : null, (x) => x >= 0), value: exCluster ? { trades: exCluster.trades, meanR: exCluster.meanR } : null, note: hNote || (hm && !exCluster ? 'universe needed to identify the ai_tech cluster' : null) }),
    B8: () => {
      if (!nExpected || neighbours.length !== nExpected) return { status: NE, value: { evaluated: neighbours.length, expected: nExpected }, note: missing('neighbour stress runs') };
      const frac = nPositive / nExpected;
      return { status: frac >= 0.7 ? P : F, value: { positive: nPositive, of: nExpected, share: frac }, note: 'a neighbour with no trades counts as not positive' };
    },
    B9: () => ({ status: check(stopFirst?.meanR, (x) => x > 0), value: { stopFirstMeanR: stopFirst?.meanR ?? null, targetFirstMeanR: hold?.variants?.targetFirst?.metrics?.meanR ?? null, tvPathMeanR: hold?.variants?.tvPath?.metrics?.meanR ?? null }, note: hNote }),
    B10: () => ({ status: check(wf?.meanR, (x) => x > 0), value: { oosTrades: wf?.trades ?? null, oosMeanR: wf?.meanR ?? null }, note: wf ? null : missing('walk-forward') }),
  };

  const fw = results.forward || null;
  const fNote = 'forward test not run';
  const ft = fw ? (fw.trades || []).filter((t) => !isEndOfData(t)) : [];
  const fStats = fw ? tradeStats(ft) : null;
  const evF = {
    F1: () => {
      if (!fw) return { status: NE, value: null, note: fNote };
      const months = fw.startedAt && fw.asOf ? addMonths(fw.startedAt, 3) <= fw.asOf.slice(0, 10) : false;
      return { status: ft.length >= 100 && months ? P : NE, value: { trades: ft.length, startedAt: fw.startedAt ?? null, asOf: fw.asOf ?? null }, note: ft.length >= 100 && months ? null : 'milestone not reached: inconclusive' };
    },
    F2: () => {
      if (!fw) return { status: NE, value: null, note: fNote };
      const ids = [...new Set((fw.trades || []).map((t) => `${t.version}|${t.configHash}`))];
      return { status: ids.length <= 1 && !fw.ruleChanged ? P : F, value: { versions: ids } };
    },
    F3: () => {
      if (!fw) return { status: NE, value: null, note: fNote };
      const ci = hm?.meanRCI;
      const m = fStats.meanR;
      if (m == null) return { status: NE, value: null, note: 'no forward trades' };
      if (m <= 0) return { status: F, value: { forwardMeanR: m } };
      if (ci?.lower == null) return { status: NE, value: { forwardMeanR: m }, note: hNote || 'holdout interval not available' };
      return { status: m >= ci.lower && m <= ci.upper ? P : F, value: { forwardMeanR: m, holdoutLower: ci.lower, holdoutUpper: ci.upper } };
    },
    F4: () => {
      if (!fw) return { status: NE, value: null, note: fNote };
      const tot = fw.signals?.total, bad = fw.signals?.staleOrError;
      if (!(tot > 0) || bad == null || fw.duplicates == null) return { status: NE, value: null, note: missing('signal counts') };
      return { status: bad / tot <= 0.05 && fw.duplicates === 0 ? P : F, value: { staleOrErrorShare: bad / tot, duplicates: fw.duplicates } };
    },
  };

  // Generated prices test the code only: they can neither satisfy nor fail a
  // criterion. The computed status is kept for checking the evaluator.
  const synthetic = ['validation', 'holdout', 'stress', 'walkForward', 'forward'].some((k) => results[k]?.synthetic) || !!results.synthetic;
  const criteria = [];
  for (const [stage, list, fns] of [['backtest', acceptance.backtest || [], ev], ['forward', acceptance.forward || [], evF]]) {
    for (const c of list) {
      const r = fns[c.id] ? fns[c.id]() : { status: NE, value: null, note: 'no evaluator for this criterion' };
      // Criteria marked onFail "inconclusive" (too few trades) never count as a failure.
      const status = c.onFail === 'inconclusive' && r.status === F ? NE : r.status;
      criteria.push(synthetic
        ? { id: c.id, name: c.name, stage, status: NE, computedStatus: status, value: r.value ?? null, rule: c.rule, note: 'synthetic data: cannot satisfy or fail a criterion' }
        : { id: c.id, name: c.name, stage, status, value: r.value ?? null, rule: c.rule, note: r.note || null });
    }
  }
  const outcome = outcomeOf(criteria);
  return {
    criteriaVersion: acceptance.name, mode, synthetic,
    criteria, outcome, outcomeMeaning: acceptance.outcomes?.[outcome] ?? null,
    stages: { backtest: outcomeOf(criteria.filter((c) => c.stage === 'backtest')), forward: outcomeOf(criteria.filter((c) => c.stage === 'forward')) },
    holdoutContaminated: !!h?.contaminated,
    note: OUTCOME_NOTE,
  };
}
