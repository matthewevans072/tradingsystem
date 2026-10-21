# Strategy Lab — architecture

How the Strategy Lab fits into Signal Desk. The trading rules are in
`RULES.md` and `ENGINE-SPEC.md`; this file covers storage, the simulated
forward test, TradingView alerts, the API, the page and the chat agent.

## Separation from the real portfolio

- The Lab has its own database files: `data/strategy-lab.sqlite` (used with
  the real workspace) and `data/strategy-lab-demo.sqlite` (demo workspace,
  synthetic data only). Lab code never opens `signal-desk.sqlite` for
  writing, never reads real cash or holdings, and never creates proposals.
- The simulated account starts from the hypothetical balance in the strategy
  config and is labelled "simulated" everywhere it appears.
- Nothing in the Lab can place, route or prepare a real or TradingView Paper
  Trading order.

## Modules (`server/strategy/`)

| File | Role |
|---|---|
| `config.js` | load/validate/hash strategy configs; universe, splits, acceptance files |
| `indicators.js`, `sessions.js`, `costs.js`, `boxes.js`, `engine.js` | the deterministic engine (`ENGINE-SPEC.md`) |
| `data.js`, `synthetic.js` | CSV parsing, normalisation to regular-session 15-minute bars, quality report, dataset hash; synthetic data for tests and the demo |
| `explain.js` | plain-English reasons shared by the page and the chat agent |
| `metrics.js`, `regimes.js`, `validation.js`, `report.js` | metrics, regimes, splits, stress tests, walk-forward, acceptance, reports |
| `store.js` | the Lab database (schema below) |
| `lab.js` | the service used by the API, the scheduler and the chat tools |
| `forward.js` | the simulated forward test |
| `webhook.js` | optional TradingView alert receiver (off unless configured) |
| `api.js` | `/api/lab/*` routes |

## Database (`store.js`)

- `lab_bars(symbol, interval, t, o, h, l, c, v, source, synthetic, fetched_at)`, primary key `(symbol, interval, t)`.
- `lab_runs(id, kind, mode, split, version, config_hash, config_json, data_hash, from, to, symbols_json, options_json, metrics_json, acceptance_json, report_md, synthetic, contaminated, reason, created_at)`; `kind` is `backtest`, `stress`, `walk_forward`, `holdout` or `forward`.
- `lab_trades(id, run_id, symbol, entry_at, exit_at, r, net, trade_json)`.
- `lab_events(id, run_id, source, at, symbol, type, reason, details_json)`; `source` is `backtest`, `forward` or `tradingview`.
- `lab_equity(run_id, t, equity, cash, positions, open_risk)` for forward runs (backtest curves are stored downsampled in the run).
- `lab_forward(mode, run_id, version, config_hash, started_at, stopped_at, processed_through, state_json, status, last_error)`.
- `lab_webhook_alerts(id, received_at, dedupe_key UNIQUE, status, reason, symbol, event, bar_time, payload_json)` (the secret is never stored).
- `lab_holdout_runs(version, config_hash, mode, run_id, at, reason, contaminated)`.
- `lab_param_changes(id, at, from_version, to_version, path, from_value, to_value, reason, data_seen)`.
- `lab_settings(key, value_json)`.

## Forward test (`forward.js`)

- Off until the owner switches it on for a mode. Switching on freezes the
  strategy version and config hash for that forward run; a different version
  starts a new forward run (the 100-trade count restarts).
- Each scheduler tick during the regular session: when a 15-minute bar has
  completed, fetch the latest bars for the universe from the configured
  market-data provider, append new completed bars, and feed every new
  timestamp, in order, to the engine restored from its saved snapshot. The
  snapshot is saved after every timestamp, so a timestamp is never processed
  twice and past decisions never change.
- Stale data: a signal is acted on only if its bar was processed within
  `LAB_MAX_SIGNAL_DELAY_MIN` (default 5) minutes of the bar's close; otherwise
  the pending order is cancelled and journalled as `expired` — a live system
  could not have acted on it in time. Late or missing bars, provider errors
  and catch-up after sleep are journalled as data warnings or operational
  errors.
- Stops and targets behave as resting orders, so they apply even if the app
  was asleep; a time exit while the app was asleep is journalled with a
  warning (a live system would need a broker-side order for it).

## TradingView alerts (`webhook.js`, optional)

TradingView can only reach a public URL on port 80 or 443, and the main app
listens on 127.0.0.1 only. The receiver is therefore a separate listener,
off unless `LAB_WEBHOOK_SECRET` (at least 24 random characters) and
`LAB_WEBHOOK_PORT` are set in `.env`. It binds to 127.0.0.1, accepts only
`POST /tradingview`, and is meant to sit behind a tunnel or reverse proxy that
the owner sets up deliberately and that forwards that one path only. It:

- requires the secret in the JSON body (TradingView cannot add headers), compared in constant time;
- caps the body at 8 KB and the rate at 60 requests a minute;
- validates the payload, rejects signals whose bar is too old or in the future;
- deduplicates by strategy, version, mode, symbol, event, bar time and order id;
- answers within TradingView's 3-second limit;
- records every request (accepted, duplicate, rejected, error) without the secret;
- never places or changes anything: alerts are journalled and compared with Signal Desk's own signals. They do not drive the simulated account.

## API (`/api/lab/*`, same local-only and CSRF protections as the rest)

| Route | |
|---|---|
| `GET /api/lab/overview?mode=` | version, settings, simulated account, positions, active boxes, recent decisions, data freshness, warnings, latest runs, acceptance |
| `GET /api/lab/bars?symbol=&from=&to=` | bars with boxes and trades for the chart |
| `GET /api/lab/trades?source=&runId=&symbol=` · `GET /api/lab/trades/:id` | trade journal with explanations |
| `GET /api/lab/runs` · `GET /api/lab/runs/:id` | runs with metrics, equity curve, report |
| `GET /api/lab/journal?source=&type=&symbol=` | signals, skips, fills, exits, costs, errors |
| `GET /api/lab/versions` · `GET /api/lab/versions/diff?from=&to=` | versions and parameter changes |
| `POST /api/lab/runs` | run development, validation, stress or walk-forward |
| `POST /api/lab/holdout` | run the holdout (once per version; a second run needs a reason and is marked contaminated) |
| `POST /api/lab/import` | import a CSV for one symbol |
| `POST /api/lab/fetch` | download history through the configured provider (background job) |
| `POST /api/lab/forward` | switch the forward test on or off for a mode |

## Chat agent

Read-only tools `get_strategy_lab`, `get_strategy_trades`,
`get_strategy_performance` and `get_strategy_versions` call `lab.js` and
register every returned item in the turn's ledger. They answer why a trade
triggered, what invalidated it, how much simulated capital is at risk,
whether results come from one stock or many, and what changed between
versions. There is no tool that changes rules, settings or the simulated
account; the agent explains, it does not decide.
