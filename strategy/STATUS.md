# Status (plain English)

Updated 2026-11-07 by the assistant, as master work order version 3 section 8 asks (after each phase milestone, campaign or worker problem). Every historical result below is a **simulated development result on prices other programmes have already examined, not validated**; the forward account's figures are a **running simulated result, not validated**. A working system and a profitable strategy are separate milestones; nothing here claims the second. `AUTONOMY.md` holds the owner's standing rules and the precedence table.

## What works now

- **Phase A, done:** the historical news replay works end to end on real data (2020 to 2021): timestamped news and filings → bullish, bearish and no-trade plans saved before activation → activation checks → simulated trades with costs → accounting (reconciles) → results, four plain-English answers and a plan inspector on the Research page.
- **Phase B1, done:** every non-AI configuration of news-replay campaign 1 ran, with the pre-registered placebo test. Outcome NONE.
- **Phase B2, done:** campaign 2 (the AMT exits) was committed before any outcome existed and ran; its control reproduced campaign 1 to the cent. Outcome NONE.
- **Phase C1, built:** the forward account (news-forward) and its worker; see "Worker health" for whether it is running.
- **Phase C2, stopped:** CNBC's publisher's terms forbid automated data-gathering tools (below).
- **event-swing** campaign 1: NONE (2026-11-06).
- **Tests:** news-replay 17 of 17, news-forward 4 of 4; the news-replay planted-bug check catches 37 of 37 bugs.

## Finished experiments: the four answers

### news-replay campaign 1 (2020-01-02 to 2021-12-31, US$15,000 per configuration)

Seven configurations: news plans with immediate entry (D-A), price-only pullback entry (D-B), volume-profile pullback entry (D-C), the headline-word version (DC-A), and the same three entries on quiet sessions (P-A, P-B, P-C).

1. **Did it make money after costs?** D-A yes (+US$3,472.16), DC-A yes (+US$3,079.15), P-B yes (+US$920.55), P-C yes (+US$213.57); D-B no (−US$762.14), D-C no (−US$1,661.94), P-A no (−US$191.97). None qualifies; for the ones that made money, both are true.
2. **Did it beat its matched controls and holding?** No. Holding the ten stocks made +US$26,358.92. Measured against each run's exposure-matched hold (T), every configuration is negative (D-A −US$10,257.78). The news plans did worse than the same rules on randomly moved quiet sessions in every one of 10,000 placebo resamples (C1). The volume-profile entry did not beat the price-only pullback (D-C −US$899.80 behind D-B in net; C6 p 0.98). The headline-word rule helped slightly (DC-A +US$636.06 on T against D-A; p 0.22).
3. **How much risk and exposure?** D-A: drawdown 17.77%, 49% invested on average, about 70 times its account traded a year. The pullback entries traded far less (D-B, D-C about 19% invested, drawdown about 16%).
4. **How strong is the evidence?** Against: no comparison is significant after Holm (C1 p 1.00, C2 0.22, C5 0.97, C6 0.98). Many trades for the news configurations (140 to 401; the quiet-session controls only 21 to 41), but the period is the most examined in the project and seven configurations were tried.

### news-replay campaign 2: AMT exits (the D-C entry, four exits)

1. **Did it make money after costs?** Only the target exit X3 (+US$403.01). The existing exits X1 lost US$1,661.94, the acceptance exit X2 US$1,154.83, the price-only exit X4 US$1,167.09. X3 does not qualify.
2. **Did it beat its matched controls and holding?** The AMT exits beat the existing exits clearly: by US$4,303.60 (X2) and US$4,366.59 (X3) on T, more than in any of 10,000 placebo resamples (Holm-significant). But the price-only exit X4 did as well as the AMT acceptance exit (E3, p 0.56): the gain comes from leaving sooner, not from the volume profile. No exit beat holding the stocks or its exposure-matched hold.
3. **How much risk and exposure?** The faster exits cut drawdown from 15.88% (X1) to 5.16% to 8.21%, and average exposure from 19.12% to between 3.51% and 8.92% invested.
4. **How strong is the evidence?** Strong that leaving sooner beat the existing exits on these news sessions (p 0.0003 after Holm); none that the volume profile adds anything (p 0.56); still a development result on a heavily used period, and every exit lost against its exposure-matched hold.

### event-swing campaign 1 (earnings events, 2016-01-04 to 2021-12-31)

1. **Money:** 14 of 16 configurations made money in simulation (A1 +US$36,774.81, D0 +US$7,408.12); none qualifies. 2. **Controls and holding:** none beat holding the ten stocks (+US$68,099.09); the news-based variants did not improve on the price-only rule D0. 3. **Risk:** drawdowns from 0.95% to 34.28%. 4. **Evidence:** weak; the placebo could not be drawn for families B to D (log entry 55); nothing significant after Holm.

## Phase C2 stopped (your input needed only if you want it back)

CNBC's terms are Versant Media's. Their Prohibited Actions, section 12 "No Data Extraction", say: "You may not use any software robots, spider, crawlers, or other data gathering or extraction tools, whether automated or manual, to access, acquire, copy, monitor, scrape or aggregate Content." The only exceptions are written permission from Versant. A scheduled Claude session reading CNBC is such a tool, so, as your order says, C2 is stopped and nothing was built for it (`strategy/news-forward/EXPERIMENT-LOG.md` entry 2). It could come back only with Versant's written permission or a different, permitted source you choose.

## Worker health

See the next update of this file after activation.

## What's next

1. Phase C1: activate the forward account, run its first update, start the worker and create the Task Scheduler entries.
2. Phase B3 (the research queue): any new campaign needs its own pre-registered document; at most two a week, 24 configurations each; pause after four in a row with no candidate. The obvious next question, a price-only "leave sooner" exit on the immediate entry, would be a new recorded experiment, not a change to the forward account.

## What I need from you

Nothing required. Optional: whether you want C2 pursued another way, and whether you want an event-swing campaign 2 with a placebo that can be drawn.
