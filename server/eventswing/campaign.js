// event-swing campaign 1 (CAMPAIGN-1.md sections 9 to 11): the gate, the inventory and code-frozen records, the
// campaign and its run queue, the worker (checkpointed after every run, two hours of execution at most), the
// placebo, Holm, the selection conditions, the in-app notifications and the report. Simulation only: nothing here
// reads real holdings or cash, opens another programme's database for writing, or places or prepares an order.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig as loadAppConfig } from '../config.js';
import { loadHxrUniverse, loadHxrPeriods, basketSymbols, excludedDates } from '../hxr/config.js';
import { runMechanism } from '../research/mechanisms.js';
import { holmAdjust } from '../research/runner.js';
import { CODE_REVISION, ENGINE_VERSION, PREREG, MAX_DATE, REPORT_DIR, LOG_PATH, ROOT, EsError, loadMatrix, loadClassifier, configFor, configHash, pinStatus, isAncestor, committedSha, uncommitted, headCommit, logStatus, readLog, appendLogEntry } from './config.js';
import * as store from './store.js';
import { openHxrReadOnly, loadWindowInputs, boundedSpreadTable, halfSpreadFn } from './data.js';
import { manifestOf, dataState, buildEventSet, descriptiveOnly } from './pipeline.js';
import { delayEvents } from './events.js';
import { runConfig } from './engine.js';
import { runReport, indexFor, tStatistic } from './metrics.js';
import { eventPlaceboDrawer, spellPlaceboDrawer, mulberry32, pValue } from './placebo.js';

export const NOTIFICATION_TITLE = 'development improvement—not validated';
const VARIANTS = ['base', 'double_costs', 'delayed'];
const STALE_MS = 10 * 60 * 1000;
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

export function createEventSwing({ dataDir = null, dbFile = null, clock = () => new Date(), testOverrides = false, overrides = {} } = {}) {
  const appCfg = loadAppConfig();
  const dir = dataDir ?? appCfg.dataDir;
  const changed = Object.keys(overrides).filter((k) => overrides[k] !== undefined);
  if ((changed.length || dbFile || (dataDir && path.resolve(dataDir) !== path.resolve(appCfg.dataDir))) && !testOverrides) throw new Error(`createEventSwing: ${[...changed, dbFile ? 'dbFile' : null, dataDir ? 'dataDir' : null].filter(Boolean).join(', ')} can be changed only with testOverrides: true (tests only)`);
  const db = store.openEsDb(dbFile ?? store.esDbFile(dir));
  const matrix = overrides.matrix ?? loadMatrix();
  const classifier = overrides.classifier ?? loadClassifier();
  const logFile = overrides.logFile ?? LOG_PATH;
  const reportDir = overrides.reportDir ?? REPORT_DIR;
  const now = () => clock().toISOString();
  const today = () => now().slice(0, 10);
  let M = null, E = null;

  function market() {
    if (M) return M;
    const hdb = overrides.hxrDb ?? openHxrReadOnly(dir);
    try {
      const universe = overrides.universe ?? basketSymbols(loadHxrUniverse(), 'A').map((s) => ({ symbol: s.symbol, exchange: s.exchange, listedFrom: s.listedFrom }));
      const excluded = overrides.excluded ?? excludedDates(loadHxrPeriods()).filter((d) => d <= MAX_DATE);
      const inputs = loadWindowInputs(hdb, { universe, excluded });
      const spread = boundedSpreadTable(hdb, universe, { floorBps: matrix.shared.costs.halfSpreadFloorBps });
      const uncal = universe.filter((u) => spread.firstSampled[u.symbol] == null).map((u) => u.symbol);
      M = { inputs, spread, half: halfSpreadFn(spread), uncalibrated: uncal, index: indexFor(inputs, { startingCash: matrix.shared.portfolio.startingCash, withholdingPct: matrix.shared.dividends.withholdingPct }) };
      return M;
    } finally { if (!overrides.hxrDb) hdb.close(); }
  }
  const eventSet = () => (E ||= buildEventSet({ db, inputs: market().inputs, classifier, matrix }));

  // ---------- the gate (CAMPAIGN-1.md section 11) ----------
  function gateStatus({ forStart = true } = {}) {
    const conds = [];
    const add = (name, ok, detail) => conds.push({ name, ok: !!ok, detail });
    if (overrides.skipGit) {
      add('pinned files', true, 'skipped (tests)'); add('pre-registration commit', true, 'skipped (tests)'); add('no uncommitted change', true, 'skipped (tests)');
    } else {
      const pins = pinStatus();
      add('pinned files', pins.ok, pins.ok ? 'CAMPAIGN-1.md, classifier-v1.json and matrix-v1.json match their pins' : pins.files.filter((f) => !f.ok).map((f) => `${f.name}: ${f.problem}`).join('; '));
      const anc = isAncestor(PREREG.commit);
      const held = Object.entries(PREREG.sha256).every(([name, want]) => committedSha(PREREG.commit, `strategy/event-swing/${name}`) === want);
      add('pre-registration commit', anc && held, anc ? (held ? `${PREREG.commit.slice(0, 7)} is an ancestor of HEAD and holds the pinned files` : 'the commit does not hold the pinned files') : `${PREREG.commit.slice(0, 7)} is not an ancestor of HEAD`);
      const dirty = uncommitted();
      add('no uncommitted change', !dirty.length, dirty.length ? dirty.slice(0, 6).join('; ') : 'event-swing code and pinned documents committed');
    }
    const ds = dataState(db);
    const man = manifestOf(db);
    add('event data complete', ds.complete, ds.last ? `last download ${ds.last.status} (${ds.last.finishedAt}); ${man.filings} filings, ${man.documents} exhibits; manifest ${man.hash.slice(0, 12)}${ds.last.problems.length ? `; problems: ${ds.last.problems.slice(0, 3).join(' | ')}` : ''}` : 'no event data: run npm run es:download (needs SEC_CONTACT_EMAIL in .env)');
    let mk = null;
    if (ds.complete) { try { mk = market(); add('market data', !mk.uncalibrated.length, mk.uncalibrated.length ? `no spread calibration for ${mk.uncalibrated.join(', ')}` : `HXR bars ${mk.inputs.sessions[0]} to ${mk.inputs.sessions.at(-1)}, inputs ${mk.inputs.inputsHash.slice(0, 12)}`); } catch (e) { add('market data', false, e.message); } }
    else add('market data', false, 'not checked until the event data is complete');
    const log = logStatus(readLog(logFile));
    add('event inventory recorded', log.inventory.length >= 1, log.inventory.length ? `log entry ${log.inventory.at(-1)}` : 'no **Event inventory** entry: run npm run es:inventory -- --record');
    const frozen = log.frozen.filter((f) => f.codeRevision === CODE_REVISION && f.commit === PREREG.commit && f.manifest === man.hash);
    add('code frozen for campaign 1', frozen.length === 1, frozen.length === 1 ? `log entry ${frozen[0].number}` : `${frozen.length} entries name ${CODE_REVISION}, ${PREREG.commit.slice(0, 7)} and manifest ${man.hash.slice(0, 12)}: run npm run es:freeze -- --record`);
    const loggedIds = new Set(log.runs.map((r) => r.runId));
    const unlogged = store.listCampaigns(db).flatMap((c) => store.listRuns(db, c.id)).filter((r) => (r.status === 'done' || r.status === 'failed') && !loggedIds.has(r.id));
    add('every recorded run logged', !unlogged.length, unlogged.length ? `runs ${unlogged.map((r) => r.id).join(', ')} are not in the log` : 'yes');
    const holder = store.lockHolder(db);
    const stale = holder ? Date.parse(now()) - Date.parse(holder.heartbeat_at) >= STALE_MS : true;
    add('lock free', !holder || stale, holder && !stale ? `held by pid ${holder.pid} since ${holder.taken_at}` : 'free');
    let free = null;
    try { const st = fs.statfsSync(dir); free = st.bavail * st.bsize; } catch { /* unknown */ }
    add('disk space', free == null || free >= 1e9, free == null ? 'unknown' : `${(free / 1e9).toFixed(1)} GB free`);
    return { ok: conds.every((c) => c.ok), conditions: conds, manifest: man, codeRevision: CODE_REVISION, preregCommit: PREREG.commit, forStart };
  }

  // ---------- the inventory and the code-frozen record ----------
  function inventory() {
    const ds = dataState(db);
    if (!ds.complete) throw new EsError(409, 'The event data is not complete: no inventory. Run npm run es:download first (it needs SEC_CONTACT_EMAIL in .env).');
    const es = eventSet();
    const man = manifestOf(db);
    return { manifest: man, inventory: es.inventory, descriptive: descriptiveOnly(matrix, es.inventory), excluded: es.excluded.length, inputsHash: market().inputs.inputsHash, calibrationHash: market().spread.hash };
  }
  function recordInventory() {
    const st = logStatus(readLog(logFile));
    if (st.inventory.length) throw new EsError(409, `the event inventory is already recorded (log entry ${st.inventory[0]})`);
    const inv = inventory();
    const body = inventoryMarkdown(inv);
    return appendLogEntry({ title: '**Event inventory** (counts only, before any configuration runs; no strategy outcome computed)', body, date: today(), file: logFile });
  }
  function freezeEntry() {
    const g = gateStatus();
    const need = ['pinned files', 'pre-registration commit', 'no uncommitted change', 'event data complete', 'market data', 'event inventory recorded'];
    const bad = g.conditions.filter((c) => need.includes(c.name) && !c.ok);
    if (bad.length) throw new EsError(409, `cannot freeze: ${bad.map((c) => `${c.name} (${c.detail})`).join('; ')}`);
    const mk = market();
    const body = `code revision: \`${CODE_REVISION}\`; engine \`${ENGINE_VERSION}\`; pre-registration commit: \`${PREREG.commit}\`; HEAD \`${overrides.skipGit ? 'tests' : headCommit()}\`; data manifest hash: \`${g.manifest.hash}\`; inputs hash \`${mk.inputs.inputsHash}\`; calibration hash \`${mk.spread.hash}\` (samples on or before ${MAX_DATE}); matrix \`${PREREG.sha256['matrix-v1.json']}\`; classifier \`${PREREG.sha256['classifier-v1.json']}\`; CAMPAIGN-1.md \`${PREREG.sha256['CAMPAIGN-1.md']}\`. Implementation ends here; execution time is measured from the campaign's first start.`;
    return appendLogEntry({ title: '**Code frozen for campaign 1**', body, date: today(), file: logFile });
  }

  // ---------- the campaign ----------
  function createCampaign() {
    const g = gateStatus();
    if (!g.ok) throw new EsError(409, `The gate is closed: ${g.conditions.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ')}`);
    if (store.listCampaigns(db).length) throw new EsError(409, 'campaign 1 already exists; a new campaign needs a new document');
    const mk = market(), es = eventSet();
    const id = store.insertCampaign(db, { codeRevision: CODE_REVISION, engineVersion: ENGINE_VERSION, preregCommit: PREREG.commit, headCommit: overrides.skipGit ? null : headCommit(), pins: PREREG.sha256, manifestHash: g.manifest.hash, inputsHash: mk.inputs.inputsHash, calibrationHash: mk.spread.hash, inventory: { ...es.inventory, descriptive: descriptiveOnly(matrix, es.inventory) }, createdAt: now() });
    let ordinal = 0;
    const items = [];
    for (const c of matrix.configurations) for (const v of VARIANTS) items.push({ ordinal: ordinal++, configId: c.id, variant: v, configHash: configHash(configFor(matrix, c.id)) });
    store.enqueueRuns(db, id, items, now());
    store.logEvent(db, { campaignId: id, message: `campaign created: ${items.length} runs queued (${matrix.configurations.length} configurations x ${VARIANTS.length})`, at: now() });
    return store.getCampaign(db, id);
  }

  function eventsFor(cfg, variant) {
    const es = eventSet(), ss = market().inputs.stockSessions;
    const base = cfg.kind === 'sleeves' ? [...es.placed, ...es.sleeveOnly] : es.placed;
    const extra = matrix.sensitivities.delayedEvents.extraSessions;
    return { events: variant === 'delayed' ? delayEvents(base, ss, extra) : base, prewindow: cfg.kind === 'sleeves' ? es.prewindow : [] };
  }
  function execute(cfg, variant, { events = null, forcedSpells = null } = {}) {
    const mk = market();
    const ev = events ? { events, prewindow: [] } : eventsFor(cfg, variant);
    const costMultiplier = variant === 'double_costs' ? matrix.sensitivities.doubleCosts.costMultiplier : 1;
    return runConfig({ config: cfg, inputs: mk.inputs, events: ev.events, prewindow: forcedSpells ? [] : ev.prewindow, halfSpreadBps: mk.half, costMultiplier, forcedSpells });
  }
  function runOne(run) {
    const cfg = configFor(matrix, run.configId);
    if (configHash(cfg) !== run.configHash) throw new EsError(500, `configuration ${run.configId} changed since it was queued`);
    const mk = market(), es = eventSet();
    const result = execute(cfg, run.variant);
    const { report } = runReport(result, { inputs: mk.inputs, index: mk.index, config: cfg, realEvents: [...es.placed, ...es.sleeveOnly, ...es.prewindow] });
    return { report, variant: run.variant, configHash: run.configHash, inputsHash: mk.inputs.inputsHash, calibrationHash: mk.spread.hash, codeRevision: CODE_REVISION, engineVersion: ENGINE_VERSION, simulated: true };
  }

  async function runWorker({ campaignId, maxExecutionMs = matrix.budget.maxExecutionHours * 3600_000, log = () => {} } = {}) {
    const c0 = store.getCampaign(db, campaignId);
    if (!c0) throw new EsError(404, `campaign ${campaignId} does not exist`);
    const token = crypto.randomBytes(8).toString('hex');
    const lock = store.takeLock(db, { token, at: now(), staleMs: STALE_MS });
    if (!lock.ok) throw new EsError(409, `another event-swing worker holds the lock (pid ${lock.holder.pid})`);
    const sessionStart = Date.parse(now());
    try {
      const failedInterrupted = store.requeueInterrupted(db, campaignId);
      if (failedInterrupted) { store.logEvent(db, { campaignId, level: 'warn', message: `${failedInterrupted} interrupted run(s) marked failed`, at: now() }); for (const r of store.listRuns(db, campaignId).filter((x) => x.status === 'failed' && /interrupted/.test(x.error || ''))) logRun(r); }
      store.updateCampaign(db, campaignId, { status: 'running', startedAt: c0.startedAt ?? now(), workerToken: token, workerPid: process.pid, heartbeatAt: now() });
      const elapsed = () => store.getCampaign(db, campaignId).elapsedMs;
      for (;;) {
        if (elapsed() >= maxExecutionMs) return stop(campaignId, `the execution budget of ${maxExecutionMs / 3600_000} hours is used; checkpointed after the last finished run`);
        const run = store.claimNextRun(db, campaignId, token, now());
        if (!run) break;
        const t0 = Date.now();
        try {
          const summary = runOne(run);
          store.finishRun(db, run.id, { status: 'done', summary, at: now(), durationMs: Date.now() - t0, codeRevision: CODE_REVISION });
          log(`run ${run.id} ${run.configId} ${run.variant}: net ${summary.report.net}, T ${summary.report.T}`);
        } catch (e) {
          store.finishRun(db, run.id, { status: 'failed', error: String(e.stack || e.message).slice(0, 4000), at: now(), durationMs: Date.now() - t0, codeRevision: CODE_REVISION });
          log(`run ${run.id} ${run.configId} ${run.variant} failed: ${e.message}`);
        }
        store.updateCampaign(db, campaignId, { elapsedMs: elapsed() + (Date.now() - t0), heartbeatAt: now() });
        store.beatLock(db, token, now());
        logRun(store.getRun(db, run.id));
      }
      const placeboDone = await placeboPhase(campaignId, { maxExecutionMs, log, token });
      if (!placeboDone) return store.getCampaign(db, campaignId);
      return finish(campaignId);
    } finally {
      store.updateCampaign(db, campaignId, { workerToken: null, workerPid: null });
      store.releaseLock(db, token);
      void sessionStart;
    }
  }
  function stop(campaignId, reason) {
    store.updateCampaign(db, campaignId, { status: 'stopped', stopReason: reason });
    store.logEvent(db, { campaignId, level: 'warn', message: reason, at: now() });
    return store.getCampaign(db, campaignId);
  }
  function logRun(r) {
    appendLogEntry({ title: `**Run** run id: ${r.id}, config: ${r.configId}, config hash: ${r.configHash}, status: ${r.status}; variant: ${r.variant}`, body: r.status === 'done' ? `net ${r.summary.report.net} US$; T (net minus the exposure-matched hold) ${r.summary.report.T}; completed trades ${r.summary.report.completedTrades}; code revision ${CODE_REVISION}. A development result on previously examined prices.` : `failed: ${(r.error || '').split('\n')[0]}`, date: today(), file: logFile });
  }

  function baseRuns(campaignId) {
    const out = {};
    for (const r of store.listRuns(db, campaignId)) if (r.status === 'done' && !out[`${r.configId}:${r.variant}`]) out[`${r.configId}:${r.variant}`] = r;
    return out;
  }
  // The placebo for the Holm family, one stream in matrix order; a configuration already done replays its draws.
  async function placeboPhase(campaignId, { maxExecutionMs, log, token }) {
    const inf = matrix.inference, mk = market(), es = eventSet();
    const desc = descriptiveOnly(matrix, es.inventory);
    const runs = baseRuns(campaignId);
    const done = new Map(store.listPlacebo(db, campaignId).map((p) => [p.configId, p]));
    const rng = mulberry32(inf.seed);
    const start = matrix.shared.portfolio.startingCash;
    for (const id of matrix.holmFamily) {
      const cfg = configFor(matrix, id);
      const base = runs[`${id}:base`];
      const skip = desc[id]?.descriptiveOnly ? 'descriptive only' : !base ? 'the base run did not finish' : null;
      if (skip) { if (!done.has(id)) store.insertPlacebo(db, { campaignId, configId: id, resamples: 0, seed: inf.seed, tObs: null, countGe: null, p: null, failed: 0, unclustered: 0, durationMs: 0, details: { skipped: skip } }, now()); continue; }
      let drawer, realT;
      const t0 = Date.now();
      if (cfg.kind === 'sleeves') {
        const result = execute(cfg, 'base');
        realT = tStatistic(result, mk.index, start);
        const spells = [...(result.spells || []).map((s) => ({ symbol: s.symbol, x: s.exitFill, y: s.reentryDecision })), ...(result.openSpells || []).filter((s) => s.exitFill).map((s) => ({ symbol: s.symbol, x: s.exitFill, y: mk.inputs.stockSessions[s.symbol].at(-1) }))];
        drawer = spellPlaceboDrawer({ spells, realEvents: [...es.placed, ...es.sleeveOnly], stockSessions: mk.inputs.stockSessions, calendar: mk.inputs.sessions, buffer: inf.spellBufferSessions, maxRedraws: inf.maxRedraws });
      } else {
        realT = tStatistic(execute(cfg, 'base'), mk.index, start);
        drawer = eventPlaceboDrawer({ events: es.placed, stockSessions: mk.inputs.stockSessions, buffer: inf.eligibleBufferSessions, minPrior: inf.minPriorCloses, maxRedraws: inf.maxRedraws });
      }
      if (done.has(id)) { for (let r = 0; r < inf.resamples; r++) drawer.draw(rng); continue; }
      let countGe = 0, failed = 0, unclustered = 0;
      for (let r = 0; r < inf.resamples; r++) {
        const d = drawer.draw(rng);
        unclustered += d.unclustered;
        if (d.failed) { failed++; countGe++; continue; }
        const res = cfg.kind === 'sleeves' ? execute(cfg, 'base', { events: [], forcedSpells: d.forced }) : execute(cfg, 'base', { events: d.events });
        if (tStatistic(res, mk.index, start) >= realT - 1e-9) countGe++;
        if (r % 50 === 49) {
          const used = store.getCampaign(db, campaignId).elapsedMs + (Date.now() - t0);
          if (used >= maxExecutionMs) { store.updateCampaign(db, campaignId, { elapsedMs: used }); stop(campaignId, `the execution budget of ${maxExecutionMs / 3600_000} hours is used during the placebo of ${id}; that placebo is not stored and reruns from its start`); return false; }
          store.beatLock(db, token, now());
        }
      }
      const p = pValue(countGe, inf.resamples);
      const durationMs = Date.now() - t0;
      store.insertPlacebo(db, { campaignId, configId: id, resamples: inf.resamples, seed: inf.seed, tObs: realT, countGe, p, failed, unclustered, durationMs, details: { clusters: drawer.clusters, multiStockClusters: drawer.multiStockClusters, clustersWithoutCommonDate: drawer.clustersWithoutCommonDate, failedCountAsAtLeast: true } }, now());
      store.updateCampaign(db, campaignId, { elapsedMs: store.getCampaign(db, campaignId).elapsedMs + durationMs, heartbeatAt: now() });
      log(`placebo ${id}: T ${r2(realT)}, p ${p.toFixed(4)} (${failed} failed resamples)`);
      await new Promise((r) => setImmediate(r));
    }
    return true;
  }

  // ---------- selection (CAMPAIGN-1.md section 10), Holm, notifications, the report ----------
  function evaluate(campaignId) {
    const runs = baseRuns(campaignId);
    const rep = (id, v = 'base') => runs[`${id}:${v}`]?.summary?.report ?? null;
    const placebo = new Map(store.listPlacebo(db, campaignId).map((p) => [p.configId, p]));
    const desc = descriptiveOnly(matrix, store.getCampaign(db, campaignId).inventory);
    const holm = holmAdjust(matrix.holmFamily.map((id, i) => ({ id: i, p: placebo.get(id)?.p ?? null })), { m: matrix.holmFamily.length, alpha: matrix.inference.alpha });
    const sel = matrix.selection;
    const out = {};
    matrix.holmFamily.forEach((id, i) => {
      const cfg = configFor(matrix, id), r = rep(id), cmp = matrix.comparators[id];
      const b = rep(cmp.baseline), ctl = cmp.control ? rep(cmp.control) : null;
      const h = holm.get(i);
      const c = {};
      const isA = cfg.family === 'A';
      c.sample = { ok: !!r && !desc[id]?.descriptiveOnly && (isA ? (r.familyA?.spells ?? 0) : r.completedTrades) >= sel.minCompletedTrades, value: r ? (isA ? r.familyA?.spells : r.completedTrades) : null, limit: `not descriptive only (${desc[id]?.events ?? '?'} events in ${desc[id]?.category}); at least ${sel.minCompletedTrades} ${isA ? 'completed exit spells' : 'completed trades'}` };
      c.comparators = { ok: !!r && !!b && r.net > b.net && (!ctl || r.net > ctl.net), value: r ? { net: r.net, baseline: b?.net ?? null, control: ctl?.net ?? null } : null, limit: `net above ${cmp.baseline}${cmp.control && cmp.control !== cmp.baseline ? ` and ${cmp.control}` : ''}` };
      const tD = rep(id, 'double_costs')?.T, tL = rep(id, 'delayed')?.T;
      c.decisionGain = { ok: !!r && r.T > 0 && tD > 0 && tL > 0, value: { base: r?.T ?? null, doubleCosts: tD ?? null, delayed: tL ?? null }, limit: 'T > 0 at the base case, double costs and the one-session delay' };
      c.drawdown = { ok: !!r && (isA ? r.maxDrawdownPct <= (rep('A0')?.maxDrawdownPct ?? -Infinity) : r.maxDrawdownPct <= sel.maxDrawdownPct), value: r?.maxDrawdownPct ?? null, limit: isA ? `no deeper than A0's ${rep('A0')?.maxDrawdownPct}%` : `at most ${sel.maxDrawdownPct}%` };
      c.stress = { ok: !!r && (isA ? r.familyA?.bestFive?.adjusted > 0 : !!b && r.bestFive.adjustedNet > b.net), value: r ? (isA ? r.familyA?.bestFive?.adjusted : r.bestFive.adjustedNet) : null, limit: isA ? 'summed spell effects without the best 5% still positive' : `net without the best 5% above ${cmp.baseline}'s` };
      const share = r ? (isA ? r.familyA?.topStock?.share : r.concentration.topShare) : null;
      c.concentration = { ok: share != null && share <= sel.maxTopStockShare, value: share, limit: `top stock at most ${sel.maxTopStockShare * 100}% of the gross gain` };
      c.placebo = { ok: !!h?.significant, value: { raw: placebo.get(id)?.p ?? null, holm: h?.adjustedP ?? null, skipped: placebo.get(id)?.details?.skipped ?? null }, limit: `Holm-adjusted p at most ${matrix.inference.alpha} over m = ${matrix.holmFamily.length}` };
      c.accounting = { ok: !!r && r.accounting.ok, value: r?.accounting?.difference ?? null, limit: 'the accounting reconciles' };
      const failedC = Object.entries(c).filter(([, v]) => !v.ok).map(([k]) => k);
      out[id] = { criteria: c, failed: failedC, candidate: failedC.length === 0, descriptiveOnly: !!desc[id]?.descriptiveOnly, label: cfg.label };
    });
    return out;
  }
  function finish(campaignId) {
    const ev = evaluate(campaignId);
    store.updateCampaign(db, campaignId, { holm: ev });
    const runs = baseRuns(campaignId);
    for (const id of matrix.holmFamily) {
      const r = runs[`${id}:base`]?.summary?.report, cmp = matrix.comparators[id];
      const b = runs[`${cmp.baseline}:base`]?.summary?.report, ctl = cmp.control ? runs[`${cmp.control}:base`]?.summary?.report : null;
      if (r && b && r.net > b.net && (!ctl || r.net > ctl.net)) store.insertNotification(db, { campaignId, runId: runs[`${id}:base`].id, key: `es:${campaignId}:${id}`, title: NOTIFICATION_TITLE, body: `${id} (${r.label}): net ${r.net} US$ against ${cmp.baseline} ${b.net}${ctl && cmp.control !== cmp.baseline ? ` and ${cmp.control} ${ctl.net}` : ''}. ${ev[id].candidate ? 'Meets every development condition.' : `Fails: ${ev[id].failed.join(', ')}.`} A development result on previously examined prices; not validated.`, at: now() });
    }
    store.updateCampaign(db, campaignId, { status: 'done', finishedAt: now() });
    const file = writeReport(campaignId);
    const cands = Object.entries(ev).filter(([, v]) => v.candidate).map(([k]) => k);
    appendLogEntry({ title: `**Campaign 1 complete**: ${cands.length ? `development candidate(s) ${cands.join(', ')}` : 'NONE (no development candidate)'}`, body: `Runs ${store.listRuns(db, campaignId).filter((r) => r.status === 'done').length} done, ${store.listRuns(db, campaignId).filter((r) => r.status === 'failed').length} failed; placebo for ${store.listPlacebo(db, campaignId).filter((p) => p.resamples > 0).length} configurations; execution ${(store.getCampaign(db, campaignId).elapsedMs / 60000).toFixed(1)} minutes; report \`${path.relative(ROOT, file).replace(/\\/g, '/')}\`. Development results on previously examined prices; nothing validated; no evaluation window exists for this programme.`, date: today(), file: logFile });
    return store.getCampaign(db, campaignId);
  }

  function writeReport(campaignId) {
    const c = store.getCampaign(db, campaignId);
    const runs = baseRuns(campaignId);
    const placebo = new Map(store.listPlacebo(db, campaignId).map((p) => [p.configId, p]));
    const ev = c.holm || evaluate(campaignId);
    const L = [];
    L.push('# event-swing campaign 1: results (development results on previously examined prices; simulation only)', '');
    L.push(`Campaign ${c.id}, code revision \`${c.codeRevision}\`, engine \`${c.engineVersion}\`, pre-registration \`${c.preregCommit.slice(0, 7)}\`, data manifest \`${c.manifestHash.slice(0, 12)}\`, inputs \`${c.inputsHash.slice(0, 12)}\`, calibration \`${c.calibrationHash.slice(0, 12)}\`. Execution ${(c.elapsedMs / 60000).toFixed(1)} minutes. Every figure is **measured** from the simulation unless marked derived; the index and the exposure-matched hold are **derived** benchmarks. Nothing here is evidence of future profit.`, '');
    L.push('## Event inventory', '', inventoryMarkdown({ inventory: c.inventory, descriptive: c.inventory.descriptive, manifest: { hash: c.manifestHash } }), '');
    L.push('## Every configuration (base case) against its benchmarks', '', '| Id | Label | Net US$ | Ann. % | Max DD % | Invested % | Trades | Costs | Index net | Exposure-matched net | T | Double costs T | Delayed T |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const cfg of matrix.configurations) {
      const r = runs[`${cfg.id}:base`]?.summary?.report;
      if (!r) { L.push(`| ${cfg.id} | ${cfg.label} | failed or not run | | | | | | | | | | |`); continue; }
      L.push(`| ${cfg.id} | ${cfg.label} | ${r.net} | ${r.annualisedReturnPct} | ${r.maxDrawdownPct} | ${r.avgInvestedPct} | ${cfg.family === 'A' ? `${r.familyA?.spells ?? 0} spells` : r.completedTrades} | ${r.costs} | ${r.index.net} | ${r.exposureMatched.net} | ${r.T} | ${runs[`${cfg.id}:double_costs`]?.summary?.report?.T ?? '—'} | ${runs[`${cfg.id}:delayed`]?.summary?.report?.T ?? '—'} |`);
    }
    L.push('', '## The Holm family: placebo and selection', '', '| Id | Raw p | Holm p | Failed resamples | Candidate | Fails |', '|---|---|---|---|---|---|');
    for (const id of matrix.holmFamily) {
      const p = placebo.get(id), e = ev[id];
      L.push(`| ${id} | ${p?.p != null ? p.p.toFixed(4) : (p?.details?.skipped ?? '—')} | ${e?.criteria?.placebo?.value?.holm != null ? e.criteria.placebo.value.holm.toFixed(4) : '—'} | ${p?.failed ?? '—'} | ${e?.candidate ? 'yes' : 'no'} | ${(e?.failed || []).join(', ')} |`);
    }
    const cands = Object.entries(ev).filter(([, v]) => v.candidate).map(([k]) => k);
    L.push('', `**Outcome:** ${cands.length ? `development candidate(s): ${cands.join(', ')} (each needs the owner's separate decision; none is validated)` : '**NONE**: no configuration meets every condition of CAMPAIGN-1.md section 10.'}`, '');
    L.push('## Does the news information add anything?', '', 'Compared on net profit and T at the base case: B2 and B3 (guidance words) against B1 (timing and prices only) and BP (prices only); C2 against C1 and CP; D1 against D2, D3 and D0. The guidance classes come from the fixed word rule of CAMPAIGN-1.md section 4 and nothing else.', '');
    L.push('| Pair | Net (news) | Net (calendar) | Net (price-only) | T (news) | T (calendar) | T (price-only) |', '|---|---|---|---|---|---|---|');
    for (const [news, cal, price] of [['B2', 'B1', 'BP'], ['B3', 'B1', 'BP'], ['C2', 'C1', 'CP'], ['D1', 'D2', 'D0']]) {
      const n = runs[`${news}:base`]?.summary?.report, k = runs[`${cal}:base`]?.summary?.report, p = runs[`${price}:base`]?.summary?.report;
      L.push(`| ${news} / ${cal} / ${price} | ${n?.net ?? '—'} | ${k?.net ?? '—'} | ${p?.net ?? '—'} | ${n?.T ?? '—'} | ${k?.T ?? '—'} | ${p?.T ?? '—'} |`);
    }
    L.push('', '## Per configuration detail', '');
    for (const cfg of matrix.configurations) {
      const r = runs[`${cfg.id}:base`]?.summary?.report;
      if (!r) continue;
      L.push(`### ${cfg.id} (${cfg.family}, ${cfg.role}, ${cfg.label})`, '');
      L.push(`Annual net (US$): ${Object.entries(r.annual).map(([y, v]) => `${y} ${v.net}`).join('; ')}. Halves: ${r.halves.map((h) => `${h.from} to ${h.to} net ${h.net}, decision gain ${h.decisionGain}`).join('; ')}.`);
      L.push(`Per stock (US$): ${Object.entries(r.perStock).map(([s, v]) => `${s} ${v.pnl}`).join('; ')}. Top stock ${r.concentration.topStock ?? '—'} ${r.concentration.topShare != null ? `${(r.concentration.topShare * 100).toFixed(1)}%` : ''} of the gross gain. Best-5% removal: ${r.bestFive.K} outcomes, net without them ${r.bestFive.adjustedNet}.`);
      L.push(`Exits: ${JSON.stringify(r.exits)}. Not filled: ${JSON.stringify(r.notFilled)}. Holding sessions (median, longest): ${r.holdingSessions?.median ?? '—'}, ${r.holdingSessions?.longest ?? '—'}. Turnover per year ${r.turnoverPerYear}. Accounting ${r.accounting.ok ? 'reconciles' : `does not reconcile: ${r.accounting.problems.join('; ')}`}.`);
      if (r.byCategory) L.push(`By category: ${JSON.stringify(r.byCategory)}.`);
      if (r.triggerFates) L.push(`Trigger fates: ${JSON.stringify(r.triggerFates)}.`);
      if (r.pauses) L.push(`Pauses: ${JSON.stringify(r.pauses)}.`);
      if (r.familyA) L.push(`Family A: estimates ${JSON.stringify(r.familyA.estimates)}; spells ${r.familyA.spells}, holding would have won ${r.familyA.holdingWouldHaveWon}, decline avoided ${r.familyA.avoidedDecline}; summed effect ${r.familyA.sumEffect} (gains ${r.familyA.sumGains}, losses ${r.familyA.sumLosses}); per stock ${JSON.stringify(r.familyA.perStockEffect)}.`);
      L.push('');
    }
    L.push('## Limitations', '', 'One hand-picked basket of ten survivors (DATA-INVENTORY.md section 4); prices examined by 151 earlier runs; a crude fixed word rule for guidance; no expectations, no reported figures, no pre-announcement calendar, no elections or policy events (unsupported); acceptance times are upper bounds on when news was public, so every event is placed at or after the market saw it; costs are modelled, not verified fills; the placebo has little power with ten stocks and six years. Attribution between exposure and decisions is descriptive.', '');
    fs.mkdirSync(reportDir, { recursive: true });
    const file = path.join(reportDir, `campaign-${campaignId}.md`);
    fs.writeFileSync(file, `${L.join('\n')}\n`, 'utf8');
    return file;
  }

  function status() {
    const cs = store.listCampaigns(db);
    const c = cs[0] ?? null;
    return { simulated: true, data: dataState(db), manifest: manifestOf(db), campaign: c, runs: c ? store.listRuns(db, c.id).map((r) => ({ id: r.id, configId: r.configId, variant: r.variant, status: r.status, durationMs: r.durationMs, net: r.summary?.report?.net ?? null, T: r.summary?.report?.T ?? null, trades: r.summary?.report?.completedTrades ?? null, error: r.error ? r.error.split('\n')[0] : null })) : [], placebo: c ? store.listPlacebo(db, c.id) : [], notifications: store.listNotifications(db, { limit: 50 }), log: c ? store.listLog(db, c.id, 50) : [] };
  }

  return { db, matrix, classifier, gateStatus, inventory, recordInventory, freezeEntry, createCampaign, runWorker, evaluate, writeReport, status, market, eventSet, execute, markSeen: (ids) => store.markSeen(db, ids, now()), close: () => { try { db.close(); } catch { /* closed */ } } };
}

export function inventoryMarkdown({ inventory: inv, descriptive, manifest }) {
  const L = [];
  L.push(`Data manifest \`${manifest.hash}\`. Usable events: ${inv.total.usable} (availability ${inv.usableRange?.first ?? '—'} to ${inv.usableRange?.last ?? '—'}); events before the window used for estimates only: ${inv.total.prewindow}; excluded: ${JSON.stringify(inv.total.excluded)}. Dependence: ${inv.dependence.distinctAvailabilityDates} distinct availability dates, ${inv.dependence.datesWithSeveralStocks} shared by several stocks, at most ${inv.dependence.largestSameDateGroup} on one date.`, '');
  L.push('| Stock | First price session | Events | Usable | Negative | Positive | Neutral | Raised | Lowered | Reaffirmed | Mixed | None detected | No text | Interim | Estimates in window |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [s, v] of Object.entries(inv.perStock)) L.push(`| ${s} | ${inv.stockFirstSessions?.[s] ?? '—'} | ${v.events} | ${v.usable} | ${v.reaction.negative} | ${v.reaction.positive} | ${v.reaction.neutral} | ${v.guidance.raised || 0} | ${v.guidance.lowered || 0} | ${v.guidance.reaffirmed || 0} | ${v.guidance.mixed || 0} | ${v.guidance.none_detected || 0} | ${v.guidance.no_text || 0} | ${v.interim} | ${v.estimatesInWindow} |`);
  L.push('', `Timing classes (all stocks): ${JSON.stringify(inv.total.timing)}.`, '');
  L.push('| Configuration | Category | Events | Descriptive only (< 20) |', '|---|---|---|---|');
  for (const [id, d] of Object.entries(descriptive || {})) L.push(`| ${id} | ${d.category} | ${d.events} | ${d.descriptiveOnly ? 'yes' : 'no'} |`);
  return L.join('\n');
}

// ---------- the reproduction check: D0 against campaign 3's M1 n=3 (experiment 191), read-only ----------
// The D0 rule with no pause, on the window's bounded inputs and campaign 3's period (trading from 2017-10-02), must
// reproduce rr-mech-1's run of experiment 191's stored configuration and its stored net, to the cent.
export function reproduceD0({ dataDir = loadAppConfig().dataDir, matrix = loadMatrix() } = {}) {
  const rrFile = path.join(dataDir, 'research-runner.sqlite');
  const before = fs.existsSync(rrFile) ? fs.statSync(rrFile) : null;
  if (!before) throw new EsError(409, 'research-runner.sqlite is not there: nothing to reproduce');
  const rr = new DatabaseSync(fs.realpathSync(rrFile), { readOnly: true });
  let stored;
  try { stored = rr.prepare('SELECT id, config_json, summary_json FROM rr_experiments WHERE id = 191').get(); } finally { rr.close(); }
  if (!stored) throw new EsError(409, 'experiment 191 is not stored');
  const cfg191 = JSON.parse(stored.config_json), net191 = JSON.parse(stored.summary_json).net;
  const hdb = openHxrReadOnly(dataDir);
  let inputs, spread;
  try {
    const universe = basketSymbols(loadHxrUniverse(), 'A').map((s) => ({ symbol: s.symbol, exchange: s.exchange, listedFrom: s.listedFrom }));
    inputs = loadWindowInputs(hdb, { universe, excluded: excludedDates(loadHxrPeriods()).filter((d) => d <= MAX_DATE) });
    spread = boundedSpreadTable(hdb, universe, { floorBps: 2 });
  } finally { hdb.close(); }
  const half = halfSpreadFn(spread);
  const period = { warmupFrom: cfg191.period.warmupFrom, start: cfg191.period.start, end: cfg191.period.end };
  const es = runConfig({ config: configFor(matrix, 'D0'), inputs, events: [], halfSpreadBps: half, period });
  const mech = runMechanism({ config: cfg191, symbols: inputs.symbols, sessions: inputs.sessions, days: inputs.days, halfSpreadBps: half });
  const netOf = (r) => r.equity.at(-1).equity - 15000;
  const after = fs.statSync(rrFile);
  const tradesEqual = es.trades.length === mech.trades.length && es.trades.every((t, i) => t.symbol === mech.trades[i].symbol && t.entryDate === mech.trades[i].entryDate && t.exitDate === mech.trades[i].exitDate && t.shares === mech.trades[i].shares && Math.abs(t.pnl - mech.trades[i].pnl) < 1e-6);
  return {
    eventSwingNet: r2(netOf(es)), rrMech1Net: r2(netOf(mech)), storedNet: net191, trades: es.trades.length, fills: es.fills.length, tradesEqual,
    reproduces: tradesEqual && r2(netOf(es)) === r2(netOf(mech)) && r2(netOf(es)) === r2(net191),
    researchDbUnchanged: before.size === after.size && before.mtimeMs === after.mtimeMs, period,
  };
}
