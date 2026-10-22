// /api/hxr/* routes (strategy/hxr/ENGINE-SPEC.md section 1), registered into
// the main route table by server/api.js, so the same local-only Host, Origin
// and X-Signal-Desk CSRF checks apply. Every response comes from service.js
// and is labelled simulated; nothing here touches the real portfolio, sends a
// notification or reaches a broker. The demo workspace's stub refuses every
// call (HXR runs on real market data only).
import { HxrError } from './service.js';

const ID = /^\d{1,12}$/;
const KINDS = ['selection', 'validation', 'evaluation', 'variant', 'prospective'];
const MAX_SYMBOLS = 20;

export function registerHxrRoutes(r, HttpError) {
  // HXR errors keep their status; anything else is a bad request.
  const route = (method, pattern, fn) => r(method, pattern, async (ctx, req) => {
    try {
      return await fn(ctx.hxr, req, ctx);
    } catch (e) {
      if (e instanceof HxrError) throw new HttpError(e.status, e.message);
      throw e;
    }
  });
  const id = (v) => {
    if (!ID.test(String(v))) throw new HttpError(400, 'Invalid id');
    return Number(v);
  };
  const obj = (b) => (b && typeof b === 'object' && !Array.isArray(b) ? b : {});
  // confirm and confirmed must be real booleans: "yes" or 1 is not a confirmation.
  const bool = (v, name) => {
    if (v != null && typeof v !== 'boolean') throw new HttpError(400, `${name} must be true or false`);
    return v === true;
  };
  const text = (v, name) => {
    if (v != null && typeof v !== 'string') throw new HttpError(400, `${name} must be text`);
    return v ?? '';
  };
  const limit = (v) => (v == null || v === '' ? undefined : Number(v));

  route('GET', '/api/hxr/overview', (hxr) => hxr.overview());
  route('GET', '/api/hxr/readiness', (hxr) => hxr.readiness());
  route('GET', '/api/hxr/fetch', (hxr) => hxr.fetchStatus());
  route('GET', '/api/hxr/runs', (hxr, { query }) => {
    if (query.kind && !KINDS.includes(query.kind)) throw new HttpError(400, `kind must be ${KINDS.join(', ')}`);
    return hxr.listRuns({ kind: query.kind || null, limit: limit(query.limit) });
  });
  route('GET', '/api/hxr/runs/:id', (hxr, { params }) => hxr.getRun(id(params.id)));
  route('GET', '/api/hxr/experiments', (hxr) => hxr.experiments());
  route('GET', '/api/hxr/ledger', (hxr) => hxr.ledger());
  route('GET', '/api/hxr/prospective', (hxr) => hxr.prospectiveStatus());
  // Third-party text: the response is labelled untrusted and the page renders it as text nodes only.
  route('GET', '/api/hxr/news', (hxr, { query }) => hxr.news({ symbol: query.symbol || null, limit: limit(query.limit) }));

  route('POST', '/api/hxr/fetch', (hxr, { body }) => {
    const b = obj(body);
    if (b.symbols != null && !Array.isArray(b.symbols)) throw new HttpError(400, 'symbols must be a list');
    if (Array.isArray(b.symbols) && (b.symbols.length > MAX_SYMBOLS || b.symbols.some((s) => typeof s !== 'string'))) throw new HttpError(400, `symbols must be a list of at most ${MAX_SYMBOLS} tickers`);
    return hxr.fetchData({ symbols: b.symbols ?? null });
  });
  route('POST', '/api/hxr/selection', (hxr, { body }) => {
    const b = obj(body);
    return hxr.runSelection({ confirm: bool(b.confirm, 'confirm'), reason: text(b.reason, 'reason') });
  });
  // The validation gate (PREREGISTRATION-3.md section 5): once per frozen version, between the development pick and the final run.
  route('POST', '/api/hxr/validation', (hxr, { body }) => {
    const b = obj(body);
    return hxr.runValidation({ confirm: bool(b.confirm, 'confirm'), reason: text(b.reason, 'reason') });
  });
  // The final run (stored as kind 'evaluation'): once, only after the validation gate passes.
  route('POST', '/api/hxr/evaluation', (hxr, { body }) => {
    const b = obj(body);
    return hxr.runEvaluation({ confirm: bool(b.confirm, 'confirm'), reason: text(b.reason, 'reason'), withoutFullList: bool(b.withoutFullList, 'withoutFullList') });
  });
  // The pending MU decision (PREREGISTRATION.md section 7), recorded before any run.
  route('POST', '/api/hxr/mu-decision', (hxr, { body }) => {
    const b = obj(body);
    return hxr.setMuDecision({ choice: text(b.choice, 'choice'), confirm: bool(b.confirm, 'confirm') });
  });
  // A flagged split-like overnight move the owner checked: recorded as not a split, with a reason.
  route('POST', '/api/hxr/readiness/reviewed-moves', (hxr, { body }) => {
    const b = obj(body);
    return hxr.reviewMove({ symbol: text(b.symbol, 'symbol'), date: text(b.date, 'date'), reason: text(b.reason, 'reason'), confirm: bool(b.confirm, 'confirm') });
  });
  route('POST', '/api/hxr/spcx', (hxr, { body }) => {
    const b = obj(body);
    if (typeof b.confirmed !== 'boolean') throw new HttpError(400, 'confirmed must be true or false');
    return hxr.setSpcxConfirmed({ confirmed: b.confirmed, confirm: bool(b.confirm, 'confirm') });
  });
  route('POST', '/api/hxr/prospective/start', (hxr, { body }) => hxr.startProspective({ confirm: bool(obj(body).confirm, 'confirm') }));
  // "Process now": always the server's clock, never a time sent by the client.
  route('POST', '/api/hxr/prospective/tick', (hxr) => hxr.prospectiveTick());
  route('POST', '/api/hxr/prospective/pause', (hxr) => hxr.pauseProspective());
  route('POST', '/api/hxr/prospective/resume', (hxr) => hxr.resumeProspective());
}
