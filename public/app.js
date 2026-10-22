// App shell: routing, API client, workspace switch, header status.
import { h, mount, fmt, toast, loading, errorState, closeDrawer } from './lib/ui.js';
import { app, api, saveWorkspace, setContext } from './lib/api.js';
import { initChat } from './lib/chat.js';
import { renderOverview } from './views/overview.js';
import { renderPositions } from './views/positions.js';
import { renderIntelligence } from './views/intelligence.js';
import { renderWatchlist } from './views/watchlist.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import { renderLab } from './views/lab.js';

const VIEWS = {
  overview: { title: 'Overview', render: renderOverview },
  positions: { title: 'Positions', render: renderPositions },
  intelligence: { title: 'Intelligence', render: renderIntelligence },
  watchlist: { title: 'AI Watchlist', render: renderWatchlist },
  reports: { title: 'Reports', render: renderReports },
  lab: { title: 'Strategy Lab', render: renderLab },
  settings: { title: 'Settings', render: renderSettings },
};

export { app, api };

export function setWorkspace(ws) {
  saveWorkspace(ws);
  setContext({});
  updateChrome();
  route();
}

function updateChrome() {
  document.getElementById('demo-banner').hidden = app.workspace !== 'demo';
}

export async function refreshStatus() {
  try {
    app.status = await api('GET', '/api/status');
  } catch {
    app.status = null;
  }
  const s = app.status;
  const pill = document.getElementById('market-session');
  const fr = document.getElementById('freshness');
  if (!s) { mount(pill, 'Offline'); pill.className = 'session-pill'; mount(fr, ''); return; }
  const labels = { regular: 'Market open', pre: 'Premarket', post: 'After hours', closed: 'Market closed' };
  mount(pill, labels[s.session.session] || s.session.session, s.session.reason && s.session.session === 'closed' ? ` · ${s.session.reason}` : '');
  pill.className = `session-pill ${s.session.session}`;
  const q = s.providers?.quotes;
  const ok = q ? q.ok : null;
  mount(fr,
    h('span', { class: `dot ${ok == null ? 'unknown' : ok ? 'fresh' : 'stale'}` }),
    h('span', {}, s.mode === 'demo' ? `Demo prices (synthetic)${q ? ' · ' + fmt.ago(q.at) : ''}` : s.config.marketProvider === 'none' ? 'No market data connected' : q ? `Prices ${fmt.ago(q.at)}` : 'Prices not refreshed yet'),
    q?.message ? h('span', { class: 'long' }, ` · ${q.message}`) : null);
  const foot = document.getElementById('sidebar-foot');
  mount(foot,
    h('div', {}, s.mode === 'demo' ? 'Demo workspace' : 'My portfolio'),
    h('div', { class: 'row' }, h('span', { class: `dot ${s.config.localOnly ? 'fresh' : 'stale'}` }), s.config.localOnly ? 'Local only (127.0.0.1)' : 'Remote access on'),
    h('div', { class: 'row' }, h('span', { class: `dot ${s.scheduler?.enabled ? 'fresh' : 'unknown'}` }), s.scheduler?.enabled ? 'Briefing scheduler on' : 'Scheduler off'),
    h('div', { class: 'muted small', style: { marginTop: '6px' } }, 'Read-only. No trading connection.'));
}

let current = null;
export async function route() {
  const name = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'overview');
  const v = VIEWS[name] || VIEWS.overview;
  current = name;
  closeDrawer();
  viewDirty = false;
  setContext({ page: name, selectedSymbol: null });
  document.getElementById('page-title').textContent = v.title;
  document.title = `${v.title} · Signal Desk`;
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.dataset.nav === name);
  const view = document.getElementById('view');
  mount(view, loading());
  try {
    await v.render(view, { api, app, refreshStatus, rerender: () => (current === name ? route() : null) });
  } catch (e) {
    mount(view, errorState(e, route));
  }
}

document.getElementById('refresh-btn').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  mount(b, 'Refreshing…');
  try {
    const r = await api('POST', '/api/refresh', { what: 'quotes' });
    const q = r.quotes;
    toast(q?.message || 'Refreshed', q?.failed?.length ? 'error' : '');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    b.disabled = false;
    mount(b, 'Refresh');
    await refreshStatus();
    route();
  }
});
document.getElementById('leave-demo').addEventListener('click', () => setWorkspace('real'));

window.addEventListener('hashchange', route);
// A change confirmed from Ask Signal Desk: re-read the page's records, unless
// the user has a drawer open or unsaved input on the page (that would be lost).
let viewDirty = false;
document.getElementById('view').addEventListener('input', () => { viewDirty = true; });
window.addEventListener('sd:records-changed', () => {
  refreshStatus();
  if (document.querySelector('.overlay.open') || viewDirty) toast('Saved to your records. This page will show it when you reopen it.');
  else route();
});
updateChrome();
refreshStatus().then(route);
initChat();
setInterval(refreshStatus, 60000);
