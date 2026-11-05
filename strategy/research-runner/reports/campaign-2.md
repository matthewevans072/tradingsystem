# Research runner, campaign 2: results (development data only; nothing validated)

Written 2026-11-04 from `data/research-runner.sqlite` (not in git). A development campaign on data seen before (CAMPAIGN-1.md section 2); every result is a **development result**; the labels "shortlisted candidate" and "independently evaluated" mean what CAMPAIGN-1.md section 6 says, and the second is never set by the runner. **measured** = stored with the experiment by the engine; **derived** = benchmarks, ratios, the best-5% stress and the random-timing null. No bar, price or per-fill list is in this file. No order, no broker, no delivery outside the app.

## 1. Campaign status and provenance (measured)

| Item | Value |
|---|---|
| Status / stop reason | done / every planned experiment has run (94 done, 0 failed) |
| Experiments | 94 queued in all: 94 done, 0 failed, 0 cancelled, 0 still queued |
| Budget used | 94 of 100 configurations; 11.3 s of worker time of 12 h |
| Started / finished | 2026-11-05T06:00:53.363Z / 2026-11-05T06:01:05.825Z |
| Code revision / engine | rr-code-2026-11-04-2 / rt-engine-3; rt-code-2026-11-02-1; rr-runner-1 |
| Campaign document SHA-256 | f2ba683eaab685aa01da0a3388f43755b6e3e67c1706a834ff1047cdf1806ecd |
| Data / symbols / calibration hashes | bb76c910ed720a1aece2276c9d676a59369ee8a8710549e73d57f7113b3624f2 / dcc35cb32bbcdd9b16bee0c789f5752915e01088fdddcae3339beb8f574a6619 / e80c8ea1423b9d1f013b513d8ba37ed8943a501e74c813c0d665f57dbc93f371 |
| Period | 2017-10-02 to 2021-12-31, warm-up from 2016-01-04, basket A |
| Stage 3 | 10 combinations queued by the rule (0 duplicates skipped) |

## 2. The baseline (measured) and its reproduction

Experiment 85, rt-trend-immediate-nolimit-0.2.0: net profit $1757.90 (expected $1757.90 from practice run 6; difference $0.00), max drawdown 7.28%, 51 completed trades, average invested 12.2%, exposure-matched hold net $1166.28, equal-weight index net $40860.57 (derived). The 10% target is therefore net profit of at least $1933.69.

## 3. Result table (every experiment; measured unless marked derived)

Net = net profit after costs; vs base = difference from the baseline (derived) with the ratio where applicable; DD = maximum drawdown; Exp = average invested fraction; T/O = turnover a year; Top = the top stock's share of gross gain (derived); Null p and Stress net are derived; Failed = criteria not met (imp = 10% improvement, dd = drawdown, tr = trades, acc = accounting, dq = data quality, st = stress, null, conc = concentration, dec = decision gain).

| # | Stage | Experiment | Status | Net | vs base | DD | Exp | T/O | Costs | Trades | Top | Null p | Stress net | Labels | Failed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 85 | reference | rt-trend-immediate-nolimit-0.2.0 | done | $1757.90 | $0.00 (0.0%) | 7.28% | 12.2% | 4.25 | $227.84 | 51+1 | SNAP 66% | 0.496 | -$826.00 | dev | imp, st, null, conc, dec |
| 86 | reference | rt-range-dip-limit-0.2.0 | done | -$791.36 | -$2549.26 (-145.0%) | 10.36% | 4.6% | 1.07 | $78.12 | 14 | PYPL 62% | 0.861 | -$1074.00 | dev | imp, st, tr, null, conc, dec |
| 87 | reference | rt-range-dip-nolimit-0.2.0 | done | -$855.20 | -$2613.10 (-148.7%) | 15.24% | 9.5% | 2.87 | $173.43 | 36 | TSLA 52% | 0.819 | -$1809.60 | dev | imp, st, dd, null, conc, dec |
| 88 | reference | rt-range-recovery-limit-0.2.0 | done | $892.14 | -$865.76 (-49.3%) | 3.30% | 3.4% | 0.65 | $65.17 | 11 | SNAP 69% | 0.383 | $417.94 | dev | imp, st, tr, null, conc, dec |
| 89 | reference | rt-range-recovery-nolimit-0.2.0 | done | $1333.94 | -$423.96 (-24.1%) | 6.29% | 7.1% | 1.53 | $136.37 | 24 | SNAP 48% | 0.349 | $475.58 | dev | imp, st, tr, null, conc, dec |
| 90 | reference | rt-trend-immediate-limit-0.2.0 | done | $56.80 | -$1701.10 (-96.8%) | 4.19% | 2.4% | 0.97 | $58.74 | 12 | MU 60% | 0.620 | -$242.33 | dev | imp, st, tr, null, conc, dec |
| 91 | reference | rt-trend-pullback-limit-0.2.0 | done | -$478.22 | -$2236.12 (-127.2%) | 3.66% | 2.2% | 0.93 | $61.63 | 11 | VST 100% | 0.812 | -$563.93 | dev | imp, st, tr, null, conc, dec |
| 92 | reference | rt-trend-pullback-nolimit-0.2.0 | done | $1367.61 | -$390.29 (-22.2%) | 4.59% | 5.5% | 1.88 | $98.92 | 23 | SNAP 66% | 0.262 | -$503.86 | dev | imp, st, tr, null, conc, dec |
| 93 | single (B) | B+mSessions=10 | done | $1988.36 | $230.46 (13.1%) | 5.69% | 12.4% | 4.46 | $240.62 | 53+1 | SNAP 64% | 0.469 | -$767.65 | dev | st, null, conc |
| 94 | single (B) | B+mSessions=40 | done | $1860.41 | $102.51 (5.8%) | 5.55% | 13.4% | 4.31 | $231.33 | 51+1 | SNAP 63% | 0.519 | -$849.76 | dev | imp, st, null, conc, dec |
| 95 | single (B) | B+windowSessions=40 | done | $2486.89 | $728.99 (41.5%) | 7.64% | 15.2% | 4.98 | $246.49 | 61 | TSLA 47% | 0.497 | -$1246.70 | dev | st, null, conc, dec |
| 96 | single (B) | B+windowSessions=90 | done | $2395.69 | $637.79 (36.3%) | 5.62% | 8.2% | 3.46 | $192.13 | 43+1 | SNAP 61% | 0.285 | -$633.53 | dev | st, null, conc |
| 97 | single (B) | B+windowSessions=120 | done | -$226.23 | -$1984.13 (-112.9%) | 8.48% | 7.7% | 3.16 | $172.73 | 39+1 | TSLA 85% | 0.760 | -$1242.48 | dev | imp, st, null, conc, dec |
| 98 | single (B) | B+zoneFraction=0.2 | done | $1554.21 | -$203.69 (-11.6%) | 8.30% | 11.3% | 3.76 | $192.02 | 45+1 | SNAP 52% | 0.518 | -$1135.21 | dev | imp, st, null, conc, dec |
| 99 | single (B) | B+zoneFraction=0.33 | done | $1472.59 | -$285.31 (-16.2%) | 6.23% | 14.0% | 4.24 | $216.73 | 52+1 | MU 38% | 0.597 | -$404.86 | dev | imp, st, null, dec |
| 100 | single (B) | B+minVisits=1 | done | $797.57 | -$960.33 (-54.6%) | 12.14% | 19.0% | 7.13 | $322.90 | 91+1 | SNAP 55% | 0.718 | -$2715.48 | dev | imp, st, null, conc, dec |
| 101 | single (B) | B+minVisits=3 | done | $424.91 | -$1332.99 (-75.8%) | 1.43% | 2.2% | 0.46 | $35.07 | 5 | PYPL 94% | 0.483 | -$130.23 | dev | imp, st, tr, null, conc, dec |
| 102 | single (B) | B+visitGap=3 | done | $2824.63 | $1066.73 (60.7%) | 6.66% | 15.1% | 5.20 | $273.42 | 63+1 | SNAP 47% | 0.403 | -$562.65 | dev | st, null, conc, dec |
| 103 | single (B) | B+visitGap=10 | done | -$161.46 | -$1919.36 (-109.2%) | 6.04% | 8.1% | 2.62 | $152.71 | 31+1 | CSCO 41% | 0.792 | -$1009.70 | dev | imp, st, null, conc, dec |
| 104 | single (B) | B+minHeightM=2 | done | $1757.90 | $0.00 (0.0%) | 7.28% | 12.2% | 4.25 | $227.84 | 51+1 | SNAP 66% | 0.496 | -$826.00 | dev | imp, st, null, conc, dec |
| 105 | single (B) | B+minHeightM=6 | done | $1757.90 | $0.00 (0.0%) | 7.28% | 12.2% | 4.25 | $227.84 | 51+1 | SNAP 66% | 0.496 | -$826.00 | dev | imp, st, null, conc, dec |
| 106 | single (B) | B+minHeightM=8 | done | $567.00 | -$1190.90 (-67.8%) | 8.56% | 10.6% | 4.10 | $212.40 | 50 | SNAP 80% | 0.637 | -$1639.56 | dev | imp, st, null, conc, dec |
| 107 | single (B) | B+breakoutM=0 | done | $1978.34 | $220.44 (12.5%) | 6.39% | 13.9% | 4.98 | $261.77 | 59+1 | SNAP 54% | 0.494 | -$910.54 | dev | st, null, conc |
| 108 | single (B) | B+breakoutM=0.25 | done | $2091.73 | $333.83 (19.0%) | 6.36% | 14.2% | 4.88 | $256.17 | 58+1 | SNAP 58% | 0.491 | -$687.66 | dev | st, null, conc |
| 109 | single (B) | B+breakoutM=1 | done | -$797.01 | -$2554.91 (-145.3%) | 7.55% | 9.1% | 3.53 | $192.27 | 43+1 | CSCO 62% | 0.845 | -$1474.43 | dev | imp, st, null, conc, dec |
| 110 | single (B) | B+breakoutM=2 | done | -$877.62 | -$2635.52 (-149.9%) | 6.35% | 3.6% | 1.88 | $110.60 | 25 | TSLA 67% | 0.869 | -$1342.85 | dev | imp, st, tr, null, conc, dec |
| 111 | single (B) | B+breakdownM=0.25 | done | $1892.25 | $134.35 (7.6%) | 7.28% | 12.1% | 4.16 | $225.92 | 50+1 | SNAP 63% | 0.479 | -$706.93 | dev | imp, st, null, conc |
| 112 | single (B) | B+breakdownM=1 | done | $2094.67 | $336.77 (19.2%) | 7.28% | 13.2% | 4.42 | $236.04 | 53+1 | SNAP 58% | 0.472 | -$609.98 | dev | st, null, conc |
| 113 | single (B) | B+breakdownCloses=1 | done | $1436.00 | -$321.90 (-18.3%) | 7.28% | 11.5% | 4.11 | $220.45 | 49+1 | SNAP 69% | 0.524 | -$1117.34 | dev | imp, st, null, conc |
| 114 | single (B) | B+breakdownCloses=3 | done | $1757.90 | $0.00 (0.0%) | 7.28% | 12.2% | 4.25 | $227.84 | 51+1 | SNAP 66% | 0.496 | -$826.00 | dev | imp, st, null, conc, dec |
| 115 | single (B) | B+trendBelowHiCloses=1 | done | $871.20 | -$886.70 (-50.4%) | 6.31% | 8.9% | 4.33 | $227.01 | 52 | SNAP 82% | 0.543 | -$1414.95 | dev | imp, st, null, conc, dec |
| 116 | single (B) | B+trendBelowHiCloses=3 | done | $1718.78 | -$39.12 (-2.2%) | 7.49% | 13.0% | 4.26 | $228.06 | 51+1 | SNAP 68% | 0.517 | -$866.73 | dev | imp, st, null, conc |
| 117 | single (B) | B+trendBelowHiCloses=5 | done | $1706.97 | -$50.93 (-2.9%) | 8.49% | 14.3% | 4.23 | $223.87 | 51+1 | SNAP 63% | 0.535 | -$841.09 | dev | imp, st, null, conc, dec |
| 118 | single (B) | B+trendGivebackM=1.5 | done | $24.98 | -$1732.92 (-98.6%) | 4.24% | 6.0% | 4.27 | $224.70 | 51+1 | MU 34% | 0.668 | -$571.73 | dev | imp, st, null, dec |
| 119 | single (B) | B+trendGivebackM=2 | done | $1562.36 | -$195.54 (-11.1%) | 6.43% | 7.8% | 4.27 | $225.42 | 51+1 | SNAP 75% | 0.353 | -$591.33 | dev | imp, st, null, conc |
| 120 | single (B) | B+trendGivebackM=4 | done | $1660.07 | -$97.83 (-5.6%) | 7.44% | 15.3% | 4.26 | $226.15 | 51+1 | SNAP 55% | 0.572 | -$737.58 | dev | imp, st, null, conc, dec |
| 121 | single (B) | B+trendGivebackM=6 | done | $3322.21 | $1564.31 (89.0%) | 8.47% | 23.4% | 4.52 | $245.20 | 53+1 | SNAP 45% | 0.499 | -$215.19 | dev | st, null, conc |
| 122 | single (B) | B+trendGivebackM=8 | done | $2800.83 | $1042.93 (59.3%) | 10.03% | 26.1% | 4.38 | $233.71 | 52+1 | SNAP 43% | 0.586 | -$753.17 | dev | st, null, conc, dec |
| 123 | single (B) | B+positionCapPct=10 | done | $888.89 | -$869.01 (-49.4%) | 3.40% | 6.0% | 1.96 | $105.73 | 45+1 | SNAP 61% | 0.495 | -$444.07 | dev | imp, st, null, conc, dec |
| 124 | single (B) | B+positionCapPct=33 | done | $2979.43 | $1221.53 (69.5%) | 9.96% | 19.3% | 6.81 | $358.80 | 55+1 | SNAP 64% | 0.464 | -$1309.82 | dev | st, null, conc |
| 125 | single (B) | B+positionCapPct=50 | done | $4761.72 | $3003.82 (170.9%) | 11.33% | 23.3% | 8.21 | $448.82 | 54+1 | SNAP 58% | 0.401 | -$1073.27 | dev | st, null, conc |
| 126 | single (B) | B+riskPerTradePct=0.5 | done | $2124.72 | $366.82 (20.9%) | 5.84% | 10.9% | 3.61 | $190.07 | 49+1 | SNAP 66% | 0.379 | -$471.26 | dev | st, null, conc |
| 127 | single (B) | B+riskPerTradePct=2 | done | $1881.25 | $123.35 (7.0%) | 7.06% | 12.8% | 4.46 | $237.18 | 51+1 | SNAP 62% | 0.495 | -$796.28 | dev | imp, st, null, conc |
| 128 | single (B) | B+riskPerTradePct=3 | done | $1777.52 | $19.62 (1.1%) | 7.56% | 12.8% | 4.48 | $237.36 | 51+1 | SNAP 61% | 0.511 | -$883.10 | dev | imp, st, null, conc, dec |
| 129 | single (B) | B+totalEntryRiskPct=2.5 | done | $1757.90 | $0.00 (0.0%) | 7.28% | 12.2% | 4.25 | $227.84 | 51+1 | SNAP 66% | 0.496 | -$826.00 | dev | imp, st, null, conc, dec |
| 130 | single (B) | B+totalEntryRiskPct=10 | done | $1757.90 | $0.00 (0.0%) | 7.28% | 12.2% | 4.25 | $227.84 | 51+1 | SNAP 66% | 0.496 | -$826.00 | dev | imp, st, null, conc, dec |
| 131 | single (B) | B+totalEntryRiskPct=none | done | $1757.90 | $0.00 (0.0%) | 7.28% | 12.2% | 4.25 | $227.84 | 51+1 | SNAP 66% | 0.496 | -$826.00 | dev | imp, st, null, conc, dec |
| 132 | single (B) | B+stopM=0.25 | done | $47.59 | -$1710.31 (-97.3%) | 7.38% | 12.0% | 4.19 | $220.43 | 50+1 | PYPL 45% | 0.761 | -$1125.67 | dev | imp, st, null, conc, dec |
| 133 | single (B) | B+stopM=1 | done | $1743.42 | -$14.48 (-0.8%) | 6.79% | 12.0% | 4.22 | $224.91 | 52+1 | SNAP 64% | 0.476 | -$837.27 | dev | imp, st, null, conc |
| 134 | single (B) | B+stopM=2 | done | $1831.40 | $73.50 (4.2%) | 6.07% | 11.3% | 3.92 | $208.91 | 51+1 | SNAP 61% | 0.448 | -$544.43 | dev | imp, st, null, conc |
| 135 | single (D/R/P) | D+windowSessions=40 | done | $105.32 | -$1652.58 (-94.0%) | 17.69% | 12.0% | 4.57 | $252.69 | 53+2 | PYPL 57% | 0.750 | -$1944.89 | dev | imp, st, dd, null, conc, dec |
| 136 | single (D/R/P) | D+windowSessions=90 | done | $1624.99 | -$132.91 (-7.6%) | 6.67% | 16.3% | 2.38 | $170.01 | 32 | VST 34% | 0.616 | $264.19 | dev | imp, st, null, dec |
| 137 | single (D/R/P) | D+zoneFraction=0.2 | done | $2376.46 | $618.56 (35.2%) | 8.84% | 13.5% | 2.56 | $189.08 | 30+2 | PYPL 46% | 0.517 | $457.33 | dev | st, null, conc, dec |
| 138 | single (D/R/P) | D+zoneFraction=0.33 | done | $6841.39 | $5083.49 (289.2%) | 8.35% | 19.0% | 3.84 | $319.76 | 53 | SNAP 36% | 0.218 | $3275.86 | dev | null |
| 139 | single (D/R/P) | D+minHeightM=2 | done | -$855.20 | -$2613.10 (-148.7%) | 15.24% | 9.5% | 2.87 | $173.43 | 36 | TSLA 52% | 0.819 | -$1809.60 | dev | imp, st, dd, null, conc, dec |
| 140 | single (D/R/P) | D+minHeightM=6 | done | -$915.81 | -$2673.71 (-152.1%) | 15.24% | 9.6% | 2.87 | $173.29 | 36 | TSLA 53% | 0.824 | -$1870.21 | dev | imp, st, dd, null, conc, dec |
| 141 | single (D/R/P) | D+rejectionM=0.25 | done | -$719.65 | -$2477.55 (-140.9%) | 15.24% | 9.4% | 2.87 | $173.98 | 36 | TSLA 57% | 0.806 | -$1852.39 | dev | imp, st, dd, null, conc, dec |
| 142 | single (D/R/P) | D+rejectionM=1 | done | -$259.48 | -$2017.38 (-114.8%) | 15.07% | 10.8% | 2.86 | $175.17 | 36 | TSLA 39% | 0.761 | -$1461.71 | dev | imp, st, dd, null, dec |
| 143 | single (D/R/P) | D+breakdownCloses=1 | done | -$37.31 | -$1795.21 (-102.1%) | 9.08% | 9.6% | 2.96 | $180.94 | 36+1 | PYPL 70% | 0.736 | -$1503.53 | dev | imp, st, null, conc, dec |
| 144 | single (D/R/P) | D+breakdownCloses=3 | done | -$786.84 | -$2544.74 (-144.8%) | 16.03% | 11.2% | 2.78 | $169.18 | 35 | TSLA 48% | 0.834 | -$1741.25 | dev | imp, st, dd, null, conc, dec |
| 145 | single (D/R/P) | D+stopM=1 | done | -$1117.37 | -$2875.27 (-163.6%) | 12.98% | 8.8% | 2.76 | $165.86 | 36 | PYPL 47% | 0.862 | -$1709.51 | dev | imp, st, null, conc, dec |
| 146 | single (D/R/P) | D+positionCapPct=33 | done | -$1446.91 | -$3204.81 (-182.3%) | 16.93% | 12.4% | 3.85 | $235.71 | 36 | TSLA 49% | 0.856 | -$2457.42 | dev | imp, st, dd, null, conc, dec |
| 147 | single (D/R/P) | R+recoveryM=0.5 | done | $1482.05 | -$275.85 (-15.7%) | 6.26% | 7.6% | 1.58 | $139.95 | 24 | SNAP 48% | 0.378 | $554.91 | dev | imp, st, tr, null, conc, dec |
| 148 | single (D/R/P) | R+recoveryM=2 | done | $781.96 | -$975.94 (-55.5%) | 7.24% | 6.1% | 1.17 | $110.20 | 20 | SNAP 54% | 0.474 | $307.76 | dev | imp, st, tr, null, conc, dec |
| 149 | single (D/R/P) | R+windowSessions=40 | done | $2547.05 | $789.15 (44.9%) | 4.37% | 8.9% | 2.44 | $148.59 | 34+1 | PYPL 41% | 0.351 | $1289.07 | dev | st, null, conc |
| 150 | single (D/R/P) | R+windowSessions=90 | done | $666.11 | -$1091.79 (-62.1%) | 4.58% | 8.7% | 1.45 | $110.27 | 26 | SNAP 36% | 0.674 | -$80.13 | dev | imp, st, tr, null, dec |
| 151 | single (D/R/P) | R+zoneFraction=0.33 | done | $1484.16 | -$273.74 (-15.6%) | 7.39% | 9.6% | 2.15 | $181.72 | 39 | SNAP 54% | 0.520 | $241.12 | dev | imp, st, null, conc, dec |
| 152 | single (D/R/P) | R+minHeightM=2 | done | $1333.94 | -$423.96 (-24.1%) | 6.29% | 7.1% | 1.53 | $136.37 | 24 | SNAP 48% | 0.349 | $475.58 | dev | imp, st, tr, null, conc, dec |
| 153 | single (D/R/P) | R+minHeightM=6 | done | $1333.94 | -$423.96 (-24.1%) | 6.29% | 7.1% | 1.53 | $136.37 | 24 | SNAP 48% | 0.349 | $475.58 | dev | imp, st, tr, null, conc, dec |
| 154 | single (D/R/P) | R+rejectionM=1 | done | $1662.25 | -$95.65 (-5.4%) | 5.96% | 7.9% | 1.53 | $137.44 | 24 | SNAP 43% | 0.301 | $739.83 | dev | imp, st, tr, null, conc, dec |
| 155 | single (D/R/P) | R+breakdownCloses=3 | done | $1215.84 | -$542.06 (-30.8%) | 5.86% | 7.2% | 1.53 | $137.14 | 24 | SNAP 46% | 0.375 | $361.36 | dev | imp, st, tr, null, conc, dec |
| 156 | single (D/R/P) | R+stopM=1 | done | $1143.30 | -$614.60 (-35.0%) | 5.87% | 6.4% | 1.39 | $120.65 | 24 | SNAP 49% | 0.369 | $361.90 | dev | imp, st, tr, null, conc, dec |
| 157 | single (D/R/P) | R+positionCapPct=33 | done | $1250.61 | -$507.29 (-28.9%) | 6.83% | 7.3% | 1.57 | $138.23 | 24 | SNAP 48% | 0.376 | $392.25 | dev | imp, st, tr, null, conc, dec |
| 158 | single (D/R/P) | P+pullbackM=0.5 | done | $655.89 | -$1102.01 (-62.7%) | 5.14% | 1.6% | 0.81 | $46.41 | 10 | SNAP 94% | 0.279 | -$773.24 | dev | imp, st, tr, null, conc, dec |
| 159 | single (D/R/P) | P+pullbackM=2 | done | $297.95 | -$1459.95 (-83.0%) | 6.59% | 5.5% | 2.23 | $124.02 | 28 | SNAP 100% | 0.631 | -$1229.63 | dev | imp, st, tr, null, conc, dec |
| 160 | single (D/R/P) | P+trendGivebackM=2 | done | $1371.22 | -$386.68 (-22.0%) | 4.49% | 3.7% | 1.87 | $98.78 | 23 | SNAP 69% | 0.168 | -$431.84 | dev | imp, st, tr, null, conc, dec |
| 161 | single (D/R/P) | P+trendGivebackM=6 | done | $2715.17 | $957.27 (54.5%) | 6.66% | 13.6% | 1.90 | $102.99 | 23 | SNAP 41% | 0.353 | $560.70 | dev | st, tr, null, conc, dec |
| 162 | single (D/R/P) | P+trendBelowHiCloses=3 | done | $1309.84 | -$448.06 (-25.5%) | 4.90% | 5.6% | 1.88 | $98.58 | 23 | SNAP 65% | 0.279 | -$561.63 | dev | imp, st, tr, null, conc, dec |
| 163 | single (D/R/P) | P+windowSessions=40 | done | $1650.82 | -$107.08 (-6.1%) | 9.39% | 6.5% | 2.38 | $102.45 | 29 | TSLA 55% | 0.381 | -$744.78 | dev | imp, st, tr, null, conc |
| 164 | single (D/R/P) | P+windowSessions=90 | done | $1837.14 | $79.24 (4.5%) | 6.44% | 4.5% | 1.59 | $73.33 | 20 | SNAP 71% | 0.260 | $434.69 | dev | imp, st, tr, null, conc |
| 165 | single (D/R/P) | P+breakoutM=0.25 | done | $1632.63 | -$125.27 (-7.1%) | 4.15% | 6.4% | 2.05 | $132.07 | 25 | SNAP 62% | 0.210 | -$266.87 | dev | imp, st, tr, null, conc |
| 166 | single (D/R/P) | P+breakoutM=1 | done | -$68.07 | -$1825.97 (-103.9%) | 4.98% | 4.2% | 1.28 | $59.28 | 16 | GOOG 64% | 0.731 | -$482.39 | dev | imp, st, tr, null, conc, dec |
| 167 | single (D/R/P) | P+positionCapPct=33 | done | $1264.50 | -$493.40 (-28.1%) | 6.26% | 7.0% | 2.53 | $140.56 | 23 | SNAP 62% | 0.369 | -$606.98 | dev | imp, st, tr, null, conc, dec |
| 168 | single (D/R/P) | P+stopM=1 | done | $1179.51 | -$578.39 (-32.9%) | 4.38% | 5.4% | 1.83 | $97.04 | 23 | SNAP 62% | 0.289 | -$467.78 | dev | imp, st, tr, null, conc, dec |
| 169 | combination | B+positionCapPct=50+trendGivebackM=6 | done | $5931.81 | $4173.91 (237.4%) | 11.91% | 38.0% | 7.04 | $401.17 | 51+1 | SNAP 54% | 0.462 | -$96.49 | dev | st, null, conc |
| 170 | combination | B+trendGivebackM=6+positionCapPct=33 | done | $4736.86 | $2978.96 (169.5%) | 11.44% | 33.4% | 6.26 | $347.12 | 52+1 | SNAP 50% | 0.490 | $7.03 | dev | st, null, conc |
| 171 | combination | D+zoneFraction=0.33+windowSessions=90 | done | $2060.27 | $302.37 (17.2%) | 7.38% | 15.3% | 2.58 | $203.08 | 37+1 | SNAP 27% | 0.551 | $398.21 | dev | st, null, dec |
| 172 | combination | D+zoneFraction=0.2+windowSessions=90 | done | $1916.35 | $158.45 (9.0%) | 9.88% | 13.8% | 2.20 | $125.79 | 27 | SNAP 38% | 0.600 | $499.71 | dev | imp, st, tr, null, dec |
| 173 | combination | R+windowSessions=40+rejectionM=1 | done | $2359.95 | $602.05 (34.3%) | 4.65% | 9.6% | 2.44 | $147.88 | 34+1 | PYPL 41% | 0.397 | $1101.97 | dev | st, null, conc |
| 174 | combination | R+windowSessions=40+zoneFraction=0.33 | done | $957.46 | -$800.44 (-45.5%) | 5.47% | 6.3% | 2.40 | $167.99 | 34+1 | PYPL 41% | 0.474 | $211.67 | dev | imp, st, null, conc, dec |
| 175 | combination | R+rejectionM=1+zoneFraction=0.33 | done | $3736.07 | $1978.17 (112.5%) | 5.44% | 11.2% | 2.18 | $187.75 | 37+1 | SNAP 62% | 0.247 | $1637.84 | dev | st, null, conc |
| 176 | combination | R+windowSessions=40+rejectionM=1+zoneFraction=0.33 | done | $885.72 | -$872.18 (-49.6%) | 5.53% | 6.8% | 2.40 | $167.53 | 34+1 | PYPL 42% | 0.503 | $139.93 | dev | imp, st, null, conc, dec |
| 177 | combination | P+trendGivebackM=6+windowSessions=90 | done | $2438.66 | $680.76 (38.7%) | 7.24% | 8.7% | 1.60 | $72.78 | 20 | SNAP 54% | 0.339 | $1239.19 | dev | st, tr, null, conc |
| 178 | combination | P+trendGivebackM=6+windowSessions=40 | done | $2400.99 | $643.09 (36.6%) | 9.22% | 13.1% | 2.32 | $102.16 | 28 | TSLA 38% | 0.550 | -$265.96 | dev | st, tr, null |

## 4. Candidates (derived from the table)

Results that clear the target (10% above the baseline, drawdown at most 15%, at least 30 trades, accounting, data quality): **20**. Shortlisted (also stress, null p at most 0.05, concentration at most 40%, decision gain positive): **0**.

| # | Experiment | Net | vs base | Of which exposure / decisions | DD | Trades | Top | Null p | Stress net | Shortlisted | Failed for the shortlist |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 138 | D+zoneFraction=0.33 | $6841.39 | $5083.49 (289.2%) | $3365.55 / $1717.94 | 8.35% | 53 | SNAP 35.8% | 0.218 | $3275.86 | no | nullTest |
| 169 | B+positionCapPct=50+trendGivebackM=6 | $5931.81 | $4173.91 (237.4%) | $1624.32 / $2549.59 | 11.91% | 51 | SNAP 53.8% | 0.462 | -$96.49 | no | stress, nullTest, concentration |
| 125 | B+positionCapPct=50 | $4761.72 | $3003.82 (170.9%) | $1681.29 / $1322.53 | 11.33% | 54 | SNAP 58.0% | 0.401 | -$1073.27 | no | stress, nullTest, concentration |
| 170 | B+trendGivebackM=6+positionCapPct=33 | $4736.86 | $2978.96 (169.5%) | $2035.69 / $943.27 | 11.44% | 52 | SNAP 50.1% | 0.490 | $7.03 | no | stress, nullTest, concentration |
| 175 | R+rejectionM=1+zoneFraction=0.33 | $3736.07 | $1978.17 (112.5%) | $410.68 / $1567.49 | 5.44% | 37 | SNAP 62.0% | 0.247 | $1637.84 | no | stress, nullTest, concentration |
| 121 | B+trendGivebackM=6 | $3322.21 | $1564.31 (89.0%) | $1450.55 / $113.76 | 8.47% | 53 | SNAP 45.5% | 0.499 | -$215.19 | no | stress, nullTest, concentration |
| 124 | B+positionCapPct=33 | $2979.43 | $1221.53 (69.5%) | $676.14 / $545.39 | 9.96% | 55 | SNAP 64.2% | 0.464 | -$1309.82 | no | stress, nullTest, concentration |
| 102 | B+visitGap=3 | $2824.63 | $1066.73 (60.7%) | $1609.29 / -$542.56 | 6.66% | 63 | SNAP 46.6% | 0.403 | -$562.65 | no | stress, nullTest, concentration, decisionGain |
| 122 | B+trendGivebackM=8 | $2800.83 | $1042.93 (59.3%) | $2190.15 / -$1147.22 | 10.03% | 52 | SNAP 42.6% | 0.586 | -$753.17 | no | stress, nullTest, concentration, decisionGain |
| 149 | R+windowSessions=40 | $2547.05 | $789.15 (44.9%) | -$248.37 / $1037.52 | 4.37% | 34 | PYPL 40.6% | 0.351 | $1289.07 | no | stress, nullTest, concentration |
| 95 | B+windowSessions=40 | $2486.89 | $728.99 (41.5%) | $1093.06 / -$364.07 | 7.64% | 61 | TSLA 47.0% | 0.497 | -$1246.70 | no | stress, nullTest, concentration, decisionGain |
| 96 | B+windowSessions=90 | $2395.69 | $637.79 (36.3%) | -$231.70 / $869.49 | 5.62% | 43 | SNAP 60.8% | 0.285 | -$633.53 | no | stress, nullTest, concentration |
| 137 | D+zoneFraction=0.2 | $2376.46 | $618.56 (35.2%) | $1040.02 / -$421.46 | 8.84% | 30 | PYPL 46.4% | 0.517 | $457.33 | no | stress, nullTest, concentration, decisionGain |
| 173 | R+windowSessions=40+rejectionM=1 | $2359.95 | $602.05 (34.3%) | -$264.91 / $866.96 | 4.65% | 34 | PYPL 40.9% | 0.397 | $1101.97 | no | stress, nullTest, concentration |
| 126 | B+riskPerTradePct=0.5 | $2124.72 | $366.82 (20.9%) | -$141.45 / $508.27 | 5.84% | 49 | SNAP 65.6% | 0.379 | -$471.26 | no | stress, nullTest, concentration |
| 112 | B+breakdownM=1 | $2094.67 | $336.77 (19.2%) | $304.17 / $32.60 | 7.28% | 53 | SNAP 57.6% | 0.472 | -$609.98 | no | stress, nullTest, concentration |
| 108 | B+breakoutM=0.25 | $2091.73 | $333.83 (19.0%) | $175.77 / $158.06 | 6.36% | 58 | SNAP 57.7% | 0.491 | -$687.66 | no | stress, nullTest, concentration |
| 171 | D+zoneFraction=0.33+windowSessions=90 | $2060.27 | $302.37 (17.2%) | $2674.93 / -$2372.56 | 7.38% | 37 | SNAP 26.9% | 0.551 | $398.21 | no | stress, nullTest, decisionGain |
| 93 | B+mSessions=10 | $1988.36 | $230.46 (13.1%) | -$320.95 / $551.41 | 5.69% | 53 | SNAP 63.9% | 0.469 | -$767.65 | no | stress, nullTest, concentration |
| 107 | B+breakoutM=0 | $1978.34 | $220.44 (12.5%) | $115.44 / $105.00 | 6.39% | 59 | SNAP 54.0% | 0.494 | -$910.54 | no | stress, nullTest, concentration |

**Current leader:** experiment 138, D+zoneFraction=0.33, net $6841.39 (highest net profit among results that clear the target); labels: development result.

## 5. What moved the result (derived; single-component stages only)

**Base rt-trend-immediate-nolimit-0.2.0.json** (net $1757.90, DD 7.28%, 51 trades): changes ranked by net profit.

| Change | Net | vs base | DD | Trades | Exposure | Top stock |
|---|---|---|---|---|---|---|
| portfolio.positionCapPct 20 -> 50 | $4761.72 | $3003.82 | 11.33% | 54 | 23.3% | SNAP 58% |
| exits.trendGivebackM 3 -> 6 | $3322.21 | $1564.31 | 8.47% | 53 | 23.4% | SNAP 45% |
| portfolio.positionCapPct 20 -> 33 | $2979.43 | $1221.53 | 9.96% | 55 | 19.3% | SNAP 64% |
| levels.visitGap 5 -> 3 | $2824.63 | $1066.73 | 6.66% | 63 | 15.1% | SNAP 47% |
| exits.trendGivebackM 3 -> 8 | $2800.83 | $1042.93 | 10.03% | 52 | 26.1% | SNAP 43% |
| levels.windowSessions 60 -> 40 | $2486.89 | $728.99 | 7.64% | 61 | 15.2% | TSLA 47% |
| levels.windowSessions 60 -> 90 | $2395.69 | $637.79 | 5.62% | 43 | 8.2% | SNAP 61% |
| portfolio.riskPerTradePct 1 -> 0.5 | $2124.72 | $366.82 | 5.84% | 49 | 10.9% | SNAP 66% |
| levels.breakdownM 0.5 -> 1 | $2094.67 | $336.77 | 7.28% | 53 | 13.2% | SNAP 58% |
| levels.breakoutM 0.5 -> 0.25 | $2091.73 | $333.83 | 6.36% | 58 | 14.2% | SNAP 58% |
| levels.mSessions 20 -> 10 | $1988.36 | $230.46 | 5.69% | 53 | 12.4% | SNAP 64% |
| levels.breakoutM 0.5 -> 0 | $1978.34 | $220.44 | 6.39% | 59 | 13.9% | SNAP 54% |
| levels.breakdownM 0.5 -> 0.25 | $1892.25 | $134.35 | 7.28% | 50 | 12.1% | SNAP 63% |
| portfolio.riskPerTradePct 1 -> 2 | $1881.25 | $123.35 | 7.06% | 51 | 12.8% | SNAP 62% |
| levels.mSessions 20 -> 40 | $1860.41 | $102.51 | 5.55% | 51 | 13.4% | SNAP 63% |
| portfolio.stopM 0.5 -> 2 | $1831.40 | $73.50 | 6.07% | 51 | 11.3% | SNAP 61% |
| portfolio.riskPerTradePct 1 -> 3 | $1777.52 | $19.62 | 7.56% | 51 | 12.8% | SNAP 61% |
| levels.minHeightM 4 -> 2 | $1757.90 | $0.00 | 7.28% | 51 | 12.2% | SNAP 66% |
| levels.minHeightM 4 -> 6 | $1757.90 | $0.00 | 7.28% | 51 | 12.2% | SNAP 66% |
| levels.breakdownCloses 2 -> 3 | $1757.90 | $0.00 | 7.28% | 51 | 12.2% | SNAP 66% |
| portfolio.totalEntryRiskPct 5 -> 2.5 | $1757.90 | $0.00 | 7.28% | 51 | 12.2% | SNAP 66% |
| portfolio.totalEntryRiskPct 5 -> 10 | $1757.90 | $0.00 | 7.28% | 51 | 12.2% | SNAP 66% |
| portfolio.totalEntryRiskPct 5 -> null | $1757.90 | $0.00 | 7.28% | 51 | 12.2% | SNAP 66% |
| portfolio.stopM 0.5 -> 1 | $1743.42 | -$14.48 | 6.79% | 52 | 12.0% | SNAP 64% |
| exits.trendBelowHiCloses 2 -> 3 | $1718.78 | -$39.12 | 7.49% | 51 | 13.0% | SNAP 68% |
| exits.trendBelowHiCloses 2 -> 5 | $1706.97 | -$50.93 | 8.49% | 51 | 14.3% | SNAP 63% |
| exits.trendGivebackM 3 -> 4 | $1660.07 | -$97.83 | 7.44% | 51 | 15.3% | SNAP 55% |
| exits.trendGivebackM 3 -> 2 | $1562.36 | -$195.54 | 6.43% | 51 | 7.8% | SNAP 75% |
| levels.zoneFraction 0.25 -> 0.2 | $1554.21 | -$203.69 | 8.30% | 45 | 11.3% | SNAP 52% |
| levels.zoneFraction 0.25 -> 0.33 | $1472.59 | -$285.31 | 6.23% | 52 | 14.0% | MU 38% |
| levels.breakdownCloses 2 -> 1 | $1436.00 | -$321.90 | 7.28% | 49 | 11.5% | SNAP 69% |
| portfolio.positionCapPct 20 -> 10 | $888.89 | -$869.01 | 3.40% | 45 | 6.0% | SNAP 61% |
| exits.trendBelowHiCloses 2 -> 1 | $871.20 | -$886.70 | 6.31% | 52 | 8.9% | SNAP 82% |
| levels.minVisits 2 -> 1 | $797.57 | -$960.33 | 12.14% | 91 | 19.0% | SNAP 55% |
| levels.minHeightM 4 -> 8 | $567.00 | -$1190.90 | 8.56% | 50 | 10.6% | SNAP 80% |
| levels.minVisits 2 -> 3 | $424.91 | -$1332.99 | 1.43% | 5 | 2.2% | PYPL 94% |
| portfolio.stopM 0.5 -> 0.25 | $47.59 | -$1710.31 | 7.38% | 50 | 12.0% | PYPL 45% |
| exits.trendGivebackM 3 -> 1.5 | $24.98 | -$1732.92 | 4.24% | 51 | 6.0% | MU 34% |
| levels.visitGap 5 -> 10 | -$161.46 | -$1919.36 | 6.04% | 31 | 8.1% | CSCO 41% |
| levels.windowSessions 60 -> 120 | -$226.23 | -$1984.13 | 8.48% | 39 | 7.7% | TSLA 85% |
| levels.breakoutM 0.5 -> 1 | -$797.01 | -$2554.91 | 7.55% | 43 | 9.1% | CSCO 62% |
| levels.breakoutM 0.5 -> 2 | -$877.62 | -$2635.52 | 6.35% | 25 | 3.6% | TSLA 67% |

**Base rt-range-dip-nolimit-0.2.0.json** (net -$855.20, DD 15.24%, 36 trades): changes ranked by net profit.

| Change | Net | vs base | DD | Trades | Exposure | Top stock |
|---|---|---|---|---|---|---|
| levels.zoneFraction 0.25 -> 0.33 | $6841.39 | $7696.59 | 8.35% | 53 | 19.0% | SNAP 36% |
| levels.zoneFraction 0.25 -> 0.2 | $2376.46 | $3231.66 | 8.84% | 30 | 13.5% | PYPL 46% |
| levels.windowSessions 60 -> 90 | $1624.99 | $2480.19 | 6.67% | 32 | 16.3% | VST 34% |
| levels.windowSessions 60 -> 40 | $105.32 | $960.52 | 17.69% | 53 | 12.0% | PYPL 57% |
| levels.breakdownCloses 2 -> 1 | -$37.31 | $817.89 | 9.08% | 36 | 9.6% | PYPL 70% |
| exits.rejectionM 0.5 -> 1 | -$259.48 | $595.72 | 15.07% | 36 | 10.8% | TSLA 39% |
| exits.rejectionM 0.5 -> 0.25 | -$719.65 | $135.55 | 15.24% | 36 | 9.4% | TSLA 57% |
| levels.breakdownCloses 2 -> 3 | -$786.84 | $68.36 | 16.03% | 35 | 11.2% | TSLA 48% |
| levels.minHeightM 4 -> 2 | -$855.20 | $0.00 | 15.24% | 36 | 9.5% | TSLA 52% |
| levels.minHeightM 4 -> 6 | -$915.81 | -$60.61 | 15.24% | 36 | 9.6% | TSLA 53% |
| portfolio.stopM 0.5 -> 1 | -$1117.37 | -$262.17 | 12.98% | 36 | 8.8% | PYPL 47% |
| portfolio.positionCapPct 20 -> 33 | -$1446.91 | -$591.71 | 16.93% | 36 | 12.4% | TSLA 49% |

**Base rt-range-recovery-nolimit-0.2.0.json** (net $1333.94, DD 6.29%, 24 trades): changes ranked by net profit.

| Change | Net | vs base | DD | Trades | Exposure | Top stock |
|---|---|---|---|---|---|---|
| levels.windowSessions 60 -> 40 | $2547.05 | $1213.11 | 4.37% | 34 | 8.9% | PYPL 41% |
| exits.rejectionM 0.5 -> 1 | $1662.25 | $328.31 | 5.96% | 24 | 7.9% | SNAP 43% |
| levels.zoneFraction 0.25 -> 0.33 | $1484.16 | $150.22 | 7.39% | 39 | 9.6% | SNAP 54% |
| levels.recoveryM 1 -> 0.5 | $1482.05 | $148.11 | 6.26% | 24 | 7.6% | SNAP 48% |
| levels.minHeightM 4 -> 2 | $1333.94 | $0.00 | 6.29% | 24 | 7.1% | SNAP 48% |
| levels.minHeightM 4 -> 6 | $1333.94 | $0.00 | 6.29% | 24 | 7.1% | SNAP 48% |
| portfolio.positionCapPct 20 -> 33 | $1250.61 | -$83.33 | 6.83% | 24 | 7.3% | SNAP 48% |
| levels.breakdownCloses 2 -> 3 | $1215.84 | -$118.10 | 5.86% | 24 | 7.2% | SNAP 46% |
| portfolio.stopM 0.5 -> 1 | $1143.30 | -$190.64 | 5.87% | 24 | 6.4% | SNAP 49% |
| levels.recoveryM 1 -> 2 | $781.96 | -$551.98 | 7.24% | 20 | 6.1% | SNAP 54% |
| levels.windowSessions 60 -> 90 | $666.11 | -$667.83 | 4.58% | 26 | 8.7% | SNAP 36% |

**Base rt-trend-pullback-nolimit-0.2.0.json** (net $1367.61, DD 4.59%, 23 trades): changes ranked by net profit.

| Change | Net | vs base | DD | Trades | Exposure | Top stock |
|---|---|---|---|---|---|---|
| exits.trendGivebackM 3 -> 6 | $2715.17 | $1347.56 | 6.66% | 23 | 13.6% | SNAP 41% |
| levels.windowSessions 60 -> 90 | $1837.14 | $469.53 | 6.44% | 20 | 4.5% | SNAP 71% |
| levels.windowSessions 60 -> 40 | $1650.82 | $283.21 | 9.39% | 29 | 6.5% | TSLA 55% |
| levels.breakoutM 0.5 -> 0.25 | $1632.63 | $265.02 | 4.15% | 25 | 6.4% | SNAP 62% |
| exits.trendGivebackM 3 -> 2 | $1371.22 | $3.61 | 4.49% | 23 | 3.7% | SNAP 69% |
| exits.trendBelowHiCloses 2 -> 3 | $1309.84 | -$57.77 | 4.90% | 23 | 5.6% | SNAP 65% |
| portfolio.positionCapPct 20 -> 33 | $1264.50 | -$103.11 | 6.26% | 23 | 7.0% | SNAP 62% |
| portfolio.stopM 0.5 -> 1 | $1179.51 | -$188.10 | 4.38% | 23 | 5.4% | SNAP 62% |
| levels.pullbackM 1 -> 0.5 | $655.89 | -$711.72 | 5.14% | 10 | 1.6% | SNAP 94% |
| levels.pullbackM 1 -> 2 | $297.95 | -$1069.66 | 6.59% | 28 | 5.5% | SNAP 100% |
| levels.breakoutM 0.5 -> 1 | -$68.07 | -$1435.68 | 4.98% | 16 | 4.2% | GOOG 64% |

## 6. Resource usage (measured)

| Measure | Value |
|---|---|
| Worker time | 11.3 s in all; per experiment median 104 ms, max 205 ms, sum 9617 ms |
| Experiments run | 94 done, 0 failed; 94 queued in all |
| Database | 8.8 MB (C:\Users\matth\OneDrive\Desktop\trading system\data\research-runner.sqlite) |
| Limits that stopped the campaign | every planned experiment has run (94 done, 0 failed) |

## 7. Notifications generated (measured)

| # | When | Kind | Experiment | Title |
|---|---|---|---|---|
| 6 | 2026-11-05T06:01:00.635Z | target | 138 | development improvement - not yet validated |
| 5 | 2026-11-05T06:00:58.467Z | target | 125 | development improvement - not yet validated |
| 4 | 2026-11-05T06:00:57.894Z | target | 121 | development improvement - not yet validated |
| 3 | 2026-11-05T06:00:55.450Z | target | 102 | development improvement - not yet validated |
| 2 | 2026-11-05T06:00:54.801Z | target | 95 | development improvement - not yet validated |
| 1 | 2026-11-05T06:00:54.653Z | target | 93 | development improvement - not yet validated |

## 8. Does any candidate deserve a later evaluation? (the assistant's reading, derived; the owner decides)

20 result(s) cleared the target but none passed the shortlist conditions (the stress, the null, concentration and decision gain), so none is proposed for evaluation: an improvement that depends on its best few trades, on one stock, on timing no better than random, or on exposure alone is not a candidate under the pre-registered rules.


## 9. Not done

- No evaluation, no validation, no "independently evaluated" label; the evaluation window was never opened. No criterion was changed during the campaign. No order, broker, email or message.
- Failed experiments: none.
- Events of note: none beyond the run log.
