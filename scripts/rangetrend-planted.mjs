// Range-trend planted-bug check (strategy/range-trend/PLAN-DRAFT.md section 7a). Run manually:
//
//   node scripts/rangetrend-planted.mjs [--ref <commit>] [--working-tree] [--only <substring>] [--keep] [--timeout <ms>]
//
// A scratch git worktree of <commit> (default HEAD) is created; --working-tree copies the current, possibly
// uncommitted, server/rangetrend/*.js, tests/rangetrend-*.test.js and the range-trend configs into it. First
// the unmodified tests must pass there (the baseline); otherwise nothing is planted. Then each listed bug is
// planted, one at a time: the planted file must still load (node --check), or the bug is INVALID; the tests
// are run with the TAP reporter and a timeout, and the bug is CAUGHT only when the run completes (a TAP plan
// is printed, no timeout or crash) and at least one named test assertion fails ("not ok" with a name);
// MISSED when the run completes with no failure; INCONCLUSIVE on a timeout, a crash, a disk-space or other
// infrastructure failure, or missing output. The file is restored after each bug. The worktree and its
// directory are removed in a finally block, crash included (--keep leaves it). The free space of the temp
// volume is printed at the start and the check refuses to run under 1 GB. Exit code 0 only when every bug
// is CAUGHT. Synthetic test data only: nothing here reads market data, opens a database or runs a strategy
// on prices.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E = 'server/rangetrend/engine.js', LV = 'server/rangetrend/levels.js', BM = 'server/rangetrend/benchmark.js';
export const TESTS = ['tests/rangetrend-engine.test.js', 'tests/rangetrend-fixes.test.js', 'tests/rangetrend-planted.test.js', 'tests/rangetrend-definitions.test.js', 'tests/rangetrend-gaps.test.js'];
export const MIN_FREE_BYTES = 1024 ** 3;
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// { name, file, find, replace }: `find` must occur exactly once in `file`.
export const BUGS = [
  // The 20 of EXPERIMENT-LOG.md entry 5 (bug 19 adapted to D1: no retirement, so the edge is the refused signal).
  { name: 'holdings valued at the fill price', file: E, find: 'return a + (st.position ? st.position.shares * st.lastClose : 0); }, 0);', replace: 'return a + (st.position ? st.position.shares * st.position.fillPrice : 0); }, 0);' },
  { name: 'V = cash only', file: E, find: '    const V = S.cash + holdingsValue();', replace: '    const V = S.cash;' },
  { name: 'sell fees reported but not deducted', file: E, find: '    const proceeds = p.shares * px - fees.total;', replace: '    const proceeds = p.shares * px;' },
  { name: 'exits filled at the decision close', file: E, find: '    const k = kOf(st.symbol, date), px = b.o * (1 - k);', replace: '    const k = kOf(st.symbol, date), px = st.lastClose * (1 - k);' },
  { name: 'split: history in the window not adjusted', file: E, find: '      st.history = st.history.map((c) => c / r);\n', replace: '' },
  { name: 'split: pending buy shares not adjusted', file: E, find: '        o.shares = Math.floor(o.shares * r + EPS);\n', replace: '' },
  { name: 'split: trend hi/oldHi/highest not adjusted', file: E, find: "for (const k of ['stop', 'lo', 'hi', 'H', 'm', 'topLow', 'oldHi', 'highest', 'fillPrice'])", replace: "for (const k of ['stop', 'lo', 'H', 'm', 'topLow', 'fillPrice'])" },
  { name: 'split: last sale price not adjusted', file: E, find: '      if (st.lastSale) st.lastSale.price /= r;\n', replace: '' },
  { name: 'split: pullback watch not adjusted', file: E, find: '      if (st.watch) { st.watch.oldHi /= r; st.watch.m /= r; if (st.watch.prevClose != null) st.watch.prevClose /= r; }\n', replace: '' },
  { name: 'split: cash in lieu at the close', file: E, find: '        const cash = f.shares * b.o * (1 - hs(s, date) / 10000);', replace: '        const cash = f.shares * b.c * (1 - hs(s, date) / 10000);' },
  { name: 'total-risk room ignores open positions', file: E, find: 'Math.max(0, (P.totalEntryRiskPct / 100) * V - entryRiskOpen())', replace: 'Math.max(0, (P.totalEntryRiskPct / 100) * V)' },
  { name: 'current-value open risk instead of entry risk', file: E, find: 'return a + (st.position ? st.position.entryRisk : 0) +', replace: 'return a + (st.position ? st.position.shares * Math.max(0, st.lastClose - st.position.stop) : 0) +' },
  { name: 'cost-free cash sizing', file: E, find: '    cash: Math.floor((cashShare - commissionPerOrder) / (price * (1 + k) + commissionPerShare) + EPS),', replace: '    cash: Math.floor((cashShare - commissionPerOrder) / (price + commissionPerShare) + EPS),' },
  { name: 'H >= 4m dropped', file: LV, find: ' && gt(H, 0) && ge(H, L.minHeightM * m);', replace: ' && gt(H, 0);' },
  { name: 'trend exit counts non-consecutive closes', file: E, find: 'p.belowHiCount = lt(c, p.oldHi) ? p.belowHiCount + 1 : 0;', replace: 'p.belowHiCount = lt(c, p.oldHi) ? p.belowHiCount + 1 : p.belowHiCount;' },
  { name: 'pullback within-1m check removed', file: LV, find: '  return gt(c, oldHi) && le(c, oldHi + L.pullbackM * m);', replace: '  return gt(c, oldHi);' },
  { name: 'conversion uses the rolling hi', file: E, find: '        if (gt(c, p.hi + L.breakoutM * p.m)) {', replace: '        const rsr = rangeState(st.history.slice(0, -1), L);\n        if (gt(c, (rsr?.hi ?? p.hi) + L.breakoutM * (rsr?.m ?? p.m))) {' },
  { name: 'boundary: exactly 5 closes outside merge', file: LV, find: 'if (visits.length && outside < gap)', replace: 'if (visits.length && outside <= gap)' },
  { name: 'D1 boundary: a signal at a close equal to P is not refused (gt instead of ge)', file: E, find: 'if (config.reentryLimit && st.lastSale && ge(c, st.lastSale.price)) {', replace: 'if (config.reentryLimit && st.lastSale && gt(c, st.lastSale.price)) {' },
  { name: 'boundary: close equal to lo is a dip', file: LV, find: '  return !!st?.established && gt(c, st.lo) && le(c, st.bottom[1]);', replace: '  return !!st?.established && ge(c, st.lo) && le(c, st.bottom[1]);' },
  // The owner's decisions (entry 7) and the watch rule.
  { name: 'D3 boundary at 60 instead of 61 closes after the confirming close', file: LV, find: 'closes - L.windowSessions > breakOrdinal', replace: 'closes - L.windowSessions >= breakOrdinal' },
  { name: "D3 dip allowed on a breakdown's confirming close", file: E, find: "      if (breakKind === 'breakdown') return null; // a breakdown's confirming close gives no dip or recovery entry\n", replace: '' },
  { name: 'D3 a non-qualified breakout replaces the watch', file: E, find: '    if (qualified && isBreakout(rs, c, L)) {\n      if (st.watch) endWatch', replace: '    if (rs && isBreakout(rs, c, L)) {\n      if (st.watch) endWatch' },
  { name: 'D2 up close with >= instead of >', file: LV, find: '&& gt(c, st.prevClose) && !st.topSinceBottom && !inTop;', replace: '&& ge(c, st.prevClose) && !st.topSinceBottom && !inTop;' },
  { name: "D2 top-zone check counted from the visit's start", file: LV, find: 'w.slice(lastBottom.end + 1).some(', replace: 'w.slice(lastBottom.start + 1).some(' },
  { name: 'D1 fill equal to P allowed', file: E, find: 'if (o.ceiling != null && !lt(px, o.ceiling))', replace: 'if (o.ceiling != null && !le(px, o.ceiling))' },
  { name: 'D1 retirement restored', file: E, find: 'if (config.reentryLimit && st.lastSale && ge(c, st.lastSale.price)) {', replace: 'if (config.reentryLimit && st.lastSale && (st.retired || (st.retired = ge(c, st.lastSale.price)))) {' },
  { name: 'D4 dividend reinvested on the ex-date', file: BM, find: 'payDate: dv.payDate || d, net:', replace: 'payDate: d, net:' },
  { name: 'D4 index rebalanced daily', file: BM, find: '    out.push({ date: d, value: holdings + cash, holdings, cash });', replace: '    out.push({ date: d, value: holdings + cash, holdings, cash });\n    for (const s of syms) if (bought[s] && lastClose[s] > 0) shares[s] = (holdings + cash) / syms.length / lastClose[s];' },
  { name: 'watch ended at the decision instead of the fill', file: E, find: "      rec('decisions', { ...base, action: 'entry', shares, caps, binding, plannedRisk: shares * dist });", replace: "      if (sig.entryType === 'pullback' && st.watch) endWatch(st, date, 'pullback entry decided', true);\n      rec('decisions', { ...base, action: 'entry', shares, caps, binding, plannedRisk: shares * dist });" },
  // The second fix pass (EXPERIMENT-LOG.md entry 12).
  { name: 'split: pending breakdown watch (frozen lo) not rescaled', file: E, find: '      if (st.breakdownWatch) { st.breakdownWatch.frozenLo /= r; st.breakdownWatch.m /= r; }\n', replace: '' },
  { name: 'D3 conversion close not a confirming close', file: E, find: "          setBreak(st, 'conversion', date, { close: c, hi: p.hi, m: p.m, tradeId: p.tradeId });\n", replace: '' },
  { name: "split: a pending buy's decision-time copy of P (afterSale.price) not rescaled", file: E, find: '        if (o.afterSale?.price != null) o.afterSale.price /= r;\n', replace: '' },
  { name: 'D4 last close not split-adjusted on a session without a bar', file: BM, find: '      if (lastClose[sp.symbol] != null) lastClose[sp.symbol] /= sp.ratio;\n', replace: '' },
];

function parseArgs(argv) {
  const o = { ref: 'HEAD', workingTree: false, only: null, keep: false, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ref') o.ref = argv[++i];
    else if (a === '--working-tree') o.workingTree = true;
    else if (a === '--only') o.only = argv[++i];
    else if (a === '--keep') o.keep = true;
    else if (a === '--timeout') o.timeoutMs = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

export function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

// Run the Tier 1 files with the TAP reporter. The outcome is 'completed' only when the process exited by
// itself (no timeout, no signal) and printed a TAP plan; the failing top-level tests are the "not ok" lines
// at the outer indentation, with their names.
export function runTests(cwd, tests, timeoutMs) {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', '--test-reporter=tap', ...tests], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const out = `${r.stdout || ''}`, err = `${r.stderr || ''}`;
  const lines = out.split(/\r?\n/);
  const plan = lines.some((l) => /^1\.\.\d+$/.test(l));
  const failing = lines.filter((l) => /^not ok \d+ - /.test(l)).map((l) => l.replace(/^not ok \d+ - /, '').replace(/ # (SKIP|TODO).*$/, ''));
  const passing = lines.filter((l) => /^ok \d+ - /.test(l)).length;
  const infra = /ENOSPC|out of memory|heap out of memory|EMFILE|ENOMEM|disk full/i.test(out + err);
  let outcome = 'completed';
  if (r.error && r.error.code === 'ETIMEDOUT') outcome = 'timeout';
  else if (r.error) outcome = `spawn error: ${r.error.message}`;
  else if (r.signal) outcome = `killed by ${r.signal}`;
  else if (infra) outcome = 'infrastructure failure';
  else if (!plan) outcome = r.status === 0 && !out.trim() ? 'no output' : `no TAP plan (exit ${r.status})`;
  return { outcome, failing, passing, status: r.status, stderr: err.slice(-2000) };
}

export function runPlanted({ ref = 'HEAD', workingTree = false, only = null, keep = false, timeoutMs = DEFAULT_TIMEOUT_MS, log = console.log } = {}) {
  const tmpRoot = os.tmpdir();
  const free = freeBytes(tmpRoot);
  log(`free space on the temp volume: ${(free / 1024 ** 3).toFixed(1)} GB`);
  if (free < MIN_FREE_BYTES) throw new Error(`refusing to run: under 1 GB free on ${tmpRoot}`);
  const wt = fs.mkdtempSync(path.join(tmpRoot, 'rt-planted-'));
  const results = [];
  let baseline = null;
  try {
    execFileSync('git', ['-c', 'core.autocrlf=false', 'worktree', 'add', '--detach', wt, ref], { cwd: ROOT, stdio: 'pipe' });
    if (workingTree) {
      for (const f of fs.readdirSync(path.join(ROOT, 'server/rangetrend')).filter((x) => x.endsWith('.js'))) fs.copyFileSync(path.join(ROOT, 'server/rangetrend', f), path.join(wt, 'server/rangetrend', f));
      for (const f of fs.readdirSync(path.join(ROOT, 'tests')).filter((x) => /^rangetrend-.*\.test\.js$/.test(x))) fs.copyFileSync(path.join(ROOT, 'tests', f), path.join(wt, 'tests', f));
      for (const f of fs.readdirSync(path.join(ROOT, 'strategy/range-trend/configs'))) fs.copyFileSync(path.join(ROOT, 'strategy/range-trend/configs', f), path.join(wt, 'strategy/range-trend/configs', f));
    }
    const tests = TESTS.filter((t) => fs.existsSync(path.join(wt, t)));
    log(`worktree ${wt} at ${ref}${workingTree ? ' (working-tree files copied)' : ''}; tests: ${tests.join(', ')}`);
    // The baseline: the unmodified tests must pass, or nothing is planted.
    baseline = runTests(wt, tests, timeoutMs);
    log(`baseline: ${baseline.outcome}, ${baseline.passing} passing, ${baseline.failing.length} failing`);
    if (baseline.outcome !== 'completed' || baseline.failing.length || baseline.status !== 0) {
      throw new Error(`baseline not passing (${baseline.outcome}; failing: ${baseline.failing.join('; ') || 'none'}; exit ${baseline.status}): refusing to plant bugs`);
    }
    for (const bug of BUGS) {
      if (only && !bug.name.includes(only)) continue;
      const file = path.join(wt, bug.file);
      const orig = fs.readFileSync(file, 'utf8');
      const n = orig.split(bug.find).length - 1;
      if (n !== 1) { results.push({ name: bug.name, status: 'INVALID', detail: `pattern found ${n} times`, failing: [] }); log(`INVALID      | ${bug.name} | pattern found ${n} times`); continue; }
      fs.writeFileSync(file, orig.replace(bug.find, bug.replace));
      try {
        const check = spawnSync(process.execPath, ['--check', file], { cwd: wt, encoding: 'utf8' });
        if (check.status !== 0) { results.push({ name: bug.name, status: 'INVALID', detail: `the planted file does not load: ${(check.stderr || '').trim().split('\n').slice(-1)[0]}`, failing: [] }); log(`INVALID      | ${bug.name} | planted file does not load`); continue; }
        const r = runTests(wt, tests, timeoutMs);
        let status;
        if (r.outcome !== 'completed') status = 'INCONCLUSIVE';
        else status = r.failing.length ? 'CAUGHT' : 'MISSED';
        results.push({ name: bug.name, status, detail: r.outcome === 'completed' ? '' : r.outcome, failing: r.failing, passing: r.passing, exit: r.status });
        log(`${status.padEnd(12)} | ${bug.name} | ${r.failing.length ? r.failing.join('; ') : r.outcome}`);
      } finally {
        fs.writeFileSync(file, orig);
      }
    }
  } finally {
    if (!keep) {
      try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'pipe' }); } catch { /* fall through */ }
      try { fs.rmSync(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* ignore */ }
      try { execFileSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'pipe' }); } catch { /* ignore */ }
      // The worktree's metadata under .git/worktrees can outlive the prune on a synced folder: remove it too.
      const meta = path.join(ROOT, '.git', 'worktrees', path.basename(wt));
      try { fs.rmSync(meta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* ignore */ }
      if (fs.existsSync(wt)) log(`warning: ${wt} could not be removed`);
      if (fs.existsSync(meta)) log(`warning: ${meta} could not be removed`);
    } else log(`worktree kept at ${wt}`);
  }
  return { baseline, results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const { results } = runPlanted(opts);
  const counts = { CAUGHT: 0, MISSED: 0, INVALID: 0, INCONCLUSIVE: 0 };
  for (const r of results) counts[r.status]++;
  console.log('\nResults:');
  for (const r of results) console.log(`  ${r.status.padEnd(12)} ${r.name}${r.failing.length ? `\n      failing: ${r.failing.join('; ')}` : r.detail ? `\n      ${r.detail}` : ''}`);
  console.log(`\nCAUGHT ${counts.CAUGHT}, MISSED ${counts.MISSED}, INVALID ${counts.INVALID}, INCONCLUSIVE ${counts.INCONCLUSIVE} of ${results.length} run (${BUGS.length} listed)`);
  const verified = results.length === BUGS.length && results.every((r) => r.status === 'CAUGHT' && r.failing.length);
  console.log(verified ? 'every listed bug is caught by a named failing test' : 'NOT verified: a bug is missed, invalid, inconclusive or not run');
  process.exit(verified ? 0 : 1);
}
