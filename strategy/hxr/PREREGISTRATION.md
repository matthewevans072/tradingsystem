# HXR — pre-registration (version hxr-prereg-1)

Written 2026-10-22, **before any HXR backtest, simulation or result
existed**. The git commit that adds this file is the evidence of when it was
fixed. Nothing here is the owner's approved preference: every number marked
**experimental** is a labelled research assumption, chosen so testing can go
ahead while the owner's personal risk questions are still unanswered.

Simulation only. No real money, no brokerage connection, no order sent
anywhere, no reminders or notifications. Moving anything to real money needs
a separate, explicit instruction from the owner.

## 1. What HXR is (the owner's approved reading)

The owner did not supply written HXR rules; on 2026-10-22 the owner chose
this reading:

- **Hold (H).** Start fully invested in the chosen stocks, in equal amounts,
  from a simulated US$15,000. No borrowing, no short selling, cash never
  below zero.
- **Exit (X).** Sell one stock to cash when a price rule says its trend has
  broken.
- **Re-enter (R).** Buy it back when a price rule says it has recovered.
- **News.** Not part of the historical test. It is recorded, with
  timestamps, only in the prospective simulated account (section 9).
- **Judged against** simply holding the same stocks, from the same US$15,000,
  over the same dates, with the same costs, dividends and whole-share rule.

Historical results test the **price rules only**. They are never evidence
for a news-informed HXR.

## 2. Stocks (owner's list, 2026-10-22)

| Owner's name | Listing used | Usable price history (Alpaca SIP daily) | Use |
|---|---|---|---|
| Micron | MU (Nasdaq) | from 2016-01-04 | basket A and B |
| Amazon | AMZN (Nasdaq) | from 2016-01-04 (20-for-1 split 2022-06-06) | basket A and B |
| Meta | META (Nasdaq) | from 2016-01-04 (traded as FB until 2022-06-09) | basket A and B |
| Tesla | TSLA (Nasdaq) | from 2016-01-04 (5-for-1 2020-08-31, 3-for-1 2022-08-25) | basket A and B |
| Vistra | VST (NYSE) | from 2017-05-10 | basket A and B |
| Robinhood | HOOD (Nasdaq) | from 2021-07-29 (IPO) | basket B |
| Direxion Daily MU Bull 2X | MUU (Nasdaq) | from 2024-10-10 (20-for-1 split 2026-07-15) | basket B |
| Nebius | NBIS (Nasdaq) | **from 2024-10-21 only** | basket B |
| SpaceX | SPCX (Nasdaq) | from 2026-06-12 (about 90 sessions) | prospective account only, **pending owner confirmation** |

Notes, all from step 1 checks on 2026-10-22:

- **NBIS before 2024-10-21 is Yandex.** Alpaca maps YNDX's history
  (2016–2022) to NBIS, then 2022-02-28 to 2024-10-18 is a trading suspension
  filled with zero-volume bars. Yandex's Russian business was sold in 2024,
  so that history is a different company and is never used.
- **SPCX was a different security until 2026-04-07.** The old SPCX (an ETF,
  CUSIP 19423L672) was renamed SPCK. SpaceX listed on Nasdaq as SPCX on
  2026-06-12 (IPO reports and Alpaca's name-change record). Alpaca still
  lists 6 old cash dividends under the symbol, so dividends before the
  listing date are ignored. Under Signal Desk's identity rule SPCX stays
  unconfirmed until the owner confirms it; until then it is not priced
  anywhere in HXR.
- **MUU is a 2× daily-reset leveraged fund on MU.** Its value decays in
  choppy markets relative to 2× MU's return, and its spreads are wider. It is
  included because the owner holds it.
- **META** history before 2022-06-09 is FB (same company and CUSIP).

**Basket A** (long history): MU, AMZN, META, TSLA, VST. Five sleeves of
US$3,000.
**Basket B** (the owner's list with enough history): MU, MUU, NBIS, HOOD,
AMZN, META, TSLA, VST. Eight sleeves of US$1,875.

## 3. Account rules (both HXR and the hold comparison)

- US$15,000 starting cash, USD account, **equal sleeves**: each stock gets
  1/N of the cash and its own sleeve. Cash freed by an exit stays in that
  stock's sleeve and is used only to buy that stock back. No rotation
  between stocks, no rebalancing.
- **Whole shares only.** Leftover cash stays in the sleeve. The same rule
  applies to the hold comparison.
- No borrowing, no short selling, no negative cash. A buy uses
  `floor((sleeve cash − fees) / (price × (1 + k)))` shares.
- Account value is marked to market at each session's close (cash plus
  shares × close). No liquidation cost is deducted at the end, for either
  arm.
- **Cash earns 0%** (experimental; conservative for HXR, because HXR sits in
  cash more).
- **Dividends** are credited on the pay date for shares held at the start of
  the ex-date session (so a stock sold at the ex-date open still earns it).
  **15% withholding** (experimental: the rate for a Canadian resident outside
  an RRSP; 0% inside an RRSP). Same for both arms. A 0% variant is reported.
- **Splits** multiply the shares held from the split's first session. The
  ledger uses actual (raw) prices; rule signals use split-adjusted closes.

## 4. When decisions and fills happen

- Every decision is made **after the close** of a session, from completed
  daily bars only.
- The order fills at the **next session's open** (one session of delay). A
  gap through the level is taken at the gapped open; there is no intraday
  stop.
- **Assumed fill price**: the daily bar's open, plus (buy) or minus (sell)
  `k = half-spread + slippage`.
- **Realistically available fill** (reported, not used for the main
  result): the volume-weighted average price of the first 15-minute bar
  (09:30–09:45 ET), plus or minus the half-spread. Step 1 found that the
  daily open is the first trade at 09:30 on any venue, not the opening
  auction, and differs from it by a median of about 3 bps (up to 61 bps).
- If a stock has no bar on the fill session, the order waits for its next
  bar and the delay is journalled.
- At most one pending order per sleeve. No new signal is evaluated for a
  sleeve while its order is pending.

## 5. Costs (experimental where marked)

| Cost | Rule |
|---|---|
| Commission | US$0 per order: Questrade's published US-stock pricing (search summary, 2026-10-22; not checked on the live page) |
| SEC fee (sells) | 0.0000206 × sale value |
| FINRA TAF (sells) | US$0.000166 per share, at most US$8.30 per trade |
| Half-spread | **calibrated per stock and calendar year**: the median quoted half-spread (SIP NBBO) in the first minute after the open, on the first trading day of January, March, May, July, September and November, with a floor of 2 bps. The method is fixed here; the values come from quote data, not from any result. Before a stock's first sampled day the floor applies. |
| Slippage | 2 bps on every fill (experimental) |
| Currency conversion | none: the account is in USD. Converting from CAD at Questrade would cost about 1.5% each way; not modelled. |

Stress versions: spread and slippage doubled; fills one session later (two
sessions of delay).

## 6. The candidate rules (experimental, not the owner's preferences)

Three candidates from three families. Signals use split-adjusted closes up
to and including the decision session. The numbers are conventional round
values, fixed now and never tuned.

| | Exit to cash when the close… | Buy back when the close… | Why this rule |
|---|---|---|---|
| **C1 — moving-average band** | is more than 2% below its 100-session simple average | is more than 2% above its 100-session simple average | The most common trend filter; the 2% band reduces flip-flopping around the average. |
| **C2 — volatility trail** | is more than 3 × the stock's typical daily move below the highest close since the sleeve last bought | is more than 3 × the typical daily move above the lowest close since the sleeve last sold | Adjusts to each stock's volatility (TSLA and MUU move far more than AMZN). "Typical daily move" is the mean absolute close-to-close change over the last 20 sessions, measured on closes so stray high/low prints cannot trigger it. |
| **C3 — fixed percentage** | is 20% or more below the highest close since the sleeve last bought | is 15% or more above the lowest close since the sleeve last sold | The simplest rule a person could follow by hand. 20% is the conventional bear-market threshold. |

"Since the sleeve last bought" counts from the fill session (inclusive); the
initial holding counts from the period's first session. Rules need warm-up
history: C1 needs 100 sessions, C2 needs 21. Until then a sleeve holds.

## 7. Periods and what has been seen

| Period | Basket | Dates | Purpose |
|---|---|---|---|
| Warm-up | A | data before each period start | indicators only |
| **Selection** | A | 2017-10-02 to 2022-12-30 | compare C1–C3 and pick one (section 8) |
| **Evaluation** | A | 2023-01-03 to 2026-10-21 | one run of the frozen pick; pass/fail (section 10) |
| Full-list check | B | 2025-03-18 to 2026-10-21 | reported, not a gate (under two years of shared history) |
| **Prospective** | B, plus SPCX once confirmed | from the first session after the freeze | the only data nobody has seen (section 9) |

2017-10-02 is the first session after VST's 100 sessions of warm-up;
2025-03-18 is the first after NBIS's 100 sessions since it resumed trading.
Each period starts a fresh US$15,000 account for every arm.

**Excluded sessions**: 2021-10-25, 2022-01-24, 2022-01-26 and 2022-03-08
are skipped for every stock. They are the known Alpaca gaps in NYSE-listed
trades, which affect VST's daily bars there. This is the same decision the
owner made for the Strategy Lab (splits-v2). On those dates there are no
fills, no decisions and no closes in any rule's history; an order due that
day fills at the next session.

**Disclosure of previously examined data**:

1. **MU** was in the consolidation-breakout universe. Its 15-minute bars for
   2021-07 to 2024-12 were run through that strategy (runs 1–12), and its
   2025-01-01 to 2026-06-30 bars passed readiness checks only. HXR's
   evaluation period overlaps that strategy's untouched holdout window for
   MU. HXR never reads the Strategy Lab database, never runs that strategy
   and never writes its holdout ledger; that strategy is closed by the
   owner's limit. If the owner wants strict separation, MU can be dropped
   from HXR's evaluation before any HXR run (decision pending).
2. The step 1 checks printed a few daily closes (first and last bars of each
   stock, and some 2016–2026 closes for SPY, MU, NVDA, AAPL and VRT). No
   rule outcome was computed.
3. **Hindsight cannot be removed.** Claude's training data and the owner's
   own memory cover these stocks' history up to mid-2026. The stock list is
   the owner's current holdings, which favours stocks that did well, so the
   hold comparison is probably flattering for holding. The rules were
   written as textbook rules without testing them on this data, but no
   historical period is truly unseen. **Only the prospective account is
   clean evidence.**

## 8. Choosing one candidate (selection period only)

1. Run C1, C2, C3 and the hold on basket A over the selection period, at
   base costs.
2. A candidate qualifies if it completes at least 10 exit-and-buy-back round
   trips across its sleeves.
3. Pick the qualifying candidate with the highest **annualised return ÷
   largest decline** (the return-to-drawdown ratio); a tie goes to the
   smaller decline.
4. **If no candidate's ratio reaches 1.10 × the hold's, stop.** HXR is
   reported as having no candidate worth evaluating, and the evaluation
   period is not used.
5. The pick is frozen as `hxr-1.0.0` (a new config file with its hash),
   logged in `EXPERIMENT-LOG.md`, before the evaluation run.

Selection results are in-sample and are reported as such.

## 9. The prospective simulated account

- Starts on the first session after the freeze, with US$15,000 on basket B
  (plus SPCX once confirmed, 9 sleeves), using the frozen `hxr-1.0.0`.
- After each close, Signal Desk processes the completed session:
  - it records each decision with the time it was recorded;
  - fills orders at the next open on the same basis as the backtest;
  - credits dividends and applies splits;
  - updates the hold comparison.
  A decision counts as on time only if it was recorded before the next
  session's open.
- **News**: Signal Desk polls Alpaca's news (Benzinga) for these symbols. It
  stores each item with the time Signal Desk first saw it and shows the
  items known at each decision next to that decision. In this version
  **news does not change any decision**. A news-informed version needs
  written news rules from the owner and would be a new frozen version.
- Everything is labelled SIMULATED: an internal ledger, with no order sent to
  any broker or paper-trading platform.

## 10. Pass/fail criteria (fixed now, before any result)

Judged on the **evaluation** period, basket A, frozen pick vs hold.

| | Criterion | Rule |
|---|---|---|
| G1 | Enough evidence | at least 500 sessions; at least 20 completed exit-and-buy-back round trips; and the hold suffered at least one decline of 20% or more from a previous peak (otherwise the protective rules were not tested). **If not met, the outcome is INSUFFICIENT EVIDENCE.** |
| G2 | Smaller worst decline | HXR's largest decline ≤ 0.75 × the hold's |
| G3 | Better return per unit of decline | HXR's annualised return ÷ largest decline ≥ 1.10 × the hold's |
| G4 | Limited return given up | HXR's annualised return ≥ the hold's minus 5 percentage points |
| G5 | Robust to costs and delay | G2 and G3 still pass with spread and slippage doubled, and separately with fills one session later |
| G6 | Not one stock | G3 passes in at least 4 of the 5 runs that leave out one stock |

Outcomes:

- **FAIL**: G1 is met and any of G2–G6 fails.
- **INSUFFICIENT EVIDENCE**: G1 is not met.
- **PASS**: everything passes. PASS means **eligible for the owner's review**.
  It is never permission to trade, and it never connects anything.

A positive account balance is not a pass. A gain smaller than the hold's,
or a gain bought with a similar decline, fails.

**Reported, not pass/fail:**

- the full-list check on basket B;
- assumed vs realistically available fills;
- the 0% withholding variant;
- per-stock results;
- missed rebounds and losses after buying back.

**Prospective criteria** (judged later, separately):

| | Criterion | Rule |
|---|---|---|
| P1 | Enough time and decisions | at least 6 months and at least 10 exit or buy-back decisions; otherwise insufficient evidence |
| P2 | Operationally clean | at least 95% of sessions processed on time; no duplicate orders; every fill has a bar |
| P3 | Fill realism | median absolute difference between assumed and realistic fills ≤ 25 bps |
| P4 | Consistent with history | prospective HXR vs hold is reported against the historical result; it is never called proof of the news-informed strategy |

## 11. What the report will contain

For every run:

- account value and return after costs;
- the largest decline from a previous peak, with its dates;
- number of trades and the test length;
- average gains and losses per completed holding;
- time in cash, weighted by money;
- missed rebounds: buy-backs above the exit price, and the stock's move
  while the sleeve was out;
- losses after buying back: holdings that began with a buy-back and ended in
  an exit below the buy-back price;
- every figure next to the hold comparison;
- costs and dividends paid;
- assumed vs realistically available fills.

## 12. Rules for changing anything

- Any change to a rule, number, stock list, period or criterion is a new
  version, logged in `EXPERIMENT-LOG.md` with the reason and the data seen.
- The evaluation runs **once** per frozen version. A repeat needs a written
  reason and is marked contaminated, and a contaminated run cannot pass.
- No number is tuned after a result is seen, and there is no endless search.
  This file allows exactly three candidates.
