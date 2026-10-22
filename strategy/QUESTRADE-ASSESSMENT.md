# Questrade assessment (Phase 5): live trading is not set up

Written on 2026-10-21. Updated on 2026-10-22 to separate Questrade's
personal REST API from its official MCP server for AI agents. Simulation
only.

## Decision now

**All live trading stays disconnected.** Nothing in Signal Desk or the
Strategy Lab places, routes, drafts or prepares an order: not with Questrade,
not with any other broker, and not in TradingView Paper Trading.

**Signal Desk does not connect to Questrade.** It has no connection to the
Questrade MCP server and none to the Questrade REST API, not even a
read-only one. No Questrade token, login or server address goes into Signal
Desk's configuration, and no development session working on this project
adds the Questrade MCP server to its AI tools.

That stays true until both of the following hold:

- the evidence and controls in the pre-live checklist (section 8) are in
  place;
- the owner gives a **separate, explicit instruction** for a pilot
  (section 9).

Passing the acceptance criteria in `VALIDATION-PLAN.md` ("eligible for
review") is not that instruction and does not switch anything on.

Today, three things already rule out live trading:

- there are no backtest, validation or forward-test results on verified
  market data;
- the owner's last reported real available cash is **$0**;
- the project rules exclude brokerage order and trading-permission
  integrations (`CLAUDE.md`, "No trading"). That covers both Questrade
  interfaces below.

## At a glance: two different Questrade interfaces

Questrade offers two programmatic interfaces with different rules. A
statement about one says nothing about the other.

| | Personal REST API (section 1) | Questrade MCP server for AI agents (section 3) |
|---|---|---|
| What it is | Questrade's REST API. A customer registers a personal app in the API Centre and uses OAuth 2.0 tokens. | Questrade's Model Context Protocol server. A customer connects an AI agent (for example a chat assistant) and signs in on Questrade's own login page. |
| Reads account and market data | Yes. | Yes. Read-only access can be granted without trade permission. |
| Orders | **No** for a personal app. The `trade` scope is for approved partner developers only. | The agent can **draft** an order (a preview). It goes to market only if the customer approves it in the Questrade mobile app (Push Approval). |
| Can it act with no human? | Not applicable: no orders. | As reported, no. The agent cannot place, change or cancel an order without the customer's approval. |
| How current the sources are | Search summaries of pages reported as about 11 years old. | Search summaries of recent pages whose dates were not confirmed (the "Agentic Finance" release is dated 2026-07-30). |
| Connected to Signal Desk | **No** | **No** |

**The owner's statement.** The owner states that the official Questrade MCP
supports order drafting with user approval. The searches of questrade.com
made on 2026-10-22 support that statement (section 3, M5 to M7), but only as
search summaries: no Questrade page could be read directly. It is recorded
here as the owner's statement, backed by search summaries, not as an
independently verified fact.

## How to read the sources

The facts below come from `RESEARCH-NOTES.md` (sections 8 to 11). Their
status labels mean:

- **Search summary**: supported by an official search summary, that is a
  search result from questrade.com (including wealth.questrade.com) or
  tradingview.com. The page itself could not be fetched from the build
  environment (direct fetches failed with a DNS error, again on
  2026-10-22), so nothing here was read on the page or independently
  re-verified. "(2026-10-22)" marks the second Questrade pass: 11 searches
  restricted to questrade.com, mostly about the MCP server.
- **Likely**: a paraphrased, partial, conflicting or indirect source.
- **Unverified**: no official source was found.

A "quote" is what the search tool reported, not text checked on the page.
Several Questrade REST API pages were reported as about 11 years old, so a
rule quoted here may since have changed. The owner should check the linked
pages directly before acting on any of them.

## 1. The personal REST API

These rows describe the REST API documented at questrade.com/api only. They
do not describe the MCP server (section 3).

| Point | Status | Source |
|---|---|---|
| "Executing trades using the API is available to Questrade partner developers only. If you're a customer with Questrade, you can access account and market data but you cannot execute trades using the API." | Search summary (found three times, the last on 2026-10-22) | [questrade.com/api](https://www.questrade.com/api) |
| The OAuth scope table lists "Trade (partner developers only)", identifier `trade`. The read scopes cover account data (balances, positions, executions, orders) and market data (level 1 quotes, candles). | Search summary | [API security](https://www.questrade.com/api/documentation/security) |
| Order endpoints exist: `POST accounts/:id/orders` (place or replace), order impact (preview without placing), bracket and multi-leg strategy orders. Calling them needs the partner-only `trade` scope. | Search summary | [Orders endpoint](https://www.questrade.com/api/documentation/rest-operations/order-calls/accounts-id-orders) |
| Account and market-data access does not include order execution. | Search summary (follows from the two statements above) | [questrade.com/api](https://www.questrade.com/api) |
| The API is free; trades placed through a partner app pay the same commissions as Questrade's own platforms. | Search summary | [questrade.com/api](https://www.questrade.com/api) |
| Authorization is OAuth 2.0. A personal app registered in the API Centre gets a key (`client_id`); requests are accepted over HTTPS only. | Search summary | [Authorization](https://www.questrade.com/api/documentation/authorization) |
| Registration: an account in good standing, activate the API Centre, "Register a personal app", generate a manual authorization token; tokens can be revoked. | Search summary (describes the process, not whether it is open now) | [Getting started](https://www.questrade.com/api/documentation/getting-started) |
| A customer using personal API access for an app they built must accept Questrade's personal API licence agreement. The agreement's text was not seen. | Likely (2026-10-22; the summary did not name the page) | [Getting started](https://www.questrade.com/api/documentation/getting-started) |
| Rate limits: account calls 30 per second and 30,000 per hour; market-data calls 20 per second and 15,000 per hour; over the limit, HTTP 429 with code 1006. | Search summary (page may be out of date) | [Rate limiting](https://www.questrade.com/api/documentation/rate-limiting) |
| Without a real-time data subscription, quotes count as snapshots with a per-market limit, after which delayed data is returned. | Likely | [Quotes endpoint](https://www.questrade.com/api/documentation/rest-operations/market-calls/markets-quotes-id) |
| The API's enumerations list account types (including Margin, TFSA, RRSP and LRRSP) and order types (including Market, Limit, Stop, StopLimit, trailing-stop variants, limit-on-open and limit-on-close). | Search summary (2026-10-22, found incidentally; probably as old as the rest of the API pages) | [Enumerations](https://www.questrade.com/api/documentation/rest-operations/enumerations/enumerations) |
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
  **Search summary.**
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
  MCP server's human-approved order drafts (section 3).

## 3. The official Questrade MCP server for AI agents

Every row comes from the 2026-10-22 pass. The first pass (2026-10-21) found
the same setup guide and reported the same approval flow, but less detail.

| # | Point | Status | Source |
|---|---|---|---|
| M1 | **What it is.** An MCP server that lets an AI agent read the customer's account and market data and draft orders, with the customer's approval required for every order. All supported agents use one server address, `https://mcp.questrade.com/v1/brokerage/mcp`. | Search summary | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai), [MCP guides](https://www.questrade.com/learning/questrade-mcp), [Amplify your trading with AI](https://wealth.questrade.com/mcp) |
| M2 | Part of what Questrade calls "Agentic Finance": connect an AI agent to the Questrade account to ask questions, get portfolio insights and place trades in natural language, with approval required for each trade. | Search summary | [Agentic Finance](https://www.questrade.com/agentic-finance) |
| M3 | **Sign-in.** Adding the server opens Questrade's login in the browser. The customer signs in, reviews the permissions the agent asks for, and grants them (OAuth 2.0). The agent does not receive the password. | Search summary | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai), [Developer docs: MCP & llms.txt](https://www.questrade.com/learning/using-questrade/llms-txt-questrade-mcp) |
| M4 | **Read-only option.** Read-only access can be granted without trade permission. The guide calls the connection "read-first": order drafting is turned on separately, after an extra security check. One other Questrade page describes the connection as read and write without mentioning that step. | Search summary; what the extra check involves is Unverified | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai), [Connect Questrade to your AI tool](https://www.questrade.com/learning/using-questrade/connect-questrade-to-your-ai-tool) |
| M5 | **Order drafting.** With trade permission, the agent builds an order preview: symbol, buy or sell, order type, quantity, any limit or stop price, estimated cost and commission. The developer page describes the trading tools as "draft, change, and cancel orders, with a preview and a mandatory push notification". | Search summary | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai), [Developer docs: MCP & llms.txt](https://www.questrade.com/learning/using-questrade/llms-txt-questrade-mcp) |
| M6 | **Approval.** Questrade sends a Push Approval notification through the Questrade app on the customer's phone. The customer reviews the order there and approves it (the order goes to market) or declines it (the request is cancelled). Needs Questrade app 2.0.0 or later, Push Approval set up and notifications on. | Search summary | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai), [Push Approval](https://www.questrade.com/learning/using-questrade/push-approval-a-secure-and-convenient-way-to-protect-your-account) |
| M7 | **No action without approval.** "AI agents cannot place, modify, or cancel orders independently. Every trade requires your Push Approval." Changing an open order needs a fresh preview; a confirmed cancellation cannot be undone. | Search summary (quote as reported) | [Agentic Finance](https://www.questrade.com/agentic-finance), [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai) |
| M8 | A declined or ignored request is cancelled. How long an unanswered order request stays open was not found; an older Push Approval page gives a three-minute expiry for **login** approvals only. | Search summary; the order timeout is Unverified | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai), [Push Approval](https://www.questrade.com/learning/using-questrade/push-approval-a-secure-and-convenient-way-to-protect-your-account) |
| M9 | **Data exposed.** Balances, equity, positions, open and filled orders, and account activity (deposits, withdrawals, dividends, commissions) for the last 90 days; quotes, symbol search, historical prices (candles) and option chains. The full list of tools was not found (one marketing screenshot shows `get_positions`). | Search summary; the tool list is Unverified | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai), [Developer docs: MCP & llms.txt](https://www.questrade.com/learning/using-questrade/llms-txt-questrade-mcp) |
| M10 | **Accounts and eligibility.** The agent sees only the accounts on the Questrade login used to connect, within the permissions granted. Which account types can be connected (cash, margin, TFSA, RRSP, FHSA) and any other eligibility rule were not found. | Search summary; eligibility is Unverified | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai) |
| M11 | **Supported agents.** The pages conflict. The setup guide lists Claude (web, desktop), Claude Code, ChatGPT, Cursor, VS Code (GitHub Copilot Chat) and Codex CLI; the developer page says only Claude and Claude Code are supported for now; another page lists ChatGPT, Claude, Codex and Cursor. | Likely (conflicting pages; their dates were not confirmed) | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai), [Developer docs: MCP & llms.txt](https://www.questrade.com/learning/using-questrade/llms-txt-questrade-mcp), [Questrade Next](https://wealth.questrade.com/next) |
| M12 | **Costs.** Connecting "does not change your commissions, market-data entitlements, or account fees"; standard pricing applies. No separate fee for the MCP server was found. The commission that would apply to such orders was not established. | Search summary (the summary did not name the page); commissions Unverified | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai), [Pricing](https://www.questrade.com/pricing) |
| M13 | **Launch.** Questrade's newsroom lists a release dated 2026-07-30, "Questrade Leads New Age of Financial Services in Canada, Unleashing Agentic Finance, $0 Options and More". The release text was not seen, so the date the MCP server itself became available is not established. | Likely | [Press releases](https://www.questrade.com/newsroom/press-releases) |
| M14 | **Responsibility.** "Questrade does not control, monitor or take any responsibility for how your AI Agent uses your data. All actions taken, including trades are your sole responsibility", with reference to Questrade's API Access Agreement and Privacy Policy. An agent's responses, analysis and orders "come from that agent, not Questrade, and are not Questrade's advice or recommendation"; the customer reviews and approves everything "at your own discretion and risk". | Search summary (quotes as reported) | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai), [MCP guides](https://www.questrade.com/learning/questrade-mcp) |
| M15 | **Terms on automated trading.** The API Access Agreement itself was not found. Nothing found allows an MCP order without Push Approval. | Unverified | — |
| M16 | **Revoking.** Settings > API Access > Permissions. Revoking does not remove data already shared with the agent. | Search summary | [MCP Setup Guide](https://www.questrade.com/learning/using-questrade/connect-your-questrade-account-to-ai) |
| M17 | **Relation to the REST API.** Whether the MCP server uses the REST API's OAuth scopes (including the partner-only `trade` scope) or a separate channel was not found. questrade.com states both "trading through the API is for partner developers only" (section 1) and "agents can draft orders with Push Approval"; nothing found explains how the two fit together. | Unverified | [Developer docs: MCP & llms.txt](https://www.questrade.com/learning/using-questrade/llms-txt-questrade-mcp), [questrade.com/api](https://www.questrade.com/api) |
| M18 | **A different product.** Questrade's own "AI Assistant" is a separate information tool. Its disclosures say it is not connected to order execution and cannot trade. | Search summary | [AI Assistant disclosures](https://www.questrade.com/disclosure/legal-notice-and-disclosures/questrade-ai-assistant-important-disclosures-and-risk-information) |

**Also found, not researched: Flows in Questrade Pro.** The same "Agentic
Finance" pages describe Flows, a no-code feature of Questrade Pro that runs
rules the customer sets ("if this, then that") and can place orders when the
conditions are met. Limits were reported as $250,000 per order and up to 50
active Flows, at most 20 of them placing orders. The pages disagree on
whether a Flow can wait for the customer's sign-off. **Search summary
(2026-10-22, found incidentally).**
[Flows in Questrade Pro](https://www.questrade.com/learning/using-questrade/automate-your-trading-strategy-with-flows-in-questrade-pro)
Flows is not the MCP server. Signal Desk cannot drive it, and using it would
be live trading under sections 8 and 9.

### What this means for this project

- **An approved draft is a live order.** Push Approval keeps a human in the
  loop, but once the owner approves, the draft becomes a real order at
  Questrade with real money, exactly as if it had been entered by hand. It is
  not a simulation, a paper trade or "only a draft". The MCP route is
  therefore in scope of the pre-live checklist (section 8) and of the
  separate-instruction rule (section 9).
- **Signal Desk does not connect to it**: not now, not read-only, and not
  under this brief. Signal Desk's chat agent has read-only tools; its only
  write path is a proposed record change that the owner confirms, and it has
  no order path. The Strategy Lab never reads real cash or holdings. No Lab
  signal, alert or simulated trade is handed to an MCP-connected agent to
  draft an order.
- **Development sessions do not connect to it either.** No AI agent working
  on this repository adds the Questrade MCP server or a Questrade connector,
  holds a Questrade token, or drafts an order.
- **Never automate the approval or the brokerage interface.** No script,
  notification handler, accessibility or desktop automation, browser
  extension or second agent may answer a Push Approval request or operate
  the Questrade app or website. Each approval is the owner's own decision,
  made on the phone after comparing the preview with the signal.
- **Trade records.** Signal Desk has no broker connection, so none of its
  records is BROKER-CONFIRMED. A real order the owner places or approves
  elsewhere enters Signal Desk only when the owner records it, and it is
  then USER-REPORTED. Signal Desk never states that an order was placed
  because a conversation suggests it.
- **Using it for data is a separate decision.** The MCP server's read-only
  market data is not a Strategy Lab data source. Using it, or the REST API,
  for data would need its own instruction and the same checks as any other
  source: entitlement, permitted use, history depth and limits.

## 4. What is not known: questions for the owner to check

Nothing below is stated as fact anywhere in the project.

1. **Account types.** Which of the owner's accounts (cash, margin, TFSA,
   RRSP, FHSA; CAD and USD sides) can be used through the TradingView
   integration and the MCP server? (The MCP guide says the agent sees the
   accounts on the login used; which account types are eligible was not
   found.) Which can a personal API app read?
2. **Registration status.** Is personal-app registration in the API Centre
   open today? Has developer.questrade.com changed any of the rules?
3. **Commissions and fees.** What are the current commissions and any ECN
   or other fees on US-listed stocks and ETFs, including for orders approved
   through the MCP server?
   ([questrade.com/pricing](https://www.questrade.com/pricing))
4. **Currency conversion.** What does converting CAD to USD (and back) cost
   for the account that would be used? Can the account hold USD, so that
   conversion happens only when the owner chooses?
5. **Market data.** Which real-time data package would be needed for US
   quotes, and what does it cost?
6. **Order types.** Which order types do the TradingView–Questrade panel and
   the MCP server's drafts support? In particular: limit orders with a time
   limit, stop orders, and bracket (stop plus target) orders.
7. **Partner apps.** Does any app in Questrade's App hub offer human-approved
   or rule-based order placement suitable for this purpose? The first pass
   saw only page titles (VectorVest, OptionsPlay, Stock Unlock). The second
   pass came across a Questrade setup guide for a TipRanks integration that
   places Market, Limit, Stop and Stop limit orders from any self-directed
   account, and an App hub page titled "Pilot Trading". **Search summary
   (2026-10-22, found incidentally)**; neither was assessed.
   [App hub](https://www.questrade.com/partner-centre/app-hub),
   [TipRanks setup guide](https://www.questrade.com/learning/using-questrade/connecting-tipranks)
8. **MCP server details.** What is the "extra security check" before trade
   permission? How long does an unanswered order request stay open? Can
   trade permission be limited to one account? What does the API Access
   Agreement say about agent-drafted orders? Which agents are supported
   today? Does the server use the partner-only `trade` scope?

## 5. Why Signal Desk does not automate execution

1. **The personal REST API does not allow it.** Order placement needs the
   `trade` scope, which the documentation reserves for approved partner
   developers. A personal app can read account and market data only. A
   personal token is never to be used against the order endpoints. Whether
   partner status could apply to a project like this is a question for
   Questrade, not a rule to work around.
2. **TradingView does not do it.** Pine strategies cannot send orders to
   Questrade, even when Questrade is connected in the Trading Panel. Alerts
   only deliver a message.
3. **The MCP server keeps a human in the loop.** As reported, every order an
   agent drafts needs the owner's Push Approval, and the agent cannot place,
   change or cancel an order on its own (section 3, M5 to M7). That is
   human-approved order drafting, not unattended automation, and an approved
   draft is a live order.
4. **Questrade's own rule-based automation was not assessed.** Flows in
   Questrade Pro runs inside Questrade's platform (section 3). Signal Desk
   cannot and will not drive it.
5. **The project rules exclude it.** Signal Desk has no brokerage order or
   trading-permission integration, and none will be added under this brief.
6. **The evidence and the money are not there.** There are no out-of-sample
   or forward results on verified market data, and the last reported real
   available cash is $0.

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
costs and how it handles errors. The research found the App hub and a
TipRanks setup guide but did not check what any app does.

### C. Questrade's MCP server with per-order approval

Whether the owner connects an AI agent to Questrade outside this project is
the owner's own decision. Using it for orders that come from this strategy
would be live trading: it needs everything in section 8, a separate
instruction under section 9 that names this route, and answers to the
questions in section 4 (item 8) on the owner's own account. Signal Desk
would still not connect to it, would not hand signals to the agent, and
would never approve anything.

### Never

None of the following, under any instruction given through this project:

- connecting Signal Desk, its chat agent, the Strategy Lab or a development
  session to the Questrade MCP server or the Questrade REST API;
- approving a Push Approval request by anything other than the owner's own
  deliberate decision after reading the preview: no automated, scripted or
  batch approval;
- screen-scraping Questrade or TradingView;
- unofficial or reverse-engineered APIs;
- sharing Questrade passwords, tokens or two-factor codes with Signal Desk
  or any third party;
- browser or desktop automation that clicks buy or sell, or that operates
  the Questrade app, website or Questrade Pro on the owner's behalf;
- third-party "webhook to broker" bridges that Questrade has not approved;
- using a personal API token against the order endpoints.

## 7. Canadian account considerations (to verify with Questrade or a tax professional)

These are questions, not rules. The research did not source Canadian account
or tax rules beyond the one incidental item below, and the owner should get
the answers from Questrade or a qualified tax professional.

- **Registered-account restrictions.** What does a TFSA or RRSP at Questrade
  allow, in particular margin and short selling? The strategy is long-only
  with no margin, but the account's rules should be confirmed. (Questrade's
  Margin Power page says margin cannot be used in a TFSA, citing CRA rules.
  **Search summary (2026-10-22, found incidentally).**
  [Margin Power and your TFSA](https://www.questrade.com/learning/accounts-taxes/margin-power-and-your-tfsa))
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

The checklist covers every route that ends in a real order: placed by hand
on a Questrade platform, through TradingView's Questrade panel, by a partner
app, by a Questrade Pro Flow, or as an MCP draft that the owner approves on
the phone. Approving an MCP draft places a live order, so it needs exactly
the same evidence.

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
| 12 | **Order-route controls** | For the route the pilot instruction names: who or what creates each order and who approves it. For the MCP route, also: the permissions granted (read-only or trade), which agent and which accounts it can see, the Push Approval settings, how access is revoked (tested once), and a written rule that the owner checks each approval against the signal (items 8 and 9) and never approves automatically or in bulk. |

## 9. A pilot needs a separate, explicit instruction

Even with every checklist item met, nothing changes until the owner gives a
separate, explicit instruction for a pilot. The instruction should name:

- the account and the cash amount;
- the configuration (intraday or swing) and the strategy version;
- the risk limits;
- the order route (by hand, TradingView's Questrade panel, a partner app,
  or the MCP server with Push Approval);
- the pilot's length and its stop conditions.

Under this brief, a pilot would still use alternative A: the owner reviews
each signal and places each order by hand. Any other route, including MCP
drafts approved on the phone, would need its own assessment, including the
open questions in section 4 and whether Questrade permits it, and the
instruction must name it.
