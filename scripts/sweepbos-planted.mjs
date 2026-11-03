// sweep-bos planted-bug check (strategy/sweep-bos/PLAN.md Part C). Run manually:
//
//   node scripts/sweepbos-planted.mjs [--ref <commit>] [--working-tree] [--only <substring>] [--keep] [--timeout <ms>]
//
// A scratch git worktree of <commit> (default HEAD) is created; --working-tree copies the current, possibly
// uncommitted, sweep-bos files into it. First the unmodified tests must pass there (the baseline); otherwise
// nothing is planted. Then each listed bug is planted, one at a time: the planted file must still load
// (node --check), or the bug is INVALID; the tests are run with the TAP reporter and a timeout, and the bug is
// CAUGHT only when the run completes (a TAP plan is printed, no timeout or crash) and at least one named test
// assertion fails ("not ok" with a name); MISSED when the run completes with no failure; INCONCLUSIVE on a
// timeout, a crash, a disk-space or other infrastructure failure, or missing output. The file is restored after
// each bug. The worktree and its directory are removed in a finally block, crash included (--keep leaves it).
// The free space of the temp volume is printed at the start and the check refuses to run under 1 GB. Exit code
// 0 only when every bug is CAUGHT. Synthetic test data only: nothing here reads market data, opens the
// simulation database or runs a strategy on prices.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RU = 'server/sweepbos/rules.js', EN = 'server/sweepbos/engine.js', MT = 'server/sweepbos/metrics.js', ST = 'server/sweepbos/store.js', DT = 'server/sweepbos/data.js', CF = 'server/sweepbos/config.js', SV = 'server/sweepbos/service.js', LN = 'scripts/sweepbos-run.mjs';
export const TESTS = ['tests/sweepbos-rules.test.js', 'tests/sweepbos-engine.test.js', 'tests/sweepbos-metrics.test.js', 'tests/sweepbos-store.test.js', 'tests/sweepbos-data.test.js', 'tests/sweepbos-service.test.js', 'tests/sweepbos-launcher.test.js'];
export const MIN_FREE_BYTES = 1024 ** 3;
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// { name, file, find, replace }: `find` must occur exactly once in `file`.
export const BUGS = [
  // rules.js
  { name: 'look-ahead on swings: confirmed after 1 later bar instead of 3', file: RU, find: 'export const confirmedBy = (indices, k) => indices.filter((i) => i + CONFIRM_BARS <= k);', replace: 'export const confirmedBy = (indices, k) => indices.filter((i) => i + 1 <= k);' },
  { name: 'wick-only sweep accepted (no close back inside)', file: RU, find: '  const long = bar.l < pdl && bar.c > pdl, short = bar.h > pdh && bar.c < pdh;', replace: '  const long = bar.l < pdl, short = bar.h > pdh;' },
  { name: 'BOS uses a swing confirmed at that close, not before it', file: RU, find: '  const usable = confirmedBy(swings, k - 1);', replace: '  const usable = confirmedBy(swings, k);' },
  { name: 'BOS on a swing an earlier bar already closed beyond', file: RU, find: "  for (let j = i + 1; j < k; j++) if (beyond(bars[j].c)) return { ok: false, swingIndex: i, level, reason: 'the swing was already closed beyond' };\n", replace: '' },
  { name: 'fair value gap: the earliest gap instead of the latest', file: RU, find: '  for (let a = k - 2; a >= lambda; a--) {', replace: '  for (let a = lambda; a <= k - 2; a++) {' },
  { name: 'order block: a doji accepted as opposite colour', file: RU, find: "    if (dir === 'long' ? b.c < b.o : b.c > b.o) return { type: 'order_block'", replace: "    if (dir === 'long' ? b.c <= b.o : b.c >= b.o) return { type: 'order_block'" },
  { name: 'buffer: the mean instead of the median', file: RU, find: '  const median = n % 2 ? cents[(n - 1) / 2] : (cents[n / 2 - 1] + cents[n / 2]) / 2;', replace: '  const median = cents.reduce((a, b) => a + b, 0) / n;' },
  { name: 'buffer: 19 sessions accepted', file: RU, find: '  if (sessions.length < BUFFER_SESSIONS) return null;', replace: '  if (sessions.length < BUFFER_SESSIONS - 1) return null;' },
  { name: 'stop B: the most recent swing instead of the second', file: RU, find: '  const i = swings[swings.length - 2];', replace: '  const i = swings[swings.length - 1];' },
  { name: 'stop/target order reversed on an ambiguous bar', file: RU, find: "    if (stopHit(b)) return { exitIndex: q, exit: long ? Math.min(stop, b.o) : Math.max(stop, b.o), reason: 'stop', sameBar: false };\n    if (targetHit(b)) return { exitIndex: q, exit: target, reason: 'target', sameBar: false };", replace: "    if (targetHit(b)) return { exitIndex: q, exit: target, reason: 'target', sameBar: false };\n    if (stopHit(b)) return { exitIndex: q, exit: long ? Math.min(stop, b.o) : Math.max(stop, b.o), reason: 'stop', sameBar: false };" },
  { name: 'the stop not checked on the fill bar', file: RU, find: "  if (stopHit(bars[m])) return { exitIndex: m, exit: stop, reason: 'stop', sameBar: true };\n", replace: '' },
  { name: 'the target checked on the fill bar', file: RU, find: "  if (stopHit(bars[m])) return { exitIndex: m, exit: stop, reason: 'stop', sameBar: true };\n", replace: "  if (stopHit(bars[m])) return { exitIndex: m, exit: stop, reason: 'stop', sameBar: true };\n  if (targetHit(bars[m])) return { exitIndex: m, exit: target, reason: 'target', sameBar: true };\n" },
  { name: 'costs dropped from R', file: RU, find: "  return dir === 'long' ? ((exit - c) - (entry + c)) / risk : ((entry - c) - (exit + c)) / risk;", replace: "  return dir === 'long' ? (exit - entry) / risk : (entry - exit) / risk;" },
  { name: 'time stop at the last close instead of its open', file: RU, find: "  return { exitIndex: n - 1, exit: bars[n - 1].o, reason: 'time', sameBar: false };", replace: "  return { exitIndex: n - 1, exit: bars[n - 1].c, reason: 'time', sameBar: false };" },
  { name: 'gap-through stop filled at the stop instead of the open', file: RU, find: "    if (stopHit(b)) return { exitIndex: q, exit: long ? Math.min(stop, b.o) : Math.max(stop, b.o), reason: 'stop', sameBar: false };", replace: "    if (stopHit(b)) return { exitIndex: q, exit: stop, reason: 'stop', sameBar: false };" },
  { name: 'stop needs a strict break instead of a touch', file: RU, find: '  const stopHit = (b) => (long ? b.l <= stop : b.h >= stop);', replace: '  const stopHit = (b) => (long ? b.l < stop : b.h > stop);' },
  { name: 'target filled on a touch instead of strictly through', file: RU, find: '  const targetHit = (b) => (long ? b.h > target : b.l < target);', replace: '  const targetHit = (b) => (long ? b.h >= target : b.l <= target);' },
  // engine.js
  { name: 'trade after the cutoff: fills allowed after the 10:25 bar', file: EN, find: '    for (let q = order.k + 1; q <= Math.min(n - 1, LAST_FILL_INDEX); q++) {', replace: '    for (let q = order.k + 1; q <= n - 1; q++) {' },
  { name: 'sweep window extended to the 10:00 bar', file: EN, find: '        if (k <= SWEEP_LAST_INDEX) {', replace: '        if (k <= SWEEP_LAST_INDEX + 1) {' },
  { name: 'bias ignored when it is on', file: EN, find: "          if (d && (variant.bias === 'off' || d === bias)) setup =", replace: '          if (d) setup =' },
  { name: 'limit filled on a touch', file: EN, find: "      if (order.dir === 'long' ? b.l < order.entry : b.h > order.entry) { m = q; break; }", replace: "      if (order.dir === 'long' ? b.l <= order.entry : b.h >= order.entry) { m = q; break; }" },
  { name: 'a close back beyond the level no longer voids the setup', file: EN, find: '      if (long ? bar.c < pdl : bar.c > pdh) { setup = null; invalidated = true; continue; }\n', replace: '' },
  { name: 'the sweep extreme frozen at the sweep bar', file: EN, find: '      setup.extreme = long ? Math.min(setup.extreme, bar.l) : Math.max(setup.extreme, bar.h);\n', replace: '' },
  { name: 'incomplete sessions traded', file: EN, find: "    if (!s.complete) { end('incomplete_session', { bars: s.bars.length, full: s.full }); continue; }", replace: "    if (false) { end('incomplete_session', { bars: s.bars.length, full: s.full }); continue; }" },
  { name: 'the buffer counts incomplete sessions', file: EN, find: '      for (let i = si - 1; i >= 0 && prev.length < BUFFER_SESSIONS; i--) if (S[i].complete) prev.unshift(S[i]);', replace: '      for (let i = si - 1; i >= 0 && prev.length < BUFFER_SESSIONS; i--) prev.unshift(S[i]);' },
  { name: 'the mirror trade keeps the direction', file: EN, find: "    const mdir = order.dir === 'long' ? 'short' : 'long';", replace: '    const mdir = order.dir;' },
  { name: 'target allowed under one risk', file: EN, find: "      if (reward < risk) { failStage = 'target_too_close'; failDetail = { rewardToRisk: reward / risk }; break; }\n", replace: '' },
  { name: 'the entry above the BOS close accepted', file: EN, find: "      if (long ? !(entry < bar.c) : !(entry > bar.c)) { failStage = 'entry_not_inside_close'; failDetail = { entry: fromU(entry), close: fromU(bar.c) }; break; }\n", replace: '' },
  // metrics.js
  { name: 'bootstrap without a fixed seed', file: MT, find: '  const rand = mulberry32(seed);\n  const means = new Array(n);', replace: '  const rand = Math.random;\n  const means = new Array(n);' },
  { name: 'best-5% K by floor', file: MT, find: '  const K = Math.max(1, Math.ceil(BEST_FRACTION * n));', replace: '  const K = Math.max(1, Math.floor(BEST_FRACTION * n));' },
  { name: 'null p without the +1 correction', file: MT, find: '  return { p: (1 + atOrAbove) / (1 + n), actualMean: actual,', replace: '  return { p: atOrAbove / n, actualMean: actual,' },
  { name: 'monthly share from net instead of gross gains', file: MT, find: '  for (const t of trades) if (t.R > 0) { const m = t.session.slice(0, 7); gains[m] = (gains[m] || 0) + t.R; G += t.R; }', replace: '  for (const t of trades) { const m = t.session.slice(0, 7); gains[m] = (gains[m] || 0) + t.R; G += t.R; }' },
  { name: 'pick tie at 0.02 R not counted as a tie', file: MT, find: '  const tied = candidates.filter((v) => top - u(v.pooled.meanR) <= u(TIE_R));', replace: '  const tied = candidates.filter((v) => top - u(v.pooled.meanR) < u(TIE_R));' },
  { name: 'a candidate needs only one instrument', file: MT, find: 'Object.values(perInstrument).every((m) => m.criteria.pass);', replace: 'Object.values(perInstrument).some((m) => m.criteria.pass);' },
  { name: 'maximum drawdown measured from zero only', file: MT, find: '  for (const r of rs) { cum += r; if (cum > peak) peak = cum; if (peak - cum > maxDrawdown) maxDrawdown = peak - cum; }', replace: '  for (const r of rs) { cum += r; if (peak - cum > maxDrawdown) maxDrawdown = peak - cum; }' },
  // store.js and data.js: the bar bound and the session filter
  { name: 'bar bound: a late 5-minute batch stored', file: ST, find: "  for (const r of rows) assertWithinBound(r.session, `a 5-minute bar of ${symbol}`);\n", replace: '' },
  { name: 'bar bound: loads not filtered in SQL', file: ST, find: "  return db.prepare('SELECT session, idx, ts, hhmm, o, h, l, c, v, n, vw FROM sb_bars_5m WHERE version_id = ? AND symbol = ? AND session >= ? AND session <= ? AND session <= ? ORDER BY session, idx')\n    .all(versionId, symbol, from, end, MAX_BAR_DATE);", replace: "  return db.prepare('SELECT session, idx, ts, hhmm, o, h, l, c, v, n, vw FROM sb_bars_5m WHERE version_id = ? AND symbol = ? AND session >= ? AND session <= ? ORDER BY session, idx')\n    .all(versionId, symbol, from, to);" },
  { name: 'session filter keeps extended-hours bars', file: DT, find: '    if (b.minutes < info.openMin || b.minutes >= info.closeMin) { dropped.outsideSession++; continue; }\n', replace: '' },
  { name: 'session filter keeps misaligned timestamps', file: DT, find: '    if (b.second !== 0 || b.minutes % BAR_MINUTES !== 0) { dropped.misaligned++; continue; }\n', replace: '' },
  { name: 'loadInputs without the bound assertion', file: DT, find: "  store.assertWithinBound(to, 'the requested input end');\n", replace: '' },
  // config.js and service.js: the gate
  { name: 'log entries inside code fences and comments read', file: CF, find: "export const visibleText = (text) => String(text).replace(/```[\\s\\S]*?```/g, '').replace(/<!--[\\s\\S]*?-->/g, '');", replace: 'export const visibleText = (text) => String(text);' },
  { name: 'the code-frozen entry accepted for any code revision', file: CF, find: '  const good = frozenEntries.filter((e) => namesRevision(text(e), revision) && text(e).includes(preregCommit) && hashIn(text(e)));', replace: '  const good = frozenEntries.filter((e) => text(e).includes(preregCommit) && hashIn(text(e)));' },
  { name: 'gate: the code-frozen entry not required', file: SV, find: '        const frozenOk = !!ls.frozen && !!version && ls.frozen.dataHash === version.dataHash;', replace: '        const frozenOk = true;' },
  { name: 'gate: an already-run variant allowed again', file: SV, find: "      add('variant-not-run', !done.length,", replace: "      add('variant-not-run', true," },
  { name: 'gate: the rule-sheet pins not checked', file: SV, find: "    add('rule-sheet-pins', !pinProblems.length,", replace: "    add('rule-sheet-pins', true," },
  { name: 'gate: an unlogged run tolerated', file: SV, find: "          else if (!logged.has(r.id)) logProblems.push(`run ${r.id} (${r.variant}, ${r.status}) has no log entry`);\n", replace: '' },
  { name: 'gate: bars after the bound ignored', file: SV, find: "        add('bar-bound', after && after.bars5m === 0 && after.bars1d === 0 && (!maxDate || maxDate <= MAX_BAR_DATE),", replace: "        add('bar-bound', true," },
  { name: 'launcher: --run without --confirm-run runs', file: LN, find: "  if (!o.confirm) { io.log('--run without --confirm-run: refused by the launcher; nothing was run.'); out.refusedBy = 'launcher'; out.exitCode = 2; return out; }", replace: "  if (false) { io.log('--run without --confirm-run: refused by the launcher; nothing was run.'); out.refusedBy = 'launcher'; out.exitCode = 2; return out; }" },
  { name: 'launcher: a closed gate not refused by the launcher', file: LN, find: "  if (!gate.ok) { io.log('Refused by the launcher: the gate is closed; nothing was run.'); out.refusedBy = 'launcher'; out.exitCode = 2; return out; }", replace: "  if (false) { io.log('Refused by the launcher: the gate is closed; nothing was run.'); out.refusedBy = 'launcher'; out.exitCode = 2; return out; }" },
];

export function parseArgs(argv) {
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

const copyInto = (wt, rel) => { const src = path.join(ROOT, rel); if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true }); fs.copyFileSync(src, path.join(wt, rel)); } };

export function runPlanted({ ref = 'HEAD', workingTree = false, only = null, keep = false, timeoutMs = DEFAULT_TIMEOUT_MS, log = console.log } = {}) {
  const tmpRoot = os.tmpdir();
  const free = freeBytes(tmpRoot);
  log(`free space on the temp volume: ${(free / 1024 ** 3).toFixed(1)} GB`);
  if (free < MIN_FREE_BYTES) throw new Error(`refusing to run: under 1 GB free on ${tmpRoot}`);
  const wt = fs.mkdtempSync(path.join(tmpRoot, 'sb-planted-'));
  const results = [];
  let baseline = null;
  try {
    execFileSync('git', ['-c', 'core.autocrlf=false', 'worktree', 'add', '--detach', wt, ref], { cwd: ROOT, stdio: 'pipe' });
    if (workingTree) {
      for (const f of fs.readdirSync(path.join(ROOT, 'server/sweepbos')).filter((x) => x.endsWith('.js'))) copyInto(wt, `server/sweepbos/${f}`);
      for (const f of fs.readdirSync(path.join(ROOT, 'tests')).filter((x) => /^sweepbos-.*\.js$/.test(x))) copyInto(wt, `tests/${f}`);
      for (const f of fs.readdirSync(path.join(ROOT, 'scripts')).filter((x) => /^sweepbos-.*\.mjs$/.test(x))) copyInto(wt, `scripts/${f}`);
      for (const f of fs.readdirSync(path.join(ROOT, 'strategy/sweep-bos/variants'))) copyInto(wt, `strategy/sweep-bos/variants/${f}`);
      for (const f of ['tests/helpers.js', 'server/hxr/source.js', 'strategy/sweep-bos/PRE-REGISTRATION.md', 'strategy/sweep-bos/PLAN.md', 'strategy/sweep-bos/EXPERIMENT-LOG.md']) copyInto(wt, f);
    }
    const tests = TESTS.filter((t) => fs.existsSync(path.join(wt, t)));
    log(`worktree ${wt} at ${ref}${workingTree ? ' (working-tree files copied)' : ''}; tests: ${tests.join(', ')}`);
    baseline = runTests(wt, tests, timeoutMs);
    log(`baseline: ${baseline.outcome}, ${baseline.passing} passing, ${baseline.failing.length} failing`);
    if (baseline.outcome !== 'completed' || baseline.failing.length || baseline.status !== 0) {
      throw new Error(`baseline not passing (${baseline.outcome}; failing: ${baseline.failing.join('; ') || 'none'}; exit ${baseline.status}): refusing to plant bugs`);
    }
    for (const bug of BUGS) {
      if (only && !bug.name.includes(only)) continue;
      const file = path.join(wt, bug.file);
      if (!fs.existsSync(file)) { results.push({ name: bug.name, status: 'INVALID', detail: `${bug.file} does not exist in the worktree`, failing: [] }); log(`INVALID      | ${bug.name} | file missing`); continue; }
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
