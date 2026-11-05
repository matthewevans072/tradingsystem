// The research runner's service for the app: a thin wrapper over runner.js for the real workspace, plus the
// background worker process (scripts/research-worker.mjs), spawned detached so a campaign runs independently of
// the web request and of any chat session. The demo workspace gets a stub that refuses every call. Nothing here
// sends a notification outside the app: notifications are rows in the runner's own database that the dashboard
// reads; the optional browser notification is the browser's own, shown only while the page is open.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRunner, ResearchError } from './runner.js';
import { LIMITS } from './config.js';

export { ResearchError };
const WORKER_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'research-worker.mjs');

export function createResearch(ctx, { spawnImpl = spawn, runnerOpts = {} } = {}) {
  if (ctx.mode === 'demo') {
    const refuse = () => { throw new ResearchError(409, 'The research runner runs on real market data in the real workspace only; the demo workspace has no campaigns.'); };
    return { overview: () => ({ simulated: true, demo: true, campaigns: [], active: null, unseenNotifications: 0, note: 'Demo workspace: the research runner is not available here.' }), createCampaign: refuse, start: refuse, pause: refuse, resume: refuse, cancel: refuse, experiments: refuse, experiment: refuse, notifications: () => [], markSeen: () => 0, events: () => [], close: () => {} };
  }
  const runner = createRunner({ dataDir: ctx.cfg.dataDir, ...runnerOpts, testOverrides: Object.keys(runnerOpts).length > 0 });

  function spawnWorker(campaignId) {
    const c = runner.getCampaign(campaignId);
    if (!c) throw new ResearchError(404, `campaign ${campaignId} does not exist`);
    const alive = runner.campaignStatus(campaignId).worker;
    if (alive) return { spawned: false, worker: alive, note: 'a worker is already running this campaign' };
    fs.mkdirSync(runner.logDir, { recursive: true });
    const logFile = path.join(runner.logDir, `campaign-${campaignId}.log`);
    const out = fs.openSync(logFile, 'a');
    const child = spawnImpl(process.execPath, ['--disable-warning=ExperimentalWarning', WORKER_SCRIPT, '--campaign', String(campaignId)], { cwd: path.dirname(WORKER_SCRIPT), detached: true, stdio: ['ignore', out, out], windowsHide: true, env: { ...process.env, SIGNAL_DESK_DATA_DIR: ctx.cfg.dataDir } });
    child.unref();
    try { fs.closeSync(out); } catch { /* the child holds its own handle */ }
    return { spawned: true, pid: child.pid, logFile: path.relative(ctx.cfg.dataDir, logFile) };
  }

  return {
    overview: () => runner.overview(),
    createCampaign: (opts) => runner.createCampaign(opts),
    // start/resume set the status and launch a background worker if none is alive; pause/cancel set the status
    // and the worker stops between experiments.
    start: (id) => { runner.start(id); return { campaign: runner.campaignStatus(id), worker: spawnWorker(id) }; },
    resume: (id) => { runner.resume(id); return { campaign: runner.campaignStatus(id), worker: spawnWorker(id) }; },
    pause: (id) => ({ campaign: (runner.pause(id), runner.campaignStatus(id)), note: 'the worker stops after the experiment in progress' }),
    cancel: (id) => ({ campaign: (runner.cancel(id), runner.campaignStatus(id)), note: 'queued experiments cancelled; the one in progress finishes and is kept' }),
    campaignStatus: (id) => runner.campaignStatus(id),
    experiments: (id, opts) => runner.experiments(id, opts),
    experiment: (id) => runner.experiment(id),
    notifications: (opts) => runner.notifications(opts),
    markSeen: (ids) => runner.markSeen(ids),
    events: (id, limit) => runner.events(id, limit),
    limits: LIMITS,
    close: () => runner.close(),
    runner,
  };
}

export function attachResearch(ctx, opts = {}) {
  let svc = null;
  Object.defineProperty(ctx, 'research', { configurable: true, enumerable: false, get: () => (svc ||= createResearch(ctx, opts)) });
  Object.defineProperty(ctx, 'researchIfOpen', { configurable: true, enumerable: false, get: () => svc });
  return ctx;
}
