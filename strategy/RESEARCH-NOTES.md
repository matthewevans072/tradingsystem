# TradingView and Questrade research notes

Collected on 2026-10-21 for the Strategy Lab. This file lists every
TradingView and Questrade fact the Lab relies on: where it came from, how far
it can be trusted, and what is still open. Other files in `strategy/` point
here instead of repeating sources.

## How the research was done, and its limits

- **No page was read directly.** The build environment could not fetch pages
  from tradingview.com or questrade.com (direct fetches failed with a DNS
  error). Every item below comes from web-search results restricted to those
  official domains: the search tool's summary of a page, sometimes with quoted
  fragments. A "quote" here is what the search tool reported, not text
  checked on the page itself.
- **Nothing was independently re-verified.** A second-pass cross-check was
  planned for every item. It ran out of the shared search budget before it
  could run a single search, so no item was confirmed a second time. Where
  that pass recorded doubts about wording, they are noted below. Its notes
  from memory are not evidence and are not used as such.
- **Four extra searches** were run while these notes were written (Questrade's
  AI/MCP guide, the Questrade API trading rule, TradingView webhook headers,
  and the Questrade–TradingView integration). They have the same limitation
  and are marked "this pass".
- **Age.** The search tool reported several Questrade API documentation pages
  as about 3,960 days old (about 11 years), and some TradingView support
  articles as 3–4 years old. A page can still be live and out of date.
- Plan names, prices, limits and menu labels change often. Anything that
  depends on a plan should be checked on the owner's own account.

### Status labels

| Label | Meaning |
|---|---|
| **Search summary** | Supported by a search result from the official domain (tradingview.com or questrade.com). Not re-verified; the page was not read directly. |
| **Search summary (this pass)** | The same, from the four searches made while writing these notes. |
| **Likely** | The source is paraphrased, partial, old or indirect, or the item is an inference from two documented statements. |
| **Unverified** | No official source was found. Not to be relied on or presented as fact. |

None of these labels means "independently verified".

---

## 1. What TradingView does and does not do with orders

Used by: `README.md` (the four distinct things), `QUESTRADE-ASSESSMENT.md`,
`LAB-ARCHITECTURE.md`.

- Pine Script strategies and indicators cannot place orders directly. Pine
  does not support placing orders through brokers connected in the Trading
  Panel, or through TradingView's built-in Paper Trading account. Strategies
  simulate orders with the broker emulator; the docs say the strategy report
  "closely mimics a paper trading account".
  **Search summary.** [Pine FAQ: Strategies](https://www.tradingview.com/pine-script-docs/faq/strategies/)
- The help article "How to autotrade using Pine Script strategies" says
  automated strategy trading with a brokerage account is not available on
  TradingView. The search tool reported the article as about 3.7 years old;
  the current Pine FAQ says the same.
  **Search summary.** [How to autotrade using Pine Script strategies](https://www.tradingview.com/support/solutions/43000481026-how-to-autotrade-using-pine-script-strategies/)
- The Pine FAQ says traders can use external tools that interpret alert
  signals sent by webhook and execute trades. TradingView itself does not
  place those orders. The cross-check noted that calling this TradingView's
  "route to automated execution" may overstate the source.
  **Search summary.** [Pine FAQ: Strategies](https://www.tradingview.com/pine-script-docs/faq/strategies/), [Pine FAQ: Alerts](https://www.tradingview.com/pine-script-docs/faq/alerts/)
- Paper Trading is a built-in simulated account used from the Trading Panel,
  with its own order ticket. TradingView's trading page reportedly lets users
  set the initial balance, commissions and account currency.
  **Search summary.** [Paper trading: main functionality](https://www.tradingview.com/support/solutions/43000516466-paper-trading-main-functionality/)
- Paper Trading's default balance is $100,000 and can be reset.
  **Likely** (the only official source is an old launch blog post).
  [Launch blog post](https://blognew.tradingview.com/blog/en/paper-simulated-trading-live-for-all-users-1198/)
- Paper Trading commissions are off by default and can be a percentage or a
  fixed amount; per-contract commission applies only to futures and options.
  **Search summary** (an old blog post, which also said the account currency
  is always USD; the current trading page says the currency can be set).
  [Commissions blog post](https://www.tradingview.com/blog/en/introducing-commissions-for-paper-trading-11222/),
  [Commission per contract](https://www.tradingview.com/support/solutions/43000755797-what-is-commission-per-contract-in-paper-trading/)
- The Paper Trading order ticket offers market, limit, stop and stop-limit
  orders. Take-profit and stop-loss can be attached to market or limit orders
  but "not to stop or stop-limit orders at this time".
  **Search summary.** [Types of orders](https://www.tradingview.com/support/solutions/43000785102-types-of-orders-market-limit-stop/);
  the bracket limitation is from the help article "How to place an order on
  TradingView" (article 43000786671; full URL not recorded).
- How Paper Trading fills orders, and whether it applies slippage.
  **Unverified** (no official page found).
- Whether Paper Trading supports US and Canadian stocks. **Unverified.**

Open questions: the current Paper Trading default balance; its fill and
slippage model; which asset classes it supports. (The Lab does not use Paper
Trading, so none of these block anything.)

## 2. Pine Script version and `strategy()` settings

Used by: the Pine strategy in `pine/`, `ENGINE-SPEC.md` section 8.

- Pine Script v6 is the current version, and future Pine updates apply only
  to v6. The release notes date the launch to November 2024; the blog post is
  dated 10 December 2024 (the cross-check flagged the mismatch).
  **Search summary.** [Release notes](https://www.tradingview.com/pine-script-docs/release-notes/)
- No v7 was found; the newest migration guide is "To Pine Script version 6".
  The newest release-notes entry the search index held was September 2026.
  **Likely** (based on not finding something).
  [Migration guides](https://www.tradingview.com/pine-script-docs/migration-guides/overview/)
- The version is declared with `//@version=6`. Without it, version 1 is
  assumed; the top of the script is recommended.
  **Search summary.** [Script structure](https://www.tradingview.com/pine-script-docs/language/script-structure/)
- `strategy()` defaults, all **Search summary** from
  [Concepts: Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/)
  and [Declaration statements](https://www.tradingview.com/pine-script-docs/language/declaration-statements/):
  - `initial_capital` 1,000,000 in the account currency.
  - `currency` = `currency.NONE` (the chart's quote currency). With another
    account currency, values are converted, typically at the previous day's
    rate.
  - `default_qty_type` = `strategy.fixed`, `default_qty_value` = 1; a `qty`
    argument on an order overrides both.
  - `pyramiding` = 1; it limits `strategy.entry()` only, not
    `strategy.order()`.
  - Commission types `strategy.commission.percent`, `cash_per_order` and
    `cash_per_contract`; the default value is 0. (That the default type is
    `percent` comes from the search tool's summary, not a verbatim sentence.)
  - `slippage` is a number of ticks, default 0, applied in the unfavourable
    direction to market and stop orders only; fills can land outside the
    bar's range. Whether it applies to the stop leg of a stop-limit order was
    not found.
  - `backtest_fill_limits_assumption` (default 0) is the number of ticks
    price must move past a limit before it fills; the fill is still at the
    limit price. Since July 2026 the UI shows a "Limit order execution"
    dropdown whose default the parameter sets (option list not found).
  - `process_orders_on_close` = false: orders created on a bar's closing tick
    fill at the next bar's open. True can give unrealistic results or
    repaint. Since July 2026 the UI calls this "Order execution delay".
  - `calc_on_every_tick` and `calc_on_order_fills` default to false;
    `calc_on_order_fills` can introduce lookahead bias.
  - `calc_on_every_history_tick` (added July 2026, default false; Premium and
    Ultimate, standard charts only). The cross-check had no way to judge this
    very recent item.
  - `use_bar_magnifier`: high historical bar detail is available only on
    Premium and Ultimate, whatever the script sets. Since July 2026 the UI
    calls it "Bar detalization". Its default of false was not explicitly
    confirmed.
  - `margin_long` / `margin_short` default to 100 in v6 (0 in v5, meaning no
    funds check). Since July 2026 the UI shows leverage inputs instead.
  - `close_entries_rule` = "FIFO".
  - `max_boxes_count`, `max_labels_count`, `max_lines_count`: about 50 by
    default, at most 500 (approximate).
    [Limitations](https://www.tradingview.com/pine-script-docs/writing/limitations/)
- Other limits, **Search summary**: at most 64 plot counts per script
  ([Limitations](https://www.tradingview.com/pine-script-docs/writing/limitations/));
  at most nine tables, one per position
  ([Tables](https://www.tradingview.com/pine-script-docs/visuals/tables/));
  drawings at most 500 bars into the future and about 10,000 bars into the
  past with `xloc.bar_index` (sources differ on the exact past figure)
  ([Lines and boxes](https://www.tradingview.com/pine-script-docs/visuals/lines-and-boxes/)).
- v6 changes that affect a strategy, all **Search summary** from
  [To Pine Script version 6](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/):
  the `when` parameter was removed from the order commands (use `if`);
  `strategy.exit()` with both a relative and an absolute level (`profit` and
  `limit`, `loss` and `stop`) uses whichever level is expected to be reached
  first; past 9,000 orders the oldest are trimmed (1,000,000 with Deep
  Backtesting); `bool` values can no longer be `na`; `and`/`or`
  short-circuit; dividing two `int` values can give a fraction;
  `dynamic_requests` defaults to true.
- Since July 2026, on Premium and Ultimate, built-in price and volume
  variables can update tick by tick on historical bars.
  **Search summary.** [Release notes](https://www.tradingview.com/pine-script-docs/release-notes/)

Open questions: the options in the July 2026 "Bar detalization", "Limit
order execution" and "Order execution delay" menus; `use_bar_magnifier`'s
default; whether an October 2026 release exists. The Pine v6 Reference Manual
never appeared in search results, so exact function signatures were not
checked against it.

## 3. The broker emulator (how TradingView simulates fills)

Used by: `ENGINE-SPEC.md` sections 5 and 8 (the engine's `tv_path` and
`limit_intrabar` options exist to match these rules), the Pine strategy.

- By default a strategy runs once per bar on the closing tick, and orders
  fill at the open of the next bar.
  **Search summary.** [Execution model](https://www.tradingview.com/pine-script-docs/language/execution-model/)
- Stop and limit orders at set prices can fill partway through a historical
  bar at the order price.
  **Search summary.** [Pine FAQ: Strategies](https://www.tradingview.com/pine-script-docs/faq/strategies/)
- Without Bar Magnifier, the emulator assumes the path inside a bar: if the
  open is closer to the high, open → high → low → close; if closer to the
  low, open → low → high → close. The docs found do not say what happens
  when the open is equally far from both.
  **Search summary.** [Concepts: Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/)
- The emulator assumes no gaps inside a bar, so any price in the bar's range
  is a valid fill.
  **Search summary** (the page cited is the v5 version of the docs).
  [v5 Strategies](https://www.tradingview.com/pine-script-docs/v5/concepts/strategies/)
- If price crosses a stop or limit level in the gap between bars, the order
  fills at the new bar's open, not at the order price.
  **Search summary** (v5 page). Whether this also applies between
  lower-timeframe bars with Bar Magnifier was not found.
- Limit orders fill at the limit price or better; a limit that is already
  marketable fills on the next tick. **Search summary.** That a gapped-through
  limit therefore fills at the (better) open is a synthesis of two
  statements: **Likely.**
- A stop order becomes a market order once price is at the stop or worse,
  and can fill at a worse price. **Search summary** (v5 page).
- `strategy.exit()` with both `limit` and `stop` creates two separate orders
  (a bracket). Only the first one triggered fills; the other is cancelled.
  **Search summary.** [Concepts: Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/)
- When both the stop and the target lie inside one bar, the one reached first
  along the assumed path fills. **Likely** (an inference from the two rules
  above; no sentence says so explicitly). The engine's `tv_path` option
  reproduces this inference.
- A market-style exit triggered on the entry bar closes the trade at the next
  bar's open; price-level exits can fill on the entry bar itself.
  **Search summary.** [Pine FAQ: Strategies](https://www.tradingview.com/pine-script-docs/faq/strategies/)
- `strategy.position_avg_price` is `na` until the entry bar closes, so exits
  computed from the entry price normally start on the next bar (unless
  `calc_on_order_fills`, which risks lookahead bias). **Search summary**; the
  cross-check thought the wording might be imprecise.
- Only the v3/v4 manuals say an exit tied to an entry ID waits for that entry
  to fill. Current v6 behaviour for an exit issued while the entry is still
  pending was not found. **Search summary** (legacy docs only).
  [v4 Strategies](https://www.tradingview.com/pine-script-docs/v4/essential/strategies/)
- `strategy.close()` / `strategy.close_all()` send market orders filled on the
  next tick; `immediately = true` fills on the same tick (which may be
  unattainable live). `strategy.cancel()` / `strategy.cancel_all()` cancel
  unfilled orders. **Search summary.**
- `strategy.risk.max_intraday_loss()` cancels pending orders, closes the
  position and stops trading until the session ends;
  `strategy.risk.max_drawdown()` stops all trading once the drawdown is
  reached. **Search summary** (signatures not checked).
- Bar Magnifier (Premium and above) uses lower-timeframe data on historical
  bars, with a cap of 200,000 lower-timeframe bars. **Search summary.**
  [What is Bar Magnifier](https://www.tradingview.com/support/solutions/43000669285-what-is-bar-magnifier-backtesting-mode/).
  The tick counts of the newer "Bar detalization" levels: **Likely** (search
  summaries conflicted). [Bar detalization](https://www.tradingview.com/support/solutions/43000786180-bar-detalization/)

## 4. Repainting and signal timing

Used by: the Pine strategy (signals on confirmed bars only), the alert
settings in `LAB-ARCHITECTURE.md`.

- `barstate.isconfirmed` is true on every historical bar and on the last
  update of a realtime bar; gating signals on it avoids realtime repainting.
  It is not supported inside `request.security()`.
  **Search summary** (the cross-check thought "same result on history" may
  overstate the docs). [Bar states](https://www.tradingview.com/pine-script-docs/concepts/bar-states/)
- On a realtime bar the script re-runs on every tick with its per-bar state
  rolled back; high, low and close are final only on the closing tick.
  **Search summary.** [Execution model](https://www.tradingview.com/pine-script-docs/language/execution-model/)
- With `calc_on_every_tick = true` a strategy will most probably not produce
  the same orders in realtime as on history, so it repaints.
  **Search summary.** [Repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/)
- `request.security()` with `lookahead_on` and no `[1]` offset returns future
  data on historical bars. **Search summary.** (The strategy does not request
  other timeframes.)
- Live strategy alerts can differ from the backtest, because history uses
  the assumed path inside each bar and realtime uses actual ticks.
  **Search summary.** [Repainting support article](https://www.tradingview.com/support/solutions/43000478429-script-or-strategy-gives-different-results-after-refreshing-the-page-repainting/)

## 5. Sessions, early closes, ATR and volume

Used by: the Pine strategy, `ENGINE-SPEC.md` sections 1–2 and 8.

- For most US equities, `"regular"` equals `session.regular`, but the docs
  say this is not always so. `syminfo.session` is `"extended"` only when the
  chart offers extended hours and the user selects them.
  **Search summary.** [Sessions](https://www.tradingview.com/pine-script-docs/concepts/sessions/)
- `time(timeframe, session)` returns `na` for bars outside the session;
  session strings look like `"0930-1600"` and are read in the exchange time
  zone unless one is given. **Search summary.** [Time](https://www.tradingview.com/pine-script-docs/concepts/time/)
- `session.isfirstbar_regular` / `session.islastbar_regular` flag the first
  and last regular-session bars; `islastbar` may be true for no bar at all if
  the last bar gets no price or volume updates. **Search summary.**
- `time_close` gives the expected close of an open bar on time-based charts;
  a session's last bar can be shorter than the timeframe. **Search summary.**
- How strategies fill orders on pre-market and after-hours bars.
  **Unverified** (no official page found). The Pine strategy should restrict
  entries to the regular session itself.
- Whether NYSE/Nasdaq 13:00 ET early closes are in TradingView's session
  data for US stocks, and how `session.islastbar_regular` and `time_close`
  behave on those days. **Unverified.** The only related page covers CME
  futures holiday sessions (**Likely**, indirect):
  [Session-based indicators on US futures](https://www.tradingview.com/support/solutions/43000746362-why-do-session-based-indicators-occasionally-extend-daily-sessions-on-us-futures/).
  Signal Desk uses its own calendar (`server/calendar.js`) for early closes.
- `time_close("D")` on an intraday chart. **Unverified.**
- TradingView's built-in ATR indicator is, by default, an RMA of true range
  (smoothing can be changed to SMA, EMA or WMA).
  **Search summary.** [Average True Range](https://www.tradingview.com/support/solutions/43000501823-average-true-range-atr/)
- `ta.atr(length)` is the RMA of true range with alpha = 1/length (Wilder's
  smoothing, as in the engine). **Likely**: the source is TradingView's
  Charting Library (PineJS) docs, not the Pine reference manual.
  [PineJS docs](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.PineJSStd/)
- `ta.tr(true)` uses high − low when the previous close is `na`.
  **Search summary.** [Built-ins](https://www.tradingview.com/pine-script-docs/language/built-ins/)
- RMA and EMA depend on where the calculation starts; Deep Backtesting starts
  earlier, so its values and trades can differ from chart mode.
  **Search summary.** [Regular mode vs Deep Backtesting](https://www.tradingview.com/support/solutions/43000666266-why-do-the-data-of-the-regular-mode-and-deep-backtesting-not-match/)
- `ta.sma` returns `na` until `length` bars exist. **Search summary.**
- `volume` is `na` when a bar has no volume data. **Search summary.**
  [Chart information](https://www.tradingview.com/pine-script-docs/concepts/chart-information/)
- Backtests on Heikin Ashi, Renko and other non-standard charts give
  unrealistic results; TradingView recommends standard charts.
  **Search summary.** [Non-standard charts](https://www.tradingview.com/support/solutions/43000481029-strategy-produces-unrealistic-results-on-non-standard-chart-types-heikin-ashi-renko-etc/)

## 6. Alerts and webhooks

Used by: the optional alert receiver (`LAB-ARCHITECTURE.md`, "TradingView
alerts"), the forward-test protocol in `VALIDATION-PLAN.md`.

Pine side, all **Search summary** from
[Concepts: Alerts](https://www.tradingview.com/pine-script-docs/concepts/alerts/)
and [Pine FAQ: Alerts](https://www.tradingview.com/pine-script-docs/faq/alerts/):

- `alertcondition()` has no effect in strategies; strategies use `alert()`
  and order-fill alerts.
- In a strategy, `alert()` fires only at the close of realtime bars unless
  `calc_on_every_tick = true`.
- A strategy alert's condition can be "order fills and alert() function
  calls", "order fills only" or "alert() function calls only"
  ([Getting started with technical alerts](https://www.tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts/)).
- Order-fill alerts need no extra code. Custom text goes in each order's
  `alert_message` and appears where the alert's message contains
  `{{strategy.order.alert_message}}`.
- Placeholders ([Variables in alerts](https://www.tradingview.com/support/solutions/43000531021-how-to-use-a-variable-value-in-alert/),
  [Strategy alerts](https://www.tradingview.com/support/solutions/43000481368-strategy-alerts/)):
  `{{strategy.order.action}}` ("buy"/"sell"), `{{strategy.order.contracts}}`,
  `{{strategy.order.price}}`, `{{strategy.order.id}}`, `{{ticker}}`,
  `{{exchange}}` (delayed symbols end in `_DL` or `_DLY`), `{{interval}}`
  (can be "1" instead of the chart timeframe), `{{time}}` (the bar's open
  time in UTC, `yyyy-MM-ddTHH:mm:ssZ`) and `{{timenow}}` (when the alert
  fired). `{{strategy.market_position}}` and the other position placeholders:
  **Likely.**

Alert service, all **Search summary** unless marked:

- A strategy alert runs a copy of the strategy on TradingView's servers. It
  fires only for orders the emulator executes in realtime, never for
  historical ones. The alert keeps a snapshot of the script, inputs, symbol
  and timeframe, so changes need the alert deleted and recreated.
  [Strategy alerts](https://www.tradingview.com/support/solutions/43000481368-strategy-alerts/)
- Alerts run on TradingView's servers 24/7, whether or not the chart is open.
  [Alerts and an open computer](https://www.tradingview.com/support/solutions/43000548327-will-alerts-work-if-tradingview-is-not-open-on-the-computer/)
- An alert is stopped automatically if it triggers more than 15 times in 3
  minutes. [Triggered too often](https://www.tradingview.com/support/solutions/43000690939-alert-was-triggered-too-often-and-stopped/)
- A standard alert lives at most two months; Premium and Ultimate can set
  open-ended alerts. Lower-tier expiry periods: **Unverified** (pricing
  snippets conflicted).
  [Introduction to alerts](https://www.tradingview.com/support/solutions/43000520149-introduction-to-tradingview-alerts/)
- Active alerts: Premium 800 (400 price + 400 technical), Ultimate 2,000.
  Lower tiers: **Likely.**
  [Active alerts per plan](https://www.tradingview.com/support/solutions/43000690941-how-to-get-more-active-alerts-per-subscription/)

Webhooks:

- Webhooks are for paid plans only. **Likely**: the only official statement
  is an old blog post ("paid users only"). Which current tiers include them
  was not determined.
  [Webhooks blog post](https://www.tradingview.com/blog/en/webhooks-for-alerts-now-available-14054/)
- Webhook alerts are allowed only with two-factor authentication on.
  TradingView's MCP docs reportedly say webhook alerts cannot be created
  through MCP because the 2FA check is not available there (the cross-check
  treated that sentence as suspect).
  **Search summary.** [How to configure webhook alerts](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/),
  [2FA setup](https://www.tradingview.com/support/solutions/43000572460-how-to-configure-2fa/)
- Only ports 80 and 443 are accepted; IPv6 does not work; a URL that resolves
  to a private or internal IP is refused. **Search summary.**
  [Port numbers](https://www.tradingview.com/support/solutions/43000529314-i-cannot-send-webhook-to-a-url-with-a-port-number/)
- Over HTTPS, TradingView presents a client certificate
  (CN = webhook-server@tradingview.com) that the receiver can check. No page
  was found saying HTTPS is mandatory. **Search summary.**
  [Webhook authentication](https://www.tradingview.com/support/solutions/43000680459-webhook-authentication/)
- A request is cancelled if the receiver takes longer than 3 seconds.
  **Search summary.**
- Requests are POSTs with the alert message as the body:
  `application/json` if the message is valid JSON, otherwise `text/plain`.
  **Search summary.**
- Source IPs: 52.89.214.238, 34.212.75.30, 54.218.53.128 and 52.32.178.7.
  **Search summary**, from pages about 3.5–4 years old; check the alert
  dialog before relying on them.
- Resends happen only for HTTP 500–599 responses other than 504, after 5
  seconds, at most 3 times. No retry is documented for timeouts.
  **Search summary.** [Webhook resubmission](https://www.tradingview.com/support/solutions/43000735201-webhook-resubmission/)
- TradingView advises against putting credentials in the webhook URL or
  message, and recommends authenticated endpoints.
  **Search summary (this pass).** [Using credentials for webhooks](https://www.tradingview.com/support/solutions/43000722015-using-credentials-for-webhooks/)
- Whether a webhook can carry custom HTTP headers. **Unverified**: no page
  was found either way; the pages found describe only the automatic
  Content-Type header.

Open questions: which current plans include webhooks; whether the source-IP
list is current; whether there is a maximum body size.

## 7. Historical data, exports and Deep Backtesting

Used by: `README.md` ("Unsupported features and remaining setup"), the Lab's
CSV import.

- Charts load at most 5,000 intraday bars on Basic, 10,000 on Essential and
  Plus, 20,000 on Premium, 25,000 on Expert and 40,000 on Ultimate, and
  TradingView says this cannot currently be extended. **Search summary.**
  [Intraday bars and limits](https://www.tradingview.com/support/solutions/43000480679-historical-intraday-data-bars-and-limits-explained/)
  - Arithmetic on those figures (not a TradingView statement): the
    pre-registered range 2021-07-01 to 2026-06-30 has about 1,255 sessions,
    or roughly 32,600 regular-session 15-minute bars per symbol. Of the
    reported limits only the 40,000-bar figure covers it in one chart load;
    10,000 bars is roughly 18 months.
- Chart data can be exported to CSV with "Download chart data…" (formerly
  "Export chart data…"). Only the bars loaded on the chart are exported; the
  file has time, OHLC and any plots from scripts on the chart.
  **Search summary.** [How to export chart data](https://www.tradingview.com/support/solutions/43000537255-how-to-export-chart-data/).
  Exact column names and time format: not confirmed. Which plans include
  it: **Likely** only for retired plan names (PRO+ and Premium, in an old
  blog post); the current mapping is unknown.
- The strategy report's trade list can be downloaded as CSV ("Download" on
  the Trades tab, all columns), and the full report as XLSX. By default only
  the latest 9,000 trades are kept; Deep Backtesting keeps all of them.
  **Search summary.** [How to export strategy data](https://www.tradingview.com/support/solutions/43000613680-how-to-export-strategy-data/).
  Current column names: **Likely.** Which plans include the export:
  **Unverified.**
- Deep Backtesting (Premium and above) runs a strategy over stored history
  for a chosen date range, up to 2 million bars and 1 million trades. Its
  results appear only in the strategy report; chart markers and alerts still
  use the loaded bars. **Search summary.**
  [How Deep Backtesting works](https://www.tradingview.com/support/solutions/43000666265-how-deep-backtesting-works/),
  [Data for Deep Backtesting](https://www.tradingview.com/support/solutions/43000668210-how-much-data-is-available-for-deep-backtesting/)

## 8. Questrade API

Used by: `QUESTRADE-ASSESSMENT.md`.

- "Executing trades using the API is available to Questrade partner
  developers only. If you're a customer with Questrade, you can access
  account and market data but you cannot execute trades using the API."
  **Search summary**, found again in this pass. The search tool reported the
  page as about 11 years old.
  [Questrade API](https://www.questrade.com/api)
- The security page's scope table lists "Trade (partner developers only)",
  identifier `trade`. That it covers placing, previewing and cancelling
  orders is the search tool's paraphrase. **Search summary.**
  [API security](https://www.questrade.com/api/documentation/security)
- The read scopes cover account data (balances, positions, executions,
  orders) and market data (level 1 quotes, candles).
  **Search summary (this pass).**
- The getting-started guide repeats that only partner developers can place
  trades. **Likely** (paraphrase).
  [Getting started](https://www.questrade.com/api/documentation/getting-started)
- `POST accounts/:id/orders` places or replaces an order; there are also
  order-impact (preview without placing), bracket and multi-leg strategy
  endpoints. **Search summary** (the bracket and strategy endpoints by page
  title only; the sample data on the orders page dates from 2014–2015).
  [Orders endpoint](https://www.questrade.com/api/documentation/rest-operations/order-calls/accounts-id-orders),
  [Order impact](https://www.questrade.com/api/documentation/rest-operations/order-calls/accounts-id-orders-impact)
- The API is free to use; a customer placing trades through a partner app
  pays the same commissions as on Questrade's own platforms.
  **Search summary.** [Questrade API](https://www.questrade.com/api)
- Registering a personal app: an account in good standing, activate the API
  Centre, "Register a personal app", then generate a manual authorization
  token; tokens can be revoked and apps deleted from the API Centre.
  **Search summary** (this describes the process, not whether registration
  is open today). [Getting started](https://www.questrade.com/api/documentation/getting-started)
- Whether personal-app registration is currently open, paused or
  restricted. **Unverified.** [API FAQ](https://www.questrade.com/api/support)
- OAuth 2.0: the personal app's key is the `client_id` (the secret is
  optional in the flow); requests are accepted over HTTPS (TLS) only.
  **Search summary.** [Authorization](https://www.questrade.com/api/documentation/authorization)
- Rate limits: account calls 30 per second and 30,000 per hour; market-data
  calls 20 per second and 15,000 per hour. Going over returns HTTP 429 with
  error code 1006. **Search summary** (the tool warned the page may be out
  of date). [Rate limiting](https://www.questrade.com/api/documentation/rate-limiting),
  [Error handling](https://www.questrade.com/api/documentation/error-handling)
- Without a real-time data subscription, quote requests count as snapshots
  with a per-market limit, after which delayed data is returned.
  **Likely.** [Quotes endpoint](https://www.questrade.com/api/documentation/rest-operations/market-calls/markets-quotes-id)
- A page at developer.questrade.com exists; its content was not seen.
  Whether it replaces the older documentation or changes the trading rule:
  **Unverified.**

## 9. Questrade on TradingView

- Questrade is a TradingView-integrated broker. Users open the Trading Panel,
  click the Questrade icon and sign in with their Questrade credentials, then
  trade from TradingView charts. **Search summary.**
  [Questrade broker page](https://www.tradingview.com/broker/Questrade/),
  [TradingView blog](https://www.tradingview.com/blog/en/questrade-on-tradingview-44778/).
  The announcement date (about May 2024) is unconfirmed.
- Questrade's own pages describe signing in on Questrade's page with
  multi-factor authentication and consenting to data sharing; free and paid
  TradingView plans; trading from any of the customer's self-directed
  accounts; options cannot be traded through TradingView. Their pages
  conflict about mobile support. **Search summary (this pass).**
  [Getting started with TradingView](https://www.questrade.com/learning/using-questrade/tradingview),
  [TradingView x Questrade FAQ](https://www.questrade.com/learning/platform-tutorials/investment-tools-at-questrade/tradingview-FAQ),
  [Questrade x TradingView](https://www.questrade.com/self-directed-investing/tools/tradingview)
- The order types available through the integration. **Unverified** (not
  found).
- Exchange data already bought through Questrade (TSX, TSXV, NASDAQ, NYSE,
  AMEX/NYSE Arca, OTC, OPRA, CBOE futures) can be used on TradingView, with
  verification renewed every 7 days. **Search summary.**
  [Data purchased through a broker](https://www.tradingview.com/support/solutions/43000479666-how-can-i-get-real-time-data-from-exchanges-that-i-have-already-purchased-with-my-broker/)

## 10. Questrade's AI-agent (MCP) connection

- Questrade publishes a "Questrade MCP Setup Guide" for connecting a
  Questrade account to AI agents. As summarized: one server address for all
  supported agents; sign-in happens on Questrade's own page; read-only access
  can be granted without trade permission; when an agent prepares an order,
  it shows a preview, and Questrade sends a Push Approval notification to the
  Questrade app (version 2.0.0 or later), where the customer approves or
  declines; the agent cannot place, change or cancel an order on its own,
  and an ignored request is cancelled. One Questrade page describes the
  connection as read-and-write; the newer guide says trading permission is
  turned on separately after an extra security check.
  **Search summary (this pass)**; the first research pass rated the same
  page **Likely** (paraphrase only).
  [Questrade MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai),
  [Questrade MCP guides](https://www.questrade.com/learning/questrade-mcp),
  [Agentic finance](https://www.questrade.com/agentic-finance)
- Not established: when it launched; who is eligible and for which account
  types; whether it runs through the partner-only API scope or a separate
  channel; any extra cost. **Unverified.**

## 11. Questrade topics that were not researched

The search budget ran out before these were searched. Nothing in the project
states them as fact; they are questions for the owner (see
`QUESTRADE-ASSESSMENT.md`).

- Which account types the API, the TradingView integration and the MCP
  connection support (cash, margin, TFSA, RRSP, FHSA; USD and CAD sides).
  The accounts endpoint page exists, but its list of types was not seen.
  [Accounts endpoint](https://www.questrade.com/api/documentation/rest-operations/account-calls/accounts)
- Current commissions and any ECN fees on US stocks and ETFs, and currency
  conversion costs. [Pricing](https://www.questrade.com/pricing)
- Real-time market data packages for the API and their cost.
- Automation features (conditional or scripted orders) in Questrade's own
  platforms.
- Which App hub partners, if any, place trades. Only page titles were seen
  (App hub, VectorVest, OptionsPlay, Stock Unlock). **Search summary** for
  the titles. [App hub](https://www.questrade.com/partner-centre/app-hub)
- Rules for registered accounts (TFSA, RRSP) and tax treatment. These are
  outside what an official-domain search of these two sites can settle.

## 12. Project assumptions the research does not support (yet)

These statements appear in the project's design documents but were not
covered by any official source found. They are working assumptions, to be
checked when the Pine script is first compiled or the receiver first used.

| Statement | Where | Status |
|---|---|---|
| TradingView cannot add custom headers to a webhook, so the shared secret travels in the JSON body | `LAB-ARCHITECTURE.md` | **Unverified.** No page found either way. |
| A shared secret in the alert message is an acceptable way to authenticate | `LAB-ARCHITECTURE.md` | TradingView advises against credentials in the URL or message (section 6). The Lab's secret is a random token for this one receiver, not a TradingView, Questrade or Signal Desk login, but it is still stored inside the alert. The owner should read the article and decide; certificate checking over HTTPS is the documented alternative. |
| Each TradingView chart is a separate single-symbol strategy account | `ENGINE-SPEC.md` §8 | **Unverified** (not researched). |
| TradingView has no immediate-or-cancel limit order for strategies | `ENGINE-SPEC.md` §8 | **Unverified** (not researched). |
| On a regular-session chart, the first bar's true range uses the previous session's last close | `ENGINE-SPEC.md` §2 | **Likely** (follows from the true-range definition; no page discusses session boundaries). Check by comparing `ta.atr` with the engine on the same bars. |
| A bar touching both stop and target resolves along the assumed path | `ENGINE-SPEC.md` §8, `RULES.md` §8 | **Likely** (section 3). |
| TradingView's session data handles 13:00 ET early closes | (not assumed; the engine uses `server/calendar.js`) | **Unverified** (section 5). |

## 13. What the owner should check directly

In a browser, signed in, on the official pages linked above:

1. **Questrade API**: whether "partner developers only" still applies to
   trading, and whether personal-app registration is open
   ([questrade.com/api](https://www.questrade.com/api), the API Centre in
   the account menu, developer.questrade.com).
2. **Questrade MCP guide**: eligibility, account types, the permission
   screen, and how Push Approval works on the owner's own account.
3. **Questrade pricing**: commissions and fees on US stocks and ETFs, and
   the currency conversion cost for the account that would be used
   ([questrade.com/pricing](https://www.questrade.com/pricing)).
4. **Account types and restrictions**: what the owner's accounts (TFSA,
   RRSP, cash, margin; CAD and USD) allow, via Questrade support.
5. **TradingView plan**: whether it includes webhooks, chart data export,
   strategy report export, Deep Backtesting, Bar Magnifier / Bar
   detalization, and how many intraday bars it loads
   ([tradingview.com/pricing](https://www.tradingview.com/pricing/)).
6. **TradingView webhooks**: 2FA, the current source-IP list (tooltip in the
   alert dialog), and the "Using credentials for webhooks" article before
   deciding how to authenticate the receiver.
7. **Early closes**: open a 15-minute chart on a known half-day (for example
   the day after US Thanksgiving) and check where the session ends.
8. **First compile of the Pine script**: whether it compiles under v6, and
   whether its fills match the engine's `tv_path` and `limit_intrabar` runs
   on the same bars.
