# Campaign 3: experiment 180 (B0, 20-day channel breakout) against experiment 191 (M1 n=3, three down closes in an uptrend)

Written 2026-11-05 from stored results only (`data/research-runner.sqlite`, campaign 3; nothing re-run). **measured** = stored with the experiment by the engine; **derived** = computed here from stored series or stored figures; **not stored** = no stored figure exists and none was recomputed. Both are development results on data looked at before (CAMPAIGN-3.md section 3); neither is a candidate. No bar, price or per-fill list appears here.

## 1. Headline (measured)

| Figure | 180 B0 | 191 M1 n=3 |
|---|---|---|
| Net P/L after costs | $8396.06 | $5812.61 |
| Ending equity on US$15,000 | $23396.06 | $20812.61 |
| Average exposure (invested fraction, mean over closes) | 43.1% | 20.1% |
| Total costs (spread, slippage, fees) | $330.37 | $1435.49 |
| Maximum drawdown | 13.56% ($2223.52) | 13.58% ($2315.30) |
| Completed trades (+ open at the end) | 148 (+5) | 321 (+1) |
| Trades whose realised loss exceeded the planned 1% risk | 21 | 43 |
| Top stock's share of gross gain (derived) | TSLA 37.6% | META 23.3% |
| Best-5% stress: net with the top K outcomes removed (derived) | K = 8: -$967.01 | K = 17: $1893.27 |
| Random-timing null: raw p / Holm-adjusted p (derived) | 0.3293 / 1.0000 | 0.1689 / 1.0000 |
| Null items (trades + open) / unplaceable items (measured) | 153 / 0 | 322 / 0 |
| Null: trade-timing P/L of the run vs the resample median and 95th percentile (derived) | $8196.12 vs $6506.40 / $13033.49 | $5731.01 vs $2172.61 / $8315.99 |
| Eligible sessions per stock (measured; the mechanism's levels defined) | MU 1070, AMZN 1070, META 1070, TSLA 1070, VST 1070, GOOG 1070, INTC 1070, CSCO 1070, PYPL 1070, SNAP 1070 | MU 1070, AMZN 1070, META 1070, TSLA 1070, VST 970, GOOG 1070, INTC 1070, CSCO 1070, PYPL 1070, SNAP 1018 |

## 2. Net P/L by calendar year (derived from the stored equity curves: the last close of each year minus the last close of the previous year; 2017 from the US$15,000 start)

| Year | 180 B0 equity at year end | 180 B0 net for the year | 191 M1 equity at year end | 191 M1 net for the year | Equal-weight index at year end (stored index series) | 180 exposure-matched hold at year end (derived) | 191 exposure-matched hold at year end (derived) | 180 mean invested in the year | 191 mean invested in the year |
|---|---|---|---|---|---|---|---|---|---|
| 2017 (2017-10-02 to 2017-12-29) | $15426.73 | $426.73 | $15615.46 | $615.46 | $16143.86 | $15366.85 | $15079.36 | 49.2% | 24.4% |
| 2018 (2018-01-02 to 2018-12-31) | $14211.95 | -$1214.78 | $15827.36 | $211.90 | $16005.34 | $13877.50 | $14750.61 | 39.6% | 20.4% |
| 2019 (2019-01-02 to 2019-12-31) | $17102.13 | $2890.18 | $16038.84 | $211.48 | $21424.08 | $15548.28 | $14256.67 | 44.8% | 17.8% |
| 2020 (2020-01-02 to 2020-12-31) | $20230.12 | $3127.99 | $17615.00 | $1576.16 | $44994.55 | $18724.95 | $15598.82 | 33.8% | 16.2% |
| 2021 (2021-01-04 to 2021-12-31) | $23396.06 | $3165.94 | $20812.61 | $3197.61 | $55860.57 | $19681.61 | $16729.10 | 52.8% | 24.9% |

Check of the derivation (derived against measured): the exposure-matched hold derived from the stored series ends at $19681.61 for 180 and $16729.10 for 191; the stored summary figures are $19681.61 and $16729.10.

## 3. Per-stock P/L and gross-gain share (measured P/L from the stored perStock block; shares derived from the stored gross-gain block: share = max(0, P(s)) / G)

| Stock | 180 B0 signals / entries | 180 B0 P/L | 180 B0 share of gross gain | 191 M1 signals / entries | 191 M1 P/L | 191 M1 share of gross gain |
|---|---|---|---|---|---|---|
| MU | 18 / 17 | $1491.22 | 15.4% | 32 / 32 | $1337.04 | 19.9% |
| AMZN | 108 / 6 | $423.67 | 4.4% | 42 / 39 | $1363.67 | 20.3% |
| META | 21 / 15 | $605.91 | 6.3% | 43 / 41 | $1561.27 | 23.3% |
| TSLA | 53 / 12 | $3634.88 | 37.6% | 30 / 28 | $1079.49 | 16.1% |
| VST | 21 / 20 | -$42.85 | 0.0% | 25 / 25 | -$53.64 | 0.0% |
| GOOG | 58 / 15 | $1083.85 | 11.2% | 43 / 40 | $836.12 | 12.5% |
| INTC | 20 / 20 | -$977.10 | 0.0% | 30 / 28 | -$734.75 | 0.0% |
| CSCO | 19 / 18 | -$27.23 | 0.0% | 25 / 25 | $351.84 | 5.2% |
| PYPL | 25 / 17 | -$212.05 | 0.0% | 33 / 33 | $183.52 | 2.7% |
| SNAP | 16 / 13 | $2415.75 | 25.0% | 31 / 31 | -$111.95 | 0.0% |
| **Gross gain G (sum of positive P(s))** | | $9655.28 | winners 6 | | $6712.95 | winners 7 |

Decision-time skips by code per stock are stored in the same block (not repeated here); fill-time cancellations and rejections per stock are stored (`cancellations`, `rejections`).

## 4. Benchmarks (derived, stored with each experiment)

| Benchmark | 180 B0 | 191 M1 n=3 |
|---|---|---|
| Equal-weight index of the same ten stocks (benchmark (a); the same for every run): end / net / annualised / max drawdown | $55860.57 / $40860.57 / 36.29% / 35.06% | $55860.57 / $40860.57 / 36.29% / 35.06% |
| The run's own exposure-matched hold (benchmark (c)): end / net / annualised / max drawdown | $19681.61 / $4681.61 / 6.61% / 16.52% | $16729.10 / $1729.10 / 2.60% / 18.45% |
| HXR whole-share hold arm | not stored (not computed in the research runner) | not stored |
| Against the fixed baseline (+$1757.90): difference / exposure part / decision part | $6638.16 / $3515.33 / $3122.83 | $4054.71 / $562.82 / $3491.89 |
| Against the family baseline: difference / exposure part / decision part | (180 is the family baseline B0) | vs M0 (#190): $1023.12 / -$731.53 / $1754.65 |

## 5. The "decisions" attribution, exactly as coded (quoted from `server/research/runner.js`, line numbers of the committed file)

```js
189: out.diffUsd = round2(summary.net - b.net);
194: out.exposureGainUsd = round2(summary.exposureMatched.net - b.exposureMatched.net);
195: out.decisionGainUsd = round2(out.diffUsd - out.exposureGainUsd);
178: const exposureGainUsd = summary.exposureMatched && ref.summary.exposureMatched ? round2(summary.exposureMatched.net - ref.summary.exposureMatched.net) : null;
179: return { id: ref.id, name: ref.name ?? null, net: ref.summary.net, diffUsd, exposureGainUsd, decisionGainUsd: exposureGainUsd == null ? null : round2(diffUsd - exposureGainUsd) };
```
In words: the exposure part is the difference between the two runs' exposure-matched holds (benchmark (c): the equal-weight index's daily return scaled by each run's own invested fraction of the previous session; `server/rangetrend/metrics.js` `exposureMatched`), and the decision part is whatever remains of the net difference. "Decisions" therefore means everything the exposure-matched hold does not explain: stock selection, entry and exit timing, sizing within the exposure, costs and dividends. It is a residual, not a measurement of skill.

## 6. Interpretation of the null check, written before the null tests ran (the owner's rule of 2026-11-05)

The random-timing null is checked in `tests/research-null.test.js` on synthetic markets, with the expected behaviour in each test name: (a) a market with no structure and random entries over 200 seeds gives p-values spread roughly uniformly with about one in twenty below 0.05; (b) entries planted immediately before built-in rises give p near 1/(R+1); (c) a drifting market whose only edge is holding longer gives no detection, because holding length is kept and the exit moves with the entry. A fourth, recorded as a property and not as a pass/fail of the owner's expectation, checks that price-selected exits with random entries are detected, because the realised exit prices enter the statistic.

- **If the null behaves (a, b and c hold):** M1's raw p of 0.169 (Holm-adjusted 1.000) means this diagnostic did not distinguish M1's trade timing from random placement of the same trades. It does not establish that the strategy has no edge: the null ignores cash, caps, overlapping positions and same-day sharing, it credits nothing to holding length or exposure, and with 322 items its power against a small timing edge is limited. The shortlist verdicts of campaigns 2 and 3 stand as written.
- **If the null misbehaves (any of a, b or c fails):** no stored result and no acceptance rule changes. Every shortlist verdict in campaigns 2 and 3 that depended on the null, that is every experiment that cleared the target (campaign 2: experiments 93, 95, 96, 102, 107, 108, 112, 121, 122, 124, 125, 126, 137, 138, 149, 169, 170, 171, 173, 175; campaign 3: 180, 181, 182, 183, 186, 187, 188, 191, 194), is listed as "flagged for reassessment" here and in research log entry 8, and the work stops there; the reassessment is the owner's separate message.

## 7. Outcome of the null check (tests run 2026-11-05 after section 6 was written; measured on synthetic markets)

`tests/research-null.test.js`: 5 of 5 pass. (a) 200 seeds, 200 resamples each: fractions of p below 0.05 / 0.25 / 0.5 / 0.75 = 0.075 / 0.275 / 0.545 / 0.73 (uniform would give 0.05 / 0.25 / 0.5 / 0.75; the 0.05 bin's binomial standard error at n = 200 is 0.015); smallest p 0.0050, largest 1.0000. (b) three seeds, entries planted before eight built-in rises: p = 0.0050 in each, exactly 1/(R + 1). (c) a market drifting 0.3% a session, random entries held 20 sessions, 60 seeds: fraction below 0.05 = 0.05, below 0.5 = 0.483, median p 0.517 (not detected, as expected: holding length is kept). (c, recorded property) price-selected exits with random entries: detected in 30 of 30 seeds.

**The null behaves.** By the rule of section 6: M1's raw p of 0.169 (Holm-adjusted 1.000) means this diagnostic did not distinguish M1's trade timing from random placement of the same trades; it does not establish that the strategy has no edge; **the shortlist verdicts of campaigns 2 and 3 stand as written.** Nothing is flagged for reassessment. Stored unplaceable items: 0 of 153 for experiment 180, 0 of 322 for experiment 191 (measured).

The limitations the checks illustrate are in `NULL-DIAGNOSTIC-NOTES.md`: the diagnostic credits nothing to holding length or exposure (B0's 43% exposure and M1's long-held winners are judged only by where they were placed), it detects price-selected exits as timing, and it ignores cash, caps, overlapping positions and same-day sharing.

