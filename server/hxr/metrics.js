// HXR run metrics (strategy/hxr/ENGINE-SPEC.md section 7), the hold
// comparison, the assumed-versus-realistic fill comparison, the
// pre-registered criteria G1-G6 (criteria-hxr-v1.json) and the candidate
// selection (PREREGISTRATION.md section 8). Pure functions over runBacktest
// output; every figure is in USD after costs. A result here is never
// permission to trade.

export const PASS_MEANING = "eligible for the owner's review; never permission to trade";
const MEANINGS = {
  PASS: PASS_MEANING,
  FAIL: 'failed the pre-registered criteria; never permission to trade',
  INSUFFICIENT_EVIDENCE: 'not enough evidence to judge (G1 not met, or a criterion could not be evaluated); never permission to trade',
  NOT_COUNTED_CONTAMINATED: 'every criterion passed, but the evaluation is contaminated (a repeat run) and cannot count as a pass; never permission to trade',
};
const VW15_MISSING = 'vw15_missing_open_used';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);

export function yearsBetween(firstDate, lastDate) {
  if (!firstDate || !lastDate) return null;
  return (dayMs(lastDate) - dayMs(firstDate)) / 86400000 / 365.25;
}

export function annualisedReturnPct(startValue, endValue, years) {
  if (!(startValue > 0) || !(endValue >= 0) || !(years > 0)) return null;
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

// Largest fall from a previous peak; the peak starts at startValue (the value
// at the first session's open, dated that session).
export function maxDrawdown(points, startValue) {
  const r = { maxDrawdownPct: 0, maxDrawdownUsd: 0, peakDate: null, troughDate: null, recoveryDate: null, peakValue: null, troughValue: null, peakIsStartValue: false };
  if (!points.length) return { ...r, maxDrawdownPct: null, maxDrawdownUsd: null };
  let peak = startValue ?? points[0].equity, peakDate = points[0].date, peakIsStart = startValue != null, troughIdx = -1;
  points.forEach((p, i) => {
    if (p.equity > peak) { peak = p.equity; peakDate = p.date; peakIsStart = false; }
    const pct = peak > 0 ? ((peak - p.equity) / peak) * 100 : 0;
    if (pct > r.maxDrawdownPct) {
      Object.assign(r, { maxDrawdownPct: pct, maxDrawdownUsd: peak - p.equity, peakDate, troughDate: p.date, peakValue: peak, troughValue: p.equity, peakIsStartValue: peakIsStart });
      troughIdx = i;
    }
  });
  if (troughIdx >= 0) r.recoveryDate = points.slice(troughIdx + 1).find((p) => p.equity >= r.peakValue)?.date ?? null;
  return r;
}

const costOfFill = (f) => ({ spreadSlippage: f.spreadSlippage || 0, fees: f.fees?.total || 0 });

function costsOf(fills, splits) {
  const ss = sum(fills.map((f) => costOfFill(f).spreadSlippage)) + sum(splits.filter((s) => s.kind === 'cash_in_lieu').map((s) => s.spreadCost || 0));
  const fees = sum(fills.map((f) => costOfFill(f).fees));
  return { spreadSlippage: ss, fees, total: ss + fees };
}

function dividendsOf(dividends, receivables) {
  const ent = dividends.filter((d) => d.kind === 'entitlement' && d.credited !== false);
  const paid = sum(dividends.filter((d) => d.kind === 'payment').map((d) => d.net));
  return {
    events: ent.filter((d) => d.gross > 0).length,
    gross: sum(ent.map((d) => d.gross)), withheld: sum(ent.map((d) => d.withheld)), net: sum(ent.map((d) => d.net)),
    paid, receivableAtEnd: sum(receivables.map((r) => r.net)),
  };
}

// Average gains and losses per completed holding (PREREGISTRATION.md section
// 11): winners and losers count closed episodes only. Holdings still open at
// the end (marked at the last close) are reported apart, never averaged in.
function episodeStats(episodes) {
  const closed = episodes.filter((e) => !e.open), open = episodes.filter((e) => e.open);
  const win = closed.filter((e) => e.pnl > 0), lose = closed.filter((e) => e.pnl < 0);
  return {
    count: episodes.length, closed: closed.length, open: open.length,
    winners: win.length, losers: lose.length, flat: closed.length - win.length - lose.length,
    avgGain: mean(win.map((e) => e.pnl)), avgGainPct: mean(win.map((e) => e.pnlPct).filter(fin)),
    avgLoss: mean(lose.map((e) => e.pnl)), avgLossPct: mean(lose.map((e) => e.pnlPct).filter(fin)),
    closedPnl: sum(closed.map((e) => e.pnl)),
    openPnl: sum(open.map((e) => e.pnl)), openWinners: open.filter((e) => e.pnl > 0).length, openLosers: open.filter((e) => e.pnl < 0).length,
    totalPnl: sum(episodes.map((e) => e.pnl)),
  };
}

function largestRise(items) {
  let best = null;
  for (const x of items) {
    if (fin(x.largestRiseWhileOutPct) && (!best || x.largestRiseWhileOutPct > best.pct)) {
      best = { symbol: x.symbol, exitDate: x.exitDate, buyBackDate: x.buyBackDate ?? null, pct: x.largestRiseWhileOutPct, highestClose: x.highestCloseWhileOut, exitPrice: x.exitPrice };
    }
  }
  return best;
}

// Missed rebounds and declines avoided per round trip (split-adjusted,
// effective prices), plus exits still open at the end, valued at the last close.
// dollars is Σ exitShares × (buyBack − exit) as ENGINE-SPEC.md section 7 defines
// it, so it is negative for declines avoided; saved is the same amount as a
// positive number (exitShares × (exit − buyBack)).
function reboundsOf(roundTrips, openExits) {
  const up = roundTrips.filter((t) => t.changePct > 0), down = roundTrips.filter((t) => !(t.changePct > 0));
  const avoided = sum(down.map((t) => t.dollars));
  return {
    reboundsMissed: { count: up.length, dollars: sum(up.map((t) => t.dollars)) },
    declinesAvoided: { count: down.length, dollars: avoided, saved: avoided === 0 ? 0 : -avoided },
    largestRiseWhileOut: largestRise([...roundTrips, ...openExits]),
    openExits: { count: openExits.length, dollars: sum(openExits.map((x) => x.dollars).filter(fin)) },
  };
}

// Episodes that began with a buy-back and ended with an exit below the
// buy-back price (split-adjusted). dollars is their net P/L after costs and
// dividends; priceLoss is shares x (exit - buy-back) only.
function lossesAfterBuyBack(episodes) {
  const xs = episodes.filter((e) => e.startKind === 'buy_back' && !e.open && e.endKind === 'exit' && fin(e.exitPriceAdj) && e.exitPriceAdj < e.buyPrice);
  return { count: xs.length, dollars: sum(xs.map((e) => e.pnl)), priceLoss: sum(xs.map((e) => e.shares * (e.exitPriceAdj - e.buyPrice))) };
}

export function computeRunMetrics(result, { startValue = null } = {}) {
  const eq = result.equity || [], fills = result.fills || [], splits = result.splits || [];
  const roundTrips = result.roundTrips || [], openExits = result.openExits || [], episodes = result.episodes || [];
  const start = startValue ?? result.meta?.startingCash ?? null;
  const end = eq.length ? eq[eq.length - 1].equity : start;
  const firstDate = eq[0]?.date ?? null, lastDate = eq[eq.length - 1]?.date ?? null;
  const years = yearsBetween(firstDate, lastDate);
  const ann = annualisedReturnPct(start, end, years);
  const dd = maxDrawdown(eq, start);
  const symbols = result.meta?.basket ?? (result.sleeves || []).map((s) => s.symbol);
  const n = symbols.length || Object.keys(eq[0]?.sleeves || {}).length;
  const buys = fills.filter((f) => f.side === 'buy' && !f.initial), sells = fills.filter((f) => f.side === 'sell');
  const sumCash = sum(eq.map((p) => p.cash)), sumEq = sum(eq.map((p) => p.equity));

  const perStock = symbols.map((symbol) => {
    const sl = (result.sleeves || []).find((s) => s.symbol === symbol) || {};
    const last = eq[eq.length - 1]?.sleeves?.[symbol];
    const endValue = last ? last.equity : sl.equity ?? null;
    const startCash = sl.startCash ?? null;
    const f = fills.filter((x) => x.symbol === symbol), sp = splits.filter((x) => x.symbol === symbol);
    const outSessions = eq.filter((p) => p.sleeves?.[symbol]?.out).length;
    const rts = roundTrips.filter((t) => t.symbol === symbol), opens = openExits.filter((x) => x.symbol === symbol);
    const dv = dividendsOf((result.dividends || []).filter((d) => d.symbol === symbol), (result.receivables || []).filter((r) => r.symbol === symbol));
    return {
      symbol, startValue: startCash, endValue, pnl: endValue != null && startCash != null ? endValue - startCash : null,
      pnlPct: endValue != null && startCash > 0 ? ((endValue - startCash) / startCash) * 100 : null,
      receivable: dv.receivableAtEnd, roundTrips: rts.length, exitsWithoutBuyBack: opens.length,
      buys: f.filter((x) => x.side === 'buy' && !x.initial).length, sells: f.filter((x) => x.side === 'sell').length,
      timeOutPct: eq.length ? (outSessions / eq.length) * 100 : null,
      costs: costsOf(f, sp), dividendsNet: dv.net, dividendsGross: dv.gross,
      largestRiseWhileOutPct: largestRise([...rts, ...opens])?.pct ?? null,
    };
  });

  return {
    label: result.meta?.label ?? null, version: result.meta?.version ?? null, ruleType: result.meta?.ruleType ?? null,
    fillModel: result.meta?.fillModel ?? null, delaySessions: result.meta?.delaySessions ?? null, simulated: true,
    startValue: start, endValue: end,
    totalReturnPct: start > 0 && end != null ? (end / start - 1) * 100 : null,
    annualisedReturnPct: ann,
    maxDrawdownPct: dd.maxDrawdownPct, maxDrawdownUsd: dd.maxDrawdownUsd,
    peakDate: dd.peakDate, troughDate: dd.troughDate, recoveryDate: dd.recoveryDate, peakIsStartValue: dd.peakIsStartValue,
    returnToDrawdown: ann != null && dd.maxDrawdownPct > 0 ? ann / dd.maxDrawdownPct : null,
    sessions: eq.length, years, firstDate, lastDate,
    buys: buys.length, sells: sells.length, initialBuys: fills.filter((f) => f.initial).length,
    roundTrips: roundTrips.length, exitsWithoutBuyBack: openExits.length, pendingAtEnd: (result.pendingAtEnd || []).length,
    episodes: episodeStats(episodes),
    timeInCashPct: sumEq > 0 ? (sumCash / sumEq) * 100 : null,
    sleeveTimeOutPct: eq.length && n ? (sum(eq.map((p) => p.sleevesOut)) / (eq.length * n)) * 100 : null,
    missedRebounds: reboundsOf(roundTrips, openExits),
    lossesAfterBuyBack: lossesAfterBuyBack(episodes),
    costs: costsOf(fills, splits),
    dividends: dividendsOf(result.dividends || [], result.receivables || []),
    vw15Missing: fills.filter((f) => (f.flags || []).includes(VW15_MISSING)).length,
    warnings: (result.warnings || []).length,
    perStock,
  };
}

// ---------- comparisons ----------

const COMPARED = ['endValue', 'totalReturnPct', 'annualisedReturnPct', 'maxDrawdownPct', 'returnToDrawdown', 'timeInCashPct', 'sleeveTimeOutPct', 'buys', 'sells', 'roundTrips'];
const diff = (a, b) => (fin(a) && fin(b) ? a - b : null);
const ratio = (a, b) => (fin(a) && fin(b) && b !== 0 ? a / b : null);

// HXR minus hold, field by field, plus the ratios the criteria use.
export function compareArms(hxr, hold) {
  const out = {};
  for (const k of COMPARED) out[k] = { hxr: hxr?.[k] ?? null, hold: hold?.[k] ?? null, diff: diff(hxr?.[k], hold?.[k]) };
  out.costs = { hxr: hxr?.costs?.total ?? null, hold: hold?.costs?.total ?? null, diff: diff(hxr?.costs?.total, hold?.costs?.total) };
  out.dividendsNet = { hxr: hxr?.dividends?.net ?? null, hold: hold?.dividends?.net ?? null, diff: diff(hxr?.dividends?.net, hold?.dividends?.net) };
  out.ratios = { maxDrawdown: ratio(hxr?.maxDrawdownPct, hold?.maxDrawdownPct), returnToDrawdown: ratio(hxr?.returnToDrawdown, hold?.returnToDrawdown) };
  out.perStock = (hxr?.perStock || []).map((s) => {
    const h = (hold?.perStock || []).find((x) => x.symbol === s.symbol);
    return { symbol: s.symbol, hxrPnl: s.pnl, holdPnl: h?.pnl ?? null, diff: diff(s.pnl, h?.pnl) };
  });
  return out;
}

// Assumed (open) versus realistically available (first 15-minute VWAP) fills,
// matched by fill id. Fills where the VWAP was missing used the open price and
// would show no difference, so they are counted, not averaged.
export function fillComparison(openResult, vw15Result) {
  const byId = new Map((openResult?.fills || []).map((f) => [f.id, f]));
  const diffs = [];
  let fillsWithoutVw15 = 0, unmatched = 0;
  for (const f of vw15Result?.fills || []) {
    if ((f.flags || []).includes(VW15_MISSING)) { fillsWithoutVw15++; continue; }
    const o = byId.get(f.id);
    if (!o || !(o.price > 0)) { unmatched++; continue; }
    diffs.push((Math.abs(f.price - o.price) / o.price) * 10000);
  }
  const endOf = (r) => r?.equity?.[r.equity.length - 1]?.equity ?? null;
  const openEnd = endOf(openResult), vwEnd = endOf(vw15Result);
  return {
    matched: diffs.length, unmatched, fillsWithoutVw15,
    medianAbsDiffBps: median(diffs), meanAbsDiffBps: mean(diffs),
    openEndValue: openEnd, vw15EndValue: vwEnd, endValueDiff: diff(vwEnd, openEnd),
  };
}

// ---------- criteria ----------

// "at least m x the hold's": with a negative hold figure m x would be a lower
// bar than the hold itself, so the conservative reading asks for
// hold + (m - 1) x |hold| (the same as m x hold when it is positive).
export function timesHoldThreshold(holdValue, m) {
  return holdValue >= 0 ? holdValue * m : holdValue + (m - 1) * Math.abs(holdValue);
}

const crit = (id, name, status, value, note, threshold = null) => ({ id, name, status, value, threshold, note });

function g2(c, run) {
  const h = run?.hxr?.maxDrawdownPct, d = run?.hold?.maxDrawdownPct;
  if (!fin(h) || !fin(d)) return { status: 'not_evaluable', value: { hxr: h ?? null, hold: d ?? null }, note: 'largest decline missing' };
  const limit = c.maxRatioToHold * d;
  return { status: h <= limit ? 'pass' : 'fail', value: { hxr: h, hold: d, limit }, note: `HXR ${h.toFixed(2)}% vs limit ${limit.toFixed(2)}% (${c.maxRatioToHold} x hold ${d.toFixed(2)}%)` };
}

function g3(c, run) {
  const h = run?.hxr?.returnToDrawdown, d = run?.hold?.returnToDrawdown;
  if (!fin(h) || !fin(d)) return { status: 'not_evaluable', value: { hxr: h ?? null, hold: d ?? null }, note: 'return-to-drawdown undefined (no decline, or no return figure)' };
  const limit = timesHoldThreshold(d, c.minRatioToHold);
  return { status: h >= limit ? 'pass' : 'fail', value: { hxr: h, hold: d, limit }, note: `HXR ${h.toFixed(3)} vs at least ${limit.toFixed(3)} (${c.minRatioToHold} x hold ${d.toFixed(3)})` };
}

const both = (a, b) => (a === 'fail' || b === 'fail' ? 'fail' : a === 'pass' && b === 'pass' ? 'pass' : 'not_evaluable');

// runs: { main: {hxr, hold}, costs2x: {hxr, hold}, delay2: {hxr, hold},
// leaveOneOut: [{ left, hxr, hold }], contaminated }; every hxr/hold is a
// computeRunMetrics result.
export function evaluateCriteria(criteria, runs = {}) {
  const by = Object.fromEntries((criteria?.criteria || []).map((c) => [c.id, c]));
  for (const id of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']) if (!by[id]) throw new Error(`criteria file has no ${id}`);
  const { main, costs2x, delay2, leaveOneOut, contaminated = false } = runs;
  const out = [];

  const c1 = by.G1, hx = main?.hxr, hd = main?.hold;
  const v1 = { sessions: hx?.sessions ?? null, roundTrips: hx?.roundTrips ?? null, holdMaxDrawdownPct: hd?.maxDrawdownPct ?? null };
  if (!fin(v1.sessions) || !fin(v1.roundTrips) || !fin(v1.holdMaxDrawdownPct)) out.push(crit('G1', c1.name, 'not_evaluable', v1, 'main run metrics missing'));
  else {
    const miss = [];
    if (v1.sessions < c1.minSessions) miss.push(`${v1.sessions} sessions (needs ${c1.minSessions})`);
    if (v1.roundTrips < c1.minRoundTrips) miss.push(`${v1.roundTrips} round trips (needs ${c1.minRoundTrips})`);
    if (v1.holdMaxDrawdownPct < c1.minHoldDrawdownPct) miss.push(`hold's largest decline ${v1.holdMaxDrawdownPct.toFixed(2)}% (needs ${c1.minHoldDrawdownPct}%)`);
    out.push(crit('G1', c1.name, miss.length ? 'fail' : 'pass', v1, miss.length ? miss.join('; ') : 'enough sessions, round trips and a hold decline to test the rules', { minSessions: c1.minSessions, minRoundTrips: c1.minRoundTrips, minHoldDrawdownPct: c1.minHoldDrawdownPct }));
  }

  const r2 = g2(by.G2, main);
  out.push(crit('G2', by.G2.name, r2.status, r2.value, r2.note, by.G2.maxRatioToHold));
  const r3 = g3(by.G3, main);
  out.push(crit('G3', by.G3.name, r3.status, r3.value, r3.note, by.G3.minRatioToHold));

  const a = main?.hxr?.annualisedReturnPct, b = main?.hold?.annualisedReturnPct;
  if (!fin(a) || !fin(b)) out.push(crit('G4', by.G4.name, 'not_evaluable', { hxr: a ?? null, hold: b ?? null }, 'annualised return missing'));
  else {
    const limit = b - by.G4.maxShortfallPctPoints;
    out.push(crit('G4', by.G4.name, a >= limit ? 'pass' : 'fail', { hxr: a, hold: b, limit }, `HXR ${a.toFixed(2)}% a year vs at least ${limit.toFixed(2)}% (hold ${b.toFixed(2)}% less ${by.G4.maxShortfallPctPoints} points)`, by.G4.maxShortfallPctPoints));
  }

  const variants = by.G5.variants || ['costs2x', 'delay2'];
  const v5 = {}, notes5 = [];
  let s5 = 'pass';
  for (const v of variants) {
    const run = { costs2x, delay2 }[v] ?? runs[v];
    const x2 = g2(by.G2, run), x3 = g3(by.G3, run);
    v5[v] = { G2: x2.status, G3: x3.status, g2: x2.value, g3: x3.value };
    const s = both(x2.status, x3.status);
    s5 = both(s5, s);
    notes5.push(`${v}: G2 ${x2.status}, G3 ${x3.status}`);
  }
  out.push(crit('G5', by.G5.name, s5, v5, notes5.join('; ')));

  const loo = Array.isArray(leaveOneOut) ? leaveOneOut : [];
  const expected = Math.max(loo.length, main?.hxr?.perStock?.length ?? 0);
  const rows = loo.map((r) => ({ left: r.left, status: g3(by.G3, r).status }));
  const passing = rows.filter((r) => r.status === 'pass').length, undecided = expected - rows.filter((r) => r.status !== 'not_evaluable').length;
  const min = by.G6.minPassing;
  const s6 = !expected ? 'not_evaluable' : passing >= min ? 'pass' : passing + undecided < min ? 'fail' : 'not_evaluable';
  out.push(crit('G6', by.G6.name, s6, { passing, evaluated: rows.length - rows.filter((r) => r.status === 'not_evaluable').length, expected, runs: rows }, `G3 passes in ${passing} of ${expected} leave-one-stock-out runs (needs ${min})`, min));

  const g1 = out[0].status;
  const rest = out.slice(1).map((c) => c.status);
  let outcome;
  if (g1 !== 'pass') outcome = 'INSUFFICIENT_EVIDENCE';
  else if (rest.includes('fail')) outcome = 'FAIL';
  else if (rest.includes('not_evaluable')) outcome = 'INSUFFICIENT_EVIDENCE';
  else outcome = 'PASS';
  // A contaminated (repeated) evaluation can never pass.
  if (contaminated && outcome === 'PASS') outcome = 'NOT_COUNTED_CONTAMINATED';
  return { criteria: out, outcome, contaminated: !!contaminated, meaning: MEANINGS[outcome], passMeaning: PASS_MEANING };
}

// ---------- selection (PREREGISTRATION.md section 8) ----------

const TIE = 1e-9;

// sel: criteria.selection. Qualify with at least minRoundTrips; the highest
// return-to-drawdown wins, a tie goes to the smaller largest decline (then the
// listed order); stop when the best is below stopUnlessAtLeastTimesHold x hold.
export function selectCandidate(sel, { hold, candidates = [] } = {}) {
  const min = sel.minRoundTrips, m = sel.stopUnlessAtLeastTimesHold;
  const table = candidates.map((c, i) => {
    const x = c.metrics || {};
    const row = {
      name: c.name, index: i, roundTrips: x.roundTrips ?? 0, returnToDrawdown: x.returnToDrawdown ?? null,
      maxDrawdownPct: x.maxDrawdownPct ?? null, annualisedReturnPct: x.annualisedReturnPct ?? null, qualifies: true, rank: null, note: null,
    };
    if (!(row.roundTrips >= min)) { row.qualifies = false; row.note = `${row.roundTrips} round trips (needs ${min})`; }
    else if (!fin(row.returnToDrawdown)) { row.qualifies = false; row.note = 'return-to-drawdown undefined (no decline), so it cannot be ranked'; }
    return row;
  });
  const q = table.filter((r) => r.qualifies).sort((a, b) => {
    if (Math.abs(a.returnToDrawdown - b.returnToDrawdown) > TIE) return b.returnToDrawdown - a.returnToDrawdown;
    if (fin(a.maxDrawdownPct) && fin(b.maxDrawdownPct) && a.maxDrawdownPct !== b.maxDrawdownPct) return a.maxDrawdownPct - b.maxDrawdownPct;
    return a.index - b.index;
  });
  q.forEach((r, i) => { r.rank = i + 1; });
  const holdRtd = hold?.returnToDrawdown;
  const threshold = fin(holdRtd) ? timesHoldThreshold(holdRtd, m) : null;
  const base = { table, threshold, holdReturnToDrawdown: holdRtd ?? null };
  if (!q.length) return { ...base, chosen: null, reason: `stop: no candidate completed at least ${min} round trips with a defined return-to-drawdown` };
  const best = q[0];
  const tied = q.length > 1 && Math.abs(q[1].returnToDrawdown - best.returnToDrawdown) <= TIE;
  if (threshold == null) return { ...base, chosen: null, best: best.name, reason: "stop: the hold's return-to-drawdown is undefined (no decline), so no candidate can be shown to beat it" };
  if (best.returnToDrawdown < threshold) {
    return { ...base, chosen: null, best: best.name, reason: `stop: the best candidate ${best.name} has return-to-drawdown ${best.returnToDrawdown.toFixed(3)}, below ${m} x the hold's (${threshold.toFixed(3)}); the evaluation period is not used` };
  }
  return {
    ...base, chosen: best.name, best: best.name,
    reason: `${best.name}: highest return-to-drawdown ${best.returnToDrawdown.toFixed(3)} among ${q.length} qualifying candidate(s)${tied ? ' (tie broken by the smaller largest decline)' : ''}, at least ${m} x the hold's (${threshold.toFixed(3)})`,
  };
}
