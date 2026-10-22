// HXR service (strategy/hxr/ENGINE-SPEC.md sections 1 and 10): the data
// download job, readiness, cost calibration, the selection and evaluation runs
// with their append-only ledgers, the experiment log, the prospective
// simulated account with news polling, and the overview for the page.
//
// Simulation only and real workspace only: it reads and writes only
// data/hxr-sim.sqlite (store.js refuses the portfolio and Strategy Lab files),
// never opens the portfolio database, never sends a notification and never
// calls a broker or paper-trading endpoint. Market data comes only through
// source.js (data.alpaca.markets). Runs use daily bars and are fast, so they
// run inline; the loop yields between engine runs so the server stays
// responsive.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as store from './store.js';
import {
  HXR_DIR, HXR_CONFIG_DIR, PREREG, loadHxrConfig, loadHxrUniverse, loadHxrPeriods, loadHxrCriteria, listHxrConfigs, validateHxrConfig,
  hxrConfigHash, variantConfig, holdDayOneConfig, halfSpreadFor, basketSymbols, excludedDates, canonicalJson, configFileName, criterion,
} from './config.js';
import { createHxrSource, BAR_FINAL_AFTER_CLOSE_MIN } from './source.js';
import { buildInputs, buildSpreadTable, halfSpreadFn, readiness as buildReadiness, sampledSpreadDays, spreadSampleFromQuotes, median, SPREAD_METHOD } from './data.js';
import { createEngine, runBacktest, nextSession, firstSessionOnOrAfter, historyLength, ENGINE_VERSION } from './engine.js';
import { computeRunMetrics, compareArms, compareBenchmarks, fillComparison, evaluateCriteria, evaluateValidation, selectCandidate, PASS_MEANING } from './metrics.js';
import { historyLengthFor } from './engine.js';
import { isTradingDay, previousTradingDay, regularSessionBounds } from '../calendar.js';
import { todayIn, addDays, NY } from '../time.js';
import { redact } from '../config.js';

export const NOTICE = 'Simulated only. No order is sent to any broker or paper-trading platform.';
export const REAL_ONLY = 'HXR runs on real market data in the real workspace only';
export const FROZEN_VERSION = 'hxr-1.0.0';
// The pre-registered arms of hxr-prereg-3a (PREREGISTRATION-3a.md sections 1-5):
// exactly these files. Six candidates (X1 and X2 with fresh-entry policies A, B
// and C) can be picked; X3A-C are the owner's comparison, run and reported but
// never picked; the day-one hold benchmark is derived at run time. The earlier
// pre-registrations' candidates are superseded and never run.
export const HOLD_FILE = 'hxr-hold-0.1.0.json';
export const CANDIDATE_FILES = ['hxr-x1a-0.3.0.json', 'hxr-x1b-0.3.0.json', 'hxr-x1c-0.3.0.json', 'hxr-x2a-0.3.0.json', 'hxr-x2b-0.3.0.json', 'hxr-x2c-0.3.0.json'];
export const COMPARISON_FILES = ['hxr-x3a-0.3.0.json', 'hxr-x3b-0.3.0.json', 'hxr-x3c-0.3.0.json'];
export const SUPERSEDED_FILES = ['hxr-c1-0.1.0.json', 'hxr-c2-0.1.0.json', 'hxr-c3-0.1.0.json', 'hxr-x1-0.2.0.json', 'hxr-x2-0.2.0.json', 'hxr-x3-0.2.0.json'];
const SUPERSEDED_PREREG = { 'hxr-c1-0.1.0.json': 'hxr-prereg-1', 'hxr-c2-0.1.0.json': 'hxr-prereg-1', 'hxr-c3-0.1.0.json': 'hxr-prereg-1', 'hxr-x1-0.2.0.json': 'hxr-prereg-2', 'hxr-x2-0.2.0.json': 'hxr-prereg-2', 'hxr-x3-0.2.0.json': 'hxr-prereg-2' };
export const PREREG_FILES = ['PREREGISTRATION.md', 'PREREGISTRATION-2.md', 'PREREGISTRATION-3.md', 'PREREGISTRATION-3a.md', 'ENGINE-SPEC.md', 'universe-hxr-v3.json', 'periods-hxr-v3.json', 'criteria-hxr-v3a.json'];
export const DAY_ONE_HOLD = 'hold-day-one';
// PREREGISTRATION-3.md section 5.4 and PREREGISTRATION-3a.md section 1: one
// setting changed at a time, for the winning candidate only, on the development
// period only, reported only (dotted paths into the config).
export const NEIGHBOURS = deepFreezeList({
  x1: [{ 'rule.pivotSessions': 3 }, { 'rule.pivotSessions': 8 }, { 'rule.reboundMultiple': 0.5 }, { 'rule.reboundMultiple': 1.5 }, { 'rule.bufferMultiple': 0.25 }, { 'rule.bufferMultiple': 1 }, { 'initialLoss.multiple': 2 }, { 'initialLoss.multiple': 3 }, { 'risk.plannedLossPerTradeUsd': 100 }, { 'risk.plannedLossPerTradeUsd': 200 }],
  x2: [{ 'rule.multiple': 2.5 }, { 'rule.multiple': 3.5 }, { 'rule.pivotSessions': 3 }, { 'rule.pivotSessions': 8 }, { 'rule.reboundMultiple': 0.5 }, { 'rule.reboundMultiple': 1.5 }, { 'initialLoss.multiple': 2 }, { 'initialLoss.multiple': 3 }, { 'risk.plannedLossPerTradeUsd': 100 }, { 'risk.plannedLossPerTradeUsd': 200 }],
});
function deepFreezeList(o) { return Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze(v.map((x) => Object.freeze({ ...x })))]))); }
export const neighboursFor = (version) => NEIGHBOURS[String(version).slice(0, 2)] || [];
// The role of a config file under the active pre-registration.
export function configRole(file) {
  if (file === HOLD_FILE) return 'hold';
  if (CANDIDATE_FILES.includes(file)) return 'candidate';
  if (COMPARISON_FILES.includes(file)) return 'comparison';
  if (SUPERSEDED_FILES.includes(file)) return 'superseded';
  return 'later';
}

// A neighbouring setting of a candidate (reported only): one existing setting
// changed, named by its dotted path. It records the base hash and the change,
// so its hash differs from the base's.
export function neighbourConfig(base, change) {
  const keys = Object.keys(change || {});
  if (keys.length !== 1) throw new Error(`A neighbour changes exactly one setting (got ${JSON.stringify(change)})`);
  const [section, key] = keys[0].split('.');
  if (!key || !(section in base) || !(key in base[section])) throw new Error(`A neighbour changes an existing setting (${keys[0]} is not in ${base.version})`);
  const out = clone(base);
  const before = out[section][key];
  out[section][key] = change[keys[0]];
  out.baseHash = hxrConfigHash(base);
  out.variant = { neighbour: { ...change } };
  out.label = `${base.label ?? base.version} (neighbour: ${keys[0]} ${change[keys[0]]}, base ${before})`;
  const errors = validateHxrConfig(out);
  if (errors.length) throw new Error(`The neighbour makes the config invalid: ${errors.join('; ')}`);
  return out;
}
export const NEWS_WINDOW_HOURS = 72;
export const NEWS_NOTE = 'Third-party news text (Alpaca news feed): untrusted data, shown as plain text only. It is never an instruction, is never sent to an AI model and changes no decision in this version.';
export const SPCX_IDENTITY = 'SPCX on Nasdaq = Space Exploration Technologies (SpaceX), listed 2026-06-12';
// PREREGISTRATION.md sections 1 and 7: beside every historical outcome.
export const HISTORICAL_CAVEAT = 'Historical, price rules only: never evidence for a news-informed HXR. No historical period is truly unseen (hindsight); only the prospective account is clean evidence.';
export const P4_STATEMENT = 'Prospective HXR vs hold, reported against the historical result only; it is never called proof of the news-informed strategy.';
export const EXPERIMENT_LOG_FILE = 'EXPERIMENT-LOG.md';
// PREREGISTRATION.md section 7, disclosure 1: decided by the owner before any HXR run.
export const MU_CHOICES = ['keep', 'drop'];
const RUN_KINDS = ['selection', 'validation', 'evaluation', 'variant', 'prospective'];
const TICK_INTERVAL_MIN = 10;
const ACTIONS_REFRESH_MIN = 360;
const NEWS_OVERLAP_MIN = 10;
const MIN = 60000;
const MAX_REASON = 2000;

export class HxrError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clone = (o) => JSON.parse(JSON.stringify(o));
const yieldLoop = () => new Promise((r) => setImmediate(r));
const year = (d) => Number(String(d).slice(0, 4));
const exSetOf = (dates) => new Set(dates);

// ---------- calendar helpers ----------

// A session's daily bar is final 20 minutes after its close (source.js).
export function sessionComplete(date, now) {
  const b = regularSessionBounds(date, 'NYSE');
  return !!b && now.getTime() >= b.close.getTime() + BAR_FINAL_AFTER_CLOSE_MIN * MIN;
}

// The latest NYSE session whose daily bar is final at `now`.
export function latestCompleteSession(now) {
  let d = todayIn(NY, now);
  if (!isTradingDay(d, 'NYSE')) d = previousTradingDay(d, 'NYSE');
  while (!sessionComplete(d, now)) d = previousTradingDay(d, 'NYSE');
  return d;
}

// The first session whose regular open is after `now` (excluded sessions skipped).
export function firstSessionAfter(now, excluded = []) {
  const ex = exSetOf(excluded);
  let d = todayIn(NY, now);
  for (let i = 0; i < 40; i++, d = addDays(d, 1)) {
    if (!isTradingDay(d, 'NYSE') || ex.has(d)) continue;
    if (regularSessionBounds(d, 'NYSE').open.getTime() > now.getTime()) return d;
  }
  throw new Error('No NYSE session found in the next 40 days');
}

// The session n sessions before `date` (excluded sessions skipped).
function sessionsBack(date, n, excluded) {
  const ex = exSetOf(excluded);
  let d = date;
  for (let i = 0; i < n; i++) {
    d = previousTradingDay(d, 'NYSE');
    while (ex.has(d)) d = previousTradingDay(d, 'NYSE');
  }
  return d;
}

const nextOpenOf = (date, excluded) => regularSessionBounds(nextSession(date, excluded), 'NYSE').open;

// ---------- small views ----------

function headline(m) {
  if (!m) return null;
  return {
    endValue: m.endValue ?? null, totalReturnPct: m.totalReturnPct ?? null, annualisedReturnPct: m.annualisedReturnPct ?? null,
    maxDrawdownPct: m.maxDrawdownPct ?? null, returnToDrawdown: m.returnToDrawdown ?? null, roundTrips: m.roundTrips ?? null,
    sessions: m.sessions ?? null, timeInCashPct: m.timeInCashPct ?? null, freshEntries: m.freshEntries?.count ?? null, initialLossExits: m.initialLossExits ?? null,
  };
}

const runSummary = (r) => {
  if (!r) return null;
  const { metrics, ...rest } = r;
  return { ...rest, headline: headline(metrics), simulated: true };
};

function cleanReason(reason) {
  if (reason == null) return '';
  if (typeof reason !== 'string') throw new HxrError(400, 'reason must be text');
  const r = reason.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (r.length > MAX_REASON) throw new HxrError(400, `reason must be at most ${MAX_REASON} characters`);
  return r;
}

// ---------- pre-registered files and the experiment log file ----------

// The files fixed before any result (PREREGISTRATION.md, ENGINE-SPEC.md, the
// universe, periods and criteria, and the four 0.1.0 configs), each with its
// sha256 and one combined hash. Any other config in configs/ (a frozen or
// later version) is listed apart under `later`, never mixed into that set.
export function preregManifest({ dir = HXR_DIR, configDir = HXR_CONFIG_DIR, versions = [] } = {}) {
  const fixed = [...PREREG_FILES.map((f) => path.join(dir, f)), ...[HOLD_FILE, ...CANDIDATE_FILES, ...COMPARISON_FILES].map((f) => path.join(configDir, f))];
  const rel = (f) => path.relative(dir, f).split(path.sep).join('/');
  const files = fixed.map((f) => ({ file: rel(f), sha256: sha(fs.readFileSync(f)) }));
  // hxr-prereg-1's C1-C3: listed apart, never part of this set or its hash.
  const superseded = SUPERSEDED_FILES.filter((f) => fs.existsSync(path.join(configDir, f))).map((f) => ({ file: rel(path.join(configDir, f)), sha256: sha(fs.readFileSync(path.join(configDir, f))), prereg: SUPERSEDED_PREREG[f] }));
  const known = new Set([HOLD_FILE, ...CANDIDATE_FILES, ...COMPARISON_FILES, ...SUPERSEDED_FILES]);
  const later = fs.readdirSync(configDir).filter((f) => f.endsWith('.json') && !known.has(f)).sort().map((f) => {
    const full = path.join(configDir, f);
    const out = { file: rel(full), sha256: sha(fs.readFileSync(full)), version: null, configHash: null, frozenAt: null, error: null };
    try {
      const c = loadHxrConfig(full);
      const v = versions.find((x) => x.version === c.version && x.configHash === hxrConfigHash(c));
      Object.assign(out, { version: c.version, configHash: hxrConfigHash(c), frozenAt: v?.frozenAt ?? null });
    } catch (e) { out.error = e.message; }
    return out;
  });
  return { id: PREREG, files, hash: sha(files.map((x) => `${x.file} ${x.sha256}`).join('\n')), later, superseded };
}

// The markdown tables of EXPERIMENT-LOG.md as { header, rows } (cells as plain
// text), so the page can show the entries made before the code existed.
export function parseExperimentLog(text) {
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  let header = null;
  const rows = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const c = cells(line);
    if (!header) { header = c; continue; }
    if (c.every((x) => /^:?-+:?$/.test(x))) continue;
    if (c.length === header.length) rows.push(c);
  }
  return { header: header || [], rows };
}

export function experimentLogFile(dir = HXR_DIR) {
  const full = path.join(dir, EXPERIMENT_LOG_FILE);
  try {
    const raw = fs.readFileSync(full);
    return { file: EXPERIMENT_LOG_FILE, sha256: sha(raw), ...parseExperimentLog(raw.toString('utf8')), error: null };
  } catch (e) {
    return { file: EXPERIMENT_LOG_FILE, sha256: null, header: [], rows: [], error: `${EXPERIMENT_LOG_FILE} could not be read (${e.code || 'error'})` };
  }
}

// ---------- the demo workspace ----------

const METHODS = [
  'overview', 'fetchData', 'fetchStatus', 'readiness', 'setSpcxConfirmed', 'setMuDecision', 'reviewMove', 'runSelection', 'runValidation', 'runEvaluation', 'startProspective', 'prospectiveTick',
  'pauseProspective', 'resumeProspective', 'prospectiveStatus', 'listRuns', 'getRun', 'experiments', 'ledger', 'news',
];

// The demo workspace holds synthetic data only, and HXR is never synthetic.
function demoHxr() {
  const refuse = () => { throw new HxrError(400, REAL_ONLY); };
  const out = { demo: true, tick: async () => ({ skipped: true, reason: REAL_ONLY }), close() {} };
  for (const m of METHODS) out[m] = refuse;
  return out;
}

// ---------- the service ----------

export function createHxr(ctx, opts = {}) {
  if (ctx.mode !== 'real') return demoHxr();
  const cfg = ctx.cfg;
  const file = opts.file || store.hxrDbFile(cfg);
  const db = store.openHxrDb(file);
  const clock = opts.clock || (() => new Date());
  const universe = loadHxrUniverse();
  const periods = loadHxrPeriods(undefined, { universe });
  const criteria = loadHxrCriteria(opts.criteriaPath);
  const excluded = excludedDates(periods);
  const uSyms = new Map(universe.symbols.map((s) => [s.symbol, s]));
  const safe = (m) => redact(String(m ?? ''), cfg);
  const sec = cfg?.secrets || {};
  const keysSet = !!(sec.ALPACA_API_KEY_ID && sec.ALPACA_API_SECRET_KEY);
  // Read-only market data (keys from .env only, in request headers only).
  const source = opts.source !== undefined ? opts.source : keysSet
    ? createHxrSource({ keyId: sec.ALPACA_API_KEY_ID, secretKey: sec.ALPACA_API_SECRET_KEY, fetchImpl: opts.fetchImpl, sleep: opts.sleep, now: clock })
    : null;
  const tickEveryMs = (opts.tickIntervalMin ?? TICK_INTERVAL_MIN) * MIN;
  let busy = null, fetching = false, ticking = false, closed = false, lastAutoTick = 0, readyCache = null;

  const wrap = (data = {}) => ({ ...data, simulated: true, workspace: 'real', notice: NOTICE });
  const loadArm = (f) => loadHxrConfig(path.join(HXR_CONFIG_DIR, f));
  const holdConfig = () => loadArm(HOLD_FILE);
  const floorBps = () => holdConfig().costs.halfSpreadFloorBps;
  const spcx = () => store.getSetting(db, 'spcxConfirmed', null);
  const spcxConfirmed = () => spcx()?.confirmed === true;
  const confirmedList = () => (spcxConfirmed() ? universe.symbols.filter((s) => s.identity && s.identity !== 'confirmed').map((s) => s.symbol) : []);
  const noKeys = () => new HxrError(400, 'Alpaca market-data keys are not set: add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to .env (a free Alpaca market-data account; no trading or paper-trading API is used), then restart Signal Desk.');

  function checkSymbol(symbol) {
    const s = String(symbol ?? '').trim().toUpperCase();
    if (!uSyms.has(s)) throw new HxrError(400, `${s || 'The symbol'} is not in the HXR universe (${[...uSyms.keys()].join(', ')})`);
    return s;
  }

  function claim(kind) {
    if (closed) throw new HxrError(503, 'HXR is closed');
    if (busy) throw new HxrError(409, `Another HXR run is in progress (${busy.kind}, started ${busy.startedAt}). Try again when it has finished.`);
    if (fetching) throw new HxrError(409, 'An HXR data download is running; runs wait until it has finished so they read one consistent data set.');
    busy = { kind, startedAt: clock().toISOString() };
  }

  // ---------- readiness and calibration ----------

  function fingerprint(today) {
    const one = (sql) => db.prepare(sql).get();
    return JSON.stringify([
      today, one('SELECT COUNT(*) n, MAX(fetched_at) f FROM hxr_bars'), one('SELECT COUNT(*) n, MAX(fetched_at) f FROM hxr_first15'),
      one('SELECT COUNT(*) n, MAX(fetched_at) f FROM hxr_spread_samples'), one('SELECT COUNT(*) n, MAX(fetched_at) f FROM hxr_corporate_actions'),
      store.getSetting(db, 'reviewedMoves', []),
    ]);
  }

  // The readiness checklist (data.js), cached until the stored data changes.
  // Gates always recompute it.
  function readinessNow({ fresh = false } = {}) {
    const today = todayIn(NY, clock());
    const key = fingerprint(today);
    if (fresh || !readyCache || readyCache.key !== key) {
      readyCache = { key, value: buildReadiness(db, { universe, periods, today, reviewed: store.getSetting(db, 'reviewedMoves', []) }) };
    }
    return readyCache.value;
  }

  function readinessSummary(r) {
    return {
      today: r.today, lastCompleteSession: r.lastCompleteSession,
      periods: Object.fromEntries(Object.entries(r.periods).map(([k, p]) => [k, { basket: p.basket, start: p.start, end: p.end, usable: p.usable, costsCalibrated: p.costsCalibrated, reasons: p.reasons }])),
      symbols: r.symbols.map((s) => ({ symbol: s.symbol, status: s.status, notes: s.notes })),
    };
  }

  function spreadTable(toYear) {
    return buildSpreadTable(db, universe, { floorBps: floorBps(), toYear });
  }

  function spreadStatus() {
    const t = spreadTable(year(todayIn(NY, clock())));
    const counts = new Map(db.prepare('SELECT symbol, COUNT(*) n, SUM(median_half_spread_bps IS NOT NULL) usable FROM hxr_spread_samples GROUP BY symbol').all().map((r) => [r.symbol, r]));
    return {
      method: SPREAD_METHOD, floorBps: t.floorBps, hash: t.hash, table: t.table, firstSampled: t.firstSampled,
      samples: Object.fromEntries(universe.symbols.map((s) => [s.symbol, { stored: counts.get(s.symbol)?.n ?? 0, usable: counts.get(s.symbol)?.usable ?? 0 }])),
      calibrated: universe.symbols.every((s) => t.firstSampled[s.symbol] != null),
    };
  }

  function dataStatus() {
    const by = (sql) => new Map(db.prepare(sql).all().map((r) => [r.symbol, { ...r }]));
    const bars = by('SELECT symbol, COUNT(*) n, MIN(date) first, MAX(date) last, MAX(fetched_at) fetchedAt FROM hxr_bars GROUP BY symbol');
    const f15 = by('SELECT symbol, COUNT(*) n, MIN(date) first, MAX(date) last FROM hxr_first15 GROUP BY symbol');
    const news = by('SELECT symbol, COUNT(*) n FROM hxr_news_symbols GROUP BY symbol');
    return universe.symbols.map((s) => {
      const b = bars.get(s.symbol), f = f15.get(s.symbol);
      return {
        symbol: s.symbol, exchange: s.exchange, listedFrom: s.listedFrom,
        bars: { count: b?.n ?? 0, first: b?.first ?? null, last: b?.last ?? null, fetchedAt: b?.fetchedAt ?? null },
        first15: { count: f?.n ?? 0, first: f?.first ?? null, last: f?.last ?? null },
        corporateActions: store.listCorporateActions(db, { symbol: s.symbol }).length, news: news.get(s.symbol)?.n ?? 0,
      };
    });
  }

  const preregFiles = () => preregManifest({ versions: store.listVersions(db) });

  // ---------- engine runs ----------

  // Engine inputs for one basket and period: the stored data, read once.
  function prepare(period, symbols) {
    const spread = spreadTable(year(period.end));
    const inputs = buildInputs(db, {
      universe, symbols: symbols.map((s) => s.symbol), warmupFrom: period.warmupFrom, end: period.end, excludedSessions: excluded,
      spreadTable: spread, start: period.start, confirmed: confirmedList(),
    });
    return { spread, inputs, calibrated: halfSpreadFn(spread) };
  }

  // One backtest; the half-spread follows the config (floor, then any variant multiplier).
  function backtest(config, period, prep, label) {
    return runBacktest({
      config, symbols: prep.inputs.symbols, period: { warmupFrom: period.warmupFrom, start: period.start, end: period.end },
      inputs: { ...prep.inputs, halfSpreadBps: halfSpreadFor(config, prep.calibrated) }, excludedSessions: excluded, label,
    });
  }

  function createRunRow(kind, { label, config, basket, period, symbols, prep, contaminated, reason, at }) {
    return store.createRun(db, {
      kind, label, version: config.version, configHash: hxrConfigHash(config), config, basket, symbols: symbols.map((s) => s.symbol), period,
      fillModel: config.execution.fillModel, delay: config.execution.delaySessions, dataHash: prep.inputs.dataHash, calibrationHash: prep.spread.hash,
      status: 'running', contaminated, reason: reason || null, createdAt: at,
    });
  }

  function storeRun(id, result, metrics, extra, at) {
    store.insertFills(db, id, result.fills);
    store.insertDecisions(db, id, result.decisions);
    store.insertEpisodes(db, id, result.episodes);
    store.insertEquity(db, id, result.equity);
    store.updateRun(db, id, {
      status: 'done', dataHash: result.meta.dataHash, calibrationHash: result.meta.calibrationHash, metrics, finishedAt: at,
      details: {
        meta: result.meta, roundTrips: result.roundTrips, openExits: result.openExits, pendingAtEnd: result.pendingAtEnd, dividends: result.dividends,
        splits: result.splits, warnings: result.warnings, receivables: result.receivables, sleeves: result.sleeves, ...extra,
      },
    });
  }

  // Runs every planned arm in memory (yielding between them), then stores
  // everything in one transaction with `finalize`. A failure marks the runs
  // failed and stores no result.
  async function executePlan(plan, finalize) {
    const at = clock().toISOString();
    const preps = new Map();
    try {
      for (const p of plan) {
        const key = `${p.period.start}|${p.symbols.map((s) => s.symbol).join(',')}`;
        if (!preps.has(key)) preps.set(key, prepare(p.period, p.symbols));
        p.prep = preps.get(key);
      }
    } catch (e) {
      throw new HxrError(409, `The engine inputs could not be built from the stored data, so nothing was run: ${safe(e.message)}`);
    }
    for (const p of plan) p.id = createRunRow(p.kind, { ...p, at });
    try {
      for (const p of plan) {
        await yieldLoop();
        if (closed) throw new Error('HXR was closed while the run was in progress');
        p.result = backtest(p.config, p.period, p.prep, p.label);
        p.metrics = computeRunMetrics(p.result);
      }
    } catch (e) {
      const msg = safe(e.message);
      try {
        for (const p of plan) store.updateRun(db, p.id, { status: 'failed', error: msg, finishedAt: clock().toISOString() });
      } catch { /* closed: the next start marks them failed */ }
      throw new HxrError(500, `The run failed and no result was stored: ${msg}`);
    }
    const doneAt = clock().toISOString();
    return store.tx(db, () => {
      for (const p of plan) storeRun(p.id, p.result, p.metrics, { role: p.role, arm: p.arm ?? null, variant: p.variantKey ?? null, left: p.left ?? null }, doneAt);
      return finalize(doneAt);
    });
  }

  const runRef = (p) => ({ id: p.id, kind: p.kind, name: p.name ?? null, role: p.role ?? null, arm: p.arm ?? null, variant: p.variantKey ?? null, label: p.label, version: p.config.version, configHash: hxrConfigHash(p.config), headline: headline(p.metrics) });

  // Why a period cannot be run (null when it can): every basket member
  // complete for it, and a usable opening-quote sample (spread calibration)
  // for each of them.
  function periodProblem(r, k) {
    const p = r.periods[k];
    if (!p.usable) return `The ${k} period is not ready (readiness checklist, GET /api/hxr/readiness): ${p.reasons.slice(0, 8).join('; ')}${p.reasons.length > 8 ? `; and ${p.reasons.length - 8} more` : ''}.`;
    const t = spreadTable(year(p.end));
    const uncalibrated = p.members.filter((m) => t.firstSampled[m.symbol] == null).map((m) => m.symbol);
    if (!p.costsCalibrated || uncalibrated.length) return `The ${k} period has no spread calibration for ${uncalibrated.join(', ') || 'every stock'} (no usable opening-quote sample stored). Download the data first.`;
    return null;
  }

  function requireUsable(r, keys) {
    for (const k of keys) {
      const problem = periodProblem(r, k);
      if (problem) throw new HxrError(409, `${problem} Nothing was run.`);
    }
  }

  // ---------- the pending MU decision (PREREGISTRATION.md section 7, disclosure 1) ----------

  const muDecision = () => store.getSetting(db, 'muDecision', null);

  // Before any run the owner records whether MU stays in the evaluation. Dropping
  // it changes basket A, its sleeves and G6 (4 of 5 leave-one-stock-out runs),
  // which hxr-prereg-1 states for five stocks only, so it needs a restated
  // pre-registration and nothing runs (conservative reading, never invented here).
  function requireMuDecision() {
    const d = muDecision();
    if (!d) throw new HxrError(409, 'Record the pending MU decision first (PREREGISTRATION.md section 7, disclosure 1): keep MU in the evaluation, or drop it for strict separation from the Strategy Lab holdout window. It can only be made before any HXR run. Nothing was run.');
    if (d.choice !== 'keep') {
      throw new HxrError(409, `You chose to drop MU from the evaluation (${d.at}). ${PREREG} defines basket A, its equal sleeves and G6 (at least ${criterion(criteria, 'G6')?.minPassing} of ${basketSymbols(universe, 'A').length} leave-one-stock-out runs) for ${basketSymbols(universe, 'A').length} stocks, so dropping MU needs them restated as a new pre-registered version in strategy/hxr before any run. Nothing was run. Until the first run you can record "keep" instead.`);
    }
    return d;
  }

  function setMuDecision({ choice, confirm } = {}) {
    if (confirm !== true) throw new HxrError(400, 'Recording the MU decision needs confirm: true.');
    if (!MU_CHOICES.includes(choice)) throw new HxrError(400, `choice must be ${MU_CHOICES.map((c) => JSON.stringify(c)).join(' or ')}`);
    const runs = store.listLedger(db).filter((e) => e.prereg === PREREG);
    if (runs.length) throw new HxrError(409, `The MU decision had to be made before any HXR run; ${runs.length} selection or evaluation run(s) are already recorded for ${PREREG}, so it is fixed as ${muDecision()?.choice ?? 'not recorded'}.`);
    const at = clock().toISOString();
    const rec = { choice, at, by: 'the owner, through the HXR page (real workspace)', prereg: PREREG };
    store.tx(db, () => {
      store.setSetting(db, 'muDecisions', [...store.getSetting(db, 'muDecisions', []), rec]);
      store.setSetting(db, 'muDecision', rec);
      store.appendExperiment(db, {
        at, what: choice === 'keep' ? 'MU decision: keep MU in the evaluation' : 'MU decision: drop MU from the evaluation', version: PREREG, dataTouched: 'none', resultsSeen: 'no',
        note: choice === 'keep'
          ? 'Recorded before any HXR run. MU stays in basket A; the overlap of the evaluation period with the Strategy Lab holdout window for MU stays disclosed.'
          : `Recorded before any HXR run. Dropping MU needs basket A, its sleeves and G6 restated as a new pre-registered version; ${PREREG} runs nothing until then.`,
      });
    });
    return wrap({ muDecision: rec, note: choice === 'keep' ? 'Recorded: MU stays in the evaluation. You can run the selection.' : `Recorded: drop MU. ${PREREG} runs nothing until a restated pre-registration exists; until the first run you can record "keep" instead.` });
  }

  // ---------- reviewed overnight moves (readiness escape hatch) ----------

  // The owner checked a flagged split-like overnight move against another
  // source and records it as not a split. Append-only and logged.
  function reviewMove({ symbol, date, reason, confirm } = {}) {
    if (confirm !== true) throw new HxrError(400, 'Recording a reviewed overnight move needs confirm: true.');
    const sym = checkSymbol(symbol);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) throw new HxrError(400, 'date must be YYYY-MM-DD');
    const why = cleanReason(reason);
    if (!why) throw new HxrError(400, 'A reviewed move needs a written reason: what you checked, and why it is not a split.');
    const list = store.getSetting(db, 'reviewedMoves', []);
    if (list.some((x) => x.symbol === sym && x.date === date)) throw new HxrError(409, `The ${sym} move on ${date} is already recorded as reviewed.`);
    const c = readinessNow({ fresh: true }).symbols.find((x) => x.symbol === sym)?.splitScan?.candidates?.find((x) => x.date === date);
    if (!c) throw new HxrError(409, `No split-like overnight move is flagged for ${sym} on ${date}, so there is nothing to review.`);
    const at = clock().toISOString();
    const rec = { symbol: sym, date, reason: why, at, by: 'the owner, through the HXR page (real workspace)', move: { prevSession: c.prevSession, prevClose: c.prevClose, open: c.open, ratio: c.ratio, looksLike: c.looksLike } };
    store.tx(db, () => {
      store.setSetting(db, 'reviewedMoves', [...list, rec]);
      store.appendExperiment(db, {
        at, what: 'readiness: overnight move reviewed (not a split)', version: null, resultsSeen: 'no', note: why,
        dataTouched: `${sym} close ${c.prevSession} and open ${date} (open/previous close ${c.ratio}, looked like ${c.looksLike})`,
      });
    });
    readyCache = null;
    return wrap({ reviewed: rec, note: `Recorded: the ${sym} move on ${date} no longer blocks readiness. The record is kept with its reason and time.` });
  }

  // ---------- selection (PREREGISTRATION.md section 8) ----------

  async function runSelection({ confirm, reason } = {}) {
    if (confirm !== true) throw new HxrError(400, 'The development pick (selection run) needs confirm: true. It uses the development period once for this pre-registration.');
    const why = cleanReason(reason);
    requireMuDecision();
    if (criteria.selection?.pickRule === 'pending_owner_choice') {
      throw new HxrError(409, "The development pick rule is pending the owner's choice (PREREGISTRATION-3a.md section 2): record amendment 3b (selection.pickRule = ending_value or return_to_drawdown in criteria-hxr-v3a.json, and an EXPERIMENT-LOG.md entry) before the development pick. Nothing was run.");
    }
    const prior = store.listLedger(db, { kind: 'selection' }).filter((e) => e.prereg === PREREG);
    if (prior.length && !why) {
      throw new HxrError(409, `The development pick was already run for ${PREREG} (${prior.length} time(s), last ${prior.at(-1).at}). A repeat needs a written reason, is marked contaminated and can never freeze a version.`);
    }
    const contaminated = prior.length > 0;
    requireUsable(readinessNow({ fresh: true }), ['development']);
    claim('selection');
    try {
      const period = periods.periods.development;
      const symbols = basketSymbols(universe, period.basket);
      const hold = holdConfig();
      const cands = CANDIDATE_FILES.map(loadArm), comps = COMPARISON_FILES.map(loadArm);
      // The day-one hold is the candidates' own initial allocation, held: identical for every candidate sharing the sizing settings.
      const dayOne = holdDayOneConfig(cands[0]);
      const arms = [
        { name: hold.version, role: 'hold', config: hold },
        { name: DAY_ONE_HOLD, role: 'hold_day_one', config: dayOne },
        ...cands.map((c) => ({ name: c.version, role: 'candidate', config: c })),
        ...comps.map((c) => ({ name: c.version, role: 'comparison', config: c })),
      ];
      const tag = contaminated ? ' [repeat: contaminated]' : '';
      const plan = arms.map((a) => ({
        ...a, arm: a.name, variantKey: 'main', kind: 'selection', period, symbols, basket: period.basket, contaminated, reason: why,
        label: `Development pick (in-sample, ${period.start} to ${period.end}): ${a.config.label}${tag}`,
      }));
      // Assumed vs realistically available fills for every arm (reported only; the pick uses the base-cost runs).
      const fillPlan = arms.map((a) => ({
        name: a.name, role: 'fills', arm: a.name, variantKey: 'vw15', config: variantConfig(a.config, { fillModel: 'vw15' }), kind: 'variant',
        period, symbols, basket: period.basket, contaminated, reason: why,
        label: `Development pick (in-sample, ${period.start} to ${period.end}): ${a.config.label}, first 15-minute VWAP fills (reported)${tag}`,
      }));
      const setHash = sha(canonicalJson(arms.map((a) => [a.name, hxrConfigHash(a.config)])));
      const byRole = (role) => plan.find((p) => p.role === role);
      let choice = null, frozen = null, frozenNote = null, neighbours = null;
      const nPlan = [];
      await executePlan([...plan, ...fillPlan], (at) => {
        plan.forEach((p, i) => {
          p.fills = fillComparison(p.result, fillPlan[i].result);
          store.updateRun(db, p.id, { details: { ...store.getRun(db, p.id).details, fills: p.fills, fillsRunId: fillPlan[i].id } });
        });
        const holdM = byRole('hold').metrics, dayOneM = byRole('hold_day_one').metrics;
        // Only the six candidates can be picked; X3A-C are the owner's comparison.
        choice = selectCandidate(criteria.selection, { hold: holdM, holdDayOne: dayOneM, candidates: plan.filter((p) => p.role === 'candidate').map((p) => ({ name: p.name, metrics: p.metrics })) });
        store.appendLedger(db, { kind: 'selection', prereg: PREREG, version: `selection:${arms.map((a) => a.name).join(',')}`, configHash: setHash, runIds: [...plan, ...fillPlan].map((p) => p.id), contaminated, reason: why || null, at });
        store.appendExperiment(db, {
          at, what: contaminated ? 'development pick (repeat, contaminated)' : 'development pick', version: arms.map((a) => a.name).join(', '),
          dataTouched: `development period ${period.start} to ${period.end} (warm-up from ${period.warmupFrom}), basket ${period.basket}: ${symbols.map((s) => s.symbol).join(', ')}; the fully invested hold and the day-one hold; each arm also with first 15-minute VWAP fills (reported); pick rule ${criteria.selection.pickRule}`,
          resultsSeen: 'yes: in-sample development results', note: `${choice.reason}${why ? ` Reason for the repeat: ${why}` : ''}`,
        });
        if (!choice.chosen) { frozenNote = 'No candidate is frozen: HXR is reported as having no candidate worth validating, and the validation and final periods are not used.'; return; }
        const existing = store.getVersion(db, FROZEN_VERSION);
        if (existing) { frozen = existing; frozenNote = `${FROZEN_VERSION} was already frozen on ${existing.frozenAt} (from ${existing.basedOn}); it is unchanged.`; return; }
        // The pre-registration allows one development pick: a repeat never freezes a version.
        if (contaminated) { frozenNote = `A repeated (contaminated) development pick never freezes ${FROZEN_VERSION}.`; return; }
        const chosen = plan.find((p) => p.name === choice.chosen).config;
        const config = { ...clone(chosen), version: FROZEN_VERSION, label: `HXR ${FROZEN_VERSION} (frozen from ${chosen.version}: ${chosen.label})`, createdAt: at.slice(0, 10), status: `frozen by the ${PREREG} development pick; the experimental assumptions are unchanged` };
        const errors = validateHxrConfig(config);
        if (errors.length) throw new Error(`The frozen config is invalid: ${errors.join('; ')}`);
        frozen = store.saveVersion(db, { version: FROZEN_VERSION, config, configHash: hxrConfigHash(config), basedOn: chosen.version, prereg: PREREG, frozenAt: at });
        store.appendExperiment(db, {
          at, what: `froze ${FROZEN_VERSION}`, version: FROZEN_VERSION, dataTouched: 'none beyond the development pick', resultsSeen: 'development period only',
          note: `based on ${chosen.version} (config hash ${frozen.configHash}); the validation and final periods have not been used`,
        });
        frozenNote = `${FROZEN_VERSION} frozen from ${chosen.version}. Before the validation run, record it as strategy/hxr/configs/${configFileName(FROZEN_VERSION)} (the frozen config JSON in this response, unchanged, so its hash ${frozen.configHash.slice(0, 12)} matches) and add an EXPERIMENT-LOG.md entry.`;
      });
      // Neighbouring settings of the winner only (PREREGISTRATION-3a.md section 1): development only, reported only.
      if (choice?.chosen && !contaminated) {
        const winner = plan.find((p) => p.name === choice.chosen);
        for (const change of neighboursFor(winner.config.version)) {
          const config = neighbourConfig(winner.config, change);
          nPlan.push({ name: winner.name, role: 'neighbour', arm: winner.name, variantKey: `neighbour:${Object.entries(change).map(([k, x]) => `${k}=${x}`).join(',')}`, change, config, kind: 'variant', period, symbols, basket: period.basket, contaminated, reason: why, label: `Development (in-sample, ${period.start} to ${period.end}): ${config.label} (reported only)` });
        }
        if (nPlan.length) {
          await executePlan(nPlan, (at) => {
            const holdM = byRole('hold').metrics, dayOneM = byRole('hold_day_one').metrics;
            const byEnd = criteria.selection.pickRule === 'ending_value';
            const beats = (m) => (choice.threshold == null ? null : byEnd ? (m.endValue ?? -Infinity) > choice.threshold : (m.returnToDrawdown ?? -Infinity) >= choice.threshold);
            neighbours = {
              candidate: winner.name, pickRule: criteria.selection.pickRule, threshold: choice.threshold,
              base: { runId: winner.id, endValue: winner.metrics.endValue, returnToDrawdown: winner.metrics.returnToDrawdown, roundTrips: winner.metrics.roundTrips, beatsBenchmarks: beats(winner.metrics) },
              neighbours: nPlan.map((n) => ({
                change: n.change, runId: n.id, endValue: n.metrics.endValue, returnToDrawdown: n.metrics.returnToDrawdown, roundTrips: n.metrics.roundTrips,
                vsHold: compareArms(n.metrics, holdM), vsHoldDayOne: compareArms(n.metrics, dayOneM), beatsBenchmarks: beats(n.metrics), sameConclusion: beats(n.metrics) === beats(winner.metrics),
              })),
            };
            store.updateRun(db, winner.id, { details: { ...store.getRun(db, winner.id).details, neighbours } });
            store.appendExperiment(db, {
              at, what: 'neighbouring settings of the pick (reported only)', version: winner.name,
              dataTouched: `development period ${period.start} to ${period.end}, basket ${period.basket}: ${nPlan.length} runs, one setting changed at a time`,
              resultsSeen: 'yes: in-sample development results (reported only; never used for the pick)', note: `${neighbours.neighbours.filter((n) => n.sameConclusion).length} of ${nPlan.length} neighbours reach the same conclusion against the benchmarks as the pick`,
            });
          });
        }
      }
      const holdM = byRole('hold').metrics, dayOneM = byRole('hold_day_one').metrics;
      return wrap({
        kind: 'selection', prereg: PREREG, contaminated, reason: why || null, pickRule: criteria.selection.pickRule,
        runs: [...plan, ...fillPlan, ...nPlan].map(runRef), choice,
        benchmarks: { hold: headline(holdM), holdDayOne: headline(dayOneM) },
        comparisons: plan.filter((p) => p.role === 'candidate' || p.role === 'comparison').map((p) => ({ name: p.name, role: p.role, vsHold: compareArms(p.metrics, holdM), vsHoldDayOne: compareArms(p.metrics, dayOneM) })),
        fills: Object.fromEntries(plan.map((p) => [p.name, p.fills])),
        neighbours,
        frozen: frozen ? { version: frozen.version, configHash: frozen.configHash, basedOn: frozen.basedOn, frozenAt: frozen.frozenAt, file: `strategy/hxr/configs/${configFileName(frozen.version)}`, config: frozen.config } : null,
        note: `Development results are in-sample. ${frozenNote}`,
      });
    } finally { busy = null; }
  }

  // ---------- the validation gate (PREREGISTRATION-3.md section 5, 3a section 5) ----------

  const validationState = () => store.getSetting(db, 'validation', null);

  async function runValidation({ confirm, reason } = {}) {
    if (confirm !== true) throw new HxrError(400, 'The validation run needs confirm: true. It runs once for the frozen version; a repeat is marked contaminated and can never validate.');
    const why = cleanReason(reason);
    const v = frozenVersion();
    if (!v) throw new HxrError(409, `No frozen version: ${FROZEN_VERSION} is frozen only when the development pick chooses a candidate. The validation period stays unused.`);
    requireMuDecision();
    const prior = store.countLedger(db, 'validation', PREREG, v.version, v.configHash);
    if (prior && !why) throw new HxrError(409, `${v.version} was already validated (${prior} time(s)). A repeat needs a written reason and is marked contaminated; a contaminated validation can never validate.`);
    const contaminated = prior > 0;
    requireUsable(readinessNow({ fresh: true }), ['validation']);
    claim('validation');
    try {
      const period = periods.periods.validation;
      const symbols = basketSymbols(universe, period.basket);
      const frozen = v.config, hold = holdConfig(), dayOne = holdDayOneConfig(frozen);
      const tag = contaminated ? ' [repeat: contaminated]' : '';
      const arms = [{ name: v.version, role: 'hxr', config: frozen }, { name: hold.version, role: 'hold', config: hold }, { name: DAY_ONE_HOLD, role: 'hold_day_one', config: dayOne }];
      const plan = arms.map((a) => ({ ...a, arm: a.role, variantKey: 'main', kind: 'validation', period, symbols, basket: period.basket, contaminated, reason: why, label: `Validation ${period.start} to ${period.end}: ${a.config.label}${tag}` }));
      const fillPlan = arms.map((a) => ({ name: a.name, role: 'fills', arm: a.role, variantKey: 'vw15', config: variantConfig(a.config, { fillModel: 'vw15' }), kind: 'variant', period, symbols, basket: period.basket, contaminated, reason: why, label: `Validation ${period.start} to ${period.end}: ${a.config.label}, first 15-minute VWAP fills (reported)${tag}` }));
      let gate = null, reported = null;
      await executePlan([...plan, ...fillPlan], (at) => {
        const m = Object.fromEntries(plan.map((p) => [p.role, p.metrics]));
        gate = evaluateValidation(criteria, { hxr: m.hxr, hold: m.hold, holdDayOne: m.hold_day_one }, { contaminated });
        reported = {
          comparisons: { main: compareBenchmarks(m.hxr, { hold: m.hold, holdDayOne: m.hold_day_one }) },
          fills: Object.fromEntries(plan.map((p, i) => [p.role, fillComparison(p.result, fillPlan[i].result)])),
          freshEntries: m.hxr.freshEntries ?? null, buyBacks: m.hxr.buyBacks ?? null, missedRebounds: m.hxr.missedRebounds, lossesAfterBuyBack: m.hxr.lossesAfterBuyBack,
        };
        const hx = plan[0];
        store.updateRun(db, hx.id, { details: { ...store.getRun(db, hx.id).details, validation: gate, reported } });
        store.appendLedger(db, { kind: 'validation', prereg: PREREG, version: v.version, configHash: v.configHash, runIds: [...plan, ...fillPlan].map((p) => p.id), contaminated, reason: why || null, at });
        if (!contaminated) store.setSetting(db, 'validation', { version: v.version, configHash: v.configHash, outcome: gate.outcome, at, runIds: plan.map((p) => p.id) });
        store.appendExperiment(db, {
          at, what: contaminated ? 'validation run (repeat, contaminated)' : 'validation run', version: v.version,
          dataTouched: `validation period ${period.start} to ${period.end} (warm-up from ${period.warmupFrom}), basket ${period.basket}: ${symbols.map((s) => s.symbol).join(', ')}; the fully invested hold and the day-one hold; each with first 15-minute VWAP fills (reported)`,
          resultsSeen: 'yes: validation results', note: `outcome ${gate.outcome} (${gate.meaning})${why ? `. Reason for the repeat: ${why}` : ''}`,
        });
      });
      return wrap({
        kind: 'validation', prereg: PREREG, version: v.version, configHash: v.configHash, basedOn: v.basedOn, contaminated, reason: why || null,
        outcome: gate.outcome, meaning: gate.meaning, validation: gate, reported, runs: [...plan, ...fillPlan].map(runRef), caveat: HISTORICAL_CAVEAT,
        note: gate.outcome === 'validated' ? 'Validated: the final period may be used once for this version.' : 'HXR stops here: the final period is never used for this or any other candidate.',
      });
    } finally { busy = null; }
  }

  // ---------- evaluation (PREREGISTRATION.md section 10) ----------

  function frozenVersion() {
    const v = store.getVersion(db, FROZEN_VERSION);
    if (!v) return null;
    const errors = validateHxrConfig(v.config);
    if (errors.length || hxrConfigHash(v.config) !== v.configHash) throw new HxrError(500, `The stored ${FROZEN_VERSION} config does not match its hash or is invalid; nothing was run.`);
    return v;
  }

  // The full-list check (basket B) is reported, not a gate (PREREGISTRATION.md
  // sections 7 and 10): only the evaluation period gates the run. When basket B
  // is not ready the owner must say so explicitly (withoutFullList: true); the
  // check is then recorded as not run, with its readiness reasons.
  async function runEvaluation({ confirm, reason, withoutFullList = false } = {}) {
    if (confirm !== true) throw new HxrError(400, 'The final run needs confirm: true. It runs once per frozen version; a repeat is marked contaminated and can never pass.');
    const why = cleanReason(reason);
    const v = frozenVersion();
    if (!v) throw new HxrError(409, `No frozen version: ${FROZEN_VERSION} is frozen only when the development pick chooses a candidate. The final period stays unused.`);
    requireMuDecision();
    const val = validationState();
    if (!val || val.version !== v.version || val.configHash !== v.configHash) throw new HxrError(409, `${v.version} has not been validated: the final period is used only after the validation gate passes (PREREGISTRATION-3.md section 5). Run the validation first. Nothing was run.`);
    if (val.outcome !== 'validated') throw new HxrError(409, `${v.version} did not validate (${val.outcome}): HXR stops, and the final period is never used for this or any other candidate (PREREGISTRATION-3a.md section 3). Nothing was run.`);
    const prior = store.countLedger(db, 'evaluation', PREREG, v.version, v.configHash);
    if (prior && !why) throw new HxrError(409, `${v.version} was already run on the final period (${prior} time(s)). A repeat needs a written reason and is marked contaminated; a contaminated final run can never pass.`);
    const contaminated = prior > 0;
    const ready = readinessNow({ fresh: true });
    requireUsable(ready, ['final']);
    const fullProblem = periodProblem(ready, 'fullList');
    if (fullProblem && withoutFullList !== true) {
      throw new HxrError(409, `${fullProblem} The basket B full-list check is reported, not a gate: run the final run with withoutFullList: true to run without it. It is then recorded as not run, and adding it later needs a repeat, which is marked contaminated. Nothing was run.`);
    }
    claim('evaluation');
    try {
      const frozen = v.config, hold = holdConfig(), dayOne = holdDayOneConfig(frozen);
      const fin = periods.periods.final, full = periods.periods.fullList;
      const A = basketSymbols(universe, fin.basket), B = basketSymbols(universe, full.basket);
      const tag = contaminated ? ' [repeat: contaminated]' : '';
      const plan = [];
      // Every variant runs HXR, the fully invested hold and the day-one hold (PREREGISTRATION-3a.md section 5).
      const trio = (variantKey, what, hx, hd, d1, symbols, period, kind, extra = {}) => {
        for (const [arm, config] of [['hxr', hx], ['hold', hd], ['hold_day_one', d1]]) {
          plan.push({ variantKey, arm, role: arm, config, symbols, period, kind, basket: period.basket, contaminated, reason: why, label: `Final ${period.start} to ${period.end}, ${what}: ${arm === 'hxr' ? v.version : arm === 'hold' ? hd.version : DAY_ONE_HOLD}${tag}`, ...extra });
        }
      };
      const vr = (c, o) => variantConfig(c, o);
      trio('main', 'base costs', frozen, hold, dayOne, A, fin, 'evaluation');
      trio('costs2x', 'spread and slippage doubled', vr(frozen, { spreadSlippageMultiplier: 2 }), vr(hold, { spreadSlippageMultiplier: 2 }), vr(dayOne, { spreadSlippageMultiplier: 2 }), A, fin, 'variant');
      trio('delay2', 'fills two sessions after the decision', vr(frozen, { delaySessions: 2 }), vr(hold, { delaySessions: 2 }), vr(dayOne, { delaySessions: 2 }), A, fin, 'variant');
      trio('vw15', 'first 15-minute VWAP fills', vr(frozen, { fillModel: 'vw15' }), vr(hold, { fillModel: 'vw15' }), vr(dayOne, { fillModel: 'vw15' }), A, fin, 'variant');
      trio('withholding0', '0% dividend withholding', vr(frozen, { withholdingPct: 0 }), vr(hold, { withholdingPct: 0 }), vr(dayOne, { withholdingPct: 0 }), A, fin, 'variant');
      for (const s of A) trio(`loo-${s.symbol}`, `without ${s.symbol} (the other ${A.length - 1})`, frozen, hold, dayOne, A.filter((x) => x.symbol !== s.symbol), fin, 'variant', { left: s.symbol });
      if (!fullProblem) {
        trio('fullList', `basket ${full.basket} full-list check (reported, not a gate)`, frozen, hold, dayOne, B, full, 'variant');
        trio('fullList-vw15', `basket ${full.basket} full-list check, first 15-minute VWAP fills (reported)`, vr(frozen, { fillModel: 'vw15' }), vr(hold, { fillModel: 'vw15' }), vr(dayOne, { fillModel: 'vw15' }), B, full, 'variant');
      }
      let evaluation = null, reported = null;
      await executePlan(plan, (at) => {
        const get = (key, arm) => plan.find((p) => p.variantKey === key && p.arm === arm);
        const armsOf = (key) => ({ hxr: get(key, 'hxr').metrics, hold: get(key, 'hold').metrics, holdDayOne: get(key, 'hold_day_one').metrics });
        evaluation = evaluateCriteria(criteria, {
          main: armsOf('main'), costs2x: armsOf('costs2x'), delay2: armsOf('delay2'),
          leaveOneOut: A.map((s) => ({ left: s.symbol, ...armsOf(`loo-${s.symbol}`) })), contaminated,
        });
        const keys = [...new Set(plan.map((p) => p.variantKey))];
        const fillsOf = (key, vwKey) => Object.fromEntries(['hxr', 'hold', 'hold_day_one'].map((arm) => [arm === 'hold_day_one' ? 'holdDayOne' : arm, fillComparison(get(key, arm).result, get(vwKey, arm).result)]));
        const main = armsOf('main');
        reported = {
          benchmarks: ['hold', 'holdDayOne'],
          comparisons: Object.fromEntries(keys.map((k) => { const m = armsOf(k); return [k, compareBenchmarks(m.hxr, { hold: m.hold, holdDayOne: m.holdDayOne })]; })),
          fills: fillsOf('main', 'vw15'),
          perStock: { hxr: main.hxr.perStock, hold: main.hold.perStock, holdDayOne: main.holdDayOne.perStock },
          missedRebounds: main.hxr.missedRebounds, lossesAfterBuyBack: main.hxr.lossesAfterBuyBack,
          freshEntries: main.hxr.freshEntries ?? null, buyBacks: main.hxr.buyBacks ?? null,
          costs: main.hxr.costs, dividends: main.hxr.dividends,
          fullList: fullProblem
            ? { run: false, basket: full.basket, period: { start: full.start, end: full.end }, reason: fullProblem, reasons: ready.periods.fullList.reasons, note: 'Not run: basket B was not ready and the owner chose to run the final run without it (reported, not a gate).' }
            : { run: true, basket: full.basket, period: { start: full.start, end: full.end }, runIds: { hxr: get('fullList', 'hxr').id, hold: get('fullList', 'hold').id, holdDayOne: get('fullList', 'hold_day_one').id }, fills: fillsOf('fullList', 'fullList-vw15') },
        };
        const mainHxr = get('main', 'hxr');
        store.updateRun(db, mainHxr.id, { details: { ...store.getRun(db, mainHxr.id).details, evaluation, reported } });
        store.appendLedger(db, { kind: 'evaluation', prereg: PREREG, version: v.version, configHash: v.configHash, runIds: plan.map((p) => p.id), contaminated, reason: why || null, at });
        store.appendExperiment(db, {
          at, what: contaminated ? 'final run (repeat, contaminated)' : 'final run', version: v.version,
          dataTouched: `final period ${fin.start} to ${fin.end} (warm-up from ${fin.warmupFrom}), basket ${fin.basket}; both benchmarks; ${fullProblem ? `full-list check not run (basket ${full.basket} not ready; the owner chose to run without it)` : `full-list check ${full.start} to ${full.end}, basket ${full.basket}`}`,
          resultsSeen: 'yes: final results', note: `outcome ${evaluation.outcome} (${evaluation.meaning})${why ? `. Reason for the repeat: ${why}` : ''}`,
        });
      });
      return wrap({
        kind: 'evaluation', prereg: PREREG, version: v.version, configHash: v.configHash, basedOn: v.basedOn, contaminated, reason: why || null,
        outcome: evaluation.outcome, meaning: evaluation.meaning, passMeaning: PASS_MEANING, caveat: HISTORICAL_CAVEAT, evaluation, reported, runs: plan.map(runRef),
      });
    } finally { busy = null; }
  }

  // ---------- data download job ----------

  const save = (job) => { job.updatedAt = clock().toISOString(); store.setSetting(db, 'fetchJob', job); };

  async function fetchSymbol(job, sym, st) {
    const entry = uSyms.get(sym);
    const fetchedAt = () => clock().toISOString();
    if (st.from > job.through) { st.step = 'done'; st.note = 'nothing to download yet'; return; }
    if (st.step === 'bars') {
      const bars = await source.dailyBars(sym, { from: st.from, to: job.through });
      store.upsertBars(db, sym, bars, { fetchedAt: fetchedAt() });
      Object.assign(st, { bars: bars.length, dropped: bars.dropped, step: 'first15', first15Next: st.from });
      save(job);
    }
    while (st.step === 'first15' && !closed) {
      const to = `${year(st.first15Next)}-12-31` < job.through ? `${year(st.first15Next)}-12-31` : job.through;
      const rows = await source.first15(sym, { from: st.first15Next, to });
      store.upsertFirst15(db, sym, rows, { fetchedAt: fetchedAt() });
      st.first15 += rows.length;
      st.first15Next = addDays(to, 1);
      if (st.first15Next > job.through) st.step = 'spreads';
      save(job);
      await yieldLoop();
    }
    if (st.step === 'spreads') {
      const have = new Set(store.listSpreadSamples(db, sym).map((x) => x.date));
      const days = sampledSpreadDays(entry.listedFrom, job.through);
      st.spreadDays = days.length;
      for (const d of days) {
        if (closed) return;
        if (have.has(d)) continue;
        try {
          const s = spreadSampleFromQuotes(await source.quotesWindow(sym, d));
          store.upsertSpreadSamples(db, [{ symbol: sym, date: d, ...s, window: 'regular open to open + 60 s (SIP quotes)' }], { fetchedAt: fetchedAt() });
        } catch (e) {
          if (e.kind !== 'not_available') throw e;
          st.spreadsWaiting = (st.spreadsWaiting || 0) + 1;
        }
      }
      st.spreads = store.listSpreadSamples(db, sym).filter((x) => days.includes(x.date)).length;
      st.step = 'done';
    }
  }

  async function runFetchJob() {
    if (fetching || closed || !source) return;
    fetching = true;
    try {
      const job = store.getSetting(db, 'fetchJob');
      if (!job || job.status !== 'running') return;
      const syms = Object.keys(job.symbols).filter((s) => job.symbols[s].status !== 'skipped');
      if (job.corporateActions.status !== 'done') {
        try {
          const rows = await source.corporateActions(syms);
          store.upsertCorporateActions(db, rows, { fetchedAt: clock().toISOString() });
          job.corporateActions = { status: 'done', rows: rows.length, error: null };
        } catch (e) {
          job.corporateActions = { status: 'error', rows: 0, error: safe(e.message) };
          if (e.kind === 'auth' || e.kind === 'rate_limit') return stopJob(job, e);
        }
        save(job);
      }
      for (const sym of syms) {
        if (closed) return;
        const st = job.symbols[sym];
        if (!['pending', 'running'].includes(st.status)) continue;
        st.status = 'running';
        save(job);
        try {
          await fetchSymbol(job, sym, st);
          if (closed) return;
          st.status = 'done';
          st.error = null;
        } catch (e) {
          st.error = safe(e.message);
          if (e.kind === 'auth' || e.kind === 'rate_limit') { st.status = 'pending'; return stopJob(job, e); }
          st.status = 'error';
        }
        save(job);
        await yieldLoop();
      }
      job.status = job.corporateActions.status === 'error' || Object.values(job.symbols).some((s) => s.status === 'error') ? 'done_with_errors' : 'done';
      job.finishedAt = clock().toISOString();
      save(job);
    } finally {
      fetching = false;
    }
  }

  // Keys refused, or still rate-limited after the source's retries: the job
  // stops. What is stored is kept; starting the download again continues it.
  function stopJob(job, e) {
    job.error = `${safe(e.message)}${e.kind === 'rate_limit' ? ' Start the download again later; what is stored is kept.' : ''}`;
    job.status = e.kind === 'rate_limit' ? 'paused' : 'failed';
    save(job);
  }

  function fetchData({ symbols = null } = {}) {
    if (closed) throw new HxrError(503, 'HXR is closed');
    if (!source) throw noKeys();
    if (fetching) throw new HxrError(409, 'An HXR data download is already running');
    if (busy) throw new HxrError(409, `An HXR ${busy.kind} run is in progress; download when it has finished.`);
    let list;
    if (symbols == null || (Array.isArray(symbols) && !symbols.length)) list = universe.symbols.map((s) => s.symbol);
    else if (Array.isArray(symbols)) list = [...new Set(symbols.map(checkSymbol))];
    else throw new HxrError(400, 'symbols must be a list');
    const now = clock();
    const through = latestCompleteSession(now);
    const confirmed = confirmedList();
    const job = {
      id: `fetch-${now.toISOString()}`, status: 'running', startedAt: now.toISOString(), updatedAt: now.toISOString(), through, error: null,
      source: 'Alpaca market data (SIP, raw), data.alpaca.markets', corporateActions: { status: 'pending', rows: 0, error: null },
      symbols: Object.fromEntries(list.map((s) => {
        const e = uSyms.get(s);
        const from = e.listedFrom > periods.dataFrom ? e.listedFrom : periods.dataFrom;
        if (e.identity && e.identity !== 'confirmed' && !confirmed.includes(s)) {
          return [s, { status: 'skipped', from, note: `Identity pending the owner's confirmation (${SPCX_IDENTITY}): not downloaded until confirmed.` }];
        }
        return [s, { status: 'pending', from, step: 'bars', bars: 0, first15: 0, spreads: 0, spreadDays: 0, error: null }];
      })),
    };
    const fetchList = list.filter((s) => job.symbols[s].status !== 'skipped');
    store.setSetting(db, 'fetchJob', job);
    store.appendExperiment(db, {
      at: now.toISOString(), what: 'data download', version: null,
      dataTouched: `Alpaca SIP raw daily bars, first 15-minute bars, corporate actions and opening quotes (spread samples) for ${fetchList.join(', ') || 'no symbol'}, from each listing date (not before ${periods.dataFrom}) to ${through}`,
      resultsSeen: 'no', note: 'Download only; no rule was run.',
    });
    hxr.fetchDone = runFetchJob().catch(() => {});
    return wrap({ job, note: `Downloading in the background through Alpaca (feed sip, adjustment raw). Progress is saved and resumes after a restart. Check the readiness checklist afterwards; nothing is filled in or shortened automatically.` });
  }

  // ---------- prospective account (ENGINE-SPEC.md section 10) ----------

  function prospectiveConfigs(p) {
    const v = frozenVersion();
    if (!v || v.configHash !== p.configHash) throw new HxrError(500, `The prospective account's frozen version ${p.version} is missing or changed; it was not processed.`);
    const hold = holdConfig();
    if (hxrConfigHash(hold) !== p.state.holdConfigHash) throw new HxrError(500, 'The hold config changed since the prospective account started; it was not processed.');
    return { hxr: v.config, hold };
  }

  function prospectiveEngines(p, calibrated) {
    const configs = prospectiveConfigs(p);
    const period = { warmupFrom: p.state.warmupFrom, start: p.startDate, end: null };
    const make = (arm) => createEngine({ config: configs[arm], symbols: p.symbols, period, excludedSessions: excluded, halfSpreadBps: halfSpreadFor(configs[arm], calibrated), state: p.state.arms[arm] });
    return { configs, engines: { hxr: make('hxr'), hold: make('hold') } };
  }

  function startProspective({ confirm } = {}) {
    if (confirm !== true) throw new HxrError(400, 'Starting the prospective simulated account needs confirm: true.');
    const v = frozenVersion();
    if (!v) throw new HxrError(409, `No frozen version: the prospective account uses ${FROZEN_VERSION}, which is frozen only when the selection run picks a candidate.`);
    if (store.getProspective(db)) throw new HxrError(409, 'A prospective account already exists. There is only one; it is never restarted.');
    const now = clock();
    const startDate = firstSessionAfter(now, excluded);
    const withSpcx = spcxConfirmed();
    const symbols = basketSymbols(universe, 'prospective', { withPending: withSpcx }).map((s) => ({ ...s }));
    const hold = holdConfig();
    const warmupFrom = sessionsBack(startDate, Math.max(periods.warmupSessions, historyLengthFor(v.config)), excluded);
    const period = { warmupFrom, start: startDate, end: null };
    const calibrated = halfSpreadFn(spreadTable(year(startDate)));
    const arms = {};
    for (const [arm, config] of [['hxr', v.config], ['hold', hold]]) {
      arms[arm] = createEngine({ config, symbols, period, excludedSessions: excluded, halfSpreadBps: halfSpreadFor(config, calibrated) }).snapshot();
    }
    const state = { format: 'hxr-prospective-1', warmupFrom, holdVersion: hold.version, holdConfigHash: hxrConfigHash(hold), engineVersion: ENGINE_VERSION, arms };
    const p = store.saveProspective(db, { version: v.version, configHash: v.configHash, startedAt: now.toISOString(), startDate, symbols, state, lastProcessed: null, status: 'active' }, { create: true });
    store.appendExperiment(db, {
      at: now.toISOString(), what: 'prospective account started', version: v.version,
      dataTouched: `none yet: sessions from ${startDate} (warm-up from ${warmupFrom}) for ${symbols.map((s) => s.symbol).join(', ')}`, resultsSeen: 'no',
      note: `HXR ${v.version} and the hold side by side from a simulated US$${v.config.account.startingCash}${withSpcx ? '; SPCX included (identity confirmed by the owner)' : '; SPCX not included (identity not confirmed)'}`,
    });
    return wrap({ account: accountSummary(p), note: `The prospective simulated account starts at the open of ${startDate}. After each close, "Process now" or the scheduler records each decision with its time; nothing is sent anywhere.` });
  }

  function accountSummary(p) {
    if (!p) return null;
    const last = (arm) => p.state?.arms?.[arm]?.journal?.equity?.at(-1) ?? null;
    return {
      version: p.version, configHash: p.configHash, status: p.status, startedAt: p.startedAt, startDate: p.startDate, warmupFrom: p.state?.warmupFrom ?? null,
      lastProcessed: p.lastProcessed, symbols: p.symbols.map((s) => s.symbol), holdVersion: p.state?.holdVersion ?? null,
      hxr: last('hxr') ? { date: last('hxr').date, equity: last('hxr').equity, cash: last('hxr').cash, receivable: last('hxr').receivable } : null,
      hold: last('hold') ? { date: last('hold').date, equity: last('hold').equity, cash: last('hold').cash, receivable: last('hold').receivable } : null,
      simulated: true,
    };
  }

  // Fetches what processing needs: new complete daily bars and first
  // 15-minute bars, corporate actions, missing spread samples and news.
  // Errors are collected, never thrown: processing then waits or runs with
  // what is stored.
  async function prospectiveFetch(p, now, latest, todo, report) {
    if (!source) { report.errors.push('Alpaca keys are not set (ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY in .env): no new data or news was fetched.'); return; }
    // Nothing is requested for a symbol whose identity is not confirmed now.
    const confirmed = confirmedList();
    const symbols = p.symbols.filter((s) => { const e = uSyms.get(s.symbol); return !e?.identity || e.identity === 'confirmed' || confirmed.includes(s.symbol); });
    const names = symbols.map((s) => s.symbol);
    const step = async (what, fn) => {
      try { return await fn(); } catch (e) { report.errors.push(`${what}: ${safe(e.message)}`); return null; }
    };
    const lastCa = store.getSetting(db, 'prospectiveActionsAt');
    if (todo || !lastCa || now.getTime() - Date.parse(lastCa) >= ACTIONS_REFRESH_MIN * MIN) {
      await step('corporate actions', async () => {
        const rows = await source.corporateActions(names);
        store.upsertCorporateActions(db, rows, { fetchedAt: now.toISOString() });
        store.setSetting(db, 'prospectiveActionsAt', now.toISOString());
        report.fetched.corporateActions = rows.length;
      });
    }
    for (const s of symbols) {
      const first = [s.listedFrom, p.state.warmupFrom].sort().at(-1);
      const lastBar = store.lastBarDate(db, s.symbol);
      const from = lastBar && lastBar >= first ? addDays(lastBar, 1) : first;
      if (from <= latest) {
        await step(`${s.symbol} daily bars`, async () => {
          const bars = await source.dailyBars(s.symbol, { from, to: latest });
          store.upsertBars(db, s.symbol, bars, { fetchedAt: now.toISOString() });
          report.fetched[s.symbol] = { bars: bars.length };
        });
      }
      const lastF15 = store.getFirst15(db, s.symbol, { from: first }).at(-1)?.date ?? null;
      const f15From = lastF15 ? addDays(lastF15, 1) : first;
      if (f15From <= latest) {
        await step(`${s.symbol} first 15-minute bars`, async () => {
          const rows = await source.first15(s.symbol, { from: f15From, to: latest });
          store.upsertFirst15(db, s.symbol, rows, { fetchedAt: now.toISOString() });
          report.fetched[s.symbol] = { ...(report.fetched[s.symbol] || {}), first15: rows.length };
        });
      }
      const have = new Set(store.listSpreadSamples(db, s.symbol).map((x) => x.date));
      for (const d of sampledSpreadDays(first, latest).filter((x) => !have.has(x))) {
        await step(`${s.symbol} spread sample ${d}`, async () => {
          try {
            const sample = spreadSampleFromQuotes(await source.quotesWindow(s.symbol, d));
            store.upsertSpreadSamples(db, [{ symbol: s.symbol, date: d, ...sample, window: 'regular open to open + 60 s (SIP quotes)' }], { fetchedAt: now.toISOString() });
          } catch (e) { if (e.kind !== 'not_available') throw e; }
        });
      }
    }
    await step('news', async () => {
      const polled = store.getSetting(db, 'newsPolledAt');
      const start = polled ? new Date(Date.parse(polled) - NEWS_OVERLAP_MIN * MIN) : new Date(Date.parse(p.startedAt) - NEWS_WINDOW_HOURS * 3600000);
      const items = await source.news(names, { start: start.toISOString(), end: now.toISOString() });
      report.news = { fetched: items.length, inserted: store.insertNews(db, items, { seenAt: now.toISOString() }) };
      store.setSetting(db, 'newsPolledAt', now.toISOString());
    });
  }

  // News known when a decision was recorded: first seen at or before it, created in the 72 hours before it.
  function newsKnownAt(symbol, recordedAt) {
    const from = new Date(Date.parse(recordedAt) - NEWS_WINDOW_HOURS * 3600000).toISOString();
    const items = store.newsFor(db, { symbol, createdFrom: from, createdTo: recordedAt, seenBy: recordedAt, limit: 50 });
    return { from, to: recordedAt, items: items.map((n) => ({ id: n.id, created_at: n.created_at, first_seen_at: n.first_seen_at, backfilled: n.backfilled, source: n.source, headline: n.headline, url: n.url })) };
  }

  // Splits or dividends that reached the database after their session was processed.
  function lateActions(p, inputs, snapshot) {
    const applied = new Set(snapshot.journal.splits.filter((s) => s.kind === 'split').map((s) => s.sourceId));
    const entitled = new Set(snapshot.journal.dividends.filter((d) => d.kind === 'entitlement').map((d) => d.sourceId));
    const late = { splits: [], dividends: [] };
    for (const [d, day] of inputs.days) {
      if (!p.lastProcessed || d > p.lastProcessed) continue;
      for (const s of day.splits) if (!applied.has(s.id)) late.splits.push({ ...s, session: d });
      if (d >= p.startDate) for (const x of day.dividends) if (!entitled.has(x.id)) late.dividends.push({ ...x, session: d });
    }
    return late;
  }

  // Events of one processed session for one arm, all recorded at `recordedAt`.
  function sessionEvents(arm, r, { recordedAt, onTime, trading, missing, nextOpen }) {
    const ev = (kind, id, symbol, detail) => ({ key: `${arm}:${kind}:${id}`, kind, arm, date: r.date, symbol, recordedAt, onTime: trading ? onTime : null, detail });
    const out = [ev('session', r.date, null, { trading, missing, nextOpen })];
    for (const d of r.decisions) {
      const news = newsKnownAt(d.symbol, recordedAt);
      out.push(ev('decision', d.id, d.symbol, { ...d, newsIds: news.items.map((n) => n.id) }));
      out.push(ev('news_link', d.id, d.symbol, { decisionId: d.id, window: { createdFrom: news.from, createdTo: news.to, firstSeenBy: recordedAt }, items: news.items, untrusted: true }));
    }
    for (const f of r.fills) {
      const h = f.halfSpreadBps / 10000;
      const realistic = f.vw15 != null ? f.vw15 * (f.side === 'buy' ? 1 + h : 1 - h) : null;
      out.push(ev('fill', f.id, f.symbol, { ...f, realistic: { price: realistic, diffBps: realistic != null && f.price > 0 ? (Math.abs(realistic - f.price) / f.price) * 10000 : null } }));
    }
    for (const x of r.dividends) out.push(ev('dividend', x.id, x.symbol, x));
    for (const x of r.splits) out.push(ev('split', x.id, x.symbol, x));
    for (const x of r.warnings) out.push(ev('warning', x.id, x.symbol, x));
    for (const x of r.roundTrips) out.push(ev('round_trip', x.id, x.symbol, x));
    for (const x of r.episodes) out.push(ev('episode', x.id, x.symbol, x));
    if (r.equity) out.push(ev('equity', r.date, null, r.equity));
    return out;
  }

  async function prospectiveTick({ now = clock() } = {}) {
    if (closed) throw new HxrError(503, 'HXR is closed');
    const p = store.getProspective(db);
    if (!p) throw new HxrError(409, 'No prospective account: start one first.');
    if (p.status !== 'active') return wrap({ skipped: true, reason: `The prospective account is ${p.status}.`, account: accountSummary(p) });
    if (ticking) return wrap({ skipped: true, reason: 'A prospective update is already running.' });
    ticking = true;
    try {
      const report = await processProspective(p, now);
      store.setSetting(db, 'prospectiveLastTick', report);
      return wrap({ ...report, account: accountSummary(store.getProspective(db)) });
    } finally { ticking = false; }
  }

  // When a tick's records are stored: read after the fetch and the processing,
  // just before the write, and never earlier than the tick's data cutoff `now`.
  // on_time is judged on it (PREREGISTRATION.md section 9), so a slow fetch can
  // never backdate a record.
  const stampAfter = (now) => new Date(Math.max(now.getTime(), clock().getTime()));

  // The stored account still matches what the tick read before its first
  // await: active, at the same last session. A pause (or another update)
  // during the tick wins, and the tick stores nothing.
  const unchanged = (cur, p) => !!cur && cur.status === 'active' && cur.lastProcessed === p.lastProcessed;

  async function processProspective(p, now) {
    const report = { at: now.toISOString(), recordedAt: null, processed: [], waiting: null, fetched: {}, news: null, errors: [], late: null };
    const latest = latestCompleteSession(now);
    const first = p.lastProcessed ? nextSession(p.lastProcessed, excluded) : firstSessionOnOrAfter(p.state.warmupFrom, excluded);
    await prospectiveFetch(p, now, latest, first <= latest, report);
    if (first > latest) return report;
    const todo = [];
    for (let d = first; d <= latest; d = nextSession(d, excluded)) todo.push(d);
    const done = [];
    let lastProcessed = p.lastProcessed, state = null, late;
    try {
      const spread = spreadTable(year(latest));
      const { engines } = prospectiveEngines(p, halfSpreadFn(spread));
      // A symbol whose identity is not confirmed now (SPCX withdrawn) stops processing: it is never priced.
      const inputs = buildInputs(db, {
        universe, symbols: p.symbols.map((s) => s.symbol), warmupFrom: p.state.warmupFrom, end: todo.at(-1), excludedSessions: excluded,
        spreadTable: spread, start: p.startDate, confirmed: confirmedList(),
      });
      late = lateActions(p, inputs, engines.hxr.snapshot());
      if (late.splits.length || late.dividends.length) report.late = late;
      for (const d of late.splits.length ? [] : todo) {
        const day = inputs.days.get(d);
        const nextOpen = nextOpenOf(d, excluded);
        const listed = p.symbols.filter((s) => s.listedFrom <= d);
        const missing = listed.filter((s) => !day.bars[s.symbol]).map((s) => s.symbol);
        // A session with no bar at all (an outage, or no keys) always waits for its data. A few
        // missing bars wait until the next session opens; then the session is processed with what is there.
        if (missing.length && missing.length === listed.length) { report.waiting = { session: d, missing, until: null, reason: 'no bar has arrived for this session' }; break; }
        if (missing.length && now < nextOpen) { report.waiting = { session: d, missing, until: nextOpen.toISOString() }; break; }
        done.push({ d, nextOpen, missing, trading: d >= p.startDate, results: { hxr: engines.hxr.processSession(d, day), hold: engines.hold.processSession(d, day) } });
        report.processed.push(d);
        lastProcessed = d;
      }
      state = { ...p.state, arms: { hxr: engines.hxr.snapshot(), hold: engines.hold.snapshot() } };
    } catch (e) {
      const at = stampAfter(now).toISOString();
      const msg = e instanceof HxrError ? e.message : safe(e.message);
      report.errors.push(`processing: ${msg}`);
      report.processed = [];
      const prev = store.getSetting(db, 'prospectiveLastError');
      if (prev?.message !== msg) store.insertProspectiveEvents(db, [{ key: `error:${at}`, kind: 'operational', date: null, recordedAt: at, onTime: null, detail: { code: 'processing_error', message: msg } }]);
      store.setSetting(db, 'prospectiveLastError', { at, message: msg });
      return report;
    }
    const at = stampAfter(now);
    const recordedAt = at.toISOString();
    report.recordedAt = recordedAt;
    const events = late.dividends.map((x) => ({ key: `late-dividend:${x.id}`, kind: 'warning', arm: null, date: x.session, symbol: x.symbol, recordedAt, onTime: null, detail: { code: 'late_dividend', message: `dividend ${x.id} (ex-date ${x.exDate}) reached the database after its session was processed; it is not credited`, dividend: x } }));
    if (late.splits.length) {
      // The share count would be wrong from the split onwards: stop and let the owner decide.
      const msg = `A split reached the database after its session was processed (${late.splits.map((s) => `${s.symbol} ${s.session}`).join(', ')}); the account was paused.`;
      events.push(...late.splits.map((s) => ({ key: `late-split:${s.id}`, kind: 'operational', arm: null, date: s.session, symbol: s.symbol, recordedAt, onTime: null, detail: { code: 'late_split', message: msg, split: s } })));
      store.tx(db, () => {
        store.insertProspectiveEvents(db, events);
        // The status always comes from the stored row, never from the copy read before the fetch.
        const cur = store.getProspective(db);
        if (cur?.status === 'active') {
          store.saveProspective(db, { ...cur, status: 'paused' });
          store.insertProspectiveEvents(db, [{ key: `status:${recordedAt}:paused:late_split`, kind: 'status', date: null, recordedAt, onTime: null, detail: { from: 'active', to: 'paused', reason: 'late_split' } }]);
        }
      });
      report.errors.push(msg);
      return report;
    }
    for (const x of done) {
      const ctxE = { recordedAt, onTime: at < x.nextOpen, trading: x.trading, missing: x.missing, nextOpen: x.nextOpen.toISOString() };
      for (const arm of ['hxr', 'hold']) events.push(...sessionEvents(arm, x.results[arm], ctxE));
    }
    let current = null, stored = false;
    store.tx(db, () => {
      current = store.getProspective(db);
      if (!unchanged(current, p)) return;
      report.events = store.insertProspectiveEvents(db, events);
      store.saveProspective(db, { ...current, state, lastProcessed });
      stored = true;
    });
    if (!stored) {
      const what = !current ? 'removed' : current.status !== 'active' ? current.status : 'updated by another process';
      return { ...report, skipped: true, discarded: report.processed, processed: [], reason: `The prospective account was ${what} while this update ran, so nothing it processed was stored.` };
    }
    store.setSetting(db, 'prospectiveLastError', null);
    return report;
  }

  function setStatus(status, from) {
    const p = store.getProspective(db);
    if (!p) throw new HxrError(409, 'No prospective account: start one first.');
    if (p.status !== from) return wrap({ account: accountSummary(p), note: `The prospective account is already ${p.status}.` });
    const at = clock().toISOString();
    store.tx(db, () => {
      store.saveProspective(db, { ...p, status });
      store.insertProspectiveEvents(db, [{ key: `status:${at}:${status}`, kind: 'status', date: null, recordedAt: at, onTime: null, detail: { from, to: status } }]);
    });
    return wrap({ account: accountSummary(store.getProspective(db)), note: status === 'paused' ? 'Paused: no session is processed until it is resumed; sessions processed later are recorded as late.' : 'Resumed: the next update processes every completed session since the last one.' });
  }

  // The figures P4 sets side by side: HXR minus hold.
  const p4Figures = (a, b) => ({
    firstDate: a?.firstDate ?? null, lastDate: a?.lastDate ?? null, sessions: a?.sessions ?? null, years: a?.years ?? null,
    ...Object.fromEntries(['totalReturnPct', 'annualisedReturnPct', 'maxDrawdownPct', 'returnToDrawdown'].map((k) => {
      const x = a?.[k] ?? null, y = b?.[k] ?? null;
      return [k, { hxr: x, hold: y, diff: Number.isFinite(x) && Number.isFinite(y) ? x - y : null }];
    })),
  });

  // The clean (not contaminated) evaluation of the account's frozen version, if one exists.
  function historicalResult(p) {
    const entry = store.listLedger(db, { kind: 'evaluation' }).find((e) => e.prereg === PREREG && e.version === p.version && e.configHash === p.configHash && !e.contaminated);
    if (!entry) return null;
    const runs = entry.runIds.map((id) => store.getRun(db, id)).filter(Boolean);
    const get = (arm) => runs.find((r) => r.details?.variant === 'main' && r.details?.arm === arm && r.metrics);
    const hx = get('hxr'), hd = get('hold');
    if (!hx || !hd) return null;
    return { at: entry.at, runIds: { hxr: hx.id, hold: hd.id }, basket: hx.basket, period: hx.period, outcome: hx.details?.evaluation?.outcome ?? null, ...p4Figures(hx.metrics, hd.metrics) };
  }

  // Per-fill realistic prices (first 15-minute VWAP ± half-spread) against the
  // assumed fills, per arm, in the shape metrics.js fillComparison returns. No
  // VWAP-fill account is run prospectively, so its end value is not computed.
  function prospectiveFills(events, arm) {
    const fills = events.filter((e) => e.kind === 'fill' && e.arm === arm);
    const diffs = fills.map((e) => e.detail?.realistic?.diffBps).filter(Number.isFinite);
    return {
      matched: diffs.length, unmatched: 0, fillsWithoutVw15: fills.length - diffs.length, medianAbsDiffBps: median(diffs),
      meanAbsDiffBps: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,
      openEndValue: null, vw15EndValue: null, endValueDiff: null, basis: 'per fill, as recorded (prospective)',
    };
  }

  // P1-P3 operational figures and the P4 comparison (criteria-hxr-v1.json); judged later, separately.
  function operational(p, events, m = null) {
    const sessions = events.filter((e) => e.kind === 'session' && e.arm === 'hxr' && e.detail?.trading);
    const onTime = sessions.filter((e) => e.onTime).length;
    const decisions = events.filter((e) => e.kind === 'decision' && e.arm === 'hxr');
    const fills = events.filter((e) => e.kind === 'fill');
    const dupes = (list) => {
      const n = new Map();
      for (const e of list) { const k = `${e.arm}:${e.detail?.orderId}`; n.set(k, (n.get(k) || 0) + 1); }
      return [...n.values()].filter((x) => x > 1).length;
    };
    const withoutBar = fills.filter((e) => !store.getBars(db, e.symbol, { from: e.date, to: e.date }).length).length;
    const diffs = fills.filter((e) => e.arm === 'hxr' && Number.isFinite(e.detail?.realistic?.diffBps)).map((e) => e.detail.realistic.diffBps);
    const c = Object.fromEntries(criteria.prospective.map((x) => [x.id, x]));
    const months = p.lastProcessed && p.lastProcessed >= p.startDate ? (Date.parse(`${p.lastProcessed}T00:00:00Z`) - Date.parse(`${p.startDate}T00:00:00Z`)) / 86400000 / 30.4375 : 0;
    const pct = sessions.length ? (onTime / sessions.length) * 100 : null;
    const med = median(diffs);
    const duplicateOrders = dupes(events.filter((e) => e.kind === 'decision')) + dupes(fills);
    return {
      P1: { months, decisions: decisions.length, minMonths: c.P1.minMonths, minDecisions: c.P1.minDecisions, met: months >= c.P1.minMonths && decisions.length >= c.P1.minDecisions },
      P2: { sessions: sessions.length, onTime, onTimePct: pct, minOnTimePct: c.P2.minOnTimePct, duplicateOrders, fillsWithoutBar: withoutBar, met: pct != null && pct >= c.P2.minOnTimePct && !duplicateOrders && !withoutBar },
      P3: { fillsCompared: diffs.length, medianAbsDiffBps: med, maxMedianBps: c.P3.maxMedianBps, met: med == null ? null : med <= c.P3.maxMedianBps },
      P4: { rule: c.P4.rule, note: P4_STATEMENT, prospective: m ? p4Figures(m.hxr, m.hold) : null, historical: historicalResult(p), met: null },
      note: 'Prospective criteria are judged later and separately; nothing here is permission to trade.',
    };
  }

  function prospectiveStatus() {
    const p = store.getProspective(db);
    const v = store.getVersion(db, FROZEN_VERSION);
    if (!p) {
      return wrap({ account: null, canStart: !!v, spcx: spcx(), note: v ? `No prospective account yet. It would use ${FROZEN_VERSION} on basket B${spcxConfirmed() ? ' plus SPCX' : ''}.` : 'No frozen version yet, so the prospective account cannot start.' });
    }
    const { configs, engines } = prospectiveEngines(p, halfSpreadFn(spreadTable(year(todayIn(NY, clock())))));
    const meta = (arm) => ({ startingCash: configs[arm].account.startingCash, basket: p.symbols.map((s) => s.symbol), label: configs[arm].label, version: configs[arm].version, ruleType: configs[arm].rule.type, fillModel: configs[arm].execution.fillModel, delaySessions: configs[arm].execution.delaySessions });
    const out = { hxr: { meta: meta('hxr'), ...engines.hxr.output() }, hold: { meta: meta('hold'), ...engines.hold.output() } };
    const m = { hxr: computeRunMetrics(out.hxr), hold: computeRunMetrics(out.hold) };
    const events = store.listProspectiveEvents(db, { limit: 100000 });
    const links = new Map(events.filter((e) => e.kind === 'news_link').map((e) => [`${e.arm}:${e.detail.decisionId}`, e.detail]));
    const arm = (a) => ({
      equity: out[a].equity.at(-1) ?? null, sleeves: out[a].sleeves, receivables: out[a].receivables, pendingOrders: out[a].pendingAtEnd, metrics: m[a],
    });
    return wrap({
      account: accountSummary(p), hxr: arm('hxr'), hold: arm('hold'), comparison: compareArms(m.hxr, m.hold),
      fillComparison: { hxr: prospectiveFills(events, 'hxr'), hold: prospectiveFills(events, 'hold') },
      decisions: events.filter((e) => e.kind === 'decision').map((e) => ({ arm: e.arm, date: e.date, symbol: e.symbol, recordedAt: e.recordedAt, onTime: e.onTime, decision: e.detail, news: links.get(`${e.arm}:${e.detail.id}`) ?? null })),
      fills: events.filter((e) => e.kind === 'fill').map((e) => ({ arm: e.arm, date: e.date, symbol: e.symbol, recordedAt: e.recordedAt, onTime: e.onTime, fill: e.detail })),
      warnings: events.filter((e) => ['warning', 'operational'].includes(e.kind)).map((e) => ({ arm: e.arm, date: e.date, symbol: e.symbol, recordedAt: e.recordedAt, detail: e.detail })),
      operational: operational(p, events, m), lastTick: store.getSetting(db, 'prospectiveLastTick'), lastError: store.getSetting(db, 'prospectiveLastError'),
      newsNote: NEWS_NOTE,
    });
  }

  // ---------- read views ----------

  function overview() {
    const r = readinessNow();
    const p = store.getProspective(db);
    return wrap({
      prereg: preregFiles(), experimentLogFile: experimentLogFile(), historicalCaveat: HISTORICAL_CAVEAT,
      decisions: { mu: muDecision(), muHistory: store.getSetting(db, 'muDecisions', []), reviewedMoves: store.getSetting(db, 'reviewedMoves', []) },
      universe: {
        name: universe.name, selectedAt: universe.selectedAt, selectedBy: universe.selectedBy, selectedBefore: universe.selectedBefore ?? null, baskets: universe.baskets,
        symbols: universe.symbols.map((s) => ({ symbol: s.symbol, name: s.name, exchange: s.exchange, listedFrom: s.listedFrom, kind: s.kind, baskets: s.baskets, identity: s.identity ?? 'confirmed', note: s.note ?? null })),
      },
      periods: { ...periods.periods, excludedSessions: periods.excludedSessions, warmupSessions: periods.warmupSessions, dataFrom: periods.dataFrom },
      neighbours: NEIGHBOURS, validation: validationState(), pickRule: criteria.selection?.pickRule ?? null, benchmarks: ['hold', 'holdDayOne'],
      criteria: { outcomes: criteria.outcomes, selection: criteria.selection, validation: criteria.validation ?? null, criteria: criteria.criteria.map((c) => ({ id: c.id, name: c.name, rule: c.rule })), prospective: criteria.prospective.map((c) => ({ id: c.id, name: c.name, rule: c.rule })), passMeaning: PASS_MEANING },
      // The rule and its assumptions, so the page can state them before any result exists.
      configs: listHxrConfigs().map((c) => (c.error ? { file: c.file, role: configRole(c.file), error: c.error } : {
        file: c.file, role: configRole(c.file), version: c.version, label: c.label, ruleType: c.ruleType, hash: c.hash, status: c.config.status ?? null, rule: c.config.rule,
        assumptions: { account: c.config.account, execution: c.config.execution, costs: c.config.costs, dividends: c.config.dividends, cash: c.config.cash, risk: c.config.risk ?? null, initialLoss: c.config.initialLoss ?? null },
      })),
      settings: { spcx: spcx(), spcxIdentity: SPCX_IDENTITY, alpacaKeys: keysSet },
      data: dataStatus(), fetch: { job: store.getSetting(db, 'fetchJob'), running: fetching },
      readiness: readinessSummary(r), spreadCalibration: spreadStatus(),
      versions: store.listVersions(db).map((v) => ({ ...v, file: `strategy/hxr/configs/${configFileName(v.version)}` })), runs: store.listRuns(db, { limit: 100 }).map(runSummary),
      ledger: store.listLedger(db), experiments: store.listExperiments(db),
      prospective: accountSummary(p), busy,
    });
  }

  function getRun(id) {
    const run = store.getRun(db, id);
    if (!run) throw new HxrError(404, 'Run not found');
    return wrap({ run, fills: store.listFills(db, id), decisions: store.listDecisions(db, id), episodes: store.listEpisodes(db, id), equity: store.listEquity(db, id) });
  }

  function listRuns({ kind = null, limit = 100 } = {}) {
    if (kind != null && !RUN_KINDS.includes(kind)) throw new HxrError(400, `kind must be ${RUN_KINDS.join(', ')}`);
    return wrap({ runs: store.listRuns(db, { kind, limit }).map(runSummary) });
  }

  function news({ symbol = null, limit = 100 } = {}) {
    const sym = symbol ? checkSymbol(symbol) : null;
    const n = Math.max(1, Math.min(Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 100, 500));
    return wrap({ untrusted: true, note: NEWS_NOTE, items: store.newsFor(db, { symbol: sym, limit: n }) });
  }

  function setSpcxConfirmed({ confirmed, confirm } = {}) {
    if (confirm !== true) throw new HxrError(400, `Recording SPCX's identity needs confirm: true (${SPCX_IDENTITY}).`);
    if (typeof confirmed !== 'boolean') throw new HxrError(400, 'confirmed must be true or false');
    const rec = { confirmed, at: clock().toISOString(), by: 'the owner, through the HXR page (real workspace)', identity: SPCX_IDENTITY };
    store.setSetting(db, 'spcxConfirmations', [...store.getSetting(db, 'spcxConfirmations', []), rec]);
    store.setSetting(db, 'spcxConfirmed', rec);
    const p = store.getProspective(db);
    const held = p?.symbols.some((s) => uSyms.get(s.symbol)?.identity && uSyms.get(s.symbol).identity !== 'confirmed');
    const note = p ? (held && !confirmed ? 'The prospective account holds SPCX: it is not processed while SPCX\'s identity is unconfirmed.' : 'The prospective account already exists; its sleeves were fixed when it started, so this does not change them.')
      : confirmed ? 'SPCX joins the prospective account when it is started (9 sleeves). It is never used in a backtest.' : 'SPCX stays out of HXR until its identity is confirmed.';
    return wrap({ spcx: rec, note });
  }

  const hxr = {
    db, file,
    overview,
    fetchData,
    fetchStatus: () => wrap({ job: store.getSetting(db, 'fetchJob'), running: fetching }),
    readiness: () => wrap({ ...readinessNow(), reviewedMoves: store.getSetting(db, 'reviewedMoves', []), gate: 'The development pick, the validation run and the final run are refused unless every basket member is complete for the period and spread calibration exists. The basket B full-list check is reported, not a gate: without it the evaluation runs only if you say so.' }),
    setSpcxConfirmed,
    setMuDecision,
    reviewMove,
    runSelection,
    runValidation,
    runEvaluation,
    startProspective,
    prospectiveTick,
    pauseProspective: () => setStatus('paused', 'active'),
    resumeProspective: () => setStatus('active', 'paused'),
    prospectiveStatus,
    listRuns,
    getRun,
    experiments: () => wrap({ experiments: store.listExperiments(db), note: 'Append-only; mirrored by hand in strategy/hxr/EXPERIMENT-LOG.md.' }),
    ledger: () => wrap({ ledger: store.listLedger(db), note: 'Append-only: one row per development pick, validation run or final run. A repeat is marked contaminated and can never pass or validate.' }),
    news,

    // Scheduler hook: updates the active prospective account at most every few
    // minutes; a no-op without one. Never throws.
    async tick({ now = clock() } = {}) {
      if (closed) return { skipped: true };
      try {
        const p = store.getProspective(db);
        if (!p || p.status !== 'active') return { skipped: true, reason: p ? `prospective account ${p.status}` : 'no prospective account' };
        if (now.getTime() - lastAutoTick < tickEveryMs) return { skipped: true, reason: 'not due' };
        lastAutoTick = now.getTime();
        return await prospectiveTick({ now });
      } catch (e) {
        return { error: safe(e.message) };
      }
    },

    close() {
      closed = true;
      try { db.close(); } catch { /* already closed */ }
    },
  };

  store.failInterruptedRuns(db, clock().toISOString());
  const job = store.getSetting(db, 'fetchJob');
  if (job?.status === 'running') {
    if (source) hxr.fetchDone = runFetchJob().catch(() => {});
    else save({ ...job, status: 'paused', error: 'Alpaca keys are not set (ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY in .env); start the download again once they are. What is stored is kept.' });
  }
  return hxr;
}

// Lazy per-context handle: hxr-sim.sqlite is opened on first use, and only in
// the real workspace (the demo workspace gets a stub that refuses every call).
export function attachHxr(ctx, opts = {}) {
  let hxr = null;
  Object.defineProperty(ctx, 'hxr', { configurable: true, enumerable: false, get: () => (hxr ||= createHxr(ctx, opts)) });
  Object.defineProperty(ctx, 'hxrIfOpen', { configurable: true, enumerable: false, get: () => hxr });
  return ctx;
}
