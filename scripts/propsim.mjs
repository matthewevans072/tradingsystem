#!/usr/bin/env node
// prop-sim (strategy/prop-sim/CAMPAIGN-1.md). Simulated using Lucid Trading's published rules as read on 2026-11-09;
// not affiliated with or endorsed by Lucid. Stand-in, regular hours only, not futures. Simulation only.
//   npm run ps:download            QQQ and SPY 1-minute bars, 2018-06-01 to 2022-12-30 (bounded)
//   npm run ps:check               every gate condition
//   npm run ps:freeze -- --record  the "Frozen for campaign 1" log entry (code committed first)
//   npm run ps:run -- --confirm    the resumable worker in this window (runs, random twins, test, report)
//   npm run ps:start               the same worker, detached; ps:stop asks it to stop after the current seed
//   npm run ps:status | ps:report
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { createHxrSource } from '../server/hxr/source.js';
import { openPsDb, psDbFile, takeLock, heartbeat, releaseLock, lockRow, setDesired, listRuns, listRandom, logLine } from '../server/propsim/store.js';
import { downloadBars } from '../server/propsim/download.js';
import { createPropSim, writeReport } from '../server/propsim/campaign.js';
import { LABEL, STAND_IN, CODE_REVISION } from '../server/propsim/config.js';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'check';
const out = (s) => process.stdout.write(`${new Date().toISOString().slice(0, 19)}Z ${s}\n`);

async function main() {
  const cfg = loadConfig();
  const db = openPsDb(psDbFile(cfg.dataDir));
  const ps = createPropSim({ db, log: out });
  try {
    if (cmd === 'download') {
      const src = createHxrSource({ keyId: cfg.secrets.ALPACA_API_KEY_ID, secretKey: cfg.secrets.ALPACA_API_SECRET_KEY });
      await downloadBars({ db, src, symbols: Object.values(ps.matrix.dataSource.symbols), log: out });
    } else if (cmd === 'check') {
      const g = ps.gateStatus();
      for (const c of g.conditions) out(`${c.ok ? 'OK  ' : 'NO  '} ${c.name}: ${c.detail}`);
      out(g.ok ? 'The gate is open.' : 'The gate is closed.');
      process.exitCode = g.ok ? 0 : 2;
    } else if (cmd === 'freeze') {
      if (!has('--record')) { out('add --record'); process.exitCode = 2; return; }
      const r = ps.freeze(); out(`appended log entry ${r.number}`); process.stdout.write(`${r.text}\n`);
    } else if (cmd === 'run' || cmd === 'worker') {
      if (cmd === 'run' && !has('--confirm')) { out('add --confirm: this runs the eight configurations, their random twins and the test'); process.exitCode = 2; return; }
      const token = crypto.randomBytes(8).toString('hex');
      const lk = takeLock(db, { token, pid: process.pid, at: new Date().toISOString(), staleMs: 10 * 60000 });
      if (!lk.ok) { out(`another prop-sim worker holds the lock (pid ${lk.holder.pid})`); process.exitCode = 2; return; }
      setDesired(db, 'running');
      try {
        const beat = (msg) => { heartbeat(db, token, new Date().toISOString()); if (msg) logLine(db, new Date().toISOString(), msg); if (lockRow(db)?.desired === 'stopped') throw new Error('stop requested'); };
        const r = ps.runAll({ log: out, heartbeat: beat });
        out(r.complete ? `complete in ${(r.elapsedMs / 60000).toFixed(1)} min` : 'stopped at the execution budget; run again to resume');
        if (r.complete) out(`report ${writeReport(ps)}`);
      } catch (e) { out(`worker stopped: ${e.message}`); }
      finally { releaseLock(db, token); }
    } else if (cmd === 'start') {
      const logDir = path.join(cfg.dataDir, 'prop-sim-logs');
      fs.mkdirSync(logDir, { recursive: true });
      const fd = fs.openSync(path.join(logDir, `worker-${new Date().toISOString().slice(0, 10)}.log`), 'a');
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SELF, 'worker'], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: process.env });
      child.unref();
      out(`worker started (pid ${child.pid}); log in ${logDir}`);
    } else if (cmd === 'stop') {
      setDesired(db, 'stopped'); out('stop requested; the worker stops after the current seed and resumes from there on the next run');
    } else if (cmd === 'status') {
      out(`${LABEL}. ${STAND_IN}.`);
      const lk = lockRow(db);
      out(`worker: ${lk?.token ? `alive pid ${lk.pid}, heartbeat ${lk.heartbeat_at}` : 'not running'}; requested ${lk?.desired ?? 'running'}`);
      for (const r of listRuns(db)) out(`run ${r.id} ${r.configId} (${r.codeRevision}): ${r.status}${r.summary ? ` trades ${r.summary.trades}, Flex pass ${(100 * r.summary.plans.primary.passRate).toFixed(1)}%` : ''}`);
      for (const id of ps.TESTED) { const n = listRandom(db, id, CODE_REVISION).length; if (n) out(`${id} random twins: ${n} of ${ps.matrix.random.seeds}`); }
    } else if (cmd === 'report') {
      out(`written ${writeReport(ps)}`);
    } else { out(`unknown command ${cmd}`); process.exitCode = 2; }
  } finally { db.close(); }
}
main().catch((e) => { process.stdout.write(`error: ${e.message}\n`); process.exitCode = 1; });
