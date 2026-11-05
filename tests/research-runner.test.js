// The research runner on synthetic market data (the fake Alpaca market downloaded into a temp HXR database
// through HXR's own service, as the range-trend tests do). Synthetic prices only exercise the code; nothing here
// is a result. Covers: the campaign lifecycle (create, start, pause, resume, cancel), the worker loop and its
// budget stop, the baseline comparison and labels, notification deduplication, the data bound, the accounting
// check, the null test's determinism, recovery, and the refusal of test overrides without the flag.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { buildMarket } from './hxr-fake-alpaca.js';
import { hxrData } from './rangetrend-fixtures.js';
import { createRunner, nullTest, accountingCheck, compare, leaderOf, mulberry32, EXPECTED_BASELINE_NET } from '../server/research/runner.js';
import { LIMITS, CRITERIA, BASELINE_FILE, LABELS, STAGES, PLANS } from '../server/research/config.js';
import { createResearch } from '../server/research/service.js';
import { main as workerMain } from '../scripts/research-worker.mjs';

const DOC = `# Campaign 1 (test copy)\n\nBaseline ${BASELINE_FILE}. Budget ${LIMITS.maxConfigs} configurations or ${LIMITS.maxHours} hours. Drawdown limit ${CRITERIA.maxDrawdownPct}%. Minimum ${CRITERIA.minCompletedTrades} completed trades.\n`;
const FAST = { ...CRITERIA, nullResamples: 40 };
let dir, docFile, hxr;
before(async () => {
  dir = tempDir('rr-');
  docFile = path.join(dir, 'campaign.md');
  fs.writeFileSync(docFile, DOC);
  ({ hxr } = await hxrData(dir, buildMarket()));
});
after(() => { try { hxr?.close?.(); } catch { /* ignore */ } });
let seq = 0;
const clock = () => new Date(Date.UTC(2026, 10, 4, 12, 0, seq++));
// A test plan registry: campaign-1 with the temp document, small budgets and few resamples; campaign-3 likewise.
const plansWith = ({ maxConfigs = 4, criteria = FAST, limits = {}, doc = null } = {}) => ({
  'campaign-1': { ...PLANS['campaign-1'], doc: doc ?? docFile, limits: { ...LIMITS, maxConfigs, ...limits }, criteria },
  'campaign-3': { ...PLANS['campaign-3'], doc: doc ?? docFile, limits: { ...PLANS['campaign-3'].limits, maxConfigs: Math.max(maxConfigs, 26), ...limits }, criteria: { ...criteria, nullResamples: 20 } },
});
const runner = (opts = {}) => { const { maxConfigs, criteria, limits, doc, ...rest } = opts; return createRunner({ dataDir: dir, clock, plans: plansWith({ maxConfigs, criteria, limits, doc }), expectedBaselineNet: null, testOverrides: true, ...rest }); };

test('test overrides need the flag; the document must be ready; a campaign queues the baseline first', () => {
  assert.throws(() => createRunner({ dataDir: dir }), /testOverrides: true/);
  const bad = path.join(dir, 'bad.md'); fs.writeFileSync(bad, '# x\n[OWNER TO SET]\n');
  assert.throws(() => runner({ doc: bad }).createCampaign(), /not ready/);
  const rr = runner();
  const c = rr.createCampaign({ name: 'T' });
  assert.equal(c.queued, 4);
  const exps = rr.experiments(c.id).items;
  assert.equal(exps[0].name, BASELINE_FILE.replace(/\.json$/, ''));
  assert.ok(exps.every((e) => e.status === 'queued' && e.stage === STAGES.reference));
  assert.equal(rr.campaignStatus(c.id).status, 'planned');
  rr.close();
});

test('the worker runs the queue on synthetic data: baseline recorded, every result compared, the budget stops the campaign as done, nothing beyond the development period', () => {
  const rr = runner();
  const c = rr.createCampaign();
  const seen = [];
  const out = rr.runWorker(c.id, { onExperiment: (e) => seen.push(e) });
  assert.equal(out.reason, 'budget');
  const st = rr.campaignStatus(c.id);
  assert.equal(st.status, 'done');
  assert.match(st.stopReason, /budget of 4/);
  assert.equal(st.counts.done, 4);
  assert.ok(st.baseline && st.baseline.id === rr.experiments(c.id).items[0].id);
  assert.match(st.hashes.data, /^[0-9a-f]{64}$/);
  assert.equal(st.worker, null, 'the worker released the campaign');
  for (const e of rr.experiments(c.id).items) {
    assert.equal(e.status, 'done');
    assert.ok(Number.isFinite(e.summary.net));
    assert.ok(e.summary.labels.includes(LABELS.DEVELOPMENT));
    assert.ok(!e.summary.labels.includes(LABELS.EVALUATED), 'never set by the runner');
    assert.equal(e.summary.comparison.baselineExperimentId, st.baseline.id);
    assert.equal(e.dataHash, st.hashes.data);
  }
  const full = rr.experiment(st.baseline.id);
  assert.equal(full.config.period.end, '2021-12-31');
  assert.ok(full.equity.length > 100 && full.equity.every((p) => p.date <= '2021-12-31' && p.date >= '2017-10-02'));
  assert.ok(full.equity.every((p) => p.indexValue != null));
  assert.equal(full.summary.accounting.ok, true);
  assert.equal(full.summary.comparison.diffUsd, 0, 'the baseline against itself');
  assert.equal(full.summary.comparison.criteria.improvement.ok, false);
  assert.ok(rr.events(c.id).some((ev) => /every planned experiment|budget/.test(ev.message)));
  // A second worker on a finished campaign does nothing.
  assert.match(rr.runWorker(c.id).reason, /campaign is done/);
  rr.close();
});

test('pause stops between experiments and resume continues; cancel drops the queue and keeps results; a live worker blocks a second', () => {
  const rr = runner({ maxConfigs: 6 });
  const c = rr.createCampaign();
  let n = 0;
  const out = rr.runWorker(c.id, { until: () => n++ >= 2 });
  assert.equal(out.reason, 'until');
  let st = rr.campaignStatus(c.id);
  assert.equal(st.status, 'paused');
  assert.equal(st.counts.done, 2);
  assert.equal(rr.runWorker(c.id).reason, 'paused');
  rr.resume(c.id);
  assert.equal(rr.campaignStatus(c.id).status, 'running');
  rr.pause(c.id);
  assert.throws(() => rr.pause(c.id), /cannot be set paused/);
  rr.resume(c.id);
  const out2 = rr.runWorker(c.id, { until: () => true });
  assert.equal(out2.reason, 'until');
  rr.resume(c.id);
  rr.cancel(c.id);
  st = rr.campaignStatus(c.id);
  assert.equal(st.status, 'cancelled');
  assert.equal(st.counts.cancelled, 4);
  assert.equal(st.counts.done, 2);
  assert.match(rr.runWorker(c.id).reason, /cancelled/);
  rr.close();
});

test('recovery: an experiment left running by a dead worker is re-queued and run by the next worker; a live claim is respected', () => {
  const rr = runner({ maxConfigs: 3, limits: { staleHeartbeatMs: 1 } });
  const c = rr.createCampaign();
  // Simulate a dead worker: claim one experiment and walk away.
  const db = rr.db;
  db.prepare("UPDATE rr_experiments SET status = 'running', attempts = 1, claimed_by = 'dead', heartbeat_at = '2026-01-01T00:00:00.000Z' WHERE campaign_id = ? AND ordinal = 2").run(c.id);
  const out = rr.runWorker(c.id);
  assert.equal(out.reason, 'budget');
  const exps = rr.experiments(c.id).items;
  assert.ok(exps.every((e) => e.status === 'done'));
  assert.equal(exps[1].attempts, 2);
  assert.ok(rr.events(c.id).some((ev) => /recovery: re-queued/.test(ev.message)));
  rr.close();
});

test('the comparison and labels: target, shortlist, exposure attribution, inapplicable ratio, notification deduplication and the leader rule', () => {
  const sum = (net, over = {}) => ({ net, maxDrawdownPct: 5, completedTrades: 40, accounting: { ok: true, reconciliation: { difference: 0 } }, bestFive: { K: 2, adjustedNet: net - 100 }, nullTest: { p: 0.01 }, topStock: { symbol: 'A', share: 0.3 }, exposureMatched: { net: 100 }, ...over });
  const baseline = { id: 1, name: 'base', summary: sum(1000) };
  const good = compare(sum(1200, { exposureMatched: { net: 120 } }), { baseline });
  assert.equal(good.clearsTarget, true); assert.equal(good.shortlisted, true);
  assert.equal(good.improvementPct, 20); assert.equal(good.exposureGainUsd, 20); assert.equal(good.decisionGainUsd, 180);
  assert.deepEqual(good.labels, [LABELS.DEVELOPMENT, LABELS.SHORTLISTED]);
  const weak = compare(sum(1050), { baseline });
  assert.equal(weak.clearsTarget, false); assert.deepEqual(weak.failed, ['improvement', 'stress']);
  const deepDd = compare(sum(1500, { maxDrawdownPct: 16 }), { baseline });
  assert.equal(deepDd.clearsTarget, false); assert.ok(deepDd.failed.includes('drawdown'));
  const fewTrades = compare(sum(1500, { completedTrades: 29 }), { baseline });
  assert.ok(fewTrades.failed.includes('trades') && !fewTrades.clearsTarget);
  const concentrated = compare(sum(1500, { topStock: { symbol: 'A', share: 0.41 } }), { baseline });
  assert.equal(concentrated.clearsTarget, true); assert.equal(concentrated.shortlisted, false); assert.ok(concentrated.failed.includes('concentration'));
  const exposureOnly = compare(sum(1500, { exposureMatched: { net: 700 } }), { baseline });
  assert.equal(exposureOnly.clearsTarget, true); assert.equal(exposureOnly.shortlisted, false); assert.equal(exposureOnly.decisionGainUsd, -100);
  const stressFail = compare(sum(1500, { bestFive: { K: 2, adjustedNet: 900 } }), { baseline });
  assert.ok(stressFail.failed.includes('stress') && !stressFail.shortlisted);
  const nullFail = compare(sum(1500, { nullTest: { p: 0.2 } }), { baseline });
  assert.ok(nullFail.failed.includes('nullTest'));
  const smallBase = compare(sum(500), { baseline: { id: 1, name: 'b', summary: sum(50) } });
  assert.equal(smallBase.improvementApplicable, false); assert.equal(smallBase.improvementPct, null); assert.equal(smallBase.diffUsd, 450); assert.equal(smallBase.clearsTarget, false);
  const negBase = compare(sum(500), { baseline: { id: 1, name: 'b', summary: sum(-200) } });
  assert.equal(negBase.improvementApplicable, false);
  const vs = compare(sum(1300), { baseline, leader: { id: 7, name: 'L', summary: sum(1250) } });
  assert.deepEqual(vs.vsLeader, { leaderId: 7, leaderName: 'L', leaderNet: 1250, diffUsd: 50, pct: 4 });
  // The leader: highest net among those clearing the target; else among those within the risk conditions; else the baseline.
  const mk = (id, net, over = {}) => ({ id, name: `e${id}`, status: 'done', summary: { ...sum(net, over), comparison: compare(sum(net, over), { baseline }) } });
  assert.equal(leaderOf([mk(2, 1050), mk(3, 1200), mk(4, 1300, { maxDrawdownPct: 20 })], baseline).id, 3);
  assert.equal(leaderOf([mk(2, 1050), mk(4, 1300, { maxDrawdownPct: 20 })], baseline).id, 2);
  assert.equal(leaderOf([mk(4, 1300, { maxDrawdownPct: 20 })], baseline).id, 1);
});

test('notifications: the first clearing result notifies, a tiny new high does not, a step does; every one is labelled not validated', () => {
  const rr = runner({ maxConfigs: 2 });
  const c = rr.createCampaign();
  rr.runWorker(c.id);
  // Drive the notification rule directly through the database contents: set the baseline and summaries by hand.
  const db = rr.db;
  const exps = rr.experiments(c.id).items;
  const base = exps[0];
  const fake = (id, net, over = {}) => { const e = db.prepare('SELECT summary_json FROM rr_experiments WHERE id = ?').get(id); const s = JSON.parse(e.summary_json); s.net = net; s.maxDrawdownPct = 5; s.completedTrades = 40; s.accounting = { ok: true, reconciliation: { difference: 0 } }; s.exposureMatched = { net: 100 }; Object.assign(s, over); s.comparison = compare(s, { baseline: { id: base.id, name: base.name, summary: { ...s, net: 1000, exposureMatched: { net: 100 } } } }); db.prepare('UPDATE rr_experiments SET summary_json = ? WHERE id = ?').run(JSON.stringify(s), id); return { ...rr.experiment(id) }; };
  const notifyFor = (exp) => rr.notifyFor(c.id, exp);
  notifyFor(fake(exps[1].id, 1050));
  assert.equal(rr.notifications({ campaignId: c.id }).length, 0, 'under the target: nothing');
  notifyFor(fake(exps[1].id, 1200));
  assert.equal(rr.notifications({ campaignId: c.id }).length, 1);
  notifyFor(fake(exps[1].id, 1200));
  assert.equal(rr.notifications({ campaignId: c.id }).length, 1, 'the same experiment never notifies twice');
  notifyFor({ ...fake(exps[1].id, 1230), id: 999 });
  assert.equal(rr.notifications({ campaignId: c.id }).length, 1, 'a new high under the step (5% of 1000 = 50) does not notify');
  notifyFor({ ...fake(exps[1].id, 1260), id: 998 });
  let notes = rr.notifications({ campaignId: c.id });
  assert.equal(notes.length, 2);
  assert.ok(notes.every((n) => /not yet validated/.test(n.title)));
  // A shortlisted result gets its own notification, once.
  const shortlisted = { ...fake(exps[1].id, 1400, { bestFive: { K: 2, adjustedNet: 1300 }, nullTest: { p: 0.01 }, topStock: { symbol: 'A', share: 0.2 }, exposureMatched: { net: 110 } }), id: 997 };
  assert.equal(shortlisted.summary.comparison.shortlisted, true);
  notifyFor(shortlisted); notifyFor(shortlisted);
  notes = rr.notifications({ campaignId: c.id });
  assert.equal(notes.length, 4);
  assert.equal(notes.filter((n) => n.kind === 'shortlisted').length, 1);
  assert.equal(rr.markSeen([notes[0].id]), 1);
  assert.equal(rr.notifications({ unseenOnly: true }).length, 3);
  rr.close();
});

test('the null test is deterministic for a seed, p lies in (0, 1], and the accounting check catches a broken ledger', () => {
  const rr = runner({ maxConfigs: 1 });
  const c = rr.createCampaign();
  rr.runWorker(c.id);
  const e = rr.experiment(rr.experiments(c.id).items[0].id);
  const nt = e.summary.nullTest;
  assert.ok(nt.p > 0 && nt.p <= 1); assert.equal(nt.resamples, FAST.nullResamples); assert.equal(nt.seed, CRITERIA.nullSeed);
  const r1 = mulberry32(7)(), r2 = mulberry32(7)();
  assert.equal(r1, r2);
  assert.ok(Math.abs(mulberry32(1)() - 0.6270739405881613) < 1e-12);
  // The accounting check on a synthetic result.
  const good = { equity: [{ date: 'a', equity: 100, cash: 100 }, { date: 'b', equity: 110, cash: 50 }], openPositions: [{ pnl: 4 }] };
  assert.equal(accountingCheck(good, { startValue: 100, endValue: 110, netTradePnl: 6, postExitPaid: 0, costs: 1 }).ok, true);
  // Post-exit dividends are inside the stored trade P/L and must not be added again (campaign 1's false stop).
  assert.equal(accountingCheck(good, { startValue: 100, endValue: 110, netTradePnl: 6, postExitPaid: 2.5, costs: 1 }).ok, true);
  const bad = accountingCheck(good, { startValue: 100, endValue: 110, netTradePnl: 1, postExitPaid: 0, costs: 1 });
  assert.equal(bad.ok, false); assert.match(bad.problems[0], /does not reconcile/);
  assert.equal(accountingCheck({ equity: [{ date: 'a', equity: 100, cash: -1 }], openPositions: [] }, { startValue: 100, endValue: 100, netTradePnl: 0, postExitPaid: 0, costs: 0 }).ok, false);
  rr.close();
});

test('the service and the worker script: the demo refuses, the real wrapper spawns a detached worker with a log file, and the script creates and reports', async () => {
  const demo = createResearch({ mode: 'demo', cfg: { dataDir: dir } });
  assert.equal(demo.overview().demo, true);
  assert.throws(() => demo.createCampaign(), /demo workspace/);
  const spawned = [];
  const svc = createResearch({ mode: 'real', cfg: { dataDir: dir } }, { spawnImpl: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { pid: 4242, unref() {} }; }, runnerOpts: { clock, plans: plansWith({ maxConfigs: 2 }), expectedBaselineNet: null } });
  const c = svc.createCampaign({ name: 'svc' });
  const started = svc.start(c.id);
  assert.equal(started.campaign.status, 'running');
  assert.equal(started.worker.spawned, true);
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0].args.some((a) => /research-worker\.mjs$/.test(a)) && spawned[0].args.includes(String(c.id)));
  assert.equal(spawned[0].opts.detached, true);
  assert.ok(fs.existsSync(path.join(dir, 'research-logs', `campaign-${c.id}.log`)));
  assert.equal(svc.pause(c.id).campaign.status, 'paused');
  assert.equal(svc.cancel(c.id).campaign.status, 'cancelled');
  assert.throws(() => svc.start(c.id), /cannot be set running/);
  svc.close();
  // The script against an injected runner: --create then a run with a time cap.
  const logs = [];
  const rr = runner({ maxConfigs: 2 });
  const made = await workerMain(['--create'], { runner: rr, log: (m) => logs.push(m) });
  assert.equal(made.exitCode, 0);
  const ran = await workerMain(['--campaign', String(made.campaignId)], { runner: rr, log: (m) => logs.push(m) });
  assert.equal(ran.exitCode, 0); assert.equal(ran.reason, 'budget');
  assert.ok(logs.some((l) => /worker stopped: budget; campaign done/.test(l)));
  const st = await workerMain(['--campaign', String(made.campaignId), '--status'], { runner: rr, log: (m) => logs.push(m) });
  assert.equal(st.exitCode, 0);
  assert.equal((await workerMain(['--bogus'], { runner: rr, log: () => {} })).exitCode, 1);
  rr.close();
});

test('the baseline must reproduce the expected figure when one is set: a mismatch stops the campaign', () => {
  const rr = runner({ expectedBaselineNet: EXPECTED_BASELINE_NET });
  const c = rr.createCampaign();
  const out = rr.runWorker(c.id);
  assert.match(out.reason, /did not reproduce/);
  const st = rr.campaignStatus(c.id);
  assert.equal(st.status, 'stopped');
  assert.equal(st.counts.done, 1);
  assert.equal(st.counts.cancelled, 3);
  rr.close();
});

test('the research modules never import delivery, alerts, the broker-facing or the portfolio code', () => {
  for (const f of ['config.js', 'store.js', 'space.js', 'runner.js', 'service.js', 'api.js']) {
    const src = fs.readFileSync(path.join('server', 'research', f), 'utf8');
    assert.doesNotMatch(src, /delivery\.js|alerts\.js|portfolio\.js|importer\.js|openDb\(/, f);
  }
  const worker = fs.readFileSync(path.join('scripts', 'research-worker.mjs'), 'utf8');
  assert.doesNotMatch(worker, /delivery\.js|alerts\.js/);
});

test('campaign 3 under a test plan: the 24 configurations are queued with family parents, the mechanisms run on synthetic data, Holm is applied at completion with raw and adjusted p kept apart, and defect replacements are bounded', () => {
  const doc3 = path.join(dir, 'campaign-3.md');
  fs.writeFileSync(doc3, `# Campaign 3 (test copy)\n\nBaseline ${BASELINE_FILE}, +1,757.90. 24 planned configurations; cap 30; 2 hours; 15%; 30 completed trades; 20,000 resamples; Holm.\n`);
  const rr = runner({ doc: doc3, maxConfigs: 30 });
  const c = rr.createCampaign({ plan: 'campaign-3' });
  assert.equal(c.plan, 'campaign-3'); assert.equal(c.queued, 24);
  const items = rr.experiments(c.id, { limit: 50 }).items;
  assert.equal(items[0].name, BASELINE_FILE.replace(/\.json$/, ''));
  const b0 = items.find((e) => e.name === 'B0'), m0 = items.find((e) => e.name === 'M0');
  assert.ok(items.filter((e) => e.stage === 2 && e.name.startsWith('B')).every((e) => e.parentId === b0.id));
  assert.ok(items.filter((e) => e.stage === 2 && e.name.startsWith('M')).every((e) => e.parentId === m0.id));
  const out = rr.runWorker(c.id);
  assert.equal(out.reason, 'complete');
  const st = rr.campaignStatus(c.id);
  assert.equal(st.status, 'done'); assert.equal(st.counts.done + st.counts.failed, 24); assert.equal(st.counts.failed, 0, rr.experiments(c.id, { status: 'failed' }).items.map((e) => e.error).join('; '));
  assert.equal(st.plan, 'campaign-3'); assert.equal(st.holm.m, 24);
  assert.ok(st.holm.withP <= 24 && st.holm.rawPasses >= 0);
  const done = rr.experiments(c.id, { status: 'done', limit: 50 }).items;
  for (const e of done.filter((e) => e.summary.nullP != null)) {
    assert.ok(e.summary.holm && e.summary.holm.adjustedP >= e.summary.nullP - 1e-12, `${e.name}: Holm-adjusted p is never below the raw p`);
    assert.equal(e.summary.holm.m, 24);
    const sh = e.summary.labels.includes(LABELS.SHORTLISTED), hm = e.summary.labels.includes(LABELS.HOLM);
    if (hm) assert.ok(e.summary.holm.adjustedP <= 0.05);
    void sh;
  }
  const mech = done.find((e) => e.name.startsWith('B1'));
  assert.ok(mech.summary.comparison.vsFamilyBaseline && mech.summary.comparison.vsFamilyBaseline.id === b0.id, 'compared with its family baseline');
  const full = rr.experiment(mech.id);
  assert.equal(full.config.strategy, 'mechanism'); assert.equal(full.config.period.end, '2021-12-31');
  assert.equal(full.summary.accounting.ok, true);
  // Defect replacements: text required, at most six, a replacement cannot be replaced, the campaign reopens as paused.
  assert.throws(() => rr.replaceDefective(c.id, mech.id, { defect: '', verification: 'v', correction: 'c' }), /defect must be non-empty/);
  const rep = rr.replaceDefective(c.id, mech.id, { defect: 'synthetic defect', verification: 'seen in the test', correction: 'none needed' });
  assert.equal(rep.used, 1); assert.equal(rep.max, 6); assert.equal(rep.campaignStatus, 'paused');
  assert.throws(() => rr.replaceDefective(c.id, mech.id, { defect: 'd', verification: 'v', correction: 'c' }), /already has a replacement/);
  assert.throws(() => rr.replaceDefective(c.id, rep.id, { defect: 'd', verification: 'v', correction: 'c' }), /only a done or failed/);
  rr.resume(c.id);
  const out2 = rr.runWorker(c.id);
  assert.equal(out2.reason, 'complete');
  const r = rr.experiment(rep.id);
  assert.equal(r.status, 'done'); assert.equal(r.replacementOf, mech.id); assert.equal(r.stage, 3); assert.match(r.hypothesis, /Defect replacement/);
  assert.equal(rr.campaignStatus(c.id).replacements.used, 1);
  // The plain campaign-3 document on disk is refused while it is marked DRAFT or lacks a required string.
  const draft = path.join(dir, 'draft.md'); fs.writeFileSync(draft, '# Campaign 3 (DRAFT)\n\nx\n');
  assert.throws(() => runner({ doc: draft }).createCampaign({ plan: 'campaign-3' }), /DRAFT|does not name/);
  rr.close();
});
