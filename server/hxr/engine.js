// The HXR engine (strategy/hxr/ENGINE-SPEC.md sections 2-6): equal sleeves
// that start fully invested, exit to cash when a price rule says a stock's
// trend broke and buy it back when the rule says it recovered. A simulated
// ledger only: it never reads the real portfolio or the Strategy Lab, and it
// never places, routes or prepares an order anywhere.
//
// Streaming: processSession(date, day) handles one NYSE session after its
// close and uses only data dated on or before it plus the calendar, so a run
// cut at T decides exactly what a full run decided up to T. No clock, no
// randomness; every id is derived from the data. snapshot() is plain JSON and
// createEngine({ state }) continues exactly as an uninterrupted run would.
import crypto from 'node:crypto';
import { configHash, canonicalJson } from '../strategy/config.js';
import { isTradingDay, nextTradingDay } from '../calendar.js';

export const ENGINE_VERSION = 'hxr-engine-3'; // hxr-engine-1 and -2 behaviour unchanged; adds risk sizing, the initial-loss rule, the pause and the fresh-entry policies (hxr-prereg-3a)
const STATE_FORMAT = 'hxr-engine-state-1';
export const RULE_TYPES = ['hold', 'ma_band', 'vol_trail', 'pct_trail', 'recovery_break', 'move_allowance', 'giveback'];
// hxr-prereg-2 (PREREGISTRATION-2.md section 3): exit rules that share one
// buy-back rule (a confirmed recovery point, filling only below the exit price).
export const BUY_BACK_RULES = ['recovery_break', 'move_allowance', 'giveback'];
export const MISSED_REBOUND_POLICIES = ['stay_out', 'fresh_entry_recovery_point', 'fresh_entry_after_sessions'];
export const FILL_MODELS = ['open', 'vw15'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EPS = 1e-9;
const VW15_MISSING = 'vw15_missing_open_used';
const clone = (o) => JSON.parse(JSON.stringify(o));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Anchors are stored as null for "not set" (JSON has no infinities): null is
// -Infinity for anchorHigh and +Infinity for anchorLow.
const maxOf = (a, c) => (a == null ? c : Math.max(a, c));
const minOf = (a, c) => (a == null ? c : Math.min(a, c));

// ---------- sessions (NYSE calendar, excluded sessions skipped) ----------

export function exclusionSet(excluded = []) {
  if (excluded instanceof Set) return excluded;
  return new Set((excluded || []).map((x) => (typeof x === 'string' ? x : x?.date)).filter(Boolean));
}

const isSession = (d, ex) => isTradingDay(d, 'NYSE') && !ex.has(d);

export function nextSession(date, excluded = []) {
  const ex = exclusionSet(excluded);
  let d = nextTradingDay(date, 'NYSE');
  while (ex.has(d)) d = nextTradingDay(d, 'NYSE');
  return d;
}

export function firstSessionOnOrAfter(date, excluded = []) {
  const ex = exclusionSet(excluded);
  return isSession(date, ex) ? date : nextSession(date, ex);
}

// The n-th session after date (n >= 1).
export function addSessions(date, n, excluded = []) {
  const ex = exclusionSet(excluded);
  let d = date;
  for (let i = 0; i < n; i++) d = nextSession(d, ex);
  return d;
}

// Every session from warmupFrom to end (inclusive), skipping excluded ones.
export function periodSessions({ warmupFrom, end }, excluded = []) {
  const ex = exclusionSet(excluded);
  const out = [];
  for (let d = firstSessionOnOrAfter(warmupFrom, ex); d <= end; d = nextSession(d, ex)) out.push(d);
  return out;
}

// ---------- inputs ----------

function checkConfig(config) {
  const errs = [];
  const num = (v, p, { min = 0, gt = null, max = null, int = false } = {}) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return errs.push(`${p} must be a finite number`);
    if (int && !Number.isInteger(v)) errs.push(`${p} must be a whole number`);
    if (gt != null ? !(v > gt) : v < min) errs.push(`${p} must be ${gt != null ? `greater than ${gt}` : `at least ${min}`}`);
    if (max != null && v > max) errs.push(`${p} must be at most ${max}`);
    return null;
  };
  const { account: a, execution: x, costs: c, dividends: dv, rule: r } = config || {};
  if (!a || !x || !c || !dv || !r) throw new Error('HXR engine: config needs account, execution, costs, dividends and rule');
  num(a.startingCash, 'account.startingCash', { gt: 0 });
  num(x.delaySessions, 'execution.delaySessions', { min: 1, int: true });
  if (!FILL_MODELS.includes(x.fillModel)) errs.push(`execution.fillModel must be ${FILL_MODELS.join(' or ')}`);
  for (const k of ['commissionPerOrder', 'commissionPerShare', 'secFeeRate', 'tafPerShare', 'tafMaxPerTrade', 'halfSpreadFloorBps', 'slippageBps']) num(c[k], `costs.${k}`);
  if (c.halfSpreadMultiplier !== undefined) num(c.halfSpreadMultiplier, 'costs.halfSpreadMultiplier', { gt: 0 });
  if (c.halfSpread !== 'calibrated' && c.halfSpread !== undefined) num(c.halfSpread, 'costs.halfSpread');
  num(dv.withholdingPct, 'dividends.withholdingPct', { max: 100 });
  num(config.cash?.annualInterestPct ?? 0, 'cash.annualInterestPct');
  if (!RULE_TYPES.includes(r.type)) errs.push(`rule.type must be ${RULE_TYPES.join(', ')}`);
  if (r.type === 'ma_band') { num(r.smaSessions, 'rule.smaSessions', { min: 1, int: true }); num(r.bandPct, 'rule.bandPct', { max: 100 }); }
  if (r.type === 'vol_trail') { num(r.volSessions, 'rule.volSessions', { min: 1, int: true }); num(r.multiple, 'rule.multiple', { gt: 0 }); }
  if (r.type === 'pct_trail') { num(r.exitDrawdownPct, 'rule.exitDrawdownPct', { gt: 0, max: 100 }); num(r.reentryRisePct, 'rule.reentryRisePct', { gt: 0 }); }
  if (BUY_BACK_RULES.includes(r.type)) {
    num(r.volSessions, 'rule.volSessions', { min: 1, int: true });
    num(r.pivotSessions, 'rule.pivotSessions', { min: 1, int: true });
    num(r.reboundMultiple, 'rule.reboundMultiple');
    if (r.afterMissedRebound === 'pending_owner_choice') throw new Error("HXR engine: rule.afterMissedRebound is pending the owner's choice (PREREGISTRATION-3a.md): this config cannot run");
    if (!MISSED_REBOUND_POLICIES.includes(r.afterMissedRebound)) errs.push(`rule.afterMissedRebound must be ${MISSED_REBOUND_POLICIES.join(', ')}`);
    if (r.afterMissedRebound === 'fresh_entry_after_sessions') num(r.freshEntryMinSessions, 'rule.freshEntryMinSessions', { min: 1, int: true });
    if (r.entryWhenNeverHeld !== undefined && r.entryWhenNeverHeld !== 'recovery_point_any_price') errs.push('rule.entryWhenNeverHeld must be "recovery_point_any_price"');
    if (r.type === 'recovery_break') num(r.bufferMultiple, 'rule.bufferMultiple');
    if (r.type === 'move_allowance') num(r.multiple, 'rule.multiple', { gt: 0 });
    if (r.type === 'giveback') { num(r.givebackPct, 'rule.givebackPct', { gt: 0, max: 100 }); num(r.activationMultiple, 'rule.activationMultiple'); }
  }
  // hxr-prereg-3 (PREREGISTRATION-3.md sections 1-2): pooled cash and risk sizing.
  const pooled = a.allocation === 'risk_sized';
  if (a.allocation !== undefined && a.allocation !== 'equal_sleeves' && !pooled) errs.push('account.allocation must be equal_sleeves or risk_sized');
  if (pooled) {
    const k = config.risk, il = config.initialLoss;
    if (!k || !il) throw new Error('HXR engine: a risk_sized config needs risk and initialLoss sections');
    for (const f of ['plannedLossPerTradeUsd', 'maxPositionUsd', 'totalOpenRiskUsd', 'pauseDeclineUsd']) num(k[f], `risk.${f}`, { gt: 0 });
    for (const f of ['maxTechAiExposureUsd', 'resumeDeclineUsd']) num(k[f], `risk.${f}`);
    num(k.minPositionFractionOfPlannedLoss, 'risk.minPositionFractionOfPlannedLoss', { max: 1 });
    if (!(k.resumeDeclineUsd < k.pauseDeclineUsd)) errs.push('risk.resumeDeclineUsd must be below risk.pauseDeclineUsd');
    num(il.multiple, 'initialLoss.multiple', { gt: 0 });
    if (il.volSessions !== undefined) num(il.volSessions, 'initialLoss.volSessions', { min: 1, int: true });
  }
  if (errs.length) throw new Error(`HXR engine: invalid config: ${errs.join('; ')}`);
}

// The typical-move window used for sizing and the initial-loss level: the
// rule's own, or initialLoss.volSessions for a rule without one (the day-one hold).
export function sizingVolSessions(config) {
  return config.initialLoss?.volSessions ?? config.rule?.volSessions ?? 20;
}

function normSymbols(symbols) {
  if (!Array.isArray(symbols) || !symbols.length) throw new Error('HXR engine: symbols must be a non-empty list');
  const seen = new Set();
  return symbols.map((s) => {
    const o = typeof s === 'string' ? { symbol: s } : s;
    const symbol = String(o?.symbol || '');
    if (!symbol) throw new Error('HXR engine: every symbol needs a symbol');
    if (seen.has(symbol)) throw new Error(`HXR engine: symbol ${symbol} is listed twice`);
    if (o.listedFrom != null && !DATE.test(o.listedFrom)) throw new Error(`HXR engine: ${symbol} listedFrom must be YYYY-MM-DD`);
    seen.add(symbol);
    return { symbol, exchange: o.exchange || 'NASDAQ', listedFrom: o.listedFrom ?? null, techAi: !!o.techAi };
  });
}

function normPeriod(p) {
  if (!p || !DATE.test(p.warmupFrom || '') || !DATE.test(p.start || '')) throw new Error('HXR engine: period needs warmupFrom and start dates (YYYY-MM-DD)');
  if (p.end != null && !DATE.test(p.end)) throw new Error('HXR engine: period end must be YYYY-MM-DD or null (open-ended)');
  if (p.warmupFrom > p.start) throw new Error('HXR engine: period warmupFrom is after start');
  if (p.end != null && p.end < p.start) throw new Error('HXR engine: period end is before start');
  return { warmupFrom: p.warmupFrom, start: p.start, end: p.end ?? null };
}

// The bar for one symbol on one session, or a reason it cannot be used.
function barProblem(b) {
  if (!b || typeof b !== 'object') return 'not an object';
  const [o, h, l, c] = [b.o, b.h, b.l, b.c];
  if (![o, h, l, c].every((v) => typeof v === 'number' && Number.isFinite(v))) return 'non-numeric price';
  if (o <= 0 || h <= 0 || l <= 0 || c <= 0) return 'non-positive price';
  if (h < l || o > h || o < l || c > h || c < l) return 'inconsistent high/low';
  return null;
}

// Mean of the last n closes (the SMA) and mean absolute close-to-close change
// over the last n changes (the typical daily move).
function sma(closes, n) {
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

function typicalMove(closes, n) {
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += Math.abs(closes[i] - closes[i - 1]);
  return s / n;
}

export function historyLength(rule, config = null) {
  const pooled = config?.account?.allocation === 'risk_sized';
  return Math.max(1, rule.smaSessions ?? 0, (rule.volSessions ?? -1) + 1, BUY_BACK_RULES.includes(rule.type) ? 2 * rule.pivotSessions + 1 : 0, pooled ? sizingVolSessions(config) + 1 : 0);
}
export const historyLengthFor = (config) => historyLength(config.rule, config);

// ---------- hxr-prereg-2 rules (PREREGISTRATION-2.md section 3) ----------

// The exit price of the sleeve's last rule exit in current share units, or null.
export function exitPriceNow(sl) {
  const x = sl.lastExit;
  return x ? x.price / (sl.splitFactor / x.splitFactor) : null;
}

// Section 3.1. At today's close (closes ends with it) the session k of the
// stock's sessions earlier is a recovery point if its close is strictly below
// each of the k closes before and the k closes after it, and the highest of
// those k later closes is at least reboundMultiple x m above it. Only closes up
// to today are read: the point exists from today's close, never earlier.
export function recoveryPoint(closes, k, reboundMultiple, m) {
  const n = closes.length;
  if (n < 2 * k + 1) return null;
  const i = n - 1 - k, ci = closes[i];
  for (let j = i - k; j < i; j++) if (!(ci < closes[j])) return null;
  let highestAfter = -Infinity;
  for (let j = i + 1; j < n; j++) {
    if (!(ci < closes[j])) return null;
    highestAfter = Math.max(highestAfter, closes[j]);
  }
  if (!(highestAfter >= ci + reboundMultiple * m)) return null;
  return { close: ci, highestAfter, sessionsAgo: k, m };
}

// The typical daily move m(t), or null without volSessions + 1 closes.
export function typicalMoveNow(rule, closes) {
  return closes.length >= rule.volSessions + 1 ? typicalMove(closes, rule.volSessions) : null;
}

// A recovery point that formed on or after the sleeve's last fill session
// (sinceFill counts the stock's closes from the fill session, inclusive).
function recoveryAfterFill(rule, sl, m) {
  if (!((sl.sinceFill ?? 0) >= rule.pivotSessions + 1)) return null;
  return recoveryPoint(sl.history, rule.pivotSessions, rule.reboundMultiple, m);
}

// State that moves at each close while holding: X1's exit level (only rises)
// and X3's activation (sticky until the next sell). Called after the close is
// appended and before evaluateRule; mutates the sleeve.
export function updateRuleState(rule, sl) {
  if (!BUY_BACK_RULES.includes(rule.type) || sl.state !== 'in') return null;
  const m = typicalMoveNow(rule, sl.history);
  if (m == null) return null;
  if (rule.type === 'recovery_break') {
    const rp = recoveryAfterFill(rule, sl, m);
    if (!rp) return null;
    const level = rp.close - rule.bufferMultiple * m;
    const raised = sl.level == null || level > sl.level;
    if (raised) sl.level = level;
    return { kind: 'recovery_point', recoveryClose: rp.close, highestAfter: rp.highestAfter, m, candidateLevel: level, level: sl.level, raised };
  }
  if (rule.type === 'giveback' && !sl.gbActive && sl.anchorHigh != null && sl.entryPrice != null && sl.anchorHigh >= sl.entryPrice + rule.activationMultiple * m) {
    sl.gbActive = true;
    return { kind: 'giveback_active', entryPrice: sl.entryPrice, anchorHigh: sl.anchorHigh, m, threshold: sl.entryPrice + rule.activationMultiple * m };
  }
  return null;
}

function evaluateBuyBackRule(rule, sl, c) {
  const m = typicalMoveNow(rule, sl.history);
  if (m == null) return null;
  if (sl.state === 'in') {
    if (rule.type === 'recovery_break') {
      if (sl.level == null) return null;
      return c < sl.level ? { side: 'sell', values: { close: c, level: sl.level, m, bufferMultiple: rule.bufferMultiple }, reason: `close ${c} is below the recovery-point level ${sl.level}` } : null;
    }
    if (rule.type === 'move_allowance') {
      if (sl.anchorHigh == null) return null;
      const level = sl.anchorHigh - rule.multiple * m;
      return c < level ? { side: 'sell', values: { close: c, anchorHigh: sl.anchorHigh, m, multiple: rule.multiple, level }, reason: `close ${c} is below the highest close since buying ${sl.anchorHigh} less ${rule.multiple} x typical move ${m} (${level})` } : null;
    }
    if (!sl.gbActive || sl.entryPrice == null || sl.anchorHigh == null) return null; // giveback
    const level = sl.entryPrice + (1 - rule.givebackPct / 100) * (sl.anchorHigh - sl.entryPrice);
    return c <= level ? { side: 'sell', values: { close: c, entryPrice: sl.entryPrice, anchorHigh: sl.anchorHigh, givebackPct: rule.givebackPct, level }, reason: `close ${c} gives back ${rule.givebackPct}% or more of the peak gain (entry ${sl.entryPrice}, highest close ${sl.anchorHigh}, level ${level})` } : null;
  }
  // Out: the one buy-back rule (section 3.5), or a fresh entry (hxr-prereg-3a).
  if (sl.stayOut) return null;
  const P = exitPriceNow(sl);
  if (sl.fresh) {
    // Never held, a lapsed buy, or a missed rebound under policy B or C: the
    // next confirmed recovery point, at any price (PREREGISTRATION-3.md section 8).
    if (rule.entryWhenNeverHeld !== 'recovery_point_any_price') return null;
    // Option C: at least N of the stock's sessions out, counted from the sale
    // (PREREGISTRATION-3.md 8; EXPERIMENT-LOG entry 13, correction 4).
    const sessionsOut = sl.lastExit ? sl.lastExit.sessionsOut : sl.fresh.sessions;
    const minOut = rule.afterMissedRebound === 'fresh_entry_after_sessions' && sl.fresh.afterMissedRebound ? rule.freshEntryMinSessions : 0;
    if (sessionsOut < minOut) return null;
    const rp = recoveryAfterFill(rule, sl, m);
    if (!rp) return null;
    return {
      side: 'buy', fresh: true,
      values: { close: c, previousExitPrice: P, recoveryClose: rp.close, highestAfter: rp.highestAfter, m, pivotSessions: rule.pivotSessions, reboundMultiple: rule.reboundMultiple, sessionsOut, sessionsSinceMissedRebound: sl.fresh.afterMissedRebound ? sl.fresh.sessions : null, afterMissedRebound: !!sl.fresh.afterMissedRebound },
      reason: `fresh entry: a recovery point (close ${rp.close}, ${rule.pivotSessions} sessions ago) is confirmed${P != null ? ` after a missed rebound (previous exit ${P})` : ' for a stock not held'}; buy at the next open at any price`,
    };
  }
  if (P == null) return null;
  if (c >= P) return { side: 'stay_out', values: { close: c, exitPrice: P }, reason: `close ${c} is at or above the exit price ${P} before any buy-back signal: rebound missed` };
  const rp = recoveryAfterFill(rule, sl, m);
  if (!rp) return null;
  return {
    side: 'buy', ceiling: P,
    values: { close: c, exitPrice: P, recoveryClose: rp.close, highestAfter: rp.highestAfter, m, pivotSessions: rule.pivotSessions, reboundMultiple: rule.reboundMultiple },
    reason: `a recovery point (close ${rp.close}, ${rule.pivotSessions} sessions ago) is confirmed below the exit price ${P}; buy at the next open only if the fill is below ${P}`,
  };
}

// The rule's own exit level right now (null when it has none), for the open
// risk of a position and the effective exit level (PREREGISTRATION-3.md 2).
export function ruleLevelNow(rule, sl) {
  if (!BUY_BACK_RULES.includes(rule.type) || sl.state !== 'in') return null;
  const m = typicalMoveNow(rule, sl.history);
  if (rule.type === 'recovery_break') return sl.level ?? null;
  if (m == null) return null;
  if (rule.type === 'move_allowance') return sl.anchorHigh != null ? sl.anchorHigh - rule.multiple * m : null;
  return sl.gbActive && sl.entryPrice != null && sl.anchorHigh != null ? sl.entryPrice + (1 - rule.givebackPct / 100) * (sl.anchorHigh - sl.entryPrice) : null;
}

// The higher of the initial-loss level and the rule's own level.
export function effectiveLevel(rule, sl) {
  const a = sl.L0 ?? null, b = ruleLevelNow(rule, sl);
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

// The signal while holding, with the initial-loss rule applied to every exit
// rule: exit when the close is below L0 even if the rule itself is silent.
function evaluateHolding(rule, sl) {
  if (rule.type === 'hold') return null; // the hold arms never sell: the initial-loss rule is for exit rules only
  const sig = evaluateRule(rule, sl);
  const c = sl.history[sl.history.length - 1];
  if (sl.L0 != null && c < sl.L0 - EPS) {
    if (sig?.side === 'sell') return { ...sig, trigger: 'rule', values: { ...sig.values, initialLossLevel: sl.L0 } };
    return { side: 'sell', trigger: 'initial_loss', values: { close: c, initialLossLevel: sl.L0, ruleLevel: ruleLevelNow(rule, sl) }, reason: `close ${c} is below the initial-loss level ${sl.L0}` };
  }
  return sig?.side === 'sell' ? { ...sig, trigger: 'rule', values: { ...sig.values, initialLossLevel: sl.L0 ?? null } } : sig;
}

// ENGINE-SPEC section 5. closes ends with today's close c. Returns null or the
// signal with every number used.
export function evaluateRule(rule, sl) {
  const closes = sl.history, n = closes.length, c = closes[n - 1];
  const holding = sl.state === 'in';
  if (rule.type === 'hold' || !n) return null;
  if (BUY_BACK_RULES.includes(rule.type)) return evaluateBuyBackRule(rule, sl, c);
  if (rule.type === 'ma_band') {
    if (n < rule.smaSessions) return null;
    const avg = sma(closes, rule.smaSessions);
    const lower = avg * (1 - rule.bandPct / 100), upper = avg * (1 + rule.bandPct / 100);
    const values = { close: c, sma: avg, smaSessions: rule.smaSessions, bandPct: rule.bandPct, lower, upper };
    if (holding && c < lower) return { side: 'sell', values, reason: `close ${c} is below the ${rule.smaSessions}-session average ${avg} less ${rule.bandPct}% (${lower})` };
    if (!holding && c > upper) return { side: 'buy', values, reason: `close ${c} is above the ${rule.smaSessions}-session average ${avg} plus ${rule.bandPct}% (${upper})` };
    return null;
  }
  if (rule.type === 'vol_trail') {
    if (n < rule.volSessions + 1) return null;
    const vol = typicalMove(closes, rule.volSessions);
    const base = { close: c, vol, volSessions: rule.volSessions, multiple: rule.multiple };
    if (holding) {
      if (sl.anchorHigh == null) return null;
      const level = sl.anchorHigh - rule.multiple * vol;
      return c < level ? { side: 'sell', values: { ...base, anchorHigh: sl.anchorHigh, level }, reason: `close ${c} is below the highest close since buying ${sl.anchorHigh} less ${rule.multiple} × typical move ${vol} (${level})` } : null;
    }
    if (sl.anchorLow == null) return null;
    const level = sl.anchorLow + rule.multiple * vol;
    return c > level ? { side: 'buy', values: { ...base, anchorLow: sl.anchorLow, level }, reason: `close ${c} is above the lowest close since selling ${sl.anchorLow} plus ${rule.multiple} × typical move ${vol} (${level})` } : null;
  }
  if (rule.type === 'pct_trail') {
    if (holding) {
      if (sl.anchorHigh == null) return null;
      const level = sl.anchorHigh * (1 - rule.exitDrawdownPct / 100);
      return c <= level ? { side: 'sell', values: { close: c, anchorHigh: sl.anchorHigh, exitDrawdownPct: rule.exitDrawdownPct, level }, reason: `close ${c} is ${rule.exitDrawdownPct}% or more below the highest close since buying ${sl.anchorHigh} (${level})` } : null;
    }
    if (sl.anchorLow == null) return null;
    const level = sl.anchorLow * (1 + rule.reentryRisePct / 100);
    return c >= level ? { side: 'buy', values: { close: c, anchorLow: sl.anchorLow, reentryRisePct: rule.reentryRisePct, level }, reason: `close ${c} is ${rule.reentryRisePct}% or more above the lowest close since selling ${sl.anchorLow} (${level})` } : null;
  }
  return null;
}

// Sell fees (ENGINE-SPEC section 4.5): commission, SEC fee on the sale value,
// FINRA TAF per share with its cap. Buys pay commission only.
export function sellFees(costs, shares, price) {
  const commission = costs.commissionPerOrder + costs.commissionPerShare * shares;
  const sec = costs.secFeeRate * shares * price;
  const taf = Math.min(costs.tafPerShare * shares, costs.tafMaxPerTrade);
  return { commission, sec, taf, total: commission + sec + taf };
}

// Where half-spreads come from: a function (symbol, date) -> bps, a fixed
// number, or a config with a fixed costs.halfSpread. A calibrated config
// without a table is refused rather than run on the floor.
function halfSpreadSource(config, halfSpreadBps) {
  if (typeof halfSpreadBps === 'function') return halfSpreadBps;
  if (typeof halfSpreadBps === 'number') return () => halfSpreadBps;
  const c = config.costs;
  if (typeof c.halfSpread === 'number') {
    const fixed = Math.max(c.halfSpread, c.halfSpreadFloorBps) * (c.halfSpreadMultiplier ?? 1);
    return () => fixed;
  }
  throw new Error('HXR engine: this config uses calibrated half-spreads; pass halfSpreadBps (config.js halfSpreadFor with the calibration table)');
}

// Initial sleeves: startingCash / N in cents, the remainder one cent at a time
// to the first sleeves.
export function sleeveCash(startingCash, n) {
  const cents = Math.round(startingCash * 100);
  const base = Math.floor(cents / n), rem = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < rem ? 1 : 0)) / 100);
}

function newSleeve(s, cash) {
  return {
    symbol: s.symbol, exchange: s.exchange, listedFrom: s.listedFrom, startCash: cash,
    cash, shares: 0, state: 'out', pending: null,
    history: [], anchorHigh: null, anchorLow: null, lastClose: null, lastBarDate: null,
    splitFactor: 1, receivables: [], episode: null, lastExit: null,
    // hxr-prereg-2 rules: closes since the last fill, X1's level, the effective
    // buy price (X3), X3's activation and the stay-in-cash flag after a missed rebound.
    sinceFill: 0, level: null, entryPrice: null, gbActive: false, stayOut: false,
    // hxr-prereg-3a: the initial-loss level, the planned loss of the holding and
    // the fresh-entry state ({ since, sessions, afterMissedRebound } or null).
    L0: null, plannedLoss: null, fresh: null, everHeld: false, techAi: !!s.techAi,
  };
}

// ---------- the engine ----------

export function createEngine({ config, symbols, period, excludedSessions = [], halfSpreadBps, state = null } = {}) {
  checkConfig(config);
  const cHash = configHash(config);
  const rule = config.rule, costs = config.costs;
  const fillModel = config.execution.fillModel, delay = config.execution.delaySessions;
  const HIST = historyLength(rule, config);
  const pooled = config.account.allocation === 'risk_sized';
  const risk = config.risk ?? null;
  const sizingVol = sizingVolSessions(config);
  const list = normSymbols(symbols);
  const exList = [...exclusionSet(excludedSessions)].sort();
  const ex = new Set(exList);
  let S;
  if (state) {
    S = typeof state === 'string' ? JSON.parse(state) : clone(state);
    if (S.format !== STATE_FORMAT) throw new Error('Unrecognised HXR engine state');
    if (S.configHash !== cHash) throw new Error('The saved HXR engine state belongs to a different config (config hash differs)');
    if (JSON.stringify(S.symbols) !== JSON.stringify(list)) throw new Error('The saved HXR engine state is for a different list of symbols');
    if (JSON.stringify(S.excludedSessions) !== JSON.stringify(exList)) throw new Error('The saved HXR engine state used different excluded sessions');
    if (period) {
      const p = normPeriod(period);
      if (p.warmupFrom !== S.period.warmupFrom || p.start !== S.period.start) throw new Error('The saved HXR engine state is for a different period start');
      if (p.end != null && S.lastDate && p.end < S.lastDate) throw new Error(`The period end ${p.end} is before the last processed session ${S.lastDate}`);
      S.period.end = p.end; // only the end may move (an open-ended prospective account)
    }
  } else {
    const p = normPeriod(period);
    const cash = pooled ? list.map(() => 0) : sleeveCash(config.account.startingCash, list.length);
    const firstFill = firstSessionOnOrAfter(p.start, ex);
    S = {
      format: STATE_FORMAT, engineVersion: ENGINE_VERSION, strategy: config.strategy ?? 'hxr', version: config.version ?? null,
      configHash: cHash, ruleType: rule.type, fillModel, delaySessions: delay,
      symbols: list, period: p, firstSession: firstSessionOnOrAfter(p.warmupFrom, ex), firstTradingSession: firstFill,
      excludedSessions: exList, startingCash: config.account.startingCash,
      // Pooled cash and the account-decline pause (risk_sized only).
      pooled, cash: pooled ? config.account.startingCash : null, peak: pooled ? config.account.startingCash : null, paused: false, pausedSince: null,
      lastDate: null, finished: false,
      sleeves: list.map((s, i) => {
        const sl = newSleeve(s, cash[i]);
        // Each sleeve starts out with a pending buy filling at the start's open.
        // Pooled: its size is set at the last warm-up close (sizeInitialOrders).
        sl.pending = {
          id: `order-${s.symbol}-initial-buy`, symbol: s.symbol, side: 'buy', reason: 'initial allocation', initial: true,
          decisionId: null, decisionDate: null, fillDate: firstFill, waited: 0, ...(pooled ? { shares: null, sized: false } : {}),
        };
        return sl;
      }),
      journal: { fills: [], decisions: [], episodes: [], roundTrips: [], dividends: [], splits: [], equity: [], warnings: [], freshEntries: [] },
    };
  }
  if (!S.journal.freshEntries) S.journal.freshEntries = [];
  const bySymbol = new Map(S.sleeves.map((sl) => [sl.symbol, sl]));
  const alphabetical = [...S.sleeves].sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  // Cash lives in the pool when risk_sized, in the sleeve otherwise.
  const cashOf = (sl) => (S.pooled ? S.cash : sl.cash);
  const setCash = (sl, v) => { if (S.pooled) S.cash = v; else sl.cash = v; };
  const addCash = (sl, d) => setCash(sl, cashOf(sl) + d);
  let out = null, warnSeq = 0;

  const spreadFn = halfSpreadSource(config, halfSpreadBps);
  // halfSpreadBps is final (config.js halfSpreadFor: the floor, then any variant
  // multiplier); the engine only refuses values that skipped either step.
  const mult = costs.halfSpreadMultiplier ?? 1;
  const halfSpread = (symbol, date) => {
    const v = spreadFn(symbol, date), floor = costs.halfSpreadFloorBps;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`HXR engine: no usable half-spread for ${symbol} on ${date} (got ${v})`);
    if (mult > 1 && v < floor * mult - EPS) throw new Error(`HXR engine: half-spread ${v} bps for ${symbol} on ${date} is below the floor x the variant multiplier (${floor * mult}); build it with halfSpreadFor(config, table) for this config`);
    return Math.max(floor, v);
  };

  function record(kind, item) {
    S.journal[kind].push(item);
    if (Array.isArray(out?.[kind])) out[kind].push(item);
    return item;
  }

  function warn(date, symbol, code, message, details = {}) {
    return record('warnings', { id: `warn-${date}-${warnSeq++}`, date, symbol, code, message, details: clone(details) });
  }

  function checkCash(sl, after, what) {
    if (!(Number.isFinite(after) && after >= 0)) throw new Error(`HXR engine: ${what} would leave ${sl.symbol}'s sleeve cash at ${after}; cash may never go below zero`);
  }

  // ---------- step checks ----------

  function checkDate(date) {
    if (!DATE.test(date || '')) throw new Error(`HXR engine: session date must be YYYY-MM-DD (got ${date})`);
    if (S.lastDate && date <= S.lastDate) throw new Error(`HXR engine: session ${date} processed out of order or repeated (last processed ${S.lastDate})`);
    if (ex.has(date)) throw new Error(`HXR engine: ${date} is an excluded session`);
    if (!isTradingDay(date, 'NYSE')) throw new Error(`HXR engine: ${date} is not a NYSE session`);
    if (S.period.end != null && date > S.period.end) throw new Error(`HXR engine: ${date} is after the period end ${S.period.end}`);
    const expected = S.lastDate ? nextSession(S.lastDate, ex) : S.firstSession;
    if (date !== expected) throw new Error(`HXR engine: session ${date} skips ${expected}; every session from ${S.period.warmupFrom} must be processed in order`);
  }

  function readBars(date, bars) {
    const m = new Map();
    const entries = bars instanceof Map ? [...bars.entries()] : Object.entries(bars || {});
    for (const [sym, b] of entries) {
      if (b == null) continue;
      const sl = bySymbol.get(sym);
      if (!sl) { warn(date, sym, 'unknown_symbol', `bar for ${sym}, which is not in this run; ignored`); continue; }
      if (sl.listedFrom && date < sl.listedFrom) throw new Error(`HXR engine: ${sym} has a bar on ${date}, before its listing date ${sl.listedFrom}`);
      const p = barProblem(b);
      if (p) { warn(date, sym, 'bad_bar', `${sym} bar on ${date} has a ${p}; treated as missing`, { bar: b }); continue; }
      let vw15 = b.vw15 ?? null;
      if (vw15 != null && !(typeof vw15 === 'number' && Number.isFinite(vw15) && vw15 > 0)) {
        warn(date, sym, 'bad_vw15', `${sym} first-15-minute VWAP on ${date} is not a positive number; treated as missing`, { vw15 });
        vw15 = null;
      }
      m.set(sym, { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? null, vw15 });
    }
    return m;
  }

  function noteMissing(date, bars, trading) {
    for (const sl of S.sleeves) {
      if (bars.has(sl.symbol)) continue;
      if (sl.listedFrom && date < sl.listedFrom) {
        if (trading) warn(date, sl.symbol, 'before_listing', `${sl.symbol} is not listed until ${sl.listedFrom}; the period starts too early for it`);
      } else {
        warn(date, sl.symbol, 'no_bar', `no bar for ${sl.symbol} on ${date}; the last close is kept for valuation`, { lastClose: sl.lastClose, lastBarDate: sl.lastBarDate });
      }
    }
  }

  // ---------- 2. splits and cash in lieu ----------

  function applySplits(date, splits) {
    const seq = new Map();
    for (const sp of splits || []) {
      const sl = bySymbol.get(sp?.symbol);
      if (!sl) { warn(date, sp?.symbol ?? null, 'unknown_symbol', `split for ${sp?.symbol}, which is not in this run; ignored`); continue; }
      const r = sp.ratio;
      if (!(typeof r === 'number' && Number.isFinite(r) && r > 0)) throw new Error(`HXR engine: split ratio for ${sl.symbol} on ${date} must be a number > 0`);
      const i = seq.get(sl.symbol) ?? 0;
      seq.set(sl.symbol, i + 1);
      const before = sl.shares;
      sl.history = sl.history.map((c) => c / r);
      if (sl.anchorHigh != null) sl.anchorHigh /= r;
      if (sl.anchorLow != null) sl.anchorLow /= r;
      if (sl.lastClose != null) sl.lastClose /= r;
      if (sl.level != null) sl.level /= r;
      if (sl.entryPrice != null) sl.entryPrice /= r;
      // The initial-loss level is a price like the others (PREREGISTRATION-3.md 2);
      // plannedLoss is dollars and stays.
      if (sl.L0 != null) sl.L0 /= r;
      sl.splitFactor *= r;
      // A sized buy waiting to fill on or after the split's effective session:
      // its shares and per-share numbers move to post-split units; the cash it
      // reserved and its planned loss in dollars stay (entry 13, correction 2).
      const po = sl.pending;
      if (po?.side === 'buy' && po.shares != null && po.sizing) {
        const sharesBefore = po.shares;
        po.shares = Math.floor(po.shares * r + EPS);
        po.sizing = { ...po.sizing, shares: po.shares, d: po.sizing.d / r, close: po.sizing.close / r, m: po.sizing.m / r };
        warn(date, sl.symbol, 'order_split_adjusted', `pending buy ${po.id}: ${sharesBefore} shares become ${po.shares} after the ${r}-for-1 split`, { orderId: po.id, ratio: r, sharesBefore, sharesAfter: po.shares });
        if (!(po.shares >= 1)) {
          warn(date, sl.symbol, 'order_cancelled', `pending buy ${po.id} cancelled: no whole share is left after the split`, { orderId: po.id, code: 'split' });
          lapse(sl, date, po);
        }
      }
      let after = before * r;
      const whole = Math.floor(after + EPS);
      if (Math.abs(after - whole) < EPS) after = whole; // snap float noise to whole shares
      sl.shares = after;
      record('splits', {
        id: `split-${sl.symbol}-${date}-${i}`, kind: 'split', symbol: sl.symbol, date, sourceId: sp.id ?? null, ratio: r, sharesBefore: before, sharesAfter: after,
        fraction: after - Math.floor(after), splitFactor: sl.splitFactor, phase: date < S.period.start ? 'warmup' : 'trading',
      });
    }
  }

  // A fraction of a share left by a split is paid at the open less the
  // half-spread, on the split session or, without a bar, at the next open.
  function payFractions(date, bars) {
    for (const sl of S.sleeves) {
      const frac = sl.shares - Math.floor(sl.shares);
      if (!(frac > 0)) continue;
      const bar = bars.get(sl.symbol);
      if (!bar) { warn(date, sl.symbol, 'cash_in_lieu_waiting', `${frac} of a ${sl.symbol} share left by a split waits for the next bar to be paid out`, { fraction: frac }); continue; }
      const hs = halfSpread(sl.symbol, date);
      const price = bar.o * (1 - hs / 10000), cash = frac * price;
      sl.shares = Math.floor(sl.shares);
      addCash(sl, cash);
      if (sl.episode) sl.episode.cashInLieu += cash;
      record('splits', {
        id: `cil-${sl.symbol}-${date}`, kind: 'cash_in_lieu', symbol: sl.symbol, date, fraction: frac, open: bar.o, halfSpreadBps: hs,
        price, cash, spreadCost: frac * (bar.o - price), sharesAfter: sl.shares,
      });
      if (sl.shares === 0 && sl.state === 'in') cashedOut(sl, date);
    }
  }

  // A split left no whole share: the holding ended as cash in lieu. Not a rule
  // exit, so no round trip; any pending sell has nothing left to sell.
  function cashedOut(sl, date) {
    closeEpisode(sl, { date, fillId: null, price: null, proceeds: 0, sellCosts: 0, endKind: 'cashed_out_by_split' });
    sl.state = 'out';
    sl.anchorLow = null;
    if (sl.pending?.side === 'sell') {
      warn(date, sl.symbol, 'order_cancelled', `sell order ${sl.pending.id} cancelled: a split left no whole share`, { orderId: sl.pending.id });
      sl.pending = null;
    }
  }

  // ---------- 3-4. dividends ----------

  function entitle(date, dividends, trading) {
    const seq = new Map();
    for (const dv of dividends || []) {
      const sl = bySymbol.get(dv?.symbol);
      if (!sl) { warn(date, dv?.symbol ?? null, 'unknown_symbol', `dividend for ${dv?.symbol}, which is not in this run; ignored`); continue; }
      const exDate = dv.exDate ?? date;
      // An ex-date may fall on an excluded or closed day: it is applied at the
      // next processed session, never earlier (no look-ahead).
      if (!DATE.test(exDate) || exDate > date || (S.lastDate && exDate <= S.lastDate)) {
        throw new Error(`HXR engine: dividend for ${sl.symbol} with ex-date ${exDate} was passed on session ${date}`);
      }
      if (!(typeof dv.amount === 'number' && Number.isFinite(dv.amount) && dv.amount >= 0)) throw new Error(`HXR engine: dividend amount for ${sl.symbol} on ${exDate} must be a number >= 0`);
      if (dv.payDate != null && !DATE.test(dv.payDate)) throw new Error(`HXR engine: dividend pay date for ${sl.symbol} must be YYYY-MM-DD`);
      if (!trading) continue; // warm-up: no shares, no cash
      const i = seq.get(sl.symbol) ?? 0;
      seq.set(sl.symbol, i + 1);
      const shares = sl.shares, gross = shares * dv.amount;
      const pct = config.dividends.withholdingPct, credited = config.dividends.credit !== false;
      const withheld = gross * pct / 100, net = gross - withheld;
      const id = `div-${sl.symbol}-${exDate}-${i}`;
      const payDate = dv.payDate ?? date;
      record('dividends', {
        id, kind: 'entitlement', symbol: sl.symbol, exDate, session: date, sourceId: dv.id ?? null, payDate, amount: dv.amount, shares,
        gross, withholdingPct: pct, withheld, net, credited, episodeId: sl.episode?.id ?? null,
      });
      if (credited && net > 0) {
        sl.receivables.push({ id, exDate, payDate, gross, withheld, net });
        if (sl.episode) { sl.episode.dividendsNet += net; sl.episode.dividendsGross += gross; }
      }
    }
  }

  function payReceivables(date) {
    for (const sl of S.sleeves) {
      const due = sl.receivables.filter((r) => r.payDate <= date);
      if (!due.length) continue;
      sl.receivables = sl.receivables.filter((r) => r.payDate > date);
      for (const r of due) {
        addCash(sl, r.net);
        record('dividends', { id: r.id.replace(/^div-/, 'divpay-'), kind: 'payment', symbol: sl.symbol, exDate: r.exDate, payDate: r.payDate, paidOn: date, net: r.net, entitlementId: r.id });
      }
    }
  }

  // ---------- 5. fills at the open ----------

  function priceOf(sl, side, bar, date) {
    const hs = halfSpread(sl.symbol, date), slip = costs.slippageBps;
    const flags = [];
    let raw = bar.o, f = (hs + slip) / 10000, basis = 'open';
    if (fillModel === 'vw15') {
      if (bar.vw15 != null) { raw = bar.vw15; f = hs / 10000; basis = 'vw15'; } else flags.push(VW15_MISSING);
    }
    return { raw, price: side === 'buy' ? raw * (1 + f) : raw * (1 - f), basis, halfSpreadBps: hs, slippageBps: basis === 'open' ? slip : 0, flags };
  }

  function fillRecord(sl, o, bar, date, px, shares, fees, cashBefore) {
    return {
      id: `fill-${sl.symbol}-${date}-${o.side}`, orderId: o.id, decisionId: o.decisionId, symbol: sl.symbol, side: o.side,
      initial: !!o.initial, reason: o.reason, decisionDate: o.decisionDate, fillDate: o.fillDate, date, waitedSessions: o.waited,
      shares, rawPrice: px.raw, price: px.price, basis: px.basis, fillModel, open: bar.o, vw15: bar.vw15,
      halfSpreadBps: px.halfSpreadBps, slippageBps: px.slippageBps, spreadSlippage: shares * Math.abs(px.price - px.raw), fees,
      value: shares * px.price, cashBefore, cashAfter: cashOf(sl), splitFactor: sl.splitFactor, flags: px.flags,
      trigger: o.trigger ?? null, fresh: !!o.fresh, ceiling: !!o.ceiling, sizing: o.sizing ?? null,
    };
  }

  function sell(sl, o, bar, date) {
    const shares = sl.shares;
    if (!(shares >= 1)) {
      warn(date, sl.symbol, 'order_cancelled', `sell order ${o.id} cancelled: no whole share to sell`, { orderId: o.id, shares });
      sl.pending = null;
      return;
    }
    const px = priceOf(sl, 'sell', bar, date);
    const fees = sellFees(costs, shares, px.price);
    const cashBefore = cashOf(sl), after = cashBefore + shares * px.price - fees.total;
    checkCash(sl, after, `selling ${shares} ${sl.symbol} on ${date}`);
    setCash(sl, after);
    const fill = record('fills', fillRecord(sl, o, bar, date, px, shares, fees, cashBefore));
    closeEpisode(sl, { date, fillId: fill.id, price: px.price, proceeds: shares * px.price - fees.total, sellCosts: fill.spreadSlippage + fees.total, endKind: 'exit', endTrigger: o.trigger ?? null });
    sl.lastExit = { fillId: fill.id, date, price: px.price, shares, splitFactor: sl.splitFactor, highestClose: null, sessionsOut: 0 };
    sl.shares = 0;
    sl.state = 'out';
    sl.anchorLow = null;
    sl.pending = null;
    Object.assign(sl, { sinceFill: 0, level: null, entryPrice: null, gbActive: false, L0: null, plannedLoss: null });
  }

  function buy(sl, o, bar, date) {
    const px = priceOf(sl, 'buy', bar, date);
    if (S.pooled && (o.shares == null || !(o.shares >= 1))) {
      warn(date, sl.symbol, 'order_cancelled', `buy order ${o.id} cancelled: it was never sized (no typical daily move before ${date})`, { orderId: o.id, code: 'insufficient_history' });
      lapse(sl, date, o);
      return;
    }
    // The buy-back fills only below the exit price (PREREGISTRATION-2.md 3.5).
    if (o.ceiling) {
      const P = exitPriceNow(sl);
      if (P == null || !(px.price < P)) {
        warn(date, sl.symbol, 'buy_back_cancelled', `buy-back order ${o.id} cancelled: the fill price ${px.price} is not below the exit price ${P}; the sleeve keeps waiting`, { orderId: o.id, price: px.price, open: bar.o, exitPrice: P });
        sl.pending = null;
        return;
      }
    }
    const cpo = costs.commissionPerOrder, cps = costs.commissionPerShare;
    const costOf = (n) => n * px.price + cpo + cps * n;
    const cashNow = cashOf(sl);
    // Pooled: the shares were sized at the decision; a higher open can only reduce them.
    let n = S.pooled ? Math.min(o.shares, Math.floor((cashNow - cpo) / (px.price + cps))) : Math.floor((cashNow - cpo) / (px.price + cps));
    while (n > 0 && costOf(n) > cashNow) n--; // never let float rounding overspend
    if (!(n >= 1)) {
      warn(date, sl.symbol, 'insufficient_cash', `buy order ${o.id} cancelled: ${S.pooled ? 'pooled' : 'sleeve'} cash ${cashNow} cannot buy one share at ${px.price}`, { orderId: o.id, cash: cashNow, price: px.price, initial: !!o.initial });
      sl.pending = null;
      if (S.pooled) lapse(sl, date, o);
      return;
    }
    if (S.pooled && n < o.shares) warn(date, sl.symbol, 'reduced_for_cash', `buy order ${o.id}: ${o.shares} shares planned, ${n} affordable at the open ${bar.o}`, { orderId: o.id, planned: o.shares, filled: n });
    const cost = costOf(n), cashBefore = cashNow, after = cashBefore - cost;
    checkCash(sl, after, `buying ${n} ${sl.symbol} on ${date}`);
    setCash(sl, after);
    const fees = { commission: cpo + cps * n, sec: 0, taf: 0, total: cpo + cps * n };
    // The initial-loss level is set from the actual fill (PREREGISTRATION-3.md 2).
    if (S.pooled) {
      const d = o.sizing?.d ?? null;
      sl.L0 = d != null ? px.price - d : null;
      sl.plannedLoss = d != null ? n * d : null;
    }
    const fill = record('fills', { ...fillRecord(sl, o, bar, date, px, n, fees, cashBefore), initialLossLevel: sl.L0, plannedLoss: sl.plannedLoss });
    const startKind = o.initial ? 'initial' : o.fresh ? 'fresh_entry' : sl.lastExit ? 'buy_back' : 'rule_buy';
    if (o.fresh) {
      const x = sl.lastExit;
      const prev = x ? x.price / (sl.splitFactor / x.splitFactor) : null;
      record('freshEntries', {
        id: `fresh-${sl.symbol}-${date}`, symbol: sl.symbol, date, fillId: fill.id, price: px.price, shares: n, previousExitPrice: prev,
        previousExitDate: x?.date ?? null, premiumPct: prev != null ? (px.price / prev - 1) * 100 : null,
        sessionsOut: x ? x.sessionsOut : sl.fresh?.sessions ?? null, sessionsSinceMissedRebound: sl.fresh?.afterMissedRebound ? sl.fresh.sessions : null,
        afterMissedRebound: !!sl.fresh?.afterMissedRebound, neverHeld: !sl.everHeld,
      });
      sl.lastExit = null;
    }
    if (sl.lastExit && !o.initial && !o.fresh) {
      const x = sl.lastExit;
      const adj = sl.splitFactor / x.splitFactor; // current units -> exit units
      const buyBackAdj = px.price * adj;
      record('roundTrips', {
        id: `rt-${sl.symbol}-${x.date}`, symbol: sl.symbol, exitFillId: x.fillId, buyBackFillId: fill.id, exitDate: x.date, buyBackDate: date,
        exitPrice: x.price, exitShares: x.shares, buyBackPrice: px.price, buyBackPriceAdj: buyBackAdj, buyBackShares: n, splitAdjustment: adj,
        changePct: (buyBackAdj / x.price - 1) * 100, dollars: x.shares * (buyBackAdj - x.price),
        highestCloseWhileOut: x.highestClose, largestRiseWhileOutPct: x.highestClose != null ? (x.highestClose / x.price - 1) * 100 : null,
        sessionsOut: x.sessionsOut,
      });
    }
    sl.lastExit = null;
    sl.episode = {
      id: `ep-${sl.symbol}-${date}`, symbol: sl.symbol, startFillId: fill.id, startDate: date, startKind, shares: n,
      buyPrice: px.price, cost, buyCosts: fill.spreadSlippage + fees.total, splitFactor: sl.splitFactor,
      dividendsNet: 0, dividendsGross: 0, cashInLieu: 0,
    };
    sl.shares = n;
    sl.state = 'in';
    sl.anchorHigh = null;
    sl.pending = null;
    Object.assign(sl, { sinceFill: 0, level: null, entryPrice: px.price, gbActive: false, fresh: null, everHeld: true });
  }

  // A buy that could not happen (budget, pause, cash, no sizing), at the
  // decision or at the fill (EXPERIMENT-LOG entry 13, correction 5, reconciling
  // PREREGISTRATION-3.md 1.2 step 4 with section 8): a lapsed BUY-BACK keeps the
  // buy-back rule and waits for the next recovery point below the sale price
  // (policy A still retires on a missed rebound); an initial or fresh entry
  // that lapsed waits for the next recovery point at any price.
  function lapse(sl, date, o = null) {
    sl.pending = null;
    sl.sinceFill = 0; // a new recovery point is needed either way
    const buyBack = !!sl.lastExit && !sl.fresh && !o?.initial && !o?.fresh;
    if (buyBack) return;
    if (rule.entryWhenNeverHeld === 'recovery_point_any_price' && !sl.stayOut) {
      sl.fresh = sl.fresh ?? { since: date, sessions: 0, afterMissedRebound: false };
    }
  }

  function closeEpisode(sl, { date, fillId, price, proceeds, sellCosts, endKind, endTrigger = null }) {
    const e = sl.episode;
    if (!e) return;
    const adj = sl.splitFactor / e.splitFactor; // current units -> start units
    const pnl = proceeds + e.cashInLieu + e.dividendsNet - e.cost;
    record('episodes', {
      ...e, open: false, endFillId: fillId, endDate: date, endKind, endTrigger, sharesAtEnd: sl.shares, exitPrice: price,
      exitPriceAdj: price != null ? price * adj : null, proceeds, sellCosts, costs: e.buyCosts + sellCosts,
      pnl, pnlPct: e.cost > 0 ? (pnl / e.cost) * 100 : null,
    });
    sl.episode = null;
  }

  function fills(date, bars) {
    // While the account is paused (decided at the previous close) no buy fills (PREREGISTRATION-3.md 1.4).
    if (S.pooled && S.paused) {
      for (const sl of S.sleeves) {
        const o = sl.pending;
        if (o?.side === 'buy' && !o.initial && o.fillDate <= date) {
          warn(date, sl.symbol, 'order_cancelled', `buy order ${o.id} cancelled: the account is paused after a decline of ${(S.peak - lastValue()).toFixed(2)} from its peak`, { orderId: o.id, code: 'paused' });
          lapse(sl, date, o);
        }
      }
    }
    for (const side of ['sell', 'buy']) {
      for (const sl of S.sleeves) {
        const o = sl.pending;
        if (!o || o.side !== side || o.fillDate > date) continue;
        const bar = bars.get(sl.symbol);
        if (!bar) {
          o.waited++;
          warn(date, sl.symbol, 'order_waiting', `${side} order ${o.id} due ${o.fillDate} waits: no ${sl.symbol} bar on ${date}`, { orderId: o.id, fillDate: o.fillDate, waited: o.waited });
          continue;
        }
        if (side === 'sell') sell(sl, o, bar, date); else buy(sl, o, bar, date);
      }
    }
  }

  // ---------- 6-8. close, equity, signals ----------

  function closes(date, bars, trading) {
    for (const sl of S.sleeves) {
      const bar = bars.get(sl.symbol);
      if (!bar) continue;
      sl.history.push(bar.c);
      if (sl.history.length > HIST) sl.history.splice(0, sl.history.length - HIST);
      sl.lastClose = bar.c;
      sl.lastBarDate = date;
      sl.sinceFill = (sl.sinceFill ?? 0) + 1;
      if (!trading) continue;
      if (sl.state === 'in') sl.anchorHigh = maxOf(sl.anchorHigh, bar.c);
      else sl.anchorLow = minOf(sl.anchorLow, bar.c);
      if (sl.lastExit) {
        sl.lastExit.highestClose = maxOf(sl.lastExit.highestClose, bar.c * (sl.splitFactor / sl.lastExit.splitFactor));
        sl.lastExit.sessionsOut++;
      }
      if (sl.fresh) sl.fresh.sessions++;
    }
    const pct = config.cash?.annualInterestPct ?? 0;
    if (trading && pct > 0) {
      if (S.pooled) S.cash += S.cash * pct / 100 / 252;
      else for (const sl of S.sleeves) sl.cash += sl.cash * pct / 100 / 252;
    }
  }

  // ---------- risk sizing (PREREGISTRATION-3.md section 1) ----------

  const lastValue = () => S.sleeves.reduce((a, sl) => a + (sl.shares > 0 ? sl.shares * sl.lastClose : 0), 0) + (S.pooled ? S.cash : S.sleeves.reduce((a, sl) => a + sl.cash, 0));
  const pendingBuys = () => S.sleeves.filter((sl) => sl.pending?.side === 'buy' && sl.pending.sizing).map((sl) => sl.pending);
  const openRiskOf = (sl) => {
    if (sl.state !== 'in' || !(sl.shares > 0) || sl.lastClose == null) return 0;
    const lvl = effectiveLevel(rule, sl);
    return lvl == null ? sl.shares * sl.lastClose : sl.shares * Math.max(0, sl.lastClose - lvl);
  };
  const openRiskNow = () => S.sleeves.reduce((a, sl) => a + openRiskOf(sl), 0);
  const techExposureNow = () => S.sleeves.reduce((a, sl) => a + (sl.techAi && sl.state === 'in' && sl.shares > 0 && sl.lastClose != null ? sl.shares * sl.lastClose : 0), 0);
  const reservedCash = () => pendingBuys().reduce((a, o) => a + o.sizing.reserveCash, 0);
  const reservedRisk = () => pendingBuys().reduce((a, o) => a + o.sizing.plannedLoss, 0);
  const reservedTech = () => pendingBuys().reduce((a, o) => a + o.sizing.techCost, 0);

  // Shares for a buy of `sl` at the decision close c with typical move m and the
  // planned loss asked for: the largest whole number under every cap. The
  // minimum is a fraction of the planned loss asked for (the initial
  // allocation asks for a share of the total open-risk budget).
  function sizeBuy(sl, c, m, plannedLoss, date) {
    const d = config.initialLoss.multiple * m;
    const hs = halfSpread(sl.symbol, date), k = (hs + costs.slippageBps) / 10000;
    const cpo = costs.commissionPerOrder, cps = costs.commissionPerShare;
    const avail = S.cash - reservedCash();
    const caps = {
      plannedLoss: Math.floor(plannedLoss / d + EPS),
      position: Math.floor(risk.maxPositionUsd / c + EPS),
      openRisk: Math.floor((risk.totalOpenRiskUsd - openRiskNow() - reservedRisk()) / d + EPS),
      techAi: sl.techAi ? Math.floor((risk.maxTechAiExposureUsd - techExposureNow() - reservedTech()) / c + EPS) : null, // null: the cap does not apply (plain JSON, unlike Infinity)
      cash: Math.floor((avail - cpo) / (c * (1 + k) + cps) + EPS),
    };
    let n = Math.max(0, Math.min(...Object.values(caps).filter((v) => v != null)));
    // The caps that set n; when n is clipped to 0 by caps below zero, those caps (EXPERIMENT-LOG entry 19).
    const binding = Object.entries(caps).filter(([, v]) => v != null && v <= n).map(([key]) => key);
    const minLoss = risk.minPositionFractionOfPlannedLoss * plannedLoss;
    const ok = n >= 1 && n * d >= minLoss - EPS;
    const reason = ok ? null : n < 1 ? `no whole share fits the budgets (${binding.join(', ')} binding)` : `planned loss ${(n * d).toFixed(2)} is below the minimum ${minLoss.toFixed(2)} (${binding.join(', ')} binding)`;
    if (!ok) n = 0;
    return {
      shares: n, d, m, close: c, k, halfSpreadBps: hs, plannedLossAsked: plannedLoss, plannedLoss: n * d, caps, binding, minLoss,
      reserveCash: n > 0 ? n * c * (1 + k) + cpo + cps * n : 0, techCost: sl.techAi ? n * c : 0,
      openRiskNow: openRiskNow(), reservedRisk: reservedRisk(), techExposureNow: techExposureNow(), reservedTech: reservedTech(), availableCash: avail, paused: S.paused, reason,
    };
  }

  // The initial allocation (section 1.3): sized at the last warm-up close, each
  // stock asking for an equal share of the total open-risk budget, in
  // alphabetical order. A stock that cannot be sized waits for a recovery point.
  function sizeInitialOrders(date) {
    const share = risk.totalOpenRiskUsd / S.sleeves.length;
    for (const sl of alphabetical) {
      const o = sl.pending;
      if (!o?.initial || o.sized) continue;
      o.sized = true;
      const m = sl.history.length >= sizingVol + 1 ? typicalMove(sl.history, sizingVol) : null;
      if (m == null || sl.lastClose == null) {
        warn(date, sl.symbol, 'entry_skipped', `initial allocation of ${sl.symbol} skipped: no typical daily move yet (needs ${sizingVol + 1} closes)`, { orderId: o.id, code: 'insufficient_history' });
        lapse(sl, date, o);
        continue;
      }
      const sz = sizeBuy(sl, sl.lastClose, m, Math.min(share, risk.plannedLossPerTradeUsd), date);
      if (!sz.shares) {
        warn(date, sl.symbol, 'entry_skipped', `initial allocation of ${sl.symbol} skipped: ${sz.reason}`, { orderId: o.id, code: 'budget', sizing: sz });
        lapse(sl, date, o);
        continue;
      }
      o.shares = sz.shares;
      o.sizing = sz;
      o.decisionDate = date;
      record('decisions', {
        id: `dec-${sl.symbol}-${date}-initial`, orderId: o.id, symbol: sl.symbol, date, side: 'buy', action: 'initial_allocation', rule: rule.type,
        reason: `initial allocation: ${sz.shares} shares, planned loss ${sz.plannedLoss.toFixed(2)} (asked ${sz.plannedLossAsked.toFixed(2)}; ${sz.binding.join(', ')} binding)`,
        values: { close: sl.lastClose, m, initialLossMultiple: config.initialLoss.multiple }, sizing: sz, state: sl.state, shares: sl.shares, cash: S.cash, fillDate: o.fillDate, delaySessions: delay,
      });
    }
  }

  // The account-decline pause (section 1.4), updated at every trading close.
  function updatePause(date, value) {
    if (!S.pooled) return;
    S.peak = Math.max(S.peak ?? S.startingCash, value);
    const decline = S.peak - value;
    if (!S.paused && decline >= risk.pauseDeclineUsd - EPS) {
      S.paused = true;
      S.pausedSince = date;
      warn(date, null, 'pause_start', `new entries paused: the account is ${decline.toFixed(2)} below its peak ${S.peak.toFixed(2)} (pause at ${risk.pauseDeclineUsd})`, { peak: S.peak, value, decline });
    } else if (S.paused && decline <= risk.resumeDeclineUsd + EPS) {
      S.paused = false;
      warn(date, null, 'pause_end', `new entries resume: the account is ${decline.toFixed(2)} below its peak ${S.peak.toFixed(2)} (resume at ${risk.resumeDeclineUsd})`, { peak: S.peak, value, decline, pausedSince: S.pausedSince });
      S.pausedSince = null;
    }
  }

  const receivableOf = (sl) => sl.receivables.reduce((a, r) => a + r.net, 0);

  function equityPoint(date) {
    let cash = S.pooled ? S.cash : 0, invested = 0, receivable = 0, sleevesOut = 0, openRisk = 0, techAi = 0;
    const sleeves = {};
    for (const sl of S.sleeves) {
      const value = sl.shares > 0 ? sl.shares * sl.lastClose : 0;
      const rec = receivableOf(sl);
      if (!S.pooled) cash += sl.cash;
      invested += value; receivable += rec;
      if (sl.state === 'out') sleevesOut++;
      const risk = S.pooled ? openRiskOf(sl) : null;
      if (S.pooled) { openRisk += risk; if (sl.techAi && sl.state === 'in') techAi += value; }
      sleeves[sl.symbol] = { cash: S.pooled ? 0 : sl.cash, shares: sl.shares, value, equity: (S.pooled ? 0 : sl.cash) + value, out: sl.state === 'out', receivable: rec, ...(S.pooled ? { openRisk: risk, level: effectiveLevel(rule, sl) } : {}) };
    }
    const value = cash + invested;
    if (S.pooled) updatePause(date, value);
    const p = { date, equity: value, cash, invested, sleevesOut, receivable, sleeves, ...(S.pooled ? { openRisk, techAi, paused: S.paused, peak: S.peak } : {}) };
    record('equity', p);
    if (out) out.equity = p;
  }

  // Each holding's rule state (X1's level, X3's activation) at this close, for
  // every sleeve before the equity point and any sizing, so open risk uses each
  // holding's current exit level whatever the ticker order (PREREGISTRATION-3.md
  // 1.2; EXPERIMENT-LOG entry 13, correction 3).
  function ruleStates(bars) {
    for (const sl of S.sleeves) {
      if (!bars.has(sl.symbol) || sl.pending) continue;
      updateRuleState(rule, sl);
    }
  }

  function signals(date, bars) {
    // Pooled: alphabetical order, each signal seeing the room the earlier ones reserved (section 1.2 step 6).
    for (const sl of S.pooled ? alphabetical : S.sleeves) {
      if (!bars.has(sl.symbol) || sl.pending) continue;
      const sig = sl.state === 'in' && S.pooled ? evaluateHolding(rule, sl) : evaluateRule(rule, sl);
      if (!sig) continue;
      if (sig.side === 'stay_out') {
        warn(date, sl.symbol, 'rebound_missed', `${sl.symbol}: ${sig.reason}`, { ...sig.values, policy: rule.afterMissedRebound ?? 'stay_out' });
        if (rule.afterMissedRebound === 'fresh_entry_recovery_point' || rule.afterMissedRebound === 'fresh_entry_after_sessions') {
          sl.fresh = { since: date, sessions: 0, afterMissedRebound: true };
          sl.sinceFill = 0;
        } else sl.stayOut = true;
        continue;
      }
      let sizing = null;
      if (sig.side === 'buy' && S.pooled) {
        if (S.paused) { warn(date, sl.symbol, 'entry_skipped', `${sl.symbol}: ${sig.reason}; skipped, the account is paused`, { code: 'paused', signal: sig.values }); lapse(sl, date, { fresh: !!sig.fresh }); continue; }
        const m = sl.history.length >= sizingVol + 1 ? typicalMove(sl.history, sizingVol) : null;
        const c = sl.history[sl.history.length - 1];
        sizing = m != null ? sizeBuy(sl, c, m, risk.plannedLossPerTradeUsd, date) : null;
        if (!sizing?.shares) {
          warn(date, sl.symbol, 'entry_skipped', `${sl.symbol}: ${sig.reason}; skipped: ${sizing?.reason ?? 'no typical daily move yet'}`, { code: 'budget', signal: sig.values, sizing });
          // The signal lapses: the next recovery point is needed (sections 1.2 step 4 and 8).
          lapse(sl, date, { fresh: !!sig.fresh });
          continue;
        }
      }
      const fillDate = addSessions(date, delay, ex);
      const id = `dec-${sl.symbol}-${date}`;
      const action = sig.side === 'sell' ? 'exit' : sig.fresh ? 'fresh_entry' : 'buy_back';
      record('decisions', {
        id, orderId: `order-${sl.symbol}-${date}-${sig.side}`, symbol: sl.symbol, date, side: sig.side, action, rule: rule.type,
        reason: sig.reason, values: sig.values, state: sl.state, shares: sl.shares, cash: cashOf(sl), fillDate, delaySessions: delay,
        ...(sig.trigger ? { trigger: sig.trigger } : {}), ...(sizing ? { sizing } : {}),
      });
      sl.pending = {
        id: `order-${sl.symbol}-${date}-${sig.side}`, symbol: sl.symbol, side: sig.side, reason: action === 'exit' ? 'exit rule' : action === 'fresh_entry' ? 'fresh entry' : 'buy-back rule',
        initial: false, decisionId: id, decisionDate: date, fillDate, waited: 0,
        ...(sig.ceiling != null ? { ceiling: true } : {}), ...(sig.fresh ? { fresh: true } : {}), ...(sig.trigger ? { trigger: sig.trigger } : {}),
        ...(sizing ? { shares: sizing.shares, sizing } : {}),
      };
    }
  }

  // ---------- one session ----------

  function processSession(date, day = {}) {
    if (S.finished) throw new Error('HXR engine: the run has finished; create a new engine to continue');
    checkDate(date);
    warnSeq = 0;
    out = { date, decisions: [], fills: [], dividends: [], splits: [], warnings: [], episodes: [], roundTrips: [], equity: null };
    const trading = date >= S.period.start;
    const bars = readBars(date, day?.bars);
    noteMissing(date, bars, trading);
    applySplits(date, day?.splits);
    // A split's fraction is paid at this open before the ex-date entitlement,
    // so it never earns the dividend (the conservative order).
    if (trading) payFractions(date, bars);
    entitle(date, day?.dividends, trading);
    if (trading) {
      payReceivables(date);
      fills(date, bars);
    }
    closes(date, bars, trading);
    if (S.pooled && !trading && nextSession(date, ex) === S.firstTradingSession) sizeInitialOrders(date);
    if (trading) {
      ruleStates(bars);
      equityPoint(date);
      signals(date, bars);
    }
    S.lastDate = date;
    const r = out;
    out = null;
    return clone(r); // a copy: the caller never shares objects with the state
  }

  // ---------- views of the current state ----------

  function openEpisodes() {
    return S.sleeves.filter((sl) => sl.episode).map((sl) => {
      const e = sl.episode;
      const value = sl.shares * (sl.lastClose ?? 0);
      const pnl = value + e.cashInLieu + e.dividendsNet - e.cost;
      return {
        ...clone(e), open: true, endFillId: null, endDate: null, endKind: 'open', markDate: sl.lastBarDate, markPrice: sl.lastClose,
        sharesAtEnd: sl.shares, value, costs: e.buyCosts, pnl, pnlPct: e.cost > 0 ? (pnl / e.cost) * 100 : null,
      };
    });
  }

  // Exits not bought back: valued at the last close in exit units.
  function openExits() {
    return S.sleeves.filter((sl) => sl.lastExit).map((sl) => {
      const x = sl.lastExit;
      const last = sl.lastClose != null ? sl.lastClose * (sl.splitFactor / x.splitFactor) : null;
      return {
        id: `open-exit-${sl.symbol}-${x.date}`, symbol: sl.symbol, exitFillId: x.fillId, exitDate: x.date, exitPrice: x.price, exitShares: x.shares,
        lastDate: sl.lastBarDate, lastCloseAdj: last, changePct: last != null ? (last / x.price - 1) * 100 : null,
        dollars: last != null ? x.shares * (last - x.price) : null,
        highestCloseWhileOut: x.highestClose, largestRiseWhileOutPct: x.highestClose != null ? (x.highestClose / x.price - 1) * 100 : null,
        sessionsOut: x.sessionsOut, pendingBuyBack: sl.pending?.side === 'buy' ? sl.pending.id : null,
      };
    });
  }

  function pendingOrders() {
    return S.sleeves.filter((sl) => sl.pending).map((sl) => {
      const o = sl.pending;
      return { orderId: o.id, decisionId: o.decisionId, symbol: sl.symbol, side: o.side, reason: o.reason, initial: !!o.initial, decisionDate: o.decisionDate, fillDate: o.fillDate, waitedSessions: o.waited };
    });
  }

  function sleeveSummary() {
    return S.sleeves.map((sl) => {
      const value = sl.shares > 0 ? sl.shares * sl.lastClose : 0;
      const cash = S.pooled ? 0 : sl.cash;
      return {
        symbol: sl.symbol, startCash: S.pooled ? null : sl.startCash, cash, shares: sl.shares, lastClose: sl.lastClose, lastBarDate: sl.lastBarDate,
        value, equity: cash + value, state: sl.state, receivable: receivableOf(sl), splitFactor: sl.splitFactor,
        anchorHigh: sl.anchorHigh, anchorLow: sl.anchorLow, pendingOrderId: sl.pending?.id ?? null,
        ...(S.pooled ? { initialLossLevel: sl.L0, plannedLoss: sl.plannedLoss, effectiveLevel: effectiveLevel(rule, sl), openRisk: openRiskOf(sl), fresh: sl.fresh ? { ...sl.fresh } : null, retired: !!sl.stayOut, everHeld: !!sl.everHeld, techAi: !!sl.techAi } : {}),
      };
    });
  }

  function output() {
    const j = clone(S.journal);
    return {
      ...j,
      episodes: [...j.episodes, ...openEpisodes()],
      openExits: openExits(),
      pendingAtEnd: pendingOrders(),
      receivables: S.sleeves.flatMap((sl) => sl.receivables.map((r) => ({ symbol: sl.symbol, ...r }))),
      sleeves: sleeveSummary(),
      pool: S.pooled ? { cash: S.cash, peak: S.peak, paused: S.paused, pausedSince: S.pausedSince, openRisk: openRiskNow(), techAiExposure: techExposureNow() } : null,
      lastDate: S.lastDate,
      finished: S.finished,
    };
  }

  // End of the run: orders still pending can never fill (pendingAtEnd); open
  // holdings are marked at the last close with no liquidation cost.
  function finish() {
    S.finished = true;
    return output();
  }

  return {
    processSession, finish, output,
    snapshot: () => clone(S),
    get configHash() { return cHash; },
    get lastDate() { return S.lastDate; },
    get period() { return { ...S.period }; },
  };
}

// ---------- full backtest ----------

const dayOf = (days, date) => (days instanceof Map ? days.get(date) : days?.[date]) || { bars: {}, splits: [], dividends: [] };

// inputs: { sessions?, days: Map(date -> day), halfSpreadBps(symbol, date),
// dataHash?, calibrationHash? }. Sessions default to the period's calendar.
export function runBacktest({ config, symbols, period, inputs = {}, excludedSessions = [], label = null } = {}) {
  const sessions = inputs.sessions ?? periodSessions(period, excludedSessions);
  const engine = createEngine({ config, symbols, period, excludedSessions, halfSpreadBps: inputs.halfSpreadBps });
  const h = crypto.createHash('sha256');
  for (const date of sessions) {
    const day = dayOf(inputs.days, date);
    h.update(`${date}|${canonicalJson(day, { omit: [] })}\n`);
    engine.processSession(date, day);
  }
  const res = engine.finish();
  const inputsHash = h.digest('hex');
  const p = engine.period;
  const expectedLast = p.end != null ? periodSessions(p, excludedSessions).at(-1) ?? null : null;
  const list = normSymbols(symbols);
  const meta = {
    strategy: config.strategy ?? 'hxr', version: config.version ?? null, label, engineVersion: ENGINE_VERSION, configHash: engine.configHash,
    ruleType: config.rule.type, rule: clone(config.rule), period: p, basket: list.map((s) => s.symbol), symbols: list,
    fillModel: config.execution.fillModel, delaySessions: config.execution.delaySessions, startingCash: config.account.startingCash,
    allocation: config.account.allocation ?? 'equal_sleeves', pooled: config.account.allocation === 'risk_sized', risk: config.risk ? clone(config.risk) : null, initialLoss: config.initialLoss ? clone(config.initialLoss) : null,
    slippageBps: config.costs.slippageBps, halfSpreadMultiplier: config.costs.halfSpreadMultiplier ?? 1,
    excludedSessions: [...exclusionSet(excludedSessions)].sort(), sessionsProcessed: sessions.length,
    firstSession: sessions[0] ?? null, lastSession: sessions.at(-1) ?? null, tradingSessions: res.equity.length,
    completeToEnd: expectedLast != null && sessions.at(-1) === expectedLast,
    dataHash: inputs.dataHash ?? inputsHash, inputsHash, calibrationHash: inputs.calibrationHash ?? null,
    halfSpreadsHash: sha(JSON.stringify([
      ...res.fills.map((f) => [f.symbol, f.date, f.halfSpreadBps]),
      ...res.splits.filter((s) => s.kind === 'cash_in_lieu').map((s) => [s.symbol, s.date, s.halfSpreadBps]),
    ])),
    simulated: true,
  };
  return { meta, ...res };
}
