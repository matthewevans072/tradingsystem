// The AI planner (approach B; CAMPAIGN-1.md section 5). One call per stock and session, batching the session's items
// eligible by T (at most 20, in time order), with one frozen model, prompt, settings and output schema
// (strategy/news-replay/ai-planner-v1.json), no tools or browsing; news is fenced as untrusted data. The answer is
// validated (every fact cites packet ids; no date after T; no later year; no later-event term before it existed); a
// rejected plan becomes no-trade and is logged. Responses are cached by (packet hash, variant, model, prompt hash), so a
// replay re-runs from the cache with no new call. The identity-masked variant replaces company names, tickers and dates
// with placeholders and shifts dates by a fixed offset. Every AI result is labelled "AI planner, possible model-memory
// contamination". No call is made without an API key and the owner's spending cap; the cost is estimated first.
import fs from 'node:fs';
import { AI_PROMPT_PATH, hashOf, sha256, NrError } from './config.js';
import * as store from './store.js';
import { typicalMoveOf, referenceOf, WINDOW_MS } from './planner.js';
import { nextTradingDay } from '../calendar.js';

export const loadAiSpec = (file = AI_PROMPT_PATH) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const promptSha = (spec) => sha256(JSON.stringify({ model: spec.model, effort: spec.effort, system: spec.system, schema: spec.schema, menu: spec.menu, mask: spec.mask }));
const iso = (ms) => new Date(ms).toISOString();
const DAY = 86400000;

export function maskPacket(packet, spec) {
  const off = spec.mask.dateOffsetDays * DAY;
  const names = [];
  const letters = 'ABCDEFGHIJ';
  const tickers = Object.keys(spec.mask.companyNames);
  tickers.forEach((t, i) => { names.push([new RegExp(`\\b${t}\\b`, 'g'), `${spec.mask.tickerPlaceholder}_${letters[i]}`]); for (const a of spec.mask.tickers[t] || []) names.push([new RegExp(`\\b${a}\\b`, 'g'), `${spec.mask.tickerPlaceholder}_${letters[i]}`]); for (const n of spec.mask.companyNames[t]) names.push([new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), `${spec.mask.companyPlaceholder}_${letters[i]}`]); });
  const shiftDates = (s) => String(s).replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, (d) => new Date(Date.parse(`${d}T12:00:00Z`) + off).toISOString().slice(0, 10)).replace(/\b(20[12]\d)\b/g, (y) => String(Number(y) + Math.round(spec.mask.dateOffsetDays / 365.25)));
  const text = (s) => { if (s == null) return s; let t = String(s); for (const [re, r] of names) t = t.replace(re, r); return shiftDates(t); };
  return {
    asOf: packet.asOf + off, session: shiftDates(packet.session), stock: text(packet.stock), masked: true,
    items: packet.items.map((i) => ({ ...i, publishedMs: i.publishedMs + off, eligibleMs: i.eligibleMs + off, occurred: i.occurred ? shiftDates(i.occurred) : null, headline: text(i.headline), summary: text(i.summary) })),
    context: packet.context.map((c) => ({ ...c, publishedMs: c.publishedMs + off, eligibleMs: c.eligibleMs + off, headline: text(c.headline) })),
    prices: { ...packet.prices, daily: packet.prices.daily.map((r) => ({ date: shiftDates(r.date), c: r.c })), bars: packet.prices.bars.map((b) => ({ ...b, s: b.s + off, e: b.e + off })) },
    earlierPlans: packet.earlierPlans.map((p) => ({ ...p, T: p.T + off, session: shiftDates(p.session) })),
  };
}

export function buildRequest(packet, spec) {
  const fence = (t) => (t == null ? null : `<untrusted_item>${String(t).replace(/<\/?untrusted_item>/g, '')}</untrusted_item>`);
  const body = {
    simulated_time_T: iso(packet.asOf), session: packet.session, stock: packet.stock,
    items: packet.items.slice(0, spec.maxItems).map((i) => ({ id: i.id, kind: i.kind, published: iso(i.publishedMs), eligible: iso(i.eligibleMs), possibly_revised: i.revised, headline: fence(i.headline), summary: fence(i.summary) })),
    context: packet.context.map((c) => ({ id: c.id, kind: c.kind, published: iso(c.publishedMs), headline: fence(c.headline) })),
    daily_closes: packet.prices.daily.map((r) => [r.date, Math.round(r.c * 10000) / 10000]),
    bars_5min_up_to_T: packet.prices.bars.map((b) => [iso(b.e), b.o, b.h, b.l, b.c, b.v]),
    earlier_plans: packet.earlierPlans,
  };
  return { model: spec.model, max_tokens: spec.max_tokens, system: spec.system, messages: [{ role: 'user', content: JSON.stringify(body) }], output_config: { effort: spec.effort, format: { type: 'json_schema', schema: spec.schema } } };
}

// The validator: { ok, problems }. A plan that fails becomes no-trade (logged).
export function validateAiPlan(plan, packet, spec) {
  const problems = [];
  const ids = new Set([...packet.items.map((i) => i.id), ...packet.context.map((c) => c.id)]);
  if (!plan || typeof plan !== 'object') return { ok: false, problems: ['no JSON object'] };
  if (!['plan', 'no_trade'].includes(plan.stance)) problems.push('stance must be plan or no_trade');
  for (const f of plan.facts || []) {
    if (!Array.isArray(f.source_ids) || !f.source_ids.length) problems.push(`a fact cites no source id: ${String(f.text).slice(0, 60)}`);
    else for (const s of f.source_ids) if (!ids.has(s)) problems.push(`a fact cites ${s}, which is not in the packet`);
  }
  const menu = spec.menu;
  if (plan.stance === 'plan') {
    if (!menu.activationM.includes(plan.bullish_activation_m) || !menu.activationM.includes(plan.bearish_activation_m)) problems.push('an activation multiple is off the menu');
    if (!menu.invalidationM.includes(plan.invalidation_m)) problems.push('the invalidation multiple is off the menu');
    if (!Number.isInteger(plan.holding_sessions) || plan.holding_sessions < menu.holdingSessions.min || plan.holding_sessions > menu.holdingSessions.max) problems.push('the holding period is off the menu');
  }
  const asOfDate = packet.session;
  const year = Number(asOfDate.slice(0, 4));
  const all = JSON.stringify(plan).toLowerCase();
  for (const m of all.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) if (m[0] > asOfDate) problems.push(`mentions the date ${m[0]}, after T`);
  for (const m of all.matchAll(/\b(20\d{2})\b/g)) if (Number(m[1]) > year) problems.push(`mentions the year ${m[1]}, after T`);
  const packetText = JSON.stringify(packet.items.map((i) => [i.headline, i.summary])).toLowerCase();
  for (const t of spec.laterEventTerms) {
    if (!all.includes(t.term)) continue;
    if (t.firstKnown ? asOfDate < t.firstKnown : !packetText.includes(t.term)) problems.push(`names a later event ("${t.term}")`);
  }
  return { ok: problems.length === 0, problems };
}

// A validated AI answer -> the same measurable plan shape as the deterministic planner's (CAMPAIGN-1.md section 5).
export function aiToPlan(ai, packet, { variant, problems = [] }) {
  const ref = referenceOf(packet), m = typicalMoveOf(packet.prices.daily);
  const base = { planner: variant, stock: packet.stock, session: packet.session, T: packet.asOf, label: 'AI planner, possible model-memory contamination', facts: ai?.facts ?? [], uncertainties: ai?.uncertainties ?? [], affected: { stock: packet.stock, why: ai?.affected_why ?? null }, contradiction: ai?.contradiction_rule ?? null, expirySession: nextTradingDay(nextTradingDay(packet.session, 'NYSE'), 'NYSE') };
  if (problems.length) return { ...base, status: 'no_trade', reason: 'rejected by the validator', problems };
  if (!ai || ai.stance === 'no_trade') return { ...base, status: 'no_trade', reason: 'the planner chose no trade' };
  if (!ref || m == null || !(m > 0)) return { ...base, status: 'no_trade', reason: 'no measurable levels' };
  return {
    ...base, status: 'armed', reference: ref, m, maxHoldingSessions: ai.holding_sessions, exit: { sessions: ai.holding_sessions },
    bullish: { armed: true, disarmedBy: [], activation: { type: 'close_at_or_above', level: ref.R + ai.bullish_activation_m * m, windowStartMs: packet.asOf, windowEndMs: packet.asOf + WINDOW_MS, barMinutes: 5 } },
    bearish: { action: ai.bearish_action === 'reduce' ? 'exit (reduce is executed as exit: one position per stock)' : ai.bearish_action, activation: { type: 'close_at_or_below', level: ref.R - ai.bearish_activation_m * m, windowStartMs: packet.asOf, windowEndMs: packet.asOf + WINDOW_MS, barMinutes: 5 } },
    invalidation: { level: ref.R - ai.invalidation_m * m, sizingReference: true }, noTrade: 'neither level reached within 30 minutes',
  };
}

// The cached planner: backend(request) -> { json, usage } is called only on a cache miss, and only when allowed.
export function createAiPlanner({ db, spec, backend = null, allowCalls = false, now = () => new Date().toISOString(), log = () => {} }) {
  const psha = promptSha(spec);
  let calls = 0, hits = 0;
  async function plan(packet, variant) {
    const sent = variant === 'AIM' ? maskPacket(packet, spec) : packet;
    const key = { packetHash: hashOf(sent), variant, model: spec.model, promptSha: psha };
    let cached = store.getAiCache(db, key);
    if (cached) hits++;
    else {
      if (!allowCalls || !backend) throw new NrError(409, 'an AI response is not cached and calls are not allowed (no API key or no spending cap): nothing was sent');
      const res = await backend(buildRequest(sent, spec));
      calls++;
      store.putAiCache(db, key, res.json ?? { refused: true, stopReason: res.stopReason ?? null }, res.usage ?? null, now());
      cached = { response: res.json ?? { refused: true }, usage: res.usage ?? null };
    }
    const ai = cached.response?.refused ? null : cached.response;
    const v = ai ? validateAiPlan(ai, sent, spec) : { ok: false, problems: ['the model refused or returned no JSON'] };
    if (!v.ok) log(`AI plan rejected for ${packet.stock} ${packet.session}: ${v.problems.join('; ')}`);
    return { plan: aiToPlan(ai, packet, { variant, problems: v.ok ? [] : v.problems }), packetHash: key.packetHash, cached: true };
  }
  return { plan, get calls() { return calls; }, get hits() { return hits; }, promptSha: psha };
}

// The estimate before any call: tokens from characters (about 3.5 characters per token for this JSON), the frozen
// output budget as an upper bound with a typical answer as the central case.
export function estimateCost(packets, spec, { variants = 2, typicalOutputTokens = 1200 } = {}) {
  const sys = Math.ceil(spec.system.length / 3.5) + Math.ceil(JSON.stringify(spec.schema).length / 3.5);
  let input = 0;
  for (const p of packets) input += sys + Math.ceil(JSON.stringify(buildRequest(p, spec).messages[0].content).length / 3.5);
  input *= variants;
  const calls = packets.length * variants;
  const price = spec.pricingUsdPerMillion;
  const central = (input * price.input + calls * typicalOutputTokens * price.output) / 1e6;
  const upper = (input * price.input + calls * spec.max_tokens * price.output) / 1e6;
  return { calls, inputTokens: input, outputTokensCentral: calls * typicalOutputTokens, outputTokensUpper: calls * spec.max_tokens, usdCentral: Math.round(central * 100) / 100, usdUpper: Math.round(upper * 100) / 100, model: spec.model, note: 'an estimate from characters, not a count_tokens measurement; thinking tokens are billed as output and are inside the output budget' };
}

// The real backend (used only with the owner's key and cap): one non-streaming Messages call, no tools, schema-bound JSON.
export async function createAnthropicBackend({ apiKey }) {
  if (!apiKey) throw new NrError(409, 'no ANTHROPIC_API_KEY in .env: the AI planner cannot run');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  return async (req) => {
    const r = await client.messages.create(req);
    if (r.stop_reason === 'refusal') return { json: null, stopReason: 'refusal', usage: r.usage };
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { json, stopReason: r.stop_reason, usage: r.usage };
  };
}
