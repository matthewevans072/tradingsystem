# event-swing: data inventory (written 2026-11-06, before any event data or release text exists on this machine)

Every figure here is **measured** (counted from a stored file on 2026-11-06), **documented** (taken from a provider's own documentation, not verified here) or **expected** (what the protocol will count once the data exists). Nothing in this document comes from a strategy outcome.

## 1. The window

| Input | Usable from | Usable to | Why |
|---|---|---|---|
| Daily prices and corporate actions (Alpaca SIP raw, HXR's store) | 2016-01-04 | 2021-12-31 | measured: the first stored session; `periods-hxr-v3.json` `dataFrom`; the last session before the closed windows |
| Item 2.02 8-K filings (SEC EDGAR) | 2015-01-01 | 2021-12-31 | 2015 filings only to build the estimated dates of 2016 announcements (family A); never traded; the bound is the closed windows' start |
| Release text (the 8-K's exhibit 99) | same as its filing | 2021-12-31 | read only by the mechanical classifier (CAMPAIGN-1.md section 4) |

From 2022-01-03 every session of these ten stocks lies in a protected window (section 6). No bar, filing or document dated after 2021-12-31 has a code path in event-swing.

## 2. Prices: the approved source (measured)

Alpaca market data (`https://data.alpaca.markets`), SIP feed, raw prices; splits and dividends applied by the engine from Alpaca's corporate-actions records; stored in `data/hxr-sim.sqlite` by HXR and read here read-only by real path. Licence: Alpaca's market-data terms, for the owner's private research; nothing is redistributed or committed. Precision: one bar per NYSE session per stock (America/New_York session dates); open, high, low, close, volume.

| Stock | Listed from (universe file) | First stored session | Last stored session (≤ 2021-12-31) | Sessions | Corporate actions to 2021-12-31 |
|---|---|---|---|---|---|
| MU | 2016-01-04 | 2016-01-04 | 2021-12-31 | 1,511 | 2 cash dividends (from 2021-09-30) |
| AMZN | 2016-01-04 | 2016-01-04 | 2021-12-31 | 1,511 | none (its 20-for-1 split is 2022) |
| META | 2016-01-04 | 2016-01-04 | 2021-12-31 | 1,511 | none (traded as FB until 2022-06-09) |
| TSLA | 2016-01-04 | 2016-01-04 | 2021-12-31 | 1,511 | 5-for-1 split 2020-08-31 |
| VST | 2017-05-10 | 2017-05-10 | 2021-12-31 | 1,171 | 12 cash dividends (from 2019-03-14) |
| GOOG | 2016-01-04 | 2016-01-04 | 2021-12-31 | 1,511 | none (its 20-for-1 split is 2022) |
| INTC | 2016-01-04 | 2016-01-04 | 2021-12-31 | 1,511 | 24 cash dividends |
| CSCO | 2016-01-04 | 2016-01-04 | 2021-12-31 | 1,511 | 24 cash dividends |
| PYPL | 2016-01-04 | 2016-01-04 | 2021-12-31 | 1,511 | none |
| SNAP | 2017-03-02 | 2017-03-02 | 2021-12-31 | 1,219 | none |

Spread samples (the cost calibration's input): 6 per stock per year on or before 2021-12-31 from each stock's listing year (SNAP 4 in 2017, VST 3 in 2017), measured. One session (2021-10-25) is excluded for every stock by `periods-hxr-v3.json` (Alpaca has almost no NYSE trades that day; affects VST).

## 3. Event sources researched

| Source | Provenance | Licence and access | Timestamp precision | Gaps and cautions | Use |
|---|---|---|---|---|---|
| **SEC EDGAR 8-K, item 2.02** (primary) | furnished by the issuer to the SEC | US government public records; SEC fair-access policy: automated requests must declare a user agent with company-specific contact information, at most 10 requests per second (documented; the 403 of 2026-11-06 confirms the first part) | acceptance date-time to the second, Eastern time; "Date of Report" (the date of the earliest event reported, normally the press release's date); filing date | the press release usually reaches the market before the 8-K is accepted, sometimes a day or more earlier, so acceptance is an **upper bound** on when the news was public; filings accepted after 17:30 carry the next business day's filing date; 8-K/A amendments; some issuers furnish item 2.02 for mid-quarter updates or furnish two filings for one quarter | **blocked until `SEC_CONTACT_EMAIL` is set in `.env`** |
| EDGAR exhibit 99 (the earnings press release attached to the 8-K) | the issuer's own release as furnished | as above | the filing's acceptance | not structured data; read only by the fixed word rule; never read by a person or a language model for classification | guidance class (CAMPAIGN-1.md section 4) |
| Alpaca news (Benzinga) | third-party newswire on the approved host | Alpaca and Benzinga terms; no redistribution | created and updated times to the second (documented) | coverage from 2015 (documented, not verified); mixes previews, analyst notes and summaries written after the event, which the order rules out for classifying what was known earlier; would need checking against EDGAR, which is unavailable | **not used** |
| Historical earnings calendars as known before the event | commercial providers (for example Wall Street Horizon) | paid; not purchased | varies | free calendars (Finnhub, Twelve Data, exchange sites) show realised dates, which would be look-ahead for a pre-announcement exit | **unsupported**; family A uses the estimate of CAMPAIGN-1.md section 3.4 instead |
| Contemporaneous consensus expectations | I/B/E/S, FactSet, Zacks and similar | paid; free sources give current or revised estimates | — | today's consensus is not historical consensus | **unsupported**: no "results versus expectations" category exists |
| Reported results (structured) | EDGAR XBRL company facts | public | the 10-Q or 10-K's filing, weeks after the release | later filings can restate figures; the release itself is not tagged | **unsupported** as information available at the announcement |
| Elections and policy announcements | — | — | — | no reproducible timestamped dataset assembled; one recent election is not a sample | **separate future family; unsupported** |

**Registrants (pinned in `server/eventswing/config.js`; a predecessor is never used):** MU 723125 (Micron Technology), AMZN 1018724 (Amazon.com), META 1326801 (Facebook, Inc., renamed Meta Platforms on 2021-10-28; same registrant), TSLA 1318605 (Tesla), VST 1692819 (Vistra Energy, now Vistra Corp.), GOOG 1652044 (Alphabet Inc., the registrant from 2015-10-02; Google Inc.'s earlier filings are a predecessor's and are never used), INTC 50863 (Intel), CSCO 858877 (Cisco Systems), PYPL 1633917 (PayPal Holdings, independent from 2015-07-20; eBay's earlier filings are never used), SNAP 1564408 (Snap Inc., listed 2017-03-02). The downloader checks each feed's company name against the pinned name before storing anything.

## 4. The basket and its selection bias

Basket A of `strategy/hxr/universe-hxr-v3.json`: "the owner's six (MU, AMZN, META, TSLA, VST, GOOG) plus four technology stocks chosen with hindsight because they lagged (INTC, CSCO, PYPL, SNAP), so the hold benchmark is deliberately weaker; neither half is a random sample" (quoted from the file). The six were named in October 2026 as current holdings, so they are survivors that the owner chose knowing how they had done; the four laggards were chosen knowing they had lagged. No stock was delisted, acquired or bankrupt in the window, because none could be: the basket was picked from stocks trading in 2026. Every result is therefore specific to this hand-picked basket; nothing here says anything about a broader universe, which would be a separate experiment with historical membership, delisted stocks and its own benchmarks.

## 5. Expected event categories (counted when the data exists; nothing counted yet)

Per stock, and in total, before any configuration runs (recorded in `EXPERIMENT-LOG.md` as the `**Event inventory**` entry): item 2.02 filings and events after grouping; events excluded and why (before listing, no pre-event bar, no availability session in the window, amendment only); release-time class (before the open, during the session, after the close, filed after its report date, unknown); reaction class (≤ −5%, ≥ +5%, between); guidance class (raised, lowered, reaffirmed, mixed, none detected, no release text); estimate status for family A (matched within 30 days, unmatched, no prior same-quarter event by the same registrant); and the triggers of each configuration. **Any category with fewer than 20 events is descriptive only**: its configurations run and are reported, carry no inferential test and cannot be a candidate.

## 6. Closed windows and access conflicts (listed, not overridden)

1. **2022-01-03 onward is closed for these stocks:** HXR validation = the range-trend evaluation window (2022-01-03 to 2023-12-29); HXR final = the range-trend reserve (2024-01-02 to 2026-10-21); the Strategy Lab holdout (2025-01-01 to 2026-06-30, MU); prospective journal 1 (its warm-up from 2026-01-22 and live sessions from 2026-11-06). event-swing stops at 2021-12-31 at every layer (download, store, loader, engine).
2. **EDGAR lists every date.** The company 8-K feed is requested with EDGAR's own date bound (`dateb=20211231`), so no later filing's metadata reaches this machine; no document of a filing accepted after 2021-12-31 is requested; the store refuses any such row.
3. **Campaign 3's cost calibration** (`e80c8ea1...`) is built from all of HXR's spread samples, including 2026 samples inside the closed windows (recorded for the prospective journal as decision D2 (i)). event-swing copies campaign 3's cost **method** and builds the same per-stock, per-year table from samples dated on or before 2021-12-31 only. A fill's cost uses only samples dated on or before the fill (`server/hxr/data.js` `halfSpreadFn`), so every fill in this window costs exactly what it would under campaign 3's table; the hash differs because the table holds no later sample. A synthetic test checks the equality.
4. **The prospective journal's pinned files.** event-swing imports some of them (HXR's data, store and config; range-trend's engine sizing, metrics and benchmark; the research runner's helpers) and edits none, so the journal's hash check stays valid. For the same reason event-swing does not run through the research runner (`server/research/runner.js` is pinned): it has its own worker, store and queue, shown on the Research page.
5. **SEC access** needs the owner's contact address in `.env`; the assistant does not supply it (EXPERIMENT-LOG.md entry 2).

## 7. Prior exposure of each period (inventory)

| Period | Who has used these bars before | Status for event-swing |
|---|---|---|
| 2016-01-04 to 2017-09-29 | HXR, range-trend and the research runner computed indicators on it as warm-up (no trade decided or filled there); the owner's memory and the assistant's training data cover it | exploratory (no programme traded it, but it is not unseen) |
| 2017-10-02 to 2021-12-31 | HXR development pick (22 runs), range-trend practice runs (8), research runner campaigns 1 to 3 (3 + 94 + 24 runs): 151 runs and 128 distinct rule-sets on HXR's data hash `bb76c910...`; three read-only reproductions by the prospective journal (no new rule-set); the Strategy Lab's MU 15-minute bars from 2021-07-01; the owner's memory and the assistant's training data | exploratory: heavily examined |
| Item 2.02 events and release texts, 2015 to 2021 | no programme has used them | new to the project, but the outcomes of these announcements are public history the assistant's training data contains; the classifier is a fixed word rule so that no model judgement enters |

Every event-swing result is therefore a **development result on previously examined prices**, exploratory, never evidence of future profit.
