// Ask Signal Desk tool outputs: instruments outside the catalog, movers per
// listing, mixed sessions, holdings in several accounts, news for unconfirmed
// identities, chained fees and session-matched FX. Tools are called directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOW, makeCtx, seed } from './agent-helpers.js';
import { putQuote } from './helpers.js';
import { addTransaction, findInstrument, updateInstrument, setCash, computePortfolio } from '../server/portfolio.js';
import { createToolbox } from '../server/agent/tools.js';
import { simulateTrades, dailyAttribution } from '../server/agent/calc.js';
import { Ledger } from '../server/agent/ledger.js';
import { storeNews } from '../server/news.js';
import { zonedToUtc } from '../server/time.js';

function toolbox(ctx, now = NOW) {
  const ledger = new Ledger();
  return { h: createToolbox(ctx, { ledger, turn: { conversationId: 1, userText: 'x', now, scenarios: [], priorScenarioCount: 0, proposals: [] } }), ledger };
}
function hold(ctx, { symbol, exchange, currency, account = 'TFSA', quantity = 100, cost = 90, price, prev, at = NOW, identity = 'confirmed' }) {
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-09-01', account, symbol, exchange, currency, quantity, price: cost, fees: 0 });
  const i = findInstrument(ctx.db, symbol, exchange);
  updateInstrument(ctx.db, i.id, { identity_status: identity, identity_note: 't' });
  if (price != null) putQuote(ctx.db, i.id, { price, prev_close: prev, quote_time: new Date(at).toISOString() });
  return i;
}
const fx = (ctx, rate, asOf) => ctx.db.prepare("INSERT INTO fx_rates VALUES ('USDCAD', ?, ?, 'Bank of Canada daily rate', ?)").run(rate, asOf, NOW.toISOString());
const noArgs = { shares: null, fraction: null, cash_amount: null, target_weight_pct: null, price: null, fees: null, account: null };

test('a previously held instrument outside the catalog is simulated from the user\'s own records', async () => {
  const ctx = makeCtx();
  seed(ctx);
  const sold = (symbol, exchange, currency, account, price) => {
    addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-08-03', account, symbol, exchange, currency, quantity: 5, price: 200, fees: 0 });
    addTransaction(ctx.db, { type: 'SELL', trade_date: '2026-09-15', account, symbol, exchange, currency, quantity: 5, price: 230, fees: 0 });
    const i = findInstrument(ctx.db, symbol, exchange);
    updateInstrument(ctx.db, i.id, { identity_status: 'confirmed', identity_note: 'from brokerage' });
    putQuote(ctx.db, i.id, { price, prev_close: price - 2, quote_time: new Date(NOW - 600000).toISOString() });
  };
  sold('AAPL', 'NASDAQ', 'USD', 'TFSA', 240);
  const { h, ledger } = toolbox(ctx);
  const s = await h.simulate_trade({ ...noArgs, symbol: 'AAPL', side: 'buy', shares: 2, account: 'TFSA' });
  assert.equal(s.currency, 'USD');
  assert.equal(s.exchange, 'NASDAQ');
  assert.equal(s.price, 240, 'its stored quote is the estimated price');
  assert.equal(s.cashBefore, 250);
  assert.ok(ledger.toJSON().some((r) => r.kind === 'market_data' && r.symbol === 'AAPL'), 'the quote used is a cited source');
  assert.equal((await h.simulate_trade({ ...noArgs, symbol: 'AAPL', side: 'buy', shares: 2, price: 250, account: 'TFSA' })).price, 250);
  const m = await h.simulate_trades({ legs: [{ side: 'sell', symbol: 'NBIS', shares: 10, account: 'TFSA' }, { side: 'buy', symbol: 'AAPL', shares: 3, account: 'TFSA' }] });
  assert.deepEqual(m.legs.map((l) => [l.symbol, l.currency, l.price]), [['NBIS', 'USD', 101.5], ['AAPL', 'USD', 240]]);

  // The same ticker sold on two listings: the account's own listing is used.
  sold('SHOP', 'TSX', 'CAD', 'TFSA', 150);
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-02', account: 'RRSP', symbol: 'VRT', exchange: 'NYSE', currency: 'USD', quantity: 1, price: 110, fees: 0 });
  sold('SHOP', 'NYSE', 'USD', 'RRSP', 105);
  const tfsa = await h.simulate_trade({ ...noArgs, symbol: 'SHOP', side: 'buy', shares: 1, account: 'TFSA' });
  assert.deepEqual([tfsa.exchange, tfsa.currency, tfsa.price], ['TSX', 'CAD', 150]);
  const rrsp = await h.simulate_trade({ ...noArgs, symbol: 'SHOP', side: 'buy', shares: 1, account: 'RRSP' });
  assert.deepEqual([rrsp.exchange, rrsp.currency, rrsp.price], ['NYSE', 'USD', 105]);
  // Still so when another account holds the ticker on its other listing; a leg's exchange is respected.
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-05', account: 'TFSA', symbol: 'SHOP', exchange: 'TSX', currency: 'CAD', quantity: 10, price: 140, fees: 0 });
  setCash(ctx.db, { account: 'RRSP', currency: 'USD', amount: 1000, asOf: '2026-10-20', confirmed: true });
  const held = await h.simulate_trade({ ...noArgs, symbol: 'SHOP', side: 'buy', shares: 1, account: 'RRSP' });
  assert.deepEqual([held.exchange, held.currency, held.price, held.cashBefore, held.sharesBefore], ['NYSE', 'USD', 105, 1000, 0]);
  const inTfsa = await h.simulate_trade({ ...noArgs, symbol: 'SHOP', side: 'buy', shares: 1, account: 'TFSA' });
  assert.deepEqual([inTfsa.exchange, inTfsa.currency, inTfsa.price, inTfsa.sharesBefore], ['TSX', 'CAD', 150, 10]);
  const legs = await h.simulate_trades({ legs: [{ side: 'buy', symbol: 'SHOP', shares: 1, account: 'RRSP', exchange: 'NYSE' }, { side: 'buy', symbol: 'SHOP', shares: 1, account: 'TFSA' }] });
  assert.deepEqual(legs.legs.map((l) => [l.account, l.exchange, l.currency, l.price]), [['RRSP', 'NYSE', 'USD', 105], ['TFSA', 'TSX', 'CAD', 150]]);
  await assert.rejects(h.simulate_trades({ legs: [{ side: 'sell', symbol: 'SHOP', shares: 1, account: 'TFSA', exchange: 'NYSE' }] }), /No open position in SHOP on NYSE in TFSA/);

  // An unconfirmed record is not priced from its stored quote.
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-08-03', account: 'TFSA', symbol: 'ZZQX', exchange: 'NASDAQ', currency: 'USD', quantity: 1, price: 10, fees: 0 });
  addTransaction(ctx.db, { type: 'SELL', trade_date: '2026-09-03', account: 'TFSA', symbol: 'ZZQX', exchange: 'NASDAQ', currency: 'USD', quantity: 1, price: 11, fees: 0 });
  putQuote(ctx.db, findInstrument(ctx.db, 'ZZQX', 'NASDAQ').id, { price: 12, prev_close: 11, quote_time: NOW.toISOString() });
  await assert.rejects(h.simulate_trade({ ...noArgs, symbol: 'ZZQX', side: 'buy', shares: 1, account: 'TFSA' }), /identity is not confirmed/);
  assert.equal((await h.simulate_trade({ ...noArgs, symbol: 'ZZQX', side: 'buy', shares: 1, price: 12, account: 'TFSA' })).currency, 'USD');
});

test('biggest movers are kept per listing: USD and CAD are never added and two tickers never net out', async () => {
  const build = (rows, rate) => {
    const ctx = makeCtx();
    for (const r of rows) hold(ctx, r);
    if (rate) fx(ctx, rate, '2026-10-20');
    return ctx;
  };
  const shop = [
    { symbol: 'SHOP', exchange: 'NYSE', currency: 'USD', account: 'Margin', price: 100, prev: 105 }, // -500 USD
    { symbol: 'SHOP', exchange: 'TSX', currency: 'CAD', account: 'TFSA', price: 140, prev: 147 }, // -700 CAD
    { symbol: 'SHOP', exchange: 'TSX', currency: 'CAD', account: 'RRSP', quantity: 10, price: 140, prev: 147 }, // -70 CAD, same listing
    { symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', quantity: 10, price: 99, prev: 100 },
  ];
  let r = await toolbox(build(shop, 1.4)).h.explain_portfolio_move({ benchmarks: null });
  assert.deepEqual(r.biggestMovers.slice(0, 2).map((m) => [m.label, m.dailyPL, m.currency, m.dailyPLCad]), [['SHOP (TSX)', -770, 'CAD', -770], ['SHOP (NYSE)', -500, 'USD', -700]]);
  assert.ok(r.quoteRefs['SHOP (TSX)'] && r.quoteRefs['SHOP (NYSE)'] && r.quoteRefs['SHOP (TSX)'] !== r.quoteRefs['SHOP (NYSE)']);
  r = await toolbox(build(shop, null)).h.explain_portfolio_move({ benchmarks: null });
  const nyse = r.biggestMovers.find((m) => m.label === 'SHOP (NYSE)');
  assert.deepEqual([nyse.dailyPL, nyse.currency, nyse.dailyPLCad], [-500, 'USD', null], 'no rate: the USD leg has no CAD figure');
  assert.equal(r.biggestMovers.find((m) => m.label === 'SHOP (TSX)').dailyPLCad, -770);
  // AT&T (NYSE) and TELUS (TSX) share the ticker T: -700 CAD and +700 CAD stay two movers.
  r = await toolbox(build([
    { symbol: 'T', exchange: 'NYSE', currency: 'USD', price: 20, prev: 25 }, // -500 USD = -700 CAD
    { symbol: 'T', exchange: 'TSX', currency: 'CAD', price: 27, prev: 20 }, // +700 CAD
    { symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', quantity: 10, price: 99, prev: 100 },
  ], 1.4)).h.explain_portfolio_move({ benchmarks: null });
  assert.deepEqual(r.biggestMovers.map((m) => [m.label, m.dailyPLCad]).slice(0, 2).sort(), [['T (NYSE)', -700], ['T (TSX)', 700]]);
  assert.equal(r.attribution.byCurrency.USD.contributions.find((c) => c.symbol === 'T').exchange, 'NYSE');
});

test('latest-session figures that span sessions say which positions are from which session', async () => {
  const ctx = makeCtx();
  const mon = zonedToUtc('2026-10-19', 15, 0);
  hold(ctx, { symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', price: 101, prev: 100, at: mon - 60000 }); // Monday +100
  hold(ctx, { symbol: 'VRT', exchange: 'NYSE', currency: 'USD', price: 130, prev: 120, at: zonedToUtc('2026-10-16', 16, 0) }); // Friday +1000
  const { h } = toolbox(ctx, mon);
  const r = await h.explain_portfolio_move({ benchmarks: null });
  assert.deepEqual(r.sessionsMeasured, ['2026-10-16', '2026-10-19']);
  assert.equal(r.attribution.byCurrency.USD.totalDailyPL, 1100, 'totals stay as documented');
  assert.match(r.sessionNote, /span 2 sessions: 2026-10-19 \(latest\) for NBIS; 2026-10-16 for VRT\. The totals add these moves together/);
  assert.match((await h.get_portfolio({ include_closed: false })).sessionNote, /2026-10-16 for VRT/);

  // Canadian Thanksgiving: the TSX is closed, so XEQT's latest move is Friday's.
  const ctx2 = makeCtx();
  const thx = zonedToUtc('2026-10-12', 15, 0);
  hold(ctx2, { symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', price: 101, prev: 100, at: thx - 60000 });
  hold(ctx2, { symbol: 'XEQT', exchange: 'TSX', currency: 'CAD', price: 31, prev: 30, at: zonedToUtc('2026-10-09', 16, 0) });
  const t = await toolbox(ctx2, thx).h.explain_portfolio_move({ benchmarks: null });
  assert.match(t.sessionNote, /2026-10-12 \(latest\) for NBIS; 2026-10-09 for XEQT/);

  // One session: no note.
  const ctx3 = makeCtx();
  seed(ctx3);
  const one = await toolbox(ctx3).h.explain_portfolio_move({ benchmarks: null });
  assert.equal(one.sessionNote, null);
  assert.equal(one.attribution.sessionNote, null);
});

test('a ticker held in several accounts is reported per account with totals computed in code', async () => {
  const ctx = makeCtx();
  seed(ctx);
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-02', account: 'RRSP', symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', quantity: 100, price: 95, fees: 0 });
  const { h, ledger } = toolbox(ctx);
  const r = await h.get_position({ symbol: 'NBIS' });
  for (const k of ['account', 'shares', 'marketValue', 'unrealizedPL', 'weightPct', 'otherAccountsSameTicker']) assert.equal(k in r, false, `no single-account ${k} at the top level`);
  assert.deepEqual(r.heldInAccounts, ['TFSA', 'RRSP']);
  assert.deepEqual(r.byAccount.map((a) => [a.account, a.shares, a.averageCost, a.marketValue, a.unrealizedPL, a.weightPct]), [['TFSA', 100, 90, 10150, 1150, 47], ['RRSP', 100, 95, 10150, 650, 47]]);
  const [c] = r.combinedTotals;
  assert.deepEqual([c.currency, c.totalShares, c.combinedMarketValue, c.combinedUnrealizedPL, c.combinedAverageCost, c.combinedWeightPct], ['USD', 200, 20300, 1800, 92.5, 94]);
  for (const ref of [r.ref, ...r.byAccount.map((a) => a.ref), c.ref, r.quoteRef]) assert.ok(ledger.has(ref), ref);
  assert.equal(ledger.get(c.ref).kind, 'calculation');

  // One account: the record keeps its single-holding shape.
  const v = await h.get_position({ symbol: 'VRT' });
  assert.deepEqual([v.account, v.shares, v.byAccount, v.otherAccountsSameTicker], ['TFSA', 10, undefined, []]);

  // Two listings of one ticker: a total per listing and currency, never added together.
  const ctx2 = makeCtx();
  fx(ctx2, 1.4, '2026-10-20');
  hold(ctx2, { symbol: 'SHOP', exchange: 'TSX', currency: 'CAD', account: 'TFSA', price: 140, prev: 147 });
  hold(ctx2, { symbol: 'SHOP', exchange: 'NYSE', currency: 'USD', account: 'RRSP', quantity: 50, price: 100, prev: 105 });
  const s = await toolbox(ctx2).h.get_position({ symbol: 'SHOP' });
  assert.deepEqual(s.combinedTotals.map((x) => [x.exchange, x.currency, x.totalShares, x.combinedMarketValue]), [['TSX', 'CAD', 100, 14000], ['NYSE', 'USD', 50, 5000]]);
  assert.equal(s.combinedTotals[0].combinedWeightPct + s.combinedTotals[1].combinedWeightPct, 100);
  assert.match(s.listingsNote, /several listings \(TSX, CAD; NYSE, USD\)/);
  assert.ok(s.byAccount[0].quoteRef && s.byAccount[1].quoteRef && s.byAccount[0].quoteRef !== s.byAccount[1].quoteRef, 'each listing\'s quote is its own source');
});

test('news refresh skips holdings whose identity is unconfirmed and does not tie stored items to them', async () => {
  const ctx = makeCtx();
  seed(ctx);
  addTransaction(ctx.db, { type: 'BASELINE', trade_date: '2026-03-01', account: 'TFSA', symbol: 'SPCX', exchange: 'NASDAQ', currency: 'USD', quantity: 10, price: 20, fees: 0 });
  assert.equal(findInstrument(ctx.db, 'SPCX', 'NASDAQ').identity_status, 'needs_confirmation');
  const fetched = [];
  ctx.providers.finnhub = { name: 'stub', async getNews(sym) { fetched.push(`news:${sym}`); return [{ title: `${sym} headline`, summary: 's', url: `https://example.com/${sym}`, source_name: 'Reuters', published_at: new Date(NOW - 3600000).toISOString(), related: [sym], provider: 'Finnhub' }]; } };
  ctx.providers.sec = { name: 'sec', async getFilings(sym) { fetched.push(`sec:${sym}`); return []; } };
  const { h } = toolbox(ctx);
  const all = await h.get_news({ symbols: null, hours: 24, refresh: true, min_importance: 1 });
  assert.deepEqual(fetched.sort(), ['news:NBIS', 'news:VRT', 'sec:NBIS', 'sec:VRT']);
  assert.deepEqual(all.coverage.find((c) => c.symbol === 'SPCX'), { symbol: 'SPCX', covered: false, reason: 'identity not confirmed' });
  assert.ok(all.items.every((i) => !i.symbols.includes('SPCX')));

  // Asked by name: still not fetched; an item stored earlier is shown but not as affecting the holding.
  storeNews(ctx.db, [{ title: 'SPCX old headline', summary: 's', url: 'https://example.com/spcx-old', source_name: 'Blog', published_at: new Date(NOW - 7200000).toISOString(), related: ['SPCX'], provider: 'test' }], { now: NOW });
  fetched.length = 0;
  const one = await toolbox(ctx).h.get_news({ symbols: ['SPCX'], hours: 24, refresh: true, min_importance: 1 });
  assert.deepEqual(fetched, []);
  assert.equal(one.coverage[0].reason, 'identity not confirmed');
  assert.deepEqual(one.items.map((i) => [i.title.untrusted_text, i.affectsHoldings]), [['SPCX old headline', []]]);
  assert.match(one.items[0].flags.at(-1), /identity is not confirmed/);
  const again = await toolbox(ctx).h.get_news({ symbols: null, hours: 24, refresh: false, min_importance: 1 });
  assert.ok(again.items.every((i) => !i.symbols.includes('SPCX')), 'not listed among holdings news');
});

test('chained legs: usual fees on every leg, and a conversion of the earlier proceeds', async () => {
  const ctx = makeCtx();
  seed(ctx);
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-05', account: 'TFSA', symbol: 'XEQT', exchange: 'TSX', currency: 'CAD', quantity: 100, price: 30, fees: 4.99 });
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-06', account: 'TFSA', symbol: 'VRT', exchange: 'NYSE', currency: 'USD', quantity: 1, price: 125, fees: 4.99 });
  updateInstrument(ctx.db, findInstrument(ctx.db, 'XEQT', 'TSX').id, { identity_status: 'confirmed', identity_note: 't' });
  putQuote(ctx.db, findInstrument(ctx.db, 'XEQT', 'TSX').id, { price: 32, prev_close: 31.8, quote_time: new Date(NOW - 60000).toISOString() });
  setCash(ctx.db, { account: 'TFSA', currency: 'CAD', amount: 100, asOf: '2026-10-20', confirmed: true });
  const { h } = toolbox(ctx);
  const sells = [{ side: 'sell', symbol: 'NBIS', fraction: 0.2 }, { side: 'sell', symbol: 'VRT', fraction: 0.2 }];
  const plan = await h.simulate_trades({ legs: sells });
  const withFees = await h.simulate_trades({ legs: sells.map((l) => ({ ...l, fees: 4.99 })) });
  assert.equal(withFees.cashChanges['TFSA USD'].after, 2530.02);
  assert.equal(plan.cashChanges['TFSA USD'].after, 2540, 'before fees');
  assert.equal(plan.legs[1].ifTypicalFee.cashAfter, 2530.02, 'the earlier leg\'s usual fee is counted too');
  assert.deepEqual(plan.ifTypicalFee.cashChanges['TFSA USD'], { before: 250, after: 2530.02, change: 2280.02 });
  assert.deepEqual(plan.ifTypicalFee.feesCharged.map((f) => [f.leg, f.fee]), [[1, 4.99], [2, 4.99]]);
  const funded = await h.simulate_trades({ legs: [{ side: 'sell', symbol: 'NBIS', shares: 10 }, { side: 'buy', symbol: 'VRT', cash_amount: 'available_cash' }] });
  assert.equal(funded.legs[1].ifTypicalFee.cashAfter, 85.02);
  assert.equal(funded.ifTypicalFee.cashChanges['TFSA USD'].after, 85.02);
  assert.match(funded.legs[1].cashAmountSource, /1265 USD available in TFSA at this step, before fees/);

  // Sell XEQT, convert what it raised, buy NBIS with the result: one call.
  const chain = await h.simulate_trades({ legs: [{ side: 'sell', symbol: 'XEQT', fraction: 1 }, { side: 'convert', from_currency: 'CAD', to_currency: 'USD', amount: 'proceeds' }, { side: 'buy', symbol: 'NBIS', cash_amount: 'proceeds' }] });
  assert.equal(chain.legs[1].amount, 3200);
  assert.match(chain.legs[1].cashAmountSource, /3200 CAD raised by the earlier legs, before fees/);
  const numeric = await h.simulate_trades({ legs: [{ side: 'sell', symbol: 'XEQT', fraction: 1 }, { side: 'convert', from_currency: 'CAD', to_currency: 'USD', amount: 3200 }, { side: 'buy', symbol: 'NBIS', cash_amount: 'proceeds' }] });
  assert.deepEqual(chain.cashChanges, numeric.cashChanges);
  assert.deepEqual(chain.ifTypicalFee.cashChanges['TFSA CAD'], { before: 100, after: 95.01, change: -4.99 });
  await assert.rejects(h.simulate_trades({ legs: [{ side: 'convert', from_currency: 'CAD', to_currency: 'USD', amount: 'all', account: 'TFSA' }] }), /Leg 1: Conversion amount must be a positive number, "proceeds" or "available_cash"/);
  await assert.rejects(h.simulate_trades({ legs: [{ side: 'convert', from_currency: 'USD', to_currency: 'CAD', amount: 'proceeds' }] }), /earlier legs add no USD cash to TFSA/);

  // A plan that spends all the cash before fees would go negative with them.
  const p = computePortfolio(ctx.db, { now: NOW, catalog: ctx.catalog });
  const tight = simulateTrades(p, [{ side: 'buy', symbol: 'VRT', shares: 1, price: 250, account: 'TFSA' }], () => ({ typicalFee: 4.99 }));
  assert.equal(tight.cashChanges['TFSA USD'].after, 0);
  assert.ok(tight.warnings.some((w) => /With your usual fees, TFSA USD cash would end at -4.99/.test(w)));
});

test('the currency effect is shown only for consecutive Bank of Canada rates into the session', async () => {
  const after = zonedToUtc('2026-10-21', 17, 30);
  const move = async (rates, now = after, quoteAt = zonedToUtc('2026-10-21', 16, 0)) => {
    const ctx = makeCtx();
    seed(ctx);
    ctx.db.prepare('DELETE FROM fx_rates').run();
    for (const [d, r] of rates) fx(ctx, r, d);
    setCash(ctx.db, { account: 'TFSA', currency: 'USD', amount: 50000, asOf: '2026-10-20', confirmed: true });
    putQuote(ctx.db, findInstrument(ctx.db, 'NBIS', 'NASDAQ').id, { price: 101.5, prev_close: 104, quote_time: new Date(quoteAt).toISOString() });
    putQuote(ctx.db, findInstrument(ctx.db, 'VRT', 'NYSE').id, { price: 130, prev_close: 128, quote_time: new Date(quoteAt).toISOString() });
    return (await toolbox(ctx, now).h.explain_portfolio_move({ benchmarks: null })).attribution.fx;
  };
  // App off Monday and Tuesday: 10-16 to 10-21 is a three-day move, not this session's.
  const gap = await move([['2026-10-16', 1.381], ['2026-10-21', 1.388]]);
  assert.equal(gap.unavailable, true);
  assert.match(gap.note, /rates for 2026-10-19, 2026-10-20 in between are not stored/);
  const day = await move([['2026-10-16', 1.381], ['2026-10-20', 1.3895], ['2026-10-21', 1.388]]);
  assert.deepEqual([day.from.asOf, day.to.asOf, day.approxEffectOnUsdCashInCad], ['2026-10-20', '2026-10-21', -75]);
  // A weekend, or a Canadian holiday (Thanksgiving 2026-10-12), is not a gap.
  const mon = await move([['2026-10-16', 1.381], ['2026-10-19', 1.385]], zonedToUtc('2026-10-19', 17, 30), zonedToUtc('2026-10-19', 16, 0));
  assert.equal(mon.from.asOf, '2026-10-16');
  const tue = await move([['2026-10-09', 1.37], ['2026-10-13', 1.375]], zonedToUtc('2026-10-13', 17, 30), zonedToUtc('2026-10-13', 16, 0));
  assert.equal(tue.from.asOf, '2026-10-09');
  // On the holiday itself the Bank of Canada publishes no rate.
  const hol = await move([['2026-10-08', 1.36], ['2026-10-09', 1.37]], zonedToUtc('2026-10-12', 17, 30), zonedToUtc('2026-10-12', 16, 0));
  assert.match(hol.note, /publishes no USD\/CAD rate for 2026-10-12/);
  const only = await move([['2026-10-21', 1.388]]);
  assert.match(only.note, /No USD\/CAD rate before 2026-10-21 is stored/);
});

test('a position bought after its quote\'s session is not listed as having no previous close', () => {
  const ctx = makeCtx();
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-21', account: 'TFSA', symbol: 'NBIS', exchange: 'NASDAQ', currency: 'USD', quantity: 10, price: 105, fees: 0 });
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-01', account: 'TFSA', symbol: 'VRT', exchange: 'NYSE', currency: 'USD', quantity: 10, price: 100, fees: 0 });
  addTransaction(ctx.db, { type: 'BUY', trade_date: '2026-10-01', account: 'TFSA', symbol: 'AAPL', exchange: 'NASDAQ', currency: 'USD', quantity: 1, price: 200, fees: 0 });
  putQuote(ctx.db, findInstrument(ctx.db, 'NBIS', 'NASDAQ').id, { price: 105, prev_close: 95, quote_time: zonedToUtc('2026-10-20', 16, 0).toISOString() });
  putQuote(ctx.db, findInstrument(ctx.db, 'VRT', 'NYSE').id, { price: 130, prev_close: 128, quote_time: zonedToUtc('2026-10-20', 16, 0).toISOString() });
  putQuote(ctx.db, findInstrument(ctx.db, 'AAPL', 'NASDAQ').id, { price: 240, quote_time: zonedToUtc('2026-10-20', 16, 0).toISOString() });
  const p = computePortfolio(ctx.db, { now: zonedToUtc('2026-10-21', 8, 30) });
  assert.match(p.positions.find((x) => x.symbol === 'NBIS').dailyPLNote, /Not held during the 2026-10-20 session/);
  const a = dailyAttribution(p, { fxPrev: null, sessionDate: '2026-10-20' }).byCurrency.USD;
  assert.deepEqual(a.noPreviousClose, ['AAPL']);
  assert.deepEqual(a.notHeldDuringSession, ['NBIS']);
  assert.deepEqual(a.contributions.map((c) => c.symbol), ['VRT']);
});
