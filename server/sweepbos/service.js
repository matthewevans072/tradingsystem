// sweep-bos service (strategy/sweep-bos/PLAN.md section 5): the run gate, the development runs, the ledger and
// the log entries. A run starts only when every gate condition holds: the rule sheet matches its pins and its
// commit is an ancestor of HEAD, the sweep-bos code has no uncommitted change, the data version is complete
// with its hash recomputed and nothing past the bar bound, the log's code-frozen entry names the current code
// revision, the pre-registration commit and the data hash, every recorded run is logged, the variant is one
// of the round's pinned files and has not already run, the window is the development window, and no other
// run holds the lock. Nothing here reads holdings or cash, places or prepares an order, or sends anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';
import {
  CODE_REVISION, ENGINE_VERSION, PREREG, PREREG_PATH, PLAN_PATH, LOG_PATH, VARIANT_DIR, DB_NAME, WINDOWS, MAX_BAR_DATE, INSTRUMENTS, ROUND1_VARIANTS,
  fileSha256, loadVariant, logStatus, preregCommitStatus, uncommittedChanges, headCommit, sourceHash, FROZEN_TITLE,
} from './config.js';
import * as store from './store.js';
import { loadInputs } from './data.js';
import { runSymbol } from './engine.js';
import { instrumentMetrics, pooledMetrics, isCandidate, pickRule } from './metrics.js';

export const MIN_FREE_BYTES = 1024 ** 3;
export class GateError extends Error {
  constructor(conditions) { const failed = conditions.filter((c) => !c.ok); super(`the run gate refuses: ${failed.map((c) => `${c.name}: ${c.detail}`).join('; ')}`); this.name = 'GateError'; this.conditions = conditions; }
}

export function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}
const fmt = (x, d = 4) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(d));
const pct = (x) => (x == null ? 'n/a' : `${(100 * x).toFixed(1)}%`);

// options: { dataDir, dbFile, logPath, preregPath, planPath, variantDir, clock, testOverrides, overrides }.
// `overrides` (only with testOverrides: true, recorded in every run's details) replaces the git checks
// ({ prereg: { ok, detail, committedAt }, uncommitted: [], head: '...' }) and the pins ({ pins: { 'PRE-REGISTRATION.md', 'PLAN.md' }, preregCommit, committedAt, roundVariants: [...], variantPins: {} }).
export function createSweepBos({ dataDir = null, dbFile = null, logPath = LOG_PATH, preregPath = PREREG_PATH, planPath = PLAN_PATH, variantDir = VARIANT_DIR, clock = () => new Date(), testOverrides = false, overrides = {} } = {}) {
  if (!testOverrides && Object.keys(overrides).length) throw new Error('overrides need testOverrides: true');
  const dir = dataDir || loadConfig().dataDir;
  const file = dbFile || path.join(dir, DB_NAME);
  const prereg = { commit: overrides.preregCommit || PREREG.commit, committedAt: overrides.committedAt || PREREG.committedAt, sha256: overrides.pins || PREREG.sha256 };
  const roundVariants = overrides.roundVariants || ROUND1_VARIANTS;
  const revision = overrides.revision || CODE_REVISION;
  const now = () => clock().toISOString();

  function openDb(readOnly = false) {
    return store.openSbDb(file, { readOnly });
  }

  // The latest complete data version, or null.
  function latestVersion(db) {
    const versions = store.listDataVersions(db).filter((v) => v.status === 'complete');
    return versions.length ? versions[versions.length - 1] : null;
  }

  function gateStatus({ variantFile = null, round = 1 } = {}) {
    const conds = [];
    const add = (name, ok, detail) => { conds.push({ name, ok: !!ok, detail }); return !!ok; };
    const free = freeBytes(path.dirname(path.resolve(file)));
    add('free-space', free >= MIN_FREE_BYTES, `${(free / 1024 ** 3).toFixed(1)} GB free on the data volume (at least 1 GB)`);
    const pinProblems = [];
    for (const [name, p] of [['PRE-REGISTRATION.md', preregPath], ['PLAN.md', planPath]]) {
      if (!fs.existsSync(p)) pinProblems.push(`${name} does not exist`);
      else if (fileSha256(p) !== prereg.sha256[name]) pinProblems.push(`${name} differs from its pinned SHA-256`);
    }
    add('rule-sheet-pins', !pinProblems.length, pinProblems.length ? pinProblems.join('; ') : 'PRE-REGISTRATION.md and PLAN.md match their pinned SHA-256');
    const pc = testOverrides && overrides.prereg ? overrides.prereg : preregCommitStatus({ prereg });
    add('pre-registration-commit', pc.ok, pc.detail);
    const dirty = testOverrides && overrides.uncommitted ? overrides.uncommitted : testOverrides && overrides.prereg ? [] : uncommittedChanges();
    add('code-committed', !dirty.length, dirty.length ? `uncommitted changes in the sweep-bos files: ${dirty.slice(0, 6).join(', ')}` : 'server/sweepbos, scripts/sweepbos-run.mjs, server/hxr/source.js and the variant files have no uncommitted change');
    add('window', true, `development window ${WINDOWS.development.start} to ${WINDOWS.development.end} (warm-up from ${WINDOWS.warmupFrom}); bar bound ${MAX_BAR_DATE}`);
    let db = null, version = null, runs = [], lock = null, after = null, maxDate = null;
    if (!fs.existsSync(file)) {
      add('data-version', false, `${path.basename(file)} does not exist: run scripts/sweepbos-download.mjs first`);
    } else {
      try {
        db = openDb(true);
        version = latestVersion(db);
        runs = store.listRuns(db);
        lock = store.currentLock(db);
        after = store.countBarsAfterBound(db);
        maxDate = store.maxStoredDate(db);
      } catch (e) {
        add('data-version', false, `the database cannot be opened: ${e.message}`);
      }
    }
    if (db) {
      try {
        if (!version) add('data-version', false, 'no complete data version');
        else {
          const problems = [];
          const recomputed = store.dataHashOf(db, version.id);
          if (recomputed !== version.dataHash) problems.push(`the stored data hash ${version.dataHash} does not recompute (${recomputed})`);
          if (version.preregCommit !== prereg.commit) problems.push(`the data version records pre-registration commit ${version.preregCommit}, not ${prereg.commit}`);
          if (!(Date.parse(version.downloadedAt) > Date.parse(prereg.committedAt))) problems.push(`the data version was downloaded at ${version.downloadedAt}, not after the pre-registration commit (${prereg.committedAt})`);
          if (version.to > MAX_BAR_DATE) problems.push(`the data version's end ${version.to} is after the bar bound`);
          if (!INSTRUMENTS.every((s) => version.symbols.includes(s))) problems.push(`the data version lacks ${INSTRUMENTS.filter((s) => !version.symbols.includes(s)).join(', ')}`);
          add('data-version', !problems.length, problems.length ? problems.join('; ') : `data version ${version.id} (${version.label}), ${version.bars1d} daily and ${version.bars5m} 5-minute bars, hash ${version.dataHash}, downloaded ${version.downloadedAt}`);
        }
        add('bar-bound', after && after.bars5m === 0 && after.bars1d === 0 && (!maxDate || maxDate <= MAX_BAR_DATE), after ? `latest stored date ${maxDate ?? 'none'}; bars after ${MAX_BAR_DATE}: ${after.bars5m} five-minute, ${after.bars1d} daily` : 'unknown');
        const ls = logStatus(logPath, { preregCommit: prereg.commit, revision });
        const frozenOk = !!ls.frozen && !!version && ls.frozen.dataHash === version.dataHash;
        add('code-frozen-entry', frozenOk, ls.frozen ? (version && ls.frozen.dataHash !== version.dataHash ? `the "**${FROZEN_TITLE}**" entry names data hash ${ls.frozen.dataHash}, not the data version's ${version.dataHash}` : `entry ${ls.frozen.number} (${ls.frozen.date}) names ${revision}, the pre-registration commit and the data hash`) : ls.frozenProblem);
        const logProblems = [];
        if (ls.malformed.length) logProblems.push(`malformed run entries: ${ls.malformed.map((m) => `#${m.number} ${m.title}`).join('; ')}`);
        const logged = new Map(ls.runs.map((r) => [r.runId, r]));
        for (const r of runs) {
          if (r.status === 'running') logProblems.push(`run ${r.id} is still marked running (a crashed run): mark it failed with its reason`);
          else if (!logged.has(r.id)) logProblems.push(`run ${r.id} (${r.variant}, ${r.status}) has no log entry`);
          else if (logged.get(r.id).status !== r.status || logged.get(r.id).variant !== r.variant) logProblems.push(`run ${r.id}'s log entry says ${logged.get(r.id).variant} ${logged.get(r.id).status}, the database ${r.variant} ${r.status}`);
        }
        for (const l of ls.runs) if (!runs.some((r) => r.id === l.runId)) logProblems.push(`log entry #${l.number} names run ${l.runId}, which the database does not hold`);
        add('log-well-formed', !logProblems.length, logProblems.length ? logProblems.join('; ') : `${runs.length} recorded run(s), every one logged`);
        add('lock', !lock || !alive(lock.pid), lock && alive(lock.pid) ? `another run holds the lock (pid ${lock.pid} since ${lock.at})` : 'no other run holds the lock');
      } finally {
        db.close();
      }
    }
    if (variantFile) {
      const name = path.basename(variantFile);
      let variant = null;
      const problems = [];
      if (!roundVariants.includes(name)) problems.push(`${name} is not one of round ${round}'s ${roundVariants.length} pre-registered variants`);
      try { variant = loadVariant(path.join(variantDir, name)); } catch (e) { problems.push(e.message); }
      if (variant && variant.round !== round) problems.push(`${name} declares round ${variant.round}, not ${round}`);
      add('variant', !problems.length, problems.length ? problems.join('; ') : `${name}: zone ${variant.zone}, stop ${variant.stop}, bias ${variant.bias}, hash ${variant.hash}`);
      const done = runs.filter((r) => r.variant === name && r.round === round && r.status === 'done');
      const failed = runs.filter((r) => r.variant === name && r.round === round && r.status === 'failed');
      add('variant-not-run', !done.length, done.length ? `${name} already ran in round ${round} (run ${done.map((r) => r.id).join(', ')}): a variant runs once` : `${name} has not run in round ${round}${failed.length ? ` (${failed.length} failed attempt(s) logged)` : ''}`);
    }
    return { ok: conds.every((c) => c.ok), conditions: conds, version: version ? { id: version.id, dataHash: version.dataHash } : null };
  }

  // The log entry for a recorded run (appended by the launcher; printed when the append fails).
  function runEntry(run, number, date) {
    const head = `## ${number} | ${date} | **Run** run id: ${run.id}, variant: ${run.variant}, variant hash: ${run.variantHash}, status: ${run.status}`;
    if (run.status !== 'done') return `\n${head}\n\nRound ${run.round} development run of ${run.variant} FAILED: ${run.error}. Data version ${run.dataVersionId} (hash ${run.dataHash}), code revision ${run.codeRevision}, engine ${run.engineVersion}, source hash ${run.sourceHash}, HEAD ${run.headCommit}, started ${run.createdAt}, finished ${run.finishedAt}. The failure is recorded; a retry is a new run.\n`;
    const m = run.metrics;
    const line = (s) => { const x = m.perInstrument[s]; return `${s}: sessions ${x.sessionsInWindow}, trades ${x.trades}, win rate ${pct(x.winRate)}, mean R ${fmt(x.meanR)}, median R ${fmt(x.medianR)}, profit factor ${fmt(x.profitFactor, 3)}, max drawdown ${fmt(x.maxDrawdownR, 2)} R, mean R at 2x costs ${fmt(x.meanR2x)}, bootstrap 95% [${fmt(x.bootstrap.lower)}, ${fmt(x.bootstrap.upper)}], null p ${fmt(x.nullTest.p, 4)}, mean R without best 5% ${fmt(x.bestRemoved.mean)}, max month share ${fmt(x.monthShares.maxShare, 3)}, outcomes stop ${x.outcomeCounts.stop} (same bar ${x.outcomeCounts.stop_same_bar}) / target ${x.outcomeCounts.target} / time ${x.outcomeCounts.time}; C1-C6 ${['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((k) => `${k} ${x.criteria[k].pass ? 'pass' : 'fail'}`).join(', ')}`; };
    return `\n${head}\n\nRound ${run.round} development run of ${run.variant} (${run.details.variant.zone}, ${run.details.variant.stop}, bias ${run.details.variant.bias}) on ${INSTRUMENTS.join(' and ')}, ${run.window.start} to ${run.window.end}, data version ${run.dataVersionId} (hash ${run.dataHash}), code revision ${run.codeRevision}, engine ${run.engineVersion}, source hash ${run.sourceHash}, HEAD ${run.headCommit}, started ${run.createdAt}, finished ${run.finishedAt}. Measured: ${INSTRUMENTS.map(line).join('. ')}. Pooled mean R ${fmt(m.pooled.meanR)} over ${m.pooled.trades} trades, pooled max drawdown ${fmt(m.pooled.maxDrawdownR, 2)} R. Candidate by the pre-registered criteria: ${m.candidate ? 'YES' : 'no'}. Dollar account (information only): ${INSTRUMENTS.map((s) => `${s} ending cash ${fmt(m.perInstrument[s].account.endingCash, 2)}, max drawdown ${fmt(m.perInstrument[s].account.maxDrawdown, 2)}`).join('; ')}. Data seen: these figures.\n`;
  }

  // Runs one variant on both instruments over the development window when the gate holds. Returns
  // { run, entry, conditions }; throws GateError without running when a condition fails.
  function run({ variantFile, round = 1, confirm = false } = {}) {
    if (!confirm) throw new Error('run needs confirm: true');
    const gate = gateStatus({ variantFile, round });
    if (!gate.ok) throw new GateError(gate.conditions);
    const name = path.basename(variantFile);
    const variant = loadVariant(path.join(variantDir, name));
    const db = openDb(false);
    let lock = null, runId = null;
    try {
      lock = store.acquireLock(db, { host: os.hostname(), at: now() });
      // Re-read inside the lock: a run recorded between the check and the lock is refused.
      const existing = store.listRuns(db).filter((r) => r.variant === name && r.round === round && r.status === 'done');
      if (existing.length) throw new GateError([{ name: 'variant-not-run', ok: false, detail: `${name} already ran (run ${existing[0].id})` }]);
      const version = latestVersion(db);
      const head = testOverrides && overrides.head ? overrides.head : headCommit();
      const details = { codeRevision: revision, engineVersion: ENGINE_VERSION, sourceHash: sourceHash(), headCommit: head, preregCommit: prereg.commit, preregSha256: prereg.sha256['PRE-REGISTRATION.md'], variant: { name: variant.name, file: name, hash: variant.hash, zone: variant.zone, stop: variant.stop, bias: variant.bias }, window: { ...WINDOWS.development, warmupFrom: WINDOWS.warmupFrom }, dataVersion: { id: version.id, hash: version.dataHash, label: version.label }, testOverrides: testOverrides ? Object.keys(overrides) : null, startedAt: now() };
      runId = store.createRun(db, { round, variant: name, variantHash: variant.hash, dataVersionId: version.id, dataHash: version.dataHash, window: WINDOWS.development, codeRevision: revision, engineVersion: ENGINE_VERSION, sourceHash: details.sourceHash, headCommit: head, preregCommit: prereg.commit, preregSha256: details.preregSha256, details, createdAt: details.startedAt });
      try {
        if (testOverrides && overrides.failWith) throw new Error(overrides.failWith);
        const results = [], perInstrument = {};
        for (const symbol of INSTRUMENTS) {
          const inputs = loadInputs(db, version.id, symbol, { from: WINDOWS.warmupFrom, to: WINDOWS.development.end });
          const r = runSymbol({ symbol, daily: inputs.daily, sessions: inputs.sessions, variant, window: WINDOWS.development, costPerSide: variant.costs.perSide, sensitivity: variant.costs.sensitivityMultiple, startingCash: variant.account.startingCash });
          results.push(r);
          perInstrument[symbol] = instrumentMetrics(r);
          store.insertTrades(db, runId, symbol, r.trades);
          store.insertSessions(db, runId, symbol, r.sessions);
        }
        const metrics = { perInstrument, pooled: pooledMetrics(results), candidate: isCandidate(perInstrument) };
        const finishedAt = now();
        store.finishRun(db, runId, { finishedAt, metrics, details: { ...details, finishedAt } });
        store.appendLedger(db, { kind: 'run', round, variant: name, runId, dataVersionId: version.id, note: `done; candidate ${metrics.candidate ? 'yes' : 'no'}; pooled mean R ${fmt(metrics.pooled.meanR)}`, at: finishedAt });
      } catch (e) {
        const finishedAt = now();
        store.failRun(db, runId, { finishedAt, error: e.message, details: { ...details, finishedAt } });
        store.appendLedger(db, { kind: 'run', round, variant: name, runId, dataVersionId: version.id, note: `failed: ${e.message}`, at: finishedAt });
      }
      const rec = store.getRun(db, runId);
      const ls = logStatus(logPath, { preregCommit: prereg.commit, revision });
      return { run: rec, entry: runEntry(rec, ls.nextNumber, now().slice(0, 10)), conditions: gate.conditions };
    } finally {
      if (lock) store.releaseLock(db, lock);
      db.close();
    }
  }

  // A run left "running" by a crash is marked failed with a reason; returns the log entry to append.
  function markFailed(runId, reason) {
    const db = openDb(false);
    try {
      const r = store.getRun(db, runId);
      if (!r) throw new Error(`run ${runId} does not exist`);
      if (r.status !== 'running') throw new Error(`run ${runId} is ${r.status}, not running`);
      const finishedAt = now();
      store.failRun(db, runId, { finishedAt, error: `marked failed: ${reason}` });
      store.appendLedger(db, { kind: 'run', round: r.round, variant: r.variant, runId, dataVersionId: r.dataVersionId, note: `marked failed: ${reason}`, at: finishedAt });
      const ls = logStatus(logPath, { preregCommit: prereg.commit, revision });
      return { run: store.getRun(db, runId), entry: runEntry(store.getRun(db, runId), ls.nextNumber, now().slice(0, 10)) };
    } finally {
      db.close();
    }
  }

  function listRuns() {
    if (!fs.existsSync(file)) return [];
    const db = openDb(true);
    try { return store.listRuns(db); } finally { db.close(); }
  }

  // The report-only pick among the round's recorded runs (PRE-REGISTRATION.md section 5).
  function pickReport({ round = 1 } = {}) {
    const runs = listRuns().filter((r) => r.round === round && r.status === 'done');
    const variants = runs.map((r) => ({ name: r.variant, candidate: !!r.metrics?.candidate, pooled: r.metrics?.pooled || null, runId: r.id }));
    const expected = roundVariants.length;
    const pick = pickRule(variants);
    const complete = runs.length === expected;
    return { round, expected, recorded: runs.length, complete, candidates: variants.filter((v) => v.candidate).map((v) => v.name), pick: complete ? pick.pick : null, reason: complete ? pick.reason : `not all ${expected} runs are recorded (${runs.length} of ${expected}); no pick is reported before the round is complete`, ranking: pick.ranking };
  }

  return { file, gateStatus, run, markFailed, listRuns, pickReport, revision };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
