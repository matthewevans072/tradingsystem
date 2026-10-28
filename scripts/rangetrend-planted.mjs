// Range-trend planted-bug check (strategy/range-trend/PLAN-DRAFT.md section 7a). Run manually:
//
//   node scripts/rangetrend-planted.mjs [--ref <commit>] [--working-tree] [--only <substring>] [--keep]
//
// Each listed bug is planted, one at a time, in a scratch git worktree of <commit> (default HEAD), the
// range-trend Tier 1 tests are run there, the file is restored, and the result is printed; the worktree is
// removed at the end (--keep leaves it). --working-tree copies the current, possibly uncommitted,
// server/rangetrend/*.js and tests/rangetrend-*.test.js into the worktree first. Every bug must be CAUGHT
// (at least one test fails); the exit code is 1 otherwise. Synthetic test data only: nothing here reads
// market data, opens a database or runs a strategy on prices.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E = 'server/rangetrend/engine.js', LV = 'server/rangetrend/levels.js', BM = 'server/rangetrend/benchmark.js';
export const TESTS = ['tests/rangetrend-engine.test.js', 'tests/rangetrend-fixes.test.js', 'tests/rangetrend-planted.test.js', 'tests/rangetrend-definitions.test.js', 'tests/rangetrend-gaps.test.js'];

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
];

function parseArgs(argv) {
  const o = { ref: 'HEAD', workingTree: false, only: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ref') o.ref = argv[++i];
    else if (a === '--working-tree') o.workingTree = true;
    else if (a === '--only') o.only = argv[++i];
    else if (a === '--keep') o.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

export function runPlanted({ ref = 'HEAD', workingTree = false, only = null, keep = false, log = console.log } = {}) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-planted-'));
  execFileSync('git', ['-c', 'core.autocrlf=false', 'worktree', 'add', '--detach', wt, ref], { cwd: ROOT, stdio: 'pipe' });
  const results = [];
  try {
    if (workingTree) {
      for (const f of fs.readdirSync(path.join(ROOT, 'server/rangetrend')).filter((x) => x.endsWith('.js'))) fs.copyFileSync(path.join(ROOT, 'server/rangetrend', f), path.join(wt, 'server/rangetrend', f));
      for (const f of fs.readdirSync(path.join(ROOT, 'tests')).filter((x) => /^rangetrend-.*\.test\.js$/.test(x))) fs.copyFileSync(path.join(ROOT, 'tests', f), path.join(wt, 'tests', f));
      for (const f of fs.readdirSync(path.join(ROOT, 'strategy/range-trend/configs'))) fs.copyFileSync(path.join(ROOT, 'strategy/range-trend/configs', f), path.join(wt, 'strategy/range-trend/configs', f));
    }
    const tests = TESTS.filter((t) => fs.existsSync(path.join(wt, t)));
    log(`worktree ${wt} at ${ref}${workingTree ? ' (working-tree files copied)' : ''}; tests: ${tests.join(', ')}`);
    for (const bug of BUGS) {
      if (only && !bug.name.includes(only)) continue;
      const file = path.join(wt, bug.file);
      const orig = fs.readFileSync(file, 'utf8');
      if (orig.split(bug.find).length !== 2) { results.push({ ...bug, status: 'NOT PLANTED', detail: `pattern found ${orig.split(bug.find).length - 1} times` }); log(`NOT PLANTED | ${bug.name}`); continue; }
      fs.writeFileSync(file, orig.replace(bug.find, bug.replace));
      try {
        const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', ...tests], { cwd: wt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const out = `${r.stdout || ''}\n${r.stderr || ''}`;
        const failed = [...new Set(out.split(/\r?\n/).filter((l) => /^✖ /.test(l) && !/^✖ (failing tests|tests )/.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, '')))];
        const count = Number((out.match(/^ℹ fail (\d+)/m) || [])[1] ?? NaN);
        const caught = failed.length > 0 || count > 0 || r.status !== 0;
        results.push({ ...bug, status: caught ? 'CAUGHT' : 'MISSED', detail: failed.slice(0, 3).join('; ') || (r.status !== 0 ? `exit ${r.status}` : ''), failedCount: Number.isNaN(count) ? null : count });
        log(`${caught ? 'CAUGHT  ' : 'MISSED  '} | ${bug.name} | ${failed.slice(0, 2).join('; ')}`);
      } finally {
        fs.writeFileSync(file, orig);
      }
    }
  } finally {
    if (!keep) {
      try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'pipe' }); } catch { /* fall through */ }
      try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
      try { execFileSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'pipe' }); } catch { /* ignore */ }
    } else log(`worktree kept at ${wt}`);
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const results = runPlanted(opts);
  const caught = results.filter((r) => r.status === 'CAUGHT').length;
  console.log(`\n${caught} of ${results.length} planted bugs caught${results.length === BUGS.length ? '' : ` (${BUGS.length} listed)`}`);
  for (const r of results.filter((x) => x.status !== 'CAUGHT')) console.log(`  ${r.status}: ${r.name} ${r.detail || ''}`);
  process.exit(results.length && results.every((r) => r.status === 'CAUGHT') ? 0 : 1);
}
