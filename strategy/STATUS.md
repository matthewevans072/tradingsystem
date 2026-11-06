# Status (plain English)

Updated 2026-11-06 by the assistant, as master work order version 3 section 8 asks (after each phase milestone, campaign or worker problem). Every result below is a **simulated development result on prices other programmes have already examined, not validated**. A working system and a profitable strategy are separate milestones; nothing here claims the second. `AUTONOMY.md` holds the owner's standing rules and the precedence table.

## What works now

- **news-replay** (Phase A of the order): the whole historical replay path is built and tested on synthetic data: timestamped news, filings and FOMC statements → bullish, bearish and no-trade plans saved before activation → activation checks on 5-minute bars → simulated trades with costs and campaign 3's limits → accounting → results, four plain-English answers and a plan inspector on the Research page. The data for 2019-12-02 to 2021-12-31 is downloaded (measured: 526 sessions of 1-minute bars per stock, 20,519 news items, 341 filings of which 92 are earnings 8-Ks, 21 FOMC statements). Tests: 14 of 14 news-replay tests pass; the planted-bug check catches 27 of 27 bugs. The runs on real data are next (below).
- **event-swing** campaign 1 finished on 2026-11-06 (48 runs, none failed): outcome NONE.
- **Prospective journal 1** is active (start 2026-11-06); you update it by hand after the close (`npm run pj:update`). Its display rule changed by the order (research-runner log entry 13): running results may be shown, but its pinned code still hides them until a separate read-only view is built.
- **Nothing runs on its own.** No worker, no Task Scheduler entry, no CNBC reading exists yet (Phase C).

## Finished experiments: the four answers

### event-swing campaign 1 (earnings events, 2016-01-04 to 2021-12-31, US$15,000 per configuration)

1. **Did it make money after costs?** Mostly yes, in simulation: 14 of 16 configurations ended above US$15,000 (for example A1 +US$36,774.81, D0 +US$7,408.12, B1 +US$2,255.39). B2 lost US$474.82 and B3 made no trade. None qualifies as a development candidate; both are true.
2. **Did it beat its matched controls and holding?** No configuration beat the equal-weight buy-and-hold of the ten stocks (+US$68,099.09 over the six years). Against the exposure-matched hold (the same stocks, scaled to how much each run had invested) the price-only rule D0 was ahead by US$5,425.78, and the variants that pause it around earnings news did not improve on it (D1 +US$5,289.72, D2 +US$5,014.21, D3 +US$3,102.77). The guidance-word variants did worse than the calendar-only versions (B2 −US$484.31 vs B1 +US$965.50; C2 +US$40.82 vs C1 +US$196.13). Selling before estimated announcements (A1, A2) was behind its exposure-matched hold by US$8,930.42 and US$8,168.76. The news information added nothing measurable.
3. **How much risk and exposure?** Leaving out B3 (no trade): maximum drawdown from 0.95% (C2, almost always in cash) to 34.28% (A0, the hold); average invested from 1.27% (C2) to 93.44% (A0); modelled costs from US$9.88 (A0) to US$1,837.20 (D0, 405 trades).
4. **How strong is the evidence?** Weak. The placebo test gave p = 0.9735 (A1) and 0.9175 (A2), far from significance. For families B to D it could not be drawn at all (TSLA's 48 events leave no placement under the pre-registered 30-session rule), so their p = 1.0000 is a fallback, not a measurement (log entry 55). Four configurations rest on fewer than 20 events and are descriptive only. Nothing is significant after Holm, and 2016 to 2021 is the most examined period of the whole project.

### news-replay campaign 1

Not run yet; see "What's next".

## Worker and reading-session health

No worker and no reading session exist yet. Nothing is scheduled.

## What's next

1. news-replay: commit the code, record the event counts and the freeze, then run Phase A (D-A and P-A), then Phase B1 (D-B, P-B, D-C, P-C, DC-A) and the placebo; results appear on the Research page as each finishes.
2. Phase B2: write and commit `strategy/news-replay/CAMPAIGN-2.md` (AMT exits X1 to X4) before any outcome, then run it.
3. Phase C: the worker, Task Scheduler entries and the forward account.

## What I need from you

- **For Phase C2 only:** your confirmation that CNBC's terms permit automated reading for your personal use. Nothing else is needed now.
- **Optional:** whether you want an event-swing campaign 2 with a placebo that can be drawn (a new campaign document; nothing changes otherwise).
