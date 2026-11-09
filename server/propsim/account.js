// The simulated Lucid account (CAMPAIGN-1.md sections 7 and 8; LUCID-RULES-2026-11-09.json, the stricter readings).
// Each trade comes with its result and its worst adverse excursion from the fill (MAE), both in ticks per contract; one
// position at a time, so the live balance at the worst point of a trade is the balance before it minus the MAE. The
// breach (live balance at or below the Max Loss Limit) and LucidPro's daily loss limit (realized plus open) are tested
// at that worst point first; the end-of-day trailing MLL, the pass, the funded stage and the first payout are tested
// at each session's close. Simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with
// or endorsed by Lucid. Pure and deterministic.
const r2 = (x) => Math.round(x * 100) / 100;

export function contractsFor({ room, riskTicks, tickValue, exec, cap }) {
  const budget = Math.min(exec.riskShareOfRoom * room, exec.riskCapUsd);
  const lossPer = (riskTicks + exec.entrySlippageTicks + exec.stopSlippageTicks) * tickValue + 2 * exec.commissionPerMicroSide;
  return Math.max(0, Math.min(cap, Math.floor((budget + 1e-9) / lossPer)));
}

// One trade on the account: { pnl, breached, dllHit, n, worst }.
export function applyTrade({ bal, mll, dayPnl, dll, trade, tickValue, exec, cap }) {
  const n = contractsFor({ room: bal - mll, riskTicks: trade.riskTicks, tickValue, exec, cap });
  if (n < 1) return { skipped: 'unfunded', pnl: 0, n: 0 };
  const comm = 2 * exec.commissionPerMicroSide * n;
  const worst = -trade.maeTicks * tickValue * n - comm; // the live result at the worst point, all costs counted
  const thBreach = mll - bal; // the loss at which the live balance reaches the MLL (negative)
  const thDll = dll == null ? -Infinity : -dll - dayPnl;
  if (worst <= Math.max(thBreach, thDll)) {
    if (thBreach >= thDll) return { breached: true, pnl: thBreach, n, worst };
    const pnl = thDll - tickValue * n * exec.stopSlippageTicks; // closed at the limit, less 1 tick
    return { dllHit: true, pnl, n, worst, breached: bal + pnl <= mll };
  }
  return { pnl: trade.resultTicks * tickValue * n - comm, n, worst };
}

// A plan from matrix-1.json's accounts: { plan, size, profitTarget, maxLoss, lockedMll, consistency, dailyLossLimit,
// evalContracts, fundedScaling | fundedContracts, fundedDll, payout, fee }.
// fundedCap, fundedDll and stage are exported for the live account (server/propsim/live.js), which applies these same
// rules one session at a time; no change to any result.
export function fundedCap(plan, profitAtClose) {
  if (plan.fundedScaling) { for (const [below, c] of plan.fundedScaling) if (below == null || profitAtClose < below) return c; }
  return plan.fundedContracts ?? plan.evalContracts;
}
export function fundedDll(plan, maxClose) {
  if (!plan.fundedDll) return null;
  return maxClose > plan.fundedDll.trailBalance ? plan.fundedDll.scaleShare * (maxClose - plan.size) : plan.fundedDll.fixed;
}

// One stage on the account from session index i0: returns { outcome, end, ... }.
export function stage({ kind, plan, dayTrades, i0, horizon, lastIndex, tickValue, exec }) {
  let bal = plan.size, maxClose = plan.size, mll = plan.size - plan.maxLoss;
  const days = [];
  let roomUsed = 0, dllDays = 0, trades = 0;
  for (let i = i0; i <= lastIndex && i < i0 + horizon; i++) {
    let dayPnl = 0, dllHit = false;
    const profitAtClose = bal - plan.size;
    const cap = kind === 'eval' ? plan.evalContracts : fundedCap(plan, profitAtClose);
    const dll = kind === 'eval' ? plan.dailyLossLimit : fundedDll(plan, maxClose);
    for (const t of dayTrades[i] || []) {
      if (dllHit) break;
      const r = applyTrade({ bal, mll, dayPnl, dll, trade: t, tickValue, exec, cap });
      if (r.skipped) continue;
      trades++;
      roomUsed = Math.max(roomUsed, Math.min(1, Math.max(0, 1 - (bal + r.worst - mll) / plan.maxLoss)));
      if (r.breached) { bal = Math.min(bal + r.pnl, mll); return { outcome: 'breached', end: i, sessions: i - i0 + 1, bal: r2(bal), roomUsed, dllDays, trades, days }; }
      bal += r.pnl; dayPnl += r.pnl;
      if (r.dllHit) { dllHit = true; dllDays++; }
    }
    days.push(dayPnl);
    maxClose = Math.max(maxClose, bal);
    mll = Math.min(Math.max(mll, maxClose - plan.maxLoss), plan.lockedMll);
    const profit = bal - plan.size;
    if (kind === 'eval') {
      const best = Math.max(0, ...days);
      if (profit >= plan.profitTarget && (plan.consistency == null || best <= plan.consistency * profit + 1e-9)) return { outcome: 'passed', end: i, sessions: i - i0 + 1, bal: r2(bal), roomUsed, dllDays, trades, days };
    } else {
      const p = plan.payout;
      let amount = null;
      if (p.minDays != null) {
        if (days.filter((x) => x >= p.minDayProfit).length >= p.minDays && profit > 0) amount = Math.min(p.share * profit, p.max);
      } else if (profit >= p.minCycleProfit && Math.max(0, ...days) <= p.consistency * profit + 1e-9) amount = Math.min(bal - p.buffer, p.max);
      if (amount != null && amount >= p.min) return { outcome: 'payout', end: i, sessions: i - i0 + 1, bal: r2(bal), payout: r2(amount), traderPayout: r2(amount * p.split), roomUsed, dllDays, trades, days };
    }
  }
  const ranOut = i0 + horizon - 1 > lastIndex;
  return { outcome: ranOut ? 'unfinished' : 'timeout', end: Math.min(lastIndex, i0 + horizon - 1), sessions: Math.min(horizon, lastIndex - i0 + 1), bal: r2(bal), roomUsed, dllDays, trades, days };
}

// Every attempt: one evaluation from each eligible session, then the funded stage after a pass.
export function runAttempts({ dates, trades, plan, tickValue, exec, horizons }) {
  const index = new Map(dates.map((d, i) => [d, i]));
  const dayTrades = dates.map(() => []);
  for (const t of trades) { const i = index.get(t.date); if (i != null) dayTrades[i].push(t); }
  const lastIndex = dates.length - 1;
  const out = [];
  for (let i0 = 0; i0 + horizons.evaluationSessions - 1 <= lastIndex; i0++) {
    const ev = stage({ kind: 'eval', plan, dayTrades, i0, horizon: horizons.evaluationSessions, lastIndex, tickValue, exec });
    const a = { start: dates[i0], month: dates[i0].slice(0, 7), eval: ev.outcome, evalSessions: ev.sessions, roomUsed: r2(ev.roomUsed), dllDays: ev.dllDays, evalTrades: ev.trades, funded: null, traderPayout: 0 };
    if (ev.outcome === 'passed') {
      a.daysToPass = ev.sessions;
      if (ev.end + 1 > lastIndex) a.funded = 'unfinished';
      else {
        const fu = stage({ kind: 'funded', plan, dayTrades, i0: ev.end + 1, horizon: horizons.fundedSessions, lastIndex, tickValue, exec });
        a.funded = fu.outcome; a.fundedSessions = fu.sessions; a.dllDays += fu.dllDays;
        if (fu.outcome === 'payout') { a.payout = fu.payout; a.traderPayout = fu.traderPayout; }
      }
    }
    out.push(a);
  }
  return out;
}

// Pass counts by start month (for the month resampling).
export function monthCounts(attempts) {
  const m = {};
  for (const a of attempts) { const x = (m[a.month] ||= [0, 0]); x[1]++; if (a.eval === 'passed') x[0]++; }
  return m;
}
export function summarize(attempts, trades, plan, tickValue, exec) {
  const n = attempts.length;
  const passed = attempts.filter((a) => a.eval === 'passed');
  const pays = attempts.filter((a) => a.funded === 'payout');
  const days = passed.map((a) => a.daysToPass).sort((x, y) => x - y);
  const traderMean = n ? attempts.reduce((s, a) => s + a.traderPayout, 0) / n : 0;
  let streak = 0, worstStreak = 0;
  for (const t of trades) { const net = t.resultTicks * tickValue - 2 * exec.commissionPerMicroSide; if (net < 0) { streak++; worstStreak = Math.max(worstStreak, streak); } else streak = 0; }
  const room = attempts.map((a) => a.roomUsed).sort((x, y) => x - y);
  const count = (k, v) => attempts.filter((a) => a[k] === v).length;
  return {
    attempts: n, passRate: n ? passed.length / n : 0, passed: passed.length, failed: count('eval', 'breached'), timedOut: count('eval', 'timeout'),
    medianDaysToPass: days.length ? days[Math.floor((days.length - 1) / 2)] : null,
    payoutRate: n ? pays.length / n : 0, payoutRatePerPass: passed.length ? pays.length / passed.length : 0, payouts: pays.length,
    fundedBreached: count('funded', 'breached'), fundedTimeout: count('funded', 'timeout'), fundedUnfinished: count('funded', 'unfinished'),
    beforeFee: r2(traderMean), fee: plan.fee, expectedNet: r2(traderMean - plan.fee),
    completedTrades: trades.length, worstLosingStreak: worstStreak, medianRoomUsed: room.length ? room[Math.floor((room.length - 1) / 2)] : null,
    dllDays: attempts.reduce((s, a) => s + a.dllDays, 0),
  };
}
