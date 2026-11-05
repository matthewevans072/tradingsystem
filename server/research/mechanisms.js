// Campaign 3's mechanism engine (strategy/research-runner/CAMPAIGN-3.md sections 2, 5 and 5a): channel and
// volatility-compression breakouts, long-horizon new highs, and three mean-reversion entries, each with a
// below-entry sizing reference S that is never an exit. The portfolio mechanics are campaign 2's, mirrored from
// server/rangetrend/engine.js: decide after the close on completed daily bars, fill at the next open with
// spread and slippage, whole shares, one position per stock, no adding, the 1% risk / 20% cap / 5% total-risk
// limits applied at the decision close and again at the fill, splits and dividends as there. Streaming and
// deterministic: processSession(date, day) in session order; every level for day t uses closes up to t-1
// (no look-ahead); an undefined level gives no signal. Simulation only: no order, no broker.
import crypto from 'node:crypto';
import { canonicalJson } from '../strategy/config.js';
import { sellFees } from '../hxr/engine.js';
import { sizeEntry } from '../rangetrend/engine.js';

export const MECHANISM_ENGINE_VERSION = 'rr-mech-1';
const EPS = 1e-9;
const lt = (x, b) => x < b - EPS, gt = (x, a) => x > a + EPS, le = (x, b) => x <= b + EPS, ge = (x, a) => x >= a - EPS;
const clone = (o) => JSON.parse(JSON.stringify(o));
const JOURNAL = ['decisions', 'fills', 'trades', 'skips', 'warnings', 'equity', 'dividends', 'splits', 'postExit'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The mechanisms and the parameter values the document pins (section 5). A config may use only these.
export const MECHANISMS = Object.freeze({
  B0: { family: 'breakout', params: { entry: [20], exit: [20] } },
  B1: { family: 'breakout', params: { entry: [40, 55, 100], exit: [20] } },
  B2: { family: 'breakout', params: { entry: [20], ratio: [0.7, 0.8, 0.9], lookback: [120], giveback: [3] } },
  B3: { family: 'breakout', params: { entry: [250, 120], sma: [50, 100] } },
  M0: { family: 'reversion', params: { down: [2], timeExit: [10], stopM: [2] } },
  M1: { family: 'reversion', params: { down: [3, 4, 5], exitSma: [5], timeExit: [10], stopM: [2], filterSma: [200] } },
  M2: { family: 'reversion', params: { sma: [20], k: [1.5, 2, 2.5], timeExit: [15], stopM: [2], filterSma: [200] } },
  M3: { family: 'reversion', params: { gap: [1, 1.5, 2], timeExit: [7], stopM: [2], filterSma: [200] } },
});
export const M_SESSIONS = 20; // the typical move's window (section 2)

export function validateMechanismConfig(c) {
  const e = [];
  if (!c || typeof c !== 'object') return ['config must be an object'];
  if (c.strategy !== 'mechanism') e.push('strategy must be "mechanism"');
  if (typeof c.version !== 'string' || !c.version) e.push('version is required');
  const spec = MECHANISMS[c.mechanism];
  if (!spec) e.push(`mechanism must be one of ${Object.keys(MECHANISMS).join(', ')}`);
  else {
    const p = c.params || {};
    for (const [k, allowed] of Object.entries(spec.params)) if (!allowed.includes(p[k])) e.push(`params.${k} must be one of ${allowed.join(', ')}`);
    for (const k of Object.keys(p)) if (!spec.params[k]) e.push(`params.${k} is not a parameter of ${c.mechanism}`);
    if (typeof c.filter !== 'boolean') e.push('filter must be true or false');
    if (spec.family === 'breakout' && c.filter) e.push('breakout mechanisms have no uptrend filter');
    if (c.mechanism === 'M0' && c.filter) e.push('M0 has no uptrend filter');
    if (c.mechanism === 'B3' && p.entry != null && p.sma != null && !([[250, 50], [120, 50], [250, 100]].some(([h, s]) => h === p.entry && s === p.sma))) e.push('B3 allows (entry, sma) of (250, 50), (120, 50) or (250, 100) only');
  }
  const P = c.portfolio || {};
  const num = (v, name, { gt0 = false, max = Infinity } = {}) => { if (typeof v !== 'number' || !Number.isFinite(v) || (gt0 ? v <= 0 : v < 0) || v > max) e.push(`${name} must be a number${gt0 ? ' above 0' : ''}`); };
  num(P.startingCash, 'portfolio.startingCash', { gt0: true }); num(P.positionCapPct, 'portfolio.positionCapPct', { gt0: true, max: 100 }); num(P.riskPerTradePct, 'portfolio.riskPerTradePct', { gt0: true, max: 100 });
  if (P.totalEntryRiskPct !== null) num(P.totalEntryRiskPct, 'portfolio.totalEntryRiskPct', { gt0: true, max: 100 });
  const k = c.costs || {};
  for (const f of ['commissionPerOrder', 'commissionPerShare', 'secFeeRate', 'tafPerShare', 'tafMaxPerTrade', 'halfSpreadFloorBps', 'slippageBps']) num(k[f], `costs.${f}`);
  if (k.halfSpread !== 'calibrated' && !(typeof k.halfSpread === 'number' && k.halfSpread >= 0)) e.push('costs.halfSpread must be "calibrated" or a number');
  num(c.dividends?.withholdingPct, 'dividends.withholdingPct', { max: 100 });
  const ex = c.execution || {};
  if (ex.decision !== 'after_close' || ex.fill !== 'next_open' || ex.delaySessions !== 1) e.push('execution must be after_close / next_open with delaySessions 1');
  const pr = c.period || {};
  for (const f of ['warmupFrom', 'start', 'end']) if (!DATE.test(pr[f] || '')) e.push(`period.${f} must be YYYY-MM-DD`);
  if (c.benchmark?.buyAndHold !== 'equal_weight_fractional_never_rebalanced') e.push('benchmark.buyAndHold must be "equal_weight_fractional_never_rebalanced"');
  return e;
}

const DESCRIPTIVE = ['label', 'notes', 'status', 'hypothesis'];
export function mechanismConfigHash(c) {
  const o = { ...c };
  for (const k of DESCRIPTIVE) delete o[k];
  return crypto.createHash('sha256').update(canonicalJson(o)).digest('hex');
}

// ---------- indicators on a stock's own closes (closes[] holds C up to and including the latest close) ----------
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function priorWindow(closes, n) { return closes.length > n ? closes.slice(-n - 1, -1) : null; } // the n closes before the latest
export function hh(closes, n) { const w = priorWindow(closes, n); return w ? Math.max(...w) : null; }
export function ll(closes, n) { const w = priorWindow(closes, n); return w ? Math.min(...w) : null; }
export function sma(closes, n) { const w = priorWindow(closes, n); return w ? mean(w) : null; }
export function sd(closes, n) { const w = priorWindow(closes, n); if (!w) return null; const mu = mean(w); return Math.sqrt(mean(w.map((x) => (x - mu) ** 2))); }
// m(t-1): the mean absolute change over the 20 changes ending at the previous close: needs 21 prior closes.
export function typicalMove(closes, n = M_SESSIONS) {
  if (closes.length < n + 2) return null;
  const w = closes.slice(-n - 2, -1);
  let s = 0;
  for (let i = 1; i < w.length; i++) s += Math.abs(w[i] - w[i - 1]);
  return s / n;
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

export function createMechanismEngine({ config, symbols, halfSpreadBps } = {}) {
  const errors = validateMechanismConfig(config);
  if (errors.length) throw new Error(`Mechanism engine: invalid config: ${errors.join('; ')}`);
  if (!Array.isArray(symbols) || !symbols.length) throw new Error('Mechanism engine: symbols must be a non-empty list');
  const spread = typeof halfSpreadBps === 'function' ? halfSpreadBps : typeof halfSpreadBps === 'number' ? () => halfSpreadBps : null;
  if (!spread) throw new Error('Mechanism engine: halfSpreadBps (a number or a function of symbol and date) is required');
  const P = config.portfolio, costs = config.costs, prm = config.params, mech = config.mechanism;
  const cHash = mechanismConfigHash(config);
  const hs = (sym, date) => Math.max(costs.halfSpreadFloorBps, spread(sym, date));
  const kOf = (sym, date) => (hs(sym, date) + costs.slippageBps) / 10000;
  const list = symbols.map((s) => (typeof s === 'string' ? { symbol: s } : s)).map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi }));
  const order = list.map((s) => s.symbol);
  const HIST = 262;
  const S = {
    configHash: cHash, period: { warmupFrom: config.period.warmupFrom, start: config.period.start, end: config.period.end }, cash: P.startingCash, lastDate: null,
    stocks: Object.fromEntries(order.map((s) => [s, { symbol: s, closes: [], mHist: [], lastClose: null, lastOpen: null, prevClose: null, position: null, pending: null, receivables: [], fractions: [], eligible: 0 }])),
    journal: Object.fromEntries(JOURNAL.map((k) => [k, []])),
  };
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
    rec('fills', { date, symbol: st.symbol, side: 'sell', shares: p.shares, open: b.o, price: px, halfSpreadBps: hs(st.symbol, date), slippageBps: costs.slippageBps, spreadSlippage: spreadCost, fees: fees.total, proceeds, decisionDate: o.decisionDate, reason: o.reason });
    const pnl = proceeds + (p.dividends || 0) + (p.cashInLieu || 0) - p.cost;
    rec('trades', { tradeId: p.tradeId, symbol: st.symbol, kind: 'mechanism', entryType: mech, entryDecisionDate: p.decisionDate, entryDate: p.fillDate, exitDate: date, exitReason: o.reason, exitDetail: o.detail ?? null, shares: p.shares, entryPrice: p.fillPrice, exitPrice: px, stop: p.stop, entryRisk: p.entryRisk, cost: p.cost, proceeds, dividends: p.dividends || 0, cashInLieu: p.cashInLieu || 0, costs: p.costs + spreadCost + fees.total, pnl, pnlPct: p.cost > 0 ? (pnl / p.cost) * 100 : null, sessionsHeld: p.sessions + 1, lossExceededRisk: pnl < -p.entryRisk - EPS });
    st.position = null;
    st.pending = null;
  }
  function buy(st, o, b, date) {
    const k = kOf(st.symbol, date), px = b.o * (1 + k);
    const reject = (code, message, extra = {}) => { warn(date, st.symbol, code, message, { decisionDate: o.decisionDate, open: b.o, price: px, entryType: mech, ...extra }); st.pending = null; };
    // The sizing reference at or above the fill (a gap down): the entry is rejected and recorded (section 5a).
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
        if (!o || o.side !== side || o.fillAfter >= date) continue;
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
    st.mHist.push(m); // m(t-1) as known at this close's decision; null while undefined
    if (st.mHist.length > (prm.lookback || 0) + 2) st.mHist.splice(0, st.mHist.length - ((prm.lookback || 0) + 2));
    if (st.position && st.position.fillDate < date) {
      st.position.sessions++; // the fill session is 0
      if (mech === 'B2') st.position.highest = Math.max(st.position.highest ?? -Infinity, st.prevClose ?? -Infinity); // highest close from the fill session to t-1
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

  // ---------- exits at the close (signal exit first, then the time exit; both fill at the next open) ----------
  function exits(date) {
    for (const s of order) {
      const st = S.stocks[s], p = st.position, t = st.today;
      if (!p || st.pending || !t) continue;
      // The fill session is session 0: a signal exit may be decided at its close; the time exit counts from it.
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
      st.pending = { side: 'sell', decisionDate: date, fillAfter: date, reason, detail };
      rec('decisions', { date, symbol: s, action: 'exit', reason, detail, close: c });
    }
  }

  // ---------- entries at the close (section 5), sized as campaign 2 ----------
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
  function entries(date) {
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

  function processSession(date, day = {}) {
    if (S.lastDate && date <= S.lastDate) throw new Error(`Mechanism engine: session ${date} out of order (last ${S.lastDate})`);
    if (S.period.end && date > S.period.end) throw new Error(`Mechanism engine: ${date} is after the period end ${S.period.end}`);
    out = Object.fromEntries([['date', date], ...JOURNAL.map((k) => [k, []])]);
    const bars = day.bars || {};
    const trading = date >= S.period.start;
    applySplits(date, day.splits);
    if (trading) payFractions(date, bars);
    entitle(date, day.dividends);
    if (trading) { payReceivables(date); fills(date, bars); }
    for (const s of order) { const st = S.stocks[s], b = bars[s]; st.today = null; if (b) closeStep(st, b, date); }
    if (S.cash < -EPS) throw new Error(`Mechanism engine: cash below zero on ${date}`);
    if (trading) { exits(date); equityPoint(date); entries(date); }
    for (const s of order) S.stocks[s].today = null;
    S.lastDate = date;
    const r = out; out = null;
    return clone(r);
  }
  function output() {
    const open = order.filter((s) => S.stocks[s].position).map((s) => { const st = S.stocks[s], p = st.position, value = p.shares * st.lastClose; return { tradeId: p.tradeId, symbol: s, kind: 'mechanism', entryType: mech, entryDate: p.fillDate, shares: p.shares, entryPrice: p.fillPrice, markPrice: st.lastClose, value, cost: p.cost, pnl: value + p.dividends + p.cashInLieu - p.cost, entryRisk: p.entryRisk, stop: p.stop, sessionsHeld: p.sessions }; });
    const pendingOrders = order.filter((s) => S.stocks[s].pending).map((s) => { const o = S.stocks[s].pending; return { symbol: s, side: o.side, decisionDate: o.decisionDate, entryType: mech, shares: o.shares ?? null, reason: o.reason }; });
    const unpaidDividends = order.flatMap((s) => S.stocks[s].receivables.map((r) => ({ symbol: s, exDate: r.exDate, payDate: r.payDate, gross: r.gross, net: r.net, tradeId: r.tradeId })));
    const eligibility = Object.fromEntries(order.map((s) => [s, S.stocks[s].eligible]));
    return { ...clone(S.journal), openPositions: open, pendingOrders, unpaidDividends, lastSales: {}, breaks: [], watches: [], eligibility, cash: S.cash, lastDate: S.lastDate, configHash: cHash, engineVersion: MECHANISM_ENGINE_VERSION };
  }
  return { processSession, output, snapshot: () => clone(S), get configHash() { return cHash; } };
}

// A whole run over `sessions` with `days` (Map date -> { bars, splits, dividends }).
export function runMechanism({ config, symbols, sessions, days, halfSpreadBps, dataHash = null }) {
  const e = createMechanismEngine({ config, symbols, halfSpreadBps });
  for (const d of sessions) {
    if (d < config.period.warmupFrom) continue;
    if (d > config.period.end) break;
    e.processSession(d, days.get(d) || {});
  }
  const out = e.output();
  const symbolsMeta = symbols.map((s) => (typeof s === 'string' ? { symbol: s } : s)).map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi }));
  const sym = crypto.createHash('sha256').update(canonicalJson(symbolsMeta)).digest('hex');
  return { ...out, meta: { engineVersion: MECHANISM_ENGINE_VERSION, configHash: mechanismConfigHash(config), version: config.version, mechanism: config.mechanism, startingCash: config.portfolio.startingCash, symbols: symbolsMeta, symbolsHash: sym, dataHash, period: { ...config.period }, simulated: true } };
}
