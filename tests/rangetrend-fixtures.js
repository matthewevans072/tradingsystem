// Shared fixtures for the range-trend service and launcher tests: temp copies of the protocol and the log
// (the repository's own files are never relied on), and a synthetic HXR database built through the fake
// Alpaca (tests/hxr-fake-alpaca.js). Synthetic prices only exercise code; nothing here is a result.
import fs from 'node:fs';
import path from 'node:path';
import { NO_HOST_KEYS } from './no-host-keys.js';
import { fakeAlpaca, buildMarket, KEY_ID, SECRET_KEY } from './hxr-fake-alpaca.js';
import { loadConfig as loadAppConfig } from '../server/config.js';
import { createHxr } from '../server/hxr/service.js';
import { CODE_REVISION, PLANNED_CONFIGS } from '../server/rangetrend/config.js';

export const PROTO = '# Evaluation protocol (test copy)\n\n**Date-choice rule:** a test date rule\n\n**Pick rule:** a test pick rule\n';
export const LOG_HEADER = '| # | When | What | Data touched | Results seen? |\n|---|---|---|---|---|\n';
export const OWNER_ROW = `| 1 | 2026-10-27 | **Owner decisions D1-D8** (test copy): D1 a, D2 b, D3 c, D4 d, D5 e, D6 f, D7 g, D8 h. Code revision: ${CODE_REVISION}. | none | No |\n`;
export const AUTH_ROW = `| 2 | 2026-11-02 | **Practice runs authorized** (test copy): "run the eight practice runs" (the owner's message); code revision ${CODE_REVISION}; configs ${PLANNED_CONFIGS.join(', ')} | none | No |\n`;
export const LOG_OWNER_ONLY = LOG_HEADER + OWNER_ROW;
export const LOG = LOG_HEADER + OWNER_ROW + AUTH_ROW;

export function files(dir, { proto = PROTO, log = LOG } = {}) {
  const protocolPath = path.join(dir, 'proto.md'), logPath = path.join(dir, 'log.md');
  if (proto != null) fs.writeFileSync(protocolPath, proto);
  if (log != null) fs.writeFileSync(logPath, log);
  return { protocolPath, logPath };
}

export const cfgFile = (family, entry, limit) => PLANNED_CONFIGS.find((f) => f === `rt-${family}-${entry}-${limit ? 'limit' : 'nolimit'}-0.2.0.json`);

// A fake market in which TSLA forms a range and breaks out just before its 5-for-1 split of 2020-08-31, then
// rises gently through it, so the immediate-breakout config holds a position across the split. Prices are
// continuous and keep the raw split factors, so HXR's readiness checks still pass.
export function marketWithTslaBreakout() {
  const market = buildMarket();
  const bars = market.TSLA, dates = [...bars.keys()].sort();
  const factor = (d) => (d < '2020-08-31' ? 15 : d < '2022-08-25' ? 3 : 1);
  const ib = dates.findIndex((d) => d >= '2020-08-17');
  const adj = (d) => bars.get(d).c / factor(d);
  const s = adj(dates[ib - 66]) / 100;
  const PAT = [100, 102, 104, 106, 108, 110, 108, 106, 104, 102];
  const path0 = [...Array.from({ length: 6 }, () => PAT).flat(), 100, 102, 104, 106, 108, 111.5, ...Array.from({ length: 26 }, (_, k) => 112 + 0.5 * k)];
  let prevRaw = bars.get(dates[ib - 66]).c;
  path0.forEach((x, k) => {
    const d = dates[ib - 65 + k], c = x * s * factor(d), o = (prevRaw / factor(dates[ib - 66 + k])) * factor(d);
    bars.set(d, { ...bars.get(d), o, c, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, vw: (o + c) / 2, vw15: o });
    prevRaw = c;
  });
  const last = ib - 65 + path0.length - 1, g = adj(dates[last]) / adj(dates[last + 1]);
  for (const d of dates.slice(last + 1)) { const b = bars.get(d); bars.set(d, { ...b, o: b.o * g, h: b.h * g, l: b.l * g, c: b.c * g, vw: b.vw * g, vw15: b.vw15 * g }); }
  return market;
}

// Downloads the fake market into <dir>/hxr-sim.sqlite through HXR's own service (read by range-trend read-only).
export async function hxrData(dir, market, handler = null) {
  const now = Date.parse('2026-10-22T22:00:00Z');
  const clock = () => new Date(now);
  const fake = fakeAlpaca({ clock, market, news: [], handler });
  const cfg = loadAppConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none', ALPACA_API_KEY_ID: KEY_ID, ALPACA_API_SECRET_KEY: SECRET_KEY });
  const hxr = createHxr({ cfg, mode: 'real' }, { clock, fetchImpl: fake.fetchImpl, sleep: async () => {} });
  hxr.fetchData();
  await hxr.fetchDone;
  return { hxr, cfg, clock };
}
