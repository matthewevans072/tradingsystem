// sweep-bos engine (PRE-REGISTRATION.md sections 2, 3 and 7; the round-2 switches of PRE-REGISTRATION-2.md):
// one symbol, one variant, one window. Deterministic and free of look-ahead: a session's decisions use its bars
// up to the decision bar, earlier sessions and the daily bars of earlier sessions; orders fill on later bars at
// prices they trade through; stop first on an ambiguous bar. Prices are integer units of 0.0001 (rules.js).
// Simulation only: no account, order or broker code exists here; the "dollar account" is arithmetic on the
// trade list, reported as information.
//
// Round-2 switches, read from the variant with round-1 behaviour as the default (so every round-1 file runs
// exactly as before): entryCutoff.lastFillBarIndex (11; R2-1: 17) bounds both the break-of-structure scan and
// the fills; swing.scope 'cross_session' with swing.previousSessionBars (R2-2) prepends the previous session's
// last bars to the structure series used for swings and the order-block search; sweep.invalidation 'none'
// (R2-3) keeps a setup alive after a close back beyond the swept level.
import { previousTradingDay } from '../calendar.js';
import { ENGINE_VERSION } from './config.js';
import { toU, fromU, dailyBias, sweepDirection, bosAt, legExtremeIndex, orderBlock, fairValueGap, bufferFromSessions, secondSwingStop, simulateExit, rOf, SWEEP_LAST_INDEX, LAST_FILL_INDEX, BUFFER_SESSIONS } from './rules.js';

export { ENGINE_VERSION };
export const STAGES = Object.freeze(['incomplete_session', 'no_prior_session', 'no_bias', 'no_buffer', 'no_sweep', 'sweep_invalidated', 'no_bos', 'no_zone', 'entry_not_inside_close', 'no_second_swing', 'stop_not_beyond_entry', 'target_too_close', 'order_expired', 'filled']);
export const OUTCOMES = Object.freeze(['stop', 'stop_same_bar', 'target', 'time']);
const OPEN_MINUTES = 9 * 60 + 30;

// The switches a variant declares, with the round-1 defaults.
export function switchesOf(variant) {
  const lastFill = variant.entryCutoff?.lastFillBarIndex ?? LAST_FILL_INDEX;
  if (!Number.isInteger(lastFill) || lastFill < SWEEP_LAST_INDEX + 1) throw new Error(`entryCutoff.lastFillBarIndex must be a whole number above ${SWEEP_LAST_INDEX}`);
  const bosLast = variant.bos?.lastBarIndex ?? lastFill;
  if (bosLast !== lastFill) throw new Error('bos.lastBarIndex must equal entryCutoff.lastFillBarIndex');
  const scope = variant.swing?.scope ?? 'session_local';
  if (!['session_local', 'cross_session'].includes(scope)) throw new Error(`unknown swing.scope ${scope}`);
  const previousBars = scope === 'cross_session' ? variant.swing?.previousSessionBars ?? 12 : 0;
  if (!Number.isInteger(previousBars) || previousBars < 0) throw new Error('swing.previousSessionBars must be a whole number');
  const invalidation = variant.sweep?.invalidation ?? 'close_beyond_level';
  if (!['close_beyond_level', 'none'].includes(invalidation)) throw new Error(`unknown sweep.invalidation ${invalidation}`);
  return { lastFill, previousBars, invalidation };
}

// The number of daily bars dated before `date` (daily in date order).
function countBefore(daily, date) {
  let lo = 0, hi = daily.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (daily[mid].date < date) lo = mid + 1; else hi = mid; }
  return lo;
}

// { symbol, daily: [{ date, o, h, l, c }], sessions: [{ date, full, bars: [{ idx, o, h, l, c }] }], variant, window: { start, end } }
export function runSymbol({ symbol, daily, sessions, variant, window, costPerSide = 0.02, sensitivity = 2, startingCash = 15000 }) {
  if (!['order_block', 'fair_value_gap'].includes(variant.zone)) throw new Error(`unknown zone ${variant.zone}`);
  if (!['A_sweep_buffer', 'B_second_swing'].includes(variant.stop)) throw new Error(`unknown stop ${variant.stop}`);
  if (!['on', 'off'].includes(variant.bias)) throw new Error(`unknown bias ${variant.bias}`);
  const sw = switchesOf(variant);
  const D = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((d) => ({ date: d.date, o: toU(d.o), h: toU(d.h), l: toU(d.l), c: toU(d.c) }));
  const S = [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((s) => {
    const bars = [...s.bars].sort((a, b) => a.idx - b.idx).map((b) => ({ idx: b.idx, o: toU(b.o), h: toU(b.h), l: toU(b.l), c: toU(b.c) }));
    return { date: s.date, full: s.full, bars, complete: bars.length === s.full && bars.every((b, i) => b.idx === i) };
  });
  const dailyIndex = new Map(D.map((d, i) => [d.date, i]));
  const sessionIndex = new Map(S.map((s, i) => [s.date, i]));
  const c1 = toU(costPerSide), c2 = toU(costPerSide * sensitivity);
  const trades = [], records = [], stageCounts = {}, outcomeCounts = { stop: 0, stop_same_bar: 0, target: 0, time: 0 };
  for (const st of STAGES) stageCounts[st] = 0;
  let cash = startingCash, peak = startingCash, maxDrawdown = 0, lowestCash = startingCash;
  let sessionsInWindow = 0;

  for (let si = 0; si < S.length; si++) {
    const s = S[si];
    if (s.date < window.start || s.date > window.end) continue;
    sessionsInWindow++;
    const rec = { session: s.date, stage: null, dir: null };
    const end = (stage, extra = {}) => { rec.stage = stage; Object.assign(rec, extra); records.push(rec); stageCounts[stage]++; };
    if (!s.complete) { end('incomplete_session', { bars: s.bars.length, full: s.full }); continue; }
    const prevDate = previousTradingDay(s.date, 'NYSE');
    const prevS = sessionIndex.has(prevDate) ? S[sessionIndex.get(prevDate)] : null;
    const prevD = dailyIndex.has(prevDate) ? D[dailyIndex.get(prevDate)] : null;
    if (!prevS || !prevS.complete || !prevD) { end('no_prior_session', { prevDate }); continue; }
    const pdh = prevD.h, pdl = prevD.l;
    let bias = null;
    if (variant.bias === 'on') {
      const b = dailyBias(D.slice(0, countBefore(D, s.date)));
      bias = b.bias;
      rec.bias = bias;
      if (bias === 'none') { end('no_bias'); continue; }
    }
    let buffer = null;
    if (variant.stop === 'A_sweep_buffer') {
      const prev = [];
      for (let i = si - 1; i >= 0 && prev.length < BUFFER_SESSIONS; i--) if (S[i].complete) prev.unshift(S[i]);
      buffer = bufferFromSessions(prev);
      if (buffer == null) { end('no_buffer', { completeSessionsBefore: prev.length }); continue; }
      rec.buffer = fromU(buffer);
    }
    const bars = s.bars, n = bars.length;
    // The structure series: today's bars, preceded (R2-2) by the previous session's last P bars. Today's index
    // k is extended index k + P; a reported index below 0 is a bar of the previous session.
    const pre = sw.previousBars ? prevS.bars.slice(-sw.previousBars) : [];
    const P = pre.length;
    const ext = P ? [...pre, ...bars] : bars;
    const lastFill = Math.min(n - 1, sw.lastFill);
    let setup = null, invalidated = false, ambiguous = 0, order = null, failStage = null, failDetail = null;
    for (let k = 0; k <= lastFill; k++) {
      const bar = bars[k];
      if (!setup) {
        if (k <= SWEEP_LAST_INDEX) {
          const d = sweepDirection(bar, pdh, pdl);
          if (d === 'both') { ambiguous++; continue; }
          if (d && (variant.bias === 'off' || d === bias)) setup = { dir: d, s: k, extreme: d === 'long' ? bar.l : bar.h };
        }
        continue;
      }
      const long = setup.dir === 'long';
      setup.extreme = long ? Math.min(setup.extreme, bar.l) : Math.max(setup.extreme, bar.h);
      if (sw.invalidation === 'close_beyond_level' && (long ? bar.c < pdl : bar.c > pdh)) { setup = null; invalidated = true; continue; }
      const bos = bosAt(ext, k + P, setup.dir);
      if (!bos.ok) continue;
      // The decision, at the close of bar k.
      rec.dir = setup.dir; rec.sweepIdx = setup.s; rec.bosIdx = k; rec.swingIdx = bos.swingIndex - P;
      const lambda = legExtremeIndex(ext, setup.s + P, k + P, setup.dir);
      const zone = variant.zone === 'order_block' ? orderBlock(ext, lambda, setup.dir) : fairValueGap(ext, lambda, k + P, setup.dir);
      if (!zone) { failStage = 'no_zone'; break; }
      const entry = zone.entry;
      if (long ? !(entry < bar.c) : !(entry > bar.c)) { failStage = 'entry_not_inside_close'; failDetail = { entry: fromU(entry), close: fromU(bar.c) }; break; }
      let stop, stopSwingIdx = null;
      if (variant.stop === 'A_sweep_buffer') stop = long ? setup.extreme - buffer : setup.extreme + buffer;
      else {
        const ss = secondSwingStop(ext, k + P, setup.dir);
        if (!ss) { failStage = 'no_second_swing'; break; }
        stop = ss.stop; stopSwingIdx = ss.index - P;
      }
      const risk = long ? entry - stop : stop - entry;
      if (!(risk > 0)) { failStage = 'stop_not_beyond_entry'; failDetail = { entry: fromU(entry), stop: fromU(stop) }; break; }
      const target = long ? pdh : pdl;
      const reward = long ? target - entry : entry - target;
      if (reward < risk) { failStage = 'target_too_close'; failDetail = { rewardToRisk: reward / risk }; break; }
      order = { dir: setup.dir, k, entry, stop, target, risk, reward, zone: { ...zone, index: zone.index - P }, lambda: lambda - P, sweepIdx: setup.s, extreme: setup.extreme, swingIdx: bos.swingIndex - P, swingLevel: bos.level, stopSwingIdx };
      break;
    }
    rec.ambiguousSweepBars = ambiguous;
    if (failStage) { end(failStage, failDetail || {}); continue; }
    if (!order) { end(setup ? 'no_bos' : invalidated ? 'sweep_invalidated' : 'no_sweep', setup ? { sweepIdx: setup.s, dir: setup.dir } : {}); continue; }
    let m = null;
    for (let q = order.k + 1; q <= lastFill; q++) {
      const b = bars[q];
      if (order.dir === 'long' ? b.l < order.entry : b.h > order.entry) { m = q; break; }
    }
    const orderInfo = { zone: order.zone.type, entry: fromU(order.entry), stop: fromU(order.stop), target: fromU(order.target), risk: fromU(order.risk), rewardToRisk: order.reward / order.risk };
    if (m == null) { end('order_expired', orderInfo); continue; }
    const ex = simulateExit(bars, m, order.dir, order.stop, order.target);
    const R = rOf(order.dir, order.entry, ex.exit, order.risk, c1), R2x = rOf(order.dir, order.entry, ex.exit, order.risk, c2);
    const mdir = order.dir === 'long' ? 'short' : 'long';
    const mstop = order.dir === 'long' ? order.entry + order.risk : order.entry - order.risk;
    const mtarget = order.dir === 'long' ? order.entry - order.reward : order.entry + order.reward;
    const mex = simulateExit(bars, m, mdir, mstop, mtarget);
    const mirror = { dir: mdir, stop: fromU(mstop), target: fromU(mtarget), exitIdx: mex.exitIndex, exitPrice: fromU(mex.exit), exitReason: mex.reason, sameBar: mex.sameBar, R: rOf(mdir, order.entry, mex.exit, order.risk, c1), R2x: rOf(mdir, order.entry, mex.exit, order.risk, c2) };
    const entryDollars = fromU(order.entry), riskDollars = fromU(order.risk);
    const shares = order.dir === 'long' ? Math.floor(cash / (entryDollars + costPerSide)) : Math.floor(cash / entryDollars);
    const pnl = Math.round(shares * R * riskDollars * 100) / 100;
    cash = Math.round((cash + pnl) * 100) / 100;
    if (cash > peak) peak = cash;
    maxDrawdown = Math.max(maxDrawdown, Math.round((peak - cash) * 100) / 100);
    lowestCash = Math.min(lowestCash, cash);
    const hoursHeld = {};
    for (let i = m; i <= ex.exitIndex; i++) { const hr = Math.floor((OPEN_MINUTES + i * 5) / 60); hoursHeld[hr] = (hoursHeld[hr] || 0) + 1; }
    const trade = {
      session: s.date, symbol, dir: order.dir, bias, sweepIdx: order.sweepIdx, sweepExtreme: fromU(order.extreme), bosIdx: order.k, swingIdx: order.swingIdx, swingLevel: fromU(order.swingLevel),
      zone: { type: order.zone.type, index: order.zone.index, lo: fromU(order.zone.lo), hi: fromU(order.zone.hi) }, legExtremeIdx: order.lambda, stopSwingIdx: order.stopSwingIdx, buffer: buffer == null ? null : fromU(buffer),
      pdh: fromU(pdh), pdl: fromU(pdl), entry: entryDollars, stop: fromU(order.stop), target: fromU(order.target), risk: riskDollars, rewardToRisk: order.reward / order.risk,
      fillIdx: m, exitIdx: ex.exitIndex, exitPrice: fromU(ex.exit), exitReason: ex.reason, sameBar: ex.sameBar, R, R2x, costPerSide, mirror,
      holdingMinutes: (ex.exitIndex - m) * 5 + 5, barsHeld: ex.exitIndex - m + 1, hoursHeld, shares, pnl, cashAfter: cash,
    };
    trades.push(trade);
    outcomeCounts[ex.reason]++;
    if (ex.sameBar) outcomeCounts.stop_same_bar++;
    end('filled', { ...orderInfo, fillIdx: m, exitIdx: ex.exitIndex, exitReason: ex.reason, sameBar: ex.sameBar, R });
  }
  return {
    symbol, engineVersion: ENGINE_VERSION, variant: { name: variant.name, zone: variant.zone, stop: variant.stop, bias: variant.bias, switches: sw }, window: { start: window.start, end: window.end },
    costPerSide, sensitivity, sessionsInWindow, trades, sessions: records, stageCounts, outcomeCounts,
    account: { startingCash, endingCash: cash, maxDrawdown, lowestCash, trades: trades.length, informationOnly: true },
  };
}
