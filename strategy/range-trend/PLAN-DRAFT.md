# Range-trend (working name): plan, version 0.2

> **DRAFT. Nothing in this document is built or run, and no code exists for it.** Version 0.2 records the
> owner's research decisions (section 0) as experimental choices. Every value marked **[OWNER TO CONFIRM]** is a
> proposal; nothing is built until the owner confirms those values in writing. Version 0.1 written 2026-10-26;
> version 0.2 written 2026-10-26.

## 0. The owner's research decisions (version 0.2)

These are choices about **what to test**. They do not reproduce the owner's own trading, which reacts during
the day, uses news and judgement, and holds through declines when the business case is intact. A result for
these rules says nothing directly about that.

1. **Range entry:** dip and recovery entries are tested as separate runs (H1, H2). Neither is a default.
2. **Breakout entry:** immediate and pullback entries are tested as separate runs (H3, H4). Neither is
   confirmed as a preference.
3. **Support failure:** two consecutive closes. This is a **provisional assumption** for testing, not a
   finding.
4. **Re-entry above the last sale price:** each family is tested with and without the below-sale limit (H5).
   Neither is adopted as a rule.
5. **Money per stock:** the portfolio rules of section 6a, every value [OWNER TO CONFIRM]. No adding to
   positions.
6. **Decision frequency:** daily, after the close, with fills at the next open. This **does not reproduce
   intraday reactions** (section 2.5).
7. **Success:** the three tiers of section 7a, every threshold [OWNER TO CONFIRM].
8. **Experiment budget:** 11 runs plus 1 reserve, used only for a verified code defect (section 6).
9. **Evaluation data:** option A, B or C of section 8a, recorded in `EVALUATION-PROTOCOL.md` before the first
   practice run.
10. **Stocks:** HXR's ten (MU, AMZN, META, TSLA, VST, GOOG, INTC, CSCO, PYPL, SNAP). They were **hand-picked
    with hindsight** (the owner's holdings plus four known laggards). Results apply only to these ten stocks
    and are not evidence about any other list.

**Changes from version 0.1:**
- Section 0 is new.
- The provisional portfolio set is replaced by the proposal in 6a.
- 6b lists two things not inherited from HXR.
- Success tiers are added (7a).
- The exposure-matched hold now uses the run's invested fraction day by day (7).
- The evaluation protocol is added (8a).
- The budget rules are tightened (6).

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

### 2.2 Still open after version 0.2

1. **Portfolio values:** position cap, risk per trade, total risk at entry (5% or none) and sizing stops
   (section 6a) [OWNER TO CONFIRM].
2. **Success tiers:** thresholds (section 7a) [OWNER TO CONFIRM].
3. **Return against drawdown:** how much lower return the owner would accept for a smaller drawdown, if any.
   This stays open (section 7a).
4. **Evaluation option:** A, B or C (section 8a), recorded in `EVALUATION-PROTOCOL.md`.
5. **Tech/AI concentration cap:** the 6a proposal has none beyond the 20% position cap.
6. **Time limit for a range trade** that neither breaks down nor reaches the top (section 4): none proposed.

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
| Portfolio | See section 6a [OWNER TO CONFIRM] | One fixed set within each family, so that results compare the rules and not the money management. Changing it is a separate experiment. |
| Decision timing | Decide after the close; fill at the next open (decision 6) | See 2.5. |
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

The owner chose after the close as an experimental choice (section 0, decision 6). It does not reproduce intraday reactions.

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

## 6. Experiment budget (decision 8)

All runs use 2017-10-02 to 2021-12-31 and are labelled **exploratory practice runs**. That period is already
development data (section 1).

| Family | Runs | Variants |
|---|---|---|
| Range | 4 | Dip or recovery entry, each with and without the re-entry limit |
| Trend | 4 | Immediate or pullback entry, each with and without the re-entry limit |
| HXR corrected-cap diagnostic | 1 | H6: an HXR variant run, not a range-trend config. Marked contaminated, never counted |
| Range + trend combination | up to 2 | Only if both families show measurable behaviour |
| **Total** | **11** | |
| Reserve | 1 | **Only** to re-run a run invalidated by a verified code defect |

- Every run is logged, failures included.
- If the reserve is used, the broken result is **kept and logged** next to the re-run. It is never used for
  tuning.
- No run outside this table is possible: only these configs are runnable.
- Range and trend are tested separately before they are combined.
- Constant within each family: HXR's ten stocks, HXR's cost model, decisions after the close with fills at the
  next open, US$15,000 shared cash and the portfolio rules of 6a.

### 6a. Portfolio rules (proposal; every value [OWNER TO CONFIRM])

All amounts are fractions of the **current account value** `V` at the decision close (cash plus holdings at
that close). There is no adding to positions: one position per stock at a time.

- **Sizing stop:**
  - Range trades: frozen support `lo − 0.5 × m(entry)` **[OWNER TO CONFIRM]**. This is also the level the
    breakdown exit uses.
  - Trend trades: old high `hi − 0.5 × m(entry)` **[OWNER TO CONFIRM]**.
- **Risk per trade:** `1% × V` **[OWNER TO CONFIRM]**. Shares by risk = `floor(1% × V / (c − stop))`, where `c` is
  the decision close.
- **Position cap:** `20% × V` **[OWNER TO CONFIRM]**. Shares by cap = `floor(20% × V / c)`.
- **Total risk at entry:** the sum over open positions of `shares × (entry price − sizing stop)`, measured **at
  entry only**, at most `5% × V`, **or no limit** **[OWNER TO CONFIRM: 5% or none]**.
- **Several signals on the same day:**
  1. The available cash is shared equally between that day's signals.
  2. Each signal's own limits apply (risk per trade, position cap, total risk at entry).
  3. Whole shares.
  4. Cash left over stays in cash. It is not passed on to the other signals.
- **Below one share:** no position, and the skip is recorded with its reason.
- **Cash never goes below zero.**

### 6b. Not inherited from HXR, and why

- **The account-decline pause.** In a mostly-cash account it can lock permanently. The HXR development records
  show this: in all six base runs that paused, the pause started in 2018. The account never again came within
  US$750 of its peak, and 2,999 buy signals were skipped while paused (`strategy/hxr/reports/2026-10-26-diagnosis.md`,
  supplement a and d).
- **The open-risk budget measured from current value.** HXR measures open risk as shares × (current close −
  exit level), so a rising winner uses up more and more of the budget. In the development records, all 121
  base-run skips with no recorded binding cap fell on days with open risk above US$750, mostly from holdings
  whose level had risen (diagnosis, supplement e).
- **Instead, risk is measured at entry only** (6a): a winner never blocks a new buy by rising.

## 7. Benchmarks and reporting

The strategy starts in cash, so an "opening-positions hold" would simply hold cash. Instead, each run is
reported against:
- **(a) Buy and hold:** the fully invested equal-weight buy-and-hold of the same stocks (HXR's hold arm).
- **(b) Cash at 0%.** Labelled as cash. It is not an exposure-matched comparison.
- **(c) Exposure-matched hold (derived, frictionless):**
  - `B(t) = B(t−1) × (1 + f(t−1) × r(t))`, with `B(0)` = US$15,000.
  - `r(t)` is the buy-and-hold's return from close `t−1` to close `t`.
  - `f(t−1)` is the run's invested fraction (holdings ÷ account value) at close `t−1`.
  - In words: each day it holds the buy-and-hold in the proportion the run was invested the day before, and
    cash at 0% otherwise. It has no costs and no whole-share rounding. Labelled derived.

**Per run:** net return after costs, maximum drawdown, average invested exposure and time in cash, trade count
and holding periods, turnover and costs.

No run is selected on its ending balance alone.

### 7a. Success tiers (proposal; every threshold [OWNER TO CONFIRM])

**Tier 1: the code does what the plan says** (synthetic data only, before any practice run):
- every worked example in section 3 reproduces exactly;
- no look-ahead, future-change and determinism tests pass;
- accounting identities hold (cash + holdings = account value; costs and dividends reconcile);
- sizing is hand-checked;
- there is a scenario for every entry and exit.

**Tier 2: the practice runs show measurable behaviour** (exploratory, 2017-10-02 to 2021-12-31):
- at least **[OWNER TO CONFIRM: 30]** completed trades per family;
- each hypothesis H1-H5 has its measures reported;
- costs are below **[OWNER TO CONFIRM: 1%]** of the average account value per year.

Tier 2 is a test of whether the rules can be judged. It is not evidence that they work.

**Tier 3: the evaluation** (the one run, or the prospective record, chosen in 8a). The frozen candidate, after
costs:
- beats the exposure-matched hold (c) on net return; **and**
- has a maximum drawdown no deeper than the buy-and-hold's (a) **[OWNER TO CONFIRM]**.

**A smaller drawdown earns no credit on its own.** It counts only if the run also beats the exposure-matched
hold. A run that simply holds more cash than the buy-and-hold will usually show a smaller drawdown.

**Open:** how much lower return the owner would accept for a smaller drawdown. This is not decided. Until it
is, Tier 3 uses only the two conditions above.

## 8. Sequence

1. The owner confirms the [OWNER TO CONFIRM] values in writing. That confirmation is the first entry of
   `strategy/range-trend/EXPERIMENT-LOG.md`.
2. Build, with the Tier 1 tests.
3. The owner chooses the evaluation option and records it in `EVALUATION-PROTOCOL.md` (8a).
4. The practice runs, within the budget, on separate instruction.
5. Freeze the candidate.
6. The evaluation, according to the protocol.
7. Prospective paper trading.

Once an evaluation result influences any change, that period becomes development data.

### 8a. Evaluation protocol

The owner chooses one option:

- **(A) One historical run, 2022-01-03 to 2026-10-21**, with the prior-exposure disclosures of section 1:
  - the consolidation-breakout runs of 2022-2024, and its holdout window;
  - HXR's downloads and readiness checks;
  - the owner's own viewing and trading.

  It is a secondary evaluation, not independent evidence.
- **(B) Prospective only:** paper trading from a start date onwards, with no historical evaluation.
- **(C) Both:** (A), then (B).

**The rules:**
- The choice is recorded in `strategy/range-trend/EVALUATION-PROTOCOL.md` **before the first practice run**.
  The code refuses practice runs until that file exists.
- The candidate and the protocol are frozen, with their hashes, **before any evaluation result is
  accessed**.
- The evaluation runs once.

## 9. Limits

- Historical tests are price-based approximations.
- Company news, and "holding while the business case holds", can only be tested prospectively.
- The tests use no current fundamentals, no revised data without its publication timing, and no news known
  only with hindsight.

---

## Decisions that need the owner

1. **Confirm or change every [OWNER TO CONFIRM] value:**
   - the position cap (20%);
   - risk per trade (1%);
   - total risk at entry (5% or none);
   - both sizing stops;
   - the Tier 2 thresholds (30 trades, 1% costs);
   - the Tier 3 drawdown condition.

   The confirmation, in writing, is recorded as the first entry of `EXPERIMENT-LOG.md`, and building starts
   only after it.
2. **Choose evaluation option A, B or C**, recorded in `EVALUATION-PROTOCOL.md` before any practice run.
3. **Return against drawdown:** whether you would accept lower return for a smaller drawdown (open; not needed
   to build).
4. **Tech/AI concentration cap:** none in this proposal; add one if you want it.
5. **Range-trade time limit:** none in this proposal.
