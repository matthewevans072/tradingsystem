// Proposal builder: trades checked inside the ledger at their date, cards that
// show what is saved for each transaction type, account and currency naming,
// and alert removals bound to the rule the user named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addTransaction, setCash, deriveLedger, computePortfolio } from '../server/portfolio.js';
import { createConversation } from '../server/agent/agent.js';
import { createProposal, confirmProposal } from '../server/agent/proposals.js';
import { makeCtx, seed, snapshot } from './agent-helpers.js';

const NBIS = { account: 'TFSA', symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', fees: 0 };

function setup(extra = []) {
  const ctx = makeCtx();
  seed(ctx); // TFSA: BASELINE 100 NBIS @ 90 on 2026-09-30, BUY 10 VRT @ 120 (+5) on 2026-10-01, USD cash 250
  for (const t of extra) addTransaction(ctx.db, t);
  return { ctx, conv: createConversation(ctx.db) };
}
const propose = (ctx, conv, changeType, msg, details, quote = msg) => createProposal(ctx, { conversationId: conv, changeType, details, userQuote: quote, latestUserMessage: msg });
const nbis = (ctx) => computePortfolio(ctx.db).positions.find((p) => p.symbol === 'NBIS');
const lot = (ctx) => deriveLedger(ctx.db).lots.find((l) => l.account === 'TFSA' && l.instrument_id === nbis(ctx).instrument_id);

test('a backdated sale is valued inside the ledger at its date, and the card matches the result', () => {
  const { ctx, conv } = setup([{ ...NBIS, type: 'BUY', trade_date: '2026-10-15', quantity: 50, price: 95 }]);
  const p = propose(ctx, conv, 'add_transaction', 'Record that I sold 50 NBIS at 98 on 2026-10-05 in TFSA', { type: 'SELL', symbol: 'NBIS', quantity: 50, price: 98, account: 'TFSA', trade_date: '2026-10-05' });
  assert.deepEqual(p.diff.positionBefore, { shares: 150, averageCost: 91.6667 });
  assert.equal(p.diff.positionAfter.shares, 100);
  assert.equal(p.diff.positionAfter.averageCost, 92.5, 'the later buy is averaged with the 50 shares left after the sale');
  assert.equal(p.diff.positionAfter.realizedPLAtAverageCost, 400, 'realized against the 90 average cost on the sale date');
  assert.deepEqual(p.diff.fields.find(([k]) => k === 'Held on 2026-10-05'), ['Held on 2026-10-05', '100 shares before this entry']);
  confirmProposal(ctx, p.id, { conversationId: conv });
  assert.equal(nbis(ctx).shares, 100);
  assert.equal(nbis(ctx).avgCost, 92.5);
  assert.equal(Math.round(lot(ctx).realized * 100) / 100, 400);
  assert.deepEqual(deriveLedger(ctx.db).issues, []);
});

test('a backdated buy is averaged at its date and later trades are replayed after it', () => {
  const { ctx, conv } = setup([
    { ...NBIS, type: 'SELL', trade_date: '2026-10-10', quantity: 100, price: 99 },
    { ...NBIS, type: 'BUY', trade_date: '2026-10-12', quantity: 10, price: 100 },
  ]);
  const p = propose(ctx, conv, 'add_transaction', 'Record that I bought 10 NBIS at 80 on 2026-10-02 in TFSA', { type: 'BUY', symbol: 'NBIS', quantity: 10, price: 80, account: 'TFSA', trade_date: '2026-10-02' });
  assert.deepEqual(p.diff.positionBefore, { shares: 10, averageCost: 100 });
  assert.deepEqual(p.diff.positionAfter, { shares: 20, averageCost: 94.5455, totalCost: 800 });
  confirmProposal(ctx, p.id, { conversationId: conv });
  assert.equal(nbis(ctx).avgCost, 94.5455);
});

test('a sale is refused when the shares were not held on its date or it breaks a later sale', () => {
  const { ctx, conv } = setup([{ ...NBIS, type: 'BUY', trade_date: '2026-10-15', quantity: 50, price: 95 }]);
  const before = snapshot(ctx.db);
  // 150 shares today, but only 100 on 2026-10-05.
  assert.throws(() => propose(ctx, conv, 'add_transaction', 'Record that I sold 120 NBIS at 98 on 2026-10-05 in TFSA', { type: 'SELL', symbol: 'NBIS', quantity: 120, price: 98, account: 'TFSA', trade_date: '2026-10-05' }),
    /TFSA held 100 NBIS on 2026-10-05, fewer than 120/);
  // Before the baseline snapshot nothing was held.
  assert.throws(() => propose(ctx, conv, 'add_transaction', 'Record that I sold 20 NBIS at 98 on 2026-09-15 in TFSA', { type: 'SELL', symbol: 'NBIS', quantity: 20, price: 98, account: 'TFSA', trade_date: '2026-09-15' }),
    /held 0 NBIS on 2026-09-15/);
  // An earlier sale that leaves too few shares for a sale already recorded later.
  addTransaction(ctx.db, { ...NBIS, type: 'SELL', trade_date: '2026-10-16', quantity: 140, price: 99 });
  assert.throws(() => propose(ctx, conv, 'add_transaction', 'Record that I sold 20 NBIS at 98 on 2026-10-05 in TFSA', { type: 'SELL', symbol: 'NBIS', quantity: 20, price: 98, account: 'TFSA', trade_date: '2026-10-05' }),
    /later entry in the ledger invalid \(Sell of 140 on 2026-10-16/);
  const after = snapshot(ctx.db);
  delete before.transactions; delete after.transactions; // the extra SELL above
  assert.deepEqual(after, before, 'the preview row never persists');
});

test('the ledger preview leaves no trace, also for a new security and inside confirmation', () => {
  const { ctx, conv } = setup();
  const before = snapshot(ctx.db);
  const p = propose(ctx, conv, 'add_transaction', 'Record that I bought 5 MU at 98.20 on 2026-10-20 in TFSA', { type: 'BUY', symbol: 'MU', exchange: 'NASDAQ', currency: 'USD', quantity: 5, price: 98.2, account: 'TFSA', trade_date: '2026-10-20' });
  assert.equal(p.diff.positionBefore, null);
  assert.deepEqual(p.diff.positionAfter, { shares: 5, averageCost: 98.2, totalCost: 491 });
  assert.deepEqual(snapshot(ctx.db), before, 'no instrument or transaction is left behind');
  confirmProposal(ctx, p.id, { conversationId: conv });
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM transactions WHERE source = 'preview'").get().n, 0);
  assert.equal(computePortfolio(ctx.db).positions.find((x) => x.symbol === 'MU').shares, 5);
});

test('confirmation refuses a backdated trade when the position on its date or today changed', () => {
  const { ctx, conv } = setup();
  const details = { type: 'SELL', symbol: 'NBIS', quantity: 50, price: 98, account: 'TFSA', trade_date: '2026-10-05' };
  const msg = 'Record that I sold 50 NBIS at 98 on 2026-10-05 in TFSA';
  const p1 = propose(ctx, conv, 'add_transaction', msg, details);
  // An earlier buy changes the average cost the sale is realized against.
  addTransaction(ctx.db, { ...NBIS, type: 'BUY', trade_date: '2026-10-03', quantity: 10, price: 80 });
  assert.throws(() => confirmProposal(ctx, p1.id, { conversationId: conv }), /records changed/);
  const conv2 = createConversation(ctx.db);
  const p2 = propose(ctx, conv2, 'add_transaction', msg, details);
  // A later trade changes only today's position.
  addTransaction(ctx.db, { ...NBIS, type: 'BUY', trade_date: '2026-10-20', quantity: 1, price: 100 });
  const before = snapshot(ctx.db);
  assert.throws(() => confirmProposal(ctx, p2.id, { conversationId: conv2 }), /records changed/);
  assert.deepEqual(snapshot(ctx.db), before, 'nothing saved');
  const p3 = propose(ctx, conv2, 'add_transaction', msg, details);
  confirmProposal(ctx, p3.id, { conversationId: conv2 });
  assert.equal(nbis(ctx).shares, 61);
});

test('cash entries show the amount and currency, not shares, price or a position', () => {
  const { ctx, conv } = setup();
  const p = propose(ctx, conv, 'add_transaction', 'Record a 25 USD dividend from NBIS in TFSA', { type: 'DIVIDEND', symbol: 'NBIS', currency: 'USD', amount: 25, account: 'TFSA', trade_date: '2026-10-20' });
  const f = Object.fromEntries(p.diff.fields);
  assert.equal(p.diff.summary, 'Add DIVIDEND 25 USD on 2026-10-20 in TFSA');
  assert.equal(f.Amount, 25);
  assert.equal(f.Currency, 'USD');
  assert.match(f.Security, /^NBIS: not stored/);
  assert.ok(!('Shares' in f) && !('Price' in f) && !('Fees' in f));
  assert.ok(!('positionBefore' in p.diff) && !('positionAfter' in p.diff), 'the card shows no position rows');
  confirmProposal(ctx, p.id, { conversationId: conv });
  assert.deepEqual({ ...ctx.db.prepare('SELECT type, instrument_id, quantity, price, amount FROM transactions ORDER BY id DESC LIMIT 1').get() },
    { type: 'DIVIDEND', instrument_id: null, quantity: null, price: null, amount: 25 });
  // A fee without a security, with its own fee: no Security row, Fees shown.
  const fee = propose(ctx, conv, 'add_transaction', 'Record a 9.99 USD account fee in TFSA, plus 1.50 fees', { type: 'FEE', currency: 'USD', amount: 9.99, fees: 1.5, account: 'TFSA', trade_date: '2026-10-20' });
  const ff = Object.fromEntries(fee.diff.fields);
  assert.ok(!('Security' in ff));
  assert.equal(ff.Fees, 1.5);
  // The same dividend again is flagged as a duplicate (cash rows are stored without the symbol).
  assert.match(propose(ctx, conv, 'add_transaction', 'Record a 25 USD dividend from NBIS in TFSA', { type: 'DIVIDEND', symbol: 'NBIS', currency: 'USD', amount: 25, account: 'TFSA', trade_date: '2026-10-20' }).diff.duplicateWarning, /already exists/);
});

test('an account holding USD and CAD needs the currency named, however the account is spelled', () => {
  const { ctx, conv } = setup();
  setCash(ctx.db, { account: 'TFSA', currency: 'CAD', amount: 1000, asOf: '2026-10-20', confirmed: true });
  for (const account of ['TFSA', 'tfsa', ' Tfsa ', undefined]) {
    assert.throws(() => propose(ctx, conv, 'set_cash', 'Please set my TFSA cash to 500.', { currency: 'USD', amount: 500, account }, 'set my TFSA cash to 500'), /did not say which currency/, String(account));
  }
  assert.ok(propose(ctx, conv, 'set_cash', 'Please set my tfsa USD cash to 500.', { currency: 'USD', amount: 500, account: 'tfsa' }, 'set my tfsa USD cash to 500').id);
  // The same rule for cash movements.
  assert.throws(() => propose(ctx, conv, 'add_transaction', 'Record a deposit of 500 into my TFSA', { type: 'DEPOSIT', amount: 500, currency: 'USD', account: 'tfsa', trade_date: '2026-10-20' }), /did not say which currency/);
  assert.throws(() => propose(ctx, conv, 'add_transaction', 'Record a deposit of 500 CAD into my TFSA', { type: 'DEPOSIT', amount: 500, currency: 'USD', account: 'TFSA', trade_date: '2026-10-20' }), /said CAD, not USD/);
  assert.ok(propose(ctx, conv, 'add_transaction', 'Record a deposit of 500 CAD into my TFSA', { type: 'DEPOSIT', amount: 500, currency: 'CAD', account: 'TFSA', trade_date: '2026-10-20' }).id);
});

test('the named account is the longest name in the request, and names with punctuation or curly apostrophes match', () => {
  const { ctx, conv } = setup();
  const open = (account) => addTransaction(ctx.db, { ...NBIS, account, type: 'BUY', trade_date: '2026-10-01', quantity: 1, price: 90 });
  ['RRSP', 'Spousal RRSP', 'Joint (Cash)', 'TFSA (Wealthsimple)', 'Mike’s RRSP'].forEach(open);
  const cash = (msg, account, quote = msg) => propose(ctx, conv, 'set_cash', msg, { currency: 'USD', amount: 700, account }, quote);
  assert.throws(() => cash('Set my Spousal RRSP USD cash to 700', 'RRSP'), /named Spousal RRSP, not RRSP/);
  assert.match(cash('Set my Spousal RRSP USD cash to 700', 'Spousal RRSP').diff.summary, /^Set Spousal RRSP /);
  assert.match(cash('Move 700 from my RRSP to my Spousal RRSP, then set the RRSP USD cash to 700', 'RRSP', 'set the RRSP USD cash to 700').diff.summary, /^Set RRSP /);
  // An account mentioned in another sentence is not the one named in the request.
  assert.throws(() => cash('I moved money out of my TFSA. Please set the RRSP USD cash to 700.', 'TFSA', 'set the RRSP USD cash to 700'), /named RRSP, not TFSA/);
  assert.throws(() => cash('I moved money out of my TFSA. Please set the USD cash to 700.', 'TFSA', 'set the USD cash to 700'), /did not say which one/);
  assert.match(cash('Set USD cash in Joint (Cash) to 700', 'Joint (Cash)').diff.summary, /^Set Joint \(Cash\) /);
  assert.match(cash('Set my USD cash to 700 in TFSA (Wealthsimple)', 'TFSA (Wealthsimple)').diff.summary, /^Set TFSA \(Wealthsimple\) /);
  assert.throws(() => cash('Set my USD cash to 700 in TFSA (Wealthsimple)', 'TFSA'), /named TFSA \(Wealthsimple\), not TFSA/);
  assert.match(cash("Set USD cash in Mike's RRSP to 700", "Mike's RRSP").diff.summary, /^Set Mike’s RRSP /);
  assert.match(cash('Set USD cash in Mike’s RRSP to 700', 'Mike’s RRSP').diff.summary, /^Set Mike’s RRSP /);
});

test('an alert removal must name the stored rule; questions and other instructions cannot remove or change alerts', () => {
  const { ctx, conv } = setup();
  const vrt = ctx.db.prepare("SELECT id FROM instruments WHERE symbol = 'VRT'").get().id;
  const rule = Number(ctx.db.prepare("INSERT INTO alert_rules (type, instrument_id, params_json, enabled, created_at) VALUES ('price_below', ?, '{\"price\":100}', 1, '2026-10-01T00:00:00Z')").run(vrt).lastInsertRowid);
  const remove = (msg, quote = msg) => propose(ctx, conv, 'remove_price_alert', msg, { rule_id: rule }, quote);
  assert.match(remove('Remove my VRT alert at 100.', 'Remove my VRT alert at 100').diff.summary, /Remove alert #\d+ \(VRT below 100\)/);
  assert.ok(remove('Please delete the VRT alert, it is stale.', 'delete the VRT alert').id);
  assert.throws(() => remove('Remove my NBIS alert at 120.', 'Remove my NBIS alert at 120'), /not the one the user named/);
  assert.throws(() => remove('Remove my VRT alert at 120.', 'Remove my VRT alert at 120'), /not the one the user named/);
  assert.throws(() => remove('Add an alert if NBIS drops below 90.', 'Add an alert if NBIS drops below 90'), /not an instruction/);
  assert.throws(() => remove('Please explain why the alert for VRT at 100 was set.', 'Please explain why the alert for VRT at 100 was set'), /question/);
  const threshold = (msg, value, key = 'pct_move') => propose(ctx, conv, 'update_alert_threshold', msg, { key, value });
  assert.throws(() => threshold('Can you explain why my NBIS alert set at 90 never fired?', 90), /question/);
  assert.throws(() => threshold('Bump the daily move alert threshold from 5% to 7%', 5), /not the new value/);
  assert.match(threshold('Bump the daily move alert threshold from 5% to 7%', 7).diff.summary, /pct_move from 5 to 7/);
  assert.throws(() => propose(ctx, conv, 'set_cash', 'Can you explain why my TFSA USD cash balance shows 0 after the update?', { account: 'TFSA', currency: 'USD', amount: 0 }), /question/);
});

test('type, currency, thesis and orders are checked against the message', () => {
  const { ctx, conv } = setup();
  assert.throws(() => propose(ctx, conv, 'add_transaction', 'Record that I sold 25 NBIS at 98.', { type: 'BUY', symbol: 'NBIS', quantity: 25, price: 98 }), /type BUY does not match/);
  assert.throws(() => propose(ctx, conv, 'add_transaction', 'Go ahead and sell my 30 VRT at 130 and record it.', { type: 'SELL', symbol: 'VRT', quantity: 30, price: 130 }, 'sell my 30 VRT at 130 and record it'), /order to place a trade/);
  assert.throws(() => propose(ctx, conv, 'add_transaction', 'Simulate: I sold 50 NBIS at 101.5', { type: 'SELL', symbol: 'NBIS', quantity: 50, price: 101.5 }, 'I sold 50 NBIS at 101.5'), /hypothetical/);
  assert.throws(() => propose(ctx, conv, 'set_strategy', 'Set VRT strategy to long_term.', { symbol: 'VRT', strategy: 'long_term', thesis: 'AI data center cooling demand' }), /thesis is not in the user's own words/);
  const s = propose(ctx, conv, 'set_strategy', 'Set VRT strategy to long_term with thesis: AI data-center cooling demand.', { symbol: 'VRT', strategy: 'long_term', thesis: 'AI data center cooling demand' }, 'Set VRT strategy to long_term');
  assert.match(s.diff.summary, /replace the thesis/);
});
