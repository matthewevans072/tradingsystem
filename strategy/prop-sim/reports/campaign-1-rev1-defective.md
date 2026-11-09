> **Defective revision, kept as the broken result (EXPERIMENT-LOG.md entry 13):** produced by ps-code-2026-11-09-1, whose stopped trades were charged the bar beyond the stop. Superseded by the replacement run under ps-code-2026-11-09-2 (reports/campaign-1.md).

# prop-sim campaign 1: ICT structure strategies in a simulated Lucid evaluation

**simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid.** **stand-in, regular hours only, not futures** (QQQ and SPY 1-minute bars at NQ = 41.0 × QQQ and ES = 10.0 × SPY). Code revision `ps-code-2026-11-09-1`. Exploratory: the period was used before by sweep-bos and the ICT Lab. Every figure is measured from the simulation.

| Config | Trades | Flex pass rate | Random mean | D | p | Holm p | Payout rate | Expected net / attempt | Pro pass rate | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| F1-NQ | 46 | 0.0% | 0.0% | -0.0 | 1.0000 | — | 0.0% | -US$175.00 | 0.0% | insufficient sample |
| F1-ES | 36 | 0.0% | 0.0% | 0.0 | 1.0000 | — | 0.0% | -US$175.00 | 0.0% | insufficient sample |
| F2-NQ | 1227 | 2.4% | 2.4% | -0.1 | 0.5602 | 1.0000 | 0.5% | -US$172.70 | 1.3% | tested |
| F2-ES | 1068 | 0.7% | 0.3% | 0.4 | 0.3682 | 1.0000 | 0.0% | -US$175.00 | 0.5% | tested |
| F3-NQ | 278 | 0.0% | 3.2% | -3.2 | 1.0000 | 1.0000 | 0.0% | -US$175.00 | 0.0% | tested |
| F3-ES | 254 | 2.6% | 0.9% | 1.8 | 0.1426 | 1.0000 | 0.0% | -US$175.00 | 2.6% | tested |
| LB-NQ | 1738 | 9.9% | 11.7% | -1.8 | 0.7368 | 1.0000 | 4.5% | -US$140.11 | 9.9% | tested |
| LB-ES | 1795 | 5.0% | 5.0% | 0.0 | 0.5340 | 1.0000 | 1.3% | -US$166.99 | 5.9% | tested |

**Outcome:** NONE: no configuration beat its matched random entries by more than chance.

## F1-NQ

**1. How often did it pass, and did it make money after fees?** F1-NQ passed 0.0% of 1096 simulated LucidFlex 50K evaluations (median — sessions to pass) and reached a first payout in 0.0% of them. The expected result per attempt is -US$175.00 after the assumed US$175.00 fee (US$0.00 before it): it did not make money after fees. LucidPro 50K: passed 0.0%, payouts 0.0%, -US$129.50 per attempt after its fee.

**2. Did it beat random entries and the plain level break?** Fewer than 100 completed trades (46): insufficient sample, description only. Against the plain level break of its market (9.9%): not ahead by -9.9 points (description).

**3. How much risk did it take?** It used a median 23.0% of the US$2,000 drawdown room before its evaluation ended; its worst losing streak was 5 trades; LucidPro's daily loss limit stopped trading on 0 attempt-days (LucidFlex was simulated without one). 0 evaluations failed on the drawdown, 1096 timed out after 60 sessions.

**4. How strong is the evidence?** 46 completed trades (insufficient sample); 1096 overlapping attempts grouped into start months for the test; Holm over 8 configurations. The period 2018 to 2022 was already tested by sweep-bos and the ICT Lab on the same market with ICT-style rules, and these are stand-in ETF bars, regular hours only, not futures: every result is exploratory.

Skipped setups: {"shift without a fair value gap (sweep of PDL)":89,"limit not reached in time":99,"shift without a fair value gap (sweep of PWH)":26,"shift without a fair value gap (sweep of PDH)":89,"shift without a fair value gap (sweep of PWL)":23,"a position or order is open":1}.

## F1-ES

**1. How often did it pass, and did it make money after fees?** F1-ES passed 0.0% of 1096 simulated LucidFlex 50K evaluations (median — sessions to pass) and reached a first payout in 0.0% of them. The expected result per attempt is -US$175.00 after the assumed US$175.00 fee (US$0.00 before it): it did not make money after fees. LucidPro 50K: passed 0.0%, payouts 0.0%, -US$129.50 per attempt after its fee.

**2. Did it beat random entries and the plain level break?** Fewer than 100 completed trades (36): insufficient sample, description only. Against the plain level break of its market (5.0%): not ahead by -5.0 points (description).

**3. How much risk did it take?** It used a median 17.0% of the US$2,000 drawdown room before its evaluation ended; its worst losing streak was 4 trades; LucidPro's daily loss limit stopped trading on 0 attempt-days (LucidFlex was simulated without one). 0 evaluations failed on the drawdown, 1096 timed out after 60 sessions.

**4. How strong is the evidence?** 36 completed trades (insufficient sample); 1096 overlapping attempts grouped into start months for the test; Holm over 8 configurations. The period 2018 to 2022 was already tested by sweep-bos and the ICT Lab on the same market with ICT-style rules, and these are stand-in ETF bars, regular hours only, not futures: every result is exploratory.

Skipped setups: {"shift without a fair value gap (sweep of PDH)":70,"shift without a fair value gap (sweep of PDL)":76,"shift without a fair value gap (sweep of PWL)":17,"limit not reached in time":80,"shift without a fair value gap (sweep of PWH)":29,"a position or order is open":2}.

## F2-NQ

**1. How often did it pass, and did it make money after fees?** F2-NQ passed 2.4% of 1096 simulated LucidFlex 50K evaluations (median 27 sessions to pass) and reached a first payout in 0.5% of them. The expected result per attempt is -US$172.70 after the assumed US$175.00 fee (US$2.30 before it): it did not make money after fees. LucidPro 50K: passed 1.3%, payouts 0.0%, -US$129.50 per attempt after its fee.

**2. Did it beat random entries and the plain level break?** Against its matched random entries (2.4% pass rate on average over 1,000 seeds): not ahead by -0.1 points, month-resampled p 0.5602, Holm 1.0000, not significant: it did not beat random by more than chance. Against the plain level break of its market (9.9%): not ahead by -7.6 points (description). It passed sometimes, but no more often than random by more than chance: it has shown no edge.

**3. How much risk did it take?** It used a median 100.0% of the US$2,000 drawdown room before its evaluation ended; its worst losing streak was 15 trades; LucidPro's daily loss limit stopped trading on 223 attempt-days (LucidFlex was simulated without one). 479 evaluations failed on the drawdown, 591 timed out after 60 sessions.

**4. How strong is the evidence?** 1227 completed trades; 1096 overlapping attempts grouped into start months for the test; Holm over 8 configurations. The period 2018 to 2022 was already tested by sweep-bos and the ICT Lab on the same market with ICT-style rules, and these are stand-in ETF bars, regular hours only, not futures: every result is exploratory.

Skipped setups: {"break without an inverse fair value gap":1984,"limit not reached in time":2745,"a position or order is open":925,"window trade limit":283}.

## F2-ES

**1. How often did it pass, and did it make money after fees?** F2-ES passed 0.7% of 1096 simulated LucidFlex 50K evaluations (median 7 sessions to pass) and reached a first payout in 0.0% of them. The expected result per attempt is -US$175.00 after the assumed US$175.00 fee (US$0.00 before it): it did not make money after fees. LucidPro 50K: passed 0.5%, payouts 0.0%, -US$129.50 per attempt after its fee.

**2. Did it beat random entries and the plain level break?** Against its matched random entries (0.3% pass rate on average over 1,000 seeds): ahead by 0.4 points, month-resampled p 0.3682, Holm 1.0000, not significant: it did not beat random by more than chance. Against the plain level break of its market (5.0%): not ahead by -4.3 points (description). It passed sometimes, but no more often than random by more than chance: it has shown no edge.

**3. How much risk did it take?** It used a median 99.0% of the US$2,000 drawdown room before its evaluation ended; its worst losing streak was 28 trades; LucidPro's daily loss limit stopped trading on 105 attempt-days (LucidFlex was simulated without one). 201 evaluations failed on the drawdown, 887 timed out after 60 sessions.

**4. How strong is the evidence?** 1068 completed trades; 1096 overlapping attempts grouped into start months for the test; Holm over 8 configurations. The period 2018 to 2022 was already tested by sweep-bos and the ICT Lab on the same market with ICT-style rules, and these are stand-in ETF bars, regular hours only, not futures: every result is exploratory.

Skipped setups: {"break without an inverse fair value gap":1951,"limit not reached in time":2584,"a position or order is open":679,"window trade limit":195}.

## F3-NQ

**1. How often did it pass, and did it make money after fees?** F3-NQ passed 0.0% of 1096 simulated LucidFlex 50K evaluations (median — sessions to pass) and reached a first payout in 0.0% of them. The expected result per attempt is -US$175.00 after the assumed US$175.00 fee (US$0.00 before it): it did not make money after fees. LucidPro 50K: passed 0.0%, payouts 0.0%, -US$129.50 per attempt after its fee.

**2. Did it beat random entries and the plain level break?** Against its matched random entries (3.2% pass rate on average over 1,000 seeds): not ahead by -3.2 points, month-resampled p 1.0000, Holm 1.0000, not significant: it did not beat random by more than chance. Against the plain level break of its market (9.9%): not ahead by -9.9 points (description).

**3. How much risk did it take?** It used a median 86.0% of the US$2,000 drawdown room before its evaluation ended; its worst losing streak was 11 trades; LucidPro's daily loss limit stopped trading on 135 attempt-days (LucidFlex was simulated without one). 117 evaluations failed on the drawdown, 979 timed out after 60 sessions.

**4. How strong is the evidence?** 278 completed trades; 1096 overlapping attempts grouped into start months for the test; Holm over 8 configurations. The period 2018 to 2022 was already tested by sweep-bos and the ICT Lab on the same market with ICT-style rules, and these are stand-in ETF bars, regular hours only, not futures: every result is exploratory.

Skipped setups: {"break of PDH without an order block below the close":533,"limit not reached in time":793,"a position or order is open":228,"break of PDL without an order block below the close":378,"break of PWH without an order block below the close":85,"break of PWL without an order block below the close":70,"window trade limit":7}.

## F3-ES

**1. How often did it pass, and did it make money after fees?** F3-ES passed 2.6% of 1096 simulated LucidFlex 50K evaluations (median 41 sessions to pass) and reached a first payout in 0.0% of them. The expected result per attempt is -US$175.00 after the assumed US$175.00 fee (US$0.00 before it): it did not make money after fees. LucidPro 50K: passed 2.6%, payouts 0.0%, -US$129.50 per attempt after its fee.

**2. Did it beat random entries and the plain level break?** Against its matched random entries (0.9% pass rate on average over 1,000 seeds): ahead by 1.8 points, month-resampled p 0.1426, Holm 1.0000, not significant: it did not beat random by more than chance. Against the plain level break of its market (5.0%): not ahead by -2.4 points (description). It passed sometimes, but no more often than random by more than chance: it has shown no edge.

**3. How much risk did it take?** It used a median 90.0% of the US$2,000 drawdown room before its evaluation ended; its worst losing streak was 20 trades; LucidPro's daily loss limit stopped trading on 36 attempt-days (LucidFlex was simulated without one). 71 evaluations failed on the drawdown, 996 timed out after 60 sessions.

**4. How strong is the evidence?** 254 completed trades; 1096 overlapping attempts grouped into start months for the test; Holm over 8 configurations. The period 2018 to 2022 was already tested by sweep-bos and the ICT Lab on the same market with ICT-style rules, and these are stand-in ETF bars, regular hours only, not futures: every result is exploratory.

Skipped setups: {"break of PDH without an order block below the close":532,"limit not reached in time":826,"a position or order is open":237,"break of PWH without an order block below the close":124,"break of PDL without an order block below the close":398,"break of PWL without an order block below the close":78,"window trade limit":6}.

## LB-NQ

**1. How often did it pass, and did it make money after fees?** LB-NQ passed 9.9% of 1096 simulated LucidFlex 50K evaluations (median 16 sessions to pass) and reached a first payout in 4.5% of them. The expected result per attempt is -US$140.11 after the assumed US$175.00 fee (US$34.89 before it): it did not make money after fees. LucidPro 50K: passed 9.9%, payouts 1.5%, -US$112.04 per attempt after its fee.

**2. Did it beat random entries and the plain level break?** Against its matched random entries (11.7% pass rate on average over 1,000 seeds): not ahead by -1.8 points, month-resampled p 0.7368, Holm 1.0000, not significant: it did not beat random by more than chance. It passed sometimes, but no more often than random by more than chance: it has shown no edge.

**3. How much risk did it take?** It used a median 98.0% of the US$2,000 drawdown room before its evaluation ended; its worst losing streak was 12 trades; LucidPro's daily loss limit stopped trading on 242 attempt-days (LucidFlex was simulated without one). 0 evaluations failed on the drawdown, 987 timed out after 60 sessions.

**4. How strong is the evidence?** 1738 completed trades; 1096 overlapping attempts grouped into start months for the test; Holm over 8 configurations. The period 2018 to 2022 was already tested by sweep-bos and the ICT Lab on the same market with ICT-style rules, and these are stand-in ETF bars, regular hours only, not futures: every result is exploratory.

Skipped setups: {"no bar before the window ended":37,"a position or order is open":380,"window trade limit":217}.

## LB-ES

**1. How often did it pass, and did it make money after fees?** LB-ES passed 5.0% of 1096 simulated LucidFlex 50K evaluations (median 14 sessions to pass) and reached a first payout in 1.3% of them. The expected result per attempt is -US$166.99 after the assumed US$175.00 fee (US$8.01 before it): it did not make money after fees. LucidPro 50K: passed 5.9%, payouts 0.4%, -US$126.52 per attempt after its fee.

**2. Did it beat random entries and the plain level break?** Against its matched random entries (5.0% pass rate on average over 1,000 seeds): not ahead by 0.0 points, month-resampled p 0.5340, Holm 1.0000, not significant: it did not beat random by more than chance. It passed sometimes, but no more often than random by more than chance: it has shown no edge.

**3. How much risk did it take?** It used a median 98.0% of the US$2,000 drawdown room before its evaluation ended; its worst losing streak was 16 trades; LucidPro's daily loss limit stopped trading on 113 attempt-days (LucidFlex was simulated without one). 0 evaluations failed on the drawdown, 1041 timed out after 60 sessions.

**4. How strong is the evidence?** 1795 completed trades; 1096 overlapping attempts grouped into start months for the test; Holm over 8 configurations. The period 2018 to 2022 was already tested by sweep-bos and the ICT Lab on the same market with ICT-style rules, and these are stand-in ETF bars, regular hours only, not futures: every result is exploratory.

Skipped setups: {"a position or order is open":405,"window trade limit":228,"no bar before the window ended":27}.

