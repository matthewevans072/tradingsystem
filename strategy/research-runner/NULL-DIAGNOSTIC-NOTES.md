# The random-timing null: what it is, what it ignores, and what it can and cannot say

A companion note written 2026-11-05 on the owner's order. `CAMPAIGN-1.md` and `CAMPAIGN-3.md` stay frozen; this note explains the diagnostic they pre-register (`server/research/runner.js` `nullTest`; CAMPAIGN-3.md section 3, items 1 and 5) and records its synthetic checks (`tests/research-null.test.js`). Nothing here changes a stored result or an acceptance rule.

## 1. The construction

For a completed experiment the items are its completed trades and the positions open at the end. Item j keeps its stock, its share count and its holding length h (fill to fill, in the stock's own sessions; an open position's h runs to the last session). Its eligible decision set is every index i of the stock's session list, from the period's first session, with i + 1 + h within the last session; the set is enumerated once per stock and holding length and a draw is uniform over it. A resample moves every item to its own draw: entry at the next session's open plus spread and slippage, exit at the open h sessions later minus them (an open position exits at that session's close). The statistic T is the sum of shares x (exit - entry), computed the same way for the run's own recorded fills, with fees and dividends excluded. R resamples (2,000 in campaigns 1 and 2, 20,000 in campaign 3) from one seeded mulberry32 stream shared by every experiment; p = (1 + the number of resamples with T at or above the run's T) / (1 + R).

## 2. What it ignores

- **Cash and the caps.** A resample places every item independently; it never asks whether the portfolio could have afforded that placement under the 20% position cap, the 1% risk rule, the 5% total entry risk or the cash on hand. A resample's T need not be achievable by the campaign's portfolio rules.
- **Overlapping positions and same-day sharing.** Two items of one stock may be placed on top of each other, and several items may land on one session, which the engine's one-position-per-stock rule and equal sharing of cash and risk room would never allow.
- **Sizing.** The share count is taken as given. Nothing is said about whether the run's sizing (which caps bound, how often the 1% rule or the cap decided the size) added or cost anything.
- **Exit timing is randomised with the entry.** The exit moves with the entry, h sessions later, so a resample's exit is a random session, not a session chosen by any rule. The run's own T, however, uses its real exit prices. The consequence is asymmetric: a gain that comes from *holding longer* in a drifting market is matched by the resample (holding length is kept) and is not detected, while a gain that comes from *picking* exit prices well relative to the entry is detected, because it is in T but not in the resamples. The synthetic checks show both (section 4).
- **Fees, dividends and cash in lieu.** Excluded from T on both sides; the exposure-matched hold and the net profit carry them.
- **Dependence between items.** Items are placed independently; the run's own trades are not independent (they come from one price path and one account), so the p-value is a screening figure, not a calibrated probability about the strategy.

## 3. What it can and cannot say

- It **can** say whether the run's trade-timing P/L, trade by trade, sits in the upper tail of what random placements of the same trades (same stocks, shares and holding lengths) would have earned in the same period: a small p means the run's entries and exits together landed on better prices than chance would give, at the 0.05 screen before the Holm correction and at the Holm-adjusted level after it.
- It **cannot** say that a strategy has no edge. A large p means only that this diagnostic did not distinguish the run's timing from random placement: the edge may lie in exposure or holding length (which the exposure-matched hold measures), in stock selection within a drifting basket (partly credited to timing, partly not), or may be too small for the number of items to detect.
- It **cannot** say that a run is feasible, well sized or robust; the accounting check, the drawdown limit, the best-5% stress and the concentration gate answer those, each on its own.
- It is **not** a test of the strategy against the market or against the index: it compares the run with itself re-timed. The equal-weight index and the exposure-matched hold are the benchmarks.
- A pass is an **unadjusted shortlist pass**; a Holm-significant pass over the campaign's family is a separate, stronger label (CAMPAIGN-3.md section 6). Neither is evidence beyond the development window after the cumulative looks recorded in CAMPAIGN-3.md section 3.

## 4. The synthetic checks (tests/research-null.test.js; the expected behaviour is in each test's name, written before the tests ran)

(a) A market with no structure and random entries over 200 seeds: the p-values are spread roughly uniformly with about one in twenty below 0.05. (b) Entries planted immediately before built-in rises: p near 1/(R + 1). (c) A drifting market whose only edge is holding longer: not detected. (c, recorded property) Price-selected exits with random entries, a look-ahead: detected. The results are in `reports/campaign-3-b0-vs-m1.md` section 7 and research log entry 8.

## 5. The stored unplaceable-item counts

Every item of campaign 3 was placeable (the stored `unplaceableItems` is 0 for experiments 180 and 191; the report quotes them). An unplaceable item (a stock with no session list in the period) is counted and contributes nothing to any resample.
