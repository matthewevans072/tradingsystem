// event-swing's run report (CAMPAIGN-1.md section 8): the shared metrics of server/rangetrend/metrics.js (net,
// returns, drawdown, exposure, trades, costs, concentration, best-5% removal, the index and the exposure-matched
// hold), the research runner's accounting check, and the event-specific parts: the statistic T of section 9, years
// and halves, results by event category, signals not filled and their missed outcome, family A's estimate and spell
// outcomes and family B's trigger fates. Reporting only: nothing here selects or advances anything.
import { computeMetrics, exposureMatched, tradePnls, years as yearsBetween } from '../rangetrend/metrics.js';
import { holdIndex } from '../rangetrend/benchmark.js';
import { accountingCheck } from '../research/runner.js';
import { lowerBound } from './events.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (fin(x) ? Math.round(x * 10000) / 10000 : null);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
export const HALVES = Object.freeze([{ from: '2016-01-04', to: '2018-12-31' }, { from: '2019-01-02', to: '2021-12-31' }]);

export function indexFor(inputs, { startingCash, withholdingPct }) {
  return holdIndex({ symbols: inputs.symbols, sessions: inputs.sessions, days: inputs.days, start: inputs.sessions[0], startingCash, withholdingPct });
}

// T = net profit minus the exposure-matched hold's net profit (CAMPAIGN-1.md section 9). Fast: equity and index only.
export function tStatistic(result, index, startingCash) {
  const eq = result.equity.map((p) => ({ date: p.date, value: p.equity, invested: p.invested }));
  if (!eq.length) return 0;
  const em = exposureMatched(eq, index.map((p) => ({ date: p.date, value: p.value })), startingCash);
  return (eq.at(-1).value - startingCash) - (em.at(-1).value - startingCash);
}

// Net of a series between two dates: value at the last point on or before `to` minus the value at the last point
// before `from` (the start value when none).
function netBetween(points, from, to, start) {
  const before = points.filter((p) => p.date < from).at(-1)?.value ?? start;
  const end = points.filter((p) => p.date <= to).at(-1)?.value;
  return end == null ? null : end - before;
}

// The stock's move from the open after `date` to the close `h` of its sessions later (a missed outcome).
function forwardMove(inputs, symbol, date, h) {
  const own = inputs.stockSessions[symbol];
  const i = lowerBound(own, date);
  if (own[i] !== date || i + 1 >= own.length) return null;
  const a = inputs.days.get(own[i + 1]).bars[symbol].o;
  const j = Math.min(own.length - 1, i + 1 + h);
  let c = inputs.days.get(own[j]).bars[symbol].c;
  for (let x = i + 2; x <= j; x++) for (const sp of inputs.days.get(own[x]).splits) if (sp.symbol === symbol) c *= sp.ratio;
  return c / a - 1;
}

function group(items, key) {
  const out = {};
  for (const t of items) {
    const k = key(t) ?? 'none';
    const g = (out[k] ||= { trades: 0, pnl: 0, wins: 0 });
    g.trades++; g.pnl += t.pnlTotal ?? t.pnl; if ((t.pnlTotal ?? t.pnl) > 0) g.wins++;
  }
  for (const g of Object.values(out)) g.pnl = r2(g.pnl);
  return out;
}

export function runReport(result, { inputs, index, config, realEvents = [] }) {
  const start = config.portfolio.startingCash;
  const m = computeMetrics(result, { index });
  const accounting = accountingCheck(result, m, { tolerance: 0.05 });
  const eq = result.equity.map((p) => ({ date: p.date, value: p.equity, invested: p.invested }));
  const idxPts = index.map((p) => ({ date: p.date, value: p.value }));
  const em = exposureMatched(eq, idxPts, start);
  const net = m.endValue - start, emNet = em.at(-1).value - start;
  const T = net - emNet;
  const yearsList = [...new Set(eq.map((p) => p.date.slice(0, 4)))];
  const annual = Object.fromEntries(yearsList.map((y) => [y, { net: r2(netBetween(eq, `${y}-01-01`, `${y}-12-31`, start)), exposureMatchedNet: r2(netBetween(em, `${y}-01-01`, `${y}-12-31`, start)), indexNet: r2(netBetween(idxPts, `${y}-01-01`, `${y}-12-31`, start)) }]));
  const halves = HALVES.map((h) => { const a = netBetween(eq, h.from, h.to, start), b = netBetween(em, h.from, h.to, start); return { ...h, net: r2(a), exposureMatchedNet: r2(b), decisionGain: r2(a - b) }; });
  const trades = tradePnls(result); // each trade's P/L including dividends paid after it closed
  const report = {
    configId: config.id, family: config.family, role: config.role, label: config.label,
    net: r2(net), endValue: r2(m.endValue), totalReturnPct: r2(m.totalReturnPct), annualisedReturnPct: r2(m.annualisedReturnPct), maxDrawdownPct: r2(m.maxDrawdownPct), maxDrawdownUsd: r2(m.maxDrawdownUsd),
    avgInvestedPct: r2(m.avgInvestedPct), timeInCashPct: r2(m.timeInCashPct), completedTrades: m.completedTrades, openAtEnd: m.openAtEnd, holdingSessions: m.holdingSessions, turnoverPerYear: r2(m.turnoverPerYear), costs: r2(m.costs),
    exits: m.exits, skipsByCode: m.skipsByCode, cancellationsByCode: m.cancellationsByCode, rejectionsByCode: m.rejectionsByCode, pendingAtEnd: m.pendingAtEnd,
    perStock: Object.fromEntries(Object.entries(m.perStock).map(([s, v]) => [s, { pnl: r2(v.pnl), signals: v.signals, entries: v.entries, skips: v.skips, cancellations: v.cancellations, rejections: v.rejections }])),
    concentration: { topStock: m.tier2.grossGain.maxSymbol, topShare: r4(m.tier2.grossGain.maxShare), grossGain: r2(m.tier2.grossGain.grossGain), winners: m.tier2.grossGain.winners, undefined: m.tier2.grossGain.undefined },
    bestFive: { K: m.tier2.withoutBestFivePct.outcomesRemoved, removedPL: r2(m.tier2.withoutBestFivePct.removedPL), adjustedNet: r2(m.tier2.withoutBestFivePct.pnl) },
    index: { net: r2(m.benchmarks.buyAndHold.endValue - start), annualisedReturnPct: r2(m.benchmarks.buyAndHold.annualisedReturnPct), maxDrawdownPct: r2(m.benchmarks.buyAndHold.maxDrawdownPct) },
    exposureMatched: { net: r2(emNet), annualisedReturnPct: r2(m.benchmarks.exposureMatched.annualisedReturnPct), maxDrawdownPct: r2(m.benchmarks.exposureMatched.maxDrawdownPct) },
    T: r2(T), annual, halves, accounting: { ok: accounting.ok, problems: accounting.problems, difference: accounting.reconciliation.difference },
    years: r4(yearsBetween(eq[0].date, eq.at(-1).date)),
  };
  // Signals that did not become positions, with their missed outcome over the planned holding period.
  const H = config.rule?.timeExit ?? 20;
  const missed = [];
  for (const k of result.skips || []) missed.push({ kind: 'skip', code: k.code, symbol: k.symbol, date: k.date });
  for (const w of (result.warnings || []).filter((x) => x.code === 'order_cancelled' || x.code === 'entry_rejected')) missed.push({ kind: w.code, code: w.details?.code ?? 'unknown', symbol: w.symbol, date: w.details?.decisionDate ?? w.date });
  const moves = missed.map((x) => ({ ...x, move: x.date ? forwardMove(inputs, x.symbol, x.date, H) : null }));
  const byCode = {};
  for (const x of moves) { const g = (byCode[`${x.kind}:${x.code}`] ||= { count: 0, moves: [] }); g.count++; if (fin(x.move)) g.moves.push(x.move); }
  report.notFilled = Object.fromEntries(Object.entries(byCode).map(([k, g]) => [k, { count: g.count, medianMovePct: r2((median(g.moves) ?? NaN) * 100), rose: g.moves.filter((v) => v > 0).length, horizonSessions: H }]));
  if (config.kind === 'signal') {
    const withEvent = trades.filter((t) => t.event);
    report.byCategory = {
      reaction: group(withEvent, (t) => t.event.reaction), guidance: group(withEvent, (t) => t.event.price ? 'price_only' : t.event.guidance), timing: group(withEvent, (t) => t.event.timing),
      interim: group(withEvent, (t) => (t.event.price ? 'price_only' : t.event.interim ? 'interim' : 'regular')), noEvent: trades.length - withEvent.length,
    };
    const ev = result.events || [];
    report.eventActions = ev.reduce((a, e) => { a[e.action] = (a[e.action] || 0) + 1; return a; }, {});
    if (config.rule.entry === 'recovery') {
      const w = result.watches || [];
      const noRec = w.filter((x) => x.outcome === 'no_recovery');
      const noRecMoves = noRec.map((x) => forwardMove(inputs, x.symbol, x.trigger.availDate, 20)).filter(fin);
      report.triggerFates = {
        watches: w.filter((x) => x.outcome !== 'restarted').length + (result.openWatches?.length ?? 0), restarted: w.filter((x) => x.outcome === 'restarted').length,
        noRecovery: noRec.length, noRecoveryMedianMove20Pct: r2((median(noRecMoves) ?? NaN) * 100), noRecoveryKeptFalling: noRecMoves.filter((v) => v < 0).length,
        recovered: w.filter((x) => x.outcome === 'recovery').length,
        enteredInvalidated: trades.filter((t) => t.exitReason === 'invalidation').length, enteredTimedOutWithLoss: trades.filter((t) => t.exitReason === 'time' && t.pnlTotal < 0).length, enteredGained: trades.filter((t) => t.pnlTotal > 0).length,
      };
    }
    if (config.rule.trigger === 'm1') report.pauses = { pausedSignals: (result.skips || []).filter((k) => k.code === 'paused_after_event').length, pauseEvents: ev.filter((e) => e.action === 'pause').length };
  } else {
    report.familyA = familyAOutcomes(result, { inputs, realEvents });
  }
  return { report, metrics: m };
}

// Family A (CAMPAIGN-1.md section 8): every estimate's outcome against its actual (the realised event, used here for
// reporting only), and every exit spell's effect e = shares x (exit fill - re-entry fill).
export function familyAOutcomes(result, { inputs, realEvents }) {
  const spells = [...(result.spells || [])];
  const effects = spells.map((s) => {
    // Re-entry shares can differ from the shares sold (whole shares, the sleeve's cash); e uses the shares sold.
    const e = s.shares * (s.exitPrice - s.reentryPrice);
    return { symbol: s.symbol, exitFill: s.exitFill, reentryFill: s.reentryFill, reason: s.reentryReason, effect: e, holdingWouldHaveWon: s.reentryPrice > s.exitPrice, sessionsOut: inputs.stockSessions[s.symbol] ? lowerBound(inputs.stockSessions[s.symbol], s.reentryFill) - lowerBound(inputs.stockSessions[s.symbol], s.exitFill) : null };
  });
  const bySym = new Map();
  for (const e of realEvents) { if (!bySym.has(e.symbol)) bySym.set(e.symbol, []); bySym.get(e.symbol).push(e); }
  const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const outcome = {};
  const inc = (k) => { outcome[k] = (outcome[k] || 0) + 1; };
  const detail = [];
  for (const est of result.estimates || []) {
    const actual = (bySym.get(est.symbol) || []).find((e) => Math.abs(days(est.estimate, e.D)) <= 30) ?? null;
    let cls;
    if (est.status === 'dropped_too_close' || est.status === 'outside_window' || est.status === 'known_too_late') cls = est.status;
    else if (!actual) cls = 'unmatched';
    else if (est.status === 'already_announced') cls = 'held_through_actual_earlier';
    else if (est.status === 'not_invested') cls = 'not_invested';
    else if (est.status === 'exit') {
      const sp = spells.find((s) => s.symbol === est.symbol && s.estimate === est.estimate) ?? (result.openSpells || []).find((s) => s.symbol === est.symbol && s.estimate === est.estimate);
      const x = sp?.exitFill ?? null;
      if (!x) cls = 'exit_not_filled';
      else if (x < actual.D) {
        const own = inputs.stockSessions[est.symbol];
        const out = lowerBound(own, actual.D) - lowerBound(own, x);
        cls = out > 10 ? 'exited_more_than_10_sessions_early' : 'exited_before_actual';
      } else if (x === actual.D) cls = 'exited_on_report_date';
      else cls = 'held_through_actual_earlier';
    } else cls = est.status;
    inc(cls);
    detail.push({ symbol: est.symbol, estimate: est.estimate, actual: actual?.D ?? null, outcome: cls });
  }
  const pos = effects.filter((e) => e.effect > 0), neg = effects.filter((e) => e.effect <= 0);
  const perStock = {};
  for (const e of effects) perStock[e.symbol] = (perStock[e.symbol] || 0) + e.effect;
  const grossPos = Object.values(perStock).reduce((a, v) => a + Math.max(0, v), 0);
  const top = Object.entries(perStock).sort((a, b) => b[1] - a[1])[0] ?? null;
  const sorted = [...effects].sort((a, b) => b.effect - a.effect || (a.exitFill < b.exitFill ? -1 : 1));
  const K = Math.max(1, Math.ceil(0.05 * effects.length));
  return {
    estimates: outcome, estimateDetail: detail,
    spells: effects.length, holdingWouldHaveWon: effects.filter((e) => e.holdingWouldHaveWon).length, avoidedDecline: effects.filter((e) => !e.holdingWouldHaveWon).length,
    sumEffect: r2(sum(effects.map((e) => e.effect))), sumGains: r2(sum(pos.map((e) => e.effect))), sumLosses: r2(sum(neg.map((e) => e.effect))),
    perStockEffect: Object.fromEntries(Object.entries(perStock).map(([s, v]) => [s, r2(v)])),
    topStock: top ? { symbol: top[0], share: grossPos > 0 ? r4(Math.max(0, top[1]) / grossPos) : null } : null,
    bestFive: { K, removed: r2(sum(sorted.slice(0, K).map((e) => e.effect))), adjusted: r2(sum(effects.map((e) => e.effect)) - sum(sorted.slice(0, K).map((e) => e.effect))) },
    byReentryReason: effects.reduce((a, e) => { a[e.reason] = (a[e.reason] || 0) + 1; return a; }, {}),
    openSpellsAtEnd: (result.openSpells || []).length,
  };
}
