// The research runner: campaigns, the persistent job queue, the worker loop, the evaluation of every experiment
// against the campaign's fixed baseline (and, for campaign 3, its family baseline), the random-timing null with
// its raw and Holm-adjusted p, and the notifications (strategy/research-runner/CAMPAIGN-1.md, CAMPAIGN-3.md).
// A simulation only. It reuses the range-trend engine, metrics and benchmark (a), and the mechanism engine, on
// HXR's development-period market data, opened read-only by real path, built once per worker process. It never
// reads real holdings or cash, never places an order, never sends anything outside the app, and never opens any
// window but the development period (config.js assertDevelopmentPeriod, checked before every run). A
// development leader is a development result, never a validated strategy; the label "independently evaluated"
// is never set here.
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
import { runMechanism, MECHANISM_ENGINE_VERSION } from './mechanisms.js';
import * as store from './store.js';
import { CODE_REVISION, RUNNER_VERSION, LIMITS, CRITERIA, LABELS, STAGES, BASELINE_FILE, PLANS, planOf, developmentPeriod, assertDevelopmentPeriod, campaignDocStatus, LOG_DIR_NAME } from './config.js';
import { plannedExperiments, combinationStage, campaign3Experiments } from './space.js';

export class ResearchError extends Error { constructor(status, message) { super(message); this.status = status; } }

export const EXPECTED_BASELINE_NET = 1757.90; // practice run 6 (2026-11-04, range-trend log row 23): the baseline must reproduce it

// ---------- small helpers ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const round2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const symbolsHashOf = (symbols) => crypto.createHash('sha256').update(canonicalJson(symbols.map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi })))).digest('hex');
const ENGINES = `${RT_ENGINE_VERSION}; ${RT_CODE_REVISION}; ${MECHANISM_ENGINE_VERSION}; ${RUNNER_VERSION}`;

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

// ---------- the random-timing null (CAMPAIGN-3.md section 3, item 1; a trade-level diagnostic) ----------
// Each completed trade (and each position open at the end) keeps its stock, shares and holding length h (fill to
// fill, in the stock's own sessions) and is moved to a random decision session: the eligible set is enumerated
// once per (stock, h) and drawn uniformly, no rejection. Entry at the next session's open plus spread and
// slippage; exit at the open h sessions later minus them (an open position exits at that session's close). The
// statistic is trade-timing P/L: shares x (exit - entry), spread and slippage included, fees and dividends
// excluded, computed the same way for the run's own fills. It ignores cash, caps and overlapping positions.
export function nullTest(result, { inputs, calibrated, config, period, resamples = CRITERIA.nullResamples, seed = CRITERIA.nullSeed }) {
  const kOf = (sym, date) => (Math.max(config.costs.halfSpreadFloorBps, calibrated(sym, date)) + config.costs.slippageBps) / 10000;
  const items = [
    ...(result.trades || []).map((t) => ({ symbol: t.symbol, shares: t.shares, held: Math.max(1, t.sessionsHeld ?? 1), open: false, timing: t.shares * ((t.exitPrice ?? t.entryPrice) - t.entryPrice) })),
    ...(result.openPositions || []).map((p) => ({ symbol: p.symbol, shares: p.shares, held: Math.max(1, p.sessionsHeld ?? 1), open: true, timing: p.shares * (p.markPrice - p.entryPrice) })),
  ];
  if (!items.length) return { p: null, resamples: 0, reason: 'no trades', method: 'random-timing null (trade-level diagnostic)' };
  // Each stock's own session list (dates with a bar), and the first index at or after the period start.
  const lists = {};
  for (const sym of new Set(items.map((i) => i.symbol))) {
    const dates = inputs.sessions.filter((d) => inputs.days.get(d)?.bars?.[sym]);
    lists[sym] = { dates, startIdx: dates.findIndex((d) => d >= period.start) };
  }
  const bar = (sym, i) => inputs.days.get(lists[sym].dates[i]).bars[sym];
  const eligible = {};
  for (const it of items) {
    const key = `${it.symbol}:${it.held}`;
    if (eligible[key]) continue;
    const L = lists[it.symbol];
    const set = [];
    if (L.startIdx >= 0) for (let i = L.startIdx; i + 1 + it.held <= L.dates.length - 1; i++) set.push(i);
    eligible[key] = set;
  }
  const actual = items.reduce((a, t) => a + t.timing, 0);
  const rand = mulberry32(seed);
  const dist = new Array(resamples);
  let unplaceable = 0;
  for (let r = 0; r < resamples; r++) {
    let total = 0;
    for (const t of items) {
      const set = eligible[`${t.symbol}:${t.held}`];
      if (!set.length) { if (r === 0) unplaceable++; continue; }
      const i = set[Math.floor(rand() * set.length)];
      const e = bar(t.symbol, i + 1), x = bar(t.symbol, i + 1 + t.held);
      const L = lists[t.symbol];
      const entry = e.o * (1 + kOf(t.symbol, L.dates[i + 1]));
      const exit = t.open ? x.c : x.o * (1 - kOf(t.symbol, L.dates[i + 1 + t.held]));
      total += t.shares * (exit - entry);
    }
    dist[r] = total;
  }
  dist.sort((a, b) => a - b);
  const atOrAbove = dist.filter((v) => v >= actual - 1e-9).length;
  const q = (f) => dist[Math.min(dist.length - 1, Math.max(0, Math.ceil(f * dist.length) - 1))];
  return { p: (1 + atOrAbove) / (1 + resamples), atOrAbove, resamples, seed, actualTimingPnl: round2(actual), items: items.length, unplaceableItems: unplaceable, percentiles: { p5: round2(q(0.05)), p50: round2(q(0.5)), p95: round2(q(0.95)), p99: round2(q(0.99)) }, method: 'random-timing null: a trade-level diagnostic (same stock, shares and holding length; entry at a random session\'s next open; spread and slippage included, fees and dividends excluded; cash, caps and overlapping positions ignored)' };
}

// Holm step-down over a family of raw p-values with m planned members (failed or trade-less members count in m
// and never pass). Returns, per entry, the adjusted p and whether it is significant at alpha.
export function holmAdjust(entries, { m, alpha = 0.05 } = {}) {
  const withP = entries.filter((e) => e.p != null).sort((a, b) => a.p - b.p || a.id - b.id);
  const M = Math.max(m ?? withP.length, withP.length);
  let running = 0;
  const out = new Map();
  withP.forEach((e, idx) => {
    const adj = Math.min(1, (M - idx) * e.p);
    running = Math.max(running, adj);
    out.set(e.id, { adjustedP: running, significant: running <= alpha, rank: idx + 1, m: M, alpha });
  });
  for (const e of entries) if (!out.has(e.id)) out.set(e.id, { adjustedP: null, significant: false, rank: null, m: M, alpha });
  return out;
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
  // dividends, so they are counted once here (campaign 1 stopped on a check that added them twice: log entry 2).
  const openPnl = (result.openPositions || []).reduce((a, p) => a + (p.pnl ?? 0), 0);
  const expected = (metrics.netTradePnl ?? 0) + openPnl;
  const net = metrics.endValue - metrics.startValue;
  const diff = net - expected;
  if (Math.abs(diff) > tolerance) problems.push(`net P/L ${round2(net)} does not reconcile with trade P/L (post-exit dividends included) + open P/L ${round2(expected)} (difference ${round2(diff)})`);
  if (!(metrics.costs >= 0)) problems.push('costs are negative or missing');
  return { ok: !problems.length, problems, reconciliation: { net: round2(net), tradePnl: round2(metrics.netTradePnl), openPnl: round2(openPnl), postExitPaid: round2(metrics.postExitPaid), difference: round2(diff) } };
}

// ---------- the summary and the comparison with the baseline ----------
export function summarise(result, metrics, { nullResult, accounting }) {
  const g = metrics.pick?.grossGain ?? metrics.tier2?.grossGain ?? null;
  const em = metrics.benchmarks?.exposureMatched ?? null;
  const bh = metrics.benchmarks?.buyAndHold ?? null;
  const trades = result.trades || [];
  return {
    startValue: round2(metrics.startValue), endValue: round2(metrics.endValue), net: round2(metrics.endValue - metrics.startValue),
    totalReturnPct: round2(metrics.totalReturnPct), annualisedReturnPct: round2(metrics.annualisedReturnPct), maxDrawdownPct: round2(metrics.maxDrawdownPct), maxDrawdownUsd: round2(metrics.maxDrawdownUsd),
    avgInvestedPct: round2(metrics.avgInvestedPct), timeInCashPct: round2(metrics.timeInCashPct), turnoverPerYear: round2(metrics.turnoverPerYear), costs: round2(metrics.costs),
    completedTrades: metrics.completedTrades, openAtEnd: metrics.openAtEnd, skips: metrics.skips, sessions: metrics.sessions, years: metrics.years,
    lossExceededRisk: trades.filter((t) => t.lossExceededRisk).length, rejections: metrics.rejectionsByCode ?? null, cancellations: metrics.cancellationsByCode ?? null, eligibility: result.eligibility ?? null,
    topStock: g?.maxSymbol ? { symbol: g.maxSymbol, share: g.maxShare, pnl: round2(g.perStock?.[g.maxSymbol]?.pnl) } : null, grossGain: round2(g?.grossGain), winners: g?.winners ?? null,
    exposureMatched: em ? { endValue: round2(em.endValue), net: round2(em.endValue - metrics.startValue), annualisedReturnPct: round2(em.annualisedReturnPct), maxDrawdownPct: round2(em.maxDrawdownPct) } : null,
    index: bh ? { endValue: round2(bh.endValue), net: round2(bh.endValue - metrics.startValue), annualisedReturnPct: round2(bh.annualisedReturnPct), maxDrawdownPct: round2(bh.maxDrawdownPct) } : null,
    bestFive: metrics.pick?.bestFive ? { K: metrics.pick.bestFive.K, n: metrics.pick.bestFive.n, removedPL: round2(metrics.pick.bestFive.removedPL), adjustedNet: round2(metrics.pick.bestFive.adjustedNetPL) } : null,
    nullTest: nullResult, accounting,
    exits: metrics.exits, breaks: metrics.breaks, skipsByCode: metrics.skipsByCode, hypotheses: metrics.hypotheses,
  };
}

function attribution(summary, ref) {
  if (!ref?.summary) return null;
  const diffUsd = round2(summary.net - ref.summary.net);
  const exposureGainUsd = summary.exposureMatched && ref.summary.exposureMatched ? round2(summary.exposureMatched.net - ref.summary.exposureMatched.net) : null;
  return { id: ref.id, name: ref.name ?? null, net: ref.summary.net, diffUsd, exposureGainUsd, decisionGainUsd: exposureGainUsd == null ? null : round2(diffUsd - exposureGainUsd) };
}

// The comparison with the fixed baseline and the campaign criteria; also against the current leader and, when
// given, the family baseline. The shortlist uses the raw p (the unadjusted screen); Holm is reported apart.
export function compare(summary, { baseline, leader = null, familyBaseline = null, criteria = CRITERIA, dataQualityOk = true }) {
  const out = { baselineExperimentId: baseline?.id ?? null, baselineNet: baseline?.summary?.net ?? null, diffUsd: null, improvementPct: null, improvementApplicable: false, exposureGainUsd: null, decisionGainUsd: null, vsLeader: null, vsFamilyBaseline: null, criteria: {}, failed: [], clearsTarget: false, shortlisted: false, labels: [LABELS.DEVELOPMENT], why: [] };
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
  c.nullTest = { ok: summary.nullTest?.p != null && summary.nullTest.p <= criteria.nullMaxP, value: summary.nullTest?.p ?? null, limit: `raw p at most ${criteria.nullMaxP} (${criteria.nullResamples} resamples, seed ${criteria.nullSeed}); the unadjusted screen` };
  c.concentration = { ok: summary.topStock ? summary.topStock.share <= criteria.maxTopStockShare : summary.completedTrades > 0, value: summary.topStock?.share ?? null, limit: `top stock at most ${criteria.maxTopStockShare * 100}% of the gross gain` };
  c.decisionGain = { ok: out.decisionGainUsd != null && out.decisionGainUsd > 0, value: out.decisionGainUsd, limit: 'the gain over the baseline is not explained by exposure alone' };
  out.clearsTarget = ['improvement', 'drawdown', 'trades', 'accounting', 'dataQuality'].every((k) => c[k].ok);
  out.shortlisted = out.clearsTarget && ['stress', 'nullTest', 'concentration', 'decisionGain'].every((k) => c[k].ok);
  out.failed = Object.entries(c).filter(([, v]) => !v.ok).map(([k]) => k);
  if (out.shortlisted) out.labels.push(LABELS.SHORTLISTED);
  if (leader?.summary && leader.id !== undefined) {
    out.vsLeader = { leaderId: leader.id, leaderName: leader.name ?? null, leaderNet: leader.summary.net, diffUsd: round2(summary.net - leader.summary.net), pct: leader.summary.net > 0 ? round2(((summary.net - leader.summary.net) / leader.summary.net) * 100) : null };
  }
  out.vsFamilyBaseline = attribution(summary, familyBaseline);
  if (out.diffUsd != null) {
    out.why.push(out.diffUsd > 0 ? `net profit ${out.diffUsd} above the baseline` : out.diffUsd < 0 ? `net profit ${Math.abs(out.diffUsd)} below the baseline` : 'net profit equal to the baseline');
    if (out.exposureGainUsd != null) out.why.push(`of which ${out.exposureGainUsd} from changed exposure (the exposure-matched hold) and ${out.decisionGainUsd} from changed trading decisions`);
  }
  if (out.vsFamilyBaseline) out.why.push(`against its family baseline ${out.vsFamilyBaseline.name}: ${out.vsFamilyBaseline.diffUsd} (exposure ${out.vsFamilyBaseline.exposureGainUsd}, decisions ${out.vsFamilyBaseline.decisionGainUsd})`);
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
export function createRunner({ dataDir = null, dbFile = null, plans = PLANS, clock = () => new Date(), expectedBaselineNet = EXPECTED_BASELINE_NET, testOverrides = false, inputsLoader = loadDevelopmentInputs } = {}) {
  const appCfg = loadAppConfig();
  const dir = dataDir ?? appCfg.dataDir;
  const overrides = [];
  if (dataDir && path.resolve(dataDir) !== path.resolve(appCfg.dataDir)) overrides.push('dataDir');
  if (dbFile) overrides.push('dbFile');
  if (plans !== PLANS) overrides.push('plans');
  if (expectedBaselineNet !== EXPECTED_BASELINE_NET) overrides.push('expectedBaselineNet');
  if (inputsLoader !== loadDevelopmentInputs) overrides.push('inputsLoader');
  if (overrides.length && !testOverrides) throw new Error(`createRunner: ${overrides.join(', ')} can be changed only with testOverrides: true (tests only)`);
  const file = dbFile ?? store.rrDbFile(dir);
  const db = store.openRrDb(file);
  const now = () => clock().toISOString();
  let market = null; // built once per process
  const marketFor = (floorBps) => (market ||= inputsLoader({ dataDir: dir, floorBps }));
  const planFor = (campaign) => { const key = campaign?.limits?.plan ?? 'campaign-1'; const p = plans[key]; if (!p) throw new ResearchError(500, `campaign ${campaign.id} names an unknown plan ${key}`); return p; };

  function createCampaign({ plan = 'campaign-1', name = null } = {}) {
    const pl = plans[plan];
    if (!pl) throw new ResearchError(400, `unknown plan ${plan}; known: ${Object.keys(plans).join(', ')}`);
    const doc = campaignDocStatus(pl.doc, pl.required);
    if (!doc.ok) throw new ResearchError(409, `The campaign document is not ready: ${doc.problem}. Nothing was queued.`);
    const period = developmentPeriod();
    const at = now();
    const limits = { ...pl.limits, plan: pl.key, plannedCount: pl.plannedCount, replacements: pl.replacements, holmFamily: pl.holmFamily, combinations: pl.combinations, docFile: path.basename(pl.doc) };
    const id = store.insertCampaign(db, { name: name ?? pl.name, docSha256: doc.hash, codeRevision: CODE_REVISION, engineVersion: ENGINES, period, limits, criteria: pl.criteria, baselineFile: BASELINE_FILE, at });
    let items;
    if (pl.space === 'campaign3') items = campaign3Experiments();
    else { const planned = plannedExperiments(); items = [...planned.filter((p) => p.stage === STAGES.reference && p.baseFile === BASELINE_FILE), ...planned.filter((p) => !(p.stage === STAGES.reference && p.baseFile === BASELINE_FILE))]; }
    const { added, skipped } = store.enqueue(db, id, items.slice(0, pl.limits.maxConfigs), at);
    // Campaign 3: each mechanism's parent is its family baseline (B0 or M0), queued in the same call.
    for (const it of items) if (it.familyBase) { const parent = added.find((a) => a.name === it.familyBase), me = added.find((a) => a.name === it.name); if (parent && me) store.setParent(db, me.id, parent.id); }
    store.logEvent(db, { campaignId: id, at, message: `campaign created from ${path.basename(pl.doc)} (plan ${pl.key}): ${added.length} experiments queued, ${skipped.length} duplicates skipped; document ${doc.hash.slice(0, 12)}; code ${CODE_REVISION}` });
    return { id, plan: pl.key, queued: added.length, skipped: skipped.length, docSha256: doc.hash };
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

  function resourceProblem(limits) {
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
  function runExperiment(campaign, exp) {
    const t0 = Date.now();
    const config = exp.config;
    const criteria = campaign.criteria, limits = campaign.limits;
    try {
      assertDevelopmentPeriod(config);
      const m = marketFor(config.costs.halfSpreadFloorBps);
      if (campaign.data_hash && campaign.data_hash !== m.dataHash) throw new Error(`the market data changed since the campaign started (data hash ${m.dataHash.slice(0, 12)} vs ${campaign.data_hash.slice(0, 12)})`);
      const common = { config, symbols: m.inputs.symbols, sessions: m.inputs.sessions, days: m.inputs.days, halfSpreadBps: halfSpreadFor(config, m.calibrated), dataHash: m.inputs.dataHash };
      const result = config.strategy === 'mechanism' ? runMechanism(common) : runBacktest(common);
      const index = holdIndex({ symbols: m.inputs.symbols, sessions: m.inputs.sessions, days: m.inputs.days, start: m.period.start, startingCash: config.portfolio.startingCash, withholdingPct: config.dividends.withholdingPct });
      const metrics = computeMetrics(result, { index });
      const accounting = accountingCheck(result, metrics, { tolerance: criteria.reconcileToleranceUsd });
      const nullResult = nullTest(result, { inputs: m.inputs, calibrated: m.calibrated, config, period: m.period, resamples: criteria.nullResamples, seed: criteria.nullSeed });
      const summary = summarise(result, metrics, { nullResult, accounting });
      const isBaseline = exp.stage === STAGES.reference && exp.base_file === BASELINE_FILE && config.strategy !== 'mechanism';
      const baseline = isBaseline ? { id: exp.id, name: exp.name, summary } : baselineOf(campaign);
      const done = store.listExperiments(db, campaign.id, { status: 'done' });
      const leader = leaderOf(done, baseline);
      const familyBaseline = exp.parent_id ? (() => { const p = store.getExperiment(db, exp.parent_id); return p?.status === 'done' && p.summary ? { id: p.id, name: p.name, summary: p.summary } : null; })() : null;
      summary.comparison = compare(summary, { baseline, leader, familyBaseline, criteria, dataQualityOk: true });
      summary.labels = summary.comparison.labels;
      summary.holm = null; // filled when the campaign completes (applyHolm)
      const provenance = { codeRevision: CODE_REVISION, engineVersion: ENGINES, symbolsHash: m.symbolsHash, dataHash: m.dataHash, calibrationHash: m.calibrationHash };
      const durationMs = Date.now() - t0;
      const idxByDate = new Map((Array.isArray(index) ? index : index.equity || []).map((p) => [p.date, p.value ?? p.equity]));
      store.tx(db, () => {
        store.finishExperiment(db, exp.id, { status: 'done', metrics: { ...metrics, provenance: { ...provenance, indexMethod: INDEX_METHOD, configHash: result.meta.configHash, engine: result.meta.engineVersion } }, summary, at: now(), durationMs, provenance });
        if (isBaseline) store.updateCampaign(db, campaign.id, { baseline_experiment_id: exp.id, baseline_net: summary.net });
      });
      store.insertEquity(db, exp.id, result.equity.map((p) => ({ date: p.date, equity: p.equity, invested: p.invested, indexValue: idxByDate.get(p.date) ?? null })));
      store.logEvent(db, { campaignId: campaign.id, experimentId: exp.id, at: now(), message: `done: ${exp.name} net ${summary.net} dd ${summary.maxDrawdownPct}% trades ${summary.completedTrades} p ${summary.nullTest?.p ?? 'none'}${summary.comparison.clearsTarget ? ' CLEARS TARGET' : ''}${summary.comparison.shortlisted ? ' SHORTLISTED (unadjusted)' : ''} (${durationMs} ms)` });
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
    }
  }

  // Holm over the campaign's family (m = the planned count when the plan fixes one): stores the adjusted p and the
  // label with every done experiment. Reported, never enforced.
  function applyHolm(campaignId) {
    const c = requireCampaign(campaignId);
    const m = c.limits.holmFamily ?? null;
    if (m == null) return null;
    const done = store.listExperiments(db, campaignId, { status: 'done', limit: 10000 });
    const adj = holmAdjust(done.map((e) => ({ id: e.id, p: e.summary?.nullTest?.p ?? null })), { m, alpha: c.criteria.holmAlpha ?? 0.05 });
    let significant = 0;
    for (const e of done) {
      const h = adj.get(e.id);
      const s = { ...e.summary, holm: { rawP: e.summary?.nullTest?.p ?? null, ...h } };
      s.labels = (s.labels || [LABELS.DEVELOPMENT]).filter((l) => l !== LABELS.HOLM);
      if (h.significant) { s.labels.push(LABELS.HOLM); significant++; }
      store.updateSummary(db, e.id, s);
    }
    const withP = done.filter((e) => e.summary?.nullTest?.p != null).length;
    const rawPasses = done.filter((e) => e.summary?.nullTest?.p != null && e.summary.nullTest.p <= c.criteria.nullMaxP).length;
    const out = { m, withP, expectedChancePasses: round2(c.criteria.nullMaxP * withP), rawPasses, holmSignificant: significant, at: now() };
    store.setSetting(db, `holm:${campaignId}`, out, now());
    store.logEvent(db, { campaignId, at: now(), message: `Holm over the family of ${m}: ${withP} with a p, ${rawPasses} raw passes (${out.expectedChancePasses} expected by chance), ${significant} Holm-significant` });
    return out;
  }

  // Notifications: the first result that clears the target, then only a result that beats the last notified
  // one by at least notifyStep of the baseline's net; an unadjusted shortlist pass is its own (deduplicated)
  // notification. Every one is labelled a development result, not yet validated.
  function notify(campaign, exp) {
    const cmp = exp.summary?.comparison;
    if (!cmp?.clearsTarget) return;
    const at = now();
    const criteria = campaign.criteria;
    const last = store.getSetting(db, `lastNotified:${campaign.id}`);
    const step = (cmp.baselineNet ?? 0) * criteria.notifyStep;
    const title = 'development improvement - not yet validated';
    if (!last || exp.summary.net >= last.net + step) {
      const body = `${exp.name} (experiment ${exp.id}): net profit ${exp.summary.net} vs the baseline ${cmp.baselineNet} (${cmp.improvementPct == null ? 'ratio not applicable' : `${cmp.improvementPct}%`}); max drawdown ${exp.summary.maxDrawdownPct}%, ${exp.summary.completedTrades} trades; raw null p ${exp.summary.nullTest?.p ?? 'none'}; ${cmp.why.join('; ')}. A development result on data seen before, not a validated strategy.`;
      const id = store.insertNotification(db, { campaignId: campaign.id, experimentId: exp.id, kind: 'target', title, body, dedupeKey: `target:${campaign.id}:${exp.id}`, at });
      if (id) store.setSetting(db, `lastNotified:${campaign.id}`, { experimentId: exp.id, net: exp.summary.net, at }, at);
    }
    if (cmp.shortlisted) store.insertNotification(db, { campaignId: campaign.id, experimentId: exp.id, kind: 'shortlisted', title: `${title}: unadjusted shortlist pass`, body: `${exp.name} (experiment ${exp.id}) passes the stress, the raw-p null, concentration and decision-gain conditions as well (unadjusted; the Holm-adjusted p is reported when the campaign completes). Still a development result; nothing is evaluated automatically.`, dedupeKey: `shortlisted:${campaign.id}:${exp.id}`, at });
  }

  // A defect replacement (CAMPAIGN-3.md section 8): re-queues a planned configuration whose result was invalidated
  // by a verified defect, with the defect, its verification and the correction as non-empty text; at most the
  // plan's number of replacements; the broken result is kept.
  function replaceDefective(campaignId, experimentId, { defect, verification, correction } = {}) {
    const c = requireCampaign(campaignId);
    for (const [k, v] of Object.entries({ defect, verification, correction })) if (typeof v !== 'string' || !v.trim()) throw new ResearchError(400, `${k} must be non-empty text`);
    const e = store.getExperiment(db, experimentId);
    if (!e || e.campaign_id !== campaignId) throw new ResearchError(404, `experiment ${experimentId} is not in campaign ${campaignId}`);
    if (!['done', 'failed'].includes(e.status)) throw new ResearchError(409, `experiment ${experimentId} is ${e.status}; only a done or failed result can be replaced`);
    if (e.config.defectReplacementOf) throw new ResearchError(409, 'a replacement cannot itself be replaced');
    const used = store.countReplacements(db, campaignId);
    const max = c.limits.replacements ?? 0;
    if (used >= max) throw new ResearchError(409, `the ${max} defect-replacement slots of this campaign are used`);
    if (!['planned', 'running', 'paused', 'done'].includes(c.status)) throw new ResearchError(409, `campaign ${campaignId} is ${c.status}`);
    const at = now();
    const config = { ...e.config, defectReplacementOf: e.id, label: `${e.config.label ?? e.name} (defect replacement of experiment ${e.id})` };
    const { added } = store.enqueue(db, campaignId, [{ stage: 3, name: `${e.name} #replacement`, hypothesis: `Defect replacement of experiment ${e.id}. Defect: ${defect.trim()} Verification: ${verification.trim()} Correction: ${correction.trim()}`, parentId: e.parent_id ?? null, baseFile: e.base_file, change: e.change, configHash: crypto.createHash('sha256').update(`${e.config_hash}:replacement:${e.id}`).digest('hex'), config, replacementOf: e.id, defect: { defect: defect.trim(), verification: verification.trim(), correction: correction.trim(), at } }], at);
    if (!added.length) throw new ResearchError(409, 'this experiment already has a replacement');
    if (c.status === 'done') store.setCampaignStatus(db, campaignId, 'paused', { at });
    store.logEvent(db, { campaignId, experimentId: added[0].id, at, level: 'warn', message: `defect replacement ${used + 1} of ${max} queued for experiment ${e.id} (${e.name}): ${defect.trim().slice(0, 200)}` });
    return { id: added[0].id, replacementOf: e.id, used: used + 1, max, campaignStatus: store.getCampaign(db, campaignId).status };
  }

  // The worker loop: runs until the queue is empty (then stage 3 is generated once for plans with combinations,
  // then Holm is applied, then done), the campaign is paused or cancelled, a limit is hit, or `until()` says to
  // stop. Returns why it stopped.
  function runWorker(campaignId, { until = () => false, onExperiment = null } = {}) {
    const campaign0 = requireCampaign(campaignId);
    if (!['planned', 'running', 'paused'].includes(campaign0.status)) return { reason: `campaign is ${campaign0.status}` };
    const limits = campaign0.limits, criteria = campaign0.criteria;
    const worker = store.claimWorker(db, campaignId, { pid: process.pid, host: os.hostname(), at: now(), staleMs: limits.staleHeartbeatMs });
    if (!worker) return { reason: 'another worker holds this campaign (live heartbeat)' };
    const workerId = `${worker.host}:${worker.pid}:${worker.token.slice(0, 6)}`;
    try {
      const rec = store.recoverInterrupted(db, campaignId, { at: now(), staleMs: limits.staleHeartbeatMs });
      if (rec.requeued.length || rec.failed.length) store.logEvent(db, { campaignId, at: now(), level: 'warn', message: `recovery: re-queued ${rec.requeued.join(', ') || 'none'}; failed after two attempts ${rec.failed.join(', ') || 'none'}` });
      // A planned campaign starts here; a paused one stays paused until the owner resumes it.
      if (campaign0.status === 'paused') return { reason: 'paused' };
      if (campaign0.status === 'planned') store.setCampaignStatus(db, campaignId, 'running', { at: now() });
      try {
        const m = marketFor(2);
        const c = store.getCampaign(db, campaignId);
        if (c.data_hash && c.data_hash !== m.dataHash) { stopCampaign(campaignId, `the market data changed since the campaign started (data hash ${m.dataHash.slice(0, 12)} vs ${c.data_hash.slice(0, 12)})`); return { reason: 'data changed' }; }
        if (!c.data_hash) store.updateCampaign(db, campaignId, { symbols_hash: m.symbolsHash, data_hash: m.dataHash, calibration_hash: m.calibrationHash });
      } catch (e) { stopCampaign(campaignId, `invalid data: ${e.message}`); return { reason: `invalid data: ${e.message}` }; }
      let stage3Built = !limits.combinations || store.getSetting(db, `stage3:${campaignId}`) != null;
      for (;;) {
        const c = store.getCampaign(db, campaignId);
        if (c.status === 'paused') { store.logEvent(db, { campaignId, at: now(), message: 'worker stopped: paused' }); return { reason: 'paused' }; }
        if (c.status === 'cancelled') return { reason: 'cancelled' };
        if (c.status !== 'running') return { reason: `campaign is ${c.status}` };
        if (until()) { store.setCampaignStatus(db, campaignId, 'paused', { at: now() }); store.logEvent(db, { campaignId, at: now(), message: 'worker stopped by its caller; campaign paused' }); return { reason: 'until' }; }
        const counts = store.countExperiments(db, campaignId);
        const used = counts.done + counts.failed;
        if (used >= limits.maxConfigs) { applyHolm(campaignId); stopCampaign(campaignId, `the configuration budget of ${limits.maxConfigs} is used (${used} run)`, 'done'); return { reason: 'budget' }; }
        if (c.elapsed_ms >= limits.maxHours * 3600_000) { applyHolm(campaignId); stopCampaign(campaignId, `the time budget of ${limits.maxHours} hours is used`, 'done'); return { reason: 'time' }; }
        const rp = resourceProblem(limits);
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
          applyHolm(campaignId);
          stopCampaign(campaignId, `every planned experiment has run (${counts.done} done, ${counts.failed} failed)`, 'done');
          return { reason: 'complete' };
        }
        const t0 = Date.now();
        const out = runExperiment(store.getCampaign(db, campaignId), exp);
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
    const planList = Object.values(plans).map((p) => ({ key: p.key, name: p.name, doc: path.basename(p.doc), plannedCount: p.plannedCount, replacements: p.replacements, limits: p.limits, criteria: p.criteria, status: campaignDocStatus(p.doc, p.required) }));
    return { simulated: true, codeRevision: CODE_REVISION, runnerVersion: RUNNER_VERSION, engine: ENGINES, period: developmentPeriod(), limits: LIMITS, criteria: CRITERIA, baselineFile: BASELINE_FILE, plans: planList, campaigns: campaigns.map((c) => campaignStatus(c.id)), active: active ? campaignStatus(active.id) : null, unseenNotifications: store.listNotifications(db, { unseenOnly: true, limit: 50 }).length };
  }
  function campaignStatus(id) {
    const c = requireCampaign(id);
    const pl = planFor(c);
    const counts = store.countExperiments(db, id);
    const running = store.listExperiments(db, id, { status: 'running', limit: 5 });
    const done = store.listExperiments(db, id, { status: 'done', limit: 10000 });
    const baseline = baselineOf(c);
    const leader = leaderOf(done, baseline ? { ...baseline } : null);
    const cleared = done.filter((e) => e.summary?.comparison?.clearsTarget).length;
    const shortlisted = done.filter((e) => e.summary?.comparison?.shortlisted).length;
    const holmSignificant = done.filter((e) => e.summary?.holm?.significant).length;
    return {
      id: c.id, name: c.name, plan: pl.key, planDoc: path.basename(pl.doc), stageNames: pl.stageNames, status: c.status, stopReason: c.stop_reason, createdAt: c.created_at, startedAt: c.started_at, finishedAt: c.finished_at, elapsedMs: c.elapsed_ms, lastRunAt: c.last_run_at,
      worker: store.workerAlive(db, id, { at: now(), staleMs: c.limits.staleHeartbeatMs }), counts, progress: counts.total ? (counts.done + counts.failed + counts.cancelled) / counts.total : 0,
      active: running.map((e) => ({ id: e.id, name: e.name, stage: e.stage, startedAt: e.started_at })),
      baseline: baseline ? { id: baseline.id, name: baseline.name, net: baseline.summary?.net ?? null, maxDrawdownPct: baseline.summary?.maxDrawdownPct ?? null, completedTrades: baseline.summary?.completedTrades ?? null, expectedNet: expectedBaselineNet } : null,
      leader: leader ? { id: leader.id, name: leader.name, net: leader.summary?.net ?? null, basis: leader.basis, comparison: leader.summary?.comparison ?? null, labels: leader.summary?.labels ?? null, holm: leader.summary?.holm ?? null } : null,
      cleared, shortlisted, holmSignificant, holm: store.getSetting(db, `holm:${id}`), replacements: { used: store.countReplacements(db, id), max: c.limits.replacements ?? 0 }, stage3: store.getSetting(db, `stage3:${id}`),
      hashes: { symbols: c.symbols_hash, data: c.data_hash, calibration: c.calibration_hash, doc: c.doc_sha256 }, codeRevision: c.code_revision, engineVersion: c.engine_version, period: c.period, limits: c.limits, criteria: c.criteria, baselineFile: c.baseline_file,
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
    return { id: e.id, stage: e.stage, ordinal: e.ordinal, name: e.name, hypothesis: e.hypothesis, parentId: e.parent_id, baseFile: e.base_file, change: e.change, status: e.status, attempts: e.attempts, startedAt: e.started_at, finishedAt: e.finished_at, durationMs: e.duration_ms, error: e.error, codeRevision: e.code_revision, dataHash: e.data_hash, configHash: e.config_hash, replacementOf: e.replacement_of ?? null, defect: e.defect ?? null,
      summary: s ? { net: s.net, startValue: s.startValue, endValue: s.endValue, totalReturnPct: s.totalReturnPct, annualisedReturnPct: s.annualisedReturnPct, maxDrawdownPct: s.maxDrawdownPct, avgInvestedPct: s.avgInvestedPct, turnoverPerYear: s.turnoverPerYear, costs: s.costs, completedTrades: s.completedTrades, openAtEnd: s.openAtEnd, lossExceededRisk: s.lossExceededRisk ?? null, topStock: s.topStock, nullP: s.nullTest?.p ?? null, holm: s.holm ?? null, bestFiveNet: s.bestFive?.adjustedNet ?? null, index: s.index, exposureMatched: s.exposureMatched,
        comparison: s.comparison ? { baselineExperimentId: s.comparison.baselineExperimentId, baselineNet: s.comparison.baselineNet, diffUsd: s.comparison.diffUsd, improvementPct: s.comparison.improvementPct, improvementApplicable: s.comparison.improvementApplicable, exposureGainUsd: s.comparison.exposureGainUsd, decisionGainUsd: s.comparison.decisionGainUsd, clearsTarget: s.comparison.clearsTarget, shortlisted: s.comparison.shortlisted, failed: s.comparison.failed, vsLeader: s.comparison.vsLeader, vsFamilyBaseline: s.comparison.vsFamilyBaseline ?? null } : null, labels: s.labels } : null };
  }
  function experiment(id) {
    const e = store.getExperiment(db, id);
    if (!e) throw new ResearchError(404, `experiment ${id} does not exist`);
    const parent = e.parent_id ? store.getExperiment(db, e.parent_id) : null;
    const base = e.base_file && /\.json$/.test(e.base_file) ? store.listExperiments(db, e.campaign_id, { stage: STAGES.reference, limit: 20 }).find((x) => x.base_file === e.base_file && x.name === e.base_file.replace(/\.json$/, '')) : null;
    return { ...briefOf(e), campaignId: e.campaign_id, config: e.config, summary: e.summary, parent: parent ? briefOf(parent) : null, base: base ? briefOf(base) : null, equity: store.getEquity(db, id), provenance: e.metrics?.provenance ?? null, engineVersion: e.engine_version, symbolsHash: e.symbols_hash, calibrationHash: e.calibration_hash, perStock: e.metrics?.perStock ?? null, metricsKeys: e.metrics ? Object.keys(e.metrics) : [] };
  }
  const notifications = (opts) => store.listNotifications(db, opts);
  const markSeen = (ids) => store.markSeen(db, ids, now());
  const events = (id, limit) => store.listEvents(db, id, limit);
  function close() { try { db.close(); } catch { /* ignore */ } }

  return { file, db, createCampaign, start: (id) => setStatus(id, 'running'), pause: (id) => setStatus(id, 'paused'), resume: (id) => setStatus(id, 'running'), cancel: (id) => setStatus(id, 'cancelled'), runWorker, overview, campaignStatus, experiments, experiment, notifications, markSeen, events, close, notifyFor: (campaignId, exp) => notify(requireCampaign(campaignId), exp), applyHolm, replaceDefective, getCampaign: (id) => store.getCampaign(db, id), listExperimentsRaw: (id, opts) => store.listExperiments(db, id, opts), logDir: path.join(dir, LOG_DIR_NAME), revision: CODE_REVISION };
}
