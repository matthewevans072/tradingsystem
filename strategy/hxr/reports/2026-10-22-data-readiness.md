# HXR data readiness on real data (2026-10-22)

This was a check of the download and readiness code on real Alpaca data, in a
throwaway cloud folder. No rule was run, and no return, decline or
comparison was computed. The official download and every run happen once,
in the owner's own `data/hxr-sim.sqlite`.

**Result: all three backtest periods are usable** (selection, evaluation,
full-list check), with spread calibration in place.

| Stock | Sessions present / expected (from listing to 2026-10-21) | Splits checked | Dividends | First 15-min bars missing | Notes |
|---|---|---|---|---|---|
| MU | 2,712 / 2,712 | none | 21 | 0 | |
| AMZN | 2,712 / 2,712 | 20:1 on 2022-06-06: pass (overnight 0.0512) | 0 | 0 | |
| META | 2,712 / 2,712 | none | 11 | 0 | FB until 2022-06-09; the old META ETF ticker became METV, not used |
| TSLA | 2,712 / 2,712 | 5:1 on 2020-08-31 and 3:1 on 2022-08-25: pass | 0 | 0 | |
| VST | 2,372 / 2,372 | none | 31 | 1 (2020-03-16, circuit-breaker day) | 5 dividends have no pay date and are credited on the ex-date |
| HOOD | 1,310 / 1,310 | none | 0 | 1 (IPO day) | |
| MUU | 509 / 509 | 20:1 on 2026-07-15: pass | 9 distributions | 1 (launch day) | 2× leveraged fund on MU |
| NBIS | 502 / 502 | none | 0 | 0 | Yandex history and the 2022–2024 suspension ignored; data from 2024-10-21 |
| SPCX | not downloaded | | | | Waits for the owner's confirmation that SPCX = SpaceX |

Additional results:

- **No unexplained split-like overnight moves** were found, and no zero-volume
  or inconsistent bars after any listing date.
- **Spread samples:** 65 sampled opening minutes per stock with full history
  (fewer for later listings), all with usable quotes.
- **Excluded sessions:** 2021-10-25, 2022-01-24, 2022-01-26 and 2022-03-08,
  as pre-registered.

The download took about 10 minutes: 15,565 daily bars,
15,562 first 15-minute bars, 81 corporate-action records and 371
spread-sample days. No run and no ledger entry exist in that folder.
