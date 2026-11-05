// The research runner: campaigns, the persistent job queue, the worker loop, the evaluation of every experiment
// against the campaign's fixed baseline, and the notifications (strategy/research-runner/CAMPAIGN-1.md).
// A simulation only. It reuses the range-trend engine, metrics and benchmark (a) on HXR's development-period
// market data, opened read-only by real path, built once per worker process. It never reads real holdings or
// cash, never places an order, never sends anything outside the app, and never opens any window but the
// development period (config.js assertDevelopmentPeriod, checked before every run). A development leader is a
// development result, never a validated strategy; the label "independently evaluated" is never set here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig as loadAppConfig } from '../config.js';
import { canonicalJson } from '../strategy/config.js';
import * as hxrStore from '../hxr/store.js';
import { loadHxrUniverse, loadHxrPeriods, basketSymbols, excludedDates, halfSpreadFor } from '../hxr/config.js';
import { buildInputs, buildSpreadTable, halfSpreadFn, readiness } from '../hxr/data.js';
import { runBacktest, ENGINE_VERSION as RT_ENGINE_VERSION } from '../rangetrend/engine.js';
import { CODE_REVISION as RT_CODE_REVISION } from '../rangetrend/config.js';
import { computeMetrics } from '../rangetrend/metrics.js';
import { holdIndex, INDEX_METHOD } from '../rangetrend/benchmark.js';
import * as store from './store.js';
import { CODE_REVISION, RUNNER_VERSION, LIMITS, CRITERIA, LABELS, STAGES, BASELINE_FILE, developmentPeriod, assertDevelopmentPeriod, campaignDocStatus, CAMPAIGN_DOC, LOG_DIR_NAME } from './config.js';
import { plannedExperiments, combinationStage } from './space.js';

export class ResearchError extends Error { constructor(status, message) { super(message); this.status = status; } }

export const EXPECTED_BASELINE_NET = 1757.90; // practice run 6 (2026-11-04, range-trend log row 23): the baseline must reproduce it

// ---------- small helpers ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const round2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const symbolsHashOf = (symbols) => crypto.createHash('sha256').update(canonicalJson(symbols.map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi })))).digest('hex');

// ---------- market data (read-only, development period only, built once per process) ----------
export function loadDevelopmentInputs({ dataDir, floorBps = 2 }) {
  const hxrFile = path.join(dataDir, hxrStore.HXR_DB_NAME);
  if (!fs.existsSync(hxrFile)) throw new ResearchError(409, `No HXR market data at ${path.basename(hxrFile)}: download it through the HXR page first.`);
  const realHxr = fs.realpathSync(hxrFile);
  if (realHxr !== path.join(fs.realpathSync(dataDir), hxrStore.HXR_DB_NAME)) throw new ResearchError(409, `${path.basename(hxrFile)} must be the file itself in the data directory, not a link to ${realHxr}.`);
  const hdb = hxrStore.openHxrDb(realHxr, { readOnly: true });
  try {
    const universe = loadHxrUniverse(), periods = loadHxrPeriods();
    const pr = developmentPeriod();
    const ready = readiness(hdb, { universe, periods, reviewed: hxrStore.getSetting(hdb, 'reviewedMoves', []) });
    const p = ready.periods.development;
    if (!p?.usable) throw new ResearchError(409, `The HXR development period is not ready: ${(p?.reasons || []).slice(0, 5).join('; ')}`);
    const spread = buildSpreadTable(hdb, universe, { floorBps, toYear: Number(pr.end.slice(0, 4)) });
    const unc = p.members.filter((m) => spread.firstSampled[m.symbol] == null).map((m) => m.symbol);
    if (!p.costsCalibrated || unc.length) throw new ResearchError(409, `The HXR development period has no spread calibration for ${unc.join(', ') || 'every stock'}`);
    const symbols = basketSymbols(universe, pr.basket);
    const inputs = buildInputs(hdb, { universe, symbols: symbols.map((s) => s.symbol), warmupFrom: pr.warmupFrom, end: pr.end, excludedSessions: excludedDates(periods), spreadTable: spread, start: pr.start });
    const last = inputs.sessions.at(-1);
    if (last > pr.end) throw new ResearchError(500, `inputs hold a session after the development period end (${last} > ${pr.end})`);
    return { inputs, calibrated: halfSpreadFn(spread), period: pr, symbolsHash: symbolsHashOf(inputs.symbols), dataHash: inputs.dataHash, calibrationHash: inputs.calibrationHash, readiness: { usable: true, costsCalibrated: true, members: p.members.length } };
  } finally { try { hdb.close(); } catch { /* ignore */ } }
}

// ---------- the random-timing null (CAMPAIGN-1.md section 6) ----------
// Each completed trade (and each position open at the end) keeps its stock, shares and sessions held and is
// moved to a random decision session of the development period: entry at the next session's open plus the
// spread and slippage of that day, exit at the open of the session `sessionsHeld` later minus them (an open
// position exits at that session's close). The statistic is trade-timing P/L: shares x (exit - entry), spread and
// slippage included, SEC/TAF fees and dividends excluded, computed the same way for the run's own trades.
export function nullTest(result, { inputs, calibrated, config, period, resamples = CRITERIA.nullResamples, seed = CRITERIA.nullSeed }) {
  const sessions = inputs.sessions;
  const startIdx = sessions.findIndex((d) => d >= period.start);
  if (startIdx < 0) return { p: null, resamples: 0, reason: 'no session in the period' };
  const kOf = (sym, date) => (Math.max(config.costs.halfSpreadFloorBps, calibrated(sym, date)) + config.costs.slippageBps) / 10000;
  const bar = (sym, i) => inputs.days.get(sessions[i])?.bars?.[sym] ?? null;
  const items = [
    ...result.trades.map((t) => ({ symbol: t.symbol, shares: t.shares, held: Math.max(1, t.sessionsHeld ?? 1), open: false, timing: t.shares * (t.exitPrice - t.entryPrice) })),
    ...result.openPositions.map((p) => ({ symbol: p.symbol, shares: p.shares, held: Math.max(1, p.sessionsHeld ?? 1), open: true, timing: p.shares * (p.markPrice - p.entryPrice) })),
  ];
  if (!items.length) return { p: null, resamples: 0, reason: 'no trades' };
  const actual = items.reduce((a, t) => a + t.timing, 0);
  const rand = mulberry32(seed);
  const lastIdx = sessions.length - 1;
  const dist = new Array(resamples);
  let skipped = 0;
  for (let r = 0; r < resamples; r++) {
    let total = 0;
    for (const t of items) {
      let placed = false;
      for (let tries = 0; tries < 50 && !placed; tries++) {
        const span = lastIdx - t.held - 1 - startIdx;
        if (span < 0) break;
        const i = startIdx + Math.floor(rand() * (span + 1));
        const e = bar(t.symbol, i + 1), x = bar(t.symbol, i + 1 + t.held);
        if (!e || !x) continue;
        const entry = e.o * (1 + kOf(t.symbol, sessions[i + 1]));
        const exit = t.open ? x.c : x.o * (1 - kOf(t.symbol, sessions[i + 1 + t.held]));
        total += t.shares * (exit - entry);
        placed = true;
      }
      if (!placed) skipped++;
    }
    dist[r] = total;
  }
  dist.sort((a, b) => a - b);
  const atOrAbove = dist.filter((v) => v >= actual - 1e-9).length;
  const q = (f) => dist[Math.min(dist.length - 1, Math.max(0, Math.ceil(f * dist.length) - 1))];
  return { p: (1 + atOrAbove) / (1 + resamples), atOrAbove, resamples, seed, actualTimingPnl: round2(actual), items: items.length, skippedPlacements: skipped, percentiles: { p5: round2(q(0.05)), p50: round2(q(0.5)), p95: round2(q(0.95)), p99: round2(q(0.99)) }, method: 'random-timing null: same stock, shares and sessions held; entry at a random session\'s next open; spread and slippage included, fees and dividends excluded' };
}

// ---------- accounting checks ----------
export function accountingCheck(result, metrics, { tolerance = CRITERIA.reconcileToleranceUsd } = {}) {
  const problems = [];
  const eq = result.equity || [];
  if (!eq.length) problems.push('no equity points');
  for (const p of eq) { if (!Number.isFinite(p.equity) || !Number.isFinite(p.cash)) { problems.push(`non-finite equity on ${p.date}`); break; } if (p.cash < -1e-6) { problems.push(`cash below zero on ${p.date}`); break; } }
  const last = eq.at(-1);
  if (last && Math.abs(last.equity - metrics.endValue) > tolerance) problems.push(`end value ${metrics.endValue} differs from the last equity point ${last.equity}`);
  // The stored trade P/L (metrics.netTradePnl, the sum of pnlTotal) already holds each trade's post-exit
  // dividends, so they are counted once here (campaign 1 stopped on a check that added them twice:
  // EXPERIMENT-LOG.md entry 2).
  const openPnl = (result.openPositions || []).reduce((a, p) => a + (p.pnl ?? 0), 0);
  const expected = (metrics.netTradePnl ?? 0) + openPnl;
  const net = metrics.endValue - metrics.startValue;
  const diff = net - expected;
  if (Math.abs(diff) > tolerance) problems.push(`net P/L ${round2(net)} does not reconcile with trade P/L (post-exit dividends included) + open P/L ${round2(expected)} (difference ${round2(diff)})`);
  if (!(metrics.costs >= 0)) problems.push('costs are negative or missing');
  return { ok: !problems.length, problems, reconciliation: { net: round2(net), tradePnl: round2(metrics.netTradePnl), openPnl: round2(openPnl), postExitPaid: round2(metrics.postExitPaid), difference: round2(diff) } };
}

// ---------- the summary and the comparison with the baseline ----------
export function summarise(result, metrics, { nullResult, accounting, index }) {
  const g = metrics.pick?.grossGain ?? metrics.tier2?.grossGain ?? null;
  const em = metrics.benchmarks?.exposureMatched ?? null;
  const bh = metrics.benchmarks?.buyAndHold ?? null;
  return {
    startValue: round2(metrics.startValue), endValue: round2(metrics.endValue), net: round2(metrics.endValue - metrics.startValue),
    totalReturnPct: round2(metrics.totalReturnPct), annualisedReturnPct: round2(metrics.annualisedReturnPct), maxDrawdownPct: round2(metrics.maxDrawdownPct), maxDrawdownUsd: round2(metrics.maxDrawdownUsd),
    avgInvestedPct: round2(metrics.avgInvestedPct), timeInCashPct: round2(metrics.timeInCashPct), turnoverPerYear: round2(metrics.turnoverPerYear), costs: round2(metrics.costs),
    completedTrades: metrics.completedTrades, openAtEnd: metrics.openAtEnd, skips: metrics.skips, sessions: metrics.sessions, years: metrics.years,
    topStock: g?.maxSymbol ? { symbol: g.maxSymbol, share: g.maxShare, pnl: round2(g.perStock?.[g.maxSymbol]?.pnl) } : null, grossGain: round2(g?.grossGain), winners: g?.winners ?? null,
    exposureMatched: em ? { endValue: round2(em.endValue), net: round2(em.endValue - metrics.startValue), annualisedReturnPct: round2(em.annualisedReturnPct), maxDrawdownPct: round2(em.maxDrawdownPct) } : null,
    index: bh ? { endValue: round2(bh.endValue), net: round2(bh.endValue - metrics.startValue), annualisedReturnPct: round2(bh.annualisedReturnPct), maxDrawdownPct: round2(bh.maxDrawdownPct) } : null,
    bestFive: metrics.pick?.bestFive ? { K: metrics.pick.bestFive.K, n: metrics.pick.bestFive.n, removedPL: round2(metrics.pick.bestFive.removedPL), adjustedNet: round2(metrics.pick.bestFive.adjustedNetPL) } : null,
    nullTest: nullResult, accounting,
    exits: metrics.exits, breaks: metrics.breaks, skipsByCode: metrics.skipsByCode, hypotheses: metrics.hypotheses,
  };
}

// The comparison with the fixed baseline and the campaign criteria; also against the current leader.
export function compare(summary, { baseline, leader = null, criteria = CRITERIA, dataQualityOk = true }) {
  const out = { baselineExperimentId: baseline?.id ?? null, baselineNet: baseline?.summary?.net ?? null, diffUsd: null, improvementPct: null, improvementApplicable: false, exposureGainUsd: null, decisionGainUsd: null, vsLeader: null, criteria: {}, failed: [], clearsTarget: false, shortlisted: false, labels: [LABELS.DEVELOPMENT], why: [] };
  const c = out.criteria;
  if (baseline?.summary) {
    const b = baseline.summary;
    out.diffUsd = round2(summary.net - b.net);
    const meaningful = b.net > 0 && b.net >= 100; // a positive baseline of at least $100: a ratio means something
    out.improvementApplicable = meaningful;
    out.improvementPct = meaningful ? round2(((summary.net - b.net) / b.net) * 100) : null;
    if (summary.exposureMatched && b.exposureMatched) {
      out.exposureGainUsd = round2(summary.exposureMatched.net - b.exposureMatched.net);
      out.decisionGainUsd = round2(out.diffUsd - out.exposureGainUsd);
    }
    c.improvement = { ok: meaningful ? summary.net >= b.net * (1 + criteria.improvement) : false, value: out.improvementPct, limit: `${criteria.improvement * 100}% above the baseline's ${b.net}`, note: meaningful ? null : 'the baseline profit is zero, negative or under $100: the percentage target is inapplicable; dollar differences are reported' };
    c.stress = { ok: summary.bestFive ? summary.bestFive.adjustedNet >= b.net : false, value: summary.bestFive?.adjustedNet ?? null, limit: `net profit with the best ${summary.bestFive?.K ?? '?'} outcomes removed at least the baseline's ${b.net}` };
  } else {
    c.improvement = { ok: false, value: null, limit: 'no baseline recorded yet', note: 'the baseline experiment has not finished' };
    c.stress = { ok: false, value: summary.bestFive?.adjustedNet ?? null, limit: 'no baseline recorded yet' };
  }
  c.drawdown = { ok: summary.maxDrawdownPct != null && summary.maxDrawdownPct <= criteria.maxDrawdownPct, value: summary.maxDrawdownPct, limit: `at most ${criteria.maxDrawdownPct}%` };
  c.trades = { ok: summary.completedTrades >= criteria.minCompletedTrades, value: summary.completedTrades, limit: `at least ${criteria.minCompletedTrades}` };
  c.accounting = { ok: !!summary.accounting?.ok, value: summary.accounting?.reconciliation?.difference ?? null, limit: `reconciles within $${criteria.reconcileToleranceUsd}` };
  c.dataQuality = { ok: !!dataQualityOk, value: dataQualityOk ? 'ready and calibrated' : 'not ready', limit: 'HXR readiness and spread calibration for the development period' };
  c.nullTest = { ok: summary.nullTest?.p != null && summary.nullTest.p <= criteria.nullMaxP, value: summary.nullTest?.p ?? null, limit: `p at most ${criteria.nullMaxP} (${criteria.nullResamples} resamples, seed ${criteria.nullSeed})` };
  c.concentration = { ok: summary.topStock ? summary.topStock.share <= criteria.maxTopStockShare : summary.completedTrades > 0, value: summary.topStock?.share ?? null, limit: `top stock at most ${criteria.maxTopStockShare * 100}% of the gross gain` };
  c.decisionGain = { ok: out.decisionGainUsd != null && out.decisionGainUsd > 0, value: out.decisionGainUsd, limit: 'the gain over the baseline is not explained by exposure alone' };
  out.clearsTarget = ['improvement', 'drawdown', 'trades', 'accounting', 'dataQuality'].every((k) => c[k].ok);
  out.shortlisted = out.clearsTarget && ['stress', 'nullTest', 'concentration', 'decisionGain'].every((k) => c[k].ok);
  out.failed = Object.entries(c).filter(([, v]) => !v.ok).map(([k]) => k);
  if (out.shortlisted) out.labels.push(LABELS.SHORTLISTED);
  if (leader?.summary && leader.id !== undefined) {
    out.vsLeader = { leaderId: leader.id, leaderName: leader.name ?? null, leaderNet: leader.summary.net, diffUsd: round2(summary.net - leader.summary.net), pct: leader.summary.net > 0 ? round2(((summary.net - leader.summary.net) / leader.summary.net) * 100) : null };
  }
  // Why it improved (or not), in words the dashboard shows.
  if (out.diffUsd != null) {
    out.why.push(out.diffUsd > 0 ? `net profit ${out.diffUsd} above the baseline` : out.diffUsd < 0 ? `net profit ${Math.abs(out.diffUsd)} below the baseline` : 'net profit equal to the baseline');
    if (out.exposureGainUsd != null) out.why.push(`of which ${out.exposureGainUsd} from changed exposure (the exposure-matched hold) and ${out.decisionGainUsd} from changed trading decisions`);
  }
  return out;
}

// The current leader among done experiments: the highest net among those that clear the target; else the
// highest net among those meeting the risk conditions (drawdown, trades); else the baseline.
export function leaderOf(experiments, baseline) {
  const done = experiments.filter((e) => e.status === 'done' && e.summary && Number.isFinite(e.summary.net));
  const byNet = (a, b) => (b.summary.net - a.summary.net) || (a.id - b.id);
  const cleared = done.filter((e) => e.summary.comparison?.clearsTarget).sort(byNet);
  if (cleared.length) return { ...cleared[0], basis: 'highest net profit among results that clear the target' };
  const risk = done.filter((e) => e.summary.comparison?.criteria?.drawdown?.ok && e.summary.comparison?.criteria?.trades?.ok).sort(byNet);
  if (risk.length) return { ...risk[0], basis: 'highest net profit among results within the drawdown limit with enough trades (none clears the target)' };
  return baseline ? { ...baseline, basis: 'the baseline (no result meets the risk conditions)' } : null;
}

// ---------- the runner ----------
export function createRunner({ dataDir = null, dbFile = null, campaignDoc = CAMPAIGN_DOC, clock = () => new Date(), limits = LIMITS, criteria = CRITERIA, expectedBaselineNet = EXPECTED_BASELINE_NET, testOverrides = false, inputsLoader = loadDevelopmentInputs } = {}) {
  const appCfg = loadAppConfig();
  const dir = dataDir ?? appCfg.dataDir;
  const overrides = [];
  if (dataDir && path.resolve(dataDir) !== path.resolve(appCfg.dataDir)) overrides.push('dataDir');
  if (dbFile) overrides.push('dbFile');
  if (campaignDoc !== CAMPAIGN_DOC) overrides.push('campaignDoc');
  if (limits !== LIMITS) overrides.push('limits');
  if (criteria !== CRITERIA) overrides.push('criteria');
  if (expectedBaselineNet !== EXPECTED_BASELINE_NET) overrides.push('expectedBaselineNet');
  if (inputsLoader !== loadDevelopmentInputs) overrides.push('inputsLoader');
  if (overrides.length && !testOverrides) throw new Error(`createRunner: ${overrides.join(', ')} can be changed only with testOverrides: true (tests only)`);
  const file = dbFile ?? store.rrDbFile(dir);
  const db = store.openRrDb(file);
  const now = () => clock().toISOString();
  let market = null; // built once per process
  const marketFor = (floorBps) => (market ||= inputsLoader({ dataDir: dir, floorBps }));

  function createCampaign({ name = 'Campaign 1' } = {}) {
    const doc = campaignDocStatus(campaignDoc);
    if (!doc.ok) throw new ResearchError(409, `The campaign document is not ready: ${doc.problem}. Nothing was queued.`);
    const period = developmentPeriod();
    const at = now();
    const id = store.insertCampaign(db, { name, docSha256: doc.hash, codeRevision: CODE_REVISION, engineVersion: `${RT_ENGINE_VERSION}; ${RT_CODE_REVISION}; ${RUNNER_VERSION}`, period, limits, criteria, baselineFile: BASELINE_FILE, at });
    // The planned experiments, the baseline first so every later result can be compared with it.
    const planned = plannedExperiments();
    const ordered = [...planned.filter((p) => p.stage === STAGES.reference && p.baseFile === BASELINE_FILE), ...planned.filter((p) => !(p.stage === STAGES.reference && p.baseFile === BASELINE_FILE))];
    const { added, skipped } = store.enqueue(db, id, ordered.slice(0, limits.maxConfigs), at);
    store.logEvent(db, { campaignId: id, at, message: `campaign created: ${added.length} experiments queued (stages 0 to 2), ${skipped.length} duplicates skipped; document ${doc.hash.slice(0, 12)}` });
    return { id, queued: added.length, skipped: skipped.length, docSha256: doc.hash };
  }

  function requireCampaign(id) { const c = store.getCampaign(db, id); if (!c) throw new ResearchError(404, `campaign ${id} does not exist`); return c; }

  function setStatus(id, status, reason = null) {
    const c = requireCampaign(id);
    const allowed = { running: ['planned', 'paused'], paused: ['running', 'planned'], cancelled: ['planned', 'running', 'paused'] };
    if (!allowed[status]?.includes(c.status)) throw new ResearchError(409, `campaign ${id} is ${c.status}; it cannot be set ${status}`);
    const at = now();
    store.setCampaignStatus(db, id, status, { reason, at });
    if (status === 'cancelled') { const n = store.cancelQueued(db, id, at); store.logEvent(db, { campaignId: id, at, message: `cancelled by the owner: ${n} queued experiments cancelled` }); }
    else store.logEvent(db, { campaignId: id, at, message: `${status}${reason ? `: ${reason}` : ''}` });
    return store.getCampaign(db, id);
  }

  function stopCampaign(id, reason, status = 'stopped') {
    const at = now();
    store.setCampaignStatus(db, id, status, { reason, at });
    if (status !== 'done') store.cancelQueued(db, id, at);
    store.logEvent(db, { campaignId: id, at, level: status === 'done' ? 'info' : 'warn', message: `${status}: ${reason}` });
  }

  function resourceProblem() {
    let free = null;
    try { const s = fs.statfsSync(dir); free = Number(s.bavail) * Number(s.bsize); } catch { /* unknown */ }
    if (free == null) return 'free disk space unknown';
    if (free < limits.minFreeBytes) return `free disk space ${(free / 1024 ** 3).toFixed(2)} GB is under the limit of ${(limits.minFreeBytes / 1024 ** 3).toFixed(0)} GB`;
    const heap = process.memoryUsage().heapUsed;
    if (heap > limits.maxHeapBytes) return `heap ${(heap / 1024 ** 2).toFixed(0)} MB is over the limit of ${(limits.maxHeapBytes / 1024 ** 2).toFixed(0)} MB`;
    return null;
  }

  function baselineOf(campaign) { return campaign.baseline_experiment_id ? store.getExperiment(db, campaign.baseline_experiment_id) : null; }

  // One experiment: run, check, evaluate, save. Never throws for a run failure: the experiment is recorded failed.
  function runExperiment(campaign, exp, worker) {
    const t0 = Date.now();
    const at0 = now();
    const config = exp.config;
    try {
      assertDevelopmentPeriod(config);
      const m = marketFor(config.costs.halfSpreadFloorBps);
      if (campaign.data_hash && campaign.data_hash !== m.dataHash) throw new Error(`the market data changed since the campaign started (data hash ${m.dataHash.slice(0, 12)} vs ${campaign.data_hash.slice(0, 12)})`);
      const result = runBacktest({ config, symbols: m.inputs.symbols, sessions: m.inputs.sessions, days: m.inputs.days, halfSpreadBps: halfSpreadFor(config, m.calibrated), dataHash: m.inputs.dataHash });
      const index = holdIndex({ symbols: m.inputs.symbols, sessions: m.inputs.sessions, days: m.inputs.days, start: m.period.start, startingCash: config.portfolio.startingCash, withholdingPct: config.dividends.withholdingPct });
      const metrics = computeMetrics(result, { index });
      const accounting = accountingCheck(result, metrics, { tolerance: criteria.reconcileToleranceUsd });
      const nullResult = nullTest(result, { inputs: m.inputs, calibrated: m.calibrated, config, period: m.period, resamples: criteria.nullResamples, seed: criteria.nullSeed });
      const summary = summarise(result, metrics, { nullResult, accounting, index });
      const isBaseline = exp.stage === STAGES.reference && exp.base_file === BASELINE_FILE;
      const baseline = isBaseline ? { id: exp.id, name: exp.name, summary } : baselineOf(campaign);
      const leader = leaderOf(store.listExperiments(db, campaign.id, { status: 'done' }), baseline);
      summary.comparison = compare(summary, { baseline, leader, criteria, dataQualityOk: true });
      summary.labels = summary.comparison.labels;
      const provenance = { codeRevision: CODE_REVISION, engineVersion: `${RT_ENGINE_VERSION}; ${RT_CODE_REVISION}; ${RUNNER_VERSION}`, symbolsHash: m.symbolsHash, dataHash: m.dataHash, calibrationHash: m.calibrationHash };
      const durationMs = Date.now() - t0;
      const idxByDate = new Map((Array.isArray(index) ? index : index.equity || []).map((p) => [p.date, p.value ?? p.equity]));
      store.tx(db, () => {
        store.finishExperiment(db, exp.id, { status: 'done', metrics: { ...metrics, provenance: { ...provenance, indexMethod: INDEX_METHOD, configHash: result.meta.configHash } }, summary, at: now(), durationMs, provenance });
        if (isBaseline) store.updateCampaign(db, campaign.id, { baseline_experiment_id: exp.id, baseline_net: summary.net });
      });
      store.insertEquity(db, exp.id, result.equity.map((p) => ({ date: p.date, equity: p.equity, invested: p.invested, indexValue: idxByDate.get(p.date) ?? null })));
      store.logEvent(db, { campaignId: campaign.id, experimentId: exp.id, at: now(), message: `done: ${exp.name} net ${summary.net} dd ${summary.maxDrawdownPct}% trades ${summary.completedTrades}${summary.comparison.clearsTarget ? ' CLEARS TARGET' : ''}${summary.comparison.shortlisted ? ' SHORTLISTED' : ''} (${durationMs} ms)` });
      // Stop conditions after a run: accounting error, the baseline not reproducing, an over-long experiment.
      if (!accounting.ok) return { stop: `accounting error in experiment ${exp.id} (${exp.name}): ${accounting.problems.join('; ')}` };
      if (isBaseline && expectedBaselineNet != null && Math.abs(summary.net - expectedBaselineNet) > 0.01) return { stop: `the baseline did not reproduce the practice run: net ${summary.net} vs expected ${expectedBaselineNet} (determinism or accounting error)` };
      if (durationMs > limits.maxExperimentMs) return { stop: `experiment ${exp.id} took ${durationMs} ms, over the limit of ${limits.maxExperimentMs} ms` };
      notify(campaign, { ...exp, summary });
      return { done: true, summary };
    } catch (e) {
      const durationMs = Date.now() - t0;
      store.finishExperiment(db, exp.id, { status: 'failed', error: String(e.message || e).slice(0, 2000), at: now(), durationMs, provenance: { codeRevision: CODE_REVISION } });
      store.logEvent(db, { campaignId: campaign.id, experimentId: exp.id, at: now(), level: 'error', message: `failed: ${exp.name}: ${e.message}` });
      if (e instanceof ResearchError || /refuses|market data|not ready|calibration|changed since/.test(String(e.message))) return { stop: `invalid data or refused input: ${e.message}` };
      return { failed: true };
    } finally { void at0; }
  }

  // Notifications: the first result that clears the target, then only a result that beats the last notified
  // one by at least notifyStep of the baseline's net; a shortlisting is its own (deduplicated) notification.
  function notify(campaign, exp) {
    const cmp = exp.summary?.comparison;
    if (!cmp?.clearsTarget) return;
    const at = now();
    const last = store.getSetting(db, `lastNotified:${campaign.id}`);
    const step = (cmp.baselineNet ?? 0) * criteria.notifyStep;
    const title = 'development improvement - not yet validated';
    if (!last || exp.summary.net >= last.net + step) {
      const body = `${exp.name} (experiment ${exp.id}): net profit ${exp.summary.net} vs the baseline ${cmp.baselineNet} (${cmp.improvementPct == null ? 'ratio not applicable' : `${cmp.improvementPct}%`}); max drawdown ${exp.summary.maxDrawdownPct}%, ${exp.summary.completedTrades} trades; ${cmp.why.join('; ')}. A development result on data seen before, not a validated strategy.`;
      const id = store.insertNotification(db, { campaignId: campaign.id, experimentId: exp.id, kind: 'target', title, body, dedupeKey: `target:${campaign.id}:${exp.id}`, at });
      if (id) store.setSetting(db, `lastNotified:${campaign.id}`, { experimentId: exp.id, net: exp.summary.net, at }, at);
    }
    if (cmp.shortlisted) store.insertNotification(db, { campaignId: campaign.id, experimentId: exp.id, kind: 'shortlisted', title: `${title}: shortlisted candidate`, body: `${exp.name} (experiment ${exp.id}) passes the stress, null, concentration and decision-gain conditions as well. Still a development result; nothing is evaluated automatically.`, dedupeKey: `shortlisted:${campaign.id}:${exp.id}`, at });
  }

  // The worker loop: runs until the queue is empty (then stage 3 is generated once, then done), the campaign is
  // paused or cancelled, a limit is hit, or `until()` says to stop. Returns why it stopped.
  function runWorker(campaignId, { until = () => false, onExperiment = null } = {}) {
    const campaign0 = requireCampaign(campaignId);
    if (!['planned', 'running', 'paused'].includes(campaign0.status)) return { reason: `campaign is ${campaign0.status}` };
    const worker = store.claimWorker(db, campaignId, { pid: process.pid, host: os.hostname(), at: now(), staleMs: limits.staleHeartbeatMs });
    if (!worker) return { reason: 'another worker holds this campaign (live heartbeat)' };
    const workerId = `${worker.host}:${worker.pid}:${worker.token.slice(0, 6)}`;
    try {
      const rec = store.recoverInterrupted(db, campaignId, { at: now(), staleMs: limits.staleHeartbeatMs });
      if (rec.requeued.length || rec.failed.length) store.logEvent(db, { campaignId, at: now(), level: 'warn', message: `recovery: re-queued ${rec.requeued.join(', ') || 'none'}; failed after two attempts ${rec.failed.join(', ') || 'none'}` });
      // A planned campaign starts here; a paused one stays paused until the owner resumes it (the worker never
      // resumes on its own).
      if (campaign0.status === 'paused') return { reason: 'paused' };
      if (campaign0.status === 'planned') store.setCampaignStatus(db, campaignId, 'running', { at: now() });
      // Data quality once per worker: the inputs are built here (read-only), and their hashes fixed on the campaign.
      try {
        const m = marketFor(2);
        const c = store.getCampaign(db, campaignId);
        if (c.data_hash && c.data_hash !== m.dataHash) { stopCampaign(campaignId, `the market data changed since the campaign started (data hash ${m.dataHash.slice(0, 12)} vs ${c.data_hash.slice(0, 12)})`); return { reason: 'data changed' }; }
        if (!c.data_hash) store.updateCampaign(db, campaignId, { symbols_hash: m.symbolsHash, data_hash: m.dataHash, calibration_hash: m.calibrationHash });
      } catch (e) { stopCampaign(campaignId, `invalid data: ${e.message}`); return { reason: `invalid data: ${e.message}` }; }
      let stage3Built = store.getSetting(db, `stage3:${campaignId}`) != null;
      for (;;) {
        const c = store.getCampaign(db, campaignId);
        if (c.status === 'paused') { store.logEvent(db, { campaignId, at: now(), message: 'worker stopped: paused' }); return { reason: 'paused' }; }
        if (c.status === 'cancelled') return { reason: 'cancelled' };
        if (c.status !== 'running') return { reason: `campaign is ${c.status}` };
        if (until()) { store.setCampaignStatus(db, campaignId, 'paused', { at: now() }); store.logEvent(db, { campaignId, at: now(), message: 'worker stopped by its caller; campaign paused' }); return { reason: 'until' }; }
        const counts = store.countExperiments(db, campaignId);
        const used = counts.done + counts.failed;
        if (used >= limits.maxConfigs) { stopCampaign(campaignId, `the configuration budget of ${limits.maxConfigs} is used (${used} run)`, 'done'); return { reason: 'budget' }; }
        if (c.elapsed_ms >= limits.maxHours * 3600_000) { stopCampaign(campaignId, `the time budget of ${limits.maxHours} hours is used`, 'done'); return { reason: 'time' }; }
        const rp = resourceProblem();
        if (rp) { stopCampaign(campaignId, `resource limit: ${rp}`); return { reason: 'resources' }; }
        store.heartbeat(db, campaignId, worker, now());
        const exp = store.claimNext(db, campaignId, workerId, now());
        if (!exp) {
          if (!stage3Built && counts.running === 0) {
            const all = store.listExperiments(db, campaignId, { limit: 10000 });
            const combos = combinationStage(all, { budgetLeft: limits.maxConfigs - used, maxDrawdownPct: criteria.maxDrawdownPct });
            const { added, skipped } = store.enqueue(db, campaignId, combos, now());
            store.setSetting(db, `stage3:${campaignId}`, { built: true, added: added.length, skipped: skipped.length, at: now() }, now());
            store.logEvent(db, { campaignId, at: now(), message: `stage 3 built by the pre-registered rule: ${added.length} combinations queued, ${skipped.length} duplicates skipped` });
            stage3Built = true;
            if (added.length) continue;
          }
          if (counts.running > 0) return { reason: 'another worker is still running an experiment' };
          stopCampaign(campaignId, `every planned experiment has run (${counts.done} done, ${counts.failed} failed)`, 'done');
          return { reason: 'complete' };
        }
        const t0 = Date.now();
        const out = runExperiment(store.getCampaign(db, campaignId), exp, worker);
        const c2 = store.getCampaign(db, campaignId);
        store.updateCampaign(db, campaignId, { elapsed_ms: (c2.elapsed_ms || 0) + (Date.now() - t0), last_run_at: now() });
        if (onExperiment) onExperiment({ id: exp.id, name: exp.name, ...out });
        if (out.stop) { stopCampaign(campaignId, out.stop); return { reason: out.stop }; }
      }
    } finally { store.releaseWorker(db, campaignId, worker); }
  }

  // ---------- read side ----------
  function overview() {
    const campaigns = store.listCampaigns(db);
    const active = campaigns.find((c) => ['running', 'paused', 'planned'].includes(c.status)) ?? campaigns[0] ?? null;
    return { simulated: true, codeRevision: CODE_REVISION, runnerVersion: RUNNER_VERSION, engine: `${RT_ENGINE_VERSION} (${RT_CODE_REVISION})`, period: developmentPeriod(), limits, criteria, baselineFile: BASELINE_FILE, campaignDoc: campaignDocStatus(campaignDoc), campaigns: campaigns.map((c) => campaignStatus(c.id)), active: active ? campaignStatus(active.id) : null, unseenNotifications: store.listNotifications(db, { unseenOnly: true, limit: 50 }).length };
  }
  function campaignStatus(id) {
    const c = requireCampaign(id);
    const counts = store.countExperiments(db, id);
    const running = store.listExperiments(db, id, { status: 'running', limit: 5 });
    const done = store.listExperiments(db, id, { status: 'done', limit: 10000 });
    const baseline = baselineOf(c);
    const leader = leaderOf(done, baseline ? { ...baseline } : null);
    const cleared = done.filter((e) => e.summary?.comparison?.clearsTarget).length;
    const shortlisted = done.filter((e) => e.summary?.comparison?.shortlisted).length;
    return {
      id: c.id, name: c.name, status: c.status, stopReason: c.stop_reason, createdAt: c.created_at, startedAt: c.started_at, finishedAt: c.finished_at, elapsedMs: c.elapsed_ms, lastRunAt: c.last_run_at,
      worker: store.workerAlive(db, id, { at: now(), staleMs: limits.staleHeartbeatMs }), counts, progress: counts.total ? (counts.done + counts.failed + counts.cancelled) / counts.total : 0,
      active: running.map((e) => ({ id: e.id, name: e.name, stage: e.stage, startedAt: e.started_at })),
      baseline: baseline ? { id: baseline.id, name: baseline.name, net: baseline.summary?.net ?? null, maxDrawdownPct: baseline.summary?.maxDrawdownPct ?? null, completedTrades: baseline.summary?.completedTrades ?? null, expectedNet: expectedBaselineNet } : null,
      leader: leader ? { id: leader.id, name: leader.name, net: leader.summary?.net ?? null, basis: leader.basis, comparison: leader.summary?.comparison ?? null, labels: leader.summary?.labels ?? null } : null,
      cleared, shortlisted, stage3: store.getSetting(db, `stage3:${id}`), hashes: { symbols: c.symbols_hash, data: c.data_hash, calibration: c.calibration_hash, doc: c.doc_sha256 }, codeRevision: c.code_revision, engineVersion: c.engine_version, period: c.period, limits: c.limits, criteria: c.criteria, baselineFile: c.baseline_file,
    };
  }
  function experiments(id, { q = '', stage = null, status = null, label = null, limit = 200, offset = 0 } = {}) {
    requireCampaign(id);
    let rows = store.listExperiments(db, id, { stage, status, limit: 10000 });
    const needle = String(q || '').trim().toLowerCase();
    if (needle) rows = rows.filter((e) => `${e.name} ${e.hypothesis} ${e.base_file ?? ''} ${e.status} ${(e.summary?.labels || []).join(' ')}`.toLowerCase().includes(needle));
    if (label) rows = rows.filter((e) => (e.summary?.labels || []).includes(label));
    const total = rows.length;
    return { total, items: rows.slice(offset, offset + limit).map(briefOf) };
  }
  function briefOf(e) {
    const s = e.summary || null;
    return { id: e.id, stage: e.stage, ordinal: e.ordinal, name: e.name, hypothesis: e.hypothesis, parentId: e.parent_id, baseFile: e.base_file, change: e.change, status: e.status, attempts: e.attempts, startedAt: e.started_at, finishedAt: e.finished_at, durationMs: e.duration_ms, error: e.error, codeRevision: e.code_revision, dataHash: e.data_hash, configHash: e.config_hash,
      summary: s ? { net: s.net, startValue: s.startValue, endValue: s.endValue, totalReturnPct: s.totalReturnPct, annualisedReturnPct: s.annualisedReturnPct, maxDrawdownPct: s.maxDrawdownPct, avgInvestedPct: s.avgInvestedPct, turnoverPerYear: s.turnoverPerYear, costs: s.costs, completedTrades: s.completedTrades, openAtEnd: s.openAtEnd, topStock: s.topStock, nullP: s.nullTest?.p ?? null, bestFiveNet: s.bestFive?.adjustedNet ?? null, index: s.index, exposureMatched: s.exposureMatched, comparison: s.comparison ? { baselineExperimentId: s.comparison.baselineExperimentId, baselineNet: s.comparison.baselineNet, diffUsd: s.comparison.diffUsd, improvementPct: s.comparison.improvementPct, improvementApplicable: s.comparison.improvementApplicable, exposureGainUsd: s.comparison.exposureGainUsd, decisionGainUsd: s.comparison.decisionGainUsd, clearsTarget: s.comparison.clearsTarget, shortlisted: s.comparison.shortlisted, failed: s.comparison.failed, vsLeader: s.comparison.vsLeader } : null, labels: s.labels } : null };
  }
  function experiment(id) {
    const e = store.getExperiment(db, id);
    if (!e) throw new ResearchError(404, `experiment ${id} does not exist`);
    const parent = e.parent_id ? store.getExperiment(db, e.parent_id) : null;
    const base = e.base_file ? store.listExperiments(db, e.campaign_id, { stage: STAGES.reference, limit: 20 }).find((x) => x.base_file === e.base_file && x.name === e.base_file.replace(/\.json$/, '')) : null;
    return { ...briefOf(e), campaignId: e.campaign_id, config: e.config, summary: e.summary, parent: parent ? briefOf(parent) : null, base: base ? briefOf(base) : null, equity: store.getEquity(db, id), provenance: e.metrics?.provenance ?? null, engineVersion: e.engine_version, symbolsHash: e.symbols_hash, calibrationHash: e.calibration_hash, perStock: e.metrics?.perStock ?? null, metricsKeys: e.metrics ? Object.keys(e.metrics) : [] };
  }
  const notifications = (opts) => store.listNotifications(db, opts);
  const markSeen = (ids) => store.markSeen(db, ids, now());
  const events = (id, limit) => store.listEvents(db, id, limit);
  function close() { try { db.close(); } catch { /* ignore */ } }

  // notifyFor applies the notification rule to an experiment record (used by the worker and by the tests).
  return { file, db, createCampaign, start: (id) => setStatus(id, 'running'), pause: (id) => setStatus(id, 'paused'), resume: (id) => setStatus(id, 'running'), cancel: (id) => setStatus(id, 'cancelled'), runWorker, overview, campaignStatus, experiments, experiment, notifications, markSeen, events, close, notifyFor: (campaignId, exp) => notify(requireCampaign(campaignId), exp), getCampaign: (id) => store.getCampaign(db, id), listExperimentsRaw: (id, opts) => store.listExperiments(db, id, opts), logDir: path.join(dir, LOG_DIR_NAME), revision: CODE_REVISION };
}
