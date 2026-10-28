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
// rt-code-2026-10-28-1: the owner's decisions (EXPERIMENT-LOG.md entry 7): D1 no retirement and the re-entry
// limit as a refused signal at or above P; D2 the recovery entry's up close and no top-zone close since the
// bottom visit; D3 the broken range (qualified again only on a window entirely after the confirming close,
// breaks checked at every close from the warm-up on); D4 benchmark (a) as the equal-weight fractional index,
// never rebalanced; the pullback watch ending at the fill of its entry; D5's per-stock reporting.
// rt-code-2026-10-28-2: the second fix pass (EXPERIMENT-LOG.md entry 12): a pending buy's and a position's
// decision-time copy of P (afterSale.price, reported with the fill and the trade) is split-adjusted; benchmark
// (a)'s last close is split-adjusted on a session without a bar; the D5 per-stock report lists every basket
// stock, with zeros. Reporting and an edge of the index only; no decision, fill or exit changes.
export const CODE_REVISION = 'rt-code-2026-10-28-2';

// PLAN-DRAFT.md v0.5 section 6 (D6, D7): range 4 and trend 4, eight runs plus one verified-defect reserve.
// No combination runs and no HXR diagnostic. The 0.1.0 files are superseded: they keep their pins and are
// refused by validateConfig (they lack the D1-D4 declarations).
export const PLANNED_CONFIGS = [
  'rt-range-dip-limit-0.2.0.json', 'rt-range-dip-nolimit-0.2.0.json', 'rt-range-recovery-limit-0.2.0.json', 'rt-range-recovery-nolimit-0.2.0.json',
  'rt-trend-immediate-limit-0.2.0.json', 'rt-trend-immediate-nolimit-0.2.0.json', 'rt-trend-pullback-limit-0.2.0.json', 'rt-trend-pullback-nolimit-0.2.0.json',
];
export const SUPERSEDED_CONFIGS = [
  'rt-range-dip-limit-0.1.0.json', 'rt-range-dip-nolimit-0.1.0.json', 'rt-range-recovery-limit-0.1.0.json', 'rt-range-recovery-nolimit-0.1.0.json',
  'rt-trend-immediate-limit-0.1.0.json', 'rt-trend-immediate-nolimit-0.1.0.json', 'rt-trend-pullback-limit-0.1.0.json', 'rt-trend-pullback-nolimit-0.1.0.json',
];

// The planned and superseded configs, pinned: SHA-256 of each file's text with line endings normalised to LF,
// so the pin does not depend on how the repository was checked out. loadConfig refuses a pinned file that differs.
export const CONFIG_SHA256 = Object.freeze({
  'rt-range-dip-limit-0.2.0.json': '3821d3cafd6404c284947ac93dfc83cd0aebe32b4a029a2c6f5fe5121d1e3f45',
  'rt-range-dip-nolimit-0.2.0.json': 'bb688904c7f7e6002476d3306a10a867da1ae58ed8f7153e9447cccdf458ffbe',
  'rt-range-recovery-limit-0.2.0.json': 'd2f85cc62fd6b02925336100646e6dcd600a08d11d633136708205343e97c4e8',
  'rt-range-recovery-nolimit-0.2.0.json': '02d1d1bb3992695cd25a8766ecdcd150c11b2b903bd2dda27e34fc158c88a591',
  'rt-trend-immediate-limit-0.2.0.json': 'a8bac4bab5cb025a2509767a47a0e09b6d3163b61441377690f2b9605739204f',
  'rt-trend-immediate-nolimit-0.2.0.json': '4ab4915018ed60ae937f09a1abd04ce90be98ab2e3256de0724b7f24fa604105',
  'rt-trend-pullback-limit-0.2.0.json': 'ac3bd8058a426eb3367b90dfcf4931ae18d26813eb9f504a5454395a5e78466f',
  'rt-trend-pullback-nolimit-0.2.0.json': 'b697bf188f041ffe2e1dbeac447e9da26b4742b982a39598189f932c25393422',
  // Superseded (not runnable), pins kept unchanged.
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
  // The owner's decisions D1-D4 and the watch rule (EXPERIMENT-LOG.md entry 7) are declared in every runnable
  // config, with the single value the engine implements; the superseded 0.1.0 files lack them and cannot run.
  if (c.reentryRetire !== false) e.push('reentryRetire must be false (D1: no stock is ever retired)');
  const L = c.levels || {};
  if (L.recoveryUpClose !== true) e.push('levels.recoveryUpClose must be true (D2: a recovery entry needs an up close)');
  if (L.recoveryNoTopSinceBottom !== true) e.push('levels.recoveryNoTopSinceBottom must be true (D2: no top-zone close since the bottom visit)');
  if (L.brokenRange !== 'post_break_window') e.push('levels.brokenRange must be "post_break_window" (D3: a broken range re-qualifies only on a window entirely after the confirming close)');
  if (L.pullbackWatchEndsAt !== 'fill') e.push('levels.pullbackWatchEndsAt must be "fill" (the pullback watch ends when its entry fills)');
  if (c.benchmark?.buyAndHold !== 'equal_weight_fractional_never_rebalanced') e.push('benchmark.buyAndHold must be "equal_weight_fractional_never_rebalanced" (D4)');
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
      return { file, version: c.version, family: c.family, entry: c.entry, reentryLimit: c.reentryLimit, hash: configHash(c), planned: PLANNED_CONFIGS.includes(file), superseded: SUPERSEDED_CONFIGS.includes(file), error: null };
    } catch (err) {
      return { file, version: null, hash: null, planned: PLANNED_CONFIGS.includes(file), superseded: SUPERSEDED_CONFIGS.includes(file), error: err.message };
    }
  });
}

// EVALUATION-THRESHOLDS.md (keep or drop MU, the Tier 3 thresholds, the journal minimums) is frozen before any
// evaluation result is accessed and is never read by the practice-run gate.
export const THRESHOLDS_PATH = path.join(RT_DIR, 'EVALUATION-THRESHOLDS.md');

// EVALUATION-PROTOCOL.md: practice runs need the file with both dedicated fields filled in: a line
// "**Pick rule:** <text>" and a line "**Date-choice rule:** <text>", read outside code fences and HTML comments
// and each present exactly once. A value is unset when it is empty or contains "[OWNER", "TBD", "TODO" or "?",
// and the file is not ready while "[OWNER" remains anywhere in it. The hash is of the whole text with line
// endings normalised to LF; it is frozen at the first practice run and final for the practice runs.
export const UNSET = (v) => !v || !String(v).trim() || /\[OWNER|\bTBD\b|\bTODO\b|\?/i.test(String(v));
const visibleText = (text) => text.replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '');
const fields = (text, name) => [...text.matchAll(new RegExp(`^\\*\\*${name}:\\*\\*[ \\t]*(.*)$`, 'gm'))].map((m) => m[1].trim());

export function protocolStatus(file = PROTOCOL_PATH) {
  if (!fs.existsSync(file)) return { exists: false, pickRule: null, dateChoiceRule: null, hash: null, ready: false, reason: 'strategy/range-trend/EVALUATION-PROTOCOL.md does not exist' };
  const text = fs.readFileSync(file, 'utf8');
  const visible = visibleText(text);
  const picks = fields(visible, 'Pick rule'), dates = fields(visible, 'Date-choice rule');
  const problems = [];
  if (picks.length > 1) problems.push(`the pick rule ("**Pick rule:**") appears ${picks.length} times`);
  else if (!picks.length || UNSET(picks[0])) problems.push('no pick rule ("**Pick rule:**")');
  if (dates.length > 1) problems.push(`the date-choice rule ("**Date-choice rule:**") appears ${dates.length} times`);
  else if (!dates.length || UNSET(dates[0])) problems.push('no date-choice rule ("**Date-choice rule:**")');
  const markers = (text.match(/\[OWNER/gi) || []).length;
  if (markers) problems.push(`an owner marker ("[OWNER") remains in the file (${markers} found)`);
  const ready = !problems.length;
  return {
    exists: true, pickRule: picks.length === 1 && !UNSET(picks[0]) ? picks[0] : null, dateChoiceRule: dates.length === 1 && !UNSET(dates[0]) ? dates[0] : null,
    hash: textSha256(text), ready, reason: ready ? null : `EVALUATION-PROTOCOL.md: ${problems.join('; ')} (a field is unset when empty or containing "[OWNER", "TBD", "TODO" or "?")`,
  };
}

// strategy/range-trend/EXPERIMENT-LOG.md, read outside code fences and HTML comments (a row inside either is
// not a row): the owner-decisions entry (a table row whose "What" cell begins with "**Owner decisions D1-D8**",
// names each of D1 to D8 after the title, and names the current CODE_REVISION, so a row recorded against other
// code does not open the gate), and the practice runs it lists. A practice-run record's "What" cell begins
// "**Practice run** run id: N, config hash: <64 hex>" (PRACTICE_ROW). A row counts as a practice-run record,
// and must have that form or is reported as malformed (the gate refuses while one exists: fail closed), when
// its bold title (the leading **...**) mentions a practice run, or when its "What" cell carries a numeric run
// id ("run id:" followed by digits) anywhere, whatever its title. Plain prose that merely mentions practice
// runs or quotes the form with a placeholder ("run id: N"), in the body of a titled row or in a row without a
// bold title, is not a record and is ignored.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const namesRevision = (text, revision = CODE_REVISION) => new RegExp(`(^|[^\\w-])${escapeRe(revision)}(?![\\w-])`).test(text);
export const PRACTICE_ROW = /^\*\*Practice run\*\*\s*run id:\s*(\d+),\s*config hash:\s*([0-9a-f]{64})(?![0-9a-f])/i;
const MENTIONS_PRACTICE_RUN = /practice[\s-]*run/i;
const RECORD_FIELDS = /run id:\s*\d/i;
export const isPracticeRecord = (cell) => { const m = cell.match(/^\*\*([^*]+)\*\*/); return (m ? MENTIONS_PRACTICE_RUN.test(m[1]) : false) || RECORD_FIELDS.test(cell); };

export function logStatus(file = LOG_PATH) {
  if (!fs.existsSync(file)) return { exists: false, ownerDecisions: false, ownerDecisionsProblem: 'strategy/range-trend/EXPERIMENT-LOG.md does not exist', ownerRow: null, practiceRuns: [], malformed: [], nextNumber: 1 };
  const text = visibleText(fs.readFileSync(file, 'utf8'));
  const rows = text.split(/\r?\n/).filter((l) => l.startsWith('|')).map((l) => l.split('|').map((x) => x.trim()));
  const what = (r) => r[3] || '';
  const number = (r) => (/^\d+$/.test(r[1] || '') ? Number(r[1]) : null);
  const nextNumber = Math.max(0, ...rows.map(number).filter((n) => n != null)) + 1;
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
  const title = (cell) => { const m = cell.match(/^\*\*([^*]+)\*\*/); return m ? m[1] : cell.slice(0, 80); };
  const practiceRuns = [], malformed = [];
  for (const r of rows) {
    const cell = what(r), m = cell.match(PRACTICE_ROW);
    if (m) practiceRuns.push({ runId: Number(m[1]), configHash: m[2].toLowerCase(), number: number(r) });
    else if (isPracticeRecord(cell)) malformed.push({ number: number(r), title: title(cell) });
  }
  // ownerRevisionRows: the revisions named by owner-decisions rows that name D1 to D8 (for the first-run check).
  const ownerRows = titled.filter(namesAll).map(what);
  return { exists: true, ownerDecisions: !!owner, ownerDecisionsProblem, ownerRow: owner ? what(owner) : null, ownerRows, practiceRuns, malformed, nextNumber };
}
