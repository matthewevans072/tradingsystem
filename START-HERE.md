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
| Company news + earnings calendar | Finnhub | `FINNHUB_API_KEY` | Works alongside Twelve Data. Its earnings calendar covers US listings; TSX names are reported as **not covered**, never as "no earnings date". |
| Official filings (8-K, 10-Q…) | SEC EDGAR | `SEC_CONTACT_EMAIL` | Free; the SEC requires a contact email in requests. Canadian-only issuers aren't on EDGAR. |
| USD/CAD | Bank of Canada | none | Official daily rate, labelled with its date. |
| News interpretation & briefing summaries (optional) | Anthropic Claude | `ANTHROPIC_API_KEY` | Explains data the app already holds; it never changes the action labels. |

After editing `.env`, restart Signal Desk. In **Settings → Data providers → Plan limits & timeliness**, set the delay to match your plan (0 = real-time). Until you do, quotes are labelled **delayed**, never overstated.

Keys live only in `.env` on your computer. They are never sent to the browser, never written to logs (logs are scrubbed) and never stored in the database. `.env` is excluded from git.

## 4. How to read the numbers

- **USD and CAD are never mixed** without a dated USD/CAD rate. The combined total shows the rate, its source and date.
- **Unrealized P/L** is measured against your recorded average cost (buy fees included). It is not a time-weighted return. If positions began as a snapshot, or deposits/withdrawals aren't recorded, the app says so rather than estimating.
- **Currency effect on USD holdings** is separated only for buys where you entered the USD→CAD rate at purchase. The daily currency effect (chat's move breakdown) is shown only when the session's Bank of Canada rate and the previous business day's rate are both stored; after the app has been off for a few days it is marked unavailable rather than spread over the gap.
- **Every quote** shows provider, timestamp, session and timeliness (real-time / delayed / end-of-day). The dot next to a price shows freshness:
  - green: during the session the quote is no older than the provider delay + 15 minutes; outside the session it is from the most recent session.
  - amber (**stale**): older than that. The last valid price is kept, labelled stale, with the error that prevented a refresh.
  - red: no valid quote, so it is excluded from totals.
- **Today's P/L** is measured over the session the latest quote belongs to. Before the open, after the close and on holidays that is the most recent session, not the calendar day, and trades dated after that session are not counted in it. A position's "Today %" uses the same base as the totals (start-of-session value plus shares bought that session); a holding you did not own during that session shows no daily figure. On the day a split takes effect, the start-of-session share count is converted to post-split units once you record the split. If some holdings' latest quotes are from an earlier session than others, the totals say so.
- **Position weights** everywhere (Positions, the rules and chat scenarios) are shares of the CAD-equivalent value of priced holdings, excluding cash and unpriced positions.
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

## 7. Ask Signal Desk (chat)

Press **Ask** (bottom-right on every page) to ask questions such as "Why is my portfolio down today?", "What changed with NBIS since yesterday?", "If I sold 20% of NBIS, how much cash would I free up?" or "What does Vertiv actually do?". The suggested questions follow the page you are on and the holding you have open.

**How it answers**
- For every question the model calls read-only tools that fetch your **current** records and stored data: holdings, cost basis, cash, trade history, your risk answers and thresholds, quotes, price history and session statistics, company profiles, news and filings, earnings and events, saved briefings and assessments. It does not rely on what it said earlier.
- Each answer starts with a short reply. Under **Supporting details**, every point is labelled **Your records**, **Verified fact**, **Reported, not verified**, **Calculation**, **Interpretation** or **Data gap**, and carries clickable source references (R1, R2…). **Data used** lists every record retrieved, with its source and timestamp.
- Media reports, rumours and anything taken from an archived briefing are **Reported, not verified**. If the model labels such a point a verified fact, Signal Desk relabels it and marks it **relabelled**. If an answer relies on a stale quote or out-of-date price history without saying so, Signal Desk adds a **Data gap** note.
- **Arithmetic is done by Signal Desk, not the model.** The trade calculator uses your shares, average cost, the **cash recorded in that account and currency** (and whether you confirmed it), the trade currency and any fees you state. It can size a trade by shares, a fraction, a cash amount or a target weight, and can chain up to six steps (for example: sell XEQT, convert CAD to USD, buy NBIS) with a warning if the plan needs more cash than you have recorded. It labels the price as an estimate and taxes as not estimated. If you don't state a commission, it does **not** assume $0: cash, proceeds and realized P/L are shown **before fees**, next to a "with your usual fee" line based on the fees in your recent recorded trades in that account. In a multi-step plan, a buy or a currency conversion can use the earlier sale's proceeds or available cash, the card lists every cash balance the plan touches, and a "With your usual fees" section shows the same balances with your recent commission charged on each step that has none stated. A ticker you no longer hold but have traded before can be used in a scenario. Scenarios are shown as **Hypothetical — not saved**. Follow-ups like "what about selling half?" reuse the earlier scenario's details.
- "How could earnings affect my position?" uses a price-move table (for example −15% to +15%). It is arithmetic, not a forecast.
- It says when data is missing, stale, delayed or unavailable, and treats saved briefings as snapshots, never as live data. A quote for a holding with no price provider is marked as not updating. A holding kept in several accounts is reported per account with combined totals computed by Signal Desk. News is never fetched for a holding whose identity you have not confirmed. The daily-move breakdown shows a currency effect only when the stored CAD/USD rate is from the same session as the move.
- "What changed" includes rescheduled earnings: when a provider moves a date, the new entry records the previous date and the move is reported, instead of the old date silently disappearing. Changes to timing and estimates are kept too.
- Personalised sizing waits until your risk answers (Settings) are complete; thresholds are described as app defaults unless you set them.
- An answer given without fetching any records (for example a follow-up answered from the conversation) is marked partial with a note saying so.

**What it can't do**
- It cannot trade, and it cannot change your records by itself. "Sell 10 NBIS for me" gets an explanation, not an order. If you ask it to **record** something you did (a trade, a cash balance, a strategy, an alert), it shows the **exact proposed change**: every field, the position before and after, and a warning if the same trade is already recorded. Nothing is saved until you press **Confirm**.
- A proposal uses only values from your own latest message: the request must start with the instruction ("Record…", "Log…", "Set…", "Add an alert…"), and the type (sold vs bought), currency, amounts, direction and any thesis text must match what you wrote. Questions (even polite ones containing "set" or "update"), "what if" / "simulate" / "scenario" framings, future plans, other people's trades and anything you pasted in quotes or attributed to an article never create one. If any part of a message asks Signal Desk to trade ("go ahead and sell…"), nothing is proposed. A backdated trade is valued at its date, with later trades replayed after it, and refused if it would exceed the shares held that day. When you press Confirm, Signal Desk checks the records again; if the position, cash or alert changed in the meantime, nothing is saved and you are asked to request a fresh proposal. Proposals expire after 24 hours.
- News, filings, notes and archived text are passed to the model as untrusted data. Your own notes and thesis text are marked as yours, but are still treated as information, not commands. News items that contain instructions aimed at an AI assistant are flagged as likely spam or manipulation. None of this text can trigger a proposal: a proposal must quote words from your own latest message, including the ticker, quantity, price or amount it records. When you press Confirm, Signal Desk also checks that an identical trade, deposit or alert wasn't saved in the meantime (for example from another conversation). If you have more than one account, a request to record a trade or cash balance must name the account, and a cash balance in an account holding both USD and CAD must name the currency.
- If a draft answer contains a sentence that reads as saying a trade was placed, is being placed, or a record was changed (whatever the wording: "offloaded", "zeroed out", "your order is working", "you now hold 0 NBIS"…), the model is asked once to rephrase it. Any such sentence still present is removed and flagged, in every part of the answer. This is a backstop, not a guarantee: on fresh wordings it had not been tuned on it caught roughly two in three such sentences, so read answers with the same care as any model output. Suggested follow-up questions are never phrased as instructions to record or trade (each sentence of a suggestion is checked).
- One question at a time per conversation. Closing the browser tab stops an answer in progress (and its spending).

**Model access and cost**
- The chat needs its **own Anthropic API key**: create one at console.anthropic.com and set `ANTHROPIC_API_KEY=` in `.env`, then restart. Building Signal Desk with Claude Code does **not** give the app model access, and a Claude subscription does not cover API usage.
- API usage is billed per token to that key. With the default model (`claude-opus-5-5`, about US$4 per million input tokens and US$20 per million output tokens; check anthropic.com/pricing) a typical question uses 5–40k input tokens and costs roughly US$0.05–0.30. Each answer shows the model that answered, its token use and the estimated cost.
- If the model declines a request, Anthropic may answer it with a designated fallback model instead; that answer is priced at the fallback model's rate and the answer shows which model was used.
- `CHAT_DAILY_BUDGET_USD` (default 5) stops chat spending after that estimate per day, counting the real and demo workspaces together. It is checked before every model call, counting an estimate for calls already in progress, so a long answer can stop part-way with a note. An answer cut off by a dropped connection or a closed tab is charged an estimate of what was generated. If `data/chat-usage.json` can't be read, chat pauses rather than guessing today's total; delete the file to reset (no restart needed). If you set `CHAT_MODEL` to a model Signal Desk has no price for, chat refuses to run until you set `CHAT_PRICE_INPUT` and `CHAT_PRICE_OUTPUT` (US$ per million tokens) or turn the cap off with `CHAT_DAILY_BUDGET_USD=0`.
- `CHAT_MODEL=claude-sonnet-5-5` is cheaper. `CHAT_EFFORT` (low–max) trades depth for cost. `CHAT_BACKEND=disabled` turns chat off.

**What is sent to Anthropic**
- Your question, the short text of earlier questions and answers in the same conversation, and the output of whichever tools the model calls for that question. Depending on the question, that output can include tickers, share counts, average costs, values, cash, account names, trade history and notes, your thesis text, risk answers, saved assessments and briefings, prices, news and company profiles.
- Never sent: API keys, passwords, email settings, backups or logs.
- Conversations are stored only in your local database. Delete them from the panel's conversation list. Daily spend totals are kept in `data/chat-usage.json`.

## 8. Backups

- An automatic backup is taken once a day at startup (last 30 kept) in `data\backups`.
- **Settings → Backup & restore**: create, restore (a safety copy is taken first), upload a backup file, or export JSON.
- To move to a new PC: copy the whole `signal-desk` folder including `data\` and `.env`.

## 9. Demo workspace

**Settings → Workspace → Open demo workspace** loads clearly labelled synthetic data in a separate database file (`data\demo.sqlite`). A banner shows on every page, and demo reports are never emailed. Real portfolio data never falls back to demo prices.

## 10. Remote access (not enabled)

Signal Desk binds to `127.0.0.1` and refuses to start on any other address unless you set **both** `SIGNAL_DESK_ALLOW_REMOTE=true` and a `SIGNAL_DESK_ACCESS_TOKEN` of 24+ random characters. Even then, put it behind HTTPS (e.g. a tunnel with its own login, such as Cloudflare Access or Tailscale) before exposing financial data. The token alone is not a substitute for HTTPS.

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| "Port 4317 is already in use" | Signal Desk is already running (check other windows), or set `SIGNAL_DESK_PORT=4318` in `.env`. |
| Prices show "No market data connected" | Set `MARKET_DATA_PROVIDER` and the key in `.env`, restart, then use Test connections. |
| A holding says "not priced" | Confirm its identity (Positions → open it). If the provider uses a different code, set "Provider symbol" there. |
| "Twelve Data returned X in CAD…" | The symbol maps to a different listing; check exchange/currency or set a provider symbol such as `SHOP:TSX`. |
| Daily request allowance used up | Lower the monitor frequency (Settings → Alerts) or upgrade the plan; data resumes the next day. |
| Email test fails with authentication error | Gmail needs an App Password (Google Account → Security → App passwords) and port 465. |
| Briefing shows "missed" | The computer was asleep, off or offline at that time. Expected for a local app. |
| Ask Signal Desk says it is not available | Add `ANTHROPIC_API_KEY` to `.env` and restart. If it says the daily cap is reached, raise `CHAT_DAILY_BUDGET_USD`. |
| Anything else | Settings → Show recent log (secrets are scrubbed), or `data\logs\signal-desk.log`. |

Run the automated tests with `npm test`.
