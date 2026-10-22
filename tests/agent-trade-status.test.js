// Trade statements in Ask Signal Desk answers depend on structured records
// (server/agent/ledger.js TRADE_STATUS): PROPOSED (a chat proposal), SIMULATED
// (scenarios and the Strategy Lab), USER-REPORTED (transactions in the owner's
// records) and BROKER-CONFIRMED (reserved: there is no broker connection).
// Checked: each tool attaches the right status to its records, details get
// their statuses from the records they cite (never from the model), a trade
// statement without a matching record is removed, "proposed" needs a proposal,
// broker-confirmed wording is removed, and the owner saying "I sold 10 VRT"
// gives no USER-REPORTED record until they confirm a proposal.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { NOW, makeCtx, seed, scripted, use, lastResults, answer, snapshot } from './agent-helpers.js';
import { addTransaction } from '../server/portfolio.js';
import { loadConfig } from '../server/config.js';
import { createLab } from '../server/strategy/lab.js';
import { createConversation, runChatTurn, getConversation, deleteConversation, validateAnswer, tradeClaims, TRADE_REMOVED, BROKER_REMOVED } from '../server/agent/agent.js';
import { createProposal, confirmProposal, rejectProposal } from '../server/agent/proposals.js';
import { Ledger, TRADE_STATUS } from '../server/agent/ledger.js';
import { NO_HOST_KEYS } from './no-host-keys.js';

const ALL_STATUSES = ['PROPOSED', 'SIMULATED', 'USER-REPORTED', 'BROKER-CONFIRMED'];
const notice = `[${TRADE_REMOVED}]`;

// One turn of the scripted model; returns the saved message and every tool result.
async function turn(ctx, conv, userText, steps) {
  const results = [];
  const script = steps.map((step) => (m) => {
    if (m.at(-1)?.role === 'user' && Array.isArray(m.at(-1).content)) results.push(...lastResults(m));
    return step(m, results);
  });
  const msg = await runChatTurn(ctx, { conversationId: conv, userText, now: NOW, backend: scripted(script) });
  return { msg, results };
}
const item = (msg, ref) => msg.ledger.find((i) => i.ref === ref);
const vrtBuy = (ctx) => ctx.db.prepare("SELECT t.id FROM transactions t JOIN instruments i ON i.id = t.instrument_id WHERE i.symbol = 'VRT' AND t.type = 'BUY'").get().id;

// A ledger like a turn's: a position record (no trade status), the owner's VRT
// purchase (USER-REPORTED), and optionally a proposal and a scenario.
function ledgerWith({ proposal = false, scenario = false, sell = false } = {}) {
  const L = new Ledger();
  const r = {
    position: L.add({ key: 'pos', kind: 'portfolio_record', label: 'VRT position record', symbol: 'VRT' }),
    status: L.add({ key: 'st', kind: 'status', label: 'No VRT sale recorded' }),
    buy: L.add({ key: 'tx1', kind: 'portfolio_record', label: 'Your record: BUY 10 VRT at 120 USD on 2026-10-01', symbol: 'VRT', tradeStatus: TRADE_STATUS.USER_REPORTED, recordId: 'transaction:2', origin: 'manual', side: 'BUY' }),
  };
  if (sell) r.sell = L.add({ key: 'tx2', kind: 'portfolio_record', label: 'Your record: SELL 10 VRT at 129.5 USD', symbol: 'VRT', tradeStatus: TRADE_STATUS.USER_REPORTED, recordId: 'transaction:3', origin: 'chat_proposal', side: 'SELL' });
  if (proposal) r.proposal = L.add({ key: 'p1', kind: 'portfolio_record', label: 'Proposed change #1: Add SELL 2 VRT', symbol: 'VRT', tradeStatus: TRADE_STATUS.PROPOSED, recordId: 'proposal:1', subState: 'pending', side: 'SELL' });
  if (scenario) r.scenario = L.add({ key: 's1', kind: 'calculation', label: 'Hypothetical sell 20 NBIS (S1)', symbol: 'NBIS', tradeStatus: TRADE_STATUS.SIMULATED, recordId: 'scenario:S1', subState: 'scenario', side: 'SELL' });
  return { L, r };
}
const check = (raw, L) => validateAnswer({ short_answer: 'x', ...raw }, L, { toolsRun: 1, held: ['VRT', 'NBIS'], names: (s) => (s === 'VRT' ? ['Vertiv'] : []) });

// ---------------------------------------------------------------------------

test('the four statuses: three issued by tools, BROKER-CONFIRMED reserved and refused', () => {
  assert.deepEqual(Object.values(TRADE_STATUS), ALL_STATUSES);
  const L = new Ledger();
  assert.throws(() => L.add({ key: 'b', kind: 'portfolio_record', label: 'x', tradeStatus: 'BROKER-CONFIRMED' }), /reserved: Signal Desk has no broker connection/);
  assert.throws(() => L.add({ key: 'c', kind: 'portfolio_record', label: 'x', tradeStatus: 'CONFIRMED' }), /Unknown trade status/);
  assert.equal(L.items.length, 0, 'a refused status registers nothing');
  // Strategy Lab items are SIMULATED by kind unless they opt out (a config file, market data).
  const sim = L.add({ key: 'lab:t', kind: 'simulation', label: 'Simulated trade' });
  const cfg = L.add({ key: 'lab:c', kind: 'simulation', label: 'Strategy version 1.0.0', tradeStatus: null });
  const pos = L.add({ key: 'pos', kind: 'portfolio_record', label: 'VRT position' });
  assert.equal(L.get(sim).tradeStatus, 'SIMULATED');
  assert.equal(L.get(cfg).tradeStatus, undefined);
  assert.equal(L.get(pos).tradeStatus, undefined, 'a holding is not a trade record');
  assert.deepEqual(L.tradeStatuses([pos, sim, cfg]), ['SIMULATED']);
});

test('every trade record carries its status: transactions USER-REPORTED with origin, proposals PROPOSED, scenarios SIMULATED', async () => {
  const ctx = makeCtx();
  seed(ctx);
  // A CSV import and a transaction saved from a confirmed chat proposal.
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-02', account: 'TFSA', symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', quantity: 5, price: 95, fees: 0 }, { source: 'csv', manualUnique: false });
  const earlier = createConversation(ctx.db);
  const ask = 'Record that I bought 3 NBIS at 99 on 2026-10-19 in TFSA.';
  const p0 = createProposal(ctx, { conversationId: earlier, changeType: 'add_transaction', details: { type: 'BUY', symbol: 'NBIS', quantity: 3, price: 99, fees: 0, account: 'TFSA', trade_date: '2026-10-19' }, userQuote: 'Record that I bought 3 NBIS at 99 on 2026-10-19 in TFSA', latestUserMessage: ask });
  assert.equal(p0.tradeStatus, 'PROPOSED');
  const confirmed = confirmProposal(ctx, p0.id);
  assert.equal(confirmed.tradeStatus, 'PROPOSED');
  assert.equal(confirmed.status, 'confirmed', 'the sub-state is the proposal status');
  const chatTx = Number(confirmed.savedRecord.recordId.split(':')[1]);
  assert.deepEqual(confirmed.savedRecord, { tradeStatus: 'USER-REPORTED', recordId: `transaction:${chatTx}`, origin: 'chat_proposal' });

  const conv = createConversation(ctx.db);
  const sell = { change_type: 'add_transaction', details: { type: 'SELL', symbol: 'VRT', quantity: 2, price: 125, fees: 0, account: 'TFSA', trade_date: '2026-10-20' }, user_request_quote: 'record that I sold 2 VRT at 125 on 2026-10-20 in TFSA' };
  const { msg, results } = await turn(ctx, conv, 'Please record that I sold 2 VRT at 125 on 2026-10-20 in TFSA.', [
    () => [use('get_transactions', { symbol: null, since: null, limit: null }), use('get_position', { symbol: 'NBIS' }), use('what_changed', { symbol: null, since: 'yesterday' }),
      use('simulate_trade', { symbol: 'NBIS', side: 'sell', shares: 20, fraction: null, cash_amount: null, target_weight_pct: null, price: null, fees: null, account: null }),
      use('simulate_trades', { legs: [{ side: 'sell', symbol: 'NBIS', shares: 10 }, { side: 'buy', symbol: 'VRT', shares: 2, price: 130, fees: 0 }] }), use('propose_record_change', sell)],
    (m, res) => {
      const [txs, , , s1, s2, prop] = res;
      const buyRow = txs.transactions.find((t) => t.symbol === 'VRT' && t.type === 'BUY');
      return answer({
        short_answer: 'Recording your sale of 2 VRT at 125 is proposed and not saved until you press Confirm.',
        details: [
          { category: 'portfolio_record', text: 'You bought 10 VRT at 120 on 2026-10-01.', refs: [buyRow.ref] },
          { category: 'portfolio_record', text: 'Proposed: SELL 2 VRT at 125 on 2026-10-20 in TFSA, not saved until you confirm.', refs: [prop.ref] },
          { category: 'calculation', text: `A hypothetical sale of 20 NBIS frees about ${s1.proceedsBeforeFees} USD before fees.`, refs: [s1.ref] },
          { category: 'calculation', text: 'The two-step plan is hypothetical.', refs: [s2.ref] },
          { category: 'portfolio_record', text: 'You hold 10 VRT.', refs: [txs.ref] },
        ],
      });
    },
  ]);
  const [txs, pos, wc, s1, s2, prop] = results;

  // get_transactions: one USER-REPORTED record per transaction, with its origin.
  assert.equal(txs.transactions.length, 4);
  for (const t of txs.transactions) {
    assert.equal(t.tradeStatus, 'USER-REPORTED');
    const i = item(msg, t.ref);
    assert.equal(i.tradeStatus, 'USER-REPORTED');
    assert.equal(i.recordId, `transaction:${t.id}`);
    assert.equal(i.side, t.type);
    assert.equal(i.origin, t.origin);
    assert.match(i.note, /not confirmed by a broker/);
  }
  const origin = (pred) => txs.transactions.find(pred).origin;
  assert.equal(origin((t) => t.symbol === 'VRT'), 'manual');
  assert.equal(origin((t) => t.symbol === 'NBIS' && t.quantity === 5), 'csv');
  assert.equal(origin((t) => t.id === chatTx), 'chat_proposal');
  assert.equal(txs.transactions.find((t) => t.id === chatTx).confirmedProposalId, p0.id);
  assert.equal(item(msg, txs.ref).tradeStatus, undefined, 'the list itself is not a trade record');
  // get_position and what_changed list the same records.
  assert.ok(pos.transactions.length >= 3 && pos.transactions.every((t) => t.tradeStatus === 'USER-REPORTED' && item(msg, t.ref).symbol === 'NBIS'));
  assert.equal(pos.transactions.find((t) => t.id === chatTx).ref, txs.transactions.find((t) => t.id === chatTx).ref, 'one record, one ref');
  assert.ok([...wc.tradesDatedSince, ...wc.recordsEnteredSince].every((t) => t.tradeStatus === 'USER-REPORTED' && item(msg, t.ref).recordId === `transaction:${t.id}`));
  // Scenarios are SIMULATED; a multi-leg one covers its legs' tickers.
  assert.equal(s1.tradeStatus, 'SIMULATED');
  assert.deepEqual([item(msg, s1.ref).tradeStatus, item(msg, s1.ref).recordId, item(msg, s1.ref).subState, item(msg, s1.ref).side], ['SIMULATED', 'scenario:S1', 'scenario', 'SELL']);
  assert.deepEqual(item(msg, s2.ref).symbols, ['NBIS', 'VRT']);
  // The proposal is PROPOSED, pending.
  assert.deepEqual([prop.tradeStatus, prop.subState], ['PROPOSED', 'pending']);
  assert.deepEqual([item(msg, prop.ref).tradeStatus, item(msg, prop.ref).recordId, item(msg, prop.ref).subState, item(msg, prop.ref).symbol, item(msg, prop.ref).side], ['PROPOSED', `proposal:${prop.proposalId}`, 'pending', 'VRT', 'SELL']);
  // Nothing anywhere is broker-confirmed.
  assert.ok(!JSON.stringify(msg).includes('BROKER-CONFIRMED'));

  // Details carry the statuses of the records they cite.
  assert.equal(msg.status, 'ok', JSON.stringify(msg.answer.issues));
  assert.deepEqual(msg.answer.details.filter((d) => !d.auto).map((d) => d.tradeStatuses), [['USER-REPORTED'], ['PROPOSED'], ['SIMULATED'], ['SIMULATED'], []]);
  assert.ok(msg.answer.details.filter((d) => d.auto).every((d) => Array.isArray(d.tradeStatuses) && !d.tradeStatuses.length), 'notes Signal Desk adds carry their (empty) statuses too');
  assert.equal(msg.answer.short_answer, 'Recording your sale of 2 VRT at 125 is proposed and not saved until you press Confirm.');
  assert.equal(msg.answer.tradeStatementRemoved, false);
  assert.equal(getConversation(ctx.db, conv).proposals[0].tradeStatus, 'PROPOSED');

  // A model cannot set a detail's statuses itself.
  const { L, r } = ledgerWith();
  const v = check({ details: [{ category: 'portfolio_record', text: 'You hold 10 VRT.', refs: [r.position], tradeStatuses: ['BROKER-CONFIRMED'] }] }, L);
  assert.deepEqual(v.answer.details[0].tradeStatuses, []);

  // The origin survives deleting the conversation that confirmed it (the audit entry keeps the note).
  deleteConversation(ctx.db, earlier);
  const again = await turn(ctx, createConversation(ctx.db), 'Show my NBIS trades', [
    () => [use('get_transactions', { symbol: 'NBIS', since: null, limit: null })],
    () => answer({ short_answer: 'x' }),
  ]);
  assert.equal(again.results[0].transactions.find((t) => t.id === chatTx).origin, 'chat_proposal');
});

test('a statement about a trade without a record backing it is removed', () => {
  const { L, r } = ledgerWith();
  // (b) a detail describing a specific trade must cite a trade record.
  let v = check({ details: [
    { category: 'portfolio_record', text: 'You bought 10 VRT at 120 on 2026-10-01.', refs: [r.position] },
    { category: 'portfolio_record', text: 'You bought 10 VRT at 120 on 2026-10-01.', refs: [r.buy] },
    { category: 'portfolio_record', text: 'The sale of 10 VRT on 2026-10-20 realized 95 USD.', refs: [r.position] },
    { category: 'interpretation', text: 'Bought 10 VRT at 120 on Oct 1.', refs: [] },
  ] }, L);
  assert.deepEqual(v.answer.details.map((d) => d.text), [TRADE_REMOVED, 'You bought 10 VRT at 120 on 2026-10-01.', TRADE_REMOVED, TRADE_REMOVED]);
  assert.deepEqual(v.answer.details.map((d) => d.category), ['data_gap', 'portfolio_record', 'data_gap', 'data_gap']);
  assert.equal(v.answer.details[0].tradeStatementRemoved, 'record');
  assert.deepEqual(v.answer.details[1].tradeStatuses, ['USER-REPORTED']);
  assert.ok(v.issues.includes(TRADE_REMOVED));
  assert.equal(v.answer.tradeStatementRemoved, true);
  assert.deepEqual(v.unbacked.map((u) => u.reason), ['record', 'record', 'record']);
  // (c) "you sold" needs a USER-REPORTED record of that ticker and side.
  v = check({ details: [
    { category: 'portfolio_record', text: 'You sold 10 VRT at 129.50 on 2026-10-20.', refs: [r.buy] },
    { category: 'portfolio_record', text: 'You bought 10 NBIS at 90.', refs: [r.buy] },
    { category: 'portfolio_record', text: 'You bought 10 shares of Vertiv on Oct 1.', refs: [r.buy] },
  ] }, L);
  assert.deepEqual(v.answer.details.map((d) => d.text), [TRADE_REMOVED, TRADE_REMOVED, 'You bought 10 shares of Vertiv on Oct 1.'], 'a BUY record does not back a sale; a VRT record does not back NBIS; company names count');
  // The short answer is checked against every trade record of the turn.
  v = check({ short_answer: 'You sold 10 VRT at 129.50 today. You bought 10 VRT on Oct 1.' }, L);
  assert.equal(v.answer.short_answer, `${notice} You bought 10 VRT on Oct 1.`);
  assert.deepEqual(v.unbacked, [{ text: 'You sold 10 VRT at 129.50 today.', reason: 'record' }]);
  assert.equal(check({ short_answer: 'You sold 10 VRT at 129.50 today.' }, ledgerWith({ sell: true }).L).answer.short_answer, 'You sold 10 VRT at 129.50 today.');

  // Not statements about a specific trade, so not checked.
  const keep = [
    'Insiders sold 10,000 shares of NBIS last week, per a Form 4.', 'VRT sold off 5% today.', 'Vertiv bought back 2M shares.',
    "Vertiv's order backlog rose 20%.", 'Analysts rate VRT a buy.', 'Nebius agreed a purchase of 100 MW of capacity.',
    'You hold 100 NBIS at an average cost of 90.', 'VRT is trading at 130.', 'No order has been placed.', 'You never sold any VRT.',
    'There is no record of a VRT sale in your records.', 'If you sold 10 VRT, you would raise about 1,300 USD.',
    'A sale of 10 VRT would cut its weight to about 20%.', 'You have 12 transactions recorded this year.',
    'The sale of 10,000 NBIS by a director was reported in a Form 4.',
    // Quoted examples, someone else's words, bare market passives, market-wide orders, advice, things that did not happen.
    "Say 'record that I sold 10 VRT at 129.50' and I will propose it.", 'The post claims your VRT was sold, which is false.',
    'CRWV was dumped across the sector on Tuesday.', 'Sell orders for VRT spiked at 09:31 after the downgrade.', "Vertiv's Q3 orders grew 17% year over year.",
    "Trade tickets aren't something I can submit; you'd enter BUY 12 NVDA LMT 180 at your broker.", "The VRT trade you asked about hasn't happened; nothing was sold.",
  ];
  for (const t of keep) {
    assert.equal(tradeClaims(t, { isTicker: (w) => /^[A-Z]{2,5}$/.test(w) && w !== 'MW', symbolsNamed: () => [] })?.needsRecord ?? false, false, t);
    v = check({ short_answer: t, details: [{ category: 'reported_claim', text: t, refs: [r.status] }] }, L);
    assert.equal(v.answer.short_answer, t, t);
    assert.equal(v.answer.details[0].text, t, t);
    assert.equal(v.answer.tradeStatementRemoved, false, t);
  }
});

test('"proposed" without a proposal is removed; with one it stays, for the same ticker and side', async () => {
  const say = 'Your sale of 2 VRT at 125 is proposed and awaits your confirmation.';
  assert.equal(check({ short_answer: say }, ledgerWith().L).answer.short_answer, notice, 'no proposal this turn');
  const { L, r } = ledgerWith({ proposal: true });
  assert.equal(check({ short_answer: say }, L).answer.short_answer, say);
  let v = check({ details: [
    { category: 'portfolio_record', text: say, refs: [r.proposal] },
    { category: 'portfolio_record', text: say, refs: [r.buy] },
    { category: 'portfolio_record', text: 'The proposed purchase of 2 VRT is pending your confirmation.', refs: [r.proposal] },
    { category: 'portfolio_record', text: 'The proposed sale of 5 NBIS is pending your confirmation.', refs: [r.proposal] },
  ] }, L);
  assert.deepEqual(v.answer.details.map((d) => d.text), [say, TRADE_REMOVED, TRADE_REMOVED, TRADE_REMOVED], 'a recorded trade, a purchase or another ticker does not back a proposed VRT sale');
  assert.deepEqual(v.answer.details[0].tradeStatuses, ['PROPOSED']);
  // An offer or a negation states no proposal.
  for (const t of ['I can prepare a proposal to record the sale of 2 VRT you mentioned, if you want.', 'No proposal was created for the 2 VRT sale.']) {
    assert.equal(check({ short_answer: t }, ledgerWith().L).answer.short_answer, t, t);
  }

  // Through the loop: the proposal made this turn backs the answer; a proposal the
  // owner rejects stays PROPOSED (sub-state rejected), and nothing is saved.
  const ctx = makeCtx();
  seed(ctx);
  const before = snapshot(ctx.db);
  const conv = createConversation(ctx.db);
  const { msg, results } = await turn(ctx, conv, 'Please record that I sold 2 VRT at 125 on 2026-10-20 in TFSA.', [
    () => [use('propose_record_change', { change_type: 'add_transaction', details: { type: 'SELL', symbol: 'VRT', quantity: 2, price: 125, fees: 0, account: 'TFSA', trade_date: '2026-10-20' }, user_request_quote: 'record that I sold 2 VRT at 125 on 2026-10-20 in TFSA' })],
    (m, res) => answer({ short_answer: say, details: [{ category: 'portfolio_record', text: 'Proposed: SELL 2 VRT at 125 on 2026-10-20 in TFSA.', refs: [res[0].ref] }] }),
  ]);
  assert.equal(msg.answer.short_answer, say);
  assert.deepEqual(msg.answer.details[0].tradeStatuses, ['PROPOSED']);
  assert.deepEqual(snapshot(ctx.db), before, 'a proposal saves nothing');
  rejectProposal(ctx, results[0].proposalId);
  const p = getConversation(ctx.db, conv).proposals[0];
  assert.deepEqual([p.tradeStatus, p.status, p.savedRecord], ['PROPOSED', 'rejected', null]);
});

test('broker-confirmed wording is removed: no record can be broker-confirmed', () => {
  const { L, r } = ledgerWith({ sell: true });
  const v = check({
    short_answer: 'Your sale of 10 VRT is broker-confirmed. You sold 10 VRT at 129.50.',
    details: [
      { category: 'portfolio_record', text: 'Your sale of 10 VRT was filled at your broker at 129.50.', refs: [r.sell] },
      { category: 'portfolio_record', text: 'Your broker confirmed the sale.', refs: [r.sell] },
      { category: 'interpretation', text: 'Nothing in Signal Desk is broker-confirmed: it has no broker connection.', refs: [] },
    ],
    what_would_change_it: 'The fill was confirmed by your broker. Once your broker confirms a fill, you can record it here.',
    alternatives: [{ option: 'Hold', case_for: 'Confirmation from your broker arrived.', case_against: 'Concentration.' }],
  }, L);
  assert.equal(v.answer.short_answer, `[${BROKER_REMOVED}] You sold 10 VRT at 129.50.`);
  assert.deepEqual(v.answer.details.map((d) => [d.text, d.tradeStatementRemoved ?? null]), [[BROKER_REMOVED, 'broker'], [BROKER_REMOVED, 'broker'], ['Nothing in Signal Desk is broker-confirmed: it has no broker connection.', null]]);
  assert.equal(v.answer.what_would_change_it, `[${BROKER_REMOVED}] Once your broker confirms a fill, you can record it here.`);
  assert.equal(v.answer.alternatives[0].case_for, `[${BROKER_REMOVED}]`);
  assert.ok(v.issues.includes(BROKER_REMOVED));
  assert.ok(v.unbacked.every((u) => u.reason === 'broker') && v.unbacked.length === 5);
});

test('the owner saying "I sold 10 VRT" gives no USER-REPORTED record until a proposal is confirmed', async () => {
  const ctx = makeCtx();
  seed(ctx);
  const conv = createConversation(ctx.db);
  const said = 'I sold 10 VRT at 129.50 today in TFSA.';
  const sellRef = (res) => res[0].transactions.find((t) => t.symbol === 'VRT' && t.type === 'SELL')?.ref;

  // 1. A model that takes the owner's word for it: removed (asked once to rephrase, then removed).
  let { msg, results } = await turn(ctx, conv, said, [
    () => [use('get_transactions', { symbol: 'VRT', since: null, limit: null })],
    (m, res) => answer({ short_answer: 'You sold 10 VRT at 129.50 today.', details: [{ category: 'portfolio_record', text: 'You sold 10 VRT at 129.50 today.', refs: [res[0].ref, res[0].transactions[0].ref] }] }),
    () => answer({ short_answer: 'You sold 10 VRT at 129.50 today.', details: [{ category: 'portfolio_record', text: 'You sold 10 VRT at 129.50 today.', refs: [] }] }),
  ]);
  assert.equal(sellRef(results), undefined, 'no sale in the records');
  assert.ok(!msg.ledger.some((i) => i.tradeStatus === 'USER-REPORTED' && i.side === 'SELL'));
  assert.equal(msg.answer.short_answer, notice);
  assert.equal(msg.answer.details[0].text, TRADE_REMOVED);
  assert.equal(msg.status, 'partial');

  // 2. It proposes recording the sale and says so as reported speech: kept, PROPOSED only.
  ({ msg, results } = await turn(ctx, conv, said, [
    () => [use('propose_record_change', { change_type: 'add_transaction', details: { type: 'SELL', symbol: 'VRT', quantity: 10, price: 129.5, fees: 0, account: 'TFSA' }, user_request_quote: 'I sold 10 VRT at 129.50 today in TFSA' })],
    (m, res) => answer({ short_answer: 'You said you sold 10 VRT at 129.50 today; recording it is proposed and nothing is saved until you press Confirm.',
      details: [{ category: 'portfolio_record', text: 'Proposed: SELL 10 VRT at 129.50 in TFSA.', refs: [res[0].ref] }] }),
  ]));
  const proposalId = results[0].proposalId;
  assert.ok(proposalId, JSON.stringify(results[0]));
  assert.match(msg.answer.short_answer, /^You said you sold 10 VRT/);
  assert.deepEqual(msg.answer.details[0].tradeStatuses, ['PROPOSED']);
  assert.deepEqual(msg.ledger.filter((i) => i.tradeStatus).map((i) => i.tradeStatus), ['PROPOSED']);

  // 3. Before confirmation the records still have no sale, so "you sold" is removed.
  ({ msg, results } = await turn(ctx, conv, 'What did I sell today?', [
    () => [use('get_transactions', { symbol: 'VRT', since: null, limit: null })],
    (m, res) => answer({ short_answer: 'You sold 10 VRT at 129.50 today.', details: [{ category: 'portfolio_record', text: 'You sold 10 VRT at 129.50 today.', refs: res[0].transactions.map((t) => t.ref) }] }),
    () => answer({ short_answer: 'Your records show no sale today; the sale you mentioned is proposed but not confirmed.', details: [] }),
  ]));
  assert.equal(sellRef(results), undefined);
  assert.match(msg.answer.short_answer, /^Your records show no sale today/);
  assert.ok(msg.answer.notes.some((n) => /described a trade without a record/.test(n)), 'the model was asked once to rephrase');

  // 4. After confirmation: a USER-REPORTED record, saved from the chat proposal.
  confirmProposal(ctx, proposalId, { conversationId: conv });
  const p = getConversation(ctx.db, conv).proposals.find((x) => x.id === proposalId);
  assert.equal(p.savedRecord.tradeStatus, 'USER-REPORTED');
  ({ msg, results } = await turn(ctx, conv, 'What did I sell today?', [
    () => [use('get_transactions', { symbol: 'VRT', since: null, limit: null })],
    (m, res) => answer({ short_answer: 'Your records show you sold 10 VRT at 129.50 today.', details: [{ category: 'portfolio_record', text: 'You sold 10 VRT at 129.50 today (recorded from your confirmed proposal).', refs: [sellRef(res)] }] }),
  ]));
  const row = results[0].transactions.find((t) => t.type === 'SELL');
  assert.deepEqual([row.tradeStatus, row.origin, row.confirmedProposalId], ['USER-REPORTED', 'chat_proposal', proposalId]);
  assert.equal(p.savedRecord.recordId, `transaction:${row.id}`);
  assert.equal(msg.answer.short_answer, 'Your records show you sold 10 VRT at 129.50 today.');
  assert.deepEqual(msg.answer.details[0].tradeStatuses, ['USER-REPORTED']);
  assert.equal(msg.status, 'ok', JSON.stringify(msg.answer.issues));
});

// A small synthetic demo Lab, read through the chat tools.
let shared = null;
const demoLab = () => (shared ||= (async () => {
  const dir = tempDir();
  const ctx = { cfg: loadConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none' }), mode: 'demo', providers: { market: null } };
  const lab = createLab(ctx, { demo: { symbols: ['NVDA', 'AMD', 'MSFT', 'SPY'], to: '2022-09-30' } });
  await lab.ready;
  return lab;
})());
after(async () => { if (shared) (await shared).close(); });

test('simulated statements keep their SIMULATED status: scenarios and Strategy Lab trades', { timeout: 120000 }, async () => {
  // A hypothetical sale needs the scenario that computed it.
  const { L, r } = ledgerWith({ scenario: true });
  const hypo = 'A hypothetical sale of 20 NBIS would free about 2,030 USD before fees.';
  let v = check({ short_answer: hypo, details: [{ category: 'calculation', text: hypo, refs: [r.scenario] }, { category: 'calculation', text: hypo, refs: [r.position] }] }, L);
  assert.equal(v.answer.short_answer, hypo);
  assert.deepEqual(v.answer.details.map((d) => [d.text, d.tradeStatuses]), [[hypo, ['SIMULATED']], [TRADE_REMOVED, []]]);
  assert.equal(check({ short_answer: hypo }, ledgerWith().L).answer.short_answer, notice, 'no scenario this turn');
  assert.equal(check({ short_answer: 'In scenario S1, you sold 20 NBIS for about 2,030 USD.' }, L).answer.short_answer, 'In scenario S1, you sold 20 NBIS for about 2,030 USD.', 'a scenario frame makes "you sold" simulated');

  // Strategy Lab: trades are SIMULATED records; configs and stored market data are not trade records.
  const lab = await demoLab();
  const ctx = makeCtx();
  seed(ctx);
  Object.defineProperty(ctx, 'lab', { configurable: true, get: () => lab });
  const { msg, results } = await turn(ctx, createConversation(ctx.db), 'What did the strategy buy in the backtest?', [
    () => [use('get_strategy_trades', { source: 'backtest', mode: 'swing', limit: 2 }), use('get_strategy_versions', {}), use('get_strategy_lab', { mode: 'swing' })],
    (m, res) => {
      const t = res[0].trades[0];
      const said = `In the backtest, the simulated account bought ${t.shares} ${t.symbol} at ${t.entryPrice}.`;
      return answer({ short_answer: said, details: [
        { category: 'calculation', text: said, refs: [t.ref] },
        { category: 'calculation', text: `Simulated fill: bought ${t.shares} ${t.symbol} at ${t.entryPrice}.`, refs: [t.ref] },
        { category: 'calculation', text: said, refs: [res[1].active.ref] },
      ] });
    },
  ]);
  const [trades, versions, overview] = results;
  const t = trades.trades[0];
  assert.ok(t, 'the demo backtest has trades');
  const ti = item(msg, t.ref);
  assert.deepEqual([ti.tradeStatus, ti.recordId, ti.subState, ti.symbol], ['SIMULATED', `lab-trade:${t.id}`, 'backtest', t.symbol]);
  assert.equal(item(msg, versions.active.ref).tradeStatus, undefined, 'a strategy version is a config file, not a trade');
  assert.equal(item(msg, overview.data.ref).tradeStatus, undefined, 'stored market data is not a trade');
  assert.equal(item(msg, overview.account.ref).tradeStatus, 'SIMULATED');
  const said = `In the backtest, the simulated account bought ${t.shares} ${t.symbol} at ${t.entryPrice}.`;
  assert.equal(msg.answer.short_answer, said);
  assert.deepEqual(msg.answer.details.map((d) => [d.text, d.tradeStatuses]), [
    [said, ['SIMULATED']],
    [`Simulated fill: bought ${t.shares} ${t.symbol} at ${t.entryPrice}.`, ['SIMULATED']],
    [TRADE_REMOVED, []],
  ], 'a simulated trade cited only to a config file is removed');
  assert.ok(!msg.ledger.some((i) => i.tradeStatus === 'USER-REPORTED' || i.tradeStatus === 'PROPOSED'), 'the Lab never produces records of the owner');
});
