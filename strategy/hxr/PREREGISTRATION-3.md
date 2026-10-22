# HXR — pre-registration 3 (version hxr-prereg-3)

Written 2026-10-22, **before any HXR backtest, simulation or result
existed**. No HXR rule has been run on real data under any pre-registration,
and no selection, validation or final run exists. The git commit that adds
this file, before any code for it, is the evidence of when it was fixed.

hxr-prereg-3 brings hxr-prereg-2 in line with the owner's work order of
2026-10-22. It changes five things, listed in §0. Everything else in
`PREREGISTRATION.md` (hxr-prereg-1) and `PREREGISTRATION-2.md`
(hxr-prereg-2) stays in force by reference, exactly as before. Both earlier
files stay on disk unchanged.

**One item is deliberately left open:** the fresh-entry policy after a
missed rebound (§8). The owner chooses it. The choice is recorded as
amendment **hxr-prereg-3a** before any run, and nothing runs until then. The
candidate configs carry the value `pending_owner_choice`, which the code
must refuse to run.

Simulation only. No real money, no brokerage or paper-trading connection, no
order sent anywhere, no reminders or notifications. The consolidation-breakout
strategy and its holdout are not touched.

## 0. What changes, and what does not

| Item | hxr-prereg-2 | hxr-prereg-3 |
|---|---|---|
| Position size | equal sleeves of 1/N; a buy-back spends the whole sleeve | risk-sized from available cash, the planned exit distance and a dollar risk budget (§1); sale proceeds return to pooled cash and are never reinvested in full automatically |
| Initial loss | none (X1 and X3 had no exit before their first level) | a separate initial-loss rule for every exit rule (§2) |
| Periods | selection, evaluation | development, validation, final (used once) (§3) |
| Main test list | basket A of 6; INTC, CSCO, PYPL, SNAP reported only | basket A of 10, including the four laggards (§4) |
| Fresh entry after a missed rebound | stay in cash | **open: the owner's choice** (§8) |

**Unchanged:** the exit rules X1, X2 and X3 and the recovery-point
definition (prereg-2 §3.1–3.4); the buy-back signal and its price ceiling
(prereg-2 §3.5, steps 2 and 3); decisions after the close and fills at the
next open; costs, dividends, splits, excluded sessions (prereg-1 §3–5, §7);
the hold comparison; GOOG; criteria G1–G5 and P1–P4; X3 as a comparison
that can never be picked; the experimental defaults of prereg-2 §1 other
than the ones replaced here.

## 1. Position sizing and the risk budget

### 1.1 Experimental dollar defaults (not the owner's approved limits)

The owner's loss limits, position sizes and total risk budget are **not
established**. These are labelled research assumptions on the simulated
US$15,000, so that the test can run. Every one is a config value.

| Budget | Default | Meaning |
|---|---|---|
| Planned loss per trade | **US$150** (1% of starting cash) | the most a position is planned to lose if it exits at its initial-loss level |
| Maximum position size | **US$3,000** (20%) | cost of one position at the decision close |
| Total open risk | **US$750** (5%) | the sum over open positions of what each would still lose at its current exit level, plus the planned loss of pending buys |
| Maximum combined tech/AI exposure | **US$10,500** (70%) | market value of positions tagged `techAi` in `universe-hxr-v3.json`, plus pending tagged buys at cost |
| Account decline that pauses new entries | **US$1,500** (10%) below the highest account value since the period start | no new buys of any kind while paused; exits still run |
| Decline at which entries resume | **US$750** (5%) | the pause ends once the decline is back at or below this |
| Smallest position taken | half the planned loss per trade (**US$75** of planned loss) | a budget that leaves less room than this means the signal lapses |

Why these shapes: a per-trade loss sets how much one mistake costs; the
total open risk and the tech/AI cap limit how many such mistakes can be live
at once and how correlated they are; the decline pause stops the account
from adding risk while it is already losing. None of the numbers is tuned;
all are conventional round values fixed now.

### 1.2 How a buy is sized

At the close of the decision session `t`, for a buy signal in stock `s`
(initial allocation, a stock never held yet, a buy-back, or a fresh entry
under §8) with close `c` and typical daily move `m = m(t)`:

1. **Not paused.** If the account is paused (§1.4), no buy. The signal
   lapses and is journalled as `entry_skipped: paused`.
2. **Planned exit distance.** `d = initialLoss.multiple × m` per share
   (§2), in dollars. This is what sizing risks, whatever exit rule the
   candidate uses.
3. **Shares.** `n` is the largest whole number with all of:
   - `n × d ≤ plannedLossPerTrade`;
   - `n × c ≤ maxPosition`;
   - `n × d ≤ totalOpenRisk − openRiskNow − pendingPlannedLoss` (the room
     under the total open-risk budget);
   - if `s` is tagged `techAi`: `n × c ≤ maxTechAiExposure − techAiNow −
     pendingTechAiCost`;
   - `n × c × (1 + k) + buy fees ≤ availableCash`, where `availableCash` is
     pooled cash less the cost reserved by pending buys, and `k` is the
     half-spread plus slippage.
4. **Minimum.** If `n × d < 0.5 × plannedLossPerTrade`, the signal lapses
   (`entry_skipped: budget`, with every number). A lapsed buy-back signal is
   not retried: the sleeve waits for the next recovery point under the same
   rules.
5. **Order.** Otherwise a buy of `n` shares is placed for the next open,
   reserving `n × c × (1 + k)` of cash and `n × d` of open risk and, if
   tagged, `n × c` of tech/AI exposure. At the fill, if the open is higher
   and the reserved cash cannot pay for `n` shares, `n` is reduced to what
   the available cash pays for (never below 1; otherwise cancelled and
   journalled). The planned loss is recomputed from the actual fill (§2).
6. **Several signals on one session** are sized in **alphabetical order of
   ticker**, each seeing the room left by the ones before it. This order is
   arbitrary and fixed now; it does not favour the owner's holdings.

**Open risk** of a held position at a close is
`shares × max(0, c − effective exit level)` (the effective level is the
higher of the initial-loss level and the rule's own level, §2). It falls to
zero as the exit level rises above the price, freeing budget for new
entries.

### 1.3 The initial allocation (period start)

Every stock in the basket has a buy signal at the period's first session.
Because the budgets cannot hold all ten at full size, the initial allocation
is sized differently from every later buy, and only then:

- each stock's planned loss is **`totalOpenRisk / N`** (US$75 with ten
  stocks), not the per-trade planned loss;
- the other caps (position size, tech/AI, cash, alphabetical order) apply
  as in §1.2;
- the half-size minimum is met by construction.

So the test starts with every stock held at about half size where the caps
allow, and later buys are sized by §1.2. The hold comparison is unchanged:
fully invested, equal money in each stock, US$1,500 each with ten stocks.

### 1.4 The account-decline pause

- `peak` is the highest end-of-session account value (cash plus holdings at
  the close) since the period start, starting at the starting cash.
- The account is **paused** from the first close where
  `peak − value ≥ pauseDeclineUsd`, and **resumes** at the first close where
  `peak − value ≤ resumeDeclineUsd`. Both are journalled.
- While paused: no buy of any kind. Exits run as normal. A pending buy whose
  fill session comes while the account is paused is cancelled and journalled
  (this matters only in the two-session-delay stress variant).

### 1.5 Cash

Cash is **pooled** across stocks (prereg-1 §3's per-stock sleeves apply only
to the hold comparison from now on). Sale proceeds and dividends go to the
pool. A buy-back or any other buy is sized by §1.2, so proceeds are never
reinvested in full automatically. Cash earns 0% (unchanged).

**Consequence, disclosed now:** the HXR arm holds much more cash than the
hold arm by construction. That lowers its return in rising markets and its
decline in falling ones. The criteria compare return per unit of decline,
which is the fairest single comparison available; the report also shows the
average invested fraction and the return on average invested capital, as
information only.

## 2. The initial-loss rule (every exit rule)

Applied to X1, X2 and X3 alike, from the buy fill:

- **Level.** `L0 = E − initialLoss.multiple × m(t_decision)`, where `E` is
  the effective buy price (after spread and slippage) and `m(t_decision)` is
  the typical daily move at the decision close that sized the position. It
  **never moves**, and it is divided by the ratio at a split like every other
  price.
- **Default multiple: 2.5** (experimental). Drafted as 2.5 × ATR in
  `DRAFT-hxr-0.1.md`; measured on closes here, as every rule is.
- **Exit.** At every close while holding, the position's **effective exit
  level is the higher of `L0` and the candidate rule's own level** (X1's
  recovery-point level once it exists, X2's allowance level, X3's give-back
  level once active). Exit when the close is below the effective level; X3's
  own test stays "at or below" its level, as pre-registered.
- **Planned loss at the fill** = `n × (E − L0)` = `n × d`, recorded with
  the fill. Because `L0` is set from the actual fill, a higher open does not
  raise the planned loss.
- **What it closes.** X1 and X3 no longer have a holding with no exit at
  all; X2 gains a floor under its allowance.

## 3. Periods: development, validation, final

`periods-hxr-v3.json`, NYSE calendar, warm-up from 2016-01-04, 100-session
warm-up before each period (unchanged), the same four excluded sessions.

| Period | Dates | Use |
|---|---|---|
| **Development** | 2017-10-02 to 2021-12-31 | run every arm; pick the candidate (§5); neighbouring settings reported. In-sample. |
| **Validation** | 2022-01-03 to 2023-12-29 | run the frozen pick and the hold once; the validation gate (§5). Includes the 2022 decline. |
| **Final** | 2024-01-02 to 2026-10-21 | **one run** of the frozen pick; G1–G6; PASS, FAIL or INSUFFICIENT EVIDENCE. Never used before the validation gate passes. |
| Full-list check | 2025-03-18 to 2026-10-21, basket B | reported with the final run, not a gate (unchanged) |
| Prospective | from the first session after the start | unchanged |

2017-10-02 is still the first session after VST's 100 sessions of warm-up;
SNAP (listed 2017-03-02) is ready earlier. Each period starts a fresh
US$15,000 account for every arm.

**Disclosure.** The final period overlaps the consolidation-breakout
strategy's untouched holdout window for MU (prereg-1 §7, disclosure 1; the
pending MU decision stands). The owner has watched all of these stocks
through 2026, so no historical period is truly unseen; only the prospective
account is clean evidence.

## 4. The main test list now includes the four laggards

`universe-hxr-v3.json`: **basket A = MU, AMZN, META, TSLA, VST, GOOG,
INTC, CSCO, PYPL, SNAP** (ten stocks). Basket R is removed. Basket B (the
full-list check) and the prospective basket are basket A plus MUU, NBIS and
HOOD (thirteen; fourteen with SPCX once confirmed).

What else changes because they join:

1. **The hold comparison** is equal money in ten stocks (US$1,500 each),
   so it now includes the stocks that lagged. Holding will look worse than
   with the owner's six. This is deliberate: the list is now the owner's
   winners plus four known laggards, and it is still **not a random sample**
   of anything. Both halves were chosen with hindsight (prereg-2 §5).
2. **G6 (not one stock)** is restated for ten stocks: **G3 passes in at
   least 9 of the 10 leave-one-stock-out runs** (`criteria-hxr-v3.json`).
   "At most one stock may fail" is kept.
3. **Sleeves and sizing.** With ten stocks and the budgets of §1, the account
   cannot hold all ten at full size. §1.3 defines the start; the budgets
   decide the rest. This is the main practical effect of the larger list.
4. **Tech/AI exposure.** All four laggards are tagged `techAi`, so the cap
   binds more often. Tags are in §6.
5. **Readiness** must pass for all ten: listings and corporate actions for
   INTC, CSCO and PYPL are unverified until the checklist runs (PYPL's 2015
   spin-off from eBay is before the data start). SNAP is NYSE-listed, so the
   excluded sessions apply to it.
6. **Thresholds** (10 round trips to qualify, 20 for G1, 500 sessions) are
   unchanged, although ten stocks produce more trades than six.
7. **The neighbour and VWAP-fill runs** cover ten stocks, so each run takes
   longer. Nothing else in the mechanics changes.
8. **The prospective basket** grows to thirteen (fourteen with SPCX), so
   the initial allocation there is also budget-limited.

## 5. Selection, the validation gate and the final run

1. **Development: pick one candidate.** Run the hold, X1, X2 and X3 (each
   also with first-15-minute VWAP fills, reported). A candidate (X1 or X2
   only) qualifies with at least 10 completed exit-and-buy-back round trips.
   Pick the qualifying candidate with the highest annualised return ÷ largest
   decline; a tie goes to the smaller decline. **If neither reaches 1.10 ×
   the hold's ratio, stop**: HXR has no candidate worth validating. The pick
   is frozen as `hxr-1.0.0`.
2. **Validation gate**, one run of the frozen pick and the hold:

   | | Condition |
   |---|---|
   | V1 | at least 10 completed round trips (else: insufficient evidence; stop) |
   | V2 | annualised return ÷ largest decline ≥ 1.10 × the hold's |

   Failing V1 or V2 **stops HXR before the final period is used**. The
   outcome is reported as "did not validate".
3. **Final period**, one run of the frozen pick: criteria G1–G6 exactly as
   `criteria-hxr-v2.json`, except G6's count (§4). A repeat needs a written
   reason, is marked contaminated and can never pass.
4. **Neighbouring settings** (prereg-2 §4) are run on development only,
   reported only. Added neighbours for the new rules: initial-loss multiple
   2.0 and 3.0; planned loss per trade US$100 and US$200. That is 16
   neighbour runs per candidate. None is ever used for the pick.
5. **Every tested variation** is in the experiment log and the ledger.

## 6. Tech/AI tags (`universe-hxr-v3.json`, field `techAi`)

Tagged: MU, AMZN, META, TSLA, GOOG, INTC, CSCO, PYPL, SNAP, MUU, NBIS, HOOD
and, once confirmed, SPCX. **Not tagged: VST** (a power producer; its link
to AI demand is real but it is not a technology company).

The owner may change any tag **before the first run**, as a logged
amendment. The tag affects only the exposure cap.

## 7. Reporting additions (information only)

Beside everything in prereg-1 §11 and prereg-2 §4–5:

- position sizes at entry, and how often each cap was the binding one;
- signals that lapsed for budget or pause reasons, by reason;
- stocks never entered, and how long each waited;
- open risk and tech/AI exposure over time (average and maximum);
- pause episodes: dates, depth, length;
- the average invested fraction and the return on average invested capital;
- exits at the initial-loss level, counted apart from rule exits.

## 8. Fresh entry after a missed rebound: the owner's choice (open)

A "missed rebound" is when, after an exit at price `P`, the stock closes at
or above `P` before any buy-back signal (prereg-2 §3.5 step 1). What
happens next is **not decided here**. The options, each fully specified so
the chosen one can be dropped in without further design:

| Option | Rule | For | Against |
|---|---|---|---|
| **A. Stay in cash** | The stock gets no further entry for the rest of the period. (The hxr-prereg-2 default.) | Simplest. No new judgment is modelled. It matches the owner's behaviour literally: a buy above the sale price needs a new investment case, which cannot be replayed. | One missed rebound retires the stock for years, so in long uptrends HXR is structurally underexposed and the comparison with holding is harsh. It also wastes the budget that the stock would have used. |
| **B. Fresh entry at a new recovery point above the sale price** | The stock is treated as never held: it may enter at the next confirmed recovery point (prereg-2 §3.1) at any price, sized by §1.2, with a new initial-loss level. | Keeps the stock in play with the same mechanical signal used everywhere else, so no new parameter. It stands in for the owner's step 1 (a new entry assessment) after the stock has shown a new low and a rise. | It buys higher than it sold, the very thing the buy-back rule avoids. In a choppy market it can whipsaw: enter, exit at the initial loss, re-enter, and each cycle pays costs. |
| **C. Fresh entry after a cooling-off period** | As B, but only after at least **N = 60** of the stock's sessions out (about three months). The first recovery point confirmed after that counts. | The wait damps whipsaw and roughly matches the time a real re-assessment takes. | N is arbitrary; a rise during the wait is missed entirely; it adds a parameter that could later be blamed for a result. |

**Also applies to stocks never held yet.** A stock that the budget kept out
at the period start, or whose buy lapsed for budget reasons, enters at the
**next confirmed recovery point at any price**, sized by §1.2. That rule is
fixed here (there is no sale price to anchor to). If the owner chooses A, a
missed-rebound stock is retired while a never-held stock can still enter;
the difference is stated so the owner can object.

**Recording the choice.** The owner's option (A, B or C; with N if C) is
written as amendment hxr-prereg-3a in `EXPERIMENT-LOG.md` and into each
candidate config's `rule.afterMissedRebound` (`stay_out`,
`fresh_entry_recovery_point` or `fresh_entry_after_sessions` with
`freshEntryMinSessions`), **before any run** and with results seen: no.

## 9. Files fixed by this pre-registration (hashed set `hxr-prereg-3`)

| File | Status |
|---|---|
| `PREREGISTRATION.md`, `PREREGISTRATION-2.md` | unchanged, in force by reference |
| `PREREGISTRATION-3.md` | this file |
| `ENGINE-SPEC.md` | to be updated in the code commit; the code must match §1–§2 and §8 |
| `universe-hxr-v3.json` | basket A of ten; `techAi` tags; basket R removed |
| `periods-hxr-v3.json` | development, validation, final, full-list, prospective |
| `criteria-hxr-v3.json` | G6 = 9 of 10; the validation gate V1–V2; everything else as v2 |
| `configs/hxr-hold-0.1.0.json` | unchanged (the hold comparison) |
| `configs/v3/hxr-x1-0.3.0.json`, `hxr-x2-0.3.0.json`, `hxr-x3-0.3.0.json` | new: the prereg-2 rules plus the `risk` and `initialLoss` sections and `account.allocation = risk_sized`; `rule.afterMissedRebound = pending_owner_choice` until amendment 3a. Kept under `configs/v3/` until the code step registers them, so the current code never lists them. |

The v2 lists, criteria and 0.2.0 configs become superseded files, like
prereg-1's C1–C3, and are never run.

## 10. Disclosures specific to this version

- Written after the consolidation-breakout results and after
  `DRAFT-hxr-0.1.md` and hxr-prereg-2. No HXR rule outcome has been computed
  or seen under any version.
- The dollar budgets, the initial-loss multiple, the pause levels and the
  half-size minimum are untested round numbers. They shape the result as
  much as the exit rules do, and they will be reported as such.
- Risk sizing on ten stocks under these budgets keeps the account partly in
  cash by construction (§1.5).
- Including the laggards makes the hold benchmark deliberately weaker (§4).
