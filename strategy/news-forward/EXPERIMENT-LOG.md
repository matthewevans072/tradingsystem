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
