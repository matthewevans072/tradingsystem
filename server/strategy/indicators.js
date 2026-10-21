// Indicators for the Strategy Lab engine (ENGINE-SPEC §2). Completed bars only:
// nothing at bar i reads bar i + 1 or later.

// The first bar (no previous close) uses h - l, like Pine's ta.tr(true).
export function trueRange(bar, prevClose = null) {
  const hl = bar.h - bar.l;
  if (prevClose == null) return hl;
  return Math.max(hl, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
}

// Incremental Wilder ATR (Pine ta.atr): the first value is the simple mean of
// the first N true ranges, then ATR_i = (ATR_{i-1} * (N - 1) + TR_i) / N.
// The state is plain JSON so engine snapshots can carry it.
export function atrInit() {
  return { n: 0, sum: 0, atr: null, prevClose: null };
}

export function atrUpdate(st, bar, length) {
  const tr = trueRange(bar, st.prevClose);
  st.prevClose = bar.c;
  st.n++;
  if (st.n < length) st.sum += tr;
  else if (st.n === length) { st.sum += tr; st.atr = st.sum / length; }
  else st.atr = (st.atr * (length - 1) + tr) / length;
  return st.atr;
}

// ATR for a whole series: null until the first N true ranges exist.
export function wilderAtr(bars, length) {
  const st = atrInit();
  return bars.map((b) => atrUpdate(st, b, length));
}

export function trueRanges(bars) {
  return bars.map((b, i) => trueRange(b, i ? bars[i - 1].c : null));
}

export function sum(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs) {
  return xs.length ? sum(xs) / xs.length : null;
}

// Simple moving average of the last n values ending at index i (null if short).
export function smaAt(xs, i, n) {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += xs[k];
  return s / n;
}
