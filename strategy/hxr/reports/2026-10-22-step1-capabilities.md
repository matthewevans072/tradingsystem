# HXR step 1: available data and simulation capabilities (2026-10-22)

**Outcome:**

- Signal Desk can do HXR's backtest and its prospective simulated account
  itself, at no cost, with Alpaca's free market data, once the new HXR module
  is built. The existing Strategy Lab engine cannot be reused, because it
  works on 15-minute breakouts only.
- No external platform is needed. No platform paper-trading account is used
  or connected.
- No HXR rule has been run on any data.

Checks were read-only and made with the Alpaca keys in the cloud
environment. Key values were never printed. Status labels:

- **verified**: tested here;
- **documented**: an official page, read as a search summary because the
  sandbox blocks most sites;
- **unverified**.

## 1. Three different things

| | What it is | Who does it for HXR |
|---|---|---|
| **Backtest** | Fixed rules run over past daily bars | Signal Desk's new HXR engine (verified that the old engine cannot: 15-minute bars and breakout entries only) |
| **Simulated ledger** | A pretend account that processes each new session, records every decision with a timestamp and fills at the next open | Signal Desk's new HXR prospective account |
| **Platform paper trading** | Orders sent to a broker's or platform's simulator | **Not used.** Sending orders, even to a paper account, is a broker-order integration, which the project rules exclude. Details in section 4, for information only. |

HXR never reports an order as submitted. Every order is an internal record
labelled SIMULATED.

## 2. Price data (Alpaca, free Basic plan)

| Fact | Status |
|---|---|
| Daily SIP (consolidated) bars from 2016-01-04; nothing earlier | verified |
| Your stocks: MU, AMZN, META, TSLA from 2016-01-04; VST from 2017-05-10; HOOD from 2021-07-29; MUU from 2024-10-10; NBIS usable from 2024-10-21; SPCX from 2026-06-12 | verified |
| NBIS history before 2024-10-21 is Yandex (YNDX), then a 2022-02-28 to 2024-10-18 suspension of zero-volume filler bars | verified (Alpaca name change YNDX→NBIS, 2024-08-21) |
| SPCX: the old SPCX ETF became SPCK on 2026-04-07; SpaceX listed on Nasdaq as SPCX on 2026-06-12 (first close 160.95) | verified (Alpaca record and data); IPO details from secondary sources |
| Splits are listed with their first adjusted session: AMZN 20:1 2022-06-06; TSLA 5:1 2020-08-31 and 3:1 2022-08-25; MUU 20:1 2026-07-15 | verified |
| Cash dividends with ex, record and pay dates: MU, META, VST (and MUU distributions). Alpaca's dividend list has gaps (SPY misses two in 2016–2018), and old SPCX ETF dividends still sit under the symbol | verified |
| The daily open is the first trade at 09:30 on any venue, not the opening auction: a median 3.4 bps away, up to 61 bps | verified (28 symbol-days) |
| The daily close equals the official closing auction in 2023–2026 samples; in older data it can be a late off-exchange print | verified |
| The free plan refuses SIP data less than 15 minutes old. A daily request also returns today's unfinished bar, which must be dropped | verified |
| The four Alpaca NYSE gap sessions (2021-10-25, 2022-01-24, 2022-01-26, 2022-03-08) also corrupt daily bars of NYSE names such as VST. HXR skips them | verified |
| Historical NBBO quotes from 2016, used to measure real opening spreads (MU about 6 bps at the open, 2 bps at the close) | verified |
| The 2018-12-05 NYSE closure was missing from Signal Desk's calendar. It was added | verified (no Alpaca bar that day) |
| About 200 requests a minute | verified (headers) |

## 3. News

| Fact | Status |
|---|---|
| Alpaca's news API (Benzinga) works with your keys; items go back to 2015 | verified |
| Each item has created and updated timestamps (to the second), headline, summary, symbols and URL | verified |
| The API filters by **updated** time, not creation time, and keeps only the latest revision; some items are edited days later | verified |
| In a live sample, items became readable 26–325 seconds after their creation time. HXR records when Signal Desk first saw each item | verified (small sample) |
| A historical news test cannot be clean: the text may have been revised, and any AI reading 2015–2025 headlines may already know what happened next | inference |
| Signal Desk's existing news code polls only real holdings, stores into the portfolio database and keeps no history, so HXR has its own news store | verified |
| Licence terms for the news text were not readable from here; keep it on your PC and do not redistribute | unverified |

**So:** news is recorded with timestamps only in the prospective account. No
historical result is evidence for a news-informed HXR.

## 4. Other platforms (information only, nothing connected)

| Platform | Backtest | Simulated ledger | Paper trading | Cost (search summaries) |
|---|---|---|---|---|
| TradingView | One symbol per Strategy Tester run; a shared-cash basket is not native; no spread setting; dividends unclear | Pine broker emulator on a live chart | Manual Paper Trading only; Pine cannot place orders into it | Free; Premium (Bar Magnifier, Deep Backtesting) about US$59.95/month billed annually |
| QuantConnect / LEAN | Multi-stock portfolio, cash account, dividends in raw or split-adjusted mode; zero slippage by default | via live deployment | Paid tiers only | Free tier backtests; paid tier from about US$10/month plus nodes (old post) |
| Alpaca | none | none | Free paper account; does not simulate dividends; random partial fills | Free |
| Interactive Brokers | none found | none | Paper account with an IBKR account; no dividends or splits | Commission US$0.005/share (Pro) or US$0 (Lite) |
| Questrade | none | none | 90-day practice account | US$0 commission on US stocks; 1.5% currency conversion |

None of these is needed. Signal Desk's own engine models a shared US$15,000
account, whole shares, dividends, splits, measured spreads and next-open
fills, which no free platform above does completely.

## 5. Costs used in HXR

Each item below comes from the pre-registration, fixed before any test:

- **Commission**: US$0, from Questrade's published pricing (search summary).
- **Sell fees**: the SEC fee and the FINRA TAF.
- **Spread**: a half-spread measured per stock and year from real opening
  quotes, with a 2 bps floor.
- **Slippage**: 2 bps.
- **Dividend withholding**: 15%.
- **Cash interest**: none.
- **Currency conversion**: none, because the account is in USD.

## 6. What this step did not do

- It ran no rule on any data and computed no return, drawdown or comparison.
- It downloaded only small samples. The full HXR download happens on your PC
  or in a session with the keys, through the HXR page.
- It sent no order, made no paper-trading call and signed up for nothing.
