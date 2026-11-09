# prop-sim: experiment log

Append-only. Entries are numbered `## N | date | title`. Simulation only: no real account, no Lucid login, no broker, no order, no paper-trading or practice account, no real money. Every page and report is labelled "simulated using Lucid Trading's published rules as read on <date>; not affiliated with or endorsed by Lucid"; no Lucid logo or branding is used.

## 1 | 2026-11-09 | **The owner's work order: prop-sim, and its Phase 2 addendum** (verbatim)

The owner's message of 2026-11-09:

> WORK ORDER: prop-sim, a simulated Lucid Trading funded account testing ICT structure strategies (simulation only)
>
> This adds a new programme under master work order version 3; everything in v3 stays in force. For this programme only, the scope widens to index futures (NQ, ES and their micro contracts MNQ, MES) and to short as well as long trades, because funded futures accounts and ICT setups trade both directions. No real account, no Lucid login, no broker, no orders, no real money.
>
> 1. THE QUESTION
> For each strategy: how often does it pass a simulated Lucid evaluation, how often does a passed account reach a payout, and what is the expected result after evaluation fees and trading costs, compared with random entries under the same risk rules? A strategy is interesting only if it beats the random baseline by more than chance; passing some evaluations alone is not evidence.
>
> 2. THE ACCOUNT RULES
> - Read Lucid Trading's current published rules from their website (read-only, no login). For each plan and account size, record in strategy/prop-sim/LUCID-RULES-<date>.json, with the page URL, the date read and the exact source sentence for every rule:
>   - the profit target;
>   - the maximum loss and how it trails (end-of-day or intraday, and where it locks);
>   - any daily loss limit;
>   - any consistency rule;
>   - minimum trading days;
>   - contract limits or scaling;
>   - allowed hours and news restrictions;
>   - payout conditions;
>   - evaluation and activation fees.
> - Where a rule is unclear, record both readings and simulate the stricter one.
> - Label every page and report "simulated using Lucid Trading's published rules as read on <date>; not affiliated with or endorsed by Lucid". Use no Lucid logo or branding.
> - If the published rules change later, that is a new rules file and new runs, never an edit.
>
> 3. DATA
> - Inventory first. Alpaca has no futures.
> - Option A, real futures: estimate the one-time cost of 1-minute CME history for NQ, ES, MNQ and MES (including overnight hours) from a pay-as-you-go provider such as Databento, for the development period below. Ask me once with the exact cost, symbols and dates. Buy nothing without my yes.
> - Option B, stand-ins, free, start now: QQQ and SPY 1-minute bars (regular hours only) from the existing Alpaca data, converted to NQ and ES points by a ratio fixed in advance. Label everything "stand-in, regular hours only, not futures".
> - Build and test on B while A waits. Never mix sources within one run. If A is approved, rerun the frozen matrix on A as a separately labelled campaign.
>
> 4. DATE WINDOWS
> - Development: 2018-06-01 to 2022-12-30 only. Disclose that sweep-bos and the ICT Lab already used this period on QQQ and SPY, and that NQ and ES track the same market, so results are exploratory.
> - The 2023-2024 evaluation window and the 2025-2026 reserve stay closed. Ask me before any other period.
>
> 5. STRATEGIES (frozen in strategy/prop-sim/CAMPAIGN-1.md before any outcome is read; at most 12 configurations including baselines)
> - Reuse the ICT Lab's tested concept code (server/ictlab/rules.js: swings, liquidity sweep, break of structure, fair value gap, inverse fair value gap, order block, breaker) by import, never by editing it.
> - Add, with exact definitions:
>   - support and resistance levels: prior day high and low, overnight high and low when data has them, and prior week high and low;
>   - a market structure shift (change of character).
> - Trading windows: the New York morning (09:30 to 11:30) and afternoon (13:30 to 15:30) sessions, plus London (02:00 to 05:00) only on real futures data. Widening beyond the old 09:30 to 11:00 window is deliberate, because the ICT Lab's round 1 had too few trades (54 against 100); state this.
> - Proposed families, both directions:
>   - sweep of a level, then a break of structure, then entry at the fair value gap;
>   - break of structure, then an inverse fair value gap retest;
>   - a level break, then an order block or breaker retest.
> - Baselines in the same matrix:
>   - random entries with the same session, stop, target and size rules (at least 1,000 seeds);
>   - a plain level-break entry with no ICT confirmation.
> - Every number is labelled "experimental assumption (author-selected)": stop placement, fixed reward-to-risk targets, maximum trades per day, a flat-by time.
>
> 6. EXECUTION AND COSTS
> - Tick sizes and point values per contract. Whole contracts only.
> - Position size chosen from the remaining drawdown room under a fixed risk per trade.
> - Commission per side: Lucid's or the platform's published rate, else an assumption labelled as such. One tick of slippage on entries and stops.
> - Fills only on bars after the decision. Intrabar ordering is resolved against the trade (stop before target).
> - The trailing drawdown is tracked exactly as the recorded rule says, including whether it follows open profit.
>
> 7. HOW A RUN IS SCORED
> - Start one evaluation attempt on every trading day of the development period and simulate it until it passes, fails or times out under the rules. For passed attempts, continue into the funded stage until the first payout or failure.
> - Report per configuration:
>   - the pass rate, the median days to pass and the payout rate;
>   - the expected net result per attempt, after evaluation fees, costs and payouts;
>   - the worst losing streak, and the trade count.
> - The main comparison is pass rate against the random baseline, with resampling by start month so that overlapping attempts are not counted as independent. Use Holm across the configurations.
> - Under 100 completed trades means "insufficient sample", reported as description only.
>
> 8. REPORTING
> Every report answers in plain English:
> 1. How often did it pass, and did it make money after fees?
> 2. Did it beat random entries and the plain level break?
> 3. How much risk did it take (drawdown use, losing streaks, the days it hit the daily limit)?
> 4. How strong is the evidence (sample, the test, how often this period has been tested before)?
> A strategy that passes sometimes but no more often than random has shown no edge. Say so plainly.
>
> 9. BUILD AND TEST
> - An isolated module server/propsim/ with its own database (the guard refuses every other programme's file) and append-only records.
> - Synthetic tests: every rule in the rules file (trailing drawdown, daily limit, consistency, payout), each ICT concept and level definition, no look-ahead, intrabar ordering against the trade, contract sizing, and determinism.
> - A planted-bug harness. A Research page section.
> - Runs go through a resumable worker. Commits follow the existing workflow: protocol before code, code before runs, then records. Keep data out of git.
>
> 10. FIRST DELIVERABLE
> The rules file, the data inventory with the cost estimate for Option A, and the frozen CAMPAIGN-1.md. Then build and run on Option B, report the four answers, and update strategy/STATUS.md. Ask me only for the Option A purchase, any new credential, or any closed window.

The owner's second message of 2026-11-09, received while the rules were being read:

> 11. PHASE 2: THE LIVE SIMULATED FUNDED ACCOUNT (after Phase 1's report; the same tested code)
> Purpose: watch the market as it trades and run a simulated Lucid account in real time: detect the frozen ICT setups, take simulated trades, apply Lucid's recorded rules live, and show it all on a dashboard. Simulation only.
> - Live data, data only: no broker, practice/demo or paper-trading account, no order routing (my standing rule).
> - Before building, report the options with exact monthly costs and what each covers:
>   (a) real-time CME futures data for NQ, ES, MNQ and MES from a paid market-data provider (for example Databento), including exchange fees for a non-professional user, and the overnight session;
>   (b) the free stand-in: Alpaca's free real-time IEX feed for QQQ and SPY (regular hours only; IEX volume is a small share of the market, so volume-based rules are labelled unreliable on it).
>   Build on (b) now. Ask me once before any paid subscription.
> - The engine: one persistent worker (the news-forward pattern: resumable, heartbeat, Task Scheduler at logon, pause, resume, stop) that
>   - receives bars as they complete;
>   - runs the frozen strategy from Phase 1 (or the best configuration Phase 1 found, frozen as a new recorded experiment; never tuned live);
>   - records each setup and decision with its timestamp before any fill is possible;
>   - fills only on later prices, with the same costs and conservative ordering as Phase 1;
>   - enforces the recorded Lucid rules as they would apply live: trailing drawdown, daily loss limit, flat-by time, contract limits, news restrictions.
> - One simulated evaluation account at a time, starting fresh after a pass or failure, with every attempt kept. Results are shown live, labelled "running simulated result, not validated".
> - Dashboard (Research page section, refreshing every few seconds):
>   - the live chart with marked levels, sweeps, structure breaks and gaps;
>   - each setup seen, and whether it was taken or skipped and why;
>   - open simulated positions with stop and target;
>   - today's P/L, drawdown left, daily limit left, progress to the profit target;
>   - every past attempt with its outcome.
> - A missed period (PC off, feed down) is recorded as a gap. The account is flat across it, nothing is backfilled, and the gap is shown on the dashboard.
> - Tests on synthetic live streams: decisions before fills, rule enforcement at the exact limit, gap handling, restart from a checkpoint, determinism against the Phase 1 engine on the same bars.

## 2 | 2026-11-09 | **The rules read and the data inventoried** (before any strategy outcome; nothing downloaded yet)

**Rules** (`LUCID-RULES-2026-11-09.json`): Lucid Trading's help center (`support.lucidtrading.com`) read on 2026-11-09, read-only, no login, 25 pages, with every rule's URL and the sentences as the page-reading tool returned them. `lucidtrading.com` itself refused the tool (HTTP 403), so evaluation prices and LucidFlex's daily-loss-limit amounts could not be read from Lucid; prices are taken from unverified third-party listings as an experimental assumption (the higher figure where they disagree) and every report also gives results before fees. Unclear rules recorded with both readings and the stricter one simulated: the breach basis (live balance including the open position), the daily loss limit's basis (realized plus open), the LucidFlex payout size (50% of profit, capped). Plans simulated: **LucidFlex 50K, DLL Off, 40% consistency** (primary) and **LucidPro 50K, DLL On** (secondary). Recorded, not simulated: LucidDaily (its red-folder news rule is a hard breach and the page defines neither the events nor the time around them; no news calendar exists in the data), LucidDirect (no evaluation), LucidMaxx (invitation only), LucidBlack (legacy).

**Data** (`DATA-INVENTORY.md`): Alpaca has no futures. Option B (QQQ and SPY 1-minute regular-session bars, 2018-06-01 to 2022-12-30, converted at NQ = 41.0 × QQQ and ES = 10.0 × SPY, labelled "stand-in, regular hours only, not futures") starts now. Option A (Databento `GLBX.MDP3` `ohlcv-1m` for NQ, ES, MNQ, MES, all hours, 2018-06-01 to 2022-12-30; MNQ and MES from 2019-05-06) is estimated at about US$0.20 to US$4 from published per-GB pricing and record sizes, inside the US$125 free credit; the exact figure needs Databento's cost tool, which needs an account and API key (a new credential), so the owner is asked once. Phase 2 options: (a) Databento live CME, US$199 a month (Standard plan); (b) Alpaca's free real-time IEX feed. Nothing is bought or subscribed.

## 3 | 2026-11-09 | **Frozen for campaign 1**

code revision: `ps-code-2026-11-09-1`; engine `ps-engine-1`; campaign commit: `067f7098c8d686cd62dfbd1f96135f87c826c4e4`; HEAD `6e14765eede223baafa50bfaf61b3e4b3774c844`; data hash: `44144eb2414c0ef690cab95158d654fd4b3d817afafd4906846651867f4ded9a` (QQQ and SPY 1-minute regular-session bars, 2018-06-01 to 2022-12-30). stand-in, regular hours only, not futures. Implementation ends here.

## 4 | 2026-11-09 | **Signal counts seen before any run** (a timing check during the build; no profit, loss, pass or payout figure was computed or seen)

While timing the code on the downloaded data, the number of signal trades per configuration was printed: F1 46 (NQ) and 36 (ES), F2 1,227 and 1,068, F3 278 and 254, LB 1,738 and 1,795; and one random twin's trade count and run time for LB-NQ (1,609 trades) and F2-ES (1,061). By the pre-registered rule (CAMPAIGN-1.md section 9) F1-NQ and F1-ES have fewer than 100 completed trades and will be reported as insufficient sample, description only. Nothing in the campaign was changed after these counts were seen.

## 5 | 2026-11-09 | **Run** run id: 1, config: F1-NQ, status: done

completed trades 46; LucidFlex 50K pass rate 0, payouts 0, expected net per attempt US$-175 (before the fee US$0); LucidPro 50K pass rate 0. stand-in, regular hours only, not futures; exploratory.

## 6 | 2026-11-09 | **Run** run id: 2, config: F1-ES, status: done

completed trades 36; LucidFlex 50K pass rate 0, payouts 0, expected net per attempt US$-175 (before the fee US$0); LucidPro 50K pass rate 0. stand-in, regular hours only, not futures; exploratory.

## 7 | 2026-11-09 | **Run** run id: 3, config: F2-NQ, status: done

completed trades 1227; LucidFlex 50K pass rate 0.0237, payouts 5, expected net per attempt US$-172.7 (before the fee US$2.3); LucidPro 50K pass rate 0.0128. stand-in, regular hours only, not futures; exploratory.

## 8 | 2026-11-09 | **Run** run id: 4, config: F2-ES, status: done

completed trades 1068; LucidFlex 50K pass rate 0.0073, payouts 0, expected net per attempt US$-175 (before the fee US$0); LucidPro 50K pass rate 0.0046. stand-in, regular hours only, not futures; exploratory.

## 9 | 2026-11-09 | **Run** run id: 5, config: F3-NQ, status: done

completed trades 278; LucidFlex 50K pass rate 0, payouts 0, expected net per attempt US$-175 (before the fee US$0); LucidPro 50K pass rate 0. stand-in, regular hours only, not futures; exploratory.

## 10 | 2026-11-09 | **Run** run id: 6, config: F3-ES, status: done

completed trades 254; LucidFlex 50K pass rate 0.0265, payouts 0, expected net per attempt US$-175 (before the fee US$0); LucidPro 50K pass rate 0.0265. stand-in, regular hours only, not futures; exploratory.

## 11 | 2026-11-09 | **Run** run id: 7, config: LB-NQ, status: done

completed trades 1738; LucidFlex 50K pass rate 0.0995, payouts 49, expected net per attempt US$-140.11 (before the fee US$34.89); LucidPro 50K pass rate 0.0995. stand-in, regular hours only, not futures; exploratory.

## 12 | 2026-11-09 | **Run** run id: 8, config: LB-ES, status: done

completed trades 1795; LucidFlex 50K pass rate 0.0502, payouts 14, expected net per attempt US$-166.99 (before the fee US$8.01); LucidPro 50K pass rate 0.0593. stand-in, regular hours only, not futures; exploratory.

## 13 | 2026-11-09 | **Defect replacement 1**: the worst point of a stopped trade was charged beyond the stop; ps-code-2026-11-09-1's run invalidated and kept; corrected as ps-code-2026-11-09-2

**The run under ps-code-2026-11-09-1** (entries 5 to 12; random twins and the test completed 2026-11-09T16:29Z; report kept as `reports/campaign-1-rev1-defective.md`): outcome NONE. LucidFlex 50K pass rates: F1 0.0% and 0.0% (insufficient sample), F2 2.4% and 0.7%, F3 0.0% and 2.6%, LB 9.9% and 5.0%; no configuration beat its matched random entries (p from 0.1426 to 1.0000, Holm 1.0000 for every tested one).

**The defect:** CAMPAIGN-1.md section 7 says a stop "exits at the lower of the stop and the bar's open, minus 1 tick", and section 8 judges the breach and the daily loss limit at the live balance including the open position. `signals.js` `execute` added the stop bar's full adverse extreme to the trade's worst point (MAE) before testing the stop, so a position already closed at its stop was charged the price move beyond it. The account then counted breaches and daily-limit hits that the rules would not produce, worst for tiny stops sized up to the 40-micro cap.

**Its verification** (read-only, from the stored trades of ps-code-2026-11-09-1): stopped trades whose MAE exceeded the stop-fill distance: F1-NQ 17 of 19, F1-ES 11 of 13, F2-NQ 715 of 880, F2-ES 387 of 796, F3-NQ 179 of 199, F3-ES 118 of 196, LB-NQ 1,001 of 1,116, LB-ES 679 of 1,149. Example (F2-NQ): a 4-tick stop that filled 7 ticks from the entry was charged 9 ticks. A pattern in the results pointed to it: LB-NQ used a median 98% of the drawdown room with no breach, while F2-NQ breached 479 times under the same sizing rule.

**The correction** (ps-code-2026-11-09-2): on the bar where the stop is hit, the worst point is the stop fill; the bar's extreme is counted only on bars where the position stays open. `tests/propsim.test.js` pins it (a stopped trade's worst point is 12 ticks, not the bar low's 13), and a planted bug that reintroduces the defect is caught (the harness: 20 of 20). Random results and test rows are now keyed by code revision (store migration 2, additive), so this run's rows stay beside the defective revision's. Nothing in CAMPAIGN-1.md or matrix-1.json changes; the replacement reruns the whole frozen matrix. This uses the first of the campaign's two defect replacements. The report's wording was also corrected ("behind by N points" for a negative difference; no "-0.0"); no figure changes because of that.

## 14 | 2026-11-09 | **Frozen for campaign 1**

code revision: `ps-code-2026-11-09-2`; engine `ps-engine-1`; campaign commit: `067f7098c8d686cd62dfbd1f96135f87c826c4e4`; HEAD `92fde1af7f32f38a381c36d657c8e04881e5fb02`; data hash: `44144eb2414c0ef690cab95158d654fd4b3d817afafd4906846651867f4ded9a` (QQQ and SPY 1-minute regular-session bars, 2018-06-01 to 2022-12-30). stand-in, regular hours only, not futures. Implementation ends here.

## 15 | 2026-11-09 | **Run** run id: 9, config: F1-NQ, status: done

completed trades 46; LucidFlex 50K pass rate 0, payouts 0, expected net per attempt US$-175 (before the fee US$0); LucidPro 50K pass rate 0. stand-in, regular hours only, not futures; exploratory.

## 16 | 2026-11-09 | **Run** run id: 10, config: F1-ES, status: done

completed trades 36; LucidFlex 50K pass rate 0, payouts 0, expected net per attempt US$-175 (before the fee US$0); LucidPro 50K pass rate 0. stand-in, regular hours only, not futures; exploratory.

## 17 | 2026-11-09 | **Run** run id: 11, config: F2-NQ, status: done

completed trades 1227; LucidFlex 50K pass rate 0.0246, payouts 6, expected net per attempt US$-172.21 (before the fee US$2.79); LucidPro 50K pass rate 0.0274. stand-in, regular hours only, not futures; exploratory.

## 18 | 2026-11-09 | **Run** run id: 12, config: F2-ES, status: done

completed trades 1068; LucidFlex 50K pass rate 0.0073, payouts 0, expected net per attempt US$-175 (before the fee US$0); LucidPro 50K pass rate 0.0073. stand-in, regular hours only, not futures; exploratory.

## 19 | 2026-11-09 | **Run** run id: 13, config: F3-NQ, status: done

completed trades 278; LucidFlex 50K pass rate 0, payouts 0, expected net per attempt US$-175 (before the fee US$0); LucidPro 50K pass rate 0. stand-in, regular hours only, not futures; exploratory.

## 20 | 2026-11-09 | **Run** run id: 14, config: F3-ES, status: done

completed trades 254; LucidFlex 50K pass rate 0.0265, payouts 0, expected net per attempt US$-175 (before the fee US$0); LucidPro 50K pass rate 0.0265. stand-in, regular hours only, not futures; exploratory.

## 21 | 2026-11-09 | **Run** run id: 15, config: LB-NQ, status: done

completed trades 1738; LucidFlex 50K pass rate 0.0995, payouts 49, expected net per attempt US$-140.11 (before the fee US$34.89); LucidPro 50K pass rate 0.1068. stand-in, regular hours only, not futures; exploratory.

## 22 | 2026-11-09 | **Run** run id: 16, config: LB-ES, status: done

completed trades 1795; LucidFlex 50K pass rate 0.0502, payouts 14, expected net per attempt US$-166.99 (before the fee US$8.01); LucidPro 50K pass rate 0.0593. stand-in, regular hours only, not futures; exploratory.

## 23 | 2026-11-09 | **Campaign 1 complete (ps-code-2026-11-09-2, the replacement): NONE** (simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid; stand-in, regular hours only, not futures; exploratory)

Frozen record entry 14 (HEAD 92fde1a, data hash 44144eb2...); runs entries 15 to 22, 2026-11-09T16:34Z to 16:35Z, none failed; random twins (8 × 1,000 seeds) and the month resampling complete at 16:45:03Z, 10.3 minutes of execution. Report `reports/campaign-1.md`.

| Config | Trades | LucidFlex 50K pass rate (passes of 1,096) | Random twins' mean | Month-resampled p | Holm p | First payouts | Net per attempt after the US$175 fee (before it) | LucidPro 50K pass rate |
|---|---|---|---|---|---|---|---|---|
| F1-NQ | 46 | 0.0% (0) | 0.0% | insufficient sample | — | 0 | -US$175.00 (US$0.00) | 0.0% |
| F1-ES | 36 | 0.0% (0) | 0.0% | insufficient sample | — | 0 | -US$175.00 (US$0.00) | 0.0% |
| F2-NQ | 1,227 | 2.5% (27) | 2.5% | 0.5621 | 1.0000 | 6 | -US$172.21 (US$2.79) | 2.7% |
| F2-ES | 1,068 | 0.7% (8) | 0.4% | 0.3682 | 1.0000 | 0 | -US$175.00 (US$0.00) | 0.7% |
| F3-NQ | 278 | 0.0% (0) | 3.2% | 1.0000 | 1.0000 | 0 | -US$175.00 (US$0.00) | 0.0% |
| F3-ES | 254 | 2.6% (29) | 0.9% | 0.1433 | 1.0000 | 0 | -US$175.00 (US$0.00) | 2.6% |
| LB-NQ | 1,738 | 9.9% (109) | 11.8% | 0.7452 | 1.0000 | 49 | -US$140.11 (US$34.89) | 10.7% |
| LB-ES | 1,795 | 5.0% (55) | 5.0% | 0.5369 | 1.0000 | 14 | -US$166.99 (US$8.01) | 5.9% |

**Outcome: NONE.** No configuration beat its matched random entries by more than chance; every configuration lost money per attempt after the assumed fee; the ICT families passed no more often than the plain level break, and on NQ less often. A configuration that passes sometimes but no more often than random has shown no edge.

**A property of the frozen sizing rule, stated plainly:** no evaluation in any configuration failed on the drawdown. Sizing at 25% of the remaining room shrinks positions as the room shrinks, so a losing account approaches its limit without reaching it, stops being able to fund a contract, and times out at 60 sessions (987 to 1,096 time-outs per configuration). Real fixed-size trading would breach instead; this changes the failure mode, not the pass comparison, because the random twins use the same rule. A different sizing rule would be a new campaign document.

## 24 | 2026-11-09 | **Phase 2, the live simulated funded account: the data options, the real-time check, the configuration traded, and LIVE-1.md** (before any live bar was stored)

**The options** (the order: "Before building, report the options with exact monthly costs and what each covers"), recorded in `DATA-INVENTORY.md` section 4 on 2026-11-09 before this build: (a) Databento live CME (NQ, ES, MNQ, MES, all hours): US$199 a month (Standard plan); CME personal use listed as included for up to 2 devices (a third-party snippet, to confirm); (b) Alpaca's free IEX feed for QQQ and SPY: free. Built on (b), as ordered; the paid option is put to the owner once, in `strategy/STATUS.md` ("What I need from you"). Nothing was subscribed or bought.

**The real-time check** (read-only, 2026-11-09T16:54:20Z; nothing stored; only timestamps, counts and HTTP statuses were printed): the last completed 1-minute IEX bar of QQQ and of SPY came back 21 seconds after its minute ended, with all 24 earlier minutes present; the free SIP feed's last bar was 861 seconds old (the "15 minute delay via API" on Alpaca's page is SIP's); IEX's latest-bar and latest-trade endpoints answered (HTTP 200); a request for 10 minutes of 2026-11-06 IEX bars returned 11 bars (count only), confirming the free plan serves IEX history. Disclosed because these were reads of 2026 prices before the start, though no price was printed or kept.

**The configuration traded:** the order says "runs the frozen strategy from Phase 1 (or the best configuration Phase 1 found, frozen as a new recorded experiment; never tuned live)". No Phase 1 configuration qualified (entry 23), so the account trades the best configuration by Phase 1's pre-registered primary measure, the LucidFlex 50K pass rate: **LB-NQ** (9.9%; the ICT families 0.0% to 2.6%; LB-ES 5.0%). It did not beat its random twins (p 0.7452). F1-NQ, F2-NQ and F3-NQ are detected by the same code and shown as "seen, not traded". Seen before this choice: every Phase 1 result (entries 15 to 23).

**The document:** `LIVE-1.md` and `live-1.json` (the rules of the live account: IEX bars only, nothing before the start session (the first session after the activation; the store refuses any bar before 2026-11-10); decisions recorded with their time and hash-chained before any later bar is read, fills only on 1-minute bars starting at or after the recorded time; a 90-second live grace, a 45-second bucket wait, a 120-second decision grace; gaps: nothing decided or traded after the first unobserved minute of a session, a working order cancelled, an open position closed at the last live close less 1 tick, nothing backfilled; one LucidFlex 50K attempt at a time with Phase 1's horizons, the funded stage after a pass, the next evaluation after an attempt ends; no daily loss limit and no news restriction on this plan, as recorded). The order's "starting fresh after a pass or failure" is read as: a pass leads into the funded stage (Phase 1 and the order's title, "the live simulated funded account"), and the fresh evaluation starts when the attempt ends. The order's closed windows are read as historical periods; the account reads only its own sessions as they happen.

**The code, on synthetic streams only** (`server/propsim/live.js`, `live-store.js`, `live-source.js`, `live-worker.js`, `live-config.js`, `scripts/propsim-live.mjs`, `public/views/propsim-live.js`, `/api/propsim/live`; code revision psl-code-2026-11-09-1, engine psl-engine-1): Phase 1's `setupAt`, `breaks`, `stage`, `fundedCap` and `fundedDll` are now exported (no change to any result; Phase 1's tests 12 of 12). `tests/propsim-live.test.js` 14 of 14: with every decision recorded at its bar's close and every minute observed, the live engine gives Phase 1's `runSignals` trades for F1, F2, F3 and LB (synthetic walk: 1, 22, 2 and 28 trades over 23 sessions, all equal), and a full stream through the store, a fake feed and the worker's step gives Phase 1's LB trades and its attempts; decisions before fills; the live grace, the decision grace, the flat-by time and the Max Loss Limit at their exact limits; gaps; late and out-of-order bars; the feed down; restart from the checkpoint; the control row; the IEX client's host, feed and date guards; the read-only overview. The planted-bug harness gains 14 live bugs.

**Committed:** `LIVE-1.md` and `live-1.json` as 7b1b9c2 (2026-11-09T11:27:30-06:00), before the code that pins them (`live-config.js` `LIVE_PREREG`: LIVE-1.md d3ec6dd3..., live-1.json 1e4c8255...). The planted-bug harness on the working tree (2026-11-09): 34 of 34 caught (Phase 1 20 of 20, the live account 14 of 14). `/api/propsim/live` answered over HTTP on a throwaway instance with a temporary data folder (not activated; then activated there, start 2026-11-10), deleted afterwards. The dashboard has not been opened in a browser.

## 25 | 2026-11-09 | **The live account activated; its worker and Task Scheduler entries** (running simulated result, not validated)

Code commit a5b2373 (pins LIVE-1.md and live-1.json at 7b1b9c2), pushed. `npm run psl:activate` (check mode): "the pins and the committed code check out". `npm run psl:activate -- --confirm` at **2026-11-09T17:45:41.056Z**: start session **2026-11-10**; LB-NQ on LucidFlex 50K; IEX, QQQ; code psl-code-2026-11-09-1, engine psl-engine-1; HEAD a5b2373. `npm run psl:verify`: decisions 0, chain OK, bars before the start 0. The worker started at 17:46:00Z (pid 39388; log in `data/prop-sim-live-logs`, not in git), alive at 17:46:10Z, waiting for the first session. Task Scheduler `\SignalDesk\PropSimLiveWorker` (at logon) and `\SignalDesk\PropSimLiveDaily` (weekdays from 07:00 local, every 30 minutes for 16 hours), both "worker --ensure", registered with PowerShell and read back: no execution time limit, one instance, a missed start run when the PC is on. No live bar is stored yet; the first request is due 5 seconds after 09:31 New York time on 2026-11-10. The first session has no previous-day levels, so no level-break trade is possible that day.
