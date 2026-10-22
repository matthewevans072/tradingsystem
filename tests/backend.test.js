// The Anthropic backend against a local mock of the Messages API: request
// shape, streamed tool-use responses, fallback handling, abort and error
// mapping. (Whether the real API accepts the request needs a real key.)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tempDir } from './helpers.js';
import { loadConfig } from '../server/config.js';
import { createBackend, usableContent } from '../server/agent/backend.js';
import { toolsForApi } from '../server/agent/tools.js';
import { SYSTEM_PROMPT } from '../server/agent/prompt.js';
import { NO_HOST_KEYS } from './no-host-keys.js';

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

function streamOf({ model = 'claude-opus-5-5', blocks, stop = 'tool_use', iterations = null }) {
  const ev = [{ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 } } }];
  blocks.forEach((b, index) => {
    if (b.type === 'tool_use') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      ev.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    } else {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      ev.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
    }
    ev.push({ type: 'content_block_stop', index });
  });
  ev.push({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 90, ...(iterations ? { iterations } : {}) } });
  ev.push({ type: 'message_stop' });
  return sse(ev);
}

async function mockApi(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const rec = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
      seen.push(rec);
      handler(rec, res);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, seen, url: `http://127.0.0.1:${server.address().port}` };
}

function backendFor(url, extra = {}) {
  process.env.ANTHROPIC_BASE_URL = url;
  const dir = tempDir();
  const cfg = loadConfig({ ENV_FILE: path.join(dir, 'none.env'), ...NO_HOST_KEYS, SIGNAL_DESK_DATA_DIR: dir, ANTHROPIC_API_KEY: 'sk-ant-test-key-123', ...extra });
  return createBackend(cfg);
}

test('backend: request shape, streamed tool use and the served model', async () => {
  const api = await mockApi((rec, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(streamOf({ blocks: [{ type: 'tool_use', id: 'toolu_1', name: 'get_portfolio', input: { include_closed: false } }] }));
  });
  try {
    const b = backendFor(api.url);
    assert.equal(b.available, true);
    const resp = await b.create({ system: SYSTEM_PROMPT, tools: toolsForApi(), messages: [{ role: 'user', content: 'How many positions?' }] });
    const req = api.seen[0];
    assert.equal(req.url, '/v1/messages?beta=true');
    assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(req.headers['x-api-key'], 'sk-ant-test-key-123');
    assert.equal(req.body.model, 'claude-opus-5-5');
    assert.equal(req.body.stream, true);
    assert.equal(req.body.fallbacks, 'default');
    assert.deepEqual(req.body.tool_choice, { type: 'auto' }, 'forced tool choice is not allowed on this model');
    assert.equal(req.body.output_config.effort, 'high');
    assert.deepEqual(req.body.cache_control, { type: 'ephemeral' });
    assert.equal(req.body.system[0].cache_control.type, 'ephemeral');
    assert.equal(req.body.system[0].text, SYSTEM_PROMPT);
    assert.equal(req.body.betas, undefined, 'betas go in the header, not the body');
    assert.equal(req.body.tools.filter((t) => t.strict).length, 2);
    assert.equal(resp.stop_reason, 'tool_use');
    assert.deepEqual(resp.content[0].input, { include_closed: false });
    assert.equal(resp.model, 'claude-opus-5-5');
    assert.equal(resp.usage.output_tokens, 90);
  } finally {
    api.server.close();
  }
});

test('backend: errors map to plain messages without the key; abort cancels the call', async () => {
  let mode = 'auth';
  const api = await mockApi((rec, res) => {
    if (mode === 'auth') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); return; }
    if (mode === 'bad') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'tools.3: too many strict tools' } })); return; }
    if (mode === 'rate') { res.writeHead(429, { 'Content-Type': 'application/json', 'retry-after': '0' }); res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } })); return; }
    // hang until the client goes away
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': ping\n\n');
  });
  try {
    const b = backendFor(api.url);
    const call = (signal) => b.create({ system: 's', tools: [], messages: [{ role: 'user', content: 'x' }], signal });
    await assert.rejects(call(), (e) => e.kind === 'auth' && /rejected/.test(e.message) && !e.message.includes('sk-ant'));
    mode = 'bad';
    await assert.rejects(call(), (e) => e.kind === 'bad_request' && /too many strict tools/.test(e.message));
    mode = 'rate';
    await assert.rejects(call(), (e) => e.kind === 'rate_limit');
    mode = 'hang';
    const ac = new AbortController();
    const p = call(ac.signal);
    setTimeout(() => ac.abort(), 100);
    await assert.rejects(p, (e) => e.kind === 'aborted');
  } finally {
    api.server.closeAllConnections?.();
    api.server.close();
  }
});

test('backend: a fallback answer keeps only the content after the boundary', async () => {
  const api = await mockApi((rec, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(streamOf({ model: 'claude-opus-4-8', stop: 'tool_use', blocks: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'toolu_9', name: 'get_portfolio', input: { include_closed: false } }],
      iterations: [{ type: 'message', model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 0 }, { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 1200, output_tokens: 90 }] }));
  });
  try {
    const b = backendFor(api.url);
    const resp = await b.create({ system: 's', tools: [], messages: [{ role: 'user', content: 'x' }] });
    assert.equal(resp.model, 'claude-opus-4-8');
    assert.equal(resp.usage.iterations.length, 2);
    const withBoundary = [{ type: 'tool_use', id: 'declined', name: 'get_news', input: {} }, { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } }, ...resp.content];
    assert.deepEqual(usableContent(withBoundary).map((x) => x.id || x.type), ['text', 'toolu_9']);
  } finally {
    api.server.close();
  }
});
