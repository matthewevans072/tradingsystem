# Status (plain English)

Updated 2026-11-09 by the assistant, as master work order version 3 section 8 asks (after each phase milestone, campaign or worker problem). Every historical result below is a **simulated development result on prices other programmes have already examined, not validated**; the forward account's figures are a **running simulated result, not validated**. A working system and a profitable strategy are separate milestones; nothing here claims the second. `AUTONOMY.md` holds the owner's standing rules and the precedence table.

## What works now

- **Phase A, done:** the historical news replay works end to end on real data (2020 to 2021): timestamped news and filings → bullish, bearish and no-trade plans saved before activation → activation checks → simulated trades with costs → accounting (reconciles) → results, four plain-English answers and a plan inspector on the Research page.
- **Phase B1, done:** every non-AI configuration of news-replay campaign 1 ran, with the pre-registered placebo test. Outcome NONE.
- **Phase B2, done:** campaign 2 (the AMT exits) was committed before any outcome existed and ran; its control reproduced campaign 1 to the cent. Outcome NONE.
- **Phase C1, running:** the forward account (news-forward), its worker and the Task Scheduler entries (see "Worker health").
- **Phase C2, stopped:** CNBC's publisher's terms forbid automated data-gathering tools (below).
- **event-swing** campaign 1: NONE (2026-11-06).
- **prop-sim, Phase 1 done (2026-11-09):** ICT structure strategies in a simulated funded-account evaluation (simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid), on stand-in data (QQQ and SPY as NQ and ES, regular hours only, not futures). Outcome NONE. Phase 2 (the live simulated account) is next.
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

### prop-sim campaign 1: ICT strategies in a simulated LucidFlex 50K evaluation (2018-06-01 to 2022-12-30; stand-in, regular hours only, not futures)

Simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid. One evaluation attempt started on each of 1,096 sessions for each strategy; each was compared with 1,000 sets of random entries using the same number of trades, stops, sizes and rules.

1. **How often did it pass, and did it make money after fees?** Rarely, and no. The plain level break on NQ passed most often (9.9% of attempts; 4.5% reached a first payout); the ICT setups passed 0% to 2.6%. Every strategy lost money per attempt after the assumed US$175 fee (the best, the NQ level break, about -US$140; before the fee it averaged US$34.89). The sweep-then-shift setup traded too rarely to judge (46 and 36 trades).
2. **Did it beat random entries and the plain level break?** No. None beat its random entries by more than chance (p from 0.14 to 1.00; 1.00 after Holm for all). On NQ the ICT setups passed less often than the plain level break; on ES the order-block setup passed 2.6% against the level break's 5.0%. Passing sometimes but no more often than random is no edge.
3. **How much risk did it take?** Losing attempts used nearly all of the US$2,000 drawdown room (a median 80% to 99% for the tested strategies), with losing streaks of up to 28 trades. No attempt failed on the drawdown itself: the frozen sizing rule shrinks positions as the room shrinks, so losing accounts stalled near the limit and ran out of time instead. LucidPro's daily loss limit stopped trading on up to 114 attempt-days.
4. **How strong is the evidence?** Against an edge, fairly clear on this data: about 250 to 1,800 trades per tested strategy, the pre-registered random comparison resampled by month, and Holm over eight. But the bars are ETF stand-ins (no overnight session, no futures roll), the period was already examined by sweep-bos and the ICT Lab, and one defect was found and corrected after the first run (the corrected run gave the same outcome; log entry 13).

### event-swing campaign 1 (earnings events, 2016-01-04 to 2021-12-31)

1. **Money:** 14 of 16 configurations made money in simulation (A1 +US$36,774.81, D0 +US$7,408.12); none qualifies. 2. **Controls and holding:** none beat holding the ten stocks (+US$68,099.09); the news-based variants did not improve on the price-only rule D0. 3. **Risk:** drawdowns from 0.95% to 34.28%. 4. **Evidence:** weak; the placebo could not be drawn for families B to D (log entry 55); nothing significant after Holm.

## Phase C2 stopped (your input needed only if you want it back)

CNBC's terms are Versant Media's. Their Prohibited Actions, section 12 "No Data Extraction", say: "You may not use any software robots, spider, crawlers, or other data gathering or extraction tools, whether automated or manual, to access, acquire, copy, monitor, scrape or aggregate Content." The only exceptions are written permission from Versant. A scheduled Claude session reading CNBC is such a tool, so, as your order says, C2 is stopped and nothing was built for it (`strategy/news-forward/EXPERIMENT-LOG.md` entry 2). It could come back only with Versant's written permission or a different, permitted source you choose.

## Worker health

- **The forward account (Phase C1)** was activated on 2026-11-07; it starts making plans from **Monday 2026-11-09**. Its rules are the control (Phase A's immediate entry with the existing exits), because Phase B found nothing better that qualifies.
- **The worker is running** (started 2026-11-07T05:08Z, pid 3884) and checks in every minute. Windows Task Scheduler starts it at logon and, on weekdays from 07:00 your time, makes sure every 30 minutes that it is running.
- **First update:** it failed once (it asked Alpaca for news from a future time); fixed before any plan existed, then the update stored the data from 2026-10-22 on. No result yet: the first plans come on 2026-11-09, and the rules need 21 earlier closes, so the first weeks are mostly "no trade".
- **What must stay true:** your PC on and not asleep during market hours. A session missed while it is off is recorded as late and never filled in.

## What's next

1. Phase C1 runs on its own from Monday 2026-11-09; its running result appears on the Research page.
2. prop-sim Phase 2: the live simulated funded account on Alpaca's free real-time IEX feed (QQQ and SPY), with a worker and a dashboard; it runs the frozen strategy without changing it.
3. Phase B3 (the research queue): any new campaign needs its own pre-registered document; at most two a week, 24 configurations each; pause after four in a row with no candidate. The obvious next question, a price-only "leave sooner" exit on the immediate entry, would be a new recorded experiment, not a change to the forward account.

## What I need from you

One question (prop-sim, asked once as the order says): **real CME futures data (Option A)**. Databento's published pay-as-you-go pricing puts 1-minute NQ, ES, MNQ and MES bars for 2018-06-01 to 2022-12-30 (MNQ and MES from 2019-05-06), all hours, at an estimated US$0.20 to US$4, inside the US$125 free credit a new account gets. The exact figure needs Databento's cost tool, which needs an account and an API key in `.env` (a new credential). If you want it: create the account, put the key in `.env` as `DATABENTO_API_KEY`, and say yes; I then quote the exact cost before buying anything. **Live CME data for Phase 2 (option a)** would be US$199 a month (Databento Standard); Phase 2 is being built on the free option (b) unless you say otherwise.

Optional: whether you want C2 pursued another way, and whether you want an event-swing campaign 2 with a placebo that can be drawn.
