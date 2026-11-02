// Range-trend metrics and benchmarks (PLAN-DRAFT.md v0.6 section 7, with the owner's decisions D4 and D5 and
// the adopted pick-rule inputs of PROPOSED-RULES.md definitions 1-7). Reporting only: no Tier 2 or Tier 3
// threshold is enforced here and no winner is selected (pick.js reports; it never advances anything).
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const count = (xs, key) => xs.reduce((a, x) => { const k = key(x); a[k] = (a[k] || 0) + 1; return a; }, {});
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The adopted experimental defaults (PROPOSED-RULES.md, the owner's message of 2026-11-02).
export const N_COMPLETED = 30;
export const GROSS_GAIN_MAX = 0.40;
export const TIE_POINTS = 0.005;
// Money is compared in integer cents: each amount rounded to the nearest cent, then compared exactly.
export const toCents = (x) => Math.round(x * 100);

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
// deeper maximum drawdown than (c), or beats (c) on return per unit of maximum drawdown. Reported, not enforced;
// the adopted pick rule (pick.js) requires all three of its tests, and return per drawdown alone never advances.
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

// Definitions 1-3. A completed trade is a closed trade with a recorded exit (a position closed by
// split_no_whole_share counts); positions open at the end do not count toward N but are outcomes, valued at
// the last close with no exit costs deducted (result.openPositions[].pnl). One outcome per trade or position.
export function outcomesOf(result) {
  const completed = tradePnls(result).map((t) => ({ kind: 'trade', symbol: t.symbol, tradeId: t.tradeId, entryDate: t.entryDate, pnl: t.pnlTotal }));
  const open = (result.openPositions || []).map((o) => ({ kind: 'open', symbol: o.symbol, tradeId: o.tradeId, entryDate: o.entryDate, pnl: o.pnl }));
  return { completed, open, outcomes: [...completed, ...open], completedTrades: completed.length };
}

// Definition 4. P(s) = the sum of stock s's outcomes; G = the sum over stocks of max(0, P(s)); share(s) =
// max(0, P(s)) / G. The gate: max share <= maxShare (0.40), compared exactly in integer cents as
// 100 x max(0, P(s)) cents <= (maxShare x 100) x G cents. Losing stocks count as zero and are never subtracted.
// G = 0 makes the share undefined (the run does not qualify). The net-based share P(s) / sum of P(s) (null when
// the net total is zero or negative) is information only, never a gate.
export function grossGainShare(outcomes, { maxShare = GROSS_GAIN_MAX } = {}) {
  const P = {};
  for (const o of outcomes) P[o.symbol] = (P[o.symbol] || 0) + o.pnl;
  const cents = Object.fromEntries(Object.entries(P).map(([s, v]) => [s, toCents(v)]));
  const G = Object.values(cents).reduce((a, c) => a + Math.max(0, c), 0);
  const net = Object.values(cents).reduce((a, c) => a + c, 0);
  const perStock = Object.fromEntries(Object.entries(cents).map(([s, c]) => [s, { pnl: P[s], pnlCents: c, share: G > 0 ? Math.max(0, c) / G : null, netShare: net > 0 ? c / net : null }]));
  const symbols = Object.keys(cents);
  const maxSymbol = symbols.length ? symbols.reduce((a, s) => (cents[s] > cents[a] ? s : a)) : null;
  const maxCents = maxSymbol ? Math.max(0, cents[maxSymbol]) : 0;
  const limitPct = Math.round(maxShare * 100);
  const passes = G > 0 && maxCents * 100 <= limitPct * G;
  return {
    maxShareLimit: maxShare, grossGain: G / 100, grossGainCents: G, netTotal: net / 100, winners: symbols.filter((s) => cents[s] > 0).length,
    maxSymbol, maxShare: G > 0 ? maxCents / G : null, maxNetShare: maxSymbol && net > 0 ? cents[maxSymbol] / net : null, undefined: G === 0, passes, perStock,
  };
}

// Definition 6, the robustness test (best-5% removal): a stress calculation, not a re-simulation. n outcomes;
// K = ceil(0.05 x n), at least 1; the K outcomes with the highest P/L are removed (ties: the earlier entry
// date, then the symbol, then the trade id); adjustedNetPL = the sum of all outcomes minus the removed sum;
// adjustedEnd = startingCash + adjustedNetPL; adjustedAnnualised = (adjustedEnd / startingCash)^(1 / years) - 1
// with the run's own years. It holds only if adjustedNetPL > 0 (in cents) and adjustedAnnualised is above the
// exposure-matched hold's annualised return. Removing outcomes changes no later sizing; the drawdown is not
// recomputed.
export function bestFiveRemoval(outcomes, { startingCash, years: y, holdAnnualised }) {
  const n = outcomes.length, K = Math.max(1, Math.ceil(0.05 * n));
  const sorted = [...outcomes].sort((a, b) => b.pnl - a.pnl || cmp(a.entryDate, b.entryDate) || cmp(a.symbol, b.symbol) || cmp(a.tradeId, b.tradeId));
  const removed = sorted.slice(0, K);
  const removedPL = sum(removed.map((o) => o.pnl)), totalPL = sum(outcomes.map((o) => o.pnl));
  const adjustedNetPL = totalPL - removedPL, adjustedEnd = startingCash + adjustedNetPL;
  const adjustedAnnualised = fin(y) && y > 0 && adjustedEnd > 0 ? Math.pow(adjustedEnd / startingCash, 1 / y) - 1 : null;
  const holds = toCents(adjustedNetPL) > 0 && adjustedAnnualised != null && fin(holdAnnualised) && adjustedAnnualised > holdAnnualised;
  return {
    n, K, removed: removed.map(({ kind, symbol, tradeId, entryDate, pnl }) => ({ kind, symbol, tradeId, entryDate, pnl })), removedPL, totalPL, adjustedNetPL, adjustedEnd, years: y, adjustedAnnualised, holdAnnualised, holds,
    note: 'a stress calculation, not a re-simulation: removing outcomes after the fact changes no later sizing, and the drawdown is not recomputed',
  };
}

// Definitions 5-7 as far as one run's metrics can tell: the trade count, the gross-gain gate, the three tests
// against the run's own exposure-matched hold (c) and the score. Whether the run was recorded without error is
// the ledger's knowledge (pick.js). Rates are decimal fractions.
export function pickInputs(result, { run, c, startingCash }) {
  const { outcomes, completedTrades } = outcomesOf(result);
  const eq = result.equity || [];
  const y = eq.length ? years(eq[0].date, eq.at(-1).date) : null;
  const annualised = fin(run?.annualisedReturnPct) ? run.annualisedReturnPct / 100 : null;
  const holdAnnualised = fin(c?.annualisedReturnPct) ? c.annualisedReturnPct / 100 : null;
  const maxDrawdownF = fin(run?.maxDrawdownPct) ? run.maxDrawdownPct / 100 : null;
  const holdMaxDrawdown = fin(c?.maxDrawdownPct) ? c.maxDrawdownPct / 100 : null;
  const grossGain = grossGainShare(outcomes);
  const bestFive = bestFiveRemoval(outcomes, { startingCash, years: y, holdAnnualised });
  const tests = {
    returnTest: annualised != null && holdAnnualised != null && annualised > holdAnnualised,
    drawdownTest: maxDrawdownF != null && holdMaxDrawdown != null && maxDrawdownF <= holdMaxDrawdown,
    robustnessTest: bestFive.holds,
  };
  const passesComparison = tests.returnTest && tests.drawdownTest && tests.robustnessTest;
  return {
    settings: { completedTrades: N_COMPLETED, grossGainMaxShare: GROSS_GAIN_MAX, tiePoints: TIE_POINTS, status: 'adopted experimental defaults (the owner, 2026-11-02)' },
    completedTrades, enoughTrades: completedTrades >= N_COMPLETED, outcomes: outcomes.length,
    annualised, holdAnnualised, maxDrawdown: maxDrawdownF, holdMaxDrawdown, grossGain, bestFive, tests, passesComparison,
    score: passesComparison ? annualised - holdAnnualised : null,
    note: 'return per unit of drawdown alone never advances a variant; the choice is a report (pick.js), never automatic',
  };
}

// H5 (PLAN section 5): trades whose entry fills within `within` sessions after a sale of the same stock.
export const H5_WITHIN_SESSIONS = 20;

const LABELS = {
  index: 'derived: benchmark (a), an equal-weight buy-and-hold index of the basket (D4): fractional shares, no costs, never rebalanced; dividends net of withholding reinvested at the pay-date close; not an account that could be traded',
  exposureMatched: 'derived: B(t) = B(t-1) x (1 + f(t-1) x r(t)) with r from benchmark (a); frictionless in its own rebalancing; f lags the run\'s open fills by part of a day',
  hxrHoldArm: 'HXR\'s whole-share hold arm (the hxr-hold config run by the HXR engine on the same inputs): ten equal sleeves, whole shares at raw prices with costs, idle sleeve cash; reported beside benchmark (a), not the benchmark',
  cash: 'cash at 0%: labelled as cash, not an exposure-matched comparison',
};

export function computeMetrics(result, { hold = null, index = null, tier2 = { minTrades: N_COMPLETED, maxStockSharePct: GROSS_GAIN_MAX * 100 } } = {}) {
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
  // Definitions 1-4 on every outcome: completed trades and the positions open at the end, marked at the last close.
  const { outcomes } = outcomesOf(result);
  const outcomePnl = sum(outcomes.map((o) => o.pnl));
  const grossGain = grossGainShare(outcomes);
  const bestFive = bestFiveRemoval(outcomes, { startingCash: start, years: y, holdAnnualised: null });
  // D5, per stock: signals; decision-time skips by code; fill-time cancellations and rejections by code;
  // 1-share entries; orders pending at the period's end; dividends entitled but unpaid at the end.
  const perStock = {};
  const ps = (sym) => (perStock[sym] = perStock[sym] || { signals: 0, entries: 0, oneShareEntries: 0, skips: {}, cancellations: {}, rejections: {}, pendingAtEnd: 0, unpaidDividends: { count: 0, net: 0 }, pnl: 0 });
  for (const s of result.meta?.symbols || []) ps(typeof s === 'string' ? s : s.symbol); // every basket stock has a row, with zeros
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
    // Tier 2 descriptions (PLAN 7b) with the adopted experimental defaults; reported only.
    tier2: {
      thresholds: { ...tier2, status: 'adopted experimental defaults (the owner, 2026-11-02): reported, never enforced here' },
      enoughTradesToCompare: trades.length >= tier2.minTrades,
      outcomes: { completed: trades.length, openAtEnd: open.length, pnl: outcomePnl, note: 'completed trades and positions open at the end (marked at the last close, no exit costs deducted)' },
      withoutBestFivePct: { outcomesRemoved: bestFive.K, removed: bestFive.removed, removedPL: bestFive.removedPL, pnl: bestFive.adjustedNetPL, adjustedEnd: bestFive.adjustedEnd, note: bestFive.note },
      grossGain: { ...grossGain, note: 'the single-stock gross-gain share gate (definition 4); netShare is information only, never a gate' },
      topStock: grossGain.maxSymbol ? { symbol: grossGain.maxSymbol, pnl: grossGain.perStock[grossGain.maxSymbol].pnl, sharePct: grossGain.maxShare == null ? null : grossGain.maxShare * 100, netSharePct: grossGain.maxNetShare == null ? null : grossGain.maxNetShare * 100, flagged: !grossGain.passes } : null,
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
      // The adopted pick rule's inputs for this run (definitions 5-7), against (c).
      out.pick = pickInputs(result, { run, c, startingCash: start });
    }
    if (hold) out.benchmarks.hxrHoldArm = { ...summary(hold.equity.map((p) => ({ date: p.date, value: p.equity })), start), label: LABELS.hxrHoldArm };
  }
  return out;
}
