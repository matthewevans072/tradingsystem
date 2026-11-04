// ICT Lab data download (strategy/ict-lab/PROTOCOL.md sections 2 and 3; Part B). Run manually, with the owner's
// authorization only:
//
//   node scripts/ictlab-download.mjs [--label <text>] [--readiness-only <versionId>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//
// Downloads QQQ daily and 5-minute bars from Alpaca (SIP, raw) for the DEVELOPMENT window only (2018-06-01 to
// 2022-12-30; a later --to is refused before any request: config.js MAX_BAR_DATE) into a new data version of
// data/ict-lab-sim.sqlite, runs the readiness check and the read-only per-bar comparison against sweep-bos's
// QQQ bars, and writes their counts to strategy/ict-lab/reports/data-readiness-v<id>.md. It refuses to run unless
// the working PROTOCOL.md, CONCEPTS.md and spec files match their pins and the pre-registration commit is an
// ancestor of HEAD (the rules were committed before the data). The keys come from .env through server/config.js
// and are never printed; if they are missing it stops and says so. Output carries counts and dates only, never a
// price. No order, trading or account endpoint exists in the client it uses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { createHxrSource } from '../server/hxr/source.js';
import { openIlDb, maxStoredDate, countBarsAfterBound, listDataVersions, setReadiness, setComparison } from '../server/ictlab/store.js';
import { downloadBars, readinessCheck, compareWithSweepBos } from '../server/ictlab/data.js';
import { ROOT, PREREG, PINNED_DOCS, PROTOCOL_PATH, CONCEPTS_PATH, SPEC_DIR, SPEC_SHA256, fileSha256, WINDOWS, MAX_BAR_DATE, INSTRUMENT, DB_NAME, SWEEP_BOS_DB_NAME, REPORT_DIR, preregCommitStatus } from '../server/ictlab/config.js';

export const MIN_FREE_BYTES = 1024 ** 3;

export function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

export function parseArgs(argv) {
  const o = { label: 'development', readinessOnly: null, from: WINDOWS.development.start, to: WINDOWS.development.end };
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

export function readinessMarkdown(r, cmp) {
  const L = [];
  L.push(`# ICT Lab data readiness, data version ${r.versionId} (${r.label})`, '');
  L.push(`Counts only (PROTOCOL.md section 3); no bar, price or per-session list is in this file. Window ${r.from} to ${r.to}; bound ${r.bound}; latest stored date ${r.maxStoredDate ?? 'none'}; bars after the bound: ${r.barsAfterBound.bars5m} five-minute, ${r.barsAfterBound.bars1d} daily; data hash ${r.dataHash}; status ${r.status}.`, '');
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
  L.push('', '## Comparison with sweep-bos data version (PROTOCOL.md section 3; read-only, counts and dates only)', '');
  if (!cmp || !cmp.available) L.push(`Not compared: ${cmp?.reason ?? 'no comparison was run'}.`);
  else {
    L.push(`sweep-bos file ${cmp.sweepBos.file}, data version ${cmp.sweepBos.versionId} (hash ${cmp.sweepBos.dataHash}, ${cmp.sweepBos.from} to ${cmp.sweepBos.to}); lab data version ${cmp.lab.versionId} (hash ${cmp.lab.dataHash}); compared ${cmp.from} to ${cmp.to}; identical: ${cmp.identical ? 'yes' : 'NO'}.`, '');
    L.push('| Figure (measured) | 5-minute bars | daily bars |', '|---|---|---|');
    const c = (k) => `| ${k} | ${cmp.bars5m[k]} | ${cmp.bars1d[k]} |`;
    for (const k of ['lab', 'sweepBos', 'common', 'onlyInLab', 'onlyInSweepBos', 'differing']) L.push(c(k));
    L.push(`| differing by field | ${Object.entries(cmp.bars5m.fields).map(([f, n]) => `${f} ${n}`).join(', ')} | ${Object.entries(cmp.bars1d.fields).map(([f, n]) => `${f} ${n}`).join(', ')} |`, '');
    const dates = (d) => (d.count ? `${d.count} date(s): ${d.dates.join(', ')}${d.truncated ? ', ...' : ''}` : 'none');
    L.push(`- 5-minute bars, dates only in the lab: ${dates(cmp.bars5m.datesOnlyInLab)}`, `- 5-minute bars, dates only in sweep-bos: ${dates(cmp.bars5m.datesOnlyInSweepBos)}`, `- 5-minute bars, dates with a differing bar: ${dates(cmp.bars5m.datesDiffering)}`);
    L.push(`- daily bars, dates only in the lab: ${dates(cmp.bars1d.datesOnlyInLab)}`, `- daily bars, dates only in sweep-bos: ${dates(cmp.bars1d.datesOnlyInSweepBos)}`, `- daily bars, dates with a differing bar: ${dates(cmp.bars1d.datesDiffering)}`);
  }
  L.push('');
  return L.join('\n');
}

export async function main({ argv = [], io = { log: console.log, error: console.error }, cfg = null, fetchImpl = undefined, now = () => new Date(), dbFile = null, sweepBosFile = null, git = null } = {}) {
  const o = parseArgs(argv);
  const config = cfg || loadConfig();
  const dataDir = config.dataDir;
  fs.mkdirSync(dataDir, { recursive: true });
  const free = freeBytes(dataDir);
  io.log(`free space on the data volume: ${(free / 1024 ** 3).toFixed(1)} GB`);
  if (free < MIN_FREE_BYTES) throw new Error('refusing to run: under 1 GB free');
  for (const [name, file] of [['PROTOCOL.md', PROTOCOL_PATH], ['CONCEPTS.md', CONCEPTS_PATH]]) {
    if (!PINNED_DOCS.includes(name) || fileSha256(file) !== PREREG.sha256[name]) throw new Error(`${name} does not match its pinned SHA-256: the rules must be the committed ones`);
  }
  for (const [name, pin] of Object.entries(SPEC_SHA256)) {
    if (fileSha256(path.join(SPEC_DIR, name)) !== pin) throw new Error(`specs/${name} does not match its pinned SHA-256: the specs must be the committed ones`);
  }
  const pc = preregCommitStatus({ git });
  if (!pc.ok) throw new Error(`pre-registration commit: ${pc.detail}`);
  io.log(`pre-registration: ${pc.detail}`);
  const file = dbFile || path.join(dataDir, DB_NAME);
  const db = openIlDb(file);
  try {
    let versionId = o.readinessOnly;
    if (versionId == null) {
      if (o.to > MAX_BAR_DATE) throw new Error(`--to ${o.to} is after the bar bound ${MAX_BAR_DATE}: refused before any request (the validation window needs the owner's separate message)`);
      const sec = config.secrets || {};
      if (!(sec.ALPACA_API_KEY_ID && sec.ALPACA_API_SECRET_KEY)) {
        io.error('Alpaca market-data keys are not set in .env (ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY): stopping; nothing was downloaded.');
        return { exitCode: 2, versionId: null };
      }
      const existing = listDataVersions(db).find((v) => v.label === o.label && v.status === 'complete');
      if (existing) throw new Error(`a complete data version labelled "${o.label}" exists (id ${existing.id}); use --label for a new one or --readiness-only ${existing.id}`);
      const source = createHxrSource({ keyId: sec.ALPACA_API_KEY_ID, secretKey: sec.ALPACA_API_SECRET_KEY, fetchImpl, now });
      io.log(`downloading ${INSTRUMENT} daily and 5-minute bars, ${o.from} to ${o.to}, feed ${source.feed}, adjustment ${source.adjustment} (bound ${MAX_BAR_DATE})`);
      const r = await downloadBars(db, source, { from: o.from, to: o.to, label: o.label, now, log: io.log, preregCommit: PREREG.commit, protocolSha256: PREREG.sha256['PROTOCOL.md'] });
      versionId = r.id;
      io.log(`data version ${r.id} complete: ${r.bars1d} daily and ${r.bars5m} 5-minute bars; hash ${r.dataHash}; requests ${source.stats().requests}, pages ${source.stats().pages}, retries ${source.stats().retries}`);
    }
    const readiness = readinessCheck(db, versionId);
    setReadiness(db, versionId, readiness);
    const sbFile = sweepBosFile || path.join(dataDir, SWEEP_BOS_DB_NAME);
    const cmp = compareWithSweepBos(db, versionId, sbFile);
    setComparison(db, versionId, cmp);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const out = path.join(REPORT_DIR, `data-readiness-v${versionId}.md`);
    const text = readinessMarkdown(readiness, cmp);
    fs.writeFileSync(out, text);
    io.log(text);
    io.log(`latest stored date ${maxStoredDate(db) ?? 'none'} (bound ${MAX_BAR_DATE}); bars after the bound: ${JSON.stringify(countBarsAfterBound(db))}`);
    io.log(`readiness written to ${path.relative(ROOT, out)}`);
    return { exitCode: 0, versionId, readiness, comparison: cmp };
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({ argv: process.argv.slice(2) }).then((o) => process.exit(o.exitCode), (e) => { console.error(e.message); process.exit(1); });
}
