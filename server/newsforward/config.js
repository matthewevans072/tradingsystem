// news-forward (master work order version 3, Phase C1): a forward simulated account that runs news-replay's tested
// pipeline on live data (Alpaca news, bars and corporate actions; SEC EDGAR filings), updated by a persistent worker.
// Plans are saved, hash-chained, before the market can trigger them; a plan saved after its activation window has
// passed is late and can never activate; a missed update is never backfilled as on time. Results are a running
// simulated result, not validated. Simulation only: no broker, order, paper-trading or account code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { textSha256 } from '../newsreplay/config.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NF_DIR = path.join(ROOT, 'strategy', 'news-forward');
export const PROTOCOL_PATH = path.join(NF_DIR, 'PROTOCOL-1.md');
export const PIPELINE_PATH = path.join(NF_DIR, 'PIPELINE-1.json');
export const LOG_PATH = path.join(NF_DIR, 'EXPERIMENT-LOG.md');
export const DB_NAME = 'news-forward.sqlite';
// nf-code-2026-11-07-2: news and filings fetched from 2026-10-22 and never from a future start (EXPERIMENT-LOG.md entry 3).
export const CODE_REVISION = 'nf-code-2026-11-07-2';
// The first session after every closed window (HXR's final period and the range-trend reserve end 2026-10-21). No
// row dated earlier is requested, stored (CHECK constraints) or read.
export const WARMUP_FROM = '2026-10-22';
export const LABEL = 'running simulated result, not validated';
export const ACCOUNTS = Object.freeze({ 'fixed-rule': 'the tested pipeline on live news and filings' });
// C2 ("Claude-read news") is stopped: CNBC's publisher's terms forbid automated data gathering (EXPERIMENT-LOG.md).
export const C2_STATUS = 'stopped: Versant (CNBC) Prohibited Actions section 12 forbids software robots and data gathering tools; no account, task or session exists';
export const UPDATE_EVERY_MS = 5 * 60000; // during the session
export const IDLE_EVERY_MS = 15 * 60000; // outside the session
export const FINAL_AFTER_CLOSE_MS = 25 * 60000; // Alpaca bars are final 20 minutes after the close
export const STALE_HEARTBEAT_MS = 10 * 60000;

export class NfError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const loadPipeline = (file = PIPELINE_PATH) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const pipelineSha = (file = PIPELINE_PATH) => textSha256(fs.readFileSync(file, 'utf8'));
export const assertForward = (date, what = 'date') => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) throw new NfError(400, `news-forward: ${what} must be a date (got ${date})`);
  if (date.slice(0, 10) < WARMUP_FROM) throw new NfError(400, `news-forward: ${what} ${date.slice(0, 10)} is before ${WARMUP_FROM} (closed windows)`);
  return date;
};
