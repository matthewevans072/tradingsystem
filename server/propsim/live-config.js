// prop-sim Phase 2, the live simulated funded account (strategy/prop-sim/LIVE-1.md, live-1.json): paths, pins, the code
// revision, the data bound and the timing. Simulated using Lucid Trading's published rules as read on 2026-11-09; not
// affiliated with or endorsed by Lucid. Live data, data only: no broker, practice/demo or paper-trading account, no
// login, no order routing.
import fs from 'node:fs';
import path from 'node:path';
import { PS_DIR, PsError, loadMatrix, textSha256 } from './config.js';

export const LIVE_DOC_PATH = path.join(PS_DIR, 'LIVE-1.md');
export const LIVE_CONFIG_PATH = path.join(PS_DIR, 'live-1.json');
export const LIVE_DB_NAME = 'prop-sim-live.sqlite';
export const RUNNING = 'running simulated result, not validated';

// Bump with any change that can alter a live decision, fill or account figure.
export const LIVE_CODE_REVISION = 'psl-code-2026-11-09-1';
export const LIVE_ENGINE = 'psl-engine-1';

// Nothing dated before this is requested, stored (CHECK constraints) or read; the activation's start session is on or
// after it. The order's closed windows (2023-2024 evaluation, 2025 to 2026 reserve) are historical; the live account
// reads only bars of its own sessions, as they happen.
export const LIVE_DATA_FROM = '2026-11-10';
export const STALE_HEARTBEAT_MS = 10 * 60000;

// The pins of LIVE-1.md and live-1.json (LF-normalised SHA-256) at the document commit, made before this code commit.
export const LIVE_PREREG = Object.freeze({
  commit: '7b1b9c2b2a0a43860bd3c4623faea6193241c831',
  committedAt: '2026-11-09T11:27:30-06:00',
  sha256: Object.freeze({
    'LIVE-1.md': 'd3ec6dd3173cf8ba7bfa47030dcdbc7af1ce4ac35dbba9d3d6c51aa6eea70873',
    'live-1.json': '1e4c8255c8009f667cdb8ea8b1eb101a49783bf9e8b03553c5aafac03bd5d9b1',
  }),
});
export const LIVE_COMMITTED_PATHS = ['server/propsim', 'scripts/propsim-live.mjs', 'server/ictlab/rules.js', 'server/hxr/source.js', 'server/calendar.js', 'strategy/prop-sim/LIVE-1.md', 'strategy/prop-sim/live-1.json', 'strategy/prop-sim/matrix-1.json', 'strategy/prop-sim/LUCID-RULES-2026-11-09.json'];

export function loadLiveConfig(file = LIVE_CONFIG_PATH, matrix = loadMatrix()) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateLiveConfig(c, matrix);
  return c;
}
export function validateLiveConfig(c, matrix) {
  const conf = matrix.configurations.find((x) => x.id === c.traded);
  if (!conf || conf.family === 'RND') throw new PsError(400, `live: the traded configuration ${c.traded} is not a Phase 1 configuration`);
  for (const id of c.shown || []) { const x = matrix.configurations.find((y) => y.id === id); if (!x || x.market !== conf.market || x.family === 'RND') throw new PsError(400, `live: a shown configuration ${id} must be a Phase 1 configuration on ${conf.market}`); }
  if (!matrix.accounts[c.account]) throw new PsError(400, `live: unknown account ${c.account}`);
  if (c.feed?.origin !== 'https://data.alpaca.markets' || c.feed?.feed !== 'iex' || matrix.dataSource.symbols[conf.market] !== c.feed?.symbol) throw new PsError(400, 'live: the feed must be Alpaca IEX on the configuration market\'s stand-in symbol');
  if (!(c.dataFrom >= LIVE_DATA_FROM)) throw new PsError(400, `live: dataFrom must be on or after ${LIVE_DATA_FROM}`);
  const t = c.timing || {};
  for (const k of ['pollSecondsAfterMinute', 'retryEverySeconds', 'liveGraceSeconds', 'bucketWaitSeconds', 'decisionGraceSeconds', 'finalAfterCloseMinutes']) if (!(Number.isFinite(t[k]) && t[k] > 0)) throw new PsError(400, `live: timing.${k} must be a positive number`);
  if (!(t.bucketWaitSeconds < t.liveGraceSeconds && t.liveGraceSeconds < t.decisionGraceSeconds)) throw new PsError(400, 'live: the bucket wait must be shorter than the live grace, and the live grace shorter than the decision grace');
  return c;
}
// Everything the engine needs, from the pinned files: the configuration, the market, the plan, the timing in ms.
export function liveSetup(c, matrix) {
  const conf = matrix.configurations.find((x) => x.id === c.traded);
  const t = c.timing;
  return {
    traded: conf, shown: (c.shown || []).map((id) => matrix.configurations.find((x) => x.id === id)),
    market: conf.market, symbol: c.feed.symbol, ratio: matrix.dataSource.ratio[conf.market], tickPoints: matrix.dataSource.tickPoints,
    tickValue: matrix.contracts[conf.market].tickValue, plan: matrix.accounts[c.account], horizons: matrix.horizons,
    timing: { pollAfterMs: t.pollSecondsAfterMinute * 1000, retryMs: t.retryEverySeconds * 1000, graceMs: t.liveGraceSeconds * 1000, bucketWaitMs: t.bucketWaitSeconds * 1000, decisionGraceMs: t.decisionGraceSeconds * 1000, finalAfterMs: t.finalAfterCloseMinutes * 60000 },
  };
}
export const liveFileHashes = () => ({ 'LIVE-1.md': fs.existsSync(LIVE_DOC_PATH) ? textSha256(fs.readFileSync(LIVE_DOC_PATH, 'utf8')) : null, 'live-1.json': textSha256(fs.readFileSync(LIVE_CONFIG_PATH, 'utf8')) });
