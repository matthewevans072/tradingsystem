# HXR — amendment 3a to pre-registration 3 (hxr-prereg-3a)

Written 2026-10-22 on the owner's instruction, **before any HXR run under
any pre-registration**. The git commit that adds this file, before the code
for it, is the evidence of when it was fixed. It amends `PREREGISTRATION-3.md`
(hxr-prereg-3); everything there not changed below stays in force, as do
`PREREGISTRATION.md` and `PREREGISTRATION-2.md` by reference.

The owner called this the last change before testing. **One point is still
open** (§2): the owner's text kept both development pick rules. Both are
implemented; the choice is recorded as amendment 3b before any run, and the
selection run is refused until then. Nothing else waits on it.

Simulation only. No real money, no broker or paper-trading connection, no
order sent anywhere, no reminders or notifications.

## 1. Fresh-entry policy: all three options are tested, as separate candidates

The fresh-entry policy after a missed rebound (prereg-3 §8) is not chosen.
Instead each of options A, B and C is combined with each selectable exit
rule, giving **six candidates** in the development period:

| Candidate | Exit rule | After a missed rebound |
|---|---|---|
| X1A | X1 recovery-point break | A: stay in cash for the rest of the period |
| X1B | X1 | B: fresh entry at the next recovery point, at any price, treated as never held |
| X1C | X1 | C: as B, but only after 60 of the stock's sessions out |
| X2A | X2 normal-movement allowance | A |
| X2B | X2 | B |
| X2C | X2 | C |

Testing all three is possible: the policy is one rule setting
(`afterMissedRebound`), and the engine's existing no-look-ahead, snapshot and
determinism tests cover every candidate alike.

**X3 stays comparison-only.** It is run with the same three policies (X3A,
X3B, X3C), reported beside the candidates, and can never be picked.

**Fresh entries and buy-backs are reported apart** (§4). A fresh entry is a
buy made at or above the previous sale price under B or C, or by a stock
never held or whose earlier buy lapsed (prereg-3 §8, "stocks never held
yet"). A buy-back is a buy below the previous sale price under the buy-back
rule. A fresh entry does not count as a round trip (cycle).

**Neighbouring settings** (prereg-3 §5.4) are run for the **winning
candidate only**, on the development period only, after the pick, and
reported only. The owner's six-candidate comparison replaces the broad
neighbour sweep as the development-period sensitivity check; running 16
neighbours for each of six candidates would be a parameter search of the
kind the pre-registrations forbid.

## 2. Development pick: the owner's choice between two rules (open)

The owner's amendment kept both rules. **Exactly one** will apply, chosen by
the owner as amendment 3b before the selection run; `criteria-hxr-v3a.json`
carries `selection.pickRule = pending_owner_choice` until then, and the code
refuses the selection run while it is pending.

Common to both: a candidate qualifies only with at least **10 completed
exit-and-buy-back round trips** across its stocks in the development period.
Fresh entries do not count. Both benchmarks of §5 must be beaten.

| | (a) Most profit | (b) Best return per unit of fall |
|---|---|---|
| Winner | the qualifying candidate with the highest **ending account value after costs** | the qualifying candidate with the highest **annualised return ÷ largest decline** |
| Must beat | both holding benchmarks on ending value | at least **1.10 ×** both holding benchmarks on that ratio |
| Tie | the smaller largest decline | the smaller largest decline |
| Also reported | its largest decline, next to it | its ending value |
| If no candidate qualifies and beats both | **stop**: HXR has no candidate worth validating; validation and final are never used | the same |

The pick is frozen as `hxr-1.0.0`. X3A–C are never eligible.

## 3. One winner only

Only the single winning candidate goes to validation (gate V1–V2 of prereg-3
§5, now against both benchmarks, §5 below), and only after passing
validation to the final period. **If it fails validation, HXR stops.** No
runner-up is ever run on validation or final data, under this or any later
version; a different candidate would be a new strategy line with its own
pre-registration and fresh periods.

## 4. Reporting: fresh entries apart from buy-backs

For every run, beside prereg-1 §11 and prereg-3 §7:

- **buy-backs** (bought below the previous sale price): count, average
  change from the sale price, P/L of the holdings they started, losses after
  buying back;
- **fresh entries** (bought at or above the previous sale price, or never
  held before): count, average premium over the previous sale price where
  one exists, P/L of the holdings they started, how many were exited at the
  initial-loss level;
- **missed rebounds**: count, and under policy A the stock's move while
  retired; under B and C, the sessions until the fresh entry.

## 5. A second benchmark: the day-one positions held

Beside the fully invested hold (equal money in every stock, prereg-1 §3), a
second benchmark is run for every period and every variant:

- **Hold the day-one positions**: the exact positions HXR opens at the
  period's first fill (same stocks, same share counts from prereg-3 §1.3,
  same leftover cash), and never sell. Dividends are credited to its cash;
  splits apply. It uses the candidate's account, costs and sizing settings,
  so its day-one positions are identical for every candidate sharing them,
  which all six do.
- **Every pass/fail test must beat both benchmarks.** The validation gate V2
  and the final criteria G2–G6 are each evaluated against the fully invested
  hold and against the day-one hold, and pass only if they pass against
  both. G1's requirement of a decline of 20% or more uses the **fully
  invested hold**, which is the one that is always fully exposed. The G5
  stress variants and the G6 leave-one-out runs include both benchmarks.
- **Both are reported** next to every HXR figure, in every period.
- The **prospective account** keeps its two arms, the frozen pick and the
  fully invested hold, as pre-registered; the day-one hold is a backtest
  benchmark. (Stated so it cannot be added later to suit a result.)

Why it matters: the fully invested hold is exposed to ten stocks with all of
the cash; the day-one hold has HXR's own exposure and cash, so beating it
shows that the exits and re-entries themselves added something.

## 6. Files

| File | Status |
|---|---|
| `PREREGISTRATION-3a.md` | this amendment; in the hashed set |
| `criteria-hxr-v3a.json` | as v3, plus: `selection.pickRule = pending_owner_choice` (`ending_value` or `return_to_drawdown` once chosen), `selection.benchmarks = [hold, hold_day_one]`, both benchmarks in V2 and G2–G6, G1 on the fully invested hold. Replaces `criteria-hxr-v3.json`, which is superseded unrun. |
| `configs/v3/hxr-x1a…x2c-0.3.0.json` (six candidates), `hxr-x3a…x3c-0.3.0.json` (comparisons) | the prereg-3 0.3.0 settings with `afterMissedRebound` set to `stay_out`, `fresh_entry_recovery_point` or `fresh_entry_after_sessions` with `freshEntryMinSessions: 60`. They replace `configs/v3/hxr-x1-0.3.0.json`, `hxr-x2-0.3.0.json` and `hxr-x3-0.3.0.json`, which carried the pending value and are removed (kept in git history). |
| `configs/hxr-hold-0.1.0.json` | unchanged: the fully invested hold |
| day-one hold | not a file: derived from the winning candidate's config at run time (`rule.type = hold` with the candidate's account, risk and initial-loss sections), recorded with its hash in every run |
| `universe-hxr-v3.json`, `periods-hxr-v3.json` | unchanged |

Amendment 3b (the pick rule) will be a one-line entry in `EXPERIMENT-LOG.md`
and the change of `selection.pickRule` in `criteria-hxr-v3a.json`, recorded
before any run with results seen: no.
