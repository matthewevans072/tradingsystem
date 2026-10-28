// Range-trend levels (strategy/range-trend/PLAN-DRAFT.md v0.5 section 3). Pure functions.
// Every level for decision day t is computed from `prior`, the closes up to and
// including t-1 (oldest first); today's close is only ever compared with them.
//
// One comparison convention everywhere (levels and engine): values within EPS are
// equal. So "x <= b" is x <= b + EPS, "x >= a" is x >= a - EPS, "x > a" is
// x > a + EPS and "x < b" is x < b - EPS, at the plan's exact edges.
export const EPS = 1e-9;
export const le = (x, b) => x <= b + EPS;
export const ge = (x, a) => x >= a - EPS;
export const gt = (x, a) => x > a + EPS;
export const lt = (x, b) => x < b - EPS;

// Mean absolute close-to-close change over the last n changes of `closes`
// (needs n + 1 closes); null when there are too few.
export function typicalMove(closes, n) {
  if (!Array.isArray(closes) || closes.length < n + 1) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += Math.abs(closes[i] - closes[i - 1]);
  return s / n;
}

// Visits to a zone [a, b] in a list of closes: runs of consecutive closes inside
// the zone; a run starting fewer than `gap` closes after the previous visit ended
// joins that visit. Each visit: { start, end, low } (indices into `closes`).
export function zoneVisits(closes, a, b, gap) {
  const visits = [];
  let inRun = false, outside = Infinity;
  closes.forEach((c, i) => {
    const z = ge(c, a) && le(c, b);
    if (z) {
      if (!inRun) {
        if (visits.length && outside < gap) visits.at(-1).end = i; else visits.push({ start: i, end: i, low: c });
      }
      const v = visits.at(-1);
      v.end = i;
      v.low = Math.min(v.low, c);
      outside = 0;
    } else outside = inRun ? 1 : outside + 1;
    inRun = z;
  });
  return visits;
}

// The range on the window of the last `windowSessions` closes of `prior`, with
// m from the last `mSessions` changes of `prior`. Null when there is too little history.
// Also carries, for the recovery entry (D2): the stock's previous close, and whether a
// close after the last close of the most recent bottom-zone visit lies in the top zone.
export function rangeState(prior, L) {
  if (!Array.isArray(prior) || prior.length < Math.max(L.windowSessions, L.mSessions + 1)) return null;
  const w = prior.slice(prior.length - L.windowSessions);
  const lo = Math.min(...w), hi = Math.max(...w), H = hi - lo, m = typicalMove(prior, L.mSessions);
  const zone = L.zoneFraction * H;
  const bottom = [lo, lo + zone], top = [hi - zone, hi];
  const bottomVisits = zoneVisits(w, bottom[0], bottom[1], L.visitGap);
  const topVisits = zoneVisits(w, top[0], top[1], L.visitGap);
  const established = bottomVisits.length >= L.minVisits && topVisits.length >= L.minVisits && gt(H, 0) && ge(H, L.minHeightM * m);
  const lastBottom = bottomVisits.at(-1) ?? null;
  const topSinceBottom = lastBottom ? w.slice(lastBottom.end + 1).some((c) => ge(c, top[0]) && le(c, top[1])) : false;
  return { lo, hi, H, m, bottom, top, bottomVisits, topVisits, established, windowSessions: w.length, prevClose: prior.at(-1), topSinceBottom };
}

// D3: a range is qualified at a stock's close number `closes` (its own closes, counted from the first bar)
// when it is established on the window and, if the stock has a confirming close (number `breakOrdinal`),
// the whole window lies after it: the earliest qualified close is the 61st after the confirming close.
export function qualifiedRange(st, closes, breakOrdinal, L) {
  return !!st?.established && (breakOrdinal == null || closes - L.windowSessions > breakOrdinal);
}

// Entry conditions at today's close c on the state computed from the prior closes.
export function isDip(st, c) {
  return !!st?.established && gt(c, st.lo) && le(c, st.bottom[1]);
}

// Recovery (section 3 and D2): at least recoveryM x m above the lowest close of the most recent bottom-zone
// visit, above the bottom zone and in the lower half; an up close (above the stock's previous close); and no
// close in the window's top zone since the last close of that visit, today's close included.
export function isRecovery(st, c, L) {
  if (!st?.established || !st.bottomVisits.length) return false;
  const v = st.bottomVisits.at(-1);
  const inTop = ge(c, st.top[0]) && le(c, st.top[1]);
  return ge(c, v.low + L.recoveryM * st.m) && gt(c, st.bottom[1]) && le(c, st.lo + 0.5 * st.H)
    && gt(c, st.prevClose) && !st.topSinceBottom && !inTop;
}

export function isBreakout(st, c, L) {
  return !!st?.established && gt(c, st.hi + L.breakoutM * st.m);
}

// D3, the break of a stock's range at one close, held or not. `bw` is the breakdown watch from the previous
// close ({ frozenLo, m, count, since } or null): a first close below lo - breakdownM x m(t-1) of a qualified
// range freezes that window's lo; each next close counts if it is below the frozen lo minus breakdownM times
// that close's m(t-1), and the breakdownCloses-th such close confirms the breakdown (the confirming close);
// a close that does not count drops the watch. A breakout close of a qualified range is a break by itself.
// While the range is not qualified, no close starts a watch or is a breakout. Returns the new watch, the kind
// of break confirmed at this close ('breakdown', 'breakout' or null) and the values that decided it.
export function breakStep(bw, c, rs, qualified, L, date = null) {
  let kind = null, values = null;
  if (bw) {
    const m = rs?.m ?? bw.m;
    if (lt(c, bw.frozenLo - L.breakdownM * m)) {
      bw = { ...bw, count: bw.count + 1 };
      if (bw.count >= L.breakdownCloses) { kind = 'breakdown'; values = { close: c, frozenLo: bw.frozenLo, m, firstBreakingClose: bw.since, closesBelow: bw.count }; bw = null; }
    } else bw = null;
  }
  if (!bw && kind == null && qualified && lt(c, rs.lo - L.breakdownM * rs.m)) {
    bw = { frozenLo: rs.lo, m: rs.m, count: 1, since: date };
    if (bw.count >= L.breakdownCloses) { kind = 'breakdown'; values = { close: c, frozenLo: bw.frozenLo, m: rs.m, firstBreakingClose: date, closesBelow: 1 }; bw = null; }
  }
  if (kind == null && qualified && isBreakout(rs, c, L)) { kind = 'breakout'; values = { close: c, hi: rs.hi, m: rs.m }; }
  return { bw, kind, values };
}

// Breakdown of an untraded range on a single close series (the frozen-lo rule of section 3, PLAN example C),
// without the qualification of D3: returns the index of the confirming close, or null. The engine uses
// breakStep; this is the reference definition for the rule's own test.
export function untradedBreakdown(series, from, L) {
  let frozen = null, count = 0;
  for (let t = from; t < series.length; t++) {
    const prior = series.slice(0, t), m = typicalMove(prior, L.mSessions);
    if (frozen == null) {
      const st = rangeState(prior, L);
      if (st && lt(series[t], st.lo - L.breakdownM * st.m)) { frozen = st.lo; count = 1; }
    } else if (lt(series[t], frozen - L.breakdownM * m)) count++;
    else { frozen = null; count = 0; }
    if (count >= L.breakdownCloses) return t;
  }
  return null;
}

// Pullback zone (section 3): a close above the old high and within k x m of it.
export function isPullbackClose(c, oldHi, m, L) {
  return gt(c, oldHi) && le(c, oldHi + L.pullbackM * m);
}
