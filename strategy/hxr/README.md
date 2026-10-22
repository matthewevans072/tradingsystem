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
4. **Run the development pick (once).**
   - Needs amendment 3b first: `selection.pickRule` in `criteria-hxr-v3a.json`
     must say `ending_value` (most profit) or `return_to_drawdown` (best
     return per unit of fall). While it says `pending_owner_choice` the run
     is refused.
   - Runs the fully invested hold, the day-one hold, the six candidates
     (X1A–X1C, X2A–X2C) and the three comparisons (X3A–X3C) on the
     development period (2017-10-02 to 2021-12-31), each also with first
     15-minute VWAP fills. Only a candidate can be picked, and only one that
     beats both benchmarks with at least 10 completed cycles. The winner's
     ten neighbouring settings are then run and reported only.
   - Freezes the pick as `hxr-1.0.0`, or stops HXR if none qualifies.
   - Then add `configs/hxr-1.0.0.json` (the page shows its content and hash)
     and log it in `EXPERIMENT-LOG.md`.
5. **Run the validation (once).**
   - The pick, the hold and the day-one hold on 2022-01-03 to 2023-12-29.
   - V1: at least 10 completed cycles. V2: return per unit of fall at least
     1.10 × each benchmark's. If the pick does not validate, HXR stops; no
     runner-up is ever tried.
6. **Run the final run (once).**
   - 2024-01-02 to 2026-10-21, as triples (HXR, hold, day-one hold): base
     costs, doubled costs, a two-session delay, VWAP fills, 0% withholding,
     ten leave-one-stock-out runs and the basket B full-list check.
   - G1–G6 are judged against both benchmarks. The outcome is PASS, FAIL or
     INSUFFICIENT EVIDENCE.
7. **Start the prospective account.**
   - It processes each new session after the close.
   - Each decision shows when it was recorded and the news known then.
   - **Process now** catches up immediately, and **Pause** stops it.

## The rules in brief (hxr-prereg-3a)

- **Cash is one pool.** Each buy is sized at the decision close from the
  planned exit distance (2.5 × the stock's typical daily move) and dollar
  budgets: planned loss US$150 per trade, position US$3,000, total open risk
  US$750, tech/AI exposure US$10,500, cash. A buy that would risk less than
  half the planned loss is skipped. The day-one positions are sized the same
  way, in alphabetical order, each asking for an equal share of the open-risk
  budget.
- **Initial loss.** Every holding has a loss level 2.5 typical moves below
  its entry; a close below it sells, whatever the exit rule says.
- **Exit rules.** X1 sells on a close below the recovery point; X2 on a fall
  from the high beyond the normal daily movement; X3 (comparison only) on a
  10% give-back. The exit level is the higher of the initial-loss level and
  the rule's own.
- **Buy-back.** The stock is bought back at the next confirmed recovery point
  below the sale price. If it rebounds above the sale price first, policy A
  stays in cash for good, B buys at the next recovery point at any price, and
  C does the same after 60 sessions out. A stock never held, or whose buy was
  skipped, enters at the next recovery point at any price.
- **Pause.** When the account is US$1,500 below its peak, new buys stop
  until it is within US$750 again; exits still run.
- **Benchmarks.** The fully invested hold, and the day-one positions held and
  never sold. Every pass/fail test must beat both.

All numbers are experimental defaults recorded before any run; see
`PREREGISTRATION-3.md` and `PREREGISTRATION-3a.md`.

## Files

| File | Purpose |
|---|---|
| `PREREGISTRATION-3a.md` | **Active (hxr-prereg-3a).** Six candidates (X1 and X2, each with fresh-entry policy A, B or C), X3A–C as comparison only; the development pick rule (pending amendment 3b: most profit, or best return per unit of fall); one winner to validation, then final; fresh entries reported apart from buy-backs; the day-one hold as a second benchmark |
| `PREREGISTRATION-3.md` | hxr-prereg-3: positions sized from pooled cash, the planned exit distance and dollar budgets; the initial-loss rule for every exit rule; the pause; three periods; the laggards in basket A; the validation gate (in force by reference) |
| `PREREGISTRATION-2.md` | hxr-prereg-2: exit rules X1 (recovery-point break), X2 (normal-movement allowance), X3 (10% give-back) and the buy-back rule (in force by reference); its X1–X3 configs are superseded |
| `PREREGISTRATION.md` | hxr-prereg-1: costs, account, disclosures and criteria (in force by reference); its candidates C1–C3 are superseded |
| `ENGINE-SPEC.md` | Exact mechanics of the engine, data, storage and prospective account |
| `universe-hxr-v3.json` | The owner's stocks, listing dates, tech/AI tags and baskets (A: ten stocks; B: thirteen; prospective) |
| `periods-hxr-v3.json` | Development, validation, final (used once), full-list and prospective periods; excluded sessions |
| `criteria-hxr-v3a.json` | G1–G6, V1–V2, the two pick rules and P1–P4 in machine-readable form; both benchmarks |
| `configs/` | The hold arm, the nine 0.3.0 configs (six candidates, three comparisons) and the superseded C1–C3 and X1–X3 (all experimental) |
| `EXPERIMENT-LOG.md` | Every activity that touched data, and whether results were seen |
| `reports/` | Step reports (step 1: `2026-10-22-step1-capabilities.md`) |

Code: `server/hxr/` (config, store, source, data, engine, metrics, service, api), page `public/views/hxr.js`, tests `tests/hxr-*.test.js`. Database: `data/hxr-sim.sqlite` (real workspace only; backed up to `backups/hxr/`).
