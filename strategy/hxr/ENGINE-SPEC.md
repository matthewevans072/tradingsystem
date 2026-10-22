# HXR engine and module specification (hxr-engine-2)

The exact behaviour of the HXR simulation code in `server/hxr/`. If code and
this file disagree, one of them has a bug. The rules being tested are in
`PREREGISTRATION.md`. This file covers mechanics.

Simulation only: nothing here reads or changes the real portfolio
(`data/signal-desk.sqlite`), the Strategy Lab (`data/strategy-lab*.sqlite`),
sends a notification or calls any broker or paper-trading endpoint.

## 1. Modules

| File | Responsibility |
|---|---|
| `server/hxr/config.js` | Load, validate, hash and freeze HXR configs (`strategy/hxr/configs/*.json`), the universe (`universe-hxr-v1.json`), periods (`periods-hxr-v1.json`) and criteria (`criteria-hxr-v1.json`). Hashing reuses `canonicalJson` and `DESCRIPTIVE_KEYS` from `server/strategy/config.js`. |
| `server/hxr/store.js` | The HXR database `data/hxr-sim.sqlite` (real workspace only), with additive migrations and the file guard (section 8). |
| `server/hxr/source.js` | Read-only Alpaca market-data client: daily bars, the first 15-minute bar of each session, corporate actions, sampled quotes and news. Only `https://data.alpaca.markets` is ever called. |
| `server/hxr/data.js` | Turns stored rows into engine inputs: per-symbol raw daily bars from the listing date, split events, dividends filtered to the listing, half-spread table, first-15-minute VWAP. Also the readiness checklist. |
| `server/hxr/engine.js` | The deterministic streaming engine (sections 2–6). |
| `server/hxr/metrics.js` | Run metrics, the hold comparison and the criteria evaluation (section 7). |
| `server/hxr/service.js` | `createHxr(ctx)` / `attachHxr(ctx)`: data download job, readiness, cost calibration, selection and evaluation runs with their ledgers, experiment log, prospective account, news polling, overview for the page. |
| `server/hxr/api.js` | `/api/hxr/*` routes, registered by `server/api.js` (same local-only Host, Origin and `X-Signal-Desk` CSRF checks as every route). |
| `public/views/hxr.js` | The **HXR (simulated)** page. |

## 2. Engine inputs

`createEngine({ config, symbols, period, calendar, inputs, state })`:

- `config`: one validated HXR config: rule, costs, execution, dividends, cash and account.
- `symbols`: `[{ symbol, exchange, listedFrom }]`, one sleeve each, in the listed order.
- `period`: `{ warmupFrom, start, end }`. These are exchange-local dates; sessions come from `server/calendar.js` (NYSE).
- `excludedSessions`: dates skipped for every symbol (`periods-hxr-v1.json`).
- `inputs` for each session date, through `processSession(date, { bars, splits, dividends })`:
  - `bars[symbol]`: `{ o, h, l, c, v, vw15 }`. These are **raw** (unadjusted) regular-session prices. `vw15` is the volume-weighted price of the 09:30–09:45 ET bar, or `null`.
  - `splits`: `[{ symbol, ratio }]` whose first split-adjusted session is `date`. `ratio` is new shares per old share; below 1 means a reverse split.
  - `dividends`: `[{ symbol, exDate: date, payDate, amount }]`, where `amount` is cash per share in raw terms on the ex-date.
- `halfSpreadBps(symbol, date)`: the calibrated table, floored at `costs.halfSpreadFloorBps`.

Bars before `listedFrom` are never passed. A symbol with no bar on a session
keeps its last close for valuation, and a `data_warning` is journalled. That
includes sessions before its listing inside a period, which is a period
definition error that `data.js` refuses to build.

## 3. Sleeve state

Each sleeve holds:

- `symbol`, `cash`, `shares`, `state` (`in` or `out`) and `pendingOrder` (or `null`);
- `history`: closes in **current share units**, keeping at least `max(sma, vol + 1)` values;
- `anchorHigh`: the highest close since the last buy fill, inclusive;
- `anchorLow`: the lowest close since the last sell fill, inclusive;
- `receivables`: declared dividends not yet paid.

When a split with ratio `r` takes effect, every value in `history`,
`anchorHigh` and `anchorLow` is divided by `r` and `shares` is multiplied by
`r`. Signals are therefore computed on a split-adjusted series built only
from information available on that date. If a reverse split leaves a
fraction of a share, the fraction is paid out as cash at that session's open,
less the half-spread.

## 4. One session, in order

For each NYSE session `d` from `warmupFrom` to `end`, skipping
`excludedSessions`:

1. **Warm-up** (`d < start`): append each symbol's close to `history`. No
   cash, orders or equity points.
2. **Splits** effective on `d`: applied as in section 3.
3. **Dividend entitlement**: for each dividend with ex-date `d`, the sleeve's
   current `shares` (after splits, before any fill on `d`) earn
   `gross = shares × amount`, and
   `net = gross × (1 − withholdingPct/100)`. A receivable is added, due on
   `payDate` (or `d` if none). Each event is journalled.
4. **Pay** every receivable due on or before `d` into its sleeve's cash.
5. **Fills at the open** for orders whose `fillDate ≤ d`. If the symbol has
   no bar on `d`, the order waits and a `data_warning` is journalled. For
   each stock, sells fill before buys.
   - `k = (halfSpreadBps(symbol, d) + slippageBps) / 10000`.
   - **Sell** all shares at `p = o × (1 − k)` (fill model `open`), or
     `p = vw15 × (1 − h)` with `h` the half-spread only (fill model `vw15`).
     If `vw15` is missing, the open-based price is used and the fill is
     flagged.
     - Fees are `commissionPerOrder + commissionPerShare × shares + secFeeRate × shares × p + min(tafPerShare × shares, tafMaxPerTrade)`.
     - Cash increases by `shares × p − fees`; `shares` becomes 0; `state` becomes `out`; `anchorLow` becomes `+∞`.
   - **Buy**: `p = o × (1 + k)` (or `vw15 × (1 + h)`).
     - `n = floor((cash − commissionPerOrder) / (p + commissionPerShare))`.
     - If `n < 1`, the order is cancelled and `insufficient_cash` is journalled.
     - Otherwise cash decreases by `n × p + commissionPerOrder + commissionPerShare × n`; `state` becomes `in`; `anchorHigh` becomes `−∞`.
   - Cash may never go below zero. The engine throws if it would.
   - Each fill records the effective price, the raw price and its parts: the spread and slippage cost (`shares × |p − raw|`) and the fees.
6. **Close**: for every symbol with a bar, append `c` to `history`. If
   `in`, `anchorHigh = max(anchorHigh, c)`; if `out`,
   `anchorLow = min(anchorLow, c)`. Then add cash interest if
   `cash.annualInterestPct > 0`: `cash × pct/100/252`.
7. **Equity point**:
   - `{ date, equity, cash, invested, sleevesOut, receivable }`;
   - `equity` is `Σ(cash + shares × lastClose)`, excluding receivables;
   - `receivable` is reported separately.
8. **Signals**: for each sleeve with a bar on `d`, no pending order and
   `d ≥ start`, check the exit or buy-back rule (section 5). A triggered
   order:
   - gets `decisionDate = d`;
   - gets `fillDate`, the `delaySessions`-th following session (skipping excluded sessions);
   - is journalled as a `decision` event with every number used.

   On `d = end`, decisions are still recorded but can never fill; they are
   reported as `pending_at_end`.

**Initial allocation**: each sleeve starts `out` with `cash = startingCash / N`
and a pending buy filling at `start`'s open, with the reason
`initial allocation`. The cash left over after the integer division is
assigned to the first sleeves, one cent at a time. The hold arm (rule type
`hold`) is the same with no signals.

## 5. Rules

Here `c` is today's close and `closes` is `history`, ending with `c`.

| Type | Needs | Exit when `in` | Buy back when `out` |
|---|---|---|---|
| `hold` | none | never | never (initial allocation only) |
| `ma_band` (`smaSessions`, `bandPct`) | `smaSessions` closes | `c < SMA × (1 − bandPct/100)` | `c > SMA × (1 + bandPct/100)` |
| `vol_trail` (`volSessions`, `multiple`) | `volSessions + 1` closes | `c < anchorHigh − multiple × vol` | `c > anchorLow + multiple × vol` |
| `pct_trail` (`exitDrawdownPct`, `reentryRisePct`) | 1 close | `c ≤ anchorHigh × (1 − exitDrawdownPct/100)` | `c ≥ anchorLow × (1 + reentryRisePct/100)` |

`SMA` is the mean of the last `smaSessions` closes, including `c`. `vol` is
the mean of `|closes[i] − closes[i−1]|` over the last `volSessions` changes.
Without enough history, no signal is generated.

### 5a. hxr-prereg-2 rules (hxr-engine-2; PREREGISTRATION-2.md section 3)

Three exit rules share one buy-back rule. Here `m` is `vol` with
`volSessions` (the typical daily move at today's close), and `k` is
`pivotSessions`. History kept: `max(volSessions + 1, 2k + 1)` closes.

**Extra sleeve state**, all plain JSON and kept in snapshots:

| Field | Meaning |
|---|---|
| `sinceFill` | The stock's closes since the last fill, counting the fill session; reset to 0 at every buy or sell fill |
| `level` | X1's exit level |
| `entryPrice` | The effective buy price, for X3 |
| `gbActive` | Whether X3 is active |
| `stayOut` | Set after a missed rebound |

On a split with ratio `r`, `level` and `entryPrice` are divided by `r`, like
the other prices.

**Recovery point** (`recoveryPoint(closes, k, rebound, m)`). At today's close,
the close `k` closes back (`i = n − 1 − k`) is a recovery point if both hold:

- it is strictly below each of the `k` closes before it and the `k` closes
  after it;
- the highest of the `k` later closes is `≥ close(i) + rebound × m`.

It reads only closes up to today. A recovery point "on or after the last
fill" needs `sinceFill ≥ k + 1`.

**At each close**, for a sleeve with a bar and no pending order:

- `updateRuleState` runs first, while holding:
  - **X1** (`recovery_break`): a recovery point on or after the buy fill
    sets `level = max(level, close(i) − bufferMultiple × m)`.
  - **X3** (`giveback`): `gbActive` becomes true once
    `anchorHigh ≥ entryPrice + activationMultiple × m`.
- Then `evaluateRule` checks the exit while in:

  | Type | Exit when `in` |
  |---|---|
  | `recovery_break` | `level` set and `c < level` |
  | `move_allowance` | `c < anchorHigh − multiple × m` |
  | `giveback` | `gbActive` and `c ≤ entryPrice + (1 − givebackPct/100) × (anchorHigh − entryPrice)` |

**Buy-back when `out`** (every one of these types). `P` is the last rule
exit's effective price in current share units (`exitPriceNow`). If the
sleeve has no last exit or `stayOut` is set, nothing happens.

1. If `c ≥ P`, then `stayOut = true`, and a `rebound_missed` warning
   records the close and `P`. No order is placed, now or later.
2. Otherwise, a recovery point on or after the sell fill gives a buy order
   with `ceiling: true`. At its fill, if the effective buy price is not below
   `P`, the order is cancelled with a `buy_back_cancelled` warning and the
   sleeve keeps waiting.

Both are journalled as warnings, not decisions, so they never count as
orders. Older rule types are unchanged.

## 6. Determinism and no look-ahead

- Everything on session `d` uses only data dated `d` or earlier, plus the
  calendar.
- `processSession` must be called in date order, and repeating a date throws.
- `snapshot()` returns plain JSON. `createEngine({ state })` continues
  exactly as an uninterrupted run would.
- **Required tests**:
  - **Prefix invariance**: for runs cut at 20%, 45%, 70% and 93% of the
    sessions, decisions, fills and equity up to the cut are identical.
  - **Future-change test**: changing every bar after `T` leaves everything
    up to `T` unchanged.
  - **Snapshot round-trip**.
  - **Determinism**: identical output, including ids, on repeated runs.
- `runBacktest(...)` returns:
  - `{ meta, fills, decisions, episodes, roundTrips, dividends, splits, equity, warnings, pendingAtEnd }`;
  - `meta` holds the config hash, a data hash of every input used, the calibration hash, the period, the basket, the fill model, the delay and the engine version.

## 7. Metrics (`metrics.js`)

All in USD, after costs, from the engine output:

- `startValue`, `endValue`, `totalReturnPct`.
- `annualisedReturnPct = ((end/start)^(1/years) − 1) × 100`, where
  `years = (lastDate − firstDate in days) / 365.25`.
- `maxDrawdownPct`: the largest fall from a previous peak, with
  `peakDate`, `troughDate` and `recoveryDate` (or `null`); the peak starts at
  `startValue`.
- `returnToDrawdown = annualisedReturnPct / maxDrawdownPct`, or `null` when
  the drawdown is 0.
- `sessions`, `years`, `firstDate`, `lastDate`.
- **Trades**:
  - buys and sells, excluding the initial allocation;
  - `roundTrips`: an exit followed by its buy-back;
  - `exitsWithoutBuyBack`;
  - `pendingAtEnd`.
- **Holdings episodes** (buy fill to sell fill, or to the end, marked to
  market):
  - net P/L in dollars and %, including that episode's costs and dividends;
  - the average gain (winners) and average loss (losers), in dollars and %,
    with their counts.
- `timeInCashPct = Σ cash / Σ equity` over the sessions (weighted by money),
  and `sleeveTimeOutPct`, the share of sleeve-sessions spent `out`.
- **Missed rebounds**, for each round trip:
  - `changePct = buyBackPrice / exitPrice − 1`, both on the split-adjusted
    basis, using effective prices;
  - `reboundsMissed`: the count with `changePct > 0`, and
    `Σ exitShares × (buyBack − exit)` for them;
  - `declinesAvoided`: the same for `changePct ≤ 0`;
  - the stock's largest rise while out (exit to the highest close before the
    buy-back);
  - open exits at the end, valued at the last close.
- **Losses after buying back**: episodes that started with a buy-back and
  ended with an exit below the buy-back price. Count and total dollars.
- **Costs**: spread and slippage, fees and the total. **Dividends**: gross,
  withheld and net, plus receivables still owed at the end.
- **Fill comparison** (from a pair of runs with fill models `open` and
  `vw15`):
  - the median and mean absolute difference per fill, in bps;
  - the difference in end value;
  - the count of fills without `vw15`.
- **Per stock**: end value, P/L, round trips, time out, costs and dividends.
- **Hold comparison**: the same fields for the hold arm, and HXR minus hold.

`evaluateCriteria(criteria, runs)` implements G1–G6 from
`criteria-hxr-v1.json`. It returns:

- every criterion's status (`pass`, `fail` or `not_evaluable`), its value and
  a note;
- the outcome: `PASS`, `FAIL` or `INSUFFICIENT_EVIDENCE`;
- the fixed meaning: *"eligible for the owner's review; never permission to
  trade"*.

A contaminated evaluation can never PASS.

## 8. Storage (`data/hxr-sim.sqlite`)

`openHxrDb(file)` refuses, after `fs.realpathSync` on the file or its
directory and a case-insensitive name comparison, any file named:

- `signal-desk.sqlite`;
- `demo.sqlite`;
- anything starting `strategy-lab`.

It also refuses any file that already holds a table that does not start with
`hxr_`.

| Table | Contents |
|---|---|
| `hxr_bars` | `symbol, date, o, h, l, c, v, n, vw, source='alpaca', feed='sip', adjustment='raw', fetched_at`. Primary key `(symbol, date)`. |
| `hxr_first15` | `symbol, date, o, h, l, c, v, vw, fetched_at`. Primary key `(symbol, date)`. |
| `hxr_corporate_actions` | `id` (Alpaca id), `type, symbol, cusip, ex_date, pay_date, process_date, ratio_old, ratio_new, rate, old_symbol, new_symbol, raw_json, fetched_at`. |
| `hxr_spread_samples` | `symbol, date, quotes, median_spread_bps, median_half_spread_bps, window, fetched_at`. |
| `hxr_news` | `id` (Alpaca id), `created_at, updated_at, headline, summary, source, url, symbols_json, first_seen_at, backfilled`. Plus `hxr_news_symbols(news_id, symbol)`. |
| `hxr_versions` | Frozen versions: `version, config_json, config_hash, based_on, frozen_at, prereg`. |
| `hxr_runs` | `id, kind` (`selection`, `evaluation`, `variant`, `prospective`), `label, version, config_hash, basket, period_json, fill_model, delay, data_hash, calibration_hash, status, contaminated, reason, metrics_json, details_json, created_at, finished_at`. |
| `hxr_fills`, `hxr_decisions`, `hxr_episodes`, `hxr_equity` | Per run, with the JSON detail. |
| `hxr_ledger` | One row per selection or evaluation event: `kind, prereg, version, config_hash, run_ids_json, contaminated, reason, at`. Never deleted. |
| `hxr_experiments` | The experiment log, mirrored in `EXPERIMENT-LOG.md`: `at, what, version, data_touched, results_seen, note`. |
| `hxr_prospective` | One account: `id, version, config_hash, started_at, start_date, symbols_json, state_json, last_processed, status`. Plus `hxr_prospective_events` for decisions, fills, dividends, warnings and news links, each with `recorded_at` and `on_time`. |
| `hxr_settings` | Key/value pairs, e.g. `spcxConfirmed` (whether the owner confirmed SPCX = SpaceX on Nasdaq). |

## 9. Data rules (`source.js`, `data.js`)

- **Endpoints**:
  - `GET /v2/stocks/bars`, with `feed=sip`, `adjustment=raw`, `timeframe=1Day` or `15Min`;
  - `GET /v1/corporate-actions` (forward splits, reverse splits, cash dividends, name changes, stock dividends and mergers);
  - `GET /v2/stocks/quotes`, with `feed=sip`;
  - `GET /v1beta1/news`.
- **Requests**:
  - headers `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY` come from `ctx.cfg.secrets`;
  - every error message passes through `redact()`;
  - HTTP 429 backs off using `X-Ratelimit-Reset` or exponentially, up to 6 retries.
- **Completed sessions only**:
  - never request an `end` later than now minus 16 minutes;
  - a daily bar for session `d` is stored only once `now ≥ close(d) + 20 minutes`;
  - Alpaca returns today's unfinished bar even when `end` is earlier, so the code must drop it by date.
- **Listing starts** come from `universe-hxr-v1.json`: bars, corporate actions and dividends dated before `listedFrom` are ignored. This covers Yandex under NBIS and the old SPCX ETF.
- **Corporate actions**: Alpaca filters by process or payable date, not ex-date, so every request spans 2015-01-01 to today plus 1 year, and filtering by ex-date is done locally.
- **First 15-minute bar**: the bar starting at the session's open (09:30 ET), taken from `15Min` bars that also include extended hours.
- **Spread samples**: quotes from the open to one minute later, on the sampled days in `PREREGISTRATION.md` section 5. The half-spread is `(ask − bid) / 2 / mid` for each quote, and the stored value is the median. Quotes with `bid ≤ 0`, `ask ≤ bid` or a spread over 5% of mid are dropped.
- **News**:
  - fetch by symbol and page through `next_page_token`;
  - Alpaca's `start` and `end` filter on `updated_at`, so `created_at` is filtered locally;
  - `first_seen_at` is the time Signal Desk first stored the item;
  - an item first seen more than 30 minutes after its `created_at` is `backfilled = 1`;
  - news text is untrusted: the page renders it with `h()` text nodes only, and it is never sent to an AI model in this version.
- **Readiness**, for each symbol and period:
  - sessions expected from `server/calendar.js` versus bars present;
  - zero-volume bars after `listedFrom`;
  - excluded sessions;
  - each split's raw overnight ratio, which must be about `1/ratio`;
  - an unknown-split scan (overnight ratio within 8% of `1/k` or `k`, for k = 2, 3, 4, 5, 10, 20);
  - dividend count and name changes.

  A period is usable only if every basket member is complete for it.

## 10. Prospective account (`service.js`)

- `start({ confirm: true })` needs a frozen version, and refuses if an
  account already exists. Basket B is used, with SPCX added only if
  `spcxConfirmed`. The account starts on the first session after the start
  time.
- `tick({ now })` runs from the scheduler and from the page's **Process
  now** button. It:
  - fetches the new completed sessions and their corporate actions;
  - polls news;
  - processes every complete, unprocessed session in order with the stored
    engine snapshot;
  - stores the events with `recorded_at = now`, and
    `on_time = recorded_at < open of the next session`;
  - attaches to each decision the news items with `first_seen_at ≤ recorded_at`
    and `created_at` in the previous 72 hours.

  It never imports `server/delivery.js` or `server/alerts.js` and never sends
  anything.
- Both arms (HXR and hold) run side by side from the same start.
