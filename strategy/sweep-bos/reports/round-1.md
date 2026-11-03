# sweep-bos round 1: development runs on QQQ and SPY (stand-ins for NQ and ES)

Generated 2026-11-03T18:24:53.081Z from the recorded runs of `data/sweep-bos-sim.sqlite` by `scripts/sweepbos-report.mjs`. **Measured** = read from a stored run; **derived** = computed from measured figures. Rules: PRE-REGISTRATION.md version 1 (pre-registration commit 839ac73f550b); criteria and pick rule: its section 5. Window: DEVELOPMENT 2019-01-02 to 2022-12-30 (warm-up from 2018-06-01); bar bound 2022-12-30; latest stored date 2022-12-30; bars after the bound: 0 five-minute, 0 daily. Data version 1 (warmup-development), hash e7a619d2824847b8b94930b11ab433d414fabf2ed72afe1763d5b2990482752d, sip raw.

These are in-sample development results on data the owner has watched, after at most one round of eight pre-registered variants. Profit found by repeated retesting on the same data is not evidence; nothing here is evidence about ES or NQ or about the discretionary original (the prior regular session's high and low stand in for the session levels the original uses). No bar, price or per-fill list appears in this file.

## 1. Runs recorded (measured)

| Run | Variant | Rules | Status | Code revision | Engine | HEAD | Source hash | Started | Finished |
|---|---|---|---|---|---|---|---|---|---|
| 1 | sb-ob-a-bias-0.1.0.json | OB / stop A / bias on | done | sb-code-2026-11-03-1 | sb-engine-1 | cbd514d9e2a0 | 693fe950b97e | 2026-11-03T18:24:29.201Z | 2026-11-03T18:24:29.708Z |
| 2 | sb-ob-a-nobias-0.1.0.json | OB / stop A / bias off | done | sb-code-2026-11-03-1 | sb-engine-1 | cbd514d9e2a0 | 693fe950b97e | 2026-11-03T18:24:31.389Z | 2026-11-03T18:24:31.906Z |
| 3 | sb-ob-b-bias-0.1.0.json | OB / stop B / bias on | done | sb-code-2026-11-03-1 | sb-engine-1 | cbd514d9e2a0 | 693fe950b97e | 2026-11-03T18:24:33.411Z | 2026-11-03T18:24:33.856Z |
| 4 | sb-ob-b-nobias-0.1.0.json | OB / stop B / bias off | done | sb-code-2026-11-03-1 | sb-engine-1 | cbd514d9e2a0 | 693fe950b97e | 2026-11-03T18:24:35.474Z | 2026-11-03T18:24:35.926Z |
| 5 | sb-fvg-a-bias-0.1.0.json | FVG / stop A / bias on | done | sb-code-2026-11-03-1 | sb-engine-1 | cbd514d9e2a0 | 693fe950b97e | 2026-11-03T18:24:37.563Z | 2026-11-03T18:24:38.062Z |
| 6 | sb-fvg-a-nobias-0.1.0.json | FVG / stop A / bias off | done | sb-code-2026-11-03-1 | sb-engine-1 | cbd514d9e2a0 | 693fe950b97e | 2026-11-03T18:24:39.611Z | 2026-11-03T18:24:40.143Z |
| 7 | sb-fvg-b-bias-0.1.0.json | FVG / stop B / bias on | done | sb-code-2026-11-03-1 | sb-engine-1 | cbd514d9e2a0 | 693fe950b97e | 2026-11-03T18:24:41.767Z | 2026-11-03T18:24:42.216Z |
| 8 | sb-fvg-b-nobias-0.1.0.json | FVG / stop B / bias off | done | sb-code-2026-11-03-1 | sb-engine-1 | cbd514d9e2a0 | 693fe950b97e | 2026-11-03T18:24:43.842Z | 2026-11-03T18:24:44.300Z |

8 of 8 pre-registered variants have a completed run.

## 2. Figures per variant and instrument (PRE-REGISTRATION.md 6.5)

### sb-ob-a-bias-0.1.0.json (OB / stop A / bias on), run 1

| Figure | QQQ | SPY | Label |
|---|---|---|---|
| sessions in the window | 1008 | 1008 | measured |
| completed trades | 3 | 5 | measured |
| win rate | 0.0% | 60.0% | derived |
| mean R after costs | -1.0394 | 0.5579 | derived |
| median R | -1.0143 | 1.5134 | derived |
| profit factor | 0.000 | 2.355 | derived |
| maximum drawdown (R, exit order) | 3.12 | 2.06 | derived |
| average holding time (minutes) | 126.67 | 171.00 | derived |
| exposure by hour (share of held bars) | 10h 38.2%, 11h 15.8%, 12h 15.8%, 13h 15.8%, 14h 14.5% | 10h 21.1%, 11h 22.2%, 12h 14.6%, 13h 14.0%, 14h 14.0%, 15h 14.0% | derived |
| cost per trade: $ per share round trip | 0.04 | 0.04 | measured |
| cost per trade: mean in R | 0.0394 | 0.0289 | derived |
| mean R at 2x costs | -1.0789 | 0.5291 | derived |
| bootstrap 95% interval of the mean R (10,000, seed 20261103) | [-1.0930, -1.0110] | [-0.5210, 1.6368] | derived |
| null: mean of the 1,000 random-direction means | -0.8078 | 0.0780 | derived |
| null: 5th / 50th / 95th / 99th percentile | -1.0394 / -0.8842 / -0.5741 / -0.5741 | -1.0289 / 0.0606 / 1.1394 / 1.1394 | derived |
| null: one-sided p (seed 20261104) | 1.0000 | 0.3357 | derived |
| mean R without the best 5% (K) | -1.0537 (K = 1) | 0.2601 (K = 1) | derived |
| largest monthly share of gross gains (month) | n/a (n/a) | 0.361 (2019-06) | derived |
| gross gain / gross loss (R) | 0.00 / 3.12 | 4.85 / 2.06 | derived |
| long trades: n, mean R | 3, -1.0394 | 3, -0.1819 | derived |
| short trades: n, mean R | 0, n/a | 2, 1.6676 | derived |
| outcomes: stop (of which same bar) / target / time | 3 (0) / 0 / 0 | 2 (0) / 1 / 2 | measured |
| dollar account, information only: ending cash, max drawdown ($) | 14641.00, 359.00 | 15210.96, 113.13 | measured |

Pooled (both instruments, exit order): 8 trades, mean R -0.0411, maximum drawdown 5.18 R (derived).

### sb-ob-a-nobias-0.1.0.json (OB / stop A / bias off), run 2

| Figure | QQQ | SPY | Label |
|---|---|---|---|
| sessions in the window | 1008 | 1008 | measured |
| completed trades | 8 | 7 | measured |
| win rate | 25.0% | 42.9% | derived |
| mean R after costs | -0.3511 | 0.1057 | derived |
| median R | -1.0120 | -1.0179 | derived |
| profit factor | 0.527 | 1.180 | derived |
| maximum drawdown (R, exit order) | 3.91 | 4.11 | derived |
| average holding time (minutes) | 194.38 | 166.43 | derived |
| exposure by hour (share of held bars) | 10h 22.5%, 11h 19.3%, 12h 16.1%, 13h 15.4%, 14h 15.1%, 15h 11.6% | 10h 23.2%, 11h 21.9%, 12h 15.9%, 13h 15.5%, 14h 13.3%, 15h 10.3% | derived |
| cost per trade: $ per share round trip | 0.04 | 0.04 | measured |
| cost per trade: mean in R | 0.0379 | 0.0277 | derived |
| mean R at 2x costs | -0.3890 | 0.0780 | derived |
| bootstrap 95% interval of the mean R (10,000, seed 20261103) | [-1.0156, 0.5275] | [-0.6697, 1.1840] | derived |
| null: mean of the 1,000 random-direction means | -0.1823 | -0.1035 | derived |
| null: 5th / 50th / 95th / 99th percentile | -0.7741 / -0.1715 / 0.3931 / 0.5779 | -0.6841 / -0.2135 / 0.5210 / 0.8647 | derived |
| null: one-sided p (seed 20261104) | 0.6813 | 0.3037 | derived |
| mean R without the best 5% (K) | -0.7360 (K = 1) | -0.1682 (K = 1) | derived |
| largest monthly share of gross gains (month) | 0.749 (2021-09) | 0.361 (2019-06) | derived |
| gross gain / gross loss (R) | 3.13 / 5.94 | 4.85 / 4.11 | derived |
| long trades: n, mean R | 3, -1.0394 | 4, -0.3934 | derived |
| short trades: n, mean R | 5, 0.0619 | 3, 0.7712 | derived |
| outcomes: stop (of which same bar) / target / time | 5 (0) / 0 / 3 | 4 (0) / 1 / 2 | measured |
| dollar account, information only: ending cash, max drawdown ($) | 14501.75, 534.44 | 15033.93, 290.16 | measured |

Pooled (both instruments, exit order): 15 trades, mean R -0.1379, maximum drawdown 7.70 R (derived).

### sb-ob-b-bias-0.1.0.json (OB / stop B / bias on), run 3

| Figure | QQQ | SPY | Label |
|---|---|---|---|
| sessions in the window | 1008 | 1008 | measured |
| completed trades | 1 | 3 | measured |
| win rate | 0.0% | 66.7% | derived |
| mean R after costs | -1.0252 | 1.6708 | derived |
| median R | -1.0252 | 2.9575 | derived |
| profit factor | 0.000 | 5.846 | derived |
| maximum drawdown (R, exit order) | 1.03 | 1.03 | derived |
| average holding time (minutes) | 15.00 | 160.00 | derived |
| exposure by hour (share of held bars) | 10h 100.0% | 10h 24.0%, 11h 25.0%, 12h 13.5%, 13h 12.5%, 14h 12.5%, 15h 12.5% | derived |
| cost per trade: $ per share round trip | 0.04 | 0.04 | measured |
| cost per trade: mean in R | 0.0252 | 0.0457 | derived |
| mean R at 2x costs | -1.0503 | 1.6252 | derived |
| bootstrap 95% interval of the mean R (10,000, seed 20261103) | [-1.0252, -1.0252] | [-1.0345, 3.0896] | derived |
| null: mean of the 1,000 random-direction means | -1.0252 | 0.3222 | derived |
| null: 5th / 50th / 95th / 99th percentile | -1.0252 / -1.0252 / -1.0252 / -1.0252 | -1.0457 / 0.3275 / 1.6708 / 1.6708 | derived |
| null: one-sided p (seed 20261104) | 1.0000 | 0.2667 | derived |
| mean R without the best 5% (K) | n/a (K = 1) | 0.9615 (K = 1) | derived |
| largest monthly share of gross gains (month) | n/a (n/a) | 0.511 (2022-07) | derived |
| gross gain / gross loss (R) | 0.00 / 1.03 | 6.05 / 1.03 | derived |
| long trades: n, mean R | 1, -1.0252 | 1, -1.0345 | derived |
| short trades: n, mean R | 0, n/a | 2, 3.0235 | derived |
| outcomes: stop (of which same bar) / target / time | 1 (0) / 0 / 0 | 1 (0) / 1 / 1 | measured |
| dollar account, information only: ending cash, max drawdown ($) | 14926.65, 73.35 | 15194.12, 42.02 | measured |

Pooled (both instruments, exit order): 4 trades, mean R 0.9968, maximum drawdown 2.06 R (derived).

### sb-ob-b-nobias-0.1.0.json (OB / stop B / bias off), run 4

| Figure | QQQ | SPY | Label |
|---|---|---|---|
| sessions in the window | 1008 | 1008 | measured |
| completed trades | 2 | 3 | measured |
| win rate | 0.0% | 66.7% | derived |
| mean R after costs | -1.1049 | 1.6708 | derived |
| median R | -1.1049 | 2.9575 | derived |
| profit factor | 0.000 | 5.846 | derived |
| maximum drawdown (R, exit order) | 2.21 | 1.03 | derived |
| average holding time (minutes) | 40.00 | 160.00 | derived |
| exposure by hour (share of held bars) | 10h 68.8%, 11h 31.3% | 10h 24.0%, 11h 25.0%, 12h 13.5%, 13h 12.5%, 14h 12.5%, 15h 12.5% | derived |
| cost per trade: $ per share round trip | 0.04 | 0.04 | measured |
| cost per trade: mean in R | 0.1049 | 0.0457 | derived |
| mean R at 2x costs | -1.2098 | 1.6252 | derived |
| bootstrap 95% interval of the mean R (10,000, seed 20261103) | [-1.1847, -1.0252] | [-1.0345, 3.0896] | derived |
| null: mean of the 1,000 random-direction means | -1.1049 | 0.3222 | derived |
| null: 5th / 50th / 95th / 99th percentile | -1.1049 / -1.1049 / -1.1049 / -1.1049 | -1.0457 / 0.3275 / 1.6708 / 1.6708 | derived |
| null: one-sided p (seed 20261104) | 1.0000 | 0.2667 | derived |
| mean R without the best 5% (K) | -1.1847 (K = 1) | 0.9615 (K = 1) | derived |
| largest monthly share of gross gains (month) | n/a (n/a) | 0.511 (2022-07) | derived |
| gross gain / gross loss (R) | 0.00 / 2.21 | 6.05 / 1.03 | derived |
| long trades: n, mean R | 1, -1.0252 | 1, -1.0345 | derived |
| short trades: n, mean R | 1, -1.1847 | 2, 3.0235 | derived |
| outcomes: stop (of which same bar) / target / time | 2 (0) / 0 / 0 | 1 (0) / 1 / 1 | measured |
| dollar account, information only: ending cash, max drawdown ($) | 14906.89, 93.11 | 15194.12, 42.02 | measured |

Pooled (both instruments, exit order): 5 trades, mean R 0.5605, maximum drawdown 3.24 R (derived).

### sb-fvg-a-bias-0.1.0.json (FVG / stop A / bias on), run 5

| Figure | QQQ | SPY | Label |
|---|---|---|---|
| sessions in the window | 1008 | 1008 | measured |
| completed trades | 3 | 4 | measured |
| win rate | 0.0% | 50.0% | derived |
| mean R after costs | -0.6776 | 0.1531 | derived |
| median R | -1.0100 | 0.1396 | derived |
| profit factor | 0.000 | 1.299 | derived |
| maximum drawdown (R, exit order) | 2.03 | 2.05 | derived |
| average holding time (minutes) | 243.33 | 131.25 | derived |
| exposure by hour (share of held bars) | 10h 18.5%, 11h 16.4%, 12h 16.4%, 13h 16.4%, 14h 16.4%, 15h 15.8% | 10h 28.6%, 11h 24.8%, 12h 12.4%, 13h 11.4%, 14h 11.4%, 15h 11.4% | derived |
| cost per trade: $ per share round trip | 0.04 | 0.04 | measured |
| cost per trade: mean in R | 0.0135 | 0.0254 | derived |
| mean R at 2x costs | -0.6911 | 0.1277 | derived |
| bootstrap 95% interval of the mean R (10,000, seed 20261103) | [-1.0152, -0.0077] | [-1.0254, 1.3316] | derived |
| null: mean of the 1,000 random-direction means | -0.4522 | -0.1294 | derived |
| null: 5th / 50th / 95th / 99th percentile | -1.0135 / -0.5524 / 0.1009 / 0.1009 | -1.0254 / 0.1531 / 0.7556 / 0.7556 | derived |
| null: one-sided p (seed 20261104) | 0.7662 | 0.5045 | derived |
| mean R without the best 5% (K) | -1.0126 (K = 1) | -0.2517 (K = 1) | derived |
| largest monthly share of gross gains (month) | n/a (n/a) | 0.513 (2019-06) | derived |
| gross gain / gross loss (R) | 0.00 / 2.03 | 2.66 / 2.05 | derived |
| long trades: n, mean R | 1, -1.0152 | 2, -1.0254 | derived |
| short trades: n, mean R | 2, -0.5088 | 2, 1.3316 | derived |
| outcomes: stop (of which same bar) / target / time | 2 (0) / 0 / 1 | 2 (0) / 1 / 1 | measured |
| dollar account, information only: ending cash, max drawdown ($) | 14715.83, 284.17 | 15091.18, 125.10 | measured |

Pooled (both instruments, exit order): 7 trades, mean R -0.2029, maximum drawdown 4.08 R (derived).

### sb-fvg-a-nobias-0.1.0.json (FVG / stop A / bias off), run 6

| Figure | QQQ | SPY | Label |
|---|---|---|---|
| sessions in the window | 1008 | 1008 | measured |
| completed trades | 5 | 5 | measured |
| win rate | 40.0% | 60.0% | derived |
| mean R after costs | 0.1741 | 0.3222 | derived |
| median R | -0.0077 | 0.9989 | derived |
| profit factor | 1.428 | 1.786 | derived |
| maximum drawdown (R, exit order) | 2.03 | 2.05 | derived |
| average holding time (minutes) | 255.00 | 136.00 | derived |
| exposure by hour (share of held bars) | 10h 16.9%, 11h 18.8%, 12h 18.8%, 13h 17.6%, 14h 14.1%, 15h 13.7% | 10h 30.1%, 11h 27.9%, 12h 15.4%, 13h 8.8%, 14h 8.8%, 15h 8.8% | derived |
| cost per trade: $ per share round trip | 0.04 | 0.04 | measured |
| cost per trade: mean in R | 0.0232 | 0.0276 | derived |
| mean R at 2x costs | 0.1509 | 0.2947 | derived |
| bootstrap 95% interval of the mean R (10,000, seed 20261103) | [-0.8116, 1.2606] | [-0.6206, 1.2650] | derived |
| null: mean of the 1,000 random-direction means | -0.1796 | -0.1164 | derived |
| null: 5th / 50th / 95th / 99th percentile | -0.9481 / -0.1783 / 0.5661 / 0.6412 | -1.0276 / -0.1385 / 0.8043 / 0.8043 | derived |
| null: one-sided p (seed 20261104) | 0.2707 | 0.3037 | derived |
| mean R without the best 5% (K) | -0.3336 (K = 1) | 0.0610 (K = 1) | derived |
| largest monthly share of gross gains (month) | 0.759 (2022-06) | 0.373 (2019-06) | derived |
| gross gain / gross loss (R) | 2.90 / 2.03 | 3.66 / 2.05 | derived |
| long trades: n, mean R | 2, 0.5949 | 2, -1.0254 | derived |
| short trades: n, mean R | 3, -0.1064 | 3, 1.2207 | derived |
| outcomes: stop (of which same bar) / target / time | 2 (0) / 1 / 2 | 2 (0) / 2 / 1 | measured |
| dollar account, information only: ending cash, max drawdown ($) | 15098.39, 286.85 | 15146.15, 125.10 | measured |

Pooled (both instruments, exit order): 10 trades, mean R 0.2482, maximum drawdown 4.08 R (derived).

### sb-fvg-b-bias-0.1.0.json (FVG / stop B / bias on), run 7

| Figure | QQQ | SPY | Label |
|---|---|---|---|
| sessions in the window | 1008 | 1008 | measured |
| completed trades | 1 | 3 | measured |
| win rate | 0.0% | 66.7% | derived |
| mean R after costs | -1.0279 | 1.1201 | derived |
| median R | -1.0279 | 2.1094 | derived |
| profit factor | 0.000 | 4.261 | derived |
| maximum drawdown (R, exit order) | 1.03 | 1.03 | derived |
| average holding time (minutes) | 15.00 | 161.67 | derived |
| exposure by hour (share of held bars) | 10h 100.0% | 10h 24.7%, 11h 24.7%, 12h 13.4%, 13h 12.4%, 14h 12.4%, 15h 12.4% | derived |
| cost per trade: $ per share round trip | 0.04 | 0.04 | measured |
| cost per trade: mean in R | 0.0279 | 0.0372 | derived |
| mean R at 2x costs | -1.0557 | 1.0830 | derived |
| bootstrap 95% interval of the mean R (10,000, seed 20261103) | [-1.0279, -1.0279] | [-1.0304, 2.2814] | derived |
| null: mean of the 1,000 random-direction means | -1.0279 | 0.0492 | derived |
| null: 5th / 50th / 95th / 99th percentile | -1.0279 / -1.0279 / -1.0279 / -1.0279 | -1.0372 / 0.0646 / 1.1201 / 1.1201 | derived |
| null: one-sided p (seed 20261104) | 1.0000 | 0.2667 | derived |
| mean R without the best 5% (K) | n/a (K = 1) | 0.5395 (K = 1) | derived |
| largest monthly share of gross gains (month) | n/a (n/a) | 0.520 (2022-07) | derived |
| gross gain / gross loss (R) | 0.00 / 1.03 | 4.39 / 1.03 | derived |
| long trades: n, mean R | 1, -1.0279 | 1, -1.0304 | derived |
| short trades: n, mean R | 0, n/a | 2, 2.1954 | derived |
| outcomes: stop (of which same bar) / target / time | 1 (0) / 0 / 0 | 1 (0) / 1 / 1 | measured |
| dollar account, information only: ending cash, max drawdown ($) | 14933.63, 66.37 | 15168.88, 47.40 | measured |

Pooled (both instruments, exit order): 4 trades, mean R 0.5831, maximum drawdown 2.06 R (derived).

### sb-fvg-b-nobias-0.1.0.json (FVG / stop B / bias off), run 8

| Figure | QQQ | SPY | Label |
|---|---|---|---|
| sessions in the window | 1008 | 1008 | measured |
| completed trades | 2 | 3 | measured |
| win rate | 0.0% | 66.7% | derived |
| mean R after costs | -1.0950 | 1.1201 | derived |
| median R | -1.0950 | 2.1094 | derived |
| profit factor | 0.000 | 4.261 | derived |
| maximum drawdown (R, exit order) | 2.19 | 1.03 | derived |
| average holding time (minutes) | 40.00 | 161.67 | derived |
| exposure by hour (share of held bars) | 10h 68.8%, 11h 31.3% | 10h 24.7%, 11h 24.7%, 12h 13.4%, 13h 12.4%, 14h 12.4%, 15h 12.4% | derived |
| cost per trade: $ per share round trip | 0.04 | 0.04 | measured |
| cost per trade: mean in R | 0.0950 | 0.0372 | derived |
| mean R at 2x costs | -1.1901 | 1.0830 | derived |
| bootstrap 95% interval of the mean R (10,000, seed 20261103) | [-1.1622, -1.0279] | [-1.0304, 2.2814] | derived |
| null: mean of the 1,000 random-direction means | -1.0950 | 0.0492 | derived |
| null: 5th / 50th / 95th / 99th percentile | -1.0950 / -1.0950 / -1.0950 / -1.0950 | -1.0372 / 0.0646 / 1.1201 / 1.1201 | derived |
| null: one-sided p (seed 20261104) | 1.0000 | 0.2667 | derived |
| mean R without the best 5% (K) | -1.1622 (K = 1) | 0.5395 (K = 1) | derived |
| largest monthly share of gross gains (month) | n/a (n/a) | 0.520 (2022-07) | derived |
| gross gain / gross loss (R) | 0.00 / 2.19 | 4.39 / 1.03 | derived |
| long trades: n, mean R | 1, -1.0279 | 1, -1.0304 | derived |
| short trades: n, mean R | 1, -1.1622 | 2, 2.1954 | derived |
| outcomes: stop (of which same bar) / target / time | 2 (0) / 0 / 0 | 1 (0) / 1 / 1 | measured |
| dollar account, information only: ending cash, max drawdown ($) | 14911.56, 88.44 | 15168.88, 47.40 | measured |

Pooled (both instruments, exit order): 5 trades, mean R 0.2341, maximum drawdown 3.22 R (derived).

## 3. Candidate table (PRE-REGISTRATION.md section 5; derived from measured figures)

C1 at least 100 trades; C2 mean R > 0 and bootstrap lower bound > 0; C3 mean R at 2x costs > 0; C4 null p < 0.05; C5 mean R > 0 without the best 5%; C6 largest monthly share <= 0.4. A candidate passes all six on every instrument.

| Variant | QQQ C1 C2 C3 C4 C5 C6 | SPY C1 C2 C3 C4 C5 C6 | QQQ passes | SPY passes | Candidate |
|---|---|---|---|---|---|
| sb-ob-a-bias-0.1.0.json | FAIL FAIL FAIL FAIL FAIL FAIL | FAIL FAIL pass FAIL pass pass | no | no | **no** |
| sb-ob-a-nobias-0.1.0.json | FAIL FAIL FAIL FAIL FAIL FAIL | FAIL FAIL pass FAIL FAIL pass | no | no | **no** |
| sb-ob-b-bias-0.1.0.json | FAIL FAIL FAIL FAIL FAIL FAIL | FAIL FAIL pass FAIL pass FAIL | no | no | **no** |
| sb-ob-b-nobias-0.1.0.json | FAIL FAIL FAIL FAIL FAIL FAIL | FAIL FAIL pass FAIL pass FAIL | no | no | **no** |
| sb-fvg-a-bias-0.1.0.json | FAIL FAIL FAIL FAIL FAIL FAIL | FAIL FAIL pass FAIL FAIL FAIL | no | no | **no** |
| sb-fvg-a-nobias-0.1.0.json | FAIL FAIL pass FAIL FAIL FAIL | FAIL FAIL pass FAIL pass pass | no | no | **no** |
| sb-fvg-b-bias-0.1.0.json | FAIL FAIL FAIL FAIL FAIL FAIL | FAIL FAIL pass FAIL pass FAIL | no | no | **no** |
| sb-fvg-b-nobias-0.1.0.json | FAIL FAIL FAIL FAIL FAIL FAIL | FAIL FAIL pass FAIL pass FAIL | no | no | **no** |

## 4. Outcome and the pick rule (report only)

Candidates: none.
Pick rule (pooled mean R, ties within 0.02 R to the smaller pooled drawdown): **NONE advances**. no variant qualifies on both instruments: NONE advances.

| Rank | Variant | Candidate | Pooled mean R | Pooled max drawdown (R) |
|---|---|---|---|---|
| 1 | sb-ob-b-bias-0.1.0.json | no | 0.9968 | 2.06 |
| 2 | sb-fvg-b-bias-0.1.0.json | no | 0.5831 | 2.06 |
| 3 | sb-ob-b-nobias-0.1.0.json | no | 0.5605 | 3.24 |
| 4 | sb-fvg-a-nobias-0.1.0.json | no | 0.2482 | 4.08 |
| 5 | sb-fvg-b-nobias-0.1.0.json | no | 0.2341 | 3.22 |
| 6 | sb-ob-a-bias-0.1.0.json | no | -0.0411 | 5.18 |
| 7 | sb-ob-a-nobias-0.1.0.json | no | -0.1379 | 7.70 |
| 8 | sb-fvg-a-bias-0.1.0.json | no | -0.2029 | 4.08 |

The best ending value of the dollar account is never the pick. A pick here is a candidate for the owner's review and for the one-time evaluation run (Part F, separately authorized), nothing more.

## 5. Stages: where each session ended (PRE-REGISTRATION.md section 7; measured counts, derived shares)

| Stage | sb-ob-a-bias QQQ | sb-ob-a-bias SPY | sb-ob-a-nobias QQQ | sb-ob-a-nobias SPY | sb-ob-b-bias QQQ | sb-ob-b-bias SPY | sb-ob-b-nobias QQQ | sb-ob-b-nobias SPY | sb-fvg-a-bias QQQ | sb-fvg-a-bias SPY | sb-fvg-a-nobias QQQ | sb-fvg-a-nobias SPY | sb-fvg-b-bias QQQ | sb-fvg-b-bias SPY | sb-fvg-b-nobias QQQ | sb-fvg-b-nobias SPY |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| incomplete_session | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) |
| no_prior_session | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) | 4 (0.4%) | 5 (0.5%) |
| no_bias | 341 (33.8%) | 369 (36.6%) | 0 (0.0%) | 0 (0.0%) | 341 (33.8%) | 369 (36.6%) | 0 (0.0%) | 0 (0.0%) | 341 (33.8%) | 369 (36.6%) | 0 (0.0%) | 0 (0.0%) | 341 (33.8%) | 369 (36.6%) | 0 (0.0%) | 0 (0.0%) |
| no_buffer | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) |
| no_sweep | 564 (56.0%) | 542 (53.8%) | 686 (68.1%) | 744 (73.8%) | 564 (56.0%) | 542 (53.8%) | 686 (68.1%) | 744 (73.8%) | 564 (56.0%) | 542 (53.8%) | 686 (68.1%) | 744 (73.8%) | 564 (56.0%) | 542 (53.8%) | 686 (68.1%) | 744 (73.8%) |
| sweep_invalidated | 45 (4.5%) | 42 (4.2%) | 176 (17.5%) | 141 (14.0%) | 45 (4.5%) | 42 (4.2%) | 176 (17.5%) | 141 (14.0%) | 45 (4.5%) | 42 (4.2%) | 176 (17.5%) | 141 (14.0%) | 45 (4.5%) | 42 (4.2%) | 176 (17.5%) | 141 (14.0%) |
| no_bos | 29 (2.9%) | 30 (3.0%) | 89 (8.8%) | 77 (7.6%) | 29 (2.9%) | 30 (3.0%) | 89 (8.8%) | 77 (7.6%) | 29 (2.9%) | 30 (3.0%) | 89 (8.8%) | 77 (7.6%) | 29 (2.9%) | 30 (3.0%) | 89 (8.8%) | 77 (7.6%) |
| no_zone | 8 (0.8%) | 2 (0.2%) | 22 (2.2%) | 9 (0.9%) | 8 (0.8%) | 2 (0.2%) | 22 (2.2%) | 9 (0.9%) | 9 (0.9%) | 9 (0.9%) | 21 (2.1%) | 23 (2.3%) | 9 (0.9%) | 9 (0.9%) | 21 (2.1%) | 23 (2.3%) |
| entry_not_inside_close | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) |
| no_second_swing | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 4 (0.4%) | 7 (0.7%) | 15 (1.5%) | 16 (1.6%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 6 (0.6%) | 2 (0.2%) | 18 (1.8%) | 6 (0.6%) |
| stop_not_beyond_entry | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 1 (0.1%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) |
| target_too_close | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 1 (0.1%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 1 (0.1%) | 1 (0.1%) | 0 (0.0%) | 6 (0.6%) | 1 (0.1%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 1 (0.1%) |
| order_expired | 10 (1.0%) | 8 (0.8%) | 19 (1.9%) | 19 (1.9%) | 8 (0.8%) | 3 (0.3%) | 9 (0.9%) | 7 (0.7%) | 8 (0.8%) | 2 (0.2%) | 17 (1.7%) | 7 (0.7%) | 5 (0.5%) | 1 (0.1%) | 8 (0.8%) | 3 (0.3%) |
| filled | 3 (0.3%) | 5 (0.5%) | 8 (0.8%) | 7 (0.7%) | 1 (0.1%) | 3 (0.3%) | 2 (0.2%) | 3 (0.3%) | 3 (0.3%) | 4 (0.4%) | 5 (0.5%) | 5 (0.5%) | 1 (0.1%) | 3 (0.3%) | 2 (0.2%) | 3 (0.3%) |
| filled, then: stop / target / time | 3 / 0 / 0 | 2 / 1 / 2 | 5 / 0 / 3 | 4 / 1 / 2 | 1 / 0 / 0 | 1 / 1 / 1 | 2 / 0 / 0 | 1 / 1 / 1 | 2 / 0 / 1 | 2 / 1 / 1 | 2 / 1 / 2 | 2 / 2 / 1 | 1 / 0 / 0 | 1 / 1 / 1 | 2 / 0 / 0 | 1 / 1 / 1 |

## 6. Dollar account (information only; US$15,000 per variant and instrument, cash-limited whole shares, no leverage)

| Variant | QQQ ending cash | SPY ending cash | QQQ max drawdown $ | SPY max drawdown $ |
|---|---|---|---|---|
| sb-ob-a-bias-0.1.0.json | 14641.00 | 15210.96 | 359.00 | 113.13 |
| sb-ob-a-nobias-0.1.0.json | 14501.75 | 15033.93 | 534.44 | 290.16 |
| sb-ob-b-bias-0.1.0.json | 14926.65 | 15194.12 | 73.35 | 42.02 |
| sb-ob-b-nobias-0.1.0.json | 14906.89 | 15194.12 | 93.11 | 42.02 |
| sb-fvg-a-bias-0.1.0.json | 14715.83 | 15091.18 | 284.17 | 125.10 |
| sb-fvg-a-nobias-0.1.0.json | 15098.39 | 15146.15 | 286.85 | 125.10 |
| sb-fvg-b-bias-0.1.0.json | 14933.63 | 15168.88 | 66.37 | 47.40 |
| sb-fvg-b-nobias-0.1.0.json | 14911.56 | 15168.88 | 88.44 | 47.40 |

Never the pick; sizing is irrelevant to R.


## 7. Plain outcome (Part D)

No variant is a candidate. Every (variant, instrument) cell fails C1: the most populated cell has 8 completed trades on QQQ and 7 on SPY in four years (sb-ob-a-nobias), against the pre-registered 100. With samples of 1 to 8 trades, C2 to C6 are not interpretable and the mean R values in section 2 (from -0.20 to +1.00 pooled) are noise, not an edge or its absence. **NONE advances.** By PRE-REGISTRATION.md section 9 that is a valid, expected outcome; nothing from round 1 is a candidate for the evaluation window.

## 8. Diagnosis by stage (Part E)

All counts below are measured stage counts of the recorded runs (the sb_sessions and sb_trades rows of `data/sweep-bos-sim.sqlite`); the shares and the funnel are derived. The stages before the zone depend only on the bias setting, so the zone and stop variants share them.

**The funnel (bias off; per instrument over 1,008 development sessions).**

| Stage (derived from the stage counts) | QQQ | SPY |
|---|---|---|
| sessions tradeable (complete, with a prior session) | 1,000 | 998 |
| a sweep bar in 09:30-09:55 (stage reached) | 314 (31.4%) | 254 (25.5%) |
| of those, voided by a close back beyond the level (H7) | 176 (56.1% of sweeps) | 141 (55.5%) |
| of those, no confirmed break of structure by the 10:25 bar | 89 (28.3%) | 77 (30.3%) |
| a break of structure found | 49 (15.6% of sweeps; 4.9% of sessions) | 36 (14.2%; 3.6%) |
| order block found (sb-ob-a-nobias) | 27 of 49 | 27 of 36 |
| fair value gap found (sb-fvg-a-nobias) | 28 of 49 | 13 of 36 |
| second confirmed swing for stop B (sb-ob-b-nobias) | 11 of 27 orders survive | 10 of 27 |
| order placed, OB stop A | 27 | 26 (one target too close) |
| of those, expired unfilled by 10:25 (zone never touched) | 19 (70%) | 19 (73%) |
| filled | 8 | 7 |
| filled, then: stop / target / time | 5 / 0 / 3 | 4 / 1 / 2 |

With the bias on, 341 (QQQ) and 369 (SPY) sessions (33.8% and 36.6%) have no bias at all (fewer than two confirmed daily swings of each kind both rising or both falling), and the sweep must match the bias: 95 and 87 sweeps survive, 21 and 15 reach a break of structure, 13 and 13 have an order block, and 3 and 5 trades fill (sb-ob-a-bias).

**Which rules produced the losses and the missing trades, stage by stage.**

1. *Sweep found.* A sweep of the prior session's high or low inside 09:30-09:55 occurs on a quarter to a third of sessions. This is the model's own selectivity and not a defect; it caps the trade count at roughly 250-310 per instrument over four years before any later rule.
2. *Sweep voided (H7, the author's synthesis).* More than half of the sweeps are voided by a later 5-minute close back beyond the level before any break of structure. This single rule removes more setups than every other rule combined. It is not TJR's rule; it was the author's conservative reading of a "failed sweep".
3. *Break of structure found.* Of the surviving setups, a quarter to a third never get a confirmed break by the 10:25 bar. The cause is mechanical: a swing high needs three later bars to confirm and the break must come on a bar after that (H2, H8), so the earliest possible break is the fifth bar after the swing; in run 2 the break came on bars 5 to 11 with the 10:25 bar (index 11) the most common on QQQ (11 of 49), an order placed at 10:30:00 that can never fill.
4. *Zone found.* The order block is missing in 22 of 49 (QQQ) and 9 of 36 (SPY) breaks, and in 18 of those 22 and 8 of those 9 the sweep was the opening bar (index 0): with session-local structure (H12) nothing precedes it, so no opposite-colour bar can exist at or before the leg's extreme. The fair value gap is missing in 21 of 49 and 23 of 36 breaks (the displacement legs rarely leave a three-bar gap at this bar size). Stop B removes a further 16 of 27 and 17 of 27 order-block setups for want of a second confirmed swing low by the break.
5. *Zone touched.* Seven in ten orders expire: after the break the pullback to the zone's near edge does not come before the 10:25 bar. Because the break itself tends to come late (stage 3), the order is usually alive for one to five bars.
6. *Stop hit, target hit, time stop.* Of the 15 fills of sb-ob-a-nobias, 9 were stopped, 1 reached the target and 5 ran to the time stop. In R, the stops cost -5.17 (QQQ) and -4.11 (SPY), the one target gave +1.75, and the time-stop exits gave +2.36 and +3.10: the losses are the stop-outs at the stop-A level (sweep extreme minus the 20-session buffer), and the trades that survived them closed with gains at 15:55 without ever reaching the target, which sat 2.5 to 2.7 planned risks away on average (mean reward-to-risk at entry 2.67 and 2.53). Stop B is tighter (mean planned risk $0.90-1.02 per share against $1.65-1.75 for stop A), which makes the round-trip cost 0.05-0.10 R per trade instead of 0.03-0.04, and its cells hold 1 to 3 trades. Across all 58 fills of the eight runs (the same sessions recur across variants, so these are not independent), the 28 long trades averaged -0.73 R and the 30 short trades +0.98 R: a note for the owner, not a finding; no direction filter is proposed from it.

**Hypotheses implicated** (PRE-REGISTRATION.md section 8): H7 (invalidation) and H12 (session-local structure, latest-bar leg start) are the author's and account for most of the missing trades; H2 and H8 (three-bar confirmation, break only after it) are the owner's and push the break late; H13 (fills only until the 10:25 bar, one setup per session) then turns most breaks into expired orders. The levels themselves (H4, the prior regular session's extremes in place of the original's session levels) stand behind the low sweep rate and the far target.

**What round 1 cannot say.** Nothing here tests the original's logic: the levels are stand-ins, the sample is 1 to 8 trades per cell, and the sessions were watched by the owner. The dollar-account rows (section 6) are information only.

## 9. Round-2 proposal (Part E; at most four variants; NOT run)

Purpose: a sample large enough for the pre-registered tests to mean anything, with the fewest changes to the mechanised rules. Base: `sb-ob-a-nobias` (the most populated cell; the owner's simplest zone and stop; bias off, because the bias rule alone removes a third of the sessions and the daily bias is the author's synthesis). Each proposal is one change from the base; the fourth combines the three. None is expected to produce a positive edge; the expectation is a larger sample. If round 2 still falls short of 100 trades per instrument, the model as mechanised is untestable on these stand-ins at 5 minutes and the honest outcome is NONE.

| # | File (to be written and pinned before any run) | The one change | Reason from the diagnosis |
|---|---|---|---|
| R2-1 | `sb-ob-a-nobias-cutoff1100-0.2.0.json` | the break of structure may occur on bars through index 17 (10:55) and the order is good for fills through index 17; nothing else changes | 28-30% of setups had no break by 10:25 and 70-73% of orders expired; the break distribution peaks at 10:20-10:25 (stage 3, 5) |
| R2-2 | `sb-ob-a-nobias-xsession-0.2.0.json` | structure across the session boundary: the 5-minute swings, the order-block search and the fair value gap may use the previous session's last twelve bars (14:55-15:55) as the bars preceding today's index 0; the levels, the sweep window and the time stop are unchanged | 82-89% of the missing order blocks were opening-bar sweeps with nothing before them; earlier confirmed swings would also allow a break before 09:55 (stage 3, 4) |
| R2-3 | `sb-ob-a-nobias-noinval-0.2.0.json` | H7 dropped: a close back beyond the swept level no longer voids the setup; the sweep extreme keeps following the lowest low, and the setup ends only at a break of structure or at the cutoff | 55-56% of sweeps were voided by an author's rule (stage 2) |
| R2-4 | `sb-ob-a-nobias-combined-0.2.0.json` | R2-1, R2-2 and R2-3 together | each single change at best doubles a 7-8-trade cell; only the combination could plausibly approach 100 trades per instrument |

Not proposed, and why: a direction filter (the long/short asymmetry is 58 non-independent trades); a nearer target or partials (that would be a different model, and the owner excluded partials for round 1); a wider stop (it would reduce the stop-outs by construction, not test the model); the bias on (it removes a third of the sessions before any setup). R2-1 changes the owner's own "no new trades after 10:30" rule, so it is the owner's call; R2-2 and R2-3 change the author's hypotheses only.

Before any round-2 run: the owner reads this report; the chosen files are written with every other setting identical to the base, pinned in `server/sweepbos/config.js` as round 2, committed, and logged; the engine gains the three switches with tests and planted bugs for each; a new code revision is set and a new `**Code frozen for round 2**` entry is written; each run is logged. The evaluation window stays closed (Part F).
