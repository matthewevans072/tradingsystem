# Range-trend evaluation thresholds

> Recorded 2026-10-28, on the owner's choice of 2026-10-27 (keep or drop MU, the Tier 3 thresholds and the
> prospective journal's minimums live here, apart from the evaluation protocol). Every value below is for the
> owner to set. **This file is frozen, with its SHA-256 hash recorded in `EXPERIMENT-LOG.md`, before any
> evaluation result is accessed.** It is never read by the practice-run gate, so the practice runs neither need
> it nor are influenced by it. **Nothing in this file authorises a run.**

## MU

**MU in the historical evaluation:** KEEP (the owner's decision of 2026-11-02: "Keep MU in this evaluation and
leave its 2025-mid-2026 holdout untouched")

The Strategy Lab's untouched MU holdout window is 2025-01-01 to 2026-06-30 (`PLAN-DRAFT.md` section 1). The
adopted evaluation window, 2022-01-03 to 2023-12-29 (`PROPOSED-RULES.md` Part B), does not touch it, and
2024-01-02 to 2026-10-21 stays unused as a reserve window, so MU stays in the ten-stock universe for the
evaluation and its holdout stays untouched. The practice runs keep basket A, HXR's ten stocks (decision 10).
The evaluation has no code path yet; it needs the owner's separate authorization.

## Tier 3 thresholds

**Tier 3 thresholds:** [OWNER TO SET]

The pass marks of the historical evaluation (`PLAN-DRAFT.md` section 7c). They are set here before any
evaluation result is accessed, never from one.

## Prospective journal minimums

**Journal minimum length:** [OWNER TO SET] (example format only: "6 months"; not a proposal)

**Journal minimum completed trades:** [OWNER TO SET] (example format only: "30"; not a proposal)

Nothing is concluded from the local simulated prospective journal before both minimums are met.

## Freezing

Before any evaluation result is accessed, this file's SHA-256 hash (of its text with line endings normalised
to LF) is recorded in `EXPERIMENT-LOG.md` together with the hashes of the candidate's config, of
`EVALUATION-PROTOCOL.md` and of the code revision. After that the file is not edited; a change would be a new
file, logged, and the evaluation would not have started under it.
