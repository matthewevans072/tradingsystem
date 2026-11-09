# prop-sim, campaign 1: ICT structure strategies in a simulated Lucid evaluation (pre-registered; simulation only)

**Status: FROZEN at its commit.** Written 2026-11-09 on the owner's work order (EXPERIMENT-LOG.md entry 1), after the rules file and the data inventory (entry 2) and before any data was downloaded or any outcome computed. Pinned with `matrix-1.json` by LF-normalised SHA-256 when the code is built; a change is a new campaign document with a log entry naming the results seen.

**Simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid.** Campaign 1 runs on **Option B: stand-in, regular hours only, not futures** (QQQ and SPY 1-minute bars converted to NQ and ES points). If the owner approves Option A (real CME futures), the same frozen matrix runs again on it as a separately labelled campaign; sources are never mixed within a run. **Every numeric setting below is an experimental assumption (author-selected), not the owner's trading preference.** The period 2018-06-01 to 2022-12-30 was already used by sweep-bos (QQQ and SPY) and the ICT Lab (QQQ) with ICT-style rules, and NQ and ES track the same market: every result is **exploratory**. Simulation only: no account, login, broker, order, paper-trading or practice account.

## 1. The question and the main comparison

For each configuration: how often a simulated LucidFlex 50K evaluation passes, how often a passed account reaches its first payout, and the expected result per attempt after fees and costs, **against random entries under the same risk rules** (section 8). Passing some evaluations is not evidence; only a pass rate above the matched random baseline by more than chance is.

## 2. Data, units and markets

- **Bars:** QQQ and SPY 1-minute bars of the regular session (09:30 to 16:00 New York; early closes end earlier), 2018-06-01 to 2022-12-30, Alpaca SIP raw, stored in prop-sim's own database; nothing after 2022-12-30 is requested, stored or read. **5-minute bars** for every signal are built from the 1-minute bars in windows from 09:30 (open = first open, high = highest high, low = lowest low, close = last close); fills and exits use the **1-minute bars** after the decision.
- **Conversion (fixed):** NQ points = QQQ × 41.0; ES points = SPY × 10.0; rounded to the tick (0.25 points). Prices are handled as **integer ticks**.
- **Contracts:** MNQ (US$0.50 per tick) on the NQ stand-in and MES (US$1.25 per tick) on the ES stand-in; 10 micros = 1 mini for Lucid's limits. Whole contracts only.
- **Markets:** each configuration trades one market (NQ or ES) in its own account.

## 3. Levels (support and resistance) and the volatility unit

- **PDH / PDL:** the highest high and lowest low of the previous session's regular-hours 1-minute bars.
- **PWH / PWL:** the highest high and lowest low of the previous calendar week's (Monday to Friday) regular sessions; none in the first week of the data.
- **ONH / ONL (overnight):** the high and low from 18:00 New York the evening before to 09:29: **only on real futures data (Option A)**; absent on the stand-in.
- **Support levels** (long sweeps; short level breaks): PDL, PWL (and ONL on futures). **Resistance levels** (short sweeps; long level breaks): PDH, PWH (and ONH on futures).
- **ATR:** the mean high-low range of the last 14 completed 5-minute bars (across sessions when fewer than 14 exist today); the volatility unit for the minimum stop.

## 4. Structure (the ICT Lab's code, imported, never edited)

From `server/ictlab/rules.js`: `swingHighs`, `swingLows` (left 1, right 1), `confirmedBy` (a swing at i is usable from the close of bar i + 1), `isSweepBar`, `sweepExtreme`, `bosAt` (an upward break of structure: the first close above the most recent confirmed swing high), `downwardBosAt`, `bullishFvg` (the latest bullish fair value gap inside the leg), `inversionAt` (the most recent bearish gap a close has gone through: an inverse fair value gap), `orderBlock` (the latest bearish bar at or before the leg's origin). They work on one session's 5-minute bars from 09:30, which is index 0.

**Short trades** use the same functions on **mirrored bars** (open, high, low, close become −open, −low, −high, −close): a bearish setup on the original bars is the bullish setup on the mirror, and every level, zone and price maps back by negation. No rule is written twice.

**Market structure shift (change of character), added:** a long MSS at the close of bar k is an upward break (`bosAt(k)` true) when the most recent break of either direction earlier in the session (the latest j < k with `bosAt(j)` or `downwardBosAt(j)` true) was **downward**; a short MSS mirrors it. A break with no earlier break in the session is not a shift.

## 5. Trading windows

New York morning 09:30 to 11:30 and afternoon 13:30 to 15:30: a setup must confirm at the close of a 5-minute bar ending inside a window, and its entry must fill before that window ends. London (02:00 to 05:00) only on real futures data. **The windows are deliberately wider than the ICT Lab's 09:30 to 11:00, because its round 1 had too few trades (54 fills at best against 100).** Every position is closed by **15:55** at the open of the 15:55 1-minute bar (the flat-by time; Lucid's own is 16:45 Eastern), and before the close on early-close days.

## 6. The configurations (both directions; at most 12, here 10)

The stop buffer is 1 tick; the **minimum stop distance** is 0.25 ATR (a smaller stop is widened to it); the **target is 2R** (R = the distance from the entry to the stop); a limit entry is placed at the confirmation close and fills on the first 1-minute bar after it whose price goes strictly through the entry, only while the window lasts and at most 30 minutes.

| Id | Family | Market |
|---|---|---|
| F1-NQ, F1-ES | Sweep, then a market structure shift, then the fair value gap | NQ, ES |
| F2-NQ, F2-ES | Break of structure, then an inverse fair value gap retest | NQ, ES |
| F3-NQ, F3-ES | Level break, then an order block retest | NQ, ES |
| LB-NQ, LB-ES | Plain level break, no ICT confirmation (baseline) | NQ, ES |
| RND-NQ, RND-ES | Random entries matched to each configuration above (baseline, 1,000 seeds each) | NQ, ES |

- **F1 (long; short mirrors):** a sweep bar s in a window (`isSweepBar` against any support level: low below it, close back above); a long MSS at a bar k with s < k ≤ s + 12 inside the window; the extreme bar from `sweepExtreme(s, k)`; the fair value gap `bullishFvg(extreme bar, k)`, none: no trade. Entry: the gap's midpoint, rounded down to the tick. Stop: the sweep extreme minus 1 tick.
- **F2:** an upward break (`bosAt(k)`) in a window; the inverse fair value gap `inversionAt(k)` (a bearish gap formed earlier in the session, at least 3 bars before k, that bar k closes through), none: no trade. Entry: the gap's midpoint, rounded down. Stop: the gap's low minus 1 tick.
- **F3:** a long level break at bar k in a window (the close above a resistance level, the previous close at or below it); the leg's origin = the bar with the lowest low among bars k − 6 to k; the order block `orderBlock(origin)`, which must lie entirely below bar k's close; none: no trade. Entry: the block's midpoint, rounded down. Stop: the block's low minus 1 tick. (The breaker variant is not run, to keep the matrix within its limit.)
- **LB:** the same level break as F3; entry at the open of the first 1-minute bar after the break bar's close (market order); stop: the break bar's low minus 1 tick.
- **Signals per day:** at most 2 trades per window (4 a day), one position at a time; a setup that confirms while a position is open, or after the window's limit, is recorded as skipped. When several setups confirm on the same bar, the long one is taken first, then the earlier level in the order PDL/PDH, PWL/PWH.
- **RND (the matched random baseline):** for each tested configuration and each seed (1,000 seeds, mulberry32, seed 20261109 + seed number), each day gets the same number of trades as that configuration took that day, in the same windows, each at a uniformly random 1-minute bar of the window at or after the previous random trade's exit, in a random direction (a fair coin), with the configuration's own stop distance for that trade (in ticks), the same 2R target, market entry at that bar's open, the same exits, sizing, costs and account rules.

## 7. Execution, costs and sizing

- **Fills:** only on 1-minute bars after the decision. Entries pay **1 tick of slippage** (a long fills 1 tick above its price). Exits: on the fill bar, a touch of the stop stops the trade (the target is not tested on the fill bar); on each later 1-minute bar the stop is tested first (a low at or below the stop exits at the lower of the stop and the bar's open, minus 1 tick of slippage); otherwise a high strictly above the target exits at the target (a limit, no slippage); otherwise the flat-by time exits at the 15:55 bar's open. **Intrabar ordering is against the trade** (stop before target).
- **Costs:** US$0.50 per micro contract per side, all-in (assumption; Lucid's rules pages publish none).
- **Sizing:** the risk budget is 25% of the **room** (the live balance minus the Max Loss Limit) and at most US$400; contracts = the largest whole number whose stop-out loss (stop distance plus 1 tick of slippage, plus commissions both sides) fits the budget, capped by the plan's contract limit; fewer than one contract: the trade is skipped as unfunded.

## 8. The accounts and the scoring

**Primary: LucidFlex 50K, DLL Off, 40% consistency** (the main comparison). **Secondary: LucidPro 50K, DLL On** (reported, descriptive). Rules as `LUCID-RULES-2026-11-09.json` records them, the stricter reading where unclear:

- **Max Loss Limit:** starts at US$48,000; after each session MLL = min(highest closing balance − US$2,000, US$50,100); a breach when the live balance including the open position at a 1-minute bar's adverse extreme reaches the MLL (stricter reading): the attempt fails there.
- **Evaluation:** passes at the close of the first session at which the profit is at least US$3,000 and, on LucidFlex, the largest single-day profit is at most 40% of the profit; LucidPro has no evaluation consistency rule. Contract limit 40 micros. **LucidPro's daily loss limit** US$1,200: when the day's result including the open position touches −US$1,200, the position closes at that price (less 1 tick) and no further trade is taken that session (a soft breach). No time limit by rule; the simulation **times out after 60 sessions** (author-selected horizon), counted as not passed.
- **Funded stage (after a pass):** a fresh US$50,000 account from the next session, the same MLL rule; LucidFlex's scaling plan (20 micros below US$1,000 of profit at the previous close, 30 below US$2,000, else 40); LucidPro 40 micros with its funded daily loss limit (US$1,200 until a close above US$52,100, then 60% of the highest end-of-day profit). **First payout:** LucidFlex when the cycle has at least 5 sessions with at least US$150 profit, positive net profit, and 50% of the profit (at most US$2,000) is at least US$500; LucidPro when the cycle profit is at least US$500, the largest day is at most 40% of it, and the balance above US$52,100 allows at least US$500 (at most US$2,000). The trader receives 90%. Checked at each session's close. The funded stage ends at the first payout (success), a breach (failure) or after 120 sessions (no payout).
- **Attempts:** one evaluation attempt starts at the open of every session from 2018-06-01 whose 60-session horizon ends by 2022-12-30; a funded stage still open at 2022-12-30 is reported as unfinished.
- **Fees (assumption; unverified third-party prices, the higher figure):** LucidFlex 50K US$175, LucidPro 50K US$129.50, paid once per attempt; no activation fee. Every expected result is also given before fees.
- **Reported per configuration and plan:** the pass rate, the median sessions to pass, the payout rate (per attempt and per pass), the expected net result per attempt (trader payouts minus the fee) and before the fee, the worst losing streak and the completed trades of the configuration's signal trades, the median share of the US$2,000 room used, and the days stopped by a daily loss limit.

## 9. Inference

- **Statistic (primary account):** D = the configuration's pass rate − the mean pass rate of its 1,000 random twins.
- **Resampling by start month:** attempts are grouped by the month they start; 10,000 resamples of the months with replacement (mulberry32, seed 20261110) recompute D; **p = (1 + #{D* ≤ 0}) / (1 + 10,000)** (one-sided: beats random).
- **Holm** step-down over the 8 tested configurations (F1, F2, F3 and LB on each market) at α = 0.05. A configuration with **fewer than 100 completed trades** is "insufficient sample", descriptive only, and counts as not significant.
- **Also reported:** the seed rank (1 + the number of random twins with a pass rate at least the configuration's) / 1,001; each ICT configuration against the plain level break of its market (the same month resampling, descriptive); LucidPro's results.
- **What the outcome can be:** a configuration **beats random** only when its D is positive and Holm-significant with at least 100 completed trades. **A configuration that passes sometimes but no more often than random has shown no edge, and the report says so plainly.** NONE is a valid outcome; nothing is picked automatically; nothing is called validated.

## 10. Reporting

Every report says "simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid" and "stand-in, regular hours only, not futures", and answers in plain English: 1. how often it passed, and whether it made money after fees; 2. whether it beat random entries and the plain level break; 3. how much risk it took (drawdown room used, losing streaks, days stopped by the daily limit); 4. how strong the evidence is (sample, the test, how often this period has been tested before).

## 11. Budget and chronology

10 configurations (cap 12); the random twins (8 × 1,000 seeds) and the month resampling run in a resumable worker; execution budget 4 hours; up to 2 defect replacements, each with the defect, its verification and the correction recorded, the broken result kept. Order: this document committed, then the code and tests, a `**Frozen for campaign 1**` log entry naming the code revision, this commit and the data hash, then the runs and the report.

## 12. Limitations

Stand-in bars (no overnight session, no futures roll or basis, the ETF's opening gap); a fixed price ratio; one period already examined; Lucid's rules as read by a tool on one date; unverified prices; modelled commissions and slippage; a 60-session horizon that the rules do not have; overlapping attempts (handled by month resampling, which still assumes months are independent).
