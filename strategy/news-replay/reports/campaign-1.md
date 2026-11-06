# news-replay campaign 1: results (exploratory: 2020-01-02 to 2021-12-31 is a heavily used development period; simulation only)

Code revision `nr-code-2026-11-06-1`, engine `nr-engine-1`. Every figure is measured from the simulation; the equal-weight buy-and-hold of basket A and each run's exposure-matched hold are derived benchmarks. T = net profit minus the run's exposure-matched hold. Nothing here is evidence of future profit, and no result from this period is called proven profitable.

## Configurations against the benchmarks (base case)

| Config | Net US$ | Ann. % | Max DD % | Invested % | Trades | Costs | Index net | Exposure-matched net | T | T, costs x2 | T, +1 bar | T, +1 session |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D-A | 3472.16 | 11 | 17.77 | 49.28 | 401 | 1530.08 | 26358.92 | 13729.94 | -10257.78 | -11262.99 | -9560.12 | -8498.53 |
| D-B | not run yet | | | | | | | | | | | |
| D-C | not run yet | | | | | | | | | | | |
| DC-A | not run yet | | | | | | | | | | | |
| AI-A | not run: no API spending authorised | | | | | | | | | | | |
| AI-B | not run: no API spending authorised | | | | | | | | | | | |
| AI-C | not run: no API spending authorised | | | | | | | | | | | |
| AIM-A | not run: no API spending authorised | | | | | | | | | | | |
| P-A | -191.97 | -0.64 | 12.96 | 8.45 | 41 | 304.6 | 26358.92 | 1739.09 | -1931.05 | -2239.26 | -1550.41 | -1209.52 |
| P-B | not run yet | | | | | | | | | | | |
| P-C | not run yet | | | | | | | | | | | |

## Pre-registered comparisons (placebo p raw and Holm-adjusted over six)

| Comparison | Statistic (sum of T differences) | Raw p | Holm p | Status |
|---|---|---|---|---|
| C1 event versus price-only | — | — | — | pending: the placebo has not run yet |
| C2 content versus content-blind | — | — | — | pending: the placebo has not run yet |
| C3 AI versus deterministic | — | — | — | not run: no API spending authorised |
| C4 masked versus unmasked AI | — | — | — | not run: no API spending authorised |
| C5 immediate versus pullback | — | — | — | pending: the placebo has not run yet |
| C6 volume profile versus price-only pullback | — | — | — | pending: the placebo has not run yet |

**Outcome:** not decided yet: some runs or the placebo have not finished.

## Per configuration

### D-A

**Did it make money after costs?** Yes. D-A made US$3,472.16 after US$1,530.08 of modelled costs on US$15,000.00 (23.15% in total, 11.00% a year), with 401 completed trades and 3 position(s) open at the end, valued at the last close. Qualification (CAMPAIGN-1.md section 10): not met (the placebo test of its comparisons has not finished; T (net minus the exposure-matched hold) is not above zero; T is not above zero with costs doubled; T is not above zero one bar later; T is not above zero one session later; maximum drawdown 17.77% is above 15%; TSLA holds 44.5% of the gross gain, above 40%). It made money in this simulation and it does not qualify; both are true.

**Did it beat its matched control and holding?** Against its price-only control P-A (the same rules on sessions without news), net -US$191.97: D-A is ahead by US$3,664.13 in net profit and behind by US$8,326.73 on T, which removes the effect of being more or less invested; it did not beat its matched control. Against the equal-weight buy-and-hold of basket A (net US$26,358.92, always fully invested): behind by US$22,886.76; it did not beat holding the basket. Against its exposure-matched hold (net US$13,729.94: the basket's daily return scaled to the share of the account this run had invested): T = -US$10,257.78, so it did not beat it.

**How much risk and exposure?** Maximum drawdown 17.77% (the equal-weight hold's 36.88%, the exposure-matched hold's 14.91%). On average 49.28% of the account was invested and 50.72% sat in cash. Turnover 70.26 times the average account value a year; costs US$1,530.08; holding period median 2 sessions, longest 10.

**How strong is the evidence?** 401 completed trades (the selection needs at least 30). The pre-registered test (date-clustered event-time placebo, 10,000 resamples, seed 20261107, Holm over 6 comparisons): C1 (event versus price-only): pending: the placebo has not run yet; C2 (content versus content-blind): pending: the placebo has not run yet; C3 (AI versus deterministic): not run: no API spending authorised; C5 (immediate versus pullback): pending: the placebo has not run yet. T under the sensitivities: -US$11,262.99 with costs doubled, -US$9,560.12 one bar later, -US$8,498.53 one session later. Repeated testing: this campaign runs 7 configurations, each with 3 sensitivities, and tests up to 6 comparisons (the AI comparisons are not run: no API spending authorised); 2020 to 2021 is the heavily used development period of HXR, range-trend, the research runner and event-swing, so even a small p here is a development result, never evidence of future profit.

Plan fates (entry plans): neither_activated 1921; bearish_activated 541; already_held 192; activated_then_gain 173; activated_then_loss_at_exit 147; activated_then_invalidated 81; funding_or_caps_rejected 32; activated_open_at_end 3. By event category: news: 2826 plans, 354 trades, 157 wins, P/L 3826.1; earnings_8k: 91 plans, 22 trades, 6 wins, P/L -166.84; other_filing: 173 plans, 28 trades, 12 wins, P/L -187.11.

Annual (net / exposure-matched / index, US$): 2020 4784.22 / 9998.53 / 17799.68; 2021 -1312.07 / 3731.41 / 8559.25. Per stock: MU 888.47; AMZN -37.81; META 895.53; TSLA 2601.45; VST -530; GOOG 542.8; INTC -1382.09; CSCO -429.11; PYPL 150.9; SNAP 772.03. Top stock TSLA 44.5% of the gross gain. Exits {"bearish_activation":274,"time_stop":46,"invalidation":81}. Holding sessions median 2, longest 10. Turnover per year 70.26; time in cash 50.72%. Signal fates {"filled":404,"already_held":192,"rejected":32}. Plans {"entryPlans":3090,"followUps":5526}. Accounting reconciles.

### P-A

**Did it make money after costs?** No. P-A lost US$191.97 after US$304.60 of modelled costs on US$15,000.00 (-1.28% in total, -0.64% a year), with 41 completed trades and 1 position(s) open at the end, valued at the last close. Qualification (CAMPAIGN-1.md section 10): not met (it is only ever the control arm of a comparison, so it cannot be a candidate; T (net minus the exposure-matched hold) is not above zero; T is not above zero with costs doubled; T is not above zero one bar later; T is not above zero one session later; MU holds 91.4% of the gross gain, above 40%).

**Did it beat its matched control and holding?** It is the price-only control of D-A; against D-A (net US$3,472.16) it is behind by US$3,664.13 in net profit and ahead by US$8,326.73 on T. Against the equal-weight buy-and-hold of basket A (net US$26,358.92, always fully invested): behind by US$26,550.89; it did not beat holding the basket. Against its exposure-matched hold (net US$1,739.09: the basket's daily return scaled to the share of the account this run had invested): T = -US$1,931.05, so it did not beat it.

**How much risk and exposure?** Maximum drawdown 12.96% (the equal-weight hold's 36.88%, the exposure-matched hold's 5.64%). On average 8.45% of the account was invested and 91.55% sat in cash. Turnover 8.26 times the average account value a year; costs US$304.60; holding period median 3 sessions, longest 10.

**How strong is the evidence?** 41 completed trades (the selection needs at least 30). The pre-registered test (date-clustered event-time placebo, 10,000 resamples, seed 20261107, Holm over 6 comparisons): C1 (event versus price-only): pending: the placebo has not run yet. T under the sensitivities: -US$2,239.26 with costs doubled, -US$1,550.41 one bar later, -US$1,209.52 one session later. Repeated testing: this campaign runs 7 configurations, each with 3 sensitivities, and tests up to 6 comparisons (the AI comparisons are not run: no API spending authorised); 2020 to 2021 is the heavily used development period of HXR, range-trend, the research runner and event-swing, so even a small p here is a development result, never evidence of future profit.

Plan fates (entry plans): neither_activated 151; bearish_activated 57; already_held 24; activated_then_invalidated 18; activated_then_gain 15; activated_then_loss_at_exit 8; activated_open_at_end 1. By event category: control: 274 plans, 42 trades, 16 wins, P/L -191.97.

Annual (net / exposure-matched / index, US$): 2020 -1193.6 / 141.15 / 17799.68; 2021 1001.63 / 1597.94 / 8559.25. Per stock: MU 405.8; AMZN 0; META 0; TSLA 0; VST -120.01; GOOG 0; INTC 0; CSCO 38.25; PYPL -93.63; SNAP -422.37. Top stock MU 91.4% of the gross gain. Exits {"invalidation":18,"bearish_activation":13,"time_stop":10}. Holding sessions median 3, longest 10. Turnover per year 8.26; time in cash 91.55%. Signal fates {"filled":42,"already_held":24}. Plans {"entryPlans":274,"followUps":0}. Accounting reconciles.

## Limitations

A hand-picked basket of ten survivors chosen in 2026; a two-year period that every earlier programme examined; news from one aggregator with created times and no expectations or earnings calendars; acceptance times as upper bounds for filings; the volume profile approximated from 1-minute bars; modelled costs; the placebo samples item-free sessions with replacement, and news-heavy stocks have few of them; the AI arms are not run (no API spending authorised).

