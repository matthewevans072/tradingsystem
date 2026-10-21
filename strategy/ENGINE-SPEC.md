# Consolidation breakout — engine specification (v1)

This is the exact behaviour of the deterministic engine in `server/strategy/`.
The Pine strategy in `strategy/pine/` follows the same rules where TradingView
allows it; every known difference is listed at the end. If code and this file
disagree, it is a bug in one of them.

All rules are research assumptions taken from the owner's written brief, not a
reproduction of the source video and not a proven edge.

## 1. Data

- A bar is `{ t, o, h, l, c, v }`: `t` is the bar's start time (UTC ISO), the
  bar covers `[t, t + 15 min)`. Prices are split-adjusted and not
  dividend-adjusted. `v` is shares traded; `null`, missing or `<= 0` means
  volume is unavailable for that bar.
- Only regular-session bars are used (09:30–16:00 America/New_York, 13:00 on
  NYSE early-close days, no bars on holidays; `server/calendar.js`). Bars that
  start before the open or end after the close are dropped on import.
- Finer bars (1- or 5-minute) may be aggregated to 15 minutes within the
  regular session (open of the first, max high, min low, close of the last,
  sum of volume; a 15-minute bucket missing any sub-bar is marked incomplete
  and dropped).
- Every dataset gets a quality report (expected vs. present bars per session,
  duplicates, non-positive prices, `h < l`, missing volume, single-bar moves
  over 20 %) and a SHA-256 hash of the normalised bars. Runs record the hash.
- Synthetic data is always flagged `synthetic: true` and may only be used to
  test the engine or demonstrate the interface, never reported as performance.

## 2. Indicators (completed bars only)

- True range `TR_i = max(h_i − l_i, |h_i − c_{i−1}|, |l_i − c_{i−1}|)`; the
  first bar uses `h − l`. On a regular-session series the previous close of a
  session's first bar is the previous session's last close, so overnight gaps
  are part of TR (TradingView does the same on a regular-session chart).
- ATR is Wilder's: the first value is the simple mean of the first `N` TRs,
  then `ATR_i = (ATR_{i−1} × (N − 1) + TR_i) / N` (Pine `ta.atr`).
- Nothing at bar `i` uses data from bar `i + 1` or later.

## 3. Box detection (per symbol)

States: `scanning`, `armed` (a setup is eligible and frozen), `pending`
(an entry order waits for the next bar), `in_position`.

At the close of bar `i`, while `scanning`, with `L = box.lookbackBars`,
`A = ATR_i`, window `W = [i − L + 1, i]`:

1. Warm-up: `i + 1 ≥ max(L, atrLength + 1)`.
2. `R = max(h over W)`, `S = min(l over W)`, `H = R − S`; require
   `0 < H ≤ maxHeightAtr × A` and `H ≥ minHeightAtr × A`.
3. Touch tolerance `tol = touchToleranceAtr × A`. Upper touches: bars in `W`
   with `h ≥ R − tol`; lower touches: `l ≤ S + tol`. Distinct touches are
   counted greedily from the oldest bar: a touch counts if at least
   `minBarsBetweenTouches` bars lie between it and the previous counted touch
   (index difference `≥ minBarsBetweenTouches + 1`). Require at least
   `minTouchesEach` distinct touches on each side.
4. Overlap/reset: the window must start after `nextWindowStartMin` (below).
5. If all hold, the setup becomes eligible at bar `i` and is frozen:
   `{ R, S, H, A_box = A, windowStart, windowEnd = i, touches }`. State
   becomes `armed`. The bars of `W`, including bar `i`, can never be the
   breakout candle: candidates are bars `i + 1 … i + setupExpiryBars`.

While `armed` (setup frozen at bar `e`), at the close of bar `j > e`:

1. If `c_j > R` (a close above the frozen ceiling) this is the breakout
   candle. The box is consumed by it whatever happens next (one decision per
   box):
   - Volume: needs `v` for bars `j − volumeLookbackBars … j`; if any is
     unavailable → `signal_rejected: volume unavailable`.
   - `avgVol = mean(v_{j−20} … v_{j−1})`; require `v_j > volumeMultiple ×
     avgVol`, else `signal_rejected: breakout volume x.xx× average`.
   - Otherwise it is a breakout signal (section 4).
2. Else if `invalidateOnCloseBelowSupport` and `c_j < S` →
   `setup_invalidated: closed below support`.
3. Else if `j − e ≥ setupExpiryBars` → `setup_expired`.

Reset rules (no duplicate trades from overlapping boxes):
- A symbol has at most one active setup, pending order or position at a time;
  no new box is detected while any of them exists.
- When a box retires (consumed, invalidated or expired),
  `nextWindowStartMin = windowEnd + 1`; if it was consumed by a breakout
  candle at bar `j`, `nextWindowStartMin = max(windowEnd + 1, j + 1)` so the
  breakout candle never belongs to the next box. If a trade was entered, the
  next box is also detected only after the position is closed.

## 4. Signal → order (decided at the close of the breakout candle `j`)

With `A = ATR_j`, `k = (halfSpreadBps + slippageBps) / 10 000`:

- `stop = l_j − stop.atrBuffer × A` (below the breakout candle's low: the
  chosen reading of the video's wick-based stop).
- `target = R + target.boxHeightMultiple × H`.
- Maximum acceptable entry (raw price, rounded down to the tick):
  - gap limit `G = c_j + entry.maxGapAtr × A`;
  - reward/risk limit `Q = ((target + minRR × stop) / (1 + minRR)) / (1 + k)`
    — the highest opening price whose simulated entry `open × (1 + k)` still
    gives `(target − entry) / (entry − stop) ≥ minRR`;
  - `L = min(G, Q)`.
- Rejected at the signal (`signal_rejected`) if: `c_j ≥ target` (already past
  the target); `L ≤ stop`; the stop is not positive; risk at the reference
  entry `c_j × (1 + k) − stop` is below `minStopAtr × A`; the estimated
  round-trip cost per share at the reference entry
  (`c_j × k + stop × k + 2 × commissionPerShare`, plus currency conversion)
  exceeds `maxCostToRiskPct` % of that risk; intraday mode and the breakout
  candle closes later than `noNewEntriesMinutesBeforeClose` before the
  session close or the next bar is in another session; the position limit or
  open-risk limit is reached; the size is below one share.
- Sizing (section 6) uses the worst acceptable entry `L`, so the planned risk
  can only be lower at the actual fill.
- Otherwise an entry order is placed: a buy limit at `L`, valid only for the
  next bar's open (an immediate-or-cancel limit). State `pending`.

## 5. Fills (the next bars)

Processing order at each timestamp: all symbols' opens (alphabetical), then
intrabar exits, then all closes (alphabetical). Signals at the same close are
sized in alphabetical order of symbol so no symbol is chosen with hindsight.

Entry (bar `j + 1`), `entryFill = open_only` (default):
- No bar `j + 1` for the symbol (data gap) → `entry_skipped: no next bar`.
- `o > L` → `entry_skipped: opened at o, above the maximum entry L`
  (with which limit, gap or reward/risk, was binding).
- `o ≤ stop` → `entry_skipped: opened at or below the stop`.
- Else filled at `o`; effective entry `E = o × (1 + k)` (+ `stress.entryWorseAtr
  × A` in the stress test). Reward/risk at the fill is recorded.

`entryFill = limit_intrabar` (TradingView parity only): if `o ≤ L` as above;
else if `l ≤ L` the order fills at `L` (a limit fill: no spread or slippage)
and the trade is flagged `intrabar_limit_entry`; else skipped.

Exits (orders rest from the entry fill; stop and target never move; no
trailing, partials or breakeven moves):
- At a bar's open: `o ≤ stop` → stop filled at `o × (1 − k)` (gap through
  the stop; the loss can exceed the planned risk); `o ≥ target + ticks` →
  target filled at `o` (gap through the target).
- Within the bar: stop hit if `l ≤ stop` → filled at `stop × (1 − k)`;
  target hit if `h ≥ target + limitFillTicksBeyond × tickSize` → filled at
  `target` (a resting limit: no spread or slippage).
- Both within one bar: `simulation.ambiguity` decides. `stop_first`
  (default, conservative); `target_first` (optimistic, sensitivity only);
  `tv_path` (TradingView's assumed path: open → the extreme nearer the open →
  the other extreme → close); lower-timeframe bars, when supplied for that
  bar, are scanned in time order instead (a sub-bar that touches both falls
  back to `stop_first`). Every ambiguous exit is flagged.
- The bar of the entry is checked for exits after the entry fill.
- Time exits are market orders filled at the next bar's open × `(1 − k)`:
  - intraday: placed at the close of the first bar ending at or after
    `sessionClose − flattenMinutesBeforeClose` (15:45 on a normal day, 12:45
    on an early close); if that bar is missing and the next bar is in a new
    session, the position is closed at the last bar's close and flagged;
  - swing: the same rule on the `maxHoldSessions`-th session (the entry
    session is session 1). Positions are held overnight otherwise, so the
    next session's opening gap applies to the stop and target.
  - End of data: open positions are closed at the last close and flagged
    `end_of_data` (excluded from expectancy if the flag says so in reports).

## 6. Account, sizing and costs

- A separate hypothetical account (`risk.hypotheticalStartingEquity`, USD),
  never linked to the owner's real portfolio, cash or buying power.
- At the signal close: `equity = cash + Σ shares × close` of open positions.
  `budget = min(equity × riskPerTradePct %, equity × maxOpenRiskPct % −
  open planned risk of positions and pending orders)`. Positions plus pending
  orders may not exceed `maxPositions`.
- Worst-case loss per share `L × (1 + k) − stop × (1 − k)`; shares are the
  largest whole number whose worst-case loss plus both commissions fits the
  budget and whose cost `shares × L × (1 + k) + commission` fits the cash not
  already reserved by pending orders. No margin, no shorting, no leverage.
- Planned risk recorded at the fill: `shares × (E − stop × (1 − k))` plus the
  entry commission and the estimated exit commission. A trade's R multiple is
  its net profit divided by this planned risk.
- Commission per fill: `max(commissionMinPerOrder, commissionPerShare ×
  shares)`, capped at `commissionMaxPctOfValue` % of the fill value.
- Spread and slippage: market and stop fills pay `k` of the price; limit fills
  (entry at or below the limit in `limit_intrabar`, target) pay neither.
- Currency conversion: when the account currency differs from the
  instrument's, `fxConversionPct` % of the notional on every fill.

## 7. Outputs

Trade record:
`{ id, symbol, mode, version, configHash, box: { windowStart, windowEnd,
resistance, support, height, atr, touchesUpper, touchesLower, eligibleAt },
signal: { at, close, low, volume, avgVolume, volumeRatio, atr }, plan: {
stop, target, maxEntry, gapLimit, rrLimit, binding, shares,
plannedRiskWorstCase }, entry: { at, raw, price, shares, commission,
spreadSlippage, fx, rewardRisk, plannedRisk, flags }, exit: { at, reason
(stop | target | flatten | max_hold | session_end_fallback | end_of_data),
raw, price, commission, spreadSlippage, fx, gapThrough, ambiguous,
resolvedBy }, pnl: { gross, costs, net, r }, holdBars, holdSessions }`.

Journal events: `{ at, symbol, type, reason, details }` with types
`setup_eligible`, `setup_expired`, `setup_invalidated`, `signal`,
`signal_rejected`, `order_placed`, `entry_skipped`, `entry_filled`,
`exit_order`, `exit_filled`, `data_warning`, `operational_error`.

Equity curve: one point per processed timestamp (bar close): `{ t, equity,
cash, positions, openRisk, grossExposure }`.

## 8. Known differences from the Pine strategy

- Portfolio limits (three positions, 1 % combined open risk, shared cash)
  span symbols, which a TradingView strategy cannot do: each chart is a
  separate single-symbol account. The Pine version enforces the per-trade
  risk and one position per symbol only.
- TradingView has no immediate-or-cancel limit. The Pine entry is a limit at
  `L` that stays active for one bar and is cancelled at that bar's close; it
  can fill later in the bar if price returns to `L` after opening above it.
  The engine's `limit_intrabar` mode reproduces this for comparison; such
  trades are labelled on the chart.
- TradingView applies one commission model per strategy (percent, per
  contract or per order) and slippage in ticks to market and stop orders.
  The Pine defaults approximate this engine's costs; the engine's cost model
  is the one used for the research results.
- Without Bar Magnifier, TradingView resolves a bar touching both stop and
  target with its assumed intrabar path (`tv_path` in the engine).
