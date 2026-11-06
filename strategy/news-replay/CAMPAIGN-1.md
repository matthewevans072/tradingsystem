# news-replay, campaign 1: a chronological news-driven swing replay (pre-registered; simulation only)

**Status: FROZEN.** Written 2026-11-06 on the owner's work order (EXPERIMENT-LOG.md entry 1) as amended by master work order version 3 (entry 2), after the data inventory (DATA-INVENTORY.md) and before any outcome was computed. Pinned by LF-normalised SHA-256 in `server/newsreplay/config.js` (`PREREG`) with `matrix-v1.json` (the configurations, comparisons, inference and budget), `headline-words-v1.json` (configuration DC's word lists, fixed before any headline was read) and `ai-planner-v1.json` (the AI planner's frozen specification). A change is a new campaign document with a log entry naming every result seen; this file is never edited.

**Every numeric setting below is an experimental assumption (author-selected), not the owner's trading preference.** Every result on 2020-01-02 to 2021-12-31 is **exploratory**: that period is the heavily used development period of HXR, range-trend, the research runner, event-swing and campaigns 1 to 3. Simulation only: no broker, order, paper-trading or account code.

## 1. Hypotheses and the comparisons fixed in advance

| Id | Hypothesis (to test, not to assume) | Statistic S (section 9) |
|---|---|---|
| C1 | Responding to newly eligible news and filings beats the same price rules on sessions without news. | T(D-A) − T(P-A) + T(D-B) − T(P-B) + T(D-C) − T(P-C) |
| C2 | Disarming the bullish scenario after a negative headline (fixed word list) helps. | T(DC-A) − T(D-A) |
| C3 | The AI planner beats the deterministic planner. | **not run: no API spending authorised** |
| C4 | Identity masking changes the AI planner's results. | **not run: no API spending authorised** |
| C5 | Immediate entry beats the price-only pullback. | T(D-A) − T(D-B) (the AI pair is not run) |
| C6 | The volume-profile pullback beats the price-only pullback. | T(D-C) − T(D-B) (the AI pair is not run) |

T = a run's net profit minus its exposure-matched hold's net profit (section 8). A configuration that uses only timing and prices (D, P) is an event-calendar or price rule, not news understanding; DC's word rule is the only content used.

## 2. The information boundary

- **Three times per item:** occurred (a filing's report date; unknown for news), published (news: created time; filing: EDGAR acceptance, Eastern; FOMC: the stated release time), eligible (section 3).
- **The loader** (`server/newsreplay/loader.js`) is the only bridge from stored data to a planner. For a stock and simulated time T it builds the input packet from items eligible at or before T in T's session, daily closes of earlier sessions (in T's share units), the 5-minute bars of T's session that closed at or before T, the prior completed session's volume profile, the latest FOMC statements eligible by T (context; no deterministic rule reads them) and earlier plans that predate T, and asserts that nothing later reached the packet. **The planners** (`planner.js`, `ai.js`) import no store and no loader: they receive the packet only. Holdings and cash are applied by the executor, not the planner, so the three entry treatments share identical plans.
- **Possibly revised:** a news item updated more than 15 minutes after its creation; only its headline and created time are used (its summary never).
- **Plans are saved before their activation:** every plan is written once to `nr_plans` (append-only by trigger) with the SHA-256 of its input packet and a chain hash of the previous plan of its planner; a later run recomputes every packet and refuses if any stored hash differs.
- **Outcomes** come only from the evaluation pass (`evaluate.js`), which reads a run's saved actions (`nr_actions`, append-only, hash-chained) and the daily closes after the run is stored.
- **No hindsight labels:** no catalogue, timeline or category built from later knowledge enters a packet; the event categories of section 3 are computed from the packet's own items and are used for reporting only.

## 3. Items, eligibility, plans and categories

- **About a stock:** a filing (8-K, 10-Q, 10-K and their amendments) of the company's pinned registrant, or a news item tagged with the stock (an FB tag counts as META) and with at most three symbols in all.
- **Eligible:** published + 5 minutes, then the next 5-minute bar close of the regular session (09:35, 09:40, ..., the close; early closes from the NYSE calendar). An item published outside regular hours, or whose boundary reaches the close, is eligible at the next session's first bar close (09:35). An item whose eligible session is the excluded 2021-10-25 is eligible at the next session's first bar close.
- **Plans:** one **entry plan** per stock and session with at least one newly eligible item, written at T = the eligible time of the session's first such item, with every item eligible by T. Each later distinct eligible time of an item on the same stock in the same session gets a **follow-up check** (the same planner at that time): it never opens a position; a bearish activation of a follow-up (or of any later plan) cancels a pending entry of the stock and exits a holding.
- **Event categories (reporting only):** earnings 8-K (an 8-K with item 2.02 among the plan's items), else other filing, else news; a price-only control session is "control".

## 4. The planners

- **D (deterministic):** R = the last 5-minute close at or before T (the previous session's close if T's session has no bar yet); m = the mean absolute daily close-to-close change over the 20 changes ending the previous session (needs 21 closes; otherwise no trade). Bullish activation: a 5-minute close ≥ R + 0.5 m within (T, T + 30 min]; bearish: a 5-minute close ≤ R − 0.5 m in that window (exit if held, otherwise avoid entry; cancels a pending entry); the first qualifying bar decides; otherwise no trade. Invalidation (also the sizing reference): R − 1.0 m. Time stop: 10 sessions. Expiry: the end of the second session after T. Wording never maps to a buy or a sell.
- **DC:** D, except that an item whose headline the rule of `headline-words-v1.json` classes negative (a guidance noun with a lower word, or any negative word; negative wins) disarms the bullish scenario of its plan. Nothing else changes.
- **P (price-only control):** for every stock and session with no eligible item about the stock in that session or in the three sessions before or after it, a plan at the first bar close (09:35) with no items, under D's rules. (The control set is defined with knowledge of where items fall; it is a control, not a tradable rule.)
- **AI and AIM:** specified in `ai-planner-v1.json` (one frozen model, prompt, effort, schema, menu of 0.5, 1.0 or 1.5 m and up to 10 sessions, validator, cache, masking). **Not run: no API spending authorised** (master work order version 3); C3 and C4 are never computed in this campaign.

## 5. Entries (identical plans; only the entry differs)

- **A, immediate:** fill at the open of the next printed 5-minute bar after the activation bar.
- **B, price-only pullback:** no setup unless the activation close is above the prior completed session's close (the session before the activation session, in its share units). Then, from the bar after activation, the latest bar whose low is at or below that close is the touching bar; a later bar closing above the touching bar's high is the recovery; fill at the next printed bar's open. A touch and a recovery are never the same bar.
- **C, volume-profile pullback:** B with the prior completed session's value-area high in place of its close.
- **Expiry:** a setup not filled by the end of the second session after the activation session expires. **Fates recorded for every signal:** filled, no setup, expired, rejected (funding or caps, or the invalidation level at or above the fill), cancelled (a later bearish activation of the stock between activation and fill), already held, disarmed (DC). **Plan fates (reported):** neither activated, bearish activated, bullish activated and then gain, loss at exit, invalidated or open at the end, or not filled for one of the reasons above.

## 6. The volume profile (round 1; entry C only)

The prior completed regular session only (no extended hours; a developing or same-session profile is refused by code); 1-minute bars; bins of 0.1% of that session's close, anchored at zero; each bar's volume spread evenly across the bins its high-low range covers (an approximation from bars, not true volume at price); POC = the highest-volume bin, ties to the bin nearest that session's volume-weighted average price, then the lower price; value area = 70% of the volume, built from the POC by adding the larger of the next two bins above and the next two below (above on a tie); value-area high = the upper edge of the highest included bin. High- and low-volume nodes and order-flow delta are not used; candle direction is never labelled buying or selling.

## 7. Portfolio and execution (campaign 3's limits, checked for compatibility)

US$15,000 per configuration; long only; whole shares; no leverage; one position per stock; no adding. At each fill: account value V = cash plus holdings at their previous session's close; shares = the minimum of the cash share (same-time fills share the cash equally), 20% of V, 1% of V divided by (fill − invalidation level), and the remaining 5% total planned risk (shared equally) divided by the same distance; fewer than one share is rejected; a fill at or below the invalidation level is rejected. Costs per side: k = (calibrated half-spread, floor 2 bps, + 2 bps slippage) / 10,000 (half-spreads per stock and year from HXR's spread samples dated on or before the fill, bounded at 2021-12-31); buys at open × (1 + k), sells × (1 − k), SEC fee 0.00206% and TAF US$0.000166 per share (at most US$8.30) on sells. Dividends net of 15% withholding, entitled at the ex-date session's open, paid on the pay date; splits at the session's open (shares multiplied, levels and the entry price divided, a fraction paid as cash at the first bar's open). **Exits:** a daily close below the invalidation level exits at the next session's first bar open; the time stop sells at the daily close of the 10th session after the fill session; a bearish activation exits at the next printed bar's open. Never a fill at a price from before its decision; activation and recovery use bar closes only, so no intrabar ordering arises; a missing bar delays a fill to the next printed bar. Same-time ordering: session open events, then sells, then buys, then the close.

**Sensitivities (reported, not configurations):** costs doubled (k × 2); every fill one printed bar later; every fill moved to the first printed bar of the next session (a time stop becomes the next session's first bar open).

## 8. Benchmarks and reporting

The equal-weight buy-and-hold of basket A from the open of 2020-01-02 (fractional shares, no costs, never rebalanced, dividends net of withholding reinvested; `server/rangetrend/benchmark.js`) and each run's exposure-matched hold (the index's daily return times the run's invested fraction of the previous session). Every report gives, by configuration: net profit after costs, total and annualised return, maximum drawdown, average exposure and time in cash, turnover, completed trades, holding periods, total costs, results by year, by stock and by event category, plan and signal fates (missed, expired, funding-rejected), the three sensitivities, both benchmarks, and each comparison's statistic with its placebo p raw and Holm-adjusted; and it answers in plain English (master work order version 3, section 7): did it make money after costs; did it beat its matched control, the equal-weight hold and the exposure-matched hold; how much risk and exposure it took; how strong the evidence is. Nothing is ranked on ending balance alone.

## 9. The inferential test: a date-clustered event-time placebo

Each stock's plan groups (its newly eligible items of one session, with their follow-up times) are moved to a random replay session of that stock that has no item about it and has bars, keeping each time's offset from the session open; the planner re-plans from the prices at the new time (`campaign.js` `fastPlans`, the planner's arithmetic on cached inputs, equal to the planner's plans on every real group). Groups that share a calendar date move together to one date that is item-free for every member; when no such date exists, the members are drawn separately and the count is reported. Sessions are drawn with replacement. For each resample, D-A, D-B, D-C and DC-A are re-run on the moved plans (the P runs stay as observed) and each tested comparison's S is recomputed. **R = 10,000 resamples, one mulberry32 stream with seed 20261107**, consumed in a fixed order; p = (1 + #{S_r ≥ S_obs}) / (1 + R). **Holm** step-down over the six comparisons at α = 0.05 (m = 6 is fixed; C3, C4, any descriptive-only or untested comparison count as not significant). A comparison resting on fewer than 30 events is descriptive only (C1: the smaller of entry plans and control sessions; C2: plans with a negative headline at T; C5 and C6: bullish activations; counts recorded in the log before any run).

**What it cannot say (disclosed before any result):** news-heavy stocks have very few sessions without items (measured in the counts: TSLA 3, AMZN 12, META 54 of 504), so their moved groups land on the same few sessions; most calendar dates have items for several stocks, so most date clusters cannot move together and are drawn per stock, and same-day market moves are then only partly counted once. A small p on this period is a development result, never evidence of future profit.

## 10. Selection

A **development candidate** is the first arm of a tested comparison whose S is positive and Holm-significant, and that arm has T > 0 at the base case and under each sensitivity, at least 30 completed trades, a maximum drawdown of at most 15% and no stock above 40% of the gross gain. NONE is a valid outcome; nothing is picked automatically; nothing from this period is called proven profitable. A run with positive net profit made money even if it fails qualification; reports say both.

## 11. Budget and chronology

- 11 configurations (cap 12): D-A, D-B, D-C, DC-A, P-A, P-B, P-C run; AI-A, AI-B, AI-C, AIM-A stay in the matrix as **not run: no API spending authorised**. Up to 3 defect replacements, each with the defect, its verification and the correction recorded; the broken result kept.
- **Phase A** (master work order version 3): D-A and P-A first, their results and the four answers on the Research page; **Phase B1**: D-B, P-B, D-C, P-C and DC-A, then the placebo.
- **Execution budget:** 2 hours for the deterministic and price-only arms, including the placebo.
- **Before any run:** the `**Event counts**` entry and one `**Frozen for campaign 1**` entry naming the code revision, this campaign's commit and the data manifest hash; the gate (`npm run nr:check`) refuses otherwise. No fitted model and no learning rule in round 1; results are reported by calendar year.

## 12. Limitations

One hand-picked basket of ten survivors; a heavily examined two-year period; one news aggregator, created times only, no expectations or earnings calendars; filing acceptance times as upper bounds; a volume profile approximated from bars; modelled costs; the placebo limits of section 9.
