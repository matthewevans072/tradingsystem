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
