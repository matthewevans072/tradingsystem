// /api/research/* routes: the research runner's dashboard API, registered into the main route table by
// server/api.js, so the same local-only Host, Origin and X-Signal-Desk CSRF checks apply. Every response is a
// simulation result; nothing here touches the real portfolio, sends anything outside the app or reaches a
// broker. Campaign control (start, pause, resume, cancel) changes rows in the runner's own database and, for
// start and resume, launches the detached worker process.
import { ResearchError } from './service.js';
import { LABELS, STAGES } from './config.js';

const ID = /^\d{1,12}$/;

export function registerResearchRoutes(r, HttpError) {
  const route = (method, pattern, fn) => r(method, pattern, async (ctx, req) => {
    try { return await fn(ctx.research, req, ctx); } catch (e) { if (e instanceof ResearchError) throw new HttpError(e.status, e.message); throw e; }
  });
  const id = (v) => { if (!ID.test(String(v))) throw new HttpError(400, 'Invalid id'); return Number(v); };
  const obj = (b) => (b && typeof b === 'object' && !Array.isArray(b) ? b : {});
  const num = (v, name, { min = 0, max = 10000, dflt = null } = {}) => { if (v == null || v === '') return dflt; const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}`); return n; };

  route('GET', '/api/research/overview', (svc) => svc.overview());
  route('POST', '/api/research/campaigns', (svc, { body }) => { const b = obj(body); if (b.confirm !== true) throw new HttpError(400, 'confirm must be true: creating a campaign queues up to 100 development experiments'); return svc.createCampaign({ name: typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : 'Campaign 1' }); });
  route('GET', '/api/research/campaigns/:id', (svc, { params }) => svc.campaignStatus(id(params.id)));
  for (const action of ['start', 'pause', 'resume', 'cancel']) {
    route('POST', `/api/research/campaigns/:id/${action}`, (svc, { params, body }) => { const b = obj(body); if (b.confirm !== true) throw new HttpError(400, `confirm must be true to ${action} the campaign`); return svc[action](id(params.id)); });
  }
  route('GET', '/api/research/campaigns/:id/experiments', (svc, { params, query }) => {
    const q = query || {};
    const stage = q.stage == null || q.stage === '' ? null : num(q.stage, 'stage', { min: 0, max: 3 });
    const status = q.status ? String(q.status) : null;
    const label = q.label ? String(q.label) : null;
    if (label && !Object.values(LABELS).includes(label)) throw new HttpError(400, 'unknown label');
    return svc.experiments(id(params.id), { q: typeof q.q === 'string' ? q.q.slice(0, 200) : '', stage, status, label, limit: num(q.limit, 'limit', { min: 1, max: 1000, dflt: 200 }), offset: num(q.offset, 'offset', { min: 0, max: 100000, dflt: 0 }) });
  });
  route('GET', '/api/research/campaigns/:id/events', (svc, { params, query }) => svc.events(id(params.id), num(query?.limit, 'limit', { min: 1, max: 1000, dflt: 200 })));
  route('GET', '/api/research/experiments/:id', (svc, { params }) => svc.experiment(id(params.id)));
  route('GET', '/api/research/notifications', (svc, { query }) => svc.notifications({ unseenOnly: query?.unseen === 'true', limit: num(query?.limit, 'limit', { min: 1, max: 500, dflt: 100 }) }));
  route('POST', '/api/research/notifications/seen', (svc, { body }) => { const ids = Array.isArray(obj(body).ids) ? obj(body).ids.map((v) => id(v)) : []; return { marked: svc.markSeen(ids) }; });
  route('GET', '/api/research/meta', () => ({ labels: LABELS, stages: STAGES }));
}
