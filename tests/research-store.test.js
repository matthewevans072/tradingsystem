// The research runner's database: the file guard, the job queue's atomic claim and duplicate refusal, recovery
// of interrupted experiments, notifications and the worker ownership. Synthetic rows only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from './helpers.js';
import * as store from '../server/research/store.js';

const at = (s = 0) => new Date(Date.UTC(2026, 10, 4, 12, 0, s)).toISOString();
function campaign(db) {
  return store.insertCampaign(db, { name: 'test', docSha256: 'a'.repeat(64), codeRevision: 'rr-test', engineVersion: 'e', period: { start: '2017-10-02' }, limits: { maxConfigs: 5 }, criteria: {}, baselineFile: 'b.json', at: at() });
}
const item = (n, stage = 1) => ({ stage, name: `exp-${n}`, hypothesis: `h${n}`, baseFile: 'b.json', change: [{ field: 'x', from: 1, to: n }], configHash: `h${n}`.padEnd(64, '0'), config: { n } });

test('the guard refuses the portfolio, demo, Strategy Lab, HXR, range-trend, sweep-bos and ICT Lab files, links to them and foreign tables', () => {
  const dir = tempDir('rr-');
  for (const name of ['signal-desk.sqlite', 'demo.sqlite', 'strategy-lab.sqlite', 'strategy-lab-demo.sqlite', 'hxr-sim.sqlite', 'range-trend-sim.sqlite', 'sweep-bos-sim.sqlite', 'ict-lab-sim.sqlite']) {
    assert.throws(() => store.openRrDb(path.join(dir, name)), /never opens/, name);
  }
  const foreign = path.join(dir, 'other.sqlite');
  const f = new DatabaseSync(foreign); f.exec('CREATE TABLE hxr_runs (id INTEGER)'); f.close();
  assert.throws(() => store.openRrDb(foreign), /tables that are not the runner's/);
  const target = path.join(dir, 'hxr-sim.sqlite');
  fs.writeFileSync(target, '');
  const link = path.join(dir, 'link.sqlite');
  let linked = false;
  try { fs.symlinkSync(target, link); linked = true; } catch { /* no symlink privilege on this Windows account */ }
  if (linked) assert.throws(() => store.openRrDb(link), /never opens/);
  const db = store.openRrDb(path.join(dir, 'research-runner.sqlite'));
  assert.equal(db.prepare('SELECT version FROM rr_schema_version').get().version, 1);
  db.close();
});

test('the queue: a configuration is queued once per campaign, claims are atomic and ordered by stage, and finishing records status and provenance', () => {
  const dir = tempDir('rr-');
  const db = store.openRrDb(path.join(dir, 'research-runner.sqlite'));
  const id = campaign(db);
  const r1 = store.enqueue(db, id, [item(1, 0), item(2), item(3)], at());
  assert.deepEqual([r1.added.length, r1.skipped.length], [3, 0]);
  const r2 = store.enqueue(db, id, [item(2), item(4)], at(1));
  assert.deepEqual([r2.added.length, r2.skipped], [1, ['exp-2']]);
  assert.equal(store.countExperiments(db, id).queued, 4);
  const a = store.claimNext(db, id, 'w1', at(2));
  assert.equal(a.name, 'exp-1'); // stage 0 first
  assert.equal(a.status, 'running');
  const b = store.claimNext(db, id, 'w2', at(2));
  assert.notEqual(b.id, a.id, 'two claims never return the same experiment');
  assert.equal(store.countExperiments(db, id).running, 2);
  store.finishExperiment(db, a.id, { status: 'done', metrics: { x: 1 }, summary: { net: 5 }, at: at(3), durationMs: 10, provenance: { codeRevision: 'rr-test', dataHash: 'd'.repeat(64) } });
  const got = store.getExperiment(db, a.id);
  assert.equal(got.status, 'done'); assert.equal(got.summary.net, 5); assert.equal(got.data_hash, 'd'.repeat(64)); assert.equal(got.attempts, 1);
  store.finishExperiment(db, b.id, { status: 'failed', error: 'boom', at: at(3) });
  assert.equal(store.getExperiment(db, b.id).error, 'boom');
  assert.throws(() => store.finishExperiment(db, b.id, { status: 'weird', at: at(3) }), /unknown experiment status/);
  // Cancelling leaves done and failed rows alone.
  assert.equal(store.cancelQueued(db, id, at(4)), 2);
  assert.deepEqual(store.countExperiments(db, id), { queued: 0, running: 0, done: 1, failed: 1, cancelled: 2, total: 4 });
  db.close();
});

test('recovery: an experiment left running by a dead worker is re-queued once, then failed; a live heartbeat is left alone', () => {
  const dir = tempDir('rr-');
  const db = store.openRrDb(path.join(dir, 'research-runner.sqlite'));
  const id = campaign(db);
  store.enqueue(db, id, [item(1), item(2)], at());
  const a = store.claimNext(db, id, 'dead', at(0));
  const b = store.claimNext(db, id, 'alive', at(0));
  store.experimentHeartbeat(db, b.id, at(100));
  const rec = store.recoverInterrupted(db, id, { at: at(130), staleMs: 60_000 });
  assert.deepEqual(rec, { requeued: [a.id], failed: [] });
  assert.equal(store.getExperiment(db, b.id).status, 'running');
  const again = store.claimNext(db, id, 'w3', at(131));
  assert.equal(again.id, a.id); assert.equal(again.attempts, 2);
  const rec2 = store.recoverInterrupted(db, id, { at: at(400), staleMs: 60_000 });
  assert.deepEqual(rec2.failed, [a.id]);
  assert.match(store.getExperiment(db, a.id).error, /interrupted twice/);
  db.close();
});

test('worker ownership: one live worker per campaign; a stale heartbeat can be taken over; release needs the token', () => {
  const dir = tempDir('rr-');
  const db = store.openRrDb(path.join(dir, 'research-runner.sqlite'));
  const id = campaign(db);
  const w1 = store.claimWorker(db, id, { pid: 1, at: at(0), staleMs: 60_000 });
  assert.ok(w1.token);
  assert.equal(store.claimWorker(db, id, { pid: 2, at: at(10), staleMs: 60_000 }), null);
  assert.ok(store.workerAlive(db, id, { at: at(10), staleMs: 60_000 }));
  assert.equal(store.workerAlive(db, id, { at: at(100), staleMs: 60_000 }), null);
  const w2 = store.claimWorker(db, id, { pid: 2, at: at(100), staleMs: 60_000 });
  assert.ok(w2 && w2.token !== w1.token);
  assert.equal(store.releaseWorker(db, id, w1), false);
  assert.equal(store.releaseWorker(db, id, w2), true);
  db.close();
});

test('notifications deduplicate by key, persist with seen state, and events and settings round-trip', () => {
  const dir = tempDir('rr-');
  const db = store.openRrDb(path.join(dir, 'research-runner.sqlite'));
  const id = campaign(db);
  const n1 = store.insertNotification(db, { campaignId: id, experimentId: 1, kind: 'target', title: 't', body: 'b', dedupeKey: 'target:1:1', at: at() });
  assert.ok(n1);
  assert.equal(store.insertNotification(db, { campaignId: id, experimentId: 1, kind: 'target', title: 't', body: 'b', dedupeKey: 'target:1:1', at: at(1) }), null);
  assert.equal(store.listNotifications(db, { unseenOnly: true }).length, 1);
  assert.equal(store.markSeen(db, [n1], at(2)), 1);
  assert.equal(store.listNotifications(db, { unseenOnly: true }).length, 0);
  assert.equal(store.listNotifications(db, {})[0].seen_at, at(2));
  store.logEvent(db, { campaignId: id, message: 'hello', at: at(3) });
  assert.equal(store.listEvents(db, id)[0].message, 'hello');
  store.setSetting(db, 'k', { a: 1 }, at(4)); store.setSetting(db, 'k', { a: 2 }, at(5));
  assert.deepEqual(store.getSetting(db, 'k'), { a: 2 });
  db.close();
});
