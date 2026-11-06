// event-swing configuration: paths, the pre-registration pins, the code revision, the window bound, the pinned
// registrants, the matrix and classifier loaders and the experiment-log reader (strategy/event-swing/CAMPAIGN-1.md).
// Simulation only: nothing here reads market data, holdings or cash, and nothing places or prepares an order.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../strategy/config.js';

export { canonicalJson };
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ES_DIR = path.join(ROOT, 'strategy', 'event-swing');
export const REPORT_DIR = path.join(ES_DIR, 'reports');
export const LOG_PATH = path.join(ES_DIR, 'EXPERIMENT-LOG.md');
export const CAMPAIGN_PATH = path.join(ES_DIR, 'CAMPAIGN-1.md');
export const CLASSIFIER_PATH = path.join(ES_DIR, 'classifier-v1.json');
export const MATRIX_PATH = path.join(ES_DIR, 'matrix-v1.json');
export const DB_NAME = 'event-swing.sqlite';

// Stored with every campaign and run. Bump it with any change that can alter results (events.js, engine.js,
// metrics.js, placebo.js, data.js, the classifier code or the SEC parsers).
// es-code-2026-11-06-1: the build of the owner's order of 2026-11-06 (EXPERIMENT-LOG.md entry 1).
export const CODE_REVISION = 'es-code-2026-11-06-1';
export const ENGINE_VERSION = 'es-engine-1';

// The window (CAMPAIGN-1.md section 2; DATA-INVENTORY.md section 1). MAX_DATE is a hard bound: no bar, filing or
// document dated after it is requested, stored or read; 2022-01-03 onward belongs to other programmes' closed windows.
export const WINDOW = Object.freeze({ from: '2016-01-04', to: '2021-12-31', eventsFrom: '2015-01-01' });
export const MAX_DATE = '2021-12-31';
export const CLOSED_FROM = '2022-01-03';
export const assertInWindow = (date, what = 'date') => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) throw new Error(`event-swing: ${what} must be a date (got ${date})`);
  if (date.slice(0, 10) > MAX_DATE) throw new Error(`event-swing: ${what} ${date.slice(0, 10)} is after the bound ${MAX_DATE}; dates from ${CLOSED_FROM} are closed`);
  return date;
};

// The pre-registration commit and the LF-text SHA-256 of the three pinned files it holds.
export const PREREG = Object.freeze({
  commit: '3a0589f1101650746a9163347c4faf84e32eb409',
  committedAt: '2026-11-06T11:56:45-06:00',
  sha256: Object.freeze({
    'CAMPAIGN-1.md': 'a47bcaf82c8e320ebf444c23ba5327df4bc2672142b1d423262d679180cc94a5',
    'classifier-v1.json': '485f9dd13ab83d4c6cd3c62fa4bbf0fe76257f1750c10b4cfbe80ba4bffe66c2',
    'matrix-v1.json': 'b35a0c0005ce6d55a4c4b2705ff943eeb3011fb951064924b65d80f958f07720',
  }),
});

// The registrant of each basket stock (DATA-INVENTORY.md section 3). A predecessor is never used. `name` must match
// the company name EDGAR returns for the CIK before anything is stored.
export const REGISTRANTS = Object.freeze({
  MU: { cik: 723125, name: /micron technology/i },
  AMZN: { cik: 1018724, name: /amazon/i },
  META: { cik: 1326801, name: /meta platforms|facebook/i },
  TSLA: { cik: 1318605, name: /tesla/i },
  VST: { cik: 1692819, name: /vistra/i },
  GOOG: { cik: 1652044, name: /alphabet/i },
  INTC: { cik: 50863, name: /intel corp/i },
  CSCO: { cik: 858877, name: /cisco systems/i },
  PYPL: { cik: 1633917, name: /paypal holdings/i },
  SNAP: { cik: 1564408, name: /snap inc/i },
});
export const BASKET = Object.freeze(Object.keys(REGISTRANTS));

// SEC EDGAR access (DATA-INVENTORY.md section 3): one host, no redirects, a declared client with the owner's contact
// address from .env (SEC_CONTACT_EMAIL; never printed), at most 4 requests per second (SEC allows 10).
export const SEC_ORIGIN = 'https://www.sec.gov';
export const SEC_MIN_INTERVAL_MS = 250;
export const SEC_DATEB = MAX_DATE.replace(/-/g, '');

export const textSha256 = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
export const fileSha256 = (file) => textSha256(fs.readFileSync(file, 'utf8'));
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- the pinned files ----------
const PIN_PATHS = { 'CAMPAIGN-1.md': CAMPAIGN_PATH, 'classifier-v1.json': CLASSIFIER_PATH, 'matrix-v1.json': MATRIX_PATH };
export function pinStatus({ root = ROOT } = {}) {
  const files = Object.entries(PREREG.sha256).map(([name, want]) => {
    const file = root === ROOT ? PIN_PATHS[name] : path.join(root, 'strategy', 'event-swing', name);
    if (!fs.existsSync(file)) return { name, ok: false, want, got: null, problem: 'missing' };
    const got = fileSha256(file);
    return { name, ok: got === want, want, got, problem: got === want ? null : 'differs from the pinned SHA-256' };
  });
  return { ok: files.every((f) => f.ok), files };
}

export function loadClassifier(file = CLASSIFIER_PATH) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['exhibitTypes', 'lineBreakTags', 'removeBlocks', 'excludedPhrases', 'guidanceNouns', 'raiseWords', 'lowerWords', 'reaffirmWords']) {
    if (!Array.isArray(c[k]) || !c[k].length) throw new Error(`classifier: ${k} must be a non-empty list`);
  }
  return c;
}

const DESCRIPTIVE = ['label', 'notes', 'hypothesis'];
// A configuration as the engine sees it: the matrix's shared block merged under the configuration's own fields.
export function configHash(cfg) {
  const o = { ...cfg };
  for (const k of DESCRIPTIVE) delete o[k];
  return sha256(canonicalJson(o));
}
export function loadMatrix(file = MATRIX_PATH) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = validateMatrix(m);
  if (problems.length) throw new Error(`matrix: ${problems.join('; ')}`);
  return m;
}
export function validateMatrix(m) {
  const e = [];
  if (!m || typeof m !== 'object') return ['the matrix must be an object'];
  if (!Array.isArray(m.configurations) || !m.configurations.length) e.push('configurations must be a non-empty list');
  const ids = (m.configurations || []).map((c) => c.id);
  if (new Set(ids).size !== ids.length) e.push('configuration ids must be unique');
  if (ids.length > (m.budget?.maxConfigurations ?? 24)) e.push(`at most ${m.budget?.maxConfigurations ?? 24} configurations`);
  for (const c of m.configurations || []) {
    if (!['A', 'B', 'C', 'D'].includes(c.family)) e.push(`${c.id}: family must be A, B, C or D`);
    if (!['sleeves', 'signal'].includes(c.kind)) e.push(`${c.id}: kind must be sleeves or signal`);
    if ((c.family === 'A') !== (c.kind === 'sleeves')) e.push(`${c.id}: family A and only family A uses sleeves`);
  }
  for (const id of m.holmFamily || []) if (!ids.includes(id)) e.push(`holmFamily names ${id}, which is not a configuration`);
  for (const [id, cmp] of Object.entries(m.comparators || {})) {
    if (!ids.includes(id)) e.push(`comparators names ${id}`);
    for (const r of [cmp.baseline, cmp.control]) if (r != null && !ids.includes(r)) e.push(`${id}'s comparator ${r} is not a configuration`);
  }
  const w = m.shared?.window || {};
  if (w.from !== WINDOW.from || w.to !== WINDOW.to || w.eventsFrom !== WINDOW.eventsFrom) e.push(`shared.window must be ${WINDOW.from} to ${WINDOW.to} with events from ${WINDOW.eventsFrom}`);
  return e;
}
export function configFor(matrix, id) {
  const c = matrix.configurations.find((x) => x.id === id);
  if (!c) throw new Error(`no configuration ${id} in the matrix`);
  return Object.freeze({ ...JSON.parse(JSON.stringify(matrix.shared)), ...JSON.parse(JSON.stringify(c)) });
}

// ---------- git ----------
export function git(args, { root = ROOT } = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function headCommit({ root = ROOT } = {}) { try { return git(['rev-parse', 'HEAD'], { root }); } catch { return null; } }
export function isAncestor(commit, { root = ROOT } = {}) {
  try { execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; }
}
export function committedSha(commit, relPath, { root = ROOT } = {}) {
  // The blob exactly as committed (no trimming: the trailing newline is part of the pinned text).
  try { return textSha256(execFileSync('git', ['show', `${commit}:${relPath}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); } catch { return null; }
}
// Paths whose uncommitted changes close the gate (the log and reports are records and excluded).
export const COMMITTED_PATHS = ['server/eventswing', 'scripts/eventswing.mjs', 'strategy/event-swing/CAMPAIGN-1.md', 'strategy/event-swing/classifier-v1.json', 'strategy/event-swing/matrix-v1.json'];
export function uncommitted({ root = ROOT, paths = COMMITTED_PATHS } = {}) {
  try {
    const out = git(['status', '--porcelain', '--', ...paths], { root });
    return out ? out.split('\n').filter(Boolean) : [];
  } catch (e) { return [`git status failed: ${e.message}`]; }
}

// ---------- the experiment log (read outside code fences and HTML comments) ----------
export function readableLog(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '');
}
const ENTRY = /^## (\d+) \| (\d{4}-\d{2}-\d{2}) \| (.*)$/;
export function logEntries(text) {
  const lines = readableLog(text).split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(ENTRY);
    if (m) { cur = { number: Number(m[1]), date: m[2], title: m[3], body: '' }; out.push(cur); continue; }
    if (cur) cur.body += `${line}\n`;
  }
  return out;
}
// The row format of the log's preamble, with the sensitivity after it: `**Run** run id: N, config: B1, config hash:
// <64 hex>, status: done; variant: base|double_costs|delayed`.
const RUN_ROW = /\*\*Run\*\* run id: (\d+), config: ([A-Z0-9]+), config hash: ([0-9a-f]{64}), status: (done|failed); variant: (base|double_costs|delayed)/g;
export function logStatus(text) {
  const entries = logEntries(text);
  const numbers = entries.map((e) => e.number);
  const ordered = numbers.every((n, i) => n === i + 1);
  const inventory = entries.filter((e) => /\*\*Event inventory\*\*/.test(e.title));
  const frozen = entries.filter((e) => /\*\*Code frozen for campaign 1\*\*/.test(e.title)).map((e) => {
    const all = `${e.title}\n${e.body}`;
    return { number: e.number, codeRevision: all.match(/code revision:?\s*`?(es-code-[0-9-]+)`?/i)?.[1] ?? null, commit: all.match(/pre-registration commit:?\s*`?([0-9a-f]{40})`?/i)?.[1] ?? null, manifest: all.match(/manifest hash:?\s*`?([0-9a-f]{64})`?/i)?.[1] ?? null };
  });
  const runs = [];
  for (const e of entries) for (const m of `${e.title}\n${e.body}`.matchAll(RUN_ROW)) runs.push({ runId: Number(m[1]), config: m[2], configHash: m[3], status: m[4], variant: m[5], entry: e.number });
  return { entries: entries.length, nextNumber: (numbers.length ? Math.max(...numbers) : 0) + 1, ordered, inventory: inventory.map((e) => e.number), frozen, runs };
}
export function readLog(file = LOG_PATH) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }
// Appends one entry (records only: the inventory, the code-frozen row and run rows; never an authorization).
export function appendLogEntry({ title, body, date, file = LOG_PATH }) {
  const st = logStatus(readLog(file));
  if (!st.ordered) throw new Error('the experiment log\'s entries are not numbered 1, 2, 3, ...; nothing appended');
  const text = `\n## ${st.nextNumber} | ${date} | ${title}\n\n${String(body).trim()}\n`;
  fs.appendFileSync(file, text, 'utf8');
  return { number: st.nextNumber, text };
}

export class EsError extends Error { constructor(status, message) { super(message); this.status = status; } }
