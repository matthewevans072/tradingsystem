# Questrade assessment (Phase 5): live trading is not set up

Written on 2026-10-21. Simulation only.

## Decision now

**No live trading.** Nothing in Signal Desk or the Strategy Lab places,
routes or prepares an order: not with Questrade, not with any other broker,
and not in TradingView Paper Trading. That stays true until all of the
following hold:

- the evidence and controls in the pre-live checklist below are in place;
- the owner gives a **separate, explicit instruction** for a pilot.

Passing the acceptance criteria in `VALIDATION-PLAN.md` ("eligible for
review") is not that instruction and does not switch anything on.

Today, three things already rule out live trading:

- there are no backtest or forward-test results yet;
- the owner's last reported real available cash is **$0**;
- Questrade's documentation reserves order placement through its API for
  approved partner developers (section 1).

## How to read the sources

The facts below come from `RESEARCH-NOTES.md`. Their status labels mean:

- **Search summary**: supported by a search result from questrade.com or
  tradingview.com. The page itself could not be fetched from the build
  environment, and the planned second-pass cross-check ran out of search
  budget, so nothing here was independently re-verified.
- **Likely**: a paraphrased, partial or indirect source.
- **Unverified**: no official source was found.

Several Questrade API pages were reported as about 11 years old. A rule
quoted here may since have changed. The owner should check the linked pages
directly before acting on any of them.

## 1. What Questrade's API documentation says

| Point | Status | Source |
|---|---|---|
| "Executing trades using the API is available to Questrade partner developers only. If you're a customer with Questrade, you can access account and market data but you cannot execute trades using the API." | Search summary (found twice) | [questrade.com/api](https://www.questrade.com/api) |
| The OAuth scope table lists "Trade (partner developers only)", identifier `trade`. The read scopes cover account data (balances, positions, executions, orders) and market data (level 1 quotes, candles). | Search summary | [API security](https://www.questrade.com/api/documentation/security) |
| Order endpoints exist: `POST accounts/:id/orders` (place or replace), order impact (preview without placing), bracket and multi-leg strategy orders. Calling them needs the partner-only `trade` scope. | Search summary | [Orders endpoint](https://www.questrade.com/api/documentation/rest-operations/order-calls/accounts-id-orders) |
| Account and market-data access does not include order execution. | Search summary (follows from the two statements above) | [questrade.com/api](https://www.questrade.com/api) |
| The API is free; trades placed through a partner app pay the same commissions as Questrade's own platforms. | Search summary | [questrade.com/api](https://www.questrade.com/api) |
| Authorization is OAuth 2.0. A personal app registered in the API Centre gets a key (`client_id`); requests are accepted over HTTPS only. | Search summary | [Authorization](https://www.questrade.com/api/documentation/authorization) |
| Registration: an account in good standing, activate the API Centre, "Register a personal app", generate a manual authorization token; tokens can be revoked. | Search summary (describes the process, not whether it is open now) | [Getting started](https://www.questrade.com/api/documentation/getting-started) |
| Rate limits: account calls 30 per second and 30,000 per hour; market-data calls 20 per second and 15,000 per hour; over the limit, HTTP 429 with code 1006. | Search summary (page may be out of date) | [Rate limiting](https://www.questrade.com/api/documentation/rate-limiting) |
| Without a real-time data subscription, quotes count as snapshots with a per-market limit, after which delayed data is returned. | Likely | [Quotes endpoint](https://www.questrade.com/api/documentation/rest-operations/market-calls/markets-quotes-id) |
| Whether personal-app registration is open, paused or restricted today. | Unverified | [API FAQ](https://www.questrade.com/api/support) |

## 2. The TradingView–Questrade integration

- Questrade is a TradingView-integrated broker. The owner can open the
  Trading Panel, choose Questrade, sign in, and then place orders **by hand**
  from TradingView charts. **Search summary.**
  [TradingView broker page](https://www.tradingview.com/broker/Questrade/)
- Questrade's pages say: sign-in happens on Questrade's page with
  multi-factor authentication; free and paid TradingView plans both work;
  any of the customer's self-directed accounts can be used; options cannot
  be traded through TradingView. Their pages conflict about mobile support.
  **Search summary (this pass).**
  [Getting started with TradingView](https://www.questrade.com/learning/using-questrade/tradingview)
- Which order types the integration offers was not found. **Unverified.**
- **Pine strategies still cannot place orders automatically.** TradingView's
  Pine FAQ says Pine does not support placing orders through brokers
  connected in the Trading Panel, or through Paper Trading. A strategy
  running on a chart connected to Questrade only simulates its trades.
  **Search summary.** [Pine FAQ: Strategies](https://www.tradingview.com/pine-script-docs/faq/strategies/)
- TradingView alerts can send a message to a webhook URL, but TradingView
  does not turn that message into an order. Something outside TradingView
  would have to place the order. For a personal Questrade account, the
  documented programmatic order routes are partner apps (section 1) and the
  per-trade-approval connection in section 3.

## 3. Questrade's AI-agent (MCP) connection

**Status: Search summary (this pass).** The first research pass rated it
**Likely**, because the page was only paraphrased. Neither pass read the page
itself.

As reported, the "Questrade MCP Setup Guide" says:

- an AI agent can be connected to a Questrade account; sign-in happens on
  Questrade's own page;
- read-only access can be granted without trade permission;
- trading needs a separate permission;
- each order the agent prepares is shown as a preview;
- Questrade sends a Push Approval notification to the Questrade app, where
  the customer approves or declines it;
- the agent cannot place, change or cancel an order on its own, and an
  ignored request is cancelled.

One Questrade page describes the connection as read-and-write. The newer
guide says trading permission is turned on separately, after an extra
security check.
[Questrade MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai)

What this means here:

- **It is not automated execution.** Every order needs the owner's approval
  on their phone.
- **Signal Desk does not connect to it and will not.** The project rule is
  "no brokerage order or trading-permission integrations". Signal Desk's chat
  agent cannot place orders. Its only way to change anything is a proposed
  record change that the owner must confirm.
- If the owner chooses to use it, that is their own decision, made outside
  Signal Desk and after the checklist below. It has to be checked first, as
  set out next.

What is still unknown about it:

- when it launched;
- who is eligible, and for which account types;
- whether it uses the partner-only API scope or a separate channel;
- any costs.

## 4. What is not known: questions for the owner to check

The research did not reach these topics before its search budget ran out.
Nothing below is stated as fact anywhere in the project.

1. **Account types.** Which of the owner's accounts (cash, margin, TFSA,
   RRSP, FHSA; CAD and USD sides) can be used through the TradingView
   integration and the MCP connection? Which can a personal API app read?
2. **Registration status.** Is personal-app registration in the API Centre
   open today? Has developer.questrade.com changed any of the rules?
3. **Commissions and fees.** What are the current commissions and any ECN
   or other fees on US-listed stocks and ETFs?
   ([questrade.com/pricing](https://www.questrade.com/pricing))
4. **Currency conversion.** What does converting CAD to USD (and back) cost
   for the account that would be used? Can the account hold USD, so that
   conversion happens only when the owner chooses?
5. **Market data.** Which real-time data package would be needed for US
   quotes, and what does it cost?
6. **Order types.** Which order types does the TradingView–Questrade panel
   support? In particular: limit orders with a time limit, stop orders, and
   bracket (stop plus target) orders.
7. **Partner apps.** Does any app in Questrade's App hub offer human-approved
   or rule-based order placement suitable for this purpose? The research saw
   only page titles (VectorVest, OptionsPlay, Stock Unlock), not what those
   apps do. [App hub](https://www.questrade.com/partner-centre/app-hub)

## 5. Why direct automated execution is not supported for a personal account

1. **The Questrade API does not allow it.** Order placement needs the `trade`
   scope, which the documentation reserves for approved partner developers.
   A personal app can read account and market data only. A personal token
   is never to be used against the order endpoints. Whether partner status
   could apply to a project like this is a question for Questrade, not a
   rule to work around.
2. **TradingView does not do it.** Pine strategies cannot send orders to
   Questrade, even when Questrade is connected in the Trading Panel. Alerts
   only deliver a message.
3. **The only other documented route keeps a human in the loop.** The MCP
   connection (section 3) requires approval of every order on the owner's
   phone, so it is not unattended automation. Its details are not yet
   checked.
4. **The project rules exclude it.** Signal Desk has no brokerage order or
   trading-permission integration, and none will be added under this brief.
5. **The evidence and the money are not there.** There are no out-of-sample
   or forward results, and the last reported real available cash is $0.

## 6. Supported alternatives (human in the loop)

### A. Signal → owner review → owner places the order by hand

1. **Signal.** The Strategy Lab's simulated forward test, or a TradingView
   alert from the Pine strategy, produces a signal: symbol, breakout bar,
   planned stop, target and highest acceptable entry price.
2. **Owner review.** The owner checks the signal before acting:
   - the bar is current: Signal Desk treats a signal processed more than 5
     minutes after its bar closed as expired;
   - the chart and the box still make sense;
   - the entry price is not above the maximum acceptable entry;
   - the size is recalculated from **real** available cash and the owner's
     **approved** risk limits. The simulated account's US$100,000 and 0.25 %
     risk per trade are testing assumptions, not limits for real money;
   - the commission and currency costs are known.
3. **Order.** The owner places the order by hand: in a Questrade platform,
   or in TradingView's Questrade trading panel.
4. **Record.** The owner records the trade in Signal Desk as they would any
   other trade. Nothing is recorded without the owner's confirmation, and
   the simulated account is never mixed with real holdings.

### B. An officially approved Questrade partner app

Use one only if an approved app exists for this purpose. This must be
verified with Questrade first, including the app's terms, permissions,
costs and how it handles errors. The research found the App hub but did not
check what any listed app does.

### C. Questrade's MCP connection with per-trade approval

This is as reported in section 3. It is still a human-approved order, and it
is outside Signal Desk. It must be checked on the official page first.

### Never

None of the following, under any instruction given through this project:

- screen-scraping Questrade or TradingView;
- unofficial or reverse-engineered APIs;
- sharing Questrade passwords, tokens or two-factor codes with Signal Desk
  or any third party;
- browser or desktop automation that clicks buy or sell;
- third-party "webhook to broker" bridges that Questrade has not approved;
- using a personal API token against the order endpoints.

## 7. Canadian account considerations (to verify with Questrade or a tax professional)

These are questions, not rules. The research did not source any Canadian
account or tax rule, and the owner should get the answers from Questrade or
a qualified tax professional.

- **Registered-account restrictions.** What does a TFSA or RRSP at Questrade
  allow, in particular margin and short selling? The strategy is long-only
  with no margin, but the account's rules should be confirmed.
- **Frequent trading in a TFSA.** Could frequent buying and selling inside a
  TFSA (intraday, or swing trades held up to 10 sessions) be treated as
  carrying on a business? If so, what would that mean for the account? This
  is a question for a tax professional.
- **USD conversion costs for a CAD account.** Every US trade from CAD cash
  may pay conversion on the way in and out. Ask what that costs, and whether
  holding USD avoids it. If real results are ever modelled for a CAD
  account, the engine's `fxConversionPct` should be set from Questrade's
  actual cost, not left at 0.
- **Other questions to ask.**
  - How are US dividends and other US-source income taxed in each account
    type?
  - Does Questrade apply any day-trading or minimum-balance rules to the
    account that would be used?
  - When is cash from a sale available again?

## 8. Pre-live checklist

Every item must be satisfied, with the evidence written down, before a
pilot can even be proposed.

| # | Requirement | What counts as evidence |
|---|---|---|
| 1 | **Out-of-sample evidence** | For the configuration in question (intraday or swing), validation and holdout results with outcome "eligible for review" under `acceptance-v1.json` (B1–B10), from a holdout run that is not marked contaminated, at realistic costs. |
| 2 | **Forward evidence** | The simulated forward test meets F1–F4: at least 100 closed trades and at least 3 months, one version and config hash throughout, forward results inside the holdout interval, at most 5 % of signals lost to stale data or errors, no duplicate trades. |
| 3 | **Actual deployable cash** | The last reported real available cash is **$0**. The owner states an amount of their own available cash, the account and the currency, and records it in Signal Desk. No borrowing, and no assumption that any holding is sold. Paper profits never count. |
| 4 | **Approved risk limits** | Written limits from the owner: risk per trade, total open risk, maximum positions, daily loss limit, and the drawdown at which the pilot stops. The simulated settings are not approved limits. |
| 5 | **Account permissions and restrictions** | The answers to sections 4 and 7: account type, trading permissions, registered-account rules, order types available, CAD/USD handling, data subscription. |
| 6 | **Real costs** | Actual commissions, fees, currency conversion and typical spreads, put into the strategy config. Results re-run with them (and at twice them) still pass. |
| 7 | **Position reconciliation** | A daily routine comparing broker positions, orders and cash with Signal Desk's records. Any mismatch stops new trades until it is explained. |
| 8 | **Duplicate-order prevention** | One decision per box. A check for open orders and positions in the symbol before any order. Alerts deduplicated (TradingView can resend webhooks). A written rule that an order is never re-entered "to be sure". |
| 9 | **Stale-data protection** | No action on a signal whose bar was processed more than 5 minutes after it closed, or whose quote is delayed (for example a `_DL` symbol). A real-time data entitlement confirmed for the instruments traded. |
| 10 | **Daily loss controls and emergency shutdown** | A daily loss limit that stops new orders. A written procedure to cancel all open orders and close positions by hand, tested once. Who does it, and how, if Signal Desk or TradingView is unavailable. |
| 11 | **Order rejection and partial fills** | Written handling for: a rejected order; a partial fill (size the stop and target to the filled quantity); a fill above the maximum entry; a missed time exit (intraday positions must be flat before the close, which may need an order resting at the broker); a gap through the stop (losses can exceed the planned risk). |

## 9. A pilot needs a separate, explicit instruction

Even with every checklist item met, nothing changes until the owner gives a
separate, explicit instruction for a pilot. The instruction should name:

- the account and the cash amount;
- the configuration (intraday or swing) and the strategy version;
- the risk limits;
- the pilot's length and its stop conditions.

Under this brief, a pilot would still use alternative A: the owner reviews
each signal and places each order by hand. Any move beyond that would need
its own assessment, including whether Questrade permits it.
