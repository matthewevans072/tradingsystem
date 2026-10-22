# Pine strategy vs Signal Desk engine — reconciliation

Status on 2026-10-22. **The Pine script has not been compiled or run in
TradingView itself**: the build environment cannot reach tradingview.com and
has no TradingView account. Everything below compares the engine with the
Pine script running in **PineTS 0.12.1**, an open-source third-party Pine
runtime that emulates TradingView's broker. Agreement here shows the two
implementations follow the same rules; it does not show that TradingView
compiles the script or fills orders the same way. That still needs the
TradingView run described at the end.

All bars are **synthetic** (seeded generator). They test code consistency
only and say nothing about the strategy's performance.

Reproduce: `npm install --no-save pinets`, then
`node scripts/strategy-pine-parity.mjs --symbol JPM --mode swing --seed 23 [--zero-costs]`.
The engine runs in TradingView-parity mode (`tv_path` ambiguity,
`limit_intrabar` entries).

## The five discrepancies reported earlier

| Case | Signal bar (UTC) | Before | Engine (expected) | Pine in PineTS (actual) | Status |
|---|---|---|---|---|---|
| NVDA swing, seed 11 | 2023-06-02 19:45 | Pine-only trade | Signal; next session opened at 202.85, **at or below the stop 203.92 → entry skipped**. Stop 203.92, target 206.99, no trade, P&L 0.00 | Limit filled at the open 202.85 × 225, stop hit at once, exit 202.85, **P&L −41.08** (commission only) | **Unavoidable platform difference** (see A) |
| AMD swing, seed 23 | 2023-02-15 20:30 | Pine 267 vs engine 268 shares | Entry 20:45 @ 184.09 × 267, stop 183.30, target 185.90, exit 20:45 @ 183.30 (stop), P&L −233.18 | Identical | **Resolved** (D2) |
| JPM swing, seed 23 | 2023-06-05 13:30 | Pine 308 vs engine 309 | Entry 13:45 @ 145.98 × 308, stop 145.29, target 147.55, exit 14:30 @ 147.55 (target), P&L +480.48 | Identical | **Resolved** (D2) |
| JPM swing, seed 23 | 2023-10-24 13:30 | Pine 316 vs engine 317 | Entry 13:45 @ 145.66 × 317, stop 144.99, target 147.19, exit 13:45 @ 144.99 (stop), P&L −233.94; equity at signal 100,992.96 | Entry 13:45 @ 145.66 × **316**, same stop, target and exit, **P&L −253.05**; equity at signal 100,846.78 | **Unavoidable platform difference** (see B) |
| XOM swing, seed 23 | 2023-05-10 19:30 | Pine 152 vs engine 153 | Entry 19:45 @ 241.23 × 152, stop 240.11, target 244.75, exit 19:45 @ 240.11 (stop), P&L −201.51 | Identical | **Resolved** (D2) |

## Across all comparison runs (12 symbol/mode runs, 2022-10 to 2023-12)

| Costs | Pine trades | Identical to the engine | Open at/below the stop (A) | Cost-model equity drift (B) | Cash buffer (C) | Unexplained |
|---|---|---|---|---|---|---|
| Base costs | 70 | 64 | 3 | 3 | 0 | **0** |
| Costs set to zero on both sides | 162 | 156 | 4 | 0 | 2 | **0** |

Identical = same entry bar, entry price and shares, same exit bar, exit price
(within a cent) and exit reason. No engine trade was missing from the Pine
side.

## Causes

**Resolved (fixed in the code, engine-1.0.1):**

- **D1 — Entry limit verification.** TradingView-style limit checking
  (`backtest_fill_limits_assumption = 1`) needs price to trade one tick
  through a limit before it fills. The engine's parity mode applied that to
  the target but not to the entry limit, so a bar whose low touched the limit
  exactly filled in the engine and not in Pine (SPY, 2022-11-16). The parity
  mode now applies it to entries too. The research default (`open_only`) is
  unaffected.
- **D2 — Prices on the tick grid.** Real stop and limit orders must be on the
  $0.01 tick, and the PineTS broker snaps fills to it. The engine kept
  fractional-cent stops, so P&L, equity and then share counts drifted by a
  share. Both implementations now round the stop **down** and the target
  **up** to the tick (slightly more conservative). This is an
  implementation fix, not a rule change; it was made before any real-data
  result existed and is logged in `PARAMETER-LOG.md`.

**Unavoidable platform differences (quantified):**

- **A — Opening at or below the stop.** The engine's entry is an
  immediate-or-cancel limit at the next open and skips an open at or below
  the stop. TradingView has no such order: the limit fills at the open and
  the stop exits at the same price. Effect per occurrence: a round trip at
  one price, i.e. a loss equal to TradingView's commission (−$38.60 to
  −$41.08 here, about 0.04% of equity). Frequency here: 7 of 232 Pine trades
  (3.0%), all at a session open after an overnight gap, so swing mode only.
- **B — Cost model.** TradingView applies one commission type; the Pine
  script uses 0.045% per fill as an approximation of the engine's per-share
  commission plus spread and slippage. On these trades TradingView's charge
  was higher (e.g. $41 vs $22 for the JPM round trip), so its equity drifted
  below the engine's (by $146 after ten trades in the JPM run), the 0.25%
  risk budget fell by about $0.37 and risk-sized orders lost one share
  (3 of 70 trades, ±0.3% of position size). The research results use the
  engine's cost model.
- **C — Cash buffer.** When an order is limited by cash rather than risk,
  the Pine script keeps 0.1% of equity back so the order passes
  TradingView's funds check after its own commission (whether TradingView
  would reject it otherwise is not verified). Effect: one share fewer on
  cash-limited orders (2 cases with costs set to zero). The buffer is an
  input and can be set to 0 when testing in TradingView.

## Still to check in TradingView itself

1. Compile the script (Pine Editor → Save → Add to chart). Any error stops
   everything else; send it with its line number.
2. On a 15-minute NVDA or JPM chart (regular session, standard candles),
   set the test window inputs to 2026-07-01 → 2026-09-30, a period outside
   every pre-registered split, so no development, validation or holdout data
   is touched.
3. Export the bars (**Download chart data**) and the Strategy Tester's trade
   list (**Trades → Download**, CSV) and run
   `node scripts/strategy-compare-tv.js --trades <trades.csv> --data <chart.csv> --symbol NVDA --mode swing`.
   That produces this same table against TradingView's own fills.
4. Two behaviours only TradingView can settle: whether a `strategy.exit`
   placed while its entry is still pending protects the entry bar, and
   whether `backtest_fill_limits_assumption` also delays an entry limit
   reached exactly at the open.
