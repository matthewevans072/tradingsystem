# sweep-bos: plan

**Status:** DRAFT until the Part A commit. The commit that first contains this file, PRE-REGISTRATION.md and the eight variant files is recorded in EXPERIMENT-LOG.md entry 3 and pinned in `server/sweepbos/config.js`; from that commit on, this plan is the plan, and PRE-REGISTRATION.md version 1 is the rule sheet. Neither is edited afterwards; a change is a new version with a log entry.

**Working name:** sweep-bos. A pre-registered test of a sweep -> break of structure -> pullback strategy (the "TJR Boot Camp" model as taught in the 2023 Boot Camp, sections 1 and 3 of the owner's uploaded summary) on QQQ and SPY at 5 minutes, as labelled STAND-INS for NQ and ES. The rules are in PRE-REGISTRATION.md; this file is the process.

## 0. Standing constraints

- Simulation only: no broker, order or paper-trading code; no real holdings or cash; no futures data; nothing from Yahoo.
- Alpaca market data is the only source (`https://data.alpaca.markets`, the project's existing client with its redirect refusal and host allow-list); the keys stay in `.env` and are never printed, logged or committed. If the keys are missing, the work stops and says so; nobody asks for keys in chat.
- Bars and any market data are never committed (licence: personal, non-commercial). `data/` is ignored by git; the readiness report and the run reports carry counts and statistics only, never bars or per-fill price lists.
- Free disk space is checked before each step; temp folders are cleaned; no broad review cycle is launched.
- Every figure in a report is labelled measured (read from stored runs) or derived (computed from measured figures).
- Scheduled monitoring, reminders, notifications and live order execution stay off; no paid service or API billing is introduced.

## 1. Stand-ins and what the result can mean

QQQ stands in for NQ and SPY for ES. The original's levels are the overnight and pre-market session highs and lows; regular-session ETF bars do not have them, so the prior regular session's high and low are swept instead (PRE-REGISTRATION.md preface and 3.3). A result here is evidence about this mechanical reading on the ETFs' regular session, not about ES or NQ and not about the discretionary original.

## 2. Windows (the owner's choices, recorded on sending the authorizing message)

| Window | Dates | Use |
|---|---|---|
| warm-up | from 2018-06-01 | daily bars for the bias and prior-session levels; 5-minute bars for the 20-session buffer |
| DEVELOPMENT | 2019-01-02 to 2022-12-30 | rounds 1 and 2 |
| EVALUATION | 2023-01-03 to 2024-12-31 | never touched in this task; read once, for one owner-frozen variant, after the owner's separate message (Part F) |
| Strategy Lab holdout | 2025-01-01 to 2026-06-30 | never read or downloaded (it includes SPY) |

Download bound for this task: no bar after 2022-12-30 is downloaded, opened or read. The evaluation-window download is a later, separately logged data version.

**Disclosures.** SPY 2022-2024 was used by a different strategy (consolidation-breakout) in the Strategy Lab, its results viewed; QQQ is not in that universe; the owner has watched these markets; none of it is independent of the owner.

## 3. Budget (the owner's bounds)

- Round 1: at most eight variants; exactly the eight of PRE-REGISTRATION.md section 4, each run once per instrument.
- Round 2: only if the owner has read the round-1 results first; at most four new variants, every one defined and committed before it runs.
- Every result is logged, failures included. No change to a frozen variant after it has run. Profit found by repeated retesting on the same data is not evidence. Stopping with "none advances" is a valid, expected outcome.

## 4. Parts and authorization

| Part | Content | Authorized |
|---|---|---|
| A | this plan, the rule sheet, the log, the eight variant files; committed with SHA-256 before any download | yes |
| B | `server/sweepbos/` data module and `data/sweep-bos-sim.sqlite` (own file guard); the download of QQQ and SPY 5-minute and daily bars for warm-up and DEVELOPMENT (nothing after 2022-12-30) as a logged data version; the readiness check (counts only) | yes |
| C | the deterministic engine and its Tier 1 tests on synthetic data; a planted-bug harness with at least 15 bugs, each caught by a named failing test | yes |
| D | round 1: the eight variants on QQQ and SPY over DEVELOPMENT only, through the gated launcher; every run logged; `reports/round-1.md` | yes |
| E | diagnosis by stage and a proposal of at most four round-2 variants, in the same report; no run | yes |
| F | the one-time evaluation run | NO: stop before it and wait for the owner's separate message |

## 5. Gating (what the launcher refuses)

A development run starts only when all of these hold (`server/sweepbos/service.js` `gateStatus`, printed by `scripts/sweepbos-run.mjs --check`):

1. PRE-REGISTRATION.md and PLAN.md match their pinned SHA-256 (LF text), and the pinned pre-registration commit exists in the repository's history, is an ancestor of HEAD, and holds PRE-REGISTRATION.md with that same hash.
2. The data version is complete, its stored data hash recomputes, it holds no bar after 2022-12-30, and it was downloaded after the pre-registration commit's time.
3. EXPERIMENT-LOG.md has a `**Code frozen for round 1**` entry naming the current `CODE_REVISION`, the pre-registration commit and the data version's hash, outside code fences and HTML comments, and every recorded run is listed.
4. The variant file is one of the eight, matches its pin, and has not already run in round 1 (the append-only ledger).
5. The sweep-bos code (`server/sweepbos/*.js`, `scripts/sweepbos-run.mjs`, the variant files) has no uncommitted change, so the code that ran is in a commit; the run records the HEAD commit, the source hash, the code revision and the engine version.
6. At least 1 GB free on the data volume; no other sweep-bos run holds the lock.

The launcher runs one variant per invocation, only with `--run --confirm-run`, and appends the exact log entry after the run (printed too). Nothing in the module reads real holdings or cash, places or prepares an order, or sends anything anywhere.

## 6. Criteria, candidate and pick rule

PRE-REGISTRATION.md section 5 (C1-C6 per instrument, a candidate needs both instruments, pooled mean R with the 0.02 R tie to the smaller drawdown, NONE otherwise; the dollar account's ending value is never the pick) and section 6 (bootstrap, null, best-5%, monthly share, exactly defined with seeds).

## 7. Reports

`reports/data-readiness-v1.md` (Part B, counts only) and `reports/round-1.md` (Parts D and E): for every variant and instrument the figures of PRE-REGISTRATION.md 6.5 and the stage counts of section 7, the candidate table (C1-C6 per instrument), the plain outcome, the diagnosis by stage, and at most four round-2 proposals with reasoning. No bars, no per-fill price lists.

## 8. Code layout

- `server/sweepbos/`: `store.js` (the file guard and schema), `data.js` (download with the 2022-12-30 bound, session filter, readiness), `rules.js` (swings, bias, sweep, BOS, zones, stops), `engine.js` (sessions, orders, fills, exits, mirror trades, the dollar account), `metrics.js` (figures, bootstrap, null, criteria, pick rule), `config.js` (pins, `CODE_REVISION`, `ENGINE_VERSION`, windows), `service.js` (gate, runs, ledger, log entries).
- `scripts/sweepbos-download.mjs`, `scripts/sweepbos-run.mjs`, `scripts/sweepbos-planted.mjs`, `scripts/sweepbos-report.mjs`.
- `tests/sweepbos-*.test.js` (synthetic data only).
- `strategy/sweep-bos/`: this plan, PRE-REGISTRATION.md, EXPERIMENT-LOG.md (append-only), `variants/`, `reports/`.
