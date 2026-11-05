# Research runner, campaign 1: the pre-registered search (written before any experiment ran)

Written 2026-11-04 by the assistant on the owner's work order of 2026-11-04 (quoted verbatim in
`EXPERIMENT-LOG.md` entry 1), before any campaign experiment ran. This document fixes the data, the baseline,
the search space, the budget, the risk limits, the ranking and the notification rule. The code reads its SHA-256
when a campaign is created and stores it with the campaign; a change to any of these rules is a new campaign
document (campaign 2), never an edit here. A simulation only: no order, no broker, no delivery outside the app.

## 1. What this is, and is not

The runner is a background job queue and worker (`server/research/`, `scripts/research-worker.mjs`) that runs
range-trend configurations through the existing range-trend engine (`server/rangetrend/engine.js`, engine
`rt-engine-3`, code revision `rt-code-2026-11-02-1`) on HXR's development-period market data, read-only, and
compares every result with one fixed baseline. Results are **development results on data that earlier
programmes have already seen**; the campaign can produce a *development leader* and a *shortlisted candidate*,
never a validated strategy. The label "independently evaluated" exists in the schema and is never set by the
runner. Nothing here reads the owner's holdings or cash, and nothing opens the evaluation window.

## 2. Data, and the bound

- **The only window:** HXR's development period, basket A (MU, AMZN, META, TSLA, VST, GOOG, INTC, CSCO, PYPL,
  SNAP), **2017-10-02 to 2021-12-31**, warm-up from 2016-01-04, read from the pinned `periods-hxr-v3.json`.
- **Enforced:** `config.js` `configProblem` refuses any config whose `period` differs in any field; the search
  space generator asserts it for every config and the runner asserts it again before every run; the inputs are
  built with that end date, and the worker refuses inputs whose last session is after it
  (`tests/research-space.test.js`, `tests/research-runner.test.js`).
- **Never opened here:** the range-trend evaluation period 2022-01-03 to 2023-12-29, HXR's validation and final
  periods, the Strategy Lab holdout 2025-01-01 to 2026-06-30, the sweep-bos and ICT Lab windows.
- **Data quality:** HXR readiness and spread calibration for the development period must pass when the worker
  starts; the data, symbols and calibration hashes are fixed on the campaign at that moment and every experiment
  records them; a changed data hash stops the campaign.
- **Prior exposure of this data (recorded, not reset):** HXR runs 1 to 22 and the development pick
  (2026-10-23), the eight range-trend practice runs (2026-11-04, `strategy/range-trend/reports/
  practice-runs-report.md`), and whatever the assistant's training data and the owner's memory hold of these
  stocks' history. This campaign adds at most 100 further looks at the same bars.

## 3. The baseline (fixed)

`rt-trend-immediate-nolimit-0.2.0.json`: the trend family, immediate (breakout) entry, no below-sale re-entry
limit. It had the highest net profit of the eight practice runs, **+$1,757.90** on US$15,000 over 2017-10-02 to
2021-12-31 (51 completed trades, maximum drawdown 7.28%, average invested 12.2%), so it is the hardest positive
bar among the seen results. It runs first in the campaign under identical conditions and **must reproduce that
figure to the cent**; otherwise the campaign stops with a determinism or accounting error. Every comparison in
the campaign is against this run's net profit.

## 4. Budget and limits

- At most **100** unique configurations (unique by the engine's config hash) or **12** hours of worker time,
  whichever comes first.
- One worker by default (`LIMITS.concurrency` 1); experiments are claimed one at a time inside an immediate
  transaction, so two workers never run the same experiment and a configuration is never queued twice in a
  campaign.
- Stop with the reason recorded when: free disk space on the data volume is under 1 GB; the worker's heap
  exceeds 1.5 GB; an experiment takes over 120 s; an accounting check fails; the data hash changes; the inputs
  cannot be built. Every stop reason is on the campaign row and in `rr_events`.
- Every experiment is saved the moment it finishes (done or failed, with the error). An experiment left
  running by a dead worker is re-queued once, then failed as interrupted.

## 5. The search space (84 planned configurations, then at most 16 combinations)

Every generated config keeps the baseline's period, costs, US$15,000 starting cash, dividends and benchmark, so
runs are comparable. A change touches exactly one engine-read field.

- **Stage 0, 8 runs:** the eight planned `rt-*-0.2.0.json` configs, unchanged (their hashes equal the practice
  runs'). The baseline is among them and runs first.
- **Stage 1, 42 runs: single-component changes from the baseline B** (trend, immediate entry, no limit):
  `levels.mSessions` 10, 40; `levels.windowSessions` 40, 90, 120; `levels.zoneFraction` 0.2, 0.33;
  `levels.minVisits` 1, 3; `levels.visitGap` 3, 10; `levels.minHeightM` 2, 6, 8; `levels.breakoutM` 0, 0.25, 1,
  2; `levels.breakdownM` 0.25, 1; `levels.breakdownCloses` 1, 3; `exits.trendBelowHiCloses` 1, 3, 5;
  `exits.trendGivebackM` 1.5, 2, 4, 6, 8; `portfolio.positionCapPct` 10, 33, 50; `portfolio.riskPerTradePct`
  0.5, 2, 3; `portfolio.totalEntryRiskPct` 2.5, 10, none; `portfolio.stopM` 0.25, 1, 2.
- **Stage 2, 34 runs: single-component changes from the other three no-limit bases:**
  - D = range dip (mean reversion), 12: `windowSessions` 40, 90; `zoneFraction` 0.2, 0.33; `minHeightM` 2, 6;
    `exits.rejectionM` 0.25, 1; `breakdownCloses` 1, 3; `stopM` 1; `positionCapPct` 33.
  - R = range recovery (dip recovery), 11: `recoveryM` 0.5, 2; `windowSessions` 40, 90; `zoneFraction` 0.33;
    `minHeightM` 2, 6; `exits.rejectionM` 1; `breakdownCloses` 3; `stopM` 1; `positionCapPct` 33.
  - P = trend pullback, 11: `pullbackM` 0.5, 2; `exits.trendGivebackM` 2, 6; `exits.trendBelowHiCloses` 3;
    `windowSessions` 40, 90; `breakoutM` 0.25, 1; `positionCapPct` 33; `stopM` 1.
- **Stage 3, at most 16 runs: selected combinations**, built by the worker from stored results by this rule:
  for each base, take the single-component changes whose net profit exceeds the base's own net profit and whose
  maximum drawdown is within the limit, ranked by net profit (ties: shallower drawdown, then name); the top 3
  are combined pairwise and all three together (at most 4 per base). Two values of one field never combine; a
  base with fewer than two such changes gives nothing. Cut at the 100-configuration budget.

Fields the engine fixes by the owner's decisions D1 to D4 and the build rules (`reentryRetire`,
`recoveryUpClose`, `recoveryNoTopSinceBottom`, `brokenRange`, `pullbackWatchEndsAt`, `addToPositions`,
`execution`, `benchmark`) are not searched. The re-entry limit appears only in the planned configs.

## 6. Ranking, the target and the shortlist (fixed; never lowered)

Ranking is by **net dollar profit after costs** (ending equity minus US$15,000; costs, net dividends and
positions open at the end at the last close included).

**A result clears the target** when all of these hold:
1. net profit at least **10%** above the baseline's net profit (the ratio is reported only while the baseline
   profit is positive and at least US$100; otherwise dollar differences are reported and the percentage target
   is marked inapplicable);
2. maximum drawdown at most **15%** of starting equity (peak to trough on closes);
3. at least **30** completed trades;
4. the accounting check passes (net profit reconciles with trade P/L + open P/L + post-exit dividends within
   US$0.05; cash never below zero; the end value equals the last equity point);
5. the data-quality check passed at the worker's start.

**A result is shortlisted** when it clears the target and also:
6. best-5% stress: with the top ceil(5% × n) outcomes removed (the adopted definition 5), net profit is still at
   least the baseline's;
7. random-timing null: each trade keeps its stock, shares and sessions held and enters on a random session of
   the period (the next open after a random decision close, spread and slippage included, fees and dividends
   excluded; an open position exits at that session's close); **2,000 resamples, seed 20261104**; p = (1 +
   resamples at or above the run's trade-timing P/L) / 2,001 at most **0.05**;
8. the top stock's share of the gross gain at most **40%** (the adopted definition 4);
9. the gain over the baseline is not explained by exposure alone: the change in the exposure-matched hold's
   P/L (benchmark (a) scaled by the run's invested fraction) is reported as the exposure part, the remainder as
   the decision part, and the decision part must be positive.

Every experiment reports every criterion, pass or fail, with the figure. **Labels:** every finished experiment
is a "development result"; a shortlisted one is also a "shortlisted candidate"; "independently evaluated" is
reserved and never set by the runner. Improvement is also reported against the current leader (the highest net
among results that clear the target; else the highest within the drawdown and trade conditions; else the
baseline).

## 7. Notifications

An in-app notification, stored in the runner's database, is created when a result first clears the target
(criteria 1 to 5); a later one only when a result beats the last notified one by at least 5% of the baseline's
net profit; a shortlisting is its own notification, once per experiment. Every one is titled "development
improvement - not yet validated". The dashboard can also show the browser's own notification while the page is
open; nothing is delivered while the browser is closed, and no email or message leaves the app.

## 8. What the campaign cannot do

Open any window but the development period; set the "independently evaluated" label; start an evaluation on
a new leader; lower any criterion; place an order or reach a broker; read real holdings or cash; send anything
outside the app. A candidate that deserves more is reported to the owner, who decides by a separate message.
