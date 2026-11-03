# sweep-bos: pre-registered rule sheet, version 1

**Status:** pre-registered for round 1. This file is committed, with its SHA-256 recorded in EXPERIMENT-LOG.md, before any QQQ or SPY bar is downloaded (the commit hash is recorded in the log and pinned in `server/sweepbos/config.js`). It is never edited after that commit: a rule change is a new file version (`PRE-REGISTRATION-2.md`) with a log entry saying which data had been seen.

**What is tested.** The sweep -> break of structure -> pullback model (the "TJR Boot Camp" model as taught in the 2023 Boot Camp, sections 1 and 3 of the owner's uploaded summary), as one mechanical rule set on QQQ and SPY 5-minute bars, regular session only, as labelled STAND-INS for NQ and ES.

**What is not tested, said plainly.** The original uses the overnight and pre-market session highs and lows (the Asian and London sessions, the pre-market range) as the levels that get swept. Regular-session equity bars have no such levels, so this rule sheet sweeps the prior regular session's high and low instead. Results therefore do not test ES or NQ, and do not test the original's session-level logic; they test one mechanical reading of the model on the cash ETFs' regular session.

**Simulation only.** No broker, order or paper-trading code; no real holdings or cash; no futures data; nothing from Yahoo; Alpaca market data is the only source and its keys stay in `.env`. Bars are never committed (licence: personal, non-commercial).

## 1. Data

1.1 **Instruments and source.** QQQ and SPY. Alpaca SIP feed, raw adjustment (neither ETF has a split in the window; dividends are neither adjusted for nor used). Only `https://data.alpaca.markets` is called, through the project's existing Alpaca client (redirects refused, host allow-list).

1.2 **5-minute bars.** A bar with start time t (America/New_York, by the IANA time-zone database, so daylight saving is handled) belongs to NYSE session d (`server/calendar.js`: holidays and early closes) when t is one of 09:30, 09:35, ..., 15:55, or ..., 12:55 on an early-close session. Its index is i = (t - 09:30) / 5 minutes: 0..77 on a full session, 0..41 on an early close; n = 78 or 42 is the session's full count. Every other bar (pre-market, after-hours, a timestamp not on a 5-minute boundary, a non-session day) is dropped and counted. The time-stamped bar covers [t, t + 5 min).

1.3 **Daily bars.** Alpaca's regular-session daily bar, one per NYSE session. They provide the prior-session levels (3.3) and the daily bias (3.2). The readiness check counts sessions where the daily high or low differs from the 5-minute bars' session high or low by more than 0.01 (reported, not corrected).

1.4 **Incomplete sessions (data rule).** A session whose stored bar count is below its full count n is INCOMPLETE. An incomplete session is never traded, never serves as the prior session of the next session (which is therefore not traded), and is skipped (not counted) by the 20-session buffer window (3.6 A). A session with no daily bar is treated the same way. The sessions listed in `strategy/hxr/periods-hxr-v3.json` `excludedSessions` are reported by the readiness check; they are excluded only by this rule, which is mechanical.

1.5 **Windows** (the owner's choices, recorded on sending the authorizing message, EXPERIMENT-LOG.md entry 1). Warm-up for daily bars and the buffer: from 2018-06-01. DEVELOPMENT: 2019-01-02 to 2022-12-30 (rounds 1 and 2). EVALUATION: 2023-01-03 to 2024-12-31: not downloaded, opened or read in this task (Part F needs the owner's separate message and a new data version). The Strategy Lab's holdout window 2025-01-01 to 2026-06-30 is never read or downloaded. Download bound for this task: no bar after 2022-12-30 (`server/sweepbos/data.js` refuses a later date; the readiness check and the run gate assert the stored maximum).

1.6 **Disclosures.** SPY 2022-2024 was used by a different strategy (consolidation-breakout) in the Strategy Lab and its results were viewed; QQQ is not in that universe; the owner has watched these markets; none of it is independent of the owner. The author of this rule sheet (the assistant) wrote it without having read any QQQ or SPY bar of the window; after the download it reads readiness counts only, never bars, before the runs.

## 2. Decision-time rule

Every rule below uses only: the 5-minute bars of session d with index <= k (a decision "at the close of bar k"), all bars of earlier sessions, and the daily bars of sessions before d. An order placed at the close of bar k can fill only on a later bar of the same session, at a price that bar trades through. Nothing reads a later bar. The engine is deterministic: the same bars and variant give byte-identical results.

## 3. Definitions

Long side; the short side is the mirror (highs and lows, < and >, + and - swapped) unless stated. Prices are in dollars with cents; comparisons are exact on the stored values.

3.1 **Swing points (5-minute, session-local).** Bar i of session d (1 <= i <= n - 2) is a SWING HIGH when H[i] > H[i-1] and H[i] > H[i+1]; a SWING LOW when L[i] < L[i-1] and L[i] < L[i+1]. Strict on both sides: equal highs form no swing. A swing at i is CONFIRMED at the close of bar i + 3 (three later bars of the same session are complete). At the close of bar k the confirmed swings are those with i + 3 <= k. Swings are session-local: the previous session's bars are not part of today's structure. (HYPOTHESIS H1, H2: the 3-bar fractal and the 3-bar confirmation are the owner's mechanical choices; session-local scope is the author's.)

3.2 **Daily swings and bias.** On the stored daily bars of sessions up to d - 1 (index j, last index J), a daily swing high at j (1 <= j <= J - 1) when H[j] > H[j-1] and H[j] > H[j+1], confirmed when j + 3 <= J; swing lows mirror. Let SH1 and SH2 be the two most recent confirmed daily swing highs (SH2 the later) and SL1, SL2 the two most recent confirmed daily swing lows. BIAS for session d is LONG when H[SH2] > H[SH1] and L[SL2] > L[SL1]; SHORT when H[SH2] < H[SH1] and L[SL2] < L[SL1]; otherwise NONE (fewer than two confirmed swings of either kind is NONE). Variants with bias "on" trade only in the bias direction and not at all when it is NONE; variants with bias "off" ignore it. (HYPOTHESIS H3, author's synthesis: the original's bias is discretionary.)

3.3 **Prior-session levels.** PDH and PDL are the high and low of the daily bar of the previous NYSE session (`previousTradingDay`). If that session has no daily bar or is INCOMPLETE (1.4), session d is not traded.

3.4 **Sweep.** The SWEEP WINDOW is bars with index 0..5 (start 09:30 to 09:55; the bar starting 10:00 is outside it). A LONG SWEEP bar s has L[s] < PDL and C[s] > PDL (the bar trades below the prior low and closes back above it). A SHORT SWEEP bar has H[s] > PDH and C[s] < PDH. A bar that satisfies both is neither (skipped). With bias on, only the bias direction counts. The first qualifying bar opens the session's SETUP with that direction. The SWEEP EXTREME is min(L[s..k]) over every bar from s up to and including the bar being examined (it keeps updating until the break of structure). (HYPOTHESIS H4: the owner's definition; H5, author's: both-sides bars skipped; H6, author's: the extreme follows the lowest low of the leg, not only the sweep bar.)

   Invalidation: while the setup waits for a break of structure, a bar k > s with C[k] < PDL (a close back beyond the swept level) voids the setup; a new sweep bar may open a new setup only if it is still inside the sweep window (index <= 5). (HYPOTHESIS H7, author's synthesis.)

3.5 **Break of structure (BOS).** At the close of a bar k > s with k <= 11 (its close is at or before 10:30:00), let i* be the most recent swing high confirmed BEFORE that close (the largest i with i + 3 <= k - 1). A BOS occurs at k when C[k] > H[i*] and no earlier bar j with i* < j < k closed above H[i*] (bar k is the first close above it). No confirmed swing high, or one that an earlier bar already closed above, gives no BOS until a newer swing high is confirmed. i* may be before or after s. The BOS bar's close is the decision time for the zone, stop and target. (HYPOTHESIS H8: the owner's "confirmed before that close" read strictly; H9, author's: first-close-above rule.)

3.6 **Stops**, fixed at the BOS close.
   - **Variant A (sweep):** STOP = SWEEP EXTREME - BUFFER. BUFFER = the median of (H - L) over the first-hour bars (index 0..11) of the 20 most recent COMPLETE sessions before d (1.4), rounded to the cent (half up); the median of an even count is the mean of the two middle values. Fewer than 20 such sessions: no trade. (The owner's definition.)
   - **Variant B (second swing, the 2026 model):** let SL(1) and SL(2) be the most recent and the second most recent swing lows confirmed at the close of bar k (i + 3 <= k, session-local). STOP = L[SL(2)] - 0.01. Fewer than two: no trade. (HYPOTHESIS H10, author's reading of "beyond the second confirmed swing": one cent beyond, no buffer.)

3.7 **Zones**, fixed at the BOS close. LEG LOW bar LAMBDA = the latest bar j in [s, k] with L[j] = SWEEP EXTREME. The DISPLACEMENT LEG is bars LAMBDA..k.
   - **Order block:** the latest bar j <= LAMBDA with C[j] < O[j] (a bearish bar; C = O is not one), searched back to index 0 of session d. Zone [L[j], H[j]]; ENTRY = H[j] (the near edge). None: no trade.
   - **Fair value gap:** among the triples (a, a+1, a+2) with LAMBDA <= a and a + 2 <= k and H[a] < L[a+2], the one with the largest a. Zone [H[a], L[a+2]]; ENTRY = L[a+2] (the near edge). None: no trade.
   - Both require ENTRY < C[k]; otherwise no trade (price is not above the zone, so there is no pullback to it). Equilibrium is not used in round 1.
   (HYPOTHESIS H11: the standard conventions as the owner wrote them; H12, author's: the leg starts at the latest bar at the extreme, the latest gap is used, and the entry must be inside the BOS close.)

3.8 **Risk and target.** RISK = ENTRY - STOP, required > 0 (else no trade). T = PDH. Required: T - ENTRY >= 1 x RISK (else no trade; a target at or below the entry fails this). (The owner's definition.)

3.9 **Order and fill.** A buy limit at ENTRY is placed at the close of bar k and is good for bars m = k + 1 .. 11 (start at or before 10:25): it fills on the first such bar with L[m] < ENTRY (the bar trades strictly through the limit), at the price ENTRY (also when the bar opened below ENTRY). Not filled by bar 11: EXPIRED, and nothing else is traded on d. One setup per session per instrument: the first BOS places the session's only order; one trade per instrument per session; no re-entry after a stop or any exit that session. No new trade after 10:30 ET: nothing fills at or after the bar starting 10:30. (HYPOTHESIS H13, author's: strictly-through fills at the limit; one setup per session.)

3.10 **Exit.** On the fill bar m: if L[m] <= STOP the trade is stopped on the same bar, exit at STOP; the target is not tested on the fill bar. On each later bar q with m < q <= n - 2: if L[q] <= STOP, exit at min(STOP, O[q]) (the stop is taken first, even when H[q] > T on the same bar); else if H[q] > T, exit at T. Still open after bar n - 2: TIME STOP, exit at O[n-1], the open of the session's last bar (15:55, or 12:55 on an early close). No partials, no break-even move. (HYPOTHESIS H14: stop-first and the 15:55 time stop are the owner's; the fill-bar rule and the gap-through stop price are the author's.)

3.11 **Costs and R.** Per side c = 0.01 half-spread + 0.01 slippage = 0.02 per share, $0 commission (experimental assumptions, author's synthesis). Long: entry paid = ENTRY + c, exit received = EXIT - c; R = (exit received - entry paid) / RISK. Short: entry received = ENTRY - c, exit paid = EXIT + c; R = (entry received - exit paid) / RISK. The 2x-cost sensitivity uses c = 0.04 on the same fills (derived, not re-simulated). The planned risk is the pre-cost distance RISK.

3.12 **Mirror trade (for the random-direction null).** For each filled trade, the opposite direction at the same fill bar m and the same price ENTRY, with the same distances (stop at ENTRY +/- RISK on the other side, target at the same distance on the other side), exited by 3.10 on the same bars with the same costs, giving R_mirror.

3.13 **Secondary dollar account (information only).** US$15,000 at the start of each (variant, instrument) run; shares = floor(cash / (ENTRY + c)) for a long, floor(cash / ENTRY) for a short (cash-limited, whole shares, no leverage); cash changes by shares x (R x RISK). Its ending value is never the pick.

## 4. Round-1 variants (eight, defined before any data was seen)

zone {order block, fair value gap} x stop {A sweep, B second swing} x daily bias {on, off}: `strategy/sweep-bos/variants/sb-{ob|fvg}-{a|b}-{bias|nobias}-0.1.0.json`. Every other setting is identical and is declared in each file. The files are pinned by SHA-256 in `server/sweepbos/config.js`; a pinned file that differs is refused. No change to a frozen variant after it has run.

## 5. Criteria, candidate and pick rule (pre-registered)

Per variant and instrument, after the development period:
- **C1** at least 100 completed trades.
- **C2** mean R after costs > 0, and the bootstrap 95% interval's lower bound > 0 (6.1).
- **C3** mean R at 2x costs > 0.
- **C4** better than the random-direction null at one-sided p < 0.05 (6.2).
- **C5** mean R > 0 without the best 5% of trades (6.3).
- **C6** no single month holds more than 40% of the gross gains (6.4).

A variant is a CANDIDATE only when C1-C6 all pass on QQQ and all pass on SPY (separately; the pair together is reported but never qualifies alone). If the two instruments differ, both are reported and the variant is not a candidate.

**Pick rule.** Candidate variants are compared on pooled mean R (all trades of both instruments); the highest wins. Ties within 0.02 R (|difference| <= 0.02 after rounding to 1e-6) go to the smaller pooled maximum drawdown in R; still tied: NONE advances. If no variant qualifies, NONE advances. The best ending value of the dollar account is never the pick. Stopping with "none advances" is a valid, expected outcome.

## 6. Statistics (exact definitions)

PRNG: mulberry32 (a = seed; each draw: a = (a + 0x6D2B79F5) >>> 0; t = a; t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); u = ((t ^ (t >>> 14)) >>> 0) / 2^32). An index draw is floor(u x n).

6.1 **Bootstrap interval.** 10,000 resamples of the n trade R values with replacement (seed 20261103, one generator for the whole resample set, trades in exit order); the mean of each; sorted ascending; lower bound = the 250th smallest (index 249), upper = the 9,750th smallest (index 9749).

6.2 **Random-direction null.** 1,000 simulations (seed 20261104). In each, every trade independently keeps its actual R (u < 0.5) or takes its R_mirror (u >= 0.5), and the mean over the n trades is recorded. p = (1 + number of simulations with mean >= the actual mean R) / (1 + 1000). The report gives the null's mean, 5th, 50th, 95th and 99th percentiles (nearest-rank) and p.

6.3 **Best 5% removed.** K = ceil(0.05 x n), at least 1; remove the K trades with the largest R (ties: the earlier exit first); the mean of the rest.

6.4 **Monthly share of gross gains.** Gross gains G = the sum of positive R values. For each calendar month (of the entry session), share = (sum of positive R of trades entered that month) / G. C6 passes when the largest share <= 0.40 after rounding to 1e-6. G = 0 fails C2 and is reported as undefined here.

6.5 **Other figures.** Win rate = trades with R > 0 / n. Median R: the middle value (mean of the two middle values when n is even). Profit factor = sum of positive R / |sum of negative R| (undefined when there is no loss). Maximum drawdown in R = the largest peak-to-trough fall of the cumulative R in exit order. Average holding time = mean of (exit bar start - fill bar start + 5 minutes). Exposure by hour = bars held (fill bar to exit bar inclusive) per ET hour, as counts and as a share of all held bars. Costs per trade = 2c per share round trip (0.04 at 1x) and its mean in R (mean of 2c / RISK). Stage counts = sessions in the window, then how many ended at each stage (7).

## 7. Stages (reported for every run, used by the Part E diagnosis)

Each session of each instrument ends at exactly one stage: `incomplete_session` (1.4), `no_prior_session`, `no_bias` (bias on only), `no_buffer` (A only), `no_sweep`, `sweep_invalidated` (a sweep opened but was voided and no later sweep opened), `no_bos` (a setup waited until bar 11 without a BOS), `no_zone`, `entry_not_below_close`, `no_second_swing` (B only), `stop_not_below_entry`, `target_too_close`, `order_expired`, `filled`. Filled trades end `stop` (with `stop_same_bar` counted separately), `target` or `time`.

## 8. Hypotheses: discretionary source, mechanical version chosen (for the owner)

| # | Source element (discretionary) | Mechanical version used | Origin |
|---|---|---|---|
| H1 | swing high / low | 3-bar fractal, strict on both sides | the owner's instruction |
| H2 | when a swing "counts" | confirmed only after 3 later bars | the owner's instruction |
| H3 | daily bias | last two confirmed daily swing highs and lows both rising (long) or both falling (short); otherwise no trade | author's synthesis, not TJR's |
| H4 | the level swept | prior regular session's high or low (the original's session levels are unavailable, see the preface) | the owner's instruction |
| H5 | a bar sweeping both levels | neither direction; skipped | author's |
| H6 | the sweep extreme | the lowest low from the sweep bar through the BOS bar | author's |
| H7 | a failed sweep | a close back beyond the level voids the setup; a new sweep only inside the window | author's |
| H8 | break of structure | first close above the most recent swing high confirmed before that close | the owner's instruction, read strictly |
| H9 | an already-broken swing | gives no BOS; wait for a newer confirmed swing | author's |
| H10 | stop B "beyond the second confirmed swing" | one cent beyond the second most recent confirmed swing low at the BOS close | author's reading |
| H11 | order block, fair value gap | last opposite-colour bar at or before the leg's extreme; latest three-bar gap in the displacement leg | the owner's standard conventions |
| H12 | where the leg starts; which gap | the latest bar at the extreme; the latest gap; entry must be inside the BOS close | author's |
| H13 | the entry order | limit at the near edge, placed at the BOS close, fills only strictly through, at the limit, until 10:25's bar; one setup per session | the owner's (limit, 10:30) and author's (strictly through, one setup) |
| H14 | exits | stop first on an ambiguous bar; stop checked on the fill bar, target not; gap-through stops exit at the open; time stop at the last bar's open | the owner's (stop first, 15:55) and author's (the rest) |
| H15 | time stop, one trade per day, no re-entry, cost numbers | as the owner set them | author's synthesis, not TJR's |

Everything marked "author's" or "author's synthesis" is not TJR's teaching; it is the most conventional mechanical version the author could define from closes and bars available at the decision time.

## 9. Budget and change control

- Round 1: exactly these eight variants, each run once per instrument on the DEVELOPMENT window, through the gated launcher (`scripts/sweepbos-run.mjs`), every run logged including failures.
- Round 2 (only after the owner has read the round-1 report): at most four new variants, each defined and committed (pinned) before it runs; never a change to a frozen variant after it has run.
- The evaluation window is read once, for one owner-frozen variant, after the owner's separate message (Part F, not authorized here).
- Profit found by repeated retesting on the same data is not evidence; the report says so with every figure.
