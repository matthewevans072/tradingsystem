// ICT Lab service (strategy/ict-lab/PROTOCOL.md section 10): the run gate (rules 1 to 9), the runs, the ledger
// and the log entries. A run starts only when every gate condition holds. Nothing here reads holdings or cash,
// places or prepares an order, or sends anything. The reserved window has no code path (config.js windowOf);
// the validation window is refused until the owner's "**Validation authorized**" row is in the log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';
import {
  CODE_REVISION, ENGINE_VERSION, PREREG, PINNED_DOCS, PROTOCOL_PATH, CONCEPTS_PATH, LOG_PATH, SPEC_DIR, DB_NAME, WINDOWS, MAX_BAR_DATE, INSTRUMENT, RUNNABLE_WINDOWS,
  fileSha256, loadSpec, validateRound, logStatus, preregCommitStatus, uncommittedChanges, headCommit, sourceHash, frozenTitle, roundSpecs as roundSpecsOf, SPEC_SHA256, windowOf,
} from './config.js';
import * as store from './store.js';
import { loadInputs } from './data.js';
import { runSpec, countsOf } from './engine.js';
import { specMetrics } from './metrics.js';

export const MIN_FREE_BYTES = 1024 ** 3;
export const TEMP_PREFIXES = Object.freeze(['sd-test-', 'sb-', 'il-', 'rt-', 'hxr-']);
export class GateError extends Error {
  constructor(conditions) { const failed = conditions.filter((c) => !c.ok); super(`the run gate refuses: ${failed.map((c) => `${c.name}: ${c.detail}`).join('; ')}`); this.name = 'GateError'; this.conditions = conditions; }
}

export function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}
// Rule 9, "temp folders cleaned": the test and harness directories left in the temp folder.
export function tempLeftovers(dir = os.tmpdir()) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => TEMP_PREFIXES.some((p) => n.startsWith(p)));
}
const fmt = (x, d = 4) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(d));
const pct = (x) => (x == null ? 'n/a' : `${(100 * x).toFixed(1)}%`);

// options: { dataDir, dbFile, logPath, protocolPath, conceptsPath, specDir, clock, testOverrides, overrides }.
// `overrides` (only with testOverrides: true, recorded in every run's details) replaces the git checks
// ({ prereg: { ok, detail, committedAt }, uncommitted: [], head }), the pins ({ pins: { 'PROTOCOL.md',
// 'CONCEPTS.md' }, specPins, preregCommit, committedAt, roundSpecs: [...] }), the temp check ({ tempDirs: [] })
// and the statistics sizes ({ nullN, bootstrapN }) so synthetic tests run quickly.
export function createIctLab({ dataDir = null, dbFile = null, logPath = LOG_PATH, protocolPath = PROTOCOL_PATH, conceptsPath = CONCEPTS_PATH, specDir = SPEC_DIR, clock = () => new Date(), testOverrides = false, overrides = {} } = {}) {
  if (!testOverrides && Object.keys(overrides).length) throw new Error('overrides need testOverrides: true');
  const dir = dataDir || loadConfig().dataDir;
  const file = dbFile || path.join(dir, DB_NAME);
  const prereg = { commit: overrides.preregCommit || PREREG.commit, committedAt: overrides.committedAt || PREREG.committedAt, sha256: overrides.pins || PREREG.sha256 };
  const specPins = overrides.specPins || SPEC_SHA256;
  const listFor = (round) => overrides.roundSpecs || roundSpecsOf(round);
  const revision = overrides.revision || CODE_REVISION;
  const now = () => clock().toISOString();
  const docPaths = { 'PROTOCOL.md': protocolPath, 'CONCEPTS.md': conceptsPath };
  const statOpts = () => ({ nullN: overrides.nullN, bootstrapN: overrides.bootstrapN });

  const openDb = (readOnly = false) => store.openIlDb(file, { readOnly });
  function latestVersion(db) {
    const versions = store.listDataVersions(db).filter((v) => v.status === 'complete');
    return versions.length ? versions[versions.length - 1] : null;
  }
  const load = (name) => loadSpec(path.join(specDir, name), { specDir, pins: specPins });

  // Every condition of PROTOCOL.md section 10, each with its rule number; `ok` only when all hold.
  function gateStatus({ specFile = null, window = 'development', round = 1, repeatReason = null } = {}) {
    const conds = [];
    const add = (name, rule, ok, detail) => { conds.push({ name, rule, ok: !!ok, detail }); return !!ok; };
    const free = freeBytes(path.dirname(path.resolve(file)));
    add('free-space', 9, free >= MIN_FREE_BYTES, `${(free / 1024 ** 3).toFixed(1)} GB free on the data volume (at least 1 GB)`);
    const temp = testOverrides && overrides.tempDirs ? overrides.tempDirs : tempLeftovers();
    add('temp-clean', 9, !temp.length, temp.length ? `${temp.length} test or harness director${temp.length === 1 ? 'y' : 'ies'} left in the temp folder (${temp.slice(0, 3).join(', ')}${temp.length > 3 ? ', ...' : ''}): clean them first` : 'no test or harness directory left in the temp folder');
    const pinProblems = [];
    for (const name of PINNED_DOCS) {
      const p = docPaths[name];
      if (!fs.existsSync(p)) pinProblems.push(`${name} does not exist`);
      else if (fileSha256(p) !== prereg.sha256[name]) pinProblems.push(`${name} differs from its pinned SHA-256`);
    }
    for (const name of listFor(round)) {
      const p = path.join(specDir, name);
      if (!fs.existsSync(p)) pinProblems.push(`specs/${name} does not exist`);
      else if (specPins[name] && fileSha256(p) !== specPins[name]) pinProblems.push(`specs/${name} differs from its pinned SHA-256`);
    }
    add('pins', 1, !pinProblems.length, pinProblems.length ? pinProblems.join('; ') : `PROTOCOL.md, CONCEPTS.md and the ${listFor(round).length} spec files match their pinned SHA-256`);
    const pc = testOverrides && overrides.prereg ? overrides.prereg : preregCommitStatus({ prereg });
    add('pre-registration-commit', 1, pc.ok, pc.detail);
    const dirty = testOverrides && overrides.uncommitted ? overrides.uncommitted : testOverrides && overrides.prereg ? [] : uncommittedChanges();
    add('code-committed', 8, !dirty.length, dirty.length ? `uncommitted changes in the ict-lab files: ${dirty.slice(0, 6).join(', ')}` : 'server/ictlab, the launcher, the download script, server/hxr/source.js and the pinned documents have no uncommitted change');
    let win = null;
    try { win = windowOf(window); add('window', 7, true, `${window} window ${win.start} to ${win.end}; bar bound ${MAX_BAR_DATE}`); } catch (e) { add('window', 7, false, e.message); }
    let db = null, version = null, runs = [], lock = null, after = null, maxDate = null;
    if (!fs.existsSync(file)) {
      add('data-version', 2, false, `${path.basename(file)} does not exist: no data version (run scripts/ictlab-download.mjs first, with the owner's authorization)`);
    } else {
      try {
        db = openDb(true);
        version = latestVersion(db);
        runs = store.listRuns(db);
        lock = store.currentLock(db);
        after = store.countBarsAfterBound(db);
        maxDate = store.maxStoredDate(db);
      } catch (e) {
        add('data-version', 2, false, `the database cannot be opened: ${e.message}`);
      }
    }
    if (db) {
      try {
        if (!version) add('data-version', 2, false, 'no data version: no complete data version is recorded');
        else {
          const problems = [];
          const recomputed = store.dataHashOf(db, version.id);
          if (recomputed !== version.dataHash) problems.push(`the stored data hash ${version.dataHash} does not recompute (${recomputed})`);
          if (version.preregCommit !== prereg.commit) problems.push(`the data version records pre-registration commit ${version.preregCommit}, not ${prereg.commit}`);
          if (!(Date.parse(version.downloadedAt) > Date.parse(prereg.committedAt))) problems.push(`the data version was downloaded at ${version.downloadedAt}, not after the pre-registration commit (${prereg.committedAt})`);
          if (version.to > MAX_BAR_DATE) problems.push(`the data version's end ${version.to} is after the bar bound`);
          if (!version.symbols.includes(INSTRUMENT)) problems.push(`the data version lacks ${INSTRUMENT}`);
          if (win && (version.from > win.start || version.to < win.end)) problems.push(`the data version covers ${version.from} to ${version.to}, not the ${window} window ${win.start} to ${win.end}${win.end > MAX_BAR_DATE ? ' (beyond the bar bound: it needs the owner\'s separate message, a new code revision and a new data version)' : ''}`);
          add('data-version', 2, !problems.length, problems.length ? problems.join('; ') : `data version ${version.id} (${version.label}), ${version.bars1d} daily and ${version.bars5m} 5-minute bars, hash ${version.dataHash}, downloaded ${version.downloadedAt}`);
        }
        add('bar-bound', 2, after && after.bars5m === 0 && after.bars1d === 0 && (!maxDate || maxDate <= MAX_BAR_DATE), after ? `latest stored date ${maxDate ?? 'none'}; bars after ${MAX_BAR_DATE}: ${after.bars5m} five-minute, ${after.bars1d} daily` : 'unknown');
        const ls = logStatus(logPath, { preregCommit: prereg.commit, revision, round, specFile });
        const frozenOk = !!ls.frozen && !!version && ls.frozen.dataHash === version.dataHash;
        add('code-frozen-entry', 3, frozenOk, ls.frozen ? (version && ls.frozen.dataHash !== version.dataHash ? `the "**${frozenTitle(round)}**" entry names data hash ${ls.frozen.dataHash}, not the data version's ${version.dataHash}` : `entry ${ls.frozen.number} (${ls.frozen.date}) "${frozenTitle(round)}" names ${revision}, the pre-registration commit and the data hash`) : ls.frozenProblem);
        const logProblems = [];
        if (ls.malformed.length) logProblems.push(`malformed run entries: ${ls.malformed.map((m) => `#${m.number} ${m.title}`).join('; ')}`);
        const logged = new Map(ls.runs.map((r) => [r.runId, r]));
        for (const r of runs) {
          if (r.status === 'running') logProblems.push(`run ${r.id} is still marked running (a crashed run): mark it failed with its reason`);
          else if (!logged.has(r.id)) logProblems.push(`run ${r.id} (${r.spec}, ${r.window}, ${r.status}) has no log entry`);
          else if (logged.get(r.id).status !== r.status || logged.get(r.id).spec !== r.spec || logged.get(r.id).window !== r.window) logProblems.push(`run ${r.id}'s log entry says ${logged.get(r.id).spec} ${logged.get(r.id).window} ${logged.get(r.id).status}, the database ${r.spec} ${r.window} ${r.status}`);
        }
        for (const l of ls.runs) if (!runs.some((r) => r.id === l.runId)) logProblems.push(`log entry #${l.number} names run ${l.runId}, which the database does not hold`);
        add('log-well-formed', 3, !logProblems.length, logProblems.length ? logProblems.join('; ') : `${runs.length} recorded run(s), every one logged`);
        add('lock', 6, !lock || !alive(lock.pid), lock && alive(lock.pid) ? `another run holds the lock (pid ${lock.pid} since ${lock.at})` : 'no other run holds the lock');
        if (window === 'validation') add('validation-authorized', 7, ls.validation.authorized, ls.validation.authorized ? `entry ${ls.validation.number} (${ls.validation.date}) "**Validation authorized**" names ${revision} and ${ls.validation.specs.join(', ')}` : ls.validation.problem);
      } finally {
        db.close();
      }
    }
    if (specFile) {
      const name = path.basename(specFile);
      let spec = null;
      const problems = [];
      const list = listFor(round);
      if (!list.includes(name)) problems.push(`${name} is not one of round ${round}'s ${list.length} pre-registered specs`);
      try { spec = load(name); } catch (e) { problems.push(e.message); }
      if (spec && spec.round !== round) problems.push(`${name} declares round ${spec.round}, not ${round}`);
      if (spec && list.includes(name)) {
        try {
          const all = list.map((f) => (f === name ? spec : load(f)));
          problems.push(...validateRound(all));
        } catch (e) { problems.push(`the round's shared block cannot be compared: ${e.message}`); }
      }
      add('spec', 4, !problems.length, problems.length ? problems.join('; ') : `${name}: ${spec.name} ${spec.version}, hash ${spec.hash}; the round's shared block is identical across its ${list.length} files`);
      const done = runs.filter((r) => r.spec === name && r.window === window && r.status === 'done');
      const failed = runs.filter((r) => r.spec === name && r.window === window && r.status === 'failed');
      const reason = typeof repeatReason === 'string' && repeatReason.trim() ? repeatReason.trim() : null;
      if (!done.length) add('spec-not-run', 4, true, `${name} has not run on the ${window} window${failed.length ? ` (${failed.length} failed attempt(s) logged)` : ''}${reason ? '; a repeat reason was given but there is nothing to repeat' : ''}`);
      else if (reason) add('spec-not-run', 5, true, `${name} already ran on the ${window} window (run ${done.map((r) => r.id).join(', ')}); this run is a REPEAT with the stated reason "${reason}" and will be marked ${window === 'validation' ? 'contaminated (it can never be "not rejected")' : 'repeat'}`);
      else add('spec-not-run', 4, false, `${name} already ran on the ${window} window (run ${done.map((r) => r.id).join(', ')}): a spec runs once per window; a repeat needs a stated reason (--repeat-reason) and is marked`);
    }
    return { ok: conds.every((c) => c.ok), conditions: conds, version: version ? { id: version.id, dataHash: version.dataHash } : null };
  }

  // The log entry for a recorded run (appended by the launcher; printed when the append fails).
  function runEntry(run, number, date) {
    const head = `## ${number} | ${date} | **Run** run id: ${run.id}, spec: ${run.spec}, spec hash: ${run.specHash}, window: ${run.window}, status: ${run.status}`;
    const prov = `Data version ${run.dataVersionId} (hash ${run.dataHash}), code revision ${run.codeRevision}, engine ${run.engineVersion}, source hash ${run.sourceHash}, HEAD ${run.headCommit}, protocol ${run.protocolSha256.slice(0, 12)}, concepts ${run.conceptsSha256.slice(0, 12)}, started ${run.createdAt}, finished ${run.finishedAt}${run.repeat ? `. REPEAT (${run.repeatReason})${run.contaminated ? ', CONTAMINATED' : ''}` : ''}`;
    if (run.status !== 'done') return `\n${head}\n\nRound ${run.round} ${run.window} run of ${run.spec} FAILED: ${run.error}. ${prov}. The failure is recorded; a retry is a new run.\n`;
    const m = run.metrics;
    const f = m.funnel;
    const line = `sessions ${m.sessionsInWindow}, tradeable ${f.tradeable}, sweeps ${f.sweeps}, confirmed ${f.confirmed}, usable zone ${f.usableZone}, orders ${f.orders}, fills ${f.fills}; trades ${m.trades}, win rate ${pct(m.winRate)}, mean R ${fmt(m.meanR)}, median R ${fmt(m.medianR)}, profit factor ${fmt(m.profitFactor, 3)}, max drawdown ${fmt(m.maxDrawdownR, 2)} R, mean R at 2x costs ${fmt(m.meanR2x)}, bootstrap 95% [${fmt(m.bootstrap.lower)}, ${fmt(m.bootstrap.upper)}], null p ${fmt(m.nullTest.p, 6)}, mean R without best 5% ${fmt(m.bestRemoved.mean)}, max month share ${fmt(m.monthShares.maxShare, 3)}, exits stop ${m.exitCounts.stop} / same-bar stop ${m.exitCounts.stop_same_bar} / target ${m.exitCounts.target} / time ${m.exitCounts.time}; C1-C6 ${['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((k) => `${k} ${m.criteria[k].pass ? 'pass' : 'fail'}`).join(', ')}`;
    const outcome = run.window === 'development' ? `Candidate by the pre-registered criteria: ${m.candidate ? 'YES' : 'no'}` : `Validation outcome: ${run.contaminated ? 'contaminated' : m.candidate ? 'NOT REJECTED ON VALIDATION' : 'REJECTED'}`;
    return `\n${head}\n\nRound ${run.round} ${run.window} run of ${run.spec} (${m.spec.setupKind}, zone ${m.spec.zone}) on ${INSTRUMENT}, ${run.windowDates.start} to ${run.windowDates.end}. ${prov}. Measured: ${line}. ${outcome}. Dollar account: ending cash ${fmt(m.account.endingCash, 2)}, max drawdown ${fmt(m.account.maxDrawdown, 2)}, cash_capped ${m.sizing.cashCapped} of ${m.trades}, unfunded ${m.sizing.unfunded}, losses beyond the planned risk ${m.sizing.lossExceededRisk}. Data seen: these figures.\n`;
  }

  // Runs one spec on one window when the gate holds. Returns { run, entry, conditions }; throws GateError without
  // running when a condition fails. The ledger slot, the run row, every hash and (first run) the write-once settings
  // are one transaction.
  function run({ specFile, window = 'development', round = 1, confirm = false, repeatReason = null } = {}) {
    if (!confirm) throw new Error('run needs confirm: true');
    const gate = gateStatus({ specFile, window, round, repeatReason });
    if (!gate.ok) throw new GateError(gate.conditions);
    const win = windowOf(window);
    const name = path.basename(specFile);
    const spec = load(name);
    const reason = typeof repeatReason === 'string' && repeatReason.trim() ? repeatReason.trim() : null;
    const db = openDb(false);
    let lock = null, runId = null;
    try {
      lock = store.acquireLock(db, { host: os.hostname(), at: now() });
      // Re-read inside the lock: a run recorded between the check and the lock is refused unless a reason was given.
      const existing = store.listRuns(db).filter((r) => r.spec === name && r.window === window && r.status === 'done');
      if (existing.length && !reason) throw new GateError([{ name: 'spec-not-run', rule: 4, ok: false, detail: `${name} already ran on the ${window} window (run ${existing[0].id})` }]);
      const repeat = existing.length > 0 && !!reason;
      const contaminated = repeat && window === 'validation';
      const version = latestVersion(db);
      const head = testOverrides && overrides.head ? overrides.head : headCommit();
      const protocolSha256 = fileSha256(protocolPath), conceptsSha256 = fileSha256(conceptsPath);
      const startedAt = now();
      const details = { codeRevision: revision, engineVersion: ENGINE_VERSION, sourceHash: sourceHash(), headCommit: head, preregCommit: prereg.commit, protocolSha256, conceptsSha256, specHash: spec.hash, dataHash: version.dataHash, spec: { name: spec.name, file: name, version: spec.version, hash: spec.hash }, window: { name: window, ...win }, dataVersion: { id: version.id, hash: version.dataHash, label: version.label }, repeat, repeatReason: reason, contaminated, testOverrides: testOverrides ? Object.keys(overrides) : null, startedAt };
      runId = store.tx(db, () => {
        store.setSettingOnce(db, 'first_run_protocol_sha256', protocolSha256, startedAt);
        store.setSettingOnce(db, 'first_run_concepts_sha256', conceptsSha256, startedAt);
        store.setSettingOnce(db, 'first_run_code_revision', revision, startedAt);
        const id = store.createRun(db, { round, spec: name, specHash: spec.hash, window, repeat, repeatReason: reason, contaminated, dataVersionId: version.id, dataHash: version.dataHash, windowDates: win, codeRevision: revision, engineVersion: ENGINE_VERSION, sourceHash: details.sourceHash, headCommit: head, preregCommit: prereg.commit, protocolSha256, conceptsSha256, details, createdAt: startedAt });
        store.appendLedger(db, { kind: 'slot', round, spec: name, window, runId: id, dataVersionId: version.id, note: `slot taken${repeat ? ` (repeat: ${reason})` : ''}; code ${revision}, engine ${ENGINE_VERSION}, source ${details.sourceHash}, HEAD ${head}, spec ${spec.hash}, data ${version.dataHash}, protocol ${protocolSha256}, concepts ${conceptsSha256}`, at: startedAt });
        return id;
      });
      try {
        if (testOverrides && overrides.failWith) throw new Error(overrides.failWith);
        const inputs = loadInputs(db, version.id, INSTRUMENT, { from: win.start, to: win.end });
        const r = runSpec({ spec, daily: inputs.daily, sessions: inputs.sessions, window: win });
        const metrics = specMetrics(r, { window, ...statOpts() });
        store.insertTrades(db, runId, r.trades);
        store.insertSessions(db, runId, r.sessions);
        const finishedAt = now();
        store.finishRun(db, runId, { finishedAt, metrics, details: { ...details, finishedAt } });
        store.appendLedger(db, { kind: 'run', round, spec: name, window, runId, dataVersionId: version.id, note: `done; ${window === 'development' ? `candidate ${metrics.candidate ? 'yes' : 'no'}` : `validation ${contaminated ? 'contaminated' : metrics.candidate ? 'not rejected' : 'rejected'}`}; trades ${metrics.trades}; mean R ${fmt(metrics.meanR)}`, at: finishedAt });
      } catch (e) {
        const finishedAt = now();
        store.failRun(db, runId, { finishedAt, error: e.message, details: { ...details, finishedAt } });
        store.appendLedger(db, { kind: 'run', round, spec: name, window, runId, dataVersionId: version.id, note: `failed: ${e.message}`, at: finishedAt });
      }
      const rec = store.getRun(db, runId);
      const ls = logStatus(logPath, { preregCommit: prereg.commit, revision, round });
      return { run: rec, entry: runEntry(rec, ls.nextNumber, now().slice(0, 10)), conditions: gate.conditions };
    } finally {
      if (lock) store.releaseLock(db, lock);
      db.close();
    }
  }

  // The count-only pass: under the same gate the engine runs the spec and only counts come back: sessions, sweeps,
  // confirmations, usable zones, orders placed and fills. No run row, no ledger row, no trade, outcome or R figure
  // is returned, stored or printed; the trade list is discarded here.
  function countOnly({ specFile, window = 'development', round = 1 } = {}) {
    const gate = gateStatus({ specFile, window, round });
    if (!gate.ok) throw new GateError(gate.conditions);
    const win = windowOf(window);
    const name = path.basename(specFile);
    const spec = load(name);
    const db = openDb(true);
    try {
      const version = latestVersion(db);
      const inputs = loadInputs(db, version.id, INSTRUMENT, { from: win.start, to: win.end });
      const r = runSpec({ spec, daily: inputs.daily, sessions: inputs.sessions, window: win, keepSessionBars: false });
      return { spec: name, specHash: spec.hash, round, window, dataVersionId: version.id, dataHash: version.dataHash, windowDates: win, counts: countsOf(r) };
    } finally {
      db.close();
    }
  }

  // A run left "running" by a crash is marked failed with a reason; returns the log entry to append.
  function markFailed(runId, reason) {
    if (!reason || !String(reason).trim()) throw new Error('mark-failed needs a reason');
    const db = openDb(false);
    try {
      const r = store.getRun(db, runId);
      if (!r) throw new Error(`run ${runId} does not exist`);
      if (r.status !== 'running') throw new Error(`run ${runId} is ${r.status}, not running`);
      const finishedAt = now();
      store.failRun(db, runId, { finishedAt, error: `marked failed: ${reason}` });
      store.appendLedger(db, { kind: 'run', round: r.round, spec: r.spec, window: r.window, runId, dataVersionId: r.dataVersionId, note: `marked failed: ${reason}`, at: finishedAt });
      const ls = logStatus(logPath, { preregCommit: prereg.commit, revision, round: r.round });
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

  // The owner's validation row, as the gate reads it.
  function validationStatus({ specFile = null } = {}) {
    return logStatus(logPath, { preregCommit: prereg.commit, revision, specFile }).validation;
  }

  return { file, gateStatus, run, countOnly, markFailed, listRuns, validationStatus, revision, windows: RUNNABLE_WINDOWS, WINDOWS };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
