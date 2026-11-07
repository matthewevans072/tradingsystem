// news-replay planted-bug check (`npm run nr:planted`): each listed bug is planted, one at a time, into a scratch git
// worktree of HEAD (or, with --working-tree, the current news-replay files), and tests/newsreplay.test.js must catch it
// with a named failing test. The runner, the baseline rule and the CAUGHT / MISSED / INVALID / INCONCLUSIVE verdicts are
// sweep-bos's (scripts/sweepbos-planted.mjs, imported). Synthetic data only: nothing reads market data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTests, freeBytes, MIN_FREE_BYTES, DEFAULT_TIMEOUT_MS } from './sweepbos-planted.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EX = 'server/newsreplay/exits.js', IT = 'server/newsreplay/items.js', LO = 'server/newsreplay/loader.js', PR = 'server/newsreplay/profile.js', PL = 'server/newsreplay/planner.js', SI = 'server/newsreplay/sim.js', EV = 'server/newsreplay/evaluate.js', ST = 'server/newsreplay/store.js', AI = 'server/newsreplay/ai.js';
export const TESTS = ['tests/newsreplay.test.js'];
export const BUGS = [
  { name: 'no processing delay before eligibility', file: IT, find: 'export const PROCESSING_DELAY_MS = 5 * 60000;', replace: 'export const PROCESSING_DELAY_MS = 0;' },
  { name: 'revision threshold 30 minutes instead of 15', file: IT, find: 'export const REVISION_MS = 15 * 60000;', replace: 'export const REVISION_MS = 30 * 60000;' },
  { name: 'an item published before the open is eligible at the open, not the first bar close', file: IT, find: 'const firstBarClose = (date) => bounds(date).open + BAR_MS;', replace: 'const firstBarClose = (date) => bounds(date).open;' },
  { name: 'look-ahead: the packet admits items eligible one bar after T', file: LO, find: '(itemsOverride ?? byStock.get(stock) ?? []).filter((it) => it.eligibleMs <= T && it.session === session)', replace: '(itemsOverride ?? byStock.get(stock) ?? []).filter((it) => it.eligibleMs <= T + 300000 && it.session === session)' },
  { name: 'look-ahead: the packet admits the bar still forming at T', file: LO, find: '.filter((b) => b.e <= T).map((b) => ({ s: b.s, e: b.e, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));', replace: '.filter((b) => b.s <= T).map((b) => ({ s: b.s, e: b.e, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));' },
  { name: 'a same-session (developing) profile allowed', file: PR, find: '  if (session >= asOfSession) throw', replace: '  if (session > asOfSession) throw' },
  { name: 'value area of 50% instead of 70%', file: PR, find: 'export const VALUE_AREA_SHARE = 0.70;', replace: 'export const VALUE_AREA_SHARE = 0.50;' },
  { name: 'activation at 0.25 m instead of 0.5 m', file: PL, find: 'export const ACTIVATION_M = 0.5;', replace: 'export const ACTIVATION_M = 0.25;' },
  { name: 'invalidation at 0.5 m instead of 1.0 m', file: PL, find: 'export const INVALIDATION_M = 1.0;', replace: 'export const INVALIDATION_M = 0.5;' },
  { name: 'DC ignores a negative headline', file: PL, find: '    armed = disarmedBy.length === 0;', replace: '    armed = true;' },
  { name: 'entry A fills at the activation bar instead of the next bar', file: SI, find: "  if (treatment === 'A') return act.i + 1 < arr.length ? { fate: 'pending', fillI: act.i + 1 }", replace: "  if (treatment === 'A') return act.i + 1 < arr.length ? { fate: 'pending', fillI: act.i }" },
  { name: 'entry B recovers above the touching bar\'s low instead of its high', file: SI, find: '      const th = touch.h / mk.ratioAfter(plan.stock, touch.date, b.date);', replace: '      const th = touch.l / mk.ratioAfter(plan.stock, touch.date, b.date);' },
  { name: 'a signal decided before any fill (no setup, expired) is not recorded', file: SI, find: "    if (e.fate !== 'pending') { act(e.knownMs ?? a.bar.e, p.stock, 'signal', { ...sig }); continue; }", replace: "    if (e.fate !== 'pending') continue;" },
  { name: 'an expired setup is dated at the activation, before its expiry is known', file: SI, find: "level, knownMs: lastE };", replace: 'level, knownMs: act.bar.e };' },
  { name: 'buys without spread and slippage', file: SI, find: '        const px = b.o * (1 + k(g.stock, b.date));', replace: '        const px = b.o;' },
  { name: 'a later bearish activation no longer cancels a pending entry', file: SI, find: '        const bear = (bears.get(g.stock) || []).find((z) => z.ms > sig.activationMs && z.ms <= g.ms);', replace: '        const bear = null;' },
  { name: 'the invalidation exit at the same close instead of the next open', file: SI, find: "        if (bar.c < p.inv - EPS && !pendingExit.has(stock)) { pendingExit.set(stock, 'invalidation');", replace: "        if (bar.c < p.inv - EPS && !pendingExit.has(stock)) { sell(stock, bar.c * (1 - k(stock, d)), bar.c, ev.ms, 'invalidation', d); continue; pendingExit.set(stock, 'invalidation');" },
  { name: 'time stop after 9 sessions', file: SI, find: '        if (dIdx - p.fillDi >= TIME_STOP_SESSIONS) {', replace: '        if (dIdx - p.fillDi >= TIME_STOP_SESSIONS - 1) {' },
  { name: 'same-time buys each get the whole cash', file: SI, find: '      const n = group.length, cashShare = Math.max(0, cash) / n, roomShare = room / n;', replace: '      const n = group.length, cashShare = Math.max(0, cash), roomShare = room / n;' },
  { name: 'a split leaves the shares unchanged', file: SI, find: '        p.shares = whole; p.inv /= sp.ratio; p.entry /= sp.ratio;', replace: '        p.inv /= sp.ratio; p.entry /= sp.ratio;' },
  { name: 'the evaluation drops paid dividends from cash', file: EV, find: "    else if (a.kind === 'dividend_paid' || a.kind === 'cash_in_lieu') {\n      cash += d.amount;", replace: "    else if (a.kind === 'dividend_paid' || a.kind === 'cash_in_lieu') {\n      cash += 0;" },
  { name: 'the plan chain ignores the plan', file: ST, find: '  const chain = sha256(`${prev}|${packetHash}|${sha256(planJson)}`);', replace: '  const chain = sha256(`${prev}|${packetHash}`);' },
  { name: 'the answers drop "made money and does not qualify"', file: 'server/newsreplay/answers.js', find: "${made && !sel.candidate ? ' It made money in this simulation and it does not qualify; both are true.' : ''}", replace: '', all: true },
  { name: 'the selection ignores the minimum of 30 completed trades', file: 'server/newsreplay/answers.js', find: '  if (r.completedTrades < sel.minCompletedTrades) problems.push(', replace: '  if (false) problems.push(', all: true },
  { name: 'the inspector shows a plan under another planner\'s configuration', file: 'server/newsreplay/service.js', find: "      if (row.planner !== PLANNER_OF(config)) throw new NrError(400,", replace: "      if (false) throw new NrError(400," },
  { name: 'X2: a close at the POC exits', file: EX, find: 'if (w.c >= p.val - EPS && w.c < p.poc - EPS) return', replace: 'if (w.c >= p.val - EPS && w.c <= p.poc + EPS) return' },
  { name: 'X2: the 30-minute window holding the fill is counted', file: EX, find: '      if (w.s < fb.s) continue; // only windows that start at or after the fill\n', replace: '' },
  { name: 'X2: the delay sensitivities ignored for the AMT exits', file: EX, find: '    const j = delay ? delayed(i, arr, delay) : i;', replace: '    const j = i;' },
  { name: 'X3: a touch fills without the one-cent margin', file: EX, find: 'export const TOUCH_EXCESS = 0.01;', replace: 'export const TOUCH_EXCESS = 0;' },
  { name: 'X3: the target active on the fill bar itself', file: EX, find: '  for (let j = fillI + 1; j <= endI; j++) {', replace: '  for (let j = fillI; j <= endI; j++) {' },
  { name: 'X3: the primary target without the value area height', file: EX, find: '  const primary = P.vah + (P.vah - P.val);', replace: '  const primary = P.vah;' },
  { name: 'X3: an intrabar touch before the sales at the bar open', file: EX, find: "raw: t, order: 2.5,", replace: "raw: t, order: 0.5," },
  { name: 'X4: a close equal to the activation bar low exits', file: EX, find: '        if (w.c < level - EPS) return', replace: '        if (w.c <= level + EPS) return' },
  { name: 'the composite target ties to the higher price', file: PR, find: '(Math.abs(v - vol.get(best)) <= 1e-9 && i < best)) best = i;', replace: '(Math.abs(v - vol.get(best)) <= 1e-9 && i > best)) best = i;' },
  { name: 'the existing exits gain an exit plan (X1 no longer campaign 1 unchanged)', file: SI, find: "        if (exit !== 'existing') {\n          const ax = amtExitOf(", replace: "        if (true) {\n          const ax = amtExitOf(" },
  { name: 'the AI validator ignores dates after T', file: AI, find: "  for (const m of all.matchAll(/\\b(20\\d{2})-(\\d{2})-(\\d{2})\\b/g)) if (m[0] > asOfDate) problems.push(`mentions the date ${m[0]}, after T`);", replace: '' },
  { name: 'the AI cache ignores the variant', file: AI, find: '    const key = { packetHash: hashOf(sent), variant, model: spec.model, promptSha: psha };', replace: "    const key = { packetHash: hashOf(packet), variant: 'AI', model: spec.model, promptSha: psha };" },
];

const copyInto = (wt, rel) => { const src = path.join(ROOT, rel); if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true }); fs.copyFileSync(src, path.join(wt, rel)); } };
export function runPlanted({ ref = 'HEAD', workingTree = false, timeoutMs = DEFAULT_TIMEOUT_MS, log = console.log } = {}) {
  const free = freeBytes(os.tmpdir());
  if (free < MIN_FREE_BYTES) throw new Error('refusing to run: under 1 GB free on the temp volume');
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-planted-'));
  const results = [];
  try {
    execFileSync('git', ['-c', 'core.autocrlf=false', 'worktree', 'add', '--detach', wt, ref], { cwd: ROOT, stdio: 'pipe' });
    if (workingTree) {
      for (const f of fs.readdirSync(path.join(ROOT, 'server/newsreplay'))) copyInto(wt, `server/newsreplay/${f}`);
      for (const f of ['tests/newsreplay.test.js', 'tests/helpers.js', 'strategy/news-replay/headline-words-v1.json', 'strategy/news-replay/ai-planner-v1.json', 'strategy/news-replay/matrix-v1.json']) copyInto(wt, f);
    }
    const base = runTests(wt, TESTS, timeoutMs);
    log(`baseline: ${base.outcome}, ${base.passing} passing, ${base.failing.length} failing`);
    if (base.outcome !== 'completed' || base.failing.length || base.status !== 0) throw new Error(`baseline not passing: ${base.failing.join('; ') || base.outcome}`);
    for (const bug of BUGS) {
      const file = path.join(wt, bug.file);
      const orig = fs.readFileSync(file, 'utf8');
      const n = orig.split(bug.find).length - 1;
      // all: plant in every occurrence (a rule shared by campaign 1's and campaign 2's functions); otherwise exactly one.
      if (bug.all ? n < 1 : n !== 1) { results.push({ name: bug.name, status: 'INVALID', failing: [], detail: `pattern found ${n} times` }); log(`INVALID      | ${bug.name} | pattern found ${n} times`); continue; }
      fs.writeFileSync(file, orig.split(bug.find).join(bug.replace));
      try {
        const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        if (check.status !== 0) { results.push({ name: bug.name, status: 'INVALID', failing: [], detail: 'does not load' }); log(`INVALID      | ${bug.name} | does not load`); continue; }
        const r = runTests(wt, TESTS, timeoutMs);
        const status = r.outcome !== 'completed' ? 'INCONCLUSIVE' : r.failing.length ? 'CAUGHT' : 'MISSED';
        results.push({ name: bug.name, status, failing: r.failing, detail: r.outcome });
        log(`${status.padEnd(12)} | ${bug.name} | ${r.failing.length ? r.failing.join('; ').slice(0, 160) : r.outcome}`);
      } finally { fs.writeFileSync(file, orig); }
    }
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'pipe' }); } catch { /* */ }
    try { fs.rmSync(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* */ }
    try { execFileSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'pipe' }); } catch { /* */ }
  }
  return results;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = runPlanted({ workingTree: process.argv.includes('--working-tree') });
  const c = { CAUGHT: 0, MISSED: 0, INVALID: 0, INCONCLUSIVE: 0 };
  for (const r of results) c[r.status]++;
  console.log(`CAUGHT ${c.CAUGHT}, MISSED ${c.MISSED}, INVALID ${c.INVALID}, INCONCLUSIVE ${c.INCONCLUSIVE} of ${results.length} run (${BUGS.length} listed)`);
  console.log(c.CAUGHT === BUGS.length ? 'every listed bug is caught by a named failing test' : 'NOT every listed bug is caught');
  process.exitCode = c.CAUGHT === BUGS.length ? 0 : 1;
}
