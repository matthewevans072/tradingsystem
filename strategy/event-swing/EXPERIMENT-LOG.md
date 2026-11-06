# event-swing: experiment log (append-only)

Entries are headed `## <number> | <date> | <title>` and run until the next heading. Entries are never edited or removed; a correction is a new entry. Text inside code fences or HTML comments is not read by the campaign gate (`server/eventswing/config.js` `logStatus`). The gate looks for one `**Event inventory**` entry and one `**Code frozen for campaign 1**` entry naming the current `CODE_REVISION`, the pre-registration commit and the data manifest hash, and for every recorded run as `**Run** run id: N, config: <id>, config hash: <64 hex>, status: done|failed`.

## 1 | 2026-11-06 | **The owner's work order: build and backtest event-swing** (the owner's message, verbatim, under its real date; simulation only)

> Change the research direction to event-driven swing trading. Build and backtest a separate programme, working name `event-swing`.
>
> My trading hypothesis: earnings, guidance and policy developments can change a company's outlook and create opportunities before or after an announcement. Price action helps time the trade; it is not the only input.
>
> This is a hypothesis to test, not an instruction to assume that earnings cause declines, one political party causes crashes, or buying every selloff works.
>
> AUTHORISATION
> Carry out the data inventory, protocol, implementation, synthetic tests and one bounded development campaign. Do not stop for approval between routine implementation steps or individual experiments.
> Simulation only. No real capital, broker integration or live orders. Preserve HXR, range-trend, sweep-bos, ICT Lab and all existing research results. Do not modify or activate the M1 prospective journal as part of this work.
> Existing protected evaluation and reserve windows remain closed. List any access conflict instead of silently overriding it. Do not purchase data or subscriptions without approval. No broad review cycle.
>
> 1. HISTORICAL DATA AND COVERAGE
>
> Find the longest usable historical overlap between:
> * Daily prices and corporate actions.
> * Earnings announcement dates and release times.
> * Historical earnings calendars as known before the event, where testing pre-announcement decisions.
> * Reported results, contemporaneous expectations and company guidance where available.
> * Original timestamped company releases or filings.
>
> Use the existing approved price source. Research permitted sources for event information; document provenance, licensing, timestamp precision and gaps. Do not substitute price providers silently.
> Prefer SEC EDGAR 8-K filings (item 2.02, Results of Operations and Financial Condition) with their acceptance timestamps as the primary source for announcement dates and times. Document any other event source against them, with the cases where they disagree.
>
> Start with the existing ten-stock basket for comparison. Report its retrospective selection bias and each stock's actual listing and coverage dates. Never extend a stock before listing or silently substitute a predecessor.
> A broader universe is a separate experiment requiring historical membership, delisted-stock handling and its own benchmarks. Do not claim broader generality from this hand-picked basket.
>
> Use the earliest reliable data available, not an arbitrary start year. No forward filling of missing events or fabricated expectations.
>
> Do not use:
> * Today's analyst consensus as historical consensus.
> * Revised figures as though available at the announcement.
> * Later news summaries to classify what traders knew earlier.
> * Eventually realised announcement dates to simulate a calendar known beforehand unless that availability is established.
> * A language model to read or classify historical releases, guidance or news: its training data already knows what happened afterwards, which is look-ahead.
>
> If release time is unknown, use a documented conservative execution delay. If an input is unavailable, mark the affected strategy unsupported rather than inventing a proxy with the same label.
> Continue with supported families when another family lacks data. If none is feasible, stop with the specific data blocker.
>
> Before running anything, report the number of usable events per stock and per category (and per family once classified). Any category with fewer than 20 events is reported as descriptive only.
>
> 2. STRATEGY FAMILIES
>
> Create a compact first-round matrix covering these mechanisms:
>
> A. Pre-earnings risk management
> Compare holding through an announcement with exiting beforehand and re-entering under a fixed rule. Test whether avoiding announcement risk improves results after costs and missed upside.
> If the announcement date as known beforehand cannot be established, the pre-announcement exit uses a date known in advance (for example, the prior same-quarter announcement date plus a fixed offset, labelled as an estimate), never the realised date. Report how often that estimate missed the actual date and what the missed cases did.
>
> B. Post-earnings recovery
> Buy a defined recovery after a negative price reaction. Where contemporaneous guidance exists, compare unchanged/improved guidance with deteriorating guidance. Do not assume the decline is temporary.
>
> C. Positive earnings continuation
> Test whether favourable earnings information followed by a positive market response supports a continued swing move.
>
> D. Negative-news avoidance
> Test whether avoiding or delaying entries after reduced guidance or adverse earnings information improves the same underlying entry strategy.
>
> Any guidance or sentiment classification uses a mechanical rule written in CAMPAIGN-1.md before any release text is read (for example, explicit words in the original release, with the exact word lists), applied by code without judgement. If no such rule can be fixed in advance, the family or split that needs it is unsupported.
>
> Use matched price-only versions to measure whether the event information adds value. If a family uses only announcement timing and prices, label it "event-calendar strategy," not a news-understanding strategy.
>
> Treat elections and policy announcements as a separate future family unless a reproducible timestamped event dataset and adequate sample already exist. Do not generalise from the November 2026 election or create historical scenario plans using outcomes already known.
>
> 3. EXACT RULES BEFORE RESULTS
>
> Write `strategy/event-swing/CAMPAIGN-1.md` before running strategy outcomes.
>
> For every configuration specify:
> * Inputs and when each becomes available.
> * Exact event classification.
> * Entry, exit, maximum holding period and invalidation conditions.
> * Treatment of overnight announcements, unknown timestamps, holidays and gaps.
> * Whether a stop is an actual simulated exit or only a sizing reference.
> * Re-entry, overlapping events and multiple signals on the same stock.
> * Shared-cash allocation and simultaneous-signal priority.
> * Missing-data handling.
>
> Propose and freeze numerical settings as author-selected experimental assumptions, not as my established trading preferences. You may choose reasonable implementation settings without another approval round; explain them before observing results.
>
> Long-only, whole shares, no leverage initially. Use $15,000 per independent configuration and the existing Campaign 3 common portfolio limits and cost assumptions, copied explicitly and checked for compatibility. Recheck cash and sizing at simulated fills.
>
> An event known only after the close cannot receive that day's closing fill. No signal may use information published after its decision timestamp.
>
> 4. BUDGET AND CHRONOLOGY
>
> Maximum 24 unique configurations, including family baselines and price-only controls. No discretionary combinations added after results are seen.
> Allow up to six replacement attempts solely for verified defects. Preserve invalidated results, explain the defect and count every attempt.
> Separate implementation time from execution time. Cap campaign execution at two hours, checkpointing if incomplete.
>
> Before running:
> * Record the complete matrix and hypotheses.
> * Inventory prior exposure to each period.
> * Freeze configurations, source revision, data manifests and hashes.
> * Fix chronological reporting blocks and any train/test procedure.
> * Define selection criteria and multiple-testing treatment.
> * State the inferential test.
>
> Previously examined periods remain exploratory even if divided into new blocks. Any fitted classifier or model must train only on information preceding its test block. No random train/test split across time.
>
> Preserve earlier programmes' verdicts. Do not automatically reuse their trade-timing null as a valid test for event strategies: define what the event comparison tests and use a justified method. One acceptable method is a placebo test that moves each stock's events to random non-event dates of the same stock and reruns the rule, with resampling clustered by calendar date so that several stocks reacting to the same day's market move are not counted as independent evidence. If no defensible inferential test is implemented, label findings descriptive and do not declare a qualified candidate.
>
> 5. BENCHMARKS AND REPORTING
>
> For every run report:
> * Net dollar profit, total return and annualised return.
> * Maximum drawdown, exposure and time in cash.
> * Trade count, holding periods, turnover and costs.
> * Annual and per-stock results.
> * Gross-gain concentration.
> * Performance by event category, including missing-data exclusions.
> * Unfilled or unaffordable signals and missed upside.
> * Sensitivity to higher costs and conservative execution delays.
>
> Compare against:
> * Buy-and-hold on the same eligible universe and dates.
> * The run's exposure-matched hold.
> * Its simple family baseline.
> * Its matched price-only control.
>
> For selling before earnings, explicitly count cases where holding would have won because the stock rose. For post-event buying, include continued declines and failed recoveries.
>
> Distinguish descriptive exposure attribution from evidence of superior timing or selection. Account for dependence when several stocks react to the same event or market shock.
>
> Do not select on ending balance alone. A development improvement is not verified future profitability.
>
> 6. IMPLEMENTATION AND RUNNING
>
> Use an isolated module and results store with file guards protecting existing databases.
>
> Test on synthetic data:
> * Announcement availability and no look-ahead.
> * Conservative treatment of missing release times.
> * Estimated pre-announcement dates that miss the actual date.
> * The mechanical classification rule, applied exactly as written.
> * Corporate actions and dividends.
> * Gap handling, costs, sizing and accounting.
> * Shared-cash conflicts and overlapping events.
> * Determinism and prefix invariance.
> * Every supported entry and exit rule.
>
> Run the bounded campaign asynchronously through the existing runner where practical. Show progress, failures and results on the Research page. Keep improvement notifications in-app and labelled "development improvement—not validated."
>
> Do not weaken criteria or extend the search because no candidate appears.
>
> 7. DELIVERY
>
> Commit and push the code, protocol, tests and permitted result summaries to `hxr`. Exclude market data, databases, copyrighted source archives and secrets; preserve them locally according to project rules.
>
> Finish with:
> * Actual earliest and latest usable dates for each family.
> * Event counts per stock and category, and which categories were descriptive only.
> * Data gaps and unsupported concepts.
> * The frozen experiment matrix.
> * Actual test counts and run counts.
> * Results against all relevant benchmarks.
> * Whether news information added anything beyond the matched price rules.
> * Any candidate's limitations, or an explicit no-candidate outcome.
> * Commit hashes and one evidence-supported next step.
>
> Do not open evaluation windows or move to real money.

## 2 | 2026-11-06 | **Data inventory, first pass: prices available 2016-01-04 to 2021-12-31; the event source is blocked** (no strategy outcome computed; no release text read)

**Prices (measured 2026-11-06, read-only, rows dated on or before 2021-12-31 only; `data/hxr-sim.sqlite` file and write-ahead log unchanged in size and time).** The approved price source is Alpaca SIP raw daily bars as stored by HXR. Basket A, first and last stored session and count: MU, AMZN, META, TSLA, GOOG, INTC, CSCO, PYPL 2016-01-04 to 2021-12-31, 1,511 sessions each; VST 2017-05-10 to 2021-12-31, 1,171; SNAP 2017-03-02 to 2021-12-31, 1,219. Corporate actions stored with an ex-date on or before 2021-12-31: CSCO 24 and INTC 24 cash dividends (2016 to 2021), VST 12 (from 2019-03-14), MU 2 (from 2021-09-30), the TSLA 5-for-1 forward split on 2020-08-31 (an ACIA cash merger row belongs to another issuer). Spread samples on or before 2021-12-31: 6 per stock per year from each stock's listing year (SNAP 4 in 2017, VST 3 in 2017). 2016-01-04 is the first date in HXR's store and in `periods-hxr-v3.json` (`dataFrom`); Alpaca's historical stock data begins in 2016 (Alpaca's documentation; not verified here).

**The closed windows.** From 2022-01-03 every date of these ten stocks belongs to a protected window: HXR validation and the range-trend evaluation window (2022-01-03 to 2023-12-29), HXR's final period and the range-trend reserve (2024-01-02 to 2026-10-21), the Strategy Lab holdout for MU (2025-01-01 to 2026-06-30) and the prospective journal (from 2026-01-22 as warm-up, 2026-11-06 live). event-swing's usable window therefore ends at the session of 2021-12-31; no later bar, event or document has a code path.

**The event source (SEC EDGAR): blocked.** One bounded request was made shortly before 2026-11-06T17:49Z for Micron's 8-K list with the EDGAR date bound `dateb=20211231` and a generic client name: SEC returned HTTP 403, "Your Request Originates from an Undeclared Automated Tool ... Please declare your traffic by updating your user agent to include company specific information." The project's own SEC client (`server/providers/sec.js`) already requires a contact email from `.env` (`SEC_CONTACT_EMAIL`) for this reason, and it is not set (checked as a yes/no value, not printed). The assistant does not supply the owner's email address on its own. No other request was made to SEC. **Specific data blocker:** every family needs announcement dates and times, and the order makes EDGAR the primary source against which any other source must be checked, so no family is feasible until `SEC_CONTACT_EMAIL` is set in `.env`. Alpaca's news feed (on the approved host) was considered and not used as a substitute (DATA-INVENTORY.md section 3). HXR's store holds no news dated on or before 2021-12-31 (counted, 0 rows).

**What continues without event data** (the order's rule: continue with what is feasible): the inventory document, the protocol (CAMPAIGN-1.md, written and frozen before any event row or release text exists on this machine), the bounded downloader, the engine, the placebo test, the gated runner and the synthetic tests. The campaign gate refuses to run until the event data exists, its inventory is recorded here and the code is frozen.

## 3 | 2026-11-06 | **Implementation, tested on synthetic data; the D0 reproduction on the stored development data; the campaign waits for the event data** (no event data, no release text, no strategy outcome)

**Built** (code revision `es-code-2026-11-06-1`, engine `es-engine-1`): `server/eventswing/` (config with the pins, the window bound and the registrants; the store with its guard and append-only triggers; the bounded SEC client and parsers; events, availability, estimates and the classifier; the bounded price and cost loader; the signal and sleeve engines; the run report; the placebo; the pipeline; the gate, the records, the worker, the selection, the notifications and the report; the app service and `/api/eventswing/*`), `scripts/eventswing.mjs` (`npm run es:check|download|inventory|freeze|campaign|worker|status|report|repro`) and a read-only event-swing section on the Research page. **Not through the existing research runner:** its `server/research/runner.js` is one of the 28 files the prospective journal pins, and adding a plan would break the journal's hash check, so event-swing has its own queue and detached worker (checkpointed after every run, two hours of execution at most), shown on the Research page.

**Tests (synthetic data only):** event-swing 35 of 35 in seven files: the file guard and append-only records; the SEC client's refusals (no contact address, another host, a redirect, a filing after the bound, the undeclared-tool 403) and a bounded download against a fake EDGAR; grouping, availability at the first close after acceptance (early closes, weekends, an acceptance at the close), the unknown-time delay, exclusions, estimates and the classifier on exact texts, with its word lists equal to CAMPAIGN-1.md section 4's; D0 equal to rr-mech-1's M1 n=3 with splits and dividends; prefix invariance, insensitivity to later bars and determinism for every family; every entry and exit rule, the guidance filters, the pauses, a gap rejection, costs, shared cash and overlapping events; family A's exits, misses, time-outs and forced spells; the placebo's clustering, eligibility and determinism; the bounded data and costs; the whole campaign through the worker, the cap and the resume. Full suite: 727 tests (724 pass, 1 skipped, 1 known unrelated failure in tests/agent-safety.test.js, 1 cancelled: HXR's service test exceeded its 240 s limit on a slow disk and passes when its file runs alone). Planted bugs (range-trend and sweep-bos harnesses, unchanged programmes): range-trend 46 of 46 and sweep-bos 59 of 59 caught (re-run 2026-11-06).

**Defects found by the synthetic tests and corrected before the code commit** (no event data existed): (1) the listing exclusion treated `listedFrom` 2016-01-04, which is only where the stored prices begin, as a listing date and would have dropped every 2015 announcement that family A needs for its first-year estimates (DATA-INVENTORY.md section 8); (2) the sleeve engine accepted fewer stocks than sleeves and would have run on part of the capital; (3) `INSERT OR IGNORE` hid the store's 2021-12-31 CHECK constraint (now a duplicate is skipped and a later filing still throws); (4) the committed-file check trimmed the trailing newline before hashing.

**The reproduction check (read-only, on the stored development data; not a new outcome):** `npm run es:repro` ran D0 with no pause on the bounded inputs with campaign 3's period (trading from 2017-10-02) and compared it with rr-mech-1 on experiment 191's stored configuration and with the stored net: +5,812.61 US$, +5,812.61 US$ and +5,812.61 US$; 321 trades and 643 fills, every trade identical; `research-runner.sqlite` unchanged in size and time. It shows that event-swing's portfolio mechanics, its bounded loader and its bounded cost table give campaign 3's figures on these bars. `hxr-sim.sqlite` and its write-ahead log keep their 2026-10-23 times.

**Measured inputs (read-only):** 1,510 sessions from 2016-01-04 to 2021-12-31 (2021-10-25 excluded); VST from 2017-05-10 (1,170 sessions), SNAP from 2017-03-02 (1,218), the other eight 1,510; inputs hash `7d2ab6dff9691ddd79e29c8692a189e8c97cb064d8536d5a4a21b73043c4b28f`; calibration hash `9d13892685912d5c1eecc7afef0afcebd844cc7b73a8d38ea79a7b363d777fdc` (samples on or before 2021-12-31). **Earliest possible decisions by family** (prices only; the event dates are not known yet): B0 and C0 need the typical move, from 2016-02-03 (SNAP 2017-03-31, VST 2017-06-09); B1 to B3, C1, C2 and the price controls BP and CP from the first trigger with a pre-event close; family D needs 200 earlier closes, from 2016-10-18 (SNAP 2017-12-14, VST 2018-02-26); family A from its first estimate, which needs a same-registrant announcement a year earlier. The latest usable session for every family is 2021-12-31.

**Status:** `npm run es:check` passes the pins and the pre-registration commit and is closed on the event data (no `SEC_CONTACT_EMAIL`, so no download), the inventory and the code-frozen record. **Run counts:** 0 campaign runs, 0 placebo resamples, 1 reproduction check. **Unsupported, unchanged from CAMPAIGN-1.md:** results against expectations, reported figures as known at the announcement, a pre-announcement calendar, elections and policy announcements. **Next, after the owner adds `SEC_CONTACT_EMAIL` to `.env`:** `es:download`, `es:inventory -- --record` (the counts per stock and category, before any run), `es:freeze -- --record`, `es:check`, `es:campaign -- --create --start --confirm` (START-HERE.md section 16).

## 4 | 2026-11-06 | **Event inventory** (counts only, before any configuration runs; no strategy outcome computed)

Data manifest `677d32e800e645a512e760f786a22d673ff717ab6ebf68fd9e6d05fd5d9d2a29`. Usable events: 261 (availability 2016-01-15 to 2021-12-21); events before the window used for estimates only: 31; excluded: {}. Dependence: 213 distinct availability dates, 36 shared by several stocks, at most 4 on one date.

| Stock | First price session | Events | Usable | Negative | Positive | Neutral | Raised | Lowered | Reaffirmed | Mixed | None detected | No text | Interim | Estimates in window |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MU | 2016-01-04 | 29 | 24 | 6 | 8 | 10 | 0 | 0 | 0 | 0 | 23 | 1 | 0 | 24 |
| AMZN | 2016-01-04 | 28 | 24 | 2 | 4 | 18 | 1 | 1 | 0 | 0 | 22 | 0 | 0 | 24 |
| META | 2016-01-04 | 28 | 24 | 3 | 9 | 12 | 1 | 0 | 0 | 0 | 23 | 0 | 0 | 24 |
| TSLA | 2016-01-04 | 56 | 48 | 14 | 11 | 23 | 0 | 0 | 7 | 0 | 41 | 0 | 25 | 24 |
| VST | 2017-05-10 | 18 | 18 | 2 | 2 | 14 | 5 | 0 | 7 | 1 | 3 | 2 | 0 | 14 |
| GOOG | 2016-01-04 | 25 | 24 | 1 | 6 | 17 | 0 | 0 | 0 | 0 | 24 | 0 | 0 | 21 |
| INTC | 2016-01-04 | 29 | 25 | 8 | 6 | 11 | 11 | 0 | 5 | 0 | 9 | 0 | 1 | 24 |
| CSCO | 2016-01-04 | 28 | 24 | 6 | 5 | 13 | 0 | 0 | 0 | 0 | 24 | 0 | 0 | 24 |
| PYPL | 2016-01-04 | 31 | 30 | 4 | 9 | 17 | 9 | 0 | 1 | 1 | 13 | 6 | 6 | 21 |
| SNAP | 2017-03-02 | 20 | 20 | 10 | 8 | 2 | 0 | 0 | 0 | 0 | 19 | 1 | 1 | 15 |

Timing classes (all stocks): {"after_close":219,"filed_after_report_date":12,"non_session_day":2,"before_open":27,"during_session":1}.

| Configuration | Category | Events | Descriptive only (< 20) |
|---|---|---|---|
| A1 | estimates_in_window | 215 | no |
| A2 | estimates_in_window | 215 | no |
| B0 | negative | 56 | no |
| B1 | negative | 56 | no |
| B2 | negative_unchanged_or_raised | 11 | yes |
| B3 | negative_lowered | 0 | yes |
| C0 | usable | 261 | no |
| C1 | positive | 68 | no |
| C2 | positive_raised | 7 | yes |
| D1 | lowered | 1 | yes |
| D2 | negative | 56 | no |
| D3 | usable | 261 | no |

## 5 | 2026-11-06 | **Code frozen for campaign 1**

code revision: `es-code-2026-11-06-1`; engine `es-engine-1`; pre-registration commit: `3a0589f1101650746a9163347c4faf84e32eb409`; HEAD `d64b805d5f4b506127a5b24d98905841dbe1f42f`; data manifest hash: `677d32e800e645a512e760f786a22d673ff717ab6ebf68fd9e6d05fd5d9d2a29`; inputs hash `7d2ab6dff9691ddd79e29c8692a189e8c97cb064d8536d5a4a21b73043c4b28f`; calibration hash `9d13892685912d5c1eecc7afef0afcebd844cc7b73a8d38ea79a7b363d777fdc` (samples on or before 2021-12-31); matrix `b35a0c0005ce6d55a4c4b2705ff943eeb3011fb951064924b65d80f958f07720`; classifier `485f9dd13ab83d4c6cd3c62fa4bbf0fe76257f1750c10b4cfbe80ba4bffe66c2`; CAMPAIGN-1.md `a47bcaf82c8e320ebf444c23ba5327df4bc2672142b1d423262d679180cc94a5`. Implementation ends here; execution time is measured from the campaign's first start.

## 6 | 2026-11-06 | **Run** run id: 1, config: A0, config hash: eb249e2d71fefcb9c88514b0a70c10727bad71bf68cb9d5ce897aded24eeb363, status: done; variant: base

net 64054.24 US$; T (net minus the exposure-matched hold) 2762.84; completed trades 0; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 7 | 2026-11-06 | **Run** run id: 2, config: A0, config hash: eb249e2d71fefcb9c88514b0a70c10727bad71bf68cb9d5ce897aded24eeb363, status: done; variant: double_costs

net 64044.36 US$; T (net minus the exposure-matched hold) 2714.97; completed trades 0; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 8 | 2026-11-06 | **Run** run id: 3, config: A0, config hash: eb249e2d71fefcb9c88514b0a70c10727bad71bf68cb9d5ce897aded24eeb363, status: done; variant: delayed

net 64054.24 US$; T (net minus the exposure-matched hold) 2762.84; completed trades 0; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 9 | 2026-11-06 | **Run** run id: 4, config: A1, config hash: 1c5bd4d822615ebe5c21a562e00068165f5c4a04ce55940b2a6af84ffcad75b3, status: done; variant: base

net 36774.81 US$; T (net minus the exposure-matched hold) -8930.42; completed trades 192; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 10 | 2026-11-06 | **Run** run id: 5, config: A1, config hash: 1c5bd4d822615ebe5c21a562e00068165f5c4a04ce55940b2a6af84ffcad75b3, status: done; variant: double_costs

net 35083.49 US$; T (net minus the exposure-matched hold) -10786.63; completed trades 192; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 11 | 2026-11-06 | **Run** run id: 6, config: A1, config hash: 1c5bd4d822615ebe5c21a562e00068165f5c4a04ce55940b2a6af84ffcad75b3, status: done; variant: delayed

net 37584.27 US$; T (net minus the exposure-matched hold) -8239.69; completed trades 196; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 12 | 2026-11-06 | **Run** run id: 7, config: A2, config hash: 58c9897c9fe015e8e2f792fb440568c94ed212d2a3e5a7a43f23cf2ad1ae7bff, status: done; variant: base

net 37300.63 US$; T (net minus the exposure-matched hold) -8168.76; completed trades 199; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 13 | 2026-11-06 | **Run** run id: 8, config: A2, config hash: 58c9897c9fe015e8e2f792fb440568c94ed212d2a3e5a7a43f23cf2ad1ae7bff, status: done; variant: double_costs

net 35966.22 US$; T (net minus the exposure-matched hold) -9654.08; completed trades 199; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 14 | 2026-11-06 | **Run** run id: 9, config: A2, config hash: 58c9897c9fe015e8e2f792fb440568c94ed212d2a3e5a7a43f23cf2ad1ae7bff, status: done; variant: delayed

net 36441.53 US$; T (net minus the exposure-matched hold) -8439.99; completed trades 202; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 15 | 2026-11-06 | **Run** run id: 10, config: B0, config hash: d66706b83b95f136407038b726be8565fdf9737bff3475e958dd76e703bd50be, status: done; variant: base

net 1046.44 US$; T (net minus the exposure-matched hold) -1478.27; completed trades 52; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 16 | 2026-11-06 | **Run** run id: 11, config: B0, config hash: d66706b83b95f136407038b726be8565fdf9737bff3475e958dd76e703bd50be, status: done; variant: double_costs

net 847.71 US$; T (net minus the exposure-matched hold) -1670.61; completed trades 52; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 17 | 2026-11-06 | **Run** run id: 12, config: B0, config hash: d66706b83b95f136407038b726be8565fdf9737bff3475e958dd76e703bd50be, status: done; variant: delayed

net 2845.73 US$; T (net minus the exposure-matched hold) -1005.19; completed trades 59; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 18 | 2026-11-06 | **Run** run id: 13, config: B1, config hash: bd251a4e8131c414adc9768d83012cecb3d46ed0617785f73d8c1b29d636fc9a, status: done; variant: base

net 2255.39 US$; T (net minus the exposure-matched hold) 965.5; completed trades 54; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 19 | 2026-11-06 | **Run** run id: 14, config: B1, config hash: bd251a4e8131c414adc9768d83012cecb3d46ed0617785f73d8c1b29d636fc9a, status: done; variant: double_costs

net 2063.7 US$; T (net minus the exposure-matched hold) 787.83; completed trades 54; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 20 | 2026-11-06 | **Run** run id: 15, config: B1, config hash: bd251a4e8131c414adc9768d83012cecb3d46ed0617785f73d8c1b29d636fc9a, status: done; variant: delayed

net 3316.02 US$; T (net minus the exposure-matched hold) 1734.32; completed trades 61; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 21 | 2026-11-06 | **Run** run id: 16, config: B2, config hash: 5a1a3e6cc262ee62ac2374c84e9148af5ef85242fc351cafb124f748d1ff71ee, status: done; variant: base

net -474.82 US$; T (net minus the exposure-matched hold) -484.31; completed trades 10; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 22 | 2026-11-06 | **Run** run id: 17, config: B2, config hash: 5a1a3e6cc262ee62ac2374c84e9148af5ef85242fc351cafb124f748d1ff71ee, status: done; variant: double_costs

net -510.82 US$; T (net minus the exposure-matched hold) -511.84; completed trades 10; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 23 | 2026-11-06 | **Run** run id: 18, config: B2, config hash: 5a1a3e6cc262ee62ac2374c84e9148af5ef85242fc351cafb124f748d1ff71ee, status: done; variant: delayed

net -192.18 US$; T (net minus the exposure-matched hold) -281.73; completed trades 11; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 24 | 2026-11-06 | **Run** run id: 19, config: B3, config hash: 590c4c03693cbc4dcd0e9faec32fcae7dfa2a8b725fe0f1d8b88d3532e2efe5a, status: done; variant: base

net 0 US$; T (net minus the exposure-matched hold) 0; completed trades 0; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 25 | 2026-11-06 | **Run** run id: 20, config: B3, config hash: 590c4c03693cbc4dcd0e9faec32fcae7dfa2a8b725fe0f1d8b88d3532e2efe5a, status: done; variant: double_costs

net 0 US$; T (net minus the exposure-matched hold) 0; completed trades 0; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 26 | 2026-11-06 | **Run** run id: 21, config: B3, config hash: 590c4c03693cbc4dcd0e9faec32fcae7dfa2a8b725fe0f1d8b88d3532e2efe5a, status: done; variant: delayed

net 0 US$; T (net minus the exposure-matched hold) 0; completed trades 0; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 27 | 2026-11-06 | **Run** run id: 22, config: BP, config hash: c5ab81d5771e4959cfb63c9f5b2aeb24e98698785b76e611567d5e91e6bcdb31, status: done; variant: base

net 10234.82 US$; T (net minus the exposure-matched hold) -9249.88; completed trades 263; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 28 | 2026-11-06 | **Run** run id: 23, config: BP, config hash: c5ab81d5771e4959cfb63c9f5b2aeb24e98698785b76e611567d5e91e6bcdb31, status: done; variant: double_costs

net 8517.58 US$; T (net minus the exposure-matched hold) -10812.16; completed trades 263; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 29 | 2026-11-06 | **Run** run id: 24, config: BP, config hash: c5ab81d5771e4959cfb63c9f5b2aeb24e98698785b76e611567d5e91e6bcdb31, status: done; variant: delayed

net 10234.82 US$; T (net minus the exposure-matched hold) -9249.88; completed trades 263; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 30 | 2026-11-06 | **Run** run id: 25, config: C0, config hash: 31623fc9335dfe6dbb4c7ae24594cff6852adba9a04bb3675c7258146b31a083, status: done; variant: base

net 15158.44 US$; T (net minus the exposure-matched hold) -2936.53; completed trades 203; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 31 | 2026-11-06 | **Run** run id: 26, config: C0, config hash: 31623fc9335dfe6dbb4c7ae24594cff6852adba9a04bb3675c7258146b31a083, status: done; variant: double_costs

net 13936.71 US$; T (net minus the exposure-matched hold) -4137.95; completed trades 206; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 32 | 2026-11-06 | **Run** run id: 27, config: C0, config hash: 31623fc9335dfe6dbb4c7ae24594cff6852adba9a04bb3675c7258146b31a083, status: done; variant: delayed

net 13711.68 US$; T (net minus the exposure-matched hold) -3831.56; completed trades 206; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 33 | 2026-11-06 | **Run** run id: 28, config: C1, config hash: d6400809091ad31caca98d8331f010ac87a5f6ab1288cd29a5ecfe934178c661, status: done; variant: base

net 2065.59 US$; T (net minus the exposure-matched hold) 196.13; completed trades 66; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 34 | 2026-11-06 | **Run** run id: 29, config: C1, config hash: d6400809091ad31caca98d8331f010ac87a5f6ab1288cd29a5ecfe934178c661, status: done; variant: double_costs

net 1889.08 US$; T (net minus the exposure-matched hold) 61.2; completed trades 66; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 35 | 2026-11-06 | **Run** run id: 30, config: C1, config hash: d6400809091ad31caca98d8331f010ac87a5f6ab1288cd29a5ecfe934178c661, status: done; variant: delayed

net 1661.22 US$; T (net minus the exposure-matched hold) -950.32; completed trades 62; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 36 | 2026-11-06 | **Run** run id: 31, config: C2, config hash: cedd584e7cb13e83a62ad9bcc8f6a83901d3906c4193f4dd1ea22ff59db442ff, status: done; variant: base

net 729.02 US$; T (net minus the exposure-matched hold) 40.82; completed trades 7; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 37 | 2026-11-06 | **Run** run id: 32, config: C2, config hash: cedd584e7cb13e83a62ad9bcc8f6a83901d3906c4193f4dd1ea22ff59db442ff, status: done; variant: double_costs

net 709.86 US$; T (net minus the exposure-matched hold) 20.02; completed trades 7; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 38 | 2026-11-06 | **Run** run id: 33, config: C2, config hash: cedd584e7cb13e83a62ad9bcc8f6a83901d3906c4193f4dd1ea22ff59db442ff, status: done; variant: delayed

net 654.2 US$; T (net minus the exposure-matched hold) 61.09; completed trades 6; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 39 | 2026-11-06 | **Run** run id: 34, config: CP, config hash: f5c75024d9524e448f6157d25232ad32b2c419ef5ccc7ec05b44b4f52881d69b, status: done; variant: base

net 14695.76 US$; T (net minus the exposure-matched hold) -4640.86; completed trades 279; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 40 | 2026-11-06 | **Run** run id: 35, config: CP, config hash: f5c75024d9524e448f6157d25232ad32b2c419ef5ccc7ec05b44b4f52881d69b, status: done; variant: double_costs

net 12629.19 US$; T (net minus the exposure-matched hold) -6463.41; completed trades 279; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 41 | 2026-11-06 | **Run** run id: 36, config: CP, config hash: f5c75024d9524e448f6157d25232ad32b2c419ef5ccc7ec05b44b4f52881d69b, status: done; variant: delayed

net 14695.76 US$; T (net minus the exposure-matched hold) -4640.86; completed trades 279; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 42 | 2026-11-06 | **Run** run id: 37, config: D0, config hash: cec2a01c9dd7ec9482419352c12bc9770086177a1649191abfb78e466d6fba9d, status: done; variant: base

net 7408.12 US$; T (net minus the exposure-matched hold) 5425.78; completed trades 405; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 43 | 2026-11-06 | **Run** run id: 38, config: D0, config hash: cec2a01c9dd7ec9482419352c12bc9770086177a1649191abfb78e466d6fba9d, status: done; variant: double_costs

net 5294.35 US$; T (net minus the exposure-matched hold) 3253.31; completed trades 406; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 44 | 2026-11-06 | **Run** run id: 39, config: D0, config hash: cec2a01c9dd7ec9482419352c12bc9770086177a1649191abfb78e466d6fba9d, status: done; variant: delayed

net 7408.12 US$; T (net minus the exposure-matched hold) 5425.78; completed trades 405; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 45 | 2026-11-06 | **Run** run id: 40, config: D1, config hash: 9c9c3275b612de133bcc90964854563db2ffaaeb33d6eda4bb365b0d9774c814, status: done; variant: base

net 7263.02 US$; T (net minus the exposure-matched hold) 5289.72; completed trades 404; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 46 | 2026-11-06 | **Run** run id: 41, config: D1, config hash: 9c9c3275b612de133bcc90964854563db2ffaaeb33d6eda4bb365b0d9774c814, status: done; variant: double_costs

net 5266.47 US$; T (net minus the exposure-matched hold) 3237.25; completed trades 405; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 47 | 2026-11-06 | **Run** run id: 42, config: D1, config hash: 9c9c3275b612de133bcc90964854563db2ffaaeb33d6eda4bb365b0d9774c814, status: done; variant: delayed

net 7263.02 US$; T (net minus the exposure-matched hold) 5289.72; completed trades 404; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 48 | 2026-11-06 | **Run** run id: 43, config: D2, config hash: 32cc122f5a8087231cb52a994f88f8a6d929a75f0140e2d2360c5309b0eac0e3, status: done; variant: base

net 7206.09 US$; T (net minus the exposure-matched hold) 5014.21; completed trades 377; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 49 | 2026-11-06 | **Run** run id: 44, config: D2, config hash: 32cc122f5a8087231cb52a994f88f8a6d929a75f0140e2d2360c5309b0eac0e3, status: done; variant: double_costs

net 5106.42 US$; T (net minus the exposure-matched hold) 2919.08; completed trades 376; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 50 | 2026-11-06 | **Run** run id: 45, config: D2, config hash: 32cc122f5a8087231cb52a994f88f8a6d929a75f0140e2d2360c5309b0eac0e3, status: done; variant: delayed

net 6952.84 US$; T (net minus the exposure-matched hold) 5140.51; completed trades 374; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 51 | 2026-11-06 | **Run** run id: 46, config: D3, config hash: 180bc7d0c1431266d49743a7a0ff5a9eb262765b0ce9d6ac8ff55640c2d6a960, status: done; variant: base

net 5308.32 US$; T (net minus the exposure-matched hold) 3102.77; completed trades 255; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 52 | 2026-11-06 | **Run** run id: 47, config: D3, config hash: 180bc7d0c1431266d49743a7a0ff5a9eb262765b0ce9d6ac8ff55640c2d6a960, status: done; variant: double_costs

net 4035.7 US$; T (net minus the exposure-matched hold) 1829.04; completed trades 255; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 53 | 2026-11-06 | **Run** run id: 48, config: D3, config hash: 180bc7d0c1431266d49743a7a0ff5a9eb262765b0ce9d6ac8ff55640c2d6a960, status: done; variant: delayed

net 4977.94 US$; T (net minus the exposure-matched hold) 3530.09; completed trades 253; code revision es-code-2026-11-06-1. A development result on previously examined prices.

## 54 | 2026-11-06 | **Campaign 1 complete**: NONE (no development candidate)

Runs 48 done, 0 failed; placebo for 6 configurations; execution 0.8 minutes; report `strategy/event-swing/reports/campaign-1.md`. Development results on previously examined prices; nothing validated; no evaluation window exists for this programme.

## 55 | 2026-11-06 | **Finding after the result: the event placebo could not be drawn for families B to D** (no change to any frozen file, run or result)

What the stored rows show (measured, read from `es_placebo`): for B1, C1, D2 and D3 every one of the 2,000 resamples failed (`failed` 2000, about 0.3 s each configuration), so by the rule of `CAMPAIGN-1.md` section 9 each failure counted as a resample at least as large as the observed statistic and p = 1.0000. Family A's spell placebo drew normally (A1 p 0.9735, A2 p 0.9175, no failure).

Why (diagnosed read-only on 2026-11-06 with one draw of the frozen drawer, seed 20261106): the first draw stops at "no non-overlapping date within 1000 draws for TSLA:2016-07-03". TSLA has 48 usable events in 1,510 sessions (interim filings included); the frozen rule moves each event to a session outside 30 sessions of the stock's real events and at least 30 sessions from its other moved events, and TSLA's 48 events leave no such placement. This is the pre-registered design meeting this data, not a coding slip: the drawer does what section 9 says. The test therefore had no power for families B to D; the p-values of 1.0000 are the conservative fallback, not a measurement.

Effect on the outcome: none. NONE also follows from conditions that do not use the placebo: every configuration fails the comparator condition and the best-5% stress (the report's "Fails" column). A placebo that can be drawn (a smaller buffer, or TSLA's interim events treated differently) would be a new campaign document written before any further outcome is read; master work order version 3 runs event-swing "without new building", so nothing is changed here and the owner decides whether a campaign 2 is wanted.
