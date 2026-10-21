// Hypothetical trade and impact arithmetic for the chat agent. Pure functions:
// they read a computed portfolio and return scenarios; they never touch stored
// records. Every figure the agent states about a hypothetical comes from here.
import { round, WEIGHT_BASIS } from '../portfolio.js';
import { isTradingDay, easterSunday } from '../calendar.js';
import { formatNy, addDays } from '../time.js';

const EPS = 1e-9;
const FRACTION_STEP = 1e-4; // fractional-share precision used by brokers

export { WEIGHT_BASIS };
export const WEIGHT_BASIS_CCY = 'Share of priced holdings in the same currency (no USD/CAD rate stored)';

function isWhole(n) {
  return Math.abs(n - Math.round(n)) < 1e-9;
}
function floorStep(x, whole) {
  return whole ? Math.floor(x + EPS) : Math.floor(x / FRACTION_STEP + EPS) * FRACTION_STEP;
}
function ceilStep(x, whole) {
  return whole ? Math.ceil(x - EPS) : Math.ceil(x / FRACTION_STEP - EPS) * FRACTION_STEP;
}

// Resolve the execution price used for a scenario. A user-specified price is
// labelled as such; otherwise the latest stored quote is an *estimate*.
export function resolvePrice({ price, quote }) {
  if (price != null) {
    if (!(Number(price) > 0)) throw new Error('Price must be a positive number');
    return { price: Number(price), basis: 'price you specified', userSpecified: true, quote: null };
  }
  if (!quote || quote.price == null) {
    throw new Error('No current quote is available for this instrument, so a scenario price cannot be estimated. Provide an assumed price.');
  }
  return {
    price: quote.price,
    basis: `last ${quote.freshness && quote.freshness !== 'fresh' ? `${String(quote.freshness).toUpperCase()} ` : ''}quote from ${quote.provider} at ${quote.quoteTime ? formatNy(quote.quoteTime) : 'unknown time'}${quote.timeliness ? ` (${quote.timeliness}${quote.delayMinutes ? `, ${quote.delayMinutes} min delay` : ''})` : ''}`,
    userSpecified: false,
    stale: quote.freshness !== 'fresh',
    quote: { provider: quote.provider, quoteTime: quote.quoteTime, freshness: quote.freshness, timeliness: quote.timeliness },
  };
}

function resolveFees(fees, typicalFee) {
  if (fees == null) {
    return {
      fees: 0, known: false, typical: typicalFee ?? null,
      note: `Commission not specified, so net figures are not given: amounts are shown before fees.${typicalFee != null ? ` Your most recent recorded trades in this account had a fee of about ${typicalFee}; the "with your usual fee" figures show the result with it.` : ''} Your brokerage may also charge currency-conversion or regulatory fees.`,
    };
  }
  if (!(Number(fees) >= 0)) throw new Error('Fees cannot be negative');
  return { fees: Number(fees), known: true, note: 'Fees as you specified.' };
}

// Cash recorded for one account and currency (never pooled across accounts).
export function cashFor(portfolio, account, currency) {
  const row = (portfolio.cash || []).find((c) => c.account === account && c.currency === currency);
  if (!row) return { known: false, amount: null, confirmed: false, asOf: null };
  return { known: true, amount: row.amount, confirmed: !!row.confirmed, asOf: row.as_of };
}

function accountsKnown(portfolio) {
  return [...new Set([...(portfolio.positions || []).map((p) => p.account), ...(portfolio.cash || []).map((c) => c.account)])];
}

function toCadRate(portfolio, currency) {
  if (currency === 'CAD') return 1;
  return portfolio.combined?.fxRate ?? null;
}

// Weight helpers on the app's basis. Values in CAD when an FX rate exists,
// otherwise within the trade currency.
function weightContext(portfolio, currency) {
  if (portfolio.combined) return { basis: WEIGHT_BASIS, total: portfolio.combined.marketValue, rate: toCadRate(portfolio, currency) };
  return { basis: WEIGHT_BASIS_CCY, total: portfolio.totals[currency].marketValue, rate: 1 };
}

function taxNote(account) {
  return `Taxes are not estimated. They depend on the account (${account || 'unspecified'}) — registered accounts such as a TFSA or RRSP are generally tax-sheltered, while gains in non-registered accounts can be taxable — and on your other gains, losses and timing.`;
}

export function simulateTrade(portfolio, req) {
  const symbol = String(req.symbol || '').toUpperCase();
  const side = req.side;
  if (!['sell', 'buy'].includes(side)) throw new Error('side must be "sell" or "buy"');
  const sizeInputs = ['shares', 'fraction', 'cash_amount', 'target_weight_pct'].filter((k) => req[k] != null);
  if (sizeInputs.length !== 1) throw new Error('Give exactly one of shares, fraction, cash_amount or target_weight_pct.');
  const sameSymbol = portfolio.positions.filter((p) => p.symbol === symbol);
  let account = req.account || null;
  if (account && !accountsKnown(portfolio).includes(account) && !(portfolio.accounts || []).includes(account)) {
    throw new Error(`Unknown account "${account}". Known accounts: ${accountsKnown(portfolio).join(', ') || 'none recorded'}.`);
  }
  if (!account) {
    if (sameSymbol.length === 1) account = sameSymbol[0].account;
    else if (sameSymbol.length > 1) throw new Error(`${symbol} is held in more than one account (${sameSymbol.map((c) => c.account).join(', ')}); specify the account.`);
    else {
      const accts = accountsKnown(portfolio);
      if (accts.length === 1) account = accts[0];
      else if (side === 'buy') throw new Error(`Specify which account would buy ${symbol} (${accts.join(', ') || 'no accounts recorded'}).`);
    }
  }
  const pos = sameSymbol.find((p) => p.account === account) || null;
  if (side === 'sell' && !pos) throw new Error(`No open position in ${symbol}${account ? ` in ${account}` : ''} to sell.`);
  // A ticker not held now is checked against the user's own instrument record, if any.
  const identity = pos ? pos.identityStatus : req.identityStatus;
  if (identity && identity !== 'confirmed' && req.price == null) {
    throw new Error(`${symbol}'s instrument identity is not confirmed, so it has no trusted quote. Confirm it first or give an assumed price.`);
  }
  const currency = pos?.currency || sameSymbol[0]?.currency || req.currency;
  if (!currency) throw new Error(`Not holding ${symbol}; its trading currency is unknown.`);
  const quote = pos?.quote?.price != null ? pos.quote : sameSymbol.find((p) => p.quote?.price != null)?.quote || req.quote || null;
  const px = resolvePrice({ price: req.price, quote });
  const fee = resolveFees(req.fees, req.typicalFee ?? null);
  const cash = cashFor(portfolio, account, currency);
  const wc = weightContext(portfolio, currency);
  const whole = pos ? isWhole(pos.shares) : true;
  const valuePrice = pos?.price ?? px.price; // holdings are valued at the current quote
  const notes = [];
  if (px.stale) notes.push('The quote used is not fresh; the real price may be materially different.');
  notes.push(px.userSpecified ? 'Uses the price you specified; a real order may fill at a different price.' : 'Execution price is an estimate. A real order may fill at a different price, especially for market orders, wide spreads or outside regular hours.');
  notes.push(taxNote(account));
  if (!fee.known) notes.push(fee.note);

  // Current position value on the weight basis (unpriced positions use the scenario price).
  const posValue = pos ? (pos.marketValue ?? pos.shares * px.price) : 0;
  const unpriced = pos && pos.marketValue == null;
  const totalBefore = wc.total + (unpriced ? posValue * (wc.rate ?? 1) : 0);
  if (unpriced) notes.push('This position has no trusted quote; its weight uses the price in this scenario.');
  // One decimal, the same rounding as Positions.
  const weight = (value, total) => (wc.rate != null && total > 0 ? round(((value * wc.rate) / total) * 100, 1) : null);

  if (side === 'sell') {
    let shares;
    if (req.shares != null) shares = Number(req.shares);
    else if (req.fraction != null) {
      const f = Number(req.fraction);
      if (!(f > 0 && f <= 1)) throw new Error('fraction must be between 0 and 1 (e.g. 0.2 for 20%)');
      if (f === 1) shares = pos.shares;
      else {
        const raw = pos.shares * f;
        shares = round(floorStep(raw, whole), 6);
        if (Math.abs(shares - raw) > EPS) notes.push(`${round(f * 100, 2)}% of ${pos.shares} shares is ${round(raw, 4)}; rounded down to ${shares} ${whole ? 'whole ' : ''}share${shares === 1 ? '' : 's'}.`);
      }
    } else if (req.cash_amount != null) {
      const target = Number(req.cash_amount);
      if (!(target > 0)) throw new Error('cash_amount must be positive');
      const need = (target + fee.fees) / px.price;
      if (need > pos.shares + EPS) throw new Error(`Raising ${round(target)} ${currency} needs about ${round(need, 2)} shares at ${round(px.price, 4)}, but the position holds ${pos.shares}; selling all of it raises about ${round(pos.shares * px.price - fee.fees)} ${currency}${fee.known ? '' : ' before fees'}.`);
      shares = Math.min(pos.shares, round(ceilStep(need, whole), 6));
      notes.push(`Shares needed to raise about ${round(target)} ${currency} after fees, rounded up.`);
    } else {
      const t = Number(req.target_weight_pct) / 100;
      if (!(t >= 0 && t < 1)) throw new Error('target_weight_pct must be between 0 and 100');
      if (wc.rate == null) throw new Error('A target weight needs a USD/CAD rate to compare across currencies.');
      const V = posValue * wc.rate, M = totalBefore;
      if (V / M <= t + EPS) throw new Error(`${symbol} is already at or below ${round(t * 100, 2)}% (${round((V / M) * 100, 2)}%).`);
      const soldValue = (V - t * M) / (1 - t);
      shares = Math.min(pos.shares, round(ceilStep(soldValue / (valuePrice * wc.rate), whole), 6));
      notes.push(`Smallest ${whole ? 'whole-share ' : ''}sale that brings the weight to ${round(t * 100, 2)}% or below on the app's basis, valuing holdings at the current price.`);
    }
    if (!(shares > 0)) throw new Error('The scenario sells zero shares (position too small for that size).');
    if (shares > pos.shares + EPS) throw new Error(`Cannot sell ${shares} shares; the position holds ${pos.shares}.`);
    const gross = shares * px.price;
    const net = gross - fee.fees; // before fees when fees are unknown
    const avg = pos.avgCostExact ?? pos.avgCost;
    const costOfSold = avg * shares;
    const withTypical = !fee.known && fee.typical != null ? gross - fee.typical : null;
    const remaining = round(pos.shares - shares, 6);
    const remainingValue = remaining * valuePrice;
    const totalAfter = totalBefore - (posValue - remainingValue) * (wc.rate ?? 1);
    if (!cash.known) notes.push(`No ${currency} cash balance is recorded for ${account}, so the balance after the sale is unknown; proceeds would add ${round(net)} ${currency}${fee.known ? '' : ' before fees'}.`);
    else if (!cash.confirmed) notes.push(`${account}'s recorded ${currency} cash (${round(cash.amount)}) is unconfirmed.`);
    if (pos.hasBaseline) notes.push('Average cost comes from a dated snapshot; realized P/L for tax purposes may differ from the cost base your brokerage reports.');
    const fx = portfolio.combined?.fxRate ?? null;
    return {
      kind: 'hypothetical', side, symbol, exchange: pos.exchange, account, currency,
      shares, sharesBefore: pos.shares, sharesAfter: remaining,
      price: round(px.price, 4), priceBasis: px.basis, priceUserSpecified: px.userSpecified,
      grossProceeds: round(gross), fees: fee.known ? round(fee.fees) : null, feesKnown: fee.known,
      netProceeds: fee.known ? round(net) : null, proceedsBeforeFees: fee.known ? null : round(gross),
      averageCost: round(avg, 4), costBasisSold: round(costOfSold),
      estimatedRealizedPL: fee.known ? round(net - costOfSold) : null, estimatedRealizedPLBeforeFees: fee.known ? null : round(gross - costOfSold),
      realizedPLNote: 'Gain or loss on the shares sold against your average cost (buy fees included), after this sale\'s fees when known, before tax.',
      remainingCostBasis: round(avg * remaining), remainingMarketValue: round(remainingValue),
      cashAccount: account, cashBefore: cash.known ? round(cash.amount) : null,
      cashAfter: cash.known && fee.known ? round(cash.amount + net) : null, cashAfterBeforeFees: cash.known && !fee.known ? round(cash.amount + gross) : null,
      cashConfirmed: cash.confirmed, cashFreed: fee.known ? round(net) : null,
      ifTypicalFee: withTypical != null ? { fee: fee.typical, netProceeds: round(withTypical), cashAfter: cash.known ? round(cash.amount + withTypical) : null, estimatedRealizedPL: round(withTypical - costOfSold) } : null,
      cadEquivalentOfProceeds: currency === 'USD' && fx ? { amount: round(net * fx), fxRate: fx, fxAsOf: portfolio.combined.fxAsOf, fxSource: portfolio.combined.fxSource, note: 'Informational: proceeds stay in USD unless you convert them; conversion costs are not included.' } : null,
      weightBeforePct: weight(posValue, totalBefore), weightAfterPct: weight(remainingValue, totalAfter), weightBasis: wc.basis,
      taxes: 'not estimated',
      notes,
    };
  }

  // ---- buy ----
  if (!cash.known) notes.push(`No ${currency} cash balance is recorded for ${account}; Signal Desk does not assume you can add money.`);
  let shares;
  if (req.shares != null) shares = Number(req.shares);
  else if (req.cash_amount != null) {
    const amt = Number(req.cash_amount);
    if (!(amt > 0)) throw new Error('cash_amount must be positive');
    shares = round(floorStep((amt - fee.fees) / px.price, whole), 6);
    notes.push(`${whole ? 'Whole shares' : 'Shares'} affordable with ${round(amt)} ${currency} after fees.`);
  } else if (req.fraction != null) {
    if (!pos) throw new Error('fraction for a buy is relative to an existing position; use shares or cash_amount.');
    shares = round(floorStep(pos.shares * Number(req.fraction), whole), 6);
    notes.push(`Adds ${round(Number(req.fraction) * 100, 2)}% to the current share count, rounded down.`);
  } else {
    const t = Number(req.target_weight_pct) / 100;
    if (!(t > 0 && t < 1)) throw new Error('target_weight_pct must be between 0 and 100');
    if (wc.rate == null) throw new Error('A target weight needs a USD/CAD rate to compare across currencies.');
    const V = posValue * wc.rate, M = totalBefore;
    if (V / (M || 1) >= t - EPS) throw new Error(`${symbol} is already at or above ${round(t * 100, 2)}%.`);
    const addValue = (t * M - V) / (1 - t);
    shares = round(floorStep(addValue / (valuePrice * wc.rate), whole), 6);
    notes.push(`Largest ${whole ? 'whole-share ' : ''}purchase that keeps the weight at or below ${round(t * 100, 2)}% on the app's basis.`);
  }
  if (!(shares > 0)) throw new Error('The scenario buys zero shares at that price.');
  const cost = shares * px.price + fee.fees; // before fees when fees are unknown
  const shortfall = cash.known ? Math.max(0, cost - cash.amount) : null;
  const affordable = cash.known && cash.confirmed && shortfall <= EPS;
  const withTypical = !fee.known && fee.typical != null ? cost + fee.typical : null;
  if (cash.known && shortfall > EPS) notes.push(`This costs ${round(cost)} ${currency}${fee.known ? '' : ' before fees'} but ${account}'s recorded ${currency} cash is ${round(cash.amount)}: short by ${round(shortfall)}. It would require new money, selling something, or a currency conversion; margin is never assumed.`);
  if (cash.known && !cash.confirmed) notes.push(`${account}'s recorded ${currency} cash is unconfirmed, so affordability is not confirmed.`);
  const newShares = round((pos?.shares || 0) + shares, 6);
  const newCost = (pos ? (pos.avgCostExact ?? pos.avgCost) * pos.shares : 0) + cost;
  const addedValue = shares * valuePrice;
  const fx = portfolio.combined?.fxRate ?? null;
  return {
    kind: 'hypothetical', side, symbol, exchange: pos?.exchange || sameSymbol[0]?.exchange || req.exchange || null, account, currency,
    shares, sharesBefore: pos?.shares || 0, sharesAfter: newShares,
    price: round(px.price, 4), priceBasis: px.basis, priceUserSpecified: px.userSpecified,
    totalCost: fee.known ? round(cost) : null, costBeforeFees: fee.known ? null : round(cost), fees: fee.known ? round(fee.fees) : null, feesKnown: fee.known,
    newAverageCost: round(newCost / newShares, 4), previousAverageCost: pos ? round(pos.avgCostExact ?? pos.avgCost, 4) : null,
    cashAccount: account, cashBefore: cash.known ? round(cash.amount) : null,
    cashAfter: cash.known && fee.known ? round(cash.amount - cost) : null, cashAfterBeforeFees: cash.known && !fee.known ? round(cash.amount - cost) : null, cashConfirmed: cash.confirmed,
    affordableWithConfirmedCash: affordable, cashShortfall: shortfall != null ? round(shortfall) : null,
    affordability: !cash.known ? `Unknown: no ${currency} cash is recorded for ${account}.` : shortfall > EPS ? `No: short by ${round(shortfall)} ${currency}${fee.known ? '' : ' before fees'}.` : !cash.confirmed ? `Not confirmed: the recorded cash covers it${fee.known ? '' : ' before fees'}, but that balance is unconfirmed.` : `Yes${fee.known ? '' : ', before fees'}.`,
    ifTypicalFee: withTypical != null ? { fee: fee.typical, totalCost: round(withTypical), cashAfter: cash.known ? round(cash.amount - withTypical) : null } : null,
    cadEquivalentOfCost: currency === 'USD' && fx ? { amount: round(cost * fx), fxRate: fx, fxAsOf: portfolio.combined.fxAsOf, fxSource: portfolio.combined.fxSource } : null,
    weightBeforePct: weight(posValue, totalBefore), weightAfterPct: weight(posValue + addedValue, totalBefore + addedValue * (wc.rate ?? 1)), weightBasis: wc.basis,
    taxes: 'not applicable to a purchase; future gains depend on the account',
    notes,
  };
}

// Apply a scenario to a working copy of the portfolio so several legs can be
// chained (e.g. sell one holding, convert currency, buy another).
function applyToPortfolio(p, sc) {
  const out = { ...p, positions: p.positions.map((x) => ({ ...x })), cash: (p.cash || []).map((c) => ({ ...c })), totals: JSON.parse(JSON.stringify(p.totals)), combined: p.combined ? { ...p.combined } : null };
  const rate = toCadRate(out, sc.currency);
  const posIdx = out.positions.findIndex((x) => x.symbol === sc.symbol && x.account === sc.account);
  const valuePrice = posIdx >= 0 ? (out.positions[posIdx].price ?? sc.price) : sc.price;
  const deltaShares = sc.side === 'sell' ? -sc.shares : sc.shares;
  const deltaValue = deltaShares * valuePrice;
  const cost = sc.totalCost ?? sc.costBeforeFees;
  // An unpriced position was never in the totals, so changing it leaves them alone.
  let priced = true;
  if (posIdx >= 0) {
    const x = out.positions[posIdx];
    priced = x.marketValue != null;
    const avg = x.avgCostExact ?? x.avgCost;
    x.shares = round(x.shares + deltaShares, 6);
    if (sc.side === 'sell') x.costBasis = avg * x.shares;
    else { x.costBasis = avg * (x.shares - sc.shares) + cost; x.avgCostExact = x.costBasis / x.shares; x.avgCost = round(x.avgCostExact, 4); }
    x.marketValue = priced ? x.shares * valuePrice : null;
    if (x.shares <= EPS) out.positions.splice(posIdx, 1);
  } else if (sc.side === 'buy') {
    out.positions.push({ symbol: sc.symbol, exchange: sc.exchange, account: sc.account, currency: sc.currency, shares: sc.shares, avgCost: sc.newAverageCost, avgCostExact: cost / sc.shares, costBasis: cost, price: sc.price, marketValue: sc.shares * sc.price, quote: { price: sc.price, provider: 'scenario', freshness: 'fresh' }, identityStatus: 'confirmed' });
  }
  if (priced) {
    out.totals[sc.currency].marketValue += deltaValue;
    if (out.combined && rate != null) out.combined.marketValue += deltaValue * rate;
  }
  const cashDelta = sc.side === 'sell' ? (sc.netProceeds ?? sc.proceedsBeforeFees) : -cost;
  const row = out.cash.find((c) => c.account === sc.account && c.currency === sc.currency);
  if (row) row.amount += cashDelta;
  else out.cash.push({ account: sc.account, currency: sc.currency, amount: cashDelta, confirmed: 0, as_of: 'scenario' });
  return out;
}

function applyConversion(p, leg) {
  const rate = p.combined?.fxRate;
  if (!rate) throw new Error('Currency conversion needs a stored USD/CAD rate.');
  const from = String(leg.from_currency || '').toUpperCase(), to = String(leg.to_currency || '').toUpperCase();
  if (!['USD', 'CAD'].includes(from) || !['USD', 'CAD'].includes(to) || from === to) throw new Error('Conversion needs from_currency and to_currency of USD/CAD.');
  const amount = Number(leg.amount);
  if (!(amount > 0)) throw new Error('Conversion amount must be a positive number, "proceeds" or "available_cash".');
  const accts = accountsKnown(p);
  const account = leg.account || (accts.length === 1 ? accts[0] : null);
  if (!account) throw new Error(`Specify which account the conversion happens in (${accts.join(', ') || 'no accounts recorded'}).`);
  if (!accts.includes(account) && !(p.accounts || []).includes(account)) throw new Error(`Unknown account "${account}". Known accounts: ${accts.join(', ')}.`);
  const received = from === 'CAD' ? amount / rate : amount * rate;
  const out = { ...p, cash: (p.cash || []).map((c) => ({ ...c })) };
  const src = out.cash.find((c) => c.account === account && c.currency === from);
  const before = src ? src.amount : null;
  if (src) src.amount -= amount; else out.cash.push({ account, currency: from, amount: -amount, confirmed: 0, as_of: 'scenario' });
  const dst = out.cash.find((c) => c.account === account && c.currency === to);
  if (dst) dst.amount += received; else out.cash.push({ account, currency: to, amount: received, confirmed: 0, as_of: 'scenario' });
  return {
    portfolio: out,
    result: {
      kind: 'hypothetical', side: 'convert', account, fromCurrency: from, toCurrency: to, amount: round(amount), received: round(received),
      rate, rateAsOf: p.combined.fxAsOf, rateSource: p.combined.fxSource,
      sourceCashBefore: before != null ? round(before) : null, sourceCashAfter: before != null ? round(before - amount) : null,
      notes: ['Uses the stored daily reference rate; your brokerage converts at its own rate and usually charges a spread or fee, which is not included.', ...(before != null && before < amount ? [`${account}'s recorded ${from} cash (${round(before)}) is less than the amount converted.`] : [])],
    },
  };
}

// Several legs applied in order; returns each leg and the combined cash effect.
// A buy leg's cash_amount, or a convert leg's amount, may be "proceeds" (cash the
// earlier legs added to that account and currency) or "available_cash" (that
// account's cash at that step), both before any fees not given.
export function simulateTrades(portfolio, legs, extra = () => ({})) {
  if (!Array.isArray(legs) || !legs.length || legs.length > 6) throw new Error('Give 1 to 6 legs.');
  let p = portfolio;
  const results = [];
  const cashOf = (pf, account, currency) => (pf.cash || []).find((c) => c.account === account && c.currency === currency)?.amount ?? 0;
  const fromPlan = (kind, field, account, currency) => {
    const amount = kind === 'proceeds' ? cashOf(p, account, currency) - cashOf(portfolio, account, currency)
      : kind === 'available_cash' ? cashOf(p, account, currency) : NaN;
    if (Number.isNaN(amount)) throw new Error(`${field} must be a number, "proceeds" or "available_cash".`);
    if (!(amount > 0)) throw new Error(kind === 'proceeds' ? `The earlier legs add no ${currency} cash to ${account}; add a sell or convert leg in ${currency} first.` : `${account} has no ${currency} cash available at this step.`);
    const beforeFees = results.some((r) => r.feesKnown === false) ? ', before fees' : '';
    return { amount, source: kind === 'proceeds' ? `the ${round(amount)} ${currency} raised by the earlier legs${beforeFees}` : `the ${round(amount)} ${currency} available in ${account} at this step${beforeFees}` };
  };
  for (const [i, leg] of legs.entries()) {
    try {
      if (leg.side === 'convert') {
        const from = String(leg.from_currency || '').toUpperCase();
        let conv = leg, source = null;
        if (['proceeds', 'available_cash'].includes(leg.amount) && ['USD', 'CAD'].includes(from)) {
          const accts = accountsKnown(p);
          const account = leg.account || (accts.length === 1 ? accts[0] : null);
          if (!account) throw new Error(`Specify which account the conversion happens in (${accts.join(', ') || 'no accounts recorded'}).`);
          const f = fromPlan(leg.amount, 'amount', account, from);
          conv = { ...leg, account, amount: f.amount };
          source = f.source;
        }
        const r = applyConversion(p, conv);
        if (source) r.result.cashAmountSource = source;
        results.push(r.result);
        p = r.portfolio;
        continue;
      }
      const ex = extra(leg) || {};
      let req = { ...leg, ...ex };
      let source = null;
      if (typeof leg.cash_amount === 'string') {
        if (leg.side !== 'buy') throw new Error('"proceeds" and "available_cash" apply to buy and convert legs.');
        const held = p.positions.filter((x) => x.symbol === String(leg.symbol || '').toUpperCase());
        const account = leg.account || (held.length === 1 ? held[0].account : accountsKnown(p).length === 1 ? accountsKnown(p)[0] : null);
        const currency = held[0]?.currency || ex.currency;
        if (!account || !currency) throw new Error('Name the account for this buy leg.');
        const f = fromPlan(leg.cash_amount, 'cash_amount', account, currency);
        req = { ...req, account, cash_amount: f.amount };
        source = f.source;
      }
      const sc = simulateTrade(p, req);
      if (source) sc.cashAmountSource = source;
      // Leg weights would describe the plan half-way through; the final ones are weightsAfter.
      delete sc.weightBeforePct; delete sc.weightAfterPct;
      results.push(sc);
      p = applyToPortfolio(p, sc);
    } catch (e) {
      throw new Error(`Leg ${i + 1}: ${e.message}`);
    }
  }
  // "With your usual fee": every leg without a given commission is charged its
  // account's usual fee, keeping the share counts and amounts above. The earlier
  // legs' fees come out of the same cash, so each leg's cashAfter counts them too.
  const owed = {}; // "account currency" -> usual fees so far, null when a leg has none
  for (const r of results) {
    if (r.side === 'convert' || r.feesKnown) continue;
    const k = `${r.account} ${r.currency}`;
    const sofar = k in owed ? owed[k] : 0;
    if (r.ifTypicalFee?.cashAfter != null) r.ifTypicalFee.cashAfter = sofar == null ? null : round(r.ifTypicalFee.cashAfter - sofar);
    owed[k] = sofar != null && r.ifTypicalFee ? sofar + r.ifTypicalFee.fee : null;
  }
  // Every cash balance in the accounts the plan touches, changed or not.
  const accounts = new Set(results.map((r) => r.account).filter(Boolean));
  const cashChanges = {};
  const typicalCash = {};
  for (const c of p.cash.filter((x) => accounts.has(x.account))) {
    const k = `${c.account} ${c.currency}`;
    const before = (portfolio.cash || []).find((x) => x.account === c.account && x.currency === c.currency);
    cashChanges[k] = { before: before ? round(before.amount) : null, after: before ? round(c.amount) : null, change: round(c.amount - (before ? before.amount : 0)) };
    const fees = k in owed ? owed[k] : 0;
    typicalCash[k] = { before: cashChanges[k].before, after: before && fees != null ? round(c.amount - fees) : null, change: fees != null ? round(c.amount - (before ? before.amount : 0) - fees) : null };
  }
  const charged = results.map((r, i) => (r.side !== 'convert' && !r.feesKnown && r.ifTypicalFee ? { leg: i + 1, symbol: r.symbol, fee: r.ifTypicalFee.fee } : null)).filter(Boolean);
  const ifTypicalFee = charged.length ? {
    feesCharged: charged, cashChanges: typicalCash,
    note: 'The whole plan with your usual recent fee charged on each leg that has no commission given (same share counts and amounts as the legs above). A balance is null when a leg in it has no fee history.',
  } : null;
  const weights = (pf) => (pf.combined
    ? pf.positions.filter((x) => x.marketValue != null).map((x) => ({ symbol: x.symbol, account: x.account, weightPct: round(((x.marketValue * toCadRate(pf, x.currency)) / pf.combined.marketValue) * 100, 1) }))
    : null);
  // A negative balance means the plan needs money the records don't show.
  const warnings = p.cash.filter((c) => c.amount < -0.005).map((c) => `${c.account} ${c.currency} cash would end at ${round(c.amount)}: the plan needs ${round(-c.amount)} ${c.currency} more than the recorded balance (new money, another sale or a conversion). Margin is never assumed.`);
  if (results.some((r) => r.feesKnown === false)) warnings.push('Some legs have no commission given, so their cash figures are before fees.');
  for (const [k, c] of Object.entries(typicalCash)) {
    if (ifTypicalFee && c.after != null && c.after < -0.005 && !(cashChanges[k].after < -0.005)) warnings.push(`With your usual fees, ${k} cash would end at ${c.after}: the plan would need ${round(-c.after)} ${k.split(' ').at(-1)} more than the recorded balance.`);
  }
  return { kind: 'hypothetical', legs: results, cashChanges, ifTypicalFee, warnings, weightsBefore: weights(portfolio), weightsAfter: weights(p), weightBasis: p.combined ? WEIGHT_BASIS : null, savedToRecords: false };
}

// What a price move would do to positions (and the portfolio), e.g. an
// earnings gap. Purely arithmetic on current holdings.
export function priceMoveImpact(portfolio, { symbol, moves_pct: movesPct, price }) {
  const sym = String(symbol || '').toUpperCase();
  const ps = portfolio.positions.filter((p) => p.symbol === sym);
  if (!ps.length) throw new Error(`No open position in ${sym}.`);
  const p0 = ps[0];
  const base = p0.price ?? null;
  if (base == null) throw new Error(`${sym} has no current quote, so a move cannot be measured.`);
  const moves = price != null ? [((Number(price) / base) - 1) * 100] : (movesPct?.length ? movesPct : [-15, -10, -5, 5, 10, 15]).slice(0, 8).map(Number);
  const rate = toCadRate(portfolio, p0.currency);
  const shares = ps.reduce((s, x) => s + x.shares, 0);
  const cost = ps.reduce((s, x) => s + x.costBasis, 0);
  const mv = shares * base;
  const totalCad = portfolio.combined?.marketValue ?? null;
  return {
    kind: 'hypothetical', symbol: sym, currency: p0.currency, shares: round(shares, 6), currentPrice: base, priceSource: p0.quote ? `${p0.quote.provider} at ${p0.quote.quoteTime ? formatNy(p0.quote.quoteTime) : 'unknown time'} (${p0.quote.freshness})` : null,
    currentMarketValue: round(mv), unrealizedPLNow: round(mv - cost),
    // The price at which this holding's unrealized P/L would be zero.
    breakEven: shares > 0 ? { averageCost: round(cost / shares, 4), movePctFromCurrent: round(((cost / shares) / base - 1) * 100, 2) } : null,
    impactBasis: totalCad && rate != null
      ? `portfolioImpactPct = change in value in CAD (at the stored rate ${rate}) as a % of the CAD-equivalent value of priced holdings (${round(totalCad)} CAD), excluding cash and unpriced positions.`
      : null,
    scenarios: moves.map((m) => {
      const np = base * (1 + m / 100);
      const nmv = shares * np;
      return {
        movePct: round(m, 2), price: round(np, 4), marketValue: round(nmv), valueChange: round(nmv - mv),
        valueChangeCad: rate != null ? round((nmv - mv) * rate) : null, unrealizedPL: round(nmv - cost),
        portfolioImpactPct: totalCad && rate != null ? round((((nmv - mv) * rate) / totalCad) * 100, 2) : null,
      };
    }),
    notes: ['Arithmetic only: these are not forecasts. Overnight gaps can exceed any of these sizes, and other holdings would also move.', ...(portfolio.combined ? [] : ['No USD/CAD rate stored, so portfolio impact is not shown.'])],
  };
}

// Group holdings by shared exposures and compute return correlations from
// stored daily closes. Positions in the same instrument across accounts are
// merged first.
export function riskOverlap(portfolio, { describe, barsFor, upcomingEarnings, earningsWindowDays, today }) {
  const merged = new Map();
  for (const p of portfolio.positions.filter((x) => x.marketValue != null)) {
    const k = p.instrument_id ?? `${p.symbol}|${p.exchange}`;
    const m = merged.get(k) || { ...p, accounts: [], marketValue: 0, weightPct: 0 };
    m.accounts.push(p.account);
    m.marketValue += p.marketValue;
    m.weightPct = p.weightPct != null ? m.weightPct + p.weightPct : null;
    merged.set(k, m);
  }
  const positions = [...merged.values()];
  // A ticker listed on two exchanges is shown with its exchange so the two stay apart.
  const dupSymbols = new Set(positions.map((p) => p.symbol).filter((x, i, a) => a.indexOf(x) !== i));
  for (const p of positions) p.label = dupSymbols.has(p.symbol) ? `${p.symbol} (${p.exchange})` : p.symbol;
  const groups = {};
  const add = (k, label, sym) => { const g = (groups[k] ||= { label, symbols: [] }); if (!g.symbols.includes(sym)) g.symbols.push(sym); };
  const toCad = (p) => toCadRate(portfolio, p.currency);
  for (const p of positions) {
    const d = describe(p) || {};
    if (d.category) add(`category:${d.category}`, `Same category: ${d.category}`, p.label);
    if (d.aiConnection && d.aiConnection !== 'none') add(`ai:${d.aiConnection}`, `AI linkage: ${d.aiConnection}`, p.label);
    if (d.leveraged) add('leveraged', 'Leveraged/inverse daily-reset funds', p.label);
    if (['compute', 'semi_mfg', 'memory'].includes(d.category) || /semiconductor/i.test(`${d.oneLiner} ${d.name}`)) add('theme:semis', 'Semiconductor cycle', p.label);
    if (['datacenter', 'cooling_electrical', 'power_grid', 'networking'].includes(d.category)) add('theme:dc_capex', 'Data-center capital spending', p.label);
    add(`ccy:${p.currency}`, `Priced in ${p.currency} (trading currency; a fund's economic exposure can differ)`, p.label);
  }
  // Exposures with exactly the same holdings are one cluster under several labels.
  const bySet = new Map();
  for (const g of Object.values(groups).filter((x) => x.symbols.length > 1)) {
    const key = [...g.symbols].sort().join(',');
    if (bySet.has(key)) bySet.get(key).labels.push(g.label);
    else bySet.set(key, { labels: [g.label], symbols: g.symbols });
  }
  // Each cluster lists every criterion its holdings share (several criteria can
  // describe the same group, e.g. "AI linkage: direct" and "Priced in USD").
  const shared = [...bySet.values()].map((g) => ({ criteria: g.labels, label: g.labels.join(' + '), symbols: g.symbols })).map((g) => {
    const value = positions.filter((p) => g.symbols.includes(p.label)).reduce((s, p) => s + (toCad(p) != null ? p.marketValue * toCad(p) : 0), 0);
    return { ...g, combinedValueCad: portfolio.combined ? round(value) : null, combinedWeightPct: portfolio.combined ? round((value / portfolio.combined.marketValue) * 100, 1) : null };
  }).sort((a, b) => (b.combinedWeightPct ?? 0) - (a.combinedWeightPct ?? 0));

  // Correlations: returns between consecutive COMMON dates for each pair.
  const closes = {};
  const coverage = [];
  for (const p of positions) {
    const bars = barsFor(p.instrument_id);
    coverage.push({ symbol: p.label, sessions: bars.length, lastSession: bars.at(-1)?.ts || null });
    if (bars.length >= 30) closes[p.label] = new Map(bars.map((b) => [b.ts, b.c]));
  }
  const syms = Object.keys(closes);
  const pairs = [];
  for (let i = 0; i < syms.length; i++) {
    for (let j = i + 1; j < syms.length; j++) {
      const a = closes[syms[i]], b = closes[syms[j]];
      const dates = [...a.keys()].filter((d) => b.has(d)).sort().slice(-61);
      if (dates.length < 21) continue;
      const xa = [], xb = [];
      for (let k = 1; k < dates.length; k++) {
        xa.push(a.get(dates[k]) / a.get(dates[k - 1]) - 1);
        xb.push(b.get(dates[k]) / b.get(dates[k - 1]) - 1);
      }
      const ma = xa.reduce((s, x) => s + x, 0) / xa.length, mb = xb.reduce((s, x) => s + x, 0) / xb.length;
      let cov = 0, va = 0, vb = 0;
      for (let k = 0; k < xa.length; k++) { cov += (xa[k] - ma) * (xb[k] - mb); va += (xa[k] - ma) ** 2; vb += (xb[k] - mb) ** 2; }
      const corr = va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
      if (corr != null) {
        // Two different instruments moving in perfect lockstep usually means duplicated or placeholder data.
        const suspect = Math.abs(corr) >= 0.98;
        pairs.push({ a: syms[i], b: syms[j], correlation: round(corr, 2), returns: xa.length, from: dates[0], to: dates.at(-1), ...(suspect ? { dataQualityWarning: 'Near-perfect correlation between different instruments: check the stored price history before relying on it.' } : {}) });
      }
    }
  }
  pairs.sort((x, y) => y.correlation - x.correlation);
  const weights = positions.map((p) => p.weightPct).filter((w) => w != null);
  const hhi = weights.length ? round(weights.reduce((s, w) => s + (w / 100) ** 2, 0), 3) : null;
  const staleHistory = coverage.filter((c) => c.lastSession && today && c.lastSession < today).map((c) => c.symbol);
  return {
    sharedExposures: shared,
    returnCorrelations: pairs.slice(0, 15),
    correlationNote: syms.length < 2
      ? 'Not enough stored daily history to compute return correlations.'
      : 'Correlation of daily returns between common trading dates (up to the last 60), in each instrument\'s own currency. It describes past co-movement, not a forecast, and is unreliable with short or gappy history.',
    historyCoverage: coverage,
    staleHistoryNote: staleHistory.length ? `Stored history for ${staleHistory.join(', ')} ends before the latest session; correlations may be out of date.` : null,
    upcomingEarnings: { windowDays: earningsWindowDays, events: upcomingEarnings },
    concentration: {
      herfindahl: hhi, effectiveNumberOfPositions: hhi ? round(1 / hhi, 1) : null, weightBasis: portfolio.combined ? WEIGHT_BASIS : WEIGHT_BASIS_CCY,
      currencyExposurePct: portfolio.combined ? Object.fromEntries(['USD', 'CAD'].map((c) => [c, round((positions.filter((p) => p.currency === c).reduce((a, p) => a + p.marketValue * toCad(p), 0) / portfolio.combined.marketValue) * 100, 1)])) : null,
      weights: positions.filter((p) => p.weightPct != null).sort((a, b) => b.weightPct - a.weightPct).map((p) => ({ symbol: p.symbol, weightPct: round(p.weightPct, 1), accounts: p.accounts })),
    },
    leveragedFunds: positions.filter((p) => describe(p)?.leveraged).map((p) => ({ symbol: p.symbol, objective: describe(p)?.dailyObjective || null, weightPct: p.weightPct != null ? round(p.weightPct, 1) : null })),
    staleQuotes: positions.filter((p) => p.quote && p.quote.freshness !== 'fresh').map((p) => ({ symbol: p.label, freshness: p.quote.freshness, quoteTime: p.quote.quoteTime, quoteTimeET: p.quote.quoteTime ? formatNy(p.quote.quoteTime) : null })),
    unpriced: portfolio.positions.filter((p) => p.marketValue == null).map((p) => p.symbol),
    unpricedNote: 'Unpriced holdings (e.g. identity not confirmed) are left out of every group, weight and correlation above.',
  };
}

// Positions measured over different sessions (a quote not refreshed since an
// earlier day, or an exchange closed for a holiday): which is which, since the
// latest-session totals add them together.
export function sessionMixNote(positions) {
  const measured = positions.filter((p) => p.dailyPL != null && p.dailyPLSession);
  const sessions = [...new Set(measured.map((p) => p.dailyPLSession))].sort().reverse();
  if (sessions.length < 2) return null;
  const label = (p) => (measured.some((x) => x.symbol === p.symbol && x.exchange !== p.exchange) ? `${p.symbol} (${p.exchange})` : p.symbol);
  const parts = sessions.map((s, i) => `${s}${i ? '' : ' (latest)'} for ${[...new Set(measured.filter((p) => p.dailyPLSession === s).map(label))].join(', ')}`);
  return `These latest-session figures span ${sessions.length} sessions: ${parts.join('; ')}. The totals add these moves together, so they are not one session's change; positions under an earlier date have no quote from the latest session (not refreshed since, or their exchange was closed).`;
}

// Days the Bank of Canada publishes a USD/CAD rate: Toronto exchange business
// days, less the federal holidays it also observes (Easter Monday, Sept 30,
// Nov 11). A day guessed wrongly here only hides the effect, never misstates it.
function bocBusinessDay(d) {
  return isTradingDay(d, 'TSX') && !['09-30', '11-11'].includes(d.slice(5)) && d !== addDays(easterSunday(Number(d.slice(0, 4))), 1);
}

// Attribution of the latest session's P/L by position, per currency, with a
// combined CAD figure at the stored rate and the currency effect between the
// last two daily reference rates (only when those are consecutive and the
// later one is this session's).
export function dailyAttribution(portfolio, { fxPrev, sessionDate } = {}) {
  const out = {};
  const rate = portfolio.combined?.fxRate ?? null;
  const toCad = (p) => (p.currency === 'CAD' ? 1 : rate);
  const measured = portfolio.positions.filter((p) => p.dailyPL != null);
  const grossCad = rate != null ? measured.reduce((s, p) => s + Math.abs(p.dailyPL) * toCad(p), 0) : null;
  const netCad = rate != null ? measured.reduce((s, p) => s + p.dailyPL * toCad(p), 0) : null;
  for (const ccy of ['USD', 'CAD']) {
    const ps = measured.filter((p) => p.currency === ccy);
    const total = ps.reduce((s, p) => s + p.dailyPL, 0);
    const gross = ps.reduce((s, p) => s + Math.abs(p.dailyPL), 0);
    out[ccy] = {
      totalDailyPL: round(total), totalDailyPct: portfolio.totals[ccy].dailyPct,
      pctBasis: 'Over positions with a measurable change (previous close available)',
      shareBasis: `shareOfCurrencyGrossMovePct: share of the summed absolute moves of ${ccy} positions. shareOfPortfolioGrossMovePct: share of the summed absolute moves of all positions in CAD. shareOfNetMovePct: this position's CAD move as a % of the portfolio's net CAD move (positive = it moved the same way as the total; shares can exceed 100% when others moved the opposite way).`,
      contributions: ps.map((p) => ({
        symbol: p.symbol, exchange: p.exchange, account: p.account, dailyPL: p.dailyPL, dailyPct: p.dailyPct, session: p.dailyPLSession || null,
        shareOfCurrencyGrossMovePct: gross > 0 ? round((Math.abs(p.dailyPL) / gross) * 100, 1) : null,
        shareOfPortfolioGrossMovePct: grossCad ? round(((Math.abs(p.dailyPL) * toCad(p)) / grossCad) * 100, 1) : null,
        shareOfNetMovePct: netCad ? round(((p.dailyPL * toCad(p)) / netCad) * 100, 1) : null,
        dailyPLCad: rate != null || ccy === 'CAD' ? round(p.dailyPL * (ccy === 'USD' ? rate : 1)) : null,
        quoteTime: p.quote?.quoteTime, quoteTimeET: p.quote?.quoteTime ? formatNy(p.quote.quoteTime) : null, freshness: p.quote?.freshness,
      })).sort((a, b) => a.dailyPL - b.dailyPL),
      staleInputs: ps.filter((p) => p.quote && p.quote.freshness !== 'fresh').map((p) => p.symbol),
      noPreviousClose: portfolio.positions.filter((p) => p.currency === ccy && p.marketValue != null && p.dailyPL == null).map((p) => p.symbol),
      unpriced: portfolio.positions.filter((p) => p.currency === ccy && p.marketValue == null).map((p) => p.symbol),
    };
  }
  let combinedCad = null;
  if (rate != null) {
    const startCad = measured.reduce((s, p) => s + (p.dailyPLStartValue || 0) * toCad(p), 0);
    const plCad = out.USD.totalDailyPL * rate + out.CAD.totalDailyPL;
    combinedCad = {
      dailyPLCad: round(plCad), startValueCad: round(startCad), dailyPct: startCad > 0 ? round((plCad / startCad) * 100, 2) : null,
      fxRate: rate, fxAsOf: portfolio.combined.fxAsOf,
      note: 'Price moves only: USD P/L converted at the stored daily reference rate. It does not include the currency effect below. The percentage is over positions with a previous close.',
    };
  }
  const sessions = [...new Set(portfolio.positions.map((p) => p.dailyPLSession).filter(Boolean))].sort();
  let fx = null;
  if (portfolio.fx && sessionDate) {
    // Only a one-day change into this session's own reference rate belongs with
    // this session's P/L; rates missing in between would make it a multi-day move.
    const gap = [];
    for (let d = fxPrev ? addDays(fxPrev.as_of, 1) : portfolio.fx.as_of, n = 0; d < portfolio.fx.as_of && n < 400; d = addDays(d, 1), n += 1) if (bocBusinessDay(d)) gap.push(d);
    const gapText = gap.length > 3 ? `${gap.length} business days (${gap[0]} to ${gap.at(-1)})` : gap.join(', ');
    if (portfolio.fx.as_of === sessionDate && fxPrev && !gap.length) {
      const usdMv = portfolio.totals.USD.marketValue || 0;
      const usdCash = portfolio.totals.USD.cash || 0;
      fx = {
        from: { rate: fxPrev.rate, asOf: fxPrev.as_of }, to: { rate: portfolio.fx.rate, asOf: portfolio.fx.as_of }, source: portfolio.fx.source,
        approxEffectOnUsdHoldingsInCad: round(usdMv * (portfolio.fx.rate - fxPrev.rate)),
        approxEffectOnUsdCashInCad: round(usdCash * (portfolio.fx.rate - fxPrev.rate)),
        note: `Change between the ${fxPrev.as_of} and ${portfolio.fx.as_of} daily reference rates applied to current USD values. It is a currency effect, separate from investment returns and not included in combinedCad.dailyPLCad.`,
      };
    } else {
      fx = {
        unavailable: true,
        note: portfolio.fx.as_of < sessionDate
          ? (bocBusinessDay(sessionDate)
            ? `The USD/CAD reference rate for the ${sessionDate} session is not stored yet (latest is ${portfolio.fx.as_of}; the Bank of Canada publishes each day's rate in the late afternoon), so this session's currency effect is not known.`
            : `The Bank of Canada publishes no USD/CAD rate for ${sessionDate} (a Canadian holiday), so this session's currency effect is not measured.`)
          : portfolio.fx.as_of > sessionDate
            ? `The latest stored USD/CAD rate (${portfolio.fx.as_of}) is from after the ${sessionDate} session, so it cannot measure that session's currency effect.`
            : !fxPrev
              ? `No USD/CAD rate before ${portfolio.fx.as_of} is stored, so this session's currency effect is not known.`
              : `The stored USD/CAD rates are from ${fxPrev.as_of} and ${portfolio.fx.as_of}, but the Bank of Canada ${gap.length > 1 ? `rates for ${gapText} in between are` : `rate for ${gapText} in between is`} not stored. The change between them spans more than the ${sessionDate} session, so this session's currency effect is not shown.`,
      };
    }
  }
  return { sessionsMeasured: sessions, sessionNote: sessionMixNote(portfolio.positions), byCurrency: out, combinedCad, fx };
}
