# Signal Desk — notes for future development sessions

Read START-HERE.md for the user-facing view. This file covers what you must preserve when changing the code.

## Never break these
- **The user's data is sacred.** `data/signal-desk.sqlite` holds real holdings, entry prices and reports. Never reseed, migrate destructively or overwrite it with example data. Schema changes go in `server/db.js` `MIGRATIONS` as new, additive entries; never edit an applied migration.
- **No trading.** Do not add brokerage order or trading-permission integrations.
- **No silent estimates.** Missing or stale quotes stay missing/stale with a label, and the last valid value is kept. The real workspace never falls back to demo data. Never reconstruct session high/low from scheduled checks.
- **Currencies:** USD and CAD totals are computed separately; combine only with a stored, dated FX rate (`fx_rates`).
- **Instrument identity:** an instrument is `(symbol, exchange)` with a currency. Unconfirmed instruments (`identity_status != 'confirmed'`) are not priced. Ambiguous tickers (catalog `ambiguity`, and SPCX always) get no description until confirmed.
- **Secrets** live only in `.env`, read by `server/config.js`. Everything logged or returned in errors passes through `redact()`. Never send keys to the browser.
- **Local only by default:** `server/index.js` refuses non-loopback binding unless remote access is explicitly enabled with a token. Keep the Host-header, Origin and `X-Signal-Desk` CSRF checks.
- **Untrusted content:** news text is rendered via text nodes (`public/lib/ui.js` `h()`), never `innerHTML`, and passed to the AI analyst fenced in `<untrusted_item>` with a JSON-schema response.
- **Assessments** (`server/assessments.js`) must not derive actions from entry price, must not add on a fall alone or sell on a rise alone, must require confirmed cash for CONDITIONAL_ADD and a complete risk profile for sizing. Action labels come only from rules; the AI analyst only explains.
- **Scheduler**: slots are unique (`briefings.slot_key`); late beyond the grace window means `missed`, never sent late.

## Layout
- `server/` — `index.js` (HTTP + security), `api.js` (routes), `db.js` (schema/migrations/audit), `portfolio.js` (ledger → positions, average cost, splits, FX decomposition), `importer.js` (CSV preview/apply/dedupe), `calendar.js` (NYSE/TSX rules, verified 2026–27), `freshness.js`, `marketdata.js` + `providers/` (Twelve Data, Finnhub, SEC, Bank of Canada, demo), `news.js`, `analytics.js`, `assessments.js`, `briefings.js`, `scheduler.js`, `alerts.js`, `delivery.js` (SMTP/ntfy), `analyst.js` (Claude), `backup.js`, `catalog.js` + `catalog/securities.json`.
- `public/` — no-build SPA: `app.js` (router/API), `views/*.js`, `lib/ui.js`, `lib/charts.js`, `styles.css`.
- `tests/` — `node --test`; provider tests use fixtures because the dev sandbox has no network.

## Catalog
`server/catalog/securities.json` holds the plain-English descriptions (official source URL, review date, verification status). Entries were checked against official-source search excerpts on 2026-10-21; re-verify periodically. User edits are stored in the `descriptions` table and take precedence.
