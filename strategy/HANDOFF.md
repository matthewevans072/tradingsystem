# Strategy Lab — handoff for the next session

Written 2026-10-22, at the end of the session that built the data-readiness
checklist and the Alpaca history source. Read this, `../CLAUDE.md`,
`DATA-READINESS.md` and `VALIDATION-PLAN.md` before doing anything.

## Where the code is

The project lives in its own private repository,
`matthewevans072/tradingsystem` (branch `main`), at the repository root.
Work and commit there. The old copy on branch `signal-desk` of
`matthewevans072/automated-reception-data-scraper` is superseded and kept
only until the owner decides to delete it.

## The owner's current request (still in force)

"Continue Strategy Lab, prioritizing a verified real-data simulation over
additional features." In short:

1. Keep the rules and acceptance criteria frozen: no tuning.
2. Verify data readiness for all 17 symbols before any run (instrument and
   exchange, 15-minute history per period, timestamps, timezone and session
   boundaries, OHLCV completeness, split and dividend adjustment, costs,
   provider limits and permitted use).
3. If data is insufficient, report exactly what is missing. Do not silently
   shorten the test or replace instruments. Propose any revised dates
   **before** examining performance, and wait for the owner.
4. Pine compile and fill check in real TradingView: still to do, by the
   owner (`PINE-RECONCILIATION.md`, last section).
5. Run development and validation on verified market data. Leave the holdout
   untouched until the implementation and settings are frozen: "Repeated use
   contaminates a holdout even if each run has a different version number."
6. Trade-status claims depend on records (PROPOSED, SIMULATED,
   USER-REPORTED; BROKER-CONFIRMED is reserved). Done.
7. Report forward-test results separately, with no invented fills. The
   forward test needs a paid real-time consolidated feed, so it has not
   started.
8. Questrade: the REST API and the MCP server are both assessed, and live
   trading stays disconnected. Done.

Finish with: actual test evidence, unresolved discrepancies, data coverage
and the single next action needed from the owner. Never describe the
strategy as profitable or live-ready without supporting results.

## Hard rules

- No orders, no trading permissions, no live trading, no broker automation.
  A live pilot needs a separate explicit instruction and the review in
  `QUESTRADE-ASSESSMENT.md` §8–9.
- The owner's real available cash was last reported as $0. Paper profits are
  not buying power.
- Keys come only from environment variables or `.env`. Never print, log or
  commit them, and never ask for them in chat. Check that a key is present
  without showing its value.
- Never commit downloaded bars. The data is licensed for personal,
  non-commercial use, and `data/` is gitignored. Commit reports, dataset
  hashes and bar-set logs only.
- A rule change is a new config version plus a `PARAMETER-LOG.md` entry
  saying which data had been seen.

## State at handoff

- `npm test`: 261 of 261 passed (dependency: `@anthropic-ai/sdk` only;
  run `npm install` first).
- Readiness on an empty Lab database: 0 READY, 0 NOT READY, 17 NO DATA.
  Each symbol needs 3,316 warm-up, 12,990 development, 6,516 validation and
  9,662 holdout bars.
- The owner has added `data.alpaca.markets` to the environment's allowed
  domains. A request without a key returned 401, so the host is reachable.
  The owner has also added `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY`
  as environment variables. They load only in a new session; confirm they
  are present.
- No real-data run, holdout run or forward run has ever been made.

## Next steps

1. `cd signal-desk && npm install && npm test`.
2. Confirm both Alpaca variables are set (presence only). Make one small
   request through `server/strategy/sources/alpaca.js` (for example, one
   session of SPY) and check the response: HTTP 200, `feed=sip`,
   `adjustment=split`, bars in regular-session 15-minute slots.
3. Download 2021-07-01 to 2026-06-30 for all 17 symbols through the Lab
   service (`createLab(ctx).fetchHistory({ source: 'alpaca', from:
   '2021-07-01', to: '2026-06-30' })`; watch `fetchStatus()`), or start the
   app and use Lab → Data → Download history. Bars go to
   `data/strategy-lab.sqlite`. That database is lost when the container
   ends, so re-download in later sessions.
4. Run the readiness checklist (`lab.readiness()` or
   `GET /api/lab/readiness`) and report it per symbol and period, including
   the NVDA split checks (2021-07-20 and 2024-06-10).
5. If every symbol is READY for warm-up, development and validation, run
   development and validation in both modes (`lab.startBacktest({ mode,
   split })` or `scripts/strategy-backtest.js`). **Do not run the
   holdout.** Report against `acceptance-v1.json` with trade counts and the
   outcome (not eligible, inconclusive or eligible for review; that last one
   is not permission to trade).
6. If anything is NOT READY, stop before any backtest, report what is
   missing and propose fixes or revised dates for the owner to approve.
7. Commit reports (no bars, no keys) to the `signal-desk` branch.

## Open items carried over

- The Pine script has not been compiled or run in TradingView.
- Listing exchanges for 11 symbols are unconfirmed, and per-symbol split
  checks for 10 are unconfirmed.
- The 2021–2025 NYSE calendar was generated from rules and cross-checked
  only for 2026–2027. The readiness check compares it with real bars.
- Twelve Data's free-plan coverage is unverified and its intraday bars are
  unadjusted; `/earliest_timestamp` is not implemented.
- `forward.js` has no Alpaca adapter; a real-time feed would be paid.
- The chat guard catches roughly two in three trade claims on unseen
  wording, and the trade-claim detector has known misses. The false
  positive "You hold 100 NBIS bought at 90." is still open.
