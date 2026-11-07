// A context bundles one workspace: its database, catalog and providers.
// The real portfolio ("real") and the demo workspace ("demo") use separate
// database files and never share data.
import path from 'node:path';
import { openDb } from './db.js';
import { createCatalog, seedWatchlist } from './catalog.js';
import { buildProviders, refreshQuotes, refreshDailyBars } from './marketdata.js';
import { computePortfolio } from './portfolio.js';
import { runAssessments } from './assessments.js';
import { seedDemo } from './providers/demo.js';
import { attachLab } from './strategy/lab.js';
import { attachHxr } from './hxr/service.js';
import { attachResearch } from './research/service.js';
import { attachEventSwing } from './eventswing/service.js';
import { attachNewsReplay } from './newsreplay/service.js';
import { attachNewsForward } from './newsforward/service.js';

export function dbFileFor(cfg, mode) {
  return path.join(cfg.dataDir, mode === 'demo' ? 'demo.sqlite' : 'signal-desk.sqlite');
}

export function createContext(cfg, mode = 'real', { fetchImpl, file } = {}) {
  const db = openDb(file || dbFileFor(cfg, mode));
  const ctx = { cfg, mode, db, fetchImpl };
  ctx.catalog = createCatalog(db);
  ctx.providers = buildProviders(ctx);
  seedWatchlist(db, ctx.catalog);
  ctx.rebuildProviders = () => { ctx.providers = buildProviders(ctx); };
  // Strategy Lab: its own database, opened on first use (the demo seeds synthetic data then).
  attachLab(ctx);
  // HXR: its own database (real workspace only), opened on first use.
  attachHxr(ctx);
  // Research runner: its own database (real workspace only), opened on first use; the demo gets a refusing stub.
  attachResearch(ctx);
  // event-swing (simulation only): its own database, opened on first use; the demo gets a stub.
  attachEventSwing(ctx);
  // news-replay (simulation only): its own database, opened on first use; read-only here; the demo gets a stub.
  attachNewsReplay(ctx);
  // news-forward (simulation only): the forward account's database, read-only here; the demo gets a stub.
  attachNewsForward(ctx);
  if (mode === 'demo') {
    seedDemo(db);
    ctx.ready = primeDemo(ctx);
  }
  return ctx;
}

// Fill the demo workspace with synthetic quotes, history and assessments.
async function primeDemo(ctx) {
  await refreshQuotes(ctx);
  await refreshDailyBars(ctx);
  runAssessments(ctx, computePortfolio(ctx.db, { catalog: ctx.catalog }));
}
