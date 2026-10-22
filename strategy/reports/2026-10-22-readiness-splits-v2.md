# Data readiness after the owner's decisions (splits-v2) — 2026-10-22

**Outcome: all 17 symbols are READY for warm-up, development, validation and
holdout.** No backtest, holdout run or forward run has been made. No signal,
trade or performance figure exists. The holdout stays untouched.

## Decisions implemented (owner, 2026-10-22)

1. **Option C: excluded sessions.** 2021-10-25, 2022-01-24, 2022-01-26 and
   2022-03-08 are excluded for all 17 symbols in a new data version,
   `splits-v2.json`. It keeps every splits-v1 date, walk-forward setting and
   data requirement. `splits-v1.json` is unchanged. The exclusion stays the
   rule for splits-v2 even if Alpaca backfills these sessions later. Using a
   backfill would need a new splits version.
2. **VRT 2022-02-23** is recorded as a reviewed overnight move in
   `corporate-actions-v1.json`: an earnings drop, not a split. Before it was
   recorded, Alpaca's corporate actions for VRT (2021-07-01 to 2026-06-30) were
   re-checked: 13 cash dividends and no split, spin-off or other share action.
   Its raw and split-adjusted daily bars for 2022-02-18 to 2022-02-25 are
   identical (close 19.57, then open 12.12, 45.3M shares against 3.1M the day
   before).
3. **The Nasdaq opening-cross double count** stays as a documented limitation.
   No data was changed.

All three are logged in `PARAMETER-LOG.md`. The strategy config is unchanged:
cb-1.0.0, config hash `5167db4c…`. The data seen before these decisions was
readiness checks only.

## How the exclusion works

- Every run loads bars through one filter that removes all bars of the
  excluded sessions for every symbol, before the dataset hash, quality report,
  regimes or engine see them. That covers the Strategy Lab worker and
  `scripts/strategy-backtest.js`. Each run's details and report name the
  excluded sessions and the bars removed.
- The readiness checklist does not expect those sessions. Their stored bars
  are counted as "set aside" and are not checked. Overnight checks compare
  across them, as the engine will.
- The engine and the exchange calendar are unchanged. On an excluded day the
  engine sees no bars, so its existing data-gap rules apply. Tests in
  `tests/strategy-exclusions.test.js` confirm each case:
  - An entry due in an excluded session lapses ("no next bar").
  - A swing position whose last session is excluded closes at the last close
    before it, flagged `session_end_fallback`.
  - Any other swing position carries to the next open. A gap through the stop
    or target fills at that open.
  - The excluded day still counts towards `maxHoldSessions`.
  - The first true range after it spans two overnight gaps.
- Nothing is stored or deleted. The database is byte-identical to before
  (SHA-256 `6bd51193…cbb07`).

## Checklist (bars present / expected)

| Period | Dates | Sessions | Bars per symbol | Excluded sessions |
|---|---|---|---|---|
| Warm-up | 2021-07-01 – 2021-12-31 | 127 | 3,290 | 2021-10-25 |
| Development | 2022-01-01 – 2023-12-31 | 498 | 12,912 | 2022-01-24, 2022-01-26, 2022-03-08 |
| Validation | 2024-01-01 – 2024-12-31 | 252 | 6,516 | none |
| Holdout | 2025-01-01 – 2026-06-30 | 373 | 9,662 | none |

| Symbol | Exchange | Warm-up | Development | Validation | Holdout | Bars set aside | Status |
|---|---|---|---|---|---|---|---|
| NVDA | Nasdaq | 3,290 | 12,912 | 6,516 | 9,662 | 104 | READY |
| AMD | Nasdaq | 3,290 | 12,912 | 6,516 | 9,662 | 104 | READY |
| MU | Nasdaq | 3,290 | 12,912 | 6,516 | 9,662 | 104 | READY |
| MSFT | Nasdaq | 3,290 | 12,912 | 6,516 | 9,662 | 104 | READY |
| VRT | NYSE | 3,290 | 12,912 | 6,516 | 9,662 | 29 | READY |
| JPM | NYSE | 3,290 | 12,912 | 6,516 | 9,662 | 54 | READY |
| XOM | NYSE | 3,290 | 12,912 | 6,516 | 9,662 | 29 | READY |
| JNJ | NYSE | 3,290 | 12,912 | 6,516 | 9,662 | 53 | READY |
| PG | NYSE | 3,290 | 12,912 | 6,516 | 9,662 | 33 | READY |
| HD | NYSE | 3,290 | 12,912 | 6,516 | 9,662 | 54 | READY |
| CAT | NYSE | 3,290 | 12,912 | 6,516 | 9,662 | 32 | READY |
| NEE | NYSE | 3,290 | 12,912 | 6,516 | 9,662 | 33 | READY |
| FCX | NYSE | 3,290 | 12,912 | 6,516 | 9,662 | 54 | READY |
| PLD | NYSE | 3,290 | 12,912 | 6,516 | 9,662 | 33 | READY |
| SPY | NYSE Arca | 3,290 | 12,912 | 6,516 | 9,662 | 104 | READY |
| IWM | NYSE Arca | 3,290 | 12,912 | 6,516 | 9,662 | 104 | READY |
| GLD | NYSE Arca | 3,290 | 12,912 | 6,516 | 9,662 | 104 | READY |

Totals: 17 × 32,380 bars used + 1,132 set aside = 551,592 stored.

Every symbol passes timestamps (including all 10 daylight-saving changes),
OHLCV, adjustment and sources. NVDA's two splits pass. The only split-like
move found is VRT 2022-02-23, now listed as reviewed. Every period is usable.

## Still open (not blocking READY)

- **Listing labels.** `corporate-actions-v1.json` still carries the older
  listing labels, so the checklist shows "unverified" or "likely" for 14
  symbols. The earlier audit verified all 17 listings from 10-K excerpts and
  Alpaca's auction prints. Updating the labels needs the owner's go-ahead.
- **Dividend treatment.** It is declared by the source, not independently
  verified.
- **Known data properties.** These are listed in the earlier report and still
  hold:
  - Single off-market prints set some bar highs and lows.
  - The 09:30 opening-cross volume is double-counted in 2022 to early 2023.
    This is a documented limitation.
  - The closing auction falls outside the stored bars.
- **No readiness gate on runs.** The Lab's backtest start does not check the
  readiness checklist itself, although CLAUDE.md says a run uses only READY
  symbols. With all 17 READY this changes nothing now, but it is a missing
  guard.
- **Pine script.** It has not been compiled in TradingView.
- **Forward test.** It still needs a paid real-time consolidated feed.

## Tests

`npm test`: 272 of 272 pass. The added file is
`tests/strategy-exclusions.test.js`, with 11 tests.

## Next

The owner reviews this checklist. With the owner's go-ahead, development and
validation run in both modes under cb-1.0.0 and splits-v2, and are reported
against `acceptance-v1.json`. The holdout is not run.
