// HXR configuration (strategy/hxr/ENGINE-SPEC.md section 1): load, validate,
// hash and freeze the HXR configs, the universe, the periods and the criteria.
// Simulation only; nothing here touches the real portfolio or the Strategy Lab.
// The files in strategy/hxr are pre-registered: this module only reads them.
import fs from 'node:fs';
import path from 'node:path';
import { STRATEGY_DIR, canonicalJson, configHash, deepFreeze } from '../strategy/config.js';

export const HXR_DIR = path.join(STRATEGY_DIR, 'hxr');
export const HXR_CONFIG_DIR = path.join(HXR_DIR, 'configs');
// The active pre-registration is hxr-prereg-3a (PREREGISTRATION-3.md and
// PREREGISTRATION-3a.md). Earlier versions' files stay on disk unchanged and
// are loadable by path.
export const UNIVERSE_PATH = path.join(HXR_DIR, 'universe-hxr-v3.json');
export const PERIODS_PATH = path.join(HXR_DIR, 'periods-hxr-v3.json');
export const CRITERIA_PATH = path.join(HXR_DIR, 'criteria-hxr-v3a.json');
export const PREREG = 'hxr-prereg-3a';
// Fresh-entry policies after a missed rebound (PREREGISTRATION-3a.md section 1);
// pending_owner_choice is accepted by the loader (so the file can be listed and
// hashed) and refused by the engine.
export const MISSED_REBOUND_POLICIES = ['stay_out', 'fresh_entry_recovery_point', 'fresh_entry_after_sessions', 'pending_owner_choice'];
export const PICK_RULES = ['ending_value', 'return_to_drawdown', 'pending_owner_choice'];

export const RULE_TYPES = ['hold', 'ma_band', 'vol_trail', 'pct_trail', 'recovery_break', 'move_allowance', 'giveback'];
export const FILL_MODELS = ['open', 'vw15'];
// hxr-prereg-3 (PREREGISTRATION-3.md section 3): development, validation,
// final (used once) and the reported-only full-list check.
export const BACKTEST_PERIODS = ['development', 'validation', 'final', 'fullList'];
// Reported-only extra periods, when a periods file defines them; none in v3.
export const REPORTED_PERIODS = [];
export const periodKeys = (periods) => [...BACKTEST_PERIODS, ...REPORTED_PERIODS.filter((k) => periods?.periods?.[k])];
// Descriptive keys allowed beside the rule-relevant ones (left out of the hash
// by canonicalJson's DESCRIPTIVE_KEYS).
const DESCRIPTIVE = ['label', 'status', 'createdAt', 'notes'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;
export const isDate = (s) => {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clone = (o) => JSON.parse(JSON.stringify(o));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// ---------- configs ----------

const num = (o = {}) => ({ type: 'number', ...o });
const int = (o = {}) => ({ type: 'number', int: true, ...o });
const exact = (value) => ({ exact: value });
const oneOf = (values) => ({ type: 'string', values });

// Every key of each section; anything else is refused so that no setting is
// silently ignored.
const SECTIONS = {
  account: {
    startingCash: num({ gt: 0 }), currency: exact('USD'), allocation: oneOf(['equal_sleeves', 'risk_sized']),
    wholeShares: exact(true), allowMargin: exact(false), allowShort: exact(false),
  },
  execution: {
    decision: exact('after_close'), fill: exact('next_open'), delaySessions: int({ min: 1 }), fillModel: oneOf(FILL_MODELS),
  },
  costs: {
    commissionPerOrder: num({ min: 0 }), commissionPerShare: num({ min: 0 }), secFeeRate: num({ min: 0 }),
    tafPerShare: num({ min: 0 }), tafMaxPerTrade: num({ min: 0 }),
    halfSpread: { halfSpread: true }, halfSpreadFloorBps: num({ min: 0 }), slippageBps: num({ min: 0 }),
    // Variants only (spread and slippage doubled): multiplies the half-spread after the floor.
    halfSpreadMultiplier: num({ gt: 0, optional: true }),
  },
  dividends: { credit: { type: 'boolean' }, creditOn: exact('pay_date'), withholdingPct: num({ min: 0, max: 100 }) },
  cash: { annualInterestPct: num({ min: 0 }) },
  // hxr-prereg-3 (PREREGISTRATION-3.md sections 1-2): required when
  // account.allocation is risk_sized, refused otherwise.
  risk: {
    plannedLossPerTradeUsd: num({ gt: 0 }), maxPositionUsd: num({ gt: 0 }), totalOpenRiskUsd: num({ gt: 0 }), maxTechAiExposureUsd: num({ min: 0 }),
    pauseDeclineUsd: num({ gt: 0 }), resumeDeclineUsd: num({ min: 0 }), minPositionFractionOfPlannedLoss: num({ min: 0, max: 1 }),
    initialAllocation: exact('equal_share_of_total_open_risk'), contentionOrder: exact('alphabetical'),
  },
  initialLoss: { multiple: num({ gt: 0 }), volSessions: int({ min: 1, optional: true }) },
};
const RISK_SECTIONS = ['risk', 'initialLoss'];

const RULE_PARAMS = {
  hold: {},
  ma_band: { smaSessions: int({ min: 2 }), bandPct: num({ min: 0 }) },
  vol_trail: { volSessions: int({ min: 1 }), multiple: num({ gt: 0 }) },
  pct_trail: { exitDrawdownPct: num({ gt: 0, lt: 100 }), reentryRisePct: num({ gt: 0 }) },
  // hxr-prereg-2 (PREREGISTRATION-2.md section 3): each exit rule plus the one
  // buy-back rule; hxr-prereg-3a adds the fresh-entry policy and the entry for a
  // stock never held.
  recovery_break: { volSessions: int({ min: 1 }), bufferMultiple: num({ min: 0 }), ...buyBackParams() },
  move_allowance: { volSessions: int({ min: 1 }), multiple: num({ gt: 0 }), ...buyBackParams() },
  giveback: { volSessions: int({ min: 1 }), givebackPct: num({ gt: 0, lt: 100 }), activationMultiple: num({ min: 0 }), ...buyBackParams() },
};

function buyBackParams() {
  return {
    pivotSessions: int({ min: 1 }), reboundMultiple: num({ min: 0 }), afterMissedRebound: oneOf(MISSED_REBOUND_POLICIES),
    entryWhenNeverHeld: { type: 'string', values: ['recovery_point_any_price'], optional: true }, freshEntryMinSessions: int({ min: 1, optional: true }),
  };
}

const TOP_KEYS = new Set(['strategy', 'version', ...DESCRIPTIVE, ...Object.keys(SECTIONS), 'rule', 'baseHash', 'variant', 'benchmark']);
const BENCHMARK_KINDS = ['hold_day_one'];
const BUY_BACK_RULE_TYPES = ['recovery_break', 'move_allowance', 'giveback'];

function checkValue(p, v, s, errors) {
  if (v === undefined) { if (!s.optional) errors.push(`${p} is required`); return; }
  if ('exact' in s) { if (v !== s.exact) errors.push(`${p} must be ${JSON.stringify(s.exact)}`); return; }
  if (s.halfSpread) {
    if (v !== 'calibrated' && !(isNum(v) && v >= 0)) errors.push(`${p} must be "calibrated" or a number of bps (at least 0)`);
    return;
  }
  if (s.type === 'number') {
    if (!isNum(v)) { errors.push(`${p} must be a finite number`); return; }
    if (s.int && !Number.isInteger(v)) errors.push(`${p} must be a whole number`);
    if (s.min != null && v < s.min) errors.push(`${p} must be at least ${s.min}`);
    if (s.max != null && v > s.max) errors.push(`${p} must be at most ${s.max}`);
    if (s.gt != null && !(v > s.gt)) errors.push(`${p} must be greater than ${s.gt}`);
    if (s.lt != null && !(v < s.lt)) errors.push(`${p} must be less than ${s.lt}`);
    return;
  }
  if (typeof v !== s.type) { errors.push(`${p} must be a ${s.type}`); return; }
  if (s.values && !s.values.includes(v)) errors.push(`${p} must be ${s.values.map((x) => JSON.stringify(x)).join(' or ')}`);
}

function checkSection(name, obj, schema, errors, extraAllowed = []) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errors.push(`${name} must be an object`); return; }
  for (const [k, s] of Object.entries(schema)) checkValue(`${name}.${k}`, obj[k], s, errors);
  for (const k of Object.keys(obj)) {
    if (!(k in schema) && !DESCRIPTIVE.includes(k) && !extraAllowed.includes(k)) errors.push(`${name}.${k} is not a known setting`);
  }
}

export function validateHxrConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return ['config must be an object'];
  if (cfg.strategy !== 'hxr') errors.push('strategy must be "hxr"');
  if (typeof cfg.version !== 'string' || !cfg.version.trim()) errors.push('version is required');
  for (const k of Object.keys(cfg)) if (!TOP_KEYS.has(k)) errors.push(`${k} is not a known setting`);
  const pooled = cfg.account?.allocation === 'risk_sized';
  for (const [name, schema] of Object.entries(SECTIONS)) {
    if (RISK_SECTIONS.includes(name)) {
      if (pooled) checkSection(name, cfg[name], schema, errors);
      else if (cfg[name] !== undefined) errors.push(`${name} is only used when account.allocation is risk_sized`);
      continue;
    }
    checkSection(name, cfg[name], schema, errors);
  }
  if (pooled && cfg.risk && isNum(cfg.risk.resumeDeclineUsd) && isNum(cfg.risk.pauseDeclineUsd) && !(cfg.risk.resumeDeclineUsd < cfg.risk.pauseDeclineUsd)) errors.push('risk.resumeDeclineUsd must be below risk.pauseDeclineUsd');
  const rule = cfg.rule;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) errors.push('rule must be an object');
  else if (!RULE_TYPES.includes(rule.type)) errors.push(`rule.type must be ${RULE_TYPES.map((t) => JSON.stringify(t)).join(' or ')}`);
  else {
    checkSection('rule', rule, RULE_PARAMS[rule.type], errors, ['type']);
    if (BUY_BACK_RULE_TYPES.includes(rule.type)) {
      if (rule.afterMissedRebound === 'fresh_entry_after_sessions' && !Number.isInteger(rule.freshEntryMinSessions)) errors.push('rule.freshEntryMinSessions is required for fresh_entry_after_sessions');
      if (rule.afterMissedRebound !== 'fresh_entry_after_sessions' && rule.freshEntryMinSessions !== undefined) errors.push('rule.freshEntryMinSessions is only used with fresh_entry_after_sessions');
    }
  }
  if (cfg.baseHash !== undefined && !/^[0-9a-f]{64}$/.test(String(cfg.baseHash))) errors.push('baseHash must be a SHA-256 hex digest');
  if (cfg.variant !== undefined && (cfg.baseHash === undefined || !cfg.variant || typeof cfg.variant !== 'object')) errors.push('variant needs an object and a baseHash');
  // A derived benchmark (holdDayOneConfig): the candidate it was derived from and its hash.
  if (cfg.benchmark !== undefined) {
    const b = cfg.benchmark;
    if (!b || typeof b !== 'object' || !BENCHMARK_KINDS.includes(b.kind) || typeof b.from !== 'string' || !/^[0-9a-f]{64}$/.test(String(b.baseHash))) errors.push(`benchmark needs kind (${BENCHMARK_KINDS.join(', ')}), from and the candidate's baseHash`);
    else if (cfg.rule?.type !== 'hold') errors.push('a derived benchmark uses the hold rule');
  }
  return errors;
}

// Relative paths that do not exist from the working directory are looked up in
// strategy/hxr/configs. A file named hxr-*.json must be named after the
// version it holds (configFileName).
function resolveConfigPath(file) {
  if (!path.isAbsolute(file) && !fs.existsSync(path.resolve(file)) && fs.existsSync(path.join(HXR_CONFIG_DIR, file))) return path.join(HXR_CONFIG_DIR, file);
  return path.resolve(file);
}

// The one file name for a version in strategy/hxr/configs: hxr-<version>.json,
// or <version>.json when the version already starts with "hxr-" (the frozen
// hxr-1.0.0 is recorded as hxr-1.0.0.json, its JSON unchanged).
export function configFileName(version) {
  const v = String(version ?? '');
  return v.startsWith('hxr-') ? `${v}.json` : `hxr-${v}.json`;
}

export function loadHxrConfig(file) {
  const full = resolveConfigPath(file);
  const cfg = readJson(full);
  const errors = validateHxrConfig(cfg);
  const name = path.basename(full);
  if (/^hxr-.+\.json$/.test(name) && typeof cfg?.version === 'string' && configFileName(cfg.version) !== name) {
    errors.push(`the file name ${name} does not match the config's version ${cfg.version} (expected ${configFileName(cfg.version)})`);
  }
  if (errors.length) throw new Error(`Invalid HXR config ${path.basename(full)}: ${errors.join('; ')}`);
  return deepFreeze(cfg);
}

export function hxrConfigHash(cfg) {
  return configHash(cfg);
}

// Every config in strategy/hxr/configs, sorted by file name. A file that does
// not validate is listed with its error instead of a config.
export function listHxrConfigs(dir = HXR_CONFIG_DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    try {
      const config = loadHxrConfig(path.join(dir, f));
      return { file: f, version: config.version, label: config.label ?? null, ruleType: config.rule.type, hash: hxrConfigHash(config), config };
    } catch (e) {
      return { file: f, error: e.message };
    }
  });
}

const VARIANT_KEYS = ['spreadSlippageMultiplier', 'delaySessions', 'fillModel', 'withholdingPct'];

// A stress or reporting variant of a base config (PREREGISTRATION.md sections
// 5 and 10): spread and slippage multiplied, a longer delay, the other fill
// model or another withholding rate. The copy records the base hash and the
// variant, both of which are hashed, so its hash always differs from the base's.
export function variantConfig(cfg, opts = {}) {
  if (cfg?.variant !== undefined || cfg?.baseHash !== undefined) throw new Error('variantConfig needs a base config, not a variant');
  const baseErrors = validateHxrConfig(cfg);
  if (baseErrors.length) throw new Error(`Invalid base config: ${baseErrors.join('; ')}`);
  for (const k of Object.keys(opts)) if (![...VARIANT_KEYS, 'label'].includes(k)) throw new Error(`Unknown variant option ${k}`);
  const changes = Object.fromEntries(VARIANT_KEYS.filter((k) => opts[k] !== undefined).map((k) => [k, opts[k]]));
  if (!Object.keys(changes).length) throw new Error('A variant needs at least one change');
  const out = clone(cfg);
  if (changes.spreadSlippageMultiplier !== undefined) {
    const m = changes.spreadSlippageMultiplier;
    if (!isNum(m) || !(m > 0)) throw new Error('spreadSlippageMultiplier must be a number above 0');
    out.costs.halfSpreadMultiplier = (out.costs.halfSpreadMultiplier ?? 1) * m;
    out.costs.slippageBps *= m;
  }
  if (changes.delaySessions !== undefined) out.execution.delaySessions = changes.delaySessions;
  if (changes.fillModel !== undefined) out.execution.fillModel = changes.fillModel;
  if (changes.withholdingPct !== undefined) out.dividends.withholdingPct = changes.withholdingPct;
  out.baseHash = hxrConfigHash(cfg);
  out.variant = changes;
  const desc = Object.entries(changes).map(([k, v]) => `${k} ${v}`).join(', ');
  out.label = opts.label ?? `${cfg.label ?? cfg.version} (variant: ${desc})`;
  const errors = validateHxrConfig(out);
  if (errors.length) throw new Error(`The variant makes the config invalid: ${errors.join('; ')}`);
  return deepFreeze(out);
}

// The second benchmark of hxr-prereg-3a section 5: the candidate's day-one
// positions, held. The candidate's account, costs and sizing settings with the
// hold rule, so its initial allocation is the candidate's and it never sells.
// Derived at run time, never a file; `benchmark.baseHash` records the candidate's.
export function holdDayOneConfig(cfg) {
  if (cfg?.account?.allocation !== 'risk_sized') throw new Error('The day-one hold benchmark is derived from a risk-sized candidate');
  if (cfg.variant !== undefined || cfg.baseHash !== undefined) throw new Error('holdDayOneConfig needs a base candidate, not a variant');
  const out = clone(cfg);
  out.version = `${cfg.version}:hold-day-one`;
  out.rule = { type: 'hold' };
  out.initialLoss = { ...out.initialLoss, volSessions: cfg.initialLoss?.volSessions ?? cfg.rule?.volSessions ?? 20 };
  // Not a variant: the final run builds cost, delay, fill and withholding variants of it.
  out.benchmark = { kind: 'hold_day_one', from: cfg.version, baseHash: hxrConfigHash(cfg) };
  out.label = `Hold the day-one positions (benchmark, derived from ${cfg.version})`;
  out.status = 'benchmark: the positions the candidate opens at the period start, never sold (PREREGISTRATION-3a.md section 5)';
  const errors = validateHxrConfig(out);
  if (errors.length) throw new Error(`The day-one hold config is invalid: ${errors.join('; ')}`);
  return deepFreeze(out);
}

// The half-spread (bps) a config uses for one symbol and date: a fixed number,
// or the calibrated table value; the floor applies first, then any variant
// multiplier. calibrated(symbol, date) is the table lookup (data.js halfSpreadFn).
export function halfSpreadFor(cfg, calibrated = null) {
  const floor = cfg.costs.halfSpreadFloorBps, mult = cfg.costs.halfSpreadMultiplier ?? 1;
  if (cfg.costs.halfSpread === 'calibrated') {
    if (typeof calibrated !== 'function') throw new Error('This config uses calibrated half-spreads: a calibration table is needed');
    return (symbol, date) => Math.max(calibrated(symbol, date), floor) * mult;
  }
  const fixed = Math.max(cfg.costs.halfSpread, floor) * mult;
  return () => fixed;
}

// ---------- universe ----------

export function validateHxrUniverse(u) {
  const errors = [];
  if (!u || typeof u !== 'object') return ['universe must be an object'];
  if (!Array.isArray(u.symbols) || !u.symbols.length) return ['universe needs a symbols list'];
  if (!u.baskets || typeof u.baskets !== 'object' || Array.isArray(u.baskets)) return ['universe needs a baskets object'];
  const known = new Set();
  for (const s of u.symbols) {
    const sym = s?.symbol;
    if (typeof sym !== 'string' || !SYMBOL.test(sym)) { errors.push(`invalid symbol ${JSON.stringify(sym)}`); continue; }
    if (known.has(sym)) errors.push(`${sym} is listed twice`);
    known.add(sym);
    if (typeof s.exchange !== 'string' || !s.exchange) errors.push(`${sym} needs an exchange`);
    if (!isDate(s.listedFrom)) errors.push(`${sym} needs a listedFrom date (YYYY-MM-DD)`);
    if (!Array.isArray(s.baskets)) errors.push(`${sym} needs a baskets list`);
  }
  for (const [name, b] of Object.entries(u.baskets)) {
    if (!b || !Array.isArray(b.symbols)) { errors.push(`basket ${name} needs a symbols list`); continue; }
    const seen = new Set();
    for (const sym of [...b.symbols, ...(b.addWhenConfirmed || [])]) {
      if (!known.has(sym)) errors.push(`basket ${name} names an unknown symbol ${sym}`);
      if (seen.has(sym)) errors.push(`basket ${name} lists ${sym} twice`);
      seen.add(sym);
    }
    if (b.addWhenConfirmed !== undefined && !Array.isArray(b.addWhenConfirmed)) errors.push(`basket ${name}: addWhenConfirmed must be a list`);
  }
  // A symbol's own basket list must agree with the basket.
  for (const s of u.symbols) {
    for (const name of Array.isArray(s?.baskets) ? s.baskets : []) {
      const b = u.baskets[name];
      if (!b) errors.push(`${s.symbol} names an unknown basket ${name}`);
      else if (!b.symbols?.includes(s.symbol) && !(b.addWhenConfirmed || []).includes(s.symbol)) errors.push(`${s.symbol} says it is in basket ${name}, which does not list it`);
    }
  }
  return errors;
}

export function loadHxrUniverse(file = UNIVERSE_PATH) {
  const u = readJson(file);
  const errors = validateHxrUniverse(u);
  if (errors.length) throw new Error(`Invalid HXR universe ${path.basename(file)}: ${errors.join('; ')}`);
  return deepFreeze(u);
}

export function universeEntry(universe, symbol) {
  const e = universe.symbols.find((s) => s.symbol === symbol);
  if (!e) throw new Error(`${symbol} is not in the HXR universe`);
  return e;
}

// [{ symbol, exchange, listedFrom }] of a basket in its listed order (the
// engine's sleeves). withPending adds addWhenConfirmed (SPCX once the owner
// confirmed it).
export function basketSymbols(universe, name, { withPending = false } = {}) {
  const b = universe.baskets?.[name];
  if (!b) throw new Error(`Unknown HXR basket ${name}`);
  const list = [...b.symbols, ...(withPending ? b.addWhenConfirmed || [] : [])];
  return deepFreeze(list.map((sym) => {
    const e = universeEntry(universe, sym);
    return { symbol: e.symbol, exchange: e.exchange, listedFrom: e.listedFrom, techAi: !!e.techAi };
  }));
}

// ---------- periods ----------

export function validateHxrPeriods(p, universe = null) {
  const errors = [];
  if (!p || typeof p !== 'object') return ['periods must be an object'];
  if (!p.periods || typeof p.periods !== 'object') return ['periods file needs a periods object'];
  if (p.dataFrom !== undefined && !isDate(p.dataFrom)) errors.push('dataFrom must be a YYYY-MM-DD date');
  if (!Number.isInteger(p.warmupSessions) || p.warmupSessions < 1) errors.push('warmupSessions must be a whole number of at least 1');
  for (const k of [...BACKTEST_PERIODS, ...REPORTED_PERIODS]) {
    const x = p.periods[k];
    if (!x) { if (BACKTEST_PERIODS.includes(k)) errors.push(`period ${k} is missing`); continue; }
    for (const f of ['warmupFrom', 'start', 'end']) if (!isDate(x[f])) errors.push(`period ${k} needs a ${f} date (YYYY-MM-DD)`);
    if (isDate(x.warmupFrom) && isDate(x.start) && x.warmupFrom > x.start) errors.push(`period ${k}: warmupFrom is after start`);
    if (isDate(x.start) && isDate(x.end) && x.start > x.end) errors.push(`period ${k}: start is after end`);
    if (isDate(p.dataFrom) && isDate(x.warmupFrom) && x.warmupFrom < p.dataFrom) errors.push(`period ${k}: warmupFrom is before dataFrom`);
  }
  for (const [k, x] of Object.entries(p.periods)) {
    if (typeof x?.basket !== 'string') errors.push(`period ${k} needs a basket`);
    else if (universe && !universe.baskets?.[x.basket]) errors.push(`period ${k} names an unknown basket ${x.basket}`);
  }
  if (!Array.isArray(p.excludedSessions)) errors.push('excludedSessions must be a list');
  else {
    const seen = new Set();
    for (const x of p.excludedSessions) {
      if (!isDate(x?.date)) { errors.push('every excluded session needs a YYYY-MM-DD date'); continue; }
      if (typeof x.reason !== 'string' || !x.reason.trim()) errors.push(`excluded session ${x.date} needs a reason`);
      if (seen.has(x.date)) errors.push(`excluded session ${x.date} is listed twice`);
      seen.add(x.date);
    }
  }
  return errors;
}

export function loadHxrPeriods(file = PERIODS_PATH, { universe = loadHxrUniverse() } = {}) {
  const p = readJson(file);
  const errors = validateHxrPeriods(p, universe);
  if (errors.length) throw new Error(`Invalid HXR periods ${path.basename(file)}: ${errors.join('; ')}`);
  return deepFreeze(p);
}

// Sorted dates skipped for every symbol.
export function excludedDates(periods) {
  return [...new Set((periods?.excludedSessions || []).map((x) => x.date))].sort();
}

// ---------- criteria ----------

const CRITERIA_FIELDS = {
  G1: { minSessions: int({ min: 1 }), minRoundTrips: int({ min: 0 }), minHoldDrawdownPct: num({ gt: 0 }) },
  G2: { maxRatioToHold: num({ gt: 0 }) },
  G3: { minRatioToHold: num({ gt: 0 }) },
  G4: { maxShortfallPctPoints: num({ min: 0 }) },
  G5: {},
  G6: { minPassing: int({ min: 1 }) },
};
const PROSPECTIVE_FIELDS = {
  P1: { minMonths: num({ gt: 0 }), minDecisions: int({ min: 1 }) },
  P2: { minOnTimePct: num({ min: 0, max: 100 }) },
  P3: { maxMedianBps: num({ min: 0 }) },
  P4: {},
};

export function validateHxrCriteria(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['criteria must be an object'];
  for (const k of ['PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE']) if (typeof c.outcomes?.[k] !== 'string') errors.push(`outcomes.${k} is required`);
  const sel = c.selection || {};
  checkValue('selection.minRoundTrips', sel.minRoundTrips, int({ min: 0 }), errors);
  if (sel.pickRule !== undefined) {
    // hxr-prereg-3a: the owner's pick rule (ending_value or return_to_drawdown), pending until amendment 3b.
    checkValue('selection.pickRule', sel.pickRule, oneOf(PICK_RULES), errors);
    if (!Array.isArray(sel.benchmarks) || !sel.benchmarks.length) errors.push('selection.benchmarks must list the benchmarks');
    checkValue('selection.pickRules.return_to_drawdown.mustReachTimesBenchmarks', sel.pickRules?.return_to_drawdown?.mustReachTimesBenchmarks, num({ gt: 0 }), errors);
  } else checkValue('selection.stopUnlessAtLeastTimesHold', sel.stopUnlessAtLeastTimesHold, num({ gt: 0 }), errors);
  if (c.validation !== undefined) {
    checkValue('validation.V1.minRoundTrips', c.validation?.V1?.minRoundTrips, int({ min: 0 }), errors);
    checkValue('validation.V2.minRatioToHold', c.validation?.V2?.minRatioToHold, num({ gt: 0 }), errors);
  }
  for (const [list, fields] of [['criteria', CRITERIA_FIELDS], ['prospective', PROSPECTIVE_FIELDS]]) {
    if (!Array.isArray(c[list])) { errors.push(`${list} must be a list`); continue; }
    const ids = c[list].map((x) => x?.id);
    for (const [id, f] of Object.entries(fields)) {
      const n = ids.filter((x) => x === id).length;
      if (n !== 1) { errors.push(`${list} must hold ${id} exactly once`); continue; }
      const x = c[list].find((y) => y.id === id);
      for (const [k, s] of Object.entries(f)) checkValue(`${id}.${k}`, x[k], s, errors);
    }
    for (const id of ids) if (!(id in fields)) errors.push(`${list}: unknown criterion ${id}`);
  }
  const g5 = Array.isArray(c.criteria) ? c.criteria.find((x) => x?.id === 'G5') : null;
  if (g5 && (!Array.isArray(g5.variants) || !g5.variants.length)) errors.push('G5.variants must be a non-empty list');
  return errors;
}

export function loadHxrCriteria(file = CRITERIA_PATH) {
  const c = readJson(file);
  const errors = validateHxrCriteria(c);
  if (errors.length) throw new Error(`Invalid HXR criteria ${path.basename(file)}: ${errors.join('; ')}`);
  return deepFreeze(c);
}

export const criterion = (criteria, id) => criteria.criteria.find((x) => x.id === id) || criteria.prospective.find((x) => x.id === id) || null;

export { canonicalJson, deepFreeze };
