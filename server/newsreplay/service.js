// news-replay for the app: a read-only view of news-replay's own database for the Research page (the runs, their
// reports with the four plain-English answers, plan fates, the comparisons, and a plan inspector that shows a plan's
// simulated time, inputs, levels, activation, recorded action and next fill, with the outcome in a separate panel).
// Runs start only from the command line (npm run nr:run); nothing here starts, changes or sends anything. The demo
// workspace gets a stub. Simulation only: no holdings, no cash, no order.
import { createNewsReplay } from './campaign.js';
import * as store from './store.js';
import { NrError, REPLAY, CODE_REVISION, ENGINE_VERSION, CODE_REVISION_2, logStatus, readLog, BASKET } from './config.js';
import { fourAnswers, QUESTIONS, fourAnswers2 } from './answers.js';
import { createCampaign2, X_IDS } from './campaign2.js';

export { NrError };
const PLANNER_OF = (configId) => (configId.startsWith('DC-') ? 'DC' : configId.startsWith('AIM-') ? 'AIM' : configId.startsWith('AI-') ? 'AI' : configId.startsWith('P-') ? 'P' : 'D');
const LABEL = 'development result on a heavily used period (2020-01-02 to 2021-12-31), simulated, not validated';

export function createNewsReplayService(ctx, opts = {}) {
  if (ctx.mode === 'demo') {
    const refuse = () => { throw new NrError(409, 'not available in the demo workspace'); };
    return { overview: () => ({ simulated: true, demo: true, note: 'Demo workspace: news-replay works on real market data in your own workspace only.' }), plans: refuse, plan: refuse, close: () => {} };
  }
  const nr = createNewsReplay({ dataDir: ctx.cfg.dataDir, ...opts, testOverrides: Object.keys(opts).length > 0 });
  const { db, matrix } = nr;
  let c2 = null;
  const camp2 = () => (c2 ||= createCampaign2(nr));
  const phaseOf = (id) => Object.entries(matrix.phases).find(([, ids]) => ids.includes(id))?.[0] ?? null;
  const configOf = (id) => {
    if (X_IDS.includes(id)) return { id, planner: 'D', entry: 'C' };
    const c = matrix.configurations.find((x) => x.id === id);
    if (!c) throw new NrError(400, `unknown configuration ${id}`);
    if (c.status) throw new NrError(409, `${id}: ${c.status}`);
    return c;
  };
  // Campaign 2 (CAMPAIGN-2.md, the AMT exits): read-only, from its stored runs and placebo rows.
  function overview2() {
    const c = camp2(), m2 = c.matrix2, by = c.reports(), holm = c.holm();
    const x1 = c.runs().filter((r) => r.configId === 'X1' && r.variant === 'base').at(-1);
    return {
      label: LABEL, codeRevision: CODE_REVISION_2, reproduction: x1?.summary?.reproduction ?? null,
      runs: c.runs().map((r) => ({ id: r.id, configId: r.configId, variant: r.variant, status: r.status, net: r.summary?.report?.net ?? null, T: r.summary?.report?.T ?? null, error: r.error ? r.error.split('\n')[0] : null })),
      configs: m2.configurations.map((x) => { const r = by.get(`${x.id}|base`); return { id: x.id, exit: x.exit, report: r ? { net: r.net, T: r.T, index: r.index, exposureMatched: r.exposureMatched, maxDrawdownPct: r.maxDrawdownPct, avgInvestedPct: r.avgInvestedPct, completedTrades: r.completedTrades, openAtEnd: r.openAtEnd, costs: r.costs, perStock: r.perStock, exitSummary: r.exitSummary, accounting: r.accounting, planFates: r.planFates ?? null } : null, sensitivities: Object.fromEntries(m2.sensitivities.map((s) => [s.id, by.get(`${x.id}|${s.id}`)?.T ?? null])), answers: r ? fourAnswers2(x.id, by, holm, m2, matrix.portfolio.startingCash) : null }; }),
      comparisons: m2.comparisons.map((x) => ({ id: x.id, name: x.name, pair: x.pair, ...holm[x.id] })),
      inference: m2.inference,
    };
  }
  return {
    overview() {
      const by = store.doneReports(db);
      const holm = nr.holm();
      const runs = store.listRuns(db).map((r) => ({ id: r.id, configId: r.configId, variant: r.variant, status: r.status, startedAt: r.startedAt, net: r.summary?.report?.net ?? null, T: r.summary?.report?.T ?? null, trades: r.summary?.report?.completedTrades ?? null, error: r.error ? r.error.split('\n')[0] : null }));
      const log = logStatus(readLog());
      const configs = matrix.configurations.map((c) => {
        const r = by.get(`${c.id}|base`);
        const sens = Object.fromEntries(matrix.sensitivities.map((s) => [s.id, by.get(`${c.id}|${s.id}`)?.T ?? null]));
        return {
          id: c.id, planner: c.planner, entry: c.entry, phase: phaseOf(c.id), notRun: c.status ?? null,
          report: r ? { net: r.net, totalReturnPct: r.totalReturnPct, annualisedReturnPct: r.annualisedReturnPct, maxDrawdownPct: r.maxDrawdownPct, avgInvestedPct: r.avgInvestedPct, timeInCashPct: r.timeInCashPct, turnoverPerYear: r.turnoverPerYear, costs: r.costs, completedTrades: r.completedTrades, openAtEnd: r.openAtEnd, winTrades: r.winTrades, lossTrades: r.lossTrades, index: r.index, exposureMatched: r.exposureMatched, T: r.T, annual: r.annual, perStock: r.perStock, concentration: r.concentration, exits: r.exits, holdingSessions: r.holdingSessions, signalFates: r.signalFates, missed: r.missed, planFates: r.planFates ?? null, plans: r.plans, accounting: r.accounting } : null,
          sensitivities: sens, answers: r ? fourAnswers(c.id, by, holm, matrix) : null,
        };
      });
      return {
        simulated: true, label: LABEL, questions: QUESTIONS, replay: REPLAY, basket: BASKET, codeRevision: CODE_REVISION, engineVersion: ENGINE_VERSION,
        downloads: store.listDownloads(db).length, records: { countsEntries: log.counts.length, frozen: log.frozen.length, loggedRuns: log.runs.length },
        runs, configs, comparisons: matrix.comparisons.map((x) => ({ id: x.id, name: x.name, pairs: x.pairs, ...holm[x.id] })),
        inference: matrix.inference, closedWindows: nr.closedWindows, campaign2: overview2(),
      };
    },
    plans({ config, stock = null, session = null, offset = 0, limit = 50 }) {
      configOf(config);
      return { config, planner: PLANNER_OF(config), offset, limit, ...store.plansPage(db, { planner: PLANNER_OF(config), stock, session, limit, offset }) };
    },
    plan(id, config) {
      configOf(config);
      const row = store.planRow(db, id);
      if (!row) throw new NrError(404, 'no such plan');
      if (row.planner !== PLANNER_OF(config)) throw new NrError(400, `plan ${id} belongs to planner ${row.planner}, not to ${config}`);
      const p = row.plan;
      const runId = store.baseRunOf(db, config);
      const acts = runId ? store.actionsForPlan(db, runId, id) : null;
      const buy = acts?.decision.find((a) => a.kind === 'buy') ?? null;
      const signal = acts?.decision.filter((a) => a.kind === 'signal').at(-1) ?? null;
      let outcome = null;
      if (acts && buy) {
        const sells = acts.outcome.filter((a) => a.kind === 'sell');
        const extra = acts.outcome.filter((a) => a.kind === 'dividend_paid' || a.kind === 'cash_in_lieu').reduce((s, a) => s + a.detail.amount, 0);
        const proceeds = sells.reduce((s, a) => s + a.detail.proceeds, 0);
        outcome = { records: acts.outcome, closed: sells.length > 0, pnlFromRecords: sells.length ? Math.round((proceeds + extra - buy.detail.cost) * 100) / 100 : null, note: sells.length ? 'derived from this trade\'s own records: proceeds plus dividends and cash in lieu, minus the cost of the buy' : 'open at the end of the replay; the run report values it at the last close' };
      } else if (acts) outcome = { records: [], closed: false, pnlFromRecords: null, note: signal ? `no trade: ${signal.detail.fate}${signal.detail.why ? ` (${signal.detail.why})` : ''}` : 'no trade' };
      return {
        config, runId, simulated: true,
        plan: { id: row.id, planner: row.planner, stock: row.stock, session: row.session, T: p.T, followUp: p.followUp, category: p.category, status: p.status, reason: p.reason ?? null, packetHash: row.packetHash, chainHash: row.chainHash, codeRevision: row.codeRevision, savedAt: row.createdAt },
        inputs: { items: store.itemTexts(db, p.facts.flatMap((f) => f.sourceIds)), reference: p.reference ?? null, typicalMove: p.m ?? null, headlineClasses: p.headlineClasses ?? null },
        scenarios: { bullish: p.bullish, bearish: p.bearish, noTrade: p.noTrade, invalidation: p.invalidation ?? null, exit: p.exit, expirySession: p.expirySession, contradiction: p.contradiction, uncertainties: p.uncertainties },
        activation: acts?.decision.find((a) => a.kind === 'activation') ?? null,
        action: signal, nextFill: buy ? { ms: buy.ms, price: buy.detail.price, raw: buy.detail.raw, shares: buy.detail.shares, cost: buy.detail.cost, invalidation: buy.detail.inv } : null,
        outcome,
      };
    },
    close: () => nr.close(),
  };
}
export function attachNewsReplay(ctx, opts = {}) {
  let svc = null;
  Object.defineProperty(ctx, 'newsreplay', { configurable: true, enumerable: false, get: () => (svc ||= createNewsReplayService(ctx, opts)) });
  Object.defineProperty(ctx, 'newsreplayIfOpen', { configurable: true, enumerable: false, get: () => svc });
  return ctx;
}
