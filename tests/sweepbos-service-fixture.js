// A temporary sweep-bos environment for the service and launcher tests: pinned copies of the rule sheet and the
// plan, the real variant files copied, a synthetic data version (the fake market, no network) and a log with
// the code-frozen entry. The service is created with testOverrides so that the git checks are replaced by the
// fixture's values. Synthetic bars only.
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import * as store from '../server/sweepbos/store.js';
import { CODE_REVISION, VARIANT_DIR, textSha256, FROZEN_TITLE } from '../server/sweepbos/config.js';
import { createSweepBos } from '../server/sweepbos/service.js';
import { buildMarket } from './sweepbos-fake-alpaca.js';

export const COMMIT = 'abc123abc123abc123abc123abc123abc123abc1';
export const COMMITTED_AT = '2026-11-03T17:00:00Z';
export const CLOCK = () => new Date('2026-11-04T12:00:00Z');
export const LOG_HEADER = '# sweep-bos: experiment log (append-only)\n\nEntries are headed `## <number> | <date> | <title>`.\n';
export const frozenEntry = ({ revision = CODE_REVISION, commit = COMMIT, dataHash, number = 1 }) => `\n## ${number} | 2026-11-03 | **${FROZEN_TITLE}** (synthetic test log)\n\nCode revision ${revision}; pre-registration commit ${commit}; data version 1, data hash: ${dataHash}.\n`;

export function serviceFixture({ frozen = true, revision = CODE_REVISION, frozenRevision = null, frozenHash = null, extraLog = '', downloadedAt = '2026-11-03T18:00:00Z', from = '2018-11-01', to = '2019-03-29', seed = 11, overrides = {} } = {}) {
  const dir = tempDir('sb-svc-');
  const preregPath = path.join(dir, 'PRE-REGISTRATION.md'), planPath = path.join(dir, 'PLAN.md');
  fs.writeFileSync(preregPath, '# rules (test copy)\n');
  fs.writeFileSync(planPath, '# plan (test copy)\n');
  const pins = { 'PRE-REGISTRATION.md': textSha256(fs.readFileSync(preregPath, 'utf8')), 'PLAN.md': textSha256(fs.readFileSync(planPath, 'utf8')) };
  const variantDir = path.join(dir, 'variants');
  fs.mkdirSync(variantDir);
  for (const f of fs.readdirSync(VARIANT_DIR)) fs.copyFileSync(path.join(VARIANT_DIR, f), path.join(variantDir, f));
  const dbFile = path.join(dir, 'sweep-bos-sim.sqlite');
  const db = store.openSbDb(dbFile);
  const versionId = store.createDataVersion(db, { label: 'test', symbols: ['QQQ', 'SPY'], from: '2018-06-01', to: '2022-12-30', feed: 'sip', adjustment: 'raw', source: 'alpaca', timeframes: ['1Day', '5Min'], downloadedAt, preregCommit: COMMIT, preregSha256: pins['PRE-REGISTRATION.md'], codeRevision: revision });
  const market = buildMarket({ from, to, extended: false, seed });
  for (const sym of ['QQQ', 'SPY']) {
    const rows = [];
    for (const [d, bars] of market[sym].sessions) for (const b of bars) rows.push({ session: d, idx: (b.minutes - 570) / 5, ts: b.ms, hhmm: `${String(Math.floor(b.minutes / 60)).padStart(2, '0')}:${String(b.minutes % 60).padStart(2, '0')}`, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    store.insertBars5m(db, versionId, sym, rows);
    store.insertBars1d(db, versionId, sym, [...market[sym].daily].map(([date, x]) => ({ date, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v })));
  }
  const dataHash = store.dataHashOf(db, versionId);
  store.completeDataVersion(db, versionId, { finishedAt: downloadedAt, bars5m: 0, bars1d: 0, dropped: {}, dataHash });
  db.close();
  const logPath = path.join(dir, 'EXPERIMENT-LOG.md');
  fs.writeFileSync(logPath, LOG_HEADER + (frozen ? frozenEntry({ revision: frozenRevision || revision, dataHash: frozenHash || dataHash }) : '') + extraLog);
  const make = (extra = {}) => createSweepBos({
    dbFile, logPath, preregPath, planPath, variantDir, clock: CLOCK, testOverrides: true,
    overrides: { prereg: { ok: true, detail: 'test: the pre-registration commit is an ancestor of HEAD', committedAt: COMMITTED_AT }, uncommitted: [], head: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', pins, preregCommit: COMMIT, committedAt: COMMITTED_AT, revision, ...overrides, ...extra },
  });
  return { dir, dbFile, logPath, preregPath, planPath, variantDir, pins, dataHash, versionId, service: make(), make };
}
