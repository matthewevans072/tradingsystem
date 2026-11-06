// The volume profile of entry treatment C (CAMPAIGN-1.md section 6; experimental assumptions): the prior completed
// regular session only (no extended hours, never a developing or same-session profile); bins of 0.1% of that session's
// close, anchored at zero; each 1-minute bar's volume spread evenly across the bins its high-low range covers (an
// approximation from bars, not true volume at price); the point of control (POC) is the highest-volume bin, ties to the
// bin nearest that session's volume-weighted average price, then the lower price; the value area holds 70% of the
// volume, built from the POC by adding the larger adjacent pair of bins (two above against two below) first. High- and
// low-volume nodes and order-flow delta are not used; candle direction is never called buying or selling.
export const VALUE_AREA_SHARE = 0.70;
export const BIN_SHARE = 0.001;

export function sessionProfile(bars, { session, asOfSession }) {
  if (!session || !asOfSession) throw new Error('sessionProfile needs the profile session and the session it is used in');
  if (session >= asOfSession) throw new Error(`a profile of ${session} cannot be used in ${asOfSession}: only a prior completed session's profile is allowed (no developing or same-session profile)`);
  if (!bars?.length) return null;
  const close = bars.at(-1).c;
  const size = close * BIN_SHARE;
  const vol = new Map();
  let pv = 0, tv = 0;
  for (const b of bars) {
    if (!(b.v > 0)) continue;
    const lo = Math.floor(b.l / size), hi = Math.floor(b.h / size);
    const each = b.v / (hi - lo + 1);
    for (let i = lo; i <= hi; i++) vol.set(i, (vol.get(i) || 0) + each);
    pv += (Number.isFinite(b.vw) && b.vw > 0 ? b.vw : (b.h + b.l + b.c) / 3) * b.v;
    tv += b.v;
  }
  if (!(tv > 0)) return null;
  const vwap = pv / tv;
  const keys = [...vol.keys()].sort((a, b) => a - b);
  const center = (i) => (i + 0.5) * size;
  let poc = keys[0];
  for (const i of keys) {
    const v = vol.get(i), best = vol.get(poc);
    if (v > best + 1e-9 || (Math.abs(v - best) <= 1e-9 && (Math.abs(center(i) - vwap) < Math.abs(center(poc) - vwap) - 1e-12 || (Math.abs(Math.abs(center(i) - vwap) - Math.abs(center(poc) - vwap)) <= 1e-12 && i < poc)))) poc = i;
  }
  const total = keys.reduce((a, i) => a + vol.get(i), 0);
  let lo = poc, hi = poc, acc = vol.get(poc);
  const min = keys[0], max = keys.at(-1);
  const v = (i) => vol.get(i) || 0;
  while (acc < VALUE_AREA_SHARE * total - 1e-9 && (lo > min || hi < max)) {
    const up = hi < max ? v(hi + 1) + (hi + 1 < max ? v(hi + 2) : 0) : -1;
    const dn = lo > min ? v(lo - 1) + (lo - 1 > min ? v(lo - 2) : 0) : -1;
    if (up >= dn) { const n = Math.min(2, max - hi); for (let k = 1; k <= n; k++) acc += v(hi + k); hi += n; }
    else { const n = Math.min(2, lo - min); for (let k = 1; k <= n; k++) acc += v(lo - k); lo -= n; }
  }
  return { session, binSize: size, poc: center(poc), pocBin: poc, vah: (hi + 1) * size, val: lo * size, vwap, volume: total, valueShare: acc / total, bins: keys.length };
}
