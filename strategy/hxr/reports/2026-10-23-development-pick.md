# HXR development pick, 2026-10-23 (hxr-prereg-3a)

Simulation only, on stored daily bars. Development results are **in-sample**: they describe the period the pick was made on and are not evidence that any rule works. Nothing here is a recommendation or permission to trade.

All figures are copied from `data/hxr-sim.sqlite` (read-only), shown with at most 2 decimals. "not stored" means the database holds no value for that field. No daily bars, price series or per-fill prices are reproduced.

## Outcome

**No candidate qualified, so HXR stops here** (PREREGISTRATION-3a.md sections 2 and 3). The stored reason is: "stop: no candidate completed at least 10 round trips with a defined ending value". Nothing was frozen (`hxr_versions` holds 0 rows), so the validation and final periods stay unused for hxr-prereg-3a, and no `hxr-1.0.0.json` is added. No neighbouring settings ran, because they belong to a pick.

## Read this first: an implementation defect affected this run

- **The tech/AI exposure cap (US$10,500) was never applied.** `universe-hxr-v3.json` tags every basket-A stock except VST as tech/AI, but every run's stored metadata (`details.meta.symbols`) has `techAi: false` for all ten stocks. The cause is in `server/hxr/data.js` line 240 (`buildInputs`): it rebuilds the symbol list with `symbol, exchange, listedFrom` only and drops `techAi`. The engine tests passed because they call the engine directly with the tags. The stored exposure figures confirm it: `exposure.maxTechAiUsd` is 0 in every pooled run. This run therefore did **not** apply PREREGISTRATION-3.md section 6 as registered. No code has been changed (as instructed); what to do about it is your decision. Any fix, and any further run on the development period, would have to be recorded as such, because the development results have now been seen.
- **Other features of the stored results that you should know about.** These are what the stored rules produced, not errors in the code:
  - **Day one ran out of cash after five stocks.** The day-one hold and the candidates bought AMZN, CSCO, GOOG, INTC and META, alphabetically, near the US$3,000 position cap each. The other five (MU, PYPL, SNAP, TSLA, VST) lapsed for budget at the initial allocation (see "Stocks never entered").
  - **The pause never ended in most candidates.** At base costs, in every candidate under policies B and C, the account-decline pause started once (2018) and never ended (see "Pause episodes"). A mostly-cash account cannot climb back to within US$750 of its peak while new buys are blocked, so most later buy signals lapsed as "paused".
- **Code version.** Every run records engine `hxr-engine-3`. That label did not change with the entry-13 corrections, but the stored records carry fields only the corrected engine writes (`sessionsSinceMissedRebound` in fresh-entry decisions, `neverEnteredWaits` in the metrics). So the run used the code of commit `cf209fa`.

## The record

Selection ledger row (`hxr_ledger`):

| Field | Value |
|---|---|
| id | 1 |
| kind | selection |
| prereg | hxr-prereg-3a |
| version | `selection:hold-0.1.0,hold-day-one,x1a-0.3.0,x1b-0.3.0,x1c-0.3.0,x2a-0.3.0,x2b-0.3.0,x2c-0.3.0,x3a-0.3.0,x3b-0.3.0,x3c-0.3.0` |
| config_hash | `3bcd9042f73b718b44cac07d818f5f77e96c540eae620091d14f80d510380ee9` |
| contaminated | no (0) |
| reason | none |
| run ids | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22 |
| at | 2026-10-23T15:21:20.765Z |

Ledger rows of any kind: 1 (no validation or final run).

- **Pre-registration manifest hash:** not stored in the database. The manifest of the checkout at commit `cf209fa`, the code that ran, is `a9bb849faceb42e2f43be201f7d2e8cb50dc622eedd0138ac4fd2fccbf522fd5` (hxr-prereg-3a, 18 files). The working tree is unchanged since that commit.
- **Engine version:** hxr-engine-3
- **Data hash** (all runs): `bb76c910ed720a1aece2276c9d676a59369ee8a8710549e73d57f7113b3624f2`; **spread-calibration hash:** `e80c8ea1423b9d1f013b513d8ba37ed8943a501e74c813c0d665f57dbc93f371`
- **Period:** development 2017-10-02 to 2021-12-31, warm-up from 2016-01-04; basket A: MU, AMZN, META, TSLA, VST, GOOG, INTC, CSCO, PYPL, SNAP
- **Pick rule:** ending_value; stored bar to beat on ending value: US$51178.76. This is the higher of the two benchmarks' ending values.
- **Runs:** 22, all with status "done"; stored run errors: 0.

Experiment entries recorded by the app in the database:

| # | At | What | Results seen | Note |
|---|---|---|---|---|
| 1 | 2026-10-23T14:07:53.563Z | data download | no | Download only; no rule was run. |
| 2 | 2026-10-23T15:11:31.663Z | MU decision: keep MU in the evaluation | no | Recorded before any HXR run. MU stays in basket A; the overlap of the evaluation period with the Strategy Lab holdout window for MU stays disclosed. |
| 3 | 2026-10-23T15:21:20.765Z | development pick | yes: in-sample development results | stop: no candidate completed at least 10 round trips with a defined ending value |

## Every arm

The bar to beat for a pick is the higher benchmark ending value. A candidate also needs at least 10 completed cycles. Fresh entries do not count as cycles.

### Base costs (the runs the pick uses)

| | Hold (fully invested) | Hold day-one positions | X1A | X1B | X1C | X2A | X2B | X2C | X3A (comparison) | X3B (comparison) | X3C (comparison) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Run id | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
| Ending value | US$51178.76 | US$35204.66 | US$18490.85 | US$18568.81 | US$18132.34 | US$15387.30 | US$15161.04 | US$14531.67 | US$15125.46 | US$13874.97 | US$14077.78 |
| Total return | 241.19% | 134.70% | 23.27% | 23.79% | 20.88% | 2.58% | 1.07% | -3.12% | 0.84% | -7.50% | -6.15% |
| Annualised return | 33.51% | 22.25% | 5.05% | 5.15% | 4.57% | 0.60% | 0.25% | -0.74% | 0.20% | -1.82% | -1.48% |
| Largest decline (US$) | US$8036.25 | US$7041.00 | US$1083.26 | US$1830.93 | US$1915.62 | US$758.99 | US$1529.82 | US$1635.41 | US$359.42 | US$1895.43 | US$2102.21 |
| Largest decline (%) | 33.39% | 28.03% | 5.88% | 8.98% | 9.59% | 4.71% | 9.17% | 10.12% | 2.32% | 12.07% | 12.99% |
| Return per unit of decline | 1.00 | 0.79 | 0.86 | 0.57 | 0.48 | 0.13 | 0.03 | -0.07 | 0.08 | -0.15 | -0.11 |
| Completed cycles (buy-backs below the sale) | 0 | 0 | 1 | 0 | 2 | 1 | 4 | 1 | 0 | 10 | 2 |
| Fresh entries after a missed rebound | not stored (equal-sleeve arm) | 0 | 0 | 11 | 8 | 0 | 32 | 15 | 0 | 54 | 26 |
| Fresh entries, never held or lapsed | not stored (equal-sleeve arm) | 0 | 5 | 4 | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| Missed rebounds | not stored (equal-sleeve arm) | 0 | 10 | 20 | 18 | 10 | 42 | 25 | 10 | 64 | 36 |
| Stocks retired after a missed rebound (policy A) | not stored (equal-sleeve arm) | 0 | 10 | 0 | 0 | 10 | 0 | 0 | 10 | 0 | 0 |
| Initial-loss exits | not stored (equal-sleeve arm) | 0 | 5 | 8 | 9 | 2 | 7 | 5 | 3 | 32 | 17 |
| Rule exits | not stored (equal-sleeve arm) | 0 | 6 | 12 | 11 | 9 | 39 | 21 | 7 | 42 | 21 |
| Time in cash (money-weighted) | 6.21% | 3.04% | 88.21% | 84.43% | 84.81% | 97.27% | 89.11% | 94.22% | 98.35% | 88.69% | 94.53% |
| Total costs (spread, slippage, fees) | US$12.39 | US$7.18 | US$64.08 | US$66.21 | US$80.21 | US$45.25 | US$256.34 | US$152.83 | US$42.46 | US$404.94 | US$198.11 |
| Dividends net (gross) | US$515.62 (US$606.62) | US$803.39 (US$945.16) | US$86.91 (US$102.25) | US$105.98 (US$124.69) | US$86.91 (US$102.25) | US$40.01 (US$47.06) | US$54.80 (US$64.47) | US$40.01 (US$47.06) | US$21.94 (US$25.81) | US$52.54 (US$61.81) | US$21.94 (US$25.81) |
| Pause episodes · sessions paused | not stored (equal-sleeve arm) | 15 · 510 | 0 · 0 | 1 · 815 | 1 · 805 | 0 · 0 | 1 · 864 | 1 · 864 | 0 · 0 | 1 · 789 | 1 · 789 |
| Stocks never entered | not stored (equal-sleeve arm) | MU, TSLA, VST, PYPL, SNAP | none | VST | none | none | none | none | none | none | none |
| Sells · buys after day one · initial buys | 0 · 0 · 10 | 0 · 0 · 5 | 11 · 6 · 5 | 20 · 15 · 5 | 20 · 15 · 5 | 11 · 6 · 5 | 46 · 41 · 5 | 26 · 21 · 5 | 10 · 5 · 5 | 74 · 69 · 5 | 38 · 33 · 5 |
| Invested fraction (average) | not stored (equal-sleeve arm) | 96.96% | 11.79% | 15.57% | 15.19% | 2.73% | 10.89% | 5.78% | 1.65% | 11.31% | 5.47% |
| Tech/AI exposure, maximum | not stored (equal-sleeve arm) | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 |

### First 15-minute VWAP fills (reported only)

| | Hold (fully invested) | Hold day-one positions | X1A | X1B | X1C | X2A | X2B | X2C | X3A (comparison) | X3B (comparison) | X3C (comparison) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Run id | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 |
| Ending value | US$51224.71 | US$35199.34 | US$18648.59 | US$18791.14 | US$18351.85 | US$15428.02 | US$15074.82 | US$14415.53 | US$15151.15 | US$14214.75 | US$14443.69 |
| Total return | 241.50% | 134.66% | 24.32% | 25.27% | 22.35% | 2.85% | 0.50% | -3.90% | 1.01% | -5.24% | -3.71% |
| Annualised return | 33.54% | 22.25% | 5.26% | 5.45% | 4.86% | 0.66% | 0.12% | -0.93% | 0.24% | -1.26% | -0.89% |
| Largest decline (US$) | US$8045.08 | US$7041.00 | US$1083.26 | US$1692.22 | US$1730.32 | US$733.47 | US$1576.25 | US$1752.59 | US$356.29 | US$1532.85 | US$1798.27 |
| Largest decline (%) | 33.40% | 28.04% | 5.86% | 8.26% | 8.62% | 4.55% | 9.47% | 10.84% | 2.30% | 9.73% | 11.07% |
| Return per unit of decline | 1.00 | 0.79 | 0.90 | 0.66 | 0.56 | 0.15 | 0.01 | -0.09 | 0.10 | -0.13 | -0.08 |
| Completed cycles (buy-backs below the sale) | 0 | 0 | 0 | 0 | 0 | 1 | 4 | 1 | 0 | 9 | 2 |
| Fresh entries after a missed rebound | not stored (equal-sleeve arm) | 0 | 0 | 9 | 6 | 0 | 32 | 15 | 0 | 43 | 26 |
| Fresh entries, never held or lapsed | not stored (equal-sleeve arm) | 0 | 5 | 3 | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| Missed rebounds | not stored (equal-sleeve arm) | 0 | 10 | 17 | 16 | 10 | 42 | 25 | 10 | 53 | 36 |
| Stocks retired after a missed rebound (policy A) | not stored (equal-sleeve arm) | 0 | 10 | 0 | 0 | 10 | 0 | 0 | 10 | 0 | 0 |
| Initial-loss exits | not stored (equal-sleeve arm) | 0 | 4 | 6 | 5 | 2 | 8 | 6 | 3 | 23 | 18 |
| Rule exits | not stored (equal-sleeve arm) | 0 | 6 | 11 | 11 | 9 | 38 | 20 | 7 | 39 | 20 |
| Time in cash (money-weighted) | 6.20% | 3.02% | 88.29% | 85.59% | 85.09% | 97.28% | 89.03% | 94.20% | 98.33% | 90.48% | 94.55% |
| Total costs (spread, slippage, fees) | US$9.67 | US$4.25 | US$49.60 | US$35.32 | US$51.64 | US$32.53 | US$206.69 | US$124.34 | US$30.83 | US$293.13 | US$158.07 |
| Dividends net (gross) | US$515.62 (US$606.62) | US$803.39 (US$945.16) | US$86.91 (US$102.25) | US$86.91 (US$102.25) | US$86.91 (US$102.25) | US$40.01 (US$47.06) | US$54.80 (US$64.47) | US$40.01 (US$47.06) | US$21.94 (US$25.81) | US$36.73 (US$43.21) | US$21.94 (US$25.81) |
| Pause episodes · sessions paused | not stored (equal-sleeve arm) | 15 · 510 | 0 · 0 | 2 · 839 | 1 · 809 | 0 · 0 | 1 · 863 | 1 · 864 | 0 · 0 | 1 · 812 | 1 · 789 |
| Stocks never entered | not stored (equal-sleeve arm) | MU, TSLA, VST, PYPL, SNAP | none | VST, SNAP | none | none | none | none | none | none | none |
| Sells · buys after day one · initial buys | 0 · 0 · 10 | 0 · 0 · 5 | 10 · 5 · 5 | 17 · 12 · 5 | 16 · 11 · 5 | 11 · 6 · 5 | 46 · 41 · 5 | 26 · 21 · 5 | 10 · 5 · 5 | 62 · 57 · 5 | 38 · 33 · 5 |
| Invested fraction (average) | not stored (equal-sleeve arm) | 96.98% | 11.71% | 14.41% | 14.91% | 2.72% | 10.97% | 5.80% | 1.67% | 9.52% | 5.45% |
| Tech/AI exposure, maximum | not stored (equal-sleeve arm) | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 | US$0.00 |

### Assumed against realistic fills (stored comparison, base run against its VWAP run)

| Arm | Fills matched | Median abs. difference (bps) | Mean abs. difference (bps) | End value, open fills | End value, VWAP fills | Difference |
|---|---|---|---|---|---|---|
| Hold (fully invested) | 10 | 10.17 | 18.04 | US$51178.76 | US$51224.71 | US$45.94 |
| Hold day-one positions | 5 | 3.28 | 4.94 | US$35204.66 | US$35199.34 | -US$5.33 |
| X1A | 19 | 27.58 | 34.96 | US$18490.85 | US$18648.59 | US$157.75 |
| X1B | 28 | 38.66 | 44.12 | US$18568.81 | US$18791.14 | US$222.33 |
| X1C | 30 | 34.25 | 43.73 | US$18132.34 | US$18351.85 | US$219.51 |
| X2A | 22 | 12.62 | 22.96 | US$15387.30 | US$15428.02 | US$40.73 |
| X2B | 90 | 23.11 | 38.31 | US$15161.04 | US$15074.82 | -US$86.22 |
| X2C | 51 | 21.75 | 34.82 | US$14531.67 | US$14415.53 | -US$116.14 |
| X3A (comparison) | 19 | 6.93 | 20.07 | US$15125.46 | US$15151.15 | US$25.69 |
| X3B (comparison) | 112 | 26.27 | 38.68 | US$13874.97 | US$14214.75 | US$339.78 |
| X3C (comparison) | 69 | 23.99 | 35.94 | US$14077.78 | US$14443.69 | US$365.91 |

### Pause episodes (base costs)

- **Hold (fully invested):** not stored (equal-sleeve arm, no pause rule)
- **Hold day-one positions:** 2018-02-08 to 2018-02-14 (deepest decline from the peak US$1879.91, 5 sessions); 2018-03-23 to 2018-04-17 (deepest decline from the peak US$2259.44, 17 sessions); 2018-07-30 to 2018-08-08 (deepest decline from the peak US$1632.36, 8 sessions); 2018-10-10 to 2019-03-05 (deepest decline from the peak US$4893.35, 99 sessions); 2019-05-09 to 2019-07-10 (deepest decline from the peak US$3322.98, 43 sessions); 2019-08-05 to 2019-12-18 (deepest decline from the peak US$2871.57, 96 sessions); 2020-02-24 to 2020-05-11 (deepest decline from the peak US$7041.00, 55 sessions); 2020-07-24 to 2020-08-06 (deepest decline from the peak US$2008.93, 10 sessions); 2020-09-04 to 2021-01-20 (deepest decline from the peak US$4079.14, 94 sessions); 2021-02-25 to 2021-03-01 (deepest decline from the peak US$1544.32, 3 sessions); 2021-03-03 to 2021-03-11 (deepest decline from the peak US$1903.61, 7 sessions); 2021-05-10 to 2021-05-25 (deepest decline from the peak US$2339.88, 12 sessions); 2021-07-30 to 2021-08-25 (deepest decline from the peak US$2135.29, 19 sessions); 2021-09-20 to 2021-11-09 (deepest decline from the peak US$3042.81, 36 sessions); 2021-11-26 to 2021-12-27 (deepest decline from the peak US$2347.21, 21 sessions)
- **X1A:** none
- **X1B:** 2018-10-05 to still paused at the end (deepest decline from the peak US$1830.93, 815 sessions)
- **X1C:** 2018-10-19 to still paused at the end (deepest decline from the peak US$1915.62, 805 sessions)
- **X2A:** none
- **X2B:** 2018-07-27 to still paused at the end (deepest decline from the peak US$1529.82, 864 sessions)
- **X2C:** 2018-07-27 to still paused at the end (deepest decline from the peak US$1635.41, 864 sessions)
- **X3A (comparison):** none
- **X3B (comparison):** 2018-11-12 to still paused at the end (deepest decline from the peak US$1895.43, 789 sessions)
- **X3C (comparison):** 2018-11-12 to still paused at the end (deepest decline from the peak US$2102.21, 789 sessions)

The day-one hold never buys after day one, so its pauses change nothing. They are listed because the engine records them.

### Stocks never entered and how long they waited (base costs)

- **Hold (fully invested):** not stored (equal-sleeve arm; every stock bought on day one: none missing)
- **Hold day-one positions:** MU waiting time not stored (the hold rule has no entry after day one); TSLA waiting time not stored (the hold rule has no entry after day one); VST waiting time not stored (the hold rule has no entry after day one); PYPL waiting time not stored (the hold rule has no entry after day one); SNAP waiting time not stored (the hold rule has no entry after day one)
- **X1A:** none
- **X1B:** VST waited 1070 sessions from 2017-09-29
- **X1C:** none
- **X2A:** none
- **X2B:** none
- **X2C:** none
- **X3A (comparison):** none
- **X3B (comparison):** none
- **X3C (comparison):** none

## Which candidates qualified

Stored bar: ending value above US$51178.76 (the higher benchmark), with at least 10 completed cycles.

| Candidate | Completed cycles | At least 10? | Ending value | Above the bar? |
|---|---|---|---|---|
| X1A | 1 | no | US$18490.85 | no |
| X1B | 0 | no | US$18568.81 | no |
| X1C | 2 | no | US$18132.34 | no |
| X2A | 1 | no | US$15387.30 | no |
| X2B | 4 | no | US$15161.04 | no |
| X2C | 1 | no | US$14531.67 | no |

None qualified, so nothing was picked or frozen. X3A to X3C are comparisons and can never be picked. X3B completed 10 cycles and ended at US$13874.97.

**Frozen config:** none (no `hxr-1.0.0`). **Neighbouring settings:** not run. They are run only for a picked candidate, and the stored `developmentPick` setting has `chosen: null`.

## Warnings and errors recorded by the runs

Counts per code, from each run's stored warning list (its length matches the stored warning count in every run). No run stored an error.

| Run | Arm | Fills | entry_skipped | pause_end | pause_start | rebound_missed | Total |
|---|---|---|---|---|---|---|---|
| 1 | Hold (fully invested) | open | 0 | 0 | 0 | 0 | 0 |
| 2 | Hold day-one positions | open | 5 | 15 | 15 | 0 | 35 |
| 3 | X1A | open | 36 | 0 | 0 | 10 | 46 |
| 4 | X1B | open | 589 | 0 | 1 | 20 | 610 |
| 5 | X1C | open | 534 | 0 | 1 | 18 | 553 |
| 6 | X2A | open | 6 | 0 | 0 | 10 | 16 |
| 7 | X2B | open | 575 | 0 | 1 | 42 | 618 |
| 8 | X2C | open | 538 | 0 | 1 | 25 | 564 |
| 9 | X3A (comparison) | open | 6 | 0 | 0 | 10 | 16 |
| 10 | X3B (comparison) | open | 544 | 0 | 1 | 64 | 609 |
| 11 | X3C (comparison) | open | 484 | 0 | 1 | 36 | 521 |
| 12 | Hold (fully invested) | vw15 | 0 | 0 | 0 | 0 | 0 |
| 13 | Hold day-one positions | vw15 | 5 | 15 | 15 | 0 | 35 |
| 14 | X1A | vw15 | 36 | 0 | 0 | 10 | 46 |
| 15 | X1B | vw15 | 596 | 1 | 2 | 17 | 616 |
| 16 | X1C | vw15 | 546 | 0 | 1 | 16 | 563 |
| 17 | X2A | vw15 | 6 | 0 | 0 | 10 | 16 |
| 18 | X2B | vw15 | 575 | 0 | 1 | 42 | 618 |
| 19 | X2C | vw15 | 538 | 0 | 1 | 25 | 564 |
| 20 | X3A (comparison) | vw15 | 6 | 0 | 0 | 10 | 16 |
| 21 | X3B (comparison) | vw15 | 562 | 0 | 1 | 53 | 616 |
| 22 | X3C (comparison) | vw15 | 483 | 0 | 1 | 36 | 520 |

`entry_skipped` counts include lapsed buy signals by reason. The stored reasons for the base runs:

- Hold (fully invested): not stored
- Hold day-one positions: budget 5
- X1A: budget 36
- X1B: budget 79, paused 510
- X1C: budget 57, paused 477
- X2A: budget 6
- X2B: budget 38, paused 537
- X2C: budget 14, paused 524
- X3A (comparison): budget 6
- X3B (comparison): budget 55, paused 489
- X3C (comparison): budget 22, paused 462

## Per-stock P/L

No candidate was picked, so there is no picked candidate's table. Below are both benchmarks at base costs, as stored.

### Hold (fully invested) (run 1)

| Stock | Start value | End value | P/L | P/L % | Dividends net | Costs |
|---|---|---|---|---|---|---|
| MU | US$1500.00 | US$3483.68 | US$1983.68 | 132.25% | US$6.29 | US$0.82 |
| AMZN | US$1500.00 | US$3869.82 | US$2369.82 | 157.99% | US$0.00 | US$0.52 |
| META | US$1500.00 | US$2819.13 | US$1319.13 | 87.94% | US$0.00 | US$0.55 |
| TSLA | US$1500.00 | US$21264.73 | US$19764.73 | 1317.65% | US$0.00 | US$0.79 |
| VST | US$1500.00 | US$1919.51 | US$419.51 | 27.97% | US$110.13 | US$5.83 |
| GOOG | US$1500.00 | US$3433.00 | US$1933.00 | 128.87% | US$0.00 | US$0.61 |
| INTC | US$1500.00 | US$2201.54 | US$701.54 | 46.77% | US$180.42 | US$0.70 |
| CSCO | US$1500.00 | US$3027.64 | US$1527.64 | 101.84% | US$218.79 | US$0.59 |
| PYPL | US$1500.00 | US$4353.00 | US$2853.00 | 190.20% | US$0.00 | US$0.84 |
| SNAP | US$1500.00 | US$4806.73 | US$3306.73 | 220.45% | US$0.00 | US$1.13 |

### Hold day-one positions (run 2)

| Stock | Start value | End value | P/L | P/L % | Dividends net | Costs |
|---|---|---|---|---|---|---|
| MU | not stored | US$0.00 | US$0.00 | not stored | US$0.00 | US$0.00 |
| AMZN | not stored | US$10003.02 | US$7109.45 | not stored | US$0.00 | US$1.57 |
| META | not stored | US$5717.95 | US$2803.15 | not stored | US$0.00 | US$1.17 |
| TSLA | not stored | US$0.00 | US$0.00 | not stored | US$0.00 | US$0.00 |
| VST | not stored | US$0.00 | US$0.00 | not stored | US$0.00 | US$0.00 |
| GOOG | not stored | US$8680.77 | US$5798.99 | not stored | US$0.00 | US$1.84 |
| INTC | not stored | US$4017.00 | US$1403.07 | not stored | US$360.84 | US$1.40 |
| CSCO | not stored | US$5639.93 | US$3090.00 | not stored | US$442.55 | US$1.20 |
| PYPL | not stored | US$0.00 | US$0.00 | not stored | US$0.00 | US$0.00 |
| SNAP | not stored | US$0.00 | US$0.00 | not stored | US$0.00 | US$0.00 |

The day-one hold is a pooled arm, so no per-stock start value is stored for it. The stocks with an end value and P/L of US$0.00 (MU, TSLA, VST, PYPL, SNAP) were never bought: their day-one allocation lapsed for budget.
