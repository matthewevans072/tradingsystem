# news-forward, protocol 1: a forward simulated account on live news (master work order version 3, Phase C1)

**Status:** written 2026-11-07, after news-replay's campaigns 1 and 2 (the pipeline comes from their result, `PIPELINE-1.json`). Simulation only: no broker, order, paper-trading or account code; nothing is sent anywhere. Every figure it produces is a **running simulated result, not validated**; no frozen rule is tuned on it (EXPERIMENT-LOG.md entry 1). Every numeric setting is an experimental assumption (author-selected).

## 1. What it is

One account, **fixed-rule**: news-replay's tested pipeline (planner D, its entry and exits as fixed in `PIPELINE-1.json`, campaign 3's portfolio limits and campaign 1's modelled costs) run forward on basket A from the **start session** (the first NYSE session after the activation date). C2's "Claude-read news" account is stopped (EXPERIMENT-LOG.md entry 2). It is a working system, not evidence of a profitable strategy; it starts with no validated rule, because news-replay found none.

## 2. Timing rules (the honest forward version of news-replay's information boundary)

- **Eligibility** as news-replay: an item is eligible 5 minutes after publication, at the next 5-minute bar close; outside hours, at the next session's first bar close.
- **A plan is recorded only when the worker runs**, with its recording time; it is built only from the rows stored by then (each row keeps its fetch time, so `npm run nf:verify` re-derives every plan's packet from exactly those rows and checks the hash chain).
- **A plan looks only at bars that close after it was recorded.** A plan recorded after its 30-minute activation window has passed is **late**: it is kept, counted and can never trade. Nothing is ever backfilled as on time.
- **The data feed is Alpaca's free plan, delayed 16 minutes.** A plan's reference price is therefore the last 5-minute close the feed had published when the plan was recorded (often the previous close early in the session), and the account models the fill at the next bar's open after the activating close, as the replay does. That fill is a modelled reaction: in real time, with this feed, the activating close is seen 16 minutes after it happened. The plan itself is fixed before the market could trigger it.
- **Daily values** use daily bars once final (20 minutes after the close); the running result is valued at the last session whose daily bars are all in.

## 3. Data (bounded)

Basket A's daily and 1-minute regular-session bars, news and corporate actions (splits and cash dividends; other types are reported, not handled) through `server/hxr/source.js` (Alpaca SIP, raw); the ten registrants' 8-K, 10-Q and 10-K filings through SEC EDGAR with the owner's `SEC_CONTACT_EMAIL` (never printed or stored). **Nothing dated before 2026-10-22** (the first session after every closed window) is requested, stored (CHECK constraints) or read; the typical move therefore needs 21 forward closes, so plans before about 2026-11-20 are "no trade" by the planner's own rule. Costs: campaign 1's frozen calibration (spread samples on or before 2021-12-31), stored at activation; no closed-window quote sample is read. Own database `data/news-forward.sqlite`, not in git.

## 4. Benchmarks and the running report

Daily: net after costs, T (net minus the exposure-matched hold), the equal-weight hold of basket A from the start session, the exposure-matched hold, maximum drawdown, average exposure, costs, trades, plan fates and late plans. Shown on the Research page and by `npm run nf:status`.

## 5. What it cannot say

A short forward sample on ten stocks says little; the 16-minute delay means the modelled fills are not achievable in real time with this feed; modelled costs from 2021; one news aggregator; filings polled every 15 minutes during the session. A loss or a gain here is a running simulated result, never a validation.

## 6. The worker and what must stay running

`npm run nf:start` starts the detached worker; `nf:pause`, `nf:resume` and `nf:stop` are requests it reads within a minute; `nf:status` shows its health. It updates every 5 minutes during the session (each 5-minute bar close plus 30 seconds), once after the session's bars are final, and every 15 minutes otherwise. Its checkpoint is the database: every update is recorded, a restart resumes from the stored rows, and only one worker runs at a time (a stale heartbeat, over 10 minutes old, can be taken over). It writes no code and reads no news site. Windows Task Scheduler (`npm run nf:tasks -- --create`, registered with PowerShell so there is no execution time limit) starts it at logon and, on weekdays from 07:00 local time, checks every 30 minutes for 16 hours that it is running. For any of this to work: the PC on and not asleep, the worker started; a markdown file or a closed chat session keeps nothing running.
