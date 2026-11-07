# news-replay campaign 2: AMT exits on the volume-profile entry (exploratory: 2020-01-02 to 2021-12-31; simulation only)

Code revision `nr2-code-2026-11-06-1`, engine `nr-engine-2` (X1 runs nr-engine-1's path); CAMPAIGN-2.md committed as 983b5e8 before any news-replay outcome existed. Every figure is measured from the simulation; the equal-weight buy-and-hold of basket A and each run's exposure-matched hold are derived benchmarks. T = net profit minus the exposure-matched hold. Nothing here is evidence of future profit.

**Reproduction of campaign 1's D-C by X1:** OK (D-C run 17: net -1661.94, trades 140, 10080 actions; X1: net -1661.94, trades 140, 10080 actions).

## Configurations against the benchmarks (base case)

| Config | Exit | Net US$ | Max DD % | Invested % | Trades | Costs | Index net | Exposure-matched net | T | T, costs x2 | T, +1 bar | T, +1 session | Exits |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| X1 | existing | -1661.94 | 15.88 | 19.12 | 140 | 434.89 | 26358.92 | 5128.07 | -6790 | -7178.03 | -6806.68 | -5798.73 | bearish_activation 72, invalidation 51, time_stop 17 |
| X2 | acceptance | -1154.83 | 7.78 | 6.24 | 159 | 484.99 | 26358.92 | 1331.57 | -2486.4 | -2912.27 | -2259.14 | -1902.44 | acceptance 115, invalidation 18, bearish_activation 26 |
| X3 | target | 403.01 | 5.16 | 8.92 | 173 | 583.2 | 26358.92 | 2826.42 | -2423.41 | -2609.83 | -2234.91 | -2949.49 | target 94, invalidation 47, bearish_activation 30, time_stop 2 |
| X4 | price_only | -1167.09 | 8.21 | 3.51 | 154 | 471.85 | 26358.92 | 589.74 | -1756.83 | -2185.92 | -1721.32 | -2951.15 | price_only 128, bearish_activation 25, time_stop 1 |

## Pre-registered comparisons (placebo p raw and Holm-adjusted over three)

| Comparison | Statistic (T difference) | Raw p | Holm p | Status |
|---|---|---|---|---|
| E1 AMT acceptance exit versus existing exits (X2 vs X1) | 4303.6 | 0.0001 | 0.0003 | tested, Holm-significant |
| E2 AMT target exit versus existing exits (X3 vs X1) | 4366.59 | 0.0001 | 0.0003 | tested, Holm-significant |
| E3 AMT acceptance exit versus price-only matched exit (X2 vs X4) | -729.57 | 0.5591 | 0.5591 | tested |

**Outcome:** NONE: no configuration meets every condition of CAMPAIGN-2.md section 10. Holm-significant comparisons exist, but their first arms fail other conditions (X2: T (net minus the exposure-matched hold) is not above zero; T is not above zero with costs doubled; T is not above zero one bar later; T is not above zero one session later; PYPL holds 51.7% of the gross gain, above 40% | X3: T (net minus the exposure-matched hold) is not above zero; T is not above zero with costs doubled; T is not above zero one bar later; T is not above zero one session later).

## Per configuration

### X1: existing

**Did it make money after costs?** No. X1 (the existing exits (the control)) lost US$1,661.94 after US$434.89 of modelled costs on US$15,000.00 (-11.08% in total, -5.71% a year), with 140 completed trades. Qualification (CAMPAIGN-2.md section 10): not met (it is only ever the second arm of a comparison, so it cannot be a candidate; T (net minus the exposure-matched hold) is not above zero; T is not above zero with costs doubled; T is not above zero one bar later; T is not above zero one session later; maximum drawdown 15.88% is above 15%; PYPL holds 85.0% of the gross gain, above 40%).

**Did it beat its matched control and holding?** X1 is the control: campaign 1's D-C with its existing exits, reproduced to the cent. Against the equal-weight buy-and-hold of basket A (net US$26,358.92): behind by US$28,020.86; it did not beat holding the basket. Against its exposure-matched hold (net US$5,128.07): T = -US$6,790.00, so it did not beat it. Exits: bearish_activation 72, invalidation 51, time_stop 17.

**How much risk and exposure?** Maximum drawdown 15.88% (the equal-weight hold's 36.88%, the exposure-matched hold's 4.97%). On average 19.12% of the account was invested and 80.88% sat in cash. Turnover 25.31 times the average account value a year; costs US$434.89; holding period median 3 sessions, longest 10.

**How strong is the evidence?** 140 completed trades (the selection needs at least 30). The pre-registered test (date-clustered event-time placebo, 10,000 resamples, seed 20261108, Holm over 3): E1 (AMT acceptance exit versus existing exits): statistic US$4,303.60, placebo p 0.0001, Holm-adjusted 0.0003, significant after Holm; E2 (AMT target exit versus existing exits): statistic US$4,366.59, placebo p 0.0001, Holm-adjusted 0.0003, significant after Holm. T under the sensitivities: -US$7,178.03 with costs doubled, -US$6,806.68 one bar later, -US$5,798.73 one session later. Repeated testing: four exits on one entry, after campaign 1's seven configurations on the same news and the same heavily used period (HXR, range-trend, the research runner, event-swing); a small p here is a development result, never evidence of future profit.

Per stock: MU 114.72; AMZN 15.26; META -835.06; TSLA -638.4; VST -19.37; GOOG 7.55; INTC -234.69; CSCO -603.38; PYPL 778.3; SNAP -246.87. Annual (net / exposure-matched / index): 2020 312.82 / 4061.42 / 17799.68; 2021 -1974.76 / 1066.65 / 8559.25. Accounting reconciles.

### X2: acceptance

**Did it make money after costs?** No. X2 (the AMT acceptance exit) lost US$1,154.83 after US$484.99 of modelled costs on US$15,000.00 (-7.70% in total, -3.93% a year), with 159 completed trades. Qualification (CAMPAIGN-2.md section 10): not met (T (net minus the exposure-matched hold) is not above zero; T is not above zero with costs doubled; T is not above zero one bar later; T is not above zero one session later; PYPL holds 51.7% of the gross gain, above 40%).

**Did it beat its matched control and holding?** Against the existing exits X1 (net -US$1,661.94): X2 is ahead by US$507.11 in net profit and ahead by US$4,303.60 on T; it beat the existing exits. Against the price-only matched exit X4 (net -US$1,167.09): ahead by US$12.26 in net profit and behind by US$729.57 on T; the volume-profile level added nothing over the price-only level. Against the equal-weight buy-and-hold of basket A (net US$26,358.92): behind by US$27,513.75; it did not beat holding the basket. Against its exposure-matched hold (net US$1,331.57): T = -US$2,486.40, so it did not beat it. Exits: acceptance 115, invalidation 18, bearish_activation 26.

**How much risk and exposure?** Maximum drawdown 7.78% (the equal-weight hold's 36.88%, the exposure-matched hold's 4.06%). On average 6.24% of the account was invested and 93.76% sat in cash. Turnover 28.77 times the average account value a year; costs US$484.99; holding period median 1 sessions, longest 7.

**How strong is the evidence?** 159 completed trades (the selection needs at least 30). The pre-registered test (date-clustered event-time placebo, 10,000 resamples, seed 20261108, Holm over 3): E1 (AMT acceptance exit versus existing exits): statistic US$4,303.60, placebo p 0.0001, Holm-adjusted 0.0003, significant after Holm; E3 (AMT acceptance exit versus price-only matched exit): statistic -US$729.57, placebo p 0.5591, Holm-adjusted 0.5591, not significant after Holm. T under the sensitivities: -US$2,912.27 with costs doubled, -US$2,259.14 one bar later, -US$1,902.44 one session later. Repeated testing: four exits on one entry, after campaign 1's seven configurations on the same news and the same heavily used period (HXR, range-trend, the research runner, event-swing); a small p here is a development result, never evidence of future profit.

Per stock: MU 117.89; AMZN -67.54; META -140.91; TSLA -540.64; VST -42.15; GOOG -173.81; INTC 18.98; CSCO -200.65; PYPL 146.76; SNAP -272.78. Annual (net / exposure-matched / index): 2020 -416.78 / 1360.54 / 17799.68; 2021 -738.05 / -28.97 / 8559.25. Accounting reconciles.

### X3: target

**Did it make money after costs?** Yes. X3 (the AMT target exit) made US$403.01 after US$583.20 of modelled costs on US$15,000.00 (2.69% in total, 1.34% a year), with 173 completed trades. Qualification (CAMPAIGN-2.md section 10): not met (T (net minus the exposure-matched hold) is not above zero; T is not above zero with costs doubled; T is not above zero one bar later; T is not above zero one session later). It made money in this simulation and it does not qualify; both are true.

**Did it beat its matched control and holding?** Against the existing exits X1 (net -US$1,661.94): X3 is ahead by US$2,064.95 in net profit and ahead by US$4,366.59 on T; it beat the existing exits. Against the equal-weight buy-and-hold of basket A (net US$26,358.92): behind by US$25,955.91; it did not beat holding the basket. Against its exposure-matched hold (net US$2,826.42): T = -US$2,423.41, so it did not beat it. Exits: target 94, invalidation 47, bearish_activation 30, time_stop 2; targets set at the fill: primary 172, composite 1.

**How much risk and exposure?** Maximum drawdown 5.16% (the equal-weight hold's 36.88%, the exposure-matched hold's 2.78%). On average 8.92% of the account was invested and 91.08% sat in cash. Turnover 31.72 times the average account value a year; costs US$583.20; holding period median 1 sessions, longest 10.

**How strong is the evidence?** 173 completed trades (the selection needs at least 30). The pre-registered test (date-clustered event-time placebo, 10,000 resamples, seed 20261108, Holm over 3): E2 (AMT target exit versus existing exits): statistic US$4,366.59, placebo p 0.0001, Holm-adjusted 0.0003, significant after Holm. T under the sensitivities: -US$2,609.83 with costs doubled, -US$2,234.91 one bar later, -US$2,949.49 one session later. Repeated testing: four exits on one entry, after campaign 1's seven configurations on the same news and the same heavily used period (HXR, range-trend, the research runner, event-swing); a small p here is a development result, never evidence of future profit.

Per stock: MU 520.92; AMZN -23.57; META -567.37; TSLA 138.7; VST 149.06; GOOG -195.85; INTC 236.03; CSCO -393.97; PYPL 187.64; SNAP 351.43. Annual (net / exposure-matched / index): 2020 612.27 / 2338.97 / 17799.68; 2021 -209.26 / 487.45 / 8559.25. Accounting reconciles.

### X4: price_only

**Did it make money after costs?** No. X4 (the price-only matched exit) lost US$1,167.09 after US$471.85 of modelled costs on US$15,000.00 (-7.78% in total, -3.98% a year), with 154 completed trades. Qualification (CAMPAIGN-2.md section 10): not met (it is only ever the second arm of a comparison, so it cannot be a candidate; T (net minus the exposure-matched hold) is not above zero; T is not above zero with costs doubled; T is not above zero one bar later; T is not above zero one session later; MU holds 85.2% of the gross gain, above 40%).

**Did it beat its matched control and holding?** Against the existing exits X1 (net -US$1,661.94): X4 is ahead by US$494.85 in net profit and ahead by US$5,033.17 on T; it beat the existing exits. Against the equal-weight buy-and-hold of basket A (net US$26,358.92): behind by US$27,526.01; it did not beat holding the basket. Against its exposure-matched hold (net US$589.74): T = -US$1,756.83, so it did not beat it. Exits: price_only 128, bearish_activation 25, time_stop 1.

**How much risk and exposure?** Maximum drawdown 8.21% (the equal-weight hold's 36.88%, the exposure-matched hold's 3.62%). On average 3.51% of the account was invested and 96.49% sat in cash. Turnover 27.82 times the average account value a year; costs US$471.85; holding period median 0 sessions, longest 10.

**How strong is the evidence?** 154 completed trades (the selection needs at least 30). The pre-registered test (date-clustered event-time placebo, 10,000 resamples, seed 20261108, Holm over 3): E3 (AMT acceptance exit versus price-only matched exit): statistic -US$729.57, placebo p 0.5591, Holm-adjusted 0.5591, not significant after Holm. T under the sensitivities: -US$2,185.92 with costs doubled, -US$1,721.32 one bar later, -US$2,951.15 one session later. Repeated testing: four exits on one entry, after campaign 1's seven configurations on the same news and the same heavily used period (HXR, range-trend, the research runner, event-swing); a small p here is a development result, never evidence of future profit.

Per stock: MU 81.15; AMZN -57.52; META -22.73; TSLA -233.09; VST -47.23; GOOG -183.7; INTC -300.86; CSCO -161.8; PYPL 14.13; SNAP -255.44. Annual (net / exposure-matched / index): 2020 -342.38 / 623.23 / 17799.68; 2021 -824.71 / -33.49 / 8559.25. Accounting reconciles.

## Limitations

All of campaign 1's, plus: the number of filled entry-C trades bounds the power of every comparison; the exits are tested on one entry only; 30-minute bars are built from regular-session 5-minute bars; a resting target is modelled from bar highs with a one-cent margin, not from the order book.

