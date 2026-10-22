// /api/lab/* routes (strategy/LAB-ARCHITECTURE.md), registered into the main
// route table by server/api.js, so the same local-only Host, Origin and
// X-Signal-Desk CSRF checks apply. Every response comes from lab.js and is
// labelled simulated; nothing here changes the real portfolio.
import { LabError, MAX_CSV_BYTES } from './lab.js';

const ID = /^\d{1,12}$/;

export function registerLabRoutes(r, HttpError) {
  // Lab errors keep their status; anything else is a bad request.
  const route = (method, pattern, fn) => r(method, pattern, async (ctx, req) => {
    try {
      return await fn(ctx.lab, req, ctx);
    } catch (e) {
      if (e instanceof LabError) throw new HttpError(e.status, e.message);
      throw e;
    }
  });
  const id = (v) => {
    if (!ID.test(String(v))) throw new HttpError(400, 'Invalid id');
    return Number(v);
  };
  const obj = (b) => (b && typeof b === 'object' && !Array.isArray(b) ? b : {});

  route('GET', '/api/lab/overview', (lab, { query }) => lab.overview({ mode: query.mode || 'intraday' }));
  route('GET', '/api/lab/bars', (lab, { query }) => lab.bars({ symbol: query.symbol, from: query.from || null, to: query.to || null, mode: query.mode || 'intraday', runId: query.runId ? id(query.runId) : null }));
  route('GET', '/api/lab/trades', (lab, { query }) => lab.listTrades({ source: query.source || null, runId: query.runId ? id(query.runId) : null, symbol: query.symbol || null, mode: query.mode || null, limit: query.limit, offset: query.offset }));
  route('GET', '/api/lab/trades/:id', (lab, { params }) => lab.getTrade(id(params.id)));
  route('GET', '/api/lab/runs', (lab, { query }) => lab.listRuns({ kind: query.kind || null, mode: query.mode || null, split: query.split || null, limit: query.limit }));
  route('GET', '/api/lab/runs/:id', (lab, { params }) => lab.getRun(id(params.id)));
  route('GET', '/api/lab/journal', (lab, { query }) => lab.journal({ source: query.source || 'forward', type: query.type || null, symbol: query.symbol || null, runId: query.runId ? id(query.runId) : null, mode: query.mode || 'intraday', limit: query.limit }));
  route('GET', '/api/lab/versions', (lab) => lab.versions());
  route('GET', '/api/lab/versions/diff', (lab, { query }) => lab.diffVersions(query.from, query.to));
  route('GET', '/api/lab/evaluation', (lab, { query }) => lab.evaluation({ mode: query.mode || 'intraday' }));
  route('GET', '/api/lab/fetch', (lab) => lab.fetchStatus());
  route('GET', '/api/lab/readiness', (lab) => lab.readiness());
  route('GET', '/api/lab/forward-report', (lab, { query }) => lab.forwardReport({ mode: query.mode || 'intraday' }));

  route('POST', '/api/lab/runs', (lab, { body }) => {
    const b = obj(body);
    const { run } = lab.startBacktest({ mode: b.mode, split: b.split });
    return lab.getRun(run.id);
  });
  route('POST', '/api/lab/holdout', (lab, { body }) => {
    const b = obj(body);
    if (b.reason != null && typeof b.reason !== 'string') throw new HttpError(400, 'reason must be text');
    const { run } = lab.startHoldout({ mode: b.mode, reason: b.reason || '', confirm: b.confirm === true });
    return lab.getRun(run.id);
  });
  route('POST', '/api/lab/import', (lab, { body }) => {
    const b = obj(body);
    if (typeof b.text === 'string' && Buffer.byteLength(b.text, 'utf8') > MAX_CSV_BYTES) throw new HttpError(413, 'The CSV is larger than 20 MB; split it into smaller files');
    if (b.replace != null && typeof b.replace !== 'boolean') throw new HttpError(400, 'replace must be true or false');
    return lab.importCsv({ symbol: b.symbol, exchange: b.exchange || null, text: b.text, format: b.format || null, replace: b.replace === true });
  });
  route('POST', '/api/lab/fetch', (lab, { body }) => {
    const b = obj(body);
    if (b.symbols != null && !Array.isArray(b.symbols)) throw new HttpError(400, 'symbols must be a list');
    if (Array.isArray(b.symbols) && b.symbols.length > 50) throw new HttpError(400, 'Too many symbols');
    if (b.source != null && typeof b.source !== 'string') throw new HttpError(400, 'source must be text');
    if (b.replace != null && typeof b.replace !== 'boolean') throw new HttpError(400, 'replace must be true or false');
    return lab.fetchHistory({ symbols: b.symbols ?? null, from: b.from || null, to: b.to || null, source: b.source || null, replace: b.replace === true });
  });
  route('POST', '/api/lab/forward', (lab, { body }) => {
    const b = obj(body);
    return lab.setForward({ mode: b.mode, enabled: b.enabled });
  });
}
