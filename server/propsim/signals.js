// prop-sim's signals and executions (CAMPAIGN-1.md sections 3 to 7). The ICT concepts are the ICT Lab's functions,
// imported unchanged; short setups are the long setups on MIRRORED bars (o, h, l, c -> -o, -l, -h, -c), so no rule is
// written twice and every level and price maps back by negation. Decisions are taken at 5-minute bar closes on bars
// complete at that time; fills and exits use the 1-minute bars after the decision, stop before target. Prices are
// integer ticks. Account-independent: the account rules (account.js) size and stop the trades. Simulation only.
import { bosAt, downwardBosAt, isSweepBar, sweepExtreme, bullishFvg, inversionAt, orderBlock } from '../ictlab/rules.js';

const MIN = 60000;
export const mirrorBars = (bars) => bars.map((b) => ({ ...b, o: -b.o, h: -b.l, l: -b.h, c: -b.c }));
const at = (date, hh, mm, open) => open + ((hh * 60 + mm) - 570) * MIN; // a New York clock time in the session's ms

export function windowsOf(session, matrix) {
  return matrix.windows.map((w) => {
    const [fh, fm] = w.from.split(':').map(Number), [th, tm] = w.to.split(':').map(Number);
    return { id: w.id, from: at(session.date, fh, fm, session.open), to: Math.min(at(session.date, th, tm, session.open), session.close) };
  }).filter((w) => w.to > w.from);
}
export const flatByOf = (session, matrix) => { const [h, m] = matrix.flatBy.split(':').map(Number); return Math.min(at(session.date, h, m, session.open), session.close - 5 * MIN); };

// Breaks of structure on one direction's bars: up[j] and down[j] at every close.
function breaks(bars, swing) {
  const up = bars.map((_, j) => bosAt(bars, j, swing).ok);
  const down = bars.map((_, j) => downwardBosAt(bars, j, swing).ok);
  return { up, down };
}
// Market structure shift (change of character): an upward break at k whose most recent earlier break in the session
// (the latest j < k with an upward or downward break) was downward.
export function isShift(br, k) {
  if (!br.up[k]) return false;
  for (let j = k - 1; j >= 0; j--) if (br.up[j] || br.down[j]) return br.down[j] && !br.up[j];
  return false;
}

// The setups of one family at the close of bar k, on one direction's bars (bars, levels and prevClose already mirrored
// for shorts). Returns { entryType, entry, stop, why } in that direction's coordinates, or null.
function setupAt(family, ctx, k) {
  const { bars, sweepLevels, breakLevels, br, sweeps, prevClose, sig, winOf } = ctx;
  const b = bars[k];
  if (family === 'F1') {
    for (const sw of sweeps) {
      if (sw.used || !(k > sw.s && k <= sw.s + sig.sweepToShiftMaxBars) || winOf(k) !== sw.win) continue;
      if (!isShift(br, k)) continue;
      sw.used = true;
      const { extreme, lambda } = sweepExtreme(bars, sw.s, k);
      const fvg = bullishFvg(bars, lambda, k);
      if (!fvg) return { none: `shift without a fair value gap (sweep of ${sw.level})` };
      return { entryType: 'limit', entry: Math.floor((fvg.lo + fvg.hi) / 2), stop: extreme - sig.stopBufferTicks, why: `sweep of ${sw.level} at bar ${sw.s}, shift at ${k}, gap ${fvg.index}` };
    }
    return null;
  }
  if (family === 'F2') {
    if (!br.up[k] || k < 1) return null;
    const gap = inversionAt(bars, k, 0, { maxAgeBars: k, earliestOffset: sig.ifvgEarliestOffset });
    if (!gap) return { none: 'break without an inverse fair value gap' };
    return { entryType: 'limit', entry: Math.floor((gap.lo + gap.hi) / 2), stop: gap.lo - sig.stopBufferTicks, why: `break at ${k}, inverse gap ${gap.index}` };
  }
  // F3 and LB: a level break (the close above a resistance level, the previous close at or below it).
  const pc = k > 0 ? bars[k - 1].c : prevClose;
  if (pc == null) return null;
  const lvl = breakLevels.find(([, v]) => v != null && b.c > v && pc <= v);
  if (!lvl) return null;
  if (family === 'LB') return { entryType: 'market', stop: b.l - sig.stopBufferTicks, why: `break of ${lvl[0]} at ${k}` };
  let origin = k;
  for (let j = Math.max(0, k - sig.obOriginLookback); j <= k; j++) if (bars[j].l <= bars[origin].l) origin = j;
  const ob = orderBlock(bars, origin);
  if (!ob || !(ob.hi < b.c)) return { none: `break of ${lvl[0]} without an order block below the close` };
  return { entryType: 'limit', entry: Math.floor((ob.lo + ob.hi) / 2), stop: ob.lo - sig.stopBufferTicks, why: `break of ${lvl[0]} at ${k}, order block ${ob.index}` };
}

// Fill and exit on 1-minute bars (original coordinates, d = +1 long, -1 short). Returns a trade or { noFill }.
export function execute({ m1, d, entryType, entry, stop, t0, fillUntil, flatBy, sig, exec }) {
  let f = -1, ref = null;
  for (let i = 0; i < m1.length; i++) {
    const x = m1[i];
    if (x.s < t0) continue;
    if (x.s >= fillUntil) break;
    if (entryType === 'market') { f = i; ref = x.o; break; }
    if (d > 0 ? x.l < entry : x.h > entry) { f = i; ref = entry; break; }
  }
  if (f < 0) return { noFill: entryType === 'market' ? 'no bar before the window ended' : 'limit not reached in time' };
  // The minimum stop: 0.25 ATR from the entry reference (a smaller stop is widened).
  let risk = d * (ref - stop);
  if (risk < sig.minStopTicks) { stop = ref - d * sig.minStopTicks; risk = sig.minStopTicks; }
  if (!(risk > 0)) return { noFill: 'the stop is not beyond the entry' };
  const target = ref + d * Math.round(sig.rMultiple * risk);
  const fill = ref + d * exec.entrySlippageTicks;
  let exitI = -1, exit = null, kind = null, mae = 0;
  const adverse = (x) => (d > 0 ? fill - x.l : x.h - fill);
  for (let q = f; q < m1.length; q++) {
    const x = m1[q];
    if (q > f && x.s >= flatBy) { exitI = q; exit = x.o; kind = 'time'; mae = Math.max(mae, d * (fill - x.o)); break; }
    mae = Math.max(mae, adverse(x));
    const hitStop = d > 0 ? x.l <= stop : x.h >= stop;
    if (hitStop) { exitI = q; exit = (q === f ? stop : (d > 0 ? Math.min(stop, x.o) : Math.max(stop, x.o))) - d * exec.stopSlippageTicks; kind = 'stop'; mae = Math.max(mae, d * (fill - exit)); break; }
    if (q > f && (d > 0 ? x.h > target : x.l < target)) { exitI = q; exit = target; kind = 'target'; break; }
  }
  if (exitI < 0) { exitI = m1.length - 1; exit = m1[exitI].c; kind = 'session_end'; mae = Math.max(mae, d * (fill - exit)); }
  return { d, entryType, ref, fill, stop, target, riskTicks: risk, fillMs: m1[f].s, exitMs: m1[exitI].s, exit, kind, resultTicks: d * (exit - fill), maeTicks: Math.max(0, mae) };
}

// One configuration on one market: every session's trades and skipped setups.
export function runSignals(market, family, matrix) {
  const sig = matrix.signal, exec = matrix.execution, swing = sig.swing;
  const trades = [], skipped = [];
  for (const s of market.sessions) {
    const wins = windowsOf(s, matrix), flatBy = flatByOf(s, matrix);
    if (!wins.length) continue;
    const winAt = (ms) => wins.find((w) => ms > w.from && ms <= w.to)?.id ?? null;
    const L = s.levels;
    const dirs = [
      { d: 1, bars: s.m5, sweepLevels: [['PDL', L.PDL], ['PWL', L.PWL]], breakLevels: [['PDH', L.PDH], ['PWH', L.PWH]], prevClose: s.prevClose },
      { d: -1, bars: mirrorBars(s.m5), sweepLevels: [['PDH', L.PDH == null ? null : -L.PDH], ['PWH', L.PWH == null ? null : -L.PWH]], breakLevels: [['PDL', L.PDL == null ? null : -L.PDL], ['PWL', L.PWL == null ? null : -L.PWL]], prevClose: s.prevClose == null ? null : -s.prevClose },
    ].map((x) => ({ ...x, br: family === 'F1' || family === 'F2' ? breaks(x.bars, swing) : null, sweeps: [], sig, winOf: (k) => winAt(s.m5[k].e) }));
    let busyUntil = -Infinity;
    const filledIn = new Map();
    for (let k = 0; k < s.m5.length; k++) {
      const t = s.m5[k].e, win = winAt(t);
      if (family === 'F1' && win) for (const x of dirs) { const lv = x.sweepLevels.find(([, v]) => v != null && isSweepBar(x.bars[k], v)); if (lv) x.sweeps.push({ s: k, level: lv[0], win, used: false }); }
      if (!win) continue;
      for (const x of dirs) {
        const st = setupAt(family, x, k);
        if (!st) continue;
        if (st.none) { skipped.push({ date: s.date, t, d: x.d, reason: st.none }); continue; }
        if (t < busyUntil) { skipped.push({ date: s.date, t, d: x.d, reason: 'a position or order is open', why: st.why }); continue; }
        if ((filledIn.get(win) || 0) >= sig.maxTradesPerWindow) { skipped.push({ date: s.date, t, d: x.d, reason: 'window trade limit', why: st.why }); continue; }
        const w = wins.find((y) => y.id === win);
        const fillUntil = st.entryType === 'market' ? w.to : Math.min(t + sig.orderLifeMinutes * MIN, w.to);
        const atr = s.m5[k].atr;
        const sigX = { ...sig, minStopTicks: Math.max(1, Math.ceil(sig.minStopAtr * atr)) };
        const tr = execute({ m1: s.m1, d: x.d, entryType: st.entryType, entry: st.entry == null ? null : x.d * st.entry, stop: x.d * st.stop, t0: t, fillUntil, flatBy, sig: sigX, exec });
        if (tr.noFill) { skipped.push({ date: s.date, t, d: x.d, reason: tr.noFill, why: st.why }); busyUntil = Math.max(busyUntil, fillUntil); continue; }
        trades.push({ date: s.date, window: win, setupMs: t, why: st.why, ...tr });
        filledIn.set(win, (filledIn.get(win) || 0) + 1);
        busyUntil = tr.exitMs + MIN;
      }
    }
  }
  return { trades, skipped };
}

// The matched random twin (CAMPAIGN-1.md section 6): the same number of trades per session and window as the
// configuration, each at a uniformly random 1-minute bar of the window at or after the previous random exit, in a
// random direction, with that trade's own stop distance, market entry at the bar's open, the same exits.
export function randomTwin(market, trades, matrix, rng) {
  const sig = matrix.signal, exec = matrix.execution;
  const out = [];
  const byDate = new Map();
  for (const t of trades) { if (!byDate.has(t.date)) byDate.set(t.date, []); byDate.get(t.date).push(t); }
  for (const s of market.sessions) {
    const list = byDate.get(s.date);
    if (!list) continue;
    const wins = windowsOf(s, matrix), flatBy = flatByOf(s, matrix);
    let earliest = -Infinity;
    for (const t of list) {
      const w = wins.find((y) => y.id === t.window);
      const cand = [];
      for (let i = 0; i < s.m1.length; i++) { const x = s.m1[i]; if (x.s >= w.from && x.s < w.to && x.s >= earliest) cand.push(i); }
      const r1 = rng(), r2 = rng();
      if (!cand.length) continue;
      const i = cand[Math.floor(r1 * cand.length)];
      const d = r2 < 0.5 ? 1 : -1;
      const ref = s.m1[i].o;
      const tr = execute({ m1: s.m1, d, entryType: 'market', entry: null, stop: ref - d * t.riskTicks, t0: s.m1[i].s, fillUntil: s.m1[i].s + MIN, flatBy, sig: { ...sig, minStopTicks: 1 }, exec });
      if (tr.noFill) continue;
      out.push({ date: s.date, window: t.window, setupMs: s.m1[i].s, why: 'random', ...tr });
      earliest = tr.exitMs + MIN;
    }
  }
  return out;
}
