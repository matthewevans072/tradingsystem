// event-swing for the app: a read-only view of event-swing's own database for the Research page (data state, the
// campaign, its runs, the placebo, the selection and the in-app notifications), plus the gate check on request. The
// campaign itself is created and started from the command line (scripts/eventswing.mjs), which launches a detached
// worker; nothing here sends anything outside the app. The demo workspace gets a stub.
import { createEventSwing } from './campaign.js';
import { EsError } from './config.js';

export { EsError };
export function createEventSwingService(ctx, opts = {}) {
  if (ctx.mode === 'demo') {
    return { overview: () => ({ simulated: true, demo: true, note: 'Demo workspace: event-swing works on real market data in your own workspace only.' }), check: () => { throw new EsError(409, 'not available in the demo workspace'); }, markSeen: () => 0, close: () => {} };
  }
  const es = createEventSwing({ dataDir: ctx.cfg.dataDir, ...opts, testOverrides: Object.keys(opts).length > 0 });
  return {
    overview: () => {
      const s = es.status();
      const blocker = !s.data.downloads ? (ctx.cfg.secContactEmail ? 'No event data yet: run npm run es:download.' : 'Blocked: SEC EDGAR refuses undeclared clients, and SEC_CONTACT_EMAIL is not set in .env. Add it (it is never shown), then run npm run es:download.') : !s.data.complete ? 'The last download is incomplete: run npm run es:download again.' : null;
      return { simulated: true, secConfigured: !!ctx.cfg.secContactEmail, blocker, ...s, holm: s.campaign?.holm ?? null, title: 'development improvement—not validated' };
    },
    check: () => es.gateStatus(),
    markSeen: (ids) => es.markSeen(ids),
    close: () => es.close(),
  };
}
export function attachEventSwing(ctx, opts = {}) {
  let svc = null;
  Object.defineProperty(ctx, 'eventswing', { configurable: true, enumerable: false, get: () => (svc ||= createEventSwingService(ctx, opts)) });
  Object.defineProperty(ctx, 'eventswingIfOpen', { configurable: true, enumerable: false, get: () => svc });
  return ctx;
}
