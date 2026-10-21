# Consolidation breakout — strategy rules and research assumptions

Version 1.0.0 (`configs/cb-1.0.0.json`). Simulation only.

These rules come from your written brief. The source video left several
points open; each is resolved below as an explicit, configurable research
assumption. This is **not** a verified reproduction of the video and **not**
evidence of an edge. The exact engine behaviour is in `ENGINE-SPEC.md`.

## Market and bars

| Setting | Value | Note |
|---|---|---|
| Direction | Long only | no shorting |
| Chart | Standard candlesticks | never Heikin Ashi, Renko or other synthetic prices |
| Session | Regular US equity session | 09:30–16:00 ET; 13:00 on early closes |
| Bars | 15 minutes | completed bars only |
| Data | Split-adjusted, not dividend-adjusted | dividends are not credited (small understatement for swing holds) |

## 1. The box

1. Look at the last **20 completed bars** (the window). The candle that might
   break out is never part of it.
2. Ceiling = highest high in the window; floor = lowest low.
3. The box is narrow enough if its height (ceiling − floor) is at most
   **3 × ATR(14)**.
4. Price must have tested both edges: at least **2 touches** of the ceiling
   (a high within **0.2 × ATR** of it) and 2 of the floor (a low within
   0.2 × ATR), each pair of counted touches separated by **at least 2 bars**.
5. When all of this holds, the setup becomes **eligible** and its ceiling,
   floor, height and ATR are **frozen**. The Lab shows the box and the reason
   it qualified (height in ATR, the touch times).
6. The setup **expires** if no candle closes above the ceiling within
   **10 bars**, and is cancelled if a candle closes below the floor.
7. **One decision per box**: the first close above the ceiling consumes the
   box, whether or not it leads to a trade. A new box cannot reuse the old
   box's window or the breakout candle, and no new box is looked for while a
   setup, order or position for that stock is open.

## 2. Entry

1. A completed candle **closes above the frozen ceiling**.
2. Its volume must be more than **1.5 ×** the average of the previous 20
   completed bars. If any of those volumes is missing, the signal is skipped.
3. Planned stop and target (below) are set at that close, and the highest
   acceptable entry price is calculated.
4. The simulated entry is the **next bar's open**, plus half the bid/ask
   spread and slippage. The trade is **skipped** if that open is more than
   **0.5 × ATR** above the breakout close (gap too far), if it no longer gives
   at least **2 : 1** reward/risk, if it is beyond the target, or if it is at
   or below the stop.
5. Intraday version: no entries from signals in the last **60 minutes** of
   the session.

## 3. Stop

- **Below the breakout candle's low, minus 0.1 × ATR.** This is the chosen
  interpretation of the video's wick-based stop: the low of the breakout
  candle is the end of its lower wick.
- Setups are rejected if the stop is invalid or if estimated round-trip costs
  would exceed **20 %** of the planned risk per share.
- The stop **never moves**, and is never widened.

## 4. Target

- Box height = ceiling − floor. **Target = ceiling + box height.**
- At least **2 : 1** reward/risk measured from the simulated entry price.
- No trailing stops, partial exits or moves to breakeven in this baseline.
  Stops and targets are never changed after the fact.

## 5. Time exits (two separate configurations, reported separately)

- **Intraday**: any open position is closed at the open of the last 15-minute
  bar of the session (15:45, or 12:45 on early-close days). Nothing is held
  overnight.
- **Swing**: positions may be held overnight for up to **10 sessions**, then
  closed the same way on the 10th session. Overnight gaps are modelled: a
  stock that opens below the stop is sold at the open, so **a loss can be
  larger than the planned risk**.

## 6. Simulated account and risk (testing assumptions, not your approved limits)

| Setting | Value |
|---|---|
| Hypothetical starting balance | **US$100,000 (simulated)** — separate from your real portfolio; your last reported real available cash was $0 |
| Planned risk per trade | 0.25 % of simulated equity |
| Combined open planned risk | at most 1 % |
| Simultaneous positions | at most 3 |
| Borrowing, margin, shorting, leveraged ETFs | none |
| Size | limited by the risk budget **and** the simulated cash, after costs |

Paper profits never create real buying power, and nothing here assumes you
sold any real holding.

## 7. Costs (configurable)

| Cost | Default |
|---|---|
| Commission | US$0.005/share, minimum US$1 per order |
| Half bid/ask spread | 2 bps of price on market and stop fills |
| Slippage | 2 bps of price on market and stop fills |
| Limit fills (target) | must trade 1 tick through the limit; no spread or slippage |
| Currency conversion | 0 % for a USD simulated account; set it if you model a CAD account |

## 8. Bars that touch both stop and target

A 15-minute bar does not say which came first. The default assumes the
**stop** was hit first (conservative). Results are also reported with the
target first and with TradingView's assumed intrabar path, and with 1-minute
data when it is available, so you can see how much the answer depends on it.

## 9. What the strategy does not do

No live orders, no broker connection, no Paper Trading account orders, no
automatic change of rules after losses, and no move to real trading without
your separate explicit instruction (see `QUESTRADE-ASSESSMENT.md`).
