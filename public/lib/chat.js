// "Ask Signal Desk" chat panel, available on every page.
import { h, mount, fmt, badge, extLink, toast, ACTION_LABEL } from './ui.js';
import { app, api, apiStream } from './api.js';

const CATEGORY = {
  portfolio_record: ['Your records', 'cat-record'],
  external_fact: ['Verified fact', 'cat-fact'],
  reported_claim: ['Reported, not verified', 'cat-reported'],
  calculation: ['Calculation', 'cat-calc'],
  interpretation: ['Interpretation', 'cat-interp'],
  data_gap: ['Data gap', 'cat-gap'],
};
const KIND_LABEL = {
  portfolio_record: 'Your records', market_data: 'Market data', news: 'News', filing: 'Regulatory filing', press_release: 'Company release',
  profile: 'Company/fund profile', event: 'Scheduled event', archived_report: 'Saved briefing (archived)', assessment: 'Saved assessment',
  calculation: 'Signal Desk calculation', status: 'Data status',
};
const NEWS_STATUS = ['confirmed', 'reported', 'unconfirmed', 'conflicting'];
const TOOL_LABEL = {
  get_data_status: 'Checking data freshness', get_portfolio: 'Reading your portfolio records', get_position: 'Reading the position record',
  get_transactions: 'Reading trade history', get_preferences: 'Reading your risk answers and thresholds', get_quotes: 'Getting quotes',
  get_price_history: 'Reading price history', get_company_profile: 'Looking up the company profile', get_news: 'Checking news and filings',
  get_events: 'Checking earnings and events', get_briefings: 'Searching saved briefings', get_briefing: 'Opening a saved briefing',
  get_assessments: 'Reading saved assessments', get_watchlist: 'Reading the watchlist', what_changed: 'Comparing with earlier',
  explain_portfolio_move: "Breaking down the latest session's move", analyze_risk_overlap: 'Analysing shared risks',
  simulate_trade: 'Calculating a hypothetical trade', simulate_trades: 'Calculating a multi-step scenario',
  estimate_price_move: 'Calculating price-move impact', propose_record_change: 'Preparing a proposed change',
};
const CONF = { low: 'Low confidence', moderate: 'Moderate confidence', high: 'High confidence' };
const NARROW = '(max-width: 1100px)';

const state = {
  open: false, status: null, loadError: null, conversations: [], current: null, suggestions: [], view: 'chat',
  workspace: null, epoch: 0, inflight: null, draft: '', lastPage: null, lastSymbol: null,
};
let els = {};

export function initChat() {
  const btn = h('button', { class: 'ask-btn', id: 'ask-btn', 'aria-label': 'Ask Signal Desk', 'aria-controls': 'chat-panel', 'aria-expanded': 'false', onclick: () => toggle(true) },
    h('span', { class: 'ask-ico', 'aria-hidden': 'true' }, '✦'), h('span', {}, 'Ask'));
  const panel = h('aside', { class: 'chat-panel', id: 'chat-panel', role: 'region', 'aria-label': 'Ask Signal Desk', hidden: true });
  document.body.append(btn, panel);
  els = { btn, panel };
  state.workspace = app.workspace;
  app.listeners.add(() => {
    if (state.workspace !== app.workspace) {
      // Another workspace has its own conversations, spend and data: start over.
      state.epoch += 1;
      Object.assign(state, { workspace: app.workspace, current: null, conversations: [], status: null, loadError: null, inflight: null, view: 'chat', suggestions: [] });
      if (state.open) { render(); load(); }
      return;
    }
    if (state.open && (app.page !== state.lastPage || app.selectedSymbol !== state.lastSymbol)) refreshSuggestions();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open && !document.querySelector('.overlay.open')) toggle(false); });
}

async function toggle(open) {
  state.open = open;
  els.panel.hidden = !open;
  els.btn.hidden = open;
  els.btn.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('chat-open', open);
  if (!open) { els.btn.focus(); return; }
  render();
  await load();
  focusInput();
}

async function load() {
  const epoch = state.epoch;
  state.loadError = null;
  try {
    const [status, convs] = await Promise.all([api('GET', '/api/chat/status'), api('GET', '/api/chat/conversations')]);
    if (epoch !== state.epoch) return;
    state.status = status;
    state.conversations = convs;
  } catch (e) {
    if (epoch !== state.epoch) return;
    state.loadError = e.message;
  }
  await refreshSuggestions(false);
  render();
}

// Suggestions follow the page and selected holding. Only the suggestion row is
// replaced, so a half-typed question is never lost.
async function refreshSuggestions(update = true) {
  const epoch = state.epoch;
  state.lastPage = app.page;
  state.lastSymbol = app.selectedSymbol;
  try {
    const q = new URLSearchParams({ page: app.page || '', ...(app.selectedSymbol ? { symbol: app.selectedSymbol } : {}) });
    const list = await api('GET', `/api/chat/suggestions?${q}`);
    if (epoch !== state.epoch) return;
    state.suggestions = list;
  } catch {
    state.suggestions = [];
  }
  if (!update) return;
  const slot = els.panel.querySelector('#chat-suggest-main');
  if (slot && state.status?.available) mount(slot, suggestionButtons());
}

function suggestionButtons() {
  const msgs = state.current?.messages || [];
  return state.suggestions.slice(0, msgs.length ? 3 : 6).map((q) => h('button', { class: 'chip-btn', disabled: state.inflight ? true : null, onclick: () => send(q) }, q));
}

async function openConversation(id) {
  try {
    state.current = await api('GET', `/api/chat/conversations/${id}`);
    state.view = 'chat';
    render();
    scrollToEnd();
  } catch (e) {
    showPanelError(`Could not open that conversation: ${e.message}`);
  }
}

function newConversation() {
  state.current = null;
  state.view = 'chat';
  render();
  focusInput();
}

async function send(text) {
  const q = String(text || '').trim();
  if (!q || state.inflight) return;
  const epoch = state.epoch;
  try {
    if (!state.current) {
      const { id } = await api('POST', '/api/chat/conversations', { title: q.slice(0, 80) });
      state.current = { id, title: q.slice(0, 80), messages: [], proposals: [] };
    }
  } catch (e) {
    showPanelError(e.message);
    return;
  }
  state.draft = '';
  const conv = state.current;
  const askedAt = new Date().toISOString();
  state.inflight = { id: conv.id, progress: [] };
  conv.messages.push({ role: 'user', text: q, createdAt: askedAt, pending: true });
  render();
  scrollToEnd();
  let failure = null;
  try {
    await apiStream(`/api/chat/conversations/${conv.id}/messages`, { text: q, pageContext: { page: app.page, symbol: app.selectedSymbol } }, (ev) => {
      if (epoch !== state.epoch || !state.inflight) return;
      const progress = state.inflight.progress;
      if (ev.type === 'tool_start') progress.push({ tool: ev.tool, state: 'running' });
      if (ev.type === 'tool_end') {
        const p = [...progress].reverse().find((x) => x.tool === ev.tool && x.state === 'running');
        if (p) Object.assign(p, { state: ev.ok ? 'done' : 'failed', error: ev.error });
      }
      renderProgress();
    });
  } catch (e) {
    failure = e.message;
  }
  // The workspace changed while answering: the answer is saved there; leave this view alone.
  if (epoch !== state.epoch) return;
  state.inflight = null;
  try {
    const fresh = await api('GET', `/api/chat/conversations/${conv.id}`);
    // Only replace the view if the user is still looking at this conversation.
    if (state.current?.id === conv.id) state.current = fresh;
    state.conversations = await api('GET', '/api/chat/conversations');
    state.status = await api('GET', '/api/chat/status');
  } catch (e) {
    failure ||= e.message;
  }
  // A failure the server did not record (e.g. the connection dropped) is shown in the thread.
  if (failure && state.current?.id === conv.id) {
    const answered = state.current.messages.some((m) => m.role === 'assistant' && m.createdAt >= askedAt.slice(0, 19));
    if (!answered) state.current.messages.push({ role: 'assistant', status: 'error', error: failure, createdAt: new Date().toISOString() });
  }
  render();
  scrollToEnd();
  focusInput();
}

function scrollToEnd() {
  const list = els.panel.querySelector('.chat-messages');
  if (list) list.scrollTop = list.scrollHeight;
}

function focusInput() {
  const t = els.panel.querySelector('textarea');
  if (t && !t.disabled) t.focus();
}

function showPanelError(msg) {
  const list = els.panel.querySelector('.chat-messages');
  if (!list) { toast(msg, 'error'); return; }
  list.append(h('div', { class: 'notice danger small', role: 'alert' }, msg));
  scrollToEnd();
}

// Open a holding from a chat link. On narrow screens the panel covers the
// page, so it closes. The Positions view strips ?symbol after opening the
// drawer, so the same link works again later.
function openHolding(e, symbol) {
  e.preventDefault();
  const target = `#/positions?symbol=${encodeURIComponent(symbol)}`;
  if (window.matchMedia(NARROW).matches) toggle(false);
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}

// ---------- rendering ----------

function render() {
  if (!state.open) return;
  const s = state.status;
  const busyHere = state.inflight && state.inflight.id === state.current?.id;
  const head = h('header', { class: 'chat-head' },
    h('div', { class: 'chat-title' }, h('span', { class: 'ask-ico', 'aria-hidden': 'true' }, '✦'), h('strong', {}, 'Ask Signal Desk'),
      app.workspace === 'demo' ? badge('Demo data', 'warn') : null),
    h('div', { class: 'row' },
      h('button', { class: 'icon-btn', title: 'Saved conversations', 'aria-label': 'Saved conversations', 'aria-pressed': String(state.view === 'history'), onclick: () => { state.view = state.view === 'history' ? 'chat' : 'history'; render(); } }, '☰'),
      h('button', { class: 'icon-btn', title: 'New conversation', 'aria-label': 'New conversation', onclick: newConversation }, '+'),
      h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close Ask Signal Desk', onclick: () => toggle(false) }, '✕')));

  if (state.view === 'history') {
    mount(els.panel, head, historyView());
    return;
  }
  const body = h('div', { class: 'chat-messages' });
  if (state.loadError) {
    body.append(h('div', { class: 'notice danger', role: 'alert' }, h('strong', {}, 'Could not load Ask Signal Desk. '), state.loadError,
      h('div', { class: 'mt' }, h('button', { class: 'btn small', onclick: () => { state.loadError = null; render(); load(); } }, 'Try again'))));
  } else if (!s) body.append(h('div', { class: 'state loading' }, h('span', { class: 'spinner' }), 'Loading…'));
  else if (!s.available) body.append(unavailableView(s));
  const msgs = state.current?.messages || [];
  if (s?.available && !msgs.length) body.append(introView());
  for (const m of msgs) body.append(m.role === 'user' ? userBubble(m) : assistantMessage(m));
  if (busyHere) body.append(h('div', { class: 'chat-progress', id: 'chat-progress', role: 'status' }));
  const unusable = !s || !s.available || !!state.loadError;
  const input = h('textarea', { rows: 2, 'aria-label': 'Your question', placeholder: s?.available === false ? 'Ask Signal Desk is not configured' : 'Ask about your portfolio, a company, news or a hypothetical trade…', disabled: state.inflight || unusable ? true : null, maxlength: 4000 });
  input.value = state.draft;
  input.addEventListener('input', () => { state.draft = input.value; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
  const foot = h('footer', { class: 'chat-foot' },
    state.inflight && !busyHere ? h('div', { class: 'small muted' }, 'Another conversation is still being answered…') : null,
    h('div', { class: 'chat-suggest', id: 'chat-suggest-main' }, s?.available ? suggestionButtons() : null),
    h('div', { class: 'chat-input' }, input, h('button', { class: 'btn primary', disabled: state.inflight || unusable ? true : null, onclick: () => send(input.value) }, state.inflight ? '…' : 'Ask')),
    h('div', { class: 'chat-meta' },
      h('span', {}, 'Read-only. Never places trades.'),
      s?.available ? h('span', {}, ` · ${s.model}${s.dailyBudgetUsd ? ` · today ~US$${(s.spentTodayUsd || 0).toFixed(2)} of US$${s.dailyBudgetUsd} (both workspaces)` : ''}`) : null,
      ' · ', h('button', { class: 'linklike small', onclick: showDisclosure }, 'What is sent to the model?')));
  mount(els.panel, head, body, foot);
  renderProgress();
}

function renderProgress() {
  const el = document.getElementById('chat-progress');
  const p = state.inflight?.progress;
  if (!el || !p) return;
  mount(el,
    h('div', { class: 'row small muted' }, h('span', { class: 'spinner' }), 'Working on it…'),
    h('ul', { class: 'progress-list' }, p.map((x) => h('li', { class: `pg-${x.state}` },
      h('span', { class: 'pg-mark' }, x.state === 'done' ? '✓' : x.state === 'failed' ? '!' : '…'),
      TOOL_LABEL[x.tool] || x.tool, x.error ? h('span', { class: 'neg small' }, ` — ${x.error}`) : null))));
  scrollToEnd();
}

function introView() {
  return h('div', { class: 'chat-intro' },
    h('p', {}, 'Ask about your holdings, the latest moves, a company, news, upcoming earnings or a hypothetical trade. Answers are built from your saved records and stored data, with sources and timestamps.'),
    h('ul', { class: 'bullets small muted' },
      h('li', {}, 'Read-only: it cannot trade or change records. If you ask it to record something, it shows the exact change for you to confirm.'),
      h('li', {}, 'Hypothetical trades are calculated by Signal Desk, not estimated by the model.'),
      h('li', {}, 'It says when data is missing, delayed or stale, and marks media reports as unverified.')));
}

function unavailableView(s) {
  return h('div', { class: 'notice warn' },
    h('strong', {}, 'Ask Signal Desk is not available. '), s.reason || '',
    h('ul', {},
      h('li', {}, 'It needs its own Anthropic API key (console.anthropic.com → API keys). Building Signal Desk with Claude Code does not give the app model access.'),
      h('li', {}, 'Add ANTHROPIC_API_KEY=... to .env in the Signal Desk folder and restart.'),
      h('li', {}, 'Usage is billed per token to that key. With the default model a typical question costs roughly US$0.05–0.30; a daily cap (CHAT_DAILY_BUDGET_USD, default US$5) stops spending.')));
}

function historyView() {
  const list = state.conversations;
  return h('div', { class: 'chat-messages' },
    h('div', { class: 'spread' }, h('strong', {}, 'Saved conversations'), h('button', { class: 'btn small', onclick: newConversation }, 'New')),
    list.length ? h('div', { class: 'list mt' }, list.map((c) => h('div', { class: 'list-item spread' },
      h('button', { class: 'linklike conv-link', onclick: () => openConversation(c.id) }, h('span', {}, c.title),
        h('span', { class: 'small muted' }, ` · ${c.questions} question${c.questions === 1 ? '' : 's'} · ${fmt.et(c.updated_at)}`),
        state.inflight?.id === c.id ? h('span', { class: 'small muted' }, ' · answering…') : null),
      h('button', { class: 'btn small ghost danger', disabled: state.inflight?.id === c.id ? true : null, 'aria-label': `Delete conversation ${c.title}`, onclick: async () => {
        if (!confirm('Delete this conversation and its saved answers? This cannot be undone.')) return;
        try {
          await api('DELETE', `/api/chat/conversations/${c.id}`);
          if (state.current?.id === c.id) state.current = null;
          state.conversations = await api('GET', '/api/chat/conversations');
          render();
        } catch (e) { showPanelError(e.message); }
      } }, 'Delete')))) : h('p', { class: 'muted mt' }, 'No saved conversations yet.'));
}

async function showDisclosure() {
  const s = state.status || await api('GET', '/api/chat/status').catch(() => null);
  const box = h('div', { class: 'notice info disclosure' },
    h('strong', {}, 'What Ask Signal Desk sends to the model provider'),
    h('ul', {}, (s?.disclosure || []).map((d) => h('li', {}, d))),
    s?.pricingPerMillionTokens ? h('div', { class: 'small' }, `Model ${s.model}: about US$${s.pricingPerMillionTokens.input}/M input and US$${s.pricingPerMillionTokens.output}/M output tokens (${s.pricingPerMillionTokens.fromEnv ? 'from your .env' : 'estimate; check anthropic.com/pricing'}).`) : null,
    h('button', { class: 'btn small mt', onclick: () => box.remove() }, 'Close'));
  els.panel.querySelector('.chat-messages')?.prepend(box);
}

function userBubble(m) {
  return h('div', { class: 'msg user' }, h('div', { class: 'bubble' }, m.text));
}

function refChip(ref, ledger) {
  const item = ledger.find((l) => l.ref === ref);
  if (!item) return null;
  const status = NEWS_STATUS.includes(item.note) && item.note !== 'confirmed' ? item.note : null;
  const stale = item.kind === 'market_data' && item.freshness && item.freshness !== 'fresh' ? item.freshness : null;
  const chip = h('button', { class: `ref-chip kind-${item.kind}`, 'aria-expanded': 'false', title: `${KIND_LABEL[item.kind] || item.kind}: ${item.label}` },
    ref, status || stale ? h('span', { class: 'ref-flag' }, ` · ${status || stale}`) : null);
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    const parent = chip.closest('.detail-item, .short-answer') || chip.parentElement;
    const existing = parent.querySelector(`.ref-pop[data-ref="${ref}"]`);
    chip.setAttribute('aria-expanded', String(!existing));
    if (existing) { existing.remove(); return; }
    parent.append(sourceCard(item, true));
  });
  return chip;
}

function sourceCard(item, pop = false) {
  const holdingLink = item.symbol && ['portfolio_record', 'assessment', 'market_data', 'calculation'].includes(item.kind)
    ? h('a', { href: `#/positions?symbol=${encodeURIComponent(item.symbol)}`, onclick: (e) => openHolding(e, item.symbol) }, `Open ${item.symbol}`) : null;
  return h('div', { class: pop ? 'ref-pop' : 'source-row', dataset: { ref: item.ref } },
    h('div', { class: 'row' }, h('span', { class: 'ref-id' }, item.ref), badge(KIND_LABEL[item.kind] || item.kind), item.freshness ? badge(item.freshness, item.freshness === 'fresh' ? 'ok' : 'warn') : null,
      NEWS_STATUS.includes(item.note) ? badge(item.note, item.note === 'confirmed' ? 'ok' : item.note === 'reported' ? 'info' : 'warn') : null),
    h('div', { class: 'small' }, item.url ? extLink(item.url, item.label) : item.label),
    h('div', { class: 'small muted' }, [item.source, item.asOf ? `as of ${item.asOf.length === 10 ? item.asOf : fmt.et(item.asOf)}` : null, item.note && !NEWS_STATUS.includes(item.note) ? item.note : null].filter(Boolean).join(' · ')),
    holdingLink);
}

const kv = (rows) => h('dl', { class: 'kv small' }, rows.filter(Boolean).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
const money = (n, ccy) => (n == null ? 'not recorded' : fmt.money(n, ccy));

function tradeRows(s) {
  const cashLine = s.cashBefore != null
    ? `${money(s.cashBefore, s.currency)} → ${money(s.cashAfter, s.currency)} (${s.cashAccount}${s.cashConfirmed ? '' : ', unconfirmed'})`
    : `not recorded for ${s.cashAccount || 'this account'}`;
  if (s.side === 'sell') {
    return [['Shares', `${fmt.qty(s.shares)} of ${fmt.qty(s.sharesBefore)} (${fmt.qty(s.sharesAfter)} left)`], ['Est. price', `${fmt.num(s.price)} ${s.currency}`], ['Gross proceeds', money(s.grossProceeds, s.currency)],
      ['Fees', s.feesKnown ? money(s.fees, s.currency) : 'unknown (calculated as $0)'], ['Cash freed', money(s.netProceeds, s.currency)], ['Cash', cashLine],
      ['Est. realized P/L', fmt.signedMoney(s.estimatedRealizedPL, s.currency)], s.cadEquivalentOfProceeds ? ['≈ in CAD', `${fmt.money(s.cadEquivalentOfProceeds.amount, 'CAD')} at ${s.cadEquivalentOfProceeds.fxRate} (${s.cadEquivalentOfProceeds.fxAsOf})`] : null,
      s.weightAfterPct != null ? ['Weight', `${fmt.plainPct(s.weightBeforePct)} → ${fmt.plainPct(s.weightAfterPct)}`] : null, ['Taxes', s.taxes]];
  }
  return [['Shares', `${fmt.qty(s.shares)} (to ${fmt.qty(s.sharesAfter)})`], ['Est. price', `${fmt.num(s.price)} ${s.currency}`], ['Total cost', money(s.totalCost, s.currency)],
    ['Fees', s.feesKnown ? money(s.fees, s.currency) : 'unknown (calculated as $0)'], ['Cash', cashLine],
    ['Affordable with confirmed cash', s.affordableWithConfirmedCash ? 'Yes' : `No${s.cashShortfall ? ` (short ${money(s.cashShortfall, s.currency)})` : ''}`],
    s.cadEquivalentOfCost ? ['≈ in CAD', `${fmt.money(s.cadEquivalentOfCost.amount, 'CAD')} at ${s.cadEquivalentOfCost.fxRate} (${s.cadEquivalentOfCost.fxAsOf})`] : null,
    s.weightAfterPct != null ? ['Weight', `${fmt.plainPct(s.weightBeforePct)} → ${fmt.plainPct(s.weightAfterPct)}`] : null,
    ['New average cost', `${fmt.num(s.newAverageCost, 4)} ${s.currency}`]];
}

function legTitle(s) {
  if (s.side === 'convert') return `Convert ${fmt.money(s.amount, s.fromCurrency)} → ${fmt.money(s.received, s.toCurrency)}`;
  return `${s.side === 'sell' ? 'Sell' : 'Buy'} ${fmt.qty(s.shares)} ${s.symbol}${s.account ? ` (${s.account})` : ''}`;
}

function scenarioCard(s) {
  if (s.multiLeg) {
    return h('div', { class: 'scenario' },
      h('div', { class: 'spread' }, h('strong', {}, `${s.id}: ${s.legs.length}-step scenario`), badge('Hypothetical — not saved', 'warn')),
      s.warnings?.length ? h('div', { class: 'notice warn small' }, s.warnings.map((w) => h('div', {}, w))) : null,
      s.legs.map((leg, i) => h('details', { class: 'more' }, h('summary', {}, `${i + 1}. ${legTitle(leg)}`),
        leg.side === 'convert'
          ? kv([['Rate', `${leg.rate} (${leg.rateAsOf}, ${leg.rateSource})`], ['Cash before → after', leg.sourceCashBefore != null ? `${fmt.money(leg.sourceCashBefore, leg.fromCurrency)} → ${fmt.money(leg.sourceCashAfter, leg.fromCurrency)}` : 'not recorded']])
          : kv(tradeRows(leg)),
        leg.notes?.length ? h('ul', { class: 'bullets small muted' }, leg.notes.map((n) => h('li', {}, n))) : null)),
      Object.keys(s.cashChanges || {}).length
        ? kv(Object.entries(s.cashChanges).map(([k, c]) => [`Cash ${k}`, c.before != null ? `${fmt.money(c.before)} → ${fmt.money(c.after)} (${fmt.signedMoney(c.change)})` : `${fmt.signedMoney(c.change)} (no balance recorded)`]))
        : null);
  }
  return h('div', { class: 'scenario' },
    h('div', { class: 'spread' }, h('strong', {}, `${s.id}: ${legTitle(s)}`), badge('Hypothetical — not saved', 'warn')),
    kv(tradeRows(s)),
    h('div', { class: 'small muted' }, `Price basis: ${s.priceBasis}`),
    s.notes?.length ? h('ul', { class: 'bullets small muted' }, s.notes.map((n) => h('li', {}, n))) : null);
}

async function decideProposal(p, action, buttons) {
  buttons.forEach((b) => { b.disabled = true; });
  const convId = state.current.id;
  let ok = false, error = null;
  try {
    await api('POST', `/api/chat/proposals/${p.id}/${action}`, { conversationId: convId });
    ok = true;
    toast(action === 'confirm' ? 'Saved to your records' : 'Proposal rejected; nothing changed');
  } catch (e) {
    error = e.message;
  }
  try {
    const fresh = await api('GET', `/api/chat/conversations/${convId}`);
    if (state.current?.id === convId) state.current = fresh;
  } catch { /* keep the current view */ }
  if (error) {
    const same = state.current?.proposals?.find((x) => x.id === p.id);
    if (same) same.localError = error;
  }
  render();
  // Pages showing records re-read them after a confirmed change.
  if (ok && action === 'confirm') window.dispatchEvent(new CustomEvent('sd:records-changed'));
}

function proposalCard(p) {
  const d = p.diff || {};
  const posLine = (x) => (x ? `${fmt.qty(x.shares)} shares${x.averageCost != null ? ` @ ${fmt.num(x.averageCost, 4)}` : ''}${x.realizedPLAtAverageCost != null ? ` · realized ${fmt.signedMoney(x.realizedPLAtAverageCost)} at average cost` : ''}` : 'none');
  const card = h('div', { class: `proposal status-${p.status}` },
    h('div', { class: 'spread' }, h('strong', {}, 'Proposed change'),
      badge(p.status === 'pending' ? 'Not saved — needs your confirmation' : p.status, p.status === 'confirmed' ? 'ok' : p.status === 'pending' ? 'warn' : '')),
    h('div', {}, d.summary),
    d.fields?.length ? kv(d.fields.map(([k, v]) => [k, String(v)])) : null,
    'positionBefore' in d || d.positionAfter ? kv([['Position before', posLine(d.positionBefore)], ['Position after', posLine(d.positionAfter)]]) : null,
    d.duplicateWarning ? h('div', { class: 'notice danger small' }, d.duplicateWarning) : null,
    d.cashNote ? h('div', { class: 'small muted' }, d.cashNote) : null,
    d.reminder ? h('div', { class: 'small muted' }, d.reminder) : null,
    h('div', { class: 'small muted' }, `Requested in your words: "${p.userQuote}"`));
  if (p.status === 'pending') {
    const ok = h('button', { class: 'btn small primary' }, 'Confirm and save');
    const no = h('button', { class: 'btn small' }, 'Reject');
    ok.addEventListener('click', () => decideProposal(p, 'confirm', [ok, no]));
    no.addEventListener('click', () => decideProposal(p, 'reject', [ok, no]));
    card.append(h('div', { class: 'row mt' }, ok, no));
  }
  const err = p.localError || p.result?.error;
  if (err) card.append(h('div', { class: 'small neg', role: 'alert' }, err));
  return card;
}

function assistantMessage(m) {
  const proposals = (state.current?.proposals || []).filter((p) => p.messageId === m.id);
  if (m.status === 'unavailable' || (m.status === 'error' && !m.answer)) {
    return h('div', { class: 'msg assistant' }, h('div', { class: `notice ${m.status === 'unavailable' ? 'warn' : 'danger'}`, role: 'alert' },
      h('strong', {}, m.status === 'unavailable' ? 'Unavailable: ' : 'Could not answer: '), m.error || 'Unknown error',
      m.tools?.length ? h('div', { class: 'small mt' }, `Tools run before the failure: ${m.tools.map((t) => `${TOOL_LABEL[t.tool] || t.tool}${t.ok ? '' : ' (failed)'}`).join(', ')}`) : null),
      proposals.map(proposalCard));
  }
  const a = m.answer;
  const ledger = m.ledger || [];
  const usedRefs = new Set(a.details.flatMap((d) => d.refs));
  const groups = Object.keys(CATEGORY).map((c) => [c, a.details.filter((d) => d.category === c)]).filter(([, l]) => l.length);
  const held = new Set(a.held_symbols || []);
  const symbols = a.affected_symbols || [];
  const cost = m.usage ? (m.usage.estimated === false ? 'cost unknown (model not priced)' : `~US$${(m.usage.cost_usd || 0).toFixed(3)}`) : null;
  return h('div', { class: 'msg assistant' },
    m.status === 'partial' ? h('div', { class: 'small warn-text' }, '⚠ Partial answer — see notes below.') : null,
    h('div', { class: 'short-answer' }, a.short_answer),
    symbols.length ? h('div', { class: 'row small' }, 'Tickers: ', symbols.map((s) => (held.has(s)
      ? h('a', { class: 'hold-chip', href: `#/positions?symbol=${encodeURIComponent(s)}`, title: `Open your ${s} position`, onclick: (e) => openHolding(e, s) }, s)
      : h('span', { class: 'hold-chip plain', title: 'Not one of your holdings' }, s)))) : null,
    a.confidence && a.confidence !== 'not_applicable' ? h('div', { class: 'small muted' }, CONF[a.confidence] || a.confidence, a.horizon ? ` · Horizon: ${a.horizon}` : '') : (a.horizon ? h('div', { class: 'small muted' }, `Horizon: ${a.horizon}`) : null),
    (m.scenarios || []).map(scenarioCard),
    proposals.map(proposalCard),
    groups.length || a.alternatives?.length || a.what_would_change_it ? h('details', { class: 'more answer-details' }, h('summary', {}, 'Supporting details'),
      groups.map(([c, list]) => h('div', { class: 'detail-group' },
        h('div', { class: `cat-label ${CATEGORY[c][1]}` }, CATEGORY[c][0]),
        list.map((d) => h('div', { class: 'detail-item' }, h('span', {}, d.text, ' '), d.refs.map((r) => refChip(r, ledger)),
          d.uncited ? badge('uncited', 'warn', 'No supporting source was attached to this point') : null,
          d.relabelled ? badge('relabelled', 'info', 'The model called this a verified fact, but its only sources are media reports or archived briefings') : null,
          d.auto ? badge('added by Signal Desk', 'info', 'Added because the answer relies on data that may be out of date') : null)))),
      a.alternatives?.length ? h('div', { class: 'detail-group' }, h('div', { class: 'cat-label cat-interp' }, 'Alternatives compared'),
        a.alternatives.map((x) => h('div', { class: 'alt' }, h('strong', {}, x.option), h('div', { class: 'small' }, h('span', { class: 'pos' }, 'For: '), x.case_for), h('div', { class: 'small' }, h('span', { class: 'neg' }, 'Against: '), x.case_against)))) : null,
      a.what_would_change_it ? h('div', { class: 'detail-group' }, h('div', { class: 'cat-label cat-interp' }, 'What would change this'), h('div', { class: 'small' }, a.what_would_change_it)) : null) : null,
    a.issues?.length || a.failedTools?.length ? h('div', { class: 'notice warn small' }, h('ul', {}, [...(a.issues || []), ...(a.failedTools || []).map((t) => `${TOOL_LABEL[t.tool] || t.tool} failed: ${t.error}`)].map((i) => h('li', {}, i)))) : null,
    a.notes?.length ? h('ul', { class: 'bullets small muted' }, a.notes.map((n) => h('li', {}, n))) : null,
    ledger.length ? h('details', { class: 'more data-used' }, h('summary', {}, `Data used (${ledger.length})`),
      h('div', { class: 'small muted' }, `Retrieved for this answer at ${fmt.et(m.createdAt)}. Items marked as cited support specific points above.`),
      ledger.map((item) => {
        const row = sourceCard(item);
        if (usedRefs.has(item.ref)) row.classList.add('cited');
        return row;
      }),
      m.tools?.length ? h('div', { class: 'small muted mt' }, 'Tools: ', m.tools.map((t) => `${t.tool} ${t.ok ? '✓' : '✗'} ${t.ms}ms`).join(' · ')) : null) : null,
    a.follow_up_questions?.length ? h('div', { class: 'chat-suggest' }, a.follow_up_questions.map((q) => h('button', { class: 'chip-btn', disabled: state.inflight ? true : null, onclick: () => send(q) }, q))) : null,
    m.usage ? h('div', { class: 'small muted' }, `${m.model} · ${m.usage.calls} call${m.usage.calls === 1 ? '' : 's'} · ${(m.usage.input_tokens + m.usage.cache_read_input_tokens).toLocaleString()} in / ${m.usage.output_tokens.toLocaleString()} out tokens · ${cost}`) : null);
}

export { ACTION_LABEL };
