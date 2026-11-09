// prop-sim for the app: a read-only view of the campaign for the Research page (the runs, the random-twin progress,
// the test, the four plain-English answers). Runs start only from the command line. Simulated using Lucid Trading's
// published rules as read on 2026-11-09; not affiliated with or endorsed by Lucid. Simulation only.
import fs from 'node:fs';
import { openPsDb, psDbFile, listRuns, listRandom, lockRow } from './store.js';
import { createPropSim, fourAnswers } from './campaign.js';
import { LABEL, STAND_IN, CODE_REVISION, PsError } from './config.js';

export { PsError };
export function createPropSimService(ctx) {
  if (ctx.mode === 'demo') return { overview: () => ({ simulated: true, demo: true, note: 'Demo workspace: prop-sim runs in your own workspace only.' }), close: () => {} };
  const file = psDbFile(ctx.cfg.dataDir);
  let db = null, ps = null;
  const open = () => { if (!db) { db = openPsDb(file); ps = createPropSim({ db }); } return ps; };
  return {
    overview() {
      if (!fs.existsSync(file)) return { simulated: true, label: LABEL, standIn: STAND_IN, note: 'No data yet: npm run ps:download.' };
      const p = open();
      const runs = listRuns(db).filter((r) => r.kind === 'signals');
      const inf = p.inference();
      const lk = lockRow(db);
      const configs = p.TESTED.map((id) => {
        const run = runs.filter((r) => r.configId === id && r.status === 'done').at(-1);
        const lb = runs.filter((r) => r.configId === `LB-${id.split('-')[1]}` && r.status === 'done').at(-1)?.summary.plans.primary;
        return { id, run: run ? { trades: run.summary.trades, primary: { ...run.summary.plans.primary, months: undefined }, secondary: { ...run.summary.plans.secondary, months: undefined }, skips: run.summary.skips } : null, randomSeeds: listRandom(db, id).length, inference: inf[id] ?? null, answers: run ? fourAnswers(id, run, inf, lb) : null };
      });
      return { simulated: true, label: LABEL, standIn: STAND_IN, codeRevision: CODE_REVISION, worker: lk?.token ? { pid: lk.pid, heartbeatAt: lk.heartbeat_at } : null, seedsPerConfig: p.matrix.random.seeds, configs };
    },
    close: () => { try { db?.close(); } catch { /* */ } },
  };
}
export function attachPropSim(ctx) {
  let svc = null;
  Object.defineProperty(ctx, 'propsim', { configurable: true, enumerable: false, get: () => (svc ||= createPropSimService(ctx)) });
  return ctx;
}
export function registerPropSimRoutes(r, HttpError) {
  r('GET', '/api/propsim/overview', async (ctx) => { try { return ctx.propsim.overview(); } catch (e) { if (e instanceof PsError) throw new HttpError(e.status, e.message); throw e; } });
}
