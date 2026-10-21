// HTTP server: local-only binding, Host/Origin/CSRF checks, secret handling,
// API round-trips and restart persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { tempDir } from './helpers.js';
import { loadConfig } from '../server/config.js';
import { createServer, lazyContexts, checkStartupSecurity } from '../server/index.js';

const SECRET = 'td_live_ABCDEFGHIJKLMNOP';

async function startServer(dir, extra = {}) {
  const cfg = loadConfig({ ENV_FILE: path.join(dir, 'none.env'), SIGNAL_DESK_DATA_DIR: dir, SIGNAL_DESK_PORT: '0', MARKET_DATA_PROVIDER: 'none', TWELVEDATA_API_KEY: SECRET, ...extra });
  const contexts = lazyContexts(cfg);
  const server = createServer(cfg, { contexts, scheduler: null, version: 'test' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  cfg.port = port;
  // allowed host set is built from cfg.port at creation; rebuild with the real port
  server.close();
  const server2 = createServer(cfg, { contexts, scheduler: null, version: 'test' });
  await new Promise((r) => server2.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${port}`;
  const api = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method, headers: { 'Content-Type': 'application/json', 'X-Signal-Desk': '1', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null), text: null };
  };
  return { server: server2, base, api, cfg, contexts };
}

test('refuses non-loopback binding unless explicitly enabled with a strong token', () => {
  assert.throws(() => checkStartupSecurity({ host: '0.0.0.0', allowRemote: false }), /local-only/);
  assert.throws(() => checkStartupSecurity({ host: '0.0.0.0', allowRemote: true, accessToken: 'short' }), /24/);
  assert.doesNotThrow(() => checkStartupSecurity({ host: '0.0.0.0', allowRemote: true, accessToken: 'x'.repeat(32) }));
  assert.doesNotThrow(() => checkStartupSecurity({ host: '127.0.0.1' }));
});

test('Host, CSRF header and Origin checks', async () => {
  const s = await startServer(tempDir());
  const http = await import('node:http');
  const raw = (headers, method = 'GET', pathName = '/api/status') => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: s.cfg.port, path: pathName, method, headers }, (res) => { res.resume(); resolve(res.statusCode); });
    req.end(method === 'POST' ? '{}' : undefined);
  });
  assert.equal(await raw({ Host: 'evil.example.com' }), 421, 'DNS-rebinding host rejected');
  assert.equal(await raw({ Host: `127.0.0.1:${s.cfg.port}` }), 200);
  assert.equal(await raw({ Host: `localhost:${s.cfg.port}`, 'Content-Type': 'application/json' }, 'POST', '/api/backups'), 403, 'missing CSRF header');
  assert.equal(await raw({ Host: `localhost:${s.cfg.port}`, 'X-Signal-Desk': '1', Origin: 'https://evil.example.com' }, 'POST', '/api/backups'), 403, 'foreign origin');
  s.server.close();
});

test('secrets never appear in API responses', async () => {
  const s = await startServer(tempDir());
  for (const p of ['/api/status', '/api/settings', '/api/logs', '/api/export']) {
    const res = await fetch(s.base + p);
    const text = await res.text();
    assert.ok(!text.includes(SECRET), `${p} leaked a secret`);
  }
  const st = await s.api('GET', '/api/status');
  assert.equal(st.body.config.configured.twelvedata, true, 'reports configured status only');
  s.server.close();
});

test('API round trip: add holding, confirm identity, cash, positions show description, import preview', async () => {
  const dir = tempDir();
  const s = await startServer(dir);
  let r = await s.api('POST', '/api/transactions', { type: 'BASELINE', trade_date: '2026-10-01', symbol: 'vrt', exchange: 'NYSE', currency: 'USD', quantity: 4, price: 120, account: 'TFSA', unconfirmed_fields: ['price'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await s.api('GET', '/api/positions');
  let pos = r.body.positions[0];
  assert.equal(pos.symbol, 'VRT');
  assert.equal(pos.identityStatus, 'needs_confirmation');
  r = await s.api('PATCH', `/api/instruments/${pos.instrument_id}`, { identity_status: 'confirmed' });
  assert.equal(r.status, 400, 'confirmation requires a note on how it was confirmed');
  r = await s.api('PATCH', `/api/instruments/${pos.instrument_id}`, { identity_status: 'confirmed', identity_note: 'Brokerage shows NYSE, USD' });
  assert.equal(r.status, 200);
  r = await s.api('GET', '/api/positions');
  pos = r.body.positions[0];
  assert.equal(pos.description.oneLiner, 'Builds cooling and power equipment for data centers.');
  assert.ok(pos.description.sourceUrl.startsWith('https://'));
  assert.deepEqual(pos.unconfirmed, ['price']);
  r = await s.api('POST', '/api/cash', { account: 'TFSA', currency: 'USD', amount: 0, asOf: '2026-10-21', confirmed: true });
  assert.equal(r.body.cash[0].amount, 0);
  r = await s.api('POST', '/api/import/preview', { filename: 't.csv', text: 'date,type,symbol,exchange,currency,quantity,price\n2026-10-02,BUY,VRT,NYSE,USD,1,121\n' });
  assert.equal(r.body.summary.new, 1);
  r = await s.api('POST', `/api/import/${r.body.batchId}/apply`);
  assert.equal(r.body.inserted, 1);
  r = await s.api('GET', '/api/overview');
  assert.equal(r.status, 200);
  assert.ok(r.body.limitations.length > 0);
  s.server.close();
});

test('SPCX is never described or priced until confirmed', async () => {
  const s = await startServer(tempDir());
  await s.api('POST', '/api/transactions', { type: 'BASELINE', trade_date: '2026-10-01', symbol: 'SPCX', exchange: 'NASDAQ', currency: 'USD', quantity: 2, price: 100 });
  const r = await s.api('GET', '/api/positions');
  const p = r.body.positions[0];
  assert.match(p.description.oneLiner, /Identity not confirmed/);
  assert.equal(p.description.identityWarning, true);
  assert.equal(p.marketValue, null);
  s.server.close();
});

test('demo workspace is separate from the real one', async () => {
  const s = await startServer(tempDir());
  const demo = await s.api('GET', '/api/positions', null, { 'X-SD-Workspace': 'demo' });
  assert.ok(demo.body.positions.length > 0);
  const real = await s.api('GET', '/api/positions');
  assert.equal(real.body.positions.length, 0, 'demo data never appears in the real workspace');
  const files = fs.readdirSync(s.cfg.dataDir);
  assert.ok(files.includes('demo.sqlite') && files.includes('signal-desk.sqlite'));
  s.server.close();
});

test('backup, modify, restore', async () => {
  const s = await startServer(tempDir());
  await s.api('POST', '/api/transactions', { type: 'BUY', trade_date: '2026-10-01', symbol: 'MU', exchange: 'NASDAQ', currency: 'USD', quantity: 1, price: 100 });
  const b = await s.api('POST', '/api/backups');
  assert.ok(b.body.name.endsWith('.sqlite'));
  await s.api('POST', '/api/transactions', { type: 'BUY', trade_date: '2026-10-02', symbol: 'MU', exchange: 'NASDAQ', currency: 'USD', quantity: 5, price: 100 });
  let pos = (await s.api('GET', '/api/positions')).body.positions[0];
  assert.equal(pos.shares, 6);
  const r = await s.api('POST', '/api/backups/restore', { name: b.body.name });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  pos = (await s.api('GET', '/api/positions')).body.positions[0];
  assert.equal(pos.shares, 1);
  assert.equal((await s.api('POST', '/api/backups/restore', { name: '../../etc/passwd' })).status, 400);
  s.server.close();
});

test('data persists across a real process restart', async () => {
  const dir = tempDir();
  const env = { ...process.env, SIGNAL_DESK_DATA_DIR: dir, SIGNAL_DESK_PORT: '47391', SIGNAL_DESK_SCHEDULER: 'false', MARKET_DATA_PROVIDER: 'none', SIGNAL_DESK_QUIET: '1' };
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const start = async () => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: root, env, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try { const res = await fetch('http://127.0.0.1:47391/api/status'); if (res.ok) return child; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('server did not start');
  };
  let child = await start();
  const post = await fetch('http://127.0.0.1:47391/api/transactions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signal-Desk': '1' },
    body: JSON.stringify({ type: 'BUY', trade_date: '2026-10-01', symbol: 'ANET', exchange: 'NYSE', currency: 'USD', quantity: 3, price: 130 }),
  });
  assert.equal(post.status, 200);
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));
  child = await start();
  const pos = await (await fetch('http://127.0.0.1:47391/api/positions')).json();
  assert.equal(pos.positions[0].symbol, 'ANET');
  assert.equal(pos.positions[0].shares, 3);
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));
});
