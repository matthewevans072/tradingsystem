# HXR experiment log

Every HXR activity that touches data, in order. Each entry says which data
it touched and whether any result was seen. The Signal Desk HXR page shows
the same log from the `hxr_experiments` table, plus the runs made on that
machine.

| # | When (UTC) | What | Version | Data touched | Results seen? |
|---|---|---|---|---|---|
| 1 | 2026-10-22 16:00–16:30 | Step 1 capability checks (read-only): Alpaca daily-bar depth, adjustment modes, corporate actions, auction prints, quotes, news API; review of Signal Desk code; external platforms | none | Daily bars for SPY, MU, NVDA, AAPL, VRT (2016-2026, counts and a few closes); quote and news samples; the Strategy Lab database read-only (counts only) | No rule outcome; a few prices printed |
| 2 | 2026-10-22 ~17:00 | Listing checks for the owner's 9 stocks: first and latest daily bar, corporate actions (splits, name changes, dividend counts), NBIS around its 2022-2024 suspension | none | First 2 and last daily closes per stock; NBIS 2022-02-22 to 2024-10-25 daily closes and volumes | No rule outcome |
| 3 | 2026-10-22 | Pre-registration written and committed: `PREREGISTRATION.md`, `ENGINE-SPEC.md`, `universe-hxr-v1.json`, `periods-hxr-v1.json`, `criteria-hxr-v1.json`, `configs/hxr-*-0.1.0.json` | hxr-prereg-1 | none | No |
