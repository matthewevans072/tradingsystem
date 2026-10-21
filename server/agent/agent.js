// Ask Signal Desk: conversation storage and the tool-use loop.
//
// Each question runs a fresh, append-only exchange with the model:
//   [earlier questions + short answers as plain text] + [current question with
//   time/page/scenario context] -> tool calls -> tool results -> submit_answer.
// Earlier turns are passed only as text, so every answer is grounded in data
// fetched for *this* question rather than conversational memory.
import { nowIso } from '../db.js';
import { sessionAt } from '../calendar.js';
import { formatNy } from '../time.js';
import { log } from '../log.js';
import { computePortfolio } from '../portfolio.js';
import { Ledger } from './ledger.js';
import { createToolbox, runTool, toolsForApi, ANSWER_CATEGORIES } from './tools.js';
import { SYSTEM_PROMPT, turnHeader } from './prompt.js';
import { recordUsage, budgetCheck, BackendError, usableContent } from './backend.js';
import { listProposals, checkUserIntent } from './proposals.js';

const MAX_RESULT_CHARS = 24000;
const PRIOR_TURNS = 6;

// ---------- conversation storage ----------

export function createConversation(db, title) {
  const t = nowIso();
  const r = db.prepare('INSERT INTO chat_conversations (title, created_at, updated_at) VALUES (?,?,?)').run(String(title || 'New conversation').slice(0, 120), t, t);
  return Number(r.lastInsertRowid);
}

export function listConversations(db) {
  return db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS questions
                     FROM chat_conversations c ORDER BY c.updated_at DESC LIMIT 100`).all();
}

export function getConversation(db, id) {
  const c = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id);
  if (!c) return null;
  const messages = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id').all(id).map(messageOut);
  return { ...c, messages, proposals: listProposals(db, id) };
}

export function deleteConversation(db, id) {
  db.prepare('DELETE FROM chat_proposals WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(id);
  return db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id).changes > 0;
}

// One question at a time per conversation (a second tab or a double submit
// would otherwise interleave two tool loops on the same history).
export function isConversationBusy(ctx, id) {
  return !!ctx.chatBusy?.has(Number(id));
}

function messageOut(m) {
  return {
    id: m.id, role: m.role, text: m.text, status: m.status, error: m.error, model: m.model, createdAt: m.created_at,
    answer: m.answer_json ? JSON.parse(m.answer_json) : null,
    ledger: m.ledger_json ? JSON.parse(m.ledger_json) : [],
    tools: m.tools_json ? JSON.parse(m.tools_json) : [],
    scenarios: m.scenarios_json ? JSON.parse(m.scenarios_json) : [],
    pageContext: m.page_context_json ? JSON.parse(m.page_context_json) : null,
    usage: m.usage_json ? JSON.parse(m.usage_json) : null,
  };
}

// ---------- output guards ----------
// Signal Desk cannot trade and the agent cannot save changes, so a sentence
// claiming either is always wrong. Matching runs per sentence on a copy with
// straight quotes (same length, so positions line up). Exempt: negations and
// modals on the verb itself ("I have not placed", "I can't sell"), quoted
// examples, hypotheticals introduced earlier in the sentence ("If we sold…",
// "In scenario S2…"), and work products ("I've updated the scenario").

const REMOVED = '[Removed: a statement claiming a trade or record change. Signal Desk cannot trade, and record changes only happen when you press Confirm.]';
const TRADE_VERBS = 'bought|sold|purchased|placed|executed|submitted|filled|cancell?ed|traded|liquidated|trimmed|exited|shorted|rebalanced|transferred|converted|closed out';
const RECORD_VERBS = 'saved|recorded|updated|changed|applied|set up|added|removed|deleted|entered|logged|modified|adjusted|created|edited';
const AUX = "have|has|had|just|already|now|also|then|successfully|actually|indeed|went ahead and|gone ahead and|did|not|never|cannot|can't|didn't|haven't|hasn't|hadn't|will|won't|would|could|should|can|might|may|shall|must|am|been";
const ACTOR_RE = new RegExp(`\\b(I|we|Signal Desk|the app)\\b((?:\\s*'(?:ve|d|ll|m)\\b|\\s+(?:${AUX})\\b)*)\\s+(${TRADE_VERBS}|${RECORD_VERBS})\\b`, 'gi');
const PASSIVE_RE = new RegExp(`\\b(?:(no|none of the|your|the|this|that|these|those|an?|my|all|both)\\s+)?(?:[\\w$.,%-]+\\s+){0,3}?(orders?|trades?|sales?|purchases?|transactions?|records?|holdings|portfolio|cash(?: balances?)?|alerts?|positions?|shares)\\s+((?:(?:has|have|had|been|was|were|is|are|now|already|successfully|just|also|not|never|got|be|will|would|could|being|hasn't|haven't|wasn't|weren't|isn't|aren't)\\s+)+)(placed|executed|filled|submitted|sent|completed|processed|cancell?ed|sold|bought|purchased|liquidated|trimmed|closed|reduced|exited|updated|changed|saved|recorded|set|adjusted|modified|added|removed|deleted|logged|created)\\b`, 'gi');
const LEAD_RE = /^\W*(?:(?:done|ok|okay|all set|great|sure|confirmed|success|perfect)\b\W*)?(?:(?:just|successfully|already|now)\s+)?(sold|bought|purchased|placed|executed|submitted|liquidated|trimmed|shorted)\b/i;
const ORDER_DONE_RE = /^\W*(?:(?:done|ok|okay|all set|great|confirmed)\b\W*)?(?:(?:your|the)\s+)?(?:(?:sell|buy|limit|market|stop)\s+)?(?:order|trade)s?\s+(?:(?:is|was|has been)\s+)?(placed|executed|filled|submitted|sent|completed|in)\b/i;
const BEHALF_RE = /\b(sold|bought|purchased|placed|executed|submitted|liquidated|trimmed)\b[^.!?\n]{0,60}?\b(for you|on your behalf)\b/gi;

const NEG_MODAL = /\b(not|never|cannot|can't|didn't|haven't|hasn't|hadn't|won't|will|would|could|should|can|might|may|shall|must|am)\b|'(ll|d|m)\b/i;
const NEG_BEFORE = /\b(no|not|never|cannot|can't|didn't|don't|doesn't|won't|unable to|without)\b[^.!?\n]{0,25}$/i;
const HYPO = /\b(if|suppose|supposing|assuming|assume|hypothetical(?:ly)?|scenarios?|were to|what if|imagine|for example|for instance|example)\b|\bS\d+\b/i;
const PERFECT = /\b(has|have)\s+(?:\w+\s+)?been\b|\b(now|just|successfully|already)\b/i;
const TRADE_PREDICATES = /^(placed|executed|filled|submitted|sent|processed|cancell?ed)$/i;
const DATED = /\b(\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|yesterday|last (?:week|month|year)|earlier|previously)\b|\bby you\b|\byou\s+(?:entered|recorded|added|updated|saved|changed|set)\b/i;
const WORK_PRODUCT = /^\s*(?:\S+\s+){0,5}?(scenarios?|simulations?|calculations?|estimates?|analysis|comparison|figures|numbers|proposals?|proposed|pending|draft|suggest\w*|hypothetical|answer|assumptions?|breakdown|table|chart|context|details|summary|caveats?|question|benchmarks?|bucket|group|category|perspective|my (?:view|assessment|answer|estimate|take|opinion|recommendation))\b/i;

function quotedRanges(s) {
  const out = [];
  for (const re of [/"[^"\n]{1,300}"/g, /(?:^|[\s(])'([^'\n]{3,300})'(?=[\s.,;:!?)]|$)/g]) {
    let m;
    while ((m = re.exec(s))) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

function sentenceSpans(text) {
  const spans = [];
  const re = /[.!?]+(?=\s|$)|\n/g;
  let start = 0, m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    spans.push([start, end]);
    start = end;
  }
  if (start < text.length) spans.push([start, text.length]);
  return spans;
}

function sentenceClaims(s) {
  const quotes = quotedRanges(s);
  const quoted = (i) => quotes.some(([a, b]) => i >= a && i < b);
  const hypoBefore = (i) => HYPO.test(s.slice(0, i));
  let m;
  ACTOR_RE.lastIndex = 0;
  while ((m = ACTOR_RE.exec(s))) {
    const [, subject, aux, verb] = m;
    const verbEnd = m.index + m[0].length;
    if (quoted(m.index) || hypoBefore(m.index) || NEG_MODAL.test(aux)) continue;
    if (/^(signal desk|the app)$/i.test(subject) && !new RegExp(`^(${TRADE_VERBS})$`, 'i').test(verb)) continue;
    if (WORK_PRODUCT.test(s.slice(verbEnd, verbEnd + 80))) continue;
    return true;
  }
  PASSIVE_RE.lastIndex = 0;
  while ((m = PASSIVE_RE.exec(s))) {
    const [, det, noun, aux, pred] = m;
    if (quoted(m.index) || hypoBefore(m.index) || /^(no|none)/i.test(det || '') || NEG_MODAL.test(aux) || /n't\b/.test(aux)) continue;
    if (DATED.test(s)) continue;
    if (PERFECT.test(aux)) return true;
    if (TRADE_PREDICATES.test(pred) && /^(orders?|trades?|sales?|purchases?|transactions?)$/i.test(noun)) return true;
  }
  if ((LEAD_RE.test(s) && !DATED.test(s)) || ORDER_DONE_RE.test(s)) return !quoted(s.search(/\S/));
  BEHALF_RE.lastIndex = 0;
  while ((m = BEHALF_RE.exec(s))) {
    if (quoted(m.index) || hypoBefore(m.index) || NEG_BEFORE.test(s.slice(0, m.index))) continue;
    return true;
  }
  return false;
}

export function guardText(text) {
  if (text == null || text === '') return { text, flagged: false };
  const original = String(text);
  const norm = original.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
  let out = '', last = 0, flagged = false;
  for (const [a, b] of sentenceSpans(norm)) {
    if (!sentenceClaims(norm.slice(a, b))) continue;
    flagged = true;
    const lead = original.slice(a, b).match(/^\s*/)[0];
    const tail = original.slice(a, b).endsWith('\n') ? '\n' : '';
    out += original.slice(last, a) + lead + REMOVED + tail;
    last = b;
  }
  return { text: flagged ? out + original.slice(last) : original, flagged };
}

// Follow-up suggestions are sent as the user's own words when clicked, so one
// phrased as an instruction ("Record that I sold 10 VRT at 98") would satisfy
// the proposal intent check without the user having said it. Drop those.
const ACTION_START = /^\W*(?:please\s+)?(?:record|log|add|set|update|change|remove|delete|save|enter|create|put|mark|note|sell|buy|trim|purchase|short|place|execute|exit|liquidate|confirm|apply|cancel)\b|\b(?:for me|on my behalf)\b/i;
export function unsafeFollowUp(text) {
  const f = String(text || '');
  if (ACTION_START.test(f)) return true;
  return ['add_transaction', 'set_cash', 'add_price_alert', 'update_alert_threshold', 'set_strategy']
    .some((changeType) => checkUserIntent(f, f, { changeType, details: {} }) === null);
}

const MUST_CITE = ['portfolio_record', 'external_fact', 'reported_claim', 'calculation'];
const isReported = (item) => !!item && ((item.kind === 'news' && item.note !== 'confirmed') || item.kind === 'archived_report');
const isStaleMarket = (item) => !!item && item.kind === 'market_data' && ['stale', 'unknown', 'missing'].includes(item.freshness);

export function validateAnswer(raw, ledger) {
  const issues = [];
  const notes = [];
  const str = (x) => (x == null ? null : String(x).trim() || null);
  let executionClaim = false;
  const guard = (t) => {
    const g = guardText(t);
    if (g.flagged) executionClaim = true;
    return g.text;
  };
  const a = {
    short_answer: guard(String(raw?.short_answer || '').trim()),
    details: [],
    horizon: str(raw?.horizon) && guard(str(raw.horizon)),
    what_would_change_it: str(raw?.what_would_change_it) && guard(str(raw.what_would_change_it)),
    alternatives: (Array.isArray(raw?.alternatives) ? raw.alternatives : []).slice(0, 5).filter((x) => x && typeof x === 'object')
      .map((alt) => ({ option: guard(String(alt.option || '')), case_for: guard(String(alt.case_for || '')), case_against: guard(String(alt.case_against || '')) })),
    affected_symbols: (Array.isArray(raw?.affected_symbols) ? raw.affected_symbols : []).map((s) => String(s).toUpperCase().slice(0, 15)).slice(0, 20),
    follow_up_questions: [],
    confidence: ['low', 'moderate', 'high', 'not_applicable'].includes(raw?.confidence) ? raw.confidence : 'not_applicable',
  };
  for (const f of (Array.isArray(raw?.follow_up_questions) ? raw.follow_up_questions : []).slice(0, 3).map((x) => String(x).slice(0, 200))) {
    if (guardText(f).flagged || unsafeFollowUp(f)) { notes.push('A suggested follow-up phrased as an instruction was dropped.'); continue; }
    a.follow_up_questions.push(f);
  }
  const staleCited = new Map();
  for (const d of (Array.isArray(raw?.details) ? raw.details : []).slice(0, 25)) {
    if (!d || typeof d !== 'object') continue;
    let category = ANSWER_CATEGORIES.includes(d.category) ? d.category : 'interpretation';
    const refs = (Array.isArray(d.refs) ? d.refs : []).map(String).filter((r) => {
      if (ledger.has(r)) return true;
      issues.push(`Unknown reference ${r} removed`);
      return false;
    });
    const out = { category, text: guard(String(d.text || '')), refs };
    // A media report or an archived briefing is not a verified fact.
    if (category === 'external_fact' && refs.length && refs.every((r) => isReported(ledger.get(r)))) {
      out.category = category = 'reported_claim';
      out.relabelled = 'external_fact';
      notes.push(`A point citing only media reports or archived briefings was relabelled "reported" (${refs.join(', ')}).`);
    }
    if (MUST_CITE.includes(category) && !refs.length) out.uncited = true;
    for (const r of refs) if (isStaleMarket(ledger.get(r))) staleCited.set(r, ledger.get(r));
    a.details.push(out);
  }
  // Stale or undated market data that the answer relies on gets an explicit gap note.
  for (const [ref, item] of staleCited) {
    if (a.details.some((d) => d.category === 'data_gap' && d.refs.includes(ref))) continue;
    a.details.push({ category: 'data_gap', refs: [ref], auto: true, text: `Possibly out of date: ${item.label} is ${item.freshness === 'stale' ? 'stale' : 'missing a reliable timestamp'}${item.asOf ? ` (as of ${formatNy(item.asOf)})` : ''}.` });
  }
  if (executionClaim) issues.push('A statement claiming a trade or record change was removed.');
  const uncited = a.details.filter((d) => d.uncited).length;
  if (uncited) issues.push(`${uncited} factual point(s) had no supporting reference and are marked uncited.`);
  if (!a.short_answer) issues.push('The model returned no short answer.');
  return { answer: { ...a, executionClaimRemoved: executionClaim, notes }, issues };
}

// ---------- tool results ----------

// Fit a tool result into the size limit by shortening its longest lists (and
// then long strings) while keeping valid JSON, refs on the items kept, and a
// note of what was cut. Chronological lists keep their newest end.
export function fitResult(result, max = MAX_RESULT_CHARS) {
  let s = JSON.stringify(result ?? null);
  if (s.length <= max) return s;
  const copy = JSON.parse(s);
  const cuts = new Map();
  const ascending = (arr) => {
    const k = ['date', 'ts', 'tradeDate', 'trade_date'].find((x) => arr[0]?.[x] && arr.at(-1)?.[x]);
    return k ? String(arr[0][k]) < String(arr.at(-1)[k]) : false;
  };
  for (let pass = 0; pass < 40 && s.length > max; pass++) {
    let best = null;
    const walk = (node, path) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        if (node.length > 1) {
          const len = JSON.stringify(node).length;
          if (!best || len > best.len) best = { node, path, len };
        }
        node.forEach((x, i) => walk(x, `${path}[${i}]`));
        return;
      }
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    };
    walk(copy, '');
    if (!best) break;
    const arr = best.node;
    const keep = Math.max(1, Math.floor(arr.length / 2));
    if (!cuts.has(best.path)) cuts.set(best.path, { list: best.path.replace(/\[\d+\]/g, '[]') || 'result', total: arr.length });
    const kept = ascending(arr) ? arr.slice(-keep) : arr.slice(0, keep);
    arr.length = 0;
    arr.push(...kept);
    cuts.get(best.path).kept = keep;
    s = JSON.stringify(copy);
  }
  if (s.length > max) {
    const clip = (node) => {
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string' && v.length > 300) node[k] = `${v.slice(0, 300)}…`;
        else clip(v);
      }
    };
    clip(copy);
  }
  const note = `Result shortened to fit (${[...cuts.values()].map((c) => `${c.list}: ${c.kept} of ${c.total} kept`).join('; ') || 'long text clipped'}). Ask a narrower question for the rest.`;
  const wrapped = copy && typeof copy === 'object' && !Array.isArray(copy) ? { truncated: note, ...copy } : { truncated: note, items: copy };
  s = JSON.stringify(wrapped);
  return s.length <= max ? s : JSON.stringify({ truncated: 'Result too large to return. Ask a narrower question (one ticker, a shorter window).', ref: result?.ref ?? null });
}

// ---------- the turn ----------

function priorMessages(db, conversationId) {
  const rows = db.prepare(`SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`).all(conversationId, PRIOR_TURNS * 2).reverse();
  const msgs = [];
  for (const r of rows) {
    if (r.role === 'user') msgs.push({ role: 'user', content: r.text });
    else if (r.status !== 'unavailable') {
      const a = r.answer_json ? JSON.parse(r.answer_json) : null;
      const text = a ? [a.short_answer, ...a.details.slice(0, 8).map((d) => `(${d.category}) ${d.text}`)].join('\n') : (r.error ? `[Previous answer failed: ${r.error}]` : '');
      msgs.push({ role: 'assistant', content: `${text}\n[Earlier answer from ${r.created_at}; data in it may be outdated.]` });
    }
  }
  // The API needs strictly alternating roles starting with user.
  const merged = [];
  for (const m of msgs) {
    if (merged.length && merged.at(-1).role === m.role) merged.at(-1).content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  if (merged.length && merged.at(-1).role === 'user') merged.pop(); // unanswered question
  return merged;
}

function priorScenarios(db, conversationId) {
  return db.prepare("SELECT scenarios_json FROM chat_messages WHERE conversation_id = ? AND role = 'assistant' AND scenarios_json IS NOT NULL ORDER BY id")
    .all(conversationId).flatMap((r) => JSON.parse(r.scenarios_json));
}

export async function runChatTurn(ctx, { conversationId, userText, pageContext = null, backend, onEvent = () => {}, now = new Date(), signal = null }) {
  const conv = ctx.db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(conversationId);
  if (!conv) throw new Error('Conversation not found');
  const question = String(userText || '').trim().slice(0, 4000);
  if (!question) throw new Error('Ask a question');
  ctx.chatBusy ||= new Set();
  if (ctx.chatBusy.has(conversationId)) throw new Error('This conversation is still answering the previous question.');
  ctx.chatBusy.add(conversationId);
  try {
    return await answerQuestion(ctx, { conv, conversationId, question, pageContext, backend, onEvent, now, signal });
  } finally {
    ctx.chatBusy.delete(conversationId);
  }
}

const ABORTED = 'Stopped: the browser disconnected before the answer was finished.';

async function answerQuestion(ctx, { conv, conversationId, question, pageContext, backend, onEvent, now, signal }) {
  const db = ctx.db;
  const prior = priorMessages(db, conversationId);
  const scenariosBefore = priorScenarios(db, conversationId);
  db.prepare('INSERT INTO chat_messages (conversation_id, role, text, page_context_json, created_at) VALUES (?,?,?,?,?)')
    .run(conversationId, 'user', question, pageContext ? JSON.stringify(pageContext) : null, nowIso());
  if (prior.length === 0 && conv.title === 'New conversation') db.prepare('UPDATE chat_conversations SET title = ? WHERE id = ?').run(question.slice(0, 80), conversationId);
  db.prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run(nowIso(), conversationId);

  const save = (fields) => {
    const r = db.prepare(`INSERT INTO chat_messages (conversation_id, role, text, answer_json, ledger_json, tools_json, scenarios_json, status, error, model, usage_json, created_at)
                          VALUES (?, 'assistant', ?,?,?,?,?,?,?,?,?,?)`).run(conversationId, fields.text ?? null, fields.answer ? JSON.stringify(fields.answer) : null,
      JSON.stringify(fields.ledger || []), JSON.stringify(fields.tools || []), fields.scenarios?.length ? JSON.stringify(fields.scenarios) : null,
      fields.status, fields.error ?? null, fields.model ?? null, fields.usage ? JSON.stringify(fields.usage) : null, nowIso());
    const id = Number(r.lastInsertRowid);
    if (fields.proposals?.length) db.prepare(`UPDATE chat_proposals SET message_id = ? WHERE id IN (${fields.proposals.map(() => '?').join(',')})`).run(id, ...fields.proposals);
    return messageOut(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id));
  };

  if (!backend?.available) {
    return save({ status: 'unavailable', error: backend?.reason || 'No model backend configured', text: null });
  }
  const cc = backend.config || {};
  const firstCheck = budgetCheck(ctx.cfg, cc, now);
  if (!firstCheck.ok) return save({ status: 'unavailable', error: firstCheck.reason });

  const ledger = new Ledger();
  const turn = { conversationId, userText: question, now, scenarios: [], priorScenarioCount: scenariosBefore.length, proposals: [] };
  const handlers = createToolbox(ctx, { ledger, turn });
  const tools = toolsForApi();
  const header = turnHeader({ now: formatNy(now.toISOString()), session: sessionAt(now).session, pageContext, scenarios: scenariosBefore, workspace: ctx.mode });
  const messages = [...prior, { role: 'user', content: `${header}\n\nQuestion: ${question}` }];
  const toolLog = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0, calls: 0, unpriced: false, models: [] };
  const maxRounds = cc.maxToolRounds ?? 8;
  const servedBy = () => usage.models.join(', ') || backend.model;
  let final = null;
  let unstructured = null;
  let nudged = false;
  let stopNote = null;

  try {
    for (let round = 0; round <= maxRounds; round++) {
      if (signal?.aborted) throw new BackendError('aborted', ABORTED);
      if (round > 0) {
        const b = budgetCheck(ctx.cfg, cc, now);
        if (!b.ok) { stopNote = `Stopped before finishing: ${b.reason}`; break; }
      }
      onEvent({ type: 'thinking', round });
      const resp = await backend.create({ system: SYSTEM_PROMPT, tools, messages, signal });
      usage.calls += 1;
      const rec = recordUsage(ctx, resp, backend.model, cc.priceOverride);
      for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) usage[k] += rec.tokens[k] || 0;
      usage.cost_usd += rec.cost || 0;
      if (rec.unpriced) usage.unpriced = true;
      for (const m of rec.models) if (m && !usage.models.includes(m)) usage.models.push(m);
      if (resp.stop_reason === 'refusal') throw new BackendError('refusal', 'The model declined to answer this question.');
      if (resp.stop_reason === 'max_tokens') throw new BackendError('truncated', 'The model response was cut off before finishing.');
      const content = usableContent(resp.content);
      messages.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(no content)' }] });
      const calls = content.filter((b) => b.type === 'tool_use');
      const submits = calls.filter((b) => b.name === 'submit_answer');
      if (submits.length === 1 && calls.length === 1) { final = submits[0].input; break; }
      if (!calls.length) {
        // A plain-text reply: ask once for the structured answer, which carries the sources.
        if (!nudged && round < maxRounds) {
          nudged = true;
          messages.push({ role: 'user', content: 'Please deliver that answer by calling submit_answer, citing the reference ids from the tool results.' });
          continue;
        }
        unstructured = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        break;
      }
      if (round === maxRounds) break;
      const results = [];
      for (const call of calls) {
        if (call.name === 'submit_answer') {
          results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'submit_answer must be called on its own, after you have read the results of your other tool calls. Call it again by itself.' });
          continue;
        }
        if (signal?.aborted) throw new BackendError('aborted', ABORTED);
        onEvent({ type: 'tool_start', tool: call.name, input: call.input });
        const r = await runTool(handlers, call.name, call.input);
        toolLog.push({ tool: call.name, input: call.input, ok: r.ok, ms: r.ms, error: r.ok ? null : r.error });
        onEvent({ type: 'tool_end', tool: call.name, ok: r.ok, error: r.ok ? null : r.error, ms: r.ms });
        results.push({ type: 'tool_result', tool_use_id: call.id, content: r.ok ? fitResult(r.result) : `Error: ${r.error}`, ...(r.ok ? {} : { is_error: true }) });
      }
      // All tool results go back in one user message.
      if (round === maxRounds - 1) results.push({ type: 'text', text: 'Tool budget nearly used: call submit_answer now with what you have, noting any gaps.' });
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    log.warn('chat', `turn failed: ${e.message}`);
    const error = signal?.aborted ? ABORTED : e instanceof BackendError ? e.message : `Something went wrong: ${e.message}`;
    return save({ status: 'error', error, ledger: ledger.toJSON(), tools: toolLog, scenarios: turn.scenarios, model: servedBy(), usage: usageOut(usage), proposals: turn.proposals });
  }

  let answer, issues;
  try {
    if (final) ({ answer, issues } = validateAnswer(final, ledger));
    else if (unstructured) {
      ({ answer, issues } = validateAnswer({ short_answer: unstructured.slice(0, 1500), details: [] }, ledger));
      issues.push('The model answered without the structured format, so sources could not be attached.');
    } else {
      answer = null;
      issues = [stopNote || 'The model used its full tool budget without answering.'];
    }
    // Only tickers actually held get a link to their position.
    if (answer) {
      const held = new Set(computePortfolio(db, { now, catalog: ctx.catalog }).positions.map((p) => p.symbol));
      answer.held_symbols = answer.affected_symbols.filter((s) => held.has(s));
    }
  } catch (e) {
    log.warn('chat', `answer check failed: ${e.message}`);
    answer = null;
    issues = ['The answer could not be checked, so it is not shown. Try asking again.'];
  }
  if (answer && stopNote) issues.push(stopNote);
  const failedTools = toolLog.filter((t) => !t.ok);
  const status = !answer ? 'error' : issues.length || failedTools.length ? 'partial' : 'ok';
  return save({
    status, text: answer?.short_answer || null,
    answer: answer ? { ...answer, issues, failedTools: failedTools.map((t) => ({ tool: t.tool, error: t.error })) } : null,
    error: answer ? null : issues.join(' '),
    ledger: ledger.toJSON(), tools: toolLog, scenarios: turn.scenarios, model: servedBy(),
    usage: usageOut(usage),
    proposals: turn.proposals,
  });
}

function usageOut(u) {
  return { ...u, cost_usd: Math.round(u.cost_usd * 10000) / 10000, estimated: !u.unpriced };
}
