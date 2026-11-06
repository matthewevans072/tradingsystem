#!/usr/bin/env node
// event-swing command line (strategy/event-swing/CAMPAIGN-1.md). Simulation only.
//   npm run es:check                      the gate, condition by condition (default)
//   npm run es:download                   the bounded SEC EDGAR download (needs SEC_CONTACT_EMAIL in .env; never printed)
//   npm run es:inventory [-- --record]    the event counts before any run; --record appends the log entry
//   npm run es:freeze -- --record         appends the "Code frozen for campaign 1" entry
//   npm run es:campaign -- --create --confirm     creates campaign 1 and queues its runs (the gate must be open)
//   npm run es:campaign -- --start --confirm      starts the detached worker for campaign 1
//   npm run es:worker -- --campaign 1     the worker in the foreground (what --start launches)
//   npm run es:status                     runs, placebo, notifications
//   npm run es:report -- --campaign 1     rewrites the report from the stored results
//   npm run es:repro                      D0 against campaign 3's experiment 191, read-only
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { createEventSwing, reproduceD0, inventoryMarkdown } from '../server/eventswing/campaign.js';
import { createSecClient } from '../server/eventswing/sec.js';
import { downloadEvents } from '../server/eventswing/pipeline.js';
import { loadClassifier } from '../server/eventswing/config.js';

const SELF = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'check';
const out = (s) => process.stdout.write(`${s}\n`);

async function main() {
  const cfg = loadConfig();
  if (cmd === 'repro') {
    const r = reproduceD0({ dataDir: cfg.dataDir });
    out(`D0 (event-swing engine, no pause) net ${r.eventSwingNet}; rr-mech-1 on experiment 191's stored config ${r.rrMech1Net}; stored net ${r.storedNet}; ${r.trades} trades, ${r.fills} fills; trades identical: ${r.tradesEqual}; research database unchanged: ${r.researchDbUnchanged}`);
    out(r.reproduces ? 'REPRODUCES to the cent' : 'DOES NOT REPRODUCE');
    process.exitCode = r.reproduces && r.researchDbUnchanged ? 0 : 1;
    return;
  }
  const es = createEventSwing({ dataDir: cfg.dataDir });
  try {
    if (cmd === 'check') {
      const g = es.gateStatus();
      for (const c of g.conditions) out(`${c.ok ? 'OK  ' : 'NO  '} ${c.name}: ${c.detail}`);
      out(g.ok ? 'The gate is open.' : 'The gate is closed.');
      process.exitCode = g.ok ? 0 : 2;
    } else if (cmd === 'download') {
      let sec;
      try { sec = createSecClient({ contactEmail: cfg.secContactEmail }); } catch (e) { out(e.message); process.exitCode = 2; return; }
      const row = await downloadEvents({ db: es.db, sec, classifier: loadClassifier(), log: out });
      out(`download ${row.status}: ${row.requests} requests to SEC EDGAR${row.summary.problems.length ? `; ${row.summary.problems.length} problem(s):` : ''}`);
      for (const p of row.summary.problems.slice(0, 30)) out(`  ${p}`);
      process.exitCode = row.status === 'complete' ? 0 : 2;
    } else if (cmd === 'inventory') {
      if (has('--record')) { const r = es.recordInventory(); out(`appended log entry ${r.number}`); out(r.text); }
      else out(inventoryMarkdown(es.inventory()));
    } else if (cmd === 'freeze') {
      if (!has('--record')) { out('es:freeze appends the code-frozen entry: add --record'); process.exitCode = 2; return; }
      const r = es.freezeEntry();
      out(`appended log entry ${r.number}`); out(r.text);
    } else if (cmd === 'campaign') {
      if (!has('--confirm')) { out('add --confirm: creating or starting the campaign runs the simulations'); process.exitCode = 2; return; }
      if (has('--create')) { const c = es.createCampaign(); out(`campaign ${c.id} created; ${es.status().runs.length} runs queued`); }
      if (has('--start')) {
        const c = es.status().campaign;
        if (!c) { out('no campaign: run with --create first'); process.exitCode = 2; return; }
        const logDir = path.join(cfg.dataDir, 'event-swing-logs');
        fs.mkdirSync(logDir, { recursive: true });
        const fd = fs.openSync(path.join(logDir, `campaign-${c.id}.log`), 'a');
        const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SELF, 'worker', '--campaign', String(c.id)], { cwd: path.dirname(SELF), detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: process.env });
        child.unref();
        out(`worker started (pid ${child.pid}); progress on the Research page and in data/event-swing-logs/campaign-${c.id}.log`);
      }
    } else if (cmd === 'worker') {
      const id = Number(val('--campaign'));
      const c = await es.runWorker({ campaignId: id, log: (s) => out(`${new Date().toISOString()} ${s}`) });
      out(`campaign ${c.id}: ${c.status}${c.stopReason ? ` (${c.stopReason})` : ''}`);
    } else if (cmd === 'status') {
      const s = es.status();
      out(`data: ${s.data.downloads} download(s), last ${s.data.last?.status ?? 'none'}; manifest ${s.manifest.hash.slice(0, 12)} (${s.manifest.filings} filings, ${s.manifest.documents} exhibits)`);
      if (!s.campaign) out('no campaign');
      else {
        out(`campaign ${s.campaign.id}: ${s.campaign.status}${s.campaign.stopReason ? ` (${s.campaign.stopReason})` : ''}; execution ${(s.campaign.elapsedMs / 60000).toFixed(1)} min`);
        for (const r of s.runs) out(`  run ${r.id} ${r.configId} ${r.variant}: ${r.status}${r.net != null ? ` net ${r.net}, T ${r.T}, trades ${r.trades}` : ''}${r.error ? ` (${r.error})` : ''}`);
        for (const p of s.placebo) out(`  placebo ${p.configId}: ${p.p != null ? `p ${p.p.toFixed(4)}` : p.details?.skipped}`);
      }
    } else if (cmd === 'report') {
      out(`written ${es.writeReport(Number(val('--campaign') || 1))}`);
    } else { out(`unknown command ${cmd}`); process.exitCode = 2; }
  } finally { es.close(); }
}
main().catch((e) => { process.stdout.write(`error: ${e.message}\n`); process.exitCode = 1; });
