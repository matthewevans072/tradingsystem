# ADOPTED: the pick rule and the evaluation-date rule

> **ADOPTED by the owner on 2026-11-02**, as experimental settings, not claims that they reproduce the owner's
> trading. The owner's words: "I accept the proposed pick rule and the corrected 2022-2023 evaluation-date
> rule, using 30 completed trades and the 40% gross-gain contribution limit as experimental settings. Keep MU
> in this evaluation and leave its 2025-mid-2026 holdout untouched. Combine Part 1, Part 2, and the gated
> launcher into one final VS Code work order. Clean up the drafting slip. Include the exact best-5% robustness
> calculation and 0.5-percentage-point tie rule in the adopted specification so implementation is unambiguous.
> Authorize the documentation, implementation, decision records, launcher, and synthetic tests together. Do
> not run historical experiments yet. No additional broad review cycle." Earlier the same day: "Use 30
> completed trades per variant and a 40% single-stock profit-contribution limit as experimental defaults.
> Define the profit-contribution calculation and best-5%-removal check precisely. ... Correct the wording about
> prospective trading, which starts on future sessions. ... Keep authorization to run the eight exploratory
> backtests separate from these preparations."
>
> This file was a proposal (written 2026-10-28, before any practice run); it is now the specification the
> code implements (`server/rangetrend/metrics.js`, `pick.js`). **The choice is not made automatically: the
> code's `pickRuleReport` is a report.** No practice run has been made; this file's SHA-256 is written into
> `EVALUATION-PROTOCOL.md`'s two fields with the rules in short form, so the fields stand on their own.

All rates below are decimal fractions (0.012 is 1.2 percentage points; 0.5 percentage points = 0.005). Money
comparisons are made in integer cents (each amount rounded to the nearest cent, then compared exactly).

## Part A. The pick rule

**In one sentence:** after the eight practice runs, a variant advances only if it is a *qualified* run that beats
its own exposure-matched hold on both return and drawdown after costs, keeps that edge without its best 5% of
outcomes, and is better than every other passing variant on the score below with the 0.5-point tie rule; if no
variant does all of this, **none advances**, and that is a normal outcome.

### Definitions

1. **Completed trade:** a closed trade with a recorded exit in the practice period. Positions open at the end
   do not count toward N. A position closed by `split_no_whole_share` (cash in lieu) counts as completed.
   **N = 30** (experimental default).
2. **Outcomes:** every completed trade's net P/L after all costs and net dividends (`pnlTotal`, including the
   post-exit dividends of that trade) **plus** every position open at the end, valued at the last close with no
   exit costs deducted. Each open position is one outcome.
3. **Per-stock P/L:** `P(s)` = the sum of the outcomes of stock `s`.
4. **Single-stock gross-gain share:** `G` = the sum over stocks of `max(0, P(s))`; `share(s) = max(0, P(s)) / G`.
   **The gate: `max share <= 0.40`**, compared exactly with no rounding (integer cents: `100 × max(0, P(s))
   cents <= 40 × G cents`). Stocks with a loss count as zero and are never subtracted. If `G = 0` the share is
   undefined and the variant does not qualify. Reported as well, **information only, never a gate**:
   `P(s) / sum of P(s)` (null when the net total is zero or negative), `P(s)`, `share(s)`, and the number of
   stocks with `P(s) > 0`.
   - Worked examples: {A +100, B −80, C +20} gives `G = 120`, A 83.3% (**fails**; the net-based 250% is
     information only); {A +40, B +35, C +30, D −50} gives `G = 105`, max 38.1% (**passes**); two winning stocks
     cannot pass (one of them is at least 50%); all losses gives `G = 0`, undefined (**does not qualify**).
5. **Qualified run:** completed trades `>= 30`; the run recorded by the gate with no benchmark or metrics error;
   the gross-gain gate passes.
6. **Comparison** against the variant's **own exposure-matched hold (c)**, from the run's metrics:
   - **return test:** annualised return after costs **strictly above** (c)'s;
   - **drawdown test:** maximum drawdown `<=` (c)'s;
   - **robustness test (best-5% removal):** `n` = the number of outcomes; `K = ceil(0.05 × n)`, at least 1;
     remove the `K` outcomes with the highest P/L (ties broken by the earlier entry date, then the symbol, then
     the trade id); `removedPL` = their sum; `adjustedNetPL = (sum of all outcomes) − removedPL`;
     `adjustedEnd = startingCash + adjustedNetPL`;
     `adjustedAnnualised = (adjustedEnd / startingCash)^(1 / years) − 1` with the same `years` and day-count
     convention as the run's own annualised return (days from the first to the last equity point ÷ 365.25);
     the robustness test holds only if `adjustedNetPL > 0` **and** `adjustedAnnualised >` (c)'s annualised
     return. **This is a stress calculation, not a re-simulation:** removing outcomes after the fact does not
     change later sizing, and the drawdown is not recomputed.

   A variant passes the comparison only if all three tests hold. **Return per unit of drawdown alone never
   advances a variant** (it stays reported).
7. **Score** (passing variants only): the annualised return minus (c)'s annualised return, in percentage
   points of return (as a decimal fraction: 0.012 is 1.2 points).
8. **Choosing among passing variants (the 0.5-point rule, no chaining):** let `top` = the highest score.
   `T0` = the passing variants with `score >= top − 0.005`. If `|T0| = 1` it is chosen. Else `minDD` = the
   smallest maximum drawdown in `T0` and `T1` = the variants in `T0` with `maximum drawdown <= minDD + 0.005`;
   if `|T1| = 1` it is chosen. Else `T2` = the variants in `T1` with the most completed trades; if `|T2| = 1`
   it is chosen; else **NONE advances**. The rule picks one variant across both families.
9. **"None advances"** when no run qualifies, none passes the comparison, or the tie-break above ends in a
   tie. Then the reserve is not used to try again, the evaluation and the prospective journal do not start,
   and a new candidate needs a new plan version.
10. **Evaluation (adopted):** the historical evaluation window is **2022-01-03 to 2023-12-29**, read from
    `periods-hxr-v3.json`'s validation dates, used once, after the pick rule has produced a candidate and the
    owner's separate authorization. MU stays in the ten-stock universe. Any later HXR version must record the
    2022-2023 exposure in both experiment logs. This window is secondary evidence with disclosed prior
    exposure, not independent evidence; the prospective journal gives fresh evidence only after enough
    duration, trades and realistic execution.

**The choice is not made automatically:** `pickRuleReport` prints the table (qualified, each test, the score,
the T0/T1/T2 sets, the outcome and why); it never writes the ledger, never advances anything and never starts
the evaluation.

### What it protects against, and its trade-offs

- **Never the ending balance alone:** the comparison is against the exposure-matched hold, so a run cannot win by
  being invested in a rising market, and cash sitting out a fall earns no credit by itself.
- **Costs:** every figure is after the modelled costs; the trade-count gate stops a one-trade wonder.
- **Luck:** the best-5% and gross-gain conditions stop one outlier trade or one stock carrying the result; the
  gross-gain share cannot be flattered by losses elsewhere.
- **Hindsight:** the rule and its settings were adopted before the first practice run; the gate stores the
  protocol's hash at the first run and refuses runs if it changes.
- **Trade-offs:** the rule is strict, so "none advances" is likely on eight exploratory runs over one period; a
  real edge that is small, or one that shows only as a better return-per-drawdown ratio, will not advance.

## Part B. The evaluation-date rule

**In one sentence:** the historical evaluation period is **2022-01-03 to 2023-12-29** (HXR's reserved validation
period, the same ten stocks, MU included), fixed by this rule and by the hash of the protocol that states it,
used once; **2024-01-02 to 2026-10-21 stays unused as a reserve window**, which also keeps the Strategy Lab's MU
holdout (2025-01-01 to 2026-06-30) untouched; **the prospective journal runs on future sessions after the owner
starts it** and is not tied to 2024-2026 data.

### The windows, and their prior exposure (PLAN-DRAFT.md section 1)

| Window | What it is | Prior exposure |
|---|---|---|
| 2017-10-02 to 2021-12-31 | HXR's development period; the eight practice runs | Development data: HXR's 22 runs were seen; the plan was written after them. **Never an evaluation.** |
| 2022-01-03 to 2023-12-29 | HXR's reserved validation period on the same ten stocks: **the adopted evaluation window** | Never run by HXR (it stopped). Downloaded and readiness-checked; MU's 15-minute bars were used by the consolidation-breakout runs of 2022-2024 (a different strategy); the owner viewed and traded these stocks. **Secondary evidence, disclosed, not independent.** |
| 2024-01-02 to 2026-10-21 | HXR's reserved final period: **a reserve window, unused** | Never run by HXR; downloaded and readiness-checked; contains the Strategy Lab's **untouched MU holdout (2025-01-01 to 2026-06-30)**, which stays untouched. |
| Future sessions | The local simulated prospective journal, from the session after the owner starts it | None: fresh observations, with no broker account, no orders and no paper-trading API. |

Using 2022-2023 exposes HXR's reserved validation period: any later HXR version must record that as prior
exposure, in `strategy/hxr/EXPERIMENT-LOG.md` and in `strategy/range-trend/EXPERIMENT-LOG.md`.

### Fixing the dates by rule and by hash

- The window is stated in `EVALUATION-PROTOCOL.md`'s **Date-choice rule** field, with this file's SHA-256,
  before the first practice run; the gate stores that file's hash at the first practice run, so the dates
  cannot move afterwards.
- The window's start and end are `periods-hxr-v3.json`'s validation dates, read from that file, not typed by
  hand, so there is nothing to tune.
- **MU is kept** (`EVALUATION-THRESHOLDS.md`): 2022-2023 does not touch its holdout window.

### Each window once, and what contaminates it

- The historical evaluation runs **once**, on the frozen candidate, with the frozen protocol and thresholds. A
  second run on the same window, for any reason, is marked contaminated and can never pass.
- The window is contaminated for this strategy if, before the evaluation: any range-trend rule, config or
  threshold is changed after a result on that window is seen; any practice run touches it; or its prices are
  used to choose among the eight variants. Looking at the window's bars for the data readiness check (dates,
  gaps, split ratios, no rule run) does not contaminate it.
- After the evaluation, the window is development data for any later version.

### What it protects against, and its trade-offs

- **Flattering dates:** the window is one block fixed by another document's dates and by hash, chosen before any
  practice result exists; there is no choice left to make after results are seen.
- **Double use:** the development period is excluded by rule; the reserve window is unused; the prospective
  journal uses only sessions after its start.
- **The MU holdout:** untouched.
- **Trade-offs:** 2022-2023 is one two-year block with its own regime (a bear year and a rebound year); a
  strategy judged on it may behave differently elsewhere, and the result is secondary evidence at best because
  the owner's own viewing and trading, and the consolidation-breakout work on MU, overlap it.

## Part C. What is, and is not, authorized by the adoption

Adopted and authorized together: this specification, its implementation (`metrics.js`, `pick.js`), the
decision records (`EXPERIMENT-LOG.md`, `EVALUATION-PROTOCOL.md`'s two fields, MU in `EVALUATION-THRESHOLDS.md`),
the gated launcher (`scripts/rangetrend-run.mjs`) and the synthetic tests. **Not authorized:** running any of
the eight exploratory practice runs (that needs the owner's separate "**Practice runs authorized**" row in
`EXPERIMENT-LOG.md`, which the gate requires), the historical evaluation, and the prospective journal.
