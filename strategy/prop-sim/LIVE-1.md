# prop-sim, live account 1 (Phase 2): the live simulated funded account

Simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid. **Running simulated result, not validated.** Stand-in, regular hours only, not futures.

Frozen on 2026-11-09, before any live bar was stored. The code was written and tested on synthetic streams first; this document and `live-1.json` are committed before the code that pins them, and the account is activated after both. Every number below is an experimental assumption (author-selected) unless it comes from `matrix-1.json` or the rules file, which are pinned and unchanged. A change to anything here is a new document and a new account, logged in `EXPERIMENT-LOG.md` with what had been seen; this account's records are kept.

## 1. What it is, and what it is not

The owner's Phase 2 order (EXPERIMENT-LOG.md entry 1, verbatim): watch the market as it trades and run a simulated Lucid account in real time with the frozen strategy from Phase 1. **Live data, data only:** no broker, practice/demo or paper-trading account, no login, no order routing. Nothing is sent anywhere; the app only reads market data and writes its own database.

Phase 1 (campaign 1, entry 23) found no configuration that passes more often than matched random entries. This account therefore shows how the frozen rules behave live and keeps an honest record; it is **not evidence of an edge**, its running result is never used to change a rule, and a good or bad stretch says nothing on its own.

## 2. The strategy (a new recorded experiment)

The order: "runs the frozen strategy from Phase 1 (or the best configuration Phase 1 found, frozen as a new recorded experiment; never tuned live)". No Phase 1 configuration qualified, so the account trades **the best configuration Phase 1 found by its pre-registered primary measure, the LucidFlex 50K pass rate: LB-NQ**, the plain level break on the NQ stand-in (9.9% of 1,096 attempts; the ICT families 0.0% to 2.6%; LB-ES 5.0%; LB-NQ also had the most first payouts, 49, and the least negative result per attempt after the assumed fee, −US$140.11). It did **not** beat its random twins (p 0.7452, Holm 1.0000). It is chosen by the order's rule, not because it showed anything.

The three ICT setups on the same market, **F1-NQ, F2-NQ and F3-NQ**, are detected live by the same code and shown on the dashboard as "seen, not traded", with the setup's entry and stop, so the owner can watch what they signal. They place no simulated trade and enter no account.

Everything else is `matrix-1.json` unchanged: the windows (09:30 to 11:30 and 13:30 to 15:30 New York), the flat-by time 15:55, the levels (previous session and previous calendar week highs and lows), the 5-minute bars, the minimum stop of 0.25 ATR, the 2R target, the 30-minute order life, two trades per window, one position at a time, 1 tick of slippage on entries and stops, US$0.50 per micro per side, the sizing (25% of the room up to US$400, whole micros, at most 40), MNQ at US$0.50 per tick. The code is Phase 1's: `signals.js` (`setupAt`, `execute`) and `account.js` (`applyTrade`, `stage`), called by `server/propsim/live.js`.

## 3. Data

- **Source:** the Alpaca Market Data API, free plan, IEX feed (`feed=iex`, raw), **QQQ** 1-minute bars of the regular session, converted to NQ stand-in points at 41.0 x QQQ in ticks of 0.25, exactly as in Phase 1. Only `https://data.alpaca.markets` is called; a redirect is never followed; the keys come from `.env` and are never printed.
- **Real time, measured:** on 2026-11-09 at 16:54Z a read-only check (nothing stored; timestamps and counts only) found the last completed 1-minute IEX bar of QQQ and SPY returned 21 seconds after its minute ended, every minute of the previous 24 present, while the free SIP feed was 861 seconds behind. The same check read the bar count of 10 minutes of 2026-11-06 IEX bars (11 bars) to confirm the free plan serves IEX history; no price was printed or stored. SIP is not used.
- **IEX is not the consolidated tape.** IEX carries a small share of the market's volume, so its 1-minute highs, lows and closes can differ from the SIP bars Phase 1 used; the levels and the ATR are computed from IEX bars. No rule here uses volume. Every figure is labelled.
- **No earlier data.** Nothing dated before the start session is requested, stored or read (the database refuses any bar before 2026-11-10, and the client refuses any request before it). The order's closed windows are historical periods; this account reads only its own sessions as they happen. As a result the first session has no previous-day or previous-week levels (no level-break trade is possible that day), and the previous-week levels exist from the second calendar week.
- **Reference bars:** after each session closes, the worker fetches that session's complete bars once, stored as "reference" and never live. They complete the levels and the ATR of later sessions (for example after a gap) and are never used for a decision, a fill or an exit.

## 4. Timing: decisions before fills

- The worker asks for new bars **5 seconds after each minute ends**, and again every 5 seconds until that minute's bar has arrived, for at most 45 seconds after the minute.
- A 1-minute bar is **live** when it arrived within **90 seconds** after its minute ended, before a bar of any later minute of the session, and before its 5-minute bucket was decided. Only live bars are used for decisions, fills and exits; every other bar is stored with `live = 0`.
- A minute is **observed** when a successful request was started within 90 seconds after it ended (the request's start time counts).
- A 5-minute bar is **decided** once every one of its minutes is judged (observed, or 90 seconds past with no request) and its last minute's bar has arrived (or a later one has, or 45 seconds have passed since the bar's end). The decision runs Phase 1's rules on the live bars up to that bar and is **recorded with its time, hash-chained, before any later bar is read**. A decision recorded more than **120 seconds** after its bar's end is **late**: its setups are not taken.
- **Fills only on later prices:** an entry can fill only on 1-minute bars that **start at or after the decision's recorded time, rounded up to the minute**. Phase 1 filled from the bar right after the 5-minute close; live, the decision is recorded a few seconds after that bar has started, so the earliest fill is one minute later. Otherwise exactly Phase 1: limits strictly through, 1 tick of slippage on entries and stops, the stop tested before the target, the target never on the fill bar, flat by 15:55, the order alive at most 30 minutes and only inside its window.
- With every decision recorded at its bar's close and every minute observed, this engine gives exactly Phase 1's trades on the same bars (tested on synthetic data for F1, F2, F3 and LB).

## 5. Gaps (a missed period)

- The first minute of a session that is not observed starts a **gap**: the PC off or asleep, the worker stopped or paused, the network or the feed down, an error.
- From the gap on, **nothing is decided or traded for the rest of that session**; a working order is cancelled at the gap; an **open position is closed at the close of the last live bar before the gap, less 1 tick** ("the account is flat across it"). A real broker's resting stop would have kept working during the gap; this rule can make the result better or worse than that, and the trade is labelled "closed at a gap".
- **Nothing is backfilled:** no decision or trade is ever made for a missed period. The dashboard shows every gap. A session the worker never observed counts as a session with no trades.

## 6. The account

- **One simulated account at a time:** LucidFlex 50K as recorded (`matrix-1.json` `accounts.primary`): profit target US$3,000; the 40% consistency rule; the end-of-day trailing Max Loss Limit of US$2,000, locked at US$50,100; at most 40 micros; **no daily loss limit on this plan** and **no news restriction on this plan** (the rules file: "Traders may enter or exit positions around scheduled or unscheduled news events on these plans without it being a breach"); flat by 15:55 (Lucid's own time is 16:45 Eastern).
- **A breach at the worst point** (the stricter reading): when an open position's worst point so far brings the live balance to the Max Loss Limit, the attempt fails at that moment, the same outcome Phase 1 gives at the trade's worst point.
- **An attempt:** the evaluation, at most 60 sessions (Phase 1's horizon; Lucid has no time limit, and the frozen sizing shrinks positions as the room shrinks, so a losing account would otherwise run on for ever); on a pass, the funded stage from the next session to the first payout (LucidFlex scaling, 5 days of at least US$150, 50% of the profit up to US$2,000), a breach, or 120 sessions. **The next evaluation starts at the session after the attempt ends.** The order says "starting fresh after a pass or failure"; here a pass leads into the funded stage first, as in Phase 1 and as the order's title says ("the live simulated funded account"), and the fresh evaluation starts when that stage ends. Every attempt is kept.
- **Fees:** US$175 per attempt, assumed (an unverified third-party price), shown beside every attempt; nothing is paid.

## 7. The dashboard (the Research page)

Refreshing every 5 seconds while open, labelled as above: the live chart of the session (5-minute bars with the trading windows, the previous day and week levels, the sweeps of a level, the breaks of structure, every setup as a dot, the simulated trades with fill, stop, target and exit, the flat-by time and the gaps); each setup seen, taken or skipped and why; the open simulated position with its stop, target, size and open result; today's result, the drawdown left, the daily loss limit left (none on LucidFlex), the progress to the profit target and the consistency share; every attempt with its outcome; the recent sessions with their gaps. The page reads only.

## 8. Records, checks and running

- Its own database `data/prop-sim-live.sqlite` (not in git): bars, requests, decisions, session reports and the log are append-only by trigger; CHECK constraints refuse anything dated before 2026-11-10; the guard refuses every other programme's file, Phase 1's included.
- The activation record (`npm run psl:activate -- --confirm`) stores the start session (the first NYSE session after the activation's New York date), the code revision, HEAD and the hashes of this document and `live-1.json`; the worker checks the pins and the committed code at least every 10 minutes and refuses to step while a pin differs or the live code has uncommitted changes (the missed minutes are then a gap).
- `npm run psl:verify` re-derives every recorded decision from the bars and requests stored up to its recording time and checks the hash chain.
- One worker at a time (heartbeat; a heartbeat older than 10 minutes can be taken over), started with `npm run psl:start`; Task Scheduler entries at logon and on weekdays from 07:00 local every 30 minutes make sure it runs; `npm run psl:pause|resume|stop`. A pause or a stop is a gap.
- No end date: it runs until the owner stops it.

## 9. Limitations

QQQ is not NQ: no overnight session, no futures roll, a fixed conversion ratio; IEX is a small share of the tape; the one-minute fill delay; the gap rule; the fee is unverified; the 60-session horizon is the simulation's, not Lucid's; and LB-NQ did not beat random entries in Phase 1. A few weeks of a running result are a handful of trades: no conclusion should be drawn from them.
