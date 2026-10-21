# TradingView setup: consolidation breakout v1.0.0 (simulation only)

This guide explains how to install and use the Pine Script version of the
strategy, `strategy/pine/consolidation_breakout_v1.pine`, in TradingView. It
also covers what TradingView can and cannot do, and how to compare its
results with Signal Desk's own engine.

- **Simulation only.** The script never places, routes or prepares a real
  order or a TradingView Paper Trading order. Its optional alerts go only to
  Signal Desk's simulation receiver, which journals them and never trades.
- **Research assumption, not a proven edge.** The rules come from your
  written brief (`RULES.md`, exact behaviour in `ENGINE-SPEC.md`, defaults in
  `configs/cb-1.0.0.json`). Signal Desk's engine produces the research
  results; TradingView is a cross-check.
- **The script has not been compiled.** It was written without access to
  TradingView. Expect to report compile errors on first use (section 2).

## How the facts in this guide are labelled

The research behind this guide could not open tradingview.com or
questrade.com pages directly. Every TradingView or Questrade fact below comes
from web-search results restricted to those official domains, and none was
independently re-verified. Details are in `RESEARCH-NOTES.md`. Menus, plan
limits and labels change often, so check anything plan-related on your own
account.

| Label | Meaning |
|---|---|
| **Search summary** | From the research's official-domain search results. Not re-verified; the page itself was not read. |
| **Search summary (setup pass)** | The same, from five searches made while writing this guide (2026-10-21). |
| **Likely** | Paraphrased, partial, old or indirect source, or an inference from two documented statements. |
| **Unverified** | No official source found. Do not rely on it. |
| **Project file** | Stated by a file in this repository, not by TradingView. |
| **Arithmetic** | Calculated here from the cited figures; not a TradingView statement. |
| **General steps** | Ordinary TradingView screen steps that the research did not cover. Labels on your screen may differ. |

---

## 1. Four different things, and what TradingView supports

| | What it is | Does this script do it? | What the sources say |
|---|---|---|---|
| **1. Historical backtest** | TradingView's broker emulator replays the rules on past bars and reports the results in the Strategy Tester (strategy report). | **Yes** | Strategies simulate orders with the broker emulator; the docs say the strategy report "closely mimics a paper trading account". **Search summary.** [Pine FAQ: Strategies](https://www.tradingview.com/pine-script-docs/faq/strategies/) |
| **2. Forward simulation in the broker emulator** | The same emulator keeps simulating on each new bar while the chart is open, or while a strategy alert's server-side copy runs. The fills are still simulated. | **Yes** (optional) | A strategy alert runs a copy of the strategy on TradingView's servers and fires only for orders the emulator executes in realtime, never for historical ones. **Search summary.** [Strategy alerts](https://www.tradingview.com/support/solutions/43000481368-strategy-alerts/) |
| **3. TradingView Paper Trading** | TradingView's separate virtual-money account, traded by hand from the Trading Panel. | **No** | Paper Trading is a built-in simulated account used from the Trading Panel. **Search summary.** [Paper trading: main functionality](https://www.tradingview.com/support/solutions/43000516466-paper-trading-main-functionality/). Pine strategies cannot place orders through it. **Search summary.** [Pine FAQ: Strategies](https://www.tradingview.com/pine-script-docs/faq/strategies/) |
| **4. Real broker execution** | Orders at a real broker, for example Questrade. | **No** | Pine does not support placing orders through brokers integrated in the Trading Panel. **Search summary.** [Pine FAQ: Strategies](https://www.tradingview.com/pine-script-docs/faq/strategies/). A help article says automated strategy trading with a brokerage account is not available on TradingView. **Search summary** (the article was reported as about 3.7 years old). [How to autotrade using Pine Script strategies](https://www.tradingview.com/support/solutions/43000481026-how-to-autotrade-using-pine-script-strategies/) |

**Questrade.** Questrade is a TradingView-integrated broker: you open the
Trading Panel, click the Questrade icon and sign in with your Questrade
credentials, then trade from the chart. **Search summary.**
[Questrade broker page](https://www.tradingview.com/broker/Questrade/),
[TradingView blog](https://www.tradingview.com/blog/en/questrade-on-tradingview-44778/).
From TradingView, that is manual chart trading: Pine strategies cannot send
orders to it (row 4). Questrade's own API documentation reserves order
placement for partner developers; a personal app can read account and market
data only. **Search summary** (the page was reported as about 11 years old).
[Questrade API](https://www.questrade.com/api). Nothing in this project
connects to Questrade. Moving beyond simulation needs everything in
`QUESTRADE-ASSESSMENT.md` and then a separate, explicit instruction from you.

**Alerts are the only automation route.** The Pine FAQ says traders can use
external tools that interpret alert signals sent by webhook and place trades;
TradingView itself does not place those orders. **Search summary** (the
cross-check noted that calling this a "route to automated execution" may
overstate the source).
[Pine FAQ: Strategies](https://www.tradingview.com/pine-script-docs/faq/strategies/),
[Pine FAQ: Alerts](https://www.tradingview.com/pine-script-docs/faq/alerts/).
Webhooks need a paid plan (**Likely**) and two-factor authentication
(**Search summary**); see section 10. In this project, alerts go **only** to
the Signal Desk simulation receiver. Never point them at a broker, a broker
bridge or any third-party execution service.

---

## 2. Install the script

**General steps** (not covered by the research; names on screen may differ):

1. Open a chart of a US stock or ETF from `universe-v1.json`.
2. Open the **Pine Editor** (a panel at the bottom of the chart window).
3. Start a new, empty script and replace everything in it with the full
   contents of `strategy/pine/consolidation_breakout_v1.pine`.
4. **Save** it, for example as "Consolidation Breakout v1.0.0".
5. Click **Add to chart**. The strategy draws on the price chart, and the
   **Strategy Tester** (strategy report) opens below it.

The first line, `//@version=6`, selects Pine Script v6; without it the
compiler assumes version 1. **Search summary.**
[Script structure](https://www.tradingview.com/pine-script-docs/language/script-structure/)

**If it does not compile**, do not change any rule to make it work. Report
back, for each message in the editor's console:

- the exact error or warning text;
- the line number;
- the text of that line in your copy.

The places most likely to need a fix are listed in section 12.

---

## 3. Chart settings

| Setting | Use | Why | Source |
|---|---|---|---|
| Timeframe | **15 minutes** | The rules are defined on completed 15-minute bars. The table warns on any other timeframe. | Project file (`RULES.md`) |
| Chart type | **Standard candles** (not Heikin Ashi, Renko, Kagi, Range, Point & Figure) | TradingView says backtests on non-standard charts give unrealistic, potentially misleading results. The script refuses new setups on non-standard charts. | **Search summary.** [Non-standard charts](https://www.tradingview.com/support/solutions/43000481029-strategy-produces-unrealistic-results-on-non-standard-chart-types-heikin-ashi-renko-etc/) |
| Session | **Regular trading hours; extended hours (ETH) off** | Extended-hours bars would enter the box window and the ATR. Extended-hours data is turned on with the ETH button or in the symbol's session settings, and `syminfo.session` reads "extended" only when you select it. The script refuses new setups when it sees extended-hours bars. | **Search summary** (the menu path may be outdated). [Sessions](https://www.tradingview.com/pine-script-docs/concepts/sessions/) |
| Price adjustment | **Split-adjusted; dividend adjustment off** | The engine uses split-adjusted, not dividend-adjusted prices. The research did not cover TradingView's adjustment settings. Look in the chart's symbol settings for a dividend-adjustment option (the brief calls it "Adjust data for dividends") and turn it off. Check that splits are adjusted. | **Unverified** (setting names and defaults not researched) |
| Time zone | **Exchange** (New York) | The comparison script reads exported times in New York time unless you pass `--tz`. | Project file (`scripts/strategy-compare-tv.js`) |
| Symbol | A **US-listed stock or ETF priced in USD** | The session rules assume New York hours, and the strategy account is USD. The table warns otherwise. | Project file |

---

## 4. Strategy Properties

Open the strategy's settings (**General steps**: the gear icon next to its
name on the chart, or in the Strategy Tester) and check the **Properties**
tab. The script's `strategy()` line sets these defaults. A value you change
there overrides the default for that chart, and **the script cannot see most
of these values**, so its table cannot warn you about them.

Several labels changed in July 2026. The research found the new names but
not the full option lists.

| Setting (label since July 2026) | Use | Why | Source |
|---|---|---|---|
| Initial capital | **100,000** | The hypothetical US$100,000 simulated account (`risk.hypotheticalStartingEquity`). It is separate from your real portfolio. | Project file |
| Base currency | **USD** | Default is the chart's quote currency; with another account currency, values are converted, typically at the previous day's rate. | **Search summary.** [Concepts: Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/) |
| Order size | Leave as is (ignored) | Every order passes its own share quantity, which overrides the default size. | **Search summary.** [Concepts: Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/) |
| Pyramiding | **1** | One position per symbol, never added to. | **Search summary** (pyramiding limits `strategy.entry()` orders). [Concepts: Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/) |
| Commission | **0.045 %** (percent type) | Approximates the engine's commission ($0.005/share) plus half spread (2 bps) plus slippage (2 bps) per fill. TradingView applies one commission model to every fill. Commission types are percent, cash per order and cash per contract; the default value is 0. | **Search summary.** [Declaration statements](https://www.tradingview.com/pine-script-docs/language/declaration-statements/) |
| Slippage | **0** | Slippage is a number of ticks on market and stop orders only, so it cannot express basis points; costs are in the commission instead. | **Search summary.** [Declaration statements](https://www.tradingview.com/pine-script-docs/language/declaration-statements/) |
| **Limit order execution** (was "Verify price for limit orders") | **One tick** beyond the limit | The target must trade one tick through it before it fills, as in the engine (`limitFillTicksBeyond`). The script sets `backtest_fill_limits_assumption = 1`, which sets this default. | Rename: **Search summary.** [Release notes](https://www.tradingview.com/pine-script-docs/release-notes/). Option list: **Unverified** (one summary mentioned "fill on reaching the level" and "one tick beyond it") |
| **Order execution delay** (replaced the "fill orders on bar close" checkbox) | **Keep the script's default.** Do **not** choose "None". | The script sets `process_orders_on_close = false`: an order created at a bar's close fills at the next bar's open, as in the engine. "None" sets the delay on closed bars to zero ticks. | **Search summary.** [Concepts: Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/), [Release notes](https://www.tradingview.com/pine-script-docs/release-notes/). Other options: **Unverified** |
| **Script execution** menu (new in July 2026) | **Everything off** | Its defaults come from `calc_on_every_tick`, `calc_on_every_history_tick` and `calc_on_order_fills`, which the script sets to false. Tick-by-tick calculation can make realtime orders differ from history (repainting), and `calc_on_order_fills` can look ahead on history. "On history bar tick" maps to `calc_on_every_history_tick` (Premium and Ultimate, standard charts). | **Search summary.** [Release notes](https://www.tradingview.com/pine-script-docs/release-notes/), [Repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/). Other option labels: **Unverified** |
| **Bar detalization** (replaced "Using bar magnifier") | **Default.** "High" only if your plan allows it (see below). | | **Search summary.** [Concepts: Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/), [Release notes](https://www.tradingview.com/pine-script-docs/release-notes/) |
| **Long leverage / Short leverage** (replaced the margin inputs) | **1** | No margin and no leverage. The script sets `margin_long = margin_short = 100`, which is 1:1. That the leverage input shows 1 for this is implied, not stated verbatim. | **Search summary** for the margin default and the rename; **Likely** for "1". [To Pine Script version 6](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/) |
| Heikin Ashi mode | Not used | Appears only on Heikin Ashi charts. | **Likely.** [Release notes](https://www.tradingview.com/pine-script-docs/release-notes/) |

**Bar detalization "High".** Without it, TradingView assumes the path
inside each bar: if the open is nearer the high, open → high → low → close;
if nearer the low, open → low → high → close. **Search summary.**
[Concepts: Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/).
With "High" (formerly Bar Magnifier), the emulator uses lower-timeframe data
for fills inside historical bars, with the lower timeframe chosen
automatically and a cap of 200,000 lower-timeframe bars. Only Premium and
Ultimate can select it, whatever the script sets. **Search summary.**
[What is Bar Magnifier](https://www.tradingview.com/support/solutions/43000669285-what-is-bar-magnifier-backtesting-mode/).
How many ticks each level simulates: **Likely** (search summaries
conflicted). [Bar detalization](https://www.tradingview.com/support/solutions/43000786180-bar-detalization/)

What it changes here: mainly bars that touch both the stop and the target,
and limit entries filled inside the bar. With "High", TradingView's answer
should move towards the engine's runs that use 1-minute data. The engine's
default (stop first) stays more conservative. Record which setting you used
next to any result.

---

## 5. Intraday and Swing are separate setups

The two modes are separate configurations and are reported separately
(`RULES.md` section 5). Never add their results together.

- Add the strategy **twice** (or use two charts), and set the **Mode** input
  (group 5) to **Intraday** on one and **Swing** on the other. Each copy is
  its own US$100,000 simulated account.
- **Intraday**: a market exit is placed at the close of the first bar ending
  at or after 15 minutes before the close, so it fills at the open of the
  last bar (15:45 ET; 12:45 ET on early-close days). Nothing is held
  overnight. No new entries from breakout bars ending within 60 minutes of
  the close, or from the session's last bar.
- **Swing**: positions are held overnight for up to 10 sessions (the entry
  session is session 1) and closed the same way on the 10th. A gap through
  the stop fills at the open, so a loss can be larger than the planned risk.
- Name each copy clearly, and keep the mode in the file names of anything you
  export.

---

## 6. The test window (protects validation and holdout data)

The Strategy Tester shows results for every bar loaded on the chart. Under
`VALIDATION-PLAN.md`, 2024 is validation and **2025-01-01 to 2026-06-30 is
the holdout**, run once per version in the Strategy Lab. Seeing the
strategy's results for those dates in TradingView would count as seeing that
data.

So the script only looks for new setups inside a **test window** (input
group 0). The default is the development period, **2022-01-01 to
2024-01-01** (exclusive). Bars outside the window still load and warm up the
ATR, but no trades start there.

How far back a chart reaches depends on the plan. Charts load at most 5,000
intraday bars on Basic, 10,000 on Essential and Plus, 20,000 on Premium,
25,000 on Expert and 40,000 on Ultimate, and TradingView says this cannot
currently be extended. **Search summary.**
[Intraday bars and limits](https://www.tradingview.com/support/solutions/43000480679-historical-intraday-data-bars-and-limits-explained/)

A regular session has 26 fifteen-minute bars (14 on an early-close day).
Counting back from 2026-10-20 with Signal Desk's NYSE calendar, regular
session only (**Arithmetic**):

| Plan | Bars | Sessions | Reaches back to about | Development period (2022–2023) on the chart |
|---|---|---|---|---|
| Basic | 5,000 | 193 | 2026-01-14 (inside the holdout) | none |
| Essential, Plus | 10,000 | 386 | 2025-04-08 (inside the holdout) | none |
| Premium | 20,000 | 773 | 2023-09-21 | about the last three months of 2023 |
| Expert | 25,000 | 966 | 2022-12-13 | almost all of 2023 |
| Ultimate | 40,000 | 1,544 | 2020-08-27 | all of it |

For comparison, the pre-registered range 2021-07-01 to 2026-06-30 has 1,254
sessions and about 32,500 bars (**Arithmetic**), so only the 40,000-bar
limit covers it in one chart.

What to do with this:

- **If the table says "No loaded bar is inside the test window"**, the chart
  does not reach 2022–2023. Use Deep Backtesting (section 9) with the date
  range 2022-01-01 to 2023-12-31, if your plan has it, or use the
  post-holdout period below.
- **For parity checks against the engine** (section 8), the safest period is
  after the holdout: set the window start to **2026-07-01** and the end far
  in the future. 2026-07-01 to 2026-10-20 is 78 sessions, about 2,000 bars
  (**Arithmetic**), which every plan loads. That period belongs to none of
  the pre-registered splits.
- **For a forward simulation**, set the start to the day you begin and the
  end far in the future.
- **Validation (2024) or holdout dates**: only after the Strategy Lab's own
  runs for this version are done, and only knowing that anything you learn
  there cannot be used to change version 1.0.0 without the new version
  counting that data as seen. If you do look, record it in the Strategy Lab
  or `PARAMETER-LOG.md`.

Turning the window off makes the Strategy Tester show every loaded bar,
including holdout dates on most plans.

---

## 7. Reading the chart and the table

**Boxes** (the 20-bar window of each eligible setup):

| Colour | Meaning |
|---|---|
| Blue | **Armed**: eligible and frozen; waiting up to 10 bars for a close above the ceiling. Its label shows the height in ATR and the touches (upper/lower). |
| Purple | **Consumed** by a breakout candle (one decision per box), whether it led to an order or was rejected. |
| Grey | **Expired**: no close above the ceiling within 10 bars. |
| Red | **Invalidated**: a close below the floor. |

**Labels:**

- Green, above a bar: **breakout accepted**. Buy limit (the maximum entry
  L), stop, target, reward/risk at L, shares, which limit was binding (gap or
  reward/risk) and the volume ratio. Hover for the box's window, touch times
  and ATR.
- Orange, above a bar: **breakout rejected**, with the rule that rejected it
  (volume missing, volume too low, past the target, stop/limit, cost, time of
  day, size, or outside the test window).
- Grey, above a bar: **entry cancelled**. The limit was not filled during
  the one bar it was valid; the label says why.
- Yellow, below a bar: **a fill that differs from the Signal Desk engine**:
  "intrabar limit fill — differs from Signal Desk engine" (the bar opened
  above L and came back to it), or "opened at or below the stop" (the engine
  skips such entries).

**Lines** for each order: the maximum entry (dotted, becomes solid at the
fill price), the stop (red) and the target (green). They run until the trade
closes. Stops and targets never move.

TradingView's own trade markers show the order names: `CB<n>` for entries,
and exit comments `stop`, `target`, `flatten` (intraday time exit),
`max_hold` (swing time exit), `session_end_fallback` (the flatten bar was
missing; closed at the session's last close), `max_hold_overdue` and
`missed_flatten` (safety nets that should not normally appear).

**The table** (top right):

| Row | Shows |
|---|---|
| SIMULATION ONLY | A reminder that nothing here is an order. |
| Strategy | The version, and whether every input still has its cb-1.0.0 default. If not, the results are not version 1.0.0. |
| Mode, Box, Entry and exit, Risk and costs | The settings in force, and today's session close (16:00, or 13:00 on an early close). |
| Test window | The dates in which new setups may start. |
| Setups, Breakouts, Rejections | Counts of eligible boxes and how they ended; orders placed; rejections by reason. |
| Entries | Orders filled, and orders cancelled after one bar. |
| Engine differences | Intrabar limit fills, fills at or below the stop, and "TradingView missed fills" (the open was at or below L but TradingView did not fill). |
| Exits | Stop, target, time and other exits. |
| Now, Last event | The current state (scanning, armed, order pending, in position) and the latest decision. |
| Warnings | Extended hours, non-standard chart, timeframe, time zone, currency, no bars in the test window, changed inputs. |

The **Data Window** also lists the strategy's ATR, the volume average, the
armed ceiling and floor and the state number, plus the bar's volume as
"Volume". These may be included in "Download chart data" (**Unverified**).

---

## 8. First-run checklist

1. **Compile.** Report any errors as described in section 2.
2. **Table.** Check that it says SIMULATION ONLY and "cb-1.0.0 defaults",
   and that the Warnings row says "none" (apart from the test-window note,
   if your plan does not reach the window).
3. **Properties.** Check every row of section 4, and note the exact option
   names you see in Limit order execution, Order execution delay, Bar
   detalization and Script execution.
4. **One box by hand.** Pick a blue or purple box. Check that the ceiling and
   floor are the highest high and lowest low of its 20 bars, the height is at
   most 3 ATR, and there are at least 2 touches of each edge at least 2 bars
   apart.
5. **An exit on the entry bar.** Find a trade whose entry bar also reached
   the stop or the target. Check whether TradingView exited on that bar.
   The script places the stop and target together with the entry order. The
   research could not confirm whether Pine v6 attaches an exit to an entry
   that has not filled yet (only older manuals describe it). If TradingView
   did not exit on that bar, report it.
6. **An early-close day.** Look at a 15-minute chart on 2025-07-03,
   2025-11-28 or 2025-12-24 (13:00 ET closes by Signal Desk's calendar).
   With the default test window no trades appear there, so you see prices
   only. Check that the last bar starts at 12:45. How TradingView's session
   data handles early closes is **Unverified**; the script uses its own
   calendar rule (the same as `server/calendar.js`). The next early closes
   are 2026-11-27 and 2026-12-24.
7. **Compare a few trades with the Signal Desk engine** (below).
8. **Report back:** compile messages; the Warnings row; the comparison
   summary; what you saw on the early-close day and the entry-bar exit; the
   header rows of both CSV exports; and the Properties option names.

### Comparing with the Signal Desk engine

Use the post-holdout window (section 6: start 2026-07-01) or development
dates, never validation or holdout dates.

1. On the chart, with the strategy's window set, load the bars you need by
   scrolling left. Add TradingView's Volume indicator too, so the export has
   a volume column (the entry rule needs volume).
2. Export the bars with **Download chart data…** (formerly "Export chart
   data…") from the dropdown on the upper toolbar. Only bars loaded on the
   chart are exported; the file has time, OHLC and any plots from scripts on
   the chart. **Search summary.**
   [How to export chart data](https://www.tradingview.com/support/solutions/43000537255-how-to-export-chart-data/).
   Exact column names and time format: not confirmed. Which plans include
   it: not known for the current plans.
3. Export the trades with the **Download** button at the top right of the
   strategy report's **Trades** tab. The CSV contains all columns, whatever
   the column setup shows. **Search summary.**
   [How to export strategy data](https://www.tradingview.com/support/solutions/43000613680-how-to-export-strategy-data/).
   Current column names: **Likely**; the comparison script accepts several
   variants. Which plans include it: **Unverified**.
4. Run the comparison (**Project file**: `scripts/strategy-compare-tv.js`;
   `--help` prints the current options):

   ```
   node scripts/strategy-compare-tv.js --trades "<trades export>.csv" --data "<chart export>.csv" --symbol NVDA --mode intraday --from 2026-07-01 --to 2026-10-20 --out compare-nvda-intraday.json
   ```

   Use `--mode swing` for the Swing copy. Pass `--tz` only if your chart's
   time zone is not New York. The script runs the engine on the same bars in
   TradingView-parity mode (TradingView's assumed path inside bars,
   intrabar limit entries, one symbol), matches trades by entry time within
   15 minutes, and prints the matched trades, the differences and the trades
   found on one side only.

What to expect:

- Most matched trades should have the same entry and exit times and prices
  within half a tick, and the same quantity.
- The first days after `--from` can differ: TradingView's ATR started at the
  first loaded bar, the engine's at `--from` (difference g in section 11).
- Quantities can differ slightly because TradingView's equity includes its
  own commission (difference h).
- "Only in TradingView" or "only in the engine" trades should be explained
  by section 11. If one is not, report it.

---

## 9. History limits and Deep Backtesting

- **Chart mode** uses only the bars loaded on the chart (section 6 table).
- **Deep Backtesting** (Premium and higher) runs a strategy over stored
  history for a date range you choose, rather than only the loaded bars, up
  to 2 million bars per calculation and 1 million trades. Its results appear
  only in the strategy report; chart markers, plots and alerts still use the
  loaded bars. **Search summary.**
  [How Deep Backtesting works](https://www.tradingview.com/support/solutions/43000666265-how-deep-backtesting-works/),
  [Data for Deep Backtesting](https://www.tradingview.com/support/solutions/43000668210-how-much-data-is-available-for-deep-backtesting/).
  How far back TradingView stores 15-minute history for each symbol was not
  researched.
- **Deep Backtesting can differ from chart mode**: it starts calculating
  earlier, and averages such as RMA (the ATR) depend on where they start.
  **Search summary.**
  [Regular mode vs Deep Backtesting](https://www.tradingview.com/support/solutions/43000666266-why-do-the-data-of-the-regular-mode-and-deep-backtesting-not-match/)
- **Trade retention**: on the default range a strategy keeps individual data
  for only the latest 9,000 trades; with Deep Backtesting it keeps all of
  them. Trimmed trades are missing from the report and its downloads.
  **Search summary.**
  [Concepts: Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/).
  (A 1,000,000-order limit is also reported for Deep Backtesting; how the two
  statements fit together was not settled.)
- In Deep Backtesting, set the date range to the test window. The script's
  window still applies on top of it.

---

## 10. Alerts (optional; Signal Desk simulation receiver only)

Alerts are only for the forward simulation. Signal Desk journals them and
compares them with its own signals; they never drive the simulated account
and never place anything (**Project file**: `LAB-ARCHITECTURE.md`,
`VALIDATION-PLAN.md`).

### What TradingView requires

| Requirement | Source |
|---|---|
| A paid plan. Which current plans include webhooks was not determined. | **Likely** (old blog post: "paid users only"). [Webhooks blog post](https://www.tradingview.com/blog/en/webhooks-for-alerts-now-available-14054/) |
| Two-factor authentication on the TradingView account. | **Search summary.** [How to configure webhook alerts](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/), [2FA setup](https://www.tradingview.com/support/solutions/43000572460-how-to-configure-2fa/) |
| A URL on port **80 or 443** only; IPv6 does not work; a URL that resolves to a private or internal address is refused. | **Search summary.** [Port numbers](https://www.tradingview.com/support/solutions/43000529314-i-cannot-send-webhook-to-a-url-with-a-port-number/) |
| The receiver must answer within **3 seconds**, or TradingView cancels the request. | **Search summary.** [How to configure webhook alerts](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/) |
| Requests come from 52.89.214.238, 34.212.75.30, 54.218.53.128 and 52.32.178.7. | **Search summary**, from pages about 3.5–4 years old; check the alert dialog for the current list. |
| A request is a POST with the message as its body: `application/json` if the message is valid JSON, otherwise `text/plain`. | **Search summary.** |
| Resends happen only after HTTP 500–599 responses other than 504, 5 seconds apart, at most 3 times. No retry is documented for timeouts. | **Search summary.** [Webhook resubmission](https://www.tradingview.com/support/solutions/43000735201-webhook-resubmission/) |
| Over HTTPS, TradingView presents a client certificate (CN = webhook-server@tradingview.com) the receiver can check. | **Search summary.** [Webhook authentication](https://www.tradingview.com/support/solutions/43000680459-webhook-authentication/) |

The Signal Desk receiver is off unless `LAB_WEBHOOK_SECRET` (at least 24
random characters) and `LAB_WEBHOOK_PORT` are set in `.env`. It listens on
127.0.0.1, accepts only `POST /tradingview`, and is meant to sit behind a
tunnel or reverse proxy that you set up deliberately and that forwards only
that path. **Project file** (`LAB-ARCHITECTURE.md`).

### The secret

Put the same value as `LAB_WEBHOOK_SECRET` in the script's **Webhook
secret** input (group 8). It is hidden from the chart's status line but
stored with the script's inputs, in your chart layout and inside every
alert you create. `input.string()` treats backslashes literally, and the
script escapes quotes and backslashes when it writes the JSON. **Search
summary (setup pass).** [Concepts: Inputs](https://www.tradingview.com/pine-script-docs/concepts/inputs/)

TradingView advises against putting credentials in the webhook URL or
message, and recommends authenticated endpoints. **Search summary.**
[Using credentials for webhooks](https://www.tradingview.com/support/solutions/43000722015-using-credentials-for-webhooks/).
This secret is a random token for this one receiver, not a password for
TradingView, Questrade or Signal Desk. Anyone who obtained it could only add
entries to the simulation journal, because the receiver never trades
(**Project file**). Read that article and decide; checking TradingView's
client certificate over HTTPS is the documented alternative.

### Creating the alert

1. Finish all settings first. An alert keeps a snapshot of the script, its
   inputs and the chart's symbol and timeframe; after any change, delete the
   alert and create it again. **Search summary.**
   [Concepts: Alerts](https://www.tradingview.com/pine-script-docs/concepts/alerts/)
2. Create an alert on the strategy (**General steps**: the alert button, then
   choose the strategy as the condition). One alert per chart and mode.
3. **Condition**: "Order fills and alert() function calls". The other
   choices are "Order fills only" and "alert() function calls only".
   **Search summary.**
   [Getting started with technical alerts](https://www.tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts/)
4. **Frequency**: in a strategy, `alert()` fires only at the close of
   realtime bars (unless `calc_on_every_tick` is on, which it is not).
   **Search summary.** If the dialog offers a frequency, choose **Once per bar
   close**, which fires only when the realtime bar closes. **Search summary.**
   [Alert frequencies](https://www.tradingview.com/support/solutions/43000474415-differences-between-alert-frequencies/).
   Whether the strategy alert dialog shows a frequency at all:
   **Unverified.**
5. **Message**: exactly `{{strategy.order.alert_message}}`. For order fills,
   TradingView puts each order's `alert_message` text there. **Search
   summary.** [Pine FAQ: Alerts](https://www.tradingview.com/pine-script-docs/faq/alerts/).
   For the stop and target, the exit's `alert_loss` / `alert_profit` text is
   used, depending on which side filled. **Search summary (setup pass).**
   [v5 release notes](https://www.tradingview.com/pine-script-docs/v5/release-notes/).
   The `alert()` calls carry their own JSON. How the Message field combines
   with `alert()` calls was not verified: check the receiver's log after the
   first alerts.
6. **Webhook URL**: only your Signal Desk receiver's public URL (port 443,
   path `/tradingview`). Never a broker, a broker bridge or a third-party
   execution service.
7. **Expiration**: a standard alert lives at most two months; Premium and
   Ultimate can set open-ended alerts. **Search summary.**
   [Introduction to alerts](https://www.tradingview.com/support/solutions/43000520149-introduction-to-tradingview-alerts/)

Also note:

- Alerts run on TradingView's servers whether or not your chart is open.
  **Search summary.**
  [Alerts and an open computer](https://www.tradingview.com/support/solutions/43000548327-will-alerts-work-if-tradingview-is-not-open-on-the-computer/)
- An alert is stopped automatically if it triggers more than 15 times in 3
  minutes. **Search summary.**
  [Triggered too often](https://www.tradingview.com/support/solutions/43000690939-alert-was-triggered-too-often-and-stopped/).
  This script sends at most a few messages per 15-minute bar on one symbol.
- Live alerts can differ from the backtest, because history uses the
  assumed path inside each bar while realtime uses actual ticks. **Search
  summary.**
  [Repainting support article](https://www.tradingview.com/support/solutions/43000478429-script-or-strategy-gives-different-results-after-refreshing-the-page-repainting/)

### What the messages contain

Every message is one JSON object (**Project file**: the script):

| Field | Content |
|---|---|
| `source`, `strategy`, `version`, `mode` | `"tradingview"`, `"consolidation-breakout"`, `"1.0.0"`, `"intraday"` or `"swing"` |
| `event` | `order_placed`, `signal_rejected`, `entry_cancelled` (from `alert()`); `setup_eligible`, `setup_expired`, `setup_invalidated` (from `alert()`, only if "Also send setup alerts" is on); `entry_filled`, `exit_filled` (order-fill alerts) |
| `symbol`, `exchange`, `timeframe` | `syminfo.ticker`, `syminfo.prefix`, the chart timeframe |
| `barTime`, `barCloseTime` | Open and close time (UNIX milliseconds) of the bar at whose close the message was built |
| `timenow` | The script's clock (UNIX ms) when the message was built |
| `setupId`, `orderId` | `B<n>` for the box; `CB<n>` for the entry and `CB<n>x` for exits; `null` when not applicable |
| `prices` | `open`, `close`, `resistance`, `support`, `height`, `boxAtr`, `atr`, `stop`, `target`, `maxEntry`, `gapLimit`, `rrLimit`, `entry` (`null` when not applicable) |
| `touchesUpper`, `touchesLower`, `binding`, `qty`, `volume`, `avgVolume`, `reason` | The box's touches; which limit set the maximum entry; shares; the bar's volume and the previous bars' average; the reason for a rejection, cancellation or exit (`stop`, `target`, `flatten`, `max_hold`, `session_end_fallback`, `max_hold_overdue`, `missed_flatten`) |
| `secret` | The Webhook secret input |

Numbers are unquoted. Points for the receiver:

- Fill messages are written when the order is placed or re-issued, so their
  `barTime` is earlier than the fill: the signal bar for `entry_filled`, and
  the previous bar for `exit_filled`. After an overnight hold, that is the
  previous session's last bar, about 17.5 hours earlier. A receiver that
  rejects old bars must allow for this on fill events.
- The prices in fill messages are the planned ones. The actual fill price is
  not included, because the script cannot know it when it writes the
  message.
- `setupId` and `orderId` count from the first bar the script calculated, so
  they differ between your chart and the alert's server-side copy, and after
  a reload. Deduplicate on symbol, mode, event and `barTime` as well.
- Alert placeholders such as `{{timenow}}` are not used inside the JSON;
  whether TradingView expands them there was not verified.

---

## 11. Known differences from the Signal Desk engine

The engine's results are the research results. These differences are
expected (`ENGINE-SPEC.md` section 8, plus details from writing the script):

| | Difference | How to see it |
|---|---|---|
| a | **Portfolio limits** (3 positions, 1 % combined open risk, shared cash) cannot be enforced: each chart is a separate single-symbol account. Only the per-trade risk and one position per symbol apply. | Compare per-symbol results only. |
| b | **No immediate-or-cancel order.** The entry is a buy limit at L, valid for one bar and cancelled at its close. If the bar opens above L and comes back to it, TradingView fills inside the bar; the engine's default skips it. | Yellow "intrabar limit fill" labels; table row "Engine differences". The comparison script's parity mode (`limit_intrabar`) reproduces them. |
| c | **Open at or below the stop.** The engine skips the entry; TradingView fills the limit at the open, and the stop then triggers. | Yellow labels; "fills at or below the stop". |
| d | **Costs.** TradingView charges 0.045 % on every fill, including the target, where the engine charges no spread or slippage. The engine's per-share commission has a $1 minimum. The maximum entry, cost check and sizing use the engine's cost inputs. | Small P&L differences on every trade. |
| e | **Bars that touch both the stop and the target.** TradingView uses its assumed path, or lower-timeframe data with "High" detalization. The engine's default is stop first. That TradingView fills whichever side its path reaches first is **Likely** (an inference; no sentence says so). | Exit differences on wide bars. The parity mode uses the same path assumption. |
| f | **One-tick limit verification** also applies to the entry limit, so an open exactly at L, or within a tick of it, may not fill in TradingView. **Unverified.** | "TradingView missed fills" in the table. |
| g | **ATR start.** TradingView's ATR starts at the first loaded bar; the engine's at the first bar of its data. | Early trades after `--from` may differ. |
| h | **Sizing** uses TradingView's equity (after its own commission) and a 0.1 % cash buffer; it ignores the engine's commission cap of 1 % of value. | Quantities differ by a few shares at most. |
| i | **Early closes** are encoded by rule (13:00 ET on July 3 and December 24 when Monday to Thursday, and the day after Thanksgiving), as in `server/calendar.js`. TradingView's own session data for these days: **Unverified**. Unplanned closures are not in the rule. | First-run check 6. |
| j | **End of data.** An open trade stays open in TradingView's report; the engine closes it at the last close and flags it `end_of_data`. | The comparison shows an open TradingView trade. |
| k | **Data.** Bars and volume come from TradingView's feed, which can differ from Signal Desk's provider. Swing holds count sessions that have bars on the chart; the engine counts calendar sessions. | Rare differences in boxes, volume ratios and hold length. |
| m | **Time boundaries.** "Within 60 minutes of the close" means the breakout candle *closes later than* 60 minutes before the close (strictly), as in `ENGINE-SPEC.md` and the engine: a 14:45–15:00 breakout is allowed and enters at the 15:00 open. | None. |
| n | **Test window.** New setups start only inside the window (section 6); the engine selects dates with its own run settings. | Set `--from` and `--to` to match. |

---

## 12. Not verified here

Open questions, from `RESEARCH-NOTES.md` and from writing the script.
Nothing below should be treated as fact until checked.

**The script**

- It has never been compiled. Pine function signatures were not checked
  against the v6 Reference Manual, which never appeared in search results.
  The places most likely to need a fix:
  - the `strategy()` parameter list;
  - `strategy.exit()` with `comment_profit`, `comment_loss`, `alert_profit`
    and `alert_loss`. **Search summary (setup pass)**: these parameters
    exist ([v5 release notes](https://www.tradingview.com/pine-script-docs/v5/release-notes/));
  - `strategy.closedtrades.exit_comment()`. **Search summary (setup pass)**:
    added in December 2022
    ([Release notes](https://www.tradingview.com/pine-script-docs/release-notes/));
  - the `\\` and `\"` escapes in the JSON helper. **Search summary (setup
    pass)**: both are supported
    ([Concepts: Strings](https://www.tradingview.com/pine-script-docs/concepts/strings/));
  - the wrapped `strategy()` call. Since December 2025, wrapped lines inside
    parentheses may use any indentation. **Search summary (setup pass).**
    [Script structure](https://www.tradingview.com/pine-script-docs/language/script-structure/)
- Whether a `strategy.exit()` placed while its entry is still pending covers
  that entry once it fills (first-run check 5). Only the v3/v4 manuals
  describe it. [v4 Strategies](https://www.tradingview.com/pine-script-docs/v4/essential/strategies/)
- Whether `backtest_fill_limits_assumption = 1` also delays an entry limit
  that is reached at the open (difference f).
- Whether data-window plots are included in "Download chart data".
- Whether alert placeholders are expanded inside `alert()` and
  `alert_message` text, and how the alert's Message field combines with
  `alert()` calls.

**TradingView behaviour**

- The option lists of the July 2026 menus: Bar detalization, Limit order
  execution, Order execution delay, Script execution. The default of
  `use_bar_magnifier` (believed false) was not explicitly confirmed.
- Whether NYSE/Nasdaq 13:00 ET early closes are in TradingView's session
  data for US stocks, and how `session.islastbar_regular` and `time_close`
  behave on those days. `session.islastbar_regular` may be true for no bar
  at all if the last bar gets no updates. **Search summary.**
  [Sessions](https://www.tradingview.com/pine-script-docs/concepts/sessions/)
- How strategies fill orders on pre-market and after-hours bars (the script
  avoids them).
- Which side fills when the stop and target are both inside one bar
  (**Likely**: the one reached first on the assumed path), and whether the
  gap-fills-at-the-open rule also applies between lower-timeframe bars with
  "High" detalization.
- Whether percent commission is charged on the slippage-adjusted price.
- That `ta.atr` is Wilder's RMA of true range is **Likely** (the source is
  the Charting Library docs, not the Pine reference). On a regular-session
  chart, whether a session's first true range uses the previous session's
  last close is **Likely**. Compare `ta.atr` with the engine on the same
  bars.
- Whether a symbol with no volume is reliably detected by
  `syminfo.volumetype` (the script checks each bar's volume instead).
- Whether a Pine release newer than September 2026 exists.

**Plans and exports**

- Which current plans include webhooks, chart data export, trade-list CSV
  and report XLSX export.
- The exact header names and time format of both CSV exports, and whether
  volume is exported only when the Volume indicator is on the chart.
- How far back TradingView stores 15-minute history for Deep Backtesting,
  and how the "all trades" and 1,000,000-order statements fit together.
- Active-alert counts and alert expiry on Basic, Essential and Plus.
- Whether the webhook source-IP list is current, whether webhooks can carry
  custom headers, and whether there is a maximum body size.

**Chart settings**

- The name and default of TradingView's dividend-adjustment setting, and
  whether split adjustment is on by default.

**Paper Trading and Questrade** (outside this script; for completeness of
section 1)

- Whether Paper Trading applies slippage, and which asset classes it
  supports.
- Which order types and account types the Questrade integration supports,
  and whether it needs a paid TradingView plan.
- Whether Questrade's "partner developers only" rule for API trading is
  still current, and whether personal-app registration is open.
- Eligibility and mechanics of Questrade's AI-agent (MCP) connection
  (`RESEARCH-NOTES.md` section 10). It is not used by this project.
