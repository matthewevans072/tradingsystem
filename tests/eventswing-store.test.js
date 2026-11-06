// event-swing's store and configuration (server/eventswing/store.js, config.js): the file guard, append-only source
// records, finished runs never changed, the pins, the matrix check, the log reader and the window bound. Synthetic
// rows only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import * as store from '../server/eventswing/store.js';
import { pinStatus, PREREG, validateMatrix, loadMatrix, logStatus, assertInWindow, configHash, configFor, CAMPAIGN_PATH } from '../server/eventswing/config.js';

const AT = '2026-11-06T18:00:00.000Z';

test('the guard refuses every other programme\'s database, foreign tables and a dangling link; the store is synchronous FULL', () => {
  const dir = tempDir('es-');
  for (const n of ['signal-desk.sqlite', 'demo.sqlite', 'strategy-lab.sqlite', 'hxr-sim.sqlite', 'range-trend-sim.sqlite', 'sweep-bos-sim.sqlite', 'ict-lab-sim.sqlite', 'research-runner.sqlite', 'prospective-1.sqlite']) assert.throws(() => store.openEsDb(path.join(dir, n)), /never opens/, n);
  const foreign = path.join(dir, 'x.sqlite'); const f = new DatabaseSync(foreign); f.exec('CREATE TABLE rr_campaigns (id INTEGER)'); f.close();
  assert.throws(() => store.openEsDb(foreign), /not event-swing's/);
  const db = store.openEsDb(path.join(dir, 'event-swing.sqlite'));
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 2);
  db.close();
});

test('source records, meta, placebo results and the log are append-only; a finished run is never changed; nothing is deleted; no row after 2021-12-31 is stored', () => {
  const db = store.openEsDb(path.join(tempDir('es-'), 'event-swing.sqlite'));
  store.insertListing(db, [{ accession: '0000000001-21-000001', symbol: 'MU', cik: 723125, form: '8-K', filingDate: '2021-06-30', itemsDesc: 'items 2.02 and 9.01', indexUrl: 'https://www.sec.gov/x-index.htm', companyName: 'MICRON TECHNOLOGY INC' }], AT);
  store.insertFiling(db, { accession: '0000000001-21-000001', symbol: 'MU', cik: 723125, form: '8-K', filingDate: '2021-06-30', acceptedEt: '2021-06-30 16:05:00', reportDate: '2021-06-30', items: ['2.02', '9.01'], status: 'ok' }, AT);
  store.insertDocument(db, { accession: '0000000001-21-000001', url: 'https://www.sec.gov/x.htm', status: 'ok', httpStatus: 200, body: '<p>text</p>' }, AT);
  store.setMeta(db, 'k', 1, AT);
  assert.throws(() => store.setMeta(db, 'k', 2, AT), /UNIQUE|constraint/i);
  for (const sql of ['UPDATE es_listing SET form = \'x\'', 'DELETE FROM es_listing', 'UPDATE es_filings SET accepted_et = \'2021-06-29 10:00:00\'', 'DELETE FROM es_filings', 'UPDATE es_documents SET body = \'y\'', 'DELETE FROM es_documents', 'UPDATE es_meta SET value_json = \'2\'']) assert.throws(() => db.exec(sql), /append-only/, sql);
  assert.throws(() => store.insertListing(db, [{ accession: '0000000001-22-000001', symbol: 'MU', cik: 723125, form: '8-K', filingDate: '2022-01-03', indexUrl: 'u', companyName: 'MICRON' }], AT), /CHECK/);
  assert.throws(() => store.insertFiling(db, { accession: '0000000001-22-000002', symbol: 'MU', cik: 723125, form: '8-K', filingDate: '2021-12-31', acceptedEt: '2022-01-03 08:00:00', reportDate: '2021-12-31', items: ['2.02'], status: 'ok' }, AT), /CHECK/);
  const cid = store.insertCampaign(db, { codeRevision: 'x', engineVersion: 'y', preregCommit: 'c', pins: {}, manifestHash: 'm', inputsHash: 'i', calibrationHash: 'k', inventory: {}, createdAt: AT });
  const [rid] = store.enqueueRuns(db, cid, [{ ordinal: 0, configId: 'B1', variant: 'base', configHash: 'h' }], AT);
  const run = store.claimNextRun(db, cid, 'w', AT);
  assert.equal(run.id, rid);
  store.finishRun(db, rid, { status: 'done', summary: { a: 1 }, at: AT, durationMs: 1, codeRevision: 'x' });
  assert.throws(() => db.exec(`UPDATE es_runs SET summary_json = '{}' WHERE id = ${rid}`), /never changed/);
  assert.throws(() => db.exec('DELETE FROM es_runs'), /never deleted/);
  assert.throws(() => db.exec('DELETE FROM es_campaigns'), /never deleted/);
  store.insertPlacebo(db, { campaignId: cid, configId: 'B1', resamples: 10, seed: 1, tObs: 1, countGe: 2, p: 0.27, failed: 0, unclustered: 0, durationMs: 1 }, AT);
  assert.throws(() => db.exec('UPDATE es_placebo SET p = 0.01'), /append-only/);
  db.close();
});

test('the lock lets one worker in at a time; a stale lock can be taken over', () => {
  const db = store.openEsDb(path.join(tempDir('es-'), 'event-swing.sqlite'));
  assert.equal(store.takeLock(db, { token: 'a', at: AT, staleMs: 60000 }).ok, true);
  assert.equal(store.takeLock(db, { token: 'b', at: AT, staleMs: 60000 }).ok, false);
  const later = new Date(Date.parse(AT) + 120000).toISOString();
  assert.equal(store.takeLock(db, { token: 'b', at: later, staleMs: 60000 }).ok, true);
  assert.equal(store.releaseLock(db, 'a'), false);
  assert.equal(store.releaseLock(db, 'b'), true);
  db.close();
});

test('the pins match the committed files and detect a changed copy; the matrix check refuses a wrong window or an unknown comparator', () => {
  assert.equal(pinStatus().ok, true);
  const root = tempDir('es-pins-');
  fs.mkdirSync(path.join(root, 'strategy', 'event-swing'), { recursive: true });
  for (const name of Object.keys(PREREG.sha256)) fs.copyFileSync(path.join(path.dirname(CAMPAIGN_PATH), name), path.join(root, 'strategy', 'event-swing', name));
  assert.equal(pinStatus({ root }).ok, true);
  fs.appendFileSync(path.join(root, 'strategy', 'event-swing', 'CAMPAIGN-1.md'), '\nedited\n');
  const st = pinStatus({ root });
  assert.equal(st.ok, false);
  assert.equal(st.files.find((f) => f.name === 'CAMPAIGN-1.md').problem, 'differs from the pinned SHA-256');
  const m = loadMatrix();
  assert.equal(m.configurations.length, 16);
  assert.deepEqual(validateMatrix(m), []);
  assert.match(validateMatrix({ ...m, shared: { ...m.shared, window: { from: '2016-01-04', to: '2022-06-30', eventsFrom: '2015-01-01' } } }).join(' '), /shared.window/);
  assert.match(validateMatrix({ ...m, comparators: { ...m.comparators, B1: { baseline: 'ZZ', control: null } } }).join(' '), /ZZ/);
  assert.notEqual(configHash(configFor(m, 'B1')), configHash(configFor(m, 'B2')));
  assert.equal(configHash({ ...configFor(m, 'B1'), label: 'renamed' }), configHash(configFor(m, 'B1')), 'labels are descriptive and outside the hash');
});

test('the log reader finds the inventory, the code-frozen entry and run rows outside fences and comments', () => {
  const hex = 'a'.repeat(64), c40 = 'b'.repeat(40);
  const text = ['# log', '', '## 1 | 2026-11-06 | **The order**', 'text', '## 2 | 2026-11-07 | **Event inventory** (counts)', 'x',
    `## 3 | 2026-11-07 | **Code frozen for campaign 1**`, `code revision: \`es-code-2026-11-06-1\`; pre-registration commit: \`${c40}\`; data manifest hash: \`${hex}\``,
    '```', `**Run** run id: 9, config: B1, config hash: ${hex}, status: done; variant: base`, '```',
    `## 4 | 2026-11-07 | **Run** run id: 1, config: B1, config hash: ${hex}, status: done; variant: base`, '<!-- **Run** run id: 2, config: B1, config hash: ' + hex + ', status: done; variant: base -->'].join('\n');
  const st = logStatus(text);
  assert.equal(st.ordered, true); assert.equal(st.nextNumber, 5);
  assert.deepEqual(st.inventory, [2]);
  assert.deepEqual(st.frozen, [{ number: 3, codeRevision: 'es-code-2026-11-06-1', commit: c40, manifest: hex }]);
  assert.deepEqual(st.runs.map((r) => [r.runId, r.config, r.variant]), [[1, 'B1', 'base']]);
});

test('the window bound: a date after 2021-12-31 is refused wherever it is asserted', () => {
  assert.equal(assertInWindow('2021-12-31'), '2021-12-31');
  assert.throws(() => assertInWindow('2022-01-03'), /after the bound 2021-12-31/);
  assert.throws(() => assertInWindow('2022-01-03 08:00:00', 'acceptance'), /acceptance 2022-01-03/);
});
