// news-forward for the app: a read-only view of the forward account for the Research page (the worker's health, the
// running simulated result with its benchmarks, plans recorded on time or late, recent updates). Nothing here starts
// the worker or an update; the demo workspace gets a stub. Simulation only.
import fs from 'node:fs';
import * as store from './store.js';
import { createForward } from './forward.js';
import { LABEL, C2_STATUS, NfError, STALE_HEARTBEAT_MS } from './config.js';

export { NfError };
export function createNewsForwardService(ctx) {
  if (ctx.mode === 'demo') return { overview: () => ({ simulated: true, demo: true, note: 'Demo workspace: the forward account runs in your own workspace only.' }), close: () => {} };
  const file = store.nfDbFile(ctx.cfg.dataDir);
  let db = null;
  const open = () => (db ||= store.openNfDb(file));
  return {
    overview() {
      if (!fs.existsSync(file)) return { simulated: true, label: LABEL, activated: false, c2: C2_STATUS, note: 'Not activated: npm run nf:activate -- --confirm, then npm run nf:start.' };
      const s = createForward({ db: open() }).status();
      const w = s.worker;
      const alive = !!(w?.token && w.heartbeat_at && Date.now() - Date.parse(w.heartbeat_at) < STALE_HEARTBEAT_MS);
      const last = s.snapshots.at(-1) ?? null;
      return {
        simulated: true, label: LABEL, activated: !!s.activation, activation: s.activation ? { at: s.activation.at, startSession: s.activation.startSession, pipeline: { planner: s.activation.pipeline.planner, entry: s.activation.pipeline.entry, exit: s.activation.pipeline.exit ?? 'existing' } } : null,
        worker: { requested: w?.desired ?? 'never started', alive, pid: alive ? w.pid : null, heartbeatAt: w?.heartbeat_at ?? null, state: w?.state ?? null },
        plans: s.plans, latest: last ? { date: last.date, recordedAt: last.recordedAt, report: last.report } : null,
        series: s.snapshots.map((x) => ({ date: x.date, net: x.report.net, T: x.report.T, index: x.report.index.net, exposureMatched: x.report.exposureMatched.net })),
        updates: s.updates.slice(0, 10).map((u) => ({ id: u.id, kind: u.kind, status: u.status, finishedAt: u.finishedAt, error: u.detail.error ?? null, plans: u.detail.plans ?? null })),
        c2: C2_STATUS,
      };
    },
    close: () => { try { db?.close(); } catch { /* */ } },
  };
}
export function attachNewsForward(ctx) {
  let svc = null;
  Object.defineProperty(ctx, 'newsforward', { configurable: true, enumerable: false, get: () => (svc ||= createNewsForwardService(ctx)) });
  Object.defineProperty(ctx, 'newsforwardIfOpen', { configurable: true, enumerable: false, get: () => svc });
  return ctx;
}
export function registerNewsForwardRoutes(r, HttpError) {
  r('GET', '/api/newsforward/overview', async (ctx) => { try { return ctx.newsforward.overview(); } catch (e) { if (e instanceof NfError) throw new HttpError(e.status, e.message); throw e; } });
}
