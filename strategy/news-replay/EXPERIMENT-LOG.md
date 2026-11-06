# news-replay: experiment log (append-only)

Entries are headed `## <number> | <date> | <title>` and run until the next heading. Entries are never edited or removed; a correction is a new entry. Text inside code fences or HTML comments is not read by the gate (`server/newsreplay/config.js` `logStatus`). The gate looks for one `**Event counts**` entry, one `**Frozen for campaign 1**` entry naming the current `CODE_REVISION`, the campaign commit and the data manifest hash, and for every recorded run as `**Run** run id: N, config: D-A, config hash: <64 hex>, status: done|failed; variant: base|costs_x2|delay_bar|delay_session`.

## 1 | 2026-11-06 | **The owner's work order: news-replay** (the owner's message, verbatim, under its real date; simulation only)

> WORK ORDER: news-replay, a chronological news-driven swing replay (simulation only)
>
> Build and run a new, isolated programme, `news-replay`, that replays 2020-01-02 to 2021-12-31 through a simulated clock. At each simulated time T it sees only information available by T, prepares bullish, bearish and no-trade plans from news and prior analysis, waits for measurable conditions, and trades a simulated account accordingly or does nothing. News is the core; volume profile (Auction Market Theory) is tested only as an entry-timing tool against a matched price-only control.
>
> AUTHORIZATION
> You may, without asking me: discover and inventory sources; download from approved sources within the bounds below; build the isolated module, its store and its page; write and run synthetic tests; write and commit the protocol and campaign documents; run the frozen deterministic and price-only configurations as soon as their data is present; replace results only for verified defects; commit and push code, protocols, tests and permitted result summaries. Do not stop for routine implementation choices. Make them, and label every numeric setting in the documents "experimental assumption (author-selected)", not my trading preference.
> Ask me once, in one message, only for: any paid plan or subscription; any API spend for the AI planner above the cap I set; any date after 2021-12-31; any new credential. Keep building and testing while a question is pending.
> Simulation only. No broker, order, paper-trading or account code. Preserve HXR, range-trend, sweep-bos, ICT Lab, the Strategy Lab, the research runner, event-swing and prospective journal 1 and all their results. Do not modify or run the prospective journal from this work. No broad review workflow or subagent fan-out. Keep market data, databases, news archives, secrets and SEC_CONTACT_EMAIL out of git; never copy that email into any committed file.
>
> 1. INFORMATION BOUNDARY (the core requirement)
> - A simulated clock advances through regular sessions. At time T the decision process receives only: prices, volume and corporate actions up to T; news items and SEC filings published by T; recorded holdings, cash, pending actions and earlier plans. Nothing else is reachable from the decision code (enforce by construction: the decision module receives an input packet built by a separate loader that filters by timestamp, and has no database handle of its own).
> - Every input carries three times: occurred (if known), published, and eligible (the earliest time the system could act: published plus a processing delay of 5 minutes, then the next bar boundary; items published outside regular hours become eligible at the next session's first bar close). Experimental assumption.
> - Revisions: an item whose stored version may differ from what was first published (for example a news item whose updated time is more than 15 minutes after its created time) is marked "possibly revised"; only its headline and created time are used, never its body. Experimental assumption.
> - Outcomes are computed by a separate evaluation pass that reads decisions only after they are saved. Decisions are append-only, each stored with the hash of its input packet and a chain hash of the previous record; nothing is ever rewritten.
> - No hindsight labels: no event catalogue, timeline or category built from later knowledge enters any packet.
>
> 2. SOURCES AND DATA (inventory first, then download within bounds)
> Write strategy/news-replay/DATA-INVENTORY.md with source, provenance, licence terms, timestamp precision, coverage per stock and gaps, before the campaign document is frozen.
> - Prices: the existing Alpaca SIP source. Daily bars from HXR's database, read-only. Intraday: download 1-minute bars (5-minute if 1-minute is unavailable on the existing plan) for basket A from 2019-12-02 to 2021-12-31 through server/hxr/source.js into data/news-replay.sqlite, with a hard bound of 2021-12-31 at download, insert and every load, as sweep-bos does. Never change the price provider.
> - Company filings: SEC EDGAR with acceptance timestamps, reusing event-swing's client and SEC_CONTACT_EMAIL from .env.
> - News: the Alpaca news API (the existing key), basket A symbols, 2019-12-02 to 2021-12-31, headlines with created and updated times, stored locally and never committed. If historical news needs a paid plan, mark news unsupported and ask me once.
> - Economic and policy releases: FOMC statement dates and times from federalreserve.gov; other macro releases only if a free point-in-time source with real-time vintages is reachable without a new credential (otherwise list it as unsupported and name what is needed). In round 1 macro and election items enter the AI planner's packets as context only; no deterministic rule uses them.
> - Unsupported, stated plainly: earnings calendars as known in advance, contemporaneous analyst expectations, and therefore pre-announcement planning and any "surprise". No proxy may carry those labels. All plans are made after the first eligible report.
> - Universe: basket A (MU, AMZN, META, TSLA, VST, GOOG, INTC, CSCO, PYPL, SNAP), disclosed as a hand-picked list chosen in 2026 with retrospective selection bias. No broader universe in this work.
> - Report each stock's coverage and the earliest reliable overlap of prices, intraday bars, filings and news from 2020 onward.
>
> 3. DATE PERMISSIONS
> The replay runs 2020-01-02 to 2021-12-31 only. That period is the heavily used development period of HXR, range-trend, the research runner, event-swing and campaigns 1 to 3: state in every document and report that results on it are exploratory. Closed periods it must not touch, listed in the protocol: range-trend evaluation and HXR validation 2022-01-03 to 2023-12-29; HXR final period and range-trend reserve 2024-01-02 to 2026-10-21 (already partly exposed by prospective journal 1's warm-up); the Strategy Lab MU holdout 2025-01-01 to 2026-06-30; the sweep-bos and ICT Lab evaluation window 2023-01-03 to 2024-12-31 (QQQ and SPY). Extending the replay past 2021-12-31 needs my separate message.
>
> 4. PLANS
> For each stock and session with at least one newly eligible item about it (a filing for that company, or a news item tagged with that symbol and at most three symbols in all), the planner writes one plan record at the eligible time:
> - known facts, each with source IDs; open uncertainties; affected stock and why;
> - a bullish scenario with measurable activation; a bearish scenario with measurable activation and its long-only action (exit, reduce, avoid entry, hold cash); a no-trade condition;
> - entry, invalidation (also the sizing reference), exit, maximum holding period, expiry, and how contradictory later items are handled.
> Positive wording never maps automatically to a buy, nor negative wording to a sell.
>
> Deterministic planner (experimental assumptions): reference price R = the last trade before the item became eligible; typical move m = the mean absolute daily close-to-close change over the 20 changes ending the previous session. Bullish activation: a 5-minute close at or above R + 0.5 m within the first 30 minutes after eligibility. Bearish activation: a 5-minute close at or below R - 0.5 m in that window; the action is exit or avoid entry. Otherwise no trade. Invalidation: a daily close below R - 1.0 m, exited at the next session's first bar open. Exit: a time stop at the close of the 10th session after the fill. The plan expires at the end of the second session after eligibility. A later eligible item on the same stock with an opposite activation cancels a pending plan.
>
> Deterministic planner with content (configuration DC only): a fixed word list on headlines (event-swing's pre-registered guidance lists, extended only before any headline is read) classifies items as negative, positive or neutral; a negative item disarms the bullish scenario. Nothing else changes.
>
> AI planner (approach B): one call per stock per session, batching that session's eligible items (capped at 20, in time order), via the Anthropic API with one frozen model (claude-opus-5-5), a frozen prompt, settings, an output JSON schema and no tools or browsing. News text goes in fenced as untrusted data. The planner fills the same plan fields; activation thresholds come from a fixed menu (0.5, 1.0 or 1.5 m; holding up to 10 sessions) so its plans are measurable and comparable. Validation rejects a plan that cites no source ID for an event-specific claim, mentions a date after T, or names a later event; a rejected plan becomes no-trade and is logged. Cache every response by packet hash, so a replay re-runs from the cache with no new calls. The identity-masked variant replaces company names, tickers and dates with placeholders and shifts dates by a fixed offset. Every AI result is labelled "AI planner, possible model-memory contamination": these measures reduce, not remove, the model's knowledge of 2020 to 2021. Before any AI call, estimate the token count and cost for the full replay and stop for my spending cap.
>
> 5. ENTRY TREATMENTS (identical signals, portfolio rules and exits; only the entry differs)
> A. Immediate: fill at the open of the next 5-minute bar after activation.
> B. Price-only pullback: after activation, a bar trades at or below the prior completed session's close, then a later bar closes above that touching bar's high; fill at the next bar open. No setup if activation is not above the prior close.
> C. Volume-profile pullback: the same touch-and-recover rule at the prior completed session's value area high (bullish); no setup if activation is not above it.
> Setups expire at the end of the second session after activation. Every eligible signal is logged with its fate: filled, expired, no setup, rejected for funding or caps, cancelled. Missed moves are reported, not just fills.
>
> Volume profile (experimental assumptions, defined before any run): the prior completed regular session only (09:30 to 16:00 ET, no extended hours); bins of 0.1% of that session's close; each bar's volume spread evenly across the bins its high-low range covers (an approximation from bars, documented as not true volume-at-price); POC = the highest-volume bin, ties to the bin nearest that session's volume-weighted average price, then the lower price; value area = 70% of volume, built by the standard expansion from the POC adding the larger adjacent pair of bins first. High- and low-volume nodes are not used in round 1. Order-flow delta is not used and candle-direction volume is never labelled buying or selling. A developing profile is never used.
>
> 6. PORTFOLIO AND EXECUTION (copied from campaign 3 and checked for compatibility)
> $15,000 per configuration, long-only, whole shares, no leverage, one position per stock, no adding; planned risk at most 1% of account value per trade (shares x (fill - invalidation level)); position at most 20%; total planned entry risk at most 5%; same-time signals share cash and risk room equally; cash never negative. All limits are rechecked at the fill and the order is reduced, rejected or cancelled as campaign 3 does. Costs: calibrated half-spread with a 2 bps floor, 2 bps slippage, SEC and TAF fees on sells; dividends net of 15% withholding; splits applied to shares and levels. Never fill at a price from before the decision. Ambiguous intrabar ordering resolves against the trade (stop before target; a touch and a recovery are never in the same bar). Halts: no fill until the next printed bar. Sensitivity runs: costs doubled; execution delayed one extra bar and one extra session (reported, not counted as configurations).
>
> 7. FROZEN MATRIX (11 configurations; cap 12; up to 3 defect replacements, each recorded)
> 1 D-A, 2 D-B, 3 D-C: deterministic planner, entries A, B, C.
> 4 DC-A: deterministic planner with headline content, entry A.
> 5 AI-A, 6 AI-B, 7 AI-C: AI planner, entries A, B, C.
> 8 AIM-A: identity-masked AI planner, entry A.
> 9 P-A, 10 P-B, 11 P-C: price-only controls with the same activation rules applied at the first 30 minutes of every session with no eligible item for that stock in the three sessions before or after; entries A, B, C.
> Benchmarks (not configurations): equal-weight buy-and-hold of basket A over the same dates, and each run's exposure-matched hold.
> Comparisons fixed in advance: event versus price-only (1-3 vs 9-11); content versus content-blind (4 vs 1); AI versus deterministic (5-7 vs 1-3); masked versus unmasked AI (8 vs 5); immediate versus pullback (A vs B within each planner); volume profile versus price-only pullback (C vs B within each planner).
> Inference: an event-time placebo (each stock's eligible items moved to random sessions of that stock without items, keeping time of day), resampled with clustering by calendar date so same-day market moves count once; 10,000 resamples, seed fixed in CAMPAIGN-1.md; Holm over the six comparisons. With two years and ten stocks, report the event counts per stock and category before running; any comparison resting on fewer than 30 events is descriptive only. No candidate is declared without a passing pre-registered comparison, and none from this period is called proven profitable.
> Write strategy/news-replay/CAMPAIGN-1.md with all of this, the hypotheses, the exact rules and the execution budget (deterministic and price-only arms: 2 hours of execution; AI arms: within my spending cap), commit it, then freeze configurations, source revision, data manifests and hashes in an append-only EXPERIMENT-LOG.md before reading any outcome. Chronological reporting by year; no fitted model and no learning rule in round 1.
>
> 8. TESTS (synthetic data, before any historical run)
> Future-information exclusion at the packet loader; earlier decisions byte-identical when later data changes (prefix invariance); publication, eligibility and revision handling; profile construction and refusal of a developing or same-session profile; bullish, bearish, no-trade and conflicting-item plans; execution delay, overnight gaps and ambiguous intrabar paths resolved conservatively; shared cash, sizing, corporate actions and accounting identity; append-only records with the hash chain; replay reproducible from cached AI responses with zero new calls; AI validator rejections (no source ID, a future date, a later event). Add a planted-bug harness (npm run nr:planted) in which every listed bug is caught by a named test, as the other programmes have. Run the full suite and the existing harnesses before committing.
>
> 9. DASHBOARD AND REPORTS
> A Replay page (or a section of the Research page): the simulated time; the inputs available at it; the bullish, bearish and no-trade plans; which condition activated; the recorded action and reasoning; the next eligible simulated fill; and the outcomes, revealed in a separate panel. Reports per configuration: net profit after costs, total and annualised return, drawdown, exposure, time in cash, turnover, trades, holding periods, total costs, annual, per-stock and event-category results, exclusions for missing data, missed and expired opportunities, the cost and delay sensitivities, both benchmarks, and each pre-registered comparison with its placebo p-value raw and Holm-adjusted. Never rank on ending balance alone.
>
> 10. DELIVERY
> Commit in this order: inventory; campaign document; code and tests; run records and reports. Then report in plain English: the actual usable dates and event counts, unsupported inputs, the frozen matrix, test counts, run counts, results against benchmarks, whether news, AI planning or volume profile added anything against its matched control, any candidate's limits or an explicit no-candidate outcome, commit hashes, and one next step supported by the results.

## 2 | 2026-11-06 | **The owner's master work order, version 3** (verbatim in its operative parts for this programme; the whole message is in `AUTONOMY.md`)

> This order supersedes master work orders 1 and 2. Section 1 settles every conflict with earlier instructions. Simulation only: nothing places a real order or touches real money. No Anthropic API key and no API spending anywhere in this order.
>
> | news-replay work order | In force for its rules, data boundaries and matrix, with one change: its AI-planner configurations (5 AI-A, 6 AI-B, 7 AI-C, 8 AIM-A) are not run. Record them as "not run: no API spending authorised". If its CAMPAIGN-1.md is already committed, it stays frozen and those rows are marked not run, never edited out. |
>
> PHASE A, the first deliverable: one complete, working historical replay path, end to end: timestamped news -> bullish, bearish and no-trade plans -> measurable activation conditions -> simulated trades -> portfolio accounting -> visible results.
> - Use the smallest supported event set from permitted historical data (2020-01-02 to 2021-12-31): start with SEC 8-K earnings filings (exact acceptance times), and add Alpaca news headlines as the second category as soon as their inventory is done, without waiting on anything else.
> - Run news-replay's deterministic planner with immediate entry (D-A) and its price-only control (P-A). If intraday bars are not yet downloaded, run a daily-response version first, labelled as such, and add the intraday version when the bars are in.
> - Plans are saved before their activation, using only information available then. Record every plan's fate: bullish activated, bearish activated, neither activated before expiry, activated and then failed (invalidated or loss at exit), funding-rejected, expired.
> - Build no extended framework before this path works and shows results on the page.
> Phase A is done when the page shows real replay results for D-A and P-A, with the four questions of section 7 answered.

**Status at this entry:** CAMPAIGN-1.md was not yet written, so the AI rows are written into it from the start as "not run: no API spending authorised" and stay in the frozen matrix. The data was already downloaded (2026-11-06, 20:2x to 20:36 UTC): 1-minute bars, news, filings and FOMC statements, bounded at 2021-12-31; no outcome had been computed. The pre-run counts (signals only) were computed to check the inventory, and one counting defect was found and fixed before any run (activation directions were counted under the wrong keys).

## 3 | 2026-11-06 | **Results are visible; no frozen rule may be tuned on them** (master work order version 3, section 7; recorded before any run)

As the order requires, recorded before the first run: historical results appear on the Research page as each experiment finishes (Phase A: D-A and P-A first, then Phase B1), with the four plain-English answers, plan fates, missed and funding-rejected signals, and per-stock and per-category results. Performance is visible, and no rule frozen in `CAMPAIGN-1.md`, `matrix-v1.json`, `headline-words-v1.json` or `ai-planner-v1.json` may be tuned on it: a change prompted by a result is a new, recorded experiment (a new campaign document), never an edit. The AI configurations stay "not run: no API spending authorised".

Found and corrected before any run, while building the page (code not yet committed or frozen): the simulator wrote a signal record only when a fill was attempted, so a bullish activation whose entry had no setup, expired or was disarmed left no record, and the plan-fate table would have shown it as "no record". Every such signal is now recorded at the time its fate becomes known (no setup and disarmed at the activation bar, an expired pullback at the end of its setup window, a fill after the replay at the last close); a synthetic test checks each case and two planted bugs check the test. It changes records, not trades or P/L.

## 4 | 2026-11-06 | **Event counts** (before any run; signals counted, no outcome computed)

Replay 2020-01-02 to 2021-12-31 (504 sessions). Totals: 3090 entry plans and 5526 follow-up checks from 13982 news items (at most three symbols) and 341 filings; 204 news items possibly revised; 274 price-only control sessions; 21 FOMC statements (context for the AI planner only).

| Stock | First 1-min session | 1-min sessions | News (≤3 symbols) | News (>3, not used) | Possibly revised | Filings | Outside hours | Entry plans | Follow-ups | Bullish | Bearish | No activation | Negative-headline plans | Item-free sessions | Control sessions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MU | 2019-12-02 | 525 | 463 | 399 | 2 | 39 | 242 | 189 | 127 | 30 | 32 | 127 | 12 | 315 | 34 |
| AMZN | 2019-12-02 | 525 | 2643 | 2128 | 27 | 29 | 1237 | 492 | 1204 | 113 | 89 | 290 | 66 | 12 | 0 |
| META | 2019-12-02 | 525 | 1907 | 1512 | 24 | 24 | 820 | 450 | 873 | 105 | 72 | 273 | 61 | 54 | 0 |
| TSLA | 2019-12-02 | 525 | 5554 | 2853 | 124 | 47 | 3153 | 501 | 2182 | 107 | 104 | 290 | 167 | 3 | 0 |
| VST | 2019-12-02 | 525 | 62 | 41 | 0 | 33 | 68 | 64 | 5 | 16 | 14 | 34 | 7 | 440 | 192 |
| GOOG | 2019-12-02 | 525 | 1095 | 1421 | 9 | 32 | 570 | 397 | 394 | 82 | 68 | 247 | 48 | 107 | 0 |
| INTC | 2019-12-02 | 525 | 710 | 612 | 9 | 43 | 359 | 290 | 232 | 47 | 45 | 198 | 18 | 214 | 2 |
| CSCO | 2019-12-02 | 525 | 286 | 300 | 0 | 39 | 165 | 172 | 64 | 29 | 19 | 124 | 14 | 332 | 32 |
| PYPL | 2019-12-02 | 525 | 590 | 553 | 4 | 29 | 297 | 262 | 194 | 40 | 47 | 175 | 13 | 242 | 7 |
| SNAP | 2019-12-02 | 525 | 672 | 489 | 5 | 26 | 268 | 273 | 251 | 59 | 51 | 163 | 15 | 231 | 7 |

| Comparison | Events | Status |
|---|---|---|
| C1 | 274 | tested |
| C2 | 421 | tested |
| C3 | — | pending (AI arms not run) |
| C4 | — | pending (AI arms not run) |
| C5 | 628 | tested |
| C6 | 628 | tested |

## 5 | 2026-11-06 | **Frozen for campaign 1**

code revision: `nr-code-2026-11-06-1`; engine `nr-engine-1`; campaign commit: `fafd8a0dd5d4f598fed0afd6b4b2973c8e31b76b`; HEAD `535924eee314be11ce2a622797af0baf451c4355`; data manifest hash: `062021bcd0cf7c8daac8d56faf6032e78086fe3417f3f7becde1aa780b293907`; daily inputs hash `9b15a6341f19696d889df764b9c4e37e98788ee37a3338e9a53466e63ddc0671`; calibration hash `9d13892685912d5c1eecc7afef0afcebd844cc7b73a8d38ea79a7b363d777fdc` (samples on or before 2021-12-31). Configurations and settings: matrix-v1.json, headline-words-v1.json, ai-planner-v1.json and CAMPAIGN-1.md as pinned. Implementation ends here.

## 6 | 2026-11-06 | **Run** run id: 1, config: D-A, config hash: 322451db6ed9573d81d592e7b8f31242c3e1f1bafcc1a8a3d197e7a0467bd06a, status: done; variant: base

net 3472.16 US$; T -10257.78; completed trades 401; exploratory (a heavily used development period).

## 7 | 2026-11-06 | **Run** run id: 2, config: D-A, config hash: 2b7fecca926aabda928d62ea6574bd7f69b2d99d88931f5e2c268b233c8c186d, status: done; variant: costs_x2

net 2173.44 US$; T -11262.99; completed trades 391; exploratory (a heavily used development period).

## 8 | 2026-11-06 | **Run** run id: 3, config: D-A, config hash: 8c55aef6ee2aad752f0c9f74f84c8fdeb397aaf080ff2f78c17722d8c1b1ae46, status: done; variant: delay_bar

net 3708.74 US$; T -9560.12; completed trades 406; exploratory (a heavily used development period).

## 9 | 2026-11-06 | **Run** run id: 4, config: D-A, config hash: e105caecb012a42935323afc16ed4d16f2976e0ee7760ead99baeef488491e84, status: done; variant: delay_session

net 1717.84 US$; T -8498.53; completed trades 299; exploratory (a heavily used development period).

## 10 | 2026-11-06 | **Run** run id: 5, config: P-A, config hash: b929a335ff34ee4e5711366aaec244c6526f31a03e25294d19471a6479c11e00, status: done; variant: base

net -191.97 US$; T -1931.05; completed trades 41; exploratory (a heavily used development period).

## 11 | 2026-11-06 | **Run** run id: 6, config: P-A, config hash: 726c5ab544ed5315b78f6a4e8c339466606c0ff738f67da24fe5bf2d0cb0ca8d, status: done; variant: costs_x2

net -504.93 US$; T -2239.26; completed trades 41; exploratory (a heavily used development period).

## 12 | 2026-11-06 | **Run** run id: 7, config: P-A, config hash: 595d849088c5591786dbf73dd81d550f0d00c445e1dd20f89d63efcc2571e489, status: done; variant: delay_bar

net 311.93 US$; T -1550.41; completed trades 41; exploratory (a heavily used development period).

## 13 | 2026-11-06 | **Run** run id: 8, config: P-A, config hash: cddaf72ea08b0f403adf8836ed2bf8b44618c57a5b3a8363310fe4aca3e5478a, status: done; variant: delay_session

net -46.29 US$; T -1209.52; completed trades 34; exploratory (a heavily used development period).

## 14 | 2026-11-06 | **Phase A complete (D-A and P-A); CAMPAIGN-2.md committed before any outcome existed** (master work order version 3, Phases A and B2)

**Chronology (measured from git and the database):** `CAMPAIGN-2.md` and `matrix-2.json` (the AMT exits, Phase B2) were committed as 983b5e8c020505df38f42a03b458930c65f67bcc at 2026-11-06T21:32:16Z. The plans were saved before any run: planner D 8,616 rows (21:30:38Z to 21:31:17Z), DC 8,616 (21:31:22Z to 21:34:26Z), P 274 (21:34:32Z), each hash-chained with its packet hash. Run 1 (D-A base) started at 21:34:32.631Z, 2 minutes 16 seconds after the campaign 2 commit; runs 1 to 8 finished by 21:34:44.431Z (entries 6 to 13). So campaign 2's rules were fixed before any news-replay outcome existed, and no run of entry C (campaign 2's X1) exists yet.

**Phase A results (simulated development results on a heavily used period, not validated; every figure measured from the simulation except the two benchmarks, which are derived):**
- **D-A** (news plans, immediate entry): net +US$3,472.16 after US$1,530.08 of modelled costs; 401 completed trades and 3 open at the end; T = −US$10,257.78 (its exposure-matched hold made +US$13,729.94); the equal-weight hold of basket A made +US$26,358.92; maximum drawdown 17.77%; on average 49.28% invested; TSLA 44.5% of the gross gain; accounting reconciles. Sensitivities: T −US$11,262.99 (costs doubled), −US$9,560.12 (one bar later), −US$8,498.53 (one session later). Plan fates of the 3,090 entry plans: neither activated 1,921; bearish activated 541; bullish activated then a gain 173, a loss at exit 147, invalidated 81, open at the end 3; already held 192; funding or caps rejected 32. By category: news 2,826 plans, 354 trades, +US$3,826.10; earnings 8-Ks 91 plans, 22 trades, −US$166.84; other filings 173 plans, 28 trades, −US$187.11.
- **P-A** (the price-only control, sessions without items): net −US$191.97 after US$304.60 of costs; 41 completed trades and 1 open; T = −US$1,931.05; maximum drawdown 12.96%; on average 8.45% invested; MU 91.4% of the gross gain; accounting reconciles.
- **Plain reading:** D-A made money; it did not beat its exposure-matched hold, the equal-weight hold or (on T) its price-only control, and it does not qualify (drawdown above 15%, TSLA above 40%, T below zero in every variant; the placebo has not run). The placebo runs after Phase B1. Results are visible on the Research page; no frozen rule is tuned on them (entry 3).
