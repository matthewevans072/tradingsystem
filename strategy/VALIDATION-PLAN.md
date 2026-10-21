# Validation plan (pre-registered)

Written on 2026-10-21, before any data for this strategy was downloaded and
before any backtest or forward test was run. The machine-readable versions
are `splits-v1.json`, `universe-v1.json` and `acceptance-v1.json`; their git
commit is the evidence of when they were fixed.

## What is being tested

The question is whether the consolidation-breakout rules in `RULES.md`
(version 1.0.0, config `configs/cb-1.0.0.json`) have a repeatable advantage
after realistic costs, on a universe chosen in advance, in two separate
configurations: intraday (flat before the close) and swing (overnight holds,
up to 10 sessions). Each configuration is judged on its own.

A negative or inconclusive result is a valid outcome and will be reported as
such. The rules will not be tuned until something looks profitable.

## Data

- Universe: `universe-v1.json` (17 US stocks and unlevered ETFs across
  sectors; a 5-name AI/technology cluster is tagged so its correlated weight
  can be measured).
- 15-minute regular-session bars, split-adjusted, 2021-07-01 to 2026-06-30.
- The first six months are warm-up only.

## Chronological split

| Part | Dates | Use |
|---|---|---|
| Warm-up | 2021-07-01 – 2021-12-31 | indicators only |
| Development | 2022-01-01 – 2023-12-31 | build and debug; individual trades may be inspected |
| Validation | 2024-01-01 – 2024-12-31 | fixed rules, stress tests, neighbouring settings |
| Holdout | 2025-01-01 – 2026-06-30 | one final run per strategy version |
| Forward test | from the day it is switched on | rules frozen |

Walk-forward (robustness check): over 2022–2024, each quarter from 2023 Q1 is
tested with the grid point chosen on the previous four quarters from a fixed
9-point grid (`maxHeightAtr` 2.5/3.0/3.5 × `volumeMultiple` 1.25/1.5/1.75,
at least 30 in-sample trades, otherwise the baseline). Only the out-of-sample
quarters are reported, next to the fixed baseline.

## Rules for changing anything

- Every rule or parameter change creates a new strategy version
  (`cb-1.1.0`, …) with a new config file. It is logged in
  `PARAMETER-LOG.md` and in the Strategy Lab with its reason and which data
  had been seen when it was made (none, development, validation, holdout).
- A change made after looking at validation results makes validation an
  in-sample period for the new version; the report says so.
- The holdout is run once per version. The Strategy Lab and the command-line
  runner refuse a second run unless a written reason is given; the result is
  then marked contaminated and cannot satisfy the acceptance criteria.
- Forward-test rules are frozen. Losses do not change them. Stopping the
  forward test early or changing the version restarts the forward count.

## Acceptance criteria (fixed now, before results)

Per configuration, at base costs unless stated (`acceptance-v1.json`):

| | Criterion |
|---|---|
| B1 | ≥ 100 closed holdout trades and ≥ 60 validation trades (else inconclusive) |
| B2 | mean R > +0.10 per trade in validation and in holdout |
| B3 | 95 % bootstrap interval of holdout mean R entirely above 0 |
| B4 | holdout profit factor ≥ 1.20, and ≥ 1.00 at twice the costs |
| B5 | holdout maximum drawdown ≤ 10 % |
| B6 | holdout mean R ≥ 0 without the best 5 % of trades; no symbol > 40 % of net profit |
| B7 | holdout mean R ≥ 0 without the AI/technology cluster |
| B8 | validation mean R > 0 for ≥ 70 % of the 12 neighbouring settings |
| B9 | holdout mean R > 0 with stop-first resolution of ambiguous bars |
| B10 | walk-forward out-of-sample mean R > 0 |
| F1 | ≥ 100 closed forward trades and ≥ 3 months, whichever is later (else inconclusive) |
| F2 | one version and config hash for the whole forward test |
| F3 | forward mean R > 0 and inside the holdout 95 % interval |
| F4 | ≤ 5 % of forward signals lost to stale data or errors; no duplicate trades |

Outcome: **not eligible** (any failure), **inconclusive** (nothing failed,
something could not be evaluated) or **eligible for review** (all passed).
"Eligible for review" means the owner may look at the evidence. It is not
permission to trade, it does not enable anything, and the 100-trade forward
milestone is a review checkpoint, not statistical proof.

Reported but not pass/fail: comparison with equal-weight buy-and-hold of the
universe and with SPY over the same dates; results by symbol, sector, regime
(SPY above/below its 50-day average; SPY 20-day realised volatility under 15 %,
15–25 %, over 25 %, each measured on the previous day), year and time of day;
exposure, turnover, costs; losses beyond the planned risk.

## Stress tests (validation period)

Costs × 2 and × 3, slippage + 5 bps, entry 0.1 ATR worse, target-first and
TradingView-path resolution of ambiguous bars, TradingView-style intrabar
limit entries, and the 12 one-at-a-time neighbours in `acceptance-v1.json`.

## Forward test protocol

- Runs in Signal Desk's simulated account with the frozen version. Every
  signal, order, fill, skip, exit, cost and operational error is journalled.
- A signal is acted on only if its bar was processed within 5 minutes of the
  bar's close; otherwise it is recorded as expired (a live system could not
  have acted on it in time).
- TradingView alerts, if set up, are logged and compared with Signal Desk's own
  signals; they do not drive the account.
- Review at the F1 milestone. Nothing moves to real trading without a
  separate, explicit instruction from the owner and the review listed in
  `QUESTRADE-ASSESSMENT.md`.
