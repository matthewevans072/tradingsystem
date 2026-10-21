// Box detection and the armed-setup rules (ENGINE-SPEC §3), per symbol.
// The engine owns the symbol state ({ i, hist, state, box, nextWindowStartMin });
// these functions read completed bars only (hist ends at the current bar i).

// Floating-point slack for price comparisons against derived levels.
export const PX_EPS = 1e-9;

export function boxParams(cfg) {
  const b = cfg.box, e = cfg.entry;
  return {
    lookbackBars: b.lookbackBars, atrLength: b.atrLength, maxHeightAtr: b.maxHeightAtr, minHeightAtr: b.minHeightAtr,
    touchToleranceAtr: b.touchToleranceAtr, minTouchesEach: b.minTouchesEach, minBarsBetweenTouches: b.minBarsBetweenTouches,
    setupExpiryBars: b.setupExpiryBars, invalidateOnCloseBelowSupport: b.invalidateOnCloseBelowSupport,
    allowWindowAcrossSessions: b.allowWindowAcrossSessions !== false,
    volumeMultiple: e.volumeMultiple, volumeLookbackBars: e.volumeLookbackBars,
  };
}

// Bars kept per symbol: the box window and the volume lookback plus the candle.
export const historyLength = (p) => Math.max(p.lookbackBars, p.volumeLookbackBars + 1);

export const volumeOf = (v) => (v != null && Number.isFinite(+v) && +v > 0 ? +v : null);

// Distinct touches, counted greedily from the oldest bar: a touch counts when
// at least minBarsBetweenTouches bars lie between it and the previous counted
// touch (index difference >= minBarsBetweenTouches + 1).
export function countTouches(bars, firstIndex, isTouch, minBarsBetween) {
  const out = [];
  let last = -Infinity;
  for (let k = 0; k < bars.length; k++) {
    const idx = firstIndex + k;
    if (isTouch(bars[k]) && idx - last >= minBarsBetween + 1) { out.push(idx); last = idx; }
  }
  return out;
}

// At the close of bar i (the last element of hist), with A = ATR_i: the frozen
// setup if the window [i - L + 1, i] qualifies, otherwise null.
export function detectBox(hist, i, A, p, nextWindowStartMin = 0) {
  const L = p.lookbackBars;
  if (A == null || !(A > 0)) return null;
  if (i + 1 < Math.max(L, p.atrLength + 1)) return null; // warm-up
  const ws = i - L + 1;
  if (ws < nextWindowStartMin) return null; // overlap/reset rule
  if (hist.length < L) return null;
  const win = hist.slice(hist.length - L);
  if (!p.allowWindowAcrossSessions && win[0].date !== win[L - 1].date) return null;
  let R = -Infinity, S = Infinity;
  for (const b of win) { if (b.h > R) R = b.h; if (b.l < S) S = b.l; }
  const H = R - S;
  if (!(H > 0) || H > p.maxHeightAtr * A + PX_EPS || H < p.minHeightAtr * A - PX_EPS) return null;
  const tol = p.touchToleranceAtr * A;
  const up = countTouches(win, ws, (b) => b.h >= R - tol - PX_EPS, p.minBarsBetweenTouches);
  if (up.length < p.minTouchesEach) return null;
  const lo = countTouches(win, ws, (b) => b.l <= S + tol + PX_EPS, p.minBarsBetweenTouches);
  if (lo.length < p.minTouchesEach) return null;
  const at = (idx) => win[idx - ws].t;
  return {
    windowStart: win[0].t, windowEnd: win[L - 1].t, windowStartIndex: ws, windowEndIndex: i, eligibleAt: win[L - 1].t,
    resistance: R, support: S, height: H, atr: A, heightAtr: H / A, tolerance: tol,
    touchesUpper: up.length, touchesLower: lo.length,
    upperTouchTimes: up.map(at), lowerTouchTimes: lo.map(at),
    upperTouchHighs: up.map((idx) => win[idx - ws].h), lowerTouchLows: lo.map((idx) => win[idx - ws].l),
    params: {
      lookbackBars: L, atrLength: p.atrLength, maxHeightAtr: p.maxHeightAtr, minHeightAtr: p.minHeightAtr,
      touchToleranceAtr: p.touchToleranceAtr, minTouchesEach: p.minTouchesEach,
      minBarsBetweenTouches: p.minBarsBetweenTouches, setupExpiryBars: p.setupExpiryBars,
    },
  };
}

// While armed (frozen at bar e = box.windowEndIndex), at the close of bar j > e:
// 'breakout' (close above the frozen ceiling), 'invalidated', 'expired' or null.
export function armedStep(box, bar, j, p) {
  if (j <= box.windowEndIndex) return null;
  if (bar.c > box.resistance) return 'breakout';
  if (p.invalidateOnCloseBelowSupport && bar.c < box.support) return 'invalidated';
  if (j - box.windowEndIndex >= p.setupExpiryBars) return 'expired';
  return null;
}

// Volume rule at the breakout candle (the last element of hist): volumes for
// bars j - n ... j must all be available; v_j > multiple x mean(v_{j-n} ... v_{j-1}).
export function checkVolume(hist, p) {
  const n = p.volumeLookbackBars;
  const need = hist.slice(-(n + 1));
  const missing = (n + 1) - need.filter((b) => volumeOf(b.v) != null).length;
  if (need.length < n + 1 || missing > 0) {
    return { ok: false, code: 'volume_unavailable', reason: 'volume unavailable', missing, needed: n + 1, volumeMultiple: p.volumeMultiple };
  }
  const v = volumeOf(need[n].v);
  let s = 0;
  for (let k = 0; k < n; k++) s += volumeOf(need[k].v);
  const avg = s / n;
  const ratio = v / avg;
  const ok = v > p.volumeMultiple * avg;
  return {
    ok, code: ok ? null : 'volume_below_threshold',
    reason: ok ? null : `breakout volume ${ratio.toFixed(2)}× average (needs more than ${p.volumeMultiple}×)`,
    volume: v, avgVolume: avg, volumeRatio: ratio, volumeMultiple: p.volumeMultiple, lookback: n,
  };
}

// Retire the active box. A box consumed by a breakout candle at bar j also
// keeps that candle out of the next window.
export function retireBox(st, how, j) {
  const end = st.box.windowEndIndex;
  st.nextWindowStartMin = how === 'consumed' ? Math.max(end + 1, j + 1) : end + 1;
  st.box = null;
  st.state = 'scanning';
}
