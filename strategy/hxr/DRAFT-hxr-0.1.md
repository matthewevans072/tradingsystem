# Hold, full exit and re-entry (HXR): draft 0.1

> **Superseded on 2026-10-22 by `PREREGISTRATION-2.md` (hxr-prereg-2).** The
> exit rules and the buy-back rule were merged into the existing HXR module.
> Three things changed from this draft:
> - recovery points and normal movement use closes instead of lows and ATR;
> - the intraday variant is dropped (decisions are made after the close);
> - the criteria stay G1–G6.
>
> The owner questions in §10 remain open. The experimental defaults in
> PREREGISTRATION-2.md §1 stand in for them. Kept as the record of the
> proposal.

**Status: DRAFT for the owner's answers.** Nothing in this file is an
approved rule.

- **Nothing built or run.** No code, data download, backtest or simulation
  has been made for this strategy.
- **Separate from consolidation-breakout.** It is a different strategy from
  cb-1.0.0 / cb-1.1.0. It shares none of their configs, runs or holdout
  records, and those files are not changed.
- **Not shown to work.** Nothing here shows the strategy works or is
  profitable.
- **Off.** Scheduled monitoring, reminders, notifications and order execution
  stay off. No paid service or API billing is used without approval.

Each item below is marked:
- **[CONFIRMED]**: what you told me about how you trade;
- **[PROPOSED TEST]**: a setting I propose to test, not a rule you chose;
- **[OPEN]**: a decision only you can make (questions in section 10).

---

## 1. What Signal Desk already has that this can reuse

| Existing part | Reuse for HXR | Change needed |
|---|---|---|
| Portfolio records: holdings, average cost, splits, cash per currency, `long_term` / `swing` / `unclassified` label per holding | Which holdings belong to this strategy. Real cash and position records. | None. Your saved records are not in this folder (see 9.1). |
| Rules-based position assessments: HOLD / TRIM / SELL / WAIT / CONDITIONAL ADD / INSUFFICIENT EVIDENCE. They never add on a fall alone or sell on a rise alone; a buy needs confirmed cash; sizing needs a completed risk profile. | The same safety principles. The risk-profile questions overlap with section 10. | HXR stages run beside these assessments; they do not replace them. |
| News: Finnhub company news, SEC EDGAR filings, source classes (press release, media, other), "unconfirmed" wording flags, observed price reaction | The news side of each stage | A structured record of fact, reaction, interpretation and uncertainty (section 6) |
| Ask Signal Desk proposals: Proposed, then Confirm, then User-reported. Trade-status labels PROPOSED / SIMULATED / USER-REPORTED. | Keeps simulated and real trades visibly apart; preserves the confirmation safeguard | None |
| Strategy Lab tools: readiness checks, data provenance, cost model, metrics, reports, holdout ledger, no-look-ahead tests | The evaluation machinery | A daily-bar version. Its own database and its own holdout ledger, so nothing mixes with cb. |
| Alpaca history source (free, split-adjusted, consolidated tape) | Price history | It fetches only 15-minute bars today. HXR needs daily bars: a separate, added request type. |
| Exchange calendar 2021–2027 | Trading days | Must be checked further back if earlier history is used |

What does not fit: the consolidation-breakout engine. It is an intraday
pattern strategy, so HXR needs its own small engine.

## 2. Your strategy in plain language [CONFIRMED]

- **What you buy.** You buy technology and AI-related companies you
  understand, when the news, earnings, company developments and the sector
  outlook make the opportunity look attractive.
- **Holding.** You hold while the price rises, and you accept temporary dips
  as long as the business story and the rising pattern still hold.
- **Selling.** You sell the whole trading position at once when one of these
  happens:
  - the rise looks like it is failing;
  - news changes the outlook;
  - your loss limit is reached.

  The money then stays in cash.
- **Buying back.** You may buy the same stock again below your selling price,
  but only if the business still looks right and a fresh entry assessment
  supports it. That price can be above your first purchase.
- **Your example.** Buy at $100, sell around $180–190 after a peak near $200,
  then consider buying back around $150. It illustrates the behaviour. It is
  not a threshold or a forecast.
- **Diversifying.** You may diversify outside AI, but only with a real
  investment case for each stock. Cash is a valid position. You don't rotate
  just because a stock is slow or another one is rising.

The research question has three parts:

1. **News** explains *why* you own a stock.
2. **Price behaviour** helps judge *when* a rise may be weakening.
3. **A separate risk budget** limits what you can afford to lose.

Three things are ruled out:
- a chart-only system;
- holding forever because you like the company;
- claiming to spot tops, bottoms or recoveries in advance.

### Terms used

| Term | Meaning |
|---|---|
| Daily bar | One trading day's open, high, low, close and volume |
| Close | The last price of the regular session (09:30–16:00 New York time) |
| Gap | The next day opens well above or below the previous close, so no trade happened in between. Stop orders can fill far below their price. |
| ATR (average true range) | The stock's typical daily price movement, averaged over 14 days, in dollars. It measures "normal" movement. |
| Recovery point (swing low) | An earlier low from which the price rose again. It can only be recognised after the rise has happened (section 5.2). |
| Drawdown | The largest fall in account value from a previous high, in % |
| Stop order | An instruction to sell if the price trades at or below a level. **It is not a guaranteed price:** in a gap or a fast market it fills at the next available price, which can be much lower. |
| Confirmation | Waiting, for example for the daily close, before acting on a level. It avoids some false alarms, but the price can fall further while you wait, so a confirmed exit can lose more than an immediate one. |
| Slippage and spread | The difference between the quoted price and what you actually get |
| In-sample / out-of-sample | Data used to design a rule, versus data it has never been tuned on |

## 3. Stages

Every tracked stock is in exactly one stage. "Numerical" means it is decided
by a reproducible price rule; "news-based" means by a recorded judgment of
sourced facts.

| Stage | Required evidence | Blocks a trade | Missing information today | Decision type | Moves to |
|---|---|---|---|---|---|
| **S1. Waiting for an initial entry** | A written investment case citing sourced facts (section 6); an entry assessment (price at or near a defined level, no exit condition already active); confirmed cash; a risk budget and size | Cash not confirmed; no risk budget; earnings inside the blackout window [OPEN Q4]; the case rests only on unconfirmed reports; a leveraged daily product (separate process) | Risk budget, size, earnings policy, which stocks [OPEN Q2, Q4, Q6] | Both | S2, after a *user-reported* purchase (a simulated buy moves only the simulated record) |
| **S2. Holding a position** | Entry record; highest *verified* price since entry, from stored bars not memory; the active exit level of the chosen candidate; latest news check | none | Initial loss limit, how often you check [OPEN Q1–Q3] | Both | S3 when an exit condition triggers or news may break the case |
| **S3. Reviewing a possible full exit** | Which trigger fired (price rule, news, or risk limit), with the data and the time it existed; the decline assessed as A, B or C (section 4) | A news-only exit needs a verified fact, not a rumour. A price-rule exit is not blocked by optimism about the company: that is the point of the rule. | Your list of invalidating news [OPEN Q5] | Both | S4 after a full exit (user-reported or simulated). S2 if the review finds no exit condition after all, which is recorded. |
| **S4. Holding cash after an exit** | Exit price and time, cash recorded as returned (real cash only from your records), reason for exit | Proceeds are not reinvested automatically | none | Both | S5 when a re-entry condition appears and the outlook is intact. S6 if the outlook has weakened. S1 if price closes above the exit price without a re-entry (a "missed rebound"). |
| **S5. Reviewing a lower-priced re-entry** | Price below the previous exit price, a re-entry signal (5.4), a fresh entry assessment, an intact outlook, confirmed cash and size | Price at or above the exit price; outlook weakened; no cash or risk budget; earnings window | Same as S1 | Both | S2 after a re-entry. S4 if rejected. S6 if the news weakened. |
| **S6. Staying out: outlook weakened** | Verified negative company facts (decline type B), with sources | Any buy, until a new investment case is written | What would restore the case [OPEN Q5] | News-based | S1 only with a new, written investment case. Price recovery alone never moves it. |

## 4. Three kinds of decline (assessments, never certain at the time)

| | A. Temporary dip, outlook intact | B. Business prospects worsening | C. Sector-wide fall, nothing company-specific verified |
|---|---|---|---|
| Typical evidence | No new negative company facts. The fall is within the stock's normal movement (above the active exit level). Peers are mixed. | A verified company fact: lowered guidance, weaker revenue or margins than its own previous outlook, a lost customer or contract confirmed by the company or a filing, cash burn, dilutive financing, a regulatory block | Peers and a sector index fall together. No company filing or statement explains the fall (for example rates, export rules for a whole industry, an index sell-off). |
| What it means for HXR | Hold. The price rule still applies: a dip that breaks the exit level is exited even if it is "probably temporary". | Exit review (S3) whatever the price. If you exit, go to S6. | The price rule decides. Re-entry is allowed (S5) if the case is intact. |
| Uncertainty | Real-time labels are often wrong. A could become B when results arrive; C can hide a company-specific weakness. | A cash loss and a noncash accounting charge are different (section 6) | Industry rules such as export controls can be company-specific in effect |
| Recorded as | The assessment with its evidence and a confidence word (low / moderate / high), at the decision time. A later outcome is added separately; the original label is never edited. | | |

## 5. Exit and re-entry research

### 5.1 The approaches and their tradeoffs

| Approach | For | Against |
|---|---|---|
| **Break below an earlier recovery point** | Follows the idea of a rise that keeps making higher lows. The level rises only when the market has printed a new higher low. | A recovery point is only known some days after it formed. Levels can sit far below the price after a steep rise, giving back a lot. |
| **Allowance for normal movement** (a multiple of ATR below the highest close) | Scales with each stock's volatility. Simple and reproducible. | It ignores chart structure. Wider settings give back more; narrower ones exit on noise. |
| **Intraday trigger versus daily close** | Intraday: exits sooner in a real collapse. Close: ignores intraday spikes down. | Intraday triggers fire on brief dips and recovered spikes. Waiting for the close can mean a lower exit after a bad day or a gap. **Neither guarantees the price.** |
| **Give back 10% of the peak unrealised gain** | Easy to state, and keeps 90% of the gain on paper | After a large rise it becomes very tight. On $100 to $200 it exits at $190, a 5% dip, which is about 1–2 normal days for a volatile tech stock. That is exactly your concern. A tiny gain makes it exit on noise unless it starts later. |
| **Hold (benchmark)** | No exit mistakes; lowest costs and taxes | Takes the full fall in a real decline |

### 5.2 Rules common to every price test [PROPOSED TEST]

- **Bars.** Daily regular-session bars, split-adjusted, not
  dividend-adjusted. Dividends are not credited in either the strategy or the
  hold benchmark; cash earns 0%. Both are stated limitations.
- **ATR.** ATR(14), Wilder's method, from completed days only.
- **A signal acts only after its information exists.** A rule judged on the
  daily close acts at the **next day's open**. An intraday trigger acts on a
  resting stop order placed from levels known before the day started.
- **Recovery point.** Day *i* is a recovery point if both hold:
  - its low is strictly below the lows of the 5 trading days before it and
    the 5 after it;
  - some close in those 5 later days is at least 1.0 × ATR(14) above that low
    ("the price rose again").

  It becomes **known only at the close of day i + 5**. Before then it does not
  exist for any rule.
- **Fills.** A sell at the open fills at open × (1 − 4 bps), which is half
  the spread plus slippage. A buy fills at open × (1 + 4 bps). An intraday
  stop fills at the lower of the stop level and the day's open, × (1 − 4 bps),
  so a gap below the stop fills at the gap price.
- **Costs.** Commission and currency conversion are unknown [OPEN Q7]. Tests
  run with commission $0 and US$5 per order, and with currency conversion 0%
  (a USD account) and 1.5% each way (converting CAD).
- **Missing data.** No signal that day, and levels carry over. More than 3
  missing sessions in a row means a data warning, and the stock is reported
  separately.
- **Earnings.** Price tests hold through earnings: no historical earnings
  dates are used for decisions. Results are also split by whether an exit came
  within 3 trading days after a results release. Release dates come from SEC
  8-K filings, whose times are recorded, so this is feasible but unverified.
- **Start of every test.** The simulated account buys at the first open of
  the period, with the same capital as the hold benchmark on the same stock.
  The "attractive opportunity" judgment cannot be replayed historically, so
  the tests measure only whether the **exit and re-entry timing** beats
  holding the same stock.

### 5.3 Exit candidates (defined before any result) [PROPOSED TEST]

| ID | Exit level | Activation | How the level moves | Trigger | Fill |
|---|---|---|---|---|---|
| **H0** Hold | none | — | — | none (valued at the last close of the period) | — |
| **X1c** Recovery-point break, close | the most recent recovery point confirmed after entry, minus 0.5 × ATR(14) at its confirmation | from the first recovery point confirmed after entry; before that only the initial loss rule applies [OPEN Q2/Q3] | only up, never down | daily close below the level | next open |
| **X1i** Recovery-point break, intraday | as X1c | as X1c | as X1c | day's low at or below the level (a resting stop) | stop rule above (gaps fill at the open) |
| **X2** Normal-movement allowance | highest close since entry minus 3 × ATR(14) | from entry | only up | daily close below the level | next open |
| **X3** 10% give-back (comparison only) | entry + 0.9 × (highest close since entry − entry) | once the highest close is at least 3 × ATR(14) above the entry (otherwise it would exit on noise in the first days) | only up | daily close at or below the level | next open |

**The initial loss rule is not set [OPEN Q2/Q3].** Price tests run each
candidate twice:
- with no separate initial rule;
- with a provisional one: a daily close below entry − 2.5 × ATR(14).

Neither is a recommendation.

**Neighbouring settings, fixed now and each changed one at a time:**

| Setting | Proposed | Neighbours |
|---|---|---|
| Recovery-point window | 5 days | 3, 8 |
| Rebound | 1.0 ATR | 0.5, 1.5 |
| X1 buffer | 0.5 ATR | 0.25, 1.0 |
| X2 multiple | 3 | 2.5, 3.5 |
| X3 activation | 3 ATR | 2, 4 |

X3's 10% is your stated idea and is not varied.

### 5.4 Re-entry after an exit (all candidates) [PROPOSED TEST]

After an exit filled at price P on day e:
1. **R1, re-entry signal.** The first recovery point that forms *after* day e
   is confirmed (section 5.2). At that confirmation close, the close must be
   below P.
2. **The buy.** It happens at the next open, only if that open is below P.
   If the open is at or above P, nothing is bought, and it is recorded.
3. **News gate.** Historically it is **assumed** to pass, and flagged as an
   assumption (price-rule test). Prospectively it is a recorded news check.
4. **Missed rebound.** If a daily close at or above P comes before any
   re-entry signal, it is recorded with the rise that followed. The stock
   returns to S1: a new investment case is needed.

   In the price test the simulated account then stays in cash for that stock
   **[OPEN Q6b]**. A variant, R1b, allows a new entry at the next recovery
   point at any price, as a sensitivity only.
5. **The same exit rules then apply to the new position.** The number of
   cycles per stock is unlimited, and every cycle is reported.

### 5.5 What is compared and reported (fixed before results)

- **The comparison.** Complete exit-and-re-entry cycles versus holding the
  same stock over the same dates from the same capital: per stock, and as a
  combined portfolio once a risk budget exists.
- **For each candidate and period:**
  - net return after costs, and the largest decline in account value;
  - average win, average loss and win rate;
  - number of cycles and time in cash;
  - **missed rebounds**: exits followed by a rise above the exit price
    without a re-entry;
  - **unsuccessful re-entries**: a re-entry that was later exited below its
    re-entry price;
  - sensitivity to the neighbouring settings;
  - dependence on the best few cycles;
  - development versus validation;
  - correlated exposure across the AI and technology names.
- **Not success measures on their own:** the share of a gain retained, a
  higher share count, the win rate, or attractive chart examples.

**Proposed decision rule** [PROPOSED TEST; you confirm it before any result]:
a candidate is "worth carrying into a prospective journal" only if all of
these hold:

| Code | Condition |
|---|---|
| E1 | In validation, its return per unit of drawdown (net return ÷ largest decline) beats holding in at least 60% of the stocks **and** for the combined portfolio |
| E2 | Its total net return is not more than 25% below holding (it may trade some return for a smaller decline, but not most of it) |
| E3 | The same conclusion in development and validation |
| E4 | At least 70% of its neighbouring settings agree with the conclusion |
| E5 | The conclusion holds without its best 2 cycles |

Otherwise the outcome is "**no better than holding**", or "**inconclusive**"
if there are fewer than 30 complete cycles. Even the best outcome is not
permission to trade.

## 6. News analysis

**For every news-based decision**, the journal records:
- source links;
- publication time;
- the event date;
- the financial period discussed;
- each item, separated into:
  - **reported fact**;
  - **observed market reaction**, measured from stored prices after the
    publication time;
  - **interpretation** (mine or yours, labelled as such);
  - **remaining uncertainty**.

Where relevant it assesses revenue, margins, guidance, cash flow, financing,
customer demand and spending. It distinguishes **noncash accounting charges**
(for example impairments or stock-based compensation) from **cash losses**.

**"Beat" or "miss"** is claimed only against a cited expectation available
before the release. No supplier or customer relationship is stated without a
source. Each analysis says why the news matters to that company and whether
the price may already reflect it.

**Historical news.** A news-informed backtest needs what was knowable *then*,
including expectations. What is available:

| Source | What it gives | Status |
|---|---|---|
| SEC EDGAR filings (free) | Company facts with filing timestamps (8-K results releases, 10-Q, 10-K) | Usable for "facts known at the time". It gives no market expectations. |
| Finnhub company news (key needed; free tier) | Headlines | History depth on the free plan is unverified; probably far too short |
| Alpaca news (Benzinga headlines, same free account) | Headlines with timestamps, possibly back to 2015 | **Unverified**: availability on the free plan and the licence must be checked before relying on it |
| Historical analyst expectations (consensus) | Needed to judge beat or miss at the time | No free source found. Not available. |

**Consequence:** historical results will be labelled **"price-rule test
only"**. News-informed decisions are evaluated **prospectively**, in a dated
simulated journal written before outcomes are known. The full strategy will
never be described as backtested.

**Current news analysis has not been done yet.** It needs the stocks you
trade (Q6), and the portfolio records are not in this folder.

## 7. Risk and cash

- **Cash is unknown here.** Your last reported available cash is $0, per the
  project notes. I could not verify the latest saved records: this folder has
  no portfolio database. No sale, deposit or proceeds are assumed.
- **Sizing comes last.** Position size is set only after cash and risk limits
  are confirmed. Proceeds are never reinvested automatically. No borrowing or
  margin.
- **Long-term holdings stay separate** unless you reclassify them.
- **Leveraged daily products** (2× or 3× ETFs that reset daily) lose value
  from that daily reset over time. They are assessed separately and excluded
  from HXR 0.1.
- **Stops are not guaranteed prices.** Waiting for confirmation can mean
  larger losses (section 2, terms).

## 8. Evaluation and integration plan (after your answers)

1. **Data readiness first**, before any test, reusing the Lab's checklist
   approach:
   - ticker and exchange identity;
   - listing dates;
   - split and other corporate actions;
   - daily coverage;
   - regular versus extended hours;
   - missing days;
   - timestamps.

   Recently listed stocks start at their listing plus a warm-up; no history
   is invented and no substitute instrument is used without your agreement.
2. **Its own version and periods.** HXR 0.1 gets its own periods
   [PROPOSED TEST]. Alpaca daily history is said to go back to 2016, which
   must be verified.

   | Period | Dates | Use |
   |---|---|---|
   | Warm-up | 2016 | indicators only |
   | Development | 2017–2021 | design and checks |
   | Validation | 2022–2023 | testing the fixed candidates |
   | Final evaluation | 2024-01-01 – 2026-06-30 | untouched until one version is frozen |

   The final period overlaps the dates of cb's holdout. That does not run or
   change cb's holdout, which stays untouched, but it is your choice
   [OPEN Q8]. You have also watched these stocks through 2024–2026, so no
   historical period is truly unseen by you. **Only the prospective journal
   is a clean test.**
3. **Stock list.** A historical test on today's AI winners flatters any
   strategy. The test list should be your stocks plus large US technology
   names already listed in 2016, **including ones that later lagged**,
   declared before any result [OPEN Q6].
4. **Separation from cb.**
   - Code in `server/hxr/` and docs in `strategy/hxr/`, with its own database
     `data/hxr-research.sqlite` and its own holdout ledger.
   - The Alpaca source gains a daily request type; the 15-minute path is
     unchanged.
   - Lab utilities are reused: data quality, calendar, costs, metrics,
     no-look-ahead tests.
   - Every tested variation is logged in `strategy/hxr/PARAMETER-LOG.md`.
5. **Journal.** Append-only decision records, written before outcomes. Each
   records:
   - version and decision time;
   - stage;
   - the information and sources available then;
   - entry, highest verified price since entry, and previous exit;
   - the proposed conditions and risk assumptions;
   - why a setup was accepted or rejected;
   - what would change the assessment;
   - the status: PROPOSED, SIMULATED or USER-REPORTED.

   Outcomes are added later in a separate record and never edit the original.
6. **Dashboard.** A new Strategy Lab section, separate from cb, with:
   - the strategy explanation and unresolved settings;
   - each tracked stock's stage and reasons;
   - possible exits and re-entries;
   - simulated results versus holding;
   - the journal with its sources and data-quality warnings.

   Simulated proceeds are never shown as available cash, and historical
   results are never shown as live returns.
7. **Off.** No scheduler, reminders, notifications or orders. Everything runs
   on request.

## 9. Blocked or unverified now

1. **Your cash, holdings and their dates.** The Signal Desk portfolio
   database is not in this folder (Q9).
2. **Which stocks this strategy covers** (Q6).
3. **Commission and currency-conversion costs** (Q7).
4. **News history.**
   - Alpaca news: free-plan availability and licence unverified.
   - Finnhub: history depth unverified.
   - Historical expectations: unavailable.
5. **Alpaca daily-bar history before 2021.** The depth and the calendar
   before 2021 must be verified.

## 10. Questions for the owner

Each question offers options for the case where you're unsure. None is
inferred from your interest in volatile stocks.

1. **Holding period and monitoring.** How long do you usually expect to hold,
   and how often can you check?
   - (a) Days to a few weeks, checking several times a day. Intraday
     triggers are possible, but you react to noise.
   - (b) Weeks to months, checking once a day after the close. This suits
     daily-close rules.
   - (c) Months or longer, checking weekly. Only wide rules fit, and losses
     in a fast fall are larger.
2. **Loss you can afford, in dollars.** Per trade, and across the whole
   trading account.
   - Option A: a fixed dollar amount per trade, for example the most you'd
     accept losing on one stock.
   - Option B: a % of the trading account per trade, plus a total. The
     account figure must be real, not simulated.

   If unsure: a common starting point is a small per-trade loss and a total
   cap a few times larger. The number must be yours.
3. **A stock that falls right after you buy.** Should this happen before any
   recovery point exists?
   - (a) Exit at a fixed initial loss limit. The loss is predictable, but a
     normal wobble can take you out.
   - (b) Allow normal movement, a multiple of ATR, then exit. This fits the
     stock, but the loss varies by stock.
   - (c) Review the news first, then decide. This is flexible, but it is the
     path to holding a loser too long.
4. **Earnings.** Hold through results?
   - (a) Yes, always. You accept gaps either way.
   - (b) No: sell before, or don't buy within N days before.
   - (c) Hold only if the position is already profitable by an agreed margin.
5. **What would break your case for owning a company?** For example:
   - lowered guidance;
   - falling revenue growth or margins versus its own outlook;
   - a major customer lost;
   - big new share issues;
   - regulation blocking a key market;
   - management departures.

   Which of these, or others, mean "sell and stay out"?
6. **Which stocks.**
   - (a) Which holdings are this trading strategy, and which are long-term
     investments that stay separate?
   - (b) Which stocks should it track?
   - (c) Do you agree to test on a wider list that includes tech names that
     did poorly?
   - (d) After a missed rebound (price back above your sale without a
     re-entry), should the simulation stay in cash, or allow a new entry
     like your behaviour step 1?
7. **Costs.** Your broker's commission per US stock trade, and whether you
   hold USD cash or convert from CAD each time. Converting both ways can cost
   about 1–2% per round trip, which matters for repeated cycles.
8. **Final evaluation period.** Use 2024 to mid-2026 for HXR's final test? It
   shares dates with cb's untouched holdout but does not use or change it.
   The other choice is ending HXR's history at 2024-12-31 and relying on the
   prospective journal.
9. **Where your Signal Desk records live.** This folder has no portfolio
   database. Where do you run Signal Desk with your real holdings, so I can
   verify cash and holdings with their dates (read-only)? Or would you
   re-enter them here?
