# ICT Lab: protocol (Part A, documents only)

**Status:** DRAFT until the Part A commit, which the owner orders separately. Nothing in this file authorizes a download, a run, or any code that reads market data. Once committed, this file is pinned by its LF-normalised SHA-256 in the lab's `config.js` (Part B) and is never edited: a change is a new version with an EXPERIMENT-LOG.md entry naming the results seen.

**What this is.** A separate, simulation-only sandbox for testing mechanical ICT-inspired hypotheses on QQQ 5-minute bars. QQQ is a labelled STAND-IN for NQ; nothing here is evidence about futures, and nothing here claims that the rules reproduce ICT's teaching or are profitable. A negative, NONE or inconclusive result is a valid, expected outcome.

**Standing rules (the owner's, 2026-11-04).** Simulation only; no broker, order, paper-trading or account code; keys only in `.env`; bars and market data never committed (licence: personal, non-commercial); separate from the owner's holdings and cash, from HXR, range-trend, sweep-bos and the Strategy Lab (own database, own file guard, own ledger); the Strategy Lab MU holdout (2025-01-01 to 2026-06-30) is never read; the sweep-bos results stay untouched in their own database. Every choice the author adds is labelled HYPOTHESIS with its origin (owner / author / standard convention) and, where it is a number, "proposed, for the owner to confirm".

## 1. Purpose and what a result can mean

Round 1 tests four strategy specifications (section 5), each as its own simulation, on the DEVELOPMENT window. A spec that passes the pre-registered criteria and bar (section 7) is a CANDIDATE and may be validated once (section 8). The words "profitable" and "edge" appear in no report unless a candidate has passed validation, and even then only as "not rejected on validation": passing means the candidate was not rejected on data it was not tuned on, nothing more. A result is evidence about this mechanisation on QQQ's regular session, not about NQ and not about the discretionary original.

## 2. Windows (the owner's, 2026-11-04)

| Window | Dates | Rule |
|---|---|---|
| DEVELOPMENT | 2018-06-01 to 2022-12-30 | the only window any run may read until the owner says otherwise; the lab's bar bound (`MAX_BAR_DATE = 2022-12-30`, enforced at every layer as in sweep-bos) |
| VALIDATION | 2023-01-03 to 2024-12-31 | never downloaded, opened or read until the owner's separate message is recorded in EXPERIMENT-LOG.md; each candidate validated once |
| RESERVED | 2025-01-01 to 2026-06-30 | never read (it is also the Strategy Lab MU holdout) |

The development window starts 2018-06-01, so no warm-up precedes it. The round-1 rules need none: structure is session-local (CONCEPTS.md H1) and the stop buffer is a fixed cent (CONCEPTS.md H14), not a 20-session median. HYPOTHESIS (author's): no warm-up requirement; proposed, for the owner to confirm.

**Prior exposure, disclosed.** The author has seen sweep-bos's round-1 figures and stage counts and its round-2 count-only pass (strategy/sweep-bos/reports/round-1.md and round-2.md; EXPERIMENT-LOG.md entries 8 to 21) for QQQ over 2019-01-02 to 2022-12-30, a window inside this lab's development window, for a related mechanisation (sweep, break of structure, pullback). Counts and figures only; no bar or price. The owner has watched these markets. None of it is independent of the owner, and this lab's development result is therefore a development result with disclosed prior exposure, not independent evidence.

## 3. Data provenance (document-only at this stage; no market data read)

Reference dataset: sweep-bos data version 1 as recorded in `strategy/sweep-bos/EXPERIMENT-LOG.md` entry 4: QQQ and SPY, 2018-06-01 to 2022-12-30, Alpaca SIP feed, raw adjustment, daily (1Day) and 5-minute (5Min) bars; full data hash `e7a619d2824847b8b94930b11ab433d414fabf2ed72afe1763d5b2990482752d`. That version's readiness counts (reports/data-readiness-v1.md, measured): 1,155 NYSE sessions per instrument in the range, QQQ 1,151 complete and 4 incomplete (8 slots missing, all in 2020).

The lab's own QQQ dataset (Part B, not now) is a different subset (one instrument) and will carry its own hash; the two hashes are not required to match. The Part B check is a per-symbol, per-bar comparison of the lab's QQQ bars against sweep-bos's QQQ bars over the same dates (timestamp, O, H, L, C, V), with any difference reported by count and date, never by price list. Bars are stored in the lab's own database and never committed.

Session and bar conventions are retained from sweep-bos PRE-REGISTRATION.md 1.2 to 1.4: a 5-minute bar with start time t (America/New_York) belongs to NYSE session d when t is 09:30, 09:35, ..., 15:55 (12:55 on an early close); its index is i = (t − 09:30) / 5 min, 0..77 (0..41 on an early close); n = 78 or 42. Pre-market, after-hours, misaligned and non-session bars are dropped and counted. A session with fewer than n stored bars is INCOMPLETE: never traded, never the prior session of a traded session. The prior session's low comes from the daily bar of the previous NYSE session (sweep-bos 3.3; the known daily-versus-5-minute differences of more than 0.01 in 57 QQQ sessions are a disclosed limitation, read with the results).

## 4. The strategy spec format

Each strategy is one JSON file in `strategy/ict-lab/specs/` (the four round-1 files were written on the owner's review of 2026-11-04 from the blocks in this section and section 5, and are listed with their LF-normalised SHA-256 in EXPERIMENT-LOG.md entry 1; they are pinned in the lab's `config.js` in Part B). A spec names its concepts, entry, stop, target in R, time window, time stop, max trades per day, account settings and cost model. Every field is read by the engine; a spec with an unknown or missing field is refused. Shared fields, identical in all four round-1 specs:

```json
{
  "version": "0.1.0",
  "round": 1,
  "instrument": "QQQ",
  "standInFor": "NQ",
  "side": "long",
  "swing": { "leftBars": 1, "rightBars": 1, "strict": true, "confirmBarOffset": 3, "scope": "session_local" },
  "sweep": { "level": "prior_session_low_daily_bar", "closeBackInside": "close_above_level", "window": { "firstBarIndex": 0, "lastBarIndex": 17 }, "invalidation": "none", "extreme": "lowest_low_from_sweep_bar" },
  "timeWindow": { "lastDecisionBarIndex": 17, "lastFillBarIndex": 17 },
  "timeStop": { "exitAtOpenOfBarIndex": "n-1" },
  "entry": { "order": "limit", "price": "zone_midpoint", "rounding": "half_cent_down", "fill": "strictly_through_at_limit", "requireEntryBelowConfirmClose": true },
  "stop": { "bufferDollars": 0.01, "minDistanceDollars": 0.40 },
  "target": { "rMultiple": 2 },
  "zones": { "minHeightDollars": 0.05 },
  "exits": { "stopFirst": true, "stopCheckedOnFillBar": true, "targetCheckedOnFillBar": false, "gapThroughStopExitsAtOpen": true },
  "maxFilledTradesPerSession": 1,
  "oneOpenPosition": true,
  "rearmAfterRefusedConfirmation": true,
  "account": { "startingCashUsd": 5000, "maxPlannedRiskFraction": 0.01, "wholeShares": true, "leverage": false, "shorting": false, "sizing": "min_risk_cash" },
  "costs": { "halfSpread": 0.01, "slippage": 0.01, "commission": 0, "perSide": 0.02, "sensitivityMultiple": 2 },
  "windows": { "development": { "start": "2018-06-01", "end": "2022-12-30" } }
}
```

The per-strategy fields (`name`, `concepts`, `setup`, `entry.zone`, `stop.anchor`) are in section 5. The concepts are defined, one by one, in CONCEPTS.md, which the spec references by name.

## 5. Round 1: the four pre-registered specs (the owner's, 2026-11-04)

Long-only. The $5,000 cash account with whole shares and no leverage cannot short, and a short side would need its own funding and execution model, so short rules are out of scope (not "zero borrow cost"). SPY is outside this round. Each spec is a separate simulation with its own $5,000. Terms in capitals are defined in CONCEPTS.md.

**Spec 1, `ict-sweep-bos-fvg-0.1.0`.** After a PRIOR-SESSION LOW is SWEPT (a bar trades below it and closes back above it, H4), require an upward BREAK OF STRUCTURE (H6) at bar k ≤ 17. The DISPLACEMENT LEG (H8) is the bars from the SWEEP EXTREME bar to k. ENTRY = the midpoint of the latest FAIR VALUE GAP (H9) in that leg, buy limit placed at the close of k, good for fills on bars k < m ≤ 17 (H15). STOP = SWEEP EXTREME − 0.01 (H14). TARGET = ENTRY + 2 × (ENTRY − STOP) (H17).

**Spec 2, `ict-sweep-bos-ob-0.1.0`.** The same sweep and break conditions. ENTRY = the midpoint of the ORDER BLOCK (H11): the last opposite-colour (bearish) bar at or before the leg's extreme bar. Stop and target as spec 1.

**Spec 3, `ict-ifvg-0.1.0`.** After a sweep, require a bar v > s (v ≤ 17) that closes fully through an opposing (bearish) FAIR VALUE GAP (H10): C[v] > the gap's upper edge. That gap becomes an INVERSION FVG (H10). ENTRY = its midpoint, buy limit placed at the close of v for its first subsequent retest from above, good for fills on bars v < m ≤ 17. STOP = min(the inverted gap's far edge, the SWEEP EXTREME) − 0.01, the far edge being the gap's lower edge once price is above it. TARGET = 2R. No break of structure is required (the owner's spec names none).

**Spec 4, `ict-breaker-0.1.0`.** After a sweep, require an opposing (bearish) ORDER BLOCK (H12) to fail as a BREAKER (H13): a bar f > s closes above the block's upper edge, accompanied by an upward BREAK OF STRUCTURE at a bar k_bos with k_bos > s (the break must come after the sweep bar; the owner's correction of 2026-11-04) and within 6 bars either side of f (H13, decision (c)). The setup is confirmed at the close of the later of the two bars, k ≤ 17. ENTRY = the failed block's midpoint, buy limit placed at that close, good for fills on bars k < m ≤ 17. STOP = min(the block's lower edge, the SWEEP EXTREME) − 0.01 (the block's far edge once price is above it). TARGET = 2R.

Common to all four (the owner's): $5,000 starting equity; planned risk at most 1% of current equity per trade ($50 at the start), a maximum, not an amount every trade must use; actual losses can exceed it through gaps and costs; setups and entries 09:30 to 11:00 America/New_York, meaning every decision bar and every fill bar has index ≤ 17 (the 10:55 bar; nothing fills at or after the bar starting 11:00); all positions closed by 15:55 (the time stop exits at the open of the session's last bar, H16); one open position; no adding, no averaging down; whole shares, no leverage, no fractional shares; the cost model of sweep-bos with the owner's numbers (section 6.3); a trade the account cannot fund is skipped and recorded.

## 6. Account, sizing and costs

6.1 **Sizing** (proposed default, the owner's formula; for the owner to confirm). At the confirmation close, with cash = the account's cash (no position is open, by the one-position rule), plannedRisk = 0.01 × cash, stopDistance = ENTRY − STOP (> 0, else no trade):

- sharesRisk = floor(plannedRisk / stopDistance);
- estimatedCosts = 2 × perSide × floor(cash / ENTRY) (HYPOTHESIS, author's: the round-trip cost of the largest share count cash could buy, which resolves the circularity between shares and costs; proposed);
- sharesCash = floor((cash − estimatedCosts) / ENTRY);
- shares = min(sharesRisk, sharesCash).

shares = 0: the trade is SKIPPED and recorded `unfunded`. shares = sharesCash < sharesRisk: the trade is flagged `cash_capped` and its actual planned risk, shares × stopDistance, is recorded beside the 1% maximum. The same limits are re-applied at the fill price if the fill price differs from ENTRY (it does not: fills are at the limit, H15).

6.2 **Account.** US$5,000 per spec at the start of the development run. Cash changes at each exit by shares × (EXIT − ENTRY − 2 × perSide). No interest, no dividends (QQQ dividends are not modelled, the same as sweep-bos; the holding period is intraday). Equity = cash whenever no position is open, so the 1% rule reads cash.

6.3 **Costs** (sweep-bos 3.11, retained with the owner's numbers). Per side perSide = 0.01 half-spread + 0.01 slippage = 0.02 per share, $0 commission. Entry paid = ENTRY + 0.02; exit received = EXIT − 0.02. R = (EXIT − ENTRY − 0.04) / stopDistance; the planned risk is the pre-cost distance. The 2× sensitivity uses perSide = 0.04 on the same fills (derived, not re-simulated). Minimum stop distance 0.40 (H14), so the round-trip cost is at most 0.10 R on any trade (HYPOTHESIS, author's; proposed).

6.4 **Feasibility note on the cash cap** (author's reasoning on general price levels, not on read bars; to be measured in Part D). QQQ traded roughly between $150 and $400 over the window, so sharesCash is roughly 12 to 33 at the start. sharesRisk exceeds that whenever stopDistance < cash / (100 × ENTRY), roughly $1.50 to $4.00; sweep-bos measured mean planned stop distances of $0.90 to $1.75 per share for its zones (reports/round-1.md section 8). Most trades will therefore be cash-capped, with an actual planned risk around 0.3% to 0.7% of equity rather than 1%. The report states the count and share of cash-capped trades and the mean actual planned risk, so the 1% rule is never reported as the risk taken.

## 7. Criteria, candidate rule and the fixed-denominator adjustment (provisional; the owner's, for the owner to confirm)

Per spec, on the development run:

- **C1** at least 100 completed trades (fills with a recorded exit; proposed minimum 100, the owner's).
- **C2** mean R after costs > 0, and the bootstrap 95% interval's lower bound > 0 (9.1).
- **C3** mean R at 2× costs > 0.
- **C4** better than the random-entry null (9.2) at one-sided p < α, where α = 0.05 / 24 ≈ 0.0021 (the fixed-denominator adjustment below).
- **C5** mean R > 0 without the best 5% of trades (9.3).
- **C6** no single calendar month holds more than 40% of the gross gains (9.4).

A spec is a CANDIDATE only when C1 to C6 all pass on QQQ on the development window. Only candidates are ever validated. There is no pick among candidates: every candidate is validated once (section 8); the dollar account's ending value never makes a candidate.

**Variant budget and the fixed denominator.** The multiple-testing denominator is fixed from the start at the full planned budget: 8 specs per round × 3 rounds = 24. Round 1 contributes 4 of the 24. α for C4 is therefore 0.05 / 24 = 0.0020833 for every spec in every round, and does not grow as specs are added; a later round with fewer than 8 specs keeps the denominator 24. The adjustment applies to C4 as the owner wrote it; C2's interval stays a 95% interval (HYPOTHESIS, author's: C2 is kept descriptive and unadjusted; proposed). With 10,000 resamples the smallest attainable p is 1 / 10,001 ≈ 0.0001, so α = 0.0021 is resolvable.

**Changes from sweep-bos section 5, stated.** C1 to C6 are retained with these changes: C4's null is the random-entry null of 9.2 (the random-direction null of sweep-bos 6.2 needs a short side, which is out of scope) and its threshold is α = 0.05 / 24 instead of 0.05; the candidate rule needs QQQ only (SPY is outside this round); the pooled-mean-R pick rule is dropped (every candidate is validated; none is picked).

## 8. Validation (once per candidate; needs the owner's separate message)

The validation window is refused by code until the owner's message authorizing it is recorded in EXPERIMENT-LOG.md as a row the gate reads and that only the owner writes (the range-trend pattern). Each candidate is validated exactly once on 2023-01-03 to 2024-12-31 with its spec unchanged (same pin). Criteria on validation (HYPOTHESIS, author's; proposed, for the owner to confirm): C2 to C6 as in section 7 with the same α, and C1 replaced by at least 40 completed trades, the development minimum scaled to the window's length (two years against four and a half). The outcome is NOT REJECTED ON VALIDATION or REJECTED. A repeat needs a stated reason, is marked `contaminated`, and can never be "not rejected".

## 9. Statistics (exact definitions)

PRNG: mulberry32 as in sweep-bos 6 (retained). Seeds (HYPOTHESIS, author's: fixed numbers; proposed): bootstrap 20261104, null 20261105.

9.1 **Bootstrap interval** (sweep-bos 6.1, retained). 10,000 resamples of the n trade R values with replacement, trades in exit order, one generator; the mean of each; sorted; lower bound the 250th smallest, upper the 9,750th.

9.2 **Random-entry null, keeping the long drift** (the owner's definition, 2026-11-04; replaces sweep-bos 6.2). For each real trade with fill bar index m, stop distance D and shares S: a pseudo-trade that enters long at the open of bar index m of a randomly chosen complete development session d' (drawn uniformly with replacement from the complete sessions of the window; the same bar index, so the same time of day), fill price O_d'[m], stop O_d'[m] − D, target O_d'[m] + 2D, exited by the same exit rule (H16: stop checked on the fill bar, target not; stop first; gap-through stop at the open; time stop at the open of bar n − 1 of d'), with the same costs; R_null = (EXIT − O_d'[m] − 0.04) / D. One resample = one random session for every real trade, independently; the mean R_null over the n pseudo-trades is recorded. At least 10,000 resamples (proposed exactly 10,000) with the fixed seed. p = (1 + the number of resampled means at or above the actual mean R) / (1 + 10,000). Reported: the null's mean, 5th, 50th, 95th and 99th percentiles (nearest rank) and p. The null keeps the long drift of QQQ at the same times of day; it tests whether the entry rule chooses sessions better than chance does, not whether QQQ rose.

9.3 **Best 5% removed** (sweep-bos 6.3, retained). K = ceil(0.05 × n), at least 1; remove the K trades with the largest R (ties: the earlier exit first); the mean of the rest.

9.4 **Monthly share of gross gains** (sweep-bos 6.4, retained). G = the sum of positive R; per calendar month of the entry session, share = (sum of positive R of trades entered that month) / G; C6 passes when the largest share ≤ 0.40 after rounding to 1e-6; G = 0 fails C2 and is reported as undefined here.

9.5 **Other figures** (sweep-bos 6.5, retained): win rate, median R, profit factor, maximum drawdown in R (largest peak-to-trough fall of cumulative R in exit order), average holding time, exposure by hour, costs per trade in R (mean of 0.04 / D).

## 10. Gate rules (what the launcher refuses; Part B code, described here so they are pre-registered)

1. PROTOCOL.md, CONCEPTS.md and the spec files match their pinned LF-normalised SHA-256; the pre-registration commit is an ancestor of HEAD and holds the pinned files.
2. The data version is complete, its hash recomputes, it holds no bar after 2022-12-30, and it was downloaded after the pre-registration commit.
3. EXPERIMENT-LOG.md has one `**Code frozen for round 1**` entry naming the current code revision, the pre-registration commit and the data hash; every recorded run, failures included, is listed as a `**Run**` entry; an unlogged run closes the gate.
4. One spec per launcher call; a spec runs once per window; the ledger (`ict_ledger`) is append-only.
5. A repeat of a spec on the same window needs a stated reason, is recorded, and is marked `repeat` (`contaminated` on validation); a fix to a rule is a new spec version with a log entry naming the results seen; a frozen spec is never edited after it has run.
6. A lock row refuses a second service instance while one is alive; a crashed run is marked failed by the next lock holder with its details kept.
7. The validation window is refused by code until the owner's authorizing message is recorded as a row the gate reads; the reserved window has no code path at all.
8. The ict-lab code (`server/ictlab/`, `strategy/ict-lab/`) has no uncommitted change (so the code that ran is in a commit); every run records the HEAD commit, the source hash, the code revision, the engine version, the spec hash and the data hash.
9. At least 1 GB free on the data volume; temp folders cleaned.

Decisions use only bars closed at decision time (sweep-bos section 2, retained). No entry ever fills on a bar before its setup is confirmed: an order placed at the close of bar k fills only on a bar m > k.

## 11. Reports (what every run report contains)

Every figure labelled measured (read from the stored run) or derived (computed from measured figures). No bar, price or per-fill price list.

- Trades: count, win rate, mean R after costs, median R, profit factor, maximum drawdown in R, average holding time, exposure by hour, costs per trade in R, mean R at 2× costs.
- The bootstrap interval (9.1), the null distribution and p (9.2), the best-5%-removed mean (9.3), the month concentration (9.4).
- The dollar account: starting and ending cash, maximum drawdown in dollars, the mean actual planned risk in dollars and as a share of equity, the count and share of `cash_capped` trades, the count of `unfunded` skips, and the count of trades whose loss exceeded the planned risk (gaps and costs).
- The funnel, per spec: sessions in the window → sessions tradeable (complete, with a complete prior session) → sessions with a sweep → setups confirmed (break / inversion / breaker) → setups with a usable zone (zone found, height ≥ 0.05, entry below the confirmation close, stop distance ≥ 0.40) → orders placed → fills; with the count and share lost at each stage, and the exit split (stop, same-bar stop, target, time).
- A **flaw section** naming the stage that loses the most, in one paragraph, with the measured share.
- C1 to C6 with pass/fail and the candidate statement; the plain outcome.
- The words "profitable" and "edge" do not appear (section 1).

## 12. Feasibility of the four specs as written (checked before writing; no bar read)

- **All four can be simulated as written** on QQQ 5-minute bars, long-only, whole shares, no leverage. No spec needs a short side, fractional shares, a substituted instrument, overnight data or anything outside the regular session.
- **The cash cap, not the 1% rule, will size most trades** (6.4). This is simulable and is reported, not hidden.
- **Sample size is the risk.** Sweep-bos measured, for the related sweep-break-pullback mechanisation on QQQ over 1,008 development sessions, 314 sessions with a sweep in 09:30 to 09:55 (both directions) and at most 59 fills in both directions under its most relaxed round-2 variant (reports/round-2.md, measured). This lab takes longs only (sweeps of the prior low; fewer than 314), but widens the sweep window to the 10:55 bar, drops the invalidation rule, and re-arms after an unfilled order; it also enters at zone midpoints, which are deeper than sweep-bos's near edges and so fill less often. The net effect is unknown before Part D. The 100-fill minimum is kept as the owner proposed; if round 1 falls short, the funnel and the flaw section say where the sample was lost, and that is the round's result.
- **Specs 3 and 4 have no sweep-bos counterpart**, so no count informs their feasibility beyond the sweep stage.
- **Costs against small stops** are bounded by the 0.40 minimum stop distance (≤ 0.10 R round trip).
- **Early-close sessions** (10 in the window) use the same 09:30 to 11:00 window and the 12:55 time stop.

## 13. Sweep-bos assumptions H1 to H15: retained, changed or dropped (the owner's requirement)

| sweep-bos | What it was | Status here | Reason |
|---|---|---|---|
| H1 | 3-bar fractal swing, strict both sides | **retained** (CONCEPTS H1: left 1, right 1) | the owner's proposed default |
| H2 | swing confirmed after 3 later bars (i + 3) | **retained** (H1) | the owner's proposed default |
| H3 | daily bias from daily swings | **dropped** | not in the owner's round-1 specs; long-only has no direction to choose |
| H4 | the level swept = prior regular session's high or low | **retained for the low only** (H3, H4) | long-only; the prior-session low from the daily bar as in sweep-bos 3.3 |
| H5 | a bar sweeping both levels counts as neither | **dropped** | moot for long-only: a bar with L < PDL and C > PDL is a sweep whatever its high does |
| H6 | the sweep extreme follows the lowest low of the leg | **retained** (H5) | needed by every stop |
| H7 | a close back beyond the level voids the setup | **dropped, with a stated reason** | it is the author's, not the source's (sweep-bos EXPERIMENT-LOG entry 20, condition 1); it voided 56% of sweeps (round-1.md section 8, measured); the owner ordered that it not be inherited without reason |
| H8 | BOS = first close above the most recent swing high confirmed before that close | **retained** (H6) | the owner's reading |
| H9 | an already-broken swing gives no BOS | **retained** (H6) | prevents repeated breaks of one level |
| H10 | stop B one cent beyond the second confirmed swing | **dropped** | no stop-B variant in round 1; the stop anchor is the sweep extreme |
| H11 | order block = last opposite-colour bar at or before the leg's extreme; FVG = latest three-bar gap in the leg | **retained** (H9, H11) | the owner's standard conventions |
| H12 | leg starts at the latest bar at the extreme; latest gap; entry must be below the BOS close | **retained** (H8, H9, H15) | the owner's spec is silent; the sweep-bos reading is kept for comparability |
| H13 | limit at the near edge, fills strictly through at the limit until the 10:25 bar; one setup per session | **changed** (H15): the limit is at the zone midpoint (the owner's), good through the 10:55 bar (the owner's 11:00), strictly-through fill retained; one *filled* trade per session, re-armed after an unfilled order (author's; owner-confirmed 2026-11-04) | the owner's entry and window; the re-arm is the author's, for the sample, confirmed by the owner |
| H14 | stop first; stop checked on the fill bar, target not; gap-through stop at the open; time stop at the last bar's open | **retained** (H16) | the owner's stop-first and 15:55; the rest kept for comparability |
| H15 | time stop, one trade per day, no re-entry, cost numbers, PDH target | **changed**: time stop, one filled trade per day and the cost numbers retained; the PDH target replaced by 2R (the owner's); the 1R minimum reward test dropped (2R is fixed) | the owner's target rule |

## 14. Decisions proposed, one default each (the owner's list (a) to (f))

| | Decision | Proposed default | Origin | Reason |
|---|---|---|---|---|
| (a) | sizing | min(floor(plannedRisk / stopDistance), floor((cash − 2 × perSide × floor(cash / ENTRY)) / ENTRY)); 0 = unfunded; cash-binding = cash_capped with actual risk recorded | owner (formula), author (the cost estimate) | the cost estimate uses the largest share count cash could buy, so shares never depends on itself |
| (b) | spec 3: eligible bearish FVGs and age | any bearish FVG completed in session d (its third bar at index ≤ 17), formed before or after the sweep bar; the inversion close must come after the sweep bar; the most recent eligible gap the inversion bar closes through; maximum age 17 bars, the session window itself, no separate limit | author | session-local structure gives the age bound for free; the sweep-then-inversion order is the owner's "after a sweep" |
| (c) | spec 4: order and bar limit | either order; the close through the block's upper edge and the upward BOS within 6 bars of each other (|f − k_bos| ≤ 6); both after the sweep bar (f > s and k_bos > s; the owner's correction of 2026-11-04); confirmed at the later close | author; owner (k_bos > s) | couples the two events to one displacement without requiring one bar; 6 bars = 30 minutes; a break before the sweep is not "after a sweep" |
| (d) | setup expiry, retest validity, cancellation | the limit is placed at the confirmation close and good for bars through index 17; cancelled unfilled at the close of bar 17 and recorded `order_expired`; the first bar that trades strictly through the limit fills it; no excursion rule (a run to 2R before the pullback does not cancel); after an expired order a new setup may confirm if still inside the window; one filled trade per session | owner (the 11:00 cutoff), author (the rest) | the 11:00 cutoff is the owner's one choice; the re-arm keeps sessions alive for the sample |
| (e) | BOS, displacement, FVG and OB boundaries, minimum zone, buffer | BOS as sweep-bos H8/H9; displacement leg = extreme bar to the break bar, no minimum size; FVG = H[a] < L[a+2] (bullish), zone [H[a], L[a+2]], bearish mirror; OB zone [L[j], H[j]]; minimum zone height 0.05; stop buffer 0.01 beyond the anchor; minimum stop distance 0.40 | standard convention (definitions), author (0.05, 0.01, 0.40) | the cent buffer replaces sweep-bos's 20-session median (needs no warm-up; the owner's new spec says only "beyond"); 0.05 excludes degenerate gaps; 0.40 bounds costs at 0.10 R |
| (f) | "closes back inside the level" | L[s] < PDL and C[s] > PDL, strict, on the sweep bar itself; PDL from the previous session's daily bar | owner (sweep-bos H4) | retained unchanged; a close exactly at PDL is not inside |

Every number above is proposed, for the owner to confirm. Owner-confirmed on 2026-11-04 (EXPERIMENT-LOG.md entry 1): session-local structure (CONCEPTS.md H2) for round 1, and the re-arm (CONCEPTS.md H15).

## 15. Parts (what exists and what does not)

| Part | Content | Status |
|---|---|---|
| A | this protocol, CONCEPTS.md, the four spec files in `specs/`, EXPERIMENT-LOG.md entry 1 | written 2026-11-04, corrected on the owner's review the same day; uncommitted until the owner's word |
| B | `server/ictlab/` (own database `data/ict-lab-sim.sqlite` with a file guard refusing every other project file; the bounded QQQ download as a logged data version; the per-bar comparison against sweep-bos data version 1; the four spec files pinned) | not authorized by this message |
| C | the engine and Tier 1 tests on synthetic data; the planted-bug harness | not authorized |
| D | round 1: the four specs on DEVELOPMENT through the gated launcher; `reports/round-1.md` | not authorized |
| E | validation of any candidate, once, after the owner's separate message | not authorized; refused by code until then |
