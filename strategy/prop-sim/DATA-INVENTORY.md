# prop-sim: data inventory (2026-11-09)

Simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid. Simulation only. Every figure here is a fact about data sources or an estimate; no strategy outcome had been computed when this was written.

## 1. What exists

| Source | What | Futures? | Status |
|---|---|---|---|
| Alpaca (`server/hxr/source.js`, `https://data.alpaca.markets`, SIP, raw) | US stock and ETF bars, including QQQ and SPY, 1-minute and daily, back to 2016 | **No futures** | key in `.env`; used by every earlier programme |
| `data/sweep-bos-sim.sqlite` | QQQ and SPY 5-minute bars, 2019-01-02 to 2022-12-30 (bound) | no | sweep-bos's own; not reused (prop-sim needs 1-minute bars and its own database) |
| `data/ict-lab-sim.sqlite` | QQQ 5-minute bars, 2018-06-01 to 2022-12-30 (bound) | no | the ICT Lab's own; not reused |
| CME futures (NQ, ES, MNQ, MES) | none stored anywhere in the project | — | Option A below |

## 2. Option B (free, starts now): QQQ and SPY as stand-ins

- **Bars:** QQQ and SPY 1-minute bars, regular session only (09:30 to 16:00 New York, early closes included), 2018-06-01 to 2022-12-30, downloaded once through `server/hxr/source.js` into prop-sim's own database; nothing after 2022-12-30 is requested, stored (CHECK constraint) or read. Expected size about 450,000 bars per symbol (about 1,150 sessions of 390 minutes).
- **Conversion to futures points, fixed in advance (experimental assumption, author-selected):** NQ points = QQQ price × 41.0; ES points = SPY price × 10.0. Both are the approximate index-to-ETF ratios of the period (the Nasdaq-100 at roughly 40 to 41 times QQQ, the S&P 500 at roughly 10 times SPY); the ratio drifts slowly with the funds' dividends and fees, and futures add a carry basis, so levels are not futures prices, but intraday moves in points are close in size. Converted prices are rounded to the futures tick (0.25 points).
- **Contracts simulated:** MNQ (US$2 per NQ point, tick 0.25 = US$0.50) and MES (US$5 per ES point, tick 0.25 = US$1.25); 10 micros = 1 mini for Lucid's contract limits.
- **Label on everything built on it:** "stand-in, regular hours only, not futures". No overnight session exists in it, so overnight highs and lows and the London window are not available; there is no futures roll, no Globex-only move, and the opening gap is the ETF's.
- **Prior use of this period (disclosed):** sweep-bos used QQQ and SPY 5-minute bars for 2019-01-02 to 2022-12-30, and the ICT Lab used QQQ 5-minute bars for 2018-06-01 to 2022-12-30, both with ICT-style rules; NQ and ES track the same market. Every result here is exploratory.

## 3. Option A (paid, waits for the owner's yes): real CME futures history

- **What:** 1-minute OHLCV bars (Databento schema `ohlcv-1m`, dataset `GLBX.MDP3`, CME Globex MDP 3.0) for NQ, ES, MNQ and MES, all Globex hours including overnight, 2018-06-01 to 2022-12-30. MNQ and MES began trading on 2019-05-06, so they cover 2019-05-06 to 2022-12-30.
- **Pricing as published** (`https://databento.com/pricing`, read 2026-11-09): historical data is pay-as-you-go, priced per GB of uncompressed binary data; new accounts get US$125 of free credits, which expire 6 months after signup. The page gives no per-GB rate for this dataset and schema; Databento's own pages quoted in search results say GLBX.MDP3 historical data starts "from $0.50/GB".
- **Size estimate (derived, not quoted):** one OHLCV record is 56 bytes. Globex trades about 23 hours a day, about 1,380 one-minute bars per front-month contract per session, over about 1,157 sessions: about 1.6 million bars, about 0.09 GB per product for the front month only; the four products together about 0.35 GB. Requesting every listed expiry and spread (Databento's parent symbology) would be several times larger, about 1 to 2 GB.
- **Cost estimate (derived):** at US$0.50 to US$2.00 per GB, about US$0.20 to US$4 for the front months, or about US$0.50 to US$4 for all expiries; well inside the US$125 free credit, so possibly nothing out of pocket. **This is an estimate, not the exact cost:** Databento states the exact price only through its cost tool (`metadata.get_cost`) or batch portal, which need an account and an API key, a new credential. Nothing is bought without the owner's yes.

## 4. Phase 2 live-data options (the order's section 11; nothing subscribed)

| Option | What it covers | Monthly cost | Source |
|---|---|---|---|
| (a) Databento live CME (GLBX.MDP3) | real-time NQ, ES, MNQ, MES, all Globex hours including overnight | US$199 per month (Standard plan, which includes live data); CME personal (non-professional) use listed as included for up to 2 devices in Databento's 2026 fee table (third-party snippet, to confirm); license fees passed through with a 2.9% card-processing charge | `https://databento.com/pricing` (the US$199 Standard plan, read 2026-11-09); the fee-table figures from search results, not read on Databento's site |
| (b) Alpaca free plan, IEX real time | QQQ and SPY from the IEX exchange only, regular hours; IEX is a small share of US volume, so volume-based rules are unreliable on it | free | `https://alpaca.markets/data` (read 2026-11-09): "IEX", real time "via websocket", websocket "Limited to 30 symbols", "200 API calls/min"; the same page says "15 minute delay via API" for the free plan, which the Phase 2 build checks before relying on it |
| (for comparison) Alpaca Algo Trader Plus | all US exchanges in real time | US$99 per month | same page |

Phase 2 builds on (b); a paid subscription needs the owner's yes.

## 5. Closed windows (unchanged)

The 2023-01-03 to 2024-12-31 evaluation window and the 2025 to 2026 reserve stay closed: no code path downloads, stores or reads them. The development period is 2018-06-01 to 2022-12-30 only.
