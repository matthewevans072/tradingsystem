# Development and validation results, cb-1.0.0 on splits-v2 — 2026-10-22

**Outcome: NOT ELIGIBLE in both modes (intraday and swing).** Criterion B8
(stable nearby settings) fails in both. The bigger finding is that the frozen
rules produced almost no trades:

| Mode | Development trades (2022–2023) | Validation trades (2024) |
|---|---|---|
| Intraday | 2 | 0 |
| Swing | 8 | 1 |

acceptance-v1 needs at least 60 validation trades. These samples are far too
small to say whether the strategy has an edge, either way. The results are
negative-to-inconclusive. They are not evidence that the strategy is
profitable, and nothing here makes it ready for live trading.

These are simulated results for a hypothetical US$100,000 account. No orders
were placed, and the real portfolio was not read or changed. **The holdout was
not run.** The database has no holdout record (`lab_holdout_runs` is empty).
No rule, parameter, period or criterion was changed after the results were
seen.

## What was run

| | |
|---|---|
| Strategy | cb-1.0.0, config hash `5167db4c4278…`, engine-1.0.1 (frozen rules and base costs) |
| Data | Alpaca SIP, split-adjusted, 17 symbols, `splits-v2` (four excluded sessions), readiness 17/17 READY in every period |
| Data hashes | development `5551d19d93cf…`; validation, stress and walk-forward `52e9695f3dda…` |
| Runs (Strategy Lab database) | intraday: 1 development, 2 validation, 3 stress, 4 walk-forward; swing: 5, 6, 7, 8 |
| Criteria | acceptance-v1, evaluated by the Lab's `evaluateAcceptance` |
| Not run | holdout (never), forward test (needs a paid real-time feed) |

The new readiness gate passed before every run: every symbol was READY for
every period each run reads.

## Results per mode and period

Figures are simulated, after costs. R is profit divided by the planned risk;
mean R is the average per trade.

| | Intraday dev | Intraday val | Swing dev | Swing val |
|---|---|---|---|---|
| Closed trades | 2 | 0 | 8 | 1 |
| Wins / losses | 0 / 2 | — | 3 / 5 | 1 / 0 |
| Mean R | −1.00 | — | +0.66 | +2.43 |
| 95% bootstrap interval of mean R | −1.00 to −1.00 | — | −0.62 to +2.45 | — (one trade) |
| Profit factor | 0.00 | — | 2.46 | — (no losses) |
| Net P/L (US$) | −429.67 | 0.00 | +1,472.92 | +503.46 |
| Return on US$100,000 | −0.43% | 0.00% | +1.47% | +0.50% |
| Maximum drawdown | 0.43% | 0.00% | 0.86% | 0.00% |
| Costs paid (US$) | 62.89 | 0.00 | 211.15 | 20.52 |
| — commission | 6.65 | 0.00 | 58.81 | 4.26 |
| — spread and slippage | 56.24 | 0.00 | 152.34 | 16.26 |
| Time in the market | 0.01% | 0% | 0.05% | 0.02% |
| Exits | 2 stop | — | 5 stop, 3 target | 1 target |
| Mean R without the best 5% of trades | −1.00 | — | −0.10 | — |

For comparison, with no costs and no rebalancing:

| | Development (2022–2023) | Validation (2024) |
|---|---|---|
| Equal-weight buy-and-hold of the 17 symbols | +11.14% (max drawdown 28.28%) | +26.52% (max drawdown 12.05%) |
| SPY buy-and-hold | −0.20% (max drawdown 25.37%) | +24.11% (max drawdown 8.40%) |

The strategy was almost always in cash, so these comparisons say little about
the rules. They are reported because the validation plan requires them.

### By symbol

| Mode, period | Symbol | Trades | Mean R | Net (US$) | Costs (US$) |
|---|---|---|---|---|---|
| Intraday dev | MU | 1 | −1.00 | −189.47 | 31.37 |
| Intraday dev | SPY | 1 | −1.00 | −240.20 | 31.52 |
| Swing dev | FCX | 1 | −1.00 | −197.65 | 20.17 |
| Swing dev | HD | 1 | −1.00 | −225.70 | 29.08 |
| Swing dev | MSFT | 1 | +2.26 | +496.58 | 18.22 |
| Swing dev | MU | 1 | −1.00 | −189.88 | 31.44 |
| Swing dev | NVDA | 1 | −1.00 | −152.12 | 39.14 |
| Swing dev | SPY | 1 | −1.00 | −240.20 | 31.52 |
| Swing dev | VRT | 2 | +4.03 | +1,981.89 | 41.58 |
| Swing val | MU | 1 | +2.43 | +503.46 | 20.52 |

The other symbols had no trades. In swing development, VRT alone made 135% of
the net profit, from 2 trades. One of them (+6.03 R) gapped through its target
at the open on 2022-11-10. Five of the 8 swing development trades are in the
ai_tech cluster (VRT twice, MU, NVDA and MSFT). Without the cluster, the run
has 3 trades (FCX, HD and SPY), all at −1 R, for −663.55.

### By year

| Mode | Year | Trades | Mean R | Net (US$) | Costs (US$) |
|---|---|---|---|---|---|
| Intraday | 2022 | 2 | −1.00 | −429.67 | 62.89 |
| Intraday | 2023 | 0 | — | 0.00 | 0.00 |
| Intraday | 2024 | 0 | — | 0.00 | 0.00 |
| Swing | 2022 | 7 | +0.44 | +976.34 | 192.93 |
| Swing | 2023 | 1 | +2.26 | +496.58 | 18.22 |
| Swing | 2024 | 1 | +2.43 | +503.46 | 20.52 |

### Every trade

| Run | Symbol | Entry (ET) | Exit (ET) | Exit reason | R | Net (US$) | Costs (US$) |
|---|---|---|---|---|---|---|---|
| Intraday dev | MU | 2022-05-04 10:00 | same bar | stop | −1.00 | −189.47 | 31.37 |
| Intraday dev | SPY | 2022-05-20 09:45 | 10:00 | stop | −1.00 | −240.20 | 31.52 |
| Swing dev | FCX | 2022-01-31 09:30 | same bar | stop | −1.00 | −197.65 | 20.17 |
| Swing dev | VRT | 2022-02-24 15:45 | 2022-02-25 09:45 | target | +2.02 | +483.62 | 15.58 |
| Swing dev | MU | 2022-05-04 10:00 | same bar | stop | −1.00 | −189.88 | 31.44 |
| Swing dev | HD | 2022-05-09 15:15 | same bar | stop | −1.00 | −225.70 | 29.08 |
| Swing dev | SPY | 2022-05-20 09:45 | 10:00 | stop | −1.00 | −240.20 | 31.52 |
| Swing dev | NVDA | 2022-08-26 09:30 | same bar | stop | −1.00 | −152.12 | 39.14 |
| Swing dev | VRT | 2022-11-09 15:15 | 2022-11-10 09:30 | target (gap at open) | +6.03 | +1,498.26 | 26.01 |
| Swing dev | MSFT | 2023-03-15 09:30 | 09:45 | target | +2.26 | +496.58 | 18.22 |
| Swing val | MU | 2024-03-20 15:15 | 15:30 | target | +2.43 | +503.46 | 20.52 |

No bar touched both the stop and the target, so the ambiguity setting decided
nothing. No loss went beyond −1 R.

## Acceptance-v1, per mode

Development has no criteria: it is for building and debugging. The criteria
draw on validation (B1, B2), the validation stress tests (B8), the
walk-forward (B10) and the holdout (B1–B7, B9). The holdout was not run, so
every holdout-based criterion cannot be evaluated.

| Criterion | Intraday | Swing |
|---|---|---|
| B1 Enough trades (≥ 60 validation, ≥ 100 holdout) | cannot be evaluated: holdout not run; validation has 0 of the 60 needed | cannot be evaluated: holdout not run; validation has 1 of 60 |
| B2 Mean R > +0.10 in validation and holdout | cannot be evaluated: no validation trades; holdout not run | cannot be evaluated: holdout not run (validation +2.43 R on 1 trade) |
| B3 Holdout bootstrap interval above 0 | cannot be evaluated: holdout not run | cannot be evaluated: holdout not run |
| B4 Holdout profit factor ≥ 1.20, ≥ 1.00 at 2× costs | cannot be evaluated: holdout not run | cannot be evaluated: holdout not run |
| B5 Holdout max drawdown ≤ 10% | cannot be evaluated: holdout not run | cannot be evaluated: holdout not run |
| B6 Not a few exceptional trades | cannot be evaluated: holdout not run | cannot be evaluated: holdout not run |
| B7 Not one correlated cluster | cannot be evaluated: holdout not run | cannot be evaluated: holdout not run |
| **B8 Neighbouring settings: mean R > 0 in ≥ 70% of 12** | **FAIL: 1 of 12 (8%)** | **FAIL: 8 of 12 (67%)** |
| B9 Holdout mean R > 0 with stop-first | cannot be evaluated: holdout not run | cannot be evaluated: holdout not run |
| B10 Walk-forward out-of-sample mean R > 0 | cannot be evaluated: 0 out-of-sample trades | PASS on 2 trades (+2.34 R): far too few to mean anything |
| F1–F4 Forward test | cannot be evaluated: not started | cannot be evaluated: not started |
| **Outcome** | **not eligible** | **not eligible** |

A neighbour with no trades counts as not positive, as the evaluator states.
In swing, 7 of the 8 "positive" neighbours repeat the same single MU trade
from validation, slightly varied.

## Stress tests (validation period, 2024)

| Test | Intraday trades | Intraday mean R | Swing trades | Swing mean R | Swing net (US$) |
|---|---|---|---|---|---|
| Baseline | 0 | — | 1 | +2.43 | +503.46 |
| 2× costs | 0 | — | 0 | — | 0.00 |
| 3× costs | 0 | — | 0 | — | 0.00 |
| +5 bps slippage | 0 | — | 0 | — | 0.00 |
| Entry 0.1 ATR worse | 0 | — | 1 | +2.11 | +482.02 |
| Target-first ambiguity | 0 | — | 1 | +2.43 | +503.46 |
| TradingView-path ambiguity | 0 | — | 1 | +2.43 | +503.46 |
| Intrabar limit entry (TradingView parity) | 11 | −0.45 (PF 0.52, −860.64) | 17 | −0.23 (PF 0.74) | −698.83 |
| lookbackBars 15 | 1 | +1.09 | 4 | +0.89 | +933.91 |
| lookbackBars 25 | 0 | — | 0 | — | 0.00 |
| maxHeightAtr 2.5 | 0 | — | 0 | — | 0.00 |
| maxHeightAtr 3.5 | 2 | −1.00 | 6 | +1.11 | +1,516.42 |
| touchToleranceAtr 0.15 | 0 | — | 1 | +2.43 | +503.46 |
| touchToleranceAtr 0.25 | 0 | — | 1 | +2.43 | +503.46 |
| volumeMultiple 1.25 | 0 | — | 1 | +2.43 | +503.46 |
| volumeMultiple 1.75 | 0 | — | 0 | — | 0.00 |
| stop atrBuffer 0 | 0 | — | 0 | — | 0.00 |
| stop atrBuffer 0.2 | 0 | — | 1 | +2.20 | +486.91 |
| setupExpiryBars 5 | 0 | — | 1 | +2.43 | +503.46 |
| setupExpiryBars 15 | 0 | — | 1 | +2.43 | +503.46 |

Higher costs remove the single swing trade entirely. Higher costs both lower
the reward-to-risk entry limit and raise the cost-to-risk ratio (next
section). The stress runs keep no event journal, so which of the two applied
was not recorded. The only variant with a usable number of
trades is the TradingView-parity intrabar limit entry. It is a sensitivity
check, not the rule, and its mean R is negative in both modes.

## Walk-forward (2023 Q1 – 2024 Q4, out of sample)

In all 8 quarters, in both modes, no grid point reached the 30 in-sample
trades the plan requires. The baseline was therefore used in every quarter, as
pre-registered. The most in-sample trades for any grid point in any quarter
were 8 (intraday) and 15 (swing).

| Mode | Out-of-sample trades | Mean R | Net (US$) |
|---|---|---|---|
| Intraday | 0 | — | 0.00 |
| Swing | 2 (2023 Q1 MSFT, 2024 Q1 MU) | +2.34 | +996.84 |

## Why there are so few trades (diagnosis only; nothing changed)

The signal funnel for swing development. Intraday is identical up to the
signals; it then also rejects 28 breakouts in the last hour, places 68 orders
and fills 2.

| Step | Count |
|---|---|
| Boxes found (setups eligible) | 786 |
| Closes above the frozen ceiling | 363 |
| Rejected: breakout volume ≤ 1.5× average | 153 |
| Signals (passed the volume rule) | 210 |
| Rejected: estimated costs > 20% of the risk | 75 |
| Rejected: already at or beyond the target | 38 |
| Rejected: maximum entry at or below the stop | 1 |
| Orders placed | 96 |
| Skipped: next open above the maximum entry | 85 |
| Skipped: next open at or below the stop | 3 |
| **Filled** | **8** |

The maximum entry is the lower of the gap limit and the reward-to-risk limit.
For all 88 skipped orders, the binding limit was reward-to-risk: 2:1 to a 1×
box-height target, with the stop below the breakout candle's low. In 84 of the
85 orders skipped for opening too high, that limit was below the breakout
candle's own close. So an order
fills only when the next bar opens below the signal close.

Hand check, AMD: stop 110.44 and target 114.13 give a maximum entry of
111.6253. The next open was 111.97, so the order was skipped.

The skips look like this, measured from the maximum entry to the next open, in
ATR:

| Quartile | Lower | Median | Upper |
|---|---|---|---|
| Next open above the maximum entry | 0.38 | 0.83 | 1.42 |

This is how ENGINE-SPEC.md §4 defines the order, and the engine follows it. It
is not a data or code fault. It is a property of the pre-registered rules on
this universe. Changing it would be a new strategy version, and validation
would then count as seen data for that version (VALIDATION-PLAN.md). No such
change was made.

## Excluded sessions: effect on these runs

The four excluded sessions (2021-10-25, 2022-01-24, 2022-01-26, 2022-03-08)
fall in the warm-up and development. Validation, stress and walk-forward
trades start in 2023–2024, so they cannot be affected.

- **Trades open across an excluded session, or exiting on one:** none, in
  either mode.
- **Entries due in an excluded session:** none.
- **Indirectly affected:** one signal, in both modes. HD's breakout on
  2022-01-27 at 09:30 came from a box formed on 2022-01-25, so its ATR and
  20-bar volume average span the excluded 2022-01-26. The excluded day also
  used none of the setup's 10-bar expiry. The order was skipped at the next
  open (362.40, above the maximum entry 362.17), so it produced no trade.
- **No future data in the excluded-session exit.** No such exit happened in
  these runs. The rule is tested directly in
  `tests/strategy-exclusions.test.js`:
  - A swing position whose last session is excluded closes at the last close
    before it.
  - The decision comes from the exchange calendar alone.
  - The price is the close already known before the excluded session. The
    engine books it before reading the next session's bar.
  - The test re-runs the trade with every later bar changed (prices ×0.5 and
    ×1.6, volume ×7). Its exit time, price and P/L stay identical.

## Changes made before these runs (owner-approved)

- **Readiness gate.** The Lab (`startBacktest`, `startHoldout`) and
  `scripts/strategy-backtest.js` refuse a run on real data unless every symbol
  is READY for every period the run reads. Tests are in
  `tests/strategy-readiness-gate.test.js`.
- **Listing labels.** All 17 are now `verified` in `corporate-actions-v1.json`,
  citing finding 4 of the 2026-10-22 readiness report. These are
  documentation labels only.
- Both are logged in `PARAMETER-LOG.md`.
- **Tests.** `npm test`: 275 of 275 passed before the runs. The
  no-future-data check was then added to an existing test, and the suite
  still passes: 275 of 275.

## What this means

- **No edge.** Nothing here shows an edge. The validation period produced 0
  intraday trades and 1 swing trade. Both modes fail B8. B1 could not pass
  even if the holdout were run, because validation alone is 59 or 60 trades
  short of the minimum.
- **Not reliable evidence.** The positive swing figures rest on 8
  development trades. Two VRT trades make up more than all of the profit. That
  is not reliable evidence of anything.
- **The holdout stays unused.** Running it now could not change the outcome.
  It is kept unused, as instructed.
