// ICT Lab configuration (strategy/ict-lab/PROTOCOL.md, Part B): paths, the pre-registration pins, the code
// revision, the windows and the bar bound, the spec loader and validator, and the experiment-log reader with
// the row grammars of PROTOCOL.md section 10. Simulation only: nothing here reads market data, holdings or
// cash, and nothing places or prepares an order. Every number the engine uses comes from the pinned spec files
// (section 4) or from PROTOCOL.md's statistics section (metrics.js), never from a second copy here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const IL_DIR = path.join(ROOT, 'strategy', 'ict-lab');
export const SPEC_DIR = path.join(IL_DIR, 'specs');
export const REPORT_DIR = path.join(IL_DIR, 'reports');
export const PROTOCOL_PATH = path.join(IL_DIR, 'PROTOCOL.md');
export const CONCEPTS_PATH = path.join(IL_DIR, 'CONCEPTS.md');
export const LOG_PATH = path.join(IL_DIR, 'EXPERIMENT-LOG.md');
export const DB_NAME = 'ict-lab-sim.sqlite';
export const SWEEP_BOS_DB_NAME = 'sweep-bos-sim.sqlite';

// Stored with every data version and run. Bump it with any change that can alter results (rules.js, engine.js,
// metrics.js, data.js's session filter, or the Alpaca client's intradayBars).
// il-code-2026-11-04-1: the build (Parts B and C of EXPERIMENT-LOG.md entry 5); synthetic data only so far.
export const CODE_REVISION = 'il-code-2026-11-04-1';
export const ENGINE_VERSION = 'il-engine-1';

export const INSTRUMENT = 'QQQ';
export const STAND_IN_FOR = 'NQ';

// The owner's windows (PROTOCOL.md section 2). MAX_BAR_DATE is the storage and read bound: no bar after it is
// requested, stored or read until the owner's separate validation message, which becomes a new code revision
// and a new data version. The reserved window is never read and has no code path (windowOf refuses it).
export const WINDOWS = Object.freeze({
  development: Object.freeze({ start: '2018-06-01', end: '2022-12-30' }),
  validation: Object.freeze({ start: '2023-01-03', end: '2024-12-31' }),
  reserved: Object.freeze({ start: '2025-01-01', end: '2026-06-30' }),
});
export const MAX_BAR_DATE = '2022-12-30';
export const RUNNABLE_WINDOWS = Object.freeze(['development', 'validation']);
export function windowOf(name) {
  if (!RUNNABLE_WINDOWS.includes(name)) throw new Error(`window must be development or validation (the reserved window ${WINDOWS.reserved.start} to ${WINDOWS.reserved.end} has no code path)`);
  return WINDOWS[name];
}

// The pre-registration commit (Part A, EXPERIMENT-LOG.md entry 4) and the LF-text SHA-256 of every file it
// pins (entry 1's approval note). The gate checks the working files against these pins, that the commit exists
// and is an ancestor of HEAD, and that the committed files have these hashes.
export const PREREG = Object.freeze({
  commit: '00a2558c39cad16434bd79aedbc1b37cbae34916',
  committedAt: '2026-11-04T06:21:01-06:00',
  sha256: Object.freeze({
    'PROTOCOL.md': '28901369c2a9e021c716613c162d76bc7ed39904b863adb1387337f1104fef12',
    'CONCEPTS.md': '710e3f7ab45fbd9dbea3872b4b5b08dc14d51436537f15223bf7c1c14e4b6ab8',
    'specs/ict-sweep-bos-fvg-0.1.0.json': '98de4a037e58ca45d56cb8afb2f6f24b9ac8ae575411c627c291f7129bb403f9',
    'specs/ict-sweep-bos-ob-0.1.0.json': '53956d89712e68b944b0d62cf10413568394cbbda603fed73db047f0a41d197c',
    'specs/ict-ifvg-0.1.0.json': '1f64160c147a81fb8cd1168aabc97cf912640a51c7efeabf9088613154c55066',
    'specs/ict-breaker-0.1.0.json': '1f4d40b038fd53d1964a3788a546318b22932957640ad9463fe2bc58d09af65f',
  }),
});
export const PINNED_DOCS = Object.freeze(['PROTOCOL.md', 'CONCEPTS.md']);
export const ROUND1_SPECS = Object.freeze(['ict-sweep-bos-fvg-0.1.0.json', 'ict-sweep-bos-ob-0.1.0.json', 'ict-ifvg-0.1.0.json', 'ict-breaker-0.1.0.json']);
export const SPEC_SHA256 = Object.freeze(Object.fromEntries(ROUND1_SPECS.map((f) => [f, PREREG.sha256[`specs/${f}`]])));
export const ROUNDS = Object.freeze({ 1: ROUND1_SPECS });
export const roundSpecs = (round) => ROUNDS[round] || Object.freeze([]);
export const frozenTitle = (round) => `Code frozen for round ${round}`;
export const VALIDATION_TITLE = 'Validation authorized';

export const textSha256 = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
export const fileSha256 = (file) => textSha256(fs.readFileSync(file, 'utf8'));

const gitRunner = (root, git) => git || ((args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());

// Rule 1: the pre-registration commit exists, is an ancestor of HEAD and holds every pinned file with its pinned
// hash (git stores LF text; the working copy may be CRLF).
export function preregCommitStatus({ root = ROOT, prereg = PREREG, git = null } = {}) {
  const run = gitRunner(root, git);
  try { run(['cat-file', '-e', `${prereg.commit}^{commit}`]); } catch { return { ok: false, detail: `commit ${prereg.commit} is not in this repository` }; }
  try { run(['merge-base', '--is-ancestor', prereg.commit, 'HEAD']); } catch { return { ok: false, detail: `commit ${prereg.commit} is not an ancestor of HEAD` }; }
  for (const [name, want] of Object.entries(prereg.sha256)) {
    let committed;
    try { committed = run(['show', `${prereg.commit}:strategy/ict-lab/${name}`]); } catch { return { ok: false, detail: `commit ${prereg.commit} does not hold strategy/ict-lab/${name}` }; }
    if (textSha256(committed) !== want && textSha256(`${committed}\n`) !== want) return { ok: false, detail: `the committed ${name} does not have the pinned SHA-256` };
  }
  let when = null;
  try { when = run(['log', '-1', '--format=%cI', prereg.commit]); } catch { /* reported without a time */ }
  return { ok: true, detail: `commit ${prereg.commit.slice(0, 12)}${when ? ` (${when})` : ''} is an ancestor of HEAD and holds the ${Object.keys(prereg.sha256).length} pinned files`, committedAt: when };
}

// Rule 8: the ict-lab code and the pinned documents have no uncommitted change when a run starts (the run records
// HEAD). EXPERIMENT-LOG.md and reports/ are records the runs themselves append to, so they are not in this list.
export const COMMITTED_PATHS = Object.freeze(['server/ictlab', 'scripts/ictlab-run.mjs', 'scripts/ictlab-download.mjs', 'scripts/ictlab-report.mjs', 'server/hxr/source.js', 'strategy/ict-lab/specs', 'strategy/ict-lab/PROTOCOL.md', 'strategy/ict-lab/CONCEPTS.md']);
export function uncommittedChanges({ root = ROOT, git = null } = {}) {
  const out = gitRunner(root, git)(['status', '--porcelain', '--', ...COMMITTED_PATHS]);
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}
export function headCommit({ root = ROOT, git = null } = {}) {
  try { return gitRunner(root, git)(['rev-parse', 'HEAD']); } catch { return null; }
}

// The ict-lab code that decides results, hashed together (LF text) and stored with every run.
export const SOURCE_FILES = Object.freeze(['server/ictlab/config.js', 'server/ictlab/data.js', 'server/ictlab/engine.js', 'server/ictlab/metrics.js', 'server/ictlab/rules.js', 'server/ictlab/service.js', 'server/ictlab/store.js', 'server/hxr/source.js', 'scripts/ictlab-run.mjs']);
export function sourceHash(root = ROOT) {
  const h = crypto.createHash('sha256');
  for (const f of SOURCE_FILES) {
    const full = path.join(root, f);
    h.update(`${f}\n`);
    if (fs.existsSync(full)) h.update(fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n'));
    h.update('\n--\n');
  }
  return h.digest('hex');
}

// ---------- the spec files (PROTOCOL.md sections 4 and 5) ----------
// The schema says which fields exist and which values each may take: an array is the allowed set, 'int' a whole
// number, 'number' a finite number, 'bool' a boolean, 'date' YYYY-MM-DD, a nested object a nested block. The
// numbers themselves (0.01, 0.40, 0.05, 17, 2, 5000, 0.02 ...) live in the spec files only; the engine reads
// them from the loaded spec. The shared block must be byte-identical across the round's files (validateRound).
const INT = 'int', NUM = 'number', BOOL = 'bool', DATE = 'date';
export const SPEC_NAMES = Object.freeze(['ict-sweep-bos-fvg', 'ict-sweep-bos-ob', 'ict-ifvg', 'ict-breaker']);
export const SHARED_KEYS = Object.freeze(['version', 'round', 'instrument', 'standInFor', 'side', 'definitions', 'protocol', 'swing', 'sweep', 'timeWindow', 'timeStop', 'target', 'zones', 'exits', 'maxFilledTradesPerSession', 'oneOpenPosition', 'rearmAfterRefusedConfirmation', 'account', 'costs', 'windows']);
export const SHARED_ENTRY_KEYS = Object.freeze(['order', 'price', 'rounding', 'fill', 'requireEntryBelowConfirmClose']);
export const SHARED_STOP_KEYS = Object.freeze(['bufferDollars', 'minDistanceDollars']);
const SCHEMA_SHARED = {
  version: ['0.1.0'], round: INT, instrument: [INSTRUMENT], standInFor: [STAND_IN_FOR], side: ['long'],
  definitions: ['strategy/ict-lab/CONCEPTS.md'], protocol: ['strategy/ict-lab/PROTOCOL.md'],
  swing: { leftBars: INT, rightBars: INT, strict: [true], confirmBarOffset: INT, scope: ['session_local'] },
  sweep: { level: ['prior_session_low_daily_bar'], closeBackInside: ['close_above_level'], window: { firstBarIndex: INT, lastBarIndex: INT }, invalidation: ['none'], extreme: ['lowest_low_from_sweep_bar'] },
  timeWindow: { lastDecisionBarIndex: INT, lastFillBarIndex: INT },
  timeStop: { exitAtOpenOfBarIndex: ['n-1'] },
  target: { rMultiple: NUM },
  zones: { minHeightDollars: NUM },
  exits: { stopFirst: [true], stopCheckedOnFillBar: [true], targetCheckedOnFillBar: [false], gapThroughStopExitsAtOpen: [true] },
  maxFilledTradesPerSession: INT, oneOpenPosition: [true], rearmAfterRefusedConfirmation: [true],
  account: { startingCashUsd: NUM, maxPlannedRiskFraction: NUM, wholeShares: [true], leverage: [false], shorting: [false], sizing: ['min_risk_cash'] },
  costs: { halfSpread: NUM, slippage: NUM, commission: NUM, perSide: NUM, sensitivityMultiple: NUM },
  windows: { development: { start: DATE, end: DATE } },
};
const ENTRY_SHARED = { order: ['limit'], price: ['zone_midpoint'], rounding: ['half_cent_down'], fill: ['strictly_through_at_limit'], requireEntryBelowConfirmClose: [true] };
const STOP_SHARED = { bufferDollars: NUM, minDistanceDollars: NUM };
const BOS_SETUP = { requires: [['break_of_structure']], confirmation: ['bos_close'], bosAfterSweep: [true], displacementLeg: ['extreme_bar_to_bos_bar'], displacementMinimum: ['none'] };
const SCHEMA_BY_NAME = {
  'ict-sweep-bos-fvg': {
    setup: BOS_SETUP,
    entry: { ...ENTRY_SHARED, zone: ['fair_value_gap'], zoneSource: ['displacement_leg'], zoneSelection: ['latest'], zoneInequality: ['high_a_below_low_a_plus_2'] },
    stop: { ...STOP_SHARED, anchor: ['sweep_extreme'] },
  },
  'ict-sweep-bos-ob': {
    setup: BOS_SETUP,
    entry: { ...ENTRY_SHARED, zone: ['order_block'], zoneSource: ['latest_bearish_bar_at_or_before_extreme_bar'], zoneSelection: ['latest'], zoneSearchBackTo: ['session_index_0'] },
    stop: { ...STOP_SHARED, anchor: ['sweep_extreme'] },
  },
  'ict-ifvg': {
    setup: { requires: [['inversion_fvg']], confirmation: ['inversion_close'], inversionAfterSweep: [true], requiresBreakOfStructure: [false], bearishFvg: { inequality: ['low_a_above_high_a_plus_2'], eligibility: ['completed_in_session_d'], formedRelativeToSweep: ['either'], maxAgeBars: INT, closeThrough: ['close_strictly_above_upper_edge'], earliestInversionBar: ['a_plus_3'], selection: ['most_recent'] } },
    entry: { ...ENTRY_SHARED, zone: ['inversion_fvg'], zoneSource: ['bearish_fvg_closed_through'], zoneSelection: ['most_recent'], retest: ['first_subsequent_from_above'] },
    stop: { ...STOP_SHARED, anchor: ['min_of'], anchors: [['inverted_gap_lower_edge', 'sweep_extreme']] },
  },
  'ict-breaker': {
    setup: { requires: [['breaker', 'break_of_structure']], bearishOrderBlock: { from: ['downward_bos_leg'], legOrigin: ['highest_high_from_broken_swing_low_to_break_bar'], block: ['latest_bullish_bar_at_or_before_leg_origin'], searchBackTo: ['session_index_0'], breakRelativeToSweep: ['either'], selection: ['most_recent_at_failure'] }, breakerFailure: ['close_strictly_above_block_upper_edge'], failureAfterSweep: [true], bosAfterSweep: [true], coupling: { maxBarsApart: INT, order: ['either'], confirmation: ['later_close'] } },
    entry: { ...ENTRY_SHARED, zone: ['breaker'], zoneSource: ['failed_bearish_order_block'], zoneSelection: ['most_recent'], retest: ['first_subsequent'] },
    stop: { ...STOP_SHARED, anchor: ['min_of'], anchors: [['breaker_lower_edge', 'sweep_extreme']] },
  },
};
const CONCEPT_IDS = Array.from({ length: 20 }, (_, i) => `H${i + 1}`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function checkValue(value, rule, where, e) {
  if (Array.isArray(rule)) {
    if (!rule.some((allowed) => sameJson(allowed, value))) e.push(`${where} must be one of ${rule.map((r) => JSON.stringify(r)).join(' | ')}`);
  } else if (rule === INT) { if (!Number.isInteger(value) || value < 0) e.push(`${where} must be a whole number`); }
  else if (rule === NUM) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) e.push(`${where} must be a finite non-negative number`); }
  else if (rule === BOOL) { if (typeof value !== 'boolean') e.push(`${where} must be true or false`); }
  else if (rule === DATE) { if (!DATE_RE.test(String(value || ''))) e.push(`${where} must be YYYY-MM-DD`); }
  else if (rule && typeof rule === 'object') checkObject(value, rule, where, e);
}
function checkObject(obj, schema, where, e) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { e.push(`${where} must be an object`); return; }
  for (const key of Object.keys(obj)) if (!(key in schema)) e.push(`${where}.${key} is not a known field`);
  for (const [key, rule] of Object.entries(schema)) {
    if (!(key in obj)) { e.push(`${where}.${key} is missing`); continue; }
    checkValue(obj[key], rule, `${where}.${key}`, e);
  }
}

export function validateSpec(spec) {
  const e = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['spec must be an object'];
  if (!SPEC_NAMES.includes(spec.name)) { e.push(`name must be one of ${SPEC_NAMES.join(', ')}`); return e; }
  const schema = { name: [spec.name], concepts: 'concepts', ...SCHEMA_SHARED, ...SCHEMA_BY_NAME[spec.name] };
  for (const key of Object.keys(spec)) if (!(key in schema)) e.push(`${key} is not a known field`);
  for (const [key, rule] of Object.entries(schema)) {
    if (!(key in spec)) { e.push(`${key} is missing`); continue; }
    if (rule === 'concepts') {
      if (!Array.isArray(spec.concepts) || !spec.concepts.length || !spec.concepts.every((c) => CONCEPT_IDS.includes(c))) e.push('concepts must list H1..H20 identifiers');
      continue;
    }
    checkValue(spec[key], rule, key, e);
  }
  if (e.length) return e;
  // Relations the schema cannot say: the window indices, the development window, the whole-cent costs.
  if (spec.sweep.window.firstBarIndex > spec.sweep.window.lastBarIndex) e.push('sweep.window.firstBarIndex must not exceed lastBarIndex');
  if (spec.timeWindow.lastFillBarIndex < spec.timeWindow.lastDecisionBarIndex) e.push('timeWindow.lastFillBarIndex must be at least lastDecisionBarIndex');
  if (spec.sweep.window.lastBarIndex > spec.timeWindow.lastDecisionBarIndex) e.push('sweep.window.lastBarIndex must not exceed timeWindow.lastDecisionBarIndex');
  if (spec.round !== 1) e.push('round must be 1 (round 1 is the only pre-registered round)');
  if (spec.windows.development.start !== WINDOWS.development.start || spec.windows.development.end !== WINDOWS.development.end) e.push(`windows.development must be ${WINDOWS.development.start} to ${WINDOWS.development.end}`);
  if (Math.abs(spec.costs.halfSpread + spec.costs.slippage + spec.costs.commission - spec.costs.perSide) > 1e-9) e.push('costs.perSide must equal halfSpread + slippage + commission');
  if (spec.maxFilledTradesPerSession !== 1) e.push('maxFilledTradesPerSession must be 1 (one filled trade per session, PROTOCOL.md section 5)');
  if (spec.account.maxPlannedRiskFraction > 1) e.push('account.maxPlannedRiskFraction must be a fraction');
  return e;
}

// The shared block of a spec (section 4): the shared top-level fields plus the shared entry and stop fields.
export function sharedBlockOf(spec) {
  const out = {};
  for (const k of SHARED_KEYS) out[k] = spec[k];
  out.entry = Object.fromEntries(SHARED_ENTRY_KEYS.map((k) => [k, spec.entry?.[k]]));
  out.stop = Object.fromEntries(SHARED_STOP_KEYS.map((k) => [k, spec.stop?.[k]]));
  return out;
}
// The round's files must share one block, byte for byte in their canonical JSON.
export function validateRound(specs) {
  if (!specs.length) return ['no spec to compare'];
  const first = JSON.stringify(sharedBlockOf(specs[0]));
  return specs.filter((s) => JSON.stringify(sharedBlockOf(s)) !== first).map((s) => `${s.file || s.name}: its shared block differs from ${specs[0].file || specs[0].name}'s`);
}

export function loadSpec(file, { specDir = SPEC_DIR, pins = SPEC_SHA256 } = {}) {
  const full = path.isAbsolute(file) ? file : path.join(specDir, file);
  const text = fs.readFileSync(full, 'utf8');
  const name = path.basename(full);
  const pin = pins[name];
  const hash = textSha256(text);
  if (pin && hash !== pin) throw new Error(`${name} differs from its pinned SHA-256 (config.js SPEC_SHA256): a frozen spec is never edited in place`);
  const spec = JSON.parse(text);
  const errors = validateSpec(spec);
  if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
  return Object.freeze({ ...spec, file: name, hash });
}

export function listSpecs(dir = SPEC_DIR, { pins = SPEC_SHA256 } = {}) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    try {
      const s = loadSpec(path.join(dir, file), { pins });
      return { file, name: s.name, version: s.version, hash: s.hash, round1: ROUND1_SPECS.includes(file), error: null };
    } catch (err) {
      return { file, name: null, hash: null, round1: ROUND1_SPECS.includes(file), error: err.message };
    }
  });
}

// ---------- the experiment log (PROTOCOL.md section 10, rules 3 and 7) ----------
// Entries are headed "## <number> | <date> | <title>" and run to the next heading; code fences and HTML comments
// are not read. The gate needs one "**Code frozen for round N**" entry naming the current CODE_REVISION, the
// pre-registration commit and "data hash: <64 hex>"; reads the run entries ("**Run** run id: N, spec: <file>,
// spec hash: <64 hex>, window: development|validation, status: done|failed"; an entry whose title mentions
// "run id:" + digits in another form is malformed and closes the gate); and, before any validation, needs exactly
// one "**Validation authorized**" entry (the owner's, quoting their message with ">" lines, naming the current
// CODE_REVISION and the spec file), which the code never writes.
export const visibleText = (text) => String(text).replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const namesRevision = (text, revision = CODE_REVISION) => new RegExp(`(^|[^\\w-])${escapeRe(revision)}(?![\\w-])`).test(text);
export const RUN_ENTRY = /^\*\*Run\*\*\s*run id:\s*(\d+),\s*spec:\s*(\S+?),\s*spec hash:\s*([0-9a-f]{64})(?![0-9a-f]),\s*window:\s*(development|validation),\s*status:\s*(done|failed)\b/i;
const RECORD_FIELDS = /run id:\s*\d/i;
const HEADING = /^## (\d+) \| (\d{4}-\d{2}-\d{2}) \| (.*)$/;

export function parseEntries(text) {
  const lines = visibleText(text).split(/\r?\n/);
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(HEADING);
    if (m) { cur = { number: Number(m[1]), date: m[2], title: m[3].trim(), body: '' }; entries.push(cur); continue; }
    if (cur) cur.body += `${line}\n`;
  }
  return entries;
}

export function logStatus(file = LOG_PATH, { preregCommit = PREREG.commit, revision = CODE_REVISION, round = 1, specFile = null } = {}) {
  if (!fs.existsSync(file)) return { exists: false, frozen: null, frozenProblem: 'strategy/ict-lab/EXPERIMENT-LOG.md does not exist', runs: [], malformed: [], nextNumber: 1, entries: [], validation: { authorized: false, problem: 'the log does not exist', specs: [] } };
  const entries = parseEntries(fs.readFileSync(file, 'utf8'));
  const nextNumber = Math.max(0, ...entries.map((e) => e.number)) + 1;
  const text = (e) => `${e.title}\n${e.body}`;
  const title = frozenTitle(round);
  const frozenEntries = entries.filter((e) => e.title.startsWith(`**${title}**`));
  const hashIn = (t) => { const m = t.match(/data hash:\s*([0-9a-f]{64})(?![0-9a-f])/i); return m ? m[1].toLowerCase() : null; };
  const good = frozenEntries.filter((e) => namesRevision(text(e), revision) && text(e).includes(preregCommit) && hashIn(text(e)));
  let frozen = null, frozenProblem = null;
  if (good.length === 1) frozen = { number: good[0].number, date: good[0].date, codeRevision: revision, dataHash: hashIn(text(good[0])) };
  else if (good.length > 1) frozenProblem = `${good.length} "**${title}**" entries name the current code revision (exactly one is read)`;
  else if (!frozenEntries.length) frozenProblem = `no entry titled "**${title}**"`;
  else if (!frozenEntries.some((e) => namesRevision(text(e), revision))) frozenProblem = `the code-frozen entry does not name the current code revision ${revision} (it was recorded against other code)`;
  else if (!frozenEntries.some((e) => text(e).includes(preregCommit))) frozenProblem = `the code-frozen entry does not name the pre-registration commit ${preregCommit}`;
  else frozenProblem = 'the code-frozen entry does not name a data hash ("data hash: <64 hex>")';
  const runs = [], malformed = [];
  for (const e of entries) {
    const m = e.title.match(RUN_ENTRY);
    if (m) runs.push({ number: e.number, runId: Number(m[1]), spec: m[2], specHash: m[3].toLowerCase(), window: m[4].toLowerCase(), status: m[5].toLowerCase() });
    else if (/^\*\*Run\b/i.test(e.title) || RECORD_FIELDS.test(e.title)) malformed.push({ number: e.number, title: e.title.slice(0, 80) });
  }
  // The owner's validation row: exactly one, naming the current code revision, quoting the owner (a "> " line)
  // and naming at least one spec file; `specs` lists the files it names.
  const vEntries = entries.filter((e) => e.title.startsWith(`**${VALIDATION_TITLE}**`));
  let validation;
  if (!vEntries.length) validation = { authorized: false, problem: `no entry titled "**${VALIDATION_TITLE}**" (the owner's separate message, which only the owner writes)`, specs: [] };
  else if (vEntries.length > 1) validation = { authorized: false, problem: `${vEntries.length} "**${VALIDATION_TITLE}**" entries (exactly one is read)`, specs: [] };
  else {
    const v = vEntries[0], t = text(v);
    const specs = ROUND1_SPECS.filter((f) => t.includes(f));
    const quoted = /^\s*>\s*\S/m.test(v.body);
    if (!namesRevision(t, revision)) validation = { authorized: false, problem: `the validation row does not name the current code revision ${revision}`, specs };
    else if (!quoted) validation = { authorized: false, problem: 'the validation row does not quote the owner\'s message ("> ..." lines)', specs };
    else if (!specs.length) validation = { authorized: false, problem: 'the validation row names no spec file', specs };
    else validation = { authorized: true, problem: null, specs, number: v.number, date: v.date };
  }
  if (specFile && validation.authorized && !validation.specs.includes(path.basename(specFile))) validation = { ...validation, authorized: false, problem: `the validation row does not name ${path.basename(specFile)} (it names ${validation.specs.join(', ')})` };
  return { exists: true, frozen, frozenProblem, runs, malformed, nextNumber, validation, entries: entries.map((e) => ({ number: e.number, date: e.date, title: e.title })) };
}
