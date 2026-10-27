// Range-trend engine (strategy/range-trend/PLAN-DRAFT.md v0.3 sections 3, 4 and 6a).
// Simulation only: daily bars, decisions after the close, fills at the next open.
// Streaming and deterministic: processSession(date, day) in session order; levels
// for a decision on day t use closes up to t-1 only (no look-ahead).
import crypto from 'node:crypto';
import { canonicalJson } from '../strategy/config.js';
import { sellFees } from '../hxr/engine.js';
import { rangeState, isDip, isRecovery, isBreakout, isPullbackClose, EPS, le, ge, gt, lt } from './levels.js';
import { configHash, validateConfig } from './config.js';

export const ENGINE_VERSION = 'rt-engine-2';
const clone = (o) => JSON.parse(JSON.stringify(o));
const HIST = (L) => Math.max(L.windowSessions, L.mSessions + 1) + 1;

// Section 6a sizing at one price: the smallest of the cash share (at price x (1 + k) plus commissions), the
// position cap, risk per trade and the risk-room share; whole shares rounded down. `binding` lists the caps at
// or below the result. Used at the decision close; the fill applies the same limits at the fill price.
export function sizeEntry({ price, stop, cashShare, roomShare = null, capUsd, riskUsd, k = 0, commissionPerOrder = 0, commissionPerShare = 0 }) {
  const dist = price - stop;
  const caps = {
    cash: Math.floor((cashShare - commissionPerOrder) / (price * (1 + k) + commissionPerShare) + EPS),
    position: Math.floor(capUsd / price + EPS),
    riskPerTrade: Math.floor(riskUsd / dist + EPS),
    riskRoom: roomShare == null ? null : Math.floor(roomShare / dist + EPS),
  };
  const shares = dist > EPS ? Math.max(0, Math.min(...Object.values(caps).filter((v) => v != null))) : 0;
  const binding = Object.entries(caps).filter(([, v]) => v != null && v <= shares).map(([key]) => key);
  return { shares, caps, binding, plannedRisk: shares * dist, distance: dist };
}

export function createEngine({ config, symbols, halfSpreadBps, state = null } = {}) {
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`Range-trend engine: invalid config: ${errors.join('; ')}`);
  if (!Array.isArray(symbols) || !symbols.length) throw new Error('Range-trend engine: symbols must be a non-empty list');
  const L = config.levels, X = config.exits, P = config.portfolio, costs = config.costs;
  const cHash = configHash(config);
  const spread = typeof halfSpreadBps === 'function' ? halfSpreadBps : typeof halfSpreadBps === 'number' ? () => halfSpreadBps : null;
  if (!spread) throw new Error('Range-trend engine: halfSpreadBps (a number or a function of symbol and date) is required');
  const hs = (sym, date) => Math.max(costs.halfSpreadFloorBps, spread(sym, date));
  const kOf = (sym, date) => (hs(sym, date) + costs.slippageBps) / 10000;
  const list = symbols.map((s) => (typeof s === 'string' ? { symbol: s } : s)).map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi }));
  let S;
  if (state) {
    S = clone(state);
    if (S.configHash !== cHash) throw new Error('The saved range-trend state belongs to a different config');
  } else {
    S = {
      engineVersion: ENGINE_VERSION, configHash: cHash, symbols: list, period: { ...config.period }, cash: P.startingCash, lastDate: null,
      stocks: Object.fromEntries(list.map((s) => [s.symbol, {
        symbol: s.symbol, history: [], lastClose: null, position: null, pending: null, lastSale: null, retired: false, watch: null,
        receivables: [], fractions: [], splitFactor: 1,
      }])),
      // postExit: dividends and cash in lieu paid after their trade closed; they belong to that trade's P/L.
      journal: { decisions: [], fills: [], trades: [], skips: [], warnings: [], equity: [], dividends: [], splits: [], watches: [], postExit: [] },
      seq: 0,
    };
  }
  const order = list.map((s) => s.symbol);
  let out = null;
  const rec = (kind, item) => { S.journal[kind].push(item); if (out) out[kind].push(item); return item; };
  const warn = (date, symbol, code, message, details = {}) => rec('warnings', { date, symbol, code, message, details: clone(details) });
  const holdingsValue = () => order.reduce((a, s) => { const st = S.stocks[s]; return a + (st.position ? st.position.shares * st.lastClose : 0); }, 0);
  const reserved = () => order.reduce((a, s) => a + (S.stocks[s].pending?.side === 'buy' ? S.stocks[s].pending.cashShare : 0), 0);
  const entryRiskOpen = () => order.reduce((a, s) => { const st = S.stocks[s]; return a + (st.position ? st.position.entryRisk : 0) + (st.pending?.side === 'buy' ? st.pending.plannedRisk : 0); }, 0);

  // ---------- splits: every price and level in post-split units ----------
  function applySplits(date, splits) {
    for (const sp of splits || []) {
      const st = S.stocks[sp.symbol];
      if (!st) continue;
      const r = sp.ratio;
      if (!(r > 0)) throw new Error(`Range-trend engine: split ratio for ${sp.symbol} on ${date} must be > 0`);
      st.history = st.history.map((c) => c / r);
      if (st.lastClose != null) st.lastClose /= r;
      st.splitFactor *= r;
      if (st.lastSale) st.lastSale.price /= r;
      if (st.watch) { st.watch.oldHi /= r; st.watch.m /= r; if (st.watch.prevClose != null) st.watch.prevClose /= r; }
      const p = st.position;
      if (p) {
        for (const k of ['stop', 'lo', 'hi', 'H', 'm', 'topLow', 'oldHi', 'highest', 'fillPrice']) if (p[k] != null) p[k] /= r;
        const before = p.shares, after = before * r, whole = Math.floor(after + EPS);
        if (after - whole > EPS) st.fractions.push({ shares: after - whole, tradeId: p.tradeId });
        p.shares = whole;
        if (whole < 1) closeAtSplit(st, date, before, r);
      }
      const o = st.pending;
      if (o?.side === 'buy') {
        o.shares = Math.floor(o.shares * r + EPS);
        for (const k of ['stop', 'refClose', 'lo', 'hi', 'H', 'm', 'topLow', 'oldHi', 'ceiling']) if (o[k] != null) o[k] /= r;
      }
      rec('splits', { date, symbol: sp.symbol, ratio: r, sharesAfter: st.position?.shares ?? 0, closedPosition: !!p && !st.position });
    }
  }

  // A split that leaves no whole share closes the position at the split: no 0-share position, no entry
  // risk held for it, no 0-share sell. Its fraction is paid as cash in lieu at the next open and belongs
  // to this trade (postExit).
  function closeAtSplit(st, date, sharesBefore, r) {
    const p = st.position;
    rec('trades', {
      tradeId: p.tradeId, symbol: st.symbol, kind: p.kind, entryType: p.entryType, convertedToTrend: !!p.converted, entryDecisionDate: p.decisionDate, entryDate: p.fillDate, exitDate: date,
      exitReason: 'split_no_whole_share', shares: sharesBefore, splitRatio: r, entryPrice: p.fillPrice, exitPrice: null, stop: p.stop, entryRisk: p.entryRisk, entryPosInRange: p.entryPosInRange,
      cost: p.cost, proceeds: 0, dividends: p.dividends || 0, cashInLieu: p.cashInLieu || 0, costs: p.costs, pnl: (p.dividends || 0) + (p.cashInLieu || 0) - p.cost, pnlPct: null,
      afterSaleOf: p.afterSale ?? null, sessionsHeld: p.sessions,
    });
    warn(date, st.symbol, 'split_closed', `the ${r}-for-1 split leaves no whole share of ${sharesBefore}: the position is closed; its fraction is paid as cash in lieu`, { sharesBefore, ratio: r });
    st.position = null;
    if (st.pending?.side === 'sell') st.pending = null;
  }

  // A split's fraction of a share is paid at the next open less the half-spread, to the trade that held it.
  function payFractions(date, bars) {
    for (const s of order) {
      const st = S.stocks[s], b = bars[s];
      if (!st.fractions.length || !b) continue;
      for (const f of st.fractions) {
        const cash = f.shares * b.o * (1 - hs(s, date) / 10000);
        S.cash += cash;
        if (st.position && st.position.tradeId === f.tradeId) st.position.cashInLieu = (st.position.cashInLieu || 0) + cash;
        else rec('postExit', { date, symbol: s, tradeId: f.tradeId, kind: 'cash_in_lieu', amount: cash });
        rec('dividends', { date, symbol: s, kind: 'cash_in_lieu', amount: cash, tradeId: f.tradeId });
      }
      st.fractions = [];
    }
  }

  // ---------- dividends: entitled at the ex-date for shares held at the start of the session ----------
  function entitle(date, dividends) {
    for (const d of dividends || []) {
      const st = S.stocks[d.symbol];
      if (!st?.position) continue;
      const gross = st.position.shares * d.amount, net = gross * (1 - config.dividends.withholdingPct / 100);
      // The entitlement belongs to the trade holding the shares on the ex-date, even if paid after its sale.
      st.receivables.push({ payDate: d.payDate || date, net, gross, exDate: date, tradeId: st.position.tradeId });
      rec('dividends', { date, symbol: d.symbol, kind: 'entitlement', gross, net, payDate: d.payDate || date, tradeId: st.position.tradeId });
    }
  }
  function payReceivables(date) {
    for (const s of order) {
      const st = S.stocks[s];
      const due = st.receivables.filter((r) => r.payDate <= date);
      if (!due.length) continue;
      st.receivables = st.receivables.filter((r) => r.payDate > date);
      for (const r of due) {
        S.cash += r.net;
        // Credited to its own trade: to the open position if it is still that trade, otherwise recorded
        // apart (postExit) and added to that closed trade's P/L. A closed trade record is never edited.
        if (st.position && st.position.tradeId === r.tradeId) st.position.dividends = (st.position.dividends || 0) + r.net;
        else rec('postExit', { date, symbol: s, tradeId: r.tradeId, kind: 'dividend', amount: r.net });
        rec('dividends', { date, symbol: s, kind: 'payment', amount: r.net, tradeId: r.tradeId });
      }
    }
  }

  // ---------- fills at the open ----------
  function sell(st, o, b, date) {
    const p = st.position;
    const k = kOf(st.symbol, date), px = b.o * (1 - k);
    const fees = sellFees(costs, p.shares, px);
    const proceeds = p.shares * px - fees.total;
    S.cash += proceeds;
    const spreadCost = p.shares * (b.o - px);
    const fill = rec('fills', { date, symbol: st.symbol, side: 'sell', shares: p.shares, open: b.o, price: px, halfSpreadBps: hs(st.symbol, date), slippageBps: costs.slippageBps, spreadSlippage: spreadCost, fees: fees.total, proceeds, decisionDate: o.decisionDate, reason: o.reason });
    const pnl = proceeds + (p.dividends || 0) + (p.cashInLieu || 0) - p.cost;
    rec('trades', {
      tradeId: p.tradeId, symbol: st.symbol, kind: p.kind, entryType: p.entryType, convertedToTrend: !!p.converted, entryDecisionDate: p.decisionDate, entryDate: p.fillDate, exitDate: date,
      exitReason: o.reason, shares: p.shares, entryPrice: p.fillPrice, exitPrice: px, stop: p.stop, entryRisk: p.entryRisk, entryPosInRange: p.entryPosInRange,
      cost: p.cost, proceeds, dividends: p.dividends || 0, cashInLieu: p.cashInLieu || 0, costs: p.costs + spreadCost + fees.total, pnl, pnlPct: p.cost > 0 ? (pnl / p.cost) * 100 : null,
      afterSaleOf: p.afterSale ?? null, sessionsHeld: p.sessions,
    });
    st.lastSale = { price: px, date, sessions: 0 };
    st.position = null;
    st.pending = null;
    return fill;
  }

  function buy(st, o, b, date) {
    const k = kOf(st.symbol, date), px = b.o * (1 + k);
    const reject = (code, message, extra = {}) => { warn(date, st.symbol, code, message, { decisionDate: o.decisionDate, open: b.o, price: px, ...extra }); st.pending = null; };
    if (o.ceiling != null && !lt(px, o.ceiling)) return reject('order_cancelled', `buy cancelled: the fill price ${px} is not below the last sale price ${o.ceiling} (re-entry limit)`, { code: 'reentry_limit' });
    if (!lt(o.stop, px)) return reject('entry_rejected', `entry rejected: the sizing stop ${o.stop} is at or above the fill price ${px}`, { code: 'stop_above_fill', stop: o.stop });
    const dist = px - o.stop, cpo = costs.commissionPerOrder, cps = costs.commissionPerShare;
    const caps = {
      sized: o.shares,
      cash: Math.floor((Math.min(o.cashShare, S.cash) - cpo) / (px + cps) + EPS),
      position: Math.floor(o.capUsd / px + EPS),
      riskPerTrade: Math.floor(o.riskUsd / dist + EPS),
      riskRoom: o.roomShare == null ? null : Math.floor(o.roomShare / dist + EPS),
    };
    let n = Math.max(0, Math.min(...Object.values(caps).filter((v) => v != null)));
    while (n > 0 && n * px + cpo + cps * n > Math.min(o.cashShare, S.cash) + EPS) n--;
    if (n < 1) return reject('order_cancelled', 'buy cancelled: no whole share fits at the fill price', { code: 'no_whole_share', caps });
    if (n < o.shares) warn(date, st.symbol, 'order_reduced', `buy reduced from ${o.shares} to ${n} shares at the fill price`, { caps, from: o.shares, to: n });
    const cost = n * px + cpo + cps * n;
    if (S.cash - cost < -EPS) throw new Error(`Range-trend engine: buying ${st.symbol} on ${date} would make cash negative`);
    S.cash -= cost;
    const spreadCost = n * (px - b.o);
    rec('fills', { date, symbol: st.symbol, side: 'buy', shares: n, open: b.o, price: px, halfSpreadBps: hs(st.symbol, date), slippageBps: costs.slippageBps, spreadSlippage: spreadCost, fees: cpo + cps * n, cost, decisionDate: o.decisionDate, reason: o.reason, entryRisk: n * dist, stop: o.stop, caps });
    st.position = {
      tradeId: `${st.symbol}:${date}`, shares: n, kind: o.kind, entryType: o.entryType, decisionDate: o.decisionDate, fillDate: date, fillPrice: px, stop: o.stop, entryRisk: n * dist, cost, costs: spreadCost + cpo + cps * n,
      lo: o.lo, hi: o.hi, H: o.H, m: o.m, topLow: o.topLow, armed: false, breakdownCount: 0, oldHi: o.oldHi, highest: null, belowHiCount: 0, converted: false,
      entryPosInRange: o.entryPosInRange, afterSale: o.afterSale, sessions: 0, dividends: 0, cashInLieu: 0,
    };
    st.pending = null;
  }

  function fills(date, bars) {
    for (const side of ['sell', 'buy']) {
      for (const s of order) {
        const st = S.stocks[s], o = st.pending;
        if (!o || o.side !== side || o.fillAfter >= date) continue;
        const b = bars[s];
        if (!b) {
          if (side === 'sell') { warn(date, s, 'order_waiting', `sell waits: no ${s} bar on ${date}`, {}); continue; }
          warn(date, s, 'order_cancelled', `buy cancelled: no ${s} bar on ${date}`, { code: 'no_bar' });
          st.pending = null;
          continue;
        }
        if (side === 'sell') sell(st, o, b, date); else buy(st, o, b, date);
      }
    }
  }

  // ---------- exits at the close (section 4) ----------
  function exits(date, bars) {
    for (const s of order) {
      const st = S.stocks[s], p = st.position, b = bars[s];
      if (!p || !b || st.pending) continue;
      p.sessions++;
      const c = b.c;
      p.highest = p.highest == null ? c : Math.max(p.highest, c);
      let reason = null;
      if (p.kind === 'range') {
        if (gt(c, p.hi + L.breakoutM * p.m)) {
          Object.assign(p, { kind: 'trend', converted: true, oldHi: p.hi, belowHiCount: 0 });
          rec('decisions', { date, symbol: s, action: 'convert_to_trend', reason: `close ${c} is above the frozen range top ${p.hi} + ${L.breakoutM} x m(entry) ${p.m}: held under the trend exits`, values: { close: c, hi: p.hi, m: p.m } });
        } else {
          p.breakdownCount = lt(c, p.lo - L.breakdownM * p.m) ? p.breakdownCount + 1 : 0;
          if (ge(c, p.topLow)) p.armed = true;
          if (p.breakdownCount >= L.breakdownCloses) reason = `breakdown: ${p.breakdownCount} closes below the frozen support ${p.lo} - ${L.breakdownM} x m(entry) ${p.m}`;
          else if (p.armed && lt(c, p.topLow - X.rejectionM * p.m)) reason = `resistance rejection: close ${c} fell back below the top zone's lower edge ${p.topLow} - ${X.rejectionM} x m(entry) ${p.m} after reaching the top zone`;
          if (reason) reason = { text: reason, code: p.breakdownCount >= L.breakdownCloses ? 'breakdown' : 'rejection' };
        }
      }
      if (!reason && p.kind === 'trend') {
        p.belowHiCount = lt(c, p.oldHi) ? p.belowHiCount + 1 : 0;
        if (p.belowHiCount >= X.trendBelowHiCloses) reason = { code: 'below_old_high', text: `${p.belowHiCount} closes back below the old high ${p.oldHi}` };
        else if (lt(c, p.highest - X.trendGivebackM * p.m)) reason = { code: 'giveback', text: `close ${c} is more than ${X.trendGivebackM} x m(entry) ${p.m} below the highest close since buying ${p.highest}` };
      }
      if (reason) {
        st.pending = { side: 'sell', decisionDate: date, fillAfter: date, reason: reason.code };
        rec('decisions', { date, symbol: s, action: 'exit', reason: reason.text, code: reason.code, values: { close: c, lo: p.lo, hi: p.hi, m: p.m, highest: p.highest, oldHi: p.oldHi } });
      }
    }
  }

  // ---------- entry signals at the close (sections 3, 6a) ----------

  // The pullback watch (section 3) advances at every close, held or not: it starts at a breakout of an
  // established range, is replaced by a new breakout, and ends at a close at or below the old high. A
  // pullback signal is a pullback close (above the old high, within pullbackM x m(t-1) of it) followed by
  // an up close, close(t) > close(t-1); a signal is used once, whether or not it can be entered.
  function advanceWatch(st, c, rs, date) {
    if (config.entry !== 'pullback') return null;
    const end = (reason) => { rec('watches', { date: st.watch.since, symbol: st.symbol, endedOn: date, reason, entered: false }); st.watch = null; };
    if (rs && isBreakout(rs, c, L)) {
      if (st.watch) end('replaced');
      st.watch = { since: date, oldHi: rs.hi, m: rs.m, prevClose: c, prevIsPullback: false };
      return null;
    }
    const w = st.watch;
    if (!w) return null;
    const m = rs?.m ?? w.m;
    if (le(c, w.oldHi)) { end('a close at or below the old high'); return null; }
    let sig = null;
    if (w.prevIsPullback && gt(c, w.prevClose)) {
      sig = { kind: 'trend', entryType: 'pullback', oldHi: w.oldHi, m, stop: w.oldHi - P.stopM * m, values: { close: c, oldHi: w.oldHi, pullbackClose: w.prevClose, m } };
      w.prevIsPullback = false; // used: a later close needs a new pullback close first
    } else w.prevIsPullback = isPullbackClose(c, w.oldHi, m, L);
    w.prevClose = c;
    return sig;
  }

  function signalFor(st, c, prior, date) {
    const rs = rangeState(prior, L);
    const pullback = advanceWatch(st, c, rs, date);
    if (st.position || st.pending || st.retired) return null;
    if (pullback) return pullback;
    if (!rs) return null;
    if (config.family === 'range') {
      const hit = config.entry === 'dip' ? isDip(rs, c) : isRecovery(rs, c, L);
      if (!hit) return null;
      return {
        kind: 'range', entryType: config.entry, lo: rs.lo, hi: rs.hi, H: rs.H, m: rs.m, topLow: rs.top[0], stop: rs.lo - P.stopM * rs.m,
        entryPosInRange: (c - rs.lo) / rs.H, values: { close: c, lo: rs.lo, hi: rs.hi, H: rs.H, m: rs.m, visitLow: rs.bottomVisits.at(-1)?.low ?? null },
      };
    }
    if (config.entry === 'immediate' && isBreakout(rs, c, L)) {
      return { kind: 'trend', entryType: 'immediate', oldHi: rs.hi, m: rs.m, stop: rs.hi - P.stopM * rs.m, values: { close: c, hi: rs.hi, m: rs.m } };
    }
    return null;
  }

  function entries(date, bars) {
    const signals = [];
    for (const s of order) {
      const st = S.stocks[s], b = bars[s];
      if (!b) continue;
      const prior = st.history.slice(0, -1);
      // The re-entry limit: after a sale, a close at or above the sale price before any re-entry retires the stock.
      if (config.reentryLimit && st.lastSale && !st.position && !st.pending && !st.retired && ge(b.c, st.lastSale.price)) {
        st.retired = true;
        warn(date, s, 'retired', `close ${b.c} is at or above the last sale price ${st.lastSale.price}: no re-entry for the rest of the run (re-entry limit)`, { lastSale: st.lastSale });
      }
      const sig = signalFor(st, b.c, prior, date);
      if (sig) signals.push({ st, c: b.c, sig });
    }
    if (!signals.length) return;
    const V = S.cash + holdingsValue();
    const avail = Math.max(0, S.cash - reserved());
    const room = P.totalEntryRiskPct == null ? null : Math.max(0, (P.totalEntryRiskPct / 100) * V - entryRiskOpen());
    const n = signals.length;
    for (const { st, c, sig } of signals) {
      const k = kOf(st.symbol, date), cpo = costs.commissionPerOrder, cps = costs.commissionPerShare;
      const cashShare = avail / n, roomShare = room == null ? null : room / n;
      const capUsd = (P.positionCapPct / 100) * V, riskUsd = (P.riskPerTradePct / 100) * V;
      const dist = c - sig.stop;
      const base = { date, symbol: st.symbol, kind: sig.kind, entryType: sig.entryType, values: sig.values, V, signalsToday: n, cashShare, roomShare, capUsd, riskUsd, stop: sig.stop, close: c };
      if (!(dist > EPS)) { rec('skips', { ...base, code: 'stop_above_close', reason: `the sizing stop ${sig.stop} is at or above the close ${c}` }); continue; }
      const { shares, caps, binding } = sizeEntry({ price: c, stop: sig.stop, cashShare, roomShare, capUsd, riskUsd, k, commissionPerOrder: cpo, commissionPerShare: cps });
      if (shares < 1) { rec('skips', { ...base, code: 'no_whole_share', caps, binding, reason: `no whole share fits (${binding.join(', ')} binding)` }); continue; }
      // sessionsSinceSale: the stock's sessions from the sale fill to this decision, the sale session included;
      // the entry fills one session later, so the fill is sessionsSinceSale sessions after the sale.
      const afterSale = st.lastSale ? { price: st.lastSale.price, date: st.lastSale.date, above: ge(c, st.lastSale.price), sessionsSinceSale: st.lastSale.sessions } : null;
      st.pending = {
        side: 'buy', decisionDate: date, fillAfter: date, reason: sig.entryType, kind: sig.kind, entryType: sig.entryType, shares, refClose: c,
        cashShare, roomShare, capUsd, riskUsd, stop: sig.stop, plannedRisk: shares * dist, lo: sig.lo ?? null, hi: sig.hi ?? null, H: sig.H ?? null, m: sig.m,
        topLow: sig.topLow ?? null, oldHi: sig.oldHi ?? null, entryPosInRange: sig.entryPosInRange ?? null, afterSale,
        ceiling: config.reentryLimit && st.lastSale ? st.lastSale.price : null,
      };
      if (sig.entryType === 'pullback' && st.watch) { rec('watches', { date: st.watch.since, symbol: st.symbol, endedOn: date, reason: 'pullback entry decided', entered: true }); st.watch = null; }
      rec('decisions', { ...base, action: 'entry', shares, caps, binding, plannedRisk: shares * dist });
    }
  }

  function equityPoint(date) {
    const holdings = holdingsValue();
    const equity = S.cash + holdings;
    const receivable = order.reduce((a, s) => a + S.stocks[s].receivables.reduce((x, r) => x + r.net, 0), 0);
    const p = { date, cash: S.cash, holdings, equity, receivable, invested: equity > 0 ? holdings / equity : 0, entryRisk: entryRiskOpen(), positions: order.filter((s) => S.stocks[s].position).length };
    rec('equity', p);
  }

  function processSession(date, day = {}) {
    if (S.lastDate && date <= S.lastDate) throw new Error(`Range-trend engine: session ${date} out of order (last ${S.lastDate})`);
    if (S.period.end && date > S.period.end) throw new Error(`Range-trend engine: ${date} is after the period end ${S.period.end}`);
    out = { date, decisions: [], fills: [], trades: [], skips: [], warnings: [], equity: [], dividends: [], splits: [], watches: [], postExit: [] };
    const bars = day.bars || {};
    const trading = date >= S.period.start;
    applySplits(date, day.splits);
    if (trading) payFractions(date, bars);
    entitle(date, day.dividends);
    if (trading) { payReceivables(date); fills(date, bars); }
    for (const s of order) {
      const b = bars[s];
      if (!b) continue;
      const st = S.stocks[s];
      st.history.push(b.c);
      if (st.history.length > HIST(L)) st.history.splice(0, st.history.length - HIST(L));
      st.lastClose = b.c;
      if (trading && st.lastSale) st.lastSale.sessions++;
    }
    if (S.cash < -EPS) throw new Error(`Range-trend engine: cash below zero on ${date}`);
    if (trading) {
      exits(date, bars);
      equityPoint(date);
      entries(date, bars);
    }
    S.lastDate = date;
    const r = out;
    out = null;
    return clone(r);
  }

  function output() {
    const open = order.filter((s) => S.stocks[s].position).map((s) => {
      const st = S.stocks[s], p = st.position, value = p.shares * st.lastClose;
      return { tradeId: p.tradeId, symbol: s, kind: p.kind, entryType: p.entryType, entryDate: p.fillDate, shares: p.shares, entryPrice: p.fillPrice, markPrice: st.lastClose, value, cost: p.cost, pnl: value + p.dividends + p.cashInLieu - p.cost, entryRisk: p.entryRisk, sessionsHeld: p.sessions };
    });
    return { ...clone(S.journal), openPositions: open, cash: S.cash, lastDate: S.lastDate, configHash: cHash, engineVersion: ENGINE_VERSION };
  }

  return { processSession, output, snapshot: () => clone(S), get configHash() { return cHash; } };
}

// A whole run over `sessions` with `days` (Map date -> { bars, splits, dividends }).
export function runBacktest({ config, symbols, sessions, days, halfSpreadBps, dataHash = null }) {
  const e = createEngine({ config, symbols, halfSpreadBps });
  for (const d of sessions) {
    if (d < config.period.warmupFrom) continue;
    if (d > config.period.end) break;
    e.processSession(d, days.get(d) || {});
  }
  const out = e.output();
  const symbolsMeta = symbols.map((s) => (typeof s === 'string' ? { symbol: s } : s)).map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi }));
  const sym = crypto.createHash('sha256').update(canonicalJson(symbolsMeta)).digest('hex');
  return { ...out, meta: { engineVersion: ENGINE_VERSION, configHash: configHash(config), version: config.version, startingCash: config.portfolio.startingCash, symbols: symbolsMeta, symbolsHash: sym, dataHash, period: { ...config.period }, simulated: true } };
}
