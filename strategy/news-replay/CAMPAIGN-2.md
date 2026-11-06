# news-replay, campaign 2: AMT exits on the volume-profile entry (pre-registered; simulation only)

**Status: FROZEN at its commit.** Written 2026-11-06 on master work order version 3, Phase B2 (`AUTONOMY.md`; news-replay EXPERIMENT-LOG.md entry 2), as a new recorded experiment, never an edit to campaign 1. Pinned with `matrix-2.json` (the configurations, levels, comparisons, inference and budget) by LF-normalised SHA-256 when its code is built; a change is a new campaign document with a log entry naming the results seen.

**What had been seen when this was written:** no news-replay outcome. Campaign 1's Phase A runs (D-A and P-A) were running in the background while this document was written, and their output was not opened before this document was committed; no run of entry C (D-C, which is this campaign's X1) existed. Earlier programmes' results on 2020 to 2021 had been seen (other rules; listed in campaign 1's limitations). The order's own proposals (the X3 target and the X4 level) are used as written.

**Every numeric setting below is an experimental assumption (author-selected), not the owner's trading preference.** Every result on 2020-01-02 to 2021-12-31 is **exploratory**: a heavily used development period. Simulation only: no broker, order, paper-trading or account code.

## 1. Question and comparisons fixed in advance

Does Auction Market Theory timing of the **exit** help? The entry signal is fixed: campaign 1's deterministic planner D with the volume-profile pullback entry C (campaign 1's configuration D-C, unchanged). Only the exit differs:

| Config | Exit |
|---|---|
| X1 | the existing exits (the control): campaign 1's invalidation exit, 10-session time stop and bearish-activation exit, unchanged |
| X2 | AMT acceptance exit, plus X1's exits |
| X3 | AMT target exit, plus X1's exits |
| X4 | price-only matched exit (X2's rule with a price-only level), plus X1's exits |

Comparisons (statistic S = T(first) − T(second), where T = a run's net profit after costs minus its exposure-matched hold's net profit, as in campaign 1):
- **E1, acceptance against existing:** X2 vs X1.
- **E2, target against existing:** X3 vs X1.
- **E3, what volume profile adds:** X2 vs X4.

A comparison is descriptive only when fewer than 30 entries filled in X1 (the entries are identical in all four; the exits differ).

## 2. What is fixed from campaign 1 (by reference, unchanged)

The data (the same database and the same data manifest hash as campaign 1's `**Frozen for campaign 1**` entry, 062021bcd0cf7c8daac8d56faf6032e78086fe3417f3f7becde1aa780b293907; nothing after 2021-12-31); the replay period 2020-01-02 to 2021-12-31; the items and eligibility (CAMPAIGN-1.md section 3); planner D's stored plans (`nr_plans`, planner D, their chain and packet hashes re-verified before use); entry C exactly as CAMPAIGN-1.md section 5; the volume profile exactly as section 6 (prior completed regular session, 1-minute bars, bins of 0.1% of that session's close anchored at zero, each bar's volume spread evenly across the bins its range covers, POC with its tie rule, the 70% value area by adding the larger of the next two bins above and below, value-area high and low as the outer edges of the included bins; never a developing or same-session profile; no order-flow delta); the portfolio, sizing, costs, dividends and splits of section 7; same-time ordering (session opens, then sells, then buys, then the close).

**Reproduction check:** X1 must reproduce campaign 1's D-C base run to the cent (net profit, completed trades and every action) before X2 to X4 run; a difference stops the campaign as a defect.

## 3. 30-minute bars

Built from the stored 5-minute regular-session bars (themselves built from the 1-minute bars): windows of 30 minutes from 09:30 New York time ([09:30, 10:00), [10:00, 10:30), ... [15:30, 16:00)); on an early-close day the windows end at the close (13:00 gives seven). Open = the first 5-minute bar's open, high = the highest high, low = the lowest low, close = the last 5-minute bar's close, volume = the sum. A window with no 5-minute bar has no 30-minute bar. A 30-minute bar is used only after its window ends; its decision is taken at that time.

**Counted bars:** for a position filled at time f, only 30-minute bars whose window starts at or after f count (the bar containing the fill is never used, because part of it precedes the fill).

## 4. X2, the AMT acceptance exit

For a counted 30-minute bar of session s, the reference profile is session s−1's (the prior completed session; for a position filled on s, that is the profile before the fill), in session s's share units (levels divided by any split ratio between them). **Acceptance back into value:** the bar's close is inside that value area and below its point of control: **VAL ≤ close < POC**. A close exactly at the POC is not below it (no exit); a close exactly at the value-area low is inside (exit). Then the position is sold at the open of the next printed 5-minute bar; when the bar is the session's last, at the first printed bar of the next session. A session whose prior session has no bars has no acceptance check. Read as a failed move: price back in the prior session's accepted value and below its fairest price.

## 5. X3, the AMT target exit

**The target is fixed at the fill** (fill session f, raw fill price F = the bar's open before costs):
1. Let P be session f−1's profile, in f's share units. The primary target is **VAH(P) + (VAH(P) − VAL(P))** (the value-area high plus that value area's height).
2. If F is at or above the primary target (entered above it): the **composite profile** of the five completed sessions before f (f−5 to f−1, each in f's share units), built as in section 2 but with the bins of 0.1% of session f−1's close anchored at zero, each session's 1-minute bars added into the same bins. Among the bins whose lower edge is above F, the highest-volume bin (ties to the lower price) gives the target: **that bin's lower edge** (the price at which the bin is first reached). If no bin lies above F, the position has **no target** and X1's exits alone apply (counted and reported).
3. The target is divided by any later split ratio.

**Execution:** a resting sell at the target from the 5-minute bar after the fill bar. **Touch:** a bar whose high exceeds the target by at least US$0.01 (in the bar's units) fills at the target; a bar that opens at or above the target fills at its open (a gap through the target). A bar whose high only equals the target, or exceeds it by less than one cent, does not fill (the limit may not have traded: against the trade). The sale pays the same costs as every sale (half-spread and slippage, SEC fee, TAF).

**Intrabar ordering:** an exit scheduled for a bar's open (invalidation, bearish activation) fills at that open before any touch in the same bar; a touch during the time stop's session precedes its close; nothing else acts inside a bar. Where the order cannot be known, it is resolved against the trade (the one-cent rule above).

## 6. X4, the price-only matched exit

X2's rule with the value-area boundary replaced by a price-only level of similar role: **the low of the activation bar** (the 5-minute bar whose close activated the bullish scenario), in current share units. At the end of each counted 30-minute bar, a close **strictly below** that level sells at the open of the next printed 5-minute bar (the next session's first bar after the session's last). Plus X1's exits. X2 against X4 isolates what the volume profile adds.

## 7. Several exits at once

A position is sold once. When several exits fall due, the sale is at the earliest fill time; at equal fill times the recorded reason follows the earliest decision, and decisions taken at the same time are recorded in the order invalidation, bearish activation, acceptance (X2) or price-only level (X4), target (X3), time stop.

## 8. Sensitivities, benchmarks and reporting

Sensitivities (reported, not configurations), as campaign 1: costs doubled; every fill one printed bar later (a target touch then fills at the next printed bar's open); every fill moved to the first printed bar of the next session. Benchmarks: the equal-weight buy-and-hold of basket A and each run's exposure-matched hold (CAMPAIGN-1.md section 8). Reports give everything campaign 1's do, plus the exits by reason, the targets set (primary, composite, none) and how many filled, the acceptance and price-only exits taken, and the four plain-English answers (master work order version 3, section 7), including **did the AMT exits beat the existing exits and the price-only exit**.

## 9. Inference

The date-clustered event-time placebo of CAMPAIGN-1.md section 9, unchanged in its construction and its disclosed limits: each resample moves the plan groups to item-free sessions, re-plans with the fast plan path (checked equal to the planner on every real group before use), runs entry C with X1 to X4, and recomputes E1 to E3. **R = 10,000 resamples, one mulberry32 stream with seed 20261108**, consumed in a fixed order; p = (1 + #{S_r ≥ S_obs}) / (1 + R); **Holm** step-down over E1, E2 and E3 at α = 0.05 (m = 3 fixed; a descriptive-only comparison counts as not significant).

## 10. Selection

A **development candidate** is the first arm of a tested comparison whose S is positive and Holm-significant, and that arm has T > 0 at the base case and under each sensitivity, at least 30 completed trades, a maximum drawdown of at most 15% and no stock above 40% of the gross gain. NONE is a valid outcome; nothing is picked automatically; a candidate is never called validated or proven profitable. A run with positive net profit made money even if it fails qualification; reports say both. If X1's result is the best, Phase C1 uses the control exits (master work order version 3, C1).

## 11. Budget and chronology

- 4 configurations (the order's maximum), each with 3 sensitivities: 16 runs, then the placebo. Up to 2 defect replacements, each with the defect, its verification and the correction recorded; the broken result kept.
- Execution budget: 1 hour including the placebo.
- Its own code revision (separate from campaign 1's, so campaign 1's records stay valid); before any run: this document and `matrix-2.json` pinned at their commit, a `**Frozen for campaign 2**` log entry naming that code revision, the commit and the same data manifest hash, and X1's reproduction check passing. Every run is logged.
- Order: this document is committed before campaign 1's Phase B1 runs D-C.

## 12. Limitations

All of campaign 1's (a hand-picked basket of ten survivors; a heavily examined period; one news aggregator; volume profile approximated from bars; modelled costs; the placebo's limits for news-heavy stocks). In addition: the number of filled entry-C trades bounds the power of every comparison here; the exits are tested on one entry only; 30-minute bars are built from 5-minute bars of the regular session only; a resting target is modelled from bar highs, not from the order book.
