# Range-trend (working name): plan, version 0.3

> **DRAFT.** No range-trend run has been made on market data. Section 0 records the owner's research decisions
> in the owner's words. Everything else is a proposal unless it says otherwise. Values marked **[OWNER TO
> CONFIRM]** or **[OWNER TO SET]** are not decided. Version 0.1, 0.2 and 0.3 written 2026-10-26.

The idea: a stock that keeps bouncing between a lower and an upper price area is traded as a **range**. A stock
that breaks out of its range and stays strong is held as a **trend**. The two are tested separately before they
are combined.

## 0. The owner's research decisions

*The owner's words, recorded as experimental choices, not claims that they reproduce the owner's trading.
Anything a pointer adds is a proposal.*

1. Dip versus recovery: Compare both. → sections 3, 5 (H1, H2), 6
2. Breakout entry: Compare immediate versus pullback entries. → sections 3, 5 (H3, H4), 6
3. Support failure: Use two closes as a provisional test assumption. Don't claim this was established from my
   trading history. → sections 3, 4
4. Higher-price re-entry: Compare allowing versus prohibiting it. → sections 2.4, 5 (H5), 6
5. Portfolio settings: Propose limits based on current account equity, with exact values explained before
   finalization. For simultaneous signals, propose equal allocations subject to each position's risk limits,
   available cash, and whole-share constraints. No adding to existing positions in the first version.
   → section 6a
6. Timing: Daily decisions after the close, with next-open execution, for the initial research version.
   Explicitly acknowledge that this won't reproduce my intraday reactions. → section 2.5
7. Success: Don't finalize the proposed pass criteria yet. Positive returns, smaller drawdowns, and 30 trades
   alone aren't enough to establish that the approach is useful. Propose separate criteria for implementation
   correctness, exploratory usefulness, and later evaluation. Define any exposure-matched benchmark precisely.
   Explain how we judge the trade-off between lower returns and lower drawdowns. → section 7
8. Experiment budget: Eleven planned runs plus one reserve for a verified defect correction. Preserve the broken
   result and log the correction; don't use the reserve for parameter tuning. → section 6
9. Evaluation: We can leave the exact dates unresolved now, but document how they will be chosen before
   exploratory results influence that choice. Freeze the candidate and evaluation protocol before accessing
   evaluation results. Preserve the prior-exposure disclosures. → sections 1, 8a
10. Stocks: Use HXR's ten for the initial comparison. State that results apply to this selected universe and do
    not establish performance across stocks generally. → sections 1, 9

**Build settings approved by the owner on 2026-10-26** (recorded as the first entry of
`strategy/range-trend/EXPERIMENT-LOG.md`): the portfolio values of section 6a; no separate tech/AI cap, no
time-based range exit, no adding to positions, no decline pause and no current-value open-risk budget; and
evaluation choice C (section 8a). **The approval covers building only.** No practice run, historical
evaluation or prospective journal is authorised by it.

---

## 1. Which data has already been used

No historical period can be called unseen. The table says what was done with each period, as far as the
repository and databases record it.

| Period | Data downloaded or checked | Backtests executed | Results viewed | Results that influenced design | Unknown |
|---|---|---|---|---|---|
| 2016-01 to 2017-09 | HXR daily bars (warm-up for the development runs). The step 1 capability checks printed a few daily closes (HXR EXPERIMENT-LOG entries 1 and 2). | None as a test period. These closes fed the indicators and the day-one sizing of the HXR development runs. | A few printed closes. No strategy results. | No | See the last row |
| 2017-10 to 2021-12 | HXR daily bars, first 15-minute bars, corporate actions, spread samples | HXR development pick: 22 runs, once (ledger row 1, 2026-10-23) | Yes, by the owner and by assistants (development report, diagnosis) | **Yes: this plan was written after seeing them** | See the last row |
| 2021-07 to 2021-12 | Consolidation-breakout 15-minute bars, 17 stocks | None (warm-up: indicators only) | No | No | See the last row |
| 2022 to 2023 | Consolidation-breakout 15-minute bars (17 stocks; only MU is also in HXR's ten). HXR: download and readiness only. NBIS 2022-02-22 to 2024-10-25 closes printed during the HXR listing check (entry 2). **HXR's reserved validation period (2022-01-03 to 2023-12-29) on the same ten stocks: never run.** | Consolidation-breakout development runs (Strategy Lab runs 1, 5, 9) and walk-forward runs covering 2022-2024 (runs 4, 8, 12) | Yes | Yes: they shaped consolidation-breakout v1.1 | See the last row |
| 2024 | Consolidation-breakout 15-minute bars. HXR: download and readiness only. **HXR's reserved final period begins (2024-01-02 to 2026-10-21) on the same ten stocks: never run.** | Consolidation-breakout validation, stress and walk-forward runs (Strategy Lab runs 2-4, 6-8, 10-12) | Yes | Yes: consolidation-breakout v1.1 | See the last row |
| 2025-01 to 2026-06 | Consolidation-breakout holdout downloaded and readiness-checked. HXR: download and readiness only (part of HXR's reserved final period). | None recorded. The Strategy Lab database's `lab_holdout_runs` table is **empty (0 rows, checked 2026-10-26)**, and its 12 runs all lie in 2022-2024. This is evidence about that database only. | No results recorded | No | See the last row |
| 2026-07 to 2026-10 | HXR download and readiness only (part of HXR's reserved final period) | None | No | No | See the last row |
| **Unknown, all periods** | | Any TradingView Strategy Tester use (no repository record); sessions that left no record | | | The owner's own viewing and trading of these stocks through 2026 |

Also recorded: on 2026-10-22, HXR's download and readiness code was checked on real data for eight stocks in a
throwaway cloud folder. Counts, listing dates and split ratios only; no prices were shown and no rule was run
(HXR EXPERIMENT-LOG entry 5).

**HXR's reserved periods.** HXR stopped at its development pick, so its validation period (2022-01-03 to
2023-12-29) and its final period (2024-01-02 to 2026-10-21) were never run. A range-trend historical evaluation
on those dates, on the same ten stocks, exposes them. If it is run, any later HXR version must record that as
prior exposure, both here and in `strategy/hxr/EXPERIMENT-LOG.md`.

**Conclusion.**
- **No historical period is blind.** Testing different stocks does not remove what was learned about the same
  market period.
- **2022-2026** can serve as a secondary historical evaluation, with its prior exposure disclosed. It is not
  independent evidence.
- **A local simulated prospective journal** (no broker account, no orders, no paper-trading API) gives
  genuinely fresh observations. It still needs enough time, enough trades and realistic execution assumptions
  before it says anything.

---

## 2. Preferences, open points and proposed settings

### 2.1 Owner-confirmed preferences (from the owner's answers of 2026-10-26)

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

### 2.2 Still open

1. **Tier 2 and Tier 3 thresholds** (section 7) [OWNER TO CONFIRM / SET]. **Building does not wait for them.**
2. **Return against drawdown:** how much return to give up for a smaller drawdown than the full buy-and-hold
   (section 7c).
3. **The rule that picks the candidate** from the practice runs. It must be written in `EVALUATION-PROTOCOL.md`
   before the first practice run (section 8a), and it may never be the ending balance alone.
4. **Evaluation dates and Tier 3 thresholds**, in `EVALUATION-PROTOCOL.md` [OWNER TO SET].

### 2.3 Proposed experimental settings (each a hypothesis)

| Setting | Proposal | In plain words |
|---|---|---|
| Typical move `m` | Mean absolute close-to-close change over the last 20 changes | How far the stock usually moves in a day. Used to scale every distance below. |
| Range window | Closes from 60 sessions back to yesterday | About three months: long enough to see several bounces, short enough to follow a changing market. |
| Zones | Bottom 25% and top 25% of the range height | "Near the bottom" and "near the top" of the range. |
| Established range | At least 2 separate visits to each zone, and a height of at least 4 typical moves | The price really did bounce both ways, and the range is wide enough to be worth trading after costs. |
| Breakout | A close more than half a typical move above the range top | Clearly above the old ceiling, not just touching it. |
| Breakdown | 2 consecutive closes more than half a typical move below the range bottom | Support has failed. **Two closes is a provisional test assumption (decision 3)**, not something established from the owner's trading. |
| Range exit near the top | The resistance-rejection exit (section 4) | Sell only when the price reaches the top and is turned back down. |
| Trend exits | 2 closes back below the old top (**the same provisional two-close assumption**), or a close more than 3 typical moves below the highest close since buying | The breakout failed, or the trend has given back a normal-sized move. |
| Portfolio | Section 6a | One fixed set within each family, so that results compare the rules and not the money management. |
| Decision timing | After the close; fills at the next open (decision 6) | Section 2.5. |
| Costs | HXR's cost model: calibrated half-spread, slippage, US$0 commission, SEC and FINRA sell fees, 15% dividend withholding | So the results can be compared with HXR's. |

### 2.4 Re-entry above the last sale price (decision 4)

Both variants are tested (H5).

- **With the limit** (as HXR): after a sale at price `P`, the stock can be bought again only while its decision
  close is below `P` and the fill is below `P` (both adjusted for splits).
  - If the stock closes at or above `P` before being bought again, it is out for the rest of the run
    (proposal).
  - A fill at or above `P` is cancelled and recorded, and the stock keeps waiting.
- **Without the limit:** after a sale, the stock is treated like any other stock. Its next valid entry signal
  counts, whatever the price. For example, a stock sold at 100 forms a new range between 104 and 112, and a dip
  entry at 105 is allowed.

Without the limit the system stays invested in strong stocks, but it may sell and buy back the same stock
repeatedly ("whipsaw") and pay costs each time.

### 2.5 Deciding daily or during the day (decision 6)

**After the close** (the research choice): signals on daily closes, orders at the next open.
- Each decision rests on a finished day, so the test can be run on daily bars and checked by hand.
- It reacts up to a day late, and a gap at the open is taken as it comes.
- **It does not reproduce the owner's intraday reactions.**

**During the day** (not chosen):
- It reacts faster.
- It needs intraday data and a much more complex simulation.
- It produces more signals from noise, and more costs.
- It is closer to the reactive trading the owner wants to avoid.

---

## 3. Range and trend definitions (computable without hindsight)

**No hindsight.** Every reference level for decision day `t` uses closes up to `t−1` only. Today's close is only
ever compared with those levels.

- **Typical move** `m(t−1)`: the mean absolute close-to-close change over the 20 changes ending at `t−1`.
  - Entries use `m(t−1)` at decision time.
  - An open trade's exit and sizing levels use `m(entry)`, the value frozen at the entry decision.
- **Range window:** closes `t−60 … t−1`.
  - `lo` = the lowest close in the window, `hi` = the highest, and height `H = hi − lo`.
  - Bottom zone = `[lo, lo + 0.25H]`; top zone = `[hi − 0.25H, hi]`.
- **Visit:** a run of consecutive closes inside a zone. Two visits are separate only if at least 5 closes outside
  that zone lie between them.
- **Established range:** the window holds at least 2 separate visits to each zone, and `H ≥ 4 × m(t−1)`.
- **Rolling and freezing:** the boundaries roll daily while no trade is open. They are frozen at the entry
  decision and attached to the trade as `lo, hi, H, m` at entry.
- **Invalidated:** by a breakout or breakdown close, or when the rolling window no longer meets the conditions.
- **Breakout at `t`:** `close(t) > hi + 0.5 × m(t−1)`, with `hi` taken from `t−60 … t−1` and the range
  established on that window.
- **Breakdown:** 2 consecutive closes below `lo − 0.5 × m` (**two closes: a provisional test assumption,
  decision 3**).
  - For a trade, `lo` is the trade's frozen `lo` and `m` is `m(entry)`.
  - For an untraded range, `lo` comes from the window of the **first** breaking close, and `m` is `m(t−1)` at
    each close.
- **Dip entry:** in an established range, a close inside the bottom zone and above `lo`.
- **Recovery entry:** in an established range, after a visit to the bottom zone (the most recent one in the
  window), a close at least `1 × m(t−1)` above that visit's lowest close, above the bottom zone, and still in the
  lower half (`≤ lo + 0.5H`).
- **Pullback entry:** after a breakout, a "pullback close" within `1 × m(t−1)` of the old `hi` and still above
  it, followed by an up close. The entry is decided at that up close.
  - The watch for a pullback ends at a close at or below the old `hi` (the breakout failed), or at a new
    breakout.
  - If the close after a pullback close is not an up close, it becomes the new pullback close if it qualifies
    itself; otherwise the watch waits for another one.
- **Repeated signals (proposal):** an entry condition is checked at every close while the stock is not held and
  has no order pending. A signal that cannot be filled (for lack of cash or risk room) can therefore recur at a
  later close, while its condition still holds.

### Worked examples (made-up closes)

The arithmetic of each example was checked with a calculation.

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
| t+1 | 103 | 1.95 (19 changes of 2 and one of 1) | Visit's lowest close 101 + 1.95 = 102.95 ≤ 103; above the zone; ≤ lower-half limit 105 | **Recovery entry** (if no dip entry was taken) |

**B. Breakout, then pullback entry.** The window continues the pattern with `100, 102, 104, 106, 108`.

| Day | Close | `hi` (`t−60 … t−1`) | `m(t−1)` | Check | Result |
|---|---|---|---|---|---|
| t | 111.5 | 110 | 2 | 111.5 > 110 + 0.5 × 2 = 111 | **Breakout** (an immediate entry is decided here) |
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

All exits are decided at a close and filled at the next open.

**Range trades** (dip or recovery entry). These exits are part of every range run; none is an optional extra.
- **Breakout first:** if a close is above the frozen `hi + 0.5 × m(entry)`, the trade becomes a trend trade
  (old high = the frozen `hi`) and is held under the trend exits from then on.
- **Breakdown:** 2 consecutive closes below the frozen `lo − 0.5 × m(entry)` (**two closes: provisional,
  decision 3**). Exit.
- **Resistance rejection** (one proposed exit, experimental):
  - It is armed once a close enters the trade's frozen top zone.
  - It exits when a later close falls back below the top zone's lower edge minus `0.5 × m(entry)`.
- **How this differs from selling automatically at the top zone:** reaching the top only arms the exit. A stock
  that reaches the top and stays there is not sold, and neither is one that breaks out. Only a rejection back
  down is.
- **No time-based exit** (owner's build setting). A range trade that neither breaks down nor reaches the top
  is held.

**Trend trades** (an immediate breakout entry, a pullback entry, or a range trade that broke out). Exit on
either:
- 2 consecutive closes back below the old `hi` (**two closes: provisional, decision 3**); or
- a close more than `3 × m(entry)` below the highest close since buying.

The sizing stops of section 6a are planning levels for sizing. They are **not** exit prices.

---

## 5. Hypotheses

| | Hypothesis | Behaviour it should change | Measures |
|---|---|---|---|
| H1 | Dip entries buy cheaper but fail support more often | Entry price relative to the range; breakdown exits | Average entry position in the range (0 = `lo`, 1 = `hi`); share of range trades ending in breakdown; average loss per breakdown |
| H2 | Recovery entries pay a little more but fail support less often | The reverse of H1 | The same measures, compared with H1 |
| H3 | Immediate breakout entries catch more of a run, with more false breakouts | Trend capture; failed breakouts | Share of trend trades exiting on 2 closes below the old `hi`; gain per completed trend trade; trade count |
| H4 | Pullback entries have fewer false starts but miss some runs | Fewer failed breakouts; breakouts never entered | The same as H3, plus the number of breakouts with no pullback entry |
| H5 | Removing the below-sale re-entry limit raises time invested and whipsaw costs | Exposure; repeated trading of the same stock | Average invested fraction; re-entries above the last sale; costs; P/L of trades starting within 20 sessions of a sale of the same stock |
| H6 | HXR with the corrected tech/AI cap (diagnostic only) | Explains the 2026-10-23 development results | Runs under HXR's own ledger as a new HXR version, marked contaminated, never counted. Not a range-trend config. No result predicted. |

---

## 6. Experiment budget (decision 8)

All practice runs use 2017-10-02 to 2021-12-31 and are labelled **exploratory**. That period is already
development data (section 1).

| Family | Runs | Variants |
|---|---|---|
| Range | 4 | Dip or recovery entry, each with and without the re-entry limit |
| Trend | 4 | Immediate or pullback entry, each with and without the re-entry limit |
| HXR corrected-cap diagnostic | 1 | H6. An HXR run, not a range-trend config |
| Range + trend combination | up to 2 | Only if both families show measurable behaviour. Their configs are written only then, with an experiment-log entry |
| **Total** | **11** | |
| Reserve | 1 | See below |

- **The reserve** is used only to re-run a run invalidated by a verified defect (code or data), with only the
  defect corrected. The broken result is kept and logged next to the re-run, with:
  - the defect;
  - how it was verified;
  - the correction.

  It is never used for parameter tuning.
- Every run is logged, failures included.
- Range and trend are tested separately before they are combined.
- Constant within each family: HXR's ten stocks, HXR's cost model, decisions after the close with fills at the
  next open, US$15,000 shared cash and the portfolio rules of 6a.

### 6a. Portfolio rules (approved for building, 2026-10-26)

`V` = the account value at the decision close: cash plus holdings at that close. Dividends receivable are not
included. All limits are fractions of `V`. There is no adding to a position: one position per stock at a time.

- **Sizing stop** (a planning level for sizing, **not** an exit price):
  - range trades: frozen support `lo − 0.5 × m(entry)`;
  - trend trades: old range high `hi − 0.5 × m(entry)`.
- **Planned risk per trade:** at most `1% × V`, where planned risk = `shares × (price − sizing stop)`.
- **Position cap:** at most `20% × V` in one position.
- **Total planned entry risk:** at most `5% × V`. This is the sum over open positions (and orders waiting to
  fill) of each one's planned risk **at entry**. It is not re-measured as prices move.

**Same-day signals.** When several entry signals arrive at one close:
- The available cash and the remaining total-risk room (`5% × V` minus the entry risk of open positions and
  pending orders) are **each shared equally** between that day's signals.
- Each signal is sized by the smallest of: its cash share, its risk-room share, risk per trade, and the position
  cap.
- Shares are whole, rounded down.
- Cash or risk room left over stays unused that day, so the order of the signals never matters.
- Available cash is the cash at the decision close, minus cash reserved by orders still waiting to fill.

**At the fill** (the next open):
- The order was sized at the decision close. At the fill, all its limits are applied again at the **fill
  price**: its cash share including costs, the 20% cap and the 1% risk per trade (both of the decision's `V`),
  and its risk-room share. The share count can be **reduced**, never raised.
- If the sizing stop is at or above the fill price, the entry is **rejected** and recorded.
- If no whole share fits, the order is **cancelled** and recorded.
- The entry price in the total risk is the fill price.
- Cash never goes below zero.

**The realised loss can exceed the planned risk.** The exits need two closes, or a close well below the
highest, and fills happen at the next open after a gap.

#### What these values mean (worked sizing at `V` = US$15,000, section 3's made-up closes)

The risk limit sets the size only when the sizing stop is more than **5%** below the close (1% ÷ 20%).
Otherwise the 20% cap does. In section 3's examples the stops are 2-4% below the close, so the cap binds every
time:

| Entry | Close | Sizing stop | Distance | By 1% risk | By 20% cap | Shares | Planned risk | Position |
|---|---|---|---|---|---|---|---|---|
| Dip (A, day t) | 101 | 100 − 0.5 × 2 = 99 | 2 (1.98%) | ⌊150 ÷ 2⌋ = 75 | ⌊3,000 ÷ 101⌋ = 29 | **29 (cap)** | US$58 | US$2,929 |
| Recovery (A, day t+1) | 103 | 100 − 0.5 × 1.95 = 99.025 | 3.975 (3.86%) | 37 | 29 | **29 (cap)** | US$115.275 | US$2,987 |
| Immediate breakout (B, day t) | 111.5 | 110 − 0.5 × 2 = 109 | 2.5 (2.24%) | 60 | 26 | **26 (cap)** | US$65 | US$2,899 |
| Pullback (B, day t+2) | 111.4 | 110 − 0.5 × 2.01 = 108.995 | 2.405 (2.16%) | 62 | 26 | **26 (cap)** | US$62.53 | US$2,896.40 |
| Made-up far stop | 100 | 92 | 8 (8%) | 18 | 30 | **18 (risk)** | US$144 | US$1,800 |

Costs and whole shares can lower these slightly at the fill.

**When the 5% total can bind:**
- A position held to the 20% cap has planned risk of at most `20% × V ×` (stop distance ÷ price). With stops
  within 5% of the close, that is at most 1% each.
- Cash allows about five full positions, so they reach at most about 5% in total, and the cash runs out first.
- The 5% total binds when positions have stops more than 5% below their entry. Each then uses less than 20% of
  the cash, so more than five fit, and the risk total reaches 5% first.
- It can also bind after `V` falls, because entry risks are fixed in dollars while `5% × V` shrinks.

### 6b. Not inherited from HXR, and why

- **The account-decline pause.** In the HXR development records, the pause never ended in six base runs. It
  skipped 2,999 buy signals, and no close came back within US$750 of the peak
  (`strategy/hxr/reports/2026-10-26-diagnosis.md`, supplement a and d; one VWAP rerun did come back once,
  correction 7). The explanation, that a mostly-cash account rarely recovers while new buys are blocked, is a
  **hypothesis**.
- **The open-risk budget measured from current value.** HXR measures open risk as shares × (current close −
  exit level), so a rising winner uses up more of the budget. In the development records, all 121 base-run
  skips with no recorded binding cap fell on days with open risk above US$750.
- **Instead, risk is measured at entry only** (6a): a winner never blocks a new buy by rising.

---

## 7. Success criteria (decision 7): not finalised, and not a precondition for building

### 7a. Tier 1: the code is correct

Synthetic data only. Must pass before any practice-run result is looked at.
- Every worked example in sections 3 and 6a reproduces.
- No look-ahead, future-change and determinism tests pass.
- Accounting:
  - cash never goes below zero;
  - account value = cash + holdings at every close;
  - every fill carries its costs;
  - costs and dividends reconcile with the cash.
- Provenance (`codeRevision`, `symbolsHash`, config hash, data hash) is stored on every run.
- Sizing is hand-checked, including several same-day signals and next-open gaps up and down.
- There is a scenario for every entry and exit.

### 7b. Tier 2: exploratory usefulness

These are descriptions, not pass marks. Every threshold is **[OWNER TO CONFIRM]**.
- Each hypothesis's predicted behaviour is reported as appearing, not appearing, or insufficient.
- A comparison between two runs is read only if each run has at least **[30]** completed trades. Otherwise it
  is marked insufficient.
- Each result is also reported without the run's best 5% of trades.
- Any single stock making more than **[40%]** of a run's net profit is flagged.
- Every run is compared with the exposure-matched hold (7c).
- Costs are reported as a metric, with no pass mark.

### 7c. Tier 3: the evaluation

- Thresholds are **[OWNER TO SET]**. They are written into `EVALUATION-PROTOCOL.md` and frozen with the
  candidate before any evaluation data is touched.
- The local simulated prospective journal also needs a minimum length and trade count before anything is
  concluded, for example **[6 months and 30 completed trades]**.

**Benchmarks:**
- **(a) Buy and hold:** the fully invested equal-weight buy-and-hold of the same stocks (HXR's hold arm), with
  the same costs.
- **(b) Cash at 0%.**
- **(c) Exposure-matched hold (derived):**
  - `r(t)` = the return of (a)'s account value from close `t−1` to close `t`;
  - `f(t−1)` = the run's holdings ÷ its account value at close `t−1`;
  - `B(t) = B(t−1) × (1 + f(t−1) × r(t))`, with `B(0)` = US$15,000.

  It is labelled **derived**. It is frictionless in its own rebalancing (no costs or whole shares for moving
  between (a) and cash). Its `f` lags the run's own fills by part of a day: the run's positions change at the
  open, `f` is measured at the previous close.

**The trade-off rule.** Sitting in cash lowers the worst fall by itself, so **a smaller drawdown alone earns no
credit.** After costs, a rule adds value only if it either:
- beats (c) on return **without** a deeper maximum drawdown than (c); or
- beats (c) on return per unit of maximum drawdown.

A rule that loses to (c) on both adds nothing beyond holding cash. How much return to give up for a smaller
drawdown than the full buy-and-hold (a) is the owner's preference, and it is **still open**.

**Per run, always reported:** net return after costs, maximum drawdown, average invested exposure and time in
cash, trade count and holding periods, turnover and costs, and the comparisons with (a), (b) and (c).

**The pick rule** that chooses the candidate from the practice runs is open. It is written in
`EVALUATION-PROTOCOL.md` before the first practice run, and it is never the ending balance alone. No automatic
winner selection is to be built.

---

## 8. Sequence

1. The owner's build approval (done 2026-10-26; first entry of `EXPERIMENT-LOG.md`).
2. Build, with the Tier 1 tests.
3. The owner completes `EVALUATION-PROTOCOL.md`: the pick rule, how the evaluation dates are chosen, and the
   Tier 3 thresholds.
4. The practice runs, within the budget, on separate instruction.
5. Freeze the candidate and the protocol.
6. The evaluation, according to the protocol.
7. The local simulated prospective journal.

Once an evaluation result influences any change, that period becomes development data.

### 8a. Evaluation protocol

Decision 9 above is the owner's words. The options below are a proposal; the owner chose **C**.

- **(A) One historical run**, with **all** of section 1's disclosures, including HXR's reserved periods. It is a
  secondary evaluation, not independent evidence.
- **(B) A local simulated prospective journal only** (no broker account, no orders, no paper-trading API).
- **(C) Both** (the owner's choice).

**The rules:**
- `strategy/range-trend/EVALUATION-PROTOCOL.md` states how the evaluation dates are chosen, the pick rule and
  the Tier 3 thresholds. It is written **before the first practice run**, so that no exploratory result
  influences those choices.
- The code is to refuse practice runs until the file exists and contains the pick rule.
- The candidate and the protocol are frozen, with their hashes, **before any evaluation result is
  accessed**.
- The evaluation runs once.

---

## 9. Limits

- Historical tests are price-based approximations.
- Company news, and "holding while the case holds", can only be observed in the prospective journal.
- The tests use no current fundamentals, no revised data without its publication timing, and no news known
  only with hindsight.
- **Results apply only to HXR's ten hand-picked stocks** (decision 10). They do not establish performance
  across stocks generally.

---

## Decisions that need the owner

1. The pick rule, the evaluation dates (or how they are chosen) and the Tier 3 thresholds, written in
   `EVALUATION-PROTOCOL.md`. **Practice runs are to be blocked until the pick rule is there.**
2. The Tier 2 thresholds ([30] completed trades, [40%] single-stock share).
3. The return-against-drawdown preference (7c).
4. A separate instruction to start the practice runs.
