# Range-trend evaluation protocol

> Recorded 2026-10-26, before any practice run. **Nothing in this file authorises a run.** Neither the
> historical evaluation nor the prospective journal may start without a separate instruction from the owner.
> The fields marked [OWNER TO SET] are completed by the owner **before the first practice run**, so that no
> exploratory result influences them. The candidate and this protocol are frozen, with their hashes, before any
> evaluation result is accessed.

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

[OWNER TO SET] (before the first practice run)

## Pick rule

**Pick rule:** [OWNER TO SET]

It must be written before the first practice run and may never be the ending balance alone. The code refuses
practice runs while this line still says [OWNER TO SET].

## Tier 3 thresholds

[OWNER TO SET], including the prospective journal's minimum length and completed-trade count before anything is
concluded (for example [6 months and 30 completed trades]).

## Freezing

Before any evaluation result is accessed, the following are recorded with their SHA-256 hashes in
`EXPERIMENT-LOG.md`:
- the chosen candidate's config;
- this file;
- the code revision.
