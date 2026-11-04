# Signal Desk: handover for a reader with no context

Written 2026-11-03 (Build 7). Everything below comes from the repository's code, logs and reports as of commit e3bd7dd on branch `hxr`; sizes and counts were measured that day. `JOURNAL.md` is the source of truth and is updated after every task; this file is the long, self-contained version and may lag it.

## 1. What this is, and is not

Signal Desk is a private web app that runs on the owner's Windows PC and binds to 127.0.0.1 only. It tracks the owner's holdings in USD and CAD (totals kept separate; combined only with a stored, dated Bank of Canada rate), follows news and filings about them, keeps an AI-infrastructure watchlist, produces three briefings a day, gives rule-based position assessments (HOLD / TRIM / SELL / WAIT / CONDITIONAL ADD) and answers questions through "Ask Signal Desk", a chat agent whose tools are read-only and whose only write path is a proposal the owner must confirm. The optional Claude analyst only explains; action labels come from rules.

It is not a trading system. There is no brokerage connection, no order code, no paper-trading path and no trading permission anywhere, and the owner has ruled out adding any. The strategy work beside it is simulation only: four programmes, each in its own SQLite file, each unable to read real holdings or cash, each pre-registered and gated so that a rule cannot be tuned on the data it is judged by.

Repository: private GitHub `matthewevans072/tradingsystem`; default branch `main`; all work since 2026-10-22 on branch `hxr`. Local folder: `C:\Users\matth\OneDrive\Desktop\trading system`.

## 2. Folder layout

| Path | Contents |
|---|---|
| `CLAUDE.md` | the assistant's protocol (under 40 lines); imports `CLAUDE-INVARIANTS.md` |
| `CLAUDE-INVARIANTS.md` | every invariant to preserve when changing code (moved verbatim from the old CLAUDE.md on 2026-11-03) |
| `JOURNAL.md`, `PROJECT_SUMMARY.md`, `PROJECT_HANDOVER.md` | the development journal (source of truth), the one-page summary, this file |
| `README.md`, `START-HERE.md` | overview; the owner's install and setup guide |
| `Start-Signal-Desk.bat` | starts the app on Windows |
| `server/` | the app, the chat agent (`agent/`), market-data providers (`providers/`), and the four simulations (`strategy/`, `hxr/`, `rangetrend/`, `sweepbos/`) |
| `public/` | the browser front end (no build step) |
| `tests/` | `node --test` suite, 65 files including helpers and fixtures |
| `scripts/` | command-line tools: briefing, backup, agent evaluation, Lab backtest, the gated launchers, the planted-bug harnesses |
| `strategy/` | research documents: the Strategy Lab's rules, specs, logs and reports; `hxr/`, `range-trend/`, `sweep-bos/` sub-folders with their pre-registrations, configs, experiment logs and reports; `pine/` the TradingView version |
| `data/` | databases and logs (git-ignored, never pushed) |
| `.env` | secrets (git-ignored); `.env.example` is the template |

## 3. Code map (one line per module)

**App server (`server/`)**
- `index.js`: HTTP server, local-only binding, Host, Origin and CSRF checks.
- `api.js`: the JSON API; every handler receives the active workspace context (real or demo).
- `db.js`: SQLite storage, additive migrations, audit trail.
- `portfolio.js`: positions derived from the transaction ledger: average cost, splits, daily P/L, FX decomposition.
- `importer.js`: CSV import, preview then apply, with de-duplication.
- `calendar.js`: NYSE/Nasdaq and TSX calendars (verified for 2026 and 2027).
- `freshness.js`: whether a stored quote is current, by the exchange calendar.
- `marketdata.js`: chooses providers; refreshes quotes, bars, FX and earnings.
- `providers/twelvedata.js`, `finnhub.js`, `sec.js`, `boc.js`, `demo.js`, `http.js`: provider adapters (Twelve Data, Finnhub, SEC EDGAR, Bank of Canada, synthetic demo data) and the shared HTTP helper.
- `news.js`: news and filings; all retrieved text is untrusted.
- `analytics.js`: price-history statistics from stored bars.
- `assessments.js`: the rule-based position assessments.
- `briefings.js`, `scheduler.js`, `alerts.js`, `delivery.js`: the three daily briefings, the scheduler and continuous monitor, alerts, delivery by in-app archive, SMTP or ntfy (all scheduled work OFF by the owner's rule).
- `analyst.js`: the optional Claude analyst (explanations only).
- `backup.js`: consistent SQLite snapshots.
- `catalog.js` + `catalog/securities.json`: plain-English security descriptions and the AI-infrastructure list.
- `config.js`, `context.js`, `log.js`, `time.js`: configuration from `.env`, the workspace context bundle, the redacting file logger, time-zone helpers.

**Chat agent (`server/agent/`)**
- `agent.js`: conversation storage and the tool-use loop; `tools.js`: read-only tools; `proposals.js`: proposed record changes (the only write path, after the owner confirms); `guard.js`: the trade-claim guard; `ledger.js`: the per-turn ledger of cited records; `calc.js`: hypothetical trade arithmetic; `prompt.js`: the system prompt; `backend.js`: the model backend; `suggestions.js`: suggested questions.

**Front end (`public/`)**
- `app.js`: shell, routing, workspace switch; `views/overview.js`, `positions.js`, `watchlist.js`, `intelligence.js`, `reports.js`, `settings.js`, `lab.js`, `hxr.js`: the pages; `lib/ui.js` (text nodes only, never innerHTML), `lib/charts.js` (SVG), `lib/chat.js` (the chat panel), `lib/api.js`.

**Strategy Lab (`server/strategy/`)**
- `engine.js`: the deterministic consolidation-breakout engine; `boxes.js`, `indicators.js`, `sessions.js`, `regimes.js`, `costs.js`: its parts; `data.js` and `sources/alpaca.js`: bars and the Alpaca 15-minute history source; `readiness.js`: the data-readiness checklist; `validation.js`: the pre-registered validation plan; `metrics.js`, `report.js`, `explain.js`: figures, reports, explanations; `lab.js`, `api.js`, `store.js`: the service, routes and database; `forward.js`: the simulated forward test (off); `webhook.js`: the optional TradingView alert receiver (off); `synthetic.js`: made-up bars for tests and the demo; `config.js`: config load, validate, hash.

**HXR (`server/hxr/`)**
- `config.js`, `store.js` (its own database with a file guard), `source.js` (the read-only Alpaca client, host allow-list, redirects refused), `data.js` (inputs, spread table, readiness), `engine.js`, `metrics.js` (G1 to G6, V1 to V2, both benchmarks, the pick rules), `service.js` (download, runs, ledgers, prospective account), `api.js`.

**Range-trend (`server/rangetrend/`)**
- `levels.js` (range and trend definitions), `engine.js` (sizing, fills, exits), `benchmark.js` (the equal-weight index), `metrics.js`, `pick.js` (the adopted pick rule as a report), `store.js` (results database with a lock row), `config.js` (pinned configs, protocol and log readers), `service.js` (gated practice runs).

**sweep-bos (`server/sweepbos/`)**
- `config.js` (paths, pins, code revision, windows, the 2022-12-30 bar bound, the log reader), `store.js`, `data.js` (bounded download, session filter, readiness, inputs), `rules.js` (pure rule functions in integer price units), `engine.js`, `metrics.js`, `service.js` (gate, runs, count-only mode, ledger, log entries).

**Scripts (`scripts/`)**
- `run-briefing.js`, `backup.js`, `agent-eval.js` (plays the model against the real tools without an API key), `strategy-backtest.js`, `strategy-compare-tv.js`, `strategy-pine-parity.mjs`, `rangetrend-run.mjs` and `rangetrend-planted.mjs`, `sweepbos-download.mjs`, `sweepbos-run.mjs`, `sweepbos-report.mjs`, `sweepbos-planted.mjs`.

## 4. How it works

**The app.** Holdings come from the owner's transaction ledger (BASELINE rows from statements, buys, sells), confirmed instrument by instrument (symbol, exchange, currency). Quotes, bars, FX and earnings come from the configured providers; a missing or stale value stays labelled, never estimated. Briefings and alerts exist but the scheduler, delivery and monitoring are OFF. The chat agent answers only from records it fetched in the turn, cites each one, refuses to claim trades were made, and can only propose a record change for the owner to confirm.

**The research method.** (1) A plan and rule sheet are written and committed first, with a hypotheses table marking each mechanical choice as the owner's instruction, a standard convention or the author's own synthesis. (2) Variant or config files are pinned by SHA-256 in code. (3) A gate in code refuses a run unless the pins match, the pre-registration commit is an ancestor of HEAD, the working tree is committed, the data version's hash matches, a "code frozen" log entry names the code revision, every earlier run is logged, the variant has not run and no other instance holds the lock. (4) Engines are deterministic and free of look-ahead; tests check prefix invariance, future-change invariance, snapshot round-trips and determinism. (5) A planted-bug harness mutates the code in a worktree and requires every listed bug to be caught by a named failing test. (6) Runs go into append-only ledgers; reports label every figure measured or derived; the owner reads a report before authorizing the next step and the owner's messages are quoted verbatim in the experiment logs under their real date.

## 5. Daily commands

| Purpose | Command |
|---|---|
| Start the app | `Start-Signal-Desk.bat` or `npm start` (http://127.0.0.1:4317) |
| Tests | `npm test` (575 tests on 2026-11-03: 573 pass, 1 skipped, 1 known failure in `tests/agent-safety.test.js` on weekend fixture dates) |
| Briefing now | `npm run briefing -- premarket` |
| Backup | `npm run backup` |
| Strategy Lab backtest | `npm run lab:backtest` (refuses unless every symbol is READY; never the holdout) |
| Range-trend | `npm run rt:run -- --check --config strategy/range-trend/configs/<file>` (check mode; `--run --confirm-run` needs the owner's authorization row); `npm run rt:planted` |
| sweep-bos | `npm run sb:run -- --check --round N --variant strategy/sweep-bos/variants/<file>` (`--count`, `--run --confirm-run`, `--pick`); `npm run sb:report -- --round N`; `npm run sb:planted`; `npm run sb:download` (bounded) |
| Environment | `node --version` (v24; 22.13+ required), `git status --short`, `df -h .`, `test -f .env && echo ok` |

## 6. Safety rules

- Simulation only; no broker, order, paper-trading or trading-permission code, ever.
- The owner's data (`data/signal-desk.sqlite`) is never written directly, reseeded or migrated destructively; the real workspace never shows demo data.
- Secrets only in `.env`; never printed, logged, committed or asked for in chat. Alpaca (`https://data.alpaca.markets`, redirects refused) is the only research data source; nothing from Yahoo; no futures data; bars never committed (personal, non-commercial licence).
- Scheduled monitoring, reminders, notifications and live order execution stay OFF; no paid service or API billing without the owner's approval.
- Pre-registered files, pinned configs and earlier log entries are never edited; a change is a new version plus a log entry saying which data had been seen. Holdouts and evaluation windows are never read without the owner's separate message. The owner's authorization rows are written by the owner only.
- Every figure measured or derived; every claim verified / tested / unverified; nothing described as profitable or live-ready; results on stand-ins are about the stand-ins only.
- Commit only when the owner asks or when a work order says to commit after each part; then push to `hxr` and report hashes, actual test counts and the planted-bug result. No review workflows or subagent fan-out unless the owner asks.

## 7. History in order, with test counts

| When | What | Tests |
|---|---|---|
| 2026-10-21 | Build 1: the app imported into its own repository; the chat agent with read-only tools, guarded proposals, the trade-claim guard and intent corpora, spend cap, streaming | not recorded |
| 2026-10-21 to 2026-10-22 | Build 2: Strategy Lab pre-registered (17 symbols, 15-minute bars, hypothetical US$100,000), engine, Pine version, Alpaca SIP source, data readiness (7 of 17 READY, then splits-v2 exclusions and 17 of 17), readiness gate | 261 → 283 |
| 2026-10-22 | Session 1: cb-1.0.0 runs 1 to 8 NOT ELIGIBLE (development trades 2 and 8, validation 0 and 1, against 60 required; B8 fails); cb-1.1.0 runs 9 to 12 FAIL the pre-holdout screen (S1 to S4); holdout never run; cb-1.0.0 closed with no v1.2 under the owner's limit | 283 |
| 2026-10-22 to 2026-10-23 | Build 3: HXR pre-registrations 1, 2, 3, 3a, 3b; the simulation module, prospective account, API and page; pre-run corrections | not recorded |
| 2026-10-23 | Session 2: HXR download (13 symbols, daily bars from listing, not before 2016-01-04); MU kept; development pick run once (runs 1 to 22): stop, no candidate qualified; post-run finding: tech/AI tags dropped (disclosed, not re-run) | not recorded |
| 2026-10-26 to 2026-10-27 | Build 4: HXR tags fix for new runs, codeRevision and symbolsHash on every run, read-only diagnosis, binding record, ENGINE-SPEC in-place edit disclosed, ENGINE-NOTES.md | 458 (457 pass, 1 skipped) |
| 2026-10-26 to 2026-11-02 | Build 5: range-trend plan v0.1 to v0.6, synthetic build, two fix passes, D1 to D8 recorded and implemented, protocol and gating, thresholds file, lock and backups, planted bugs 20 → 30 → 46 caught, pick rule and date rule adopted 2026-11-02, gated launcher | 479 → 509; harness 46 of 46 |
| 2026-11-03 | Build 6 + Session 3: sweep-bos pre-registered (commit 839ac73), bounded data version 1 (2018-06-01 to 2022-12-30), engine and harness, gated launcher, round 1 (8 runs, NONE), round 2 defined (cf577f5), count-only pass (e3bd7dd): 59 and 37 fills against 100, inconclusive, development closed; temp-leak fix in `tests/helpers.js` | 565 → 575; harness 59 of 59 |
| 2026-11-03 | Build 7: the persistent memory system (CLAUDE.md, CLAUDE-INVARIANTS.md, JOURNAL.md, PROJECT_SUMMARY.md, this file, .gitignore additions, memory notes); uncommitted | 575 (not re-run) |

## 8. Data on disk (measured 2026-11-03; none of it in git)

| File | Size | Contents |
|---|---|---|
| `data/signal-desk.sqlite` (+ WAL) | 4 KB + 1.05 MB | the owner's real workspace: holdings, entry prices, reports. Never written directly. |
| `data/strategy-lab.sqlite` | 79.1 MB | 17 symbols, 15-minute bars 2021-07-01 to 2026-06-30 (551,592 bars, 340 bar sets); runs 1 to 12; `lab_holdout_runs` empty |
| `data/hxr-sim.sqlite` (+ WAL) | 125.5 MB + 119.5 MB | daily bars, first-15-minute bars, corporate actions and spread samples for 13 symbols; runs 1 to 22; ledger row 1 (selection) |
| `data/sweep-bos-sim.sqlite` | 20.2 MB | QQQ and SPY 5-minute and daily bars 2018-06-01 to 2022-12-30 only (data version 1, hash e7a619d2…); runs 1 to 8; latest stored date 2022-12-30, 0 bars after it |
| `data/range-trend-sim.sqlite` | 49 KB | schema only; no run has ever been made |
| `data/logs/signal-desk.log`, `data/backups/` | small; empty | the redacted app log; backup folder |
| `tradingsystem.zip`, `tradingsystem-complete.zip` (root) | the owner's archives | excluded from git (`*.zip`) |

## 9. What the real data says

Every result so far is negative or inconclusive, and none is evidence of an edge:
- Strategy Lab cb-1.0.0: too few trades to judge (2 and 8 in development, 0 and 1 in validation) and NOT ELIGIBLE; cb-1.1.0 (target from risk): 58 validation trades, mean R -0.21, development mean R -0.02, 2 of 12 neighbours positive: FAILED, and the programme closed under the owner's pre-set limit. The holdout (2025-01-01 to 2026-06-30) has never been run.
- HXR: the development pick found no candidate that completed 10 round trips with a defined ending value. Nothing frozen; validation and final periods unused.
- sweep-bos: with the Boot Camp model mechanised on the prior regular session's high and low at 5 minutes, the eight round-1 variants gave 1 to 8 trades per instrument (100 required); the four round-2 relaxations, all combined, gave 59 fills on QQQ and 37 on SPY. The model, as read on these stand-ins, does not produce a sample the criteria can judge; this says nothing about ES, NQ, overnight-session levels or the discretionary original.
- Range-trend: no result exists; nothing has run on market data.

## 10. Open items

1. Range-trend practice runs: unauthorized until the owner writes the `**Practice runs authorized**` row in `strategy/range-trend/EXPERIMENT-LOG.md` (quoting their message, naming code revision rt-code-2026-11-02-1 and the eight rt-*-0.2.0.json configs). The code never writes it.
2. Range-trend `EVALUATION-THRESHOLDS.md`: Tier 3 thresholds and journal minimums `[OWNER TO SET]` before any evaluation result is accessed.
3. Strategy Lab forward test: not started (paid real-time feed; owner's approval).
4. Pine compile and fill check in TradingView: the owner's task; status unknown.
5. `tests/agent-safety.test.js` weekend fixture failure: unresolved.
6. CLAUDE.md's `@CLAUDE-INVARIANTS.md` import: confirm in a fresh session that the invariants are in context.
7. HXR manifest hash depends on line endings at checkout; recorded in `strategy/hxr/ENGINE-NOTES.md`.
8. The 24 phantom ` M strategy/hxr/*` lines in `git status` (CRLF); cosmetic; never touch them.
9. Build 7's files are uncommitted; the owner decides.

## 11. If the assistant's memory is gone

Paste this sentence into a new chat, exactly:

> Open the folder C:\Users\matth\OneDrive\Desktop\trading system (git branch hxr), read CLAUDE.md, then JOURNAL.md's Start here, Where things stand, the open list and the last two entries, then PROJECT_SUMMARY.md and PROJECT_HANDOVER.md; run npm test; then tell me in about 10 lines what was last done, what is verified versus only tested, what is built but not enabled, the next step and anything waiting on me; do not start any work until I say so.
