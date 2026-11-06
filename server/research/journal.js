// Prospective journal 1 (strategy/research-runner/PROSPECTIVE-1.md): a hand-run, signal-only forward journal of
// M1 n=3 with controls B0 and M0 on basket A, on the stateful engine rr-mech-2. A simulation only: no capital, no
// broker, no order, no notification, no scheduled job; the owner runs `npm run pj:update` after the close.
//
// Two accounts per rule, each an rr-mech-2 engine restored from its last stored state at every update:
//   primary        a session recorded after the next open is late: its entries are skipped (late_veto) and its
//                  exits are held until the record is stamped, then fill at the first open after recorded_at;
//                  later signals and sizes come from this account's actual simulated state. The sample.
//   reconstructed  every session as if recorded on time: the retrospective reconstruction, labelled, never
//                  counted toward the sample.
// Every record is append-only (journal-store.js); recorded_at is stamped after the fetch and the processing,
// immediately before the write, and a session marked on time is refused if the stamp crossed its next open. Every
// update re-checks the pinned files' hashes and replays every stored session from the warm-up start to confirm
// the stored states. Aggregate performance is never computed before the review date (status() shows none).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig as loadAppConfig } from '../config.js';
import { canonicalJson } from '../strategy/config.js';
import * as hxrStore from '../hxr/store.js';
import { loadHxrUniverse, loadHxrPeriods, basketSymbols, excludedDates, halfSpreadFor } from '../hxr/config.js';
import { buildSpreadTable, halfSpreadFn } from '../hxr/data.js';
import { createHxrSource, BAR_FINAL_AFTER_CLOSE_MIN } from '../hxr/source.js';
import { isTradingDay, nextTradingDay, previousTradingDay, regularSessionBounds } from '../calendar.js';
import { tradingDays } from '../strategy/sessions.js';
import { todayIn, NY, addDays, zonedParts } from '../time.js';
import { createMechanismEngine2, MECHANISM_ENGINE_VERSION_2 } from './mechanisms-2.js';
import { validateMechanismConfig, mechanismConfigHash } from './mechanisms.js';
import { createJournalDownloader } from './journal-download.js';
import * as store from './journal-store.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const JOURNAL_ID = 'prospective-1';
export const JOURNAL_CODE_REVISION = 'pj-code-2026-11-06-1';
export const REVIEW_DATE = '2027-11-05';
export const FORWARD_FROM = '2026-10-23';            // the first session the journal downloads
export const LAST_STORED_HXR = '2026-10-22';         // the last session copied from hxr-sim.sqlite (after the closed windows)
export const CLOSED_WINDOWS = Object.freeze([
  { key: 'final', name: "HXR's final period / the range-trend reserve", from: '2024-01-02', to: '2026-10-21', symbols: null },
  { key: 'labMU', name: 'the Strategy Lab MU holdout', from: '2025-01-01', to: '2026-06-30', symbols: ['MU'] },
]);
export const WARMUP_SESSIONS = 200;
export const MIN_COMPLETED = 30;
export const NULL_SPEC = Object.freeze({ resamples: 20000, seed: 20271105 });
export const CALIBRATION_SHA = 'e80c8ea1423b9d1f013b513d8ba37ed8943a501e74c813c0d665f57dbc93f371';
export const SPEC_FILE = 'strategy/research-runner/PROSPECTIVE-1.md';
export const ACTIVATION_FILE = 'strategy/research-runner/prospective-1/ACTIVATION.json';
export const RULES_DIR = 'strategy/research-runner/prospective-1/rules';
export const SCAN_RATIOS = [2, 3, 4, 5, 10, 20];
export const RULES = Object.freeze([
  { name: 'M1', role: 'named rule', experiment: 191, file: 'm1.json', storedConfigHash: 'a0c21dc7e99b694f3ca2319d3edede44b4021af7a2c47e027624adb05c64d80e', ruleHash: '9cfafe1e994e441cc13786790e3ac2fed4d4b90e046895f97cf8d1611ce15442' },
  { name: 'B0', role: 'control', experiment: 180, file: 'b0.json', storedConfigHash: '8602d82b6f8f00cf949150cc9ac9f7358f6e24b8bc3566cc230779b7ca9b420b', ruleHash: '7503f921d1013f2c71c0497c6013a2c23dd2dd9d9e5c28058b3b36177ddca3e9' },
  { name: 'M0', role: 'control', experiment: 190, file: 'm0.json', storedConfigHash: '2a14be86d5e9fc6a092211ab7850e61539d36e7d43bb3c0ee1d65aa96b41a632', ruleHash: 'dffa891fd4b4a812fbbe73043f7bc47760e89cca81bcb5aa5022c7c0c197a7fb' },
]);
const LEDGERS = ['primary', 'reconstructed'];

// Every file that affects a decision, a fill or the data (pinned in ACTIVATION.json and checked at every update),
// and the review-only files.
export const PINNED_FILES = Object.freeze([
  ['server/research/mechanisms-2.js', 'engine rr-mech-2: signals, exits, sizing, fills, splits, dividends, the veto and held exits'],
  ['server/research/mechanisms.js', 'rr-mech-1, unchanged: config validation, config hash and indicators imported by rr-mech-2'],
  ['server/rangetrend/engine.js', 'sizeEntry (sizing at the decision close)'],
  ['server/rangetrend/levels.js', 'EPS used by sizeEntry'],
  ['server/rangetrend/config.js', 'loaded by server/rangetrend/engine.js'],
  ['server/hxr/engine.js', 'sellFees (SEC and TAF fees)'],
  ['server/strategy/config.js', 'canonicalJson (config hashes)'],
  ['server/calendar.js', 'the NYSE calendar and session bounds (opens, closes)'],
  ['server/time.js', 'time-zone arithmetic'],
  ['server/strategy/sessions.js', 'tradingDays (session lists)'],
  ['server/hxr/data.js', 'buildSpreadTable and halfSpreadFn (the frozen half-spread at each fill)'],
  ['server/hxr/config.js', 'halfSpreadFor, basketSymbols, excludedDates'],
  ['server/hxr/store.js', 'read-only reads of hxr-sim.sqlite at activation'],
  ['server/hxr/source.js', 'the Alpaca client (data.alpaca.markets only, redirects refused), BAR_FINAL_AFTER_CLOSE_MIN'],
  ['server/providers/http.js', 'HTTP helper used by the Alpaca client'],
  ['server/config.js', 'redact and the .env reader used by the Alpaca client'],
  ['strategy/hxr/universe-hxr-v3.json', 'basket A, listings'],
  ['strategy/hxr/periods-hxr-v3.json', 'excluded sessions'],
  ['server/research/journal.js', 'the journal: activation, timeliness, the two accounts, release of held exits, replay, review'],
  ['server/research/journal-store.js', 'the journal database: append-only tables, session order, start refusal'],
  ['server/research/journal-download.js', 'the bounded downloader (basket A, from 2026-10-23)'],
  ['scripts/journal.mjs', 'the command line the owner runs'],
  ['strategy/research-runner/prospective-1/rules/m1.json', 'rule M1 n=3 (experiment 191, period removed)'],
  ['strategy/research-runner/prospective-1/rules/b0.json', 'control B0 (experiment 180, period removed)'],
  ['strategy/research-runner/prospective-1/rules/m0.json', 'control M0 (experiment 190, period removed)'],
  ['server/research/runner.js', 'review only: nullTest'],
  ['server/rangetrend/metrics.js', 'review only: metrics and the exposure-matched hold'],
  ['server/rangetrend/benchmark.js', 'review only: the equal-weight index'],
].map(([p, role]) => Object.freeze({ path: p, role })));

export class JournalError extends Error { constructor(status, message) { super(message); this.status = status; } }

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const lfSha = (text) => sha(String(text).replace(/\r\n/g, '\n'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const etDate = (date) => zonedParts(date, NY).date;

// ---------- calendar helpers (America/New_York, NYSE) ----------
export function sessionBounds(d) { const b = regularSessionBounds(d, 'NYSE'); if (!b) throw new Error(`${d} is not an NYSE session`); return b; }
export function firstSessionDatedAfter(date, excluded = new Set()) { let d = nextTradingDay(date, 'NYSE'); while (excluded.has(d)) d = nextTradingDay(d, 'NYSE'); return d; }
export function nextSessionOf(d, excluded = new Set()) { return firstSessionDatedAfter(d, excluded); }
export function nextOpenOf(d, excluded = new Set()) { return sessionBounds(nextSessionOf(d, excluded)).open; }
export function firstSessionOpenAfter(t, excluded = new Set()) {
  let d = todayIn(NY, t);
  for (let i = 0; i < 20; i++, d = addDays(d, 1)) if (isTradingDay(d, 'NYSE') && !excluded.has(d) && sessionBounds(d).open.getTime() > t.getTime()) return d;
  throw new Error('no NYSE session found in the next 20 days');
}
export function latestCompleteSession(now) {
  let d = todayIn(NY, now);
  if (!isTradingDay(d, 'NYSE')) d = previousTradingDay(d, 'NYSE');
  while (now.getTime() < sessionBounds(d).close.getTime() + BAR_FINAL_AFTER_CLOSE_MIN * 60000) d = previousTradingDay(d, 'NYSE');
  return d;
}
export function sessionsBack(start, n, excluded = new Set()) {
  const list = tradingDays(addDays(start, -Math.ceil(n * 1.6) - 30), addDays(start, -1), 'NYSE').filter((d) => !excluded.has(d) && d < start);
  if (list.length < n) throw new Error(`fewer than ${n} sessions before ${start}`);
  return list[list.length - n];
}
// The start: the first NYSE session dated after the activation commit's America/New_York date.
export function startFromCommitDate(committedAtIso, excluded = new Set()) { return firstSessionDatedAfter(etDate(new Date(committedAtIso)), excluded); }

// ---------- the rules ----------
export function loadRule(root, rulesDir, r) {
  const file = path.join(root, rulesDir, r.file);
  const rule = JSON.parse(fs.readFileSync(file, 'utf8'));
  if ('period' in rule) throw new JournalError(500, `${r.file} must not carry a period (the period is set at activation)`);
  const ruleHash = mechanismConfigHash(rule);
  if (ruleHash !== r.ruleHash) throw new JournalError(409, `${r.file}: rule hash ${ruleHash} differs from experiment ${r.experiment}'s ${r.ruleHash}`);
  return rule;
}
export const configFor = (rule, period) => ({ ...rule, period: { ...period } });

// ---------- the days (the engine input), from the bars and actions as received ----------
// The same conventions as server/hxr/data.js buildInputs: a split or dividend whose ex-date is not a session
// applies on the next session; ratio = new / old; a dividend's pay date defaults to its ex-date; within a day,
// the basket order and then the id.
export function buildDays({ sessions, symbols, bars, actions }) {
  const days = new Map(sessions.map((d) => [d, { bars: {}, splits: [], dividends: [] }]));
  const listed = new Map(symbols.map((s) => [s.symbol, s.listedFrom]));
  const orderOf = new Map(symbols.map((s, i) => [s.symbol, i]));
  const onOrAfter = (date) => { let lo = 0, hi = sessions.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sessions[mid] < date) lo = mid + 1; else hi = mid; } return lo < sessions.length ? sessions[lo] : null; };
  for (const b of bars) {
    if (b.late) continue;
    const day = days.get(b.date);
    if (!day || !listed.has(b.symbol) || b.date < listed.get(b.symbol)) continue;
    day.bars[b.symbol] = { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? null, vw15: null };
  }
  const splitSeen = new Map(), divSeen = new Set();
  for (const a of actions) {
    if (a.late || !listed.has(a.symbol) || !a.ex_date || a.ex_date < listed.get(a.symbol) || a.ex_date < sessions[0] || a.ex_date > sessions.at(-1)) continue;
    const d = onOrAfter(a.ex_date);
    if (!d) continue;
    if (a.type === 'forward_split' || a.type === 'reverse_split') {
      const ratio = a.ratio_new / a.ratio_old;
      if (!Number.isFinite(ratio) || !(ratio > 0) || ratio === 1) continue;
      const key = `${a.symbol}:${a.ex_date}`, same = splitSeen.get(key);
      if (same != null) { if (Math.abs(same - ratio) > 1e-12) throw new Error(`${a.symbol}: two different splits on ${a.ex_date}`); continue; }
      splitSeen.set(key, ratio);
      days.get(d).splits.push({ symbol: a.symbol, ratio, id: a.id, ...(d !== a.ex_date ? { declaredExDate: a.ex_date } : {}) });
    } else if (a.type === 'cash_dividend') {
      if (divSeen.has(a.id) || !(Number.isFinite(a.rate) && a.rate > 0)) continue;
      divSeen.add(a.id);
      days.get(d).dividends.push({ symbol: a.symbol, exDate: d, payDate: a.pay_date || a.ex_date, amount: a.rate, id: a.id, ...(d !== a.ex_date ? { declaredExDate: a.ex_date } : {}) });
    }
  }
  const byOrder = (x, y) => orderOf.get(x.symbol) - orderOf.get(y.symbol) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  for (const day of days.values()) { day.splits.sort(byOrder); day.dividends.sort(byOrder); }
  return days;
}
const daySha = (symbols, day) => sha(canonicalJson([symbols.map((s) => { const b = day.bars[s.symbol]; return b ? [b.o, b.h, b.l, b.c, b.v] : null; }), day.splits, day.dividends]));

// ---------- the activation record ----------
export function buildActivationRecord({ root = ROOT, sourceCommit, now = new Date(), rulesDir = RULES_DIR, pinned = PINNED_FILES, excluded = new Set(), specFile = SPEC_FILE, reviewDate = REVIEW_DATE, calibrationSha = CALIBRATION_SHA }) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit || '')) throw new Error('the activation record needs the 40-hex source commit');
  const start = firstSessionDatedAfter(etDate(now), excluded);
  const warmupFrom = sessionsBack(start, WARMUP_SESSIONS, excluded);
  const period = { basket: 'A', warmupFrom, start, end: reviewDate };
  const rules = RULES.map((r) => { const rule = loadRule(root, rulesDir, r); return { name: r.name, role: r.role, experiment: r.experiment, file: `${rulesDir}/${r.file}`, version: rule.version, storedConfigHash: r.storedConfigHash, ruleHash: r.ruleHash, configHash: mechanismConfigHash(configFor(rule, period)) }; });
  return {
    journal: JOURNAL_ID, record: 'activation', codeRevision: JOURNAL_CODE_REVISION, engine: MECHANISM_ENGINE_VERSION_2,
    sourceCommit, preparedAt: now.toISOString(),
    spec: { file: specFile, sha256: lfSha(fs.readFileSync(path.join(root, specFile), 'utf8')) },
    period: { rule: "the start is the first NYSE session dated after the activation commit's America/New_York date; the warm-up starts 200 sessions before it", expectedStart: start, warmupFrom, warmupSessions: WARMUP_SESSIONS, end: reviewDate },
    rules,
    calibration: { sha256: calibrationSha, note: "the frozen campaign-3 calibration (hxr-spread-2, floor 2 bps); forward fills use each stock's last step, the 2026 running median of opening-quote samples dated 2026-01-02 to 2026-09-01, inside HXR's final period (decision D2 (i)); historical modelled costs, not verified execution costs" },
    data: { forwardFrom: FORWARD_FROM, copiedFromHxr: { from: warmupFrom, to: LAST_STORED_HXR, note: 'read once, read-only, from data/hxr-sim.sqlite for indicators only (decision D1 A); never used for a decision, a fill or a result' }, closedWindows: CLOSED_WINDOWS },
    review: { date: reviewDate, minCompletedOnTimeM1: MIN_COMPLETED, null: NULL_SPEC, insufficient: 'figures shown as descriptive results labelled "insufficient sample"; never a qualification' },
    files: pinned.map((f) => ({ path: f.path, role: f.role, sha256: lfSha(fs.readFileSync(path.isAbsolute(f.path) ? f.path : path.join(root, f.path), 'utf8')) })),
  };
}

// ---------- the journal ----------
export function createJournal({ dataDir = null, dbFile = null, root = ROOT, clock = () => new Date(), git = null, sourceFactory = null, hxrFile = null, testOverrides = false, overrides = {} } = {}) {
  const appCfg = loadAppConfig();
  const dir = dataDir ?? appCfg.dataDir;
  const used = [];
  if (dataDir && path.resolve(dataDir) !== path.resolve(appCfg.dataDir)) used.push('dataDir');
  for (const k of ['dbFile', 'hxrFile', 'sourceFactory', 'git']) if ({ dbFile, hxrFile, sourceFactory, git }[k]) used.push(k);
  if (root !== ROOT) used.push('root');
  used.push(...Object.keys(overrides));
  if (used.length && !testOverrides) throw new Error(`createJournal: ${used.join(', ')} can be changed only with testOverrides: true (tests only)`);
  const reviewDate = overrides.reviewDate ?? REVIEW_DATE;
  const forwardFrom = overrides.forwardFrom ?? FORWARD_FROM;
  const lastStoredHxr = overrides.lastStoredHxr ?? LAST_STORED_HXR;
  const activationFile = overrides.activationFile ?? ACTIVATION_FILE;
  const rulesDir = overrides.rulesDir ?? RULES_DIR;
  const pinned = overrides.pinned ?? PINNED_FILES;
  const calibrationSha = overrides.calibrationSha ?? CALIBRATION_SHA;
  const runGit = git ?? ((args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  const file = dbFile ?? store.pjDbFile(dir);
  const db = store.openPjDb(file);
  const hxrPath = hxrFile ?? path.join(dir, hxrStore.HXR_DB_NAME);
  const periods = loadHxrPeriods();
  const excluded = new Set(excludedDates(periods));
  const now0 = () => clock();
  const readRoot = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(root, p), 'utf8');

  // The server clock: the Date header of each Alpaca response, kept to judge timeliness conservatively.
  const serverClock = { serverMs: null, localMs: null };
  const makeSource = () => {
    const wrapped = (base) => async (url, init) => { const r = await base(url, init); const d = r?.headers?.get?.('date'); if (d && Number.isFinite(Date.parse(d))) { serverClock.serverMs = Date.parse(d); serverClock.localMs = clock().getTime(); } return r; };
    if (sourceFactory) return sourceFactory(wrapped);
    const sec = appCfg.secrets || {};
    return createHxrSource({ keyId: sec.ALPACA_API_KEY_ID, secretKey: sec.ALPACA_API_SECRET_KEY, fetchImpl: wrapped(globalThis.fetch), now: clock });
  };

  // ---------- activation ----------
  function readRecord() {
    const p = path.isAbsolute(activationFile) ? activationFile : path.join(root, activationFile);
    if (!fs.existsSync(p)) return { record: null, problem: `${activationFile} does not exist: no activation record` };
    try { return { record: JSON.parse(fs.readFileSync(p, 'utf8')), text: fs.readFileSync(p, 'utf8') }; } catch (e) { return { record: null, problem: `${activationFile} is not valid JSON: ${e.message}` }; }
  }
  function hashProblems(record, { atCommit = false } = {}) {
    const problems = [];
    for (const f of record.files || []) {
      let text = null;
      try { text = readRoot(f.path); } catch { problems.push(`${f.path} is missing`); continue; }
      if (lfSha(text) !== f.sha256) problems.push(`${f.path} differs from its pinned SHA-256`);
      if (atCommit) {
        let committed = null;
        try { committed = runGit(['show', `${record.sourceCommit}:${f.path}`]); } catch { problems.push(`${f.path} is not in the source commit ${record.sourceCommit.slice(0, 12)}`); }
        // git output is trimmed: compare with and without the final newline.
        if (committed != null && lfSha(committed) !== f.sha256 && lfSha(`${committed}\n`) !== f.sha256) problems.push(`${f.path} at the source commit differs from its pin`);
      }
    }
    const pinnedPaths = new Set((record.files || []).map((f) => f.path));
    for (const f of pinned) if (!pinnedPaths.has(f.path)) problems.push(`${f.path} is not pinned in the activation record`);
    return problems;
  }
  function activationStatus() {
    const { record, problem } = readRecord();
    if (!record) return { ok: false, problems: [problem] };
    const problems = [];
    let commit = null, committedAt = null;
    try { const line = runGit(['log', '-1', '--format=%H%x09%cI', '--', activationFile]); [commit, committedAt] = line.split('\t'); } catch { /* not a git repository */ }
    if (!commit) problems.push(`${activationFile} is not committed: the activation commit is the commit that adds it`);
    try { if (runGit(['status', '--porcelain', '--', activationFile])) problems.push(`${activationFile} has uncommitted changes`); } catch { problems.push('git status failed'); }
    if (record.journal !== JOURNAL_ID || record.engine !== MECHANISM_ENGINE_VERSION_2 || record.codeRevision !== JOURNAL_CODE_REVISION) problems.push('the record names another journal, engine or code revision');
    if (!/^[0-9a-f]{40}$/.test(record.sourceCommit || '')) problems.push('the record has no 40-hex source commit');
    else if (commit) { try { runGit(['merge-base', '--is-ancestor', record.sourceCommit, commit]); } catch { problems.push(`the source commit ${record.sourceCommit.slice(0, 12)} is not an ancestor of the activation commit`); } }
    let start = null, warmupFrom = null;
    if (committedAt) {
      start = startFromCommitDate(committedAt, excluded);
      warmupFrom = sessionsBack(start, WARMUP_SESSIONS, excluded);
      if (record.period?.expectedStart !== start) problems.push(`the start derived from the activation commit (${committedAt} -> ${start}) differs from the record's expectedStart ${record.period?.expectedStart}: write and commit a new record`);
      if (record.period?.warmupFrom !== warmupFrom) problems.push(`the record's warmupFrom ${record.period?.warmupFrom} differs from ${warmupFrom}`);
    }
    if (record.period?.end !== reviewDate) problems.push(`the record's end ${record.period?.end} is not the review date ${reviewDate}`);
    if (record.calibration?.sha256 !== calibrationSha) problems.push('the record pins another calibration');
    try { if (lfSha(readRoot(record.spec.file)) !== record.spec.sha256) problems.push(`${record.spec.file} differs from its pinned SHA-256`); } catch { problems.push('the specification is missing'); }
    problems.push(...hashProblems(record, { atCommit: !!record.sourceCommit && /^[0-9a-f]{40}$/.test(record.sourceCommit) }));
    let configs = null;
    try {
      const period = { basket: 'A', warmupFrom: warmupFrom ?? record.period?.warmupFrom, start: start ?? record.period?.expectedStart, end: reviewDate };
      configs = RULES.map((r) => { const rule = loadRule(root, rulesDir, r); const config = configFor(rule, period); const errs = validateMechanismConfig(config); if (errs.length) throw new JournalError(409, `${r.name}: ${errs.join('; ')}`); const pinnedRule = (record.rules || []).find((x) => x.name === r.name); if (!pinnedRule || pinnedRule.ruleHash !== r.ruleHash || pinnedRule.configHash !== mechanismConfigHash(config)) problems.push(`${r.name}: the record's rule or config hash differs`); return { ...r, config, configHash: mechanismConfigHash(config) }; });
    } catch (e) { problems.push(e.message); }
    return { ok: !problems.length, problems, record, activationCommit: commit, committedAt, start, warmupFrom, configs };
  }

  const isActivated = () => store.getMeta(db, 'start') != null;
  const meta = () => store.allMeta(db);
  const currentStatus = () => { const ev = store.listEvents(db, { kinds: ['status'] }).at(-1); return ev ? ev.detail.to : (isActivated() ? 'active' : 'not activated'); };

  function activate({ confirm = false } = {}) {
    if (confirm !== true) throw new JournalError(400, 'activate needs confirm: true');
    if (isActivated()) throw new JournalError(409, 'the journal is already activated');
    const st = activationStatus();
    if (!st.ok) throw new JournalError(409, `the activation record is not valid: ${st.problems.join('; ')}`);
    if (!fs.existsSync(hxrPath)) throw new JournalError(409, `no HXR market data at ${hxrPath}`);
    const realHxr = fs.realpathSync(hxrPath);
    const hdb = hxrStore.openHxrDb(realHxr, { readOnly: true });
    const at = now0().toISOString();
    try {
      const universe = loadHxrUniverse();
      const symbols = basketSymbols(universe, 'A').map((s) => ({ symbol: s.symbol, exchange: s.exchange ?? null, listedFrom: s.listedFrom ?? null, techAi: !!s.techAi }));
      const spread = buildSpreadTable(hdb, universe, { floorBps: 2, toYear: 2021 });
      if (spread.hash !== calibrationSha) throw new JournalError(409, `the stored calibration hashes to ${spread.hash}, not the frozen ${calibrationSha}: the HXR spread samples changed`);
      const to = lastStoredHxr < st.start ? lastStoredHxr : addDays(st.start, -1);
      const bars = [], actions = [], exposure = {};
      for (const s of symbols) {
        const rows = hxrStore.getBars(hdb, s.symbol, { from: st.warmupFrom, to });
        exposure[s.symbol] = { bars: rows.length, from: rows[0]?.date ?? null, to: rows.at(-1)?.date ?? null, windows: Object.fromEntries(CLOSED_WINDOWS.filter((w) => !w.symbols || w.symbols.includes(s.symbol)).map((w) => { const inW = rows.filter((r) => r.date >= w.from && r.date <= w.to); return [w.key, { count: inW.length, from: inW[0]?.date ?? null, to: inW.at(-1)?.date ?? null }]; })) };
        for (const r of rows) {
          const win = CLOSED_WINDOWS.filter((w) => (!w.symbols || w.symbols.includes(s.symbol)) && r.date >= w.from && r.date <= w.to).map((w) => w.name);
          bars.push({ ...r, symbol: s.symbol, source: win.length ? `hxr-sim.sqlite, closed window (${win.join('; ')}): indicator warm-up only` : 'hxr-sim.sqlite, after the closed windows: indicator warm-up only', late: false, receivedAt: at });
        }
        for (const a of hxrStore.listCorporateActions(hdb, { symbol: s.symbol, types: ['forward_split', 'reverse_split', 'cash_dividend'] })) {
          if (a.symbol !== s.symbol || !a.ex_date || a.ex_date < st.warmupFrom || a.ex_date > to) continue;
          actions.push({ id: a.id, symbol: a.symbol, type: a.type, ex_date: a.ex_date, pay_date: a.pay_date, ratio_old: a.ratio_old, ratio_new: a.ratio_new, rate: a.rate, source: 'hxr-sim.sqlite (warm-up window)', late: false, receivedAt: at });
        }
      }
      const configs = st.configs.map((c) => ({ name: c.name, role: c.role, experiment: c.experiment, storedConfigHash: c.storedConfigHash, ruleHash: c.ruleHash, configHash: c.configHash, config: c.config }));
      store.tx(db, () => {
        const updateId = store.insertUpdate(db, { kind: 'activation', status: 'activated', startedAt: at, recordedAt: at, detail: { activationCommit: st.activationCommit, committedAt: st.committedAt } });
        const put = (k, v) => store.setMeta(db, k, v, at);
        put('journal', JOURNAL_ID); put('codeRevision', JOURNAL_CODE_REVISION); put('engine', MECHANISM_ENGINE_VERSION_2);
        put('activationCommit', st.activationCommit); put('activationCommittedAt', st.committedAt); put('sourceCommit', st.record.sourceCommit);
        put('recordSha256', lfSha(readRecord().text)); put('pinnedFiles', st.record.files); put('spec', st.record.spec);
        put('start', st.start); put('warmupFrom', st.warmupFrom); put('reviewDate', reviewDate); put('forwardFrom', forwardFrom);
        put('symbols', symbols); put('rules', configs); put('calibration', { steps: spread.steps, floorBps: spread.floorBps, hash: spread.hash });
        put('exposure', exposure);
        store.insertBars(db, bars.map((b) => ({ ...b, updateId })));
        store.insertActions(db, actions.map((a) => ({ ...a, updateId })));
        store.insertEvents(db, [
          { updateId, kind: 'status', recordedAt: at, detail: { from: 'not activated', to: 'active', reason: 'activation' } },
          { updateId, kind: 'warmup_copy', recordedAt: at, detail: { from: st.warmupFrom, to, bars: bars.length, actions: actions.length, exposure } },
        ]);
      });
      return { activated: true, start: st.start, warmupFrom: st.warmupFrom, reviewDate, activationCommit: st.activationCommit, sourceCommit: st.record.sourceCommit, copied: { bars: bars.length, actions: actions.length, from: st.warmupFrom, to }, exposure };
    } finally { try { hdb.close(); } catch { /* ignore */ } }
  }

  // ---------- engines ----------
  const sessionsList = () => { const m = meta(); return tradingDays(m.warmupFrom, m.reviewDate, 'NYSE').filter((d) => !excluded.has(d)); };
  function enginesFrom(stateOf) {
    const m = meta();
    const calibrated = halfSpreadFn(m.calibration);
    const out = {};
    for (const r of m.rules) {
      const hs = halfSpreadFor(r.config, calibrated);
      out[r.name] = Object.fromEntries(LEDGERS.map((l) => [l, createMechanismEngine2({ config: r.config, symbols: m.symbols, halfSpreadBps: hs, state: stateOf ? stateOf(r.name, l) : null })]));
    }
    return out;
  }
  const storedState = (rule, ledger) => { const s = store.latestState(db, rule, ledger); return s ? JSON.parse(s.snapshot_json) : null; };

  // Rebuilds every engine from the warm-up start over the stored sessions (with their late flags) and releases,
  // and compares the result with the stored states.
  function verifyReplay() {
    if (!isActivated()) return { ok: true, sessions: 0, note: 'not activated' };
    const m = meta();
    const sessions = store.listSessions(db);
    if (!sessions.length) return { ok: true, sessions: 0 };
    const days = buildDays({ sessions: sessionsList(), symbols: m.symbols, bars: store.getBars(db), actions: store.getActions(db) });
    const engines = enginesFrom(null);
    const releases = store.listReleases(db);
    const byUpdate = new Map();
    for (const s of sessions) { if (!byUpdate.has(s.update_id)) byUpdate.set(s.update_id, []); byUpdate.get(s.update_id).push(s); }
    const problems = [];
    for (const [uid, list] of [...byUpdate.entries()].sort((a, b) => a[0] - b[0])) {
      for (const s of list) {
        const day = days.get(s.date);
        if (daySha(m.symbols, day) !== s.bars_sha256) problems.push(`${s.date}: the stored bars no longer hash to what was processed`);
        for (const r of m.rules) { engines[r.name].primary.processSession(s.date, day, { late: s.phase === 'live' && !s.onTime }); engines[r.name].reconstructed.processSession(s.date, day); }
      }
      for (const rel of releases.filter((x) => x.update_id === uid)) for (const r of m.rules) engines[r.name].primary.releaseHeld({ fillAfter: rel.fill_after, at: rel.recorded_at });
    }
    for (const r of m.rules) for (const l of LEDGERS) {
      const st = store.latestState(db, r.name, l);
      const snap = JSON.stringify(engines[r.name][l].snapshot());
      if (!st || sha(snap) !== st.snapshot_sha256 || st.snapshot_sha256 !== sha(st.snapshot_json)) problems.push(`${r.name} ${l}: the replay does not reproduce the stored state`);
    }
    return { ok: !problems.length, sessions: sessions.length, problems };
  }

  // ---------- the update ----------
  function eventsOf(rule, ledger, out, ctx) {
    const ev = [];
    const base = (kind, x, detail) => ({ rule, ledger, date: x.date, kind, symbol: x.symbol ?? null, recordedAt: ctx.recordedAt, onTime: ctx.onTime, detail });
    for (const d of out.decisions) ev.push(base(`decision_${d.action}`, d, d));
    for (const f of out.fills) ev.push(base(`fill_${f.side}`, f, f));
    for (const s of out.skips) ev.push(base('skip', s, s));
    for (const w of out.warnings) ev.push(base('warning', w, w));
    for (const s of out.splits) ev.push(base('split', s, s));
    for (const d of out.dividends) ev.push(base('dividend', d, d));
    for (const t of out.trades) ev.push(base('trade_closed', { date: t.exitDate, symbol: t.symbol }, { tradeId: t.tradeId, entryDecisionDate: t.entryDecisionDate, entryDate: t.entryDate, exitDate: t.exitDate, exitReason: t.exitReason, shares: t.shares, lateExit: !!t.lateExit }));
    return ev;
  }

  async function update() {
    if (!isActivated()) throw new JournalError(409, 'the journal is not activated: run activate first');
    const status = currentStatus();
    if (status !== 'active') throw new JournalError(409, `the journal is ${status}${status === 'paused' ? ': the owner resumes it with a reason (pj:resume)' : ''}`);
    const startedAt = now0();
    const m = meta();
    const record = { files: m.pinnedFiles, sourceCommit: m.sourceCommit };
    const hp = hashProblems(record);
    if (hp.length) {
      store.tx(db, () => { const id = store.insertUpdate(db, { kind: 'update', status: 'refused', startedAt: startedAt.toISOString(), recordedAt: now0().toISOString(), detail: { problems: hp } }); store.insertEvents(db, [{ updateId: id, kind: 'error', recordedAt: now0().toISOString(), detail: { code: 'pinned_file_changed', problems: hp } }]); });
      throw new JournalError(409, `a pinned file changed: ${hp.join('; ')}`);
    }
    const rep = verifyReplay();
    if (!rep.ok) {
      store.tx(db, () => { const id = store.insertUpdate(db, { kind: 'update', status: 'refused', startedAt: startedAt.toISOString(), recordedAt: now0().toISOString(), detail: { problems: rep.problems } }); store.insertEvents(db, [{ updateId: id, kind: 'error', recordedAt: now0().toISOString(), detail: { code: 'integrity', problems: rep.problems } }]); });
      throw new JournalError(500, `integrity check failed: ${rep.problems.join('; ')}`);
    }
    const sessions = sessionsList();
    const last = store.lastSession(db);
    const latest = (() => { const l = latestCompleteSession(startedAt); return l > m.reviewDate ? m.reviewDate : l; })();
    const report = { status: null, startedAt: startedAt.toISOString(), recordedAt: null, start: m.start, reviewDate: m.reviewDate, latestCompleteSession: latest, fetched: {}, processed: [], waiting: null, paused: null, released: [], clock: null, notes: [] };

    // 1. Fetch, bounded: basket A bars and actions from forwardFrom; only dates after what is stored.
    const source = makeSource();
    const dl = createJournalDownloader({ source, symbols: m.symbols.map((s) => s.symbol), forwardFrom: m.forwardFrom });
    const recvAt = () => now0().toISOString();
    const processedThrough = last?.date ?? null;
    const newBars = [], newActions = [], dataEvents = [];
    for (const s of m.symbols) {
      const lastStored = store.lastBarDate(db, s.symbol);
      const from = [m.forwardFrom, lastStored ? addDays(lastStored, 1) : m.forwardFrom].sort().at(-1);
      if (from > latest) { report.fetched[s.symbol] = 0; continue; }
      const rows = await dl.dailyBars(s.symbol, { from, to: latest });
      report.fetched[s.symbol] = rows.length;
      for (const b of rows) {
        const late = !!processedThrough && b.date <= processedThrough;
        newBars.push({ symbol: s.symbol, date: b.date, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, vw: b.vw, source: 'alpaca SIP raw (journal download)', late, receivedAt: recvAt() });
        if (late) dataEvents.push({ kind: 'late_bar', date: b.date, symbol: s.symbol, detail: { note: 'received after its session was processed: kept, never used' } });
      }
    }
    const { handled, unhandled } = await dl.corporateActions();
    const pauseReasons = [];
    for (const a of handled) {
      const known = store.actionById(db, a.id);
      if (known) {
        const same = known.ex_date === a.ex_date && known.pay_date === a.pay_date && known.ratio_old === a.ratio_old && known.ratio_new === a.ratio_new && known.rate === a.rate && known.type === a.type;
        if (!same) dataEvents.push({ kind: 'action_revision', date: a.ex_date, symbol: a.symbol, detail: { id: a.id, stored: { ex: known.ex_date, pay: known.pay_date, rate: known.rate, ratio: [known.ratio_old, known.ratio_new] }, received: { ex: a.ex_date, pay: a.pay_date, rate: a.rate, ratio: [a.ratio_old, a.ratio_new] }, note: 'kept as stored; the revision is recorded' } });
        continue;
      }
      const late = !!processedThrough && a.ex_date <= processedThrough;
      newActions.push({ id: a.id, symbol: a.symbol, type: a.type, ex_date: a.ex_date, pay_date: a.pay_date, ratio_old: a.ratio_old, ratio_new: a.ratio_new, rate: a.rate, source: 'alpaca corporate actions (journal download)', late, receivedAt: recvAt() });
      if (late && a.type !== 'cash_dividend') pauseReasons.push({ code: 'late_split', symbol: a.symbol, date: a.ex_date, id: a.id });
      if (late && a.type === 'cash_dividend') dataEvents.push({ kind: 'late_dividend', date: a.ex_date, symbol: a.symbol, detail: { id: a.id, rate: a.rate, pay: a.pay_date, note: 'its ex-date session was already processed: not applied by the engine; listed at the review' } });
    }
    for (const a of unhandled) if (a.ex_date <= latest && !store.actionById(db, a.id)) pauseReasons.push({ code: 'unhandled_action', symbol: a.symbol, date: a.ex_date, id: a.id, type: a.type });
    const offset = serverClock.serverMs == null ? null : serverClock.serverMs - serverClock.localMs;
    const ahead = offset != null && offset > 0 ? offset : 0;
    report.clock = { serverDate: serverClock.serverMs == null ? null : new Date(serverClock.serverMs).toISOString(), offsetMs: offset, aheadAddedMs: ahead };
    if (offset != null && Math.abs(offset) > 120000) dataEvents.push({ kind: 'clock_check_failed', detail: { offsetMs: offset } });

    // 2. The sessions to process, in order, with their bars as received (stored and new).
    const allBars = [...store.getBars(db), ...newBars.filter((b) => !b.late)];
    const allActions = [...store.getActions(db), ...newActions.filter((a) => !a.late)];
    const days = buildDays({ sessions, symbols: m.symbols, bars: allBars, actions: allActions });
    const todo = sessions.filter((d) => (!processedThrough || d > processedThrough) && d <= latest);
    const engines = enginesFrom(storedState(m.rules[0].name, 'primary') ? storedState : null);
    const done = [];
    const nowEff = new Date(startedAt.getTime() + ahead);
    const prevClose = {};
    // The previous close of each stock (for the split scan): from the stored days before the first todo session.
    if (todo.length) { for (const d of sessions.filter((x) => x < todo[0]).slice(-5)) for (const [sym, b] of Object.entries(days.get(d).bars)) prevClose[sym] = b.c; }
    if (!pauseReasons.length) {
      for (const d of todo) {
        const day = days.get(d);
        const listed = m.symbols.filter((s) => !s.listedFrom || s.listedFrom <= d);
        const missing = listed.filter((s) => !day.bars[s.symbol]).map((s) => s.symbol);
        const live = d >= m.start;
        const nextOpen = nextOpenOf(d, excluded);
        if (missing.length === listed.length) { report.waiting = { session: d, missing, reason: 'no bar has arrived for this session' }; break; }
        if (missing.length && nowEff < nextOpen) { report.waiting = { session: d, missing, until: nextOpen.toISOString(), reason: 'some bars are missing; the session waits for them until its next open' }; break; }
        // The split scan: a close or open near a split ratio of the previous close, with no split recorded, pauses.
        const suspect = [];
        for (const [sym, b] of Object.entries(day.bars)) {
          const pc = prevClose[sym];
          if (pc && !day.splits.some((x) => x.symbol === sym)) for (const k of SCAN_RATIOS) for (const v of [b.c / pc, b.o / pc]) if (Math.abs(v * k - 1) <= 0.03 || Math.abs(v / k - 1) <= 0.03) suspect.push({ symbol: sym, ratio: v, near: k });
        }
        if (suspect.length) { pauseReasons.push({ code: 'suspect_move', date: d, moves: suspect }); break; }
        const late = live && nextOpen.getTime() <= nowEff.getTime();
        const outs = {};
        for (const r of m.rules) outs[r.name] = { primary: engines[r.name].primary.processSession(d, day, live ? { late } : {}), reconstructed: engines[r.name].reconstructed.processSession(d, day) };
        done.push({ d, live, late, nextOpen, missing, outs, barsSha: daySha(m.symbols, day) });
        for (const [sym, b] of Object.entries(day.bars)) prevClose[sym] = b.c;
      }
    }

    // 3. Stamp, check the on-time sessions against the stamp, release held exits, write.
    const recordedAt = new Date(Math.max(startedAt.getTime(), now0().getTime()));
    const eff = new Date(recordedAt.getTime() + ahead);
    report.recordedAt = recordedAt.toISOString();
    const crossed = done.filter((x) => x.live && !x.late && eff.getTime() >= x.nextOpen.getTime());
    // Sessions processed before a pause are recorded; the pause takes effect after them.
    const status2 = crossed.length ? 'aborted' : done.length ? 'recorded' : pauseReasons.length ? 'paused' : report.waiting ? 'waiting' : 'nothing to process';
    const pausing = pauseReasons.length > 0 && status2 !== 'aborted';
    const released = [];
    let fillAfter = null;
    if (status2 === 'recorded' && done.length) {
      const anyHeld = m.rules.some((r) => engines[r.name].primary.held().length);
      if (anyHeld) {
        fillAfter = previousTradingDay(firstSessionOpenAfter(eff, excluded), 'NYSE');
        while (excluded.has(fillAfter)) fillAfter = previousTradingDay(fillAfter, 'NYSE');
        for (const r of m.rules) for (const x of engines[r.name].primary.releaseHeld({ fillAfter, at: recordedAt.toISOString() })) released.push({ rule: r.name, ...x });
      }
    }
    report.released = released;
    const uid = store.tx(db, () => {
      const id = store.insertUpdate(db, { kind: 'update', status: status2, startedAt: startedAt.toISOString(), recordedAt: recordedAt.toISOString(), clockOffsetMs: offset, serverDate: report.clock.serverDate, firstSession: status2 === 'recorded' ? done[0]?.d ?? null : null, lastSession: status2 === 'recorded' ? done.at(-1)?.d ?? null : null, detail: { waiting: report.waiting, pause: pauseReasons, crossed: crossed.map((x) => x.d) } });
      store.insertBars(db, newBars.map((b) => ({ ...b, updateId: id })));
      store.insertActions(db, newActions.map((a) => ({ ...a, updateId: id })));
      const ev = dataEvents.map((e) => ({ ...e, updateId: id, recordedAt: recordedAt.toISOString() }));
      ev.push({ updateId: id, kind: 'data_received', recordedAt: recordedAt.toISOString(), detail: { bars: report.fetched, actions: newActions.length, through: latest } });
      if (report.waiting) ev.push({ updateId: id, kind: 'waiting', date: report.waiting.session, recordedAt: recordedAt.toISOString(), detail: report.waiting });
      if (status2 === 'aborted') ev.push({ updateId: id, kind: 'error', recordedAt: recordedAt.toISOString(), detail: { code: 'crossed_next_open', sessions: crossed.map((x) => x.d), note: 'the record would have been stamped at or after the next open of a session processed as on time: nothing was recorded; run the update again (the session is then late)' } });
      if (pausing) ev.push({ updateId: id, kind: 'status', recordedAt: recordedAt.toISOString(), detail: { from: 'active', to: 'paused', reason: pauseReasons } });
      if (status2 === 'recorded') {
        for (const x of done) {
          const onTime = x.live ? !x.late : null;
          store.insertSession(db, { date: x.d, phase: x.live ? 'live' : 'warmup', updateId: id, recordedAt: recordedAt.toISOString(), nextOpen: x.live ? x.nextOpen.toISOString() : null, onTime, missing: x.missing, barsSha256: x.barsSha });
          if (x.missing.length) ev.push({ updateId: id, kind: 'data_missing', date: x.d, recordedAt: recordedAt.toISOString(), detail: { missing: x.missing } });
          if (x.live) for (const r of m.rules) for (const l of LEDGERS) ev.push(...eventsOf(r.name, l, x.outs[r.name][l], { recordedAt: recordedAt.toISOString(), onTime }).map((e) => ({ ...e, updateId: id })));
        }
        if (fillAfter) store.insertRelease(db, { updateId: id, afterSession: done.at(-1).d, fillAfter, recordedAt: recordedAt.toISOString(), symbols: released });
        for (const r of released) ev.push({ updateId: id, rule: r.rule, ledger: 'primary', date: fillAfter, kind: 'release', symbol: r.symbol, recordedAt: recordedAt.toISOString(), detail: r });
        for (const r of m.rules) for (const l of LEDGERS) { const snap = JSON.stringify(engines[r.name][l].snapshot()); store.insertState(db, { updateId: id, rule: r.name, ledger: l, through: done.at(-1).d, snapshotJson: snap, sha256: sha(snap) }); }
        if (done.at(-1).d === m.reviewDate) ev.push({ updateId: id, kind: 'status', recordedAt: recordedAt.toISOString(), detail: { from: 'active', to: 'complete', reason: 'the review date has been processed' } });
      }
      store.insertEvents(db, ev);
      return id;
    });
    report.status = status2;
    report.updateId = uid;
    report.processed = status2 === 'recorded' ? done.map((x) => ({ session: x.d, phase: x.live ? 'live' : 'warmup', onTime: x.live ? !x.late : null, nextOpen: x.live ? x.nextOpen.toISOString() : null, missing: x.missing })) : [];
    if (pauseReasons.length) report.paused = pauseReasons;
    if (status2 === 'aborted') report.notes.push('the stamp crossed the next open of a session processed as on time: nothing was recorded; run the update again');
    report.signals = status2 === 'recorded' ? operationalOf(done) : [];
    return report;
  }

  // Operational lines of an update (no P/L, no value): decisions, fills with prices, skips, warnings, per rule.
  function operationalOf(done) {
    const lines = [];
    for (const x of done.filter((y) => y.live)) for (const [rule, o] of Object.entries(x.outs)) {
      const p = o.primary;
      for (const d of p.decisions) lines.push({ rule, session: x.d, kind: `decision_${d.action}`, symbol: d.symbol, shares: d.shares ?? null, reason: d.reason ?? null, late: !!d.late });
      for (const f of p.fills) lines.push({ rule, session: x.d, kind: `fill_${f.side}`, symbol: f.symbol, shares: f.shares, price: f.price, lateExit: !!f.lateExit });
      for (const s of p.skips) lines.push({ rule, session: x.d, kind: 'skip', symbol: s.symbol, code: s.code });
      for (const w of p.warnings) lines.push({ rule, session: x.d, kind: 'warning', symbol: w.symbol, code: w.code });
    }
    return lines;
  }

  function resume({ reason } = {}) {
    if (typeof reason !== 'string' || !reason.trim()) throw new JournalError(400, 'resume needs a reason');
    if (currentStatus() !== 'paused') throw new JournalError(409, `the journal is ${currentStatus()}, not paused`);
    const at = now0().toISOString();
    store.tx(db, () => { const id = store.insertUpdate(db, { kind: 'resume', status: 'resumed', startedAt: at, recordedAt: at, detail: { reason: reason.trim() } }); store.insertEvents(db, [{ updateId: id, kind: 'status', recordedAt: at, detail: { from: 'paused', to: 'active', reason: reason.trim() } }]); });
    return { status: 'active' };
  }

  // ---------- status: operational information only (no P/L, value, return, drawdown or comparison) ----------
  function status() {
    if (!isActivated()) return { journal: JOURNAL_ID, status: 'not activated', activation: activationStatus() };
    const m = meta();
    const sessions = store.listSessions(db);
    const live = sessions.filter((s) => s.phase === 'live');
    const lastS = sessions.at(-1) ?? null;
    const ups = store.listUpdates(db);
    const evs = store.listEvents(db);
    const posOf = (rule) => { const st = storedState(rule, 'primary'); if (!st) return { positions: [], pending: [], completedTrades: 0 }; return {
      positions: Object.values(st.stocks).filter((x) => x.position).map((x) => ({ symbol: x.symbol, shares: x.position.shares, entryDate: x.position.fillDate, held: !!x.pending?.held, exitPending: x.pending?.side === 'sell' })),
      pending: Object.values(st.stocks).filter((x) => x.pending).map((x) => ({ symbol: x.symbol, side: x.pending.side, decisionDate: x.pending.decisionDate, shares: x.pending.shares ?? null, held: !!x.pending.held })),
      completedTrades: st.journal.trades.length }; };
    const lastBars = Object.fromEntries(m.symbols.map((s) => [s.symbol, store.lastBarDate(db, s.symbol)]));
    const nextToProcess = (() => { const list = sessionsList(); const n = list.find((d) => !lastS || d > lastS.date); return n ?? null; })();
    const kinds = (k) => evs.filter((e) => e.kind === k);
    return {
      journal: JOURNAL_ID, status: currentStatus(), engine: m.engine, codeRevision: m.codeRevision, activationCommit: m.activationCommit, sourceCommit: m.sourceCommit,
      start: m.start, warmupFrom: m.warmupFrom, reviewDate: m.reviewDate,
      sessions: { warmup: sessions.length - live.length, live: live.length, late: live.filter((s) => !s.onTime).length, last: lastS ? { date: lastS.date, phase: lastS.phase, onTime: lastS.onTime, recordedAt: lastS.recorded_at } : null },
      next: nextToProcess ? { session: nextToProcess, finalFrom: new Date(sessionBounds(nextToProcess).close.getTime() + BAR_FINAL_AFTER_CLOSE_MIN * 60000).toISOString(), onTimeIfRecordedBefore: nextToProcess >= m.start ? nextOpenOf(nextToProcess, excluded).toISOString() : null } : null,
      lastUpdate: ups.at(-1) ? { id: ups.at(-1).id, kind: ups.at(-1).kind, status: ups.at(-1).status, recordedAt: ups.at(-1).recorded_at, firstSession: ups.at(-1).first_session, lastSession: ups.at(-1).last_session } : null,
      data: { lastBar: lastBars, missingSessions: kinds('data_missing').map((e) => ({ date: e.date, missing: e.detail.missing })), lateBars: kinds('late_bar').length, lateDividends: kinds('late_dividend').length, revisions: kinds('action_revision').length },
      rules: Object.fromEntries(m.rules.map((r) => [r.name, { role: r.role, ...posOf(r.name), lateVetoes: evs.filter((e) => e.rule === r.name && e.ledger === 'primary' && e.kind === 'skip' && e.detail.code === 'late_veto').length,
        rejections: evs.filter((e) => e.rule === r.name && e.ledger === 'primary' && e.kind === 'warning' && ['entry_rejected', 'order_cancelled', 'order_reduced'].includes(e.detail.code)).map((e) => ({ date: e.date, symbol: e.symbol, code: e.detail.code })),
        recent: evs.filter((e) => e.rule === r.name && e.ledger === 'primary' && /^(decision_|fill_)/.test(e.kind)).slice(-12).map((e) => ({ date: e.date, kind: e.kind, symbol: e.symbol, shares: e.detail.shares ?? null, ...(e.kind.startsWith('fill_') ? { price: e.detail.price } : {}), onTime: e.onTime, late: !!e.detail.late })) }])),
      completedOnTimeM1PrimaryTrades: posOf('M1').completedTrades,
      errors: kinds('error').map((e) => ({ at: e.recorded_at, ...e.detail })), pauses: kinds('status').filter((e) => e.detail.to === 'paused').map((e) => ({ at: e.recorded_at, reason: e.detail.reason })),
      visibility: 'operational only: no P/L, value, return, drawdown or comparison is computed before the review date',
    };
  }

  // ---------- the review (refused before the review date has been processed) ----------
  async function review() {
    if (!isActivated()) throw new JournalError(409, 'not activated');
    const m = meta();
    const lastLive = store.listSessions(db).filter((s) => s.phase === 'live').at(-1);
    if (!lastLive || lastLive.date !== m.reviewDate) throw new JournalError(409, `the review is on ${m.reviewDate}: it runs only after that session has been processed (last live session: ${lastLive?.date ?? 'none'}); performance stays hidden until then`);
    const { computeMetrics } = await import('../rangetrend/metrics.js');
    const { holdIndex } = await import('../rangetrend/benchmark.js');
    const { nullTest } = await import('./runner.js');
    const sessions = sessionsList();
    const days = buildDays({ sessions, symbols: m.symbols, bars: store.getBars(db), actions: store.getActions(db) });
    const calibrated = halfSpreadFn(m.calibration);
    const lateSessions = new Set(store.listSessions(db).filter((s) => s.phase === 'live' && !s.onTime).map((s) => s.date));
    const index = holdIndex({ symbols: m.symbols, sessions, days, start: m.start, startingCash: 15000, withholdingPct: 15 });
    const out = {};
    for (const r of m.rules) {
      const res = {};
      for (const l of LEDGERS) {
        const e = createMechanismEngine2({ config: r.config, symbols: m.symbols, halfSpreadBps: halfSpreadFor(r.config, calibrated), state: storedState(r.name, l) });
        const o = { ...e.output(), meta: { startingCash: r.config.portfolio.startingCash, symbols: m.symbols } };
        const metrics = computeMetrics(o, { index });
        res[l] = { output: o, metrics };
      }
      const p = res.primary;
      const nul = nullTest(p.output, { inputs: { sessions, days }, calibrated, config: r.config, period: { start: m.start, end: m.reviewDate }, resamples: NULL_SPEC.resamples, seed: NULL_SPEC.seed });
      out[r.name] = {
        role: r.role,
        primary: { net: p.metrics.endValue - p.metrics.startValue, maxDrawdownPct: p.metrics.maxDrawdownPct, avgInvestedPct: p.metrics.avgInvestedPct, costs: p.metrics.costs, completedTrades: p.metrics.completedTrades, openAtEnd: p.metrics.openAtEnd, exposureMatched: p.metrics.benchmarks?.exposureMatched ?? null, index: p.metrics.benchmarks?.buyAndHold ?? null, nullTest: nul, nullRole: r.name === 'M1' ? 'the single pre-specified test' : 'descriptive only' },
        reconstructed: { label: 'reconstructed: every session as if recorded on time; never counted toward the sample', net: res.reconstructed.metrics.endValue - res.reconstructed.metrics.startValue, completedTrades: res.reconstructed.metrics.completedTrades, missedByLateness: res.reconstructed.output.trades.filter((t) => lateSessions.has(t.entryDecisionDate)).length },
      };
    }
    const m1 = out.M1.primary.completedTrades;
    const attribution = Object.fromEntries(['B0', 'M0'].map((k) => { const d = out.M1.primary.net - out[k].primary.net; const ex = (out.M1.primary.exposureMatched?.endValue ?? 0) - (out[k].primary.exposureMatched?.endValue ?? 0); return [k, { diffUsd: d, exposureUsd: ex, residualUsd: d - ex }]; }));
    return { journal: JOURNAL_ID, reviewDate: m.reviewDate, label: m1 < MIN_COMPLETED ? 'insufficient sample' : 'sample reached', completedOnTimeM1PrimaryTrades: m1, minimum: MIN_COMPLETED, note: m1 < MIN_COMPLETED ? 'fewer than 30 completed on-time M1 primary trades: the figures are descriptive results only, never a qualification' : '30 trades alone would not establish profitability', rules: out, m1VsControls: attribution, lateDividendsNotApplied: store.listEvents(db, { kinds: ['late_dividend'] }).map((e) => ({ date: e.date, symbol: e.symbol, ...e.detail })) };
  }

  function close() { try { db.close(); } catch { /* ignore */ } }
  return { file, db, activationStatus, activate, update, resume, status, review, verifyReplay, close, meta: () => (isActivated() ? meta() : null) };
}
