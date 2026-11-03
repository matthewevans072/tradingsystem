// Hand-built sessions for the sweep-bos engine tests. Prices are invented; every number in LONG_DAY, FVG_DAY,
// SECOND_SWING_DAY and SHORT_DAY is checked by hand in tests/sweepbos-engine.test.js. Nothing here is market data.
import { tradingDays } from '../server/strategy/sessions.js';
import { fullCount } from '../server/sweepbos/data.js';

export const bar = (o, h, l, c) => ({ o, h, l, c });
export const flat = (p, range = 0) => ({ o: p, h: p + range / 2, l: p - range / 2, c: p });

// A complete session: flat bars at `base`, the first hour (index 0..11) with a range of 0.2 (so the buffer of
// 20 such sessions is 0.20), and the given overrides by index.
export function session(date, { base = 104, firstHourRange = 0.2, overrides = {} } = {}) {
  const n = fullCount(date);
  const bars = [];
  for (let i = 0; i < n; i++) bars.push({ idx: i, ...(overrides[i] ? overrides[i] : i <= 11 ? flat(base, firstHourRange) : flat(base)) });
  return { date, full: n, bars };
}

// 21 complete prior sessions (the buffer's 20 and the prior session), the prior session's daily bar with
// PDH/PDL, then the test session built from `overrides`. Daily bars of the other prior sessions are flat
// unless `dailyHL` gives [h, l] per prior session (for bias tests).
export function scenario({ overrides, priorDaily = { h: 110, l: 100 }, startDate = '2019-02-01', base = 104, priorCount = 21, dailyHL = null }) {
  const days = tradingDays(startDate, '2020-12-31').slice(0, priorCount + 1);
  const sessions = days.slice(0, priorCount).map((d) => session(d, { base }));
  const testDate = days[priorCount];
  sessions.push(session(testDate, { base, overrides }));
  const daily = days.slice(0, priorCount).map((d, i) => ({ date: d, o: base, h: dailyHL ? dailyHL[i][0] : base + 1, l: dailyHL ? dailyHL[i][1] : base - 1, c: base }));
  daily[priorCount - 1] = { date: days[priorCount - 1], o: base, h: priorDaily.h, l: priorDaily.l, c: base };
  return { daily, sessions, testDate, prevDate: days[priorCount - 1], days };
}

export const variant = (zone, stop, bias) => ({ name: `t-${zone}-${stop}-${bias}`, zone, stop, bias });

// Prior session PDH 110 / PDL 100. Sweep at bar 0, swing high at bar 2 (103.0, confirmed at the close of bar 5),
// BOS at bar 6 (close 103.2), leg low at bar 0 (99.5), order block = bar 0 (entry 101.5), no fair value gap,
// no confirmed swing low at bar 6. Stop A = 99.5 - 0.20 = 99.30 (risk 2.20); target 110. Fill at bar 7
// (low 101.4), target hit at bar 9 (high 110.5).
export const LONG_DAY = {
  0: bar(101, 101.5, 99.5, 100.5), 1: bar(100.5, 102, 100.2, 101.5), 2: bar(101.5, 103, 101, 102.5), 3: bar(102.5, 102.8, 101.8, 102),
  4: bar(102, 102.4, 101.5, 101.7), 5: bar(101.7, 102, 101.2, 101.9), 6: bar(101.9, 103.5, 101.8, 103.2), 7: bar(103.2, 103.4, 101.4, 102),
  8: bar(102, 104, 101.6, 103.5), 9: bar(103.5, 110.5, 103, 109),
};
// As LONG_DAY, but bar 6 opens and dips only to 102.6, leaving a fair value gap between bar 4's high (102.4) and
// bar 6's low (102.6): entry 102.6, stop A 99.30 (risk 3.30), target 110.
export const FVG_DAY = { ...LONG_DAY, 6: bar(102.6, 103.5, 102.6, 103.2) };
// Two confirmed swing lows by the BOS close: lows at bar 2 (99.8) and bar 6 (100.2); swing high at bar 4
// (101.8), BOS at bar 9 (close 102.1); order block = bar 0 (entry 101.5); stop B = 99.8 - 0.01 = 99.79
// (risk 1.71); fill at bar 10 (low 101.3); no stop or target afterwards: time stop at the last bar's open (104).
export const SECOND_SWING_DAY = {
  0: bar(101, 101.5, 99.5, 100.5), 1: bar(100.5, 101.2, 100, 100.8), 2: bar(100.8, 101, 99.8, 100.6), 3: bar(100.6, 101.4, 100.3, 101.2),
  4: bar(101.2, 101.8, 100.9, 101.6), 5: bar(101.6, 101.7, 100.5, 100.9), 6: bar(100.9, 101.3, 100.2, 100.7), 7: bar(100.7, 101.5, 100.6, 101.3),
  8: bar(101.3, 101.9, 101, 101.7), 9: bar(101.7, 102.3, 101.4, 102.1), 10: bar(102.1, 102.2, 101.3, 101.6),
};
// The short mirror: sweep of PDH 110 at bar 0 (high 110.5, close 109.5), swing low at bar 2 (107.0), BOS at bar 6
// (close 106.8), leg high at bar 0, order block = bar 0 (entry 108.5), stop A 110.5 + 0.20 = 110.70 (risk 2.20),
// target PDL 100; fill at bar 7 (high 108.6), target at bar 9 (low 99.5).
export const SHORT_DAY = {
  0: bar(109, 110.5, 108.5, 109.5), 1: bar(109.5, 109.8, 108, 108.5), 2: bar(108.5, 109, 107, 107.5), 3: bar(107.5, 108.2, 107.2, 108),
  4: bar(108, 108.5, 107.6, 108.3), 5: bar(108.3, 108.8, 108, 108.1), 6: bar(108.1, 108.2, 106.5, 106.8), 7: bar(106.8, 108.6, 106.6, 108),
  8: bar(108, 108.4, 106, 106.5), 9: bar(106.5, 107, 99.5, 101),
};

// Daily [h, l] for 21 prior sessions giving a LONG bias (rising confirmed swing highs 11 -> 16 and lows 12 -> 17)
// with the prior session as a wide bar 110/100.
export const RISING_DAILY = [[105, 100], [104, 99], [107, 101], [109, 103], [108, 102], [106, 100.5], [110, 104], [112, 105], [111, 104.5], [110, 103], [113, 105], [114, 106], [113, 105], [115, 107], [116, 108], [117, 109], [118, 110], [117, 109], [119, 111], [118, 110], [110, 100]];
export const FALLING_DAILY = RISING_DAILY.map(([h, l], i) => (i === RISING_DAILY.length - 1 ? [110, 100] : [230 - l, 230 - h]));
