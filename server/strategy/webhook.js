// Optional TradingView alert receiver (strategy/LAB-ARCHITECTURE.md). Off
// unless LAB_WEBHOOK_SECRET (24+ characters) and LAB_WEBHOOK_PORT are set. A
// separate listener on 127.0.0.1 that accepts only POST /tradingview; it is
// meant to sit behind a tunnel or reverse proxy the owner sets up on purpose.
// Alerts are journalled and compared with Signal Desk's own signals. They never
// drive the simulated account, and nothing here places or changes anything.
// The secret is never stored or logged.
import http from 'node:http';
import crypto from 'node:crypto';
import { insertAlert } from './store.js';
import { log } from '../log.js';

export const MAX_BODY = 8 * 1024;
export const RATE_PER_MINUTE = 60;
export const MIN_SECRET_LENGTH = 24;
const BAR_MS = 15 * 60000;
const FUTURE_SLACK_MS = 60000;
const FILL_MAX_AGE_MS = 4 * 86400000; // fill messages carry the earlier signal/order bar (overnight, weekends)
const EVENTS = ['order_placed', 'signal_rejected', 'entry_cancelled', 'setup_eligible', 'setup_expired', 'setup_invalidated', 'entry_filled', 'exit_filled'];
const FILL_EVENTS = new Set(['entry_filled', 'exit_filled']);

const digest = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();

// Constant-time comparison of the secret (hashes have equal length).
export function secretMatches(given, secret) {
  if (typeof given !== 'string' || !secret) return false;
  return crypto.timingSafeEqual(digest(given), digest(secret));
}

// A copy of the payload without the secret, wherever it appears.
function scrub(v, secret) {
  if (typeof v === 'string') return secret && v.includes(secret) ? v.split(secret).join('[REDACTED]') : v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, secret));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'secret').map(([k, x]) => [k, scrub(x, secret)]));
  return v;
}

const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const optStr = (v, max) => v == null || str(v, max);
const num = (v) => v == null || (typeof v === 'number' && Number.isFinite(v));

// Returns { payload } or { error }.
export function validatePayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { error: 'the body must be a JSON object' };
  const errs = [];
  if (!str(p.strategy, 64)) errs.push('strategy');
  if (!(typeof p.version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p.version))) errs.push('version');
  if (!['intraday', 'swing'].includes(p.mode)) errs.push('mode');
  if (!EVENTS.includes(p.event)) errs.push('event');
  const symbol = typeof p.symbol === 'string' ? p.symbol.trim().toUpperCase().replace(/^[A-Z ]+:/, '') : '';
  if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)) errs.push('symbol');
  if (!optStr(p.exchange, 32)) errs.push('exchange');
  if (p.timeframe != null && String(p.timeframe) !== '15') errs.push('timeframe (must be 15)');
  if (!(Number.isInteger(p.barTime) && p.barTime > 946684800000 && p.barTime < 4102444800000)) errs.push('barTime (UNIX milliseconds)');
  if (!(p.barCloseTime == null || (Number.isInteger(p.barCloseTime) && p.barCloseTime > p.barTime))) errs.push('barCloseTime');
  if (!(p.timenow == null || Number.isInteger(p.timenow))) errs.push('timenow');
  if (!optStr(p.setupId, 40)) errs.push('setupId');
  if (!optStr(p.orderId, 40)) errs.push('orderId');
  if (p.prices != null && (typeof p.prices !== 'object' || Array.isArray(p.prices) || !Object.values(p.prices).every(num))) errs.push('prices');
  for (const k of ['touchesUpper', 'touchesLower', 'qty', 'volume', 'avgVolume']) if (!num(p[k])) errs.push(k);
  if (!optStr(p.reason, 200) || !optStr(p.binding, 40)) errs.push('reason/binding');
  if (errs.length) return { error: `invalid payload: ${errs.join(', ')}` };
  return { payload: { ...p, symbol } };
}

export function dedupeKey(p) {
  return [p.strategy, p.version, p.mode, p.symbol, p.event, new Date(p.barTime).toISOString(), p.orderId ?? ''].join('|');
}

// The receiver's decision for one request body (Buffer or string). Pure apart
// from the database write; the HTTP server below only adds limits.
export function handleAlert({ db, secret, body, now = Date.now(), maxSignalDelayMin = 5 }) {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const receivedAt = new Date(nowMs).toISOString();
  const record = (status, reason, extra = {}) => insertAlert(db, { receivedAt, status, reason, ...extra });
  let p;
  try {
    p = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
  } catch {
    record('rejected', 'invalid JSON');
    return { status: 400, body: { ok: false, error: 'invalid JSON' } };
  }
  if (!secretMatches(p?.secret, secret)) {
    record('rejected', 'wrong or missing secret', { payload: scrub(p, secret), symbol: typeof p?.symbol === 'string' ? p.symbol.slice(0, 20) : null, event: typeof p?.event === 'string' ? p.event.slice(0, 40) : null });
    return { status: 401, body: { ok: false, error: 'unauthorized' } };
  }
  const clean = scrub(p, secret);
  const v = validatePayload(clean);
  if (v.error) {
    record('rejected', v.error, { payload: clean });
    return { status: 400, body: { ok: false, error: v.error } };
  }
  const a = v.payload;
  const barTime = new Date(a.barTime).toISOString();
  const closeMs = a.barCloseTime ?? a.barTime + BAR_MS;
  const fields = { payload: a, symbol: a.symbol, event: a.event, barTime };
  if (a.barTime > nowMs + FUTURE_SLACK_MS) {
    record('rejected', 'the bar is in the future (check the clock)', fields);
    return { status: 422, body: { ok: false, error: 'bar time is in the future' } };
  }
  const maxAge = FILL_EVENTS.has(a.event) ? FILL_MAX_AGE_MS : Math.max(5, maxSignalDelayMin) * 60000;
  if (nowMs - closeMs > maxAge) {
    record('rejected', `expired: the bar closed ${Math.round((nowMs - closeMs) / 60000)} minutes before the alert arrived`, fields);
    return { status: 422, body: { ok: false, error: 'bar is too old' } };
  }
  const r = insertAlert(db, { receivedAt, status: 'accepted', reason: null, dedupeKey: dedupeKey(a), ...fields });
  return { status: 200, body: { ok: true, status: r.status, id: r.id } };
}

// Sliding one-minute window shared by all callers.
function rateLimiter(perMinute) {
  const hits = [];
  return (nowMs) => {
    while (hits.length && nowMs - hits[0] >= 60000) hits.shift();
    if (hits.length >= perMinute) return false;
    hits.push(nowMs);
    return true;
  };
}

export function createWebhookServer({ getDb, secret, clock = () => Date.now(), maxSignalDelayMin = 5, perMinute = RATE_PER_MINUTE }) {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new Error(`LAB_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  const allow = rateLimiter(perMinute);
  let limitedNoted = 0;
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close' });
      res.end(JSON.stringify(body));
    };
    const nowMs = clock();
    const path = (req.url || '').split('?')[0];
    if (path !== '/tradingview') { req.resume(); return send(404, { ok: false, error: 'not found' }); }
    if (!allow(nowMs)) {
      req.resume();
      // One record per minute while limited, so a flood cannot fill the database.
      if (nowMs - limitedNoted >= 60000) {
        limitedNoted = nowMs;
        try { insertAlert(getDb(), { receivedAt: new Date(nowMs).toISOString(), status: 'rejected', reason: `rate limit: more than ${perMinute} requests a minute` }); } catch { /* journal unavailable */ }
      }
      return send(429, { ok: false, error: 'too many requests' });
    }
    if (req.method !== 'POST') {
      req.resume();
      try { insertAlert(getDb(), { receivedAt: new Date(nowMs).toISOString(), status: 'rejected', reason: `method ${String(req.method).slice(0, 10)} not allowed` }); } catch { /* journal unavailable */ }
      return send(405, { ok: false, error: 'method not allowed' });
    }
    const tooBig = () => {
      try { insertAlert(getDb(), { receivedAt: new Date(nowMs).toISOString(), status: 'rejected', reason: `body over ${MAX_BODY} bytes` }); } catch { /* journal unavailable */ }
      send(413, { ok: false, error: 'body too large' });
      req.destroy();
    };
    if (Number(req.headers['content-length']) > MAX_BODY) return tooBig();
    const chunks = [];
    let size = 0, done = false;
    // TradingView cancels after 3 seconds; a slow body is dropped before that.
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      send(408, { ok: false, error: 'request timed out' });
      req.destroy();
    }, 2000);
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY) { done = true; clearTimeout(timer); return tooBig(); }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        const r = handleAlert({ db: getDb(), secret, body: Buffer.concat(chunks), now: clock(), maxSignalDelayMin });
        send(r.status, r.body);
      } catch {
        try { insertAlert(getDb(), { receivedAt: new Date(clock()).toISOString(), status: 'error', reason: 'the receiver could not record the alert' }); } catch { /* journal unavailable */ }
        send(500, { ok: false, error: 'internal error' });
      }
    });
    req.on('error', () => { done = true; clearTimeout(timer); });
  });
  server.requestTimeout = 3000;
  server.headersTimeout = 3000;
  return server;
}

// Started by server/index.js. Returns the listening server or null (off).
export function startLabWebhook(cfg, getLab) {
  const secret = cfg.secrets?.LAB_WEBHOOK_SECRET || '';
  const port = cfg.lab?.webhookPort ?? null;
  if (!secret && !port) return null;
  if (!secret || !port) { log.warn('lab-webhook', 'TradingView alert receiver not started: set both LAB_WEBHOOK_SECRET and LAB_WEBHOOK_PORT to enable it.'); return null; }
  if (secret.length < MIN_SECRET_LENGTH) { log.warn('lab-webhook', `TradingView alert receiver not started: LAB_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} random characters.`); return null; }
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === cfg.port) { log.warn('lab-webhook', 'TradingView alert receiver not started: LAB_WEBHOOK_PORT must be a free port number different from SIGNAL_DESK_PORT.'); return null; }
  const server = createWebhookServer({ getDb: () => getLab().db, secret, maxSignalDelayMin: cfg.lab?.maxSignalDelayMin ?? 5 });
  server.on('error', (e) => log.warn('lab-webhook', `TradingView alert receiver stopped: ${e.code === 'EADDRINUSE' ? `port ${port} is in use` : e.message}`));
  server.listen(port, '127.0.0.1', () => {
    log.warn('lab-webhook', `TradingView alert receiver listening on http://127.0.0.1:${port}/tradingview (simulation journal only; alerts never trade or drive the simulated account). `
      + 'It is reachable from the internet only through a tunnel or reverse proxy you set up: forward only POST /tradingview, keep LAB_WEBHOOK_SECRET private, and remove the tunnel when you stop using it.');
  });
  return server;
}
