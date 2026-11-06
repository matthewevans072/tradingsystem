# Prospective journal 1: M1 (three down closes in an uptrend), with controls B0 and M0

**Status: SPECIFICATION.** Drafted 2026-11-05 on the owner's order (`EXPERIMENT-LOG.md` entry 9) and approved by the owner on 2026-11-06 with decisions D1 to D5 (entry 10, quoted verbatim there). This file is committed as the specification before the code; it is never edited after that commit. The implementation is pinned by a separate, later activation record (`prospective-1/ACTIVATION.json`); the start is derived from that record's commit (section 4.1).

## 0. What this is, and is not

An observational exercise: three frozen rules are run forward, one session at a time, on daily bars that did not exist when the rules were frozen, and every decision is time-stamped when it is recorded. **M1 n=3 is the only named rule; B0 and M0 are controls.** It does not overturn campaign 3's outcome: campaign 3 is closed as completed with no candidate (`EXPERIMENT-LOG.md` entries 7 and 8), and nothing here reopens it.

No capital, no broker, no orders, no paper-trading account, no notifications, no scheduled jobs. The owner runs each update by hand after the close (`npm run pj:update`). Every account is simulated: one US$15,000 primary account and one reconstructed account per rule.

## 1. The frozen implementation

### 1.1 The engine

- **rr-mech-2** (`server/research/mechanisms-2.js`, decision D3): a copy of rr-mech-1 with three additions and nothing else: **state restore** (the engine continues from a plain-JSON snapshot), an **entry veto** (in a late session the entry signals are recorded as `late_veto` skips and no order is placed) and **held exits** (in a late session an exit decision is placed as a held sell that never fills until it is released; section 3.4). The validation, the config hash and the indicators are imported from rr-mech-1 so that they cannot drift.
- **rr-mech-1** (`server/research/mechanisms.js`) stays byte-identical: it is campaign 3's engine, frozen at code revision rr-code-2026-11-05-1 (commit `12b9c0d15031e57f4440c3b76c9296e700efa633`, unchanged at `e005b46d9e02e86cc8f6d80be6a5d95ee6295122`; table 1.2).
- **Equivalence, required before activation:** rr-mech-2 with no veto and no release must reproduce rr-mech-1 exactly (every decision, fill, trade, skip, warning and equity point), on synthetic data for every campaign-3 mechanism config, continuous and restored from a mid-run snapshot (`tests/journal-engine.test.js`), and on the stored development data for experiments 180, 190 and 191 to the cent, read-only, with no campaign run recorded (`scripts/journal-repro.mjs`).
- **Versioning:** a correction that changes any decision or fill is a separately documented version (prospective journal 2, a new engine or code revision), never an edit of a pinned file, of this document or of the activation record.

### 1.2 Files at the frozen rr-mech-1 revision (measured 2026-11-05)

The activation record pins the final list: every file that affects a decision, a fill or the data, for rr-mech-2 and the journal, with its SHA-256 (LF-normalised text), the source commit, and the config and rule hashes. The journal checks every pinned hash at every update and refuses to run on any mismatch. The files below are those of rr-mech-1's path at e005b46; each of them stays byte-identical in the journal's source commit.

| File | Role | git blob at e005b46 | SHA-256 (LF-normalised text) |
|---|---|---|---|
| `server/research/mechanisms.js` | rr-mech-1 | d58daaaf32a08f97080a7c994181252c9ad48221 | 8cf33cb9cc458b829c32b4d6714a8b6ea255146bf280fa55e2d7a964313f77ad |
| `server/rangetrend/engine.js` | `sizeEntry` | 9eb688835e3427ad30e193e9047d00f7bcdff5df | 5682261c9bf07c08aac2be29a4eef713683974ca737194f0300fe97c8f24a5cc |
| `server/rangetrend/levels.js` | `EPS` for `sizeEntry` | 89e7e2a65702e2ece1b6d260beed1dc63c0015b9 | 58a93840a3d254f2c830724671944212b93530ecc14907ce72cd0132de6aa865 |
| `server/rangetrend/config.js` | loaded by `rangetrend/engine.js` | 46518493e74682d7dbd4a61e1695fe15cb562d81 | 3d73ac5ff333708671c2598327ede9a749d06ca37a2d7e9f1a1b02ab1acf86be |
| `server/hxr/engine.js` | `sellFees` | cce46116803f64ef748b22dd108964e8765bbce6 | c4f716393631a36c75c092b8eafca326505edf209fe1f82735ead407a0f78e16 |
| `server/strategy/config.js` | `canonicalJson` | 1c47bf0ca30febd667ad5ac0b1dde437ad5c5b62 | 4e612d852f06eb39d185b71af97fab63c2a19955fd7fa35be3406dc2f1914c50 |
| `server/calendar.js` | NYSE calendar, session bounds | fce2fa53174648e7bf845f697a60509b1a5ff373 | d8fd60782a7ac3a8a097d25c9d5f29d8ee780264dead255a091be5803c974145 |
| `server/time.js` | time zones | 21ce4a29fceb449aa1481aa9ab3abcd6d310ab92 | be58439b8151cb42de3cf22ba97853bb9c168f1d3f6f4d9695aa4925dcc09992 |
| `server/strategy/sessions.js` | `tradingDays` | afe0c14d1112e171a192711e4228dd6525e0f4c9 | 76cfbfb25748d076a933b7920ff11c0976b835b7cd4d3443fe486a40e879ec52 |
| `server/hxr/data.js` | `buildSpreadTable`, `halfSpreadFn` | 6459a90ab3335e8a2c608015dec53845c33dff84 | 6b00c8db604cb917eec1ea35a297808eca793d0509b324efff93ae740304847f |
| `server/hxr/config.js` | `halfSpreadFor`, `basketSymbols`, `excludedDates` | 9fbd95eb83f48b0bea74bafec4ee5e20cdeea8b2 | 229acca5d423172885e7565e4f12a3aeefbba396b94e03ea30a9e502df2af5fc |
| `server/hxr/store.js` | read-only bar reads | a815ff2d6aaed532dd7b779e0d35cb221fa31546 | 17513a481535339ba895b9179c9aff3e1533f2c7b24170e7e7abd65283657782 |
| `server/hxr/source.js` | the Alpaca client | 105a38f6e6d7d2f57d5b25e88a26813720896595 | 78dc5a7194a2120e55d293073573865202904bade36fe0ab687e5634a2c35a4e |
| `server/providers/http.js` | HTTP helper | 6941179d844df15c5c89bf05126b1aaf148fa508 | c08f0badf3877c2d8b9956a986f0cfb67ea501217dcb1e2f24f60584fb631a96 |
| `server/config.js` | `redact`, the `.env` reader | cd5d5d5b37f85bfc4c8d461477f9af5b7cf9fbed | 1e6d6de690f011c3355edd1b191286434268953eb29886f3abc832cc86403554 |
| `strategy/hxr/universe-hxr-v3.json` | basket A | 51bce2536295cc486e604715ff169db53d826329 | 50ab970196fe0921122698074d84f795b4e74a5dc1e32ad0c5d73ace5a4371b5 |
| `strategy/hxr/periods-hxr-v3.json` | excluded sessions | 91f39ea574fffe7ea87e7ad97b427e1caec54d99 | 51736ead44b9f48e700390838bab34c681b0d118aa47d3750f2dce4660abb2ac |
| `server/research/runner.js` | review only: `nullTest` | 6b43b91b5037bb5520d1a565676845f1bb7d7fad | 29a2ae5b15b6b72a2dd065ee232c0e92c6248fd6194e796e562e78d27b4fc805 |
| `server/rangetrend/metrics.js` | review only | 48da5ce59af392222874c16c01fae089b87d27f0 | 1855b78d2e7cfb9b63707c140ead7700650e5446621abe0246be61b47e52cdfb |
| `server/rangetrend/benchmark.js` | review only | c2c1bfe907ac0eb057f1c5a683e1ed7ae2c2fdeb | 448a8666f059d96a852f764c64f6347c8676251866de38e3f15feab305ad0769 |

### 1.3 The three rules (configs as stored for campaign 3, measured from `data/research-runner.sqlite`)

| Rule | Experiment | Stored config hash (period included) | Rule hash (period removed) | Params |
|---|---|---|---|---|
| **M1 n=3** (named rule) | 191 | a0c21dc7e99b694f3ca2319d3edede44b4021af7a2c47e027624adb05c64d80e | 9cfafe1e994e441cc13786790e3ac2fed4d4b90e046895f97cf8d1611ce15442 | down 3, exitSma 5, timeExit 10, stopM 2, filterSma 200, filter true; version `rr3-M1-down=3` |
| B0 (control) | 180 | 8602d82b6f8f00cf949150cc9ac9f7358f6e24b8bc3566cc230779b7ca9b420b | 7503f921d1013f2c71c0497c6013a2c23dd2dd9d9e5c28058b3b36177ddca3e9 | entry 20, exit 20; version `rr3-B0` |
| M0 (control) | 190 | 2a14be86d5e9fc6a092211ab7850e61539d36e7d43bb3c0ee1d65aa96b41a632 | dffa891fd4b4a812fbbe73043f7bc47760e89cca81bcb5aa5022c7c0c197a7fb | down 2, timeExit 10, stopM 2; version `rr3-M0` |

The rule files (`prospective-1/rules/m1.json`, `b0.json`, `m0.json`) are the stored configs with the period removed; their hashes equal the rule hashes above. The prospective config of each rule is its rule plus the period `{ basket A, warmupFrom, start, end: 2027-11-05 }`; its full config hash is pinned in the activation record.

The rules, exactly (CAMPAIGN-3.md section 2; C = close, O = open; levels from closes up to t−1): **M1 n=3**: entry at close t when C(t) < C(t−1) < C(t−2) < C(t−3) and C(t) > SMA(200)(t−1); exit at the first close with C(t) > SMA(5)(t−1), or at the close of the 10th session after the fill (the fill session is session 0); sizing reference S = C(t) − 2 × m(t−1). **B0**: entry when C(t) > HH(20)(t−1); exit when C(t) < LL(20)(t−1), rolling; S = LL(20)(t−1). **M0**: entry when C(t) < C(t−1) < C(t−2); exit at the first up close or at session 10; S = C(t) − 2 × m(t−1). m(t−1) = the mean of |C(u) − C(u−1)| over u = t−20..t−1; SMA(n)(t−1) = the mean of C(t−n..t−1); an undefined level gives no signal; S only sizes, it is never an order or an exit.

### 1.4 The shared block (unchanged from campaign 3)

```json
{"portfolio":{"startingCash":15000,"positionCapPct":20,"riskPerTradePct":1,"totalEntryRiskPct":5},
 "costs":{"commissionPerOrder":0,"commissionPerShare":0,"secFeeRate":0.0000206,"tafPerShare":0.000166,"tafMaxPerTrade":8.3,"halfSpread":"calibrated","halfSpreadFloorBps":2,"slippageBps":2},
 "dividends":{"withholdingPct":15},
 "execution":{"decision":"after_close","fill":"next_open","delaySessions":1},
 "benchmark":{"buyAndHold":"equal_weight_fractional_never_rebalanced"}}
```

Basket A: MU, AMZN, META, TSLA, VST, GOOG, INTC, CSCO, PYPL, SNAP. US$15,000 simulated per rule and account.

## 2. Execution conventions

- **Decisions:** at each session's close, on completed daily bars (Alpaca SIP, raw prices; splits and dividends applied by the engine). A session's bar is treated as final from 20 minutes after its regular close (`BAR_FINAL_AFTER_CLOSE_MIN`); an update before that does not process the session.
- **Simulated fills:** at the next session's open. Buy price = O × (1 + k), sell price = O × (1 − k), k = (max(calibrated half-spread, 2 bps floor) + 2 bps slippage) / 10,000. Sells pay the SEC fee (0.00206% of the sale value) and the TAF fee (US$0.000166 per share, at most US$8.30 per sale). Commission US$0. Whole shares. One position per stock; no adding.
- **Sizing:** at the decision close and again at the fill price: planned risk = shares × (price − S) at most 1% of the account value at the decision close, position at most 20%, total planned entry risk of open positions and pending orders at most 5%, same-day signals sharing cash and risk room equally; a fill at or below S is rejected and recorded; an order with no whole share is cancelled and recorded. A gap up at the open reduces the shares; it never raises them.
- **Dividends** net of 15% withholding, entitled at the ex-date for shares held at the start of that session, paid at the pay date. **Splits** applied to shares, history and levels on their effective date.
- **Costs (decision D2 (i)).** The frozen campaign-3 calibration (hxr-spread-2, floor 2 bps, hash e80c8ea1423b9d1f013b513d8ba37ed8943a501e74c813c0d665f57dbc93f371) is kept: every forward fill uses each stock's last calibration step, the 2026 running median of the opening-quote samples dated 2026-01-02, 03-02, 05-01, 07-01 and 09-01, which lie inside HXR's final period. These are historical, modelled costs, not verified future execution costs.
- **What daily bars cannot do.** A daily bar's open is one printed price. The journal cannot establish that an order would have filled at it, at what size, or at what spread; it cannot measure market impact, partial fills, queue position, opening-auction participation or real trading costs. Every fill and every cost in the journal is a model. **The journal cannot establish executable prices or real trading costs.**

## 3. Timeliness and the two accounts

### 3.1 Recording

Each update fetches the data, processes every session that is final and not yet processed, and writes everything in one transaction, synced to disk before it returns. `recorded_at` is stamped after the fetch and the processing, immediately before the write, and never earlier than the update's start. It is set once and never rewritten: every table is append-only by trigger.

**Clock.** `recorded_at` comes from the PC's clock (UTC). The update also stores the `Date` header of the Alpaca response and the offset between it and the PC clock; when the server is ahead, the offset is added before judging timeliness, so a slow PC clock cannot make a record on time. An offset over 120 seconds is recorded as `clock_check_failed`.

### 3.2 On time

A decision at the close of session t is **on time** if its `recorded_at` (corrected as in 3.1) is before the regular open (09:30 ET) of the next NYSE session; otherwise **late**. The flag is decided before processing from the update's start, and checked again against the stamp: if the stamp reaches the next open of a session processed as on time, nothing is recorded (`crossed_next_open`) and the next run records that session as late. An on-time decision is therefore durably recorded after its session closes and before the next session opens, using only the bars received up to its close.

### 3.3 The primary account (decision D3; the sample)

The primary account of each rule is an rr-mech-2 engine whose state is restored from its last stored snapshot at every update. **A late session's entries are skipped** (recorded as `late_veto` skips; no order, no cash reserved); **later signals and sizes come from this account's actual simulated state**, not from any other account. There is no filtered ledger.

### 3.4 Late exits

An exit decision on a primary position at a late session is placed as a **held sell**: it does not fill at the next open. The position stays held, marked to market at every close, with its cash still invested, its planned entry risk still counted, its splits and dividend entitlements applied, and it blocks any new entry in the stock. When the update's record is stamped, every held sell is **released to fill at the open of the first session whose open is after `recorded_at`**, marked `late_exit`. Why: a decision recorded after the next open could not have been executed at that open; the first open after the record is the earliest price at which the recorded decision is actionable under the next-open convention, and keeping the position until then keeps its risk and its cash constraint.

### 3.5 The reconstructed account

A second rr-mech-2 engine per rule processes every session as if recorded on time: the retrospective reconstruction. Its trades, including those the primary account skipped, are reported separately at the review and labelled **reconstructed**; they are never counted toward the sample.

### 3.6 Several missed sessions at once

An update that processes sessions t1..tn after missing some can record on time only tn, and only if it is stamped before tn's next open. The entries of t1..tn−1 are skipped in the primary account, and their exits on primary positions are held and released as in 3.4. A catch-up never adds a trade decided in a missed session to the primary account.

### 3.7 Never backfilled

A late record keeps its `recorded_at` and its late flag for ever. Sessions are recorded strictly in date order (a trigger refuses any earlier or repeated session), no live session is recorded before the start and no warm-up session at or after it, and nothing live before activation.

### 3.8 Data arrival, missing bars, revisions and corporate actions

- The journal stores the bars and corporate actions it used, as received, and replays every stored session from the warm-up start at every update; any stored state the replay does not reproduce stops the journal.
- A session with no bar for any basket stock waits. A session with some bars missing waits until its next open, then is processed with what has arrived (late); the missing stocks skip that close, as the engine does without a bar. A bar that arrives after its session was processed is stored, flagged `late_bar` and never used.
- A split recorded after its session was processed, or a corporate action of a type the journal does not handle (stock dividend, spin-off, merger, name change), pauses the journal until the owner resumes it with a reason. A raw close or open within 3% of 2, 3, 4, 5, 10 or 20 times the previous close (or the inverse) with no split recorded pauses it as well. A dividend recorded after its ex-date was processed is logged `late_dividend`, not applied, and listed at the review.

## 4. Start, warm-up and the closed windows

### 4.1 The start

The start is **the first NYSE session dated after the America/New_York date of the activation commit** (the commit that adds `prospective-1/ACTIVATION.json`), derived by the code from that commit and the exchange calendar; the record states the expected start, and activation is refused if the derived start differs. No decision is recorded for any earlier session. The warm-up starts 200 NYSE sessions before the start. The review date stays **2027-11-05**.

### 4.2 Coverage (measured read-only 2026-11-05, counts and dates only)

The last stored daily bar for every basket A stock in `data/hxr-sim.sqlite` is 2026-10-22. For a start on 2026-11-09, M1's 200 prior closes span 2026-01-23 to 2026-11-06: 189 stored per stock (every session present), of which **188** lie in HXR's final period / the range-trend reserve (2024-01-02 to 2026-10-21) and, for MU, **109** in the Strategy Lab MU holdout (2025-01-01 to 2026-06-30); 11 sessions (2026-10-23 to 11-06) are downloaded forward. The typical move's 21 prior closes need 9 closed-window closes per stock. A start on 2026-11-06 gives 190, 189, 110 and 10. No split is recorded for basket A since 2025-01-01. The exact bars read are recorded at activation.

### 4.3 Decision D1: A

**The stored closed-window closes are read once, read-only, for indicators only, and documented as an exposure.** At activation the journal copies from `hxr-sim.sqlite`, for basket A, the daily bars from the warm-up start to 2026-10-22 and the splits and cash dividends in that window, labelled by window; no decision, fill or result is computed on them. The exposure is recorded in the HXR, range-trend and Strategy Lab experiment logs (which bars, which dates, which symbols, MU's holdout overlap, and why); those windows are no longer described as untouched. All three rules are eligible from the start.

For the record of the alternative not chosen: under a forward-only warm-up, M1 would have become eligible on 2027-08-11, leaving 62 sessions before the review; the 19-trade figure is an illustrative projection at the development trade rate, not a probability forecast.

### 4.4 Data downloaded

Through HXR's Alpaca client only, by the journal's bounded downloader: basket A daily bars, splits and cash dividends, **from 2026-10-23 forward only**. It refuses any other symbol and any earlier date before a request. HXR's full download (which re-downloads from 2016) is never used for the journal. No quote sample is downloaded (D2 (i)); no other symbol; no evaluation-window access.

## 5. Reading rule (finite)

- **One review, on 2027-11-05**, after that session has been processed (the engine's period ends on it; nothing fills after it). The date is not extended and the threshold is not loosened.
- **Sample:** M1's primary-account trades **completed** by the review (entry decision on time, exit filled at or before the 2027-11-05 open). Positions open at the review are reported and not counted.
- **Decision D5:** if fewer than **30** completed on-time M1 primary trades, the figures are shown as descriptive results labelled **"insufficient sample"**; that is never treated as qualification. Thirty trades alone would not establish profitability either.
- **Reported for each rule** from its primary account: net P/L after modelled costs (equity at the 2027-11-05 close minus US$15,000), maximum drawdown, average exposure, total modelled costs, completed and open trades, rejections and cancellations; its exposure-matched hold (the forward equal-weight index scaled by the account's invested fraction) and the forward equal-weight index itself. **M1 against B0 and M0:** the net differences and their exposure and residual parts (the formula quoted in `reports/campaign-3-b0-vs-m1.md` section 5); the residual is not a measurement of skill.
- **The random-timing null on M1's forward primary-account trades only:** the trade-level diagnostic of `NULL-DIAGNOSTIC-NOTES.md`, **R = 20,000 resamples, seed 20271105**, drawing only from sessions from the start to 2027-11-05; one pre-specified test, so no Holm adjustment. B0's and M0's nulls are descriptions. **A non-pass means the diagnostic did not distinguish M1's timing from random placement, not that M1 has no edge.**
- The reconstructed accounts and the late dividends not applied are reported separately and never counted toward the sample. The review advances nothing, opens no evaluation window and authorizes nothing.

## 6. Visibility before the review

- **Visible throughout** (`npm run pj:status`): data received and missing per session; late bars and revisions; update times, `recorded_at`, on-time and late flags; clock checks; signals, entries and exits; simulated fills (date, side, shares, fill price); simulated positions (stock, shares, entry date, held); late vetoes, rejections, cancellations and reductions; pauses and errors; the count of completed on-time M1 primary trades.
- **Hidden until the 2027-11-05 session is processed:** every P/L, value, return or drawdown figure, per trade or in aggregate, for any rule or account; every comparison with the controls, the index or the exposure-matched holds; the null. The status computes none of them, and the review refuses to run earlier.
- **The blind is procedural.** Fill prices and shares are shown, so P/L could be worked out by hand; the protocol asks the owner not to, and records that the blind is not enforced beyond the tool.

## 7. Disclosure (verbatim)

"The journal tests timely signal production and forward simulated performance, including net profitability under the frozen execution and cost assumptions. It does not verify actual fills, establish future profitability or authorize real-money trading."

## 8. Sequence (decision D4)

1. This specification is committed (with research log entry 10).
2. The code is built and tested: rr-mech-2, the journal (`server/research/journal.js`, `journal-store.js`, `journal-download.js`), the command line (`scripts/journal.mjs`), the reproduction check (`scripts/journal-repro.mjs`), the rule files and the tests; the full suite runs; the code is committed (the source commit).
3. The activation record is written (`npm run pj:record -- --source <source commit>`) and committed separately: it pins the source commit, the SHA-256 of every decision-, fill- and data-affecting file of rr-mech-2 and the journal, the config and rule hashes, the calibration, the warm-up window and the expected start.
4. Activation (`npm run pj:activate -- --confirm`) checks the record against its commit and the working tree, copies the warm-up closes, freezes the calibration, and the exposure entries are appended to the three programmes' logs. Then the owner's manual updates begin (`npm run pj:update`).

## 9. Decisions (the owner, 2026-11-06)

D1 A (closed-window closes for indicators only, documented as an exposure in the HXR, range-trend and Strategy Lab logs). D2 (i) (the frozen calibration, with its 2026 closed-window quote samples documented; historical, modelled costs). D3 a stateful engine with state restore and an entry veto, rr-mech-2; no filtered ledger. D4 this specification committed first, then the code, then a separate activation record. D5 "insufficient sample" figures are descriptive results only, never a qualification.
