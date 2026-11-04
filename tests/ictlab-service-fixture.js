// A temporary ICT Lab environment for the service and launcher tests: pinned test copies of the protocol and the
// concepts, the real spec files copied (their real pins apply), a synthetic data version (the fake market, no
// network) and a log with the code-frozen entry. The service is created with testOverrides so that the git and
// temp-folder checks are replaced by the fixture's values and the statistics run with small resample counts.
// Synthetic bars only.
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import * as store from '../server/ictlab/store.js';
import { CODE_REVISION, SPEC_DIR, textSha256, frozenTitle, VALIDATION_TITLE, ROUND1_SPECS } from '../server/ictlab/config.js';
import { createIctLab } from '../server/ictlab/service.js';
import { buildMarket } from './ictlab-fake-alpaca.js';

export const COMMIT = 'abc123abc123abc123abc123abc123abc123abc1';
export const COMMITTED_AT = '2026-11-04T12:00:00Z';
export const CLOCK = () => new Date('2026-11-05T12:00:00Z');
export const LOG_HEADER = '# ICT Lab: experiment log (append-only)\n\nEntries are headed `## <number> | <date> | <title>`.\n';
export const frozenEntry = ({ revision = CODE_REVISION, commit = COMMIT, dataHash, number = 1, round = 1 }) => `\n## ${number} | 2026-11-04 | **${frozenTitle(round)}** (synthetic test log)\n\nCode revision ${revision}; pre-registration commit ${commit}; data version 1, data hash: ${dataHash}.\n`;
export const validationEntry = ({ revision = CODE_REVISION, specs = ROUND1_SPECS.slice(0, 1), number = 2, quote = 'Validate it once on 2023-01-03 to 2024-12-31.' }) => `\n## ${number} | 2026-11-05 | **${VALIDATION_TITLE}** (the owner's message, synthetic test log)\n\n> ${quote}\n\nCode revision ${revision}; candidates: ${specs.join(', ')}.\n`;

export function serviceFixture({ frozen = true, revision = CODE_REVISION, frozenRevision = null, frozenHash = null, extraLog = '', downloadedAt = '2026-11-04T18:00:00Z', from = '2019-01-02', to = '2019-03-29', seed = 11, versionFrom = '2018-06-01', versionTo = '2022-12-30', overrides = {}, nullN = 200, bootstrapN = 200 } = {}) {
  const dir = tempDir('il-svc-');
  const protocolPath = path.join(dir, 'PROTOCOL.md'), conceptsPath = path.join(dir, 'CONCEPTS.md');
  fs.writeFileSync(protocolPath, '# protocol (test copy)\n');
  fs.writeFileSync(conceptsPath, '# concepts (test copy)\n');
  const pins = { 'PROTOCOL.md': textSha256(fs.readFileSync(protocolPath, 'utf8')), 'CONCEPTS.md': textSha256(fs.readFileSync(conceptsPath, 'utf8')) };
  const specDir = path.join(dir, 'specs');
  fs.mkdirSync(specDir);
  for (const f of fs.readdirSync(SPEC_DIR)) fs.copyFileSync(path.join(SPEC_DIR, f), path.join(specDir, f));
  const dbFile = path.join(dir, 'ict-lab-sim.sqlite');
  const db = store.openIlDb(dbFile);
  const versionId = store.createDataVersion(db, { label: 'test', symbols: ['QQQ'], from: versionFrom, to: versionTo, feed: 'sip', adjustment: 'raw', source: 'alpaca', timeframes: ['1Day', '5Min'], downloadedAt, preregCommit: COMMIT, protocolSha256: pins['PROTOCOL.md'], codeRevision: revision });
  const market = buildMarket({ from, to, extended: false, seed });
  const rows = [];
  for (const [d, bars] of market.QQQ.sessions) for (const b of bars) rows.push({ session: d, idx: (b.minutes - 570) / 5, ts: b.ms, hhmm: `${String(Math.floor(b.minutes / 60)).padStart(2, '0')}:${String(b.minutes % 60).padStart(2, '0')}`, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
  store.insertBars5m(db, versionId, 'QQQ', rows);
  store.insertBars1d(db, versionId, 'QQQ', [...market.QQQ.daily].map(([date, x]) => ({ date, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v })));
  const dataHash = store.dataHashOf(db, versionId);
  store.completeDataVersion(db, versionId, { finishedAt: downloadedAt, bars5m: rows.length, bars1d: market.QQQ.daily.size, dropped: {}, dataHash });
  db.close();
  const logPath = path.join(dir, 'EXPERIMENT-LOG.md');
  fs.writeFileSync(logPath, LOG_HEADER + (frozen ? frozenEntry({ revision: frozenRevision || revision, dataHash: frozenHash || dataHash }) : '') + extraLog);
  const make = (extra = {}) => createIctLab({
    dbFile, logPath, protocolPath, conceptsPath, specDir, clock: CLOCK, testOverrides: true,
    overrides: { prereg: { ok: true, detail: 'test: the pre-registration commit is an ancestor of HEAD', committedAt: COMMITTED_AT }, uncommitted: [], head: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', pins, preregCommit: COMMIT, committedAt: COMMITTED_AT, revision, tempDirs: [], nullN, bootstrapN, ...overrides, ...extra },
  });
  return { dir, dbFile, logPath, protocolPath, conceptsPath, specDir, pins, dataHash, versionId, market, service: make(), make };
}
