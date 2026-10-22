// /api/hxr routes through the real HTTP server (server/index.js): the CSRF
// header and Origin checks, confirmation required for every state change,
// body validation, the demo workspace refused, news labelled untrusted, and the
// Alpaca keys never in any response, even when the provider echoes them. The
// Alpaca host is a fake (tests/hxr-fake-alpaca.js); nothing here is a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { tempDir } from './helpers.js';
import { NO_HOST_KEYS } from './no-host-keys.js';
import { fakeAlpaca, KEY_ID, SECRET_KEY } from './hxr-fake-alpaca.js';
import { loadConfig } from '../server/config.js';
import { createServer, lazyContexts } from '../server/index.js';
import { attachHxr, NOTICE, REAL_ONLY } from '../server/hxr/service.js';

const T0 = Date.parse('2026-10-22T22:00:00Z');

async function startServer(dir, { fetchImpl, clock }) {
  const cfg = loadConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, MARKET_DATA_PROVIDER: 'none', SIGNAL_DESK_PORT: '0', ALPACA_API_KEY_ID: KEY_ID, ALPACA_API_SECRET_KEY: SECRET_KEY });
  const base = lazyContexts(cfg);
  // The real workspace's HXR service talks to the fake Alpaca with a fixed clock.
  const contexts = {
    get(mode) {
      const ctx = base.get(mode);
      if (mode === 'real' && !ctx.hxrFake) { attachHxr(ctx, { fetchImpl, clock, sleep: async () => {} }); ctx.hxrFake = true; }
      return ctx;
    },
    has: (m) => base.has(m),
  };
  const probe = createServer(cfg, { contexts, scheduler: null, version: 'test' });
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  cfg.port = probe.address().port;
  probe.close();
  const server = createServer(cfg, { contexts, scheduler: null, version: 'test' });
  await new Promise((r) => server.listen(cfg.port, '127.0.0.1', r));
  const bodies = [];
  const api = async (method, p, body, headers = {}) => {
    const res = await fetch(`http://127.0.0.1:${cfg.port}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Signal-Desk': '1', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    bodies.push(text);
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json };
  };
  return { server, api, cfg, contexts, bodies };
}

test('API: /api/hxr routes through the real server', { timeout: 120000 }, async () => {
  const dir = tempDir('hxr-api-');
  // Every bars request is refused with a message that echoes the keys.
  const echo = (c) => (c.path === '/v2/stocks/bars' ? { status: 401, ok: false, headers: { get: () => null }, text: async () => JSON.stringify({ message: `key ${KEY_ID} and secret ${SECRET_KEY} are not entitled` }) } : null);
  const fake = fakeAlpaca({ clock: () => new Date(T0), handler: echo });
  const s = await startServer(dir, { fetchImpl: fake.fetchImpl, clock: () => new Date(T0) });
  try {
    let r = await s.api('GET', '/api/hxr/overview');
    assert.equal(r.status, 200);
    assert.equal(r.body.simulated, true);
    assert.equal(r.body.notice, NOTICE);
    assert.equal(r.body.workspace, 'real');
    assert.equal(r.body.settings.alpacaKeys, true);
    assert.equal(r.body.universe.symbols.find((x) => x.symbol === 'SPCX').identity, 'pending_owner_confirmation');
    for (const p of ['/api/hxr/readiness', '/api/hxr/fetch', '/api/hxr/runs', '/api/hxr/experiments', '/api/hxr/ledger', '/api/hxr/prospective']) {
      r = await s.api('GET', p);
      assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.simulated, true, p);
    }
    assert.equal((await s.api('GET', '/api/hxr/runs?kind=backtest')).status, 400);
    assert.equal((await s.api('GET', '/api/hxr/runs/abc')).status, 400);
    assert.equal((await s.api('GET', '/api/hxr/runs/99999')).status, 404);
    r = await s.api('GET', '/api/hxr/news?symbol=MU&limit=5');
    assert.equal(r.status, 200);
    assert.equal(r.body.untrusted, true);
    assert.match(r.body.note, /untrusted/);
    assert.deepEqual(r.body.items, []);
    assert.equal((await s.api('GET', '/api/hxr/news?symbol=ZZZ')).status, 400);

    // State changes need the CSRF header and a same-origin request.
    r = await s.api('POST', '/api/hxr/fetch', {}, { 'X-Signal-Desk': '' });
    assert.equal(r.status, 403);
    r = await s.api('POST', '/api/hxr/selection', { confirm: true }, { Origin: 'https://evil.example.com' });
    assert.equal(r.status, 403);
    r = await s.api('POST', '/api/hxr/prospective/tick', undefined, { 'X-Signal-Desk': '' });
    assert.equal(r.status, 403);

    // Confirmation is a real boolean, and every gate holds.
    for (const [p, body, status, re] of [
      ['/api/hxr/selection', {}, 400, /confirm: true/],
      ['/api/hxr/selection', { confirm: 'yes' }, 400, /confirm must be true or false/],
      ['/api/hxr/selection', { confirm: 1 }, 400, /confirm must be true or false/],
      ['/api/hxr/selection', { confirm: true, reason: 7 }, 400, /reason must be text/],
      ['/api/hxr/selection', { confirm: true }, 409, /pending MU decision/],
      ['/api/hxr/validation', {}, 400, /confirm: true/],
      ['/api/hxr/validation', { confirm: true, reason: 7 }, 400, /reason must be text/],
      ['/api/hxr/validation', { confirm: true }, 409, /No frozen version/],
      ['/api/hxr/evaluation', {}, 400, /confirm: true/],
      ['/api/hxr/evaluation', { confirm: true }, 409, /No frozen version/],
      ['/api/hxr/evaluation', { confirm: true, withoutFullList: 'yes' }, 400, /withoutFullList must be true or false/],
      ['/api/hxr/mu-decision', { choice: 'keep' }, 400, /confirm: true/],
      ['/api/hxr/mu-decision', { choice: 'maybe', confirm: true }, 400, /choice must be "keep" or "drop"/],
      ['/api/hxr/mu-decision', { choice: 7, confirm: true }, 400, /choice must be text/],
      ['/api/hxr/readiness/reviewed-moves', { symbol: 'MU', date: '2024-03-04', reason: 'checked' }, 400, /confirm: true/],
      ['/api/hxr/readiness/reviewed-moves', { symbol: 'MU', date: '2024-03-04', confirm: true }, 400, /written reason/],
      ['/api/hxr/readiness/reviewed-moves', { symbol: 'MU', date: '04/03/2024', reason: 'checked', confirm: true }, 400, /YYYY-MM-DD/],
      ['/api/hxr/readiness/reviewed-moves', { symbol: 'ZZZ', date: '2024-03-04', reason: 'checked', confirm: true }, 400, /not in the HXR universe/],
      ['/api/hxr/readiness/reviewed-moves', { symbol: 'MU', date: '2024-03-04', reason: 'checked', confirm: true }, 409, /No split-like overnight move is flagged/],
      ['/api/hxr/spcx', { confirmed: true }, 400, /confirm: true/],
      ['/api/hxr/spcx', { confirmed: 'yes', confirm: true }, 400, /confirmed must be true or false/],
      ['/api/hxr/prospective/start', {}, 400, /confirm: true/],
      ['/api/hxr/prospective/start', { confirm: true }, 409, /No frozen version/],
      ['/api/hxr/prospective/tick', undefined, 409, /No prospective account/],
      ['/api/hxr/prospective/pause', undefined, 409, /No prospective account/],
      ['/api/hxr/prospective/resume', undefined, 409, /No prospective account/],
      ['/api/hxr/fetch', { symbols: 'MU' }, 400, /must be a list/],
      ['/api/hxr/fetch', { symbols: ['ZZZ'] }, 400, /not in the HXR universe/],
      ['/api/hxr/fetch', { symbols: [1] }, 400, /list of at most/],
    ]) {
      r = await s.api('POST', p, body);
      assert.equal(r.status, status, `${p} ${JSON.stringify(body)}: ${JSON.stringify(r.body)}`);
      assert.match(r.body.error, re, p);
    }
    // The MU decision is recorded before any run; the selection then meets the readiness gate.
    r = await s.api('POST', '/api/hxr/mu-decision', { choice: 'keep', confirm: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.muDecision.choice, 'keep');
    assert.equal((await s.api('GET', '/api/hxr/overview')).body.decisions.mu.choice, 'keep');
    r = await s.api('POST', '/api/hxr/selection', { confirm: true });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /pick rule is pending the owner's choice/, 'amendment 3b first (criteria-hxr-v3a.json)');
    assert.equal((await s.api('GET', '/api/hxr/runs?kind=validation')).status, 200);
    r = await s.api('POST', '/api/hxr/spcx', { confirmed: true, confirm: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.spcx.confirmed, true);
    assert.equal((await s.api('GET', '/api/hxr/overview')).body.settings.spcx.confirmed, true);

    // A provider error that echoes the keys reaches the client redacted.
    r = await s.api('POST', '/api/hxr/fetch', { symbols: ['MU'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await s.contexts.get('real').hxr.fetchDone;
    r = await s.api('GET', '/api/hxr/fetch');
    assert.equal(r.body.job.status, 'failed');
    assert.match(r.body.job.error, /access denied \(HTTP 401/);
    assert.match(r.body.job.error, /\[REDACTED\]/);
    assert.deepEqual((await s.api('GET', '/api/hxr/experiments')).body.experiments.map((e) => e.what), ['MU decision: keep MU in the evaluation', 'data download']);

    // The demo workspace refuses every HXR route.
    const demo = { 'X-SD-Workspace': 'demo' };
    for (const [m, p, body] of [['GET', '/api/hxr/overview'], ['GET', '/api/hxr/readiness'], ['GET', '/api/hxr/runs'], ['GET', '/api/hxr/news'], ['GET', '/api/hxr/prospective'], ['POST', '/api/hxr/fetch', {}], ['POST', '/api/hxr/selection', { confirm: true }], ['POST', '/api/hxr/prospective/start', { confirm: true }], ['POST', '/api/hxr/prospective/tick'], ['POST', '/api/hxr/mu-decision', { choice: 'keep', confirm: true }], ['POST', '/api/hxr/readiness/reviewed-moves', { symbol: 'MU', date: '2024-03-04', reason: 'x', confirm: true }]]) {
      r = await s.api(m, p, body, demo);
      assert.equal(r.status, 400, `${m} ${p}`);
      assert.equal(r.body.error, REAL_ONLY);
    }
    assert.ok(fs.readdirSync(dir).filter((f) => f.startsWith('hxr')).every((f) => f.startsWith('hxr-sim.sqlite')), 'one HXR database, the real workspace\'s');

    // No response ever carried a key.
    assert.ok(s.bodies.length > 40);
    for (const b of s.bodies) assert.ok(!b.includes(KEY_ID) && !b.includes(SECRET_KEY), b.slice(0, 200));
    assert.ok(fake.calls.length > 0 && fake.calls.every((c) => c.origin === 'https://data.alpaca.markets'));
  } finally {
    s.contexts.get('real').hxrIfOpen?.close();
    s.server.close();
  }
});
