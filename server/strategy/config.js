// Strategy Lab configuration: load, validate, hash and diff strategy configs,
// and read the pre-registered universe, splits and acceptance files.
// Simulation only; nothing here touches the real portfolio.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ENGINE_VERSION = 'engine-1.1.0';
export const TARGET_MODES = ['box_height', 'risk_multiple'];
export const STRATEGY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../strategy');
export const DEFAULT_CONFIG_PATH = path.join(STRATEGY_DIR, 'configs', 'cb-1.0.0.json');

export const AMBIGUITY = ['stop_first', 'target_first', 'tv_path'];
export const ENTRY_FILL = ['open_only', 'limit_intrabar'];
export const MODES = ['intraday', 'swing'];
// Descriptive fields: they never change what the engine does, so they are left
// out of the config hash (at any depth).
export const DESCRIPTIVE_KEYS = ['label', 'status', 'createdAt', 'notes', 'interpretation'];

const num = (o = {}) => ({ type: 'number', ...o });
const int = (o = {}) => ({ type: 'number', int: true, ...o });
const bool = (o = {}) => ({ type: 'boolean', ...o });
const oneOf = (values, o = {}) => ({ type: 'string', values, ...o });

// Rule-relevant settings. Every one is required unless marked optional.
const SCHEMA = {
  strategy: { type: 'string' },
  version: { type: 'string' },
  'bars.timeframeMinutes': int({ min: 15, max: 15, note: 'the engine works on 15-minute bars only' }),
  'bars.session': oneOf(['regular']),
  'bars.direction': oneOf(['long_only']),
  'box.lookbackBars': int({ min: 2, max: 500 }),
  'box.atrLength': int({ min: 1, max: 500 }),
  'box.maxHeightAtr': num({ gt: 0 }),
  'box.minHeightAtr': num({ min: 0 }),
  'box.touchToleranceAtr': num({ min: 0 }),
  'box.minTouchesEach': int({ min: 1 }),
  'box.minBarsBetweenTouches': int({ min: 0 }),
  'box.setupExpiryBars': int({ min: 1 }),
  'box.invalidateOnCloseBelowSupport': bool(),
  'box.allowWindowAcrossSessions': bool({ optional: true }),
  'entry.volumeMultiple': num({ min: 0 }),
  'entry.volumeLookbackBars': int({ min: 1, max: 500 }),
  'entry.maxGapAtr': num({ min: 0 }),
  'entry.minRewardRisk': num({ gt: 0 }),
  'entry.orderType': oneOf(['limit_at_next_open']),
  'entry.noNewEntriesMinutesBeforeClose': int({ min: 0, max: 390 }),
  'stop.atrBuffer': num({ min: 0 }),
  'stop.maxCostToRiskPct': num({ gt: 0 }),
  'stop.minStopAtr': num({ min: 0 }),
  'target.boxHeightMultiple': num({ gt: 0, optional: true, note: 'required unless target.mode is risk_multiple' }),
  'target.mode': oneOf(TARGET_MODES, { optional: true }),
  'management.trailingStop': { type: 'boolean', values: [false], note: 'not supported in this baseline' },
  'management.partialExits': { type: 'boolean', values: [false], note: 'not supported in this baseline' },
  'management.breakevenMove': { type: 'boolean', values: [false], note: 'not supported in this baseline' },
  'modes.intraday.flattenMinutesBeforeClose': int({ min: 0, max: 390 }),
  'modes.swing.maxHoldSessions': int({ min: 1, max: 1000 }),
  'modes.swing.flattenMinutesBeforeCloseOnLastSession': int({ min: 0, max: 390 }),
  'costs.accountCurrency': oneOf(['USD', 'CAD']),
  'costs.commissionPerShare': num({ min: 0 }),
  'costs.commissionMinPerOrder': num({ min: 0 }),
  'costs.commissionMaxPctOfValue': num({ min: 0, nullable: true }),
  'costs.halfSpreadBps': num({ min: 0, max: 1000 }),
  'costs.slippageBps': num({ min: 0, max: 1000 }),
  'costs.limitFillTicksBeyond': int({ min: 0 }),
  'costs.tickSize': num({ gt: 0 }),
  'costs.fxConversionPct': num({ min: 0, max: 100 }),
  'risk.hypotheticalStartingEquity': num({ gt: 0 }),
  'risk.riskPerTradePct': num({ gt: 0, max: 100 }),
  'risk.maxOpenRiskPct': num({ gt: 0, max: 100 }),
  'risk.maxPositions': int({ min: 1 }),
  'risk.allowMargin': { type: 'boolean', values: [false], note: 'margin is never simulated' },
  'risk.allowShort': { type: 'boolean', values: [false], note: 'shorting is never simulated' },
  'risk.excludeLeveragedEtfs': bool({ optional: true }),
  'simulation.ambiguity': oneOf(AMBIGUITY),
  'simulation.entryFill': oneOf(ENTRY_FILL),
  'simulation.signalOrder': oneOf(['symbol_alphabetical']),
  'stress.entryWorseAtr': num({ min: 0, optional: true }),
};

export function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, p, v) {
  const ks = p.split('.');
  let o = obj;
  for (const k of ks.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[ks[ks.length - 1]] = v;
}

export function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return ['config must be an object'];
  for (const [p, s] of Object.entries(SCHEMA)) {
    const v = getPath(cfg, p);
    if (v === undefined || (v === null && !s.nullable)) {
      if (!s.optional) errors.push(`${p} is required`);
      continue;
    }
    if (v === null) continue;
    if (s.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${p} must be a finite number`); continue; }
      if (s.int && !Number.isInteger(v)) errors.push(`${p} must be a whole number`);
      if (s.min != null && v < s.min) errors.push(`${p} must be at least ${s.min}${s.note ? ` (${s.note})` : ''}`);
      if (s.max != null && v > s.max) errors.push(`${p} must be at most ${s.max}${s.note ? ` (${s.note})` : ''}`);
      if (s.gt != null && !(v > s.gt)) errors.push(`${p} must be greater than ${s.gt}`);
    } else if (typeof v !== s.type) {
      errors.push(`${p} must be a ${s.type}`);
    } else if (s.values && !s.values.includes(v)) {
      errors.push(`${p} must be ${s.values.map((x) => JSON.stringify(x)).join(' or ')}${s.note ? ` (${s.note})` : ''}`);
    }
  }
  // box_height (the default, cb-1.0.0): target = ceiling + multiple x box height.
  // risk_multiple (cb-1.1.0): target = effective entry + entry.minRewardRisk x risk, set at the fill.
  const tMode = getPath(cfg, 'target.mode') ?? 'box_height';
  if (tMode === 'box_height' && getPath(cfg, 'target.boxHeightMultiple') == null) errors.push('target.boxHeightMultiple is required');
  if (tMode === 'risk_multiple' && getPath(cfg, 'target.boxHeightMultiple') != null) errors.push('target.boxHeightMultiple is not used when target.mode is risk_multiple; remove it');
  const minH = getPath(cfg, 'box.minHeightAtr'), maxH = getPath(cfg, 'box.maxHeightAtr');
  if (typeof minH === 'number' && typeof maxH === 'number' && minH > maxH) errors.push('box.minHeightAtr must not exceed box.maxHeightAtr');
  return errors;
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadStrategyConfig(file = DEFAULT_CONFIG_PATH) {
  const cfg = readJson(path.resolve(file));
  const errors = validateConfig(cfg);
  if (errors.length) throw new Error(`Invalid strategy config ${path.basename(file)}: ${errors.join('; ')}`);
  return deepFreeze(cfg);
}

// Canonical JSON: object keys sorted at every level, descriptive keys removed.
export function canonicalJson(v, { omit = DESCRIPTIVE_KEYS } = {}) {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x, { omit })).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => !omit.includes(k) && v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k], { omit })}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function configHash(cfg) {
  return crypto.createHash('sha256').update(canonicalJson(cfg)).digest('hex');
}

// ops: { multiply: { 'a.b': x }, add: { ... }, set: { ... } }, applied in the
// order set, add, multiply. 'stress.entryWorseAtr' (default 0) is accepted for
// the stress tests even though the baseline config has no stress section.
export function applyOverrides(cfg, ops = {}) {
  const out = clone(cfg);
  for (const op of ['set', 'add', 'multiply']) {
    for (const [p, v] of Object.entries(ops[op] || {})) {
      if (!SCHEMA[p] && getPath(out, p) === undefined) throw new Error(`Unknown setting ${p}`);
      let cur = getPath(out, p);
      if (cur === undefined && p === 'stress.entryWorseAtr') cur = 0;
      if (op !== 'set' && (typeof cur !== 'number' || typeof v !== 'number')) throw new Error(`${p} is not numeric`);
      setPath(out, p, op === 'set' ? v : op === 'add' ? cur + v : cur * v);
    }
  }
  const errors = validateConfig(out);
  if (errors.length) throw new Error(`Overrides make the config invalid: ${errors.join('; ')}`);
  return deepFreeze(out);
}

function leaves(obj, prefix = '', out = new Map()) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) out.set(prefix, obj);
  return out;
}

export function diffConfigs(a, b) {
  const la = leaves(a), lb = leaves(b);
  const paths = [...new Set([...la.keys(), ...lb.keys()])].sort();
  const out = [];
  for (const p of paths) {
    const from = la.has(p) ? la.get(p) : undefined, to = lb.has(p) ? lb.get(p) : undefined;
    if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ path: p, from: from ?? null, to: to ?? null });
  }
  return out;
}

export function loadUniverse(file = path.join(STRATEGY_DIR, 'universe-v1.json')) {
  const u = readJson(file);
  if (!Array.isArray(u.symbols) || !u.symbols.every((s) => s.symbol && s.exchange)) throw new Error('Universe file needs symbols with symbol and exchange');
  return deepFreeze(u);
}

// The active periods: splits-v2 (splits-v1's dates plus four excluded NYSE
// sessions, decided before any result existed; PARAMETER-LOG.md). splits-v1
// stays on disk unchanged as the earlier version.
export const DEFAULT_SPLITS_PATH = path.join(STRATEGY_DIR, 'splits-v2.json');

export function loadSplits(file = DEFAULT_SPLITS_PATH) {
  const s = readJson(file);
  for (const k of ['warmup', 'development', 'validation', 'holdout']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s[k]?.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(s[k]?.to || '')) throw new Error(`Splits file: ${k} needs from/to dates`);
  }
  const ex = s.excludedSessions;
  if (ex !== undefined) {
    if (!ex || !Array.isArray(ex.sessions)) throw new Error('Splits file: excludedSessions needs a sessions list');
    const seen = new Set();
    for (const x of ex.sessions) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x?.date || '')) throw new Error('Splits file: every excluded session needs a YYYY-MM-DD date');
      if (!x.reason) throw new Error(`Splits file: excluded session ${x.date} needs a reason`);
      if (x.date < s.warmup.from || x.date > s.holdout.to) throw new Error(`Splits file: excluded session ${x.date} is outside ${s.warmup.from} to ${s.holdout.to}`);
      if (seen.has(x.date)) throw new Error(`Splits file: excluded session ${x.date} is listed twice`);
      seen.add(x.date);
    }
  }
  return deepFreeze(s);
}

// Sorted dates (exchange-local) of the sessions a splits version excludes for every symbol.
export function excludedSessionDates(splits) {
  return [...new Set((splits?.excludedSessions?.sessions || []).map((x) => x.date))].sort();
}

export function loadAcceptance(file = path.join(STRATEGY_DIR, 'acceptance-v1.json')) {
  const a = readJson(file);
  if (!Array.isArray(a.backtest) || !a.stressTests) throw new Error('Acceptance file needs backtest criteria and stressTests');
  return deepFreeze(a);
}
