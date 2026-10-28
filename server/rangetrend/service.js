// Range-trend practice runs (PLAN-DRAFT.md v0.5 sections 6-8). Simulation only.
// Market data is read at run time, read-only, through HXR's data layer from
// data/hxr-sim.sqlite; results go to data/range-trend-sim.sqlite only.
//
// The gate (every condition must hold, or nothing is recorded):
// - EVALUATION-PROTOCOL.md has the pick rule and the date-choice rule in its dedicated fields (read outside
//   code fences and HTML comments, each once), no owner marker ("[OWNER") anywhere, and its hash is the one
//   stored at the first practice run, which is final for the practice runs (no new version reopens them);
// - EXPERIMENT-LOG.md has the owner-decisions entry (D1-D8, naming this code revision); every row of it that
//   mentions a practice run parses; every practice run it lists is in this database; and every run in this
//   database, failed ones included, is listed in it (a fresh or different database cannot reset the budget,
//   and no run goes unlogged: runPractice returns the exact row to paste);
// - the config is one of the eight planned files, matches its pinned SHA-256 and HXR's development period;
// - each planned config runs once; the one reserve re-runs a run of the same config hash invalidated by a
//   verified defect (defect, verification and correction as non-empty text), keeping the broken result;
// - the HXR data file is exactly <dataDir>/hxr-sim.sqlite by real path, opened read-only, and HXR's readiness
//   (with the owner's reviewed overnight moves) and spread calibration pass for the development period.
// The symbols, data and calibration hashes are computed before the ledger slot is taken, so every run row
// carries them; the slot, the run row and (at the first run) the protocol hash are one transaction.
// One live service instance per data directory (a lock file): a second instance refuses to open while one is
// alive, so a live run is never marked failed. The data directory comes from loadConfig().dataDir; tests may
// change it, the protocol, the log or the hold config only with testOverrides: true, recorded in every run.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig as loadAppConfig } from '../config.js';
import { canonicalJson } from '../strategy/config.js';
import { loadConfig, configHash, textSha256, PLANNED_CONFIGS, CODE_REVISION, protocolStatus, logStatus, namesRevision, PROTOCOL_PATH, LOG_PATH, RT_CONFIG_DIR } from './config.js';
import { runBacktest, ENGINE_VERSION } from './engine.js';
import { computeMetrics } from './metrics.js';
import { holdIndex, INDEX_METHOD } from './benchmark.js';
import * as store from './store.js';
import * as hxrStore from '../hxr/store.js';
import { loadHxrUniverse, loadHxrPeriods, basketSymbols, excludedDates, halfSpreadFor, loadHxrConfig } from '../hxr/config.js';
import { buildInputs, buildSpreadTable, halfSpreadFn, readiness } from '../hxr/data.js';
import { runBacktest as runHxr, ENGINE_VERSION as HXR_ENGINE_VERSION } from '../hxr/engine.js';

export class RtError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

export const RESERVE_FIELDS = ['defect', 'verification', 'correction'];
export const DEFAULT_HOLD_CONFIG = 'hxr-hold-0.1.0.json';
const symbolsHashOf = (symbols) => crypto.createHash('sha256').update(canonicalJson(symbols.map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi })))).digest('hex');
const oneLine = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s*[\r\n]+\s*/g, ' ').trim();

// A planned config's period must be HXR's development period exactly (the data the plan was written after).
export function periodProblem(config, dev) {
  const p = config.period, want = { basket: dev.basket, warmupFrom: dev.warmupFrom, start: dev.start, end: dev.end };
  const diff = Object.keys(want).filter((k) => p[k] !== want[k]);
  return diff.length ? `the config's period (${diff.map((k) => `${k} ${p[k]}`).join(', ')}) is not HXR's development period (${diff.map((k) => `${k} ${want[k]}`).join(', ')})` : null;
}

// The exact EXPERIMENT-LOG.md row for a stored run (one line, no "|" inside a cell), in the form logStatus reads
// (config.js PRACTICE_ROW). Every run, failed ones included, is pasted before the next run starts.
export function practiceLogRow(run, number, date) {
  const reserve = run.reserve ? `; reserve run replacing run ${run.reserve.invalidatedRunId} (defect: ${oneLine(run.reserve.defect)}; verified: ${oneLine(run.reserve.verification)}; correction: ${oneLine(run.reserve.correction)})` : '';
  const what = `**Practice run** run id: ${run.id}, config hash: ${run.config_hash}; ${run.config_file} (${run.version}); code revision ${run.code_revision}; status ${run.status}${run.error ? ` (${oneLine(run.error)})` : ''}${reserve}; symbols hash ${run.symbols_hash}; data hash ${run.data_hash}; calibration hash ${run.calibration_hash}; protocol hash ${run.protocol_hash}`;
  return `| ${number} | ${date} | ${what} | HXR development period 2017-10-02 to 2021-12-31 (data/hxr-sim.sqlite, read-only) | Yes: exploratory, development only |`;
}

export function createRangeTrend({ dataDir = null, protocolPath = null, logPath = null, holdConfigFile = null, clock = () => new Date(), testOverrides = false } = {}) {
  const overrides = Object.entries({ dataDir, protocolPath, logPath, holdConfigFile }).filter(([, v]) => v != null).map(([k]) => k);
  if (overrides.length && testOverrides !== true) throw new Error(`createRangeTrend: ${overrides.join(', ')} can be changed only with testOverrides: true (tests); the data directory comes from loadConfig().dataDir`);
  const dir = path.resolve(dataDir ?? loadAppConfig().dataDir);
  const proto = protocolPath ?? PROTOCOL_PATH, logFile = logPath ?? LOG_PATH, holdFile = holdConfigFile ?? DEFAULT_HOLD_CONFIG;
  const hxrFile = path.join(dir, hxrStore.HXR_DB_NAME);
  const db = store.openRtDb(store.rtDbFile(dir));
  let lock;
  try {
    // The lock row is taken in one transaction (store.js acquireLock): a live holder refuses this instance, a
    // stale row is taken over atomically. Only the lock holder marks interrupted runs failed.
    lock = store.acquireLock(db, { pid: process.pid, at: clock().toISOString() });
    store.failInterruptedRuns(db, clock().toISOString());
  } catch (e) {
    try { db.close(); } catch { /* ignore */ }
    if (e.code === 'RT_LOCKED') throw new RtError(423, e.message);
    throw e;
  }
  let busy = false, closed = false;

  const rowFor = (run, log = logStatus(logFile)) => practiceLogRow(run, log.nextNumber, (run.finished_at || run.created_at || clock().toISOString()).slice(0, 10));

  function gate({ configFile, confirm, reserve }) {
    if (confirm !== true) throw new RtError(400, 'A practice run needs confirm: true.');
    const ps = protocolStatus(proto);
    if (!ps.ready) throw new RtError(409, `Practice runs are refused: ${ps.reason}. The owner writes the two fields in EVALUATION-PROTOCOL.md before the first practice run.`);
    const frozen = store.getSetting(db, 'protocolHash');
    if (frozen && frozen.hash !== ps.hash) throw new RtError(409, `Practice runs are refused: EVALUATION-PROTOCOL.md changed since the first practice run (frozen hash ${frozen.hash.slice(0, 12)}, now ${ps.hash.slice(0, 12)}). The protocol frozen at the first practice run is final for the practice runs: restore the file to the frozen text. No new protocol version reopens them.`);
    const log = logStatus(logFile);
    // All practice runs share the first run's code revision unless an owner-decisions row names the new one.
    const firstRev = store.getSetting(db, 'codeRevision');
    if (firstRev && firstRev.revision !== CODE_REVISION && !(log.ownerRows || []).some((row) => namesRevision(row, CODE_REVISION))) {
      throw new RtError(409, `Practice runs are refused: the code revision changed since the first practice run (run ${firstRev.firstRunId} ran under ${firstRev.revision}; this code is ${CODE_REVISION}). A run under another revision needs an owner-decisions row in EXPERIMENT-LOG.md naming ${CODE_REVISION}.`);
    }
    if (!log.ownerDecisions) throw new RtError(409, `Practice runs are refused: strategy/range-trend/EXPERIMENT-LOG.md has no owner-decisions entry covering D1-D8 for this code (${log.ownerDecisionsProblem}; a row beginning "**Owner decisions D1-D8**" naming D1 to D8 and the code revision).`);
    if (log.malformed.length) throw new RtError(409, `Practice runs are refused: EXPERIMENT-LOG.md row ${log.malformed[0].number ?? '?'} ("${log.malformed[0].title}") mentions a practice run but is not in the form "**Practice run** run id: N, config hash: <64 hex>". Nothing runs while a practice-run row cannot be read.`);
    for (const pr of log.practiceRuns) {
      const run = store.getRun(db, pr.runId);
      if (!run || run.config_hash !== pr.configHash) throw new RtError(409, `Practice runs are refused: EXPERIMENT-LOG.md lists practice run ${pr.runId} (config hash ${pr.configHash.slice(0, 12)}) that this database does not contain. A fresh or different database cannot reset the budget.`);
    }
    for (const run of store.listRuns(db)) {
      if (!log.practiceRuns.some((p) => p.runId === run.id && p.configHash === run.config_hash)) {
        throw new RtError(409, `Practice runs are refused: run ${run.id} (${run.config_file}, ${run.status}) is not listed in EXPERIMENT-LOG.md. Paste its row first; every run, failed ones included, is logged before the next starts.`, { logRow: rowFor(store.getRun(db, run.id), log) });
      }
    }
    if (!PLANNED_CONFIGS.includes(configFile)) throw new RtError(400, `Only the planned configs can run (${PLANNED_CONFIGS.join(', ')}).`);
    let config;
    try { config = loadConfig(configFile); } catch (e) { throw new RtError(409, `Practice runs are refused: ${e.message}`); }
    const configFileSha256 = textSha256(fs.readFileSync(path.join(RT_CONFIG_DIR, configFile), 'utf8'));
    const dev = loadHxrPeriods().periods.development;
    const pp = periodProblem(config, dev);
    if (pp) throw new RtError(409, `Practice runs are refused: ${pp}.`);
    const ledger = store.listLedger(db);
    const prior = ledger.filter((e) => e.config_file === configFile);
    if (prior.length && !reserve) throw new RtError(409, `${configFile} has already run (run ${prior.at(-1).run_id}). A re-run is possible only as the one reserve, for a verified defect.`);
    if (reserve) {
      if (ledger.some((e) => e.reserve)) throw new RtError(409, 'The one reserve run has already been used.');
      if (typeof reserve !== 'object' || !Number.isInteger(reserve.invalidatedRunId) || reserve.invalidatedRunId < 1) throw new RtError(400, 'A reserve run needs invalidatedRunId, the id of the run it replaces.');
      for (const f of RESERVE_FIELDS) if (typeof reserve[f] !== 'string' || !reserve[f].trim()) throw new RtError(400, `A reserve run needs ${RESERVE_FIELDS.join(', ')} as non-empty text (the defect, how it was verified and the correction).`);
      const old = prior.find((e) => e.run_id === reserve.invalidatedRunId);
      if (!old) throw new RtError(409, `Run ${reserve.invalidatedRunId} is not a recorded run of ${configFile}.`);
      if (old.config_hash !== configHash(config)) throw new RtError(409, `The reserve run must use the config hash of the run it replaces (${old.config_hash.slice(0, 12)}); this config hashes to ${configHash(config).slice(0, 12)}.`);
    }
    return { proto: ps, config, configFileSha256, firstRunCodeRevision: firstRev?.revision ?? null };
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
    if (closed) throw new RtError(409, 'This range-trend service is closed.');
    if (busy) throw new RtError(409, 'Another practice run is in progress.');
    busy = true;
    let hdb = null, id = null, prov = null;
    try {
      const { proto: ps, config, configFileSha256, firstRunCodeRevision } = gate({ configFile, confirm, reserve });
      // The HXR market data: exactly <dataDir>/hxr-sim.sqlite by real path, opened read-only.
      if (!fs.existsSync(hxrFile)) throw new RtError(409, `No HXR market data at ${path.basename(hxrFile)}: download it through the HXR page first.`);
      const realHxr = fs.realpathSync(hxrFile);
      if (realHxr !== path.join(fs.realpathSync(dir), hxrStore.HXR_DB_NAME)) throw new RtError(409, `${path.basename(hxrFile)} must be the file itself in the data directory, not a link to ${realHxr}.`);
      hdb = hxrStore.openHxrDb(realHxr, { readOnly: true });
      const universe = loadHxrUniverse(), periods = loadHxrPeriods();
      const problem = hxrDataProblem(hdb, universe, periods, config.costs.halfSpreadFloorBps);
      if (problem) throw new RtError(409, `${problem}. Nothing was run.`);
      const pr = config.period;
      const symbols = basketSymbols(universe, pr.basket);
      const spread = buildSpreadTable(hdb, universe, { floorBps: config.costs.halfSpreadFloorBps, toYear: Number(pr.end.slice(0, 4)) });
      const calibrated = halfSpreadFn(spread);
      const inputs = buildInputs(hdb, { universe, symbols: symbols.map((s) => s.symbol), warmupFrom: pr.warmupFrom, end: pr.end, excludedSessions: excludedDates(periods), spreadTable: spread, start: pr.start });
      prov = { symbolsHash: symbolsHashOf(inputs.symbols), dataHash: inputs.dataHash, calibrationHash: inputs.calibrationHash };
      // Everything checked and every hash known: the ledger slot, the run row with the hashes and the provenance
      // known before running (so an interrupted or failed run keeps them), and (at the first practice run) the
      // protocol hash and code revision, are written in one transaction, before running.
      const at = clock().toISOString();
      const provenance = { codeRevision: CODE_REVISION, engineVersion: ENGINE_VERSION, ...prov, configFileSha256, protocolHash: ps.hash, firstRunCodeRevision, testOverrides: overrides.length ? overrides : null };
      let slot;
      try {
        slot = store.reserveSlot(db, { configFile, version: config.version, configHash: configHash(config), config, reserve, protocolHash: ps.hash, codeRevision: CODE_REVISION, at, ...prov, details: provenance });
      } catch (e) {
        if (/UNIQUE/i.test(e.message)) throw new RtError(409, `${configFile} (or the reserve) is already recorded: each planned config runs once.`);
        throw e;
      }
      id = slot.id;
      const result = runBacktest({ config, symbols: inputs.symbols, sessions: inputs.sessions, days: inputs.days, halfSpreadBps: halfSpreadFor(config, calibrated), dataHash: inputs.dataHash });
      const details = {
        ...provenance, symbolsHash: result.meta.symbolsHash, protocolFrozenAtRun: slot.protocolFrozenAtRun, meta: result.meta,
        trades: result.trades, postExit: result.postExit, openPositions: result.openPositions, pendingOrders: result.pendingOrders, unpaidDividends: result.unpaidDividends, lastSales: result.lastSales,
        fills: result.fills, decisions: result.decisions, skips: result.skips, warnings: result.warnings, dividends: result.dividends, splits: result.splits, watches: result.watches, breaks: result.breaks,
      };
      // Benchmark (a), the index (D4), HXR's hold arm beside it, and the metrics: a failure is recorded as such,
      // and the strategy result is kept.
      let hold = null, index = null, metrics = null, errors = [];
      try {
        index = holdIndex({ symbols: inputs.symbols, sessions: inputs.sessions, days: inputs.days, start: pr.start, startingCash: config.portfolio.startingCash, withholdingPct: config.dividends.withholdingPct });
        details.indexMethod = INDEX_METHOD;
      } catch (e) { errors.push(`benchmark (a) failed: ${e.message}`); details.benchmarkError = e.message; }
      try {
        const holdCfg = loadHxrConfig(holdFile);
        hold = runHxr({ config: holdCfg, symbols: inputs.symbols, period: { warmupFrom: pr.warmupFrom, start: pr.start, end: pr.end }, inputs: { ...inputs, halfSpreadBps: halfSpreadFor(holdCfg, calibrated) }, excludedSessions: excludedDates(periods) });
        Object.assign(details, { benchmarkEngineVersion: HXR_ENGINE_VERSION, holdConfigHash: hold.meta?.configHash ?? null, holdConfigFile: holdFile });
      } catch (e) { errors.push(`HXR hold arm failed: ${e.message}`); details.hxrHoldArmError = e.message; }
      try { metrics = computeMetrics(result, { hold, index }); } catch (e) { errors.push(`metrics failed: ${e.message}`); details.metricsError = e.message; }
      store.insertEquity(db, id, result.equity);
      store.finishRun(db, id, { status: 'done', ...prov, metrics, details, error: errors.length ? errors.join('; ') : null, at: clock().toISOString() });
      const logRow = rowFor(store.getRun(db, id));
      return { id, status: 'done', configFile, version: config.version, metrics, errors, simulated: true, logRow, note: 'Exploratory practice run on development data (2017-10-02 to 2021-12-31). Reported only: no threshold is enforced and no winner is selected. Paste logRow into EXPERIMENT-LOG.md before the next run.' };
    } catch (e) {
      if (id == null) throw e; // refused before the slot was taken: nothing recorded
      const msg = String(e.message || e);
      // The slot stays used, and the hashes and provenance stay with the row: every run is logged, failures
      // included. If even the failure cannot be recorded now, the row stays 'running' and the next service
      // start records it as interrupted.
      let logRow = null, recorded = false;
      try {
        const before = store.getRun(db, id);
        store.finishRun(db, id, { status: 'failed', ...prov, details: before?.details ?? null, error: msg, at: clock().toISOString() });
        recorded = true;
        logRow = rowFor(store.getRun(db, id));
      } catch { /* the next start marks it failed */ }
      if (e instanceof RtError) { e.logRow = logRow; e.recorded = recorded; throw e; }
      throw new RtError(500, recorded
        ? `The practice run failed and is recorded as failed (run ${id}): ${msg}. Paste its log row before the next run.`
        : `The practice run failed (run ${id}): ${msg}. Its failure could not be recorded now; the next service start records it as interrupted, and its log row must be pasted before the next run.`, { logRow, recorded });
    } finally {
      busy = false;
      try { hdb?.close(); } catch { /* ignore */ }
    }
  }

  return {
    db, dataDir: dir, hxrFile, lock, testOverrides: overrides,
    protocol: () => protocolStatus(proto),
    log: () => logStatus(logFile),
    runPractice,
    ledger: () => store.listLedger(db),
    runs: () => store.listRuns(db),
    getRun: (id) => store.getRun(db, id),
    logRowFor: (id) => { const run = store.getRun(db, id); return run ? rowFor(run) : null; },
    close: () => { if (closed) return; closed = true; try { store.releaseLock(db, lock); } finally { db.close(); } },
  };
}
