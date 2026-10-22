# Parameter and rule change log

Every change to the strategy rules, its parameters, the universe, the split
dates or the acceptance criteria is recorded here and in the Strategy Lab,
with the reason and which data had been seen when the change was made.

| Date | Version | Change | Reason | Data seen before the change |
|---|---|---|---|---|
| 2026-10-21 | cb-1.0.0 | Initial baseline from the owner's brief (`configs/cb-1.0.0.json`); universe-v1, splits-v1, acceptance-v1 | First version | none |
| 2026-10-22 | cb-1.0.0 (engine-1.0.1) | Implementation fix, rules unchanged (config hash unchanged): stops round down and targets up to the $0.01 tick so orders are valid prices; the TradingView-parity entry mode needs one tick through the limit, like TradingView's limit verification. Pine script changed the same way. | Reconciling the Pine script with the engine (`PINE-RECONCILIATION.md`); real orders must sit on the tick grid | synthetic data only (no market data had been downloaded) |
