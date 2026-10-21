// Simulated trading costs (ENGINE-SPEC §6): commission per fill, half spread
// plus slippage on market and stop fills, currency conversion when the
// account and instrument currencies differ. Pure functions of the config.

// k: the fraction of the price paid on market and stop fills.
export function slipFactor(costs) {
  return ((costs.halfSpreadBps || 0) + (costs.slippageBps || 0)) / 10000;
}

// max(minimum per order, per share x shares), capped at a % of the fill value.
export function commission(costs, shares, price) {
  if (!(shares > 0)) return 0;
  let c = Math.max(costs.commissionMinPerOrder || 0, (costs.commissionPerShare || 0) * shares);
  if (costs.commissionMaxPctOfValue != null) c = Math.min(c, (costs.commissionMaxPctOfValue / 100) * shares * price);
  return c;
}

export function fxRate(costs, instrumentCurrency = 'USD') {
  return instrumentCurrency && costs.accountCurrency && instrumentCurrency !== costs.accountCurrency ? (costs.fxConversionPct || 0) / 100 : 0;
}

export function fxCost(costs, notional, instrumentCurrency = 'USD') {
  return fxRate(costs, instrumentCurrency) * notional;
}

// Executed price of a fill: buys pay k above the raw price, sells receive k
// below it; limit fills pay neither.
export function fillPrice(raw, side, kind, k) {
  if (kind === 'limit') return raw;
  return side === 'buy' ? raw * (1 + k) : raw * (1 - k);
}

// Full breakdown of one fill. `extra` (per share, buys only) is the stress
// test's worse entry; it is reported with spread and slippage.
export function fillCost({ costs, side, kind, raw, shares, currency = 'USD', extra = 0 }) {
  const k = slipFactor(costs);
  const price = fillPrice(raw, side, kind, k) + (side === 'buy' ? extra : 0);
  const value = shares * price;
  const comm = commission(costs, shares, price);
  const fx = fxCost(costs, value, currency);
  const spreadSlippage = shares * Math.abs(price - raw);
  return {
    raw, price, shares, value, commission: comm, spreadSlippage, fx,
    total: comm + spreadSlippage + fx,
    // cash change: buys pay value + commission + fx, sells receive value - commission - fx
    cash: side === 'buy' ? -(value + comm + fx) : value - comm - fx,
  };
}

// Estimated round-trip cost per share at the reference entry (ENGINE-SPEC §4):
// c*k + stop*k + 2 x commission per share, plus currency conversion.
export function roundTripCostPerShare(costs, entryRef, stop, currency = 'USD') {
  const k = slipFactor(costs);
  return entryRef * k + stop * k + 2 * (costs.commissionPerShare || 0)
    + fxRate(costs, currency) * (entryRef * (1 + k) + stop * (1 - k));
}
