# event-swing campaign 1: results (development results on previously examined prices; simulation only)

Campaign 1, code revision `es-code-2026-11-06-1`, engine `es-engine-1`, pre-registration `3a0589f`, data manifest `677d32e800e6`, inputs `7d2ab6dff969`, calibration `9d1389268591`. Execution 0.8 minutes. Every figure is **measured** from the simulation unless marked derived; the index and the exposure-matched hold are **derived** benchmarks. Nothing here is evidence of future profit.

## Event inventory

Data manifest `677d32e800e645a512e760f786a22d673ff717ab6ebf68fd9e6d05fd5d9d2a29`. Usable events: 261 (availability 2016-01-15 to 2021-12-21); events before the window used for estimates only: 31; excluded: {}. Dependence: 213 distinct availability dates, 36 shared by several stocks, at most 4 on one date.

| Stock | First price session | Events | Usable | Negative | Positive | Neutral | Raised | Lowered | Reaffirmed | Mixed | None detected | No text | Interim | Estimates in window |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MU | 2016-01-04 | 29 | 24 | 6 | 8 | 10 | 0 | 0 | 0 | 0 | 23 | 1 | 0 | 24 |
| AMZN | 2016-01-04 | 28 | 24 | 2 | 4 | 18 | 1 | 1 | 0 | 0 | 22 | 0 | 0 | 24 |
| META | 2016-01-04 | 28 | 24 | 3 | 9 | 12 | 1 | 0 | 0 | 0 | 23 | 0 | 0 | 24 |
| TSLA | 2016-01-04 | 56 | 48 | 14 | 11 | 23 | 0 | 0 | 7 | 0 | 41 | 0 | 25 | 24 |
| VST | 2017-05-10 | 18 | 18 | 2 | 2 | 14 | 5 | 0 | 7 | 1 | 3 | 2 | 0 | 14 |
| GOOG | 2016-01-04 | 25 | 24 | 1 | 6 | 17 | 0 | 0 | 0 | 0 | 24 | 0 | 0 | 21 |
| INTC | 2016-01-04 | 29 | 25 | 8 | 6 | 11 | 11 | 0 | 5 | 0 | 9 | 0 | 1 | 24 |
| CSCO | 2016-01-04 | 28 | 24 | 6 | 5 | 13 | 0 | 0 | 0 | 0 | 24 | 0 | 0 | 24 |
| PYPL | 2016-01-04 | 31 | 30 | 4 | 9 | 17 | 9 | 0 | 1 | 1 | 13 | 6 | 6 | 21 |
| SNAP | 2017-03-02 | 20 | 20 | 10 | 8 | 2 | 0 | 0 | 0 | 0 | 19 | 1 | 1 | 15 |

Timing classes (all stocks): {"after_close":219,"filed_after_report_date":12,"non_session_day":2,"before_open":27,"during_session":1}.

| Configuration | Category | Events | Descriptive only (< 20) |
|---|---|---|---|
| A1 | estimates_in_window | 215 | no |
| A2 | estimates_in_window | 215 | no |
| B0 | negative | 56 | no |
| B1 | negative | 56 | no |
| B2 | negative_unchanged_or_raised | 11 | yes |
| B3 | negative_lowered | 0 | yes |
| C0 | usable | 261 | no |
| C1 | positive | 68 | no |
| C2 | positive_raised | 7 | yes |
| D1 | lowered | 1 | yes |
| D2 | negative | 56 | no |
| D3 | usable | 261 | no |

## Every configuration (base case) against its benchmarks

| Id | Label | Net US$ | Ann. % | Max DD % | Invested % | Trades | Costs | Index net | Exposure-matched net | T | Double costs T | Delayed T |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A0 | hold | 64054.24 | 31.98 | 34.28 | 93.44 | 0 spells | 9.88 | 68099.09 | 61291.4 | 2762.84 | 2714.97 | 2762.84 |
| A1 | event-calendar | 36774.81 | 22.97 | 31.52 | 82.65 | 192 spells | 682.44 | 68099.09 | 45705.23 | -8930.42 | -10786.63 | -8239.69 |
| A2 | event-calendar | 37300.63 | 23.18 | 30.39 | 80.83 | 199 spells | 686.19 | 68099.09 | 45469.4 | -8168.76 | -9654.08 | -8439.99 |
| B0 | event-calendar | 1046.44 | 1.13 | 17.64 | 13.11 | 52 | 203.59 | 68099.09 | 2524.71 | -1478.27 | -1670.61 | -1005.19 |
| B1 | event-calendar | 2255.39 | 2.37 | 6.89 | 8.17 | 54 | 184.32 | 68099.09 | 1289.89 | 965.5 | 787.83 | 1734.32 |
| B2 | news-understanding | -474.82 | -0.54 | 4.41 | 1.4 | 10 | 35.82 | 68099.09 | 9.49 | -484.31 | -511.84 | -281.73 |
| B3 | news-understanding | 0 | 0 | 0 | 0 | 0 | 0 | 68099.09 | 0 | 0 | 0 | 0 |
| BP | price-only | 10234.82 | 9.07 | 19.14 | 35.5 | 263 | 1056.18 | 68099.09 | 19484.7 | -9249.88 | -10812.16 | -9249.88 |
| C0 | event-calendar | 15158.44 | 12.37 | 21.13 | 44.51 | 203 | 908.34 | 68099.09 | 18094.97 | -2936.53 | -4137.95 | -3831.56 |
| C1 | event-calendar | 2065.59 | 2.18 | 8.16 | 9.68 | 66 | 169.51 | 68099.09 | 1869.46 | 196.13 | 61.2 | -950.32 |
| C2 | news-understanding | 729.02 | 0.8 | 0.95 | 1.27 | 7 | 19.21 | 68099.09 | 688.21 | 40.82 | 20.02 | 61.09 |
| CP | price-only | 14695.76 | 12.08 | 17.33 | 38.54 | 279 | 1094.48 | 68099.09 | 19336.62 | -4640.86 | -6463.41 | -4640.86 |
| D0 | price-only | 7408.12 | 6.93 | 13.72 | 17.95 | 405 | 1837.2 | 68099.09 | 1982.34 | 5425.78 | 3253.31 | 5425.78 |
| D1 | news-understanding | 7263.02 | 6.81 | 13.84 | 17.95 | 404 | 1833.88 | 68099.09 | 1973.3 | 5289.72 | 3237.25 | 5289.72 |
| D2 | event-calendar | 7206.09 | 6.77 | 12.98 | 16.65 | 377 | 1725.28 | 68099.09 | 2191.89 | 5014.21 | 2919.08 | 5140.51 |
| D3 | event-calendar | 5308.32 | 5.19 | 8.4 | 11.12 | 255 | 1175.93 | 68099.09 | 2205.55 | 3102.77 | 1829.04 | 3530.09 |

## The Holm family: placebo and selection

| Id | Raw p | Holm p | Failed resamples | Candidate | Fails |
|---|---|---|---|---|---|
| A1 | 0.9735 | 1.0000 | 0 | no | comparators, decisionGain, stress, placebo |
| A2 | 0.9175 | 1.0000 | 0 | no | comparators, decisionGain, stress, concentration, placebo |
| B1 | 1.0000 | 1.0000 | 2000 | no | comparators, stress, concentration, placebo |
| B2 | descriptive only | — | 0 | no | sample, comparators, decisionGain, stress, concentration, placebo |
| B3 | descriptive only | — | 0 | no | sample, comparators, decisionGain, stress, concentration, placebo |
| C1 | 1.0000 | 1.0000 | 2000 | no | comparators, decisionGain, stress, placebo |
| C2 | descriptive only | — | 0 | no | sample, comparators, stress, concentration, placebo |
| D1 | descriptive only | — | 0 | no | sample, comparators, stress, placebo |
| D2 | 1.0000 | 1.0000 | 2000 | no | comparators, stress, placebo |
| D3 | 1.0000 | 1.0000 | 2000 | no | comparators, stress, placebo |

**Outcome:** **NONE**: no configuration meets every condition of CAMPAIGN-1.md section 10.

## Does the news information add anything?

Compared on net profit and T at the base case: B2 and B3 (guidance words) against B1 (timing and prices only) and BP (prices only); C2 against C1 and CP; D1 against D2, D3 and D0. The guidance classes come from the fixed word rule of CAMPAIGN-1.md section 4 and nothing else.

| Pair | Net (news) | Net (calendar) | Net (price-only) | T (news) | T (calendar) | T (price-only) |
|---|---|---|---|---|---|---|
| B2 / B1 / BP | -474.82 | 2255.39 | 10234.82 | -484.31 | 965.5 | -9249.88 |
| B3 / B1 / BP | 0 | 2255.39 | 10234.82 | 0 | 965.5 | -9249.88 |
| C2 / C1 / CP | 729.02 | 2065.59 | 14695.76 | 40.82 | 196.13 | -4640.86 |
| D1 / D2 / D0 | 7263.02 | 7206.09 | 7408.12 | 5289.72 | 5014.21 | 5425.78 |

## Per configuration detail

### A0 (A, family_baseline, hold)

Annual net (US$): 2016 1770.12; 2017 7049.86; 2018 -132.41; 2019 7901.6; 2020 32170.1; 2021 15294.98. Halves: 2016-01-04 to 2018-12-31 net 8687.56, decision gain 868.23; 2019-01-02 to 2021-12-31 net 55366.68, decision gain 1894.61.
Per stock (US$): MU 8574.9; AMZN 5354.91; META 3281.03; TSLA 30318.05; VST 882.78; GOOG 4299.49; INTC 1047.24; CSCO 2425.86; PYPL 6442.72; SNAP 1427.26. Top stock TSLA 47.3% of the gross gain. Best-5% removal: 1 outcomes, net without them 33736.19.
Exits: {}. Not filled: {}. Holding sessions (median, longest): —, —. Turnover per year 0.07. Accounting reconciles.
Family A: estimates {}; spells 0, holding would have won 0, decline avoided 0; summed effect 0 (gains 0, losses 0); per stock {}.

### A1 (A, candidate, event-calendar)

Annual net (US$): 2016 1222.19; 2017 5299.41; 2018 393.23; 2019 7056.06; 2020 14858; 2021 7945.94. Halves: 2016-01-04 to 2018-12-31 net 6914.82, decision gain -990.19; 2019-01-02 to 2021-12-31 net 29859.99, decision gain -7940.23.
Per stock (US$): MU 6795.41; AMZN 3695.04; META 1873.02; TSLA 9111.35; VST 2135.6; GOOG 1658.48; INTC 2232.28; CSCO 2799.13; PYPL 6149.92; SNAP 324.58. Top stock TSLA 24.8% of the gross gain. Best-5% removal: 11 outcomes, net without them 15410.8.
Exits: {"pre_announcement_exit":192}. Not filled: {}. Holding sessions (median, longest): 60, 362. Turnover per year 6.22. Accounting reconciles.
Family A: estimates {"outside_window":42,"exited_before_actual":170,"unmatched":1,"held_through_actual_earlier":30,"exited_more_than_10_sessions_early":7,"exited_on_report_date":6}; spells 192, holding would have won 104, decline avoided 88; summed effect -3580.76 (gains 13739.63, losses -17320.39); per stock {"INTC":965.66,"META":-596,"AMZN":92.13,"CSCO":234.41,"TSLA":-2517.78,"MU":-1283.35,"GOOG":-649.32,"PYPL":293.14,"VST":970.14,"SNAP":-1089.78}.

### A2 (A, candidate, event-calendar)

Annual net (US$): 2016 872.48; 2017 4904.9; 2018 351.56; 2019 6011.23; 2020 16516.55; 2021 8643.9. Halves: 2016-01-04 to 2018-12-31 net 6128.95, decision gain -1458.62; 2019-01-02 to 2021-12-31 net 31171.68, decision gain -6710.14.
Per stock (US$): MU 7131.47; AMZN 3114.17; META 1493.92; TSLA 12301.65; VST 1826.29; GOOG 1499.51; INTC 1882.52; CSCO 2374.89; PYPL 5446.07; SNAP 230.15. Top stock TSLA 33.0% of the gross gain. Best-5% removal: 11 outcomes, net without them 13336.47.
Exits: {"pre_announcement_exit":199}. Not filled: {}. Holding sessions (median, longest): 58, 360. Turnover per year 6.48. Accounting reconciles.
Family A: estimates {"outside_window":42,"exited_before_actual":183,"unmatched":1,"held_through_actual_earlier":19,"exited_more_than_10_sessions_early":8,"exited_on_report_date":3}; spells 199, holding would have won 111, decline avoided 88; summed effect -5630.63 (gains 13536.3, losses -19166.93); per stock {"INTC":708.12,"META":-763.16,"AMZN":-0.95,"CSCO":-54.68,"TSLA":-3411.52,"MU":-1305.72,"PYPL":291.51,"GOOG":-702.11,"VST":701.18,"SNAP":-1093.3}.

### B0 (B, family_baseline, event-calendar)

Annual net (US$): 2016 354.08; 2017 2021.32; 2018 -380.73; 2019 1573.78; 2020 -2097.84; 2021 -424.17. Halves: 2016-01-04 to 2018-12-31 net 1994.67, decision gain -653.55; 2019-01-02 to 2021-12-31 net -948.23, decision gain -824.72.
Per stock (US$): MU 584.48; AMZN -59.68; META -119.87; TSLA 687.53; VST -672.38; GOOG -264.65; INTC -715.18; CSCO 690.61; PYPL -82.79; SNAP 998.38. Top stock SNAP 33.7% of the gross gain. Best-5% removal: 3 outcomes, net without them -1567.71.
Exits: {"time":52}. Not filled: {"skip:no_typical_move":{"count":1,"medianMovePct":-1.7,"rose":0,"horizonSessions":20},"skip:no_whole_share":{"count":1,"medianMovePct":2.04,"rose":1,"horizonSessions":20}}. Holding sessions (median, longest): 21, 21. Turnover per year 3.16. Accounting reconciles.
By category: {"reaction":{"negative":{"trades":52,"pnl":1046.44,"wins":27}},"guidance":{"none_detected":{"trades":42,"pnl":618.9,"wins":23},"raised":{"trades":8,"pnl":-650.14,"wins":3},"no_text":{"trades":1,"pnl":1252.29,"wins":1},"reaffirmed":{"trades":1,"pnl":-174.61,"wins":0}},"timing":{"after_close":{"trades":47,"pnl":1738.42,"wins":26},"before_open":{"trades":4,"pnl":-673.12,"wins":1},"filed_after_report_date":{"trades":1,"pnl":-18.86,"wins":0}},"interim":{"interim":{"trades":7,"pnl":515.44,"wins":5},"regular":{"trades":45,"pnl":531.01,"wins":22}},"noEvent":0}.

### B1 (B, candidate, event-calendar)

Annual net (US$): 2016 13.09; 2017 1428.84; 2018 440.04; 2019 896.15; 2020 43.61; 2021 -566.35. Halves: 2016-01-04 to 2018-12-31 net 1881.97, decision gain 769.27; 2019-01-02 to 2021-12-31 net 373.42, decision gain 196.23.
Per stock (US$): MU 1357.31; AMZN -199.25; META -261.99; TSLA -321.84; VST -184.16; GOOG -91.55; INTC 260.54; CSCO 128.1; PYPL 90.97; SNAP 1477.26. Top stock SNAP 44.6% of the gross gain. Best-5% removal: 3 outcomes, net without them 163.6.
Exits: {"invalidation":27,"time":27}. Not filled: {}. Holding sessions (median, longest): 19.5, 21. Turnover per year 2.89. Accounting reconciles.
By category: {"reaction":{"negative":{"trades":54,"pnl":2255.39,"wins":22}},"guidance":{"reaffirmed":{"trades":3,"pnl":-567.31,"wins":0},"none_detected":{"trades":43,"pnl":1857.72,"wins":19},"raised":{"trades":7,"pnl":21.78,"wins":2},"no_text":{"trades":1,"pnl":943.2,"wins":1}},"timing":{"after_close":{"trades":49,"pnl":2764.26,"wins":21},"before_open":{"trades":4,"pnl":-556.79,"wins":0},"filed_after_report_date":{"trades":1,"pnl":47.92,"wins":1}},"interim":{"regular":{"trades":46,"pnl":2388.8,"wins":18},"interim":{"trades":8,"pnl":-133.41,"wins":4}},"noEvent":0}.
Trigger fates: {"watches":55,"restarted":0,"noRecovery":1,"noRecoveryMedianMove20Pct":0.8,"noRecoveryKeptFalling":0,"recovered":54,"enteredInvalidated":27,"enteredTimedOutWithLoss":5,"enteredGained":22}.

### B2 (B, candidate, news-understanding)

Annual net (US$): 2016 -147.56; 2017 0; 2018 41.49; 2019 -348.38; 2020 141.02; 2021 -161.4. Halves: 2016-01-04 to 2018-12-31 net -106.07, decision gain -64.94; 2019-01-02 to 2021-12-31 net -368.75, decision gain -419.37.
Per stock (US$): MU 0; AMZN 0; META 0; TSLA -348.38; VST -152.46; GOOG 0; INTC 133.02; CSCO 0; PYPL -107.01; SNAP 0. Top stock INTC 100.0% of the gross gain. Best-5% removal: 1 outcomes, net without them -744.18.
Exits: {"invalidation":6,"time":4}. Not filled: {}. Holding sessions (median, longest): 11, 21. Turnover per year 0.56. Accounting reconciles.
By category: {"reaction":{"negative":{"trades":10,"pnl":-474.82,"wins":2}},"guidance":{"reaffirmed":{"trades":3,"pnl":-491.35,"wins":0},"raised":{"trades":7,"pnl":16.52,"wins":2}},"timing":{"after_close":{"trades":8,"pnl":-322.36,"wins":2},"before_open":{"trades":2,"pnl":-152.46,"wins":0}},"interim":{"regular":{"trades":9,"pnl":-311.6,"wins":2},"interim":{"trades":1,"pnl":-163.22,"wins":0}},"noEvent":0}.
Trigger fates: {"watches":11,"restarted":0,"noRecovery":1,"noRecoveryMedianMove20Pct":0.8,"noRecoveryKeptFalling":0,"recovered":10,"enteredInvalidated":6,"enteredTimedOutWithLoss":2,"enteredGained":2}.

### B3 (B, candidate, news-understanding)

Annual net (US$): 2016 0; 2017 0; 2018 0; 2019 0; 2020 0; 2021 0. Halves: 2016-01-04 to 2018-12-31 net 0, decision gain 0; 2019-01-02 to 2021-12-31 net 0, decision gain 0.
Per stock (US$): MU 0; AMZN 0; META 0; TSLA 0; VST 0; GOOG 0; INTC 0; CSCO 0; PYPL 0; SNAP 0. Top stock —  of the gross gain. Best-5% removal: 1 outcomes, net without them 0.
Exits: {}. Not filled: {}. Holding sessions (median, longest): —, —. Turnover per year 0. Accounting reconciles.
By category: {"reaction":{},"guidance":{},"timing":{},"interim":{},"noEvent":0}.
Trigger fates: {"watches":0,"restarted":0,"noRecovery":0,"noRecoveryMedianMove20Pct":null,"noRecoveryKeptFalling":0,"recovered":0,"enteredInvalidated":0,"enteredTimedOutWithLoss":0,"enteredGained":0}.

### BP (B, price_control, price-only)

Annual net (US$): 2016 1468.83; 2017 375.45; 2018 -683.81; 2019 4279.16; 2020 5085.64; 2021 -290.45. Halves: 2016-01-04 to 2018-12-31 net 1160.47, decision gain -2974.74; 2019-01-02 to 2021-12-31 net 9074.35, decision gain -6275.14.
Per stock (US$): MU 3446.79; AMZN -684.38; META 166.06; TSLA 3349.66; VST -1552.78; GOOG 1089.02; INTC 295.28; CSCO 2167.09; PYPL 2343.15; SNAP -385.07. Top stock MU 26.8% of the gross gain. Best-5% removal: 14 outcomes, net without them -1226.45.
Exits: {"invalidation":118,"time":145}. Not filled: {"skip:no_whole_share":{"count":8,"medianMovePct":-3.02,"rose":3,"horizonSessions":20},"entry_rejected:stop_above_fill":{"count":3,"medianMovePct":27.5,"rose":3,"horizonSessions":20}}. Holding sessions (median, longest): 21, 21. Turnover per year 12.14. Accounting reconciles.
By category: {"reaction":{"negative":{"trades":263,"pnl":10300.97,"wins":120}},"guidance":{"price_only":{"trades":263,"pnl":10300.97,"wins":120}},"timing":{"none":{"trades":263,"pnl":10300.97,"wins":120}},"interim":{"price_only":{"trades":263,"pnl":10300.97,"wins":120}},"noEvent":0}.
Trigger fates: {"watches":279,"restarted":199,"noRecovery":4,"noRecoveryMedianMove20Pct":-12.38,"noRecoveryKeptFalling":3,"recovered":275,"enteredInvalidated":118,"enteredTimedOutWithLoss":25,"enteredGained":120}.

### C0 (C, family_baseline, event-calendar)

Annual net (US$): 2016 -467.12; 2017 3002.17; 2018 -947.54; 2019 4642.81; 2020 5740.48; 2021 3187.64. Halves: 2016-01-04 to 2018-12-31 net 1587.51, decision gain -6407.15; 2019-01-02 to 2021-12-31 net 13570.93, decision gain 3470.62.
Per stock (US$): MU 1347.4; AMZN 889.72; META 749.85; TSLA 8720.04; VST 97.34; GOOG 788.52; INTC 518.48; CSCO 531.18; PYPL 1079.19; SNAP 436.72. Top stock TSLA 57.5% of the gross gain. Best-5% removal: 11 outcomes, net without them 1219.84.
Exits: {"time":203}. Not filled: {"skip:no_typical_move":{"count":6,"medianMovePct":-0.77,"rose":3,"horizonSessions":20},"skip:no_whole_share":{"count":24,"medianMovePct":1.12,"rose":13,"horizonSessions":20},"entry_rejected:stop_above_fill":{"count":2,"medianMovePct":-5.03,"rose":1,"horizonSessions":20}}. Holding sessions (median, longest): 21, 21. Turnover per year 10.8. Accounting reconciles.
By category: {"reaction":{"positive":{"trades":52,"pnl":2804.85,"wins":33},"neutral":{"trades":105,"pnl":10619.15,"wins":66},"negative":{"trades":46,"pnl":1528.97,"wins":26}},"guidance":{"none_detected":{"trades":154,"pnl":11934.64,"wins":97},"reaffirmed":{"trades":15,"pnl":-230.58,"wins":5},"no_text":{"trades":8,"pnl":1991.29,"wins":6},"raised":{"trades":24,"pnl":1401.14,"wins":17},"mixed":{"trades":1,"pnl":-11.66,"wins":0},"lowered":{"trades":1,"pnl":-131.86,"wins":0}},"timing":{"after_close":{"trades":166,"pnl":5103.73,"wins":102},"before_open":{"trades":24,"pnl":4271.98,"wins":14},"filed_after_report_date":{"trades":11,"pnl":5243.58,"wins":8},"non_session_day":{"trades":2,"pnl":333.68,"wins":1}},"interim":{"regular":{"trades":195,"pnl":15028.61,"wins":119},"interim":{"trades":8,"pnl":-75.63,"wins":6}},"noEvent":0}.

### C1 (C, candidate, event-calendar)

Annual net (US$): 2016 134.5; 2017 1461.26; 2018 -620.72; 2019 152.79; 2020 1745.19; 2021 -807.43. Halves: 2016-01-04 to 2018-12-31 net 975.04, decision gain -289.73; 2019-01-02 to 2021-12-31 net 1090.55, decision gain 485.86.
Per stock (US$): MU 246.79; AMZN 177.71; META 196.1; TSLA 1027.67; VST -206.3; GOOG 247.54; INTC -58.48; CSCO 515.77; PYPL 252.51; SNAP -333.71. Top stock TSLA 38.6% of the gross gain. Best-5% removal: 4 outcomes, net without them 739.16.
Exits: {"time":51,"invalidation":15}. Not filled: {"order_cancelled:no_whole_share":{"count":1,"medianMovePct":-3.05,"rose":0,"horizonSessions":20}}. Holding sessions (median, longest): 21, 21. Turnover per year 2.59. Accounting reconciles.
By category: {"reaction":{"positive":{"trades":66,"pnl":1997.1,"wins":39}},"guidance":{"none_detected":{"trades":54,"pnl":1425.31,"wins":30},"reaffirmed":{"trades":3,"pnl":-206.28,"wins":1},"raised":{"trades":7,"pnl":758.07,"wins":7},"lowered":{"trades":1,"pnl":-65.93,"wins":0},"mixed":{"trades":1,"pnl":85.94,"wins":1}},"timing":{"after_close":{"trades":59,"pnl":1730.7,"wins":34},"filed_after_report_date":{"trades":3,"pnl":0.56,"wins":2},"before_open":{"trades":4,"pnl":265.85,"wins":3}},"interim":{"regular":{"trades":57,"pnl":1207.08,"wins":32},"interim":{"trades":9,"pnl":790.02,"wins":7}},"noEvent":0}.

### C2 (C, candidate, news-understanding)

Annual net (US$): 2016 0; 2017 258.38; 2018 61.09; 2019 88.65; 2020 297.13; 2021 23.78. Halves: 2016-01-04 to 2018-12-31 net 319.47, decision gain 59.71; 2019-01-02 to 2021-12-31 net 409.55, decision gain -18.89.
Per stock (US$): MU 0; AMZN 0; META 203.93; TSLA 0; VST 23.78; GOOG 0; INTC 172.19; CSCO 0; PYPL 329.12; SNAP 0. Top stock PYPL 45.1% of the gross gain. Best-5% removal: 1 outcomes, net without them 493.09.
Exits: {"time":7}. Not filled: {}. Holding sessions (median, longest): 21, 21. Turnover per year 0.3. Accounting reconciles.
By category: {"reaction":{"positive":{"trades":7,"pnl":729.02,"wins":7}},"guidance":{"raised":{"trades":7,"pnl":729.02,"wins":7}},"timing":{"after_close":{"trades":6,"pnl":705.25,"wins":6},"before_open":{"trades":1,"pnl":23.78,"wins":1}},"interim":{"regular":{"trades":7,"pnl":729.02,"wins":7}},"noEvent":0}.

### CP (C, price_control, price-only)

Annual net (US$): 2016 361.98; 2017 1564.65; 2018 -966.8; 2019 3623.38; 2020 9399.11; 2021 713.44. Halves: 2016-01-04 to 2018-12-31 net 959.84, decision gain -1341.25; 2019-01-02 to 2021-12-31 net 13735.93, decision gain -3299.61.
Per stock (US$): MU 3041.67; AMZN 769.13; META 201.18; TSLA 5708.37; VST 66.45; GOOG -537.08; INTC 552.99; CSCO 867.11; PYPL 1148.66; SNAP 2877.28. Top stock TSLA 37.5% of the gross gain. Best-5% removal: 15 outcomes, net without them 337.03.
Exits: {"invalidation":105,"time":174}. Not filled: {"skip:no_whole_share":{"count":22,"medianMovePct":1.4,"rose":12,"horizonSessions":20},"entry_rejected:stop_above_fill":{"count":3,"medianMovePct":16.79,"rose":2,"horizonSessions":20},"order_cancelled:no_whole_share":{"count":2,"medianMovePct":-4.15,"rose":1,"horizonSessions":20}}. Holding sessions (median, longest): 21, 21. Turnover per year 12.48. Accounting reconciles.
By category: {"reaction":{"positive":{"trades":279,"pnl":14018.98,"wins":142}},"guidance":{"price_only":{"trades":279,"pnl":14018.98,"wins":142}},"timing":{"none":{"trades":279,"pnl":14018.98,"wins":142}},"interim":{"price_only":{"trades":279,"pnl":14018.98,"wins":142}},"noEvent":0}.

### D0 (D, family_baseline, price-only)

Annual net (US$): 2016 -216.81; 2017 2181.93; 2018 171.01; 2019 227.1; 2020 1692.72; 2021 3352.16. Halves: 2016-01-04 to 2018-12-31 net 2136.13, decision gain 1699.99; 2019-01-02 to 2021-12-31 net 5271.98, decision gain 3725.79.
Per stock (US$): MU 1429.95; AMZN 1673.34; META 1666.09; TSLA 1810.46; VST -59.4; GOOG 1103.7; INTC -825.95; CSCO 542.87; PYPL 185.15; SNAP -118.1. Top stock TSLA 21.5% of the gross gain. Best-5% removal: 21 outcomes, net without them 2361.96.
Exits: {"signal":400,"time":5}. Not filled: {"skip:no_whole_share":{"count":6,"medianMovePct":-1.4,"rose":2,"horizonSessions":10},"entry_rejected:stop_above_fill":{"count":9,"medianMovePct":0.96,"rose":6,"horizonSessions":10},"order_cancelled:no_whole_share":{"count":1,"medianMovePct":46.47,"rose":1,"horizonSessions":10}}. Holding sessions (median, longest): 3, 11. Turnover per year 24.08. Accounting reconciles.
By category: {"reaction":{},"guidance":{},"timing":{},"interim":{},"noEvent":405}.
Pauses: {"pausedSignals":0,"pauseEvents":0}.

### D1 (D, candidate, news-understanding)

Annual net (US$): 2016 -216.81; 2017 2181.93; 2018 171.01; 2019 227.1; 2020 1583.89; 2021 3315.91. Halves: 2016-01-04 to 2018-12-31 net 2136.13, decision gain 1699.99; 2019-01-02 to 2021-12-31 net 5126.89, decision gain 3589.73.
Per stock (US$): MU 1422.55; AMZN 1726.31; META 1621.66; TSLA 1803.74; VST -61.91; GOOG 1103.7; INTC -825.56; CSCO 537.98; PYPL 173.21; SNAP -238.65. Top stock TSLA 21.5% of the gross gain. Best-5% removal: 21 outcomes, net without them 2254.58.
Exits: {"signal":399,"time":5}. Not filled: {"skip:no_whole_share":{"count":6,"medianMovePct":-1.4,"rose":2,"horizonSessions":10},"skip:paused_after_event":{"count":2,"medianMovePct":-7.11,"rose":0,"horizonSessions":10},"entry_rejected:stop_above_fill":{"count":9,"medianMovePct":0.96,"rose":6,"horizonSessions":10},"order_cancelled:no_whole_share":{"count":1,"medianMovePct":46.47,"rose":1,"horizonSessions":10}}. Holding sessions (median, longest): 3, 11. Turnover per year 24.07. Accounting reconciles.
By category: {"reaction":{},"guidance":{},"timing":{},"interim":{},"noEvent":404}.
Pauses: {"pausedSignals":2,"pauseEvents":1}.

### D2 (D, candidate, event-calendar)

Annual net (US$): 2016 -291.32; 2017 1735.33; 2018 248.73; 2019 277.8; 2020 2330.76; 2021 2904.8. Halves: 2016-01-04 to 2018-12-31 net 1692.73, decision gain 1496.8; 2019-01-02 to 2021-12-31 net 5513.36, decision gain 3517.4.
Per stock (US$): MU 1692.93; AMZN 1736.92; META 1464.83; TSLA 1345.18; VST -50.13; GOOG 1052.15; INTC -712.06; CSCO 364.77; PYPL 23.17; SNAP 288.33. Top stock AMZN 21.8% of the gross gain. Best-5% removal: 19 outcomes, net without them 2657.09.
Exits: {"signal":373,"time":4}. Not filled: {"skip:paused_after_event":{"count":47,"medianMovePct":-0.44,"rose":22,"horizonSessions":10},"skip:no_whole_share":{"count":3,"medianMovePct":-0.68,"rose":1,"horizonSessions":10},"entry_rejected:stop_above_fill":{"count":9,"medianMovePct":0.96,"rose":6,"horizonSessions":10},"order_cancelled:no_whole_share":{"count":1,"medianMovePct":46.47,"rose":1,"horizonSessions":10}}. Holding sessions (median, longest): 3, 11. Turnover per year 22.57. Accounting reconciles.
By category: {"reaction":{},"guidance":{},"timing":{},"interim":{},"noEvent":377}.
Pauses: {"pausedSignals":47,"pauseEvents":56}.

### D3 (D, candidate, event-calendar)

Annual net (US$): 2016 -26.76; 2017 1507.05; 2018 -143.08; 2019 620.76; 2020 1471.27; 2021 1879.08. Halves: 2016-01-04 to 2018-12-31 net 1337.2, decision gain 2226.28; 2019-01-02 to 2021-12-31 net 3971.12, decision gain 876.5.
Per stock (US$): MU 1284.96; AMZN 1486.96; META 669.06; TSLA 371.7; VST 48.35; GOOG 656.7; INTC -69.47; CSCO 423.28; PYPL 196.19; SNAP 240.59. Top stock AMZN 27.7% of the gross gain. Best-5% removal: 13 outcomes, net without them 2025.66.
Exits: {"signal":251,"time":4}. Not filled: {"skip:paused_after_event":{"count":280,"medianMovePct":0.99,"rose":160,"horizonSessions":10},"entry_rejected:stop_above_fill":{"count":7,"medianMovePct":0.96,"rose":5,"horizonSessions":10}}. Holding sessions (median, longest): 3, 11. Turnover per year 15.6. Accounting reconciles.
By category: {"reaction":{},"guidance":{},"timing":{},"interim":{},"noEvent":255}.
Pauses: {"pausedSignals":280,"pauseEvents":261}.

## Limitations

One hand-picked basket of ten survivors (DATA-INVENTORY.md section 4); prices examined by 151 earlier runs; a crude fixed word rule for guidance; no expectations, no reported figures, no pre-announcement calendar, no elections or policy events (unsupported); acceptance times are upper bounds on when news was public, so every event is placed at or after the market saw it; costs are modelled, not verified fills; the placebo has little power with ten stocks and six years. Attribution between exposure and decisions is descriptive.

