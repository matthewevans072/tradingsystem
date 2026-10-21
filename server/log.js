// Small file logger. Every message is passed through redact() so API keys and
// passwords cannot reach the log file even if an upstream error echoes a URL.
import fs from 'node:fs';
import path from 'node:path';
import { redact } from './config.js';

let cfgRef = null;
let logFile = null;
const recent = [];

export function initLog(cfg) {
  cfgRef = cfg;
  const dir = path.join(cfg.dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'signal-desk.log');
  rotate();
}

function rotate() {
  try {
    const st = fs.statSync(logFile);
    if (st.size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.1');
  } catch { /* no file yet */ }
}

function write(level, scope, msg, extra) {
  let line = `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${msg}`;
  if (extra !== undefined) {
    const e = extra instanceof Error ? (extra.stack || extra.message) : JSON.stringify(extra);
    line += ' ' + e;
  }
  line = cfgRef ? redact(line, cfgRef) : line;
  recent.push({ at: new Date().toISOString(), level, scope, msg: cfgRef ? redact(msg, cfgRef) : msg });
  if (recent.length > 300) recent.shift();
  if (logFile) {
    try { fs.appendFileSync(logFile, line + '\n'); } catch { /* disk full etc. */ }
  }
  if (process.env.SIGNAL_DESK_QUIET !== '1') {
    (level === 'ERROR' ? console.error : console.log)(line);
  }
}

export const log = {
  info: (scope, msg, extra) => write('INFO', scope, msg, extra),
  warn: (scope, msg, extra) => write('WARN', scope, msg, extra),
  error: (scope, msg, extra) => write('ERROR', scope, msg, extra),
  recent: (n = 100) => recent.slice(-n),
};
