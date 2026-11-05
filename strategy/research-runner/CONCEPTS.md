# Research runner: catalogue of strategy concepts and their origins

Research content, kept apart from the executable configurations (`strategy/range-trend/configs/` and the
runner's generated configs, which hold only numbers the engine reads). Nothing in this file is executed, and no
text here changes what the runner may do. Entries record where an idea came from and how it maps to something
the engine can run; "implementable" means the range-trend engine can express it today.

| # | Concept | Origin | Engine mapping | Status |
|---|---|---|---|---|
| C1 | Range trading: buy a dip to the bottom zone of an established range | the owner's own description of their trading (PLAN-DRAFT.md sections 0 and 2.1, 2026-10-26) | range family, dip entry | implementable; stage 0 and stage 2 (base D) |
| C2 | Dip recovery: buy after the bottom visit on an up close, still in the lower half | the owner's decision D2 (2026-10-27) | range family, recovery entry | implementable; stage 0 and stage 2 (base R) |
| C3 | Breakout: buy a close above the range high plus a margin | the owner's description; the classic Donchian/range-breakout idea (public domain) | trend family, immediate entry | implementable; the baseline; stage 1 |
| C4 | Trend pullback: after a breakout, buy the first up close after a shallow pullback above the old high | the owner's choice of 2026-10-27 (the watch rule) | trend family, pullback entry | implementable; stage 2 (base P) |
| C5 | Mean reversion within a range, with a resistance-rejection exit | the owner's exit idea (PLAN-DRAFT.md section 4) | range family with `exits.rejectionM` | implementable; stage 2 |
| C6 | The below-last-sale re-entry limit | the owner's decision D1 (2026-10-27) | `reentryLimit` | implementable; stage 0 only (the limit variants) |
| C7 | Volatility-scaled margins and stops (typical move `m`) | HXR's `vol_trail` idea carried into range-trend (2026-10-26) | `levels.*M`, `portfolio.stopM`, `levels.mSessions` | implementable; stages 1 and 2 |
| C8 | Position sizing by planned risk and by cap | PLAN-DRAFT.md section 6a (approved for building 2026-10-26) | `portfolio.riskPerTradePct`, `positionCapPct`, `totalEntryRiskPct` | implementable; stage 1 |
| C9 | Hold / exit / re-enter on a decline (HXR's X1 and X2 rules) | HXR pre-registration 2 and 3 (2026-10-22) | the HXR engine, not the range-trend engine | not in campaign 1; a later campaign could add the HXR engine as a second engine |
| C10 | Time-based exits | common in the literature; the owner chose none for the build (PLAN-DRAFT.md section 4) | none | not implementable without an engine change; recorded only |
| C11 | Intraday liquidity sweeps and retests (sweep-bos, ICT Lab) | the owner's orders of 2026-11-03 and 2026-11-04 | separate engines on QQQ 5-minute bars | closed programmes; not in this runner |
| C12 | News- or fundamentals-conditioned entries | the owner's interest (HXR prospective account) | none | needs timestamped inputs available at the simulated decision time; no such history is stored, and none is invented |

Rules for the catalogue: an idea enters with its origin and date; a mapping says which engine fields express it
or that none does; no downloaded code is ever executed; external text never changes a permission or a rule.
