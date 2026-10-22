// HXR database: the file guard (portfolio and Strategy Lab names refused
// case-insensitively and through symlinks, foreign tables refused without
// writing), migrations, news first-seen times, the append-only ledger and
// experiment log, frozen versions, runs and the prospective account.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import { NO_HOST_KEYS } from './no-host-keys.js';
import { loadConfig } from '../server/config.js';
import * as store from '../server/hxr/store.js';

const openTemp = () => {
  const dir = tempDir('hxr-store-');
  const file = path.join(dir, 'hxr-sim.sqlite');
  return { dir, file, db: store.openHxrDb(file) };
};

test('hxrDbFile is data/hxr-sim.sqlite of the configured data directory', () => {
  const dir = tempDir('hxr-cfg-');
  const cfg = loadConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir });
  assert.equal(store.hxrDbFile(cfg), path.join(dir, 'hxr-sim.sqlite'));
});

test('guard: portfolio and Strategy Lab file names are refused case-insensitively and never created', () => {
  const dir = tempDir('hxr-guard-');
  for (const name of ['signal-desk.sqlite', 'SIGNAL-DESK.SQLITE', 'Signal-Desk.sqlite', 'demo.sqlite', 'DEMO.sqlite', 'strategy-lab.sqlite', 'Strategy-Lab-demo.sqlite', 'strategy-lab-copy.db']) {
    assert.throws(() => store.openHxrDb(path.join(dir, name)), /never opens the portfolio or Strategy Lab/, name);
    assert.throws(() => store.openHxrDb(path.join(dir, name), { readOnly: true }), /never opens/, name);
    assert.ok(!fs.existsSync(path.join(dir, name)), `${name} was not created`);
  }
  assert.equal(store.isRefusedName('hxr-sim.sqlite'), false);
  assert.equal(store.isRefusedName('signal-desk.sqlite.bak'), false);
});

test('guard: a symlink to a portfolio file, a dangling symlink and a symlinked directory are resolved first', () => {
  const dir = tempDir('hxr-link-');
  const portfolio = path.join(dir, 'signal-desk.sqlite');
  const p = new DatabaseSync(portfolio);
  p.exec('CREATE TABLE holdings (id INTEGER PRIMARY KEY, symbol TEXT)');
  p.exec("INSERT INTO holdings (symbol) VALUES ('MU')");
  p.close();
  const before = fs.readFileSync(portfolio);

  const link = path.join(dir, 'hxr-sim.sqlite');
  fs.symlinkSync(portfolio, link);
  assert.throws(() => store.openHxrDb(link), /never opens the portfolio/);
  assert.throws(() => store.openHxrDb(link, { readOnly: true }), /never opens the portfolio/);

  // Upper-case target behind a link.
  const lab = path.join(dir, 'STRATEGY-LAB.sqlite');
  fs.writeFileSync(lab, '');
  const link2 = path.join(dir, 'other.sqlite');
  fs.symlinkSync(lab, link2);
  assert.throws(() => store.openHxrDb(link2), /never opens/);

  // A dangling link would create its target when opened.
  const dangling = path.join(dir, 'dangling.sqlite');
  fs.symlinkSync(path.join(dir, 'demo.sqlite'), dangling);
  assert.throws(() => store.openHxrDb(dangling), /dangling symlink/);
  assert.ok(!fs.existsSync(path.join(dir, 'demo.sqlite')));

  // A symlinked directory: the name inside it is still checked.
  const real = path.join(dir, 'real');
  fs.mkdirSync(real);
  fs.symlinkSync(real, path.join(dir, 'linked'));
  const viaLink = store.openHxrDb(path.join(dir, 'linked', 'hxr-sim.sqlite'));
  viaLink.close();
  assert.ok(fs.existsSync(path.join(real, 'hxr-sim.sqlite')));
  assert.equal(store.guardHxrFile(path.join(dir, 'linked', 'hxr-sim.sqlite')), path.join(fs.realpathSync(real), 'hxr-sim.sqlite'));

  assert.deepEqual(fs.readFileSync(portfolio), before, 'the portfolio file is byte-for-byte unchanged');
});

test('guard: an existing database with tables that are not HXR\'s is refused without being written to', () => {
  const dir = tempDir('hxr-foreign-');
  const file = path.join(dir, 'portfolio-copy.sqlite');
  const p = new DatabaseSync(file);
  p.exec('CREATE TABLE holdings (id INTEGER PRIMARY KEY, symbol TEXT); CREATE TABLE hxr_bars (x INTEGER)');
  p.close();
  const before = fs.readFileSync(file);
  assert.throws(() => store.openHxrDb(file), /holds tables that are not HXR's \(holdings\)/);
  assert.throws(() => store.openHxrDb(file, { readOnly: true }), /not HXR's/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.ok(!fs.existsSync(`${file}-wal`));

  const lab = path.join(dir, 'renamed.sqlite');
  const l = new DatabaseSync(lab);
  l.exec('CREATE TABLE lab_bars (symbol TEXT)');
  l.close();
  assert.throws(() => store.openHxrDb(lab), /lab_bars/);
  // A read-only open of a file that does not exist is refused (nothing created).
  assert.throws(() => store.openHxrDb(path.join(dir, 'missing.sqlite'), { readOnly: true }), /does not exist/);
  assert.ok(!fs.existsSync(path.join(dir, 'missing.sqlite')));
});

test('migrations: every table is hxr_, reopening is idempotent and keeps the data', () => {
  const { file, db } = openTemp();
  assert.equal(store.schemaVersion(db), store.MIGRATION_COUNT);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  assert.ok(tables.every((t) => t.startsWith('hxr_')), tables.join(','));
  for (const t of ['hxr_bars', 'hxr_first15', 'hxr_corporate_actions', 'hxr_spread_samples', 'hxr_news', 'hxr_news_symbols', 'hxr_versions', 'hxr_runs',
    'hxr_fills', 'hxr_decisions', 'hxr_episodes', 'hxr_equity', 'hxr_ledger', 'hxr_experiments', 'hxr_prospective', 'hxr_prospective_events', 'hxr_settings']) {
    assert.ok(tables.includes(t), t);
  }
  store.setSetting(db, 'spcxConfirmed', false);
  db.close();
  const again = store.openHxrDb(file);
  assert.equal(store.schemaVersion(again), store.MIGRATION_COUNT);
  assert.equal(store.getSetting(again, 'spcxConfirmed'), false);
  assert.equal(store.getSetting(again, 'missing', 'fallback'), 'fallback');
  again.close();
  const ro = store.openHxrDb(file, { readOnly: true });
  assert.equal(store.getSetting(ro, 'spcxConfirmed'), false);
  assert.throws(() => store.setSetting(ro, 'x', 1), /readonly/i);
  ro.close();
});

test('bars, first 15-minute bars, corporate actions and spread samples', () => {
  const { db } = openTemp();
  const bars = [
    { date: '2024-03-01', o: 10, h: 11, l: 9.5, c: 10.5, v: 1000, n: 10, vw: 10.2 },
    { date: '2024-03-04', o: 10.5, h: 11, l: 10, c: 10.8, v: 0, n: 0, vw: null },
  ];
  assert.deepEqual(store.upsertBars(db, 'MU', bars, { fetchedAt: '2026-10-22T20:30:00Z' }), { inserted: 2, updated: 0 });
  assert.deepEqual(store.upsertBars(db, 'MU', [{ ...bars[1], c: 10.9 }]), { inserted: 0, updated: 1 });
  assert.deepEqual(store.getBars(db, 'MU').map((b) => [b.date, b.c, b.v]), [['2024-03-01', 10.5, 1000], ['2024-03-04', 10.9, 0]]);
  assert.deepEqual(store.getBars(db, 'MU', { from: '2024-03-02' }).map((b) => b.date), ['2024-03-04']);
  assert.equal(db.prepare('SELECT source, feed, adjustment FROM hxr_bars LIMIT 1').get().adjustment, 'raw');
  assert.throws(() => store.upsertBars(db, 'MU', [{ date: '2024/03/05', o: 1, h: 1, l: 1, c: 1 }]), /YYYY-MM-DD/);
  assert.throws(() => store.upsertBars(db, 'MU', [{ date: '2024-03-05', o: 1, h: 1, l: 1, c: null }]), /c must be a number/);
  assert.equal(store.getBars(db, 'MU').length, 2, 'a failed batch stores nothing');
  assert.deepEqual(store.barSummary(db).map((s) => [s.symbol, s.bars, s.first, s.last]), [['MU', 2, '2024-03-01', '2024-03-04']]);
  assert.equal(store.lastBarDate(db, 'MU'), '2024-03-04');

  store.upsertFirst15(db, 'MU', [{ date: '2024-03-01', o: 10, h: 10.2, l: 9.9, c: 10.1, v: 50, vw: 10.05 }]);
  assert.deepEqual(store.getFirst15(db, 'MU'), [{ date: '2024-03-01', o: 10, h: 10.2, l: 9.9, c: 10.1, v: 50, vw: 10.05 }]);

  const actions = [
    { id: 's1', type: 'forward_split', symbol: 'AMZN', ex_date: '2022-06-06', pay_date: '2022-06-03', process_date: '2022-06-06', ratio_old: 1, ratio_new: 20, raw: { id: 's1' } },
    { id: 'n1', type: 'name_change', symbol: 'META', ex_date: null, process_date: '2022-06-09', old_symbol: 'FB', new_symbol: 'META', raw: {} },
    { id: 'd1', type: 'cash_dividend', symbol: 'META', ex_date: '2024-02-21', pay_date: '2024-03-26', rate: 0.5, raw: {} },
  ];
  assert.deepEqual(store.upsertCorporateActions(db, actions), { inserted: 3, updated: 0 });
  assert.deepEqual(store.upsertCorporateActions(db, [actions[2]]), { inserted: 0, updated: 1 });
  assert.deepEqual(store.listCorporateActions(db, { symbol: 'META' }).map((a) => a.id), ['n1', 'd1']);
  assert.deepEqual(store.listCorporateActions(db, { symbol: 'FB' }).map((a) => a.id), ['n1'], 'an old symbol finds the name change');
  assert.deepEqual(store.listCorporateActions(db, { types: ['forward_split'] }).map((a) => [a.id, a.ratio_new, a.raw.id]), [['s1', 20, 's1']]);

  store.upsertSpreadSamples(db, [
    { symbol: 'MU', date: '2024-03-01', quotes: 120, dropped: 3, medianSpreadBps: 4, medianHalfSpreadBps: 2, window: '09:30:00-09:31:00 ET' },
    { symbol: 'MU', date: '2024-01-02', quotes: 0, dropped: 5, medianSpreadBps: null, medianHalfSpreadBps: null },
  ]);
  assert.deepEqual(store.listSpreadSamples(db, 'MU').map((s) => [s.date, s.quotes, s.medianHalfSpreadBps]), [['2024-01-02', 0, null], ['2024-03-01', 120, 2]]);
});

test('news: inserted once; first_seen_at and backfilled keep their first values; filters by symbol, created and seen times', () => {
  const { db } = openTemp();
  const item = (id, created, symbols, headline = `headline ${id}`) => ({ id, created_at: created, updated_at: created, headline, summary: '', source: 'Benzinga', url: 'https://example.com/n', symbols });
  const first = [item(1, '2026-10-21T13:00:00Z', ['MU']), item(2, '2026-10-21T15:50:00Z', ['MU', 'AMZN']), item(3, '2026-10-19T12:00:00Z', ['TSLA'])];
  assert.equal(store.insertNews(db, first, { seenAt: '2026-10-21T16:00:00Z' }), 3);
  // Seen again later, with an edited headline: nothing changes.
  assert.equal(store.insertNews(db, [item(1, '2026-10-21T13:00:00Z', ['MU', 'NVDA'], 'edited'), item(4, '2026-10-22T13:00:00Z', ['MU'])], { seenAt: '2026-10-22T13:10:00Z' }), 1);
  const all = store.newsFor(db, {});
  assert.deepEqual(all.map((n) => n.id), ['4', '2', '1', '3']);
  const one = all.find((n) => n.id === '1');
  assert.equal(one.headline, 'headline 1');
  assert.equal(one.first_seen_at, '2026-10-21T16:00:00.000Z');
  assert.deepEqual(one.symbols, ['MU']);
  assert.equal(one.backfilled, true, 'seen 3 hours after it was created');
  assert.equal(all.find((n) => n.id === '2').backfilled, false, 'seen 10 minutes after');
  assert.equal(all.find((n) => n.id === '4').backfilled, false);
  assert.deepEqual(store.newsFor(db, { symbol: 'AMZN' }).map((n) => n.id), ['2']);
  assert.deepEqual(store.newsFor(db, { symbol: 'NVDA' }), [], 'the re-insert did not add links');
  assert.deepEqual(store.newsFor(db, { symbol: 'MU', createdFrom: '2026-10-21T00:00:00Z', createdTo: '2026-10-21T23:59:59Z' }).map((n) => n.id), ['2', '1']);
  assert.deepEqual(store.newsFor(db, { symbol: 'MU', seenBy: '2026-10-21T20:00:00Z' }).map((n) => n.id), ['2', '1'], 'item 4 was first seen later');
  assert.throws(() => store.insertNews(db, [{ created_at: '2026-10-21T13:00:00Z' }]), /needs an id/);
});

test('ledger and experiment log are append-only; frozen versions never change', () => {
  const { db } = openTemp();
  const e = { kind: 'selection', prereg: 'hxr-prereg-1', version: 'c1-0.1.0', configHash: 'h1', runIds: [1, 2], at: '2026-10-22T20:00:00Z' };
  store.appendLedger(db, e);
  store.appendLedger(db, { ...e, kind: 'evaluation', contaminated: true, reason: 'repeat' });
  assert.equal(store.countLedger(db, 'selection', 'hxr-prereg-1', 'c1-0.1.0', 'h1'), 1);
  assert.equal(store.countLedger(db, 'evaluation', 'hxr-prereg-1', 'c1-0.1.0', 'h1'), 1);
  assert.equal(store.countLedger(db, 'evaluation', 'hxr-prereg-1', 'c1-0.1.0', 'other'), 0);
  assert.deepEqual(store.listLedger(db).map((x) => [x.kind, x.contaminated, x.runIds]), [['selection', false, [1, 2]], ['evaluation', true, [1, 2]]]);
  assert.throws(() => db.exec('DELETE FROM hxr_ledger'), /append-only/);
  assert.throws(() => db.exec('UPDATE hxr_ledger SET contaminated = 0'), /append-only/);
  assert.throws(() => store.appendLedger(db, { ...e, kind: 'variant' }), /CHECK constraint/);
  assert.throws(() => store.appendLedger(db, { ...e, configHash: '' }), /needs configHash/);
  assert.equal(store.listLedger(db).length, 2);

  store.appendExperiment(db, { at: '2026-10-22T12:00:00Z', what: 'pre-registration', dataTouched: 'none', resultsSeen: 'none' });
  assert.deepEqual(store.listExperiments(db).map((x) => [x.what, x.resultsSeen]), [['pre-registration', 'none']]);
  assert.throws(() => db.exec('DELETE FROM hxr_experiments'), /append-only/);
  assert.throws(() => db.exec("UPDATE hxr_experiments SET note = 'x'"), /append-only/);

  const v = store.saveVersion(db, { version: 'hxr-1.0.0', config: { rule: { type: 'hold' } }, configHash: 'abc', basedOn: 'c1-0.1.0', prereg: 'hxr-prereg-1', frozenAt: '2026-10-23T00:00:00Z' });
  assert.equal(v.configHash, 'abc');
  assert.deepEqual(store.saveVersion(db, { version: 'hxr-1.0.0', config: {}, configHash: 'abc', prereg: 'hxr-prereg-1' }), v, 'saving the same version again is a no-op');
  assert.throws(() => store.saveVersion(db, { version: 'hxr-1.0.0', config: {}, configHash: 'def', prereg: 'hxr-prereg-1' }), /already frozen with another config/);
  assert.throws(() => db.exec("UPDATE hxr_versions SET config_hash = 'x'"), /cannot be changed/);
  assert.throws(() => db.exec('DELETE FROM hxr_versions'), /cannot be removed/);
  assert.deepEqual(store.listVersions(db).map((x) => x.version), ['hxr-1.0.0']);
  assert.equal(store.getVersion(db, 'nope'), null);
});

test('runs with their fills, decisions, episodes and equity', () => {
  const { db } = openTemp();
  const id = store.createRun(db, { kind: 'selection', label: 'C1', version: 'c1-0.1.0', configHash: 'h', config: { a: 1 }, basket: 'A', symbols: ['MU'], period: { start: '2017-10-02' }, fillModel: 'open', delay: 1, dataHash: 'd', calibrationHash: 'c', createdAt: '2026-10-22T00:00:00Z' });
  assert.throws(() => store.createRun(db, { kind: 'holdout', version: 'v', configHash: 'h' }), /CHECK constraint/);
  store.updateRun(db, id, { status: 'done', metrics: { endValue: 1 }, details: { x: 1 }, finishedAt: '2026-10-22T00:01:00Z', ignored: 5 });
  const r = store.getRun(db, id);
  assert.deepEqual([r.kind, r.status, r.metrics, r.details, r.config, r.symbols, r.period, r.delay, r.contaminated], ['selection', 'done', { endValue: 1 }, { x: 1 }, { a: 1 }, ['MU'], { start: '2017-10-02' }, 1, false]);
  assert.equal(store.getRun(db, id, { full: false }).config, undefined);
  const id2 = store.createRun(db, { kind: 'variant', version: 'c1-0.1.0', configHash: 'h2' });
  assert.deepEqual(store.listRuns(db).map((x) => x.id), [id2, id]);
  assert.deepEqual(store.listRuns(db, { kind: 'selection' }).map((x) => x.id), [id]);
  assert.equal(store.failInterruptedRuns(db, '2026-10-22T01:00:00Z'), 1);
  assert.equal(store.getRun(db, id2).status, 'failed');

  const fills = [{ id: 'f2', date: '2017-10-03', symbol: 'MU', side: 'sell', shares: 10, price: 30 }, { id: 'f1', date: '2017-10-02', symbol: 'MU', side: 'buy', shares: 10, price: 29, raw: 28.99 }];
  assert.deepEqual(store.insertFills(db, id, fills), { inserted: 2, duplicates: 0 });
  assert.deepEqual(store.insertFills(db, id, [fills[0]]), { inserted: 0, duplicates: 1 });
  assert.deepEqual(store.listFills(db, id).map((f) => f.id), ['f1', 'f2']);
  assert.equal(store.listFills(db, id)[0].raw, 28.99, 'the whole item comes back');
  store.insertDecisions(db, id, [{ id: 'd1', decisionDate: '2017-10-02', symbol: 'MU', action: 'exit', numbers: { sma: 1 } }]);
  assert.deepEqual(store.listDecisions(db, id, { symbol: 'MU' }), [{ id: 'd1', decisionDate: '2017-10-02', symbol: 'MU', action: 'exit', numbers: { sma: 1 } }]);
  store.insertEpisodes(db, id, [{ id: 'e1', symbol: 'MU', startDate: '2017-10-02', endDate: '2017-10-03', pnl: 10 }]);
  assert.equal(store.listEpisodes(db, id)[0].pnl, 10);
  store.insertEquity(db, id, [{ date: '2017-10-02', equity: 15000, cash: 10, invested: 14990, sleevesOut: 0, receivable: 0 }, { date: '2017-10-03', equity: 15010, cash: 300, invested: 14710, sleevesOut: 1, receivable: 0 }]);
  assert.deepEqual(store.listEquity(db, id, { from: '2017-10-03' }).map((p) => p.equity), [15010]);
});

test('the one prospective account and its de-duplicated events', () => {
  const { db } = openTemp();
  assert.equal(store.getProspective(db), null);
  const p = { version: 'hxr-1.0.0', configHash: 'h', startedAt: '2026-11-02T22:00:00Z', startDate: '2026-11-03', symbols: ['MU', 'AMZN'], state: { arms: {} }, status: 'running' };
  assert.equal(store.saveProspective(db, p, { create: true }).startDate, '2026-11-03');
  assert.throws(() => store.saveProspective(db, p, { create: true }), /already exists/);
  store.saveProspective(db, { ...p, lastProcessed: '2026-11-03' });
  assert.equal(store.getProspective(db).lastProcessed, '2026-11-03');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hxr_prospective').get().n, 1);

  const ev = [
    { key: 'hxr:decision:MU:2026-11-03', kind: 'decision', arm: 'hxr', date: '2026-11-03', symbol: 'MU', recordedAt: '2026-11-03T21:00:00Z', onTime: true, detail: { action: 'exit' } },
    { key: 'hxr:warning:2026-11-03', kind: 'warning', date: '2026-11-03', recordedAt: '2026-11-03T21:00:00Z', onTime: true },
  ];
  assert.deepEqual(store.insertProspectiveEvents(db, ev), { inserted: 2, duplicates: 0 });
  assert.deepEqual(store.insertProspectiveEvents(db, [ev[0]]), { inserted: 0, duplicates: 1 }, 'no duplicate orders');
  const listed = store.listProspectiveEvents(db, { kind: 'decision' });
  assert.deepEqual(listed.map((e) => [e.key, e.onTime, e.detail.action, e.recordedAt]), [['hxr:decision:MU:2026-11-03', true, 'exit', '2026-11-03T21:00:00.000Z']]);
  assert.equal(store.listProspectiveEvents(db).length, 2);
});
