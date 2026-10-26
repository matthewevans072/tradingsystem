# Range-trend (working name): plan

> **DRAFT. Nothing in this document is approved, built or run.** No code exists for it. Every setting below is
> a proposal for the owner to accept, change or reject. Written 2026-10-26.

The idea: a stock that keeps bouncing between a lower and an upper price area is traded as a **range**. A stock
that breaks out of its range and stays strong is held as a **trend**. The two are tested separately before they
are combined.

---

## 1. Which data has already been used

No historical period can be called unseen. The table says what was done with each period, as far as the
repository and databases record it.

| Period | Data downloaded or checked | Backtests executed | Results viewed | Results that influenced design | Unknown |
|---|---|---|---|---|---|
| 2016-01 to 2017-09 | HXR daily bars (warm-up for the development runs). The step 1 capability checks printed a few daily closes (HXR EXPERIMENT-LOG entries 1 and 2). | None as a test period. These closes fed the indicators and the day-one sizing of the HXR development runs. | A few printed closes. No strategy results. | No | See the last row |
| 2017-10 to 2021-12 | HXR daily bars, first 15-minute bars, corporate actions, spread samples | HXR development pick: 22 runs, once (ledger row 1, 2026-10-23) | Yes, by the owner and by assistants (development report, diagnosis) | **Yes: this plan was written after seeing them** | See the last row |
| 2021-07 to 2021-12 | Consolidation-breakout 15-minute bars, 17 stocks | None (warm-up: indicators only) | No | No | See the last row |
| 2022 to 2023 | Consolidation-breakout 15-minute bars (17 stocks; only MU is also in HXR's ten). HXR: download and readiness only. NBIS 2022-02-22 to 2024-10-25 closes printed during the HXR listing check (entry 2). | Consolidation-breakout development runs (Strategy Lab runs 1, 5, 9) and walk-forward runs covering 2022-2024 (runs 4, 8, 12) | Yes | Yes: they shaped consolidation-breakout v1.1 | See the last row |
| 2024 | Consolidation-breakout 15-minute bars. HXR: download and readiness only. | Consolidation-breakout validation, stress and walk-forward runs (Strategy Lab runs 2-4, 6-8, 10-12) | Yes | Yes: consolidation-breakout v1.1 | See the last row |
| 2025-01 to 2026-06 | Consolidation-breakout holdout downloaded and readiness-checked. HXR: download and readiness only. | None recorded. The Strategy Lab database's `lab_holdout_runs` table is **empty (0 rows, checked 2026-10-26)**, and its 12 runs all lie in 2022-2024. This is evidence about that database only. | No results recorded | No | See the last row |
| 2026-07 to 2026-10 | HXR download and readiness only | None | No | No | See the last row |
| **Unknown, all periods** | | Any TradingView Strategy Tester use (no repository record); sessions that left no record | | | The owner's own viewing and trading of these stocks through 2026 |

Also recorded: on 2026-10-22, HXR's download and readiness code was checked on real data for eight stocks in a
throwaway cloud folder. Counts, listing dates and split ratios only; no prices were shown and no rule was run
(HXR EXPERIMENT-LOG entry 5).

**Conclusion.**
- **No historical period is blind.** Testing different stocks does not remove what was learned about the same
  market period.
- **2022-2026** can serve as a secondary historical evaluation, with its prior exposure disclosed. It is not
  independent evidence.
- **Prospective paper trading** gives genuinely fresh observations. It still needs enough time, enough trades
  and realistic execution assumptions before it says anything.

---

## 2. What is decided, what is open, and what is proposed

### 2.1 Owner-confirmed preferences (from the owner's answers only)

- I look for repeated bounces between a lower and an upper price area. I have no fixed lookback period.
- I buy dips, sometimes before they finish falling. I also consider buying when the price starts recovering.
- When I exit, I generally sell the entire position.
- Being near the top of a range is a reason to reassess, not to sell automatically.
- If the price breaks through the top and stays strong, I want to let it run.
- A gain above 5% can be attractive, but it is not a fixed target.
- I am open to breakout entries as a **candidate**. This is not a confirmed preference.
- Price weakness, failing support and negative company news influence my exits.
- I sometimes hold through declines for weeks when the business case is intact.
- Different trade types need different hold and exit conditions.
- Portfolio limits are to be proposed separately from the entry and exit rules.
- Cash is shared and available to any qualifying stock.
- I pay attention during the day. That is my attention, not an agreed decision frequency for the system.
- **Panic and social-media influence are never signals.**

### 2.2 Unresolved owner decisions

1. **Default range entry:** buy the dip, or buy the recovery. The plan compares both.
2. **Breakout entry:** none, immediate, or wait for a pullback.
3. **Support failure:** one close or several closes.
4. **Re-entry above the last sale price:** allowed or not (see 2.4).
5. **Position limits and adding to winners.**
6. **Tech/AI concentration cap:** whether there is one, and at what level.
7. **Decision frequency:** daily or intraday (see 2.5).
8. **Definition of success:** which measures decide whether this is worth pursuing.
9. **Evaluation data:** which period, after reading the inventory in section 1.
10. **Experiment budget** (section 6).
11. **Which stocks.**

### 2.3 Proposed experimental settings (each a hypothesis, none approved)

| Setting | Proposal | In plain words |
|---|---|---|
| Typical move `m` | Mean absolute close-to-close change over the last 20 changes | How far the stock usually moves in a day. Used to scale every distance below. |
| Range window | Closes from 60 sessions back to yesterday | About three months: long enough to see several bounces, short enough to follow a changing market. |
| Zones | Bottom 25% and top 25% of the range height | "Near the bottom" and "near the top" of the range. |
| Established range | At least 2 separate visits to each zone, and a height of at least 4 typical moves | The price really did bounce both ways, and the range is wide enough to be worth trading after costs. |
| Breakout | A close more than half a typical move above the range top | Clearly above the old ceiling, not just touching it. |
| Breakdown | 2 consecutive closes more than half a typical move below the range bottom | Support has failed. Two closes, so that a single bad day is not enough. |
| Range exit near the top | The resistance-rejection exit (section 4) | Sell only when the price reaches the top and is turned back down. |
| Trend exits | 2 closes back below the old top, or a close more than 3 typical moves below the highest close since buying | The breakout failed, or the trend has given back a normal-sized move. |
| Portfolio (provisional, one set) | US$15,000 shared cash; at most US$3,000 per position (so at most 5 positions); no adding to a position; whole shares; when several signals come on the same day, alphabetical order; no tech/AI cap beyond the position limits | A simple, fixed set, so that results compare the rules and not the money management. Changing it is a separate experiment. |
| Decision timing (provisional) | Decide after the close; fill at the next open | See 2.5. |
| Costs | HXR's cost model: calibrated half-spread, slippage, US$0 commission, sell fees | So the results can be compared with HXR's. |

### 2.4 What re-entry above the last sale price would mean (owner item 6)

**With the limit** (HXR's rule): after a sale, the stock can be bought back only below its sale price. If it
rises above the sale price first, it is out.

**Without the limit:** after a sale, the stock is treated like any other stock. Its next valid entry signal
counts, whatever the price. For example, a stock sold at 100 forms a new range between 104 and 112; a dip
entry at 105 is then allowed.

Allowing it keeps the system invested in strong stocks. It also risks selling and buying back the same stock
repeatedly ("whipsaw"), paying costs each time. Hypothesis H5 tests this. No rule is adopted until the owner
decides.

### 2.5 Deciding daily or during the day (owner item 8)

**Deciding after the close** (signals on daily closes, orders at the next open):
- Each decision rests on a finished day, so it can be tested on daily bars, and the test can be checked by
  hand.
- It reacts up to a day late, and a gap at the open is taken as it comes.

**Deciding during the day** (for example on 15-minute bars):
- It reacts faster and can act before the close.
- It needs intraday data for every stock and a much more complex simulation, including which happened first
  within a bar.
- It produces more signals from noise, and therefore more costs.
- It is harder to follow by hand, and closer to the reactive trading the owner wants to avoid (panic is never a
  signal).

The provisional proposal is after the close. It is the owner's decision.

---

## 3. Range and trend definitions (computable without hindsight)

**No hindsight.** Every reference level for decision day `t` uses closes up to `t−1` only. Today's close is only
ever compared with those levels.

- **Typical move** `m(t−1)`: the mean absolute close-to-close change over the 20 changes ending at `t−1`.
  - Entries use `m(t−1)` at decision time.
  - An open trade's exit levels use `m(entry)`, the value frozen when the trade was entered.
- **Range window:** closes `t−60 … t−1`.
  - `lo` = the lowest close in the window, `hi` = the highest, and height `H = hi − lo`.
  - Bottom zone = `[lo, lo + 0.25H]`; top zone = `[hi − 0.25H, hi]`.
- **Visit:** a run of consecutive closes inside a zone. Two visits are separate only if at least 5 closes outside
  that zone lie between them.
- **Established range:** the window holds at least 2 separate visits to each zone, and `H ≥ 4 × m(t−1)`.
- **Rolling and freezing:** the boundaries roll daily while no trade is open. They are frozen at entry and
  attached to the trade as `lo, hi, H, m` at entry.
- **Invalidated:** by a breakout or breakdown close, or when the rolling window no longer meets the conditions.
- **Breakout at `t`:** `close(t) > hi + 0.5 × m(t−1)`, with `hi` taken from `t−60 … t−1`.
- **Breakdown:** 2 consecutive closes below `lo − 0.5 × m`.
  - For a trade, `lo` is the trade's frozen `lo` and `m` is `m(entry)`.
  - For an untraded range, `lo` comes from the window of the **first** breaking close, and `m` is `m(t−1)` at
    each close.
- **Dip entry:** a close inside the bottom zone and above `lo`.
- **Recovery entry:** after a visit to the bottom zone, a close at least `1 × m(t−1)` above that visit's lowest
  close, while still in the lower half (`≤ lo + 0.5H`).
- **Pullback entry:** after a breakout, a close within `1 × m` of the old `hi` and still above it, followed by an
  up close. The entry is decided at that up close.

### Worked examples (made-up closes)

The arithmetic of each example was checked with a scratch calculation; no strategy code was written.

**The window.** The made-up pattern `100, 102, 104, 106, 108, 110, 108, 106, 104, 102` is repeated six times:
60 closes ending at 102.
- Every change is 2, so `m = 2`. `lo = 100`, `hi = 110`, `H = 10`.
- Bottom zone `[100, 102.5]`, top zone `[107.5, 110]`.
- Each cycle visits both zones (bottom visits: `102, 100, 102`), separated by 7 closes outside the zone.
- `H = 10 ≥ 4 × 2 = 8`, so the range is **established**.

**A. Range entries**

| Day | Close | `m(t−1)` | Check | Result |
|---|---|---|---|---|
| t−1 | 102 | | (end of the window) | |
| t | 101 | 2 | In `[100, 102.5]` and above 100 | **Dip entry** |
| t+1 | 103 | 1.95 (19 changes of 2 and one of 1) | Visit's lowest close 101 + 1.95 = 102.95 ≤ 103 ≤ lower-half limit 105 | **Recovery entry** (if no dip entry was taken) |

**B. Breakout, then pullback entry.** The window continues the pattern with `100, 102, 104, 106, 108`.

| Day | Close | `hi` (`t−60 … t−1`) | `m(t−1)` | Check | Result |
|---|---|---|---|---|---|
| t | 111.5 | 110 | 2 | 111.5 > 110 + 0.5 × 2 = 111 | **Breakout** |
| t+1 | 110.8 | (old hi 110) | 2.075 | Above 110 and within 2.075 of it | Pullback close |
| t+2 | 111.4 | | 2.01 | Up close after the pullback close | **Pullback entry** |

*Check that a breakout is still possible:* `hi` excludes today's close. If `hi` included it, `hi` on day t
would be 111.5, and no close could ever be above `hi + 0.5m`: the breakout rule could never fire.

**C. Breakdown of an untraded range.** After the 60-close window:

| Day | Close | Level | Check | Result |
|---|---|---|---|---|
| t | 98.5 | `lo` = 100 (window of this first breaking close), `m` = 2 | 98.5 < 100 − 1 = 99 | First breaking close |
| t+1 | 98 | frozen `lo` = 100, `m(t)` = 2.075 | 98 < 100 − 1.0375 = 98.96 | **Breakdown** |

*Why `lo` is frozen at the first breaking close:* a rolling `lo` on day t+1 would already be 98.5. The level
would then be 97.46, and the second close of 98 would not count. Support that had already failed would never
be confirmed.

**D. Resistance-rejection exit for the dip entry of A.** Frozen at entry: `lo = 100`, `hi = 110`, `H = 10`,
`m(entry) = 2`. The rule is armed at a close of 107.5 or more, and exits below 107.5 − 1 = 106.5.

| Close | 103 | 105 | 107 | 108 | 109 | 107.2 | 106.2 |
|---|---|---|---|---|---|---|---|
| Effect | | | | **armed** (in the top zone) | | below the zone, but above 106.5: **held** | **exit** |

---

## 4. Exits by trade type

**Range trades** (dip or recovery entry). These exits are part of every range run; none is an optional extra.
- **Breakdown:** 2 consecutive closes below the frozen `lo − 0.5 × m(entry)`. Exit.
- **Resistance rejection** (one proposed exit, experimental):
  - It is armed once a close enters the trade's frozen top zone.
  - It exits when a later close falls back below the top zone's lower edge minus `0.5 × m(entry)`.
  - If a breakout close comes first, the trade is held under the trend rules instead.
- **How this differs from selling automatically at the top zone:** reaching the top only arms the exit. A stock
  that reaches the top and stays there is not sold, and neither is one that breaks out. Only a rejection back
  down is. This is meant to match the owner's preference: reassess near the top, and let a breakout run.
- **Not covered:** a range trade that neither breaks down nor reaches the top has no time limit in this
  proposal. Whether it should have one is an open question.

**Trend trades** (an immediate breakout entry, a pullback entry, or a range trade that broke out). Exit on
either:
- 2 consecutive closes back below the old `hi`; or
- a close more than `3 × m(entry)` below the highest close since buying.

---

## 5. Hypotheses

| | Hypothesis | Behaviour it should change | Measures |
|---|---|---|---|
| H1 | Dip entries buy cheaper but fail support more often | Entry price relative to the range; breakdown exits | Average entry position in the range (0 = `lo`, 1 = `hi`); share of range trades ending in breakdown; average loss per breakdown |
| H2 | Recovery entries pay a little more but fail support less often | The reverse of H1 | The same measures, compared with H1 |
| H3 | Immediate breakout entries catch more of a run, with more false breakouts | Trend capture; failed breakouts | Share of trend trades exiting on 2 closes below the old `hi`; gain per completed trend trade; trade count |
| H4 | Pullback entries have fewer false starts but miss some runs | Fewer failed breakouts; breakouts never entered | The same as H3, plus the number of breakouts with no pullback entry |
| H5 | Removing the below-sale re-entry limit raises time invested and whipsaw costs | Exposure; repeated trading of the same stock | Average invested fraction; re-entries above the last sale; costs; P/L of trades starting within 20 sessions of a sale of the same stock |
| H6 | HXR with the corrected tech/AI cap (diagnostic only) | Explains the 2026-10-23 development results | Day-one positions and binding caps. Marked contaminated, never counted as evidence, no result predicted. |

---

## 6. Experiment budget (proposed; the owner confirms)

All runs use 2017-10-02 to 2021-12-31 and are labelled **exploratory**. That period is already development data
(section 1).

| Family | Runs | Variants |
|---|---|---|
| Range | 4 | Dip or recovery entry, each with and without the re-entry limit |
| Trend | 4 | Immediate or pullback entry, each with and without the re-entry limit |
| HXR corrected-cap diagnostic | 1 | H6. Contaminated, never counted |
| Range + trend combination | up to 2 | Only if both families show measurable behaviour |
| **Total** | **11** | |
| Reserve | 1 (the 12th) | Used only to re-run a run invalidated by a verified code defect, with the defect and the re-run logged |

- Every run is logged, failures included.
- Range and trend are tested separately before they are combined.
- Constant within each family: HXR's ten stocks, HXR's cost model, decisions after the close with fills at the
  next open (provisional), US$15,000 shared cash, and the one provisional portfolio set. Changing any of these is
  a separate experiment.

---

## 7. Benchmarks and reporting

The strategy starts in cash, so an "opening-positions hold" would simply hold cash. Instead, each run is
reported against:
- **(a) Buy and hold:** the fully invested equal-weight buy-and-hold of the same stocks (HXR's hold arm).
- **(b) Cash at 0%.** Labelled as cash. It is not an exposure-matched comparison.
- **(c) Optionally, an exposure-matched hold (derived).** The buy-and-hold scaled to the run's average
  invested fraction `f`:
  - `V(t) = V(t−1) × (1 + f × r_bh(t))`, where `r_bh(t)` is the buy-and-hold's daily return and `V(0)` = US$15,000.
  - In words: a daily-rebalanced mix of `f` in the buy-and-hold and `1 − f` in cash at 0%, with no rebalancing
    costs. Labelled derived.

**Per run:** net return after costs, maximum drawdown, average invested exposure and time in cash, trade count
and holding periods, turnover and costs.

No run is selected on its ending balance alone.

---

## 8. Sequence

1. The owner decides the open points in 2.2.
2. Build, with tests.
3. The exploratory runs, within the budget.
4. Freeze the rules.
5. One evaluation run, on data the owner chooses after reading section 1.
6. Prospective paper trading.

Once an evaluation result influences any change, that period becomes development data.

---

## 9. Limits

- Historical tests are price-based approximations.
- Company news, and "holding while the business case holds", can only be tested prospectively.
- The tests use no current fundamentals, no revised data without its publication timing, and no news known
  only with hindsight.

---

## Decisions that need the owner

1. **Range entry default:** dip or recovery. Or let H1/H2 compare them first.
2. **Breakout entries:** none, immediate or pullback. Or let H3/H4 compare them.
3. **Support failure:** accept 2 closes, or choose 1.
4. **Re-entry above the last sale price:** allowed or not. Or let H5 compare them.
5. **Portfolio settings:** accept the provisional set (US$3,000 per position, 5 positions, no adding, no
   tech/AI cap), or set your own.
6. **Decision frequency:** after the close (proposed) or intraday.
7. **Success measures** for the exploratory runs and the evaluation.
8. **The experiment budget**, including whether the reserve slot exists.
9. **Evaluation data**, chosen after reading section 1.
10. **The stocks:** HXR's ten, or another list.
