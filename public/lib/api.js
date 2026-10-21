// Shared client state and API helpers.
function store(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; }
  return null;
}

export const app = {
  workspace: store('sd.workspace') === 'demo' ? 'demo' : 'real',
  token: (() => { try { return sessionStorage.getItem('sd.token') || ''; } catch { return ''; } })(),
  status: null,
  page: 'overview',
  selectedSymbol: null,
  listeners: new Set(),
};

export function saveWorkspace(ws) {
  app.workspace = ws;
  store('sd.workspace', ws);
}

// Tell interested components (the chat panel) that page/selection changed.
export function setContext(patch) {
  Object.assign(app, patch);
  for (const fn of app.listeners) fn(app);
}

function headersFor(method) {
  const headers = { 'X-SD-Workspace': app.workspace };
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-Signal-Desk'] = '1'; }
  if (app.token) headers.Authorization = `Bearer ${app.token}`;
  return headers;
}

async function doFetch(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: headersFor(method), body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the Signal Desk server. Is it still running?');
  }
  if (res.status === 401) {
    const t = window.prompt('This Signal Desk requires an access token:');
    if (t) { app.token = t; try { sessionStorage.setItem('sd.token', t); } catch { /* ignore */ } return doFetch(method, path, body); }
  }
  return res;
}

export async function api(method, path, body) {
  const res = await doFetch(method, path, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// POST that streams newline-delimited JSON events; resolves with the final event.
export async function apiStream(path, body, onEvent) {
  const res = await doFetch('POST', path, body);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      last = ev;
      onEvent(ev);
    }
  }
  if (!last) throw new Error('The server closed the connection without a reply.');
  if (last.type === 'error') throw new Error(last.error);
  return last;
}
