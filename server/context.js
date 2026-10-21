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
