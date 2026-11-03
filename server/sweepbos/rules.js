// sweep-bos rule functions (PRE-REGISTRATION.md section 3), pure and deterministic. Prices are handled in
// integer units of 0.0001 dollars (U) so that every comparison and every level is exact; the engine converts
// bars once (toU) and converts back for records (fromU). Every function reads only the bars it is given, and
// the engine gives each decision the bars available at that time (bars[0..k] of the session, earlier sessions,
// daily bars of earlier sessions). Long-side comments; the short side is the mirror.
export const toU = (x) => Math.round(x * 10000);
export const fromU = (u) => u / 10000;
export const CENT = 100;              // one cent in units
export const CONFIRM_BARS = 3;        // a swing is confirmed at the close of bar i + 3
export const SWEEP_LAST_INDEX = 5;    // bars starting 09:30..09:55
export const LAST_FILL_INDEX = 11;    // a fill must occur on a bar starting at or before 10:25
export const FIRST_HOUR_LAST_INDEX = 11;
export const BUFFER_SESSIONS = 20;

// 3.1: 3-bar fractal swings, strict on both sides, indices 1..n-2.
export function swingHighs(bars) {
  const out = [];
  for (let i = 1; i < bars.length - 1; i++) if (bars[i].h > bars[i - 1].h && bars[i].h > bars[i + 1].h) out.push(i);
  return out;
}
export function swingLows(bars) {
  const out = [];
  for (let i = 1; i < bars.length - 1; i++) if (bars[i].l < bars[i - 1].l && bars[i].l < bars[i + 1].l) out.push(i);
  return out;
}
// The swings confirmed at the close of bar k (i + 3 <= k), in index order.
export const confirmedBy = (indices, k) => indices.filter((i) => i + CONFIRM_BARS <= k);

// 3.2: the bias for the session that follows these daily bars (bars of sessions up to d - 1, in date order).
// Returns { bias: 'long' | 'short' | 'none', highs: [i1, i2], lows: [i1, i2] } with the two most recent confirmed
// swing indices (null when fewer than two).
export function dailyBias(daily) {
  const J = daily.length - 1;
  const hs = confirmedBy(swingHighs(daily), J), ls = confirmedBy(swingLows(daily), J);
  const highs = hs.length >= 2 ? hs.slice(-2) : null, lows = ls.length >= 2 ? ls.slice(-2) : null;
  let bias = 'none';
  if (highs && lows) {
    const hRising = daily[highs[1]].h > daily[highs[0]].h, hFalling = daily[highs[1]].h < daily[highs[0]].h;
    const lRising = daily[lows[1]].l > daily[lows[0]].l, lFalling = daily[lows[1]].l < daily[lows[0]].l;
    if (hRising && lRising) bias = 'long';
    else if (hFalling && lFalling) bias = 'short';
  }
  return { bias, highs, lows };
}

// 3.4: the sweep test of one bar against the prior session's levels: 'long', 'short', 'both' or null.
export function sweepDirection(bar, pdh, pdl) {
  const long = bar.l < pdl && bar.c > pdl, short = bar.h > pdh && bar.c < pdh;
  if (long && short) return 'both';
  return long ? 'long' : short ? 'short' : null;
}

// 3.5: break of structure at the close of bar k for a setup of direction dir. The structure is the most
// recent swing confirmed BEFORE that close (i + 3 <= k - 1); a BOS needs C[k] beyond its level and no earlier
// close beyond it since the swing (bar k is the first close beyond). Returns { ok, swingIndex, level, reason }.
export function bosAt(bars, k, dir) {
  const swings = dir === 'long' ? swingHighs(bars.slice(0, k + 1)) : swingLows(bars.slice(0, k + 1));
  const usable = confirmedBy(swings, k - 1);
  if (!usable.length) return { ok: false, swingIndex: null, level: null, reason: 'no confirmed swing' };
  const i = usable[usable.length - 1];
  const level = dir === 'long' ? bars[i].h : bars[i].l;
  const beyond = (c) => (dir === 'long' ? c > level : c < level);
  for (let j = i + 1; j < k; j++) if (beyond(bars[j].c)) return { ok: false, swingIndex: i, level, reason: 'the swing was already closed beyond' };
  return beyond(bars[k].c) ? { ok: true, swingIndex: i, level, reason: null } : { ok: false, swingIndex: i, level, reason: 'close not beyond the swing' };
}

// 3.7: the latest bar in [s, k] at the leg's extreme (the lowest low for a long).
export function legExtremeIndex(bars, s, k, dir) {
  let best = s;
  for (let j = s; j <= k; j++) {
    if (dir === 'long' ? bars[j].l <= bars[best].l : bars[j].h >= bars[best].h) best = j;
  }
  return best;
}
// 3.7 order block: the latest opposite-colour bar at or before lambda (bearish for a long: c < o).
export function orderBlock(bars, lambda, dir) {
  for (let j = lambda; j >= 0; j--) {
    const b = bars[j];
    if (dir === 'long' ? b.c < b.o : b.c > b.o) return { type: 'order_block', index: j, lo: b.l, hi: b.h, entry: dir === 'long' ? b.h : b.l };
  }
  return null;
}
// 3.7 fair value gap: the latest triple (a, a+1, a+2) inside the leg [lambda, k] with a gap; long: H[a] < L[a+2].
export function fairValueGap(bars, lambda, k, dir) {
  for (let a = k - 2; a >= lambda; a--) {
    if (dir === 'long' && bars[a].h < bars[a + 2].l) return { type: 'fair_value_gap', index: a, lo: bars[a].h, hi: bars[a + 2].l, entry: bars[a + 2].l };
    if (dir === 'short' && bars[a].l > bars[a + 2].h) return { type: 'fair_value_gap', index: a, lo: bars[a + 2].h, hi: bars[a].l, entry: bars[a + 2].h };
  }
  return null;
}

// 3.6 A: the buffer from the first-hour bars (index 0..11) of the 20 most recent complete sessions before the
// session: the median of their ranges in cents, rounded half up to the cent, in units. `sessions` are the
// complete sessions in date order (the caller passes exactly the 20). Returns null with fewer than 20.
export function bufferFromSessions(sessions) {
  if (sessions.length < BUFFER_SESSIONS) return null;
  const cents = [];
  for (const s of sessions.slice(-BUFFER_SESSIONS)) for (const b of s.bars) if (b.idx <= FIRST_HOUR_LAST_INDEX) cents.push(Math.round((b.h - b.l) / CENT));
  if (!cents.length) return null;
  cents.sort((a, b) => a - b);
  const n = cents.length;
  const median = n % 2 ? cents[(n - 1) / 2] : (cents[n / 2 - 1] + cents[n / 2]) / 2;
  return Math.floor(median + 0.5) * CENT;
}
// 3.6 B: one cent beyond the second most recent swing confirmed at the close of bar k; null with fewer than two.
export function secondSwingStop(bars, k, dir) {
  const swings = confirmedBy(dir === 'long' ? swingLows(bars.slice(0, k + 1)) : swingHighs(bars.slice(0, k + 1)), k);
  if (swings.length < 2) return null;
  const i = swings[swings.length - 2];
  return { index: i, stop: dir === 'long' ? bars[i].l - CENT : bars[i].h + CENT };
}

// 3.10 exit simulation on a session's bars (units) for a trade filled on bar m at `entry` with `stop` and
// `target`: the stop is checked on the fill bar (target not); on later bars up to n - 2 the stop comes first
// (exit at the stop, or at the open when the bar opened beyond it), then the target (strictly through); else
// the time stop at the open of the last bar. Returns { exitIndex, exit, reason, sameBar }.
export function simulateExit(bars, m, dir, stop, target) {
  const n = bars.length;
  const long = dir === 'long';
  const stopHit = (b) => (long ? b.l <= stop : b.h >= stop);
  const targetHit = (b) => (long ? b.h > target : b.l < target);
  if (stopHit(bars[m])) return { exitIndex: m, exit: stop, reason: 'stop', sameBar: true };
  for (let q = m + 1; q <= n - 2; q++) {
    const b = bars[q];
    if (stopHit(b)) return { exitIndex: q, exit: long ? Math.min(stop, b.o) : Math.max(stop, b.o), reason: 'stop', sameBar: false };
    if (targetHit(b)) return { exitIndex: q, exit: target, reason: 'target', sameBar: false };
  }
  return { exitIndex: n - 1, exit: bars[n - 1].o, reason: 'time', sameBar: false };
}

// 3.11: R after costs of c units per side (planned risk in units, pre-cost).
export function rOf(dir, entry, exit, risk, c) {
  return dir === 'long' ? ((exit - c) - (entry + c)) / risk : ((entry - c) - (exit + c)) / risk;
}
