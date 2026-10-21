// DOM helpers. All text goes through text nodes (never innerHTML), so news
// headlines or descriptions can't inject markup or scripts.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
}

// ---------- formatting ----------

export const fmt = {
  num(n, dp = 2) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  },
  money(n, ccy, dp = 2) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const s = Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return `${n < 0 ? '−' : ''}$${s}${ccy ? ' ' + ccy : ''}`;
  },
  signedMoney(n, ccy) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${ccy ? ' ' + ccy : ''}`;
  },
  pct(n, dp = 2) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(dp)}%`;
  },
  plainPct(n, dp = 1) {
    return n == null ? '—' : `${Number(n).toFixed(dp)}%`;
  },
  qty(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 });
  },
  et(iso, { date = true } = {}) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const opts = { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' };
    if (date) Object.assign(opts, { month: 'short', day: 'numeric' });
    return d.toLocaleString('en-US', opts) + ' ET';
  },
  date(s) {
    if (!s) return '—';
    const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: s.length === 10 ? 'UTC' : 'America/New_York' });
  },
  ago(iso) {
    if (!iso) return '—';
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const hrs = Math.round(m / 60);
    if (hrs < 48) return `${hrs} h ago`;
    return `${Math.round(hrs / 24)} days ago`;
  },
};

export function tone(n) {
  if (n == null || !Number.isFinite(Number(n)) || n === 0) return '';
  return n > 0 ? 'pos' : 'neg';
}

export const ACTION_LABEL = {
  HOLD: 'Hold', TRIM: 'Trim', SELL: 'Sell', WAIT: 'Wait', CONDITIONAL_ADD: 'Conditional add', INSUFFICIENT_EVIDENCE: 'Insufficient evidence',
};

export const CATEGORY_LABEL = {
  compute: 'Compute & chips', semi_mfg: 'Chip manufacturing', memory: 'Memory & storage', networking: 'Networking',
  datacenter: 'Data centers & cloud', cooling_electrical: 'Cooling & electrical', power_grid: 'Power & grid',
  robotics: 'Robotics & industrial', materials: 'Critical materials', broad_etf: 'Broad-market ETF', thematic_etf: 'Sector ETF',
  unclassified: 'Unclassified',
};

export function badge(text, kind = '', title) {
  return h('span', { class: `badge ${kind}`, title }, text);
}

export function actionChip(action) {
  if (!action) return badge('No assessment', 'muted');
  return h('span', { class: `chip action-${action.toLowerCase()}` }, ACTION_LABEL[action] || action);
}

export function freshnessDot(q) {
  if (!q) return h('span', { class: 'dot missing', title: 'No quote' });
  const f = q.freshness || 'unknown';
  const title = `${q.provider || 'Unknown provider'} · ${q.timeliness || 'timeliness unknown'}${q.delayMinutes ? ` (${q.delayMinutes} min delay)` : ''} · ${q.quoteTime ? fmt.et(q.quoteTime) : 'no timestamp'} · ${q.session || ''}${q.freshnessReason ? ' · ' + q.freshnessReason : ''}${q.lastError ? ' · last error: ' + q.lastError : ''}`;
  return h('span', { class: `dot ${f}`, title, 'aria-label': `Quote ${f}` });
}

// ---------- states ----------

export function loading(text = 'Loading…') {
  return h('div', { class: 'state loading', role: 'status' }, h('span', { class: 'spinner' }), text);
}
export function empty(title, body, action) {
  return h('div', { class: 'state empty' }, h('div', { class: 'state-title' }, title), body ? h('p', {}, body) : null, action || null);
}
export function errorState(err, retry) {
  return h('div', { class: 'state error', role: 'alert' }, h('div', { class: 'state-title' }, 'Something went wrong'), h('p', {}, String(err?.message || err)),
    retry ? h('button', { class: 'btn', onclick: retry }, 'Try again') : null);
}
export function notice(kind, ...children) {
  return h('div', { class: `notice ${kind}` }, ...children);
}

// ---------- overlays ----------

let toastTimer = null;
export function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  mount(t, msg);
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 4500);
}

let closeCurrent = null;
export function closeDrawer() {
  closeCurrent?.();
}

export function drawer(title, content, { wide = false, onClose } = {}) {
  closeDrawer();
  const root = document.getElementById('overlay');
  const close = () => { root.className = 'overlay'; clear(root); document.removeEventListener('keydown', esc); closeCurrent = null; onClose?.(); };
  closeCurrent = close;
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  const panel = h('aside', { class: `drawer ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'drawer-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Close' }, '✕')),
    h('div', { class: 'drawer-body' }, content));
  mount(root, h('div', { class: 'scrim', onclick: close }), panel);
  root.className = 'overlay open';
  panel.querySelector('button')?.focus();
  return { close, body: panel.querySelector('.drawer-body') };
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function select(name, options, value) {
  return h('select', { name }, options.map(([v, l]) => h('option', { value: v, selected: v === value ? true : null }, l)));
}

export function formData(form) {
  const out = {};
  for (const el of form.querySelectorAll('input, select, textarea')) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  }
  return out;
}

export function section(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h3', { class: 'card-title' }, title) : null, ...children);
}

export function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.filter(Boolean).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '—')]));
}

export function extLink(url, text) {
  if (!url) return null;
  let safe = null;
  try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') safe = u.href; } catch { /* invalid */ }
  if (!safe) return h('span', {}, text || url);
  return h('a', { href: safe, target: '_blank', rel: 'noopener noreferrer' }, text || new URL(safe).hostname.replace(/^www\./, ''));
}
