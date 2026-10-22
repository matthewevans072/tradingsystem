# Data readiness on real market data — 2026-10-22

**Outcome: 7 of 17 symbols READY, 10 NOT READY, so no period is usable.**
Under the frozen rules, development and validation were **not** run. No
backtest, holdout run or forward run exists. No performance figure has been
computed or seen.

## What was done

1. **Authentication.** `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` came
   from the cloud environment and were never printed. One request for SPY,
   2024-06-03, 15Min, `feed=sip`, `adjustment=split` returned HTTP 200 with 27
   bars. The rate limit is 200 requests a minute.
2. **Feed and adjustment checks:**
   - SIP is the consolidated tape. For the same SPY session SIP shows 40.6M
     shares and IEX 0.56M (1.4%).
   - `adjustment=split` adjusts price and volume. NVDA's last bar before the
     2024 split closes at 1208.65 raw and 120.87 adjusted, with volume ×10. The
     2021 4:1 split is continuous: 18.78, then 18.73.
   - Sample coverage: all 17 symbols have 26 regular bars on 2021-07-01,
     2026-06-30 and 2026-10-21. History goes back to at least 2016.
   - Timestamps mark the bar start, in UTC.
3. **Download.** 2021-07-01 to 2026-06-30 for all 17 symbols, through the
   Lab's own fetch job: 340 stored sets and 551,592 regular-session bars in
   `data/strategy-lab.sqlite` (not in git). It took about 6 minutes.
4. **Readiness checklist** (`readiness.js`). Results are below.
5. **Independent audit.** Five read-only agents checked the gaps, the VRT
   move, the calendar, the listings, and the READY symbols (adversarial
   review). They queried Alpaca directly and searched official sources.
   Official pages (sec.gov, nyse.com, ir.theice.com) could not be opened from
   the sandbox, so those comparisons rest on search excerpts plus the Alpaca
   data itself.

## Checklist

Bars present / expected, per symbol and period:

| Symbol | Exchange | Warm-up (3,316) | Development (12,990) | Validation (6,516) | Holdout (9,662) | Status |
|---|---|---|---|---|---|---|
| NVDA | Nasdaq | 3,316 | 12,990 | 6,516 | 9,662 | READY |
| AMD | Nasdaq | 3,316 | 12,990 | 6,516 | 9,662 | READY |
| MU | Nasdaq | 3,316 | 12,990 | 6,516 | 9,662 | READY |
| MSFT | Nasdaq | 3,316 | 12,990 | 6,516 | 9,662 | READY |
| VRT | NYSE | 3,291 | 12,940 | 6,516 | 9,662 | NOT READY |
| JPM | NYSE | 3,291 | 12,965 | 6,516 | 9,662 | NOT READY |
| XOM | NYSE | 3,291 | 12,940 | 6,516 | 9,662 | NOT READY |
| JNJ | NYSE | 3,291 | 12,964 | 6,516 | 9,662 | NOT READY |
| PG | NYSE | 3,291 | 12,944 | 6,516 | 9,662 | NOT READY |
| HD | NYSE | 3,291 | 12,965 | 6,516 | 9,662 | NOT READY |
| CAT | NYSE | 3,291 | 12,943 | 6,516 | 9,662 | NOT READY |
| NEE | NYSE | 3,291 | 12,944 | 6,516 | 9,662 | NOT READY |
| FCX | NYSE | 3,291 | 12,965 | 6,516 | 9,662 | NOT READY |
| PLD | NYSE | 3,291 | 12,944 | 6,516 | 9,662 | NOT READY |
| SPY | NYSE Arca | 3,316 | 12,990 | 6,516 | 9,662 | READY |
| IWM | NYSE Arca | 3,316 | 12,990 | 6,516 | 9,662 | READY |
| GLD | NYSE Arca | 3,316 | 12,990 | 6,516 | 9,662 | READY |

Every symbol passed the timestamp, session-boundary, daylight-saving,
early-close, OHLCV and source checks. The blockers are coverage (the 10 NYSE
names) and VRT's split-scan flag. VRT's flag blocks every period from 2022
onward, which is why validation and holdout each show one NOT READY symbol.

## Findings

### 1. Missing NYSE bars: a vendor data gap at Alpaca

On four dates, Alpaca's stored history for NYSE-listed ("Tape A") stocks has
no trades between the opening and closing auction prints:

| Date | Affected | Missing |
|---|---|---|
| 2021-10-25 | all 10 NYSE symbols | 09:45–15:45 ET (only the 09:30 auction print survives) |
| 2022-01-24 | VRT, XOM, PG, CAT, NEE, PLD | 10:45–15:45 ET |
| 2022-01-26 | VRT, XOM | 15:00–15:45 ET |
| 2022-03-08 | all 10 (JNJ and CAT have no bars at all) | 09:45–15:45 ET |

Missing bars per symbol: VRT 75, XOM 75, CAT 72, PG 71, NEE 71, PLD 71,
JNJ 51, JPM 50, HD 50, FCX 50.

The evidence that this is a vendor gap, not a trading halt:

- **It is in every Alpaca dataset.** The gap is identical in 15Min and 1Min
  SIP bars, in IEX bars, in daily bars and in the trades endpoint.
- **It is not a download error.** Re-queried on 2026-10-22, the gap is still
  there.
- **The market traded normally.** Nasdaq and NYSE Arca names (MSFT, SPY, QQQ,
  DIA) are complete on all four dates. Some NYSE names traded all session,
  for example KO on 2021-10-25, and JPM, HD, FCX, GE and IBM on 2022-01-24.
  NYSE ran its opening and closing auctions on every one of these days.
- **No outage was reported.** Searches found no NYSE outage or halt on these
  dates.
- **Daily volume collapses.** For example, JPM traded 1.15M shares on
  2021-10-25, against 9.76M and 9.22M on the days either side.

The single 09:30 bar kept on 2021-10-25 and 2022-03-08 is one auction print
(O=H=L=C), not a real 15-minute bar. Any remedy should drop the whole
session.

### 2. VRT 2022-02-23: a real earnings move, not a split

The split scan flagged an overnight ratio of 0.6193 (close 19.57 → open
12.12). Vertiv reported weak Q4 2021 results and 2022 guidance before the
open that day. Public reports say the stock "fell $7.19, or 37%, to close at
$12.38". That implies a previous close of $19.57, exactly the stored value.

Vertiv has no stock split: Alpaca's corporate actions for VRT list only
dividends, and its raw and split-adjusted bars are identical.

### 3. Calendar verified for 2021–2026

`server/calendar.js` matches NYSE's published holidays and 1 p.m. early
closes exactly: 50 closures, 10 early closes and 1,254 sessions. That
includes Juneteenth from 2022, 2021-12-31 open, the 2025-01-09 Carter closure,
and 2025-12-26 open.

The data agrees: the complete symbols have bars on every calendar-open day,
none on closed days, and exactly 14 bars on early closes.

### 4. Listings verified

All 17 primary exchanges match `universe-v1.json`, from 10-K cover pages (via
search excerpts). Alpaca's auction prints confirm it independently: each
session's official open and close came from N (NYSE), P (Arca) or Q/T
(Nasdaq) as expected, across 1,334 sessions. No symbol changed listing in the
window.

### 5. Splits

NVDA's 4:1 (2021-07-20) and 10:1 (2024-06-10) splits are adjusted correctly,
in price and volume, from exactly those sessions. No other candidate appears
in the scan.

### 6. Adversarial review and challenge

**The verdicts are correct.** An independent recomputation for the 7 READY
symbols used its own hand-listed calendar and timezone handling. It matches
the checklist exactly: no gaps, duplicates, bad prices, zero volume, off-grid
or out-of-session bars, and all 20 sessions around daylight-saving changes
are complete.

**Provenance is clean.** All 551,592 rows are alpaca/sip/split, there are no
synthetic rows, and no runs or holdout runs are recorded.

**The gap finding holds up.** A second agent tried to refute it and could not.
It reproduced all four sessions on symbols and controls the first agent had
not used (NEE, PLD, HD, MMM, PFE), with raw and split adjustment, and across
SIP, IEX, 1Min, 1Day and trades. Small corrections:

- On 2022-03-08 Alpaca also lacks PLD's NYSE closing print, which strengthens
  the vendor-gap reading.
- The checklist did list 2022-01-26; only an earlier summary had omitted it.

**Three properties of the data that the checklist cannot see.** All three
need an owner decision; nothing has been changed:

1. **Single off-market prints set some bar highs and lows.** For example, MSFT
   2024-08-29 10:45 has a low of 410.60 from one 2,555-share print reported by
   FINRA's trade-reporting facility; every other trade nearby was
   421.60–421.65. These prints are on the consolidated tape (Alpaca does
   exclude odd lots), but they can trigger a simulated stop, add to ATR and
   widen a box.

   A rough scan of bars whose extreme is more than 1% beyond both neighbours
   and the bar's own body (outside the holdout) found NVDA 24, AMD 14, MU 6,
   MSFT 4 and SPY/IWM/GLD 0. Only three were checked against trades, and one
   of those was a genuine sweep. Filtering such prints would be a
   data-handling change, logged as a new version.
2. **The Nasdaq opening cross is counted twice in older 09:30 volume.** In
   2022 and early-2023 data, Alpaca's trade history shows the Nasdaq-listed
   symbols' opening cross twice (same trade id, reported as both Q and T), so
   the stored 09:30 bar volume is about 5–12% too high. In 2024 data it
   appears once.

   Prices are unaffected. The volume rule (1.5 × the 20-bar average) can flip
   on marginal 09:30 breakouts, and development and validation volume are
   slightly inconsistent with each other. The changeover date has not been
   established.
3. **The closing auction is outside the stored bars.** Closing prints are
   timestamped just after 16:00 and fall in Alpaca's dropped 16:00 bar. The
   15:45 close is therefore the last continuous trade: a median 0.4–3.8 bps
   from the official close, at most 10 bps. The auction's volume (1–45% of a
   session) is also excluded.

   This matches the frozen bar definition, `[t, t+15 min)`, and no simulated
   fill uses the 15:45 close: time exits fill at the 15:45 bar's open. It
   could still differ from TradingView or a forward-test feed if they put the
   closing cross in the last bar (unverified).

These do not change any READY verdict. They are recorded so they can be
weighed before results exist, not explained away after.

## Decision needed (nothing has been changed)

The frozen rules forbid patching another vendor's bars into a symbol (the
no-mixing rule), shortening periods silently or swapping instruments.
Options:

| Option | What | Rule impact | Cost |
|---|---|---|---|
| **A** | Report the gap to Alpaca with this evidence and ask for a backfill; re-download 2021Q4–2022Q1 for the 10 symbols with replace | none | free; timing and success unknown |
| **B** | Re-source the whole universe from another vendor (e.g. Massive/Polygon, US$79/month), then re-check that it doesn't share the gap | data-source change, logged | subscription, a new adapter, licence review |
| **C** | Pre-registered exclusion of the 4 sessions for **all 17** symbols, decided now (only readiness data has been seen) | new data/splits version + `PARAMETER-LOG.md` entry; engine and checklist support for excluded sessions | 4 of 629 warm-up + development sessions (0.6%); code and tests |
| **D** | Tolerance rule (e.g. ≥ 99.5% coverage, listed sessions excused) | loosens a frozen check; new version + log | smallest change, but could hide future gaps |

The VRT flag can be closed by recording the 2022-02-23 move as reviewed
(`reviewedOvernightMoves`). That is also an owner decision.

Separately, and only if the owner wants it: decide whether the 09:30
double-counted opening cross (finding 6.2) should be corrected for all
symbols, for example by removing duplicate trade ids. That would mean
building bars from trades, which is a new data version. Leaving it is also a
valid, documented choice.

Recommendation: start with **A**, since it is free and changes nothing. If
the owner wants to proceed without waiting, choose **C**, decided and logged
before any result exists. Replacing the 10 NYSE symbols or moving the period
dates is not recommended: it changes half the universe, and the 2022 gaps
would remain.
