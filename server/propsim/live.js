// The live account's engine (strategy/prop-sim/LIVE-1.md). Pure functions, no clock, no database: given the stored
// bars, the successful requests ("polls"), the recorded 5-minute decisions and a time `nowMs`, they give exactly what
// the frozen Phase 1 rules decided and filled up to that time. Phase 1's own functions do the work (setupAt, execute,
// applyTrade, stage); this file adds only what live running needs:
//   - a session is seen through its LIVE bars only (earlier sessions through every stored bar, for levels and the ATR);
//   - each 5-minute bar acts only through its recorded decision, and an entry fills only on 1-minute bars that start at
//     or after the decision's recorded time (rounded up to the minute): decisions before fills;
//   - the first unobserved minute of a session starts a gap: nothing is decided or traded after it that session, a
//     working order is cancelled and an open position is closed at the last live close less 1 tick (flat across it);
//   - one account at a time: the evaluation, the funded stage after a pass, the next attempt after the attempt ends.
// With every decision recorded at its bar's close and every minute observed, the trades are Phase 1's runSignals
// trades on the same bars, and the attempts are Phase 1's attempts from the same sessions (tests/propsim-live.test.js).
// Simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid.
import { buildMarket, isoWeekKey } from './market.js';
import { windowsOf, flatByOf, mirrorBars, execute, setupAt, breaks } from './signals.js';
import { isSweepBar, bosAt, downwardBosAt } from '../ictlab/rules.js';
import { applyTrade, stage, fundedCap, fundedDll } from './account.js';
import { regularSessionBounds } from '../calendar.js';

const MIN = 60000;
const r2 = (x) => Math.round(x * 100) / 100;
export const ceilMinute = (ms) => Math.ceil(ms / MIN) * MIN;
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// The first date whose bars the market for `date` needs: the Monday of the previous calendar week (the previous week's
// levels, the previous session's levels and the last 14 five-minute bars all lie inside it).
export const windowFrom = (date) => addDays(isoWeekKey(date), -7);
export function bounds(date) { const b = regularSessionBounds(date); return b ? { open: b.open.getTime(), close: b.close.getTime() } : null; }
export const bucketCount = (b) => Math.ceil((b.close - b.open) / (5 * MIN));
export const bucketEnd = (b, k) => Math.min(b.open + (k + 1) * 5 * MIN, b.close);

// The market for one session as the live account sees it: earlier sessions (from windowFrom) with every stored bar,
// this session with its live bars only. rows: [{ date, minute, o, h, l, c, v, live }].
export function sessionMarket(rows, date, { ratio, tickPoints }) {
  const from = windowFrom(date);
  const use = rows.filter((r) => (r.date < date ? r.date >= from : r.date === date && r.live));
  return buildMarket(use, { ratio, tickPoints }).sessions.find((x) => x.date === date) ?? null;
}

// Every minute of the session: 'observed' (a successful request was made within graceMs after it ended), 'gap' (that
// time has passed with none) or 'open' (not yet judged). gapMs is the start of the first gap minute.
export function observation({ open, close, polls, nowMs, graceMs }) {
  const minutes = [];
  let pi = 0, gapMs = null;
  for (let s = open; s < close; s += MIN) {
    const end = s + MIN;
    while (pi < polls.length && polls[pi] < end) pi++;
    const st = pi < polls.length && polls[pi] <= end + graceMs && polls[pi] <= nowMs ? 'observed' : end + graceMs < nowMs ? 'gap' : 'open';
    if (st === 'gap' && gapMs == null) gapMs = s;
    minutes.push(st);
  }
  const gaps = [];
  minutes.forEach((st, i) => { if (st !== 'gap') return; const s = open + i * MIN; const last = gaps.at(-1); if (last && last.toMs === s) last.toMs = s + MIN; else gaps.push({ fromMs: s, toMs: s + MIN }); });
  return { minutes, gapMs, gaps };
}
// The end of the last 5-minute bucket recorded with every earlier one (the minutes before it are final).
export function recordedThrough(b, records) {
  let k = 0;
  while (k < bucketCount(b) && records.has(k)) k++;
  return k === 0 ? -Infinity : bucketEnd(b, k - 1);
}

// Fill and exit of one live decision, through Phase 1's execute on the live 1-minute bars before any gap.
function execLive({ m1, d, entryType, entry, stop, t0, fillUntil, flatBy, sig, exec, gapMs, settled, close }) {
  const tr = execute({ m1, d, entryType, entry, stop, t0, fillUntil, flatBy, sig, exec });
  if (tr.noFill) {
    if (gapMs != null && gapMs < fillUntil) return { status: 'cancelled', reason: 'cancelled at a gap in the observed data', endMs: gapMs };
    return settled(fillUntil) ? { status: 'nofill', reason: tr.noFill } : { status: 'pending' };
  }
  if (tr.kind !== 'session_end') return { status: 'closed', ...tr };
  const last = m1[m1.length - 1];
  if (gapMs != null) {
    // Flat across a gap: closed at the last live close before it, less 1 tick (LIVE-1.md section 5).
    const exit = last.c - d * exec.stopSlippageTicks;
    return { status: 'closed', ...tr, kind: 'gap', exit, exitMs: gapMs, resultTicks: d * (exit - tr.fill), maeTicks: Math.max(0, tr.maeTicks, d * (tr.fill - exit)) };
  }
  if (settled(close)) return { status: 'closed', ...tr };
  return { status: 'open', ...tr, kind: null, exit: null, exitMs: null, markMs: last.s, markTicks: last.c, resultTicks: d * (last.c - tr.fill) };
}

// One family on one session, as recorded. records: Map(bucket k -> { recordedMs, status }). act = false lists the
// setups seen without acting (the shown families). Returns the decisions, the trades and the first unrecorded bucket.
export function runLiveSession({ s, family, matrix, records, nowMs, gapMs = null, graceMs, act = true }) {
  const sig = matrix.signal, exec = matrix.execution, swing = sig.swing;
  const wins = windowsOf(s, matrix), flatBy = flatByOf(s, matrix);
  const winAt = (ms) => wins.find((w) => ms > w.from && ms <= w.to)?.id ?? null;
  const L = s.levels;
  const dirs = [
    { d: 1, bars: s.m5, sweepLevels: [['PDL', L.PDL], ['PWL', L.PWL]], breakLevels: [['PDH', L.PDH], ['PWH', L.PWH]], prevClose: s.prevClose },
    { d: -1, bars: mirrorBars(s.m5), sweepLevels: [['PDH', L.PDH == null ? null : -L.PDH], ['PWH', L.PWH == null ? null : -L.PWH]], breakLevels: [['PDL', L.PDL == null ? null : -L.PDL], ['PWL', L.PWL == null ? null : -L.PWL]], prevClose: s.prevClose == null ? null : -s.prevClose },
  ].map((x) => ({ ...x, br: family === 'F1' || family === 'F2' ? breaks(x.bars, swing) : null, sweeps: [], sig, winOf: (k) => winAt(s.m5[k].e) }));
  const m1 = gapMs == null ? s.m1 : s.m1.filter((x) => x.s < gapMs);
  const lastLiveS = s.m1.length ? s.m1[s.m1.length - 1].s : -Infinity;
  const through = recordedThrough({ open: s.open, close: s.close }, records);
  // A time is settled when every minute before it is final: a later live bar exists, its grace has passed, or the
  // bucket holding it has been recorded (a bar arriving after its bucket's decision is never live).
  const settled = (ms) => lastLiveS >= ms || nowMs >= ms + graceMs || ms <= through;
  let busyUntil = -Infinity, pending = null;
  const filledIn = new Map(), decisions = [], trades = [];
  for (let k = 0; k < s.m5.length; k++) {
    const bar = s.m5[k], t = bar.e;
    if (t > nowMs) break;
    const rec = records.get(bar.k);
    if (!rec) { pending = { k: bar.k, t }; break; }
    const win = winAt(t);
    if (family === 'F1' && win) for (const x of dirs) { const lv = x.sweepLevels.find(([, v]) => v != null && isSweepBar(x.bars[k], v)); if (lv) x.sweeps.push({ s: k, level: lv[0], win, used: false }); }
    if (!win) continue;
    for (const x of dirs) {
      const st = setupAt(family, x, k);
      if (!st) continue;
      const base = { bucket: bar.k, t, d: x.d, why: st.why ?? null };
      if (st.none) { decisions.push({ ...base, action: 'none', reason: st.none }); continue; }
      const setup = { ...base, entryType: st.entryType, entry: st.entry == null ? null : x.d * st.entry, stop: x.d * st.stop };
      if (!act) { decisions.push({ ...setup, action: 'seen' }); continue; }
      if (rec.status !== 'on_time') { decisions.push({ ...setup, action: 'missed', reason: rec.status === 'gap' ? 'a gap in the observed data at or before this bar' : 'decided too late' }); continue; }
      if (t < busyUntil) { decisions.push({ ...setup, action: 'skipped', reason: 'a position or order is open' }); continue; }
      if ((filledIn.get(win) || 0) >= sig.maxTradesPerWindow) { decisions.push({ ...setup, action: 'skipped', reason: 'window trade limit' }); continue; }
      const w = wins.find((y) => y.id === win);
      const fillUntil = st.entryType === 'market' ? w.to : Math.min(t + sig.orderLifeMinutes * MIN, w.to);
      const sigX = { ...sig, minStopTicks: Math.max(1, Math.ceil(sig.minStopAtr * bar.atr)) };
      const t0 = Math.max(t, ceilMinute(rec.recordedMs));
      const r = execLive({ m1, d: x.d, entryType: st.entryType, entry: setup.entry, stop: setup.stop, t0, fillUntil, flatBy, sig: sigX, exec, gapMs, settled, close: s.close });
      decisions.push({ ...setup, action: 'taken', recordedMs: rec.recordedMs, t0 });
      trades.push({ date: s.date, window: win, setupMs: t, why: st.why, recordedMs: rec.recordedMs, t0, fillUntil, ...r });
      if (r.status === 'pending' || r.status === 'open') { busyUntil = Infinity; if (r.status === 'open') filledIn.set(win, (filledIn.get(win) || 0) + 1); continue; }
      if (r.status === 'nofill' || r.status === 'cancelled') { busyUntil = Math.max(busyUntil, fillUntil); continue; }
      filledIn.set(win, (filledIn.get(win) || 0) + 1);
      busyUntil = r.exitMs + MIN;
    }
  }
  return { decisions, trades, pending, flatBy, windows: wins };
}

// The chart's marks for one session (display only): the levels, the sweeps of a level, the breaks of structure.
export function chartMarks(s, matrix) {
  const swing = matrix.signal.swing, L = s.levels, mir = mirrorBars(s.m5);
  const sweeps = [], breaksOut = [];
  s.m5.forEach((b, k) => {
    for (const [name, v] of [['PDL', L.PDL], ['PWL', L.PWL]]) if (v != null && isSweepBar(b, v)) sweeps.push({ bucket: b.k, level: name, side: 'low' });
    for (const [name, v] of [['PDH', L.PDH], ['PWH', L.PWH]]) if (v != null && isSweepBar(mir[k], -v)) sweeps.push({ bucket: b.k, level: name, side: 'high' });
    const up = bosAt(s.m5, k, swing), dn = downwardBosAt(s.m5, k, swing);
    if (up.ok) breaksOut.push({ bucket: b.k, dir: 'up', level: up.level });
    if (dn.ok) breaksOut.push({ bucket: b.k, dir: 'down', level: dn.level });
  });
  return { levels: { ...L }, sweeps, breaks: breaksOut };
}

// ---------- the account: one attempt at a time ----------
// The balance, the highest close and the Max Loss Limit after a list of day results (stage's end-of-day rules).
export function stateAfter(plan, days) {
  let bal = plan.size, maxClose = plan.size, mll = plan.size - plan.maxLoss;
  for (const p of days) { bal += p; maxClose = Math.max(maxClose, bal); mll = Math.min(Math.max(mll, maxClose - plan.maxLoss), plan.lockedMll); }
  return { bal, maxClose, mll };
}
// One day of an attempt, trade by trade, from its state at the open (the same applyTrade as stage): every trade with
// its contracts and result, the open position marked at its last live close, the day's limits.
export function dayDetail({ plan, kind, days, trades, open = null, tickValue, exec }) {
  const st = stateAfter(plan, days);
  const cap = kind === 'eval' ? plan.evalContracts : fundedCap(plan, st.bal - plan.size);
  const dll = kind === 'eval' ? plan.dailyLossLimit : fundedDll(plan, st.maxClose);
  let bal = st.bal, dayPnl = 0, ended = null, dllHit = false;
  const items = [];
  for (const t of trades) {
    if (ended || dllHit) { items.push({ trade: t, counted: false, note: ended ? 'not counted: the attempt ended earlier today' : 'not counted: the daily loss limit was hit' }); continue; }
    const r = applyTrade({ bal, mll: st.mll, dayPnl, dll, trade: t, tickValue, exec, cap });
    if (r.skipped) { items.push({ trade: t, counted: false, note: 'skipped: the room cannot fund one contract' }); continue; }
    items.push({ trade: t, counted: true, contracts: r.n, pnl: r2(r.pnl), worst: r2(r.worst), breached: !!r.breached, dllHit: !!r.dllHit });
    if (r.breached) { bal = Math.min(bal + r.pnl, st.mll); ended = 'breached'; continue; }
    bal += r.pnl; dayPnl += r.pnl;
    if (r.dllHit) dllHit = true;
  }
  let openPos = null;
  if (open && !ended && !dllHit) {
    const r = applyTrade({ bal, mll: st.mll, dayPnl, dll, trade: open, tickValue, exec, cap });
    if (r.skipped) openPos = { trade: open, counted: false, note: 'skipped: the room cannot fund one contract' };
    else if (r.breached) { openPos = { trade: open, counted: true, contracts: r.n, pnl: r2(r.pnl), breached: true }; bal = Math.min(bal + r.pnl, st.mll); ended = 'breached'; }
    else if (r.dllHit) { openPos = { trade: open, counted: true, contracts: r.n, pnl: r2(r.pnl), dllHit: true }; bal += r.pnl; dayPnl += r.pnl; dllHit = true; }
    else openPos = { trade: open, counted: true, contracts: r.n, openPnl: r2(r.pnl), worst: r2(r.worst) };
  }
  const openPnl = openPos?.openPnl ?? 0;
  const equity = bal + openPnl;
  return {
    kind, items, open: openPos, ended, dllHit, cap, dll,
    balanceAtOpen: r2(st.bal), balance: r2(bal), openPnl: r2(openPnl), equity: r2(equity), mll: r2(st.mll), dayPnl: r2(dayPnl + openPnl),
    drawdownLeft: r2(equity - st.mll), dailyLimitLeft: dll == null ? null : r2(dll + dayPnl + openPnl),
  };
}

// Every attempt from the start: dates (NYSE sessions from the start through the current one), finalCount (how many are
// final), tradesByDate (closed trades of the traded configuration, in fill order). Returns the ended attempts, the
// current one with its state, and the per-session results.
export function liveAccount({ dates, finalCount, tradesByDate, plan, tickValue, exec, horizons }) {
  const lastFinal = finalCount - 1;
  const dayTrades = dates.map((d) => tradesByDate.get(d) || []);
  const attempts = [], daily = [], stages = [];
  let i0 = 0, current = null;
  const pushDays = (n, from, kind, days) => { stages.push({ n, kind, i0: from, days }); days.forEach((p, j) => daily.push({ date: dates[from + j], attempt: n, kind: kind === 'eval' ? 'evaluation' : 'funded', pnl: r2(p) })); };
  while (i0 <= lastFinal) {
    const n = attempts.length + 1;
    const ev = stage({ kind: 'eval', plan, dayTrades, i0, horizon: horizons.evaluationSessions, lastIndex: lastFinal, tickValue, exec });
    pushDays(n, i0, 'eval', ev.days);
    const a = { n, start: dates[i0], eval: ev.outcome, evalSessions: ev.sessions, evalTrades: ev.trades, roomUsed: r2(ev.roomUsed), balance: ev.bal, funded: null, traderPayout: 0, fee: plan.fee };
    if (ev.outcome === 'unfinished') { current = { a, kind: 'eval', i0, days: ev.days }; break; }
    if (ev.outcome === 'passed') {
      a.daysToPass = ev.sessions; a.passedOn = dates[ev.end];
      if (ev.end + 1 > lastFinal) { stages.push({ n, kind: 'funded', i0: ev.end + 1, days: [] }); current = { a, kind: 'funded', i0: ev.end + 1, days: [] }; break; }
      const fu = stage({ kind: 'funded', plan, dayTrades, i0: ev.end + 1, horizon: horizons.fundedSessions, lastIndex: lastFinal, tickValue, exec });
      pushDays(n, ev.end + 1, 'funded', fu.days);
      a.funded = fu.outcome; a.fundedSessions = fu.sessions; a.balance = fu.bal;
      if (fu.outcome === 'payout') { a.payout = fu.payout; a.traderPayout = fu.traderPayout; }
      if (fu.outcome === 'unfinished') { current = { a, kind: 'funded', i0: ev.end + 1, days: fu.days }; break; }
      a.end = dates[fu.end]; attempts.push(a); i0 = fu.end + 1; continue;
    }
    a.end = dates[ev.end]; attempts.push(a); i0 = ev.end + 1;
  }
  if (!current) { current = { a: { n: attempts.length + 1, start: dates[i0] ?? null, eval: 'unfinished', evalSessions: 0, evalTrades: 0, balance: plan.size, funded: null, traderPayout: 0, fee: plan.fee }, kind: 'eval', i0, days: [] }; stages.push({ n: current.a.n, kind: 'eval', i0, days: [] }); }
  const fees = r2((attempts.length + 1) * plan.fee), payouts = r2(attempts.reduce((s, x) => s + x.traderPayout, 0) + current.a.traderPayout);
  return { attempts, current, daily, stages, totals: { attempts: attempts.length + 1, ended: attempts.length, passes: attempts.filter((x) => x.eval === 'passed').length + (current.kind === 'funded' ? 1 : 0), payouts: attempts.filter((x) => x.funded === 'payout').length, traderPayouts: payouts, feesAssumed: fees, netAfterFees: r2(payouts - fees) } };
}
