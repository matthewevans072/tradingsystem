// "Ask Signal Desk" chat panel, available on every page.
import { h, mount, clear, fmt, badge, extLink, toast, ACTION_LABEL } from './ui.js';
import { app, api, apiStream } from './api.js';

const CATEGORY = {
  portfolio_record: ['Your records', 'cat-record'],
  external_fact: ['Verified fact', 'cat-fact'],
  calculation: ['Calculation', 'cat-calc'],
  interpretation: ['Interpretation', 'cat-interp'],
  data_gap: ['Data gap', 'cat-gap'],
};
const KIND_LABEL = {
  portfolio_record: 'Your records', market_data: 'Market data', news: 'News', filing: 'Regulatory filing', press_release: 'Company release',
  profile: 'Company/fund profile', event: 'Scheduled event', archived_report: 'Saved briefing (archived)', assessment: 'Saved assessment',
  calculation: 'Signal Desk calculation', status: 'Data status',
};
const TOOL_LABEL = {
  get_data_status: 'Checking data freshness', get_portfolio: 'Reading your portfolio records', get_position: 'Reading the position record',
  get_transactions: 'Reading trade history', get_quotes: 'Getting quotes', get_price_history: 'Reading price history',
  get_company_profile: 'Looking up the company profile', get_news: 'Checking news and filings', get_events: 'Checking earnings and events',
  get_briefings: 'Searching saved briefings', get_briefing: 'Opening a saved briefing', get_assessments: 'Reading saved assessments',
  get_watchlist: 'Reading the watchlist', what_changed: 'Comparing with earlier', explain_portfolio_move: "Breaking down today's move",
  analyze_risk_overlap: 'Analysing shared risks', simulate_trade: 'Calculating a hypothetical trade', propose_record_change: 'Preparing a proposed change',
};
const CONF = { low: 'Low confidence', moderate: 'Moderate confidence', high: 'High confidence' };

const state = {
  open: false, status: null, conversations: [], current: null, busy: false, suggestions: [], view: 'chat', workspace: null,
};
let els = {};

export function initChat() {
  const btn = h('button', { class: 'ask-btn', id: 'ask-btn', 'aria-label': 'Ask Signal Desk', onclick: () => toggle(true) }, h('span', { class: 'ask-ico', 'aria-hidden': 'true' }, '✦'), h('span', {}, 'Ask'));
  const panel = h('aside', { class: 'chat-panel', id: 'chat-panel', role: 'dialog', 'aria-label': 'Ask Signal Desk', hidden: true });
  document.body.append(btn, panel);
  els = { btn, panel };
  app.listeners.add(() => {
    if (state.workspace && state.workspace !== app.workspace) { state.current = null; state.conversations = []; state.status = null; }
    if (state.open) refreshSuggestions();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open && !document.querySelector('.overlay.open')) toggle(false); });
}

async function toggle(open) {
  state.open = open;
  els.panel.hidden = !open;
  els.btn.hidden = open;
  document.body.classList.toggle('chat-open', open);
  if (!open) return;
  state.workspace = app.workspace;
  render();
  try {
    const [status, convs] = await Promise.all([api('GET', '/api/chat/status'), api('GET', '/api/chat/conversations')]);
    state.status = status;
    state.conversations = convs;
  } catch (e) {
    state.status = { available: false, reason: e.message };
  }
  await refreshSuggestions(false);
  render();
  els.panel.querySelector('textarea')?.focus();
}

async function refreshSuggestions(rerender = true) {
  try {
    const q = new URLSearchParams({ page: app.page || '', ...(app.selectedSymbol ? { symbol: app.selectedSymbol } : {}) });
    state.suggestions = await api('GET', `/api/chat/suggestions?${q}`);
  } catch {
    state.suggestions = [];
  }
  if (rerender) render();
}

async function openConversation(id) {
  state.current = await api('GET', `/api/chat/conversations/${id}`);
  state.view = 'chat';
  render();
  scrollToEnd();
}

function newConversation() {
  state.current = null;
  state.view = 'chat';
  render();
  els.panel.querySelector('textarea')?.focus();
}

async function send(text) {
  const q = String(text || '').trim();
  if (!q || state.busy) return;
  state.busy = true;
  try {
    if (!state.current) {
      const { id } = await api('POST', '/api/chat/conversations', { title: q.slice(0, 80) });
      state.current = { id, title: q.slice(0, 80), messages: [], proposals: [] };
    }
    const conv = state.current;
    conv.messages.push({ role: 'user', text: q, createdAt: new Date().toISOString(), pending: true });
    const progress = [];
    conv.progress = progress;
    render();
    scrollToEnd();
    await apiStream(`/api/chat/conversations/${conv.id}/messages`, { text: q, pageContext: { page: app.page, symbol: app.selectedSymbol } }, (ev) => {
      if (ev.type === 'tool_start') progress.push({ tool: ev.tool, state: 'running' });
      if (ev.type === 'tool_end') {
        const p = [...progress].reverse().find((x) => x.tool === ev.tool && x.state === 'running');
        if (p) Object.assign(p, { state: ev.ok ? 'done' : 'failed', error: ev.error });
      }
      if (ev.type === 'thinking' && ev.round > 0) progress.push({ tool: '_think', state: 'running' });
      renderProgress();
    });
    state.current = await api('GET', `/api/chat/conversations/${conv.id}`);
    state.conversations = await api('GET', '/api/chat/conversations');
    state.status = await api('GET', '/api/chat/status');
  } catch (e) {
    if (state.current) {
      state.current.progress = null;
      state.current.messages.push({ role: 'assistant', status: 'error', error: e.message });
    }
    toast(e.message, 'error');
  } finally {
    state.busy = false;
    if (state.current) state.current.progress = null;
    render();
    scrollToEnd();
  }
}

function scrollToEnd() {
  const list = els.panel.querySelector('.chat-messages');
  if (list) list.scrollTop = list.scrollHeight;
}

// ---------- rendering ----------

function render() {
  if (!state.open) return;
  const s = state.status;
  const head = h('header', { class: 'chat-head' },
    h('div', { class: 'chat-title' }, h('span', { class: 'ask-ico', 'aria-hidden': 'true' }, '✦'), h('strong', {}, 'Ask Signal Desk'),
      app.workspace === 'demo' ? badge('Demo data', 'warn') : null),
    h('div', { class: 'row' },
      h('button', { class: 'icon-btn', title: 'Saved conversations', 'aria-label': 'Saved conversations', onclick: () => { state.view = state.view === 'history' ? 'chat' : 'history'; render(); } }, '☰'),
      h('button', { class: 'icon-btn', title: 'New conversation', 'aria-label': 'New conversation', onclick: newConversation }, '+'),
      h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: () => toggle(false) }, '✕')));

  if (state.view === 'history') {
    mount(els.panel, head, historyView());
    return;
  }
  const body = h('div', { class: 'chat-messages' });
  if (!s) body.append(h('div', { class: 'state loading' }, h('span', { class: 'spinner' }), 'Loading…'));
  else if (!s.available) body.append(unavailableView(s));
  const msgs = state.current?.messages || [];
  if (s?.available && !msgs.length) body.append(introView());
  for (const m of msgs) body.append(m.role === 'user' ? userBubble(m) : assistantMessage(m));
  if (state.current?.progress) body.append(h('div', { class: 'chat-progress', id: 'chat-progress' }));
  const input = h('textarea', { rows: 2, placeholder: s?.available === false ? 'Ask Signal Desk is not configured' : 'Ask about your portfolio, a company, news or a hypothetical trade…', disabled: state.busy || s?.available === false ? true : null, maxlength: 4000 });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
  const foot = h('footer', { class: 'chat-foot' },
    state.suggestions.length && s?.available ? h('div', { class: 'chat-suggest' }, state.suggestions.slice(0, msgs.length ? 3 : 6).map((q) => h('button', { class: 'chip-btn', disabled: state.busy || null, onclick: () => send(q) }, q))) : null,
    h('div', { class: 'chat-input' }, input, h('button', { class: 'btn primary', disabled: state.busy || s?.available === false || null, onclick: () => send(input.value) }, state.busy ? '…' : 'Ask')),
    h('div', { class: 'chat-meta' },
      h('span', {}, 'Read-only. Never places trades.'),
      s?.available ? h('span', {}, ` · ${s.model}${s.dailyBudgetUsd ? ` · today ~$${(s.spentTodayUsd || 0).toFixed(2)} of $${s.dailyBudgetUsd}` : ''}`) : null,
      ' · ', h('button', { class: 'linklike small', onclick: showDisclosure }, 'What is sent to the model?')));
  mount(els.panel, head, body, foot);
  renderProgress();
}

function renderProgress() {
  const el = document.getElementById('chat-progress');
  const p = state.current?.progress;
  if (!el || !p) return;
  mount(el,
    h('div', { class: 'row small muted' }, h('span', { class: 'spinner' }), 'Working on it…'),
    h('ul', { class: 'progress-list' }, p.filter((x) => x.tool !== '_think').map((x) => h('li', { class: `pg-${x.state}` },
      h('span', { class: 'pg-mark' }, x.state === 'done' ? '✓' : x.state === 'failed' ? '!' : '…'),
      TOOL_LABEL[x.tool] || x.tool, x.error ? h('span', { class: 'neg small' }, ` — ${x.error}`) : null))));
  scrollToEnd();
}

function introView() {
  return h('div', { class: 'chat-intro' },
    h('p', {}, 'Ask about your holdings, today\'s moves, a company, news, upcoming earnings or a hypothetical trade. Answers are built from your saved records and stored data, with sources and timestamps.'),
    h('ul', { class: 'bullets small muted' },
      h('li', {}, 'Read-only: it cannot trade or change records. If you ask it to record something, it shows the exact change for you to confirm.'),
      h('li', {}, 'Hypothetical trades are calculated by Signal Desk, not estimated by the model.'),
      h('li', {}, 'It says when data is missing, delayed or stale.')));
}

function unavailableView(s) {
  return h('div', { class: 'notice warn' },
    h('strong', {}, 'Ask Signal Desk is not available. '), s.reason || '',
    h('ul', {},
      h('li', {}, 'It needs its own Anthropic API key (console.anthropic.com → API keys). Building Signal Desk with Claude Code does not give the app model access.'),
      h('li', {}, 'Add ANTHROPIC_API_KEY=... to .env in the Signal Desk folder and restart.'),
      h('li', {}, 'Usage is billed per token to that key. With the default model a typical question costs roughly US$0.05–0.30; a daily cap (CHAT_DAILY_BUDGET_USD, default $5) stops spending.')));
}

function historyView() {
  const list = state.conversations;
  return h('div', { class: 'chat-messages' },
    h('div', { class: 'spread' }, h('strong', {}, 'Saved conversations'), h('button', { class: 'btn small', onclick: newConversation }, 'New')),
    list.length ? h('div', { class: 'list mt' }, list.map((c) => h('div', { class: 'list-item spread' },
      h('button', { class: 'linklike conv-link', onclick: () => openConversation(c.id) }, h('span', {}, c.title), h('span', { class: 'small muted' }, ` · ${c.questions} question${c.questions === 1 ? '' : 's'} · ${fmt.et(c.updated_at)}`)),
      h('button', { class: 'btn small ghost danger', 'aria-label': `Delete conversation ${c.title}`, onclick: async () => {
        if (!confirm('Delete this conversation and its saved answers? This cannot be undone.')) return;
        try {
          await api('DELETE', `/api/chat/conversations/${c.id}`);
          if (state.current?.id === c.id) state.current = null;
          state.conversations = await api('GET', '/api/chat/conversations');
          render();
        } catch (e) { toast(e.message, 'error'); }
      } }, 'Delete')))) : h('p', { class: 'muted mt' }, 'No saved conversations yet.'));
}

async function showDisclosure() {
  const s = state.status || await api('GET', '/api/chat/status').catch(() => null);
  const box = h('div', { class: 'notice info disclosure' },
    h('strong', {}, 'What Ask Signal Desk sends to the model provider'),
    h('ul', {}, (s?.disclosure || []).map((d) => h('li', {}, d))),
    s?.pricingPerMillionTokens ? h('div', { class: 'small' }, `Model ${s.model}: about US$${s.pricingPerMillionTokens.input}/M input and US$${s.pricingPerMillionTokens.output}/M output tokens (estimate; check anthropic.com/pricing).`) : null,
    h('button', { class: 'btn small mt', onclick: () => box.remove() }, 'Close'));
  els.panel.querySelector('.chat-messages')?.prepend(box);
}

function userBubble(m) {
  return h('div', { class: 'msg user' }, h('div', { class: 'bubble' }, m.text));
}

function refChip(ref, ledger) {
  const item = ledger.find((l) => l.ref === ref);
  if (!item) return null;
  const chip = h('button', { class: `ref-chip kind-${item.kind}`, title: `${KIND_LABEL[item.kind] || item.kind}: ${item.label}` }, ref);
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    const parent = chip.closest('.detail-item, .short-answer') || chip.parentElement;
    const existing = parent.querySelector(`.ref-pop[data-ref="${ref}"]`);
    if (existing) { existing.remove(); return; }
    parent.append(sourceCard(item, true));
  });
  return chip;
}

function sourceCard(item, pop = false) {
  const holdingLink = item.symbol && ['portfolio_record', 'assessment', 'market_data', 'calculation'].includes(item.kind)
    ? h('a', { href: `#/positions?symbol=${encodeURIComponent(item.symbol)}` }, `Open ${item.symbol}`) : null;
  return h('div', { class: pop ? 'ref-pop' : 'source-row', dataset: { ref: item.ref } },
    h('div', { class: 'row' }, h('span', { class: 'ref-id' }, item.ref), badge(KIND_LABEL[item.kind] || item.kind), item.freshness ? badge(item.freshness, item.freshness === 'fresh' ? 'ok' : 'warn') : null,
      item.note && ['confirmed', 'reported', 'unconfirmed', 'conflicting'].includes(item.note) ? badge(item.note, item.note === 'confirmed' ? 'ok' : item.note === 'reported' ? 'info' : 'warn') : null),
    h('div', { class: 'small' }, item.url ? extLink(item.url, item.label) : item.label),
    h('div', { class: 'small muted' }, [item.source, item.asOf ? `as of ${item.asOf.length === 10 ? item.asOf : fmt.et(item.asOf)}` : null, item.note && !['confirmed', 'reported', 'unconfirmed', 'conflicting'].includes(item.note) ? item.note : null].filter(Boolean).join(' · ')),
    holdingLink);
}

function scenarioCard(s) {
  const rows = s.side === 'sell'
    ? [['Shares', `${fmt.qty(s.shares)} of ${fmt.qty(s.sharesBefore)} (${fmt.qty(s.sharesAfter)} left)`], ['Est. price', `${fmt.num(s.price)} ${s.currency}`], ['Gross proceeds', fmt.money(s.grossProceeds, s.currency)],
      ['Fees', s.feesKnown ? fmt.money(s.fees, s.currency) : 'unknown (calculated as $0)'], ['Cash freed', fmt.money(s.netProceeds, s.currency)],
      ['Cash after', s.cashAfter != null ? fmt.money(s.cashAfter, s.currency) : 'unknown (cash not recorded)'],
      ['Est. realized P/L', fmt.signedMoney(s.estimatedRealizedPL, s.currency)], s.cadEquivalentOfProceeds ? ['≈ in CAD', `${fmt.money(s.cadEquivalentOfProceeds.amount, 'CAD')} at ${s.cadEquivalentOfProceeds.fxRate} (${s.cadEquivalentOfProceeds.fxAsOf})`] : null,
      s.weightAfterPct != null ? ['Weight', `${fmt.plainPct(s.weightBeforePct)} → ${fmt.plainPct(s.weightAfterPct)}`] : null, ['Taxes', s.taxes]]
    : [['Shares', `${fmt.qty(s.shares)} (to ${fmt.qty(s.sharesAfter)})`], ['Est. price', `${fmt.num(s.price)} ${s.currency}`], ['Total cost', fmt.money(s.totalCost, s.currency)],
      ['Fees', s.feesKnown ? fmt.money(s.fees, s.currency) : 'unknown (calculated as $0)'], ['Cash before → after', s.cashBefore != null ? `${fmt.money(s.cashBefore)} → ${fmt.money(s.cashAfter)}` : 'cash not recorded'],
      ['Affordable with confirmed cash', s.affordableWithConfirmedCash ? 'Yes' : `No${s.cashShortfall ? ` (short ${fmt.money(s.cashShortfall, s.currency)})` : ''}`],
      ['New average cost', fmt.num(s.newAverageCost, 4)]];
  return h('div', { class: 'scenario' },
    h('div', { class: 'spread' }, h('strong', {}, `${s.id}: ${s.side === 'sell' ? 'Sell' : 'Buy'} ${fmt.qty(s.shares)} ${s.symbol}`), badge('Hypothetical — not saved', 'warn')),
    h('dl', { class: 'kv small' }, rows.filter(Boolean).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('div', { class: 'small muted' }, `Price basis: ${s.priceBasis}`),
    s.notes?.length ? h('ul', { class: 'bullets small muted' }, s.notes.map((n) => h('li', {}, n))) : null);
}

function proposalCard(p) {
  const card = h('div', { class: `proposal status-${p.status}` },
    h('div', { class: 'spread' }, h('strong', {}, 'Proposed change'), badge(p.status === 'pending' ? 'Not saved — needs your confirmation' : p.status, p.status === 'confirmed' ? 'ok' : p.status === 'pending' ? 'warn' : '')),
    h('div', {}, p.diff.summary),
    p.diff.before !== undefined ? h('div', { class: 'small muted' }, `Before: ${JSON.stringify(p.diff.before)}`) : null,
    p.diff.positionBefore ? h('div', { class: 'small muted' }, `Position before: ${p.diff.positionBefore.shares} shares @ ${p.diff.positionBefore.averageCost}`) : null,
    p.diff.reminder ? h('div', { class: 'small muted' }, p.diff.reminder) : null,
    h('div', { class: 'small muted' }, `Requested in your words: "${p.userQuote}"`));
  if (p.status === 'pending') {
    const ok = h('button', { class: 'btn small primary' }, 'Confirm and save');
    const no = h('button', { class: 'btn small' }, 'Reject');
    ok.addEventListener('click', async () => {
      ok.disabled = true; no.disabled = true;
      try { await api('POST', `/api/chat/proposals/${p.id}/confirm`); toast('Saved to your records'); } catch (e) { toast(e.message, 'error'); }
      state.current = await api('GET', `/api/chat/conversations/${state.current.id}`);
      render();
    });
    no.addEventListener('click', async () => {
      ok.disabled = true; no.disabled = true;
      try { await api('POST', `/api/chat/proposals/${p.id}/reject`); toast('Proposal rejected; nothing changed'); } catch (e) { toast(e.message, 'error'); }
      state.current = await api('GET', `/api/chat/conversations/${state.current.id}`);
      render();
    });
    card.append(h('div', { class: 'row mt' }, ok, no));
  }
  if (p.result?.error) card.append(h('div', { class: 'small neg' }, p.result.error));
  return card;
}

function assistantMessage(m) {
  if (m.status === 'unavailable' || (m.status === 'error' && !m.answer)) {
    return h('div', { class: 'msg assistant' }, h('div', { class: `notice ${m.status === 'unavailable' ? 'warn' : 'danger'}` },
      h('strong', {}, m.status === 'unavailable' ? 'Unavailable: ' : 'Could not answer: '), m.error || 'Unknown error',
      m.tools?.length ? h('div', { class: 'small mt' }, `Tools run before the failure: ${m.tools.map((t) => `${t.tool}${t.ok ? '' : ' (failed)'}`).join(', ')}`) : null));
  }
  const a = m.answer;
  const ledger = m.ledger || [];
  const proposals = (state.current?.proposals || []).filter((p) => p.messageId === m.id);
  const usedRefs = new Set(a.details.flatMap((d) => d.refs));
  const groups = Object.keys(CATEGORY).map((c) => [c, a.details.filter((d) => d.category === c)]).filter(([, l]) => l.length);
  const holdings = a.affected_symbols || [];
  return h('div', { class: 'msg assistant' },
    m.status === 'partial' ? h('div', { class: 'small warn-text' }, '⚠ Partial answer — see notes below.') : null,
    h('div', { class: 'short-answer' }, a.short_answer),
    holdings.length ? h('div', { class: 'row small' }, 'Holdings: ', holdings.map((s) => h('a', { class: 'hold-chip', href: `#/positions?symbol=${encodeURIComponent(s)}` }, s))) : null,
    a.confidence && a.confidence !== 'not_applicable' ? h('div', { class: 'small muted' }, CONF[a.confidence] || a.confidence, a.horizon ? ` · Horizon: ${a.horizon}` : '') : (a.horizon ? h('div', { class: 'small muted' }, `Horizon: ${a.horizon}`) : null),
    (m.scenarios || []).map(scenarioCard),
    proposals.map(proposalCard),
    groups.length || a.alternatives?.length || a.what_would_change_it ? h('details', { class: 'more answer-details' }, h('summary', {}, 'Supporting details'),
      groups.map(([c, list]) => h('div', { class: 'detail-group' },
        h('div', { class: `cat-label ${CATEGORY[c][1]}` }, CATEGORY[c][0]),
        list.map((d) => h('div', { class: 'detail-item' }, h('span', {}, d.text, ' '), d.refs.map((r) => refChip(r, ledger)), d.uncited ? badge('uncited', 'warn', 'No supporting source was attached to this point') : null)))),
      a.alternatives?.length ? h('div', { class: 'detail-group' }, h('div', { class: 'cat-label cat-interp' }, 'Alternatives compared'),
        a.alternatives.map((x) => h('div', { class: 'alt' }, h('strong', {}, x.option), h('div', { class: 'small' }, h('span', { class: 'pos' }, 'For: '), x.case_for), h('div', { class: 'small' }, h('span', { class: 'neg' }, 'Against: '), x.case_against)))) : null,
      a.what_would_change_it ? h('div', { class: 'detail-group' }, h('div', { class: 'cat-label cat-interp' }, 'What would change this'), h('div', { class: 'small' }, a.what_would_change_it)) : null) : null,
    a.issues?.length || a.failedTools?.length ? h('div', { class: 'notice warn small' }, h('ul', {}, [...(a.issues || []), ...(a.failedTools || []).map((t) => `${TOOL_LABEL[t.tool] || t.tool} failed: ${t.error}`)].map((i) => h('li', {}, i)))) : null,
    ledger.length ? h('details', { class: 'more data-used' }, h('summary', {}, `Data used (${ledger.length})`),
      h('div', { class: 'small muted' }, `Retrieved for this answer at ${fmt.et(m.createdAt)}. Items marked as cited support specific points above.`),
      ledger.map((item) => {
        const row = sourceCard(item);
        if (usedRefs.has(item.ref)) row.classList.add('cited');
        return row;
      }),
      m.tools?.length ? h('div', { class: 'small muted mt' }, 'Tools: ', m.tools.map((t) => `${t.tool} ${t.ok ? '✓' : '✗'} ${t.ms}ms`).join(' · ')) : null) : null,
    a.follow_up_questions?.length ? h('div', { class: 'chat-suggest' }, a.follow_up_questions.map((q) => h('button', { class: 'chip-btn', disabled: state.busy || null, onclick: () => send(q) }, q))) : null,
    m.usage ? h('div', { class: 'small muted' }, `${m.model} · ${m.usage.calls} call${m.usage.calls === 1 ? '' : 's'} · ${(m.usage.input_tokens + m.usage.cache_read_input_tokens).toLocaleString()} in / ${m.usage.output_tokens.toLocaleString()} out tokens · ~$${(m.usage.cost_usd || 0).toFixed(3)}`) : null);
}

export { ACTION_LABEL };
