# sweep-bos: pre-registration amendment 2 (round 2)

**Status:** pre-registered amendment for round 2, written after the round-1 results were seen (EXPERIMENT-LOG.md entries 8-16, `reports/round-1.md`) and committed, with the four round-2 variant files pinned in `server/sweepbos/config.js`, before any round-2 run. PRE-REGISTRATION.md version 1 stays in force unchanged; this file adds three switches and the four files that use them. Never edited after its commit; a further change is a new amendment with a log entry.

**Data seen when this was written:** the round-1 figures, stage counts and trade outcomes of the development window (2019-01-02 to 2022-12-30) for the eight round-1 variants on QQQ and SPY; no bar, price or per-fill list; nothing of the evaluation window (Part F stays unauthorized; bar bound 2022-12-30).

**Why round 2 exists:** every round-1 cell held 1 to 8 completed trades against the pre-registered 100, so no criterion could be judged (NONE advanced). The diagnosis in `reports/round-1.md` section 8 attributes the missing trades to the author's invalidation rule H7 (56% of sweeps voided), the late break of structure under the three-bar confirmation (28-30% of setups with no break by 10:25; breaks clustered on the 10:20-10:25 bars), session-local structure with nothing before an opening-bar sweep (82-89% of the missing order blocks), and the 10:25 last fill (70-73% of orders expired). Round 2 changes one thing at a time, and the fourth file combines the three. Its purpose is a testable sample, not an edge; no positive result is expected or implied.

## 1. The three switches (mechanical definitions)

Every switch is declared in the variant file and read by the engine with the round-1 value as the default, so every round-1 file runs exactly as in round 1 (`tests/sweepbos-round2.test.js` holds a behaviour snapshot that proves it).

**R2-1, the cutoff (`entryCutoff.lastFillBarIndex`: 11 -> 17; `bos.lastBarIndex` 17).** The break of structure (v1 section 3.5) may occur at the close of any bar with index k <= 17 (its close at or before 11:00:00), and the order (3.9) is good for fills on bars m with k < m <= 17 (the bar starting 10:55 is the last). Nothing fills at or after the bar starting 11:00. The sweep window (index 0..5), the fill rule, the exits and the time stop are unchanged. This changes the owner's round-1 "no new trades after 10:30" setting; it is run only with the owner's word.

**R2-2, structure across the session boundary (`swing.scope` "cross_session", `swing.previousSessionBars` 12, `zones.orderBlockSearch` "cross_session").** The STRUCTURE SERIES of session d is the previous session's last twelve bars (14:55 to 15:55, or 12:00 to 12:55 on an early close) followed by today's bars; today's bar k is extended index k + 12, and a reported index below 0 is a bar of the previous session. On this series only: the 5-minute swings of 3.1 (so a swing in the previous session's last bars is confirmed three bars later, possibly by today's first bars, and is usable for the break of structure of 3.5 and the stop-B second swing of 3.6 B, with the first-close-beyond check running over the previous session's later closes too), and the order-block search of 3.7 (the latest opposite-colour bar at or before the leg's extreme, now searched back into the previous session's last twelve bars). Unchanged: the levels (the previous session's daily high and low), the sweep window and the sweep extreme (today's bars from the sweep bar on), the leg's extreme (today's bars from the sweep bar on, so the fair value gap of 3.7 is unaffected in practice), the fill, exit and time-stop rules, and the data rule 1.4 (the previous session must be complete, as before).

**R2-3, no invalidation (`sweep.invalidation` "none").** Hypothesis H7 is dropped: a bar closing back beyond the swept level no longer voids the setup. The setup opened by the first sweep bar stays open, its extreme keeps following the lowest low (highest high for a short), and it ends only at a break of structure or at the cutoff. The both-sides rule (H5), the first-sweep rule and everything else stay as in v1.

## 2. The four round-2 variants (exactly these; each runs once per instrument)

All four are `sb-ob-a-nobias-0.1.0.json` (zone order block, stop A, bias off; SHA-256 07506b25061c3ed0e71d9f6924aa34283ed72994f15d06507fd771cb2aef9a1f) with the declared change and nothing else, version 0.2.0, `round` 2, `basedOn` naming that file and hash:

| # | File | Change |
|---|---|---|
| R2-1 | `variants/sb-ob-a-nobias-cutoff1055-0.2.0.json` | the cutoff index 17 |
| R2-2 | `variants/sb-ob-a-nobias-xsession-0.2.0.json` | structure across the session boundary |
| R2-3 | `variants/sb-ob-a-nobias-noinval-0.2.0.json` | no invalidation |
| R2-4 | `variants/sb-ob-a-nobias-combined-0.2.0.json` | the three together |

Their LF-text SHA-256 pins are in `server/sweepbos/config.js` `VARIANT_SHA256` and in EXPERIMENT-LOG.md entry 18. Round 1's eight files keep their pins and cannot run again; a round-2 file cannot run in round 1 and a round-1 file cannot run in round 2 (`config.js` `ROUNDS`, `service.js` gate condition `variant`).

## 3. Everything else unchanged

Criteria C1-C6, the candidate rule and the pick rule (v1 section 5) apply to round 2 as written: a round-2 variant is a candidate only when all six pass on QQQ and on SPY; round 1 had no candidate, so the pick, if any, is among round-2 candidates; otherwise NONE advances and the development phase ends with no variant for the evaluation window. The statistics (section 6), the stages (section 7), the data (section 1, data version 1, bar bound 2022-12-30) and the windows are unchanged. The round-2 budget is these four files; there is no round 3.

## 4. Gating

Round 2 runs through `scripts/sweepbos-run.mjs --round 2` under the same gate as round 1, with the round's own `**Code frozen for round 2**` entry naming the code revision that carries the switches (`sb-code-2026-11-03-2`), the pre-registration commit and the data hash. The code revision changed because the engine changed; round 1's recorded runs keep `sb-code-2026-11-03-1`, and the snapshot test shows the new revision reproduces round-1 behaviour for round-1 files.
