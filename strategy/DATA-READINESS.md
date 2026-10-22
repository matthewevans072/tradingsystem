# Data readiness — real-data checklist for universe-v1

Status as of **2026-10-22**: **no market data has been downloaded.** Every one
of the 17 symbols is **NO DATA** for every period, so **no period is usable**
and no backtest, validation or holdout result exists on real data. Nothing in
this file is a performance claim.

The strategy rules, the universe, the period splits and the acceptance
criteria are frozen (`configs/cb-1.0.0.json`, `universe-v1.json`,
`splits-v1.json`, `acceptance-v1.json`). This checklist does not change them,
does not shorten a period, does not swap an instrument and proposes no
revised dates. If data turn out to be missing, the checklist says exactly
what is missing; any change to the dates would be a new, logged splits
version decided by the owner **before** any performance is looked at.

The live checklist is computed by `server/strategy/readiness.js` and served
at `GET /api/lab/readiness` (Strategy Lab page → Data → *Data-readiness
checklist*). It is recomputed whenever the stored bars or
`corporate-actions-v1.json` change.

## How the checklist decides

For each symbol and each pre-registered period it reports six items:

| Item | Checked from | Fails (blocks) when |
|---|---|---|
| (a) Instrument and exchange | `universe-v1.json` vs the research listing in `corporate-actions-v1.json` (and a source-reported exchange, if a source reports one) | the source or an official page names a different exchange |
| (b) Coverage | stored bars vs the exchange calendar (`server/calendar.js`): expected sessions and bars, present, missing sessions (count and first dates), partial sessions (which bar times are missing), % complete | any expected bar is missing in that period |
| (c) Timestamps, timezone, session | every bar on the 15-minute grid from 09:30 ET; none before 09:30 or after the close (16:00, or 13:00 on early closes); first/last bar time per session; the sessions on both sides of every daylight-saving change | a bar is off the grid or outside the regular session, a DST-neighbour session is shifted or incomplete, or most sessions do not start with a 09:30 bar (bar-end labels or a wrong timezone) |
| (d) OHLCV | non-positive or missing prices; high below low or open/close outside the range; zero or missing volume (count and share); duplicates (identical are noted, conflicting block; conflicting duplicates the source returned at download are also counted) | any non-positive or inconsistent bar, any zero/missing volume, any conflicting duplicate |
| (e) Splits and dividends | each known split in `corporate-actions-v1.json`: the overnight ratio (first open of the first split-adjusted session / previous close) must be about 1, not about 1/ratio; mean daily volume 5 sessions after vs 5 before must be about 1, not about the ratio. An unknown-split scan lists every overnight ratio within 8% of 1/k or k for k = 1.5, 2, 3, 4, 5, 8, 10, 20. Dividend treatment cannot be proven from bars: the source's declared mode is reported as "declared by source, not independently verified" | a known split looks unadjusted (price or volume), or an unexplained split-like move exists (until the owner records it as reviewed under `reviewedOvernightMoves`) |
| (f) Sources | the source, adjustment and feed recorded with every stored bar; costs, limits, history depth, volume coverage, licence and storage terms from the research, each with a status label | bars from more than one source/adjustment/feed in the history window |

Attribution to periods: coverage problems block their own period; a bad bar
blocks the period it is in; a split problem at date D blocks every period
ending on or after D (every run starts at the warm-up, so its indicators span
D). A symbol is **READY** only if all four periods are READY, **NO DATA** if it
has no bars in the window, otherwise **NOT READY** with its reasons. **A period
is usable only if all 17 symbols are READY for it.** Facts that bars cannot
prove (listing, dividend treatment, licence) stay as labelled open items;
READY does not certify them.

## Periods (from `splits-v1.json` and the exchange calendar)

| Period | Dates | Sessions | 15-min bars per symbol | 1 p.m. early closes (14 bars) |
|---|---|---|---|---|
| Warm-up | 2021-07-01 – 2021-12-31 | 128 | 3,316 | 2021-11-26 |
| Development | 2022-01-01 – 2023-12-31 | 501 | 12,990 | 2022-11-25, 2023-07-03, 2023-11-24 |
| Validation | 2024-01-01 – 2024-12-31 | 252 | 6,516 | 2024-07-03, 2024-11-29, 2024-12-24 |
| Holdout | 2025-01-01 – 2026-06-30 | 373 | 9,662 | 2025-07-03, 2025-11-28, 2025-12-24 |
| **Total** | | **1,254** | **32,484** | |

Daylight-saving changes in the window (checked on the sessions either side):
2021-11-07, 2022-03-13, 2022-11-06, 2023-03-12, 2023-11-05, 2024-03-10,
2024-11-03, 2025-03-09, 2025-11-02, 2026-03-08.

Calendar caveat: holidays and early closes are generated from NYSE's rules
plus the 2025-01-09 closure (National Day of Mourning) and are cross-checked
against NYSE's published schedule for 2026–2027 only. The 2021–2025 session
list should be compared once with NYSE's historical holiday lists.
**Status: rule-generated, not independently verified for 2021–2025.**

## The checklist now (no data)

| Symbol | Universe exchange | Listing (research) | Corporate actions in window | Status |
|---|---|---|---|---|
| NVDA | NASDAQ | unverified | 4-for-1, first adjusted session 2021-07-20; 10-for-1, 2024-06-10 (official search summary; dates likely) | NO DATA |
| AMD | NASDAQ | unverified | none found, unverified | NO DATA |
| MU | NASDAQ | unverified | likely none (last split 2000) | NO DATA |
| MSFT | NASDAQ | unverified | none (last split 2003, official search summary) | NO DATA |
| VRT | NYSE | verified by research (2020 release) | likely none (IR news through Sept 2026) | NO DATA |
| JPM | NYSE | unverified | none found, unverified | NO DATA |
| XOM | NYSE | likely | none found, unverified | NO DATA |
| JNJ | NYSE | unverified | Kenvue split-off exchange offer 2023-08-18 (no price adjustment expected); 2024-05-17 debt-for-equity exchange (none) | NO DATA |
| PG | NYSE | likely | none found, unverified | NO DATA |
| HD | NYSE | unverified | none found, unverified | NO DATA |
| CAT | NYSE | unverified | none (last split 2005, official search summary) | NO DATA |
| NEE | NYSE | unverified | none found, unverified (4-for-1 in 2020 is before the window) | NO DATA |
| FCX | NYSE | unverified | none found, unverified | NO DATA |
| PLD | NYSE | unverified | none found, unverified | NO DATA |
| SPY | NYSE ARCA | verified by research | none found, unverified (quarterly distributions) | NO DATA |
| IWM | NYSE ARCA | likely | none found, unverified (quarterly distributions) | NO DATA |
| GLD | NYSE ARCA | verified by research | none found, unverified | NO DATA |

Every symbol is missing all 1,254 sessions (32,484 bars). Usable periods: none.

### Verification status of each item

| Item | Status | What closes it |
|---|---|---|
| Instrument/exchange | 3 verified by research (VRT, SPY, GLD), 3 likely (XOM, PG, IWM), 11 unverified | each issuer's IR "stock information" page or the vendor's reference data |
| 15-minute history for each period | **unverified for every source** | a real pull (below); the checklist then reports exact gaps |
| Timestamps, timezone, session boundaries | Signal Desk side tested (synthetic data); vendor convention unverified | a real pull: the checklist reports first/last bar times, DST sessions and early closes |
| OHLCV completeness | unknown until a pull | a real pull |
| Split adjustment | NVDA's two splits confirmed from official sources; the other 16 symbols not searched per symbol | a pull with `adjustment=split`, then the known-split check and the unknown-split scan |
| Dividend adjustment | cannot be proven from bars; Alpaca `adjustment=split` declares split-only | declared by source, not independently verified |
| Costs, limits, permitted use | from search summaries (not fetched pages), as last seen 2026-10-22 | the vendor's live pages before relying on them |
| Exchange calendar 2021–2025 | rule-generated | one comparison with NYSE's historical holiday lists |

## Sources (as last seen 2026-10-22; search summaries, not fetched pages)

**Alpaca, Basic (free) — preferred, implemented (`server/strategy/sources/alpaca.js`).**
- History since 2016 on Basic; historical SIP (consolidated, 100% of volume)
  data is free once it is **more than 15 minutes old**; `feed=sip` must be sent
  explicitly. *(official search summary)*
- `adjustment=split` adjusts price **and** volume; raw is the default.
  *(official search summary)* Forum reports describe SIP bars left unadjusted
  around a 2022 split. *(unverified — the NVDA checks test it)*
- Algo Trader Plus: US$99/month for real-time SIP. *(official search summary)*
- Rate limit about 200 requests/minute on the free plan. *(unverified, forum
  thread title)* Signal Desk backs off on HTTP 429 (Retry-After or
  exponential, up to 6 retries) and pauses the job if it persists.
- Licence: personal, non-commercial use; no redistribution of the data or
  anything derived from it. *(official search summary; the terms found are
  5–6 years old)* No storage/deletion terms found.

**Twelve Data — supported, not verified to cover the history.**
- Basic free (8 credits/minute, 800/day); Grow US$79, Pro US$229, Ultra
  US$999 per month after the March 2026 restructure. *(official search summary)*
- History depth: the US exchange page says US intraday data starts
  **2022-12-15**, which would leave 2021-07-01 to 2022-12-14 (the whole
  warm-up and most of 2022) missing on every plan; support articles say 2020.
  Full history needs Ultra or Enterprise. What Basic gets is not stated.
  *(conflicting official pages — unverified)*
- Intraday bars are unadjusted per the support FAQ (about April 2025); the
  `adjust` parameter's values and default are unverified. Signal Desk does not
  send it, so Twelve Data bars are recorded as adjustment `unknown`.
- Default real-time feed ≈ 5% of US volume; historical "100% of volume" may
  refer to end-of-day data only. Basic is labelled "internal non-display use".
- Licence: personal/internal, non-commercial; the Terms require deleting Data
  when the subscription ends (one clause: within 30 days).

**Massive (formerly Polygon) Developer — paid fallback, not implemented.**
US$79/month, 10 years, 15-minute delayed; REST bars split-adjusted by default
and never dividend-adjusted; Unix-ms bar start; extended hours included.
Starter (US$29, 5 years) would reach back only to about 2021-10-22 if the
window rolls. Personal use only. *(official search summary)*

**CSV import.** Adjustment, feed and licence depend on the file's origin;
recorded as `unknown`.

### Alpaca behaviour: documented vs unverified

| Behaviour in `sources/alpaca.js` | Basis |
|---|---|
| `adjustment=split`, `feed=sip`, history since 2016, free plan only for data >15 min old | Alpaca docs (research search summaries) |
| Endpoint `GET https://data.alpaca.markets/v2/stocks/bars`, headers `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY`, `timeframe=15Min`, `limit` ≤ 10,000, `page_token` / `next_page_token`, response `{ bars: { SYMBOL: [{ t, o, h, l, c, v, n, vw }] } }` | Alpaca API reference as known before the research; not re-checked by it |
| Timestamps are RFC-3339 UTC bar **starts** | unverified (forum examples) — every bar's format is checked; the 09:30 first-bar check catches bar-end labels |
| 15Min bars include extended-hours trades | unverified — filtered to 09:30–16:00 ET either way; dropped pre/after-hours bars are counted per bar set |
| Free-plan rate limit, Retry-After / X-RateLimit-Reset headers | unverified |
| Split-adjusted volume | documented; reliability unverified (checked at NVDA's splits) |

## Source recording and the no-mixing rule

Every stored bar now carries its `source`, `adjustment` and `feed`
(`lab_bars`, migration 2), and every download or import chunk is recorded in
`lab_bar_sets` (requested range, bars received, pages, raw bars, bars dropped
by reason, timestamp format). Within a symbol's history window
(2021-07-01 – 2026-06-30) Signal Desk refuses to mix sources, adjustments or
feeds: a download or CSV import that would mix is refused with the conflict
named, unless the owner re-downloads (`replace`), which deletes that symbol's
bars from other sources in the window when the first new chunk arrives. Bars
after the window (the forward period) are never overwritten by another
source.

## What the owner must provide

1. **A free Alpaca market-data account's API keys, in `.env` only** (never in
   chat or source control):
   `ALPACA_API_KEY_ID=…` and `ALPACA_API_SECRET_KEY=…`, then restart Signal
   Desk. Only the market-data endpoint is used; no trading API is called.
2. Run **Strategy Lab → Data → Download history** with source *Alpaca*, from
   2021-07-01 to 2026-06-30, all symbols. Then open the readiness checklist.
3. Review anything the checklist flags (missing sessions, split-like moves,
   unadjusted splits). Do not edit the splits or the universe in response;
   if a period cannot be covered, any revised dates are a new splits version
   decided and logged before performance is examined.
4. Optional, for the open items: confirm the listing exchanges on IR pages;
   decide whether to pay for a real-time consolidated feed before any forward
   test (see below).

### The exact pull that verifies coverage

**Alpaca** (what the Lab's download does): one paginated request series per
symbol per quarter (20 quarters, 340 series for 17 symbols), each

```
GET https://data.alpaca.markets/v2/stocks/bars
    ?symbols=NVDA&timeframe=15Min&adjustment=split&feed=sip&limit=10000&sort=asc
    &start=<quarter start 00:00 ET as UTC, e.g. 2021-07-01T04:00:00Z>
    &end=<quarter end 23:59:59 ET as UTC, never later than now − 16 min>
    [&page_token=<next_page_token>]
headers: APCA-API-KEY-ID, APCA-API-SECRET-KEY   (read from .env)
```

The whole window as a single series would be
`start=2021-07-01T04:00:00Z&end=2026-07-01T03:59:59Z`: 32,484 regular-session
bars per symbol if complete (4 pages of 10,000; more if extended-hours bars
are included).

**Twelve Data** (not implemented in the Lab; do this first if Twelve Data is
considered, with the key from `.env`): for each of the 17 symbols,
`GET https://api.twelvedata.com/earliest_timestamp?symbol=<SYM>&interval=15min`.
Any answer later than 2021-07-01 means the plan cannot cover the warm-up.
Then one dated `time_series` request across 2024-06-10 for NVDA with
`adjust=splits` and with `adjust=none` to learn how intraday adjustment
behaves. Credit costs of `earliest_timestamp` were not verified.

## Forward test: data feed warning

Forward testing needs a **real-time consolidated (SIP) feed**. With Alpaca's
free plan, SIP bars are available only once they are at least 15 minutes old,
so **every forward signal would expire** under the 5-minute rule
(`LAB_MAX_SIGNAL_DELAY_MIN`). Twelve Data's free real-time feed covers about
**5% of US volume**, so the volume rule would not see the volume the history
has. Options as last seen 2026-10-22 (search summaries): Alpaca Algo Trader
Plus US$99/month (real-time SIP); Massive Advanced US$199/month (real time;
Developer US$79 is 15-minute delayed); Twelve Data licensed full-market feed
(price not published). Signal Desk's forward test reads bars only through
`MARKET_DATA_PROVIDER` (Twelve Data or Finnhub) and has no Alpaca or Massive
forward adapter. The Lab's forward-test report shows this warning, keeps
forward results apart from historical runs, and records missed (expired /
no-next-bar) signals, late and missing bars, rejected setups, entry skips and
simulated execution costs per trade; with no forward run it says "not
started" with zero trades.
