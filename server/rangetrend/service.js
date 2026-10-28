// Range-trend practice runs (PLAN-DRAFT.md sections 6-8). Simulation only.
// Market data is read at run time, read-only, through HXR's data layer from
// data/hxr-sim.sqlite; results go to data/range-trend-sim.sqlite only.
//
// The gate (every condition must hold, or nothing is recorded):
// - EVALUATION-PROTOCOL.md has the pick rule and the date-choice rule (dedicated fields), and its hash is
//   the one stored at the first practice run (a change needs a logged new protocol version);
// - EXPERIMENT-LOG.md has the owner-decisions entry (D1-D8), and every practice run it lists is in this
//   database (a fresh or different database cannot reset the budget);
// - the config is one of the eight planned files, matches its pinned SHA-256 and HXR's development period;
// - each planned config runs once; the one reserve re-runs a run of the same config hash invalidated by a
//   verified defect, keeping the broken result;
// - the HXR data file is inside the data directory, and HXR's readiness (with the owner's reviewed
//   overnight moves) and spread calibration pass for the development period.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalJson } from '../strategy/config.js';
import { loadConfig, configHash, PLANNED_CONFIGS, CODE_REVISION, protocolStatus, logStatus, PROTOCOL_PATH, LOG_PATH } from './config.js';
import { runBacktest, ENGINE_VERSION } from './engine.js';
import { computeMetrics } from './metrics.js';
import { holdIndex, INDEX_METHOD } from './benchmark.js';
import * as store from './store.js';
import * as hxrStore from '../hxr/store.js';
import { loadHxrUniverse, loadHxrPeriods, basketSymbols, excludedDates, halfSpreadFor, loadHxrConfig } from '../hxr/config.js';
import { buildInputs, buildSpreadTable, halfSpreadFn, readiness } from '../hxr/data.js';
import { runBacktest as runHxr, ENGINE_VERSION as HXR_ENGINE_VERSION } from '../hxr/engine.js';

export class RtError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const RESERVE_FIELDS = ['invalidatedRunId', 'defect', 'verification', 'correction'];
const symbolsHashOf = (symbols) => crypto.createHash('sha256').update(canonicalJson(symbols.map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi })))).digest('hex');

// A planned config's period must be HXR's development period exactly (the data the plan was written after).
export function periodProblem(config, dev) {
  const p = config.period, want = { basket: dev.basket, warmupFrom: dev.warmupFrom, start: dev.start, end: dev.end };
  const diff = Object.keys(want).filter((k) => p[k] !== want[k]);
  return diff.length ? `the config's period (${diff.map((k) => `${k} ${p[k]}`).join(', ')}) is not HXR's development period (${diff.map((k) => `${k} ${want[k]}`).join(', ')})` : null;
}

export function createRangeTrend({
  dataDir, hxrDbFile = null, protocolPath = PROTOCOL_PATH, logPath = LOG_PATH, clock = () => new Date(),
  allowExternalHxrDb = false, holdConfigFile = 'hxr-hold-0.1.0.json',
} = {}) {
  if (!dataDir) throw new Error('createRangeTrend needs dataDir');
  const db = store.openRtDb(store.rtDbFile(dataDir));
  store.failInterruptedRuns(db, clock().toISOString());
  const hxrFile = path.resolve(hxrDbFile || path.join(dataDir, hxrStore.HXR_DB_NAME));
  if (!allowExternalHxrDb && path.dirname(hxrFile) !== path.resolve(dataDir)) {
    db.close();
    throw new Error('Range-trend reads HXR market data only from the data directory (data/hxr-sim.sqlite)');
  }
  let busy = false;

  function gate({ configFile, confirm, reserve }) {
    if (confirm !== true) throw new RtError(400, 'A practice run needs confirm: true.');
    const proto = protocolStatus(protocolPath);
    if (!proto.ready) throw new RtError(409, `Practice runs are refused: ${proto.reason}. The owner writes them in EVALUATION-PROTOCOL.md before the first practice run.`);
    const firstHash = store.getSetting(db, 'protocolHash');
    if (firstHash && firstHash.hash !== proto.hash) throw new RtError(409, `Practice runs are refused: EVALUATION-PROTOCOL.md changed since the first practice run (stored hash ${firstHash.hash.slice(0, 12)}, now ${proto.hash.slice(0, 12)}). A change needs a logged new protocol version on the owner's instruction.`);
    const log = logStatus(logPath);
    if (!log.ownerDecisions) throw new RtError(409, `Practice runs are refused: strategy/range-trend/EXPERIMENT-LOG.md has no owner-decisions entry covering D1-D8 for this code (${log.ownerDecisionsProblem}; a row beginning "**Owner decisions D1-D8**" naming D1 to D8 and the code revision).`);
    for (const pr of log.practiceRuns) {
      const run = pr.runId == null ? null : store.getRun(db, pr.runId);
      if (!run || run.config_hash !== pr.configHash) throw new RtError(409, `Practice runs are refused: EXPERIMENT-LOG.md lists practice run ${pr.runId} (config hash ${String(pr.configHash).slice(0, 12)}) that this database does not contain. A fresh or different database cannot reset the budget.`);
    }
    if (!PLANNED_CONFIGS.includes(configFile)) throw new RtError(400, `Only the planned configs can run (${PLANNED_CONFIGS.join(', ')}).`);
    let config;
    try { config = loadConfig(configFile); } catch (e) { throw new RtError(409, `Practice runs are refused: ${e.message}`); }
    const dev = loadHxrPeriods().periods.development;
    const pp = periodProblem(config, dev);
    if (pp) throw new RtError(409, `Practice runs are refused: ${pp}.`);
    const ledger = store.listLedger(db);
    const prior = ledger.filter((e) => e.config_file === configFile);
    if (prior.length && !reserve) throw new RtError(409, `${configFile} has already run (run ${prior.at(-1).run_id}). A re-run is possible only as the one reserve, for a verified defect.`);
    if (reserve) {
      if (ledger.some((e) => e.reserve)) throw new RtError(409, 'The one reserve run has already been used.');
      for (const f of RESERVE_FIELDS) if (!reserve[f] || (typeof reserve[f] === 'string' && !reserve[f].trim())) throw new RtError(400, `A reserve run needs ${RESERVE_FIELDS.join(', ')} (the defect, how it was verified and the correction).`);
      const old = prior.find((e) => e.run_id === reserve.invalidatedRunId);
      if (!old) throw new RtError(409, `Run ${reserve.invalidatedRunId} is not a recorded run of ${configFile}.`);
      if (old.config_hash !== configHash(config)) throw new RtError(409, `The reserve run must use the config hash of the run it replaces (${old.config_hash.slice(0, 12)}); this config hashes to ${configHash(config).slice(0, 12)}.`);
    }
    return { proto, config };
  }

  // HXR's own gate for a period: readiness with the owner's reviewed overnight moves, and spread calibration
  // (a usable opening-quote sample) for every member.
  function hxrDataProblem(hdb, universe, periods, floorBps) {
    const ready = readiness(hdb, { universe, periods, reviewed: hxrStore.getSetting(hdb, 'reviewedMoves', []) });
    const p = ready.periods.development;
    if (!p?.usable) return `The HXR development period is not ready: ${(p?.reasons || []).slice(0, 5).join('; ')}`;
    const spread = buildSpreadTable(hdb, universe, { floorBps, toYear: Number(p.end.slice(0, 4)) });
    const unc = p.members.filter((m) => spread.firstSampled[m.symbol] == null).map((m) => m.symbol);
    if (!p.costsCalibrated || unc.length) return `The HXR development period has no spread calibration for ${unc.join(', ') || 'every stock'}`;
    return null;
  }

  async function runPractice({ configFile, confirm, reserve = null } = {}) {
    if (busy) throw new RtError(409, 'Another practice run is in progress.');
    busy = true;
    let hdb = null, id = null;
    const prov = {};
    try {
      const { proto, config } = gate({ configFile, confirm, reserve });
      if (!fs.existsSync(hxrFile)) throw new RtError(409, `No HXR market data at ${path.basename(hxrFile)}: download it through the HXR page first.`);
      hdb = hxrStore.openHxrDb(hxrFile, { readOnly: true });
      const universe = loadHxrUniverse(), periods = loadHxrPeriods();
      const problem = hxrDataProblem(hdb, universe, periods, config.costs.halfSpreadFloorBps);
      if (problem) throw new RtError(409, `${problem}. Nothing was run.`);
      // Everything checked: take the ledger slot and the run row in one transaction, before running.
      const at = clock().toISOString();
      try {
        id = store.reserveSlot(db, { configFile, version: config.version, configHash: configHash(config), config, reserve, protocolHash: proto.hash, codeRevision: CODE_REVISION, at });
      } catch (e) {
        if (/UNIQUE/i.test(e.message)) throw new RtError(409, `${configFile} (or the reserve) is already recorded: each planned config runs once.`);
        throw e;
      }
      if (!store.getSetting(db, 'protocolHash')) store.setSettingOnce(db, 'protocolHash', { hash: proto.hash, firstRunId: id }, at);
      const pr = config.period;
      const symbols = basketSymbols(universe, pr.basket);
      const spread = buildSpreadTable(hdb, universe, { floorBps: config.costs.halfSpreadFloorBps, toYear: Number(pr.end.slice(0, 4)) });
      const calibrated = halfSpreadFn(spread);
      const inputs = buildInputs(hdb, { universe, symbols: symbols.map((s) => s.symbol), warmupFrom: pr.warmupFrom, end: pr.end, excludedSessions: excludedDates(periods), spreadTable: spread, start: pr.start });
      Object.assign(prov, { symbolsHash: symbolsHashOf(inputs.symbols), dataHash: inputs.dataHash, calibrationHash: inputs.calibrationHash });
      const result = runBacktest({ config, symbols: inputs.symbols, sessions: inputs.sessions, days: inputs.days, halfSpreadBps: halfSpreadFor(config, calibrated), dataHash: inputs.dataHash });
      const details = {
        codeRevision: CODE_REVISION, engineVersion: ENGINE_VERSION, symbolsHash: result.meta.symbolsHash, meta: result.meta, protocolHash: proto.hash,
        trades: result.trades, postExit: result.postExit, openPositions: result.openPositions, fills: result.fills, decisions: result.decisions, skips: result.skips,
        warnings: result.warnings, dividends: result.dividends, splits: result.splits, watches: result.watches,
      };
      // Benchmark (a), the index (D4), HXR's hold arm beside it, and the metrics: a failure is recorded as such,
      // and the strategy result is kept.
      let hold = null, index = null, metrics = null, errors = [];
      try {
        index = holdIndex({ symbols: inputs.symbols, sessions: inputs.sessions, days: inputs.days, start: pr.start, startingCash: config.portfolio.startingCash, withholdingPct: config.dividends.withholdingPct });
        details.indexMethod = INDEX_METHOD;
      } catch (e) { errors.push(`benchmark (a) failed: ${e.message}`); details.benchmarkError = e.message; }
      try {
        const holdCfg = loadHxrConfig(holdConfigFile);
        hold = runHxr({ config: holdCfg, symbols: inputs.symbols, period: { warmupFrom: pr.warmupFrom, start: pr.start, end: pr.end }, inputs: { ...inputs, halfSpreadBps: halfSpreadFor(holdCfg, calibrated) }, excludedSessions: excludedDates(periods) });
        Object.assign(details, { benchmarkEngineVersion: HXR_ENGINE_VERSION, holdConfigHash: hold.meta?.configHash ?? null, holdConfigFile });
      } catch (e) { errors.push(`HXR hold arm failed: ${e.message}`); details.hxrHoldArmError = e.message; }
      try { metrics = computeMetrics(result, { hold, index }); } catch (e) { errors.push(`metrics failed: ${e.message}`); details.metricsError = e.message; }
      store.insertEquity(db, id, result.equity);
      store.finishRun(db, id, { status: 'done', ...prov, metrics, details, error: errors.length ? errors.join('; ') : null, at: clock().toISOString() });
      return { id, status: 'done', configFile, version: config.version, metrics, errors, simulated: true, note: 'Exploratory practice run on development data (2017-10-02 to 2021-12-31). Reported only: no threshold is enforced and no winner is selected.' };
    } catch (e) {
      if (id == null) throw e; // refused before the slot was taken: nothing recorded
      const msg = String(e.message || e);
      // The slot stays used: every run is logged, failures included.
      try { store.finishRun(db, id, { status: 'failed', ...prov, error: msg, at: clock().toISOString() }); } catch { /* the next start marks it failed */ }
      if (e instanceof RtError) throw e;
      throw new RtError(500, `The practice run failed and is recorded as failed (run ${id}): ${msg}`);
    } finally {
      busy = false;
      try { hdb?.close(); } catch { /* ignore */ }
    }
  }

  return {
    db,
    protocol: () => protocolStatus(protocolPath),
    log: () => logStatus(logPath),
    runPractice,
    ledger: () => store.listLedger(db),
    runs: () => store.listRuns(db),
    getRun: (id) => store.getRun(db, id),
    close: () => db.close(),
  };
}
