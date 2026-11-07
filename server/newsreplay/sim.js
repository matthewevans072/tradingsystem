// The news-replay executor nr-engine-1 (CAMPAIGN-1.md sections 6 and 7; experimental assumptions). It applies saved
// plans to 5-minute bars in time order and emits actions; it computes no outcome (the evaluation pass does, from the
// saved actions). Activation: the first 5-minute close in (T, T + 30 min] at or above the bullish level or at or below
// the bearish level. Entries (identical signals; only the entry differs): A at the open of the next printed bar after
// activation; B after activation above the prior completed session's close, a bar trading at or below that close,
// then a later bar closing above that touching bar's high, filled at the next bar open; C the same at the prior
// completed session's value-area high. Setups expire at the end of the second session after activation; a bearish
// activation of the stock cancels a pending entry and exits a holding at the next bar open. Exits: a daily close below
// the invalidation level (exit at the next session's first bar open); the time stop at the close of the 10th session
// after the fill. Portfolio (campaign 3): US$15,000, long only, whole shares, one position per stock, no adding, 1% risk
// to the invalidation level, 20% position cap, 5% total planned risk, same-time fills share cash and risk room equally,
// cash never negative, every limit at the fill. Costs: calibrated half-spread (floor 2 bps) plus 2 bps slippage per
// side, SEC fee and TAF on sells; dividends net of 15% withholding; splits applied to shares and levels. Never a fill
// at a price from before its decision. Simulation only: no order, no broker.
import { sellFees } from '../hxr/engine.js';
import { WINDOW_MS, TIME_STOP_SESSIONS } from './planner.js';
import { amtExitOf } from './exits.js';

export const ENGINE = 'nr-engine-1';
export const ENGINE_2 = 'nr-engine-2'; // campaign 2: nr-engine-1 plus the AMT exits (exit 'existing' is nr-engine-1 unchanged)
const EPS = 1e-9;

// market: { sessions, sessionIndex: Map, bars5: Map sym -> Map date -> [{ s, e, o, h, l, c, v }], daily: Map sym -> Map
// date -> { o, h, l, c }, profiles: (sym, priorSession, asOfSession) -> { vah } | null, splits: [{ symbol, date, ratio }],
// dividends: [{ symbol, exDate, payDate, amount }], halfSpread: (sym, date) -> bps, closeMs: (date) -> ms, openMs }
export function prepareMarket(m) {
  const flat = new Map(); // sym -> [{ ...bar, date, di }]
  for (const [sym, byDate] of m.bars5) {
    const arr = [];
    for (const d of m.sessions) { const bs = byDate.get(d); if (bs) for (const b of bs) arr.push({ ...b, date: d, di: m.sessionIndex.get(d) }); }
    flat.set(sym, arr);
  }
  const pos = new Map(); // sym -> Map(e ms -> index in flat) for locating the activation bar
  for (const [sym, arr] of flat) pos.set(sym, new Map(arr.map((b, i) => [b.e, i])));
  const splitSyms = new Set(m.splits.map((x) => x.symbol));
  const ratioAfter = (sym, fromDate, toDate) => (splitSyms.has(sym) ? m.splits.reduce((f, x) => (x.symbol === sym && x.date > fromDate && x.date <= toDate ? f * x.ratio : f), 1) : 1);
  return { ...m, flat, pos, ratioAfter };
}

// The activation of one plan: { dir: 'bull'|'bear', i (index in the stock's flat bars), bar } or null.
export function activationOf(plan, mk) {
  if (plan.status !== 'armed') return null;
  const arr = mk.flat.get(plan.stock);
  if (!arr) return null;
  const up = plan.bullish.activation.level, down = plan.bearish.activation.level;
  const end = plan.T + WINDOW_MS;
  // news-forward: a plan recorded after T (plan.notBeforeMs) looks only at bars that close after it was recorded.
  const startMs = plan.notBeforeMs != null && plan.notBeforeMs > plan.T ? plan.notBeforeMs : plan.T;
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].e <= startMs) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < arr.length && arr[i].e <= end; i++) {
    const b = arr[i];
    if (b.date !== plan.session) break;
    if (b.c >= up - EPS) return { dir: 'bull', i, bar: b };
    if (b.c <= down + EPS) return { dir: 'bear', i, bar: b };
  }
  return null;
}

// The entry fill of a bullish activation under treatment A, B or C: { fate, fillI?, level? }.
export function entryOf(act, plan, treatment, mk) {
  const arr = mk.flat.get(plan.stock);
  if (treatment === 'A') return act.i + 1 < arr.length ? { fate: 'pending', fillI: act.i + 1 } : { fate: 'expired', why: 'no later bar in the replay', knownMs: act.bar.e };
  const actDate = act.bar.date, di = act.bar.di;
  const prior = mk.sessions[di - 1];
  let level = null;
  if (treatment === 'B') { const d = mk.daily.get(plan.stock)?.get(prior); level = d ? d.c / mk.ratioAfter(plan.stock, prior, actDate) : null; }
  else { const p = mk.profiles(plan.stock, prior, actDate); level = p ? p.vah : null; }
  if (level == null) return { fate: 'no_setup', why: treatment === 'B' ? 'no prior close' : 'no prior-session profile', knownMs: act.bar.e };
  if (!(act.bar.c > level + EPS)) return { fate: 'no_setup', why: `activation close not above the ${treatment === 'B' ? 'prior close' : 'prior value-area high'}`, level, knownMs: act.bar.e };
  const lastDi = di + 2;
  let touch = null, lastE = act.bar.e;
  for (let i = act.i + 1; i < arr.length && arr[i].di <= lastDi; i++) {
    const b = arr[i];
    lastE = b.e;
    const lv = level / mk.ratioAfter(plan.stock, actDate, b.date);
    if (touch) {
      const th = touch.h / mk.ratioAfter(plan.stock, touch.date, b.date);
      if (b.c > th + EPS) return i + 1 < arr.length ? { fate: 'pending', fillI: i + 1, level, touchI: touch.i, recoverI: i } : { fate: 'expired', why: 'no bar after the recovery', level, knownMs: b.e };
    }
    if (b.l <= lv + EPS) touch = { ...b, i };
  }
  return { fate: 'expired', why: 'no touch and recovery before the end of the second session after activation', level, knownMs: lastE };
}

function delayed(i, arr, delay) {
  if (!delay) return i;
  if (delay === 'bar') return i + 1 < arr.length ? i + 1 : null;
  const di = arr[i].di;
  let j = i;
  while (j < arr.length && arr[j].di <= di) j++;
  return j < arr.length ? j : null;
}

// The whole run: plans (entry plans and follow-up checks) -> actions and signal fates. Pure and deterministic.
// activations: optional precomputed activationOf results (one per plan, same order); lean: no activation or signal
// records (the placebo needs only the trades and the equity).
// exit: 'existing' (campaign 1's exits; the default, unchanged) or campaign 2's 'acceptance', 'target' or 'price_only'
// (CAMPAIGN-2.md), each added to the existing exits.
export function runReplay({ plans, treatment, market: mk, costs, portfolio, from, to, costMultiplier = 1, delay = null, activations = null, lean = false, exit = 'existing' }) {
  const k = (sym, date) => (Math.max(costs.halfSpreadFloorBps, mk.halfSpread(sym, date)) + costs.slippageBps) * costMultiplier / 10000;
  const hs = (sym, date) => Math.max(costs.halfSpreadFloorBps, mk.halfSpread(sym, date)) * costMultiplier;
  const actions = [], signals = [];
  const act = (ms, stock, kind, detail) => { if (lean && (kind === 'activation' || kind === 'signal')) return; actions.push({ ms, stock, kind, detail }); };
  // 1. Activations, bearish exits and entry candidates (independent of the account).
  const bears = new Map(); // stock -> [{ ms, i }]
  const events = []; // { ms, order, kind, ... }
  for (let pi = 0; pi < plans.length; pi++) {
    const p = plans[pi];
    const a = activations ? activations[pi] : activationOf(p, mk);
    act(a ? a.bar.e : p.T + WINDOW_MS, p.stock, 'activation', { planId: p.id ?? null, followUp: !!p.followUp, dir: a?.dir ?? 'none', barEnd: a?.bar.e ?? null, close: a?.bar.c ?? null, status: p.status });
    if (!a) continue;
    const arr = mk.flat.get(p.stock);
    if (a.dir === 'bear') {
      if (!bears.has(p.stock)) bears.set(p.stock, []);
      bears.get(p.stock).push({ ms: a.bar.e, i: a.i });
      const fi = delayed(a.i + 1, arr, delay);
      if (a.i + 1 < arr.length && fi != null) events.push({ ms: arr[fi].s, order: 1, kind: 'bear_exit', stock: p.stock, i: fi, planId: p.id ?? null });
      continue;
    }
    if (p.followUp || !p.bullish.armed) { if (!p.followUp) { const sd = { planId: p.id ?? null, stock: p.stock, T: p.T, activationMs: a.bar.e, activationSession: a.bar.date, fate: 'disarmed', why: 'a negative headline disarmed the bullish scenario', level: null }; signals.push(sd); act(a.bar.e, p.stock, 'signal', { ...sd }); } continue; }
    const e = entryOf(a, p, treatment, mk);
    const sig = { planId: p.id ?? null, stock: p.stock, T: p.T, activationMs: a.bar.e, activationSession: a.bar.date, fate: e.fate, why: e.why ?? null, level: e.level ?? null };
    signals.push(sig);
    if (e.fate !== 'pending') { act(e.knownMs ?? a.bar.e, p.stock, 'signal', { ...sig }); continue; }
    const fi = delayed(e.fillI, arr, delay);
    if (fi == null) { sig.fate = 'expired'; sig.why = 'the delayed fill falls after the replay'; act(arr.at(-1).e, p.stock, 'signal', { ...sig }); continue; }
    const inv = p.invalidation.level / mk.ratioAfter(p.stock, p.session, arr[fi].date);
    events.push({ ms: arr[fi].s, order: 2, kind: 'buy', stock: p.stock, i: fi, sig, inv, plan: p });
  }
  // 2. Session opens and closes.
  const sessions = mk.sessions.filter((d) => d >= from && d <= to);
  for (const d of sessions) { events.push({ ms: mk.openMs(d), order: 0, kind: 'open', date: d }); events.push({ ms: mk.closeMs(d), order: 3, kind: 'close', date: d }); }
  const cmpEv = (a, b) => a.ms - b.ms || a.order - b.order || (a.stock ?? '').localeCompare(b.stock ?? '');
  events.sort(cmpEv);
  // Inserts a later event after every event that sorts at or before it (campaign 2's exits only).
  const insertAfter = (x, ev) => { let lo = x + 1, hi = events.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (cmpEv(events[mid], ev) <= 0) lo = mid + 1; else hi = mid; } events.splice(lo, 0, ev); };
  // 3. The account, in time order.
  let cash = portfolio.startingCash;
  const posn = new Map(); // stock -> position
  const pendingExit = new Map(); // stock -> reason (invalidation, decided at a close)
  const lastMark = new Map(); // stock -> last daily close in current units
  const di = (date) => mk.sessionIndex.get(date);
  const sell = (stock, px, raw, ms, reason, date) => {
    const p = posn.get(stock);
    const fees = sellFees(costs, p.shares, px);
    const proceeds = p.shares * px - fees.total;
    cash += proceeds;
    act(ms, stock, 'sell', { shares: p.shares, price: px, raw, fees: fees.total, proceeds, reason, date, tradeId: p.tradeId });
    posn.delete(stock);
  };
  const firstOpen = mk.openMs(from), lastClose = mk.closeMs(to);
  for (let x = 0; x < events.length; x++) {
    const ev = events[x];
    if (ev.ms < firstOpen || ev.ms > lastClose) continue;
    if (ev.kind === 'open') {
      const d = ev.date;
      for (const sp of mk.splits.filter((s) => s.date === d)) {
        const p = posn.get(sp.symbol);
        if (lastMark.has(sp.symbol)) lastMark.set(sp.symbol, lastMark.get(sp.symbol) / sp.ratio);
        if (!p) continue;
        const after = p.shares * sp.ratio, whole = Math.floor(after + EPS);
        p.shares = whole; p.inv /= sp.ratio; p.entry /= sp.ratio;
        act(ev.ms, sp.symbol, 'split', { ratio: sp.ratio, sharesAfter: whole, fraction: after - whole, tradeId: p.tradeId });
        if (after - whole > EPS) { const b = mk.flat.get(sp.symbol).find((y) => y.date === d); if (b) { const c = (after - whole) * b.o * (1 - hs(sp.symbol, d) / 10000); cash += c; act(ev.ms, sp.symbol, 'cash_in_lieu', { amount: c, tradeId: p.tradeId }); } }
      }
      for (const dv of mk.dividends.filter((v) => v.exDate === d)) { const p = posn.get(dv.symbol); if (p) { p.receivables.push({ payDate: dv.payDate || d, net: p.shares * dv.amount * (1 - costs.withholdingPct / 100) }); act(ev.ms, dv.symbol, 'dividend_entitled', { shares: p.shares, amount: dv.amount, payDate: dv.payDate, tradeId: p.tradeId }); } }
      for (const [stock, p] of posn) { const due = p.receivables.filter((r) => r.payDate <= d); p.receivables = p.receivables.filter((r) => r.payDate > d); for (const r of due) { cash += r.net; act(ev.ms, stock, 'dividend_paid', { amount: r.net, tradeId: p.tradeId }); } }
      for (const [stock, reason] of [...pendingExit]) {
        if (!posn.has(stock)) { pendingExit.delete(stock); continue; }
        const arr = mk.flat.get(stock);
        let i = arr.findIndex((b) => b.date === d);
        if (i < 0) continue; // no bar today: waits
        if (delay) { const j = delayed(i, arr, delay); if (j == null) continue; i = j; if (arr[i].date !== d) { events.push({ ms: arr[i].s, order: 1, kind: 'delayed_exit', stock, i, reason }); events.sort((a, b) => a.ms - b.ms || a.order - b.order || (a.stock ?? '').localeCompare(b.stock ?? '')); pendingExit.delete(stock); continue; } }
        const b = arr[i];
        sell(stock, b.o * (1 - k(stock, d)), b.o, b.s, reason, d);
        pendingExit.delete(stock);
      }
      continue;
    }
    if (ev.kind === 'bear_exit' || ev.kind === 'delayed_exit') {
      if (!posn.has(ev.stock)) continue;
      const b = mk.flat.get(ev.stock)[ev.i];
      sell(ev.stock, b.o * (1 - k(ev.stock, b.date)), b.o, b.s, ev.kind === 'bear_exit' ? 'bearish_activation' : ev.reason, b.date);
      pendingExit.delete(ev.stock);
      continue;
    }
    if (ev.kind === 'amt_exit') {
      const p = posn.get(ev.stock);
      if (!p || p.tradeId !== ev.tradeId) continue;
      const b = mk.flat.get(ev.stock)[ev.i];
      const raw = ev.raw ?? b.o;
      act(ev.decisionMs, ev.stock, 'exit_scheduled', { reason: ev.reason, ...ev.detail, tradeId: p.tradeId });
      sell(ev.stock, raw * (1 - k(ev.stock, b.date)), raw, b.s, ev.reason, b.date);
      pendingExit.delete(ev.stock);
      continue;
    }
    if (ev.kind === 'buy') {
      // Same-time buys share cash and risk room equally.
      const group = [ev];
      while (x + 1 < events.length && events[x + 1].kind === 'buy' && events[x + 1].ms === ev.ms) group.push(events[++x]);
      const holdings = [...posn].reduce((a, [s, p]) => a + p.shares * (lastMark.get(s) ?? p.entry), 0);
      const V = cash + holdings;
      const openRisk = [...posn.values()].reduce((a, p) => a + p.shares * Math.max(0, p.entry - p.inv), 0);
      const room = Math.max(0, (portfolio.totalEntryRiskPct / 100) * V - openRisk);
      const n = group.length, cashShare = Math.max(0, cash) / n, roomShare = room / n;
      for (const g of group) {
        const sig = g.sig;
        const bear = (bears.get(g.stock) || []).find((z) => z.ms > sig.activationMs && z.ms <= g.ms);
        if (bear) { sig.fate = 'cancelled'; sig.why = 'a later bearish activation of the stock'; act(g.ms, g.stock, 'signal', { ...sig }); continue; }
        if (posn.has(g.stock)) { sig.fate = 'already_held'; act(g.ms, g.stock, 'signal', { ...sig }); continue; }
        const b = mk.flat.get(g.stock)[g.i];
        const px = b.o * (1 + k(g.stock, b.date));
        const dist = px - g.inv;
        if (!(dist > EPS)) { sig.fate = 'rejected'; sig.why = 'the invalidation level is at or above the fill'; act(g.ms, g.stock, 'signal', { ...sig }); continue; }
        const caps = { cash: Math.floor(cashShare / px + EPS), position: Math.floor(((portfolio.positionCapPct / 100) * V) / px + EPS), risk: Math.floor(((portfolio.riskPerTradePct / 100) * V) / dist + EPS), riskRoom: Math.floor(roomShare / dist + EPS) };
        const shares = Math.max(0, Math.min(...Object.values(caps)));
        if (shares < 1) { sig.fate = 'rejected'; sig.why = `funding or caps (${Object.entries(caps).filter(([, v]) => v < 1).map(([kk]) => kk).join(', ')})`; act(g.ms, g.stock, 'signal', { ...sig, caps }); continue; }
        const cost = shares * px;
        if (cash - cost < -EPS) throw new Error('news-replay engine: a buy would make cash negative');
        cash -= cost;
        const tradeId = `${g.stock}:${b.s}`;
        posn.set(g.stock, { stock: g.stock, shares, entry: px, inv: g.inv, fillDi: b.di, tradeId, receivables: [] });
        sig.fate = 'filled';
        let exitPlan;
        if (exit !== 'existing') {
          const ax = amtExitOf({ exit, stock: g.stock, fillI: g.i, fillRaw: b.o, activationMs: sig.activationMs, mk, delay, delayed });
          exitPlan = ax?.detail ? { source: ax.detail.source ?? null, target: ax.detail.target ?? null, first: ax.reason ?? null } : null;
          if (ax?.reason) insertAfter(x, { ms: mk.flat.get(g.stock)[ax.fillI].s, order: ax.order, kind: 'amt_exit', stock: g.stock, i: ax.fillI, raw: ax.raw, reason: ax.reason, decisionMs: ax.decisionMs, detail: ax.detail, tradeId });
        }
        act(g.ms, g.stock, 'buy', { shares, price: px, raw: b.o, cost, inv: g.inv, date: b.date, tradeId, planId: sig.planId, T: sig.T, caps, ...(exitPlan !== undefined ? { exitPlan } : {}) });
        act(g.ms, g.stock, 'signal', { ...sig });
      }
      continue;
    }
    if (ev.kind === 'close') {
      const d = ev.date, dIdx = di(d);
      for (const [stock, p] of [...posn]) {
        const bar = mk.daily.get(stock)?.get(d);
        if (!bar) continue;
        lastMark.set(stock, bar.c);
        if (dIdx - p.fillDi >= TIME_STOP_SESSIONS) {
          if (delay) { pendingExit.set(stock, 'time_stop'); continue; }
          sell(stock, bar.c * (1 - k(stock, d)), bar.c, ev.ms, 'time_stop', d); continue;
        }
        if (bar.c < p.inv - EPS && !pendingExit.has(stock)) { pendingExit.set(stock, 'invalidation'); act(ev.ms, stock, 'exit_scheduled', { reason: 'invalidation', close: bar.c, level: p.inv, tradeId: p.tradeId }); }
      }
      for (const [s] of mk.daily) if (!posn.has(s)) { const bar = mk.daily.get(s).get(d); if (bar) lastMark.set(s, bar.c); }
      act(ev.ms, null, 'close', { date: d });
    }
  }
  const endMs = sessions.length ? mk.closeMs(sessions.at(-1)) : 0;
  for (const s of signals) if (s.fate === 'pending') { s.fate = 'expired'; s.why = 'the fill falls after the replay'; act(endMs, s.stock, 'signal', { ...s }); }
  return { actions, signals, engine: exit === 'existing' ? ENGINE : ENGINE_2, treatment, costMultiplier, delay, exit };
}
