// rr-mech-2: the stateful mechanism engine for prospective journal 1 (strategy/research-runner/PROSPECTIVE-1.md,
// decision D3 of 2026-11-06). A copy of rr-mech-1 (./mechanisms.js, unchanged and still the engine of campaign 3)
// with three additions and nothing else:
//   1. state restore: createMechanismEngine2({ ..., state }) continues from a plain-JSON snapshot();
//   2. an entry veto: processSession(date, day, { late: true }) records the session's entry signals as skips with
//      code 'late_veto' and places no order, so the account's later signals and sizes come from its actual state;
//   3. held exits: in a late session an exit decision is placed as a held sell that never fills until
//      releaseHeld({ fillAfter }) sets its fill session; until then the position stays held with its cash, its
//      risk, its corporate actions, and it blocks a new entry in that stock.
// With no `late` option and no release, every decision, fill, trade, skip, warning and equity point equals
// rr-mech-1's (tests/journal-engine.test.js; scripts/journal-repro.mjs on the stored development data). The
// validation, the config hash and the indicators are imported from rr-mech-1 so that they cannot drift.
// Simulation only: no order, no broker.
import crypto from 'node:crypto';
import { canonicalJson } from '../strategy/config.js';
import { sellFees } from '../hxr/engine.js';
import { sizeEntry } from '../rangetrend/engine.js';
import { validateMechanismConfig, mechanismConfigHash, typicalMove, hh, ll, sma, sd } from './mechanisms.js';

export const MECHANISM_ENGINE_VERSION_2 = 'rr-mech-2';
const EPS = 1e-9;
const lt = (x, b) => x < b - EPS, gt = (x, a) => x > a + EPS, le = (x, b) => x <= b + EPS, ge = (x, a) => x >= a - EPS;
const clone = (o) => JSON.parse(JSON.stringify(o));
const JOURNAL = ['decisions', 'fills', 'trades', 'skips', 'warnings', 'equity', 'dividends', 'splits', 'postExit'];
const median = (a) => { const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

export function createMechanismEngine2({ config, symbols, halfSpreadBps, state = null } = {}) {
  const errors = validateMechanismConfig(config);
  if (errors.length) throw new Error(`Mechanism engine 2: invalid config: ${errors.join('; ')}`);
  if (!Array.isArray(symbols) || !symbols.length) throw new Error('Mechanism engine 2: symbols must be a non-empty list');
  const spread = typeof halfSpreadBps === 'function' ? halfSpreadBps : typeof halfSpreadBps === 'number' ? () => halfSpreadBps : null;
  if (!spread) throw new Error('Mechanism engine 2: halfSpreadBps (a number or a function of symbol and date) is required');
  const P = config.portfolio, costs = config.costs, prm = config.params, mech = config.mechanism;
  const cHash = mechanismConfigHash(config);
  const hs = (sym, date) => Math.max(costs.halfSpreadFloorBps, spread(sym, date));
  const kOf = (sym, date) => (hs(sym, date) + costs.slippageBps) / 10000;
  const list = symbols.map((s) => (typeof s === 'string' ? { symbol: s } : s)).map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi }));
  const order = list.map((s) => s.symbol);
  const HIST = 262;
  let S;
  if (state) {
    S = clone(state);
    if (S.engine !== MECHANISM_ENGINE_VERSION_2) throw new Error(`Mechanism engine 2: the saved state is not an ${MECHANISM_ENGINE_VERSION_2} state`);
    if (S.configHash !== cHash) throw new Error('Mechanism engine 2: the saved state belongs to a different config');
    const saved = Object.keys(S.stocks);
    if (saved.length !== order.length || saved.some((s, i) => s !== order[i])) throw new Error('Mechanism engine 2: the saved state holds a different symbol list');
  } else {
    S = {
      engine: MECHANISM_ENGINE_VERSION_2,
      configHash: cHash, period: { warmupFrom: config.period.warmupFrom, start: config.period.start, end: config.period.end }, cash: P.startingCash, lastDate: null,
      stocks: Object.fromEntries(order.map((s) => [s, { symbol: s, closes: [], mHist: [], lastClose: null, lastOpen: null, prevClose: null, position: null, pending: null, receivables: [], fractions: [], eligible: 0 }])),
      journal: Object.fromEntries(JOURNAL.map((k) => [k, []])),
    };
  }
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
      if (!(r > 0)) throw new Error(`Mechanism engine: split ratio for ${sp.symbol} on ${date} must be > 0`);
      st.closes = st.closes.map((c) => c / r);
      st.mHist = st.mHist.map((m) => m / r);
      if (st.lastClose != null) st.lastClose /= r;
      if (st.prevClose != null) st.prevClose /= r;
      const p = st.position;
      if (p) {
        for (const k of ['stop', 'fillPrice', 'highest', 'm', 'preGapClose']) if (p[k] != null) p[k] /= r;
        const before = p.shares, after = before * r, whole = Math.floor(after + EPS);
        if (after - whole > EPS) st.fractions.push({ shares: after - whole, tradeId: p.tradeId });
        p.shares = whole;
        if (whole < 1) closeAtSplit(st, date, before, r);
      }
      const o = st.pending;
      if (o?.side === 'buy') { o.shares = Math.floor(o.shares * r + EPS); for (const k of ['stop', 'refClose', 'm', 'preGapClose']) if (o[k] != null) o[k] /= r; }
      rec('splits', { date, symbol: sp.symbol, ratio: r, sharesAfter: st.position?.shares ?? 0, closedPosition: !!p && !st.position });
    }
  }
  function closeAtSplit(st, date, sharesBefore, r) {
    const p = st.position;
    rec('trades', { tradeId: p.tradeId, symbol: st.symbol, kind: 'mechanism', entryType: mech, entryDecisionDate: p.decisionDate, entryDate: p.fillDate, exitDate: date, exitReason: 'split_no_whole_share', shares: sharesBefore, splitRatio: r, entryPrice: p.fillPrice, exitPrice: null, stop: p.stop, entryRisk: p.entryRisk, cost: p.cost, proceeds: 0, dividends: p.dividends || 0, cashInLieu: p.cashInLieu || 0, costs: p.costs, pnl: (p.dividends || 0) + (p.cashInLieu || 0) - p.cost, pnlPct: null, sessionsHeld: p.sessions, lossExceededRisk: null });
    warn(date, st.symbol, 'split_closed', `the ${r}-for-1 split leaves no whole share of ${sharesBefore}: the position is closed; its fraction is paid as cash in lieu`, { sharesBefore, ratio: r });
    st.position = null;
    if (st.pending?.side === 'sell') st.pending = null;
  }
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
  // ---------- dividends: entitled at the ex-date for shares held at the start of the session, paid at the pay date ----------
  function entitle(date, dividends) {
    for (const d of dividends || []) {
      const st = S.stocks[d.symbol];
      if (!st?.position) continue;
      const gross = st.position.shares * d.amount, net = gross * (1 - config.dividends.withholdingPct / 100);
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
    rec('fills', { date, symbol: st.symbol, side: 'sell', shares: p.shares, open: b.o, price: px, halfSpreadBps: hs(st.symbol, date), slippageBps: costs.slippageBps, spreadSlippage: spreadCost, fees: fees.total, proceeds, decisionDate: o.decisionDate, reason: o.reason, ...(o.late ? { lateExit: true } : {}) });
    const pnl = proceeds + (p.dividends || 0) + (p.cashInLieu || 0) - p.cost;
    rec('trades', { tradeId: p.tradeId, symbol: st.symbol, kind: 'mechanism', entryType: mech, entryDecisionDate: p.decisionDate, entryDate: p.fillDate, exitDate: date, exitReason: o.reason, exitDetail: o.detail ?? null, shares: p.shares, entryPrice: p.fillPrice, exitPrice: px, stop: p.stop, entryRisk: p.entryRisk, cost: p.cost, proceeds, dividends: p.dividends || 0, cashInLieu: p.cashInLieu || 0, costs: p.costs + spreadCost + fees.total, pnl, pnlPct: p.cost > 0 ? (pnl / p.cost) * 100 : null, sessionsHeld: p.sessions + 1, lossExceededRisk: pnl < -p.entryRisk - EPS, ...(o.late ? { lateExit: true, exitDecisionDate: o.decisionDate, releasedAt: o.releasedAt ?? null } : {}) });
    st.position = null;
    st.pending = null;
  }
  function buy(st, o, b, date) {
    const k = kOf(st.symbol, date), px = b.o * (1 + k);
    const reject = (code, message, extra = {}) => { warn(date, st.symbol, code, message, { decisionDate: o.decisionDate, open: b.o, price: px, entryType: mech, ...extra }); st.pending = null; };
    if (!lt(o.stop, px)) return reject('entry_rejected', `entry rejected: the sizing reference ${o.stop} is at or above the fill price ${px}`, { code: 'stop_above_fill', stop: o.stop });
    const dist = px - o.stop, cpo = costs.commissionPerOrder, cps = costs.commissionPerShare;
    const caps = { sized: o.shares, cash: Math.floor((Math.min(o.cashShare, S.cash) - cpo) / (px + cps) + EPS), position: Math.floor(o.capUsd / px + EPS), riskPerTrade: Math.floor(o.riskUsd / dist + EPS), riskRoom: o.roomShare == null ? null : Math.floor(o.roomShare / dist + EPS) };
    let n = Math.max(0, Math.min(...Object.values(caps).filter((v) => v != null)));
    while (n > 0 && n * px + cpo + cps * n > Math.min(o.cashShare, S.cash) + EPS) n--;
    if (n < 1) return reject('order_cancelled', 'buy cancelled: no whole share fits at the fill price', { code: 'no_whole_share', caps });
    if (n < o.shares) warn(date, st.symbol, 'order_reduced', `buy reduced from ${o.shares} to ${n} shares at the fill price`, { caps, from: o.shares, to: n });
    const cost = n * px + cpo + cps * n;
    if (S.cash - cost < -EPS) throw new Error(`Mechanism engine: buying ${st.symbol} on ${date} would make cash negative`);
    S.cash -= cost;
    const spreadCost = n * (px - b.o);
    rec('fills', { date, symbol: st.symbol, side: 'buy', shares: n, open: b.o, price: px, halfSpreadBps: hs(st.symbol, date), slippageBps: costs.slippageBps, spreadSlippage: spreadCost, fees: cpo + cps * n, cost, decisionDate: o.decisionDate, reason: mech });
    st.position = { tradeId: `${st.symbol}:${date}`, shares: n, decisionDate: o.decisionDate, fillDate: date, fillPrice: px, stop: o.stop, entryRisk: n * dist, cost, costs: spreadCost + cpo + cps * n, m: o.m, highest: null, preGapClose: o.preGapClose ?? null, sessions: 0, dividends: 0, cashInLieu: 0 };
    st.pending = null;
  }
  function fills(date, bars) {
    for (const side of ['sell', 'buy']) {
      for (const s of order) {
        const st = S.stocks[s], o = st.pending;
        // A held sell (a late exit not yet released) never fills (addition 3).
        if (!o || o.side !== side || o.held || o.fillAfter >= date) continue;
        const b = bars[s];
        if (!b) { if (side === 'sell') { warn(date, s, 'order_waiting', `sell waits: no ${s} bar on ${date}`, {}); continue; } warn(date, s, 'order_cancelled', `buy cancelled: no ${s} bar on ${date}`, { code: 'no_bar' }); st.pending = null; continue; }
        if (side === 'sell') sell(st, o, b, date); else buy(st, o, b, date);
      }
    }
  }

  // ---------- the close: history and the mechanism's levels (prior closes only) ----------
  function closeStep(st, b, date) {
    st.prevClose = st.lastClose;
    st.closes.push(b.c);
    if (st.closes.length > HIST) st.closes.splice(0, st.closes.length - HIST);
    st.lastClose = b.c; st.lastOpen = b.o;
    const m = typicalMove(st.closes);
    st.mHist.push(m);
    if (st.mHist.length > (prm.lookback || 0) + 2) st.mHist.splice(0, st.mHist.length - ((prm.lookback || 0) + 2));
    if (st.position && st.position.fillDate < date) {
      st.position.sessions++;
      if (mech === 'B2') st.position.highest = Math.max(st.position.highest ?? -Infinity, st.prevClose ?? -Infinity);
    }
    const c = st.closes;
    const lv = { m };
    if (mech === 'B0' || mech === 'B1') { lv.hh = hh(c, prm.entry); lv.ll = ll(c, prm.exit); lv.defined = lv.hh != null && lv.ll != null; }
    else if (mech === 'B2') { lv.hh = hh(c, prm.entry); const hist = st.mHist.slice(-prm.lookback - 1, -1).filter((x) => x != null); lv.mMedian = hist.length === prm.lookback ? median(hist) : null; lv.defined = lv.hh != null && m != null && lv.mMedian != null; }
    else if (mech === 'B3') { lv.hh = hh(c, prm.entry); lv.sma = sma(c, prm.sma); lv.defined = lv.hh != null && lv.sma != null; }
    else {
      lv.filterSma = config.filter ? sma(c, prm.filterSma) : null;
      const filterOk = !config.filter || lv.filterSma != null;
      if (mech === 'M0' || mech === 'M1') { lv.exitSma = mech === 'M1' ? sma(c, prm.exitSma) : null; lv.defined = m != null && c.length >= prm.down + 1 && filterOk && (mech !== 'M1' || lv.exitSma != null); }
      else if (mech === 'M2') { lv.sma = sma(c, prm.sma); lv.sd = sd(c, prm.sma); lv.defined = m != null && lv.sma != null && lv.sd != null && filterOk; }
      else if (mech === 'M3') { lv.defined = m != null && st.prevClose != null && filterOk; }
    }
    st.today = { ...lv, c: b.c, o: b.o };
  }
  const uptrend = (st) => !config.filter || gt(st.lastClose, st.today.filterSma);
  const downRun = (st, n) => { const c = st.closes; if (c.length < n + 1) return false; for (let i = 0; i < n; i++) if (!lt(c[c.length - 1 - i], c[c.length - 2 - i])) return false; return true; };

  // ---------- exits at the close; in a late session the sell is held (addition 3) ----------
  function exits(date, late) {
    for (const s of order) {
      const st = S.stocks[s], p = st.position, t = st.today;
      if (!p || st.pending || !t) continue;
      const c = t.c;
      let reason = null, detail = null;
      if (mech === 'B0' || mech === 'B1') { if (t.ll != null && lt(c, t.ll)) { reason = 'signal'; detail = { rule: 'close below the exit channel low', level: t.ll }; } }
      else if (mech === 'B2') { const lvl = (p.highest ?? p.fillPrice) - prm.giveback * p.m; if (lt(c, lvl)) { reason = 'signal'; detail = { rule: 'give-back from the highest close', level: lvl, highest: p.highest }; } }
      else if (mech === 'B3') { if (t.sma != null && lt(c, t.sma)) { reason = 'signal'; detail = { rule: 'close below the moving average', level: t.sma }; } }
      else if (mech === 'M0') { if (gt(c, st.prevClose)) { reason = 'signal'; detail = { rule: 'up close', prevClose: st.prevClose }; } }
      else if (mech === 'M1') { if (t.exitSma != null && gt(c, t.exitSma)) { reason = 'signal'; detail = { rule: 'close above the short average', level: t.exitSma }; } }
      else if (mech === 'M2') { if (t.sma != null && ge(c, t.sma)) { reason = 'signal'; detail = { rule: 'close at or above the mean', level: t.sma }; } }
      else if (mech === 'M3') { if (ge(c, p.preGapClose)) { reason = 'signal'; detail = { rule: 'the pre-gap close recovered', level: p.preGapClose }; } }
      if (!reason && prm.timeExit != null && p.sessions >= prm.timeExit) { reason = 'time'; detail = { rule: `time exit after ${prm.timeExit} sessions`, sessions: p.sessions }; }
      if (!reason) continue;
      st.pending = late ? { side: 'sell', decisionDate: date, fillAfter: null, reason, detail, held: true, late: true } : { side: 'sell', decisionDate: date, fillAfter: date, reason, detail };
      rec('decisions', { date, symbol: s, action: 'exit', reason, detail, close: c, ...(late ? { late: true, held: true } : {}) });
    }
  }

  // ---------- entries at the close; in a late session every signal is vetoed (addition 2) ----------
  function signalFor(st) {
    const t = st.today, c = t.c;
    if (!t.defined) return null;
    const m = t.m;
    if (mech === 'B0' || mech === 'B1') return gt(c, t.hh) ? { stop: t.ll, m, values: { close: c, hh: t.hh, ll: t.ll, m } } : null;
    if (mech === 'B2') return gt(c, t.hh) && m > EPS && le(m, prm.ratio * t.mMedian) ? { stop: c - prm.giveback * m, m, values: { close: c, hh: t.hh, m, mMedian: t.mMedian } } : null;
    if (mech === 'B3') return gt(c, t.hh) ? { stop: t.sma, m, values: { close: c, hh: t.hh, sma: t.sma, m } } : null;
    if (!(m > EPS)) return null;
    const stop = c - prm.stopM * m;
    if (mech === 'M0') return downRun(st, prm.down) ? { stop, m, values: { close: c, prevClose: st.prevClose, m } } : null;
    if (mech === 'M1') return downRun(st, prm.down) && uptrend(st) ? { stop, m, values: { close: c, filterSma: t.filterSma, m } } : null;
    if (mech === 'M2') return lt(c, t.sma - prm.k * t.sd) && uptrend(st) ? { stop, m, values: { close: c, sma: t.sma, sd: t.sd, filterSma: t.filterSma, m } } : null;
    if (mech === 'M3') return le(t.o, st.prevClose - prm.gap * m) && ge(c, t.o) && uptrend(st) ? { stop, m, preGapClose: st.prevClose, values: { close: c, open: t.o, prevClose: st.prevClose, filterSma: t.filterSma, m } } : null;
    return null;
  }
  function entries(date, late) {
    const signals = [];
    for (const s of order) {
      const st = S.stocks[s];
      if (!st.today) continue;
      if (st.today.defined) st.eligible++;
      if (st.position || st.pending) continue;
      const sig = signalFor(st);
      if (sig) signals.push({ st, c: st.today.c, sig });
    }
    if (!signals.length) return;
    if (late) {
      for (const { st, c, sig } of signals) rec('skips', { date, symbol: st.symbol, kind: 'mechanism', entryType: mech, values: sig.values, stop: sig.stop, close: c, code: 'late_veto', reason: 'the session was recorded after the next open: the entry is skipped in this account' });
      return;
    }
    const V = S.cash + holdingsValue();
    const avail = Math.max(0, S.cash - reserved());
    const room = P.totalEntryRiskPct == null ? null : Math.max(0, (P.totalEntryRiskPct / 100) * V - entryRiskOpen());
    const n = signals.length;
    for (const { st, c, sig } of signals) {
      const k = kOf(st.symbol, date), cpo = costs.commissionPerOrder, cps = costs.commissionPerShare;
      const cashShare = avail / n, roomShare = room == null ? null : room / n;
      const capUsd = (P.positionCapPct / 100) * V, riskUsd = (P.riskPerTradePct / 100) * V;
      const dist = c - sig.stop;
      const base = { date, symbol: st.symbol, kind: 'mechanism', entryType: mech, values: sig.values, V, signalsToday: n, cashShare, roomShare, capUsd, riskUsd, stop: sig.stop, close: c };
      if (!(dist > EPS)) { rec('skips', { ...base, code: 'stop_above_close', reason: `the sizing reference ${sig.stop} is at or above the close ${c}` }); continue; }
      const { shares, caps, binding } = sizeEntry({ price: c, stop: sig.stop, cashShare, roomShare, capUsd, riskUsd, k, commissionPerOrder: cpo, commissionPerShare: cps });
      if (shares < 1) { rec('skips', { ...base, code: 'no_whole_share', caps, binding, reason: `no whole share fits (${binding.join(', ')} binding)` }); continue; }
      st.pending = { side: 'buy', decisionDate: date, fillAfter: date, reason: mech, shares, refClose: c, cashShare, roomShare, capUsd, riskUsd, stop: sig.stop, plannedRisk: shares * dist, m: sig.m, preGapClose: sig.preGapClose ?? null };
      rec('decisions', { ...base, action: 'entry', shares, caps, binding, plannedRisk: shares * dist });
    }
  }
  function equityPoint(date) {
    const holdings = holdingsValue();
    const equity = S.cash + holdings;
    const receivable = order.reduce((a, s) => a + S.stocks[s].receivables.reduce((x, r) => x + r.net, 0), 0);
    rec('equity', { date, cash: S.cash, holdings, equity, receivable, invested: equity > 0 ? holdings / equity : 0, entryRisk: entryRiskOpen(), positions: order.filter((s) => S.stocks[s].position).length });
  }

  function processSession(date, day = {}, opts = {}) {
    if (S.lastDate && date <= S.lastDate) throw new Error(`Mechanism engine: session ${date} out of order (last ${S.lastDate})`);
    if (S.period.end && date > S.period.end) throw new Error(`Mechanism engine: ${date} is after the period end ${S.period.end}`);
    const late = !!opts.late;
    out = Object.fromEntries([['date', date], ...JOURNAL.map((k) => [k, []])]);
    const bars = day.bars || {};
    const trading = date >= S.period.start;
    if (late && !trading) throw new Error(`Mechanism engine 2: ${date} is a warm-up session; only a trading session can be late`);
    applySplits(date, day.splits);
    if (trading) payFractions(date, bars);
    entitle(date, day.dividends);
    if (trading) { payReceivables(date); fills(date, bars); }
    for (const s of order) { const st = S.stocks[s], b = bars[s]; st.today = null; if (b) closeStep(st, b, date); }
    if (S.cash < -EPS) throw new Error(`Mechanism engine: cash below zero on ${date}`);
    if (trading) { exits(date, late); equityPoint(date); entries(date, late); }
    for (const s of order) S.stocks[s].today = null;
    S.lastDate = date;
    const r = out; out = null;
    return clone(r);
  }

  // The held sells (late exits not yet released), and their release: each fills at the first open after
  // `fillAfter` (a session date, at or after the last processed session and the decision). `at` is the record's
  // recorded_at, kept with the trade.
  const held = () => order.filter((s) => S.stocks[s].pending?.held).map((s) => ({ symbol: s, decisionDate: S.stocks[s].pending.decisionDate, reason: S.stocks[s].pending.reason }));
  function releaseHeld({ fillAfter, at = null } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fillAfter || '')) throw new Error('releaseHeld needs fillAfter (YYYY-MM-DD)');
    if (S.lastDate && fillAfter < S.lastDate) throw new Error(`releaseHeld: fillAfter ${fillAfter} is before the last processed session ${S.lastDate}`);
    const released = [];
    for (const s of order) {
      const o = S.stocks[s].pending;
      if (!o?.held) continue;
      if (fillAfter < o.decisionDate) throw new Error(`releaseHeld: fillAfter ${fillAfter} is before the exit decision ${o.decisionDate}`);
      delete o.held;
      o.fillAfter = fillAfter;
      o.releasedAt = at;
      released.push({ symbol: s, decisionDate: o.decisionDate, fillAfter });
      S.journal.warnings.push({ date: fillAfter, symbol: s, code: 'late_exit_released', message: `the late exit decided at ${o.decisionDate} fills at the first open after ${fillAfter}`, details: { decisionDate: o.decisionDate, fillAfter, recordedAt: at } });
    }
    return released;
  }

  function output() {
    const open = order.filter((s) => S.stocks[s].position).map((s) => { const st = S.stocks[s], p = st.position, value = p.shares * st.lastClose; return { tradeId: p.tradeId, symbol: s, kind: 'mechanism', entryType: mech, entryDate: p.fillDate, shares: p.shares, entryPrice: p.fillPrice, markPrice: st.lastClose, value, cost: p.cost, pnl: value + p.dividends + p.cashInLieu - p.cost, entryRisk: p.entryRisk, stop: p.stop, sessionsHeld: p.sessions }; });
    const pendingOrders = order.filter((s) => S.stocks[s].pending).map((s) => { const o = S.stocks[s].pending; return { symbol: s, side: o.side, decisionDate: o.decisionDate, entryType: mech, shares: o.shares ?? null, reason: o.reason, ...(o.held ? { held: true } : {}) }; });
    const unpaidDividends = order.flatMap((s) => S.stocks[s].receivables.map((r) => ({ symbol: s, exDate: r.exDate, payDate: r.payDate, gross: r.gross, net: r.net, tradeId: r.tradeId })));
    const eligibility = Object.fromEntries(order.map((s) => [s, S.stocks[s].eligible]));
    return { ...clone(S.journal), openPositions: open, pendingOrders, unpaidDividends, lastSales: {}, breaks: [], watches: [], eligibility, cash: S.cash, lastDate: S.lastDate, configHash: cHash, engineVersion: MECHANISM_ENGINE_VERSION_2 };
  }
  return { processSession, releaseHeld, held, output, snapshot: () => clone(S), get configHash() { return cHash; }, get lastDate() { return S.lastDate; } };
}

// A whole run over `sessions` with `days` (Map date -> { bars, splits, dividends }), every session on time: the
// rr-mech-1 behaviour (runMechanism), with this engine's version in the metadata.
export function runMechanism2({ config, symbols, sessions, days, halfSpreadBps, dataHash = null, restoreAt = null }) {
  let e = createMechanismEngine2({ config, symbols, halfSpreadBps });
  for (const d of sessions) {
    if (d < config.period.warmupFrom) continue;
    if (d > config.period.end) break;
    e.processSession(d, days.get(d) || {});
    // restoreAt (tests and the reproduction check): snapshot, discard the engine, continue from the snapshot.
    if (restoreAt && d === restoreAt) e = createMechanismEngine2({ config, symbols, halfSpreadBps, state: e.snapshot() });
  }
  const out = e.output();
  const symbolsMeta = symbols.map((s) => (typeof s === 'string' ? { symbol: s } : s)).map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi }));
  const sym = crypto.createHash('sha256').update(canonicalJson(symbolsMeta)).digest('hex');
  return { ...out, meta: { engineVersion: MECHANISM_ENGINE_VERSION_2, configHash: mechanismConfigHash(config), version: config.version, mechanism: config.mechanism, startingCash: config.portfolio.startingCash, symbols: symbolsMeta, symbolsHash: sym, dataHash, period: { ...config.period }, simulated: true } };
}

// For comparisons with rr-mech-1: the output with the engine labels removed.
export function withoutEngineLabels(out) {
  const { engineVersion, meta, ...rest } = out;
  const m = meta ? (({ engineVersion: _e, ...r }) => r)(meta) : undefined;
  return m ? { ...rest, meta: m } : rest;
}
