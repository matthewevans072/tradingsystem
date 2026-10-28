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
export const LOG_PATH = path.join(RT_DIR, 'EXPERIMENT-LOG.md');

// Stored with every run (details.codeRevision); change it with any change that can alter results, including
// changes to the HXR modules range-trend imports (server/hxr/data.js, config.js, store.js and engine.js: the
// market-data inputs, the cost helpers, the readiness checks and benchmark (a)).
// rt-code-2026-10-26-1: the build (b6007e3). rt-code-2026-10-27-1: fix pass 1 (pullback watch, up close,
// split to zero shares, dividends and cash in lieu per trade, one EPS convention, replaced watches, H5, Tier 2).
export const CODE_REVISION = 'rt-code-2026-10-27-1';

// PLAN-DRAFT.md section 6: range 4 and trend 4. The combination runs (up to 2) get configs only after both
// families show measurable behaviour, with an experiment-log entry. The HXR diagnostic is an HXR run.
export const PLANNED_CONFIGS = [
  'rt-range-dip-limit-0.1.0.json', 'rt-range-dip-nolimit-0.1.0.json', 'rt-range-recovery-limit-0.1.0.json', 'rt-range-recovery-nolimit-0.1.0.json',
  'rt-trend-immediate-limit-0.1.0.json', 'rt-trend-immediate-nolimit-0.1.0.json', 'rt-trend-pullback-limit-0.1.0.json', 'rt-trend-pullback-nolimit-0.1.0.json',
];

// The eight planned configs, pinned: SHA-256 of each file's text with line endings normalised to LF, so the
// pin does not depend on how the repository was checked out. loadConfig refuses a planned file that differs.
export const CONFIG_SHA256 = Object.freeze({
  'rt-range-dip-limit-0.1.0.json': '1ad4126bab51b3887ce142ad8930c7eb4b032b63384a328486fd20372e9a0392',
  'rt-range-dip-nolimit-0.1.0.json': 'fdff445d4bc9ee8639b5eaa2928575d2b2ebe058f80e234ea63fb0008949871c',
  'rt-range-recovery-limit-0.1.0.json': '8cec6a9e4ec7f472906de6e4e42e212767609c291157a3595ea221dfc31997a1',
  'rt-range-recovery-nolimit-0.1.0.json': '6815fa333bf56c71bf2c4d31ec6a7d4166405b73ae0161174cce499a5897edfc',
  'rt-trend-immediate-limit-0.1.0.json': '889b25f8de8fc5ba6cf11faea93f4c2a5ebf2082f1cecb119b98218bc0c280f4',
  'rt-trend-immediate-nolimit-0.1.0.json': 'f09e8ea2ced62ffbcc5f1ca7df8158292a0595c58b03b621c005375971cd58b3',
  'rt-trend-pullback-limit-0.1.0.json': '6db5ddc817317981b36c9ba73fe9f6ba2f66060cf3168fe86558c6ddfcd3eca4',
  'rt-trend-pullback-nolimit-0.1.0.json': '0abab6e07a3d3c9b6024de1d68e05b5c1271a0dcf8ca428436090792cc9a2316',
});
export const textSha256 = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');

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
  const text = fs.readFileSync(full, 'utf8');
  const pin = CONFIG_SHA256[path.basename(full)];
  if (pin && textSha256(text) !== pin) throw new Error(`${path.basename(full)} differs from its pinned SHA-256 (config.js CONFIG_SHA256): a planned config is never edited in place`);
  const cfg = JSON.parse(text);
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

// EVALUATION-PROTOCOL.md: practice runs need the file with both dedicated fields filled in: a line
// "**Pick rule:** <text>" and a line "**Date-choice rule:** <text>". A value is unset when it is empty or
// contains "[OWNER", "TBD", "TODO" or "?". The hash is of the text with line endings normalised to LF.
export const UNSET = (v) => !v || !String(v).trim() || /\[OWNER|TBD|TODO|\?/i.test(String(v));
const field = (text, name) => { const m = text.match(new RegExp(`^\\*\\*${name}:\\*\\*[ \\t]*(.*)$`, 'm')); return m ? m[1].trim() : ''; };

export function protocolStatus(file = PROTOCOL_PATH) {
  if (!fs.existsSync(file)) return { exists: false, pickRule: null, dateChoiceRule: null, hash: null, ready: false, reason: 'strategy/range-trend/EVALUATION-PROTOCOL.md does not exist' };
  const text = fs.readFileSync(file, 'utf8');
  const pick = field(text, 'Pick rule'), dates = field(text, 'Date-choice rule');
  const missing = [UNSET(pick) && 'pick rule ("**Pick rule:**")', UNSET(dates) && 'date-choice rule ("**Date-choice rule:**")'].filter(Boolean);
  return {
    exists: true, pickRule: UNSET(pick) ? null : pick, dateChoiceRule: UNSET(dates) ? null : dates, hash: textSha256(text), ready: !missing.length,
    reason: missing.length ? `EVALUATION-PROTOCOL.md has no ${missing.join(' and no ')} yet (unset: empty, [OWNER ...], TBD, TODO or ?)` : null,
  };
}

// strategy/range-trend/EXPERIMENT-LOG.md: the owner-decisions entry (a table row whose "What" cell begins with
// "**Owner decisions D1-D8**", names each of D1 to D8 after the title, and names the current CODE_REVISION, so a
// row recorded against other code does not open the gate), and the practice runs it lists (rows beginning
// "**Practice run**" with "run id: N" and "config hash: <sha256>").
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const namesRevision = (text, revision = CODE_REVISION) => new RegExp(`(^|[^\\w-])${escapeRe(revision)}(?![\\w-])`).test(text);

export function logStatus(file = LOG_PATH) {
  if (!fs.existsSync(file)) return { exists: false, ownerDecisions: false, ownerDecisionsProblem: 'strategy/range-trend/EXPERIMENT-LOG.md does not exist', practiceRuns: [] };
  const text = fs.readFileSync(file, 'utf8');
  const rows = text.split(/\r?\n/).filter((l) => l.startsWith('|')).map((l) => l.split('|').map((x) => x.trim()));
  const what = (r) => r[3] || '';
  const TITLE = /^\*\*Owner decisions D1[-\u2013]D8\*\*/;
  const titled = rows.filter((r) => TITLE.test(what(r)));
  // Each of D1 to D8 must be named after the title (the title itself names D1 and D8), and so must the code revision.
  const namesAll = (r) => [1, 2, 3, 4, 5, 6, 7, 8].every((k) => new RegExp(`\\bD${k}\\b`).test(what(r).replace(TITLE, '')));
  const owner = titled.find((r) => namesAll(r) && namesRevision(what(r)));
  let ownerDecisionsProblem = null;
  if (!owner) {
    if (!titled.length) ownerDecisionsProblem = 'no row beginning "**Owner decisions D1-D8**"';
    else if (!titled.some(namesAll)) ownerDecisionsProblem = 'the owner-decisions row does not name each of D1 to D8';
    else ownerDecisionsProblem = `the owner-decisions row does not name the current code revision ${CODE_REVISION} (it was recorded against other code)`;
  }
  const practiceRuns = rows.filter((r) => /^\*\*Practice run\*\*/.test(what(r))).map((r) => {
    const id = what(r).match(/run id:\s*(\d+)/i), h = what(r).match(/config hash:\s*([0-9a-f]{64})/i);
    return { runId: id ? Number(id[1]) : null, configHash: h ? h[1] : null };
  });
  return { exists: true, ownerDecisions: !!owner, ownerDecisionsProblem, practiceRuns };
}
