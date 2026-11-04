// ICT Lab rule functions (strategy/ict-lab/CONCEPTS.md H1 to H20), pure and deterministic. Prices are handled
// in integer units of 0.0001 dollars (U) so every comparison and level is exact; the engine converts bars once
// (toU) and back for records (fromU). Every function reads only the bars it is given, and the engine gives each
// decision the bars available at that time (bars[0..k] of the session and the previous session's daily low).
// Long side only (PROTOCOL.md section 5). Every number a rule needs (the confirmation offset, the window index,
// the buffer, the minimum distance, the minimum zone height, the R multiple, the costs ...) is a parameter the
// engine reads from the pinned spec; nothing is duplicated here.
export const toU = (x) => Math.round(x * 10000);
export const fromU = (u) => u / 10000;
export const CENT = 100;              // one cent in units

// H1 (owner; sweep-bos H1/H2 retained): bar i is a SWING HIGH when its high is strictly above the highs of the
// `leftBars` bars before it and the `rightBars` bars after it (left 1, right 1 in round 1: "three-bar" means one
// bar on each side); equal highs form no swing. Swing lows mirror. Indices need i - left >= 0 and i + right <= n-1.
export function swingHighs(bars, { leftBars = 1, rightBars = 1 } = {}) {
  const out = [];
  for (let i = leftBars; i < bars.length - rightBars; i++) {
    let ok = true;
    for (let j = 1; j <= leftBars && ok; j++) if (!(bars[i].h > bars[i - j].h)) ok = false;
    for (let j = 1; j <= rightBars && ok; j++) if (!(bars[i].h > bars[i + j].h)) ok = false;
    if (ok) out.push(i);
  }
  return out;
}
export function swingLows(bars, { leftBars = 1, rightBars = 1 } = {}) {
  const out = [];
  for (let i = leftBars; i < bars.length - rightBars; i++) {
    let ok = true;
    for (let j = 1; j <= leftBars && ok; j++) if (!(bars[i].l < bars[i - j].l)) ok = false;
    for (let j = 1; j <= rightBars && ok; j++) if (!(bars[i].l < bars[i + j].l)) ok = false;
    if (ok) out.push(i);
  }
  return out;
}
// H1: a swing at i is CONFIRMED and usable at the close of bar i + confirmBarOffset (3 in round 1): at the close
// of bar k the confirmed swings are those with i + offset <= k.
export const confirmedBy = (indices, k, confirmBarOffset) => indices.filter((i) => i + confirmBarOffset <= k);

// H3 (owner; sweep-bos 3.3): PDL = the low of the previous NYSE session's daily bar. The engine decides whether
// that session exists and is complete; this is the level itself, in units.
export const priorSessionLow = (prevDaily) => prevDaily.l;

// H4 (owner, the sweep test): bar s is a LONG SWEEP bar when L[s] < PDL and C[s] > PDL: it trades below the
// prior-session low and closes back inside, strictly above the level (a close exactly at PDL is not inside; a
// wick-only bar that closes below is not a sweep). The window (index <= 17) is the engine's, from the spec.
export const isSweepBar = (bar, pdl) => bar.l < pdl && bar.c > pdl;

// H5 (author): the SWEEP EXTREME at the close of bar k >= s is min(L[s..k]); the EXTREME BAR lambda is the latest
// bar j in [s, k] with L[j] equal to it. The engine keeps calling this until the confirmation bar, then fixes it.
export function sweepExtreme(bars, s, k) {
  let extreme = bars[s].l, lambda = s;
  for (let j = s; j <= k; j++) if (bars[j].l <= extreme) { extreme = bars[j].l; lambda = j; }
  return { extreme, lambda };
}

// H6 (owner, sweep-bos H8 read strictly; author, the first-close rule H9): at the close of bar k, i* is the most
// recent swing high confirmed BEFORE that close (the largest i with i + offset <= k - 1). A BOS occurs when
// C[k] > H[i*] and no earlier bar j with i* < j < k closed above H[i*]. A swing confirmed at bar k itself is not
// structure. Returns { ok, swingIndex, level, reason }.
export function bosAt(bars, k, swing) {
  const swings = swingHighs(bars.slice(0, k + 1), swing);
  const usable = confirmedBy(swings, k - 1, swing.confirmBarOffset);
  if (!usable.length) return { ok: false, swingIndex: null, level: null, reason: 'no confirmed swing high' };
  const i = usable[usable.length - 1];
  const level = bars[i].h;
  for (let j = i + 1; j < k; j++) if (bars[j].c > level) return { ok: false, swingIndex: i, level, reason: 'the swing was already closed above' };
  return bars[k].c > level ? { ok: true, swingIndex: i, level, reason: null } : { ok: false, swingIndex: i, level, reason: 'close not above the swing' };
}

// H8 (standard convention; author: no minimum): the DISPLACEMENT LEG is bars lambda..k, from the extreme bar to
// the break bar; no size, speed or body requirement.
export const displacementLeg = (lambda, k) => ({ from: lambda, to: k });

// H9 (owner: the inequality and the midpoint; author: the latest gap): a bullish FAIR VALUE GAP is a triple
// (a, a+1, a+2) with H[a] < L[a+2]; zone [H[a], L[a+2]]. The eligible gaps lie inside the leg (lambda <= a and
// a + 2 <= k) and the LATEST (largest a) is used; none: null. Height is checked by zoneUsable (H18).
export function bullishFvg(bars, lambda, k) {
  for (let a = k - 2; a >= lambda; a--) {
    if (bars[a].h < bars[a + 2].l) return { type: 'fair_value_gap', index: a, lo: bars[a].h, hi: bars[a + 2].l };
  }
  return null;
}

// H10 (owner: the concept; author: eligibility, the strict close rule, the most-recent tie rule): a bearish FVG
// is a triple (a, a+1, a+2) with L[a] > H[a+2]; zone [H[a+2], L[a]] (upper bound L[a], lower bound H[a+2]). The
// eligible gaps are completed in the session with a + 2 <= maxAgeBars (the session window, 17). Bar v with
// s < v and v >= a + earliestOffset (3) closes fully through a gap when C[v] > L[a]; the gap is then an INVERSION
// FVG read as support; if several eligible gaps are closed through by the same bar, the most recent (largest a)
// is used. Returns the inverted gap or null.
export function bearishFvgs(bars, lastIndex) {
  const out = [];
  const last = Math.min(lastIndex, bars.length - 1);
  for (let a = 0; a + 2 <= last; a++) if (bars[a].l > bars[a + 2].h) out.push({ type: 'inversion_fvg', index: a, lo: bars[a + 2].h, hi: bars[a].l });
  return out;
}
export function inversionAt(bars, v, s, { maxAgeBars, earliestOffset = 3 } = {}) {
  if (!(v > s)) return null;
  const gaps = bearishFvgs(bars, Math.min(maxAgeBars, v));
  for (let g = gaps.length - 1; g >= 0; g--) {
    const gap = gaps[g];
    if (v >= gap.index + earliestOffset && bars[v].c > gap.hi) return gap;
  }
  return null;
}

// H11 (owner: the last opposite-colour candle and the midpoint; standard convention: zone = the bar's range):
// the ORDER BLOCK is the latest bar j <= lambda with C[j] < O[j] (a bearish bar; C = O is neither colour),
// searched back to index 0 of the session. Zone [L[j], H[j]]; none: null.
export function orderBlock(bars, lambda) {
  for (let j = lambda; j >= 0; j--) {
    const b = bars[j];
    if (b.c < b.o) return { type: 'order_block', index: j, lo: b.l, hi: b.h };
  }
  return null;
}

// H12 (standard convention: the last up-close bar before the down move; author: the downward BOS mirror, the
// leg's origin mu, the most-recent rule): at the close of bar b, i_L is the most recent swing low confirmed
// before that close; a DOWNWARD BOS occurs when C[b] < L[i_L] and no earlier bar after i_L closed below it. The
// down leg's origin mu is the latest bar in [i_L, b] with H[mu] = max(H[i_L..b]); mu = i_L means no leg and no
// block. The BEARISH ORDER BLOCK is the latest bar j <= mu with C[j] > O[j], searched back to index 0; zone
// [L[j], H[j]] (upper bound H[j], lower bound L[j]).
export function downwardBosAt(bars, b, swing) {
  const swings = swingLows(bars.slice(0, b + 1), swing);
  const usable = confirmedBy(swings, b - 1, swing.confirmBarOffset);
  if (!usable.length) return { ok: false, swingIndex: null, level: null, reason: 'no confirmed swing low' };
  const i = usable[usable.length - 1];
  const level = bars[i].l;
  for (let j = i + 1; j < b; j++) if (bars[j].c < level) return { ok: false, swingIndex: i, level, reason: 'the swing was already closed below' };
  return bars[b].c < level ? { ok: true, swingIndex: i, level, reason: null } : { ok: false, swingIndex: i, level, reason: 'close not below the swing' };
}
export function bearishOrderBlockAt(bars, b, swing) {
  const bos = downwardBosAt(bars, b, swing);
  if (!bos.ok) return null;
  let mu = bos.swingIndex;
  for (let j = bos.swingIndex; j <= b; j++) if (bars[j].h >= bars[mu].h) mu = j;
  if (mu === bos.swingIndex) return null;
  for (let j = mu; j >= 0; j--) {
    const bar = bars[j];
    if (bar.c > bar.o) return { type: 'breaker', index: j, lo: bar.l, hi: bar.h, breakIndex: b, swingLowIndex: bos.swingIndex, legOriginIndex: mu };
  }
  return null;
}
// H12/H13: the most recent bearish block known at the close of bar f (the block of the latest downward break
// b <= f that produced one); null when there is none.
export function mostRecentBearishBlock(bars, f, swing) {
  for (let b = f; b >= 0; b--) {
    const block = bearishOrderBlockAt(bars, b, swing);
    if (block) return block;
  }
  return null;
}

// H13 (owner: failure by a close through the far bound, the BOS accompaniment, k_bos > s, the midpoint; author:
// the bar limit, either order, the later close): a bearish block FAILS at the close of bar f (s < f) when
// C[f] > H[j], its upper bound; spec 4 also needs an upward BOS (H6) at k_bos with s < k_bos and
// |f - k_bos| <= maxBarsApart (6), either order; the setup is CONFIRMED at the later of the two. The engine
// records the failure and break bars as they happen; this pairs them at the close of bar k: the latest failure
// event whose bar or whose partner break is k and whose distance is within the limit.
export const blockFails = (bar, block) => bar.c > block.hi;
export function breakerCoupling(failEvents, bosBars, k, maxBarsApart) {
  for (let i = failEvents.length - 1; i >= 0; i--) {
    const ev = failEvents[i];
    for (const kb of bosBars) {
      if (Math.max(ev.f, kb) === k && Math.abs(ev.f - kb) <= maxBarsApart) return { f: ev.f, kBos: kb, block: ev.block };
    }
  }
  return null;
}

// H14 (owner: the anchors; author: 0.01 and 0.40 as spec numbers): STOP = ANCHOR - buffer, the anchor being the
// lower of the spec's anchors ("beyond the farther of"); the engine checks stopDistance >= minDistance.
export const stopFrom = (anchors, bufferU) => Math.min(...anchors) - bufferU;

// H15 (owner: limit, midpoint, 11:00, one position; author: rounding down, strictly through, re-arm): ENTRY is
// the zone's midpoint, a half cent rounded DOWN to the cent (the conservative side for a buy); the order is
// placed at the close of the confirmation bar k and needs ENTRY < C[k] (the engine checks); it is good for bars
// k < m <= lastFill and fills on the FIRST such bar with L[m] < ENTRY (strictly through), at ENTRY, also when the
// bar opened below it; null when none fills (order_expired).
export const entryOf = (lo, hi) => Math.floor((lo + hi) / 2 / CENT) * CENT;
export function fillIndex(bars, k, lastFill, entry) {
  const last = Math.min(lastFill, bars.length - 1);
  for (let m = k + 1; m <= last; m++) if (bars[m].l < entry) return m;
  return null;
}

// H16 (owner: stop first, closed by 15:55; author: the fill-bar rule, the gap-through price): on the fill bar m,
// L[m] <= STOP stops the trade at STOP on that bar (the target is not tested on the fill bar). On each later bar
// q (m < q <= n - 2): L[q] <= STOP exits at min(STOP, O[q]) (the stop first, even when H[q] > TARGET on the same
// bar; a gap through the stop exits at the open); else H[q] > TARGET exits at TARGET. Still open after bar n - 2:
// the TIME STOP exits at O[n - 1], the open of the session's last bar. Returns { exitIndex, exit, kind }.
export function simulateExit(bars, m, stop, target) {
  const n = bars.length;
  if (bars[m].l <= stop) return { exitIndex: m, exit: stop, kind: 'stop_same_bar' };
  for (let q = m + 1; q <= n - 2; q++) {
    const b = bars[q];
    if (b.l <= stop) return { exitIndex: q, exit: Math.min(stop, b.o), kind: 'stop' };
    if (b.h > target) return { exitIndex: q, exit: target, kind: 'target' };
  }
  return { exitIndex: n - 1, exit: bars[n - 1].o, kind: 'time' };
}

// H17 (owner): TARGET = ENTRY + rMultiple x stopDistance, fixed at the confirmation close.
export const targetOf = (entry, stopDistance, rMultiple) => entry + Math.round(rMultiple * stopDistance);

// H18 (author): a zone is usable only when its height is at least minHeight (0.05); smaller zones are skipped.
export const zoneUsable = (zone, minHeightU) => zone.hi - zone.lo >= minHeightU;

// H19 (owner: the formula, the 1% maximum, $5,000; author: the cost estimate), PROTOCOL.md 6.1, in whole cents:
// plannedRisk = fraction x cash; sharesRisk = floor(plannedRisk / stopDistance); estimatedCosts =
// 2 x perSide x floor(cash / ENTRY); sharesCash = floor((cash - estimatedCosts) / ENTRY); shares = the smaller.
// shares = 0 is `unfunded`; sharesCash < sharesRisk is `cash_capped` with the actual planned risk recorded. The
// fraction is applied as an exact rational (micro-units), so no floating-point rounding decides a share.
export function sizeTrade({ cashCents, entryCents, stopDistanceCents, perSideCents, maxRiskFraction }) {
  const num = Math.round(maxRiskFraction * 1e6), den = 1e6;
  const sharesRisk = Math.floor((cashCents * num) / (den * stopDistanceCents));
  const estimatedCostsCents = 2 * perSideCents * Math.floor(cashCents / entryCents);
  const sharesCash = Math.floor((cashCents - estimatedCostsCents) / entryCents);
  const shares = Math.max(0, Math.min(sharesRisk, sharesCash));
  return {
    shares, sharesRisk, sharesCash, estimatedCostsCents, unfunded: shares <= 0, cashCapped: shares > 0 && sharesCash < sharesRisk,
    plannedRiskMaxCents: (cashCents * num) / den, plannedRiskActualCents: shares * stopDistanceCents,
  };
}

// H20 (owner): R after costs of c units per side: ((EXIT - c) - (ENTRY + c)) / stopDistance; the cash change at
// the exit is shares x (EXIT - ENTRY - 2 x perSide), in cents.
export const rOf = (entry, exit, stopDistance, cU) => ((exit - cU) - (entry + cU)) / stopDistance;
export const pnlCents = (shares, entryCents, exitCents, perSideCents) => shares * (exitCents - entryCents - 2 * perSideCents);
