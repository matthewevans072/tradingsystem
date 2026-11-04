// Hand-built sessions for the ICT Lab engine tests. Prices are invented; every number in OB_DAY, FVG_DAY,
// IFVG_DAY and BREAKER_DAY is checked by hand in tests/ictlab-engine.test.js. Nothing here is market data.
import path from 'node:path';
import { tradingDays } from '../server/strategy/sessions.js';
import { fullCount } from '../server/ictlab/data.js';
import { loadSpec, SPEC_DIR, ROUND1_SPECS } from '../server/ictlab/config.js';

export const bar = (o, h, l, c) => ({ o, h, l, c });
export const flat = (p, range = 0) => ({ o: p, h: p + range / 2, l: p - range / 2, c: p });

// A complete session: flat bars at `base` with the given overrides by index.
export function session(date, { base = 104, overrides = {} } = {}) {
  const n = fullCount(date);
  const bars = [];
  for (let i = 0; i < n; i++) bars.push({ idx: i, ...(overrides[i] ? overrides[i] : flat(base)) });
  return { date, full: n, bars };
}

// `priorCount` complete flat prior sessions, the last with the prior daily bar (PDL = priorDaily.l), then the test
// session built from `overrides`. Returns { daily, sessions, testDate, prevDate, days }.
export function scenario({ overrides, priorDaily = { h: 110, l: 100 }, startDate = '2019-02-01', base = 104, priorCount = 2 }) {
  const days = tradingDays(startDate, '2020-12-31').slice(0, priorCount + 1);
  const sessions = days.slice(0, priorCount).map((d) => session(d, { base }));
  const testDate = days[priorCount];
  sessions.push(session(testDate, { base, overrides }));
  const daily = days.slice(0, priorCount).map((d) => ({ date: d, o: base, h: base + 1, l: base - 1, c: base }));
  daily[priorCount - 1] = { date: days[priorCount - 1], o: base, h: priorDaily.h, l: priorDaily.l, c: base };
  return { daily, sessions, testDate, prevDate: days[priorCount - 1], days };
}

// The four pinned specs, loaded from the repository (their pins are checked by loadSpec).
export const SPECS = Object.fromEntries(ROUND1_SPECS.map((f) => [f, loadSpec(path.join(SPEC_DIR, f))]));
export const FVG_SPEC = SPECS['ict-sweep-bos-fvg-0.1.0.json'];
export const OB_SPEC = SPECS['ict-sweep-bos-ob-0.1.0.json'];
export const IFVG_SPEC = SPECS['ict-ifvg-0.1.0.json'];
export const BREAKER_SPEC = SPECS['ict-breaker-0.1.0.json'];

// Prior session PDL 100. Sweep at bar 0 (low 99.5, close 100.5), swing high at bar 2 (103.0, confirmed at the
// close of bar 5), BOS at bar 6 (close 103.2 > 103.0), leg low at bar 0 (99.5), order block = bar 0 (bearish,
// zone [99.5, 101.5], midpoint entry 100.50), no fair value gap in the leg. Stop 99.5 - 0.01 = 99.49 (distance
// 1.01); target 100.50 + 2.02 = 102.52. Fill at bar 7 (low 100.4 < 100.50), target at bar 8 (high 104 > 102.52).
// Sizing: cash 5,000: sharesRisk floor(50 / 1.01) = 49; costs 0.04 x floor(5000 / 100.5) = 1.96; sharesCash
// floor(4998.04 / 100.5) = 49; shares 49, not cash-capped; P/L 49 x (102.52 - 100.50 - 0.04) = 97.02.
export const OB_DAY = {
  0: bar(101, 101.5, 99.5, 100.5), 1: bar(100.5, 102, 100.2, 101.5), 2: bar(101.5, 103, 101, 102.5), 3: bar(102.5, 102.8, 101.8, 102),
  4: bar(102, 102.4, 101.5, 101.7), 5: bar(101.7, 102, 101.2, 101.9), 6: bar(101.9, 103.5, 101.8, 103.2), 7: bar(103.2, 103.4, 100.4, 102),
  8: bar(102, 104, 101.6, 103.5),
};
// As OB_DAY, but bar 6 opens and dips only to 102.6, leaving a bullish fair value gap between bar 4's high
// (102.4) and bar 6's low (102.6): zone [102.4, 102.6] (height 0.20), entry 102.50, stop 99.49 (distance 3.01),
// target 102.50 + 6.02 = 108.52; fill at bar 7 (low 100.4), target at bar 9 (high 110.5).
export const FVG_DAY = { ...OB_DAY, 6: bar(102.6, 103.5, 102.6, 103.2), 9: bar(103.5, 110.5, 103, 109) };
// Spec 3: a bearish fair value gap at a = 0 (bar 0's low 103 above bar 2's high 102.4: zone [102.4, 103]); bar 3
// sweeps PDL 100 (low 99.6, close 100.4); bar 6 closes at 103.4, strictly above the gap's upper bound 103: the
// inversion at v = 6 (v > s = 3, v >= a + 3). Entry = midpoint 102.70 < 103.4; stop = min(102.4, 99.6) - 0.01 =
// 99.59 (distance 3.11); target 102.70 + 6.22 = 108.92. Fill at bar 7 (low 102.6 < 102.70); no stop or target on
// the flat bars after it: the time stop at the open of the last bar (104). Bar 3's high (101.9) is at or above bar
// 1's low (101.8), so no second bearish gap exists.
export const IFVG_DAY = {
  0: bar(104, 104.5, 103, 103.2), 1: bar(103.2, 103.3, 101.8, 102), 2: bar(102, 102.4, 100.5, 100.8), 3: bar(100.8, 101.9, 99.6, 100.4),
  4: bar(100.4, 101.5, 100.2, 101.2), 5: bar(101.2, 102.5, 101, 102.3), 6: bar(102.3, 103.6, 102.1, 103.4), 7: bar(103.4, 103.8, 102.6, 103),
};
// Spec 4: swing low at bar 1 (102.0, confirmed at the close of bar 4); bar 5 closes at 101.5, below it: a
// downward BOS at b = 5; the down leg's origin is bar 3 (the highest high 104.2 in bars 1..5); the bearish order
// block is bar 3 (bullish, zone [103.2, 104.2]). Bar 6 sweeps PDL 100 (low 99.7, close 100.6). Swing high at bar 3
// (104.2, confirmed at the close of bar 6). Bar 9 closes at 104.4: above the block's upper bound 104.2 (the
// failure, f = 9) and above the swing high (the upward BOS, k_bos = 9 > s): confirmed at k = 9. Entry = midpoint
// 103.70 < 104.4; stop = min(103.2, 99.7) - 0.01 = 99.69 (distance 4.01); target 103.70 + 8.02 = 111.72. Fill at
// bar 10 (low 103.5); bar 11 trades down to 99.5: the stop at 99.69 (the bar opened above it). Sizing: sharesRisk
// floor(50 / 4.01) = 12, sharesCash 48; shares 12; P/L 12 x (99.69 - 103.70 - 0.04) = -48.60, beyond the planned
// risk of 12 x 4.01 = 48.12 (costs).
export const BREAKER_DAY = {
  0: bar(103, 103.4, 102.4, 102.6), 1: bar(102.6, 103, 102.0, 102.3), 2: bar(102.3, 103.8, 102.2, 103.6), 3: bar(103.6, 104.2, 103.2, 104.0),
  4: bar(104.0, 104.1, 102.8, 103.0), 5: bar(103.0, 103.1, 101.0, 101.5), 6: bar(101.5, 101.7, 99.7, 100.6), 7: bar(100.6, 102.0, 100.4, 101.8),
  8: bar(101.8, 103.0, 101.6, 102.8), 9: bar(102.8, 104.5, 102.6, 104.4), 10: bar(104.4, 104.6, 103.5, 104.0), 11: bar(104.0, 104.3, 99.5, 100),
};

// Shift a day's bars by `by` indices (a later sweep).
export function shifted(day, by) {
  const out = {};
  for (const [k, v] of Object.entries(day)) out[Number(k) + by] = v;
  return out;
}
