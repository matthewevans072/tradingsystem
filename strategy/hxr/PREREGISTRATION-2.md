# HXR — pre-registration 2 (version hxr-prereg-2)

Written 2026-10-22, **before any HXR backtest, simulation or result
existed**. No HXR rule has been run on real data, and no selection or
evaluation exists. The git commit that adds this file, before any code for
it, is the evidence of when it was fixed.

hxr-prereg-2 **replaces hxr-prereg-1's candidates C1–C3** with the exit
rules and the single buy-back rule from `DRAFT-hxr-0.1.md`, merged into the
existing HXR module. The owner instructed this on 2026-10-22.
`PREREGISTRATION.md` (hxr-prereg-1) stays on disk unchanged as the earlier
version; nothing was ever run under it.

Simulation only. No real money, no brokerage or paper-trading connection, no
order sent anywhere, no reminders or notifications. The consolidation-breakout
strategy and its holdout are not touched: HXR never reads the Strategy Lab
database.

## 0. What stays exactly as in hxr-prereg-1

The following sections of `PREREGISTRATION.md` apply unchanged and are part
of this pre-registration by reference.

| Section | Contents |
|---|---|
| §1 | Hold–exit–re-enter structure, no news in the historical test, compared with holding the same stocks from the same US$15,000 |
| §2 | Stocks, listings, baskets A and B, SPCX pending confirmation, NBIS only from 2024-10-21. The baskets are now in `universe-hxr-v2.json`, which adds **GOOG** to every basket (§1a) and basket R (§5). |
| §3 | Account: equal sleeves, whole shares, no borrowing or shorting, cash 0%, dividends on the pay date with 15% withholding, splits |
| §4 | Decisions after the close; fills at the next session's open (one session of delay); gaps taken at the gapped open; no intraday stop; first-15-minute VWAP fills reported |
| §5 | Costs: US$0 commission, SEC fee, FINRA TAF, calibrated half-spread, 2 bps slippage, no currency conversion; stress versions |
| §7 | Periods (selection 2017-10-02 to 2022-12-30; evaluation 2023-01-03 to 2026-10-21; full-list check; prospective), the excluded sessions, and **all disclosures**, including the pending MU decision and that no historical period is truly unseen. The periods are now in `periods-hxr-v2.json`, which adds only the two robustness periods (§5 below). |
| §8 | Selection procedure, with the change in §4 below on which rules may be picked |
| §9 | Prospective simulated account (news recorded, never used for decisions) |
| §10 | Pass/fail criteria G1–G6 and prospective P1–P4. They are now in `criteria-hxr-v2.json`, identical except G6, which is restated for six stocks (§1a). |
| §11–12 | Report contents and the rules for changing anything |

## 1a. GOOG added (owner, 2026-10-22, before any test)

The owner added **Alphabet Class C (GOOG, Nasdaq)** to the HXR stock list
before any HXR test.

- **History.** It is in baskets A, B and prospective, with history from
  2016-01-04 (data start; Class C has traded since 2014).
- **Split.** A 20-for-1 split was distributed after the close on
  2022-07-15; split-adjusted trading began on 2022-07-18. The readiness check
  confirms the date against Alpaca's corporate actions; prereg-1's split rules
  apply.

What this changes:

- **Basket A** becomes MU, AMZN, META, TSLA, VST and GOOG: **six sleeves of
  US$2,500**.
- **Basket B and the prospective basket** become nine stocks (ten with SPCX
  once confirmed). That is nine sleeves of about US$1,666.67, with the cents
  split as in prereg-1.
- **G6 is restated as "G3 passes in at least 5 of the 6
  leave-one-stock-out runs"** (`criteria-hxr-v2.json`). prereg-1 allowed one
  of five runs to fail; this keeps "at most one stock may fail". Nothing else
  in the criteria changes.
- **Selection starts on 2017-10-02 as before,** because VST's warm-up
  still sets it.

GOOG has the same hindsight issue as the other holdings (prereg-1 §7
disclosure 3): it was added in 2026, knowing its history.

## 1. Experimental defaults (the owner's questions are still open)

The owner's risk questions in `DRAFT-hxr-0.1.md` §10 are unanswered. On
2026-10-22 the owner told me not to wait and to use these **clearly
labelled experimental defaults**. None of them is the owner's approved
preference.

| Topic | Experimental default | Why it matters |
|---|---|---|
| When decisions are made | Once a day, after the close. No intraday trigger. | An intraday stop exits sooner in a crash but also on brief dips; it is not tested here. |
| Earnings | Hold through earnings. No earnings dates are used. | Earnings gaps hit exits and buy-backs alike. |
| News | No news rules in the historical test | Historical results test price rules only |
| Stocks | `universe-hxr-v2.json`: basket A for selection and evaluation, as in prereg-1 | The owner's current holdings, which favours stocks that did well (§7 disclosure) |
| Costs | US$0 commission, USD account (no currency conversion) | Converting CAD each way would cost about 1.5% per conversion and is not modelled |
| Initial loss limit | **None.** The owner's loss limit is not established. | X1 and X3 have no exit at all until their first level exists (§3); X2 is active from the day of buying. |
| After a missed rebound | Stay in cash for the rest of the period (§3.5) | This literal reading probably **favours holding** in rising markets. The alternative, a new entry above the exit price, needs an investment-case judgment that cannot be replayed. |

## 2. Terms

| Term | Meaning here |
|---|---|
| Close | The split-adjusted closing price of the stock's own sessions (sessions with a bar for that stock), as in prereg-1 |
| Typical daily move, `m(t)` | The mean of the absolute close-to-close changes over the stock's last 20 changes ending at session `t`. It needs 21 closes. This is the same measure as prereg-1's C2. |
| Recovery point | An earlier low close from which the price rose again (§3.1) |
| Buy fill session / sell fill session | The session whose open filled the sleeve's last buy or sell (the initial allocation counts as a buy at the selection or evaluation start) |
| Effective price | The fill price after the half-spread and slippage, before fees |

**Why closes and not daily lows or ATR**, which `DRAFT-hxr-0.1.md` proposed:

- **Data quality.** Daily highs and lows can be set by single off-market
  trades. The consolidation-breakout readiness audit found such prints on
  the consolidated tape. prereg-1 used closes for the same reason.
- **Consistency.** One measure of normal movement across all rules keeps the
  candidates comparable.

## 3. The rules (fixed now, never tuned)

Every rule is evaluated after a session's close, from closes up to and
including that session. An order fills at the next session's open, as in
prereg-1 §4. Numbers are conventional round values chosen before any result.

### 3.1 Recovery point (used by X1 and by the buy-back rule)

At the close of session `t`, look at the session `i` that is **5 of the
stock's sessions earlier**. Session `i` is a confirmed recovery point if both
hold:

1. Its close is **strictly lower** than each of the 5 closes before it and
   each of the 5 closes after it (sessions `i−5` to `i−1` and `i+1` to
   `i+5 = t`).
2. The highest of the 5 closes after it is **at least 1.0 × m(t)** above its
   close: the price rose again by at least one typical daily move.

**A recovery point exists only from the close of `t = i + 5`.** Before then
no rule can see it, so no future recovery is used to identify a low. Checking
needs at least 21 closes (for `m(t)`); the 11 closes of the window are
covered by those.

### 3.2 X1 — break below a recovery point, judged at the close (`recovery_break`)

| | |
|---|---|
| Exit level `L` | Empty at each buy fill. At each close while holding, if a recovery point `i` on or after the buy fill session is confirmed, compute `close(i) − 0.5 × m(t)`. `L` becomes the larger of `L` and that value, so it **only rises**. |
| Exit | when the close is **below** `L` |
| Before the first such recovery point | no exit (no initial loss limit, §1) |
| Parameters | window 5 sessions, rebound 1.0 × m, buffer 0.5 × m, m over 20 changes |

### 3.3 X2 — normal-movement allowance below the highest close (`move_allowance`)

| | |
|---|---|
| Exit | when the close is **below** `H − 3 × m(t)` |
| `H` | the highest close since the buy fill session, inclusive |
| Active | from the buy fill session, once 21 closes exist |
| Parameters | multiple 3, m over 20 changes |

The exit is identical to prereg-1 C2's exit; only the buy-back differs.

### 3.4 X3 — give back 10% of the peak gain (`giveback`), comparison only

| | |
|---|---|
| `E` | the sleeve's effective buy price |
| `H` | the highest close since the buy fill session, inclusive |
| Activation | once some close has `H ≥ E + 3 × m(t)` on that session. It stays active until the next sell. Without activation a tiny gain would make the rule exit on noise. |
| Exit | when active and the close is **at or below** `E + 0.90 × (H − E)` |
| Before activation | no exit (no initial loss limit, §1) |
| Parameters | give-back 10% (the owner's idea, never varied), activation 3 × m, m over 20 changes |

**X3 is a comparison only.** The owner called it a comparison candidate, not
the selected rule, so it is run and reported in the selection but can never
be picked or frozen (§4).

### 3.5 The one buy-back rule (used after every exit, by X1, X2 and X3)

After a rule exit filled at effective price `P` (split-adjusted to current
share units), at each close while out, in this order:

1. **Missed rebound.** If the close is **at or above `P`**, the rebound is
   missed. It is journalled with the date and close, and the sleeve stays in
   cash for the rest of the period, with no further decisions.
2. **Buy-back signal.** Otherwise, if a recovery point (§3.1) on or after the
   sell fill session is confirmed, a buy order is placed for the next open.
   **It fills only if its effective buy price is below `P`.** If not (for
   example a gap up), the order is cancelled and journalled, and the sleeve
   keeps waiting under steps 1 and 2.
3. A buy-back uses all of the sleeve's cash, in whole shares, as in prereg-1.
   The exit rule then starts again from that buy fill.

A sleeve that is out without a rule exit can never buy back, because it has
no `P`. This happens if a split cashed it out or its initial buy could not
fill. It is journalled.

### 3.6 Hold

Unchanged from prereg-1: the comparison arm, fully invested from the start
with no signals.

## 4. Selection (prereg-1 §8, with the arms replaced)

- Run the hold, X1, X2 and X3 on basket A over the selection period, at base
  costs. Every arm is also run with first-15-minute VWAP fills, reported
  only.
- **Only X1 and X2 may be picked.** A candidate qualifies with at least 10
  exit-and-buy-back round trips across its sleeves.
- The pick is the qualifying candidate with the highest annualised return ÷
  largest decline; a tie goes to the smaller decline.
- **If neither reaches 1.10 × the hold's ratio, stop.** HXR is then reported
  as having no candidate worth evaluating, and the evaluation period stays
  unused.
- X3 is shown beside them as the owner's comparison and never qualifies.
- The pick is frozen as `hxr-1.0.0`, as in prereg-1.

**Neighbouring settings** (reported only, in-sample, never used for the
pick). Each selectable candidate is also run with one setting changed at a
time:

| Candidate | Neighbours |
|---|---|
| X1 | window 3 and 8; rebound 0.5 and 1.5; buffer 0.25 and 1.0 |
| X2 | multiple 2.5 and 3.5; window 3 and 8 and rebound 0.5 and 1.5 (both used by the buy-back rule) |

That is 12 neighbour runs. The report says whether each one leads to the
same conclusion as its base candidate against the hold.

## 5. Robustness list (optional, reported only)

`universe-hxr-v2.json` adds **basket R**: **INTC, CSCO, PYPL and SNAP**.
These are technology stocks chosen **with hindsight, on purpose**, because
they are widely known to have lagged over much of 2017–2026. Basket A is the
owner's current holdings, which favours stocks that did well; basket R shows
how the same rules behave where holding did poorly.

- **Runs.** Basket R is run with the same dates as the selection (every arm)
  and as the evaluation (the frozen pick and the hold). It uses equal sleeves
  of the same US$15,000, the same costs and the same rules.
- **Never decisive.** It is **reported only**: never used for the pick,
  never a pass/fail gate, and never able to stop a run. If basket R is not
  ready, it is recorded as not run, with the readiness reasons.
- **Listings and corporate actions are unverified** until the readiness
  checklist runs. SNAP's start is its 2017-03-02 IPO; it is NYSE-listed, so
  the excluded sessions apply to it.

## 6. Pass/fail (unchanged except G6's count)

G1–G6 and P1–P4 from `criteria-hxr-v2.json` apply to the frozen
pick against the hold on basket A in the evaluation period. Outcomes are
PASS, FAIL or INSUFFICIENT EVIDENCE. PASS means eligible for the owner's
review only. It is never permission to trade and never connects anything.

`DRAFT-hxr-0.1.md` §5.5 proposed different criteria (E1–E5). They are not
adopted: G1–G6 already require a smaller decline, a better return per unit
of decline, limited return given up, robustness to costs and delay, and no
single-stock dependence. The draft gave no reason that outweighs keeping
criteria fixed before any result. The draft's other report items (missed
rebounds, unsuccessful buy-backs, time in cash, per-stock results) are
already in prereg-1 §11. Neighbour sensitivity is added as reported only
(§4).

## 7. Additional disclosures

- **Seen so far.** This pre-registration was written after the
  consolidation-breakout results and after `DRAFT-hxr-0.1.md`. No HXR rule
  outcome had been computed or seen.
- **Hindsight in the robustness list.** The robustness list is chosen with
  hindsight (§5), so it is reported only.
- **The stay-in-cash default** after a missed rebound is a literal reading of
  the owner's stated behaviour. It probably makes HXR look worse than a
  trader who would buy again on a new investment case.
- **X1 and X3 have no initial loss limit.** A position that falls straight
  after buying is not exited until a level exists, so their worst losses can
  exceed X2's.

## 8. Files fixed by this pre-registration (hashed set `hxr-prereg-2`)

| File | Status |
|---|---|
| `PREREGISTRATION.md` | unchanged, referenced |
| `PREREGISTRATION-2.md` | this file |
| `ENGINE-SPEC.md` | updated with the new rule types in the code commit; the code must match §3 |
| `universe-hxr-v2.json` | GOOG added to every basket (§1a); basket R added |
| `periods-hxr-v2.json` | robustness periods added |
| `criteria-hxr-v1.json` | unchanged, superseded |
| `criteria-hxr-v2.json` | G6 restated for six stocks (§1a); otherwise identical |
| `configs/hxr-hold-0.1.0.json` | unchanged |
| `configs/hxr-x1-0.2.0.json` | new, selectable |
| `configs/hxr-x2-0.2.0.json` | new, selectable |
| `configs/hxr-x3-0.2.0.json` | new, comparison only |

prereg-1's C1–C3 configs stay on disk as superseded files. They are not in
the hxr-prereg-2 set and are never run under it.
