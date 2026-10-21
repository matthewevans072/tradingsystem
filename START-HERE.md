# Signal Desk — start here

Signal Desk is a private, local web app for following your portfolio, the news that affects it and an AI-infrastructure research list, with three briefings a day. It **cannot trade**: there is no brokerage connection and no order code.

---

## 1. Install and start (Windows)

1. Install **Node.js 22 LTS or newer** (22.13+) from <https://nodejs.org> (default options are fine).
2. Put the `signal-desk` folder somewhere permanent, e.g. `Documents\signal-desk`.
3. Double-click **`Start-Signal-Desk.bat`**.
   - First run installs one dependency (the Anthropic SDK, used only if you enable the AI analyst) and creates `.env` from `.env.example`.
   - Your browser opens <http://127.0.0.1:4317>.
4. Keep the black console window open. **Closing it stops Signal Desk, its briefings and alerts.**

To start it automatically when you sign in: press `Win + R`, type `shell:startup`, and put a shortcut to `Start-Signal-Desk.bat` in that folder.

On macOS/Linux: `npm install --omit=dev` once, then `npm start`.

## 2. First-time setup (about 15 minutes)

Overview shows a **Getting started** checklist. In order:

1. **Settings → Setup questions**: your brokerage, whether holdings changed since your saved snapshot, and your market-data budget.
2. **Positions → Add trade or holding** (or **Import CSV**). For each holding from a statement or screenshot, use type **BASELINE** with the statement date, shares and average cost. Tick "unconfirmed" for any number you are not sure of. Exchange and currency are required; tickers are never guessed.
3. **Confirm each instrument**: open the holding and confirm exchange, currency and issuer from your brokerage record. Unconfirmed instruments are neither priced nor described. **SPCX must be confirmed**: the ticker currently refers to SpaceX Class A shares on Nasdaq (USD) *and* a CIBC SpaceX CDR on the TSX (CAD), and before April 2026 it was a SPAC ETF (now SPCK).
4. **Positions → Cash balances**: enter available cash per account and currency and confirm it. Your last known information was "no available cash"; Signal Desk treats unconfirmed cash as unknown and will not suggest adding to anything.
5. **Data providers**: edit `.env` (see below), restart, then **Settings → Test connections**.
6. **Report delivery**: choose in-app only, email and/or phone push, then press **Send test**.
7. **Risk questions**: personalised position sizes stay hidden until these are answered.
8. Run an end-to-end check: **Reports → Run premarket now** (or `npm run briefing -- premarket` to also deliver it).

## 3. Data providers (`.env`)

| Need | Recommended source | Key in `.env` | Notes |
|---|---|---|---|
| Quotes, daily/intraday history, earnings dates, splits | Twelve Data | `MARKET_DATA_PROVIDER=twelvedata`, `TWELVEDATA_API_KEY` | Free plan: US listings, ~8 requests/minute and 800/day. Canadian (TSX) listings and pre/post-market data need a paid plan. Check current plans on twelvedata.com. |
| Alternative quotes (US only) | Finnhub | `MARKET_DATA_PROVIDER=finnhub`, `FINNHUB_API_KEY` | Free US quotes, but no price history, so swing-trade assessments will say "insufficient evidence". |
| Company news + earnings calendar | Finnhub | `FINNHUB_API_KEY` | Works alongside Twelve Data. |
| Official filings (8-K, 10-Q…) | SEC EDGAR | `SEC_CONTACT_EMAIL` | Free; the SEC requires a contact email in requests. Canadian-only issuers aren't on EDGAR. |
| USD/CAD | Bank of Canada | none | Official daily rate, labelled with its date. |
| News interpretation & briefing summaries (optional) | Anthropic Claude | `ANTHROPIC_API_KEY` | Explains data the app already holds; it never changes the action labels. |

After editing `.env`, restart Signal Desk. In **Settings → Data providers → Plan limits & timeliness**, set the delay to match your plan (0 = real-time). Until you do, quotes are labelled **delayed**, never overstated.

Keys live only in `.env` on your computer. They are never sent to the browser, never written to logs (logs are scrubbed) and never stored in the database. `.env` is excluded from git.

## 4. How to read the numbers

- **USD and CAD are never mixed** without a dated USD/CAD rate. The combined total shows the rate, its source and date.
- **Unrealized P/L** is measured against your recorded average cost (buy fees included). It is not a time-weighted return. If positions began as a snapshot, or deposits/withdrawals aren't recorded, the app says so rather than estimating.
- **Currency effect on USD holdings** is separated only for buys where you entered the USD→CAD rate at purchase.
- **Every quote** shows provider, timestamp, session and timeliness (real-time / delayed / end-of-day). The dot next to a price shows freshness:
  - green: during the session the quote is no older than the provider delay + 15 minutes; outside the session it is from the most recent session.
  - amber (**stale**): older than that. The last valid price is kept, labelled stale, with the error that prevented a refresh.
  - red: no valid quote, so it is excluded from totals.
- **Session high/low** come from the provider's regular-session figures or 5-minute bars, never from the three scheduled checks. Extended-hours prices are shown separately and only if your plan supplies them.

## 5. Assessments

Each holding gets **HOLD / TRIM / SELL / WAIT / CONDITIONAL ADD / INSUFFICIENT EVIDENCE**, each with its reason, horizon, trigger, invalidation, main risk, confidence (in words), evidence and data timestamps. The rules engine:

- never uses distance from your entry price to decide (it's shown as context only);
- never suggests adding just because a price fell, or selling just because it rose;
- gives **CONDITIONAL ADD** only with confirmed cash in that currency, and sizes trades only after the risk questions are answered (never assuming margin or new money);
- keeps long-term holdings on portfolio-fit rules (concentration, mandate) and separate from swing-trade signals;
- flags leveraged/inverse ETFs and their daily reset; holding one as "long-term" triggers a review;
- treats earnings within 7 days as event risk (WAIT).

These are decision support based on price trends, concentration and scheduled events. They are not investment advice and they don't know your full financial situation.

## 6. Briefings, alerts and your computer

- Briefings run at **9:15 a.m., 10:30 a.m. and one hour before the regular close** (3:00 p.m.; **noon on 1:00 p.m. early-close days**), New York time, on NYSE trading days. Holidays and early closes come from NYSE's published 2026–2027 calendar, generated by rule and verified in tests. Add new special closures in `server/calendar.js`.
- **Signal Desk only works while your computer is on, awake and online, and the app is running.** If a slot is missed by more than 20 minutes (e.g. the laptop was asleep), it is recorded as **missed** and **not sent late**. Failures retry up to 3 times. Reports → Schedule shows every slot's status and any sleep/wake gaps.
- **Alerts are separate** from briefings: a monitor refreshes prices every 5 minutes during market hours (configurable) and checks your thresholds. Alerts are deduplicated, respect quiet hours, and record whether delivery succeeded. "Near session high/low" means the extremes observed so far; Signal Desk never predicts the final high or low.
- Existing ChatGPT scheduled tasks are separate. Signal Desk does not read, change or disable them.

## 7. Backups

- An automatic backup is taken once a day at startup (last 30 kept) in `data\backups`.
- **Settings → Backup & restore**: create, restore (a safety copy is taken first), upload a backup file, or export JSON.
- To move to a new PC: copy the whole `signal-desk` folder including `data\` and `.env`.

## 8. Demo workspace

**Settings → Workspace → Open demo workspace** loads clearly labelled synthetic data in a separate database file (`data\demo.sqlite`). A banner shows on every page, and demo reports are never emailed. Real portfolio data never falls back to demo prices.

## 9. Remote access (not enabled)

Signal Desk binds to `127.0.0.1` and refuses to start on any other address unless you set **both** `SIGNAL_DESK_ALLOW_REMOTE=true` and a `SIGNAL_DESK_ACCESS_TOKEN` of 24+ random characters. Even then, put it behind HTTPS (e.g. a tunnel with its own login, such as Cloudflare Access or Tailscale) before exposing financial data. The token alone is not a substitute for HTTPS.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| "Port 4317 is already in use" | Signal Desk is already running (check other windows), or set `SIGNAL_DESK_PORT=4318` in `.env`. |
| Prices show "No market data connected" | Set `MARKET_DATA_PROVIDER` and the key in `.env`, restart, then use Test connections. |
| A holding says "not priced" | Confirm its identity (Positions → open it). If the provider uses a different code, set "Provider symbol" there. |
| "Twelve Data returned X in CAD…" | The symbol maps to a different listing; check exchange/currency or set a provider symbol such as `SHOP:TSX`. |
| Daily request allowance used up | Lower the monitor frequency (Settings → Alerts) or upgrade the plan; data resumes the next day. |
| Email test fails with authentication error | Gmail needs an App Password (Google Account → Security → App passwords) and port 465. |
| Briefing shows "missed" | The computer was asleep, off or offline at that time. Expected for a local app. |
| Anything else | Settings → Show recent log (secrets are scrubbed), or `data\logs\signal-desk.log`. |

Run the automated tests with `npm test`.
