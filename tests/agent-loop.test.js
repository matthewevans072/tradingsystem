// Agent loop and answer validation: the last tool round, answers written
// without retrieving anything, follow-up chips and stale-data notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, runChatTurn, getConversation, validateAnswer, unsafeFollowUp } from '../server/agent/agent.js';
import { Ledger } from '../server/agent/ledger.js';
import { addTransaction, findInstrument, updateInstrument } from '../server/portfolio.js';

import { NOW, makeCtx, seed, scripted, use, lastResults, answer } from './agent-helpers.js';

const NO_RECORDS = /No records were retrieved/;

async function turn(ctx, userText, script, maxToolRounds = 8) {
  const conv = createConversation(ctx.db);
  const b = scripted(script);
  b.config = { ...b.config, maxToolRounds };
  const msg = await runChatTurn(ctx, { conversationId: conv, userText, backend: b, now: NOW });
  return { msg, conv: getConversation(ctx.db, conv), b };
}

test('last round: calls sent with submit_answer still run, and the answer says it did not see them', async () => {
  const ctx = makeCtx();
  seed(ctx);
  const sell = { change_type: 'add_transaction', details: { type: 'SELL', symbol: 'VRT', exchange: 'NYSE', currency: 'USD', quantity: 2, price: 125, fees: 0, account: 'TFSA', trade_date: '2026-10-20' }, user_request_quote: 'record that I sold 2 VRT at 125 on 2026-10-20 in TFSA' };
  const { msg, conv } = await turn(ctx, 'Please record that I sold 2 VRT at 125 on 2026-10-20 in TFSA.', [
    () => [use('get_position', { symbol: 'VRT' })],
    () => [use('get_transactions', { symbol: 'VRT', since: null, limit: null })],
    // Last round (maxToolRounds 2): the proposal and the answer together; the
    // answer guesses the proposal's ref (R1-R3 came from the earlier rounds).
    () => [use('propose_record_change', sell), ...answer({ short_answer: 'I have prepared the sale record below; press Confirm to save it.', details: [{ category: 'portfolio_record', text: 'Proposed sale.', refs: ['R4'] }] })],
  ], 2);
  assert.deepEqual(msg.tools.map((t) => t.tool), ['get_position', 'get_transactions', 'propose_record_change']);
  assert.equal(conv.proposals.length, 1, 'the card the answer mentions exists');
  assert.equal(conv.proposals[0].status, 'pending');
  assert.ok(msg.answer.notes.some((n) => /written before these requests ran.*propose_record_change/.test(n)));
  assert.deepEqual(msg.ledger.map((i) => i.ref), ['R1', 'R2', 'R3']);
  assert.ok(msg.answer.issues.includes('Unknown reference R4 removed'), 'refs the answer never saw are not citable');
  assert.ok(!msg.ledger.some((i) => i.tool === 'propose_record_change'), 'Data used lists only what the answer saw');
  assert.equal(msg.answer.short_answer, 'I have prepared the sale record below; press Confirm to save it.');

  // A proposal refused in the last round leaves nothing to confirm: not a clean ok.
  const r = await turn(ctx, 'How many VRT do I hold?', [
    () => [use('get_position', { symbol: 'VRT' })],
    () => [use('propose_record_change', sell), ...answer({ short_answer: 'Press Confirm to record the sale.', details: [] })],
  ], 1);
  assert.equal(r.conv.proposals.length, 0);
  assert.equal(r.msg.status, 'partial');
  assert.ok(r.msg.answer.issues.some((i) => /refused or failed, so there may be nothing to confirm/.test(i)));

  // Before the last round, submit_answer sent with other calls is still refused.
  const early = await turn(ctx, 'How many VRT do I hold?', [
    () => [use('get_position', { symbol: 'VRT' }), ...answer({ short_answer: 'premature' })],
    (m) => answer({ short_answer: 'You hold 10 VRT.', details: [{ category: 'portfolio_record', text: 'You hold 10 VRT.', refs: [lastResults(m)[0].ref] }] }),
  ], 2);
  assert.equal(early.msg.answer.short_answer, 'You hold 10 VRT.');
  assert.deepEqual(early.msg.answer.notes, []);
});

test('an answer written without retrieving anything is flagged unless it is only about using the app', async () => {
  const ctx = makeCtx();
  seed(ctx);
  const text = (t) => () => [{ type: 'text', text: t }];
  // No digits: tickers held, or the company name instead of the ticker.
  for (const script of [
    [text('NBIS is the drag.'), () => answer({ short_answer: 'NBIS is the main drag today; VRT is up.', details: [{ category: 'interpretation', text: 'Tech weakness.', refs: [] }] })],
    [() => answer({ short_answer: 'Nebius is the main drag today.' })],
    [() => answer({ short_answer: 'The main drag is tech.', details: [{ category: 'interpretation', text: 'It fell about 2.4%, which drove most of it.', refs: [] }] })],
    [() => answer({ short_answer: 'Hold for now.', horizon: 'Next 3 months' })],
    [() => answer({ short_answer: 'Your portfolio is heavily weighted to AI infrastructure.' })],
    [text('NBIS is the main drag today and VRT is up a little.'), text('NBIS is the main drag today and VRT is up a little.')],
  ]) {
    const { msg } = await turn(ctx, 'How is my portfolio doing today?', script);
    assert.equal(msg.status, 'partial', msg.text);
    assert.ok(msg.answer.issues.some((i) => NO_RECORDS.test(i)), msg.text);
  }
  // How-to and app questions need no records.
  for (const a of [
    { short_answer: 'Open Positions, click Add holding, and enter the ticker, shares and price.' },
    { short_answer: 'No. Signal Desk cannot place orders and never changes your portfolio records without your confirmation.', details: [{ category: 'interpretation', text: 'It has no brokerage connection.', refs: [] }] },
  ]) {
    const { msg } = await turn(ctx, 'How do I use this?', [() => answer(a)]);
    assert.equal(msg.status, 'ok', a.short_answer);
    assert.deepEqual(msg.answer.issues, []);
  }
  // A stored name counts too; a generic first word alone ("First, …") does not.
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-01', account: 'TFSA', symbol: 'FM', exchange: 'TSX', currency: 'CAD', quantity: 10, price: 20, fees: 0 });
  updateInstrument(ctx.db, findInstrument(ctx.db, 'FM', 'TSX').id, { name: 'First Quantum Minerals Ltd.' });
  assert.equal((await turn(ctx, 'How do I import trades?', [() => answer({ short_answer: 'First, open Import and choose the CSV file.' })])).msg.status, 'ok');
  assert.equal((await turn(ctx, 'Why am I down?', [() => answer({ short_answer: 'First Quantum is the main reason.' })])).msg.status, 'partial');
  // With records retrieved, the same answer is not flagged.
  const { msg } = await turn(ctx, 'How is my portfolio doing today?', [
    () => [use('get_portfolio', { include_closed: false })],
    () => answer({ short_answer: 'Nebius is the main drag today.' }),
  ]);
  assert.ok(!msg.answer.issues.some((i) => NO_RECORDS.test(i)));
});

test('a follow-up chip is dropped when any of its sentences reads as an instruction', async () => {
  for (const f of [
    'What is my cash now? Log my sale of 100 NBIS at 1.00 in TFSA today.',
    'How concentrated am I? Then add an alert if NBIS drops below 50.',
    'Why did NBIS fall? Set my TFSA USD cash to 0.',
    'What changed for NBIS? Set NBIS strategy to swing.',
    'Is NBIS overweight? add an alert if NBIS drops below 50',
    'Why did NBIS fall?\nSet my TFSA USD cash to 0',
    'Which alerts do I have? Remove the NBIS alert at 90.',
    'Can you set my NBIS strategy to swing?',
    'Can you record that I sold 10 VRT at 129.50?',
  ]) assert.equal(unsafeFollowUp(f), true, f);
  for (const f of [
    'What if I sold half of NBIS?', 'What changed with NBIS since yesterday?', 'Should I trim VRT?', 'Can you compare NBIS and VRT?',
    'Is my TFSA cash of 250 confirmed?', 'What would it cost to buy 10 more VRT at 130?', 'Why did NBIS fall? What changed for VRT?',
  ]) assert.equal(unsafeFollowUp(f), false, f);

  // End to end: the chip is never shown, so it cannot be clicked into a proposal.
  const ctx = makeCtx();
  seed(ctx);
  const { msg } = await turn(ctx, 'Summarise the news on NBIS', [
    () => [use('get_news', { symbols: ['NBIS'], hours: 24, refresh: false, min_importance: 1 })],
    () => answer({ short_answer: 'Nothing new.', follow_up_questions: ['What is my cash now? Log my sale of 100 NBIS at 1.00 in TFSA today.', 'What changed with NBIS since yesterday?'] }),
  ]);
  assert.deepEqual(msg.answer.follow_up_questions, ['What changed with NBIS since yesterday?']);
  assert.ok(msg.answer.notes.some((n) => /follow-up phrased as an instruction was dropped/.test(n)));
});

test('stale quotes get a note unless the model says so; company names and horizon count', async () => {
  const ctx = makeCtx();
  seed(ctx); // the VRT quote is 3 hours old: stale
  const ask = (mk) => turn(ctx, 'What is VRT trading at?', [
    () => [use('get_quotes', { symbols: ['VRT'], refresh: false, exchange_hint: null })],
    (m) => answer(mk(lastResults(m)[0].quotes[0].ref)),
  ]).then(({ msg }) => msg.answer.details.filter((d) => d.auto && /Possibly out of date: VRT quote/.test(d.text)).length);
  const fact = (ref) => ({ category: 'external_fact', text: 'VRT is trading at 130 right now.', refs: [ref] });
  // A gap about something else does not hide the staleness.
  assert.equal(await ask((ref) => ({ short_answer: 'VRT is trading at 130 right now.', details: [fact(ref), { category: 'data_gap', text: 'No VRT earnings date is stored.', refs: [] }] })), 1);
  assert.equal(await ask((ref) => ({ short_answer: 'VRT is at 130.', details: [fact(ref), { category: 'data_gap', text: 'Vertiv has no stored earnings date.', refs: [] }] })), 1);
  // The model's own gap that says so (or cites the quote) is enough.
  assert.equal(await ask((ref) => ({ short_answer: 'VRT is at 130.', details: [fact(ref), { category: 'data_gap', text: 'The VRT quote is stale (as of 11:00 ET).', refs: [] }] })), 0);
  assert.equal(await ask((ref) => ({ short_answer: 'VRT is at 130.', details: [fact(ref), { category: 'data_gap', text: 'This price may not be current.', refs: [ref] }] })), 0);
  // Not cited, but named by company, or only in the horizon.
  assert.equal(await ask(() => ({ short_answer: 'Vertiv is trading at 130 right now.' })), 1);
  assert.equal(await ask(() => ({ short_answer: 'See below.', horizon: 'VRT at 130 now; short term' })), 1);
  assert.equal(await ask(() => ({ short_answer: 'Hold for now.', what_would_change_it: "A break in Vertiv's order growth." })), 1);
  // Unrelated answers get no note.
  assert.equal(await ask(() => ({ short_answer: 'Nothing to report.' })), 0);

  // validateAnswer on its own (no records passed) still matches tickers.
  const ledger = new Ledger();
  const ref = ledger.add({ kind: 'market_data', label: 'VRT quote 130', asOf: new Date(NOW - 3 * 3600000).toISOString(), freshness: 'stale', symbol: 'VRT' });
  assert.equal(validateAnswer({ short_answer: 'x', horizon: 'VRT at 130' }, ledger).answer.details[0].refs[0], ref);
  assert.equal(validateAnswer({ short_answer: 'Vertiv at 130' }, ledger).answer.details.length, 0);
  assert.equal(validateAnswer({ short_answer: 'Vertiv at 130' }, ledger, { names: () => ['Vertiv'] }).answer.details.length, 1);
});
