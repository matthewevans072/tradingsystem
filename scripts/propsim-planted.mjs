// prop-sim planted-bug check (`npm run ps:planted`): each listed bug is planted, one at a time, into a scratch git
// worktree of HEAD (or, with --working-tree, the current prop-sim files), and tests/propsim.test.js must catch it with a
// named failing test. The runner and the verdicts are sweep-bos's (scripts/sweepbos-planted.mjs). Synthetic data only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTests, freeBytes, MIN_FREE_BYTES, DEFAULT_TIMEOUT_MS } from './sweepbos-planted.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ST = 'server/propsim/store.js', MK = 'server/propsim/market.js', SG = 'server/propsim/signals.js', AC = 'server/propsim/account.js';
const LV = 'server/propsim/live.js', LST = 'server/propsim/live-store.js', LW = 'server/propsim/live-worker.js', LSRC = 'server/propsim/live-source.js';
export const TESTS = ['tests/propsim.test.js'];
const LIVE_TESTS = ['tests/propsim-live.test.js'];
export const BUGS = [
  { name: 'the store accepts bars after 2022-12-30', file: ST, find: "CHECK (date >= '${FROM}' AND date <= '${MAX_DATE}')", replace: "CHECK (date >= '${FROM}' AND date <= '2099-12-31')" },
  { name: 'the ATR over 13 bars instead of 14', file: MK, find: 'if (ring.length > 14) ring.shift();', replace: 'if (ring.length > 13) ring.shift();' },
  { name: 'the previous-day high taken from the current session', file: MK, find: 'PDH: prev ? prev.hi : null', replace: 'PDH: prev ? s.hi : null' },
  { name: 'the previous-week levels taken from the current week', file: MK, find: 'const pw = wi > 0 ? weekHiLo.get(weeks[wi - 1]) : null;', replace: 'const pw = wi > 0 ? weekHiLo.get(w) : null;' },
  { name: 'a structure shift after an upward break', file: SG, find: 'if (br.up[j] || br.down[j]) return br.down[j] && !br.up[j];', replace: 'if (br.up[j] || br.down[j]) return true;' },
  { name: 'the mirror keeps the high', file: SG, find: "export const mirrorBars = (bars) => bars.map((b) => ({ ...b, o: -b.o, h: -b.l, l: -b.h, c: -b.c }));", replace: "export const mirrorBars = (bars) => bars.map((b) => ({ ...b, o: -b.o, h: -b.h, l: -b.l, c: -b.c }));" },
  { name: 'a limit fills at a touch, not strictly through', file: SG, find: '    if (d > 0 ? x.l < entry : x.h > entry) { f = i; ref = entry; break; }', replace: '    if (d > 0 ? x.l <= entry : x.h >= entry) { f = i; ref = entry; break; }' },
  { name: 'no entry slippage', file: SG, find: '  const fill = ref + d * exec.entrySlippageTicks;', replace: '  const fill = ref;' },
  { name: 'no stop slippage', file: SG, find: "(d > 0 ? Math.min(stop, x.o) : Math.max(stop, x.o))) - d * exec.stopSlippageTicks;", replace: "(d > 0 ? Math.min(stop, x.o) : Math.max(stop, x.o)));" },
  { name: 'the target tested before the stop in one bar', file: SG, find: '    const hitStop = d > 0 ? x.l <= stop : x.h >= stop;', replace: "    if (q > f && (d > 0 ? x.h > target : x.l < target)) { exitI = q; exit = target; kind = 'target'; break; }\n    const hitStop = d > 0 ? x.l <= stop : x.h >= stop;" },
  { name: 'the worst point of a stopped trade taken at the bar beyond the stop (the defect of ps-code-2026-11-09-1)', file: SG, find: '    if (hitStop) { exitI = q; exit =', replace: '    mae = Math.max(mae, adverse(x)); if (hitStop) { exitI = q; exit =' },
  { name: 'the minimum stop not applied', file: SG, find: '  if (risk < sig.minStopTicks) {', replace: '  if (false) {' },
  { name: 'the drawdown never locks', file: AC, find: '    mll = Math.min(Math.max(mll, maxClose - plan.maxLoss), plan.lockedMll);', replace: '    mll = Math.max(mll, maxClose - plan.maxLoss);' },
  { name: 'the breach judged on the closed result, not the worst point', file: AC, find: '  const worst = -trade.maeTicks * tickValue * n - comm;', replace: '  const worst = trade.resultTicks * tickValue * n - comm;' },
  { name: 'the consistency rule ignored', file: AC, find: '(plan.consistency == null || best <= plan.consistency * profit + 1e-9)', replace: '(true || best <= plan.consistency * profit + 1e-9)' },
  { name: 'the daily loss limit ignored', file: AC, find: '  const thDll = dll == null ? -Infinity : -dll - dayPnl;', replace: '  const thDll = -Infinity;' },
  { name: 'the LucidFlex payout after four qualifying days', file: AC, find: 'if (days.filter((x) => x >= p.minDayProfit).length >= p.minDays && profit > 0)', replace: 'if (days.filter((x) => x >= p.minDayProfit).length >= p.minDays - 1 && profit > 0)' },
  { name: 'the LucidPro payout from the buffer', file: AC, find: 'amount = Math.min(bal - p.buffer, p.max);', replace: 'amount = Math.min(bal - plan.size, p.max);' },
  { name: 'sizing without slippage', file: AC, find: '  const lossPer = (riskTicks + exec.entrySlippageTicks + exec.stopSlippageTicks) * tickValue + 2 * exec.commissionPerMicroSide;', replace: '  const lossPer = riskTicks * tickValue + 2 * exec.commissionPerMicroSide;' },
  { name: 'sizing above the contract cap', file: AC, find: 'return Math.max(0, Math.min(cap, Math.floor((budget + 1e-9) / lossPer)));', replace: 'return Math.max(0, Math.floor((budget + 1e-9) / lossPer));' },
  // Phase 2, the live account (LIVE-1.md), caught by tests/propsim-live.test.js.
  { name: 'live: an entry fills from the bar the decision was recorded in', file: LV, tests: LIVE_TESTS, find: '      const t0 = Math.max(t, ceilMinute(rec.recordedMs));', replace: '      const t0 = t;' },
  { name: 'live: a position open at a gap is not closed there', file: LV, tests: LIVE_TESTS, find: '  if (gapMs != null) {\n    // Flat across a gap', replace: '  if (false) {\n    // Flat across a gap' },
  { name: 'live: the gap exit without the 1 tick of slippage', file: LV, tests: LIVE_TESTS, find: '    const exit = last.c - d * exec.stopSlippageTicks;', replace: '    const exit = last.c;' },
  { name: 'live: setups after a gap are taken', file: LV, tests: LIVE_TESTS, find: "      if (rec.status !== 'on_time') {", replace: "      if (rec.status === 'late') {" },
  { name: 'live: a minute observed by a request after its grace', file: LV, tests: LIVE_TESTS, find: "polls[pi] <= end + graceMs && polls[pi] <= nowMs ? 'observed'", replace: "polls[pi] <= end + 2 * graceMs && polls[pi] <= nowMs ? 'observed'" },
  { name: "live: the open position's worst point not checked against the limit", file: LV, tests: LIVE_TESTS, find: '  if (open && !ended && !dllHit) {', replace: '  if (false && open && !ended && !dllHit) {' },
  { name: 'live: the next attempt starts on the session an attempt ended', file: LV, tests: LIVE_TESTS, find: '    a.end = dates[ev.end]; attempts.push(a); i0 = ev.end + 1;', replace: '    a.end = dates[ev.end]; attempts.push(a); i0 = ev.end;' },
  { name: 'live: a bar after its grace admitted as live', file: LST, tests: LIVE_TESTS, find: "const isLive = kind === 'live' && fetchedMs - (r.s + MIN) <= graceMs", replace: "const isLive = kind === 'live' && true" },
  { name: 'live: a bar arriving after a later minute admitted as live', file: LST, tests: LIVE_TESTS, find: '        && !later.get(symbol, r.date, r.minute) && !decided', replace: '        && !decided' },
  { name: "live: a bar of a decided bucket admitted as live", file: LST, tests: LIVE_TESTS, find: ' && !decided.get(r.date, Math.floor((r.minute - 570) / 5));', replace: ';' },
  { name: 'live: the store accepts a bar before 2026-11-10', file: LST, tests: LIVE_TESTS, find: "date TEXT NOT NULL CHECK (date >= '${F}'), minute INTEGER NOT NULL, o REAL NOT NULL", replace: "date TEXT NOT NULL, minute INTEGER NOT NULL, o REAL NOT NULL" },
  { name: 'live: the decision grace never applied', file: LW, tests: LIVE_TESTS, find: "const status = gap ? 'gap' : nowMs > e + T.decisionGraceMs ? 'late' : 'on_time';", replace: "const status = gap ? 'gap' : 'on_time';" },
  { name: 'live: the IEX client requests before the start', file: LSRC, tests: LIVE_TESTS, find: '    if (zonedParts(new Date(startMs), NY).date < dataFrom)', replace: '    if (false)' },
  { name: 'live: the client asks for the SIP feed', file: LSRC, tests: LIVE_TESTS, find: "export const FEED = 'iex';", replace: "export const FEED = 'sip';" },
];

const copyInto = (wt, rel) => { const src = path.join(ROOT, rel); if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true }); fs.copyFileSync(src, path.join(wt, rel)); } };
export function runPlanted({ ref = 'HEAD', workingTree = false, timeoutMs = DEFAULT_TIMEOUT_MS, log = console.log } = {}) {
  if (freeBytes(os.tmpdir()) < MIN_FREE_BYTES) throw new Error('refusing to run: under 1 GB free on the temp volume');
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-planted-'));
  const results = [];
  try {
    execFileSync('git', ['-c', 'core.autocrlf=false', 'worktree', 'add', '--detach', wt, ref], { cwd: ROOT, stdio: 'pipe' });
    if (workingTree) {
      for (const f of fs.readdirSync(path.join(ROOT, 'server/propsim'))) copyInto(wt, `server/propsim/${f}`);
      for (const f of ['tests/propsim.test.js', 'tests/propsim-live.test.js', 'tests/helpers.js', 'strategy/prop-sim/matrix-1.json', 'strategy/prop-sim/CAMPAIGN-1.md', 'strategy/prop-sim/LUCID-RULES-2026-11-09.json', 'strategy/prop-sim/live-1.json', 'strategy/prop-sim/LIVE-1.md']) copyInto(wt, f);
    }
    const base = runTests(wt, [...TESTS, ...LIVE_TESTS], timeoutMs);
    log(`baseline: ${base.outcome}, ${base.passing} passing, ${base.failing.length} failing`);
    if (base.outcome !== 'completed' || base.failing.length || base.status !== 0) throw new Error(`baseline not passing: ${base.failing.join('; ') || base.outcome}`);
    for (const bug of BUGS) {
      const file = path.join(wt, bug.file);
      const orig = fs.readFileSync(file, 'utf8');
      const n = orig.split(bug.find).length - 1;
      if (n !== 1) { results.push({ name: bug.name, status: 'INVALID', failing: [] }); log(`INVALID      | ${bug.name} | pattern found ${n} times`); continue; }
      fs.writeFileSync(file, orig.split(bug.find).join(bug.replace));
      try {
        if (spawnSync(process.execPath, ['--check', file]).status !== 0) { results.push({ name: bug.name, status: 'INVALID', failing: [] }); log(`INVALID      | ${bug.name} | does not load`); continue; }
        const r = runTests(wt, bug.tests ?? TESTS, timeoutMs);
        const status = r.outcome !== 'completed' ? 'INCONCLUSIVE' : r.failing.length ? 'CAUGHT' : 'MISSED';
        results.push({ name: bug.name, status, failing: r.failing });
        log(`${status.padEnd(12)} | ${bug.name} | ${r.failing.length ? r.failing.join('; ').slice(0, 140) : r.outcome}`);
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
