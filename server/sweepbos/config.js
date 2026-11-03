// sweep-bos configuration: paths, pins, the code revision, the windows and the download bound, the variant
// loader and the experiment-log reader (strategy/sweep-bos/PLAN.md, PRE-REGISTRATION.md). Simulation only: nothing
// here reads market data, holdings or cash, and nothing places or prepares an order.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SB_DIR = path.join(ROOT, 'strategy', 'sweep-bos');
export const VARIANT_DIR = path.join(SB_DIR, 'variants');
export const REPORT_DIR = path.join(SB_DIR, 'reports');
export const PLAN_PATH = path.join(SB_DIR, 'PLAN.md');
export const PREREG_PATH = path.join(SB_DIR, 'PRE-REGISTRATION.md');
export const LOG_PATH = path.join(SB_DIR, 'EXPERIMENT-LOG.md');
export const DB_NAME = 'sweep-bos-sim.sqlite';

// Stored with every data version and run. Bump it with any change that can alter results (rules.js, engine.js,
// metrics.js, data.js's session filter, or the Alpaca client's intradayBars).
// sb-code-2026-11-03-1: the build (Parts B and C of EXPERIMENT-LOG.md entry 1); round 1 ran on it.
// sb-code-2026-11-03-2: the round-2 switches (PRE-REGISTRATION-2.md; EXPERIMENT-LOG.md entries 17-19): the
// cutoff index, the cross-session structure series and the no-invalidation setting, read from the variant with
// round-1 behaviour as the default (tests/sweepbos-round2.test.js holds the round-1 behaviour snapshot).
export const CODE_REVISION = 'sb-code-2026-11-03-2';
export const ENGINE_VERSION = 'sb-engine-1';

export const INSTRUMENTS = Object.freeze(['QQQ', 'SPY']);
export const STAND_IN_FOR = Object.freeze({ QQQ: 'NQ', SPY: 'ES' });

// The owner's windows (PRE-REGISTRATION.md 1.5). MAX_BAR_DATE is the download and storage bound of this task:
// no bar after it is requested, stored or read (Part F changes it with the owner's separate message, as a new
// code revision and a new data version). The Strategy Lab holdout is never read or downloaded.
export const WINDOWS = Object.freeze({
  warmupFrom: '2018-06-01',
  development: Object.freeze({ start: '2019-01-02', end: '2022-12-30' }),
  evaluation: Object.freeze({ start: '2023-01-03', end: '2024-12-31' }),
  holdout: Object.freeze({ start: '2025-01-01', end: '2026-06-30' }),
});
export const MAX_BAR_DATE = '2022-12-30';

// The pre-registration commit (Part A) and the LF-text SHA-256 of the two documents it holds. The run gate checks
// the files against these pins, that the commit exists and is an ancestor of HEAD, and that the committed
// PRE-REGISTRATION.md has this hash.
export const PREREG = Object.freeze({
  commit: '839ac73f550bb17109b9776a0fa5d22749c835fc',
  committedAt: '2026-11-03T11:21:22-06:00',
  sha256: Object.freeze({
    'PRE-REGISTRATION.md': 'c67964aa9cea6136480b08f5ea2c2c37376b5f9daae5f1841d884192d9619f6f',
    'PLAN.md': 'edf64f3663f3bde2a7f9975358ab2b226f7da29bd75937e8a584e81463d716fd',
  }),
});

// Round 1: exactly these eight (PRE-REGISTRATION.md section 4), pinned by the LF-text SHA-256 recorded in
// EXPERIMENT-LOG.md entry 2. A pinned file that differs is refused; a file not listed cannot run in round 1.
export const ROUND1_VARIANTS = Object.freeze([
  'sb-ob-a-bias-0.1.0.json', 'sb-ob-a-nobias-0.1.0.json', 'sb-ob-b-bias-0.1.0.json', 'sb-ob-b-nobias-0.1.0.json',
  'sb-fvg-a-bias-0.1.0.json', 'sb-fvg-a-nobias-0.1.0.json', 'sb-fvg-b-bias-0.1.0.json', 'sb-fvg-b-nobias-0.1.0.json',
]);
// Round 2 (PRE-REGISTRATION-2.md; EXPERIMENT-LOG.md entry 18): four files, each one change from
// sb-ob-a-nobias-0.1.0.json (R2-1 the 10:55 cutoff, R2-2 structure across the session boundary, R2-3 no
// invalidation, R2-4 the three together), pinned before any run; they run in round 2 only.
export const ROUND2_VARIANTS = Object.freeze(['sb-ob-a-nobias-cutoff1055-0.2.0.json', 'sb-ob-a-nobias-xsession-0.2.0.json', 'sb-ob-a-nobias-noinval-0.2.0.json', 'sb-ob-a-nobias-combined-0.2.0.json']);
export const ROUNDS = Object.freeze({ 1: ROUND1_VARIANTS, 2: ROUND2_VARIANTS });
export const roundVariants = (round) => ROUNDS[round] || Object.freeze([]);
export const frozenTitle = (round) => `Code frozen for round ${round}`;
export const VARIANT_SHA256 = Object.freeze({
  'sb-ob-a-nobias-cutoff1055-0.2.0.json': 'f316b42e288a7a2667e9b8104b73596023e1df7e13abd51a72c5f4948d478ecb',
  'sb-ob-a-nobias-xsession-0.2.0.json': 'dfde939464e3d3d6d7aadbb717c73f057747bc5e1a4dfedc032426c4fbccddb7',
  'sb-ob-a-nobias-noinval-0.2.0.json': '613d4940e6bca78977b753a861285b1d67ebfa29413d7b991ac1902cf4e71e02',
  'sb-ob-a-nobias-combined-0.2.0.json': '617900de2ca9883a1a1e8ff3da3a54c1337bf54c121f8fa2d9a2f6d29cff63cb',
  'sb-fvg-a-bias-0.1.0.json': '78b482368965f6d971b173ff858dbcc4008c41412e0a00f0e2bb48084fab3c38',
  'sb-fvg-a-nobias-0.1.0.json': '507f2216f16291f53a6a290a7ddbaeaf42ab9a364cefed2fc55253e2d38489c6',
  'sb-fvg-b-bias-0.1.0.json': 'a985e68add153ce552c823e279666710746d55d0ea737eea18b279b48cbf0be8',
  'sb-fvg-b-nobias-0.1.0.json': '0e6bdf78f06bc9d43b8dc3804dfaa86e7e05358559c08af13ed80e7ae751d348',
  'sb-ob-a-bias-0.1.0.json': 'f7dc2c1509782cef7c9e44681492c53b0f91360062f8d441ab1c2d9c29e0ecc9',
  'sb-ob-a-nobias-0.1.0.json': '07506b25061c3ed0e71d9f6924aa34283ed72994f15d06507fd771cb2aef9a1f',
  'sb-ob-b-bias-0.1.0.json': '9b58dd6d849d0ae7bf40b20363b5974e664532034007777b60950f780b71ba8a',
  'sb-ob-b-nobias-0.1.0.json': '6e2a7ee9e803a84b4126fa1a22edc2e26badc9eff79633bd8bfb6420e5707269',
});

export const textSha256 = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
export const fileSha256 = (file) => textSha256(fs.readFileSync(file, 'utf8'));

// The pre-registration commit must exist in this repository, be an ancestor of HEAD, and hold
// strategy/sweep-bos/PRE-REGISTRATION.md with the pinned SHA-256 (git stores LF text; the working copy may be
// CRLF). Used by the download script and the run gate, so the rules provably came before the data and the runs.
export function preregCommitStatus({ root = ROOT, prereg = PREREG, git = null } = {}) {
  const run = git || ((args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  try { run(['cat-file', '-e', `${prereg.commit}^{commit}`]); } catch { return { ok: false, detail: `commit ${prereg.commit} is not in this repository` }; }
  try { run(['merge-base', '--is-ancestor', prereg.commit, 'HEAD']); } catch { return { ok: false, detail: `commit ${prereg.commit} is not an ancestor of HEAD` }; }
  let committed;
  try { committed = run(['show', `${prereg.commit}:strategy/sweep-bos/PRE-REGISTRATION.md`]); } catch { return { ok: false, detail: `commit ${prereg.commit} does not hold strategy/sweep-bos/PRE-REGISTRATION.md` }; }
  const want = prereg.sha256['PRE-REGISTRATION.md'];
  if (textSha256(committed) !== want && textSha256(`${committed}\n`) !== want) return { ok: false, detail: 'the committed PRE-REGISTRATION.md does not have the pinned SHA-256' };
  let when = null;
  try { when = run(['log', '-1', '--format=%cI', prereg.commit]); } catch { /* reported without a time */ }
  return { ok: true, detail: `commit ${prereg.commit.slice(0, 12)}${when ? ` (${when})` : ''} is an ancestor of HEAD and holds the pinned PRE-REGISTRATION.md`, committedAt: when };
}

// The sweep-bos files that decide results must have no uncommitted change when a run starts (the run records
// HEAD); `git status --porcelain` on those paths must be empty.
export const COMMITTED_PATHS = Object.freeze(['server/sweepbos', 'scripts/sweepbos-run.mjs', 'server/hxr/source.js', 'strategy/sweep-bos/variants']);
export function uncommittedChanges({ root = ROOT, git = null } = {}) {
  const run = git || ((args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  const out = run(['status', '--porcelain', '--', ...COMMITTED_PATHS]);
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}
export function headCommit({ root = ROOT, git = null } = {}) {
  const run = git || ((args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  try { return run(['rev-parse', 'HEAD']); } catch { return null; }
}

// The sweep-bos code that decides results, hashed together (LF text) and stored with every run.
export const SOURCE_FILES = Object.freeze(['server/sweepbos/config.js', 'server/sweepbos/data.js', 'server/sweepbos/engine.js', 'server/sweepbos/metrics.js', 'server/sweepbos/rules.js', 'server/sweepbos/service.js', 'server/sweepbos/store.js', 'server/hxr/source.js', 'scripts/sweepbos-run.mjs']);
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

const ZONES = ['order_block', 'fair_value_gap'], STOPS = ['A_sweep_buffer', 'B_second_swing'], BIASES = ['on', 'off'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Every runnable variant declares the whole rule sheet with the single value the engine implements, so a file
// that silently changes a shared rule cannot run.
export function validateVariant(c) {
  const e = [];
  if (!c || typeof c !== 'object') return ['variant must be an object'];
  const eq = (v, want, name) => { if (v !== want) e.push(`${name} must be ${JSON.stringify(want)}`); };
  if (c.strategy !== 'sweep-bos') e.push('strategy must be "sweep-bos"');
  if (typeof c.name !== 'string' || !/^sb-[a-z0-9-]+$/.test(c.name)) e.push('name must be sb-...');
  if (typeof c.version !== 'string' || !c.version) e.push('version is required');
  if (!Number.isInteger(c.round) || c.round < 1) e.push('round must be a whole number from 1');
  if (!ZONES.includes(c.zone)) e.push(`zone must be ${ZONES.join(' or ')}`);
  if (!STOPS.includes(c.stop)) e.push(`stop must be ${STOPS.join(' or ')}`);
  if (!BIASES.includes(c.bias)) e.push('bias must be "on" or "off"');
  if (!Array.isArray(c.instruments) || c.instruments.join(',') !== INSTRUMENTS.join(',')) e.push('instruments must be ["QQQ", "SPY"]');
  const s = c.session || {};
  eq(s.timezone, 'America/New_York', 'session.timezone'); eq(s.calendar, 'NYSE', 'session.calendar'); eq(s.barMinutes, 5, 'session.barMinutes'); eq(s.extendedHours, false, 'session.extendedHours');
  eq(c.sweepWindow?.firstBarIndex, 0, 'sweepWindow.firstBarIndex'); eq(c.sweepWindow?.lastBarIndex, 5, 'sweepWindow.lastBarIndex');
  // The round-2 switches (PRE-REGISTRATION-2.md): a round-1 file keeps the round-1 values; a round-2 file is one
  // of the declared changes from sb-ob-a-nobias-0.1.0.json and says so.
  const r2 = c.round === 2;
  const lastFill = c.entryCutoff?.lastFillBarIndex;
  if (![11, 17].includes(lastFill)) e.push('entryCutoff.lastFillBarIndex must be 11 (round 1) or 17 (round 2, R2-1)');
  if (!r2 && lastFill !== 11) e.push('a round-1 variant keeps entryCutoff.lastFillBarIndex 11');
  if (c.bos?.lastBarIndex !== undefined && c.bos.lastBarIndex !== lastFill) e.push('bos.lastBarIndex must equal entryCutoff.lastFillBarIndex');
  eq(c.swing?.fractalBars, 3, 'swing.fractalBars'); eq(c.swing?.confirmAfterLaterBars, 3, 'swing.confirmAfterLaterBars');
  const scope = c.swing?.scope;
  if (!['session_local', 'cross_session'].includes(scope)) e.push('swing.scope must be "session_local" or "cross_session" (round 2, R2-2)');
  if (!r2 && scope !== 'session_local') e.push('a round-1 variant keeps swing.scope "session_local"');
  if (scope === 'cross_session' && c.swing?.previousSessionBars !== 12) e.push('swing.previousSessionBars must be 12 with cross_session');
  if (scope === 'cross_session' && c.zones?.orderBlockSearch !== 'cross_session') e.push('zones.orderBlockSearch must be "cross_session" with swing.scope cross_session');
  if (scope !== 'cross_session' && c.zones?.orderBlockSearch !== undefined) e.push('zones.orderBlockSearch is declared only with swing.scope cross_session');
  const inval = c.sweep?.invalidation;
  if (inval !== undefined && !['close_beyond_level', 'none'].includes(inval)) e.push('sweep.invalidation must be "close_beyond_level" or "none" (round 2, R2-3)');
  if (!r2 && inval === 'none') e.push('a round-1 variant keeps the invalidation rule');
  if (r2) {
    if (c.basedOn?.file !== 'sb-ob-a-nobias-0.1.0.json' || c.basedOn?.sha256 !== VARIANT_SHA256['sb-ob-a-nobias-0.1.0.json']) e.push('a round-2 variant must declare basedOn sb-ob-a-nobias-0.1.0.json with its pinned SHA-256');
    if (c.zone !== 'order_block' || c.stop !== 'A_sweep_buffer' || c.bias !== 'off') e.push('a round-2 variant keeps zone order_block, stop A and bias off');
    if (c.version !== '0.2.0') e.push('a round-2 variant is version 0.2.0');
    if (lastFill === 11 && scope === 'session_local' && inval !== 'none') e.push('a round-2 variant must change at least one of the three switches');
  }
  eq(c.dailyBias?.fractalBars, 3, 'dailyBias.fractalBars'); eq(c.dailyBias?.confirmAfterLaterBars, 3, 'dailyBias.confirmAfterLaterBars');
  eq(c.level, 'prior_session_daily_high_low', 'level');
  eq(c.bos?.rule, 'first_close_beyond_most_recent_swing_confirmed_before_that_close', 'bos.rule');
  eq(c.zones?.entryAt, 'near_edge', 'zones.entryAt'); eq(c.zones?.requireEntryInsideBosClose, true, 'zones.requireEntryInsideBosClose'); eq(c.zones?.equilibrium, false, 'zones.equilibrium');
  eq(c.stopA?.bufferMultiple, 1, 'stopA.bufferMultiple'); eq(c.stopA?.bufferSessions, 20, 'stopA.bufferSessions'); eq(c.stopA?.roundBufferToCent, true, 'stopA.roundBufferToCent');
  eq(c.stopB?.beyondBy, 0.01, 'stopB.beyondBy');
  eq(c.target?.level, 'opposite_prior_session_extreme', 'target.level'); eq(c.target?.minRewardToRisk, 1, 'target.minRewardToRisk');
  eq(c.fills?.sameBar, 'stop_first', 'fills.sameBar'); eq(c.fills?.fillBar, 'stop_checked_target_not', 'fills.fillBar');
  eq(c.timeStop, 'open_of_last_session_bar', 'timeStop');
  eq(c.oneTradePerSessionPerInstrument, true, 'oneTradePerSessionPerInstrument'); eq(c.oneSetupPerSession, true, 'oneSetupPerSession');
  eq(c.reentryAfterExit, false, 'reentryAfterExit'); eq(c.partials, false, 'partials'); eq(c.breakEven, false, 'breakEven');
  const k = c.costs || {};
  eq(k.halfSpread, 0.01, 'costs.halfSpread'); eq(k.slippage, 0.01, 'costs.slippage'); eq(k.commission, 0, 'costs.commission'); eq(k.perSide, 0.02, 'costs.perSide'); eq(k.sensitivityMultiple, 2, 'costs.sensitivityMultiple');
  const a = c.account || {};
  eq(a.startingCash, 15000, 'account.startingCash'); eq(a.wholeShares, true, 'account.wholeShares'); eq(a.leverage, false, 'account.leverage'); eq(a.informationOnly, true, 'account.informationOnly');
  const w = c.windows || {};
  eq(w.warmupFrom, WINDOWS.warmupFrom, 'windows.warmupFrom');
  eq(w.development?.start, WINDOWS.development.start, 'windows.development.start'); eq(w.development?.end, WINDOWS.development.end, 'windows.development.end');
  eq(w.evaluation?.start, WINDOWS.evaluation.start, 'windows.evaluation.start'); eq(w.evaluation?.end, WINDOWS.evaluation.end, 'windows.evaluation.end');
  for (const d of [w.warmupFrom, w.development?.start, w.development?.end]) if (!DATE.test(d || '')) e.push('windows dates must be YYYY-MM-DD');
  return e;
}

export function loadVariant(file) {
  const full = path.isAbsolute(file) ? file : path.join(VARIANT_DIR, file);
  const text = fs.readFileSync(full, 'utf8');
  const name = path.basename(full);
  const pin = VARIANT_SHA256[name];
  const hash = textSha256(text);
  if (pin && hash !== pin) throw new Error(`${name} differs from its pinned SHA-256 (config.js VARIANT_SHA256): a frozen variant is never edited in place`);
  const cfg = JSON.parse(text);
  const errors = validateVariant(cfg);
  if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
  return Object.freeze({ ...cfg, file: name, hash });
}

export function listVariants(dir = VARIANT_DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    try {
      const c = loadVariant(path.join(dir, file));
      return { file, name: c.name, version: c.version, zone: c.zone, stop: c.stop, bias: c.bias, hash: c.hash, round1: ROUND1_VARIANTS.includes(file), error: null };
    } catch (err) {
      return { file, name: null, hash: null, round1: ROUND1_VARIANTS.includes(file), error: err.message };
    }
  });
}

// ---------- the experiment log ----------
// Entries are headed "## <number> | <date> | <title>" and run to the next heading; code fences and HTML comments
// are not read. The gate needs one "**Code frozen for round 1**" entry naming the current CODE_REVISION, the
// pre-registration commit and a 64-hex data hash, and reads the run entries ("**Run** run id: N, variant: <file>,
// variant hash: <64 hex>, status: done|failed"). An entry whose title mentions a run with "run id:" + digits
// but does not have that form is malformed, and the gate refuses while one exists (fail closed).
export const visibleText = (text) => String(text).replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const namesRevision = (text, revision = CODE_REVISION) => new RegExp(`(^|[^\\w-])${escapeRe(revision)}(?![\\w-])`).test(text);
export const FROZEN_TITLE = 'Code frozen for round 1';
export const RUN_ENTRY = /^\*\*Run\*\*\s*run id:\s*(\d+),\s*variant:\s*(\S+?),\s*variant hash:\s*([0-9a-f]{64})(?![0-9a-f]),\s*status:\s*(done|failed)\b/i;
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

export function logStatus(file = LOG_PATH, { preregCommit = PREREG.commit, revision = CODE_REVISION, round = 1 } = {}) {
  if (!fs.existsSync(file)) return { exists: false, frozen: null, frozenProblem: 'strategy/sweep-bos/EXPERIMENT-LOG.md does not exist', runs: [], malformed: [], nextNumber: 1, entries: [] };
  const entries = parseEntries(fs.readFileSync(file, 'utf8'));
  const nextNumber = Math.max(0, ...entries.map((e) => e.number)) + 1;
  // The code-frozen entry is per round: round 2 needs its own, naming the code revision that runs it.
  const FROZEN_TITLE = frozenTitle(round);
  const frozenEntries = entries.filter((e) => e.title.startsWith(`**${FROZEN_TITLE}**`));
  const text = (e) => `${e.title}\n${e.body}`;
  const hashIn = (t) => { const m = t.match(/data hash:\s*([0-9a-f]{64})(?![0-9a-f])/i); return m ? m[1].toLowerCase() : null; };
  const good = frozenEntries.filter((e) => namesRevision(text(e), revision) && text(e).includes(preregCommit) && hashIn(text(e)));
  let frozen = null, frozenProblem = null;
  if (good.length === 1) frozen = { number: good[0].number, date: good[0].date, codeRevision: revision, dataHash: hashIn(text(good[0])) };
  else if (good.length > 1) frozenProblem = `${good.length} "**${FROZEN_TITLE}**" entries name the current code revision (exactly one is read)`;
  else if (!frozenEntries.length) frozenProblem = `no entry titled "**${FROZEN_TITLE}**"`;
  else if (!frozenEntries.some((e) => namesRevision(text(e), revision))) frozenProblem = `the code-frozen entry does not name the current code revision ${revision} (it was recorded against other code)`;
  else if (!frozenEntries.some((e) => text(e).includes(preregCommit))) frozenProblem = `the code-frozen entry does not name the pre-registration commit ${preregCommit}`;
  else frozenProblem = 'the code-frozen entry does not name a data hash ("data hash: <64 hex>")';
  const runs = [], malformed = [];
  for (const e of entries) {
    const m = e.title.match(RUN_ENTRY);
    if (m) runs.push({ number: e.number, runId: Number(m[1]), variant: m[2], variantHash: m[3].toLowerCase(), status: m[4].toLowerCase() });
    else if (/^\*\*Run\b/i.test(e.title) || RECORD_FIELDS.test(e.title)) malformed.push({ number: e.number, title: e.title.slice(0, 80) });
  }
  return { exists: true, frozen, frozenProblem, runs, malformed, nextNumber, entries: entries.map((e) => ({ number: e.number, date: e.date, title: e.title })) };
}
