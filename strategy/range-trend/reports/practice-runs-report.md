# Range-trend practice runs: the pick rule applied as a report (eight runs, development period)

Written 2026-11-04 (local time; the launcher stamps rows in UTC, so log rows 18 to 25 carry 2026-11-05). A report only: it writes no ledger row, advances nothing and starts no evaluation; no candidate is chosen here; the reserve is unused. Counts, totals, percentages and labels only: no daily bars, price series or per-fill price lists. **measured** = produced by the engine in the run and stored with it; **derived** = computed from measured figures (benchmarks, annualisation, the best-5% stress calculation, shares). Simulation only; not evidence that any rule reproduces the owner's trading.

## 1. Provenance (measured)

| Item | Value |
|---|---|
| Runs | ids 1 to 8, one per planned config, all status done, no errors; log rows 18 to 25 (commit 807c13e) |
| Period | 2017-10-02 to 2021-12-31 (warm-up from 2016-01-04), basket A: MU, AMZN, META, TSLA, VST, GOOG, INTC, CSCO, PYPL, SNAP |
| Starting cash | $15000.00 |
| Code revision / engine | rt-code-2026-11-02-1 / rt-engine-3; benchmark engine hxr-engine-3; index method rt-index-1 |
| Protocol hash (frozen at run 1) | 3b953315789b79f3f323c1b5d5298e09567cc18f5ce2958930dd72acc8f7d754 |
| Symbols hash | dcc35cb32bbcdd9b16bee0c789f5752915e01088fdddcae3339beb8f574a6619 |
| Data hash | bb76c910ed720a1aece2276c9d676a59369ee8a8710549e73d57f7113b3624f2 |
| Calibration hash | e80c8ea1423b9d1f013b513d8ba37ed8943a501e74c813c0d665f57dbc93f371 |
| Hold config | hxr-hold-0.1.0.json (8ecf1c57c701...) |
| Same revision, protocol, symbols, data and calibration hashes in all eight runs | yes |
| Test overrides | none in any run |
| Run timestamps (UTC) | 2026-11-05T00:35:24.132Z to 2026-11-05T00:36:40.934Z |

| Run | Config file | Config hash (pinned) | Family / entry / re-entry limit |
|---|---|---|---|
| 1 | rt-range-dip-limit-0.2.0.json | 64c93e822ad1006ced58ff05c4e03def4652f9e12346cc1d39ccf6a0c19f2f1d | range / dip / below-last-sale limit |
| 2 | rt-range-dip-nolimit-0.2.0.json | 9fcd21ab832c9479bf13f99aafb98707848bc1df497906a8f502ded0e6c17414 | range / dip / none |
| 3 | rt-range-recovery-limit-0.2.0.json | 2bf9929e03380cd26b18a2a22a686083204cba9e44a525f64657bf7f49c54afa | range / recovery / below-last-sale limit |
| 4 | rt-range-recovery-nolimit-0.2.0.json | 40a817cb5467a2eb94c09418302c24e0b514986de0abd61bed67e0bc0c465ec5 | range / recovery / none |
| 5 | rt-trend-immediate-limit-0.2.0.json | f001a574d5eaab820239e22ace596a9ca70d79b0e7b47d2d38b09aacfcb0bc54 | trend / immediate / below-last-sale limit |
| 6 | rt-trend-immediate-nolimit-0.2.0.json | c938444fbb62858368b8bfb3f513b8d178fdfecc8c9b43281fedcbbd1d5b8b98 | trend / immediate / none |
| 7 | rt-trend-pullback-limit-0.2.0.json | 7f92f22880b324df85ae34a6ac02637ec696be96014fed0293bcfcd2fede66fb | trend / pullback / below-last-sale limit |
| 8 | rt-trend-pullback-nolimit-0.2.0.json | 58f1d239f525f27675cf09877ae090020e5b8c024a87f13c11ab53ceeab701e2 | trend / pullback / none |

## 2. Per run: trades, P/L, return, drawdown, costs, ending balance against the benchmarks

Net P/L after costs = ending balance minus starting cash (measured; costs and net dividends included; positions open at the end marked at the last close). Annualised return, maximum drawdown and both benchmarks are derived. The exposure-matched hold is each run's own: benchmark (a)'s daily return scaled by the run's invested fraction of the previous session. The equal-weight index is benchmark (a): fractional shares, no costs, never rebalanced, dividends net of withholding reinvested; it is the same for every run.

| Run | Completed trades (measured) | Open at end | Net P/L after costs (measured) | Annualised return (derived) | Max drawdown (derived) | Total costs (measured) | Ending balance (measured) | Exposure-matched hold, ending balance (derived) | Equal-weight index, ending balance (derived) | Avg invested (measured) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 range-dip-limit | 14 | 0 | -$791.36 | -1.27% | 10.36% ($1629.96) | $78.12 | $14208.64 | $14544.78 (-0.72% a year, max drawdown 8.18%) | $55860.57 (36.29% a year, max drawdown 35.06%) | 4.6% |
| 2 range-dip-nolimit | 36 | 0 | -$855.20 | -1.37% | 15.24% ($2398.69) | $173.43 | $14144.80 | $15780.79 (1.20% a year, max drawdown 11.02%) | $55860.57 (36.29% a year, max drawdown 35.06%) | 9.5% |
| 3 range-recovery-limit | 11 | 0 | $892.14 | 1.37% | 3.30% ($541.52) | $65.17 | $15892.14 | $16021.61 (1.56% a year, max drawdown 2.62%) | $55860.57 (36.29% a year, max drawdown 35.06%) | 3.4% |
| 4 range-recovery-nolimit | 24 | 0 | $1333.94 | 2.03% | 6.29% ($1095.04) | $136.37 | $16333.94 | $16264.55 (1.92% a year, max drawdown 4.25%) | $55860.57 (36.29% a year, max drawdown 35.06%) | 7.1% |
| 5 trend-immediate-limit | 12 | 0 | $56.80 | 0.09% | 4.19% ($631.21) | $58.74 | $15056.80 | $15563.89 (0.87% a year, max drawdown 1.88%) | $55860.57 (36.29% a year, max drawdown 35.06%) | 2.4% |
| 6 trend-immediate-nolimit | 51 | 1 | $1757.90 | 2.64% | 7.28% ($1097.68) | $227.84 | $16757.90 | $16166.28 (1.78% a year, max drawdown 7.89%) | $55860.57 (36.29% a year, max drawdown 35.06%) | 12.2% |
| 7 trend-pullback-limit | 11 | 0 | -$478.22 | -0.76% | 3.66% ($549.33) | $61.63 | $14521.78 | $14893.20 (-0.17% a year, max drawdown 2.75%) | $55860.57 (36.29% a year, max drawdown 35.06%) | 2.2% |
| 8 trend-pullback-nolimit | 23 | 0 | $1367.61 | 2.08% | 4.59% ($688.83) | $98.92 | $16367.61 | $15928.47 (1.42% a year, max drawdown 4.07%) | $55860.57 (36.29% a year, max drawdown 35.06%) | 5.5% |

Beside the benchmark, not the benchmark: HXR's whole-share hold arm on the same inputs (derived) ends at $51178.76 (33.51% a year, max drawdown 33.39%); cash at 0% ends at $15000.00.

Trade-off flags against the exposure-matched hold (derived; PLAN 7b): beats its return without a deeper drawdown / beats its return per unit of drawdown / adds value beyond cash:

| Run | Beats return without deeper drawdown | Beats return per drawdown | Adds value beyond cash |
|---|---|---|---|
| 1 range-dip-limit | no | no | no |
| 2 range-dip-nolimit | no | no | no |
| 3 range-recovery-limit | no | no | no |
| 4 range-recovery-nolimit | no | no | no |
| 5 trend-immediate-limit | no | no | no |
| 6 trend-immediate-nolimit | yes | yes | yes |
| 7 trend-pullback-limit | no | no | no |
| 8 trend-pullback-nolimit | no | yes | yes |

## 3. The pick rule (PROPOSED-RULES.md, adopted 2026-11-02), applied as a report

Settings (measured from the stored pick inputs): at least 30 completed trades; single-stock gross-gain share at most 40%; tie band 0.5 points. A run is *qualified* when it is recorded without error, has enough trades and passes the gross-gain gate; a qualified run *passes* when all three tests against its own exposure-matched hold hold (return above, drawdown not deeper, best-5% stress holds). Only passing runs are scored.

| Run | Recorded | Completed trades | Enough (30) | Gross-gain share, top stock (derived) | Gross-gain gate | Qualified | Return test | Drawdown test | Best-5% test | Passes | Score | Why not |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| range-dip-limit | yes | 14 | no | 62.4% (PYPL) | no | no | no | no | no | no | none | 14 completed trades, fewer than 30; single-stock gross-gain share 62.4% (PYPL) above 40% |
| range-dip-nolimit | yes | 36 | yes | 52.4% (TSLA) | no | no | no | no | no | no | none | single-stock gross-gain share 52.4% (TSLA) above 40% |
| range-recovery-limit | yes | 11 | no | 68.9% (SNAP) | no | no | no | no | no | no | none | 11 completed trades, fewer than 30; single-stock gross-gain share 68.9% (SNAP) above 40% |
| range-recovery-nolimit | yes | 24 | no | 47.9% (SNAP) | no | no | yes | no | no | no | none | 24 completed trades, fewer than 30; single-stock gross-gain share 47.9% (SNAP) above 40% |
| trend-immediate-limit | yes | 12 | no | 60.1% (MU) | no | no | no | no | no | no | none | 12 completed trades, fewer than 30; single-stock gross-gain share 60.1% (MU) above 40% |
| trend-immediate-nolimit | yes | 51 | yes | 65.7% (SNAP) | no | no | yes | yes | no | no | none | single-stock gross-gain share 65.7% (SNAP) above 40% |
| trend-pullback-limit | yes | 11 | no | 100.0% (VST) | no | no | no | no | no | no | none | 11 completed trades, fewer than 30; single-stock gross-gain share 100.0% (VST) above 40% |
| trend-pullback-nolimit | yes | 23 | no | 65.5% (SNAP) | no | no | yes | no | no | no | none | 23 completed trades, fewer than 30; single-stock gross-gain share 65.5% (SNAP) above 40% |

The three comparison tests, figures (derived): the run's annualised return against its exposure-matched hold's; the run's maximum drawdown against the hold's; the best-5% stress (K outcomes removed, the adjusted net P/L and adjusted annualised return, which must still be above the hold's). The stress is a calculation, not a re-simulation: removing outcomes after the fact changes no later sizing and the drawdown is not recomputed. The tests are reported for every run, qualified or not.

| Run | Annualised, run | Annualised, hold | Max drawdown, run | Max drawdown, hold | K removed | Removed P/L | Adjusted net P/L | Adjusted annualised | Stress holds |
|---|---|---|---|---|---|---|---|---|---|
| 1 range-dip-limit | -1.27% | -0.72% | 10.36% | 8.18% | 1 of 14 | $282.64 | -$1074.00 | -1.73% | no |
| 2 range-dip-nolimit | -1.37% | 1.20% | 15.24% | 11.02% | 2 of 36 | $954.41 | -$1809.60 | -2.98% | no |
| 3 range-recovery-limit | 1.37% | 1.56% | 3.30% | 2.62% | 1 of 11 | $474.20 | $417.94 | 0.65% | no |
| 4 range-recovery-nolimit | 2.03% | 1.92% | 6.29% | 4.25% | 2 of 24 | $858.36 | $475.58 | 0.74% | no |
| 5 trend-immediate-limit | 0.09% | 0.87% | 4.19% | 1.88% | 1 of 12 | $299.13 | -$242.33 | -0.38% | no |
| 6 trend-immediate-nolimit | 2.64% | 1.78% | 7.28% | 7.89% | 3 of 52 | $2583.90 | -$826.00 | -1.32% | no |
| 7 trend-pullback-limit | -0.76% | -0.17% | 3.66% | 2.75% | 1 of 11 | $85.71 | -$563.93 | -0.90% | no |
| 8 trend-pullback-nolimit | 2.08% | 1.42% | 4.59% | 4.07% | 2 of 23 | $1871.48 | -$503.86 | -0.80% | no |

**Sets and outcome (derived by the rule):**

- Passing runs: none.
- T0 (passing runs within the tie band of the best score): empty.
- T1: not formed (no T0). T2: not formed.
- **Outcome: NONE.** no run qualifies (completed trades, recorded without error, gross-gain gate).

Reading (derived from the table): every run fails the gross-gain gate, because in each one a single stock carries more than 40% of the gross gain (47.9% at the lowest, 100% at the highest); six of the eight also have fewer than 30 completed trades. The gate is pre-registered to refuse exactly this case: a result that depends on one stock. No run reaches the comparison tests as a qualified run, so no score exists and nothing advances.

## 4. Gross-gain share by stock (derived; definition 4: P(s) = the stock's completed-trade P/L plus open positions at the last close; G = the sum of the positive P(s); share = max(0, P(s)) / G)

| Stock | 1 range-dip-limit | 2 range-dip-nolimit | 3 range-recovery-limit | 4 range-recovery-nolimit | 5 trend-immediate-limit | 6 trend-immediate-nolimit | 7 trend-pullback-limit | 8 trend-pullback-nolimit |
|---|---|---|---|---|---|---|---|---|
| MU | 0.0% (-$483.13) | 0.0% (-$1168.97) | 0.0% (-$151.86) | 0.0% (-$369.47) | 60.1% ($377.22) | 9.4% ($235.94) | 0.0% (-$23.88) | 2.8% ($55.84) |
| AMZN | no trade | no trade | no trade | no trade | 11.3% ($70.77) | 0.0% (-$49.55) | 0.0% (-$61.39) | 0.0% (-$207.71) |
| META | 0.0% (-$152.65) | 0.0% (-$572.14) | 0.0% (-$173.16) | 0.0% (-$377.97) | 0.0% (-$78.29) | 0.0% (-$301.97) | 0.0% (-$58.52) | 0.0% (-$59.14) |
| TSLA | 0.0% (-$114.34) | 52.4% ($782.07) | no trade | no trade | 0.0% (-$66.66) | 0.0% (-$197.29) | 0.0% (-$108.13) | 0.0% (-$108.13) |
| VST | 4.1% ($18.57) | 2.0% ($29.29) | 3.9% ($48.02) | 14.4% ($326.91) | 0.0% (-$104.37) | 0.0% (-$70.67) | 100.0% ($141.74) | 6.9% ($139.74) |
| GOOG | 33.5% ($151.99) | 0.0% (-$22.65) | 3.2% ($39.41) | 0.0% (-$112.43) | 0.0% (-$56.16) | 3.1% ($77.72) | 0.0% (-$70.11) | 24.8% ($498.77) |
| INTC | 0.0% (-$147.99) | 0.0% (-$146.76) | 3.7% ($44.69) | 0.0% (-$74.38) | 0.0% (-$101.22) | 0.0% (-$144.21) | 0.0% (-$31.58) | 0.0% (-$31.00) |
| CSCO | 0.0% (-$11.97) | 5.5% ($82.02) | 8.5% ($103.63) | 7.1% ($160.99) | 0.0% (-$97.72) | 6.7% ($168.17) | 0.0% (-$39.28) | 0.0% (-$43.81) |
| PYPL | 62.4% ($282.64) | 40.1% ($598.20) | 11.7% ($142.46) | 30.6% ($694.82) | 0.0% (-$66.15) | 15.2% ($384.08) | 0.0% (-$90.11) | 0.0% (-$197.14) |
| SNAP | 0.0% (-$334.48) | 0.0% (-$436.25) | 68.9% ($838.95) | 47.9% ($1085.47) | 28.6% ($179.39) | 65.7% ($1655.70) | 0.0% (-$136.96) | 65.5% ($1320.20) |
| **G, gross gain** | $453.20 | $1491.58 | $1217.16 | $2268.19 | $627.38 | $2521.61 | $141.74 | $2014.55 |
| **Net total of outcomes** | -$791.36 | -$855.19 | $892.14 | $1333.94 | $56.81 | $1757.92 | -$478.22 | $1367.62 |
| **Winners (stocks with P(s) > 0)** | 3 | 4 | 6 | 4 | 3 | 5 | 1 | 4 |

## 5. Tier 2 descriptions (PLAN 7b; reported, never enforced)

| Run | Enough trades to compare (30) | Outcomes: completed / open at end | Outcomes P/L (measured) | Best-5% removed (count, P/L) | P/L without them (derived) | Top stock (share of gross gain) | Flagged |
|---|---|---|---|---|---|---|---|
| 1 range-dip-limit | no | 14 / 0 | -$791.36 | 1, $282.64 | -$1074.00 (ending $13926.00) | PYPL 62.4% ($282.64) | yes |
| 2 range-dip-nolimit | yes | 36 / 0 | -$855.20 | 2, $954.41 | -$1809.60 (ending $13190.40) | TSLA 52.4% ($782.07) | yes |
| 3 range-recovery-limit | no | 11 / 0 | $892.14 | 1, $474.20 | $417.94 (ending $15417.94) | SNAP 68.9% ($838.95) | yes |
| 4 range-recovery-nolimit | no | 24 / 0 | $1333.94 | 2, $858.36 | $475.58 (ending $15475.58) | SNAP 47.9% ($1085.47) | yes |
| 5 trend-immediate-limit | no | 12 / 0 | $56.80 | 1, $299.13 | -$242.33 (ending $14757.67) | MU 60.1% ($377.22) | yes |
| 6 trend-immediate-nolimit | yes | 51 / 1 | $1757.90 | 3, $2583.90 | -$826.00 (ending $14174.00) | SNAP 65.7% ($1655.70) | yes |
| 7 trend-pullback-limit | no | 11 / 0 | -$478.22 | 1, $85.71 | -$563.93 (ending $14436.07) | VST 100.0% ($141.74) | yes |
| 8 trend-pullback-nolimit | no | 23 / 0 | $1367.61 | 2, $1871.48 | -$503.86 (ending $14496.14) | SNAP 65.5% ($1320.20) | yes |

Activity and exits (measured):

| Run | Sessions | Years | Time in cash | Holding sessions, median / longest | Turnover a year | Skips (by code) | Exits by kind | Breaks by kind | Orders reduced by a cap (warnings) | Post-exit dividends paid | Unpaid dividends at end |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 range-dip-limit | 1070 | 4.25 | 95.4% | 12.5 / 61 | 1.07 | 114 (reentry_limit 113, no_whole_share 1) | rejection 3, below_old_high 1, giveback 2, breakdown 8 | breakout 74, breakdown 23, conversion 3, trade_breakdown 8 | 5 of 5 | $0.00 | 0 ($0.00) |
| 2 range-dip-nolimit | 1070 | 4.25 | 90.5% | 10.5 / 85 | 2.87 | 1 (no_whole_share 1) | rejection 8, below_old_high 2, giveback 2, breakdown 24 | breakout 72, breakdown 21, conversion 4, trade_breakdown 24 | 9 of 10 | $31.62 | 0 ($0.00) |
| 3 range-recovery-limit | 1070 | 4.25 | 96.6% | 20 / 58 | 0.65 | 50 (reentry_limit 38, no_whole_share 12) | giveback 3, rejection 5, breakdown 3 | breakout 75, breakdown 22, conversion 3, trade_breakdown 3 | 4 of 4 | $0.00 | 0 ($0.00) |
| 4 range-recovery-nolimit | 1070 | 4.25 | 92.9% | 17.5 / 58 | 1.53 | 11 (no_whole_share 11) | giveback 4, rejection 10, breakdown 8, below_old_high 2 | breakout 75, breakdown 21, conversion 6, trade_breakdown 8 | 14 of 15 | $0.00 | 0 ($0.00) |
| 5 trend-immediate-limit | 1070 | 4.25 | 97.6% | 8.5 / 31 | 0.97 | 46 (reentry_limit 46) | giveback 9, below_old_high 3 | breakout 75, breakdown 23 | 5 of 5 | $0.00 | 0 ($0.00) |
| 6 trend-immediate-nolimit | 1070 | 4.25 | 87.8% | 9 / 84 | 4.25 | 4 (no_whole_share 4) | giveback 39, below_old_high 12 | breakout 75, breakdown 23 | 9 of 11 | $0.00 | 0 ($0.00) |
| 7 trend-pullback-limit | 1070 | 4.25 | 97.8% | 6 / 45 | 0.93 | 23 (reentry_limit 23) | giveback 8, below_old_high 3 | breakout 75, breakdown 23 | 3 of 3 | $0.00 | 0 ($0.00) |
| 8 trend-pullback-nolimit | 1070 | 4.25 | 94.5% | 12 / 54 | 1.88 | 0 (none) | giveback 20, below_old_high 3 | breakout 75, breakdown 23 | 5 of 5 | $0.00 | 0 ($0.00) |

Hypothesis descriptions (measured counts; H1 to H5 of PLAN-DRAFT.md section 7b; descriptions only, no pass mark):

| Run | H1/H2 range trades | Avg entry position in range | Breakdown share | Avg breakdown P/L | Converted to trend | H3/H4 trend trades | Failed-breakout share | Avg trend P/L | Breakouts never entered | Watches ended / while held | H5 re-entries above last sale | Trades within 20 sessions of a sale (P/L) | Re-entry-limit skips / cancellations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 range-dip-limit | 14 | 0.162 | 57.1% | -$235.78 | 3 | 0 | n/a | n/a | 0 | 0 / 0 | 0 (0 completed) | 1 (-$108.94) | 113 / 0 |
| 2 range-dip-nolimit | 36 | 0.141 | 66.7% | -$160.23 | 4 | 0 | n/a | n/a | 0 | 0 / 0 | 19 (19 completed) | 1 (-$108.94) | 0 / 0 |
| 3 range-recovery-limit | 11 | 0.370 | 27.3% | -$178.79 | 3 | 0 | n/a | n/a | 0 | 0 / 0 | 0 (0 completed) | 0 ($0.00) | 38 / 0 |
| 4 range-recovery-nolimit | 24 | 0.350 | 33.3% | -$201.96 | 6 | 0 | n/a | n/a | 0 | 0 / 0 | 12 (12 completed) | 0 ($0.00) | 0 / 0 |
| 5 trend-immediate-limit | 0 | n/a | n/a | n/a | 0 | 12 | 25.0% | $4.73 | 0 | 0 / 0 | 0 (0 completed) | 0 ($0.00) | 46 / 0 |
| 6 trend-immediate-nolimit | 0 | n/a | n/a | n/a | 0 | 51 | 23.5% | $29.89 | 0 | 0 / 0 | 35 (34 completed) | 0 ($0.00) | 0 / 0 |
| 7 trend-pullback-limit | 0 | n/a | n/a | n/a | 0 | 11 | 27.3% | -$43.47 | 47 | 58 / 0 | 0 (0 completed) | 0 ($0.00) | 23 / 0 |
| 8 trend-pullback-nolimit | 0 | n/a | n/a | n/a | 0 | 23 | 13.0% | $59.46 | 35 | 58 / 1 | 11 (11 completed) | 0 ($0.00) | 0 / 0 |

## 6. Per-stock counts (D5; measured): signals, entries, one-share entries, decision-time skips by code, fill-time cancellations and rejections by code, pending at end, unpaid dividends, P/L

### Run 1: rt-range-dip-limit-0.2.0

| Stock | Signals | Entries | One-share entries | Skips | Cancellations | Rejections | Pending at end | Unpaid dividends (count, net) | P/L (measured) |
|---|---|---|---|---|---|---|---|---|---|
| MU | 18 | 2 | 0 | reentry_limit 16 | none | none | 0 | 0, $0.00 | -$483.13 |
| AMZN | 1 | 0 | 0 | no_whole_share 1 | none | none | 0 | 0, $0.00 | $0.00 |
| META | 15 | 2 | 0 | reentry_limit 13 | none | none | 0 | 0, $0.00 | -$152.65 |
| TSLA | 19 | 1 | 0 | reentry_limit 18 | none | none | 0 | 0, $0.00 | -$114.34 |
| VST | 27 | 3 | 0 | reentry_limit 24 | none | none | 0 | 0, $0.00 | $18.57 |
| GOOG | 5 | 1 | 0 | reentry_limit 4 | none | none | 0 | 0, $0.00 | $151.99 |
| INTC | 15 | 1 | 0 | reentry_limit 14 | none | none | 0 | 0, $0.00 | -$147.99 |
| CSCO | 13 | 2 | 0 | reentry_limit 11 | none | none | 0 | 0, $0.00 | -$11.97 |
| PYPL | 5 | 1 | 0 | reentry_limit 4 | none | none | 0 | 0, $0.00 | $282.64 |
| SNAP | 10 | 1 | 0 | reentry_limit 9 | none | none | 0 | 0, $0.00 | -$334.48 |

### Run 2: rt-range-dip-nolimit-0.2.0

| Stock | Signals | Entries | One-share entries | Skips | Cancellations | Rejections | Pending at end | Unpaid dividends (count, net) | P/L (measured) |
|---|---|---|---|---|---|---|---|---|---|
| MU | 5 | 5 | 0 | none | none | none | 0 | 0, $0.00 | -$1168.97 |
| AMZN | 1 | 0 | 0 | no_whole_share 1 | none | none | 0 | 0, $0.00 | $0.00 |
| META | 5 | 5 | 0 | none | none | none | 0 | 0, $0.00 | -$572.14 |
| TSLA | 3 | 3 | 0 | none | none | none | 0 | 0, $0.00 | $782.07 |
| VST | 7 | 7 | 0 | none | none | none | 0 | 0, $0.00 | $29.29 |
| GOOG | 3 | 2 | 1 | none | none | stop_above_fill 1 | 0 | 0, $0.00 | -$22.65 |
| INTC | 4 | 4 | 0 | none | none | none | 0 | 0, $0.00 | -$146.76 |
| CSCO | 4 | 4 | 0 | none | none | none | 0 | 0, $0.00 | $82.02 |
| PYPL | 4 | 4 | 0 | none | none | none | 0 | 0, $0.00 | $598.20 |
| SNAP | 2 | 2 | 0 | none | none | none | 0 | 0, $0.00 | -$436.25 |

### Run 3: rt-range-recovery-limit-0.2.0

| Stock | Signals | Entries | One-share entries | Skips | Cancellations | Rejections | Pending at end | Unpaid dividends (count, net) | P/L (measured) |
|---|---|---|---|---|---|---|---|---|---|
| MU | 4 | 1 | 0 | reentry_limit 3 | none | none | 0 | 0, $0.00 | -$151.86 |
| AMZN | 5 | 0 | 0 | no_whole_share 5 | none | none | 0 | 0, $0.00 | $0.00 |
| META | 3 | 1 | 0 | reentry_limit 2 | none | none | 0 | 0, $0.00 | -$173.16 |
| TSLA | 7 | 0 | 0 | no_whole_share 7 | none | none | 0 | 0, $0.00 | $0.00 |
| VST | 13 | 2 | 0 | reentry_limit 11 | none | none | 0 | 0, $0.00 | $48.02 |
| GOOG | 3 | 1 | 1 | reentry_limit 2 | none | none | 0 | 0, $0.00 | $39.41 |
| INTC | 9 | 2 | 0 | reentry_limit 7 | none | none | 0 | 0, $0.00 | $44.69 |
| CSCO | 2 | 1 | 0 | reentry_limit 1 | none | none | 0 | 0, $0.00 | $103.63 |
| PYPL | 8 | 1 | 0 | reentry_limit 7 | none | none | 0 | 0, $0.00 | $142.46 |
| SNAP | 7 | 2 | 0 | reentry_limit 5 | none | none | 0 | 0, $0.00 | $838.95 |

### Run 4: rt-range-recovery-nolimit-0.2.0

| Stock | Signals | Entries | One-share entries | Skips | Cancellations | Rejections | Pending at end | Unpaid dividends (count, net) | P/L (measured) |
|---|---|---|---|---|---|---|---|---|---|
| MU | 2 | 2 | 0 | none | none | none | 0 | 0, $0.00 | -$369.47 |
| AMZN | 5 | 0 | 0 | no_whole_share 5 | none | none | 0 | 0, $0.00 | $0.00 |
| META | 2 | 2 | 0 | none | none | none | 0 | 0, $0.00 | -$377.97 |
| TSLA | 7 | 0 | 0 | no_whole_share 6 | no_whole_share 1 | none | 0 | 0, $0.00 | $0.00 |
| VST | 5 | 5 | 0 | none | none | none | 0 | 0, $0.00 | $326.91 |
| GOOG | 2 | 2 | 2 | none | none | none | 0 | 0, $0.00 | -$112.43 |
| INTC | 4 | 4 | 0 | none | none | none | 0 | 0, $0.00 | -$74.38 |
| CSCO | 2 | 2 | 0 | none | none | none | 0 | 0, $0.00 | $160.99 |
| PYPL | 4 | 4 | 0 | none | none | none | 0 | 0, $0.00 | $694.82 |
| SNAP | 3 | 3 | 0 | none | none | none | 0 | 0, $0.00 | $1085.47 |

### Run 5: rt-trend-immediate-limit-0.2.0

| Stock | Signals | Entries | One-share entries | Skips | Cancellations | Rejections | Pending at end | Unpaid dividends (count, net) | P/L (measured) |
|---|---|---|---|---|---|---|---|---|---|
| MU | 3 | 2 | 0 | reentry_limit 1 | none | none | 0 | 0, $0.00 | $377.22 |
| AMZN | 7 | 1 | 1 | reentry_limit 6 | none | none | 0 | 0, $0.00 | $70.77 |
| META | 6 | 1 | 0 | reentry_limit 5 | none | none | 0 | 0, $0.00 | -$78.29 |
| TSLA | 4 | 1 | 0 | reentry_limit 3 | none | none | 0 | 0, $0.00 | -$66.66 |
| VST | 5 | 1 | 0 | reentry_limit 4 | none | none | 0 | 0, $0.00 | -$104.37 |
| GOOG | 9 | 1 | 0 | reentry_limit 8 | none | none | 0 | 0, $0.00 | -$56.16 |
| INTC | 4 | 1 | 0 | reentry_limit 3 | none | none | 0 | 0, $0.00 | -$101.22 |
| CSCO | 8 | 1 | 0 | reentry_limit 7 | none | none | 0 | 0, $0.00 | -$97.72 |
| PYPL | 7 | 1 | 0 | reentry_limit 6 | none | none | 0 | 0, $0.00 | -$66.15 |
| SNAP | 5 | 2 | 0 | reentry_limit 3 | none | none | 0 | 0, $0.00 | $179.39 |

### Run 6: rt-trend-immediate-nolimit-0.2.0

| Stock | Signals | Entries | One-share entries | Skips | Cancellations | Rejections | Pending at end | Unpaid dividends (count, net) | P/L (measured) |
|---|---|---|---|---|---|---|---|---|---|
| MU | 3 | 3 | 0 | none | none | none | 0 | 0, $0.00 | $235.94 |
| AMZN | 7 | 3 | 3 | no_whole_share 4 | none | none | 0 | 0, $0.00 | -$49.55 |
| META | 6 | 6 | 0 | none | none | none | 0 | 0, $0.00 | -$301.97 |
| TSLA | 4 | 4 | 0 | none | none | none | 0 | 0, $0.00 | -$197.29 |
| VST | 5 | 5 | 0 | none | none | none | 0 | 0, $0.00 | -$70.67 |
| GOOG | 9 | 9 | 4 | none | none | none | 0 | 0, $0.00 | $77.72 |
| INTC | 4 | 3 | 0 | none | none | stop_above_fill 1 | 0 | 0, $0.00 | -$144.21 |
| CSCO | 8 | 8 | 0 | none | none | none | 0 | 0, $0.00 | $168.17 |
| PYPL | 7 | 6 | 0 | none | none | stop_above_fill 1 | 0 | 0, $0.00 | $384.08 |
| SNAP | 5 | 5 | 0 | none | none | none | 0 | 0, $0.00 | $1655.70 |

### Run 7: rt-trend-pullback-limit-0.2.0

| Stock | Signals | Entries | One-share entries | Skips | Cancellations | Rejections | Pending at end | Unpaid dividends (count, net) | P/L (measured) |
|---|---|---|---|---|---|---|---|---|---|
| MU | 4 | 1 | 0 | reentry_limit 3 | none | none | 0 | 0, $0.00 | -$23.88 |
| AMZN | 3 | 1 | 1 | reentry_limit 2 | none | none | 0 | 0, $0.00 | -$61.39 |
| META | 3 | 1 | 0 | reentry_limit 2 | none | none | 0 | 0, $0.00 | -$58.52 |
| TSLA | 1 | 1 | 0 | none | none | none | 0 | 0, $0.00 | -$108.13 |
| VST | 2 | 2 | 0 | none | none | none | 0 | 0, $0.00 | $141.74 |
| GOOG | 12 | 1 | 0 | reentry_limit 11 | none | none | 0 | 0, $0.00 | -$70.11 |
| INTC | 1 | 1 | 0 | none | none | none | 0 | 0, $0.00 | -$31.58 |
| CSCO | 1 | 1 | 0 | none | none | none | 0 | 0, $0.00 | -$39.28 |
| PYPL | 4 | 1 | 0 | reentry_limit 3 | none | none | 0 | 0, $0.00 | -$90.11 |
| SNAP | 3 | 1 | 0 | reentry_limit 2 | none | none | 0 | 0, $0.00 | -$136.96 |

### Run 8: rt-trend-pullback-nolimit-0.2.0

| Stock | Signals | Entries | One-share entries | Skips | Cancellations | Rejections | Pending at end | Unpaid dividends (count, net) | P/L (measured) |
|---|---|---|---|---|---|---|---|---|---|
| MU | 2 | 2 | 0 | none | none | none | 0 | 0, $0.00 | $55.84 |
| AMZN | 2 | 2 | 2 | none | none | none | 0 | 0, $0.00 | -$207.71 |
| META | 3 | 3 | 0 | none | none | none | 0 | 0, $0.00 | -$59.14 |
| TSLA | 1 | 1 | 0 | none | none | none | 0 | 0, $0.00 | -$108.13 |
| VST | 2 | 2 | 0 | none | none | none | 0 | 0, $0.00 | $139.74 |
| GOOG | 7 | 7 | 3 | none | none | none | 0 | 0, $0.00 | $498.77 |
| INTC | 1 | 1 | 0 | none | none | none | 0 | 0, $0.00 | -$31.00 |
| CSCO | 1 | 1 | 0 | none | none | none | 0 | 0, $0.00 | -$43.81 |
| PYPL | 2 | 2 | 0 | none | none | none | 0 | 0, $0.00 | -$197.14 |
| SNAP | 2 | 2 | 0 | none | none | none | 0 | 0, $0.00 | $1320.20 |

## 7. What this report does not do

- It chooses no candidate and advances nothing: the outcome above is the rule's, NONE, and the owner reads it. The evaluation (2022-01-03 to 2023-12-29) has no code path and was not started; the reserve run was not used; no config, protocol or code file changed between the runs (the gate checked the pins and the frozen protocol hash before each).
- Costs use the spread calibration frozen in the calibration hash; the exposure-matched hold is frictionless in its own rebalancing and lags the run's fills by part of a day (its label). Benchmark (a) is not an account that could be traded.
- Nothing here is evidence that any rule reproduces the owner's trading; the configs are experimental choices recorded as such (log rows 7, 15 and 17).

