// The deterministic consolidation-breakout engine (strategy/ENGINE-SPEC.md).
// A hypothetical, simulated account only: it never reads or changes the real
// portfolio and never places, routes or prepares an order anywhere.
//
// Streaming: processTimestamp(t, bars) handles one bar time for every symbol
// (opens alphabetically, intrabar exits, closes alphabetically) and decides
// only from completed bars and the exchange calendar, so a run that sees data
// up to T decides exactly what a full run decided up to T. snapshot() is
// plain JSON; createEngine({ state }) continues identically.
import { configHash as hashConfig, validateConfig, ENGINE_VERSION, AMBIGUITY, ENTRY_FILL, MODES } from './config.js';
import { atrInit, atrUpdate } from './indicators.js';
import { barInfo, nextBarStartMs, addSessions, sessionsBetween, dayStartMs, localDate, sessionBounds } from './sessions.js';
import { slipFactor, commission, fxCost, fillCost, roundTripCostPerShare } from './costs.js';
import { boxParams, historyLength, detectBox, armedStep, checkVolume, retireBox, volumeOf, PX_EPS } from './boxes.js';
import { exchangeGroup } from '../calendar.js';
import { datasetHash } from './data.js';

const MIN = 60000;
const STATE_FORMAT = 'cb-engine-state-1';
const iso = (ms) => new Date(ms).toISOString();
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clone = (o) => JSON.parse(JSON.stringify(o));

export function floorTick(x, tick) {
  return Number((Math.floor(x / tick + 1e-9) * tick).toFixed(10));
}

function toMs(t) {
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  return Date.parse(t);
}

// Date-only bounds are exchange-local calendar days; anything else is an instant.
function boundMs(v, end = false) {
  if (v == null || v === '') return end ? Infinity : -Infinity;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    if (!end) return dayStartMs(v);
    const [y, m, d] = v.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    return dayStartMs(next) - 1;
  }
  const ms = toMs(v);
  if (!Number.isFinite(ms)) throw new Error(`Invalid date ${v}`);
  return ms;
}

function normSymbols(symbols, bars) {
  const list = symbols?.length ? symbols : [...(bars instanceof Map ? bars.keys() : Object.keys(bars || {}))];
  const out = list.map((s) => (typeof s === 'string' ? { symbol: s } : { ...s })).map((s) => ({
    symbol: String(s.symbol), exchange: s.exchange || 'NYSE', sector: s.sector ?? null, cluster: s.cluster ?? null,
    currency: s.currency || (exchangeGroup(s.exchange || 'NYSE') === 'TSX' ? 'CAD' : 'USD'),
  }));
  const seen = new Set();
  for (const s of out) {
    if (seen.has(s.symbol)) throw new Error(`Symbol ${s.symbol} is listed twice`);
    seen.add(s.symbol);
  }
  return out.sort((a, b) => byName(a.symbol, b.symbol));
}

function newSymbolState(s) {
  return {
    symbol: s.symbol, exchange: s.exchange, sector: s.sector, cluster: s.cluster, currency: s.currency,
    i: -1, hist: [], atr: atrInit(), state: 'scanning', nextWindowStartMin: 0,
    box: null, order: null, position: null, lastBar: null,
  };
}

function normLowerTf(lowerTf) {
  if (!lowerTf) return null;
  const out = new Map();
  const outer = lowerTf instanceof Map ? lowerTf : new Map(Object.entries(lowerTf));
  for (const [sym, inner] of outer) {
    const m = new Map();
    for (const [k, list] of inner instanceof Map ? inner : Object.entries(inner)) {
      m.set(iso(toMs(k)), [...list].map((b) => ({ ...b, ms: toMs(b.t) })).sort((a, b) => a.ms - b.ms));
    }
    out.set(sym, m);
  }
  return out;
}

export function createEngine({ config, mode, symbols = [], tradeFrom = null, lowerTf = null, overrides = {}, state = null } = {}) {
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`Invalid strategy config: ${errors.join('; ')}`);
  if (!MODES.includes(mode)) throw new Error(`mode must be ${MODES.join(' or ')}`);
  const cHash = hashConfig(config);
  const ov = {
    ambiguity: overrides?.ambiguity ?? config.simulation.ambiguity,
    entryFill: overrides?.entryFill ?? config.simulation.entryFill,
    entryWorseAtr: overrides?.entryWorseAtr ?? config.stress?.entryWorseAtr ?? 0,
  };
  if (!AMBIGUITY.includes(ov.ambiguity)) throw new Error(`ambiguity must be ${AMBIGUITY.join(', ')}`);
  if (!ENTRY_FILL.includes(ov.entryFill)) throw new Error(`entryFill must be ${ENTRY_FILL.join(' or ')}`);
  if (!(Number.isFinite(ov.entryWorseAtr) && ov.entryWorseAtr >= 0)) throw new Error('entryWorseAtr must be a number >= 0');

  const bp = boxParams(config);
  const HIST = historyLength(bp);
  const costs = config.costs, risk = config.risk;
  const k = slipFactor(costs);
  const tick = costs.tickSize, targetTrigger = (target) => target + costs.limitFillTicksBeyond * tick;
  const flattenMin = mode === 'intraday' ? config.modes.intraday.flattenMinutesBeforeClose : config.modes.swing.flattenMinutesBeforeCloseOnLastSession;
  const holdSessions = mode === 'intraday' ? 1 : config.modes.swing.maxHoldSessions;
  const timeExitReason = mode === 'intraday' ? 'flatten' : 'max_hold';
  const subBars = normLowerTf(lowerTf);

  const hist = { trades: [], events: [], equityCurve: [] };
  let S;
  if (state) {
    const st = typeof state === 'string' ? JSON.parse(state) : clone(state);
    if (st.history) { Object.assign(hist, st.history); delete st.history; }
    if (st.format !== STATE_FORMAT) throw new Error('Unrecognised engine state');
    if (st.configHash !== cHash) throw new Error('The saved engine state belongs to a different strategy config (config hash differs)');
    if (st.mode !== mode) throw new Error(`The saved engine state is for ${st.mode} mode, not ${mode}`);
    for (const key of ['ambiguity', 'entryFill', 'entryWorseAtr']) {
      if (overrides?.[key] != null && overrides[key] !== st.overrides[key]) throw new Error(`The saved engine state used ${key} = ${st.overrides[key]}`);
    }
    S = st;
    for (const s of normSymbols(symbols)) if (!S.symbols[s.symbol]) S.symbols[s.symbol] = newSymbolState(s);
  } else {
    S = {
      format: STATE_FORMAT, engineVersion: ENGINE_VERSION, strategy: config.strategy, version: config.version, configHash: cHash, mode,
      overrides: ov, tradeFromMs: Number.isFinite(boundMs(tradeFrom)) ? boundMs(tradeFrom) : null,
      lastMs: null, finished: false, startingEquity: risk.hypotheticalStartingEquity, cash: risk.hypotheticalStartingEquity,
      symbols: Object.fromEntries(normSymbols(symbols).map((s) => [s.symbol, newSymbolState(s)])),
      counters: {
        breakouts: 0, signals: 0, ordersPlaced: 0, entries: 0, exits: 0, setupsEligible: 0, setupsExpired: 0, setupsInvalidated: 0, dataWarnings: 0,
        ambiguousExits: 0, gapThroughStops: 0, gapThroughTargets: 0, endOfData: 0, rejectedByReason: {}, skippedByReason: {},
      },
    };
  }
  const OV = S.overrides;
  const order = Object.keys(S.symbols).sort(byName);
  let out = null;

  const tradeFromMs = () => S.tradeFromMs ?? -Infinity;

  function emit(atMs, symbol, type, reason, details = {}) {
    if (atMs < tradeFromMs()) return null;
    const e = { at: iso(atMs), symbol, type, reason, details: clone(details) }; // a copy: the journal never shares objects with the state
    out.events.push(e);
    hist.events.push(e);
    const c = S.counters;
    if (type === 'signal_rejected') c.rejectedByReason[details.code] = (c.rejectedByReason[details.code] || 0) + 1;
    else if (type === 'entry_skipped') c.skippedByReason[details.code] = (c.skippedByReason[details.code] || 0) + 1;
    else if (type === 'signal') c.signals++;
    else if (type === 'order_placed') c.ordersPlaced++;
    else if (type === 'entry_filled') c.entries++;
    else if (type === 'exit_filled') c.exits++;
    else if (type === 'setup_eligible') c.setupsEligible++;
    else if (type === 'setup_expired') c.setupsExpired++;
    else if (type === 'setup_invalidated') c.setupsInvalidated++;
    else if (type === 'data_warning') c.dataWarnings++;
    return e;
  }

  // ---------- account ----------

  const syms = () => order.map((s) => S.symbols[s]);
  const lastClose = (st) => st.lastBar?.c ?? st.position?.entry.raw ?? 0;
  function equityNow() {
    let e = S.cash;
    for (const st of syms()) if (st.position) e += st.position.shares * lastClose(st);
    return e;
  }
  function openRiskNow() {
    let r = 0;
    for (const st of syms()) {
      if (st.position) r += st.position.plannedRisk;
      if (st.order) r += st.order.plannedRiskWorstCase;
    }
    return r;
  }
  function reservedCash(except = null) {
    let r = 0;
    for (const st of syms()) if (st.order && st !== except) r += st.order.reservedCash;
    return r;
  }
  const openCount = () => syms().filter((st) => st.position || st.order).length;

  // Largest whole n with f(n) <= cap, f non-decreasing and f(n) >= n * unit.
  function largest(f, cap, unit) {
    if (!(cap > 0) || !(unit > 0)) return 0;
    let lo = 0, hi = Math.floor(cap / unit + 1e-9);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (f(mid) <= cap + 1e-9) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // ENGINE-SPEC §6: risk budget, open-risk room, cash not reserved by pending orders.
  function size(st, maxEntry, stop) {
    const n = openCount();
    const equity = equityNow(), openRisk = openRiskNow();
    const base = { equity, openRisk, openPositionsAndOrders: n, maxPositions: risk.maxPositions };
    if (n >= risk.maxPositions) return { ...base, code: 'max_positions', reason: `${n} positions and pending orders already open (maximum ${risk.maxPositions})` };
    const riskBudget = equity * risk.riskPerTradePct / 100;
    const openRoom = equity * risk.maxOpenRiskPct / 100 - openRisk;
    const budget = Math.min(riskBudget, openRoom);
    if (!(budget > 1e-9)) return { ...base, riskBudget, openRoom, code: 'open_risk_limit', reason: `open planned risk ${openRisk.toFixed(2)} already uses the ${risk.maxOpenRiskPct}% limit (${(equity * risk.maxOpenRiskPct / 100).toFixed(2)})` };
    const buy = maxEntry * (1 + k), sell = stop * (1 - k);
    const wl = buy - sell;
    const availableCash = S.cash - reservedCash();
    const riskOf = (x) => x * wl + commission(costs, x, buy) + commission(costs, x, sell) + fxCost(costs, x * buy, st.currency) + fxCost(costs, x * sell, st.currency);
    const costOf = (x) => x * buy + commission(costs, x, buy) + fxCost(costs, x * buy, st.currency);
    const sharesByRisk = largest(riskOf, budget, wl), sharesByCash = largest(costOf, availableCash, buy);
    const shares = Math.min(sharesByRisk, sharesByCash);
    const sizedBy = sharesByCash < sharesByRisk ? 'cash' : openRoom < riskBudget ? 'open_risk' : 'risk';
    const r = {
      ...base, riskBudget, openRoom, budget, availableCash, worstEntry: buy, worstExit: sell, worstLossPerShare: wl,
      sharesByRisk, sharesByCash, sizedBy, commissionLimited: Math.floor(budget / wl + 1e-9) > sharesByRisk,
      shares, plannedRiskWorstCase: riskOf(shares), reservedCash: costOf(shares),
    };
    if (shares < 1) {
      return { ...r, code: 'size_below_one_share', reason: sizedBy === 'cash' ? `simulated cash ${availableCash.toFixed(2)} cannot buy one share at ${buy.toFixed(2)} plus commission` : `risk budget ${budget.toFixed(2)} cannot cover one share's worst-case loss ${wl.toFixed(4)} plus commissions` };
    }
    return r;
  }

  // ---------- entries and exits ----------

  function reject(st, atMs, code, reason, details) {
    emit(atMs, st.symbol, 'signal_rejected', reason, { code, ...details });
  }

  function onBreakout(st, bar, ms, bi, box) {
    S.counters.breakouts++;
    const vol = checkVolume(st.hist, bp);
    const A = st.atr.atr;
    const signal = {
      at: iso(ms), open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: volumeOf(bar.v), avgVolume: vol.avgVolume ?? null,
      volumeRatio: vol.volumeRatio ?? null, volumeMultiple: bp.volumeMultiple, volumeLookbackBars: bp.volumeLookbackBars, atr: A, ceiling: box.resistance,
    };
    if (!vol.ok) return reject(st, ms, vol.code, vol.reason, { box, signal, missing: vol.missing ?? 0 });
    const c = bar.c;
    const stop = bar.l - config.stop.atrBuffer * A;
    const target = box.resistance + config.target.boxHeightMultiple * box.height;
    const minRR = config.entry.minRewardRisk;
    const gapLimit = c + config.entry.maxGapAtr * A;
    const rrLimit = ((target + minRR * stop) / (1 + minRR)) / (1 + k);
    const binding = gapLimit <= rrLimit ? 'gap' : 'reward_risk';
    const maxEntry = floorTick(Math.min(gapLimit, rrLimit), tick);
    const refEntry = c * (1 + k), riskRef = refEntry - stop;
    const costPerShare = roundTripCostPerShare(costs, c, stop, st.currency);
    const plan = {
      stop, target, maxEntry, gapLimit, rrLimit, binding, minRewardRisk: minRR, atrBuffer: config.stop.atrBuffer, maxGapAtr: config.entry.maxGapAtr,
      targetMultiple: config.target.boxHeightMultiple, k, referenceEntry: refEntry, referenceRisk: riskRef,
      rewardRiskAtMaxEntry: maxEntry > stop ? (target - maxEntry * (1 + k)) / (maxEntry * (1 + k) - stop) : null,
      costPerShare, costToRiskPct: riskRef > 0 ? (costPerShare / riskRef) * 100 : null, maxCostToRiskPct: config.stop.maxCostToRiskPct,
      shares: null, plannedRiskWorstCase: null,
    };
    // Checks in ENGINE-SPEC §4 order; the signal is journalled with its final plan, then the outcome.
    const limit = config.entry.noNewEntriesMinutesBeforeClose;
    let rej = null;
    if (c >= target) rej = ['beyond_target', `closed at ${c}, at or beyond the target ${target.toFixed(2)}`];
    else if (maxEntry <= stop) rej = ['max_entry_below_stop', `the maximum entry ${maxEntry} is at or below the stop ${stop.toFixed(4)}`];
    else if (!(stop > 0)) rej = ['stop_not_positive', `the stop ${stop.toFixed(4)} is not positive`];
    else if (riskRef < config.stop.minStopAtr * A) rej = ['stop_too_close', `risk per share ${riskRef.toFixed(4)} is below ${config.stop.minStopAtr} × ATR`];
    else if (costPerShare > (config.stop.maxCostToRiskPct / 100) * riskRef) {
      rej = ['costs_too_high', `estimated round-trip costs ${costPerShare.toFixed(4)} per share are ${plan.costToRiskPct.toFixed(1)}% of the ${riskRef.toFixed(4)} risk (limit ${config.stop.maxCostToRiskPct}%)`];
    } else if (mode === 'intraday' && bi.endMs > bi.closeMs - limit * MIN) {
      rej = ['too_close_to_close', `the breakout candle closed ${bi.minutesToClose} minutes before the session close (no new entries in the last ${limit} minutes)`];
    } else if (mode === 'intraday' && bi.isLast) rej = ['next_bar_new_session', 'the next bar is in another session'];
    let sz = null;
    if (!rej) {
      sz = size(st, maxEntry, stop);
      plan.sizing = sz;
      if (sz.code) rej = [sz.code, sz.reason];
      else { plan.shares = sz.shares; plan.plannedRiskWorstCase = sz.plannedRiskWorstCase; }
    }
    const d = { box, signal, plan };
    emit(ms, st.symbol, 'signal', `closed at ${c} above the frozen ceiling ${box.resistance} on ${vol.volumeRatio.toFixed(2)}× average volume`, d);
    if (rej) return reject(st, ms, rej[0], rej[1], d);
    const expectedMs = nextBarStartMs(ms, st.exchange);
    st.order = {
      id: `${mode}-${st.symbol}-${iso(ms)}`, signalAt: iso(ms), signalMs: ms, expectedMs, expectedAt: iso(expectedMs),
      maxEntry, stop, target, shares: sz.shares, plannedRiskWorstCase: sz.plannedRiskWorstCase, reservedCash: sz.reservedCash,
      atr: A, binding, box, signal, plan,
    };
    st.state = 'pending';
    emit(ms, st.symbol, 'order_placed', `buy limit ${sz.shares} at ${maxEntry} for the next bar's open only`, { orderId: st.order.id, shares: sz.shares, maxEntry, stop, target, validFor: iso(expectedMs), plannedRiskWorstCase: sz.plannedRiskWorstCase, sizedBy: sz.sizedBy });
    return null;
  }

  function skipEntry(st, ms, code, reason, details = {}) {
    const o = st.order;
    st.order = null;
    st.state = 'scanning';
    emit(ms, st.symbol, 'entry_skipped', reason, { code, orderId: o.id, maxEntry: o.maxEntry, stop: o.stop, target: o.target, binding: o.binding, gapLimit: o.plan.gapLimit, rrLimit: o.plan.rrLimit, signalAt: o.signalAt, ...details });
  }

  function tryEntry(st, bar, ms, bi) {
    const o = st.order, L = o.maxEntry;
    let raw, kind;
    const flags = [];
    if (bar.o > L + PX_EPS) {
      if (OV.entryFill === 'limit_intrabar' && bar.l <= L + PX_EPS) { raw = L; kind = 'limit'; flags.push('intrabar_limit_entry'); }
      else {
        const lim = o.binding === 'gap' ? `gap limit ${o.plan.gapLimit.toFixed(4)}` : `reward/risk limit ${o.plan.rrLimit.toFixed(4)}`;
        return skipEntry(st, ms, 'above_max_entry', `opened at ${bar.o}, above the maximum entry ${L} (${lim} binding)`, { open: bar.o, low: bar.l });
      }
    } else if (bar.o <= o.stop) {
      return skipEntry(st, ms, 'at_or_below_stop', `opened at ${bar.o}, at or below the stop ${o.stop.toFixed(4)}`, { open: bar.o });
    } else { raw = bar.o; kind = 'market'; }
    const worse = OV.entryWorseAtr * o.atr;
    let shares = o.shares;
    let f = fillCost({ costs, side: 'buy', kind, raw, shares, currency: st.currency, extra: worse });
    const avail = S.cash - reservedCash(st);
    if (-f.cash > avail + 1e-9) {
      shares = largest((x) => -fillCost({ costs, side: 'buy', kind, raw, shares: x, currency: st.currency, extra: worse }).cash, avail, f.price);
      if (shares < 1) return skipEntry(st, ms, 'insufficient_cash', `simulated cash ${avail.toFixed(2)} cannot pay for one share at ${f.price.toFixed(4)}`, { open: bar.o });
      flags.push('reduced_for_cash');
      f = fillCost({ costs, side: 'buy', kind, raw, shares, currency: st.currency, extra: worse });
    }
    if (worse > 0) flags.push('stress_entry_worse');
    S.cash += f.cash;
    const E = f.price;
    const exitAtStop = o.stop * (1 - k);
    const estExitCommission = commission(costs, shares, exitAtStop);
    const estExitFx = fxCost(costs, shares * exitAtStop, st.currency);
    const plannedRisk = shares * (E - exitAtStop) + f.commission + estExitCommission + f.fx + estExitFx;
    const entry = {
      at: iso(ms), raw, price: E, shares, commission: f.commission, spreadSlippage: f.spreadSlippage, fx: f.fx,
      stressWorse: worse, kind, rewardRisk: (o.target - E) / (E - o.stop), plannedRisk, estExitCommission, flags,
    };
    st.position = {
      id: o.id, entryMs: ms, entryDate: bi.date, entryIndex: st.i + 1, exitBy: addSessions(bi.date, holdSessions - 1, st.exchange),
      stop: o.stop, target: o.target, shares, plannedRisk, entry, box: o.box, signal: o.signal,
      plan: { ...o.plan, shares: o.shares, plannedRiskWorstCase: o.plannedRiskWorstCase }, exitOrder: null,
    };
    st.order = null;
    st.state = 'in_position';
    emit(ms, st.symbol, 'entry_filled', `bought ${shares} at ${E.toFixed(4)} (${kind === 'limit' ? `limit fill at ${raw}` : `open ${raw} + spread and slippage`})`, {
      tradeId: o.id, raw, price: E, shares, commission: f.commission, spreadSlippage: f.spreadSlippage, fx: f.fx, rewardRisk: entry.rewardRisk,
      plannedRisk, stop: o.stop, target: o.target, maxEntry: L, flags, exitBy: st.position.exitBy,
    });
    return null;
  }

  function closePosition(st, ms, { raw, kind, reason, holdBars, bar = null, gapThrough = false, ambiguous = false, resolvedBy = null, flags = [], note = null }) {
    const pos = st.position;
    const f = fillCost({ costs, side: 'sell', kind, raw, shares: pos.shares, currency: st.currency });
    S.cash += f.cash;
    const en = pos.entry;
    const gross = pos.shares * (raw - en.raw);
    const costTotal = en.commission + en.spreadSlippage + en.fx + f.commission + f.spreadSlippage + f.fx;
    const net = gross - costTotal;
    const exitDate = localDate(ms, st.exchange);
    const trade = {
      id: pos.id, symbol: st.symbol, exchange: st.exchange, mode, version: config.version, configHash: cHash,
      box: pick(pos.box, ['windowStart', 'windowEnd', 'resistance', 'support', 'height', 'atr', 'touchesUpper', 'touchesLower', 'eligibleAt', 'heightAtr', 'tolerance', 'upperTouchTimes', 'lowerTouchTimes', 'params']),
      signal: pos.signal, plan: pos.plan, entry: en,
      exit: {
        at: iso(ms), reason, raw, price: f.price, kind, commission: f.commission, spreadSlippage: f.spreadSlippage, fx: f.fx,
        gapThrough, ambiguous, resolvedBy, flags, note, targetTrigger: targetTrigger(pos.target),
        bar: bar ? { o: bar.o, h: bar.h, l: bar.l, c: bar.c } : null, orderPlacedAt: pos.exitOrder?.placedAt ?? null,
      },
      pnl: { gross, costs: costTotal, net, r: net / pos.plannedRisk },
      holdBars, holdSessions: sessionsBetween(pos.entryDate, exitDate, st.exchange),
      simulated: true,
    };
    st.position = null;
    st.state = 'scanning';
    const c = S.counters;
    if (ambiguous) c.ambiguousExits++;
    if (gapThrough) { if (reason === 'stop') c.gapThroughStops++; else c.gapThroughTargets++; }
    if (reason === 'end_of_data') c.endOfData++;
    emit(ms, st.symbol, 'exit_filled', `${reason.replace(/_/g, ' ')}: sold ${trade.entry.shares} at ${f.price.toFixed(4)}${gapThrough ? ' (gap through the level at the open)' : ''}${ambiguous ? ` (bar touched stop and target; ${resolvedBy})` : ''}`, {
      tradeId: trade.id, reason, raw, price: f.price, shares: pos.shares, net, r: trade.pnl.r, gapThrough, ambiguous, resolvedBy, flags,
    });
    hist.trades.push(trade);
    out.closedTrades.push(trade);
    return trade;
  }

  function pick(o, keys) {
    const r = {};
    for (const key of keys) if (o?.[key] !== undefined) r[key] = o[key];
    return r;
  }

  // Exits at the bar's open: gap through the stop or target, or a time-exit
  // market order placed at the previous close.
  function openExits(st, bar, ms) {
    const pos = st.position;
    const curIndex = st.i + 1;
    const held = curIndex - pos.entryIndex;
    if (bar.o <= pos.stop) return closePosition(st, ms, { raw: bar.o, kind: 'stop', reason: 'stop', gapThrough: true, holdBars: held, bar });
    if (bar.o >= targetTrigger(pos.target) - PX_EPS) return closePosition(st, ms, { raw: bar.o, kind: 'limit', reason: 'target', gapThrough: true, holdBars: held, bar });
    if (pos.exitOrder) return closePosition(st, ms, { raw: bar.o, kind: 'market', reason: pos.exitOrder.reason, holdBars: held, bar });
    return null;
  }

  // Lower-timeframe bars in time order; a sub-bar touching both falls back to stop first.
  function scanSubBars(list, stop, trigger) {
    for (const b of list) {
      const s = b.l <= stop, g = b.h >= trigger - PX_EPS;
      if (s && g) return { which: 'stop', resolvedBy: 'lower_timeframe_stop_first', at: b.t };
      if (s) return { which: 'stop', resolvedBy: 'lower_timeframe', at: b.t };
      if (g) return { which: 'target', resolvedBy: 'lower_timeframe', at: b.t };
    }
    return null;
  }

  function intrabarExits(st, bar, ms) {
    const pos = st.position;
    const trigger = targetTrigger(pos.target);
    const stopHit = bar.l <= pos.stop;
    let targetHit = bar.h >= trigger - PX_EPS;
    // An intrabar limit entry filled on the way down to the low: on TradingView's
    // path (open -> nearer extreme -> other extreme) the high only follows the
    // fill when the low comes first, and then the low (stop) precedes the high.
    if (pos.entryMs === ms && pos.entry.kind === 'limit') {
      if (stopHit || bar.o - bar.l > bar.h - bar.o) targetHit = false;
    }
    if (!stopHit && !targetHit) return null;
    let which = stopHit ? 'stop' : 'target', ambiguous = false, resolvedBy = null, note = null;
    const flags = [];
    if (stopHit && targetHit) {
      ambiguous = true;
      const sub = subBars?.get(st.symbol)?.get(iso(ms));
      const r = sub?.length ? scanSubBars(sub, pos.stop, trigger) : null;
      if (r) { ({ which, resolvedBy } = r); note = `decided by the lower-timeframe bar starting ${r.at}`; }
      else {
        if (sub?.length) flags.push('lower_timeframe_inconclusive');
        resolvedBy = OV.ambiguity;
        if (OV.ambiguity === 'stop_first') which = 'stop';
        else if (OV.ambiguity === 'target_first') which = 'target';
        // TradingView's assumed path: open -> the extreme nearer the open -> the other extreme -> close (a tie goes low first).
        else which = bar.h - bar.o < bar.o - bar.l ? 'target' : 'stop';
      }
    }
    const holdBars = st.i + 1 - pos.entryIndex + 1;
    return which === 'stop'
      ? closePosition(st, ms, { raw: pos.stop, kind: 'stop', reason: 'stop', ambiguous, resolvedBy, flags, holdBars, bar, note })
      : closePosition(st, ms, { raw: pos.target, kind: 'limit', reason: 'target', ambiguous, resolvedBy, flags, holdBars, bar, note });
  }

  // The time exit could not fill in its session: close at the last bar's close.
  function fallbackClose(st, ms, why) {
    const pos = st.position;
    return closePosition(st, ms, {
      raw: st.lastBar.c, kind: 'market', reason: 'session_end_fallback', holdBars: st.i - pos.entryIndex + 1,
      flags: ['session_end_fallback'], note: `${why}; closed at the last bar's close (${st.lastBar.t})`,
    });
  }

  // ---------- closes ----------

  function closeBar(st, bar, ms, bi) {
    st.i++;
    st.hist.push({ t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v, date: bi.date });
    if (st.hist.length > HIST) st.hist.shift();
    atrUpdate(st.atr, bar, bp.atrLength);
    st.lastBar = { t: bar.t, c: bar.c };
    if (st.position) return timeExit(st, ms, bi);
    if (st.state === 'armed') {
      const res = armedStep(st.box, bar, st.i, bp);
      if (res === 'invalidated' || res === 'expired') {
        const box = st.box;
        retireBox(st, res, st.i);
        emit(ms, st.symbol, res === 'expired' ? 'setup_expired' : 'setup_invalidated',
          res === 'expired' ? `no close above the ceiling ${box.resistance} within ${bp.setupExpiryBars} bars` : `closed at ${bar.c} below support ${box.support}`,
          { boxEligibleAt: box.eligibleAt, resistance: box.resistance, support: box.support, close: bar.c, barsSinceEligible: st.i - box.windowEndIndex });
      } else if (res === 'breakout') {
        const box = st.box;
        retireBox(st, 'consumed', st.i); // one decision per box, whatever happens next
        if (ms >= tradeFromMs()) onBreakout(st, bar, ms, bi, box);
      }
    }
    if (st.state === 'scanning') {
      const box = detectBox(st.hist, st.i, st.atr.atr, bp, st.nextWindowStartMin);
      if (box) {
        st.box = box;
        st.state = 'armed';
        emit(ms, st.symbol, 'setup_eligible', `box ${box.support}–${box.resistance} (${box.heightAtr.toFixed(2)} × ATR) with ${box.touchesUpper} ceiling and ${box.touchesLower} floor touches`, { box });
      }
    }
    return null;
  }

  function timeExit(st, ms, bi) {
    const pos = st.position;
    if (bi.date < pos.exitBy) return null;
    if (bi.isLast) return fallbackClose(st, ms, pos.exitOrder ? 'the time-exit order had no bar left in the session' : 'the session ended before the time-exit bar');
    if (!pos.exitOrder && bi.endMs >= bi.closeMs - flattenMin * MIN) {
      pos.exitOrder = { reason: timeExitReason, placedAt: iso(ms), expectedAt: iso(bi.endMs) };
      emit(ms, st.symbol, 'exit_order', `${timeExitReason === 'flatten' ? 'intraday flatten' : `session ${holdSessions} of ${holdSessions}`}: market sell at the next bar's open`, { tradeId: pos.id, reason: timeExitReason, shares: pos.shares, fillAt: iso(bi.endMs) });
    }
    return null;
  }

  // ---------- one timestamp ----------

  function barProblem(bar, ms, bi) {
    if (!bi.inSession) return `bar outside the regular session (${bi.reason})`;
    if (!bi.aligned) return 'bar not on the 15-minute grid';
    if (bar.t != null && toMs(bar.t) !== ms) return `bar time ${bar.t} does not match the timestamp`;
    const o = +bar.o, h = +bar.h, l = +bar.l, c = +bar.c;
    if (![o, h, l, c].every(Number.isFinite)) return 'non-numeric price';
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) return 'non-positive price';
    if (h < l || o > h || o < l || c > h || c < l) return 'inconsistent high/low';
    return null;
  }

  function processTimestamp(t, barsBySymbol) {
    if (S.finished) throw new Error('The engine has finished (end of data); create a new engine to continue');
    const ms = toMs(t);
    if (!Number.isFinite(ms)) throw new Error(`Invalid timestamp ${t}`);
    if (S.lastMs != null && ms <= S.lastMs) throw new Error(`Timestamp ${iso(ms)} is not after the last processed bar ${iso(S.lastMs)}`);
    out = { events: [], closedTrades: [] };
    const T = iso(ms);
    const info = new Map();
    const biOf = (st) => {
      const g = exchangeGroup(st.exchange);
      if (!info.has(g)) info.set(g, barInfo(ms, st.exchange));
      return info.get(g);
    };
    const cur = new Map();
    const entries = barsBySymbol instanceof Map ? barsBySymbol.entries() : Object.entries(barsBySymbol || {});
    for (const [sym, bar] of entries) {
      if (!bar) continue;
      const st = S.symbols[sym];
      if (!st) { emit(ms, sym, 'data_warning', 'bar for a symbol that is not in this run', { code: 'unknown_symbol' }); continue; }
      const p = barProblem(bar, ms, biOf(st));
      if (p) { emit(ms, sym, 'data_warning', `${p}; bar ignored`, { code: 'bad_bar', bar }); continue; }
      cur.set(sym, { t: T, o: +bar.o, h: +bar.h, l: +bar.l, c: +bar.c, v: volumeOf(bar.v) });
    }

    // 1. opens (alphabetical): pending entries, gap exits, time-exit fills
    for (const sym of order) {
      const st = S.symbols[sym], bar = cur.get(sym), bi = biOf(st);
      if (st.position) {
        if (bi.date > st.position.exitBy) fallbackClose(st, sessionBounds(st.position.exitBy, st.exchange).closeMs, 'the session ended before the time exit filled');
        else if (bar) openExits(st, bar, ms);
      } else if (st.order && ms >= st.order.expectedMs) {
        if (bar && ms === st.order.expectedMs) tryEntry(st, bar, ms, bi);
        else skipEntry(st, ms, 'no_next_bar', 'no next bar', { expectedAt: st.order.expectedAt });
      }
    }
    // 2. intrabar exits (including positions entered at this open)
    for (const sym of order) {
      const st = S.symbols[sym], bar = cur.get(sym);
      if (st.position && bar) intrabarExits(st, bar, ms);
    }
    // 3. closes (alphabetical): indicators, time exits, boxes, signals. Every
    // symbol's close at T is known at T's close, so equity uses all of them.
    for (const [sym, bar] of cur) S.symbols[sym].lastBar = { t: bar.t, c: bar.c };
    for (const sym of order) {
      const st = S.symbols[sym], bar = cur.get(sym), bi = biOf(st);
      if (bar) closeBar(st, bar, ms, bi);
      else if (st.position && bi.inSession && bi.isLast && bi.date >= st.position.exitBy) {
        fallbackClose(st, ms, 'no bar for the time exit before the session ended');
      }
    }
    S.lastMs = ms;
    if (ms >= tradeFromMs()) hist.equityCurve.push(equityPoint(T));
    const r = out;
    out = null;
    return r;
  }

  function equityPoint(T) {
    let gross = 0, n = 0;
    for (const st of syms()) if (st.position) { gross += st.position.shares * lastClose(st); n++; }
    return { t: T, equity: S.cash + gross, cash: S.cash, positions: n, openRisk: openRiskNow(), grossExposure: gross };
  }

  // End of data: open positions close at their last close (flagged), pending
  // orders lapse.
  function finish() {
    if (S.finished) return { events: [], closedTrades: [] };
    out = { events: [], closedTrades: [] };
    const lastMs = S.lastMs ?? 0;
    for (const sym of order) {
      const st = S.symbols[sym];
      if (st.order) skipEntry(st, lastMs, 'end_of_data', 'no next bar (end of data)', { expectedAt: st.order.expectedAt });
      if (st.position) {
        closePosition(st, toMs(st.lastBar.t), {
          raw: st.lastBar.c, kind: 'market', reason: 'end_of_data', holdBars: st.i - st.position.entryIndex + 1,
          flags: ['end_of_data'], note: 'still open at the end of the data; closed at the last close',
        });
      }
    }
    S.finished = true;
    const lastPt = hist.equityCurve[hist.equityCurve.length - 1];
    if (lastPt && S.lastMs != null && lastPt.t === iso(S.lastMs)) Object.assign(lastPt, equityPoint(lastPt.t));
    const r = out;
    out = null;
    return r;
  }

  // For the forward test (the engine has no clock): cancel a pending entry,
  // e.g. a signal whose bar was not processed in time. Journalled as a skip.
  function cancelOrder(symbol, { code = 'stale_signal', reason = 'the signal was not processed in time; the order was cancelled', at = null } = {}) {
    const st = S.symbols[symbol];
    if (!st?.order) return { events: [], closedTrades: [] };
    out = { events: [], closedTrades: [] };
    skipEntry(st, at != null ? toMs(at) : S.lastMs ?? st.order.signalMs, code, reason);
    const r = out;
    out = null;
    return r;
  }

  // Data warnings and operational errors noted by the caller (late bars,
  // provider errors), kept in the same journal.
  function journal({ type, symbol = null, reason, details = {}, at = null }) {
    if (!['data_warning', 'operational_error'].includes(type)) throw new Error('journal() takes data_warning or operational_error');
    out = { events: [], closedTrades: [] };
    emit(at != null ? toMs(at) : S.lastMs ?? 0, symbol, type, reason, details);
    const r = out;
    out = null;
    return r;
  }

  function account() {
    const positions = syms().filter((st) => st.position).map((st) => {
      const p = st.position, px = lastClose(st);
      return {
        symbol: st.symbol, tradeId: p.id, shares: p.shares, entryAt: p.entry.at, entryPrice: p.entry.price, stop: p.stop, target: p.target,
        lastClose: px, lastBarAt: st.lastBar?.t ?? null, marketValue: p.shares * px, unrealized: p.shares * (px - p.entry.price) - p.entry.commission - p.entry.fx,
        plannedRisk: p.plannedRisk, exitBy: p.exitBy, exitOrder: p.exitOrder,
      };
    });
    const pendingOrders = syms().filter((st) => st.order).map((st) => {
      const o = st.order;
      return { symbol: st.symbol, orderId: o.id, signalAt: o.signalAt, validFor: o.expectedAt, maxEntry: o.maxEntry, stop: o.stop, target: o.target, shares: o.shares, plannedRiskWorstCase: o.plannedRiskWorstCase, reservedCash: o.reservedCash };
    });
    return {
      simulated: true, currency: costs.accountCurrency, startingEquity: S.startingEquity, cash: S.cash, equity: equityNow(),
      reservedCash: reservedCash(), openRisk: openRiskNow(), positions, pendingOrders, lastProcessed: S.lastMs != null ? iso(S.lastMs) : null,
    };
  }

  function activeSetups() {
    return syms().filter((st) => st.state === 'armed' && st.box).map((st) => ({
      symbol: st.symbol, state: st.state, eligibleAt: st.box.eligibleAt, barsSinceEligible: st.i - st.box.windowEndIndex,
      barsLeft: bp.setupExpiryBars - (st.i - st.box.windowEndIndex), box: clone(st.box),
    }));
  }

  function summary() {
    const c = S.counters;
    return {
      breakouts: c.breakouts, signals: c.signals, ordersPlaced: c.ordersPlaced, entries: c.entries, exits: c.exits,
      setupsEligible: c.setupsEligible, setupsExpired: c.setupsExpired, setupsInvalidated: c.setupsInvalidated,
      rejectedByReason: { ...c.rejectedByReason }, skippedByReason: { ...c.skippedByReason },
      ambiguousExits: c.ambiguousExits, gapThroughStops: c.gapThroughStops, gapThroughTargets: c.gapThroughTargets,
      endOfData: c.endOfData, dataWarnings: c.dataWarnings,
    };
  }

  return {
    processTimestamp, finish, account, activeSetups, summary, cancelOrder, journal,
    snapshot: ({ history = false } = {}) => {
      const s = clone(S);
      if (history) s.history = clone(hist);
      return s;
    },
    symbolState: (sym) => S.symbols[sym]?.state ?? null,
    get trades() { return hist.trades; },
    get events() { return hist.events; },
    get equityCurve() { return hist.equityCurve; },
    get configHash() { return cHash; },
    get overrides() { return { ...OV }; },
    get lastProcessed() { return S.lastMs != null ? iso(S.lastMs) : null; },
    get mode() { return mode; },
  };
}

// Full backtest over in-memory bars. bars: Map<symbol, Bar[]> (or an object);
// from/to/tradeFrom: dates (exchange-local, inclusive) or ISO instants.
export function runBacktest({ config, mode, bars, symbols, from = null, to = null, tradeFrom = null, overrides = {}, lowerTf = null, synthetic = false } = {}) {
  const list = normSymbols(symbols, bars);
  const fromMs = boundMs(from), toMs_ = boundMs(to, true);
  const get = (s) => (bars instanceof Map ? bars.get(s) : bars?.[s]) || [];
  const series = new Map();
  let dupes = 0, isSynthetic = !!synthetic || bars?.synthetic === true;
  for (const s of list) {
    const src = get(s.symbol);
    if (src.synthetic === true || src[0]?.synthetic === true) isSynthetic = true;
    const rows = [];
    for (const b of src) {
      const ms = toMs(b.t);
      if (Number.isFinite(ms) && ms >= fromMs && ms <= toMs_) rows.push({ ms, bar: b });
    }
    rows.sort((a, b) => a.ms - b.ms);
    const uniq = [];
    for (const r of rows) { if (uniq.length && uniq[uniq.length - 1].ms === r.ms) dupes++; else uniq.push(r); }
    series.set(s.symbol, uniq);
  }
  const engine = createEngine({ config, mode, symbols: list, tradeFrom: tradeFrom ?? from, lowerTf, overrides });
  const ptr = new Map(list.map((s) => [s.symbol, 0]));
  let first = null, last = null;
  for (;;) {
    let next = Infinity;
    for (const s of list) {
      const arr = series.get(s.symbol), p = ptr.get(s.symbol);
      if (p < arr.length && arr[p].ms < next) next = arr[p].ms;
    }
    if (next === Infinity) break;
    const map = new Map();
    for (const s of list) {
      const arr = series.get(s.symbol), p = ptr.get(s.symbol);
      if (p < arr.length && arr[p].ms === next) { map.set(s.symbol, arr[p].bar); ptr.set(s.symbol, p + 1); }
    }
    if (first == null) first = next;
    last = next;
    engine.processTimestamp(next, map);
  }
  engine.finish();
  const hashed = new Map([...series].map(([sym, rows]) => [sym, rows.map((r) => r.bar)]));
  const ex = list[0]?.exchange || 'NYSE';
  const dateOf = (v, ms) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : v != null ? iso(boundMs(v)) : ms != null ? localDate(ms, ex) : null);
  const ov = engine.overrides;
  return {
    meta: {
      strategy: config.strategy, version: config.version, configHash: engine.configHash, engineVersion: ENGINE_VERSION, mode,
      from: dateOf(from, first), to: dateOf(to, last), tradeFrom: dateOf(tradeFrom ?? from, first),
      firstBar: first != null ? iso(first) : null, lastBar: last != null ? iso(last) : null,
      symbols: list.map((s) => s.symbol), bars: [...series.values()].reduce((a, r) => a + r.length, 0), duplicateBarsIgnored: dupes,
      dataHash: datasetHash(hashed), ambiguity: ov.ambiguity, entryFill: ov.entryFill, entryWorseAtr: ov.entryWorseAtr,
      lowerTimeframe: !!lowerTf, synthetic: isSynthetic, simulated: true,
      startingEquity: config.risk.hypotheticalStartingEquity,
    },
    trades: engine.trades, events: engine.events, equityCurve: engine.equityCurve,
    summary: engine.summary(), account: engine.account(),
  };
}
