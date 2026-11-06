// /api/eventswing/* routes, registered into the main route table by server/api.js, so the local-only Host, Origin
// and X-Signal-Desk CSRF checks apply. Read-only except marking notifications seen; the gate check is a read. Every
// response is a simulation result; nothing here touches the real portfolio or reaches a broker.
import { EsError } from './service.js';

const ID = /^\d{1,12}$/;
export function registerEventSwingRoutes(r, HttpError) {
  const route = (method, pattern, fn) => r(method, pattern, async (ctx, req) => {
    try { return await fn(ctx.eventswing, req, ctx); } catch (e) { if (e instanceof EsError) throw new HttpError(e.status, e.message); throw e; }
  });
  route('GET', '/api/eventswing/overview', (svc) => svc.overview());
  route('POST', '/api/eventswing/check', (svc, { body }) => { if (body?.confirm !== true) throw new HttpError(400, 'confirm must be true'); return svc.check(); });
  route('POST', '/api/eventswing/notifications/seen', (svc, { body }) => {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    for (const v of ids) if (!ID.test(String(v))) throw new HttpError(400, 'Invalid id');
    return { marked: svc.markSeen(ids.map(Number)) };
  });
}
