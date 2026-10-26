# HXR development runs: read-only diagnosis (2026-10-26)

Scope: the 22 runs of the one development pick (selection ledger row 1, runs 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22), read from `data/hxr-sim.sqlite` opened read-only. Only the run tables were read (runs, decisions, fills, episodes, equity points); the bar tables were not. No price series are reproduced; the traces quote a few stored simulated fill and decision values because the work order asks for them. Nothing was run. These runs used the defective code (tag `hxr-devpick-code`, EXPERIMENT-LOG entries 17-18).

Labels: **[Recorded]** copied from stored fields; **[Derived]** calculated from stored records (formula given); **[Hypothesis]** an interpretation that needs more evidence; **[Not stored]** not available in the database.

## 1. Retraction: the tech/AI cap did not operate

- **[Recorded]** Every stored run lists all ten stocks with `techAi: false` (`details.meta.symbols`), and every stored sizing record in the pooled runs has `caps.techAi = null`, the value the engine writes when the cap does not apply. That is 0 of 1127 sizing records with a tech/AI cap value. `exposure.maxTechAiUsd` is 0 in every pooled run.
- **[Recorded]** Earlier statements that the US$10,500 tech/AI limit shaped these runs are withdrawn: it never applied, because `data.js` `buildInputs` dropped the tags (fixed in `409c353`, EXPERIMENT-LOG entry 18). The development report of 2026-10-23 already disclosed this.
- This diagnosis makes no prediction of what the corrected code would have produced.

**Limits that did operate** (all 20 pooled runs, base and VWAP; the fully invested hold has no sizing):

- **[Recorded]** Binding caps on buys that were placed (the decision's `sizing.binding`; one buy can have several): cash 3, openRisk 4, plannedLoss 187, position 371.
- **[Recorded]** Skipped buys (`entry_skipped`) by stored reason: paused: 6045; budget: no whole share fits (no binding cap recorded; lowest stored cap: openRisk, below zero): 243; budget: below the minimum size (position binding): 213; budget: below the minimum size (cash binding): 129; budget: below the minimum size (openRisk binding): 28; budget: no whole share fits (cash binding): 6; budget: no whole share fits (openRisk binding): 5; budget: no whole share fits (openRisk+cash binding): 1.
- **[Recorded]** Reporting gap found: when a cap is below zero (for example open risk already above the US$750 budget, or cash already reserved), `sizeBuy` stores an empty `binding` list, because only caps equal to the clipped share count of 0 are listed. For those skips the table names the lowest stored cap instead **[Derived]**: the minimum of the stored `caps` values. The code is not changed here.
- **[Derived]** So the limits that operated were: the planned loss per trade, the position cap, the open-risk budget (where it appears above), the available cash, the minimum size (half the planned loss asked for), and the account-decline pause. Each was counted from the reasons above. The tech/AI cap did not operate.

## 2. Per run

Exits come from stored episodes (`endTrigger`). Invested fraction per day = invested ÷ equity, from each stored equity point **[Derived]**. A "day with more than 50% cash" has cash ÷ equity > 0.5 **[Derived]**. Holding period = the number of stored equity points (sessions) from an episode's start fill date up to, but not including, its end fill date **[Derived]**. Open holdings are counted to the period end and reported apart.

| Run | Arm | Fills | rebound_missed | entry_skipped by reason | order_cancelled | Initial-loss exits · rule exits | Pause start · end | Invested fraction avg · max | Days with >50% cash | Holding period median · longest (completed) | Open at the end (sessions held) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Hold (fully invested) | open | 0 | none | none | 0 · 0 | 0 · 0 | 92.86% · 96.50% | 0 of 1070 (0.00%) | none completed | 10 (1070, 1070, 1070, 1070, 1070, 1070, 1070, 1070, 1070, 1070) |
| 2 | Hold day-one positions | open | 0 | budget: below the minimum size (cash binding) 5 | none | 0 · 0 | 15 · 15 | 97.00% · 97.88% | 0 of 1070 (0.00%) | none completed | 5 (1070, 1070, 1070, 1070, 1070) |
| 3 | X1A | open | 10 | budget: below the minimum size (cash binding) 8, budget: below the minimum size (openRisk binding) 2, budget: below the minimum size (position binding) 2, budget: no whole share fits (no binding cap recorded; lowest stored cap: openRisk, below zero) 24 | none | 5 · 6 | 0 · 0 | 12.47% · 97.80% | 971 of 1070 (90.75%) | 29.00 · 256 | none |
| 4 | X1B | open | 20 | budget: below the minimum size (cash binding) 8, budget: below the minimum size (openRisk binding) 7, budget: below the minimum size (position binding) 6, budget: no whole share fits (no binding cap recorded; lowest stored cap: openRisk, below zero) 58, paused 510 | none | 8 · 12 | 1 · 0 | 16.02% · 97.80% | 891 of 1070 (83.27%) | 20.00 · 256 | none |
| 5 | X1C | open | 18 | budget: below the minimum size (cash binding) 8, budget: below the minimum size (openRisk binding) 2, budget: below the minimum size (position binding) 7, budget: no whole share fits (no binding cap recorded; lowest stored cap: openRisk, below zero) 39, budget: no whole share fits (openRisk binding) 1, paused 477 | none | 9 · 11 | 1 · 0 | 15.48% · 97.80% | 905 of 1070 (84.58%) | 15.50 · 256 | none |
| 6 | X2A | open | 10 | budget: below the minimum size (cash binding) 5, budget: below the minimum size (position binding) 1 | none | 2 · 9 | 0 · 0 | 2.72% · 97.73% | 1043 of 1070 (97.48%) | 14.00 · 33 | none |
| 7 | X2B | open | 42 | budget: below the minimum size (cash binding) 7, budget: below the minimum size (openRisk binding) 4, budget: below the minimum size (position binding) 26, budget: no whole share fits (cash binding) 1, paused 537 | none | 7 · 39 | 1 · 0 | 10.64% · 97.73% | 948 of 1070 (88.60%) | 12.50 · 35 | none |
| 8 | X2C | open | 25 | budget: below the minimum size (cash binding) 5, budget: below the minimum size (position binding) 9, paused 524 | none | 5 · 21 | 1 · 0 | 5.47% · 97.73% | 1022 of 1070 (95.51%) | 10.50 · 33 | none |
| 9 | X3A | open | 10 | budget: below the minimum size (cash binding) 5, budget: below the minimum size (position binding) 1 | none | 3 · 7 | 0 · 0 | 1.64% · 97.73% | 1056 of 1070 (98.69%) | 7.50 · 18 | none |
| 10 | X3B | open | 64 | budget: below the minimum size (cash binding) 9, budget: below the minimum size (openRisk binding) 4, budget: below the minimum size (position binding) 37, budget: no whole share fits (cash binding) 3, budget: no whole share fits (openRisk binding) 1, budget: no whole share fits (openRisk+cash binding) 1, paused 489 | none | 32 · 42 | 1 · 0 | 10.69% · 99.79% | 969 of 1070 (90.56%) | 8.00 · 42 | none |
| 11 | X3C | open | 36 | budget: below the minimum size (cash binding) 5, budget: below the minimum size (position binding) 17, paused 462 | none | 17 · 21 | 1 · 0 | 5.12% · 97.73% | 1039 of 1070 (97.10%) | 8.00 · 42 | none |
| 12 | Hold (fully invested) | vw15 | 0 | none | none | 0 · 0 | 0 · 0 | 92.87% · 96.50% | 0 of 1070 (0.00%) | none completed | 10 (1070, 1070, 1070, 1070, 1070, 1070, 1070, 1070, 1070, 1070) |
| 13 | Hold day-one positions | vw15 | 0 | budget: below the minimum size (cash binding) 5 | none | 0 · 0 | 15 · 15 | 97.02% · 97.91% | 0 of 1070 (0.00%) | none completed | 5 (1070, 1070, 1070, 1070, 1070) |
| 14 | X1A | vw15 | 10 | budget: below the minimum size (cash binding) 8, budget: below the minimum size (openRisk binding) 2, budget: below the minimum size (position binding) 2, budget: no whole share fits (no binding cap recorded; lowest stored cap: openRisk, below zero) 24 | none | 4 · 6 | 0 · 0 | 12.45% · 97.83% | 969 of 1070 (90.56%) | 35.50 · 256 | none |
| 15 | X1B | vw15 | 17 | budget: below the minimum size (cash binding) 8, budget: below the minimum size (openRisk binding) 2, budget: below the minimum size (position binding) 7, budget: no whole share fits (no binding cap recorded; lowest stored cap: openRisk, below zero) 55, paused 524 | none | 6 · 11 | 2 · 1 | 15.01% · 97.83% | 910 of 1070 (85.05%) | 16.00 · 256 | none |
| 16 | X1C | vw15 | 16 | budget: below the minimum size (cash binding) 8, budget: below the minimum size (openRisk binding) 2, budget: below the minimum size (position binding) 7, budget: no whole share fits (no binding cap recorded; lowest stored cap: openRisk, below zero) 39, budget: no whole share fits (openRisk binding) 1, paused 489 | none | 5 · 11 | 1 · 0 | 15.31% · 97.83% | 907 of 1070 (84.77%) | 25.00 · 256 | none |
| 17 | X2A | vw15 | 10 | budget: below the minimum size (cash binding) 5, budget: below the minimum size (position binding) 1 | none | 2 · 9 | 0 · 0 | 2.72% · 97.76% | 1043 of 1070 (97.48%) | 14.00 · 33 | none |
| 18 | X2B | vw15 | 42 | budget: below the minimum size (cash binding) 7, budget: below the minimum size (openRisk binding) 2, budget: below the minimum size (position binding) 26, budget: no whole share fits (cash binding) 1, budget: no whole share fits (openRisk binding) 2, paused 537 | none | 8 · 38 | 1 · 0 | 10.65% · 97.76% | 948 of 1070 (88.60%) | 12.50 · 35 | none |
| 19 | X2C | vw15 | 25 | budget: below the minimum size (cash binding) 5, budget: below the minimum size (position binding) 9, paused 524 | none | 6 · 20 | 1 · 0 | 5.46% · 97.76% | 1022 of 1070 (95.51%) | 10.50 · 33 | none |
| 20 | X3A | vw15 | 10 | budget: below the minimum size (cash binding) 5, budget: below the minimum size (position binding) 1 | none | 3 · 7 | 0 · 0 | 1.66% · 97.76% | 1056 of 1070 (98.69%) | 7.50 · 18 | none |
| 21 | X3B | vw15 | 53 | budget: below the minimum size (cash binding) 8, budget: below the minimum size (openRisk binding) 1, budget: below the minimum size (position binding) 37, budget: no whole share fits (cash binding) 1, budget: no whole share fits (no binding cap recorded; lowest stored cap: openRisk, below zero) 4, paused 511 | none | 23 · 39 | 1 · 0 | 9.09% · 97.76% | 989 of 1070 (92.43%) | 8.00 · 42 | none |
| 22 | X3C | vw15 | 36 | budget: below the minimum size (cash binding) 5, budget: below the minimum size (position binding) 17, paused 461 | none | 18 · 20 | 1 · 0 | 5.18% · 97.76% | 1041 of 1070 (97.29%) | 8.00 · 42 | none |

All columns except the derived ones are **[Recorded]** counts of stored warnings and episodes.

## 3. Eight traces (X1A, X1B, X2A at base costs)

Each example is the earliest one in the first of X1A, X1B and X2A that has one. "Next possible signal" dates are not inferred: only stored decisions and warnings are quoted.

### A winning holding

Run 3 (X1A).

- Stock **META**, holding started by initial **[Recorded]**.
- Buy decision **[Recorded]**: 2017-09-29, initial_allocation; initial allocation: 17 shares, planned loss 71.95 (asked 75.00; plannedLoss, position binding); values: close 170.87, m 1.69, initialLossMultiple 2.50; sizing: shares 17, d 4.23, planned loss 71.95, binding plannedLoss+position.
- Buy fill **[Recorded]**: 2017-10-02, 17 shares at 171.46 (open 171.39), initial-loss level 167.23.
- Exit decision **[Recorded]**: 2017-11-29; trigger rule; close 175.13 is below the recovery-point level 177.28375.
- Sale **[Recorded]**: 2017-11-30, 17 shares at 176.78; holding P/L US$90.39 (3.10%).
  - Next recorded decision for META after 2017-11-30 **[Recorded]**: none stored to the period end.
  - Next recorded entry-related warning for META after 2017-11-30 **[Recorded]**: none stored.

### An initial-loss exit

Run 3 (X1A).

- Stock **MU**, holding started by fresh_entry **[Recorded]**.
- Buy decision **[Recorded]**: 2018-01-08, fresh_entry; fresh entry: a recovery point (close 41.12, 5 sessions ago) is confirmed for a stock not held; buy at the next open at any price; values: close 45.55, previousExitPrice null, recoveryClose 41.12, highestAfter 46.88, m 0.87, pivotSessions 5.00, reboundMultiple 1.00, sessionsOut 68.00, sessionsSinceMissedRebound null, afterMissedRebound false; sizing: shares 65, d 2.18, planned loss 141.62, binding position.
- Buy fill **[Recorded]**: 2018-01-09, 65 shares at 45.29 (open 45.27), initial-loss level 43.11.
- Exit decision **[Recorded]**: 2018-01-09; trigger initial_loss; close 42.97 is below the initial-loss level 43.109358.
- Sale **[Recorded]**: 2018-01-10, 65 shares at 41.93; holding P/L -US$218.13 (-7.41%).
  - Next recorded decision for MU after 2018-01-10 **[Recorded]**: none stored to the period end.
  - Next recorded entry-related warning for MU after 2018-01-10 **[Recorded]**: none stored.

### A rule exit followed by a missed rebound

Run 3 (X1A).

- Stock **GOOG**, holding started by initial **[Recorded]**.
- Buy decision **[Recorded]**: 2017-09-29, initial_allocation; initial allocation: 3 shares, planned loss 46.82 (asked 75.00; position binding); values: close 959.11, m 6.24, initialLossMultiple 2.50; sizing: shares 3, d 15.61, planned loss 46.82, binding position.
- Buy fill **[Recorded]**: 2017-10-02, 3 shares at 960.59 (open 959.98), initial-loss level 944.98.
- Exit decision **[Recorded]**: 2017-12-01; trigger rule; close 1010.17 is below the recovery-point level 1015.2645.
- Sale **[Recorded]**: 2017-12-04, 3 shares at 1011.99; holding P/L US$154.12 (5.35%).
- Missed rebound **[Recorded]**: 2017-12-06: GOOG: close 1018.38 is at or above the exit price 1011.98538261689 before any buy-back signal: rebound missed (policy stay_out).
  - Next recorded decision for GOOG after 2017-12-04 **[Recorded]**: none stored to the period end.
  - Next recorded entry-related warning for GOOG after 2017-12-04 **[Recorded]**: 2017-12-06 rebound_missed: GOOG: close 1018.38 is at or above the exit price 1011.98538261689 before any buy-back signal: rebound missed.

### A fresh entry

Run 4 (X1B).

- Stock **META**, decision 2018-04-04: fresh_entry **[Recorded]**. fresh entry: a recovery point (close 152.19, 5 sessions ago) is confirmed after a missed rebound (previous exit 176.77926); buy at the next open at any price
- Recorded numbers **[Recorded]**: close 155.10, previousExitPrice 176.78, recoveryClose 152.19, highestAfter 159.79, m 3.29, pivotSessions 5.00, reboundMultiple 1.00, sessionsOut 85.00, sessionsSinceMissedRebound 84.00, afterMissedRebound true; sizing: shares 18, d 8.23, planned loss 148.19 (asked 150.00), binding plannedLoss.
- Fill **[Recorded]**: 2018-04-05, 18 shares at 161.62, initial-loss level 153.39.
- That holding's end **[Recorded]**: 2018-07-27, trigger rule, sold at 179.80; P/L US$327.05.
  - Next recorded decision for META after 2018-07-27 **[Recorded]**: 2018-09-25 fresh_entry (fresh entry: a recovery point (close 160.3, 5 sessions ago) is confirmed after a missed rebound (previous exit 179.798052); buy at the next open at any price).
  - Next recorded entry-related warning for META after 2018-07-27 **[Recorded]**: 2018-08-06 rebound_missed: META: close 185.69 is at or above the exit price 179.798052 before any buy-back signal: rebound missed.

### A buy-back below the sale

Run 3 (X1A).

- Stock **AMZN**, decision 2018-10-18: buy_back **[Recorded]**. a recovery point (close 1719.36, 5 sessions ago) is confirmed below the exit price 1872.7472313747999; buy at the next open only if the fill is below 1872.7472313747999
- Recorded numbers **[Recorded]**: close 1770.72, exitPrice 1872.75, recoveryClose 1719.36, highestAfter 1831.73, m 33.20, pivotSessions 5.00, reboundMultiple 1.00; sizing: shares 1, d 83.01, planned loss 83.01 (asked 150.00), binding plannedLoss+position.
- Fill **[Recorded]**: 2018-10-19, 1 shares at 1786.35, initial-loss level 1703.34.
- The round trip **[Recorded]**: sold 2018-10-08 at 1872.75, bought back 2018-10-19 at 1786.35; change -4.61%; 9 sessions out.
- That holding's end **[Recorded]**: 2018-10-25, trigger initial_loss, sold at 1702.20; P/L -US$84.19.
  - Next recorded decision for AMZN after 2018-10-25 **[Recorded]**: none stored to the period end.
  - Next recorded entry-related warning for AMZN after 2018-10-25 **[Recorded]**: none stored.

### A buy skipped for budget (after day one)

Run 3 (X1A).

- Stock **SNAP**, 2017-10-17 **[Recorded]**: SNAP: fresh entry: a recovery point (close 14.34, 5 sessions ago) is confirmed for a stock not held; buy at the next open at any price; skipped: planned loss 19.33 is below the minimum 75.00 (cash binding)
- Stored details **[Recorded]**: reason code budget; caps {"plannedLoss":170,"position":186,"openRisk":38,"techAi":null,"cash":22}; binding cash; available cash 364.54; open risk now 716.16; signal values: close 16.09, previousExitPrice null, recoveryClose 14.34, highestAfter 16.55, m 0.35, pivotSessions 5.00, reboundMultiple 1.00, sessionsOut 12.00, sessionsSinceMissedRebound null, afterMissedRebound false.
- Fill **[Recorded]**: none (skipped).
  - Next recorded decision for SNAP after 2017-10-17 **[Recorded]**: 2018-06-05 fresh_entry (fresh entry: a recovery point (close 10.55, 5 sessions ago) is confirmed for a stock not held; buy at the next open at any price).
  - Next recorded entry-related warning for SNAP after 2017-10-17 **[Recorded]**: 2017-11-01 entry_skipped: SNAP: fresh entry: a recovery point (close 14.16, 5 sessions ago) is confirmed for a stock not held; buy at the next open at any price; skipped: no whole share fits the budgets ( binding).

### A buy skipped for the pause

Run 4 (X1B).

- Stock **TSLA**, 2018-10-15 **[Recorded]**: TSLA: fresh entry: a recovery point (close 250.56, 5 sessions ago) is confirmed after a missed rebound (previous exit 313.36396929377196); buy at the next open at any price; skipped, the account is paused
- Stored details **[Recorded]**: reason code paused; signal values: close 259.59, previousExitPrice 313.36, recoveryClose 250.56, highestAfter 262.80, m 10.85, pivotSessions 5.00, reboundMultiple 1.00, sessionsOut 72.00, sessionsSinceMissedRebound 69.00, afterMissedRebound true.
- Fill **[Recorded]**: none (skipped).
  - Next recorded decision for TSLA after 2018-10-15 **[Recorded]**: none stored to the period end.
  - Next recorded entry-related warning for TSLA after 2018-10-15 **[Recorded]**: 2018-11-19 entry_skipped: TSLA: fresh entry: a recovery point (close 331.28, 5 sessions ago) is confirmed after a missed rebound (previous exit 313.36396929377196); buy at the next open at any price; skipped, the account is paused.

### A stock never entered

Run 4 (X1B).

- Stock **VST** **[Recorded]**: never bought; waiting since 2017-09-29, 1070 sessions by the end.
- Its stored skips **[Recorded]**: 68 (budget: below the minimum size (cash binding) 2, budget: below the minimum size (openRisk binding) 3, budget: no whole share fits (no binding cap recorded; lowest stored cap: openRisk, below zero) 12, paused 51); the first: 2017-09-29: initial allocation of VST skipped: planned loss 5.11 is below the minimum 37.50 (cash binding).
  - Recorded decisions for VST in the whole run **[Recorded]**: none.

## 4. Interpretation

- **[Hypothesis]** Under policies B and C, the pause behaves as a near-permanent stop. Once the account is US$1,500 below its peak while mostly in cash, it rarely gets back within US$750, because new buys are blocked. The stored pause episodes (one per B/C run, open to the end) are consistent with this, but these runs alone cannot show it.
- **[Hypothesis]** Day one used the cash in alphabetical order (five positions near the US$3,000 cap). The other five stocks then depended on later fresh entries, which the pause blocked. This would explain the high cash share. How much the corrected tech/AI cap would change it is not predicted here.
- **[Hypothesis]** The 243 skips whose stored open-risk room is below zero happened while the open risk of existing holdings exceeded the US$750 budget. Open risk is shares × (close − exit level), so it grows when a holding rises and its exit level does not rise with it (the initial-loss level never moves; the X1 level moves only at a new recovery point). If so, a winning holding blocks new entries. Checking this needs the stored `openRiskNow` of each skip set against its holdings, which this report does not tabulate.
- **[Hypothesis]** The low cycle counts come from exits followed by missed rebounds more often than from buy-backs below the sale. Compare the rebound_missed counts with the completed cycles in the development report.

---

## Supplement (2026-10-26, second pass)

Same source and rules as above: `data/hxr-sim.sqlite` opened read-only, the run tables of runs 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22 only, no bars, nothing run. Labels as above.

### a. Corrected totals: base runs and VWAP reruns apart

Section 1 above added the base runs and their VWAP reruns together. Counting them separately **[Recorded]**: counts of stored `entry_skipped` warnings, by reason code:

| Run set | Runs | paused | budget | of which: no binding cap recorded | other |
|---|---|---|---|---|---|
| Base costs | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 | 2999 | 318 | 121 | 0 |
| VWAP reruns | 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22 | 3046 | 307 | 122 | 0 |

The VWAP reruns repeat the base decisions with different fill prices, so adding them double-counts the same situations. The base figures are the ones to quote.

### b. Skipped buys per stock and reason (base runs) **[Recorded]**

- **Hold (fully invested)** (run 1): none.
- **Hold day-one positions** (run 2): MU: budget 1; PYPL: budget 1; SNAP: budget 1; TSLA: budget 1; VST: budget 1.
- **X1A** (run 3): MU: budget 2, budget (no binding cap recorded) 2; PYPL: budget 2, budget (no binding cap recorded) 3; SNAP: budget 2, budget (no binding cap recorded) 7; TSLA: budget 2, budget (no binding cap recorded) 4; VST: budget 4, budget (no binding cap recorded) 8.
- **X1B** (run 4): MU: budget 2, budget (no binding cap recorded) 8, paused 51; PYPL: budget 2, budget (no binding cap recorded) 5, paused 50; SNAP: budget 2, budget (no binding cap recorded) 10, paused 49; TSLA: budget 4, budget (no binding cap recorded) 5, paused 47; VST: budget 5, budget (no binding cap recorded) 12, paused 51; META: budget (no binding cap recorded) 5, budget 1, paused 51; GOOG: budget 4, budget (no binding cap recorded) 7, paused 56; INTC: budget (no binding cap recorded) 3, paused 57; CSCO: budget (no binding cap recorded) 3, budget 1, paused 48; AMZN: paused 50. Paused skips: 510, over 10 distinct stocks (TSLA, MU, PYPL, SNAP, AMZN, GOOG, INTC, CSCO, META, VST), first 2018-10-15, last 2021-12-28.
- **X1C** (run 5): MU: budget 2, budget (no binding cap recorded) 4, paused 48; PYPL: budget 2, budget (no binding cap recorded) 5, paused 49; SNAP: budget 3, budget (no binding cap recorded) 7, paused 48; TSLA: budget 2, budget (no binding cap recorded) 4, paused 45; VST: budget 3, budget (no binding cap recorded) 12, paused 47; GOOG: budget (no binding cap recorded) 4, budget 5, paused 49; META: budget (no binding cap recorded) 1, paused 51; INTC: budget (no binding cap recorded) 2, paused 51; CSCO: budget 1, paused 44; AMZN: paused 45. Paused skips: 477, over 10 distinct stocks (META, MU, SNAP, PYPL, TSLA, INTC, AMZN, GOOG, CSCO, VST), first 2018-11-05, last 2021-12-28.
- **X2A** (run 6): MU: budget 1; PYPL: budget 1; SNAP: budget 1; TSLA: budget 1; VST: budget 2.
- **X2B** (run 7): MU: budget 2, paused 55; PYPL: budget 2, paused 53; SNAP: budget 1, paused 49; TSLA: budget 2, paused 50; VST: budget 4, paused 54; CSCO: budget 7, paused 51; META: budget 5, paused 54; AMZN: budget 6, paused 53; GOOG: budget 7, paused 59; INTC: budget 2, paused 59. Paused skips: 537, over 10 distinct stocks (TSLA, VST, AMZN, GOOG, CSCO, MU, PYPL, INTC, META, SNAP), first 2018-08-06, last 2021-12-28.
- **X2C** (run 8): MU: budget 1, paused 55; PYPL: budget 1, paused 49; SNAP: budget 1, paused 49; TSLA: budget 1, paused 50; VST: budget 2, paused 51; GOOG: budget 3, paused 59; META: budget 2, paused 51; CSCO: budget 2, paused 51; AMZN: budget 1, paused 53; INTC: paused 56. Paused skips: 524, over 10 distinct stocks (TSLA, AMZN, GOOG, CSCO, MU, SNAP, INTC, META, VST, PYPL), first 2018-08-06, last 2021-12-28.
- **X3A** (run 9): MU: budget 1; PYPL: budget 1; SNAP: budget 1; TSLA: budget 1; VST: budget 2.
- **X3B** (run 10): MU: budget 2, paused 48; PYPL: budget 3, paused 48; SNAP: budget 1, paused 47; TSLA: budget 2, paused 45; VST: budget 6, paused 50; AMZN: budget 11, paused 48; CSCO: budget 10, paused 47; META: budget 6, paused 50; GOOG: budget 11, paused 53; INTC: budget 3, paused 53. Paused skips: 489, over 10 distinct stocks (CSCO, META, SNAP, AMZN, PYPL, VST, TSLA, GOOG, INTC, MU), first 2018-11-21, last 2021-12-28.
- **X3C** (run 11): MU: budget 1, paused 46; PYPL: budget 1, paused 42; SNAP: budget 1, paused 44; TSLA: budget 1, paused 44; VST: budget 2, paused 48; CSCO: budget 5, paused 47; META: budget 2, paused 46; GOOG: budget 5, paused 49; AMZN: budget 4, paused 45; INTC: paused 51. Paused skips: 462, over 10 distinct stocks (CSCO, VST, TSLA, INTC, AMZN, GOOG, META, MU, PYPL, SNAP), first 2018-11-21, last 2021-12-28.

### c. Skips with no binding cap recorded: which stored caps were at or below zero

- **X1A** (run 3) **[Derived]** (caps with a stored value ≤ 0, per record): 24 records; 0 with more than one cap at or below zero; by combination: openRisk 24.
- **X1B** (run 4) **[Derived]** (caps with a stored value ≤ 0, per record): 58 records; 0 with more than one cap at or below zero; by combination: openRisk 58.
- **X1C** (run 5) **[Derived]** (caps with a stored value ≤ 0, per record): 39 records; 0 with more than one cap at or below zero; by combination: openRisk 39.

### d. Pause timelines (base runs with a pause) 

`peak`, `value` and `decline` at the start are copied from the stored `pause_start` warning **[Recorded]**. "Highest value afterwards" is the maximum stored equity on or after the start date **[Derived]**. "Within US$750 of the peak" asks whether any stored equity point after the start has `peak − equity ≤ 750`, using the peak stored with that equity point **[Derived]**.

| Run | Start | Peak at start | Account value at start | Decline at start | Highest value afterwards | Any close within US$750 of the peak afterwards? | Pause ended? |
|---|---|---|---|---|---|---|---|
| X1B (4) | 2018-10-05 | US$20399.73 | US$18825.50 | US$1574.23 | US$18825.50 | no | no (open at the end) |
| X1C (5) | 2018-10-19 | US$19967.08 | US$18386.67 | US$1580.41 | US$18503.02 | no | no (open at the end) |
| X2B (7) | 2018-07-27 | US$16690.86 | US$15187.58 | US$1503.28 | US$15187.58 | no | no (open at the end) |
| X2C (8) | 2018-07-27 | US$16167.08 | US$14536.82 | US$1630.26 | US$14536.82 | no | no (open at the end) |
| X3B (10) | 2018-11-12 | US$15707.46 | US$14120.90 | US$1586.56 | US$14339.79 | no | no (open at the end) |
| X3C (11) | 2018-11-12 | US$16179.99 | US$14554.71 | US$1625.27 | US$14670.43 | no | no (open at the end) |

The day-one hold also records pauses, but it never buys after day one, so its pauses change nothing (see section 3 above).

### e. Do the no-binding skips coincide with holdings still at their initial-loss level?

Method **[Derived]**:
- For each skip, read the stored equity point of the same date. Each holding (shares > 0) in it has a stored effective `level` and `openRisk`.
- Take the holding's initial-loss level from its most recent stored buy fill (`initialLossLevel`) before that date.
- A holding is "at its initial-loss level" when the two agree within 0.0001.
- Stored `openRisk` = shares × (close − effective level), as the engine records it.

| Run | No-binding skips | Every holding at its initial-loss level | Some holdings at it | No equity point that day | Share of summed open risk from holdings at their initial-loss level | Skips on a day with stored open risk above US$750 |
|---|---|---|---|---|---|---|
| X1A (3) | 24 | 0 | 1 | 0 | 0.63% | 24 |
| X1B (4) | 58 | 0 | 25 | 0 | 17.79% | 58 |
| X1C (5) | 39 | 0 | 14 | 0 | 13.06% | 39 |

**[Derived]** Of 121 no-binding skips in the base runs, 0 fell on a day when every holding's effective level was still its initial-loss level, 40 on a day when some holdings' levels were, and 81 on a day when none were. 121 of the 121 fell on a day with stored open risk above US$750.

**[Derived] Conclusion:** the hypothesis that these skips coincide with X1 holdings still at their initial-loss level is **refuted as stated**. Most of the open risk that blocked the entries came from holdings whose X1 level had already risen above the initial-loss level (the column above shows the small share from holdings still at it). What the records do support is the broader point: on every one of these days, the open risk of existing holdings, measured as shares × (close − effective level), exceeded the US$750 budget. The open risk of winners grows as their price rises faster than their exit level.

**[Not stored / not observable]** Overlap between the pause and the budget limits cannot be observed. While the account is paused, a buy signal is skipped before it is sized, so no sizing record exists to show whether a budget would also have blocked it.
