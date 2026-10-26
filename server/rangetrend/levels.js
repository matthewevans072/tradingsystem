// Range-trend levels (strategy/range-trend/PLAN-DRAFT.md section 3). Pure functions.
// Every level for decision day t is computed from `prior`, the closes up to and
// including t-1 (oldest first); today's close is only ever compared with them.

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
    const z = c >= a && c <= b;
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
export function rangeState(prior, L) {
  if (!Array.isArray(prior) || prior.length < Math.max(L.windowSessions, L.mSessions + 1)) return null;
  const w = prior.slice(prior.length - L.windowSessions);
  const lo = Math.min(...w), hi = Math.max(...w), H = hi - lo, m = typicalMove(prior, L.mSessions);
  const zone = L.zoneFraction * H;
  const bottom = [lo, lo + zone], top = [hi - zone, hi];
  const bottomVisits = zoneVisits(w, bottom[0], bottom[1], L.visitGap);
  const topVisits = zoneVisits(w, top[0], top[1], L.visitGap);
  const established = bottomVisits.length >= L.minVisits && topVisits.length >= L.minVisits && H > 0 && H >= L.minHeightM * m;
  return { lo, hi, H, m, bottom, top, bottomVisits, topVisits, established, windowSessions: w.length };
}

// Entry conditions at today's close c on the state computed from the prior closes.
export function isDip(st, c) {
  return !!st?.established && c > st.lo && c <= st.bottom[1];
}

export function isRecovery(st, c, L) {
  if (!st?.established || !st.bottomVisits.length) return false;
  const v = st.bottomVisits.at(-1);
  return c >= v.low + L.recoveryM * st.m && c > st.bottom[1] && c <= st.lo + 0.5 * st.H;
}

export function isBreakout(st, c, L) {
  return !!st?.established && c > st.hi + L.breakoutM * st.m;
}

// Breakdown of an untraded range (section 3): the first close below lo - k*m(t-1)
// freezes lo from its own window; the break is confirmed when `closes` more
// consecutive closes (including the first) are below the frozen lo minus k times
// that close's m(t-1). `series` is the whole close history; returns the index of
// the confirming close, or null. Used to define and test the rule.
export function untradedBreakdown(series, from, L) {
  let frozen = null, count = 0;
  for (let t = from; t < series.length; t++) {
    const prior = series.slice(0, t), m = typicalMove(prior, L.mSessions);
    if (frozen == null) {
      const st = rangeState(prior, L);
      if (st && series[t] < st.lo - L.breakdownM * st.m) { frozen = st.lo; count = 1; }
    } else if (series[t] < frozen - L.breakdownM * m) count++;
    else { frozen = null; count = 0; }
    if (count >= L.breakdownCloses) return t;
  }
  return null;
}
