// Benchmark (a) of PLAN-DRAFT.md v0.5 section 7c, the owner's decision D4 (EXPERIMENT-LOG.md entry 7): an
// equal-weight buy-and-hold index of the basket. Derived from the same inputs as the run; it is not a run and
// not an account that could be traded.
//
// At the open of the run's first trading session (on or after `start`), startingCash / n is put into each of
// the n stocks with fractional shares and no costs; a stock without a bar at that open is bought at its first
// later open and its share waits as cash at 0%. Never rebalanced (the weights drift). Splits multiply the
// shares, with no fraction paid out. Dividends are entitled by the shares held at the start of the ex-date
// session, credited net of the withholding on the pay date (the ex-date when none is recorded) and reinvested
// at that stock's close on the pay date, or at its next close if it has no bar that day. A stock with no bar on
// a day keeps its last close. The index has a value at every session from the first trading session on, so
// r(t) = I(t) / I(t-1) - 1 is defined close to close for the whole equity series.
export const INDEX_METHOD = 'rt-index-1: equal weight at the first trading open, fractional shares, no costs, never rebalanced; splits multiply the shares; dividends net of withholding reinvested at the pay-date close';

export function holdIndex({ symbols, sessions, days, start, startingCash, withholdingPct = 15 }) {
  const syms = (symbols || []).map((s) => (typeof s === 'string' ? s : s.symbol));
  if (!syms.length) throw new Error('holdIndex needs a symbol list');
  if (!(startingCash > 0)) throw new Error('holdIndex needs startingCash > 0');
  const sleeve = startingCash / syms.length;
  const shares = {}, lastClose = {}, bought = {}, pending = {}; // pending: dividends credited, awaiting that stock's next close
  const receivables = [];
  const out = [];
  for (const d of sessions) {
    if (d < start) continue;
    const day = days.get(d) || {}, bars = day.bars || {};
    // A split moves the shares and the last close to post-split units, so a stock without a bar on the split's
    // session (or until its next bar) is still valued correctly.
    for (const sp of day.splits || []) {
      if (shares[sp.symbol] > 0) shares[sp.symbol] *= sp.ratio;
      if (lastClose[sp.symbol] != null) lastClose[sp.symbol] /= sp.ratio;
    }
    // Entitled by the shares held at the start of the session: before this open's buys.
    for (const dv of day.dividends || []) {
      const n = shares[dv.symbol] || 0;
      if (n > 0) receivables.push({ symbol: dv.symbol, payDate: dv.payDate || d, net: n * dv.amount * (1 - withholdingPct / 100) });
    }
    for (const s of syms) if (!bought[s] && bars[s]) { shares[s] = sleeve / bars[s].o; bought[s] = true; }
    for (let i = receivables.length - 1; i >= 0; i--) {
      const r = receivables[i];
      if (r.payDate <= d) { pending[r.symbol] = (pending[r.symbol] || 0) + r.net; receivables.splice(i, 1); }
    }
    for (const s of syms) {
      if (bars[s]) lastClose[s] = bars[s].c;
      if (pending[s] > 0 && bars[s]) { shares[s] += pending[s] / bars[s].c; pending[s] = 0; }
    }
    let holdings = 0, cash = 0;
    for (const s of syms) {
      if (bought[s]) holdings += shares[s] * (lastClose[s] ?? 0); else cash += sleeve;
      cash += pending[s] || 0;
    }
    out.push({ date: d, value: holdings + cash, holdings, cash });
  }
  return out;
}
