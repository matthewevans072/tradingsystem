// Signal Desk server. Local-only by default (binds to 127.0.0.1).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT, redact } from './config.js';
import { initLog, log } from './log.js';
import { createContext } from './context.js';
import { matchRoute, HttpError } from './api.js';
import { createScheduler } from './scheduler.js';
import { autoBackupIfDue } from './backup.js';
import { refreshFx } from './marketdata.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];

export function checkStartupSecurity(cfg) {
  const local = LOOPBACK.includes(cfg.host);
  if (!local && !cfg.allowRemote) {
    throw new Error(`Refusing to bind to ${cfg.host}: Signal Desk holds private financial data and is local-only by default. See START-HERE.md "Remote access" before changing this.`);
  }
  if (!local && (!cfg.accessToken || cfg.accessToken.length < 24)) {
    throw new Error('Remote binding requires SIGNAL_DESK_ACCESS_TOKEN of at least 24 random characters.');
  }
}

export function createServer(cfg, { contexts, scheduler, version }) {
  const local = LOOPBACK.includes(cfg.host);
  const allowedHosts = new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`, `[::1]:${cfg.port}`]);

  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(status, {
      'Content-Type': isJson ? 'application/json; charset=utf-8' : headers['Content-Type'] || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 300 * 1024 * 1024) throw new HttpError(413, 'Request too large');
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      // DNS-rebinding protection: only answer to our own host names when local.
      if (local && !allowedHosts.has(req.headers.host || '')) return send(res, 421, { error: 'Unexpected Host header' });

      if (url.pathname.startsWith('/api/')) {
        if (cfg.accessToken) {
          const auth = req.headers.authorization || '';
          if (auth !== `Bearer ${cfg.accessToken}`) return send(res, 401, { error: 'Access token required' });
        }
        if (req.method !== 'GET') {
          // CSRF: browsers cannot add this header cross-site without a CORS preflight, which we never grant.
          if (req.headers['x-signal-desk'] !== '1') return send(res, 403, { error: 'Missing request header' });
          const origin = req.headers.origin;
          if (origin && !(local ? [...allowedHosts].some((h) => origin === `http://${h}`) : origin === `https://${req.headers.host}` || origin === `http://${req.headers.host}`)) {
            return send(res, 403, { error: 'Cross-origin request rejected' });
          }
        }
        const mode = req.headers['x-sd-workspace'] === 'demo' ? 'demo' : 'real';
        const ctx = contexts.get(mode);
        if (ctx.ready) await ctx.ready.catch(() => {});
        const route = matchRoute(req.method, url.pathname);
        if (!route) return send(res, 404, { error: 'Not found' });
        const body = req.method === 'GET' ? {} : await readBody(req);
        const query = Object.fromEntries(url.searchParams.entries());
        const out = await route.handler(ctx, { params: route.params, body, query, app: { scheduler: mode === 'real' ? scheduler : null, version } });
        return send(res, 200, out ?? { ok: true });
      }

      // Static files.
      let p = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.normalize(path.join(PUBLIC, p));
      if (!file.startsWith(PUBLIC)) return send(res, 400, 'Bad path');
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        // SPA fallback for client-side routes.
        if (!path.extname(p)) return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), { 'Content-Type': MIME['.html'] });
        return send(res, 404, 'Not found');
      }
      return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 400;
      const msg = redact(e.message || 'Error', cfg);
      if (!(e instanceof HttpError)) log.warn('api', `${req.method} ${url.pathname}: ${msg}`);
      return send(res, status, { error: msg });
    }
  });
}

export function lazyContexts(cfg) {
  const map = new Map();
  return {
    get(mode) {
      if (!map.has(mode)) map.set(mode, createContext(cfg, mode));
      return map.get(mode);
    },
    has: (m) => map.has(m),
  };
}

async function main() {
  const cfg = loadConfig();
  initLog(cfg);
  try {
    checkStartupSecurity(cfg);
  } catch (e) {
    log.error('startup', e.message);
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const contexts = lazyContexts(cfg);
  const real = contexts.get('real');
  try { autoBackupIfDue(real); } catch (e) { log.warn('backup', `auto backup failed: ${e.message}`); }
  const scheduler = cfg.schedulerEnabled ? createScheduler(real) : null;
  const server = createServer(cfg, { contexts, scheduler, version: pkg.version });
  server.on('error', (e) => {
    log.error('startup', e.code === 'EADDRINUSE' ? `Port ${cfg.port} is already in use. Is Signal Desk already running? Close it or set SIGNAL_DESK_PORT.` : e.message);
    process.exit(1);
  });
  server.listen(cfg.port, cfg.host, () => {
    log.info('startup', `Signal Desk ${pkg.version} running at http://${cfg.host === '::1' ? '[::1]' : cfg.host}:${cfg.port} (${LOOPBACK.includes(cfg.host) ? 'local only' : 'REMOTE ACCESS ENABLED'})`);
    log.info('startup', `market data: ${cfg.marketProvider}; data folder: ${cfg.dataDir}`);
    if (scheduler) scheduler.start();
    else log.warn('startup', 'Scheduler disabled (SIGNAL_DESK_SCHEDULER=false)');
    if (!scheduler) refreshFx(real).catch(() => {});
  });
  const shutdown = () => {
    log.info('shutdown', 'stopping');
    scheduler?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'server', 'index.js')) main();
