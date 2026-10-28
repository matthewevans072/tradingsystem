# Range-trend (working name): plan, version 0.5

> **DRAFT.** No range-trend run has been made on market data. Section 0 records the owner's research decisions
> in the owner's words. **The owner's decisions D1 to D8 of 2026-10-27 are recorded in `EXPERIMENT-LOG.md`
> entry 7 and built into the eight `rt-*-0.2.0.json` configs; each is an experimental choice, not a claim that it
> reproduces the owner's trading.** D9 (the pick rule and the rule for choosing the evaluation dates) is still
> open, and practice runs stay refused until it is written into `EVALUATION-PROTOCOL.md`. Values marked
> **[OWNER TO CONFIRM]** or **[OWNER TO SET]** are not decided. Versions 0.1 to 0.3 written 2026-10-26; 0.4
> on 2026-10-27; 0.5 on 2026-10-28.

The idea: a stock that keeps bouncing between a lower and an upper price area is traded as a **range**. A stock
that breaks out of its range and stays strong is held as a **trend**. The two are tested separately.

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
   result and log the correction; don't use the reserve for parameter tuning. → section 6. **Amended by the
   owner-decisions entry (`EXPERIMENT-LOG.md` entry 7, 2026-10-27): "Keep the budget at eight exploratory runs
   plus one verified-defect reserve. No combination runs or HXR diagnostic."**
9. Evaluation: We can leave the exact dates unresolved now, but document how they will be chosen before
   exploratory results influence that choice. Freeze the candidate and evaluation protocol before accessing
   evaluation results. Preserve the prior-exposure disclosures. → sections 1, 8a
10. Stocks: Use HXR's ten for the initial comparison. State that results apply to this selected universe and do
    not establish performance across stocks generally. → sections 6 (the constants of every run), 6c (the data),
    9 (the limit on what results mean)

**Build settings approved by the owner on 2026-10-26** (recorded as the first entry of
`strategy/range-trend/EXPERIMENT-LOG.md`): the portfolio values of section 6a; no separate tech/AI cap, no
time-based range exit, no adding to positions, no decline pause and no current-value open-risk budget; and
evaluation choice C (section 8a). **The approval covers building only.** No practice run, historical
evaluation or prospective journal is authorised by it.

**The owner's decisions D1 to D8 of 2026-10-27** (`EXPERIMENT-LOG.md` entry 7, verbatim there): accept
suggestions 2 and 4 to 8 of version 0.4 as experimental choices; for 1, never retire a stock and apply the
below-last-sale restriction only to the restricted variants; for 3, invalidate the broken range but let the
stock qualify again when a new range forms entirely from post-breakdown observations, with no separate
retirement period; for 4, specify the benchmark's rebalancing convention before testing; eight runs plus one
reserve, no combination runs, no HXR diagnostic. The owner also chose: the pullback watch ends when its pullback
entry fills; breaks are detected from the warm-up on; MU, the Tier 3 thresholds and the journal minimums move to
a separate thresholds file frozen before evaluation; a drop of MU applies to the historical evaluation only.
The resulting definitions are in sections 2.4, 3, 4, 6 and 7c, each labelled **experimental choice**.

**The code exists** (`server/rangetrend/`, EXPERIMENT-LOG entries 2 to 12; code revision `rt-code-2026-10-28-2`,
engine `rt-engine-3`). Where this plan describes behaviour "as implemented", it describes that code.

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

**The Strategy Lab's MU holdout.** The consolidation-breakout strategy's untouched holdout window is
**2025-01-01 to 2026-06-30** and MU is one of its 17 stocks. A range-trend historical evaluation covering those
dates exposes MU's prices in that window. **Whether MU is kept or dropped before any historical evaluation is the
owner's decision**, written into `EVALUATION-THRESHOLDS.md` (frozen before any evaluation result is accessed).
A drop of MU applies to the historical evaluation only: the practice runs keep basket A (decision 10).

**Conclusion.**
- **No historical period is blind.** Testing different stocks does not remove what was learned about the same
  market period.
- **2022-2026** can serve as a secondary historical evaluation, with its prior exposure disclosed. It is not
  independent evidence.
- **A local simulated prospective journal** (no broker account, no orders, no paper-trading API) gives
  genuinely fresh observations. It still needs enough time, enough trades and realistic execution assumptions
  before it says anything.

---

## 2. Preferences, open points and settings

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

1. **D9:** the pick rule and the rule for choosing the evaluation dates, in `EVALUATION-PROTOCOL.md`'s dedicated
   fields. Practice runs are refused until both are written.
2. **`EVALUATION-THRESHOLDS.md`:** keep or drop MU before any historical evaluation, the Tier 3 thresholds and
   the prospective journal's minimums. Frozen before any evaluation result is accessed; never read by the
   practice-run gate.
3. **Tier 2 thresholds** (section 7b) [OWNER TO CONFIRM].
4. **Return against drawdown:** how much return to give up for a smaller drawdown than the full buy-and-hold
   (section 7c).

### 2.3 Experimental settings (accepted by the owner as experimental choices, D8)

| Setting | Setting | In plain words |
|---|---|---|
| Typical move `m` | Mean absolute close-to-close change over the last 20 changes | How far the stock usually moves in a day. Used to scale every distance below. |
| Range window | Closes from 60 sessions back to yesterday | About three months: long enough to see several bounces, short enough to follow a changing market. |
| Zones | Bottom 25% and top 25% of the range height | "Near the bottom" and "near the top" of the range. |
| Established range | At least 2 separate visits to each zone, and a height of at least 4 typical moves | The price really did bounce both ways, and the range is wide enough to be worth trading after costs. |
| Breakout | A close more than half a typical move above the range top | Clearly above the old ceiling, not just touching it. |
| Breakdown | 2 consecutive closes more than half a typical move below the range bottom | Support has failed. **Two closes is a provisional test assumption (decision 3)**, not something established from the owner's trading. |
| Range exit near the top | The resistance-rejection exit (section 4) | Sell only when the price reaches the top and is turned back down. |
| Trend exits | 2 consecutive closes back below the old top (**two closes: the same provisional test assumption, decision 3**), or a close more than 3 typical moves below the highest close since buying | The breakout failed, or the trend has given back a normal-sized move. |
| Portfolio | Section 6a | One fixed set within each family, so that results compare the rules and not the money management. |
| Decision timing | After the close; fills at the next open (decision 6) | Section 2.5. |
| Costs | HXR's cost model: calibrated half-spread, slippage, US$0 commission, SEC and FINRA sell fees, 15% dividend withholding | So the results can be compared with HXR's. |

**D8 (experimental choice):** these settings and the definitions of section 3, with D2 and D3, are the ones
built into the eight configs. Nothing in the owner's answers fixes the 60-session window, the 25% zones, 2
visits, 4 typical moves or the half-move margins; they are accepted as the settings to test.

### 2.4 Re-entry above the last sale price (decision 4, D1)

Both variants are tested (H5). **D1 (experimental choice): no stock is ever retired.**

- `P` = the last sale's fill price for that stock (half-spread and slippage included), adjusted for splits and
  replaced at each later sale. A stock never sold has no `P`. A position closed because a split left no whole
  share is not a sale: `P` is unchanged.
- **With the limit** ("-limit" variants, as implemented): an entry signal is refused while its decision close is
  at or above `P`, recorded as a skip with code `reentry_limit` (a refused pullback signal counts as used); a buy
  whose fill price, half-spread and slippage included, is at or above `P` is cancelled and recorded. The stock
  keeps being checked at later closes, and enters when a later signal and fill are below `P`.
- **Without the limit** ("-nolimit" variants): `P` is never used in any entry, fill or retirement decision. It is
  still tracked for reporting (H5: re-entries above the last sale). For example, a stock sold at 100 forms a new
  range between 104 and 112, and a dip entry at 105 is allowed.

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
ever compared with those levels. **Closes are the stock's own closes:** excluded sessions and days without a bar
for that stock do not count, for the window, for `m`, and for the counts of D3.

- **Typical move** `m(t−1)`: the mean absolute close-to-close change over the 20 changes ending at `t−1`.
  - Entries use `m(t−1)` at decision time.
  - An open trade's exit and sizing levels use `m(entry)`, the value frozen at the entry decision.
- **Range window:** closes `t−60 … t−1`.
  - `lo` = the lowest close in the window, `hi` = the highest, and height `H = hi − lo`.
  - Bottom zone = `[lo, lo + 0.25H]`; top zone = `[hi − 0.25H, hi]`.
- **Visit:** a run of consecutive closes inside a zone. Two visits are separate only if at least 5 closes outside
  that zone lie between them.
- **Established range:** the window holds at least 2 separate visits to each zone, and `H ≥ 4 × m(t−1)`.
- **Qualified range (D3, experimental choice):** the range is qualified at close `t` when it is established on
  `t−60 … t−1` and, if the stock has a confirming close (below), that whole window lies after it. **Dip,
  recovery and immediate-breakout entries need a qualified range.**
- **Rolling and freezing:** the boundaries roll daily while no trade is open. They are frozen at the entry
  decision and attached to the trade as `lo, hi, H, m` at entry.
- **Break (D3, experimental choice).** A break gives the stock a **confirming close**; it is checked at every
  close, held or not, warm-up closes included. A break is:
  - **(a) a confirmed breakdown of a qualified range:** a first close below `lo − 0.5 × m(t−1)` freezes that
    window's `lo`; the next close confirms it if it is also below the frozen `lo − 0.5 × m(t−1)` of that close
    (example C). The confirming close is that second close. A next close that is not below drops the frozen
    `lo`; a later break needs a new first breaking close of a qualified range. (With the two-close setting of
    decision 3; the code counts `breakdownCloses` consecutive closes.)
  - **(b) a breakout close of a qualified range:** `close(t) > hi + 0.5 × m(t−1)`. The confirming close is that
    close.
  - **(c) a range trade's breakdown-exit decision close, or its conversion close** (section 4).

  **After a confirming close:** the range is not qualified until a window of 60 closes lies entirely after it.
  **Minimum waiting period: the earliest decision close for a dip, recovery or immediate-breakout entry is the
  stock's 61st close after the confirming close**, usually later (the new window must also be established).
  There is no other retirement period, and no stock is ever retired.
  - **Only a breakout's own close keeps its normal signals:** its immediate-breakout entry and the start of its
    pullback watch.
  - **A breakdown's confirming close gives no dip or recovery entry** (the rolling window may then show the first
    breaking close as its `lo`, and a close just above it would otherwise look like a dip).
  - **While the range is not qualified**, a close above the rolling `hi + 0.5 × m(t−1)` is not a breakout: no
    immediate entry, no new or replaced pullback watch, no new confirming close. A close below the rolling
    `lo − 0.5 × m(t−1)` starts no breakdown either.
  - **Open trades keep their frozen levels; their exits are unaffected.**
- **Breakout at `t`:** `close(t) > hi + 0.5 × m(t−1)`, with `hi` taken from `t−60 … t−1` and the range
  qualified on that window.
- **Breakdown of a trade:** 2 consecutive closes below the frozen `lo − 0.5 × m(entry)` (**two closes: a
  provisional test assumption, decision 3**).
- **Dip entry:** in a qualified range, a close inside the bottom zone and above `lo`.
- **Recovery entry (D2, experimental choice):** in a qualified range, after a visit to the bottom zone (the most
  recent one in the window), a close
  - at least `1 × m(t−1)` above that visit's lowest close, above the bottom zone, and still in the lower half
    (`≤ lo + 0.5H`);
  - **(a) an up close:** `close(t) > close(t−1)`, the stock's previous close;
  - **(b) with no close of the window `t−60 … t−1` after the last close of that visit lying in the top zone of
    that same window, and `close(t)` not in it either.**
- **Pullback entry:** after a breakout, a "pullback close" (above the old `hi` and within `1 × m(t−1)` of it),
  followed by an up close, `close(t) > close(t−1)`. The entry is decided at that up close.
  - **The watch (the owner's choice of 2026-10-27):** it starts at a breakout of a qualified range (replacing a
    running watch), and ends at a close at or below the old `hi` (the breakout failed), at a new breakout of a
    qualified range, or **when its pullback entry fills**. If a decided pullback entry is cancelled or rejected
    at the fill, the watch continues and needs a new pullback close followed by an up close.
  - It advances at every trading close, whether or not the stock is held; only the entry needs the stock not
    held and no order pending. As implemented, watches start from the period's first trading close: a breakout
    during the warm-up starts no watch.
  - A pullback signal is used once: if it is not entered (refused, skipped, rejected or cancelled), a later close
    needs a new pullback close first.
- **Repeated signals (as implemented):** an entry condition is checked at every close while the stock is not
  held and has no order pending. A signal that cannot be filled (for lack of cash or risk room) can therefore
  recur at a later close, while its condition still holds.
- **Comparison convention (as implemented):** values within 1e-9 are equal, so "at or above" and "above" are
  judged at the plan's exact edges.

### Worked examples (made-up closes)

The arithmetic of each example was checked with a calculation and is reproduced by the Tier 1 tests.

**The window.** The made-up pattern `100, 102, 104, 106, 108, 110, 108, 106, 104, 102` is repeated six times:
60 closes ending at 102.
- Every change is 2, so `m = 2`. `lo = 100`, `hi = 110`, `H = 10`.
- Bottom zone `[100, 102.5]`, top zone `[107.5, 110]`.
- Each cycle visits both zones (bottom visits: `102, 100, 102`), separated by 7 closes outside the zone.
- `H = 10 ≥ 4 × 2 = 8`, so the range is **established**, and with no confirming close **qualified**.

**A. Range entries**

| Day | Close | `m(t−1)` | Check | Result |
|---|---|---|---|---|
| t−1 | 102 | | (end of the window) | |
| t | 101 | 2 | In `[100, 102.5]` and above 100 | **Dip entry** |
| t+1 | 103 | 1.95 (19 changes of 2 and one of 1) | Visit's lowest close 101 + 1.95 = 102.95 ≤ 103; above the zone; ≤ lower-half limit 105; an up close (103 > 101); no top-zone close since the visit | **Recovery entry** (if no dip entry was taken) |

Under D2, a recovery close of 103 after a close of 103.5 would not count (not an up close), and neither would
one after the window had visited the top zone since the bottom visit.

**B. Breakout, then pullback entry.** The window continues the pattern with `100, 102, 104, 106, 108`.

| Day | Close | `hi` (`t−60 … t−1`) | `m(t−1)` | Check | Result |
|---|---|---|---|---|---|
| t | 111.5 | 110 | 2 | 111.5 > 110 + 0.5 × 2 = 111 | **Breakout** (an immediate entry is decided here; the watch starts; this is a confirming close) |
| t+1 | 110.8 | (old hi 110) | 2.075 | Above 110 and within 2.075 of it | Pullback close |
| t+2 | 111.4 | | 2.01 | Up close: 111.4 > 110.8 | **Pullback entry** |

*Check that a breakout is still possible:* `hi` excludes today's close. If `hi` included it, `hi` on day t
would be 111.5, and no close could ever be above `hi + 0.5m`: the breakout rule could never fire.

*After the breakout (D3):* closes of 113 and 114.5 on t+1 and t+2 are above the rolling top (111.5 + 0.5 ×
2.075) but the range is not qualified: no second immediate entry, and the watch keeps the old `hi` of 110.

**C. Breakdown of an untraded range.** After the 60-close window:

| Day | Close | Level | Check | Result |
|---|---|---|---|---|
| t | 98.5 | `lo` = 100 (window of this first breaking close), `m` = 2 | 98.5 < 100 − 1 = 99 | First breaking close |
| t+1 | 98 | frozen `lo` = 100, `m(t)` = 2.075 | 98 < 100 − 1.0375 = 98.96 | **Breakdown: the confirming close** |

*Why `lo` is frozen at the first breaking close:* a rolling `lo` on day t+1 would already be 98.5. The level
would then be 97.46, and the second close of 98 would not count. Support that had already failed would never
be confirmed.

*No dip on the confirming close:* with 98.9 instead of 98 on t+1, the rolling window's bottom zone would be
`[98.5, 101.375]` and 98.9 would look like a dip; but 98.9 < 98.96 confirms the breakdown, and a breakdown's
confirming close gives no dip or recovery entry. The earliest entry is then the stock's 61st close after t+1.

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
  (old high = the frozen `hi`) and is held under the trend exits from then on. **The conversion close is a
  confirming close of the stock's range (D3 c).**
- **Breakdown:** 2 consecutive closes below the frozen `lo − 0.5 × m(entry)` (**two closes: provisional,
  decision 3**). Exit. **The decision close is a confirming close of the stock's range (D3 c)**, so after the
  sale the old range gives no new entry: the stock needs a new range entirely after that close.
- **Resistance rejection** (one proposed exit, experimental):
  - It is armed once a close enters the trade's frozen top zone.
  - It exits when a later close falls back below the top zone's lower edge minus `0.5 × m(entry)`.
  - It is not a break: the stock's rolling range keeps its qualification.
- **How this differs from selling automatically at the top zone:** reaching the top only arms the exit. A stock
  that reaches the top and stays there is not sold, and neither is one that breaks out. Only a rejection back
  down is.
- **No time-based exit** (owner's build setting). A range trade that neither breaks down nor reaches the top
  is held.

**Trend trades** (an immediate breakout entry, a pullback entry, or a range trade that broke out). Exit on
either:
- 2 consecutive closes back below the old `hi` (**two closes: provisional, decision 3**); or
- a close more than `3 × m(entry)` below the highest close since buying.

Neither trend exit is a break.

**Other ways a position ends (as implemented):**
- a split that leaves no whole share closes the position at the split (`split_no_whole_share`); its fraction is
  paid as cash in lieu to that trade (section 6b). It is not a sale: `P` is unchanged.

The sizing stops of section 6a are planning levels for sizing. They are **not** exit prices.

---

## 5. Hypotheses

| | Hypothesis | Behaviour it should change | Measures |
|---|---|---|---|
| H1 | Dip entries buy cheaper but fail support more often | Entry price relative to the range; breakdown exits | Average entry position in the range (0 = `lo`, 1 = `hi`); share of range trades ending in breakdown; average loss per breakdown |
| H2 | Recovery entries pay a little more but fail support less often | The reverse of H1 | The same measures, compared with H1 |
| H3 | Immediate breakout entries catch more of a run, with more false breakouts | Trend capture; failed breakouts | Share of trend trades exiting on 2 closes below the old `hi` (**two closes: provisional, decision 3**); gain per completed trend trade; trade count |
| H4 | Pullback entries have fewer false starts but miss some runs | Fewer failed breakouts; breakouts never entered | The same as H3, plus the number of breakout watches that ended without an entry (a close back at or below the old high, or replaced by a new breakout). **Only watches on stocks not held (and with no buy waiting to fill) when the breakout occurred are counted.** |
| H5 | Removing the below-sale re-entry limit raises time invested and whipsaw costs | Exposure; repeated trading of the same stock | Average invested fraction; re-entries above the last sale (filled entries decided at or above `P`, open positions included); the limit's refused signals and cancelled fills; costs; the P/L of trades whose entry fills within 20 sessions of a sale of the same stock |

The HXR corrected-cap diagnostic (H6 of versions 0.3 and 0.4) is **dropped by the owner (D7)**: no HXR run is
part of this plan.

---

## 6. Experiment budget (decision 8, amended by D6 and D7)

All practice runs use 2017-10-02 to 2021-12-31 and are labelled **exploratory**. That period is already
development data (section 1).

| Family | Runs | Variants |
|---|---|---|
| Range | 4 | Dip or recovery entry, each with and without the re-entry limit |
| Trend | 4 | Immediate or pullback entry, each with and without the re-entry limit |
| **Total** | **8** | The eight `rt-*-0.2.0.json` configs (`config.js` `PLANNED_CONFIGS`), each run once |
| Reserve | 1 | See below |

- **No combination runs (D6) and no HXR diagnostic (D7).** The budget is eight exploratory runs plus one
  verified-defect reserve.
- **The reserve** is used only to re-run a run invalidated by a verified defect (code or data), with only the
  defect corrected. The broken result is kept and logged next to the re-run, with:
  - the defect;
  - how it was verified;
  - the correction.

  It is never used for parameter tuning. As implemented, the reserve run must use the config hash of the run it
  replaces, needs all three of the items above as non-empty text, and only one reserve exists in all.
- Every run is logged, failures included. As implemented, a run's ledger slot is taken before it starts; a run
  interrupted by a stopped process is recorded as failed and its slot stays used.
- **The benchmarks are not runs in this budget.** Benchmarks (a), (b) and (c) of section 7 are computed with
  every practice run, from the same inputs, and do not count against the eight.
- Range and trend are tested separately.
- Constant within each family: HXR's ten stocks (decision 10), HXR's cost model, decisions after the close with
  fills at the next open, US$15,000 shared cash and the portfolio rules of 6a.
- The superseded `rt-*-0.1.0.json` files (versions 0.3 and 0.4 of this plan) are kept with their pins and cannot
  run: `validateConfig` requires the declarations of D1 to D4 and of the watch rule (`reentryRetire: false`,
  `levels.recoveryUpClose: true`, `levels.recoveryNoTopSinceBottom: true`, `levels.brokenRange:
  "post_break_window"`, `levels.pullbackWatchEndsAt: "fill"`, `benchmark.buyAndHold:
  "equal_weight_fractional_never_rebalanced"`), which they lack.

### 6a. Portfolio rules (approved for building, 2026-10-26)

`V` = the **simulated** account's value at the decision close: its cash plus its holdings at that close.
Dividends receivable are not included. **Nothing reads the owner's real cash or holdings**: the simulated
account starts from US$15,000 of made-up cash and never touches `data/signal-desk.sqlite`. All limits are
fractions of `V`. There is no adding to a position: one position per stock at a time.

- **Sizing stop** (a planning level for sizing, **not** an exit price):
  - range trades: frozen support `lo − 0.5 × m(entry)`;
  - trend trades: old range high `hi − 0.5 × m(entry)`.
- **Planned risk per trade:** at most `1% × V`, where planned risk = `shares × (price − sizing stop)`.
- **Position cap:** at most `20% × V` in one position.
- **Total planned entry risk:** at most `5% × V`. This is the sum over open positions (and orders waiting to
  fill) of each one's planned risk **at entry**. It is not re-measured as prices move.

**Same-day signals.** When several entry signals arrive at one close:
- The available cash and the remaining total-risk room (`5% × V` minus the entry risk of open positions and
  pending orders) are **each shared equally** between that day's signals. A signal refused by the re-entry
  limit (D1) takes no share.
- Each signal is sized by the smallest of: its cash share, its risk-room share, risk per trade, and the position
  cap.
- Shares are whole, rounded down.
- Cash or risk room left over stays unused that day, so the order of the signals never matters.
- Available cash is the cash at the decision close, minus cash reserved by orders still waiting to fill.

**At the fill** (the next open):
- The order was sized at the decision close. At the fill, all its limits are applied again at the **fill
  price**: its cash share including costs, the 20% cap and the 1% risk per trade (both of the decision's `V`),
  and its risk-room share. The share count can be **reduced**, never raised.
- With the re-entry limit, a fill price at or above `P` is **cancelled** and recorded (D1).
- If the sizing stop is at or above the fill price, the entry is **rejected** and recorded.
- If no whole share fits, the order is **cancelled** and recorded.
- The entry price in the total risk is the fill price.
- Cash never goes below zero.

**The realised loss can exceed the planned risk.** The exits need two closes (**provisional, decision 3**), or a
close well below the highest, and fills happen at the next open after a gap.

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

**D5 (experimental choice, accepted): whole shares at raw prices.** Prices are raw (unadjusted) daily prices,
as HXR uses them. Before their 2022 20-for-1 splits, AMZN traded at about US$1,000 to US$3,700 and GOOG at about
US$1,000 to US$3,000 (2017 to 2021), so on a US$15,000 account the 20% cap (US$3,000) allows **0 or 1 share** of
either. A 0-share signal is skipped and recorded; a 1-share position has its risk set by the price, not by the
1% rule. No design change. **Reported per run, per stock:** signals; decision-time skips by code (including
`no_whole_share` and `reentry_limit`); fill-time cancellations and rejections by code; 1-share entries; orders
pending at the period's end; dividends entitled but unpaid at the end.

### 6b. Splits, excluded sessions and dividends (as implemented)

- **Splits.** On a split's effective session, every stored price and level of that stock moves to post-split
  units (the close history in the window, the last close, a trade's frozen `lo, hi, H, m`, its sizing stop, old
  high and highest close, the last sale price `P`, the pullback watch, a pending breakdown's frozen `lo`, and a
  pending buy's share count and levels). Shares are multiplied by the ratio and rounded down; the fraction left
  over is paid as cash in lieu at the next open less the half-spread, to the trade that held it. A split that
  leaves no whole share closes the position at the split (section 4).
- **Excluded sessions.** HXR's excluded sessions (`periods-hxr-v3.json`) are removed from the session list
  before the engine sees them, for every stock. The window and the typical move count closes, so an excluded
  session is simply absent; no decision is made on it.
- **Dividends.** A dividend is earned by the shares held at the start of the ex-date session (a position bought
  at that session's open is not entitled; one sold at that open is), with 15% withheld (HXR's assumption), and
  paid on the pay date (the ex-date when none is recorded). It belongs to the trade holding the shares on the
  ex-date and enters that trade's P/L, even if it is paid after the sale: a payment after the trade closed is
  recorded apart and added to that trade's P/L when the metrics are computed. A closed trade's record is never
  edited, and nothing is credited to a later trade in the same stock.
- **Missing bars.** A buy with no bar on its fill session is cancelled and recorded; a sell waits for the next
  bar. A stock's own closes are what the window, `m` and the counts of D3 use.

### 6c. Data and storage (as implemented)

- **Market data:** read at run time only, read-only, through HXR's data layer from `data/hxr-sim.sqlite`,
  which must be exactly that file in the configured data directory. **No new download**: the range-trend code
  downloads nothing; the data is what the HXR page downloaded (HXR EXPERIMENT-LOG entries 14 and 1-2). HXR's
  readiness check (with the owner's reviewed overnight moves) and its spread calibration must pass for the
  development period.
- **Results:** `data/range-trend-sim.sqlite`, range-trend's own database. Its file guard refuses the
  portfolio, demo, Strategy Lab and HXR files, and any file holding other tables. The ledger is append-only.
- **Hashes recorded with every run:** the config's hash and its pinned file hash, the code revision, the
  symbol metadata hash, the market-data hash, the spread-calibration hash, the protocol's hash, the index
  method of benchmark (a) and the HXR engine version used for the HXR hold arm.
- **Backups:** `createBackup` copies the database into `backups/range-trend` the same way as HXR's.
- **Stocks:** HXR's basket A (decision 10), read from `universe-hxr-v3.json` with its tech/AI tags (unused by
  range-trend: no tech/AI cap).
- **One live service instance per data directory:** a lock row in the results database (`rt_lock`, taken and
  released inside transactions, so the liveness check and a stale-row takeover are atomic and instances
  starting together cannot all hold it) refuses a second instance while one is open, so a live run is never
  marked failed; a row left by a process that is gone is taken over, and only then are interrupted runs
  recorded as failed; release deletes the row only when it is the caller's.
- **Every run is logged before the next starts:** the gate refuses a new run while any stored run, failed
  ones included, is missing from `EXPERIMENT-LOG.md`. The log is read outside code fences and HTML comments
  (a row inside either is not a row). A row is a practice-run record when its bold title mentions a practice
  run or when it carries a numeric run id ("run id:" followed by digits) anywhere, whatever its title; every
  record must have the form "**Practice run** run id: N, config hash: <64 hex>" or the gate refuses. Plain
  prose that mentions practice runs, or quotes the form with a placeholder, is not a record. `runPractice`
  returns the exact row to paste; a failed run's error carries it too.
- **One code revision for the practice runs:** the first practice run's `CODE_REVISION` is stored; a run under
  another revision is refused unless an owner-decisions row in `EXPERIMENT-LOG.md` names the new one (the
  change is recorded in the run's details).
- **The data directory** is `loadConfig().dataDir` (`SIGNAL_DESK_DATA_DIR`, by default `data/`); the hashes of
  the symbols, data and calibration are computed before the ledger slot is taken, so an interrupted or
  early-failed run keeps them; the slot, the run row and (at the first practice run) the protocol hash are one
  transaction. Tests may change the data directory, the protocol, the log or the hold config only with an
  explicit test flag, recorded in the run's details (`testOverrides`).

### 6d. Not inherited from HXR, and why

- **The account-decline pause.** In the HXR development records, the pause never ended in six base runs. It
  skipped 2,999 buy signals, and no close came back within US$750 of the peak
  (`strategy/hxr/reports/2026-10-26-diagnosis.md`, supplement a and d; one VWAP rerun did come back once,
  correction 7). The explanation, that a mostly-cash account rarely recovers while new buys are blocked, is a
  **hypothesis**.
- **The open-risk budget measured from current value.** HXR measures open risk as shares × (current close −
  exit level), so a rising winner uses up more of the budget. In the development records, all 121 base-run
  skips with no recorded binding cap fell on days with open risk above US$750 (diagnosis supplement e and the
  2026-10-27 corrections).
- **Instead, risk is measured at entry only** (6a): a winner never blocks a new buy by rising.

---

## 7. Success criteria (decision 7): not finalised, and not a precondition for building

### 7a. Tier 1: the code is correct

Synthetic data only. Must pass before any practice-run result is looked at. As of EXPERIMENT-LOG entry 12:
- every worked example in sections 3 and 6a reproduces, including the D2 and D3 cases;
- no look-ahead, future-change and determinism tests pass for every planned config;
- accounting: cash never goes below zero; account value = cash + holdings at every close, with holdings
  recomputed independently in the tests; every fill carries its costs; costs and dividends reconcile with the
  cash; one buy cost and one sell's proceeds with fees are pinned by hand;
- provenance is stored on every run;
- sizing is hand-checked, including several same-day signals and next-open gaps up and down;
- there is a scenario for every entry and exit, and for each of D1 to D4 and the watch rule;
- benchmark (a) and the exposure-matched hold are hand-checked on two stocks with a split and a dividend;
- the planted bugs of `scripts/rangetrend-planted.mjs` are each caught by a named failing test (the check
  requires a passing baseline first, judges a bug CAUGHT only when the run completes and a named assertion
  fails, and reports MISSED, INVALID and INCONCLUSIVE apart);
- the prefix-invariance, future-change and snapshot checks compare every journal, the watch and break journals
  included.

### 7b. Tier 2: exploratory usefulness

These are descriptions, not pass marks. Every threshold is **[OWNER TO CONFIRM]**.
- Each hypothesis's predicted behaviour is reported as appearing, not appearing, or insufficient.
- A comparison between two runs is read only if each run has at least **[30]** completed trades. Otherwise it
  is marked insufficient.
- Each result is also reported without the run's best 5% of outcomes (completed trades and positions open at
  the end, marked at the last close).
- Any single stock making more than **[40%]** of a run's net profit (the same outcomes) is flagged.
- Every run is compared with the exposure-matched hold (7c).
- Costs are reported as a metric, with no pass mark; so are the per-stock counts of D5.

### 7c. Tier 3: the evaluation

- Thresholds are **[OWNER TO SET]**, in `EVALUATION-THRESHOLDS.md`, which also holds keep or drop MU and the
  prospective journal's minimum length and completed-trade count before anything is concluded. That file is
  frozen, with its hash, before any evaluation result is accessed; the practice-run gate never reads it.

**Benchmarks** (computed with every run, outside the budget; each labelled):
- **(a) Buy and hold (D4, experimental choice): an equal-weight buy-and-hold index of the ten stocks,
  never rebalanced.** At the open of the run's first trading session (on or after the period's start),
  US$15,000 ÷ 10 is put into each stock with fractional shares and no costs (a stock without a bar at that open
  is bought at its first later open, and its share waits as cash at 0%). The weights drift and are never
  rebalanced. Splits multiply the shares, with no fraction paid out. Dividends are entitled by the shares held at
  the start of the ex-date session, credited net of 15% withholding on the pay date (the ex-date when none is
  recorded) and reinvested at that stock's close on the pay date, or at its next close if it has no bar that
  day. A stock with no bar on a day keeps its last close. The index has a value at every close of the run's
  equity series; `r(t) = I(t) ÷ I(t−1) − 1`, close to close. It is labelled **derived**: it is not an account
  that could be traded.
- **(b) Cash at 0%.** Labelled as cash. It is not an exposure-matched comparison.
- **(c) Exposure-matched hold (derived):**
  - `r(t)` = the index's return from close `t−1` to close `t`;
  - `f(t−1)` = the run's holdings ÷ its account value at close `t−1`;
  - `B(t) = B(t−1) × (1 + f(t−1) × r(t))`, with `B(0)` = US$15,000.

  It is labelled **derived**. It is frictionless in its own rebalancing (no costs or whole shares for moving
  between (a) and cash). Its `f` lags the run's own fills by part of a day: the run's positions change at the
  open, `f` is measured at the previous close.
- **HXR's whole-share hold arm** (`hxr-hold-0.1.0.json` run by the HXR engine on the same inputs: ten US$1,500
  sleeves, whole shares at raw prices with costs, idle sleeve cash, nothing sold) is still computed and reported
  beside (a), labelled as such. It is not the benchmark.

**The trade-off rule, exactly as `metrics.js` computes it.** For the run and for (c):
- *annualised return* = `(end ÷ start)^(1 ÷ years) − 1`, with `years` = the days from the first to the last
  equity point ÷ 365.25; it is undefined when the period is empty or the end value is not positive;
- *maximum drawdown* = the largest fall from a previous peak, as a fraction of that peak, with the peak starting
  at the starting cash (US$15,000), so a fall below the start counts from the start;
- *return per unit of drawdown* = annualised return ÷ maximum drawdown, undefined when the drawdown is zero
  or the return is undefined.

A rule **adds value beyond holding cash** when either:
- `beatsReturnWithoutDeeperDrawdown`: the run's annualised return is above (c)'s **and** its maximum drawdown is
  at most (c)'s; or
- `beatsReturnPerDrawdown`: the run's return per unit of drawdown is above (c)'s (both defined).

Sitting in cash lowers the worst fall by itself, so **a smaller drawdown alone earns no credit.** A rule that
loses to (c) on both adds nothing beyond holding cash. How much return to give up for a smaller drawdown than
the full buy-and-hold (a) is the owner's preference, and it is **still open**. The rule is reported, never
enforced.

**Per run, always reported:** net return after costs, maximum drawdown, average invested exposure and time in
cash, trade count and holding periods, turnover and costs, the counts of D5, the breaks by kind, and the
comparisons with (a), (b), (c) and the HXR hold arm.

**The pick rule** that chooses the candidate from the practice runs is open (D9). It is written in
`EVALUATION-PROTOCOL.md` before the first practice run, and it is never the ending balance alone. No automatic
winner selection is built.

---

## 8. Sequence

1. The owner's build approval (done 2026-10-26; first entry of `EXPERIMENT-LOG.md`).
2. Build, with the Tier 1 tests (done; EXPERIMENT-LOG entries 2 to 5).
3. The owner's decisions D1 to D8 (done 2026-10-27; EXPERIMENT-LOG entry 7) and their implementation (entry 8).
4. The owner writes D9 into `EVALUATION-PROTOCOL.md`: the pick rule and how the evaluation dates are chosen.
   The code refuses practice runs until both are there and no owner marker remains in that file.
5. The practice runs, within the budget, on separate instruction.
6. The owner completes and freezes `EVALUATION-THRESHOLDS.md`; the candidate is frozen; the protocol's hash,
   frozen since the first practice run, is recorded with them.
7. The evaluation, according to the protocol.
8. The local simulated prospective journal.

Once an evaluation result influences any change, that period becomes development data.

### 8a. Evaluation protocol

Decision 9 above is the owner's words. The options below are a proposal; the owner chose **C**.

- **(A) One historical run**, with **all** of section 1's disclosures, including HXR's reserved periods and the
  Strategy Lab's MU holdout window. It is a secondary evaluation, not independent evidence.
- **(B) A local simulated prospective journal only** (no broker account, no orders, no paper-trading API).
- **(C) Both** (the owner's choice).

**The rules:**
- `strategy/range-trend/EVALUATION-PROTOCOL.md` states, in its dedicated fields, the pick rule and how the
  evaluation dates are chosen (D9). It is written **before the first practice run**, so that no exploratory
  result influences those choices. `EVALUATION-THRESHOLDS.md` holds keep or drop MU (historical evaluation
  only), the Tier 3 thresholds and the journal minimums; it is frozen before any evaluation result is accessed
  and is never read by the practice-run gate.
- As implemented, practice runs are refused while either dedicated field is unset (empty, or containing the
  owner marker, "TBD", "TODO" or "?"), while any owner marker remains anywhere in the protocol, or while a
  field appears more than once; fields are read outside code fences and HTML comments only. **The protocol's
  hash is frozen at the first practice run and is final for the practice runs:** a later change refuses further
  runs until the file is restored to the frozen text. No new protocol version can reopen the practice runs.
- **The freeze moment of the protocol is the first practice run.** Before any evaluation result is accessed,
  that same protocol hash is recorded in `EXPERIMENT-LOG.md` together with the chosen candidate's config
  hash, `EVALUATION-THRESHOLDS.md`'s hash and the code revision: a record of the frozen state, not a new
  freeze (`EVALUATION-PROTOCOL.md` says the same).
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

## The owner's decisions D1 to D8 (recorded) and D9 (open)

Each of D1 to D8 was decided by the owner on 2026-10-27 (`EXPERIMENT-LOG.md` entry 7) as an experimental
choice and is built into the eight `rt-*-0.2.0.json` configs (entry 8). D9 is written by the owner into
`EVALUATION-PROTOCOL.md`'s dedicated fields; practice runs stay refused until then.

| | Decision (experimental choice) | Where |
|---|---|---|
| D1 | Re-entry: no stock is ever retired; the "-limit" variants refuse a signal whose decision close is at or above `P` and cancel a fill at or above `P`; the "-nolimit" variants never use `P` | Section 2.4 |
| D2 | Recovery entry: also needs an up close, and no top-zone close since the last close of the bottom visit (today's included) | Section 3 |
| D3 | Broken range: a confirmed breakdown, a breakout, a range trade's breakdown exit or its conversion is a confirming close; the range is qualified again only on a window entirely after it; the earliest entry is the stock's 61st close after the confirming close; no other retirement period | Sections 3, 4 |
| D4 | Benchmark (a): an equal-weight buy-and-hold index with fractional shares, never rebalanced, dividends reinvested; HXR's whole-share hold arm reported beside it | Section 7c |
| D5 | Whole shares at raw prices on a US$15,000 account, accepted; the effects reported per stock | Section 6a |
| D6 | Eight runs plus one verified-defect reserve; no combination runs | Section 6 |
| D7 | No HXR diagnostic (H6 dropped) | Section 5 |
| D8 | The settings of section 2.3 and the definitions of section 3 accepted as experimental, with D2 and D3 | Sections 2.3, 3 |
| D9 | **Open:** the pick rule and the rule for choosing the evaluation dates, in `EVALUATION-PROTOCOL.md` | Sections 2.2, 8a |

Also open: `EVALUATION-THRESHOLDS.md` (keep or drop MU before any historical evaluation, the Tier 3
thresholds, the journal minimums), the Tier 2 thresholds ([30] completed trades, [40%] single-stock share), the
return-against-drawdown preference (7c), and a separate instruction to start the practice runs.
