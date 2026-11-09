// prop-sim campaign 1 (CAMPAIGN-1.md): the bounded data, the gate, the frozen record, the eight signal runs with their
// attempts on both plans, the matched random twins (1,000 seeds each, saved one by one, so the worker resumes), the
// month-resampled test with Holm, the four plain-English answers and the report. Simulated using Lucid Trading's
// published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid. Stand-in, regular hours only, not
// futures. Simulation only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { holmAdjust, mulberry32 } from '../research/runner.js';
import { tradingDays } from '../strategy/sessions.js';
import { FROM, MAX_DATE, CODE_REVISION, ENGINE_VERSION, PREREG, PS_DIR, REPORT_DIR, LABEL, STAND_IN, PsError, loadMatrix, readLog, logStatus, logEntries, appendLogEntry, isAncestor, committedSha, uncommitted, headCommit, textSha256, LOG_PATH } from './config.js';
import * as store from './store.js';
import { buildMarket } from './market.js';
import { runSignals, randomTwin } from './signals.js';
import { runAttempts, monthCounts, summarize } from './account.js';

const r4 = (x) => Math.round(x * 10000) / 10000;
const TESTED = ['F1-NQ', 'F1-ES', 'F2-NQ', 'F2-ES', 'F3-NQ', 'F3-ES', 'LB-NQ', 'LB-ES'];

export function createPropSim({ db, matrix = loadMatrix(), clock = () => new Date(), logFile = LOG_PATH, skipGit = false, reportDir = REPORT_DIR, log = () => {} }) {
  const now = () => clock().toISOString();
  const today = () => now().slice(0, 10);
  const markets = new Map();
  function dataHash() {
    const h = crypto.createHash('sha256');
    for (const sym of Object.values(matrix.dataSource.symbols)) for (const r of store.barsFor(db, sym)) h.update(`${sym}|${r.date}|${r.minute}|${r.o}|${r.h}|${r.l}|${r.c}|${r.v}\n`);
    return h.digest('hex');
  }
  function market(mk) {
    if (!markets.has(mk)) {
      const sym = matrix.dataSource.symbols[mk];
      markets.set(mk, buildMarket(store.barsFor(db, sym), { ratio: matrix.dataSource.ratio[mk], tickPoints: matrix.dataSource.tickPoints }));
    }
    return markets.get(mk);
  }
  const dates = () => tradingDays(FROM, MAX_DATE, 'NYSE').filter((d) => market('NQ').index.has(d) && market('ES').index.has(d));
  const configOf = (id) => { const c = matrix.configurations.find((x) => x.id === id); if (!c) throw new PsError(400, `unknown configuration ${id}`); return c; };
  const tickValue = (mk) => matrix.contracts[mk].tickValue;

  function gateStatus() {
    const conds = [];
    const add = (name, ok, detail) => conds.push({ name, ok: !!ok, detail });
    if (skipGit) { add('pinned files', true, 'skipped (tests)'); add('campaign commit', true, 'skipped (tests)'); add('no uncommitted change', true, 'skipped (tests)'); }
    else {
      const pins = Object.entries(PREREG.sha256);
      add('pinned files', pins.every(([f, w]) => textSha256(fs.readFileSync(path.join(PS_DIR, f), 'utf8')) === w), `${pins.length} files`);
      add('campaign commit', isAncestor(PREREG.commit) && pins.every(([f, w]) => committedSha(PREREG.commit, `strategy/prop-sim/${f}`) === w), PREREG.commit.slice(0, 7));
      const dirty = uncommitted();
      add('no uncommitted change', !dirty.length, dirty.length ? dirty.slice(0, 4).join('; ') : 'committed');
    }
    const dls = store.listDownloads(db);
    const ok = Object.values(matrix.dataSource.symbols).every((s) => dls.some((d) => d.symbol === s && d.status === 'complete' && d.from_date <= FROM && d.to_date === MAX_DATE));
    add('data downloaded', ok, ok ? 'QQQ and SPY complete' : 'missing: npm run ps:download');
    add('nothing after the bound', store.countAfterBound(db) === 0, `${store.countAfterBound(db)} bars after ${MAX_DATE}`);
    const hash = ok ? dataHash() : null;
    const st = logStatus(readLog(logFile));
    const fr = st.frozen.filter((f) => f.codeRevision === CODE_REVISION && (skipGit || f.commit === PREREG.commit) && f.dataHash === hash);
    add('frozen for campaign 1', fr.length === 1, fr.length ? `log entry ${fr[0].number}` : `no entry names ${CODE_REVISION} and the data hash`);
    const logged = new Set(st.runs.map((r) => r.runId));
    const unlogged = store.listRuns(db).filter((r) => r.status !== 'running' && !logged.has(r.id));
    add('every run logged', !unlogged.length, unlogged.length ? `runs ${unlogged.map((r) => r.id).join(', ')}` : 'yes');
    return { ok: conds.every((c) => c.ok), conditions: conds, dataHash: hash };
  }
  function freeze() {
    const g = gateStatus();
    const bad = g.conditions.filter((c) => !['frozen for campaign 1', 'every run logged'].includes(c.name) && !c.ok);
    if (bad.length) throw new PsError(409, `cannot freeze: ${bad.map((c) => `${c.name} (${c.detail})`).join('; ')}`);
    const st0 = logStatus(readLog(logFile));
    if (st0.frozen.some((f) => f.codeRevision === CODE_REVISION)) throw new PsError(409, `campaign 1 is already frozen for ${CODE_REVISION}`);
    // A new frozen record after an earlier one is a defect replacement: it needs the log's defect entry naming this revision.
    const isDefectEntry = (e) => /\*\*Defect replacement \d+\*\*/.test(e.title) && `${e.title}\n${e.body}`.includes(CODE_REVISION);
    if (st0.frozen.length && !logEntries(readLog(logFile)).some(isDefectEntry)) throw new PsError(409, `a new frozen record needs a **Defect replacement N** log entry naming ${CODE_REVISION} (the defect, its verification and the correction)`);
    return appendLogEntry({ title: '**Frozen for campaign 1**', body: `code revision: \`${CODE_REVISION}\`; engine \`${ENGINE_VERSION}\`; campaign commit: \`${PREREG.commit}\`; HEAD \`${skipGit ? 'tests' : headCommit()}\`; data hash: \`${g.dataHash}\` (QQQ and SPY 1-minute regular-session bars, ${FROM} to ${MAX_DATE}). ${STAND_IN}. Implementation ends here.`, date: today(), file: logFile });
  }

  // One tested configuration: its signal trades and its attempts on both plans; saved, then logged.
  function runConfig(id, dataHash) {
    const c = configOf(id);
    const runId = store.startRun(db, { configId: id, kind: 'signals', codeRevision: CODE_REVISION, dataHash, startedAt: now() });
    try {
      const mk = market(c.market);
      const { trades, skipped } = runSignals(mk, c.family, matrix);
      const skips = skipped.reduce((o, s) => { o[s.reason] = (o[s.reason] || 0) + 1; return o; }, {});
      store.insertTrades(db, runId, trades);
      const ds = dates(), tv = tickValue(c.market), out = {};
      for (const [key, plan] of Object.entries(matrix.accounts)) {
        const attempts = runAttempts({ dates: ds, trades, plan, tickValue: tv, exec: matrix.execution, horizons: matrix.horizons });
        store.insertAttempts(db, runId, key, attempts);
        out[key] = { ...summarize(attempts, trades, plan, tv, matrix.execution), months: monthCounts(attempts) };
      }
      store.finishRun(db, runId, { status: 'done', summary: { configId: id, market: c.market, family: c.family, trades: trades.length, skips, plans: out }, at: now() });
    } catch (e) { store.finishRun(db, runId, { status: 'failed', error: String(e.stack || e.message).slice(0, 3000), at: now() }); }
    const run = store.getRun(db, runId);
    appendLogEntry({ title: `**Run** run id: ${run.id}, config: ${id}, status: ${run.status}`, body: run.status === 'done' ? `completed trades ${run.summary.trades}; LucidFlex 50K pass rate ${r4(run.summary.plans.primary.passRate)}, payouts ${run.summary.plans.primary.payouts}, expected net per attempt US$${run.summary.plans.primary.expectedNet} (before the fee US$${run.summary.plans.primary.beforeFee}); LucidPro 50K pass rate ${r4(run.summary.plans.secondary.passRate)}. ${STAND_IN}; exploratory.` : `failed: ${(run.error || '').split('\n')[0]}`, date: today(), file: logFile });
    return run;
  }
  const doneRun = (id) => store.listRuns(db).filter((r) => r.configId === id && r.status === 'done' && r.codeRevision === CODE_REVISION).at(-1) ?? null;

  // The matched random twins of one configuration: seeds not yet stored, one at a time.
  function runRandom(id, { deadline = Infinity, heartbeat = () => {} } = {}) {
    const c = configOf(id), run = doneRun(id);
    if (!run) throw new PsError(409, `${id} has no finished run`);
    const trades = store.listTrades(db, run.id), mk = market(c.market), ds = dates();
    const done = new Set(store.randomSeedsDone(db, id, CODE_REVISION));
    const plan = matrix.accounts.primary, tv = tickValue(c.market);
    for (let s = 0; s < matrix.random.seeds; s++) {
      if (done.has(s)) continue;
      if (Date.now() > deadline) return { complete: false };
      const rng = mulberry32(matrix.random.seedBase + s);
      const rt = randomTwin(mk, trades, matrix, rng);
      const attempts = runAttempts({ dates: ds, trades: rt, plan, tickValue: tv, exec: matrix.execution, horizons: matrix.horizons });
      const passRate = attempts.filter((a) => a.eval === 'passed').length / attempts.length;
      store.insertRandom(db, { configId: id, revision: CODE_REVISION, seed: s, passRate, months: monthCounts(attempts), trades: rt.length, at: now() });
      if (s % 25 === 0) heartbeat(`${id} random seed ${s}`);
    }
    return { complete: true };
  }

  // The month-resampled test (CAMPAIGN-1.md section 9) and Holm over the eight tested configurations.
  function inference() {
    const inf = matrix.inference;
    const res = {};
    for (const id of TESTED) {
      const run = doneRun(id);
      const rnd = store.listRandom(db, id, CODE_REVISION);
      if (!run || rnd.length < matrix.random.seeds) { res[id] = { status: 'pending' }; continue; }
      const P = run.summary.plans.primary;
      const months = Object.keys(P.months).sort();
      const cfg = months.map((m) => P.months[m]);
      const rmean = months.map((m) => rnd.reduce((s, r) => s + (r.months[m]?.[0] ?? 0), 0) / rnd.length);
      const att = cfg.map((x) => x[1]);
      const dOf = (idx) => { let p = 0, q = 0, n = 0; for (const i of idx) { p += cfg[i][0]; q += rmean[i]; n += att[i]; } return n ? (p - q) / n : 0; };
      const all = months.map((_, i) => i);
      const D = dOf(all);
      const rng = mulberry32(inf.seed + TESTED.indexOf(id));
      let le = 0;
      for (let b = 0; b < inf.monthResamples; b++) { const idx = all.map(() => Math.floor(rng() * all.length)); if (dOf(idx) <= 0) le++; }
      const p = (1 + le) / (1 + inf.monthResamples);
      const rank = (1 + rnd.filter((r) => r.passRate >= P.passRate).length) / (1 + rnd.length);
      const lbId = `LB-${id.split('-')[1]}`, lb = doneRun(lbId)?.summary.plans.primary;
      res[id] = { status: run.summary.trades < inf.minCompletedTrades ? 'insufficient sample' : 'tested', passRate: r4(P.passRate), randomMean: r4(rnd.reduce((s, r) => s + r.passRate, 0) / rnd.length), D: r4(D), p, seedRank: r4(rank), trades: run.summary.trades, vsLevelBreak: lb && id !== lbId ? r4(P.passRate - lb.passRate) : null };
    }
    const fam = inf.holmFamily;
    const h = holmAdjust(fam.map((id, i) => ({ id: i, p: res[id]?.status === 'tested' ? res[id].p : null })), { m: fam.length, alpha: inf.alpha });
    fam.forEach((id, i) => { if (res[id]) { res[id].holmP = h.get(i).adjustedP; res[id].significant = res[id].status === 'tested' && h.get(i).significant && res[id].D > 0; } });
    return res;
  }

  function runAll({ log: say = log, maxMs = matrix.budget.executionHours * 3600_000, heartbeat = () => {} } = {}) {
    const g = gateStatus();
    if (!g.ok) throw new PsError(409, `The gate is closed: ${g.conditions.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ')}`);
    const t0 = Date.now(), deadline = t0 + maxMs;
    for (const id of TESTED) if (!doneRun(id)) { const r = runConfig(id, g.dataHash); say(`run ${r.id} ${id}: ${r.status}`); heartbeat(`run ${id}`); }
    for (const id of TESTED) { const r = runRandom(id, { deadline, heartbeat }); say(`${id} random twins: ${r.complete ? 'complete' : 'stopped at the budget'}`); if (!r.complete) return { complete: false }; }
    const res = inference();
    if (!store.listInference(db, CODE_REVISION).length) for (const [id, r] of Object.entries(res)) store.insertInference(db, id, CODE_REVISION, r, now());
    return { complete: true, inference: res, elapsedMs: Date.now() - t0 };
  }

  return { db, matrix, market, dates, gateStatus, freeze, runConfig, runRandom, inference, runAll, doneRun, dataHash, TESTED };
}

// ---------- the four plain-English answers and the report ----------
const usd = (n) => (n == null ? '—' : `${n < 0 ? '-' : ''}US$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (x) => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);
// A difference in percentage points, in words: 'ahead by 1.8 points', 'behind by 1.8 points', 'level'.
const pts = (x) => { const v = Math.round(1000 * x) / 10; return v > 0 ? `ahead by ${v.toFixed(1)} points` : v < 0 ? `behind by ${(-v).toFixed(1)} points` : 'level'; };
const ptsNum = (x) => { const v = Math.round(1000 * x) / 10; return (v === 0 ? 0 : v).toFixed(1); };
export function fourAnswers(id, run, inf, lb) {
  const P = run.summary.plans.primary, S = run.summary.plans.secondary, i = inf[id] || {};
  const money = `${id} passed ${pct(P.passRate)} of ${P.attempts} simulated LucidFlex 50K evaluations (median ${P.medianDaysToPass ?? '—'} sessions to pass) and reached a first payout in ${pct(P.payoutRate)} of them. The expected result per attempt is ${usd(P.expectedNet)} after the assumed ${usd(P.fee)} fee (${usd(P.beforeFee)} before it): it ${P.expectedNet > 0 ? 'made' : 'did not make'} money after fees. LucidPro 50K: passed ${pct(S.passRate)}, payouts ${pct(S.payoutRate)}, ${usd(S.expectedNet)} per attempt after its fee.`;
  const vsR = i.status === 'tested' ? `Against its matched random entries (${pct(i.randomMean)} pass rate on average over 1,000 seeds): ${pts(i.D)}, month-resampled p ${i.p.toFixed(4)}, Holm ${i.holmP == null ? '—' : i.holmP.toFixed(4)}, ${i.significant ? 'significant: it beat random by more than chance' : 'not significant: it did not beat random by more than chance'}.` : i.status === 'insufficient sample' ? `Fewer than 100 completed trades (${i.trades}): insufficient sample, description only.` : 'The random comparison has not finished.';
  const vsLb = lb && !id.startsWith('LB') ? ` Against the plain level break of its market (${pct(lb.passRate)}): ${pts(P.passRate - lb.passRate)} (description).` : '';
  const edge = i.status === 'tested' && !i.significant && P.passRate > 0 ? ' It passed sometimes, but no more often than random by more than chance: it has shown no edge.' : '';
  const risk = `It used a median ${pct(P.medianRoomUsed)} of the US$2,000 drawdown room before its evaluation ended; its worst losing streak was ${P.worstLosingStreak} trades; LucidPro's daily loss limit stopped trading on ${S.dllDays} attempt-days (LucidFlex was simulated without one). ${P.failed} evaluations failed on the drawdown, ${P.timedOut} timed out after 60 sessions.`;
  const evidence = `${run.summary.trades} completed trades${run.summary.trades < 100 ? ' (insufficient sample)' : ''}; ${P.attempts} overlapping attempts grouped into start months for the test; Holm over 8 configurations. The period 2018 to 2022 was already tested by sweep-bos and the ICT Lab on the same market with ICT-style rules, and these are stand-in ETF bars, regular hours only, not futures: every result is exploratory.`;
  return { money, controls: vsR + vsLb + edge, risk, evidence };
}
export function writeReport(ps, { file = path.join(REPORT_DIR, 'campaign-1.md') } = {}) {
  const inf = ps.inference();
  const L = [`# prop-sim campaign 1: ICT structure strategies in a simulated Lucid evaluation`, '', `**${LABEL}.** **${STAND_IN}** (QQQ and SPY 1-minute bars at NQ = 41.0 × QQQ and ES = 10.0 × SPY). Code revision \`${CODE_REVISION}\`. Exploratory: the period was used before by sweep-bos and the ICT Lab. Every figure is measured from the simulation.`, ''];
  L.push('| Config | Trades | Flex pass rate | Random mean | D | p | Holm p | Payout rate | Expected net / attempt | Pro pass rate | Status |', '|---|---|---|---|---|---|---|---|---|---|---|');
  const order = ps.TESTED;
  for (const id of order) {
    const run = ps.doneRun(id), i = inf[id] || {};
    if (!run) { L.push(`| ${id} | not run | | | | | | | | | |`); continue; }
    const P = run.summary.plans.primary, S = run.summary.plans.secondary;
    L.push(`| ${id} | ${run.summary.trades} | ${pct(P.passRate)} | ${i.randomMean == null ? '—' : pct(i.randomMean)} | ${i.D == null ? '—' : ptsNum(i.D)} | ${i.p == null ? '—' : i.p.toFixed(4)} | ${i.holmP == null ? '—' : i.holmP.toFixed(4)} | ${pct(P.payoutRate)} | ${usd(P.expectedNet)} | ${pct(S.passRate)} | ${i.status}${i.significant ? ', beats random' : ''} |`);
  }
  const winners = order.filter((id) => inf[id]?.significant);
  L.push('', `**Outcome:** ${winners.length ? `beats random by more than chance (Holm): ${winners.join(', ')}; exploratory, never validated` : 'NONE: no configuration beat its matched random entries by more than chance.'}`, '');
  for (const id of order) {
    const run = ps.doneRun(id);
    if (!run) continue;
    const lb = ps.doneRun(`LB-${id.split('-')[1]}`)?.summary.plans.primary;
    const a = fourAnswers(id, run, inf, lb);
    L.push(`## ${id}`, '', `**1. How often did it pass, and did it make money after fees?** ${a.money}`, '', `**2. Did it beat random entries and the plain level break?** ${a.controls}`, '', `**3. How much risk did it take?** ${a.risk}`, '', `**4. How strong is the evidence?** ${a.evidence}`, '', `Skipped setups: ${JSON.stringify(run.summary.skips)}.`, '');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${L.join('\n')}\n`, 'utf8');
  return file;
}
