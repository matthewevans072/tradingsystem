// The evaluation pass (the order's section 1): outcomes are computed only from saved actions (fills, sells, splits,
// dividends) and the daily closes, never inside the decision process. It rebuilds cash, positions, trades and the daily
// equity, then reports with the shared metrics (server/rangetrend/metrics.js), the equal-weight buy-and-hold of the
// basket over the same dates and the run's exposure-matched hold. T = net profit minus the exposure-matched hold's net
// profit (the placebo's statistic).
import { computeMetrics, exposureMatched } from '../rangetrend/metrics.js';
import { holdIndex } from '../rangetrend/benchmark.js';
import { accountingCheck } from '../research/runner.js';

const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const sum = (a) => a.reduce((x, y) => x + y, 0);

export function evaluateActions(actions, mk, { from, to, startingCash, symbols }) {
  const sorted = [...actions].map((a, i) => ({ ...a, _i: i })).sort((a, b) => a.ms - b.ms || a._i - b._i);
  let cash = startingCash;
  const pos = new Map(), trades = [], fills = [], postExit = [], equity = [];
  const closed = new Set();
  for (const a of sorted) {
    const d = a.detail;
    if (a.kind === 'buy') {
      cash -= d.cost;
      pos.set(a.stock, { tradeId: d.tradeId, shares: d.shares, cost: d.cost, entryDate: d.date, entryPrice: d.price, dividends: 0, cil: 0, planT: d.T });
      fills.push({ side: 'buy', symbol: a.stock, shares: d.shares, price: d.price, spreadSlippage: d.shares * (d.price - d.raw), fees: 0, date: d.date });
    } else if (a.kind === 'sell') {
      const p = pos.get(a.stock);
      cash += d.proceeds;
      fills.push({ side: 'sell', symbol: a.stock, shares: d.shares, price: d.price, spreadSlippage: d.shares * (d.raw - d.price), fees: d.fees, date: d.date });
      const pnl = d.proceeds + p.dividends + p.cil - p.cost;
      const held = mk.sessionIndex.get(d.date) - mk.sessionIndex.get(p.entryDate);
      trades.push({ tradeId: p.tradeId, symbol: a.stock, kind: 'replay', entryType: 'replay', entryDate: p.entryDate, exitDate: d.date, exitReason: d.reason, shares: d.shares, cost: p.cost, proceeds: d.proceeds, dividends: p.dividends, cashInLieu: p.cil, pnl, pnlPct: p.cost > 0 ? (pnl / p.cost) * 100 : null, sessionsHeld: held, planT: p.planT });
      pos.delete(a.stock); closed.add(p.tradeId);
    } else if (a.kind === 'split') { const p = pos.get(a.stock); if (p) p.shares = d.sharesAfter; }
    else if (a.kind === 'dividend_paid' || a.kind === 'cash_in_lieu') {
      cash += d.amount;
      const p = pos.get(a.stock);
      if (p && p.tradeId === d.tradeId) { if (a.kind === 'dividend_paid') p.dividends += d.amount; else p.cil += d.amount; }
      else postExit.push({ tradeId: d.tradeId, symbol: a.stock, kind: a.kind, amount: d.amount });
    } else if (a.kind === 'close') {
      if (d.date < from || d.date > to) continue;
      let holdings = 0;
      for (const [s, p] of pos) { const b = mk.daily.get(s)?.get(d.date); holdings += p.shares * (b ? b.c : p.entryPrice); }
      const eq = cash + holdings;
      equity.push({ date: d.date, cash, holdings, equity: eq, invested: eq > 0 ? holdings / eq : 0 });
    }
  }
  const lastDate = equity.at(-1)?.date;
  const openPositions = [...pos.entries()].map(([s, p]) => { const b = mk.daily.get(s)?.get(lastDate); const value = p.shares * (b ? b.c : p.entryPrice); return { tradeId: p.tradeId, symbol: s, entryDate: p.entryDate, shares: p.shares, value, cost: p.cost, pnl: value + p.dividends + p.cil - p.cost }; });
  return { equity, trades, fills, postExit, openPositions, skips: [], warnings: [], decisions: [], pendingOrders: [], unpaidDividends: [], meta: { startingCash, symbols } };
}

export function indexFor(inputs, { from, startingCash, withholdingPct = 15 }) {
  return holdIndex({ symbols: inputs.symbols, sessions: inputs.sessions, days: inputs.days, start: from, startingCash, withholdingPct });
}
export function tOf(result, index, startingCash) {
  const eq = result.equity.map((p) => ({ date: p.date, value: p.equity, invested: p.invested }));
  if (!eq.length) return 0;
  const em = exposureMatched(eq, index.filter((p) => p.date >= eq[0].date).map((p) => ({ date: p.date, value: p.value })), startingCash);
  return (eq.at(-1).value - startingCash) - (em.at(-1).value - startingCash);
}

export function report(result, { index, startingCash, signals = [], plansMeta = null }) {
  const idx = index.filter((p) => p.date >= result.equity[0].date);
  const m = computeMetrics(result, { index: idx });
  const acc = accountingCheck(result, m, { tolerance: 0.05 });
  const eq = result.equity.map((p) => ({ date: p.date, value: p.equity, invested: p.invested }));
  const em = exposureMatched(eq, idx.map((p) => ({ date: p.date, value: p.value })), startingCash);
  const net = m.endValue - startingCash, emNet = em.at(-1).value - startingCash;
  const years = [...new Set(eq.map((p) => p.date.slice(0, 4)))];
  const netIn = (pts, y) => { const before = pts.filter((p) => p.date < `${y}-01-01`).at(-1)?.value ?? startingCash; const end = pts.filter((p) => p.date <= `${y}-12-31`).at(-1)?.value; return end - before; };
  const fates = signals.reduce((a, s) => { a[s.fate] = (a[s.fate] || 0) + 1; return a; }, {});
  const trades = result.trades;
  return {
    net: r2(net), endValue: r2(m.endValue), totalReturnPct: r2(m.totalReturnPct), annualisedReturnPct: r2(m.annualisedReturnPct), maxDrawdownPct: r2(m.maxDrawdownPct),
    avgInvestedPct: r2(m.avgInvestedPct), timeInCashPct: r2(m.timeInCashPct), turnoverPerYear: r2(m.turnoverPerYear), costs: r2(m.costs),
    completedTrades: m.completedTrades, openAtEnd: m.openAtEnd, holdingSessions: m.holdingSessions, exits: m.exits,
    perStock: Object.fromEntries(Object.entries(m.perStock).map(([s, v]) => [s, r2(v.pnl)])),
    concentration: { topStock: m.tier2.grossGain.maxSymbol, topShare: m.tier2.grossGain.maxShare == null ? null : Math.round(m.tier2.grossGain.maxShare * 1e4) / 1e4 },
    annual: Object.fromEntries(years.map((y) => [y, { net: r2(netIn(eq, y)), exposureMatchedNet: r2(netIn(em, y)), indexNet: r2(netIn(idx, y)) }])),
    index: { net: r2(m.benchmarks.buyAndHold.endValue - startingCash), annualisedReturnPct: r2(m.benchmarks.buyAndHold.annualisedReturnPct), maxDrawdownPct: r2(m.benchmarks.buyAndHold.maxDrawdownPct) },
    exposureMatched: { net: r2(emNet), maxDrawdownPct: r2(m.benchmarks.exposureMatched.maxDrawdownPct) },
    T: r2(net - emNet), signalFates: fates, missed: { expired: fates.expired || 0, noSetup: fates.no_setup || 0, rejected: fates.rejected || 0, cancelled: fates.cancelled || 0, alreadyHeld: fates.already_held || 0, disarmed: fates.disarmed || 0 },
    lossTrades: trades.filter((t) => t.pnl < 0).length, winTrades: trades.filter((t) => t.pnl > 0).length, tradePnl: r2(sum(trades.map((t) => t.pnl))),
    accounting: { ok: acc.ok, problems: acc.problems }, plans: plansMeta,
  };
}

// Every entry plan's fate (master work order v3, Phase A), from the saved actions only: neither activated, bearish
// activated, bullish activated and then filled (gain, loss at exit, invalidated, open at the end), or not filled
// (funding or caps rejected, the invalidation level at or above the fill, no setup, expired, cancelled, already held,
// disarmed). categories: planId -> event category. Also the trades' P/L by category.
export function planFates(actions, trades, openPositions, categories = new Map()) {
  const act = new Map(), sig = new Map(), buyTrade = new Map();
  for (const a of actions) {
    const d = a.detail;
    if (a.kind === 'activation' && !d.followUp && d.planId != null) act.set(d.planId, d.dir);
    if (a.kind === 'signal' && d.planId != null) sig.set(d.planId, d);
    if (a.kind === 'buy' && d.planId != null) buyTrade.set(d.planId, d.tradeId);
  }
  const tradeBy = new Map(trades.map((t) => [t.tradeId, t]));
  const openBy = new Map((openPositions || []).map((p) => [p.tradeId, p]));
  const fates = {}, byCat = {};
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const [planId, dir] of act) {
    const cat = categories.get(planId) ?? 'unknown';
    const c = (byCat[cat] ||= { plans: 0, fates: {}, trades: 0, pnl: 0, wins: 0 });
    c.plans++;
    let fate;
    if (dir === 'none') fate = 'neither_activated';
    else if (dir === 'bear') fate = 'bearish_activated';
    else {
      const s = sig.get(planId);
      if (!s) fate = 'bullish_activated_no_record';
      else if (s.fate === 'filled') {
        const t = tradeBy.get(buyTrade.get(planId)), o = openBy.get(buyTrade.get(planId));
        if (t) { fate = t.exitReason === 'invalidation' ? 'activated_then_invalidated' : t.pnl < 0 ? 'activated_then_loss_at_exit' : 'activated_then_gain'; c.trades++; c.pnl += t.pnl; if (t.pnl > 0) c.wins++; }
        else if (o) { fate = 'activated_open_at_end'; c.trades++; c.pnl += o.pnl; if (o.pnl > 0) c.wins++; }
        else fate = 'activated_filled';
      } else if (s.fate === 'rejected') fate = /funding or caps/.test(s.why || '') ? 'funding_or_caps_rejected' : 'rejected_invalidation_at_or_above_fill';
      else fate = s.fate;
    }
    inc(fates, fate); inc(c.fates, fate);
  }
  for (const c of Object.values(byCat)) c.pnl = r2(c.pnl);
  return { fates, byCategory: byCat };
}
