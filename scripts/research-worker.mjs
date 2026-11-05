#!/usr/bin/env node
// The research runner's background worker: runs one campaign's queued experiments until the queue is empty, the
// campaign is paused or cancelled, a limit is hit, or --max-minutes passes (then the campaign is paused so it can
// be resumed). Independent of the web server and of any chat session: the app launches it detached, and it can
// be launched by hand. A simulation only on HXR's development-period data (read-only); it never opens any other
// window, never places an order and never sends anything outside the app.
//
//   node scripts/research-worker.mjs --campaign <id> [--max-minutes N] [--create] [--status]
//
// --create makes a new campaign from the pre-registered document and prints its id (nothing runs); --status
// prints the campaign's status and exits.
import { createRunner, ResearchError } from '../server/research/runner.js';
import { LIMITS } from '../server/research/config.js';

function parseArgs(argv) {
  const o = { campaign: null, maxMinutes: null, create: false, status: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--campaign') o.campaign = Number(argv[++i]);
    else if (a === '--max-minutes') o.maxMinutes = Number(argv[++i]);
    else if (a === '--create') o.create = true;
    else if (a === '--status') o.status = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

export async function main(argv = process.argv.slice(2), { runner = null, log = console.log } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { log(`error: ${e.message}`); return { exitCode: 1, error: e.message }; }
  const rr = runner ?? createRunner();
  try {
    if (o.create) { const c = rr.createCampaign({}); log(`campaign ${c.id} created: ${c.queued} experiments queued, document ${c.docSha256.slice(0, 12)}; nothing ran`); return { exitCode: 0, campaignId: c.id }; }
    if (!Number.isInteger(o.campaign) || o.campaign < 1) throw new Error('--campaign <id> is required');
    if (o.status) { log(JSON.stringify(rr.campaignStatus(o.campaign), null, 1)); return { exitCode: 0 }; }
    const started = Date.now();
    const until = () => (o.maxMinutes != null && Date.now() - started > o.maxMinutes * 60_000);
    log(`worker pid ${process.pid} on campaign ${o.campaign}: limits ${LIMITS.maxConfigs} configs / ${LIMITS.maxHours} h; simulation only`);
    const out = rr.runWorker(o.campaign, { until, onExperiment: (e) => log(`${new Date().toISOString()} experiment ${e.id} ${e.name}: ${e.stop ? `STOP ${e.stop}` : e.failed ? 'failed' : `done net ${e.summary?.net} dd ${e.summary?.maxDrawdownPct}% trades ${e.summary?.completedTrades}${e.summary?.comparison?.clearsTarget ? ' CLEARS TARGET' : ''}`}`) });
    const st = rr.campaignStatus(o.campaign);
    log(`worker stopped: ${out.reason}; campaign ${st.status}${st.stopReason ? ` (${st.stopReason})` : ''}; ${st.counts.done} done, ${st.counts.failed} failed, ${st.counts.queued} queued, ${st.counts.cancelled} cancelled; ${st.cleared} clear the target, ${st.shortlisted} shortlisted`);
    return { exitCode: 0, reason: out.reason };
  } catch (e) {
    log(`error: ${e instanceof ResearchError ? e.message : e.stack || e.message}`);
    return { exitCode: 1, error: e.message };
  } finally { if (!runner) rr.close(); }
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((o) => process.exit(o.exitCode));
}
