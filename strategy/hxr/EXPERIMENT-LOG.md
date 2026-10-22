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
