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

## Using it (Signal Desk → HXR (simulated))

1. **Download / refresh data.**
   - Uses the Alpaca keys in `.env`; only market data is read.
   - Gets daily bars from 2016, corporate actions, the first 15-minute bar of
     each session, and opening quotes for the spread estimates.
   - The opening quotes take the longest: allow an hour or more the first time.
   - Later downloads add only what is new.
2. **Check readiness.** Every stock must be complete for a period before
   that period can run. A flagged split-like move can be marked as reviewed,
   with a written reason.
3. **Owner decisions.**
   - Confirm SPCX = SpaceX, or leave it out.
   - Keep or drop Micron in the evaluation. Dropping it means a restated
     pre-registration before anything runs.
4. **Run selection (once).**
   - Runs X1, X2, X3 and the hold on 2017–2022. Only X1 or X2 can be picked;
     X3 is shown as your comparison. Neighbouring settings and the robustness
     list are reported only.
   - Freezes the pick as `hxr-1.0.0`, or stops if none is worth evaluating.
   - Then add `configs/hxr-1.0.0.json` (the page shows its content and hash)
     and log it in `EXPERIMENT-LOG.md`.
5. **Run evaluation (once).**
   - Runs on 2023–2026, with the stress, leave-one-out, realistic-fill and
     full-list runs.
   - The outcome is PASS, FAIL or INSUFFICIENT EVIDENCE.
6. **Start the prospective account.**
   - It processes each new session after the close.
   - Each decision shows when it was recorded and the news known then.
   - **Process now** catches up immediately, and **Pause** stops it.

## Files

| File | Purpose |
|---|---|
| `PREREGISTRATION-2.md` | **Active (hxr-prereg-2).** Exit rules X1 (recovery-point break), X2 (normal-movement allowance), X3 (10% give-back, comparison only) and one buy-back rule; GOOG added; robustness list R; G6 as 5 of 6 |
| `PREREGISTRATION.md` | hxr-prereg-1: costs, account, periods, disclosures and criteria (still in force by reference); its candidates C1–C3 are superseded |
| `ENGINE-SPEC.md` | Exact mechanics of the engine, data, storage and prospective account |
| `universe-hxr-v1.json` | The owner's stocks, listing dates and baskets |
| `periods-hxr-v1.json` | Selection, evaluation, full-list and prospective periods; excluded sessions |
| `criteria-hxr-v1.json` | G1–G6 and P1–P4 in machine-readable form |
| `configs/` | The hold arm and candidates C1–C3 (all experimental) |
| `EXPERIMENT-LOG.md` | Every activity that touched data, and whether results were seen |
| `reports/` | Step reports (step 1: `2026-10-22-step1-capabilities.md`) |

Code: `server/hxr/` (config, store, source, data, engine, metrics, service, api), page `public/views/hxr.js`, tests `tests/hxr-*.test.js`. Database: `data/hxr-sim.sqlite` (real workspace only; backed up to `backups/hxr/`).
