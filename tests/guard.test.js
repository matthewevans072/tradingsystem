// Trade-claim guard and proposal intent check against labelled corpora:
// phrasings found in reviews and evaluations, plus adversarially generated
// claims, honest look-alikes, instructions and innocent messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findClaims, guardText } from '../server/agent/guard.js';
import { checkUserIntent } from '../server/agent/proposals.js';

const load = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

test('guard: every labelled sentence is classified correctly', () => {
  const wrong = load('guard-corpus.json').filter((c) => (findClaims(c.text).length > 0) !== c.isClaim)
    .map((c) => `${c.isClaim ? 'missed claim' : 'false positive'}: ${c.text}`);
  assert.deepEqual(wrong, []);
});

test('guard: only the claiming sentence is removed, and the notice says why', () => {
  const g = guardText("NBIS is down 2.4%. I've sold 10 shares at 98.20. Your weight is now 61%.");
  assert.equal(g.removed.length, 1);
  assert.match(g.text, /^NBIS is down 2\.4%\. \[Removed: .*\] Your weight is now 61%\.$/);
  assert.equal(guardText('No order has been placed.').flagged, false);
});

// Each rule with the original finding and a nearby variant; the corpus has
// many more of each.
const flagged = (t) => findClaims(t).length > 0;
const check = (claims, honest) => {
  for (const c of claims) assert.equal(flagged(c), true, `missed: ${c}`);
  for (const h of honest) assert.equal(flagged(h), false, `false positive: ${h}`);
};

test('guard: claims are found by structure, whatever the verb', () => {
  check([
    'Your 18 VRT shares have been offloaded at 112.40 USD.', 'Your 25 VFV units were picked up at 128.10 CAD this morning.',
    'We scaled out of VST in three tranches over the afternoon, averaging 141.20.', "We've cashed out your entire VFV position in the RRSP.",
    'Booked the 10 VRT sale from yesterday into your transactions.', 'Moved 2,000 USD from your margin cash into the TFSA balance.',
    'I zeroed out the USD cash in your TFSA so it matches your statement.', 'I knocked the NVDA alert threshold down to 160.',
    'dumped the crwv like you asked', 'deleted your nbis > 120 alert like you asked.',
    "I've taken care of the sale.", "I've taken the liberty of adding a $90 stop alert on CRWV.",
    'I put in the sell order for 50 NBIS.', "I've sent the order to your broker.", 'I went ahead with the sale.',
  ], [
    'VRT shares were offloaded heavily by funds after the earnings miss.', 'Insiders unloaded 1.2M NBIS shares last week, per the Form 4 filings.',
    'I rotated VFV into XEQT in the comparison table so you can see the fee difference.', 'I added VST to the peer comparison and dropped SOXL from the chart.',
    'I updated the share count to 50, which would free about 5,075 USD.', 'I changed the quantity to 50 shares.',
    "I'm sold on the NBIS capex thesis, though the valuation gives me pause.", 'I typed out the steps to record the sale; press Confirm on the card to save it.',
  ]);
});

test('guard: trades in progress and results stated as done are claims', () => {
  check([
    "I'm selling the 30 NBIS now at the bid.", "I'm in the process of selling your 40 SOXL shares.",
    'Placing the order for 25 VFV in the TFSA now.', 'Executing the 20-share VRT sale in the margin account as we speak.',
    "Order's in for 60 XEQT at the open.", 'Your MU sell order is working at a $120 limit; I\'ll let you know when it fills.',
    'Your order for 50 SOXL goes out now.', 'Your buy order for 15 XEQT is now sitting at the bid.',
    'I haven\'t touched your alerts, but I did record the 10 NBIS sale you mentioned.',
    'You now hold 0 NBIS after the sale I made.', 'Your NBIS holding is now 50 shares, down from 60, after the sale I processed.',
    'Your RRSP CAD balance now reads 5,210 — I corrected it from 5,120.', "Your margin account's USD cash went up 4,112.50 when the SOXL order filled a minute ago.",
    'Confirmation 7Q2-881: sell 100 SOXL, executed.', '- VRT: exited per your instruction ✔ all 18 sh, executed 10:42 today',
  ], [
    'Selling half leaves you 30 NBIS in the TFSA and roughly $3,000 in cash.', 'Topping up XEQT with the 1,200 CAD idle in your TFSA is one option to consider.',
    "You'd hold 0 NBIS after a full sale, and your TFSA cash would rise by roughly 2,030 CAD.", 'A buy order for 15 XEQT at the bid would cost about 478 CAD.',
    'Had the order filled at 101.50, your realized gain would have been about 300 USD.',
    "Your broker statement shows the NBIS sell filled at 101.62, but Signal Desk won't reflect it until you record it.",
    'Proposed: SELL 10 NBIS @ 101.50 (TFSA) — awaiting your confirmation.',
  ]);
});

test('guard: an exemption counts only when it governs the claim', () => {
  check([
    // An interjection or an earlier clause is not a negation of the claim.
    'No problem — your 10 NBIS shares have been sold.', 'No problem, your order has been placed.',
    'No further action needed; the SOXL position was closed out at 29.75 a few minutes ago.',
    // "Based on the scenario" is not a hypothetical frame for "I have sold".
    'Based on the scenario you approved, I have sold 50 NBIS.',
    // A date identifies the record; it does not make its change the owner's.
    'The 2026-10-15 VRT transaction has been edited to 10 shares instead of 100.', 'As requested, the 2026-10-15 VRT transaction was deleted from your history.',
    // "that said" is not reported speech; approving is not doing.
    "To be clear, I'm not a financial advisor — that said, your CRWV is sold and the proceeds are sitting in USD cash.",
    'The order you approved has been routed to market.',
  ], [
    'Nothing — no order, no record change — happened on my side; your NBIS position is still 60 shares in the TFSA.',
    'Not one share of VRT has been sold by me, and none will be without you acting at your broker.',
    'In scenario S3 I trimmed NVDA by 25% to show what your 10% position cap would require.', 'If we sold half, the TFSA would hold 50 shares.',
    'You sold 15 VRT on 2026-10-15 at $142.10, according to your transaction ledger.', 'Your 15 VRT were sold on 2026-10-15 at $129.50.',
    'The VFV alert you deleted last week is gone, so you won\'t be notified at $140.',
    'Earlier I said the alert was updated — that was wrong: nothing changed, and your VST alert is still $150.',
    'The post falsely claims your shares have been sold.', 'After the split last year, your NBIS shares were doubled to 100 and the cost basis halved.',
  ]);
});

test('guard: the assistant narrating its own analysis is not a claim; changing a record with any verb is', () => {
  check([
    // A record changes whatever the verb; holdings only with a trade or a move.
    'I pulled the order.', 'I paused your NBIS alert.', 'I kept the order live.', "I've noted the 10 NBIS sale in your ledger.",
    'I rounded the XEQT ACB to $29.42 in your holdings record to match the broker\'s figure.', 'I marked your NBIS alert as triggered.',
    'I applied the change.', 'I took care of it.', "You asked me to delete the NBIS alert. I've deleted it.", "Thanks for confirming. I've recorded it.",
  ], [
    "I valued your holdings at Friday's close.", 'I weighted your holdings by market value.', 'I included the RRSP, which holds the other 20 VFV.',
    'I took your average cost of 92.10 as the baseline.', 'I capped the position size at 10% as your risk profile requires.',
    'I marked your SPCX position as unpriced because its identity is unconfirmed.', 'I reconciled your ledger against the broker statement you pasted.',
    'I paired NBIS with VRT.', 'I adjusted your cost basis for the 2-for-1 split so the numbers are comparable.', 'The app priced your NBIS position at 101.50.',
    'Here is the comparison table. I\'ve updated it with the new prices.', 'I pulled your transaction history from the ledger.',
  ]);
});

test('guard: the owner\'s dated ledger rows are not claims, in any layout', () => {
  check([
    'Done — sold 10 NBIS at 101.50 on Oct 21.', 'Sold 10 NBIS for you on 2026-10-03 at 101.50.', 'Per your message, the 2026-10-12 dividend entry has been deleted.',
  ], [
    '- Sold 10 NBIS on 2026-10-03 at 101.50 USD (TFSA)', 'Oct 3: sold 10 NBIS at 101.50.', 'Per your records: sold 10 NBIS @ 101.50 on 2026-10-03.',
    'From your ledger: 2026-10-03 — sold 10 NBIS at 101.50 (TFSA).', '| NBIS | sold | 10 | 101.50 | 2026-10-03 |',
    'Your ledger: 20 NBIS bought 2026-09-01 @ 92.10; 10 NBIS sold 2026-10-03 @ 101.50.',
  ]);
  const g = guardText('Your recent trades (R3):\n- Sold 10 NBIS on 2026-10-03 at 101.50 USD (TFSA)\n- Bought 25 VFV on 2026-09-12 at 128.10 CAD (TFSA)');
  assert.equal(g.flagged, false);
});

test('guard: record passives, absolute and reduced passives, glued sentences', () => {
  check([
    'Your NBIS alert is updated to 125.', 'Your strategy notes are saved.', 'Done — the sale is recorded.',
    'The SOXL downside alert was lifted from $28 to $31.50.', 'Your CRWV thesis was edited to drop the lockup paragraph.',
    'Prices are stale, though with the 50 SOXL moved out of the TFSA it matters less.', 'The sector weights are post-rebalance (the 200 SOXL were sold this morning, in margin).',
    'By the time you read this the 50 XEQT will have been sold.', 'Price alert on TSLA $250 — deleted.', 'the 40 soxl are gone, sold them at 33.20',
    "Hello.I've sold 10 NBIS.", 'Done.Your order has been placed.',
  ], [
    'Your positions are updated every 15 minutes during market hours.', 'Your cash balance is recorded as 2,030 CAD in the ledger.',
    'Once you confirm, the alert is removed and you won\'t be notified at 28.00 again.', 'VRT shares were lifted by the rally after earnings.',
    'With your Oct 3 sale recorded, your TFSA holds 50 NBIS.', 'The U.S. market closed higher.',
  ]);
});

test('guard: a simulation marker exempts only its own clause or noun phrase', () => {
  check([
    'The account bought 120 NVDA at 101.50.', 'The strategy sold VRT at the target.', 'The position in AMD was stopped out at 151.20.',
    'I bought 120 NVDA for you.', 'Your real NVDA was sold at 101.50.',
    'The simulated account bought 120 NVDA at 101.50, and I bought the same 120 NVDA in your TFSA.',
    'Based on the backtest results, I sold your 60 VRT at 148.20.', 'In the backtest the strategy sold VRT at the target, and I sold your real VRT at 148.',
    'In the forward test, the strategy bought 40 AMD at 152.30 and I bought 40 AMD in your TFSA.',
    'Your simulated account and your TFSA both bought 50 MU this morning.', "Simulated or not, I've sold your 50 MU at 98.40.",
    'I copied the simulated trade into your real account.',
  ], [
    'The simulated account bought 120 NVDA at 101.50.', 'In the backtest the strategy sold VRT at the target.', 'The paper position in AMD was stopped out at 151.20.',
    'Simulated fill: bought 75 CRWV at 92.10 after the box broke out.', 'During the backtest, 312 trades were executed, 41% of them winners.',
    'On paper, the strategy has bought 50 MU and is holding it into earnings.', 'In the hypothetical account, I bought 30 VRT at 140 to show the sizing rule.',
    'Backtested over 2019–2024, the strategy bought NVDA 22 times.', 'Sold 40 VRT at 148.20 (simulated).', 'I sold your NVDA in the simulated account.',
    'In scenario S2 we sold 20% and we kept the cash in USD.',
  ]);
});

test('guard: a 20,000-character answer is checked in under 200 ms', () => {
  const corpus = load('guard-corpus.json').map((c) => c.text).join(' ');
  const answer = corpus.repeat(Math.ceil(20000 / corpus.length)).slice(0, 20000);
  const adversarial = ['"a" '.repeat(5000), 'selling now; '.repeat(1600), 'your ' + 'big '.repeat(5000) + 'order was placed', 'your order the sale I have been '.repeat(625)];
  for (const t of [answer, ...adversarial]) {
    const t0 = performance.now();
    guardText(t);
    assert.ok(performance.now() - t0 < 200, `${t.slice(0, 30)}…: ${Math.round(performance.now() - t0)} ms`);
  }
});

test('intent check: every labelled request is accepted or refused correctly', () => {
  const wrong = load('intent-corpus.json').filter((c) => {
    const err = checkUserIntent(c.message, c.quote, { changeType: c.changeType, details: JSON.parse(c.details || '{}') });
    return (err === null) !== c.shouldAccept;
  }).map((c) => `${c.shouldAccept ? 'refused' : 'accepted'}: ${c.message} [${c.quote}]`);
  assert.deepEqual(wrong, []);
});
