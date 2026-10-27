// Range-trend metrics and benchmarks (PLAN-DRAFT.md v0.3 section 7). Reporting only:
// no Tier 2 or Tier 3 threshold is enforced and no winner is selected.
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

export function years(first, last) {
  return (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / (365.25 * 86400000);
}

// Largest fall from a previous peak of a series of { date, value }, starting from `start`.
export function maxDrawdown(points, start) {
  let peak = start, worst = 0, worstUsd = 0;
  for (const p of points) {
    peak = Math.max(peak, p.value);
    const dd = peak > 0 ? (peak - p.value) / peak : 0;
    if (dd > worst) { worst = dd; worstUsd = peak - p.value; }
  }
  return { pct: worst * 100, usd: worstUsd };
}

function summary(points, start) {
  if (!points.length) return null;
  const end = points.at(-1).value, y = years(points[0].date, points.at(-1).date);
  const total = (end / start - 1) * 100;
  const ann = y > 0 && end > 0 ? (Math.pow(end / start, 1 / y) - 1) * 100 : null;
  const dd = maxDrawdown(points, start);
  return { startValue: start, endValue: end, totalReturnPct: total, annualisedReturnPct: ann, maxDrawdownPct: dd.pct, maxDrawdownUsd: dd.usd, returnToDrawdown: dd.pct > 0 && fin(ann) ? ann / dd.pct : null };
}

// (c) The exposure-matched hold: B(t) = B(t-1) x (1 + f(t-1) x r(t)), B(0) = start;
// r(t) = the buy-and-hold account's return from close t-1 to close t; f(t-1) = the
// run's holdings / account value at close t-1. Derived; frictionless in its own rebalancing.
export function exposureMatched(runEquity, holdEquity, start) {
  const hold = new Map(holdEquity.map((p) => [p.date, p.value]));
  const out = [];
  let B = start, prevHold = null, prevF = 0;
  for (const p of runEquity) {
    const h = hold.get(p.date);
    if (h == null) throw new Error(`exposure-matched hold: no buy-and-hold value on ${p.date}`);
    if (prevHold != null) B *= 1 + prevF * (h / prevHold - 1);
    out.push({ date: p.date, value: B });
    prevHold = h;
    prevF = p.invested;
  }
  return out;
}

// The trade-off rule (section 7c): after costs, a rule adds value only if it beats (c) on return without a
// deeper maximum drawdown than (c), or beats (c) on return per unit of maximum drawdown. Reported, not enforced.
export function tradeOff(run, c) {
  if (!run || !c) return null;
  const beatsReturnNoDeeper = fin(run.annualisedReturnPct) && fin(c.annualisedReturnPct) && run.annualisedReturnPct > c.annualisedReturnPct && run.maxDrawdownPct <= c.maxDrawdownPct;
  const beatsRatio = fin(run.returnToDrawdown) && fin(c.returnToDrawdown) && run.returnToDrawdown > c.returnToDrawdown;
  return { beatsReturnWithoutDeeperDrawdown: beatsReturnNoDeeper, beatsReturnPerDrawdown: beatsRatio, addsValueBeyondCash: beatsReturnNoDeeper || beatsRatio };
}

// Each completed trade's P/L including what was paid to it after it closed (dividends and cash in lieu it
// was entitled to: result.postExit). The trade records themselves are never edited.
export function tradePnls(result) {
  const post = {};
  for (const x of result.postExit || []) post[x.tradeId] = (post[x.tradeId] || 0) + x.amount;
  return (result.trades || []).map((t) => ({ ...t, postExitPaid: post[t.tradeId] || 0, pnlTotal: t.pnl + (post[t.tradeId] || 0) }));
}

// H5 (PLAN section 5): trades whose entry fills within `within` sessions after a sale of the same stock.
export const H5_WITHIN_SESSIONS = 20;

export function computeMetrics(result, { hold = null, tier2 = { minTrades: 30, maxStockSharePct: 40 } } = {}) {
  const start = result.meta?.startingCash ?? 15000;
  const eq = result.equity.map((p) => ({ date: p.date, value: p.equity, invested: p.invested }));
  const run = summary(eq, start);
  const trades = tradePnls(result);
  const open = result.openPositions || [];
  const fills = result.fills || [];
  const costs = sum(fills.map((f) => f.spreadSlippage + f.fees));
  const avgEquity = mean(eq.map((p) => p.value)) || start;
  const y = eq.length ? years(eq[0].date, eq.at(-1).date) : null;
  const pnls = trades.map((t) => t.pnlTotal);
  const netPnl = sum(pnls);
  // Tier 2 checks on every outcome: completed trades and the positions open at the end, marked at the last close.
  const outcomes = [...trades.map((t) => ({ symbol: t.symbol, pnl: t.pnlTotal, open: false })), ...open.map((o) => ({ symbol: o.symbol, pnl: o.pnl, open: true }))];
  const outcomePnl = sum(outcomes.map((o) => o.pnl));
  // Without the best 5% of outcomes (rounded up to whole outcomes).
  const nBest = Math.ceil(outcomes.length * 0.05);
  const withoutBest = outcomes.length ? sum(outcomes.map((o) => o.pnl).sort((a, b) => b - a).slice(nBest)) : null;
  const byStock = {};
  for (const o of outcomes) byStock[o.symbol] = (byStock[o.symbol] || 0) + o.pnl;
  const topStock = Object.entries(byStock).sort((a, b) => b[1] - a[1])[0] || null;
  const topShare = topStock && outcomePnl > 0 ? (topStock[1] / outcomePnl) * 100 : null;
  const perStock = {};
  const ps = (sym) => (perStock[sym] = perStock[sym] || { signals: 0, entries: 0, oneShareEntries: 0, skips: {}, pnl: 0 });
  for (const d of (result.decisions || []).filter((x) => x.action === 'entry')) ps(d.symbol).signals++;
  for (const k of result.skips || []) { ps(k.symbol).signals++; ps(k.symbol).skips[k.code] = (ps(k.symbol).skips[k.code] || 0) + 1; }
  for (const f of fills.filter((x) => x.side === 'buy')) { ps(f.symbol).entries++; if (f.shares === 1) ps(f.symbol).oneShareEntries++; }
  for (const o of outcomes) ps(o.symbol).pnl += o.pnl;
  const skipsByCode = (result.skips || []).reduce((a, k) => ((a[k.code] = (a[k.code] || 0) + 1), a), {});
  const near = trades.filter((t) => t.afterSaleOf && t.afterSaleOf.sessionsSinceSale != null && t.afterSaleOf.sessionsSinceSale <= H5_WITHIN_SESSIONS);
  const rangeEntries = trades.filter((t) => t.entryType === 'dip' || t.entryType === 'recovery');

  const trendEntries = trades.filter((t) => t.entryType === 'immediate' || t.entryType === 'pullback');
  const out = {
    ...run,
    sessions: eq.length, years: y,
    avgInvestedPct: mean(eq.map((p) => p.invested * 100)), timeInCashPct: mean(eq.map((p) => (1 - p.invested) * 100)),
    completedTrades: trades.length, openAtEnd: (result.openPositions || []).length,
    holdingSessions: { median: median(trades.map((t) => t.sessionsHeld)), longest: trades.length ? Math.max(...trades.map((t) => t.sessionsHeld)) : null },
    costs, turnoverPerYear: y > 0 ? sum(fills.map((f) => f.shares * f.price)) / avgEquity / y : null,
    netTradePnl: netPnl, postExitPaid: sum(trades.map((t) => t.postExitPaid)), skips: (result.skips || []).length, skipsByCode,
    oneShareEntries: fills.filter((f) => f.side === 'buy' && f.shares === 1).length, perStock,
    exits: trades.reduce((a, t) => ((a[t.exitReason] = (a[t.exitReason] || 0) + 1), a), {}),
    // Tier 2 descriptions (PLAN 7b): thresholds [OWNER TO CONFIRM], reported only.
    tier2: {
      thresholds: { ...tier2, status: '[OWNER TO CONFIRM]' },
      enoughTradesToCompare: trades.length >= tier2.minTrades,
      outcomes: { completed: trades.length, openAtEnd: open.length, pnl: outcomePnl, note: 'completed trades and positions open at the end (marked at the last close)' },
      withoutBestFivePct: { outcomesRemoved: nBest, pnl: withoutBest },
      topStock: topStock ? { symbol: topStock[0], pnl: topStock[1], sharePct: topShare, flagged: topShare != null && topShare > tier2.maxStockSharePct } : null,
    },
    // Hypothesis measures (PLAN section 5).
    hypotheses: {
      H1H2: { trades: rangeEntries.length, avgEntryPosInRange: mean(rangeEntries.map((t) => t.entryPosInRange).filter(fin)), breakdownShare: rangeEntries.length ? rangeEntries.filter((t) => t.exitReason === 'breakdown').length / rangeEntries.length : null, avgBreakdownPnl: mean(rangeEntries.filter((t) => t.exitReason === 'breakdown').map((t) => t.pnlTotal)), convertedToTrend: rangeEntries.filter((t) => t.convertedToTrend).length },
      H3H4: { trades: trendEntries.length, failedBreakoutShare: trendEntries.length ? trendEntries.filter((t) => t.exitReason === 'below_old_high').length / trendEntries.length : null, avgTrendPnl: mean(trendEntries.map((t) => t.pnlTotal)), breakoutsNeverEntered: (result.watches || []).filter((w) => !w.entered && w.endedOn != null).length },
      H5: { withinSessions: H5_WITHIN_SESSIONS, reentriesAboveLastSale: trades.filter((t) => t.afterSaleOf?.above).length, tradesWithinOfASale: near.length, pnlOfTradesWithinOfASale: sum(near.map((t) => t.pnlTotal)) },
    },
  };
  if (hold) {
    const holdPts = hold.equity.map((p) => ({ date: p.date, value: p.equity }));
    const a = summary(holdPts, start);
    const cPts = exposureMatched(eq, holdPts, start);
    const c = summary(cPts, start);
    out.benchmarks = {
      buyAndHold: a,
      cash: { startValue: start, endValue: start, totalReturnPct: 0, annualisedReturnPct: 0, maxDrawdownPct: 0, note: 'cash at 0%: labelled as cash, not an exposure-matched comparison' },
      exposureMatched: { ...c, label: 'derived: B(t) = B(t-1) x (1 + f(t-1) x r(t)); frictionless in its own rebalancing; f lags the run\'s open fills by part of a day' },
    };
    out.tradeOffVsExposureMatched = tradeOff(run, c);
  }
  return out;
}
