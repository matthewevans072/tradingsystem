// ICT Lab engine (strategy/ict-lab/CONCEPTS.md "Decision order inside a session"; PROTOCOL.md sections 5 and 6):
// one spec, one window, long only. Deterministic and free of look-ahead: a session's decisions use its own bars
// up to the decision bar and the previous session's daily low; orders fill on later bars at prices they trade
// through; the stop comes first on an ambiguous bar. No clock, no randomness. Prices are integer units of 0.0001
// (rules.js); cash is whole cents. Simulation only: no account, order or broker code exists here; the "dollar
// account" is arithmetic on the trade list (PROTOCOL.md 6.2).
//
// Every number comes from the spec: the swing settings, the sweep window, the decision and fill cutoffs, the
// buffer, the minimum stop distance, the R multiple, the minimum zone height, the starting cash, the risk
// fraction, the costs and the breaker coupling limit.
import { previousTradingDay } from '../calendar.js';
import { ENGINE_VERSION } from './config.js';
import { toU, fromU, CENT, priorSessionLow, isSweepBar, sweepExtreme, bosAt, bullishFvg, inversionAt, orderBlock, mostRecentBearishBlock, blockFails, breakerCoupling, stopFrom, entryOf, fillIndex, simulateExit, targetOf, zoneUsable, sizeTrade, rOf, pnlCents } from './rules.js';

export { ENGINE_VERSION };
// The funnel stage every session ends in (PROTOCOL.md section 11).
export const STAGES = Object.freeze(['incomplete', 'no_prior_session', 'no_sweep', 'no_confirmation', 'no_zone', 'zone_too_small', 'entry_not_below_close', 'stop_too_close', 'unfunded', 'order_expired', 'filled']);
export const REFUSAL_STAGES = Object.freeze(['no_zone', 'zone_too_small', 'entry_not_below_close', 'stop_too_close', 'unfunded']);
export const EXIT_KINDS = Object.freeze(['stop', 'stop_same_bar', 'target', 'time']);
const OPEN_MINUTES = 9 * 60 + 30;

// The confirmation the spec requires (section 5): 'bos' (specs 1 and 2), 'inversion' (spec 3), 'breaker' (spec 4).
export function setupKindOf(spec) {
  const req = [...(spec.setup?.requires || [])].sort().join('+');
  if (req === 'break_of_structure') return 'bos';
  if (req === 'inversion_fvg') return 'inversion';
  if (req === 'break_of_structure+breaker') return 'breaker';
  throw new Error(`unknown setup.requires ${JSON.stringify(spec.setup?.requires)}`);
}

const sortBars = (bars) => [...bars].sort((a, b) => a.idx - b.idx).map((b) => ({ idx: b.idx, o: toU(b.o), h: toU(b.h), l: toU(b.l), c: toU(b.c) }));
const cents = (u) => Math.round(u / CENT);
const dollars = (c) => c / 100;

// A fresh state, or one restored from a snapshot (plain JSON, so a run can be cut and resumed).
function initialState(spec, startingCash) {
  const cashCents = Math.round(startingCash * 100);
  const stageCounts = {};
  for (const s of STAGES) stageCounts[s] = 0;
  return {
    cashCents, peakCents: cashCents, lowestCents: cashCents, maxDrawdownCents: 0, startingCashCents: cashCents,
    trades: [], records: [], stageCounts, exitCounts: { stop: 0, stop_same_bar: 0, target: 0, time: 0 },
    funnel: { sessions: 0, tradeable: 0, sweeps: 0, confirmed: 0, usableZone: 0, orders: 0, fills: 0 },
    counts: { cashCapped: 0, unfunded: 0, lossExceededRisk: 0, refusedConfirmations: 0 },
    prev: null, fed: 0, completeSessions: [],
  };
}

// createEngine({ spec, startingCash, restore }): feed(session) decides one session; snapshot() is plain JSON
// (pass it back as `restore` to continue a cut run);
// result() is the run so far. Sessions are fed in date order, each with its own daily bar (or null), and
// `inWindow` says whether the session is decided (sessions before the window only serve as prior sessions).
export function createEngine({ spec, startingCash = spec.account.startingCashUsd, restore = null, keepSessionBars = true } = {}) {
  const kind = setupKindOf(spec);
  const swing = { leftBars: spec.swing.leftBars, rightBars: spec.swing.rightBars, confirmBarOffset: spec.swing.confirmBarOffset };
  const bufferU = toU(spec.stop.bufferDollars), minDistU = toU(spec.stop.minDistanceDollars), minHeightU = toU(spec.zones.minHeightDollars);
  const perSideU = toU(spec.costs.perSide), perSide2U = toU(spec.costs.perSide * spec.costs.sensitivityMultiple), perSideCents = cents(perSideU);
  const rMultiple = spec.target.rMultiple, riskFraction = spec.account.maxPlannedRiskFraction;
  const sweepFirst = spec.sweep.window.firstBarIndex, sweepLast = spec.sweep.window.lastBarIndex;
  const lastDecision = spec.timeWindow.lastDecisionBarIndex, lastFillSpec = spec.timeWindow.lastFillBarIndex;
  const maxApart = spec.setup.coupling?.maxBarsApart ?? null, maxAge = spec.setup.bearishFvg?.maxAgeBars ?? null;
  const zoneKind = spec.entry.zone;
  const state = restore ? JSON.parse(JSON.stringify(restore)) : initialState(spec, startingCash);

  function feed({ date, full, bars: rawBars, daily = null, inWindow = true }) {
    const bars = sortBars(rawBars);
    const n = bars.length;
    const complete = n === full && bars.every((b, i) => b.idx === i);
    const prev = state.prev;
    state.prev = { date, complete, dailyL: daily ? toU(daily.l) : null };
    state.fed++;
    if (!inWindow) return null;
    state.funnel.sessions++;
    if (complete && keepSessionBars) state.completeSessions.push({ date, bars });
    const rec = { session: date, stage: null, sweepIdx: null, confirmations: 0, refusals: [], usableZone: false, orderPlaced: false };
    const end = (stage, extra = {}) => { rec.stage = stage; Object.assign(rec, extra); state.records.push(rec); state.stageCounts[stage]++; return rec; };
    if (!complete) return end('incomplete', { bars: n, full });
    const prevDate = previousTradingDay(date, 'NYSE');
    if (!prev || prev.date !== prevDate || !prev.complete || prev.dailyL == null) return end('no_prior_session', { prevDate });
    state.funnel.tradeable++;
    const pdl = priorSessionLow({ l: prev.dailyL });
    rec.pdl = fromU(pdl);
    const lastK = Math.min(lastDecision, n - 1), lastFill = Math.min(lastFillSpec, n - 1);
    let setup = null, order = null, lastRefusal = null;
    const bosBars = [], failEvents = [];
    for (let k = 0; k <= lastK; k++) {
      const bar = bars[k];
      // (2) no setup yet: a sweep bar inside the window opens it; nothing is tested before a sweep. The sweep bar
      // itself then goes through steps (3) and (4), where every confirmation needs a bar after s (H6, H10, H13).
      if (!setup) {
        if (k >= sweepFirst && k <= sweepLast && isSweepBar(bar, pdl)) { setup = { s: k }; rec.sweepIdx = k; state.funnel.sweeps++; }
        else continue;
      }
      // (3) the sweep extreme up to this close (fixed when an order is placed).
      const { extreme, lambda } = sweepExtreme(bars, setup.s, k);
      // (4) the spec's confirmation test on bar k.
      let conf = null;
      if (kind === 'bos') {
        const bos = k > setup.s ? bosAt(bars, k, swing) : { ok: false };
        if (bos.ok) {
          const zone = zoneKind === 'fair_value_gap' ? bullishFvg(bars, lambda, k) : orderBlock(bars, lambda);
          conf = { kind: 'bos', bosIdx: k, swingIdx: bos.swingIndex, swingLevel: bos.level, zone, anchors: [extreme], anchorNames: ['sweep_extreme'] };
        }
      } else if (kind === 'inversion') {
        const zone = inversionAt(bars, k, setup.s, { maxAgeBars: maxAge });
        if (zone) conf = { kind: 'inversion', inversionIdx: k, zone, anchors: [zone.lo, extreme], anchorNames: ['inverted_gap_lower_bound', 'sweep_extreme'] };
      } else {
        if (k > setup.s && bosAt(bars, k, swing).ok) bosBars.push(k);
        // A block fails once: on the first close above its upper bound after the sweep bar (later bars that stay
        // above it are not new failures).
        const block = mostRecentBearishBlock(bars, k, swing);
        if (k > setup.s && block && !failEvents.some((e) => e.block.breakIndex === block.breakIndex) && blockFails(bar, block)) failEvents.push({ f: k, block });
        const pair = breakerCoupling(failEvents, bosBars, k, maxApart);
        if (pair) conf = { kind: 'breaker', failIdx: pair.f, bosIdx: pair.kBos, zone: pair.block, anchors: [pair.block.lo, extreme], anchorNames: ['breaker_lower_bound', 'sweep_extreme'] };
      }
      if (!conf) continue;
      rec.confirmations++;
      // (5) the zone, the entry, the stop, the target, the checks and the sizing; a refusal re-arms (H15).
      const refuse = (stage, detail = {}) => { rec.refusals.push({ k, stage, ...detail }); lastRefusal = stage; state.counts.refusedConfirmations++; };
      const zone = conf.zone;
      if (!zone) { refuse('no_zone'); continue; }
      if (!zoneUsable(zone, minHeightU)) { refuse('zone_too_small', { height: fromU(zone.hi - zone.lo) }); continue; }
      const entry = entryOf(zone.lo, zone.hi);
      if (!(entry < bar.c)) { refuse('entry_not_below_close', { entry: fromU(entry), close: fromU(bar.c) }); continue; }
      const anchor = Math.min(...conf.anchors);
      const stop = stopFrom(conf.anchors, bufferU);
      const dist = entry - stop;
      if (dist < minDistU) { refuse('stop_too_close', { stopDistance: fromU(dist) }); continue; }
      rec.usableZone = true;
      const target = targetOf(entry, dist, rMultiple);
      const size = sizeTrade({ cashCents: state.cashCents, entryCents: cents(entry), stopDistanceCents: cents(dist), perSideCents, maxRiskFraction: riskFraction });
      if (size.unfunded) { state.counts.unfunded++; refuse('unfunded', { sharesRisk: size.sharesRisk, sharesCash: size.sharesCash }); continue; }
      // (6) the order, at the close of bar k; the extreme is fixed here.
      order = { k, conf, zone, entry, stop, anchor, dist, target, size, extreme, lambda, cashBeforeCents: state.cashCents };
      rec.orderPlaced = true;
      break;
    }
    if (rec.confirmations) state.funnel.confirmed++;
    if (rec.usableZone) state.funnel.usableZone++;
    if (!order) {
      if (!setup) return end('no_sweep');
      return end(rec.confirmations ? lastRefusal : 'no_confirmation', { sweepIdx: setup.s });
    }
    state.funnel.orders++;
    const orderInfo = { confirmKind: order.conf.kind, confirmIdx: order.k, zone: { type: order.zone.type, index: order.zone.index, lo: fromU(order.zone.lo), hi: fromU(order.zone.hi), height: fromU(order.zone.hi - order.zone.lo) }, entry: fromU(order.entry), stop: fromU(order.stop), target: fromU(order.target), stopDistance: fromU(order.dist), shares: order.size.shares, cashCapped: order.size.cashCapped };
    const m = fillIndex(bars, order.k, lastFill, order.entry);
    if (m == null) return end('order_expired', orderInfo);
    state.funnel.fills++;
    const ex = simulateExit(bars, m, order.stop, order.target);
    const R = rOf(order.entry, ex.exit, order.dist, perSideU), R2x = rOf(order.entry, ex.exit, order.dist, perSide2U);
    const pnl = pnlCents(order.size.shares, cents(order.entry), cents(ex.exit), perSideCents);
    state.cashCents += pnl;
    if (state.cashCents > state.peakCents) state.peakCents = state.cashCents;
    if (state.cashCents < state.lowestCents) state.lowestCents = state.cashCents;
    state.maxDrawdownCents = Math.max(state.maxDrawdownCents, state.peakCents - state.cashCents);
    if (order.size.cashCapped) state.counts.cashCapped++;
    const lossExceededRisk = pnl < -order.size.plannedRiskActualCents;
    if (lossExceededRisk) state.counts.lossExceededRisk++;
    const hoursHeld = {};
    for (let i = m; i <= ex.exitIndex; i++) { const hr = Math.floor((OPEN_MINUTES + i * 5) / 60); hoursHeld[hr] = (hoursHeld[hr] || 0) + 1; }
    const c = order.conf;
    const trade = {
      session: date, pdl: fromU(pdl), sweepIdx: setup.s, sweepExtreme: fromU(order.extreme), legExtremeIdx: order.lambda,
      confirmKind: c.kind, confirmIdx: order.k, bosIdx: c.bosIdx ?? null, swingIdx: c.swingIdx ?? null, swingLevel: c.swingLevel == null ? null : fromU(c.swingLevel), inversionIdx: c.inversionIdx ?? null, failIdx: c.failIdx ?? null,
      zone: orderInfo.zone, anchor: fromU(order.anchor), anchorNames: c.anchorNames, entry: fromU(order.entry), stop: fromU(order.stop), stopDistance: fromU(order.dist), target: fromU(order.target),
      shares: order.size.shares, sharesRisk: order.size.sharesRisk, sharesCash: order.size.sharesCash, cashCapped: order.size.cashCapped, plannedRiskMax: dollars(order.size.plannedRiskMaxCents), plannedRiskActual: dollars(order.size.plannedRiskActualCents), cashBefore: dollars(order.cashBeforeCents),
      fillIdx: m, exitIdx: ex.exitIndex, exitPrice: fromU(ex.exit), exitKind: ex.kind, sameBar: ex.kind === 'stop_same_bar', R, R2x, costPerSide: spec.costs.perSide,
      pnl: dollars(pnl), cashAfter: dollars(state.cashCents), lossExceededRisk, holdingMinutes: (ex.exitIndex - m) * 5 + 5, barsHeld: ex.exitIndex - m + 1, hoursHeld, refusalsBefore: rec.refusals.length,
    };
    state.trades.push(trade);
    state.exitCounts[ex.kind]++;
    return end('filled', { ...orderInfo, fillIdx: m, exitIdx: ex.exitIndex, exitKind: ex.kind, R });
  }

  function snapshot() { return JSON.parse(JSON.stringify(state)); }

  function result({ withSessions = true } = {}) {
    const s = state;
    return {
      engineVersion: ENGINE_VERSION, spec: { name: spec.name, version: spec.version, file: spec.file ?? null, hash: spec.hash ?? null, setupKind: kind, zone: zoneKind },
      costPerSide: spec.costs.perSide, sensitivity: spec.costs.sensitivityMultiple, rMultiple,
      sessionsInWindow: s.funnel.sessions, trades: s.trades, sessions: s.records, stageCounts: s.stageCounts, exitCounts: s.exitCounts, funnel: { ...s.funnel }, counts: { ...s.counts },
      account: { startingCash: dollars(s.startingCashCents), endingCash: dollars(s.cashCents), maxDrawdown: dollars(s.maxDrawdownCents), lowestCash: dollars(s.lowestCents), trades: s.trades.length, cashCapped: s.counts.cashCapped, unfunded: s.counts.unfunded, lossExceededRisk: s.counts.lossExceededRisk, maxPlannedRiskFraction: riskFraction },
      completeSessions: withSessions ? s.completeSessions : undefined,
    };
  }

  return { feed, snapshot, result, state };
}

// runSpec({ spec, daily, sessions, window, startingCash }): the whole window in one call. `daily` are the daily
// bars [{ date, o, h, l, c }] and `sessions` the 5-minute sessions [{ date, full, bars }], both in any order; every
// session on or before the window's end is fed (earlier ones only as prior sessions), so a run cut at session T
// decides what the full run decided up to T.
export function runSpec({ spec, daily, sessions, window, startingCash = spec.account.startingCashUsd, keepSessionBars = true }) {
  const dailyByDate = new Map(daily.map((d) => [d.date, d]));
  const S = [...sessions].filter((s) => s.date <= window.end).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const engine = createEngine({ spec, startingCash, keepSessionBars });
  for (const s of S) engine.feed({ date: s.date, full: s.full, bars: s.bars, daily: dailyByDate.get(s.date) ?? null, inWindow: s.date >= window.start && s.date <= window.end });
  return { ...engine.result(), window: { start: window.start, end: window.end } };
}

// Counts only, from a run result (PROTOCOL.md section 11's funnel): sessions, sessions with a sweep, sessions
// with a confirmed setup, sessions with a usable zone, orders placed, fills. Nothing about outcomes or R.
export function countsOf(r) {
  const f = r.funnel;
  return { sessions: f.sessions, tradeable: f.tradeable, sweeps: f.sweeps, confirmations: f.confirmed, zones: f.usableZone, orders: f.orders, fills: f.fills };
}
