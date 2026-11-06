# news-replay: data inventory (2026-11-06; measured from the stored data, before the campaign document; no outcome computed)

Every figure is **measured** (counted in `data/news-replay.sqlite` or HXR's store on 2026-11-06), **documented** (from a provider's documentation, not verified here) or **assumption** (an experimental assumption, author-selected). The data, the news archive and every database stay local and are never committed; `SEC_CONTACT_EMAIL` is never written into any committed file.

## 1. The bounds

| Input | From | To | Note |
|---|---|---|---|
| Replay (simulated clock) | 2020-01-02 | 2021-12-31 | the order's section 3; exploratory: the heavily used development period of HXR, range-trend, the research runner, event-swing and campaigns 1 to 3 |
| Intraday bars, news, filings | 2019-12-02 | 2021-12-31 | a month of history before the replay; hard bound at download (the request), insert (CHECK constraints) and every load (SQL) |
| Daily bars, splits, dividends, spread samples | 2019-10-01 | 2021-12-31 | HXR's store, read-only by real path, bounded in SQL (the typical move needs 21 earlier closes) |
| FOMC statements | 2019-12-11 | 2021-12-15 | context for the AI planner only; no deterministic rule uses them |

**Closed windows, never touched:** range-trend evaluation and HXR validation 2022-01-03 to 2023-12-29; HXR final period and range-trend reserve 2024-01-02 to 2026-10-21 (already partly exposed by prospective journal 1's warm-up); the Strategy Lab MU holdout 2025-01-01 to 2026-06-30; the sweep-bos and ICT Lab evaluation window 2023-01-03 to 2024-12-31 (QQQ and SPY). Extending the replay needs the owner's separate message.

## 2. Sources

| Source | Provenance | Licence and access | Timestamp precision | Use |
|---|---|---|---|---|
| Alpaca 1-minute bars (SIP, raw) through `server/hxr/source.js` | consolidated tape via Alpaca | Alpaca market-data terms, the owner's existing key; private research, not redistributed | bar start to the minute, America/New_York | intraday activation, entries, the volume profile; regular session only (09:30 to the close, early closes included) |
| HXR's daily bars, splits, dividends, spread samples | Alpaca, stored by HXR | as above | session date | typical move, invalidation and time-stop closes, corporate actions, costs |
| Alpaca news (Benzinga) through the same client | third-party newswire | Alpaca and Benzinga terms; headlines and summaries stored locally, never committed | created and updated times to the second (UTC) | events; headlines for configuration DC; summaries only for the AI planner (not run) |
| SEC EDGAR filings (8-K, 10-Q, 10-K and amendments) with event-swing's parsers | the issuer | US government public records; SEC fair-access policy (a declared client with the owner's contact address from `.env`, at most 4 requests per second here) | acceptance date-time to the second, Eastern | events (a filing for the company) |
| FOMC statements | federalreserve.gov press releases | US government public record | "For release at" time on each statement (all 21 state one) | context only |

**Unsupported, stated plainly:** earnings calendars as known in advance, contemporaneous analyst expectations, and therefore pre-announcement planning and any "surprise" (no free point-in-time source; no proxy carries those labels; every plan is made after the first eligible report). Other macro releases (CPI, payrolls, GDP) with real-time vintages need ALFRED's API key or a paid feed, a new credential not requested: unsupported. Election items: no timestamped dataset assembled: unsupported.

## 3. Coverage per stock (measured)

| Stock | 1-min sessions | 1-min bars | News items stored (from, to) | Possibly revised | With a summary | 8-K (item 2.02) | 10-Q | 10-K |
|---|---|---|---|---|---|---|---|---|
| MU | 526 | 204,364 | 862 (2019-12-02, 2021-12-31) | 8 | 420 | 30 (9) + 1 8-K/A | 6 | 2 |
| AMZN | 526 | 203,536 | 4,771 (2019-12-02, 2021-12-31) | 76 | 2,572 | 21 (8) | 6 | 2 |
| META | 526 | 204,364 | 3,419 (2019-12-02, 2021-12-31) | 59 | 1,819 | 16 (8) | 6 | 2 |
| TSLA | 526 | 204,364 | 8,407 (2019-12-02, 2021-12-31) | 214 | 5,210 | 37 (16) | 6 | 2 + 2 10-K/A |
| VST | 526 | 201,877 | 103 (2020-02-11, 2021-12-02) | 1 | 36 | 25 (8) | 6 | 2 |
| GOOG | 526 | 194,136 | 2,516 (2019-12-02, 2021-12-31) | 36 | 1,256 | 23 (8) + 1 8-K/A | 6 | 2 |
| INTC | 526 | 204,364 | 1,322 (2019-12-02, 2021-12-30) | 15 | 708 | 33 (9) + 2 8-K/A | 6 | 2 |
| CSCO | 526 | 204,364 | 586 (2019-12-02, 2021-12-31) | 5 | 326 | 31 (8) | 6 | 2 |
| PYPL | 526 | 204,362 | 1,143 (2019-12-05, 2021-12-31) | 14 | 667 | 20 (10) + 1 8-K/A | 6 | 2 |
| SNAP | 526 | 203,571 | 1,161 (2019-12-02, 2021-12-31) | 16 | 614 | 18 (8) | 6 | 2 |

All stock: 20,519 distinct news items from 183 named sources; 341 filings (92 8-Ks with item 2.02); 21 FOMC statements. A full regular session has 390 1-minute bars; GOOG and VST have fewer because some minutes printed no trade (no bar is invented). META traded as FB until 2022-06-09: its news is requested under both tickers and an FB tag counts as META (the same listed company, not a predecessor). TSLA files item 2.02 also for its quarterly delivery reports (16 in the window).

**The earliest reliable overlap** of daily prices, 1-minute bars, filings and news is 2019-12-02 for every stock except VST, whose first stored news item is 2020-02-11 (its prices and filings start earlier); the replay starts on 2020-01-02 for all ten.

## 4. Items, eligibility and categories (assumptions, CAMPAIGN-1.md section 3)

- An item is about a stock if it is that company's filing, or a news item tagged with the stock and with at most three symbols in all (news with more symbols is stored but never used).
- Eligible = published plus 5 minutes, then the next 5-minute bar close of the regular session; an item published outside regular hours, or whose boundary reaches the close, becomes eligible at the next session's first bar close (09:35). An item whose eligible session is the excluded 2021-10-25 (HXR's periods file: almost no NYSE trades at Alpaca that day) becomes eligible at the next session's first bar close.
- A news item updated more than 15 minutes after its creation is possibly revised: only its headline and created time are used.
- Event categories for reporting (not for decisions): earnings 8-K (an 8-K with item 2.02), other filing, news.

## 5. The basket and its selection bias

Basket A (`strategy/hxr/universe-hxr-v3.json`): the owner's six holdings named in October 2026 (MU, AMZN, META, TSLA, VST, GOOG) and four technology stocks chosen in hindsight because they lagged (INTC, CSCO, PYPL, SNAP). A hand-picked list chosen in 2026 with retrospective selection bias: no delisted or failed company could be in it. Nothing here generalises beyond these ten stocks.

## 6. Gaps

- Alpaca's news `start` and `end` filter the updated time: an item created in the window but updated after 2021-12-31 is not returned (counted as a gap, not filled).
- News items carry no event time (occurred); filings carry their report date as occurred.
- The acceptance time of an 8-K is an upper bound on when its press release was public: an event can only be placed later than the market saw it, never earlier.
- The volume profile is approximated from 1-minute bars (each bar's volume spread evenly across its range): not true volume at price.
