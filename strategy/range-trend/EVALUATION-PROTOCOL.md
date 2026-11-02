# Range-trend evaluation protocol

> Recorded 2026-10-26, before any practice run; revised 2026-10-28 on the owner's choice of 2026-10-27 (keep or
> drop MU, the Tier 3 thresholds and the journal minimums moved to `EVALUATION-THRESHOLDS.md`). **Nothing in
> this file authorises a run.** Neither the historical evaluation nor the prospective journal may start without
> a separate instruction from the owner. The two dedicated fields below are completed by the owner **before the
> first practice run**, so that no exploratory result influences them. **This file is frozen at the first
> practice run** (the code stores its hash then, and that hash is final for the practice runs). Before any
> evaluation result is accessed, that same hash is recorded in `EXPERIMENT-LOG.md` with the candidate's, the
> thresholds file's and the code revision's: a record of the frozen state, not a new freeze.

## Evaluation choice

**Choice:** C. The owner chose this on 2026-10-26. It has two parts:
1. **One historical evaluation run**, with **all** the prior-exposure disclosures of `PLAN-DRAFT.md` section 1:
   - the consolidation-breakout runs of 2022-2024 and its holdout window;
   - HXR's downloads, readiness checks and printed prices;
   - **HXR's reserved periods** on the same ten stocks: validation 2022-01-03 to 2023-12-29 and final
     2024-01-02 to 2026-10-21, neither run because HXR stopped;
   - the owner's own viewing and trading of these stocks;
   - anything unknown (for example TradingView use).

   It is a secondary evaluation, not independent evidence. If it covers HXR's reserved periods, any later HXR
   version records that as prior exposure here and in `strategy/hxr/EXPERIMENT-LOG.md`.
2. **A local simulated prospective journal** (no broker account, no orders, no paper-trading API) from a start
   date onwards.

## How the evaluation dates are chosen

**Date-choice rule:** PROPOSED-RULES.md Part B, adopted by the owner 2026-11-02 (sha256 6c9e467b686495ed834ad9a88cc00c2fccb050be62e6c2abc7e24fb40c29288d): the historical evaluation window is 2022-01-03 to 2023-12-29, periods-hxr-v3.json's validation dates, fixed before the first practice run and by this file's hash, used once, after the pick rule has produced a candidate and the owner's separate authorization; MU stays in the ten-stock universe (EVALUATION-THRESHOLDS.md: KEEP); 2024-01-02 to 2026-10-21 stays unused as a reserve window, which keeps the Strategy Lab's MU holdout (2025-01-01 to 2026-06-30) untouched; the prospective journal runs on future sessions after the owner starts it and is not tied to 2024-2026 data; any later HXR version records the 2022-2023 exposure in both experiment logs; the window is secondary evidence with disclosed prior exposure, not independent evidence.

The rule for choosing the evaluation dates, written before the first practice run so that no exploratory
result influences it. Whether MU is kept or dropped before any historical evaluation is recorded in
`EVALUATION-THRESHOLDS.md`; a drop applies to the historical evaluation only, and the practice runs keep
basket A (decision 10).

## Pick rule

**Pick rule:** PROPOSED-RULES.md Part A, adopted by the owner 2026-11-02 (sha256 6c9e467b686495ed834ad9a88cc00c2fccb050be62e6c2abc7e24fb40c29288d): a run is qualified with at least 30 completed trades (closed trades with a recorded exit; split_no_whole_share counts; positions open at the end do not), recorded by the gate with no benchmark or metrics error, and a single-stock gross-gain share max(0,P(s))/G at most 0.40 compared in integer cents (P(s) = the sum of the stock's outcomes, completed trades' pnlTotal plus open positions at the last close; G = the sum of max(0,P(s)); losses never subtracted; G = 0 disqualifies; the net share is information only). A qualified variant passes only if, against its own exposure-matched hold (c): annualised return after costs strictly above (c)'s, maximum drawdown at most (c)'s, and the best-5% stress holds (K = ceil(0.05 x n), at least 1, outcomes with the highest P/L removed, ties by earlier entry date then symbol then trade id; adjustedNetPL above zero and (startingCash + adjustedNetPL)/startingCash to the power 1/years minus 1 above (c)'s annualised return, with the run's own years; a stress calculation, not a re-simulation). Return per unit of drawdown alone never advances a variant. Score = annualised return minus (c)'s. T0 = the passing variants with score at least top minus 0.005: one is chosen; else T1 = those in T0 with maximum drawdown at most the smallest plus 0.005: one is chosen; else T2 = those in T1 with the most completed trades: one is chosen; else NONE advances (values rounded to 1e-6 before comparing; no chaining). NONE also when no run qualifies or none passes; then the reserve is not used again, the evaluation and the prospective journal do not start, and a new candidate needs a new plan version. One variant across both families; the code's pickRuleReport is a report, never an automatic choice.

The rule that chooses the candidate from the practice runs. It must be written before the first practice run
and may never be the ending balance alone.

## How the code reads this file

- The practice-run gate reads the two dedicated fields, the lines beginning `**Date-choice rule:**` and
  `**Pick rule:**`, outside code fences and HTML comments only. It refuses practice runs while either field is
  unset (empty, or containing the owner marker, an opening square bracket followed by the word OWNER, or TBD,
  TODO or a question mark), while the owner marker remains anywhere in this file, or while a field appears more
  than once.
- The hash of this file (its text with line endings normalised to LF) is stored at the first practice run and
  is **final for the practice runs**: a later change refuses further runs until the file is restored to the
  frozen text. No new version of this file reopens the practice runs.
- `EVALUATION-THRESHOLDS.md` is never read by the practice-run gate.

## Freezing

This file is frozen at the first practice run: its SHA-256 hash (text with line endings normalised to LF) is
stored in the results database then and is final for the practice runs. Before any evaluation result is
accessed, the following are recorded with their SHA-256 hashes in `EXPERIMENT-LOG.md` (`PLAN-DRAFT.md`
section 8a describes the same moment):
- the chosen candidate's config;
- this file (the hash stored at the first practice run);
- `EVALUATION-THRESHOLDS.md`;
- the code revision.
