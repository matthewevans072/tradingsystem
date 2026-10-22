// Agent loop and answer validation: the last tool round, answers written
// without retrieving anything, follow-up chips and stale-data notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, runChatTurn, getConversation, validateAnswer, unsafeFollowUp } from '../server/agent/agent.js';
import { Ledger } from '../server/agent/ledger.js';
import { addTransaction, findInstrument, updateInstrument } from '../server/portfolio.js';

import { NOW, makeCtx, seed, scripted, use, lastResults, answer } from './agent-helpers.js';
import { putQuote } from './helpers.js';

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
    // A hyphenated word is not an instruction verb.
    'Why did NBIS fall? Short-term, what matters?', 'Short-term outlook for VRT?', 'Sell-side estimates for NBIS?', 'Add-on risk from VRT?',
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

test('a model gap naming the stale instrument in its own words suppresses the automatic note', async () => {
  const mk = () => {
    const L = new Ledger();
    return { L, ref: L.add({ kind: 'market_data', label: 'VRT quote 130', asOf: new Date(NOW - 3 * 3600000).toISOString(), freshness: 'stale', symbol: 'VRT' }) };
  };
  const autoNotes = (gap) => {
    const { L, ref } = mk();
    const raw = { short_answer: 'VRT is at 130.', details: [{ category: 'external_fact', text: 'VRT at 130.', refs: [ref] }, { category: 'data_gap', text: gap, refs: [] }] };
    return validateAnswer(raw, L, { toolsRun: 1, names: () => ['Vertiv'] }).answer.details.filter((d) => d.auto).length;
  };
  for (const gap of ["The VRT quote hasn't updated since 11:00 ET.", 'The VRT quote is three hours old.', 'The VRT price is from 11:00 ET, before the latest move.',
    'VRT quote: 15 minutes behind.', 'The VRT quote may not reflect the current price.', "Vertiv's market data is from late morning."]) assert.equal(autoNotes(gap), 0, gap);
  // A gap about something else on the same ticker does not.
  for (const gap of ['No VRT earnings date is stored.', 'No VRT price target is stored.', 'The NBIS quote is three hours old.']) assert.equal(autoNotes(gap), 1, gap);
});

test('company names: fund families and ordinary first words do not match other instruments or app text', async () => {
  // Catalog ETFs: XIU and VFV fresh, SOXX and VOO stale; the answer is about XIU and VFV only.
  {
    const ctx = makeCtx();
    seed(ctx);
    const add = (symbol, exchange, currency, price, ageMin) => {
      addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-01', account: 'TFSA', symbol, exchange, currency, quantity: 10, price: 20, fees: 0 });
      const i = findInstrument(ctx.db, symbol, exchange);
      updateInstrument(ctx.db, i.id, { identity_status: 'confirmed', identity_note: 't' });
      putQuote(ctx.db, i.id, { price, prev_close: price - 1, quote_time: new Date(NOW - ageMin * 60000).toISOString() });
    };
    add('XIU', 'TSX', 'CAD', 40, 1);
    add('SOXX', 'NASDAQ', 'USD', 250, 180);
    add('VFV', 'TSX', 'CAD', 140, 1);
    add('VOO', 'NYSE Arca', 'USD', 500, 180);
    const { msg } = await turn(ctx, 'How are my index funds doing?', [
      () => [use('get_portfolio', { include_closed: false })],
      (m) => {
        const refOf = (s) => lastResults(m)[0].positions.find((p) => p.symbol === s)?.quoteRef;
        return answer({ short_answer: 'Your iShares S&P/TSX 60 ETF (XIU) is up 2.6% and the Vanguard S&P 500 Index ETF (VFV) is up 0.7%.',
          details: [{ category: 'portfolio_record', text: 'XIU 40 and VFV 140 at the latest quotes.', refs: [refOf('XIU'), refOf('VFV')].filter(Boolean) }] });
      },
    ]);
    assert.deepEqual(msg.answer.details.filter((d) => d.auto && /Possibly out of date/.test(d.text)).map((d) => d.text), []);
    // The fund's own full name still counts.
    const { msg: m2 } = await turn(ctx, 'And the chip fund?', [
      () => [use('get_portfolio', { include_closed: false })],
      () => answer({ short_answer: 'The iShares Semiconductor ETF is the laggard.' }),
    ]);
    assert.ok(m2.answer.details.some((d) => d.auto && /SOXX quote/.test(d.text)));
  }
  // User-named instruments whose names start with ordinary words, all with stale quotes.
  {
    const ctx = makeCtx();
    seed(ctx);
    for (const [symbol, exchange, currency, name] of [['OTEX', 'TSX', 'CAD', 'Open Text Corporation'], ['COF', 'NYSE', 'USD', 'Capital One Financial Corporation'], ['BBY', 'NYSE', 'USD', 'Best Buy Co., Inc.']]) {
      addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-01', account: 'TFSA', symbol, exchange, currency, quantity: 10, price: 20, fees: 0 });
      const i = findInstrument(ctx.db, symbol, exchange);
      updateInstrument(ctx.db, i.id, { name, identity_status: 'confirmed', identity_note: 't' });
      putQuote(ctx.db, i.id, { price: 50, prev_close: 49, quote_time: new Date(NOW - 3 * 3600000).toISOString() });
    }
    for (const t of ['Open Positions, click Add holding, and enter the ticker, shares and price.', 'Capital gains are not estimated by Signal Desk.', 'Best to confirm the instrument first: open Positions and press Confirm identity.']) {
      const { msg } = await turn(ctx, 'How do I use this?', [() => answer({ short_answer: t })]);
      assert.equal(msg.status, 'ok', t);
    }
    const { msg } = await turn(ctx, 'When is the next earnings call?', [
      () => [use('get_portfolio', { include_closed: false })],
      () => answer({ short_answer: 'The next earnings call is on Monday. Capital gains are not estimated. Best to check the Events page; Open Events from the menu.' }),
    ]);
    assert.deepEqual(msg.answer.details.filter((d) => d.auto && /Possibly out of date: (OTEX|COF|BBY)/.test(d.text)), []);
    // The distinctive part of the name still counts.
    assert.equal((await turn(ctx, 'Why am I down?', [() => answer({ short_answer: 'Capital One is the main reason.' })])).msg.status, 'partial');
    const { msg: m3 } = await turn(ctx, 'Why am I down?', [
      () => [use('get_portfolio', { include_closed: false })],
      () => answer({ short_answer: 'Open Text and Best Buy are the main reasons.' }),
    ]);
    assert.equal(m3.answer.details.filter((d) => d.auto && /Possibly out of date: (OTEX|BBY)/.test(d.text)).length, 2);
  }
});

test('with no records retrieved, app how-to answers, clarifying questions and refusals are not flagged', async () => {
  for (const t of [
    '1. Open Positions. 2. Click Add holding. 3. Enter the ticker, shares and price.',
    'The Positions page lists everything you hold, with average cost and weight.',
    'Your portfolio is stored locally in data/signal-desk.sqlite.',
    'If the model declined to answer, ask again more narrowly.',
  ]) assert.ok(!validateAnswer({ short_answer: t, details: [] }, new Ledger(), { toolsRun: 0 }).issues.some((i) => NO_RECORDS.test(i)), t);
  const steps = { short_answer: 'Open Settings and set the cap.', details: [{ category: 'interpretation', text: 'Step 1: open .env. Step 2: set CHAT_DAILY_BUDGET_USD.', refs: [] }] };
  assert.ok(!validateAnswer(steps, new Ledger(), { toolsRun: 0 }).issues.some((i) => NO_RECORDS.test(i)));
  // Statements about holdings and moves are still flagged.
  for (const t of ['You hold mostly chip stocks.', 'Your portfolio is heavily weighted to AI infrastructure.', 'Tech stocks declined today.', 'Shares dropped after the report.'])
    assert.ok(validateAnswer({ short_answer: t, details: [] }, new Ledger(), { toolsRun: 0 }).issues.some((i) => NO_RECORDS.test(i)), t);

  const ctx = makeCtx();
  seed(ctx);
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-01', account: 'TFSA', symbol: 'IT', exchange: 'NYSE', currency: 'USD', quantity: 10, price: 20, fees: 0 });
  updateInstrument(ctx.db, findInstrument(ctx.db, 'IT', 'NYSE').id, { name: 'Gartner, Inc.', identity_status: 'confirmed', identity_note: 't' });
  for (const t of [
    'Do you mean the NBIS lot in your TFSA or the one in your RRSP?',
    'Did you mean Vertiv (VRT) or Vistra (VST)?',
    'I cannot sell NBIS or anything else; Signal Desk has no brokerage link.',
    'IT spending trends are not tracked by the app.',
  ]) {
    const { msg } = await turn(ctx, 'How is my portfolio doing today?', [() => answer({ short_answer: t })]);
    assert.equal(msg.status, 'ok', t);
  }
  for (const t of ['I cannot sell anything, but NBIS is the main drag today.', 'Which account? NBIS is your largest holding.', 'NBIS slid, so I cannot say more without fresh data.']) {
    const { msg } = await turn(ctx, 'How is my portfolio doing today?', [() => answer({ short_answer: t })]);
    assert.equal(msg.status, 'partial', t);
  }
});

test('last round: a browser disconnect while the bundled calls run keeps the checked answer', async () => {
  const ctx = makeCtx();
  seed(ctx);
  const run = async (late) => {
    const ac = new AbortController();
    const conv = createConversation(ctx.db);
    const b = scripted([
      () => [use('get_position', { symbol: 'VRT' })],
      () => { ac.abort(); return [...late, ...answer({ short_answer: 'You hold 10 VRT.' })]; },
    ]);
    b.config = { ...b.config, maxToolRounds: 1 };
    return runChatTurn(ctx, { conversationId: conv, userText: 'Please record that I sold 2 VRT at 125 on 2026-10-20 in TFSA.', backend: b, now: NOW, signal: ac.signal });
  };
  const msg = await run([use('get_position', { symbol: 'VRT' })]);
  assert.equal(msg.status, 'ok');
  assert.equal(msg.text, 'You hold 10 VRT.');
  assert.deepEqual(msg.tools.map((t) => t.tool), ['get_position'], 'the late call did not run');
  assert.ok(msg.answer.notes.some((n) => /disconnected before these requests sent with the answer ran: get_position/.test(n)));
  // A proposal that was never prepared leaves nothing to confirm.
  const sell = { change_type: 'add_transaction', details: { type: 'SELL', symbol: 'VRT', exchange: 'NYSE', currency: 'USD', quantity: 2, price: 125, fees: 0, account: 'TFSA', trade_date: '2026-10-20' }, user_request_quote: 'record that I sold 2 VRT at 125 on 2026-10-20 in TFSA' };
  const p = await run([use('propose_record_change', sell)]);
  assert.equal(p.status, 'partial');
  assert.ok(p.answer.issues.some((i) => /not prepared because the browser disconnected/.test(i)));
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM chat_proposals').get().n, 0);
});
