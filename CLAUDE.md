# Signal Desk — read this first

Signal Desk is a private, local portfolio-tracking web app (Node 24, `node:sqlite`, a no-build browser front end on http://127.0.0.1:4317) plus four pre-registered strategy simulations: Strategy Lab, HXR, range-trend and sweep-bos. The code lives in `C:\Users\matth\OneDrive\Desktop\trading system` and in the private GitHub repository `matthewevans072/tradingsystem` (work branch `hxr`, default branch `main`). It is NOT a trading system: no broker, order, paper-trading or trading-permission code exists, and none will be added. User guide: `START-HERE.md`; overview: `README.md`; research specs: `strategy/README.md`, `strategy/hxr/README.md`, `strategy/range-trend/PLAN-DRAFT.md`, `strategy/sweep-bos/PLAN.md`; the long handover: `PROJECT_HANDOVER.md`.

Before any work, read `JOURNAL.md`: the "Start here" and "Where things stand" blocks and the open list. After any context compression, re-read this file and those two blocks before continuing.

## Rules (the owner's; every invariant to preserve is in `CLAUDE-INVARIANTS.md`, imported below and binding)
- Environment: Windows 11, VS Code with Claude Code, Git Bash and PowerShell, Node 24 (22.13 or newer required). Secrets only in `.env`: never print, log, commit or ask for them. Temporary files only in the session scratchpad; check free disk space before heavy steps and clean temp folders. Assistant memory: `C:\Users\matth\.claude\projects\c--Users-matth-OneDrive-Desktop-trading-system\memory\`.
- Never touch: `data/signal-desk.sqlite` directly (the owner's real holdings; schema changes only as new additive migrations in `server/db.js`); any pre-registered file, pinned config or earlier log entry (a change is a new version plus a log entry); any holdout window, the sweep-bos bar bound (no bar after 2022-12-30) or an evaluation window without the owner's separate message; the owner's authorization rows (neither the code nor the assistant ever writes them).
- Simulation only. Alpaca (`https://data.alpaca.markets`) is the only market-data source for research; nothing from Yahoo; no futures data; never commit bars, databases, `.env` or zip archives. Scheduled monitoring, reminders, notifications and live order execution stay OFF. No paid service or API billing, no broad review cycle (no review workflows or subagent fan-out) and no run on market data without the owner's explicit instruction.
- Before editing: `git status` (branch `hxr`; the 24 ` M strategy/hxr/*` lines are line-ending phantoms: never add, revert or touch them), `git log -1`, the last two entries of the relevant `EXPERIMENT-LOG.md`; after editing, `npm test` (the one known failure is `tests/agent-safety.test.js` when its fixture dates fall on a weekend).
- Commit only when the owner asks, or when a work order says to commit after each part; then push to `hxr` and report the hashes, the actual test counts and the planted-bug result (`npm run rt:planted`, `npm run sb:planted`).
@CLAUDE-INVARIANTS.md

## Pick up where we left off
When the owner says this (or "resume", "where were we"): read `JOURNAL.md`'s Start here, Where things stand, the open list and the last two entries, plus `PROJECT_SUMMARY.md`; run `npm test`; then reply in about 10 lines: what was last done, what is verified vs only tested, what is built but not enabled, the next step, anything waiting on the owner. Do not start work yet.

## Autosave
After every two of the owner's messages, and whenever the owner says "save": refresh `PROJECT_SUMMARY.md` and make sure `JOURNAL.md` is current (Where things stand, the open list, the latest entry); say in one line that it was saved.

## After each task
1. Add a dated entry at the bottom of `JOURNAL.md`: what changed, why, what was checked (tests / live / not verified), what is unverified.
2. Update Where things stand, the open list and the test-count table.
3. Update `README.md`, `START-HERE.md` or the relevant spec if behaviour changed.

Never claim something works unless it ran; otherwise say "tested on synthetic data" or "not verified". Dates absolute, numbers with units, every claim marked verified / tested / unverified; append to others' text, never rewrite it. `JOURNAL.md` is the source of truth and `PROJECT_SUMMARY.md` is derived from it.
