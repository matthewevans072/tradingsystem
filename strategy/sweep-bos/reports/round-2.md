# sweep-bos round 2: count-only pass and outcome (inconclusive; nothing ran)

Written 2026-11-03 from the count-only pass of the four round-2 variants (PRE-REGISTRATION-2.md; EXPERIMENT-LOG.md entries 17 to 21) under the owner's conditions of entry 20. **Measured** = read from the pass; **derived** = computed from measured counts. No outcome, return or R figure exists for round 2: by the owner's condition 3 the pass reports counts only, and the decision rule stopped everything after it. No bar, price or per-session list appears here.

## 1. What was authorized and what happened

The owner authorized the four round-2 variants, the 10:55 extension included (the 10:30 cutoff came from the 2026 model, not the Boot Camp model under test), on six conditions. Condition 2 (pin and commit the four files first): commit `cf577f5`. Condition 3 (a count-only pass, with a stop if even the most relaxed variant gives under 100 fills per instrument over 2019-01-02 to 2022-12-30): the pass ran under the full gate (pins, the pre-registration commit, committed code, the bounded data version 1, the round-2 code-frozen entry, every run logged, each variant unrun, the lock), recorded no run or ledger row, and printed counts only. Condition 5: no bar after 2022-12-30 was read (latest stored date 2022-12-30; zero bars after the bound). Condition 6: the leftover temp directories are traced and fixed in entry 21.

## 2. The counts (measured; 1,008 development sessions per instrument)

| Variant | Change from sb-ob-a-nobias-0.1.0 | QQQ sweeps | QQQ confirmed breaks | QQQ orders placed | QQQ fills | SPY sweeps | SPY confirmed breaks | SPY orders placed | SPY fills |
|---|---|---|---|---|---|---|---|---|---|
| R2-1 cutoff1055 | breaks and fills through the 10:55 bar | 314 | 72 | 39 | 14 | 254 | 60 | 45 | 17 |
| R2-2 xsession | structure across the session boundary | 314 | 88 | 77 | 27 | 254 | 60 | 50 | 18 |
| R2-3 noinval | no invalidation (H7 dropped) | 314 | 78 | 53 | 11 | 254 | 49 | 35 | 8 |
| R2-4 combined | the three together | 314 | 176 | 151 | 59 | 254 | 134 | 115 | 37 |
| round-1 base (entry 9, for comparison) | none | 314 | 49 | 27 | 8 | 254 | 36 | 26 | 7 |

Sweeps are sessions with a sweep bar in 09:30 to 09:55 and are unchanged by every switch (derived check). Fills as a share of sessions (derived): R2-4 5.9% on QQQ and 3.7% on SPY.

## 3. The decision (the owner's rule, applied)

The most relaxed variant is R2-4. Its fills are 59 on QQQ and 37 on SPY, both under 100. **Round 2 is inconclusive. Nothing further runs**: no round-2 run with outcomes, no round 3, no new variant, no change to a frozen variant. The development phase of sweep-bos ends with NONE advancing from round 1 and no round-2 result; there is no variant for the evaluation window, and Part F stays unauthorized and moot.

## 4. What the counts say (derived, with care)

- The three loosest mechanical changes together raise the fills from 8 and 7 to 59 and 37: a sevenfold and fivefold increase, still a third to two fifths of the pre-registered minimum.
- No single change comes close: R2-2 (structure across the boundary) gives the most on QQQ (27), R2-1 (the later cutoff) the most on SPY (17), and R2-3 (no invalidation) the least, because without H7 the setup opened by the first sweep stays open and later closes beyond the level no longer give a second chance, so more sessions end without a usable break.
- Sweeps cap the funnel at 314 and 254 sessions; the chain from a sweep to a confirmed break, a zone, an order and a touched zone loses about four fifths of them even when relaxed. The model as mechanised on the prior regular session's levels, at 5 minutes, over this window, does not produce a sample the pre-registered criteria can judge. That is a statement about this mechanisation on these stand-ins, not about ES or NQ or about the discretionary original.

## 5. Record

Counts only were seen by the author for round 2. The engine computed its usual outputs in memory during the pass and discarded them; nothing was stored, returned or printed beyond the counts above (`service.js` `countOnly`, `tests/sweepbos-round2.test.js`).
