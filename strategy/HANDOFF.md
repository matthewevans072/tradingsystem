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

## State at handoff (updated 2026-10-22, after the real-data download)

- `npm test`: 261 of 261 pass, including in a session with real keys set
  (`tests/no-host-keys.js` blanks host credentials in every test config).
- Alpaca works: authenticated, `feed=sip` (consolidated), `adjustment=split`
  (price and volume). In a cloud sandbox Node needs `NODE_USE_ENV_PROXY=1` to
  reach it; a normal PC does not.
- Downloaded 2021-07-01 to 2026-06-30 for all 17 symbols: 551,592 bars and
  340 bar sets, in `data/strategy-lab.sqlite` (not in git). The owner also has
  a copy.
- **Readiness: 7 READY, 10 NOT READY, no usable period.** Details, the audit
  and the options are in `strategy/reports/2026-10-22-data-readiness.md`.
  - The 10 NYSE symbols miss bars on 2021-10-25, 2022-01-24, 2022-01-26 and
    2022-03-08: a vendor gap in Alpaca's Tape A history, not a halt.
  - VRT's split flag on 2022-02-23 is a real earnings drop.
  - The calendar and all 17 listing exchanges are verified.
- No backtest, holdout run or forward run has ever been made. No performance
  figure exists.

## Next steps

1. Wait for the owner to choose a remedy for the Alpaca gap (options A–D in
   the report) and say whether to record VRT 2022-02-23 as a reviewed
   overnight move. Do not pick one yourself, and do not run anything until
   then.
2. Implement only the chosen remedy (with a `PARAMETER-LOG.md` entry if it
   changes a frozen file), re-run the readiness checklist and show it.
3. If every symbol is READY for warm-up, development and validation, run
   development and validation in both modes (`lab.startBacktest({ mode,
   split })` or `scripts/strategy-backtest.js`). **Do not run the
   holdout.** Report against `acceptance-v1.json` with trade counts and the
   outcome (not eligible, inconclusive or eligible for review; that last one
   is not permission to trade).
4. Commit reports only (no bars, no keys).

## Open items carried over

- The Pine script has not been compiled or run in TradingView.
- Listing exchanges (all 17) and the 2021–2026 calendar were verified on
  2026-10-22 against search excerpts of official pages plus Alpaca's own
  data (see the report). `corporate-actions-v1.json` and `calendar.js`
  `VERIFIED_NYSE` still carry the older status labels; updating them is
  optional and needs the owner's go-ahead.
- No unadjusted split was found in any symbol's bars. Only NVDA's two splits
  occur in the window.
- Twelve Data's free-plan coverage is unverified and its intraday bars are
  unadjusted; `/earliest_timestamp` is not implemented.
- `forward.js` has no Alpaca adapter; a real-time feed would be paid.
- The chat guard catches roughly two in three trade claims on unseen
  wording, and the trade-claim detector has known misses. The false
  positive "You hold 100 NBIS bought at 90." is still open.
