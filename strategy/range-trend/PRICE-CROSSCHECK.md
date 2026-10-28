# Optional manual price cross-check against Yahoo Finance

> A procedure the owner does by hand, when they wish. **Nothing in the simulation reads Yahoo Finance**, and no
> code calls it: the HXR page only shows a plain link to each stock's Yahoo Finance quote page as an external
> reference. Alpaca stays the sole price source of the simulation. Yahoo's terms of use are not reviewed here,
> and no automated use of Yahoo is made or planned.

## What the simulation prices are

- The daily bars stored for the simulation (`data/hxr-sim.sqlite`, downloaded by the HXR page from Alpaca) are
  **raw, split-unadjusted** daily bars: each close is the price traded that day, in that day's share units.
- The engine applies splits itself on their effective session (PLAN-DRAFT.md section 6b): prices before a
  split are kept in their own units in the stored data, and only the engine's state moves to post-split units.
- Sessions are NYSE sessions in US Eastern time; HXR's excluded sessions (`strategy/hxr/periods-hxr-v3.json`)
  are absent from every run.

## What Yahoo's columns are

- **Close** on Yahoo is adjusted for **splits** (all splits up to the day you look, applied backwards) but
  **not for dividends**.
- **Adj Close** on Yahoo is adjusted for splits **and** dividends (the dividend adjustment lowers every earlier
  price by each later dividend's ratio).
- So a raw Alpaca close equals Yahoo's **Close** only on days after a stock's last split; before a split,
  Yahoo's Close is the raw close divided by every later split ratio. **Adj Close never equals a raw close on a
  stock that paid a dividend after that day.** Compare like with like: raw close against Yahoo Close, with the
  split ratio put back where a later split exists; never against Adj Close.

## How to compare

1. Pick the same trading dates. Use the session date as the simulation records it (US Eastern); a bar dated
   2020-08-31 is that NYSE session. Do not shift dates by time zone.
2. Compare the same session's close, not the open, high or low (Yahoo's open and intraday values come from a
   different consolidation than Alpaca's SIP bars and differ more often).
3. For a day before a later split, multiply Yahoo's Close by the product of the later split ratios (for example
   a TSLA close before 2020-08-31 is Yahoo's Close × 15, since Yahoo divides by 5 for the 2020 split and by 3
   for the 2022 split; between 2020-08-31 and 2022-08-25 it is Yahoo's Close × 3).
4. Note any difference. Differences of a few cents on a few days are normal (late prints, consolidated versus
   primary-listing closes, rounding); they do not invalidate a run.
5. **A systematic gap on days that are not split days** (a constant ratio, a shift by one session, a run of
   large differences) is reported to the owner and recorded in `EXPERIMENT-LOG.md`. **Nothing is changed
   without a new data version**: the stored bars are not edited, and a different data set would be a new
   download under its own data hash, logged before any run uses it.

## Splits in and around the development period (basket A, 2017-10-02 to 2021-12-31)

From the repository (`strategy/hxr/universe-hxr-v3.json` and the HXR records); the authoritative list for the
stored data is the corporate-actions table in `data/hxr-sim.sqlite`, shown by the HXR page's readiness
checklist ("Split checks"), which was not opened for this note:

| Stock | Split | Effect on the development period's closes |
|---|---|---|
| TSLA | 5-for-1, effective 2020-08-31 | Raw closes before 2020-08-31 are 5 × the post-split units of that day; Yahoo's Close divides them by 5 (and by 3 again for the 2022-08-25 3-for-1 split, outside the period) |
| TSLA | 3-for-1, effective 2022-08-25 (after the period) | Yahoo's Close for every development-period day is divided by 3 for it; raw closes are not |
| AMZN | 20-for-1, effective 2022-06-06 (after the period) | Yahoo's Close for every development-period day is divided by 20; raw closes are about US$1,000 to US$3,700 |
| GOOG | 20-for-1, distributed after the close on 2022-07-15, trading split-adjusted from 2022-07-18 (after the period) | Yahoo's Close for every development-period day is divided by 20; raw closes are about US$1,000 to US$3,000 |
| MU, META, VST, INTC, CSCO, PYPL, SNAP | none recorded in the repository for 2016 onwards | Raw and Yahoo Close should agree, up to a few cents, on every development-period day |

The last row is what the repository shows; the corporate-actions table decides. Where raw and adjusted closes
differ because of a split, the difference is the split ratio, not a data error.

## What a cross-check can and cannot show

- It can show a wrong or missing session, a bar in the wrong units, or a stock whose stored prices do not
  belong to it.
- It cannot validate the simulation's results, costs, spreads or corporate-action handling, and it is not part
  of any run's readiness check. The readiness checklist (`strategy/hxr/DATA-READINESS.md`) stays the gate.
