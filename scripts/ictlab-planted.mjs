// ICT Lab planted-bug check (strategy/ict-lab/PROTOCOL.md; Part C). Run manually:
//
//   node scripts/ictlab-planted.mjs [--ref <commit>] [--working-tree] [--only <substring>] [--keep] [--timeout <ms>]
//
// A scratch git worktree of <commit> (default HEAD) is created; --working-tree copies the current, possibly
// uncommitted, ict-lab files into it. First the unmodified tests must pass there (the baseline); otherwise
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
const RU = 'server/ictlab/rules.js', EN = 'server/ictlab/engine.js', MT = 'server/ictlab/metrics.js', ST = 'server/ictlab/store.js', DT = 'server/ictlab/data.js', CF = 'server/ictlab/config.js', SV = 'server/ictlab/service.js', LN = 'scripts/ictlab-run.mjs';
export const TESTS = ['tests/ictlab-config.test.js', 'tests/ictlab-store.test.js', 'tests/ictlab-data.test.js', 'tests/ictlab-rules.test.js', 'tests/ictlab-engine.test.js', 'tests/ictlab-metrics.test.js', 'tests/ictlab-report.test.js', 'tests/ictlab-service.test.js', 'tests/ictlab-launcher.test.js'];
export const MIN_FREE_BYTES = 1024 ** 3;
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// { name, file, find, replace }: `find` must occur exactly once in `file`.
export const BUGS = [
  // Look-ahead (H1, H6, H12)
  { name: 'look-ahead: a swing confirmed at i + 2 instead of i + 3', file: RU, find: 'export const confirmedBy = (indices, k, confirmBarOffset) => indices.filter((i) => i + confirmBarOffset <= k);', replace: 'export const confirmedBy = (indices, k, confirmBarOffset) => indices.filter((i) => i + confirmBarOffset - 1 <= k);' },
  { name: 'look-ahead: the BOS uses a swing confirmed at k, not before it', file: RU, find: '  const usable = confirmedBy(swings, k - 1, swing.confirmBarOffset);', replace: '  const usable = confirmedBy(swings, k, swing.confirmBarOffset);' },
  { name: 'look-ahead: the downward BOS uses a swing confirmed at b', file: RU, find: '  const usable = confirmedBy(swings, b - 1, swing.confirmBarOffset);', replace: '  const usable = confirmedBy(swings, b, swing.confirmBarOffset);' },
  { name: 'look-ahead: a break on the sweep bar itself confirms (H6 k > s)', file: EN, find: '        const bos = k > setup.s ? bosAt(bars, k, swing) : { ok: false };', replace: '        const bos = bosAt(bars, k, swing);' },
  // Swings and sweeps (H1, H4, H5)
  { name: 'equal highs form a swing (>= instead of >)', file: RU, find: '    for (let j = 1; j <= leftBars && ok; j++) if (!(bars[i].h > bars[i - j].h)) ok = false;\n    for (let j = 1; j <= rightBars && ok; j++) if (!(bars[i].h > bars[i + j].h)) ok = false;', replace: '    for (let j = 1; j <= leftBars && ok; j++) if (!(bars[i].h >= bars[i - j].h)) ok = false;\n    for (let j = 1; j <= rightBars && ok; j++) if (!(bars[i].h >= bars[i + j].h)) ok = false;' },
  { name: 'a wick-only bar is a sweep (no close back inside)', file: RU, find: 'export const isSweepBar = (bar, pdl) => bar.l < pdl && bar.c > pdl;', replace: 'export const isSweepBar = (bar, pdl) => bar.l < pdl;' },
  { name: 'a close exactly at PDL counts as inside', file: RU, find: 'export const isSweepBar = (bar, pdl) => bar.l < pdl && bar.c > pdl;', replace: 'export const isSweepBar = (bar, pdl) => bar.l < pdl && bar.c >= pdl;' },
  { name: 'the sweep extreme frozen at the sweep bar', file: RU, find: '  for (let j = s; j <= k; j++) if (bars[j].l <= extreme) { extreme = bars[j].l; lambda = j; }', replace: '  for (let j = s; j <= s; j++) if (bars[j].l <= extreme) { extreme = bars[j].l; lambda = j; }' },
  { name: 'the extreme bar is the earliest at the extreme, not the latest', file: RU, find: '  for (let j = s; j <= k; j++) if (bars[j].l <= extreme) { extreme = bars[j].l; lambda = j; }', replace: '  for (let j = s; j <= k; j++) if (bars[j].l < extreme) { extreme = bars[j].l; lambda = j; }' },
  // Not listed: "the sweep window extended to bar 18". In the pinned specs the sweep window and the decision
  // window both end at bar 17, so the decision loop never reaches bar 18 and such a plant changes nothing; it
  // was planted once (2026-11-04), found unobservable, and removed rather than left as a MISSED.
  // Breaks, gaps, blocks (H6, H9, H10, H11, H12, H13)
  { name: 'BOS on a swing an earlier bar already closed above', file: RU, find: "  for (let j = i + 1; j < k; j++) if (bars[j].c > level) return { ok: false, swingIndex: i, level, reason: 'the swing was already closed above' };\n", replace: '' },
  { name: 'FVG polarity reversed', file: RU, find: "    if (bars[a].h < bars[a + 2].l) return { type: 'fair_value_gap', index: a, lo: bars[a].h, hi: bars[a + 2].l };", replace: "    if (bars[a].l > bars[a + 2].h) return { type: 'fair_value_gap', index: a, lo: bars[a + 2].h, hi: bars[a].l };" },
  { name: 'the latest-gap rule replaced by the earliest', file: RU, find: '  for (let a = k - 2; a >= lambda; a--) {', replace: '  for (let a = lambda; a <= k - 2; a++) {' },
  { name: 'inversion: a close at the upper bound counts as through it', file: RU, find: '    if (v >= gap.index + earliestOffset && bars[v].c > gap.hi) return gap;', replace: '    if (v >= gap.index + earliestOffset && bars[v].c >= gap.hi) return gap;' },
  { name: 'inversion: the close-through tested against the lower bound', file: RU, find: '    if (v >= gap.index + earliestOffset && bars[v].c > gap.hi) return gap;', replace: '    if (v >= gap.index + earliestOffset && bars[v].c > gap.lo) return gap;' },
  { name: 'inversion on the sweep bar itself accepted (H10 v > s)', file: RU, find: '  if (!(v > s)) return null;\n', replace: '' },
  { name: 'order block: a doji accepted as bearish', file: RU, find: "    if (b.c < b.o) return { type: 'order_block', index: j, lo: b.l, hi: b.h };", replace: "    if (b.c <= b.o) return { type: 'order_block', index: j, lo: b.l, hi: b.h };" },
  { name: 'bearish block without a leg (mu = i_L) accepted', file: RU, find: '  if (mu === bos.swingIndex) return null;\n', replace: '' },
  { name: 'bearish block: the earliest bullish bar instead of the latest', file: RU, find: '  for (let j = mu; j >= 0; j--) {\n    const bar = bars[j];', replace: '  for (let j = 0; j <= mu; j++) {\n    const bar = bars[j];' },
  { name: 'breaker: a close at the upper bound is a failure', file: RU, find: 'export const blockFails = (bar, block) => bar.c > block.hi;', replace: 'export const blockFails = (bar, block) => bar.c >= block.hi;' },
  { name: 'breaker: the 6-bar coupling limit ignored', file: RU, find: '      if (Math.max(ev.f, kb) === k && Math.abs(ev.f - kb) <= maxBarsApart) return { f: ev.f, kBos: kb, block: ev.block };', replace: '      if (Math.max(ev.f, kb) === k) return { f: ev.f, kBos: kb, block: ev.block };' },
  { name: 'breaker without k_bos > s (the sweep bar\'s own break counts)', file: EN, find: '        if (k > setup.s && bosAt(bars, k, swing).ok) bosBars.push(k);', replace: '        if (bosAt(bars, k, swing).ok) bosBars.push(k);' },
  { name: 'breaker: every later close above the block is a new failure', file: EN, find: '        if (k > setup.s && block && !failEvents.some((e) => e.block.breakIndex === block.breakIndex) && blockFails(bar, block)) failEvents.push({ f: k, block });', replace: '        if (k > setup.s && block && blockFails(bar, block)) failEvents.push({ f: k, block });' },
  // Zone, entry, stop, target (H14, H15, H17, H18)
  { name: 'the minimum zone height ignored', file: RU, find: 'export const zoneUsable = (zone, minHeightU) => zone.hi - zone.lo >= minHeightU;', replace: 'export const zoneUsable = (zone, minHeightU) => zone.hi - zone.lo > 0;' },
  { name: 'the half cent rounded up', file: RU, find: 'export const entryOf = (lo, hi) => Math.floor((lo + hi) / 2 / CENT) * CENT;', replace: 'export const entryOf = (lo, hi) => Math.ceil((lo + hi) / 2 / CENT) * CENT;' },
  { name: 'an entry equal to the confirmation close accepted', file: EN, find: "      if (!(entry < bar.c)) { refuse('entry_not_below_close', { entry: fromU(entry), close: fromU(bar.c) }); continue; }", replace: "      if (!(entry <= bar.c)) { refuse('entry_not_below_close', { entry: fromU(entry), close: fromU(bar.c) }); continue; }" },
  { name: 'the stop buffer dropped', file: RU, find: 'export const stopFrom = (anchors, bufferU) => Math.min(...anchors) - bufferU;', replace: 'export const stopFrom = (anchors, bufferU) => Math.min(...anchors);' },
  { name: 'the stop beyond the nearer anchor instead of the farther', file: RU, find: 'export const stopFrom = (anchors, bufferU) => Math.min(...anchors) - bufferU;', replace: 'export const stopFrom = (anchors, bufferU) => Math.max(...anchors) - bufferU;' },
  { name: 'the minimum stop distance ignored (0.39 accepted)', file: EN, find: "      if (dist < minDistU) { refuse('stop_too_close', { stopDistance: fromU(dist) }); continue; }", replace: "      if (dist <= 0) { refuse('stop_too_close', { stopDistance: fromU(dist) }); continue; }" },
  { name: 'the target at 1R instead of the spec\'s multiple', file: RU, find: 'export const targetOf = (entry, stopDistance, rMultiple) => entry + Math.round(rMultiple * stopDistance);', replace: 'export const targetOf = (entry, stopDistance, rMultiple) => entry + stopDistance;' },
  // Fills and exits (H15, H16)
  { name: 'the limit filled on a touch', file: RU, find: '  for (let m = k + 1; m <= last; m++) if (bars[m].l < entry) return m;', replace: '  for (let m = k + 1; m <= last; m++) if (bars[m].l <= entry) return m;' },
  { name: 'fills allowed after bar 17', file: EN, find: '    const lastK = Math.min(lastDecision, n - 1), lastFill = Math.min(lastFillSpec, n - 1);', replace: '    const lastK = Math.min(lastDecision, n - 1), lastFill = Math.min(lastFillSpec + 1, n - 1);' },
  { name: 'decisions allowed after bar 17', file: EN, find: '    const lastK = Math.min(lastDecision, n - 1), lastFill = Math.min(lastFillSpec, n - 1);', replace: '    const lastK = Math.min(lastDecision + 1, n - 1), lastFill = Math.min(lastFillSpec, n - 1);' },
  { name: 'the stop not checked on the fill bar', file: RU, find: "  if (bars[m].l <= stop) return { exitIndex: m, exit: stop, kind: 'stop_same_bar' };\n", replace: '' },
  { name: 'the target tested on the fill bar', file: RU, find: "  if (bars[m].l <= stop) return { exitIndex: m, exit: stop, kind: 'stop_same_bar' };\n", replace: "  if (bars[m].l <= stop) return { exitIndex: m, exit: stop, kind: 'stop_same_bar' };\n  if (bars[m].h > target) return { exitIndex: m, exit: target, kind: 'target' };\n" },
  { name: 'the stop not first on an ambiguous bar', file: RU, find: "    if (b.l <= stop) return { exitIndex: q, exit: Math.min(stop, b.o), kind: 'stop' };\n    if (b.h > target) return { exitIndex: q, exit: target, kind: 'target' };", replace: "    if (b.h > target) return { exitIndex: q, exit: target, kind: 'target' };\n    if (b.l <= stop) return { exitIndex: q, exit: Math.min(stop, b.o), kind: 'stop' };" },
  { name: 'a gap through the stop filled at the stop instead of the open', file: RU, find: "    if (b.l <= stop) return { exitIndex: q, exit: Math.min(stop, b.o), kind: 'stop' };", replace: "    if (b.l <= stop) return { exitIndex: q, exit: stop, kind: 'stop' };" },
  { name: 'the time stop at the last close instead of its open', file: RU, find: "  return { exitIndex: n - 1, exit: bars[n - 1].o, kind: 'time' };", replace: "  return { exitIndex: n - 1, exit: bars[n - 1].c, kind: 'time' };" },
  { name: 'the re-arm disabled: a refused confirmation ends the session', file: EN, find: "      if (!zone) { refuse('no_zone'); continue; }", replace: "      if (!zone) { refuse('no_zone'); break; }" },
  { name: 'one filled trade per session not enforced: a later confirmation replaces the order', file: EN, find: '      rec.orderPlaced = true;\n      break;', replace: '      rec.orderPlaced = true;' },
  { name: 'incomplete sessions traded', file: EN, find: "    if (!complete) return end('incomplete', { bars: n, full });", replace: "    if (!complete && false) return end('incomplete', { bars: n, full });" },
  { name: 'an incomplete prior session accepted', file: EN, find: "    if (!prev || prev.date !== prevDate || !prev.complete || prev.dailyL == null) return end('no_prior_session', { prevDate });", replace: "    if (!prev || prev.date !== prevDate || prev.dailyL == null) return end('no_prior_session', { prevDate });" },
  { name: 'sessions before the window decided', file: EN, find: '    if (!inWindow) return null;', replace: '    if (false && !inWindow) return null;' },
  // Sizing and costs (H19, H20)
  { name: 'costs omitted from R', file: RU, find: 'export const rOf = (entry, exit, stopDistance, cU) => ((exit - cU) - (entry + cU)) / stopDistance;', replace: 'export const rOf = (entry, exit, stopDistance, cU) => (exit - entry) / stopDistance;' },
  { name: 'costs omitted from the cash', file: RU, find: 'export const pnlCents = (shares, entryCents, exitCents, perSideCents) => shares * (exitCents - entryCents - 2 * perSideCents);', replace: 'export const pnlCents = (shares, entryCents, exitCents, perSideCents) => shares * (exitCents - entryCents);' },
  { name: 'the cash cap ignoring costs', file: RU, find: '  const estimatedCostsCents = 2 * perSideCents * Math.floor(cashCents / entryCents);', replace: '  const estimatedCostsCents = 0;' },
  { name: 'the risk term rounded instead of floored', file: RU, find: '  const sharesRisk = Math.floor((cashCents * num) / (den * stopDistanceCents));', replace: '  const sharesRisk = Math.round((cashCents * num) / (den * stopDistanceCents));' },
  { name: 'unfunded trades not skipped', file: RU, find: '    shares, sharesRisk, sharesCash, estimatedCostsCents, unfunded: shares <= 0, cashCapped: shares > 0 && sharesCash < sharesRisk,', replace: '    shares, sharesRisk, sharesCash, estimatedCostsCents, unfunded: false, cashCapped: shares > 0 && sharesCash < sharesRisk,' },
  { name: 'the cash_capped flag never set', file: RU, find: '    shares, sharesRisk, sharesCash, estimatedCostsCents, unfunded: shares <= 0, cashCapped: shares > 0 && sharesCash < sharesRisk,', replace: '    shares, sharesRisk, sharesCash, estimatedCostsCents, unfunded: shares <= 0, cashCapped: false,' },
  { name: 'a loss beyond the planned risk never counted', file: EN, find: '    const lossExceededRisk = pnl < -order.size.plannedRiskActualCents;', replace: '    const lossExceededRisk = false;' },
  { name: 'count-only pass: expired orders counted as fills', file: EN, find: '  return { sessions: f.sessions, tradeable: f.tradeable, sweeps: f.sweeps, confirmations: f.confirmed, zones: f.usableZone, orders: f.orders, fills: f.fills };', replace: '  return { sessions: f.sessions, tradeable: f.tradeable, sweeps: f.sweeps, confirmations: f.confirmed, zones: f.usableZone, orders: f.orders, fills: f.orders };' },
  // Statistics (section 9)
  { name: 'the bootstrap without its seed', file: MT, find: '  const rand = mulberry32(seed);\n  const means = new Array(n);', replace: '  const rand = Math.random;\n  const means = new Array(n);' },
  { name: 'the null without its seed', file: MT, find: '  const rand = mulberry32(seed);\n  const sims = new Array(n);', replace: '  const rand = Math.random;\n  const sims = new Array(n);' },
  { name: 'the null p without the +1 correction', file: MT, find: '  return { p: (1 + atOrAbove) / (1 + n), actualMean: actual,', replace: '  return { p: atOrAbove / n, actualMean: actual,' },
  { name: 'the null pseudo-trade targets 1R instead of the spec\'s multiple', file: MT, find: '      const ex = simulateExit(bars, m, O - D, O + Math.round(rMultiple * D));', replace: '      const ex = simulateExit(bars, m, O - D, O + D);' },
  { name: 'the null pseudo-trades without costs', file: MT, find: '      sum += rOf(O, ex.exit, D, cU);', replace: '      sum += rOf(O, ex.exit, D, 0);' },
  { name: 'alpha 0.05 instead of 0.05 / 24', file: MT, find: 'export const ALPHA = 0.05 / TEST_BUDGET;', replace: 'export const ALPHA = 0.05;' },
  { name: 'the validation C1 at 100 instead of 40', file: MT, find: "export const MIN_TRADES = Object.freeze({ development: 100, validation: 40 });", replace: "export const MIN_TRADES = Object.freeze({ development: 100, validation: 100 });" },
  { name: 'best-5% K by floor', file: MT, find: '  const K = Math.max(1, Math.ceil(BEST_FRACTION * n));', replace: '  const K = Math.max(1, Math.floor(BEST_FRACTION * n));' },
  { name: 'the monthly share from net instead of gross gains', file: MT, find: '  for (const t of trades) if (t.R > 0) { const m = t.session.slice(0, 7); gains[m] = (gains[m] || 0) + t.R; G += t.R; }', replace: '  for (const t of trades) { const m = t.session.slice(0, 7); gains[m] = (gains[m] || 0) + t.R; G += t.R; }' },
  { name: 'C6 strict at 0.40', file: MT, find: 'pass: m.monthShares.maxShare != null && m.monthShares.maxShare <= MAX_MONTH_SHARE },', replace: 'pass: m.monthShares.maxShare != null && m.monthShares.maxShare < MAX_MONTH_SHARE },' },
  { name: 'maximum drawdown measured from zero only', file: MT, find: '  for (const r of rs) { cum += r; if (cum > peak) peak = cum; if (peak - cum > maxDrawdown) maxDrawdown = peak - cum; }', replace: '  for (const r of rs) { cum += r; if (peak - cum > maxDrawdown) maxDrawdown = peak - cum; }' },
  // The store and the data layer (the bound, the guard, the ledger, the settings, the lock)
  { name: 'bar bound: a late 5-minute batch stored', file: ST, find: "  for (const r of rows) assertWithinBound(r.session, `a 5-minute bar of ${symbol}`);\n", replace: '' },
  { name: 'bar bound: loads not filtered in SQL', file: ST, find: "  return db.prepare('SELECT session, idx, ts, hhmm, o, h, l, c, v, n, vw FROM il_bars_5m WHERE version_id = ? AND symbol = ? AND session >= ? AND session <= ? AND session <= ? ORDER BY session, idx')\n    .all(versionId, symbol, from, end, MAX_BAR_DATE);", replace: "  return db.prepare('SELECT session, idx, ts, hhmm, o, h, l, c, v, n, vw FROM il_bars_5m WHERE version_id = ? AND symbol = ? AND session >= ? AND session <= ? ORDER BY session, idx')\n    .all(versionId, symbol, from, to);" },
  { name: 'the ledger deletable', file: ST, find: "  CREATE TRIGGER il_ledger_no_delete BEFORE DELETE ON il_ledger BEGIN SELECT RAISE(ABORT, 'il_ledger is append-only'); END;\n", replace: '' },
  { name: 'the settings updatable', file: ST, find: "  CREATE TRIGGER il_settings_no_update BEFORE UPDATE ON il_settings BEGIN SELECT RAISE(ABORT, 'il_settings is write-once'); END;\n", replace: '' },
  { name: 'the lock released by anyone', file: ST, find: "  return tx(db, () => db.prepare('DELETE FROM il_lock WHERE id = 1 AND pid = ? AND token = ?').run(lock.pid, lock.token).changes > 0);", replace: "  return tx(db, () => db.prepare('DELETE FROM il_lock WHERE id = 1').run().changes > 0);" },
  { name: 'the file guard lets sweep-bos files through', file: ST, find: " || n.startsWith('range-trend') || n.startsWith('sweep-bos');", replace: " || n.startsWith('range-trend');" },
  { name: 'session filter keeps extended-hours bars', file: DT, find: '    if (b.minutes < info.openMin || b.minutes >= info.closeMin) { dropped.outsideSession++; continue; }\n', replace: '' },
  { name: 'session filter keeps misaligned timestamps', file: DT, find: '    if (b.second !== 0 || b.minutes % BAR_MINUTES !== 0) { dropped.misaligned++; continue; }\n', replace: '' },
  { name: 'loadInputs without the bound assertion', file: DT, find: "  store.assertWithinBound(to, 'the requested input end');\n", replace: '' },
  { name: 'the download accepts a second instrument', file: DT, find: "  if (symbols.some((s) => s !== INSTRUMENT)) throw new Error(`the ICT Lab downloads ${INSTRUMENT} only (PROTOCOL.md section 5)`);\n", replace: '' },
  { name: 'the comparison opens any database file', file: DT, find: "  if (!/^sweep-bos/i.test(path.basename(real))) throw new Error('the comparison reads only a sweep-bos database file');\n", replace: '' },
  // The configuration, the gate and the launcher (section 10)
  { name: 'validateSpec: an unknown field accepted', file: CF, find: '  for (const key of Object.keys(spec)) if (!(key in schema)) e.push(`${key} is not a known field`);\n', replace: '' },
  { name: 'the reserved window given a code path', file: CF, find: '  if (!RUNNABLE_WINDOWS.includes(name)) throw new Error(', replace: '  if (!WINDOWS[name]) throw new Error(' },
  { name: 'log entries inside code fences and comments read', file: CF, find: "export const visibleText = (text) => String(text).replace(/```[\\s\\S]*?```/g, '').replace(/<!--[\\s\\S]*?-->/g, '');", replace: 'export const visibleText = (text) => String(text);' },
  { name: 'the code-frozen entry accepted for any code revision', file: CF, find: '  const good = frozenEntries.filter((e) => namesRevision(text(e), revision) && text(e).includes(preregCommit) && hashIn(text(e)));', replace: '  const good = frozenEntries.filter((e) => text(e).includes(preregCommit) && hashIn(text(e)));' },
  { name: 'the validation row accepted without the owner\'s quoted message', file: CF, find: '    const quoted = /^\\s*>\\s*\\S/m.test(v.body);', replace: '    const quoted = true;' },
  { name: 'the pre-registration commit accepted without the pinned file hashes', file: CF, find: '    if (textSha256(committed) !== want && textSha256(`${committed}\\n`) !== want) return { ok: false, detail: `the committed ${name} does not have the pinned SHA-256` };\n', replace: '' },
  { name: 'gate: the validation window readable without the owner\'s row', file: SV, find: "        if (window === 'validation') add('validation-authorized', 7, ls.validation.authorized,", replace: "        if (window === 'validation') add('validation-authorized', 7, true," },
  { name: 'gate: the code-frozen entry not required', file: SV, find: '        const frozenOk = !!ls.frozen && !!version && ls.frozen.dataHash === version.dataHash;', replace: '        const frozenOk = true;' },
  { name: 'gate: an already-run spec allowed again without a reason', file: SV, find: "      else add('spec-not-run', 4, false,", replace: "      else add('spec-not-run', 4, true," },
  { name: 'gate: the pins not checked', file: SV, find: "    add('pins', 1, !pinProblems.length,", replace: "    add('pins', 1, true," },
  { name: 'gate: an unlogged run tolerated', file: SV, find: "          else if (!logged.has(r.id)) logProblems.push(`run ${r.id} (${r.spec}, ${r.window}, ${r.status}) has no log entry`);\n", replace: '' },
  { name: 'gate: bars after the bound ignored', file: SV, find: "        add('bar-bound', 2, after && after.bars5m === 0 && after.bars1d === 0 && (!maxDate || maxDate <= MAX_BAR_DATE),", replace: "        add('bar-bound', 2, true," },
  { name: 'gate: the temp folder not checked', file: SV, find: "    add('temp-clean', 9, !temp.length,", replace: "    add('temp-clean', 9, true," },
  { name: 'gate: the data version\'s window coverage not checked', file: SV, find: "          if (win && (version.from > win.start || version.to < win.end)) problems.push(", replace: "          if (false) problems.push(" },
  { name: 'gate: the lock not checked', file: SV, find: "        add('lock', 6, !lock || !alive(lock.pid),", replace: "        add('lock', 6, true," },
  { name: 'a repeat not marked', file: SV, find: '      const repeat = existing.length > 0 && !!reason;', replace: '      const repeat = false;' },
  { name: 'count-only pass: the gate not checked', file: SV, find: "    const gate = gateStatus({ specFile, window, round });\n    if (!gate.ok) throw new GateError(gate.conditions);\n    const win = windowOf(window);\n    const name = path.basename(specFile);\n    const spec = load(name);\n    const db = openDb(true);", replace: "    const win = windowOf(window);\n    const name = path.basename(specFile);\n    const spec = load(name);\n    const db = openDb(true);" },
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
  const wt = fs.mkdtempSync(path.join(tmpRoot, 'il-planted-'));
  const results = [];
  let baseline = null;
  try {
    execFileSync('git', ['-c', 'core.autocrlf=false', 'worktree', 'add', '--detach', wt, ref], { cwd: ROOT, stdio: 'pipe' });
    if (workingTree) {
      for (const f of fs.readdirSync(path.join(ROOT, 'server/ictlab')).filter((x) => x.endsWith('.js'))) copyInto(wt, `server/ictlab/${f}`);
      for (const f of fs.readdirSync(path.join(ROOT, 'tests')).filter((x) => /^ictlab-.*\.js$/.test(x))) copyInto(wt, `tests/${f}`);
      for (const f of fs.readdirSync(path.join(ROOT, 'scripts')).filter((x) => /^ictlab-.*\.mjs$/.test(x))) copyInto(wt, `scripts/${f}`);
      for (const f of fs.readdirSync(path.join(ROOT, 'strategy/ict-lab/specs'))) copyInto(wt, `strategy/ict-lab/specs/${f}`);
      for (const f of ['tests/helpers.js', 'server/hxr/source.js', 'strategy/ict-lab/PROTOCOL.md', 'strategy/ict-lab/CONCEPTS.md', 'strategy/ict-lab/EXPERIMENT-LOG.md']) copyInto(wt, f);
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
