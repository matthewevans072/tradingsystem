# HXR experiment log

Every HXR activity that touches data, in order. Each entry says which data
it touched and whether any result was seen. The Signal Desk HXR page shows
the same log from the `hxr_experiments` table, plus the runs made on that
machine.

| # | When (UTC) | What | Version | Data touched | Results seen? |
|---|---|---|---|---|---|
| 1 | 2026-10-22 16:00–16:30 | Step 1 capability checks (read-only): Alpaca daily-bar depth, adjustment modes, corporate actions, auction prints, quotes, news API; review of Signal Desk code; external platforms | none | Daily bars for SPY, MU, NVDA, AAPL, VRT (2016-2026, counts and a few closes); quote and news samples; the Strategy Lab database read-only (counts only) | No rule outcome; a few prices printed |
| 2 | 2026-10-22 ~17:00 | Listing checks for the owner's 9 stocks: first and latest daily bar, corporate actions (splits, name changes, dividend counts), NBIS around its 2022-2024 suspension | none | First 2 and last daily closes per stock; NBIS 2022-02-22 to 2024-10-25 daily closes and volumes | No rule outcome |
| 3 | 2026-10-22 | Pre-registration written and committed: `PREREGISTRATION.md`, `ENGINE-SPEC.md`, `universe-hxr-v1.json`, `periods-hxr-v1.json`, `criteria-hxr-v1.json`, `configs/hxr-*-0.1.0.json` | hxr-prereg-1 | none | No |
| 4 | 2026-10-22 | HXR code built and reviewed. Implementation details settled before any result (below) | hxr-prereg-1 | synthetic test data only | No |
| 5 | 2026-10-22 19:00–19:13 | Real-data check of the download and readiness code in a throwaway cloud folder (not the owner's database): Alpaca daily bars, first 15-minute bars, corporate actions and opening-quote spread samples for MU, AMZN, META, TSLA, VST, HOOD, MUU, NBIS (SPCX skipped, unconfirmed); readiness checklist; page screenshots | hxr-prereg-1 | Data counts, split overnight ratios, listing dates; the page showed no prices | No: no rule, return or comparison was computed. The folder is discarded; the official runs happen once, in the owner's database |
| 6 | 2026-10-22 | Pre-registration 2 written and committed before any code: `PREREGISTRATION-2.md`, `universe-hxr-v2.json`, `periods-hxr-v2.json`, `criteria-hxr-v2.json`, `configs/hxr-x1-0.2.0.json`, `hxr-x2-0.2.0.json`, `hxr-x3-0.2.0.json`. C1–C3 are replaced by X1 (break below a recovery point, judged at the close), X2 (normal-movement allowance below the highest close), X3 (10% give-back, owner comparison only, never selected) and one buy-back rule (a confirmed recovery point, filling only below the exit price; stay in cash after a missed rebound). Experimental defaults: decide after the close, hold through earnings, no news, US$0 commission in USD. Robustness basket R (INTC, CSCO, PYPL, SNAP), reported only. | hxr-prereg-2 | none | No |
| 7 | 2026-10-22 | GOOG (Alphabet Class C, Nasdaq) added to baskets A, B and prospective at the owner's request, before any test. History from 2016-01-04; 20-for-1 split distributed 2022-07-15, split-adjusted from 2022-07-18. Basket A is now six sleeves; G6 restated as 5 of 6 leave-one-stock-out runs (`criteria-hxr-v2.json`). | hxr-prereg-2 | none | No |
| 8 | 2026-10-22 | hxr-prereg-2 implemented after its pre-registration commit: engine `hxr-engine-2` rule types `recovery_break`, `move_allowance`, `giveback` with the shared buy-back rule; selection runs X1–X3 (only X1 and X2 can be picked), 12 neighbouring settings and the robustness list (both reported only); the evaluation adds the robustness pair (reported only). New tests: hand-checked cases, prefix invariance, a future-data test and snapshots. The test fixture's synthetic price wave was shortened (period 300 to 100 sessions) so that the test selection picks a candidate and the code after it is exercised. | hxr-prereg-2 | synthetic test data only | No |
| 9 | 2026-10-22 | Pre-registration 3 written and committed before any code (owner's work order): `PREREGISTRATION-3.md`, `universe-hxr-v3.json` (basket A of ten: INTC, CSCO, PYPL, SNAP join; techAi tags; basket R removed), `periods-hxr-v3.json` (development 2017-10-02 to 2021-12-31, validation 2022-01-03 to 2023-12-29, final 2024-01-02 to 2026-10-21 used once), `criteria-hxr-v3.json` (G6 = 9 of 10; validation gate V1-V2), `configs/v3/hxr-x1,x2,x3-0.3.0.json` (risk-sized positions from pooled cash, the planned exit distance and dollar budgets: planned loss US$150, position US$3,000, total open risk US$750, tech/AI exposure US$10,500, pause at a US$1,500 decline, resume at US$750; initial-loss rule 2.5 x typical daily move for every exit rule; proceeds never reinvested in full automatically). The fresh-entry policy after a missed rebound is left open for the owner (section 8): the configs carry `pending_owner_choice`, and nothing runs until amendment hxr-prereg-3a records the choice. | hxr-prereg-3 | none | No |
| 10 | 2026-10-22 | Amendment 3a to pre-registration 3, written and committed before any code and before any run (owner's instruction, the last change before testing): `PREREGISTRATION-3a.md`, `criteria-hxr-v3a.json`, `configs/v3/hxr-x1a,x1b,x1c,x2a,x2b,x2c-0.3.0.json` (six candidates: exit rules X1 and X2 each with fresh-entry policy A stay in cash, B fresh entry at the next recovery point above the sale price, C the same after 60 sessions out) and `hxr-x3a,x3b,x3c-0.3.0.json` (comparison only). Only the single winner goes to validation, then to final; a validation failure stops HXR; no runner-up is ever tried. Fresh entries reported apart from buy-backs. Second benchmark: the day-one positions held; every pass/fail test must beat both benchmarks. The development pick rule is left open (the owner's text kept both: most profit, or best return per unit of fall); both are implemented and `selection.pickRule` is `pending_owner_choice` until amendment 3b. The three pending-value configs of entry 9 are replaced (kept in git history). | hxr-prereg-3a | none | No |
| 11 | 2026-10-22 | hxr-prereg-3a implemented after its pre-registration commit, before any run: engine `hxr-engine-3` (pooled cash; positions sized at the decision close in alphabetical order from the planned loss and the position, open-risk, tech/AI and cash caps; the initial allocation at the last warm-up close asking for an equal share of the open-risk budget; initial-loss level L0 = entry − 2.5 × typical move on every exit rule, exit level = the higher of L0 and the rule's; the account-decline pause; fresh-entry policies A, B, C; a stock never held or whose buy lapsed enters at the next recovery point at any price), the day-one hold benchmark derived from the candidate (`holdDayOneConfig`, never a file), metrics against both benchmarks (G2–G4, V2 and the pick pass only against each; G1 on the fully invested hold), both pick rules (`selection.pickRule` stays `pending_owner_choice`: the development pick is refused until amendment 3b), the validation gate (`POST /api/hxr/validation`; run and ledger kind `validation`; store migration 2 rebuilds `hxr_runs` and `hxr_ledger` without losing rows), the final run as triples (HXR, hold, day-one hold) with ten leave-one-out runs, the winner's neighbouring settings, the configs moved from `configs/v3/` to `configs/` (content unchanged), page and tests (`tests/hxr-rules-3.test.js`: hand-checked sizing, shared budgets, initial loss, pause, policies A–C, never-held entry, day-one hold; prefix invariance, future-data and snapshot tests for every 0.3.0 config and the day-one hold; both pick rules; criteria and the validation gate against two benchmarks). Readings settled before any result: (a) the minimum position ("half the planned loss") is read against the planned loss asked for, so the initial allocation, which asks for a share of the open-risk budget, is not lapsed by rounding; (b) PREREGISTRATION-3.md §5.4 says 16 neighbour runs per candidate but enumerates prereg-2's six plus four new ones; the enumeration governs: ten per candidate, run for the winner only (3a §1), reported only; (c) a cap that does not apply (tech/AI for an untagged stock) is stored as null. Test fixture only: the synthetic prospective crash moved from MU to AMZN, the first symbol alphabetically, which the risk-sized account always sizes on day one. | hxr-prereg-3a | synthetic test data only | No |
| 12 | 2026-10-23 | Amendment 3b (the owner's choice, recorded before any run as PREREGISTRATION-3a.md section 6 provides): `selection.pickRule` in `criteria-hxr-v3a.json` changed from `pending_owner_choice` to `ending_value` (most profit: the qualifying candidate with the highest ending account value after costs that beats both benchmarks on ending value; tie to the smaller largest decline; largest decline reported). Rule (b), best return per unit of fall, is not used. No other setting changed; the file's hash in the pre-registration manifest changes accordingly. Tests moved to the chosen rule (the pending refusal is still tested through a copy of the file). | hxr-prereg-3a | none | No |

## Implementation details settled before any result (entry 4)

These were settled while the code was built and reviewed, before any HXR run
on real data. None changes a rule, number, period or criterion. Where the
pre-registration was silent or open to two readings, the more conservative
reading was taken.

1. **Half-spread without look-ahead.** A fill uses the running median of
   that year's spread samples dated **on or before** the fill. Before a
   year's first sample, the previous year's value applies; before a stock's
   first sample, the 2 bps floor. The pre-registration said "per stock and
   calendar year"; a whole-year median would have used later samples for
   earlier fills.
2. **Dividends without a pay date** are paid on the ex-date. This affects
   VST's 2019–2020 dividends in Alpaca's records, and both arms equally.
3. **Corporate actions on an excluded or closed day** apply on the next
   included session, never earlier.
4. **Average gains and losses** count completed holdings only. Holdings
   still open at the end are reported separately, marked at the last close.
5. **"At least 1.10 × the hold's" when the hold's ratio is negative** reads
   as `hold + 0.10 × |hold|`. Read literally, the bar would be lower than the
   hold itself.
6. **A gate that cannot be evaluated** (with G1 met and nothing failed)
   gives INSUFFICIENT EVIDENCE, never PASS. A contaminated run that passes
   every gate is reported as NOT COUNTED (CONTAMINATED).
7. **Unmodelled corporate actions** (spin-off, stock dividend, the stock
   being acquired) make the affected period not ready.
8. **The selection also runs every arm with first-15-minute VWAP fills.**
   They are reported only; the pick uses the base runs.
9. **The basket B full-list check** must be ready before the evaluation runs,
   unless the owner explicitly runs without it.
10. **Selection and evaluation wait for the owner's Micron decision.** "Keep"
    lets them run. "Drop" is recorded, but nothing runs until the
    pre-registration is restated for four stocks.
11. **Prospective timing.**
    - `recorded_at` is stamped just before the records are written, and
      `on_time` means recorded before the next session's open.
    - A session with a missing bar waits until the next open, then runs with
      a warning and counts as late.
    - News is linked to a decision if Signal Desk first saw it no later than
      the decision was recorded and it was created in the previous 72 hours.
12. **The frozen version's file** is `strategy/hxr/configs/hxr-1.0.0.json`.
13. **Redirects are refused** by both Alpaca clients (HXR and the Strategy
    Lab's history download), so the API keys can never be resent to another
    host.
