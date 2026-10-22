// Strategy Lab service: one instance per workspace context (ctx.lab), used by
// the API, the scheduler and the chat tools. Simulation only: a hypothetical
// account in its own database (store.js), never the real portfolio, cash or
// holdings, and nothing here places, routes or prepares an order anywhere.
// Engine runs (backtests, the holdout, demo seeding) run in a worker thread so
// the HTTP server and the briefing scheduler are never blocked by them.
import fs from 'node:fs';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as store from './store.js';
import { loadStrategyConfig, loadUniverse, loadSplits, loadAcceptance, configHash, diffConfigs, validateConfig, STRATEGY_DIR, MODES, DESCRIPTIVE_KEYS } from './config.js';
import { runSplit, runStress, runWalkForward, runHoldout as validationHoldout, evaluateAcceptance, splitRange, HoldoutRefused, OUTCOME_NOTE } from './validation.js';
import { buildReport } from './report.js';
import { buildRegimes } from './regimes.js';
import { etDate } from './metrics.js';
import { parseTradingViewCsv, parseGenericCsv, normalizeBars, qualityReport, datasetHash } from './data.js';
import { generateSyntheticBars } from './synthetic.js';
import { whySetupQualifies, whySignal, whyRejectedOrSkipped, whatEnded } from './explain.js';
import { dayStartMs, tradingDays } from './sessions.js';
import { forwardTick, startForward, stopForward, replayForward, forwardAccount, forwardResults, DEFAULT_MAX_SIGNAL_DELAY_MIN } from './forward.js';
import { createAlpacaSource } from './sources/alpaca.js';
import { buildReadiness, loadCorporateActions, CORPORATE_ACTIONS_FILE, FORWARD_FEEDS } from './readiness.js';
import { todayIn, addDays, NY } from '../time.js';
import { redact } from '../config.js';

export const SYNTHETIC_LABEL = 'SYNTHETIC — demonstrates the interface, not the strategy';
export const REAL_PORTFOLIO_NOTE = 'Separate from your real portfolio: your last reported real available cash is $0, paper profits are not buying power, and nothing here assumes you sold any real holding.';
export const MAX_CSV_BYTES = 20 * 1024 * 1024;
// What each history source declares about its bars (strategy/DATA-READINESS.md).
// Bars from different keys are never mixed within a symbol's history window.
export const SOURCE_META = {
  alpaca: { name: 'Alpaca (SIP, split-adjusted)', adjustment: 'split', feed: 'sip', note: 'adjustment=split and feed=sip are sent with every request; Alpaca\'s handling of them is checked by the readiness checklist, not assumed.' },
  twelvedata: { name: 'Twelve Data', adjustment: 'unknown', feed: 'default', note: 'No adjust parameter is sent; Twelve Data\'s FAQ says intraday bars are unadjusted (unverified), and its free plan is not verified to reach 2021-07-01.' },
  csv: { name: 'CSV import', adjustment: 'unknown', feed: 'unknown', note: 'Adjustment and feed depend on where the file came from.' },
};
const metaOf = (id) => SOURCE_META[id] || { name: id, adjustment: 'unknown', feed: 'unknown', note: 'Adjustment and feed are not declared by this provider.' };
const sameKey = (a, b) => a.source === b.source && (a.adjustment ?? null) === (b.adjustment ?? null) && (a.feed ?? null) === (b.feed ?? null);
export const SPLITS = ['development', 'validation', 'stress', 'walk_forward'];
const KIND_OF = { development: 'backtest', validation: 'backtest', stress: 'stress', walk_forward: 'walk_forward' };
export const DEMO_DEFAULTS = { seed: 1, from: '2021-07-01', to: '2024-12-31', replaySessions: 30, warmupSessions: 5 };
const MAX_CHART_BARS = 5000;
const EVENT_TYPES = ['setup_eligible', 'setup_expired', 'setup_invalidated', 'signal', 'signal_rejected', 'order_placed', 'entry_skipped', 'entry_filled', 'exit_order', 'exit_filled', 'data_warning', 'operational_error'];
export const JOURNAL_GROUPS = {
  setups: ['setup_eligible', 'setup_expired', 'setup_invalidated'],
  signals: ['signal', 'signal_rejected', 'order_placed'],
  skips: ['signal_rejected', 'entry_skipped'],
  fills: ['entry_filled', 'exit_filled'],
  exits: ['exit_order', 'exit_filled'],
  costs: ['entry_filled', 'exit_filled'],
  errors: ['data_warning', 'operational_error'],
};
const BOX_PARAM_KEYS = ['lookbackBars', 'atrLength', 'maxHeightAtr', 'minHeightAtr', 'touchToleranceAtr', 'minTouchesEach', 'minBarsBetweenTouches', 'setupExpiryBars'];

export class LabError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const iso = (ms) => new Date(ms).toISOString();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayStartIso = (d) => iso(dayStartMs(d));
const dayEndIso = (d) => iso(dayStartMs(addDays(d, 1)) - 1);
const eventBoxParams = (config) => Object.fromEntries(BOX_PARAM_KEYS.map((k) => [k, config.box[k]]));
const scalars = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v == null || typeof v !== 'object'));
const usd = (x) => `US$${Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const semverKey = (v) => String(v || '').split('.').map((n) => String(Number(n) || 0).padStart(6, '0')).join('.');
const plainVersion = (v) => String(v || '').trim().replace(/\.json$/i, '').replace(/^[a-z]+-(?=\d)/i, '');

export function simulatedLabel(config) {
  return `Simulated, hypothetical account (${usd(config?.risk?.hypotheticalStartingEquity ?? 100000)} starting balance from the strategy config). Nothing here places, routes or prepares an order.`;
}

// Downsampled daily equity: the last point of each ET session.
export function dailyEquity(curve = []) {
  const out = [];
  for (const p of curve) {
    const d = etDate(p.t);
    const row = { date: d, equity: p.equity, cash: p.cash ?? null, positions: p.positions ?? null };
    if (out.length && out[out.length - 1].date === d) out[out.length - 1] = row; else out.push(row);
  }
  return out;
}

function headline(m) {
  if (!m) return null;
  return {
    trades: m.trades ?? null, meanR: m.meanR ?? null, profitFactor: m.profitFactor ?? null, winRate: m.winRate ?? null, netPnl: m.netPnl ?? null,
    returnPct: m.returnPct ?? null, maxDrawdownPct: m.maxDrawdownPct ?? null, meanRCI: m.meanRCI ? { lower: m.meanRCI.lower, upper: m.meanRCI.upper } : null,
  };
}

function runSummary(r) {
  if (!r) return null;
  const { metrics, ...rest } = r;
  return { ...rest, headline: headline(metrics) };
}

// ---------- configs and the parameter log ----------

// Parsed, validated and hashed again only when a file in the folder changes.
const configCache = new Map();

export function readConfigs(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const key = files.map((f) => `${f}\n${fs.readFileSync(path.join(dir, f), 'utf8')}`).join('\n\0');
  const hit = configCache.get(dir);
  if (hit?.key === key) return hit.list;
  const list = files.map((f) => {
    const file = path.join(dir, f);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const errors = validateConfig(raw);
      return {
        file: f, path: file, strategy: raw.strategy ?? null, version: raw.version ?? null, label: raw.label ?? null, status: raw.status ?? null,
        createdAt: raw.createdAt ?? null, valid: !errors.length, errors, configHash: errors.length ? null : configHash(raw), config: errors.length ? null : loadStrategyConfig(file),
      };
    } catch (e) {
      return { file: f, path: file, version: null, valid: false, errors: [e.message], configHash: null, config: null };
    }
  }).sort((a, b) => (semverKey(a.version) < semverKey(b.version) ? -1 : semverKey(a.version) > semverKey(b.version) ? 1 : 0));
  configCache.set(dir, { key, list });
  return list;
}

export function parseParameterLog(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length < 5 || /^date$/i.test(cells[0]) || /^-+$/.test(cells[0].replace(/:/g, ''))) continue;
    rows.push({ date: cells[0], version: plainVersion(cells[1]), versionLabel: cells[1], change: cells[2], reason: cells[3], dataSeen: cells[4] });
  }
  return rows;
}

// ---------- engine jobs (run in a worker thread) ----------

function loadInputs(db, { configFile, split = null, to = null }) {
  const config = loadStrategyConfig(configFile);
  const universe = loadUniverse(), splits = loadSplits(), acceptance = loadAcceptance();
  const names = universe.symbols.map((s) => s.symbol);
  const end = to || (split === 'walk_forward' ? splits.walkForward.range.to : splitRange(splits, split === 'stress' ? 'validation' : split).to);
  const bars = store.barsBySymbol(db, names, { from: dayStartIso(splits.warmup.from), to: dayEndIso(end) });
  const present = names.filter((s) => bars.has(s));
  const regimes = buildRegimes(bars.get(universe.regimeProxy || 'SPY') || []);
  const quality = {};
  for (const s of present) quality[s] = scalars(qualityReport(bars.get(s), { exchange: universe.symbols.find((u) => u.symbol === s)?.exchange || 'NYSE' }));
  return { config, universe, splits, acceptance, bars, present, regimes, synthetic: !!bars.synthetic, dataHash: datasetHash(bars), quality };
}

function reportFor(inp, mode, key, result, at) {
  const meta = { synthetic: inp.synthetic, seed: null, dataHash: inp.dataHash, configHash: configHash(inp.config), version: inp.config.version, dataSource: 'Strategy Lab database', generatedAt: at, command: null };
  const dq = { synthetic: inp.synthetic, source: 'Strategy Lab database', dataHash: inp.dataHash, symbols: inp.quality };
  return buildReport({ runs: { meta, modes: { [mode]: { [key]: result } } }, acceptance: inp.acceptance, universe: inp.universe, splits: inp.splits, config: inp.config, dataQuality: dq }).markdown;
}

function storeResult(db, runId, { result, kind, inp, report, at, extra = {} }) {
  const params = eventBoxParams(inp.config);
  const trades = kind === 'walk_forward' ? result.oos.trades : kind === 'stress' ? [] : result.trades;
  const events = kind === 'walk_forward' || kind === 'stress' ? [] : result.events;
  const metrics = kind === 'walk_forward' ? result.oos.metrics : kind === 'stress' ? result.baseline.metrics : result.metrics;
  let details;
  if (kind === 'stress') details = { tests: result.tests, baseline: result.baseline, from: result.from, to: result.to };
  else if (kind === 'walk_forward') details = { folds: result.folds, baseline: result.baseline, oos: { from: result.oos.from, to: result.oos.to }, grid: result.grid, method: result.method, minInSampleTrades: result.minInSampleTrades };
  else details = { dataCoverage: result.dataCoverage, buyAndHold: result.buyAndHold, eventCounts: events.reduce((a, e) => ({ ...a, [e.type]: (a[e.type] || 0) + 1 }), {}) };
  store.tx(db, () => {
    store.insertTrades(db, runId, trades);
    store.insertEvents(db, runId, 'backtest', events);
    store.updateRun(db, runId, {
      status: 'done', finishedAt: at, metrics, report, dataHash: inp.dataHash, synthetic: !!(inp.synthetic || result.synthetic),
      symbols: inp.present, equity: kind === 'walk_forward' || kind === 'stress' ? [] : dailyEquity(result.equityCurve),
      details: { ...details, boxParams: params, dataQuality: inp.quality, ...extra },
    });
  });
}

async function executeBacktest(db, { runId, mode, split, configFile }) {
  const inp = loadInputs(db, { configFile, split });
  if (!inp.present.length) throw new Error('No bars are stored for the universe in this period');
  const common = { config: inp.config, mode, bars: inp.bars, symbols: inp.present, splits: inp.splits, universe: inp.universe, regimes: inp.regimes, synthetic: inp.synthetic };
  let result, key;
  if (split === 'stress') { result = await runStress({ ...common, acceptance: inp.acceptance }); key = 'stress'; }
  else if (split === 'walk_forward') { result = await runWalkForward(common); key = 'walkForward'; }
  else { result = await runSplit({ ...common, split }); key = split; }
  const at = new Date().toISOString();
  storeResult(db, runId, { result, kind: KIND_OF[split], inp, report: reportFor(inp, mode, key, result, at), at });
  return { runId };
}

const JOBS = {
  async backtest(a) {
    const db = store.openLabDb(a.file);
    try { return await executeBacktest(db, a); } finally { db.close(); }
  },
  async holdout(a) {
    const db = store.openLabDb(a.file);
    try {
      const inp = loadInputs(db, { configFile: a.configFile, split: 'holdout' });
      if (!inp.present.length) throw new Error('No bars are stored for the holdout period');
      const result = await validationHoldout({
        config: inp.config, mode: a.mode, bars: inp.bars, symbols: inp.present, splits: inp.splits, acceptance: inp.acceptance,
        ledger: store.holdoutLedger(db, a.runId), reason: a.reason, at: a.at, configHash: configHash(inp.config),
        universe: inp.universe, regimes: inp.regimes, synthetic: inp.synthetic,
      });
      const at = new Date().toISOString();
      storeResult(db, a.runId, {
        result, kind: 'holdout', inp, report: reportFor(inp, a.mode, 'holdout', result, at), at,
        extra: { variants: result.variants, priorRuns: result.priorRuns, ledgerEntry: result.ledgerEntry },
      });
      store.updateRun(db, a.runId, { contaminated: !!result.contaminated, reason: result.reason });
      return { runId: a.runId, contaminated: result.contaminated };
    } finally { db.close(); }
  },
  async demoSeed(a) {
    const db = store.openLabDb(a.file);
    try {
      if (store.getSetting(db, 'demoSeed')?.status === 'ready') return { already: true };
      store.setSetting(db, 'demoSeed', { status: 'preparing', startedAt: new Date().toISOString(), seed: a.seed });
      const universe = loadUniverse();
      const syms = (a.symbols?.length ? a.symbols : universe.symbols.map((s) => s.symbol)).filter((s) => universe.symbols.some((u) => u.symbol === s));
      if (!store.hasSyntheticBars(db)) {
        const g = generateSyntheticBars({ symbols: syms, from: a.from, to: a.to, seed: a.seed });
        for (const [sym, list] of g.bars) store.upsertBars(db, sym, list, { source: 'synthetic', synthetic: true });
      }
      const config = loadStrategyConfig(a.configFile);
      const hash = configHash(config);
      for (const mode of MODES) {
        for (const split of ['development', 'validation']) {
          if (store.listRuns(db, { kind: 'backtest', mode, split, status: 'done', configHash: hash, limit: 1 }).length) continue;
          const range = splitRange(loadSplits(), split);
          const runId = store.createRun(db, { kind: 'backtest', mode, split, version: config.version, configHash: hash, config, from: range.from, to: range.to, synthetic: true, status: 'running', label: `${SYNTHETIC_LABEL}: ${split} ${range.from} to ${range.to}` });
          await executeBacktest(db, { runId, mode, split, configFile: a.configFile });
        }
      }
      const days = tradingDays(a.from, a.to);
      const replayDays = days.slice(-a.replaySessions);
      const warmFrom = days[Math.max(0, days.length - a.replaySessions - a.warmupSessions)];
      const symbols = universe.symbols.filter((s) => syms.includes(s.symbol)).map((s) => ({ symbol: s.symbol, exchange: s.exchange, sector: s.sector, cluster: s.cluster }));
      const bars = store.barsBySymbol(db, syms, { from: dayStartIso(warmFrom), to: dayEndIso(a.to) });
      for (const mode of MODES) {
        if (store.getForward(db, mode)) continue;
        replayForward(db, { mode, config, symbols, bars, from: dayStartMs(replayDays[0]), label: `${SYNTHETIC_LABEL}: synthetic forward replay of the last ${replayDays.length} sessions`, maxSignalDelayMin: a.maxSignalDelayMin });
      }
      store.setSetting(db, 'demoSeed', { status: 'ready', seed: a.seed, from: a.from, to: a.to, symbols: syms, replay: { from: replayDays[0], to: replayDays[replayDays.length - 1] }, finishedAt: new Date().toISOString() });
      return { ready: true };
    } catch (e) {
      try { store.setSetting(db, 'demoSeed', { status: 'failed', error: e.message, seed: a.seed }); } catch { /* db unusable */ }
      throw e;
    } finally { db.close(); }
  },
};

// ---------- the service ----------

export function createLab(ctx, opts = {}) {
  const workspace = ctx.mode === 'demo' ? 'demo' : 'real';
  const demo = workspace === 'demo';
  const file = opts.file || store.labDbFile(ctx.cfg, workspace);
  const db = store.openLabDb(file);
  const clock = opts.clock || (() => new Date());
  const inline = opts.jobs === 'inline';
  const configsDir = opts.configsDir || path.join(STRATEGY_DIR, 'configs');
  const logFile = opts.parameterLog || path.join(STRATEGY_DIR, 'PARAMETER-LOG.md');
  const maxSignalDelayMin = Number(ctx.cfg?.lab?.maxSignalDelayMin) > 0 ? Number(ctx.cfg.lab.maxSignalDelayMin) : DEFAULT_MAX_SIGNAL_DELAY_MIN;
  const demoOpts = { ...DEMO_DEFAULTS, ...(opts.demo || {}) };
  const universe = loadUniverse(), splits = loadSplits(), acceptance = loadAcceptance();
  const uSyms = new Map(universe.symbols.map((s) => [s.symbol, s]));
  // The pre-registered history window: the only range the source-mixing rule and the readiness checklist cover.
  const windowIso = { from: dayStartIso(splits.warmup.from), to: dayEndIso(splits.holdout.to) };
  const caFile = opts.corporateActionsFile || CORPORATE_ACTIONS_FILE;
  const safe = (m) => (ctx.cfg?.secrets ? redact(String(m ?? ''), ctx.cfg) : String(m ?? ''));
  const sec = ctx.cfg?.secrets || {};
  // Alpaca history (keys in .env only); never in the demo workspace.
  const alpaca = demo ? null : opts.alpaca !== undefined ? opts.alpaca
    : sec.ALPACA_API_KEY_ID && sec.ALPACA_API_SECRET_KEY
      ? createAlpacaSource({ keyId: sec.ALPACA_API_KEY_ID, secretKey: sec.ALPACA_API_SECRET_KEY, fetchImpl: opts.alpacaFetch, sleep: opts.alpacaSleep, now: clock })
      : null;
  let readinessCache = null;
  // Sources in the history window, recomputed when barCoverage's cached rows change.
  const histKeysCache = new WeakMap();
  const historyKeys = () => {
    const cov = store.barCoverage(db);
    if (!histKeysCache.has(cov)) histKeysCache.set(cov, store.barSourceKeys(db, null, windowIso));
    return histKeysCache.get(cov);
  };
  const workers = new Set();
  const memos = new Map();
  let busy = null, ticking = false, fetching = false, closed = false;
  let pauseCheck = () => false;

  const market = () => (demo ? null : ctx.providers?.market || null);

  // History sources that are configured now, the preferred one first unless
  // LAB_HISTORY_SOURCE names another: Alpaca when its keys are set, then the
  // market-data provider if it can download 15-minute history.
  function historySources() {
    const list = [];
    if (alpaca) list.push({ id: 'alpaca', kind: 'alpaca', impl: alpaca, ...metaOf('alpaca') });
    const p = market();
    if (p && typeof p.getIntradayRange === 'function') list.push({ id: p.id || 'provider', kind: 'provider', impl: p, ...metaOf(p.id || 'provider'), name: p.name || metaOf(p.id).name });
    const pref = ctx.cfg?.lab?.historySource || 'auto';
    const preferred = (pref !== 'auto' && list.find((s) => s.id === pref)) || list[0] || null;
    return { list, preferred };
  }
  const publicSources = () => {
    const { list, preferred } = historySources();
    return list.map((s) => ({ id: s.id, name: s.name, adjustment: s.adjustment, feed: s.feed, preferred: s.id === preferred?.id, note: s.note }));
  };

  function configs() { return readConfigs(configsDir); }
  function activeConfigEntry() {
    const valid = configs().filter((c) => c.valid);
    if (!valid.length) throw new LabError(500, `No valid strategy config in ${configsDir}`);
    return valid[valid.length - 1];
  }
  const active = () => activeConfigEntry().config;

  function wrap(data = {}) {
    const synthetic = demo || !!data.synthetic;
    return {
      ...data, simulated: true, workspace, label: simulatedLabel(active()), realPortfolio: REAL_PORTFOLIO_NOTE,
      synthetic, ...(synthetic ? { syntheticLabel: SYNTHETIC_LABEL } : {}),
    };
  }

  const checkMode = (mode) => {
    if (!MODES.includes(mode)) throw new LabError(400, `mode must be ${MODES.join(' or ')}`);
    return mode;
  };
  const checkSymbol = (symbol) => {
    const s = String(symbol || '').trim().toUpperCase();
    if (!uSyms.has(s)) throw new LabError(400, `${s || 'The symbol'} is not in ${universe.name} (${[...uSyms.keys()].join(', ')})`);
    return s;
  };
  const checkLimit = (n, d = 100, max = 500) => Math.max(1, Math.min(Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : d, max));

  // ---------- jobs ----------

  function runJob(kind, args) {
    if (inline) return JOBS[kind](args);
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { labJob: { kind, args } } });
      workers.add(w);
      let settled = false;
      const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
      w.once('message', (m) => (m.ok ? done(resolve, m.result) : done(reject, Object.assign(new Error(m.error), { refused: !!m.refused }))));
      w.once('error', (e) => done(reject, e));
      w.once('exit', (code) => { workers.delete(w); done(reject, new Error(code ? `The Strategy Lab job stopped (exit code ${code})` : 'The Strategy Lab job ended without a result')); });
    });
  }

  function ensureIdle() {
    if (closed) throw new LabError(503, 'The Strategy Lab is closed');
    if (busy) throw new LabError(409, `Another Strategy Lab job is running (${busy.label}, started ${busy.startedAt}). Try again when it has finished.`);
  }

  function claim(kind, label, runId = null) {
    ensureIdle();
    busy = { kind, label, runId, startedAt: clock().toISOString() };
  }

  function launch(kind, runId, args) {
    const p = runJob(kind, { ...args, file, runId }).then(
      () => { if (!closed) refreshAcceptance(runId); return runId; },
      (e) => {
        if (!closed) store.updateRun(db, runId, { status: 'failed', error: e.refused ? `Refused: ${e.message}` : e.message, finishedAt: clock().toISOString() });
        throw e;
      },
    ).finally(() => { busy = null; });
    p.catch(() => {}); // the caller decides whether to await; a failure is stored on the run
    return p;
  }

  function refreshAcceptance(runId) {
    const r = store.getRun(db, runId, { full: false });
    if (!r || r.kind === 'forward') return;
    try { store.updateRun(db, runId, { acceptance: evaluate(r.mode).evaluation }); } catch { /* evaluation is informational */ }
  }

  function barsInRange(from, to) {
    return db.prepare("SELECT COUNT(*) n FROM lab_bars WHERE interval = '15min' AND t >= ? AND t <= ?").get(dayStartIso(from), dayEndIso(to)).n;
  }

  function needsData() {
    const p = market();
    return {
      what: 'Split-adjusted 15-minute regular-session OHLCV bars for every symbol in the pre-registered universe.',
      universe: universe.symbols.map((s) => ({ symbol: s.symbol, exchange: s.exchange, sector: s.sector, cluster: s.cluster })),
      dateRange: {
        from: splits.warmup.from, to: splits.holdout.to,
        periods: Object.fromEntries(['warmup', 'development', 'validation', 'holdout'].map((k) => [k, { from: splits[k].from, to: splits[k].to }])),
        forward: 'from the day the forward test is switched on',
      },
      dataSources: [
        'Import a TradingView chart export (15-minute candles, one CSV per symbol) or a generic CSV with time, open, high, low, close and volume columns.',
        alpaca
          ? 'Or download the history through Alpaca (split-adjusted consolidated SIP bars; one request per symbol per quarter, more if a quarter needs several pages).'
          : 'Or set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env (free Alpaca market-data account; preferred: split-adjusted consolidated SIP bars) and download the history from here.',
        p && typeof p.getIntradayRange === 'function'
          ? `Or download the history through ${p.name} (uses about one provider request per symbol per quarter of data; its free plan is not verified to reach ${splits.warmup.from}).`
          : 'Or set MARKET_DATA_PROVIDER=twelvedata with TWELVEDATA_API_KEY in .env (its free plan is not verified to cover the required history; see strategy/DATA-READINESS.md).',
      ],
      readiness: 'GET /api/lab/readiness lists, per symbol and period, exactly what is present and what is missing.',
      lowerTimeframe: 'Optional: 1-minute bars only help resolve bars that touch both the stop and the target.',
      note: splits.dataRequirements,
    };
  }

  // ---------- versions ----------

  function parameterLog() {
    try { return parseParameterLog(fs.readFileSync(logFile, 'utf8')); } catch { return []; }
  }

  // Records each config version once in lab_param_changes, with its reason and
  // data seen from PARAMETER-LOG.md; a config file that changed without a new
  // version number is recorded too.
  function syncVersions() {
    const seen = store.getSetting(db, 'seenConfigs', {});
    const log = parameterLog();
    const list = configs().filter((c) => c.valid);
    let prev = null;
    for (const c of list) {
      const entry = log.find((l) => l.version === c.version);
      if (!seen[c.version]) {
        if (!prev) store.insertParamChange(db, { fromVersion: null, toVersion: c.version, path: '*', from: null, to: c.configHash, reason: entry?.reason || 'first version', dataSeen: entry?.dataSeen ?? null });
        else for (const d of diffConfigs(prev.config, c.config)) store.insertParamChange(db, { fromVersion: prev.version, toVersion: c.version, path: d.path, from: d.from, to: d.to, reason: entry?.reason || 'not recorded in PARAMETER-LOG.md', dataSeen: entry?.dataSeen ?? null });
        seen[c.version] = c.configHash;
      } else if (seen[c.version] !== c.configHash) {
        store.insertParamChange(db, { fromVersion: c.version, toVersion: c.version, path: '*', from: seen[c.version], to: c.configHash, reason: 'the config file changed without a new version number; a rule change needs a new version', dataSeen: null });
        seen[c.version] = c.configHash;
      }
      prev = c;
    }
    store.setSetting(db, 'seenConfigs', seen);
  }

  function findConfig(v) {
    const want = plainVersion(v);
    const c = configs().find((x) => x.version === want || x.file === String(v) || x.file === `${v}.json`);
    if (!c) throw new LabError(404, `No strategy config for version ${v}`);
    if (!c.valid) throw new LabError(400, `The config for version ${c.version} is invalid: ${c.errors.join('; ')}`);
    return c;
  }

  // ---------- evaluation ----------

  function latestRun(kind, mode, split, hash) {
    const r = store.listRuns(db, { kind, mode, split, status: 'done', configHash: hash, limit: 1 })[0];
    return r ? store.getRun(db, r.id) : null;
  }

  function evaluate(mode) {
    const c = activeConfigEntry();
    const hash = c.configHash;
    const validation = latestRun('backtest', mode, 'validation', hash);
    const stress = latestRun('stress', mode, null, hash);
    const wf = latestRun('walk_forward', mode, null, hash);
    const holdouts = store.listRuns(db, { kind: 'holdout', mode, status: 'done', configHash: hash, limit: 100 });
    const h = holdouts.find((x) => !x.contaminated) || holdouts[0] || null;
    const hold = h ? store.getRun(db, h.id) : null;
    const fwdRow = store.getForward(db, mode);
    const fwd = fwdRow?.configHash === hash ? forwardResults(db, mode, { now: clock() }) : null;
    const results = {
      validation: validation ? { metrics: validation.metrics, synthetic: validation.synthetic } : undefined,
      stress: stress ? { tests: stress.details?.tests || [], synthetic: stress.synthetic } : undefined,
      walkForward: wf ? { oos: { metrics: wf.metrics }, synthetic: wf.synthetic } : undefined,
      holdout: hold ? { metrics: hold.metrics, contaminated: hold.contaminated, variants: hold.details?.variants, synthetic: hold.synthetic } : undefined,
      forward: fwd || undefined,
      synthetic: demo,
    };
    return {
      mode, version: c.version, configHash: hash,
      evaluation: evaluateAcceptance({ results, acceptance, mode, universe }),
      basedOn: { validationRunId: validation?.id ?? null, stressRunId: stress?.id ?? null, walkForwardRunId: wf?.id ?? null, holdoutRunId: hold?.id ?? null, forwardRunId: fwd?.runId ?? null },
      note: OUTCOME_NOTE,
    };
  }

  // ---------- explanations ----------

  function boxParamsOfRun(runId, cache = new Map()) {
    if (!cache.has(runId)) {
      const r = runId != null ? db.prepare('SELECT config_json FROM lab_runs WHERE id = ?').get(runId) : null;
      cache.set(runId, r ? eventBoxParams(JSON.parse(r.config_json)) : null);
    }
    return cache.get(runId);
  }

  function explainEvent(e) {
    if (e.type === 'setup_eligible') return whySetupQualifies(e).text;
    if (e.type === 'signal') return whySignal(e).text;
    if (['signal_rejected', 'entry_skipped', 'setup_expired', 'setup_invalidated'].includes(e.type)) return whyRejectedOrSkipped(e).text;
    return e.reason;
  }

  function journalItem(e) {
    const d = e.details || {};
    const out = { ...e, code: d.code ?? null, explanation: explainEvent(e) };
    if (e.type === 'entry_filled' || e.type === 'exit_filled') out.costs = { commission: d.commission ?? null, spreadSlippage: d.spreadSlippage ?? null, fx: d.fx ?? null };
    return out;
  }

  function tradeSummary(row) {
    const t = row.trade;
    return {
      id: row.rowId, tradeId: t.id, runId: row.runId, source: row.kind === 'forward' ? 'forward' : 'backtest', kind: row.kind, mode: t.mode, symbol: t.symbol,
      version: t.version, configHash: t.configHash, signalAt: t.signal?.at ?? null, entryAt: t.entry?.at ?? null, entryPrice: t.entry?.price ?? null,
      shares: t.entry?.shares ?? null, stop: t.plan?.stop ?? null, target: t.plan?.target ?? null, exitAt: t.exit?.at ?? null, exitPrice: t.exit?.price ?? null,
      exitReason: t.exit?.reason ?? null, r: t.pnl?.r ?? null, net: t.pnl?.net ?? null, costs: t.pnl?.costs ?? null,
      ambiguous: !!t.exit?.ambiguous, gapThrough: !!t.exit?.gapThrough, endOfData: t.exit?.reason === 'end_of_data',
      flags: [...(t.entry?.flags || []), ...(t.exit?.flags || [])], simulated: true,
    };
  }

  // ---------- TradingView alerts in the journal ----------

  function compareAlert(a) {
    if (a.status !== 'accepted' || !a.payload) return null;
    const mode = a.payload.mode, sym = a.symbol, at = a.barTime;
    const runs = store.listRuns(db, { kind: 'forward', mode, limit: 20 }).map((r) => r.id);
    if (!runs.length) return { matched: null, note: 'no Signal Desk forward run to compare with' };
    if (a.event === 'exit_filled') return { matched: null, note: 'exit alerts carry the previous bar, so they are not matched automatically' };
    const rows = store.listEvents(db, { runIds: runs, symbol: sym, types: [a.event === 'entry_cancelled' ? 'entry_skipped' : a.event], limit: 500 });
    const hit = rows.find((r) => (a.event === 'entry_filled' ? JSON.parse(r.details_json || '{}').tradeId === `${mode}-${sym}-${at}` : r.at === at));
    return hit ? { matched: true, eventId: hit.id, runId: hit.run_id } : { matched: false, note: 'Signal Desk recorded no matching event for this bar' };
  }

  // ---------- fetch job ----------

  const publicJob = (j) => (j ? {
    id: j.id, status: j.status, provider: j.provider, from: j.from, to: j.to, startedAt: j.startedAt, updatedAt: j.updatedAt, error: j.error ?? null, resumeAfter: j.resumeAfter ?? null,
    source: j.source ?? null, adjustment: j.adjustment ?? null, feed: j.feed ?? null, replace: !!j.replace,
    symbols: Object.entries(j.symbols).map(([symbol, s]) => ({ symbol, status: s.status, fetchedThrough: s.fetchedThrough ?? null, bars: s.bars, error: s.error ?? null, deletedOther: s.deletedOther ?? 0, keptExisting: s.keptExisting ?? 0 })),
    done: Object.values(j.symbols).filter((s) => s.status === 'done').length, total: Object.keys(j.symbols).length,
  } : null);

  const quarterEnd = (d) => {
    const y = +d.slice(0, 4), q = Math.floor((+d.slice(5, 7) - 1) / 3);
    return addDays(`${q === 3 ? y + 1 : y}-${String(q === 3 ? 1 : q * 3 + 4).padStart(2, '0')}-01`, -1);
  };

  async function runFetchJob() {
    if (fetching || closed) return;
    fetching = true;
    try {
      let job = store.getSetting(db, 'fetchJob');
      while (job && job.status === 'running' && !closed) {
        // Jobs saved before sources were recorded used the market-data provider.
        const src = job.source ? historySources().list.find((x) => x.id === job.source) : historySources().list.find((x) => x.kind === 'provider');
        if (!src) { job.status = 'paused'; job.error = job.source ? `The history source ${job.source} is no longer configured` : 'No market-data provider with 15-minute history is configured'; break; }
        const sym = Object.keys(job.symbols).find((s) => ['pending', 'running'].includes(job.symbols[s].status));
        if (!sym) { job.status = Object.values(job.symbols).some((s) => s.status === 'error') ? 'done_with_errors' : 'done'; break; }
        if (pauseCheck()) { await new Promise((r) => setTimeout(r, opts.pauseMs ?? 10000)); continue; }
        const st = job.symbols[sym];
        st.status = 'running';
        const cFrom = st.next, cTo = quarterEnd(cFrom) < job.to ? quarterEnd(cFrom) : job.to;
        const u = uSyms.get(sym);
        try {
          const inst = { symbol: sym, exchange: u.exchange, currency: 'USD', provider_symbol: null };
          let got, details;
          if (src.kind === 'alpaca') {
            const r = await src.impl.getHistory(inst, cFrom, cTo);
            got = r.bars;
            details = { rawBars: r.rawBars, pages: r.pages, dropped: r.dropped, session: r.session, timestamps: { utc: r.timestamps.utc, offset: r.timestamps.offset, unreadable: r.timestamps.unreadable }, request: r.request };
          } else {
            const raw = await src.impl.getIntradayRange(inst, cFrom, cTo, '15min');
            const norm = normalizeBars(raw.map((b) => ({ t: b.ts ?? b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })), { exchange: u.exchange, intervalMinutes: 15, inputIntervalMinutes: 15 });
            got = norm.bars;
            details = { rawBars: raw.length, dropped: norm.dropped };
          }
          const nowMs = clock().getTime();
          const n = got.filter((b) => Date.parse(b.t) + 15 * 60000 <= nowMs);
          // Re-download: the first chunk deletes this symbol's bars from other sources in the history window.
          const res = store.storeBarSet(db, sym, n, {
            source: src.id, adjustment: src.adjustment, feed: src.feed, guard: windowIso, replace: job.replace && !st.replacedOther ? windowIso : null,
            requestedFrom: cFrom, requestedTo: cTo, details, fetchedAt: clock().toISOString(),
          });
          if (job.replace) st.replacedOther = true;
          st.deletedOther = (st.deletedOther || 0) + res.deletedOther;
          st.keptExisting = (st.keptExisting || 0) + res.keptExisting;
          st.bars += n.length;
          st.fetchedThrough = cTo;
          st.next = addDays(cTo, 1);
          st.tries = 0;
          st.error = null;
          if (st.next > job.to) st.status = 'done';
        } catch (e) {
          st.status = 'pending';
          e.message = safe(e.message);
          if (e.kind === 'auth') { job.status = 'failed'; job.error = e.message; }
          else if (e.kind === 'mixed_source') { st.status = 'error'; st.error = e.message; }
          else if (e.kind === 'rate_limit') {
            job.status = 'paused'; job.error = e.message;
            const now = clock().getTime();
            job.resumeAfter = iso(/daily/i.test(e.message) ? Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1, 0, 5) : now + 60000);
          } else if (e.kind === 'not_found' || (st.tries = (st.tries || 0) + 1) >= 3) { st.status = 'error'; st.error = e.message; }
          else await new Promise((r) => setTimeout(r, (opts.retryMs ?? 5000) * st.tries)); // transient: back off, then retry
        }
        job.updatedAt = clock().toISOString();
        store.setSetting(db, 'fetchJob', job);
      }
      if (job && !closed) { job.updatedAt = clock().toISOString(); store.setSetting(db, 'fetchJob', job); }
    } finally {
      fetching = false;
    }
  }

  function resumeFetchIfDue(now) {
    const job = store.getSetting(db, 'fetchJob');
    if (!job || fetching) return;
    if (job.status === 'paused' && job.resumeAfter && now.toISOString() >= job.resumeAfter && market()) {
      store.setSetting(db, 'fetchJob', { ...job, status: 'running', error: null, resumeAfter: null });
    } else if (job.status !== 'running') return;
    runFetchJob().catch(() => {});
  }

  // ---------- forward ----------

  function forwardStatus(mode) {
    const f = store.getForward(db, mode);
    const p = market();
    let canRun = true, reason = null;
    if (demo) { canRun = false; reason = 'The demo workspace shows a synthetic forward replay; the live forward test runs only in your own workspace with a market-data provider.'; }
    else if (!p) { canRun = false; reason = `No market-data provider is configured (MARKET_DATA_PROVIDER=${ctx.cfg?.marketProvider || 'none'}), so the forward test cannot run on real data.`; }
    else if (!p.capabilities?.intradayBars) { canRun = false; reason = `${p.name} does not provide 15-minute bars here, so the forward test cannot run.`; }
    return {
      mode, enabled: f?.status === 'running', status: f?.status ?? 'off', runId: f?.runId ?? null, version: f?.version ?? null, configHash: f?.configHash ?? null,
      startedAt: f?.startedAt ?? null, stoppedAt: f?.stoppedAt ?? null, processedThrough: f?.processedThrough ?? null, lastError: f?.lastError ?? null,
      canRun, reason, maxSignalDelayMinutes: maxSignalDelayMin, synthetic: demo,
      note: `A signal is acted on only if its bar is processed within ${maxSignalDelayMin} minutes of the bar's close; otherwise it is journalled as expired. If your data plan delays intraday bars, signals will expire.`,
    };
  }

  // ---------- forward report (kept apart from historical runs) ----------

  // Counters and per-trade simulated costs of the current forward run, read
  // only from its stored journal and trades: no run means "not started" and
  // zeros; nothing is estimated or filled in.
  function forwardReport(mode) {
    const f = store.getForward(db, mode);
    const p = market();
    const histKeys = historyKeys();
    const feed = {
      warning: FORWARD_FEEDS.warning, adapter: FORWARD_FEEDS.adapter, options: FORWARD_FEEDS.options, lastSeen: FORWARD_FEEDS.lastSeen,
      forwardProvider: demo ? 'synthetic' : p ? (p.id || p.name) : null,
      historySources: histKeys.map((k) => ({ source: k.source, adjustment: k.adjustment ?? null, feed: k.feed ?? null, bars: k.bars })),
      consolidatedRealTime: false,
      mismatch: !demo && p && histKeys.some((k) => k.source !== (p.id || 'provider'))
        ? `The history in the window comes from ${[...new Set(histKeys.map((k) => k.source))].join(', ')} but forward bars would come from ${p.name || p.id}; volume and prices from different feeds are not comparable.` : null,
    };
    const base = {
      mode, kind: 'forward', separateFrom: 'historical runs (development, validation, stress, walk-forward, holdout): forward results are never added to them, and they are never added here',
      recordStatus: 'SIMULATED', feed,
    };
    const zeros = { signals: 0, ordersPlaced: 0, entriesFilled: 0, closedTrades: 0, openPositions: 0, rejectedSetups: 0, rejectedByReason: {}, setupsExpired: 0, setupsCancelled: 0, entrySkips: 0, skippedByReason: {}, missedSignals: { expired: 0, noNextBar: 0, total: 0 }, lateData: { lateBarTimes: 0, lateBarWarnings: 0, barsArrivedAfterProcessing: 0, missingBars: 0, timeExitsWhileAsleep: 0 }, operational: { providerErrors: 0, noProvider: 0, processingErrors: 0, duplicateTrades: 0, ruleChanged: 0 } };
    if (!f?.runId) {
      return { ...base, status: 'not started', runId: null, version: null, configHash: null, startedAt: null, processedThrough: null, synthetic: demo, counters: zeros, costs: { trades: [], totals: { commission: 0, spreadSlippage: 0, fx: 0, total: 0 } }, note: 'No forward test has run in this mode: there are no forward signals, no simulated fills and no forward trades.' };
    }
    const run = store.getRun(db, f.runId, { full: false });
    const rows = store.eventCounts(db, f.runId);
    const n = (type, code) => rows.filter((r) => r.type === type && (code === undefined || r.code === code)).reduce((a, r) => a + r.n, 0);
    const bars = (type, code) => rows.filter((r) => r.type === type && r.code === code).reduce((a, r) => a + (r.bars || 0), 0);
    const byCode = (type) => Object.fromEntries(rows.filter((r) => r.type === type).map((r) => [r.code || 'unspecified', r.n]));
    const trades = store.runTrades(db, f.runId);
    const closedIds = new Set(trades.map((t) => t.id));
    const costRow = (t) => {
      const commission = (t.entry?.commission || 0) + (t.exit?.commission || 0), spreadSlippage = (t.entry?.spreadSlippage || 0) + (t.exit?.spreadSlippage || 0), fx = (t.entry?.fx || 0) + (t.exit?.fx || 0);
      return { tradeId: t.id, symbol: t.symbol, status: 'SIMULATED', open: false, entryAt: t.entry?.at ?? null, exitAt: t.exit?.at ?? null, shares: t.entry?.shares ?? null, commission, spreadSlippage, fx, total: t.pnl?.costs ?? commission + spreadSlippage + fx, net: t.pnl?.net ?? null, r: t.pnl?.r ?? null, exitReason: t.exit?.reason ?? null };
    };
    const open = store.listEvents(db, { runId: f.runId, types: ['entry_filled'], limit: 5000, order: 'ASC' }).map((r) => store.eventFromRow(r))
      .filter((e) => !closedIds.has(e.details?.tradeId))
      .map((e) => ({ tradeId: e.details?.tradeId ?? null, symbol: e.symbol, status: 'SIMULATED', open: true, entryAt: e.at, exitAt: null, shares: e.details?.shares ?? null, commission: e.details?.commission || 0, spreadSlippage: e.details?.spreadSlippage || 0, fx: e.details?.fx || 0, total: (e.details?.commission || 0) + (e.details?.spreadSlippage || 0) + (e.details?.fx || 0), net: null, r: null, exitReason: null, note: 'entry costs only; the position is still open' }));
    const list = [...trades.map(costRow), ...open];
    const sum = (k) => list.reduce((a, x) => a + (x[k] || 0), 0);
    const expired = n('entry_skipped', 'expired'), noNext = n('entry_skipped', 'no_next_bar');
    return {
      ...base,
      status: f.status === 'replay' ? 'synthetic replay' : f.status, runId: f.runId, version: f.version, configHash: f.configHash, startedAt: f.startedAt, stoppedAt: f.stoppedAt ?? null,
      processedThrough: f.processedThrough ?? null, synthetic: !!run?.synthetic, maxSignalDelayMinutes: maxSignalDelayMin,
      counters: {
        signals: n('signal'), ordersPlaced: n('order_placed'), entriesFilled: n('entry_filled'), closedTrades: trades.length, openPositions: open.length,
        rejectedSetups: n('signal_rejected'), rejectedByReason: byCode('signal_rejected'), setupsExpired: n('setup_expired'), setupsCancelled: n('setup_invalidated'),
        entrySkips: n('entry_skipped'), skippedByReason: byCode('entry_skipped'),
        missedSignals: { expired, noNextBar: noNext, total: expired + noNext },
        lateData: { lateBarTimes: bars('data_warning', 'late_bars'), lateBarWarnings: n('data_warning', 'late_bars'), barsArrivedAfterProcessing: bars('data_warning', 'late_bar'), missingBars: n('data_warning', 'missing_bar'), timeExitsWhileAsleep: n('data_warning', 'time_exit_while_asleep') },
        operational: { providerErrors: n('operational_error', 'provider_error'), noProvider: n('operational_error', 'no_provider'), processingErrors: n('operational_error', 'processing_error'), duplicateTrades: n('operational_error', 'duplicate_trade'), ruleChanged: n('operational_error', 'rule_changed') },
      },
      costs: { trades: list.slice(-500), totals: { commission: sum('commission'), spreadSlippage: sum('spreadSlippage'), fx: sum('fx'), total: sum('total') }, note: 'Simulated costs from the strategy config\'s cost model (commission, half-spread and slippage, currency conversion), not broker fills.' },
      note: run?.synthetic ? 'Synthetic replay for the demo: nothing here is forward evidence.' : 'Forward results only; historical runs are reported separately.',
    };
  }

  // ---------- public API ----------

  const lab = {
    workspace, file,
    get db() { return db; },
    get busy() { return busy ? { ...busy } : null; },
    ready: Promise.resolve(),

    overview({ mode = 'intraday' } = {}) {
      checkMode(mode);
      const seed = demo ? store.getSetting(db, 'demoSeed') : null;
      const coverage = store.barCoverage(db).filter((c) => demo || !c.synthetic);
      const c = activeConfigEntry();
      const warnings = [];
      const status = demo ? (seed?.status === 'ready' ? 'ready' : seed?.status === 'failed' ? 'failed' : 'preparing') : coverage.length ? 'ready' : 'needs_data';
      if (demo && status === 'failed') warnings.push(`Preparing the synthetic demo failed: ${seed.error}`);
      let fa = null;
      try { fa = forwardAccount(db, mode); } catch (e) { warnings.push(`The simulated forward account could not be restored: ${e.message}`); }
      const start = c.config.risk.hypotheticalStartingEquity;
      const account = fa?.account || {
        simulated: true, currency: c.config.costs.accountCurrency, startingEquity: start, cash: start, equity: start, reservedCash: 0, openRisk: 0, positions: [], pendingOrders: [], lastProcessed: null,
        note: 'The forward test has not started; the simulated account is at its starting balance.',
      };
      const fwd = forwardStatus(mode);
      const decisions = fa ? store.listEvents(db, { runId: fa.forward.runId, limit: 20 }) : [];
      const params = fa ? boxParamsOfRun(fa.forward.runId) : null;
      const closedForward = fa ? store.listTrades(db, { runId: fa.forward.runId, limit: 10 }) : { total: 0, rows: [] };
      if (!demo && fwd.enabled && !fwd.canRun) warnings.push(fwd.reason);
      if (fwd.lastError) warnings.push(`Forward test: ${fwd.lastError}`);
      if (!demo && fwd.enabled && fwd.processedThrough) {
        const lag = (clock().getTime() - Date.parse(fwd.processedThrough)) / 60000;
        const sess = store.lastBarTime(db, universe.regimeProxy || 'SPY');
        if (lag > 60 && sess && Date.parse(sess) > Date.parse(fwd.processedThrough)) warnings.push(`The forward test is ${Math.round(lag)} minutes behind the stored data.`);
      }
      const job = publicJob(store.getSetting(db, 'fetchJob'));
      if (job?.status === 'paused' || job?.status === 'failed') warnings.push(`History download ${job.status}: ${job.error}`);
      const covBy = new Map(coverage.map((x) => [x.symbol, x]));
      const missing = universe.symbols.filter((s) => !covBy.has(s.symbol)).map((s) => s.symbol);
      if (!demo && coverage.length && missing.length) warnings.push(`No bars yet for ${missing.join(', ')}.`);
      let acc = null;
      try { acc = evaluate(mode); } catch (e) { warnings.push(`Acceptance could not be evaluated: ${e.message}`); }
      return wrap({
        status, mode,
        version: { strategy: c.strategy, version: c.version, label: c.label, configHash: c.configHash, file: c.file },
        settings: {
          maxSignalDelayMinutes: maxSignalDelayMin, marketProvider: demo ? 'synthetic' : ctx.cfg?.marketProvider || 'none',
          historySources: publicSources(), historySource: historySources().preferred?.id ?? null,
          webhook: { enabled: !demo && !!(ctx.cfg?.secrets?.LAB_WEBHOOK_SECRET && ctx.cfg?.lab?.webhookPort), port: demo ? null : ctx.cfg?.lab?.webhookPort ?? null },
          universe: universe.name, splits: splits.name, criteria: acceptance.name,
        },
        account, positions: account.positions, pendingOrders: account.pendingOrders, activeSetups: fa?.activeSetups || [],
        recentDecisions: decisions.map((r) => journalItem(store.eventFromRow(r, params))),
        recentTrades: closedForward.rows.map(tradeSummary), forwardTradeCount: closedForward.total,
        forward: fwd,
        forwardReport: forwardReport(mode),
        data: {
          symbols: universe.symbols.map((s) => ({ symbol: s.symbol, exchange: s.exchange, ...(covBy.get(s.symbol) ? { bars: covBy.get(s.symbol).bars, first: covBy.get(s.symbol).first, last: covBy.get(s.symbol).last, sources: covBy.get(s.symbol).sources, synthetic: covBy.get(s.symbol).synthetic } : { bars: 0, first: null, last: null, sources: [], synthetic: false }) })),
          required: { from: splits.warmup.from, to: splits.holdout.to }, lastBar: coverage.reduce((m, x) => (x.last > (m || '') ? x.last : m), null),
        },
        fetchJob: job,
        jobs: { running: busy ? { ...busy } : null },
        latestRuns: store.listRuns(db, { mode, limit: 10 }).map(runSummary),
        acceptance: acc ? { outcome: acc.evaluation.outcome, stages: acc.evaluation.stages, criteria: acc.evaluation.criteria, synthetic: acc.evaluation.synthetic, note: acc.note, basedOn: acc.basedOn } : null,
        demo: demo ? { status, seed: seed?.seed ?? demoOpts.seed, replay: seed?.replay ?? null, note: 'Synthetic prices generated for the demo. They demonstrate the interface and say nothing about the strategy.' } : null,
        needs: !demo && !coverage.length ? needsData() : null,
        warnings,
      });
    },

    bars({ symbol, from = null, to = null, mode = 'intraday', runId = null } = {}) {
      const sym = checkSymbol(symbol);
      checkMode(mode);
      for (const [k, v] of [['from', from], ['to', to]]) if (v != null && v !== '' && !DATE.test(v) && !Number.isFinite(Date.parse(v))) throw new LabError(400, `${k} must be YYYY-MM-DD or an ISO time`);
      const last = store.lastBarTime(db, sym);
      let toIso = to ? (DATE.test(to) ? dayEndIso(to) : iso(Date.parse(to))) : last;
      let fromIso = from ? (DATE.test(from) ? dayStartIso(from) : iso(Date.parse(from))) : null;
      if (!fromIso && toIso) fromIso = dayStartIso(addDays(etDate(toIso), -14));
      const rows = toIso ? store.getBars(db, sym, { from: fromIso, to: toIso, limit: MAX_CHART_BARS + 1, last: true }) : [];
      const truncated = rows.length > MAX_CHART_BARS;
      const list = truncated ? rows.slice(1) : rows;
      if (!demo && rows.synthetic) throw new LabError(500, 'Synthetic bars found in the real workspace');
      let run = null;
      if (runId != null) {
        run = store.getRun(db, Number(runId), { full: false });
        if (!run) throw new LabError(404, 'Run not found');
      } else if (list.length) {
        const a = etDate(list[0].t), b = etDate(list[list.length - 1].t);
        run = store.listRuns(db, { mode, status: null, limit: 200 })
          .filter((r) => ['backtest', 'holdout', 'forward'].includes(r.kind) && r.status !== 'failed' && (r.symbols || []).some((s) => (typeof s === 'string' ? s : s.symbol) === sym))
          .find((r) => (r.from || '') <= b && (!r.to || r.to >= a)) || null;
      }
      const boxes = [], markers = [];
      let trades = [];
      if (run && list.length) {
        const params = boxParamsOfRun(run.id);
        const evFrom = iso(Date.parse(list[0].t) - 3 * 86400000), evTo = list[list.length - 1].t;
        const evs = store.listEvents(db, { runId: run.id, symbol: sym, from: evFrom, to: evTo, types: ['setup_eligible', 'setup_expired', 'setup_invalidated', 'signal', 'signal_rejected', 'order_placed', 'entry_skipped'], limit: 20000, order: 'ASC' })
          .map((r) => store.eventFromRow(r, params));
        const ended = new Map();
        for (const e of evs) {
          const k = e.details?.box?.eligibleAt ?? e.details?.boxEligibleAt;
          if (k && e.type !== 'setup_eligible' && !ended.has(k)) ended.set(k, e);
        }
        for (const e of evs) {
          if (e.type === 'setup_eligible') {
            const b = e.details.box, end = ended.get(b.eligibleAt);
            boxes.push({
              eligibleAt: b.eligibleAt, windowStart: b.windowStart, windowEnd: b.windowEnd, resistance: b.resistance, support: b.support, height: b.height, atr: b.atr, heightAtr: b.heightAtr,
              touchesUpper: b.touchesUpper, touchesLower: b.touchesLower, upperTouchTimes: b.upperTouchTimes, lowerTouchTimes: b.lowerTouchTimes,
              outcome: !end ? 'open' : end.type === 'setup_expired' ? 'expired' : end.type === 'setup_invalidated' ? 'invalidated' : 'breakout',
              endedAt: end?.at ?? null, why: whySetupQualifies({ ...e, symbol: sym }).text,
            });
          } else if (e.type !== 'setup_expired' && e.type !== 'setup_invalidated') markers.push({ at: e.at, type: e.type, code: e.details?.code ?? null, reason: e.reason });
        }
        trades = store.listTrades(db, { runId: run.id, symbol: sym, limit: 5000 }).rows.map(tradeSummary)
          .filter((t) => (t.exitAt || t.entryAt) >= list[0].t && (t.entryAt || '') <= list[list.length - 1].t);
      }
      return wrap({
        symbol: sym, exchange: uSyms.get(sym).exchange, interval: '15min', from: list[0]?.t ?? fromIso, to: list[list.length - 1]?.t ?? toIso,
        bars: list, truncated, maxBars: MAX_CHART_BARS, synthetic: demo || !!rows.synthetic,
        run: run ? runSummary(run) : null, boxes, trades, markers,
        note: list.length ? null : 'No bars stored for this symbol and range.',
      });
    },

    listTrades({ source = null, runId = null, symbol = null, mode = null, limit = 100, offset = 0 } = {}) {
      if (source && !['forward', 'backtest'].includes(source)) throw new LabError(400, 'source must be forward or backtest');
      if (mode) checkMode(mode);
      const kinds = source === 'forward' ? ['forward'] : source === 'backtest' ? ['backtest', 'holdout', 'walk_forward'] : null;
      const r = store.listTrades(db, { runId: runId != null && runId !== '' ? Number(runId) : null, kinds, mode, symbol: symbol ? String(symbol).toUpperCase() : null, limit: checkLimit(limit), offset: Math.max(0, Number(offset) || 0) });
      return wrap({ total: r.total, trades: r.rows.map(tradeSummary) });
    },

    getTrade(id) {
      const row = store.getTrade(db, Number(id));
      if (!row) throw new LabError(404, 'Trade not found');
      const t = row.trade;
      const run = store.getRun(db, row.runId, { full: false });
      const params = boxParamsOfRun(row.runId);
      const events = store.listEvents(db, { runId: row.runId, symbol: t.symbol, from: t.box?.eligibleAt ?? t.signal?.at, to: t.exit?.at ?? t.entry?.at, limit: 200, order: 'ASC' })
        .map((r) => journalItem(store.eventFromRow(r, params)));
      return wrap({
        trade: { ...tradeSummary(row), record: t }, run: runSummary(run),
        explanation: { setup: whySetupQualifies(t), signal: whySignal(t), exit: whatEnded(t) },
        events, synthetic: run?.synthetic,
      });
    },

    listRuns({ kind = null, mode = null, split = null, limit = 50 } = {}) {
      if (mode) checkMode(mode);
      if (kind && !['backtest', 'stress', 'walk_forward', 'holdout', 'forward'].includes(kind)) throw new LabError(400, 'kind must be backtest, stress, walk_forward, holdout or forward');
      return wrap({ runs: store.listRuns(db, { kind, mode, split, limit: checkLimit(limit, 50, 200) }).map(runSummary) });
    },

    getRun(id) {
      const r = store.getRun(db, Number(id));
      if (!r) throw new LabError(404, 'Run not found');
      const { config, ...rest } = r;
      const out = { ...rest, headline: headline(r.metrics), groups: r.metrics?.groups ?? null, tradeCount: store.listTrades(db, { runId: r.id, limit: 1 }).total, configLabel: config?.label ?? null };
      if (r.kind === 'forward') {
        out.equity = dailyEquity(store.listEquity(db, r.id));
        const f = store.getForward(db, r.mode);
        if (f?.runId === r.id) out.forward = forwardStatus(r.mode);
      }
      return wrap({ run: out, synthetic: r.synthetic });
    },

    journal({ source = 'forward', type = null, symbol = null, runId = null, mode = 'intraday', limit = 100 } = {}) {
      if (!['forward', 'backtest', 'tradingview'].includes(source)) throw new LabError(400, 'source must be forward, backtest or tradingview');
      const n = checkLimit(limit);
      const sym = symbol ? String(symbol).trim().toUpperCase() : null;
      if (source === 'tradingview') {
        const items = store.listAlerts(db, { symbol: sym, limit: n }).filter((a) => !type || a.event === type || a.status === type)
          .map((a) => ({ id: `tv-${a.id}`, source: 'tradingview', at: a.barTime || a.receivedAt, receivedAt: a.receivedAt, symbol: a.symbol, type: a.event, status: a.status, reason: a.reason, details: a.payload, comparison: compareAlert(a) }));
        return wrap({ source, items, note: 'TradingView alerts are journalled and compared with Signal Desk\'s own signals; they never drive the simulated account.' });
      }
      checkMode(mode);
      let types = null;
      if (type) {
        types = JOURNAL_GROUPS[type] || (EVENT_TYPES.includes(type) ? [type] : null);
        if (!types) throw new LabError(400, `type must be one of ${[...Object.keys(JOURNAL_GROUPS), ...EVENT_TYPES].join(', ')}`);
      }
      let runIds;
      if (runId != null && runId !== '') runIds = [Number(runId)];
      else if (source === 'forward') runIds = store.listRuns(db, { kind: 'forward', mode, limit: 50 }).map((r) => r.id);
      else {
        const r = store.listRuns(db, { mode, status: 'done', limit: 50 }).find((x) => ['backtest', 'holdout'].includes(x.kind));
        runIds = r ? [r.id] : [];
      }
      if (!runIds.length) return wrap({ source, items: [], runIds });
      const cache = new Map();
      const items = store.listEvents(db, { runIds, source, types, symbol: sym, limit: n }).map((r) => journalItem(store.eventFromRow(r, boxParamsOfRun(r.run_id, cache))));
      return wrap({ source, runIds, items });
    },

    versions() {
      const list = configs();
      const act = list.filter((c) => c.valid).pop() || null;
      return wrap({
        active: act ? { version: act.version, configHash: act.configHash, file: act.file, label: act.label } : null,
        configs: list.map(({ config: _c, path: _p, ...c }) => ({ ...c, active: c.file === act?.file })),
        parameterLog: parameterLog(), labChanges: store.listParamChanges(db), holdoutRuns: store.listHoldoutRuns(db),
        note: 'Every rule or parameter change is a new version with its own config file, logged with its reason and the data seen when it was made.',
      });
    },

    diffVersions(a, b) {
      if (!a || !b) throw new LabError(400, 'Give two versions to compare (from and to)');
      const A = findConfig(a), B = findConfig(b);
      const changes = diffConfigs(A.config, B.config).map((d) => ({ ...d, descriptive: d.path.split('.').some((k) => DESCRIPTIVE_KEYS.includes(k)) }));
      const lo = semverKey(A.version) < semverKey(B.version) ? A.version : B.version, hi = lo === A.version ? B.version : A.version;
      const between = (v) => semverKey(v) > semverKey(lo) && semverKey(v) <= semverKey(hi);
      return wrap({
        from: { version: A.version, configHash: A.configHash, file: A.file }, to: { version: B.version, configHash: B.configHash, file: B.file },
        sameRules: A.configHash === B.configHash, changes,
        parameterLog: parameterLog().filter((l) => between(l.version)), labChanges: store.listParamChanges(db).filter((c) => between(c.toVersion)),
      });
    },

    // Starts a backtest; returns at once with the running run. done resolves to its id.
    startBacktest({ mode, split } = {}) {
      checkMode(mode);
      const sp = split === 'walk-forward' ? 'walk_forward' : split;
      if (sp === 'holdout') throw new LabError(400, 'The holdout runs only through the holdout action: once per version, with confirmation.');
      if (!SPLITS.includes(sp)) throw new LabError(400, `split must be ${SPLITS.join(', ')}`);
      ensureIdle();
      const range = sp === 'walk_forward' ? splits.walkForward.range : splitRange(splits, sp === 'stress' ? 'validation' : sp);
      if (!barsInRange(range.from, range.to)) throw new LabError(400, `No bars are stored for ${range.from} to ${range.to}. Import CSV files or download history first.`);
      const c = activeConfigEntry();
      claim('backtest', `${sp} (${mode})`);
      let runId;
      try {
        runId = store.createRun(db, {
          kind: KIND_OF[sp], mode, split: sp, version: c.version, configHash: c.configHash, config: c.config, from: range.from, to: range.to, synthetic: demo,
          status: 'running', label: `${demo ? `${SYNTHETIC_LABEL}: ` : ''}${sp.replace('_', '-')} ${range.from} to ${range.to}`, createdAt: clock().toISOString(),
        });
      } catch (e) { busy = null; throw e; }
      busy.runId = runId;
      const done = launch('backtest', runId, { mode, split: sp, configFile: c.path });
      return { run: runSummary(store.getRun(db, runId, { full: false })), done };
    },

    async runBacktest(args) {
      const { done } = lab.startBacktest(args);
      return lab.getRun(await done);
    },

    // The holdout: one clean run per version, config hash and mode; a repeat
    // needs a written reason and is marked contaminated (validation.runHoldout
    // with a ledger backed by lab_holdout_runs).
    startHoldout({ mode, reason = '', confirm = false } = {}) {
      checkMode(mode);
      if (confirm !== true) throw new LabError(400, 'The holdout is the one final evaluation of this version. Confirm (confirm: true) to use it now; a second run needs a written reason and is marked contaminated.');
      const why = String(reason ?? '').trim();
      if (why.length > 2000) throw new LabError(400, 'The reason is too long (2,000 characters at most)');
      ensureIdle();
      const c = activeConfigEntry();
      const prior = store.holdoutLedger(db).count(c.version, c.configHash, mode);
      if (prior > 0 && !why) {
        throw new LabError(409, `The holdout has already been run ${prior} time${prior > 1 ? 's' : ''} for version ${c.version} (config ${c.configHash.slice(0, 12)}) in ${mode} mode. Another run needs a written reason and its result will be marked contaminated: it cannot satisfy the acceptance criteria.`);
      }
      const range = splitRange(splits, 'holdout');
      if (!barsInRange(range.from, range.to)) throw new LabError(400, `No bars are stored for the holdout period (${range.from} to ${range.to}). Running it now would use up the clean holdout run on no data.`);
      claim('holdout', `holdout (${mode})`);
      let runId;
      try {
        runId = store.createRun(db, {
          kind: 'holdout', mode, split: 'holdout', version: c.version, configHash: c.configHash, config: c.config, from: range.from, to: range.to, synthetic: demo,
          contaminated: prior > 0, reason: why || null, status: 'running', createdAt: clock().toISOString(),
          label: `${demo ? `${SYNTHETIC_LABEL}: ` : ''}holdout ${range.from} to ${range.to}${prior > 0 ? ' (contaminated)' : ''}`,
        });
      } catch (e) { busy = null; throw e; }
      busy.runId = runId;
      const done = launch('holdout', runId, { mode, reason: why, at: clock().toISOString(), configFile: c.path });
      return { run: runSummary(store.getRun(db, runId, { full: false })), done, contaminated: prior > 0 };
    },

    async runHoldout(args) {
      const { done } = lab.startHoldout(args);
      return lab.getRun(await done);
    },

    importCsv({ symbol, exchange = null, text, format = null, replace = false } = {}) {
      if (demo) throw new LabError(400, 'The demo workspace holds synthetic data only. Switch to your workspace to import market data.');
      const sym = checkSymbol(symbol);
      if (typeof text !== 'string' || !text.trim()) throw new LabError(400, 'CSV text is missing');
      if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) throw new LabError(413, 'The CSV is larger than 20 MB; split it into smaller files');
      if (format != null && format !== '' && !['tradingview', 'generic', 'auto'].includes(format)) throw new LabError(400, 'format must be tradingview, generic or auto');
      const ex = uSyms.get(sym).exchange;
      if (exchange && String(exchange).toUpperCase() !== ex.toUpperCase()) throw new LabError(400, `${sym} is listed on ${ex} in ${universe.name}, not ${exchange}`);
      const head = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0].toLowerCase();
      const fmt = !format || format === 'auto' ? (/^"?time"?[,;\t]/.test(head) ? 'tradingview' : 'generic') : format;
      let parsed, norm;
      try {
        parsed = fmt === 'tradingview' ? parseTradingViewCsv(text) : parseGenericCsv(text);
        norm = normalizeBars(parsed.bars, { exchange: ex, intervalMinutes: 15 });
      } catch (e) { throw new LabError(400, e.message); }
      if (!norm.bars.length) throw new LabError(400, `No regular-session 15-minute bars were found (${parsed.bars.length} rows read, ${parsed.rejected.length} rejected)`);
      let res;
      try {
        res = store.storeBarSet(db, sym, norm.bars, {
          source: 'csv', adjustment: metaOf('csv').adjustment, feed: metaOf('csv').feed, guard: windowIso, replace: replace === true ? windowIso : null,
          requestedFrom: etDate(norm.bars[0].t), requestedTo: etDate(norm.bars[norm.bars.length - 1].t), details: { rawBars: parsed.bars.length, rejected: parsed.rejected.length, dropped: norm.dropped, format: parsed.format }, fetchedAt: clock().toISOString(),
        });
      } catch (e) {
        if (e instanceof store.MixedSourceError) throw new LabError(409, `${e.message} To replace them with this file, import again with replace.`);
        throw e;
      }
      const stored = { inserted: res.inserted, replaced: res.updated };
      const quality = qualityReport(norm.bars, { exchange: ex });
      const cov = store.barCoverage(db).find((x) => x.symbol === sym);
      const first = etDate(norm.bars[0].t), last = etDate(norm.bars[norm.bars.length - 1].t);
      const notes = [];
      if (first > splits.warmup.from) notes.push(`The file starts on ${first}; the pre-registered data start on ${splits.warmup.from}.`);
      if (last < splits.holdout.to) notes.push(`The file ends on ${last}; the holdout period runs to ${splits.holdout.to}.`);
      if (!quality.ok) notes.push('The quality report found gaps or problems; check missing sessions and bars before relying on results.');
      return wrap({
        symbol: sym, exchange: ex, format: parsed.format, inputIntervalMinutes: norm.inputIntervalMinutes,
        rows: { read: parsed.bars.length + parsed.rejected.length, parsed: parsed.bars.length, rejected: parsed.rejected.length, rejectedSample: parsed.rejected.slice(0, 10) },
        dropped: norm.dropped, stored, sourceCheck: { source: 'csv', adjustment: metaOf('csv').adjustment, feed: metaOf('csv').feed, keptExisting: res.keptExisting, deletedOther: res.deletedOther }, quality, dataHash: datasetHash(new Map([[sym, norm.bars]])),
        coverage: cov ? { bars: cov.bars, first: cov.first, last: cov.last } : null, notes,
      });
    },

    // source: 'alpaca' | the market provider's id | null (the preferred one).
    // replace: re-download, deleting the symbols' bars from other sources in
    // the history window; without it, mixing sources within a symbol is refused.
    fetchHistory({ symbols = null, from = null, to = null, source = null, replace = false } = {}) {
      if (demo) throw new LabError(400, 'The demo workspace holds synthetic data only. Switch to your workspace to download market data.');
      const p = market();
      const { list: sources, preferred } = historySources();
      if (!sources.length) {
        if (p) throw new LabError(400, `${p.name} cannot download 15-minute history here. Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env, or import CSV files instead.`);
        throw new LabError(400, `No history source is configured (MARKET_DATA_PROVIDER=${ctx.cfg?.marketProvider || 'none'}, no Alpaca keys). Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (preferred), or MARKET_DATA_PROVIDER=twelvedata and TWELVEDATA_API_KEY, in .env, or import CSV files.`);
      }
      if (source != null && typeof source !== 'string') throw new LabError(400, 'source must be text');
      const src = source ? sources.find((x) => x.id === source) : preferred;
      if (!src) throw new LabError(400, `The history source ${source} is not configured (configured: ${sources.map((x) => x.id).join(', ')})`);
      const list = symbols == null || (Array.isArray(symbols) && !symbols.length) ? [...uSyms.keys()] : (Array.isArray(symbols) ? symbols : String(symbols).split(',')).map(checkSymbol);
      const f = from || splits.warmup.from, t = to || todayIn(NY, clock());
      if (!DATE.test(f) || !DATE.test(t) || f > t) throw new LabError(400, 'from and to must be YYYY-MM-DD with from on or before to');
      if (f < '2000-01-01' || t > todayIn(NY, clock())) throw new LabError(400, 'The range must lie between 2000-01-01 and today');
      const cur = store.getSetting(db, 'fetchJob');
      if (cur && ['running', 'paused'].includes(cur.status) && fetching) throw new LabError(409, 'A history download is already running');
      const key = { source: src.id, adjustment: src.adjustment, feed: src.feed };
      const conflicts = list.map((s) => ({ symbol: s, other: store.barSourceKeys(db, s, windowIso).filter((k) => !sameKey(k, key)) })).filter((c) => c.other.length);
      if (conflicts.length && replace !== true) {
        throw new LabError(409, `Mixing sources within a symbol is refused: ${conflicts.map((c) => `${c.symbol} holds ${c.other.map((o) => `${o.bars} bars from ${store.sourceKeyText(o)}`).join(' and ')}`).join('; ')} in the history window (${splits.warmup.from} to ${splits.holdout.to}). Download from that source instead, or re-download (replace) to delete those bars first.`);
      }
      const now = clock().toISOString();
      const job = {
        id: Date.now(), status: 'running', provider: src.name, source: src.id, adjustment: src.adjustment, feed: src.feed, replace: replace === true,
        from: f, to: t, startedAt: now, updatedAt: now, error: null,
        symbols: Object.fromEntries(list.map((s) => [s, { status: 'pending', next: f, bars: 0, error: null, fetchedThrough: null }])),
      };
      store.setSetting(db, 'fetchJob', job);
      lab.fetchDone = runFetchJob().catch(() => {});
      return wrap({
        job: publicJob(job), source: { id: src.id, name: src.name, adjustment: src.adjustment, feed: src.feed, note: src.note },
        replacing: replace === true ? conflicts.map((c) => ({ symbol: c.symbol, bars: c.other.reduce((n, o) => n + o.bars, 0), sources: c.other.map((o) => store.sourceKeyText(o)) })) : [],
        note: `Downloading in the background through ${src.name} (adjustment ${src.adjustment}, feed ${src.feed}), one request per symbol per quarter, within the provider's rate limits. Progress is saved, so it resumes after a restart. Check the readiness checklist afterwards; nothing is shortened or replaced automatically.`,
      });
    },

    fetchStatus() { return wrap({ job: publicJob(store.getSetting(db, 'fetchJob')) }); },

    setForward({ mode, enabled } = {}) {
      checkMode(mode);
      if (typeof enabled !== 'boolean') throw new LabError(400, 'enabled must be true or false');
      if (demo) throw new LabError(400, forwardStatus(mode).reason);
      const f = store.getForward(db, mode);
      if (enabled) {
        const st = forwardStatus(mode);
        if (!st.canRun) throw new LabError(400, st.reason);
        if (f?.status === 'running') return wrap({ forward: st, note: 'The forward test is already running for this mode.' });
        const c = activeConfigEntry();
        startForward(db, { mode, config: c.config, symbols: universe.symbols.map((s) => ({ symbol: s.symbol, exchange: s.exchange, sector: s.sector, cluster: s.cluster })), now: clock(), maxSignalDelayMin });
        return wrap({ forward: forwardStatus(mode), note: `Forward test started with version ${c.version} (config ${c.configHash.slice(0, 12)}) frozen. Stopping it or changing the version starts a new forward count.` });
      }
      if (f?.status === 'running') stopForward(db, mode, clock());
      return wrap({ forward: forwardStatus(mode) });
    },

    forwardStatus(mode) { checkMode(mode); return wrap({ forward: forwardStatus(mode) }); },

    evaluation({ mode = 'intraday' } = {}) {
      checkMode(mode);
      return wrap({ ...evaluate(mode), forwardReport: forwardReport(mode) });
    },

    forwardReport({ mode = 'intraday' } = {}) {
      checkMode(mode);
      return wrap({ report: forwardReport(mode) });
    },

    // The data-readiness checklist (readiness.js), recomputed only when the
    // stored bars or the corporate-actions file change. Read-only.
    readiness() {
      let caText;
      try { caText = fs.readFileSync(caFile, 'utf8'); } catch (e) { throw new LabError(500, `The corporate-actions file could not be read: ${e.message}`); }
      const key = `${store.barsFingerprint(db)}|${caText}`;
      if (!readinessCache || readinessCache.key !== key) {
        readinessCache = { key, value: buildReadiness({ db, universe, splits, corporateActions: loadCorporateActions(caFile), now: clock(), synthetic: demo }) };
      }
      return wrap({ ...readinessCache.value, historySources: publicSources() });
    },

    // Scheduler hook: forward ticks for running modes and a paused history
    // download that is due to resume. Never throws; never awaited by briefings.
    async tick({ now = clock(), shouldPause = () => false } = {}) {
      if (closed || ticking) return { skipped: true };
      ticking = true;
      pauseCheck = shouldPause;
      try {
        await new Promise((r) => setImmediate(r)); // let the scheduler's own work start first
        if (closed) return { skipped: true };
        resumeFetchIfDue(now);
        const out = [];
        for (const f of store.forwardRows(db)) {
          if (f.status !== 'running') continue;
          if (!memos.has(f.mode)) memos.set(f.mode, new Map());
          try {
            out.push(await forwardTick({ db, mode: f.mode, provider: market(), now, clock, maxSignalDelayMin, shouldPause, memo: memos.get(f.mode), configFor: (v) => configs().find((c) => c.version === v)?.config ?? null }));
          } catch (e) { out.push({ mode: f.mode, error: e.message }); }
        }
        return { forward: out };
      } finally { ticking = false; }
    },

    close() {
      closed = true;
      for (const w of workers) w.terminate();
      try { db.close(); } catch { /* already closed */ }
    },
  };

  store.failInterruptedRuns(db);
  syncVersions();
  if (demo) {
    const seed = store.getSetting(db, 'demoSeed');
    if (seed?.status !== 'ready') {
      busy = { kind: 'demo', label: 'preparing the synthetic demo', runId: null, startedAt: clock().toISOString() };
      lab.ready = runJob('demoSeed', { file, configFile: activeConfigEntry().path, ...demoOpts, maxSignalDelayMin })
        .then(() => {
          if (closed) return;
          store.invalidateCoverage(db);
          for (const r of store.listRuns(db, { status: 'done', limit: 50 })) refreshAcceptance(r.id);
        }, () => {})
        .finally(() => { busy = null; });
    }
  } else {
    const job = store.getSetting(db, 'fetchJob');
    if (job?.status === 'running') lab.fetchDone = runFetchJob().catch(() => {});
  }
  return lab;
}

// Lazy per-context handle: the Lab database is opened on first use.
export function attachLab(ctx, opts = {}) {
  let lab = null;
  Object.defineProperty(ctx, 'lab', { configurable: true, enumerable: false, get: () => (lab ||= createLab(ctx, opts)) });
  Object.defineProperty(ctx, 'labIfOpen', { configurable: true, enumerable: false, get: () => lab });
  return ctx;
}

if (!isMainThread && workerData?.labJob) {
  const { kind, args } = workerData.labJob;
  JOBS[kind](args).then(
    (result) => parentPort.postMessage({ ok: true, result }),
    (e) => parentPort.postMessage({ ok: false, error: e?.message || String(e), refused: e instanceof HoldoutRefused }),
  );
}
