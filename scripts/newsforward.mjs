#!/usr/bin/env node
// news-forward (master work order version 3, Phase C1; strategy/news-forward/PROTOCOL-1.md). Simulation only.
//   npm run nf:activate -- --confirm   records the start (the first NYSE session after today) and the frozen costs
//   npm run nf:update                  one update now (download, plans, account); the worker does this on its own
//   npm run nf:status | nf:verify      operational status and the running result; re-derive every plan
//   npm run nf:start                   starts the detached worker (it keeps running while the PC is on and awake)
//   npm run nf:pause | nf:resume | nf:stop
//   npm run nf:tasks [-- --create]     the Windows Task Scheduler entries (start the worker at logon; ensure it daily)
// Keys and SEC_CONTACT_EMAIL come from .env and are never printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { createHxrSource } from '../server/hxr/source.js';
import { createSecGet } from '../server/newsreplay/download.js';
import { openHxrReadOnly, boundedSpreadTable } from '../server/eventswing/data.js';
import { loadHxrUniverse, basketSymbols } from '../server/hxr/config.js';
import { openNfDb, nfDbFile, setDesired, worker as workerRow } from '../server/newsforward/store.js';
import { createForward } from '../server/newsforward/forward.js';
import { runWorker } from '../server/newsforward/worker.js';
import { LABEL, C2_STATUS } from '../server/newsforward/config.js';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'status';
const out = (s) => process.stdout.write(`${new Date().toISOString().slice(0, 19)}Z ${s}\n`);
const TASK_FOLDER = 'SignalDesk';

async function main() {
  const cfg = loadConfig();
  const db = openNfDb(nfDbFile(cfg.dataDir));
  const source = cfg.secrets.ALPACA_API_KEY_ID ? createHxrSource({ keyId: cfg.secrets.ALPACA_API_KEY_ID, secretKey: cfg.secrets.ALPACA_API_SECRET_KEY }) : null;
  const sec = cfg.secContactEmail ? createSecGet({ contactEmail: cfg.secContactEmail, agent: 'news-forward' }) : null;
  const fwd = createForward({ db, source, sec, log: out });
  try {
    if (cmd === 'activate') {
      if (!has('--confirm')) { out('add --confirm: this records the start of the forward account (the first NYSE session after today)'); process.exitCode = 2; return; }
      const hdb = openHxrReadOnly(cfg.dataDir);
      let spreadTable;
      try { spreadTable = boundedSpreadTable(hdb, basketSymbols(loadHxrUniverse(), 'A').map((s) => ({ symbol: s.symbol, exchange: s.exchange, listedFrom: s.listedFrom })), { floorBps: 2 }); } finally { hdb.close(); }
      const r = fwd.activate({ spreadTable });
      out(`activated at ${r.at}; start session ${r.startSession}; pipeline ${JSON.stringify({ planner: r.pipeline.planner, entry: r.pipeline.entry, exit: r.pipeline.exit })}; code ${r.codeRevision}; HEAD ${r.head}`);
    } else if (cmd === 'update') {
      const r = await fwd.update({ kind: 'manual' });
      out(`update done: ${JSON.stringify({ plans: r.detail.plans, account: r.detail.account })}`);
    } else if (cmd === 'status') {
      const s = fwd.status();
      out(`${LABEL}. C2: ${C2_STATUS}`);
      out(`activation: ${s.activation ? `${s.activation.at}, start ${s.activation.startSession}` : 'not activated'}`);
      const w = s.worker;
      out(`worker: ${w ? `${w.desired} requested; ${w.token ? `alive pid ${w.pid}, heartbeat ${w.heartbeat_at}, ${w.state}` : 'not running'}` : 'never started'}`);
      out(`plans: ${s.plans.total} (${s.plans.entry} entry plans, ${s.plans.late} late)`);
      const last = s.snapshots.at(-1);
      if (last) out(`account as of ${last.date}: net ${last.report.net} US$, T ${last.report.T}, drawdown ${last.report.maxDrawdownPct}%, invested ${last.report.avgInvestedPct}%, costs ${last.report.costs}, equal-weight hold ${last.report.index.net}, exposure-matched hold ${last.report.exposureMatched.net}`);
      for (const u of s.updates.slice(0, 5)) out(`update ${u.id} ${u.kind} ${u.status} ${u.finishedAt}${u.detail.error ? `: ${u.detail.error}` : ''}`);
    } else if (cmd === 'verify') {
      const v = fwd.verify();
      out(`plans ${v.plans}; chain ${v.chain.ok ? 'OK' : `broken at ${v.chain.at}`}; packet mismatches ${v.packetMismatches.length ? v.packetMismatches.join(', ') : 'none'}`);
      process.exitCode = v.chain.ok && !v.packetMismatches.length ? 0 : 1;
    } else if (['pause', 'resume', 'stop'].includes(cmd)) {
      setDesired(db, cmd === 'resume' ? 'running' : cmd === 'pause' ? 'paused' : 'stopped', new Date().toISOString());
      out(`${cmd} requested; the worker reads it within a minute`);
    } else if (cmd === 'start') {
      setDesired(db, 'running', new Date().toISOString());
      const w = workerRow(db);
      if (w?.token && w.heartbeat_at && Date.now() - Date.parse(w.heartbeat_at) < 10 * 60000) { out(`a worker is already alive (pid ${w.pid})`); return; }
      const logDir = path.join(cfg.dataDir, 'news-forward-logs');
      fs.mkdirSync(logDir, { recursive: true });
      const fd = fs.openSync(path.join(logDir, `worker-${new Date().toISOString().slice(0, 10)}.log`), 'a');
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SELF, 'worker'], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: process.env });
      child.unref();
      out(`worker started (pid ${child.pid}); log in ${logDir}`);
    } else if (cmd === 'worker') {
      // --ensure (the daily scheduled task): exit quietly when a live worker exists or a stop was requested.
      const w = workerRow(db);
      if (has('--ensure') && (w?.desired === 'stopped' || (w?.token && w.heartbeat_at && Date.now() - Date.parse(w.heartbeat_at) < 10 * 60000))) { out('nothing to do'); return; }
      if (has('--ensure') || !w) setDesired(db, w?.desired === 'paused' ? 'paused' : 'running', new Date().toISOString());
      const r = await runWorker({ db, forward: fwd, token: crypto.randomBytes(8).toString('hex'), log: out });
      out(`worker exited: ${r.exit}`);
    } else if (cmd === 'tasks') {
      const node = process.execPath;
      const tasks = [
        { name: `${TASK_FOLDER}\\NewsForwardWorker`, args: ['/SC', 'ONLOGON'], run: `"${node}" --disable-warning=ExperimentalWarning "${SELF}" worker --ensure` },
        { name: `${TASK_FOLDER}\\NewsForwardDaily`, args: ['/SC', 'WEEKLY', '/D', 'MON,TUE,WED,THU,FRI', '/ST', '07:00'], run: `"${node}" --disable-warning=ExperimentalWarning "${SELF}" worker --ensure` },
      ];
      for (const t of tasks) out(`schtasks /Create /TN "${t.name}" ${t.args.join(' ')} /TR "${t.run.replace(/"/g, '\\"')}" /F`);
      if (has('--create')) for (const t of tasks) {
        try { execFileSync('schtasks', ['/Create', '/TN', t.name, ...t.args, '/TR', t.run, '/F'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }); out(`created ${t.name}`); }
        catch (e) { out(`could not create ${t.name}: ${(e.stderr || e.message).toString().trim()}`); process.exitCode = 1; }
      }
    } else { out(`unknown command ${cmd}`); process.exitCode = 2; }
  } finally { db.close(); }
}
main().catch((e) => { process.stdout.write(`error: ${e.message}\n`); process.exitCode = 1; });
