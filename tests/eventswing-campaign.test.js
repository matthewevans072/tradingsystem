// event-swing campaign 1 end to end on synthetic data (server/eventswing/campaign.js, service.js): the gate opens only
// with complete event data, the inventory record and the code-frozen record; the worker runs every configuration and
// sensitivity, saves each run, logs it, runs the placebo for the Holm family (descriptive-only members skipped),
// applies Holm and the selection, writes the report and the in-app notifications; the execution cap checkpoints and
// a second worker resumes. The run uses 20 placebo resamples instead of 2,000 (a test setting). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { createEventSwing, NOTIFICATION_TITLE } from '../server/eventswing/campaign.js';
import { createEventSwingService } from '../server/eventswing/service.js';
import { logStatus } from '../server/eventswing/config.js';
import * as store from '../server/eventswing/store.js';
import { synthMarket, setBar, fakeHxrDb, MATRIX } from './eventswing-fixtures.js';

const TEXTS = { raised: '<p>We are raising our full-year outlook.</p>', lowered: '<p>We are lowering our guidance.</p>', reaffirmed: '<p>We reaffirm our guidance.</p>', none: '<p>Quarterly results.</p>' };
function setup({ resamples = 20 } = {}) {
  const dir = tempDir('es-camp-');
  const m = synthMarket({ seed: 3, from: '2016-01-04', to: '2021-12-31', syms: ['AAA', 'BBB', 'CCC'], vol: 0.03 });
  const db = store.openEsDb(path.join(dir, 'event-swing.sqlite'));
  db.exec('BEGIN');
  const at = '2026-11-06T20:00:00.000Z';
  let n = 0, k = 0;
  const add = (symbol, D, acceptedEt, cls) => {
    const accession = `0000000001-${D.slice(2, 4)}-${String(++n).padStart(6, '0')}`;
    store.insertListing(db, [{ accession, symbol, cik: 1, form: '8-K', filingDate: acceptedEt.slice(0, 10), itemsDesc: 'items 2.02 and 9.01', indexUrl: `https://www.sec.gov/${accession}-index.htm`, companyName: symbol }], at);
    store.insertFiling(db, { accession, symbol, cik: 1, form: '8-K', filingDate: acceptedEt.slice(0, 10), acceptedEt, reportDate: D, items: ['2.02', '9.01'], exhibitType: 'EX-99.1', exhibitUrl: `https://www.sec.gov/${accession}.htm`, status: 'ok' }, at);
    store.insertDocument(db, cls ? { accession, url: 'u', status: 'ok', httpStatus: 200, body: TEXTS[cls] } : { accession, url: null, status: 'missing', body: null }, at);
  };
  for (const [j, s] of ['AAA', 'BBB', 'CCC'].entries()) {
    for (const D of ['2015-02-02', '2015-04-27', '2015-07-27', '2015-10-26']) add(s, D, `${D} 16:05:00`, 'none');
    const own = m.stockSessions[s];
    for (let i = 20 + (j === 2 ? 9 : 0); i < own.length - 2; i += 63, k++) {
      // D = the session before availability; acceptance after its close; the reaction alternates -8% and +8%.
      const D = own[i - 1], pre = m.days.get(own[i - 2]).bars[s].c;
      const c = pre * (k % 2 ? 1.08 : 0.92);
      setBar(m, s, own[i], { o: c, h: c, l: c, c });
      add(s, D, `${D} 16:05:00`, ['raised', 'lowered', 'reaffirmed', null][k % 4]);
    }
  }
  store.insertDownload(db, { startedAt: at, finishedAt: at, status: 'complete', requests: 0, summary: { problems: [], symbols: ['AAA', 'BBB', 'CCC'] } });
  db.exec('COMMIT');
  db.close();
  const samples = [];
  for (const s of ['AAA', 'BBB', 'CCC']) for (let y = 2016; y <= 2021; y++) samples.push({ symbol: s, date: `${y}-01-04`, bps: 3 });
  const hdb = fakeHxrDb(dir, { inputs: m, samples });
  const logFile = path.join(dir, 'EXPERIMENT-LOG.md');
  fs.writeFileSync(logFile, '# log\n\n## 1 | 2026-11-06 | **The order**\n\ntext\n');
  // Three synthetic stocks: three sleeves of US$5,000 (the real campaign has ten stocks and ten sleeves).
  const matrix = { ...MATRIX, shared: { ...MATRIX.shared, portfolio: { ...MATRIX.shared.portfolio, sleeves: 3 } }, inference: { ...MATRIX.inference, resamples } };
  const es = createEventSwing({ dataDir: dir, dbFile: path.join(dir, 'event-swing.sqlite'), testOverrides: true, overrides: { matrix, hxrDb: hdb, universe: m.symbols, excluded: [], skipGit: true, logFile, reportDir: path.join(dir, 'reports') } });
  return { dir, es, hdb, logFile, m };
}
const cond = (g, name) => g.conditions.find((c) => c.name === name);

test('the gate, the records, the whole campaign through the worker, the placebo, Holm, the selection, the notifications, the report and the log', async () => {
  const { es, hdb, logFile, dir } = setup();
  try {
    assert.throws(() => createEventSwing({ dataDir: dir, overrides: { skipGit: true } }), /testOverrides/);
    let g = es.gateStatus();
    assert.equal(g.ok, false);
    assert.equal(cond(g, 'event data complete').ok, true);
    assert.equal(cond(g, 'event inventory recorded').ok, false);
    assert.throws(() => es.freezeEntry(), /cannot freeze: event inventory recorded/);
    assert.throws(() => es.createCampaign(), /gate is closed/);
    const inv = es.inventory();
    assert.ok(inv.inventory.total.usable >= 60);
    assert.equal(inv.descriptive.B3.descriptiveOnly, true, 'no negative reaction comes with lowered guidance here');
    assert.equal(inv.descriptive.B1.descriptiveOnly, false);
    es.recordInventory();
    assert.throws(() => es.recordInventory(), /already recorded/);
    es.freezeEntry();
    g = es.gateStatus();
    assert.equal(g.ok, true, g.conditions.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; '));
    const c = es.createCampaign();
    assert.throws(() => es.createCampaign(), /already exists/);
    const done = await es.runWorker({ campaignId: c.id });
    assert.equal(done.status, 'done');
    const st = es.status();
    assert.equal(st.runs.length, 48);
    assert.deepEqual([...new Set(st.runs.map((r) => r.status))], ['done']);
    const placebo = new Map(st.placebo.map((p) => [p.configId, p]));
    assert.equal(placebo.size, 10);
    assert.equal(placebo.get('B3').details.skipped, 'descriptive only');
    for (const id of ['A1', 'B1', 'C1', 'D2', 'D3']) { const p = placebo.get(id); assert.equal(p.resamples, 20); assert.ok(p.p >= 1 / 21 && p.p <= 1); }
    const holm = st.campaign.holm;
    assert.deepEqual(Object.keys(holm), MATRIX.holmFamily);
    assert.equal(holm.B3.candidate, false); assert.ok(holm.B3.failed.includes('sample'));
    for (const n of st.notifications) assert.equal(n.title, NOTIFICATION_TITLE);
    const log = logStatus(fs.readFileSync(logFile, 'utf8'));
    assert.equal(log.runs.length, 48);
    assert.ok(log.ordered);
    assert.match(fs.readFileSync(logFile, 'utf8'), /\*\*Campaign 1 complete\*\*/);
    const report = fs.readFileSync(path.join(dir, 'reports', `campaign-${c.id}.md`), 'utf8');
    assert.match(report, /\*\*Outcome:\*\*/);
    assert.match(report, /Does the news information add anything\?/);
    for (const w of ['profitable', 'live-ready']) assert.ok(!report.toLowerCase().includes(w));
    const a1 = es.status().runs.find((r) => r.configId === 'A1' && r.variant === 'base');
    assert.ok(a1.net != null);
    assert.equal(es.gateStatus().conditions.find((x) => x.name === 'every recorded run logged').ok, true);
  } finally { es.close(); hdb.close(); }
});

test('the execution cap stops the campaign after a checkpoint; a later worker resumes and finishes; the app service reports the blocker without event data', async () => {
  const { es, hdb } = setup({ resamples: 5 });
  try {
    es.recordInventory(); es.freezeEntry();
    const c = es.createCampaign();
    const stopped = await es.runWorker({ campaignId: c.id, maxExecutionMs: 1 });
    assert.equal(stopped.status, 'stopped');
    assert.match(stopped.stopReason, /execution budget/);
    const st = es.status();
    assert.ok(st.runs.filter((r) => r.status === 'done').length >= 1 && st.runs.some((r) => r.status === 'queued'));
    const finished = await es.runWorker({ campaignId: c.id });
    assert.equal(finished.status, 'done');
    assert.equal(es.status().runs.filter((r) => r.status === 'done').length, 48);
  } finally { es.close(); hdb.close(); }
  const dir = tempDir('es-svc-');
  const svc = createEventSwingService({ mode: 'real', cfg: { dataDir: dir, secContactEmail: '' } }, { dbFile: path.join(dir, 'event-swing.sqlite') });
  const o = svc.overview();
  assert.match(o.blocker, /SEC_CONTACT_EMAIL is not set/);
  assert.equal(o.campaign, null);
  svc.close();
  assert.equal(createEventSwingService({ mode: 'demo', cfg: {} }).overview().demo, true);
});
