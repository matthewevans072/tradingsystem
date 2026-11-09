#!/usr/bin/env node
// prop-sim Phase 2, the live simulated funded account (strategy/prop-sim/LIVE-1.md). Simulation only: live data, data
// only; no broker, practice/demo or paper-trading account, no login, no order routing. Simulated using Lucid Trading's
// published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid.
//   npm run psl:activate -- --confirm   records the start (the first NYSE session after today's New York date)
//   npm run psl:step                    one step now (the worker does this a few seconds after every minute)
//   npm run psl:status | psl:verify     operational status and the running result; re-derive every recorded decision
//   npm run psl:start                   starts the detached worker (it runs while the PC is on and awake)
//   npm run psl:pause | psl:resume | psl:stop   (a pause or a stop is a gap: the account is flat across it)
//   npm run psl:tasks [-- --create]     the Task Scheduler entries (at logon; ensure it on weekdays every 30 minutes)
// The Alpaca keys come from .env and are never printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { loadMatrix, LABEL } from '../server/propsim/config.js';
import { loadLiveConfig, RUNNING } from '../server/propsim/live-config.js';
import { openPlDb, plDbFile, setDesired, worker as workerRow } from '../server/propsim/live-store.js';
import { createIexSource } from '../server/propsim/live-source.js';
import { createLive, runLiveWorker } from '../server/propsim/live-worker.js';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'status';
const out = (s) => process.stdout.write(`${new Date().toISOString().slice(0, 19)}Z ${s}\n`);
const usd = (n) => (n == null ? '—' : `${n < 0 ? '-' : ''}US$${Math.abs(n).toFixed(2)}`);

async function main() {
  const cfg = loadConfig();
  const matrix = loadMatrix();
  const liveCfg = loadLiveConfig(undefined, matrix);
  const db = openPlDb(plDbFile(cfg.dataDir));
  const source = cfg.secrets.ALPACA_API_KEY_ID ? createIexSource({ keyId: cfg.secrets.ALPACA_API_KEY_ID, secretKey: cfg.secrets.ALPACA_API_SECRET_KEY }) : null;
  const live = createLive({ db, source, cfg: liveCfg, matrix, log: out });
  try {
    if (cmd === 'activate') {
      if (!has('--confirm')) { out('add --confirm: this records the start of the live account (the first NYSE session after today)'); const p = live.pinProblems(); out(p.length ? `would refuse: ${p.join('; ')}` : 'the pins and the committed code check out'); process.exitCode = 2; return; }
      const r = live.activate();
      out(`activated at ${r.at}; start session ${r.startSession}; trades ${r.traded} on ${r.plan} (${r.feed}, ${r.symbol}); code ${r.codeRevision}; HEAD ${r.head}`);
    } else if (cmd === 'step') {
      if (!source) throw new Error('Alpaca keys are not configured in .env');
      out(`step: ${JSON.stringify(await live.step())}`);
    } else if (cmd === 'status') {
      const o = live.overview();
      out(`${LABEL}; ${RUNNING}; ${o.standIn}; ${o.feed}`);
      if (!o.activated) { out('not activated: npm run psl:activate -- --confirm'); const p = live.pinProblems(); if (p.length) out(`activation would refuse: ${p.join('; ')}`); return; }
      out(`activation: ${o.activation.at}, start ${o.activation.startSession}; trades ${o.traded} (shown, not traded: ${o.shown.join(', ')}); plan ${o.plan}`);
      const w = o.worker;
      out(`worker: ${w ? `${w.desired} requested; ${w.alive ? `alive pid ${w.pid}, heartbeat ${w.heartbeatAt}, ${w.state}` : 'not running'}` : 'never started'}`);
      for (const p of o.polls) out(`request ${p.at} ${p.ok ? 'ok' : 'FAILED'} ${JSON.stringify(p.detail)}`);
      const s = o.account?.status;
      if (s) out(`attempt ${s.attempt} (${s.stage}, from ${s.started}, session ${s.sessionsUsed} of ${s.horizon}): balance ${usd(s.balance)}, open ${usd(s.openPnl)}, drawdown left ${usd(s.drawdownLeft)}, today ${usd(s.todayPnl)}, profit ${usd(s.profit)} of ${usd(s.profitTarget)}`);
      if (o.session) out(`session ${o.session.date}: ${o.session.bars.length} five-minute bars, ${o.session.trades.length} trades, ${o.session.gaps.length} gaps, ${o.session.observedMinutes} of ${o.session.judgedMinutes} judged minutes observed`);
      for (const l of o.log.slice(0, 5)) out(`log ${l.at} ${l.level}: ${l.message}`);
    } else if (cmd === 'verify') {
      const v = live.verify();
      out(`decisions ${v.buckets}; chain ${v.chain.ok ? 'OK' : `broken at ${v.chain.at}`}; re-derived ${v.mismatches.length ? `MISMATCH at ${v.mismatches.slice(0, 5).join(', ')}` : 'all equal'}; bars before the start: ${v.before}`);
      process.exitCode = v.chain.ok && !v.mismatches.length && !v.before ? 0 : 1;
    } else if (['pause', 'resume', 'stop'].includes(cmd)) {
      setDesired(db, cmd === 'resume' ? 'running' : cmd === 'pause' ? 'paused' : 'stopped', new Date().toISOString());
      out(`${cmd} requested; the worker reads it within a minute (a pause or a stop is a gap: the account is flat across it)`);
    } else if (cmd === 'start') {
      setDesired(db, 'running', new Date().toISOString());
      const w = workerRow(db);
      if (w?.token && w.heartbeat_at && Date.now() - Date.parse(w.heartbeat_at) < 10 * 60000) { out(`a worker is already alive (pid ${w.pid})`); return; }
      const logDir = path.join(cfg.dataDir, 'prop-sim-live-logs');
      fs.mkdirSync(logDir, { recursive: true });
      const fd = fs.openSync(path.join(logDir, `worker-${new Date().toISOString().slice(0, 10)}.log`), 'a');
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SELF, 'worker'], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: process.env });
      child.unref();
      out(`worker started (pid ${child.pid}); log in ${logDir}`);
    } else if (cmd === 'worker') {
      if (!source) throw new Error('Alpaca keys are not configured in .env');
      const w = workerRow(db);
      if (has('--ensure') && (w?.desired === 'stopped' || (w?.token && w.heartbeat_at && Date.now() - Date.parse(w.heartbeat_at) < 10 * 60000))) { out('nothing to do'); return; }
      if (has('--ensure') || !w) setDesired(db, w?.desired === 'paused' ? 'paused' : 'running', new Date().toISOString());
      const r = await runLiveWorker({ db, live, token: crypto.randomBytes(8).toString('hex'), log: out });
      out(`worker exited: ${r.exit}`);
    } else if (cmd === 'tasks') {
      // Two entries in \SignalDesk\, registered with PowerShell (no execution time limit, one instance, a missed start
      // run when the PC is on): PropSimLiveWorker at logon, PropSimLiveDaily on weekdays from 07:00 local every 30
      // minutes for 16 hours. Both run "worker --ensure", which exits at once when a live worker exists or a stop was asked.
      const q = (s) => s.replace(/'/g, "''");
      const ps = [
        `$action = New-ScheduledTaskAction -Execute '${q(process.execPath)}' -Argument '--disable-warning=ExperimentalWarning "${q(SELF)}" worker --ensure' -WorkingDirectory '${q(ROOT)}'`,
        '$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
        "$daily = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '07:00'",
        "$rep = New-ScheduledTaskTrigger -Once -At '07:00' -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 16)",
        '$daily.Repetition = $rep.Repetition',
        "Register-ScheduledTask -TaskPath '\\SignalDesk\\' -TaskName 'PropSimLiveDaily' -Action $action -Trigger $daily -Settings $settings -Description 'Signal Desk prop-sim live account (simulation only, data only): ensures its worker runs on weekdays. No broker, no order.' -Force -ErrorAction Stop | Out-Null",
        '$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"',
        "Register-ScheduledTask -TaskPath '\\SignalDesk\\' -TaskName 'PropSimLiveWorker' -Action $action -Trigger $logon -Settings $settings -Description 'Signal Desk prop-sim live account (simulation only, data only): starts its worker at logon. No broker, no order.' -Force -ErrorAction Stop | Out-Null",
        "'registered'",
      ].join('; ');
      out('Task Scheduler \\SignalDesk\\PropSimLiveWorker (at logon) and \\SignalDesk\\PropSimLiveDaily (weekdays from 07:00 local, every 30 minutes for 16 hours): "worker --ensure", no time limit, one instance');
      if (has('--create')) {
        try { out(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim()); }
        catch (e) { out(`could not register the tasks: ${(e.stderr || e.message).toString().trim().slice(0, 500)}`); process.exitCode = 1; }
      } else out('add --create to register them');
    } else { out(`unknown command ${cmd}`); process.exitCode = 2; }
  } finally { db.close(); }
}
main().catch((e) => { process.stdout.write(`error: ${e.message}\n`); process.exitCode = 1; });
