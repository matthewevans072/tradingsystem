// /api/newsreplay/* routes, registered into the main route table by server/api.js, so the local-only Host, Origin and
// X-Signal-Desk CSRF checks apply. Read-only: nothing here starts a run or writes a record. Every response is a
// simulation result; nothing touches the real portfolio or reaches a broker.
import { NrError } from './service.js';
import { BASKET } from './config.js';

const ID = /^\d{1,12}$/, CONFIG = /^(?:[A-Z]{1,3}-[A-C]|X[1-4])$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
export function registerNewsReplayRoutes(r, HttpError) {
  const route = (method, pattern, fn) => r(method, pattern, async (ctx, req) => {
    try { return await fn(ctx.newsreplay, req, ctx); } catch (e) { if (e instanceof NrError) throw new HttpError(e.status, e.message); throw e; }
  });
  const config = (q) => { const v = String(q?.config ?? 'D-A'); if (!CONFIG.test(v)) throw new HttpError(400, 'Invalid configuration'); return v; };
  route('GET', '/api/newsreplay/overview', (svc) => svc.overview());
  route('GET', '/api/newsreplay/plans', (svc, { query }) => {
    const q = query || {};
    const stock = q.stock ? String(q.stock) : null;
    if (stock && !BASKET.includes(stock)) throw new HttpError(400, 'Invalid stock');
    const session = q.session ? String(q.session) : null;
    if (session && !DATE.test(session)) throw new HttpError(400, 'Invalid session date');
    const offset = q.offset == null || q.offset === '' ? 0 : Number(q.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1e6) throw new HttpError(400, 'Invalid offset');
    return svc.plans({ config: config(q), stock, session, offset });
  });
  route('GET', '/api/newsreplay/plans/:id', (svc, { params, query }) => {
    if (!ID.test(String(params.id))) throw new HttpError(400, 'Invalid id');
    return svc.plan(Number(params.id), config(query));
  });
}
