# Range-trend evaluation protocol

> Recorded 2026-10-26, before any practice run; revised 2026-10-28 on the owner's choice of 2026-10-27 (keep or
> drop MU, the Tier 3 thresholds and the journal minimums moved to `EVALUATION-THRESHOLDS.md`). **Nothing in
> this file authorises a run.** Neither the historical evaluation nor the prospective journal may start without
> a separate instruction from the owner. The two dedicated fields below are completed by the owner **before the
> first practice run**, so that no exploratory result influences them. The candidate and this protocol are
> frozen, with their hashes, before any evaluation result is accessed.

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

**Date-choice rule:** [OWNER TO SET]

The rule for choosing the evaluation dates, written before the first practice run so that no exploratory
result influences it. Whether MU is kept or dropped before any historical evaluation is recorded in
`EVALUATION-THRESHOLDS.md`; a drop applies to the historical evaluation only, and the practice runs keep
basket A (decision 10).

## Pick rule

**Pick rule:** [OWNER TO SET]

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

Before any evaluation result is accessed, the following are recorded with their SHA-256 hashes in
`EXPERIMENT-LOG.md`:
- the chosen candidate's config;
- this file;
- `EVALUATION-THRESHOLDS.md`;
- the code revision.
