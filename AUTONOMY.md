# AUTONOMY.md: what the assistant may do on its own, and what must stay running

This file records the owner's standing rules for autonomous work on the research programmes, from **master work order version 3** (received 2026-11-06; the whole message is quoted verbatim at the end). A markdown file keeps nothing running: anything that runs on its own does so only because a program (a worker process or a Windows Task Scheduler entry) was started, and each one is listed under "What is running" below with how to check it.

Simulation only. Nothing here places a real order, touches real money, or connects to a broker. No Anthropic API key and no API spending.

## 1. Precedence (where instructions conflict, this table wins)

From section 1 of the order, verbatim:

| Earlier instruction | Status now |
|---|---|
| Master work orders 1 and 2 | Superseded by this order. |
| news-replay work order | In force for its rules, data boundaries and matrix, with one change: its AI-planner configurations (5 AI-A, 6 AI-B, 7 AI-C, 8 AIM-A) are not run. Record them as "not run: no API spending authorised". If its CAMPAIGN-1.md is already committed, it stays frozen and those rows are marked not run, never edited out. |
| "Ask me for the AI planner's spending cap" | Withdrawn. No API spending. |
| "No scheduled jobs" | Replaced by the worker and scheduling rules in section 5. |
| "No review cycles" and "run every test and harness before each report" | Replaced by the testing rules in section 6. |
| Hidden aggregate performance (news-desk draft; prospective journal 1's display rule) | Replaced by section 7: running simulated results are visible, labelled, and never used to tune a frozen rule. For prospective journal 1, record this in its log as a display change only; its trading rules, review date and sample rule are untouched. |
| event-swing | In force. SEC_CONTACT_EMAIL is in .env (never copy it into a committed file). Run its prepared commands once as a background job, without new building. It must not delay Phase A. |
| Earlier programmes (HXR, range-trend, sweep-bos, ICT Lab, Strategy Lab, research runner, prospective journal 1) | Preserved as they are, with all frozen documents and results. |
| All closed evaluation, reserve and holdout windows | Still closed. Nothing in this order opens them. |

How each ruling has been applied (records, not new rules):
- news-replay: `CAMPAIGN-1.md` was committed after the order arrived (fafd8a0) with the AI rows marked "not run: no API spending authorised" in `matrix-v1.json`; the code refuses to show or run them.
- Prospective journal 1: the display change is research-runner log entry 13. Its pinned code is unchanged (`pj:status` still hides performance; a separate read-only view is a later step).
- event-swing: its prepared commands ran once in the background (inventory, freeze, campaign 1). Campaign 1 finished: NONE. Its log entry 55 records that the frozen event placebo could not be drawn for families B to D.
- Closed windows: unchanged. No code path in news-replay reads after 2021-12-31.

## 2. What the assistant does without asking

Within an approved campaign: build, test, run, diagnose failures and finish without asking between configurations. A strategy change prompted by results is a new, recorded experiment; an active or completed experiment is never modified. Independent work continues while a question to the owner is open. Commit and push code, documents, tests and permitted result summaries to `hxr`.

Testing (section 6): targeted tests on synthetic data for changed code; the full suite at the end of Phases A, B and C and before a historical campaign when relevant code changed; the affected planted-bug harness when its programme changes. No full-project review agents.

## 3. What the assistant asks the owner, once, in one message

Only for: an unresolved data permission, a new credential, opening a closed window, or widening scope (section 5). Also: any paid plan or subscription (section 4).

## 4. What is running, and what must stay running

| Item | State on 2026-11-06 | How to check |
|---|---|---|
| news-replay campaign 1 (historical) | started by the assistant from the command line; finishes on its own; nothing scheduled | `npm run nr:status` |
| event-swing campaign 1 | finished (NONE) | `npm run es:status` |
| Prospective journal 1 | no worker: the owner runs `npm run pj:update` by hand after the close | `npm run pj:status` |
| The persistent worker (section 5) | **not built yet** (Phase C) | — |
| Windows Task Scheduler entries | **none created yet** (authorised by section 5 for the worker and the C2 reading sessions; created in Phase C) | Task Scheduler, folder `\SignalDesk\` once created |
| C2 Claude-read CNBC sessions | **not enabled**: waits for the owner's confirmation that CNBC's terms permit automated reading for personal use | — |

The worker runs replays, campaign configurations, the forward accounts and their condition checks; it does not write code (that needs a Claude Code session) and does not read CNBC (that needs the scheduled Claude session). When Phase C is built, these must stay running for it to work: the PC on and awake, the worker started (at logon by Task Scheduler), and for C2 Chrome open with the Claude extension and CNBC logged in by the owner. A closed chat session or this file keeps nothing running. Every scheduled run records missed or failed sessions and never backfills.

## 5. The order, verbatim

Received 2026-11-06 during the news-replay build, quoted in full:

> MASTER WORK ORDER (version 3): a working replay first, AMT entries and exits, then Claude watching live news
>
> This order supersedes master work orders 1 and 2. Section 1 settles every conflict with earlier instructions. Simulation only: nothing places a real order or touches real money. No Anthropic API key and no API spending anywhere in this order.
>
> 1. PRECEDENCE (where instructions conflict, this table wins; write it into AUTONOMY.md)
> | Earlier instruction | Status now |
> |---|---|
> | Master work orders 1 and 2 | Superseded by this order. |
> | news-replay work order | In force for its rules, data boundaries and matrix, with one change: its AI-planner configurations (5 AI-A, 6 AI-B, 7 AI-C, 8 AIM-A) are not run. Record them as "not run: no API spending authorised". If its CAMPAIGN-1.md is already committed, it stays frozen and those rows are marked not run, never edited out. |
> | "Ask me for the AI planner's spending cap" | Withdrawn. No API spending. |
> | "No scheduled jobs" | Replaced by the worker and scheduling rules in section 5. |
> | "No review cycles" and "run every test and harness before each report" | Replaced by the testing rules in section 6. |
> | Hidden aggregate performance (news-desk draft; prospective journal 1's display rule) | Replaced by section 7: running simulated results are visible, labelled, and never used to tune a frozen rule. For prospective journal 1, record this in its log as a display change only; its trading rules, review date and sample rule are untouched. |
> | event-swing | In force. SEC_CONTACT_EMAIL is in .env (never copy it into a committed file). Run its prepared commands once as a background job, without new building. It must not delay Phase A. |
> | Earlier programmes (HXR, range-trend, sweep-bos, ICT Lab, Strategy Lab, research runner, prospective journal 1) | Preserved as they are, with all frozen documents and results. |
> | All closed evaluation, reserve and holdout windows | Still closed. Nothing in this order opens them. |
>
> 2. GOAL AND SCOPE
> Goal: a long-only US-stock swing system that watches the news, prepares bullish, bearish and no-trade responses, recognises which conditions actually occur, uses Auction Market Theory (volume profile) to time when to buy and when to sell, executes the matching simulated trade, and is measured honestly. It does not need to predict an event's outcome. It does need to show whether its responses make money after costs, and whether AMT timing helps.
> In scope: daily and event-driven swing trading on basket A; timestamped news, company filings and earnings events; volume-profile entries and exits; data from Alpaca, SEC EDGAR, and CNBC read by Claude through my browser. Out of scope until I say otherwise: options, futures, shorting, leverage, crypto, broker connections, real money, any paid API.
>
> 3. PHASING
> PHASE A, the first deliverable: one complete, working historical replay path, end to end:
> timestamped news -> bullish, bearish and no-trade plans -> measurable activation conditions -> simulated trades -> portfolio accounting -> visible results.
> - Use the smallest supported event set from permitted historical data (2020-01-02 to 2021-12-31): start with SEC 8-K earnings filings (exact acceptance times), and add Alpaca news headlines as the second category as soon as their inventory is done, without waiting on anything else.
> - Run news-replay's deterministic planner with immediate entry (D-A) and its price-only control (P-A). If intraday bars are not yet downloaded, run a daily-response version first, labelled as such, and add the intraday version when the bars are in.
> - Plans are saved before their activation, using only information available then. Record every plan's fate: bullish activated, bearish activated, neither activated before expiry, activated and then failed (invalidated or loss at exit), funding-rejected, expired.
> - Build no extended framework before this path works and shows results on the page.
> Phase A is done when the page shows real replay results for D-A and P-A, with the four questions of section 7 answered.
>
> PHASE B: AMT and the rest of the replay.
> B1. Run news-replay's remaining non-AI configurations: pullback entries D-B and P-B, and volume-profile entries D-C and P-C, with its AMT entry definitions unchanged.
> B2. AMT exits, as a new recorded experiment (strategy/news-replay/CAMPAIGN-2.md, written and committed before any outcome is read; never an edit to a frozen campaign). The entry signal is fixed: the volume-profile entries of D-C. Only the exit differs:
>   X1. Existing exits: invalidation level and the 10-session time stop (the control).
>   X2. AMT acceptance exit: exit when a 30-minute close is back inside the prior completed session's value area and below its point of control (acceptance back into value, read as a failed move), plus X1's invalidation and time stop.
>   X3. AMT target exit: take profit when price trades at a predefined volume-profile level above the entry (proposed: the prior completed session's value area high plus that value area's height; if entered above it, the highest-volume bin of the prior five sessions' composite profile above the entry, if one exists), plus X1's exits.
>   X4. Price-only matched exit: X2's rule with the value-area boundary replaced by a price-only level of similar role (proposed: the activation bar's low), so X2 versus X4 isolates what volume profile adds.
>   Every level, the 30-minute bar construction, touch and acceptance definitions, tie handling and intrabar ordering (against the trade when unknown) are fixed in CAMPAIGN-2.md before running, each labelled "experimental assumption (author-selected)". Use the same profile construction as the AMT entries (prior completed regular session, bins of 0.1% of its close, volume spread evenly across each bar's range as a documented approximation, 70% value area by standard expansion). Never use a developing or same-session profile. Order-flow delta is not used.
>   At most 4 configurations; all comparisons, the event-time placebo with date clustering, and Holm are defined in CAMPAIGN-2.md before running.
> B3. Then the bounded research queue: one campaign at a time, at most two a week, at most 24 configurations each; pause after four campaigns in a row with no candidate and send me one summary with one recommendation.
> If intraday data is unavailable for any AMT step, report exactly what is missing and deliver everything else.
>
> PHASE C: Claude watches live news, going forward. Starts only after Phase A is delivered.
> C1. Forward simulated account: the same tested pipeline (planner, AMT entries and exits as Phase B found best, or the control if AMT did not help), fed by live Alpaca news and SEC filings, updated by the worker after each close and at intervals during the session.
> C2. Claude watching the news: a scheduled Claude session on my Claude subscription (Claude Code or the Claude desktop app's scheduled task, whichever works on this PC; no Anthropic API key), using Claude in Chrome in my logged-in browser. I log in to CNBC myself; never ask for or store my password. Before enabling this, I will confirm that CNBC's terms permit automated reading for my personal use; if you find evidence otherwise, stop C2 and tell me. The session runs twice each trading day (after 09:45 and after 16:15 ET) and does only this:
>   - reads CNBC's market pages and any articles mentioning basket A stocks;
>   - for each relevant item, records the headline, link, shown publish time, read time and a short summary in Claude's own words (never article text, never screenshots of paid content, never anything committed);
>   - writes a plan in news-replay's plan schema (known facts with sources, uncertainties, bullish and bearish scenarios with measurable activation, a no-trade condition, entry, invalidation, exit, maximum holding, expiry), using only what it has read so far;
>   - saves the plan before the market can trigger it. The worker then watches the conditions and executes in a separate simulated account labelled "Claude-read news".
>   This forward reading has no hindsight problem, because the outcomes have not happened yet. Its plans are compared with the fixed-rule account and with holding.
>   A failed session (computer off, logged out, page changed, usage limit reached) is recorded as missed and never backfilled.
> A working system and a profitable strategy are separate milestones. Never present the first as the second.
>
> 4. DATA
> Alpaca (prices, intraday bars, news) through the existing key and server/hxr/source.js; SEC EDGAR with SEC_CONTACT_EMAIL; CNBC only through Claude in Chrome as in C2. No new price provider and no paid plan without my approval. Keep market data, databases, news archives, article text, secrets and my email out of git.
>
> 5. AUTONOMY, THE WORKER AND SCHEDULING
> - Build a persistent, resumable worker (Node, its own state in the programme's database) with start, pause, stop, status, logs and checkpoints. After a crash or restart it resumes from its last checkpoint without repeating or losing a recorded step.
> - The worker runs replays, campaign configurations, the forward accounts and their condition checks. It does not write code and does not read CNBC: building code needs a Claude Code session, and C2's reading needs the scheduled Claude session. State this plainly in START-HERE.md, together with what must stay running: my PC, powered on and not asleep, with the worker started and, for C2, Chrome open with the Claude extension and CNBC logged in. Never imply that markdown instructions or a closed chat session keep anything running.
> - I authorize Windows Task Scheduler entries that start the worker at logon and run its daily forward updates, and the C2 reading sessions. Each run records missed or failed sessions and never backfills them as on time.
> - Within an approved campaign, build, test, run, diagnose failures and finish without asking me between configurations. A strategy change prompted by results is a new, recorded experiment; never modify an active or completed experiment.
> - Ask me once, in one message, only for: an unresolved data permission, a new credential, opening a closed window, or widening scope. Continue all independent work meanwhile.
>
> 6. TESTING (proportionate)
> - During implementation: targeted tests on synthetic data for the code you are changing, covering no look-ahead, plan-before-activation, profile construction (no developing or same-session profile), AMT entry and exit rules exactly as written, intrabar ordering against the trade, accounting and determinism.
> - Full suite: at release checkpoints (end of Phases A, B and C), and before a historical campaign when relevant code changed since the last full run.
> - Planted-bug harnesses: run the affected one when its programme changes; add one for the replay pipeline in Phase A and extend it for AMT exits in Phase B.
> - No full-project review agents; no running every harness before routine status updates.
> - Never relax factual accuracy, timestamp restrictions or accounting to meet a deadline.
>
> 7. RESULTS (visible, and honestly labelled)
> - Historical results appear on the page as each experiment finishes. Forward accounts show running P/L, drawdown, exposure, costs and benchmarks every day, labelled "running simulated result, not validated". Record in the log that performance is visible and that no frozen rule may be tuned on it. Fixed review dates govern formal assessment only, not visibility.
> - Every report answers four questions separately, in plain English:
>   1. Did it make money after costs?
>   2. Did it beat its matched controls and holding (price-only control, equal-weight buy-and-hold of the same stocks, exposure-matched hold)? For AMT: did volume-profile entries beat price-only pullbacks, and did AMT exits beat the existing exits and the price-only exit?
>   3. How much risk and exposure did it take (drawdown, exposure, time in cash, turnover, costs)?
>   4. How strong is the evidence (sample size, the pre-registered test, repeated testing across the programme)?
> - A run with positive net profit made money, even if it fails qualification; say both plainly.
> - Also show plan fates, missed and funding-rejected signals, and per-stock and per-category results.
>
> 8. REPORTING
> After each phase milestone, campaign or worker problem, update strategy/STATUS.md in plain English: what works now, the four answers for each finished experiment, worker and reading-session health, what's next, and anything you need from me. Tell me in two sentences. If blocked, give the exact missing dependency and what already works.
>
> 9. GIT
> Commit and push code, documents, tests and permitted result summaries to hxr, following the project's existing workflow.
>
> Start with Phase A now.
