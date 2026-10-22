# HXR — hold, exit, re-enter (simulation only)

HXR asks whether selling a stock to cash when its price trend breaks, and
buying it back when it recovers, beats simply holding the same stocks. It is
tested only in simulation, starting from a hypothetical US$15,000 in USD.

HXR is kept apart from everything else in Signal Desk:

- **Your real portfolio**: HXR never reads or changes your holdings, cash or
  `data/signal-desk.sqlite`.
- **The Strategy Lab**: the consolidation-breakout strategy has its own
  database and its holdout ledger. HXR never touches either.
- **Brokers**: HXR has no connection to any broker or paper-trading account.
  Every order is an internal, simulated record. Nothing is sent anywhere.
- **Notifications**: HXR sends none, and sets no reminders.

## Three different things

| | What it is | HXR? |
|---|---|---|
| Backtest | Running fixed rules over past daily bars | **Yes**: Signal Desk's own HXR engine |
| Simulated ledger | A pretend account that processes each new session as it happens, records every decision with a timestamp and fills at the next open | **Yes**: the prospective account |
| Platform paper trading | Sending orders to a broker's or platform's simulator (Alpaca, IBKR, TradingView Paper Trading, QuantConnect) | **No** (project rule: no order integrations) |

## Files

| File | Purpose |
|---|---|
| `PREREGISTRATION.md` | The rules, candidates, costs, periods, disclosures and pass/fail criteria, fixed before any result |
| `ENGINE-SPEC.md` | Exact mechanics of the engine, data, storage and prospective account |
| `universe-hxr-v1.json` | The owner's stocks, listing dates and baskets |
| `periods-hxr-v1.json` | Selection, evaluation, full-list and prospective periods; excluded sessions |
| `criteria-hxr-v1.json` | G1–G6 and P1–P4 in machine-readable form |
| `configs/` | The hold arm and candidates C1–C3 (all experimental) |
| `EXPERIMENT-LOG.md` | Every activity that touched data, and whether results were seen |
| `reports/` | Step reports |
