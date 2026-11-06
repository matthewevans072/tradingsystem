// news-replay configuration: paths, the date bounds, the code revision, the basket, the pins (set at the campaign
// commit) and the experiment-log reader (strategy/news-replay/CAMPAIGN-1.md). Simulation only: nothing here reads
// holdings or cash, and nothing places or prepares an order.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../strategy/config.js';

export { canonicalJson };
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NR_DIR = path.join(ROOT, 'strategy', 'news-replay');
export const LOG_PATH = path.join(NR_DIR, 'EXPERIMENT-LOG.md');
export const CAMPAIGN_PATH = path.join(NR_DIR, 'CAMPAIGN-1.md');
export const MATRIX_PATH = path.join(NR_DIR, 'matrix-v1.json');
export const WORDS_PATH = path.join(NR_DIR, 'headline-words-v1.json');
export const AI_PROMPT_PATH = path.join(NR_DIR, 'ai-planner-v1.json');
export const REPORT_DIR = path.join(NR_DIR, 'reports');
export const DB_NAME = 'news-replay.sqlite';

// Bump with any change that can alter results (loader, planners, profile, simulator, metrics, placebo).
// nr-code-2026-11-06-1: the build of the owner's work order of 2026-11-06 (EXPERIMENT-LOG.md entry 1).
export const CODE_REVISION = 'nr-code-2026-11-06-1';
export const ENGINE_VERSION = 'nr-engine-1';

// The bounds (the order's section 3). MAX_DATE is enforced at download, insert (CHECK constraints) and every load;
// nothing after it is requested, stored or read. DATA_FROM gives a month of history before the replay.
export const REPLAY = Object.freeze({ from: '2020-01-02', to: '2021-12-31' });
export const DATA_FROM = '2019-12-02';
export const MAX_DATE = '2021-12-31';
export const CLOSED_WINDOWS = Object.freeze([
  { name: 'range-trend evaluation and HXR validation', from: '2022-01-03', to: '2023-12-29' },
  { name: 'HXR final period and range-trend reserve (partly exposed by prospective journal 1\'s warm-up)', from: '2024-01-02', to: '2026-10-21' },
  { name: 'Strategy Lab MU holdout', from: '2025-01-01', to: '2026-06-30' },
  { name: 'sweep-bos and ICT Lab evaluation (QQQ and SPY)', from: '2023-01-03', to: '2024-12-31' },
]);
export const assertInBound = (date, what = 'date') => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) throw new NrError(400, `news-replay: ${what} must be a date (got ${date})`);
  if (date.slice(0, 10) > MAX_DATE) throw new NrError(400, `news-replay: ${what} ${date.slice(0, 10)} is after the bound ${MAX_DATE}`);
  return date;
};

export const BASKET = Object.freeze(['MU', 'AMZN', 'META', 'TSLA', 'VST', 'GOOG', 'INTC', 'CSCO', 'PYPL', 'SNAP']);
// News tags that name the same listed company under its ticker of the time (not a predecessor company): Meta
// Platforms traded as FB until 2022-06-09. Applied when news is stored, and disclosed in DATA-INVENTORY.md.
export const NEWS_TICKER_ALIASES = Object.freeze({ META: ['FB'] });

export const textSha256 = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
export const fileSha256 = (file) => textSha256(fs.readFileSync(file, 'utf8'));
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hashOf = (obj) => sha256(canonicalJson(obj));

// Pins of the frozen campaign files and the campaign commit (EXPERIMENT-LOG.md entry 2; CAMPAIGN-1.md).
export const PREREG = Object.freeze({
  commit: 'fafd8a0dd5d4f598fed0afd6b4b2973c8e31b76b',
  committedAt: '2026-11-06T14:50:37-06:00',
  sha256: Object.freeze({
    'CAMPAIGN-1.md': '465ba85cbd5c35bce63dca560effa7ee7294ecae7bbcfb88ec80294695e9d74e',
    'matrix-v1.json': 'a17b914f8c64e86f2c7689aa82c202ec2e2a62524d7c47517a48cc245b5498da',
    'headline-words-v1.json': 'ac5b3728d1619a47dc1218c4aee5219c57e6630f051f8e7ffec987828034fb5b',
    'ai-planner-v1.json': 'c7a11b78123954d996485479396d9ca30d7902bf4417cd669a539543828c4c98',
  }),
});

export function git(args, { root = ROOT } = {}) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
export function headCommit() { try { return git(['rev-parse', 'HEAD']); } catch { return null; } }
export function isAncestor(commit) { try { execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; } }
export function committedSha(commit, relPath) { try { return textSha256(execFileSync('git', ['show', `${commit}:${relPath}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); } catch { return null; } }
export const COMMITTED_PATHS = ['server/newsreplay', 'scripts/newsreplay.mjs', 'strategy/news-replay/CAMPAIGN-1.md', 'strategy/news-replay/matrix-v1.json', 'strategy/news-replay/headline-words-v1.json', 'strategy/news-replay/ai-planner-v1.json'];
export function uncommitted(paths = COMMITTED_PATHS) { try { const o = git(['status', '--porcelain', '--', ...paths]); return o ? o.split('\n').filter(Boolean) : []; } catch (e) { return [`git status failed: ${e.message}`]; } }

// ---------- the experiment log (append-only; read outside code fences and HTML comments) ----------
const ENTRY = /^## (\d+) \| (\d{4}-\d{2}-\d{2}) \| (.*)$/;
export function logEntries(text) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '').split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) { const m = line.match(ENTRY); if (m) { cur = { number: Number(m[1]), date: m[2], title: m[3], body: '' }; out.push(cur); } else if (cur) cur.body += `${line}\n`; }
  return out;
}
const RUN_ROW = /\*\*Run\*\* run id: (\d+), config: ([A-Z]+-[A-C]), config hash: ([0-9a-f]{64}), status: (done|failed); variant: ([a-z_0-9]+)/g;
export function logStatus(text) {
  const entries = logEntries(text);
  const numbers = entries.map((e) => e.number);
  const frozen = entries.filter((e) => /\*\*Frozen for campaign 1\*\*/.test(e.title)).map((e) => {
    const all = `${e.title}\n${e.body}`;
    return { number: e.number, codeRevision: all.match(/code revision:?\s*`?(nr-code-[0-9-]+)`?/i)?.[1] ?? null, commit: all.match(/campaign commit:?\s*`?([0-9a-f]{40})`?/i)?.[1] ?? null, manifest: all.match(/data manifest hash:?\s*`?([0-9a-f]{64})`?/i)?.[1] ?? null };
  });
  const runs = [];
  for (const e of entries) for (const m of `${e.title}\n${e.body}`.matchAll(RUN_ROW)) runs.push({ runId: Number(m[1]), config: m[2], configHash: m[3], status: m[4], variant: m[5] });
  return { entries: entries.length, ordered: numbers.every((n, i) => n === i + 1), nextNumber: (numbers.length ? Math.max(...numbers) : 0) + 1, counts: entries.filter((e) => /\*\*Event counts\*\*/.test(e.title)).map((e) => e.number), frozen, runs };
}
export const readLog = (file = LOG_PATH) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
export function appendLogEntry({ title, body, date, file = LOG_PATH }) {
  const st = logStatus(readLog(file));
  if (!st.ordered) throw new NrError(409, 'the experiment log is not numbered 1, 2, 3, ...; nothing appended');
  const text = `\n## ${st.nextNumber} | ${date} | ${title}\n\n${String(body).trim()}\n`;
  fs.appendFileSync(file, text, 'utf8');
  return { number: st.nextNumber, text };
}

export class NrError extends Error { constructor(status, message) { super(message); this.status = status; } }
