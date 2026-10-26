// Range-trend configs (strategy/range-trend/configs/*.json): load, validate, hash.
// Only the planned practice runs (PLANNED_CONFIGS) are runnable.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../strategy/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RT_DIR = path.join(ROOT, 'strategy', 'range-trend');
export const RT_CONFIG_DIR = path.join(RT_DIR, 'configs');
export const PROTOCOL_PATH = path.join(RT_DIR, 'EVALUATION-PROTOCOL.md');

// Stored with every run (details.codeRevision); change it with any change that alters results.
export const CODE_REVISION = 'rt-code-2026-10-26-1';

// PLAN-DRAFT.md section 6: range 4 and trend 4. The combination runs (up to 2) get configs only after both
// families show measurable behaviour, with an experiment-log entry. The HXR diagnostic is an HXR run.
export const PLANNED_CONFIGS = [
  'rt-range-dip-limit-0.1.0.json', 'rt-range-dip-nolimit-0.1.0.json', 'rt-range-recovery-limit-0.1.0.json', 'rt-range-recovery-nolimit-0.1.0.json',
  'rt-trend-immediate-limit-0.1.0.json', 'rt-trend-immediate-nolimit-0.1.0.json', 'rt-trend-pullback-limit-0.1.0.json', 'rt-trend-pullback-nolimit-0.1.0.json',
];

const FAMILY_ENTRIES = { range: ['dip', 'recovery'], trend: ['immediate', 'pullback'] };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DESCRIPTIVE = ['label', 'status', 'notes'];

export const configHash = (cfg) => crypto.createHash('sha256').update(canonicalJson(Object.fromEntries(Object.entries(cfg).filter(([k]) => !DESCRIPTIVE.includes(k))))).digest('hex');

export function validateConfig(c) {
  const e = [];
  const num = (v, name, { min = 0, gt = false, int = false, max = Infinity } = {}) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || (gt ? v <= min : v < min) || v > max || (int && !Number.isInteger(v))) e.push(`${name} must be a number${gt ? ` above ${min}` : ` of at least ${min}`}${int ? ' (whole)' : ''}`);
  };
  if (!c || typeof c !== 'object') return ['config must be an object'];
  if (c.strategy !== 'range-trend') e.push('strategy must be "range-trend"');
  if (typeof c.version !== 'string' || !c.version) e.push('version is required');
  if (!FAMILY_ENTRIES[c.family]) e.push('family must be range or trend');
  else if (!FAMILY_ENTRIES[c.family].includes(c.entry)) e.push(`entry must be ${FAMILY_ENTRIES[c.family].join(' or ')} for the ${c.family} family`);
  if (typeof c.reentryLimit !== 'boolean') e.push('reentryLimit must be true or false');
  const L = c.levels || {};
  num(L.mSessions, 'levels.mSessions', { min: 1, int: true });
  num(L.windowSessions, 'levels.windowSessions', { min: 2, int: true });
  num(L.zoneFraction, 'levels.zoneFraction', { gt: true, max: 0.5 });
  num(L.minVisits, 'levels.minVisits', { min: 1, int: true });
  num(L.visitGap, 'levels.visitGap', { min: 1, int: true });
  for (const k of ['minHeightM', 'breakoutM', 'breakdownM', 'recoveryM', 'pullbackM']) num(L[k], `levels.${k}`);
  num(L.breakdownCloses, 'levels.breakdownCloses', { min: 1, int: true });
  const X = c.exits || {};
  num(X.rejectionM, 'exits.rejectionM');
  num(X.trendBelowHiCloses, 'exits.trendBelowHiCloses', { min: 1, int: true });
  num(X.trendGivebackM, 'exits.trendGivebackM', { gt: true });
  const P = c.portfolio || {};
  num(P.startingCash, 'portfolio.startingCash', { gt: true });
  num(P.positionCapPct, 'portfolio.positionCapPct', { gt: true, max: 100 });
  num(P.riskPerTradePct, 'portfolio.riskPerTradePct', { gt: true, max: 100 });
  if (P.totalEntryRiskPct !== null) num(P.totalEntryRiskPct, 'portfolio.totalEntryRiskPct', { gt: true, max: 100 });
  num(P.stopM, 'portfolio.stopM');
  if (P.addToPositions !== false) e.push('portfolio.addToPositions must be false (no adding in the first version)');
  const ex = c.execution || {};
  if (ex.decision !== 'after_close' || ex.fill !== 'next_open' || ex.delaySessions !== 1) e.push('execution must be after_close / next_open with delaySessions 1');
  const k = c.costs || {};
  for (const f of ['commissionPerOrder', 'commissionPerShare', 'secFeeRate', 'tafPerShare', 'tafMaxPerTrade', 'halfSpreadFloorBps', 'slippageBps']) num(k[f], `costs.${f}`);
  if (k.halfSpread !== 'calibrated' && !(typeof k.halfSpread === 'number' && k.halfSpread >= 0)) e.push('costs.halfSpread must be "calibrated" or a number');
  num(c.dividends?.withholdingPct, 'dividends.withholdingPct', { max: 100 });
  const pr = c.period || {};
  for (const f of ['warmupFrom', 'start', 'end']) if (!DATE.test(pr[f] || '')) e.push(`period.${f} must be YYYY-MM-DD`);
  if (pr.start && pr.end && pr.start > pr.end) e.push('period.start is after period.end');
  if (pr.basket !== 'A') e.push('period.basket must be "A" (HXR\'s ten stocks, decision 10)');
  return e;
}

export function loadConfig(file) {
  const full = path.isAbsolute(file) ? file : path.join(RT_CONFIG_DIR, file);
  const cfg = JSON.parse(fs.readFileSync(full, 'utf8'));
  const errors = validateConfig(cfg);
  if (errors.length) throw new Error(`${path.basename(full)}: ${errors.join('; ')}`);
  return Object.freeze(cfg);
}

export function listConfigs(dir = RT_CONFIG_DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    try {
      const c = loadConfig(path.join(dir, file));
      return { file, version: c.version, family: c.family, entry: c.entry, reentryLimit: c.reentryLimit, hash: configHash(c), planned: PLANNED_CONFIGS.includes(file), error: null };
    } catch (err) {
      return { file, version: null, hash: null, planned: PLANNED_CONFIGS.includes(file), error: err.message };
    }
  });
}

// EVALUATION-PROTOCOL.md: practice runs need the file and a filled-in pick rule
// (a line "**Pick rule:** <text>" whose text is not a placeholder).
export function protocolStatus(file = PROTOCOL_PATH) {
  if (!fs.existsSync(file)) return { exists: false, pickRule: null, hash: null, ready: false, reason: 'strategy/range-trend/EVALUATION-PROTOCOL.md does not exist' };
  const text = fs.readFileSync(file, 'utf8');
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const m = text.match(/^\*\*Pick rule:\*\*[ \t]*(.*)$/m);
  const rule = m ? m[1].trim() : '';
  const filled = rule && !/\[OWNER TO SET\]/i.test(rule);
  return { exists: true, pickRule: filled ? rule : null, hash, ready: !!filled, reason: filled ? null : 'EVALUATION-PROTOCOL.md has no pick rule yet ("**Pick rule:**" is missing or still [OWNER TO SET])' };
}
