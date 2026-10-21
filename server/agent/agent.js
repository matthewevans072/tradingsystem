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
import { Ledger } from './ledger.js';
import { createToolbox, runTool, toolsForApi } from './tools.js';
import { SYSTEM_PROMPT, turnHeader } from './prompt.js';
import { recordUsage, spentToday, estimateCost, BackendError } from './backend.js';
import { listProposals } from './proposals.js';

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

// Claims that a trade or record change happened. Signal Desk cannot trade and
// the agent cannot save changes, so such sentences are always wrong.
const EXECUTION_CLAIMS = [
  // "I sold…", "I've placed the order", "we executed…", "I updated your records"
  /\b(I|I've|I have|I just|we|we've|we have)\s+(have\s+|has\s+|just\s+|now\s+)?(bought|sold|purchased|placed|executed|submitted|filled|cancelled|canceled|traded|liquidated|trimmed|saved|recorded|updated|changed|applied|set up)\b[^.!?\n]*/gi,
  // "Signal Desk sold…", "the app placed…" (trade verbs only: "Signal Desk recorded a baseline" can be a true record)
  /\b(Signal Desk|the app)\s+(has\s+|just\s+)?(bought|sold|purchased|placed|executed|submitted|traded|liquidated)\b[^.!?\n]*/gi,
  // "Your order was filled", "the trade has been executed"
  /\b(your|the)\s+(order|trade)\s+(has been|was|is now|is)\s+(placed|executed|filled|submitted|completed|sent)\b[^.!?\n]*/gi,
  /\byour\s+(sale|purchase|record|records|holdings|portfolio|cash balance|alert)\s+(has been|have been|was|were|is now)\s+(placed|executed|filled|completed|updated|changed|saved|recorded|set)\b[^.!?\n]*/gi,
];

export function guardText(text) {
  if (!text) return { text, flagged: false };
  let flagged = false;
  let out = String(text);
  for (const re of EXECUTION_CLAIMS) {
    out = out.replace(re, (m) => {
      // Allow honest negations ("I have not placed any order") and proposals ("I have proposed…" is not matched).
      if (/\b(not|never|cannot|can't|didn't|did not|won't|no)\b/i.test(m.slice(0, 50))) return m;
      flagged = true;
      return '[removed: Signal Desk cannot place trades or save changes without your confirmation]';
    });
  }
  return { text: out, flagged };
}

export function validateAnswer(raw, ledger) {
  const issues = [];
  const a = {
    short_answer: String(raw?.short_answer || '').trim(),
    details: Array.isArray(raw?.details) ? raw.details : [],
    horizon: raw?.horizon || null,
    what_would_change_it: raw?.what_would_change_it || null,
    alternatives: Array.isArray(raw?.alternatives) ? raw.alternatives.slice(0, 5) : [],
    affected_symbols: Array.isArray(raw?.affected_symbols) ? raw.affected_symbols.map((s) => String(s).toUpperCase()).slice(0, 20) : [],
    follow_up_questions: Array.isArray(raw?.follow_up_questions) ? raw.follow_up_questions.slice(0, 3).map(String) : [],
    confidence: raw?.confidence || 'not_applicable',
  };
  const g = guardText(a.short_answer);
  a.short_answer = g.text;
  let executionClaim = g.flagged;
  a.details = a.details.slice(0, 25).map((d) => {
    const cat = ['portfolio_record', 'external_fact', 'calculation', 'interpretation', 'data_gap'].includes(d?.category) ? d.category : 'interpretation';
    const gt = guardText(String(d?.text || ''));
    if (gt.flagged) executionClaim = true;
    const refs = (Array.isArray(d?.refs) ? d.refs : []).map(String).filter((r) => {
      if (ledger.has(r)) return true;
      issues.push(`Unknown reference ${r} removed`);
      return false;
    });
    const out = { category: cat, text: gt.text, refs };
    if (['portfolio_record', 'external_fact', 'calculation'].includes(cat) && !refs.length) out.uncited = true;
    return out;
  });
  for (const alt of a.alternatives) {
    for (const k of ['option', 'case_for', 'case_against']) {
      const gt = guardText(String(alt?.[k] || ''));
      if (gt.flagged) executionClaim = true;
      alt[k] = gt.text;
    }
  }
  if (executionClaim) issues.push('A statement claiming a trade or record change was removed.');
  const uncited = a.details.filter((d) => d.uncited).length;
  if (uncited) issues.push(`${uncited} factual point(s) had no supporting reference and are marked uncited.`);
  if (!a.short_answer) issues.push('The model returned no short answer.');
  return { answer: { ...a, executionClaimRemoved: executionClaim }, issues };
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

function serialize(result) {
  let s = JSON.stringify(result);
  if (s.length > MAX_RESULT_CHARS) s = s.slice(0, MAX_RESULT_CHARS) + '…[truncated: ask a narrower question for more]';
  return s;
}

export async function runChatTurn(ctx, { conversationId, userText, pageContext = null, backend, onEvent = () => {}, now = new Date() }) {
  const db = ctx.db;
  const conv = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(conversationId);
  if (!conv) throw new Error('Conversation not found');
  const question = String(userText || '').trim().slice(0, 4000);
  if (!question) throw new Error('Ask a question');

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
  const budget = backend.config?.dailyBudgetUsd;
  if (budget != null && budget > 0 && spentToday(db) >= budget) {
    return save({ status: 'unavailable', error: `Today's Ask Signal Desk spending cap (US$${budget}) has been reached. Raise CHAT_DAILY_BUDGET_USD in .env or try tomorrow.` });
  }

  const ledger = new Ledger();
  const turn = { conversationId, userText: question, now, scenarios: [], priorScenarioCount: scenariosBefore.length, proposals: [] };
  const handlers = createToolbox(ctx, { ledger, turn });
  const tools = toolsForApi();
  const header = turnHeader({ now: formatNy(now.toISOString()), session: sessionAt(now).session, pageContext, scenarios: scenariosBefore, workspace: ctx.mode });
  const messages = [...prior, { role: 'user', content: `${header}\n\nQuestion: ${question}` }];
  const toolLog = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0, calls: 0 };
  const maxRounds = backend.config?.maxToolRounds ?? 8;
  let final = null;
  let unstructured = null;

  try {
    for (let round = 0; round <= maxRounds; round++) {
      onEvent({ type: 'thinking', round });
      const resp = await backend.create({ system: SYSTEM_PROMPT, tools, messages });
      usage.calls += 1;
      for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) usage[k] += resp.usage?.[k] || 0;
      const cost = recordUsage(db, backend.model, resp.usage);
      usage.cost_usd += cost || 0;
      if (resp.stop_reason === 'refusal') throw new BackendError('refusal', 'The model declined to answer this question.');
      if (resp.stop_reason === 'max_tokens') throw new BackendError('truncated', 'The model response was cut off before finishing.');
      messages.push({ role: 'assistant', content: resp.content });
      const calls = resp.content.filter((b) => b.type === 'tool_use');
      const submit = calls.find((b) => b.name === 'submit_answer');
      if (submit) { final = submit.input; break; }
      if (!calls.length) {
        unstructured = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        break;
      }
      if (round === maxRounds) break;
      const results = [];
      for (const call of calls) {
        onEvent({ type: 'tool_start', tool: call.name, input: call.input });
        const r = await runTool(handlers, call.name, call.input);
        toolLog.push({ tool: call.name, input: call.input, ok: r.ok, ms: r.ms, error: r.ok ? null : r.error });
        onEvent({ type: 'tool_end', tool: call.name, ok: r.ok, error: r.ok ? null : r.error, ms: r.ms });
        results.push({ type: 'tool_result', tool_use_id: call.id, content: r.ok ? serialize(r.result) : `Error: ${r.error}`, ...(r.ok ? {} : { is_error: true }) });
      }
      // All tool results go back in one user message.
      if (round === maxRounds - 1) results.push({ type: 'text', text: 'Tool budget nearly used: call submit_answer now with what you have, noting any gaps.' });
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    log.warn('chat', `turn failed: ${e.message}`);
    return save({ status: 'error', error: e instanceof BackendError ? e.message : `Something went wrong: ${e.message}`, ledger: ledger.toJSON(), tools: toolLog, scenarios: turn.scenarios, model: backend.model, usage, proposals: turn.proposals });
  }

  let answer, issues;
  if (final) ({ answer, issues } = validateAnswer(final, ledger));
  else if (unstructured) {
    ({ answer, issues } = validateAnswer({ short_answer: unstructured.slice(0, 1500), details: [] }, ledger));
    issues.push('The model answered without the structured format, so sources could not be attached.');
  } else {
    answer = null;
    issues = ['The model used its full tool budget without answering.'];
  }
  const failedTools = toolLog.filter((t) => !t.ok);
  const status = !answer ? 'error' : issues.length || failedTools.length ? 'partial' : 'ok';
  const saved = save({
    status, text: answer?.short_answer || null,
    answer: answer ? { ...answer, issues, failedTools: failedTools.map((t) => ({ tool: t.tool, error: t.error })) } : null,
    error: answer ? null : issues.join(' '),
    ledger: ledger.toJSON(), tools: toolLog, scenarios: turn.scenarios, model: backend.model,
    usage: { ...usage, cost_usd: Math.round(usage.cost_usd * 10000) / 10000, estimated: estimateCost(backend.model, { input_tokens: 1 }) != null },
    proposals: turn.proposals,
  });
  return saved;
}
