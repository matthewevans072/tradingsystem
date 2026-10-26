// Range-trend practice runs (PLAN-DRAFT.md v0.3 sections 6-8). Simulation only.
// Market data is read at run time, read-only, through HXR's data layer from
// data/hxr-sim.sqlite; results go to data/range-trend-sim.sqlite only.
// A practice run is refused unless EVALUATION-PROTOCOL.md exists and contains
// the pick rule; only the planned configs run, each once; the one reserve re-runs
// a run invalidated by a verified defect, keeping the broken result.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, configHash, PLANNED_CONFIGS, CODE_REVISION, protocolStatus, PROTOCOL_PATH } from './config.js';
import { runBacktest } from './engine.js';
import { computeMetrics } from './metrics.js';
import * as store from './store.js';
import * as hxrStore from '../hxr/store.js';
import { loadHxrUniverse, loadHxrPeriods, basketSymbols, excludedDates, halfSpreadFor, loadHxrConfig } from '../hxr/config.js';
import { buildInputs, buildSpreadTable, halfSpreadFn, readiness } from '../hxr/data.js';
import { runBacktest as runHxr } from '../hxr/engine.js';

export class RtError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const RESERVE_FIELDS = ['invalidatedRunId', 'defect', 'verification', 'correction'];

export function createRangeTrend({ dataDir, hxrDbFile = null, protocolPath = PROTOCOL_PATH, clock = () => new Date() } = {}) {
  if (!dataDir) throw new Error('createRangeTrend needs dataDir');
  const db = store.openRtDb(store.rtDbFile(dataDir));
  const hxrFile = hxrDbFile || path.join(dataDir, hxrStore.HXR_DB_NAME);
  let busy = false;

  function gate({ configFile, confirm, reserve }) {
    if (confirm !== true) throw new RtError(400, 'A practice run needs confirm: true.');
    const proto = protocolStatus(protocolPath);
    if (!proto.ready) throw new RtError(409, `Practice runs are refused: ${proto.reason}. The owner writes the pick rule (and how the evaluation dates are chosen) in EVALUATION-PROTOCOL.md before the first practice run.`);
    if (!PLANNED_CONFIGS.includes(configFile)) throw new RtError(400, `Only the planned configs can run (${PLANNED_CONFIGS.join(', ')}).`);
    const ledger = store.listLedger(db);
    const prior = ledger.filter((e) => e.config_file === configFile);
    if (prior.length && !reserve) throw new RtError(409, `${configFile} has already run (run ${prior.at(-1).run_id}). A re-run is possible only as the one reserve, for a verified defect.`);
    if (reserve) {
      if (ledger.some((e) => e.reserve)) throw new RtError(409, 'The one reserve run has already been used.');
      for (const f of RESERVE_FIELDS) if (!reserve[f] || (typeof reserve[f] === 'string' && !reserve[f].trim())) throw new RtError(400, `A reserve run needs ${RESERVE_FIELDS.join(', ')} (the defect, how it was verified and the correction).`);
      if (!prior.some((e) => e.run_id === reserve.invalidatedRunId)) throw new RtError(409, `Run ${reserve.invalidatedRunId} is not a recorded run of ${configFile}.`);
    }
    return proto;
  }

  async function runPractice({ configFile, confirm, reserve = null } = {}) {
    const proto = gate({ configFile, confirm, reserve });
    if (busy) throw new RtError(409, 'Another practice run is in progress.');
    if (!fs.existsSync(hxrFile)) throw new RtError(409, `No HXR market data at ${path.basename(hxrFile)}: download it through the HXR page first.`);
    busy = true;
    const config = loadConfig(configFile);
    // The market data is opened read-only and checked before the run is recorded: a refusal here uses no slot.
    let hdb = null, id = null;
    try {
      hdb = hxrStore.openHxrDb(hxrFile, { readOnly: true });
      const universe = loadHxrUniverse(), periods = loadHxrPeriods();
      const ready = readiness(hdb, { universe, periods });
      if (!ready.periods.development?.usable) throw new RtError(409, `The HXR development period is not ready: ${(ready.periods.development?.reasons || []).slice(0, 5).join('; ')}. Nothing was run.`);
      id = store.createRun(db, { configFile, version: config.version, configHash: configHash(config), config, reserve, protocolHash: proto.hash, codeRevision: CODE_REVISION, at: clock().toISOString() });
      const pr = config.period;
      const symbols = basketSymbols(universe, pr.basket);
      const spread = buildSpreadTable(hdb, universe, { floorBps: config.costs.halfSpreadFloorBps, toYear: Number(pr.end.slice(0, 4)) });
      const calibrated = halfSpreadFn(spread);
      const inputs = buildInputs(hdb, { universe, symbols: symbols.map((s) => s.symbol), warmupFrom: pr.warmupFrom, end: pr.end, excludedSessions: excludedDates(periods), spreadTable: spread, start: pr.start });
      const result = runBacktest({ config, symbols: inputs.symbols, sessions: inputs.sessions, days: inputs.days, halfSpreadBps: halfSpreadFor(config, calibrated), dataHash: inputs.dataHash });
      // (a) the fully invested equal-weight buy-and-hold: HXR's hold arm on the same inputs and costs.
      const holdCfg = loadHxrConfig('hxr-hold-0.1.0.json');
      const hold = runHxr({ config: holdCfg, symbols: inputs.symbols, period: { warmupFrom: pr.warmupFrom, start: pr.start, end: pr.end }, inputs: { ...inputs, halfSpreadBps: halfSpreadFor(holdCfg, calibrated) }, excludedSessions: excludedDates(periods) });
      const metrics = computeMetrics(result, { hold });
      const done = clock().toISOString();
      store.insertEquity(db, id, result.equity);
      store.finishRun(db, id, {
        status: 'done', symbolsHash: result.meta.symbolsHash, dataHash: inputs.dataHash, calibrationHash: inputs.calibrationHash, metrics, at: done,
        details: {
          codeRevision: CODE_REVISION, symbolsHash: result.meta.symbolsHash, meta: result.meta, protocolHash: proto.hash, holdConfigHash: hold.meta?.configHash ?? null,
          trades: result.trades, openPositions: result.openPositions, fills: result.fills, decisions: result.decisions, skips: result.skips, warnings: result.warnings, dividends: result.dividends, splits: result.splits, watches: result.watches,
        },
      });
      store.appendLedger(db, { runId: id, configFile, configHash: configHash(config), reserve: !!reserve, reserveDetail: reserve, at: done });
      return { id, status: 'done', configFile, version: config.version, metrics, simulated: true, note: 'Exploratory practice run on development data (2017-10-02 to 2021-12-31). Reported only: no threshold is enforced and no winner is selected.' };
    } catch (e) {
      const msg = String(e.message || e);
      if (id == null) throw e; // refused before the run started: nothing recorded
      // Every run is logged, failures included: the failed run uses its slot.
      store.finishRun(db, id, { status: 'failed', error: msg, at: clock().toISOString() });
      store.appendLedger(db, { runId: id, configFile, configHash: configHash(config), reserve: !!reserve, reserveDetail: reserve, at: clock().toISOString() });
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
    runPractice,
    ledger: () => store.listLedger(db),
    runs: () => store.listRuns(db),
    getRun: (id) => store.getRun(db, id),
    close: () => db.close(),
  };
}
