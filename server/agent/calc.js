// Hypothetical trade arithmetic for the chat agent. Pure functions: they read a
// computed portfolio and return a scenario; they never touch stored records.
import { round } from '../portfolio.js';

const EPS = 1e-9;

function isWhole(n) {
  return Math.abs(n - Math.round(n)) < 1e-9;
}

// Resolve the execution price used for a scenario. A user-specified price is
// labelled as such; otherwise the latest stored quote is an *estimate*.
export function resolvePrice({ price, quote }) {
  if (price != null) {
    if (!(Number(price) > 0)) throw new Error('Price must be a positive number');
    return { price: Number(price), basis: 'price you specified', estimated: true, quote: null };
  }
  if (!quote || quote.price == null) {
    throw new Error('No current quote is available for this instrument, so a scenario price cannot be estimated. Provide an assumed price.');
  }
  return {
    price: quote.price,
    basis: `last ${quote.freshness === 'stale' ? 'STALE ' : ''}quote from ${quote.provider} at ${quote.quoteTime}${quote.timeliness ? ` (${quote.timeliness}${quote.delayMinutes ? `, ${quote.delayMinutes} min delay` : ''})` : ''}`,
    estimated: true,
    stale: quote.freshness !== 'fresh',
    quote: { provider: quote.provider, quoteTime: quote.quoteTime, freshness: quote.freshness, timeliness: quote.timeliness },
  };
}

function resolveFees(fees) {
  if (fees == null) return { fees: 0, known: false, note: 'Commission not known; calculated as $0. Your brokerage may charge commissions, currency-conversion or regulatory fees.' };
  if (!(Number(fees) >= 0)) throw new Error('Fees cannot be negative');
  return { fees: Number(fees), known: true, note: 'Fees as you specified.' };
}

// Value of everything (positions + cash) in CAD at the stored FX rate, or null.
function portfolioTotalCad(portfolio) {
  return portfolio.combined ? portfolio.combined.total : null;
}

export function simulateTrade(portfolio, req) {
  const symbol = String(req.symbol || '').toUpperCase();
  const candidates = portfolio.positions.filter((p) => p.symbol === symbol && (!req.account || p.account === req.account));
  const side = req.side;
  if (!['sell', 'buy'].includes(side)) throw new Error('side must be "sell" or "buy"');
  if (candidates.length > 1) throw new Error(`${symbol} is held in more than one account (${candidates.map((c) => c.account).join(', ')}); specify the account.`);
  const pos = candidates[0] || null;
  if (side === 'sell' && !pos) throw new Error(`No open position in ${symbol} to sell${req.account ? ` in ${req.account}` : ''}.`);
  if (pos && pos.identityStatus !== 'confirmed' && req.price == null) {
    throw new Error(`${symbol}'s instrument identity is not confirmed, so it has no trusted quote. Confirm it first or give an assumed price.`);
  }
  const currency = pos ? pos.currency : req.currency;
  if (!currency) throw new Error(`Not holding ${symbol}; specify its trading currency for a buy scenario.`);
  const px = resolvePrice({ price: req.price, quote: pos?.quote || req.quote });
  const fee = resolveFees(req.fees);
  const totals = portfolio.totals[currency];
  const cashKnown = totals.cash != null;
  const cashBefore = cashKnown ? totals.cash : null;
  const notes = [];
  if (px.stale) notes.push('The quote used is not fresh; the real price may be materially different.');
  notes.push('Execution price is an estimate. A real order may fill at a different price, especially for market orders, wide spreads or outside regular hours.');
  notes.push('Taxes are not estimated: they depend on the account type (TFSA/RRSP vs non-registered), your other gains and losses, and timing.');
  if (!fee.known) notes.push(fee.note);

  if (side === 'sell') {
    let shares;
    if (req.shares != null) {
      shares = Number(req.shares);
    } else if (req.fraction != null) {
      const f = Number(req.fraction);
      if (!(f > 0 && f <= 1)) throw new Error('fraction must be between 0 and 1 (e.g. 0.2 for 20%)');
      const raw = pos.shares * f;
      shares = isWhole(pos.shares) ? Math.floor(raw + EPS) : Math.floor(raw * 10000 + EPS) / 10000;
      if (Math.abs(shares - raw) > EPS) notes.push(`${round(f * 100, 2)}% of ${pos.shares} shares is ${round(raw, 4)}; rounded down to ${shares} ${isWhole(pos.shares) ? 'whole ' : ''}shares.`);
    } else if (req.cash_amount != null) {
      const target = Number(req.cash_amount);
      if (!(target > 0)) throw new Error('cash_amount must be positive');
      shares = Math.ceil(((target + fee.fees) / px.price) - EPS);
      if (!isWhole(pos.shares)) shares = Math.ceil(((target + fee.fees) / px.price) * 10000 - EPS) / 10000;
      notes.push(`Shares needed to raise about ${round(target)} ${currency} after fees, rounded up.`);
    } else {
      throw new Error('Specify shares, fraction or cash_amount for the sale');
    }
    if (!(shares > 0)) throw new Error('The scenario sells zero shares (position too small for that fraction).');
    if (shares > pos.shares + EPS) throw new Error(`Cannot sell ${shares} shares; the position holds ${pos.shares}.`);
    const gross = shares * px.price;
    const net = gross - fee.fees;
    const costOfSold = pos.avgCost * shares;
    const realized = net - costOfSold;
    const remaining = pos.shares - shares;
    const remainingValue = remaining * px.price;
    const cashAfter = cashKnown ? cashBefore + net : null;
    const fx = portfolio.combined?.fxRate ?? null;
    let weightBefore = pos.weightPct ?? null;
    let weightAfter = null;
    const totalCad = portfolioTotalCad(portfolio);
    if (totalCad != null && fx) {
      const toCad = currency === 'USD' ? fx : 1;
      // Selling converts position value to cash; the total is unchanged apart from fees and price differences.
      const totalAfter = totalCad - (pos.marketValue != null ? (pos.marketValue - remainingValue - net) * toCad : 0);
      weightBefore = round(((pos.marketValue ?? shares * px.price) * toCad / totalCad) * 100, 2);
      weightAfter = round((remainingValue * toCad / totalAfter) * 100, 2);
    }
    if (!cashKnown) notes.push(`Available ${currency} cash is not recorded, so the cash balance after the sale is unknown; proceeds would add ${round(net)} ${currency}.`);
    else if (!totals.cashConfirmed) notes.push(`Your recorded ${currency} cash (${round(cashBefore)}) is unconfirmed.`);
    if (pos.hasBaseline) notes.push('Average cost comes from a dated snapshot; realized P/L for tax purposes may differ from the ACB your brokerage reports.');
    return {
      kind: 'hypothetical', side, symbol, exchange: pos.exchange, account: pos.account, currency,
      shares, sharesBefore: pos.shares, sharesAfter: round(remaining, 6),
      price: round(px.price, 4), priceBasis: px.basis, priceIsEstimate: true,
      grossProceeds: round(gross), fees: round(fee.fees), feesKnown: fee.known, netProceeds: round(net),
      averageCost: round(pos.avgCost, 4), costBasisSold: round(costOfSold), estimatedRealizedPL: round(realized),
      remainingCostBasis: round(pos.avgCost * remaining), remainingMarketValue: round(remainingValue),
      cashBefore: cashKnown ? round(cashBefore) : null, cashAfter: cashKnown ? round(cashAfter) : null, cashFreed: round(net),
      cadEquivalentOfProceeds: currency === 'USD' && fx ? { amount: round(net * fx), fxRate: fx, fxAsOf: portfolio.combined.fxAsOf, fxSource: portfolio.combined.fxSource } : null,
      weightBeforePct: weightBefore, weightAfterPct: weightAfter,
      taxes: 'unknown — not estimated',
      notes,
    };
  }

  // buy
  if (!cashKnown) notes.push(`Available ${currency} cash is not recorded; Signal Desk does not assume you can add money.`);
  let shares;
  if (req.shares != null) shares = Number(req.shares);
  else if (req.cash_amount != null) {
    const amt = Number(req.cash_amount);
    if (!(amt > 0)) throw new Error('cash_amount must be positive');
    shares = Math.floor(((amt - fee.fees) / px.price) + EPS);
    notes.push(`Whole shares affordable with ${round(amt)} ${currency} after fees.`);
  } else if (req.fraction != null && pos) {
    shares = Math.floor(pos.shares * Number(req.fraction) + EPS);
    notes.push(`Adds ${round(Number(req.fraction) * 100, 2)}% to the current share count, rounded down.`);
  } else {
    throw new Error('Specify shares or cash_amount for the purchase');
  }
  if (!(shares > 0)) throw new Error('The scenario buys zero shares at that price.');
  const cost = shares * px.price + fee.fees;
  const shortfall = cashKnown ? Math.max(0, cost - cashBefore) : null;
  const affordable = cashKnown && totals.cashConfirmed && shortfall <= EPS;
  if (cashKnown && shortfall > EPS) notes.push(`This costs ${round(cost)} ${currency} but recorded available ${currency} cash is ${round(cashBefore)}: short by ${round(shortfall)}. It would require new money, selling something, or currency conversion; margin is never assumed.`);
  if (cashKnown && !totals.cashConfirmed) notes.push(`Recorded ${currency} cash is unconfirmed.`);
  const newShares = (pos?.shares || 0) + shares;
  const newCost = (pos?.costBasis || 0) + cost;
  return {
    kind: 'hypothetical', side, symbol, exchange: pos?.exchange || req.exchange || null, account: pos?.account || req.account || null, currency,
    shares, sharesBefore: pos?.shares || 0, sharesAfter: round(newShares, 6),
    price: round(px.price, 4), priceBasis: px.basis, priceIsEstimate: true,
    totalCost: round(cost), fees: round(fee.fees), feesKnown: fee.known,
    newAverageCost: round(newCost / newShares, 4), previousAverageCost: pos ? round(pos.avgCost, 4) : null,
    cashBefore: cashKnown ? round(cashBefore) : null, cashAfter: cashKnown ? round(cashBefore - cost) : null,
    affordableWithConfirmedCash: affordable, cashShortfall: shortfall != null ? round(shortfall) : null,
    taxes: 'not applicable to a purchase; future gains depend on account type',
    notes,
  };
}

// Group positions by shared exposures and compute return correlations from
// stored daily closes. Used for "which positions share the same risks?".
export function riskOverlap(portfolio, { describe, barsFor, upcomingEarnings }) {
  const positions = portfolio.positions.filter((p) => p.marketValue != null);
  const groups = {};
  const add = (k, label, sym) => { (groups[k] ||= { label, symbols: [] }).symbols.push(sym); };
  const toCad = (p) => (p.currency === 'USD' ? (portfolio.combined?.fxRate ?? null) : 1);
  for (const p of positions) {
    const d = describe(p) || {};
    if (d.category) add(`category:${d.category}`, `Same category: ${d.category}`, p.symbol);
    if (d.aiConnection && d.aiConnection !== 'none') add(`ai:${d.aiConnection}`, `AI linkage: ${d.aiConnection}`, p.symbol);
    if (d.leveraged) add('leveraged', 'Leveraged/inverse daily-reset funds', p.symbol);
    add(`ccy:${p.currency}`, `Trades in ${p.currency}`, p.symbol);
    if (['compute', 'semi_mfg', 'memory', 'networking'].includes(d.category) || /semiconductor/i.test(`${d.oneLiner} ${d.name}`)) add('theme:semis', 'Semiconductor cycle', p.symbol);
    if (['datacenter', 'cooling_electrical', 'power_grid', 'networking'].includes(d.category)) add('theme:dc_capex', 'Data-center capital spending', p.symbol);
  }
  const shared = Object.values(groups).filter((g) => g.symbols.length > 1).map((g) => {
    const value = positions.filter((p) => g.symbols.includes(p.symbol)).reduce((s, p) => s + (toCad(p) != null ? p.marketValue * toCad(p) : 0), 0);
    return { ...g, combinedValueCad: portfolio.combined ? round(value) : null, combinedWeightPct: portfolio.combined ? round((value / portfolio.combined.marketValue) * 100, 1) : null };
  }).sort((a, b) => (b.combinedWeightPct ?? 0) - (a.combinedWeightPct ?? 0));

  // Correlation of daily returns over the most recent common 60 sessions.
  const series = {};
  for (const p of positions) {
    const bars = barsFor(p.instrument_id);
    if (bars.length < 30) continue;
    const m = new Map();
    for (let i = 1; i < bars.length; i++) m.set(bars[i].ts, bars[i].c / bars[i - 1].c - 1);
    series[p.symbol] = m;
  }
  const syms = Object.keys(series);
  const pairs = [];
  for (let i = 0; i < syms.length; i++) {
    for (let j = i + 1; j < syms.length; j++) {
      const a = series[syms[i]], b = series[syms[j]];
      const dates = [...a.keys()].filter((d) => b.has(d)).sort().slice(-60);
      if (dates.length < 20) continue;
      const xa = dates.map((d) => a.get(d)), xb = dates.map((d) => b.get(d));
      const ma = xa.reduce((s, x) => s + x, 0) / xa.length, mb = xb.reduce((s, x) => s + x, 0) / xb.length;
      let cov = 0, va = 0, vb = 0;
      for (let k = 0; k < xa.length; k++) { cov += (xa[k] - ma) * (xb[k] - mb); va += (xa[k] - ma) ** 2; vb += (xb[k] - mb) ** 2; }
      const corr = va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
      if (corr != null) pairs.push({ a: syms[i], b: syms[j], correlation: round(corr, 2), sessions: dates.length });
    }
  }
  pairs.sort((x, y) => y.correlation - x.correlation);
  const weights = positions.map((p) => p.weightPct).filter((w) => w != null);
  const hhi = weights.length ? round(weights.reduce((s, w) => s + (w / 100) ** 2, 0), 3) : null;
  return {
    sharedExposures: shared,
    returnCorrelations: pairs.slice(0, 15),
    correlationNote: syms.length < 2 ? 'Not enough stored daily history to compute return correlations.' : 'Correlation of daily returns over up to the last 60 common sessions; past co-movement, not a forecast.',
    upcomingEarnings,
    concentration: { herfindahl: hhi, effectiveNumberOfPositions: hhi ? round(1 / hhi, 1) : null, largestWeights: positions.filter((p) => p.weightPct != null).sort((a, b) => b.weightPct - a.weightPct).slice(0, 5).map((p) => ({ symbol: p.symbol, weightPct: p.weightPct })) },
    unpriced: portfolio.positions.filter((p) => p.marketValue == null).map((p) => p.symbol),
  };
}

// Attribution of today's P/L by position, per currency, plus FX effect on the
// CAD-equivalent value of USD holdings when two dated rates exist.
export function dailyAttribution(portfolio, { fxPrev } = {}) {
  const out = {};
  for (const ccy of ['USD', 'CAD']) {
    const ps = portfolio.positions.filter((p) => p.currency === ccy && p.dailyPL != null);
    const total = ps.reduce((s, p) => s + p.dailyPL, 0);
    out[ccy] = {
      totalDailyPL: round(total), totalDailyPct: portfolio.totals[ccy].dailyPct,
      contributions: ps.map((p) => ({ symbol: p.symbol, dailyPL: p.dailyPL, dailyPct: p.dailyPct, shareOfMovePct: total !== 0 ? round((p.dailyPL / total) * 100, 1) : null, quoteTime: p.quote?.quoteTime, freshness: p.quote?.freshness }))
        .sort((a, b) => a.dailyPL - b.dailyPL),
      unpriced: portfolio.positions.filter((p) => p.currency === ccy && p.dailyPL == null).map((p) => p.symbol),
    };
  }
  let fx = null;
  if (portfolio.fx && fxPrev && portfolio.totals.USD.marketValue) {
    const effect = portfolio.totals.USD.marketValue * (portfolio.fx.rate - fxPrev.rate);
    fx = {
      from: { rate: fxPrev.rate, asOf: fxPrev.as_of }, to: { rate: portfolio.fx.rate, asOf: portfolio.fx.as_of }, source: portfolio.fx.source,
      approxEffectOnUsdHoldingsInCad: round(effect),
      note: 'Approximate: applies the change between two daily reference rates to the current USD market value. It is a currency effect, separate from investment returns.',
    };
  }
  return { byCurrency: out, fx };
}
