# Research runner, campaign 3: results (CAMPAIGN-3.md; development data only; nothing validated)

Written 2026-11-05 from `data/research-runner.sqlite` (not in git). A development campaign on data looked at before (CAMPAIGN-3.md section 3: 127 runs and 105 distinct rule-sets before this campaign). Every result is a **development result**; an **unadjusted shortlist pass** and a **Holm-significant (within-campaign)** result are separate labels (section 6); "independently evaluated" is never set by the runner. **measured** = stored with the experiment by the engine; **derived** = benchmarks, ratios, the best-5% stress and the random-timing null. No bar, price or per-fill list is in this file. No order, no broker, no delivery outside the app.

## 1. Campaign status and provenance (measured)

| Item | Value |
|---|---|
| Plan / document | campaign-3 / CAMPAIGN-3.md, SHA-256 8389c531a136e4697e24d1975fda9fe8df35e3a3e5069cbe8656efe4af7e3011 (frozen at creation) |
| Status / stop reason | done / every planned experiment has run (24 done, 0 failed) |
| Experiments | 24 queued in all: 24 done, 0 failed, 0 cancelled, 0 still queued; defect replacements used 0 of 6 |
| Budget used | 24 of 30 configurations (24 planned); 44.3 s of worker time of 2 h |
| Started / finished | 2026-11-05T17:51:56.384Z / 2026-11-05T17:52:43.150Z |
| Code revision / engines | rr-code-2026-11-05-1 / rt-engine-3; rt-code-2026-11-02-1; rr-mech-1; rr-runner-2 |
| Data / symbols / calibration hashes | bb76c910ed720a1aece2276c9d676a59369ee8a8710549e73d57f7113b3624f2 / dcc35cb32bbcdd9b16bee0c789f5752915e01088fdddcae3339beb8f574a6619 / e80c8ea1423b9d1f013b513d8ba37ed8943a501e74c813c0d665f57dbc93f371 |
| Period | 2017-10-02 to 2021-12-31, warm-up from 2016-01-04, basket A |
| Null | 20000 resamples, seed 20261105, raw p at most 0.05; Holm family 24 at alpha 0.05 (reported, not enforced) |

## 2. The fixed baseline (measured) and its reproduction

Experiment 179, rt-trend-immediate-nolimit-0.2.0: net profit $1757.90 (expected $1757.90; difference $0.00), max drawdown 7.28%, 51 completed trades, average invested 12.2%. The 10% target is net profit of at least $1933.69. Benchmarks (derived): the equal-weight index ends at $55860.57 (net $40860.57, max drawdown 35.06%); the baseline's exposure-matched hold nets $1166.28.

**Family baselines (measured):** B0: net $8396.06, drawdown 13.56%, 148 trades, exposure 43.1%, exposure-matched hold net $4681.61; M0: net $4789.49, drawdown 23.99%, 1190 trades, exposure 30.5%, exposure-matched hold net $2460.63.

## 3. Result table (every experiment; measured unless marked derived)

Net = net profit after costs; vs base = difference from the fixed baseline (derived) with the ratio; vs family = difference from the family baseline B0 or M0 (derived) with its exposure / decision parts; DD = maximum drawdown; Exp = average invested fraction; Top = the top stock's share of gross gain (derived); p raw and Holm p (derived; Holm over the family of 24); loss>risk = trades whose realised loss exceeded the planned 1% risk (measured); Failed = criteria not met (imp = 10% improvement, dd = drawdown, tr = trades, acc = accounting, dq = data quality, st = stress, null = raw p, conc = concentration, dec = decision gain).

| # | Stage | Experiment | Status | Net | vs base | vs family (exposure / decisions) | DD | Exp | Costs | Trades (+open) | loss>risk | Top | p raw | Holm p | Labels | Failed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 179 | reference | rt-trend-immediate-nolimit-0.2.0 | done | $1757.90 | $0.00 (0.0%) | n/a | 7.28% | 12.2% | $227.84 | 51+1 | 0 | SNAP 66% | 0.4913 | 1.0000 | dev | imp, st, null, conc, dec |
| 180 | family baselines | B0 | done | $8396.06 | $6638.16 (377.6%) | n/a | 13.56% | 43.1% | $330.37 | 148+5 | 21 | TSLA 38% | 0.3293 | 1.0000 | dev | st, null |
| 190 | family baselines | M0 | done | $4789.49 | $3031.59 (172.5%) | n/a | 23.99% | 30.5% | $4738.64 | 1190+2 | 126 | META 26% | 0.2450 | 1.0000 | dev | st, dd, null |
| 181 | mechanisms | B1 entry=40 | done | $7030.79 | $5272.89 (299.9%) | -$1365.27 ($707.56 / -$2072.83) | 12.91% | 33.6% | $233.52 | 108+3 | 8 | TSLA 37% | 0.2966 | 1.0000 | dev | st, null |
| 182 | mechanisms | B1 entry=55 | done | $7801.01 | $6043.11 (343.8%) | -$595.05 ($454.97 / -$1050.02) | 13.24% | 32.5% | $224.32 | 104+3 | 8 | TSLA 39% | 0.2110 | 1.0000 | dev | st, null |
| 183 | mechanisms | B1 entry=100 | done | $3364.19 | $1606.29 (91.4%) | -$5031.87 (-$1449.88 / -$3581.99) | 8.61% | 25.9% | $180.09 | 85+3 | 5 | TSLA 32% | 0.5213 | 1.0000 | dev | st, null, dec |
| 184 | mechanisms | B2 ratio=0.7 | done | -$583.43 | -$2341.33 (-133.2%) | -$8979.49 (-$3446.80 / -$5532.69) | 14.19% | 14.3% | $282.61 | 71 | 25 | PYPL 30% | 0.8119 | 1.0000 | dev | imp, st, null, dec |
| 185 | mechanisms | B2 ratio=0.8 | done | $1542.94 | -$214.96 (-12.2%) | -$6853.12 (-$1877.26 / -$4975.86) | 15.69% | 22.1% | $427.92 | 108+1 | 31 | TSLA 59% | 0.6680 | 1.0000 | dev | imp, st, dd, null, conc, dec |
| 186 | mechanisms | B2 ratio=0.9 | done | $3522.54 | $1764.64 (100.4%) | -$4873.52 ($76.29 / -$4949.81) | 13.26% | 30.9% | $603.21 | 147+1 | 42 | TSLA 42% | 0.5799 | 1.0000 | dev | st, null, conc, dec |
| 187 | mechanisms | B3 entry=250 sma=50 | done | $2418.61 | $660.71 (37.6%) | -$5977.45 (-$1419.71 / -$4557.74) | 14.72% | 26.7% | $190.50 | 70+2 | 10 | TSLA 26% | 0.7198 | 1.0000 | dev | st, null, dec |
| 188 | mechanisms | B3 entry=120 sma=50 | done | $4451.29 | $2693.39 (153.2%) | -$3944.77 (-$59.38 / -$3885.39) | 11.70% | 31.6% | $196.43 | 79+3 | 9 | TSLA 24% | 0.5137 | 1.0000 | dev | st, null, dec |
| 189 | mechanisms | B3 entry=250 sma=100 | done | $1493.51 | -$264.39 (-15.0%) | -$6902.55 (-$1745.71 / -$5156.84) | 11.77% | 23.6% | $89.85 | 44+2 | 5 | PYPL 38% | 0.8794 | 1.0000 | dev | imp, st, null, dec |
| 191 | mechanisms | M1 down=3 | done | $5812.61 | $4054.71 (230.7%) | $1023.12 (-$731.53 / $1754.65) | 13.58% | 20.1% | $1435.49 | 321+1 | 43 | META 23% | 0.1689 | 1.0000 | dev | null |
| 192 | mechanisms | M1 down=4 | done | $914.94 | -$842.96 (-48.0%) | -$3874.55 (-$2447.21 / -$1427.34) | 9.78% | 8.1% | $503.41 | 123 | 21 | MU 39% | 0.5029 | 1.0000 | dev | imp, st, null |
| 193 | mechanisms | M1 down=5 | done | $257.51 | -$1500.39 (-85.3%) | -$4531.98 (-$2319.57 / -$2212.41) | 7.06% | 3.8% | $267.73 | 65 | 9 | MU 32% | 0.5430 | 1.0000 | dev | imp, st, null, dec |
| 194 | mechanisms | M1 down=4 nofilter | done | $2631.89 | $873.99 (49.7%) | -$2157.60 (-$220.47 / -$1937.13) | 14.07% | 14.3% | $925.90 | 221 | 33 | MU 32% | 0.4326 | 1.0000 | dev | st, null, dec |
| 195 | mechanisms | M2 k=1.5 | done | $3516.22 | $1758.32 (100.0%) | -$1273.27 (-$968.52 / -$304.75) | 26.19% | 23.1% | $724.50 | 149 | 27 | SNAP 39% | 0.5073 | 1.0000 | dev | st, dd, null |
| 196 | mechanisms | M2 k=2 | done | $3436.69 | $1678.79 (95.5%) | -$1352.80 (-$540.94 / -$811.86) | 24.79% | 18.9% | $541.80 | 113 | 25 | SNAP 38% | 0.4506 | 1.0000 | dev | st, dd, null |
| 197 | mechanisms | M2 k=2.5 | done | -$396.02 | -$2153.92 (-122.5%) | -$5185.51 (-$3845.46 / -$1340.05) | 24.88% | 12.0% | $265.38 | 68 | 18 | PYPL 60% | 0.7929 | 1.0000 | dev | imp, st, dd, null, conc |
| 198 | mechanisms | M2 k=2 nofilter | done | $4882.33 | $3124.43 (177.7%) | $92.84 ($2350.78 / -$2257.94) | 29.44% | 33.7% | $975.84 | 205 | 49 | MU 32% | 0.5651 | 1.0000 | dev | st, dd, null, dec |
| 199 | mechanisms | M3 gap=1 | done | $870.97 | -$886.93 (-50.5%) | -$3918.52 (-$1996.58 / -$1921.94) | 12.36% | 11.0% | $601.97 | 200 | 37 | TSLA 33% | 0.5634 | 1.0000 | dev | imp, st, null, dec |
| 200 | mechanisms | M3 gap=1.5 | done | -$963.01 | -$2720.91 (-154.8%) | -$5752.50 (-$3692.45 / -$2060.05) | 12.63% | 6.4% | $264.36 | 90 | 25 | GOOG 42% | 0.8236 | 1.0000 | dev | imp, st, null, conc, dec |
| 201 | mechanisms | M3 gap=2 | done | -$2151.01 | -$3908.91 (-222.4%) | -$6940.50 (-$3573.67 / -$3366.83) | 16.33% | 4.7% | $123.45 | 50 | 23 | GOOG 57% | 0.9619 | 1.0000 | dev | imp, st, dd, null, conc, dec |
| 202 | mechanisms | M3 gap=1.5 nofilter | done | $248.83 | -$1509.07 (-85.8%) | -$4540.66 (-$3559.93 / -$980.73) | 16.89% | 10.0% | $424.28 | 141 | 37 | TSLA 81% | 0.6709 | 1.0000 | dev | imp, st, dd, null, conc |

## 4. Candidates and the statistical accounting (derived)

Clear the target: **9**. Unadjusted shortlist passes: **0**. Holm-significant within the campaign: **0**. Of 24 experiments with a p, 0 pass the raw screen against 1.2 expected by chance at 0.05; family m = 24. Cumulative looks at this data after this campaign: 151 runs, 128 distinct rule-sets.

| # | Experiment | Net | vs base | Exposure / decisions vs base | DD | Trades | Top | p raw | Holm p | Stress net | Unadjusted shortlist | Holm-significant | Failed for the shortlist |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 180 | B0 | $8396.06 | $6638.16 (377.6%) | $3515.33 / $3122.83 | 13.56% | 148 | TSLA 37.6% | 0.3293 | 1.0000 | -$967.01 | no | no | stress, nullTest |
| 182 | B1 entry=55 | $7801.01 | $6043.11 (343.8%) | $3970.30 / $2072.81 | 13.24% | 104 | TSLA 38.8% | 0.2110 | 1.0000 | $1020.06 | no | no | stress, nullTest |
| 181 | B1 entry=40 | $7030.79 | $5272.89 (299.9%) | $4222.89 / $1050.00 | 12.91% | 108 | TSLA 36.7% | 0.2966 | 1.0000 | $705.32 | no | no | stress, nullTest |
| 191 | M1 down=3 | $5812.61 | $4054.71 (230.7%) | $562.82 / $3491.89 | 13.58% | 321 | META 23.3% | 0.1689 | 1.0000 | $1893.27 | no | no | nullTest |
| 188 | B3 entry=120 sma=50 | $4451.29 | $2693.39 (153.2%) | $3455.95 / -$762.56 | 11.70% | 79 | TSLA 24.3% | 0.5137 | 1.0000 | $1017.62 | no | no | stress, nullTest, decisionGain |
| 186 | B2 ratio=0.9 | $3522.54 | $1764.64 (100.4%) | $3591.62 / -$1826.98 | 13.26% | 147 | TSLA 42.4% | 0.5799 | 1.0000 | -$3534.36 | no | no | stress, nullTest, concentration, decisionGain |
| 183 | B1 entry=100 | $3364.19 | $1606.29 (91.4%) | $2065.45 / -$459.16 | 8.61% | 85 | TSLA 32.5% | 0.5213 | 1.0000 | $349.84 | no | no | stress, nullTest, decisionGain |
| 194 | M1 down=4 nofilter | $2631.89 | $873.99 (49.7%) | $1073.88 / -$199.89 | 14.07% | 221 | MU 31.8% | 0.4326 | 1.0000 | -$806.33 | no | no | stress, nullTest, decisionGain |
| 187 | B3 entry=250 sma=50 | $2418.61 | $660.71 (37.6%) | $2095.62 / -$1434.91 | 14.72% | 70 | TSLA 25.8% | 0.7198 | 1.0000 | -$384.27 | no | no | stress, nullTest, decisionGain |

**Current leader:** experiment 180, B0, net $8396.06 (highest net profit among results that clear the target); labels: development result.

## 5. Mechanisms against their family baselines (derived from the table)

**B0** (net $8396.06, DD 13.56%, 148 trades, exposure 43.1%):

| Mechanism | Net | vs family | Exposure part | Decision part | DD | Trades | Exposure | Top | p raw |
|---|---|---|---|---|---|---|---|---|---|
| B1 entry=55 | $7801.01 | -$595.05 | $454.97 | -$1050.02 | 13.24% | 104 | 32.5% | TSLA 39% | 0.2110 |
| B1 entry=40 | $7030.79 | -$1365.27 | $707.56 | -$2072.83 | 12.91% | 108 | 33.6% | TSLA 37% | 0.2966 |
| B3 entry=120 sma=50 | $4451.29 | -$3944.77 | -$59.38 | -$3885.39 | 11.70% | 79 | 31.6% | TSLA 24% | 0.5137 |
| B2 ratio=0.9 | $3522.54 | -$4873.52 | $76.29 | -$4949.81 | 13.26% | 147 | 30.9% | TSLA 42% | 0.5799 |
| B1 entry=100 | $3364.19 | -$5031.87 | -$1449.88 | -$3581.99 | 8.61% | 85 | 25.9% | TSLA 32% | 0.5213 |
| B3 entry=250 sma=50 | $2418.61 | -$5977.45 | -$1419.71 | -$4557.74 | 14.72% | 70 | 26.7% | TSLA 26% | 0.7198 |
| B2 ratio=0.8 | $1542.94 | -$6853.12 | -$1877.26 | -$4975.86 | 15.69% | 108 | 22.1% | TSLA 59% | 0.6680 |
| B3 entry=250 sma=100 | $1493.51 | -$6902.55 | -$1745.71 | -$5156.84 | 11.77% | 44 | 23.6% | PYPL 38% | 0.8794 |
| B2 ratio=0.7 | -$583.43 | -$8979.49 | -$3446.80 | -$5532.69 | 14.19% | 71 | 14.3% | PYPL 30% | 0.8119 |

**M0** (net $4789.49, DD 23.99%, 1190 trades, exposure 30.5%):

| Mechanism | Net | vs family | Exposure part | Decision part | DD | Trades | Exposure | Top | p raw |
|---|---|---|---|---|---|---|---|---|---|
| M1 down=3 | $5812.61 | $1023.12 | -$731.53 | $1754.65 | 13.58% | 321 | 20.1% | META 23% | 0.1689 |
| M2 k=2 nofilter | $4882.33 | $92.84 | $2350.78 | -$2257.94 | 29.44% | 205 | 33.7% | MU 32% | 0.5651 |
| M2 k=1.5 | $3516.22 | -$1273.27 | -$968.52 | -$304.75 | 26.19% | 149 | 23.1% | SNAP 39% | 0.5073 |
| M2 k=2 | $3436.69 | -$1352.80 | -$540.94 | -$811.86 | 24.79% | 113 | 18.9% | SNAP 38% | 0.4506 |
| M1 down=4 nofilter | $2631.89 | -$2157.60 | -$220.47 | -$1937.13 | 14.07% | 221 | 14.3% | MU 32% | 0.4326 |
| M1 down=4 | $914.94 | -$3874.55 | -$2447.21 | -$1427.34 | 9.78% | 123 | 8.1% | MU 39% | 0.5029 |
| M3 gap=1 | $870.97 | -$3918.52 | -$1996.58 | -$1921.94 | 12.36% | 200 | 11.0% | TSLA 33% | 0.5634 |
| M1 down=5 | $257.51 | -$4531.98 | -$2319.57 | -$2212.41 | 7.06% | 65 | 3.8% | MU 32% | 0.5430 |
| M3 gap=1.5 nofilter | $248.83 | -$4540.66 | -$3559.93 | -$980.73 | 16.89% | 141 | 10.0% | TSLA 81% | 0.6709 |
| M2 k=2.5 | -$396.02 | -$5185.51 | -$3845.46 | -$1340.05 | 24.88% | 68 | 12.0% | PYPL 60% | 0.7929 |
| M3 gap=1.5 | -$963.01 | -$5752.50 | -$3692.45 | -$2060.05 | 12.63% | 90 | 6.4% | GOOG 42% | 0.8236 |
| M3 gap=2 | -$2151.01 | -$6940.50 | -$3573.67 | -$3366.83 | 16.33% | 50 | 4.7% | GOOG 57% | 0.9619 |

## 6. Resource usage and attempts (measured)

| Measure | Value |
|---|---|
| Worker time | 44.3 s in all; per experiment median 968 ms, max 17417 ms |
| Attempts preserved | 24 experiment rows (24 done, 0 failed, 0 replacements); every row kept with its status, error and provenance |
| Database | 10.9 MB |
| Limits that stopped the campaign | every planned experiment has run (24 done, 0 failed) |

## 7. Notifications generated (measured)

| # | When | Kind | Experiment | Title |
|---|---|---|---|---|
| 7 | 2026-11-05T17:52:00.990Z | target | 180 | development improvement - not yet validated |

## 8. Does any candidate deserve a later evaluation? (the assistant's reading, derived; the owner decides)

9 result(s) cleared the target but none passed the unadjusted shortlist (the stress, the raw-p null, concentration and decision gain), and 0 is Holm-significant. Nothing is proposed for evaluation.


## 9. Not done

- No evaluation, no validation, no "independently evaluated" label; the evaluation window was never opened. No criterion was changed. No order, broker, email or message.
- Failed experiments: none. Defect replacements: none.
- Events of note: none beyond the run log.
