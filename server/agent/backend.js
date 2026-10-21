// Model backend for Ask Signal Desk. Configured in .env:
//   CHAT_BACKEND=anthropic|disabled   (default: anthropic when ANTHROPIC_API_KEY is set)
//   CHAT_MODEL=claude-opus-5-5         CHAT_EFFORT=high
//   CHAT_DAILY_BUDGET_USD=5            CHAT_MAX_TOOL_ROUNDS=8
//   CHAT_PRICE_INPUT / CHAT_PRICE_OUTPUT  US$ per million tokens, for a model
//                                         not in the table below
// The app needs its own Anthropic API key (console.anthropic.com). Building or
// running Signal Desk with Claude Code does NOT give the app model access, and
// API usage is billed per token to that key, separately from any Claude plan.
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../config.js';
import { nowIso } from '../db.js';
import { todayIn, NY } from '../time.js';

// US$ per million tokens (input, output, cache read, cache write at the
// 5-minute TTL). Estimates for the spend display and daily cap; check current
// pricing on anthropic.com. Fallback models are listed because the API can
// answer a declined request with one of them (see `fallbacks` below).
export const PRICING = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-opus-5': [5, 25, 0.5, 6.25],
  'claude-opus-4-8': [5, 25, 0.5, 6.25],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
  'claude-fable-5-1': [10, 50, 0.25, 12.5],
};

export function chatConfig(cfg) {
  const env = cfg.chat || {};
  const backend = env.backend || (cfg.secrets.ANTHROPIC_API_KEY ? 'anthropic' : 'disabled');
  const pin = Number(env.priceInput), pout = Number(env.priceOutput);
  return {
    backend,
    model: env.model || cfg.anthropicModel || 'claude-opus-5-5',
    effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(env.effort) ? env.effort : 'high',
    dailyBudgetUsd: Number.isFinite(env.dailyBudgetUsd) ? env.dailyBudgetUsd : 5,
    maxToolRounds: Number.isFinite(env.maxToolRounds) ? Math.min(Math.max(env.maxToolRounds, 2), 15) : 8,
    // User-supplied prices (cache rates derived the usual way) for unlisted models.
    priceOverride: pin > 0 && pout > 0 ? [pin, pout, pin * 0.1, pin * 1.25] : null,
  };
}

// The listed id behind a model string: exact, or the same id with a dated
// snapshot suffix (claude-opus-5-5-20261001). Other versions do not match.
export function baseModel(model) {
  if (!model) return null;
  if (PRICING[model]) return model;
  const m = /^(.*)-\d{8}$/.exec(model);
  return m && PRICING[m[1]] ? m[1] : null;
}

const sameModel = (a, b) => !!a && !!b && (a === b || a.replace(/-\d{8}$/, '') === b.replace(/-\d{8}$/, ''));

// Price row for a model id; the .env override applies to a model not listed.
export function priceFor(model, override = null) {
  const base = baseModel(model);
  return base ? PRICING[base] : override;
}

export function estimateCost(model, usage, override = null) {
  const p = priceFor(model, override);
  if (!p || !usage) return null;
  const inTok = usage.input_tokens || 0, outTok = usage.output_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0, cw = usage.cache_creation_input_tokens || 0;
  return (inTok * p[0] + outTok * p[1] + cr * p[2] + cw * p[3]) / 1e6;
}

// Cost of one API response. With server-side fallbacks, usage.iterations is
// the per-attempt record (each priced at the model that ran it); top-level
// usage only covers the attempt that produced the returned message.
export function responseCost(resp, requestedModel, override = null) {
  const its = Array.isArray(resp?.usage?.iterations) && resp.usage.iterations.length
    ? resp.usage.iterations
    : [{ ...(resp?.usage || {}), model: resp?.model }];
  let cost = 0, unpriced = false;
  const models = new Set();
  const tokens = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (const it of its) {
    const m = it.model || resp?.model || requestedModel;
    models.add(m);
    for (const k of Object.keys(tokens)) tokens[k] += it[k] || 0;
    // The .env override applies to the configured model (and its dated ids).
    // An unlisted model that answered instead (a fallback) is estimated at the
    // configured model's price rather than counted as free.
    let c = estimateCost(m, it, sameModel(m, requestedModel) ? override : null);
    if (c == null) c = estimateCost(requestedModel, it, override);
    if (c == null) unpriced = true;
    else cost += c;
  }
  return { cost, unpriced, models: [...models], tokens };
}

// ---------- spend tracking ----------
// One file in the data directory, shared by the real and demo workspaces, so
// the daily cap holds however the questions are split between them. Each
// workspace also keeps its own chat_usage rows for history.

const stores = new Map();

function usageFile(cfg) {
  return path.join(cfg.dataDir, 'chat-usage.json');
}

function readStore(cfg) {
  const f = usageFile(cfg);
  if (stores.has(f)) return stores.get(f);
  let s = { days: {} };
  if (fs.existsSync(f)) {
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (raw && typeof raw.days === 'object') s = raw;
      else throw new Error('unexpected content');
    } catch {
      // Fail closed: an unreadable spend record must not reset the cap.
      s = { days: {}, corrupt: true };
    }
  }
  stores.set(f, s);
  return s;
}

function writeStore(cfg, s) {
  const keep = Object.keys(s.days).sort().slice(-60);
  s.days = Object.fromEntries(keep.map((d) => [d, s.days[d]]));
  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    const f = usageFile(cfg);
    // Write-then-rename so a crash mid-write cannot leave a truncated file.
    fs.writeFileSync(`${f}.tmp`, JSON.stringify({ days: s.days }, null, 1));
    fs.renameSync(`${f}.tmp`, f);
  } catch { /* the in-memory total still enforces the cap for this run */ }
}

// Spend reserved by model calls in flight, so concurrent questions (in either
// workspace) cannot each start a call once the cap is nearly reached.
const reservations = new Map();
function reservedUsd(cfg) {
  return [...(reservations.get(usageFile(cfg)) || new Map()).values()].reduce((a, b) => a + b, 0);
}
export function reserveSpend(cfg) {
  const f = usageFile(cfg);
  const d = readStore(cfg).days[todayIn(NY)];
  const estimate = d?.calls ? Math.max(0.01, d.cost_usd / d.calls) : 0.05;
  const map = reservations.get(f) || new Map();
  reservations.set(f, map);
  const id = Symbol('call');
  map.set(id, estimate);
  return { estimate, release: () => map.delete(id) };
}

export function spentToday(cfg) {
  const s = readStore(cfg);
  const d = s.days[todayIn(NY)];
  return { usd: d?.cost_usd || 0, unpricedCalls: d?.unpriced_calls || 0, reservedUsd: reservedUsd(cfg), corrupt: !!s.corrupt };
}

// Records one response; returns its cost (null if no part of it is priced).
export function recordUsage(ctx, resp, requestedModel, override = null) {
  const r = responseCost(resp, requestedModel, override);
  const day = todayIn(NY);
  const s = readStore(ctx.cfg);
  const d = (s.days[day] ||= { cost_usd: 0, unpriced_calls: 0, calls: 0, input_tokens: 0, output_tokens: 0, models: {} });
  d.calls += 1;
  d.cost_usd += r.cost;
  if (r.unpriced) d.unpriced_calls += 1;
  d.input_tokens += r.tokens.input_tokens + r.tokens.cache_read_input_tokens + r.tokens.cache_creation_input_tokens;
  d.output_tokens += r.tokens.output_tokens;
  for (const m of r.models) d.models[m] = (d.models[m] || 0) + 1;
  writeStore(ctx.cfg, s);
  ctx.db.prepare('INSERT INTO chat_usage (at, day, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd) VALUES (?,?,?,?,?,?,?,?)')
    .run(nowIso(), day, r.models.join(','), r.tokens.input_tokens, r.tokens.output_tokens, r.tokens.cache_read_input_tokens, r.tokens.cache_creation_input_tokens, r.cost);
  return { ...r, cost: r.unpriced && r.cost === 0 ? null : r.cost };
}

// Whether the daily cap allows another model call (counting calls in flight).
// An unpriced model cannot be capped, so it is refused unless the cap is off (0).
export function budgetCheck(cfg, cc) {
  const cap = cc.dailyBudgetUsd;
  if (cap == null || cap <= 0) return { ok: true };
  if (!priceFor(cc.model, cc.priceOverride)) {
    return { ok: false, reason: `No price is known for model "${cc.model}", so the daily spending cap cannot be enforced. Set CHAT_PRICE_INPUT and CHAT_PRICE_OUTPUT (US$ per million tokens) in .env, or set CHAT_DAILY_BUDGET_USD=0 to run without a cap.` };
  }
  const t = spentToday(cfg);
  if (t.corrupt) return { ok: false, reason: `The spend record (${usageFile(cfg)}) could not be read, so the daily cap cannot be checked. Chat is paused to protect the cap; delete that file to reset today's total.` };
  const committed = t.usd + t.reservedUsd;
  if (committed >= cap) return { ok: false, reason: `Today's Ask Signal Desk spending cap (US$${cap}) has been reached (estimated US$${t.usd.toFixed(2)} used${t.reservedUsd ? `, US$${t.reservedUsd.toFixed(2)} in progress` : ''}). Raise CHAT_DAILY_BUDGET_USD in .env or try tomorrow.` };
  return { ok: true, spent: t.usd, cap };
}

export class BackendError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

// Drop the parts of a response that must not be echoed back or acted on.
// After a mid-output fallback, thinking and tool_use blocks before the last
// `fallback` boundary belong to the declined attempt; the marker itself is an
// audit record.
export function usableContent(content) {
  const blocks = Array.isArray(content) ? content : [];
  const lastFallback = blocks.map((b) => b?.type).lastIndexOf('fallback');
  return blocks.filter((b, i) => {
    if (b?.type === 'fallback') return false;
    if (i < lastFallback && ['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use'].includes(b?.type)) return false;
    return true;
  });
}

export function createBackend(cfg) {
  const cc = chatConfig(cfg);
  if (cc.backend === 'disabled' || cc.backend === 'none') {
    return { name: 'disabled', available: false, reason: 'Ask Signal Desk needs a model. Add ANTHROPIC_API_KEY to .env and restart (see START-HERE.md, "Ask Signal Desk").', config: cc };
  }
  if (cc.backend !== 'anthropic') {
    return { name: cc.backend, available: false, reason: `Unknown CHAT_BACKEND "${cc.backend}". Supported: anthropic, disabled.`, config: cc };
  }
  if (!cfg.secrets.ANTHROPIC_API_KEY) {
    return { name: 'anthropic', available: false, reason: 'CHAT_BACKEND=anthropic but ANTHROPIC_API_KEY is not set in .env.', config: cc };
  }
  let clientPromise = null;
  const client = () => {
    // Requests stream, so long high-effort answers don't hit a request
    // timeout; this timeout only bounds a stalled connection.
    clientPromise ||= import('@anthropic-ai/sdk').then(({ default: Anthropic }) => ({
      Anthropic, c: new Anthropic({ apiKey: cfg.secrets.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 10 * 60 * 1000 }),
    }));
    return clientPromise;
  };
  // Request options some models may not accept. If the API rejects one, the
  // call is retried once without it and the option stays off for this run.
  const off = new Set();
  const params = ({ system, tools, messages }) => ({
    model: cc.model,
    max_tokens: 16000,
    ...(off.has('fallbacks') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
    // Explicit breakpoint after the static system prompt (and tools), plus
    // automatic caching for the growing tool-loop tail.
    cache_control: { type: 'ephemeral' },
    ...(off.has('effort') ? {} : { output_config: { effort: cc.effort } }),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools: off.has('strict') ? tools.map(({ strict, ...t }) => t) : tools,
    tool_choice: { type: 'auto' },
    messages,
  });
  const optionIn = (msg) => (/fallback/i.test(msg) ? 'fallbacks' : /effort|output_config/i.test(msg) ? 'effort' : /strict/i.test(msg) ? 'strict' : null);
  return {
    name: 'anthropic', available: true, model: cc.model, config: cc,
    // Returns an Anthropic Messages API response object.
    async create(req) {
      const { Anthropic, c } = await client();
      const { signal } = req;
      for (let attempt = 0; ; attempt++) {
        let stream = null;
        try {
          stream = c.beta.messages.stream(params(req), signal ? { signal } : undefined);
          return await stream.finalMessage();
        } catch (e) {
          if (e instanceof Anthropic.BadRequestError && attempt === 0) {
            const opt = optionIn(e.message || '');
            if (opt && !off.has(opt)) { off.add(opt); continue; }
          }
          throw mapError(e, Anthropic, signal, stream);
        }
      }
    },
  };

  function mapError(e, Anthropic, signal, stream) {
    // Tokens already streamed are billed even when the call fails.
    const partial = stream?.currentMessage?.usage ? stream.currentMessage : null;
    const err = (kind, message) => Object.assign(new BackendError(kind, message), { partial });
    if (signal?.aborted || e instanceof Anthropic.APIUserAbortError) return err('aborted', 'Stopped: the request was cancelled.');
    if (e instanceof Anthropic.AuthenticationError) return err('auth', 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.');
    if (e instanceof Anthropic.PermissionDeniedError) return err('auth', 'The Anthropic API key does not have access to this model.');
    if (e instanceof Anthropic.RateLimitError) return err('rate_limit', 'Anthropic rate limit reached. Try again in a minute.');
    if (e instanceof Anthropic.BadRequestError) return err('bad_request', redact(`The model request was rejected: ${e.message}`, cfg));
    if (e instanceof Anthropic.APIConnectionTimeoutError) return err('timeout', 'The model took too long to respond. Try again, or ask a narrower question.');
    if (e instanceof Anthropic.APIConnectionError) return err('network', 'Could not reach the Anthropic API. Check the internet connection.');
    if (e instanceof Anthropic.APIError) return err('server', e.status ? `Anthropic API error ${e.status}. Try again shortly.` : 'Anthropic API error. Try again shortly.');
    if (/terminated|socket|ECONNRESET|other side closed|network/i.test(e?.message || '')) return err('network', 'The connection to Anthropic dropped part-way through the answer. Try again.');
    return err('unknown', redact(e?.message || String(e), cfg));
  }
}
