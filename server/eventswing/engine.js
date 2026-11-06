// event-swing's engine es-engine-1 (strategy/event-swing/CAMPAIGN-1.md sections 2, 5 and 6). Two account kinds:
// - the signal account (families B, C, D): campaign 3's portfolio mechanics mirrored from server/research/mechanisms.js
//   (decide after the close on completed bars, fill at the next open with spread and slippage, whole shares, one
//   position per stock, the 1% risk / 20% cap / 5% total-risk limits at the decision close and again at the fill,
//   splits, dividends, cash in lieu), with event triggers, recovery watches, invalidation exits and entry pauses;
// - the sleeve account (family A): ten equal sleeves holding their own stock, sold before an estimated announcement
//   and bought back once an announcement is known (or after a maximum time out), or forced spells for the placebo.
// Streaming and deterministic: processSession(date, day) in session order; an event reaches the engine only at its
// availability session (day.events) and its reaction uses closes up to that session; the NYSE calendar (known in
// advance) is the only forward-looking input. Simulation only: no order, no broker.
import crypto from 'node:crypto';
import { canonicalJson } from '../strategy/config.js';
import { sellFees } from '../hxr/engine.js';
import { sizeEntry } from '../rangetrend/engine.js';
import { typicalMove, sma } from '../research/mechanisms.js';
import { ENGINE_VERSION, configHash } from './config.js';
import { reactionClass, lowerBound } from './events.js';

const EPS = 1e-9;
const lt = (x, b) => x < b - EPS, gt = (x, a) => x > a + EPS;
const clone = (o) => JSON.parse(JSON.stringify(o));
const JOURNAL = ['decisions', 'fills', 'trades', 'skips', 'warnings', 'equity', 'dividends', 'splits', 'postExit', 'events', 'watches', 'estimates', 'spells'];
const HIST = 262, HIST_DATED = 400;
const addDaysIso = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function common({ config, symbols, halfSpreadBps, costMultiplier = 1 }) {
  if (!Array.isArray(symbols) || !symbols.length) throw new Error('event-swing engine: symbols must be a non-empty list');
  const spread = typeof halfSpreadBps === 'function' ? halfSpreadBps : typeof halfSpreadBps === 'number' ? () => halfSpreadBps : null;
  if (!spread) throw new Error('event-swing engine: halfSpreadBps (a number or a function of symbol and date) is required');
  if (!(costMultiplier >= 1)) throw new Error('event-swing engine: costMultiplier must be at least 1');
  const costs = config.costs;
  const hs = (sym, date) => Math.max(costs.halfSpreadFloorBps, spread(sym, date)) * costMultiplier;
  const kOf = (sym, date) => (Math.max(costs.halfSpreadFloorBps, spread(sym, date)) + costs.slippageBps) * costMultiplier / 10000;
  const list = symbols.map((s) => (typeof s === 'string' ? { symbol: s } : s)).map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null }));
  return { costs, hs, kOf, list, order: list.map((s) => s.symbol) };
}

// ======================================================================================================
// The signal account: families B, C and D.
// ======================================================================================================
export function createSignalEngine({ config, symbols, halfSpreadBps, costMultiplier = 1, period }) {
  if (config.kind !== 'signal') throw new Error('createSignalEngine needs a signal configuration');
  const { costs, hs, kOf, list, order } = common({ config, symbols, halfSpreadBps, costMultiplier });
  const P = config.portfolio, rule = config.rule, thr = config.events.reactionThreshold;
  const cHash = configHash(config);
  const S = {
    cash: P.startingCash, lastDate: null, period: { ...period },
    stocks: Object.fromEntries(order.map((s) => [s, { symbol: s, closes: [], hist: [], lastClose: null, prevClose: null, position: null, pending: null, receivables: [], fractions: [], watch: null, pauseLeft: 0, eligible: 0, today: null }])),
    journal: Object.fromEntries(JOURNAL.map((k) => [k, []])),
  };
  const rec = (kind, item) => { S.journal[kind].push(item); return item; };
  const warn = (date, symbol, code, message, details = {}) => rec('warnings', { date, symbol, code, message, details: clone(details) });
  const holdingsValue = () => order.reduce((a, s) => { const st = S.stocks[s]; return a + (st.position ? st.position.shares * st.lastClose : 0); }, 0);
  const reserved = () => order.reduce((a, s) => a + (S.stocks[s].pending?.side === 'buy' ? S.stocks[s].pending.cashShare : 0), 0);
  const entryRiskOpen = () => order.reduce((a, s) => { const st = S.stocks[s]; return a + (st.position ? st.position.entryRisk : 0) + (st.pending?.side === 'buy' ? st.pending.plannedRisk : 0); }, 0);

  function applySplits(date, splits) {
    for (const sp of splits || []) {
      const st = S.stocks[sp.symbol];
      if (!st) continue;
      const r = sp.ratio;
      if (!(r > 0)) throw new Error(`event-swing engine: split ratio for ${sp.symbol} on ${date} must be > 0`);
      st.closes = st.closes.map((c) => c / r);
      st.hist = st.hist.map((x) => ({ date: x.date, c: x.c / r, h: x.h / r, l: x.l / r }));
      if (st.lastClose != null) st.lastClose /= r;
      if (st.prevClose != null) st.prevClose /= r;
      if (st.watch) { st.watch.low /= r; if (st.watch.preClose != null) st.watch.preClose /= r; }
      const p = st.position;
      if (p) {
        for (const k of ['stop', 'fillPrice', 'm', 'inv']) if (p[k] != null) p[k] /= r;
        const before = p.shares, after = before * r, whole = Math.floor(after + EPS);
        if (after - whole > EPS) st.fractions.push({ shares: after - whole, tradeId: p.tradeId });
        p.shares = whole;
        if (whole < 1) closeAtSplit(st, date, before, r);
      }
      const o = st.pending;
      if (o?.side === 'buy') { o.shares = Math.floor(o.shares * r + EPS); for (const k of ['stop', 'refClose', 'm', 'inv']) if (o[k] != null) o[k] /= r; }
      rec('splits', { date, symbol: sp.symbol, ratio: r, sharesAfter: st.position?.shares ?? 0 });
    }
  }
  function closeAtSplit(st, date, sharesBefore, r) {
    const p = st.position;
    rec('trades', { tradeId: p.tradeId, symbol: st.symbol, kind: 'signal', entryType: config.id, entryDecisionDate: p.decisionDate, entryDate: p.fillDate, exitDate: date, exitReason: 'split_no_whole_share', shares: sharesBefore, entryPrice: p.fillPrice, exitPrice: null, stop: p.stop, entryRisk: p.entryRisk, cost: p.cost, proceeds: 0, dividends: p.dividends, cashInLieu: p.cashInLieu, costs: p.costs, pnl: p.dividends + p.cashInLieu - p.cost, pnlPct: null, sessionsHeld: p.sessions, event: p.event, lossExceededRisk: null });
    warn(date, st.symbol, 'split_closed', `the ${r}-for-1 split leaves no whole share of ${sharesBefore}`, { sharesBefore, ratio: r });
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
        if (st.position && st.position.tradeId === f.tradeId) st.position.cashInLieu += cash;
        else rec('postExit', { date, symbol: s, tradeId: f.tradeId, kind: 'cash_in_lieu', amount: cash });
        rec('dividends', { date, symbol: s, kind: 'cash_in_lieu', amount: cash, tradeId: f.tradeId });
      }
      st.fractions = [];
    }
  }
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
        if (st.position && st.position.tradeId === r.tradeId) st.position.dividends += r.net;
        else rec('postExit', { date, symbol: s, tradeId: r.tradeId, kind: 'dividend', amount: r.net });
        rec('dividends', { date, symbol: s, kind: 'payment', amount: r.net, tradeId: r.tradeId });
      }
    }
  }
  function sell(st, o, b, date) {
    const p = st.position;
    const k = kOf(st.symbol, date), px = b.o * (1 - k);
    const fees = sellFees(costs, p.shares, px);
    const proceeds = p.shares * px - fees.total;
    S.cash += proceeds;
    const spreadCost = p.shares * (b.o - px);
    rec('fills', { date, symbol: st.symbol, side: 'sell', shares: p.shares, open: b.o, price: px, spreadSlippage: spreadCost, fees: fees.total, proceeds, decisionDate: o.decisionDate, reason: o.reason });
    const pnl = proceeds + p.dividends + p.cashInLieu - p.cost;
    rec('trades', { tradeId: p.tradeId, symbol: st.symbol, kind: 'signal', entryType: config.id, entryDecisionDate: p.decisionDate, entryDate: p.fillDate, exitDate: date, exitReason: o.reason, exitDetail: o.detail ?? null, shares: p.shares, entryPrice: p.fillPrice, exitPrice: px, stop: p.stop, entryRisk: p.entryRisk, cost: p.cost, proceeds, dividends: p.dividends, cashInLieu: p.cashInLieu, costs: p.costs + spreadCost + fees.total, pnl, pnlPct: p.cost > 0 ? (pnl / p.cost) * 100 : null, sessionsHeld: p.sessions + 1, event: p.event, lossExceededRisk: pnl < -p.entryRisk - EPS });
    st.position = null;
    st.pending = null;
  }
  function buy(st, o, b, date) {
    const k = kOf(st.symbol, date), px = b.o * (1 + k);
    const reject = (code, message, extra = {}) => { warn(date, st.symbol, code, message, { decisionDate: o.decisionDate, open: b.o, price: px, event: o.event?.id ?? null, ...extra }); st.pending = null; };
    if (!lt(o.stop, px)) return reject('entry_rejected', `entry rejected: the sizing reference ${o.stop} is at or above the fill price ${px}`, { code: 'stop_above_fill', stop: o.stop });
    const dist = px - o.stop, cpo = costs.commissionPerOrder, cps = costs.commissionPerShare;
    const caps = { sized: o.shares, cash: Math.floor((Math.min(o.cashShare, S.cash) - cpo) / (px + cps) + EPS), position: Math.floor(o.capUsd / px + EPS), riskPerTrade: Math.floor(o.riskUsd / dist + EPS), riskRoom: o.roomShare == null ? null : Math.floor(o.roomShare / dist + EPS) };
    let n = Math.max(0, Math.min(...Object.values(caps).filter((v) => v != null)));
    while (n > 0 && n * px + cpo + cps * n > Math.min(o.cashShare, S.cash) + EPS) n--;
    if (n < 1) return reject('order_cancelled', 'buy cancelled: no whole share fits at the fill price', { code: 'no_whole_share', caps });
    if (n < o.shares) warn(date, st.symbol, 'order_reduced', `buy reduced from ${o.shares} to ${n} shares at the fill price`, { caps, from: o.shares, to: n });
    const cost = n * px + cpo + cps * n;
    if (S.cash - cost < -EPS) throw new Error(`event-swing engine: buying ${st.symbol} on ${date} would make cash negative`);
    S.cash -= cost;
    const spreadCost = n * (px - b.o);
    rec('fills', { date, symbol: st.symbol, side: 'buy', shares: n, open: b.o, price: px, spreadSlippage: spreadCost, fees: cpo + cps * n, cost, decisionDate: o.decisionDate, reason: config.id });
    st.position = { tradeId: `${st.symbol}:${date}`, shares: n, decisionDate: o.decisionDate, fillDate: date, fillPrice: px, stop: o.stop, inv: o.inv ?? null, entryRisk: n * dist, cost, costs: spreadCost + cpo + cps * n, m: o.m, sessions: 0, dividends: 0, cashInLieu: 0, event: o.event ?? null };
    st.pending = null;
  }
  function fills(date, bars) {
    for (const side of ['sell', 'buy']) {
      for (const s of order) {
        const st = S.stocks[s], o = st.pending;
        if (!o || o.side !== side || o.fillAfter >= date) continue;
        const b = bars[s];
        if (!b) { if (side === 'sell') { warn(date, s, 'order_waiting', `sell waits: no ${s} bar on ${date}`); continue; } warn(date, s, 'order_cancelled', `buy cancelled: no ${s} bar on ${date}`, { code: 'no_bar', decisionDate: o.decisionDate, event: o.event?.id ?? null }); st.pending = null; continue; }
        if (side === 'sell') sell(st, o, b, date); else buy(st, o, b, date);
      }
    }
  }
  function closeStep(st, b, date) {
    st.prevClose = st.lastClose;
    st.closes.push(b.c);
    if (st.closes.length > HIST) st.closes.splice(0, st.closes.length - HIST);
    st.hist.push({ date, c: b.c, h: b.h, l: b.l });
    if (st.hist.length > HIST_DATED) st.hist.splice(0, st.hist.length - HIST_DATED);
    st.lastClose = b.c;
    if (st.position && st.position.fillDate < date) st.position.sessions++;
    st.today = { c: b.c, o: b.o, h: b.h, l: b.l, m: typicalMove(st.closes) };
  }
  const closeOn = (st, date) => { for (let i = st.hist.length - 1; i >= 0; i--) { if (st.hist[i].date === date) return st.hist[i].c; if (st.hist[i].date < date) return null; } return null; };

  // ---------- the close of session t ----------
  function exits(date) {
    for (const s of order) {
      const st = S.stocks[s], p = st.position, t = st.today;
      if (!p || st.pending || !t) continue;
      let reason = null, detail = null;
      if (rule.trigger === 'm1') { const m5 = sma(st.closes, rule.exitSma); if (m5 != null && gt(t.c, m5)) { reason = 'signal'; detail = { rule: 'close above the short average', level: m5 }; } }
      else if (rule.invalidation && p.inv != null && lt(t.c, p.inv)) { reason = 'invalidation'; detail = { rule: rule.invalidation, level: p.inv }; }
      if (!reason && p.sessions >= rule.timeExit) { reason = 'time'; detail = { rule: `time exit after ${rule.timeExit} sessions`, sessions: p.sessions }; }
      if (!reason) continue;
      st.pending = { side: 'sell', decisionDate: date, fillAfter: date, reason, detail };
      rec('decisions', { date, symbol: s, action: 'exit', reason, detail, close: t.c });
    }
  }
  function equityPoint(date) {
    const holdings = holdingsValue(), equity = S.cash + holdings;
    const receivable = order.reduce((a, s) => a + S.stocks[s].receivables.reduce((x, r) => x + r.net, 0), 0);
    rec('equity', { date, cash: S.cash, holdings, equity, receivable, invested: equity > 0 ? holdings / equity : 0, entryRisk: entryRiskOpen(), positions: order.filter((s) => S.stocks[s].position).length });
  }
  const eventInfo = (e, R) => ({ id: e.id, availDate: e.availDate, preDate: e.preDate, R, reaction: reactionClass(R, thr), guidance: e.guidance ?? 'no_text', timing: e.timing ?? null, interim: !!e.interim, delayed: e.delayed ?? 0 });
  const matches = (sel, R, guidance) => {
    if (sel.reaction === 'negative' && !(R != null && R <= -thr + 1e-12)) return false;
    if (sel.reaction === 'positive' && !(R != null && R >= thr - 1e-12)) return false;
    if (Array.isArray(sel.guidance) && !sel.guidance.includes(guidance ?? 'no_text')) return false;
    return true;
  };
  // Returns the signals of this close (sized together afterwards).
  function decide(date, events) {
    const signals = [];
    const signalled = new Set();
    // (1) Events of this availability session: reactions, pauses (family D), triggers (families B and C).
    const triggers = [];
    for (const e of events || []) {
      const st = S.stocks[e.symbol];
      if (!st || !st.today) { rec('events', { ...eventInfo(e, null), action: 'no_bar' }); continue; }
      const c0 = closeOn(st, e.preDate);
      const R = c0 > 0 ? st.today.c / c0 - 1 : null;
      const info = eventInfo(e, R);
      if (R == null) { rec('events', { ...info, action: 'no_pre_event_close' }); continue; }
      if (rule.trigger === 'm1') {
        if (rule.pause && matches(rule.pause, R, e.guidance)) { st.pauseLeft = rule.pause.sessions; rec('events', { ...info, action: 'pause' }); } else rec('events', { ...info, action: rule.pause ? 'no_pause' : 'ignored' });
        continue;
      }
      if (rule.trigger !== 'event') { rec('events', { ...info, action: 'ignored' }); continue; }
      if (!matches(rule, R, e.guidance)) { rec('events', { ...info, action: 'filtered' }); continue; }
      triggers.push({ st, info, preClose: c0 });
    }
    // (2) Price triggers (the price-only controls): the two-session move, with C(t-2) as the pre-trigger close.
    if (rule.trigger === 'price') {
      for (const s of order) {
        const st = S.stocks[s];
        if (!st.today || st.closes.length < rule.priceSessions + 1) continue;
        const pre = st.closes[st.closes.length - 1 - rule.priceSessions];
        const mv = st.today.c / pre - 1;
        const hit = rule.priceMove === 'negative' ? mv <= -thr + 1e-12 : mv >= thr - 1e-12;
        if (hit) triggers.push({ st, info: { id: `${s}:${date}:price`, availDate: date, R: mv, reaction: reactionClass(mv, thr), price: true }, preClose: pre });
      }
    }
    // (3) Existing watches (family B): this session counts if it is after the trigger session.
    if (rule.entry === 'recovery') {
      for (const s of order) {
        const st = S.stocks[s], w = st.watch, t = st.today;
        if (!w || !t || date <= w.trigger.availDate) continue;
        w.sessions++;
        w.low = Math.min(w.low, t.l);
        const prev = st.hist.at(-2);
        if (prev && gt(t.c, prev.h) && gt(t.c, prev.c)) {
          st.watch = null;
          if (st.position || st.pending) { rec('watches', { symbol: s, trigger: w.trigger, outcome: 'already_held', date }); continue; }
          signals.push({ st, c: t.c, stop: w.low, inv: w.low, m: t.m, event: w.trigger, values: { close: t.c, prevHigh: prev.h, prevClose: prev.c, low: w.low } });
          signalled.add(s);
          rec('watches', { symbol: s, trigger: w.trigger, outcome: 'recovery', date, sessions: w.sessions, low: w.low });
        } else if (w.sessions >= rule.watchSessions) {
          st.watch = null;
          rec('watches', { symbol: s, trigger: w.trigger, outcome: 'no_recovery', date, sessions: w.sessions, low: w.low, triggerClose: w.triggerClose });
        }
      }
    }
    // (4) New triggers.
    for (const { st, info, preClose } of triggers) {
      const s = st.symbol, t = st.today;
      if (st.position || st.pending || signalled.has(s)) { rec('events', { ...info, action: 'already_held' }); continue; }
      if (rule.entry === 'recovery') {
        if (st.watch) rec('watches', { symbol: s, trigger: st.watch.trigger, outcome: 'restarted', date, by: info.id });
        st.watch = { trigger: info, sessions: 0, low: t.l, triggerClose: t.c, preClose };
        rec('events', { ...info, action: 'watch' });
        continue;
      }
      let stop = null, inv = null;
      if (rule.sizing === 'close_minus_2m') { if (!(t.m > EPS)) { rec('skips', { date, symbol: s, code: 'no_typical_move', event: info.id, reason: 'the typical move is undefined' }); rec('events', { ...info, action: 'no_typical_move' }); continue; } stop = t.c - 2 * t.m; }
      else if (rule.sizing === 'pre_trigger_close') stop = preClose;
      if (rule.invalidation === 'below_pre_trigger_close') inv = preClose;
      signals.push({ st, c: t.c, stop, inv, m: t.m, event: info, values: { close: t.c, preClose, R: info.R } });
      signalled.add(s);
      rec('events', { ...info, action: 'signal' });
    }
    // (5) The underlying rule of family D (campaign 3's M1 n=3), with the pauses.
    if (rule.trigger === 'm1') {
      for (const s of order) {
        const st = S.stocks[s], t = st.today;
        if (!t) continue;
        const filterSma = sma(st.closes, rule.filterSma);
        const exitSma = sma(st.closes, rule.exitSma);
        const defined = t.m != null && st.closes.length >= rule.down + 1 && filterSma != null && exitSma != null;
        if (defined) st.eligible++;
        if (!defined || st.position || st.pending || !(t.m > EPS)) continue;
        const c = st.closes;
        let down = true;
        for (let i = 0; i < rule.down; i++) if (!lt(c[c.length - 1 - i], c[c.length - 2 - i])) { down = false; break; }
        if (!down || !gt(t.c, filterSma)) continue;
        if (st.pauseLeft > 0) { rec('skips', { date, symbol: s, code: 'paused_after_event', close: t.c, pauseLeft: st.pauseLeft, reason: 'an entry inside the pause after an event' }); continue; }
        signals.push({ st, c: t.c, stop: t.c - rule.stopM * t.m, inv: null, m: t.m, event: null, values: { close: t.c, filterSma, m: t.m } });
      }
    }
    return signals;
  }
  function size(date, signals) {
    if (!signals.length) return;
    const V = S.cash + holdingsValue();
    const avail = Math.max(0, S.cash - reserved());
    const room = P.totalEntryRiskPct == null ? null : Math.max(0, (P.totalEntryRiskPct / 100) * V - entryRiskOpen());
    const n = signals.length;
    for (const sg of signals) {
      const { st, c } = sg;
      const k = kOf(st.symbol, date);
      const cashShare = avail / n, roomShare = room == null ? null : room / n;
      const capUsd = (P.positionCapPct / 100) * V, riskUsd = (P.riskPerTradePct / 100) * V;
      const dist = c - sg.stop;
      const base = { date, symbol: st.symbol, kind: 'signal', entryType: config.id, values: sg.values, V, signalsToday: n, cashShare, roomShare, capUsd, riskUsd, stop: sg.stop, close: c, event: sg.event?.id ?? null };
      if (!(dist > EPS)) { rec('skips', { ...base, code: 'stop_above_close', reason: `the sizing reference ${sg.stop} is at or above the close ${c}` }); continue; }
      const { shares, caps, binding } = sizeEntry({ price: c, stop: sg.stop, cashShare, roomShare, capUsd, riskUsd, k, commissionPerOrder: costs.commissionPerOrder, commissionPerShare: costs.commissionPerShare });
      if (shares < 1) { rec('skips', { ...base, code: 'no_whole_share', caps, binding, reason: `no whole share fits (${binding.join(', ')} binding)` }); continue; }
      st.pending = { side: 'buy', decisionDate: date, fillAfter: date, reason: config.id, shares, refClose: c, cashShare, roomShare, capUsd, riskUsd, stop: sg.stop, inv: sg.inv, plannedRisk: shares * dist, m: sg.m, event: sg.event };
      rec('decisions', { ...base, action: 'entry', shares, caps, binding, plannedRisk: shares * dist });
    }
  }

  function processSession(date, day = {}) {
    if (S.lastDate && date <= S.lastDate) throw new Error(`event-swing engine: session ${date} out of order (last ${S.lastDate})`);
    if (S.period.end && date > S.period.end) throw new Error(`event-swing engine: ${date} is after the period end ${S.period.end}`);
    const bars = day.bars || {};
    const trading = date >= S.period.start;
    applySplits(date, day.splits);
    if (trading) payFractions(date, bars);
    entitle(date, day.dividends);
    if (trading) { payReceivables(date); fills(date, bars); }
    for (const s of order) { const st = S.stocks[s], b = bars[s]; st.today = null; if (b) closeStep(st, b, date); }
    if (S.cash < -EPS) throw new Error(`event-swing engine: cash below zero on ${date}`);
    if (trading) {
      exits(date);
      equityPoint(date);
      size(date, decide(date, day.events));
    }
    for (const s of order) { const st = S.stocks[s]; if (st.today && st.pauseLeft > 0) st.pauseLeft--; st.today = null; }
    S.lastDate = date;
  }
  function output() {
    const open = order.filter((s) => S.stocks[s].position).map((s) => { const st = S.stocks[s], p = st.position, value = p.shares * st.lastClose; return { tradeId: p.tradeId, symbol: s, kind: 'signal', entryType: config.id, entryDate: p.fillDate, shares: p.shares, entryPrice: p.fillPrice, markPrice: st.lastClose, value, cost: p.cost, pnl: value + p.dividends + p.cashInLieu - p.cost, entryRisk: p.entryRisk, stop: p.stop, sessionsHeld: p.sessions, event: p.event }; });
    const pendingOrders = order.filter((s) => S.stocks[s].pending).map((s) => { const o = S.stocks[s].pending; return { symbol: s, side: o.side, decisionDate: o.decisionDate, shares: o.shares ?? null, reason: o.reason }; });
    const unpaidDividends = order.flatMap((s) => S.stocks[s].receivables.map((r) => ({ symbol: s, exDate: r.exDate, payDate: r.payDate, gross: r.gross, net: r.net, tradeId: r.tradeId })));
    const openWatches = order.filter((s) => S.stocks[s].watch).map((s) => ({ symbol: s, trigger: S.stocks[s].watch.trigger, sessions: S.stocks[s].watch.sessions }));
    return { ...clone(S.journal), openPositions: open, pendingOrders, unpaidDividends, openWatches, eligibility: Object.fromEntries(order.map((s) => [s, S.stocks[s].eligible])), cash: S.cash, lastDate: S.lastDate, configHash: cHash, engineVersion: ENGINE_VERSION };
  }
  return { processSession, output, snapshot: () => clone(S) };
}

// ======================================================================================================
// The sleeve account: family A.
// ======================================================================================================
export function createSleeveEngine({ config, symbols, halfSpreadBps, costMultiplier = 1, period, calendar, forcedSpells = null }) {
  if (config.kind !== 'sleeves') throw new Error('createSleeveEngine needs a sleeves configuration');
  if (!Array.isArray(calendar) || !calendar.length) throw new Error('createSleeveEngine needs the session calendar');
  const { costs, hs, kOf, list, order } = common({ config, symbols, halfSpreadBps, costMultiplier });
  const P = config.portfolio, rule = config.rule;
  if (order.length !== P.sleeves) throw new Error(`event-swing engine: ${P.sleeves} sleeves for ${order.length} stocks; the sleeves must hold the whole starting cash, one per stock`);
  const k = rule.exitBefore;
  const cHash = configHash(config);
  const sleeve0 = P.startingCash / P.sleeves;
  const listed = Object.fromEntries(list.map((s) => [s.symbol, s.listedFrom]));
  const S = {
    lastDate: null, period: { ...period },
    stocks: Object.fromEntries(order.map((s) => [s, { symbol: s, cash: sleeve0, started: false, lastClose: null, position: null, pending: null, receivables: [], fractions: [], estimates: [], known: [], lastEstimate: null, spell: null, outSessions: 0, forced: (forcedSpells?.[s] || []).map((x) => ({ ...x })) }])),
    journal: Object.fromEntries(JOURNAL.map((key) => [key, []])),
  };
  const rec = (kind, item) => { S.journal[kind].push(item); return item; };
  const warn = (date, symbol, code, message, details = {}) => rec('warnings', { date, symbol, code, message, details: clone(details) });
  const idx = (date) => lowerBound(calendar, date);

  function applySplits(date, splits) {
    for (const sp of splits || []) {
      const st = S.stocks[sp.symbol];
      if (!st) continue;
      const r = sp.ratio;
      if (st.lastClose != null) st.lastClose /= r;
      const p = st.position;
      if (p) {
        p.fillPrice /= r;
        const before = p.shares, after = before * r, whole = Math.floor(after + EPS);
        if (after - whole > EPS) st.fractions.push({ shares: after - whole, tradeId: p.tradeId });
        p.shares = whole;
      }
      if (st.spell?.exitPrice != null && st.spell.reentryFill == null) { st.spell.exitPrice /= r; st.spell.shares *= r; }
      rec('splits', { date, symbol: sp.symbol, ratio: r, sharesAfter: st.position?.shares ?? 0 });
    }
  }
  function payFractions(date, bars) {
    for (const s of order) {
      const st = S.stocks[s], b = bars[s];
      if (!st.fractions.length || !b) continue;
      for (const f of st.fractions) {
        const cash = f.shares * b.o * (1 - hs(s, date) / 10000);
        st.cash += cash;
        if (st.position && st.position.tradeId === f.tradeId) st.position.cashInLieu += cash; else rec('postExit', { date, symbol: s, tradeId: f.tradeId, kind: 'cash_in_lieu', amount: cash });
        rec('dividends', { date, symbol: s, kind: 'cash_in_lieu', amount: cash, tradeId: f.tradeId });
      }
      st.fractions = [];
    }
  }
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
        st.cash += r.net;
        if (st.position && st.position.tradeId === r.tradeId) st.position.dividends += r.net; else rec('postExit', { date, symbol: s, tradeId: r.tradeId, kind: 'dividend', amount: r.net });
        rec('dividends', { date, symbol: s, kind: 'payment', amount: r.net, tradeId: r.tradeId });
      }
    }
  }
  function buy(st, b, date, o) {
    const kk = kOf(st.symbol, date), px = b.o * (1 + kk), cpo = costs.commissionPerOrder, cps = costs.commissionPerShare;
    let n = Math.floor((st.cash - cpo) / (px + cps) + EPS);
    while (n > 0 && n * px + cpo + cps * n > st.cash + EPS) n--;
    st.pending = null;
    if (n < 1) { warn(date, st.symbol, 'order_cancelled', 'buy cancelled: no whole share fits in the sleeve', { code: 'no_whole_share', sleeveCash: st.cash, price: px, decisionDate: o.decisionDate }); return false; }
    const cost = n * px + cpo + cps * n;
    st.cash -= cost;
    const spreadCost = n * (px - b.o);
    rec('fills', { date, symbol: st.symbol, side: 'buy', shares: n, open: b.o, price: px, spreadSlippage: spreadCost, fees: cpo + cps * n, cost, decisionDate: o.decisionDate, reason: o.reason });
    st.position = { tradeId: `${st.symbol}:${date}`, shares: n, decisionDate: o.decisionDate, fillDate: date, fillPrice: px, cost, costs: spreadCost + cpo + cps * n, sessions: 0, dividends: 0, cashInLieu: 0 };
    if (st.spell && st.spell.reentryFill == null && o.reason !== 'initial') { st.spell.reentryFill = date; st.spell.reentryPrice = px; st.spell.reentryShares = n; rec('spells', clone(st.spell)); st.spell = null; }
    return true;
  }
  function sell(st, b, date, o) {
    const p = st.position, kk = kOf(st.symbol, date), px = b.o * (1 - kk);
    const fees = sellFees(costs, p.shares, px);
    const proceeds = p.shares * px - fees.total;
    st.cash += proceeds;
    const spreadCost = p.shares * (b.o - px);
    rec('fills', { date, symbol: st.symbol, side: 'sell', shares: p.shares, open: b.o, price: px, spreadSlippage: spreadCost, fees: fees.total, proceeds, decisionDate: o.decisionDate, reason: o.reason });
    const pnl = proceeds + p.dividends + p.cashInLieu - p.cost;
    rec('trades', { tradeId: p.tradeId, symbol: st.symbol, kind: 'sleeve', entryType: config.id, entryDecisionDate: p.decisionDate, entryDate: p.fillDate, exitDate: date, exitReason: o.reason, shares: p.shares, entryPrice: p.fillPrice, exitPrice: px, cost: p.cost, proceeds, dividends: p.dividends, cashInLieu: p.cashInLieu, costs: p.costs + spreadCost + fees.total, pnl, pnlPct: p.cost > 0 ? (pnl / p.cost) * 100 : null, sessionsHeld: p.sessions + 1, entryRisk: 0, lossExceededRisk: null });
    st.spell.exitFill = date; st.spell.exitPrice = px; st.spell.shares = p.shares; st.spell.exitOpen = b.o;
    st.position = null; st.pending = null; st.outSessions = 0;
  }
  function fills(date, bars) {
    for (const side of ['sell', 'buy']) {
      for (const s of order) {
        const st = S.stocks[s], o = st.pending, b = bars[s];
        if (!o || o.side !== side || o.fillAfter >= date) continue;
        // CAMPAIGN-1.md section 6: a sell waits for the stock's next bar; a buy without a bar is cancelled (the spell
        // stays open, so the time-out re-entry fires again at the stock's next session).
        if (!b) { if (side === 'sell') warn(date, s, 'order_waiting', `sell waits: no ${s} bar on ${date}`); else { warn(date, s, 'order_cancelled', `buy cancelled: no ${s} bar on ${date}`, { code: 'no_bar', decisionDate: o.decisionDate }); st.pending = null; } continue; }
        if (side === 'sell') sell(st, b, date, o); else buy(st, b, date, o);
      }
    }
    // The initial purchase: each sleeve at its stock's first window open (an order fixed before the window).
    for (const s of order) {
      const st = S.stocks[s], b = bars[s];
      if (st.started || !b || date < S.period.start || (listed[s] && date < listed[s])) continue;
      st.started = true;
      buy(st, b, date, { decisionDate: null, reason: 'initial' });
    }
  }
  // An event reaches the account at its availability session (or, before the window, at the first session).
  function intake(date, events) {
    for (const e of events || []) {
      const st = S.stocks[e.symbol];
      if (!st) continue;
      st.known.push({ id: e.id, D: e.D, availDate: e.availDate ?? null, interim: !!e.interim });
      if (k == null || forcedSpells) continue;
      if (!e.interim) {
        const est = addDaysIso(e.D, rule.estimateOffsetDays);
        if (st.lastEstimate && dayDiff(st.lastEstimate, est) < rule.estimateMinGapDays) rec('estimates', { symbol: e.symbol, fromEvent: e.id, estimate: est, status: 'dropped_too_close', knownAt: date });
        else {
          st.lastEstimate = est;
          const ei = idx(est);
          const exitI = ei - k, decI = ei - k - 1;
          const item = { symbol: e.symbol, fromEvent: e.id, fromD: e.D, estimate: est, knownAt: date, target: calendar[ei] ?? null, exitSession: calendar[exitI] ?? null, decisionSession: calendar[decI] ?? null, status: 'pending' };
          if (ei >= calendar.length || decI < 0) item.status = 'outside_window';
          else if (calendar[decI] < date) item.status = 'known_too_late';
          st.estimates.push(item);
          if (item.status !== 'pending') rec('estimates', clone(item));
        }
      }
      // Re-entry: the sleeve is out and an announcement became available on or after the exit fill.
      if (st.spell && st.spell.exitFill && !st.pending && !st.position && e.availDate && e.availDate >= st.spell.exitFill) {
        st.pending = { side: 'buy', decisionDate: date, fillAfter: date, reason: 'event_available' };
        st.spell.reentryDecision = date; st.spell.reentryReason = 'event_available'; st.spell.reentryEvent = e.id;
        rec('decisions', { date, symbol: e.symbol, action: 're_entry', reason: 'event_available', event: e.id });
      }
    }
  }
  function decideExits(date, bars) {
    for (const s of order) {
      const st = S.stocks[s];
      if (forcedSpells) {
        const f = st.forced[0];
        if (f && f.exitDecision === date) {
          if (st.position && !st.pending) { st.pending = { side: 'sell', decisionDate: date, fillAfter: date, reason: 'placebo_spell' }; st.spell = { symbol: s, forced: true, exitDecision: date }; rec('decisions', { date, symbol: s, action: 'exit', reason: 'placebo_spell' }); }
          else warn(date, s, 'placebo_spell_skipped', 'the sleeve is not invested at the placebo spell', {});
        }
        if (f && f.reentryDecision === date) {
          st.forced.shift();
          if (st.spell && st.spell.exitFill && !st.position && !st.pending) { st.pending = { side: 'buy', decisionDate: date, fillAfter: date, reason: 'placebo_spell_end' }; st.spell.reentryDecision = date; st.spell.reentryReason = 'placebo_spell_end'; }
        }
        continue;
      }
      if (k == null) continue;
      // Time out: the sleeve is out and maxOutSessions of the stock's sessions passed since the exit fill.
      if (st.spell && st.spell.exitFill && !st.position && !st.pending && bars[s]) {
        if (date > st.spell.exitFill) st.outSessions++;
        if (st.outSessions >= rule.maxOutSessions) { st.pending = { side: 'buy', decisionDate: date, fillAfter: date, reason: 'max_out' }; st.spell.reentryDecision = date; st.spell.reentryReason = 'max_out'; rec('decisions', { date, symbol: s, action: 're_entry', reason: 'max_out' }); }
      }
      for (const est of st.estimates) {
        if (est.status !== 'pending' || est.decisionSession !== date) continue;
        if (!st.position || st.pending) { est.status = 'not_invested'; rec('estimates', clone(est)); continue; }
        const cutoff = addDaysIso(est.estimate, -rule.cancelWithinDays);
        const announced = st.known.find((x) => x.D >= cutoff && x.availDate);
        if (announced) { est.status = 'already_announced'; est.announcedEvent = announced.id; rec('estimates', clone(est)); continue; }
        est.status = 'exit';
        rec('estimates', clone(est));
        st.pending = { side: 'sell', decisionDate: date, fillAfter: date, reason: 'pre_announcement_exit' };
        st.spell = { symbol: s, estimate: est.estimate, fromEvent: est.fromEvent, target: est.target, exitDecision: date };
        rec('decisions', { date, symbol: s, action: 'exit', reason: 'pre_announcement_exit', estimate: est.estimate });
      }
      // Estimates whose decision session passed without the stock being processed (no change of state) stay recorded.
    }
  }
  function equityPoint(date) {
    let cash = 0, holdings = 0;
    for (const s of order) { const st = S.stocks[s]; cash += st.cash; if (st.position) holdings += st.position.shares * st.lastClose; }
    const equity = cash + holdings;
    const receivable = order.reduce((a, s) => a + S.stocks[s].receivables.reduce((x, r) => x + r.net, 0), 0);
    rec('equity', { date, cash, holdings, equity, receivable, invested: equity > 0 ? holdings / equity : 0, positions: order.filter((s) => S.stocks[s].position).length });
  }
  function processSession(date, day = {}) {
    if (S.lastDate && date <= S.lastDate) throw new Error(`event-swing engine: session ${date} out of order (last ${S.lastDate})`);
    if (S.period.end && date > S.period.end) throw new Error(`event-swing engine: ${date} is after the period end ${S.period.end}`);
    const bars = day.bars || {};
    applySplits(date, day.splits);
    payFractions(date, bars);
    entitle(date, day.dividends);
    payReceivables(date);
    fills(date, bars);
    for (const s of order) { const st = S.stocks[s], b = bars[s]; if (b) { st.lastClose = b.c; if (st.position && st.position.fillDate < date) st.position.sessions++; } }
    for (const s of order) if (S.stocks[s].cash < -EPS) throw new Error(`event-swing engine: sleeve ${s} cash below zero on ${date}`);
    intake(date, day.events);
    decideExits(date, bars);
    equityPoint(date);
    S.lastDate = date;
  }
  function output() {
    const open = order.filter((s) => S.stocks[s].position).map((s) => { const st = S.stocks[s], p = st.position, value = p.shares * st.lastClose; return { tradeId: p.tradeId, symbol: s, kind: 'sleeve', entryType: config.id, entryDate: p.fillDate, shares: p.shares, entryPrice: p.fillPrice, markPrice: st.lastClose, value, cost: p.cost, pnl: value + p.dividends + p.cashInLieu - p.cost, entryRisk: 0, sessionsHeld: p.sessions }; });
    const pendingOrders = order.filter((s) => S.stocks[s].pending).map((s) => ({ symbol: s, side: S.stocks[s].pending.side, decisionDate: S.stocks[s].pending.decisionDate, reason: S.stocks[s].pending.reason }));
    const openSpells = order.filter((s) => S.stocks[s].spell).map((s) => clone(S.stocks[s].spell));
    const pendingEstimates = order.flatMap((s) => S.stocks[s].estimates.filter((e) => e.status === 'pending').map(clone));
    const unpaidDividends = order.flatMap((s) => S.stocks[s].receivables.map((r) => ({ symbol: s, exDate: r.exDate, payDate: r.payDate, gross: r.gross, net: r.net, tradeId: r.tradeId })));
    const cash = order.reduce((a, s) => a + S.stocks[s].cash, 0);
    return { ...clone(S.journal), openPositions: open, pendingOrders, unpaidDividends, openSpells, pendingEstimates, sleeveCash: Object.fromEntries(order.map((s) => [s, S.stocks[s].cash])), cash, lastDate: S.lastDate, configHash: cHash, engineVersion: ENGINE_VERSION };
  }
  return { processSession, output, snapshot: () => clone(S) };
}

// ======================================================================================================
// A whole run: events are delivered at their availability sessions; events before the window at its first session.
// ======================================================================================================
export function runConfig({ config, inputs, events = [], prewindow = [], halfSpreadBps, costMultiplier = 1, period = null, forcedSpells = null, stopAt = null }) {
  const pr = period ?? { warmupFrom: inputs.sessions[0], start: inputs.sessions[0], end: inputs.sessions.at(-1) };
  const engine = config.kind === 'sleeves'
    ? createSleeveEngine({ config, symbols: inputs.symbols, halfSpreadBps, costMultiplier, period: pr, calendar: inputs.sessions, forcedSpells })
    : createSignalEngine({ config, symbols: inputs.symbols, halfSpreadBps, costMultiplier, period: pr });
  const byDate = new Map();
  const sorted = [...events].sort((a, b) => (a.availDate < b.availDate ? -1 : a.availDate > b.availDate ? 1 : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : a.id < b.id ? -1 : 1));
  for (const e of sorted) { if (!byDate.has(e.availDate)) byDate.set(e.availDate, []); byDate.get(e.availDate).push(e); }
  let first = true;
  for (const d of inputs.sessions) {
    if (d < pr.warmupFrom) continue;
    if (d > pr.end || (stopAt && d > stopAt)) break;
    const day = inputs.days.get(d) || {};
    const evs = [...(first ? [...prewindow].sort((a, b) => (a.D < b.D ? -1 : a.D > b.D ? 1 : a.symbol < b.symbol ? -1 : 1)) : []), ...(byDate.get(d) || [])];
    first = false;
    engine.processSession(d, { bars: day.bars, splits: day.splits, dividends: day.dividends, events: evs });
  }
  const out = engine.output();
  const symbolsMeta = inputs.symbols.map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null }));
  return { ...out, meta: { engineVersion: ENGINE_VERSION, configId: config.id, configHash: configHash(config), startingCash: config.portfolio.startingCash, symbols: symbolsMeta, symbolsHash: crypto.createHash('sha256').update(canonicalJson(symbolsMeta)).digest('hex'), period: pr, costMultiplier, simulated: true } };
}
