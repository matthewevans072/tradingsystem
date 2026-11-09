// prop-sim configuration (strategy/prop-sim/CAMPAIGN-1.md): paths, the development bound, the pins of the frozen
// campaign files, the code revision and the experiment-log reader. Simulated using Lucid Trading's published rules as
// read on 2026-11-09; not affiliated with or endorsed by Lucid. Simulation only: no account, broker or order.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PS_DIR = path.join(ROOT, 'strategy', 'prop-sim');
export const LOG_PATH = path.join(PS_DIR, 'EXPERIMENT-LOG.md');
export const MATRIX_PATH = path.join(PS_DIR, 'matrix-1.json');
export const RULES_PATH = path.join(PS_DIR, 'LUCID-RULES-2026-11-09.json');
export const REPORT_DIR = path.join(PS_DIR, 'reports');
export const DB_NAME = 'prop-sim.sqlite';
export const LABEL = "simulated using Lucid Trading's published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid";
export const STAND_IN = 'stand-in, regular hours only, not futures';

// Bump with any change that can alter results.
export const CODE_REVISION = 'ps-code-2026-11-09-1';
export const ENGINE_VERSION = 'ps-engine-1';

// The development period (the order's section 4). Nothing later is requested, stored (CHECK constraints) or read; the
// 2023-2024 evaluation window and the 2025-2026 reserve have no code path.
export const FROM = '2018-06-01';
export const MAX_DATE = '2022-12-30';
export const assertInBound = (date, what = 'date') => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) throw new PsError(400, `prop-sim: ${what} must be a date (got ${date})`);
  const d = date.slice(0, 10);
  if (d > MAX_DATE) throw new PsError(400, `prop-sim: ${what} ${d} is after the bound ${MAX_DATE}`);
  if (d < FROM) throw new PsError(400, `prop-sim: ${what} ${d} is before the development period ${FROM}`);
  return date;
};

export const textSha256 = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Pins of the frozen campaign (CAMPAIGN-1.md, matrix-1.json) and the rules file, at the campaign commit.
export const PREREG = Object.freeze({
  commit: '067f7098c8d686cd62dfbd1f96135f87c826c4e4',
  committedAt: '2026-11-09T10:05:58-06:00',
  sha256: Object.freeze({
    'CAMPAIGN-1.md': 'b93dd25260d20ce87063e911908d219bd3466c32f540d84b745a41e0c7e531bc',
    'matrix-1.json': '2fb67e87215279d6f9ca657b30ea9f08197912ce3fb9edf83887d4cac9eeb269',
    'LUCID-RULES-2026-11-09.json': '202692e807a3048249ef7c131b584fe8350da96aa2f31ce83157155a85726232',
  }),
});
export const COMMITTED_PATHS = ['server/propsim', 'scripts/propsim.mjs', 'server/ictlab/rules.js', 'strategy/prop-sim/CAMPAIGN-1.md', 'strategy/prop-sim/matrix-1.json', 'strategy/prop-sim/LUCID-RULES-2026-11-09.json'];
export const loadMatrix = (file = MATRIX_PATH) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function git(args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
export function headCommit() { try { return git(['rev-parse', 'HEAD']); } catch { return null; } }
export function isAncestor(commit) { try { execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; } }
export function committedSha(commit, rel) { try { return textSha256(execFileSync('git', ['show', `${commit}:${rel}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); } catch { return null; } }
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
const RUN_ROW = /\*\*Run\*\* run id: (\d+), config: ([A-Z0-9]+-(?:NQ|ES)), status: (done|failed)/g;
export function logStatus(text) {
  const entries = logEntries(text);
  const numbers = entries.map((e) => e.number);
  const frozen = entries.filter((e) => /\*\*Frozen for campaign 1\*\*/.test(e.title)).map((e) => {
    const all = `${e.title}\n${e.body}`;
    return { number: e.number, codeRevision: all.match(/code revision:?\s*`?(ps-code-[0-9-]+)`?/i)?.[1] ?? null, commit: all.match(/campaign commit:?\s*`?([0-9a-f]{40})`?/i)?.[1] ?? null, dataHash: all.match(/data hash:?\s*`?([0-9a-f]{64})`?/i)?.[1] ?? null };
  });
  const runs = [];
  for (const e of entries) for (const m of `${e.title}\n${e.body}`.matchAll(RUN_ROW)) runs.push({ runId: Number(m[1]), config: m[2], status: m[3] });
  return { entries: entries.length, ordered: numbers.every((n, i) => n === i + 1), nextNumber: (numbers.length ? Math.max(...numbers) : 0) + 1, frozen, runs };
}
export const readLog = (file = LOG_PATH) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
export function appendLogEntry({ title, body, date, file = LOG_PATH }) {
  const st = logStatus(readLog(file));
  if (!st.ordered) throw new PsError(409, 'the experiment log is not numbered 1, 2, 3, ...; nothing appended');
  const text = `\n## ${st.nextNumber} | ${date} | ${title}\n\n${String(body).trim()}\n`;
  fs.appendFileSync(file, text, 'utf8');
  return { number: st.nextNumber, text };
}

export class PsError extends Error { constructor(status, message) { super(message); this.status = status; } }
