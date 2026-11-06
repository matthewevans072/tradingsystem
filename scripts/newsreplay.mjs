#!/usr/bin/env node
// news-replay command line (strategy/news-replay/CAMPAIGN-1.md). Simulation only.
//   npm run nr:download [-- --only intraday|news|filings|fomc]   bounded downloads (2019-12-02 to 2021-12-31)
//   npm run nr:inventory [-- --record]    coverage and event counts; --record appends the log entry
//   npm run nr:check                      the gate
//   npm run nr:freeze -- --record         appends the "Frozen for campaign 1" entry
//   npm run nr:run -- --confirm           runs the deterministic and price-only arms, the evaluation pass and the placebo
//   npm run nr:ai-estimate                the token and cost estimate of the AI arms (no call)
//   npm run nr:status | nr:report
import { loadConfig } from '../server/config.js';
import { createHxrSource } from '../server/hxr/source.js';
import { openNrDb, nrDbFile } from '../server/newsreplay/store.js';
import { downloadIntraday, downloadNews, downloadFilings, downloadFomc, createSecGet } from '../server/newsreplay/download.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'check';
const out = (s) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);

async function main() {
  const cfg = loadConfig();
  if (cmd === 'download') {
    const db = openNrDb(nrDbFile(cfg.dataDir));
    try {
      const only = val('--only');
      const src = createHxrSource({ keyId: cfg.secrets.ALPACA_API_KEY_ID, secretKey: cfg.secrets.ALPACA_API_SECRET_KEY });
      if (!only || only === 'fomc') await downloadFomc({ db, log: out });
      if (!only || only === 'filings') { const r = await downloadFilings({ db, sec: createSecGet({ contactEmail: cfg.secContactEmail }), log: out }); for (const p of r.problems) out(`problem: ${p}`); }
      if (!only || only === 'news') await downloadNews({ db, src, log: out });
      if (!only || only === 'intraday') await downloadIntraday({ db, src, log: out });
      out('download finished');
    } finally { db.close(); }
    return;
  }
  const { runCommand } = await import('../server/newsreplay/cli.js');
  await runCommand(cmd, { args, has, val, out, cfg });
}
main().catch((e) => { process.stdout.write(`error: ${e.message}\n`); process.exitCode = 1; });
