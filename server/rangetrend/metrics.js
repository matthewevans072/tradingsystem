// Range-trend metrics and benchmarks (PLAN-DRAFT.md v0.5 section 7, with the owner's decisions D4 and D5).
// Reporting only: no Tier 2 or Tier 3 threshold is enforced and no winner is selected.
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const count = (xs, key) => xs.reduce((a, x) => { const k = key(x); a[k] = (a[k] || 0) + 1; return a; }, {});

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

// (c) The exposure-matched hold: B(t) = B(t-1) x (1 + f(t-1) x r(t)), B(0) = start; r(t) = the index's
// return from close t-1 to close t (D4: benchmark (a)); f(t-1) = the run's holdings / account value at close
// t-1. Derived; frictionless in its own rebalancing.
export function exposureMatched(runEquity, indexEquity, start) {
  const idx = new Map(indexEquity.map((p) => [p.date, p.value]));
  const out = [];
  let B = start, prev = null, prevF = 0;
  for (const p of runEquity) {
    const h = idx.get(p.date);
    if (h == null) throw new Error(`exposure-matched hold: no index value on ${p.date}`);
    if (prev != null) B *= 1 + prevF * (h / prev - 1);
    out.push({ date: p.date, value: B });
    prev = h;
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

const LABELS = {
  index: 'derived: benchmark (a), an equal-weight buy-and-hold index of the basket (D4): fractional shares, no costs, never rebalanced; dividends net of withholding reinvested at the pay-date close; not an account that could be traded',
  exposureMatched: 'derived: B(t) = B(t-1) x (1 + f(t-1) x r(t)) with r from benchmark (a); frictionless in its own rebalancing; f lags the run\'s open fills by part of a day',
  hxrHoldArm: 'HXR\'s whole-share hold arm (the hxr-hold config run by the HXR engine on the same inputs): ten equal sleeves, whole shares at raw prices with costs, idle sleeve cash; reported beside benchmark (a), not the benchmark',
  cash: 'cash at 0%: labelled as cash, not an exposure-matched comparison',
};

export function computeMetrics(result, { hold = null, index = null, tier2 = { minTrades: 30, maxStockSharePct: 40 } } = {}) {
  const start = result.meta?.startingCash ?? 15000;
  const eq = result.equity.map((p) => ({ date: p.date, value: p.equity, invested: p.invested }));
  const run = summary(eq, start);
  const trades = tradePnls(result);
  const open = result.openPositions || [];
  const fills = result.fills || [];
  const warnings = result.warnings || [];
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
  // D5, per stock: signals; decision-time skips by code; fill-time cancellations and rejections by code;
  // 1-share entries; orders pending at the period's end; dividends entitled but unpaid at the end.
  const perStock = {};
  const ps = (sym) => (perStock[sym] = perStock[sym] || { signals: 0, entries: 0, oneShareEntries: 0, skips: {}, cancellations: {}, rejections: {}, pendingAtEnd: 0, unpaidDividends: { count: 0, net: 0 }, pnl: 0 });
  for (const d of (result.decisions || []).filter((x) => x.action === 'entry')) ps(d.symbol).signals++;
  for (const k of result.skips || []) { ps(k.symbol).signals++; ps(k.symbol).skips[k.code] = (ps(k.symbol).skips[k.code] || 0) + 1; }
  for (const f of fills.filter((x) => x.side === 'buy')) { ps(f.symbol).entries++; if (f.shares === 1) ps(f.symbol).oneShareEntries++; }
  const cancelled = warnings.filter((w) => w.code === 'order_cancelled'), rejected = warnings.filter((w) => w.code === 'entry_rejected');
  for (const w of cancelled) { const c = ps(w.symbol).cancellations, k = w.details?.code ?? 'unknown'; c[k] = (c[k] || 0) + 1; }
  for (const w of rejected) { const c = ps(w.symbol).rejections, k = w.details?.code ?? 'unknown'; c[k] = (c[k] || 0) + 1; }
  for (const o of result.pendingOrders || []) ps(o.symbol).pendingAtEnd++;
  for (const u of result.unpaidDividends || []) { const x = ps(u.symbol).unpaidDividends; x.count++; x.net += u.net; }
  for (const o of outcomes) ps(o.symbol).pnl += o.pnl;
  const skipsByCode = count(result.skips || [], (k) => k.code);
  const near = trades.filter((t) => t.afterSaleOf && t.afterSaleOf.sessionsSinceSale != null && t.afterSaleOf.sessionsSinceSale <= H5_WITHIN_SESSIONS);
  const rangeEntries = trades.filter((t) => t.entryType === 'dip' || t.entryType === 'recovery');
  const trendEntries = trades.filter((t) => t.entryType === 'immediate' || t.entryType === 'pullback');
  const watches = result.watches || [];
  // H4 counts only watches on stocks not held (and with no buy waiting to fill) when the breakout occurred.
  const neverEntered = watches.filter((w) => !w.entered && w.endedOn != null && !w.heldAtStart);

  const out = {
    ...run,
    sessions: eq.length, years: y,
    avgInvestedPct: mean(eq.map((p) => p.invested * 100)), timeInCashPct: mean(eq.map((p) => (1 - p.invested) * 100)),
    completedTrades: trades.length, openAtEnd: open.length,
    holdingSessions: { median: median(trades.map((t) => t.sessionsHeld)), longest: trades.length ? Math.max(...trades.map((t) => t.sessionsHeld)) : null },
    costs, turnoverPerYear: y > 0 ? sum(fills.map((f) => f.shares * f.price)) / avgEquity / y : null,
    netTradePnl: netPnl, postExitPaid: sum(trades.map((t) => t.postExitPaid)), skips: (result.skips || []).length, skipsByCode,
    cancellationsByCode: count(cancelled, (w) => w.details?.code ?? 'unknown'), rejectionsByCode: count(rejected, (w) => w.details?.code ?? 'unknown'),
    pendingAtEnd: (result.pendingOrders || []).length, unpaidDividendsAtEnd: { count: (result.unpaidDividends || []).length, net: sum((result.unpaidDividends || []).map((u) => u.net)) },
    oneShareEntries: fills.filter((f) => f.side === 'buy' && f.shares === 1).length, perStock,
    exits: count(trades, (t) => t.exitReason), breaks: count(result.breaks || [], (b) => b.kind),
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
      H3H4: { trades: trendEntries.length, failedBreakoutShare: trendEntries.length ? trendEntries.filter((t) => t.exitReason === 'below_old_high').length / trendEntries.length : null, avgTrendPnl: mean(trendEntries.map((t) => t.pnlTotal)), breakoutsNeverEntered: neverEntered.length, watchesEnded: watches.filter((w) => w.endedOn != null).length, watchesWhileHeld: watches.filter((w) => w.heldAtStart).length },
      // reentriesAboveLastSale counts every filled entry (open positions included) decided at a close at or above
      // the stock's last sale price P; completedTradesAboveLastSale only the completed ones.
      H5: { withinSessions: H5_WITHIN_SESSIONS, reentriesAboveLastSale: fills.filter((f) => f.side === 'buy' && f.afterSaleOf?.above).length, completedTradesAboveLastSale: trades.filter((t) => t.afterSaleOf?.above).length, tradesWithinOfASale: near.length, pnlOfTradesWithinOfASale: sum(near.map((t) => t.pnlTotal)), reentryLimitSkips: skipsByCode.reentry_limit || 0, reentryLimitCancellations: cancelled.filter((w) => w.details?.code === 'reentry_limit').length },
    },
  };
  // Benchmarks: (a) the index (D4), (b) cash, (c) the exposure-matched hold derived from (a); HXR's whole-share
  // hold arm beside them, labelled as such. Each is labelled; none is a run in the budget.
  if (index || hold) {
    out.benchmarks = { cash: { startValue: start, endValue: start, totalReturnPct: 0, annualisedReturnPct: 0, maxDrawdownPct: 0, note: LABELS.cash } };
    if (index) {
      const idxPts = index.map((p) => ({ date: p.date, value: p.value }));
      out.benchmarks.buyAndHold = { ...summary(idxPts, start), label: LABELS.index };
      const c = summary(exposureMatched(eq, idxPts, start), start);
      out.benchmarks.exposureMatched = { ...c, label: LABELS.exposureMatched };
      out.tradeOffVsExposureMatched = tradeOff(run, c);
    }
    if (hold) out.benchmarks.hxrHoldArm = { ...summary(hold.equity.map((p) => ({ date: p.date, value: p.equity })), start), label: LABELS.hxrHoldArm };
  }
  return out;
}
