# PROPOSAL: a pick rule and an evaluation-date rule for the owner's confirmation

> **PROPOSAL. Nothing in this file is approved.** It was written on 2026-10-28, before any practice run, to give
> the owner one recommended rule of each kind to confirm, change or reject. It writes nothing into
> `EVALUATION-PROTOCOL.md`: the **Pick rule** and **Date-choice rule** fields there stay [OWNER TO SET] and the
> practice-run gate still refuses. The owner copies a rule into that file, in their own words if they wish,
> only when they have decided. No result of any kind has been seen (no range-trend run exists).

---

## 1. Recommended pick rule

**In one sentence:** after the eight practice runs, a variant advances only if it is a *qualified* run that beats
its own exposure-matched hold on both return and drawdown after costs, keeps that edge without its best 5% of
outcomes and without its largest stock, and is better than every other qualified variant on the pre-stated
score; if no variant does all of this, **none advances**, and that is a normal outcome.

### 1a. Qualified runs (gates before any comparison)

A run is considered at all only if:
1. it has at least **N completed trades** (the owner sets N before the first practice run; PLAN-DRAFT.md's
   Tier 2 description uses [30] as its unconfirmed example);
2. its result was recorded by the gate (a run in the ledger with its hashes and log row), with no benchmark or
   metrics error;
3. its single-stock share of net profit is at most the Tier 2 limit the owner sets ([40%] is the unconfirmed
   example), measured on completed trades and positions open at the end.

A run that fails a gate is reported but never advances, whatever its return.

### 1b. The comparison (PLAN-DRAFT.md section 7c, as the code computes it)

For each qualified run, against its own exposure-matched hold (c):
- **Return test:** annualised return after costs above (c)'s.
- **Drawdown test:** maximum drawdown not deeper than (c)'s.
- **Robustness test:** the return test still holds when the run's best 5% of outcomes are removed (the Tier 2
  "without the best 5%" figure recomputed as a return, or, more simply, net P/L without the best 5% still above
  zero and the run still above (c) on return per unit of drawdown).

A variant passes the comparison only if all three hold. "Return per unit of drawdown" alone (the second arm of
the trade-off rule) is **not** enough to advance under this proposal: it is reported, but a run that beats (c)
only on that ratio while losing on return or drawdown does not advance.

### 1c. Choosing among variants that pass

Score each passing variant by **annualised return after costs minus the annualised return of its exposure-matched
hold**, i.e. the return it adds beyond holding cash with the same exposure. The highest score advances.

- **Tie:** two scores within 0.5 percentage points are a tie. The tie is broken by the smaller maximum drawdown;
  if that is also within 0.5 points, by the larger number of completed trades; if still tied, **none advances**
  (the owner does not choose by eye).
- **Families:** the rule picks one variant across both families; it does not pick one per family.

### 1d. The "none advances" result

None advances when no run is qualified, when no qualified run passes the comparison, or when the tie-break ends in
a tie. This is recorded in `EXPERIMENT-LOG.md` as the outcome of the practice runs, the reserve is not used to
try again, and the evaluation and the prospective journal do not start. A new candidate would need a new plan
version and a new pre-registration, not a reinterpretation of these runs.

### 1e. What it protects against, and its trade-offs

- **Never the ending balance alone:** the comparison is against the exposure-matched hold, so a run cannot win by
  being invested in a rising market, and cash sitting out a fall earns no credit by itself.
- **Costs:** every figure is after the modelled costs; the trade count gate stops a one-trade wonder.
- **Luck:** the best-5% and single-stock conditions stop one outlier trade or one stock carrying the result.
- **Hindsight:** the rule, N and the limits are written before the first practice run and cannot be changed
  after; the gate stores the protocol's hash at the first run and refuses runs if it changes.
- **Trade-offs:** the rule is strict, so "none advances" is likely on eight exploratory runs over one period; a
  real edge that is small, or one that shows only as a better return-per-drawdown ratio, will not advance.
  The owner may prefer the weaker trade-off rule (either arm) at the cost of advancing more often on noise.

---

## 2. Recommended evaluation-date rule

**In one sentence:** the historical evaluation period is **2022-01-03 to 2023-12-29** (HXR's reserved validation
period, the same ten stocks), fixed now by this rule and by the hash of the protocol that states it, used once;
2024-01-02 onwards is kept for the prospective journal's start and is never used as a historical evaluation; the
Strategy Lab's MU holdout window (2025-01-01 to 2026-06-30) is not touched by any historical run.

### 2a. The windows that exist, and their prior exposure (PLAN-DRAFT.md section 1)

| Window | What it is | Prior exposure |
|---|---|---|
| 2017-10-02 to 2021-12-31 | HXR's development period; the eight practice runs | Development data: HXR's 22 runs were seen; this plan was written after them. **Never an evaluation.** |
| 2022-01-03 to 2023-12-29 | HXR's reserved validation period on the same ten stocks | Never run by HXR (it stopped). Downloaded and readiness-checked; MU's 15-minute bars were used by the consolidation-breakout runs of 2022-2024 (a different strategy); the owner viewed and traded these stocks. **Secondary evidence, disclosed, not independent.** |
| 2024-01-02 to 2026-10-21 | HXR's reserved final period | Never run by HXR; downloaded and readiness-checked; overlaps the Strategy Lab's **untouched MU holdout (2025-01-01 to 2026-06-30)**. |

Using 2022-2023 exposes HXR's reserved validation period: any later HXR version must record that as prior
exposure (in both experiment logs). The rule accepts that cost in exchange for leaving 2024 onwards untouched.

### 2b. Fixing the dates by rule and by hash

- The dates are stated in `EVALUATION-PROTOCOL.md`'s **Date-choice rule** field before the first practice run;
  the gate stores that file's hash at the first practice run, so the dates cannot move afterwards.
- The window's start and end are HXR's `periods-hxr-v3.json` validation dates, taken from that file, not typed
  by hand, so there is nothing to tune.
- **Keep or drop MU** is decided in `EVALUATION-THRESHOLDS.md` before any historical evaluation. Under this rule
  MU can be kept: 2022-2023 does not touch its holdout window. (If the owner ever chose a window inside
  2025-01-01 to 2026-06-30, MU would have to be dropped, and the Strategy Lab's holdout would be exposed.)

### 2c. Each window once, and what contaminates it

- The historical evaluation runs **once**, on the frozen candidate, with the frozen protocol and thresholds. A
  second run on the same window, for any reason, is marked contaminated and can never pass.
- The window is contaminated for this strategy if, before the evaluation: any range-trend rule, config or
  threshold is changed after a result on that window is seen; any practice run touches it; or its prices are
  used to choose among the eight variants. Looking at the window's bars for the data readiness check (dates,
  gaps, split ratios, no rule run) does not contaminate it.
- After the evaluation, the window is development data for any later version.

### 2d. What it protects against, and its trade-offs

- **Flattering dates:** the window is one block fixed by another document's dates and by hash, chosen before any
  practice result exists; there is no choice left to make after results are seen.
- **Double use:** the development period is excluded by rule; 2024 onwards is reserved for the prospective journal.
- **The MU holdout:** untouched under this rule.
- **Trade-offs:** 2022-2023 is one two-year block with its own regime (a bear year and a rebound year); a
  strategy judged on it may behave differently elsewhere, and the result is secondary evidence at best because
  the owner's own viewing and trading, and the consolidation-breakout work on MU, overlap it. Using 2024-2026 as
  well would double the length but spend the prospective period and expose the MU holdout; this rule does not
  do that.

---

## 3. What the owner is asked to do

1. Decide N (completed trades) and the single-stock limit, or confirm the [30] and [40%] examples as choices.
2. Confirm, change or reject the pick rule of section 1 and the date rule of section 2.
3. Write the chosen rules into `EVALUATION-PROTOCOL.md`'s two fields (they can be written in the owner's own
   words; the gate only needs them set), and MU, the Tier 3 thresholds and the journal minimums into
   `EVALUATION-THRESHOLDS.md`.
4. Record the decision in `EXPERIMENT-LOG.md` as an owner entry.

Nothing here starts a run.
