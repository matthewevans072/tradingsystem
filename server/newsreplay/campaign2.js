// news-replay campaign 2 (CAMPAIGN-2.md, matrix-2.json): the AMT exits on campaign 1's D-C entry. Built on campaign 1's
// object (the same bounded data, the same stored D plans re-verified, the same evaluation pass) so campaign 1's code
// paths stay as they ran. X1 must reproduce campaign 1's D-C base run to the cent before X2 to X4 run. Gate, freeze,
// runs, the date-clustered placebo (seed 20261108) and Holm over E1 to E3. Simulation only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { holmAdjust } from '../research/runner.js';
import { MATRIX2_PATH, CODE_REVISION_2, ENGINE_VERSION_2, PREREG2, COMMITTED_PATHS_2, NrError, hashOf, readLog, logStatus, appendLogEntry, isAncestor, committedSha, uncommitted, headCommit, textSha256, LOG_PATH } from './config.js';
import * as store from './store.js';
import { runReplay, activationOf } from './sim.js';
import { indexFor, tOf, report as runReport, planFates } from './evaluate.js';
import { groupPlaceboDrawer, mulberry32, pValue } from './placebo.js';

const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
export const X_IDS = Object.freeze(['X1', 'X2', 'X3', 'X4']);

export function createCampaign2(nr, { matrix2 = null, logFile = LOG_PATH, clock = () => new Date(), skipGit = false } = {}) {
  const m2 = matrix2 ?? JSON.parse(fs.readFileSync(MATRIX2_PATH, 'utf8'));
  const { db, matrix } = nr;
  const now = () => clock().toISOString();
  const today = () => now().slice(0, 10);
  const exitOf = (id) => { const c = m2.configurations.find((x) => x.id === id); if (!c) throw new NrError(400, `unknown campaign 2 configuration ${id}`); return c.exit; };
  const from = m2.replay.from, to = m2.replay.to;

  function executeX(id, plans, variant = null, { activations = null, lean = false } = {}) {
    const a = nr.assemble();
    const v = variant ? m2.sensitivities.find((s) => s.id === variant) : {};
    return runReplay({ plans, treatment: m2.basedOn.entry, market: a.market, costs: matrix.costs, portfolio: matrix.portfolio, from, to, costMultiplier: v.costMultiplier ?? 1, delay: v.delay ?? null, activations, lean, exit: exitOf(id) });
  }
  const runsOf = () => store.listRuns(db).filter((r) => X_IDS.includes(r.configId));
  const dcBase = () => store.listRuns(db).filter((r) => r.configId === m2.basedOn.configuration && r.variant === 'base' && r.status === 'done').at(-1) ?? null;

  function gateStatus() {
    const conds = [];
    const add = (name, ok, detail) => conds.push({ name, ok: !!ok, detail });
    if (skipGit) { add('pinned files', true, 'skipped (tests)'); add('campaign 2 commit', true, 'skipped (tests)'); add('no uncommitted change', true, 'skipped (tests)'); }
    else {
      const pins = Object.entries(PREREG2.sha256);
      add('pinned files', pins.every(([f, want]) => textSha256(fs.readFileSync(path.join(path.dirname(MATRIX2_PATH), f), 'utf8')) === want), `${pins.length} files pinned`);
      add('campaign 2 commit', isAncestor(PREREG2.commit) && pins.every(([f, want]) => committedSha(PREREG2.commit, `strategy/news-replay/${f}`) === want), PREREG2.commit.slice(0, 7));
      const dirty = uncommitted(COMMITTED_PATHS_2);
      add('no uncommitted change', !dirty.length, dirty.length ? dirty.slice(0, 5).join('; ') : 'committed');
    }
    const man = nr.manifest();
    add('same data as campaign 1', man.hash === m2.basedOn.dataManifest, man.hash.slice(0, 12));
    add('campaign 1 D-C base run', !!dcBase(), dcBase() ? `run ${dcBase().id}` : 'not run yet (Phase B1)');
    const log = logStatus(readLog(logFile));
    const frozen = (log.frozen2 || []).filter((f) => f.codeRevision === CODE_REVISION_2 && (skipGit || f.commit === PREREG2.commit) && f.manifest === man.hash);
    add('frozen for campaign 2', frozen.length === 1, frozen.length ? `log entry ${frozen[0].number}` : `no entry names ${CODE_REVISION_2}`);
    const logged = new Set((log.runs2 || []).map((r) => r.runId));
    const unlogged = runsOf().filter((r) => r.status !== 'running' && !logged.has(r.id));
    add('every run logged', !unlogged.length, unlogged.length ? `runs ${unlogged.map((r) => r.id).join(', ')}` : 'yes');
    return { ok: conds.every((c) => c.ok), conditions: conds, manifest: man };
  }
  function freeze() {
    const g = gateStatus();
    const need = ['pinned files', 'campaign 2 commit', 'no uncommitted change', 'same data as campaign 1', 'campaign 1 D-C base run'];
    const bad = g.conditions.filter((c) => need.includes(c.name) && !c.ok);
    if (bad.length) throw new NrError(409, `cannot freeze campaign 2: ${bad.map((c) => `${c.name} (${c.detail})`).join('; ')}`);
    if ((logStatus(readLog(logFile)).frozen2 || []).length) throw new NrError(409, 'campaign 2 is already frozen');
    return appendLogEntry({ title: '**Frozen for campaign 2**', body: `code revision: \`${CODE_REVISION_2}\`; engine \`${ENGINE_VERSION_2}\` (X1 runs nr-engine-1's path); campaign 2 commit: \`${PREREG2.commit}\`; HEAD \`${skipGit ? 'tests' : headCommit()}\`; data manifest hash: \`${g.manifest.hash}\`. Configurations and settings: CAMPAIGN-2.md and matrix-2.json as pinned. Implementation ends here.`, date: today(), file: logFile });
  }

  // X1 against campaign 1's D-C base run: net, completed trades and every action's kind, time, stock and price.
  function reproduction(x1Actions, x1Report) {
    const dc = dcBase();
    if (!dc) return { ok: false, detail: 'no D-C base run' };
    const a = store.listActions(db, dc.id), b = x1Actions;
    const key = (r) => `${r.ms}|${r.stock ?? ''}|${r.kind}|${r.detail.price ?? ''}|${r.detail.shares ?? ''}|${r.detail.reason ?? ''}`;
    const same = a.length === b.length && a.every((r, i) => key(r) === key(b[i]));
    const rep = dc.summary.report;
    const ok = same && r2(rep.net) === r2(x1Report.net) && rep.completedTrades === x1Report.completedTrades;
    return { ok, detail: `D-C run ${dc.id}: net ${rep.net}, trades ${rep.completedTrades}, ${a.length} actions; X1: net ${x1Report.net}, trades ${x1Report.completedTrades}, ${b.length} actions${same ? '' : '; the actions differ'}` };
  }
  function exitSummary(actions, id) {
    const buys = actions.filter((x) => x.kind === 'buy');
    const src = {};
    // The targets set at the fill (X3 only): primary, composite, or none (no bin above the fill, or no prior profile).
    if (exitOf(id) === 'target') for (const b of buys) { const s = b.detail.exitPlan?.source ?? 'none'; src[s] = (src[s] || 0) + 1; }
    const sells = actions.filter((x) => x.kind === 'sell').reduce((o, x) => { o[x.detail.reason] = (o[x.detail.reason] || 0) + 1; return o; }, {});
    return { targetsSet: src, sells };
  }

  function runAll({ log = () => {}, maxMs = m2.budget.executionHours * 3600_000 } = {}) {
    const g = gateStatus();
    if (!g.ok) throw new NrError(409, `The campaign 2 gate is closed: ${g.conditions.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ')}`);
    const token = crypto.randomBytes(8).toString('hex');
    if (!store.takeLock(db, { token, at: now(), staleMs: 600000 }).ok) throw new NrError(409, 'another news-replay worker holds the lock');
    const t0 = Date.now();
    try {
      const plans = nr.storedPlans('D');
      const a = nr.assemble();
      const metaPlans = { entryPlans: plans.filter((p) => !p.followUp).length, followUps: plans.filter((p) => p.followUp).length };
      for (const id of X_IDS) for (const variant of [null, ...m2.sensitivities.map((s) => s.id)]) {
        const vname = variant ?? 'base';
        if (runsOf().some((r) => r.configId === id && r.variant === vname && r.status === 'done')) continue;
        if (id !== 'X1' && !runsOf().some((r) => r.configId === 'X1' && r.variant === 'base' && r.status === 'done' && r.summary?.reproduction?.ok)) throw new NrError(409, 'X1 has not reproduced D-C: X2 to X4 do not run');
        const runId = store.startRun(db, { configId: id, variant: vname, configHash: hashOf({ c: m2.configurations.find((x) => x.id === id), settings: { thirty: m2.thirtyMinuteBars, acceptance: m2.acceptance, target: m2.target, priceOnly: m2.priceOnly, precedence: m2.exitPrecedence }, basedOn: m2.basedOn, matrix: { portfolio: matrix.portfolio, costs: matrix.costs }, variant: vname }), codeRevision: CODE_REVISION_2, manifestHash: g.manifest.hash, startedAt: now() });
        const s0 = Date.now();
        let reproFailed = false;
        try {
          const r = executeX(id, plans, variant);
          store.insertActions(db, runId, [...r.actions].map((x, i) => ({ ...x, _i: i })).sort((x, y) => x.ms - y.ms || x._i - y._i).map(({ _i, ...x }) => x));
          const saved = store.listActions(db, runId);
          const result = nr.evaluate(saved);
          const rep = runReport(result, { index: a.index, startingCash: matrix.portfolio.startingCash, signals: r.signals, plansMeta: metaPlans });
          rep.planFates = planFates(saved, result.trades, result.openPositions, new Map(plans.map((p) => [p.id, p.category ?? 'unknown'])));
          rep.exitSummary = exitSummary(saved, id);
          const summary = { report: rep, engine: r.engine };
          if (id === 'X1' && vname === 'base') { summary.reproduction = reproduction(saved, rep); reproFailed = !summary.reproduction.ok; }
          store.insertEvaluation(db, runId, { report: rep, equity: result.equity.map((p) => [p.date, r2(p.equity), Math.round(p.invested * 1e4) / 1e4]) }, now());
          store.finishRun(db, runId, { status: reproFailed ? 'failed' : 'done', summary, error: reproFailed ? `X1 does not reproduce D-C: ${summary.reproduction.detail}` : null, at: now(), durationMs: Date.now() - s0 });
          log(`run ${runId} ${id} ${vname}: net ${rep.net}, T ${rep.T}, trades ${rep.completedTrades}${summary.reproduction ? `; reproduction ${summary.reproduction.ok ? 'OK' : 'FAILED'} (${summary.reproduction.detail})` : ''}`);
        } catch (e) { store.finishRun(db, runId, { status: 'failed', error: String(e.stack || e.message).slice(0, 3000), at: now(), durationMs: Date.now() - s0 }); log(`run ${runId} ${id} ${vname} failed: ${e.message}`); }
        const run = store.getRun(db, runId);
        appendLogEntry({ title: `**Run (campaign 2)** run id: ${run.id}, config: ${run.configId}, config hash: ${run.configHash}, status: ${run.status}; variant: ${run.variant}`, body: run.status === 'done' ? `net ${run.summary.report.net} US$; T ${run.summary.report.T}; completed trades ${run.summary.report.completedTrades}; exits ${JSON.stringify(run.summary.report.exitSummary.sells)}${run.summary.reproduction ? `; reproduction of D-C: OK (${run.summary.reproduction.detail})` : ''}; exploratory (a heavily used development period).` : `failed: ${(run.error || '').split('\n')[0]}`, date: today(), file: logFile });
        if (reproFailed) throw new NrError(500, 'X1 does not reproduce campaign 1\'s D-C: campaign 2 stops as a defect');
      }
      const placebo = runPlacebo({ log, deadline: t0 + maxMs });
      return { runs: runsOf().length, placebo, elapsedMs: Date.now() - t0 };
    } finally { store.releaseLock(db, token); }
  }

  function baseT() {
    const out = {};
    for (const r of runsOf()) if (r.status === 'done' && r.variant === 'base') out[r.configId] = r.summary.report.T;
    return out;
  }
  const statOf = (cmp, T) => (T[cmp.pair[0]] != null && T[cmp.pair[1]] != null ? T[cmp.pair[0]] - T[cmp.pair[1]] : null);
  function runPlacebo({ log = () => {}, deadline = Infinity, resamples = m2.inference.resamples } = {}) {
    const ids = m2.inference.holmFamily;
    const done = new Set(store.listPlacebo(db).map((p) => p.comparison));
    const todo = ids.filter((id) => !done.has(id));
    if (!todo.length) return store.listPlacebo(db).filter((p) => ids.includes(p.comparison));
    const T0 = baseT();
    if (!X_IDS.every((id) => T0[id] != null)) { log('the campaign 2 placebo waits for every base run'); return []; }
    const x1 = runsOf().find((r) => r.configId === 'X1' && r.variant === 'base' && r.status === 'done');
    const filled = x1.summary.report.completedTrades + x1.summary.report.openAtEnd;
    if (filled < m2.inference.descriptiveBelowFilledEntries) {
      for (const id of todo) store.insertPlacebo(db, { comparison: id, resamples: 0, seed: m2.inference.seed, tObs: statOf(m2.comparisons.find((c) => c.id === id), T0), countGe: null, p: null, details: { skipped: `descriptive only (${filled} filled entries)` } }, now());
      return store.listPlacebo(db).filter((p) => ids.includes(p.comparison));
    }
    const a = nr.assemble();
    // The fast path must equal the planner on every real group before it stands in for it (as campaign 1).
    const full = nr.planSet('D', a.groups, { light: true }).map((x) => x.plan), quick = nr.fastPlans(a.groups);
    const key = (p) => [p.stock, p.session, p.T, p.status, p.followUp, p.bullish?.activation.level, p.bearish?.activation.level, p.invalidation?.level].join('|');
    const mismatch = full.length !== quick.length ? 'count' : full.findIndex((p, i) => key(p) !== key(quick[i]));
    if (mismatch === 'count' || mismatch >= 0) throw new NrError(500, `the placebo's fast plans differ from the planner's plans (at ${mismatch}): refused`);
    const drawer = groupPlaceboDrawer({ groups: a.groups, itemFree: a.itemFree, openMs: a.market.openMs, closeMs: a.market.closeMs });
    const rng = mulberry32(m2.inference.seed);
    const obs = Object.fromEntries(todo.map((id) => [id, statOf(m2.comparisons.find((c) => c.id === id), T0)]));
    const ge = Object.fromEntries(todo.map((id) => [id, 0]));
    let unclustered = 0, failedGroups = 0, n = 0;
    const start = matrix.portfolio.startingCash;
    for (let r = 0; r < resamples; r++) {
      if (Date.now() > deadline) { log(`campaign 2 placebo stopped at the execution budget after ${n} resamples`); break; }
      const d = drawer.draw(rng);
      unclustered += d.unclustered; failedGroups += d.failed;
      const pD = nr.fastPlans(d.groups);
      const acts = pD.map((p) => activationOf(p, a.market));
      const T = {};
      for (const id of X_IDS) T[id] = tOf(nr.evaluate(executeX(id, pD, null, { activations: acts, lean: true }).actions), a.index, start);
      for (const id of todo) { const s = statOf(m2.comparisons.find((c) => c.id === id), T); if (s != null && s >= obs[id] - 1e-9) ge[id]++; }
      n++;
      if (n % 100 === 0) log(`campaign 2 placebo ${n} of ${resamples}`);
    }
    for (const id of todo) store.insertPlacebo(db, { comparison: id, resamples: n, seed: m2.inference.seed, tObs: obs[id], countGe: ge[id], p: n === resamples ? pValue(ge[id], n) : null, details: { complete: n === resamples, unclusteredClusters: unclustered, groupsWithoutCandidate: failedGroups, clusters: drawer.clusters, multiStockClusters: drawer.multiStock, withoutCommonDate: drawer.withoutCommonDate } }, now());
    return store.listPlacebo(db).filter((p) => ids.includes(p.comparison));
  }
  function holm() {
    const pl = new Map(store.listPlacebo(db).map((p) => [p.comparison, p]));
    const fam = m2.inference.holmFamily;
    const h = holmAdjust(fam.map((id, i) => ({ id: i, p: pl.get(id)?.p ?? null })), { m: fam.length, alpha: m2.inference.alpha });
    return Object.fromEntries(fam.map((id, i) => [id, { statistic: r2(pl.get(id)?.tObs ?? null), p: pl.get(id)?.p ?? null, holmP: h.get(i).adjustedP, significant: h.get(i).significant, status: pl.get(id)?.details?.skipped ?? (pl.has(id) ? (pl.get(id).p == null ? 'incomplete' : 'tested') : 'pending: the placebo has not run yet') }]));
  }
  const reports = () => { const by = new Map(); for (const r of runsOf()) if (r.status === 'done') by.set(`${r.configId}|${r.variant}`, r.summary.report); return by; };
  return { matrix2: m2, executeX, gateStatus, freeze, runAll, runPlacebo, holm, reports, runs: runsOf, reproduction, indexFor };
}
