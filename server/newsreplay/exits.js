// Campaign 2's AMT exits (CAMPAIGN-2.md sections 3 to 7; matrix-2.json; experimental assumptions). Each exit depends
// only on the stock's bars, the fill and the prior sessions' profiles, never on the account, so the first trigger is
// found at the buy by stepping forward through the position's possible life (to the close of the 10th session after
// the fill); every decision uses only bars and profiles complete at its decision time. The executor (sim.js) schedules
// the one resulting exit event and sells only if the same position is still held. Simulation only.
import { TIME_STOP_SESSIONS } from './planner.js';

export const EXITS = Object.freeze(['existing', 'acceptance', 'target', 'price_only']);
export const WINDOW_30_MS = 30 * 60000;
export const TOUCH_EXCESS = 0.01;
const EPS = 1e-9;

// The 30-minute bars of one session from its 5-minute bars (indices from..to in the stock's flat array): windows of 30
// minutes from the open, the last ending at the close (early closes included). { s, e, o, h, l, c, v, lastI, date, di }.
export function thirtyMinuteBars(arr, from, to, openMs, closeMs) {
  const out = [];
  for (let i = from; i <= to && i < arr.length; i++) {
    const b = arr[i];
    const open = openMs(b.date), close = closeMs(b.date);
    const k = Math.floor((b.s - open) / WINDOW_30_MS);
    const s = open + k * WINDOW_30_MS, e = Math.min(s + WINDOW_30_MS, close);
    const w = out.at(-1);
    if (w && w.date === b.date && w.s === s) { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; w.v += b.v || 0; w.lastI = i; }
    else out.push({ s, e, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, lastI: i, date: b.date, di: b.di });
  }
  return out;
}

// The last index of the stock's bars inside session di (or the array's last index).
function lastIndexOfSession(arr, startI, di) {
  let j = startI;
  while (j + 1 < arr.length && arr[j + 1].di <= di) j++;
  return j;
}

// The first AMT exit of a position, or null. exit: 'acceptance' (X2), 'target' (X3) or 'price_only' (X4).
// Returns { reason, decisionMs, fillI, raw (null for a sale at the fill bar's open), order (event order), detail }.
export function amtExitOf({ exit, stock, fillI, fillRaw, activationMs, mk, delay = null, delayed }) {
  if (exit === 'existing') return null;
  if (!EXITS.includes(exit)) throw new Error(`unknown exit ${exit}`);
  const arr = mk.flat.get(stock);
  const fb = arr[fillI];
  const endI = lastIndexOfSession(arr, fillI, fb.di + TIME_STOP_SESSIONS);
  const atOpen = (i, reason, decisionMs, detail) => {
    const j = delay ? delayed(i, arr, delay) : i;
    return j == null ? null : { reason, decisionMs, fillI: j, raw: null, order: 1, detail };
  };
  if (exit === 'acceptance' || exit === 'price_only') {
    let L = null, actDate = null;
    if (exit === 'price_only') {
      const ai = mk.pos.get(stock)?.get(activationMs);
      if (ai == null) return null;
      L = arr[ai].l; actDate = arr[ai].date;
    }
    for (const w of thirtyMinuteBars(arr, fillI, endI, mk.openMs, mk.closeMs)) {
      if (w.s < fb.s) continue; // only windows that start at or after the fill
      if (w.lastI + 1 >= arr.length) return null;
      if (exit === 'acceptance') {
        const prior = mk.sessions[w.di - 1];
        const p = prior ? mk.profiles(stock, prior, w.date) : null;
        if (!p) continue;
        if (w.c >= p.val - EPS && w.c < p.poc - EPS) return atOpen(w.lastI + 1, 'acceptance', w.e, { close: w.c, val: p.val, poc: p.poc, windowStart: w.s });
      } else {
        const level = L / mk.ratioAfter(stock, actDate, w.date);
        if (w.c < level - EPS) return atOpen(w.lastI + 1, 'price_only', w.e, { close: w.c, level, windowStart: w.s });
      }
    }
    return null;
  }
  // X3: the target, fixed at the fill.
  const fillDate = fb.date;
  const prior = mk.sessions[fb.di - 1];
  const P = prior ? mk.profiles(stock, prior, fillDate) : null;
  if (!P) return null;
  const primary = P.vah + (P.vah - P.val);
  let target = null, source = 'none';
  if (fillRaw < primary - EPS) { target = primary; source = 'primary'; }
  else { const c = mk.composite ? mk.composite(stock, fillDate, fillRaw) : null; if (c) { target = c.target; source = 'composite'; } }
  if (target == null) return { reason: null, none: true, detail: { source, primary } };
  for (let j = fillI + 1; j <= endI; j++) {
    const b = arr[j];
    const t = target / mk.ratioAfter(stock, fillDate, b.date);
    if (b.o >= t - EPS) return delay ? atOpen(j, 'target', b.s, { target: t, source, gap: true }) : { reason: 'target', decisionMs: b.s, fillI: j, raw: b.o, order: 1, detail: { target: t, source, gap: true } };
    if (b.h >= t + TOUCH_EXCESS - EPS) return delay ? atOpen(j, 'target', b.e, { target: t, source, gap: false }) : { reason: 'target', decisionMs: b.s, fillI: j, raw: t, order: 2.5, detail: { target: t, source, gap: false } };
  }
  return { reason: null, none: false, detail: { target, source } };
}
