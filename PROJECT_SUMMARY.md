# Signal Desk: project summary

Last refreshed: 2026-11-04, after Build 8 (575 tests: 573 pass, 1 skipped, 1 known unrelated failure, re-run with no code change; enabled: the local app only; monitoring, delivery schedules and every research run OFF, none pending). Derived from `JOURNAL.md`, which is the source of truth.

## What it is

A private, local web app for following the owner's portfolio (USD and CAD kept separate), the news that affects it and an AI-infrastructure research list, with three briefings a day, rule-based position assessments and a read-only chat agent grounded in the owner's own records. It cannot trade: no brokerage connection, no order code, and none will be added. Beside it, four strategy simulations, each in its own database with no order path and no access to real holdings or cash: Strategy Lab (consolidation breakout, 15-minute bars, 17 US symbols), HXR (hold / exit / re-enter on a ten-stock basket, daily bars), range-trend (range and trend rules on the same ten stocks) and sweep-bos (sweep, break of structure, pullback on QQQ and SPY 5-minute bars as stand-ins for NQ and ES). A fifth, the ICT Lab (four ICT-inspired long-only specs on QQQ 5-minute bars, $5,000 whole-share account), exists as Part A documents only as of 2026-11-04.

## How it works

Node 24 with `node:sqlite` and a no-build browser front end on http://127.0.0.1:4317; one runtime dependency (the Anthropic SDK, used only by the optional analyst and chat). Research follows one method: pre-registration documents and variant files committed and pinned by SHA-256 before data is seen; a gate in code that refuses any run unless pins, commits, data hash, code-frozen log entry, run ledger and lock all agree; deterministic engines tested for look-ahead; a planted-bug harness that must catch every listed bug; reports whose every figure is labelled measured or derived; the owner's decisions quoted verbatim in append-only experiment logs. Market data comes only from Alpaca and is never committed.

## History

| Build / session | Date | Result |
|---|---|---|
| Build 1: app and chat agent | 2026-10-21 | imported into its own repository; agent with read-only tools and guarded proposals |
| Build 2 + Session 1: Strategy Lab | 2026-10-21 to 2026-10-22 | cb-1.0.0 NOT ELIGIBLE (2 and 8 development trades, 0 and 1 validation); cb-1.1.0 FAILED the pre-holdout screen; holdout never run; cb-1.0.0 closed |
| Build 3 + Session 2: HXR | 2026-10-22 to 2026-10-23 | development pick run once: stop, no candidate qualified |
| Build 4: HXR corrections, diagnosis | 2026-10-26 to 2026-10-27 | tags defect disclosed and fixed for new runs; nothing re-run |
| Build 5: range-trend | 2026-10-26 to 2026-11-02 | D1 to D8 and the pick and date rules adopted; gated launcher; 46 of 46 planted bugs caught; never run on market data |
| Build 6 + Session 3: sweep-bos | 2026-11-03 | round 1 NONE (1 to 8 trades per cell against 100); round 2 inconclusive by the count rule (59 and 37 fills against 100); development closed |
| Build 7: memory system | 2026-11-03 | CLAUDE.md, CLAUDE-INVARIANTS.md, JOURNAL.md, this file, PROJECT_HANDOVER.md; uncommitted |
| Build 8: ICT Lab Part A | 2026-11-04 | `strategy/ict-lab/` protocol, concepts (H1 to H20), four spec files and log entries 1 to 3; QQQ long-only, four specs, $5,000; a parallel-session collision resolved in favour of the first design (the other preserved under `superseded/`, then deleted on the owner's approval); the owner's four review corrections applied, then the two approval changes (`superseded/` deleted; spec field renamed `rearmAfterRefusedConfirmation`); documents only; Parts B to E unauthorized; committed 2026-11-04 as the Part A pre-registration commit (hashes in the journal's Build 8 third addendum and lab log entry 4) |
| Build 8 addendum: collision | 2026-11-04 | two sessions ran the same order; the second overwrote the first's PROTOCOL.md and CONCEPTS.md; the files on disk are the second session's (CONCEPTS H1 to H22; lab log entry 2 has the hashes); the owner decides which design stands |

## Current state

- **Verified live (on the owner's PC with real market data):** Strategy Lab runs 1 to 12; HXR runs 1 to 22 and the development pick; sweep-bos data version 1, round-1 runs 1 to 8 and the round-2 count-only pass. All results negative or inconclusive; no candidate exists anywhere; no holdout has ever been run.
- **Built but not enabled:** scheduler, briefings, alerts and delivery (OFF by the owner's rule); TradingView webhook (off unless configured); Strategy Lab forward test (not started; needs a paid real-time feed); HXR prospective account (not started); range-trend practice runs (gated; need the owner's authorization row); remote access (off).
- **Tested on synthetic data only:** range-trend in full; HXR corrections since 2026-10-26; sweep-bos round-2 switches beyond counting.
- **Not verified:** that CLAUDE.md's import line loads CLAUDE-INVARIANTS.md in a fresh session; the Pine check in TradingView (the owner's task).
- **Data on disk:** `data/signal-desk.sqlite` (the owner's real workspace, 4 KB + 1.05 MB WAL), `strategy-lab.sqlite` 79.1 MB, `hxr-sim.sqlite` 125.5 MB + 119.5 MB WAL, `sweep-bos-sim.sqlite` 20.2 MB (bars to 2022-12-30 only), `range-trend-sim.sqlite` 49 KB (empty). None is in git.

## Next steps (all the owner's decisions)

1. ICT Lab Part B onward (code that reads data, the download, the runs): each part by a separate message; Part A is committed and pinned.
2. Build 7's files are committed (2026-11-04); the lab log entry 4 and this refresh are the only uncommitted change.
3. Authorize the range-trend practice runs by writing the `**Practice runs authorized**` row, or leave the gate closed.
4. Confirm in a fresh session that the invariants are in context.
5. Any further strategy test is a new pre-registration; sweep-bos, HXR and the Strategy Lab have nothing scheduled.

## Rules

Simulation only; no broker, order, paper-trading or trading-permission code; monitoring, reminders, notifications and live order execution OFF; no paid service without approval; secrets only in `.env`; Alpaca the only research data source; bars never committed; the owner's data never written directly; pre-registered files never edited; nothing runs on market data, is enabled, scheduled or committed without the owner's message; every figure measured or derived; every claim verified / tested / unverified; no "profitable" or "live-ready"; no review workflows or subagent fan-out unless asked.
