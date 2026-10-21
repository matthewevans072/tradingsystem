# Strategy Lab

The Strategy Lab is the part of Signal Desk that tests one trading idea, a
long-only **consolidation breakout** on 15-minute bars of US stocks and ETFs,
in **simulation only**. The rules come from the owner's written brief. Where
the source video left points open, each is filled with an explicit,
configurable research assumption. Nothing here is a reproduction of the
video or evidence of an edge.

The Lab is kept apart from the real portfolio:

- it has its own database;
- its simulated account starts from a hypothetical US$100,000;
- it never reads or changes real holdings or cash;
- it cannot place, route or prepare an order anywhere.

A negative or inconclusive result is an expected and valid outcome.

## Four different things, and which ones this project does

| | What it is | In this project? |
|---|---|---|
| 1. **Historical backtest** | Running the fixed rules over past bars. Signal Desk's own engine does this for the development, validation, holdout, stress-test and walk-forward runs in `VALIDATION-PLAN.md`. The Pine version can also be run in TradingView's Strategy Tester on the owner's TradingView account. | **Yes** |
| 2. **TradingView broker-emulator forward simulation** | The Pine strategy left on a live chart keeps simulating trades on each new bar with TradingView's broker emulator. Strategy alerts can report those simulated fills. No order goes anywhere. | **Yes** (optional, run by the owner in TradingView) |
| 3. **TradingView Paper Trading** | TradingView's separate virtual-money account, traded from the Trading Panel. Pine strategies cannot place Paper Trading orders (see `RESEARCH-NOTES.md`, section 1). | **No** |
| 4. **Broker execution** | Real orders at Questrade or any other broker. | **No** (see `QUESTRADE-ASSESSMENT.md`) |

As well as 1 and 2, Signal Desk runs **its own simulated forward test**. Once
the owner switches it on for a mode (intraday or swing), the engine:

- processes each new completed 15-minute bar with the strategy version
  frozen;
- keeps a simulated account;
- journals every signal, skip, fill, exit, cost and data problem.

This forward test is the forward evidence the validation plan counts.
TradingView alerts, if set up, are only logged and compared with it; they
never drive it.

## Files in this folder

| File | What it is for |
|---|---|
| `README.md` | This overview. |
| `RULES.md` | The strategy rules in plain English, version 1.0.0, including the simulated account and cost assumptions. |
| `ENGINE-SPEC.md` | The engine's exact behaviour (box detection, signals, fills, sizing, outputs) and the known differences from the Pine version. |
| `VALIDATION-PLAN.md` | The pre-registered test plan: data, chronological split, rules for changing anything, acceptance criteria, stress tests, forward-test protocol. |
| `LAB-ARCHITECTURE.md` | How the Lab fits into Signal Desk: separate database, engine modules in `server/strategy/`, forward test, optional TradingView alert receiver, API routes, page and chat tools. |
| `PARAMETER-LOG.md` | Every change to rules, parameters, universe, split dates or acceptance criteria, with the reason and which data had been seen. |
| `configs/cb-1.0.0.json` | The machine-readable strategy config for version 1.0.0. Each later version gets a new file. |
| `universe-v1.json` | The 17 symbols chosen before any data was downloaded, with the AI/technology cluster tagged. |
| `splits-v1.json` | Warm-up, development, validation, holdout and forward periods, plus the walk-forward grid. |
| `acceptance-v1.json` | The pass/fail criteria (B1–B10, F1–F4), stress tests and neighbouring settings, fixed before any results. |
| `pine/consolidation_breakout_v1.pine` | The Pine Script v6 version of the strategy, for TradingView's Strategy Tester and alerts. Not yet compiled by TradingView (see below). |
| `RESEARCH-NOTES.md` | Every TradingView and Questrade fact the Lab relies on, with source links, status and open questions. |
| `QUESTRADE-ASSESSMENT.md` | Why there is no live trading, what Questrade's API and TradingView integration allow, the questions still open, and the pre-live checklist. |

## Where results will appear

- **The Strategy Lab page in Signal Desk** shows:
  - the simulated account, open simulated positions and active boxes;
  - a chart with each box, signal and trade;
  - the trade journal, with the reason for every decision;
  - each run's metrics, equity curve, report and acceptance outcome;
  - the strategy versions.
- **The Lab database** stores runs, trades, journal events, the forward
  test's state and the alert log:
  - `data/strategy-lab.sqlite` for the real workspace;
  - `data/strategy-lab-demo.sqlite` for the demo workspace, which holds
    synthetic data only.
- **Run reports**: each run stores a written report with its data hash,
  config hash and any flags (synthetic, contaminated holdout,
  end-of-data exits).
- **Ask Signal Desk**: read-only chat tools explain trades, risk, versions
  and where results come from. They cannot change rules or the simulated
  account.
- **TradingView's strategy report**: results from the Pine version stay in
  the owner's TradingView account. They can be compared with the engine's
  runs that use TradingView-style fill assumptions (`tv_path` and
  `limit_intrabar` in `ENGINE-SPEC.md`).

Results from synthetic data are always labelled synthetic. They are never
reported as performance.

## Unsupported features and remaining setup

**No results yet.** The build environment has no market data, so no backtest
or forward test has been run. Nothing in this folder reports performance.
Synthetic data is used only to test the engine and to demonstrate the page.

**A data source is needed.** Use one of these:

- **Twelve Data.** Put an API key in `.env` (`TWELVEDATA_API_KEY`, with
  `MARKET_DATA_PROVIDER=twelvedata`) and download history from the Lab.
  First check that the plan provides 15-minute history back to 2021-07-01
  for all 17 symbols, and how long its rate limits make the download.
- **TradingView CSV exports.** On a standard-candle, regular-session,
  15-minute chart, use "Download chart data…" for each symbol, then import
  the file in the Lab. As reported in `RESEARCH-NOTES.md` (section 7):
  - only the bars loaded on the chart are exported;
  - the number of intraday bars a chart loads depends on the TradingView
    plan;
  - the full test range is roughly 32,600 bars per symbol, and of the
    reported plan limits only 40,000 bars covers it in one load.

  The export's column names and time format were not confirmed. Check the
  first import's data-quality report, and confirm that the file includes
  volume, which the entry rule needs.
- **1-minute bars** are optional. They are used only to settle bars that
  touch both the stop and the target.

**The Pine script has not been compiled by TradingView.** It was written for
Pine Script v6 from TradingView's documentation (as summarized by search),
because the build environment cannot reach TradingView.

- It does run, without errors, in PineTS, an open-source third-party Pine
  runtime. On synthetic data (5 symbols, both modes) 34 of 39 of its trades
  were identical to the Signal Desk engine in TradingView-parity mode (same
  entry bar, price and shares, same exit bar and price). The rest were the
  documented differences: one entry where the next bar opened at or below the
  stop, and four one-share size differences from the Pine stop being rounded
  to the cent. Re-run it with `npm install --no-save pinets` and
  `node scripts/strategy-pine-parity.mjs --symbol NVDA --mode swing` (or
  `--csv <your 15-minute export>`). PineTS is not TradingView, so this checks
  that the two implementations follow the same rules, not that TradingView
  compiles or fills identically.
- Expect possible compile errors on first use in TradingView.
- The known differences from the engine are in `ENGINE-SPEC.md` section 8.
- Several of those differences rest on working assumptions not yet
  confirmed by TradingView's documentation (`RESEARCH-NOTES.md`, section
  12).

**TradingView webhooks are optional and need deliberate setup by the owner.**
The receiver is off unless `LAB_WEBHOOK_SECRET` (at least 24 random
characters) and `LAB_WEBHOOK_PORT` are set in `.env`. It journals alerts and
compares them with Signal Desk's own signals; it never places or changes
anything. It needs:

- **a paid TradingView plan.** Which current plans include webhooks is
  unconfirmed.
- **two-factor authentication** on the TradingView account.
- **a public URL on port 80 or 443** (HTTPS recommended), provided by a
  tunnel or reverse proxy that the owner sets up deliberately and that
  forwards only `POST /tradingview` to the local receiver. Signal Desk
  itself stays bound to 127.0.0.1.
- **a reply within 3 seconds.** TradingView cancels slower requests.

Also note:

- TradingView stops an alert that triggers more than 15 times in 3 minutes.
- Standard alerts expire.
- TradingView advises against putting credentials in alert messages. Read
  `RESEARCH-NOTES.md` sections 6 and 12 before choosing how to authenticate
  the receiver.

**No live trading.** The Lab places no real orders and no TradingView Paper
Trading orders. Moving beyond simulation requires everything in
`QUESTRADE-ASSESSMENT.md`: the pre-live checklist, and then a separate,
explicit instruction from the owner.

**Questrade automation is not available to personal apps.** Questrade's API
documentation, as found by search, reserves order placement (the `trade`
scope) for approved partner developers. A personal app can read account and
market data only (`RESEARCH-NOTES.md`, section 8; the owner should confirm
this is still current). Signal Desk has no broker connection and will not
get one under this brief.

**Plan-dependent TradingView features.** As reported, these need Premium or
higher:

- Deep Backtesting, which runs beyond the bars loaded on the chart;
- Bar Magnifier / high "Bar detalization", which uses lower-timeframe data
  for fills.

Without them, TradingView's results depend on the bars the plan loads and on
its assumed path inside each bar.

**Early closes.** Signal Desk's calendar handles 13:00 ET early closes. How
TradingView's session data handles them for US stocks is unverified. Compare
the two on a known half-day before trusting the Pine version's time exits on
those days.
