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
import { recordUsage, budgetCheck, reserveSpend, BackendError, usableContent } from './backend.js';
import { listProposals, checkUserIntent } from './proposals.js';
import { guardText, findClaims } from './guard.js';

export { guardText };

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
// The trade-claim guard lives in guard.js; validateAnswer applies it to every
// answer field.

// Follow-up suggestions are sent as the user's own words when clicked, so one
// phrased as an instruction ("Record that I sold 10 VRT at 98") would satisfy
// the proposal intent check without the user having said it. Drop those.
const ACTION_START = /^\W*(?:please\s+)?(?:record|log|add|set|update|change|remove|delete|save|enter|create|put|mark|note|sell|buy|trim|purchase|short|place|execute|exit|liquidate|confirm|apply|cancel)\b|\b(?:for me|on my behalf)\b/i;
const QUESTION_START = /^\W*(what|which|when|where|why|how|who|is|are|was|were|do|does|did|should|would|could|can|will|has|have)\b/i;
export function unsafeFollowUp(text) {
  const f = String(text || '');
  if (ACTION_START.test(f)) return true;
  // A question is unsafe only if it would itself pass as an explicit request
  // with values ("Can you record that I sold 10 VRT at 129.50?").
  const passes = ['add_transaction', 'set_cash', 'add_price_alert', 'update_alert_threshold', 'set_strategy']
    .some((changeType) => checkUserIntent(f, f, { changeType, details: {} }) === null);
  if (!passes) return false;
  return !QUESTION_START.test(f) || /\b(can|could|would|will) you\b|\bplease\b/i.test(f) && /\d/.test(f);
}

const MUST_CITE = ['portfolio_record', 'external_fact', 'reported_claim', 'calculation'];
const isReported = (item) => !!item && ((item.kind === 'news' && item.note !== 'confirmed') || item.kind === 'archived_report');
const isArchived = (item) => item?.kind === 'archived_report';
// stale / unknown / missing quote or history, or a quote that can no longer update (no provider).
function staleState(item) {
  if (item?.kind !== 'market_data') return null;
  if (['stale', 'unknown', 'missing'].includes(item.freshness)) return item.freshness;
  return item.updating === false ? 'not_updating' : null;
}
const mentions = (text, sym) => !!sym && new RegExp(`(^|[^A-Za-z0-9])${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`).test(text);

export function validateAnswer(raw, ledger, { toolsRun = null } = {}) {
  const issues = [];
  const notes = [];
  const removed = [];
  const str = (x) => (x == null ? null : String(x).trim() || null);
  const guard = (t) => {
    const g = guardText(t);
    if (g.flagged) removed.push(...g.removed);
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
    if (findClaims(f).length || unsafeFollowUp(f)) { notes.push('A suggested follow-up phrased as an instruction was dropped.'); continue; }
    a.follow_up_questions.push(f);
  }
  const ledgerSymbols = new Set(ledger.items.map((i) => i.symbol).filter(Boolean));
  for (const d of (Array.isArray(raw?.details) ? raw.details : []).slice(0, 25)) {
    if (!d || typeof d !== 'object') continue;
    let category = ANSWER_CATEGORIES.includes(d.category) ? d.category : 'interpretation';
    const refs = (Array.isArray(d.refs) ? d.refs : []).map(String).filter((r) => {
      if (ledger.has(r)) return true;
      issues.push(`Unknown reference ${r} removed`);
      return false;
    });
    const text = guard(String(d.text || ''));
    const out = { category, text, refs };
    // A media report, rumour or archived briefing is not a verified fact, even
    // when it is cited next to a confirmed source.
    const reported = refs.filter((r) => isReported(ledger.get(r)));
    if (category === 'external_fact' && reported.length) {
      out.category = category = 'reported_claim';
      out.relabelled = 'external_fact';
      notes.push(`A point citing ${reported.length < refs.length ? 'a media report or archived briefing alongside other sources' : 'only media reports or archived briefings'} was relabelled "reported" (${reported.join(', ')}).`);
    } else if (['portfolio_record', 'calculation'].includes(category) && refs.length && refs.every((r) => isArchived(ledger.get(r)))) {
      out.relabelled = category;
      out.category = category = 'reported_claim';
      notes.push(`A point taken only from an archived briefing was relabelled "reported" (${refs.join(', ')}); archived briefings are snapshots, not current records.`);
    }
    if (MUST_CITE.includes(category) && !refs.length) out.uncited = true;
    // A point about one ticker whose sources all concern other tickers.
    const named = [...new Set((text.match(/\b[A-Z]{2,5}\b/g) || []).filter((x) => ledgerSymbols.has(x)))];
    const refSyms = refs.map((r) => ledger.get(r)?.symbol);
    if (named.length === 1 && refs.length && refSyms.every(Boolean) && !refSyms.includes(named[0])) {
      out.refMismatch = true;
      issues.push(`A point about ${named[0]} cites ${refs.join(', ')}, which concern ${[...new Set(refSyms)].join(', ')}.`);
    }
    a.details.push(out);
  }
  // Stale, undated or no-longer-updating market data the answer relies on (cited,
  // or the ticker is mentioned anywhere) gets an explicit gap note.
  const allText = [a.short_answer, a.what_would_change_it, ...a.details.map((d) => d.text), ...a.alternatives.flatMap((x) => [x.option, x.case_for, x.case_against])].filter(Boolean).join('\n');
  const cited = new Set(a.details.flatMap((d) => d.refs));
  const gaps = a.details.filter((d) => d.category === 'data_gap');
  const notUpdating = [];
  for (const item of ledger.items) {
    const state = staleState(item);
    if (!state || !(cited.has(item.ref) || mentions(allText, item.symbol))) continue;
    if (state === 'not_updating') { notUpdating.push(item); continue; }
    if (gaps.some((d) => d.refs.includes(item.ref) || mentions(d.text, item.symbol))) continue;
    a.details.push({ category: 'data_gap', refs: [item.ref], auto: true, text: `Possibly out of date: ${item.label} is ${state === 'stale' ? 'stale' : 'missing a reliable timestamp'}${item.asOf ? ` (as of ${formatNy(item.asOf)})` : ''}.` });
  }
  if (notUpdating.length && !gaps.some((d) => /not (being )?(updated|refreshed)|no (market[- ]data )?provider|can(no|')t (be )?(update|refresh)/i.test(d.text))) {
    const latest = notUpdating.map((i) => i.asOf).filter(Boolean).sort().at(-1);
    a.details.push({ category: 'data_gap', refs: notUpdating.slice(0, 6).map((i) => i.ref), auto: true, text: `Prices are not being updated: no market-data provider is configured, so the quotes used are the last ones stored${latest ? ` (latest ${formatNy(latest)})` : ''}.` });
  }
  if (removed.length) issues.push('A statement claiming a trade or record change was removed.');
  const uncited = a.details.filter((d) => d.uncited).length;
  if (uncited) issues.push(`${uncited} factual point(s) had no supporting reference and are marked uncited.`);
  if (!a.short_answer) issues.push('The model returned no short answer.');
  if (toolsRun === 0 && (a.details.some((d) => MUST_CITE.includes(d.category)) || /\d/.test(a.short_answer))) {
    issues.push('No records were retrieved for this answer, so it may rest on earlier answers rather than current data.');
  }
  return { answer: { ...a, executionClaimRemoved: removed.length > 0, notes }, issues, removed };
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
  const firstCheck = budgetCheck(ctx.cfg, cc);
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
  const account = (resp) => {
    const rec = recordUsage(ctx, resp, backend.model, cc.priceOverride);
    for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) usage[k] += rec.tokens[k] || 0;
    usage.cost_usd += rec.cost || 0;
    if (rec.unpriced) usage.unpriced = true;
    for (const m of rec.models) if (m && !usage.models.includes(m)) usage.models.push(m);
  };
  let checked = null; // validated final answer
  let unstructured = null;
  let empty = false;
  let nudged = false;
  let rephraseAsked = false;
  let stopNote = null;

  try {
    for (let round = 0; round <= maxRounds; round++) {
      if (signal?.aborted) throw new BackendError('aborted', ABORTED);
      if (round > 0) {
        const b = budgetCheck(ctx.cfg, cc);
        if (!b.ok) { stopNote = `Stopped before finishing: ${b.reason}`; break; }
      }
      onEvent({ type: 'thinking', round });
      const hold = reserveSpend(ctx.cfg);
      let resp;
      try {
        resp = await backend.create({ system: SYSTEM_PROMPT, tools, messages, signal });
      } catch (e) {
        if (e?.partial) { usage.calls += 1; account(e.partial); }
        throw e;
      } finally {
        hold.release();
      }
      usage.calls += 1;
      account(resp);
      if (resp.stop_reason === 'refusal') throw new BackendError('refusal', 'The model declined to answer this question.');
      if (resp.stop_reason === 'max_tokens') throw new BackendError('truncated', 'The model response was cut off before finishing.');
      const content = usableContent(resp.content);
      messages.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(no content)' }] });
      const calls = content.filter((b) => b.type === 'tool_use');
      const submits = calls.filter((b) => b.name === 'submit_answer');
      // submit_answer on its own (or, in the last round, alongside other calls).
      if (submits.length && (calls.length === 1 || round === maxRounds)) {
        const v = validateAnswer(submits.at(-1).input, ledger, { toolsRun: toolLog.length });
        // One chance to rephrase sentences that read as a trade or record-change claim.
        if (v.removed.length && !rephraseAsked && round < maxRounds) {
          rephraseAsked = true;
          messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: submits.at(-1).id, is_error: true,
            content: `Not delivered. These sentences read as saying a trade was made or a record was changed, which Signal Desk cannot do: ${v.removed.map((x) => JSON.stringify(x)).join(' ')} Rephrase them so they cannot be read that way (for example "No order has been placed" or "The post claims…"), then call submit_answer again with the full answer.` }] });
          continue;
        }
        checked = v;
        break;
      }
      if (!calls.length) {
        const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        // A plain-text reply: ask once for the structured answer, which carries the sources.
        if (!nudged && round < maxRounds) {
          nudged = true;
          messages.push({ role: 'user', content: toolLog.length
            ? 'Please deliver that answer by calling submit_answer, citing the reference ids from the tool results.'
            : 'Please retrieve the records you need with the tools first, then call submit_answer citing their reference ids.' });
          continue;
        }
        if (text) unstructured = text;
        else empty = true;
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
        const refsBefore = new Set(ledger.items.map((i) => i.ref));
        const r = await runTool(handlers, call.name, call.input);
        toolLog.push({ tool: call.name, input: call.input, ok: r.ok, ms: r.ms, error: r.ok ? null : r.error });
        onEvent({ type: 'tool_end', tool: call.name, ok: r.ok, error: r.ok ? null : r.error, ms: r.ms });
        const body = r.ok ? fitResult(r.result) : `Error: ${r.error}`;
        // Refs registered by this call that were cut from what the model sees are forgotten.
        const unseen = ledger.items.filter((i) => !refsBefore.has(i.ref) && !new RegExp(`"${i.ref}"`).test(body)).map((i) => i.ref);
        if (unseen.length) ledger.remove(unseen);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: body, ...(r.ok ? {} : { is_error: true }) });
      }
      // All tool results go back in one user message.
      if (round === maxRounds - 1) results.push({ type: 'text', text: 'Tool budget nearly used: call submit_answer on its own now with what you have, noting any gaps.' });
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    log.warn('chat', `turn failed: ${e.message}`);
    const error = signal?.aborted ? ABORTED : e instanceof BackendError ? e.message : `Something went wrong: ${e.message}`;
    return save({ status: 'error', error, ledger: ledger.toJSON(), tools: toolLog, scenarios: turn.scenarios, model: servedBy(), usage: usageOut(usage), proposals: turn.proposals });
  }

  let answer, issues;
  try {
    if (checked) ({ answer, issues } = checked);
    else if (unstructured) {
      ({ answer, issues } = validateAnswer({ short_answer: unstructured.slice(0, 1500), details: [] }, ledger, { toolsRun: toolLog.length }));
      issues.push('The model answered without the structured format, so sources could not be attached.');
    } else {
      answer = null;
      issues = [stopNote || (empty ? 'The model returned an empty reply. Try asking again.' : 'The model used its full tool budget without answering.')];
    }
    if (answer) {
      const held = computePortfolio(db, { now, catalog: ctx.catalog }).positions.map((p) => p.symbol);
      // Only tickers actually held get a link to their position.
      answer.held_symbols = answer.affected_symbols.filter((s) => held.includes(s));
      answer.portfolio_symbols = [...new Set(held)];
      if (rephraseAsked && !answer.executionClaimRemoved) answer.notes.push('The first draft contained a sentence that read as a trade or record-change claim; the model rephrased it.');
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
