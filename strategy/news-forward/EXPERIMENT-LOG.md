# news-forward: experiment log

Append-only. Entries are numbered `## N | date | title`. Simulation only: no broker, order, paper-trading or account code. Every figure from the forward account is a **running simulated result, not validated**, and no frozen rule is tuned on it.

## 1 | 2026-11-07 | **The owner's order: master work order version 3, Phase C** (verbatim; the whole order is in `AUTONOMY.md`)

> PHASE C: Claude watches live news, going forward. Starts only after Phase A is delivered.
> C1. Forward simulated account: the same tested pipeline (planner, AMT entries and exits as Phase B found best, or the control if AMT did not help), fed by live Alpaca news and SEC filings, updated by the worker after each close and at intervals during the session.
> C2. Claude watching the news: a scheduled Claude session on my Claude subscription (Claude Code or the Claude desktop app's scheduled task, whichever works on this PC; no Anthropic API key), using Claude in Chrome in my logged-in browser. I log in to CNBC myself; never ask for or store my password. Before enabling this, I will confirm that CNBC's terms permit automated reading for my personal use; if you find evidence otherwise, stop C2 and tell me. [...]
> A working system and a profitable strategy are separate milestones. Never present the first as the second.

And from section 5: "I authorize Windows Task Scheduler entries that start the worker at logon and run its daily forward updates, and the C2 reading sessions. Each run records missed or failed sessions and never backfills them as on time." From section 7: "Forward accounts show running P/L, drawdown, exposure, costs and benchmarks every day, labelled \"running simulated result, not validated\". Record in the log that performance is visible and that no frozen rule may be tuned on it."

**Recorded as required:** the forward account's performance is visible on the Research page and in `npm run nf:status`, labelled "running simulated result, not validated"; no frozen rule (the pipeline in `PIPELINE-1.json`, news-replay's campaign documents and code) may be tuned on it. A change prompted by its results is a new, recorded experiment.

## 2 | 2026-11-07 | **C2 stopped: evidence that CNBC's terms forbid automated reading** (before anything was built for C2)

Checked on 2026-11-07 (UTC), before building any part of C2, as the order requires ("if you find evidence otherwise, stop C2 and tell me"):
- `https://www.cnbc.com/terms/` (CNBC's supplemental terms, updated 2026-04-28, published by Versant Media, LLC): "YOUR USE OF THE CNBC WEBSITES, EVENTS, PRODUCTS AND SERVICES ARE GOVERNED BY THE VERSANT TERMS OF SERVICE", linked to `https://versantmedia.com/terms/` (effective 2025-09-30), whose section 4.1 says "You may not attempt any of the actions set forth in this list of Prohibited Actions", linked to `https://www.versantmedia.com/terms/prohibited-actions`.
- That list, section 12 ("No Data Extraction"): "You may not use any software robots, spider, crawlers, or other data gathering or extraction tools, whether automated or manual, to access, acquire, copy, monitor, scrape or aggregate Content". Section 1 also restricts access to the technology Versant provides. The only exceptions are permission "expressly permitted by us in writing" or "agreed between Versant and you in writing"; there is no personal-use exception for automated tools.
- A scheduled Claude session that opens CNBC pages, reads them and records headlines, publish times and summaries is an automated data-gathering tool that accesses and monitors Content.

**Therefore C2 is stopped:** no "Claude-read news" account, no scheduled reading session, no Task Scheduler entry for it and no plan intake exist. C1 (the fixed-rule forward account on Alpaca news and SEC filings) is unaffected. C2 could resume only with Versant's written permission or a different, permitted source chosen by the owner. (The quotes were read with a page-reading tool, not a lawyer; this is evidence, not legal advice.)

## 3 | 2026-11-07 | **Activated; first updates; the worker started; Task Scheduler entries registered** (no plan and no result yet: the start session is 2026-11-09)

**Activation** (`npm run nf:activate -- --confirm`, 2026-11-07T05:04:32Z): start session **2026-11-09** (the first NYSE session after the activation's New York date, 2026-11-07); pipeline `PIPELINE-1.json` (D-A, the existing exits: the control, news-replay log entry 53); code revision nf-code-2026-11-07-1; HEAD da481a01cb4f688aafbbb29203b984abf053ce03; campaign 1's frozen spread calibration (samples on or before 2021-12-31) stored from `hxr-sim.sqlite`, opened read-only.

**The first update failed** (started 05:04:38Z, kept as update 1, status failed): news were requested from the start session's midnight, a time in the future, and Alpaca refused it (HTTP 400). Corrected before any plan existed (commit 8a1daa57e8542917a83e92eb620e12b7e8653c77, code revision nf-code-2026-11-07-2): news and filings are fetched from 2026-10-22 and never from a future start; the test's fake source now refuses a future start as Alpaca does, and the old code fails that test (checked by planting it back). **The second update** (manual, recorded 2026-11-07T05:07:20Z) stored, measured: 120 daily bars (10 stocks, 2026-10-22 to 2026-11-06), 46,797 one-minute regular-session bars (same dates), 1,149 news items (created 2026-10-22T04:04:38Z to 2026-11-07T04:36:33Z), 18 filings and 3 corporate actions; nothing dated before 2026-10-22; no plan (no session since the start); `npm run nf:verify`: chain OK, no packet mismatch.

**The worker** (`npm run nf:start`, 2026-11-07T05:08:40Z): pid 3884, alive and heartbeating. **Task Scheduler** (folder `\SignalDesk\`, registered with PowerShell by `npm run nf:tasks -- --create`): `NewsForwardWorker` at logon and `NewsForwardDaily` on weekdays from 07:00 local, repeated every 30 minutes for 16 hours, both running `worker --ensure` (it exits at once when a live worker exists), no execution time limit, one instance at a time, a missed start run when the PC is next on; next daily run 2026-11-09 07:00 local (08:00 New York). A first attempt with schtasks was refused for the logon task (access denied) and would have kept Windows' default 3-day limit, which would stop a worker the task started; both were therefore registered with PowerShell instead.

**What must stay true:** the PC on and not asleep during the session, the worker running. Results are a running simulated result, not validated, and are shown on the Research page; no frozen rule is tuned on them.
