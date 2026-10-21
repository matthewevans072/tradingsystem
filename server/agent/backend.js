// Model backend for Ask Signal Desk. Configured in .env:
//   CHAT_BACKEND=anthropic|disabled   (default: anthropic when ANTHROPIC_API_KEY is set)
//   CHAT_MODEL=claude-opus-5-5         CHAT_EFFORT=high
//   CHAT_DAILY_BUDGET_USD=5            CHAT_MAX_TOOL_ROUNDS=8
// The app needs its own Anthropic API key (console.anthropic.com). Building or
// running Signal Desk with Claude Code does NOT give the app model access, and
// API usage is billed per token to that key, separately from any Claude plan.
import { redact } from '../config.js';
import { nowIso } from '../db.js';
import { todayIn, NY } from '../time.js';

// US$ per million tokens (input, output, cache read, cache write). Estimates for
// the spend display and daily cap; check current pricing on anthropic.com.
export const PRICING = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
  'claude-fable-5-1': [10, 50, 0.25, 12.5],
};

export function chatConfig(cfg) {
  const env = cfg.chat || {};
  const backend = env.backend || (cfg.secrets.ANTHROPIC_API_KEY ? 'anthropic' : 'disabled');
  return {
    backend,
    model: env.model || cfg.anthropicModel || 'claude-opus-5-5',
    effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(env.effort) ? env.effort : 'high',
    dailyBudgetUsd: Number.isFinite(env.dailyBudgetUsd) ? env.dailyBudgetUsd : 5,
    maxToolRounds: Number.isFinite(env.maxToolRounds) ? Math.min(Math.max(env.maxToolRounds, 2), 15) : 8,
  };
}

export function estimateCost(model, usage) {
  const p = PRICING[model];
  if (!p || !usage) return null;
  const inTok = usage.input_tokens || 0, outTok = usage.output_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0, cw = usage.cache_creation_input_tokens || 0;
  return (inTok * p[0] + outTok * p[1] + cr * p[2] + cw * p[3]) / 1e6;
}

export function spentToday(db) {
  return db.prepare('SELECT COALESCE(SUM(cost_usd), 0) s FROM chat_usage WHERE day = ?').get(todayIn(NY)).s;
}

export function recordUsage(db, model, usage) {
  const cost = estimateCost(model, usage);
  db.prepare('INSERT INTO chat_usage (at, day, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd) VALUES (?,?,?,?,?,?,?,?)')
    .run(nowIso(), todayIn(NY), model, usage?.input_tokens || 0, usage?.output_tokens || 0, usage?.cache_read_input_tokens || 0, usage?.cache_creation_input_tokens || 0, cost ?? 0);
  return cost;
}

export class BackendError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
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
    clientPromise ||= import('@anthropic-ai/sdk').then(({ default: Anthropic }) => ({
      Anthropic, c: new Anthropic({ apiKey: cfg.secrets.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 180000 }),
    }));
    return clientPromise;
  };
  return {
    name: 'anthropic', available: true, model: cc.model, config: cc,
    // Returns an Anthropic Messages API response object.
    async create({ system, tools, messages }) {
      const { Anthropic, c } = await client();
      try {
        return await c.beta.messages.create({
          model: cc.model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          cache_control: { type: 'ephemeral' },
          output_config: { effort: cc.effort },
          system,
          tools,
          tool_choice: { type: 'auto' },
          messages,
        });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new BackendError('auth', 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.');
        if (e instanceof Anthropic.PermissionDeniedError) throw new BackendError('auth', 'The Anthropic API key does not have access to this model.');
        if (e instanceof Anthropic.RateLimitError) throw new BackendError('rate_limit', 'Anthropic rate limit reached. Try again in a minute.');
        if (e instanceof Anthropic.BadRequestError) throw new BackendError('bad_request', redact(`The model request was rejected: ${e.message}`, cfg));
        if (e instanceof Anthropic.APIConnectionError) throw new BackendError('network', 'Could not reach the Anthropic API. Check the internet connection.');
        if (e instanceof Anthropic.APIError) throw new BackendError('server', `Anthropic API error ${e.status}. Try again shortly.`);
        throw new BackendError('unknown', redact(e.message || String(e), cfg));
      }
    },
  };
}
