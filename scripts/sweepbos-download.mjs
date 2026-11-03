// sweep-bos data download (strategy/sweep-bos/PLAN.md Part B). Run manually:
//
//   node scripts/sweepbos-download.mjs [--label <text>] [--readiness-only <versionId>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//
// Downloads QQQ and SPY daily and 5-minute bars from Alpaca (SIP, raw) for the warm-up and DEVELOPMENT window
// only (2018-06-01 to 2022-12-30; a later --to is refused before any request: config.js MAX_BAR_DATE) into a
// new data version of data/sweep-bos-sim.sqlite, then runs the readiness check and writes its counts to
// strategy/sweep-bos/reports/data-readiness-v<id>.md. It refuses to run unless the working PLAN.md and
// PRE-REGISTRATION.md match their pins and the pre-registration commit is an ancestor of HEAD (the rules were
// committed before the data). The keys come from .env through server/config.js and are never printed; if they
// are missing it stops and says so. Progress output carries counts only, never a price. No order, trading or
// account endpoint exists in the client it uses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { createHxrSource } from '../server/hxr/source.js';
import { openSbDb, maxStoredDate, countBarsAfterBound, listDataVersions, setReadiness } from '../server/sweepbos/store.js';
import { downloadBars, readinessCheck } from '../server/sweepbos/data.js';
import { ROOT, PREREG, PREREG_PATH, PLAN_PATH, fileSha256, WINDOWS, MAX_BAR_DATE, INSTRUMENTS, DB_NAME, REPORT_DIR, preregCommitStatus } from '../server/sweepbos/config.js';

export const MIN_FREE_BYTES = 1024 ** 3;
const EXCLUDED_FILE = path.join(ROOT, 'strategy', 'hxr', 'periods-hxr-v3.json');

export function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

export function parseArgs(argv) {
  const o = { label: 'warmup-development', readinessOnly: null, from: WINDOWS.warmupFrom, to: WINDOWS.development.end };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') o.label = argv[++i];
    else if (a === '--readiness-only') o.readinessOnly = Number(argv[++i]);
    else if (a === '--from') o.from = argv[++i];
    else if (a === '--to') o.to = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

export function readinessMarkdown(r) {
  const L = [];
  L.push(`# sweep-bos data readiness, data version ${r.versionId} (${r.label})`, '');
  L.push(`Counts only (PRE-REGISTRATION.md 1.2-1.4); no bar, price or per-session list is in this file. Window ${r.from} to ${r.to}; bound ${r.bound}; latest stored date ${r.maxStoredDate ?? 'none'}; bars after the bound: ${r.barsAfterBound.bars5m} five-minute, ${r.barsAfterBound.bars1d} daily; data hash ${r.dataHash}; status ${r.status}.`, '');
  L.push('| Figure (measured) | ' + Object.keys(r.symbols).join(' | ') + ' |');
  L.push('|---|' + Object.keys(r.symbols).map(() => '---').join('|') + '|');
  const syms = Object.values(r.symbols);
  const row = (name, f) => L.push(`| ${name} | ${syms.map((s) => f(s)).join(' | ')} |`);
  row('sessions expected (NYSE calendar)', (s) => s.expectedSessions);
  row('of which early closes', (s) => s.earlyCloseSessions);
  row('sessions stored', (s) => s.sessionsStored);
  row('complete sessions (every slot)', (s) => s.complete);
  row('incomplete sessions (a slot missing)', (s) => s.incomplete);
  row('sessions entirely missing', (s) => s.missingSessions);
  row('slots missing in total', (s) => s.missingSlots);
  row('unexpected sessions (not in the calendar)', (s) => s.unexpectedSessions);
  row('5-minute bars stored', (s) => s.bars5m);
  row('stored bars with bad OHLC', (s) => s.badOhlcStored);
  row('stored bars with a slot out of range', (s) => s.slotOutOfRange);
  row('zero-range bars', (s) => s.zeroRangeBars);
  row('odd-range bars (range over 5% of close)', (s) => s.oddRangeBars);
  row('odd-jump bars (close-to-close over 3% in a session)', (s) => s.oddJumpBars);
  row('daily bars stored', (s) => s.daily.stored);
  row('daily bars missing', (s) => s.daily.missing);
  row('daily bars with bad OHLC', (s) => s.daily.badOhlc);
  row('daily high/low vs 5-minute session high/low beyond 0.01 (complete sessions)', (s) => s.daily.highLowMismatch);
  row('bars returned by the source (5-minute, all hours)', (s) => s.dropped?.intraday?.returned ?? 'n/a');
  row('dropped: outside the regular session', (s) => s.dropped?.intraday?.outsideSession ?? 'n/a');
  row('dropped: misaligned timestamp', (s) => s.dropped?.intraday?.misaligned ?? 'n/a');
  row('dropped: duplicate slot', (s) => s.dropped?.intraday?.duplicateSlot ?? 'n/a');
  row('dropped: invalid OHLC', (s) => s.dropped?.intraday?.invalidOhlc ?? 'n/a');
  row('dropped by the client (non-trading day, incomplete session, invalid, duplicate, unreadable)', (s) => s.dropped?.intraday?.source ? Object.values(s.dropped.intraday.source).reduce((a, b) => a + b, 0) : 'n/a');
  L.push('', '## Incomplete sessions by year (count)', '');
  for (const [sym, s] of Object.entries(r.symbols)) L.push(`- ${sym}: ${Object.keys(s.incompleteSessionsByYear).length ? Object.entries(s.incompleteSessionsByYear).map(([y, n]) => `${y}: ${n}`).join(', ') : 'none'}`);
  L.push('', '## Sessions listed in periods-hxr-v3.json excludedSessions (reported; excluded only by the incomplete-session rule)', '');
  L.push('| Date | ' + Object.keys(r.symbols).map((s) => `${s} bars stored / full`).join(' | ') + ' | Reason listed |');
  L.push('|---|' + Object.keys(r.symbols).map(() => '---').join('|') + '|---|');
  const first = syms[0]?.excludedSessions ?? [];
  first.forEach((x, i) => L.push(`| ${x.date} | ${syms.map((s) => `${s.excludedSessions[i].bars} / ${s.excludedSessions[i].full}${s.excludedSessions[i].complete ? '' : ' (incomplete)'}`).join(' | ')} | ${x.reason} |`));
  L.push('');
  return L.join('\n');
}

export async function main({ argv = [], io = { log: console.log, error: console.error }, cfg = null, fetchImpl = undefined, now = () => new Date(), dbFile = null } = {}) {
  const o = parseArgs(argv);
  const config = cfg || loadConfig();
  const dataDir = config.dataDir;
  fs.mkdirSync(dataDir, { recursive: true });
  const free = freeBytes(dataDir);
  io.log(`free space on the data volume: ${(free / 1024 ** 3).toFixed(1)} GB`);
  if (free < MIN_FREE_BYTES) throw new Error('refusing to run: under 1 GB free');
  for (const [name, file] of [['PRE-REGISTRATION.md', PREREG_PATH], ['PLAN.md', PLAN_PATH]]) {
    if (fileSha256(file) !== PREREG.sha256[name]) throw new Error(`${name} does not match its pinned SHA-256: the rule sheet must be the committed one`);
  }
  const pc = preregCommitStatus();
  if (!pc.ok) throw new Error(`pre-registration commit: ${pc.detail}`);
  io.log(`pre-registration: ${pc.detail}`);
  const file = dbFile || path.join(dataDir, DB_NAME);
  const db = openSbDb(file);
  try {
    const excluded = JSON.parse(fs.readFileSync(EXCLUDED_FILE, 'utf8')).excludedSessions || [];
    let versionId = o.readinessOnly;
    if (versionId == null) {
      if (o.to > MAX_BAR_DATE) throw new Error(`--to ${o.to} is after the bar bound ${MAX_BAR_DATE}: refused before any request (the evaluation window needs the owner's separate message)`);
      const sec = config.secrets || {};
      if (!(sec.ALPACA_API_KEY_ID && sec.ALPACA_API_SECRET_KEY)) {
        io.error('Alpaca market-data keys are not set in .env (ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY): stopping; nothing was downloaded.');
        return { exitCode: 2, versionId: null };
      }
      const existing = listDataVersions(db).find((v) => v.label === o.label && v.status === 'complete');
      if (existing) throw new Error(`a complete data version labelled "${o.label}" exists (id ${existing.id}); use --label for a new one or --readiness-only ${existing.id}`);
      const source = createHxrSource({ keyId: sec.ALPACA_API_KEY_ID, secretKey: sec.ALPACA_API_SECRET_KEY, fetchImpl, now });
      io.log(`downloading ${INSTRUMENTS.join(', ')} daily and 5-minute bars, ${o.from} to ${o.to}, feed ${source.feed}, adjustment ${source.adjustment} (bound ${MAX_BAR_DATE})`);
      const r = await downloadBars(db, source, { from: o.from, to: o.to, label: o.label, now, log: io.log, preregCommit: PREREG.commit, preregSha256: PREREG.sha256['PRE-REGISTRATION.md'] });
      versionId = r.id;
      io.log(`data version ${r.id} complete: ${r.bars1d} daily and ${r.bars5m} 5-minute bars; hash ${r.dataHash}; requests ${source.stats().requests}, pages ${source.stats().pages}, retries ${source.stats().retries}`);
    }
    const readiness = readinessCheck(db, versionId, { excludedSessions: excluded });
    setReadiness(db, versionId, readiness);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const out = path.join(REPORT_DIR, `data-readiness-v${versionId}.md`);
    fs.writeFileSync(out, readinessMarkdown(readiness));
    io.log(readinessMarkdown(readiness));
    io.log(`latest stored date ${maxStoredDate(db) ?? 'none'} (bound ${MAX_BAR_DATE}); bars after the bound: ${JSON.stringify(countBarsAfterBound(db))}`);
    io.log(`readiness written to ${path.relative(ROOT, out)}`);
    return { exitCode: 0, versionId, readiness };
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({ argv: process.argv.slice(2) }).then((o) => process.exit(o.exitCode), (e) => { console.error(e.message); process.exit(1); });
}
